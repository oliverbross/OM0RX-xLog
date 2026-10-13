//! Read-only radio telemetry. Never substitutes for explicit command readback.
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
type Read = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn(Value) + Send + Sync;

pub fn valid_provider(provider: &str) -> bool {
    matches!(provider, "direct_agent" | "direct_flex_lan" | "hamlib")
}
pub fn validate(label: &str, isolated: bool, selection: bool) -> Result<(), String> {
    if isolated || !(label == "main" || !selection && label == "monitor") {
        return Err("Radio telemetry is unavailable in this window.".into());
    }
    Ok(())
}
pub fn changes_radio(request: &Value) -> bool {
    let method = request["method"].as_str().unwrap_or("");
    if method.starts_with("station_rotor_") {
        return false;
    }
    if method.starts_with("station_") {
        return !matches!(
            method,
            "station_snapshot"
                | "station_radio"
                | "station_capabilities"
                | "station_configuration"
                | "station_add_spot"
        );
    }
    request["params"]["device"] == "radio"
        && matches!(
            method,
            "hamlib_connect" | "hamlib_reconnect" | "hamlib_disconnect" | "hamlib_control"
        )
}
struct State {
    provider: Option<String>,
    epoch: u64,
    revision: u64,
    controls: usize,
    projection: Value,
}
pub struct StationTelemetry {
    read: Arc<Read>,
    publish: Arc<Publish>,
    state: Mutex<State>,
    reading: Mutex<()>,
    started: AtomicBool,
    stopped: AtomicBool,
    wake: (Mutex<()>, Condvar),
}
impl StationTelemetry {
    fn new(read: Arc<Read>, publish: Arc<Publish>) -> Self {
        Self {
            read,
            publish,
            state: Mutex::new(State {
                provider: None,
                epoch: 0,
                revision: 0,
                controls: 0,
                projection: json!({"revision":0,"available":false,"provider":null,"snapshot":null}),
            }),
            reading: Mutex::new(()),
            started: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            wake: (Mutex::new(()), Condvar::new()),
        }
    }
    pub fn select(&self, provider: &str, initialize_only: bool) -> Result<Value, String> {
        if !valid_provider(provider) {
            return Err("Unknown radio provider.".into());
        }
        if self.stopped.load(Ordering::Acquire) {
            return Err("Radio telemetry has stopped.".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Radio telemetry unavailable")?;
        // Listener startup cannot undo a later explicit provider handover.
        if state.provider.is_none()
            || !initialize_only && state.provider.as_deref() != Some(provider)
        {
            state.provider = Some(provider.into());
            state.epoch += 1;
            state.revision += 1;
            state.projection = json!({"revision":state.revision,"available":false,"provider":provider,"snapshot":null});
        }
        Ok(state.projection.clone())
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("Radio telemetry has stopped.".into());
        }
        self.state
            .lock()
            .map(|state| state.projection.clone())
            .map_err(|_| "Radio telemetry unavailable".into())
    }
    pub fn control(self: &Arc<Self>) -> Result<ControlFence, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Radio telemetry unavailable")?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Radio telemetry has stopped.".into());
        }
        state.epoch += 1;
        state.controls += 1;
        // A new subscriber must not mistake a pre-command observation for current.
        state.projection["available"] = json!(false);
        Ok(ControlFence(self.clone()))
    }
    fn refresh(&self) {
        let Ok(_reading) = self.reading.try_lock() else {
            return;
        };
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let (provider, epoch, request) = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if state.controls != 0 {
                return;
            }
            let Some(provider) = state.provider.clone() else {
                return;
            };
            state.revision += 1;
            let id = format!("radio-telemetry-{}", state.revision);
            let request = if provider == "hamlib" {
                json!({"id":id,"method":"hamlib_snapshot","params":{"device":"radio"}})
            } else {
                json!({"id":id,"method":"station_snapshot","params":{"provider":provider}})
            };
            (provider, state.epoch, request)
        };
        let id = request["id"].clone();
        let response = (self.read)(request);
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        // Control completion, provider changes and shutdown fence late reads.
        if state.epoch != epoch
            || state.controls != 0
            || state.provider.as_deref() != Some(&provider)
        {
            return;
        }
        let result = response
            .ok()
            .filter(|reply| reply["ok"] == true && reply["id"] == id)
            .map(|reply| reply["result"].clone())
            .filter(|value| {
                value.is_object() && (provider == "hamlib" || value["source"] == provider)
            });
        let available = result.is_some();
        let snapshot = result.unwrap_or_else(|| state.projection["snapshot"].clone());
        state.projection = json!({"revision":state.revision,"provider":provider,"snapshot":snapshot,"available":available,
            "received_at_ms":SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0)});
        let projection = state.projection.clone();
        drop(state);
        if !self.stopped.load(Ordering::Acquire) {
            (self.publish)(projection);
        }
    }
    fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let owner = self.clone();
        std::thread::spawn(move || {
            while !owner.stopped.load(Ordering::Acquire) {
                owner.refresh();
                let period = owner
                    .state
                    .lock()
                    .ok()
                    .map(|state| {
                        if state.provider.as_deref() == Some("hamlib") {
                            1000
                        } else {
                            250
                        }
                    })
                    .unwrap_or(1000);
                let Ok(guard) = owner.wake.0.lock() else {
                    break;
                };
                let _ =
                    owner
                        .wake
                        .1
                        .wait_timeout_while(guard, Duration::from_millis(period), |_| {
                            !owner.stopped.load(Ordering::Acquire)
                        });
            }
        });
    }
    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.wake.1.notify_all();
    }
}
pub struct ControlFence(Arc<StationTelemetry>);
impl Drop for ControlFence {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.epoch += 1;
            state.controls = state.controls.saturating_sub(1);
        }
    }
}
static OWNER: OnceLock<Arc<StationTelemetry>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<StationTelemetry>, String> {
    if STOPPED.load(Ordering::Acquire) {
        return Err("Radio telemetry has stopped.".into());
    }
    let owner = OWNER
        .get_or_init(|| {
            let app = app.clone();
            Arc::new(StationTelemetry::new(
                Arc::new(|request| {
                    if request["method"] == "hamlib_snapshot" {
                        crate::hamlib::request(request)
                    } else {
                        crate::worker::request(request)
                    }
                }),
                Arc::new(move |value| {
                    for label in ["main", "monitor"] {
                        let _ = app.emit_to(
                            label,
                            "xlog:station-telemetry",
                            json!({"revision":value["revision"]}),
                        );
                    }
                }),
            ))
        })
        .clone();
    if STOPPED.load(Ordering::Acquire) {
        owner.stop();
        return Err("Radio telemetry has stopped.".into());
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
    fn reply(request: &Value) -> Value {
        json!({"id":request["id"],"ok":true,"result":{"source":request["params"]["provider"],"radio":{"observed":false}}})
    }
    #[test]
    fn scopes_and_providers_are_explicit() {
        assert!(validate("main", false, true).is_ok());
        assert!(validate("monitor", false, false).is_ok());
        assert!(validate("monitor", false, true).is_err());
        assert!(validate("main", true, false).is_err());
        assert!(validate("logbook", false, false).is_err());
        assert!(!valid_provider("other"));
    }
    #[test]
    fn reads_are_passive_and_startup_cannot_reverse_handover() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let observed = calls.clone();
        let owner = StationTelemetry::new(
            Arc::new(move |request| {
                observed.lock().unwrap().push(request.clone());
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        );
        owner.refresh();
        assert!(calls.lock().unwrap().is_empty());
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        owner.select("hamlib", false).unwrap();
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        let reads = calls.lock().unwrap();
        assert_eq!(reads.len(), 2);
        assert_eq!(reads[0]["method"], "station_snapshot");
        assert_eq!(reads[1]["method"], "hamlib_snapshot");
        assert_eq!(reads[1]["params"], json!({"device":"radio"}));
        assert_eq!(owner.snapshot().unwrap()["provider"], "hamlib");
    }
    #[test]
    fn command_fence_blocks_polling_until_all_controls_finish() {
        let count = Arc::new(Mutex::new(0));
        let calls = count.clone();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                *calls.lock().unwrap() += 1;
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        ));
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        let first = owner.control().unwrap();
        let second = owner.control().unwrap();
        assert_eq!(owner.snapshot().unwrap()["available"], false);
        owner.refresh();
        drop(first);
        owner.refresh();
        assert_eq!(*count.lock().unwrap(), 1);
        drop(second);
        owner.refresh();
        assert_eq!(*count.lock().unwrap(), 2);
    }
    #[test]
    fn late_pre_command_and_pre_handover_reads_are_discarded() {
        for handover in [false, true] {
            let gate = Arc::new((Mutex::new(false), Condvar::new()));
            let waiting = gate.clone();
            let (sent, received) = std::sync::mpsc::channel();
            let events = Arc::new(Mutex::new(0));
            let count = events.clone();
            let owner = Arc::new(StationTelemetry::new(
                Arc::new(move |request| {
                    sent.send(()).unwrap();
                    let _guard = waiting
                        .1
                        .wait_while(waiting.0.lock().unwrap(), |done| !*done)
                        .unwrap();
                    Ok(reply(&request))
                }),
                Arc::new(move |_| {
                    *count.lock().unwrap() += 1;
                }),
            ));
            owner.select("direct_agent", true).unwrap();
            let source = owner.clone();
            let thread = std::thread::spawn(move || source.refresh());
            received.recv_timeout(Duration::from_secs(2)).unwrap();
            if handover {
                owner.select("direct_flex_lan", false).unwrap();
            } else {
                drop(owner.control().unwrap());
            }
            *gate.0.lock().unwrap() = true;
            gate.1.notify_all();
            thread.join().unwrap();
            assert_eq!(*events.lock().unwrap(), 0);
            assert_eq!(owner.snapshot().unwrap()["available"], false);
        }
    }
    #[test]
    fn failure_retains_display_data_and_stopped_owner_cannot_restart() {
        let fail = Arc::new(AtomicBool::new(false));
        let failing = fail.clone();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                if failing.load(Ordering::Relaxed) {
                    Err("offline".into())
                } else {
                    Ok(reply(&request))
                }
            }),
            Arc::new(|_| {}),
        ));
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        let prior = owner.snapshot().unwrap();
        fail.store(true, Ordering::Relaxed);
        owner.refresh();
        let current = owner.snapshot().unwrap();
        assert_eq!(current["available"], false);
        assert_eq!(current["snapshot"], prior["snapshot"]);
        owner.stop();
        owner.start();
        owner.refresh();
        assert!(owner.snapshot().is_err());
        assert!(owner.control().is_err());
    }
    #[test]
    fn write_classification_excludes_readbacks_and_rotor() {
        for method in [
            "station_tune",
            "station_connect",
            "station_disconnect",
            "station_radio_control",
            "station_configuration_save",
        ] {
            assert!(changes_radio(&json!({"method":method,"params":{}})));
        }
        for method in [
            "station_snapshot",
            "station_radio",
            "station_capabilities",
            "station_rotor_stop",
            "rotor_goto",
        ] {
            assert!(!changes_radio(&json!({"method":method,"params":{}})));
        }
        assert!(changes_radio(
            &json!({"method":"hamlib_control","params":{"device":"radio"}})
        ));
        assert!(!changes_radio(
            &json!({"method":"hamlib_control","params":{"device":"rotor"}})
        ));
    }

    #[test]
    fn repeated_start_owns_one_loop_and_snapshot_reads_do_not_poll() {
        let (sent, received) = std::sync::mpsc::channel();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                sent.send(()).unwrap();
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        ));
        owner.select("hamlib", true).unwrap();
        for _ in 0..20 {
            owner.snapshot().unwrap();
        }
        assert!(received.try_recv().is_err());
        for _ in 0..20 {
            owner.start();
        }
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.stop();
        assert!(received.recv_timeout(Duration::from_millis(50)).is_err());
    }

    #[test]
    fn shutdown_rejects_inflight_reads_and_never_publishes_them() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let waiting = gate.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let events = Arc::new(Mutex::new(0));
        let published = events.clone();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                sent.send(()).unwrap();
                let _guard = waiting
                    .1
                    .wait_while(waiting.0.lock().unwrap(), |done| !*done)
                    .unwrap();
                Ok(reply(&request))
            }),
            Arc::new(move |_| {
                *published.lock().unwrap() += 1;
            }),
        ));
        owner.select("direct_agent", true).unwrap();
        let running = owner.clone();
        let thread = std::thread::spawn(move || running.refresh());
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.refresh();
        owner.stop();
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        thread.join().unwrap();
        assert_eq!(*events.lock().unwrap(), 0);
        assert!(owner.select("hamlib", false).is_err());
    }
}
