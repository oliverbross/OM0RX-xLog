//! Invalidation only: receivers reload through their own scoped read methods.
//! Emit after possible writes, including errors after partial imports/sync.
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
