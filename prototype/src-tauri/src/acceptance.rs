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
    completed: AtomicBool,
    final_prepared: AtomicBool,
    monitor: Mutex<Option<Value>>,
}

pub fn report_path(args: impl IntoIterator<Item = String>) -> Result<Option<PathBuf>, String> {
    let args: Vec<_> = args.into_iter().collect();
    let flags: Vec<_> = args.iter().enumerate().filter(|(_, a)| a.as_str() == "--acceptance-report").collect();
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
    pub fn new(path: Option<PathBuf>) -> Self { Self { path, ..Self::default() } }
    fn require(&self) -> Result<(), String> {
        if self.path.is_none() { Err("Acceptance is disabled for normal application launches".into()) } else { Ok(()) }
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

fn bounded_object(report: &Value) -> Result<(), String> {
    if !report.is_object() || serde_json::to_vec(report).map_err(|e| e.to_string())?.len() > 60_000 {
        return Err("Expected a bounded acceptance object".into());
    }
    Ok(())
}

pub fn passed(report: &Value) -> bool {
    const REQUIRED: [&str; 14] = ["worker_health", "worker_self_test", "worker_parse_adif", "map_loaded",
        "cluster_selection", "keyboard_log", "logbook_readback", "keyboard_focus", "keyboard_clear",
        "profile_manual", "profile_simulator", "monitor_opened", "monitor_snapshot", "final_desk"];
    let map = &report["details"]["finalMap"];
    let probes = map["landPixelProbes"].as_u64().unwrap_or(0);
    report["status"] == "passed" && report["embeddedUi"] == true && report["worker"] == true
        && map["tilesLoaded"] == true && map["webgl"] == true && map["visible"] == true
        && map["error"] == "" && probes >= 8 && map["matchedLandPixels"].as_u64() == Some(probes)
        && map["capturedAt"].as_u64().is_some_and(|time| time > 0)
        && report["checks"].as_object().is_some_and(|checks|
            REQUIRED.iter().all(|key| checks.get(*key) == Some(&Value::Bool(true)))
                && checks.values().all(|value| value == &Value::Bool(true)))
}

#[tauri::command]
pub fn acceptance_enabled(state: tauri::State<'_, Acceptance>) -> bool { state.path.is_some() }

#[tauri::command]
pub fn acceptance_monitor(window: tauri::WebviewWindow, state: tauri::State<'_, Acceptance>, report: Value) -> Result<(), String> {
    state.require()?;
    if window.label() != "monitor" { return Err("Only the monitor may report its readback".into()); }
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
    if let Some(monitor) = app.get_webview_window("monitor") { monitor.close().map_err(|e| e.to_string())?; }
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
    let success = prepared && passed(&report);
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
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(90));
        let state = app.state::<Acceptance>();
        if !state.completed.swap(true, Ordering::AcqRel) {
            let _ = state.save(&json!({"schema":1,"status":"failed","embeddedUi":false,"worker":false,
                "platform":std::env::consts::OS,"error":"Native UI acceptance exceeded 90 seconds","station_io":false}));
            app.exit(1);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
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
            "worker_health":true,"worker_self_test":true,"worker_parse_adif":true,"map_loaded":true,
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
