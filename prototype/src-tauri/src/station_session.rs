//! Shared radio connection setup and durable command admission. No background I/O.
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
    #[serde(default)]
    hamlib: Option<Value>,
    #[serde(default)]
    flex: Option<Value>,
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
        "snapshot" | "receipt" | "save" | "connect" | "disconnect" | "forget" | "select"
            | "save_hamlib" | "connect_hamlib" | "reconnect_hamlib" | "disconnect_hamlib"
            | "save_flex" | "connect_flex" | "reconnect_flex" | "disconnect_flex"
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
fn is_save(action: &str) -> bool { matches!(action, "save" | "save_hamlib" | "save_flex") }
/// Match the existing direct FLEX private-IP contract without DNS or I/O.
fn flex_configuration(value: &Value) -> Result<Value, String> {
    let object = value.as_object().ok_or("Invalid FLEX configuration.")?;
    if object.len() != 3 || object.keys().any(|key| !["host", "port", "station_name"].contains(&key.as_str())) {
        return Err("Use only a FLEX private IP, port and station name.".into());
    }
    let host = value["host"].as_str().ok_or("Enter a private numeric FLEX IP address.")?;
    let private = match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => {
            let [a, b, _, _] = ip.octets();
            a == 10 || a == 127 || a == 172 && (16..=31).contains(&b)
                || a == 192 && b == 168 || a == 169 && b == 254 || a == 100 && (64..=127).contains(&b)
        }
        Ok(std::net::IpAddr::V6(ip)) => {
            let bytes = ip.octets();
            ip.is_loopback() || bytes[0] & 0xfe == 0xfc || bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80
        }
        Err(_) => false,
    };
    let name = value["station_name"].as_str().ok_or("Enter a FLEX station name.")?;
    if !private || value["port"].as_u64().is_none_or(|port| !(1..=65535).contains(&port))
        || name.trim().is_empty() || name.len() > 64 || !name.bytes().all(|byte| (32..=126).contains(&byte) && byte != b'|') {
        return Err("Use a private numeric FLEX IP, port 1..65535 and an ASCII station name up to 64 characters without |.".into());
    }
    Ok(value.clone())
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
                hamlib: None,
                flex: None,
                receipts: vec![],
            },
            Err(_) => return Err("Saved Station Control state could not be read.".into()),
        };
        if saved.version != 1
            || uuid::Uuid::parse_str(&saved.generation).is_err()
            || saved.revision > MAX_REVISION
            || saved.receipts.len() > MAX_RECEIPTS
            || endpoint(&saved.base_url)? != saved.base_url
            || saved.hamlib.as_ref().is_some_and(|value| crate::hamlib::saved_radio_configuration(value).is_err())
            || saved.flex.as_ref().is_some_and(|value| flex_configuration(value).is_err())
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
            } else if matches!(action, "save_hamlib" | "save_flex") {
                vec!["action", "generation", "revision", "configuration"]
            } else if action == "select" {
                vec![
                    "action",
                    "generation",
                    "revision",
                    "selection_generation",
                    "selection_id",
                    "provider",
                ]
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
                || !matches!(
                    action,
                    "save" | "connect" | "disconnect" | "forget" | "select"
                        | "save_hamlib" | "connect_hamlib" | "reconnect_hamlib" | "disconnect_hamlib"
                        | "save_flex" | "connect_flex" | "reconnect_flex" | "disconnect_flex"
                )
                || is_save(action) != (receipt.status == "saved")
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
            } else if action == "save_hamlib" {
                crate::hamlib::saved_radio_configuration(&receipt.request["configuration"])?;
            } else if action == "save_flex" {
                flex_configuration(&receipt.request["configuration"])?;
            } else if receipt.request["selection_generation"]
                .as_u64()
                .is_none_or(|revision| revision > MAX_REVISION)
                || receipt.request["selection_id"]
                    .as_str()
                    .is_none_or(|id| uuid::Uuid::parse_str(id).is_err())
                || if action == "select" {
                    receipt.request["provider"]
                        .as_str()
                        .is_none_or(|provider| !crate::station_telemetry::valid_provider(provider))
                } else {
                    !receipt.request["allow_transmit"].is_boolean()
                }
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
            json!({"generation":state.generation,"revision":state.revision,"base_url":state.base_url,"hamlib":state.hamlib,"flex":state.flex,
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
        if !matches!(
            action,
            "save" | "connect" | "disconnect" | "forget" | "select"
                | "save_hamlib" | "connect_hamlib" | "reconnect_hamlib" | "disconnect_hamlib"
                | "save_flex" | "connect_flex" | "reconnect_flex" | "disconnect_flex"
        ) {
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
        } else if action == "save_hamlib" {
            descriptor["configuration"] = crate::hamlib::saved_radio_configuration(&params["configuration"])?;
        } else if action == "save_flex" {
            descriptor["configuration"] = flex_configuration(&params["configuration"])?;
        } else {
            descriptor["selection_generation"] = params["selection_generation"].clone();
            descriptor["selection_id"] = params["selection_id"].clone();
            if action == "select" {
                let provider = params["provider"]
                    .as_str()
                    .filter(|provider| crate::station_telemetry::valid_provider(provider))
                    .ok_or("Unknown radio provider.")?;
                descriptor["provider"] = json!(provider);
            } else {
                descriptor["allow_transmit"] = json!(params["allow_transmit"] == true);
            }
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
        if action == "save_hamlib" {
            next.hamlib = Some(descriptor["configuration"].clone());
            if next.hamlib != state.hamlib {
                next.revision = next.revision.checked_add(1).filter(|value| *value <= MAX_REVISION)
                    .ok_or("Station Control revision exhausted.")?;
            }
        }
        if action == "save_flex" {
            next.flex = Some(descriptor["configuration"].clone());
            if next.flex != state.flex {
                next.revision = next.revision.checked_add(1).filter(|value| *value <= MAX_REVISION)
                    .ok_or("Station Control revision exhausted.")?;
            }
        }
        let request = if is_save(action) {
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
            let mut connection = json!({"provider":if action == "select" { descriptor["provider"].as_str().unwrap() } else { "direct_agent" }});
            if matches!(action, "connect_hamlib" | "reconnect_hamlib" | "disconnect_hamlib") {
                connection = if action == "disconnect_hamlib" { json!({}) } else {
                    state.hamlib.clone().ok_or("Save Hamlib configuration before connecting.")?
                };
                connection["device"] = json!("radio");
                connection["tx_enabled"] = json!(action != "disconnect_hamlib" && params["allow_transmit"] == true);
            }
            if matches!(action, "connect_flex" | "reconnect_flex" | "disconnect_flex") {
                connection = if action == "disconnect_flex" { json!({}) } else {
                    state.flex.clone().ok_or("Save FLEX configuration before connecting.")?
                };
                connection["provider"] = json!("direct_flex_lan");
                if action != "disconnect_flex" { connection["allow_transmit"] = json!(params["allow_transmit"] == true); }
            }
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
                // FLEX reconnect deliberately creates a new configured session:
                // never inherit the previous session's transmit permission.
                json!({"id":id,"method":match action { "connect" | "connect_flex" | "reconnect_flex" => "station_connect", "forget" => "station_forget", "select" => "station_selection_apply", "connect_hamlib" => "hamlib_connect", "reconnect_hamlib" => "hamlib_reconnect", "disconnect_hamlib" => "hamlib_disconnect", _ => "station_disconnect" },"params":connection}),
                selected_generation,
                selected_id.to_owned(),
            ))
        };
        next.receipts.push(Receipt {
            operation_id: id.into(),
            request: descriptor,
            status: if is_save(action) { "saved" } else { "pending" }.into(),
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
            "select",
            "save_hamlib", "connect_hamlib", "reconnect_hamlib", "disconnect_hamlib",
            "save_flex", "connect_flex", "reconnect_flex", "disconnect_flex",
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
    fn shared_hamlib_setup_is_passive_durable_and_lifecycle_uses_only_saved_configuration() {
        let (directory, session, mut save) = setup();
        save["action"] = json!("save_hamlib");
        save.as_object_mut().unwrap().remove("base_url");
        save["configuration"] = json!({"mode":"managed","model":1,"path":"","baud":9600,"serial":{"data_bits":8,"parity":"None"}});
        session.apply(&save, passive).unwrap();
        let restored = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(restored.snapshot().unwrap()["hamlib"], save["configuration"]);
        assert_eq!(restored.apply(&save, passive).unwrap()["status"], "saved");
        for (action, method) in [("connect_hamlib", "hamlib_connect"), ("reconnect_hamlib", "hamlib_reconnect"), ("disconnect_hamlib", "hamlib_disconnect")] {
            let state = restored.snapshot().unwrap();
            let selection_id = uuid::Uuid::new_v4().to_string();
            let command = json!({"action":action,"operation_id":uuid::Uuid::new_v4().to_string(),"generation":state["generation"],"revision":state["revision"],
                "selection_generation":13,"selection_id":selection_id,"allow_transmit":false,"configuration":{"model":999},"device":"rotor"});
            let receipt = restored.apply(&command, |request, generation, identity| {
                assert_eq!(generation, 13); assert_eq!(identity, selection_id);
                assert_eq!(request["method"], method); assert_eq!(request["params"]["device"], "radio");
                assert_eq!(request["params"]["tx_enabled"], false);
                if action != "disconnect_hamlib" { assert_eq!(request["params"]["model"], 1); }
                let persisted = Session::new(directory.path().join("session.json")).unwrap();
                assert_eq!(persisted.receipt(command["operation_id"].as_str().unwrap()).unwrap()["status"], "unknown");
                Ok(json!({"id":request["id"],"ok":true}))
            }).unwrap();
            assert_eq!(receipt["status"], "acknowledged");
            assert_eq!(restored.apply(&command, passive).unwrap(), receipt);
            let mut stale = command.clone(); stale["operation_id"] = json!(uuid::Uuid::new_v4().to_string());
            assert!(restored.apply(&stale, passive).is_err());
        }
        let disk = std::fs::read_to_string(directory.path().join("session.json")).unwrap();
        assert!(!disk.contains("tx_enabled")); assert!(!disk.contains("\"model\":999"));
    }
    #[test]
    fn hamlib_invalid_or_secret_setup_and_unknown_lifecycle_never_replay() {
        let (directory, session, mut save) = setup();
        save["action"] = json!("save_hamlib");
        for config in [json!({"mode":"external","host":"station.example","port":4532}),
            json!({"mode":"external","host":"127.0.0.1","port":0}),
            json!({"mode":"managed","model":1,"token":"secret"}),
            json!({"mode":"managed","model":1,"tx_enabled":true}),
            json!({"mode":"managed","model":1,"path":"tcp://user:secret@host"}),
            json!({"mode":"managed","model":1,"serial":{"unknown":"value"}})] {
            save["configuration"] = config;
            assert!(session.apply(&save, passive).is_err());
            assert!(session.snapshot().unwrap()["last_receipt"].is_null());
        }
        save["configuration"] = json!({"mode":"external","host":"127.0.0.1","port":4532});
        session.apply(&save, passive).unwrap();
        let command = json!({"action":"reconnect_hamlib","operation_id":uuid::Uuid::new_v4().to_string(),"generation":save["generation"],"revision":1,
            "selection_generation":5,"selection_id":uuid::Uuid::new_v4().to_string(),"allow_transmit":true});
        let receipt = session.apply(&command, |request, _, _| {
            assert_eq!(request["params"]["tx_enabled"], true);
            Err("sensitive transport error".into())
        }).unwrap();
        assert_eq!(receipt["status"], "unknown");
        let restored = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(restored.apply(&command, passive).unwrap(), receipt);
        assert!(restored.snapshot().unwrap()["hamlib"].get("tx_enabled").is_none());
        std::fs::remove_file(directory.path().join("session.json")).unwrap();
        std::fs::create_dir(directory.path().join("session.json")).unwrap();
        let mut blocked = command;
        blocked["operation_id"] = json!(uuid::Uuid::new_v4().to_string()); blocked["revision"] = json!(2);
        assert!(restored.apply(&blocked, passive).is_err());
        assert!(restored.receipt(blocked["operation_id"].as_str().unwrap()).unwrap().is_null());
    }
    #[test]
    fn shared_flex_setup_is_durable_and_lifecycle_uses_saved_setup_with_fresh_consent() {
        let (directory, session, mut save) = setup();
        save["action"] = json!("save_flex"); save.as_object_mut().unwrap().remove("base_url");
        save["configuration"] = json!({"host":"192.168.1.50","port":4992,"station_name":"xLog"});
        assert_eq!(session.apply(&save, passive).unwrap()["status"], "saved");
        let restored = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(restored.snapshot().unwrap()["flex"], save["configuration"]);
        assert_eq!(restored.apply(&save, passive).unwrap()["status"], "saved");
        for (action, permission) in [("connect_flex", true), ("reconnect_flex", false), ("disconnect_flex", false)] {
            let state = restored.snapshot().unwrap(); let selection_id = uuid::Uuid::new_v4().to_string();
            let command = json!({"action":action,"operation_id":uuid::Uuid::new_v4().to_string(),"generation":state["generation"],"revision":state["revision"],
                "selection_generation":17,"selection_id":selection_id,"allow_transmit":permission,"configuration":{"host":"10.9.9.9"},"token":"never-saved"});
            let receipt = restored.apply(&command, |request, generation, identity| {
                assert_eq!(generation, 17); assert_eq!(identity, selection_id);
                let expected = if action == "disconnect_flex" { json!({"provider":"direct_flex_lan"}) }
                    else { json!({"provider":"direct_flex_lan","host":"192.168.1.50","port":4992,"station_name":"xLog","allow_transmit":permission}) };
                assert_eq!(request["params"], expected);
                assert_eq!(request["method"], if action == "disconnect_flex" { "station_disconnect" } else { "station_connect" });
                let persisted = Session::new(directory.path().join("session.json")).unwrap();
                assert_eq!(persisted.receipt(command["operation_id"].as_str().unwrap()).unwrap()["status"], "unknown");
                Ok(json!({"id":request["id"],"ok":true}))
            }).unwrap();
            assert_eq!(receipt["status"], "acknowledged"); assert_eq!(restored.apply(&command, passive).unwrap(), receipt);
            let mut stale = command; stale["operation_id"] = json!(uuid::Uuid::new_v4().to_string());
            assert!(restored.apply(&stale, passive).is_err());
        }
        let disk = std::fs::read_to_string(directory.path().join("session.json")).unwrap();
        assert!(!disk.contains("never-saved")); assert!(!disk.contains("10.9.9.9"));
        assert!(restored.snapshot().unwrap()["flex"].get("allow_transmit").is_none());
    }
    #[test]
    fn flex_setup_rejects_secrets_public_addresses_and_malformed_numeric_hosts_without_dispatch() {
        for host in ["10.0.0.1", "127.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "::1", "fc00::1", "fd00::1", "fe80::1"] {
            assert!(flex_configuration(&json!({"host":host,"port":4992,"station_name":"xLog"})).is_ok());
        }
        let (_directory, session, mut save) = setup(); save["action"] = json!("save_flex");
        for host in ["radio.example", "8.8.8.8", "172.32.0.1", "100.128.0.1", "192.168.001.1", "fd:::1", "fe80::1%en0", "::ffff:192.168.1.1", "user:secret@10.0.0.1"] {
            save["configuration"] = json!({"host":host,"port":4992,"station_name":"xLog"});
            assert!(session.apply(&save, passive).is_err(), "{host}");
        }
        for config in [json!({"host":"10.0.0.1","port":0,"station_name":"xLog"}),
            json!({"host":"10.0.0.1","port":4992,"station_name":"bad|command"}),
            json!({"host":"10.0.0.1","port":4992,"station_name":"xLog","allow_transmit":true}),
            json!({"host":"10.0.0.1","port":4992,"station_name":"xLog","token":"secret"})] {
            save["configuration"] = config; assert!(session.apply(&save, passive).is_err());
        }
        assert!(session.snapshot().unwrap()["last_receipt"].is_null());
    }
    #[test]
    fn flex_unknown_outcome_and_failed_storage_never_replay_or_dispatch() {
        let (directory, session, mut save) = setup(); save["action"] = json!("save_flex");
        save["configuration"] = json!({"host":"100.64.0.1","port":4992,"station_name":"xLog"}); session.apply(&save, passive).unwrap();
        let command = json!({"action":"reconnect_flex","operation_id":uuid::Uuid::new_v4().to_string(),"generation":save["generation"],"revision":1,
            "selection_generation":9,"selection_id":uuid::Uuid::new_v4().to_string()});
        let receipt = session.apply(&command, |request, _, _| { assert_eq!(request["params"]["allow_transmit"], false); Err("unknown".into()) }).unwrap();
        assert_eq!(receipt["status"], "unknown");
        let restored = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(restored.apply(&command, passive).unwrap(), receipt);
        std::fs::remove_file(directory.path().join("session.json")).unwrap(); std::fs::create_dir(directory.path().join("session.json")).unwrap();
        let mut blocked = command; blocked["operation_id"] = json!(uuid::Uuid::new_v4().to_string()); blocked["revision"] = json!(2);
        assert!(restored.apply(&blocked, passive).is_err());
        assert!(restored.receipt(blocked["operation_id"].as_str().unwrap()).unwrap().is_null());
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
    #[test]
    fn provider_selection_journals_before_dispatch_and_recovers_without_repeating_retirement() {
        let (directory, session, params) = setup();
        let id = uuid::Uuid::new_v4().to_string();
        let identity = uuid::Uuid::new_v4().to_string();
        let request = json!({"action":"select","operation_id":id,"generation":params["generation"],"revision":0,
            "selection_generation":6,"selection_id":identity,"provider":"hamlib"});
        let receipt = session
            .apply(&request, |command, generation, selection_id| {
                assert_eq!(command["method"], "station_selection_apply");
                assert_eq!(command["params"], json!({"provider":"hamlib"}));
                assert_eq!(generation, 6);
                assert_eq!(selection_id, identity);
                assert_eq!(session.receipt(&id).unwrap()["status"], "pending");
                let persisted = Session::new(directory.path().join("session.json")).unwrap();
                assert_eq!(persisted.receipt(&id).unwrap()["status"], "unknown");
                Ok(json!({"id":id,"ok":true}))
            })
            .unwrap();
        assert_eq!(receipt["status"], "acknowledged");
        assert_eq!(session.apply(&request, passive).unwrap(), receipt);
        let reopened = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(reopened.apply(&request, passive).unwrap(), receipt);
        let mut reused = request.clone();
        reused["provider"] = json!("direct_flex_lan");
        assert!(reopened.apply(&reused, passive).is_err());
        let mut unknown = request;
        unknown["operation_id"] = json!(uuid::Uuid::new_v4().to_string());
        unknown["revision"] = json!(1);
        let receipt = session
            .apply(&unknown, |_, _, _| {
                Err("retirement acknowledgement lost".into())
            })
            .unwrap();
        assert_eq!(receipt["status"], "unknown");
        let reopened = Session::new(directory.path().join("session.json")).unwrap();
        assert_eq!(reopened.apply(&unknown, passive).unwrap(), receipt);
    }
}
