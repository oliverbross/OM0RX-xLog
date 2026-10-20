pub(crate) const CONTESTING_TEST: bool = cfg!(feature = "contesting-test");
pub(crate) const PRODUCTION_IDENTIFIER: &str = "com.oliverbross.xlog.integration";
pub(crate) const TEST_IDENTIFIER: &str = "com.oliverbross.xlog.contesting-test";

pub(crate) fn validate_host(identifier: &str) -> Result<(), String> {
    match (CONTESTING_TEST, identifier) {
        (true, TEST_IDENTIFIER) | (false, PRODUCTION_IDENTIFIER) => Ok(()),
        _ => Err("Application bundle identity does not match its compiled runtime profile.".into()),
    }
}

pub(crate) fn isolated(acceptance: bool) -> bool { acceptance || CONTESTING_TEST }

pub(crate) fn require_external_io_disabled() -> Result<(), String> {
    if CONTESTING_TEST {
        Err("External services and station I/O are disabled in OM0RX-xLog Contesting Test.".into())
    } else {
        Ok(())
    }
}

pub(crate) fn validate_contesting_test_cw(label: &str, action: &str) -> Result<(), String> {
    if !CONTESTING_TEST {
        return Ok(());
    }
    if label != "contest-setup"
        || !matches!(action, "snapshot" | "arm" | "contest" | "stop" | "acknowledge" | "unregister")
    {
        return Err("Contesting Test permits only the contest owner's nontransmitting CW simulation.".into());
    }
    Ok(())
}

pub(crate) fn allows_worker_method(method: &str, local_acceptance: bool) -> bool {
    local_acceptance || !CONTESTING_TEST || matches!(method,
        "health" | "parse_adif" | "self_test" | "integration_self_test" | "cluster_classify")
        || CONTESTING_TEST && method != "contest_scp_download"
            && ["workspace_", "logbook_", "settings_", "backup_", "contest_"]
                .iter().any(|prefix| method.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_build_does_not_claim_test_identity() {
        #[cfg(not(feature = "contesting-test"))]
        {
            assert!(!CONTESTING_TEST);
            assert!(allows_worker_method("station_snapshot", false));
            assert!(allows_worker_method("cluster_snapshot", false));
        }
    }

    #[test]
    #[cfg(feature = "contesting-test")]
    fn test_build_blocks_external_worker_methods() {
        for method in ["sync_status", "station_snapshot", "station_connect", "cluster_snapshot", "cluster_connect", "lookup_call", "reference_refresh",
            "rotor_connect", "rotor_park", "rotor_stop", "hamlib_connect", "wsjtx_start", "contest_scp_download"] {
            assert!(!allows_worker_method(method, false), "{method}");
        }
        for method in ["health", "workspace_status", "workspace_create", "logbook_stats", "contest_catalog"] {
            assert!(allows_worker_method(method, false), "{method}");
        }
        assert!(!allows_worker_method("spot_history_status", false));
        assert!(allows_worker_method("spot_history_status", true));
        assert!(isolated(false));
        assert!(validate_host(TEST_IDENTIFIER).is_ok());
        assert!(validate_host(PRODUCTION_IDENTIFIER).is_err());
        for action in ["snapshot", "arm", "contest", "stop", "acknowledge", "unregister"] {
            assert!(validate_contesting_test_cw("contest-setup", action).is_ok(), "{action}");
        }
        for (label, action) in [("main", "contest"), ("contest-setup", "send"), ("contest--active-qso", "stop")] {
            assert!(validate_contesting_test_cw(label, action).is_err(), "{label} {action}");
        }
    }
}
