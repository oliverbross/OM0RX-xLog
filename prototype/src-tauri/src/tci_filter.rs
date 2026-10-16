//! Explicit TRX-wide RX_FILTER_BAND only; no lifecycle or transmit authority.
use serde_json::{json, Value};
pub fn params(value: &Value) -> Result<Value, String> {
    if value["provider"] != "direct_tci" || ["connection_generation", "control_revision", "worker_generation"].iter().any(|k|
        value[*k].as_u64().is_none_or(|n| n > 9_007_199_254_740_991 || *k == "worker_generation" && n == 0)) {
        return Err("Refresh the exact TCI connection and worker before adjusting its filter.".into());
    }
    let lower = value["lower_hz"].as_i64().filter(|n| (-24_000..=24_000).contains(n)).ok_or("Invalid lower filter edge.")?;
    let upper = value["upper_hz"].as_i64().filter(|n| (-24_000..=24_000).contains(n)).ok_or("Invalid upper filter edge.")?;
    if lower >= upper { return Err("The lower filter edge must be below the upper edge.".into()); }
    Ok(json!({"provider":"direct_tci","lower_hz":lower,"upper_hz":upper,"expected_generation":value["connection_generation"]}))
}
pub fn admission(projection: &Value, target: &Value, now: u64) -> Result<(), String> {
    let mut tune = target.clone();
    let mut observation = projection.clone();
    tune["provider"] = json!("direct_tci");
    // Reuse the exact selection/connection/fresh/transmit-off admission contract.
    if target["provider"] != "direct_tci" || observation["snapshot"]["transport_state"] != "ready"
        || !observation["snapshot"]["capabilities"]["supported_commands"].as_array().is_some_and(|a| a.iter().any(|c| c == "station_receive_filter"))
        || observation["snapshot"]["tci"]["filter_scope"] != "trx"
        || observation["snapshot"]["tci"]["filter_lower_hz"].as_i64().is_none()
        || observation["snapshot"]["tci"]["filter_upper_hz"].as_i64().is_none() {
        return Err("TCI has not reported an authoritative receive filter.".into());
    }
    observation["snapshot"]["capabilities"]["supported_commands"] = json!(["station_tune"]);
    crate::manual_tune::admission(&observation, &tune, now)
}
pub fn confirmed(target: &Value, response: &Value) -> bool {
    let state = &response["result"]["state"];
    response["result"]["confirmed"] == true && state["source"] == "direct_tci"
        && state["generation"] == target["connection_generation"]
        && state["radio"]["connected"] == true && state["radio"]["observed"] == true
        && state["radio"]["transmitting"] == false && state["tci"]["filter_scope"] == "trx"
        && state["tci"]["filter_lower_hz"] == target["lower_hz"] && state["tci"]["filter_upper_hz"] == target["upper_hz"]
}
pub fn execute(app: &tauri::AppHandle, target: &Value, request: Value, generation: u64, identity: &str) -> Result<Value, String> {
    params(target)?;
    let worker = target["worker_generation"].as_u64().ok_or("Missing worker generation")?;
    crate::worker::require_existing_generation(worker)?;
    let selection = crate::station_selection::owner(app)?;
    let telemetry = crate::station_telemetry::owner(app)?;
    selection.tci_filter_control(request, generation, identity, target["control_revision"].as_u64().ok_or("Missing control revision")?, || {
        crate::worker::require_existing_generation(worker)?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_millis() as u64;
        admission(&telemetry.snapshot()?, target, now)?;
        telemetry.control()
    }, |request| {
        let response = crate::worker::request_existing_generation(request, worker)?;
        crate::worker::require_existing_generation(worker)?;
        Ok(response)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target() -> Value { json!({"provider":"direct_tci","connection_generation":7,"worker_generation":11,"control_revision":3,
        "selection_id":"saved","selection_generation":2,"lower_hz":30,"upper_hz":2700}) }
    #[test]
    fn strict_filter_targets_and_authoritative_reply() {
        let target = target();
        assert_eq!(params(&target).unwrap(), json!({"provider":"direct_tci","lower_hz":30,"upper_hz":2700,"expected_generation":7}));
        for (key, value) in [("provider",json!("direct_agent")),("lower_hz",json!(true)),("lower_hz",json!(30.5)),("lower_hz",json!("30")),
            ("upper_hz",json!(30)),("upper_hz",json!(24001)),("worker_generation",json!(0)),("connection_generation",json!(-1))] {
            let mut wrong = target.clone(); wrong[key] = value; assert!(params(&wrong).is_err(), "{key}");
        }
        let reply = json!({"result":{"confirmed":true,"state":{"source":"direct_tci","generation":7,
            "radio":{"connected":true,"observed":true,"transmitting":false},"tci":{"filter_scope":"trx","filter_lower_hz":30,"filter_upper_hz":2700}}}});
        assert!(confirmed(&target, &reply));
        for path in ["/result/confirmed","/result/state/generation","/result/state/source","/result/state/radio/transmitting","/result/state/tci/filter_scope","/result/state/tci/filter_lower_hz"] {
            let mut wrong=reply.clone(); *wrong.pointer_mut(path).unwrap()=Value::Null; assert!(!confirmed(&target,&wrong),"{path}");
        }
    }
    #[test]
    fn filter_admission_fences_selection_connection_freshness_and_transmit() {
        let now=1_800_000_000_000;
        let projection=json!({"available":true,"provider":"direct_tci","selection_id":"saved","selection_generation":2,"received_at_ms":now,
            "snapshot":{"source":"direct_tci","generation":7,"transport_state":"ready","generated_at":now/1000,
                "radio":{"connected":true,"observed":true,"transmitting":false,"observed_at":now/1000},"station":{"radio_stale":false},
                "capabilities":{"supported_commands":["station_receive_filter"]},"tci":{"filter_scope":"trx","filter_lower_hz":-500,"filter_upper_hz":500}}});
        assert!(admission(&projection,&target(),now).is_ok());
        assert!(admission(&projection,&target(),now+5001).is_err());
        for path in ["/selection_id","/selection_generation","/snapshot/generation","/snapshot/transport_state","/snapshot/radio/transmitting",
            "/snapshot/capabilities/supported_commands","/snapshot/tci/filter_lower_hz"] {
            let mut wrong=projection.clone(); *wrong.pointer_mut(path).unwrap()=Value::Null; assert!(admission(&wrong,&target(),now).is_err(),"{path}");
        }
    }
}
