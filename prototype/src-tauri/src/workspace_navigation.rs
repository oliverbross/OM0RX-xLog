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
    screen(id).filter(|screen| screen.id != "contesting" || crate::runtime_profile::CONTESTING_TEST)
}
pub fn menu_screen(id: &str) -> Option<&'static Screen> { available_screen(id.strip_prefix("workspace_screen_")?) }
pub fn mode_route(id: &str) -> Option<&'static str> {
    match id { "workspace_mode_canvas" => Some("workspace-mode-canvas"), "workspace_mode_windows" => Some("workspace-mode-windows"), _ => None }
}

// Menu destinations are retained main-renderer intents. The main contest
// controller supplies the current session when opening its existing windows.
pub const CONTEST_MENU_ITEMS: [(&str, &str); 12] = [
    ("contest-setup", "Contest Setup"),
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
];
pub fn contest_route(id: &str) -> Option<&'static str> {
    CONTEST_MENU_ITEMS.iter().find_map(|(route, _)| (*route == id).then_some(*route))
}
pub fn contest_menu_route(id: &str) -> Option<&'static str> {
    contest_route(id.strip_prefix("contest_menu_")?)
}
pub fn contest_window_panel(panel_id: &str) -> Option<&'static str> {
    CONTEST_MENU_ITEMS.iter().filter_map(|(route, _)| route.strip_prefix("contest-window-"))
        .find(|panel| *panel == panel_id)
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
        if label != "main" { return Err("Only the main workspace receives screen navigation".into()); }
        Ok(self.0.lock().map_err(|_| "Workspace navigation unavailable")?.pending.clone())
    }
    pub fn acknowledge(&self, label: &str, revision: u64) -> Result<(), String> {
        if label != "main" { return Err("Only the main workspace acknowledges screen navigation".into()); }
        let mut state = self.0.lock().map_err(|_| "Workspace navigation unavailable")?;
        if state.pending.as_ref().is_some_and(|pending| pending.revision == revision) { state.pending = None; }
        Ok(())
    }
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
            if let Some(panel) = route.strip_prefix("contest-window-") {
                assert!(crate::workspace_windows::supports_panel(crate::workspace_windows::WorkspaceWindowScope::Contesting, panel));
                assert_eq!(contest_window_panel(panel), Some(panel));
                windows.insert(panel);
            } else {
                assert_eq!((route, title), ("contest-setup", "Contest Setup"));
            }
            let pending = state.request(route).unwrap();
            assert_eq!(state.snapshot("main").unwrap(), Some(pending.clone()));
            assert!(state.snapshot("contest--active-qso").is_err());
            assert!(state.acknowledge("contest--active-qso", pending.revision).is_err());
            state.acknowledge("main", pending.revision).unwrap();
        }
        assert_eq!(windows, ["active-qso", "callsign-intelligence", "propagation", "monitor", "logbook", "band-maps", "rotor", "dx-cluster", "awards", "chaser-dx", "station-control"].into_iter().collect());
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
        let expected = ["operator-desk", "log-qso", "logbook", "dx-cluster", "spot-history", "world-map", "band-maps", "chaser-dx", "hf-propagation-live", "awards", "station-control", "radio1-settings", "radio2-settings", "sync", "wavelog-settings", "qrz-settings", "online-log-settings", "reference-data-settings", "settings", "contesting"];
        assert_eq!(screens().len(), expected.len());
        for id in expected { assert!(screen(id).is_some(), "Missing {id}"); }
        let mut ids = std::collections::HashSet::new();
        let mut titles = std::collections::HashSet::new();
        let mut shortcuts = std::collections::HashSet::new();
        for item in screens() {
            assert!(ids.insert(&item.id)); assert!(titles.insert(&item.title));
            assert!(matches!(item.group.as_str(), "Logbook" | "Station" | "View" | "Contesting"));
            let menu_item = menu_screen(&format!("workspace_screen_{}", item.id));
            if item.id == "contesting" && !crate::runtime_profile::CONTESTING_TEST {
                assert!(menu_item.is_none());
            } else {
                assert_eq!(menu_item.unwrap().id, item.id);
            }
            if let Some(shortcut) = &item.shortcut { assert!(shortcuts.insert(shortcut)); assert!(shortcut.starts_with("CmdOrCtrl+")); }
        }
        assert!(menu_screen("station_tune").is_none()); assert!(screen("unknown").is_none());
        assert!(screen("sync").unwrap().hidden);
        for id in ["station-control", "radio1-settings", "radio2-settings", "wavelog-settings", "qrz-settings", "online-log-settings", "reference-data-settings"] {
            assert!(screen(id).unwrap().hidden);
        }
        assert!(!screen("settings").unwrap().hidden);
        assert!(screen("contesting").unwrap().hidden);
        assert_eq!(available_screen("contesting").is_some(), crate::runtime_profile::CONTESTING_TEST);
    }
    #[test]
    fn contesting_navigation_is_compile_bound_to_the_test_profile() {
        let state = WorkspaceNavigation::default();
        if crate::runtime_profile::CONTESTING_TEST {
            let pending = state.request("contesting").unwrap();
            assert_eq!(pending.screen, "contesting");
            assert_eq!(menu_screen("workspace_screen_contesting").unwrap().id, "contesting");
        } else {
            assert!(state.request("contesting").is_err());
            assert!(menu_screen("workspace_screen_contesting").is_none());
        }
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
