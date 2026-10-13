//! One read-only rotor poller for the application lifetime, not per webview.
//! Explicit command readbacks still go directly through the rotor coordinator.
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

type Read = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn(Value) + Send + Sync;

pub fn validate(label: &str, isolated: bool) -> Result<(), String> {
    if isolated || !matches!(label, "main" | "monitor") {
        return Err("Rotor telemetry is unavailable in this window.".into());
    }
    Ok(())
}

pub struct RotorTelemetry {
    read: Arc<Read>,
    publish: Arc<Publish>,
    projection: Mutex<Value>,
    reading: Mutex<()>,
    started: AtomicBool,
    stopped: AtomicBool,
    sequence: AtomicU64,
    wake: (Mutex<()>, Condvar),
}

impl RotorTelemetry {
    fn new(read: Arc<Read>, publish: Arc<Publish>) -> Self {
        Self {
            read,
            publish,
            projection: Mutex::new(json!({"revision":0,"available":false,"snapshot":null})),
            reading: Mutex::new(()),
            started: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            wake: (Mutex::new(()), Condvar::new()),
        }
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("Rotor telemetry has stopped.".into());
        }
        self.projection
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Rotor telemetry unavailable.".into())
    }

    fn refresh(&self) {
        let Ok(_read) = self.reading.try_lock() else {
            return;
        };
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let revision = self.sequence.fetch_add(1, Ordering::AcqRel) + 1;
        let id = format!("rotor-telemetry-{revision}");
        let result = (self.read)(json!({"id":id,"method":"rotor_snapshot","params":{}}));
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let snapshot = result
            .ok()
            .filter(|reply| reply["id"] == id && reply["ok"] == true)
            .map(|reply| reply["result"].clone())
            .filter(valid_snapshot);
        let available = snapshot.is_some();
        if let Ok(mut state) = self.projection.lock() {
            // Keep last-good position for display only; unavailable fences control.
            let retained = snapshot.unwrap_or_else(|| state["snapshot"].clone());
            *state = json!({"revision":revision,"available":available,"snapshot":retained,
                "received_at_ms":SystemTime::now().duration_since(UNIX_EPOCH).map(|age| age.as_millis() as u64).unwrap_or(0)});
            let value = state.clone();
            drop(state);
            if !self.stopped.load(Ordering::Acquire) {
                (self.publish)(value);
            }
        }
    }

    fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let owner = Arc::clone(self);
        std::thread::spawn(move || {
            while !owner.stopped.load(Ordering::Acquire) {
                owner.refresh();
                let Ok(guard) = owner.wake.0.lock() else {
                    break;
                };
                let _ = owner
                    .wake
                    .1
                    .wait_timeout_while(guard, Duration::from_secs(1), |_| {
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

fn valid_snapshot(value: &Value) -> bool {
    value.get("owner").is_some()
        && (value["owner"].is_null()
            || matches!(value["owner"].as_str(), Some("native_dcu1" | "hamlib")))
        && value["generation"]
            .as_u64()
            .is_some_and(|generation| generation <= 9_007_199_254_740_991)
        && matches!(
            value["state"].as_str(),
            Some("active" | "uncertain" | "disconnected")
        )
}

static OWNER: OnceLock<Arc<RotorTelemetry>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<RotorTelemetry>, String> {
    if STOPPED.load(Ordering::Acquire) {
        return Err("Rotor telemetry has stopped.".into());
    }
    let owner = OWNER
        .get_or_init(|| {
            let app = app.clone();
            Arc::new(RotorTelemetry::new(
                Arc::new(crate::rotor::request),
                Arc::new(move |value| {
                    for label in ["main", "monitor"] {
                        let _ = app.emit_to(label, "xlog:rotor-telemetry", &value);
                    }
                }),
            ))
        })
        .clone();
    if STOPPED.load(Ordering::Acquire) {
        owner.stop();
        return Err("Rotor telemetry has stopped.".into());
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
        json!({"id":request["id"],"ok":true,"result":{"owner":null,"generation":0,"state":"disconnected"}})
    }
    #[test]
    fn only_live_station_views_may_subscribe() {
        for label in ["main", "monitor"] {
            assert!(validate(label, false).is_ok());
            assert!(validate(label, true).is_err());
        }
        for label in ["logbook", "dx-cluster", "world-map", "band-maps", "unknown"] {
            assert!(validate(label, false).is_err());
        }
    }
    #[test]
    fn snapshot_reads_never_poll_or_write() {
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let owner = RotorTelemetry::new(
            Arc::new(move |request| {
                count.fetch_add(1, Ordering::Relaxed);
                assert_eq!(request["method"], "rotor_snapshot");
                assert_eq!(request["params"], json!({}));
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        );
        for _ in 0..20 {
            assert_eq!(owner.snapshot().unwrap()["revision"], 0);
        }
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        owner.refresh();
        for _ in 0..20 {
            assert_eq!(owner.snapshot().unwrap()["available"], true);
        }
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }
    #[test]
    fn failed_reads_retain_last_good_but_remove_availability() {
        let fail = Arc::new(AtomicBool::new(false));
        let source = fail.clone();
        let owner = RotorTelemetry::new(
            Arc::new(move |request| {
                if source.load(Ordering::Relaxed) {
                    Err("offline".into())
                } else {
                    Ok(reply(&request))
                }
            }),
            Arc::new(|_| {}),
        );
        owner.refresh();
        let good = owner.snapshot().unwrap();
        fail.store(true, Ordering::Relaxed);
        owner.refresh();
        let stale = owner.snapshot().unwrap();
        assert_eq!(stale["available"], false);
        assert_eq!(stale["snapshot"], good["snapshot"]);
        assert_eq!(stale["revision"], 2);
    }
    #[test]
    fn malformed_and_uncorrelated_replies_are_unavailable() {
        for response in [
            json!({"ok":true,"id":"wrong"}),
            json!({"result":{"owner":"other","generation":0,"state":"active"}}),
        ] {
            let owner =
                RotorTelemetry::new(Arc::new(move |_| Ok(response.clone())), Arc::new(|_| {}));
            owner.refresh();
            assert_eq!(owner.snapshot().unwrap()["available"], false);
        }
        for snapshot in [
            json!({"generation":0,"state":"active"}),
            json!({"owner":"other","generation":0,"state":"active"}),
            json!({"owner":null,"generation":-1,"state":"active"}),
            json!({"owner":null,"generation":9_007_199_254_740_992u64,"state":"active"}),
            json!({"owner":null,"generation":0,"state":"unknown"}),
        ] {
            assert!(!valid_snapshot(&snapshot));
        }
    }
    #[test]
    fn shutdown_discards_inflight_response_without_publishing() {
        let (started, received) = std::sync::mpsc::channel();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let waiting = gate.clone();
        let publications = Arc::new(AtomicU64::new(0));
        let events = publications.clone();
        let owner = Arc::new(RotorTelemetry::new(
            Arc::new(move |request| {
                started.send(()).unwrap();
                let _guard = waiting
                    .1
                    .wait_while(waiting.0.lock().unwrap(), |released| !*released)
                    .unwrap();
                Ok(reply(&request))
            }),
            Arc::new(move |_| {
                events.fetch_add(1, Ordering::Relaxed);
            }),
        ));
        let running = owner.clone();
        let thread = std::thread::spawn(move || running.refresh());
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.refresh(); // No queued second read behind a slow backend.
        owner.stop();
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        thread.join().unwrap();
        assert!(owner.snapshot().is_err());
        assert_eq!(publications.load(Ordering::Relaxed), 0);
    }
    #[test]
    fn repeated_start_has_one_polling_owner() {
        let (sent, received) = std::sync::mpsc::channel();
        let owner = Arc::new(RotorTelemetry::new(
            Arc::new(move |request| {
                sent.send(()).unwrap();
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        ));
        for _ in 0..25 {
            owner.start();
        }
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.stop();
        assert!(received.recv_timeout(Duration::from_millis(50)).is_err());
    }
}
