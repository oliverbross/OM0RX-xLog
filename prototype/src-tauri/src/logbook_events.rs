//! Invalidation only: receivers reload through their own scoped read methods.
//! Emit after possible writes, including errors after partial imports/sync.
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::Emitter;

type Read = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn() + Send + Sync;

/// One sequential completion channel for the application, independent of any
/// renderer. Renderer summary reads must not also feed its deduplication state:
/// an older concurrent response could otherwise roll the last token backwards.
pub struct SyncCompletionMonitor {
    read: Arc<Read>,
    publish: Arc<Publish>,
    observer: SyncCompletionObserver,
    interval: Duration,
    reading: Mutex<()>,
    stopped: Mutex<bool>,
    wake: Condvar,
    started: AtomicBool,
}

impl SyncCompletionMonitor {
    fn new(read: Arc<Read>, publish: Arc<Publish>, interval: Duration) -> Self {
        Self { read, publish, interval, observer: SyncCompletionObserver::default(), reading: Mutex::new(()),
            stopped: Mutex::new(false), wake: Condvar::new(), started: AtomicBool::new(false) }
    }

    fn is_stopped(&self) -> bool { self.stopped.lock().map(|stopped| *stopped).unwrap_or(true) }

    fn poll(&self) {
        let Ok(_reading) = self.reading.try_lock() else { return; };
        if self.is_stopped() { return; }
        let response = (self.read)(json!({"id":uuid::Uuid::new_v4().to_string(),"method":"sync_summary","params":{}}));
        // Serialize publication admission with stop; do not merely check an
        // atomic then emit. This metadata lock is NEVER held across worker I/O.
        let Ok(stopped) = self.stopped.lock() else { return; };
        if !*stopped && response.as_ref().is_ok_and(|value| self.observer.observe(value)) {
            (self.publish)();
        }
    }

    fn wait_next(&self) -> bool {
        let Ok(stopped) = self.stopped.lock() else { return false; };
        self.wake.wait_timeout_while(stopped, self.interval, |stopped| !*stopped)
            .map(|(stopped, _)| !*stopped).unwrap_or(false)
    }

    // The wait is injectable so tests advance logical ticks without sleeps.
    fn run(&self, wait: impl Fn(&Self) -> bool) {
        while !self.is_stopped() {
            self.poll();
            if !wait(self) { break; }
        }
    }

    fn start(self: &Arc<Self>) -> Result<(), String> {
        if self.is_stopped() { return Err("Sync completion monitor has stopped".into()); }
        if self.started.swap(true, Ordering::AcqRel) { return Ok(()); }
        let owner = self.clone();
        if std::thread::Builder::new().name("xlog-sync-completions".into())
            .spawn(move || owner.run(Self::wait_next)).is_err() {
            self.started.store(false, Ordering::Release);
            return Err("Could not start sync completion monitor".into());
        }
        Ok(())
    }

    fn stop(&self) {
        if let Ok(mut stopped) = self.stopped.lock() {
            *stopped = true;
            self.wake.notify_all();
        }
    }
}

static SYNC_MONITOR: OnceLock<Arc<SyncCompletionMonitor>> = OnceLock::new();

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let owner = SYNC_MONITOR.get_or_init(|| {
        let app = app.clone();
        Arc::new(SyncCompletionMonitor::new(Arc::new(crate::worker::request_existing), Arc::new(move || {
            // Wake only; recipients reconcile via their existing scoped reads.
            // No contact, settings, summary or credentials cross this event.
            for label in ["main", "log-qso", "logbook", "awards"] {
                let _ = app.emit_to(label, "xlog:logbook-changed", ());
            }
        }), Duration::from_secs(5)))
    });
    owner.start()
}

pub fn shutdown() {
    if let Some(owner) = SYNC_MONITOR.get() { owner.stop(); }
}

#[derive(Default)]
pub struct SyncCompletionObserver(std::sync::Mutex<SyncCompletion>);

#[derive(Default)]
struct SyncCompletion {
    last: Option<String>,
}

impl SyncCompletionObserver {
    /// A summary carries no contacts. Completed failures can still have pulled
    /// or pushed records, so their completion wakes readers too.
    pub fn observe(&self, response: &serde_json::Value) -> bool {
        if response["ok"] != true { return false; }
        let summary = &response["result"];
        let Ok(mut state) = self.0.lock() else { return false; };
        let token = summary["completion_id"].as_str().or_else(|| summary["finished_at"].as_str());
        let changed = summary["running"] == false && token.is_some()
            && state.last.as_deref() != token;
        if summary["running"] == false && token.is_some() {
            state.last = token.map(str::to_owned);
        }
        changed
    }
}

pub fn changes_logbook(request: &serde_json::Value) -> bool {
    let method = request["method"].as_str().unwrap_or("");
    if method == "logbook_operator_draft_apply" { return request["params"]["action"] == "save"; }
    matches!(method, "logbook_save" | "logbook_delete" | "logbook_undo" | "logbook_contact_apply"
        | "logbook_import_adif" | "backup_restore"
        | "sync_run" | "sync_resolve" | "sync_retry" | "workspace_create")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::sync::{atomic::AtomicUsize, mpsc};

    fn completed(token: &str, status: &str) -> Value {
        json!({"ok":true,"result":{"running":false,"completion_id":token,"status":status}})
    }

    #[test]
    fn monitor_reads_only_summary_and_wakes_once_for_success_partial_and_failed_completions() {
        let replies = Arc::new(Mutex::new(VecDeque::from([
            Ok(completed("a", "Completed")), Ok(completed("a", "Completed")),
            Err("temporary transport failure".into()),
            Ok(json!({"ok":false,"result":{"running":false,"completion_id":"b"}})),
            Ok(json!({"ok":true,"result":{"running":true,"completion_id":"b"}})),
            Ok(completed("b", "Completed with failures")), Ok(completed("b", "Completed with failures")),
            Ok(completed("c", "Failed")),
        ])));
        let published = Arc::new(AtomicUsize::new(0));
        let counts = published.clone();
        let seen = Arc::new(Mutex::new(Vec::new())); let requests = seen.clone();
        let owner = SyncCompletionMonitor::new(Arc::new(move |request| {
            assert_eq!(request["method"], "sync_summary"); assert_eq!(request["params"], json!({}));
            crate::worker::validate_request(&request).unwrap();
            requests.lock().unwrap().push(request["id"].as_str().unwrap().to_owned());
            replies.lock().unwrap().pop_front().unwrap()
        }), Arc::new(move || { counts.fetch_add(1, Ordering::AcqRel); }), Duration::ZERO);
        for expected in [1, 1, 1, 1, 1, 2, 2, 3] {
            owner.poll(); assert_eq!(published.load(Ordering::Acquire), expected);
        }
        let ids = seen.lock().unwrap();
        assert_eq!(ids.iter().collect::<std::collections::HashSet<_>>().len(), 8);
    }

    #[test]
    fn slow_read_never_overlaps_and_shutdown_does_not_wait_for_ipc_or_publish_its_late_result() {
        let (entered, reading) = mpsc::channel(); let (release, proceed) = mpsc::channel();
        let proceed = Mutex::new(proceed);
        let published = Arc::new(AtomicUsize::new(0)); let counts = published.clone();
        let owner = Arc::new(SyncCompletionMonitor::new(Arc::new(move |_| {
            entered.send(()).unwrap(); proceed.lock().unwrap().recv().unwrap(); Ok(completed("late", "Completed"))
        }), Arc::new(move || { counts.fetch_add(1, Ordering::AcqRel); }), Duration::from_secs(5)));
        let pending = owner.clone(); let reader = std::thread::spawn(move || pending.poll());
        reading.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.poll(); assert!(matches!(reading.try_recv(), Err(mpsc::TryRecvError::Empty)));
        let stopping = owner.clone(); let (stopped, done) = mpsc::channel();
        let stopper = std::thread::spawn(move || { stopping.stop(); stopped.send(()).unwrap(); });
        let prompt = done.recv_timeout(Duration::from_secs(2));
        release.send(()).unwrap(); reader.join().unwrap(); stopper.join().unwrap();
        assert!(prompt.is_ok(), "stop must not acquire the reading lock");
        assert_eq!(published.load(Ordering::Acquire), 0);
        owner.poll(); assert!(matches!(reading.try_recv(), Err(mpsc::TryRecvError::Empty)));
    }

    #[test]
    fn publication_admission_is_serialized_with_shutdown() {
        let (publishing, entered) = mpsc::channel(); let (release, proceed) = mpsc::channel(); let proceed = Mutex::new(proceed);
        let owner = Arc::new(SyncCompletionMonitor::new(Arc::new(|_| Ok(completed("admitted", "Completed"))),
            Arc::new(move || { publishing.send(()).unwrap(); proceed.lock().unwrap().recv().unwrap(); }), Duration::ZERO));
        let pending = owner.clone(); let reader = std::thread::spawn(move || pending.poll());
        entered.recv_timeout(Duration::from_secs(2)).unwrap();
        let stopping = owner.clone(); let (begin, starting) = mpsc::channel(); let (done, finished) = mpsc::channel();
        let stopper = std::thread::spawn(move || { begin.send(()).unwrap(); stopping.stop(); done.send(()).unwrap(); });
        starting.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(matches!(finished.try_recv(), Err(mpsc::TryRecvError::Empty)), "publication admitted before stop is ordered first");
        release.send(()).unwrap(); reader.join().unwrap(); stopper.join().unwrap();
        finished.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.poll(); assert!(matches!(entered.try_recv(), Err(mpsc::TryRecvError::Empty)));
    }

    #[test]
    fn logical_clock_schedules_only_after_a_response_and_retries_errors() {
        let reads = Arc::new(AtomicUsize::new(0)); let counts = reads.clone();
        let owner = SyncCompletionMonitor::new(Arc::new(move |_| {
            counts.fetch_add(1, Ordering::AcqRel); Err("existing worker unavailable".into())
        }), Arc::new(|| panic!("errors never publish")), Duration::from_secs(5));
        let ticks = AtomicUsize::new(0);
        owner.run(|monitor| {
            let tick = ticks.fetch_add(1, Ordering::AcqRel);
            assert_eq!(reads.load(Ordering::Acquire), tick + 1, "wait begins only after each completed read");
            if tick == 2 { monitor.stop(); }
            tick < 2
        });
        assert_eq!(reads.load(Ordering::Acquire), 3);
    }

    #[test]
    fn application_owner_starts_once_and_idle_wait_is_interruptible_and_terminal() {
        let (called, reads) = mpsc::channel();
        let owner = Arc::new(SyncCompletionMonitor::new(Arc::new(move |_| {
            called.send(()).unwrap(); Ok(json!({"ok":true,"result":{"running":false}}))
        }), Arc::new(|| {}), Duration::from_secs(3600)));
        owner.start().unwrap(); owner.start().unwrap();
        reads.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.stop(); assert!(owner.start().is_err()); drop(owner);
        // The read closure's sender drops only when the sole monitor thread exits.
        assert!(matches!(reads.recv_timeout(Duration::from_secs(2)), Err(mpsc::RecvTimeoutError::Disconnected)));
    }

    #[test]
    fn worker_replacement_errors_and_idle_summary_do_not_erase_deduplication() {
        let replies = Mutex::new(VecDeque::from([Ok(completed("old", "Completed")), Err("generation retired".into()),
            Ok(json!({"ok":true,"result":{"running":false}})), Ok(completed("old", "Completed")),
            Ok(completed("replacement", "Completed with failures")), Ok(completed("replacement", "Completed with failures"))]));
        let published = Arc::new(AtomicUsize::new(0)); let count = published.clone();
        let owner = SyncCompletionMonitor::new(Arc::new(move |_| replies.lock().unwrap().pop_front().unwrap()),
            Arc::new(move || { count.fetch_add(1, Ordering::AcqRel); }), Duration::ZERO);
        for expected in [1, 1, 1, 1, 2, 2] { owner.poll(); assert_eq!(published.load(Ordering::Acquire), expected); }
    }

    #[test]
    fn each_completion_wakes_once_including_partial_and_total_failures() {
        let observer = SyncCompletionObserver::default();
        let first = json!({"ok":true,"result":{"running":false,"completion_id":"old"}});
        assert!(observer.observe(&first), "A sync may finish before the first summary reaches the view");
        assert!(!observer.observe(&first));
        assert!(!observer.observe(&json!({"ok":true,"result":{"running":true}})));
        for (token, status) in [("a", "Completed"), ("b", "Completed with failures"), ("c", "Failed")] {
            let completed = json!({"ok":true,"result":{"running":false,"completion_id":token,"status":status,"finished_at":"same-second"}});
            assert!(observer.observe(&completed));
            assert!(!observer.observe(&completed));
        }
    }

    #[test]
    fn errors_and_running_results_never_invalidate_or_consume_a_completion() {
        let observer = SyncCompletionObserver::default();
        assert!(!observer.observe(&json!({"ok":true,"result":{"running":false}})));
        assert!(!observer.observe(&json!({"ok":false,"result":{"running":false,"completion_id":"new"}})));
        assert!(!observer.observe(&json!({"ok":true,"result":{"running":true,"completion_id":"new"}})));
        assert!(observer.observe(&json!({"ok":true,"result":{"running":false,"completion_id":"new"}})));
    }
    #[test]
    fn writes_invalidate_but_read_and_hardware_requests_do_not() {
        for method in ["logbook_save", "logbook_contact_apply", "logbook_import_adif", "backup_restore", "sync_run"] {
            assert!(changes_logbook(&json!({"method":method})));
        }
        for method in ["logbook_list", "logbook_contact", "logbook_contact_receipt", "lookup_call", "station_tune", "cluster_snapshot"] {
            assert!(!changes_logbook(&json!({"method":method})));
        }
        assert!(changes_logbook(&json!({"method":"logbook_operator_draft_apply","params":{"action":"save"}})));
        for action in ["edit", "clear", "reset", ""] {
            assert!(!changes_logbook(&json!({"method":"logbook_operator_draft_apply","params":{"action":action}})));
        }
    }
}
