//! Identity-only explicit CW tuning through the existing durable manual owner.
use serde_json::{json, Value};
use crate::spot_activation::Request;
use std::sync::Mutex;
static APPLY: Mutex<()> = Mutex::new(());

pub enum Action {
    Apply(Request, String, crate::operating_module::OperatingModule),
    Status(String, String),
}
fn uuid(value: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(value).is_ok_and(|id| !id.is_nil()) { Ok(()) }
    else { Err("CW tune identity is invalid.".into()) }
}
pub fn validate_origin(value: &Value, operation: &str) -> Result<Request, String> {
    let request: Request = serde_json::from_value(value.clone()).map_err(|_| "CW tune provenance is invalid.")?;
    for id in [&request.operation_id, &request.source_epoch, &request.spot_id, &request.spot_version] { uuid(id)?; }
    if request.operation_id != operation { return Err("CW tune provenance does not match its operation.".into()); }
    Ok(request)
}
pub fn parse(value: Value) -> Result<Action, String> {
    if value.to_string().len() > 1024 { return Err("CW tune exceeds its input limit.".into()); }
    if value["action"] == "status" {
        let object = value.as_object().ok_or("Invalid CW tune status.")?;
        if object.len() != 3 || object.keys().any(|key| !matches!(key.as_str(), "action" | "operationId" | "radioID")) {
            return Err("CW tune status accepts an operation and radio identity only.".into());
        }
        let operation = value["operationId"].as_str().ok_or("Missing CW tune identity.")?; uuid(operation)?;
        let radio = value["radioID"].as_str().ok_or("Missing CW tune radio.")?; crate::radio_slots::index(radio)?;
        return Ok(Action::Status(operation.into(), radio.into()));
    }
    match crate::cw_callsign_bridge::parse(value)? {
        crate::cw_callsign_bridge::Action::Apply(request, context, module) => Ok(Action::Apply(request, context, module)),
        _ => Err("CW tuning accepts an explicit apply or status read only.".into()),
    }
}
fn target_provider(target: &Value, active: &str, selected: &str) -> Result<&'static str, String> {
    let provider = match target["provider"].as_str() {
        Some("flex_dax_iq") => "direct_flex_lan", Some("tci_iq") => "direct_tci",
        _ => return Err("CW signal provider cannot be tuned.".into()),
    };
    if target["radioID"] != active || selected != provider {
        return Err("Select this signal's radio and matching direct provider in Radio Settings before tuning.".into());
    }
    if target["frequencyHz"].as_u64().is_none_or(|hz| !(100_000..=1_000_000_000).contains(&hz)) {
        return Err("CW signal has no qualified RF target.".into());
    }
    Ok(provider)
}
fn descriptor(request: &Request, target: &Value, active: &str, base: &Value, selection: &Value, radio: &Value, worker: u64) -> Result<Value, String> {
    let provider = target_provider(target, active, selection["provider"].as_str().unwrap_or(""))?;
    if radio["provider"] != provider || radio["selection_id"] != selection["selection_id"] || radio["selection_generation"] != selection["generation"] {
        return Err("CW tune requires the current selected radio observation.".into());
    }
    let value = json!({"action":"manual_tune","radio_id":active,"operation_id":request.operation_id,
        "generation":base["generation"],"revision":base["revision"],"provider":provider,
        "selection_generation":selection["generation"],"selection_id":selection["selection_id"],"control_revision":selection["control_revision"],
        "connection_generation":radio["snapshot"]["generation"],"worker_generation":worker,"frequency_hz":target["frequencyHz"],"mode":"CW"});
    crate::manual_tune::params(&value)?;
    Ok(value)
}
pub fn project(receipt: &Value, operation: &str, radio: &str) -> Result<Value, String> {
    if receipt.is_null() { return Ok(json!({"operationId":operation,"radioID":radio,"status":"missing"})); }
    if receipt["operation_id"] != operation || receipt["request"]["action"] != "manual_tune" || receipt["request"]["radio_id"] != radio {
        return Err("This receipt does not belong to that CW tune.".into());
    }
    validate_origin(&receipt["request"]["cw_signal"], operation)?;
    let status = receipt["status"].as_str().filter(|s| matches!(*s, "pending" | "unknown" | "confirmed" | "reviewed" | "rejected"))
        .ok_or("CW tune receipt is invalid.")?;
    Ok(json!({"operationId":operation,"radioID":radio,"status":status}))
}
pub fn status(app: &tauri::AppHandle, operation: &str, radio: &str) -> Result<Value, String> {
    project(&crate::station_session::owner_for(app, radio)?.receipt(operation)?, operation, radio)
}
fn require_idle() -> Result<(), String> {
    if let Some(owner) = crate::cw_session_backend::existing() {
        let value = owner.snapshot()?;
        if value["armed"] != false || value["pending"] != false || !value["owner"].is_null() || !value["lease"].is_null() || value["error"] != "" {
            return Err("Disarm and reconcile CW output before tuning a decoded signal.".into());
        }
    }
    Ok(())
}
pub fn apply(app: &tauri::AppHandle, request: Request, context: String, module: crate::operating_module::OperatingModule) -> Result<Value, String> {
    let _apply = APPLY.try_lock().map_err(|_| "Another CW tune is in progress. Check the original operation before trying again.")?;
    // Find a durable original before consulting live evidence. A lost reply or
    // process restart can only read that operation, never send it again.
    for radio in ["radio1", "radio2"] {
        let receipt = crate::station_session::owner_for(app, radio)?.receipt(&request.operation_id)?;
        if !receipt.is_null() {
            if receipt["request"]["cw_signal"] != json!(request) { return Err("CW tune identity is already in use.".into()); }
            return project(&receipt, &request.operation_id, radio);
        }
    }
    let admission = match crate::operating_module::owner()?.admit(module, Some(&context)) {
        Ok(admission) => admission,
        Err(_) => return Ok(json!({"operationId":request.operation_id,"status":"not_admitted"})),
    };
    let _admission = admission;
    let target = match crate::cw_track_selection::resolve_signal(&request) {
        Ok(target) => target,
        Err(_) => return Ok(json!({"operationId":request.operation_id,"status":"not_admitted"})),
    };
    let radio = target["radioID"].as_str().ok_or("CW tune radio is missing.")?.to_owned();
    let owner = crate::station_session::owner_for(app, &radio)?;
    let execute = || -> Result<Value, String> {
        let active = crate::radio_slots::active(app)?;
        let selection = crate::station_selection::owner_for(app, &radio)?.snapshot()?;
        let observation = crate::station_telemetry::owner_for(app, &radio)?.snapshot()?;
        let worker = crate::worker::generation(); crate::worker::require_existing_generation(worker)?;
        let descriptor = descriptor(&request, &target, &active, &owner.snapshot()?, &selection, &observation, worker)?;
        require_idle()?;
        owner.apply_cw_tune(&descriptor, &json!(request), |wire, generation, identity| {
            crate::manual_tune::execute_guarded(app, &descriptor, wire, generation, identity, || {
                if crate::radio_slots::active(app)? != radio { return Err("The active radio changed; no CW tune was sent.".into()); }
                require_idle()?;
                if crate::cw_track_selection::resolve_signal(&request)? != target { return Err("CW RF evidence changed before tuning.".into()); }
                Ok(())
            })
        })
    };
    match execute() {
        Ok(receipt) => project(&receipt, &request.operation_id, &radio),
        Err(_) => {
            let receipt = owner.receipt(&request.operation_id)?;
            // A missing durable receipt cannot have passed the station owner's
            // journal-before-dispatch boundary. Existing outcomes stay held.
            if receipt.is_null() { Ok(json!({"operationId":request.operation_id,"radioID":radio,"status":"not_admitted"})) }
            else { project(&receipt, &request.operation_id, &radio) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> Value { json!({"operationId":uuid::Uuid::new_v4().to_string(),"sourceEpoch":uuid::Uuid::new_v4().to_string(),"spotId":uuid::Uuid::new_v4().to_string(),"spotVersion":uuid::Uuid::new_v4().to_string()}) }
    #[test]
    fn accepts_only_exact_identity_intents_and_status() {
        let origin=request(); let mut value=origin.clone();value["action"]=json!("apply");value["operatingModule"]=json!("normal_logging");value["operatingContext"]=json!(uuid::Uuid::new_v4().to_string());
        assert!(matches!(parse(value.clone()).unwrap(),Action::Apply(..)));
        for key in ["frequencyHz","mode","radioID","ptt","rotor"] { let mut bad=value.clone();bad[key]=json!(true);assert!(parse(bad).is_err()); }
        assert!(parse(json!({"action":"status","operationId":origin["operationId"],"radioID":"radio2"})).is_ok());
        assert!(parse(json!({"action":"status","operationId":origin["operationId"],"radioID":"radio2","frequencyHz":14025000})).is_err());
    }
    #[test]
    fn never_selects_an_inactive_radio_or_substitutes_provider_or_frequency() {
        let target=json!({"radioID":"radio2","provider":"flex_dax_iq","frequencyHz":14025000});
        assert_eq!(target_provider(&target,"radio2","direct_flex_lan").unwrap(),"direct_flex_lan");
        for (active,selected) in [("radio1","direct_flex_lan"),("radio2","direct_agent"),("radio2","direct_tci")] {assert!(target_provider(&target,active,selected).is_err());}
        let mut invalid=target;invalid["frequencyHz"]=Value::Null;assert!(target_provider(&invalid,"radio2","direct_flex_lan").is_err());
    }
    #[test]
    fn descriptor_uses_native_rf_and_exact_observed_owner_epochs() {
        let request:Request=serde_json::from_value(request()).unwrap();
        let target=json!({"radioID":"radio2","provider":"tci_iq","frequencyHz":14025600});
        let base=json!({"generation":uuid::Uuid::new_v4().to_string(),"revision":2});
        let selection=json!({"provider":"direct_tci","generation":3,"selection_id":uuid::Uuid::new_v4().to_string(),"control_revision":4});
        let radio=json!({"provider":"direct_tci","selection_id":selection["selection_id"],"selection_generation":3,"snapshot":{"generation":5}});
        let value=descriptor(&request,&target,"radio2",&base,&selection,&radio,6).unwrap();
        assert_eq!(value["frequency_hz"],14025600);assert_eq!(value["mode"],"CW");assert_eq!(value["radio_id"],"radio2");
        assert_eq!(value["connection_generation"],5);assert_eq!(value["worker_generation"],6);
        let mut stale=radio;stale["selection_generation"]=json!(2);assert!(descriptor(&request,&target,"radio2",&base,&selection,&stale,6).is_err());
    }
    #[test]
    fn receipt_projection_is_correlated_minimal_and_missing_never_confirms() {
        let origin=request();let operation=origin["operationId"].as_str().unwrap();
        let receipt=json!({"operation_id":operation,"status":"unknown","request":{"action":"manual_tune","radio_id":"radio2","cw_signal":origin,"private":"SECRET"}});
        assert_eq!(project(&receipt,operation,"radio2").unwrap(),json!({"operationId":operation,"radioID":"radio2","status":"unknown"}));
        assert!(project(&receipt,operation,"radio1").is_err());
        assert!(project(&receipt,&uuid::Uuid::new_v4().to_string(),"radio2").is_err());
        assert_eq!(project(&Value::Null,operation,"radio2").unwrap()["status"],"missing");
        let mut bad=receipt;bad["request"]["cw_signal"]["spotVersion"]=json!("bad");assert!(project(&bad,operation,"radio2").is_err());
    }
}
