use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WindowEvent};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Bounds { x: i32, y: i32, width: u32, height: u32 }

fn visible(bounds: Bounds, displays: &[Bounds]) -> Bounds {
    let display = displays.iter().max_by_key(|display| {
        let left = bounds.x.max(display.x) as i64;
        let right = (bounds.x as i64 + bounds.width as i64).min(display.x as i64 + display.width as i64);
        let top = bounds.y.max(display.y) as i64;
        let bottom = (bounds.y as i64 + bounds.height as i64).min(display.y as i64 + display.height as i64);
        (right - left).max(0) * (bottom - top).max(0)
    }).copied().unwrap_or(bounds);
    let width = bounds.width.clamp(1, display.width.max(1));
    let height = bounds.height.clamp(1, display.height.max(1));
    let x = (bounds.x as i64).clamp(display.x as i64, display.x as i64 + display.width.saturating_sub(width) as i64) as i32;
    let y = (bounds.y as i64).clamp(display.y as i64, display.y as i64 + display.height.saturating_sub(height) as i64) as i32;
    Bounds { x, y, width, height }
}

fn path(window: &tauri::WebviewWindow) -> Result<std::path::PathBuf, String> {
    window.app_handle().path().app_config_dir().map(|directory| directory.join("detached-window-geometry.json"))
        .map_err(|error| error.to_string())
}

fn load(window: &tauri::WebviewWindow) -> HashMap<String, Bounds> {
    path(window).ok().and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

pub fn restore(window: &tauri::WebviewWindow) {
    let Some(saved) = load(window).get(window.label()).copied() else { return; };
    let displays: Vec<Bounds> = window.available_monitors().unwrap_or_default().iter().map(|monitor| {
        let area = monitor.work_area();
        Bounds { x: area.position.x, y: area.position.y,
            width: area.size.width, height: area.size.height }
    }).collect();
    if displays.is_empty() { return; }
    let chrome = window.outer_size().ok().zip(window.inner_size().ok())
        .map(|(outer, inner)| (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height)))
        .unwrap_or((0, 0));
    let outer = Bounds { width: saved.width.saturating_add(chrome.0),
        height: saved.height.saturating_add(chrome.1), ..saved };
    let bounds = visible(outer, &displays);
    let _ = window.set_size(PhysicalSize::new(bounds.width.saturating_sub(chrome.0).max(1),
        bounds.height.saturating_sub(chrome.1).max(1)));
    let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
}

fn save(window: &tauri::WebviewWindow) {
    static FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = FILE_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (Ok(position), Ok(size), Ok(path)) = (window.outer_position(), window.inner_size(), path(window)) else { return; };
    if size.width < 320 || size.height < 240 { return; }
    let Some(directory) = path.parent() else { return; };
    if std::fs::create_dir_all(directory).is_err() { return; }
    let mut state = load(window);
    state.insert(window.label().to_string(), Bounds { x: position.x, y: position.y,
        width: size.width, height: size.height });
    let Ok(encoded) = serde_json::to_vec(&state) else { return; };
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, encoded).is_ok() { let _ = std::fs::rename(temp, path); }
}

pub fn watch(window: &tauri::WebviewWindow) {
    static LAST_CHANGE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let observed = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. }) { return; }
        let changes = LAST_CHANGE.get_or_init(|| Mutex::new(HashMap::new()));
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            changes.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(observed.label());
            save(&observed);
            return;
        }
        let mut pending = changes.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let first = !pending.contains_key(observed.label());
        pending.insert(observed.label().to_string(), Instant::now());
        drop(pending);
        if first {
            let delayed = observed.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(300));
                let mut pending = changes.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                if pending.get(delayed.label()).is_some_and(|changed| changed.elapsed() < Duration::from_millis(300)) { continue; }
                pending.remove(delayed.label());
                drop(pending);
                save(&delayed);
                break;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{visible, Bounds};
    #[test]
    fn keeps_saved_bounds_on_the_original_display() {
        let displays = [Bounds { x: 0, y: 0, width: 1920, height: 1080 }, Bounds { x: 1920, y: 0, width: 2560, height: 1440 }];
        let bounds = Bounds { x: 2200, y: 140, width: 1000, height: 700 };
        assert_eq!(visible(bounds, &displays), bounds);
    }
    #[test]
    fn clamps_detached_display_bounds_to_a_remaining_visible_display() {
        let displays = [Bounds { x: 0, y: 0, width: 1440, height: 900 }];
        assert_eq!(visible(Bounds { x: 2400, y: 300, width: 1100, height: 750 }, &displays),
            Bounds { x: 340, y: 150, width: 1100, height: 750 });
    }
    #[test]
    fn shrinks_an_oversized_window_to_visible_area() {
        let displays = [Bounds { x: -1280, y: 0, width: 1280, height: 800 }];
        assert_eq!(visible(Bounds { x: -1200, y: -100, width: 2000, height: 1200 }, &displays),
            Bounds { x: -1280, y: 0, width: 1280, height: 800 });
    }
    #[test]
    fn keeps_window_below_menu_bar_and_above_dock_work_area() {
        let work_areas = [Bounds { x: 0, y: 28, width: 1440, height: 800 }];
        assert_eq!(visible(Bounds { x: 20, y: 0, width: 900, height: 800 }, &work_areas),
            Bounds { x: 20, y: 28, width: 900, height: 800 });
    }
}
