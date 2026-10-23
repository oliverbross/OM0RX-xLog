//! Native cluster projection owner. Rendering, hiding, or reloading a window
//! cannot create a second cluster poller or become the command transport.
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

type Transport = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn(Value) + Send + Sync;

pub fn handles(method: &str) -> bool {
    matches!(
        method,
        "cluster_snapshot"
            | "cluster_resume_initialize"
            | "cluster_filter"
            | "cluster_connect"
            | "cluster_disconnect"
            | "cluster_history"
            | "cluster_command"
            | "cluster_console_clear"
            | "cluster_configure"
            | "cluster_radio_spots_configure"
            | "cluster_contest_radio_spots_publish"
            | "cluster_password_set"
    )
}

pub fn validate(label: &str, request: &Value) -> Result<(), String> {
    let contest = crate::workspace_windows::WorkspaceWindowIdentity::parse_native_label(label).ok()
        .filter(|identity| identity.scope == crate::workspace_windows::WorkspaceWindowScope::Contesting);
    let label = contest.map_or_else(|| crate::workspace_windows::surface_role(label), |identity| identity.panel_id);
    crate::worker::validate_request(request)?;
    let method = request["method"].as_str().unwrap_or("");
    if !handles(method)
        || !matches!(
            label,
            "main" | "settings" | "dx-cluster" | "monitor" | "world-map" | "band-maps" | "contest-setup"
        )
    {
        return Err("This window cannot access the cluster session.".into());
    }
    if method == "cluster_contest_radio_spots_publish" && label != "contest-setup" {
        return Err("Only the active Contest Setup owner may publish classified contest spots.".into());
    }
    let exact_recent_spots_command = method == "cluster_command"
        && request["params"].as_object().is_some_and(|params| {
            params.len() == 1 && params.get("command").and_then(Value::as_str) == Some("SH/DX/100")
        });
    if contest.is_some()
        && !((label == "dx-cluster" && (matches!(method, "cluster_snapshot" | "cluster_connect" | "cluster_disconnect")
                || exact_recent_spots_command))
            || (label == "contest-setup" && method == "cluster_contest_radio_spots_publish"))
    {
        return Err("The contest Cluster window may only read, connect, disconnect, or request recent spots from the shared cluster session.".into());
    }
    if label == "settings" && !matches!(method, "cluster_snapshot" | "cluster_radio_spots_configure") {
        return Err("This cluster action is unavailable in Settings.".into());
    }
    if label != "main" && label != "settings"
        && (method == "cluster_password_set"
            || label != "dx-cluster" && method != "cluster_snapshot"
                && !(label == "contest-setup" && method == "cluster_contest_radio_spots_publish"))
    {
        return Err("This cluster action is unavailable in this window.".into());
    }
    Ok(())
}

struct Projection {
    revision: u64,
    selection_revision: u64,
    response: Option<Value>,
    selected: Option<String>,
    available: bool,
    received_at_ms: u64,
    identities: crate::spot_identity::SpotIdentities,
}

pub struct ClusterSession {
    activity_tick: Arc<dyn Fn() + Send + Sync>,
    transport: Arc<Transport>,
    publish: Arc<Publish>,
    command: Mutex<()>,
    projection: Mutex<Projection>,
    started: AtomicBool,
    stopped: AtomicBool,
    startup_resume_started: AtomicBool,
    restored_worker_generation: AtomicU64,
    sequence: AtomicU64,
    selection_holds: AtomicUsize,
    wake: (Mutex<()>, Condvar),
}

pub struct SelectionFence(Arc<ClusterSession>);
impl Drop for SelectionFence {
    fn drop(&mut self) { self.0.selection_holds.fetch_sub(1, Ordering::AcqRel); }
}

impl ClusterSession {
    fn new(transport: Arc<Transport>, publish: Arc<Publish>) -> Self {
        Self {
            activity_tick: Arc::new(|| {}),
            transport,
            publish,
            command: Mutex::new(()),
            projection: Mutex::new(Projection {
                revision: 0,
                selection_revision: 0,
                response: None,
                selected: None,
                available: false,
                received_at_ms: 0,
                identities: crate::spot_identity::SpotIdentities::new(crate::worker::generation()),
            }),
            started: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            startup_resume_started: AtomicBool::new(false),
            restored_worker_generation: AtomicU64::new(0),
            sequence: AtomicU64::new(0),
            selection_holds: AtomicUsize::new(0),
            wake: (Mutex::new(()), Condvar::new()),
        }
    }

    fn active(&self) -> Result<(), String> {
        if self.stopped.load(Ordering::Acquire) {
            Err("The cluster session is shutting down.".into())
        } else {
            Ok(())
        }
    }

    fn snapshot_request(&self) -> Value {
        json!({"id":format!("native-cluster-{}", self.sequence.fetch_add(1, Ordering::AcqRel)),
            "method":"cluster_snapshot","params":{}})
    }

    fn resume_request(&self) -> Value {
        json!({"id":format!("native-cluster-{}", self.sequence.fetch_add(1, Ordering::AcqRel)),
            "method":"cluster_resume","params":{}})
    }

    pub fn projection_value(&self) -> Result<Value, String> {
        let state = self
            .projection
            .lock()
            .map_err(|_| "Cluster projection unavailable")?;
        Ok(
            json!({"revision":state.revision,"selection_revision":state.selection_revision,"response":state.response,"selected":state.selected,"available":state.available,"received_at_ms":state.received_at_ms}),
        )
    }

    pub fn fence_selection(self: &Arc<Self>, expected_revision: u64) -> Result<SelectionFence, String> {
        let state = self.projection.lock().map_err(|_| "Cluster projection unavailable")?;
        if state.selection_revision != expected_revision { return Err("Cluster selection changed before QSY clear.".into()); }
        self.selection_holds.fetch_add(1, Ordering::AcqRel);
        Ok(SelectionFence(self.clone()))
    }

    fn accept_at_generation(&self, response: &Value, generation: u64, current_generation: u64) -> Result<(), String> {
        self.active()?;
        if generation != current_generation { return Err("Cluster worker changed before the snapshot was accepted.".into()); }
        let payload = &response["result"];
        if response["ok"] != true
            || !payload["snapshot"]["spots"]
                .as_array()
                .is_some_and(|spots| spots.len() <= 500)
        {
            return Err("The cluster service did not provide a valid snapshot.".into());
        }
        {
            let mut state = self
                .projection
                .lock()
                .map_err(|_| "Cluster projection unavailable")?;
            state.revision += 1;
            let mut annotated = payload.clone();
            state.identities.annotate(&mut annotated, generation);
            state.response = Some(annotated);
            state.available = true;
            state.received_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as u64).unwrap_or(0);
            if state.selected.as_ref().is_some_and(|id| {
                !payload["snapshot"]["spots"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|spot| spot["id"].as_str() == Some(id))
            }) {
                state.selected = None;
                state.selection_revision += 1;
            }
        }
        self.emit();
        Ok(())
    }

    fn accept(&self, response: &Value, generation: u64) -> Result<(), String> {
        self.accept_at_generation(response, generation, crate::worker::generation())
    }

    fn emit(&self) {
        if self.active().is_ok() {
            if let Ok(value) = self.projection_value() {
                (self.publish)(value);
            }
        }
    }

    fn unavailable(&self) {
        if let Ok(mut state) = self.projection.lock() {
            state.available = false;
            state.revision += 1;
            state.identities.invalidate(crate::worker::generation());
        }
        self.emit();
    }

    fn refresh(&self) -> Result<(), String> {
        self.active()?;
        // Background reads never queue behind a slow user action or accumulate
        // blocking tasks. Its returned snapshot will update the projection.
        let Ok(_guard) = self.command.try_lock() else {
            return Ok(());
        };
        self.active()?;
        let generation = crate::worker::generation();
        // Startup owns exactly one resume attempt. Every later cycle is a
        // passive snapshot; a timed-out resume is never replayed in the same
        // worker generation.
        let request = if !self.startup_resume_started.swap(true, Ordering::AcqRel) {
            self.resume_request()
        } else {
            self.snapshot_request()
        };
        let result = (self.transport)(request).and_then(|response| self.accept(&response, generation));
        if result.is_err() {
            self.unavailable();
        }
        result
    }

    pub fn refresh_and_publish(&self) -> Result<(), String> {
        self.refresh()?;
        self.emit();
        Ok(())
    }

    pub(crate) fn resume_after_worker_restart(
        &self,
        worker_generation: u64,
        dispatch: impl FnOnce(Value) -> Result<Value, String>,
    ) -> Result<(), String> {
        self.resume_after_worker_restart_with_generation(
            worker_generation,
            crate::worker::generation,
            dispatch,
        )
    }

    fn resume_after_worker_restart_with_generation(
        &self,
        worker_generation: u64,
        current_generation: impl FnOnce() -> u64,
        dispatch: impl FnOnce(Value) -> Result<Value, String>,
    ) -> Result<(), String> {
        if worker_generation <= 1 { return Ok(()); }
        let _guard = self.command.try_lock()
            .map_err(|_| "Cluster session is busy; its regular poll will resume the replacement worker.".to_string())?;
        self.active()?;
        if self.restored_worker_generation.fetch_update(
            Ordering::AcqRel,
            Ordering::Acquire,
            |previous| (worker_generation > previous).then_some(worker_generation),
        ).is_err() {
            return Ok(());
        }
        self.unavailable();
        let response = dispatch(self.resume_request())?;
        self.accept_at_generation(&response, worker_generation, current_generation())
    }

    /// Immutable fields come exclusively from this native retained snapshot.
    pub fn activation_spot(&self, epoch: &str, id: &str, version: &str) -> Result<Value, String> {
        self.active()?;
        let state = self.projection.lock().map_err(|_| "Cluster projection unavailable")?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Cluster clock unavailable")?.as_millis() as u64;
        if !state.available || now.saturating_sub(state.received_at_ms) > 5000 || state.received_at_ms > now + 1000 {
            return Err("Cluster reports are stale. Refresh before selecting a report.".into());
        }
        state.identities.resolve(epoch, id, version, crate::worker::generation())
    }

    pub fn request(&self, request: Value) -> Result<Value, String> {
        self.active()?;
        crate::worker::validate_request(&request)?;
        if !handles(request["method"].as_str().unwrap_or("")) {
            return Err("Unknown cluster action.".into());
        }
        if request["method"] == "cluster_snapshot" {
            if request["params"]
                .as_object()
                .is_none_or(|params| !params.is_empty())
            {
                return Err("Cluster snapshot takes no parameters.".into());
            }
            // Renderer reads reuse the native owner's last verified projection.
            // Initial load is synchronized with the one background poller.
            let state = self
                .projection
                .lock()
                .map_err(|_| "Cluster projection unavailable")?;
            if state.available {
                return Ok(json!({"id":request["id"],"ok":true,"result":state.response}));
            }
        }
        let _guard = self
            .command
            .try_lock()
            .map_err(|_| "Cluster session is busy. Wait for the current action to finish.")?;
        self.active()?;
        if matches!(request["method"].as_str(), Some("cluster_connect" | "cluster_disconnect" | "cluster_configure")) {
            // Retire displayed activation tokens before a source/session action,
            // including uncertain outcomes. No retained report is replayable.
            self.unavailable();
        }
        let generation = crate::worker::generation();
        let mut response = match (self.transport)(request.clone()) {
            Ok(value) => value,
            Err(error) => {
                self.unavailable();
                return Err(error);
            }
        };
        self.active()?;
        if response["ok"] == true && request["method"] != "cluster_history" {
            if let Err(error) = self.accept(&response, generation) {
                self.unavailable();
                return Err(error);
            }
            // Direct replies and background projections carry the same native
            // identity tokens; a fresh window must not need a second refresh.
            response["result"] = self.projection.lock().map_err(|_| "Cluster projection unavailable")?
                .response.clone().ok_or("Cluster snapshot unavailable")?;
        } else if request["method"] == "cluster_snapshot" {
            self.unavailable();
        }
        // An explicit command is sent once. Neither a transport failure nor a
        // worker error retries it. The UI can inspect fresh state before acting.
        Ok(response)
    }

    pub fn post_contest_spot(&self, label: &str, isolated: bool, callsign: &str, frequency_hz: u64) -> Result<(), String> {
        if label != "contest-setup" {
            return Err("Only Contest Setup can post a contest spot.".into());
        }
        if isolated {
            return Err("External services and station I/O are disabled in OM0RX-xLog Contesting Test.".into());
        }
        let callsign = callsign.trim().to_ascii_uppercase();
        if !(2..=24).contains(&callsign.len())
            || !callsign.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-'))
            || frequency_hz == 0
        {
            return Err("A valid callsign and contest frequency are required before posting a spot.".into());
        }
        let frequency_khz = frequency_hz as f64 / 1_000.0;
        let frequency = format!("{frequency_khz:.3}").trim_end_matches('0').trim_end_matches('.').to_owned();
        let request = json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "method": "cluster_command",
            "params": { "command": format!("DX {frequency} {callsign}") }
        });
        let response = self.request(request)?;
        if response["ok"] != true {
            return Err(response["error"]["message"].as_str().unwrap_or("The cluster rejected the contest spot.").into());
        }
        Ok(())
    }

    pub fn select(&self, selected: Option<String>) -> Result<(), String> {
        self.active()?;
        let mut state = self
            .projection
            .lock()
            .map_err(|_| "Cluster projection unavailable")?;
        if self.selection_holds.load(Ordering::Acquire) != 0 {
            return Err("Wait for the confirmed QSY draft update before selecting another spot.".into());
        }
        if let Some(id) = &selected {
            if id.is_empty()
                || id.len() > 128
                || !state.available
                || !state
                    .response
                    .as_ref()
                    .and_then(|response| response["snapshot"]["spots"].as_array())
                    .is_some_and(|spots| spots.iter().any(|spot| spot["id"].as_str() == Some(id)))
            {
                return Err("The selected spot is no longer available.".into());
            }
        }
        if state.selected != selected {
            state.selected = selected;
            state.selection_revision += 1;
            state.revision += 1;
        }
        drop(state);
        self.emit();
        Ok(())
    }

    fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let owner = Arc::clone(self);
        std::thread::spawn(move || {
            while owner.active().is_ok() {
                let Ok(guard) = owner.wake.0.lock() else {
                    break;
                };
                let _ = owner
                    .wake
                    .1
                    .wait_timeout_while(guard, Duration::from_secs(1), |_| {
                        !owner.stopped.load(Ordering::Acquire)
                    });
                owner.cycle();
            }
        });
    }

    fn with_activity_tick(mut self, tick: Arc<dyn Fn() + Send + Sync>) -> Self {
        self.activity_tick = tick;
        self
    }

    fn cycle(&self) {
        if self.active().is_err() { return; }
        // Passive activity is sampled even when cluster refresh is unavailable or busy.
        (self.activity_tick)();
        let _ = self.refresh();
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.wake.1.notify_all();
    }
}

static OWNER: OnceLock<Arc<ClusterSession>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);

pub(crate) fn retained_owner() -> Option<Arc<ClusterSession>> {
    if STOPPED.load(Ordering::Acquire) { None } else { OWNER.get().cloned() }
}

pub fn owner(app: &tauri::AppHandle) -> Result<Arc<ClusterSession>, String> {
    if STOPPED.load(Ordering::Acquire) {
        return Err("The cluster session is shutting down.".into());
    }
    let owner = OWNER
        .get_or_init(|| {
            let app = app.clone();
            Arc::new(ClusterSession::new(
                Arc::new(crate::worker::request),
                Arc::new(move |projection| {
                    if let Some(alerts) = crate::dx_alerts::existing() {
                        if let Err(error) = alerts.observe(&projection) { eprintln!("DX alert observation unavailable: {error}"); }
                    }
                    for label in ["dx-cluster", "world-map", "band-maps", "monitor"] {
                        let _ = app.emit_to(label, "xlog:cluster-projection", &projection);
                    }
                }),
            ).with_activity_tick(Arc::new(|| {
                if let Some(alerts) = crate::dx_alerts::existing() {
                    // Reuse the existing native loop and worker. Reading retained
                    // activity cannot start the default-off UDP receiver.
                    let generation = crate::worker::generation();
                    let request = json!({"id":uuid::Uuid::new_v4().to_string(),"method":"wsjtx_snapshot","params":{}});
                    match crate::worker::request_existing_generation(request, generation) {
                        Ok(reply) if crate::worker::require_existing_generation(generation).is_ok() => {
                            if alerts.observe_activity(&reply["result"]["activity"]).is_err() { alerts.activity_unavailable(); }
                        }
                        _ => alerts.activity_unavailable(),
                    }
                }
            })))
        })
        .clone();
    if STOPPED.load(Ordering::Acquire) {
        owner.stop();
        return Err("The cluster session is shutting down.".into());
    }
    owner.start();
    Ok(owner)
}

pub fn shutdown() {
    STOPPED.store(true, Ordering::Release);
    if let Some(owner) = OWNER.get() {
        owner.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reply(request: &Value, query: &str) -> Value {
        json!({"id":request["id"],"ok":true,"result":{"snapshot":{"spots":[{"id":"spot-a"}]},"query":query}})
    }
    fn request(method: &str) -> Value {
        json!({"id":"fixture-12345678","method":method,"params":{}})
    }
    fn command_request(command: &str) -> Value {
        json!({"id":"fixture-12345678","method":"cluster_command","params":{"command":command}})
    }

    #[test]
    fn surface_capabilities_are_explicit() {
        for method in [
            "cluster_snapshot",
            "cluster_resume_initialize",
            "cluster_filter",
            "cluster_connect",
            "cluster_disconnect",
            "cluster_history",
            "cluster_command",
            "cluster_console_clear",
            "cluster_configure",
            "cluster_radio_spots_configure",
        ] {
            assert!(validate("main", &request(method)).is_ok());
            assert!(validate("dx-cluster", &request(method)).is_ok());
            assert!(validate("unknown", &request(method)).is_err());
        }
        assert!(validate("main", &request("cluster_password_set")).is_ok());
        assert!(validate("dx-cluster", &request("cluster_password_set")).is_err());
        assert!(validate("settings", &request("cluster_snapshot")).is_ok());
        assert!(validate("settings", &request("cluster_radio_spots_configure")).is_ok());
        assert!(validate("settings", &request("cluster_configure")).is_err());
        for label in ["monitor", "world-map", "band-maps", "contest-setup"] {
            assert!(validate(label, &request("cluster_snapshot")).is_ok());
            assert!(validate(label, &request("cluster_connect")).is_err());
        }
        for method in ["cluster_snapshot", "cluster_connect", "cluster_disconnect"] {
            assert!(validate("contest--dx-cluster", &request(method)).is_ok());
        }
        assert!(validate("contest--dx-cluster", &command_request("SH/DX/100")).is_ok());
        for command in ["sh/dx/100", "SH/DX/50", "SH/MYDX/100"] {
            assert!(validate("contest--dx-cluster", &command_request(command)).is_err());
        }
        assert!(validate("contest--dx-cluster", &json!({
            "id":"fixture-12345678","method":"cluster_command",
            "params":{"command":"SH/DX/100","server_id":"00000000-0000-4000-8000-000000000001"}
        })).is_err());
        assert!(validate("contest-setup", &request("cluster_contest_radio_spots_publish")).is_ok());
        assert!(validate("main", &request("cluster_contest_radio_spots_publish")).is_err());
        assert!(validate("dx-cluster", &request("cluster_contest_radio_spots_publish")).is_err());
        for method in ["cluster_filter", "cluster_command", "cluster_configure", "cluster_password_set"] {
            assert!(validate("contest--dx-cluster", &request(method)).is_err());
        }
        assert!(validate("contest--band-maps", &request("cluster_connect")).is_err());
        assert!(validate("dx-cluster", &request("station_tune")).is_err());
        assert!(validate("main", &request("cluster_resume")).is_err());
        for label in ["main", "monitor", "world-map", "band-maps", "dx-cluster", "logbook"] {
            assert!(crate::worker::validate_surface(label, &request("cluster_resume")).is_err());
        }
    }

    #[test]
    fn multiple_renderers_reuse_one_verified_snapshot() {
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let owner = ClusterSession::new(
            Arc::new(move |request| {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(reply(&request, "initial"))
            }),
            Arc::new(|_| {}),
        );
        owner.refresh().unwrap();
        for _ in 0..20 {
            assert_eq!(
                owner.request(request("cluster_snapshot")).unwrap()["result"]["query"],
                "initial"
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn contest_connection_actions_and_renderers_reuse_one_serialized_owner() {
        let methods = Arc::new(Mutex::new(Vec::new()));
        let recorded = methods.clone();
        let owner = ClusterSession::new(
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request["method"].as_str().unwrap().to_string());
                Ok(reply(&request, "shared"))
            }),
            Arc::new(|_| {}),
        );
        assert_eq!(owner.request(request("cluster_connect")).unwrap()["result"]["query"], "shared");
        for _ in 0..20 {
            assert_eq!(owner.request(request("cluster_snapshot")).unwrap()["result"]["query"], "shared");
        }
        assert_eq!(*methods.lock().unwrap(), vec!["cluster_connect"]);
    }

    #[test]
    fn startup_resumes_once_and_periodic_refreshes_are_passive_snapshots() {
        let methods = Arc::new(Mutex::new(Vec::new()));
        let recorded = methods.clone();
        let owner = ClusterSession::new(
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request["method"].as_str().unwrap().to_owned());
                Ok(reply(&request, "refresh"))
            }),
            Arc::new(|_| {}),
        );
        owner.refresh().unwrap();
        owner.refresh().unwrap();
        owner.refresh().unwrap();
        assert_eq!(
            *methods.lock().unwrap(),
            ["cluster_resume", "cluster_snapshot", "cluster_snapshot"]
        );
    }

    #[test]
    fn replacement_worker_is_resumed_once_per_generation_with_exact_resume_request() {
        let owner = ClusterSession::new(
            Arc::new(|_| panic!("retained transport must not replace the exact worker dispatch")),
            Arc::new(|_| {}),
        );
        let mut calls = 0;
        owner.resume_after_worker_restart_with_generation(1, || 1, |_| {
            panic!("initial worker generation must not be restored")
        }).unwrap();
        owner.resume_after_worker_restart_with_generation(2, || 2, |request| {
            calls += 1;
            assert_eq!(request["method"], "cluster_resume");
            assert_eq!(request["params"], json!({}));
            Ok(reply(&request, "generation-2"))
        }).unwrap();
        owner.resume_after_worker_restart_with_generation(2, || 2, |_| {
            panic!("same worker generation restored twice")
        }).unwrap();
        owner.resume_after_worker_restart_with_generation(3, || 3, |request| {
            calls += 1;
            assert_eq!(request["method"], "cluster_resume");
            assert_eq!(request["params"], json!({}));
            Ok(reply(&request, "generation-3"))
        }).unwrap();
        assert_eq!(calls, 2);
        let projection = owner.projection_value().unwrap();
        assert_eq!(projection["available"], true);
        assert_eq!(projection["response"]["query"], "generation-3");
    }
    #[test]
    fn failed_cluster_reads_still_sample_passive_activity_each_cycle() {
        let published = Arc::new(AtomicU64::new(0)); let count = published.clone();
        let owner = ClusterSession::new(Arc::new(|_| Err("No cluster configured".into())), Arc::new(|_| {}))
            .with_activity_tick(Arc::new(move || { count.fetch_add(1, Ordering::SeqCst); }));
        owner.cycle(); owner.cycle();
        assert_eq!(published.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn first_direct_reply_has_native_tokens_and_old_worker_payload_is_never_relabelled() {
        let owner = ClusterSession::new(Arc::new(|request| Ok(json!({"id":request["id"],"ok":true,"result":{
            "snapshot":{"spots":[{"id":"source-report","callsign":"TEST1","frequencyKHz":14074.0,"mode":"FT8","band":"20m"}]}
        }}))), Arc::new(|_| {}));
        let response = owner.request(request("cluster_snapshot")).unwrap();
        let token = &response["result"]["snapshot"]["spots"][0]["activation"];
        assert!(token["sourceEpoch"].is_string());
        assert_eq!(owner.activation_spot(token["sourceEpoch"].as_str().unwrap(), "source-report", token["spotVersion"].as_str().unwrap()).unwrap()["call"], "TEST1");
        let previous = owner.projection_value().unwrap();
        assert!(owner.accept(&response, crate::worker::generation().wrapping_add(1)).is_err());
        assert_eq!(owner.projection_value().unwrap(), previous);
    }

    #[test]
    fn startup_resume_initialization_busy_is_rejected_before_transport_then_confirms() {
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Arc::new(ClusterSession::new(Arc::new(move |request| {
            recorded.lock().unwrap().push(request.clone());
            if request["method"] == "cluster_resume" {
                entered.send(()).unwrap();
                finish.lock().unwrap().recv_timeout(Duration::from_secs(3)).unwrap();
            }
            let mut response = reply(&request, "initialized");
            response["result"]["resume_initialized"] = json!(true);
            Ok(response)
        }), Arc::new(|_| {})));
        let reading = owner.clone();
        let background = std::thread::spawn(move || reading.refresh());
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let error = owner.request(request("cluster_resume_initialize")).unwrap_err();
        assert_eq!(error, "Cluster session is busy. Wait for the current action to finish.");
        assert_eq!(calls.lock().unwrap().len(), 1, "busy initialization never reached the worker");
        release.send(()).unwrap(); background.join().unwrap().unwrap();
        assert_eq!(owner.request(request("cluster_resume_initialize")).unwrap()["result"]["resume_initialized"], true);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1]["method"], "cluster_resume_initialize");
        assert_eq!(calls[1]["params"], json!({}));
        assert!(calls.iter().all(|request| !matches!(request["method"].as_str(), Some("cluster_connect" | "cluster_disconnect"))));
    }

    #[test]
    fn commands_publish_without_a_main_renderer_and_are_never_retried() {
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let events = Arc::new(Mutex::new(Vec::new()));
        let published = events.clone();
        let owner = ClusterSession::new(
            Arc::new(move |request| {
                count.fetch_add(1, Ordering::SeqCst);
                if request["method"] == "cluster_command" {
                    Err("lost response".into())
                } else {
                    Ok(reply(&request, "changed"))
                }
            }),
            Arc::new(move |value| published.lock().unwrap().push(value)),
        );
        owner.request(request("cluster_filter")).unwrap();
        assert_eq!(
            events.lock().unwrap().last().unwrap()["response"]["query"],
            "changed"
        );
        assert!(owner.request(request("cluster_command")).is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(events.lock().unwrap().last().unwrap()["available"], false);
        assert_eq!(
            events.lock().unwrap().last().unwrap()["response"]["query"],
            "changed"
        );
    }

    #[test]
    fn contest_setup_posts_one_bounded_dx_command_and_test_profile_never_reaches_transport() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let owner = ClusterSession::new(Arc::new(move |request| {
            recorded.lock().unwrap().push(request.clone());
            Ok(reply(&request, "posted"))
        }), Arc::new(|_| {}));

        owner.post_contest_spot("contest-setup", false, "om0rx", 14_025_500).unwrap();
        let captured = requests.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0]["method"], "cluster_command");
        assert_eq!(captured[0]["params"], json!({"command":"DX 14025.5 OM0RX"}));
        drop(captured);

        assert!(owner.post_contest_spot("contest-setup", true, "OM0RX", 14_025_500)
            .unwrap_err().contains("External services"));
        assert!(owner.post_contest_spot("main", false, "OM0RX", 14_025_500)
            .unwrap_err().contains("Only Contest Setup"));
        assert_eq!(requests.lock().unwrap().len(), 1);
    }

    #[test]
    fn shutdown_rejects_requests_and_late_results() {
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let owner = ClusterSession::new(
            Arc::new(move |request| {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(reply(&request, ""))
            }),
            Arc::new(|_| {}),
        );
        owner.stop();
        assert!(owner.request(request("cluster_connect")).is_err());
        assert!(owner.refresh().is_err());
        assert!(owner
            .accept(&reply(&request("cluster_snapshot"), "late"), crate::worker::generation())
            .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn selection_is_only_a_known_spot_not_a_radio_command() {
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let owner = ClusterSession::new(
            Arc::new(move |request| {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(reply(&request, ""))
            }),
            Arc::new(|_| {}),
        );
        owner.refresh().unwrap();
        let observed_at = owner.projection_value().unwrap()["received_at_ms"].clone();
        assert!(observed_at.as_u64().unwrap() > 0);
        owner.select(Some("spot-a".into())).unwrap();
        assert!(owner.select(Some("unknown".into())).is_err());
        assert_eq!(owner.projection_value().unwrap()["selected"], "spot-a");
        owner.select(None).unwrap();
        for _ in 0..20 { assert_eq!(owner.projection_value().unwrap()["received_at_ms"], observed_at); }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn qsy_transaction_fence_vetoes_a_new_cluster_selection_until_release() {
        let owner = Arc::new(ClusterSession::new(
            Arc::new(|request| Ok(reply(&request, ""))), Arc::new(|_| {})));
        owner.refresh().unwrap();
        let revision = owner.projection_value().unwrap()["selection_revision"].as_u64().unwrap();
        let fence = owner.fence_selection(revision).unwrap();
        assert!(owner.select(Some("spot-a".into())).is_err());
        drop(fence);
        owner.select(Some("spot-a".into())).unwrap();
    }

    #[test]
    fn a_slow_command_cannot_accumulate_pollers_or_be_replayed_during_shutdown() {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let release = Mutex::new(release_rx);
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let events = Arc::new(AtomicU64::new(0));
        let published = events.clone();
        let owner = Arc::new(ClusterSession::new(
            Arc::new(move |request| {
                count.fetch_add(1, Ordering::SeqCst);
                entered_tx.send(()).unwrap();
                release
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                Ok(reply(&request, "late"))
            }),
            Arc::new(move |_| {
                published.fetch_add(1, Ordering::SeqCst);
            }),
        ));
        let active = owner.clone();
        let command = std::thread::spawn(move || active.request(request("cluster_connect")));
        entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        // Connecting retires old report tokens before transport starts. That
        // wake is required; only publication after shutdown is prohibited.
        let before_shutdown = events.load(Ordering::SeqCst);
        assert_eq!(before_shutdown, 1);
        for _ in 0..20 {
            owner.refresh().unwrap();
        }
        assert!(owner.request(request("cluster_filter")).is_err());
        owner.stop();
        release_tx.send(()).unwrap();
        assert!(command.join().unwrap().is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(events.load(Ordering::SeqCst), before_shutdown);
    }

    #[test]
    fn start_is_idempotent_and_does_not_depend_on_a_renderer_timer() {
        let (tx, rx) = std::sync::mpsc::channel();
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let owner = Arc::new(ClusterSession::new(
            Arc::new(move |request| {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(reply(&request, "background"))
            }),
            Arc::new(move |_| {
                let _ = tx.send(());
            }),
        ));
        for _ in 0..10 {
            owner.start();
        }
        rx.recv_timeout(Duration::from_secs(3)).unwrap();
        owner.stop();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn cached_reads_still_validate_parameters_and_failed_snapshots_retain_last_good_data() {
        let owner = ClusterSession::new(
            Arc::new(|request| Ok(reply(&request, "verified"))),
            Arc::new(|_| {}),
        );
        owner.refresh().unwrap();
        let mut invalid = request("cluster_snapshot");
        invalid["params"] = json!({"unexpected":true});
        assert!(owner.request(invalid).is_err());
        assert!(owner
            .accept(&json!({"ok":true,"result":{"snapshot":{"spots":"bad"}}}), crate::worker::generation())
            .is_err());
        assert_eq!(
            owner.projection_value().unwrap()["response"]["query"],
            "verified"
        );
    }

    #[test]
    fn invalid_command_snapshot_cannot_leave_the_previous_projection_marked_live() {
        let owner = ClusterSession::new(
            Arc::new(|request| {
                if request["method"] == "cluster_filter" {
                    Ok(json!({"id":request["id"], "ok":true, "result":{}}))
                } else {
                    Ok(reply(&request, "last-good"))
                }
            }),
            Arc::new(|_| {}),
        );
        owner.refresh().unwrap();
        assert!(owner.request(request("cluster_filter")).is_err());
        let projection = owner.projection_value().unwrap();
        assert_eq!(projection["available"], false);
        assert_eq!(projection["response"]["query"], "last-good");
    }
}
