#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;
mod acceptance;

use tauri::Manager;

#[tauri::command]
async fn worker_request(window: tauri::WebviewWindow, request: serde_json::Value) -> Result<serde_json::Value, String> {
    // Only typed integration operations cross this boundary; never shell commands.
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

fn main() {
    let path = acceptance::report_path(std::env::args()).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(2);
    });
    tauri::Builder::default()
        .manage(acceptance::Acceptance::new(path))
        .setup(|app| { acceptance::start_watchdog(app.handle().clone()); Ok(()) })
        .invoke_handler(tauri::generate_handler![worker_request, open_monitor,
            acceptance::acceptance_enabled, acceptance::acceptance_monitor,
            acceptance::acceptance_monitor_result, acceptance::acceptance_prepare_final,
            acceptance::finish_acceptance])
        .build(tauri::generate_context!())
        .expect("Application failed to start")
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) { worker::shutdown(); }
        });
}
