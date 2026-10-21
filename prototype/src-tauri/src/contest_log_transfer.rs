//! Narrow native boundary for the contest import/transfer utility window.
//! Legacy source paths stay here and are never returned to the renderer.
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;

pub const WINDOW: &str = "contest-log-transfer";
pub const MENU_ID: &str = "contest_log_transfer";

#[derive(Clone)]
struct LegacyLease {
    path: PathBuf,
    identity: String,
    digest: String,
}

#[derive(Default)]
pub struct LegacySourceLease(Mutex<Option<LegacyLease>>);

fn admit(label: &str) -> Result<(), String> {
    (label == WINDOW)
        .then_some(())
        .ok_or_else(|| "Import or Transfer Log is unavailable in this window.".into())
}

fn result(frame: Value) -> Result<Value, String> {
    if frame["ok"] == true {
        Ok(frame["result"].clone())
    } else {
        Err(frame["error"]["message"]
            .as_str()
            .unwrap_or("The contest operation failed.")
            .to_owned())
    }
}

fn import_uuid(digest: &str, contest_nr: u64, domain: u8) -> Result<String, String> {
    if digest.len() != 64 || !digest.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err("Legacy import identity is invalid.".into());
    }
    let mut bytes = [0_u8; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&digest[index * 2..index * 2 + 2], 16)
            .map_err(|_| "Legacy import identity is invalid.")?;
    }
    bytes[0] ^= domain;
    for (index, byte) in contest_nr.to_be_bytes().iter().enumerate() {
        bytes[index + 8] ^= byte;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(uuid::Uuid::from_bytes(bytes).to_string())
}

fn request(method: &str, params: Value, generation: u64) -> Result<Value, String> {
    result(crate::worker::request_existing_generation(
        json!({
            "id": uuid::Uuid::new_v4().to_string(), "method": method, "params": params,
        }),
        generation,
    )?)
}

fn validate_transfer(
    method: &str,
    params: &Value,
    context: &crate::contest_window_context::ContestWindowContext,
) -> Result<(), String> {
    if !matches!(
        method,
        "contest_log_transfer_prepare"
            | "contest_log_transfer_commit"
            | "contest_log_transfer_status"
    ) {
        return Err("Unknown contest log transfer method.".into());
    }
    let object = params
        .as_object()
        .ok_or("Invalid contest log transfer parameters.")?;
    let expected: &[&str] = if method == "contest_log_transfer_prepare" {
        &["sessionID", "workspaceGeneration", "expectedRevision"]
    } else if method == "contest_log_transfer_commit" {
        &[
            "sessionID",
            "workspaceGeneration",
            "expectedRevision",
            "manifestID",
        ]
    } else {
        &["sessionID", "workspaceGeneration", "manifestID"]
    };
    if object.len() != expected.len()
        || object.keys().any(|key| !expected.contains(&key.as_str()))
        || params["sessionID"] != context.session_id
        || params["workspaceGeneration"] != context.workspace_generation
    {
        return Err("Invalid or expired contest log transfer context.".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn choose_legacy_file(window: tauri::WebviewWindow) -> Result<Option<PathBuf>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::NSString;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window.run_on_main_thread(move || {
        let selected = MainThreadMarker::new()
            .ok_or("Legacy Not1MM chooser is unavailable.")
            .map(|main| {
                let panel = NSOpenPanel::openPanel(main);
                panel.setCanChooseFiles(true);
                panel.setCanChooseDirectories(false);
                panel.setAllowsMultipleSelection(false);
                panel.setCanCreateDirectories(false);
                panel.setMessage(Some(&NSString::from_str(
                    "Choose a legacy Not1MM SQLite database",
                )));
                if panel.runModal() == NSModalResponseOK {
                    panel.URL().and_then(|url| url.path()).map(|path| PathBuf::from(path.to_string()))
                } else { None }
            });
        let _ = sender.send(selected);
    }).map_err(|_| "Legacy Not1MM chooser is unavailable.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv()
        .map_err(|_| "Legacy Not1MM chooser closed unexpectedly.".to_string())?
        .map_err(str::to_string)).await
        .map_err(|_| "Legacy Not1MM chooser failed.".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn choose_legacy_file(_window: tauri::WebviewWindow) -> Result<Option<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new()
        .set_title("Choose a legacy Not1MM SQLite database")
        .add_filter("Not1MM SQLite", &["sqlite", "sqlite3", "db"])
        .set_can_create_directories(false).pick_file()).await
        .map_err(|_| "Legacy Not1MM chooser failed.".to_string())
}

#[tauri::command]
pub async fn contest_log_transfer_context(window: tauri::WebviewWindow) -> Result<Value, String> {
    admit(window.label())?;
    let generation = crate::worker::existing_generation()?;
    tauri::async_runtime::spawn_blocking(move || {
        let settings = request("settings_load", json!({}), generation)?;
        let workspace_generation = settings["generation"].as_str().ok_or("The xLog workspace identity is unavailable.")?;
        let Ok(context) = crate::contest_window_context::active() else {
            return Ok(json!({"workspaceGeneration":workspace_generation,
                "stationCall":settings["settings"]["stationCall"]}));
        };
        let projection = request("contest_draft_get", json!({"sessionID":context.session_id}), generation)?["projection"].clone();
        let page = request("contest_log_page", json!({"sessionID":context.session_id,"expectedRevision":projection["revision"],"offset":0,"limit":1}), generation)?;
        Ok(json!({"workspaceGeneration":context.workspace_generation,"stationCall":settings["settings"]["stationCall"],"sessionID":context.session_id,
            "expectedRevision":projection["revision"],"contestName":projection["pluginName"].as_str()
                .or_else(||projection["pluginID"].as_str()).unwrap_or("Active contest"),"qsoCount":page["total"]}))
    }).await.map_err(|_| "Contest transfer context task failed.".to_string())?
}

#[tauri::command]
pub async fn contest_log_transfer_request(
    window: tauri::WebviewWindow,
    method: String,
    params: Value,
) -> Result<Value, String> {
    admit(window.label())?;
    let context = crate::contest_window_context::active()?;
    validate_transfer(&method, &params, &context)?;
    let generation = crate::worker::existing_generation()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::contest_window_context::admit(&context)?;
        let value = request(&method, params, generation)?;
        crate::contest_window_context::admit(&context)?;
        Ok(value)
    })
    .await
    .map_err(|_| "Contest log transfer task failed.".to_string())?
}

#[tauri::command]
pub async fn contest_legacy_choose_preview(
    window: tauri::WebviewWindow,
    lease: tauri::State<'_, LegacySourceLease>,
) -> Result<Option<Value>, String> {
    admit(window.label())?;
    let generation = crate::worker::existing_generation()?;
    let app = window.app_handle().clone();
    let selected = choose_legacy_file(window).await?;
    let Some(path) = selected else {
        return Ok(None);
    };
    crate::worker::require_existing_generation(generation)?;
    if app.get_webview_window(WINDOW).is_none() {
        return Err("Legacy preview was cancelled because its window closed.".into());
    }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "sqlite" | "sqlite3" | "db") {
        return Err("Choose a Not1MM SQLite database (.sqlite, .sqlite3, or .db).".into());
    }
    let preview = tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        move || {
            request(
                "contest_legacy_preview",
                json!({"sourcePath":path.to_string_lossy()}),
                generation,
            )
        }
    })
    .await
    .map_err(|_| "Legacy Not1MM preview task failed.".to_string())??;
    crate::worker::require_existing_generation(generation)?;
    if app.get_webview_window(WINDOW).is_none() {
        return Err("Legacy preview was cancelled because its window closed.".into());
    }
    let identity = preview["source"]["identity"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("Legacy preview identity is invalid.")?;
    let digest = preview["source"]["digest"]
        .as_str()
        .filter(|value| value.len() == 64)
        .ok_or("Legacy preview digest is invalid.")?;
    *lease
        .0
        .lock()
        .map_err(|_| "Legacy preview lease is unavailable.")? = Some(LegacyLease {
        path,
        identity: identity.to_owned(),
        digest: digest.to_owned(),
    });
    Ok(Some(preview))
}

#[tauri::command]
pub async fn contest_legacy_import(
    window: tauri::WebviewWindow,
    params: Value,
    lease: tauri::State<'_, LegacySourceLease>,
) -> Result<Value, String> {
    admit(window.label())?;
    let mut public = params
        .as_object()
        .cloned()
        .ok_or("Invalid legacy contest import parameters.")?;
    if public.contains_key("sourcePath") {
        return Err("Legacy source paths are native-only.".into());
    }
    if public.contains_key("sessionID") || public.contains_key("operationID") {
        return Err("Legacy import retry identity is native-owned.".into());
    }
    let retained = lease
        .0
        .lock()
        .map_err(|_| "Legacy preview lease is unavailable.")?
        .clone()
        .ok_or("Choose and preview a legacy Not1MM database first.")?;
    if public.get("sourceIdentity").and_then(Value::as_str) != Some(retained.identity.as_str())
        || public.get("sourceDigest").and_then(Value::as_str) != Some(retained.digest.as_str())
    {
        return Err("The legacy preview changed; choose the database again.".into());
    }
    let contest_nr = public
        .get("sourceContestNR")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or("Legacy contest number is invalid.")?;
    public.insert(
        "sessionID".into(),
        Value::String(import_uuid(&retained.identity, contest_nr, 0x53)?),
    );
    public.insert(
        "operationID".into(),
        Value::String(import_uuid(&retained.digest, contest_nr, 0x4f)?),
    );
    public.insert(
        "sourcePath".into(),
        Value::String(retained.path.to_string_lossy().into_owned()),
    );
    let app = window.app_handle().clone();
    let module = crate::operating_module::owner()?.snapshot()?;
    let operation_id = uuid::Uuid::new_v4().to_string();
    let worker_params = Value::Object(public);
    let ticket = crate::contest_window_context::begin(&json!({
        "id": operation_id,
        "method": "contest_legacy_import",
        "operatingContext": module["context"],
        "params": worker_params,
    }))?;
    let generation = crate::worker::existing_generation()?;
    let frame = tauri::async_runtime::spawn_blocking(move || {
        crate::worker::request_existing_generation(json!({
            "id": operation_id,
            "method": "contest_legacy_import",
            "params": worker_params,
        }), generation)
    })
    .await
    .map_err(|_| "Legacy contest import task failed.".to_string())??;
    let value = result(frame.clone())?;
    let context = crate::contest_window_context::complete(ticket, &frame)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspace_window_runtime::contest_context_changed_and_refresh(&app, context)
    })
    .await
    .map_err(|_| "Contest window context task failed".to_string())??;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> crate::contest_window_context::ContestWindowContext {
        crate::contest_window_context::ContestWindowContext {
            operating_context: "10000000-0000-4000-8000-000000000001".into(),
            session_id: "20000000-0000-4000-8000-000000000001".into(),
            workspace_generation: "30000000-0000-4000-8000-000000000001".into(),
        }
    }
    #[test]
    fn transfer_route_allows_only_exact_stable_contracts() {
        let c = context();
        assert!(validate_transfer("contest_log_transfer_prepare",&json!({"sessionID":c.session_id,"workspaceGeneration":c.workspace_generation,"expectedRevision":7}),&c).is_ok());
        assert!(validate_transfer("contest_log_transfer_commit",&json!({"sessionID":c.session_id,"workspaceGeneration":c.workspace_generation,"expectedRevision":7,"manifestID":"40000000-0000-4000-8000-000000000001"}),&c).is_ok());
        assert!(validate_transfer("contest_log_transfer_status",&json!({"sessionID":c.session_id,"workspaceGeneration":c.workspace_generation,"manifestID":"40000000-0000-4000-8000-000000000001"}),&c).is_ok());
        assert!(validate_transfer("contest_log_transfer_commit",&json!({"sessionID":c.session_id,"workspaceGeneration":c.workspace_generation,"expectedRevision":7,"manifestID":"x","extra":true}),&c).is_err());
        assert!(validate_transfer("contest_log_page", &json!({}), &c).is_err());
    }
    #[test]
    fn only_the_dedicated_window_is_admitted() {
        assert!(admit(WINDOW).is_ok());
        for label in ["main", "contest-setup", "contest--logbook", ""] {
            assert!(admit(label).is_err());
        }
    }
    #[test]
    fn legacy_import_retry_ids_are_stable_and_scoped() {
        let digest = "0123456789abcdef".repeat(4);
        let first = import_uuid(&digest, 7, 0x53).unwrap();
        assert_eq!(first, import_uuid(&digest, 7, 0x53).unwrap());
        assert_ne!(first, import_uuid(&digest, 8, 0x53).unwrap());
        assert_ne!(first, import_uuid(&digest, 7, 0x4f).unwrap());
        assert!(uuid::Uuid::parse_str(&first).is_ok());
    }
}
