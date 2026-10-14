//! Retained non-secret display of canonical Settings replies. Not a Settings
//! owner: no RPC, defaults, persistence, credentials, polling or device access.
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

type Publish = dyn Fn() + Send + Sync;
struct State { worker: u64, fence: u64, changing: usize, revision: u64, available: bool, snapshot: Value, antenna: Value, stopped: bool,
    workspace_change: bool, incoherent: bool }
struct Projection { epoch: String, state: Mutex<State>, publish: Box<Publish> }
pub struct Ticket { worker: u64, fence: u64, change: bool }
pub fn validate(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if isolated || exiting || label != "station-identity" { return Err("Saved station identity is unavailable in this window.".into()); }
    Ok(())
}
impl Projection {
    fn new(publish: Box<Publish>) -> Self {
        Self { epoch: uuid::Uuid::new_v4().to_string(), publish, state: Mutex::new(State {
            worker: 0, fence: 0, changing: 0, revision: 0, available: false, snapshot: Value::Null, antenna: Value::Null, stopped: false,
            workspace_change: true, incoherent: false,
        }) }
    }
    fn changed(state: &mut State) { state.revision += 1; }
    fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Saved identity projection unavailable")?;
        if state.stopped || state.revision > 9_007_199_254_740_991 { return Err("Saved identity projection has stopped.".into()); }
        Ok(json!({"epoch":self.epoch,"revision":state.revision,"available":state.available,"snapshot":state.snapshot}))
    }
    fn antenna_snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Saved antenna projection unavailable")?;
        if state.stopped || state.revision > 9_007_199_254_740_991 { return Err("Saved antenna projection has stopped.".into()); }
        let mut snapshot = state.antenna.clone();
        if let Some(profile) = snapshot.as_object_mut() {
            for key in ["worker_generation", "workspace_generation", "settings_revision"] { profile.insert(key.into(), state.snapshot[key].clone()); }
        }
        Ok(json!({"epoch":self.epoch,"revision":state.revision,"available":state.available && !snapshot.is_null(),"snapshot":snapshot}))
    }
    fn begin(&self, method: &str, worker: u64) -> Option<Ticket> {
        let change = matches!(method, "settings_save" | "workspace_create" | "backup_restore");
        if !change && method != "settings_load" { return None; }
        let mut state = self.state.lock().ok()?;
        if state.stopped { return None; }
        if worker < state.worker { return None; }
        let mut notify = false;
        if state.worker != worker {
            state.worker = worker; state.fence += 1; state.changing = 0; state.available = false; Self::changed(&mut state); notify = true;
            state.workspace_change = true; state.incoherent = false;
        }
        if change {
            state.fence += 1; state.changing += 1; state.available = false; Self::changed(&mut state); notify = true;
            if matches!(method, "workspace_create" | "backup_restore") { state.workspace_change = true; state.incoherent = false; }
        }
        let ticket = Ticket { worker, fence: state.fence, change };
        drop(state); if notify { (self.publish)(); }
        Some(ticket)
    }
    fn finish(&self, ticket: Ticket, response: &Result<Value, String>) {
        let Ok(mut state) = self.state.lock() else { return; };
        if state.stopped || state.worker != ticket.worker { return; }
        if ticket.change {
            state.changing = state.changing.saturating_sub(1); state.fence += 1; state.available = false; Self::changed(&mut state);
        } else {
            if state.fence != ticket.fence || state.changing != 0 { return; }
            let value = response.as_ref().ok().filter(|value| value["ok"] == true)
                .and_then(|value| checked(&value["result"], ticket.worker));
            match value {
                Some(value) => {
                    if state.incoherent { return; }
                    if !state.workspace_change && state.snapshot["worker_generation"] == value["worker_generation"]
                        && state.snapshot["workspace_generation"] != value["workspace_generation"] {
                        // No opaque generation ordering can prove an unexpected
                        // workspace transition. Do not let later old reads revive it.
                        state.incoherent = true; state.available = false; state.fence += 1; Self::changed(&mut state);
                        drop(state); (self.publish)(); return;
                    }
                    if state.snapshot["workspace_generation"] == value["workspace_generation"]
                        && state.snapshot["worker_generation"] == value["worker_generation"]
                        && state.snapshot["settings_revision"].as_u64() > value["settings_revision"].as_u64() { return; }
                    let antenna = response.as_ref().ok().and_then(|reply| checked_antenna(&reply["result"]["settings"]["stationEquipment"])).unwrap_or(Value::Null);
                    if state.available && state.snapshot == value && state.antenna == antenna { return; }
                    state.antenna = antenna;
                    state.snapshot = value; state.available = true; state.workspace_change = false;
                }
                None => { if !state.available { return; } state.available = false; }
            }
            Self::changed(&mut state);
        }
        drop(state); (self.publish)();
    }
    fn retire(&self, worker: u64) {
        let Ok(mut state) = self.state.lock() else { return; };
        if state.worker != worker || state.stopped { return; }
        state.fence += 1; state.available = false; Self::changed(&mut state);
        drop(state); (self.publish)();
    }
}
fn checked(value: &Value, worker: u64) -> Option<Value> {
    let generation = uuid::Uuid::parse_str(value["generation"].as_str()?).ok()?;
    if generation.is_nil() || worker == 0 || worker > 9_007_199_254_740_991 { return None; }
    let revision = value["revision"].as_u64().filter(|value| *value <= 9_007_199_254_740_991)?;
    let settings = &value["settings"];
    let text = |key: &str, limit: usize| settings[key].as_str().filter(|value| value.len() <= limit && !value.contains('\0')).map(str::to_owned);
    let mode = settings["logbookMode"].as_str().filter(|mode| matches!(*mode, "local" | "wavelog"))?;
    Some(json!({"workspace_generation":generation.to_string(),"worker_generation":worker,"settings_revision":revision,
        "operator_call":text("operatorCall",64)?,"station_call":text("stationCall",64)?,"grid":text("gridSquare",32)?,
        "location":text("stationLocation",512)?,"logbook_mode":mode}))
}
static OWNER: OnceLock<Projection> = OnceLock::new();
fn checked_antenna(value: &Value) -> Option<Value> {
    let display = value["display"].as_str().filter(|value| matches!(*value, "automatic" | "antenna" | "hidden"))?;
    let antenna = value["antenna"].as_str().filter(|value| matches!(*value, "vertical" | "wire" | "dipole" | "yagi" | "loop" | "other"))?;
    let name = value["name"].as_str().filter(|value| value.chars().count() <= 64 && !value.contains('\0'))?;
    let bands = value["bands"].as_array()?;
    let allowed = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
    if bands.len() > allowed.len() || bands.iter().any(|value| !value.as_str().is_some_and(|value| allowed.contains(&value)))
        || bands.iter().filter_map(Value::as_str).collect::<std::collections::HashSet<_>>().len() != bands.len() { return None; }
    Some(json!({"display":display,"antenna":antenna,"name":name,"bands":bands}))
}
pub fn validate_antenna(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if isolated || exiting || label != "antenna" { return Err("Saved antenna profile is unavailable in this window.".into()); }
    Ok(())
}
pub fn install(app: &tauri::AppHandle) {
    OWNER.get_or_init(|| { let app = app.clone(); Projection::new(Box::new(move || {
        let _ = app.emit_to("station-identity", "xlog:station-identity", ());
        let _ = app.emit_to("antenna", "xlog:antenna", ());
    })) });
}
pub fn begin(request: &Value, worker: u64) -> Option<Ticket> { OWNER.get()?.begin(request["method"].as_str()?, worker) }
pub fn finish(ticket: Option<Ticket>, response: &Result<Value, String>) { if let (Some(owner), Some(ticket)) = (OWNER.get(), ticket) { owner.finish(ticket, response); } }
pub fn retire(worker: u64) { if let Some(owner) = OWNER.get() { owner.retire(worker); } }
pub fn snapshot() -> Result<Value, String> { OWNER.get().ok_or("Saved identity has not been observed yet. Open Desk or Settings.")?.snapshot() }
pub fn antenna_snapshot() -> Result<Value, String> { OWNER.get().ok_or("Saved antenna has not been observed yet. Open Desk or Settings.")?.antenna_snapshot() }
pub fn shutdown() { if let Some(owner) = OWNER.get() { if let Ok(mut state) = owner.state.lock() { state.stopped = true; state.available = false; } } }

#[cfg(test)]
mod tests {
    use super::*;
    fn reply(revision: u64, generation: &str) -> Result<Value, String> { Ok(json!({"ok":true,"result":{"generation":generation,"revision":revision,
        "settings":{"operatorCall":"OM0RX","stationCall":"OM0RX/P","gridSquare":"JN88TQ","stationLocation":"Example QTH","logbookMode":"local",
            "wavelogURL":"private configuration not projected","qrzUsername":"not projected","automaticTransmitPower":true}}})) }
    const FIRST: &str = "00000000-0000-4000-8000-000000000001";
    const NEXT: &str = "00000000-0000-4000-8000-000000000002";
    #[test]
    fn passive_snapshot_contains_no_defaults_or_private_settings_and_cannot_read_or_write() {
        let projection = Projection::new(Box::new(|| {}));
        for _ in 0..20 { assert_eq!(projection.snapshot().unwrap()["snapshot"], Value::Null); }
        let ticket = projection.begin("settings_load", 3).unwrap(); projection.finish(ticket, &reply(2, FIRST));
        let value = projection.snapshot().unwrap(); assert_eq!(value["available"], true);
        assert_eq!(value["snapshot"]["station_call"], "OM0RX/P"); assert_eq!(value["snapshot"].as_object().unwrap().len(), 8);
        assert!(value.to_string().find("qrzUsername").is_none()); assert!(value.to_string().find("automaticTransmitPower").is_none());
        assert!(validate("station-identity", false, false).is_ok());
        for label in ["main", "settings", "station-status", "rotor", "unknown"] { assert!(validate(label, false, false).is_err()); }
        assert!(validate("station-identity", true, false).is_err()); assert!(validate("station-identity", false, true).is_err());
    }
    #[test]
    fn settings_and_workspace_changes_fence_old_or_inflight_reads_without_trusting_write_receipts() {
        let projection = Projection::new(Box::new(|| {}));
        let old = projection.begin("settings_load", 3).unwrap();
        let change = projection.begin("settings_save", 3).unwrap();
        let during = projection.begin("settings_load", 3).unwrap();
        projection.finish(old, &reply(1, FIRST)); projection.finish(during, &reply(1, FIRST));
        assert_eq!(projection.snapshot().unwrap()["available"], false);
        projection.finish(change, &reply(2, FIRST)); assert_eq!(projection.snapshot().unwrap()["available"], false);
        let latest = projection.begin("settings_load", 3).unwrap(); projection.finish(latest, &reply(2, FIRST));
        let restore = projection.begin("backup_restore", 3).unwrap(); let during = projection.begin("settings_load", 3).unwrap();
        projection.finish(restore, &Err("reply lost".into())); projection.finish(during, &reply(2, FIRST));
        assert_eq!(projection.snapshot().unwrap()["available"], false);
        let next = projection.begin("settings_load", 3).unwrap(); projection.finish(next, &reply(0, NEXT));
        assert_eq!(projection.snapshot().unwrap()["snapshot"]["workspace_generation"], NEXT);
    }
    #[test]
    fn worker_retirement_replacement_and_late_lower_revisions_cannot_resurrect_old_identity() {
        let projection = Projection::new(Box::new(|| {}));
        let first = projection.begin("settings_load", 3).unwrap(); projection.finish(first, &reply(4, FIRST));
        let old = projection.begin("settings_load", 3).unwrap(); projection.retire(3); projection.finish(old, &reply(5, FIRST));
        assert_eq!(projection.snapshot().unwrap()["available"], false);
        let current = projection.begin("settings_load", 4).unwrap(); projection.finish(current, &reply(1, NEXT));
        assert!(projection.begin("settings_load", 3).is_none());
        projection.retire(3); assert_eq!(projection.snapshot().unwrap()["available"], true);
        let lower = projection.begin("settings_load", 4).unwrap(); projection.finish(lower, &reply(0, NEXT));
        assert_eq!(projection.snapshot().unwrap()["snapshot"]["settings_revision"], 1);
    }
    #[test]
    fn unobserved_workspace_generation_changes_fail_closed_instead_of_ordering_opaque_ids() {
        let projection = Projection::new(Box::new(|| {}));
        let first = projection.begin("settings_load", 3).unwrap(); projection.finish(first, &reply(4, FIRST));
        let unexpected = projection.begin("settings_load", 3).unwrap(); projection.finish(unexpected, &reply(0, NEXT));
        assert_eq!(projection.snapshot().unwrap()["available"], false);
        let old = projection.begin("settings_load", 3).unwrap(); projection.finish(old, &reply(4, FIRST));
        assert_eq!(projection.snapshot().unwrap()["available"], false);
    }
    #[test]
    fn antenna_uses_the_same_canonical_settings_fence_without_defaults_or_private_fields() {
        let projection = Projection::new(Box::new(|| {}));
        assert_eq!(projection.antenna_snapshot().unwrap()["snapshot"], Value::Null);
        let mut saved = reply(4, FIRST).unwrap();
        saved["result"]["settings"]["stationEquipment"] = json!({"display":"antenna","antenna":"dipole","name":"Garden","bands":["20m","40m"],"private":"never exposed"});
        let read = projection.begin("settings_load", 3).unwrap(); projection.finish(read, &Ok(saved.clone()));
        let value = projection.antenna_snapshot().unwrap(); assert_eq!(value["available"], true);
        assert_eq!(value["snapshot"]["name"], "Garden"); assert_eq!(value["snapshot"].as_object().unwrap().len(), 7);
        assert!(!value.to_string().contains("private")); assert_eq!(projection.snapshot().unwrap()["snapshot"].as_object().unwrap().len(), 8);
        let mut stale = saved.clone(); stale["result"]["revision"] = json!(3); stale["result"]["settings"]["stationEquipment"]["name"] = json!("Old installation");
        let lower = projection.begin("settings_load", 3).unwrap(); projection.finish(lower, &Ok(stale));
        assert_eq!(projection.antenna_snapshot().unwrap()["snapshot"]["name"], "Garden");
        let old = projection.begin("settings_load", 3).unwrap(); let change = projection.begin("settings_save", 3).unwrap();
        projection.finish(old, &Ok(saved.clone())); projection.finish(change, &Ok(saved));
        assert_eq!(projection.antenna_snapshot().unwrap()["available"], false);
        assert_eq!(projection.antenna_snapshot().unwrap()["snapshot"]["name"], "Garden");
        let fresh = projection.begin("settings_load", 3).unwrap(); projection.finish(fresh, &reply(5, FIRST));
        assert_eq!(projection.antenna_snapshot().unwrap()["available"], false); assert_eq!(projection.antenna_snapshot().unwrap()["snapshot"], Value::Null);
        assert!(validate_antenna("antenna", false, false).is_ok());
        assert!(validate_antenna("antenna", true, false).is_err()); assert!(validate_antenna("antenna", false, true).is_err());
        for label in ["main", "station-identity", "station-control", "settings"] { assert!(validate_antenna(label, false, false).is_err()); }
    }
    #[test]
    fn antenna_schema_rejects_incomplete_unknown_or_duplicate_profile_values() {
        assert!(checked_antenna(&json!({})).is_none());
        let mut value = json!({"display":"antenna","antenna":"dipole","name":"Garden","bands":["20m"]});
        assert!(checked_antenna(&value).is_some());
        value["bands"] = json!(["20m","20m"]); assert!(checked_antenna(&value).is_none());
        value["bands"] = json!(["unknown"]); assert!(checked_antenna(&value).is_none());
        value["bands"] = json!([]); value["antenna"] = json!("switch"); assert!(checked_antenna(&value).is_none());
    }
}
