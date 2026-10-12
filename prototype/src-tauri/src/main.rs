#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;
mod acceptance;
mod hamlib;
mod rotor;
mod detached_geometry;
mod winkeyer;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
use tauri::{Emitter, LogicalSize, Manager};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const COMPACT_WORKSPACE_MENU_ID: &str = "workspace_compact";
const STANDARD_WORKSPACE_MENU_ID: &str = "workspace_standard";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkspaceLayout {
    Compact,
    Standard,
}

impl WorkspaceLayout {
    fn from_menu_id(id: &str) -> Option<Self> {
        match id {
            COMPACT_WORKSPACE_MENU_ID => Some(Self::Compact),
            STANDARD_WORKSPACE_MENU_ID => Some(Self::Standard),
            _ => None,
        }
    }

    fn logical_size(self) -> LogicalSize<f64> {
        match self {
            Self::Compact => LogicalSize::new(1000.0, 720.0),
            Self::Standard => LogicalSize::new(1440.0, 940.0),
        }
    }
}

fn workspace_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // Extend Tauri's native default instead of replacing its app, Edit,
    // Window, Help, and macOS View/Fullscreen menus or keyboard shortcuts.
    let menu = Menu::default(app)?;
    let compact = MenuItem::with_id(
        app,
        COMPACT_WORKSPACE_MENU_ID,
        "Compact workspace",
        true,
        None::<&str>,
    )?;
    let standard = MenuItem::with_id(
        app,
        STANDARD_WORKSPACE_MENU_ID,
        "Standard workspace",
        true,
        None::<&str>,
    )?;
    let items = menu.items()?;
    let mut existing_view = None;
    for item in &items {
        if let Some(submenu) = item.as_submenu() {
            if submenu.text()? == "View" {
                existing_view = Some(submenu.clone());
                break;
            }
        }
    }
    if let Some(view) = existing_view {
        view.append(&PredefinedMenuItem::separator(app)?)?;
        view.append_items(&[&compact, &standard])?;
    } else {
        let view = Submenu::with_items(app, "View", true, &[&compact, &standard])?;
        let before_window = items
            .iter()
            .position(|item| item.id().0 == WINDOW_SUBMENU_ID)
            .unwrap_or(items.len());
        menu.insert(&view, before_window)?;
    }
    Ok(menu)
}

fn apply_workspace_layout(app: &tauri::AppHandle, layout: WorkspaceLayout) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window("main") {
        // A layout preset always targets the main workspace, even when a
        // monitor or detached map has focus on macOS's app-wide menu.
        if main.is_fullscreen()? {
            main.set_fullscreen(false)?;
        }
        if main.is_maximized()? {
            main.unmaximize()?;
        }
        if main.is_minimized()? {
            main.unminimize()?;
        }
        main.set_size(layout.logical_size())?;
        main.center()?;
        main.show()?;
        main.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
async fn worker_request(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    // Only typed integration operations cross this boundary; never shell commands.
    if state.path.is_some() { acceptance::validate_local_request(&request)?; }
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    if method.starts_with("winkeyer_") {
        winkeyer::validate_surface(window.label())?;
        return tauri::async_runtime::spawn_blocking(move || winkeyer::request(request))
            .await.map_err(|_| "WinKeyer task failed".to_string())?;
    }
    if method == "station_action" && matches!(request["params"]["action"].as_str(), Some("rotor_goto" | "rotor_stop")) {
        return Err("Legacy xCat rotor actions require migration to the selected rotor owner".into());
    }
    let hamlib_rotor = method.starts_with("hamlib_") && request["params"]["device"] == "rotor";
    let rotor_route = hamlib_rotor || method.starts_with("rotor_") || method.starts_with("station_rotor_");
    if rotor_route {
        if method.starts_with("hamlib_") {
            let monitor_allowed = method == "hamlib_snapshot" || (method == "hamlib_control"
                && matches!(request["params"]["action"].as_str(), Some("goto" | "stop")));
            if window.label() != "main" && !(window.label() == "monitor" && monitor_allowed) {
                return Err("This window cannot control Hamlib devices".into());
            }
        } else {
            worker::validate_surface(window.label(), &request)?;
        }
        return tauri::async_runtime::spawn_blocking(move || rotor::request(request))
            .await.map_err(|_| "Rotor task failed".to_string())?;
    }
    if method.starts_with("hamlib_") {
        let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let monitor_allowed = method == "hamlib_snapshot" || (method == "hamlib_control"
            && request["params"]["device"] == "rotor"
            && matches!(request["params"]["action"].as_str(), Some("goto" | "stop")));
        if window.label() != "main" && !(window.label() == "monitor" && monitor_allowed) {
            return Err("This window cannot control Hamlib devices".into());
        }
        return tauri::async_runtime::spawn_blocking(move || hamlib::request(request))
            .await.map_err(|_| "Hamlib task failed".to_string())?;
    }
    worker::validate_surface(window.label(), &request)?;
    tauri::async_runtime::spawn_blocking(move || worker::request(request))
        .await
        .map_err(|_| "Worker task failed".to_string())?
}

#[tauri::command]
async fn pick_backup_package(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<Option<String>, String> {
    if state.path.is_some() { return Err("External backup import is disabled in local acceptance.".into()); }
    if window.label() != "main" {
        return Err("Only the main workspace can import a backup".into());
    }
    // The worker separately verifies the manifest and copies the selected
    // package into the isolated workspace before any restore decision.
    pick_backup_package_native(window).await
}

#[cfg(target_os = "macos")]
async fn pick_backup_package_native(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::NSString;

    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window.run_on_main_thread(move || {
        let selected = MainThreadMarker::new().and_then(|main| {
            let panel = NSOpenPanel::openPanel(main);
            // macOS may recognize .xlogbackup as a package (file) or show
            // it as an ordinary directory. Both must be selectable.
            panel.setCanChooseFiles(true);
            panel.setCanChooseDirectories(true);
            panel.setAllowsMultipleSelection(false);
            panel.setCanCreateDirectories(false);
            panel.setMessage(Some(&NSString::from_str("Choose an xLog .xlogbackup package")));
            if panel.runModal() == NSModalResponseOK {
                panel.URL().and_then(|url| url.path()).map(|path| path.to_string())
            } else {
                None
            }
        });
        let _ = sender.send(selected);
    }).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|_| "Backup chooser closed unexpectedly".to_string()))
        .await.map_err(|_| "Backup chooser failed".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn pick_backup_package_native(_window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    // On Windows/Linux xLog packages are ordinary folders in the picker.
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choose an xLog .xlogbackup package")
            .set_can_create_directories(false)
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "Backup chooser failed".to_string())
}

#[tauri::command]
async fn open_monitor(app: tauri::AppHandle) -> Result<(), String> {
    // Creating a Windows WebView from a synchronous IPC command can block its
    // message loop. Tauri must dispatch this native window work asynchronously.
    if let Some(window) = app.get_webview_window("monitor") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "monitor",
        tauri::WebviewUrl::App(if app.state::<acceptance::Acceptance>().path.is_some() {
            "index.html?view=monitor&acceptance=local".into()
        } else { "index.html?view=monitor".into() }),
    )
    .title("OM0RX-xLog — Station Monitor")
    .inner_size(780.0, 600.0)
    .min_inner_size(640.0, 480.0)
    .always_on_top(false)
    .incognito(app.state::<acceptance::Acceptance>().path.is_some());
    if let Some(directory) = app.state::<acceptance::Acceptance>().detached_browser_context()? {
        builder = builder.data_directory(directory);
    }
    builder.build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_detached_map(app: tauri::AppHandle, window: tauri::WebviewWindow, kind: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can open detached maps".into());
    }
    let (title, width, height) = match kind.as_str() {
        "world-map" => ("OM0RX-xLog — World Map", 1100.0, 720.0),
        "band-maps" => ("OM0RX-xLog — Band Maps", 920.0, 760.0),
        "dx-cluster" => ("OM0RX-xLog — DX Cluster", 1180.0, 800.0),
        _ => return Err("Unknown detached map".into()),
    };
    if let Some(existing) = app.get_webview_window(&kind) {
        existing.unminimize().map_err(|e| e.to_string())?;
        existing.show().map_err(|e| e.to_string())?;
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let suffix = if app.state::<acceptance::Acceptance>().path.is_some() { "&acceptance=local" } else { "" };
    let mut builder = tauri::WebviewWindowBuilder::new(&app, &kind, tauri::WebviewUrl::App(format!("index.html?view={kind}{suffix}").into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(640.0, 480.0)
        .always_on_top(false)
        .incognito(app.state::<acceptance::Acceptance>().path.is_some());
    if let Some(directory) = app.state::<acceptance::Acceptance>().detached_browser_context()? {
        builder = builder.data_directory(directory);
    }
    let detached = builder.build().map_err(|e| e.to_string())?;
    if app.state::<acceptance::Acceptance>().path.is_none() {
        detached_geometry::restore(&detached);
        detached_geometry::watch(&detached);
    }
    Ok(())
}

fn valid_cluster_envelope(request: &serde_json::Value) -> bool {
    let Some(object) = request.as_object() else { return false; };
    let Some(id) = object.get("id").and_then(|value| value.as_str()) else { return false; };
    let Some(method) = object.get("method").and_then(|value| value.as_str()) else { return false; };
    object.len() == 3 && (8..=64).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        && matches!(method, "cluster_snapshot" | "cluster_filter" | "cluster_connect" | "cluster_disconnect"
            | "cluster_history" | "cluster_command" | "cluster_console_clear" | "cluster_configure")
        && object.get("params").is_some_and(serde_json::Value::is_object)
        && serde_json::to_vec(request).is_ok_and(|encoded| encoded.len() <= 32_768)
}

type PendingCluster = HashMap<String, (Instant, serde_json::Value)>;
fn pending_cluster() -> &'static Mutex<PendingCluster> {
    static PENDING: OnceLock<Mutex<PendingCluster>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}
fn store_cluster_request(id: String, request: serde_json::Value) -> Result<(), String> {
    let mut pending = pending_cluster().lock().map_err(|_| "Cluster bridge unavailable".to_string())?;
    pending.retain(|_, (created, _)| created.elapsed() < Duration::from_secs(60));
    if pending.len() >= 64 || pending.contains_key(&id) { return Err("Too many pending cluster actions".into()); }
    pending.insert(id, (Instant::now(), request));
    Ok(())
}
fn take_cluster_request(id: &str) -> Result<serde_json::Value, String> {
    let mut pending = pending_cluster().lock().map_err(|_| "Cluster bridge unavailable".to_string())?;
    let Some((created, request)) = pending.remove(id) else { return Err("Unknown or already handled cluster action".into()); };
    if created.elapsed() >= Duration::from_secs(60) { return Err("Cluster action expired".into()); }
    Ok(request)
}

#[tauri::command]
fn detached_cluster_request(window: tauri::WebviewWindow, app: tauri::AppHandle, request: serde_json::Value) -> Result<(), String> {
    if window.label() != "dx-cluster" || !valid_cluster_envelope(&request) {
        return Err("Detached cluster request is not permitted".into());
    }
    let id = request["id"].as_str().unwrap_or_default().to_string();
    store_cluster_request(id.clone(), request)?;
    if let Err(error) = app.emit_to("main", "xlog:cluster-request", &id) {
        if let Ok(mut pending) = pending_cluster().lock() { pending.remove(&id); }
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn claim_detached_cluster_request(window: tauri::WebviewWindow, id: String) -> Result<serde_json::Value, String> {
    if window.label() != "main" || !(8..=64).contains(&id.len()) { return Err("Only the main workspace can claim cluster actions".into()); }
    take_cluster_request(&id)
}

#[tauri::command]
fn complete_detached_cluster_request(window: tauri::WebviewWindow, app: tauri::AppHandle, response: serde_json::Value) -> Result<(), String> {
    if window.label() != "main" || response.get("id").and_then(|value| value.as_str()).is_none_or(|id| !(8..=64).contains(&id.len()))
        || !response.get("ok").is_some_and(serde_json::Value::is_boolean)
        || serde_json::to_vec(&response).map_or(true, |encoded| encoded.len() > 1_048_576) {
        return Err("Detached cluster response is not permitted".into());
    }
    app.emit_to("dx-cluster", "xlog:cluster-response", response).map_err(|error| error.to_string())
}

#[tauri::command]
fn detached_cluster_ready(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "dx-cluster" { return Err("Only the detached cluster can announce readiness".into()); }
    app.emit_to("main", "xlog:cluster-ready", ()).map_err(|error| error.to_string())
}

#[tauri::command]
fn dock_detached_window(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if !matches!(window.label(), "dx-cluster" | "world-map" | "band-maps") {
        return Err("Only detachable workspaces can dock back".into());
    }
    app.emit_to("main", "xlog:detached-dock", window.label()).map_err(|error| error.to_string())?;
    window.close().map_err(|error| error.to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|error| error.to_string())?;
        main.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn main() {
    let path = acceptance::report_path(std::env::args()).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(2);
    });
    worker::configure_local_acceptance(path.is_some()).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(2);
    });
    let mut context = tauri::generate_context!();
    acceptance::isolate_browser_storage(context.config_mut(), path.is_some());
    tauri::Builder::default()
        .menu(workspace_menu)
        .on_menu_event(|app, event| {
            if let Some(layout) = WorkspaceLayout::from_menu_id(&event.id().0) {
                if let Err(error) = apply_workspace_layout(app, layout) {
                    eprintln!("Could not resize main workspace: {error}");
                }
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(acceptance::Acceptance::new(path))
        .setup(|app| { acceptance::start_watchdog(app.handle().clone()); Ok(()) })
        .invoke_handler(tauri::generate_handler![worker_request, pick_backup_package, open_monitor, open_detached_map,
            detached_cluster_request, claim_detached_cluster_request, complete_detached_cluster_request, detached_cluster_ready, dock_detached_window,
            acceptance::acceptance_enabled, acceptance::acceptance_large_log, acceptance::acceptance_monitor,
            acceptance::acceptance_monitor_result, acceptance::acceptance_prepare_final,
            acceptance::finish_acceptance])
        .build(context)
        .expect("Application failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                winkeyer::shutdown(); hamlib::shutdown(); worker::shutdown();
                app.state::<acceptance::Acceptance>().cleanup_browser_contexts();
            }
        });
}

#[cfg(test)]
mod workspace_layout_tests {
    use super::{store_cluster_request, take_cluster_request, valid_cluster_envelope, WorkspaceLayout, COMPACT_WORKSPACE_MENU_ID, STANDARD_WORKSPACE_MENU_ID};
    use serde_json::json;

    #[test]
    fn menu_actions_have_exact_logical_inner_sizes() {
        let compact = WorkspaceLayout::from_menu_id(COMPACT_WORKSPACE_MENU_ID)
            .unwrap()
            .logical_size();
        let standard = WorkspaceLayout::from_menu_id(STANDARD_WORKSPACE_MENU_ID)
            .unwrap()
            .logical_size();
        assert_eq!((compact.width, compact.height), (1000.0, 720.0));
        assert_eq!((standard.width, standard.height), (1440.0, 940.0));
        assert_eq!(WorkspaceLayout::from_menu_id("quit"), None);
    }

    #[test]
    fn detached_cluster_envelope_rejects_credential_and_station_commands() {
        assert!(valid_cluster_envelope(&json!({"id":"12345678-abcd","method":"cluster_filter","params":{"filter":{"query":"EA"}}})));
        assert!(!valid_cluster_envelope(&json!({"id":"12345678-abcd","method":"cluster_password_set","params":{"password":"secret"}})));
        assert!(!valid_cluster_envelope(&json!({"id":"12345678-abcd","method":"station_tune","params":{}})));
        assert!(!valid_cluster_envelope(&json!({"id":"12345678-abcd","method":"cluster_filter","params":"bad"})));
        assert!(!valid_cluster_envelope(&json!({"id":"12345678-abcd","method":"cluster_command","params":{"command":"x".repeat(40000)}})));
    }

    #[test]
    fn cluster_action_ticket_is_single_use_and_cannot_be_forged_by_an_event() {
        let id = "ticket-12345678";
        assert!(take_cluster_request(id).is_err());
        let canonical = json!({"id":id,"method":"cluster_snapshot","params":{}});
        store_cluster_request(id.into(), canonical.clone()).unwrap();
        assert!(store_cluster_request(id.into(), canonical.clone()).is_err());
        assert_eq!(take_cluster_request(id).unwrap(), canonical);
        assert!(take_cluster_request(id).is_err());
    }
}
