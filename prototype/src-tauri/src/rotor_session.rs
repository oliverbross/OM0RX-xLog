//! Native saved rotor connection intent. Startup never issues a motion command.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io::Write, path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock}};
use tauri::Manager;

pub(crate) struct AutomaticPolicy {
    pub startup: bool,
    pub bands: Vec<String>,
}
pub(crate) struct AutomaticStartup {
    pub owner: String,
    pub generation: u64,
    pub bands: Vec<String>,
}

fn automatic_policy(snapshot: &Value) -> Result<AutomaticPolicy, String> {
    let configuration = snapshot.get("configuration").and_then(Value::as_object)
        .ok_or("Saved automatic rotor policy is invalid.")?;
    let startup = match configuration.get("auto_rotor_at_startup") {
        Some(value) => value.as_bool().ok_or("Saved automatic rotor policy is invalid.")?,
        None => true,
    };
    let bands = match configuration.get("auto_rotor_bands") {
        Some(value) => value.as_array().ok_or("Saved automatic rotor band policy is invalid.")?
            .iter().map(|band| band.as_str().map(str::to_owned)
                .ok_or("Saved automatic rotor band policy is invalid.")).collect::<Result<Vec<_>, _>>()?,
        None => crate::auto_rotor::SUPPORTED_BANDS.iter().map(|band| (*band).into()).collect(),
    };
    Ok(AutomaticPolicy { startup, bands: crate::auto_rotor::normalize_bands(&bands)? })
}

#[derive(Serialize, Deserialize)]
struct Receipt {
    version: u8,
    operation_id: String,
    action: String,
    status: String,
    configuration: Value,
}

struct Session {
    path: PathBuf,
    operation: Mutex<()>,
    checked: AtomicBool,
    invalidated: AtomicBool,
    stopped: AtomicBool,
}

fn connection(snapshot: &Value) -> Result<Option<Value>, String> {
    if snapshot["generation"].as_str().is_none_or(|value| uuid::Uuid::parse_str(value).is_err())
        || snapshot["revision"].as_u64().is_none_or(|value| value > 9_007_199_254_740_991) {
        return Err("Saved rotor configuration identity is invalid.".into());
    }
    let config = &snapshot["configuration"];
    match config["owner"].as_str() {
        Some("native_dcu1") => {
            let native = &config["native_dcu1"];
            let host = native["host"].as_str().ok_or("Saved rotor host is invalid.")?.trim();
            if host.is_empty() { return Ok(None); }
            if host.len() > 512 || host.chars().any(|ch| ch.is_whitespace() || matches!(ch, '/' | '@' | '?' | '#'))
                || native["port"].as_u64().is_none_or(|port| !(1..=65535).contains(&port))
                || native["name"].as_str().is_none_or(|name| name.trim().is_empty() || name.trim().len() > 64) {
                return Err("Saved rotor connection is invalid.".into());
            }
            Ok(Some(json!({"owner":"native_dcu1","host":host,"port":native["port"],
                "name":native["name"].as_str().unwrap().trim()})))
        }
        // Other rotor transports retain their explicit connection workflow.
        Some("hamlib") => Ok(None),
        _ => Err("Saved rotor owner is invalid.".into()),
    }
}

fn connection_settings(configuration: &Value) -> Option<Value> {
    let mut settings = configuration.as_object()?.clone();
    settings.remove("auto_rotor_at_startup");
    settings.remove("auto_rotor_bands");
    Some(Value::Object(settings))
}

impl Session {
    fn new(path: PathBuf) -> Self {
        Self { path, operation: Mutex::new(()), checked: AtomicBool::new(false),
            invalidated: AtomicBool::new(false), stopped: AtomicBool::new(false) }
    }
    fn read(&self) -> Result<Option<Receipt>, String> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) if bytes.len() <= 32_768 => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            _ => return Err("Rotor connection receipt is unavailable; it was not overwritten.".into()),
        };
        let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|_| "Rotor connection receipt is invalid; it was not overwritten.")?;
        if receipt.version != 1 || uuid::Uuid::parse_str(&receipt.operation_id).is_err()
            || !matches!(receipt.action.as_str(), "connect" | "disconnect")
            || !matches!(receipt.status.as_str(), "pending" | "acknowledged" | "unknown") {
            return Err("Rotor connection receipt is unsupported; it was not overwritten.".into());
        }
        Ok(Some(receipt))
    }
    fn persist(&self, receipt: &Receipt) -> Result<(), String> {
        let directory = self.path.parent().ok_or("Rotor connection storage is unavailable.")?;
        std::fs::create_dir_all(directory).map_err(|_| "Rotor connection storage is unavailable.")?;
        let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|_| "Rotor connection receipt could not be saved.")?;
        file.write_all(&serde_json::to_vec(receipt).map_err(|_| "Rotor connection receipt is invalid.")?)
            .and_then(|_| file.as_file().sync_all()).map_err(|_| "Rotor connection receipt could not be saved.")?;
        file.persist(&self.path).map_err(|_| "Rotor connection receipt could not be saved.")?;
        Ok(())
    }
    fn active(&self) -> Result<(), String> {
        if self.stopped.load(Ordering::Acquire) { Err("Rotor session is shutting down.".into()) } else { Ok(()) }
    }
    fn dispatch(&self, request: Value, configuration: Value,
        dispatch: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
        self.active()?;
        let action = match request["method"].as_str() {
            Some("rotor_connect") => "connect", Some("rotor_disconnect") => "disconnect",
            _ => return Err("Rotor connection intent accepts only connect or disconnect.".into()),
        };
        let mut receipt = Receipt { version: 1, operation_id: uuid::Uuid::new_v4().to_string(),
            action: action.into(), status: "pending".into(), configuration };
        self.persist(&receipt)?;
        let id = request["id"].clone();
        let result = dispatch(request);
        receipt.status = if result.as_ref().is_ok_and(|reply| reply["id"] == id && reply["ok"] == true) {
            "acknowledged" } else { "unknown" }.into();
        self.persist(&receipt)?;
        result
    }
    fn resume(&self, load: impl FnOnce() -> Result<Value, String>,
        dispatch: impl FnOnce(Value) -> Result<Value, String>) -> Result<Option<Value>, String> {
        if self.checked.swap(true, Ordering::AcqRel) { return Ok(None); }
        let _operation = self.operation.lock().map_err(|_| "Rotor session is unavailable.")?;
        self.active()?;
        if self.invalidated.load(Ordering::Acquire) { return Ok(None); }
        let previous = self.read()?;
        if previous.as_ref().is_some_and(|receipt| receipt.status != "acknowledged" || receipt.action == "disconnect") {
            return Ok(None);
        }
        let saved = load()?;
        let Some(params) = connection(&saved)? else { return Ok(None); };
        if self.invalidated.load(Ordering::Acquire)
            || previous.as_ref().is_some_and(|receipt| receipt.configuration != saved) { return Ok(None); }
        let request = json!({"id":uuid::Uuid::new_v4().to_string(),"method":"rotor_connect","params":params});
        self.dispatch(request, saved, dispatch).map(Some)
    }
    fn request(&self, request: Value, load: impl FnOnce() -> Result<Value, String>,
        dispatch: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
        let _operation = self.operation.lock().map_err(|_| "Rotor session is unavailable.")?;
        // Any explicit lifecycle attempt prevents a delayed startup restore.
        self.invalidated.store(true, Ordering::Release);
        let previous = self.read()?;
        let configuration = if request["method"] == "rotor_disconnect" {
            previous.map_or(Value::Null, |receipt| receipt.configuration)
        } else {
            let saved = load()?;
            if saved["configuration"]["owner"] != request["params"]["owner"]
                || request["params"]["owner"] == "native_dcu1" && connection(&saved)?.as_ref() != Some(&request["params"]) {
                return Err("Saved rotor configuration changed; review it before connecting.".into());
            }
            saved
        };
        self.dispatch(request, configuration, dispatch)
    }
    fn save_configuration(&self, request: Value,
        dispatch: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
        // A save racing startup must stop that launch's reconnect, even if it conflicts.
        self.invalidated.store(true, Ordering::Release);
        let _operation = self.operation.lock().map_err(|_| "Rotor session is unavailable.")?;
        let previous = self.read().ok().flatten();
        let response = dispatch(request.clone())?;
        if let Some(mut receipt) = previous.filter(|receipt|
            receipt.action == "connect" && receipt.status == "acknowledged"
            && receipt.configuration["revision"] == request["params"]["expectedRevision"]
            && receipt.configuration["generation"] == request["params"]["generation"])
        {
            let result = &response["result"];
            let saved = json!({"revision":result["revision"], "generation":result["generation"],
                "configuration":result["configuration"]});
            let old_revision = receipt.configuration["revision"].as_u64();
            if response["id"] == request["id"] && response["ok"] == true
                && result["status"] == "applied"
                && saved["generation"] == receipt.configuration["generation"]
                && saved["configuration"] == request["params"]["configuration"]
                && old_revision.is_some_and(|revision|
                    saved["revision"].as_u64() == (if saved["configuration"] == receipt.configuration["configuration"] {
                        Some(revision)
                    } else { revision.checked_add(1) }))
                && connection_settings(&saved["configuration"])
                    == connection_settings(&receipt.configuration["configuration"])
                && connection(&receipt.configuration)?.is_some()
                && connection(&saved)?.is_some()
            {
                receipt.configuration = saved;
                self.persist(&receipt)?;
            }
        }
        Ok(response)
    }
}

static OWNER: OnceLock<Session> = OnceLock::new();
fn owner() -> Result<&'static Session, String> { OWNER.get().ok_or("Rotor connection owner is unavailable.".into()) }
fn load() -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let reply = crate::worker::request(json!({"id":id,"method":"workspace_rotor_configuration_load","params":{}}))?;
    if reply["id"] != id || reply["ok"] != true { return Err("Saved rotor configuration is unavailable.".into()); }
    Ok(reply["result"].clone())
}
pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_config_dir().map_err(|_| "Rotor connection storage is unavailable.")?.join("rotor-session.json");
    OWNER.get_or_init(|| Session::new(path));
    Ok(())
}
pub(crate) fn automatic_policy_saved() -> Result<AutomaticPolicy, String> { automatic_policy(&load()?) }
pub fn resume() -> Result<Option<AutomaticStartup>, String> {
    let mut policy = None;
    let connected = owner()?.resume(|| {
        let saved = load()?;
        policy = Some(automatic_policy(&saved)?);
        Ok(saved)
    }, crate::rotor::request_startup)?;
    if connected.is_none() || !policy.as_ref().is_some_and(|value| value.startup) { return Ok(None); }

    // A successful reconnect is not telemetry. Observe the native owner again
    // before minting launch-time permission; this operation never moves it.
    let id = uuid::Uuid::new_v4().to_string();
    let observed = crate::rotor::request(json!({"id":id,"method":"rotor_snapshot","params":{}}))?;
    if observed["id"] != id || observed["ok"] != true {
        return Err("Automatic rotor startup observation was not acknowledged.".into());
    }
    let (owner, generation) = crate::rotor::automatic_owner()?
        .ok_or("Observe a connected rotor before enabling automatic turns.")?;
    Ok(Some(AutomaticStartup { owner, generation, bands: policy.unwrap().bands }))
}
pub fn request(request: Value) -> Result<Value, String> {
    if matches!(request["method"].as_str(), Some("rotor_connect" | "rotor_disconnect")) {
        owner()?.request(request, load, crate::rotor::request)
    } else { crate::rotor::request(request) }
}
pub fn invalidate_configuration() { if let Some(owner) = OWNER.get() { owner.invalidated.store(true, Ordering::Release); } }
pub fn configuration_change<T>(action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _operation = owner()?.operation.lock().map_err(|_| "Rotor session is unavailable.")?;
    action()
}
pub fn save_configuration(request: Value) -> Result<Value, String> {
    owner()?.save_configuration(request, crate::worker::request)
}
pub fn shutdown() { if let Some(owner) = OWNER.get() { owner.stopped.store(true, Ordering::Release); } }

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Session, Value) {
        let directory = tempfile::tempdir().unwrap();
        let session = Session::new(directory.path().join("rotor-session.json"));
        let saved = json!({"generation":uuid::Uuid::new_v4().to_string(),"revision":3,
            "configuration":{"owner":"native_dcu1","native_dcu1":{"host":"rotor.example.invalid","port":4001,"name":"ARCO"},
                "hamlib":{"mode":"managed","model":null,"path":"","baud":9600}}});
        (directory, session, saved)
    }
    fn reply(request: Value) -> Result<Value, String> { Ok(json!({"id":request["id"],"ok":true,"result":{}})) }
    fn save_request(saved: &Value, next: &Value) -> Value {
        json!({"id":uuid::Uuid::new_v4().to_string(),"method":"workspace_rotor_configuration_save",
            "params":{"expectedRevision":saved["revision"],"generation":saved["generation"],
                "configuration":next["configuration"]}})
    }
    fn saved_reply(request: Value, next: Value) -> Result<Value, String> {
        Ok(json!({"id":request["id"],"ok":true,"result":{"status":"applied",
            "revision":next["revision"],"generation":next["generation"],
            "configuration":next["configuration"]}}))
    }
    fn forbidden(_: Value) -> Result<Value, String> { panic!("Unexpected rotor dispatch") }
    #[test]
    fn startup_resumes_shared_saved_dcu1_once_and_only_opens_a_connection() {
        let (_directory, session, saved) = fixture();
        session.resume(|| Ok(saved.clone()), |request| {
            assert_eq!(request["method"], "rotor_connect");
            assert_eq!(request["params"], json!({"owner":"native_dcu1","host":"rotor.example.invalid","port":4001,"name":"ARCO"}));
            assert_eq!(request.as_object().unwrap().len(), 3);
            assert_eq!(session.read().unwrap().unwrap().status, "pending");
            reply(request)
        }).unwrap().unwrap();
        let receipt = session.read().unwrap().unwrap();
        assert_eq!(receipt.status, "acknowledged");
        assert_eq!(receipt.configuration, saved);
        assert!(session.resume(|| panic!("Startup read repeated"), forbidden).unwrap().is_none());
    }
    #[test]
    fn explicit_disconnect_suppresses_startup_after_restart() {
        let (directory, session, _saved) = fixture();
        session.request(json!({"id":"disconnect","method":"rotor_disconnect","params":{"owner":"native_dcu1","generation":1}}),
            || panic!("Disconnect must not depend on a workspace read"), reply).unwrap();
        let restored = Session::new(directory.path().join("rotor-session.json"));
        assert!(restored.resume(|| panic!("Disconnect intent was ignored"), forbidden).unwrap().is_none());
    }
    #[test]
    fn startup_does_not_replay_pending_unknown_or_lost_acknowledgement() {
        for status in ["pending", "unknown", "lost_ack"] {
            let (directory, session, saved) = fixture();
            if status == "lost_ack" {
                assert!(session.resume(|| Ok(saved.clone()), |_| Err("lost reply".into())).is_err());
                assert_eq!(session.read().unwrap().unwrap().status, "unknown");
            } else {
                session.persist(&Receipt { version:1, operation_id:uuid::Uuid::new_v4().to_string(),
                    action:"connect".into(), status:status.into(), configuration:saved.clone() }).unwrap();
            }
            let restored = Session::new(directory.path().join("rotor-session.json"));
            assert!(restored.resume(|| panic!("Uncertain receipt loaded configuration"), forbidden).unwrap().is_none());
        }
    }
    #[test]
    fn startup_requires_exact_saved_configuration_revision_workspace_generation_and_owner() {
        for key in ["revision", "generation", "host", "owner"] {
            let (directory, session, saved) = fixture();
            session.resume(|| Ok(saved.clone()), reply).unwrap();
            let restored = Session::new(directory.path().join("rotor-session.json"));
            let mut changed = saved.clone();
            match key {
                "revision" => changed["revision"] = json!(4),
                "generation" => changed["generation"] = json!(uuid::Uuid::new_v4().to_string()),
                "host" => changed["configuration"]["native_dcu1"]["host"] = json!("different.example.invalid"),
                _ => changed["configuration"]["owner"] = json!("hamlib"),
            }
            assert!(restored.resume(|| Ok(changed), forbidden).unwrap().is_none(), "{key}");
        }
    }
    #[test]
    fn configuration_save_or_restore_during_load_cancels_startup_without_a_receipt() {
        let (_directory, session, saved) = fixture();
        assert!(session.resume(|| {
            session.invalidated.store(true, Ordering::Release);
            Ok(saved)
        }, forbidden).unwrap().is_none());
        assert!(session.read().unwrap().is_none());
    }
    #[test]
    fn startup_skips_empty_forgotten_or_unsupported_configurations_and_shutdown() {
        let (_directory, session, mut saved) = fixture();
        saved["configuration"]["native_dcu1"]["host"] = json!("");
        assert!(session.resume(|| Ok(saved), forbidden).unwrap().is_none());
        let (_directory, session, saved) = fixture();
        session.stopped.store(true, Ordering::Release);
        assert!(session.resume(|| Ok(saved), forbidden).is_err());
    }
    #[test]
    fn failed_receipt_storage_cannot_open_a_rotor_connection() {
        let (directory, session, saved) = fixture();
        std::fs::create_dir(directory.path().join("rotor-session.json")).unwrap();
        assert!(session.resume(|| Ok(saved), forbidden).is_err());
    }
    #[test]
    fn explicit_connect_rejects_stale_configuration_or_provider_before_journaling() {
        for owner in ["native_dcu1", "hamlib"] {
            let (_directory, session, saved) = fixture();
            assert!(session.request(json!({"id":"stale","method":"rotor_connect",
                "params":{"owner":owner,"host":"obsolete.example.invalid","port":4001,"name":"ARCO"}}),
                || Ok(saved), forbidden).is_err());
            assert!(session.read().unwrap().is_none());
        }
    }
    #[test]
    fn acknowledged_resume_can_connect_again_next_launch_without_replaying_previous_identity() {
        let (directory, session, saved) = fixture();
        session.resume(|| Ok(saved.clone()), reply).unwrap();
        let previous = session.read().unwrap().unwrap().operation_id;
        let restored = Session::new(directory.path().join("rotor-session.json"));
        restored.resume(|| Ok(saved), |request| {
            assert_eq!(request["method"], "rotor_connect");
            assert_ne!(request["id"], previous); reply(request)
        }).unwrap().unwrap();
        assert_ne!(restored.read().unwrap().unwrap().operation_id, previous);
    }
    #[test]
    fn policy_only_save_preserves_acknowledged_connection_for_next_launch() {
        let (directory, session, saved) = fixture();
        session.resume(|| Ok(saved.clone()), reply).unwrap();
        let mut next = saved.clone();
        next["revision"] = json!(4);
        next["configuration"]["auto_rotor_at_startup"] = json!(true);
        next["configuration"]["auto_rotor_bands"] = json!(["20m", "6m"]);
        let request = save_request(&saved, &next);
        session.save_configuration(request, |request| saved_reply(request, next.clone())).unwrap();
        assert_eq!(session.read().unwrap().unwrap().configuration, next);
        let restored = Session::new(directory.path().join("rotor-session.json"));
        assert!(restored.resume(|| Ok(next), reply).unwrap().is_some());
    }
    #[test]
    fn connection_setting_save_revokes_next_launch_resume() {
        for field in ["host", "port", "owner", "hamlib"] {
            let (directory, session, saved) = fixture();
            session.resume(|| Ok(saved.clone()), reply).unwrap();
            let mut next = saved.clone();
            next["revision"] = json!(4);
            match field {
                "host" => next["configuration"]["native_dcu1"]["host"] = json!("other.example.invalid"),
                "port" => next["configuration"]["native_dcu1"]["port"] = json!(4002),
                "owner" => next["configuration"]["owner"] = json!("hamlib"),
                _ => next["configuration"]["hamlib"]["baud"] = json!(19200),
            }
            let request = save_request(&saved, &next);
            session.save_configuration(request, |request| saved_reply(request, next.clone())).unwrap();
            assert_eq!(session.read().unwrap().unwrap().configuration, saved, "{field}");
            let restored = Session::new(directory.path().join("rotor-session.json"));
            assert!(restored.resume(|| Ok(next), forbidden).unwrap().is_none(), "{field}");
        }
    }
    #[test]
    fn policy_save_does_not_promote_an_uncertain_connection() {
        let (directory, session, saved) = fixture();
        session.persist(&Receipt { version: 1, operation_id: uuid::Uuid::new_v4().to_string(),
            action: "connect".into(), status: "unknown".into(), configuration: saved.clone() }).unwrap();
        let mut next = saved.clone();
        next["revision"] = json!(4);
        next["configuration"]["auto_rotor_at_startup"] = json!(true);
        let request = save_request(&saved, &next);
        session.save_configuration(request, |request| saved_reply(request, next.clone())).unwrap();
        assert_eq!(session.read().unwrap().unwrap().status, "unknown");
        let restored = Session::new(directory.path().join("rotor-session.json"));
        assert!(restored.resume(|| panic!("Uncertain intent must not load settings"), forbidden).unwrap().is_none());
    }
    #[test]
    fn automatic_policy_defaults_on_for_legacy_settings_and_preserves_explicit_off() {
        let (_directory, _session, mut saved) = fixture();
        let legacy = automatic_policy(&saved).unwrap();
        assert!(legacy.startup);
        assert_eq!(legacy.bands, crate::auto_rotor::SUPPORTED_BANDS);

        saved["configuration"]["auto_rotor_at_startup"] = json!(false);
        saved["configuration"]["auto_rotor_bands"] = json!(["20m", "6m"]);
        let explicit = automatic_policy(&saved).unwrap();
        assert!(!explicit.startup); assert_eq!(explicit.bands, ["20m", "6m"]);

        saved["configuration"]["auto_rotor_bands"] = json!(["20m", "20m"]);
        assert!(automatic_policy(&saved).is_err());
        saved["configuration"]["auto_rotor_bands"] = json!(["1.25m"]);
        assert!(automatic_policy(&saved).is_err());
    }
}
