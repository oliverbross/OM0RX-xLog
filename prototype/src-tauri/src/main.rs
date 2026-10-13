#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;
mod acceptance;
mod hamlib;
mod rotor;
mod detached_geometry;
mod winkeyer;
mod cluster_session;
mod workspace_navigation;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
use tauri::{Emitter, LogicalSize, Manager};

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
    let view = if let Some(view) = existing_view {
        view.append(&PredefinedMenuItem::separator(app)?)?;
        view.append_items(&[&compact, &standard])?;
        view
    } else {
        let view = Submenu::with_items(app, "View", true, &[&compact, &standard])?;
        let before_window = items
            .iter()
            .position(|item| item.id().0 == WINDOW_SUBMENU_ID)
            .unwrap_or(items.len());
        menu.insert(&view, before_window)?;
        view
    };
    view.append(&PredefinedMenuItem::separator(app)?)?;
    append_screen_group(app, &view, "View")?;
    for group in ["Logbook", "Station"] {
        let submenu = Submenu::new(app, group, true)?;
        append_screen_group(app, &submenu, group)?;
        let before_window = menu.items()?.iter().position(|item| item.id().0 == WINDOW_SUBMENU_ID).unwrap_or(menu.items()?.len());
        menu.insert(&submenu, before_window)?;
    }
    let existing_window = menu.items()?.iter().filter_map(|item| item.as_submenu().cloned())
        .find(|submenu| submenu.id().0 == WINDOW_SUBMENU_ID);
    let windows = if let Some(windows) = existing_window { windows } else {
        let windows = Submenu::with_id(app, WINDOW_SUBMENU_ID, "Window", true)?;
        menu.append(&windows)?; windows
    };
    windows.append(&PredefinedMenuItem::separator(app)?)?;
    for (id, title) in [("workspace_window_monitor", "Station Monitor"), ("workspace_window_world-map", "World Map"),
        ("workspace_window_band-maps", "Band Maps"), ("workspace_window_dx-cluster", "DX Cluster")] {
        windows.append(&MenuItem::with_id(app, id, title, true, None::<&str>)?)?;
    }
    Ok(menu)
}

fn append_screen_group(app: &tauri::AppHandle, menu: &Submenu<tauri::Wry>, group: &str) -> tauri::Result<()> {
    for screen in workspace_navigation::screens().iter().filter(|screen| screen.group == group) {
        menu.append(&MenuItem::with_id(app, format!("workspace_screen_{}", screen.id),
            &screen.title, true, screen.shortcut.as_deref())?)?;
    }
    Ok(())
}

fn navigate_workspace(app: &tauri::AppHandle, screen: &str) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Main workspace is unavailable")?;
    app.state::<workspace_navigation::WorkspaceNavigation>().request(screen)?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    // The event is only a wake-up. The main view reads the native state and
    // acknowledges a revision, so pre-listener clicks and old acks are safe.
    app.emit_to("main", "xlog:workspace-navigation", ()).map_err(|error| error.to_string())
}

#[tauri::command]
fn workspace_navigation_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, workspace_navigation::WorkspaceNavigation>) -> Result<Option<workspace_navigation::Navigation>, String> {
    state.snapshot(window.label())
}
#[tauri::command]
fn workspace_navigation_ack(window: tauri::WebviewWindow, state: tauri::State<'_, workspace_navigation::WorkspaceNavigation>, revision: u64) -> Result<(), String> {
    state.acknowledge(window.label(), revision)
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
async fn worker_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    // Only typed integration operations cross this boundary; never shell commands.
    if state.path.is_some() { acceptance::validate_local_request(&request)?; }
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    // Local acceptance permits cluster_history against its synthetic logbook,
    // but must never start the live session's background snapshot service.
    if state.path.is_none() && cluster_session::handles(method) {
        cluster_session::validate(window.label(), &request)?;
        let session = cluster_session::owner(&app)?;
        return tauri::async_runtime::spawn_blocking(move || session.request(request))
            .await.map_err(|_| "Cluster session task failed".to_string())?;
    }
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
        window.unminimize().map_err(|e| e.to_string())?;
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
    open_detached_workspace(app, kind).await
}

async fn open_detached_workspace(app: tauri::AppHandle, kind: String) -> Result<(), String> {
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

#[tauri::command]
async fn detached_cluster_ready(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>) -> Result<(), String> {
    if window.label() != "dx-cluster" { return Err("Only the detached cluster can announce readiness".into()); }
    if state.path.is_some() { return Err("Live cluster access is disabled in isolated acceptance.".into()); }
    let session = cluster_session::owner(&app)?;
    tauri::async_runtime::spawn_blocking(move || session.refresh_and_publish()).await
        .map_err(|_| "Cluster session task failed".to_string())?
}

#[tauri::command]
fn cluster_session_selection(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>, selected: Option<String>) -> Result<(), String> {
    if window.label() != "main" || state.path.is_some() { return Err("Only the live QSO workspace can publish a cluster selection.".into()); }
    cluster_session::owner(&app)?.select(selected)
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
            if let Some(screen) = workspace_navigation::menu_screen(&event.id().0) {
                if let Err(error) = navigate_workspace(app, &screen.id) { eprintln!("Could not open workspace screen: {error}"); }
                return;
            }
            if let Some(kind) = event.id().0.strip_prefix("workspace_window_") {
                if matches!(kind, "monitor" | "world-map" | "band-maps" | "dx-cluster") {
                    let app = app.clone(); let kind = kind.to_owned();
                    tauri::async_runtime::spawn(async move {
                        let result = if kind == "monitor" { open_monitor(app).await } else { open_detached_workspace(app, kind).await };
                        if let Err(error) = result { eprintln!("Could not open workspace window: {error}"); }
                    });
                }
                return;
            }
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
        .manage(workspace_navigation::WorkspaceNavigation::default())
        .setup(|app| { acceptance::start_watchdog(app.handle().clone()); Ok(()) })
        .invoke_handler(tauri::generate_handler![worker_request, pick_backup_package, open_monitor, open_detached_map,
            workspace_navigation_snapshot, workspace_navigation_ack,
            detached_cluster_ready, cluster_session_selection, dock_detached_window,
            acceptance::acceptance_enabled, acceptance::acceptance_large_log, acceptance::acceptance_monitor,
            acceptance::acceptance_screen,
            acceptance::acceptance_monitor_result, acceptance::acceptance_prepare_final,
            acceptance::finish_acceptance])
        .build(context)
        .expect("Application failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                cluster_session::shutdown(); winkeyer::shutdown(); hamlib::shutdown(); worker::shutdown();
                app.state::<acceptance::Acceptance>().cleanup_browser_contexts();
            }
        });
}

#[cfg(test)]
mod workspace_layout_tests {
    use super::{WorkspaceLayout, COMPACT_WORKSPACE_MENU_ID, STANDARD_WORKSPACE_MENU_ID};

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

}
