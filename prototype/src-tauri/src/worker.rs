use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
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
    if matches!(request["method"].as_str(), Some("sync_run" | "sync_configure" | "sync_resolve" | "sync_retry")) {
        return Err("Use the shared generation-bound Sync mutation owner.".into());
    }
    if label == "cw" { return Err("CW can only use the typed shared CW session.".into()); }
    if label == "rotor" { return Err("Rotor can only read retained native rotor telemetry.".into()); }
    if label == "station-status" { return Err("Station Status can only read retained native station observations.".into()); }
    if label == "propagation" { return Err("Propagation can only use the typed shared public-conditions session.".into()); }
    if matches!(label, "station-identity" | "alerts" | "antenna") { return Err("This display can only read its retained non-secret projection.".into()); }
    if request["method"].as_str().is_some_and(|method| method.starts_with("spot_draft_") || method == "logbook_operator_draft_qsy_clear") {
        return Err("Only the native transaction owner can use this method.".into());
    }
    if request["method"] == "workspace_layout_load" {
        return if matches!(label, "main" | "monitor" | "world-map" | "band-maps" | "dx-cluster" | "log-qso" | "spot-history" | "logbook" | "awards" | "callsign-intelligence" | "settings" | "chaser-dx" | "station-control") {
            Ok(())
        } else { Err("This window cannot read the shared workspace layout.".into()) };
    }
    // Passive station windows use retained native context only. They must not
    // reach worker reads (which can start sessions) or any special dispatcher.
    if label == "station-control" { return Err("Station Control can only read retained native observations and workspace placement.".into()); }
    if request["method"] == "cluster_resume" {
        return Err("Only the native session owner can resume a cluster.".into());
    }
    if request["method"] == "station_power_selection" {
        return Err("Only the native radio owner can publish power selection.".into());
    }
    if label == "settings" {
        return if matches!(request["method"].as_str(), Some(
            "settings_load" | "settings_receipt" | "settings_save"
            | "workspace_rotor_configuration_load" | "workspace_rotor_configuration_receipt" | "workspace_rotor_configuration_save"
            | "secret_status" | "secret_save"
            | "sync_status" | "sync_summary" | "sync_mutation" | "sync_receipt"
            | "reference_status" | "reference_resolve" | "reference_refresh" | "reference_schedule" | "reference_configure"
            | "backup_create" | "backup_list" | "backup_inspect" | "backup_import" | "backup_restore"
            | "workspace_layout_load" | "workspace_layout_apply"
        )) { Ok(()) } else { Err("Settings can only manage scoped configuration, synchronization, reference data, layouts and backups.".into()) };
    }
    if request["method"] == "workspace_band_map_apply" {
        return if label == "main" || label == "band-maps" && request["params"]["scope"] == "detached" { Ok(()) }
        else { Err("This window cannot change band-map preferences.".into()) };
    }
    if label == "callsign-intelligence" {
        return if matches!(request["method"].as_str(), Some("logbook_operator_draft" | "lookup_call"
            | "logbook_previous" | "logbook_matrix" | "cluster_history" | "workspace_preferences_load")) { Ok(()) }
        else { Err("Callsign Intelligence can only read the shared draft and its lookup evidence.".into()) };
    }
    if label == "log-qso" {
        return if matches!(request["method"].as_str(), Some("logbook_operator_draft"
            | "logbook_operator_draft_apply" | "logbook_operator_draft_receipt"
            | "lookup_call" | "logbook_previous" | "logbook_matrix" | "cluster_history" | "reference_resolve")) {
            Ok(())
        } else { Err("Log QSO can only edit the shared new-contact draft and read its lookup evidence.".into()) };
    }
    if label == "awards" {
        return if matches!(request["method"].as_str(), Some("logbook_stats" | "logbook_catalog")) {
            Ok(())
        } else { Err("Awards can only read local statistics and the awards catalogue.".into()) };
    }
    if label == "chaser-dx" {
        return if matches!(request["method"].as_str(), Some("opportunities_snapshot" | "opportunities_refresh")) {
            Ok(())
        } else { Err("Chaser & DX can only read and refresh public opportunity feeds.".into()) };
    }
    if label == "spot-history" {
        return if matches!(request["method"].as_str(), Some("spot_history_status" | "spot_history_query"
            | "spot_history_detail" | "spot_history_stats")) {
            Ok(())
        } else { Err("Spot History can only read the local report archive.".into()) };
    }
    if label == "logbook" {
        return if matches!(request["method"].as_str(), Some("logbook_list" | "logbook_contact"
            | "logbook_contact_apply" | "logbook_contact_receipt" | "logbook_matrix" | "logbook_previous"
            | "logbook_import_adif" | "logbook_export_adif" | "lookup_call" | "cluster_history")) {
            Ok(())
        } else { Err("This window can only read and edit the local logbook.".into()) };
    }
    // Cluster has a separate scoped session dispatcher. The explicit Settings
    // role above is the only child with credential/configuration authority; no
    // new window label inherits logbook or station authority.
    if !matches!(label, "main" | "monitor" | "world-map" | "band-maps") {
        return Err("This window cannot access the workspace service.".into());
    }
    // The narrow Logbook contact capability was handled above. No other
    // detached surface inherits contact editing or the active new-QSO draft.
    if label == "monitor" && matches!(request["method"].as_str(), Some("logbook_operator_draft" | "lookup_call")) { return Ok(()); }
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
        "workspace_band_map_apply",
        "workspace_map_context",
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
        "reference_configure",
        "opportunities_snapshot",
        "opportunities_refresh",
        "logbook_draft",
        "logbook_operator_draft",
        "logbook_operator_draft_apply",
        "logbook_operator_draft_receipt",
        "logbook_operator_draft_qsy_clear",
        "spot_draft_apply", "spot_draft_status", "spot_draft_stage", "spot_draft_finish", "spot_draft_abandon",
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
        "logbook_duplicate",
        "logbook_matrix",
        "logbook_import_adif",
        "logbook_export_adif",
        "settings_load",
        "settings_receipt",
        "settings_save",
        "workspace_rotor_configuration_load",
        "workspace_rotor_configuration_receipt",
        "workspace_rotor_configuration_save",
        "station_snapshot",
        "station_power_selection",
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
        "spot_history_status",
        "spot_history_query",
        "spot_history_detail",
        "spot_history_stats",
        "lookup_call",
        "weather",
        "propagation_snapshot",
        "propagation_refresh",
        "secret_save",
        "secret_status",
        "sync_status",
        "sync_summary",
        "sync_run",
        "sync_configure",
        "sync_resolve",
        "sync_retry",
        "sync_mutation",
        "sync_receipt",
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
    generation: u64,
    announced: Mutex<bool>,
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
            generation: SESSION_GENERATION
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                    value.checked_add(1)
                })
                .map_err(|_| "Station service generation exhausted")?
                + 1,
            announced: Mutex::new(false),
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
        crate::station_identity::retire(self.generation);
        // A retained local Hamlib rotor outlives Swift. Retire its automatic
        // authority too, not only permits already pinned to this generation.
        // Metadata only: never acquire a rotor driver lock or perform I/O.
        crate::auto_rotor::revoke();
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
static SESSION_GENERATION: AtomicU64 = AtomicU64::new(0);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static LOCAL_ACCEPTANCE: OnceLock<bool> = OnceLock::new();
pub fn local_acceptance() -> bool { *LOCAL_ACCEPTANCE.get().unwrap_or(&false) }
pub fn generation() -> u64 { SESSION_GENERATION.load(Ordering::Acquire) }

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
    session_from_registry(SESSION.get_or_init(|| Mutex::new(None)), start, announce_session)
}

fn announce_session(session: &Arc<Session>) {
    // A fresh canonical worker must require an explicit fresh automatic Arm;
    // a new follow permit cannot inherit the previous worker's armed state.
    crate::auto_rotor::revoke();
    if LOCAL_ACCEPTANCE.get() != Some(&true) {
        let exact_session = session.clone();
        crate::station_selection::worker_generation_started(
            session.generation,
            Arc::new(move |request| {
                validate_request(&request)?;
                request_in_session(&exact_session, request, RESPONSE_TIMEOUT)
            }),
        );
    }
}

fn existing_session_from_registry(
    registry: &Mutex<Option<Arc<Session>>>,
    started: impl FnOnce(&Arc<Session>),
) -> Result<Arc<Session>, String> {
    session_from_registry(registry, || Err("Station service has not started".into()), started)
}

fn existing_session() -> Result<Arc<Session>, String> {
    let registry = SESSION.get().ok_or("Station service has not started")?;
    existing_session_from_registry(registry, announce_session)
}

fn session_from_registry(
    registry: &Mutex<Option<Arc<Session>>>,
    start: impl FnOnce() -> Result<Arc<Session>, String>,
    started: impl FnOnce(&Arc<Session>),
) -> Result<Arc<Session>, String> {
    let mut guard = registry.lock().map_err(|_| "Station service lock failed")?;
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
    let session = guard
        .as_ref()
        .cloned()
        .ok_or("Station service unavailable")?;
    drop(guard);
    // Every caller crosses the same per-child announcement barrier after
    // registry unlock. A concurrent reuser must not return in the gap before
    // the creator invalidates the previous generation's metadata status.
    // The callback may take only metadata locks: never selection state or RPC.
    {
        let mut announced = session
            .announced
            .lock()
            .map_err(|_| "Station service announcement failed")?;
        if !*announced {
            started(&session);
            *announced = true;
        }
    }
    Ok(session)
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
    request_using(request, active_session)
}
/// Return the generation of the actual request session, never a later global
/// sample which could relabel a reply after a concurrent worker replacement.
pub(crate) fn request_with_generation(request: Value) -> Result<(u64, Value), String> {
    let mut generation = 0;
    let response = request_using(request, || {
        let session = active_session()?;
        generation = session.generation;
        Ok(session)
    })?;
    require_existing_generation(generation)?;
    Ok((generation, response))
}

/// Background observation must not create or replace a worker. Normal native
/// startup/foreground requests retain sole authority to start a generation.
pub fn request_existing(request: Value) -> Result<Value, String> {
    request_using(request, existing_session)
}

/// Pin admission to an already-running worker. An obsolete operation can never
/// cross a restart by checking the generation before a generic request call.
pub(crate) fn request_existing_generation(request: Value, expected: u64) -> Result<Value, String> {
    request_using(request, || {
        let session = existing_session()?;
        if session.generation != expected { return Err("Worker generation changed; no request was sent.".into()); }
        Ok(session)
    })
}
pub(crate) fn require_existing_generation(expected: u64) -> Result<(), String> {
    let session = existing_session()?;
    if session.generation != expected { return Err("Worker generation changed; no action was admitted.".into()); }
    Ok(())
}

fn request_using(request: Value, session: impl FnOnce() -> Result<Arc<Session>, String>) -> Result<Value, String> {
    validate_request(&request)?;
    IN_FLIGHT
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
            (count < MAX_IN_FLIGHT).then_some(count + 1)
        })
        .map_err(|_| "Prototype worker is busy; try again")?;
    let _slot = RequestSlot;
    let session = session()?;
    let identity = crate::station_identity::begin(&request, session.generation);
    let response = request_in_session(&session, request, RESPONSE_TIMEOUT);
    crate::station_identity::finish(identity, &response);
    response
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
    #[test]
    fn native_activation_journal_never_crosses_renderer_surfaces() {
        for method in ["spot_draft_apply","spot_draft_status","spot_draft_stage","spot_draft_finish","spot_draft_abandon"] {
            let request=serde_json::json!({"id":"native-only","method":method,"params":{}});
            super::validate_request(&request).unwrap();
            for label in ["main","monitor","log-qso","logbook","world-map","band-maps","dx-cluster","awards","spot-history","callsign-intelligence","settings"] {
                assert!(super::validate_surface(label,&request).is_err(),"{label}:{method}");
            }
        }
    }
    use super::*;
    use serde_json::json;

    #[test]
    fn station_control_only_reads_layout_and_cannot_reach_worker_or_native_dispatchers() {
        assert!(validate_surface("station-control", &json!({"id":"station","method":"workspace_layout_load","params":{}})).is_ok());
        for method in ["station_snapshot", "station_configuration", "station_configuration_save", "station_connect", "station_disconnect", "station_reconnect",
            "station_action", "station_tune", "station_radio_control", "station_power_selection", "station_rotor_snapshot", "station_rotor_goto", "station_rotor_stop",
            "hamlib_snapshot", "hamlib_connect", "hamlib_reconnect", "hamlib_control", "rotor_snapshot", "rotor_goto", "rotor_stop", "winkeyer_snapshot",
            "cluster_snapshot", "cluster_connect", "cluster_resume", "settings_load", "settings_save", "secret_status", "secret_save", "sync_run",
            "workspace_create", "workspace_layout_apply", "logbook_operator_draft", "logbook_list", "backup_restore", "health"] {
            assert!(validate_surface("station-control", &json!({"id":"station","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn cw_child_has_no_raw_worker_or_device_authority() {
        for method in ["workspace_layout_load", "settings_load", "settings_save", "secret_save", "secret_status", "logbook_operator_draft",
            "station_snapshot", "station_connect", "station_configuration", "station_radio_control", "station_action", "station_tune",
            "hamlib_snapshot", "hamlib_connect", "hamlib_control", "winkeyer_snapshot", "winkeyer_control", "rotor_stop", "cluster_snapshot", "health"] {
            assert!(validate_surface("cw", &json!({"id":"cw","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn rotor_observation_child_has_no_raw_worker_or_motion_authority() {
        for method in ["workspace_layout_load", "settings_load", "settings_save", "secret_save", "secret_status", "logbook_operator_draft",
            "rotor_snapshot", "rotor_connect", "rotor_disconnect", "rotor_goto", "rotor_stop", "rotor_park",
            "station_rotor_snapshot", "station_rotor_connect", "station_rotor_goto", "station_rotor_stop",
            "hamlib_snapshot", "hamlib_connect", "hamlib_control", "station_action", "station_connect", "sync_run", "health"] {
            assert!(validate_surface("rotor", &json!({"id":"rotor","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn station_status_has_no_raw_worker_radio_connection_or_control_authority() {
        for method in ["workspace_layout_load", "settings_load", "settings_save", "secret_save", "secret_status", "logbook_operator_draft",
            "station_snapshot", "station_configuration", "station_configuration_save", "station_power_selection", "station_connect", "station_disconnect", "station_reconnect",
            "station_tune", "station_action", "station_radio_control", "station_rotor_stop", "rotor_stop", "hamlib_snapshot", "hamlib_control", "winkeyer_snapshot", "sync_run", "health"] {
            assert!(validate_surface("station-status", &json!({"id":"status","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn propagation_child_cannot_bypass_shared_refresh_or_reach_worker_device_authority() {
        for method in ["propagation_snapshot", "propagation_refresh", "weather", "workspace_layout_load", "settings_load", "secret_status", "secret_save",
            "station_connect", "station_snapshot", "station_radio_control", "rotor_stop", "hamlib_snapshot", "hamlib_control", "winkeyer_snapshot", "sync_run", "health"] {
            assert!(validate_surface("propagation", &json!({"id":"propagation","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn station_identity_child_cannot_read_seed_or_write_settings_or_call_devices() {
        for method in ["settings_load", "settings_save", "settings_receipt", "secret_status", "secret_save", "workspace_status", "workspace_layout_load", "workspace_create",
            "station_connect", "station_configuration", "station_radio_control", "rotor_stop", "hamlib_snapshot", "hamlib_control", "winkeyer_snapshot", "sync_run", "health"] {
            assert!(validate_surface("station-identity", &json!({"id":"identity","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn alerts_child_cannot_read_or_control_worker_services() {
        for method in ["settings_load", "secret_status", "workspace_status", "station_snapshot", "station_connect", "station_action",
            "rotor_snapshot", "rotor_stop", "hamlib_snapshot", "hamlib_control", "winkeyer_stop", "sync_run", "health"] {
            assert!(validate_surface("alerts", &json!({"id":"alerts","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn antenna_child_cannot_seed_settings_or_reach_worker_or_hardware_authority() {
        for method in ["settings_load", "settings_save", "secret_status", "workspace_status", "station_configuration", "station_connect",
            "station_action", "rotor_snapshot", "rotor_stop", "hamlib_snapshot", "hamlib_control", "winkeyer_stop", "sync_run", "health"] {
            assert!(validate_surface("antenna", &json!({"id":"antenna","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn detached_qso_has_only_canonical_draft_and_required_lookup_reads() {
        for method in ["logbook_operator_draft", "logbook_operator_draft_apply", "logbook_operator_draft_receipt",
            "lookup_call", "logbook_previous", "logbook_matrix", "cluster_history", "workspace_layout_load", "reference_resolve"] {
            assert!(validate_surface("log-qso", &json!({"id":"qso","method":method,"params":{}})).is_ok(), "{method}");
        }
        for method in ["settings_load", "settings_save", "workspace_rotor_configuration_load", "workspace_rotor_configuration_save", "workspace_preferences_save", "workspace_layout_apply", "workspace_create",
            "backup_create", "backup_restore", "sync_summary", "sync_run", "secret_save", "secret_status",
            "logbook_draft", "logbook_save", "logbook_list", "logbook_contact", "logbook_contact_apply", "logbook_import_adif",
            "reference_status", "reference_refresh", "reference_schedule", "reference_configure",
            "station_snapshot", "station_power_selection", "station_configuration", "station_connect", "station_disconnect",
            "station_action", "station_tune", "station_radio_control", "cluster_snapshot", "cluster_resume", "cluster_connect",
            "rotor_stop", "station_rotor_stop", "hamlib_control", "winkeyer_snapshot", "health"] {
            assert!(validate_surface("log-qso", &json!({"id":"qso","method":method,"params":{}})).is_err(), "{method}");
        }
    }

    #[test]
    fn power_selection_is_native_only_on_every_renderer_surface() {
        let request = json!({"id":"selection", "method":"station_power_selection",
            "params":{"provider":"direct_agent","selection_id":uuid::Uuid::new_v4().to_string()}});
        assert!(validate_request(&request).is_ok());
        for label in ["main", "monitor", "log-qso", "logbook", "awards", "world-map", "band-maps", "dx-cluster", "settings", "unknown", ""] {
            assert!(validate_surface(label, &request).is_err(), "{label}");
        }
        let qsy = json!({"id":"qsy", "method":"logbook_operator_draft_qsy_clear", "params":{}});
        assert!(validate_request(&qsy).is_ok());
        for label in ["main", "monitor", "log-qso", "logbook", "awards", "world-map", "band-maps", "dx-cluster", "settings", "unknown", ""] {
            assert!(validate_surface(label, &qsy).is_err(), "{label}");
        }
    }

    #[test]
    fn reference_scheduling_authority_is_scoped_to_settings_surfaces() {
        for method in ["reference_configure", "reference_schedule", "reference_refresh"] {
            let request = json!({"id":"reference", "method":method, "params":{}});
            assert!(validate_surface("main", &request).is_ok());
            assert!(validate_surface("settings", &request).is_ok());
            for label in ["logbook", "awards", "monitor", "world-map", "band-maps", "dx-cluster", "unknown"] {
                assert!(validate_surface(label, &request).is_err(), "{label}: {method}");
            }
        }
    }

    #[test]
    fn revisioned_settings_are_scoped_to_main_and_the_settings_window() {
        for method in ["settings_load", "settings_receipt", "settings_save"] {
            let request = json!({"id":"settings", "method":method, "params":{}});
            assert!(validate_surface("main", &request).is_ok(), "main: {method}");
            assert!(validate_surface("settings", &request).is_ok(), "settings: {method}");
            for label in ["monitor", "log-qso", "logbook", "awards", "world-map", "band-maps",
                          "dx-cluster", "spot-history", "callsign-intelligence", "unknown", ""] {
                assert!(validate_surface(label, &request).is_err(), "{label}: {method}");
            }
        }
    }

    #[test]
    fn detached_settings_has_no_logbook_station_rotor_cluster_or_cw_authority() {
        for method in ["settings_load", "settings_receipt", "settings_save", "secret_status", "secret_save",
            "workspace_rotor_configuration_load", "workspace_rotor_configuration_receipt", "workspace_rotor_configuration_save",
            "sync_status", "sync_summary", "sync_mutation", "sync_receipt",
            "reference_status", "reference_resolve", "reference_refresh", "reference_schedule", "reference_configure",
            "backup_create", "backup_list", "backup_inspect", "backup_import", "backup_restore",
            "workspace_layout_load", "workspace_layout_apply"] {
            assert!(validate_surface("settings", &json!({"id":"settings","method":method,"params":{}})).is_ok(), "{method}");
        }
        for method in ["logbook_operator_draft", "logbook_contact", "logbook_save", "station_snapshot", "station_connect",
            "station_tune", "station_action", "station_power_selection", "rotor_snapshot", "rotor_goto", "cluster_snapshot",
            "cluster_connect", "winkeyer_snapshot", "workspace_create", "workspace_preferences_save",
            "sync_run", "sync_configure", "sync_resolve", "sync_retry"] {
            assert!(validate_surface("settings", &json!({"id":"settings","method":method,"params":{}})).is_err(), "{method}");
        }
    }

    #[test]
    fn sync_mutations_require_one_owner_and_only_sync_surfaces_can_reach_it() {
        for label in ["main", "settings"] {
            for method in ["sync_mutation", "sync_receipt"] {
                assert!(validate_surface(label, &json!({"id":"sync-owner","method":method,"params":{}})).is_ok());
            }
            for method in ["sync_run", "sync_configure", "sync_retry", "sync_resolve"] {
                assert!(validate_surface(label, &json!({"id":"raw-sync","method":method,"params":{}})).is_err());
            }
        }
        for label in ["monitor", "logbook", "log-qso", "world-map", "band-maps", "chaser-dx", "station-control", "station-status"] {
            for method in ["sync_mutation", "sync_receipt"] {
                assert!(validate_surface(label, &json!({"id":"foreign-sync","method":method,"params":{}})).is_err(), "{label} {method}");
            }
        }
    }

    #[test]
    fn spot_history_reads_are_scoped_to_main_and_its_archive_window() {
        for method in ["spot_history_status", "spot_history_query", "spot_history_detail", "spot_history_stats"] {
            let request = json!({"id":"history", "method":method, "params":{}});
            assert!(validate_surface("main", &request).is_ok());
            assert!(validate_surface("spot-history", &request).is_ok());
            for label in ["log-qso", "logbook", "awards", "monitor", "world-map", "band-maps", "dx-cluster", "unknown"] {
                assert!(validate_surface(label, &request).is_err(), "{label}: {method}");
            }
        }
        for method in ["spot_history_delete", "spot_history_purge", "spot_history_export"] {
            assert!(validate_request(&json!({"id":"history", "method":method, "params":{}})).is_err());
        }
    }

    #[test]
    fn spot_history_cannot_start_or_mutate_any_other_service() {
        for method in ["settings_load", "settings_save", "secret_status", "secret_save", "sync_summary", "sync_run",
            "workspace_create", "workspace_layout_apply", "backup_create", "backup_restore", "health",
            "logbook_operator_draft", "logbook_operator_draft_apply", "logbook_contact", "logbook_contact_apply",
            "logbook_list", "logbook_stats", "lookup_call", "reference_refresh", "station_snapshot",
            "station_power_selection", "station_connect", "station_tune", "hamlib_snapshot", "hamlib_control",
            "rotor_snapshot", "rotor_goto", "winkeyer_snapshot", "cluster_snapshot", "cluster_resume_initialize",
            "cluster_connect", "cluster_disconnect", "cluster_configure", "cluster_command", "cluster_history"] {
            assert!(validate_surface("spot-history", &json!({"id":"history","method":method,"params":{}})).is_err(), "{method}");
        }
        assert!(validate_surface("spot-history", &json!({"id":"history","method":"workspace_layout_load","params":{}})).is_ok());
    }

    #[test]
    fn sync_summary_is_readable_only_by_settings_surfaces() {
        let request = json!({"id":"summary", "method":"sync_summary", "params":{}});
        assert!(validate_surface("main", &request).is_ok());
        assert!(validate_surface("settings", &request).is_ok());
        for label in ["logbook", "awards", "monitor", "world-map", "band-maps", "dx-cluster", "unknown"] {
            assert!(validate_surface(label, &request).is_err(), "{label}");
        }
    }

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
            .is_err());
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
        assert!(validate_request(&json!({"id":"internal","method":"monitor_rotor_stop","params":{"owner":"native_dcu1"}})).is_err());
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
    fn only_band_maps_can_patch_its_exact_detached_view_scope() {
        for scope in ["desk", "detached", "unknown", ""] {
            let request = json!({"id":"maps","method":"workspace_band_map_apply","params":{"scope":scope,"generation":"fixture","expected":{},"patch":{}}});
            for label in ["main", "world-map", "band-maps", "monitor", "log-qso", "spot-history", "dx-cluster", "unknown"] {
                assert_eq!(validate_surface(label, &request).is_ok(), label == "main" || label == "band-maps" && scope == "detached", "{label}:{scope}");
            }
        }
    }

    #[test]
    fn portable_layout_is_readable_by_children_but_writable_only_by_settings_surfaces() {
        for method in ["workspace_layout_load", "workspace_layout_apply"] {
            let request = json!({"id":"layout-test","method":method,"params":{}});
            assert!(validate_surface("main", &request).is_ok());
            for label in ["settings", "monitor", "log-qso", "logbook", "awards", "chaser-dx", "world-map", "band-maps", "dx-cluster", "unknown"] {
                assert_eq!(validate_surface(label, &request).is_ok(), label == "settings" || method == "workspace_layout_load" && label != "unknown", "{label}: {method}");
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
                assert_eq!(validate_surface(label, &request).is_ok(), label == "monitor" && method == "logbook_operator_draft");
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
    fn detached_chaser_can_only_read_and_refresh_public_opportunities() {
        for method in ["opportunities_snapshot", "opportunities_refresh"] {
            assert!(validate_surface("chaser-dx", &json!({"id":"test","method":method,"params":{}})).is_ok(), "{method}");
        }
        for method in ["logbook_operator_draft", "logbook_operator_draft_apply", "station_connect", "station_tune",
            "rotor_goto", "hamlib_control", "settings_load", "secret_save", "sync_run", "backup_restore", "cluster_connect", "health"] {
            assert!(validate_surface("chaser-dx", &json!({"id":"test","method":method,"params":{}})).is_err(), "{method}");
        }
    }
    #[test]
    fn duplicate_history_query_is_main_only() {
        let request = json!({"id":"test", "method":"logbook_duplicate", "params":{"call":"W1AW", "band":"20m", "mode":"CW"}});
        assert!(validate_surface("main", &request).is_ok());
        for label in ["monitor", "logbook", "awards", "world-map", "band-maps", "dx-cluster", "unknown"] {
            assert!(validate_surface(label, &request).is_err(), "{label}");
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
    fn existing_only_request_never_starts_an_absent_generation_and_validates_before_lookup() {
        let registry = Mutex::new(None);
        let announcements = AtomicUsize::new(0);
        let request = json!({"id":"native-summary-test","method":"sync_summary","params":{}});
        let result = request_using(request, || existing_session_from_registry(&registry, |_| {
            announcements.fetch_add(1, Ordering::AcqRel);
        }));
        assert_eq!(result.unwrap_err(), "Station service has not started");
        assert!(registry.lock().unwrap().is_none());
        assert_eq!(announcements.load(Ordering::Acquire), 0);
        let result = request_using(json!({"id":"","method":"sync_summary","params":{}}), || {
            panic!("invalid requests must not inspect the session")
        });
        assert_eq!(result.unwrap_err(), "Invalid request ID");
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
    fn replacement_hook_runs_once_outside_registry_and_addresses_exact_child() {
        let registry = Mutex::new(None);
        let generations = Mutex::new(Vec::new());
        let hook = |session: &Arc<Session>| {
            assert!(
                registry.try_lock().is_ok(),
                "bootstrap must not hold registry lock"
            );
            let response = request_in_session(
                session,
                json!({"id":"probe","method":"health","params":{}}),
                Duration::from_secs(2),
            )
            .unwrap();
            generations
                .lock()
                .unwrap()
                .push((session.generation, response["result"]["child"].clone()));
        };
        let first = session_from_registry(&registry, || Ok(scripted_session("IFS= read -r request; printf '%s\\n' '{\"id\":\"probe\",\"ok\":true,\"result\":{\"child\":1}}'; cat >/dev/null")), &hook).unwrap();
        let reused = session_from_registry(
            &registry,
            || panic!("must reuse live child"),
            |_| panic!("must notify only creation"),
        )
        .unwrap();
        assert!(Arc::ptr_eq(&first, &reused));
        let observed = existing_session_from_registry(&registry, |_| panic!("existing child was already announced")).unwrap();
        assert!(Arc::ptr_eq(&first, &observed));
        first.retire("fixture replacement");
        assert!(existing_session_from_registry(&registry, |_| panic!("must not announce an absent replacement")).is_err());
        assert!(registry.lock().unwrap().is_none(), "background observation must leave replacement startup to its normal owner");
        let second = session_from_registry(&registry, || Ok(scripted_session("IFS= read -r request; printf '%s\\n' '{\"id\":\"probe\",\"ok\":true,\"result\":{\"child\":2}}'; cat >/dev/null")), &hook).unwrap();
        assert!(second.generation > first.generation);
        assert_eq!(
            *generations.lock().unwrap(),
            vec![(first.generation, json!(1)), (second.generation, json!(2))]
        );
        second.shutdown_with_grace(Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn concurrent_reuser_cannot_return_before_generation_announcement_finishes() {
        let registry = Arc::new(Mutex::new(None));
        let (entered, observed) = mpsc::channel();
        let (release, finish) = mpsc::channel();
        let creating = registry.clone();
        let creator = std::thread::spawn(move || session_from_registry(
            &creating,
            || Ok(scripted_session("cat >/dev/null")),
            |session| {
                assert!(creating.try_lock().is_ok());
                assert!(session.announced.try_lock().is_err());
                entered.send(()).unwrap();
                finish.recv().unwrap();
            },
        ).unwrap());
        observed.recv_timeout(Duration::from_secs(2)).unwrap();
        let published = registry.lock().unwrap().as_ref().unwrap().clone();
        assert!(published.announced.try_lock().is_err());
        let reusing = registry.clone();
        let (attempted, attempting) = mpsc::channel();
        let (returned, completed) = mpsc::channel();
        let reuser = std::thread::spawn(move || {
            attempted.send(()).unwrap();
            let session = existing_session_from_registry(&reusing, |_| panic!("must announce exactly once")).unwrap();
            returned.send(session.generation).unwrap();
            session
        });
        attempting.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(completed.recv_timeout(Duration::from_millis(100)).is_err(), "reuser returned before synchronous invalidation completed");
        // Registry remains free while the announcement is deliberately paused;
        // native shutdown does not acquire the announcement barrier.
        assert!(registry.try_lock().is_ok());
        release.send(()).unwrap();
        assert_eq!(completed.recv_timeout(Duration::from_secs(2)).unwrap(), published.generation);
        let created = creator.join().unwrap();
        let reused = reuser.join().unwrap();
        assert!(Arc::ptr_eq(&created, &reused));
        assert!(*published.announced.lock().unwrap());
        published.shutdown_with_grace(Duration::from_secs(1));
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
    #[test]
    fn callsign_intelligence_can_only_read_canonical_context_and_evidence() {
        for method in ["logbook_operator_draft", "lookup_call", "logbook_previous", "logbook_matrix", "cluster_history", "workspace_preferences_load", "workspace_layout_load"] {
            assert!(validate_surface("callsign-intelligence", &serde_json::json!({"id":"intel","method":method,"params":{}})).is_ok(), "{method}");
        }
        for method in ["logbook_operator_draft_apply", "logbook_operator_draft_receipt", "logbook_save", "logbook_contact", "logbook_contact_apply", "logbook_import_adif",
            "settings_load", "settings_save", "secret_status", "secret_save", "workspace_create", "workspace_layout_apply", "workspace_preferences_save", "workspace_band_map_apply",
            "sync_summary", "sync_run", "backup_create", "backup_restore", "station_snapshot", "station_connect", "station_tune", "station_power_selection",
            "hamlib_snapshot", "hamlib_control", "rotor_snapshot", "rotor_goto", "winkeyer_snapshot", "cluster_snapshot", "cluster_connect", "cluster_disconnect", "cluster_command"] {
            assert!(validate_surface("callsign-intelligence", &serde_json::json!({"id":"intel","method":method,"params":{}})).is_err(), "{method}");
        }
    }
