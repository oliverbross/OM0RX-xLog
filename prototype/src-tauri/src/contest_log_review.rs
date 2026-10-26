//! On-demand review reads plus explicit, narrowly scoped callsign corrections.
use serde_json::{json, Value};
use tauri::Manager;

pub const WINDOW: &str = "contest-log-review";
pub const MENU_ID: &str = "contest_log_review";

fn request(method: &str, params: Value, generation: u64) -> Result<Value, String> {
    let frame = crate::worker::request_existing_generation(
        json!({"id":uuid::Uuid::new_v4().to_string(),"method":method,"params":params}), generation)?;
    if frame["ok"] == true { Ok(frame["result"].clone()) }
    else { Err(frame["error"]["message"].as_str().unwrap_or("Log Review could not read the source.").to_owned()) }
}

fn validate(label: &str, method: &str, params: &Value) -> Result<(), String> {
    if label != WINDOW { return Err("Open Contest → Log Review to review a log.".into()); }
    let keys: &[&str] = match method {
        "context" | "spot_history_status" => &[],
        "contest_log_page" => &["expectedRevision", "offset", "limit"],
        "spot_history_query" => &["from", "to", "limit", "cursor", "watermark"],
        "spot_history_detail" => &["id"],
        "reference_log_review" => &["contacts"],
        _ => return Err("Log Review only supports reading contest and spot records.".into()),
    };
    let object = params.as_object().ok_or("Invalid review parameters.")?;
    if object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err("Unexpected review parameters.".into());
    }
    if method == "contest_log_page" && (params["expectedRevision"].as_u64().is_none()
        || params["offset"].as_u64().is_none()
        || !params["limit"].as_u64().is_some_and(|value| (1..=100).contains(&value))) {
        return Err("Invalid review log page.".into());
    }
    if method == "reference_log_review" && !params["contacts"].as_array().is_some_and(|rows| (1..=100).contains(&rows.len())) {
        return Err("Invalid reference review batch.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn contest_log_review_read(window: tauri::WebviewWindow, method: String,
    params: Value, session_id: Option<String>, workspace_generation: Option<String>) -> Result<Value, String> {
    validate(window.label(), &method, &params)?;
    let context = crate::contest_window_context::active()?;
    if method != "context" && (session_id.as_deref() != Some(context.session_id.as_str())
        || workspace_generation.as_deref() != Some(context.workspace_generation.as_str())) {
        return Err("The active contest changed. Run a new review.".into());
    }
    let generation = crate::worker::existing_generation()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::contest_window_context::admit(&context)?;
        let value = if method == "context" {
            let page = request("contest_log_page", json!({"sessionID":context.session_id,"offset":0,"limit":100}), generation)?;
            json!({"sessionID":context.session_id,"workspaceGeneration":context.workspace_generation,
                "revision":page["revision"],"total":page["total"],"rows":page["rows"]})
        } else {
            let mut params = params;
            if method == "contest_log_page" { params["sessionID"] = json!(context.session_id); }
            request(&method, params, generation)?
        };
        crate::contest_window_context::admit(&context)?;
        Ok(value)
    }).await.map_err(|_| "Log Review read task failed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_review_window_and_read_methods_are_admitted() {
        assert!(validate(WINDOW,"context",&json!({})).is_ok());
        assert!(validate(WINDOW,"contest_log_page",&json!({"expectedRevision":1,"offset":0,"limit":100})).is_ok());
        for method in ["contest_log_edit", "contest_log_delete", "contest_log_import_adif", "radio_tune", "settings_save"] {
            assert!(validate(WINDOW,method,&json!({})).is_err());
        }
        assert!(validate("main","context",&json!({})).is_err());
        assert!(validate(WINDOW,"contest_log_page",&json!({"sessionID":"other","offset":0,"limit":100})).is_err());
        assert!(validate(WINDOW,"contest_log_page",&json!({"expectedRevision":1,"offset":0,"limit":1000})).is_err());
    }
}

#[tauri::command]
pub async fn contest_log_review_open_log(window: tauri::WebviewWindow,
    session_id: String, workspace_generation: String, qso_id: String, callsign: String) -> Result<(), String> {
    validate(window.label(), "context", &json!({}))?;
    let context = crate::contest_window_context::resolve(&session_id, &workspace_generation)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        review_action(&context, "log_focus", json!({"qsoID":qso_id,"callsign":callsign}), uuid::Uuid::new_v4().to_string())?;
        crate::workspace_window_runtime::contest_open(&app, context, "logbook")
    }).await.map_err(|_| "Could not open Contest Log Display.".to_string())?
}

// The review window cannot submit arbitrary surface actions. These commands
// construct the only two admitted intents and retain native context/receipt fences.
fn review_action(context: &crate::contest_window_context::ContestWindowContext,
    action: &str, params: Value, request_id: String) -> Result<(), String> {
    let label="contest--logbook";
    let snapshot=crate::contest_surface::snapshot(label, context)?;
    if snapshot["projection"]["status"] != "ready" { return Err("The contest log is not ready. Open Log Display and try again.".into()); }
    let envelope=json!({"operatingContext":context.operating_context,"scope":"contesting",
        "sessionID":context.session_id,"workspaceGeneration":context.workspace_generation,"panelID":"logbook",
        "projectionRevision":snapshot["projectionRevision"],"requestID":request_id,"action":action,"params":params});
    crate::contest_surface::submit(label, envelope, false)?;
    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(15);
    loop {
        let current=crate::contest_surface::snapshot(label,context)?;
        if let Some(receipt)=current["receipts"].as_array().and_then(|rows|rows.iter().find(|row|row["requestID"]==request_id)) {
            match receipt["status"].as_str() {
                Some("applied")=>return Ok(()),
                Some("rejected")=>return Err(receipt["message"].as_str().unwrap_or("The review action was rejected. Run review again.").into()),
                _=>{}
            }
        }
        if std::time::Instant::now()>=deadline { return Err("The review action is still pending. Check Log Display and run review again before retrying.".into()); }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
}

#[tauri::command]
pub async fn contest_log_review_correct_call(window: tauri::WebviewWindow,
    session_id:String, workspace_generation:String, qso_id:String, expected_revision:u64,
    expected_call:String, callsign:String, request_id:String) -> Result<(),String> {
    validate(window.label(),"context",&json!({}))?;
    let context=crate::contest_window_context::resolve(&session_id,&workspace_generation)?;
    tauri::async_runtime::spawn_blocking(move || review_action(&context,"log_correct_call",
        json!({"qsoID":qso_id,"expectedSessionRevision":expected_revision,"expectedCall":expected_call,"callsign":callsign}),request_id))
        .await.map_err(|_|"The callsign correction could not complete. Run review again.".to_string())?
}
