pub(crate) const CONTESTING_TEST: bool = cfg!(feature = "contesting-test");
pub(crate) const PRODUCTION_IDENTIFIER: &str = "com.oliverbross.xlog.integration";
pub(crate) const TEST_IDENTIFIER: &str = "com.oliverbross.xlog.contesting-test";
static OFFLINE: std::sync::OnceLock<(std::path::PathBuf, uuid::Uuid)> = std::sync::OnceLock::new();
const OFFLINE_ARGUMENT: &str = "--offline-contest-acceptance=";

fn offline_coordinate(args: &[String]) -> Result<Option<(std::path::PathBuf, uuid::Uuid)>, String> {
    let values: Vec<_> = args.iter().filter_map(|arg| arg.strip_prefix(OFFLINE_ARGUMENT)).collect();
    if values.is_empty() { return Ok(None); }
    if values.len() != 1 || args.iter().any(|arg| arg == "--acceptance-report") || CONTESTING_TEST {
        return Err("Offline contest acceptance requires one production-candidate launch coordinate.".into());
    }
    let root = std::path::PathBuf::from(values[0]);
    let canonical = root.canonicalize().map_err(|_| "Offline acceptance directory is unavailable")?;
    let temp = std::env::temp_dir().canonicalize().map_err(|_| "Temporary directory unavailable")?;
    let system_temp = std::path::Path::new("/tmp").canonicalize().unwrap_or_else(|_| temp.clone());
    if !root.is_absolute() || root != canonical || !root.file_name().is_some_and(|name| name.to_string_lossy().starts_with("xlog-wave1-"))
        || ![temp, system_temp].iter().any(|parent| root.parent() == Some(parent.as_path())) {
        return Err("Offline acceptance requires a canonical xlog-wave1-* directory directly in temporary storage.".into());
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::metadata(&root).map_err(|e| e.to_string())?.permissions().mode() & 0o077 != 0 {
            return Err("Offline acceptance directory must be private (0700).".into());
        }
    }
    let marker = root.join(".xlog-offline-acceptance.json");
    if !std::fs::symlink_metadata(&marker).map_err(|e| e.to_string())?.is_file() { return Err("Offline acceptance marker must be a regular file.".into()); }
    let bytes = std::fs::read(marker).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 { return Err("Offline acceptance marker is too large.".into()); }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if value["schema"] != 1 { return Err("Offline acceptance marker schema is invalid.".into()); }
    let id = uuid::Uuid::parse_str(value["id"].as_str().ok_or("Offline acceptance identity missing")?).map_err(|e| e.to_string())?;
    Ok(Some((root, id)))
}

pub(crate) fn configure_offline(args: Vec<String>, config: &mut tauri::utils::config::Config) -> Result<(), String> {
    if let Some((root, id)) = offline_coordinate(&args)? {
        config.identifier = format!("com.oliverbross.xlog.wave1-acceptance.{}", id.simple());
        configure_offline_windows(config, id);
        config.app.security.csp = Some(tauri::utils::config::Csp::Policy(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'".into()));
        OFFLINE.set((root, id)).map_err(|_| "Offline acceptance already configured")?;
    }
    Ok(())
}
fn configure_offline_windows(config: &mut tauri::utils::config::Config, id: uuid::Uuid) {
    for window in &mut config.app.windows {
        window.title = format!("OM0RX-xLog — disposable offline acceptance {id}");
        window.data_store_identifier = Some(*id.as_bytes());
        // Tauri 2.12's config-to-WebviewAttributes conversion omits this ID.
        // Never auto-create a default-store main view, even briefly: setup and
        // reopen must use main_workspace's explicit offline_webview builder.
        window.create = false;
    }
}
pub(crate) fn offline_root() -> Option<&'static std::path::Path> { OFFLINE.get().map(|(root,_)| root.as_path()) }
pub(crate) fn connected_loopback() -> bool {
    offline_root().and_then(|root|std::fs::read(root.join(".xlog-offline-acceptance.json")).ok())
        .filter(|bytes|bytes.len()<=1024).and_then(|bytes|serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .is_some_and(|marker|marker["schema"]==1&&marker["connectedLoopback"]==true)
}
pub(crate) fn require_group_io() -> Result<(),String> {if connected_loopback(){Ok(())}else{require_external_io_disabled()}}
pub(crate) fn offline_webview(builder: tauri::WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle>) -> tauri::WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle> {
    #[cfg(target_os = "macos")]
    if let Some((_, id)) = OFFLINE.get() { return builder.data_store_identifier(*id.as_bytes()); }
    builder
}

pub(crate) fn validate_host(identifier: &str) -> Result<(), String> {
    match (CONTESTING_TEST, identifier) {
        (true, TEST_IDENTIFIER) | (false, PRODUCTION_IDENTIFIER) => Ok(()),
        _ => Err("Application bundle identity does not match its compiled runtime profile.".into()),
    }
}

pub(crate) fn isolated(acceptance: bool) -> bool { acceptance || CONTESTING_TEST || offline_root().is_some() }

pub(crate) fn require_external_io_disabled() -> Result<(), String> {
    if CONTESTING_TEST || offline_root().is_some() {
        Err("External services and station I/O are disabled in OM0RX-xLog Contesting Test.".into())
    } else {
        Ok(())
    }
}

pub(crate) fn validate_contesting_test_cw(label: &str, action: &str) -> Result<(), String> {
    if offline_root().is_some() { return Err("CW output is disabled in offline contest acceptance.".into()); }
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
    if connected_loopback() && matches!(method,"wsjtx_snapshot"|"wsjtx_configure"|"wsjtx_start"|"wsjtx_stop"|"wsjtx_select"|"fldigi_snapshot"|"fldigi_rx_text"|"fldigi_select"|"fldigi_accept_completed"|"fldigi_configure"|"fldigi_start"|"fldigi_stop"){return true;}
    profile_allows_worker_method(method, local_acceptance, CONTESTING_TEST || offline_root().is_some())
}
fn profile_allows_worker_method(method: &str, local_acceptance: bool, restricted: bool) -> bool {
    local_acceptance || !restricted || matches!(method,
        "health" | "parse_adif" | "self_test" | "integration_self_test" | "cluster_classify")
        || restricted && method != "contest_scp_download"
            && ["workspace_", "logbook_", "settings_", "backup_", "contest_"]
                .iter().any(|prefix| method.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(not(feature = "contesting-test"))]
    fn offline_acceptance_requires_private_marked_temporary_storage_and_blocks_outputs() {
        let temp = std::env::temp_dir().canonicalize().unwrap();
        let directory = tempfile::Builder::new().prefix("xlog-wave1-").tempdir_in(&temp).unwrap();
        let root = directory.path();
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700)).unwrap(); }
        let args = vec![format!("{OFFLINE_ARGUMENT}{}", root.display())];
        assert!(offline_coordinate(&args).is_err());
        let id = uuid::Uuid::new_v4();
        std::fs::write(root.join(".xlog-offline-acceptance.json"), serde_json::json!({"schema":1,"id":id}).to_string()).unwrap();
        assert_eq!(offline_coordinate(&args).unwrap(), Some((root.to_path_buf(), id)));
        assert!(offline_coordinate(&[args[0].clone(), args[0].clone()]).is_err());
        assert!(offline_coordinate(&[args[0].clone(), "--acceptance-report".into()]).is_err());
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(offline_coordinate(&args).is_err());
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700)).unwrap();
            let alias = temp.join(format!("xlog-wave1-{}", uuid::Uuid::new_v4()));
            std::os::unix::fs::symlink(root, &alias).unwrap();
            assert!(offline_coordinate(&[format!("{OFFLINE_ARGUMENT}{}", alias.display())]).is_err());
            std::fs::remove_file(alias).unwrap();
        }
        for method in ["station_connect", "cluster_connect", "sync_run", "lookup_call", "cw_decode_start", "cw_decode_source_start", "cw_decode_source_stop", "winkeyer_send", "contest_scp_download"] {
            assert!(!profile_allows_worker_method(method, false, true), "{method}");
        }
        for method in ["contest_qso_commit", "contest_operation_receipt", "contest_notes", "contest_analytics", "settings_load"] {
            assert!(profile_allows_worker_method(method, false, true), "{method}");
        }
    }

    #[test]
    fn offline_bootstrap_defers_default_store_views_to_the_explicit_builder() {
        let mut config = tauri::utils::config::Config::default();
        config.app.windows.push(tauri::utils::config::WindowConfig::default());
        let id = uuid::Uuid::new_v4();
        configure_offline_windows(&mut config, id);
        assert!(config.app.windows.iter().all(|window| !window.create));
        assert!(config.app.windows.iter().all(|window| window.data_store_identifier == Some(*id.as_bytes())));
        assert!(config.app.windows[0].title.contains(&id.to_string()));
        assert!(!config.app.windows[0].incognito, "restart acceptance requires the private persistent store");
    }

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
