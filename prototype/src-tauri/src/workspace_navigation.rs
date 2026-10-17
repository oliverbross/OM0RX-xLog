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
pub fn menu_screen(id: &str) -> Option<&'static Screen> { screen(id.strip_prefix("workspace_screen_")?) }
pub fn mode_route(id: &str) -> Option<&'static str> {
    match id { "workspace_mode_canvas" => Some("workspace-mode-canvas"), "workspace_mode_windows" => Some("workspace-mode-windows"), _ => None }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Navigation { pub revision: u64, pub screen: String }
#[derive(Default)]
struct State { revision: u64, pending: Option<Navigation> }
#[derive(Default)]
pub struct WorkspaceNavigation(Mutex<State>);
impl WorkspaceNavigation {
    pub fn request(&self, id: &str) -> Result<Navigation, String> {
        if screen(id).is_none() && !["workspace-mode-canvas", "workspace-mode-windows"].contains(&id) { return Err("Unknown workspace screen".into()); }
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
        let expected = ["operator-desk", "log-qso", "logbook", "dx-cluster", "spot-history", "world-map", "band-maps", "chaser-dx", "awards", "station-control", "radio1-settings", "radio2-settings", "sync", "wavelog-settings", "qrz-settings", "online-log-settings", "reference-data-settings", "settings"];
        assert_eq!(screens().len(), expected.len());
        for id in expected { assert!(screen(id).is_some(), "Missing {id}"); }
        let mut ids = std::collections::HashSet::new();
        let mut titles = std::collections::HashSet::new();
        let mut shortcuts = std::collections::HashSet::new();
        for item in screens() {
            assert!(ids.insert(&item.id)); assert!(titles.insert(&item.title));
            assert!(matches!(item.group.as_str(), "Logbook" | "Station" | "View"));
            assert_eq!(menu_screen(&format!("workspace_screen_{}", item.id)).unwrap().id, item.id);
            if let Some(shortcut) = &item.shortcut { assert!(shortcuts.insert(shortcut)); assert!(shortcut.starts_with("CmdOrCtrl+")); }
        }
        assert!(menu_screen("station_tune").is_none()); assert!(screen("unknown").is_none());
        assert!(screen("sync").unwrap().hidden);
        for id in ["station-control", "radio1-settings", "radio2-settings", "wavelog-settings", "qrz-settings", "online-log-settings", "reference-data-settings"] {
            assert!(screen(id).unwrap().hidden);
        }
        assert!(!screen("settings").unwrap().hidden);
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
