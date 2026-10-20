//! Native menu routing is navigation only; it never calls the station worker.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Screen {
    pub id: String,
    pub title: String,
    pub group: String,
    pub shortcut: Option<String>,
    #[serde(default)]
    pub hidden: bool,
}
pub fn screens() -> &'static [Screen] {
    static SCREENS: OnceLock<Vec<Screen>> = OnceLock::new();
    SCREENS.get_or_init(|| serde_json::from_str(include_str!("../../src/live/workspaceScreens.json"))
        .expect("Bundled workspace screen registry must be valid"))
}
pub fn screen(id: &str) -> Option<&'static Screen> { screens().iter().find(|screen| screen.id == id) }
pub fn available_screen(id: &str) -> Option<&'static Screen> {
    screen(id)
}
pub fn menu_screen(id: &str) -> Option<&'static Screen> { available_screen(id.strip_prefix("workspace_screen_")?) }
pub fn mode_route(id: &str) -> Option<&'static str> {
    match id { "workspace_mode_canvas" => Some("workspace-mode-canvas"), "workspace_mode_windows" => Some("workspace-mode-windows"), _ => None }
}

// Menu destinations are retained main-renderer intents. The main contest
// controller supplies the current session when opening its existing windows.
pub const CONTEST_MENU_ITEMS: [(&str, &str); 21] = [
    ("contest-setup", "Contest Setup"),
    ("contest-dialog-operator", "Operator…"),
    ("contest-dialog-station", "Station Settings…"),
    ("contest-dialog-configuration", "Configuration Settings…"),
    ("contest-dialog-digital", "Digital Logging Setup…"),
    ("contest-dialog-rover", "Rover…"),
    ("contest-window-call-history", "Call History"),
    ("contest-window-qrz-details", "QRZ Details"),
    ("contest-window-group-chat", "Group Chat"),
    ("contest-window-active-qso", "Main Logging"),
    ("contest-window-propagation", "Stats"),
    ("contest-window-logbook", "Logbook"),
    ("contest-window-band-maps", "Band Map"),
    ("contest-window-dx-cluster", "Cluster"),
    ("contest-window-callsign-intelligence", "Check Partial"),
    ("contest-window-monitor", "Rates"),
    ("contest-window-awards", "DXCC"),
    ("contest-window-chaser-dx", "Zone"),
    ("contest-window-rotor", "Rotator"),
    ("contest-window-station-control", "Remote VFO"),
    ("contest-dialog-about", "About Not1MM"),
];
pub fn contest_route(id: &str) -> Option<&'static str> {
    CONTEST_MENU_ITEMS.iter().find_map(|(route, _)| (*route == id).then_some(*route))
}
/// The setup renderer owns session mutation for all contest routes. Only an
/// explicit Contest Setup request is allowed to surface that owner window;
/// direct child/tool routes use it as a hidden controller.
pub fn contest_owner_foreground(id: &str) -> bool { id == "contest-setup" }
pub fn contest_owner_dependent_window(label: &str) -> bool {
    label.starts_with("contest--")
        || matches!(label, "contest-setup-operator" | "contest-setup-station" | "contest-setup-configuration" | "contest-setup-digital" | "contest-setup-rover" | "contest-setup-about")
}
pub fn contest_owner_can_retire<'a>(visible: bool, pending: bool,
    labels: impl IntoIterator<Item = &'a str>) -> bool {
    !visible && !pending && !labels.into_iter().any(contest_owner_dependent_window)
}
pub fn contest_menu_route(id: &str) -> Option<&'static str> {
    contest_route(id.strip_prefix("contest_menu_")?)
}
pub fn contest_window_panel(panel_id: &str) -> Option<&'static str> {
    CONTEST_MENU_ITEMS.iter().filter_map(|(route, _)| route.strip_prefix("contest-window-"))
        .find(|panel| *panel == panel_id)
}

/// The Rotator keeps the shared xLog service window. Remote VFO has a
/// contest-specific presentation and lifetime while reusing the same station
/// observation and tune services underneath.
pub fn contest_shared_window(panel_id: &str) -> Option<&'static str> {
    match panel_id {
        "rotor" => Some("rotor"),
        _ => None,
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Navigation { pub revision: u64, pub screen: String }
#[derive(Default)]
struct State { revision: u64, pending: Option<Navigation> }
#[derive(Default)]
pub struct WorkspaceNavigation(Mutex<State>);
impl WorkspaceNavigation {
    pub fn request(&self, id: &str) -> Result<Navigation, String> {
        if available_screen(id).is_none() && contest_route(id).is_none() && !["workspace-mode-canvas", "workspace-mode-windows"].contains(&id) { return Err("Unknown or unavailable workspace screen".into()); }
        let mut state = self.0.lock().map_err(|_| "Workspace navigation unavailable")?;
        if state.revision >= 9_007_199_254_740_990 { return Err("Workspace navigation revision exhausted".into()); }
        state.revision += 1;
        let navigation = Navigation { revision: state.revision, screen: id.into() };
        state.pending = Some(navigation.clone());
        Ok(navigation)
    }
    pub fn snapshot(&self, label: &str) -> Result<Option<Navigation>, String> {
        if !matches!(label, "main" | "contest-setup") { return Err("This window does not receive menu navigation".into()); }
        let pending = self.0.lock().map_err(|_| "Workspace navigation unavailable")?.pending.clone();
        Ok(pending.filter(|navigation| is_receiver(label, &navigation.screen)))
    }
    pub fn acknowledge(&self, label: &str, revision: u64) -> Result<(), String> {
        if !matches!(label, "main" | "contest-setup") { return Err("This window does not acknowledge menu navigation".into()); }
        let mut state = self.0.lock().map_err(|_| "Workspace navigation unavailable")?;
        if state.pending.as_ref().is_some_and(|pending| pending.revision == revision && is_receiver(label, &pending.screen)) { state.pending = None; }
        Ok(())
    }
}
fn is_receiver(label: &str, route: &str) -> bool {
    if contest_route(route).is_some() { label == "contest-setup" } else { label == "main" }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contest_menu_routes_retain_intent_for_connected_contest_windows() {
        let state = WorkspaceNavigation::default();
        let mut routes = std::collections::HashSet::new();
        let mut titles = std::collections::HashSet::new();
        let mut windows = std::collections::HashSet::new();
        for (route, title) in CONTEST_MENU_ITEMS {
            assert!(routes.insert(route));
            assert!(titles.insert(title));
            assert_eq!(contest_menu_route(&format!("contest_menu_{route}")), Some(route));
            assert_eq!(contest_owner_foreground(route), route == "contest-setup");
            if let Some(panel) = route.strip_prefix("contest-window-") {
                assert!(crate::workspace_windows::supports_panel(crate::workspace_windows::WorkspaceWindowScope::Contesting, panel));
                assert_eq!(contest_window_panel(panel), Some(panel));
                windows.insert(panel);
            } else {
                assert!(["contest-setup", "contest-dialog-operator", "contest-dialog-station", "contest-dialog-configuration", "contest-dialog-digital", "contest-dialog-rover", "contest-dialog-about"].contains(&route));
            }
            let pending = state.request(route).unwrap();
            assert_eq!(state.snapshot("contest-setup").unwrap(), Some(pending.clone()));
            assert_eq!(state.snapshot("main").unwrap(), None);
            assert!(state.snapshot("contest--active-qso").is_err());
            assert!(state.acknowledge("contest--active-qso", pending.revision).is_err());
            state.acknowledge("contest-setup", pending.revision).unwrap();
        }
        for label in ["contest--active-qso", "contest--group-chat", "contest--monitor", "contest--station-control", "contest-setup-operator", "contest-setup-station", "contest-setup-configuration", "contest-setup-digital", "contest-setup-rover", "contest-setup-about"] {
            assert!(contest_owner_dependent_window(label));
        }
        for label in ["contest-setup", "main", "rotor", "station-control", "contest-window-active-qso"] {
            assert!(!contest_owner_dependent_window(label));
        }
        assert!(contest_owner_can_retire(false, false, std::iter::empty()));
        assert!(!contest_owner_can_retire(true, false, std::iter::empty()));
        assert!(!contest_owner_can_retire(false, true, std::iter::empty()));
        // A replacement registered under the just-destroyed label is a live
        // dependency and fences the old lifetime's delayed retirement task.
        assert!(!contest_owner_can_retire(false, false, ["contest-setup-station"]));
        assert!(contest_owner_can_retire(false, false, ["rotor", "station-control"]));
        assert_eq!(windows, ["active-qso", "qrz-details", "call-history", "group-chat", "callsign-intelligence", "propagation", "monitor", "logbook", "band-maps", "rotor", "dx-cluster", "awards", "chaser-dx", "station-control"].into_iter().collect());
        assert_eq!(CONTEST_MENU_ITEMS.iter().copied().collect::<std::collections::HashMap<_, _>>(), std::collections::HashMap::from([
            ("contest-setup", "Contest Setup"), ("contest-window-call-history", "Call History"), ("contest-window-qrz-details", "QRZ Details"),
            ("contest-window-group-chat", "Group Chat"),
            ("contest-dialog-operator", "Operator…"),
            ("contest-dialog-station", "Station Settings…"), ("contest-dialog-configuration", "Configuration Settings…"),
            ("contest-dialog-digital", "Digital Logging Setup…"),
            ("contest-dialog-rover", "Rover…"), ("contest-dialog-about", "About Not1MM"),
            ("contest-window-active-qso", "Main Logging"), ("contest-window-propagation", "Stats"),
            ("contest-window-logbook", "Logbook"), ("contest-window-band-maps", "Band Map"),
            ("contest-window-dx-cluster", "Cluster"), ("contest-window-callsign-intelligence", "Check Partial"),
            ("contest-window-monitor", "Rates"),
            ("contest-window-awards", "DXCC"), ("contest-window-chaser-dx", "Zone"),
            ("contest-window-rotor", "Rotator"), ("contest-window-station-control", "Remote VFO"),
        ]));
        for invalid in ["contest-window-settings", "contest-window-cw", "contest-window-alerts", "contest-window-", "contest_setup", "workspace_window_logbook"] {
            assert!(contest_menu_route(invalid).is_none());
            assert!(contest_route(invalid).is_none());
            if invalid.starts_with("contest-") { assert!(state.request(invalid).is_err()); }
        }
        for invalid in ["settings", "cw", "alerts", "contest--logbook", "contest-setup", ""] {
            assert!(contest_window_panel(invalid).is_none());
        }
    }
    #[test]
    fn contest_owned_windows_receive_the_default_tauri_capability() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let windows = capability["windows"].as_array().unwrap();
        for label in [
            "contest-setup",
            "contest--call-history",
            "contest--qrz-details",
            "contest--group-chat",
            "contest--active-qso",
            "contest--propagation",
            "contest--logbook",
            "contest--edit-contact",
            "contest--callsign-intelligence",
            "contest--monitor",
            "contest--awards",
            "contest--chaser-dx",
            "contest--band-maps",
            "contest--dx-cluster",
            "contest--station-control",
        ] {
            assert!(
                windows.iter().any(|candidate| candidate == label),
                "Missing Tauri capability for {label}"
            );
        }
    }
    #[test]
    fn workspace_mode_choices_use_the_retained_main_navigation_channel() {
        let state = WorkspaceNavigation::default();
        for (id, route) in [("workspace_mode_canvas", "workspace-mode-canvas"), ("workspace_mode_windows", "workspace-mode-windows")] {
            assert_eq!(mode_route(id), Some(route));
            let pending = state.request(route).unwrap();
            assert_eq!(state.snapshot("main").unwrap(), Some(pending.clone()));
            assert!(state.snapshot("cw").is_err());
            state.acknowledge("main", pending.revision).unwrap();
        }
        assert!(mode_route("workspace_mode_radio").is_none());
    }
    #[test]
    fn inventory_has_all_existing_screens_unique_ids_titles_and_shortcuts() {
        let expected = ["operator-desk", "log-qso", "logbook", "dx-cluster", "spot-history", "world-map", "band-maps", "chaser-dx", "hf-propagation-live", "awards", "station-control", "radio1-settings", "radio2-settings", "sync", "wavelog-settings", "qrz-settings", "online-log-settings", "reference-data-settings", "settings"];
        assert_eq!(screens().len(), expected.len() + 4);
        for id in ["station-settings", "cw-settings", "cluster-settings", "integrations-settings"] {
            assert!(screen(id).unwrap().hidden);
        }
        for id in expected { assert!(screen(id).is_some(), "Missing {id}"); }
        let mut ids = std::collections::HashSet::new();
        let mut titles = std::collections::HashSet::new();
        let mut shortcuts = std::collections::HashSet::new();
        for item in screens() {
            assert!(ids.insert(&item.id)); assert!(titles.insert(&item.title));
            assert!(matches!(item.group.as_str(), "Logbook" | "Station" | "View"));
            let menu_item = menu_screen(&format!("workspace_screen_{}", item.id));
            assert_eq!(menu_item.unwrap().id, item.id);
            if let Some(shortcut) = &item.shortcut { assert!(shortcuts.insert(shortcut)); assert!(shortcut.starts_with("CmdOrCtrl+")); }
        }
        assert!(menu_screen("station_tune").is_none()); assert!(screen("unknown").is_none());
        assert!(screen("sync").unwrap().hidden);
        for id in ["station-control", "radio1-settings", "radio2-settings", "wavelog-settings", "qrz-settings", "online-log-settings", "reference-data-settings"] {
            assert!(screen(id).unwrap().hidden);
        }
        assert!(!screen("settings").unwrap().hidden);
        assert!(screen("contesting").is_none());
    }
    #[test]
    fn contesting_is_not_a_main_workspace_destination() {
        let state = WorkspaceNavigation::default();
        assert!(state.request("contesting").is_err());
        assert!(menu_screen("workspace_screen_contesting").is_none());
    }
    #[test]
    fn pending_navigation_survives_missing_renderer_and_stale_acknowledgement() {
        let state = WorkspaceNavigation::default();
        assert!(state.snapshot("main").unwrap().is_none());
        let first = state.request("logbook").unwrap();
        assert_eq!(state.snapshot("main").unwrap(), Some(first.clone()));
        let second = state.request("settings").unwrap();
        state.acknowledge("main", first.revision).unwrap();
        assert_eq!(state.snapshot("main").unwrap(), Some(second.clone()));
        state.acknowledge("main", second.revision).unwrap();
        assert!(state.snapshot("main").unwrap().is_none());
    }
    #[test]
    fn unknown_routes_and_other_windows_cannot_consume_navigation() {
        let state = WorkspaceNavigation::default();
        let pending = state.request("logbook").unwrap();
        assert!(state.request("https://example.com").is_err());
        for label in ["logbook", "monitor", "dx-cluster", "", "MAIN"] {
            assert!(state.snapshot(label).is_err()); assert!(state.acknowledge(label, pending.revision).is_err());
        }
        assert_eq!(state.snapshot("main").unwrap(), Some(pending));
    }
}
