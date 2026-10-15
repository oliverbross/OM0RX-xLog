//! Wake-driven automatic following. One running lookup and one dirty/latest
//! follow-up, independent of renderer lifetime; no timer or new transport.
use serde_json::Value;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, OnceLock};
use tauri::Emitter;

type Work = dyn Fn() -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn(Result<Value, String>) + Send + Sync;
#[derive(Default)]
struct State { running: bool, dirty: bool, stopped: bool }
struct Reconciler { state: Mutex<State>, publication: Mutex<()>, work: Arc<Work>, publish: Arc<Publish> }
impl Reconciler {
    fn new(work: Arc<Work>, publish: Arc<Publish>) -> Self {
        Self { state: Mutex::new(State::default()), publication: Mutex::new(()), work, publish }
    }
    fn request(self: &Arc<Self>, spawn: impl FnOnce(Arc<Self>)) {
        let Ok(mut state) = self.state.lock() else { return; };
        if state.stopped { return; }
        state.dirty = true;
        if state.running { return; }
        state.running = true;
        drop(state); spawn(self.clone());
    }
    fn drain(&self) {
        loop {
            {
                let Ok(mut state) = self.state.lock() else { return; };
                if state.stopped { state.running = false; state.dirty = false; return; }
                state.dirty = false;
            }
            // Provider/worker/lookup work is outside every metadata lock.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (self.work)()))
                .unwrap_or_else(|_| Err("Automatic rotor reconciliation task failed.".into()));
            {
                // Stop serializes only short metadata publication, never waits
                // for a blocked lookup/driver. No late event follows shutdown.
                let Ok(_publication) = self.publication.lock() else { return; };
                let Ok(mut state) = self.state.lock() else { return; };
                if state.stopped { state.running = false; state.dirty = false; return; }
                drop(state); (self.publish)(result);
            }
            let Ok(mut state) = self.state.lock() else { return; };
            if state.stopped { state.running = false; state.dirty = false; return; }
            if !state.dirty { state.running = false; return; }
        }
    }
    fn shutdown(&self) {
        let Ok(_publication) = self.publication.lock() else { return; };
        if let Ok(mut state) = self.state.lock() { state.stopped = true; state.dirty = false; }
    }
}

static OWNER: OnceLock<Arc<Reconciler>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);
pub fn request(app: &tauri::AppHandle) {
    if STOPPED.load(Ordering::Acquire) { return; }
    let owner = OWNER.get_or_init(|| {
        let app = app.clone();
        Arc::new(Reconciler::new(Arc::new(|| {
            let epoch = crate::auto_rotor::snapshot()?["epoch"].as_u64().ok_or("Automatic rotor epoch is unavailable")?;
            let result = crate::spot_activation_backend::reconcile_auto();
            if let Err(error) = &result { crate::auto_rotor::note_reconcile_error(epoch, error); }
            result
        }), Arc::new(move |result| {
            if let Err(error) = result { eprintln!("Automatic rotor reconciliation unavailable: {error}"); }
            for label in crate::auto_rotor::CLIENT_WINDOWS { let _ = app.emit_to(label, "xlog:auto-rotor", ()); }
        })))
    });
    if STOPPED.load(Ordering::Acquire) { owner.shutdown(); return; }
    owner.request(|owner| { tauri::async_runtime::spawn_blocking(move || owner.drain()); });
}
pub fn shutdown() {
    STOPPED.store(true, Ordering::Release);
    if let Some(owner) = OWNER.get() { owner.shutdown(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{sync::{atomic::AtomicUsize, mpsc}, time::Duration};

    #[test]
    fn many_wakes_while_lookup_is_blocked_drain_exactly_one_latest_followup() {
        let latest = Arc::new(AtomicUsize::new(0)); let wanted = latest.clone();
        let runs = Arc::new(Mutex::new(Vec::new())); let recorded = runs.clone();
        let (entered, ready) = mpsc::channel(); let (release, released) = mpsc::channel();
        let released = Mutex::new(released); let publications = Arc::new(AtomicUsize::new(0)); let published = publications.clone();
        let owner = Arc::new(Reconciler::new(Arc::new(move || {
            let value = wanted.load(Ordering::Acquire); recorded.lock().unwrap().push(value);
            if value == 0 { entered.send(()).unwrap(); released.lock().unwrap().recv_timeout(Duration::from_secs(10)).unwrap(); }
            Ok(json!({"target":value}))
        }), Arc::new(move |_| { published.fetch_add(1, Ordering::AcqRel); })));
        let task = Mutex::new(None); owner.request(|owner| *task.lock().unwrap() = Some(std::thread::spawn(move || owner.drain())));
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        for value in 1..=100 { latest.store(value, Ordering::Release); owner.request(|_| panic!("parallel reconciliation spawned")); }
        assert_eq!(*runs.lock().unwrap(), [0]); release.send(()).unwrap();
        task.lock().unwrap().take().unwrap().join().unwrap();
        assert_eq!(*runs.lock().unwrap(), [0, 100]); assert_eq!(publications.load(Ordering::Acquire), 2);
    }
    #[test]
    fn shutdown_during_lookup_returns_without_waiting_and_suppresses_late_events() {
        let (entered, ready) = mpsc::channel(); let (release, released) = mpsc::channel(); let released = Mutex::new(released);
        let publications = Arc::new(AtomicUsize::new(0)); let published = publications.clone();
        let owner = Arc::new(Reconciler::new(Arc::new(move || {
            entered.send(()).unwrap(); released.lock().unwrap().recv_timeout(Duration::from_secs(10)).unwrap(); Ok(json!({}))
        }), Arc::new(move |_| { published.fetch_add(1, Ordering::AcqRel); })));
        let task = Mutex::new(None); owner.request(|owner| *task.lock().unwrap() = Some(std::thread::spawn(move || owner.drain())));
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        owner.request(|_| panic!("parallel task")); owner.shutdown();
        owner.request(|_| panic!("stopped task")); release.send(()).unwrap();
        task.lock().unwrap().take().unwrap().join().unwrap(); assert_eq!(publications.load(Ordering::Acquire), 0);
    }
    #[test]
    fn wake_during_error_publication_is_not_lost_and_does_not_start_parallel_work() {
        let runs = Arc::new(AtomicUsize::new(0)); let ran = runs.clone();
        let publications = Arc::new(AtomicUsize::new(0)); let published = publications.clone();
        let holder: Arc<Mutex<Option<std::sync::Weak<Reconciler>>>> = Arc::new(Mutex::new(None)); let listener = holder.clone();
        let owner = Arc::new(Reconciler::new(Arc::new(move || {
            if ran.fetch_add(1, Ordering::AcqRel) == 0 { Err("lookup failed".into()) } else { Ok(json!({})) }
        }), Arc::new(move |result| {
            if published.fetch_add(1, Ordering::AcqRel) == 0 {
                assert!(result.is_err());
                listener.lock().unwrap().as_ref().unwrap().upgrade().unwrap().request(|_| panic!("parallel task"));
            } else { assert!(result.is_ok()); }
        })));
        *holder.lock().unwrap() = Some(Arc::downgrade(&owner)); owner.request(|owner| owner.drain());
        assert_eq!(runs.load(Ordering::Acquire), 2); assert_eq!(publications.load(Ordering::Acquire), 2);
    }
}
