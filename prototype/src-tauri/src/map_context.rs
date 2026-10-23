//! Read-only composition of existing native owners. No station/cluster transport
//! or command loop belongs to a map window.
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type Read = dyn Fn() -> Result<Value, String> + Send + Sync;
static INVALIDATION: AtomicU64 = AtomicU64::new(0);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static CACHE: OnceLock<Metadata> = OnceLock::new();
static EPOCH: OnceLock<String> = OnceLock::new();
const WORKER_CHANGED: &str = "Worker generation changed while reading map metadata.";
fn next_revision() -> Result<u64, String> {
    SEQUENCE.fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| value.checked_add(1).filter(|next| *next <= 9_007_199_254_740_990))
        .map_err(|_| "Map context revision exhausted.".into())
}

pub fn validate(label: &str, isolated: bool) -> Result<(), String> {
    let label = crate::workspace_windows::surface_role(label);
    if isolated || !matches!(label, "main" | "world-map" | "band-maps" | "monitor" | "contest--world-map") {
        return Err("Map context is unavailable in this window.".into());
    }
    Ok(())
}

pub fn invalidate() { INVALIDATION.fetch_add(1, Ordering::AcqRel); }

/// Synchronous readers share one metadata refresh, not one per renderer or
/// radio tick. A restore/invalidation fences an in-flight old-workspace reply.
struct Metadata {
    read: Arc<Read>,
    cached: Mutex<Option<(u64, u64, Instant, Value)>>,
    reading: Mutex<()>,
}
impl Metadata {
    fn new(read: Arc<Read>) -> Self { Self { read, cached: Mutex::new(None), reading: Mutex::new(()) } }
    fn snapshot(&self, epoch: &AtomicU64, worker: impl Fn() -> u64) -> Result<(Value, u64), String> {
        let _reading = self.reading.lock().map_err(|_| "Map context unavailable")?;
        let generation = epoch.load(Ordering::Acquire);
        let worker_before = worker();
        if let Some((prior, prior_worker, received, value)) = self.cached.lock().map_err(|_| "Map context unavailable")?.as_ref() {
            if *prior == generation && *prior_worker == worker_before && received.elapsed() < Duration::from_secs(60) { return Ok((value.clone(), *prior_worker)); }
        }
        let value = (self.read)()?;
        // Never relabel a completed old-worker response as the replacement's
        // generation. Initial startup uses the same safe, bounded retry below.
        if worker() != worker_before { return Err(WORKER_CHANGED.into()); }
        if epoch.load(Ordering::Acquire) != generation { return Err("Map workspace changed while reading; refresh to retry.".into()); }
        if !value.is_object() || !value["generation"].is_string() || !value["preferences"].is_object()
            || !value["revision"].is_u64() || !value["dxccStatuses"].is_object() {
            return Err("Map metadata response could not be verified.".into());
        }
        *self.cached.lock().map_err(|_| "Map context unavailable")? = Some((generation, worker_before, Instant::now(), value.clone()));
        Ok((value, worker_before))
    }
}

pub fn snapshot(app: &tauri::AppHandle) -> Result<Value, String> {
    let invalidation = INVALIDATION.load(Ordering::Acquire);
    let cache = CACHE.get_or_init(|| Metadata::new(Arc::new(|| {
        let id = uuid::Uuid::new_v4().to_string();
        let response = crate::worker::request(json!({"id":id,"method":"workspace_map_context","params":{}}))?;
        if response["id"] != id || response["ok"] != true { return Err("Map workspace metadata is unavailable.".into()); }
        Ok(response["result"].clone())
    })));
    let (metadata, worker_generation) = match cache.snapshot(&INVALIDATION, crate::worker::generation) {
        // A first read may start the worker. Discard that response and verify a
        // second read entirely within the new generation; never retry a write.
        Err(error) if error == WORKER_CHANGED => cache.snapshot(&INVALIDATION, crate::worker::generation)?,
        result => result?,
    };
    // Sample cheap retained owners after any slow metadata read, never before.
    let cluster = crate::cluster_session::owner(app)?.projection_value()?;
    let selection = crate::station_selection::owner(app)?.snapshot()?;
    let telemetry = crate::station_telemetry::owner(app)?;
    let radio = telemetry.snapshot()?;
    let current_selection = crate::station_selection::owner(app)?.snapshot()?;
    let radio = matched_radio(&selection, &current_selection, radio)?;
    if INVALIDATION.load(Ordering::Acquire) != invalidation || crate::worker::generation() != worker_generation {
        return Err("Map workspace changed while reading; refresh to retry.".into());
    }
    let revision = next_revision()?;
    Ok(json!({"epoch":EPOCH.get_or_init(|| uuid::Uuid::new_v4().to_string()), "revision":revision,
        "metadata":metadata,"cluster":cluster,"selection":selection,"radio":radio}))
}

fn matched_radio(before: &Value, after: &Value, mut radio: Value) -> Result<Value, String> {
    if ["provider", "generation", "selection_id"].iter().any(|key| before[*key] != after[*key]) {
        return Err("Radio selection changed while reading map context; refresh to retry.".into());
    }
    if !before["provider"].is_string() || radio["provider"] != before["provider"]
        || radio["selection_id"] != before["selection_id"] || radio["selection_generation"] != before["generation"] {
        radio["available"] = json!(false); radio["snapshot"] = Value::Null;
    }
    Ok(radio)
}

/// Separate isolated adapter: it cannot obtain an AppHandle or reach any live
/// cluster/radio owner. Native process mode is checked again before worker I/O.
pub fn acceptance_snapshot() -> Result<Value, String> {
    if !crate::worker::local_acceptance() { return Err("Isolated map context is unavailable in a normal launch.".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    let response = crate::worker::request_existing(json!({"id":id,"method":"workspace_map_context","params":{}}))?;
    if response["id"] != id || response["ok"] != true { return Err("Isolated map metadata could not be verified.".into()); }
    Ok(json!({"epoch":"00000000-0000-4000-8000-000000000001","revision":next_revision()?,
        "acceptance":{"synthetic":true,"source":"isolated_local_worker","externalOwners":false},
        "metadata":response["result"],"cluster":{"revision":0,"available":true,"selected":null,
        "received_at_ms":SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as u64).unwrap_or(0),
        "response":{"snapshot":{"spots":[]},"configuration":{"palette":{}}}},
        "selection":{"provider":null,"generation":0},"radio":{"provider":null,"available":false,"snapshot":null}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value() -> Value { json!({"generation":"fixture", "revision":0,"preferences":{},"dxccStatuses":{}}) }
    #[test]
    fn map_scope_is_exact_and_isolation_never_starts_owners() {
        for label in ["main", "world-map", "band-maps", "monitor", "contest--world-map"] {
            assert!(validate(label, false).is_ok()); assert!(validate(label, true).is_err());
        }
        for label in ["log-qso", "spot-history", "dx-cluster", "unknown", ""] { assert!(validate(label, false).is_err()); }
    }
    #[test]
    fn isolated_adapter_rejects_a_normal_native_process_before_worker_access() {
        assert!(!crate::worker::local_acceptance());
        assert!(acceptance_snapshot().is_err());
    }
    #[test]
    fn repeated_readers_share_cache_and_invalidation_refreshes_once() {
        let count = Arc::new(AtomicU64::new(0)); let calls = count.clone();
        let cache = Metadata::new(Arc::new(move || { calls.fetch_add(1, Ordering::Relaxed); Ok(value()) }));
        let epoch = AtomicU64::new(0);
        for _ in 0..20 { cache.snapshot(&epoch, || 1).unwrap(); }
        assert_eq!(count.load(Ordering::Relaxed), 1);
        epoch.fetch_add(1, Ordering::AcqRel); cache.snapshot(&epoch, || 1).unwrap(); cache.snapshot(&epoch, || 1).unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 2);
        cache.snapshot(&epoch, || 2).unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 3);
    }
    #[test]
    fn invalidation_fences_a_late_reply_and_failures_are_not_cached() {
        let epoch = Arc::new(AtomicU64::new(0)); let changed = epoch.clone();
        let cache = Metadata::new(Arc::new(move || { changed.fetch_add(1, Ordering::AcqRel); Ok(value()) }));
        assert!(cache.snapshot(&epoch, || 1).is_err()); assert!(cache.cached.lock().unwrap().is_none());
        let bad = Metadata::new(Arc::new(|| Ok(json!({"preferences":{}}))));
        assert!(bad.snapshot(&epoch, || 1).is_err()); assert!(bad.cached.lock().unwrap().is_none());
    }
    #[test]
    fn passive_map_reads_cannot_reselect_or_publish_an_obsolete_provider() {
        let a = json!({"provider":"direct_agent","generation":1,"selection_id":"a"});
        let b = json!({"provider":"hamlib","generation":2,"selection_id":"b"});
        let radio = json!({"provider":"hamlib","available":true,"snapshot":{"fields":{}}});
        assert!(matched_radio(&a, &b, radio.clone()).is_err());
        assert_eq!(matched_radio(&a, &a, radio).unwrap()["available"], false);
        let a_again = json!({"provider":"direct_agent","generation":3,"selection_id":"new-a"});
        assert!(matched_radio(&a, &a_again, json!({})).is_err());
    }
    #[test]
    fn held_old_worker_metadata_cannot_be_cached_under_a_new_generation() {
        use std::sync::Condvar;
        let worker = Arc::new(AtomicU64::new(1)); let epoch = Arc::new(AtomicU64::new(0));
        let gate = Arc::new((Mutex::new(false), Condvar::new())); let wait = gate.clone();
        let (entered, received) = std::sync::mpsc::channel();
        let reads = Arc::new(AtomicU64::new(0)); let calls = reads.clone();
        let cache = Arc::new(Metadata::new(Arc::new(move || {
            let first = calls.fetch_add(1, Ordering::AcqRel) == 0;
            if first { entered.send(()).unwrap(); let _guard = wait.1.wait_while(wait.0.lock().unwrap(), |ready| !*ready).unwrap(); }
            let mut result = value(); result["generation"] = json!(if first { "old-workspace" } else { "new-workspace" }); Ok(result)
        })));
        let pending = cache.clone(); let pending_epoch = epoch.clone(); let pending_worker = worker.clone();
        let thread = std::thread::spawn(move || pending.snapshot(&pending_epoch, || pending_worker.load(Ordering::Acquire)));
        received.recv_timeout(Duration::from_secs(2)).unwrap(); worker.store(2, Ordering::Release);
        *gate.0.lock().unwrap() = true; gate.1.notify_all();
        assert_eq!(thread.join().unwrap().unwrap_err(), WORKER_CHANGED);
        assert!(cache.cached.lock().unwrap().is_none());
        let (fresh, generation) = cache.snapshot(&epoch, || worker.load(Ordering::Acquire)).unwrap();
        assert_eq!(generation, 2); assert_eq!(fresh["generation"], "new-workspace");
    }
}
