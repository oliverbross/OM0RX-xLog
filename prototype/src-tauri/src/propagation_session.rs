//! One native projection/refresh bridge to the existing injected Swift public
//! conditions service. No periodic fetch, device authority or second downloader.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

type Fetch = dyn Fn() -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn() + Send + Sync;
struct State { revision: u64, pending: bool, snapshot: Value, error: String, stopped: bool }
pub struct Session { epoch: String, state: Mutex<State>, fetch: Arc<Fetch>, publish: Arc<Publish> }
pub fn validate(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if isolated || exiting || !matches!(label, "main" | "propagation") {
        return Err("Shared propagation is available only in the live Desk or Propagation window.".into());
    }
    Ok(())
}
impl Session {
    fn new(fetch: Arc<Fetch>, publish: Arc<Publish>) -> Self {
        Self { epoch: uuid::Uuid::new_v4().to_string(), fetch, publish,
            state: Mutex::new(State { revision: 0, pending: false, snapshot: Value::Null, error: String::new(), stopped: false }) }
    }
    fn projection(&self, state: &State) -> Value {
        json!({"epoch":self.epoch,"revision":state.revision,"pending":state.pending,"snapshot":state.snapshot,"error":state.error})
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Propagation session unavailable")?;
        if state.stopped { return Err("Propagation has stopped.".into()); }
        Ok(self.projection(&state))
    }
    /// Call only after explicit operator intent, outside the UI thread. A
    /// concurrent refresh observes the same pending request, never another fetch.
    pub fn refresh(&self) -> Result<Value, String> {
        {
            let mut state = self.state.lock().map_err(|_| "Propagation session unavailable")?;
            if state.stopped { return Err("Propagation has stopped.".into()); }
            if state.pending { return Ok(self.projection(&state)); }
            if state.revision >= 9_007_199_254_740_990 { return Err("Propagation revision exhausted; restart the application.".into()); }
            state.pending = true; state.error.clear(); state.revision += 1;
        }
        (self.publish)();
        let result = (self.fetch)().and_then(checked_snapshot);
        let value = {
            let mut state = self.state.lock().map_err(|_| "Propagation session unavailable")?;
            if state.stopped { return Err("Propagation stopped; its late refresh was discarded.".into()); }
            state.pending = false; state.revision += 1;
            match result {
                Ok(snapshot) => {
                    state.error = if snapshot["stale"] == true { "Propagation refresh unavailable; last observation retained.".into() } else { String::new() };
                    state.snapshot = snapshot;
                }
                Err(error) => {
                    state.error = error;
                    if state.snapshot.is_object() { state.snapshot["stale"] = json!(true); }
                }
            }
            self.projection(&state)
        };
        (self.publish)(); Ok(value)
    }
    fn stop(&self) {
        if let Ok(mut state) = self.state.lock() { state.stopped = true; state.pending = false; }
    }
}
fn checked_snapshot(value: Value) -> Result<Value, String> {
    let invalid = || "Propagation refresh returned no verifiable observation. No new values were published.".to_string();
    let number = |key: &str| value[key].is_null() || value[key].as_f64().is_some_and(|value| value.is_finite() && (0.0..=9_007_199_254_740_991.0).contains(&value));
    let text = |value: &Value, limit: usize| value.as_str().is_some_and(|value| value.len() <= limit && !value.chars().any(char::is_control));
    if value["source"] != "N0NBH / HamQSL" || !value["stale"].is_boolean() || !text(&value["status"], 256)
        || !value["received_at"].as_f64().is_some_and(|value| value.is_finite() && value >= 0.0)
        || !["updated_at", "solar_flux", "a_index", "k_index"].iter().all(|key| number(key))
        || !text(&value["x_ray"], 64)
        || !value["bands"].as_array().is_some_and(|bands| (1..=16).contains(&bands.len()) && bands.iter().all(|band|
            text(&band["name"], 40) && ["day", "night"].iter().all(|key| matches!(band[*key].as_str(), Some("good" | "fair" | "poor" | "closed" | "unknown"))))) {
        return Err(invalid());
    }
    let mut projection = serde_json::Map::new();
    for key in ["status", "source", "stale", "updated_at", "received_at", "solar_flux", "a_index", "k_index", "x_ray", "bands"] {
        projection.insert(key.into(), value[key].clone());
    }
    Ok(Value::Object(projection))
}
static OWNER: OnceLock<Arc<Session>> = OnceLock::new();
static STOPPED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<Session>, String> {
    if STOPPED.load(std::sync::atomic::Ordering::Acquire) { return Err("Propagation has stopped.".into()); }
    let owner = OWNER.get_or_init(|| {
        let app = app.clone();
        Arc::new(Session::new(Arc::new(|| {
            let generation = crate::worker::generation();
            crate::worker::require_existing_generation(generation).map_err(|_| "Open Desk to initialize the workspace, then refresh propagation.")?;
            let id = uuid::Uuid::new_v4().to_string();
            let reply = crate::worker::request_existing_generation(json!({"id":id,"method":"propagation_refresh","params":{}}), generation)
                .map_err(|_| "Propagation refresh unavailable; no request was replayed.")?;
            crate::worker::require_existing_generation(generation).map_err(|_| "The workspace service changed; the old propagation reply was discarded.")?;
            if reply["id"] != id || reply["ok"] != true { return Err("Propagation refresh unavailable; no request was replayed.".into()); }
            Ok(reply["result"].clone())
        }), Arc::new(move || {
            for label in ["main", "propagation"] { let _ = app.emit_to(label, "xlog:propagation", ()); }
        })))
    }).clone();
    if STOPPED.load(std::sync::atomic::Ordering::Acquire) { owner.stop(); return Err("Propagation has stopped.".into()); }
    Ok(owner)
}
pub fn shutdown() {
    STOPPED.store(true, std::sync::atomic::Ordering::Release);
    if let Some(owner) = OWNER.get() { owner.stop(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::{AtomicUsize, Ordering}, mpsc};
    fn data() -> Value { json!({"status":"Current","source":"N0NBH / HamQSL","stale":false,"received_at":1000,"updated_at":900,
        "solar_flux":122,"a_index":13,"k_index":1,"x_ray":"A1","bands":[{"name":"20m","day":"good","night":"fair"}]}) }
    #[test]
    fn passive_reads_and_scope_cannot_fetch_or_grant_device_authority() {
        let owner = Session::new(Arc::new(|| panic!("passive mount fetched")), Arc::new(|| {}));
        for _ in 0..20 { assert_eq!(owner.snapshot().unwrap()["revision"], 0); }
        for label in ["main", "propagation", "station-control", "monitor", "settings", "unknown"] {
            assert_eq!(validate(label, false, false).is_ok(), matches!(label, "main" | "propagation"));
            assert!(validate(label, true, false).is_err()); assert!(validate(label, false, true).is_err());
        }
    }
    #[test]
    fn explicit_concurrent_refreshes_have_one_fetch_and_shared_terminal_projection() {
        let (entered, wait) = mpsc::channel(); let (release, resume) = mpsc::channel(); let gate = Mutex::new(resume);
        let calls = Arc::new(AtomicUsize::new(0)); let count = calls.clone();
        let owner = Arc::new(Session::new(Arc::new(move || {
            count.fetch_add(1, Ordering::SeqCst); entered.send(()).unwrap(); gate.lock().unwrap().recv_timeout(std::time::Duration::from_secs(5)).unwrap(); Ok(data())
        }), Arc::new(|| {})));
        let running = owner.clone(); let job = std::thread::spawn(move || running.refresh()); wait.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        for _ in 0..20 { assert_eq!(owner.refresh().unwrap()["pending"], true); }
        assert_eq!(calls.load(Ordering::SeqCst), 1); release.send(()).unwrap();
        assert_eq!(job.join().unwrap().unwrap(), owner.snapshot().unwrap());
        assert_eq!(owner.snapshot().unwrap()["snapshot"]["solar_flux"], 122);
    }
    #[test]
    fn failed_refresh_retains_timestamps_without_replay_and_shutdown_discards_late_results() {
        let calls = Arc::new(AtomicUsize::new(0)); let count = calls.clone();
        let owner = Session::new(Arc::new(move || if count.fetch_add(1, Ordering::SeqCst) == 0 { Ok(data()) } else { Err("offline".into()) }), Arc::new(|| {}));
        let good = owner.refresh().unwrap(); let failed = owner.refresh().unwrap();
        assert_eq!(failed["snapshot"]["received_at"], good["snapshot"]["received_at"]); assert_eq!(failed["snapshot"]["stale"], true);
        for _ in 0..20 { owner.snapshot().unwrap(); } assert_eq!(calls.load(Ordering::SeqCst), 2);
        let (entered, wait) = mpsc::channel(); let (release, resume) = mpsc::channel(); let gate = Mutex::new(resume);
        let published = Arc::new(AtomicUsize::new(0)); let notices = published.clone();
        let owner = Arc::new(Session::new(Arc::new(move || { entered.send(()).unwrap(); gate.lock().unwrap().recv_timeout(std::time::Duration::from_secs(5)).unwrap(); Ok(data()) }),
            Arc::new(move || { notices.fetch_add(1, Ordering::SeqCst); })));
        let running = owner.clone(); let job = std::thread::spawn(move || running.refresh()); wait.recv_timeout(std::time::Duration::from_secs(2)).unwrap(); owner.stop(); release.send(()).unwrap();
        assert!(job.join().unwrap().is_err()); assert!(owner.snapshot().is_err()); assert_eq!(published.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn malformed_source_data_is_not_published_and_projection_contains_only_public_fields() {
        for field in ["source", "stale", "received_at", "bands"] {
            let mut value = data(); value[field] = Value::Null; assert!(checked_snapshot(value).is_err(), "{field}");
        }
        let mut value = data(); value["private"] = json!("not a projection field");
        assert!(checked_snapshot(value).unwrap().get("private").is_none());
    }
}
