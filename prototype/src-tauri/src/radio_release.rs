//! Durable, existing-session Cancel admission, independent of nonurgent station work.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io::Write, path::PathBuf, sync::{Arc, Mutex, OnceLock}};
use tauri::Manager;

const MAX_INTEGER: u64 = 9_007_199_254_740_991;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    provider: String,
    selection_generation: u64,
    selection_id: String,
    worker_generation: u64,
    connection_generation: u64,
}
impl Target {
    fn validate(&self) -> Result<(), String> {
        if !matches!(self.provider.as_str(), "direct_agent" | "direct_flex_lan")
            || uuid::Uuid::parse_str(&self.selection_id).is_err()
            || self.worker_generation == 0
            || [self.selection_generation, self.worker_generation, self.connection_generation].iter().any(|v| *v > MAX_INTEGER) {
            return Err("Refresh the exact radio connection before requesting Cancel.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt { operation_id: String, target: Target, status: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved { version: u8, receipts: Vec<Receipt> }
pub struct Session { path: PathBuf, state: Mutex<Saved> }
pub fn validate(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if isolated || exiting || !matches!(label, "main" | "monitor" | "station-control")
        || !matches!(action, "snapshot" | "cancel" | "receipt" | "review") {
        return Err("Radio Cancel is unavailable in this window.".into());
    }
    Ok(())
}
impl Session {
    fn new(path: PathBuf) -> Result<Self, String> {
        let mut saved = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Saved>(&bytes).map_err(|_| "Saved radio Cancel journal is invalid; it was not overwritten.")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Saved { version: 1, receipts: vec![] },
            Err(_) => return Err("Radio Cancel journal is unavailable.".into()),
        };
        if saved.version != 1 { return Err("Unsupported radio Cancel journal.".into()); }
        let mut ids = std::collections::HashSet::new();
        for receipt in &mut saved.receipts {
            receipt.target.validate()?;
            if uuid::Uuid::parse_str(&receipt.operation_id).is_err() || !ids.insert(receipt.operation_id.clone())
                || !matches!(receipt.status.as_str(), "pending" | "unknown" | "acknowledged" | "confirmed" | "reviewed") {
                return Err("Saved radio Cancel receipt is invalid.".into());
            }
            if receipt.status == "pending" { receipt.status = "unknown".into(); }
        }
        Ok(Self { path, state: Mutex::new(saved) })
    }
    fn persist(&self, state: &Saved) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Radio Cancel storage unavailable.")?;
        std::fs::create_dir_all(parent).map_err(|_| "Radio Cancel storage unavailable.")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| "Radio Cancel receipt could not be saved.")?;
        file.write_all(&serde_json::to_vec(state).map_err(|_| "Radio Cancel receipt serialization failed.")?)
            .map_err(|_| "Radio Cancel receipt could not be saved.")?;
        file.as_file().sync_all().map_err(|_| "Radio Cancel receipt could not be saved.")?;
        file.persist(&self.path).map_err(|_| "Radio Cancel receipt could not be saved.")?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Radio Cancel journal unavailable.")?;
        Ok(json!({"receipts":state.receipts.iter().filter(|r| matches!(r.status.as_str(), "pending" | "unknown")).collect::<Vec<_>>() }))
    }
    pub fn receipt(&self, id: &str) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Radio Cancel journal unavailable.")?;
        Ok(state.receipts.iter().find(|r| r.operation_id == id).map_or(Value::Null, |r| json!(r)))
    }
    pub fn review(&self, id: &str) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "Radio Cancel journal unavailable.")?;
        let index = state.receipts.iter().position(|r| r.operation_id == id).ok_or("Radio Cancel receipt not found.")?;
        if state.receipts[index].status == "reviewed" { return Ok(json!(state.receipts[index])); }
        if state.receipts[index].status != "unknown" { return Err("Only an unknown Cancel can be reviewed.".into()); }
        let mut next = state.clone(); next.receipts[index].status = "reviewed".into();
        self.persist(&next)?; *state = next;
        Ok(json!(state.receipts[index]))
    }
    pub fn cancel(&self, id: &str, target: Target, dispatch: impl FnOnce(Value, &Target) -> Result<Value, String>) -> Result<Value, String> {
        target.validate()?;
        if uuid::Uuid::parse_str(id).is_err() { return Err("Invalid radio Cancel operation identity.".into()); }
        {
            let mut state = self.state.lock().map_err(|_| "Radio Cancel journal unavailable.")?;
            if let Some(old) = state.receipts.iter().find(|r| r.operation_id == id) {
                if old.target != target { return Err("Radio Cancel identity already belongs to a different target.".into()); }
                return Ok(json!(old));
            }
            // Retain terminal receipts as permanent UUID tombstones. Never evict
            // an identity and accidentally regain authority to dispatch it.
            let mut next = state.clone(); next.receipts.push(Receipt { operation_id: id.into(), target: target.clone(), status: "pending".into() });
            self.persist(&next)?; *state = next;
        }
        let response = dispatch(json!({"id":id,"method":"station_action", "params":{
            "provider":target.provider,"action":"cancel","expected_generation":target.connection_generation}}), &target);
        let status = outcome(id, &target, &response);
        let mut state = self.state.lock().map_err(|_| "Radio Cancel outcome unknown; check its receipt.")?;
        let mut next = state.clone();
        // Another explicit Cancel may have been admitted while transport waited.
        let receipt = next.receipts.iter_mut().find(|r| r.operation_id == id).ok_or("Radio Cancel receipt missing.")?;
        receipt.status = status.into(); let result = json!(receipt);
        if self.persist(&next).is_err() {
            next.receipts.iter_mut().find(|r| r.operation_id == id).unwrap().status = "unknown".into();
            *state = next;
            return Err("Radio Cancel outcome could not be saved; check its receipt. No Cancel will be replayed.".into());
        }
        *state = next; Ok(result)
    }
}
fn outcome(id: &str, target: &Target, response: &Result<Value, String>) -> &'static str {
    let Ok(response) = response else { return "unknown"; };
    let result = &response["result"]; let state = &result["state"];
    if response["id"] != id || response["ok"] != true || result["accepted"] != true || result["action"] != "cancel"
        || state["source"] != target.provider || state["generation"] != target.connection_generation {
        return "unknown";
    }
    if target.provider == "direct_flex_lan" {
        if result["confirmed"] == true && state["radio"]["connected"] == true && state["radio"]["observed"] == true
            && state["radio"]["transmitting"] == false { "confirmed" } else { "unknown" }
    } else if result["confirmed"] == false { "acknowledged" } else { "unknown" }
}
pub fn execute(app: &tauri::AppHandle, request: Value, target: &Target) -> Result<Value, String> {
    crate::worker::require_existing_generation(target.worker_generation)?;
    let telemetry = crate::station_telemetry::owner(app)?;
    crate::station_selection::owner(app)?.release_control(request, target.selection_generation, &target.selection_id,
        || { crate::worker::require_existing_generation(target.worker_generation)?; telemetry.control() },
        |request| {
            let result = crate::worker::request_existing_generation(request, target.worker_generation)?;
            crate::worker::require_existing_generation(target.worker_generation)?; Ok(result)
        })
}
pub fn context(app: &tauri::AppHandle) -> Result<Value, String> {
    let selection = crate::station_selection::owner(app)?.snapshot()?;
    let radio = crate::station_telemetry::owner(app)?.snapshot()?;
    let target = if radio["provider"] == selection["provider"] && radio["selection_id"] == selection["selection_id"]
        && radio["selection_generation"] == selection["generation"] {
        serde_json::from_value::<Target>(json!({"provider":selection["provider"],"selection_generation":selection["generation"],
            "selection_id":selection["selection_id"],"worker_generation":radio["worker_generation"],"connection_generation":radio["snapshot"]["generation"]}))
            .ok().filter(|t| t.validate().is_ok())
    } else { None };
    Ok(json!({"target":target}))
}
static OWNER: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<Session>, String> {
    let mut value = OWNER.get_or_init(|| Mutex::new(None)).lock().map_err(|_| "Radio Cancel owner unavailable.")?;
    if let Some(value) = value.as_ref() { return Ok(value.clone()); }
    let owner = Arc::new(Session::new(app.path().app_config_dir().map_err(|_| "Radio Cancel storage unavailable.")?.join("radio-release.json"))?);
    *value = Some(owner.clone()); Ok(owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target() -> Target { Target { provider:"direct_agent".into(), selection_generation:1, selection_id:uuid::Uuid::new_v4().to_string(), worker_generation:2, connection_generation:3 } }
    fn response(request: &Value, target: &Target) -> Value { json!({"id":request["id"],"ok":true,"result":{"action":"cancel","accepted":true,"confirmed":false,"state":{"source":target.provider,"generation":target.connection_generation}}}) }
    #[test]
    fn admission_dedupe_collision_restart_and_review_never_replay() {
        let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("release.json"); let session=Session::new(path.clone()).unwrap();
        let id=uuid::Uuid::new_v4().to_string(); let t=target();
        let receipt=session.cancel(&id,t.clone(),|request,t| { assert_eq!(session.receipt(&id).unwrap()["status"],"pending"); Ok(response(&request,t)) }).unwrap();
        assert_eq!(receipt["status"],"acknowledged");
        assert_eq!(Session::new(path.clone()).unwrap().cancel(&id,t.clone(),|_,_| panic!("replay")).unwrap()["status"],"acknowledged");
        let mut changed=t.clone(); changed.connection_generation+=1; assert!(session.cancel(&id,changed,|_,_| panic!()).is_err());
        let unknown=uuid::Uuid::new_v4().to_string(); assert_eq!(session.cancel(&unknown,t.clone(),|_,_| Err("lost".into())).unwrap()["status"],"unknown");
        assert_eq!(session.review(&unknown).unwrap()["status"],"reviewed");
        assert_eq!(Session::new(path).unwrap().cancel(&unknown,t,|_,_| panic!()).unwrap()["status"],"reviewed");
    }
    #[test]
    fn failed_storage_never_dispatches_and_pending_restart_is_unknown() {
        let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("release.json"); let session=Session::new(path.clone()).unwrap(); let id=uuid::Uuid::new_v4().to_string(); let t=target();
        session.persist(&Saved{version:1,receipts:vec![Receipt{operation_id:id.clone(),target:t.clone(),status:"pending".into()}]}).unwrap();
        assert_eq!(Session::new(path).unwrap().cancel(&id,t.clone(),|_,_| panic!()).unwrap()["status"],"unknown");
        let bad=Session::new(dir.path().join("missing").join("release.json")).unwrap(); std::fs::write(dir.path().join("missing"),b"file").unwrap();
        assert!(bad.cancel(&uuid::Uuid::new_v4().to_string(),t,|_,_| panic!("dispatch before storage")).is_err());
    }
    #[test]
    fn concurrent_release_finalizes_exact_id_and_malformed_reply_is_unknown() {
        let dir=tempfile::tempdir().unwrap(); let session=Session::new(dir.path().join("release.json")).unwrap(); let one=uuid::Uuid::new_v4().to_string(); let two=uuid::Uuid::new_v4().to_string(); let t=target();
        session.cancel(&one,t.clone(),|request,t| { session.cancel(&two,t.clone(),|_,_| Ok(json!({"ok":true}))).unwrap(); Ok(response(&request,t)) }).unwrap();
        assert_eq!(session.receipt(&one).unwrap()["status"],"acknowledged"); assert_eq!(session.receipt(&two).unwrap()["status"],"unknown");
    }
    #[test]
    fn post_dispatch_storage_failure_retains_unknown_and_flex_requires_observed_release() {
        let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("release.json"); let session=Session::new(path.clone()).unwrap(); let id=uuid::Uuid::new_v4().to_string(); let t=target();
        assert!(session.cancel(&id,t.clone(),|request,t| {
            std::fs::rename(&path,dir.path().join("pending.json")).unwrap(); std::fs::create_dir(&path).unwrap();
            Ok(response(&request,t))
        }).is_err());
        assert_eq!(session.receipt(&id).unwrap()["status"],"unknown");
        assert_eq!(session.cancel(&id,t.clone(),|_,_| panic!("replay after failed save")).unwrap()["status"],"unknown");
        let mut flex=t; flex.provider="direct_flex_lan".into(); let request=json!({"id":id}); let mut reply=response(&request,&flex);
        reply["result"]["confirmed"]=json!(true);
        assert_eq!(outcome(&id,&flex,&Ok(reply.clone())),"unknown");
        reply["result"]["state"]["radio"]=json!({"connected":true,"observed":true,"transmitting":false});
        assert_eq!(outcome(&id,&flex,&Ok(reply)),"confirmed");
    }
    #[test]
    fn only_live_radio_release_surfaces_and_typed_targets_are_admitted() {
        for label in ["main","monitor","station-control"] { assert!(validate(label,false,false,"cancel").is_ok()); }
        for label in ["cw","rotor","settings","station-status"] { assert!(validate(label,false,false,"cancel").is_err()); }
        assert!(validate("main",true,false,"cancel").is_err()); assert!(validate("main",false,true,"cancel").is_err());
        let mut invalid=target(); invalid.provider="hamlib".into(); assert!(invalid.validate().is_err());
        invalid=target(); invalid.worker_generation=0; assert!(invalid.validate().is_err());
    }
}
