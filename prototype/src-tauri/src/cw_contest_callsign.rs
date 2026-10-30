//! Callsign-only intent through the sole contest Entry consumer. No RF/QSO log.
use serde_json::{json,Value};
use std::{collections::BTreeMap,io::{Read,Write},path::PathBuf,sync::{Mutex,OnceLock}};
use tauri::Manager;
const MAX_INTENTS:usize=4096;
const MAX_JOURNAL_BYTES:u64=4*1024*1024;
#[derive(Clone,serde::Serialize,serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent{context:crate::contest_window_context::ContestWindowContext,request:crate::spot_activation::Request,draft_scope:Value,callsign:String,terminal:Option<Value>}
#[derive(Default,serde::Serialize,serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved{version:u8,rows:BTreeMap<String,Intent>}
struct Journal{path:PathBuf,saved:Saved}
impl Journal {
    fn pending(&self)->bool{self.saved.rows.values().any(|row|row.terminal.is_none())}
    fn load(path:PathBuf)->Result<Self,String>{
        let mut options=std::fs::OpenOptions::new();options.read(true);
        #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.custom_flags(libc::O_NOFOLLOW);}
        let saved=match options.open(&path){
            Ok(mut file)=>{
                let metadata=file.metadata().map_err(|_|"CW Entry journal cannot be inspected.")?;
                if !metadata.is_file() || metadata.len()>MAX_JOURNAL_BYTES{return Err("CW Entry journal exceeds its storage contract; it was preserved.".into());}
                let mut bytes=Vec::new();Read::by_ref(&mut file).take(MAX_JOURNAL_BYTES+1).read_to_end(&mut bytes).map_err(|_|"CW Entry journal cannot be read.")?;
                if bytes.len() as u64>MAX_JOURNAL_BYTES{return Err("CW Entry journal exceeds its storage bound.".into());}
                let value:Saved=serde_json::from_slice(&bytes).map_err(|_|"CW Entry journal is unreadable; preserve it and review the original action.")?;
                if value.version!=1 || value.rows.len()>MAX_INTENTS{return Err("CW Entry journal version or count is unsupported.".into());}
                for (operation,intent) in &value.rows{validate_intent(operation,intent)?;}
                value
            },
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Saved{version:1,..Saved::default()},
            Err(_)=>return Err("CW Entry journal is unavailable; no action was repeated.".into()),
        };
        Ok(Self{path,saved})
    }
    fn persist(&self)->Result<(),String>{
        let bytes=serde_json::to_vec(&self.saved).map_err(|_|"CW Entry journal serialization failed.")?;
        if bytes.len() as u64>MAX_JOURNAL_BYTES{return Err("CW Entry journal is full; retain the original action for review.".into());}
        let parent=self.path.parent().ok_or("CW Entry storage is unavailable.")?;
        std::fs::create_dir_all(parent).map_err(|_|"CW Entry storage is unavailable.")?;
        let mut file=tempfile::NamedTempFile::new_in(parent).map_err(|_|"CW Entry journal cannot be saved.")?;
        file.write_all(&bytes).and_then(|_|file.as_file().sync_all()).map_err(|_|"CW Entry journal cannot be saved.")?;
        file.persist(&self.path).map_err(|_|"CW Entry journal cannot be replaced.")?;
        std::fs::File::open(parent).and_then(|file|file.sync_all()).map_err(|_|"CW Entry journal durability is uncertain.")?;
        Ok(())
    }
    fn insert(&mut self,intent:Intent)->Result<(),String>{
        let operation=intent.request.operation_id.clone();validate_intent(&operation,&intent)?;
        if self.saved.rows.contains_key(&operation){return Err("CW Entry operation is already retained; check its original receipt.".into());}
        if self.saved.rows.len()>=MAX_INTENTS{return Err("CW Entry journal is full; retained operations were preserved.".into());}
        if self.pending(){return Err("Reconcile the original CW Entry action before loading another callsign.".into());}
        // Hold the identity even if persistence fails; nothing is queued until it succeeds.
        self.saved.rows.insert(operation,intent);self.persist()
    }
    fn finish(&mut self,operation:&str,value:Value)->Result<Value,String>{
        validate_terminal(operation,&value)?;
        let row=self.saved.rows.get_mut(operation).ok_or("CW Entry intent is missing.")?;
        if let Some(old)=&row.terminal {if old!=&value{return Err("CW Entry receipt conflicts with its retained outcome.".into());}}
        row.terminal=Some(value.clone());self.persist()?;Ok(value)
    }
}
fn uuid(value:&str)->bool{uuid::Uuid::parse_str(value).is_ok_and(|id|!id.is_nil() && id.to_string().eq_ignore_ascii_case(value))}
fn validate_terminal(operation:&str,value:&Value)->Result<(),String>{
    let object=value.as_object().ok_or("CW Entry receipt is malformed.")?;
    if value["operationId"]!=operation || value["reservationActive"]!=false || !matches!(value["phase"].as_str(),Some("confirmed"|"failed"))
        || object.keys().any(|key|!matches!(key.as_str(),"operationId"|"reservationActive"|"phase"|"error"))
        || object.get("error").is_some_and(|error|error.as_str().is_none_or(|text|text.len()>4096)){
        return Err("CW Entry receipt is malformed; preserve the original journal.".into());
    }Ok(())
}
fn validate_intent(operation:&str,intent:&Intent)->Result<(),String>{
    let request=&intent.request;let context=&intent.context;
    if operation!=request.operation_id || [&request.operation_id,&request.source_epoch,&request.spot_id,&request.spot_version,&context.operating_context,&context.session_id,&context.workspace_generation].iter().any(|value|!uuid(value))
        || intent.callsign.len()<3 || intent.callsign.len()>32 || !intent.callsign.bytes().all(|b|b.is_ascii_uppercase()||b.is_ascii_digit()||b==b'/')
        || intent.draft_scope.as_object().is_none_or(|value|!matches!(value.len(),5|7))
        || !intent.draft_scope["draftID"].as_str().is_some_and(uuid) || !intent.draft_scope["expectedDraftRevision"].is_u64()
        || intent.draft_scope["sourceEpoch"]!=request.source_epoch || intent.draft_scope["spotID"]!=request.spot_id || intent.draft_scope["spotVersion"]!=request.spot_version{
        return Err("CW Entry journal identity or scope is malformed; it was preserved.".into());
    }
    let mut target=intent.draft_scope.clone();for key in ["sourceEpoch","spotID","spotVersion"]{target.as_object_mut().unwrap().remove(key);}
    validate_entry_target(&target)?;
    if let Some(value)=&intent.terminal{validate_terminal(operation,value)?;}Ok(())
}
static JOURNAL:OnceLock<Result<Mutex<Journal>,String>>=OnceLock::new();
pub fn initialize(app:&tauri::AppHandle)->Result<(),String>{
    let path=app.path().app_config_dir().map_err(|_|"CW Entry storage is unavailable.")?.join("cw-contest-callsign-intents.json");
    match JOURNAL.get_or_init(||Journal::load(path).map(Mutex::new)){Ok(_)=>Ok(()),Err(error)=>Err(error.clone())}
}
fn journal()->Result<&'static Mutex<Journal>,String>{JOURNAL.get().ok_or("CW Entry journal has not been opened.")?.as_ref().map_err(Clone::clone)}
pub fn owns(operation:&str)->bool{journal().is_ok_and(|journal|journal.lock().is_ok_and(|value|value.saved.rows.contains_key(operation)))}
pub fn retained()->Result<Vec<String>,String>{Ok(journal()?.lock().map_err(|_|"CW Entry journal unavailable.")?.saved.rows.iter().filter(|(_,row)|row.terminal.is_none()).map(|(operation,_)|operation.clone()).collect())}
pub fn pending()->bool{match JOURNAL.get(){None=>false,Some(Err(_))=>true,Some(Ok(journal))=>journal.try_lock().map_or(true,|value|value.pending())}}
fn intent(operation:&str)->Result<Intent,String>{
    if operation.len()!=36 || !uuid::Uuid::parse_str(operation).is_ok_and(|id|!id.is_nil()){return Err("CW Entry operation identity is invalid.".into());}
    journal()?.lock().map_err(|_|"CW Entry intent unavailable.")?.saved.rows.get(operation).cloned().ok_or_else(||"CW Entry intent is not retained. Review Main Logging before selecting again.".into())
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
        || draft["callsign"].as_str().is_none_or(|call|!call.trim().is_empty())
        || !draft["draftID"].is_string() || !draft["revision"].is_u64() {
        return Err("Finish the occupied Entry or pending operation and disarm contest output before loading a CW callsign.".into());
    }
    Ok((projection,draft))
}
pub fn validate_entry_target(value:&Value)->Result<(),String>{
    let object=value.as_object().ok_or("CW Entry target is malformed.")?;
    if !value["draftID"].as_str().is_some_and(|id|!id.is_empty()&&id.len()<=160) || !value["expectedDraftRevision"].as_u64().is_some_and(|n|n<=9_007_199_254_740_991)
        || if object.contains_key("laneID") {object.len()!=4 || !matches!(value["laneID"].as_str(),Some("laneA"|"laneB")) ||
            !value["bindingVersion"].as_u64().is_some_and(|n|n<=9_007_199_254_740_991)} else {object.len()!=2}{
        return Err("CW Entry target is malformed or its lane binding is unavailable.".into());
    }Ok(())
}
fn entry_target(snapshot:&Value)->Result<Value,String>{
    let (projection,draft)=ready(snapshot)?;
    let mut target=json!({"draftID":draft["draftID"],"expectedDraftRevision":draft["revision"]});
    if let Some(lane)=projection["session"].get("laneContext"){
        if !matches!(lane["mode"].as_str(),Some("SO2V"|"SO2R")){return Err("Contest Entry lane mode is unavailable.".into());}
        target["laneID"]=lane["laneID"].clone();target["bindingVersion"]=lane["bindingVersion"].clone();
    }
    validate_entry_target(&target)?;Ok(target)
}
/// Passive read from the existing sole Entry owner, with no new service or draft.
pub fn displayed_target(operating_context:&str)->Option<Value>{
    let context=crate::contest_window_context::active().ok()?;
    if context.operating_context!=operating_context{return None;}
    entry_target(&entry(&context).ok()?).ok()
}
fn envelope(snapshot:&Value,context:&crate::contest_window_context::ContestWindowContext,request:&crate::spot_activation::Request)->Result<Value,String>{
    let mut target=entry_target(snapshot)?;
    target["sourceEpoch"]=json!(request.source_epoch);target["spotID"]=json!(request.spot_id);target["spotVersion"]=json!(request.spot_version);
    Ok(json!({"operatingContext":context.operating_context,"scope":"contesting","sessionID":context.session_id,
        "workspaceGeneration":context.workspace_generation,"panelID":"active-qso","projectionRevision":snapshot["projectionRevision"],
        "requestID":request.operation_id,"action":"entry_cw_callsign","params":target}))
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
    let intent=intent(operation)?;
    if let Some(value)=&intent.terminal{return Ok(value.clone());}
    let snapshot=entry(&intent.context).ok();
    let receipt=snapshot.as_ref().and_then(|snapshot|snapshot["receipts"].as_array()).and_then(|rows|rows.iter().find(|value|value["requestID"]==operation));
    if let Some(receipt)=receipt {
        let value=outcome(operation,receipt)?;
        if value["reservationActive"]==false{return journal()?.lock().map_err(|_|"CW Entry journal unavailable.")?.finish(operation,value);}
        if receipt["status"]=="queued"{return Ok(value);}
    }
    let generation=crate::worker::generation();crate::worker::require_existing_generation(generation)?;
    let request=json!({"id":format!("cw-entry-receipt-{}",uuid::Uuid::new_v4()),"method":"contest_operation_receipt",
        "params":{"sessionID":intent.context.session_id,"operationID":operation,"includeOriginalRequest":true}});
    let response=crate::worker::request_existing_generation(request.clone(),generation)?;
    if response["id"]!=request["id"] || response["ok"]!=true || !response["error"].is_null() || crate::worker::generation()!=generation{
        return Err("Original CW Entry receipt is unavailable; no action was repeated.".into());
    }
    let value=durable_outcome(&intent,&response["result"])?;
    if value["reservationActive"]==true{return Ok(value);}
    if receipt.is_some(){
        // Resolve the taken original surface receipt without publishing any historical fields.
        crate::contest_surface::complete(&intent.context,operation,"applied",None,
            snapshot.as_ref().and_then(|value|value["projectionRevision"].as_u64()).ok_or("CW Entry revision is unavailable.")?)?;
    }
    journal()?.lock().map_err(|_|"CW Entry journal unavailable.")?.finish(operation,value)
}
fn durable_outcome(intent:&Intent,receipt:&Value)->Result<Value,String>{
    let operation=&intent.request.operation_id;
    if receipt["found"]==false && receipt["result"].is_null() && receipt["originalRequest"].is_null(){
        return Ok(json!({"operationId":operation,"phase":"uncertain","reservationActive":true,
            "error":"Original CW Entry operation has no durable receipt. Review Main Logging; no action was repeated."}));
    }
    let original=&receipt["originalRequest"];let params=&original["params"];let result=&receipt["result"];let projection=&result["projection"];
    let scope=&intent.draft_scope;
    let expected_revision=params["expectedRevision"].as_u64();let committed_revision=result["revision"].as_u64();
    let copy=projection["fields"].as_array().and_then(|fields|fields.iter().find(|field|field["id"]=="callsign")).and_then(|field|field["value"].as_str());
    if receipt["found"]!=true || original["method"]!="draft_apply" || params["operationID"]!=*operation
        || params["sessionID"]!=intent.context.session_id || params["draftID"]!=scope["draftID"] || params["fields"]["callsign"]!=intent.callsign
        || params.get("laneID")!=scope.get("laneID") || params.get("bindingVersion")!=scope.get("bindingVersion")
        || (scope.get("laneID").is_some() || params.get("workspaceGeneration").is_some()) && params["workspaceGeneration"]!=intent.context.workspace_generation
        || params.as_object().is_none_or(|object|object.keys().any(|key|!matches!(key.as_str(),"sessionID"|"operationID"|"expectedRevision"|"draftID"|"fields"|"laneID"|"bindingVersion"|"workspaceGeneration")))
        || result["operationID"]!=*operation || result["sessionID"]!=intent.context.session_id || result["replayed"]!=true
        || result["actions"].as_array().is_none_or(|actions|!actions.is_empty())
        || projection["sessionID"]!=intent.context.session_id || projection["workspaceGeneration"]!=intent.context.workspace_generation
        || projection["draftID"]!=scope["draftID"] || copy!=Some(intent.callsign.as_str()) || projection["revision"]!=result["revision"]
        || expected_revision.zip(committed_revision).is_none_or(|(before,after)|after!=before.checked_add(1).unwrap_or(u64::MAX)){
        return Err("Original CW Entry receipt does not match its retained callsign, draft and session; no action was repeated.".into());
    }
    Ok(json!({"operationId":operation,"phase":"confirmed","reservationActive":false}))
}
pub fn apply(app:&tauri::AppHandle,request:crate::spot_activation::Request,displayed:Value)->Result<Value,String>{
    let context=crate::contest_window_context::active()?;
    if let Ok(old)=intent(&request.operation_id){
        if old.context!=context || old.request!=request{return Err("CW Entry identity is bound to another request.".into());}
        return status(&request.operation_id);
    }
    let _output_admission=crate::carrier_tune::reserve_output()?;
    validate_entry_target(&displayed)?;
    if entry_target(&entry(&context)?)?!=displayed{return Err("Contest Entry target changed. Review the displayed lane and select again.".into());}
    let target=crate::cw_track_selection::resolve(&request)?;
    require_cw_idle()?;
    let snapshot=entry(&context)?;
    if entry_target(&snapshot)?!=displayed{return Err("Contest Entry draft or receiver binding changed during CW readback.".into());}
    let envelope=envelope(&snapshot,&context,&request)?;
    let mut rows=journal()?.lock().map_err(|_|"CW Entry intent unavailable.")?;
    crate::radio_follow::revoke_silently();crate::auto_rotor::revoke();
    let draft_scope=envelope["params"].clone();
    rows.insert(Intent{context:context.clone(),request:request.clone(),draft_scope,callsign:target["call"].as_str().ok_or("CW callsign is unavailable.")?.into(),terminal:None})?;drop(rows);
    let submitted=match (||{
        let fresh=crate::cw_track_selection::resolve(&request)?;require_cw_idle()?;
        if fresh["call"]!=target["call"]{return Err("CW callsign changed while retaining the original intent.".into());}
        if entry_target(&entry(&context)?)?!=displayed{return Err("Contest Entry changed before callsign submission.".into());}
        crate::contest_surface::submit("contest--active-qso",envelope,false)
    })(){
        Ok(value)=>value,
        Err(error)=>return journal()?.lock().map_err(|_|"CW Entry journal unavailable.")?.finish(&request.operation_id,json!({"operationId":request.operation_id,"phase":"failed","reservationActive":false,"error":error})),
    };
    let _=app.emit_to("contest-setup","xlog:contest-surface",());
    outcome(&request.operation_id,&submitted)
}
pub fn apply_outcome(app:&tauri::AppHandle,request:crate::spot_activation::Request,displayed:Value)->Result<Value,String>{
    let operation=request.operation_id.clone();
    match apply(app,request,displayed){
        Ok(value)=>Ok(value),
        Err(error) if !owns(&operation)=>Ok(json!({"operationId":operation,"phase":"failed","reservationActive":false,"error":error})),
        Err(error)=>Err(error),
    }
}
pub fn resolve_for_owner(operation:&str)->Result<Value,String>{
    let _output_admission=crate::carrier_tune::reserve_output()?;
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
    if envelope(&after,&intent.context,&intent.request)?["params"]!=expected["params"] || target["call"]!=intent.callsign {return Err("Contest Entry or CW identity changed during readback.".into());}
    let mut value=json!({"operationId":operation,"callsign":target["call"],"draftID":expected["params"]["draftID"],
        "expectedDraftRevision":expected["params"]["expectedDraftRevision"],"operatingContext":intent.context.operating_context,
        "sessionID":intent.context.session_id,"workspaceGeneration":intent.context.workspace_generation});
    for key in ["laneID","bindingVersion"]{if let Some(field)=expected["params"].get(key){value[key]=field.clone();}}
    Ok(value)
}
use tauri::Emitter;

#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->(Value,crate::contest_window_context::ContestWindowContext,crate::spot_activation::Request){
        (json!({"projectionRevision":8,"projection":{"status":"ready","busy":false,"dirty":false,"uncertain":false,
            "operator":{"armed":false,"status":"disarmed"},"draft":{"draftID":"draft","revision":4,"callsign":""}}}),
         crate::contest_window_context::ContestWindowContext{operating_context:uuid::Uuid::new_v4().to_string(),session_id:uuid::Uuid::new_v4().to_string(),workspace_generation:uuid::Uuid::new_v4().to_string()},
         crate::spot_activation::Request{operation_id:uuid::Uuid::new_v4().to_string(),source_epoch:uuid::Uuid::new_v4().to_string(),spot_id:uuid::Uuid::new_v4().to_string(),spot_version:uuid::Uuid::new_v4().to_string()})
    }
    fn retained()->Intent{
        let (mut snapshot,context,request)=fixture();snapshot["projection"]["draft"]["draftID"]=json!(uuid::Uuid::new_v4().to_string());
        let draft_scope=envelope(&snapshot,&context,&request).unwrap()["params"].clone();
        Intent{context,request,draft_scope,callsign:"K1ABC/P".into(),terminal:None}
    }
    fn original_receipt(intent:&Intent)->Value{
        json!({"found":true,"originalRequest":{"method":"draft_apply","params":{"sessionID":intent.context.session_id,
            "operationID":intent.request.operation_id,"draftID":intent.draft_scope["draftID"],"expectedRevision":9,"fields":{"callsign":intent.callsign,"sent":"579"}}},
            "result":{"operationID":intent.request.operation_id,"sessionID":intent.context.session_id,"revision":10,"replayed":true,"actions":[],
                "projection":{"sessionID":intent.context.session_id,"workspaceGeneration":intent.context.workspace_generation,
                    "draftID":intent.draft_scope["draftID"],"revision":10,"fields":[{"id":"callsign","value":intent.callsign}]}}})
    }
    #[test]
    fn cw_entry_scope_retains_the_exact_displayed_lane_and_receiver_binding(){
        let (mut snapshot,context,request)=fixture();
        snapshot["projection"]["session"]=json!({"laneContext":{"mode":"SO2R","laneID":"laneB","bindingVersion":7}});
        let value=envelope(&snapshot,&context,&request).unwrap();
        assert_eq!(value["params"]["laneID"],"laneB");assert_eq!(value["params"]["bindingVersion"],7);
        let mut missing=snapshot.clone();missing["projection"]["session"]["laneContext"].as_object_mut().unwrap().remove("bindingVersion");
        assert!(entry_target(&missing).is_err());
    }
    #[test]
    fn original_cw_receipt_cannot_substitute_a_lane_or_receiver_binding(){
        let mut intent=retained();intent.draft_scope["laneID"]=json!("laneB");intent.draft_scope["bindingVersion"]=json!(7);
        let mut receipt=original_receipt(&intent);receipt["originalRequest"]["params"]["laneID"]=json!("laneB");
        receipt["originalRequest"]["params"]["bindingVersion"]=json!(7);
        receipt["originalRequest"]["params"]["workspaceGeneration"]=json!(intent.context.workspace_generation);
        assert!(durable_outcome(&intent,&receipt).is_ok());
        receipt["originalRequest"]["params"]["laneID"]=json!("laneA");assert!(durable_outcome(&intent,&receipt).is_err());
        receipt["originalRequest"]["params"]["laneID"]=json!("laneB");receipt["originalRequest"]["params"]["bindingVersion"]=json!(8);
        assert!(durable_outcome(&intent,&receipt).is_err());
        receipt["originalRequest"]["params"]["bindingVersion"]=json!(7);
        receipt["originalRequest"]["params"]["workspaceGeneration"]=json!(uuid::Uuid::new_v4().to_string());
        assert!(durable_outcome(&intent,&receipt).is_err());
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("intent.json");
        let mut journal=Journal::load(path.clone()).unwrap();journal.insert(intent.clone()).unwrap();drop(journal);
        assert_eq!(Journal::load(path).unwrap().saved.rows[&intent.request.operation_id].draft_scope,intent.draft_scope);
    }
    #[test]
    fn durable_intent_survives_restart_and_blocks_new_actions_until_original_is_resolved(){
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("intents.json");
        let mut first=Journal::load(path.clone()).unwrap();let intent=retained();
        assert!(!first.pending());first.insert(intent.clone()).unwrap();assert!(first.pending());drop(first);
        let mut restarted=Journal::load(path.clone()).unwrap();
        assert_eq!(restarted.saved.rows[&intent.request.operation_id].callsign,"K1ABC/P");
        assert!(restarted.insert(retained()).is_err());
        let outcome=durable_outcome(&intent,&original_receipt(&intent)).unwrap();
        assert_eq!(outcome,json!({"operationId":intent.request.operation_id,"phase":"confirmed","reservationActive":false}));
        restarted.finish(&intent.request.operation_id,outcome.clone()).unwrap();assert!(!restarted.pending());drop(restarted);
        let mut reopened=Journal::load(path).unwrap();assert_eq!(reopened.saved.rows[&intent.request.operation_id].terminal,Some(outcome));
        reopened.insert(retained()).unwrap();
    }
    #[test]
    fn original_receipt_never_substitutes_other_actions_or_returns_historical_fields(){
        let intent=retained();let receipt=original_receipt(&intent);
        assert!(durable_outcome(&intent,&receipt).unwrap().get("projection").is_none());
        for (path,value) in [("/originalRequest/method",json!("qso_commit")),("/originalRequest/params/operationID",json!(uuid::Uuid::new_v4().to_string())),
            ("/originalRequest/params/draftID",json!(uuid::Uuid::new_v4().to_string())),("/originalRequest/params/fields/callsign",json!("DL1ABC")),
            ("/result/projection/workspaceGeneration",json!(uuid::Uuid::new_v4().to_string())),("/result/projection/draftID",json!(uuid::Uuid::new_v4().to_string())),
            ("/result/projection/fields/0/value",json!("DL1ABC")),("/result/actions",json!([{"type":"tune"}])),("/result/revision",json!(11))]{
            let mut wrong=receipt.clone();*wrong.pointer_mut(path).unwrap()=value;assert!(durable_outcome(&intent,&wrong).is_err(),"{path}");
        }
        let mut rf=receipt.clone();rf["originalRequest"]["params"]["frequencyHz"]=json!(14025000);assert!(durable_outcome(&intent,&rf).is_err());
        let missing=durable_outcome(&intent,&json!({"found":false,"result":null,"originalRequest":null})).unwrap();
        assert_eq!(missing["phase"],"uncertain");assert_eq!(missing["reservationActive"],true);
        assert!(durable_outcome(&intent,&json!({})).is_err());
    }
    #[test]
    fn unreadable_journal_is_preserved_and_storage_failure_never_admits_a_second_operation(){
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("intents.json");
        std::fs::write(&path,b"unfinished journal").unwrap();assert!(Journal::load(path.clone()).is_err());
        assert_eq!(std::fs::read(&path).unwrap(),b"unfinished journal");
        let mut missing_parent=Journal::load(directory.path().join("blocked/intent.json")).unwrap();
        std::fs::write(directory.path().join("blocked"),b"preserve").unwrap();
        let intent=retained();assert!(missing_parent.insert(intent.clone()).is_err());
        assert!(missing_parent.saved.rows.contains_key(&intent.request.operation_id));assert!(missing_parent.insert(retained()).is_err());
        #[cfg(unix)]{
            let target=directory.path().join("target.json");std::fs::write(&target,b"{}").unwrap();
            let link=directory.path().join("link.json");std::os::unix::fs::symlink(&target,&link).unwrap();
            assert!(Journal::load(link).is_err());assert_eq!(std::fs::read(target).unwrap(),b"{}");
        }
    }
    #[test]
    fn journal_validates_identity_and_retains_native_uppercase_track_ids(){
        let mut intent=retained();intent.request.spot_id=intent.request.spot_id.to_uppercase();intent.draft_scope["spotID"]=json!(intent.request.spot_id);
        assert!(validate_intent(&intent.request.operation_id,&intent).is_ok());
        intent.terminal=Some(json!({"operationId":intent.request.operation_id,"phase":"confirmed","reservationActive":false,"projection":{}}));
        assert!(validate_intent(&intent.request.operation_id,&intent).is_err());
        intent.terminal=None;intent.request.source_epoch=uuid::Uuid::nil().to_string();
        assert!(validate_intent(&intent.request.operation_id,&intent).is_err());
    }
    #[test]
    fn cw_entry_envelope_is_revision_fenced_identity_only_and_refuses_dirty_or_armed_entry(){
        let (snapshot,context,request)=fixture();let value=envelope(&snapshot,&context,&request).unwrap();
        assert_eq!(value["action"],"entry_cw_callsign");assert_eq!(value["params"]["expectedDraftRevision"],4);
        assert_eq!(value["params"].as_object().unwrap().len(),5);assert!(value["params"].get("callsign").is_none());assert!(value["params"].get("frequencyHz").is_none());
        for path in ["/projection/busy","/projection/dirty","/projection/uncertain","/projection/operator/armed"]{
            let mut denied=snapshot.clone();*denied.pointer_mut(path).unwrap()=json!(true);assert!(envelope(&denied,&context,&request).is_err());
        }
        for call in [json!("K1HOLD"),json!(null)]{let mut denied=snapshot.clone();denied["projection"]["draft"]["callsign"]=call;assert!(entry_target(&denied).is_err());}
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
