use crate::window_geometry::{self as geometry, Bounds, Display, Document, Position, SavedWindow};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, WindowEvent};

const DEBOUNCE: Duration = Duration::from_millis(300);
const TOPOLOGY_INTERVAL: Duration = Duration::from_secs(2);

fn display(monitor: &tauri::Monitor) -> Display {
    let area = monitor.work_area();
    Display { name: monitor.name().cloned(), scale: monitor.scale_factor(), work: Bounds {
        x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height } }
}

fn displays(window: &tauri::WebviewWindow) -> Vec<Display> {
    let mut values: Vec<_> = window.available_monitors().unwrap_or_default().iter().map(display).filter(Display::valid).collect();
    values.sort_by(|a, b| (&a.name, a.work.x, a.work.y).cmp(&(&b.name, b.work.x, b.work.y)));
    values
}
fn bounds(window: &tauri::WebviewWindow, positioning: bool) -> Option<Bounds> {
    let size = window.inner_size().ok()?;
    let position = if positioning { window.outer_position().ok()? } else { PhysicalPosition::new(0, 0) };
    Some(Bounds { x: position.x, y: position.y, width: size.width, height: size.height })
}
fn supports_positioning() -> bool {
    // GTK exposes no authoritative Wayland origin. Conservatively prefer size
    // recovery in a Wayland session unless GTK explicitly selects X11.
    if !cfg!(target_os = "linux") { return true; }
    let backend = std::env::var("GDK_BACKEND").unwrap_or_default();
    positioning_for_backend(&backend, &std::env::var("XDG_SESSION_TYPE").unwrap_or_default(),
        std::env::var("WAYLAND_DISPLAY").is_ok_and(|value| !value.is_empty()))
}
fn positioning_for_backend(backend: &str, session: &str, wayland_display: bool) -> bool {
    backend == "x11" || (!backend.contains("wayland") && session != "wayland" && !wayland_display)
}
fn chrome(window: &tauri::WebviewWindow) -> (f64, f64) {
    let scale = window.scale_factor().ok().filter(|value| value.is_finite() && *value > 0.0).unwrap_or(1.0);
    window.outer_size().ok().zip(window.inner_size().ok()).map(|(outer, inner)|
        (outer.width.saturating_sub(inner.width) as f64 / scale, outer.height.saturating_sub(inner.height) as f64 / scale)).unwrap_or((0.0, 0.0))
}
fn read(directory: &Path) -> Result<Document, String> {
    let path = directory.join("workspace-window-geometry.json");
    match std::fs::read(&path) {
        Ok(bytes) => {
            if bytes.len() > 262_144 { return Err("Window geometry file is too large".into()); }
            let document: Document = serde_json::from_slice(&bytes).map_err(|_| "Window geometry file is invalid")?;
            document.validate()?; Ok(document)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Migration preserves the original file and its unknown DPI.
            match std::fs::read(directory.join("detached-window-geometry.json")) {
                Ok(bytes) => {
                    if bytes.len() > 262_144 { return Err("Legacy geometry file is too large".into()); }
                    let old: HashMap<String, Bounds> = serde_json::from_slice(&bytes).map_err(|_| "Legacy geometry file is invalid")?;
                    let document = Document { version: 2, windows: old.into_iter().map(|(label, bounds)|
                        (label, SavedWindow { normal: Position::Legacy { bounds }, maximized: false })).collect() };
                    document.validate()?; Ok(document)
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Document::default()),
                Err(error) => Err(error.to_string()),
            }
        }
        Err(error) => Err(error.to_string()),
    }
}
fn save(directory: &Path, label: &str, saved: &SavedWindow) -> Result<(), String> {
    static FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = FILE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| "Window geometry writer unavailable")?;
    let mut document = read(directory)?;
    document.windows.insert(label.into(), saved.clone()); document.validate()?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    serde_json::to_writer(file.as_file_mut(), &document).map_err(|error| error.to_string())?;
    file.flush().and_then(|_| file.as_file().sync_all()).map_err(|error| error.to_string())?;
    file.persist(directory.join("workspace-window-geometry.json")).map_err(|error| error.to_string())?;
    Ok(())
}
struct Tracking {
    saved: SavedWindow,
    baseline: Bounds,
    displays: Vec<Display>,
    changed: Instant,
    dirty: bool,
    queued: bool,
    topology_checked: Instant,
    positioning: bool,
    settling: bool,
    persisted: bool,
    closed: bool,
}
struct Registration { directory: PathBuf, tracking: Weak<Mutex<Tracking>> }
fn registrations() -> &'static Mutex<HashMap<String, Registration>> {
    static WINDOWS: OnceLock<Mutex<HashMap<String, Registration>>> = OnceLock::new();
    WINDOWS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn current_display(window: &tauri::WebviewWindow, topology: &[Display]) -> Option<Display> {
    window.current_monitor().ok().flatten().map(|monitor| display(&monitor)).filter(Display::valid)
        .or_else(|| topology.first().cloned())
}
fn minimum(window: &tauri::WebviewWindow, display: &Display) -> Result<(), String> {
    let (width, height) = geometry::effective_minimum(window.label(), display, chrome(window));
    window.set_min_size(Some(LogicalSize::new(width, height))).map_err(|error| error.to_string())
}
fn apply(window: &tauri::WebviewWindow, saved: &SavedWindow, topology: &[Display], positioning: bool) -> Result<Bounds, String> {
    let requested = if positioning { geometry::restore(saved, topology, chrome(window)) } else {
        current_display(window, topology).and_then(|display| geometry::restore_size(saved, &display, chrome(window)))
    }.ok_or("No display available for window recovery")?;
    let target = if positioning { geometry::closest(requested, topology).cloned() } else { current_display(window, topology) }
        .ok_or("No display available for minimum size")?;
    if window.is_maximized().unwrap_or(false) { window.unmaximize().map_err(|error| error.to_string())?; }
    minimum(window, &target)?;
    // Move first so the explicit physical size is applied at the destination
    // DPI after any platform adjustment caused by crossing monitors.
    if positioning { window.set_position(PhysicalPosition::new(requested.x, requested.y)).map_err(|error| error.to_string())?; }
    window.set_size(PhysicalSize::new(requested.width, requested.height)).map_err(|error| error.to_string())?;
    if saved.maximized { window.maximize().map_err(|error| error.to_string())?; }
    Ok(if positioning { requested } else { Bounds { x: 0, y: 0, ..requested } })
}
/// Install once per native window; never in isolated acceptance, which must not
/// access the user's geometry/configuration. No renderer or station dependency.
pub fn install(window: &tauri::WebviewWindow) {
    if let Err(error) = install_inner(window) { eprintln!("Window geometry: {error}"); }
}
fn install_inner(window: &tauri::WebviewWindow) -> Result<(), String> {
    let directory = window.app_handle().path().app_config_dir().map_err(|error| error.to_string())?;
    let topology = displays(window);
    let positioning = supports_positioning();
    let current = bounds(window, positioning).ok_or("Window geometry unavailable")?;
    let existing = read(&directory)?.windows.remove(window.label());
    let saved = existing.clone().or_else(|| if positioning { geometry::capture(current, &topology, false) } else {
        geometry::capture_size(current, window.scale_factor().ok()?, false)
    }).ok_or("No display available")?;
    let baseline = apply(window, &saved, &topology, positioning)?;
    let state = Arc::new(Mutex::new(Tracking { saved, baseline, displays: topology, changed: Instant::now(), dirty: true, queued: false,
        topology_checked: Instant::now(), positioning, settling: true, persisted: existing.is_some(), closed: false }));
    registrations().lock().map_err(|_| "Window geometry registry unavailable")?.insert(window.label().into(),
        Registration { directory: directory.clone(), tracking: Arc::downgrade(&state) });
    let observed = window.clone(); let events = state.clone(); let event_directory = directory.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Ok(mut state) = events.lock() { state.closed = true; }
            return;
        }
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } | WindowEvent::CloseRequested { .. }) { return; }
        let Ok(mut tracking) = events.lock() else { return; };
        if tracking.closed { return; }
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            tracking.closed = true; drop(tracking);
            record(&observed, &event_directory, &events, None, true); return;
        }
        tracking.changed = Instant::now(); tracking.dirty = true;
    });
    schedule(window.clone(), directory, state);
    Ok(())
}
fn schedule(window: tauri::WebviewWindow, directory: PathBuf, state: Arc<Mutex<Tracking>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(DEBOUNCE);
        let Ok(mut tracking) = state.lock() else { return; };
        if tracking.closed { return; }
        if tracking.queued { continue; }
        let dirty = tracking.dirty && tracking.changed.elapsed() >= DEBOUNCE;
        let inspect_topology = tracking.topology_checked.elapsed() >= TOPOLOGY_INTERVAL;
        if inspect_topology { tracking.topology_checked = Instant::now(); }
        let started = tracking.changed; drop(tracking);
        if !dirty && !inspect_topology { continue; }
        let topology = if !dirty {
            let topology = displays(&window);
            let Ok(tracking) = state.lock() else { return; };
            if tracking.closed { return; }
            // Idle windows only query topology; no geometry getter or disk IO.
            if topology.is_empty() || topology == tracking.displays { continue; }
            Some(topology)
        } else { None };
        let Ok(mut tracking) = state.lock() else { return; };
        if tracking.closed { return; }
        tracking.queued = true; drop(tracking);
        let observed = window.clone(); let events = state.clone(); let event_directory = directory.clone();
        // Native mutation/readback runs serially with CloseRequested. A queued
        // observation checks closed before touching a window stopped by flush.
        if let Err(error) = window.run_on_main_thread(move || {
            let settle = record(&observed, &event_directory, &events, topology, false);
            let Ok(mut tracking) = events.lock() else { return; };
            tracking.queued = false;
            if tracking.closed { return; }
            if settle { tracking.changed = Instant::now(); tracking.dirty = true; }
            else if tracking.changed <= started { tracking.dirty = false; }
        }) {
            if let Ok(mut tracking) = state.lock() { tracking.queued = false; }
            eprintln!("Window geometry observation unavailable: {error}");
        }
    });
}
/// Stop debounce before a forced destroy or process exit, then synchronously
/// persist the last authoritative observation while native getters still work.
pub fn flush(window: &tauri::WebviewWindow) {
    let registration = registrations().lock().ok().and_then(|windows| windows.get(window.label())
        .and_then(|entry| entry.tracking.upgrade().map(|state| (entry.directory.clone(), state))));
    let Some((directory, state)) = registration else { return; };
    if let Ok(mut tracking) = state.lock() { tracking.closed = true; } else { return; }
    record(window, &directory, &state, None, true);
}
pub fn shutdown(app: &tauri::AppHandle) {
    for window in app.webview_windows().values() { flush(window); }
}
fn observation(tracking: &Tracking, current: Bounds, topology: &[Display], scale: f64, maximized: bool, finalizing: bool) -> Option<SavedWindow> {
    if tracking.closed && !finalizing { return None; }
    if tracking.settling || topology != tracking.displays {
        return finalizing.then(|| tracking.saved.clone());
    }
    let next = if tracking.positioning { geometry::observed(&tracking.saved, tracking.baseline, current, topology, maximized) } else {
        geometry::observed_size(&tracking.saved, tracking.baseline, current, scale, maximized)
    };
    if finalizing { Some(next.unwrap_or_else(|| tracking.saved.clone())) } else { next }
}
fn record(window: &tauri::WebviewWindow, directory: &Path, state: &Mutex<Tracking>, topology: Option<Vec<Display>>, finalizing: bool) -> bool {
    let positioning = match state.lock() { Ok(tracking) if finalizing || !tracking.closed => tracking.positioning, _ => return false };
    if window.is_minimized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
        if finalizing {
            if let Ok(tracking) = state.lock() {
                if let Err(error) = save(directory, window.label(), &tracking.saved) { eprintln!("Window geometry was not saved: {error}"); }
            }
        }
        return false;
    }
    let (Some(current), topology) = (bounds(window, positioning), topology.unwrap_or_else(|| displays(window))) else { return false; };
    if topology.is_empty() { return false; }
    let maximized = window.is_maximized().unwrap_or(false);
    if !finalizing {
        if let Some(display) = current_display(window, &topology) {
            if let Err(error) = minimum(window, &display) { eprintln!("Window minimum size: {error}"); }
        }
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(mut tracking) = state.lock() else { return false; };
    if tracking.closed && !finalizing { return false; }
    if finalizing {
        let next = observation(&tracking, current, &topology, scale, maximized, true).unwrap_or_else(|| tracking.saved.clone());
        match save(directory, window.label(), &next) {
            Ok(()) => { tracking.saved = next; tracking.persisted = true; },
            Err(error) => eprintln!("Window geometry was not saved: {error}"),
        }
        return false;
    }
    if topology != tracking.displays {
        let saved = tracking.saved.clone(); tracking.displays = topology.clone(); tracking.settling = true;
        drop(tracking);
        match apply(window, &saved, &topology, positioning) {
            Ok(baseline) => if let Ok(mut tracking) = state.lock() { tracking.baseline = baseline; },
            Err(error) => eprintln!("Window recovery: {error}"),
        }
        return true;
    }
    if tracking.settling {
        // Record the OS-adjusted baseline, not a new preferred placement.
        if !maximized { tracking.baseline = current; }
        tracking.settling = false;
        if !tracking.persisted {
            match save(directory, window.label(), &tracking.saved) {
                Ok(()) => tracking.persisted = true,
                Err(error) => eprintln!("Window geometry was not saved: {error}"),
            }
        }
        return false;
    }
    let next = observation(&tracking, current, &topology, scale, maximized, false);
    if let Some(next) = next {
        match save(directory, window.label(), &next) {
            Ok(()) => { tracking.saved = next; tracking.persisted = true; if !maximized { tracking.baseline = current; } },
            Err(error) => eprintln!("Window geometry was not saved: {error}"),
        }
    } else if !tracking.persisted {
        match save(directory, window.label(), &tracking.saved) {
            Ok(()) => tracking.persisted = true,
            Err(error) => eprintln!("Window geometry was not saved: {error}"),
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value(x: i32) -> SavedWindow { SavedWindow { normal: Position::Legacy { bounds: Bounds { x, y: 20, width: 900, height: 700 } }, maximized: false } }
    #[test]
    fn migration_preserves_original_and_merges_independent_window_writes() {
        let directory = tempfile::tempdir().unwrap();
        let original = br#"{"logbook":{"x":100,"y":20,"width":900,"height":700}}"#;
        std::fs::write(directory.path().join("detached-window-geometry.json"), original).unwrap();
        save(directory.path(), "main", &value(200)).unwrap(); save(directory.path(), "awards", &value(300)).unwrap();
        let document = read(directory.path()).unwrap(); assert_eq!(document.windows.len(), 3);
        assert_eq!(document.windows["logbook"], value(100));
        assert_eq!(std::fs::read(directory.path().join("detached-window-geometry.json")).unwrap(), original);
    }
    #[test]
    fn corrupt_or_future_document_is_not_overwritten() {
        let directory = tempfile::tempdir().unwrap(); let path = directory.path().join("workspace-window-geometry.json");
        for bytes in [b"broken".as_slice(), br#"{"version":3,"windows":{}}"#.as_slice()] {
            std::fs::write(&path, bytes).unwrap(); assert!(save(directory.path(), "main", &value(0)).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn concurrent_writers_keep_every_window_entry() {
        let directory = tempfile::tempdir().unwrap();
        let writers: Vec<_> = (0..12).map(|index| {
            let path = directory.path().to_path_buf();
            std::thread::spawn(move || save(&path, &format!("panel-{index}"), &value(index * 20)).unwrap())
        }).collect();
        for writer in writers { writer.join().unwrap(); }
        let document = read(directory.path()).unwrap(); assert_eq!(document.windows.len(), 12);
        for index in 0..12 { assert_eq!(document.windows[&format!("panel-{index}")], value(index * 20)); }
    }
    fn tracking() -> Tracking {
        let baseline = Bounds { x: 100, y: 60, width: 900, height: 700 };
        let displays = vec![Display { name: Some("external".into()), work: Bounds { x: 0, y: 28, width: 1920, height: 1052 }, scale: 1.0 }];
        let saved = geometry::capture(baseline, &displays, false).unwrap();
        Tracking { saved, baseline, displays, changed: Instant::now(), dirty: true, queued: true,
            topology_checked: Instant::now(), positioning: true, settling: false, persisted: true, closed: false }
    }
    #[test]
    fn final_flush_saves_pending_move_and_late_debounce_cannot_replace_it() {
        let directory = tempfile::tempdir().unwrap();
        let mut state = tracking();
        save(directory.path(), "logbook", &state.saved).unwrap();
        state.closed = true;
        let moved = Bounds { x: 300, y: 120, ..state.baseline };
        let final_snapshot = observation(&state, moved, &state.displays, 1.0, false, true).unwrap();
        save(directory.path(), "logbook", &final_snapshot).unwrap();
        assert!(observation(&state, state.baseline, &state.displays, 1.0, false, false).is_none());
        assert_eq!(read(directory.path()).unwrap().windows["logbook"], final_snapshot);
        assert_eq!(geometry::restore(&final_snapshot, &state.displays, (0.0, 0.0)), Some(moved));
    }
    #[test]
    fn final_flush_during_recovery_retains_preferred_monitor() {
        let directory = tempfile::tempdir().unwrap();
        let mut state = tracking(); state.closed = true;
        let fallback = vec![Display { name: Some("laptop".into()), work: Bounds { x: 0, y: 28, width: 800, height: 600 }, scale: 1.0 }];
        let recovered = geometry::restore(&state.saved, &fallback, (0.0, 0.0)).unwrap();
        let final_snapshot = observation(&state, recovered, &fallback, 1.0, false, true).unwrap();
        save(directory.path(), "main", &final_snapshot).unwrap();
        assert_eq!(read(directory.path()).unwrap().windows["main"], state.saved);
        state.displays = fallback; state.settling = true;
        assert_eq!(observation(&state, recovered, &state.displays, 1.0, false, true), Some(state.saved.clone()));
    }
    #[test]
    fn idle_observation_has_no_write_and_wayland_backend_detection_is_conservative() {
        let state = tracking();
        assert!(observation(&state, state.baseline, &state.displays, 1.0, false, false).is_none());
        assert!(!positioning_for_backend("", "wayland", true));
        assert!(!positioning_for_backend("wayland,x11", "", false));
        assert!(!positioning_for_backend("", "x11", true));
        assert!(positioning_for_backend("x11", "wayland", true));
        assert!(positioning_for_backend("", "x11", false));
    }
}
