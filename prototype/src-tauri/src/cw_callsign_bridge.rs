//! Explicit CW callsign intent. No renderer callsign, RF target or effect flag.
use serde_json::{json,Value};
pub enum Action {Apply(crate::spot_activation::Request),Status(String),Reconcile(String)}
pub fn validate_surface(label:&str,isolated:bool,exiting:bool)->Result<(),String> {
    if isolated||exiting||!matches!(label,"main"|"cw-decode") {Err("CW callsign actions are unavailable in this window.".into())} else {Ok(())}
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
            let request:crate::spot_activation::Request=serde_json::from_value(value).map_err(|_|"CW selection accepts native identities only.")?;
            for value in [&request.operation_id,&request.source_epoch,&request.spot_id,&request.spot_version]{id(value)?;}
            Ok(Action::Apply(request))
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
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roles_never_inherit_general_qso_or_station_authority() {
        for label in ["main","cw-decode"] {assert!(validate_surface(label,false,false).is_ok());assert!(validate_surface(label,true,false).is_err());assert!(validate_surface(label,false,true).is_err());}
        for label in ["cw","station-control","contest--active-qso","settings",""]{assert!(validate_surface(label,false,false).is_err());}
    }
    #[test]
    fn requests_are_bounded_identity_only_and_acks_never_return_draft_fields() {
        let request=json!({"action":"apply","operationId":uuid::Uuid::new_v4().to_string(),"sourceEpoch":uuid::Uuid::new_v4().to_string(),"spotId":uuid::Uuid::new_v4().to_string(),"spotVersion":uuid::Uuid::new_v4().to_string()});
        assert!(matches!(parse(request.clone()).unwrap(),Action::Apply(_)));
        for (key,value) in [("call",json!("K1ABC")),("frequencyHz",json!(14025000)),("tune",json!(true))]{let mut bad=request.clone();bad[key]=value;assert!(parse(bad).is_err());}
        let operation=request["operationId"].clone();
        assert!(matches!(parse(json!({"action":"status","operationId":operation})).unwrap(),Action::Status(_)));
        let ack=json!({"operationId":operation,"phase":"confirmed","draftOnly":true,"tuneConfirmed":false,"reservationActive":false,"rotor":"not_requested","draft":{"qso":{"call":"PRIVATE"}}});
        let projected=project(ack.clone()).unwrap();assert!(projected.get("draft").is_none());
        let mut wrong=ack;wrong["tuneConfirmed"]=json!(true);assert!(project(wrong).is_err());
    }
}
