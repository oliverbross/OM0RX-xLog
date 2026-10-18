use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf, sync::{Mutex, OnceLock}};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatingModule { NormalLogging, Contesting }

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
struct Persisted { version: u8, selected: OperatingModule }

struct State { selected: OperatingModule, context: String, transitioning: bool, active: usize }

pub struct Owner { path: PathBuf, state: Mutex<State> }
static OWNER: OnceLock<Owner> = OnceLock::new();

pub fn install(directory: PathBuf) -> Result<(), String> {
    OWNER.set(Owner::load(directory)).map_err(|_| "Operating module authority was already installed.".into())
}
pub fn owner() -> Result<&'static Owner, String> { OWNER.get().ok_or("Operating module authority unavailable".into()) }

pub fn selected_worker_value() -> Result<&'static str, String> {
    let state = owner()?.state.lock().map_err(|_| "Operating module authority unavailable")?;
    if state.transitioning {
        return Err("The operating module is changing. Wait for restart.".into());
    }
    Ok(state.selected.worker_value())
}
pub fn validate_target(value: &str, contesting_test: bool) -> Result<(), String> {
    let target = OperatingModule::parse(value)?;
    if target == OperatingModule::Contesting && !contesting_test {
        return Err("Contesting is available only in the isolated Contesting Test runtime.".into());
    }
    Ok(())
}
pub struct Admission<'a> { owner: &'a Owner }
impl Drop for Admission<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.owner.state.lock() { state.active = state.active.saturating_sub(1); }
    }
}

impl Owner {
    pub fn load(directory: PathBuf) -> Self {
        let path = directory.join("operating-module.json");
        let selected = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<Persisted>(&bytes).ok())
            .filter(|value| value.version == 1).map(|value| value.selected).unwrap_or(OperatingModule::NormalLogging);
        Self { path, state: Mutex::new(State { selected, context: uuid::Uuid::new_v4().to_string(), transitioning: false, active: 0 }) }
    }

    #[cfg(test)]
    pub fn memory(selected: OperatingModule) -> Self {
        Self { path: PathBuf::new(), state: Mutex::new(State { selected, context: uuid::Uuid::new_v4().to_string(), transitioning: false, active: 0 }) }
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Operating module authority unavailable")?;
        Ok(json!({"selected":state.selected,"context":state.context,"transitioning":state.transitioning}))
    }

    pub fn admit(&self, expected: OperatingModule, context: Option<&str>) -> Result<Admission<'_>, String> {
        let mut state = self.state.lock().map_err(|_| "Operating module authority unavailable")?;
        if state.transitioning { return Err("The operating module is changing. Wait for restart.".into()); }
        if state.selected != expected { return Err("That action belongs to the inactive operating module.".into()); }
        if context != Some(state.context.as_str()) { return Err("That action belongs to an expired operating context.".into()); }
        state.active = state.active.checked_add(1).ok_or("Operating module admission unavailable")?;
        Ok(Admission { owner: self })
    }

    pub fn admit_selected(&self, expected: OperatingModule) -> Result<Admission<'_>, String> {
        let mut state = self.state.lock().map_err(|_| "Operating module authority unavailable")?;
        if state.transitioning { return Err("The operating module is changing. Wait for restart.".into()); }
        if state.selected != expected { return Err("That action belongs to the inactive operating module.".into()); }
        state.active = state.active.checked_add(1).ok_or("Operating module admission unavailable")?;
        Ok(Admission { owner: self })
    }

    pub fn admit_current(&self) -> Result<Admission<'_>, String> {
        let mut state = self.state.lock().map_err(|_| "Operating module authority unavailable")?;
        if state.transitioning { return Err("The operating module is changing. Wait for restart.".into()); }
        state.active = state.active.checked_add(1).ok_or("Operating module admission unavailable")?;
        Ok(Admission { owner: self })
    }

    pub fn begin(&self, target: &str, context: &str) -> Result<OperatingModule, String> {
        let target = OperatingModule::parse(target)?;
        let mut state = self.state.lock().map_err(|_| "Operating module authority unavailable")?;
        if state.transitioning { return Err("An operating-module change is already in progress.".into()); }
        if state.context != context { return Err("The operating-module choice is stale. Reload and try again.".into()); }
        if state.selected == target { return Err("That operating module is already active.".into()); }
        if state.active != 0 { return Err("Wait for the current operating action to finish before changing module.".into()); }
        state.transitioning = true;
        Ok(target)
    }

    pub fn cancel(&self) {
        if let Ok(mut state) = self.state.lock() { state.transitioning = false; }
    }

    pub fn commit(&self, target: OperatingModule) -> Result<(), String> {
        self.commit_using(target, publish_preference)
    }

    fn commit_using(&self, target: OperatingModule, publish: impl FnOnce(&PathBuf, &[u8]) -> Result<(), String>) -> Result<(), String> {
        if self.path.as_os_str().is_empty() {
            let mut state = self.state.lock().map_err(|_| "Operating module authority unavailable")?;
            state.selected = target; state.transitioning = false; state.context = uuid::Uuid::new_v4().to_string(); return Ok(());
        }
        let bytes = serde_json::to_vec(&Persisted { version: 1, selected: target }).map_err(|error| error.to_string())?;
        publish(&self.path, &bytes)
    }
}

fn publish_preference(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Operating module location unavailable")?;
    fs::create_dir_all(parent).map_err(|error| format!("Could not prepare the operating-module preference: {error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Could not prepare the operating-module preference: {error}"))?;
    temporary.write_all(bytes).and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("Could not save the operating-module preference: {error}"))?;
    temporary.persist(path)
        .map_err(|error| format!("Could not publish the operating-module preference: {}", error.error))?;
    Ok(())
}

pub fn worker_module(request: &Value) -> Option<OperatingModule> {
    let method = request["method"].as_str().unwrap_or("");
    if method.starts_with("contest_") {
        return (!matches!(method, "contest_catalog" | "contest_sessions" | "contest_open" | "contest_draft_get" | "contest_qso_get" |
            "contest_operation_receipt" | "contest_log_page" | "contest_score" | "contest_statistics" | "contest_export_prepare" | "contest_export_read" |
            "contest_export_release" | "contest_scp_status" | "contest_scp_query" | "contest_scp_cancel" | "contest_scp_select" |
            "contest_history_status" | "contest_history_preview_page" | "contest_history_preview_cancel" | "contest_history_query" |
            "contest_history_query_cancel" | "contest_history_select")).then_some(OperatingModule::Contesting);
    }
    if method == "sync_mutation" {
        return matches!(request["params"]["method"].as_str(), Some("sync_run" | "sync_retry" | "sync_resolve"))
            .then_some(OperatingModule::NormalLogging);
    }
    matches!(method,
        "logbook_operator_draft_apply" | "logbook_operator_draft_qsy_clear" | "logbook_operator_draft_radio_read" |
        "logbook_operator_draft_radio_follow" | "spot_draft_apply" | "spot_draft_stage" | "spot_draft_finish" | "spot_draft_abandon" |
        "logbook_contact_apply" | "logbook_save" | "logbook_delete" | "logbook_undo" | "logbook_import_adif" | "logbook_follow_up" |
        "station_tune" | "station_action" | "station_connect" | "station_disconnect" | "station_configure" | "station_configuration_save" |
        "station_token_save" | "station_reconnect" | "station_forget" | "station_radio_control" | "station_rotor_connect" |
        "station_rotor_disconnect" | "station_rotor_goto" | "rotor_goto" | "rotor_park" |
        "hamlib_connect" | "hamlib_reconnect" | "hamlib_disconnect" | "hamlib_control" | "winkeyer_control" |
        "wsjtx_configure" | "wsjtx_start" | "sync_run" | "sync_retry" | "sync_resolve"
    ).then_some(OperatingModule::NormalLogging)
}

pub fn shared_worker_mutation(request: &Value) -> bool {
    matches!(request["method"].as_str(), Some(
        "settings_save" | "secret_save" | "online_log_configure" | "sync_mutation" |
        "reference_refresh" | "reference_schedule" | "reference_configure" |
        "backup_restore" | "workspace_create" | "workspace_rotor_configuration_save" |
        "workspace_preferences_save" | "workspace_band_map_apply" | "workspace_logbook_filters_apply" |
        "workspace_layout_apply" | "wsjtx_stop" |
        "spot_bridge_configure" | "cluster_radio_spots_configure"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn stale_context_and_inactive_module_fail_closed_across_away_and_back() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let first = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let contest = owner.begin("contesting", &first).unwrap(); owner.commit(contest).unwrap();
        assert!(owner.admit(OperatingModule::NormalLogging, Some(&first)).is_err());
        let second = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let normal = owner.begin("normal_logging", &second).unwrap(); owner.commit(normal).unwrap();
        assert!(owner.admit(OperatingModule::NormalLogging, Some(&first)).is_err());
        let third = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        assert!(owner.admit(OperatingModule::NormalLogging, Some(&third)).is_ok());
    }
    #[test] fn classification_keeps_reads_shared_and_mutations_exclusive() {
        let request = |method: &str| json!({"method":method,"params":{}});
        assert_eq!(worker_module(&request("contest_qso_commit")), Some(OperatingModule::Contesting));
        assert_eq!(worker_module(&request("contest_qso_get")), None);
        assert_eq!(worker_module(&request("contest_statistics")), None);
        assert_eq!(worker_module(&request("logbook_operator_draft_apply")), Some(OperatingModule::NormalLogging));
        assert_eq!(worker_module(&request("wsjtx_start")), Some(OperatingModule::NormalLogging));
        assert_eq!(worker_module(&request("wsjtx_snapshot")), None);
        assert!(shared_worker_mutation(&request("wsjtx_stop")));
        assert_eq!(worker_module(&request("reference_resolve")), None);
        for method in ["rotor_stop", "station_rotor_stop", "winkeyer_stop"] { assert_eq!(worker_module(&request(method)), None); }
        for method in ["settings_save", "workspace_rotor_configuration_save", "workspace_layout_apply"] {
            assert!(shared_worker_mutation(&request(method)));
        }
        for method in ["settings_load", "workspace_rotor_configuration_load", "workspace_layout_load"] {
            assert!(!shared_worker_mutation(&request(method)));
        }
        for method in ["sync_run", "sync_retry", "sync_resolve"] {
            assert_eq!(worker_module(&request(method)), Some(OperatingModule::NormalLogging));
        }
        let sync = |method: &str| json!({"method":"sync_mutation","params":{"method":method}});
        for method in ["sync_run", "sync_retry", "sync_resolve"] {
            assert_eq!(worker_module(&sync(method)), Some(OperatingModule::NormalLogging));
        }
        assert_eq!(worker_module(&sync("sync_configure")), None);
        assert!(shared_worker_mutation(&sync("sync_configure")));
    }
    #[test] fn sync_effect_mutations_require_normal_logging_admission() {
        let owner = Owner::memory(OperatingModule::Contesting);
        let context = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let sync = |method: &str| json!({"method":"sync_mutation","params":{"method":method}});
        for method in ["sync_run", "sync_retry", "sync_resolve"] {
            let required = worker_module(&sync(method)).unwrap();
            assert_eq!(required, OperatingModule::NormalLogging);
            assert!(owner.admit(required, Some(&context)).is_err());
        }
        assert!(owner.admit_current().is_ok());
        assert_eq!(worker_module(&sync("sync_configure")), None);
    }
    #[test] fn contest_target_requires_the_compiled_contesting_profile_not_generic_isolation() {
        assert!(validate_target("contesting", false).is_err());
        assert!(validate_target("contesting", true).is_ok());
        assert!(validate_target("normal_logging", false).is_ok());
    }
    #[test] fn persisted_selection_binds_the_next_worker_generation_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let owner = Owner::load(directory.path().to_path_buf());
        let context = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let target = owner.begin("contesting", &context).unwrap();
        owner.commit(target).unwrap();
        let reopened = Owner::load(directory.path().to_path_buf());
        assert_eq!(reopened.snapshot().unwrap()["selected"], "contesting");
        assert_eq!(OperatingModule::Contesting.worker_value(), "contesting");
    }
    #[test] fn transition_and_effect_admission_are_atomic() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let context = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let admitted = owner.admit(OperatingModule::NormalLogging, Some(&context)).unwrap();
        assert!(owner.begin("contesting", &context).is_err());
        drop(admitted);
        let target = owner.begin("contesting", &context).unwrap();
        assert!(owner.admit(OperatingModule::NormalLogging, Some(&context)).is_err());
        owner.commit(target).unwrap();
        assert!(owner.admit(OperatingModule::Contesting, Some(&context)).is_err());
    }
    #[test] fn failed_publication_preserves_previous_preference_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let owner = Owner::load(directory.path().to_path_buf());
        fs::write(&owner.path, br#"{"version":1,"selected":"normal_logging"}"#).unwrap();
        let before = fs::read(&owner.path).unwrap();
        assert!(owner.commit_using(OperatingModule::Contesting, |_, _| Err("injected publication failure".into())).is_err());
        assert_eq!(fs::read(&owner.path).unwrap(), before);
        assert_eq!(owner.snapshot().unwrap()["selected"], "normal_logging");
    }
    #[test] fn cancelled_station_connect_waiter_cannot_release_its_running_transition_lease() {
        let owner: &'static Owner = Box::leak(Box::new(Owner::memory(OperatingModule::NormalLogging)));
        let context = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let admission = owner.admit_current().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        tauri::async_runtime::block_on(async move {
            let task = tauri::async_runtime::spawn_blocking(move || {
                let _admission = admission;
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            });
            started_rx.recv().unwrap();
            task.abort();
            assert!(owner.begin("contesting", &context).is_err());
            release_tx.send(()).unwrap();
            let _ = task.await;
            assert!(owner.begin("contesting", &context).is_ok());
        });
    }
    #[test] fn shared_station_connect_lease_blocks_switch_for_either_selected_module() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let first = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let connect = owner.admit_current().unwrap();
        assert!(owner.begin("contesting", &first).is_err());
        drop(connect);
        let contest = owner.begin("contesting", &first).unwrap(); owner.commit(contest).unwrap();
        let second = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let contest_connect = owner.admit_current().unwrap();
        assert!(owner.begin("normal_logging", &second).is_err());
        drop(contest_connect);
        assert!(owner.begin("normal_logging", &second).is_ok());
    }
    #[test] fn partial_retirement_keeps_old_choice_recoverable_but_all_new_effects_closed() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let context = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let _target = owner.begin("contesting", &context).unwrap();
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["selected"], "normal_logging");
        assert_eq!(snapshot["transitioning"], true);
        assert!(owner.admit(OperatingModule::NormalLogging, Some(&context)).is_err());
        assert!(owner.admit_current().is_err());
        assert!(owner.begin("contesting", &context).is_err());
    }
}
