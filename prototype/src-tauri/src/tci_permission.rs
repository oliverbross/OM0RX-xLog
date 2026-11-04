//! Immediate TCI disable coordinates existing owners; it owns no output state.
use serde_json::{json,Value};

fn joined(result:std::thread::Result<Result<Value,String>>)->Result<Value,String>{
    result.unwrap_or_else(|_|Err("Native disable task ended without a verified outcome".into()))
}
fn outcome(value:Result<Value,String>)->Value{
    match value{Ok(value)=>json!({"ok":true,"result":value}),Err(error)=>json!({"ok":false,"message":error})}
}
fn coordinate(
    runtime:impl FnOnce()->Result<Value,String>+Send,
    cw:impl FnOnce()->Result<Value,String>+Send,
    ptt:impl FnOnce()->Result<Value,String>+Send,
    persist:impl FnOnce()->Result<Value,String>,
)->Value{
    // A delayed permission acknowledgement must not strand urgent release.
    let (runtime,cw,ptt,persist)=std::thread::scope(|scope|{
        let runtime=scope.spawn(runtime);let cw=scope.spawn(cw);let ptt=scope.spawn(ptt);
        let persist=persist();(joined(runtime.join()),joined(cw.join()),joined(ptt.join()),persist)
    });
    let disabled=runtime.as_ref().is_ok_and(|r|r["disabled"]==true);
    let saved=persist.as_ref().is_ok_and(|r|r["status"]=="saved");
    let released=ptt.as_ref().is_ok_and(|r|r["release_required"]==false);
    let complete=disabled&&saved&&released&&cw.is_ok();
    json!({"disabled":disabled,"saved":saved,"outcome":if complete{"complete"}else{"uncertain"},
        "message":if complete{"TCI transmit permission disabled and saved for the reviewed connection. Matching native CW/PTT release completed; RF is unverified."}
            else{"TCI disable needs attention. Inspect permission, saved setup and retained CW/PTT release results; no acquisition was retried."},
        "runtime":outcome(runtime),"persistence":outcome(persist),"cw":outcome(cw),"ptt":outcome(ptt)})
}
fn matching_target(target:&crate::ptt_session::Target,radio:&str,connection:u64,worker:u64)->bool{
    target.provider=="direct_tci"&&target.radio_id.as_deref()==Some(radio)
        &&target.connection_generation==connection&&target.worker_generation==worker
}

pub fn disable(app:&tauri::AppHandle,radio_id:&str,connection:u64,generation:&str,revision:u64,operation:&str)->Result<Value,String>{
    if !crate::radio_slots::valid(radio_id)||connection==0||connection>9_007_199_254_740_991||revision>9_007_199_254_740_991
        ||uuid::Uuid::parse_str(generation).is_err()||uuid::Uuid::parse_str(operation).is_err(){return Err("Invalid exact TCI disable context".into());}
    let session=crate::station_session::owner_for(app,radio_id)?;
    let setup=session.snapshot()?;
    if setup["generation"]!=generation||setup["revision"]!=revision{return Err("Saved station setup changed; refresh before disabling TCI".into());}
    let selection=crate::station_selection::owner_for(app,radio_id)?.snapshot()?;
    let telemetry=crate::station_telemetry::owner_for(app,radio_id)?.snapshot()?;
    let worker=telemetry["worker_generation"].as_u64().ok_or("TCI worker identity is unavailable")?;
    if selection["provider"]!="direct_tci"||telemetry["provider"]!="direct_tci"
        ||telemetry["selection_id"]!=selection["selection_id"]||telemetry["selection_generation"]!=selection["generation"]
        ||telemetry["snapshot"]["source"]!="direct_tci"||telemetry["snapshot"]["generation"]!=connection{
        return Err("The exact TCI connection changed; no replacement route was disabled".into());
    }
    crate::worker::require_existing_generation(worker)?;
    let tombstone=crate::station_selection::owner_for(app,radio_id)?.disable_tci_connection(worker,connection);
    let revoke=crate::carrier_tune::revoke_output_intent();
    Ok(coordinate(
        ||{
            let id=format!("native-tci-disable-{operation}");
            let response=crate::worker::request_existing_generation(json!({"id":id,"method":"station_transmit_permission",
                "params":{"provider":"direct_tci","radio_id":radio_id,"expected_generation":connection,"allow_transmit":false}}),worker)?;
            crate::worker::require_existing_generation(worker)?;
            if response["id"]!=id||response["ok"]!=true||response["result"]["disabled"]!=true{
                return Err("Runtime TCI permission outcome is unconfirmed; native release was still attempted".into());
            }
            Ok(response["result"].clone())
        },
        ||{
            if let Some(cw)=crate::cw_session_backend::existing(){cw.stop_route("direct_tci",radio_id,connection)?;}
            tombstone?;revoke?;
            Ok(json!({"matching_route_stop_checked":true,"physical_rf_verified":false}))
        },
        ||{
            // A malformed/unavailable PTT journal must not prevent the other
            // independent runtime-disable / CW Stop branches from starting.
            let ptt_owner=crate::ptt_session::owner(app)?;
            let target=ptt_owner.retained_target()?;
            let Some(target)=target else{return Ok(json!({"matching_owner":false,"release_required":false}));};
            if !matching_target(&target,radio_id,connection,worker){return Err("A retained PTT obligation belongs to another route or worker; it was preserved".into());}
            let receipt=ptt_owner.apply_admitted(operation,false,target,"",|target|crate::ptt_session::preflight(app,target,false,""),
                |request,target|crate::ptt_session::execute(app,request,target,""))?;
            Ok(json!({"matching_owner":true,"receipt":receipt,"release_required":ptt_owner.retained_target()?.is_some()}))
        },
        ||session.disable_tci_transmit(operation,generation,revision),
    ))
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::sync::{Arc,Barrier,atomic::{AtomicBool,Ordering}};
    #[test]
    fn delayed_permission_and_failed_save_do_not_delay_or_skip_existing_owner_release(){
        let barrier=Arc::new(Barrier::new(2));let released=AtomicBool::new(false);
        let result=coordinate(||{barrier.wait();assert!(released.load(Ordering::Acquire));Err("lost permission reply".into())},
            ||Ok(json!({"checked":true})),
            ||{released.store(true,Ordering::Release);barrier.wait();Ok(json!({"release_required":false}))},
            ||Err("stale saved setup".into()));
        assert!(released.load(Ordering::Acquire));assert_eq!(result["outcome"],"uncertain");assert_eq!(result["runtime"]["ok"],false);assert_eq!(result["ptt"]["ok"],true);
    }
    #[test]
    fn complete_requires_runtime_saved_and_release_evidence(){
        let result=coordinate(||Ok(json!({"disabled":true})),||Ok(json!({})),||Ok(json!({"release_required":true})),||Ok(json!({"status":"saved"})));
        assert_eq!(result["outcome"],"uncertain");
        let result=coordinate(||Ok(json!({"disabled":true})),||Ok(json!({})),||Ok(json!({"release_required":false})),||Ok(json!({"status":"saved"})));
        assert_eq!(result["outcome"],"complete");
    }
    #[test]
    fn permission_disable_cannot_release_other_provider_slot_connection_or_worker(){
        let target=|provider:&str,radio:&str,connection:u64,worker:u64|serde_json::from_value::<crate::ptt_session::Target>(json!({
            "provider":provider,"radio_id":radio,"selection_generation":1,"selection_id":uuid::Uuid::new_v4().to_string(),"worker_generation":worker,
            "connection_generation":connection,"control_revision":1,"observation_revision":1,"received_at_ms":1})).unwrap();
        assert!(matching_target(&target("direct_tci","radio1",3,4),"radio1",3,4));
        for t in [target("direct_agent","radio1",3,4),target("direct_tci","radio2",3,4),target("direct_tci","radio1",2,4),target("direct_tci","radio1",3,5)]{
            assert!(!matching_target(&t,"radio1",3,4));
        }
    }
}
