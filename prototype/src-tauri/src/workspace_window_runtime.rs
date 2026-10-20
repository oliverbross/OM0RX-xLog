//! One native owner for explicit opens and persisted-layout reconciliation.
//! Renderer panel lists are deliberately absent from this interface.
use crate::workspace_windows::{supports, Plan, WorkspaceWindowPlanner, WorkspaceWindowScope, SUPPORTED_WINDOWS};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

const MAX_OPENS: usize = 32;
const MAX_SUPERSEDED: usize = 8;
const MAX_ATTEMPT: u64 = 9_007_199_254_740_991;
const CONTEST_RETIRE_TIMEOUT: Duration = Duration::from_secs(2);
static STOPPED: AtomicBool = AtomicBool::new(false);
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
static OWNER: OnceLock<Mutex<Option<Arc<Owner>>>> = OnceLock::new();
static LIFETIMES: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();
static RETIRING_CONTEST_WINDOWS: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();

fn registry() -> &'static Mutex<Option<Arc<Owner>>> {
    OWNER.get_or_init(|| Mutex::new(None))
}
fn lifetimes() -> &'static Mutex<BTreeMap<String, u64>> {
    LIFETIMES.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn retiring_contest_windows() -> &'static Mutex<BTreeMap<String, u64>> {
    RETIRING_CONTEST_WINDOWS.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn contest_window_state_directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|error| error.to_string())
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
        "error":"","attempt":0,"stopped":STOPPED.load(Ordering::Acquire)})
}
fn contest_idle(context: &crate::contest_window_context::ContestWindowContext) -> Value {
    let mut value = idle();
    value["supported"] = json!(crate::workspace_windows::CONTEST_WINDOWS.iter().map(|window| window.id).collect::<Vec<_>>());
    value["scope"] = json!("contesting");
    value["operatingContext"] = json!(context.operating_context);
    value["sessionID"] = json!(context.session_id);
    value["workspaceGeneration"] = json!(context.workspace_generation);
    value
}

struct PendingOpen {
    label: String,
    scope: WorkspaceWindowScope,
    contest_context: Option<crate::contest_window_context::ContestWindowContext>,
    reply: mpsc::Sender<Result<(), String>>,
}
struct PendingCanvas { generation: String, revision: u64, layout: Value, reply: mpsc::Sender<Result<(), String>> }
struct PendingContestReset {
    context: crate::contest_window_context::ContestWindowContext,
    reply: mpsc::Sender<Result<(), String>>,
}
struct PendingContestClose {
    context: crate::contest_window_context::ContestWindowContext,
    reply: mpsc::Sender<Result<(), String>>,
}
#[derive(Clone)]
struct PendingRefresh {
    scope: WorkspaceWindowScope,
    contest_context: Option<crate::contest_window_context::ContestWindowContext>,
    force: bool,
    attempt: u64,
}
#[derive(Default)]
struct Queue {
    canvas: VecDeque<PendingCanvas>,
    contest_resets: VecDeque<PendingContestReset>,
    contest_closes: VecDeque<PendingContestClose>,
    opens: VecDeque<PendingOpen>,
    refresh: BTreeMap<WorkspaceWindowScope, PendingRefresh>,
    issued_attempt: u64,
    destroyed: BTreeMap<String, u64>,
    // Alternate work categories so continuous menu clicks cannot starve a wake.
    prefer_refresh: bool,
}
struct Owner {
    queue: Mutex<Queue>,
    wake: Condvar,
    outcome: Mutex<BTreeMap<WorkspaceWindowScope, (Option<crate::contest_window_context::ContestWindowContext>, Value)>>,
    app: AppHandle,
}
enum Work {
    Canvas(PendingCanvas),
    ContestReset(PendingContestReset),
    ContestClose(PendingContestClose),
    Open(PendingOpen),
    Refresh(PendingRefresh),
    Destroyed(String, u64),
}
impl Queue {
    fn reject_contest_work(&mut self) {
        self.refresh.remove(&WorkspaceWindowScope::Contesting);
        let mut retained = VecDeque::new();
        for open in self.opens.drain(..) {
            if open.scope == WorkspaceWindowScope::Contesting {
                let _ = open.reply.send(Err("The contest window context changed before this window opened.".into()));
            } else { retained.push_back(open); }
        }
        self.opens = retained;
    }
    fn next(&mut self) -> Option<Work> {
        if let Some(reset) = self.contest_resets.pop_front() { return Some(Work::ContestReset(reset)); }
        if let Some(close) = self.contest_closes.pop_front() { return Some(Work::ContestClose(close)); }
        if let Some(canvas) = self.canvas.pop_front() { return Some(Work::Canvas(canvas)); }
        if let Some((label, token)) = self.destroyed.pop_first() {
            return Some(Work::Destroyed(label, token));
        }
        if self.prefer_refresh || self.opens.is_empty() {
            if let Some((_, refresh)) = self.refresh.pop_first() {
                self.prefer_refresh = false;
                return Some(Work::Refresh(refresh));
            }
        }
        if let Some(open) = self.opens.pop_front() {
            self.prefer_refresh = true;
            return Some(Work::Open(open));
        }
        self.refresh.pop_first().map(|(_, refresh)| Work::Refresh(refresh))
    }
    fn refresh(&mut self, scope: WorkspaceWindowScope,
        contest_context: Option<crate::contest_window_context::ContestWindowContext>, force: bool) -> Result<u64, String> {
        // Allocation and queue insertion share the owner's queue lock. A
        // passive completion cannot satisfy an explicit caller's later ticket.
        let attempt = self
            .issued_attempt
            .checked_add(1)
            .filter(|attempt| *attempt <= MAX_ATTEMPT)
            .ok_or("Native workspace window attempts exhausted; restart the application.")?;
        let force = self.refresh.get(&scope).is_some_and(|refresh| refresh.force) || force;
        self.refresh.insert(scope, PendingRefresh { scope, contest_context, force, attempt });
        self.issued_attempt = attempt;
        Ok(attempt)
    }
}
impl Owner {
    fn publish(&self, scope: WorkspaceWindowScope,
        context: Option<crate::contest_window_context::ContestWindowContext>, value: Value) {
        let store = || {
            if let Ok(mut outcome) = self.outcome.lock() {
                let _ = insert_outcome_after_admission(&mut outcome, scope, context.clone(), value, Ok(()));
            }
        };
        match (scope, context.as_ref()) {
            (WorkspaceWindowScope::NormalLogging, None) => store(),
            (WorkspaceWindowScope::Contesting, Some(context)) => {
                if crate::contest_window_context::with_admitted(context, store).is_err() { return; }
            }
            _ => return,
        }
        // Never leave the operator with no usable surface if an asynchronous
        // Separate Windows reconciliation fails after the main window hid.
        if self.outcome.lock().is_ok_and(|outcomes| outcomes.get(&scope).is_some_and(|(_, outcome)| outcome["state"] == "error")) {
            if let Some(main) = self.app.get_webview_window("main") { let _ = main.show(); }
        }
        // The payload is a wake only. Consumers read the native snapshot.
        let _ = self.app.emit("xlog:workspace-windows", ());
    }
    fn run(self: Arc<Self>) {
        let mut engines = BTreeMap::from([(WorkspaceWindowScope::NormalLogging, Engine::default())]);
        loop {
            let work = {
                let Ok(mut queue) = self.queue.lock() else {
                    break;
                };
                while queue.opens.is_empty()
                    && queue.canvas.is_empty()
                    && queue.contest_resets.is_empty()
                    && queue.contest_closes.is_empty()
                    && queue.refresh.is_empty()
                    && queue.destroyed.is_empty()
                    && !STOPPED.load(Ordering::Acquire)
                {
                    let Ok(next) = self.wake.wait(queue) else {
                        return;
                    };
                    queue = next;
                }
                if STOPPED.load(Ordering::Acquire) {
                    for canvas in queue.canvas.drain(..) { let _ = canvas.reply.send(Err("The native workspace window owner has stopped.".into())); }
                    for reset in queue.contest_resets.drain(..) { let _ = reset.reply.send(Err("The native workspace window owner has stopped.".into())); }
                    for close in queue.contest_closes.drain(..) { let _ = close.reply.send(Err("The native workspace window owner has stopped.".into())); }
                    for open in queue.opens.drain(..) {
                        let _ = open
                            .reply
                            .send(Err("The native workspace window owner has stopped.".into()));
                    }
                    queue.refresh.clear();
                    queue.destroyed.clear();
                    break;
                }
                queue.next()
            };
            match work {
                Some(Work::ContestReset(reset)) => {
                    let result = crate::contest_window_context::admit(&reset.context).and_then(|_| {
                        if contest_engine_matches(&engines, &reset.context) { return Ok(()); }
                        if let Ok(mut queue) = self.queue.lock() { queue.reject_contest_work(); }
                        crate::contest_surface::register_context(&reset.context);
                        close_contest_windows(&self.app)?;
                        engines.insert(WorkspaceWindowScope::Contesting, Engine::for_contest(&reset.context));
                        self.publish(WorkspaceWindowScope::Contesting, Some(reset.context.clone()), contest_idle(&reset.context));
                        Ok(())
                    });
                    let _ = reset.reply.send(result);
                }
                Some(Work::ContestClose(close)) => {
                    let result = crate::contest_window_context::admit(&close.context).and_then(|_| {
                        if let Ok(mut queue) = self.queue.lock() { queue.reject_contest_work(); }
                        close_contest_windows(&self.app)
                    });
                    if result.is_ok() {
                        if crate::contest_window_context::invalidate_if(&close.context) {
                            crate::contest_surface::invalidate_context(&close.context);
                            engines.remove(&WorkspaceWindowScope::Contesting);
                            if let Ok(mut outcomes) = self.outcome.lock() { outcomes.remove(&WorkspaceWindowScope::Contesting); }
                        }
                    }
                    let _ = close.reply.send(result);
                }
                Some(Work::Canvas(canvas)) => {
                    let engine = engines.get_mut(&WorkspaceWindowScope::NormalLogging).expect("normal engine");
                    let result = engine.planner.plan(&canvas.layout, false).and_then(|plan| {
                        crate::present_canvas_windows(&self.app, &canvas.generation, canvas.revision)?;
                        engine.canvas_completed(&plan);
                        Ok(())
                    });
                    let _ = canvas.reply.send(result);
                }
                Some(Work::Open(open)) => {
                    let Ok(engine) = admitted_engine_for(&mut engines, open.scope, open.contest_context.as_ref()) else {
                        let _ = open.reply.send(Err("That native window request belongs to an expired contest context.".into()));
                        continue;
                    };
                    // Retain contest admission through the serialized queue,
                    // then present the existing shared service lifetime.
                    if open.scope == WorkspaceWindowScope::Contesting
                        && crate::workspace_navigation::contest_shared_window(&open.label).is_some() {
                        let engine = engines.get_mut(&WorkspaceWindowScope::NormalLogging).expect("normal engine");
                        let mut host = SharedContestHost { app: self.app.clone(), context: open.contest_context.expect("admitted contest context") };
                        let result = engine.open(&mut host, &open.label);
                        let _ = open.reply.send(result);
                        continue;
                    }
                    let remember = open.scope == WorkspaceWindowScope::Contesting
                        && open.label.starts_with(crate::workspace_windows::CONTEST_LABEL_PREFIX);
                    let mut host = NativeHost { app: self.app.clone(), scope: open.scope, contest_context: open.contest_context };
                    let result = engine.open(&mut host, &open.label).and_then(|_| {
                        if remember { crate::contest_window_state::remember(&contest_window_state_directory(&self.app)?, &open.label, true)?; }
                        Ok(())
                    });
                    let _ = open.reply.send(result);
                }
                Some(Work::Refresh(refresh)) => {
                    let Ok(engine) = admitted_engine_for(&mut engines, refresh.scope, refresh.contest_context.as_ref()) else {
                        continue;
                    };
                    let mut host = NativeHost { app: self.app.clone(), scope: refresh.scope, contest_context: refresh.contest_context.clone() };
                    engine.begin(refresh.attempt);
                    self.publish(refresh.scope, refresh.contest_context.clone(), engine.outcome.clone());
                    let restored = if refresh.scope == WorkspaceWindowScope::Contesting {
                        contest_window_state_directory(&self.app).and_then(|directory| crate::contest_window_state::labels(&directory))
                            .and_then(|labels| engine.restore_manual(&mut host, &labels))
                    } else { Ok(()) };
                    let _ = restored.and_then(|_| engine.reconcile(&mut host, refresh.force)).or_else(|error| engine.fail(error));
                    self.publish(refresh.scope, refresh.contest_context, engine.outcome.clone());
                }
                Some(Work::Destroyed(label, token)) => {
                    // A replacement can be created before an old callback is handled.
                    if let Ok(current) = lifetimes().lock() {
                        if destruction_is_current(&current, &label, token) {
                            if let Ok(identity) = crate::workspace_windows::WorkspaceWindowIdentity::parse_native_label(&label) {
                                if let Some(engine) = engines.get_mut(&identity.scope) { engine.planner.forget_destroyed(&label); }
                            }
                        }
                    }
                }
                None => {}
            }
        }
        for (scope, engine) in &mut engines {
            engine.outcome["stopped"] = json!(true);
            if engine.outcome["state"] == "applying" {
                let _ = engine.fail("The native workspace window owner has stopped.".into());
            }
            let context = self.outcome.lock().ok().and_then(|outcomes| outcomes.get(scope).and_then(|(context, _)| context.clone()));
            self.publish(*scope, context, engine.outcome.clone());
        }
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
        for canvas in queue.canvas.drain(..) { let _ = canvas.reply.send(Err("The native workspace window owner failed.".into())); }
        for reset in queue.contest_resets.drain(..) { let _ = reset.reply.send(Err("The native workspace window owner failed.".into())); }
        for close in queue.contest_closes.drain(..) { let _ = close.reply.send(Err("The native workspace window owner failed.".into())); }
        queue.refresh.clear();
        queue.destroyed.clear();
        drop(queue);
        let outcomes = self.outcome.lock().unwrap_or_else(|error| error.into_inner()).clone();
        for (scope, (context, mut outcome)) in outcomes {
            outcome["state"] = json!("error");
            outcome["error"] = json!("The native workspace window owner failed.");
            outcome["stopped"] = json!(true);
            self.publish(scope, context, outcome);
        }
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
        outcome: Mutex::new(BTreeMap::from([(WorkspaceWindowScope::NormalLogging, (None, idle()))])),
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
    scoped_open(app, WorkspaceWindowScope::NormalLogging, None, label.into())
}
/// Open one contest tool without reconciling or changing its saved layout.
/// The serialized owner rechecks context admission before touching the window.
pub fn contest_open(app: &AppHandle, context: crate::contest_window_context::ContestWindowContext,
    panel_id: &str) -> Result<(), String> {
    let panel = crate::workspace_navigation::contest_window_panel(panel_id)
        .ok_or("That contest window is not available.")?;
    crate::contest_window_context::admit(&context)?;
    let label = contest_open_label(panel)?;
    scoped_open(app, WorkspaceWindowScope::Contesting, Some(context), label)
}
fn contest_open_label(panel: &str) -> Result<String, String> {
    let panel = crate::workspace_navigation::contest_window_panel(panel).ok_or("That contest window is not available.")?;
    if let Some(label) = crate::workspace_navigation::contest_shared_window(panel) { return Ok(label.into()); }
    Ok(crate::workspace_windows::WorkspaceWindowIdentity::new(WorkspaceWindowScope::Contesting, panel)?.native_label())
}
fn scoped_open(app: &AppHandle, scope: WorkspaceWindowScope,
    contest_context: Option<crate::contest_window_context::ContestWindowContext>, label: String) -> Result<(), String> {
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
            label,
            scope,
            contest_context,
            reply,
        });
    }
    owner.wake.notify_one();
    received
        .recv()
        .map_err(|_| "Native workspace window owner unavailable".to_owned())?
}
/// Serialized with manual opens and layout reconciliation; completion is the
/// reply to this exact request, never an unrelated layout status notification.
pub fn canvas(app: &AppHandle, generation: &str, revision: u64, layout: Value) -> Result<(), String> {
    let owner = owner(app)?;
    let (reply, received) = mpsc::channel();
    {
        let mut queue = owner.queue.lock().map_err(|_| "Native workspace window queue unavailable")?;
        active()?;
        if !queue.canvas.is_empty() { return Err("A Canvas transition is already queued.".into()); }
        queue.canvas.push_back(PendingCanvas { generation: generation.into(), revision, layout, reply });
    }
    owner.wake.notify_one();
    received.recv().map_err(|_| "Canvas transition owner unavailable".to_owned())?
}
pub fn contest_context_changed(app: &AppHandle,
    context: crate::contest_window_context::ContestWindowContext) -> Result<(), String> {
    crate::contest_window_context::admit(&context)?;
    let owner = owner(app)?;
    let (reply, received) = mpsc::channel();
    {
        let mut queue = owner.queue.lock().map_err(|_| "Native workspace window queue unavailable")?;
        active()?;
        if !queue.contest_resets.is_empty() { return Err("A contest window context change is already queued.".into()); }
        queue.contest_resets.push_back(PendingContestReset { context, reply });
    }
    owner.wake.notify_one();
    received.recv().map_err(|_| "Native workspace window owner unavailable".to_owned())?
}
/// Replace the admitted contest session before asking the native owner to load
/// its saved window set. The reset deliberately completes first: it rejects
/// any older queued contest work, so pre-queuing this refresh would discard it.
pub fn contest_context_changed_and_refresh(app: &AppHandle,
    context: crate::contest_window_context::ContestWindowContext) -> Result<u64, String> {
    contest_context_changed(app, context.clone())?;
    contest_refresh(app, context, false)
}
pub fn contest_context_closed(app: &AppHandle,
    context: crate::contest_window_context::ContestWindowContext) -> Result<(), String> {
    crate::contest_window_context::admit(&context)?;
    let owner = owner(app)?;
    let (reply, received) = mpsc::channel();
    {
        let mut queue = owner.queue.lock().map_err(|_| "Native workspace window queue unavailable")?;
        active()?;
        if !queue.contest_closes.is_empty() { return Err("A contest window context close is already queued.".into()); }
        queue.contest_closes.push_back(PendingContestClose { context, reply });
    }
    owner.wake.notify_one();
    received.recv().map_err(|_| "Native workspace window owner unavailable".to_owned())?
}

fn close_contest_windows(app: &AppHandle) -> Result<(), String> {
    // Context retirement must never leave a hidden Separate Windows desk with
    // every usable surface gone, including when one child refuses to close.
    if let Some(main) = app.get_webview_window("main") { main.show().map_err(|error| error.to_string())?; }
    let labels = contest_window_labels();
    for label in &labels {
        if let Some(window) = app.get_webview_window(label) {
            let token = lifetimes().lock().map_err(|_| "Contest window lifetime unavailable")?.get(label).copied()
                .ok_or("Contest window lifetime unavailable")?;
            retiring_contest_windows().lock().map_err(|_| "Contest window retirement unavailable")?.insert(label.clone(), token);
            let closed = if contest_retirement_force_destroys(label) { window.destroy() } else { window.close() };
            if let Err(error) = closed {
                if let Ok(mut retiring) = retiring_contest_windows().lock() { retiring.remove(label); }
                return Err(error.to_string());
            }
        }
    }
    let deadline = Instant::now() + CONTEST_RETIRE_TIMEOUT;
    while labels.iter().any(|label| app.get_webview_window(label).is_some()) {
        if Instant::now() >= deadline {
            return Err("A previous contest window did not close; the main contest workspace was restored. Retry the layout after closing that window.".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}
fn contest_retirement_force_destroys(label: &str) -> bool { label == "contest--edit-contact" }
fn contest_window_labels() -> Vec<String> {
    crate::workspace_windows::CONTEST_WINDOWS.iter()
        .map(|spec| format!("{}{}", crate::workspace_windows::CONTEST_LABEL_PREFIX, spec.id)).collect()
}
/// Coalesce wakes, retaining force and the latest accepted ticket. The returned
/// ticket is queued; only a terminal status at or above it confirms completion.
pub fn refresh(app: &AppHandle, force: bool) -> Result<u64, String> {
    scoped_refresh(app, WorkspaceWindowScope::NormalLogging, None, force)
}
pub fn contest_refresh(app: &AppHandle, context: crate::contest_window_context::ContestWindowContext, force: bool) -> Result<u64, String> {
    crate::contest_window_context::admit(&context)?;
    scoped_refresh(app, WorkspaceWindowScope::Contesting, Some(context), force)
}
fn scoped_refresh(app: &AppHandle, scope: WorkspaceWindowScope,
    contest_context: Option<crate::contest_window_context::ContestWindowContext>, force: bool) -> Result<u64, String> {
    let owner = owner(app)?;
    let attempt = {
        let mut queue = owner
            .queue
            .lock()
            .map_err(|_| "Native workspace window queue unavailable")?;
        active()?;
        queue.refresh(scope, contest_context, force)?
    };
    owner.wake.notify_one();
    Ok(attempt)
}
/// Reading status is inert, including in isolated acceptance before its first layout operation.
pub fn status(_app: &AppHandle) -> Result<Value, String> {
    scoped_status(WorkspaceWindowScope::NormalLogging, None)
}
pub fn contest_status(_app: &AppHandle, context: crate::contest_window_context::ContestWindowContext) -> Result<Value, String> {
    if let Err(error) = crate::contest_window_context::admit(&context) {
        let mut stale = contest_idle(&context);
        stale["state"] = json!("error"); stale["error"] = json!(error); stale["stopped"] = json!(STOPPED.load(Ordering::Acquire));
        return Ok(stale);
    }
    scoped_status(WorkspaceWindowScope::Contesting, Some(context))
}
pub fn contest_stale_status(session_id: &str, workspace_generation: &str, error: String) -> Value {
    json!({"supported":crate::workspace_windows::CONTEST_WINDOWS.iter().map(|window| window.id).collect::<Vec<_>>(),
        "scope":"contesting","sessionID":session_id,"workspaceGeneration":workspace_generation,
        "generation":null,"revision":null,"presetID":null,"state":"error","shown":[],"hidden":[],
        "error":error,"attempt":0,"stopped":STOPPED.load(Ordering::Acquire)})
}
fn scoped_status(scope: WorkspaceWindowScope,
    contest_context: Option<crate::contest_window_context::ContestWindowContext>) -> Result<Value, String> {
    let owner = registry()
        .lock()
        .map_err(|_| "Native workspace window registry unavailable")?
        .clone();
    let mut value = if let Some(owner) = owner {
        let outcomes = owner.outcome.lock().map_err(|_| "Native workspace window status unavailable")?;
        outcomes.get(&scope).filter(|(stored, _)| stored == &contest_context).map(|(_, value)| value.clone())
            .unwrap_or_else(|| contest_context.as_ref().map_or_else(idle, contest_idle))
    } else {
        contest_context.as_ref().map_or_else(idle, contest_idle)
    };
    value["stopped"] = json!(STOPPED.load(Ordering::Acquire));
    Ok(value)
}
fn destruction_is_current(current: &BTreeMap<String, u64>, label: &str, token: u64) -> bool {
    current.get(label).is_none_or(|live| *live == token)
}
/// Register only newly built windows. Each real native lifetime gets its own token.
pub fn created(window: &WebviewWindow) {
    if crate::workspace_windows::WorkspaceWindowIdentity::parse_native_label(window.label()).is_err() {
        return;
    }
    let label = window.label().to_owned();
    let app = window.app_handle().clone();
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
        let retiring = retiring_contest_windows().lock().is_ok_and(|mut labels|
            labels.get(&label) == Some(&token) && labels.remove(&label).is_some());
        if !retiring && !STOPPED.load(Ordering::Acquire) && label.starts_with(crate::workspace_windows::CONTEST_LABEL_PREFIX) {
            if let Err(error) = contest_window_state_directory(&app)
                .and_then(|directory| crate::contest_window_state::remember(&directory, &label, false)) {
                eprintln!("Contest window state was not saved: {error}");
            }
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
    crate::contest_window_context::invalidate();
    crate::contest_surface::invalidate_all();
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
    scope: WorkspaceWindowScope,
    contest_context: Option<crate::contest_window_context::ContestWindowContext>,
}
struct SharedContestHost {
    app: AppHandle,
    context: crate::contest_window_context::ContestWindowContext,
}
impl Host for SharedContestHost {
    fn load(&mut self) -> Result<Value, String> { Err("Shared contest tools do not reconcile layouts.".into()) }
    fn show(&mut self, label: &str, focus: bool) -> Result<bool, String> {
        self.active()?;
        if crate::workspace_navigation::contest_shared_window(label).is_none() { return Err("That tool is not a shared contest window.".into()); }
        crate::ensure_workspace_window(&self.app, label, focus, None)
    }
    fn hide(&mut self, _label: &str) -> Result<(), String> { Err("Contest does not own shared service window retirement.".into()) }
    fn active(&self) -> Result<(), String> {
        active()?;
        crate::contest_window_context::admit(&self.context)
    }
}
impl Host for NativeHost {
    fn load(&mut self) -> Result<Value, String> {
        self.active()?;
        let id = format!(
            "native-workspace-windows-{}",
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let params = match self.scope {
            WorkspaceWindowScope::NormalLogging => json!({}),
            WorkspaceWindowScope::Contesting => json!({"scope":"contesting"}),
        };
        let response = crate::worker::request(json!({"id":id,"method":"workspace_layout_load","params":params}))?;
        checked_response(response, &id, self.scope, self.contest_context.as_ref().map(|context| context.workspace_generation.as_str()))
    }
    fn show(&mut self, label: &str, focus: bool) -> Result<bool, String> {
        self.active()?;
        crate::ensure_workspace_window(&self.app, label, focus, self.contest_context.as_ref())
    }
    fn hide(&mut self, label: &str) -> Result<(), String> {
        active()?;
        if let Some(window) = self.app.get_webview_window(label) {
            if label == "cw" {
                if let Some(owner) = crate::cw_session_backend::existing() { owner.prepare_close(label)?; }
            }
            if let Err(error) = window.hide() {
                if label == "cw" { if let Some(owner) = crate::cw_session_backend::existing() { let _ = owner.allow_window(label); } }
                return Err(error.to_string());
            }
        }
        Ok(())
    }
    fn active(&self) -> Result<(), String> {
        active()?;
        match (&self.scope, &self.contest_context) {
            (WorkspaceWindowScope::NormalLogging, None) => Ok(()),
            (WorkspaceWindowScope::Contesting, Some(context)) => crate::contest_window_context::admit(context),
            _ => Err("Native workspace scope context is invalid.".into()),
        }
    }
}
fn checked_response(response: Value, id: &str, scope: WorkspaceWindowScope, expected_generation: Option<&str>) -> Result<Value, String> {
    if response["id"].as_str() != Some(id) {
        return Err("Native workspace layout response did not match its request.".into());
    }
    if response["ok"] != true {
        return Err(response["error"]["message"]
            .as_str()
            .unwrap_or("The saved workspace layout could not be loaded.")
            .into());
    }
    let layout = &response["result"]["layout"];
    if !layout.is_object() {
        return Err("Native workspace layout response is incomplete.".into());
    }
    match scope {
        WorkspaceWindowScope::NormalLogging if layout.as_object().is_some_and(|layout| layout.contains_key("scope")) =>
            return Err("Native workspace layout response has the wrong scope.".into()),
        WorkspaceWindowScope::Contesting if layout["scope"] != "contesting" || layout["generation"].as_str() != expected_generation =>
            return Err("Native contest workspace layout response has the wrong context.".into()),
        _ => {}
    }
    Ok(layout.clone())
}
struct Engine {
    scope: WorkspaceWindowScope,
    contest_context: Option<crate::contest_window_context::ContestWindowContext>,
    planner: WorkspaceWindowPlanner,
    outcome: Value,
}
impl Default for Engine {
    fn default() -> Self {
        Self::for_scope(WorkspaceWindowScope::NormalLogging)
    }
}
impl Engine {
    fn for_scope(scope: WorkspaceWindowScope) -> Self {
        Self {
            scope,
            contest_context: None,
            planner: WorkspaceWindowPlanner::for_scope(scope),
            outcome: idle(),
        }
    }
    fn for_contest(context: &crate::contest_window_context::ContestWindowContext) -> Self {
        Self { scope: WorkspaceWindowScope::Contesting, contest_context: Some(context.clone()),
            planner: WorkspaceWindowPlanner::for_scope(WorkspaceWindowScope::Contesting), outcome: contest_idle(context) }
    }
    fn canvas_completed(&mut self, plan: &Plan) {
        // Every detached lifetime is gone, including manual instances. Remember
        // the confirmed intent so passive wakes cannot reopen a custom Canvas's
        // saved window placements immediately after the explicit mode switch.
        self.planner = WorkspaceWindowPlanner::for_scope(self.scope);
        self.planner.complete(plan);
    }
    fn begin(&mut self, attempt: u64) {
        self.outcome["attempt"] = json!(attempt);
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
    fn restore_manual<H: Host>(&mut self, host: &mut H, labels: &[String]) -> Result<(), String> {
        for label in labels {
            host.active()?;
            if host.show(label, false)? { self.planner.forget_destroyed(label); }
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

fn engine_for<'a>(engines: &'a mut BTreeMap<WorkspaceWindowScope, Engine>, scope: WorkspaceWindowScope,
    context: Option<&crate::contest_window_context::ContestWindowContext>) -> &'a mut Engine {
    let replace = match (scope, engines.get(&scope), context) {
        (WorkspaceWindowScope::NormalLogging, None, _) => true,
        (WorkspaceWindowScope::NormalLogging, Some(_), _) => false,
        (WorkspaceWindowScope::Contesting, Some(engine), Some(context)) => engine.contest_context.as_ref() != Some(context),
        (WorkspaceWindowScope::Contesting, _, Some(_)) => true,
        (WorkspaceWindowScope::Contesting, _, None) => true,
    };
    if replace {
        let engine = match (scope, context) {
            (WorkspaceWindowScope::Contesting, Some(context)) => Engine::for_contest(context),
            _ => Engine::for_scope(scope),
        };
        engines.insert(scope, engine);
    }
    engines.get_mut(&scope).expect("scoped engine")
}

fn contest_engine_matches(engines: &BTreeMap<WorkspaceWindowScope, Engine>,
    context: &crate::contest_window_context::ContestWindowContext) -> bool {
    engines.get(&WorkspaceWindowScope::Contesting)
        .is_some_and(|engine| engine.contest_context.as_ref() == Some(context))
}

fn admitted_engine_for<'a>(engines: &'a mut BTreeMap<WorkspaceWindowScope, Engine>, scope: WorkspaceWindowScope,
    context: Option<&crate::contest_window_context::ContestWindowContext>)
    -> Result<&'a mut Engine, String> {
    match (scope, context) {
        (WorkspaceWindowScope::NormalLogging, None) => engine_for_after_admission(engines, scope, None, Ok(())),
        (WorkspaceWindowScope::Contesting, Some(context)) => crate::contest_window_context::with_admitted(context,
            || engine_for_after_admission(engines, scope, Some(context), Ok(())))?,
        _ => Err("Native workspace scope context is invalid.".into()),
    }
}

fn engine_for_after_admission<'a>(engines: &'a mut BTreeMap<WorkspaceWindowScope, Engine>, scope: WorkspaceWindowScope,
    context: Option<&crate::contest_window_context::ContestWindowContext>, admission: Result<(), String>)
    -> Result<&'a mut Engine, String> {
    admission?;
    Ok(engine_for(engines, scope, context))
}

fn insert_outcome_after_admission(outcomes: &mut BTreeMap<WorkspaceWindowScope,
    (Option<crate::contest_window_context::ContestWindowContext>, Value)>, scope: WorkspaceWindowScope,
    context: Option<crate::contest_window_context::ContestWindowContext>, value: Value,
    admission: Result<(), String>) -> Result<(), String> {
    admission?;
    outcomes.insert(scope, (context, value));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn queue_refresh(queue: &mut Queue, force: bool) -> Result<u64, String> {
        queue.refresh(WorkspaceWindowScope::NormalLogging, None, force)
    }
    fn contest_context(session: &str) -> crate::contest_window_context::ContestWindowContext {
        crate::contest_window_context::ContestWindowContext {
            operating_context: "10000000-0000-4000-8000-000000000001".into(),
            session_id: session.into(), workspace_generation: "12345678-1234-1234-1234-123456789abc".into(),
        }
    }
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
    fn contest_layout(revision: u64, windows: &[&str]) -> Value {
        let mut layout = layout(revision, windows);
        layout["scope"] = json!("contesting");
        layout
    }
    fn reconcile(engine: &mut Engine, host: &mut FakeHost, force: bool) -> Result<(), String> {
        engine.begin(engine.outcome["attempt"].as_u64().unwrap() + 1);
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
    fn independent_band_windows_keep_instance_labels_and_survive_preset_reconciliation() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &[])]);
        engine.open(&mut host, "band-map-20m").unwrap();
        engine.open(&mut host, "band-map-40m").unwrap();
        assert_eq!(host.operations, ["show:band-map-20m:true", "show:band-map-40m:true"]);
        host.operations.clear();
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
        engine.planner.forget_destroyed("band-map-20m");
        engine.open(&mut host, "band-map-20m").unwrap();
        assert_eq!(host.operations, ["show:band-map-20m:true"]);
    }
    #[test]
    fn previous_qsos_uses_independent_window_lifecycle_and_does_not_reopen_after_canvas() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &[])]);
        engine.open(&mut host, "previous-qsos").unwrap();
        assert_eq!(host.operations, ["show:previous-qsos:true"]);
        host.operations.clear();
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
        let plan = engine.planner.plan(&host.last, false).unwrap();
        engine.canvas_completed(&plan);
        engine.planner.forget_destroyed("previous-qsos");
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
        engine.open(&mut host, "previous-qsos").unwrap();
        assert_eq!(host.operations, ["show:previous-qsos:true"]);
    }
    #[test]
    fn connection_doctor_uses_independent_window_lifecycle_and_does_not_reopen_after_canvas() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &[])]);
        engine.open(&mut host, "connection-doctor").unwrap();
        assert_eq!(host.operations, ["show:connection-doctor:true"]);
        host.operations.clear();
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
        let plan = engine.planner.plan(&host.last, false).unwrap();
        engine.canvas_completed(&plan);
        engine.planner.forget_destroyed("connection-doctor");
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
    }
    #[test]
    fn operating_goals_uses_independent_window_lifecycle_and_closes_for_canvas() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &[])]);
        engine.open(&mut host, "operating-goals").unwrap();
        assert_eq!(host.operations, ["show:operating-goals:true"]);
        let plan = engine.planner.plan(&host.last, false).unwrap();
        engine.canvas_completed(&plan);
        engine.planner.forget_destroyed("operating-goals");
        host.operations.clear();
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
    }
    #[test]
    fn completed_canvas_close_cannot_be_undone_by_passive_custom_layout_refresh() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        let plan = engine.planner.plan(&host.last, false).unwrap();
        engine.canvas_completed(&plan);
        host.operations.clear();
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty());
        host.last = layout(2, &[]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty(), "Destroyed windows retain no hide ownership");
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
        for index in 0..10000 {
            assert_eq!(queue_refresh(&mut queue, false).unwrap(), index + 1);
        }
        assert_eq!(queue_refresh(&mut queue, true).unwrap(), 10001);
        assert_eq!(queue_refresh(&mut queue, false).unwrap(), 10002);
        assert!(matches!(
            queue.next(),
            Some(Work::Refresh(PendingRefresh {
                scope: WorkspaceWindowScope::NormalLogging,
                contest_context: None,
                force: true,
                attempt: 10002
            }))
        ));
        assert!(queue.next().is_none());
    }
    #[test]
    fn one_queue_keeps_normal_and_contest_refreshes_separate() {
        let mut queue = Queue::default();
        let context = contest_context("20000000-0000-4000-8000-000000000001");
        assert_eq!(queue.refresh(WorkspaceWindowScope::Contesting, Some(context.clone()), false).unwrap(), 1);
        assert_eq!(queue_refresh(&mut queue, true).unwrap(), 2);
        let Some(Work::Refresh(normal)) = queue.next() else { panic!("missing normal refresh") };
        assert_eq!(normal.scope, WorkspaceWindowScope::NormalLogging);
        assert!(normal.force);
        let Some(Work::Refresh(contest)) = queue.next() else { panic!("missing contest refresh") };
        assert_eq!(contest.scope, WorkspaceWindowScope::Contesting);
        assert_eq!(contest.contest_context, Some(context));
        assert!(!contest.force);
    }
    #[test]
    fn context_reset_rejects_queued_contest_work_without_touching_normal_work() {
        let mut queue = Queue::default();
        let context = contest_context("20000000-0000-4000-8000-000000000001");
        queue.refresh(WorkspaceWindowScope::Contesting, Some(context.clone()), true).unwrap();
        queue_refresh(&mut queue, false).unwrap();
        let (contest_reply, contest_received) = mpsc::channel();
        let (normal_reply, _normal_received) = mpsc::channel();
        queue.opens.push_back(PendingOpen { label: "contest--logbook".into(), scope: WorkspaceWindowScope::Contesting,
            contest_context: Some(context), reply: contest_reply });
        queue.opens.push_back(PendingOpen { label: "logbook".into(), scope: WorkspaceWindowScope::NormalLogging,
            contest_context: None, reply: normal_reply });
        queue.reject_contest_work();
        assert!(contest_received.recv().unwrap().is_err());
        assert_eq!(queue.opens.len(), 1);
        assert_eq!(queue.opens[0].label, "logbook");
        assert!(queue.refresh.contains_key(&WorkspaceWindowScope::NormalLogging));
        assert!(!queue.refresh.contains_key(&WorkspaceWindowScope::Contesting));
    }
    #[test]
    fn saved_contest_refresh_queued_after_reset_survives_the_rejection_boundary() {
        let mut queue = Queue::default();
        let stale = contest_context("20000000-0000-4000-8000-000000000001");
        let current = contest_context("20000000-0000-4000-8000-000000000002");
        queue.refresh(WorkspaceWindowScope::Contesting, Some(stale), false).unwrap();

        queue.reject_contest_work();
        let attempt = queue.refresh(
            WorkspaceWindowScope::Contesting, Some(current.clone()), false).unwrap();

        let Some(Work::Refresh(refresh)) = queue.next() else { panic!("missing restored contest refresh") };
        assert_eq!(refresh.attempt, attempt);
        assert_eq!(refresh.contest_context, Some(current));
        assert!(!refresh.force);
    }
    #[test]
    fn session_replacement_resets_only_the_contest_engine() {
        let mut engines = BTreeMap::from([(WorkspaceWindowScope::NormalLogging, Engine::default())]);
        let first = contest_context("20000000-0000-4000-8000-000000000001");
        let second = contest_context("20000000-0000-4000-8000-000000000002");
        let engine = engine_for(&mut engines, WorkspaceWindowScope::Contesting, Some(&first));
        let plan = engine.planner.plan(&contest_layout(1, &["logbook"]), false).unwrap();
        engine.planner.acknowledge_show("contest--logbook").unwrap(); engine.planner.complete(&plan);
        assert!(engine.planner.plan(&contest_layout(1, &["logbook"]), false).unwrap().show.is_empty());
        let replaced = engine_for(&mut engines, WorkspaceWindowScope::Contesting, Some(&second));
        assert_eq!(replaced.contest_context, Some(second));
        assert_eq!(replaced.planner.plan(&contest_layout(1, &["logbook"]), false).unwrap().show, ["contest--logbook"]);
        assert!(engines.contains_key(&WorkspaceWindowScope::NormalLogging));
    }

    #[test]
    fn same_context_reopen_preserves_contest_engine_and_managed_windows() {
        let mut engines = BTreeMap::from([(WorkspaceWindowScope::NormalLogging, Engine::default())]);
        let context = contest_context("20000000-0000-4000-8000-000000000001");
        let engine = engine_for(&mut engines, WorkspaceWindowScope::Contesting, Some(&context));
        let plan = engine.planner.plan(&contest_layout(1, &["logbook"]), false).unwrap();
        engine.planner.acknowledge_show("contest--logbook").unwrap(); engine.planner.complete(&plan);

        assert!(contest_engine_matches(&engines, &context));
        let retained = engines.get_mut(&WorkspaceWindowScope::Contesting).unwrap();
        assert!(retained.planner.plan(&contest_layout(1, &["logbook"]), false).unwrap().show.is_empty());
    }

    #[test]
    fn stale_dequeued_work_cannot_replace_current_contest_engine_or_outcome() {
        let mut engines = BTreeMap::from([(WorkspaceWindowScope::NormalLogging, Engine::default())]);
        let old = contest_context("20000000-0000-4000-8000-000000000001");
        let current = contest_context("20000000-0000-4000-8000-000000000002");
        let current_engine = engine_for(&mut engines, WorkspaceWindowScope::Contesting, Some(&current));
        current_engine.outcome["attempt"] = json!(42);
        current_engine.outcome["state"] = json!("applied");
        let current_outcome = current_engine.outcome.clone();
        let mut outcomes = BTreeMap::from([(WorkspaceWindowScope::Contesting,
            (Some(current.clone()), current_outcome.clone()))]);

        assert!(engine_for_after_admission(&mut engines, WorkspaceWindowScope::Contesting, Some(&old),
            Err("expired".into())).is_err());
        assert!(insert_outcome_after_admission(&mut outcomes, WorkspaceWindowScope::Contesting, Some(old),
            json!({"state":"applying","attempt":43}), Err("expired".into())).is_err());

        let retained = engines.get(&WorkspaceWindowScope::Contesting).unwrap();
        assert_eq!(retained.contest_context, Some(current));
        assert_eq!(retained.outcome["attempt"], 42);
        assert_eq!(retained.outcome["state"], "applied");
        assert_eq!(outcomes.get(&WorkspaceWindowScope::Contesting).unwrap().1, current_outcome);
    }
    #[test]
    fn in_flight_and_later_coalesced_refreshes_have_distinct_tickets() {
        let mut queue = Queue::default();
        assert_eq!(queue_refresh(&mut queue, false).unwrap(), 1);
        let Some(Work::Refresh(first)) = queue.next() else {
            panic!("missing first refresh")
        };
        assert_eq!(queue_refresh(&mut queue, true).unwrap(), 2);
        assert_eq!(queue_refresh(&mut queue, false).unwrap(), 3);
        assert_eq!(first.attempt, 1);
        assert!(!first.force);
        assert!(matches!(
            queue.next(),
            Some(Work::Refresh(PendingRefresh {
                scope: WorkspaceWindowScope::NormalLogging,
                contest_context: None,
                force: true,
                attempt: 3
            }))
        ));
        assert!(queue.next().is_none());
    }
    #[test]
    fn ticket_exhaustion_preserves_the_already_accepted_queue_entry() {
        let mut queue = Queue {
            issued_attempt: MAX_ATTEMPT - 1,
            ..Queue::default()
        };
        assert_eq!(queue_refresh(&mut queue, false).unwrap(), MAX_ATTEMPT);
        assert!(queue_refresh(&mut queue, true).is_err());
        assert_eq!(queue.issued_attempt, MAX_ATTEMPT);
        assert!(matches!(
            queue.next(),
            Some(Work::Refresh(PendingRefresh {
                scope: WorkspaceWindowScope::NormalLogging,
                contest_context: None,
                force: false,
                attempt: MAX_ATTEMPT
            }))
        ));
        assert!(queue.next().is_none());
    }
    #[test]
    fn attempt_identifies_begin_and_terminal_outcome_but_not_manual_opens() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &["logbook"])]);
        let initial = engine.outcome.clone();
        assert_eq!(initial["attempt"], 0);
        engine.open(&mut host, "awards").unwrap();
        assert_eq!(engine.outcome, initial);
        engine.begin(42);
        assert_eq!(engine.outcome["attempt"], 42);
        assert_eq!(engine.outcome["state"], "applying");
        engine.reconcile(&mut host, false).unwrap();
        assert_eq!(engine.outcome["attempt"], 42);
        assert_eq!(engine.outcome["state"], "applied");
        // An accepted ticket does not itself update observed completion.
        let completed = engine.outcome.clone();
        let mut queue = Queue {
            issued_attempt: 42,
            ..Queue::default()
        };
        assert_eq!(queue_refresh(&mut queue, true).unwrap(), 43);
        assert_eq!(engine.outcome, completed);
        engine.begin(43);
        host.fail_show = Some("logbook".into());
        assert!(engine.reconcile(&mut host, true).is_err());
        assert_eq!(engine.outcome["attempt"], 43);
        assert_eq!(engine.outcome["state"], "error");
        let failed = engine.outcome.clone();
        engine.open(&mut host, "awards").unwrap();
        assert_eq!(engine.outcome, failed);
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
        assert!(checked_response(valid.clone(), "load", WorkspaceWindowScope::NormalLogging, None).is_ok());
        assert!(checked_response(valid, "other", WorkspaceWindowScope::NormalLogging, None).is_err());
        assert!(checked_response(
            json!({"id":"load","ok":false,"error":{"message":"failed"}}),
            "load", WorkspaceWindowScope::NormalLogging, None
        )
        .is_err());
        assert!(checked_response(json!({"id":"load","ok":true,"result":{}}), "load", WorkspaceWindowScope::NormalLogging, None).is_err());

        let tagged = json!({"id":"load","ok":true,"result":{"layout":contest_layout(1, &[])}});
        assert!(checked_response(tagged.clone(), "load", WorkspaceWindowScope::NormalLogging, None).is_err());
        assert!(checked_response(tagged.clone(), "load", WorkspaceWindowScope::Contesting,
            Some("12345678-1234-1234-1234-123456789abc")).is_ok());
        assert!(checked_response(tagged, "load", WorkspaceWindowScope::Contesting,
            Some("12345678-1234-1234-1234-123456789abd")).is_err());
        let untagged = json!({"id":"load","ok":true,"result":{"layout":layout(1, &[])}});
        assert!(checked_response(untagged, "load", WorkspaceWindowScope::Contesting,
            Some("12345678-1234-1234-1234-123456789abc")).is_err());
    }
    #[test]
    fn contest_menu_scopes_remote_vfo_and_reuses_only_the_rotor_window() {
        let mut engine = Engine::default();
        let mut host = FakeHost::new(vec![layout(1, &[])]);
        for panel in ["rotor"] {
            let label = contest_open_label(panel).unwrap();
            assert_eq!(label, panel);
            assert!(supports(&label));
            engine.open(&mut host, &label).unwrap();
            engine.open(&mut host, &label).unwrap();
            assert_eq!(&host.operations[host.operations.len() - 2..],
                [format!("show:{panel}:true"), format!("show:{panel}:true")]);
        }
        assert_eq!(host.layouts.len(), 1);
        for panel in ["active-qso", "callsign-intelligence", "propagation", "monitor", "awards", "chaser-dx", "logbook", "band-maps", "dx-cluster", "station-control"] {
            assert_eq!(contest_open_label(panel).unwrap(), format!("contest--{panel}"));
            assert!(crate::workspace_navigation::contest_shared_window(panel).is_none());
        }
        assert!(supports("band-maps"));
        assert!(supports("dx-cluster"));
        for panel in ["cw", "log-qso", "settings", "alerts", "contest--rotor", "band-maps-20m", ""] {
            assert!(contest_open_label(panel).is_err());
        }
    }

    #[test]
    fn explicit_contest_open_shows_only_requested_tool_without_loading_layout() {
        let mut engine = Engine::for_scope(WorkspaceWindowScope::Contesting);
        let mut host = FakeHost::new(vec![contest_layout(1, &["active-qso", "logbook"])]);
        engine.open(&mut host, "contest--callsign-intelligence").unwrap();
        assert_eq!(host.operations, ["show:contest--callsign-intelligence:true"]);
        assert_eq!(host.layouts.len(), 1);
    }
    #[test]
    fn remembered_manual_contest_windows_reopen_without_becoming_layout_owned() {
        let mut engine = Engine::for_scope(WorkspaceWindowScope::Contesting);
        let mut host = FakeHost::new(vec![contest_layout(1, &[])]);
        engine.restore_manual(&mut host, &["contest--active-qso".into(), "contest--logbook".into()]).unwrap();
        reconcile(&mut engine, &mut host, false).unwrap();
        assert_eq!(host.operations, ["show:contest--active-qso:false", "show:contest--logbook:false"]);
        host.operations.clear();
        host.last = contest_layout(2, &[]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert!(host.operations.is_empty(), "manual restore must remain outside portable layout ownership");
    }

    #[test]
    fn contest_engine_uses_scoped_labels_for_reconcile_and_reopen() {
        let mut engine = Engine::for_scope(WorkspaceWindowScope::Contesting);
        let mut host = FakeHost::new(vec![contest_layout(1, &["active-qso", "logbook"])]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert_eq!(host.operations, ["show:contest--active-qso:false", "show:contest--logbook:false"]);
        host.operations.clear();
        host.last = contest_layout(2, &["logbook"]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert_eq!(host.operations, ["show:contest--logbook:false", "hide:contest--active-qso"]);
        host.operations.clear();
        host.last = contest_layout(3, &["active-qso", "logbook"]);
        reconcile(&mut engine, &mut host, false).unwrap();
        assert_eq!(host.operations, ["show:contest--active-qso:false", "show:contest--logbook:false"]);
    }
    #[test]
    fn contest_context_retirement_targets_only_scoped_children_never_main() {
        let labels = contest_window_labels();
        assert_eq!(labels.len(), crate::workspace_windows::CONTEST_WINDOWS.len());
        assert!(labels.iter().all(|label| label.starts_with("contest--")));
        assert!(labels.iter().any(|label| label == "contest--edit-contact"));
        assert!(labels.iter().any(|label| label == "contest--qrz-details"));
        assert!(contest_retirement_force_destroys("contest--edit-contact"));
        assert!(!contest_retirement_force_destroys("contest--logbook"));
        assert!(!labels.iter().any(|label| label == "main" || crate::workspace_windows::supports(label)));
    }
}
