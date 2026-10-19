use serde::Serialize;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{Mutex, OnceLock}};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatingModule { NormalLogging, Contesting }

struct State { context: String, active: usize }

pub struct Owner { state: Mutex<State> }
static OWNER: OnceLock<Owner> = OnceLock::new();

pub fn install(_directory: PathBuf) -> Result<(), String> {
    OWNER.set(Owner::new()).map_err(|_| "Operation-context authority was already installed.".into())
}
pub fn owner() -> Result<&'static Owner, String> { OWNER.get().ok_or("Operation-context authority unavailable".into()) }

pub struct Admission<'a> { owner: &'a Owner }
impl Drop for Admission<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.owner.state.lock() { state.active = state.active.saturating_sub(1); }
    }
}

impl Owner {
    fn new() -> Self {
        Self { state: Mutex::new(State { context: uuid::Uuid::new_v4().to_string(), active: 0 }) }
    }

    #[cfg(test)]
    pub fn memory(_selected: OperatingModule) -> Self { Self::new() }

    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self.state.lock().map_err(|_| "Operation-context authority unavailable")?;
        Ok(json!({"selected":"normal_logging","context":state.context,"transitioning":false}))
    }

    pub fn admit(&self, scope: OperatingModule, context: Option<&str>) -> Result<Admission<'_>, String> {
        let mut state = self.state.lock().map_err(|_| "Operation-context authority unavailable")?;
        let _scope = scope;
        if context != Some(state.context.as_str()) { return Err("That action belongs to an expired operation context.".into()); }
        state.active = state.active.checked_add(1).ok_or("Operation-context admission unavailable")?;
        Ok(Admission { owner: self })
    }

    pub fn admit_selected(&self, scope: OperatingModule) -> Result<Admission<'_>, String> {
        let mut state = self.state.lock().map_err(|_| "Operation-context authority unavailable")?;
        let _scope = scope;
        state.active = state.active.checked_add(1).ok_or("Operation-context admission unavailable")?;
        Ok(Admission { owner: self })
    }

    pub fn admit_current(&self) -> Result<Admission<'_>, String> {
        let mut state = self.state.lock().map_err(|_| "Operation-context authority unavailable")?;
        state.active = state.active.checked_add(1).ok_or("Operation-context admission unavailable")?;
        Ok(Admission { owner: self })
    }
}

pub fn worker_module(request: &Value) -> Option<OperatingModule> {
    let method = request["method"].as_str().unwrap_or("");
    if method.starts_with("contest_") {
        return (!matches!(method, "contest_catalog" | "contest_sessions" | "contest_open" | "contest_draft_get" | "contest_qso_get" |
            "contest_setup_get" | "contest_rates" | "contest_check_partial" |
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

    #[test]
    fn normal_and_contest_scopes_share_one_context_while_stale_context_fails_closed() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let context = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let normal = owner.admit(OperatingModule::NormalLogging, Some(&context)).unwrap();
        let contest = owner.admit(OperatingModule::Contesting, Some(&context)).unwrap();
        assert!(owner.admit(OperatingModule::NormalLogging, Some("expired")).is_err());
        drop((normal, contest));
        assert!(owner.admit_current().is_ok());
    }

    #[test]
    fn classification_keeps_reads_shared_and_mutations_scoped() {
        let request = |method: &str| json!({"method":method,"params":{}});
        assert_eq!(worker_module(&request("contest_qso_commit")), Some(OperatingModule::Contesting));
        for method in ["contest_qso_get", "contest_setup_get", "contest_rates", "contest_check_partial", "contest_statistics"] {
            assert_eq!(worker_module(&request(method)), None);
        }
        assert_eq!(worker_module(&request("logbook_operator_draft_apply")), Some(OperatingModule::NormalLogging));
        assert_eq!(worker_module(&request("wsjtx_start")), Some(OperatingModule::NormalLogging));
        assert_eq!(worker_module(&request("wsjtx_snapshot")), None);
        assert!(shared_worker_mutation(&request("wsjtx_stop")));
        for method in ["settings_save", "workspace_rotor_configuration_save", "workspace_layout_apply"] {
            assert!(shared_worker_mutation(&request(method)));
        }
    }

    #[test]
    fn sync_effects_and_contest_mutations_can_be_admitted_under_the_same_context() {
        let owner = Owner::memory(OperatingModule::NormalLogging);
        let context = owner.snapshot().unwrap()["context"].as_str().unwrap().to_owned();
        let sync = json!({"method":"sync_mutation","params":{"method":"sync_run"}});
        let contest = json!({"method":"contest_setup_save","params":{}});
        let normal = owner.admit(worker_module(&sync).unwrap(), Some(&context)).unwrap();
        let contest = owner.admit(worker_module(&contest).unwrap(), Some(&context)).unwrap();
        drop((normal, contest));
    }
}
