//! Shared Agent connection setup and durable command admission. No background I/O.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::Manager;

const MAX_REVISION: u64 = 9_007_199_254_740_991;
const MAX_RECEIPTS: usize = 256;
#[derive(Clone, Serialize, Deserialize)]
struct Receipt {
    operation_id: String,
    request: Value,
    status: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    version: u8,
    generation: String,
    revision: u64,
    base_url: String,
    receipts: Vec<Receipt>,
}
pub struct Session {
    path: PathBuf,
    state: Mutex<Saved>,
    operation: Mutex<()>,
}

pub fn validate(label: &str, isolated: bool, action: &str) -> Result<(), String> {
    if isolated || !matches!(label, "main" | "station-control") {
        return Err("This window cannot perform that Station Control operation.".into());
    }
    if !matches!(
        action,
        "snapshot" | "receipt" | "save" | "connect" | "disconnect" | "forget"
    ) {
        return Err("Unknown Station Control operation.".into());
    }
    Ok(())
}
fn endpoint(value: &str) -> Result<String, String> {
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.len() > 2048 {
        return Err("Agent endpoint is too long.".into());
    }
    let url = tauri::Url::parse(value).map_err(|_| "Enter a valid Agent HTTPS URL.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use an HTTPS endpoint without credentials, query or fragment.".into());
    }
    Ok(url.to_string().trim_end_matches('/').into())
}
impl Session {
    fn new(path: PathBuf) -> Result<Self, String> {
        let mut saved = match std::fs::read(&path) {
            Ok(bytes) if bytes.len() <= 1_048_576 => serde_json::from_slice::<Saved>(&bytes)
                .map_err(|_| "Saved Station Control state is invalid; it was not overwritten.")?,
            Ok(_) => return Err("Saved Station Control state is too large.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Saved {
                version: 1,
                generation: uuid::Uuid::new_v4().to_string(),
                revision: 0,
                base_url: String::new(),
                receipts: vec![],
            },
            Err(_) => return Err("Saved Station Control state could not be read.".into()),
        };
        if saved.version != 1
            || uuid::Uuid::parse_str(&saved.generation).is_err()
            || saved.revision > MAX_REVISION
            || saved.receipts.len() > MAX_RECEIPTS
            || endpoint(&saved.base_url)? != saved.base_url
        {
            return Err(
                "Saved Station Control state is unsupported; it was not overwritten.".into(),
            );
        }
        let mut identities = std::collections::HashSet::new();
        for receipt in &saved.receipts {
            let action = receipt.request["action"].as_str().unwrap_or("");
            let keys = if action == "save" {
                vec!["action", "generation", "revision", "base_url"]
            } else {
                vec![
                    "action",
                    "generation",
                    "revision",
                    "selection_generation",
                    "selection_id",
                    "allow_transmit",
                ]
            };
            if uuid::Uuid::parse_str(&receipt.operation_id).is_err()
                || !identities.insert(&receipt.operation_id)
                || !matches!(
                    receipt.status.as_str(),
                    "saved" | "pending" | "acknowledged" | "unknown"
                )
                || !matches!(action, "save" | "connect" | "disconnect" | "forget")
                || (action == "save") != (receipt.status == "saved")
                || receipt.request["generation"] != saved.generation
                || receipt.request["revision"]
                    .as_u64()
                    .is_none_or(|revision| revision > saved.revision)
                || receipt.request.as_object().is_none_or(|request| {
                    request.len() != keys.len()
                        || request.keys().any(|key| !keys.contains(&key.as_str()))
                })
            {
                return Err(
                    "Saved Station Control receipt is invalid; it was not overwritten.".into(),
                );
            }
            if action == "save" {
                let url = receipt.request["base_url"]
                    .as_str()
                    .ok_or("Saved Agent endpoint is invalid.")?;
                if endpoint(url)? != url {
                    return Err("Saved Agent endpoint is invalid.".into());
                }
            } else if receipt.request["selection_generation"]
                .as_u64()
                .is_none_or(|revision| revision > MAX_REVISION)
                || receipt.request["selection_id"]
                    .as_str()
                    .is_none_or(|id| uuid::Uuid::parse_str(id).is_err())
                || !receipt.request["allow_transmit"].is_boolean()
            {
                return Err("Saved Station Control selection receipt is invalid.".into());
            }
        }
        // A crash after admission cannot prove whether the external action ran.
        // Retain the operation identity forever in this bounded journal; never replay it.
        for receipt in &mut saved.receipts {
            if receipt.status == "pending" {
                receipt.status = "unknown".into();
            }
        }
        Ok(Self {
            path,
            state: Mutex::new(saved),
            operation: Mutex::new(()),
        })
    }
    fn persist(&self, saved: &Saved) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Station Control storage is unavailable.")?;
        std::fs::create_dir_all(parent).map_err(|_| "Station Control storage is unavailable.")?;
        let mut file = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Station Control state could not be saved.")?;
        file.write_all(
            serde_json::to_string(saved)
                .map_err(|_| "Station Control serialization failed.")?
                .as_bytes(),
        )
        .map_err(|_| "Station Control state could not be saved.")?;
        file.as_file()
            .sync_all()
            .map_err(|_| "Station Control state could not be saved.")?;
        file.persist(&self.path)
            .map_err(|_| "Station Control state could not be saved.")?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Station Control state is unavailable.")?;
        Ok(
            json!({"generation":state.generation,"revision":state.revision,"base_url":state.base_url,
            "last_receipt":state.receipts.last(),"remaining_operations":MAX_RECEIPTS-state.receipts.len()}),
        )
    }
    pub fn receipt(&self, id: &str) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Station Control state is unavailable.")?;
        Ok(state
            .receipts
            .iter()
            .find(|receipt| receipt.operation_id == id)
            .map_or(Value::Null, |receipt| json!(receipt)))
    }
    pub fn apply(
        &self,
        params: &Value,
        dispatch: impl FnOnce(Value, u64, &str) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let _operation = self
            .operation
            .try_lock()
            .map_err(|_| "Another Station Control operation is in progress.")?;
        let action = params["action"]
            .as_str()
            .ok_or("Missing Station Control action.")?;
        if !matches!(action, "save" | "connect" | "disconnect" | "forget") {
            return Err("Unknown Station Control action.".into());
        }
        let id = params["operation_id"]
            .as_str()
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
            .ok_or("Invalid Station Control operation identity.")?;
        let generation = params["generation"]
            .as_str()
            .ok_or("Missing Station Control generation.")?;
        let revision = params["revision"]
            .as_u64()
            .filter(|value| *value <= MAX_REVISION)
            .ok_or("Invalid Station Control revision.")?;
        let mut descriptor = json!({"action":action,"generation":generation,"revision":revision});
        if action == "save" {
            descriptor["base_url"] = json!(endpoint(
                params["base_url"]
                    .as_str()
                    .ok_or("Missing Agent endpoint.")?
            )?);
        } else {
            descriptor["selection_generation"] = params["selection_generation"].clone();
            descriptor["selection_id"] = params["selection_id"].clone();
            descriptor["allow_transmit"] = json!(params["allow_transmit"] == true);
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Station Control state is unavailable.")?;
        if let Some(receipt) = state
            .receipts
            .iter()
            .find(|receipt| receipt.operation_id == id)
        {
            if receipt.request != descriptor {
                return Err("That Station Control operation identity was already used for a different request.".into());
            }
            return Ok(json!(receipt));
        }
        if state.generation != generation || state.revision != revision {
            return Err(
                "Station Control setup changed. Refresh and review it before applying again."
                    .into(),
            );
        }
        if state.receipts.len() == MAX_RECEIPTS {
            return Err("Station Control operation journal is full; no action was sent.".into());
        }
        let mut next = state.clone();
        if action == "save" {
            next.base_url = descriptor["base_url"].as_str().unwrap().into();
            if next.base_url != state.base_url {
                next.revision = next
                    .revision
                    .checked_add(1)
                    .filter(|value| *value <= MAX_REVISION)
                    .ok_or("Station Control revision exhausted.")?;
            }
        }
        let request = if action == "save" {
            None
        } else {
            let selected_generation = params["selection_generation"]
                .as_u64()
                .filter(|value| *value <= MAX_REVISION)
                .ok_or("Invalid radio selection generation.")?;
            let selected_id = params["selection_id"]
                .as_str()
                .filter(|value| uuid::Uuid::parse_str(value).is_ok())
                .ok_or("Invalid radio selection identity.")?;
            let mut connection = json!({"provider":"direct_agent"});
            if matches!(action, "connect" | "forget") {
                if state.base_url.is_empty() {
                    return Err("Save an Agent endpoint before connecting.".into());
                }
                connection["base_url"] = json!(state.base_url);
                connection["allow_transmit"] =
                    json!(action == "connect" && params["allow_transmit"] == true);
                if let Some(token) = params.get("token") {
                    if token.as_str().is_none_or(|value| value.len() > 4096) {
                        return Err("Invalid Agent token.".into());
                    }
                    connection["token"] = token.clone();
                }
            }
            // Every admitted lifecycle command advances shared command state,
            // fencing a second action composed against an older connection view.
            next.revision = next
                .revision
                .checked_add(1)
                .filter(|value| *value <= MAX_REVISION)
                .ok_or("Station Control revision exhausted.")?;
            Some((
                json!({"id":id,"method":match action { "connect" => "station_connect", "forget" => "station_forget", _ => "station_disconnect" },"params":connection}),
                selected_generation,
                selected_id.to_owned(),
            ))
        };
        next.receipts.push(Receipt {
            operation_id: id.into(),
            request: descriptor,
            status: if action == "save" { "saved" } else { "pending" }.into(),
        });
        self.persist(&next)?;
        *state = next;
        if request.is_none() {
            return Ok(json!(state.receipts.last().unwrap()));
        }
        drop(state);
        let (request, selected_generation, selected_id) = request.unwrap();
        let result = dispatch(request, selected_generation, &selected_id);
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Station Control outcome is unknown; inspect its receipt.")?;
        let mut next = state.clone();
        let receipt = next.receipts.last_mut().unwrap();
        // Even a failed transport can have reached the Agent. Never infer failure
        // or radio confirmation, persist raw responses, tokens or external errors.
        receipt.status = if result
            .as_ref()
            .is_ok_and(|response| response["id"] == id && response["ok"] == true)
        {
            "acknowledged"
        } else {
            "unknown"
        }
        .into();
        let response = json!(receipt);
        self.persist(&next).map_err(|_| {
            "Station Control outcome could not be saved; inspect its receipt before another action."
        })?;
        *state = next;
        Ok(response)
    }
}
static OWNER: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<Session>, String> {
    let mut owner = OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Station Control is unavailable.")?;
    if let Some(owner) = owner.as_ref() {
        return Ok(owner.clone());
    }
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Station Control storage is unavailable.")?
        .join("station-session.json");
    let session = Arc::new(Session::new(path)?);
    *owner = Some(session.clone());
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Session, Value) {
        let directory = tempfile::tempdir().unwrap();
        let session = Session::new(directory.path().join("session.json")).unwrap();
        let state = session.snapshot().unwrap();
        let params = json!({"action":"save","operation_id":uuid::Uuid::new_v4().to_string(),"generation":state["generation"],"revision":0,"base_url":"https://station.example:8443"});
        (directory, session, params)
    }
    fn passive(_: Value, _: u64, _: &str) -> Result<Value, String> {
        panic!("Configuration touched transport")
    }
    #[test]
    fn shared_setup_is_durable_revision_fenced_and_exactly_replayed() {
        let (directory, session, params) = setup();
        let receipt = session.apply(&params, passive).unwrap();
        assert_eq!(receipt["status"], "saved");
        assert_eq!(session.snapshot().unwrap()["revision"], 1);
        assert_eq!(session.apply(&params, passive).unwrap(), receipt);
        let mut conflict = params.clone();
        conflict["base_url"] = json!("https://other.example");
        assert!(session.apply(&conflict, passive).is_err());
        conflict["operation_id"] = json!(uuid::Uuid::new_v4().to_string());
        assert!(session.apply(&conflict, passive).is_err());
        let restored = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(
            restored.snapshot().unwrap()["base_url"],
            "https://station.example:8443"
        );
        assert_eq!(restored.apply(&params, passive).unwrap(), receipt);
    }
    #[test]
    fn connection_admission_is_persisted_before_dispatch_and_never_replayed() {
        let (directory, session, params) = setup();
        session.apply(&params, passive).unwrap();
        let selection = uuid::Uuid::new_v4().to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let command = json!({"action":"connect","operation_id":id,"generation":params["generation"],"revision":1,
            "selection_generation":7,"selection_id":selection,"token":"secret-token","allow_transmit":false});
        let receipt = session
            .apply(&command, |request, generation, identity| {
                assert_eq!(generation, 7);
                assert_eq!(identity, selection);
                assert_eq!(request["params"]["token"], "secret-token");
                assert_eq!(
                    request["params"]["base_url"],
                    "https://station.example:8443"
                );
                assert_eq!(session.receipt(&id).unwrap()["status"], "pending");
                let disk = std::fs::read_to_string(directory.path().join("session.json")).unwrap();
                assert!(disk.contains("pending"));
                assert!(!disk.contains("secret-token"));
                Ok(json!({"id":id,"ok":true,"result":{"token":"never-store-response"}}))
            })
            .unwrap();
        assert_eq!(receipt["status"], "acknowledged");
        assert_eq!(session.snapshot().unwrap()["revision"], 2);
        assert_eq!(session.apply(&command, passive).unwrap(), receipt);
        let mut stale = command.clone();
        stale["operation_id"] = json!(uuid::Uuid::new_v4().to_string());
        assert!(session.apply(&stale, passive).is_err());
        let disk = std::fs::read_to_string(directory.path().join("session.json")).unwrap();
        assert!(!disk.contains("secret-token"));
        assert!(!disk.contains("never-store-response"));
    }
    #[test]
    fn lost_acknowledgement_and_crash_admission_remain_inspectable_unknowns() {
        let (directory, session, params) = setup();
        session.apply(&params, passive).unwrap();
        let command = json!({"action":"disconnect","operation_id":uuid::Uuid::new_v4().to_string(),"generation":params["generation"],"revision":1,
            "selection_generation":3,"selection_id":uuid::Uuid::new_v4().to_string()});
        let receipt = session
            .apply(&command, |_, _, _| {
                Err("token-sensitive external error".into())
            })
            .unwrap();
        assert_eq!(receipt["status"], "unknown");
        assert_eq!(session.apply(&command, passive).unwrap(), receipt);
        let mut crashed = session.state.lock().unwrap().clone();
        crashed.receipts.last_mut().unwrap().status = "pending".into();
        session.persist(&crashed).unwrap();
        let restored = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(
            restored.apply(&command, passive).unwrap()["status"],
            "unknown"
        );
        assert!(
            !std::fs::read_to_string(directory.path().join("session.json"))
                .unwrap()
                .contains("token-sensitive")
        );
    }
    #[test]
    fn child_and_main_admit_only_shared_agent_lifecycle_and_passive_setup() {
        for action in [
            "snapshot",
            "receipt",
            "save",
            "connect",
            "disconnect",
            "forget",
        ] {
            for label in ["main", "station-control"] {
                assert!(validate(label, false, action).is_ok());
                assert!(validate(label, true, action).is_err());
            }
            for label in ["monitor", "settings", "chaser-dx", "log-qso"] {
                assert!(validate(label, false, action).is_err());
            }
        }
        for action in [
            "station_action",
            "station_tune",
            "hamlib_connect",
            "provider",
            "station_configuration_save",
            "",
        ] {
            assert!(validate("station-control", false, action).is_err());
            assert!(validate("main", false, action).is_err());
        }
    }
    #[test]
    fn endpoints_reject_access_bearing_values_and_invalid_setup_never_dispatches() {
        for value in [
            "http://station.example",
            "https://user:secret@station.example",
            "https://station.example?token=secret",
            "https://station.example#secret",
        ] {
            assert!(endpoint(value).is_err());
        }
        let (_directory, session, mut params) = setup();
        params["base_url"] = json!("https://station.example?token=secret");
        assert!(session.apply(&params, passive).is_err());
        assert!(session.snapshot().unwrap()["last_receipt"].is_null());
    }
    #[test]
    fn failed_journal_write_cannot_dispatch_a_connection() {
        let (directory, session, params) = setup();
        session.apply(&params, passive).unwrap();
        let mut command = params;
        command["action"] = json!("disconnect");
        command["revision"] = json!(1);
        command["operation_id"] = json!(uuid::Uuid::new_v4().to_string());
        command["selection_generation"] = json!(3);
        command["selection_id"] = json!(uuid::Uuid::new_v4().to_string());
        std::fs::remove_file(directory.path().join("session.json")).unwrap();
        std::fs::create_dir(directory.path().join("session.json")).unwrap();
        assert!(session.apply(&command, passive).is_err());
        assert_eq!(session.snapshot().unwrap()["revision"], 1);
        assert!(session
            .receipt(command["operation_id"].as_str().unwrap())
            .unwrap()
            .is_null());
    }
    #[test]
    fn child_and_main_replay_one_admitted_operation_without_duplicate_dispatch() {
        let (directory, session, params) = setup();
        session.apply(&params, passive).unwrap();
        for action in ["connect", "disconnect", "forget"] {
            let state = session.snapshot().unwrap();
            let id = uuid::Uuid::new_v4().to_string();
            let selected_id = uuid::Uuid::new_v4().to_string();
            let command = json!({"action":action,"operation_id":id,"generation":state["generation"],"revision":state["revision"],
                "selection_generation":9,"selection_id":selected_id,"allow_transmit":false});
            validate("station-control", false, action).unwrap();
            let receipt = session
                .apply(&command, |request, generation, identity| {
                    assert_eq!(generation, 9);
                    assert_eq!(identity, selected_id);
                    assert_eq!(session.receipt(&id).unwrap()["status"], "pending");
                    assert_eq!(
                        request["method"],
                        match action {
                            "connect" => "station_connect",
                            "forget" => "station_forget",
                            _ => "station_disconnect",
                        }
                    );
                    Ok(json!({"id":id,"ok":true}))
                })
                .unwrap();
            validate("main", false, action).unwrap();
            assert_eq!(session.apply(&command, passive).unwrap(), receipt);
            let reopened = Session::new(directory.path().join("session.json")).unwrap();
            assert_eq!(reopened.apply(&command, passive).unwrap(), receipt);
            let mut stale = command;
            stale["operation_id"] = json!(uuid::Uuid::new_v4().to_string());
            assert!(session.apply(&stale, passive).is_err());
        }
    }
}
