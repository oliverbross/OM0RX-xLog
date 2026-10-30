//! Callsign-only intent through the sole contest Entry consumer. No RF/QSO log.
use serde_json::{json,Value};
use std::{collections::BTreeMap,sync::{Mutex,OnceLock}};
#[derive(Clone)]
struct Intent{context:crate::contest_window_context::ContestWindowContext,request:crate::spot_activation::Request,draft_scope:Value}
fn intents()->&'static Mutex<BTreeMap<String,Intent>> {
    static INTENTS:OnceLock<Mutex<BTreeMap<String,Intent>>>=OnceLock::new();INTENTS.get_or_init(||Mutex::new(BTreeMap::new()))
}
pub fn owns(operation:&str)->bool{intents().lock().is_ok_and(|rows|rows.contains_key(operation))}
fn intent(operation:&str)->Result<Intent,String>{
    if operation.len()!=36 || !uuid::Uuid::parse_str(operation).is_ok_and(|id|!id.is_nil()){return Err("CW Entry operation identity is invalid.".into());}
    intents().lock().map_err(|_|"CW Entry intent unavailable.")?.get(operation).cloned().ok_or_else(||"CW Entry intent is not retained. Review Main Logging before selecting again.".into())
}
pub fn validate_owner(label:&str,isolated:bool,exiting:bool)->Result<(),String>{
    if label!="contest-setup" || isolated || exiting{Err("Only the sole contest Entry owner can resolve this callsign intent.".into())}else{Ok(())}
}
fn entry(context:&crate::contest_window_context::ContestWindowContext)->Result<Value,String>{
    crate::contest_surface::snapshot("contest--active-qso",context)
}
fn require_cw_idle()->Result<(),String>{
    if let Some(owner)=crate::cw_session_backend::existing(){
        let value=owner.snapshot()?;
        validate_cw_idle(&value)?;
    }
    Ok(())
}
fn validate_cw_idle(value:&Value)->Result<(),String>{
    if value["armed"]!=false || value["pending"]!=false || !value["owner"].is_null() || !value["lease"].is_null() || value["error"].as_str()!=Some("") {
        return Err("Stop and reconcile the current CW output lease before loading a callsign.".into());
    }
    Ok(())
}
fn ready(snapshot:&Value)->Result<(&Value,&Value),String>{
    let projection=&snapshot["projection"];let draft=&projection["draft"];
    if projection["status"]!="ready" || projection["busy"]!=false || projection["dirty"]!=false || projection["uncertain"]!=false
        || projection["operator"]["armed"]!=false || projection["operator"]["status"]!="disarmed"
        || !draft["draftID"].is_string() || !draft["revision"].is_u64() {
        return Err("Finish the current Entry operation and disarm contest output before loading a CW callsign.".into());
    }
    Ok((projection,draft))
}
fn envelope(snapshot:&Value,context:&crate::contest_window_context::ContestWindowContext,request:&crate::spot_activation::Request)->Result<Value,String>{
    let (_,draft)=ready(snapshot)?;
    Ok(json!({"operatingContext":context.operating_context,"scope":"contesting","sessionID":context.session_id,
        "workspaceGeneration":context.workspace_generation,"panelID":"active-qso","projectionRevision":snapshot["projectionRevision"],
        "requestID":request.operation_id,"action":"entry_cw_callsign","params":{"draftID":draft["draftID"],"expectedDraftRevision":draft["revision"],
        "sourceEpoch":request.source_epoch,"spotID":request.spot_id,"spotVersion":request.spot_version}}))
}
fn outcome(operation:&str,receipt:&Value)->Result<Value,String>{
    if receipt["requestID"]!=operation {return Err("CW Entry outcome could not be correlated.".into());}
    let (phase,pending)=match receipt["status"].as_str(){Some("queued"|"uncertain")=>("preparing",true),
        Some("applied")=>("confirmed",false),Some("rejected")=>("failed",false),_=>return Err("CW Entry outcome is unavailable. Review Main Logging.".into())};
    let mut value=json!({"operationId":operation,"phase":phase,"reservationActive":pending});
    if let Some(message)=receipt["message"].as_str(){value["error"]=json!(message);}
    Ok(value)
}
pub fn status(operation:&str)->Result<Value,String>{
    let intent=intent(operation)?;let snapshot=entry(&intent.context)?;
    let receipt=snapshot["receipts"].as_array().and_then(|rows|rows.iter().find(|value|value["requestID"]==operation))
        .ok_or("CW Entry receipt is no longer retained. Review Main Logging; no action was replayed.")?;
    outcome(operation,receipt)
}
pub fn apply(app:&tauri::AppHandle,request:crate::spot_activation::Request)->Result<Value,String>{
    let context=crate::contest_window_context::active()?;
    if let Ok(old)=intent(&request.operation_id){
        if old.context!=context || old.request!=request{return Err("CW Entry identity is bound to another request.".into());}
        return status(&request.operation_id);
    }
    crate::cw_track_selection::resolve(&request)?;
    require_cw_idle()?;
    let snapshot=entry(&context)?;let envelope=envelope(&snapshot,&context,&request)?;
    let mut rows=intents().lock().map_err(|_|"CW Entry intent unavailable.")?;
    if rows.len()>=4096{return Err("CW Entry intent history is full. Restart safely before continuing.".into());}
    crate::radio_follow::revoke_silently();crate::auto_rotor::revoke();
    let draft_scope=envelope["params"].clone();
    let submitted=crate::contest_surface::submit("contest--active-qso",envelope,false)?;
    rows.insert(request.operation_id.clone(),Intent{context,request:request.clone(),draft_scope});drop(rows);
    let _=app.emit_to("contest-setup","xlog:contest-surface",());
    outcome(&request.operation_id,&submitted)
}
pub fn apply_outcome(app:&tauri::AppHandle,request:crate::spot_activation::Request)->Result<Value,String>{
    let operation=request.operation_id.clone();
    match apply(app,request){
        Ok(value)=>Ok(value),
        Err(error) if !owns(&operation)=>Ok(json!({"operationId":operation,"phase":"failed","reservationActive":false,"error":error})),
        Err(error)=>Err(error),
    }
}
pub fn resolve_for_owner(operation:&str)->Result<Value,String>{
    require_cw_idle()?;
    let intent=intent(operation)?;let before=entry(&intent.context)?;
    let receipt=before["receipts"].as_array().and_then(|rows|rows.iter().find(|value|value["requestID"]==operation))
        .ok_or("CW Entry receipt is unavailable.")?;
    if receipt["status"]!="uncertain"{return Err("The sole Entry owner has not taken this CW action.".into());}
    let expected=envelope(&before,&intent.context,&intent.request)?;
    if expected["params"]!=intent.draft_scope{return Err("Contest Entry changed before CW readback.".into());}
    let target=crate::cw_track_selection::resolve(&intent.request)?;
    let after=entry(&intent.context)?;
    require_cw_idle()?;
    if envelope(&after,&intent.context,&intent.request)?["params"]!=expected["params"] {return Err("Contest Entry changed during CW readback.".into());}
    Ok(json!({"operationId":operation,"callsign":target["call"],"draftID":expected["params"]["draftID"],
        "expectedDraftRevision":expected["params"]["expectedDraftRevision"],"operatingContext":intent.context.operating_context,
        "sessionID":intent.context.session_id,"workspaceGeneration":intent.context.workspace_generation}))
}
use tauri::Emitter;

#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->(Value,crate::contest_window_context::ContestWindowContext,crate::spot_activation::Request){
        (json!({"projectionRevision":8,"projection":{"status":"ready","busy":false,"dirty":false,"uncertain":false,
            "operator":{"armed":false,"status":"disarmed"},"draft":{"draftID":"draft","revision":4}}}),
         crate::contest_window_context::ContestWindowContext{operating_context:uuid::Uuid::new_v4().to_string(),session_id:uuid::Uuid::new_v4().to_string(),workspace_generation:uuid::Uuid::new_v4().to_string()},
         crate::spot_activation::Request{operation_id:uuid::Uuid::new_v4().to_string(),source_epoch:uuid::Uuid::new_v4().to_string(),spot_id:uuid::Uuid::new_v4().to_string(),spot_version:uuid::Uuid::new_v4().to_string()})
    }
    #[test]
    fn cw_entry_envelope_is_revision_fenced_identity_only_and_refuses_dirty_or_armed_entry(){
        let (snapshot,context,request)=fixture();let value=envelope(&snapshot,&context,&request).unwrap();
        assert_eq!(value["action"],"entry_cw_callsign");assert_eq!(value["params"]["expectedDraftRevision"],4);
        assert_eq!(value["params"].as_object().unwrap().len(),5);assert!(value["params"].get("callsign").is_none());assert!(value["params"].get("frequencyHz").is_none());
        for path in ["/projection/busy","/projection/dirty","/projection/uncertain","/projection/operator/armed"]{
            let mut denied=snapshot.clone();*denied.pointer_mut(path).unwrap()=json!(true);assert!(envelope(&denied,&context,&request).is_err());
        }
    }
    #[test]
    fn queued_and_taken_receipts_never_claim_completion_or_release_the_pending_intent(){
        let (_,_,request)=fixture();let operation=&request.operation_id;
        for status in ["queued","uncertain"]{let value=outcome(operation,&json!({"requestID":operation,"status":status})).unwrap();assert_eq!(value["reservationActive"],true);assert_ne!(value["phase"],"confirmed");}
        assert_eq!(outcome(operation,&json!({"requestID":operation,"status":"applied"})).unwrap()["phase"],"confirmed");
        assert_eq!(outcome(operation,&json!({"requestID":operation,"status":"rejected","message":"Entry changed"})).unwrap()["error"],"Entry changed");
        assert!(outcome(operation,&json!({"requestID":uuid::Uuid::new_v4().to_string(),"status":"applied"})).is_err());
    }
    #[test]
    fn resolver_is_only_for_live_sole_owner(){
        assert!(validate_owner("contest-setup",false,false).is_ok());
        for label in ["main","cw-decode","contest--cw-decode","contest--active-qso",""]{assert!(validate_owner(label,false,false).is_err());}
        assert!(validate_owner("contest-setup",true,false).is_err());assert!(validate_owner("contest-setup",false,true).is_err());
    }
    #[test]
    fn native_cw_lease_and_uncertain_output_veto_callsign_loading_without_stop(){
        let idle=json!({"armed":false,"pending":false,"owner":null,"lease":null,"error":""});assert!(validate_cw_idle(&idle).is_ok());
        for (key,value) in [("armed",json!(true)),("pending",json!(true)),("owner",json!({"output":"radio"})),("lease",json!("retained")),("error",json!("release unknown"))]{
            let mut blocked=idle.clone();blocked[key]=value;assert!(validate_cw_idle(&blocked).is_err());
        }
        assert!(validate_cw_idle(&json!({})).is_err());
    }
}
