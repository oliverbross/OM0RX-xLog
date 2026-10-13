//! Test-only handshakes, reachable only after Acceptance::require succeeds.
use serde::Serialize;
use std::collections::HashMap;

pub fn valid_kind(kind: &str) -> bool { matches!(kind, "logbook" | "awards") }

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Step { pub revision: u64, pub action: String }
#[derive(Default)]
pub struct Steps { revision: u64, steps: HashMap<String, Step> }
impl Steps {
    pub fn access(&mut self, caller: &str, kind: Option<&str>, action: Option<&str>) -> Result<Option<Step>, String> {
        if caller == "main" {
            let kind = kind.filter(|kind| valid_kind(kind)).ok_or("Unknown test window")?;
            let action = action.filter(|action| matches!(*action, "probe" | "dock")).ok_or("Unknown window test action")?;
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
}
