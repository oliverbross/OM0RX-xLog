//! Opt-in, synthetic packaged-webview acceptance. Never active in a normal launch.
use serde_json::{json, Value};
use std::collections::HashMap;
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
    logbook: Mutex<Option<Value>>,
    awards: Mutex<Option<Value>>,
    spot_history: Mutex<Option<Value>>,
    spot_parent_report: Mutex<Option<Value>>,
    spot_absence: Mutex<Option<crate::detached_acceptance::SpotHistoryAbsence>>,
    window_steps: Mutex<crate::detached_acceptance::Steps>,
    renderer_gates: Mutex<HashMap<String, bool>>,
    desk_original_size: Mutex<Option<tauri::PhysicalSize<u32>>>,
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
    pub(crate) fn require(&self) -> Result<(), String> {
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
        // The single-instance plugin derives its macOS socket from this value.
        // Never let an isolated candidate contact, claim or clean the live app's
        // singleton, even when launched from a renamed copy of the same bundle.
        config.identifier = format!("com.oliverbross.xlog.acceptance.r{}", uuid::Uuid::new_v4().simple());
        for window in &mut config.app.windows {
            window.incognito = true;
            window.url = tauri::WebviewUrl::App("index.html?acceptance=local".into());
        }
        config.app.security.csp = Some(tauri::utils::config::Csp::Policy(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'".into()));
    }
}

/// Only the already validated native CLI gate may disable singleton ownership.
/// A renderer URL, environment variable or failed report parse cannot opt out.
pub fn use_production_singleton(isolated: bool) -> bool { !isolated }

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
        | "workspace_rotor_configuration_load" | "workspace_rotor_configuration_receipt" | "workspace_rotor_configuration_save"
        | "workspace_layout_load" | "workspace_layout_apply"
        | "workspace_map_context" | "workspace_band_map_apply"
        // Swift validates bounded filters/IDs against the generated private
        // archive; these methods cannot select a database or admit recordings.
        | "spot_history_status" | "spot_history_query" | "spot_history_stats" | "spot_history_detail"
        | "settings_load" | "settings_receipt" | "settings_save" | "logbook_draft" | "logbook_catalog" | "logbook_list"
        | "logbook_save" | "logbook_delete" | "logbook_undo" | "logbook_stats" | "logbook_previous" | "logbook_duplicate"
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
    const LOCAL: [&str; 32] = ["isolated_worker", "empty_workspace", "workspace_created", "workspace_layout_roundtrip", "workspace_canvas_controls", "workspace_settings_presets", "workspace_native_windows", "spot_history_archive", "worker_self_test",
        "worker_integration_self_test", "worker_parse_adif", "keyboard_log", "logbook_readback", "keyboard_editor",
        "keyboard_focus", "keyboard_clear", "desk_map_logbook", "settings_save_readback", "awards_loaded", "detached_projection",
        "map_loaded", "final_desk", "native_menu_routes", "contact_edit", "contact_delete_undo", "detached_logbook", "detached_awards",
        "detached_logbook_lifecycle", "detached_awards_lifecycle", "detached_spot_history", "spot_history_main_absent", "spot_history_dock_recovery"];
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
pub fn acceptance_enabled(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> bool {
    let enabled = state.path.is_some();
    if let Ok(mut gates) = state.renderer_gates.lock() {
        gates.insert(window.label().to_owned(), enabled);
    }
    enabled
}

#[tauri::command]
pub fn acceptance_large_log(state: tauri::State<'_, Acceptance>) -> bool { state.path.is_some() && state.large_log }

fn require_desk_size(state: &Acceptance, caller: &str, action: &str) -> Result<(), String> {
    state.require()?;
    if caller != "main" || !matches!(action, "expand" | "restore") {
        return Err("Only the isolated main view may use fixed Desk acceptance sizing".into());
    }
    Ok(())
}

// Fixed isolated fixture geometry only, not a general renderer window-size API.
// Synchronous command runs on the UI thread; restore uses original physical
// pixels so scale conversion cannot accumulate a different operator size.
#[tauri::command]
pub fn acceptance_desk_size(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, action: String) -> Result<Value, String> {
    require_desk_size(&state, window.label(), &action)?;
    let mut original = state.desk_original_size.lock().map_err(|_| "Desk acceptance sizing unavailable")?;
    if action == "expand" {
        if original.is_some() { return Err("Desk acceptance sizing is already active".into()); }
        *original = Some(window.inner_size().map_err(|error| error.to_string())?);
        window.set_size(tauri::LogicalSize::new(1440.0, 1400.0)).map_err(|error| error.to_string())?;
    } else {
        let size = original.as_ref().ok_or("Desk acceptance sizing was not started")?;
        window.set_size(*size).map_err(|error| error.to_string())?;
        *original = None;
    }
    let size = window.inner_size().map_err(|error| error.to_string())?;
    Ok(json!({"action":action,"width":size.width,"height":size.height,"scale":window.scale_factor().map_err(|error| error.to_string())?}))
}

#[tauri::command]
pub async fn acceptance_screen(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, screen: String) -> Result<(), String> {
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
    crate::navigate_workspace(app, screen).await
}

#[tauri::command]
pub async fn acceptance_open_window(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, kind: String) -> Result<(), String> {
    require_window_coordinator(&state, window.label(), &kind)?;
    let id = format!("workspace_window_{kind}");
    let menu = app.menu().ok_or("Native application menu is missing")?;
    let mut found = false;
    for item in menu.items().map_err(|error| error.to_string())? {
        if let Some(submenu) = item.as_submenu() {
            found |= submenu.items().map_err(|error| error.to_string())?.iter().any(|item| item.id().0 == id);
        }
    }
    if !found { return Err("Window is absent from the actual native menu".into()); }
    crate::open_detached_workspace(app, kind).await
}

fn require_window_coordinator(state: &Acceptance, caller: &str, kind: &str) -> Result<(), String> {
    state.require()?;
    if caller != "main" || !crate::detached_acceptance::valid_kind(kind) {
        return Err("Only the isolated main view may test known windows".into());
    }
    Ok(())
}

#[tauri::command]
pub fn acceptance_window_step(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, kind: Option<String>, action: Option<String>) -> Result<Option<crate::detached_acceptance::Step>, String> {
    state.require()?;
    state.window_steps.lock().map_err(|_| "Test window steps unavailable")?
        .access(window.label(), kind.as_deref(), action.as_deref())
}

#[tauri::command]
pub fn acceptance_close_window(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, kind: String) -> Result<(), String> {
    require_window_coordinator(&state, window.label(), &kind)?;
    if app.get_webview_window(&kind).is_none() {
        return Err("The tested detached window is not open".into());
    }
    // Return the main renderer's IPC acknowledgement before tearing down the
    // child WebView. WebKit can otherwise wait for the child page while the
    // caller waits for this command, even though the native window is gone.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(50));
        let close_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(target) = close_app.get_webview_window(&kind) {
                let _ = target.destroy();
            }
        });
    });
    Ok(())
}

#[tauri::command]
pub fn acceptance_window_state(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, kind: String) -> Result<Value, String> {
    require_window_coordinator(&state, window.label(), &kind)?;
    let slot = match kind.as_str() { "awards" => &state.awards, "spot-history" => &state.spot_history, _ => &state.logbook };
    let report = slot.lock().map_err(|_| "Detached evidence unavailable")?.clone();
    let gate_seen = state.renderer_gates.lock().map_err(|_| "Renderer gate evidence unavailable")?
        .get(&kind).copied();
    let (open, visible, minimized, url) = if let Some(target) = app.get_webview_window(&kind) {
        (true, target.is_visible().map_err(|error| error.to_string())?,
            target.is_minimized().map_err(|error| error.to_string())?,
            Some(target.url().map_err(|error| error.to_string())?.to_string()))
    } else { (false, false, false, None) };
    Ok(json!({"open":open,"visible":visible,"minimized":minimized,"url":url,"gate_seen":gate_seen,"report":report}))
}

#[tauri::command]
pub fn acceptance_monitor(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, report: Value) -> Result<(), String> {
    state.require()?;
    if !matches!(window.label(), "monitor" | "band-maps" | "logbook" | "awards" | "spot-history") { return Err("Only a tested detached surface may report its readback".into()); }
    bounded_object(&report)?;
    if window.label() == "spot-history" && report["status"] == "passed" {
        let mut proof = state.spot_absence.lock().map_err(|_| "Archive lifecycle unavailable")?;
        if let Some(proof) = proof.as_mut() {
            proof.observe_read(report["details"]["instanceID"].as_str().unwrap_or(""),
                report["details"]["phaseRevision"].as_u64().unwrap_or(0),
                window.app_handle().get_webview_window("main").is_some(),
                report["checks"]["archive_read"] == true && report["checks"]["main_absent"] == true)?;
        }
    }
    let destination = match window.label() { "logbook" => &state.logbook, "awards" => &state.awards, "spot-history" => &state.spot_history, _ => &state.monitor };
    *destination.lock().map_err(|_| "Detached evidence unavailable")? = Some(report);
    Ok(())
}

#[tauri::command]
pub fn acceptance_spot_history_begin(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, report: Value) -> Result<(), String> {
    require_window_coordinator(&state, window.label(), "spot-history")?;
    bounded_object(&report)?;
    let initial = state.spot_history.lock().map_err(|_| "Archive evidence unavailable")?.clone().ok_or("Archive renderer is not ready")?;
    if initial["status"] != "passed" || initial["checks"]["archive_read"] != true || app.get_webview_window("spot-history").is_none() {
        return Err("Archive renderer has not verified its private fixture".into());
    }
    let mut proof = state.spot_absence.lock().map_err(|_| "Archive lifecycle unavailable")?;
    if proof.is_some() { return Err("Archive absence lifecycle was already armed".into()); }
    let step = state.window_steps.lock().map_err(|_| "Window steps unavailable")?
        .access("main", Some("spot-history"), Some("main_absent"))?.ok_or("Archive lifecycle step unavailable")?;
    let next = crate::detached_acceptance::SpotHistoryAbsence::new(initial["details"]["instanceID"].as_str().unwrap_or(""), step.revision)?;
    *state.spot_parent_report.lock().map_err(|_| "Acceptance coordinator unavailable")? = Some(report);
    *proof = Some(next); drop(proof);
    state.final_prepared.store(false, Ordering::Release);
    // Exact, acceptance-only target. Hidden/minimized is not a main-absent proof.
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn acceptance_spot_history_state(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> Result<Value, String> {
    state.require()?;
    if !matches!(window.label(), "main" | "spot-history") { return Err("Only archive lifecycle participants may inspect this phase".into()); }
    let proof = state.spot_absence.lock().map_err(|_| "Archive lifecycle unavailable")?;
    let Some(proof) = proof.as_ref() else { return Ok(json!({"active":false})); };
    let main_open = app.get_webview_window("main").is_some();
    let child_open = app.get_webview_window("spot-history").is_some();
    let report = if window.label() == "main" { state.spot_parent_report.lock().map_err(|_| "Acceptance coordinator unavailable")?.clone() } else { None };
    let child_report = if window.label() == "main" { state.spot_history.lock().map_err(|_| "Archive evidence unavailable")?.clone() } else { None };
    Ok(json!({"active":true,"main_open":main_open,"child_open":child_open,"read_proved":proof.read_proved,
        "revision":proof.revision,"ready":proof.recovered(main_open, child_open),"report":report,"child_report":child_report}))
}

#[tauri::command]
pub fn acceptance_monitor_result(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> Result<Option<Value>, String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the main window may read acceptance evidence".into()); }
    Ok(state.monitor.lock().map_err(|_| "Monitor evidence unavailable")?.clone())
}

#[tauri::command]
pub fn acceptance_logbook_result(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> Result<Option<Value>, String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the main window may read acceptance evidence".into()); }
    Ok(state.logbook.lock().map_err(|_| "Logbook evidence unavailable")?.clone())
}

#[tauri::command]
pub fn acceptance_awards_result(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> Result<Option<Value>, String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the main window may read acceptance evidence".into()); }
    Ok(state.awards.lock().map_err(|_| "Awards evidence unavailable")?.clone())
}

#[tauri::command]
pub async fn acceptance_prepare_final(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>) -> Result<(), String> {
    state.require()?;
    if window.label() != "main" { return Err("Only the main window may prepare final acceptance".into()); }
    if state.completed.load(Ordering::Acquire) { return Err("Acceptance already completed".into()); }
    for spec in crate::workspace_windows::SUPPORTED_WINDOWS {
        if let Some(detached) = app.get_webview_window(spec.id) { detached.close().map_err(|e| e.to_string())?; }
    }
    // Close listeners may defer destruction. A close request alone is not proof
    // that the tested detached window actually completed its lifecycle.
    let observed = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..100 {
            if crate::workspace_windows::SUPPORTED_WINDOWS.iter()
                .all(|spec| observed.get_webview_window(spec.id).is_none()) { return Ok(()); }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        Err("A detached acceptance window did not close".to_string())
    }).await.map_err(|_| "Detached close verification failed".to_string())??;
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
    let archive_ready = state.spot_absence.lock().ok().is_some_and(|proof| proof.as_ref().is_some_and(|proof|
        proof.recovered(app.get_webview_window("main").is_some(), app.get_webview_window("spot-history").is_some())));
    let success = prepared && passed(&report) && large_valid && (report["scope"] != "integrated-local-ui" || archive_ready);
    report["acceptance_namespace"] = json!(app.config().identifier);
    report["production_singleton"] = json!(false);
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
            let open_windows: Vec<_> = app.webview_windows().keys().cloned().collect();
            let logbook_reported = state.logbook.lock().ok().is_some_and(|value| value.is_some());
            let awards_reported = state.awards.lock().ok().is_some_and(|value| value.is_some());
            let monitor_reported = state.monitor.lock().ok().is_some_and(|value| value.is_some());
            let spot_history_reported = state.spot_history.lock().ok().is_some_and(|value| value.is_some());
            let _ = state.save(&json!({"schema":1,"status":"failed","embeddedUi":false,"worker":false,
                "platform":std::env::consts::OS,"error":format!("Native UI acceptance exceeded {timeout_seconds} seconds"),
                "station_io":false,"details":{"open_windows":open_windows,"logbook_reported":logbook_reported,
                    "awards_reported":awards_reported,"monitor_reported":monitor_reported,
                    "spot_history_reported":spot_history_reported}}));
            app.exit(1);
        }
    });
}

fn large_log_passed(report: &Value) -> bool {
    let performance = &report["details"]["performance"];
    performance["fixture_records"] == 100_000 && performance["total_records"] == 100_002
        && ["large_log_records", "large_logbook_ready", "large_awards_ready", "large_history_ready", "large_navigation_ready", "large_final_desk"]
            .iter().all(|key| report["checks"][key] == true)
        && ["appUiMountMs", "operatorReadyMs", "importMs", "logbookReadyMs", "awardsFirstOpenMs", "awardsRepeatOpenMs", "historyFirstMs", "historyRepeatMs", "historyRenderedMs"]
            .iter().all(|key| performance[key].as_f64().is_some_and(|value| value.is_finite() && value >= 0.0))
        && ["Logbook", "DX Cluster", "Band Maps", "Awards", "Settings", "Operator Desk"].iter().all(|route|
            performance["navigationMs"][route].as_array().is_some_and(|samples|
                samples.len() == 5 && samples.iter().all(|sample| sample.as_f64().is_some_and(|value| value.is_finite() && value >= 0.0))))
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
        for key in ["large_log_records", "large_logbook_ready", "large_awards_ready", "large_history_ready", "large_navigation_ready", "large_final_desk"] {
            report["checks"][key] = json!(true);
        }
        for key in ["appUiMountMs", "operatorReadyMs", "importMs", "logbookReadyMs", "awardsFirstOpenMs", "awardsRepeatOpenMs", "historyFirstMs", "historyRepeatMs", "historyRenderedMs"] {
            report["details"]["performance"][key] = json!(1);
        }
        for route in ["Logbook", "DX Cluster", "Band Maps", "Awards", "Settings", "Operator Desk"] {
            report["details"]["performance"]["navigationMs"][route] = json!([1, 1, 1, 1, 1]);
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
        assert_eq!(config.identifier, "test.xlog.acceptance");
        assert!(use_production_singleton(false));
        assert!(config.app.windows.iter().all(|window| !window.incognito));
        isolate_browser_storage(&mut config, true);
        assert_ne!(config.identifier, "test.xlog.acceptance");
        assert!(config.identifier.starts_with("com.oliverbross.xlog.acceptance.r"));
        assert!(!use_production_singleton(true));
        assert!(config.app.windows.iter().all(|window| window.incognito));
        assert!(config.app.windows.iter().all(|window| window.url == tauri::WebviewUrl::App("index.html?acceptance=local".into())));
        assert!(!config.app.security.csp.unwrap().to_string().contains("https:"));
    }
    #[test]
    fn isolated_runs_have_distinct_singleton_and_application_namespaces() {
        let mut first: tauri::utils::config::Config = serde_json::from_value(json!({"identifier":"com.oliverbross.xlog.integration"})).unwrap();
        let mut second = first.clone();
        isolate_browser_storage(&mut first, true);
        isolate_browser_storage(&mut second, true);
        assert_ne!(first.identifier, second.identifier);
        assert_ne!(first.identifier.replace(['.', '-'], "_"), "com_oliverbross_xlog_integration");
    }
    #[test]
    fn integrated_local_report_requires_real_workflow_checks_and_gpu_evidence() {
        let names = ["isolated_worker", "empty_workspace", "workspace_created", "workspace_layout_roundtrip", "workspace_canvas_controls", "workspace_settings_presets", "workspace_native_windows", "spot_history_archive", "worker_self_test",
            "worker_integration_self_test", "worker_parse_adif", "keyboard_log", "logbook_readback", "keyboard_editor",
            "keyboard_focus", "keyboard_clear", "desk_map_logbook", "settings_save_readback", "awards_loaded", "detached_projection",
            "map_loaded", "final_desk", "native_menu_routes", "contact_edit", "contact_delete_undo", "detached_logbook", "detached_awards",
            "detached_logbook_lifecycle", "detached_awards_lifecycle", "detached_spot_history", "spot_history_main_absent", "spot_history_dock_recovery"];
        let checks: serde_json::Map<String, Value> = names.iter().map(|name| (name.to_string(), json!(true))).collect();
        let mut report = json!({"scope":"integrated-local-ui","status":"passed","embeddedUi":true,"worker":true,
            "checks":checks,"details":{"finalMap":{"tilesLoaded":true,"webgl":true,"visible":true,"error":"",
            "landPixelProbes":40,"matchedLandPixels":40,"capturedAt":1}}});
        assert!(passed(&report));
        for name in names {
            let check = report["checks"].as_object_mut().unwrap().remove(name).unwrap();
            assert!(!passed(&report), "Missing required check: {name}");
            report["checks"][name] = check;
            report["checks"][name] = json!(false);
            assert!(!passed(&report));
            report["checks"][name] = json!(true);
        }
        report["details"]["finalMap"]["matchedLandPixels"] = json!(39);
        assert!(!passed(&report));
    }
    #[test]
    fn desk_acceptance_sizing_is_exact_isolated_main_only() {
        let enabled = Acceptance::new(Some(PathBuf::from("/tmp/private-acceptance.json")));
        for action in ["expand", "restore"] {
            assert!(require_desk_size(&enabled, "main", action).is_ok());
            assert!(require_desk_size(&Acceptance::default(), "main", action).is_err());
            for child in ["logbook", "log-qso", "world-map", "monitor", "unknown"] {
                assert!(require_desk_size(&enabled, child, action).is_err());
            }
        }
        for action in ["", "1440x1400", "resize", "Expand"] {
            assert!(require_desk_size(&enabled, "main", action).is_err());
        }
    }
    #[test]
    fn local_acceptance_allows_only_read_only_spot_history_methods() {
        for (method, params) in [
            ("spot_history_status", json!({})),
            ("spot_history_query", json!({"limit":100})),
            ("spot_history_stats", json!({"call":"TESTH0"})),
            ("spot_history_detail", json!({"id":"12345678-1234-1234-1234-123456789abc"})),
        ] {
            assert!(validate_local_request(&json!({"method":method,"params":params})).is_ok(), "{method}");
        }
        for method in ["spot_history_append", "spot_history_import", "spot_history_clear", "spot_history_delete"] {
            assert!(validate_local_request(&json!({"method":method,"params":{}})).is_err(), "{method}");
        }
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
    fn local_map_acceptance_uses_only_private_workspace_context_and_preferences() {
        for method in ["workspace_map_context", "workspace_band_map_apply"] {
            assert!(validate_local_request(&json!({"method":method,"params":{}})).is_ok());
        }
        for method in ["cluster_snapshot", "station_snapshot", "station_power_selection", "sync_summary", "sync_run"] {
            assert!(validate_local_request(&json!({"method":method,"params":{}})).is_err());
        }
    }
    #[test]
    fn normal_launch_has_no_acceptance() { assert!(report_path(vec!["app".into()]).unwrap().is_none()); }
    #[test]
    fn native_window_controls_require_isolation_main_and_known_bounded_kind() {
        let disabled = Acceptance::default();
        assert!(require_window_coordinator(&disabled, "main", "logbook").is_err());
        let isolated = Acceptance { path: Some(PathBuf::from("isolated-test-report.json")), ..Acceptance::default() };
        for kind in ["logbook", "awards", "spot-history"] {
            assert!(require_window_coordinator(&isolated, "main", kind).is_ok());
            for caller in ["logbook", "awards", "spot-history", "monitor", "world-map", "band-maps", "dx-cluster", "", "MAIN", "unknown"] {
                assert!(require_window_coordinator(&isolated, caller, kind).is_err());
            }
        }
        for kind in ["main", "monitor", "world-map", "dx-cluster", "Logbook", "", "../logbook", "https://example.invalid"] {
            assert!(require_window_coordinator(&isolated, "main", kind).is_err());
        }
        assert!(require_window_coordinator(&isolated, "main", &"x".repeat(100_000)).is_err());
    }
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
