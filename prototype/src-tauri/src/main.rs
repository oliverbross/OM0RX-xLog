#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;

use tauri::Manager;

#[tauri::command]
async fn worker_request(request: serde_json::Value) -> Result<serde_json::Value, String> {
    // No path, URL, secret, device or shell input can cross this prototype boundary.
    worker::validate_request(&request)?;
    tauri::async_runtime::spawn_blocking(move || worker::request(request))
        .await
        .map_err(|_| "Worker task failed".to_string())?
}

#[tauri::command]
fn open_monitor(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("monitor") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "monitor",
        tauri::WebviewUrl::App("index.html?view=monitor".into()),
    )
    .title("xLog Prototype — Station Monitor (simulation)")
    .inner_size(780.0, 600.0)
    .min_inner_size(640.0, 480.0)
    .always_on_top(false)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![worker_request, open_monitor])
        .run(tauri::generate_context!())
        .expect("Prototype application failed to start");
}
