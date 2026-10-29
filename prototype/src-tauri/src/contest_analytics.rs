//! Analytics can copy and page contest records; it has no station or log-write API.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const WINDOW: &str = "contest-analytics";
pub const MENU_ID: &str = "contest_analytics";
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const MAX_LOGBOOK_EXPORT_BYTES: usize = 32 * 1024 * 1024;
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

fn validate_logbook_export(label: &str, filename: &str, content: &str) -> Result<&'static str, String> {
    if !matches!(label, "main" | "logbook") { return Err("Only the integrated Logbook can export ADIF files.".into()); }
    if filename.is_empty() || filename.len() > 128
        || !filename.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')) {
        return Err("Use a simple ADI or ADX filename.".into());
    }
    let extension = match Path::new(filename).extension().and_then(|value| value.to_str()) {
        Some("adi") => "adi", Some("adx") => "adx",
        _ => return Err("Logbook exports must be ADI or ADX files.".into()),
    };
    if content.is_empty() || content.len() > MAX_LOGBOOK_EXPORT_BYTES || content.contains('\0') {
        return Err("The Logbook export must contain between 1 byte and 32 MiB of text.".into());
    }
    Ok(extension)
}

struct ExportLease;
impl ExportLease {
    fn acquire() -> Result<Self, String> {
        EXPORT_PENDING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self).map_err(|_| "An export is already open.".to_string())
    }
}
impl Drop for ExportLease {
    fn drop(&mut self) { EXPORT_PENDING.store(false, Ordering::Release); }
}

fn save_export(path: Option<PathBuf>, extension: &str, content: &str) -> Result<Value, String> {
    use std::io::Write;
    let Some(path) = path else { return Ok(json!({"saved":false,"cancelled":true})); };
    if !path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case(extension)) {
        return Err(format!("Choose a .{extension} file for this export."));
    }
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.file_type().is_file() => return Err("Choose a regular export file, not a folder or link.".into()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err("The selected export destination is unavailable.".into()),
        _ => {}
    }
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing export directory")?)?;
        temporary.write_all(content.as_bytes())?;
        temporary.as_file().sync_all()?;
        temporary.persist(&path)?;
        Ok(())
    };
    write().map_err(|_| "The export could not be saved. Choose another destination and retry.".to_string())?;
    Ok(json!({"saved":true,"cancelled":false}))
}

#[cfg(target_os = "macos")]
async fn choose_export(window: tauri::WebviewWindow, filename: String, _extension: &str, purpose: &'static str) -> Result<Option<PathBuf>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window.run_on_main_thread(move || {
        let selected = if crate::APP_EXITING.load(Ordering::Acquire) { Err("Export is unavailable during shutdown.") }
        else { MainThreadMarker::new().ok_or("Export chooser is unavailable.").map(|main| {
            let panel = NSSavePanel::savePanel(main);
            panel.setNameFieldStringValue(&NSString::from_str(&filename));
            panel.setMessage(Some(&NSString::from_str(purpose)));
            if panel.runModal() == NSModalResponseOK {
                panel.URL().and_then(|url| url.path()).map(|path| PathBuf::from(path.to_string()))
            } else { None }
        }) };
        let _ = sender.send(selected);
    }).map_err(|_| "Export chooser is unavailable.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv()
        .map_err(|_| "Export chooser closed unexpectedly.".to_string())?.map_err(str::to_string))
        .await.map_err(|_| "Export chooser is unavailable.".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn choose_export(_window: tauri::WebviewWindow, filename: String, extension: &str, purpose: &'static str) -> Result<Option<PathBuf>, String> {
    let extension = extension.to_owned();
    tauri::async_runtime::spawn_blocking(move || rfd::FileDialog::new()
        .set_title(purpose).set_file_name(filename)
        .add_filter("Export file", &[extension]).save_file())
        .await.map_err(|_| "Export chooser is unavailable.".to_string())
}

#[tauri::command]
pub async fn contest_analytics_export(window: tauri::WebviewWindow, filename: String, content: String) -> Result<Value, String> {
    let extension = validate_export(window.label(), &filename, &content)?;
    if crate::APP_EXITING.load(Ordering::Acquire) { return Err("Analytics export is unavailable during shutdown.".into()); }
    let _lease = ExportLease::acquire()?;
    let path = choose_export(window, filename, extension, "Save the displayed analytical copy. The contest log remains unchanged.").await?;
    tauri::async_runtime::spawn_blocking(move || {
        if crate::APP_EXITING.load(Ordering::Acquire) { return Err("Analytics export is unavailable during shutdown.".into()); }
        save_export(path, extension, &content)
    }).await.map_err(|_| "Analytics export task failed.".to_string())?
}

#[tauri::command]
pub async fn logbook_export_file(window: tauri::WebviewWindow, filename: String, content: String) -> Result<Value, String> {
    let extension = validate_logbook_export(window.label(), &filename, &content)?;
    if crate::APP_EXITING.load(Ordering::Acquire) { return Err("Logbook export is unavailable during shutdown.".into()); }
    let _lease = ExportLease::acquire()?;
    let path = choose_export(window, filename, extension, "Save the prepared ADIF copy. The integrated logbook remains unchanged.").await?;
    tauri::async_runtime::spawn_blocking(move || {
        if crate::APP_EXITING.load(Ordering::Acquire) { return Err("Logbook export is unavailable during shutdown.".into()); }
        save_export(path, extension, &content)
    }).await.map_err(|_| "Logbook export task failed.".to_string())?
}

fn validate_messages_export(label: &str, filename: &str, content: &str) -> Result<(), String> {
    if label != "contest-setup" { return Err("Only Contest Setup owns message bank exports.".into()); }
    if filename != "messages-not1mm.txt" || content.is_empty() || content.len() > 65536 || content.contains('\0') {
        return Err("Choose a bounded Not1MM message bank text export.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn contest_messages_export(window: tauri::WebviewWindow, filename: String, content: String) -> Result<Value, String> {
    validate_messages_export(window.label(), &filename, &content)?;
    if crate::APP_EXITING.load(Ordering::Acquire) { return Err("Message export is unavailable during shutdown.".into()); }
    let _lease = ExportLease::acquire()?;
    let path = choose_export(window, filename, "txt", "Export the reviewed Not1MM message bank. This does not save or activate it.").await?;
    tauri::async_runtime::spawn_blocking(move || save_export(path, "txt", &content))
        .await.map_err(|_| "Message export failed.".to_string())?
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
    fn logbook_export_accepts_only_normal_logbook_owners_and_bounded_adif_text() {
        let adi = "<CALL:5>OM0RX<COMMENT:7>Žilina<EOR>";
        for label in ["main", "logbook"] {
            assert_eq!(validate_logbook_export(label, "OM0RX-xLog-integrated-2026-10-29.adi", adi).unwrap(), "adi");
            assert_eq!(validate_logbook_export(label, "xlog.adx", "<ADX><HEADER/><RECORDS/></ADX>").unwrap(), "adx");
        }
        for label in [WINDOW, "contest--logbook", "contest--active-qso", "contest-setup", "settings", "unknown", ""] {
            assert!(validate_logbook_export(label, "xlog.adi", adi).is_err(), "{label}");
        }
        for filename in ["", "../xlog.adi", "/tmp/xlog.adx", "xlog\\evil.adi", "xlog.adi/other", "xlog.json", "xlog.csv", "xlog.sqlite", "xlog.adi ", "Žilina.adi"] {
            assert!(validate_logbook_export("main", filename, adi).is_err(), "{filename}");
        }
        assert!(validate_logbook_export("main", &format!("{}.adi", "x".repeat(124)), adi).is_ok());
        assert!(validate_logbook_export("main", &format!("{}.adi", "x".repeat(125)), adi).is_err());
        for content in ["", "<EOR>\0"] { assert!(validate_logbook_export("main", "xlog.adi", content).is_err()); }
        assert!(validate_logbook_export("main", "xlog.adi", &"x".repeat(MAX_LOGBOOK_EXPORT_BYTES)).is_ok());
        assert!(validate_logbook_export("main", "xlog.adi", &"x".repeat(MAX_LOGBOOK_EXPORT_BYTES + 1)).is_err());
        assert!(validate_logbook_export("main", "xlog.adx", &"é".repeat(MAX_LOGBOOK_EXPORT_BYTES / 2 + 1)).is_err());
    }

    #[test]
    fn logbook_export_reuses_cancelled_and_atomic_utf8_persistence_without_changing_other_files() {
        let directory = tempfile::tempdir().unwrap();
        let unrelated = directory.path().join("station.sqlite");
        std::fs::write(&unrelated, "station sentinel").unwrap();
        for (extension, content) in [("adi", "<CALL:5>OM0RX<COMMENT:7>Žilina<EOR>"), ("adx", "<ADX><HEADER/><RECORDS><RECORD><COMMENT>Žilina</COMMENT></RECORD></RECORDS></ADX>")] {
            assert_eq!(save_export(None, extension, content).unwrap(), json!({"saved":false,"cancelled":true}));
            let path = directory.path().join(format!("export.{extension}"));
            std::fs::write(&path, "old export").unwrap();
            assert_eq!(save_export(Some(path.clone()), extension, content).unwrap(), json!({"saved":true,"cancelled":false}));
            assert_eq!(std::fs::read(&path).unwrap(), content.as_bytes());
            assert!(save_export(Some(unrelated.clone()), extension, content).is_err());
            assert!(save_export(Some(directory.path().join(format!("missing/export.{extension}"))), extension, content).is_err());
            assert_eq!(std::fs::read_to_string(&unrelated).unwrap(), "station sentinel");
            assert_eq!(std::fs::read(&path).unwrap(), content.as_bytes());
        }
    }

    #[test]
    fn message_export_is_setup_owned_bounded_text_without_activation() {
        assert!(validate_messages_export("contest-setup", "messages-not1mm.txt", "R|F1|CQ|CQ {MYCALL}").is_ok());
        for label in [WINDOW, "main", "contest--active-qso"] {
            assert!(validate_messages_export(label, "messages-not1mm.txt", "text").is_err());
        }
        for (filename, content) in [("../messages-not1mm.txt", "text"), ("messages-not1mm.txt", ""), ("messages-not1mm.txt", "text\0")] {
            assert!(validate_messages_export("contest-setup", filename, content).is_err());
        }
        assert!(validate_messages_export("contest-setup", "messages-not1mm.txt", &"x".repeat(65537)).is_err());
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
