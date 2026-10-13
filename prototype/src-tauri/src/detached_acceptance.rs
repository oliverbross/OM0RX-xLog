//! Test-only handshakes, reachable only after Acceptance::require succeeds.
use serde::Serialize;
use std::collections::HashMap;

pub fn valid_kind(kind: &str) -> bool { matches!(kind, "logbook" | "awards" | "spot-history") }

/// Native retained proof survives destruction of the coordinating main webview.
/// Native adapters supply actual window presence; a renderer cannot assert it.
pub struct SpotHistoryAbsence {
    pub instance: String,
    pub revision: u64,
    pub read_proved: bool,
}
impl SpotHistoryAbsence {
    pub fn new(instance: &str, revision: u64) -> Result<Self, String> {
        let id = uuid::Uuid::parse_str(instance).map_err(|_| "Invalid archive renderer identity")?;
        if id.is_nil() || revision == 0 || revision > 9_007_199_254_740_991 { return Err("Invalid archive lifecycle step".into()); }
        Ok(Self { instance: instance.into(), revision, read_proved: false })
    }
    pub fn observe_read(&mut self, instance: &str, revision: u64, main_open: bool, archive_verified: bool) -> Result<(), String> {
        if self.instance != instance || self.revision != revision || main_open || !archive_verified {
            return Err("Archive read did not prove the current main-absent lifecycle".into());
        }
        self.read_proved = true; Ok(())
    }
    pub fn recovered(&self, main_open: bool, child_open: bool) -> bool { self.read_proved && main_open && !child_open }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Step { pub revision: u64, pub action: String }
#[derive(Default)]
pub struct Steps { revision: u64, steps: HashMap<String, Step> }
impl Steps {
    pub fn access(&mut self, caller: &str, kind: Option<&str>, action: Option<&str>) -> Result<Option<Step>, String> {
        if caller == "main" {
            let kind = kind.filter(|kind| valid_kind(kind)).ok_or("Unknown test window")?;
            let action = action.filter(|action| matches!(*action, "probe" | "dock") || kind == "spot-history" && *action == "main_absent" || kind == "logbook"
                && matches!(*action, "editor_prepare" | "editor_probe" | "editor_cancel")).ok_or("Unknown window test action")?;
            if self.revision >= 9_007_199_254_740_990 { return Err("Test step revision exhausted".into()); }
            self.revision += 1;
            let step = Step { revision: self.revision, action: action.into() };
            self.steps.insert(kind.into(), step.clone());
            return Ok(Some(step));
        }
        if !valid_kind(caller) || kind.is_some() || action.is_some() {
            return Err("Only the test coordinator may issue window steps".into());
        }
        Ok(self.steps.get(caller).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_absence_requires_current_renderer_step_and_actual_main_destruction() {
        let id = "12345678-1234-4234-8234-123456789abc";
        let mut proof = SpotHistoryAbsence::new(id, 4).unwrap();
        assert!(!proof.recovered(true, false));
        for (instance, revision, main_open, verified) in [("other", 4, false, true), (id, 3, false, true),
            (id, 4, true, true), (id, 4, false, false)] {
            assert!(proof.observe_read(instance, revision, main_open, verified).is_err());
            assert!(!proof.read_proved);
        }
        proof.observe_read(id, 4, false, true).unwrap();
        assert!(!proof.recovered(false, false)); assert!(!proof.recovered(true, true));
        assert!(proof.recovered(true, false));
        for (instance, revision) in [("", 1), ("00000000-0000-0000-0000-000000000000", 1), (id, 0), (id, 9_007_199_254_740_992)] {
            assert!(SpotHistoryAbsence::new(instance, revision).is_err());
        }
    }
    #[test]
    fn only_main_can_arm_the_archive_absence_step() {
        let mut steps = Steps::default();
        assert!(steps.access("main", Some("spot-history"), Some("main_absent")).is_ok());
        for caller in ["spot-history", "logbook", "awards", "unknown"] {
            assert!(steps.access(caller, Some("spot-history"), Some("main_absent")).is_err());
        }
        assert!(steps.access("main", Some("awards"), Some("main_absent")).is_err());
        assert_eq!(steps.access("spot-history", None, None).unwrap().unwrap().action, "main_absent");
    }
    #[test]
    fn retained_steps_are_scoped_and_reads_do_not_advance_them() {
        let mut steps = Steps::default();
        assert_eq!(steps.access("awards", None, None).unwrap(), None);
        let probe = steps.access("main", Some("awards"), Some("probe")).unwrap();
        assert_eq!(steps.access("awards", None, None).unwrap(), probe);
        assert_eq!(steps.access("awards", None, None).unwrap(), probe);
        assert_eq!(steps.access("logbook", None, None).unwrap(), None);
        let dock = steps.access("main", Some("awards"), Some("dock")).unwrap().unwrap();
        assert!(dock.revision > probe.unwrap().revision);
        assert_eq!(dock.action, "dock");
    }
    #[test]
    fn no_window_can_write_or_read_another_windows_steps() {
        let mut steps = Steps::default();
        for caller in ["logbook", "awards", "monitor", "dx-cluster", "", "unknown"] {
            assert!(steps.access(caller, Some("awards"), Some("dock")).is_err());
            assert!(steps.access(caller, Some("logbook"), None).is_err());
        }
        for (kind, action) in [("monitor", "probe"), ("awards", "station_tune"), ("logbook", "")] {
            assert!(steps.access("main", Some(kind), Some(action)).is_err());
        }
        assert_eq!(steps.revision, 0);
    }
    #[test]
    fn editor_steps_are_retained_only_for_the_logbook_and_cannot_be_issued_by_children() {
        let mut steps = Steps::default();
        for action in ["editor_prepare", "editor_probe", "editor_cancel"] {
            let revision = steps.revision;
            assert!(steps.access("main", Some("awards"), Some(action)).is_err());
            assert_eq!(steps.revision, revision);
            let sent = steps.access("main", Some("logbook"), Some(action)).unwrap().unwrap();
            assert_eq!(sent.action, action);
            assert_eq!(sent.revision, revision + 1);
            assert_eq!(steps.access("logbook", None, None).unwrap(), Some(sent.clone()));
            assert!(steps.access("awards", None, None).unwrap().is_none());
            for caller in ["logbook", "awards", "monitor", "unknown"] {
                assert!(steps.access(caller, Some("logbook"), Some(action)).is_err());
            }
            assert_eq!(steps.revision, sent.revision);
        }
    }
    #[test]
    fn unknown_large_actions_and_exhausted_revisions_do_not_mutate_steps() {
        let mut steps = Steps::default();
        for (kind, action) in [("logbook", "x".repeat(100_000)), ("awards", "editor_prepare".into())] {
            assert!(steps.access("main", Some(kind), Some(&action)).is_err());
        }
        assert_eq!(steps.revision, 0); assert!(steps.steps.is_empty());
        steps.revision = 9_007_199_254_740_990;
        assert!(steps.access("main", Some("logbook"), Some("editor_probe")).is_err());
        assert!(steps.steps.is_empty());
    }
}
