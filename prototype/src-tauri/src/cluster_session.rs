//! Native cluster projection owner. Rendering, hiding, or reloading a window
//! cannot create a second cluster poller or become the command transport.
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::Duration;
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
            | "cluster_password_set"
    )
}

pub fn validate(label: &str, request: &Value) -> Result<(), String> {
    crate::worker::validate_request(request)?;
    let method = request["method"].as_str().unwrap_or("");
    if !handles(method)
        || !matches!(
            label,
            "main" | "dx-cluster" | "monitor" | "world-map" | "band-maps"
        )
    {
        return Err("This window cannot access the cluster session.".into());
    }
    if label != "main"
        && (method == "cluster_password_set"
            || label != "dx-cluster" && method != "cluster_snapshot")
    {
        return Err("This cluster action is unavailable in this window.".into());
    }
    Ok(())
}

struct Projection {
    revision: u64,
    response: Option<Value>,
    selected: Option<String>,
    available: bool,
}

pub struct ClusterSession {
    transport: Arc<Transport>,
    publish: Arc<Publish>,
    command: Mutex<()>,
    projection: Mutex<Projection>,
    started: AtomicBool,
    stopped: AtomicBool,
    sequence: AtomicU64,
    wake: (Mutex<()>, Condvar),
}

impl ClusterSession {
    fn new(transport: Arc<Transport>, publish: Arc<Publish>) -> Self {
        Self {
            transport,
            publish,
            command: Mutex::new(()),
            projection: Mutex::new(Projection {
                revision: 0,
                response: None,
                selected: None,
                available: false,
            }),
            started: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
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
            "method":"cluster_resume","params":{}})
    }

    fn projection_value(&self) -> Result<Value, String> {
        let state = self
            .projection
            .lock()
            .map_err(|_| "Cluster projection unavailable")?;
        Ok(
            json!({"revision":state.revision,"response":state.response,"selected":state.selected,"available":state.available}),
        )
    }

    fn accept(&self, response: &Value) -> Result<(), String> {
        self.active()?;
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
            state.response = Some(payload.clone());
            state.available = true;
            if state.selected.as_ref().is_some_and(|id| {
                !payload["snapshot"]["spots"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|spot| spot["id"].as_str() == Some(id))
            }) {
                state.selected = None;
            }
        }
        self.emit();
        Ok(())
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
        let result =
            (self.transport)(self.snapshot_request()).and_then(|response| self.accept(&response));
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
        let response = match (self.transport)(request.clone()) {
            Ok(value) => value,
            Err(error) => {
                self.unavailable();
                return Err(error);
            }
        };
        self.active()?;
        if response["ok"] == true && request["method"] != "cluster_history" {
            if let Err(error) = self.accept(&response) {
                self.unavailable();
                return Err(error);
            }
        } else if request["method"] == "cluster_snapshot" {
            self.unavailable();
        }
        // An explicit command is sent once. Neither a transport failure nor a
        // worker error retries it. The UI can inspect fresh state before acting.
        Ok(response)
    }

    pub fn select(&self, selected: Option<String>) -> Result<(), String> {
        self.active()?;
        let mut state = self
            .projection
            .lock()
            .map_err(|_| "Cluster projection unavailable")?;
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
                let _ = owner.refresh();
            }
        });
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.wake.1.notify_all();
    }
}

static OWNER: OnceLock<Arc<ClusterSession>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);

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
                    let _ = app.emit_to("dx-cluster", "xlog:cluster-projection", projection);
                }),
            ))
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
        ] {
            assert!(validate("main", &request(method)).is_ok());
            assert!(validate("dx-cluster", &request(method)).is_ok());
            assert!(validate("unknown", &request(method)).is_err());
        }
        assert!(validate("main", &request("cluster_password_set")).is_ok());
        assert!(validate("dx-cluster", &request("cluster_password_set")).is_err());
        for label in ["monitor", "world-map", "band-maps"] {
            assert!(validate(label, &request("cluster_snapshot")).is_ok());
            assert!(validate(label, &request("cluster_connect")).is_err());
        }
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
            .accept(&reply(&request("cluster_snapshot"), "late"))
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
        owner.select(Some("spot-a".into())).unwrap();
        assert!(owner.select(Some("unknown".into())).is_err());
        assert_eq!(owner.projection_value().unwrap()["selected"], "spot-a");
        owner.select(None).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
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
        for _ in 0..20 {
            owner.refresh().unwrap();
        }
        assert!(owner.request(request("cluster_filter")).is_err());
        owner.stop();
        release_tx.send(()).unwrap();
        assert!(command.join().unwrap().is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(events.load(Ordering::SeqCst), 0);
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
            .accept(&json!({"ok":true,"result":{"snapshot":{"spots":"bad"}}}))
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
