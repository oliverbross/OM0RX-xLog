use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Mutex, OnceLock, Weak,
};
use std::time::{Duration, Instant};

const MAX_REQUEST: usize = 32_768;
const MAX_RESPONSE: u64 = 1_048_576;
static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
const MAX_IN_FLIGHT: usize = 16;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(45);
pub fn validate_surface(label: &str, request: &Value) -> Result<(), String> {
    validate_request(request)?;
    if request["method"] == "cluster_resume" {
        return Err("Only the native session owner can resume a cluster.".into());
    }
    if label == "awards" {
        return if matches!(request["method"].as_str(), Some("logbook_stats" | "logbook_catalog")) {
            Ok(())
        } else { Err("Awards can only read local statistics and the awards catalogue.".into()) };
    }
    if label == "logbook" {
        return if matches!(request["method"].as_str(), Some("logbook_list" | "logbook_contact"
            | "logbook_contact_apply" | "logbook_contact_receipt" | "logbook_matrix" | "logbook_previous"
            | "logbook_import_adif" | "logbook_export_adif" | "lookup_call" | "cluster_history")) {
            Ok(())
        } else { Err("This window can only read and edit the local logbook.".into()) };
    }
    // Cluster has a separate scoped session dispatcher. No new window label
    // inherits the main workspace's logbook, credential or station authority.
    if !matches!(label, "main" | "monitor" | "world-map" | "band-maps") {
        return Err("This window cannot access the workspace service.".into());
    }
    // The narrow Logbook contact capability was handled above. No other
    // detached surface inherits contact editing or the active new-QSO draft.
    if request["method"].as_str().is_some_and(|method| method.starts_with("logbook_operator_draft") || method.starts_with("logbook_contact")) && label != "main" {
        return Err("This window cannot access the logbook editing service.".into());
    }
    if matches!(label, "world-map" | "band-maps") {
        if !matches!(request["method"].as_str(), Some("cluster_snapshot" | "logbook_stats" | "health")) {
            return Err("Detached maps are read-only.".into());
        }
        return Ok(());
    }
    if label == "monitor" {
        let allowed = match request["method"].as_str() {
            Some(
                "station_snapshot" | "cluster_snapshot" | "health" | "station_rotor_snapshot"
                | "station_rotor_goto" | "station_rotor_stop" | "rotor_snapshot"
                | "rotor_goto" | "rotor_stop",
            ) => true,
            Some("station_action") => matches!(
                request["params"]["action"].as_str(),
                Some("operate" | "standby" | "tune" | "cancel")
            ),
            _ => false,
        };
        if !allowed {
            return Err("This control is unavailable in the detached monitor.".into());
        }
    }
    Ok(())
}
struct RequestSlot;
impl Drop for RequestSlot {
    fn drop(&mut self) {
        IN_FLIGHT.fetch_sub(1, Ordering::AcqRel);
    }
}

pub fn validate_request(request: &Value) -> Result<(), String> {
    let object = request.as_object().ok_or("Request must be an object")?;
    if object
        .keys()
        .any(|key| !["id", "method", "params"].contains(&key.as_str()))
    {
        return Err("Unknown request property".into());
    }
    let id = request["id"].as_str().ok_or("Request ID is required")?;
    if id.is_empty() || id.len() > 128 {
        return Err("Invalid request ID".into());
    }
    let method = request["method"].as_str().ok_or("Method is required")?;
    if ![
        "health",
        "parse_adif",
        "self_test",
        "integration_self_test",
        "cluster_classify",
        "workspace_status",
        "workspace_create",
        "workspace_preferences_load",
        "workspace_preferences_save",
        "workspace_layout_load",
        "workspace_layout_apply",
        "backup_create",
        "backup_list",
        "backup_inspect",
        "backup_import",
        "backup_restore",
        "reference_status",
        "reference_resolve",
        "reference_refresh",
        "reference_schedule",
        "opportunities_snapshot",
        "opportunities_refresh",
        "logbook_draft",
        "logbook_operator_draft",
        "logbook_operator_draft_apply",
        "logbook_operator_draft_receipt",
        "logbook_contact",
        "logbook_contact_apply",
        "logbook_contact_receipt",
        "logbook_catalog",
        "logbook_list",
        "logbook_save",
        "logbook_delete",
        "logbook_undo",
        "logbook_stats",
        "logbook_previous",
        "logbook_matrix",
        "logbook_import_adif",
        "logbook_export_adif",
        "settings_load",
        "settings_save",
        "station_snapshot",
        "station_radio",
        "station_capabilities",
        "station_tune",
        "station_action",
        "station_connect",
        "station_disconnect",
        "station_cat_servers",
        "station_configure",
        "station_configuration",
        "station_configuration_save",
        "station_token_save",
        "station_reconnect",
        "station_forget",
        "station_radio_control",
        "station_rotor_connect",
        "station_rotor_snapshot",
        "station_rotor_disconnect",
        "station_rotor_goto",
        "station_rotor_stop",
        "rotor_snapshot",
        "rotor_connect",
        "rotor_disconnect",
        "rotor_goto",
        "rotor_park",
        "rotor_stop",
        "station_add_spot",
        "spot_bridge_snapshot",
        "spot_bridge_configure",
        "spot_bridge_start",
        "spot_bridge_stop",
        "cluster_snapshot",
        "cluster_resume",
        "cluster_resume_initialize",
        "cluster_connect",
        "cluster_disconnect",
        "cluster_configure",
        "cluster_command",
        "cluster_filter",
        "cluster_password_set",
        "cluster_console_clear",
        "cluster_history",
        "lookup_call",
        "weather",
        "propagation_snapshot",
        "secret_save",
        "secret_status",
        "sync_status",
        "sync_run",
        "sync_resolve",
        "sync_retry",
    ]
    .contains(&method)
    {
        return Err("Unknown integration method".into());
    }
    if !request["params"].is_object() {
        return Err("Parameters must be an object".into());
    }
    if serde_json::to_vec(request)
        .map_err(|_| "Invalid request")?
        .len()
        > MAX_REQUEST
    {
        return Err("Request exceeds prototype size limit".into());
    }
    Ok(())
}

fn validate_response(response: Value, id: &str) -> Result<Value, String> {
    if response["id"].as_str() != Some(id) || !response["ok"].is_boolean() {
        return Err("Worker response did not match the request".into());
    }
    Ok(response)
}

type Reply = Result<Value, String>;
struct Session {
    child: Mutex<Option<Child>>,
    input: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Reply>>>,
    accepting: AtomicBool,
    alive: AtomicBool,
    writes_pending: AtomicUsize,
}

impl Session {
    fn from_child(mut child: Child) -> Result<Arc<Self>, String> {
        let input = child.stdin.take().ok_or("Worker input missing")?;
        let output = child.stdout.take().ok_or("Worker output missing")?;
        let session = Arc::new(Self {
            child: Mutex::new(Some(child)),
            input: Mutex::new(Some(input)),
            pending: Mutex::new(HashMap::new()),
            accepting: AtomicBool::new(true),
            alive: AtomicBool::new(true),
            writes_pending: AtomicUsize::new(0),
        });
        let weak = Arc::downgrade(&session);
        std::thread::spawn(move || read_responses(output, weak));
        Ok(session)
    }

    fn register(&self, id: &str) -> Result<mpsc::Receiver<Reply>, String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Station service routing failed")?;
        if !self.accepting.load(Ordering::Acquire) || !self.alive.load(Ordering::Acquire) {
            return Err("Station service unavailable; retry the request".into());
        }
        if pending.contains_key(id) {
            return Err("Request ID is already in flight".into());
        }
        if pending.len() >= MAX_IN_FLIGHT {
            return Err("Prototype worker is busy; try again".into());
        }
        let (sender, receiver) = mpsc::channel();
        pending.insert(id.to_owned(), sender);
        self.writes_pending.fetch_add(1, Ordering::AcqRel);
        Ok(receiver)
    }

    fn dispatch(&self, response: Value) -> Result<(), String> {
        let id = response["id"]
            .as_str()
            .ok_or("Station service returned an uncorrelated response")?;
        if !response["ok"].is_boolean() {
            return Err("Station service returned an invalid response".into());
        }
        let sender = self
            .pending
            .lock()
            .map_err(|_| "Station service routing failed")?
            .remove(id)
            .ok_or("Station service returned an unknown request ID")?;
        let _ = sender.send(Ok(response));
        Ok(())
    }

    fn retire(&self, reason: &str) {
        self.accepting.store(false, Ordering::Release);
        if !self.alive.swap(false, Ordering::AcqRel) {
            return;
        }
        // Kill first to unblock a writer stuck in a full pipe. Never replay a write:
        // a timeout can mean the physical control already happened.
        self.kill_reap();
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(reason.to_owned()));
            }
        }
        if let Ok(mut input) = self.input.lock() {
            *input = None;
        }
    }

    fn kill_reap(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
                let _ = process.wait();
            }
            *child = None;
        }
    }

    fn shutdown(self: &Arc<Self>) {
        self.shutdown_with_grace(Duration::from_secs(8));
    }

    fn shutdown_with_grace(self: &Arc<Self>, grace: Duration) {
        // Stop admission atomically with registration, but keep routing alive
        // while accepted requests finish. The worker needs stdin EOF to release
        // only the station controls it owns.
        if let Ok(_pending) = self.pending.lock() {
            self.accepting.store(false, Ordering::Release);
        } else {
            self.retire("Station service routing failed during shutdown");
            return;
        }
        if !self.alive.load(Ordering::Acquire) {
            self.kill_reap();
            return;
        }
        // A writer can be blocked on a full stdin pipe. Close on another
        // thread only after all admitted writers attempted their writes; the
        // watchdog below remains free to kill/reap at the grace deadline.
        let closing = Arc::clone(self);
        std::thread::spawn(move || {
            while closing.writes_pending.load(Ordering::Acquire) != 0
                && closing.alive.load(Ordering::Acquire)
            {
                std::thread::sleep(Duration::from_millis(5));
            }
            if let Ok(mut input) = closing.input.lock() {
                *input = None;
            }
        });
        let deadline = Instant::now() + grace;
        loop {
            let exited = match self.child.lock() {
                Ok(mut child) => match child.as_mut() {
                    Some(process) => match process.try_wait() {
                        Ok(Some(_)) => {
                            *child = None;
                            true
                        }
                        Ok(None) => false,
                        Err(_) => {
                            drop(child);
                            self.kill_reap();
                            true
                        }
                    },
                    None => true,
                },
                Err(_) => {
                    self.kill_reap();
                    true
                }
            };
            if exited {
                break;
            }
            if Instant::now() >= deadline {
                self.kill_reap();
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        // Let the stdout demultiplexer deliver replies already written just
        // before exit; do not discard a confirmed response in the reap race.
        let drain_deadline = Instant::now() + Duration::from_millis(250);
        while Instant::now() < drain_deadline {
            if self
                .pending
                .lock()
                .map(|pending| pending.is_empty())
                .unwrap_or(true)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        self.alive.store(false, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(
                    "Station service stopped; control outcome unknown".into(),
                ));
            }
        }
    }
}

struct WritePending<'a>(&'a Session);
impl Drop for WritePending<'_> {
    fn drop(&mut self) {
        self.0.writes_pending.fetch_sub(1, Ordering::AcqRel);
    }
}

fn read_responses(output: impl Read, weak: Weak<Session>) {
    let mut reader = BufReader::new(output);
    loop {
        let mut bytes = Vec::new();
        let result = (&mut reader)
            .take(MAX_RESPONSE + 1)
            .read_until(b'\n', &mut bytes);
        let Some(session) = weak.upgrade() else {
            return;
        };
        if !session.alive.load(Ordering::Acquire) {
            return;
        }
        let response = match result {
            Ok(0) => {
                session.retire("Station service closed; control outcome unknown");
                return;
            }
            Ok(_) if bytes.len() as u64 > MAX_RESPONSE || !bytes.ends_with(b"\n") => {
                session.retire("Station service response incomplete or too large");
                return;
            }
            Ok(_) => serde_json::from_slice::<Value>(&bytes)
                .map_err(|_| "Station service returned invalid JSON".to_owned()),
            Err(_) => Err("Station service stream failed".to_owned()),
        };
        match response.and_then(|value| session.dispatch(value)) {
            Ok(()) => (),
            Err(message) => {
                session.retire(&message);
                return;
            }
        }
    }
}

static SESSION: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static LOCAL_ACCEPTANCE: OnceLock<bool> = OnceLock::new();

/// Called once by native main before creating any webviews. A renderer cannot
/// opt into or out of isolation, or nominate a directory for acceptance data.
pub fn configure_local_acceptance(enabled: bool) -> Result<(), String> {
    if SESSION.get().is_some() {
        return Err("Cannot change acceptance mode after worker startup".into());
    }
    LOCAL_ACCEPTANCE.set(enabled).map_err(|_| "Acceptance mode was already configured".into())
}

fn start() -> Result<Arc<Session>, String> {
    let executable = std::env::current_exe().map_err(|_| "Cannot locate application")?;
    let name = if cfg!(windows) {
        "xlog-prototype-worker.exe"
    } else {
        "xlog-prototype-worker"
    };
    let path = executable
        .parent()
        .ok_or("Cannot locate worker directory")?
        .join(name);
    if !path.is_file() {
        return Err("Bundled station service is missing. Reinstall the application.".into());
    }
    let mut command = Command::new(path);
    if LOCAL_ACCEPTANCE.get() == Some(&true) {
        command.arg("--local-ui-acceptance");
    }
    let child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Station service could not start")?;
    Session::from_child(child)
}

fn active_session() -> Result<Arc<Session>, String> {
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Station service lock failed")?;
    if SHUTTING_DOWN.load(Ordering::Acquire) {
        return Err("Station service is shutting down".into());
    }
    if guard
        .as_ref()
        .is_some_and(|session| !session.alive.load(Ordering::Acquire))
    {
        // Do not start a new generation until the previous child is reaped.
        if let Some(session) = guard.as_ref() {
            session.kill_reap();
        }
        *guard = None;
    }
    if guard.is_none() {
        *guard = Some(start()?);
    }
    guard
        .as_ref()
        .cloned()
        .ok_or("Station service unavailable".into())
}

pub fn shutdown() {
    // Exit is terminal for this desktop process. A late UI poll must not
    // create a replacement worker after the owned station was released.
    SHUTTING_DOWN.store(true, Ordering::Release);
    if let Some(lock) = SESSION.get() {
        if let Ok(mut guard) = lock.lock() {
            if let Some(session) = guard.take() {
                session.shutdown();
            }
        }
    }
}

pub fn request(request: Value) -> Result<Value, String> {
    validate_request(&request)?;
    IN_FLIGHT
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
            (count < MAX_IN_FLIGHT).then_some(count + 1)
        })
        .map_err(|_| "Prototype worker is busy; try again")?;
    let _slot = RequestSlot;
    let session = active_session()?;
    request_in_session(&session, request, RESPONSE_TIMEOUT)
}

fn request_in_session(
    session: &Arc<Session>,
    request: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let id = request["id"]
        .as_str()
        .ok_or("Request ID is required")?
        .to_owned();
    let mut payload = serde_json::to_vec(&request).map_err(|_| "Invalid request")?;
    payload.push(b'\n');
    let receiver = session.register(&id)?;
    let result = std::thread::scope(|scope| {
        // The stdin lock serializes writes only. Replies are routed by ID, not
        // arrival order, without holding a lock while waiting for a service.
        let (write_done, written) = mpsc::channel();
        let deadline = Instant::now() + timeout;
        let writer = scope.spawn(move || {
            let _writing = WritePending(session);
            let result = (|| {
                let mut input = session
                    .input
                    .lock()
                    .map_err(|_| "Station service input lock failed".to_owned())?;
                if !session.alive.load(Ordering::Acquire) {
                    return Err("Station service unavailable".to_owned());
                }
                input
                    .as_mut()
                    .ok_or("Station service input closed".to_owned())?
                    .write_all(&payload)
                    .map_err(|_| "Station service input failed; control outcome unknown".to_owned())
            })();
            if let Err(message) = &result {
                session.retire(message);
            }
            let _ = write_done.send(());
            result
        });
        let reply = receiver.recv_timeout(timeout)
            .map_err(|_| "Station service timed out; control outcome unknown. Reconnect before retrying a control.".to_owned())
            .and_then(|value| value)
            .and_then(|value| validate_response(value, &id));
        if reply.is_err() {
            session.retire("Station service request failed; control outcome unknown");
        }
        let write_deadline = written
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| "Station service input timed out; control outcome unknown".to_owned());
        if let Err(message) = &write_deadline {
            session.retire(message);
        }
        let write = writer
            .join()
            .map_err(|_| "Station service input panicked".to_owned())?;
        if let Err(message) = write {
            session.retire(&message);
            return Err(message);
        }
        write_deadline?;
        reply
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn monitor_allows_only_original_widget_controls() {
        for method in [
            "station_snapshot",
            "cluster_snapshot",
            "health",
            "station_rotor_goto",
            "station_rotor_stop",
        ] {
            assert!(
                validate_surface("monitor", &json!({"id":"r","method":method,"params":{}})).is_ok()
            );
        }
        for action in ["operate", "standby", "tune", "cancel"] {
            assert!(validate_surface(
                "monitor",
                &json!({"id":"r","method":"station_action","params":{"action":action}})
            )
            .is_ok());
        }
        for action in ["rotor_goto", "rotor_stop", "connect", "", "TRANSMIT"] {
            assert!(validate_surface(
                "monitor",
                &json!({"id":"r","method":"station_action","params":{"action":action}})
            )
            .is_err());
        }
        for method in [
            "station_tune",
            "station_connect",
            "station_cat_servers",
            "station_radio_control",
            "logbook_save",
            "sync_run",
            "settings_save",
            "propagation_snapshot",
            "spot_bridge_snapshot",
            "spot_bridge_configure",
            "spot_bridge_start",
            "spot_bridge_stop",
        ] {
            let request = json!({"id":"r","method":method,"params":{}});
            assert!(validate_surface("monitor", &request).is_err());
            assert!(validate_surface("main", &request).is_ok());
        }
    }

    #[test]
    fn detached_maps_allow_only_read_only_projections() {
        for label in ["world-map", "band-maps"] {
            for method in ["cluster_snapshot", "logbook_stats", "health"] {
                assert!(validate_surface(label, &json!({"id":"r","method":method,"params":{}})).is_ok());
            }
            for method in ["station_tune", "station_action", "station_snapshot", "logbook_save", "sync_run", "settings_save", "secret_save", "workspace_create", "backup_restore", "hamlib_control"] {
                assert!(validate_surface(label, &json!({"id":"r","method":method,"params":{}})).is_err());
            }
        }
    }

    #[test]
    fn portable_layout_does_not_grant_detached_windows_settings_authority() {
        for method in ["workspace_layout_load", "workspace_layout_apply"] {
            let request = json!({"id":"layout-test","method":method,"params":{}});
            assert!(validate_surface("main", &request).is_ok());
            for label in ["monitor", "logbook", "awards", "world-map", "band-maps", "dx-cluster", "unknown"] {
                assert!(validate_surface(label, &request).is_err(), "{label}: {method}");
            }
        }
    }

    #[test]
    fn shared_draft_is_scoped_to_the_authorized_editor() {
        for method in ["logbook_operator_draft", "logbook_operator_draft_apply", "logbook_operator_draft_receipt",
            "logbook_contact", "logbook_contact_apply", "logbook_contact_receipt"] {
            let request = json!({"id":"draft-test","method":method,"params":{}});
            assert!(validate_surface("main", &request).is_ok());
            for label in ["monitor", "world-map", "band-maps", "dx-cluster", "unknown", ""] {
                assert!(validate_surface(label, &request).is_err());
            }
        }
    }

    #[test]
    fn detached_awards_is_strictly_read_only() {
        for method in ["logbook_stats", "logbook_catalog"] {
            assert!(validate_surface("awards", &json!({"id":"test","method":method,"params":{}})).is_ok());
        }
        for method in ["logbook_list", "logbook_contact_apply", "logbook_operator_draft_apply", "logbook_save",
            "station_connect", "station_tune", "rotor_goto", "hamlib_control", "settings_load", "settings_save",
            "secret_save", "sync_run", "backup_restore", "cluster_connect", "cluster_resume", "health"] {
            assert!(validate_surface("awards", &json!({"id":"test","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn detached_logbook_has_contact_but_not_draft_station_or_configuration_authority() {
        for method in ["logbook_list", "logbook_contact", "logbook_contact_apply", "logbook_contact_receipt",
            "logbook_matrix", "logbook_previous", "logbook_import_adif", "logbook_export_adif", "lookup_call", "cluster_history"] {
            assert!(validate_surface("logbook", &json!({"id":"test", "method":method,"params":{}})).is_ok(), "{method}");
        }
        for method in ["logbook_operator_draft", "logbook_operator_draft_apply", "logbook_operator_draft_receipt",
            "logbook_save", "logbook_delete", "logbook_undo", "backup_restore", "settings_load", "settings_save",
            "station_tune", "station_connect", "station_action", "rotor_goto", "sync_run", "secret_status", "cluster_connect"] {
            assert!(validate_surface("logbook", &json!({"id":"test", "method":method,"params":{}})).is_err(), "{method}");
        }
    }

    #[test]
    fn permits_only_prototype_core_methods() {
        for method in [
            "health",
            "parse_adif",
            "self_test",
            "integration_self_test",
            "cluster_classify",
            "propagation_snapshot",
            "station_cat_servers",
        ] {
            assert!(validate_request(&json!({"id":"a","method":method,"params":{}})).is_ok());
        }
    }
    #[test]
    fn rejects_hardware_and_shell_methods() {
        for method in ["ptt", "tune", "rotor_send_raw", "connect", "exec"] {
            assert!(validate_request(&json!({"id":"a","method":method,"params":{}})).is_err());
        }
    }
    #[test]
    fn unregistered_and_cluster_windows_do_not_inherit_main_workspace_authority() {
        for label in ["dx-cluster", "logbook", "unknown", ""] {
            for method in ["logbook_save", "settings_save", "station_connect", "station_action", "health"] {
                let request = json!({"id":"fixture-12345678","method":method,"params":{}});
                assert!(validate_surface(label, &request).is_err(), "{label}: {method}");
                assert!(validate_surface("main", &request).is_ok(), "main: {method}");
            }
        }
    }

    #[test]
    fn rejects_unknown_fields_and_bad_shapes() {
        assert!(
            validate_request(&json!({"id":"a","method":"health","params":{},"path":"/tmp"}))
                .is_err()
        );
        assert!(validate_request(&json!({"id":"","method":"health","params":{}})).is_err());
        assert!(validate_request(&json!({"id":"a","method":"health","params":[]})).is_err());
    }
    #[test]
    fn bounds_request_size() {
        assert!(validate_request(
            &json!({"id":"a","method":"parse_adif","params":{"text":"x".repeat(MAX_REQUEST)}})
        )
        .is_err());
    }
    #[test]
    fn requires_correlated_well_formed_response() {
        assert!(validate_response(json!({"id":"b","ok":true}), "a").is_err());
        assert!(validate_response(json!({"id":"a","ok":"yes"}), "a").is_err());
        assert!(validate_response(json!({"id":"a","ok":true,"result":{}}), "a").is_ok());
    }

    #[cfg(unix)]
    fn scripted_session(script: &str) -> Arc<Session> {
        Session::from_child(
            Command::new("sh")
                .arg("-c")
                .arg(script)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("fixture worker"),
        )
        .expect("fixture session")
    }

    #[cfg(unix)]
    #[test]
    fn fragmented_out_of_order_replies_route_to_concurrent_ids() {
        let session = scripted_session(concat!(
            "IFS= read -r a; IFS= read -r b; ",
            "printf '%s' '{\"id\":\"b\",\"ok\":true,'; ",
            "printf '%s\\n' '\"result\":{\"order\":1}}'; ",
            "sleep 0.1; ",
            "printf '%s' '{\"id\":\"a\",'; ",
            "printf '%s\\n' '\"ok\":true,\"result\":{\"order\":2}}'"
        ));
        let a = session.register("a").unwrap();
        let b = session.register("b").unwrap();
        {
            let mut input = session.input.lock().unwrap();
            input
                .as_mut()
                .unwrap()
                .write_all(b"{\"id\":\"a\"}\n{\"id\":\"b\"}\n")
                .unwrap();
        }
        assert_eq!(
            b.recv_timeout(Duration::from_secs(2)).unwrap().unwrap()["result"]["order"],
            1
        );
        assert_eq!(
            a.recv_timeout(Duration::from_secs(2)).unwrap().unwrap()["result"]["order"],
            2
        );
        session.retire("test complete");
    }

    #[cfg(unix)]
    #[test]
    fn slow_service_does_not_block_fast_station_reply() {
        let session = scripted_session(concat!(
            "IFS= read -r slow; IFS= read -r fast; ",
            "printf '%s\\n' '{\"id\":\"station\",\"ok\":true,\"result\":{}}'; ",
            "sleep 0.2; ",
            "printf '%s\\n' '{\"id\":\"service\",\"ok\":true,\"result\":{}}'"
        ));
        let slow_session = Arc::clone(&session);
        let (completed, order) = mpsc::channel();
        let slow_completed = completed.clone();
        let slow = std::thread::spawn(move || {
            let result = request_in_session(
                &slow_session,
                json!({"id":"service","method":"weather","params":{}}),
                Duration::from_secs(2),
            );
            slow_completed.send("service").unwrap();
            result
        });
        std::thread::sleep(Duration::from_millis(20));
        let fast_session = Arc::clone(&session);
        let fast = std::thread::spawn(move || {
            let result = request_in_session(
                &fast_session,
                json!({"id":"station","method":"station_action","params":{"action":"cancel"}}),
                Duration::from_secs(2),
            );
            completed.send("station").unwrap();
            result
        });
        assert_eq!(
            order.recv_timeout(Duration::from_secs(2)).unwrap(),
            "station"
        );
        assert_eq!(fast.join().unwrap().unwrap()["id"], "station");
        assert_eq!(slow.join().unwrap().unwrap()["id"], "service");
        session.retire("test complete");
    }

    #[cfg(unix)]
    #[test]
    fn timeout_retires_generation_with_uncertain_outcome() {
        let session = scripted_session("IFS= read -r request; sleep 2");
        let result = request_in_session(
            &session,
            json!({"id":"uncertain","method":"station_action","params":{"action":"cancel"}}),
            Duration::from_millis(50),
        );
        assert!(result.unwrap_err().contains("outcome unknown"));
        assert!(!session.alive.load(Ordering::Acquire));
        assert!(session.register("next").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn dead_worker_fails_pending_without_replay() {
        let session = scripted_session("IFS= read -r a; exit 0");
        let reply = session.register("a").unwrap();
        session
            .input
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .write_all(b"{\"id\":\"a\"}\n")
            .unwrap();
        let result = reply.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(result.is_err());
        assert!(!session.alive.load(Ordering::Acquire));
        assert!(session.register("next").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_with_active_request_delivers_eof_and_release_before_reap() {
        // The fixture models the worker's owned-control release: it emits the
        // confirmation only after observing stdin EOF, never on the request.
        let session = scripted_session(concat!(
            "IFS= read -r request; ",
            "while IFS= read -r extra; do :; done; ",
            "printf '%s\\n' '{\"id\":\"pending\",\"ok\":true,\"result\":{\"released\":true}}'"
        ));
        let active = Arc::clone(&session);
        let requester = std::thread::spawn(move || {
            request_in_session(
                &active,
                json!({"id":"pending","method":"station_action","params":{"action":"cancel"}}),
                Duration::from_secs(3),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let registered = session.pending.lock().unwrap().contains_key("pending");
            if registered && session.writes_pending.load(Ordering::Acquire) == 0 {
                break;
            }
            assert!(Instant::now() < deadline, "fixture request was not written");
            std::thread::sleep(Duration::from_millis(5));
        }
        session.shutdown_with_grace(Duration::from_secs(2));
        let reply = requester.join().unwrap().unwrap();
        assert_eq!(reply["result"]["released"], true);
        assert!(session.child.lock().unwrap().is_none());
        assert!(session.register("later").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_watchdog_reaps_a_worker_that_ignores_eof() {
        let session = scripted_session("IFS= read -r request; sleep 2");
        let active = Arc::clone(&session);
        let requester = std::thread::spawn(move || {
            request_in_session(
                &active,
                json!({"id":"pending","method":"weather","params":{}}),
                Duration::from_secs(3),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let registered = session.pending.lock().unwrap().contains_key("pending");
            if registered && session.writes_pending.load(Ordering::Acquire) == 0 {
                break;
            }
            assert!(Instant::now() < deadline, "fixture request was not written");
            std::thread::sleep(Duration::from_millis(5));
        }
        let started = Instant::now();
        session.shutdown_with_grace(Duration::from_millis(100));
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(requester.join().unwrap().is_err());
        assert!(session.child.lock().unwrap().is_none());
        assert!(session.register("later").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn bounded_backlog_and_duplicate_ids() {
        let session = scripted_session("sleep 2");
        let mut pending = Vec::new();
        for n in 0..MAX_IN_FLIGHT {
            pending.push(session.register(&format!("request-{n}")).unwrap());
        }
        assert!(session.register("request-0").is_err());
        assert!(session.register("overflow").is_err());
        session.retire("test complete");
        for reply in pending {
            assert!(reply.recv_timeout(Duration::from_secs(2)).unwrap().is_err());
        }
    }
}
