//! Cheap retained station state. Optional map metadata never blocks this path.
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicU64, Ordering}, OnceLock};

static REVISION: AtomicU64 = AtomicU64::new(0);
static EPOCH: OnceLock<String> = OnceLock::new();
pub fn validate(label: &str, isolated: bool) -> Result<(), String> {
    if isolated || label != "monitor" { return Err("Station Monitor context is unavailable in this window.".into()); }
    Ok(())
}
pub fn read(label: &str, isolated: bool, live: impl FnOnce() -> Result<Value, String>, synthetic: impl FnOnce() -> Result<Value, String>) -> Result<Value, String> {
    validate(label, false)?;
    if isolated { synthetic() } else { live() }
}

pub fn acceptance_snapshot() -> Result<Value, String> {
    if !crate::worker::local_acceptance() { return Err("Synthetic monitor context requires native isolation.".into()); }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Monitor clock unavailable")?.as_millis() as u64;
    Ok(json!({"epoch":"00000000-0000-4000-8000-000000000001","revision":now,
        "acceptance":{"synthetic":true,"source":"synthetic_memory","externalOwners":false,"readOnly":true},
        "selection":{"provider":"direct_flex_lan","generation":0,"selection_id":"00000000-0000-4000-8000-000000000002"},
        "radio":{"revision":now,"available":true,"provider":"direct_flex_lan","received_at_ms":now,
            "selection_id":"00000000-0000-4000-8000-000000000002","selection_generation":0,
            "snapshot":{"source":"direct_flex_lan","generated_at":now as f64 / 1000.0,"allow_transmit":false,
                "radio":{"connected":true,"observed":true,"frequency_hz":14074000,"mode":"USB","receive_vfo":"A","transmit_vfo":"A","transmitting":false,
                    "vfos":[{"letter":"A","frequency_hz":14074000}]},"capabilities":{"supported_commands":[]}}},
        "rotor":{"revision":0,"available":false,"snapshot":null}}))
}

fn unavailable() -> Value { json!({"available":false,"snapshot":null}) }

fn retained(
    selection: impl Fn() -> Result<Value, String>,
    radio: impl FnOnce() -> Result<Value, String>,
    rotor: impl FnOnce() -> Result<Value, String>,
) -> Value {
    let before = selection();
    let radio = radio();
    let after = selection();
    // A busy/changing radio never removes independent rotor state or Stop.
    let coherent = before.as_ref().ok().zip(after.as_ref().ok()).is_some_and(|(before, after)|
        ["provider", "generation", "selection_id"].iter().all(|key| before[*key] == after[*key]));
    let selection = after.ok().unwrap_or(Value::Null);
    let radio = radio.ok().filter(|radio| coherent && selection["provider"].is_string()
        && radio["provider"] == selection["provider"] && radio["selection_id"] == selection["selection_id"]
        && radio["selection_generation"] == selection["generation"]).unwrap_or_else(unavailable);
    json!({"selection":selection,"radio":radio,"rotor":rotor().unwrap_or_else(|_| unavailable())})
}

pub fn snapshot(app: &tauri::AppHandle) -> Result<Value, String> {
    let selection = crate::station_selection::owner(app);
    let mut value = retained(|| selection.as_ref().map_err(Clone::clone).and_then(|owner| owner.snapshot()),
        || crate::station_telemetry::owner(app)?.snapshot(),
        || crate::rotor_telemetry::owner(app)?.snapshot());
    let revision = REVISION.fetch_update(Ordering::AcqRel, Ordering::Acquire,
        |value| value.checked_add(1).filter(|next| *next <= 9_007_199_254_740_991))
        .map_err(|_| "Monitor context revision exhausted.")?;
    value["epoch"] = json!(EPOCH.get_or_init(|| uuid::Uuid::new_v4().to_string()));
    value["revision"] = json!(revision);
    Ok(value)
}

/// Native admission is deliberately narrow; source policy still validates the
/// action, and the selection owner atomically checks this captured identity.
pub fn action_request(provider: &str, action: &str) -> Result<Value, String> {
    if !matches!(provider, "direct_agent" | "direct_flex_lan")
        || !matches!(action, "operate" | "standby" | "tune" | "cancel")
        || provider == "direct_flex_lan" && !matches!(action, "tune" | "cancel") {
        return Err("This Station Monitor action is unavailable.".into());
    }
    Ok(json!({"id":uuid::Uuid::new_v4().to_string(),"method":"station_action",
        "params":{"provider":provider,"action":action}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn choice(generation: u64) -> Value { json!({"provider":"direct_agent","generation":generation,"selection_id":format!("selection-{generation}")}) }
    fn radio() -> Value { json!({"provider":"direct_agent","selection_id":"selection-1","selection_generation":1,"available":true,"received_at_ms":42,"snapshot":{"source":"direct_agent"}}) }
    fn rotor() -> Value { json!({"available":true,"received_at_ms":20,"snapshot":{"owner":"hamlib","generation":4,"state":"active"}}) }
    #[test]
    fn role_and_isolation_are_checked_before_owner_access() {
        assert!(validate("monitor", false).is_ok()); assert!(validate("monitor", true).is_err());
        for label in ["main", "log-qso", "world-map", "band-maps", "callsign-intelligence", "unknown", ""] { assert!(validate(label, false).is_err()); }
    }
    #[test]
    fn isolated_reads_cannot_call_production_owners_and_wrong_roles_call_neither() {
        let value = read("monitor", true, || panic!("production owner reached"), || Ok(json!({"synthetic":true}))).unwrap();
        assert_eq!(value["synthetic"], true);
        assert!(read("main", true, || panic!("live"), || panic!("synthetic")).is_err());
        assert!(acceptance_snapshot().is_err());
        assert!(validate("monitor", true).is_err());
    }
    #[test]
    fn retained_reads_preserve_original_timestamps_and_do_not_select_or_control() {
        let value = retained(|| Ok(choice(1)), || Ok(radio()), || Ok(rotor()));
        assert_eq!(value["radio"], radio()); assert_eq!(value["rotor"], rotor());
        assert_eq!(value["selection"], choice(1));
    }
    #[test]
    fn busy_unset_or_changed_selection_cannot_hide_independent_rotor() {
        let busy = retained(|| Err("busy".into()), || Ok(radio()), || Ok(rotor()));
        assert_eq!(busy["radio"]["available"], false); assert_eq!(busy["rotor"], rotor());
        let unset = retained(|| Ok(json!({"provider":null,"generation":0,"selection_id":null})), || Ok(radio()), || Ok(rotor()));
        assert_eq!(unset["radio"]["snapshot"], Value::Null);
        let sequence = AtomicU64::new(1);
        let changed = retained(|| Ok(choice(sequence.fetch_add(1, Ordering::AcqRel))), || Ok(radio()), || Ok(rotor()));
        assert_eq!(changed["radio"]["available"], false); assert_eq!(changed["rotor"], rotor());
    }
    #[test]
    fn provider_mismatch_and_independent_failures_fail_closed_per_source() {
        let value = retained(|| Ok(json!({"provider":"hamlib","generation":1,"selection_id":"b"})), || Ok(radio()), || Err("failed".into()));
        assert_eq!(value["radio"]["available"], false); assert_eq!(value["rotor"]["available"], false);
    }
    #[test]
    fn stable_same_provider_with_old_selection_radio_is_unavailable() {
        let value = retained(|| Ok(choice(3)), || Ok(radio()), || Ok(rotor()));
        assert_eq!(value["selection"], choice(3)); assert_eq!(value["radio"]["available"], false);
        assert_eq!(value["rotor"], rotor());
    }
    #[test]
    fn action_scope_cannot_choose_a_provider_or_send_other_commands() {
        for provider in ["direct_agent", "direct_flex_lan", "hamlib", "", "xcat_loopback"] {
            for action in ["operate", "standby", "tune", "cancel", "connect", "disconnect", "ptt", "rotor_goto", ""] {
                let allowed = provider == "direct_agent" && ["operate", "standby", "tune", "cancel"].contains(&action)
                    || provider == "direct_flex_lan" && ["tune", "cancel"].contains(&action);
                assert_eq!(action_request(provider, action).is_ok(), allowed, "{provider}:{action}");
            }
        }
    }
}
