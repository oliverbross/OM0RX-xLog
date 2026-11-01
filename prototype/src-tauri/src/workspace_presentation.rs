//! App-local presentation intent, never station or workspace mutation authority.
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};

const MAX_TICKET: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Intent { Passive, Reveal, Focus, ModeSwitch }

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Request { ticket: u64, intent: Intent }

#[derive(Clone, Copy)]
struct State { ticket: u64, intent: Intent }

pub(crate) struct Sequence(Mutex<State>);
impl Sequence {
    pub(crate) const fn new() -> Self { Self(Mutex::new(State { ticket: 0, intent: Intent::Passive })) }
    fn state(&self) -> State { *self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner) }
    pub(crate) fn passive(&self) -> Request { Request { ticket: self.state().ticket, intent: Intent::Passive } }
    pub(crate) fn claim(&self, intent: Intent) -> Result<Request, String> {
        if intent == Intent::Passive { return Ok(self.passive()); }
        let mut state = self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let ticket = state.ticket.checked_add(1).filter(|ticket| *ticket <= MAX_TICKET)
            .ok_or("Window presentation intents exhausted; restart the application.")?;
        *state = State { ticket, intent };
        Ok(Request { ticket, intent })
    }
    fn reserved(&self, ticket: u64, mode: bool) -> Result<Request, String> {
        let state = self.state();
        if ticket == 0 || ticket > state.ticket { return Err("Invalid native window presentation ticket.".into()); }
        if ticket == state.ticket {
            if (mode && state.intent != Intent::ModeSwitch)
                || (!mode && !matches!(state.intent, Intent::Reveal | Intent::ModeSwitch)) {
                return Err("The native presentation ticket has a different purpose.".into());
            }
            return Ok(Request { ticket, intent: state.intent });
        }
        // Old app-lifetime reservations are quiet supersession, not a new claim.
        Ok(Request { ticket, intent: if mode { Intent::ModeSwitch } else { Intent::Reveal } })
    }
    pub(crate) fn current(&self, request: Request) -> bool { self.state().ticket == request.ticket }
}

static SEQUENCE: Sequence = Sequence::new();

/// Both existing layout bridges normalize here. Validate before removing any
/// metadata; the canonical request still passes its ordinary caller/context gates.
pub(crate) fn take_layout_ticket(request: &mut serde_json::Value) -> Result<Option<u64>, String> {
    let envelope = request.get("presentationTicket");
    let embedded = request.get("params").and_then(|params| params.get("presentationTicket"));
    if envelope.is_none() && embedded.is_none() { return Ok(None); }
    if request["method"] != "workspace_layout_apply" {
        return Err("Presentation metadata is only valid for a layout application.".into());
    }
    if envelope.is_some() && embedded.is_some() && envelope != embedded {
        return Err("Conflicting native layout presentation tickets.".into());
    }
    let ticket = envelope.or(embedded).and_then(serde_json::Value::as_u64)
        .filter(|ticket| *ticket > 0 && *ticket <= MAX_TICKET)
        .ok_or("Invalid native layout presentation ticket.")?;
    if let Some(object) = request.as_object_mut() { object.remove("presentationTicket"); }
    if let Some(params) = request.get_mut("params").and_then(serde_json::Value::as_object_mut) {
        params.remove("presentationTicket");
    }
    Ok(Some(ticket))
}

impl Request {
    pub(crate) fn passive() -> Self { SEQUENCE.passive() }
    pub(crate) fn claim(intent: Intent) -> Result<Self, String> { SEQUENCE.claim(intent) }
    pub(crate) fn reserved_mode(ticket: u64) -> Result<Self, String> { SEQUENCE.reserved(ticket, true) }
    pub(crate) fn reserved_reveal(ticket: u64) -> Result<Self, String> { SEQUENCE.reserved(ticket, false) }
    pub(crate) fn ticket(self) -> u64 { self.ticket }
    pub(crate) fn is_current(self) -> bool { SEQUENCE.current(self) }
    pub(crate) fn intent(self) -> Intent { self.intent }
    pub(crate) fn is_explicit(self) -> bool { self.intent != Intent::Passive }
    /// A confirmed user layout activation may return to Canvas using its
    /// original ticket, without manufacturing a later foreground intent.
    pub(crate) fn as_mode_switch(self) -> Self { Self { intent: Intent::ModeSwitch, ..self } }
}

fn coalesce_at(previous: Option<Request>, incoming: Request, current: u64) -> Request {
    match previous.filter(|previous| previous.ticket == current) {
        Some(previous) if incoming.ticket != current || (previous.is_explicit() && !incoming.is_explicit()) => previous,
        _ => incoming,
    }
}
pub(crate) fn coalesce(previous: Option<Request>, incoming: Request) -> Request {
    coalesce_at(previous, incoming, SEQUENCE.state().ticket)
}

#[derive(Clone)]
pub(crate) struct DispatchGate(Arc<AtomicBool>);
impl DispatchGate {
    pub(crate) fn new() -> Self { Self(Arc::new(AtomicBool::new(true))) }
    pub(crate) fn cancel(&self) { self.0.store(false, Ordering::Release); }
    pub(crate) fn run<T>(&self, current: bool, action: impl FnOnce() -> T) -> Option<T> {
        (self.0.swap(false, Ordering::AcqRel) && current).then(action)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ExistingPlan { pub unminimize: bool, pub show: bool, pub focus: bool }
pub(crate) fn existing_plan(intent: Intent, current: bool, visible: bool, minimized: bool) -> ExistingPlan {
    if !current || intent == Intent::Passive || (intent != Intent::Focus && visible && !minimized) {
        return ExistingPlan::default();
    }
    ExistingPlan { unminimize: true, show: true, focus: intent == Intent::Focus }
}
pub(crate) fn focus_after_creation(intent: Intent, current: bool) -> bool { current && intent == Intent::Focus }

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowOutcome { pub created: bool, pub visible: bool, pub minimized: bool }
impl WindowOutcome {
    pub(crate) fn usable(self) -> bool { self.visible && !self.minimized }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ModePlan { pub hide_main: bool, pub reveal_main: bool, pub clear_main_override: bool }
pub(crate) fn mode_plan(intent: Intent, current: bool, main_reopened: bool, windows: bool, hide_requested: bool) -> ModePlan {
    if !current { return ModePlan::default(); }
    let explicit = intent == Intent::ModeSwitch;
    if windows && hide_requested {
        let hide_main = explicit || !main_reopened;
        ModePlan { hide_main, reveal_main: false, clear_main_override: explicit && hide_main }
    } else {
        // Background recovery/data hints can prevent hiding; they cannot activate
        // an operator-hidden/minimized canvas. Open/actual mode switch is explicit.
        ModePlan { reveal_main: explicit, ..ModePlan::default() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn passive_retained_windows_preserve_every_visibility_and_minimization_state() {
        for visible in [false, true] { for minimized in [false, true] {
            assert_eq!(existing_plan(Intent::Passive, true, visible, minimized), ExistingPlan::default());
        }}
    }
    #[test]
    fn explicit_apply_reveals_only_unusable_windows_and_explicit_open_focuses() {
        assert_eq!(existing_plan(Intent::Reveal, true, true, false), ExistingPlan::default());
        for (visible, minimized) in [(false, false), (true, true), (false, true)] {
            assert_eq!(existing_plan(Intent::Reveal, true, visible, minimized),
                ExistingPlan { unminimize: true, show: true, focus: false });
        }
        assert_eq!(existing_plan(Intent::Focus, true, true, false),
            ExistingPlan { unminimize: true, show: true, focus: true });
    }
    #[test]
    fn automatic_mode_presentation_cannot_hide_an_explicitly_reopened_main() {
        assert_eq!(mode_plan(Intent::Passive, true, true, true, true), ModePlan::default());
        assert!(mode_plan(Intent::Passive, true, false, true, true).hide_main);
        assert!(!mode_plan(Intent::Passive, true, false, false, false).reveal_main);
    }
    #[test]
    fn actual_mode_switch_can_hide_or_return_to_canvas() {
        let hidden = mode_plan(Intent::ModeSwitch, true, true, true, true);
        assert!(hidden.hide_main && hidden.clear_main_override);
        assert!(mode_plan(Intent::ModeSwitch, true, false, false, false).reveal_main);
    }
    #[test]
    fn late_automatic_completion_and_older_open_cannot_supersede_newer_main() {
        let sequence = Arc::new(Sequence::new());
        let old_open = sequence.claim(Intent::Focus).unwrap();
        let automatic = sequence.passive();
        let (entered, ready) = mpsc::channel(); let (release, resumed) = mpsc::channel();
        let background = sequence.clone();
        let job = std::thread::spawn(move || {
            entered.send(()).unwrap();
            resumed.recv_timeout(Duration::from_secs(2)).unwrap();
            (mode_plan(automatic.intent, background.current(automatic), true, true, true),
                existing_plan(old_open.intent, background.current(old_open), true, false))
        });
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        let main = sequence.claim(Intent::Focus).unwrap();
        release.send(()).unwrap();
        assert_eq!(job.join().unwrap(), (ModePlan::default(), ExistingPlan::default()));
        assert!(sequence.current(main));
    }
    #[test]
    fn a_mode_reservation_remains_old_across_persistence_and_queue_delays() {
        let sequence = Sequence::new();
        let mode = sequence.claim(Intent::ModeSwitch).unwrap();
        assert!(mode_plan(mode.intent, sequence.current(mode), true, true, true).hide_main);
        let main = sequence.claim(Intent::Focus).unwrap();
        let delayed = sequence.reserved(mode.ticket, true).unwrap();
        assert_eq!(delayed.ticket, mode.ticket);
        assert_eq!(mode_plan(delayed.intent, sequence.current(delayed), true, true, true), ModePlan::default());
        assert!(sequence.current(main));
    }
    #[test]
    fn a_confirmed_layout_activation_reuses_its_ticket_for_explicit_canvas_return() {
        let sequence = Sequence::new();
        let layout = sequence.claim(Intent::Reveal).unwrap();
        let mode = layout.as_mode_switch();
        assert_eq!(mode.ticket, layout.ticket);
        assert!(mode_plan(mode.intent, sequence.current(mode), false, false, false).reveal_main);
        sequence.claim(Intent::Focus).unwrap();
        assert_eq!(mode_plan(mode.intent, sequence.current(mode), true, false, false), ModePlan::default());
    }
    #[test]
    fn preserved_hidden_or_minimized_windows_are_not_usable_shown_results() {
        assert!(!WindowOutcome { created: false, visible: false, minimized: false }.usable());
        assert!(!WindowOutcome { created: false, visible: true, minimized: true }.usable());
        assert!(WindowOutcome { created: false, visible: true, minimized: false }.usable());
    }
    #[test]
    fn fresh_window_completion_only_focuses_the_latest_explicit_open() {
        assert!(!focus_after_creation(Intent::Passive, true));
        assert!(!focus_after_creation(Intent::Reveal, true));
        assert!(!focus_after_creation(Intent::ModeSwitch, true));
        assert!(!focus_after_creation(Intent::Focus, false));
        assert!(focus_after_creation(Intent::Focus, true));
    }
    #[test]
    fn invalid_future_tickets_and_current_wrong_purpose_fail_without_claiming() {
        let sequence = Sequence::new();
        assert!(sequence.reserved(1, true).is_err());
        let focus = sequence.claim(Intent::Focus).unwrap();
        assert!(sequence.reserved(0, true).is_err());
        assert!(sequence.reserved(focus.ticket, true).is_err());
        assert!(sequence.current(focus));
    }
    #[test]
    fn normal_and_contest_bridges_strip_only_validated_ephemeral_metadata() {
        for embedded in [false, true] {
            let mut frame = serde_json::json!({"id":"request", "method":"workspace_layout_apply",
                "params":{"action":"activatePreset", "presetID":"windowed", "scope":"contesting"}});
            if embedded { frame["params"]["presentationTicket"] = 17.into(); }
            else { frame["presentationTicket"] = 17.into(); }
            assert_eq!(take_layout_ticket(&mut frame).unwrap(), Some(17));
            assert_eq!(frame, serde_json::json!({"id":"request", "method":"workspace_layout_apply",
                "params":{"action":"activatePreset", "presetID":"windowed", "scope":"contesting"}}));
        }
    }
    #[test]
    fn conflicting_malformed_and_wrong_method_metadata_remains_rejected() {
        for mut frame in [
            serde_json::json!({"method":"workspace_layout_apply","presentationTicket":3,"params":{"presentationTicket":4}}),
            serde_json::json!({"method":"workspace_layout_apply","params":{"presentationTicket":true}}),
            serde_json::json!({"method":"workspace_layout_apply","presentationTicket":0}),
            serde_json::json!({"method":"workspace_layout_apply","presentationTicket":9_007_199_254_740_992u64}),
            serde_json::json!({"method":"station_action","presentationTicket":3,"params":{"action":"connect"}}),
        ] {
            let before = frame.clone();
            assert!(take_layout_ticket(&mut frame).is_err());
            assert_eq!(frame, before);
        }
    }
    #[test]
    fn a_late_stale_explicit_refresh_cannot_replace_the_current_queued_reveal() {
        let sequence = Sequence::new();
        let old = sequence.claim(Intent::Reveal).unwrap();
        let current = sequence.claim(Intent::Reveal).unwrap();
        assert_eq!(coalesce_at(Some(current), old, sequence.state().ticket), current);
        assert_eq!(coalesce_at(Some(current), sequence.passive(), sequence.state().ticket), current);
        assert_eq!(coalesce_at(Some(old), current, sequence.state().ticket), current);
    }
    #[test]
    fn a_queued_ui_callback_checks_supersession_when_it_actually_executes() {
        let sequence = Sequence::new();
        let old = sequence.claim(Intent::Focus).unwrap();
        let gate = DispatchGate::new();
        sequence.claim(Intent::Focus).unwrap();
        assert!(gate.run(sequence.current(old), || panic!("retired UI callback mutated a window")).is_none());
    }
    #[test]
    fn delayed_canvas_setup_geometry_and_reopen_deliveries_preserve_a_newer_main() {
        for operation in ["canvas-show", "canvas-close", "contest-setup", "geometry", "single-instance", "dock-reopen", "retained-startup"] {
            let sequence = Arc::new(Sequence::new());
            let original = sequence.claim(Intent::ModeSwitch).unwrap();
            let (ready, entered) = mpsc::channel();
            let (release, resume) = mpsc::channel();
            let background = sequence.clone();
            let task = std::thread::spawn(move || {
                // Model completed preflight/build queued for native delivery.
                let gate = DispatchGate::new();
                ready.send(()).unwrap();
                resume.recv_timeout(Duration::from_secs(2)).unwrap();
                gate.run(background.current(original), || operation)
            });
            entered.recv_timeout(Duration::from_secs(2)).unwrap();
            let main = sequence.claim(Intent::Focus).unwrap();
            release.send(()).unwrap();
            assert_eq!(task.join().unwrap(), None, "late {operation} changed the foreground");
            assert!(sequence.current(main));
        }
    }
    #[test]
    fn timeout_cancellation_prevents_a_late_callback_and_dispatch_is_once_only() {
        let gate = DispatchGate::new(); gate.cancel();
        assert!(gate.run(true, || panic!("timed out UI callback mutated a window")).is_none());
        let gate = DispatchGate::new();
        assert_eq!(gate.run(true, || 3), Some(3));
        assert!(gate.run(true, || panic!("callback ran twice")).is_none());
    }
}
