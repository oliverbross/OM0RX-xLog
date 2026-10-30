//! Explicit CW callsign intent. No renderer callsign, RF target or effect flag.
use serde_json::{json,Value};
pub enum Action {Apply(crate::spot_activation::Request,String,crate::operating_module::OperatingModule),Status(String),Reconcile(String)}
pub fn validate_surface(label:&str,isolated:bool,exiting:bool)->Result<(),String> {
    if isolated||exiting||!matches!(label,"main"|"cw-decode"|"contest--cw-decode") {Err("CW callsign actions are unavailable in this window.".into())} else {Ok(())}
}
fn id(value:&str)->Result<(),String> {
    if uuid::Uuid::parse_str(value).is_ok_and(|id|!id.is_nil()){Ok(())}else{Err("CW action identity is invalid.".into())}
}
pub fn parse(mut value:Value)->Result<Action,String> {
    if value.to_string().len()>1024 {return Err("CW action exceeds its input limit.".into());}
    let object=value.as_object_mut().ok_or("CW action is invalid.")?;
    let action=object.remove("action").and_then(|v|v.as_str().map(str::to_owned)).ok_or("CW action is missing.")?;
    match action.as_str() {
        "apply"=>{
            let context=object.remove("operatingContext").and_then(|value|value.as_str().map(str::to_owned)).ok_or("CW operating context is missing.")?;id(&context)?;
            let module=serde_json::from_value(object.remove("operatingModule").ok_or("CW operating module is missing.")?).map_err(|_|"CW operating module is invalid.")?;
            let request:crate::spot_activation::Request=serde_json::from_value(value).map_err(|_|"CW selection accepts native identities only.")?;
            for value in [&request.operation_id,&request.source_epoch,&request.spot_id,&request.spot_version]{id(value)?;}
            Ok(Action::Apply(request,context,module))
        },
        "status"|"reconcile"=>{
            if object.len()!=1 {return Err("CW status accepts one operation identity.".into());}
            let operation=object["operationId"].as_str().ok_or("CW operation identity is missing.")?.to_owned();id(&operation)?;
            Ok(if action=="status"{Action::Status(operation)}else{Action::Reconcile(operation)})
        },
        _=>Err("Unknown CW callsign action.".into())
    }
}
pub fn project(value:Value)->Result<Value,String> {
    if value["draftOnly"]!=true || value["tuneConfirmed"]!=false || !value["reservationActive"].is_boolean()
        || !matches!(value["phase"].as_str(),Some("preparing"|"draft_applied"|"confirmed"|"failed"|"blocked"|"uncertain"))
        || !matches!(value["rotor"].as_str(),Some("not_requested"|"not_replayed")) {
        return Err("CW callsign acknowledgement could not be verified. Review Main Logging before trying again.".into());
    }
    let operation=value["operationId"].as_str().ok_or("CW action acknowledgement is missing.")?;id(operation)?;
    let mut result=json!({"operationId":operation,"phase":value["phase"],"reservationActive":value["reservationActive"]});
    if let Some(error)=value.get("error") {
        if error.as_str().is_none_or(|text|text.len()>4096){return Err("CW action error is invalid.".into());}
        result["error"]=error.clone();
    }
    Ok(result)
}
fn durable_status_with(operation:&str, read:impl FnOnce(Value)->Result<Value,String>)->Result<Value,String> {
    id(operation)?;
    let value=read(json!({"operationID":operation}))?;
    if value["operationId"]!=operation{return Err("CW receipt read did not match the original action.".into());}
    project(value)
}
/// Native-only read of an existing worker's durable CW-marked draft receipt.
/// Missing/uncertain outcomes stay held. No source resolution or effect replay.
pub fn durable_status(operation:&str)->Result<Value,String> {
    let generation=crate::worker::generation();crate::worker::require_existing_generation(generation)?;
    durable_status_with(operation,|params|{
        let request=json!({"id":format!("cw-receipt-{}",uuid::Uuid::new_v4()),"method":"spot_draft_cw_status","params":params});
        let response=crate::worker::request_existing_generation(request.clone(),generation)?;
        if response["id"]!=request["id"] || response["ok"]!=true || !response["error"].is_null()
            || crate::worker::generation()!=generation{return Err("CW receipt read is unavailable. No action was repeated.".into());}
        Ok(response["result"].clone())
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roles_never_inherit_general_qso_or_station_authority() {
        for label in ["main","cw-decode","contest--cw-decode"] {assert!(validate_surface(label,false,false).is_ok());assert!(validate_surface(label,true,false).is_err());assert!(validate_surface(label,false,true).is_err());}
        for label in ["cw","station-control","contest--active-qso","settings",""]{assert!(validate_surface(label,false,false).is_err());}
    }
    #[test]
    fn requests_are_bounded_identity_only_and_acks_never_return_draft_fields() {
        let request=json!({"action":"apply","operationId":uuid::Uuid::new_v4().to_string(),"sourceEpoch":uuid::Uuid::new_v4().to_string(),"spotId":uuid::Uuid::new_v4().to_string(),"spotVersion":uuid::Uuid::new_v4().to_string(),"operatingContext":uuid::Uuid::new_v4().to_string(),"operatingModule":"normal_logging"});
        assert!(matches!(parse(request.clone()).unwrap(),Action::Apply(..)));
        for key in ["operatingContext","operatingModule"]{let mut missing=request.clone();missing.as_object_mut().unwrap().remove(key);assert!(parse(missing).is_err());}
        for (key,value) in [("call",json!("K1ABC")),("frequencyHz",json!(14025000)),("tune",json!(true))]{let mut bad=request.clone();bad[key]=value;assert!(parse(bad).is_err());}
        let operation=request["operationId"].clone();
        assert!(matches!(parse(json!({"action":"status","operationId":operation})).unwrap(),Action::Status(_)));
        let ack=json!({"operationId":operation,"phase":"confirmed","draftOnly":true,"tuneConfirmed":false,"reservationActive":false,"rotor":"not_requested","draft":{"qso":{"call":"PRIVATE"}}});
        let projected=project(ack.clone()).unwrap();assert!(projected.get("draft").is_none());
        let mut wrong=ack;wrong["tuneConfirmed"]=json!(true);assert!(project(wrong).is_err());
    }
    #[test]
    fn durable_read_only_uses_original_identity_and_never_promotes_missing_or_unrelated_receipts() {
        let operation=uuid::Uuid::new_v4().to_string();
        let receipt=json!({"operationId":operation,"phase":"confirmed","reservationActive":false,"draftOnly":true,"tuneConfirmed":false,"rotor":"not_requested"});
        let result=durable_status_with(&operation,|params|{assert_eq!(params,json!({"operationID":operation}));Ok(receipt.clone())}).unwrap();
        assert_eq!(result,json!({"operationId":operation,"phase":"confirmed","reservationActive":false}));
        let mut missing=receipt.clone();missing["phase"]=json!("uncertain");
        assert_eq!(durable_status_with(&operation,|_|Ok(missing)).unwrap()["phase"],"uncertain");
        let mut wrong=receipt.clone();wrong["operationId"]=json!(uuid::Uuid::new_v4().to_string());
        assert!(durable_status_with(&operation,|_|Ok(wrong)).is_err());
        let mut unrelated=receipt;unrelated["draftOnly"]=json!(false);
        assert!(durable_status_with(&operation,|_|Ok(unrelated)).is_err());
        assert!(durable_status_with("bad",|_|panic!("invalid identity reached worker")).is_err());
    }
}
