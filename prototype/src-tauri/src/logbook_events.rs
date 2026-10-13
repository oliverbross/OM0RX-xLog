//! Invalidation only: receivers reload through their own scoped read methods.
//! Emit after possible writes, including errors after partial imports/sync.
#[derive(Default)]
pub struct SyncCompletionObserver(std::sync::Mutex<SyncCompletion>);

#[derive(Default)]
struct SyncCompletion {
    last: Option<String>,
}

impl SyncCompletionObserver {
    /// A summary carries no contacts. Completed failures can still have pulled
    /// or pushed records, so their completion wakes readers too.
    pub fn observe(&self, response: &serde_json::Value) -> bool {
        if response["ok"] != true { return false; }
        let summary = &response["result"];
        let Ok(mut state) = self.0.lock() else { return false; };
        let token = summary["completion_id"].as_str().or_else(|| summary["finished_at"].as_str());
        let changed = summary["running"] == false && token.is_some()
            && state.last.as_deref() != token;
        if summary["running"] == false && token.is_some() {
            state.last = token.map(str::to_owned);
        }
        changed
    }
}

pub fn changes_logbook(request: &serde_json::Value) -> bool {
    let method = request["method"].as_str().unwrap_or("");
    if method == "logbook_operator_draft_apply" { return request["params"]["action"] == "save"; }
    matches!(method, "logbook_save" | "logbook_delete" | "logbook_undo" | "logbook_contact_apply"
        | "logbook_import_adif" | "backup_restore"
        | "sync_run" | "sync_resolve" | "sync_retry" | "workspace_create")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn each_completion_wakes_once_including_partial_and_total_failures() {
        let observer = SyncCompletionObserver::default();
        let first = json!({"ok":true,"result":{"running":false,"completion_id":"old"}});
        assert!(observer.observe(&first), "A sync may finish before the first summary reaches the view");
        assert!(!observer.observe(&first));
        assert!(!observer.observe(&json!({"ok":true,"result":{"running":true}})));
        for (token, status) in [("a", "Completed"), ("b", "Completed with failures"), ("c", "Failed")] {
            let completed = json!({"ok":true,"result":{"running":false,"completion_id":token,"status":status,"finished_at":"same-second"}});
            assert!(observer.observe(&completed));
            assert!(!observer.observe(&completed));
        }
    }

    #[test]
    fn errors_and_running_results_never_invalidate_or_consume_a_completion() {
        let observer = SyncCompletionObserver::default();
        assert!(!observer.observe(&json!({"ok":true,"result":{"running":false}})));
        assert!(!observer.observe(&json!({"ok":false,"result":{"running":false,"completion_id":"new"}})));
        assert!(!observer.observe(&json!({"ok":true,"result":{"running":true,"completion_id":"new"}})));
        assert!(observer.observe(&json!({"ok":true,"result":{"running":false,"completion_id":"new"}})));
    }
    #[test]
    fn writes_invalidate_but_read_and_hardware_requests_do_not() {
        for method in ["logbook_save", "logbook_contact_apply", "logbook_import_adif", "backup_restore", "sync_run"] {
            assert!(changes_logbook(&json!({"method":method})));
        }
        for method in ["logbook_list", "logbook_contact", "logbook_contact_receipt", "lookup_call", "station_tune", "cluster_snapshot"] {
            assert!(!changes_logbook(&json!({"method":method})));
        }
        assert!(changes_logbook(&json!({"method":"logbook_operator_draft_apply","params":{"action":"save"}})));
        for action in ["edit", "clear", "reset", ""] {
            assert!(!changes_logbook(&json!({"method":"logbook_operator_draft_apply","params":{"action":action}})));
        }
    }
}
