use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock, atomic::{AtomicUsize, Ordering}};
use std::time::Duration;

const MAX_REQUEST: usize = 32_768;
const MAX_RESPONSE: u64 = 1_048_576;
static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
pub fn validate_surface(label: &str, request: &Value) -> Result<(), String> {
    validate_request(request)?;
    if label == "monitor" && !matches!(request["method"].as_str(), Some("station_snapshot" | "cluster_snapshot" | "health")) {
        return Err("The detached monitor is read-only. Use the main station controls.".into());
    }
    Ok(())
}
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
    if !["health", "parse_adif", "self_test", "integration_self_test", "cluster_classify",
        "workspace_status", "workspace_create", "backup_create", "backup_list", "backup_inspect", "backup_restore", "reference_status", "reference_refresh", "logbook_draft", "logbook_catalog", "logbook_list", "logbook_save", "logbook_delete",
        "logbook_undo", "logbook_stats", "logbook_previous", "logbook_matrix", "logbook_import_adif",
        "logbook_export_adif", "settings_load", "settings_save", "station_snapshot", "station_radio",
        "station_capabilities", "station_tune", "station_action", "station_connect", "station_disconnect",
        "station_configure", "station_configuration", "station_configuration_save", "station_token_save", "station_reconnect", "station_forget", "station_radio_control", "station_rotor_connect", "station_rotor_disconnect", "station_rotor_goto", "station_rotor_stop", "station_add_spot", "cluster_snapshot", "cluster_connect",
        "cluster_disconnect", "cluster_configure", "cluster_command", "cluster_filter", "cluster_password_set", "cluster_console_clear", "cluster_history", "lookup_call",
        "weather", "secret_save", "secret_status", "sync_status", "sync_run", "sync_resolve", "sync_retry"
    ].contains(&method) {
        return Err("Unknown integration method".into());
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

struct Session {
    child: Child,
    input: Option<ChildStdin>,
    output: mpsc::Receiver<Result<Value, String>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // EOF lets the worker release only controls it owns and close sockets.
        // A bounded grace period avoids hanging the desktop on a broken peer.
        drop(self.input.take());
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while std::time::Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) { return; }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

fn start() -> Result<Session, String> {
    let executable = std::env::current_exe().map_err(|_| "Cannot locate application")?;
    let name = if cfg!(windows) { "xlog-prototype-worker.exe" } else { "xlog-prototype-worker" };
    let path = executable.parent().ok_or("Cannot locate worker directory")?.join(name);
    if !path.is_file() { return Err("Bundled station service is missing. Reinstall the application.".into()); }
    let mut child = Command::new(path).stdin(Stdio::piped()).stdout(Stdio::piped())
        .stderr(Stdio::null()).spawn().map_err(|_| "Station service could not start")?;
    let input = child.stdin.take().ok_or("Worker input missing")?;
    let output = child.stdout.take().ok_or("Worker output missing")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(output);
        loop {
            let mut bytes = Vec::new();
            let result = (&mut reader).take(MAX_RESPONSE + 1).read_until(b'\n', &mut bytes)
                .map_err(|_| "Station service stream failed".to_string())
                .and_then(|_| {
                    if bytes.len() as u64 > MAX_RESPONSE || !bytes.ends_with(b"\n") {
                        return Err("Station service response incomplete or too large".to_string());
                    }
                    serde_json::from_slice::<Value>(&bytes).map_err(|_| "Station service returned invalid JSON".to_string())
                });
            let failed = result.is_err();
            if sender.send(result).is_err() || failed { break; }
        }
    });
    Ok(Session { child, input: Some(input), output: receiver })
}

pub fn shutdown() {
    if let Some(lock) = SESSION.get() {
        if let Ok(mut session) = lock.lock() { *session = None; }
    }
}

pub fn request(request: Value) -> Result<Value, String> {
    validate_request(&request)?;
    IN_FLIGHT.fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| (count < 16).then_some(count + 1))
        .map_err(|_| "Prototype worker is busy; try again")?;
    let _slot = RequestSlot;
    let mut session = SESSION.get_or_init(|| Mutex::new(None)).lock()
        .map_err(|_| "Station service lock failed")?;
    if session.is_none() { *session = Some(start()?); }
    let active = session.as_mut().ok_or("Station service unavailable")?;
    let mut payload = serde_json::to_vec(&request).map_err(|_| "Invalid request")?;
    payload.push(b'\n');
    // A scoped writer and a separate response reader share one deadline. Timeout
    // kills/reaps the child, unblocking a full stdin pipe before joining the writer.
    let result = std::thread::scope(|scope| {
        let input = active.input.as_mut().ok_or("Station service input closed")?;
        let writer = scope.spawn(move || input.write_all(&payload));
        let response = active.output.recv_timeout(Duration::from_secs(45))
            .map_err(|_| "Station service timed out; connection outcome unknown. Reconnect before retrying a control.".to_string())
            .and_then(|value| value)
            .and_then(|value| validate_response(value, &request["id"]));
        if response.is_err() { let _ = active.child.kill(); }
        let write = writer.join().map_err(|_| "Station service input failed".to_string())?
            .map_err(|_| "Station service input closed".to_string());
        write.and(response)
    });
    if result.is_err() { *session = None; }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn monitor_cannot_write_station_logbook_or_configuration() {
        for method in ["station_snapshot", "cluster_snapshot", "health"] {
            assert!(validate_surface("monitor", &json!({"id":"r","method":method,"params":{}})).is_ok());
        }
        for method in ["station_tune", "station_action", "station_connect", "logbook_save", "sync_run", "settings_save"] {
            let request = json!({"id":"r","method":method,"params":{}});
            assert!(validate_surface("monitor", &request).is_err());
            assert!(validate_surface("main", &request).is_ok());
        }
    }

    #[test]
    fn permits_only_prototype_core_methods() {
        for method in ["health", "parse_adif", "self_test", "integration_self_test", "cluster_classify"] {
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
