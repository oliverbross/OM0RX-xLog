//! Visual marker adapter over the existing durable manual-tune owner.
use serde_json::{json, Value};
use tauri::Emitter;

fn validate(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    let normal_map = !label.starts_with("contest--") && crate::workspace_windows::surface_role(label) == "band-maps";
    if isolated || exiting || !(label == "main" || normal_map) || !matches!(action, "snapshot" | "receipt" | "review" | "manual_tune") {
        return Err("This surface cannot tune a visual guide marker.".into());
    }
    Ok(())
}
fn active_target(requested: &str, active: &str) -> Result<(), String> {
    if requested == active { Ok(()) } else { Err("The active radio changed before marker tuning. No marker tune was sent.".into()) }
}
fn mode_admission(explicit: Option<&str>, requested: &str, observed: Option<&str>) -> Result<(), String> {
    if let Some(mode) = explicit {
        if !matches!(mode,"CW"|"USB"|"LSB"|"FM"|"AM") || mode != requested { return Err("Unsupported explicit guide-marker mode".into()); }
    } else if observed.map(|mode| mode.eq_ignore_ascii_case(requested)) != Some(true) {
        return Err("The selected radio mode changed. Inspect the personal marker again before tuning.".into());
    }
    Ok(())
}
pub async fn execute(app: tauri::AppHandle, label: String, isolated: bool, exiting: bool, mut params: Value) -> Result<Value, String> {
    let action = params["action"].as_str().unwrap_or("");
    validate(&label, isolated, exiting, action)?;
    let radio = params["radio_id"].as_str().ok_or("Missing guide marker radio slot")?.to_owned();
    crate::radio_slots::index(&radio)?;
    let owner = crate::station_session::owner_for(&app, &radio)?;
    if action == "snapshot" {
        if params.as_object().is_none_or(|p| p.len() != 2) { return Err("Invalid marker snapshot request".into()); }
        let mut value = owner.snapshot()?;
        value["active_radio"] = json!(crate::radio_slots::active(&app)?);
        value["manual_tune_receipt"] = owner.unresolved_receipt("manual_tune")?;
        value["selection"] = crate::station_selection::owner_for(&app,&radio)?.snapshot()?;
        value["radio"] = crate::station_telemetry::owner_for(&app,&radio)?.snapshot()?;
        value["worker_generation"] = json!(crate::worker::generation());
        return Ok(value);
    }
    if action == "receipt" {
        let value = owner.receipt(params["operation_id"].as_str().ok_or("Missing marker operation identity")?)?;
        if !value.is_null() && value["request"]["action"] != "manual_tune" { return Err("That receipt is not a tune operation".into()); }
        return Ok(value);
    }
    if action == "review" {
        if params["reviewed_action"] != "manual_tune" { return Err("Only tune receipts can be reviewed here".into()); }
        return owner.review(params["operation_id"].as_str().ok_or("Missing marker operation identity")?,"manual_tune");
    }
    let module = crate::operating_module::owner()?;
    let admission = module.admit_selected(crate::operating_module::OperatingModule::NormalLogging)?;
    active_target(&radio,&crate::radio_slots::active(&app)?)?;
    let selected = crate::station_selection::owner_for(&app,&radio)?;
    let before = selected.snapshot()?;
    let explicit = params.as_object_mut().and_then(|value| value.remove("guide_marker_mode")).unwrap_or(Value::Null);
    if !explicit.is_null() && !explicit.is_string() { return Err("Invalid guide marker mode".into()); }
    let app_clone = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _admission = admission;
        crate::radio_follow::marker_tune(&before, || owner.apply(&params, |request,generation,identity| {
            crate::manual_tune::execute_guide_marker_guarded(&app_clone,&params,request,generation,identity,
                || {
                    active_target(&radio,&crate::radio_slots::active(&app_clone)?)?;
                    let projection = crate::station_telemetry::owner_for(&app_clone,&radio)?.snapshot()?;
                    let mode = if params["provider"] == "hamlib" { projection["snapshot"]["fields"]["mode"]["Mode"].as_str() } else { projection["snapshot"]["radio"]["mode"].as_str() };
                    mode_admission(explicit.as_str(),params["mode"].as_str().ok_or("Missing marker mode")?,mode)
                })
        }), || selected.snapshot())
    }).await.map_err(|_| "Marker tune task failed".to_string())?;
    let _ = app.emit("xlog:station-session", json!({"guide_marker":true}));
    result
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn only_normal_map_marker_operations_and_current_active_slot_are_admitted() {
        for label in ["main","band-maps","band-map-20m"] { for action in ["snapshot","receipt","review","manual_tune"] { assert!(validate(label,false,false,action).is_ok()); } }
        for label in ["contest--band-maps","world-map","settings",""] { assert!(validate(label,false,false,"manual_tune").is_err()); }
        assert!(validate("main",true,false,"manual_tune").is_err());
        assert!(validate("main",false,true,"manual_tune").is_err());
        assert!(validate("main",false,false,"connect").is_err());
        assert!(active_target("radio1","radio2").is_err());
        assert!(active_target("radio2","radio2").is_ok());
        assert!(mode_admission(Some("CW"),"CW",Some("USB")).is_ok());
        assert!(mode_admission(None,"USB",Some("USB")).is_ok());
        assert!(mode_admission(None,"USB",Some("LSB")).is_err());
        assert!(mode_admission(Some("FT8"),"FT8",Some("FT8")).is_err());
    }
}
