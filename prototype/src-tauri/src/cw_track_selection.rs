//! Retained native CW identities. This module resolves evidence, never operates
//! a radio or writes a draft. Renderer fields cannot become a callsign target.
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::{Mutex, OnceLock}};

#[derive(Clone)]
struct Retained { worker:u64, version:String, target:Value }
struct Feed { epoch:String, rows:BTreeMap<String,Retained> }
fn feed() -> &'static Mutex<Feed> {
    static FEED:OnceLock<Mutex<Feed>>=OnceLock::new();
    FEED.get_or_init(||Mutex::new(Feed{epoch:uuid::Uuid::new_v4().to_string(),rows:BTreeMap::new()}))
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
fn target(row:&Value,session:&Value)->Result<Value,String> {
    let selection=&row["selection"];let reference=&selection["reference"];let descriptor=&row["descriptor"];
    let fields=["sessionID","sourceID","streamToken","epoch","trackID","revision","selectionID"];
    if reference.as_object().is_none_or(|object|object.len()!=fields.len()||fields.iter().any(|key|!object.contains_key(*key)))
        || row["ambiguous"]!=false || descriptor["replay"]!=false || !callsign(&selection["callsign"])
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
    Ok(json!({"reference":reference,"callsign":selection["callsign"],"radioID":descriptor["radioID"],"provider":descriptor["provider"],"frequencyHz":frequency}))
}
fn retain(feed:&mut Feed,worker:u64,response:&mut Value)->Result<(),String> {
    let result=&response["result"];
    let rows=result["tracks"].as_array().filter(|rows|rows.len()<=32).ok_or("CW track projection is invalid.")?;
    let mut next=BTreeMap::new();let mut annotations=Vec::new();
    for (index,row) in rows.iter().enumerate() {
        if row.get("selection").is_none(){continue;}
        if result["state"]!="running" {return Err("CW selection is not running.".into());}
        let target=target(row,&result["sessionID"])?;let id=uuid(&row["trackID"])?;
        if next.contains_key(&id){return Err("CW track identity is ambiguous.".into());}
        let version=feed.rows.get(&id).filter(|old|old.worker==worker&&old.target==target)
            .map(|old|old.version.clone()).unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        annotations.push((index,json!({"sourceEpoch":feed.epoch,"spotVersion":version})));
        next.insert(id,Retained{worker,version,target});
    }
    // Validate everything before replacing identities or annotating the reply.
    feed.rows=next;
    for (index,activation) in annotations {response["result"]["tracks"][index]["selection"]["activation"]=activation;}
    Ok(())
}
pub fn snapshot(request:Value)->Result<Value,String> {
    let worker=crate::worker::generation();crate::worker::require_existing_generation(worker)?;
    let mut response=crate::worker::request_existing_generation(request,worker)?;
    if response["ok"]==true {
        { let mut feed=feed().lock().map_err(|_|"CW identities unavailable.")?;
          retain(&mut feed,worker,&mut response)?; }
        response["result"]["operatingModule"]=json!(crate::operating_module::selected_worker_value()?);
    }
    Ok(response)
}
fn lookup(feed:&Feed,request:&crate::spot_activation::Request)->Result<Retained,String> {
    if feed.epoch!=request.source_epoch {return Err("CW source changed. Select the current signal again.".into());}
    let key=uuid(&json!(request.spot_id))?;let version=uuid(&json!(request.spot_version))?;
    feed.rows.get(&key).filter(|row|row.version==version).cloned().ok_or_else(||"CW signal changed or expired.".into())
}
fn resolve_with(retained:&Retained,read:impl FnOnce(Value,u64)->Result<Value,String>)->Result<Value,String> {
    let id=format!("native-cw-selection-{}",uuid::Uuid::new_v4());
    let response=read(json!({"id":id,"method":"cw_decode_resolve_selection","params":{"reference":retained.target["reference"],"require_frequency":false}}),retained.worker)?;
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
    fn feed_fixture()->Feed {Feed{epoch:uuid::Uuid::new_v4().to_string(),rows:BTreeMap::new()}}
    fn response()->Value {
        let session=uuid::Uuid::new_v4().to_string();let source=uuid::Uuid::new_v4().to_string();let token=uuid::Uuid::new_v4().to_string();let track=uuid::Uuid::new_v4().to_string();
        json!({"ok":true,"result":{"state":"running","sessionID":session,"tracks":[{"sourceID":source,"trackID":track,"revision":"1","ambiguous":false,
            "descriptor":{"sessionID":session,"sourceID":source,"streamToken":token,"epoch":"2","radioID":"radio2","provider":"tci_iq","replay":false,"mappingQualified":false},
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
        let mut invalid=original;invalid["result"]["tracks"][0]["frequencyHz"]=json!(14025000);assert!(retain(&mut feed,1,&mut invalid).is_err());
    }
    #[test]
    fn resolution_uses_only_retained_reference_and_discards_rf_from_callsign_command() {
        let mut feed=feed_fixture();retain(&mut feed,7,&mut response()).unwrap();let retained=feed.rows.values().next().unwrap();
        let result=resolve_with(retained,|request,worker|{
            assert_eq!(worker,7);assert_eq!(request["params"].as_object().unwrap().len(),2);assert_eq!(request["params"]["require_frequency"],false);
            Ok(json!({"id":request["id"],"ok":true,"result":retained.target}))
        }).unwrap();
        assert_eq!(result["call"],"K1ABC");assert!(result["frequencyHz"].is_null());assert_eq!(result["cwCallsign"],retained.target["reference"]);
        assert!(resolve_with(retained,|request,_|{let mut target=retained.target.clone();target["callsign"]=json!("K2XYZ");Ok(json!({"id":request["id"],"ok":true,"result":target}))}).is_err());
    }
}
