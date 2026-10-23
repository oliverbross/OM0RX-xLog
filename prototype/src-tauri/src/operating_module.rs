use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatingModule {
    NormalLogging,
    Contesting,
}

impl OperatingModule {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "normal_logging" => Ok(Self::NormalLogging),
            "contesting" => Ok(Self::Contesting),
            _ => Err("Choose Normal Logging or Contesting.".into()),
        }
    }
    pub fn worker_value(self) -> &'static str {
        match self {
            Self::NormalLogging => "normal_logging",
            Self::Contesting => "contesting",
        }
    }
}

#[derive(Deserialize, Serialize)]
struct Persisted {
    version: u8,
    selected: OperatingModule,
}
struct State {
    selected: OperatingModule,
    context: String,
    transition: Option<OperatingModule>,
    active: usize,
}

pub struct Owner {
    path: PathBuf,
    state: Mutex<State>,
}
static OWNER: OnceLock<Owner> = OnceLock::new();

pub fn install(directory: PathBuf) -> Result<(), String> {
    let owner = Owner::load(directory)?;
    OWNER
        .set(owner)
        .map_err(|_| "Operating module authority was already installed.".into())
}
pub fn owner() -> Result<&'static Owner, String> {
    OWNER
        .get()
        .ok_or("Operating module authority unavailable".into())
}
pub fn selected_worker_value() -> Result<&'static str, String> {
    let state = owner()?
        .state
        .lock()
        .map_err(|_| "Operating module authority unavailable")?;
    if state.transition.is_some() {
        return Err("The operating module is changing. Wait for restart.".into());
    }
    Ok(state.selected.worker_value())
}
pub fn validate_target(value: &str, _contesting_test: bool) -> Result<(), String> {
    OperatingModule::parse(value).map(|_| ())
}

pub struct Admission<'a> {
    owner: &'a Owner,
}
impl Drop for Admission<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.owner.state.lock() {
            state.active = state.active.saturating_sub(1);
        }
    }
}

impl Owner {
    pub fn load(directory: PathBuf) -> Result<Self, String> {
        let path = directory.join("operating-module.json");
        let selected = match fs::read(&path) {
            Ok(bytes) => {
                let persisted = serde_json::from_slice::<Persisted>(&bytes).map_err(|error| {
                    format!(
                        "The operating-module preference at {} is invalid. Move it aside to recover Normal Logging, then restart: {error}",
                        path.display()
                    )
                })?;
                if persisted.version != 1 {
                    return Err(format!(
                        "The operating-module preference at {} uses unsupported version {}. Move it aside to recover Normal Logging, then restart.",
                        path.display(), persisted.version
                    ));
                }
                persisted.selected
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                OperatingModule::NormalLogging
            }
            Err(error) => {
                return Err(format!(
                    "The operating-module preference at {} could not be read. Restore its access or move it aside to recover Normal Logging, then restart: {error}",
                    path.display()
                ));
            }
        };
        Ok(Self {
            path,
            state: Mutex::new(State {
                selected,
                context: uuid::Uuid::new_v4().to_string(),
                transition: None,
                active: 0,
            }),
        })
    }

    #[cfg(test)]
    pub fn memory(selected: OperatingModule) -> Self {
        Self {
            path: PathBuf::new(),
            state: Mutex::new(State {
                selected,
                context: uuid::Uuid::new_v4().to_string(),
                transition: None,
                active: 0,
            }),
        }
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Operating module authority unavailable")?;
        Ok(
            json!({"selected":state.selected,"context":state.context,"transitioning":state.transition.is_some()}),
        )
    }

    pub fn admit(
        &self,
        expected: OperatingModule,
        context: Option<&str>,
    ) -> Result<Admission<'_>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Operating module authority unavailable")?;
        Self::require_stable(&state)?;
        if state.selected != expected {
            return Err("That action belongs to the inactive operating module.".into());
        }
        if context != Some(state.context.as_str()) {
            return Err("That action belongs to an expired operating context.".into());
        }
        state.active = state
            .active
            .checked_add(1)
            .ok_or("Operating module admission unavailable")?;
        Ok(Admission { owner: self })
    }

    pub fn admit_selected(&self, expected: OperatingModule) -> Result<Admission<'_>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Operating module authority unavailable")?;
        Self::require_stable(&state)?;
        if state.selected != expected {
            return Err("That action belongs to the inactive operating module.".into());
        }
        state.active = state
            .active
            .checked_add(1)
            .ok_or("Operating module admission unavailable")?;
        Ok(Admission { owner: self })
    }

    /// Admit a mutation owned by a service shared between Normal Logging and
    /// Contesting. Shared work is fenced while a transition is in progress.
    pub fn admit_current(&self) -> Result<Admission<'_>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Operating module authority unavailable")?;
        Self::require_stable(&state)?;
        state.active = state
            .active
            .checked_add(1)
            .ok_or("Operating module admission unavailable")?;
        Ok(Admission { owner: self })
    }

    pub fn begin(&self, target: &str, context: &str) -> Result<OperatingModule, String> {
        let target = OperatingModule::parse(target)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Operating module authority unavailable")?;
        if state.transition.is_some() {
            return Err("An operating-module change is already in progress.".into());
        }
        if state.context != context {
            return Err("The operating-module choice is stale. Reload and try again.".into());
        }
        if state.selected == target {
            return Err("That operating module is already active.".into());
        }
        if state.active != 0 {
            return Err(
                "Wait for the current operating action to finish before changing module.".into(),
            );
        }
        state.transition = Some(target);
        Ok(target)
    }

    pub fn cancel(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.transition = None;
        }
    }

    pub fn commit(&self, target: OperatingModule) -> Result<(), String> {
        self.commit_using(target, publish_preference)
    }

    fn commit_using(
        &self,
        target: OperatingModule,
        publish: impl FnOnce(&PathBuf, &[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Operating module authority unavailable")?;
        if state.transition != Some(target) {
            return Err("The operating-module change is not active for that target.".into());
        }
        if state.active != 0 {
            return Err(
                "Wait for the current operating action to finish before changing module.".into(),
            );
        }
        if !self.path.as_os_str().is_empty() {
            let bytes = serde_json::to_vec(&Persisted {
                version: 1,
                selected: target,
            })
            .map_err(|error| error.to_string())?;
            publish(&self.path, &bytes)?;
        }
        state.selected = target;
        state.transition = None;
        state.context = uuid::Uuid::new_v4().to_string();
        Ok(())
    }

    fn require_stable(state: &State) -> Result<(), String> {
        if state.transition.is_some() {
            Err("The operating module is changing. Wait for restart.".into())
        } else {
            Ok(())
        }
    }
}

fn publish_preference(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Operating module location unavailable")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare the operating-module preference: {error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Could not prepare the operating-module preference: {error}"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("Could not save the operating-module preference: {error}"))?;
    temporary.persist(path).map_err(|error| {
        format!(
            "Could not publish the operating-module preference: {}",
            error.error
        )
    })?;
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Could not sync the operating-module preference directory: {error}"))?;
    Ok(())
}

pub fn worker_module(request: &Value) -> Option<OperatingModule> {
    let method = request["method"].as_str().unwrap_or("");
    if method.starts_with("contest_") {
        return (!matches!(
            method,
            "contest_catalog"
                | "contest_sessions"
                | "contest_draft_get"
                | "contest_qso_get"
                | "contest_setup_get"
                | "contest_rates"
                | "contest_check_partial"
                | "contest_operation_receipt"
                | "contest_log_page"
                | "contest_log_transfer_status"
                | "contest_score"
                | "contest_spot_points_preview"
                | "contest_statistics"
                | "contest_export_prepare"
                | "contest_export_read"
                | "contest_export_release"
                | "contest_scp_status"
                | "contest_scp_query"
                | "contest_scp_cancel"
                | "contest_scp_select"
                | "contest_history_status"
                | "contest_history_preview_page"
                | "contest_history_preview_cancel"
                | "contest_history_query"
                | "contest_history_query_cancel"
                | "contest_history_select"
        ))
        .then_some(OperatingModule::Contesting);
    }
    if method.starts_with("fldigi_") {
        return (method != "fldigi_snapshot").then_some(OperatingModule::Contesting);
    }
    if method == "sync_mutation" {
        return matches!(
            request["params"]["method"].as_str(),
            Some("sync_run" | "sync_retry" | "sync_resolve")
        )
        .then_some(OperatingModule::NormalLogging);
    }
    matches!(
        method,
        "logbook_operator_draft_apply"
            | "logbook_operator_draft_qsy_clear"
            | "logbook_operator_draft_radio_read"
            | "logbook_operator_draft_radio_follow"
            | "spot_draft_apply"
            | "spot_draft_stage"
            | "spot_draft_finish"
            | "spot_draft_abandon"
            | "logbook_contact_apply"
            | "logbook_save"
            | "logbook_delete"
            | "logbook_undo"
            | "logbook_import_adif"
            | "logbook_follow_up"
            | "station_tune"
            | "station_action"
            | "station_connect"
            | "station_disconnect"
            | "station_configure"
            | "station_configuration_save"
            | "station_token_save"
            | "station_reconnect"
            | "station_forget"
            | "station_radio_control"
            | "station_rotor_connect"
            | "station_rotor_disconnect"
            | "station_rotor_goto"
            | "rotor_goto"
            | "rotor_park"
            | "hamlib_connect"
            | "hamlib_reconnect"
            | "hamlib_disconnect"
            | "hamlib_control"
            | "winkeyer_control"
            | "wsjtx_configure"
            | "wsjtx_start"
            | "sync_run"
            | "sync_retry"
            | "sync_resolve"
    )
    .then_some(OperatingModule::NormalLogging)
}

pub fn shared_worker_mutation(request: &Value) -> bool {
    matches!(
        request["method"].as_str(),
        Some(
            "settings_save"
                | "secret_save"
                | "online_log_configure"
                | "sync_mutation"
                | "reference_refresh"
                | "reference_schedule"
                | "reference_configure"
                | "backup_restore"
                | "workspace_create"
                | "workspace_rotor_configuration_save"
                | "workspace_preferences_save"
                | "workspace_band_map_apply"
                | "workspace_logbook_filters_apply"
                | "workspace_layout_apply"
                | "wsjtx_stop"
                | "spot_bridge_configure"
                | "cluster_radio_spots_configure"
                | "cluster_connect"
                | "cluster_disconnect"
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_context_and_inactive_module_fail_closed_across_away_and_back() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let first = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(owner
            .admit(OperatingModule::Contesting, Some(&first))
            .is_err());
        let contest = owner.begin("contesting", &first).unwrap();
        owner.commit(contest).unwrap();
        assert!(owner
            .admit(OperatingModule::NormalLogging, Some(&first))
            .is_err());
        let second = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        let normal = owner.begin("normal_logging", &second).unwrap();
        owner.commit(normal).unwrap();
        assert!(owner
            .admit(OperatingModule::NormalLogging, Some(&first))
            .is_err());
        let third = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(owner
            .admit(OperatingModule::NormalLogging, Some(&third))
            .is_ok());
    }

    #[test]
    fn classification_keeps_reads_shared_and_mutations_exclusive() {
        let request = |method: &str| json!({"method":method,"params":{}});
        assert_eq!(
            worker_module(&request("contest_qso_commit")),
            Some(OperatingModule::Contesting)
        );
        assert_eq!(
            worker_module(&request("contest_open")),
            Some(OperatingModule::Contesting)
        );
        for method in [
            "contest_qso_get",
            "contest_setup_get",
            "contest_rates",
            "contest_check_partial",
            "contest_spot_points_preview",
            "contest_statistics",
            "contest_log_transfer_status",
        ] {
            assert_eq!(worker_module(&request(method)), None);
        }
        for method in [
            "contest_log_transfer_prepare",
            "contest_log_transfer_commit",
        ] {
            assert_eq!(
                worker_module(&request(method)),
                Some(OperatingModule::Contesting)
            );
        }
        assert_eq!(
            worker_module(&request("logbook_operator_draft_apply")),
            Some(OperatingModule::NormalLogging)
        );
        assert_eq!(
            worker_module(&request("wsjtx_start")),
            Some(OperatingModule::NormalLogging)
        );
        assert_eq!(worker_module(&request("wsjtx_snapshot")), None);
        assert!(shared_worker_mutation(&request("wsjtx_stop")));
        assert_eq!(worker_module(&request("fldigi_snapshot")), None);
        for method in [
            "fldigi_configure",
            "fldigi_start",
            "fldigi_stop",
            "fldigi_send",
        ] {
            assert_eq!(
                worker_module(&request(method)),
                Some(OperatingModule::Contesting)
            );
        }
        for method in [
            "settings_save",
            "workspace_rotor_configuration_save",
            "workspace_layout_apply",
            "cluster_connect",
            "cluster_disconnect",
        ] {
            assert!(shared_worker_mutation(&request(method)));
        }
    }

    #[test]
    fn scoped_and_shared_admission_obey_the_selected_module() {
        let owner = Owner::memory(OperatingModule::Contesting);
        let context = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(owner
            .admit(OperatingModule::NormalLogging, Some(&context))
            .is_err());
        assert!(owner
            .admit_selected(OperatingModule::NormalLogging)
            .is_err());
        assert!(owner
            .admit(OperatingModule::Contesting, Some(&context))
            .is_ok());
        assert!(owner.admit_current().is_ok());
    }

    #[test]
    fn transition_blocks_new_scoped_and_shared_work_until_cancelled() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let context = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            owner.begin("contesting", &context).unwrap(),
            OperatingModule::Contesting
        );
        assert_eq!(owner.snapshot().unwrap()["transitioning"], true);
        assert!(owner
            .admit(OperatingModule::NormalLogging, Some(&context))
            .is_err());
        assert!(owner
            .admit_selected(OperatingModule::NormalLogging)
            .is_err());
        assert!(owner.admit_current().is_err());
        owner.cancel();
        assert_eq!(owner.snapshot().unwrap()["transitioning"], false);
        assert!(owner.admit_current().is_ok());
    }

    #[test]
    fn active_admissions_must_drain_before_a_transition_begins() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let context = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        let admission = owner.admit_current().unwrap();
        assert!(owner.begin("contesting", &context).is_err());
        drop(admission);
        assert!(owner.begin("contesting", &context).is_ok());
    }

    #[test]
    fn delayed_contest_open_blocks_a_module_switch_until_its_admission_retires() {
        let owner: &'static Owner = Box::leak(Box::new(Owner::memory(OperatingModule::Contesting)));
        let context = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        let request = json!({"method":"contest_open","params":{}});
        let admission = owner
            .admit(worker_module(&request).unwrap(), Some(&context))
            .unwrap();
        let entered = std::sync::Arc::new(std::sync::Barrier::new(2));
        let release = std::sync::Arc::new(std::sync::Barrier::new(2));
        let worker = std::thread::spawn({
            let entered = entered.clone();
            let release = release.clone();
            move || {
                let _admission = admission;
                entered.wait();
                release.wait();
            }
        });

        entered.wait();
        assert!(owner.begin("normal_logging", &context).is_err());
        release.wait();
        worker.join().unwrap();
        assert!(owner.begin("normal_logging", &context).is_ok());
    }

    #[test]
    fn begin_rejects_stale_unknown_and_already_selected_targets_without_changing_state() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let context = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(owner.begin("contesting", "stale-context").is_err());
        assert!(owner.begin("unknown", &context).is_err());
        assert!(owner.begin("normal_logging", &context).is_err());
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["selected"], "normal_logging");
        assert_eq!(snapshot["context"], context);
        assert_eq!(snapshot["transitioning"], false);
    }

    #[test]
    fn commit_requires_the_begun_target_and_rotates_context() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let first = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        let target = owner.begin("contesting", &first).unwrap();
        assert!(owner.commit(OperatingModule::NormalLogging).is_err());
        assert_eq!(owner.snapshot().unwrap()["transitioning"], true);
        owner.commit(target).unwrap();
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["selected"], "contesting");
        assert_eq!(snapshot["transitioning"], false);
        assert_ne!(snapshot["context"], first);
    }

    #[test]
    fn persisted_selection_binds_the_next_worker_generation_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let owner = Owner::load(directory.path().to_path_buf()).unwrap();
        let context = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        let target = owner.begin("contesting", &context).unwrap();
        owner.commit(target).unwrap();
        assert_eq!(owner.snapshot().unwrap()["selected"], "contesting");
        let reopened = Owner::load(directory.path().to_path_buf()).unwrap();
        assert_eq!(reopened.snapshot().unwrap()["selected"], "contesting");
        assert_eq!(OperatingModule::Contesting.worker_value(), "contesting");
    }

    #[test]
    fn failed_publication_preserves_state_and_previous_preference_bytes_fail_closed() {
        let directory = tempfile::tempdir().unwrap();
        let owner = Owner::load(directory.path().to_path_buf()).unwrap();
        fs::write(&owner.path, br#"{"version":1,"selected":"normal_logging"}"#).unwrap();
        let before = fs::read(&owner.path).unwrap();
        let context = owner.snapshot().unwrap()["context"]
            .as_str()
            .unwrap()
            .to_owned();
        let target = owner.begin("contesting", &context).unwrap();
        assert!(owner
            .commit_using(target, |_, _| Err("injected publication failure".into()))
            .is_err());
        assert_eq!(fs::read(&owner.path).unwrap(), before);
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["selected"], "normal_logging");
        assert_eq!(snapshot["context"], context);
        assert_eq!(snapshot["transitioning"], true);
        assert!(owner.admit_current().is_err());
    }

    #[test]
    fn only_a_missing_preference_defaults_to_normal_logging() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            Owner::load(directory.path().to_path_buf())
                .unwrap()
                .snapshot()
                .unwrap()["selected"],
            "normal_logging"
        );

        fs::write(
            directory.path().join("operating-module.json"),
            br#"{"version":2,"selected":"contesting"}"#,
        )
        .unwrap();
        let unsupported = Owner::load(directory.path().to_path_buf()).err().unwrap();
        assert!(unsupported.contains("unsupported version 2"));
        assert!(unsupported.contains("Move it aside"));

        fs::write(directory.path().join("operating-module.json"), b"not-json").unwrap();
        let malformed = Owner::load(directory.path().to_path_buf()).err().unwrap();
        assert!(malformed.contains("is invalid"));
        assert!(malformed.contains("Move it aside"));

        fs::remove_file(directory.path().join("operating-module.json")).unwrap();
        fs::create_dir(directory.path().join("operating-module.json")).unwrap();
        let unreadable = Owner::load(directory.path().to_path_buf()).err().unwrap();
        assert!(unreadable.contains("could not be read"));
        assert!(unreadable.contains("Restore its access or move it aside"));
    }

    #[test]
    fn target_validation_is_explicit() {
        assert!(validate_target("normal_logging", false).is_ok());
        assert!(validate_target("contesting", false).is_ok());
        assert!(validate_target("contesting", true).is_ok());
        assert!(validate_target("unknown", false).is_err());
    }
}
