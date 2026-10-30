//! Retained native CW identities. This module resolves evidence, never operates
//! a radio or writes a draft. Renderer fields cannot become a callsign target.
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::{Mutex, OnceLock}};

#[derive(Clone)]
struct Retained { worker:u64, version:String, target:Value }
struct Feed { epoch:String, rows:BTreeMap<String,Retained>, signals:BTreeMap<String,Retained> }
fn feed() -> &'static Mutex<Feed> {
    static FEED:OnceLock<Mutex<Feed>>=OnceLock::new();
    FEED.get_or_init(||Mutex::new(Feed{epoch:uuid::Uuid::new_v4().to_string(),rows:BTreeMap::new(),signals:BTreeMap::new()}))
}
pub fn owns(epoch:&str)->bool {feed().lock().is_ok_and(|value|value.epoch==epoch)}
fn uuid(value:&Value)->Result<String,String> {
    value.as_str().and_then(|value|uuid::Uuid::parse_str(value).ok()).filter(|id|!id.is_nil())
        .map(|id|id.to_string()).ok_or_else(||"CW selection identity is invalid.".into())
}
fn counter(value:&Value)->bool {
    value.as_str().is_some_and(|raw|raw.parse::<u64>().is_ok_and(|number|number.to_string()==raw))
}
fn callsign(value:&Value)->bool {
    value.as_str().is_some_and(|call|(3..=20).contains(&call.len()) && !call.starts_with('/') && !call.ends_with('/') && !call.contains("//")
        && call.bytes().all(|b|b.is_ascii_uppercase()||b.is_ascii_digit()||b==b'/')
        && call.bytes().any(|b|b.is_ascii_uppercase()) && call.bytes().any(|b|b.is_ascii_digit()))
}
fn target(row:&Value,session:&Value,signal:bool)->Result<Value,String> {
    let selection=&row["selection"];let reference=if signal{&row["controlReference"]}else{&selection["reference"]};let descriptor=&row["descriptor"];
    let fields=["sessionID","sourceID","streamToken","epoch","trackID","revision","selectionID"];
    if reference.as_object().is_none_or(|object|object.len()!=fields.len()||fields.iter().any(|key|!object.contains_key(*key)))
        || row["ambiguous"]!=false || descriptor["replay"]!=false || !signal && !callsign(&selection["callsign"])
        || !matches!(descriptor["radioID"].as_str(),Some("radio1"|"radio2"))
        || !matches!(descriptor["provider"].as_str(),Some("tci_iq"|"flex_dax_iq"))
        || !counter(&reference["epoch"]) || !counter(&reference["revision"])
        || reference["epoch"]!=descriptor["epoch"] || reference["revision"]!=row["revision"] {
        return Err("CW selection does not match its capture.".into());
    }
    for key in ["sessionID","sourceID","streamToken"] {
        if uuid(&reference[key])?!=uuid(&descriptor[key])? {return Err("CW capture changed.".into());}
    }
    if uuid(&reference["sessionID"])?!=uuid(session)? || uuid(&reference["sourceID"])?!=uuid(&row["sourceID"])?
        || uuid(&reference["trackID"])?!=uuid(&row["trackID"])? {return Err("CW track changed.".into());}
    uuid(&reference["selectionID"])?;
    let frequency=row.get("frequencyHz").cloned().unwrap_or(Value::Null);
    if !frequency.is_null() && (descriptor["mappingQualified"]!=true || frequency.as_u64().is_none_or(|hz|!(100_000..=1_000_000_000).contains(&hz))) {
        return Err("CW frequency mapping is unqualified.".into());
    }
    let mut result=json!({"reference":reference,"radioID":descriptor["radioID"],"provider":descriptor["provider"],"frequencyHz":frequency});
    if !signal{result["callsign"]=selection["callsign"].clone();}
    Ok(result)
}
fn retain(feed:&mut Feed,worker:u64,response:&mut Value)->Result<(),String> {
    let result=&response["result"];
    let rows=result["tracks"].as_array().filter(|rows|rows.len()<=32).ok_or("CW track projection is invalid.")?;
    let mut next=BTreeMap::new();let mut signals=BTreeMap::new();let mut annotations=Vec::new();let mut signal_annotations=Vec::new();
    for (index,row) in rows.iter().enumerate() {
        if row.get("controlReference").is_some() && row["ambiguous"]==false && row["muted"]!=true && row["frequencyHz"].is_u64() {
            if result["state"]!="running" {return Err("CW signal is not running.".into());}
            let target=target(row,&result["sessionID"],true)?;let id=uuid(&row["trackID"])?;
            if signals.contains_key(&id){return Err("CW signal identity is ambiguous.".into());}
            let version=feed.signals.get(&id).filter(|old|old.worker==worker&&old.target==target)
                .map(|old|old.version.clone()).unwrap_or_else(||uuid::Uuid::new_v4().to_string());
            signal_annotations.push((index,json!({"sourceEpoch":feed.epoch,"spotVersion":version})));
            signals.insert(id,Retained{worker,version,target});
        }
        if row.get("selection").is_none(){continue;}
        if result["state"]!="running" {return Err("CW selection is not running.".into());}
        let target=target(row,&result["sessionID"],false)?;let id=uuid(&row["trackID"])?;
        if row["muted"]==true || !target["frequencyHz"].is_u64(){continue;}
        if next.contains_key(&id){return Err("CW track identity is ambiguous.".into());}
        let version=feed.rows.get(&id).filter(|old|old.worker==worker&&old.target==target)
            .map(|old|old.version.clone()).unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        annotations.push((index,json!({"sourceEpoch":feed.epoch,"spotVersion":version})));
        next.insert(id,Retained{worker,version,target});
    }
    // Validate everything before replacing identities or annotating the reply.
    feed.rows=next;feed.signals=signals;
    // Action grants belong to this native read. Never preserve a producer's or
    // cached projection's old grant after mapping/ownership has been withdrawn.
    if let Some(rows)=response["result"]["tracks"].as_array_mut(){for row in rows{
        if let Some(selection)=row.get_mut("selection").and_then(Value::as_object_mut){selection.remove("activation");}
        if let Some(object)=row.as_object_mut(){object.remove("controlActivation");}
    }}
    for (index,activation) in annotations {response["result"]["tracks"][index]["selection"]["activation"]=activation;}
    for (index,activation) in signal_annotations {response["result"]["tracks"][index]["controlActivation"]=activation;}
    Ok(())
}
pub fn snapshot(request:Value)->Result<Value,String> {
    let worker=crate::worker::generation();crate::worker::require_existing_generation(worker)?;
    let mut response=crate::worker::request_existing_generation(request,worker)?;
    if response["ok"]==true {
        { let mut feed=feed().lock().map_err(|_|"CW identities unavailable.")?;
          retain(&mut feed,worker,&mut response)?; }
        let module=crate::operating_module::owner()?.snapshot()?;
        if module["transitioning"]!=false{return Err("The operating module is changing. Read CW state after it completes.".into());}
        crate::worker::require_existing_generation(worker)?;
        response["result"]["operatingModule"]=module["selected"].clone();
        response["result"]["operatingContext"]=module["context"].clone();
    }
    Ok(response)
}
fn lookup(feed:&Feed,request:&crate::spot_activation::Request)->Result<Retained,String> {
    lookup_kind(feed,request,false)
}
fn lookup_kind(feed:&Feed,request:&crate::spot_activation::Request,signal:bool)->Result<Retained,String> {
    if feed.epoch!=request.source_epoch {return Err("CW source changed. Select the current signal again.".into());}
    let key=uuid(&json!(request.spot_id))?;let version=uuid(&json!(request.spot_version))?;
    let rows=if signal{&feed.signals}else{&feed.rows};
    rows.get(&key).filter(|row|row.version==version).cloned().ok_or_else(||"CW signal changed or expired.".into())
}
fn resolve_signal_with(retained:&Retained,read:impl FnOnce(Value,u64)->Result<Value,String>)->Result<Value,String> {
    let id=format!("native-cw-signal-{}",uuid::Uuid::new_v4());
    let response=read(json!({"id":id,"method":"cw_decode_resolve_signal","params":{"reference":retained.target["reference"]}}),retained.worker)?;
    if response["id"]!=id || response["ok"]!=true || response["result"]!=retained.target {return Err("CW RF evidence changed or expired.".into());}
    Ok(retained.target.clone())
}
pub fn resolve_signal(request:&crate::spot_activation::Request)->Result<Value,String> {
    let retained={let feed=feed().lock().map_err(|_|"CW identities unavailable.")?;lookup_kind(&feed,request,true)?};
    let result=resolve_signal_with(&retained,crate::worker::request_existing_generation)?;
    let current={let feed=feed().lock().map_err(|_|"CW identities unavailable.")?;lookup_kind(&feed,request,true)?};
    if current.worker!=retained.worker || current.target!=retained.target {return Err("CW RF evidence changed during readback.".into());}
    crate::worker::require_existing_generation(retained.worker)?;Ok(result)
}
fn resolve_with(retained:&Retained,read:impl FnOnce(Value,u64)->Result<Value,String>)->Result<Value,String> {
    if retained.target["frequencyHz"].as_u64().is_none_or(|hz|!(100_000..=1_000_000_000).contains(&hz)){
        return Err("CW RF mapping is unqualified; diagnostic copy cannot authorize an action.".into());
    }
    let id=format!("native-cw-selection-{}",uuid::Uuid::new_v4());
    let response=read(json!({"id":id,"method":"cw_decode_resolve_selection","params":{"reference":retained.target["reference"],"require_frequency":true}}),retained.worker)?;
    if response["id"]!=id || response["ok"]!=true {return Err("CW evidence could not be revalidated.".into());}
    let mut current=response["result"].clone();
    if current.is_object() && current.get("frequencyHz").is_none(){current["frequencyHz"]=Value::Null;}
    if current!=retained.target {return Err("CW evidence changed before selection.".into());}
    Ok(json!({"call":current["callsign"],"frequencyHz":null,"band":"","mode":"","country":"","comment":"","specialTags":[],"cwCallsign":current["reference"]}))
}
pub fn resolve(request:&crate::spot_activation::Request)->Result<Value,String> {
    let retained={let feed=feed().lock().map_err(|_|"CW identities unavailable.")?;lookup(&feed,request)?};
    let result=resolve_with(&retained,crate::worker::request_existing_generation)?;
    let current={let feed=feed().lock().map_err(|_|"CW identities unavailable.")?;lookup(&feed,request)?};
    if current.worker!=retained.worker || current.target!=retained.target {return Err("CW evidence changed during readback.".into());}
    crate::worker::require_existing_generation(retained.worker)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn feed_fixture()->Feed {Feed{epoch:uuid::Uuid::new_v4().to_string(),rows:BTreeMap::new(),signals:BTreeMap::new()}}
    fn response()->Value {
        let session=uuid::Uuid::new_v4().to_string();let source=uuid::Uuid::new_v4().to_string();let token=uuid::Uuid::new_v4().to_string();let track=uuid::Uuid::new_v4().to_string();
        json!({"ok":true,"result":{"state":"running","sessionID":session,"tracks":[{"sourceID":source,"trackID":track,"revision":"1","ambiguous":false,"frequencyHz":14025600,
            "descriptor":{"sessionID":session,"sourceID":source,"streamToken":token,"epoch":"2","radioID":"radio2","provider":"tci_iq","replay":false,"mappingQualified":true},
            "selection":{"callsign":"K1ABC","reference":{"sessionID":session,"sourceID":source,"streamToken":token,"epoch":"2","trackID":track,"revision":"1","selectionID":uuid::Uuid::new_v4().to_string()}}}]}})
    }
    #[test]
    fn equal_snapshots_keep_tokens_but_worker_changes_and_removed_tracks_retire_them() {
        let mut feed=feed_fixture();let original=response();let mut first=original.clone();retain(&mut feed,1,&mut first).unwrap();
        let request=crate::spot_activation::Request{operation_id:uuid::Uuid::new_v4().to_string(),source_epoch:feed.epoch.clone(),
            spot_id:first["result"]["tracks"][0]["trackID"].as_str().unwrap().into(),spot_version:first["result"]["tracks"][0]["selection"]["activation"]["spotVersion"].as_str().unwrap().into()};
        assert!(lookup(&feed,&request).is_ok());
        let mut repeated=original.clone();retain(&mut feed,1,&mut repeated).unwrap();assert_eq!(first,repeated);
        let mut restarted=original;retain(&mut feed,2,&mut restarted).unwrap();assert_ne!(first,restarted);
        assert!(lookup(&feed,&request).is_err());
        retain(&mut feed,2,&mut json!({"result":{"state":"stopped","tracks":[]}})).unwrap();assert!(feed.rows.is_empty());
    }
    #[test]
    fn malformed_capture_ambiguity_and_oversized_projection_cannot_replace_retained_state() {
        let mut feed=feed_fixture();let original=response();retain(&mut feed,1,&mut original.clone()).unwrap();let version=feed.rows.values().next().unwrap().version.clone();
        for (path,value) in [("/result/tracks/0/ambiguous",json!(true)),("/result/tracks/0/selection/reference/epoch",json!(2)),
            ("/result/tracks/0/selection/reference/sourceID",json!(uuid::Uuid::new_v4().to_string())),("/result/tracks/0/selection/callsign",json!("CQ"))] {
            let mut invalid=original.clone();*invalid.pointer_mut(path).unwrap()=value;assert!(retain(&mut feed,1,&mut invalid).is_err());assert_eq!(feed.rows.values().next().unwrap().version,version);
        }
        let mut invalid=original.clone();invalid["result"]["tracks"]=json!(vec![original["result"]["tracks"][0].clone();33]);assert!(retain(&mut feed,1,&mut invalid).is_err());
        let mut invalid=original.clone();invalid["result"]["tracks"]=json!(vec![original["result"]["tracks"][0].clone();2]);assert!(retain(&mut feed,1,&mut invalid).is_err());
        let mut invalid=original;invalid["result"]["tracks"][0]["descriptor"]["mappingQualified"]=json!(false);assert!(retain(&mut feed,1,&mut invalid).is_err());
    }
    #[test]
    fn resolution_uses_only_retained_reference_and_discards_rf_from_callsign_command() {
        let mut feed=feed_fixture();retain(&mut feed,7,&mut response()).unwrap();let retained=feed.rows.values().next().unwrap();
        let result=resolve_with(retained,|request,worker|{
            assert_eq!(worker,7);assert_eq!(request["params"].as_object().unwrap().len(),2);assert_eq!(request["params"]["require_frequency"],true);
            Ok(json!({"id":request["id"],"ok":true,"result":retained.target}))
        }).unwrap();
        assert_eq!(result["call"],"K1ABC");assert!(result["frequencyHz"].is_null());assert_eq!(result["cwCallsign"],retained.target["reference"]);
        assert!(resolve_with(retained,|request,_|{let mut target=retained.target.clone();target["callsign"]=json!("K2XYZ");Ok(json!({"id":request["id"],"ok":true,"result":target}))}).is_err());
    }
    #[test]
    fn unknown_rf_or_mute_withdraws_action_tokens_but_keeps_diagnostic_call() {
        let mut original=response();let row=&mut original["result"]["tracks"][0];row["controlReference"]=row["selection"]["reference"].clone();
        let mut feed=feed_fixture();let mut first=original.clone();
        retain(&mut feed,7,&mut first).unwrap();assert_eq!(feed.rows.len(),1);assert_eq!(feed.signals.len(),1);
        let mut diagnostic=first.clone();let row=&mut diagnostic["result"]["tracks"][0];
        row["descriptor"]["mappingQualified"]=json!(false);row.as_object_mut().unwrap().remove("frequencyHz");
        retain(&mut feed,7,&mut diagnostic).unwrap();
        assert!(feed.rows.is_empty());assert!(feed.signals.is_empty());
        assert_eq!(diagnostic["result"]["tracks"][0]["selection"]["callsign"],"K1ABC");
        assert!(diagnostic["result"]["tracks"][0]["selection"].get("activation").is_none());
        assert!(diagnostic["result"]["tracks"][0].get("controlActivation").is_none());
        let mut muted=first;muted["result"]["tracks"][0]["muted"]=json!(true);
        retain(&mut feed,7,&mut muted).unwrap();assert!(feed.rows.is_empty());assert!(feed.signals.is_empty());
        assert!(muted["result"]["tracks"][0]["selection"].get("activation").is_none());
        assert!(muted["result"]["tracks"][0].get("controlActivation").is_none());
    }
    #[test]
    fn unqualified_cached_call_cannot_enter_an_effect_readback() {
        let mut feed=feed_fixture();retain(&mut feed,7,&mut response()).unwrap();
        let mut retained=feed.rows.values().next().unwrap().clone();retained.target["frequencyHz"]=Value::Null;
        assert!(resolve_with(&retained,|_,_|panic!("Unknown RF must fail before any worker read or draft effect")).is_err());
    }
    #[test]
    fn call_less_signal_has_separate_native_rf_tokens_and_revalidates_exact_target() {
        let mut feed=feed_fixture();let mut response=response();let row=&mut response["result"]["tracks"][0];
        row["controlReference"]=row["selection"]["reference"].clone();row.as_object_mut().unwrap().remove("selection");
        row["descriptor"]["mappingQualified"]=json!(true);row["frequencyHz"]=json!(14025600);
        retain(&mut feed,7,&mut response).unwrap();assert!(feed.rows.is_empty());assert_eq!(feed.signals.len(),1);
        assert!(response["result"]["tracks"][0].get("selection").is_none());
        let retained=feed.signals.values().next().unwrap();assert!(retained.target.get("callsign").is_none());
        let target=resolve_signal_with(retained,|request,worker|{
            assert_eq!(worker,7);assert_eq!(request["method"],"cw_decode_resolve_signal");
            assert_eq!(request["params"],json!({"reference":retained.target["reference"]}));
            Ok(json!({"id":request["id"],"ok":true,"result":retained.target}))
        }).unwrap();assert_eq!(target["frequencyHz"],14025600);
        assert!(resolve_signal_with(retained,|request,_|{let mut target=retained.target.clone();target["frequencyHz"]=json!(14025700);Ok(json!({"id":request["id"],"ok":true,"result":target}))}).is_err());
        assert!(response["result"]["tracks"][0]["controlActivation"]["spotVersion"].is_string());
    }
    #[test]
    fn muted_ambiguous_unqualified_and_replaced_signals_cannot_retain_rf_admission() {
        let mut original=response();let row=&mut original["result"]["tracks"][0];
        row["controlReference"]=row["selection"]["reference"].clone();row.as_object_mut().unwrap().remove("selection");
        row["descriptor"]["mappingQualified"]=json!(true);row["frequencyHz"]=json!(14025600);
        let mut feed=feed_fixture();let mut first=original.clone();retain(&mut feed,1,&mut first).unwrap();
        let version=feed.signals.values().next().unwrap().version.clone();
        let mut replacement=original.clone();retain(&mut feed,2,&mut replacement).unwrap();assert_ne!(feed.signals.values().next().unwrap().version,version);
        for key in ["muted","ambiguous"] {
            let mut denied=original.clone();denied["result"]["tracks"][0][key]=json!(true);retain(&mut feed,2,&mut denied).unwrap();assert!(feed.signals.is_empty());
        }
        let mut denied=original.clone();denied["result"]["tracks"][0].as_object_mut().unwrap().remove("frequencyHz");
        retain(&mut feed,2,&mut denied).unwrap();assert!(feed.signals.is_empty());
        let mut denied=original;denied["result"]["tracks"][0]["descriptor"]["mappingQualified"]=json!(false);assert!(retain(&mut feed,2,&mut denied).is_err());
    }
}
