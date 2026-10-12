#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;
mod acceptance;
mod hamlib;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
use tauri::{LogicalSize, Manager};

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
async fn worker_request(window: tauri::WebviewWindow, request: serde_json::Value) -> Result<serde_json::Value, String> {
    // Only typed integration operations cross this boundary; never shell commands.
    if request.get("method").and_then(|m| m.as_str()).is_some_and(|m| m.starts_with("hamlib_")) {
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
async fn open_monitor(app: tauri::AppHandle) -> Result<(), String> {
    // Creating a Windows WebView from a synchronous IPC command can block its
    // message loop. Tauri must dispatch this native window work asynchronously.
    if let Some(window) = app.get_webview_window("monitor") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "monitor",
        tauri::WebviewUrl::App("index.html?view=monitor".into()),
    )
    .title("OM0RX-xLog — Station Monitor")
    .inner_size(780.0, 600.0)
    .min_inner_size(640.0, 480.0)
    .always_on_top(false)
    .build()
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
        _ => return Err("Unknown detached map".into()),
    };
    if let Some(existing) = app.get_webview_window(&kind) {
        existing.unminimize().map_err(|e| e.to_string())?;
        existing.show().map_err(|e| e.to_string())?;
        return existing.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(&app, &kind, tauri::WebviewUrl::App(format!("index.html?view={kind}").into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(640.0, 480.0)
        .always_on_top(false)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn main() {
    let path = acceptance::report_path(std::env::args()).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(2);
    });
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
        .invoke_handler(tauri::generate_handler![worker_request, open_monitor, open_detached_map,
            acceptance::acceptance_enabled, acceptance::acceptance_monitor,
            acceptance::acceptance_monitor_result, acceptance::acceptance_prepare_final,
            acceptance::finish_acceptance])
        .build(tauri::generate_context!())
        .expect("Application failed to start")
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) { hamlib::shutdown(); worker::shutdown(); }
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
