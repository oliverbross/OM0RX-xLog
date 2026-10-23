//! Display-relative geometry decisions, independent of OS events.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bounds { pub x: i32, pub y: i32, pub width: u32, pub height: u32 }
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Display { pub name: Option<String>, pub work: Bounds, pub scale: f64 }
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Position {
    // The previous format has no DPI metadata: do not invent an original scale.
    Legacy { bounds: Bounds },
    Relative { display: Display, x: f64, y: f64, width: f64, height: f64 },
    // Wayland does not expose authoritative global window coordinates.
    SizeOnly { width: f64, height: f64 },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedWindow { pub normal: Position, pub maximized: bool }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Document { pub version: u32, pub windows: HashMap<String, SavedWindow> }
impl Default for Document {
    fn default() -> Self { Self { version: 2, windows: HashMap::new() } }
}
fn valid_bounds(bounds: Bounds) -> bool {
    bounds.x.unsigned_abs() <= 1_000_000 && bounds.y.unsigned_abs() <= 1_000_000 &&
        (1..=131_072).contains(&bounds.width) && (1..=131_072).contains(&bounds.height)
}
impl Display {
    pub fn valid(&self) -> bool { valid_bounds(self.work) && self.scale.is_finite() && (0.5..=8.0).contains(&self.scale) && self.name.as_ref().is_none_or(|name| name.len() <= 512) }
}
impl Document {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 2 || self.windows.len() > 64 { return Err("Unsupported window geometry document".into()); }
        for (label, window) in &self.windows {
            if label.is_empty() || label.len() > 128 { return Err("Invalid window identity".into()); }
            let valid = match &window.normal {
                Position::Legacy { bounds } => valid_bounds(*bounds),
                Position::Relative { display, x, y, width, height } => display.valid() &&
                    [*x, *y, *width, *height].iter().all(|value| value.is_finite() && value.abs() <= 262_144.0) && *width >= 1.0 && *height >= 1.0,
                Position::SizeOnly { width, height } => [*width, *height].iter().all(|value|
                    value.is_finite() && (1.0..=262_144.0).contains(value)),
            };
            if !valid { return Err("Invalid saved window geometry".into()); }
        }
        Ok(())
    }
}
fn overlap(a: Bounds, b: Bounds) -> i64 {
    let width = (a.x as i64 + a.width as i64).min(b.x as i64 + b.width as i64) - (a.x as i64).max(b.x as i64);
    let height = (a.y as i64 + a.height as i64).min(b.y as i64 + b.height as i64) - (a.y as i64).max(b.y as i64);
    width.max(0) * height.max(0)
}
pub fn closest(bounds: Bounds, displays: &[Display]) -> Option<&Display> {
    displays.iter().filter(|display| display.valid()).max_by_key(|display| {
        let dx = bounds.x as i64 - display.work.x as i64;
        let dy = bounds.y as i64 - display.work.y as i64;
        (overlap(bounds, display.work), -(dx * dx + dy * dy))
    })
}
fn same_display<'a>(saved: &Display, displays: &'a [Display]) -> Option<&'a Display> {
    // Only unique OS names can identify a rearranged/rescaled display.
    if let Some(name) = saved.name.as_ref() {
        let mut matches = displays.iter().filter(|display| display.valid() && display.name.as_ref() == Some(name));
        let first = matches.next();
        if first.is_some() && matches.next().is_none() { return first; }
    }
    displays.iter().find(|display| display.valid() && display.work == saved.work && display.name == saved.name)
}
pub fn capture(bounds: Bounds, displays: &[Display], maximized: bool) -> Option<SavedWindow> {
    if !valid_bounds(bounds) { return None; }
    let display = closest(bounds, displays)?;
    Some(SavedWindow { maximized, normal: Position::Relative { display: display.clone(),
        x: (bounds.x as f64 - display.work.x as f64) / display.scale,
        y: (bounds.y as f64 - display.work.y as f64) / display.scale,
        width: bounds.width as f64 / display.scale, height: bounds.height as f64 / display.scale } })
}
pub fn capture_size(bounds: Bounds, scale: f64, maximized: bool) -> Option<SavedWindow> {
    if !valid_bounds(bounds) || !valid_scale(scale) { return None; }
    Some(SavedWindow { maximized, normal: Position::SizeOnly {
        width: bounds.width as f64 / scale, height: bounds.height as f64 / scale } })
}
fn valid_scale(scale: f64) -> bool { scale.is_finite() && (0.5..=8.0).contains(&scale) }
pub fn effective_minimum(label: &str, display: &Display, logical_chrome: (f64, f64)) -> (f64, f64) {
    let nominal = if label == "main" { (1000.0_f64, 720.0_f64) }
        else { crate::workspace_windows::native_minimum(label) };
    (nominal.0.min((display.work.width as f64 / display.scale - logical_chrome.0).max(1.0)),
        nominal.1.min((display.work.height as f64 / display.scale - logical_chrome.1).max(1.0)))
}
/// Size-only recovery uses the actual current monitor and never applies an origin.
pub fn restore_size(saved: &SavedWindow, display: &Display, logical_chrome: (f64, f64)) -> Option<Bounds> {
    let normal = match &saved.normal {
        Position::Legacy { bounds } => Position::Legacy { bounds: Bounds { x: display.work.x, y: display.work.y, ..*bounds } },
        Position::Relative { width, height, .. } | Position::SizeOnly { width, height } => Position::Relative {
            display: display.clone(), x: 0.0, y: 0.0, width: *width, height: *height },
    };
    restore(&SavedWindow { normal, maximized: saved.maximized }, std::slice::from_ref(display), logical_chrome)
}
/// Migrate only an untouched logical default size. Positions, maximized state,
/// custom sizes, and legacy physical-pixel documents remain unchanged.
pub fn migrate_logical_size(mut saved: SavedWindow, from: (f64, f64), to: (f64, f64)) -> SavedWindow {
    let migrate = |width: &mut f64, height: &mut f64| {
        if *width == from.0 && *height == from.1 {
            *width = to.0; *height = to.1;
        }
    };
    match &mut saved.normal {
        Position::Relative { width, height, .. } | Position::SizeOnly { width, height } => migrate(width, height),
        Position::Legacy { .. } => {}
    }
    saved
}
pub fn restore(saved: &SavedWindow, displays: &[Display], logical_chrome: (f64, f64)) -> Option<Bounds> {
    if ![logical_chrome.0, logical_chrome.1].iter().all(|value| value.is_finite() && (0.0..=1000.0).contains(value)) { return None; }
    let (requested, display) = match &saved.normal {
        Position::Legacy { bounds } => (*bounds, closest(*bounds, displays)?),
        Position::Relative { display, x, y, width, height } => {
            let target = same_display(display, displays).or_else(|| closest(display.work, displays))?;
            (Bounds { x: (target.work.x as f64 + x * target.scale).round() as i32,
                y: (target.work.y as f64 + y * target.scale).round() as i32,
                width: (width * target.scale).round().max(1.0) as u32,
                height: (height * target.scale).round().max(1.0) as u32 }, target)
        }
        Position::SizeOnly { width, height } => {
            let target = displays.iter().find(|display| display.valid())?;
            (Bounds { x: target.work.x, y: target.work.y,
                width: (width * target.scale).round().max(1.0) as u32,
                height: (height * target.scale).round().max(1.0) as u32 }, target)
        }
    };
    let chrome = ((logical_chrome.0 * display.scale).ceil() as u32, (logical_chrome.1 * display.scale).ceil() as u32);
    let width = requested.width.min(display.work.width.saturating_sub(chrome.0).max(1));
    let height = requested.height.min(display.work.height.saturating_sub(chrome.1).max(1));
    Some(Bounds { x: (requested.x as i64).clamp(display.work.x as i64,
        display.work.x as i64 + display.work.width.saturating_sub(width.saturating_add(chrome.0)) as i64) as i32,
        y: (requested.y as i64).clamp(display.work.y as i64,
        display.work.y as i64 + display.work.height.saturating_sub(height.saturating_add(chrome.1)) as i64) as i32,
        width, height })
}
/// Recovery and maximize events must not overwrite normal preferred placement.
pub fn observed(saved: &SavedWindow, baseline: Bounds, current: Bounds, displays: &[Display], maximized: bool) -> Option<SavedWindow> {
    if maximized || current == baseline {
        return (saved.maximized != maximized).then(|| SavedWindow { maximized, ..saved.clone() });
    }
    capture(current, displays, false)
}
pub fn observed_size(saved: &SavedWindow, baseline: Bounds, current: Bounds, scale: f64, maximized: bool) -> Option<SavedWindow> {
    if maximized || (current.width, current.height) == (baseline.width, baseline.height) {
        return (saved.maximized != maximized).then(|| SavedWindow { maximized, ..saved.clone() });
    }
    if !valid_bounds(current) || !valid_scale(scale) { return None; }
    let normal = match &saved.normal {
        Position::Legacy { bounds } => Position::Legacy { bounds: Bounds { width: current.width, height: current.height, ..*bounds } },
        Position::Relative { display, x, y, .. } => Position::Relative { display: display.clone(), x: *x, y: *y,
            width: current.width as f64 / scale, height: current.height as f64 / scale },
        Position::SizeOnly { .. } => Position::SizeOnly { width: current.width as f64 / scale, height: current.height as f64 / scale },
    };
    Some(SavedWindow { normal, maximized: false })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn display(name: &str, x: i32, scale: f64) -> Display { Display { name: Some(name.into()), work: Bounds { x, y: 28, width: (1920.0 * scale) as u32, height: (1052.0 * scale) as u32 }, scale } }
    fn bounds() -> Bounds { Bounds { x: 2100, y: 128, width: 1000, height: 700 } }
    #[test]
    fn logical_size_and_relative_origin_survive_dpi_and_display_rearrangement() {
        let saved = capture(bounds(), &[display("external", 1920, 1.0)], false).unwrap();
        assert_eq!(restore(&saved, &[display("external", -3840, 2.0)], (0.0, 20.0)),
            Some(Bounds { x: -3480, y: 228, width: 2000, height: 1400 }));
    }
    #[test]
    fn removal_clamps_chrome_but_preserves_preferred_position_on_reconnect() {
        let preferred = display("external", 1920, 1.0);
        let saved = capture(bounds(), &[preferred.clone()], false).unwrap();
        let fallback = Display { work: Bounds { x: 0, y: 28, width: 800, height: 600 }, ..display("laptop", 0, 1.0) };
        let recovered = restore(&saved, &[fallback.clone()], (8.0, 32.0)).unwrap();
        assert_eq!(recovered, Bounds { x: 0, y: 28, width: 792, height: 568 });
        assert_eq!(observed(&saved, recovered, recovered, &[fallback], false), None);
        assert_eq!(restore(&saved, &[preferred], (8.0, 32.0)), Some(bounds()));
    }
    #[test]
    fn maximizing_never_replaces_normal_bounds() {
        let display = display("external", 1920, 1.0);
        let saved = capture(bounds(), &[display.clone()], false).unwrap();
        let maximized = observed(&saved, bounds(), display.work, &[display.clone()], true).unwrap();
        assert!(maximized.maximized); assert_eq!(maximized.normal, saved.normal);
        let restored = observed(&maximized, bounds(), bounds(), &[display], false).unwrap();
        assert_eq!(restored, saved);
    }
    #[test]
    fn explicit_move_after_recovery_establishes_new_preference() {
        let saved = capture(bounds(), &[display("external", 1920, 1.0)], false).unwrap();
        let laptop = display("laptop", 0, 1.0);
        let baseline = restore(&saved, &[laptop.clone()], (0.0, 0.0)).unwrap();
        let moved = Bounds { x: 320, y: 150, ..baseline };
        let next = observed(&saved, baseline, moved, &[laptop.clone()], false).unwrap();
        assert_eq!(restore(&next, &[laptop], (0.0, 0.0)), Some(moved));
    }
    #[test]
    fn legacy_bounds_migrate_without_inventing_original_dpi() {
        let saved = SavedWindow { normal: Position::Legacy { bounds: bounds() }, maximized: false };
        assert_eq!(restore(&saved, &[display("external", 1920, 2.0)], (0.0, 0.0)), Some(bounds()));
        let mut document = Document::default(); document.windows.insert("logbook".into(), saved);
        let encoded = serde_json::to_vec(&document).unwrap();
        let decoded: Document = serde_json::from_slice(&encoded).unwrap(); assert!(decoded.validate().is_ok());
    }
    #[test]
    fn default_size_migration_preserves_position_custom_sizes_and_maximized_state() {
        let display = display("external", 1920, 2.0);
        let saved = SavedWindow { maximized: true, normal: Position::Relative {
            display: display.clone(), x: 90.0, y: 50.0, width: 800.0, height: 620.0 } };
        let migrated = migrate_logical_size(saved.clone(), (800.0, 620.0), (800.0, 480.0));
        assert_eq!(migrated, SavedWindow { maximized: true, normal: Position::Relative {
            display, x: 90.0, y: 50.0, width: 800.0, height: 480.0 } });
        let custom = SavedWindow { maximized: false, normal: Position::SizeOnly { width: 812.0, height: 608.0 } };
        assert_eq!(migrate_logical_size(custom.clone(), (800.0, 620.0), (800.0, 480.0)), custom);
        for delta in [-0.5, 0.5] {
            let one_pixel_at_2x = SavedWindow { maximized: false, normal: Position::SizeOnly {
                width: 800.0 + delta, height: 620.0 + delta } };
            assert_eq!(migrate_logical_size(one_pixel_at_2x.clone(), (800.0, 620.0), (800.0, 480.0)), one_pixel_at_2x);
        }
        let legacy = SavedWindow { maximized: false, normal: Position::Legacy { bounds: bounds() } };
        assert_eq!(migrate_logical_size(legacy.clone(), (1000.0, 700.0), (800.0, 480.0)), legacy);
    }
    #[test]
    fn missing_duplicate_names_invalid_scales_and_empty_topology_are_safe() {
        let mut unnamed = display("same", -1920, 1.0); unnamed.name = None;
        let saved = capture(Bounds { x: -1800, ..bounds() }, &[unnamed.clone()], false).unwrap();
        assert_eq!(restore(&saved, &[unnamed], (0.0, 0.0)).unwrap().x, -1800);
        let saved = capture(bounds(), &[display("same", 1920, 1.0)], false).unwrap();
        assert_eq!(restore(&saved, &[display("same", 0, 1.0), display("same", 1920, 1.0)], (0.0, 0.0)), Some(bounds()));
        assert!(restore(&saved, &[], (0.0, 0.0)).is_none());
        let mut bad = display("bad", 0, 1.0); bad.scale = f64::NAN; assert!(capture(bounds(), &[bad], false).is_none());
    }
    #[test]
    fn unknown_versions_and_bad_geometry_are_rejected() {
        let mut document = Document::default(); document.version = 3; assert!(document.validate().is_err());
        document.version = 2;
        document.windows.insert("main".into(), SavedWindow { maximized: false, normal: Position::Legacy { bounds: Bounds { width: 0, ..bounds() } } });
        assert!(document.validate().is_err());
    }
    #[test]
    fn chrome_uses_destination_dpi_when_clamping_to_a_smaller_work_area() {
        let saved = capture(bounds(), &[display("external", 1920, 1.0)], false).unwrap();
        let target = Display { work: Bounds { x: -1600, y: 60, width: 1600, height: 1000 }, ..display("external", -1600, 2.0) };
        assert_eq!(restore(&saved, &[target], (4.0, 30.0)), Some(Bounds { x: -1600, y: 60, width: 1592, height: 940 }));
        assert!(restore(&saved, &[display("external", 1920, 1.0)], (f64::NAN, 0.0)).is_none());
    }
    #[test]
    fn minimum_fits_small_scaled_work_area_and_recovers_nominal_constraints() {
        let small = Display { work: Bounds { x: 0, y: 60, width: 1600, height: 1000 }, ..display("laptop", 0, 2.0) };
        assert_eq!(effective_minimum("main", &small, (4.0, 30.0)), (796.0, 470.0));
        assert_eq!(effective_minimum("logbook", &small, (4.0, 30.0)), (640.0, 470.0));
        assert_eq!(effective_minimum("log-qso", &small, (4.0, 30.0)), (640.0, 470.0));
        assert_eq!(effective_minimum("main", &display("external", 0, 2.0), (4.0, 30.0)), (1000.0, 720.0));
        assert_eq!(effective_minimum("logbook", &display("external", 0, 2.0), (4.0, 30.0)), (640.0, 480.0));
        assert_eq!(effective_minimum("log-qso", &display("external", 0, 2.0), (4.0, 30.0)), (640.0, 480.0));
        assert_eq!(effective_minimum("propagation", &display("external", 0, 2.0), (4.0, 30.0)), (480.0, 190.0));
        assert_eq!(effective_minimum("contest--active-qso", &small, (4.0, 30.0)), (500.0, 260.0));
        assert_eq!(effective_minimum("contest--callsign-intelligence", &small, (4.0, 30.0)), (440.0, 200.0));
        assert_eq!(effective_minimum("contest--band-maps", &small, (4.0, 30.0)), (340.0, 400.0));
        assert_eq!(effective_minimum("contest--dx-cluster", &small, (4.0, 30.0)), (620.0, 260.0));
        assert_eq!(effective_minimum("contest--propagation", &small, (4.0, 30.0)), (300.0, 180.0));
        assert_eq!(effective_minimum("contest--monitor", &small, (4.0, 30.0)), (280.0, 200.0));
        assert_eq!(effective_minimum("contest--station-control", &small, (4.0, 30.0)), (440.0, 220.0));
        assert_eq!(effective_minimum("contest--rotor", &small, (4.0, 30.0)), (420.0, 420.0));
    }
    #[test]
    fn wayland_size_changes_preserve_preferred_display_origin_and_dpi() {
        let preferred = display("external", 1920, 1.0);
        let saved = capture(bounds(), &[preferred.clone()], false).unwrap();
        let baseline = Bounds { x: 0, y: 0, width: 1600, height: 1000 };
        let resized = Bounds { x: 0, y: 0, width: 1800, height: 1200 };
        let next = observed_size(&saved, baseline, resized, 2.0, false).unwrap();
        assert_eq!(next.normal, Position::Relative { display: preferred.clone(), x: 180.0, y: 100.0, width: 900.0, height: 600.0 });
        assert_eq!(restore(&next, &[preferred], (0.0, 0.0)), Some(Bounds { width: 900, height: 600, ..bounds() }));
        assert!(observed_size(&saved, baseline, Bounds { x: 500, y: 300, ..baseline }, 2.0, false).is_none());
        let maximized = observed_size(&saved, baseline, resized, 2.0, true).unwrap();
        assert!(maximized.maximized); assert_eq!(maximized.normal, saved.normal);
    }
    #[test]
    fn wayland_first_capture_has_no_invented_origin_and_uses_current_monitor_for_size_recovery() {
        let saved = capture_size(Bounds { x: 0, y: 0, width: 2000, height: 1400 }, 2.0, false).unwrap();
        assert_eq!(saved.normal, Position::SizeOnly { width: 1000.0, height: 700.0 });
        let laptop = Display { work: Bounds { x: 3000, y: 60, width: 1600, height: 1000 }, ..display("laptop", 3000, 2.0) };
        assert_eq!(restore_size(&saved, &laptop, (4.0, 30.0)), Some(Bounds { x: 3000, y: 60, width: 1592, height: 940 }));
        let mut document = Document::default(); document.windows.insert("main".into(), saved);
        let encoded = serde_json::to_vec(&document).unwrap();
        assert!(serde_json::from_slice::<Document>(&encoded).unwrap().validate().is_ok());
    }
    #[test]
    fn legacy_origin_survives_wayland_resize_without_inventing_old_dpi() {
        let saved = SavedWindow { normal: Position::Legacy { bounds: bounds() }, maximized: false };
        let baseline = Bounds { x: 0, y: 0, ..bounds() };
        let resized = Bounds { width: 800, height: 600, ..baseline };
        let next = observed_size(&saved, baseline, resized, 2.0, false).unwrap();
        assert_eq!(next.normal, Position::Legacy { bounds: Bounds { width: 800, height: 600, ..bounds() } });
    }
}
