//! Analytics can copy and page contest records; it has no station or log-write API.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const WINDOW: &str = "contest-analytics";
pub const MENU_ID: &str = "contest_analytics";
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
static EXPORT_PENDING: AtomicBool = AtomicBool::new(false);

fn validate_export(label: &str, filename: &str, content: &str) -> Result<&'static str, String> {
    if label != WINDOW { return Err("Only Analytics can export an analytical report.".into()); }
    if filename.is_empty() || filename.len() > 128
        || !filename.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')) {
        return Err("Use a simple JSON or CSV report filename.".into());
    }
    let extension = match Path::new(filename).extension().and_then(|value| value.to_str()) {
        Some("json") => "json", Some("csv") => "csv",
        _ => return Err("Analytics exports must be JSON or CSV files.".into()),
    };
    if content.is_empty() || content.len() > MAX_EXPORT_BYTES || content.contains('\0') {
        return Err("The Analytics export must contain between 1 byte and 64 MiB of text.".into());
    }
    if extension == "json" && serde_json::from_str::<Value>(content).is_err() {
        return Err("The Analytics report is not valid JSON.".into());
    }
    Ok(extension)
}

struct ExportLease;
impl ExportLease {
    fn acquire() -> Result<Self, String> {
        EXPORT_PENDING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self).map_err(|_| "An Analytics export is already open.".to_string())
    }
}
impl Drop for ExportLease {
    fn drop(&mut self) { EXPORT_PENDING.store(false, Ordering::Release); }
}

fn save_export(path: Option<PathBuf>, extension: &str, content: &str) -> Result<Value, String> {
    use std::io::Write;
    let Some(path) = path else { return Ok(json!({"saved":false,"cancelled":true})); };
    if !path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case(extension)) {
        return Err(format!("Choose a .{extension} file for this Analytics export."));
    }
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.file_type().is_file() => return Err("Choose a regular report file, not a folder or link.".into()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err("The selected report destination is unavailable.".into()),
        _ => {}
    }
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing export directory")?)?;
        temporary.write_all(content.as_bytes())?;
        temporary.as_file().sync_all()?;
        temporary.persist(&path)?;
        Ok(())
    };
    write().map_err(|_| "The Analytics report could not be saved. Choose another destination and retry.".to_string())?;
    Ok(json!({"saved":true,"cancelled":false}))
}

#[cfg(target_os = "macos")]
async fn choose_export(window: tauri::WebviewWindow, filename: String, _extension: &str) -> Result<Option<PathBuf>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window.run_on_main_thread(move || {
        let selected = if crate::APP_EXITING.load(Ordering::Acquire) { Err("Analytics export is unavailable during shutdown.") }
        else { MainThreadMarker::new().ok_or("Analytics export chooser is unavailable.").map(|main| {
            let panel = NSSavePanel::savePanel(main);
            panel.setNameFieldStringValue(&NSString::from_str(&filename));
            panel.setMessage(Some(&NSString::from_str("Save the displayed analytical copy. The contest log remains unchanged.")));
            if panel.runModal() == NSModalResponseOK {
                panel.URL().and_then(|url| url.path()).map(|path| PathBuf::from(path.to_string()))
            } else { None }
        }) };
        let _ = sender.send(selected);
    }).map_err(|_| "Analytics export chooser is unavailable.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv()
        .map_err(|_| "Analytics export chooser closed unexpectedly.".to_string())?.map_err(str::to_string))
        .await.map_err(|_| "Analytics export chooser is unavailable.".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn choose_export(_window: tauri::WebviewWindow, filename: String, extension: &str) -> Result<Option<PathBuf>, String> {
    let extension = extension.to_owned();
    tauri::async_runtime::spawn_blocking(move || rfd::FileDialog::new()
        .set_title("Save Analytics report").set_file_name(filename)
        .add_filter("Analytics report", &[extension]).save_file())
        .await.map_err(|_| "Analytics export chooser is unavailable.".to_string())
}

#[tauri::command]
pub async fn contest_analytics_export(window: tauri::WebviewWindow, filename: String, content: String) -> Result<Value, String> {
    let extension = validate_export(window.label(), &filename, &content)?;
    if crate::APP_EXITING.load(Ordering::Acquire) { return Err("Analytics export is unavailable during shutdown.".into()); }
    let _lease = ExportLease::acquire()?;
    let path = choose_export(window, filename, extension).await?;
    tauri::async_runtime::spawn_blocking(move || {
        if crate::APP_EXITING.load(Ordering::Acquire) { return Err("Analytics export is unavailable during shutdown.".into()); }
        save_export(path, extension, &content)
    }).await.map_err(|_| "Analytics export task failed.".to_string())?
}

fn dispatch_print(label: &str, exiting: bool, print: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    if label != WINDOW { return Err("Only Analytics can print the analytical view.".into()); }
    if exiting { return Err("Analytics printing is unavailable during shutdown.".into()); }
    print()
}

#[tauri::command]
pub async fn contest_analytics_print(window: tauri::WebviewWindow) -> Result<(), String> {
    // WKWebView does not present a dialog for JavaScript window.print(). Tauri's
    // native print API dispatches the WKWebView NSPrintOperation on macOS.
    // Its return value confirms dispatch, not printing or PDF save completion.
    dispatch_print(window.label(), crate::APP_EXITING.load(Ordering::Acquire), ||
        window.print().map_err(|_| "The Analytics print dialog could not be opened.".to_string()))
}

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
    fn analytics_print_is_window_scoped_and_preserves_dispatch_errors() {
        use std::cell::Cell;
        let calls = Cell::new(0);
        let print = || { calls.set(calls.get() + 1); Ok(()) };
        for label in ["main", "contest-setup", "contest-log-review", "unknown"] {
            assert!(dispatch_print(label, false, print).is_err());
        }
        assert!(dispatch_print(WINDOW, true, print).is_err());
        assert_eq!(calls.get(), 0);
        dispatch_print(WINDOW, false, print).unwrap();
        assert_eq!(calls.get(), 1);
        assert_eq!(dispatch_print(WINDOW, false, || Err("print failed".into())).unwrap_err(), "print failed");
    }

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

    #[test]
    fn analytics_export_validates_window_text_and_file_type() {
        assert_eq!(validate_export(WINDOW, "xlog-report.json", "{\"rows\":[]}").unwrap(), "json");
        assert_eq!(validate_export(WINDOW, "xlog-contacts.csv", "Call,UTC\r\nOM0RX,2026-10-25").unwrap(), "csv");
        assert!(validate_export("main", "xlog.json", "{}").is_err());
        for name in ["../report.json", "/tmp/report.json", "report.sqlite", "report.json/evil", "report\\evil.csv"] {
            assert!(validate_export(WINDOW, name, "{}").is_err(), "{name}");
        }
        for content in ["", "invalid JSON", "{}\0"] { assert!(validate_export(WINDOW, "report.json", content).is_err()); }
        assert!(validate_export(WINDOW, "report.csv", &"x".repeat(MAX_EXPORT_BYTES + 1)).is_err());
    }

    #[test]
    fn analytics_export_cancellation_atomic_replace_and_failure_preserve_other_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("report.json");
        assert_eq!(save_export(None, "json", "{}").unwrap(), json!({"saved":false,"cancelled":true}));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
        std::fs::write(&path, "old report").unwrap();
        assert_eq!(save_export(Some(path.clone()), "json", "{\"rows\":[]}").unwrap(), json!({"saved":true,"cancelled":false}));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"rows\":[]}");
        // Never append an extension after the chooser: that could overwrite a
        // different existing file without the native overwrite confirmation.
        assert!(save_export(Some(directory.path().join("report")), "json", "{}").is_err());
        assert!(save_export(Some(directory.path().join("contest.sqlite")), "json", "{}").is_err());
        assert!(save_export(Some(directory.path().join("missing/report.json")), "json", "{}").is_err());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        #[cfg(unix)] {
            let link = directory.path().join("linked.json");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(save_export(Some(link), "json", "{}").is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"rows\":[]}");
        }
    }

    #[test]
    fn analytics_export_has_one_dialog_owner_and_releases_after_completion() {
        let lease = ExportLease::acquire().unwrap();
        assert!(ExportLease::acquire().is_err());
        drop(lease);
        assert!(ExportLease::acquire().is_ok());
    }
}
