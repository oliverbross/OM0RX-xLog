//! Closed display-only aggregation of existing retained native observations.
//! No owner initialization, worker request, timer, persistence or control.
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicU64, Ordering}, OnceLock};
static REVISION: AtomicU64 = AtomicU64::new(0);
static EPOCH: OnceLock<String> = OnceLock::new();
pub fn validate(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if label != "alerts" || isolated || exiting { return Err("Retained alerts are unavailable in this window.".into()); }
    Ok(())
}
fn aggregate(station: Result<Value, String>, rotor: Result<Value, String>) -> Value {
    let station = station.unwrap_or(Value::Null);
    let rotor = rotor.unwrap_or(Value::Null);
    let radio = &station["radio"];
    let selection = &station["selection"];
    let coherent = matches!(selection["provider"].as_str(), Some("direct_agent" | "direct_flex_lan" | "hamlib"))
        && radio["provider"] == selection["provider"] && radio["selection_id"] == selection["selection_id"]
        && radio["selection_generation"] == selection["generation"];
    let mut items = Vec::new();
    // Only the Agent currently supplies a modeled station safety report. Never
    // turn missing FLEX/Hamlib safety fields into an all-clear claim.
    let safety = &radio["snapshot"]["station"];
    let radio_report = coherent && selection["provider"] == "direct_agent" && safety.is_object();
    if radio_report {
        let count = safety["inhibitors"].as_array().map(|items| items.iter().filter(|item| item.as_str().is_some_and(|text| !text.trim().is_empty())).count().min(10_000)).unwrap_or(0);
        if count > 0 { items.push(json!({"code":"radio_inhibitors","count":count})); }
        // The backend models this as "ALARM clear", "ALARM unknown" or
        // "ALARM <count>". Non-empty text alone is not an alarm.
        if let Some(count) = safety["alarm_summary"].as_str().and_then(|text| text.strip_prefix("ALARM "))
            .and_then(|count| count.parse::<u64>().ok()).filter(|count| *count > 0) {
            items.push(json!({"code":"radio_alarm","count":count.min(10_000)}));
        }
    }
    let rotor_report = rotor["snapshot"]["state"].as_str().is_some_and(|state| matches!(state, "active" | "uncertain" | "disconnected"));
    if rotor_report && rotor["snapshot"]["state"] == "uncertain" {
        items.push(json!({"code":"rotor_uncertain","count":1}));
    }
    // Do not project free-form backend text, configuration, routes or identity.
    json!({"radio_report":radio_report,"rotor_report":rotor_report,"items":items})
}
pub fn snapshot() -> Result<Value, String> {
    let mut value = aggregate(crate::monitor_context::status_snapshot(), crate::rotor_telemetry::retained_snapshot());
    let revision = REVISION.fetch_update(Ordering::AcqRel, Ordering::Acquire,
        |value| value.checked_add(1).filter(|next| *next <= 9_007_199_254_740_991)).map_err(|_| "Alerts revision exhausted.")?;
    value["epoch"] = json!(EPOCH.get_or_init(|| uuid::Uuid::new_v4().to_string()));
    value["revision"] = json!(revision);
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn station() -> Value { json!({"selection":{"provider":"direct_agent","generation":2,"selection_id":"selected"},
        "radio":{"provider":"direct_agent","selection_generation":2,"selection_id":"selected","available":false,
            "snapshot":{"station":{"inhibitors":["private route details",null,""],"alarm_summary":"ALARM 2"},"secret":"not projected"}}}) }
    #[test]
    fn closed_retained_aggregation_exposes_codes_not_worker_text_or_control() {
        let value = aggregate(Ok(station()), Ok(json!({"available":false,"snapshot":{"state":"uncertain","error":"private"}})));
        assert_eq!(value["items"], json!([{"code":"radio_inhibitors","count":1},{"code":"radio_alarm","count":2},{"code":"rotor_uncertain","count":1}]));
        assert!(!value.to_string().contains("private")); assert_eq!(value.as_object().unwrap().len(), 3);
    }
    #[test]
    fn changed_selection_unknown_sources_and_unmodeled_providers_never_claim_all_clear() {
        let mut changed = station(); changed["selection"]["generation"] = json!(3);
        for station in [changed, Value::Null, json!({"selection":{"provider":"hamlib"},"radio":{"snapshot":{"station":{}}}})] {
            let value = aggregate(Ok(station), Err("unavailable".into()));
            assert_eq!(value["radio_report"], false); assert_eq!(value["rotor_report"], false); assert_eq!(value["items"], json!([]));
        }
    }
    #[test]
    fn clear_unknown_and_unmodeled_alarm_text_are_not_active_alarm_counts() {
        for summary in ["ALARM clear", "ALARM unknown", "ALARM 0", "private device details"] {
            let mut value = station(); value["radio"]["snapshot"]["station"]["inhibitors"] = json!([]);
            value["radio"]["snapshot"]["station"]["alarm_summary"] = json!(summary);
            assert_eq!(aggregate(Ok(value), Ok(Value::Null))["items"], json!([]));
        }
    }
    #[test]
    fn narrow_passive_admission_never_initializes_a_source() {
        assert!(validate("alerts", false, false).is_ok());
        assert!(validate("alerts", true, false).is_err()); assert!(validate("alerts", false, true).is_err());
        for role in ["main", "monitor", "station-status", "station-control", "unknown"] { assert!(validate(role, false, false).is_err()); }
        let value = snapshot().unwrap(); assert_eq!(value["items"], json!([]));
    }
}
