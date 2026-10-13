//! One native owner for explicit opens and persisted-layout reconciliation.
//! Renderer panel lists are deliberately absent from this interface.
use crate::workspace_windows::{supports, Plan, WorkspaceWindowPlanner, SUPPORTED_WINDOWS};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Condvar, Mutex, OnceLock,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

const MAX_OPENS: usize = 32;
const MAX_SUPERSEDED: usize = 8;
static STOPPED: AtomicBool = AtomicBool::new(false);
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
static OWNER: OnceLock<Mutex<Option<Arc<Owner>>>> = OnceLock::new();
static LIFETIMES: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();

fn registry() -> &'static Mutex<Option<Arc<Owner>>> {
    OWNER.get_or_init(|| Mutex::new(None))
}
fn lifetimes() -> &'static Mutex<BTreeMap<String, u64>> {
    LIFETIMES.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn active() -> Result<(), String> {
    if STOPPED.load(Ordering::Acquire) {
        Err("The native workspace window owner has stopped.".into())
    } else {
        Ok(())
    }
}
fn idle() -> Value {
    json!({"supported":SUPPORTED_WINDOWS.iter().map(|window| window.id).collect::<Vec<_>>(),
        "generation":null,"revision":null,"presetID":null,"state":"idle","shown":[],"hidden":[],
        "error":"","stopped":STOPPED.load(Ordering::Acquire)})
}

struct PendingOpen {
    label: String,
    reply: mpsc::Sender<Result<(), String>>,
}
#[derive(Default)]
struct Queue {
    opens: VecDeque<PendingOpen>,
    refresh: Option<bool>,
    destroyed: BTreeMap<String, u64>,
    // Alternate work categories so continuous menu clicks cannot starve a wake.
    prefer_refresh: bool,
}
struct Owner {
    queue: Mutex<Queue>,
    wake: Condvar,
    outcome: Mutex<Value>,
    app: AppHandle,
}
enum Work {
    Open(PendingOpen),
    Refresh(bool),
    Destroyed(String, u64),
}
impl Queue {
    fn next(&mut self) -> Option<Work> {
        if let Some((label, token)) = self.destroyed.pop_first() {
            return Some(Work::Destroyed(label, token));
        }
        if self.prefer_refresh || self.opens.is_empty() {
            if let Some(force) = self.refresh.take() {
                self.prefer_refresh = false;
                return Some(Work::Refresh(force));
            }
        }
        if let Some(open) = self.opens.pop_front() {
            self.prefer_refresh = true;
            return Some(Work::Open(open));
        }
        self.refresh.take().map(Work::Refresh)
    }
    fn refresh(&mut self, force: bool) {
        self.refresh = Some(self.refresh.unwrap_or(false) || force);
    }
}
impl Owner {
    fn publish(&self, value: Value) {
        if let Ok(mut outcome) = self.outcome.lock() {
            *outcome = value;
        }
        // The payload is a wake only. Consumers read the native snapshot.
        let _ = self.app.emit("xlog:workspace-windows", ());
    }
    fn run(self: Arc<Self>) {
        let mut engine = Engine::default();
        let mut host = NativeHost {
            app: self.app.clone(),
        };
        loop {
            let work = {
                let Ok(mut queue) = self.queue.lock() else {
                    break;
                };
                while queue.opens.is_empty()
                    && queue.refresh.is_none()
                    && queue.destroyed.is_empty()
                    && !STOPPED.load(Ordering::Acquire)
                {
                    let Ok(next) = self.wake.wait(queue) else {
                        return;
                    };
                    queue = next;
                }
                if STOPPED.load(Ordering::Acquire) {
                    for open in queue.opens.drain(..) {
                        let _ = open
                            .reply
                            .send(Err("The native workspace window owner has stopped.".into()));
                    }
                    queue.refresh = None;
                    queue.destroyed.clear();
                    break;
                }
                queue.next()
            };
            match work {
                Some(Work::Open(open)) => {
                    let result = engine.open(&mut host, &open.label);
                    let _ = open.reply.send(result);
                }
                Some(Work::Refresh(force)) => {
                    engine.begin();
                    self.publish(engine.outcome.clone());
                    let _ = engine.reconcile(&mut host, force);
                    self.publish(engine.outcome.clone());
                }
                Some(Work::Destroyed(label, token)) => {
                    // A replacement can be created before an old callback is handled.
                    if let Ok(current) = lifetimes().lock() {
                        if destruction_is_current(&current, &label, token) {
                            engine.planner.forget_destroyed(&label);
                        }
                    }
                }
                None => {}
            }
        }
        engine.outcome["stopped"] = json!(true);
        if engine.outcome["state"] == "applying" {
            let _ = engine.fail("The native workspace window owner has stopped.".into());
        }
        self.publish(engine.outcome);
    }
    fn failed(&self) {
        STOPPED.store(true, Ordering::Release);
        // The registry deliberately keeps its owner: a failure must not spawn
        // another owner while old native work might still be unwinding.
        let mut queue = self.queue.lock().unwrap_or_else(|error| error.into_inner());
        for open in queue.opens.drain(..) {
            let _ = open
                .reply
                .send(Err("The native workspace window owner failed.".into()));
        }
        queue.refresh = None;
        queue.destroyed.clear();
        drop(queue);
        let mut outcome = self
            .outcome
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        outcome["state"] = json!("error");
        outcome["error"] = json!("The native workspace window owner failed.");
        outcome["stopped"] = json!(true);
        self.publish(outcome);
    }
}
fn owner(app: &AppHandle) -> Result<Arc<Owner>, String> {
    active()?;
    let mut registered = registry()
        .lock()
        .map_err(|_| "Native workspace window registry unavailable")?;
    active()?;
    if let Some(owner) = registered.as_ref() {
        return Ok(owner.clone());
    }
    let owner = Arc::new(Owner {
        queue: Mutex::new(Queue::default()),
        wake: Condvar::new(),
        outcome: Mutex::new(idle()),
        app: app.clone(),
    });
    let running = owner.clone();
    std::thread::Builder::new()
        .name("xlog-workspace-windows".into())
        .spawn(move || {
            let owner = running.clone();
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || owner.run())).is_err()
                || !STOPPED.load(Ordering::Acquire)
            {
                running.failed();
            }
        })
        .map_err(|error| format!("Native workspace window owner failed to start: {error}"))?;
    *registered = Some(owner.clone());
    Ok(owner)
}
/// Call from a blocking task; this waits for the one owner's explicit open.
pub fn open(app: &AppHandle, label: &str) -> Result<(), String> {
    if !supports(label) {
        return Err("Unknown native workspace window".into());
    }
    let owner = owner(app)?;
    let (reply, received) = mpsc::channel();
    {
        let mut queue = owner
            .queue
            .lock()
            .map_err(|_| "Native workspace window queue unavailable")?;
        active()?;
        if queue.opens.len() >= MAX_OPENS {
            return Err("Native workspace windows are busy; try again.".into());
        }
        queue.opens.push_back(PendingOpen {
            label: label.into(),
            reply,
        });
    }
    owner.wake.notify_one();
    received
        .recv()
        .map_err(|_| "Native workspace window owner unavailable".to_owned())?
}
/// Coalesce wakes, retaining an explicit force even if later passive wakes arrive.
pub fn refresh(app: &AppHandle, force: bool) -> Result<(), String> {
    let owner = owner(app)?;
    {
        let mut queue = owner
            .queue
            .lock()
            .map_err(|_| "Native workspace window queue unavailable")?;
        active()?;
        queue.refresh(force);
    }
    owner.wake.notify_one();
    Ok(())
}
/// Reading status is inert, including in isolated acceptance before its first layout operation.
pub fn status(_app: &AppHandle) -> Result<Value, String> {
    let owner = registry()
        .lock()
        .map_err(|_| "Native workspace window registry unavailable")?
        .clone();
    let mut value = if let Some(owner) = owner {
        owner
            .outcome
            .lock()
            .map_err(|_| "Native workspace window status unavailable")?
            .clone()
    } else {
        idle()
    };
    value["stopped"] = json!(STOPPED.load(Ordering::Acquire));
    Ok(value)
}
fn destruction_is_current(current: &BTreeMap<String, u64>, label: &str, token: u64) -> bool {
    current.get(label).is_none_or(|live| *live == token)
}
/// Register only newly built windows. Each real native lifetime gets its own token.
pub fn created(window: &WebviewWindow) {
    if !supports(window.label()) {
        return;
    }
    let label = window.label().to_owned();
    let token = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut current) = lifetimes().lock() {
        current.insert(label.clone(), token);
    }
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        if let Ok(mut current) = lifetimes().lock() {
            if current.get(&label) != Some(&token) {
                return;
            }
            current.remove(&label);
        } else {
            return;
        }
        let owner = registry()
            .lock()
            .ok()
            .and_then(|registered| registered.clone());
        if let Some(owner) = owner {
            if let Ok(mut queue) = owner.queue.lock() {
                queue.destroyed.insert(label.clone(), token);
            }
            owner.wake.notify_one();
        }
    });
}
pub fn shutdown() {
    STOPPED.store(true, Ordering::Release);
    if let Some(registered) = OWNER.get() {
        if let Ok(registered) = registered.lock() {
            if let Some(owner) = registered.as_ref() {
                owner.wake.notify_one();
            }
        }
    }
}

trait Host {
    fn load(&mut self) -> Result<Value, String>;
    /// Returns true only when this operation built a fresh native lifetime.
    fn show(&mut self, label: &str, focus: bool) -> Result<bool, String>;
    fn hide(&mut self, label: &str) -> Result<(), String>;
    fn active(&self) -> Result<(), String>;
}
struct NativeHost {
    app: AppHandle,
}
impl Host for NativeHost {
    fn load(&mut self) -> Result<Value, String> {
        active()?;
        let id = format!(
            "native-workspace-windows-{}",
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let response =
            crate::worker::request(json!({"id":id,"method":"workspace_layout_load","params":{}}))?;
        checked_response(response, &id)
    }
    fn show(&mut self, label: &str, focus: bool) -> Result<bool, String> {
        active()?;
        crate::ensure_workspace_window(&self.app, label, focus)
    }
    fn hide(&mut self, label: &str) -> Result<(), String> {
        active()?;
        if let Some(window) = self.app.get_webview_window(label) {
            window.hide().map_err(|error| error.to_string())?;
        }
        Ok(())
    }
    fn active(&self) -> Result<(), String> {
        active()
    }
}
fn checked_response(response: Value, id: &str) -> Result<Value, String> {
    if response["id"].as_str() != Some(id) {
        return Err("Native workspace layout response did not match its request.".into());
    }
    if response["ok"] != true {
        return Err(response["error"]["message"]
            .as_str()
            .unwrap_or("The saved workspace layout could not be loaded.")
            .into());
    }
    if !response["result"]["layout"].is_object() {
        return Err("Native workspace layout response is incomplete.".into());
    }
    Ok(response["result"]["layout"].clone())
}
struct Engine {
    planner: WorkspaceWindowPlanner,
    outcome: Value,
}
impl Default for Engine {
    fn default() -> Self {
        Self {
            planner: WorkspaceWindowPlanner::default(),
            outcome: idle(),
        }
    }
}
impl Engine {
    fn begin(&mut self) {
        self.outcome["state"] = json!("applying");
        self.outcome["error"] = json!("");
        self.outcome["shown"] = json!([]);
        self.outcome["hidden"] = json!([]);
    }
    fn fail(&mut self, error: String) -> Result<(), String> {
        self.outcome["state"] = json!("error");
        self.outcome["error"] = json!(error);
        Err(error)
    }
    fn record_plan(&mut self, plan: &Plan) {
        self.outcome["generation"] = json!(plan.generation);
        self.outcome["revision"] = json!(plan.revision);
        self.outcome["presetID"] = json!(plan.preset_id);
    }
    fn record(&mut self, field: &str, label: &str) {
        if let Some(labels) = self.outcome[field].as_array_mut() {
            let label = json!(label);
            if !labels.contains(&label) {
                labels.push(label);
            }
        }
    }
    fn open<H: Host>(&mut self, host: &mut H, label: &str) -> Result<(), String> {
        // Manual menu commands have their own reply. They must not replace a
        // saved-layout failure or claim that its partial batch was completed.
        host.active()?;
        if host.show(label, true)? {
            // A destroyed managed lifetime can still have an old callback
            // queued while this manual replacement is built. Ownership must
            // never pass through the reused label to the fresh manual window.
            self.planner.forget_destroyed(label);
        }
        Ok(())
    }
    fn reconcile<H: Host>(&mut self, host: &mut H, force: bool) -> Result<(), String> {
        let result = self.reconcile_inner(host, force);
        if let Err(error) = result {
            return self.fail(error);
        }
        self.outcome["state"] = json!("applied");
        Ok(())
    }
    fn reconcile_inner<H: Host>(&mut self, host: &mut H, force: bool) -> Result<(), String> {
        host.active()?;
        let mut snapshot = host.load()?;
        let mut force = force;
        for _ in 0..MAX_SUPERSEDED {
            host.active()?;
            let plan = self.planner.plan(&snapshot, force)?;
            force = false;
            self.record_plan(&plan);
            for label in &plan.show {
                host.active()?;
                host.show(label, false)?;
                self.planner.acknowledge_show(label)?;
                self.record("shown", label);
            }
            // Show operations can take time. Read the worker again before any
            // hides; a superseding layout must first get its own desired shows.
            host.active()?;
            let latest = host.load()?;
            let checked = self.planner.plan(&latest, false)?;
            if checked.generation == plan.generation && checked.revision < plan.revision {
                return Err(
                    "The native workspace snapshot moved backwards. Retry the current preset."
                        .into(),
                );
            }
            if checked.generation != plan.generation
                || checked.revision != plan.revision
                || !checked.same_intent(&plan)
            {
                snapshot = latest;
                continue;
            }
            for label in &plan.hide {
                host.active()?;
                host.hide(label)?;
                self.planner.acknowledge_hide(label)?;
                self.record("hidden", label);
            }
            host.active()?;
            self.planner.complete(&plan);
            return Ok(());
        }
        Err("The saved workspace layout kept changing. Retry the current preset.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct FakeHost {
        layouts: VecDeque<Value>,
        last: Value,
        operations: Vec<String>,
        fail_show: Option<String>,
        fresh_show: bool,
        stopped: bool,
    }
    impl FakeHost {
        fn new(layouts: Vec<Value>) -> Self {
            Self {
                last: layouts.last().unwrap().clone(),
                layouts: layouts.into(),
                operations: vec![],
                fail_show: None,
                fresh_show: false,
                stopped: false,
            }
        }
    }
    impl Host for FakeHost {
        fn load(&mut self) -> Result<Value, String> {
            self.active()?;
            Ok(self
                .layouts
                .pop_front()
                .unwrap_or_else(|| self.last.clone()))
        }
        fn show(&mut self, label: &str, focus: bool) -> Result<bool, String> {
            self.active()?;
            if self.fail_show.as_deref() == Some(label) {
                return Err(format!("show failed: {label}"));
            }
            self.operations.push(format!("show:{label}:{focus}"));
            Ok(self.fresh_show)
        }
        fn hide(&mut self, label: &str) -> Result<(), String> {
            self.active()?;
            self.operations.push(format!("hide:{label}"));
            Ok(())
        }
        fn active(&self) -> Result<(), String> {
            if self.stopped {
                Err("stopped".into())
            } else {
                Ok(())
            }
        }
    }
    fn layout(revision: u64, windows: &[&str]) -> Value {
        let roles = [
            "active-qso",
            "log-qso",
            "logbook",
            "callsign-intelligence",
            "rotor",
            "antenna",
            "world-map",
            "band-maps",
            "dx-cluster",
            "station-control",
            "station-status",
            "station-identity",
            "cw",
            "alerts",
            "propagation",
            "settings",
            "sync",
            "awards",
            "chaser-dx",
            "spot-history",
            "monitor",
        ];
        let panels: Vec<_> = roles.iter().enumerate().map(|(z, id)| json!({"id":id,"placement":if windows.contains(id) {"window"} else {"hidden"},"rect":{"x":0,"y":0,"width":640,"height":480},"z":z})).collect();
        json!({"generation":"12345678-1234-1234-1234-123456789abc","revision":revision,"document":{"version":2,"activePresetID":"desk","presets":[{"id":"desk","name":"Desk","width":1920,"height":1080,"locked":true,"snap":true,"panels":panels}]}})
    }
    fn reconcile(engine: &mut Engine, host: &mut FakeHost, force: bool) -> Result<(), String> {
        engine.begin();
        engine.reconcile(host, force)
    }
    #[test]
    fn shows_before_hides_and_preserves_manual_windows() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        engine.open(&mut host, "awards").unwrap();
        reconcile(&mut engine, &mut host, false).unwrap();
        host.operations.clear();
        host.last = layout(2, &["world-map"]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert_eq!(host.operations, ["show:world-map:false", "hide:logbook"]);
        assert_eq!(engine.outcome["hidden"], json!(["logbook"]));
    }
    #[test]
    fn superseding_layout_is_opened_before_any_old_hide() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        host.operations.clear();
        host.layouts = vec![layout(2, &["world-map"]), layout(3, &["logbook", "awards"])].into();
        host.last = layout(3, &["logbook", "awards"]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert_eq!(
            host.operations,
            [
                "show:world-map:false",
                "show:awards:false",
                "show:logbook:false",
                "hide:world-map"
            ]
        );
        assert_eq!(engine.outcome["revision"], 3);
    }
    #[test]
    fn failed_show_does_not_hide_or_claim_completed_intent_and_retry_works() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        host.operations.clear();
        host.last = layout(2, &["awards", "world-map"]);
        host.fail_show = Some("world-map".into());
        assert!(reconcile(&mut engine, &mut host, false).is_err());
        assert_eq!(host.operations, ["show:awards:false"]);
        assert_eq!(engine.outcome["state"], "error");
        host.fail_show = None;
        host.operations.clear();
        reconcile(&mut engine, &mut host, true).unwrap();
        assert_eq!(
            host.operations,
            ["show:awards:false", "show:world-map:false", "hide:logbook"]
        );
    }
    #[test]
    fn successful_manual_open_does_not_clear_failed_layout_status() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["awards", "world-map"])]);
        host.fail_show = Some("world-map".into());
        assert!(reconcile(&mut engine, &mut host, false).is_err());
        let failed = engine.outcome.clone();
        assert_eq!(failed["state"], "error");
        assert_eq!(failed["shown"], json!(["awards"]));
        engine.open(&mut host, "logbook").unwrap();
        assert_eq!(engine.outcome, failed);
        host.fail_show = Some("monitor".into());
        assert!(engine.open(&mut host, "monitor").is_err());
        assert_eq!(engine.outcome, failed);
    }
    #[test]
    fn passive_refresh_and_rename_do_not_reopen_manual_close_but_force_does() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        engine.planner.forget_destroyed("logbook");
        host.operations.clear();
        host.last["revision"] = json!(2);
        host.last["document"]["presets"][0]["name"] = json!("Renamed");
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
        reconcile(&mut engine, &mut host, true).unwrap();
        assert_eq!(host.operations, ["show:logbook:false"]);
    }
    #[test]
    fn queued_refresh_is_bounded_coalesced_and_retains_force() {
        let mut queue = Queue::default();
        for _ in 0..10000 {
            queue.refresh(false);
        }
        queue.refresh(true);
        queue.refresh(false);
        assert!(matches!(queue.next(), Some(Work::Refresh(true))));
        assert!(queue.next().is_none());
    }
    #[test]
    fn stale_second_read_cannot_hide_current_windows() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        host.operations.clear();
        host.layouts = vec![layout(3, &["world-map"]), layout(2, &[])].into();
        assert!(reconcile(&mut engine, &mut host, false).is_err());
        assert_eq!(host.operations, ["show:world-map:false"]);
        assert_eq!(engine.outcome["hidden"], json!([]));
    }
    #[test]
    fn old_destroy_does_not_forget_replacement_lifetime() {
        let current = BTreeMap::from([("logbook".into(), 12)]);
        assert!(!destruction_is_current(&current, "logbook", 11));
        assert!(destruction_is_current(&current, "logbook", 12));
        assert!(destruction_is_current(&BTreeMap::new(), "logbook", 12));
    }
    #[test]
    fn fresh_manual_replacement_does_not_inherit_destroyed_managed_ownership() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        // The actor begins a manual open before the old Destroyed callback is
        // consumed; the adapter reports a freshly created replacement.
        host.fresh_show = true;
        engine.open(&mut host, "logbook").unwrap();
        let current = BTreeMap::from([("logbook".into(), 12)]);
        assert!(!destruction_is_current(&current, "logbook", 11));
        host.operations.clear();
        host.last = layout(2, &[]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
        assert_eq!(engine.outcome["hidden"], json!([]));
    }
    #[test]
    fn manual_reveal_of_existing_managed_window_retains_ownership() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        host.fresh_show = false;
        engine.open(&mut host, "logbook").unwrap();
        host.operations.clear();
        host.last = layout(2, &[]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert_eq!(host.operations, ["hide:logbook"]);
    }
    #[test]
    fn stopped_engine_never_opens_or_hides() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        host.stopped = true;
        assert!(engine.open(&mut host, "awards").is_err());
        assert!(reconcile(&mut engine, &mut host, true).is_err());
        assert!(host.operations.is_empty());
    }
    #[test]
    fn native_load_requires_correlated_successful_layout_response() {
        let valid = json!({"id":"load","ok":true,"result":{"layout":layout(1, &[])}});
        assert!(checked_response(valid.clone(), "load").is_ok());
        assert!(checked_response(valid, "other").is_err());
        assert!(checked_response(
            json!({"id":"load","ok":false,"error":{"message":"failed"}}),
            "load"
        )
        .is_err());
        assert!(checked_response(json!({"id":"load","ok":true,"result":{}}), "load").is_err());
    }
}
