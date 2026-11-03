//! Read-only retained spot suggestions and callsign-only canonical draft admission.
//! No station command, subscription or CAT poll is available in this owner.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{sync::{Arc,Mutex,OnceLock},time::{Duration,SystemTime,UNIX_EPOCH}};
use tauri::Emitter;
use crate::{radio_follow::{Observation,Selection},radio_read::{Backend,Canonical,NativeBackend},spot_editor_barrier::EditorBarrier};
use crate::radio_slots::ActiveRadio;

#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Candidate {
    radio:ActiveRadio,
    worker_generation:Option<u64>,
    observation:Observation, source_epoch:String, spot_id:String, spot_version:String,
    callsign:String, frequency_hz:u64, offset_hz:i64, age_seconds:u64,
    generation:String, draft_id:String, draft_revision:u64,
}
fn same_uuid(value:&Value,expected:&str)->bool{
    value.as_str().and_then(|value|uuid::Uuid::parse_str(value).ok()).zip(uuid::Uuid::parse_str(expected).ok()).is_some_and(|(left,right)|left==right)
}
fn receipt_matches(receipt:&Value,operation:&str,generation:&str,draft:&str,revision:u64,callsign:&str)->bool{
    same_uuid(&receipt["mutation"]["operationID"],operation) && same_uuid(&receipt["mutation"]["draftID"],draft) &&
    receipt["mutation"]["expectedRevision"].as_u64()==Some(revision) && receipt["mutation"]["action"]=="replace" &&
    same_uuid(&receipt["draft"]["generation"],generation) && same_uuid(&receipt["draft"]["qso"]["id"],draft) &&
    receipt["draft"]["revision"].as_u64()==revision.checked_add(1) && receipt["draft"]["qso"]["call"]==callsign
}
fn now()->u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn group(mode:&str)->Option<&'static str> { match mode.to_ascii_uppercase().as_str() {
    "CW"|"CWR"=>Some("cw"), "SSB"|"USB"|"LSB"|"AM"|"FM"|"PHONE"=>Some("phone"),_=>None
}}
fn age(value:&Value,now:u64)->Option<u64> {
    // Swift Date Codable is seconds since 2001. Retained reports never use display text as a clock.
    let at=value["receivedAt"].as_f64()?;
    let ms=((at+978_307_200.0)*1000.0).round();
    (ms.is_finite() && ms>=0.0 && ms<=now as f64+1000.0).then_some(now.saturating_sub(ms as u64)/1000)
}
fn band(hz:u64)->Option<usize>{
    [(1_800_000,2_000_000),(3_500_000,4_000_000),(5_000_000,5_500_000),(7_000_000,7_300_000),
      (10_100_000,10_150_000),(14_000_000,14_350_000),(18_068_000,18_168_000),(21_000_000,21_450_000),
      (24_890_000,24_990_000),(28_000_000,29_700_000),(50_000_000,54_000_000),(144_000_000,148_000_000),(420_000_000,450_000_000)]
      .iter().position(|(low,high)|(*low..=*high).contains(&hz))
}
fn half_width(mode:&str,projection:&Value)->u64{
    let fallback=if group(mode)==Some("cw"){250}else{1500};
    // Hamlib Passband is returned by the same fresh mode observation already
    // admitted by radio_follow; arbitrary UI filter widths are never authority.
    let raw=&projection["snapshot"]["fields"]["mode"]["Passband"];
    let bandwidth=raw.as_u64().or_else(||raw.as_str()?.parse().ok());
    if projection["provider"]!="hamlib"{return fallback;}
    bandwidth.filter(|n|(50..=12_000).contains(n)).map(|n|(n/2).clamp(25,if group(mode)==Some("cw"){1000}else{3000})).unwrap_or(fallback)
}
fn ranked(spots:&[Value],observed:&Observation,now:u64,half:u64)->Vec<(Value,u64,i64,u64)> {
    let Some(mode)=group(&observed.mode) else{return vec![]};
    let rx=observed.receive_frequency.unwrap_or(observed.frequency);
    if band(rx).is_none(){return vec![]}
    let mut items:Vec<_>=spots.iter().take(500).filter_map(|spot|{
        if group(spot["mode"].as_str()?)!=Some(mode){return None;}
        let khz=spot["frequencyKHz"].as_f64()?;
        if !khz.is_finite() || khz<=0.0 || khz>1_000_000_000.0{return None;}
        let hz=(khz*1000.0).round() as u64;
        let offset=hz as i64-rx as i64;
        let age=age(spot,now)?;
        if band(hz)!=band(rx) || offset.unsigned_abs()>half || age>600{return None;}
        let call=spot["callsign"].as_str()?;
        if !(3..=32).contains(&call.len()) || !call.bytes().all(|b|b.is_ascii_uppercase()||b.is_ascii_digit()||b==b'/'||b==b'-'){return None;}
        Some((spot.clone(),hz,offset,age))
    }).collect();
    items.sort_by(|a,b|a.2.unsigned_abs().cmp(&b.2.unsigned_abs()).then(a.3.cmp(&b.3)).then(a.0["id"].as_str().cmp(&b.0["id"].as_str())));
    let mut seen:Vec<(String,u64)>=Vec::new();
    let repeated_window=if mode=="cw"{50}else{250};
    items.retain(|item|{
        let call=item.0["callsign"].as_str().unwrap_or("");
        if seen.iter().any(|(prior,hz)|prior==call && hz.abs_diff(item.1)<=repeated_window){return false;}
        seen.push((call.to_owned(),item.1));true
    });
    items.truncate(3);items
}
struct Receiver { radio:ActiveRadio, observation:Observation, half_width:u64, worker_generation:Option<u64> }
fn receiver_from(
    route:impl Fn()->Result<ActiveRadio,String>,
    selection:impl FnOnce(&str)->Result<Value,String>,
    telemetry:impl FnOnce(&str)->Result<Value,String>,current_worker:u64,at:u64,
)->Result<Receiver,String>{
    let radio=route()?;
    let selection=selection(&radio.radio_id)?;
    let projection=telemetry(&radio.radio_id)?;
    if selection["radio_id"]!=radio.radio_id || projection["radio_id"]!=radio.radio_id ||
        (projection["provider"]!="hamlib" && projection["snapshot"]["radio_id"]!=radio.radio_id){
        return Err("Retained receiver evidence does not match the operating radio slot.".into());
    }
    let observed=crate::radio_follow::observation(&projection,&selection,at)?;
    if observed.connection.is_none(){return Err("The selected receiver connection generation is unavailable.".into());}
    let worker_generation=if projection["provider"]=="hamlib"{None}else{
        Some(projection["worker_generation"].as_u64().filter(|generation|*generation!=0 && *generation==current_worker)
            .ok_or("Retained receiver telemetry belongs to an earlier worker. Wait for a fresh observation.")?)
    };
    let half_width=half_width(&observed.mode,&projection);
    if route()?!=radio{return Err("The operating radio changed. Review a fresh suggestion.".into());}
    Ok(Receiver{radio,observation:observed,half_width,worker_generation})
}
fn observed()->Result<Receiver,String>{
    let receiver=receiver_from(crate::radio_slots::retained_active,crate::station_selection::retained_snapshot_for,|radio_id|{
        crate::station_telemetry::retained_snapshots().into_iter().find(|value|value["radio_id"]==radio_id)
            .ok_or("Retained telemetry for the operating radio is unavailable.".into())
    },crate::worker::generation(),now())?;
    if receiver.worker_generation.is_some_and(|generation|generation!=crate::worker::generation()){
        return Err("The radio worker changed. Wait for a fresh receiver observation.".into());
    }
    Ok(receiver)
}
fn same_receiver(before:&Observation,current:&Observation)->bool{
    current.selection==before.selection && current.connection==before.connection && current.revision>=before.revision
        && current.frequency==before.frequency && current.receive_frequency==before.receive_frequency && current.mode==before.mode
}
fn candidate_in_inventory(candidate:&Candidate,spots:&[Value],current:&Observation,now:u64,half:u64)->bool{
    ranked(spots,current,now,half).into_iter().any(|(spot,hz,_,_)|
        spot["id"]==candidate.spot_id && spot["activation"]["sourceEpoch"]==candidate.source_epoch &&
        spot["activation"]["spotVersion"]==candidate.spot_version && spot["callsign"]==candidate.callsign && hz==candidate.frequency_hz)
}
fn candidates_from(spots:&[Value],receiver:&Receiver,canonical:&Canonical,at:u64)->Vec<Candidate>{
    if receiver.worker_generation.is_some_and(|generation|generation!=canonical.worker){return vec![];}
    ranked(spots,&receiver.observation,at,receiver.half_width).into_iter().filter_map(|(spot,hz,offset,age)|Some(Candidate{
        radio:receiver.radio.clone(),worker_generation:receiver.worker_generation,observation:receiver.observation.clone(),source_epoch:spot["activation"]["sourceEpoch"].as_str()?.into(),
        spot_id:spot["id"].as_str()?.into(),spot_version:spot["activation"]["spotVersion"].as_str()?.into(),
        callsign:spot["callsign"].as_str()?.into(),frequency_hz:hz,offset_hz:offset,age_seconds:age,
        generation:canonical.generation.clone(),draft_id:canonical.draft.clone(),draft_revision:canonical.revision
    })).collect()
}
pub fn snapshot(app:&tauri::AppHandle)->Result<Value,String>{
    let worker=crate::worker::generation();
    let settings=NativeBackend::call(worker,"settings_load",json!({}))?;
    if settings["settings"]["nearbySpottedCallsigns"]!=true{return Ok(json!({"enabled":false,"candidates":[]}));}
    let receiver=match observed(){Ok(value)=>value,Err(error)=>return Ok(json!({"enabled":true,"candidates":[],"reason":error}))};
    let projection=crate::cluster_session::owner(app)?.projection_value()?;
    if projection["available"]!=true || projection["received_at_ms"].as_u64().is_none_or(|at|now().saturating_sub(at)>5000){
        return Ok(json!({"enabled":true,"candidates":[],"reason":"Fresh retained cluster reports are unavailable."}));
    }
    let canonical=NativeBackend{app:app.clone()}.canonical()?;
    if crate::radio_slots::retained_active()?!=receiver.radio{return Ok(json!({"enabled":true,"candidates":[],"reason":"The operating radio changed. Review a fresh suggestion."}));}
    let candidates=candidates_from(projection["response"]["snapshot"]["spots"].as_array().map(Vec::as_slice).unwrap_or(&[]),&receiver,&canonical,now());
    Ok(json!({"enabled":true,"candidates":candidates}))
}
#[derive(Default)]
struct PendingRoute(Option<crate::radio_slots::ActiveRadioFence>);
impl PendingRoute{
    fn reconcile(&mut self,response:&Value,operation:&str,pending:&Value,finish:impl FnOnce()->Result<(),String>)->Result<bool,String>{
        let receipt=&response["receipt"];
        let applied=pending["generation"].as_str().zip(pending["draft"].as_str()).zip(pending["revision"].as_u64()).zip(pending["callsign"].as_str())
            .is_some_and(|(((generation,draft),revision),callsign)|receipt_matches(receipt,operation,generation,draft,revision,callsign));
        if !applied && response.get("receipt")!=Some(&Value::Null) && response["status"]!="workspace_changed" {
            return Err("Nearby receipt cannot yet be verified.".into());
        }
        finish()?;
        self.0.take();
        Ok(applied)
    }
    fn retire_terminal(&mut self,reservation_active:bool){if !reservation_active{self.0.take();}}
}
struct Owner{app:tauri::AppHandle,editors:Arc<EditorBarrier>,active:Mutex<()>,latest:Mutex<Value>,pending_route:Mutex<PendingRoute>}
static OWNER:OnceLock<Arc<Owner>>=OnceLock::new();
pub fn install(app:&tauri::AppHandle,editors:Arc<EditorBarrier>){let _=OWNER.set(Arc::new(Owner{app:app.clone(),editors,active:Mutex::new(()),latest:Mutex::new(json!({"operationId":null,"phase":"idle","barrier":null})),pending_route:Mutex::new(PendingRoute::default())}));}
pub fn status()->Option<Value>{OWNER.get()?.latest.lock().ok().map(|v|v.clone())}
pub fn owns(operation:&str)->bool{status().is_some_and(|v|v["operationId"]==operation)}
pub fn active()->bool{status().is_some_and(|v|v["reservationActive"]==true)}
pub fn retire(){if let Some(owner)=OWNER.get(){if let Ok(mut value)=owner.latest.lock(){if value["reservationActive"]!=true{
    if let Ok(mut pending)=owner.pending_route.lock(){pending.retire_terminal(false);}
    *value=json!({"operationId":null,"phase":"idle","barrier":null});
}}}}
impl Owner{
    fn store(&self,value:Value)->Value{
        if let Ok(mut latest)=self.latest.lock(){*latest=value.clone();}
        let _=self.app.emit("xlog:spot-activation",());let _=self.app.emit("xlog:operator-draft-changed",());value
    }
    fn execute(&self,operation:&str,candidate:Candidate)->Result<Value,String>{
        if self.latest.lock().map_err(|_|"Nearby state unavailable")?["reservationActive"]==true{return Err("Check the retained nearby callsign operation before another action.".into());}
        let _active=self.active.try_lock().map_err(|_|"A nearby callsign operation is already active.")?;
        if owns(operation){return status().ok_or("Nearby status unavailable".into());}
        uuid::Uuid::parse_str(operation).map_err(|_|"Invalid nearby operation identity")?;
        let mut unresolved=false;
        let mut route_fence=None;
        let result=(||->Result<(),String>{
            let backend=NativeBackend{app:self.app.clone()};
            let canonical=backend.canonical()?;
            if canonical.generation!=candidate.generation || canonical.draft!=candidate.draft_id || canonical.revision!=candidate.draft_revision{
                return Err("The draft changed. Review the current suggestion after finishing your input.".into());
            }
            let labels=backend.open_editors()?;
            self.editors.begin(operation,&canonical.generation,&canonical.draft,canonical.revision,&labels)?;
            self.store(json!({"operationId":operation,"phase":"preparing","barrier":self.editors.snapshot()?,"admitted":false,"reservationActive":true,"draftOnly":true,"intent":"nearby-callsign"}));
            self.editors.wait_ready(operation,Duration::from_secs(3))?;
            route_fence=Some(crate::radio_slots::fence_retained_active(&candidate.radio)?);
            let selection=crate::station_selection::retained_snapshot_for(&candidate.radio.radio_id)?;
            if Selection::parse(&selection)?!=candidate.observation.selection{return Err("Selected radio changed. Review a fresh suggestion.".into());}
            let _fence=crate::station_selection::owner_for(&self.app,&candidate.radio.radio_id)?.fence_radio_read_epoch(&selection)?;
            let current=observed()?;
            if candidate.radio!=current.radio || candidate.worker_generation!=current.worker_generation ||
                current.worker_generation.is_some_and(|generation|generation!=canonical.worker) || !same_receiver(&candidate.observation,&current.observation){
                return Err("The receiver changed. Review a fresh suggestion.".into());
            }
            let cluster=crate::cluster_session::owner(&self.app)?;
            cluster.activation_spot(&candidate.source_epoch,&candidate.spot_id,&candidate.spot_version)?;
            let projection=cluster.projection_value()?;
            let found=candidate_in_inventory(&candidate,projection["response"]["snapshot"]["spots"].as_array().map(Vec::as_slice).unwrap_or(&[]),&current.observation,now(),current.half_width);
            if !found{return Err("The selected spot expired or changed. Review a current suggestion.".into());}
            let params=json!({"operationID":operation,"draftID":canonical.draft,"expectedRevision":canonical.revision,"generation":canonical.generation,"callsign":candidate.callsign});
            let response=match NativeBackend::call(canonical.worker,"logbook_operator_draft_nearby_call",params) {
                Ok(response)=>response,
                Err(original)=>match NativeBackend::call(canonical.worker,"logbook_operator_draft_receipt",json!({"operationID":operation,"generation":canonical.generation})) {
                    Ok(response) if response["receipt"].is_object()=>json!({"status":"applied","receipt":response["receipt"]}),
                    Ok(_)=>return Err(original),
                    Err(_)=>{unresolved=true;return Err("Nearby acknowledgement is unresolved. Check the retained operation; no callsign action will be replayed.".into());}
                }
            };
            if response["status"]!="applied" || !receipt_matches(&response["receipt"],operation,&canonical.generation,&canonical.draft,canonical.revision,&candidate.callsign){
                return Err("The nearby callsign was not applied to the expected draft. Your current draft is retained.".into());
            }
            Ok(())
        })();
        if unresolved {
            self.pending_route.lock().map_err(|_|"Nearby route reconciliation is unavailable")?.0=route_fence.take();
        } else {let _=self.editors.finish(operation);}
        let mut terminal=json!({"operationId":operation,"phase":if result.is_ok(){"confirmed"}else if unresolved{"uncertain"}else{"blocked"},"barrier":null,"admitted":result.is_ok(),"reservationActive":unresolved,"draftOnly":true,"intent":"nearby-callsign","tuneConfirmed":false,"rotor":"not-requested"});
        if unresolved {terminal["pending"]=json!({"generation":candidate.generation,"draft":candidate.draft_id,"revision":candidate.draft_revision,"callsign":candidate.callsign});}
        if let Err(error)=result {terminal["error"]=json!(error);}
        Ok(self.store(terminal))
    }
}
pub fn reconcile(operation:&str)->Result<Value,String>{
    let owner=OWNER.get().ok_or("Nearby owner unavailable")?;
    let _active=owner.active.try_lock().map_err(|_|"Nearby operation is still active")?;
    let mut latest=owner.latest.lock().map_err(|_|"Nearby status unavailable")?.clone();
    if latest["operationId"]!=operation {return Err("Nearby operation is no longer retained".into());}
    if latest["reservationActive"]!=true{return Ok(latest);}
    let pending=&latest["pending"];
    if !pending.is_object(){return Err("Wait for nearby admission to settle.".into());}
    let response=NativeBackend::call(crate::worker::generation(),"logbook_operator_draft_receipt",json!({"operationID":operation,"generation":pending["generation"]}))?;
    let applied=owner.pending_route.lock().map_err(|_|"Nearby route reconciliation is unavailable")?
        .reconcile(&response,operation,pending,||owner.editors.finish(operation))?;
    latest["phase"]=json!(if applied{"confirmed"}else{"blocked"});
    latest["reservationActive"]=json!(false);latest["admitted"]=json!(applied);
    latest.as_object_mut().unwrap().remove("pending");
    latest["error"]=json!(if applied{"Callsign entry confirmed; no station command was sent."}else{"No durable nearby callsign entry exists in the original workspace. No action was replayed."});
    Ok(owner.store(latest))
}
pub fn accept(operation:&str,candidate:Candidate)->Result<Value,String>{OWNER.get().ok_or("Nearby callsigns unavailable")?.execute(operation,candidate)}

#[cfg(test)]mod tests{
    use super::*;
    const AT:u64=1_800_000_000_000;
    fn raw_receiver(slot:&str,rx:u64,tx:Option<u64>,passband:u64)->(Value,Value){
        let selection=json!({"radio_id":slot,"provider":"hamlib","selection_id":uuid::Uuid::new_v4().to_string(),"generation":3,"control_revision":0});
        let projection=json!({"radio_id":slot,"provider":"hamlib","selection_id":selection["selection_id"],"selection_generation":3,
            "available":true,"revision":8,"received_at_ms":AT,"snapshot":{"device":"radio","generation":7,
            "observed_at_ms":AT,"field_observed_at_ms":{"frequency":AT,"mode":AT,"split":AT,"tx_frequency":AT},
            "fields":{"frequency":{"Frequency":rx.to_string()},"mode":{"Mode":"CW","Passband":passband.to_string()},
                "split":{"Split":if tx.is_some(){"1"}else{"0"}},"tx_frequency":{"TX Frequency":tx.unwrap_or(rx).to_string()}}}});
        (selection,projection)
    }
    fn raw_spot(call:&str,hz:u64)->Value{
        json!({"id":call,"callsign":call,"frequencyKHz":hz as f64/1000.0,"mode":"CW","receivedAt":AT as f64/1000.0-978307200.0,
            "activation":{"sourceEpoch":"retained-cluster","spotVersion":"one"}})
    }
    fn canonical_fixture()->Canonical{
        Canonical{worker:1,generation:uuid::Uuid::new_v4().to_string(),draft:uuid::Uuid::new_v4().to_string(),revision:2}
    }
    fn from_slots(route:&crate::radio_slots::TestRouting,slots:&[(Value,Value);2])->Result<Receiver,String>{
        receiver_from(||route.snapshot(),|slot|Ok(slots[crate::radio_slots::index(slot)?].0.clone()),
            |slot|Ok(slots[crate::radio_slots::index(slot)?].1.clone()),1,AT)
    }
    #[test]fn selected_slot_drives_real_route_candidate_rx_and_passband_without_polling(){
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("radio-routing.json");
        let route=crate::radio_slots::TestRouting::new(path.clone());
        let slots=[raw_receiver("radio1",14_025_000,None,200),raw_receiver("radio2",7_025_000,None,1600)];
        let spots=[raw_spot("K1RX",14_025_050),raw_spot("K2RX",7_025_600),raw_spot("K2FAR",7_025_801)];
        let canonical=canonical_fixture();
        let r1=from_slots(&route,&slots).unwrap();let c1=candidates_from(&spots,&r1,&canonical,AT);
        assert_eq!(c1.len(),1);assert_eq!(c1[0].callsign,"K1RX");assert_eq!(r1.half_width,100);
        route.select("radio2").unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&std::fs::read(path).unwrap()).unwrap()["active_radio"],"radio2");
        let reads=Mutex::new(Vec::new());
        let r2=receiver_from(||route.snapshot(),|slot|{reads.lock().unwrap().push(format!("selection:{slot}"));Ok(slots[crate::radio_slots::index(slot)?].0.clone())},
            |slot|{reads.lock().unwrap().push(format!("retained:{slot}"));Ok(slots[crate::radio_slots::index(slot)?].1.clone())},1,AT).unwrap();
        let c2=candidates_from(&spots,&r2,&canonical,AT);
        assert_eq!(reads.into_inner().unwrap(),["selection:radio2","retained:radio2"]);
        assert_eq!(r2.observation.frequency,7_025_000);assert_eq!(r2.half_width,800);
        assert_eq!(c2.len(),1);assert_eq!(c2[0].callsign,"K2RX");assert_eq!(c2[0].offset_hz,600);
        assert_eq!(c2[0].radio.radio_id,"radio2");assert!(c2[0].radio.generation>c1[0].radio.generation);
    }
    #[test]fn radio2_only_connection_and_split_use_radio2_rx_not_radio1_or_its_tx(){
        let temp=tempfile::tempdir().unwrap();let route=crate::radio_slots::TestRouting::new(temp.path().join("route.json"));
        let mut slots=[raw_receiver("radio1",14_025_000,None,200),raw_receiver("radio2",7_025_000,Some(14_030_000),1600)];
        slots[0].1["available"]=json!(false);
        assert!(from_slots(&route,&slots).is_err());
        route.select("radio2").unwrap();
        let selected=from_slots(&route,&slots).unwrap();
        let candidates=candidates_from(&[raw_spot("K1OTHER",14_025_000),raw_spot("K2TX",14_030_000),raw_spot("K2RX",7_025_500)],&selected,&canonical_fixture(),AT);
        assert_eq!(selected.observation.frequency,14_030_000);assert_eq!(selected.observation.receive_frequency,Some(7_025_000));
        assert_eq!(candidates.len(),1);assert_eq!(candidates[0].callsign,"K2RX");assert_eq!(candidates[0].offset_hz,500);
    }
    #[test]fn actual_slot_switch_after_display_and_aba_invalidate_candidate_before_entry(){
        let temp=tempfile::tempdir().unwrap();let route=crate::radio_slots::TestRouting::new(temp.path().join("route.json"));
        let slots=[raw_receiver("radio1",14_025_000,None,200),raw_receiver("radio2",7_025_000,None,1600)];
        route.select("radio2").unwrap();
        let displayed=from_slots(&route,&slots).unwrap();
        let candidate=candidates_from(&[raw_spot("K2RX",7_025_100)],&displayed,&canonical_fixture(),AT).remove(0);
        let reservation=route.fence(&candidate.radio).unwrap();
        assert_eq!(route.snapshot().unwrap(),candidate.radio,"No routing mutex is held while draft IPC runs");
        assert!(route.select("radio1").is_err());route.select("radio2").unwrap();
        drop(reservation);route.select("radio1").unwrap();
        assert!(route.fence(&candidate.radio).is_err(),"A displayed Radio2 suggestion cannot enter against Radio1");
        route.select("radio2").unwrap();let returned=from_slots(&route,&slots).unwrap();
        assert!(same_receiver(&candidate.observation,&returned.observation),"The retained Radio2 data is intentionally identical");
        assert_ne!(candidate.radio.generation,returned.radio.generation);
        assert!(route.fence(&candidate.radio).is_err(),"R2→R1→R2 must not revive a displayed candidate");
        assert!(route.fence(&returned.radio).is_ok());
    }
    #[test]fn receiver_read_rejects_route_change_during_projection_and_cross_slot_worker_data(){
        let temp=tempfile::tempdir().unwrap();let route=crate::radio_slots::TestRouting::new(temp.path().join("route.json"));
        let slots=[raw_receiver("radio1",14_025_000,None,200),raw_receiver("radio2",7_025_000,None,1600)];
        assert!(receiver_from(||route.snapshot(),|slot|Ok(slots[crate::radio_slots::index(slot)?].0.clone()),|slot|{
            let data=slots[crate::radio_slots::index(slot)?].1.clone();route.select("radio2").unwrap();Ok(data)
        },1,AT).is_err());
        let mut selection=slots[1].0.clone();selection["provider"]=json!("direct_agent");
        let mut direct=json!({"radio_id":"radio2","provider":"direct_agent","selection_id":selection["selection_id"],"selection_generation":3,
            "available":true,"revision":9,"received_at_ms":AT,"worker_generation":1,"snapshot":{"radio_id":"radio1","source":"direct_agent","generation":7,
            "generated_at":AT as f64/1000.0,"radio":{"connected":true,"observed":true,"transmitting":false,"split":false,
                "frequency_hz":7_025_000,"mode":"CW","observed_at":AT as f64/1000.0}}});
        assert!(receiver_from(||route.snapshot(),|_|Ok(selection.clone()),|_|Ok(direct.clone()),1,AT).is_err());
        direct["snapshot"]["radio_id"]=json!("radio2");
        assert!(receiver_from(||route.snapshot(),|_|Ok(selection.clone()),|_|Ok(direct.clone()),2,AT).is_err(),"A retired worker's fresh-looking RX projection cannot be reused");
        let valid=receiver_from(||route.snapshot(),|_|Ok(selection.clone()),|_|Ok(direct.clone()),1,AT).unwrap();
        assert_eq!(valid.observation.frequency,7_025_000);
        let mut replacement=canonical_fixture();replacement.worker=2;
        assert!(candidates_from(&[raw_spot("K2RX",7_025_000)],&valid,&replacement,AT).is_empty());
        direct["worker_generation"]=json!(2);
        assert!(receiver_from(||route.snapshot(),|_|Ok(selection),|_|Ok(direct),2,AT).is_ok());
    }
    #[test]fn selected_slot_reconnect_and_provider_epoch_reject_the_displayed_receiver_evidence(){
        let temp=tempfile::tempdir().unwrap();let route=crate::radio_slots::TestRouting::new(temp.path().join("route.json"));
        route.select("radio2").unwrap();
        let mut slots=[raw_receiver("radio1",14_025_000,None,200),raw_receiver("radio2",7_025_000,None,1600)];
        let displayed=from_slots(&route,&slots).unwrap();
        slots[1].1["snapshot"]["generation"]=json!(8);
        let reconnected=from_slots(&route,&slots).unwrap();
        assert_eq!(displayed.radio,reconnected.radio);
        assert!(!same_receiver(&displayed.observation,&reconnected.observation));
        slots[1].1["snapshot"]["generation"]=json!(7);
        slots[1].0["generation"]=json!(4);slots[1].1["selection_generation"]=json!(4);
        assert!(!same_receiver(&displayed.observation,&from_slots(&route,&slots).unwrap().observation));
    }
    #[test]fn uncertain_entry_holds_route_until_exact_receipt_and_editor_reconciliation_complete(){
        let temp=tempfile::tempdir().unwrap();let route=crate::radio_slots::TestRouting::new(temp.path().join("route.json"));
        route.select("radio2").unwrap();let captured=route.snapshot().unwrap();
        let mut pending=PendingRoute(Some(route.fence(&captured).unwrap()));
        let operation=uuid::Uuid::new_v4().to_string();let generation=uuid::Uuid::new_v4().to_string();let draft=uuid::Uuid::new_v4().to_string();
        let coordinates=json!({"generation":generation,"draft":draft,"revision":3,"callsign":"K2RX"});
        pending.retire_terminal(true);
        assert!(route.select("radio1").is_err());route.select("radio2").unwrap();
        let unknown=json!({"receipt":{"mutation":{"operationID":"different"}}});
        assert!(pending.reconcile(&unknown,&operation,&coordinates,||panic!("Unproven receipt must retain the editor barrier")).is_err());
        assert!(route.select("radio1").is_err());
        let response=json!({"receipt":{"mutation":{"operationID":operation,"draftID":draft,"expectedRevision":3,"action":"replace"},
            "draft":{"generation":generation,"revision":4,"qso":{"id":draft,"call":"K2RX"}}}});
        assert!(pending.reconcile(&response,&operation,&coordinates,||{
            assert!(route.select("radio1").is_err(),"The route remains bound through editor reconciliation");Ok(())
        }).unwrap());
        route.select("radio1").unwrap();
        assert!(pending.0.is_none());
    }
    #[test]fn retired_workspace_and_inactive_terminal_release_pending_route_without_stale_holds(){
        let temp=tempfile::tempdir().unwrap();let route=crate::radio_slots::TestRouting::new(temp.path().join("route.json"));
        route.select("radio2").unwrap();let captured=route.snapshot().unwrap();
        let mut pending=PendingRoute(Some(route.fence(&captured).unwrap()));
        assert!(route.select("radio1").is_err());
        assert!(!pending.reconcile(&json!({"status":"workspace_changed"}),"original-operation",&json!({}),||Ok(())).unwrap());
        route.select("radio1").unwrap();assert!(pending.0.is_none());
        let mut terminal=PendingRoute(Some(route.fence(&route.snapshot().unwrap()).unwrap()));
        terminal.retire_terminal(false);
        route.select("radio2").unwrap();assert!(terminal.0.is_none());
        assert!(route.fence(&captured).is_err(),"Retiring a source cannot revive an old route generation");
    }
    #[test]fn retained_inventory_stress_has_three_results_and_no_log_database_scan(){
        let mut observation:Observation=serde_json::from_value(json!({"selection":{"provider":"hamlib","identity":"00000000-0000-4000-8000-000000000001","generation":1,"control":0},"revision":1,"frequency":14025000,"receive_frequency":null,"mode":"CW","connection":1})).unwrap();
        let now=1_800_000_000_000;
        let spots:Vec<_>=(0..500).map(|index|json!({"id":format!("spot-{index:03}"),"callsign":format!("K{index:03}AA"),"frequencyKHz":14020.0+index as f64*0.02,"receivedAt":now as f64/1000.0-978307200.0,"mode":"CW"})).collect();
        let started=std::time::Instant::now();
        for step in 0..100 {observation.frequency=14024000+step*20;assert!(ranked(&spots,&observation,now,250).len()<=3);}
        eprintln!("Nearby callsign projection: 100 RX updates over 500 retained reports in {:.2} ms",started.elapsed().as_secs_f64()*1000.0);
        let far:Vec<_>=(0..500).map(|index|json!({"id":format!("far-{index}"),"callsign":"K1AAA","frequencyKHz":7120.0,"receivedAt":now as f64/1000.0-978307200.0,"mode":"CW"})).chain(std::iter::once(json!({"id":"unretained","callsign":"ZL1ABC","frequencyKHz":14025.0,"receivedAt":now as f64/1000.0-978307200.0,"mode":"CW"}))).collect();
        observation.frequency=14025000;assert!(ranked(&far,&observation,now,250).is_empty());
    }
    #[test]fn receipt_uuid_case_is_normalized_but_other_durable_coordinates_must_match(){
        let operation="abcdefab-0000-4000-8000-000000000001";let generation="abcdefab-0000-4000-8000-000000000002";let draft="abcdefab-0000-4000-8000-000000000003";
        let mut receipt=json!({"mutation":{"operationID":operation.to_uppercase(),"draftID":draft.to_uppercase(),"expectedRevision":3,"action":"replace"},"draft":{"generation":generation.to_uppercase(),"revision":4,"qso":{"id":draft.to_uppercase(),"call":"ZL1ABC"}}});
        assert!(receipt_matches(&receipt,operation,generation,draft,3,"ZL1ABC"));
        receipt["mutation"]["expectedRevision"]=json!(4);assert!(!receipt_matches(&receipt,operation,generation,draft,3,"ZL1ABC"));
    }
    #[test]fn split_rx_boundaries_ties_age_and_mode_are_bounded(){
        let observation:Observation=serde_json::from_value(json!({"selection":{"provider":"hamlib","identity":"00000000-0000-4000-8000-000000000001","generation":1,"control":0},"revision":1,"frequency":14030000,"receive_frequency":14025000,"mode":"CW","connection":1})).unwrap();
        let now=1_800_000_000_000;
        let spot=|id:&str,call:&str,hz:u64,age:u64,mode:&str|json!({"id":id,"callsign":call,"frequencyKHz":hz as f64/1000.0,"receivedAt":(now/1000-age) as f64-978307200.0,"mode":mode});
        let spots=vec![spot("a","K1AAA",14025250,3,"CW"),spot("b","K1BBB",14024750,2,"CW"),spot("c","K1AAA",14025250,4,"CW"),spot("d","K1DDD",14025251,0,"CW"),spot("e","K1EEE",14025000,601,"CW"),spot("f","K1FFF",14025000,0,"SSB")];
        let ranked=ranked(&spots,&observation,now,250);
        assert_eq!(ranked.len(),2);assert_eq!(ranked[0].0["callsign"],"K1BBB");assert_eq!(ranked[1].2,250);
    }

    #[test]fn phone_half_width_and_band_edge_are_exact(){
        let observation:Observation=serde_json::from_value(json!({"selection":{"provider":"hamlib","identity":"00000000-0000-4000-8000-000000000001","generation":1,"control":0},"revision":1,"frequency":14100000,"receive_frequency":null,"mode":"USB","connection":1})).unwrap();
        let now=1_800_000_000_000;
        let spot=|id:&str,hz:u64|json!({"id":id,"callsign":"ZL1ABC","frequencyKHz":hz as f64/1000.0,"receivedAt":now as f64/1000.0-978307200.0,"mode":"SSB"});
        assert_eq!(ranked(&[spot("a",14101500),spot("b",14101501)],&observation,now,1500).len(),1);
        let mut edge=observation.clone();edge.frequency=14349900;
        assert!(ranked(&[spot("c",14350100)],&edge,now,1500).is_empty());
    }
    #[test]fn receiver_slot_reconnect_revision_and_source_expiry_cannot_reuse_earlier_candidate(){
        let observed:Observation=serde_json::from_value(json!({"selection":{"provider":"hamlib","identity":"00000000-0000-4000-8000-000000000001","generation":1,"control":0},"revision":5,"frequency":14030000,"receive_frequency":14025000,"mode":"CW","connection":1})).unwrap();
        let mut current=observed.clone();assert!(same_receiver(&observed,&current));
        current.revision=4;assert!(!same_receiver(&observed,&current));current=observed.clone();
        current.connection=Some(2);assert!(!same_receiver(&observed,&current));current=observed.clone();
        let mut changed=serde_json::to_value(&current).unwrap();changed["selection"]["identity"]=json!("00000000-0000-4000-8000-000000000002");
        current=serde_json::from_value(changed).unwrap();assert!(!same_receiver(&observed,&current));
        let now=1_800_000_000_000;
        let candidate=Candidate{radio:ActiveRadio{radio_id:"radio1".into(),generation:1},worker_generation:None,observation:observed.clone(),source_epoch:"epoch-a".into(),spot_id:"report".into(),spot_version:"version-a".into(),callsign:"ZL1ABC".into(),frequency_hz:14025120,offset_hz:120,age_seconds:0,generation:"workspace".into(),draft_id:"draft".into(),draft_revision:3};
        let mut spot=json!({"id":"report","callsign":"ZL1ABC","frequencyKHz":14025.12,"receivedAt":now as f64/1000.0-978307200.0,"mode":"CW","activation":{"sourceEpoch":"epoch-a","spotVersion":"version-a"}});
        assert!(candidate_in_inventory(&candidate,&[spot.clone()],&observed,now,250));
        spot["activation"]["sourceEpoch"]=json!("epoch-b");assert!(!candidate_in_inventory(&candidate,&[spot.clone()],&observed,now,250));
        spot["activation"]["sourceEpoch"]=json!("epoch-a");spot["activation"]["spotVersion"]=json!("version-b");assert!(!candidate_in_inventory(&candidate,&[spot.clone()],&observed,now,250));
        spot["activation"]["spotVersion"]=json!("version-a");assert!(!candidate_in_inventory(&candidate,&[spot],&observed,now+601000,250));
        assert!(!candidate_in_inventory(&candidate,&[],&observed,now,250));
    }

}
