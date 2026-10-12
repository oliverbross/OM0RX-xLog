use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::{mpsc, atomic::{AtomicUsize, Ordering}};
use std::time::Duration;

const MAX_REQUEST: usize = 32_768;
const MAX_RESPONSE: u64 = 65_536;
static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
struct RequestSlot;
impl Drop for RequestSlot {
    fn drop(&mut self) { IN_FLIGHT.fetch_sub(1, Ordering::AcqRel); }
}

pub fn validate_request(request: &Value) -> Result<(), String> {
    let object = request.as_object().ok_or("Request must be an object")?;
    if object.keys().any(|key| !["id", "method", "params"].contains(&key.as_str())) {
        return Err("Unknown request property".into());
    }
    let id = request["id"].as_str().ok_or("Request ID is required")?;
    if id.is_empty() || id.len() > 128 {
        return Err("Invalid request ID".into());
    }
    let method = request["method"].as_str().ok_or("Method is required")?;
    if !["health", "parse_adif", "self_test"].contains(&method) {
        return Err("This prototype permits only core diagnostics and ADIF parsing".into());
    }
    if !request["params"].is_object() {
        return Err("Parameters must be an object".into());
    }
    if serde_json::to_vec(request).map_err(|_| "Invalid request")?.len() > MAX_REQUEST {
        return Err("Request exceeds prototype size limit".into());
    }
    Ok(())
}

fn validate_response(response: Value, id: &Value) -> Result<Value, String> {
    if response.get("id") != Some(id) || !response["ok"].is_boolean() {
        return Err("Worker response did not match the request".into());
    }
    Ok(response)
}

pub fn request(request: Value) -> Result<Value, String> {
    validate_request(&request)?;
    IN_FLIGHT.fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| (count < 4).then_some(count + 1))
        .map_err(|_| "Prototype worker is busy; try again")?;
    let _slot = RequestSlot;
    let executable = std::env::current_exe().map_err(|_| "Cannot locate prototype")?;
    let name = if cfg!(windows) { "xlog-prototype-worker.exe" } else { "xlog-prototype-worker" };
    let path = executable.parent().ok_or("Cannot locate worker directory")?.join(name);
    if !path.is_file() {
        return Err("Bundled Swift worker is missing. Run the documented worker staging step and rebuild.".into());
    }
    let mut child = Command::new(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Bundled Swift worker could not start")?;
    let payload = serde_json::to_vec(&request).map_err(|_| "Invalid request")?;
    let stdin = child.stdin.take();
    // Pipe writes can block too (especially Windows' smaller pipe buffers).
    // Keep them under the same kill deadline as response reads.
    let writer = std::thread::spawn(move || {
        let mut stdin = stdin.ok_or("Worker stdin missing")?;
        stdin.write_all(&payload).and_then(|_| stdin.write_all(b"\n")).map_err(|_| "Worker input failed")
    });
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = writer.join();
            return Err("Worker stdout missing".into());
        }
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = BufReader::new(stdout).take(MAX_RESPONSE + 1).read_until(b'\n', &mut bytes)
            .map_err(|_| "Worker response could not be read")
            .and_then(|_| {
                if bytes.len() as u64 > MAX_RESPONSE || !bytes.ends_with(b"\n") {
                    return Err("Worker response exceeded limit or was incomplete");
                }
                serde_json::from_slice::<Value>(&bytes).map_err(|_| "Worker returned invalid JSON")
            });
        let _ = sender.send(result);
    });
    let result = receiver.recv_timeout(Duration::from_secs(8))
        .map_err(|_| "Worker deadline exceeded".to_string())
        .and_then(|value| value.map_err(str::to_string));
    // This P1 worker is intentionally one-shot. It cannot retain device handles,
    // credentials or a live database between requests; P2 owns persistent sessions.
    let _ = child.kill();
    let _ = child.wait();
    let write_result = writer.join().map_err(|_| "Worker input task failed")?;
    let _ = reader.join();
    write_result?;
    validate_response(result?, &request["id"])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn permits_only_prototype_core_methods() {
        for method in ["health", "parse_adif", "self_test"] {
            assert!(validate_request(&json!({"id":"a","method":method,"params":{}})).is_ok());
        }
    }
    #[test]
    fn rejects_hardware_and_shell_methods() {
        for method in ["ptt", "tune", "rotor_goto", "connect", "exec"] {
            assert!(validate_request(&json!({"id":"a","method":method,"params":{}})).is_err());
        }
    }
    #[test]
    fn rejects_unknown_fields_and_bad_shapes() {
        assert!(validate_request(&json!({"id":"a","method":"health","params":{},"path":"/tmp"})).is_err());
        assert!(validate_request(&json!({"id":"","method":"health","params":{}})).is_err());
        assert!(validate_request(&json!({"id":"a","method":"health","params":[]})).is_err());
    }
    #[test]
    fn bounds_request_size() {
        assert!(validate_request(&json!({"id":"a","method":"parse_adif","params":{"text":"x".repeat(MAX_REQUEST)}})).is_err());
    }
    #[test]
    fn requires_correlated_well_formed_response() {
        assert!(validate_response(json!({"id":"b","ok":true}), &json!("a")).is_err());
        assert!(validate_response(json!({"id":"a","ok":"yes"}), &json!("a")).is_err());
        assert!(validate_response(json!({"id":"a","ok":true,"result":{}}), &json!("a")).is_ok());
    }
}
