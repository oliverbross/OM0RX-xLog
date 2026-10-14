//! Native membership and synchronous editor freeze acknowledgements.
//! Timeouts may reject preparation, never release an already admitted effect.
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::{Condvar, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

pub fn editor_role(label: &str) -> bool { matches!(label, "main" | "log-qso" | "logbook") }
pub fn activation_role(label: &str) -> bool { matches!(crate::workspace_windows::surface_role(label), "main" | "dx-cluster" | "world-map" | "band-maps") }
fn uuid(value: &str) -> Result<(), String> { uuid::Uuid::parse_str(value).map(|_| ()).map_err(|_| "Invalid activation identity.".into()) }

struct Pending {
    operation: String,
    barrier: String,
    generation: String,
    draft: String,
    revision: u64,
    deadline: u64,
    members: BTreeMap<String, (String, bool)>,
    admitted: bool,
    rejected: Option<String>,
}
#[derive(Default)]
struct State { editors: BTreeMap<String, String>, pending: Option<Pending> }
#[derive(Default)]
pub struct EditorBarrier { state: Mutex<State>, changed: Condvar }

impl EditorBarrier {
    pub fn register(&self, label: &str, instance: &str) -> Result<(), String> {
        if !editor_role(label) { return Err("This window is not a QSO editor.".into()); }
        uuid(instance)?;
        let mut state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        if state.editors.get(label).is_some_and(|old| old == instance) { return Ok(()); }
        state.editors.insert(label.into(), instance.into());
        if let Some(pending) = state.pending.as_mut() {
            if !pending.admitted { pending.rejected = Some("An editor opened or reloaded during spot preparation. Select the spot again.".into()); }
        }
        self.changed.notify_all(); Ok(())
    }
    pub fn unregister(&self, label: &str, instance: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        if state.editors.get(label).is_none_or(|old| old != instance) { return Ok(()); }
        state.editors.remove(label);
        if let Some(pending) = state.pending.as_mut() {
            if !pending.admitted { pending.rejected = Some("An editor closed during spot preparation. Select the spot again.".into()); }
        }
        self.changed.notify_all(); Ok(())
    }
    /// Native destruction is authoritative even when renderer cleanup never ran.
    /// Call only for an actually destroyed native window, never on a heartbeat.
    pub fn destroyed(&self, label: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        state.editors.remove(label);
        if let Some(pending) = state.pending.as_mut() {
            if !pending.admitted && pending.members.contains_key(label) {
                pending.rejected = Some("An editor closed during spot preparation. Select the spot again.".into());
            }
        }
        self.changed.notify_all(); Ok(())
    }
    pub fn begin(&self, operation: &str, generation: &str, draft: &str, revision: u64, open_editors: &[String]) -> Result<String, String> {
        uuid(operation)?; uuid(generation)?; uuid(draft)?;
        if revision > 9_007_199_254_740_991 { return Err("Invalid draft revision.".into()); }
        let mut state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        if state.pending.is_some() { return Err("Another spot activation is still in progress.".into()); }
        let mut members = BTreeMap::new();
        for label in open_editors.iter().filter(|label| editor_role(label)) {
            let instance = state.editors.get(label).ok_or("An open editor has not registered yet. Wait for it to finish loading.")?;
            members.insert(label.clone(), (instance.clone(), false));
        }
        // Never infer a renderer disappeared from a missed heartbeat or stale UI.
        // Native window inventory is the only absence authority.
        if state.editors.keys().any(|label| !open_editors.contains(label)) {
            return Err("Editor membership is changing. Wait for the window transition to finish.".into());
        }
        let barrier = uuid::Uuid::new_v4().to_string();
        let deadline = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Editor clock unavailable")?.as_millis() as u64 + 3000;
        state.pending = Some(Pending { operation:operation.into(), barrier:barrier.clone(), generation:generation.into(), draft:draft.into(),
            revision, deadline, members, admitted:false, rejected:None });
        Ok(barrier)
    }
    pub fn acknowledge(&self, label: &str, instance: &str, operation: &str, barrier: &str, ready: bool, reason: Option<&str>) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        let pending = state.pending.as_mut().ok_or("No editor preparation is active.")?;
        if pending.operation != operation || pending.barrier != barrier || pending.admitted || pending.rejected.is_some() {
            return Err("This editor acknowledgement is obsolete.".into());
        }
        let member = pending.members.get_mut(label).filter(|(id, _)| id == instance).ok_or("This editor instance is not part of the preparation.")?;
        if !ready {
            pending.rejected = Some(reason.filter(|text| !text.is_empty() && text.len() <= 512).unwrap_or("Finish the current QSO edit before selecting another spot.").into());
        } else { member.1 = true; }
        self.changed.notify_all(); Ok(())
    }
    pub fn wait_ready(&self, operation: &str, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        loop {
            let pending = state.pending.as_mut().filter(|pending| pending.operation == operation).ok_or("Spot preparation was superseded.")?;
            if let Some(reason) = pending.rejected.as_ref() { return Err(reason.clone()); }
            if pending.admitted { return Err("Spot preparation has already been admitted.".into()); }
            if pending.members.values().all(|(_, ready)| *ready) { pending.admitted = true; return Ok(()); }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                pending.rejected = Some("An editor did not confirm its draft was safe. No spot was applied or tuned.".into());
                return Err(pending.rejected.clone().unwrap());
            }
            (state, _) = self.changed.wait_timeout(state, remaining).map_err(|_| "Editor registry unavailable")?;
        }
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        Ok(state.pending.as_ref().map(|pending| json!({"operationId":pending.operation,"barrierId":pending.barrier,
            "generation":pending.generation,"draftId":pending.draft,"expectedRevision":pending.revision,"deadline":pending.deadline,
            "admitted":pending.admitted,"rejected":pending.rejected})).unwrap_or(Value::Null))
    }
    /// Only the activation owner calls this after storing a terminal outcome.
    pub fn finish(&self, operation: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Editor registry unavailable")?;
        if state.pending.as_ref().is_some_and(|pending| pending.operation == operation) { state.pending = None; }
        self.changed.notify_all(); Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id() -> String { uuid::Uuid::new_v4().to_string() }
    #[test]
    fn missing_editor_or_veto_prevents_admission_and_preserves_membership() {
        let owner = EditorBarrier::default(); let op = id(); let instance = id();
        assert!(owner.begin(&op, &id(), &id(), 0, &["main".into()]).is_err());
        owner.register("main", &instance).unwrap();
        let barrier = owner.begin(&op, &id(), &id(), 0, &["main".into()]).unwrap();
        owner.acknowledge("main", &instance, &op, &barrier, false, Some("Unsaved input")).unwrap();
        assert_eq!(owner.wait_ready(&op, Duration::ZERO).unwrap_err(), "Unsaved input");
        assert!(owner.begin(&id(), &id(), &id(), 0, &["main".into()]).is_err());
        owner.finish(&op).unwrap();
        assert!(owner.begin(&id(), &id(), &id(), 0, &["main".into()]).is_ok());
    }
    #[test]
    fn every_exact_instance_must_acknowledge_and_old_finish_cannot_release_new_operation() {
        let owner = EditorBarrier::default(); let op = id(); let first = id(); let second = id();
        owner.register("main", &first).unwrap(); owner.register("log-qso", &second).unwrap();
        let barrier = owner.begin(&op, &id(), &id(), 2, &["main".into(), "log-qso".into()]).unwrap();
        assert!(owner.acknowledge("main", &second, &op, &barrier, true, None).is_err());
        owner.acknowledge("main", &first, &op, &barrier, true, None).unwrap();
        owner.acknowledge("log-qso", &second, &op, &barrier, true, None).unwrap();
        owner.wait_ready(&op, Duration::ZERO).unwrap();
        owner.finish(&id()).unwrap(); assert_ne!(owner.snapshot().unwrap(), Value::Null);
        assert!(owner.wait_ready(&op, Duration::ZERO).is_err());
        owner.finish(&op).unwrap(); assert_eq!(owner.snapshot().unwrap(), Value::Null);
    }
    #[test]
    fn reload_or_timeout_fails_closed_but_cannot_expire_an_admitted_operation() {
        let owner = EditorBarrier::default(); let op = id(); let instance = id();
        owner.register("main", &instance).unwrap();
        owner.begin(&op, &id(), &id(), 0, &["main".into()]).unwrap();
        owner.register("main", &id()).unwrap(); assert!(owner.wait_ready(&op, Duration::ZERO).is_err()); owner.finish(&op).unwrap();
        owner.unregister("main", &instance).unwrap(); // old unload cannot unregister replacement
        assert!(owner.begin(&id(), &id(), &id(), 0, &[]).is_err());
        let op = id(); let barrier = owner.begin(&op, &id(), &id(), 0, &["main".into()]).unwrap();
        assert!(owner.wait_ready(&op, Duration::ZERO).is_err());
        assert!(owner.acknowledge("main", &instance, &op, &barrier, true, None).is_err());
        owner.finish(&op).unwrap();
    }
    #[test]
    fn no_editor_case_is_authorized_only_by_native_empty_membership() {
        let owner = EditorBarrier::default(); let op = id();
        owner.begin(&op, &id(), &id(), 0, &[]).unwrap(); owner.wait_ready(&op, Duration::ZERO).unwrap();
        owner.register("log-qso", &id()).unwrap();
        assert_eq!(owner.snapshot().unwrap()["admitted"], true);
        assert_ne!(owner.snapshot().unwrap(), Value::Null); // new window must remain read-only until finish
    }
    #[test]
    fn native_destruction_retires_registration_but_never_releases_an_admitted_operation() {
        let owner = EditorBarrier::default(); let op = id(); let instance = id();
        owner.register("main", &instance).unwrap();
        let barrier = owner.begin(&op, &id(), &id(), 0, &["main".into()]).unwrap();
        assert!(owner.snapshot().unwrap()["deadline"].as_u64().unwrap() > 0);
        owner.acknowledge("main", &instance, &op, &barrier, true, None).unwrap();
        owner.wait_ready(&op, Duration::ZERO).unwrap(); owner.destroyed("main").unwrap();
        assert_eq!(owner.snapshot().unwrap()["admitted"], true);
        owner.finish(&op).unwrap(); owner.begin(&id(), &id(), &id(), 0, &[]).unwrap();
    }
}
