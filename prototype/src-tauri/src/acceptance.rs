//! Opt-in, synthetic packaged-webview acceptance. Never active in a normal launch.
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct Acceptance {
    pub path: Option<PathBuf>,
    large_log: bool,
    completed: AtomicBool,
    final_prepared: AtomicBool,
    monitor: Mutex<Option<Value>>,
    #[cfg(target_os = "linux")]
    browser_contexts: Mutex<Vec<tempfile::TempDir>>,
}

pub fn report_path(args: impl IntoIterator<Item = String>) -> Result<Option<PathBuf>, String> {
    let args: Vec<_> = args.into_iter().collect();
    let flags: Vec<_> = args.iter().enumerate().filter(|(_, a)| a.as_str() == "--acceptance-report").collect();
    let large_flags = args.iter().filter(|arg| arg.as_str() == "--acceptance-large-log").count();
    if large_flags > 1 || (flags.is_empty() && large_flags != 0) {
        return Err("Large-log acceptance requires one acceptance report and at most one fixture flag".into());
    }
    if flags.is_empty() { return Ok(None); }
    if flags.len() != 1 { return Err("Only one acceptance report is permitted".into()); }
    let path = PathBuf::from(args.get(flags[0].0 + 1).ok_or("Acceptance report path required")?);
    if !path.is_absolute() || path.extension().and_then(|x| x.to_str()) != Some("json") {
        return Err("Acceptance report must be an absolute .json path".into());
    }
    if path.exists() || !path.parent().is_some_and(|p| p.is_dir()) {
        return Err("Acceptance report must be a new file in an existing directory".into());
    }
    Ok(Some(path))
}

impl Acceptance {
    pub fn new(path: Option<PathBuf>) -> Self {
        let large_log = path.is_some() && std::env::args().any(|arg| arg == "--acceptance-large-log");
        Self { path, large_log, ..Self::default() }
    }
    fn require(&self) -> Result<(), String> {
        if self.path.is_none() { Err("Acceptance is disabled for normal application launches".into()) } else { Ok(()) }
    }
    /// Wry creates a new ephemeral GTK context for each incognito view, while
    /// Tauri deduplicates custom-scheme registration by data-directory key.
    /// Give each detached acceptance view its own key so `tauri://` and IPC
    /// are registered on that view too. Incognito remains enabled. Normal
    /// operator windows retain their existing shared persistent context.
    pub fn detached_browser_context(&self) -> Result<Option<PathBuf>, String> {
        #[cfg(target_os = "linux")]
        if self.path.is_some() {
            let directory = tempfile::Builder::new().prefix("xlog-acceptance-webview-")
                .tempdir().map_err(|error| error.to_string())?;
            let path = directory.path().to_path_buf();
            self.browser_contexts.lock().map_err(|_| "Acceptance contexts unavailable")?.push(directory);
            return Ok(Some(path));
        }
        Ok(None)
    }
    pub fn cleanup_browser_contexts(&self) {
        #[cfg(target_os = "linux")]
        if let Ok(mut contexts) = self.browser_contexts.lock() { contexts.clear(); }
    }
    fn save(&self, report: &Value) -> Result<(), String> {
        self.require()?;
        let bytes = serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?;
        if bytes.len() > 65_536 { return Err("Acceptance report exceeds limit".into()); }
        let mut file = OpenOptions::new().write(true).create_new(true)
            .open(self.path.as_ref().unwrap()).map_err(|e| e.to_string())?;
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())
    }
}

/// Apply before Tauri creates configured windows. Incognito selects an ephemeral
/// WKWebView/WebKitGTK data store and WebView2's InPrivate profile; never clear
/// the operator's persistent browser storage as part of a test.
pub fn isolate_browser_storage(config: &mut tauri::utils::config::Config, enabled: bool) {
    if enabled {
        for window in &mut config.app.windows {
            window.incognito = true;
            window.url = tauri::WebviewUrl::App("index.html?acceptance=local".into());
        }
        config.app.security.csp = Some(tauri::utils::config::Csp::Policy(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'".into()));
    }
}

fn bounded_object(report: &Value) -> Result<(), String> {
    if !report.is_object() || serde_json::to_vec(report).map_err(|e| e.to_string())?.len() > 60_000 {
        return Err("Expected a bounded acceptance object".into());
    }
    Ok(())
}

/// This gate precedes Rust's direct Hamlib/WinKeyer/rotor dispatch as well as
/// Swift routing. The worker independently enforces the same local-only scope.
pub fn validate_local_request(request: &Value) -> Result<(), String> {
    let allowed = matches!(request["method"].as_str(), Some(
        "health" | "parse_adif" | "self_test" | "integration_self_test" | "cluster_classify" | "cluster_history"
        | "workspace_status" | "workspace_create" | "workspace_preferences_load" | "workspace_preferences_save"
        | "settings_load" | "settings_save" | "logbook_draft" | "logbook_catalog" | "logbook_list"
        | "logbook_save" | "logbook_delete" | "logbook_undo" | "logbook_stats" | "logbook_previous"
        | "logbook_operator_draft" | "logbook_operator_draft_apply" | "logbook_operator_draft_receipt"
        | "logbook_contact" | "logbook_contact_apply" | "logbook_contact_receipt"
        | "logbook_matrix" | "logbook_import_adif" | "logbook_export_adif"
        | "backup_create" | "backup_list" | "backup_inspect" | "backup_restore"
    ));
    if !allowed || (request["method"] == "workspace_create" && request["params"]["mode"] != "empty") {
        return Err("Local acceptance cannot access external data, services, credentials or hardware.".into());
    }
    Ok(())
}

pub fn passed(report: &Value) -> bool {
    const REQUIRED: [&str; 17] = ["worker_health", "worker_self_test", "worker_parse_adif", "worker_integration_self_test", "cluster_classification_initial", "cluster_classification_logged", "map_loaded",
        "cluster_selection", "keyboard_log", "logbook_readback", "keyboard_focus", "keyboard_clear",
        "profile_manual", "profile_simulator", "monitor_opened", "monitor_snapshot", "final_desk"];
    const LOCAL: [&str; 19] = ["isolated_worker", "empty_workspace", "workspace_created", "worker_self_test",
        "worker_integration_self_test", "worker_parse_adif", "keyboard_log", "logbook_readback", "keyboard_editor",
        "keyboard_focus", "keyboard_clear", "settings_save_readback", "awards_loaded", "detached_projection",
        "map_loaded", "final_desk", "native_menu_routes", "contact_edit", "contact_delete_undo"];
    let required: &[&str] = if report["scope"] == "integrated-local-ui" { &LOCAL } else if report["scope"].is_null() { &REQUIRED } else { return false; };
    let map = &report["details"]["finalMap"];
    let probes = map["landPixelProbes"].as_u64().unwrap_or(0);
    report["status"] == "passed" && report["embeddedUi"] == true && report["worker"] == true
        && map["tilesLoaded"] == true && map["webgl"] == true && map["visible"] == true
        && map["error"] == "" && probes >= 8 && map["matchedLandPixels"].as_u64() == Some(probes)
        && map["capturedAt"].as_u64().is_some_and(|time| time > 0)
        && report["checks"].as_object().is_some_and(|checks|
            required.iter().all(|key| checks.get(*key) == Some(&Value::Bool(true)))
                && checks.values().all(|value| value == &Value::Bool(true)))
}

#[tauri::command]
pub fn acceptance_enabled(state: tauri::State<'_, Acceptance>) -> bool { state.path.is_some() }

#[tauri::command]
pub fn acceptance_large_log(state: tauri::State<'_, Acceptance>) -> bool { state.path.is_some() && state.large_log }

#[tauri::command]
pub fn acceptance_screen(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, screen: String) -> Result<(), String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the isolated main view may test menu navigation".into()); }
    crate::workspace_navigation::screen(&screen).ok_or("Unknown test screen")?;
    let id = format!("workspace_screen_{screen}");
    let menu = app.menu().ok_or("Native application menu is missing")?;
    let mut found = false;
    for item in menu.items().map_err(|error| error.to_string())? {
        if let Some(submenu) = item.as_submenu() {
            found |= submenu.items().map_err(|error| error.to_string())?.iter().any(|item| item.id().0 == id);
        }
    }
    if !found { return Err("Workspace route is absent from the actual native menu".into()); }
    // Exercise the production menu handler's navigation path. This verifies the
    // menu model/IPC/rendered route, not physical OS menu clicks or accelerators.
    crate::navigate_workspace(&app, &screen)
}

#[tauri::command]
pub fn acceptance_monitor(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, report: Value) -> Result<(), String> {
    state.require()?;
    if !matches!(window.label(), "monitor" | "band-maps") { return Err("Only a tested detached surface may report its readback".into()); }
    bounded_object(&report)?;
    *state.monitor.lock().map_err(|_| "Monitor evidence unavailable")? = Some(report);
    Ok(())
}

#[tauri::command]
pub fn acceptance_monitor_result(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> Result<Option<Value>, String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the main window may read acceptance evidence".into()); }
    Ok(state.monitor.lock().map_err(|_| "Monitor evidence unavailable")?.clone())
}

#[tauri::command]
pub async fn acceptance_prepare_final(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> Result<(), String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the main window may prepare final acceptance".into()); }
    if state.completed.load(Ordering::Acquire) { return Err("Acceptance already completed".into()); }
    for label in ["monitor", "band-maps", "world-map", "dx-cluster"] {
        if let Some(detached) = app.get_webview_window(label) { detached.close().map_err(|e| e.to_string())?; }
    }
    window.set_focus().map_err(|e| e.to_string())?;
    state.final_prepared.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn finish_acceptance(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, mut report: Value) -> Result<(), String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the main window may finish acceptance".into()); }
    bounded_object(&report)?;
    if state.completed.swap(true, Ordering::AcqRel) { return Err("Acceptance already completed".into()); }
    let prepared = state.final_prepared.load(Ordering::Acquire);
    let large_valid = !state.large_log || large_log_passed(&report);
    let success = prepared && passed(&report) && large_valid;
    report["large_log_requested"] = json!(state.large_log);
    if !prepared && report["error"].is_null() {
        report["error"] = json!("Final native window transition was not prepared");
    }
    report["schema"] = json!(1);
    report["platform"] = json!(std::env::consts::OS);
    report["arch"] = json!(std::env::consts::ARCH);
    report["status"] = json!(if success { "passed" } else { "failed" });
    report["station_io"] = json!(false);
    if let Err(error) = state.save(&report) { app.exit(1); return Err(error); }
    // Final UI evidence was collected after closing the monitor and focusing main.
    // Do not mutate window/map lifecycle after the accepted framebuffer evidence.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        app.exit(if success { 0 } else { 1 });
    });
    Ok(())
}

pub fn start_watchdog(app: tauri::AppHandle) {
    if app.state::<Acceptance>().path.is_none() { return; }
    let timeout_seconds = if app.state::<Acceptance>().large_log { 300 } else { 90 };
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(timeout_seconds));
        let state = app.state::<Acceptance>();
        if !state.completed.swap(true, Ordering::AcqRel) {
            let _ = state.save(&json!({"schema":1,"status":"failed","embeddedUi":false,"worker":false,
                "platform":std::env::consts::OS,"error":format!("Native UI acceptance exceeded {timeout_seconds} seconds"),"station_io":false}));
            app.exit(1);
        }
    });
}

fn large_log_passed(report: &Value) -> bool {
    let performance = &report["details"]["performance"];
    performance["fixture_records"] == 100_000 && performance["total_records"] == 100_002
        && ["large_log_records", "large_logbook_ready", "large_awards_ready", "large_history_ready", "large_final_desk"]
            .iter().all(|key| report["checks"][key] == true)
        && ["importMs", "logbookReadyMs", "awardsFirstOpenMs", "awardsRepeatOpenMs", "historyFirstMs", "historyRepeatMs", "historyRenderedMs"]
            .iter().all(|key| performance[key].as_f64().is_some_and(|value| value.is_finite() && value >= 0.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normal_windows_do_not_allocate_acceptance_contexts() {
        assert!(Acceptance::default().detached_browser_context().unwrap().is_none());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn detached_ephemeral_contexts_have_distinct_keys_and_owned_cleanup() {
        let state = Acceptance::new(Some(PathBuf::from("/tmp/unused-acceptance-report.json")));
        let first = state.detached_browser_context().unwrap().unwrap();
        let second = state.detached_browser_context().unwrap().unwrap();
        assert_ne!(first, second);
        assert!(first.is_dir() && second.is_dir());
        state.cleanup_browser_contexts();
        assert!(!first.exists() && !second.exists());
    }
    #[test]
    fn large_log_requires_explicit_native_gate_and_complete_measurements() {
        assert!(report_path(["app".into(), "--acceptance-large-log".into()]).is_err());
        assert!(!large_log_passed(&json!({})));
        let mut report = json!({"checks": {}, "details":{"performance": {
            "fixture_records":100_000, "total_records":100_002
        }}});
        for key in ["large_log_records", "large_logbook_ready", "large_awards_ready", "large_history_ready", "large_final_desk"] {
            report["checks"][key] = json!(true);
        }
        for key in ["importMs", "logbookReadyMs", "awardsFirstOpenMs", "awardsRepeatOpenMs", "historyFirstMs", "historyRepeatMs", "historyRenderedMs"] {
            report["details"]["performance"][key] = json!(1);
        }
        assert!(large_log_passed(&report));
        report["details"]["performance"]["total_records"] = json!(1);
        assert!(!large_log_passed(&report));
        report["details"]["performance"]["total_records"] = json!(100_002);
        report["details"]["performance"]["historyFirstMs"] = json!(-1);
        assert!(!large_log_passed(&report));
        report["details"]["performance"]["historyFirstMs"] = json!(1);
        report["checks"]["large_history_ready"] = json!(false);
        assert!(!large_log_passed(&report));
    }
    #[test]
    fn only_acceptance_windows_use_ephemeral_browser_storage() {
        let mut config: tauri::utils::config::Config = serde_json::from_value(json!({
            "identifier":"test.xlog.acceptance", "app":{"windows":[{"label":"main"},{"label":"other"}]}
        })).unwrap();
        isolate_browser_storage(&mut config, false);
        assert!(config.app.windows.iter().all(|window| !window.incognito));
        isolate_browser_storage(&mut config, true);
        assert!(config.app.windows.iter().all(|window| window.incognito));
        assert!(config.app.windows.iter().all(|window| window.url == tauri::WebviewUrl::App("index.html?acceptance=local".into())));
        assert!(!config.app.security.csp.unwrap().to_string().contains("https:"));
    }
    #[test]
    fn integrated_local_report_requires_real_workflow_checks_and_gpu_evidence() {
        let names = ["isolated_worker", "empty_workspace", "workspace_created", "worker_self_test",
            "worker_integration_self_test", "worker_parse_adif", "keyboard_log", "logbook_readback", "keyboard_editor",
            "keyboard_focus", "keyboard_clear", "settings_save_readback", "awards_loaded", "detached_projection",
            "map_loaded", "final_desk", "native_menu_routes", "contact_edit", "contact_delete_undo"];
        let checks: serde_json::Map<String, Value> = names.iter().map(|name| (name.to_string(), json!(true))).collect();
        let mut report = json!({"scope":"integrated-local-ui","status":"passed","embeddedUi":true,"worker":true,
            "checks":checks,"details":{"finalMap":{"tilesLoaded":true,"webgl":true,"visible":true,"error":"",
            "landPixelProbes":40,"matchedLandPixels":40,"capturedAt":1}}});
        assert!(passed(&report));
        for name in names {
            report["checks"][name] = json!(false);
            assert!(!passed(&report));
            report["checks"][name] = json!(true);
        }
        report["details"]["finalMap"]["matchedLandPixels"] = json!(39);
        assert!(!passed(&report));
    }
    #[test]
    fn local_acceptance_cannot_reach_native_hardware_or_external_sources() {
        for method in ["hamlib_connect", "hamlib_models", "winkeyer_connect", "winkeyer_send", "rotor_goto",
            "station_connect", "station_action", "cluster_connect", "reference_refresh", "backup_import", "future_service"] {
            assert!(validate_local_request(&json!({"method":method,"params":{}})).is_err());
        }
        assert!(validate_local_request(&json!({"method":"workspace_create","params":{"mode":"copy_native"}})).is_err());
        assert!(validate_local_request(&json!({"method":"workspace_create","params":{"mode":"empty"}})).is_ok());
        for method in ["health", "logbook_draft", "logbook_save", "logbook_list", "settings_save", "backup_create"] {
            assert!(validate_local_request(&json!({"method":method,"params":{}})).is_ok());
        }
    }
    #[test]
    fn normal_launch_has_no_acceptance() { assert!(report_path(vec!["app".into()]).unwrap().is_none()); }
    #[test]
    fn report_cli_rejects_missing_relative_and_duplicate_targets() {
        for args in [vec!["--acceptance-report"], vec!["--acceptance-report", "relative.json"],
            vec!["--acceptance-report", "a", "--acceptance-report", "b"]] {
            assert!(report_path(args.into_iter().map(str::to_owned)).is_err());
        }
    }
    #[test]
    fn success_requires_observed_ui_worker_and_multiple_boolean_checks() {
        let mut report = json!({"status":"passed","embeddedUi":true,"worker":true,"checks":{
            "worker_health":true,"worker_self_test":true,"worker_parse_adif":true,"worker_integration_self_test":true,"cluster_classification_initial":true,"cluster_classification_logged":true,"map_loaded":true,
            "cluster_selection":true,"keyboard_log":true,"logbook_readback":true,"keyboard_focus":true,
            "keyboard_clear":true,"profile_manual":true,"profile_simulator":true,"monitor_opened":true,
            "monitor_snapshot":true,"final_desk":true},"details":{"finalMap":{
                "tilesLoaded":true,"webgl":true,"visible":true,"error":"",
                "landPixelProbes":24,"matchedLandPixels":24,"capturedAt":1}}});
        assert!(passed(&report));
        report["details"]["finalMap"]["matchedLandPixels"] = json!(23); assert!(!passed(&report));
        report["details"]["finalMap"]["matchedLandPixels"] = json!(24);
        report["details"]["finalMap"]["tilesLoaded"] = json!(false); assert!(!passed(&report));
        report["details"]["finalMap"]["tilesLoaded"] = json!(true);
        report["checks"]["map_loaded"] = json!(false); assert!(!passed(&report));
        report["checks"]["map_loaded"] = json!("true"); assert!(!passed(&report));
        assert!(!passed(&json!({"status":"passed","embeddedUi":true,"worker":true,"checks":{}})));
    }
    #[test]
    fn evidence_payload_is_bounded() {
        assert!(bounded_object(&json!({"status":"failed"})).is_ok());
        assert!(bounded_object(&json!([])).is_err());
        assert!(bounded_object(&json!({"text":"x".repeat(60_001)})).is_err());
    }
}
