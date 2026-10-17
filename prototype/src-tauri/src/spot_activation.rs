//! One native activation transaction: prepare editors, commit draft, then effects.
//! The durable worker journal grants each effect once; uncertain replies never replay it.
use crate::spot_editor_barrier::EditorBarrier;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::{Arc, Mutex}, time::Duration};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request { pub operation_id: String, pub source_epoch: String, pub spot_id: String, pub spot_version: String }
impl Request {
    fn validate(&self) -> Result<(), String> {
        for id in [&self.operation_id, &self.source_epoch, &self.spot_version] {
            let id = uuid::Uuid::parse_str(id).map_err(|_| "Invalid spot activation identity.")?;
            if id.is_nil() { return Err("Invalid spot activation identity.".into()); }
        }
        if self.spot_id.is_empty() || self.spot_id.len() > 128 { return Err("Invalid spot identity.".into()); }
        Ok(())
    }
}

pub trait Backend: Send + Sync {
    fn draft_only(&self, _request: &Request) -> bool { false }
    fn resolve(&self, request: &Request) -> Result<Value, String>;
    fn canonical(&self) -> Result<Value, String>;
    fn open_editors(&self) -> Result<Vec<String>, String>;
    fn selection(&self) -> Result<Value, String>;
    fn apply(&self, request: &Request, base: &Value, spot: &Value) -> Result<Value, String>;
    fn stage(&self, request: &Request, applied: &Value, stage: &str) -> Result<Value, String>;
    /// Recheck the request's source token at actual native control admission,
    /// not merely when the possibly slow draft transaction was started.
    fn tune(&self, request: &Request, selection: &Value, spot: &Value, effect_started: &mut bool) -> Result<Value, String>;
    fn rotor(&self, request: &Request, applied: &Value) -> Result<Value, String>;
    fn finish(&self, request: &Request, applied: &Value, outcome: &str) -> Result<(), String>;
    fn durable_status(&self, request: &Request, generation: &str) -> Result<Value, String>;
    fn recover_missing(&self, _operation_id: &str) -> Result<Value, String> { Err("This activation cannot yet be retired safely. Check its durable receipt.".into()) }
    fn wake(&self);
}

struct Operation { request: Request, outcome: Value, generation: Option<String>, running: bool }
#[derive(Default)]
struct State { active: Option<String>, latest: Option<String>, operations: BTreeMap<String, Operation>, retired: BTreeMap<String, Value>, recovering: bool }
pub struct Coordinator { state: Mutex<State>, pub editors: Arc<EditorBarrier>, backend: Arc<dyn Backend> }
impl Coordinator {
    pub fn new(backend: Arc<dyn Backend>) -> Self { Self { state:Mutex::new(State::default()), editors:Arc::new(EditorBarrier::default()), backend } }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
        let mut result = state.active.as_ref().or(state.latest.as_ref()).and_then(|id| state.operations.get(id).map(|operation| operation.outcome.clone()).or_else(|| state.retired.get(id).cloned()))
            .unwrap_or_else(|| json!({"phase":"idle","operationId":null}));
        result["barrier"] = self.editors.snapshot()?; Ok(result)
    }
    pub fn status(&self, operation: &str) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
        state.operations.get(operation).map(|value| value.outcome.clone()).or_else(|| state.retired.get(operation).cloned())
            .ok_or_else(|| "This activation is not retained by this native session. Check the durable draft receipt; do not automatically tune again.".into())
    }
    /// Recovery only reads the durable receipt and releases an exact lease.
    /// It cannot apply a draft, stage an effect, tune, or turn the rotor.
    pub fn reconcile(&self, operation_id: &str) -> Result<Value, String> {
        if uuid::Uuid::parse_str(operation_id).is_err() { return Err("Invalid activation identity".into()); }
        {
            let mut state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
            if let Some(retired) = state.retired.get(operation_id) { return Ok(retired.clone()); }
            if !state.operations.contains_key(operation_id) {
                if state.active.is_some() || state.recovering { return Err("Another activation is active. Wait for it before retiring an old identity.".into()); }
                if state.operations.len() + state.retired.len() >= 4096 { return Err("Activation history is full. Restart safely before continuing.".into()); }
                state.recovering = true;
                state.latest = Some(operation_id.into());
                drop(state);
                let recovered = self.backend.recover_missing(operation_id);
                let mut state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
                state.recovering = false;
                let recovered = recovered?;
                if recovered["operationId"] != operation_id || recovered["reservationActive"] != false
                    || !matches!(recovered["phase"].as_str(), Some("blocked" | "confirmed" | "failed" | "uncertain")) {
                    return Err("Activation retirement could not be verified.".into());
                }
                state.retired.insert(operation_id.into(), recovered.clone());
                drop(state); self.backend.wake(); return Ok(recovered);
            }
        }
        let (request, generation) = {
            let state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
            let operation = state.operations.get(operation_id).ok_or("Activation outcome missing")?;
            if operation.running { return Err("This activation is still running. Wait for its outcome before reconciling a reservation.".into()); }
            if operation.outcome["reservationActive"] != true && operation.outcome["phase"] != "uncertain" { return Ok(operation.outcome.clone()); }
            (operation.request.clone(), operation.generation.clone().ok_or("Activation workspace unavailable")?)
        };
        let durable = self.backend.durable_status(&request, &generation)?;
        match durable["status"].as_str() {
            Some("found") if durable["leaseID"].is_string() => self.backend.finish(&request, &durable, "uncertain")?,
            Some("found") if matches!(durable["phase"].as_str(), Some("confirmed" | "failed" | "uncertain")) => {},
            // A plain missing receipt can race an earlier in-flight apply.
            // Only a transactional tombstone proves it can never arrive later.
            Some("abandoned") => {},
            _ => return Err("The activation reservation is still unverified. Editors remain protected.".into()),
        }
        // Keep native admission closed until the old editor barrier is gone.
        // No new activation may race into an obsolete pending barrier.
        self.editors.finish(operation_id)?;
        let mut state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
        let operation = state.operations.get_mut(operation_id).ok_or("Activation outcome missing")?;
        operation.outcome["reservationActive"] = json!(false);
        if let Some(draft) = durable.get("receipt").and_then(|receipt| receipt.get("draft")) {
            operation.outcome["draft"] = draft.clone();
        }
        if durable["phase"] == "confirmed" {
            operation.outcome["phase"] = json!("confirmed");
            operation.outcome["tuneConfirmed"] = json!(!self.backend.draft_only(&request));
            operation.outcome.as_object_mut().unwrap().remove("error");
        }
        let value = operation.outcome.clone();
        if state.active.as_deref() == Some(operation_id) { state.active = None; }
        drop(state); self.backend.wake(); Ok(value)
    }
    fn outcome(&self, request: &Request, phase: &str, draft: Option<&Value>, error: Option<&str>, rotor: &str, tune_confirmed: bool, reservation_active: bool) -> Value {
        let mut value = json!({"operationId":request.operation_id,"phase":phase,"draft":draft,
            "tuneConfirmed":tune_confirmed,"rotor":rotor,"reservationActive":reservation_active});
        if self.backend.draft_only(request) { value["draftOnly"] = json!(true); }
        if let Some(error) = error { value["error"] = json!(error); }
        value
    }
    fn record(&self, request: &Request, value: Value, wake: bool) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
        let operation = state.operations.get_mut(&request.operation_id).ok_or("Activation outcome missing")?;
        operation.running = matches!(value["phase"].as_str(), Some("preparing" | "draft_applied" | "tuning"));
        operation.outcome = value.clone(); drop(state);
        if wake { self.backend.wake(); }
        Ok(value)
    }
    fn publish(&self, request: &Request, phase: &str, draft: Option<&Value>, error: Option<&str>, rotor: &str, tune_confirmed: bool, reservation_active: bool) -> Result<Value, String> {
        self.record(request, self.outcome(request, phase, draft, error, rotor, tune_confirmed, reservation_active), true)
    }
    fn finalize_closed(&self, request: &Request, mut outcome: Value) -> Result<Value, String> {
        if let Err(error) = self.editors.finish(&request.operation_id) {
            let prior = outcome["error"].as_str().unwrap_or("Activation completed, but editor release could not be confirmed.").to_owned();
            outcome["phase"] = json!("uncertain");
            outcome["reservationActive"] = json!(true);
            outcome["error"] = json!(format!("{prior} Editor release could not be confirmed: {error}"));
            return self.record(request, outcome, true);
        }
        let mut state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
        let operation = state.operations.get_mut(&request.operation_id).ok_or("Activation outcome missing")?;
        operation.running = false;
        operation.outcome = outcome.clone();
        if state.active.as_deref() == Some(&request.operation_id) { state.active = None; }
        drop(state); self.backend.wake(); Ok(outcome)
    }
    pub fn activate(&self, request: Request) -> Result<Value, String> {
        request.validate()?;
        {
            let mut state = self.state.lock().map_err(|_| "Spot activation unavailable")?;
            if state.retired.contains_key(&request.operation_id) { return Err("This activation identity was retired. Select a report with a new identity; no old effect was replayed.".into()); }
            if let Some(prior) = state.operations.get(&request.operation_id) {
                return if prior.request == request { Ok(prior.outcome.clone()) } else { Err("This operation identity was already used for another spot.".into()) };
            }
            // Fail closed rather than evicting identities which could be replayed.
            if state.operations.len() + state.retired.len() >= 4096 { return Err("This session has reached its activation history limit. Restart safely before selecting another spot.".into()); }
            if state.active.is_some() || state.recovering {
                // Another window may click before its first status read. Retain
                // the rejected identity too, so a lost IPC reply can be checked
                // without inventing a retry or becoming permanently stranded.
                let outcome = json!({"operationId":request.operation_id,"phase":"blocked",
                    "draftOnly":self.backend.draft_only(&request),
                    "tuneConfirmed":false,"rotor":"not_requested","reservationActive":false,
                    "error":"Wait for the current spot activation to finish."});
                state.operations.insert(request.operation_id.clone(), Operation { request, outcome:outcome.clone(), generation:None, running:false });
                return Ok(outcome);
            }
            state.active = Some(request.operation_id.clone());
            state.latest = Some(request.operation_id.clone());
            state.operations.insert(request.operation_id.clone(), Operation { request:request.clone(), generation:None, running:true,
                outcome:json!({"operationId":request.operation_id,"phase":"preparing","draftOnly":self.backend.draft_only(&request),"tuneConfirmed":false,"rotor":"not_requested","reservationActive":true}) });
        }
        let mut applied = None;
        let mut effect_started = false;
        let mut tune_confirmed = false;
        let mut rotor_outcome = "not_requested";
        let mut reservation_active = false;
        let result = (|| {
            let spot = self.backend.resolve(&request)?;
            let base = self.backend.canonical()?;
            let draft_only = self.backend.draft_only(&request);
            let selection = if draft_only { Value::Null } else { self.backend.selection()? };
            let generation = base["generation"].as_str().ok_or("Workspace generation unavailable")?;
            self.state.lock().map_err(|_| "Spot activation unavailable")?.operations.get_mut(&request.operation_id)
                .ok_or("Activation outcome missing")?.generation = Some(generation.into());
            let draft = base["qso"]["id"].as_str().ok_or("Canonical draft identity unavailable")?;
            let revision = base["revision"].as_u64().ok_or("Canonical draft revision unavailable")?;
            let membership = self.backend.open_editors()?;
            self.editors.begin(&request.operation_id, generation, draft, revision, &membership)?;
            self.backend.wake();
            self.editors.wait_ready(&request.operation_id, Duration::from_secs(3))?;
            let mut current_members = self.backend.open_editors()?; current_members.sort();
            let mut expected_members = membership; expected_members.sort();
            if current_members != expected_members { return Err("Editor windows changed during preparation. Select the spot again.".into()); }
            if self.backend.resolve(&request)? != spot || !draft_only && self.backend.selection()? != selection {
                return Err("Spot or radio selection changed during preparation. Select it again.".into());
            }
            reservation_active = true; // lost apply reply may still have acquired the worker lease
            let result = self.backend.apply(&request, &base, &spot)?;
            match result["status"].as_str() {
                Some("conflict" | "workspace_changed" | "abandoned") => {
                    reservation_active = false;
                    return Err("The shared draft changed. Refresh before selecting this spot.".into());
                }
                Some("applied") => {},
                _ => return Err("The draft acknowledgement could not be verified. Check its durable receipt before continuing.".into()),
            }
            if !result["receipt"]["draft"].is_object() || !result["replay"].is_boolean()
                || result.get("leaseID").is_some_and(|lease| !lease.is_string())
                || result["replay"] == false && (!result["leaseID"].is_string()
                    || result["receipt"]["draft"]["generation"] != base["generation"]
                    || result["receipt"]["draft"]["qso"]["id"] != base["qso"]["id"]
                    || result["receipt"]["draft"]["revision"].as_u64() != revision.checked_add(1)) {
                return Err("The draft receipt could not be verified. Editors remain protected until receipt reconciliation.".into());
            }
            applied = Some(result.clone());
            if result["replay"] != false || !result["leaseID"].is_string() {
                reservation_active = result["leaseID"].is_string();
                return Err("This activation already has a durable receipt. Its tune will not be repeated.".into());
            }
            reservation_active = true;
            if draft_only {
                self.backend.finish(&request, &result, "confirmed")?;
                reservation_active = false;
                return Ok(self.outcome(&request, "confirmed", Some(&result["receipt"]["draft"]), None, "not_requested", false, false));
            }
            self.publish(&request, "draft_applied", Some(&result["receipt"]["draft"]), None, "not_requested", false, true)?;
            if self.backend.stage(&request, &result, "tune_started")?["status"] != "staged" {
                return Err("The tune has already been admitted or its receipt is unavailable. It will not be repeated.".into());
            }
            self.publish(&request, "tuning", Some(&result["receipt"]["draft"]), None, "not_requested", false, true)?;
            if self.backend.resolve(&request)? != spot || self.backend.selection()? != selection {
                return Err("Spot or radio selection changed before tune admission. No tune was sent.".into());
            }
            let tuned = self.backend.tune(&request, &selection, &spot, &mut effect_started)?;
            if tuned["confirmed"] != true { return Err("Radio frequency, mode and simplex ownership were not confirmed. The draft is retained; no automatic turn was requested.".into()); }
            tune_confirmed = true;
            if self.backend.stage(&request, &result, "tune_confirmed")?["status"] != "staged" {
                return Err("The radio replied, but its durable confirmation could not be recorded. Do not automatically retry.".into());
            }
            if self.backend.stage(&request, &result, "rotor_started")?["status"] != "staged" {
                return Err("Automatic rotor admission could not be recorded. No turn was requested; the confirmed radio tune is retained.".into());
            }
            rotor_outcome = "uncertain";
            let rotor = self.backend.rotor(&request, &result)?;
            rotor_outcome = if rotor["requested"] == true { "pending" } else { "not_requested" };
            self.backend.finish(&request, &result, "confirmed")?;
            reservation_active = false;
            Ok(self.outcome(&request, "confirmed", Some(&result["receipt"]["draft"]), None, rotor_outcome, tune_confirmed, false))
        })();
        let outcome = match result {
            Ok(value) => value,
            Err(error) => {
                let phase = if effect_started || reservation_active && applied.is_none() { "uncertain" } else if applied.is_some() { "failed" } else { "blocked" };
                let mut final_error = error;
                if let Some(applied) = applied.as_ref().filter(|value| value["replay"] == false && value["leaseID"].is_string()) {
                    if let Err(error) = self.backend.finish(&request, applied, if effect_started { "uncertain" } else { "failed" }) {
                        final_error = format!("{final_error} Reservation release could not be confirmed: {error}");
                    } else { reservation_active = false; }
                }
                self.outcome(&request, if reservation_active { "uncertain" } else { phase },
                    applied.as_ref().map(|value| &value["receipt"]["draft"]), Some(&final_error), rotor_outcome, tune_confirmed, reservation_active)
            }
        };
        if reservation_active {
            // Do not let a timeout unlock editors while the worker may still
            // own their draft. Explicit reservation reconciliation is required.
            return self.record(&request, outcome, true);
        }
        // Closed terminal state becomes visible only after the editor barrier and
        // admission slot are released, so a wake can never advertise false readiness.
        self.finalize_closed(&request, outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct Fake { base: Value, calls: Mutex<Vec<String>>, mode: AtomicUsize, observer: Mutex<Option<Box<dyn Fn() + Send + Sync>>> }
    impl Fake {
        fn new() -> Self { Self { base:json!({"generation":uuid::Uuid::new_v4().to_string(),"revision":0,
            "qso":{"id":uuid::Uuid::new_v4().to_string()}}), calls:Mutex::new(vec![]), mode:AtomicUsize::new(0), observer:Mutex::new(None) } }
        fn call(&self, name: &str) { self.calls.lock().unwrap().push(name.into()); }
    }
    impl Backend for Fake {
        fn recover_missing(&self, operation: &str) -> Result<Value, String> {
            self.call("recover_missing");
            Ok(json!({"operationId":operation,"phase":"uncertain","reservationActive":false,"tuneConfirmed":false,"rotor":"not_replayed"}))
        }
        fn draft_only(&self, _: &Request) -> bool { matches!(self.mode.load(Ordering::SeqCst),14..=16) }
        fn resolve(&self, _: &Request) -> Result<Value, String> {
            let changed = self.mode.load(Ordering::SeqCst) == 7 && self.calls.lock().unwrap().iter().any(|call| call == "tune_started");
            Ok(json!({"call":"TEST1","frequencyHz":if changed { 14075000 } else { 14074000 },"mode":"FT8"}))
        }
        fn canonical(&self) -> Result<Value, String> { Ok(self.base.clone()) }
        fn open_editors(&self) -> Result<Vec<String>, String> { Ok(if matches!(self.mode.load(Ordering::SeqCst),1 | 15) { vec!["main".into()] } else { vec![] }) }
        fn selection(&self) -> Result<Value, String> { Ok(json!({"provider":"fixture","generation":1})) }
        fn apply(&self, _: &Request, _: &Value, _: &Value) -> Result<Value, String> {
            self.call("apply"); if self.mode.load(Ordering::SeqCst) == 4 { return Err("lost apply reply".into()); }
            match self.mode.load(Ordering::SeqCst) {
                5 => return Ok(json!({})),
                6 => return Ok(json!({"status":"conflict"})),
                11 => return Ok(json!({"status":"applied","replay":false,"receipt":{"draft":self.base}})),
                _ => {},
            }
            let mut draft = self.base.clone(); draft["revision"] = json!(1);
            Ok(json!({"status":"applied","replay":false,"leaseID":"fixture-lease","receipt":{"draft":draft}}))
        }
        fn stage(&self, _: &Request, _: &Value, stage: &str) -> Result<Value, String> {
            self.call(stage);
            Ok(json!({"status":if self.mode.load(Ordering::SeqCst) == 9 && stage == "rotor_started" { "already_staged" } else { "staged" }}))
        }
        fn tune(&self, request: &Request, _: &Value, _: &Value, effect_started: &mut bool) -> Result<Value, String> {
            request.validate().unwrap();
            if self.mode.load(Ordering::SeqCst) == 17 { return Err("radio admission rejected".into()); }
            *effect_started = true;
            self.call("tune"); if self.mode.load(Ordering::SeqCst) == 2 { Err("lost tune reply".into()) } else { Ok(json!({"confirmed":true})) }
        }
        fn rotor(&self, _: &Request, _: &Value) -> Result<Value, String> {
            self.call("rotor");
            if self.mode.load(Ordering::SeqCst) == 8 { Err("lost rotor reply".into()) } else { Ok(json!({"requested":false})) }
        }
        fn finish(&self, _: &Request, _: &Value, outcome: &str) -> Result<(), String> {
            self.call(outcome); if matches!(self.mode.load(Ordering::SeqCst), 3 | 10 | 16) { Err("lost release".into()) } else { Ok(()) }
        }
        fn durable_status(&self, _: &Request, _: &str) -> Result<Value, String> {
            self.call("status");
            match self.mode.load(Ordering::SeqCst) {
                12 => return Ok(json!({"status":"not_found"})),
                13 => return Ok(json!({"status":"abandoned"})),
                _ => {},
            }
            if matches!(self.mode.load(Ordering::SeqCst),10 | 16) {
                Ok(json!({"status":"found","phase":"confirmed","receipt":{"draft":self.base}}))
            } else { Ok(json!({"status":"found","phase":"draft_applied","leaseID":"fixture-lease","receipt":{"draft":self.base}})) }
        }
        fn wake(&self) { if let Some(observer) = self.observer.lock().unwrap().as_ref() { observer(); } }
    }
    fn request() -> Request { Request { operation_id:uuid::Uuid::new_v4().to_string(), source_epoch:uuid::Uuid::new_v4().to_string(),
        spot_id:"report".into(), spot_version:uuid::Uuid::new_v4().to_string() } }
    #[test]
    fn draft_precedes_effect_and_same_operation_never_replays() {
        let backend = Arc::new(Fake::new()); let owner = Coordinator::new(backend.clone()); let request = request();
        assert_eq!(owner.activate(request.clone()).unwrap()["phase"], "confirmed");
        assert_eq!(*backend.calls.lock().unwrap(), ["apply","tune_started","tune","tune_confirmed","rotor_started","rotor","confirmed"]);
        owner.activate(request.clone()).unwrap(); assert_eq!(backend.calls.lock().unwrap().len(), 7);
        let snapshot = owner.snapshot().unwrap(); assert_eq!(snapshot["phase"], "confirmed");
        assert_eq!(snapshot["barrier"], Value::Null); assert!(snapshot.get("error").is_none());
        let mut reused = request; reused.spot_id = "other".into(); assert!(owner.activate(reused).is_err());
    }
    #[test]
    fn opportunity_uses_the_same_journal_and_barrier_but_never_stages_station_effects() {
        let backend = Arc::new(Fake::new()); backend.mode.store(14, Ordering::SeqCst);
        let owner = Coordinator::new(backend.clone()); let request = request();
        let result = owner.activate(request.clone()).unwrap();
        assert_eq!(result["phase"], "confirmed"); assert_eq!(result["draftOnly"], true); assert_eq!(result["tuneConfirmed"], false);
        assert_eq!(result["reservationActive"], false); assert_eq!(owner.snapshot().unwrap()["barrier"], Value::Null);
        assert_eq!(*backend.calls.lock().unwrap(), ["apply", "confirmed"]);
        assert_eq!(owner.activate(request).unwrap(), result); assert_eq!(backend.calls.lock().unwrap().len(), 2);
    }
    #[test]
    fn opportunity_editor_admission_and_lost_finish_recovery_never_authorize_a_tune() {
        let backend = Arc::new(Fake::new()); backend.mode.store(15, Ordering::SeqCst);
        let owner = Coordinator::new(backend.clone());
        assert_eq!(owner.activate(request()).unwrap()["phase"],"blocked"); assert!(backend.calls.lock().unwrap().is_empty());
        backend.mode.store(16,Ordering::SeqCst); let request = request();
        let uncertain = owner.activate(request.clone()).unwrap(); assert_eq!(uncertain["reservationActive"],true);
        let recovered = owner.reconcile(&request.operation_id).unwrap(); assert_eq!(recovered["phase"],"confirmed");
        assert_eq!(recovered["tuneConfirmed"],false); assert_eq!(recovered["reservationActive"],false);
        assert_eq!(*backend.calls.lock().unwrap(),["apply","confirmed","failed","status"]);
    }
    #[test]
    fn nil_operation_is_rejected_before_it_can_create_an_unrecoverable_receipt() {
        let backend = Arc::new(Fake::new()); let owner = Coordinator::new(backend.clone());
        let mut request = request(); request.operation_id = uuid::Uuid::nil().to_string();
        assert!(owner.activate(request).is_err()); assert!(backend.calls.lock().unwrap().is_empty());
        assert_eq!(owner.snapshot().unwrap()["phase"], "idle");
    }
    #[test]
    fn concurrent_window_rejection_retains_its_status_without_releasing_the_active_operation() {
        let backend = Arc::new(Fake::new()); let owner = Coordinator::new(backend.clone());
        let first = request(); owner.state.lock().unwrap().active = Some(first.operation_id.clone());
        let next = request(); let result = owner.activate(next.clone()).unwrap();
        assert_eq!(result["phase"], "blocked"); assert_eq!(result["reservationActive"], false);
        assert_eq!(owner.status(&next.operation_id).unwrap(), result);
        assert_eq!(owner.reconcile(&next.operation_id).unwrap(), result);
        assert_eq!(owner.activate(next).unwrap(), result);
        assert_eq!(owner.state.lock().unwrap().active.as_deref(), Some(first.operation_id.as_str()));
        assert!(backend.calls.lock().unwrap().is_empty());
        owner.state.lock().unwrap().active = None;
        assert_eq!(owner.snapshot().unwrap()["phase"], "idle");
    }
    #[test]
    fn concurrent_clicks_remain_exact_receipts_without_stealing_global_lifecycle() {
        let backend = Arc::new(Fake::new()); let owner = Coordinator::new(backend.clone());
        let active = request(); owner.state.lock().unwrap().active = Some(active.operation_id.clone());
        let second = request(); let second_result = owner.activate(second.clone()).unwrap();
        let third = request(); let third_result = owner.activate(third.clone()).unwrap();
        assert_eq!(second_result["phase"], "blocked"); assert_eq!(third_result["phase"], "blocked");
        assert_eq!(owner.snapshot().unwrap()["phase"], "idle");
        owner.state.lock().unwrap().active = None;
        assert_eq!(owner.snapshot().unwrap()["phase"], "idle");
        assert_eq!(owner.status(&second.operation_id).unwrap()["operationId"], second.operation_id);
        assert_eq!(owner.status(&third.operation_id).unwrap()["operationId"], third.operation_id);
        assert!(backend.calls.lock().unwrap().is_empty());
    }
    #[test]
    fn unregistered_editor_prevents_all_writes_and_radio_effects() {
        let backend = Arc::new(Fake::new()); backend.mode.store(1, Ordering::SeqCst); let owner = Coordinator::new(backend.clone());
        assert_eq!(owner.activate(request()).unwrap()["phase"], "blocked"); assert!(backend.calls.lock().unwrap().is_empty());
    }
    #[test]
    fn lost_tune_reply_never_turns_or_retunes_and_releases_exact_reservation() {
        let backend = Arc::new(Fake::new()); backend.mode.store(2, Ordering::SeqCst); let owner = Coordinator::new(backend.clone()); let request = request();
        assert_eq!(owner.activate(request.clone()).unwrap()["phase"], "uncertain"); owner.activate(request).unwrap();
        assert_eq!(*backend.calls.lock().unwrap(), ["apply","tune_started","tune","uncertain"]);
        assert_eq!(owner.snapshot().unwrap()["phase"], "uncertain");
    }
    #[test]
    fn rejected_radio_admission_is_failed_not_uncertain_and_never_dispatches() {
        let backend = Arc::new(Fake::new()); backend.mode.store(17, Ordering::SeqCst); let owner = Coordinator::new(backend.clone());
        let outcome = owner.activate(request()).unwrap();
        assert_eq!(outcome["phase"], "failed"); assert_eq!(outcome["reservationActive"], false);
        assert!(!backend.calls.lock().unwrap().iter().any(|call| call == "tune"));
        assert_eq!(owner.snapshot().unwrap()["phase"], "failed");
        assert_eq!(owner.snapshot().unwrap()["barrier"], Value::Null);
    }
    #[test]
    fn lost_apply_reply_keeps_editors_frozen_until_receipt_only_reconciliation() {
        let backend = Arc::new(Fake::new()); backend.mode.store(4, Ordering::SeqCst); let owner = Coordinator::new(backend.clone()); let request = request();
        let outcome = owner.activate(request.clone()).unwrap(); assert_eq!(outcome["reservationActive"], true);
        assert_eq!(outcome["phase"], "uncertain"); assert_eq!(owner.activate(super::tests::request()).unwrap()["phase"], "blocked");
        let recovered = owner.reconcile(&request.operation_id).unwrap(); assert_eq!(recovered["reservationActive"], false);
        assert_eq!(*backend.calls.lock().unwrap(), ["apply","status","uncertain"]);
        owner.activate(request).unwrap(); assert_eq!(backend.calls.lock().unwrap().len(), 3);
    }
    #[test]
    fn uncertain_release_does_not_expire_editor_freeze() {
        let backend = Arc::new(Fake::new()); backend.mode.store(3, Ordering::SeqCst); let owner = Coordinator::new(backend.clone()); let request = request();
        assert_eq!(owner.activate(request.clone()).unwrap()["reservationActive"], true);
        assert_ne!(owner.editors.snapshot().unwrap(), Value::Null);
        assert!(owner.reconcile(&request.operation_id).is_err());
        backend.mode.store(0, Ordering::SeqCst); owner.reconcile(&request.operation_id).unwrap();
        assert_eq!(owner.editors.snapshot().unwrap(), Value::Null);
        assert_eq!(backend.calls.lock().unwrap().iter().filter(|call| *call == "tune").count(), 1);
    }
    #[test]
    fn receipt_absence_cannot_release_protection_until_late_apply_is_tombstoned() {
        let backend = Arc::new(Fake::new()); backend.mode.store(4, Ordering::SeqCst);
        let owner = Coordinator::new(backend.clone()); let request = request();
        assert_eq!(owner.activate(request.clone()).unwrap()["reservationActive"], true);
        backend.mode.store(12, Ordering::SeqCst);
        assert!(owner.reconcile(&request.operation_id).is_err());
        assert_eq!(owner.snapshot().unwrap()["reservationActive"], true);
        backend.mode.store(13, Ordering::SeqCst);
        assert_eq!(owner.reconcile(&request.operation_id).unwrap()["reservationActive"], false);
        assert_eq!(*backend.calls.lock().unwrap(), ["apply", "status", "status"]);
    }
    #[test]
    fn malformed_apply_replies_hold_possible_reservation_until_status_only_recovery() {
        for mode in [5, 11] {
            let backend = Arc::new(Fake::new()); backend.mode.store(mode, Ordering::SeqCst);
            let owner = Coordinator::new(backend.clone()); let request = request();
            let outcome = owner.activate(request.clone()).unwrap();
            assert_eq!(outcome["phase"], "uncertain"); assert_eq!(outcome["reservationActive"], true);
            assert!(outcome["error"].is_string()); assert_ne!(owner.editors.snapshot().unwrap(), Value::Null);
            assert_eq!(*backend.calls.lock().unwrap(), ["apply"]);
            owner.reconcile(&request.operation_id).unwrap();
            assert_eq!(*backend.calls.lock().unwrap(), ["apply", "status", "uncertain"]);
            assert_eq!(owner.editors.snapshot().unwrap(), Value::Null);
        }
    }
    #[test]
    fn missing_identity_retirement_cannot_replay_it_and_allows_a_new_explicit_selection() {
        let backend = Arc::new(Fake::new()); let owner = Coordinator::new(backend.clone()); let old = request();
        assert!(owner.status(&old.operation_id).is_err()); assert!(backend.calls.lock().unwrap().is_empty());
        let retired = owner.reconcile(&old.operation_id).unwrap();
        assert_eq!(retired["reservationActive"], false); assert_eq!(*backend.calls.lock().unwrap(), ["recover_missing"]);
        assert!(owner.activate(old).is_err());
        assert_eq!(owner.activate(request()).unwrap()["phase"], "confirmed");
        assert_eq!(backend.calls.lock().unwrap().iter().filter(|call| *call == "tune").count(), 1);
    }
    #[test]
    fn missing_identity_cannot_retire_a_different_live_reservation() {
        let backend = Arc::new(Fake::new()); backend.mode.store(4, Ordering::SeqCst); let owner = Coordinator::new(backend.clone());
        owner.activate(request()).unwrap();
        assert!(owner.reconcile(&request().operation_id).is_err());
        assert!(!backend.calls.lock().unwrap().iter().any(|call| call == "recover_missing"));
    }
    #[test]
    fn explicit_conflict_proves_no_reservation_and_does_not_send_effects() {
        let backend = Arc::new(Fake::new()); backend.mode.store(6, Ordering::SeqCst); let owner = Coordinator::new(backend.clone());
        let outcome = owner.activate(request()).unwrap(); assert_eq!(outcome["phase"], "blocked");
        assert_ne!(outcome["reservationActive"], true); assert_eq!(owner.editors.snapshot().unwrap(), Value::Null);
        assert_eq!(*backend.calls.lock().unwrap(), ["apply"]);
    }
    #[test]
    fn source_change_while_apply_or_stage_waits_prevents_tune_and_releases_draft() {
        let backend = Arc::new(Fake::new()); backend.mode.store(7, Ordering::SeqCst); let owner = Coordinator::new(backend.clone());
        let outcome = owner.activate(request()).unwrap(); assert_eq!(outcome["phase"], "failed");
        assert_eq!(outcome["tuneConfirmed"], false);
        assert_eq!(*backend.calls.lock().unwrap(), ["apply", "tune_started", "failed"]);
    }
    #[test]
    fn rotor_failure_retains_confirmed_tune_and_marker_precedes_effect() {
        let backend = Arc::new(Fake::new()); backend.mode.store(8, Ordering::SeqCst); let owner = Coordinator::new(backend.clone());
        let outcome = owner.activate(request()).unwrap(); assert_eq!(outcome["phase"], "uncertain");
        assert_eq!(outcome["tuneConfirmed"], true); assert_eq!(outcome["rotor"], "uncertain");
        assert_eq!(*backend.calls.lock().unwrap(), ["apply", "tune_started", "tune", "tune_confirmed", "rotor_started", "rotor", "uncertain"]);
    }
    #[test]
    fn repeated_or_unknown_rotor_admission_never_sends_a_turn() {
        let backend = Arc::new(Fake::new()); backend.mode.store(9, Ordering::SeqCst); let owner = Coordinator::new(backend.clone());
        let outcome = owner.activate(request()).unwrap(); assert_eq!(outcome["tuneConfirmed"], true);
        assert_eq!(outcome["rotor"], "not_requested");
        assert_eq!(*backend.calls.lock().unwrap(), ["apply", "tune_started", "tune", "tune_confirmed", "rotor_started", "uncertain"]);
    }
    #[test]
    fn lost_terminal_reply_recovers_confirmed_snapshot_without_tune_replay() {
        let backend = Arc::new(Fake::new()); backend.mode.store(10, Ordering::SeqCst); let owner = Coordinator::new(backend.clone()); let request = request();
        let uncertain = owner.activate(request.clone()).unwrap();
        assert_eq!(uncertain["tuneConfirmed"], true); assert_eq!(uncertain["reservationActive"], true);
        let recovered = owner.reconcile(&request.operation_id).unwrap();
        assert_eq!(recovered["phase"], "confirmed"); assert_eq!(recovered["reservationActive"], false); assert!(recovered.get("error").is_none());
        let snapshot = owner.snapshot().unwrap(); assert_eq!(snapshot["phase"], "confirmed"); assert_eq!(snapshot["barrier"], Value::Null);
        owner.activate(request).unwrap();
        assert_eq!(backend.calls.lock().unwrap().iter().filter(|call| *call == "tune").count(), 1);
    }
    #[test]
    fn every_uncertain_wake_already_contains_protection_and_reconcile_releases_barrier_first() {
        for mode in [3, 4] {
            let backend = Arc::new(Fake::new()); backend.mode.store(mode, Ordering::SeqCst);
            let owner = Arc::new(Coordinator::new(backend.clone())); let request = request();
            let observed = Arc::new(Mutex::new(Vec::new())); let saved = observed.clone(); let weak = Arc::downgrade(&owner);
            *backend.observer.lock().unwrap() = Some(Box::new(move || saved.lock().unwrap().push(weak.upgrade().unwrap().snapshot().unwrap())));
            owner.activate(request.clone()).unwrap();
            assert!(observed.lock().unwrap().iter().all(|value| value["reservationActive"] == true));
            assert!(observed.lock().unwrap().iter().any(|value| value["phase"] == "uncertain"));
            backend.mode.store(0, Ordering::SeqCst); owner.reconcile(&request.operation_id).unwrap();
            let values = observed.lock().unwrap(); let last = values.last().unwrap();
            assert_eq!(last["reservationActive"], false); assert_eq!(last["barrier"], Value::Null);
        }
    }
    #[test]
    fn every_closed_terminal_wake_has_released_the_editor_barrier_and_admission_slot() {
        let backend = Arc::new(Fake::new());
        let owner = Arc::new(Coordinator::new(backend.clone()));
        let observed = Arc::new(Mutex::new(Vec::new())); let saved = observed.clone(); let weak = Arc::downgrade(&owner);
        *backend.observer.lock().unwrap() = Some(Box::new(move || saved.lock().unwrap().push(weak.upgrade().unwrap().snapshot().unwrap())));
        assert_eq!(owner.activate(request()).unwrap()["phase"], "confirmed");
        let values = observed.lock().unwrap();
        let closed: Vec<_> = values.iter().filter(|value| value["reservationActive"] == false).collect();
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0]["phase"], "confirmed");
        assert_eq!(closed[0]["barrier"], Value::Null);
        assert!(owner.state.lock().unwrap().active.is_none());
    }
    #[test]
    fn nonterminal_protection_cannot_be_reconciled_while_apply_or_tune_is_running() {
        let backend = Arc::new(Fake::new()); let owner = Arc::new(Coordinator::new(backend.clone())); let request = request();
        let id = request.operation_id.clone(); let weak = Arc::downgrade(&owner);
        *backend.observer.lock().unwrap() = Some(Box::new(move || {
            let owner = weak.upgrade().unwrap(); let snapshot = owner.snapshot().unwrap();
            if matches!(snapshot["phase"].as_str(), Some("preparing" | "draft_applied" | "tuning")) {
                assert_eq!(snapshot["reservationActive"], true); assert!(owner.reconcile(&id).is_err());
            }
        }));
        assert_eq!(owner.activate(request).unwrap()["phase"], "confirmed");
        assert!(!backend.calls.lock().unwrap().iter().any(|call| call == "status"));
    }
}
