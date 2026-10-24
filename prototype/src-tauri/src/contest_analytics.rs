//! Analytics can copy and page contest records; it has no station or log-write API.
use serde_json::{json, Value};

pub const WINDOW: &str = "contest-analytics";
pub const MENU_ID: &str = "contest_analytics";

fn validate(label: &str, params: &Value) -> Result<(), String> {
    if label != WINDOW { return Err("Open Contest → Analytics to analyze the active contest.".into()); }
    let object = params.as_object().ok_or("Invalid analytics parameters.")?;
    let keys: &[&str] = match params["action"].as_str() {
        Some("prepare") => &["action"],
        Some("page") => &["action", "snapshotID", "offset", "limit"],
        Some("check" | "release") => &["action", "snapshotID"],
        _ => return Err("Unsupported analytics read.".into()),
    };
    if object.len() != keys.len() || object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err("Unexpected analytics parameters.".into());
    }
    if params["action"] != "prepare" && !params["snapshotID"].as_str().is_some_and(|id| uuid::Uuid::parse_str(id).is_ok()) {
        return Err("Invalid analytics snapshot.".into());
    }
    if params["action"] == "page" && (!params["offset"].as_u64().is_some_and(|v| v <= 50_000)
        || !params["limit"].as_u64().is_some_and(|v| (1..=500).contains(&v))) {
        return Err("Invalid analytics page.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn contest_analytics_read(window: tauri::WebviewWindow, params: Value,
    session_id: Option<String>, workspace_generation: Option<String>) -> Result<Value, String> {
    validate(window.label(), &params)?;
    let context = crate::contest_window_context::active()?;
    if params["action"] != "prepare" && (session_id.as_deref() != Some(context.session_id.as_str())
        || workspace_generation.as_deref() != Some(context.workspace_generation.as_str())) {
        return Err("The active contest changed. Refresh analytics.".into());
    }
    let generation = crate::worker::existing_generation()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::contest_window_context::admit(&context)?;
        let mut params = params;
        params["sessionID"] = json!(context.session_id);
        params["workspaceGeneration"] = json!(context.workspace_generation);
        let frame = crate::worker::request_existing_generation(
            json!({"id":uuid::Uuid::new_v4().to_string(),"method":"contest_analytics","params":params}), generation)?;
        crate::contest_window_context::admit(&context)?;
        if frame["ok"] == true { Ok(frame["result"].clone()) }
        else { Err(frame["error"]["message"].as_str().unwrap_or("Analytics could not read the contest. Refresh to retry.").to_owned()) }
    }).await.map_err(|_| "Analytics read task failed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn analytics_only_accepts_its_own_bounded_copy_reads() {
        assert!(validate(WINDOW, &json!({"action":"prepare"})).is_ok());
        let id = uuid::Uuid::new_v4().to_string();
        assert!(validate(WINDOW, &json!({"action":"page","snapshotID":id,"offset":0,"limit":500})).is_ok());
        assert!(validate("main", &json!({"action":"prepare"})).is_err());
        for action in ["contest_qso_commit", "radio_tune", "delete", "sql"] {
            assert!(validate(WINDOW, &json!({"action":action})).is_err());
        }
        assert!(validate(WINDOW, &json!({"action":"prepare","sessionID":"other"})).is_err());
        assert!(validate(WINDOW, &json!({"action":"page","snapshotID":id,"offset":0,"limit":501})).is_err());
    }
}
