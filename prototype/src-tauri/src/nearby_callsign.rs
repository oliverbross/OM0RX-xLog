//! Read-only retained spot suggestions and callsign-only canonical draft admission.
//! No station command, subscription or CAT poll is available in this owner.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{sync::{Arc,Mutex,OnceLock},time::{Duration,SystemTime,UNIX_EPOCH}};
use tauri::Emitter;
use crate::{radio_follow::{Observation,Selection},radio_read::{Backend,NativeBackend},spot_editor_barrier::EditorBarrier};

#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Candidate {
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
fn half_width(mode:&str)->u64{
    let fallback=if group(mode)==Some("cw"){250}else{1500};
    let Ok(projection)=crate::station_telemetry::retained_snapshot() else{return fallback};
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
fn observed()->Result<Observation,String>{
    let observed=crate::radio_follow::observation(&crate::station_telemetry::retained_snapshot()?,&crate::station_selection::retained_snapshot()?,now())?;
    if observed.connection.is_none(){return Err("The selected receiver connection generation is unavailable.".into());}
    Ok(observed)
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
pub fn snapshot(app:&tauri::AppHandle)->Result<Value,String>{
    let worker=crate::worker::generation();
    let settings=NativeBackend::call(worker,"settings_load",json!({}))?;
    if settings["settings"]["nearbySpottedCallsigns"]!=true{return Ok(json!({"enabled":false,"candidates":[]}));}
    let observation=match observed(){Ok(value)=>value,Err(error)=>return Ok(json!({"enabled":true,"candidates":[],"reason":error}))};
    let projection=crate::cluster_session::owner(app)?.projection_value()?;
    if projection["available"]!=true || projection["received_at_ms"].as_u64().is_none_or(|at|now().saturating_sub(at)>5000){
        return Ok(json!({"enabled":true,"candidates":[],"reason":"Fresh retained cluster reports are unavailable."}));
    }
    let canonical=NativeBackend{app:app.clone()}.canonical()?;
    let candidates:Vec<_>=ranked(projection["response"]["snapshot"]["spots"].as_array().map(Vec::as_slice).unwrap_or(&[]),&observation,now(),half_width(&observation.mode))
        .into_iter().filter_map(|(spot,hz,offset,age)|Some(Candidate{
            observation:observation.clone(),source_epoch:spot["activation"]["sourceEpoch"].as_str()?.into(),
            spot_id:spot["id"].as_str()?.into(),spot_version:spot["activation"]["spotVersion"].as_str()?.into(),
            callsign:spot["callsign"].as_str()?.into(),frequency_hz:hz,offset_hz:offset,age_seconds:age,
            generation:canonical.generation.clone(),draft_id:canonical.draft.clone(),draft_revision:canonical.revision
        })).collect();
    Ok(json!({"enabled":true,"candidates":candidates}))
}
struct Owner{app:tauri::AppHandle,editors:Arc<EditorBarrier>,active:Mutex<()>,latest:Mutex<Value>}
static OWNER:OnceLock<Arc<Owner>>=OnceLock::new();
pub fn install(app:&tauri::AppHandle,editors:Arc<EditorBarrier>){let _=OWNER.set(Arc::new(Owner{app:app.clone(),editors,active:Mutex::new(()),latest:Mutex::new(json!({"operationId":null,"phase":"idle","barrier":null}))}));}
pub fn status()->Option<Value>{OWNER.get()?.latest.lock().ok().map(|v|v.clone())}
pub fn owns(operation:&str)->bool{status().is_some_and(|v|v["operationId"]==operation)}
pub fn active()->bool{status().is_some_and(|v|v["reservationActive"]==true)}
pub fn retire(){if let Some(owner)=OWNER.get(){if let Ok(mut value)=owner.latest.lock(){if value["reservationActive"]!=true{*value=json!({"operationId":null,"phase":"idle","barrier":null});}}}}
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
            let selection=crate::station_selection::retained_snapshot()?;
            if Selection::parse(&selection)?!=candidate.observation.selection{return Err("Selected radio changed. Review a fresh suggestion.".into());}
            let _fence=crate::station_selection::owner(&self.app)?.fence_radio_read_epoch(&selection)?;
            let current=observed()?;
            if !same_receiver(&candidate.observation,&current){
                return Err("The receiver changed. Review a fresh suggestion.".into());
            }
            let cluster=crate::cluster_session::owner(&self.app)?;
            cluster.activation_spot(&candidate.source_epoch,&candidate.spot_id,&candidate.spot_version)?;
            let projection=cluster.projection_value()?;
            let found=candidate_in_inventory(&candidate,projection["response"]["snapshot"]["spots"].as_array().map(Vec::as_slice).unwrap_or(&[]),&current,now(),half_width(&current.mode));
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
        if !unresolved {let _=self.editors.finish(operation);}
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
    let receipt=&response["receipt"];
    let applied=pending["generation"].as_str().zip(pending["draft"].as_str()).zip(pending["revision"].as_u64()).zip(pending["callsign"].as_str())
        .is_some_and(|(((generation,draft),revision),callsign)|receipt_matches(receipt,operation,generation,draft,revision,callsign));
    if !applied && response.get("receipt")!=Some(&Value::Null) && response["status"]!="workspace_changed" {return Err("Nearby receipt cannot yet be verified.".into());}
    owner.editors.finish(operation)?;
    latest["phase"]=json!(if applied{"confirmed"}else{"blocked"});
    latest["reservationActive"]=json!(false);latest["admitted"]=json!(applied);
    latest.as_object_mut().unwrap().remove("pending");
    latest["error"]=json!(if applied{"Callsign entry confirmed; no station command was sent."}else{"No durable nearby callsign entry exists in the original workspace. No action was replayed."});
    Ok(owner.store(latest))
}
pub fn accept(operation:&str,candidate:Candidate)->Result<Value,String>{OWNER.get().ok_or("Nearby callsigns unavailable")?.execute(operation,candidate)}

#[cfg(test)]mod tests{
    use super::*;
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
        let candidate=Candidate{observation:observed.clone(),source_epoch:"epoch-a".into(),spot_id:"report".into(),spot_version:"version-a".into(),callsign:"ZL1ABC".into(),frequency_hz:14025120,offset_hz:120,age_seconds:0,generation:"workspace".into(),draft_id:"draft".into(),draft_revision:3};
        let mut spot=json!({"id":"report","callsign":"ZL1ABC","frequencyKHz":14025.12,"receivedAt":now as f64/1000.0-978307200.0,"mode":"CW","activation":{"sourceEpoch":"epoch-a","spotVersion":"version-a"}});
        assert!(candidate_in_inventory(&candidate,&[spot.clone()],&observed,now,250));
        spot["activation"]["sourceEpoch"]=json!("epoch-b");assert!(!candidate_in_inventory(&candidate,&[spot.clone()],&observed,now,250));
        spot["activation"]["sourceEpoch"]=json!("epoch-a");spot["activation"]["spotVersion"]=json!("version-b");assert!(!candidate_in_inventory(&candidate,&[spot.clone()],&observed,now,250));
        spot["activation"]["spotVersion"]=json!("version-a");assert!(!candidate_in_inventory(&candidate,&[spot],&observed,now+601000,250));
        assert!(!candidate_in_inventory(&candidate,&[],&observed,now,250));
    }

}
