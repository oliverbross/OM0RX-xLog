//! Retained automatic-turn authority. No timer, provider connection or second
//! rotor transport lives here. Callers supply canonical reads and lookup work.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc, Mutex, OnceLock, Weak};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Target {
    pub generation: String,
    pub draft_id: String,
    pub call: String,
}
impl Target {
    pub fn from_snapshot(draft: &Value) -> Result<Self, String> {
        Self { generation: draft["generation"].as_str().unwrap_or("").into(),
            draft_id: draft["qso"]["id"].as_str().unwrap_or("").into(),
            call: draft["qso"]["call"].as_str().unwrap_or("").into() }.normalized()
    }
    fn normalized(mut self) -> Result<Self, String> {
        self.generation = uuid::Uuid::parse_str(&self.generation).map_err(|_| "Automatic rotor workspace is invalid.")?.to_string();
        self.draft_id = uuid::Uuid::parse_str(&self.draft_id).map_err(|_| "Automatic rotor draft is invalid.")?.to_string();
        self.call = self.call.trim().to_uppercase();
        if self.call.len() > 64 || self.call.chars().any(char::is_control) { return Err("Automatic rotor callsign is invalid.".into()); }
        Ok(self)
    }
}

#[derive(Default)]
struct State {
    canonical_pending: usize,
    sequence: u64,
    target: Option<Target>,
    activation: bool,
    confirmed: bool,
    attempted: Option<String>,
    attempted_target: Option<Target>,
    unconfirmed: Option<Target>,
    owner: Option<String>,
    generation: Option<u64>,
    error: String,
}
pub struct AutomaticRotor {
    armed: AtomicBool,
    epoch: AtomicU64,
    state: Mutex<State>,
}
/// Not deserializable and never minted by a renderer. Clones retain the same
/// one-shot intent identity, not a new right to move.
#[derive(Clone)]
pub struct Permit {
    authority: Weak<AutomaticRotor>,
    epoch: u64,
    sequence: u64,
    target: Target,
    owner: Option<String>,
    generation: Option<u64>,
    intent: String,
}
/// Retain through a canonical mutation, including an uncertain reply. Its drop
/// only releases admission; callers still decide whether to reconcile again.
pub struct CanonicalChange { authority: Arc<AutomaticRotor> }
impl Drop for CanonicalChange {
    fn drop(&mut self) {
        self.authority.epoch.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut state) = self.authority.state.lock() {
            state.canonical_pending = state.canonical_pending.saturating_sub(1);
            state.sequence = state.sequence.wrapping_add(1); state.target = None;
            state.activation = false; state.confirmed = false; state.attempted = None;
        }
    }
}
impl AutomaticRotor {
    fn new() -> Self { Self { armed: AtomicBool::new(false), epoch: AtomicU64::new(0), state: Mutex::new(State::default()) } }
    fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Automatic rotor state unavailable")?;
        Ok(json!({"armed":self.armed.load(Ordering::Acquire),"epoch":self.epoch.load(Ordering::Acquire),
            "owner":state.owner,"generation":state.generation,"target":state.target,
            "activation_pending":state.activation && !state.confirmed,"canonical_pending":state.canonical_pending > 0,"error":state.error}))
    }
    fn arm(&self, owner: &str, generation: u64) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "Automatic rotor state unavailable")?;
        self.epoch.fetch_add(1, Ordering::AcqRel);
        state.owner = Some(owner.into()); state.generation = Some(generation);
        state.attempted = None; state.attempted_target = None; state.error.clear();
        self.armed.store(true, Ordering::Release);
        drop(state); self.snapshot()
    }
    pub(crate) fn revoke(&self) {
        // Revoke before taking any lock: a queued automatic turn cannot become
        // valid while a manual Stop waits behind an already-admitted driver RPC.
        self.armed.store(false, Ordering::Release);
        self.epoch.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut state) = self.state.lock() { state.attempted = None; state.error.clear(); }
    }
    fn note_reconcile_error(&self, expected_epoch: u64, error: &str) {
        if let Ok(mut state) = self.state.lock() {
            if self.armed.load(Ordering::Acquire) && self.epoch.load(Ordering::Acquire) == expected_epoch {
                state.error = error.chars().take(1024).collect();
            }
        }
    }
    fn fail_permit(&self, permit: &Permit, error: &str) {
        if let Ok(mut state) = self.state.lock() {
            if self.epoch.load(Ordering::Acquire) == permit.epoch && state.sequence == permit.sequence {
                self.armed.store(false, Ordering::Release);
                self.epoch.fetch_add(1, Ordering::AcqRel);
                state.attempted = None; state.error = error.chars().take(1024).collect();
            }
        }
    }
    fn canonical_will_change(self: &Arc<Self>) -> CanonicalChange {
        self.epoch.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut state) = self.state.lock() {
            state.canonical_pending += 1;
            state.sequence = state.sequence.wrapping_add(1); state.target = None;
            state.activation = false; state.confirmed = false; state.attempted = None;
        }
        CanonicalChange { authority: self.clone() }
    }
    fn begin(self: &Arc<Self>, target: Target, activation: bool, rotor: Option<(String, u64)>) -> Result<Permit, String> {
        let target = target.normalized()?;
        let mut state = self.state.lock().map_err(|_| "Automatic rotor state unavailable")?;
        if activation { state.unconfirmed = Some(target.clone()); }
        if activation || state.target.as_ref() != Some(&target) {
            state.sequence = state.sequence.wrapping_add(1); state.target = Some(target.clone());
            state.activation = activation || state.unconfirmed.as_ref() == Some(&target);
            state.confirmed = !state.activation; state.attempted = None;
        }
        let (owner, generation) = rotor.map(|(owner, generation)| (Some(owner), Some(generation))).unwrap_or((None, None));
        Ok(Permit { authority: Arc::downgrade(self), epoch: self.epoch.load(Ordering::Acquire), sequence: state.sequence,
            target, owner, generation, intent: uuid::Uuid::new_v4().to_string() })
    }
    fn confirmed(&self, permit: &Permit) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Automatic rotor state unavailable")?;
        if state.sequence != permit.sequence || state.target.as_ref() != Some(&permit.target) {
            return Err("Automatic rotor target changed before tune confirmation.".into());
        }
        state.confirmed = true; state.unconfirmed = None; Ok(())
    }
    fn authorized(&self, permit: &Permit, claimed: bool) -> bool {
        if !self.armed.load(Ordering::Acquire) || self.epoch.load(Ordering::Acquire) != permit.epoch { return false; }
        let Ok(state) = self.state.lock() else { return false; };
        state.canonical_pending == 0 && state.sequence == permit.sequence && state.target.as_ref() == Some(&permit.target) && state.confirmed &&
            (!claimed || state.attempted.as_deref() == Some(&permit.intent))
    }
    fn turn(self: &Arc<Self>, permit: &Permit, read: impl Fn() -> Result<Target, String>,
            lookup: impl Fn(&str) -> Result<Value, String>, dispatch: impl FnOnce(&Permit, f64) -> Result<Value, String>) -> Result<Value, String> {
        if permit.target.call.is_empty() || permit.owner.is_none() || !self.authorized(permit, false) {
            return Ok(json!({"requested":false,"skipped":"Automatic rotor is off, changed, or waiting for confirmed tuning."}));
        }
        {
            let state = self.state.lock().map_err(|_| "Automatic rotor state unavailable")?;
            if state.attempted.is_some() || state.attempted_target.as_ref() == Some(&permit.target) {
                return Ok(json!({"requested":false,"skipped":"This target already has an automatic turn attempt."}));
            }
        }
        // No authority/coordinator mutex is held across caller-supplied work.
        if read()?.normalized()? != permit.target { return Err("Canonical QSO changed before automatic lookup.".into()); }
        let target = lookup(&permit.target.call)?;
        let bearing = target["bearing"].as_f64().filter(|value| value.is_finite() && (0.0..=360.0).contains(value));
        if target["call"].as_str().map(|call| call.trim().to_uppercase()).as_deref() != Some(&permit.target.call) || bearing.is_none() {
            return Err("Automatic rotor lookup did not match the current callsign and bearing.".into());
        }
        if read()?.normalized()? != permit.target { return Err("Canonical QSO changed during automatic lookup.".into()); }
        {
            let mut state = self.state.lock().map_err(|_| "Automatic rotor state unavailable")?;
            if !self.armed.load(Ordering::Acquire) || self.epoch.load(Ordering::Acquire) != permit.epoch ||
                state.canonical_pending != 0 || state.sequence != permit.sequence || state.target.as_ref() != Some(&permit.target) || !state.confirmed {
                return Err("Automatic rotor permission was revoked during lookup.".into());
            }
            if state.attempted.is_some() || state.attempted_target.as_ref() == Some(&permit.target) {
                return Ok(json!({"requested":false,"skipped":"This target already has an automatic turn attempt."}));
            }
            // Claim before transport. A lost reply is not permission to replay.
            state.attempted = Some(permit.intent.clone());
            state.attempted_target = Some(permit.target.clone());
        }
        match dispatch(permit, bearing.unwrap()) {
            Ok(result) => {
                if let Ok(mut state) = self.state.lock() {
                    if self.epoch.load(Ordering::Acquire) == permit.epoch && state.sequence == permit.sequence {
                        state.generation = result["generation"].as_u64().or(state.generation);
                        state.error.clear();
                    }
                }
                Ok(json!({"requested":true,"result":result}))
            }
            Err(error) => {
                self.fail_permit(permit, &error);
                Err(error)
            }
        }
    }
}

pub(crate) fn owner() -> &'static Arc<AutomaticRotor> {
    static OWNER: OnceLock<Arc<AutomaticRotor>> = OnceLock::new();
    OWNER.get_or_init(|| Arc::new(AutomaticRotor::new()))
}
pub fn snapshot() -> Result<Value, String> { owner().snapshot() }
pub fn set_armed(armed: bool, expected_owner: Option<&str>, expected_generation: Option<u64>) -> Result<Value, String> {
    if !armed { revoke(); return snapshot(); }
    let expected_owner = expected_owner.ok_or("Observe a connected rotor before enabling automatic turns.")?;
    let expected_generation = expected_generation.ok_or("Observe the rotor generation before enabling automatic turns.")?;
    crate::rotor::with_automatic_owner(expected_owner, expected_generation, || owner().arm(expected_owner, expected_generation))
}
pub fn revoke() { owner().revoke(); }
pub fn note_reconcile_error(expected_epoch: u64, error: &str) { owner().note_reconcile_error(expected_epoch, error); }
pub fn canonical_will_change() -> CanonicalChange { owner().canonical_will_change() }
pub fn activation_started(target: Target) -> Result<Permit, String> {
    // An optional busy/unavailable rotor must not prevent loading a QSO or
    // tuning the independently selected radio. No rotor permit is minted.
    let rotor = if owner().armed.load(Ordering::Acquire) { crate::rotor::automatic_owner().unwrap_or(None) } else { None };
    owner().begin(target, true, rotor)
}
pub fn activation_confirmed(permit: &Permit) -> Result<(), String> {
    permit.authority.upgrade().ok_or("Automatic rotor owner retired")?.confirmed(permit)
}
/// Bind the effect to the same already-running worker which supplied the
/// canonical draft/lease. Generation is checked again at driver dispatch.
pub fn complete_activation_generation(permit: &Permit, expected_worker: u64,
    read: impl Fn() -> Result<Target, String>, lookup: impl Fn(&str) -> Result<Value, String>) -> Result<Value, String> {
    let authority = permit.authority.upgrade().ok_or("Automatic rotor owner retired")?;
    authority.turn(permit, read, lookup, |permit, bearing| crate::rotor::request_automatic_generation(permit, bearing, expected_worker))
}
pub fn reconcile_generation(expected_worker: u64, read: impl Fn() -> Result<Target, String>,
    lookup: impl Fn(&str) -> Result<Value, String>) -> Result<Value, String> {
    if !owner().armed.load(Ordering::Acquire) { return Ok(json!({"requested":false,"skipped":"Automatic rotor is off."})); }
    let target = read()?;
    let permit = owner().begin(target, false, crate::rotor::automatic_owner()?)?;
    owner().turn(&permit, read, lookup, |permit, bearing| crate::rotor::request_automatic_generation(permit, bearing, expected_worker))
}
impl Permit {
    pub(crate) fn admits(&self) -> bool { self.authority.upgrade().is_some_and(|owner| owner.authorized(self, true)) }
    pub(crate) fn request(&self, bearing: f64) -> Result<Value, String> {
        Ok(json!({"id":self.intent,"method":"rotor_goto","params":{"owner":self.owner.as_ref().ok_or("Automatic rotor has no owner")?,
            "generation":self.generation.ok_or("Automatic rotor has no generation")?,"bearing":bearing,"label":self.target.call,"intent_id":self.intent}}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target(call: &str) -> Target {
        Target { generation: "10000000-0000-4000-8000-000000000001".into(),
            draft_id: "20000000-0000-4000-8000-000000000001".into(), call: call.into() }
    }
    fn armed() -> Arc<AutomaticRotor> {
        let owner = Arc::new(AutomaticRotor::new()); owner.arm("native_dcu1", 7).unwrap(); owner
    }
    fn begin(owner: &Arc<AutomaticRotor>, call: &str, activation: bool) -> Permit {
        owner.begin(target(call), activation, Some(("native_dcu1".into(), 7))).unwrap()
    }
    #[test]
    fn restart_off_and_activation_requires_current_confirmation() {
        let fresh = Arc::new(AutomaticRotor::new());
        assert_eq!(fresh.snapshot().unwrap()["armed"], false);
        let owner = armed(); let pending = begin(&owner, "om0rx", true);
        assert_eq!(owner.turn(&pending, || panic!("unconfirmed read"), |_| panic!("lookup"), |_, _| panic!("dispatch")).unwrap()["requested"], false);
        owner.confirmed(&pending).unwrap();
        let result = owner.turn(&pending, || Ok(target("OM0RX")), |call| Ok(json!({"call":call,"bearing":123})), |permit, bearing| {
            assert!(permit.admits()); assert_eq!(bearing, 123.0); Ok(json!({"generation":8}))
        }).unwrap();
        assert_eq!(result["requested"], true);
        assert_eq!(owner.snapshot().unwrap()["generation"], 8);
        assert_eq!(owner.turn(&pending, || panic!("duplicate read"), |_| panic!("lookup"), |_, _| panic!("dispatch")).unwrap()["requested"], false);
    }
    #[test]
    fn unavailable_optional_rotor_does_not_block_activation_confirmation() {
        let owner = armed(); let permit = owner.begin(target("OM0RX"), true, None).unwrap();
        owner.confirmed(&permit).unwrap();
        assert_eq!(owner.turn(&permit, || panic!("no rotor read"), |_| panic!("lookup"), |_, _| panic!("dispatch")).unwrap()["requested"], false);
    }
    #[test]
    fn reconcile_error_is_visible_only_for_its_current_armed_epoch() {
        let owner = armed(); let epoch = owner.epoch.load(Ordering::Acquire);
        owner.note_reconcile_error(epoch, "Local lookup unavailable");
        assert_eq!(owner.snapshot().unwrap()["error"], "Local lookup unavailable");
        owner.arm("native_dcu1", 7).unwrap(); owner.note_reconcile_error(epoch, "stale before Arm");
        assert_eq!(owner.snapshot().unwrap()["error"], "");
        let armed_epoch = owner.epoch.load(Ordering::Acquire); owner.revoke();
        owner.note_reconcile_error(armed_epoch, "stale before Stop");
        owner.note_reconcile_error(owner.epoch.load(Ordering::Acquire), "off does not report automatic follow errors");
        assert_eq!(owner.snapshot().unwrap()["error"], "");
    }
    #[test]
    fn obsolete_dispatch_failure_cannot_disarm_or_overwrite_newer_explicit_arm() {
        let owner = armed(); let permit = begin(&owner, "OM0RX", false);
        owner.turn(&permit, || Ok(target("OM0RX")), |_| Ok(json!({"call":"OM0RX","bearing":90})), |_, _| {
            // Simulate a new explicit Arm admitted after driver transport has
            // returned, before the old caller processes its failure.
            owner.arm("native_dcu1", 8).unwrap(); Err("obsolete lost reply".into())
        }).unwrap_err();
        assert_eq!(owner.snapshot().unwrap()["armed"], true); assert_eq!(owner.snapshot().unwrap()["generation"], 8);
        assert_eq!(owner.snapshot().unwrap()["error"], "");
    }
    #[test]
    fn stale_confirmation_and_same_call_new_workspace_cannot_turn() {
        let owner = armed(); let old = begin(&owner, "OM0RX", true);
        let _next = begin(&owner, "K1ABC", true);
        assert!(owner.confirmed(&old).is_err());
        let permit = begin(&owner, "OM0RX", false);
        let mut changed = target("OM0RX"); changed.generation = uuid::Uuid::new_v4().to_string();
        assert!(owner.turn(&permit, || Ok(changed.clone()), |_| panic!("lookup"), |_, _| panic!("dispatch")).is_err());
    }
    #[test]
    fn invalid_or_mismatched_lookup_and_changed_read_never_dispatch() {
        for bad in [json!({"call":"WRONG","bearing":12}), json!({"call":"OM0RX","bearing":361}), json!({"call":"OM0RX"})] {
            let owner = armed(); let permit = begin(&owner, "OM0RX", false);
            assert!(owner.turn(&permit, || Ok(target("OM0RX")), |_| Ok(bad.clone()), |_, _| panic!("dispatch")).is_err());
        }
        let owner = armed(); let permit = begin(&owner, "OM0RX", false);
        let reads = AtomicU64::new(0);
        assert!(owner.turn(&permit, || Ok(target(if reads.fetch_add(1, Ordering::AcqRel) == 0 { "OM0RX" } else { "K1ABC" })),
            |_| Ok(json!({"call":"OM0RX","bearing":90})), |_, _| panic!("dispatch")).is_err());
    }
    #[test]
    fn manual_revoke_and_canonical_mutation_during_lookup_cancel_permission() {
        for manual in [false, true] {
            let owner = armed(); let permit = begin(&owner, "OM0RX", false);
            assert!(owner.turn(&permit, || Ok(target("OM0RX")), |_| {
                if manual { owner.revoke(); } else { drop(owner.canonical_will_change()); }
                Ok(json!({"call":"OM0RX","bearing":90}))
            }, |_, _| panic!("dispatch")).is_err());
        }
    }
    #[test]
    fn in_flight_canonical_write_blocks_old_read_and_notes_do_not_repeat_a_turn() {
        let owner = armed(); let permit = begin(&owner, "OM0RX", false);
        owner.turn(&permit, || Ok(target("OM0RX")), |_| Ok(json!({"call":"OM0RX","bearing":90})), |_, _| Ok(json!({}))).unwrap();
        let writing = owner.canonical_will_change();
        let during = begin(&owner, "OM0RX", false);
        assert_eq!(owner.turn(&during, || panic!("pending read"), |_| panic!("lookup"), |_, _| panic!("dispatch")).unwrap()["requested"], false);
        drop(writing);
        let after = begin(&owner, "OM0RX", false);
        assert_eq!(owner.turn(&after, || panic!("same target read"), |_| panic!("lookup"), |_, _| panic!("dispatch")).unwrap()["requested"], false);
        assert_eq!(owner.snapshot().unwrap()["armed"], true);
    }
    #[test]
    fn failed_spot_tune_remains_blocked_after_same_call_notes_write() {
        let owner = armed(); let _unconfirmed = begin(&owner, "OM0RX", true);
        drop(owner.canonical_will_change());
        let same = begin(&owner, "OM0RX", false);
        assert_eq!(owner.turn(&same, || panic!("unconfirmed read"), |_| panic!("lookup"), |_, _| panic!("dispatch")).unwrap()["requested"], false);
        let changed = begin(&owner, "K1ABC", false);
        assert_eq!(owner.turn(&changed, || Ok(target("K1ABC")), |_| Ok(json!({"call":"K1ABC","bearing":90})), |_, _| Ok(json!({}))).unwrap()["requested"], true);
    }
    #[test]
    fn lost_motion_reply_disarms_without_replay() {
        let owner = armed(); let permit = begin(&owner, "OM0RX", false);
        assert!(owner.turn(&permit, || Ok(target("OM0RX")), |_| Ok(json!({"call":"OM0RX","bearing":90})), |_, _| Err("lost reply".into())).is_err());
        assert_eq!(owner.snapshot().unwrap()["armed"], false);
        assert_eq!(owner.turn(&permit, || panic!("read"), |_| panic!("lookup"), |_, _| panic!("retry")).unwrap()["requested"], false);
    }
    fn coordinator_fixture() -> (Arc<AutomaticRotor>, crate::rotor::RotorCoordinator, u64) {
        let owner = Arc::new(AutomaticRotor::new());
        let coordinator = crate::rotor::RotorCoordinator::with_authority(owner.clone());
        let connected = coordinator.handle(json!({"id":"connect","method":"rotor_connect","params":{"owner":"native_dcu1"}}),
            |request| Ok(json!({"id":request["id"],"ok":true,"result":{"connected":true}}))).unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        // A connect acknowledgement alone is not a fresh observed bearing.
        assert!(coordinator.with_automatic_owner("native_dcu1", generation, || owner.arm("native_dcu1", generation)).is_err());
        coordinator.handle(json!({"id":"observe","method":"rotor_snapshot","params":{}}),
            |request| Ok(json!({"id":request["id"],"ok":true,"result":{"connected":true,"azimuth":123}}))).unwrap();
        coordinator.with_automatic_owner("native_dcu1", generation, || owner.arm("native_dcu1", generation)).unwrap();
        (owner, coordinator, generation)
    }
    #[test]
    fn coordinator_rechecks_revoked_permission_at_driver_admission() {
        let (owner, coordinator, generation) = coordinator_fixture();
        let permit = owner.begin(target("OM0RX"), false, Some(("native_dcu1".into(), generation))).unwrap();
        owner.turn(&permit, || Ok(target("OM0RX")), |_| Ok(json!({"call":"OM0RX","bearing":90})), |permit, bearing| {
            assert!(permit.admits()); owner.revoke();
            assert!(coordinator.handle_automatic(permit.request(bearing).unwrap(), permit, |_| panic!("revoked driver call")).is_err());
            Err("revoked before admission".into())
        }).unwrap_err();
        assert_eq!(owner.snapshot().unwrap()["armed"], false);
    }
    #[test]
    fn native_stop_revokes_and_automatic_backend_failure_stays_uncertain() {
        let (owner, coordinator, generation) = coordinator_fixture();
        let permit = owner.begin(target("OM0RX"), false, Some(("native_dcu1".into(), generation))).unwrap();
        owner.turn(&permit, || Ok(target("OM0RX")), |_| Ok(json!({"call":"OM0RX","bearing":90})), |permit, bearing| {
            coordinator.handle_automatic(permit.request(bearing)?, permit, |_| Err("lost turn reply".into()))
        }).unwrap_err();
        assert_eq!(owner.snapshot().unwrap()["armed"], false);
        assert!(coordinator.automatic_owner().unwrap().is_none());
        coordinator.handle(json!({"id":"stop","method":"monitor_rotor_stop","params":{"owner":"native_dcu1"}}),
            |request| Ok(json!({"id":request["id"],"ok":true,"result":{"accepted":true}}))).unwrap();
        assert_eq!(owner.snapshot().unwrap()["armed"], false);
    }
    #[test]
    fn disconnected_readback_retires_arming_and_does_not_connect_anything() {
        let (owner, coordinator, _) = coordinator_fixture();
        coordinator.handle(json!({"id":"observe","method":"rotor_snapshot","params":{}}), |request| {
            assert_eq!(request["method"], "station_rotor_snapshot");
            Ok(json!({"id":request["id"],"ok":true,"result":{"connected":false}}))
        }).unwrap();
        assert_eq!(owner.snapshot().unwrap()["armed"], false);
        assert!(coordinator.automatic_owner().unwrap().is_none());
    }
    #[test]
    fn revocation_does_not_wait_for_admitted_driver_and_stop_stays_after_goto() {
        use std::sync::mpsc;
        use std::time::Duration;
        let (owner, coordinator, generation) = coordinator_fixture();
        let coordinator = Arc::new(coordinator);
        let permit = owner.begin(target("OM0RX"), false, Some(("native_dcu1".into(), generation))).unwrap();
        let order = Arc::new(Mutex::new(Vec::new()));
        let (entered, ready) = mpsc::channel(); let (release, released) = mpsc::channel();
        let moving_owner = owner.clone(); let moving = coordinator.clone(); let move_order = order.clone();
        let task = std::thread::spawn(move || moving_owner.turn(&permit, || Ok(target("OM0RX")),
            |_| Ok(json!({"call":"OM0RX","bearing":90})), |permit, bearing| {
                moving.handle_automatic(permit.request(bearing)?, permit, |request| {
                    move_order.lock().unwrap().push(request["method"].as_str().unwrap().to_owned());
                    entered.send(()).unwrap();
                    released.recv_timeout(Duration::from_secs(10)).expect("test must release fake driver");
                    Ok(json!({"id":request["id"],"ok":true,"result":{"accepted":true}}))
                })
            }));
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        let revoking = owner.clone(); let (done, revoked) = mpsc::channel();
        let revoker = std::thread::spawn(move || { revoking.revoke(); done.send(()).unwrap(); });
        let prompt = revoked.recv_timeout(Duration::from_secs(5));
        if prompt.is_err() { release.send(()).unwrap(); task.join().unwrap().unwrap(); revoker.join().unwrap(); panic!("revocation waited behind driver"); }
        assert_eq!(owner.snapshot().unwrap()["armed"], false);
        assert_eq!(*order.lock().unwrap(), ["station_rotor_goto"]);
        let stopping = coordinator.clone(); let stop_order = order.clone();
        let stop = std::thread::spawn(move || stopping.handle(json!({"id":"stop","method":"monitor_rotor_stop","params":{"owner":"native_dcu1"}}), |request| {
            stop_order.lock().unwrap().push(request["method"].as_str().unwrap().to_owned());
            Ok(json!({"id":request["id"],"ok":true,"result":{"accepted":true}}))
        }));
        release.send(()).unwrap(); task.join().unwrap().unwrap(); revoker.join().unwrap(); stop.join().unwrap().unwrap();
        assert_eq!(*order.lock().unwrap(), ["station_rotor_goto", "station_rotor_stop"]);
    }
}
