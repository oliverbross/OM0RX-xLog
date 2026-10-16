#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;
mod acceptance;
mod hamlib;
mod rotor;
mod rotor_session;
mod rotor_telemetry;
mod station_telemetry;
mod station_selection;
mod station_session;
mod station_identity;
mod alerts;
mod dx_alerts;
mod propagation_session;
mod map_context;
mod monitor_context;
mod spot_identity;
mod spot_editor_barrier;
mod spot_activation;
mod spot_activation_backend;
mod qsy_clear;
mod radio_read;
mod manual_tune;
mod radio_release;
mod carrier_tune;
mod ptt_session;
mod amplifier_transition;
mod manual_rotor;
mod radio_follow;
mod opportunity_selection;
mod auto_rotor;
mod auto_rotor_reconcile;
mod detached_geometry;
mod window_geometry;
mod winkeyer;
mod cw_session;
mod cw_session_backend;
mod cluster_session;
mod workspace_navigation;
mod logbook_events;
mod detached_acceptance;
mod workspace_windows;
mod workspace_window_runtime;
mod canvas_close;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
use tauri::{Emitter, LogicalSize, Manager};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

static MAIN_CREATION: Mutex<()> = Mutex::new(());
static WORKSPACE_PRESENTATION: Mutex<bool> = Mutex::new(false);
static APP_EXITING: AtomicBool = AtomicBool::new(false);
const OPERATOR_DRAFT_CHANGED: &str = "xlog:operator-draft-changed";
static SPOT_ACTIVATION: OnceLock<Arc<spot_activation::Coordinator>> = OnceLock::new();
pub(crate) fn activation_owner(app: &tauri::AppHandle) -> Arc<spot_activation::Coordinator> {
    SPOT_ACTIVATION.get_or_init(|| Arc::new(spot_activation::Coordinator::new(
        Arc::new(spot_activation_backend::NativeBackend::new(app.clone()))))).clone()
}
fn combined_activation_snapshot(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let spot = activation_owner(app).snapshot()?;
    let spot_active = spot["reservationActive"] == true
        || matches!(spot["phase"].as_str(), Some("preparing" | "draft_applied" | "tuning"));
    if spot_active { return Ok(spot); }
    if let Some(follow) = radio_follow::activation_snapshot().filter(|value| value["reservationActive"] == true) { return Ok(follow); }
    if let Some(read) = radio_read::snapshot().filter(|value| value["reservationActive"] == true) { return Ok(read); }
    if let Some(qsy) = qsy_clear::snapshot().filter(|value| value["reservationActive"] == true) { return Ok(qsy); }
    if radio_follow::snapshot().is_ok_and(|value| value["settlementPending"] == true) {
        if let Some(follow) = radio_follow::activation_snapshot() { return Ok(follow); }
    }
    if let Some(read) = radio_read::snapshot().filter(|value| value["operationId"].is_string()) { return Ok(read); }
    if let Some(qsy) = qsy_clear::snapshot().filter(|value| value["operationId"].is_string()) { return Ok(qsy); }
    if let Some(follow) = radio_follow::activation_snapshot() { return Ok(follow); }
    Ok(spot)
}
fn validate_activation_reader(label: &str) -> Result<(), String> {
    if label == "chaser-dx" || spot_editor_barrier::editor_role(label) || spot_editor_barrier::activation_role(label) { Ok(()) }
    else { Err("This window cannot access spot activation.".into()) }
}
fn validate_spot_effect(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if exiting || isolated || !spot_editor_barrier::activation_role(label) {
        Err("Spot radio actions are unavailable in this window or isolated acceptance.".into())
    } else { Ok(()) }
}
fn validate_opportunity_effect(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if isolated || exiting || !matches!(label, "main" | "chaser-dx") { Err("Opportunity draft selection is unavailable in this window.".into()) } else { Ok(()) }
}
fn validate_editor_transition(label: &str) -> Result<(), String> {
    if spot_editor_barrier::editor_role(label) {
        if let Some(owner) = SPOT_ACTIVATION.get() {
            if owner.snapshot()?["reservationActive"] == true {
                return Err("Wait for the spot activation outcome before closing or docking this editor.".into());
            }
        }
        if qsy_clear::reservation_active() {
            return Err("Wait for the QSY draft-clear outcome before closing or docking this editor.".into());
        }
        if radio_read::reservation_active() {
            return Err("Wait for the radio-read outcome before closing or docking this editor.".into());
        }
        if radio_follow::reservation_active() { return Err("Wait for Follow Radio reconciliation before closing or docking this editor.".into()); }
    }
    Ok(())
}
fn retires_automatic_rotor(request: &serde_json::Value) -> bool {
    matches!(request["method"].as_str(), Some("workspace_create" | "backup_restore" | "station_connect" | "station_disconnect" | "station_reconnect" | "station_configure"))
        || request["params"]["device"] == "radio" && matches!(request["method"].as_str(), Some("hamlib_connect" | "hamlib_disconnect" | "hamlib_reconnect"))
}
fn is_raw_manual_rotor_goto(request: &serde_json::Value) -> bool {
    matches!(request["method"].as_str(), Some("rotor_goto" | "station_rotor_goto"))
        || request["method"] == "station_action" && request["params"]["action"] == "rotor_goto"
        || request["method"] == "hamlib_control" && request["params"]["device"] == "rotor"
            && request["params"]["action"] == "goto"
}
fn requires_durable_station_action(action: &str) -> bool {
    matches!(action, "cancel" | "tune" | "operate" | "standby")
}
fn is_raw_ptt_control(request:&serde_json::Value)->bool{request["method"]=="station_radio_control"&&request["params"]["control"]=="ptt"}
fn is_raw_owned_station_lifecycle(request: &serde_json::Value) -> bool {
    matches!(request["params"]["provider"].as_str(), Some("direct_agent" | "direct_flex_lan" | "direct_tci"))
        && matches!(request["method"].as_str(), Some("station_connect" | "station_disconnect" | "station_reconnect" | "station_forget"))
        || request["params"]["device"] == "radio"
            && matches!(request["method"].as_str(), Some("hamlib_connect" | "hamlib_reconnect" | "hamlib_disconnect"))
}

#[tauri::command]
fn spot_editor_register(window: tauri::WebviewWindow, app: tauri::AppHandle, instance: String) -> Result<serde_json::Value, String> {
    let owner = activation_owner(&app);
    owner.editors.register(window.label(), &instance)?;
    radio_follow::editor_changed(window.label(), Some(&instance));
    combined_activation_snapshot(&app)
}
#[tauri::command]
fn spot_editor_unregister(window: tauri::WebviewWindow, app: tauri::AppHandle, instance: String) -> Result<(), String> {
    if !spot_editor_barrier::editor_role(window.label()) { return Err("This window is not a QSO editor.".into()); }
    radio_follow::revoke("Editor membership changed. Follow Radio is off.");
    activation_owner(&app).editors.unregister(window.label(), &instance)
}
#[tauri::command]
fn spot_editor_ack(window: tauri::WebviewWindow, app: tauri::AppHandle, instance: String, barrier_id: String,
    operation_id: String, ready: bool, reason: Option<String>) -> Result<(), String> {
    if !spot_editor_barrier::editor_role(window.label()) { return Err("This window is not a QSO editor.".into()); }
    activation_owner(&app).editors.acknowledge(window.label(), &instance, &operation_id, &barrier_id, ready, reason.as_deref())
}
#[tauri::command]
fn spot_activation_snapshot(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    validate_activation_reader(window.label())?; combined_activation_snapshot(&app)
}
#[tauri::command]
fn spot_activation_status(window: tauri::WebviewWindow, app: tauri::AppHandle, operation_id: String) -> Result<serde_json::Value, String> {
    validate_activation_reader(window.label())?;
    if radio_follow::owns(&operation_id) { return Ok(radio_follow::activation_snapshot().unwrap()); }
    if radio_read::owns(&operation_id) { Ok(radio_read::snapshot().unwrap()) }
    else if qsy_clear::owns(&operation_id) { Ok(qsy_clear::snapshot().unwrap()) } else { activation_owner(&app).status(&operation_id) }
}
#[tauri::command]
async fn spot_activation_reconcile(window: tauri::WebviewWindow, app: tauri::AppHandle, operation_id: String) -> Result<serde_json::Value, String> {
    validate_activation_reader(window.label())?;
    if radio_follow::owns(&operation_id) { return Ok(radio_follow::activation_snapshot().unwrap()); }
    if radio_read::owns(&operation_id) { return Ok(radio_read::snapshot().unwrap()); }
    if qsy_clear::owns(&operation_id) { return Ok(qsy_clear::snapshot().unwrap()); }
    let owner = activation_owner(&app);
    tauri::async_runtime::spawn_blocking(move || owner.reconcile(&operation_id)).await.map_err(|_| "Activation reconciliation task failed".to_string())?
}
#[tauri::command]
async fn spot_editor_state(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    if !spot_editor_barrier::editor_role(window.label()) { return Err("This window is not a QSO editor.".into()); }
    tauri::async_runtime::spawn_blocking(spot_activation_backend::canonical_editor_state).await.map_err(|_| "Draft read task failed".to_string())?
}
#[tauri::command]
async fn activate_spot(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>,
    operation_id: String, source_epoch: String, spot_id: String, spot_version: String) -> Result<serde_json::Value, String> {
    validate_spot_effect(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    radio_follow::revoke("A spot selection disabled Follow Radio.");
    qsy_clear::retire_terminal(); radio_read::retire_terminal();
    let owner = activation_owner(&app);
    let request = spot_activation::Request { operation_id, source_epoch, spot_id, spot_version };
    tauri::async_runtime::spawn_blocking(move || owner.activate(request)).await.map_err(|_| "Spot activation task failed; inspect its existing operation status before retrying".to_string())?
}
#[tauri::command]
async fn activate_opportunity(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>,
    operation_id: String, source_epoch: String, spot_id: String, spot_version: String) -> Result<serde_json::Value, String> {
    validate_opportunity_effect(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    radio_follow::revoke("A Chaser selection disabled Follow Radio.");
    if !opportunity_selection::owns(&source_epoch) {
        return Err("Opportunity draft selection is unavailable in this window or source.".into());
    }
    qsy_clear::retire_terminal(); radio_read::retire_terminal();
    let owner = activation_owner(&app);
    let request = spot_activation::Request { operation_id, source_epoch, spot_id, spot_version };
    tauri::async_runtime::spawn_blocking(move || owner.activate(request)).await
        .map_err(|_| "Opportunity acknowledgement unavailable; inspect the existing operation before selecting again".to_string())?
}
fn validate_radio_read(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if isolated || exiting || !matches!(label, "main" | "log-qso") {
        Err("Read Radio is unavailable in this window.".into())
    } else { Ok(()) }
}
#[tauri::command]
async fn operator_draft_read_radio(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, operation_id: String) -> Result<serde_json::Value, String> {
    validate_radio_read(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    radio_follow::revoke("An explicit radio read disabled Follow Radio.");
    qsy_clear::retire_terminal(); radio_read::retire_terminal();
    let admission = radio_read::admit();
    tauri::async_runtime::spawn_blocking(move || { let _admission = admission; radio_read::execute(operation_id) })
        .await.map_err(|_| "Radio-read task failed; inspect the existing operation before trying again".to_string())?
}
#[tauri::command]
fn operator_draft_follow_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    validate_radio_read(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    radio_follow::snapshot()
}
#[tauri::command]
async fn operator_draft_read_radio_recover(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, operation_id: String, generation: Option<String>) -> Result<serde_json::Value, String> {
    validate_radio_read(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    tauri::async_runtime::spawn_blocking(move || radio_read::recover(operation_id, generation)).await
        .map_err(|_| "Radio-read recovery task failed. No read was replayed.".to_string())?
}
#[tauri::command]
async fn operator_draft_follow_set(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, enabled: bool, expected_epoch: u64) -> Result<serde_json::Value, String> {
    validate_radio_read(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    if enabled { qsy_clear::retire_terminal(); radio_read::retire_terminal(); }
    tauri::async_runtime::spawn_blocking(move || radio_follow::set(enabled, expected_epoch)).await.map_err(|_| "Follow Radio permission task failed".to_string())?
}
#[tauri::command]
fn operator_draft_follow_settled(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, instance: String, operation_id: String) -> Result<(), String> {
    validate_follow_settlement(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    radio_follow::settled(window.label(), &instance, &operation_id)
}
fn validate_follow_settlement(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if isolated || exiting || !spot_editor_barrier::editor_role(label) { Err("This window cannot settle Follow Radio.".into()) } else { Ok(()) }
}
#[tauri::command]
fn auto_rotor_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    validate_auto_rotor_read(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    auto_rotor::snapshot()
}
fn validate_auto_rotor_read(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if exiting || isolated || !auto_rotor::client_role(label) {
        Err("This window cannot read automatic rotor state.".into())
    } else { Ok(()) }
}
fn validate_auto_rotor_set(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if exiting || isolated || !auto_rotor::client_role(label) {
        Err("Automatic rotor settings are unavailable in this window.".into())
    } else { Ok(()) }
}
fn validate_rotor_stop(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if exiting || isolated || !matches!(label, "main" | "monitor" | "rotor" | "station-control") {
        Err("Rotor Stop is unavailable in this window.".into())
    } else { Ok(()) }
}
#[derive(Clone, Copy)]
struct AutomaticRotorCommand { sequence: u64, epoch: u64 }
#[derive(Default)]
struct AutomaticRotorCommands(Mutex<u64>);
impl AutomaticRotorCommands {
    fn begin(&self, armed: bool, epoch: impl FnOnce() -> Result<u64, String>, revoke: impl FnOnce()) -> Result<AutomaticRotorCommand, String> {
        let mut sequence = self.0.lock().map_err(|_| "Automatic rotor command ordering unavailable")?;
        // Runs at IPC ingress, before scheduling any task. This mutex protects
        // metadata only: no driver, lookup or reconciliation work runs here.
        if !armed { revoke(); }
        match sequence.checked_add(1).filter(|value| *value <= 9_007_199_254_740_991) {
            Some(next) => *sequence = next,
            None => {
                // Retire every previously issued identity; Off still revoked
                // above even though no further Arm command can be admitted.
                *sequence = u64::MAX;
                return Err("Automatic rotor command sequence exhausted".into());
            }
        }
        Ok(AutomaticRotorCommand { sequence: *sequence, epoch: epoch()? })
    }
    fn apply<T>(&self, command: AutomaticRotorCommand, action: impl FnOnce(u64) -> Result<T, String>) -> Result<T, String> {
        let sequence = self.0.lock().map_err(|_| "Automatic rotor command ordering unavailable")?;
        if *sequence != command.sequence { return Err("A newer automatic rotor request superseded this one. Check its current state.".into()); }
        // set_armed performs only short owner validation (try_lock) and atomic
        // permission admission. Never put driver I/O inside this callback.
        action(command.epoch)
    }
}
static AUTOMATIC_ROTOR_COMMANDS: AutomaticRotorCommands = AutomaticRotorCommands(Mutex::new(0));
#[tauri::command]
async fn auto_rotor_set(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>,
    armed: bool, owner: Option<String>, generation: Option<u64>) -> Result<serde_json::Value, String> {
    validate_auto_rotor_set(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    let command = AUTOMATIC_ROTOR_COMMANDS.begin(armed, || auto_rotor::snapshot()?["epoch"].as_u64().ok_or_else(|| "Automatic rotor epoch unavailable".into()), auto_rotor::revoke)?;
    let result = tauri::async_runtime::spawn_blocking(move || AUTOMATIC_ROTOR_COMMANDS.apply(command, |epoch| {
        if APP_EXITING.load(Ordering::Acquire) { return Err("Automatic rotor settings are unavailable during shutdown.".into()); }
        auto_rotor::set_armed(armed, owner.as_deref(), generation, epoch)
    }))
        .await.map_err(|_| "Automatic rotor task failed".to_string())?;
    if armed && result.is_ok() { auto_rotor_reconcile::request(&app); }
    for label in auto_rotor::CLIENT_WINDOWS { let _ = app.emit_to(label, "xlog:auto-rotor", ()); }
    result
}
fn detached_window_shortcut(kind: &str) -> Option<&'static str> {
    match kind { "log-qso" => Some("CmdOrCtrl+L"), "cw" => Some("CmdOrCtrl+Shift+K"), _ => None }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DraftWake { None, Applied, Workspace }
impl DraftWake {
    fn for_request(request: &serde_json::Value) -> Self {
        if matches!(request["method"].as_str(), Some("workspace_create" | "backup_restore")) { return Self::Workspace; }
        if request["method"] == "logbook_operator_draft_apply"
            && matches!(request["params"]["action"].as_str(), Some("replace" | "clear" | "save")) { return Self::Applied; }
        Self::None
    }
    fn confirmed(self, response: Option<&serde_json::Value>) -> bool {
        self == Self::Workspace || self == Self::Applied
            && response.is_some_and(|response| response["ok"] == true && response["result"]["status"] == "applied")
    }
}

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
    let modes = Submenu::with_id(app, "workspace_mode_menu", "Workspace Mode", true)?;
    modes.append(&CheckMenuItem::with_id(app, "workspace_mode_canvas", "Canvas", true, true, None::<&str>)?)?;
    modes.append(&CheckMenuItem::with_id(app, "workspace_mode_windows", "Separate Windows", true, false, None::<&str>)?)?;
    windows.append(&modes)?;
    windows.append(&PredefinedMenuItem::separator(app)?)?;
    for window in workspace_windows::SUPPORTED_WINDOWS {
        windows.append(&MenuItem::with_id(app, format!("workspace_window_{}", window.id),
            window.title.trim_start_matches("OM0RX-xLog — "), true,
            detached_window_shortcut(window.id))?)?;
    }
    let band_maps = Submenu::new(app, "Open Band Map", true)?;
    for band in workspace_windows::BAND_MAP_BANDS {
        band_maps.append(&MenuItem::with_id(app, format!("workspace_window_band-map-{band}"), format!("{band} Band Map"), true, None::<&str>)?)?;
    }
    windows.append(&band_maps)?;
    Ok(menu)
}

fn append_screen_group(app: &tauri::AppHandle, menu: &Submenu<tauri::Wry>, group: &str) -> tauri::Result<()> {
    for screen in workspace_navigation::screens().iter().filter(|screen| screen.group == group && !screen.hidden) {
        menu.append(&MenuItem::with_id(app, format!("workspace_screen_{}", screen.id),
            &screen.title, true, screen.shortcut.as_deref())?)?;
    }
    Ok(())
}

fn recover_singleton<T>(creation: &Mutex<()>, existing: impl FnOnce() -> Option<T>, create: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _creation = creation.lock().map_err(|_| "Main workspace creation unavailable")?;
    if let Some(window) = existing() { return Ok(window); }
    create()
}

// Blocking task only: creating a Windows WebView on the IPC/menu loop can
// deadlock its native message pump. This never reruns application setup.
fn ensure_main_workspace(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if APP_EXITING.load(Ordering::Acquire) { return Err("Application is shutting down".into()); }
    let main = recover_singleton(&MAIN_CREATION, || app.get_webview_window("main"), || {
        if APP_EXITING.load(Ordering::Acquire) { return Err("Application is shutting down".into()); }
        let config = app.config().app.windows.iter().find(|window| window.label == "main")
            .ok_or("Main workspace configuration unavailable")?;
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)
            .map_err(|error| error.to_string())?;
        if let Some(directory) = app.state::<acceptance::Acceptance>().detached_browser_context()? {
            builder = builder.data_directory(directory);
        }
        let main = builder.build().map_err(|error| error.to_string())?;
        if app.state::<acceptance::Acceptance>().path.is_none() { detached_geometry::install(&main); }
        Ok(main)
    })?;
    if APP_EXITING.load(Ordering::Acquire) { return Err("Application is shutting down".into()); }
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    Ok(main)
}

async fn navigate_workspace(app: tauri::AppHandle, screen: String) -> Result<(), String> {
    if screen.starts_with("workspace-mode-") {
        let native = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let id = format!("workspace-mode-menu-{}", uuid::Uuid::new_v4());
            let reply = worker::request(serde_json::json!({"id":id,"method":"workspace_layout_load","params":{}}))?;
            if reply["id"] != id || reply["ok"] != true { return Err("The saved workspace mode could not be read.".into()); }
            update_workspace_mode_checks(&native, reply["result"]["layout"]["document"]["activePresetID"] == "windowed")?;
            workspace_mode_ready()
        }).await.map_err(|_| "Workspace mode guard could not be checked.".to_string())??;
    } else if workspace_windows::supports(&screen) {
        let direct = tauri::async_runtime::spawn_blocking(|| {
            let id = format!("workspace-menu-mode-{}", uuid::Uuid::new_v4());
            let reply = worker::request(serde_json::json!({"id":id,"method":"workspace_layout_load","params":{}}))?;
            Ok::<bool, String>(reply["id"] == id && reply["ok"] == true
                && reply["result"]["layout"]["document"]["activePresetID"] == "windowed")
        }).await.map_err(|_| "Workspace mode could not be checked.".to_string()).unwrap_or(Ok(false))?;
        if direct { return open_detached_workspace(app, screen).await; }
    }
    app.state::<workspace_navigation::WorkspaceNavigation>().request(&screen)?;
    // The event is only a wake-up. The main view reads the native state and
    // acknowledges a revision, so pre-listener clicks and old acks are safe.
    tauri::async_runtime::spawn_blocking(move || {
        ensure_main_workspace(&app)?;
        app.emit_to("main", "xlog:workspace-navigation", ()).map_err(|error| error.to_string())
    }).await.map_err(|_| "Main workspace task failed".to_string())?
}

fn workspace_mode_ready() -> Result<(), String> {
    // Focusing or hiding an armed CW client invokes its existing safety Stop.
    // Refuse the mode change before altering focus rather than issuing that effect.
    if let Some(owner) = cw_session_backend::existing() {
        let state = owner.snapshot()?;
        if state["armed"] == true || state["pending"] == true || !state["owner"].is_null() || !state["lease"].is_null() {
            return Err("Stop and disarm CW before switching workspace modes.".into());
        }
    }
    Ok(())
}

fn wait_for_workspace_windows(app: &tauri::AppHandle, generation: &str, revision: u64) -> Result<(), String> {
    let attempt = workspace_window_runtime::refresh(app, true)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let status = workspace_window_runtime::status(app)?;
        if status["state"] == "error" || status["stopped"] == true {
            return Err(status["error"].as_str().unwrap_or("The separate windows could not be opened.").into());
        }
        if status["state"] == "applied" && status["attempt"].as_u64().is_some_and(|value| value >= attempt)
            && status["generation"] == generation && status["revision"].as_u64() == Some(revision) {
            if status["shown"].as_array().is_some_and(|windows| !windows.is_empty()) { return Ok(()); }
            return Err("The Separate Windows preset must keep at least one task window visible.".into());
        }
        if Instant::now() >= deadline { return Err("Separate windows did not finish opening; the main window remains available.".into()); }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn update_workspace_mode_checks(app: &tauri::AppHandle, windows: bool) -> Result<(), String> {
    if let Some(menu) = app.menu() {
        let modes = menu.get(WINDOW_SUBMENU_ID).and_then(|item| item.as_submenu().cloned())
            .and_then(|window| window.get("workspace_mode_menu"))
            .and_then(|item| item.as_submenu().cloned()).ok_or("Workspace Mode menu is unavailable.")?;
        for (id, checked) in [("workspace_mode_canvas", !windows), ("workspace_mode_windows", windows)] {
            let item = modes.get(id).and_then(|item| item.as_check_menuitem().cloned()).ok_or("Workspace Mode choice is unavailable.")?;
            item.set_checked(checked).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn workspace_navigation_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, workspace_navigation::WorkspaceNavigation>) -> Result<Option<workspace_navigation::Navigation>, String> {
    state.snapshot(window.label())
}
#[tauri::command]
fn workspace_navigation_ack(window: tauri::WebviewWindow, state: tauri::State<'_, workspace_navigation::WorkspaceNavigation>, revision: u64) -> Result<(), String> {
    state.acknowledge(window.label(), revision)
}

// Presentation follows a fresh SQLite-owned revision. The renderer supplies only
// its editor veto; it cannot choose a mode or submit hardware actions here.
#[tauri::command]
async fn workspace_mode_present(window: tauri::WebviewWindow, app: tauri::AppHandle,
    generation: String, revision: u64, hide_main: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main workspace presents its mode.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let mut presented_windows = WORKSPACE_PRESENTATION.lock().map_err(|_| "Workspace mode presentation unavailable")?;
        let id = format!("workspace-mode-{}", uuid::Uuid::new_v4());
        let reply = worker::request(serde_json::json!({"id":id,"method":"workspace_layout_load","params":{}}))?;
        let layout = &reply["result"]["layout"];
        if reply["id"] != id || reply["ok"] != true || layout["generation"] != generation || layout["revision"] != revision {
            return Err("The workspace mode changed. Reload its saved layout before continuing.".into());
        }
        let windows = layout["document"]["activePresetID"] == "windowed";
        if !windows && *presented_windows { workspace_window_runtime::canvas(&app, &generation, revision, layout.clone())?; }
        if let Some(main) = app.get_webview_window("main") {
            if windows && hide_main {
                workspace_mode_ready()?;
                wait_for_workspace_windows(&app, &generation, revision)?;
                main.hide().map_err(|error| error.to_string())?;
            }
            else { main.show().map_err(|error| error.to_string())?; }
        }
        update_workspace_mode_checks(&app, windows)?;
        *presented_windows = windows;
        Ok(())
    }).await.map_err(|_| "Workspace mode presentation failed.".to_string())?
}

#[tauri::command]
fn workspace_canvas_close_ack(window: tauri::WebviewWindow, request: String, ready: bool) -> Result<(), String> {
    canvas_close::preparation().acknowledge(window.label(), &request, ready)
}

// Runs only on the serialized native window owner. Inventory includes manual
// windows and each band-map instance, rather than only planner-managed roles.
fn present_canvas_windows(app: &tauri::AppHandle, generation: &str, revision: u64) -> Result<(), String> {
    let windows = app.webview_windows().into_values().filter(|window| workspace_windows::supports(window.label())).collect::<Vec<_>>();
    let labels = windows.iter().map(|window| window.label().to_owned()).collect::<Vec<_>>();
    workspace_mode_ready()?;
    validate_editor_transition("main")?;
    let preparation = canvas_close::preparation();
    let request = preparation.begin(&labels)?;
    let preflight = (|| {
        for window in windows.iter().filter(|window| matches!(window.label(), "logbook" | "log-qso")) {
            window.emit("xlog:canvas-close-prepare", serde_json::json!({"request":request})).map_err(|error| error.to_string())?;
        }
        preparation.wait(&request, Duration::from_secs(3))?;
        let id = format!("canvas-close-{}", uuid::Uuid::new_v4());
        let reply = worker::request(serde_json::json!({"id":id,"method":"workspace_layout_load","params":{}}))?;
        let layout = &reply["result"]["layout"];
        if reply["id"] != id || reply["ok"] != true || layout["generation"] != generation || layout["revision"] != revision || layout["document"]["activePresetID"] == "windowed" {
            return Err("The workspace changed during Canvas preparation. Reload its saved layout and retry.".into());
        }
        workspace_mode_ready()?;
        validate_editor_transition("main")
    })();
    preparation.finish(&request);
    // Constructing the idle owner performs no device access. Reserve even when
    // it did not exist during preflight, so a just-loaded renderer cannot arm
    // CW between the idle check and destruction of its window.
    let cw = cw_session_backend::owner(app);
    let mut reserved = false;
    let result = canvas_close::apply(&windows, || {
        preflight?;
        cw.reserve_idle_close(&["main", "cw"])?;
        reserved = true;
        // Show Canvas only after every renderer veto and native guard passed.
        if let Some(main) = app.get_webview_window("main") { main.show().map_err(|error| error.to_string())?; }
        Ok(())
    }, |window| {
        validate_editor_transition("main")?;
        if window.label() == "cw" {
            detached_geometry::flush(window);
            window.destroy().map_err(|error| error.to_string())?;
        } else {
            // Existing renderer close handlers recheck unsaved/local input.
            // A missed listener, refusal or failed command cannot claim success.
            window.close().map_err(|error| error.to_string())?;
        }
        Ok(())
    }, || {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let remaining = app.webview_windows().into_keys().filter(|label| workspace_windows::supports(label)).collect::<Vec<_>>();
            if remaining.is_empty() { return Ok(()); }
            if Instant::now() >= deadline {
                return Err(format!("Canvas could not close {}. Resolve any editor changes or window errors and retry.", remaining.join(", ")));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    });
    if reserved { let _ = cw.allow_window("cw"); let _ = cw.allow_window("main"); }
    result
}

fn apply_workspace_layout(app: &tauri::AppHandle, layout: WorkspaceLayout) -> Result<(), String> {
    let main = ensure_main_workspace(app)?;
    (|| -> tauri::Result<()> {
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
        Ok(())
    })().map_err(|error| error.to_string())
}

#[tauri::command]
async fn rotor_telemetry_snapshot(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    rotor_telemetry::validate(window.label(), state.path.is_some())?;
    if window.label() == "rotor" { return rotor_telemetry::retained_snapshot(); }
    rotor_telemetry::owner(&app)?.snapshot()
}

#[tauri::command]
async fn map_context_snapshot(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    if state.path.is_some() {
        state.require()?;
        map_context::validate(window.label(), false)?;
        return tauri::async_runtime::spawn_blocking(map_context::acceptance_snapshot).await
            .map_err(|_| "Isolated map context task failed".to_string())?;
    }
    map_context::validate(window.label(), state.path.is_some())?;
    tauri::async_runtime::spawn_blocking(move || map_context::snapshot(&app)).await
        .map_err(|_| "Map context task failed".to_string())?
}

#[tauri::command]
async fn station_telemetry_snapshot(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>, provider: Option<String>) -> Result<serde_json::Value, String> {
    station_telemetry::validate(window.label(), state.path.is_some(), provider.is_some())?;
    station_telemetry::owner(&app)?.snapshot()
}

#[tauri::command]
fn station_status_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    monitor_context::status_read(window.label(), state.path.is_some(), monitor_context::status_snapshot)
}

#[tauri::command]
fn station_identity_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    station_identity::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    station_identity::snapshot()
}

#[tauri::command]
fn alerts_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    alerts::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    alerts::snapshot()
}

#[tauri::command]
fn dx_alerts_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    dx_alerts::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    dx_alerts::existing().ok_or("DX alerts are unavailable.")?.snapshot()
}

#[tauri::command]
fn dx_alerts_save(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, expected_generation: String,
    expected_revision: u64, configuration: serde_json::Value) -> Result<serde_json::Value, String> {
    dx_alerts::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    dx_alerts::existing().ok_or("DX alerts are unavailable.")?.save(&expected_generation, expected_revision, configuration)
}

#[tauri::command]
fn dx_alerts_test(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    dx_alerts::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    dx_alerts::existing().ok_or("DX alerts are unavailable.")?.test_alert()
}

#[tauri::command]
fn dx_alerts_clear(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    dx_alerts::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    dx_alerts::existing().ok_or("DX alerts are unavailable.")?.clear()
}

#[tauri::command]
fn antenna_snapshot(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    station_identity::validate_antenna(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    station_identity::antenna_snapshot()
}

#[tauri::command]
async fn propagation_session_request(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>, action: String) -> Result<serde_json::Value, String> {
    propagation_session::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    if !matches!(action.as_str(), "snapshot" | "ensure" | "refresh") { return Err("Unknown propagation session action.".into()); }
    let owner = propagation_session::owner(&app)?;
    if action == "snapshot" { return owner.snapshot(); }
    tauri::async_runtime::spawn_blocking(move || if action == "ensure" {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "System clock is unavailable.".to_string())?.as_secs_f64();
        owner.ensure_fresh(now)
    } else { owner.refresh() }).await.map_err(|_| "Propagation refresh could not be confirmed; no request was replayed.".to_string())?
}

#[tauri::command]
async fn monitor_context_snapshot(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>) -> Result<serde_json::Value, String> {
    monitor_context::read(window.label(), state.path.is_some(), || monitor_context::snapshot(&app), || {
        state.require()?; monitor_context::acceptance_snapshot()
    })
}

#[tauri::command]
async fn monitor_station_action(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>, expected: u64, selection_id: String, provider: String, action: String) -> Result<serde_json::Value, String> {
    monitor_context::validate(window.label(), state.path.is_some())?;
    if requires_durable_station_action(&action) { return Err("Use the shared durable radio and amplifier owners.".into()); }
    let request = monitor_context::action_request(&provider, &action)?;
    let selection = station_selection::owner(&app)?;
    let telemetry = station_telemetry::owner(&app)?;
    tauri::async_runtime::spawn_blocking(move || selection.monitor_action(request, expected, &selection_id,
        || telemetry.monitor_control(&provider, expected, &selection_id, &action)))
        .await.map_err(|_| "Monitor action task failed".to_string())?
}

#[tauri::command]
async fn radio_release_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let action = params["action"].as_str().unwrap_or("");
    radio_release::validate(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire), action)?;
    let owner = radio_release::owner(&app)?;
    let keys: &[&str] = match action { "snapshot" => &["action"], "cancel" => &["action", "operation_id", "target"], _ => &["action", "operation_id"] };
    if params.as_object().is_none_or(|object| object.len() != keys.len() || object.keys().any(|key| !keys.contains(&key.as_str()))) {
        return Err("Invalid radio Cancel request.".into());
    }
    if action == "snapshot" { let mut snapshot = owner.snapshot()?; snapshot["target"] = radio_release::context(&app)?["target"].clone(); return Ok(snapshot); }
    let id = params["operation_id"].as_str().ok_or("Missing radio Cancel identity.")?.to_owned();
    if action == "receipt" { return owner.receipt(&id); }
    if action == "review" {
        let result = owner.review(&id);
        for label in ["main", "monitor", "station-control"] { let _ = app.emit_to(label, "xlog:radio-release", ()); }
        return result;
    }
    let target = serde_json::from_value::<radio_release::Target>(params["target"].clone()).map_err(|_| "Invalid radio Cancel target.")?;
    carrier_tune::revoke_output_intent()?;
    let changed = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || owner.cancel(&id, target, |request, target| radio_release::execute(&app, request, target)))
        .await.map_err(|_| "Radio Cancel task ended; check its retained receipt. No Cancel will be replayed.".to_string())?;
    for label in ["main", "monitor", "station-control"] { let _ = changed.emit_to(label, "xlog:radio-release", ()); }
    result
}

#[tauri::command]
async fn carrier_tune_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let action=params["action"].as_str().unwrap_or("");
    carrier_tune::validate(window.label(),state.path.is_some(),APP_EXITING.load(Ordering::Acquire),action)?;
    let keys:&[&str]=match action {"snapshot"=>&["action"],"tune"=>&["action","operation_id","target"],_=>&["action","operation_id"]};
    if params.as_object().is_none_or(|o|o.len()!=keys.len() || o.keys().any(|k|!keys.contains(&k.as_str()))) { return Err("Invalid carrier Tune request.".into()); }
    let owner=carrier_tune::owner(&app)?;
    if action=="snapshot" {let mut value=owner.snapshot()?;value["target"]=carrier_tune::context(&app)?["target"].clone();return Ok(value);}
    let id=params["operation_id"].as_str().ok_or("Missing carrier Tune identity")?.to_owned();
    if action=="receipt" {return owner.receipt(&id);}
    if action=="review" {let result=owner.review(&id);for label in ["main","monitor","station-control"] {let _=app.emit_to(label,"xlog:carrier-tune",());}return result;}
    let target=serde_json::from_value::<carrier_tune::Target>(params["target"].clone()).map_err(|_|"Invalid carrier Tune target")?;
    let changed=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move||owner.tune(&id,target,|request,target|carrier_tune::execute(&app,request,target)))
        .await.map_err(|_|"Carrier Tune task ended; inspect its receipt. No Tune will be replayed.".to_string())?;
    for label in ["main","monitor","station-control"] {let _=changed.emit_to(label,"xlog:carrier-tune",());}result
}

#[tauri::command]
async fn monitor_rotor_stop(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, owner: String) -> Result<serde_json::Value, String> {
    validate_rotor_stop(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire))?;
    tauri::async_runtime::spawn_blocking(move || rotor::monitor_stop(&owner))
        .await.map_err(|_| "Rotor Stop task failed".to_string())?
}

#[tauri::command]
async fn ptt_session_request(app:tauri::AppHandle,window:tauri::WebviewWindow,state:tauri::State<'_,acceptance::Acceptance>,params:serde_json::Value)->Result<serde_json::Value,String>{
    let action=params["action"].as_str().unwrap_or("");ptt_session::validate(window.label(),state.path.is_some(),APP_EXITING.load(Ordering::Acquire),action)?;
    let keys:&[&str]=match action{"snapshot"=>&["action"],"prepare"=>&["action","enabled"],"recover"=>&["action","operation_id","owner_id","target"],"on"|"off"=>&["action","operation_id","target","intent"],_=>&["action","operation_id"]};
    if params.as_object().is_none_or(|p|p.len()!=keys.len()||p.keys().any(|k|!keys.contains(&k.as_str()))){return Err("Invalid PTT request".into());}
    let owner=ptt_session::owner(&app)?;owner.reconcile(&station_telemetry::owner(&app)?.snapshot()?)?;
    if action=="snapshot"||action=="prepare" {let mut s=owner.snapshot()?;
        if action=="prepare"{let enabled=params["enabled"].as_bool().ok_or("Missing PTT preparation direction")?;if !enabled{carrier_tune::revoke_output_intent()?;}s["intent"]=serde_json::json!(carrier_tune::output_intent()?);}
        s["target"]=ptt_session::context(&app)?["target"].clone();return Ok(s);}
    let id=params["operation_id"].as_str().ok_or("Missing PTT identity")?.to_owned();
    if action=="receipt"{return owner.receipt(&id);}if action=="review"{return owner.review(&id);}
    if action=="recover"{let target=serde_json::from_value::<ptt_session::Target>(params["target"].clone()).map_err(|_|"Invalid PTT recovery target")?;let owner_id=params["owner_id"].as_str().ok_or("Missing retained PTT owner")?;let result=ptt_session::recover(&app,&owner,&id,owner_id,target);let _=app.emit_to("main","xlog:ptt-session",());return result;}
    let target=serde_json::from_value::<ptt_session::Target>(params["target"].clone()).map_err(|_|"Invalid PTT target")?;let intent=params["intent"].as_str().ok_or("Missing native PTT preparation")?.to_owned();let on=action=="on";let changed=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move||owner.apply_admitted(&id,on,target,&intent,|t|ptt_session::preflight(&app,t,on,&intent),|q,t|ptt_session::execute(&app,q,t,&intent))).await.map_err(|_|"PTT task ended; inspect its retained receipt; never replay".to_string())?;
    let _=changed.emit_to("main","xlog:ptt-session",());result
}

#[tauri::command]
async fn amplifier_transition_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let action=params["action"].as_str().unwrap_or("");
    amplifier_transition::validate(window.label(),state.path.is_some(),APP_EXITING.load(Ordering::Acquire),action)?;
    let keys:&[&str]=match action {"snapshot"=>&["action"],"prepare"=>&["action","transition"],"operate"|"standby"=>&["action","operation_id","target","preparation"],_=>&["action","operation_id"]};
    if params.as_object().is_none_or(|o|o.len()!=keys.len() || o.keys().any(|k|!keys.contains(&k.as_str()))) {return Err("Invalid amplifier request".into());}
    let owner=amplifier_transition::owner(&app)?;
    if action=="snapshot" {let mut value=owner.snapshot()?;value["target"]=amplifier_transition::context(&app)?["target"].clone();return Ok(value);}
    if action=="prepare" {
        let preparation=owner.prepare(params["transition"].as_str().ok_or("Missing amplifier preparation action")?)?;
        let mut value=owner.snapshot()?;value["preparation"]=serde_json::to_value(preparation).map_err(|_|"Amplifier preparation unavailable")?;
        value["target"]=amplifier_transition::context(&app)?["target"].clone();return Ok(value);
    }
    let id=params["operation_id"].as_str().ok_or("Missing amplifier identity")?.to_owned();
    if action=="receipt" {return owner.receipt(&id);}
    if action=="review" {let result=owner.review(&id);for label in ["main","monitor","station-control"] {let _=app.emit_to(label,"xlog:amplifier-transition",());}return result;}
    let target=serde_json::from_value::<amplifier_transition::Target>(params["target"].clone()).map_err(|_|"Invalid amplifier target")?;
    let preparation=serde_json::from_value::<amplifier_transition::Preparation>(params["preparation"].clone()).map_err(|_|"Invalid amplifier preparation")?;
    let action=action.to_owned();let changed=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move||owner.transition_prepared(&id,&action,target,&preparation,|request,target|amplifier_transition::execute(&app,request,target,&preparation))).await.map_err(|_|"Amplifier task ended; inspect its receipt. No transition will be replayed.".to_string())?;
    for label in ["main","monitor","station-control"] {let _=changed.emit_to(label,"xlog:amplifier-transition",());}result
}

#[tauri::command]
async fn station_selection_snapshot(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, acceptance::Acceptance>, legacy: Option<String>) -> Result<serde_json::Value, String> {
    station_selection::validate(window.label(), state.path.is_some(), legacy.is_some())?;
    let owner = station_selection::owner(&app)?;
    let main = window.label() == "main";
    let value = tauri::async_runtime::spawn_blocking(move || if main { owner.initialize(legacy.as_deref()) } else { owner.snapshot() })
        .await.map_err(|_| "Radio selection task failed".to_string())??;
    if main && value["provider"].is_string() { station_telemetry::owner(&app)?.select_selection(&value, true)?; }
    Ok(value)
}

#[tauri::command]
async fn station_session_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let action = params["action"].as_str().unwrap_or("");
    station_session::validate_live(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire), action)?;
    if action == "hamlib_catalogue" {
        return tauri::async_runtime::spawn_blocking(move || station_session::hamlib_catalogue(&params, hamlib::request))
            .await.map_err(|_| "Radio model catalogue task failed.".to_string())?;
    }
    let owner = station_session::owner(&app)?;
    if action == "snapshot" {
        let mut value = owner.snapshot()?;
        value["manual_tune_receipt"] = owner.unresolved_receipt("manual_tune")?;
        value["selection"] = station_selection::owner(&app)?.snapshot()?;
        value["radio"] = station_telemetry::retained_snapshot().unwrap_or(serde_json::Value::Null);
        value["worker_generation"] = serde_json::json!(worker::generation());
        return Ok(value);
    }
    if action == "receipt" { return owner.receipt(params["operation_id"].as_str().ok_or("Missing operation identity.")?); }
    if action == "review" {
        if params.as_object().is_none_or(|value| value.len() != 3) || params["reviewed_action"] != "manual_tune" {
            return Err("Invalid manual tune review request.".into());
        }
        return owner.review(params["operation_id"].as_str().ok_or("Missing operation identity.")?, "manual_tune");
    }
    let selection = station_selection::owner(&app)?;
    let telemetry = station_telemetry::owner(&app)?;
    let changed = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || owner.apply(&params, |request, generation, identity| {
        if params["action"] == "manual_tune" { return manual_tune::execute(&app, &params, request, generation, identity); }
        if request["method"] == "station_radio_control" || request["method"] == "hamlib_control" {
            let connection = request["params"]["expected_generation"].as_u64().ok_or("Missing exact radio generation.")?;
            let control = if request["method"] == "hamlib_control" {
                if request["params"]["device"] != "radio" { return Err("Invalid exact Hamlib receive route.".into()); }
                request["params"]["action"].as_str()
            } else { request["params"]["control"].as_str() }
                .filter(|value| matches!(*value, "set_frequency_a" | "set_mode_a" | "set_receive_frequency_a" | "set_receive_mode_a"))
                .ok_or("Missing receive control.")?.to_owned();
            return selection.receive_control(request, generation, identity, params["control_revision"].as_u64().ok_or("Missing radio control revision.")?,
                || telemetry.receive_control(generation, identity, connection, &control));
        }
        if let Some(owner) = cw_session_backend::existing() { owner.revoke()?; let _ = owner.stop(); }
        auto_rotor::revoke();
        let _auto_change = auto_rotor::canonical_will_change();
        if request["method"] == "station_selection_apply" {
            let _fence = telemetry.control()?;
            let result = selection.handover_checked(generation, identity, request["params"]["provider"].as_str().ok_or("Unknown radio provider.")?);
            // A failed rollback may still change persisted selection authority.
            let synchronized = selection.snapshot().and_then(|actual| telemetry.select_selection(&actual, false));
            match result {
                Ok(_) => { synchronized?; Ok(serde_json::json!({"id":request["id"],"ok":true})) },
                Err(error) => { if let Err(sync_error) = synchronized { eprintln!("Radio telemetry selection unavailable: {sync_error}"); } Err(error) }
            }
        } else { selection.monitor_action(request, generation, identity, || telemetry.control()) }
    })).await.map_err(|_| "Station Control task ended; inspect the operation receipt before retrying.".to_string())?;
    for label in ["main", "station-control"] { let _ = changed.emit_to(label, "xlog:station-session", ()); }
    result
}

#[tauri::command]
async fn manual_rotor_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let action = params["action"].as_str().unwrap_or("");
    manual_rotor::validate_surface(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire), action)?;
    let owner = station_session::owner(&app)?;
    if action == "snapshot" {
        let station = owner.snapshot()?;
        return Ok(serde_json::json!({"generation":station["generation"],"revision":station["revision"],
            "last_receipt":owner.unresolved_receipt("manual_rotor_goto")?,"worker_generation":worker::generation(),
            "rotor":rotor_telemetry::retained_snapshot()?}));
    }
    if action == "receipt" {
        let receipt = owner.receipt(params["operation_id"].as_str().ok_or("Missing operation identity.")?)?;
        if !receipt.is_null() && receipt["request"]["action"] != "manual_rotor_goto" {
            return Err("That operation identity does not belong to manual rotor Goto.".into());
        }
        return Ok(receipt);
    }
    if action == "review" {
        if params.as_object().is_none_or(|value| value.len() != 3) || params["reviewed_action"] != "manual_rotor_goto" {
            return Err("Invalid manual rotor review request.".into());
        }
        return owner.review(params["operation_id"].as_str().ok_or("Missing operation identity.")?, "manual_rotor_goto");
    }
    let changed = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || owner.apply(&params, |request, _, _| manual_rotor::execute(&params, request)))
        .await.map_err(|_| "Manual rotor task ended; inspect its receipt before retrying.".to_string())?;
    for label in ["main", "station-control", "monitor"] { let _ = changed.emit_to(label, "xlog:station-session", ()); }
    result
}

#[tauri::command]
async fn cw_session_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>,
    client: String, sequence: u64, params: serde_json::Value) -> Result<serde_json::Value, String> {
    cw_session::validate_surface(window.label(), state.path.is_some(), APP_EXITING.load(Ordering::Acquire), params["action"].as_str().unwrap_or(""))?;
    let focused = window.is_focused().unwrap_or(false) && window.is_visible().unwrap_or(false);
    if matches!(params["action"].as_str(), Some("arm" | "send"))
        && SPOT_ACTIVATION.get().is_some_and(|owner| owner.snapshot().map_or(true, |state| state["reservationActive"] == true)) {
        return Err("Wait for the protected draft selection before arming or sending CW. Stop remains available.".into());
    }
    let owner = cw_session_backend::owner(&app); let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let _output=if matches!(params["action"].as_str(),Some("arm"|"send")) {Some(carrier_tune::reserve_output()?)}else{None};
        owner.request(&label, &client, sequence, focused, &params)
    })
        .await.map_err(|_| "CW session task failed; use Stop before retrying.".to_string())?
}

#[tauri::command]
async fn worker_request(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    // Only typed integration operations cross this boundary; never shell commands.
    if state.path.is_some() { acceptance::validate_local_request(&request)?; }
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    if method == "station_action" && requires_durable_station_action(request["params"]["action"].as_str().unwrap_or("")) {
        return Err("Use the shared durable radio and amplifier owners.".into());
    }
    if is_raw_ptt_control(&request) {return Err("Use the durable GUI PTT owner".into());}
    if method == "station_tune" || method == "hamlib_control" && request["params"]["device"] == "radio" && request["params"]["action"] == "tune_simplex" {
        return Err("Use the shared manual simplex tune owner.".into());
    }
    if is_raw_manual_rotor_goto(&request) { return Err("Use the shared manual rotor Goto owner.".into()); }
    if matches!(method, "propagation_snapshot" | "propagation_refresh") { return Err("Use the shared propagation session.".into()); }
    if state.path.is_none() && is_raw_owned_station_lifecycle(&request) {
        return Err("Use the shared Station Control connection owner.".into());
    }
    if matches!(method, "winkeyer_arm" | "winkeyer_send" | "winkeyer_stop")
        || method == "station_radio_control" && matches!(request["params"]["control"].as_str(), Some("send_cw" | "clear_cw"))
        || method == "hamlib_control" && matches!(request["params"]["action"].as_str(), Some("cw" | "cw_stop")) {
        return Err("Use the shared CW session for CW output controls.".into());
    }
    // This explicit role gate precedes every native special dispatcher too.
    if matches!(workspace_windows::surface_role(window.label()), "monitor" | "log-qso" | "spot-history" | "world-map" | "band-maps" | "callsign-intelligence" | "station-control" | "cw" | "rotor" | "station-status" | "propagation" | "station-identity" | "alerts" | "antenna") { worker::validate_surface(window.label(), &request)?; }
    if state.path.is_none() && matches!(method, "opportunities_snapshot" | "opportunities_refresh") {
        worker::validate_surface(window.label(), &request)?;
        return tauri::async_runtime::spawn_blocking(move || opportunity_selection::snapshot(request)).await
            .map_err(|_| "Opportunity feed task failed".to_string())?;
    }
    if matches!(method, "settings_save" | "backup_restore" | "workspace_create" | "logbook_operator_draft_apply") || retires_automatic_rotor(&request) {
        if let Some(owner) = cw_session_backend::existing() {
            owner.revoke()?; tauri::async_runtime::spawn_blocking(move || { let _ = owner.stop(); });
        }
    }
    if matches!(method, "backup_restore" | "workspace_create") || retires_automatic_rotor(&request) {
        radio_follow::revoke("Workspace or radio configuration changed. Follow Radio is off.");
    }
    // Local acceptance permits cluster_history against its synthetic logbook,
    // but must never start the live session's background snapshot service.
    if state.path.is_none() && cluster_session::handles(method) && !local_history_reader(window.label(), method) {
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
    if method == "station_action" && request["params"]["action"] == "rotor_stop" {
        return Err("Legacy xCat rotor actions require migration to the selected rotor owner".into());
    }
    let hamlib_rotor = method.starts_with("hamlib_") && request["params"]["device"] == "rotor";
    let rotor_route = hamlib_rotor || method.starts_with("rotor_") || method.starts_with("station_rotor_");
    if rotor_route {
        if method.starts_with("hamlib_") {
            let monitor_allowed = method == "hamlib_snapshot" || (method == "hamlib_control"
                && matches!(request["params"]["action"].as_str(), Some("goto" | "stop")));
            let settings_catalogue = window.label() == "settings" && method == "hamlib_models";
            if window.label() != "main" && !(window.label() == "monitor" && monitor_allowed) && !settings_catalogue {
                return Err("This window cannot control Hamlib devices".into());
            }
        } else {
            worker::validate_surface(window.label(), &request)?;
        }
        let shared = state.path.is_none();
        return tauri::async_runtime::spawn_blocking(move || if shared { rotor_session::request(request) } else { rotor::request(request) })
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
        if retires_automatic_rotor(&request) { auto_rotor::revoke(); }
        let _telemetry_fence = if station_telemetry::changes_radio(&request) { Some(station_telemetry::owner(&app)?.control()?) } else { None };
        let _auto_change = if station_telemetry::changes_radio(&request) { Some(auto_rotor::canonical_will_change()) } else { None };
        let selection = if station_telemetry::changes_radio(&request) { Some(station_selection::owner(&app)?) } else { None };
        return tauri::async_runtime::spawn_blocking(move || if let Some(selection) = selection { selection.control(request) } else { hamlib::request(request) })
            .await.map_err(|_| "Hamlib task failed".to_string())?;
    }
    worker::validate_surface(window.label(), &request)?;
    if retires_automatic_rotor(&request) { auto_rotor::revoke(); }
    let _telemetry_fence = if station_telemetry::changes_radio(&request) { Some(station_telemetry::owner(&app)?.control()?) } else { None };
    let selection = if station_telemetry::changes_radio(&request) { Some(station_selection::owner(&app)?) } else { None };
    let invalidate = logbook_events::changes_logbook(&request);
    let map_changed = invalidate || matches!(method, "settings_save" | "workspace_preferences_save" | "workspace_band_map_apply" | "workspace_create" | "backup_restore");
    let settings_changed = matches!(method, "settings_save" | "backup_restore");
    let sync_changed = matches!(method, "sync_mutation" | "online_log_configure" | "settings_save" | "secret_save" | "workspace_create" | "backup_restore");
    let rotor_configuration_changed = matches!(method, "workspace_rotor_configuration_save" | "backup_restore");
    let rotor_configuration_mutation = state.path.is_none() && (rotor_configuration_changed || method == "workspace_create");
    if rotor_configuration_mutation { rotor_session::invalidate_configuration(); }
    // Retire metadata before a restore/write can race a map's retained read.
    if map_changed { map_context::invalidate(); }
    let draft_wake = DraftWake::for_request(&request);
    let auto_change = if draft_wake != DraftWake::None || station_telemetry::changes_radio(&request) {
        Some(auto_rotor::canonical_will_change())
    } else { None };
    let layout_changed = matches!(method, "workspace_layout_apply" | "workspace_create" | "backup_restore");
    let activate_layout = method == "workspace_layout_apply"
        && request["params"]["action"] == "activatePreset";
    let result = tauri::async_runtime::spawn_blocking(move || if let Some(selection) = selection { selection.control(request) }
        else if rotor_configuration_mutation { rotor_session::configuration_change(|| worker::request(request)) }
        else { worker::request(request) })
        .await
        .map_err(|_| "Worker task failed".to_string())?;
    drop(auto_change);
    if draft_wake.confirmed(result.as_ref().ok()) {
        // No draft/contact payload is broadcast. Each editor reloads canonical
        // state through its scoped IPC and retains its own unresolved journal.
        for label in ["main", "log-qso", "callsign-intelligence", "monitor"] { let _ = app.emit_to(label, OPERATOR_DRAFT_CHANGED, ()); }
        if state.path.is_none() {
            auto_rotor_reconcile::request(&app);
        }
    }
    if invalidate {
        // The initiating view already refreshes after its operation. In
        // particular, ADIF batches must not reload that view after every chunk.
        // The native sync monitor separately wakes all readers on completion.
        for label in ["main", "settings", "log-qso", "logbook", "awards", "callsign-intelligence"] {
            if label != window.label() { let _ = app.emit_to(label, "xlog:logbook-changed", ()); }
        }
    }
    if map_changed {
        map_context::invalidate();
        let _ = app.emit("xlog:map-context", ());
    }
    if settings_changed {
        for label in ["main", "settings"] { let _ = app.emit_to(label, "xlog:settings-changed", ()); }
    }
    if sync_changed {
        // Ownership admission and unknown outcomes invalidate every Sync view;
        // completion deduplication remains solely in the native monitor.
        for label in ["main", "settings"] { let _ = app.emit_to(label, "xlog:sync-changed", ()); }
    }
    if rotor_configuration_changed {
        for label in ["main", "settings"] { let _ = app.emit_to(label, "xlog:rotor-configuration-changed", ()); }
    }
    if layout_changed {
        // Wake-only: even an uncertain outcome is reconciled by a fresh read.
        for label in ["main", "monitor", "world-map", "band-maps", "dx-cluster", "log-qso", "spot-history", "logbook", "awards", "callsign-intelligence", "settings"] {
            let _ = app.emit_to(label, "xlog:workspace-layout", ());
        }
        let force = activate_layout && result.as_ref().is_ok_and(|response|
            response["ok"] == true && response["result"]["status"] == "applied");
        if let Err(error) = workspace_window_runtime::refresh(&app, force) {
            eprintln!("Could not reconcile saved workspace windows: {error}");
        }
    }
    result
}

#[tauri::command]
async fn pick_backup_package(window: tauri::WebviewWindow, state: tauri::State<'_, acceptance::Acceptance>) -> Result<Option<String>, String> {
    if state.path.is_some() { return Err("External backup import is disabled in local acceptance.".into()); }
    if !matches!(window.label(), "main" | "settings") {
        return Err("Only a Settings surface can import a backup".into());
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
async fn open_monitor(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    validate_detached_open(window.label())?;
    // Creating a Windows WebView from a synchronous IPC command can block its
    // message loop. Tauri must dispatch this native window work asynchronously.
    open_detached_workspace(app, "monitor".into()).await
}

#[tauri::command]
async fn open_detached_map(app: tauri::AppHandle, window: tauri::WebviewWindow, kind: String) -> Result<(), String> {
    validate_detached_open(window.label())?;
    open_detached_workspace(app, kind).await
}

fn validate_detached_open(label: &str) -> Result<(), String> {
    if label == "main" { Ok(()) }
    else { Err("Only the main workspace can open detached windows".into()) }
}

async fn open_detached_workspace(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || workspace_window_runtime::open(&app, &kind))
        .await.map_err(|_| "Native workspace window task failed".to_string())?
}

// Called only by the serialized native owner, never from the UI message loop.
fn ensure_workspace_window(app: &tauri::AppHandle, kind: &str, focus: bool) -> Result<bool, String> {
    let role = workspace_windows::surface_role(kind);
    let spec = workspace_windows::SUPPORTED_WINDOWS.iter().find(|spec| spec.id == role)
        .ok_or("Unknown native workspace window")?;
    if let Some(existing) = app.get_webview_window(kind) {
        if kind == "cw" && !existing.is_visible().unwrap_or(true) {
            if let Some(owner) = cw_session_backend::existing() { owner.allow_window(kind)?; }
        }
        existing.unminimize().map_err(|e| e.to_string())?;
        existing.show().map_err(|e| e.to_string())?;
        if focus { existing.set_focus().map_err(|e| e.to_string())?; }
        return Ok(false);
    }
    let suffix = if app.state::<acceptance::Acceptance>().path.is_some() { "&acceptance=local" } else { "" };
    let band = workspace_windows::band_map_band(kind);
    let route = band.map(|band| format!("band-maps&band={band}")).unwrap_or_else(|| kind.into());
    let title = band.map(|band| format!("OM0RX-xLog — {band} Band Map")).unwrap_or_else(|| spec.title.into());
    let mut builder = tauri::WebviewWindowBuilder::new(app, kind, tauri::WebviewUrl::App(format!("index.html?view={route}{suffix}").into()))
        .title(title)
        .inner_size(if role == "band-maps" { 380.0 } else { spec.width }, spec.height)
        .min_inner_size(if role == "band-maps" { 280.0 } else { 640.0 }, 480.0)
        .focused(focus)
        .always_on_top(false)
        .incognito(app.state::<acceptance::Acceptance>().path.is_some());
    if let Some(directory) = app.state::<acceptance::Acceptance>().detached_browser_context()? {
        builder = builder.data_directory(directory);
    }
    if kind == "cw" { if let Some(owner) = cw_session_backend::existing() { owner.allow_window(kind)?; } }
    let detached = builder.build().map_err(|e| e.to_string())?;
    workspace_window_runtime::created(&detached);
    if app.state::<acceptance::Acceptance>().path.is_none() {
        detached_geometry::install(&detached);
    }
    Ok(true)
}

#[tauri::command]
fn workspace_windows_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    if !matches!(window.label(), "main" | "settings") { return Err("Only a Settings surface can inspect saved window placement".into()); }
    workspace_window_runtime::status(&app)
}

#[tauri::command]
fn workspace_windows_reconcile(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    if !matches!(window.label(), "main" | "settings") { return Err("Only a Settings surface can apply saved window placement".into()); }
    workspace_window_runtime::refresh(&app, true).map(|attempt| serde_json::json!({"attempt":attempt}))
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
async fn dock_detached_window(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    let screen = detached_dock_screen(window.label())?;
    validate_editor_transition(window.label())?;
    if window.label() == "cw" {
        prepare_cw_close().await?;
        let result = async {
            navigate_workspace(app, screen.into()).await?;
            detached_geometry::flush(&window);
            window.destroy().map_err(|error| error.to_string())
        }.await;
        if result.is_err() { if let Some(owner) = cw_session_backend::existing() { let _ = owner.allow_window("cw"); } }
        return result;
    }
    // The revisioned route survives a main view that has not subscribed yet.
    navigate_workspace(app.clone(), screen.into()).await?;
    window.close().map_err(|error| error.to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|error| error.to_string())?;
        main.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn local_history_reader(label: &str, method: &str) -> bool {
    method == "cluster_history" && matches!(label, "main" | "logbook" | "log-qso" | "callsign-intelligence")
}

fn detached_dock_screen(label: &str) -> Result<&str, String> {
    match label {
        "callsign-intelligence" | "cw" | "rotor" | "station-status" | "propagation" | "station-identity" | "alerts" | "antenna" => Ok("operator-desk"),
        "dx-cluster" | "world-map" | "band-maps" | "log-qso" | "spot-history" | "logbook" | "awards" | "settings" | "station-control" => Ok(label),
        _ => Err("Only detachable workspaces can dock back".into()),
    }
}

async fn prepare_cw_close() -> Result<(), String> {
    if let Some(owner) = cw_session_backend::existing() {
        tauri::async_runtime::spawn_blocking(move || owner.prepare_close("cw")).await
            .map_err(|_| "CW close could not be verified; use Stop before retrying.".to_string())??;
    }
    Ok(())
}

#[tauri::command]
async fn close_cw_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "cw" { return Err("Only the CW window can close itself.".into()); }
    prepare_cw_close().await?;
    detached_geometry::flush(&window);
    let result = window.destroy().map_err(|error| error.to_string());
    if result.is_err() { if let Some(owner) = cw_session_backend::existing() { let _ = owner.allow_window("cw"); } }
    result
}

#[tauri::command]
async fn show_cw_desk(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "cw" { return Err("Only CW can request its Desk route.".into()); }
    navigate_workspace(app, "operator-desk".into()).await
}

#[tauri::command]
async fn show_rotor_desk(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "rotor" { return Err("Only Rotor can request its Desk route.".into()); }
    navigate_workspace(app, "operator-desk".into()).await
}

#[tauri::command]
fn close_rotor_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "rotor" { return Err("Only the Rotor window can close itself.".into()); }
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_station_status_desk(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "station-status" { return Err("Only Station Status can request its Desk route.".into()); }
    navigate_workspace(app, "operator-desk".into()).await
}

#[tauri::command]
fn close_station_status_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "station-status" { return Err("Only Station Status can close itself.".into()); }
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_propagation_desk(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "propagation" { return Err("Only Propagation can request its Desk route.".into()); }
    navigate_workspace(app, "operator-desk".into()).await
}

#[tauri::command]
fn close_propagation_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "propagation" { return Err("Only Propagation can close itself.".into()); }
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_station_identity_desk(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "station-identity" { return Err("Only Station Identity can request its Desk route.".into()); }
    navigate_workspace(app, "operator-desk".into()).await
}

#[tauri::command]
fn close_station_identity_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "station-identity" { return Err("Only Station Identity can close itself.".into()); }
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn close_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main workspace can close itself".into()); }
    validate_editor_transition(window.label())?;
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_alerts_desk(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "alerts" { return Err("Only Alerts can request its Desk route.".into()); }
    navigate_workspace(app, "operator-desk".into()).await
}
#[tauri::command]
fn close_alerts_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "alerts" { return Err("Only Alerts can close itself.".into()); }
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn close_qso_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "log-qso" { return Err("Only the Log QSO window can close itself".into()); }
    validate_editor_transition(window.label())?;
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_antenna_desk(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "antenna" { return Err("Only Antenna can request its Desk route.".into()); }
    navigate_workspace(app, "operator-desk".into()).await
}
#[tauri::command]
fn close_antenna_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "antenna" { return Err("Only Antenna can close itself.".into()); }
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
async fn close_logbook_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "logbook" { return Err("Only the Logbook window can close itself".into()); }
    validate_editor_transition(window.label())?;
    detached_geometry::flush(&window);
    window.destroy().map_err(|error| error.to_string())
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
    let isolated = path.is_some();
    let builder = tauri::Builder::default()
        .menu(workspace_menu)
        .on_window_event(|window, event| {
            if window.label() == "cw" {
                // The renderer requests the typed asynchronous Stop/guard path.
                // A missing listener or renderer crash must not bypass it.
                if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); }
            }
            if matches!(event, tauri::WindowEvent::Focused(false) | tauri::WindowEvent::Destroyed) {
                if let Some(owner) = cw_session_backend::existing() {
                    if let Ok(clients) = owner.revoke_window_clients(window.label()) {
                        // Pin retiring client identities before dispatch: a late
                        // callback must not release a replacement window's lease.
                        tauri::async_runtime::spawn_blocking(move || { let _ = owner.release_clients(&clients); });
                    }
                }
            }
            if !spot_editor_barrier::editor_role(window.label()) { return; }
            if let Some(owner) = SPOT_ACTIVATION.get() {
                match event {
                    tauri::WindowEvent::Destroyed => { let _ = owner.editors.destroyed(window.label()); }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        // A renderer crash or missed close listener cannot remove
                        // an editor while its shared draft is reserved.
                        if owner.snapshot().map(|state| state["reservationActive"] == true).unwrap_or(true) { api.prevent_close(); }
                    }
                    _ => {}
                }
            }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) && qsy_clear::reservation_active() {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); }
            }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) && radio_read::reservation_active() {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); }
            }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) && radio_follow::reservation_active() {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) && spot_editor_barrier::editor_role(window.label()) {
                radio_follow::editor_changed(window.label(), None);
            }
        })
        .on_menu_event(|app, event| {
            if let Some(mode) = workspace_navigation::mode_route(&event.id().0) {
                let app = app.clone(); let mode = mode.to_owned();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = navigate_workspace(app, mode).await { eprintln!("Could not switch workspace mode: {error}"); }
                });
                return;
            }
            if let Some(screen) = workspace_navigation::menu_screen(&event.id().0) {
                let app = app.clone(); let screen = screen.id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = navigate_workspace(app, screen).await { eprintln!("Could not open workspace screen: {error}"); }
                });
                return;
            }
            if let Some(kind) = event.id().0.strip_prefix("workspace_window_") {
                if workspace_windows::supports(kind) {
                    let app = app.clone(); let kind = kind.to_owned();
                    tauri::async_runtime::spawn(async move {
                        // Native menu intent is trusted; renderer IPC must pass
                        // its own main-only caller gate before reaching this owner.
                        let result = open_detached_workspace(app, kind).await;
                        if let Err(error) = result { eprintln!("Could not open workspace window: {error}"); }
                    });
                }
                return;
            }
            if let Some(layout) = WorkspaceLayout::from_menu_id(&event.id().0) {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || if let Err(error) = apply_workspace_layout(&app, layout) {
                    eprintln!("Could not resize main workspace: {error}");
                });
            }
        });
    let builder = builder.plugin(tauri_plugin_notification::init());
    let builder = if acceptance::use_production_singleton(isolated) {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || if let Err(error) = ensure_main_workspace(&app) {
                eprintln!("Could not recover main workspace: {error}");
            });
        }))
    } else { builder };
    builder
        .manage(acceptance::Acceptance::new(path))
        .manage(workspace_navigation::WorkspaceNavigation::default())
        .setup(|app| {
            acceptance::start_watchdog(app.handle().clone());
            if app.state::<acceptance::Acceptance>().path.is_none() {
                let activation = activation_owner(app.handle());
                qsy_clear::install(app.handle(), activation.editors.clone());
                radio_read::install(app.handle(), activation.editors.clone());
                radio_follow::install(app.handle(), activation.editors.clone());
                station_identity::install(app.handle());
                rotor_session::install(app.handle()).map_err(std::io::Error::other)?;
                let selection_app = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = station_selection::owner(&selection_app).and_then(|owner| {
                        // Native saved intent seeds display polling once. Passive
                        // window reads never default, migrate or choose a radio.
                        let saved = owner.snapshot()?;
                        if saved["provider"].is_string() {
                            station_telemetry::owner(&selection_app)?.select_selection(&saved, true)?;
                        }
                        owner.notify_saved()?;
                        // Startup alone restores native saved Agent intent.
                        // Snapshot/renderer reads remain passive; an intervening
                        // handover or radio control invalidates this exact view.
                        station_session::owner(&selection_app)?.resume_saved_agent(&saved, |request, generation, identity| {
                            owner.receive_control(request, generation, identity, 0,
                                || station_telemetry::owner(&selection_app)?.control())
                        })?;
                        Ok(())
                    }) {
                        eprintln!("Native station startup unavailable: {error}");
                    }
                    if let Err(error) = rotor_session::resume() {
                        eprintln!("Native rotor startup unavailable: {error}");
                    }
                });
                dx_alerts::install(app.handle()).map_err(std::io::Error::other)?;
                cluster_session::owner(app.handle()).map_err(std::io::Error::other)?;
                if let Err(error) = logbook_events::start(app.handle()) {
                    eprintln!("Native sync completion notifications unavailable: {error}");
                }
                if let Some(main) = app.get_webview_window("main") { detached_geometry::install(&main); }
                workspace_window_runtime::refresh(app.handle(), false).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![worker_request, cw_session_request, station_session_request, radio_release_request, carrier_tune_request, ptt_session_request, amplifier_transition_request, manual_rotor_request, pick_backup_package, open_monitor, open_detached_map,
            spot_editor_register, spot_editor_unregister, spot_editor_ack, spot_editor_state,
            spot_activation_snapshot, spot_activation_status, spot_activation_reconcile, activate_spot, activate_opportunity,
            operator_draft_read_radio,
            operator_draft_read_radio_recover,
            operator_draft_follow_snapshot, operator_draft_follow_set, operator_draft_follow_settled,
            auto_rotor_snapshot, auto_rotor_set,
            workspace_windows_status, workspace_windows_reconcile, workspace_mode_present, workspace_canvas_close_ack,
            workspace_navigation_snapshot, workspace_navigation_ack, map_context_snapshot, monitor_context_snapshot, monitor_station_action, monitor_rotor_stop, rotor_telemetry_snapshot, station_telemetry_snapshot, station_selection_snapshot, station_status_snapshot, propagation_session_request, station_identity_snapshot, alerts_snapshot, dx_alerts_snapshot, dx_alerts_save, dx_alerts_test, dx_alerts_clear, antenna_snapshot,
            detached_cluster_ready, cluster_session_selection, dock_detached_window, close_logbook_window, close_qso_window, close_main_window, close_cw_window, show_cw_desk, close_rotor_window, show_rotor_desk, close_station_status_window, show_station_status_desk, close_propagation_window, show_propagation_desk, close_station_identity_window, show_station_identity_desk, close_alerts_window, show_alerts_desk, close_antenna_window, show_antenna_desk,
            acceptance::acceptance_enabled, acceptance::acceptance_large_log, acceptance::acceptance_monitor,
            acceptance::acceptance_screen, acceptance::acceptance_desk_size,
            acceptance::acceptance_open_window, acceptance::acceptance_window_step, acceptance::acceptance_window_state, acceptance::acceptance_close_window,
            acceptance::acceptance_spot_history_begin, acceptance::acceptance_spot_history_state,
            acceptance::acceptance_monitor_result, acceptance::acceptance_logbook_result, acceptance::acceptance_awards_result, acceptance::acceptance_prepare_final,
            acceptance::finish_acceptance])
        .build(context)
        .expect("Application failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                APP_EXITING.store(true, Ordering::Release);
                rotor_session::shutdown();
                station_identity::shutdown();
                dx_alerts::shutdown();
                propagation_session::shutdown();
                if let Some(owner) = cw_session_backend::existing() { let _ = owner.stop(); }
                auto_rotor::revoke();
                auto_rotor_reconcile::shutdown();
                logbook_events::shutdown();
                workspace_window_runtime::shutdown();
                detached_geometry::shutdown(app);
            }
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || if let Err(error) = ensure_main_workspace(&app) {
                    eprintln!("Could not recover main workspace: {error}");
                });
            }
            if matches!(event, tauri::RunEvent::Exit) {
                radio_follow::revoke("The application is exiting. Follow Radio is off.");
                auto_rotor::revoke();
                auto_rotor_reconcile::shutdown();
                logbook_events::shutdown();
                rotor_session::shutdown(); station_selection::shutdown(); station_telemetry::shutdown(); rotor_telemetry::shutdown(); cluster_session::shutdown(); winkeyer::shutdown(); hamlib::shutdown(); worker::shutdown();
                app.state::<acceptance::Acceptance>().cleanup_browser_contexts();
            }
        });
}

#[cfg(test)]
mod workspace_layout_tests {
    use super::{WorkspaceLayout, DraftWake, recover_singleton, detached_window_shortcut, validate_detached_open, COMPACT_WORKSPACE_MENU_ID, STANDARD_WORKSPACE_MENU_ID};
    use super::{spot_editor_barrier, validate_spot_effect, validate_activation_reader, retires_automatic_rotor, is_raw_manual_rotor_goto, is_raw_owned_station_lifecycle, validate_auto_rotor_read, validate_auto_rotor_set, validate_radio_read, validate_follow_settlement, validate_rotor_stop, AutomaticRotorCommands};
    use serde_json::json;

    #[test]
    fn amplifier_and_radio_actions_have_no_legacy_raw_or_monitor_bypass() {
        for provider in ["direct_agent","direct_flex_lan"]{for enabled in [true,false]{assert!(super::is_raw_ptt_control(&json!({"method":"station_radio_control","params":{"provider":provider,"control":"ptt","enabled":enabled}})));}}
        assert!(!super::is_raw_ptt_control(&json!({"method":"station_radio_control","params":{"control":"set_rf_power"}})));
        for provider in ["direct_agent", "direct_flex_lan", "direct_tci"] {
            for method in ["station_connect", "station_disconnect", "station_reconnect", "station_forget"] {
                assert!(is_raw_owned_station_lifecycle(&json!({"method":method,"params":{"provider":provider}})), "{provider}:{method}");
            }
        }
        assert!(is_raw_owned_station_lifecycle(&json!({"method":"hamlib_connect","params":{"device":"radio"}})));
        assert!(!is_raw_owned_station_lifecycle(&json!({"method":"station_snapshot","params":{"provider":"direct_tci"}})));
        assert!(!is_raw_owned_station_lifecycle(&json!({"method":"station_connect","params":{"provider":"unknown"}})));
        for action in ["operate","standby","tune","cancel"] {
            assert!(super::requires_durable_station_action(action));
        }
        for action in ["","rotor_stop","rotor_goto","connect","ptt"] {
            assert!(!super::requires_durable_station_action(action));
        }
        for label in ["main","monitor","station-control"] {
            for action in ["snapshot","operate","standby","receipt","review"] {
                assert!(crate::amplifier_transition::validate(label,false,false,action).is_ok());
                assert!(crate::amplifier_transition::validate(label,true,false,action).is_err());
                assert!(crate::amplifier_transition::validate(label,false,true,action).is_err());
            }
        }
        for label in ["cw","rotor","station-status","settings","unknown"] {
            assert!(crate::amplifier_transition::validate(label,false,false,"standby").is_err());
        }
    }

    #[test]
    fn read_only_rotor_window_docks_to_recoverable_desk_without_a_motion_shortcut() {
        assert!(crate::workspace_windows::supports("rotor"));
        assert_eq!(super::detached_dock_screen("rotor").unwrap(), "operator-desk");
        assert_eq!(detached_window_shortcut("rotor"), None);
    }
    #[test]
    fn every_legacy_renderer_rotor_goto_route_is_owned_by_the_durable_session() {
        for request in [
            json!({"method":"rotor_goto","params":{}}),
            json!({"method":"station_rotor_goto","params":{}}),
            json!({"method":"station_action","params":{"action":"rotor_goto"}}),
            json!({"method":"hamlib_control","params":{"device":"rotor","action":"goto"}}),
        ] { assert!(is_raw_manual_rotor_goto(&request)); }
        for request in [
            json!({"method":"rotor_stop","params":{}}),
            json!({"method":"station_rotor_stop","params":{}}),
            json!({"method":"hamlib_control","params":{"device":"rotor","action":"stop"}}),
            json!({"method":"hamlib_control","params":{"device":"radio","action":"goto"}}),
        ] { assert!(!is_raw_manual_rotor_goto(&request)); }
    }
    #[test]
    fn station_status_window_docks_to_recoverable_desk_without_control_shortcuts() {
        assert!(crate::workspace_windows::supports("station-status"));
        assert_eq!(super::detached_dock_screen("station-status").unwrap(), "operator-desk");
        assert_eq!(detached_window_shortcut("station-status"), None);
    }
    #[test]
    fn propagation_window_docks_to_recoverable_desk_without_control_shortcuts() {
        assert!(crate::workspace_windows::supports("propagation"));
        assert_eq!(super::detached_dock_screen("propagation").unwrap(), "operator-desk");
        assert_eq!(detached_window_shortcut("propagation"), None);
    }
    #[test]
    fn station_identity_window_docks_to_recoverable_desk_without_control_shortcuts() {
        assert!(crate::workspace_windows::supports("station-identity"));
        assert_eq!(super::detached_dock_screen("station-identity").unwrap(), "operator-desk");
        assert_eq!(detached_window_shortcut("station-identity"), None);
    }
    #[test]
    fn alerts_window_docks_to_recoverable_desk_without_control_shortcuts() {
        assert!(crate::workspace_windows::supports("alerts"));
        assert_eq!(super::detached_dock_screen("alerts").unwrap(), "operator-desk");
        assert_eq!(detached_window_shortcut("alerts"), None);
    }
    #[test]
    fn antenna_window_docks_to_recoverable_desk_without_control_shortcuts() {
        assert!(crate::workspace_windows::supports("antenna"));
        assert_eq!(super::detached_dock_screen("antenna").unwrap(), "operator-desk");
        assert_eq!(detached_window_shortcut("antenna"), None);
    }

    #[test]
    fn automatic_rotor_set_allows_only_live_rotor_surfaces_and_never_isolation_or_shutdown() {
        for label in crate::auto_rotor::CLIENT_WINDOWS {
            assert!(validate_auto_rotor_set(label, false, false).is_ok(), "{label}");
        }
        for label in crate::workspace_windows::SUPPORTED_WINDOWS.iter().map(|window| window.id)
            .chain(["main", "rotor", "settings", "station-control", "sync", "unknown", "", "MAIN", "Monitor"]) {
            assert_eq!(validate_auto_rotor_read(label, false, false).is_ok(), crate::auto_rotor::client_role(label), "{label}");
            assert_eq!(validate_auto_rotor_set(label, false, false).is_ok(), crate::auto_rotor::client_role(label), "{label}");
            for (isolated, exiting) in [(true, false), (false, true), (true, true)] {
                assert!(validate_auto_rotor_read(label, isolated, exiting).is_err(), "{label} isolated={isolated} exiting={exiting}");
                assert!(validate_auto_rotor_set(label, isolated, exiting).is_err(), "{label} isolated={isolated} exiting={exiting}");
            }
        }
    }

    #[test]
    fn rotor_stop_is_available_only_to_exact_live_control_surfaces() {
        for label in crate::workspace_windows::SUPPORTED_WINDOWS.iter().map(|window| window.id)
            .chain(["main", "rotor", "monitor", "station-status", "station-control", "unknown", "", "MAIN", "Monitor"]) {
            assert_eq!(validate_rotor_stop(label, false, false).is_ok(), matches!(label, "main" | "monitor" | "rotor" | "station-control"), "{label}");
            for (isolated, exiting) in [(true, false), (false, true), (true, true)] {
                assert!(validate_rotor_stop(label, isolated, exiting).is_err(), "{label} isolated={isolated} exiting={exiting}");
            }
        }
    }

    #[test]
    fn explicit_radio_read_is_available_only_to_live_new_qso_editors() {
        for label in crate::workspace_windows::SUPPORTED_WINDOWS.iter().map(|window| window.id)
            .chain(["main", "log-qso", "logbook", "monitor", "station-control", "unknown", "", "MAIN"]) {
            assert_eq!(validate_radio_read(label, false, false).is_ok(), matches!(label, "main" | "log-qso"), "{label}");
            assert_eq!(validate_follow_settlement(label, false, false).is_ok(), spot_editor_barrier::editor_role(label), "{label}");
            for (isolated, exiting) in [(true, false), (false, true), (true, true)] {
                assert!(validate_radio_read(label, isolated, exiting).is_err(), "{label} isolated={isolated} exiting={exiting}");
                assert!(validate_follow_settlement(label, isolated, exiting).is_err(), "{label} isolated={isolated} exiting={exiting}");
            }
        }
    }

    #[test]
    fn delayed_arm_cannot_survive_a_later_off_request() {
        use std::sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc};
        let commands = Arc::new(AutomaticRotorCommands::default());
        let armed = Arc::new(AtomicBool::new(false));
        let old = commands.begin(true, || Ok(0), || panic!("Arm cannot revoke")).unwrap();
        let (ready, entered) = mpsc::channel(); let (release, resumed) = mpsc::channel();
        let background = commands.clone(); let changed = armed.clone();
        let delayed = std::thread::spawn(move || {
            ready.send(()).unwrap(); resumed.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
            background.apply(old, |_| { changed.store(true, Ordering::Release); Ok(()) })
        });
        entered.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
        let off = commands.begin(false, || Ok(1), || armed.store(false, Ordering::Release)).unwrap();
        commands.apply(off, |_| { armed.store(false, Ordering::Release); Ok(()) }).unwrap();
        release.send(()).unwrap(); assert!(delayed.join().unwrap().is_err());
        assert!(!armed.load(Ordering::Acquire));
    }

    #[test]
    fn newer_explicit_arm_wins_without_old_arm_or_off_replay() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let commands = AutomaticRotorCommands::default(); let armed = AtomicBool::new(false);
        let old_arm = commands.begin(true, || Ok(0), || panic!("Arm cannot revoke")).unwrap();
        let old_off = commands.begin(false, || Ok(1), || armed.store(false, Ordering::Release)).unwrap();
        let new_arm = commands.begin(true, || Ok(1), || panic!("Arm cannot revoke")).unwrap();
        commands.apply(new_arm, |epoch| { assert_eq!(epoch, 1); armed.store(true, Ordering::Release); Ok(()) }).unwrap();
        for old in [old_arm, old_off] {
            assert!(commands.apply(old, |_| { armed.store(false, Ordering::Release); Ok(()) }).is_err());
        }
        assert!(armed.load(Ordering::Acquire));
    }

    #[test]
    fn exhausted_command_sequence_still_revokes_off_and_retires_the_last_arm() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let commands = AutomaticRotorCommands(std::sync::Mutex::new(9_007_199_254_740_990));
        let armed = AtomicBool::new(true);
        let last = commands.begin(true, || Ok(0), || panic!("Arm cannot revoke")).unwrap();
        assert!(commands.begin(false, || Ok(1), || armed.store(false, Ordering::Release)).is_err());
        assert!(!armed.load(Ordering::Acquire));
        assert!(commands.apply(last, |_| { armed.store(true, Ordering::Release); Ok(()) }).is_err());
        assert!(commands.begin(true, || Ok(1), || panic!("Arm cannot revoke")).is_err());
        assert!(!armed.load(Ordering::Acquire));
    }

    #[test]
    fn spot_activation_capabilities_are_role_scoped_and_never_bypass_isolation_or_shutdown() {
        for label in ["main", "dx-cluster", "world-map", "band-maps", "log-qso", "logbook", "monitor", "settings", "chaser-dx", "station-control", "unknown"] {
            let writer = spot_editor_barrier::activation_role(label);
            assert_eq!(validate_spot_effect(label, false, false).is_ok(), writer);
            assert!(validate_spot_effect(label, true, false).is_err());
            assert!(validate_spot_effect(label, false, true).is_err());
            assert_eq!(validate_activation_reader(label).is_ok(), label == "chaser-dx" || writer || spot_editor_barrier::editor_role(label));
            assert_eq!(crate::validate_opportunity_effect(label,false,false).is_ok(), matches!(label,"main" | "chaser-dx"));
            assert!(crate::validate_opportunity_effect(label,true,false).is_err()); assert!(crate::validate_opportunity_effect(label,false,true).is_err());
        }
        for method in ["workspace_create", "backup_restore", "station_connect", "station_disconnect", "station_reconnect"] {
            assert!(retires_automatic_rotor(&serde_json::json!({"method":method,"params":{}})));
        }
        assert!(!retires_automatic_rotor(&serde_json::json!({"method":"logbook_operator_draft_apply","params":{"action":"replace"}})));
        assert!(retires_automatic_rotor(&serde_json::json!({"method":"hamlib_disconnect","params":{"device":"radio"}})));
    }

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
    fn renderer_detached_open_gate_is_main_only_including_monitor_and_log_qso() {
        assert!(validate_detached_open("main").is_ok());
        for spec in crate::workspace_windows::SUPPORTED_WINDOWS {
            assert!(validate_detached_open(spec.id).is_err(), "{}", spec.id);
        }
        for label in ["", "unknown", "MAIN"] { assert!(validate_detached_open(label).is_err()); }
    }

    #[test]
    fn draft_wakes_only_confirmed_mutations_but_reconcile_uncertain_workspace_changes() {
        let applied = json!({"ok":true,"result":{"status":"applied"}});
        for action in ["replace", "clear", "save"] {
            let wake = DraftWake::for_request(&json!({"method":"logbook_operator_draft_apply","params":{"action":action}}));
            assert!(wake.confirmed(Some(&applied)));
            for response in [json!({"ok":true,"result":{"status":"conflict"}}), json!({"ok":true,"result":{"status":"workspace_changed"}}), json!({"ok":false,"result":{"status":"applied"}}), json!({})] {
                assert!(!wake.confirmed(Some(&response)));
            }
            assert!(!wake.confirmed(None));
        }
        for method in ["workspace_create", "backup_restore"] {
            assert!(DraftWake::for_request(&json!({"method":method})).confirmed(None));
        }
        for method in ["logbook_operator_draft", "logbook_operator_draft_receipt", "lookup_call", "station_tune", "settings_load"] {
            assert!(!DraftWake::for_request(&json!({"method":method})).confirmed(Some(&applied)));
        }
        assert!(!DraftWake::for_request(&json!({"method":"logbook_operator_draft_apply","params":{"action":"unknown"}})).confirmed(Some(&applied)));
    }

    #[test]
    fn log_qso_native_shortcut_is_global_and_does_not_replace_embedded_screen_shortcut() {
        assert_eq!(detached_window_shortcut("log-qso"), Some("CmdOrCtrl+L"));
        assert_eq!(detached_window_shortcut("cw"), Some("CmdOrCtrl+Shift+K"));
        assert_eq!(crate::workspace_navigation::screen("log-qso").unwrap().shortcut.as_deref(), Some("CmdOrCtrl+2"));
        for window in crate::workspace_windows::SUPPORTED_WINDOWS {
            if !matches!(window.id, "log-qso" | "cw") { assert_eq!(detached_window_shortcut(window.id), None); }
        }
    }

    #[test]
    fn main_recovery_serializes_concurrent_creators_and_reuses_existing_lifetime() {
        use std::sync::{atomic::{AtomicUsize, Ordering}, Mutex};
        let creation = Mutex::new(());
        let live = Mutex::new(None);
        let count = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            let tasks: Vec<_> = (0..8).map(|_| scope.spawn(|| recover_singleton(&creation, || *live.lock().unwrap(), || {
                let next = count.fetch_add(1, Ordering::AcqRel) + 1;
                *live.lock().unwrap() = Some(next);
                Ok(next)
            }).unwrap())).collect();
            for task in tasks { assert_eq!(task.join().unwrap(), 1); }
        });
        assert_eq!(count.load(Ordering::Acquire), 1);
        *live.lock().unwrap() = None;
        let next = recover_singleton(&creation, || *live.lock().unwrap(), || { *live.lock().unwrap() = Some(2); Ok(2) }).unwrap();
        assert_eq!(next, 2);
    }

    #[test]
    fn failed_main_creation_remains_retryable_without_claiming_a_window() {
        let creation = std::sync::Mutex::new(());
        assert!(recover_singleton::<u8>(&creation, || None, || Err("fixture failure".into())).is_err());
        assert_eq!(recover_singleton(&creation, || None, || Ok(1)).unwrap(), 1);
    }

}

#[cfg(test)]
mod intelligence_window_tests {
    #[test]
    fn intelligence_history_exemption_is_local_and_method_specific() {
        // The Operator Desk lives in `main`; its history must use the local
        // logbook even when the live cluster session is unavailable or busy.
        for label in ["main", "callsign-intelligence", "logbook", "log-qso"] {
            assert!(super::local_history_reader(label, "cluster_history"));
            for method in ["cluster_snapshot", "cluster_connect", "cluster_disconnect", "cluster_command", "lookup_call"] {
                assert!(!super::local_history_reader(label, method));
            }
        }
        for label in ["monitor", "world-map", "band-maps", "unknown", ""] {
            assert!(!super::local_history_reader(label, "cluster_history"));
        }
    }
    #[test]
    fn intelligence_docks_to_the_existing_desk_without_a_new_main_screen() {
        let screen = super::detached_dock_screen("callsign-intelligence").unwrap();
        assert_eq!(screen, "operator-desk"); assert!(crate::workspace_navigation::screen(screen).is_some());
        for label in ["log-qso", "logbook", "awards", "spot-history", "world-map", "band-maps", "dx-cluster", "settings", "station-control"] {
            assert_eq!(super::detached_dock_screen(label).unwrap(), label);
            assert!(crate::workspace_navigation::screen(label).is_some());
        }
        for label in ["main", "monitor", "active-qso", "unknown", ""] { assert!(super::detached_dock_screen(label).is_err()); }
    }
}
