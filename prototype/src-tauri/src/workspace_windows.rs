//! Preset window intent only. No Tauri, worker, device, credential or file access.
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum WorkspaceWindowScope {
    #[default]
    NormalLogging,
    Contesting,
}
impl WorkspaceWindowScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NormalLogging => "normal_logging",
            Self::Contesting => "contesting",
        }
    }
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "normal_logging" => Ok(Self::NormalLogging),
            "contesting" => Ok(Self::Contesting),
            _ => Err("Unknown native workspace scope".into()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkspaceWindowIdentity<'a> {
    pub scope: WorkspaceWindowScope,
    pub panel_id: &'a str,
}
impl<'a> WorkspaceWindowIdentity<'a> {
    pub fn new(scope: WorkspaceWindowScope, panel_id: &'a str) -> Result<Self, String> {
        if supports_panel(scope, panel_id) {
            Ok(Self { scope, panel_id })
        } else {
            Err("Unknown native workspace window".into())
        }
    }
    pub fn parse_native_label(label: &'a str) -> Result<Self, String> {
        if let Some(panel_id) = label.strip_prefix(CONTEST_LABEL_PREFIX) {
            return Self::new(WorkspaceWindowScope::Contesting, panel_id);
        }
        Self::new(WorkspaceWindowScope::NormalLogging, label)
    }
    pub fn native_label(self) -> String {
        match self.scope {
            WorkspaceWindowScope::NormalLogging => self.panel_id.into(),
            WorkspaceWindowScope::Contesting => format!("{CONTEST_LABEL_PREFIX}{}", self.panel_id),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct WindowSpec {
    pub id: &'static str,
    pub title: &'static str,
    pub width: f64,
    pub height: f64,
}
pub const SUPPORTED_WINDOWS: [WindowSpec; 23] = [
    WindowSpec { id: "operating-goals", title: "OM0RX-xLog — Operating Goals", width: 900.0, height: 700.0 },
    WindowSpec { id: "previous-qsos", title: "OM0RX-xLog — Previous QSOs", width: 860.0, height: 600.0 },
    WindowSpec { id: "callsign-intelligence", title: "OM0RX-xLog — Callsign Intelligence", width: 700.0, height: 620.0 },
    WindowSpec { id: "log-qso", title: "OM0RX-xLog — Log QSO", width: 800.0, height: 800.0 },
    WindowSpec { id: "spot-history", title: "OM0RX-xLog — Spot History", width: 1180.0, height: 800.0 },
    WindowSpec { id: "monitor", title: "OM0RX-xLog — Station Monitor", width: 780.0, height: 600.0 },
    WindowSpec { id: "world-map", title: "OM0RX-xLog — World Map", width: 1100.0, height: 720.0 },
    WindowSpec { id: "band-maps", title: "OM0RX-xLog — Band Maps", width: 920.0, height: 760.0 },
    WindowSpec { id: "dx-cluster", title: "OM0RX-xLog — DX Cluster", width: 1180.0, height: 800.0 },
    WindowSpec { id: "logbook", title: "OM0RX-xLog — Logbook", width: 1280.0, height: 800.0 },
    WindowSpec { id: "awards", title: "OM0RX-xLog — Awards", width: 1280.0, height: 800.0 },
    WindowSpec { id: "settings", title: "OM0RX-xLog — Settings", width: 1100.0, height: 800.0 },
    WindowSpec { id: "chaser-dx", title: "OM0RX-xLog — Chaser & DX", width: 1180.0, height: 800.0 },
    WindowSpec { id: "hf-propagation-live", title: "OM0RX-xLog — HF Propagation live", width: 1180.0, height: 820.0 },
    WindowSpec { id: "station-control", title: "OM0RX-xLog — Station Control", width: 900.0, height: 700.0 },
    WindowSpec { id: "cw", title: "OM0RX-xLog — CW", width: 900.0, height: 480.0 },
    WindowSpec { id: "rotor", title: "OM0RX-xLog — Rotor", width: 700.0, height: 600.0 },
    WindowSpec { id: "station-status", title: "OM0RX-xLog — Station Status", width: 780.0, height: 650.0 },
    WindowSpec { id: "connection-doctor", title: "OM0RX-xLog — Connection Doctor", width: 700.0, height: 600.0 },
    WindowSpec { id: "propagation", title: "OM0RX-xLog — Propagation", width: 800.0, height: 240.0 },
    WindowSpec { id: "station-identity", title: "OM0RX-xLog — Station Identity", width: 780.0, height: 650.0 },
    WindowSpec { id: "alerts", title: "OM0RX-xLog — Alerts", width: 780.0, height: 600.0 },
    WindowSpec { id: "antenna", title: "OM0RX-xLog — Antenna Reference", width: 780.0, height: 600.0 },
];
pub const CONTEST_LABEL_PREFIX: &str = "contest--";
pub const CONTEST_WINDOWS: [WindowSpec; 13] = [
    WindowSpec { id: "active-qso", title: "OM0RX-xLog Contest — Main Logging", width: 800.0, height: 480.0 },
    WindowSpec { id: "call-history", title: "OM0RX-xLog Contest — Call History", width: 840.0, height: 360.0 },
    WindowSpec { id: "band-maps", title: "OM0RX-xLog Contest — Band Map", width: 520.0, height: 500.0 },
    WindowSpec { id: "callsign-intelligence", title: "OM0RX-xLog Contest — Check Partial", width: 660.0, height: 500.0 },
    WindowSpec { id: "monitor", title: "OM0RX-xLog Contest — Rates", width: 340.0, height: 300.0 },
    WindowSpec { id: "propagation", title: "OM0RX-xLog Contest — Stats", width: 520.0, height: 140.0 },
    WindowSpec { id: "alerts", title: "OM0RX-xLog Contest — Group Chat", width: 780.0, height: 600.0 },
    WindowSpec { id: "awards", title: "OM0RX-xLog Contest — DXCC", width: 920.0, height: 300.0 },
    WindowSpec { id: "chaser-dx", title: "OM0RX-xLog Contest — Zone", width: 760.0, height: 300.0 },
    WindowSpec { id: "rotor", title: "OM0RX-xLog Contest — Rotator", width: 620.0, height: 420.0 },
    WindowSpec { id: "station-control", title: "OM0RX-xLog Contest — Remote VFO", width: 900.0, height: 680.0 },
    WindowSpec { id: "logbook", title: "OM0RX-xLog Contest — Log Display", width: 1120.0, height: 480.0 },
    WindowSpec { id: "dx-cluster", title: "OM0RX-xLog Contest — Cluster", width: 1040.0, height: 420.0 },
];
pub fn supports_panel(scope: WorkspaceWindowScope, panel_id: &str) -> bool {
    match scope {
        WorkspaceWindowScope::NormalLogging => supports(panel_id),
        WorkspaceWindowScope::Contesting => CONTEST_WINDOWS.iter().any(|window| window.id == panel_id),
    }
}
pub fn scoped_spec(identity: WorkspaceWindowIdentity<'_>) -> Option<&'static WindowSpec> {
    match identity.scope {
        WorkspaceWindowScope::NormalLogging => SUPPORTED_WINDOWS.iter().find(|window| window.id == surface_role(identity.panel_id)),
        WorkspaceWindowScope::Contesting => CONTEST_WINDOWS.iter().find(|window| window.id == identity.panel_id),
    }
}
pub fn contest_default_size_migrations(label: &str) -> Option<(&'static [(f64, f64)], (f64, f64))> {
    if label == "contest-setup" { return Some((&[(980.0, 760.0), (920.0, 720.0)], (600.0, 820.0))); }
    if label == "contest-setup-configuration" { return Some((&[(820.0, 620.0), (820.0, 520.0)], (820.0, 320.0))); }
    let identity = WorkspaceWindowIdentity::parse_native_label(label).ok()?;
    if identity.scope != WorkspaceWindowScope::Contesting { return None; }
    let old: &'static [(f64, f64)] = match identity.panel_id {
        "active-qso" => &[(800.0, 620.0)],
        "call-history" => &[(900.0, 720.0), (840.0, 640.0)],
        "band-maps" => &[(380.0, 760.0), (520.0, 700.0)],
        "callsign-intelligence" => &[(700.0, 620.0)],
        "monitor" => &[(780.0, 600.0)],
        "propagation" => &[(800.0, 480.0), (520.0, 380.0), (520.0, 220.0)],
        "rotor" => &[(700.0, 600.0)],
        "station-control" => &[(900.0, 700.0)],
        "awards" => &[(1280.0, 800.0), (920.0, 720.0), (920.0, 460.0)],
        "chaser-dx" => &[(1180.0, 800.0), (760.0, 680.0), (760.0, 460.0)],
        "logbook" => &[(1280.0, 800.0), (1120.0, 700.0)],
        "dx-cluster" => &[(1180.0, 800.0), (1040.0, 680.0)],
        _ => return None,
    };
    let spec = scoped_spec(identity)?;
    Some((old, (spec.width, spec.height)))
}
pub const BAND_MAP_BANDS: [&str; 13] = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"];
pub fn band_map_band(label: &str) -> Option<&str> {
    label.strip_prefix("band-map-").filter(|band| BAND_MAP_BANDS.contains(band))
}
/// Instance identity remains in native labels/geometry; capabilities use the
/// existing narrow map role, only after exact band validation.
pub fn surface_role(label: &str) -> &str { if band_map_band(label).is_some() { "band-maps" } else { label } }
pub fn supports(label: &str) -> bool { SUPPORTED_WINDOWS.iter().any(|window| window.id == surface_role(label)) }
pub fn native_minimum(label: &str) -> (f64, f64) {
    if label == "contest-setup" { return (520.0, 620.0); }
    if label == "contest-setup-configuration" { return (680.0, 300.0); }
    if crate::contest_setup_dialogs::kind(label).is_some() { return (620.0, 480.0); }
    // Contest identities reuse normal panel roles, but have compact tools of
    // their own. Match the canvas minimum for the four connected panels;
    // auxiliary tools must not inherit the normal 640x480 fallback.
    if let Ok(identity) = WorkspaceWindowIdentity::parse_native_label(label) {
        if identity.scope == WorkspaceWindowScope::Contesting {
            return match identity.panel_id {
                "active-qso" => (560.0, 360.0),
                "call-history" => (620.0, 280.0),
                "callsign-intelligence" => (480.0, 420.0),
                "logbook" => (760.0, 480.0),
        "propagation" => (400.0, 140.0),
                "alerts" => (320.0, 220.0),
                "band-maps" => (420.0, 420.0),
                "dx-cluster" => (720.0, 420.0),
                "rotor" => (420.0, 360.0),
                "monitor" => (300.0, 240.0),
                "station-control" => (520.0, 420.0),
                "awards" => (560.0, 240.0),
                "chaser-dx" => (520.0, 240.0),
                _ => unreachable!("validated contest window identity"),
            };
        }
    }
    match surface_role(label) {
        "band-maps" => (280.0, 480.0),
        "propagation" => (480.0, 190.0),
        _ => (640.0, 480.0),
    }
}

const ROLES: [&str; 21] = ["active-qso", "log-qso", "logbook", "callsign-intelligence", "rotor", "antenna",
    "world-map", "band-maps", "dx-cluster", "station-control", "station-status", "station-identity",
    "cw", "alerts", "propagation", "settings", "sync", "awards", "chaser-dx", "spot-history", "monitor"];
const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Intent { generation: String, preset_id: String, placements: Vec<(String, String)> }
#[derive(Clone, Debug)]
pub struct Plan {
    pub show: Vec<String>,
    pub hide: Vec<String>,
    pub generation: String,
    pub revision: u64,
    pub preset_id: String,
    intent: Intent,
}
impl Plan {
    pub fn same_intent(&self, other: &Self) -> bool { self.intent == other.intent }
}
#[derive(Debug)]
pub struct WorkspaceWindowPlanner {
    scope: WorkspaceWindowScope,
    managed: BTreeSet<String>,
    completed: Option<(Intent, u64)>,
}
impl Default for WorkspaceWindowPlanner {
    fn default() -> Self { Self::for_scope(WorkspaceWindowScope::NormalLogging) }
}
impl WorkspaceWindowPlanner {
    pub fn for_scope(scope: WorkspaceWindowScope) -> Self {
        Self { scope, managed: BTreeSet::new(), completed: None }
    }
    /// The adapter must read the authoritative worker snapshot, serialize plans,
    /// and acknowledge only successful operations. No renderer window list is trusted.
    pub fn plan(&self, snapshot: &Value, force: bool) -> Result<Plan, String> {
        let (intent, revision, desired) = checked(snapshot, self.scope)?;
        if self.completed.as_ref().is_some_and(|(previous, known)| previous.generation == intent.generation && revision < *known) {
            return Err("The native workspace snapshot is stale. Reload the saved layout.".into());
        }
        let changed = self.completed.as_ref().is_none_or(|(previous, _)| previous != &intent);
        let mode_changed = self.completed.as_ref().is_some_and(|(previous, _)|
            (previous.preset_id == "windowed") != (intent.preset_id == "windowed"));
        Ok(Plan {
            show: if force || changed { desired.iter().cloned().collect() } else { vec![] },
            // Switching application modes leaves existing task windows open.
            // In particular it must never close a CW surface and emit Stop.
            hide: if mode_changed { vec![] } else { self.managed.difference(&desired).cloned().collect() },
            generation: intent.generation.clone(), revision, preset_id: intent.preset_id.clone(), intent,
        })
    }
    pub fn acknowledge_show(&mut self, label: &str) -> Result<(), String> {
        let identity = WorkspaceWindowIdentity::parse_native_label(label)?;
        if identity.scope != self.scope { return Err("Native workspace scope mismatch".into()); }
        self.managed.insert(label.into()); Ok(())
    }
    pub fn acknowledge_hide(&mut self, label: &str) -> Result<(), String> {
        let identity = WorkspaceWindowIdentity::parse_native_label(label)?;
        if identity.scope != self.scope { return Err("Native workspace scope mismatch".into()); }
        self.managed.remove(label); Ok(())
    }
    /// Call only after every planned native operation succeeds. A partial batch
    /// keeps its per-action ownership, but remains retryable at the same intent.
    pub fn complete(&mut self, plan: &Plan) {
        if self.completed.as_ref().is_some_and(|(previous, _)|
            (previous.preset_id == "windowed") != (plan.intent.preset_id == "windowed")) {
            self.managed.retain(|role| plan.intent.placements.iter().any(|(id, placement)| id == role && placement == "window"));
        }
        self.completed = Some((plan.intent.clone(), plan.revision));
    }
    /// Forget the destroyed instance, not the saved intent. A passive refresh
    /// cannot reopen it; a changed placement, explicit apply, or startup can.
    pub fn forget_destroyed(&mut self, label: &str) { self.managed.remove(label); }
}

fn invalid() -> String { "The native workspace layout could not be verified.".into() }
fn text(value: &Value) -> Result<&str, String> { value.as_str().ok_or_else(invalid) }
fn bounded(value: &Value, minimum: f64, maximum: f64) -> Result<f64, String> {
    value.as_f64().filter(|number| number.is_finite() && *number >= minimum && *number <= maximum).ok_or_else(invalid)
}
fn identifier(value: &Value) -> Result<&str, String> {
    let id = text(value)?;
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-') {
        return Err(invalid());
    }
    Ok(id)
}
fn minimum(id: &str) -> (f64, f64) {
    match id {
        "active-qso" => (520.0, 240.0), "callsign-intelligence" => (360.0, 240.0),
        "rotor" | "antenna" => (240.0, 240.0),
        "world-map" | "band-maps" | "dx-cluster" => (280.0, 200.0),
        "station-status" | "station-identity" | "propagation" | "cw" | "alerts" => (240.0, 80.0),
        _ => (640.0, 480.0),
    }
}
fn format_character(character: char) -> bool {
    matches!(character as u32, 0xAD | 0x600..=0x605 | 0x61C | 0x6DD | 0x70F | 0x890..=0x891 | 0x8E2 |
        0x180E | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F | 0xFEFF |
        0xFFF9..=0xFFFB | 0x110BD | 0x110CD | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3 |
        0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}
fn checked(snapshot: &Value, scope: WorkspaceWindowScope) -> Result<(Intent, u64, BTreeSet<String>), String> {
    let object = snapshot.as_object().ok_or_else(invalid)?;
    match scope {
        WorkspaceWindowScope::NormalLogging if object.contains_key("scope") => return Err(invalid()),
        WorkspaceWindowScope::Contesting if snapshot["scope"].as_str() != Some("contesting") => return Err(invalid()),
        _ => {}
    }
    let generation = text(&snapshot["generation"])?;
    if generation.len() != 36 || !generation.bytes().enumerate().all(|(index, byte)|
        if [8, 13, 18, 23].contains(&index) { byte == b'-' } else { byte.is_ascii_hexdigit() }) { return Err(invalid()); }
    let revision = snapshot["revision"].as_u64().filter(|revision| *revision <= MAX_REVISION).ok_or_else(invalid)?;
    let document = &snapshot["document"];
    if document["version"].as_u64() != Some(2) { return Err(invalid()); }
    let active = identifier(&document["activePresetID"])?;
    let presets = document["presets"].as_array().filter(|presets| (1..=12).contains(&presets.len())).ok_or_else(invalid)?;
    let mut ids = BTreeSet::new();
    let mut active_placements = None;
    for preset in presets {
        let id = identifier(&preset["id"])?;
        if !ids.insert(id) { return Err(invalid()); }
        let name = text(&preset["name"])?;
        if name.trim().is_empty() || name.len() > 100 || name.chars().any(|character| character.is_control() || format_character(character)) { return Err(invalid()); }
        let width = bounded(&preset["width"], 640.0, 16384.0)?;
        let height = bounded(&preset["height"], 480.0, 16384.0)?;
        if !preset["locked"].is_boolean() || !preset["snap"].is_boolean() { return Err(invalid()); }
        let panels = preset["panels"].as_array().filter(|panels| panels.len() == ROLES.len()).ok_or_else(invalid)?;
        let mut roles = BTreeSet::new();
        let mut placements = Vec::new();
        for panel in panels {
            let role = text(&panel["id"])?;
            if !ROLES.contains(&role) || !roles.insert(role) { return Err(invalid()); }
            let placement = text(&panel["placement"])?;
            if !["canvas", "window", "hidden"].contains(&placement) || panel["z"].as_u64().is_none_or(|z| z > 10000) { return Err(invalid()); }
            let rect = &panel["rect"];
            let x = bounded(&rect["x"], 0.0, 16384.0)?;
            let y = bounded(&rect["y"], 0.0, 16384.0)?;
            let (minimum_width, minimum_height) = minimum(role);
            let panel_width = bounded(&rect["width"], minimum_width, 16384.0)?;
            let panel_height = bounded(&rect["height"], minimum_height, 16384.0)?;
            if placement == "canvas" && (x + panel_width > width || y + panel_height > height) { return Err(invalid()); }
            placements.push((role.to_owned(), placement.to_owned()));
        }
        placements.sort();
        if id == active { active_placements = Some(placements); }
    }
    let mut placements = active_placements.ok_or_else(invalid)?;
    // The original built-in preset predates the independent QSO surface.
    // Resolve its compact Canvas role to the existing QSO singleton, without
    // rewriting any saved panel geometry or creating another draft owner.
    if scope == WorkspaceWindowScope::NormalLogging && active == "windowed" {
        if placements.iter().any(|(role, placement)| role == "active-qso" && placement == "window") {
            for (role, placement) in &mut placements {
                if role == "active-qso" { *placement = "hidden".into(); }
                if role == "log-qso" { *placement = "window".into(); }
            }
        }
    }
    let unsupported: Vec<_> = placements.iter().filter(|(role, placement)| placement == "window" && !supports_panel(scope, role)).map(|(role, _)| role.as_str()).collect();
    if !unsupported.is_empty() { return Err(format!("This saved layout requests native windows that are not available yet: {}.", unsupported.join(", "))); }
    for (role, _) in &mut placements {
        if scope == WorkspaceWindowScope::Contesting { *role = format!("{CONTEST_LABEL_PREFIX}{role}"); }
    }
    let desired = placements.iter().filter(|(_, placement)| placement == "window").map(|(role, _)| role.clone()).collect();
    Ok((Intent { generation: generation.to_ascii_lowercase(), preset_id: active.into(), placements }, revision, desired))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn scoped_registry_keeps_legacy_labels_and_uses_exact_contest_labels() {
        assert_eq!(WorkspaceWindowScope::parse("normal_logging").unwrap(), WorkspaceWindowScope::NormalLogging);
        assert_eq!(WorkspaceWindowScope::parse("contesting").unwrap(), WorkspaceWindowScope::Contesting);
        assert_eq!(WorkspaceWindowScope::NormalLogging.as_str(), "normal_logging");
        assert_eq!(WorkspaceWindowScope::Contesting.as_str(), "contesting");
        for invalid in ["", "normal-logging", "Contesting", "contest"] {
            assert!(WorkspaceWindowScope::parse(invalid).is_err());
        }

        let normal = WorkspaceWindowIdentity::new(WorkspaceWindowScope::NormalLogging, "logbook").unwrap();
        assert_eq!(normal.native_label(), "logbook");
        assert_eq!(WorkspaceWindowIdentity::parse_native_label("logbook").unwrap(), normal);
        let band = WorkspaceWindowIdentity::parse_native_label("band-map-20m").unwrap();
        assert_eq!(band.scope, WorkspaceWindowScope::NormalLogging);
        assert_eq!(band.panel_id, "band-map-20m");
        assert_eq!(scoped_spec(band).unwrap().id, "band-maps");

        let contest = WorkspaceWindowIdentity::new(WorkspaceWindowScope::Contesting, "active-qso").unwrap();
        assert_eq!(contest.native_label(), "contest--active-qso");
        assert_eq!(WorkspaceWindowIdentity::parse_native_label("contest--active-qso").unwrap(), contest);
        assert_eq!(scoped_spec(contest).unwrap().title, "OM0RX-xLog Contest — Main Logging");
        for invalid in ["contest--", "contest--log-qso", "contest--band-map-20m", "contest--contest--active-qso", "contest--ACTIVE-QSO"] {
            assert!(WorkspaceWindowIdentity::parse_native_label(invalid).is_err(), "{invalid}");
        }

        let ids: BTreeSet<_> = CONTEST_WINDOWS.iter().map(|window| window.id).collect();
        assert_eq!(ids.len(), CONTEST_WINDOWS.len());
        assert_eq!(ids, BTreeSet::from(["active-qso", "alerts", "awards", "band-maps", "call-history", "callsign-intelligence",
            "chaser-dx", "dx-cluster", "logbook", "monitor", "propagation", "rotor", "station-control"]));
        let titles = CONTEST_WINDOWS.iter().map(|window| (window.id, window.title)).collect::<std::collections::HashMap<_, _>>();
        for (panel, title) in [
            ("callsign-intelligence", "OM0RX-xLog Contest — Check Partial"),
            ("propagation", "OM0RX-xLog Contest — Stats"),
            ("logbook", "OM0RX-xLog Contest — Log Display"),
            ("monitor", "OM0RX-xLog Contest — Rates"),
            ("station-control", "OM0RX-xLog Contest — Remote VFO"),
            ("alerts", "OM0RX-xLog Contest — Group Chat"),
        ] { assert_eq!(titles.get(panel), Some(&title)); }
    }
    #[test]
    fn band_instances_are_exactly_validated_and_keep_only_map_capabilities() {
        for band in BAND_MAP_BANDS {
            let label = format!("band-map-{band}");
            assert!(supports(&label));
            assert_eq!(band_map_band(&label), Some(band));
            assert_eq!(surface_role(&label), "band-maps");
            assert!(crate::map_context::validate(&label, false).is_ok());
            assert!(crate::map_context::validate(&label, true).is_err());
            assert!(crate::spot_editor_barrier::activation_role(&label));
            assert!(!crate::spot_editor_barrier::editor_role(&label));
            assert!(crate::worker::validate_surface(&label, &json!({"id":"test","method":"settings_save","params":{}})).is_err());
        }
        for label in ["band-map-", "band-map-20M", "band-map-20m-extra", "band-map-unknown"] {
            assert!(!supports(label));
            assert!(!crate::spot_editor_barrier::activation_role(label));
        }
    }
    fn fixture(windows: &[&str]) -> Value {
        let panels: Vec<_> = ROLES.iter().enumerate().map(|(z, id)| {
            let (width, height) = minimum(id);
            json!({"id":id,"placement":if windows.contains(id) {"window"} else {"hidden"},
                "rect":{"x":0,"y":0,"width":width,"height":height},"z":z})
        }).collect();
        json!({"generation":"12345678-1234-1234-1234-123456789abc","revision":4,
            "document":{"version":2,"activePresetID":"desk","presets":[{"id":"desk","name":"Desk","width":1920,"height":1080,
                "locked":true,"snap":true,"panels":panels}]}})
    }
    #[test]
    fn scoped_planner_maps_only_contest_native_placements_and_rejects_cross_scope_acknowledgement() {
        let mut snapshot = fixture(&["active-qso", "logbook", "band-maps"]);
        snapshot["scope"] = json!("contesting");
        let mut contest = WorkspaceWindowPlanner::for_scope(WorkspaceWindowScope::Contesting);
        let plan = contest.plan(&snapshot, false).unwrap();
        assert_eq!(plan.show, ["contest--active-qso", "contest--band-maps", "contest--logbook"]);
        assert!(plan.hide.is_empty());
        assert!(contest.acknowledge_show("logbook").is_err());
        for label in &plan.show { contest.acknowledge_show(label).unwrap(); }
        contest.complete(&plan);
        assert!(contest.plan(&snapshot, false).unwrap().show.is_empty());

        let mut closed = fixture(&["logbook"]);
        closed["scope"] = json!("contesting");
        closed["revision"] = json!(5);
        let plan = contest.plan(&closed, false).unwrap();
        assert_eq!(plan.hide, ["contest--active-qso", "contest--band-maps"]);
        for label in &plan.hide { contest.acknowledge_hide(label).unwrap(); }
        contest.complete(&plan);
        let mut reopened = snapshot.clone();
        reopened["revision"] = json!(6);
        let plan = contest.plan(&reopened, false).unwrap();
        assert_eq!(plan.show, ["contest--active-qso", "contest--band-maps", "contest--logbook"]);
        assert!(plan.hide.is_empty());

        let mut unsupported = fixture(&["world-map"]);
        unsupported["scope"] = json!("contesting");
        unsupported["document"]["activePresetID"] = json!("contest-windows");
        unsupported["document"]["presets"][0]["id"] = json!("contest-windows");
        let error = WorkspaceWindowPlanner::for_scope(WorkspaceWindowScope::Contesting).plan(&unsupported, false).unwrap_err();
        assert!(error.contains("world-map"));

        let mut normal = WorkspaceWindowPlanner::default();
        assert!(normal.acknowledge_show("contest--logbook").is_err());
        assert_eq!(normal.plan(&fixture(&["logbook"]), false).unwrap().show, ["logbook"]);

        for scope in [None, Some(json!("normal_logging")), Some(json!("wrong"))] {
            let mut candidate = fixture(&["logbook"]);
            if let Some(scope) = scope { candidate["scope"] = scope; }
            assert!(WorkspaceWindowPlanner::for_scope(WorkspaceWindowScope::Contesting).plan(&candidate, false).is_err());
        }
        let mut tagged_normal = fixture(&["logbook"]);
        tagged_normal["scope"] = json!("contesting");
        assert!(WorkspaceWindowPlanner::default().plan(&tagged_normal, false).is_err());
    }
    fn apply(planner: &mut WorkspaceWindowPlanner, plan: &Plan) {
        for role in &plan.show { planner.acknowledge_show(role).unwrap(); }
        for role in &plan.hide { planner.acknowledge_hide(role).unwrap(); }
        planner.complete(plan);
    }
    #[test]
    fn registry_covers_only_real_windows() {
        let ids: BTreeSet<_> = SUPPORTED_WINDOWS.iter().map(|window| window.id).collect();
        assert_eq!(ids.len(), 23);
        let capabilities: Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        for id in &ids { assert!(capabilities["windows"].as_array().unwrap().contains(&json!(id))); }
        for window in SUPPORTED_WINDOWS {
            let (minimum_width, minimum_height) = native_minimum(window.id);
            assert!(supports(window.id));
            assert!(window.width >= minimum_width && window.height >= minimum_height);
        }
        for role in ROLES { assert_eq!(supports(role), ids.contains(role)); }
        assert!(!supports("main")); assert!(!supports("unknown"));
    }
    #[test]
    fn propagation_window_can_fit_its_compact_content() {
        assert_eq!(native_minimum("propagation"), (480.0, 190.0));
        assert_eq!(native_minimum("band-map-20m"), (280.0, 480.0));
        assert_eq!(native_minimum("logbook"), (640.0, 480.0));
    }
    #[test]
    fn contest_windows_use_scoped_compact_minima_without_changing_normal_tools() {
        let expected = [
            ("active-qso", (560.0, 360.0)), ("call-history", (620.0, 280.0)),
            ("callsign-intelligence", (480.0, 420.0)), ("logbook", (760.0, 480.0)),
            ("propagation", (400.0, 140.0)), ("alerts", (320.0, 220.0)),
            ("band-maps", (420.0, 420.0)), ("dx-cluster", (720.0, 420.0)),
            ("rotor", (420.0, 360.0)), ("monitor", (300.0, 240.0)),
            ("station-control", (520.0, 420.0)), ("awards", (560.0, 240.0)),
            ("chaser-dx", (520.0, 240.0)),
        ];
        assert_eq!(expected.len(), CONTEST_WINDOWS.len());
        for (panel, minimum) in expected {
            let identity = WorkspaceWindowIdentity::new(WorkspaceWindowScope::Contesting, panel).unwrap();
            assert_eq!(native_minimum(&identity.native_label()), minimum);
            let spec = scoped_spec(identity).unwrap();
            assert!(spec.width >= minimum.0 && spec.height >= minimum.1);
        }
        assert_eq!(native_minimum("monitor"), (640.0, 480.0));
        assert_eq!(native_minimum("rotor"), (640.0, 480.0));
        assert_eq!(native_minimum("contest-setup"), (520.0, 620.0));
        assert_eq!(native_minimum("contest--unknown"), (640.0, 480.0));
    }
    #[test]
    fn contest_default_size_migrations_are_exact_and_do_not_touch_shared_tools() {
        assert_eq!(contest_default_size_migrations("contest-setup"), Some((&[(980.0, 760.0), (920.0, 720.0)][..], (600.0, 820.0))));
        assert_eq!(contest_default_size_migrations("contest-setup-configuration"), Some((&[(820.0, 620.0), (820.0, 520.0)][..], (820.0, 320.0))));
        assert_eq!(contest_default_size_migrations("contest--active-qso"), Some((&[(800.0, 620.0)][..], (800.0, 480.0))));
        assert_eq!(contest_default_size_migrations("contest--call-history"), Some((&[(900.0, 720.0), (840.0, 640.0)][..], (840.0, 360.0))));
        assert_eq!(contest_default_size_migrations("contest--band-maps"), Some((&[(380.0, 760.0), (520.0, 700.0)][..], (520.0, 500.0))));
        assert_eq!(contest_default_size_migrations("contest--monitor"), Some((&[(780.0, 600.0)][..], (340.0, 300.0))));
        assert_eq!(contest_default_size_migrations("contest--propagation"), Some((&[(800.0, 480.0), (520.0, 380.0), (520.0, 220.0)][..], (520.0, 140.0))));
        assert_eq!(contest_default_size_migrations("contest--rotor"), Some((&[(700.0, 600.0)][..], (620.0, 420.0))));
        assert_eq!(contest_default_size_migrations("contest--station-control"), Some((&[(900.0, 700.0)][..], (900.0, 680.0))));
        assert_eq!(contest_default_size_migrations("contest--awards"), Some((&[(1280.0, 800.0), (920.0, 720.0), (920.0, 460.0)][..], (920.0, 300.0))));
        assert_eq!(contest_default_size_migrations("contest--chaser-dx"), Some((&[(1180.0, 800.0), (760.0, 680.0), (760.0, 460.0)][..], (760.0, 300.0))));
        assert_eq!(contest_default_size_migrations("contest--logbook"), Some((&[(1280.0, 800.0), (1120.0, 700.0)][..], (1120.0, 480.0))));
        assert_eq!(contest_default_size_migrations("contest--dx-cluster"), Some((&[(1180.0, 800.0), (1040.0, 680.0)][..], (1040.0, 420.0))));
        for label in ["active-qso", "rotor", "station-control", "contest--alerts"] {
            assert_eq!(contest_default_size_migrations(label), None, "{label}");
        }
    }
    #[test]
    fn compact_contest_tables_migrate_only_defaults_and_preserve_user_geometry() {
        use crate::window_geometry::{Bounds, Display, Position, SavedWindow, migrate_logical_size};
        let display = Display { name: Some("External".into()), scale: 2.0,
            work: Bounds { x: -3840, y: 28, width: 3840, height: 2104 } };
        for panel in ["logbook", "dx-cluster", "awards", "chaser-dx", "band-maps", "call-history"] {
            let label = format!("contest--{panel}");
            let (old_sizes, target) = contest_default_size_migrations(&label).unwrap();
            let migrate = |saved: SavedWindow| old_sizes.iter().fold(saved, |saved, from|
                migrate_logical_size(saved, *from, target));
            for &(width, height) in old_sizes {
                let saved = SavedWindow { maximized: true, normal: Position::Relative {
                    display: display.clone(), x: 75.0, y: 42.0, width, height } };
                assert_eq!(migrate(saved), SavedWindow { maximized: true, normal: Position::Relative {
                    display: display.clone(), x: 75.0, y: 42.0, width: target.0, height: target.1 } }, "{label}");
                let saved = SavedWindow { maximized: false, normal: Position::SizeOnly { width, height } };
                assert_eq!(migrate(saved), SavedWindow { maximized: false, normal: Position::SizeOnly {
                    width: target.0, height: target.1 } }, "{label}");
                for (width, height) in [(width + 0.5, height), (width, height + 0.5)] {
                    let custom = SavedWindow { maximized: false, normal: Position::SizeOnly { width, height } };
                    assert_eq!(migrate(custom.clone()), custom, "{label}");
                }
                let legacy = SavedWindow { maximized: false, normal: Position::Legacy {
                    bounds: Bounds { x: 100, y: 80, width: width as u32, height: height as u32 } } };
                assert_eq!(migrate(legacy.clone()), legacy, "{label}");
            }
            assert_eq!(contest_default_size_migrations(panel), None, "normal {panel}");
        }
    }
    #[test]
    fn separate_mode_resolves_legacy_qso_and_never_requires_main() {
        let mut snapshot = fixture(&["active-qso", "world-map"]);
        snapshot["document"]["activePresetID"] = json!("windowed");
        snapshot["document"]["presets"][0]["id"] = json!("windowed");
        let plan = WorkspaceWindowPlanner::default().plan(&snapshot, false).unwrap();
        assert_eq!(plan.show, ["log-qso", "world-map"]);
        assert!(!plan.show.iter().any(|id| id == "main" || id == "active-qso"));
        for window in SUPPORTED_WINDOWS { assert!(supports(window.id)); }
    }
    #[test]
    fn mode_switches_preserve_open_tasks_and_cannot_close_cw_or_emit_stop() {
        let mut planner = WorkspaceWindowPlanner::default();
        let canvas = fixture(&["cw", "logbook"]);
        let plan = planner.plan(&canvas, false).unwrap(); apply(&mut planner, &plan);
        let mut windows = fixture(&["world-map"]);
        windows["revision"] = json!(5);
        windows["document"]["activePresetID"] = json!("windowed");
        windows["document"]["presets"][0]["id"] = json!("windowed");
        let plan = planner.plan(&windows, false).unwrap(); assert!(plan.hide.is_empty()); apply(&mut planner, &plan);
        assert!(planner.plan(&windows, false).unwrap().hide.is_empty());
        let mut returned = canvas; returned["revision"] = json!(6);
        let plan = planner.plan(&returned, false).unwrap(); assert!(plan.hide.is_empty()); apply(&mut planner, &plan);
        assert!(planner.plan(&returned, false).unwrap().hide.is_empty());
    }
    #[test]
    fn cw_window_intent_is_singleton_passive_and_independent_of_main() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["cw"]);
        let plan = planner.plan(&snapshot, false).unwrap();
        assert_eq!(plan.show, ["cw"]); apply(&mut planner, &plan);
        planner.forget_destroyed("cw");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["cw"]);
    }
    #[test]
    fn alerts_window_is_singleton_and_passive_after_manual_close() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["alerts"]);
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show, ["alerts"]);
        apply(&mut planner, &plan); planner.forget_destroyed("alerts");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["alerts"]);
    }
    #[test]
    fn antenna_window_is_singleton_and_passive_after_manual_close() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["antenna"]);
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show, ["antenna"]);
        apply(&mut planner, &plan); planner.forget_destroyed("antenna");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["antenna"]);
    }
    #[test]
    fn rotor_observation_window_is_singleton_and_not_reopened_by_passive_reads() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["rotor"]);
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show, ["rotor"]);
        apply(&mut planner, &plan); planner.forget_destroyed("rotor");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["rotor"]);
    }
    #[test]
    fn station_status_window_is_singleton_and_passive_after_manual_close() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["station-status"]);
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show, ["station-status"]);
        apply(&mut planner, &plan); planner.forget_destroyed("station-status");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["station-status"]);
    }
    #[test]
    fn propagation_window_is_singleton_and_passive_after_manual_close() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["propagation"]);
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show, ["propagation"]);
        apply(&mut planner, &plan); planner.forget_destroyed("propagation");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["propagation"]);
    }
    #[test]
    fn station_identity_window_is_singleton_and_passive_after_manual_close() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["station-identity"]);
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show, ["station-identity"]);
        apply(&mut planner, &plan); planner.forget_destroyed("station-identity");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["station-identity"]);
    }
    #[test]
    fn station_control_intent_does_not_depend_on_main_or_reopen_after_passive_reads() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["station-control"]);
        let plan = planner.plan(&snapshot, false).unwrap();
        assert_eq!(plan.show, ["station-control"]); assert!(plan.hide.is_empty());
        apply(&mut planner, &plan);
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        planner.forget_destroyed("station-control");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["station-control"]);
    }
    #[test]
    fn intelligence_window_reuses_singleton_intent_without_a_main_dependency() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["callsign-intelligence"]);
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show, ["callsign-intelligence"]);
        apply(&mut planner, &plan);
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        planner.forget_destroyed("callsign-intelligence");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["callsign-intelligence"]);
    }
    #[test]
    fn qso_window_intent_is_singleton_independent_of_main_and_passive_reads() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["log-qso"]);
        let plan = planner.plan(&snapshot, false).unwrap();
        assert_eq!(plan.show, ["log-qso"]);
        assert!(plan.hide.is_empty());
        apply(&mut planner, &plan);
        planner.forget_destroyed("log-qso");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["log-qso"]);
        assert!(!supports("main"));
    }
    #[test]
    fn settings_window_intent_is_singleton_independent_of_main() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["settings"]);
        let plan = planner.plan(&snapshot, false).unwrap();
        assert_eq!(plan.show, ["settings"]); assert!(plan.hide.is_empty());
        apply(&mut planner, &plan);
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        planner.forget_destroyed("settings");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["settings"]);
    }
    #[test]
    fn spot_history_window_intent_is_singleton_independent_of_main() {
        let mut planner = WorkspaceWindowPlanner::default();
        let snapshot = fixture(&["spot-history"]);
        let plan = planner.plan(&snapshot, false).unwrap();
        assert_eq!(plan.show, ["spot-history"]);
        assert!(plan.hide.is_empty());
        apply(&mut planner, &plan);
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        planner.forget_destroyed("spot-history");
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["spot-history"]);
    }
    #[test]
    fn rejects_unsupported_requests_before_any_ownership_change() {
        let mut planner = WorkspaceWindowPlanner::default();
        planner.acknowledge_show("logbook").unwrap();
        let error = planner.plan(&fixture(&["active-qso", "callsign-intelligence", "world-map"]), false).unwrap_err();
        assert!(error.contains("active-qso"));
        assert!(!error.contains("active-qso, callsign-intelligence"));
        assert_eq!(planner.managed, BTreeSet::from(["logbook".into()]));
        assert!(planner.completed.is_none());
    }
    #[test]
    fn only_acknowledged_owned_windows_are_hidden() {
        let mut planner = WorkspaceWindowPlanner::default();
        let plan = planner.plan(&fixture(&["logbook", "awards"]), false).unwrap();
        assert_eq!(plan.show, ["awards", "logbook"]); assert!(plan.hide.is_empty());
        // Logbook succeeds, Awards fails. No completed intent is claimed.
        planner.acknowledge_show("logbook").unwrap();
        assert_eq!(planner.plan(&fixture(&["awards"]), false).unwrap().hide, ["logbook"]);
        assert_eq!(planner.plan(&fixture(&["logbook", "awards"]), false).unwrap().show, ["awards", "logbook"]);
        assert!(planner.acknowledge_show("active-qso").is_err());
        assert!(planner.acknowledge_hide("main").is_err());
    }
    #[test]
    fn passive_rename_geometry_and_revision_changes_do_not_reopen_closed_windows() {
        let mut planner = WorkspaceWindowPlanner::default();
        let mut snapshot = fixture(&["logbook"]);
        let plan = planner.plan(&snapshot, false).unwrap(); apply(&mut planner, &plan);
        planner.forget_destroyed("logbook");
        snapshot["revision"] = json!(5);
        snapshot["document"]["presets"][0]["name"] = json!("Renamed");
        snapshot["document"]["presets"][0]["panels"][2]["rect"]["x"] = json!(100);
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        assert_eq!(planner.plan(&snapshot, true).unwrap().show, ["logbook"]);
        let changed = fixture(&["logbook", "awards"]);
        assert_eq!(planner.plan(&changed, false).unwrap().show, ["awards", "logbook"]);
        // A manual recreation with the same label remains unmanaged.
        assert!(planner.plan(&fixture(&[]), false).unwrap().hide.is_empty());
    }
    #[test]
    fn successful_completion_is_idempotent_and_generation_replacement_reapplies() {
        let mut planner = WorkspaceWindowPlanner::default();
        let mut snapshot = fixture(&["monitor", "world-map", "band-maps", "dx-cluster", "log-qso", "spot-history", "logbook", "awards"]);
        let plan = planner.plan(&snapshot, false).unwrap(); apply(&mut planner, &plan);
        assert!(planner.plan(&snapshot, false).unwrap().show.is_empty());
        snapshot["revision"] = json!(3); assert!(planner.plan(&snapshot, false).is_err());
        snapshot["generation"] = json!("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
        let plan = planner.plan(&snapshot, false).unwrap(); assert_eq!(plan.show.len(), 8);
        assert_eq!(plan.generation, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"); apply(&mut planner, &plan);
        let hidden = fixture(&[]); let plan = planner.plan(&hidden, false).unwrap();
        assert_eq!(plan.hide.len(), 8); apply(&mut planner, &plan);
        assert!(planner.plan(&hidden, false).unwrap().hide.is_empty());
    }
    #[test]
    fn intent_comparison_ignores_revision_geometry_and_operation_progress() {
        let mut planner = WorkspaceWindowPlanner::default();
        let mut snapshot = fixture(&["logbook"]);
        let first = planner.plan(&snapshot, false).unwrap(); apply(&mut planner, &first);
        snapshot["revision"] = json!(5);
        snapshot["document"]["presets"][0]["panels"][2]["rect"]["width"] = json!(900);
        let second = planner.plan(&snapshot, false).unwrap();
        assert!(first.same_intent(&second)); assert_ne!(first.show, second.show);
        let changed = planner.plan(&fixture(&["awards"]), false).unwrap();
        assert!(!first.same_intent(&changed));
        snapshot["generation"] = json!("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
        assert!(!first.same_intent(&planner.plan(&snapshot, false).unwrap()));
    }
    #[test]
    fn validates_every_preset_and_full_bounded_inventory() {
        let base = fixture(&[]);
        let mut corruptions = Vec::new();
        for (path, value) in [
            ("generation", json!("unscoped")), ("revision", json!(-1)), ("revision", json!(1.5)), ("revision", json!(MAX_REVISION + 1)),
        ] { let mut snapshot = base.clone(); snapshot[path] = value; corruptions.push(snapshot); }
        let mut snapshot = base.clone(); snapshot["document"]["version"] = json!(1); corruptions.push(snapshot);
        let mut snapshot = base.clone(); snapshot["document"]["activePresetID"] = json!("missing"); corruptions.push(snapshot);
        for (field, value) in [("id", json!("Bad_ID")), ("name", json!("bad\u{200b}name")), ("width", json!(639)), ("locked", json!("yes"))] {
            let mut snapshot = base.clone(); snapshot["document"]["presets"][0][field] = value; corruptions.push(snapshot);
        }
        for (field, value) in [("id", json!("logbook")), ("placement", json!("floating")), ("z", json!(10001))] {
            let mut snapshot = base.clone(); snapshot["document"]["presets"][0]["panels"][0][field] = value; corruptions.push(snapshot);
        }
        for (field, value) in [("x", json!(-1)), ("width", json!(519)), ("height", json!(16385))] {
            let mut snapshot = base.clone(); snapshot["document"]["presets"][0]["panels"][0]["rect"][field] = value; corruptions.push(snapshot);
        }
        let mut snapshot = base.clone(); snapshot["document"]["presets"][0]["panels"].as_array_mut().unwrap().pop(); corruptions.push(snapshot);
        let mut snapshot = base.clone(); let panel = &mut snapshot["document"]["presets"][0]["panels"][0];
        panel["placement"] = json!("canvas"); panel["rect"]["x"] = json!(1900); corruptions.push(snapshot);
        let mut snapshot = base.clone(); let mut bad_inactive = snapshot["document"]["presets"][0].clone();
        bad_inactive["id"] = json!("other"); bad_inactive["panels"][0]["rect"]["width"] = json!(0);
        snapshot["document"]["presets"].as_array_mut().unwrap().push(bad_inactive); corruptions.push(snapshot);
        let mut snapshot = base.clone(); let repeated = snapshot["document"]["presets"][0].clone();
        snapshot["document"]["presets"].as_array_mut().unwrap().push(repeated); corruptions.push(snapshot);
        let mut snapshot = base.clone(); let repeated = snapshot["document"]["presets"][0].clone();
        for index in 1..13 { let mut preset = repeated.clone(); preset["id"] = json!(format!("desk-{index}"));
            snapshot["document"]["presets"].as_array_mut().unwrap().push(preset); }
        corruptions.push(snapshot);
        for snapshot in corruptions { assert!(WorkspaceWindowPlanner::default().plan(&snapshot, false).is_err(), "{snapshot}"); }
        assert!(WorkspaceWindowPlanner::default().plan(&base, false).is_ok());
    }
}
