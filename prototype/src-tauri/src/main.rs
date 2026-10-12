#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;
mod acceptance;
mod hamlib;

use tauri::Manager;

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
