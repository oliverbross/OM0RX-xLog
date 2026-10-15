//! Durable explicit rotor turns. Renderers never own or replay motion.
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX: u64 = 9_007_199_254_740_991;

pub fn validate_surface(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if isolated || exiting || !matches!(label, "main" | "station-control" | "monitor")
        || !matches!(action, "snapshot" | "receipt" | "review" | "manual_rotor_goto")
    {
        return Err("This window cannot perform that manual rotor operation.".into());
    }
    Ok(())
}

pub fn params(value: &Value) -> Result<Value, String> {
    let owner = value["rotor_owner"].as_str().filter(|owner| matches!(*owner, "native_dcu1" | "hamlib"))
        .ok_or("Select and observe a supported rotor before turning.")?;
    let generation = value["rotor_generation"].as_u64().filter(|generation| *generation < MAX)
        .ok_or("Manual rotor Goto requires an exact rotor generation.")?;
    value["rotor_revision"].as_u64().filter(|revision| *revision <= MAX)
        .ok_or("Manual rotor Goto requires an exact observation revision.")?;
    value["worker_generation"].as_u64().filter(|worker| *worker <= MAX && (owner == "hamlib" || *worker > 0))
        .ok_or("Manual rotor Goto requires the exact native worker generation.")?;
    let bearing = value["bearing"].as_f64().filter(|bearing| bearing.is_finite() && (0.0..=360.0).contains(bearing))
        .ok_or("Rotor bearing must be from 0 to 360 degrees.")?;
    let label = value["label"].as_str().ok_or("Manual rotor Goto requires a target label.")?;
    if label.len() > 64 || !label.bytes().all(|byte| (32..=126).contains(&byte)) {
        return Err("Rotor target label must be bounded printable ASCII.".into());
    }
    Ok(json!({"owner":owner,"generation":generation,"bearing":bearing,"label":label}))
}

fn age_is_fresh(value: &Value, now: u64) -> bool {
    value.as_u64().is_some_and(|observed| now.saturating_sub(observed) <= 5_000 && observed <= now.saturating_add(1_000))
}

fn observed(snapshot: &Value, owner: &str) -> bool {
    let number = |value: &Value| value.as_f64().or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
        .is_some_and(|value| value.is_finite() && (0.0..=360.0).contains(&value));
    match owner {
        "native_dcu1" => snapshot["backend"]["connected"] == true && number(&snapshot["backend"]["azimuth"]),
        "hamlib" => number(&snapshot["backend"]["fields"]["position"]["Azimuth"]),
        _ => false,
    }
}

pub fn admission(projection: &Value, descriptor: &Value, now: u64) -> Result<(), String> {
    let owner = descriptor["rotor_owner"].as_str().ok_or("Missing rotor owner.")?;
    let snapshot = &projection["snapshot"];
    if projection["available"] != true || projection["revision"] != descriptor["rotor_revision"]
        || !age_is_fresh(&projection["received_at_ms"], now) || snapshot["owner"] != owner
        || snapshot["generation"] != descriptor["rotor_generation"] || snapshot["state"] != "active"
        || snapshot["backend_available"] == false || !observed(snapshot, owner)
    {
        return Err("Rotor observation or ownership changed before manual Goto.".into());
    }
    Ok(())
}

pub fn execute(descriptor: &Value, request: Value) -> Result<Value, String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|age| age.as_millis() as u64)
        .map_err(|_| "System time is unavailable.")?;
    admission(&crate::rotor_telemetry::retained_snapshot()?, descriptor, now)?;
    crate::auto_rotor::revoke();
    crate::rotor::request_manual_generation(request, descriptor["worker_generation"].as_u64().unwrap_or(0))
}

pub fn acknowledged(descriptor: &Value, response: &Value) -> bool {
    let Some(generation) = descriptor["rotor_generation"].as_u64().and_then(|generation| generation.checked_add(1)) else { return false; };
    let result = &response["result"];
    result["owner"] == descriptor["rotor_owner"] && result["generation"] == generation && result["state"] == "active"
        && result["target_bearing"] == descriptor["bearing"] && result["target_label"] == descriptor["label"]
        && (result["backend"]["accepted"] == true || result["backend"]["state"] == "accepted")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn descriptor(owner: &str) -> Value { json!({"action":"manual_rotor_goto","rotor_owner":owner,"rotor_generation":7,"rotor_revision":3,
        "worker_generation":if owner == "hamlib" { 0 } else { 11 },"bearing":92.5,"label":"Manual bearing"}) }
    fn projection(owner: &str, now: u64) -> Value {
        let backend = if owner == "hamlib" { json!({"fields":{"position":{"Azimuth":"42.0"}}}) } else { json!({"connected":true,"azimuth":42.0}) };
        json!({"available":true,"revision":3,"received_at_ms":now,"snapshot":{"owner":owner,"generation":7,"state":"active","backend_available":true,"backend":backend}})
    }
    #[test]
    fn exact_params_and_fresh_observation_are_required() {
        let now = 1_000_000;
        for owner in ["native_dcu1", "hamlib"] {
            let value = descriptor(owner); assert!(params(&value).is_ok()); assert!(admission(&projection(owner, now), &value, now).is_ok());
            let mut stale = projection(owner, now); stale["received_at_ms"] = json!(now - 5_001); assert!(admission(&stale, &value, now).is_err());
            let mut replaced = projection(owner, now); replaced["snapshot"]["generation"] = json!(8); assert!(admission(&replaced, &value, now).is_err());
        }
        let mut missing_worker = descriptor("native_dcu1"); missing_worker["worker_generation"] = json!(0); assert!(params(&missing_worker).is_err());
        let mut missing_label = descriptor("native_dcu1"); missing_label.as_object_mut().unwrap().remove("label"); assert!(params(&missing_label).is_err());
    }
    #[test]
    fn acknowledgement_binds_owner_generation_exact_target_and_backend_acceptance() {
        let value = descriptor("native_dcu1");
        assert!(acknowledged(&value, &json!({"result":{"owner":"native_dcu1","generation":8,"state":"active",
            "target_bearing":92.5,"target_label":"Manual bearing","backend":{"accepted":true}}})));
        for changed in [json!({"result":{"owner":"hamlib","generation":8,"state":"active","target_bearing":92.5,"target_label":"Manual bearing","backend":{"accepted":true}}}),
            json!({"result":{"owner":"native_dcu1","generation":7,"state":"active","target_bearing":92.5,"target_label":"Manual bearing","backend":{"accepted":true}}}),
            json!({"result":{"owner":"native_dcu1","generation":8,"state":"uncertain","target_bearing":92.5,"target_label":"Manual bearing","backend":{"accepted":true}}}),
            json!({"result":{"owner":"native_dcu1","generation":8,"state":"active","target_bearing":93.5,"target_label":"Manual bearing","backend":{"accepted":true}}}),
            json!({"result":{"owner":"native_dcu1","generation":8,"state":"active","target_bearing":92.5,"target_label":"Changed target","backend":{"accepted":true}}})] {
            assert!(!acknowledged(&value, &changed));
        }
    }
    #[test]
    fn only_live_control_surfaces_can_use_the_owner() {
        for label in ["main", "station-control", "monitor"] { for action in ["manual_rotor_goto", "review"] { assert!(validate_surface(label, false, false, action).is_ok()); } }
        for label in ["rotor", "settings", "log-qso", "unknown"] { assert!(validate_surface(label, false, false, "manual_rotor_goto").is_err()); }
        assert!(validate_surface("main", true, false, "manual_rotor_goto").is_err()); assert!(validate_surface("main", false, true, "manual_rotor_goto").is_err());
    }
}
