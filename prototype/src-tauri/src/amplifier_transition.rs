//! Agent amplifier transactions: durable identity, never replayed. Standby does
//! not share the acquisition lane; the journal lock is never held over transport.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    cell::Cell,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
const MAX: u64 = 9_007_199_254_740_991;
const NOT_SENT: &str = "[amplifier-not-sent] ";
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    provider: String,
    selection_generation: u64,
    selection_id: String,
    worker_generation: u64,
    connection_generation: u64,
    control_revision: u64,
    observation_revision: u64,
    received_at_ms: u64,
}
impl Target {
    fn validate(&self) -> Result<(), String> {
        if self.provider != "direct_agent"
            || uuid::Uuid::parse_str(&self.selection_id).map_or(true, |id| id.is_nil())
            || self.worker_generation == 0
            || [
                self.selection_generation,
                self.worker_generation,
                self.connection_generation,
                self.control_revision,
                self.observation_revision,
                self.received_at_ms,
            ]
            .iter()
            .any(|v| *v > MAX)
        {
            return Err("Invalid Agent amplifier target.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    operation_id: String,
    action: String,
    target: Target,
    status: String,
    detail: Option<Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    version: u8,
    receipts: Vec<Receipt>,
    // Process-local preparation authority is deliberately not restored. A
    // restarted app may inspect receipts, never resume an old preparation.
    #[serde(skip)]
    standby_epoch: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preparation {
    session: String,
    epoch: String,
    action: String,
}
pub struct Session {
    path: PathBuf,
    process_epoch: String,
    state: Mutex<Saved>,
    operate: Mutex<()>,
    standby: Mutex<()>,
}
fn unresolved(r: &Receipt) -> bool {
    matches!(r.status.as_str(), "pending" | "unknown")
}
pub fn validate(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if isolated
        || exiting
        || !matches!(label, "main" | "monitor" | "station-control")
        || !matches!(
            action,
            "snapshot" | "prepare" | "operate" | "standby" | "receipt" | "review"
        )
    {
        return Err("Agent amplifier controls are unavailable in this window.".into());
    }
    Ok(())
}
impl Session {
    fn new(path: PathBuf) -> Result<Self, String> {
        let mut saved = match std::fs::read(&path) {
            Ok(b) => serde_json::from_slice::<Saved>(&b)
                .map_err(|_| "Invalid amplifier journal; it was not overwritten.")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Saved {
                version: 1,
                receipts: vec![],
                standby_epoch: String::new(),
            },
            Err(_) => return Err("Amplifier journal unavailable.".into()),
        };
        if saved.version != 1 {
            return Err("Unsupported amplifier journal.".into());
        }
        saved.standby_epoch = uuid::Uuid::new_v4().to_string();
        let mut ids = std::collections::HashSet::new();
        for r in &mut saved.receipts {
            r.target.validate()?;
            if uuid::Uuid::parse_str(&r.operation_id).map_or(true, |id| id.is_nil())
                || !ids.insert(r.operation_id.clone())
                || !matches!(r.action.as_str(), "operate" | "standby")
                || !matches!(
                    r.status.as_str(),
                    "pending" | "unknown" | "acknowledged" | "rejected" | "reviewed"
                )
            {
                return Err("Invalid amplifier receipt.".into());
            }
            if r.status == "pending" {
                r.status = "unknown".into();
            }
        }
        Ok(Self {
            path,
            process_epoch: saved.standby_epoch.clone(),
            state: Mutex::new(saved),
            operate: Mutex::new(()),
            standby: Mutex::new(()),
        })
    }
    fn persist(&self, saved: &Saved) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Amplifier storage unavailable")?;
        std::fs::create_dir_all(parent).map_err(|_| "Amplifier storage unavailable")?;
        let mut file = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Amplifier receipt could not be saved")?;
        file.write_all(&serde_json::to_vec(saved).map_err(|_| "Amplifier serialization failed")?)
            .map_err(|_| "Amplifier receipt could not be saved")?;
        file.as_file()
            .sync_all()
            .map_err(|_| "Amplifier receipt could not be saved")?;
        file.persist(&self.path)
            .map_err(|_| "Amplifier receipt could not be saved")?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Amplifier journal unavailable")?;
        // Terminal identities are permanent no-replay tombstones, not refresh payload.
        Ok(json!({"receipts":state.receipts.iter().filter(|r|unresolved(r)).collect::<Vec<_>>()}))
    }
    pub fn receipt(&self, id: &str) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Amplifier journal unavailable")?;
        Ok(state
            .receipts
            .iter()
            .find(|r| r.operation_id == id)
            .map_or(Value::Null, |r| json!(r)))
    }
    pub fn review(&self, id: &str) -> Result<Value, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Amplifier journal unavailable")?;
        let i = state
            .receipts
            .iter()
            .position(|r| r.operation_id == id)
            .ok_or("Amplifier receipt not found")?;
        if state.receipts[i].status == "reviewed" {
            return Ok(json!(state.receipts[i]));
        }
        if state.receipts[i].status != "unknown" {
            return Err("Only an unknown amplifier transition may be reviewed".into());
        }
        let mut next = state.clone();
        next.receipts[i].status = "reviewed".into();
        self.persist(&next)?;
        *state = next;
        Ok(json!(state.receipts[i]))
    }
    /// Registered before the caller's target/snapshot preparation, across every
    /// WebView. Standby retires older Operate preparations without transport.
    pub fn prepare(&self, action: &str) -> Result<Preparation, String> {
        if !matches!(action, "operate" | "standby") {
            return Err("Invalid amplifier preparation".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Amplifier journal unavailable")?;
        if action == "standby" {
            state.standby_epoch = uuid::Uuid::new_v4().to_string();
        }
        Ok(Preparation {
            session: self.process_epoch.clone(),
            epoch: state.standby_epoch.clone(),
            action: action.into(),
        })
    }
    pub fn require_preparation(
        &self,
        preparation: &Preparation,
        action: &str,
    ) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Amplifier journal unavailable")?;
        self.check_preparation(&state, preparation, action)
    }
    fn check_preparation(
        &self,
        state: &Saved,
        preparation: &Preparation,
        action: &str,
    ) -> Result<(), String> {
        if preparation.session != self.process_epoch
            || preparation.action != action
            || uuid::Uuid::parse_str(&preparation.epoch).is_err()
            || action == "operate" && preparation.epoch != state.standby_epoch
        {
            return Err("Amplifier preparation was superseded by Standby or app restart; no older Operate may be admitted".into());
        }
        Ok(())
    }
    #[cfg(test)]
    fn transition(
        &self,
        id: &str,
        action: &str,
        target: Target,
        dispatch: impl FnOnce(Value, &Target) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let preparation = self.prepare(action)?;
        self.transition_prepared(id, action, target, &preparation, dispatch)
    }
    pub fn transition_prepared(
        &self,
        id: &str,
        action: &str,
        target: Target,
        preparation: &Preparation,
        dispatch: impl FnOnce(Value, &Target) -> Result<Value, String>,
    ) -> Result<Value, String> {
        target.validate()?;
        if !matches!(action, "operate" | "standby")
            || uuid::Uuid::parse_str(id).map_or(true, |id| id.is_nil())
        {
            return Err("Invalid amplifier transition identity".into());
        }
        let duplicate = |state: &Saved| -> Result<Option<Value>, String> {
            if let Some(old) = state.receipts.iter().find(|r| r.operation_id == id) {
                if old.target != target || old.action != action {
                    return Err("Amplifier identity collision".into());
                }
                return Ok(Some(json!(old)));
            }
            Ok(None)
        };
        {
            let state = self
                .state
                .lock()
                .map_err(|_| "Amplifier journal unavailable")?;
            if let Some(r) = duplicate(&state)? {
                return Ok(r);
            }
            self.check_preparation(&state, preparation, action)?;
        }
        let lane = if action == "operate" {
            &self.operate
        } else {
            &self.standby
        };
        let _lane=lane.try_lock().map_err(|_|"That amplifier lane is busy; inspect its receipt. Standby remains independent of Operate.")?;
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Amplifier journal unavailable")?;
            if let Some(r) = duplicate(&state)? {
                return Ok(r);
            }
            self.check_preparation(&state, preparation, action)?;
            let mut next = state.clone();
            next.receipts.push(Receipt {
                operation_id: id.into(),
                action: action.into(),
                target: target.clone(),
                status: "pending".into(),
                detail: None,
            });
            self.persist(&next)?;
            *state = next;
        }
        let result = dispatch(
            json!({"id":id,"method":"station_action","params":{"provider":"direct_agent","action":action,"expected_generation":target.connection_generation}}),
            &target,
        );
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Amplifier outcome unknown; inspect its receipt")?;
        let mut next = state.clone();
        let r = next
            .receipts
            .iter_mut()
            .find(|r| r.operation_id == id)
            .ok_or("Amplifier receipt missing")?;
        r.status = outcome(id, action, &target, &result).into();
        r.detail = match &result {
            Ok(v) if v["ok"] == false => Some(v["error"].clone()),
            Err(e) => Some(json!({"message":e.strip_prefix(NOT_SENT).unwrap_or(e)})),
            _ => None,
        };
        let value = json!(r);
        if self.persist(&next).is_err() {
            next.receipts
                .iter_mut()
                .find(|r| r.operation_id == id)
                .unwrap()
                .status = "unknown".into();
            *state = next;
            return Err("Amplifier outcome could not be saved; inspect its receipt. No transition will be replayed.".into());
        }
        *state = next;
        Ok(value)
    }
}
fn outcome(
    id: &str,
    action: &str,
    target: &Target,
    result: &Result<Value, String>,
) -> &'static str {
    let Ok(reply) = result else {
        return if result
            .as_ref()
            .err()
            .is_some_and(|error| error.starts_with(NOT_SENT))
        {
            "rejected"
        } else {
            "unknown"
        };
    };
    let result = &reply["result"];
    let state = &result["state"];
    if reply["id"] == id
        && reply["ok"] == true
        && result["accepted"] == true
        && result["confirmed"] == false
        && result["action"] == action
        && state["source"] == "direct_agent"
        && state["generation"] == target.connection_generation
    {
        "acknowledged"
    } else {
        "unknown"
    }
}
fn admission(
    selection: &Value,
    radio: &Value,
    target: &Target,
    action: &str,
    now: u64,
) -> Result<(), String> {
    target.validate()?;
    let snapshot = &radio["snapshot"];
    let station = &snapshot["station"];
    let exact = selection["provider"] == "direct_agent"
        && selection["generation"] == target.selection_generation
        && selection["selection_id"] == target.selection_id
        && selection["control_revision"] == target.control_revision
        && radio["provider"] == "direct_agent"
        && radio["selection_generation"] == target.selection_generation
        && radio["selection_id"] == target.selection_id
        && radio["worker_generation"] == target.worker_generation
        && snapshot["generation"] == target.connection_generation
        && snapshot["source"] == "direct_agent";
    let recent = |v: &Value, scale: f64| {
        v.as_f64().is_some_and(|v| {
            v.is_finite() && (-1000.0..=3000.0).contains(&(now as f64 - v * scale))
        })
    };
    let capability = station["supported_commands"]
        .as_array()
        .is_some_and(|v| v.iter().any(|v| v == &format!("station_{action}")));
    let observation_is_current = radio["revision"]
        .as_u64()
        .is_some_and(|revision| revision >= target.observation_revision)
        && radio["received_at_ms"]
            .as_u64()
            .is_some_and(|received| received >= target.received_at_ms);
    let ready = action == "standby"
        || observation_is_current
            && radio["available"] == true
            && recent(&radio["received_at_ms"], 1.0)
            && recent(&snapshot["generated_at"], 1000.0)
            && recent(&snapshot["radio"]["observed_at"], 1000.0)
            && snapshot["radio"]["connected"] == true
            && snapshot["radio"]["observed"] == true
            && snapshot["radio"]["transmitting"] == false
            && station["radio_known"] == true
            && station["radio_stale"] == false
            && station["inhibitors"]
                .as_array()
                .is_some_and(|v| v.is_empty())
            && station["allowed_actions"]
                .as_array()
                .is_some_and(|v| v.iter().any(|v| v == "operate"));
    if !exact || !capability || !ready {
        return Err(
            "Amplifier status changed before the command; nothing was sent. Try again.".into(),
        );
    }
    Ok(())
}
pub fn context(app: &tauri::AppHandle) -> Result<Value, String> {
    let selection = crate::station_selection::owner(app)?.snapshot()?;
    let radio = crate::station_telemetry::owner(app)?.snapshot()?;
    let target=serde_json::from_value::<Target>(json!({"provider":selection["provider"],"selection_generation":selection["generation"],"selection_id":selection["selection_id"],"control_revision":selection["control_revision"],"worker_generation":radio["worker_generation"],"connection_generation":radio["snapshot"]["generation"],"observation_revision":radio["revision"],"received_at_ms":radio["received_at_ms"]})).ok().filter(|t|t.validate().is_ok() && radio["provider"]==t.provider && radio["selection_id"]==t.selection_id && radio["selection_generation"]==t.selection_generation);
    Ok(json!({"target":target}))
}
pub fn execute(
    app: &tauri::AppHandle,
    request: Value,
    target: &Target,
    preparation: &Preparation,
) -> Result<Value, String> {
    let authority = owner(app)?;
    let action = request["params"]["action"]
        .as_str()
        .ok_or("Missing amplifier action")?;
    authority.require_preparation(preparation, action)?;
    crate::worker::require_existing_generation(target.worker_generation)?;
    let selection = crate::station_selection::owner(app)?;
    let telemetry = crate::station_telemetry::owner(app)?;
    let expected = json!({"provider":target.provider,"generation":target.selection_generation,"selection_id":target.selection_id,"control_revision":target.control_revision});
    let action = request["params"]["action"]
        .as_str()
        .ok_or("Missing amplifier action")?
        .to_owned();
    let sent = Cell::new(false);
    let result = selection.amplifier_transition(
        request,
        &expected,
        || {
            crate::worker::require_existing_generation(target.worker_generation)?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "Radio clock unavailable")?
                .as_millis() as u64;
            admission(&expected, &telemetry.snapshot()?, target, &action, now)?;
            authority.require_preparation(preparation, &action)?;
            telemetry.control()
        },
        |request| {
            authority.require_preparation(preparation, &action)?;
            sent.set(true);
            let reply =
                crate::worker::request_existing_generation(request, target.worker_generation)?;
            crate::worker::require_existing_generation(target.worker_generation)?;
            let actual = selection.snapshot()?;
            if actual["provider"] != target.provider
                || actual["generation"] != target.selection_generation
                || actual["selection_id"] != target.selection_id
                || actual["control_revision"].as_u64() != target.control_revision.checked_add(1)
            {
                return Err("Amplifier transition superseded; inspect its unknown receipt".into());
            }
            Ok(reply)
        },
    );
    match result {
        Err(error) if !sent.get() => Err(format!("{NOT_SENT}{error}")),
        result => result,
    }
}
static OWNER: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<Session>, String> {
    let mut slot = OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Amplifier owner unavailable")?;
    if let Some(owner) = slot.as_ref() {
        return Ok(owner.clone());
    }
    let owner = Arc::new(Session::new(
        app.path()
            .app_config_dir()
            .map_err(|_| "Amplifier storage unavailable")?
            .join("amplifier-transitions.json"),
    )?);
    *slot = Some(owner.clone());
    Ok(owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn amplifier_native_preparation_is_shared_across_renderers_and_never_relabels_old_intent() {
        let (_dir, session) = fixture();
        // Desk registers before beginning its asynchronous target preparation.
        let desk = session.prepare("operate").unwrap();
        // Detached Monitor registers a newer intent and receives its ACK first.
        let monitor = session.prepare("standby").unwrap();
        // Redundant urgent preparation cannot retire an earlier Standby lane.
        session.prepare("standby").unwrap();
        assert!(session.require_preparation(&monitor, "standby").is_ok());
        let standby_id = uuid::Uuid::new_v4().to_string();
        session
            .transition_prepared(&standby_id, "standby", target(), &monitor, |q, t| {
                Ok(reply(&q, t))
            })
            .unwrap();
        let mut current_target = target();
        current_target.control_revision += 2;
        current_target.observation_revision += 2;
        let old_id = uuid::Uuid::new_v4().to_string();
        assert!(session
            .transition_prepared(&old_id, "operate", current_target, &desk, |_, _| panic!(
                "old Desk preparation sent a command"
            ))
            .is_err());
        assert!(
            session.receipt(&old_id).unwrap().is_null(),
            "A retired preparation must not enter the native durable journal"
        );
        let saved: Saved = serde_json::from_slice(&std::fs::read(&session.path).unwrap()).unwrap();
        assert_eq!(saved.receipts.len(), 1);
        assert_eq!(saved.receipts[0].action, "standby");
        let newer = session.prepare("operate").unwrap();
        session
            .transition_prepared(
                &uuid::Uuid::new_v4().to_string(),
                "operate",
                target(),
                &newer,
                |q, t| Ok(reply(&q, t)),
            )
            .unwrap();
        let cold = Session::new(session.path.clone()).unwrap();
        assert!(
            cold.require_preparation(&newer, "operate").is_err(),
            "Restart cannot resume preparations"
        );
        assert!(cold.require_preparation(&monitor, "standby").is_err());
    }
    #[test]
    fn amplifier_invalid_journal_target_and_failed_review_are_fail_closed() {
        let (dir, session) = fixture();
        for value in [
            json!({"version":2,"receipts":[]}),
            json!({"version":1,"receipts":[{}]}),
        ] {
            let bytes = serde_json::to_vec(&value).unwrap();
            std::fs::write(&session.path, &bytes).unwrap();
            assert!(Session::new(session.path.clone()).is_err());
            assert_eq!(std::fs::read(&session.path).unwrap(), bytes);
        }
        std::fs::remove_file(&session.path).unwrap();
        for field in [
            "provider",
            "selection_id",
            "worker_generation",
            "connection_generation",
        ] {
            let mut value = json!(target());
            value[field] = match field {
                "provider" => json!("direct_flex_lan"),
                "selection_id" => json!(uuid::Uuid::nil().to_string()),
                "worker_generation" => json!(0),
                _ => json!(MAX + 1),
            };
            assert!(serde_json::from_value::<Target>(value)
                .unwrap()
                .validate()
                .is_err());
        }
        let id = uuid::Uuid::new_v4().to_string();
        session
            .transition(&id, "operate", target(), |_, _| Err("lost".into()))
            .unwrap();
        std::fs::remove_file(&session.path).unwrap();
        std::fs::create_dir(&session.path).unwrap();
        assert!(session.review(&id).is_err());
        assert_eq!(session.receipt(&id).unwrap()["status"], "unknown");
        drop(dir);
    }
    fn target() -> Target {
        Target {
            provider: "direct_agent".into(),
            selection_generation: 2,
            selection_id: uuid::Uuid::new_v4().to_string(),
            worker_generation: 4,
            connection_generation: 7,
            control_revision: 3,
            observation_revision: 8,
            received_at_ms: 10000,
        }
    }
    fn reply(q: &Value, t: &Target) -> Value {
        json!({"id":q["id"],"ok":true,"result":{"accepted":true,"confirmed":false,"action":q["params"]["action"],"state":{"source":"direct_agent","generation":t.connection_generation}}})
    }
    fn fixture() -> (tempfile::TempDir, Session) {
        let d = tempfile::tempdir().unwrap();
        let s = Session::new(d.path().join("amp.json")).unwrap();
        (d, s)
    }
    fn observations(t: &Target) -> (Value, Value) {
        (
            json!({"provider":t.provider,"generation":t.selection_generation,"selection_id":t.selection_id,"control_revision":t.control_revision}),
            json!({"provider":t.provider,"selection_generation":t.selection_generation,"selection_id":t.selection_id,"worker_generation":t.worker_generation,"revision":t.observation_revision,"received_at_ms":t.received_at_ms,"available":true,"snapshot":{"source":"direct_agent","generation":t.connection_generation,"generated_at":10.0,"radio":{"connected":true,"observed":true,"transmitting":false,"observed_at":10.0},"station":{"radio_known":true,"radio_stale":false,"inhibitors":[],"allowed_actions":["operate"],"supported_commands":["station_operate","station_standby"]}}}),
        )
    }
    #[test]
    fn amplifier_durable_identity_restart_collision_and_terminal_compaction_do_not_replay() {
        let (_d, s) = fixture();
        let t = target();
        let id = uuid::Uuid::new_v4().to_string();
        let r = s
            .transition(&id, "operate", t.clone(), |q, t| {
                let stored: Saved =
                    serde_json::from_slice(&std::fs::read(&s.path).unwrap()).unwrap();
                assert_eq!(stored.receipts[0].status, "pending");
                Ok(reply(&q, t))
            })
            .unwrap();
        assert_eq!(r["status"], "acknowledged");
        assert_eq!(
            s.transition(&id, "operate", t.clone(), |_, _| panic!("replayed"))
                .unwrap(),
            r
        );
        assert!(s
            .transition(&id, "standby", t.clone(), |_, _| panic!())
            .is_err());
        for field in [
            "selection_generation",
            "selection_id",
            "worker_generation",
            "connection_generation",
            "control_revision",
            "observation_revision",
            "received_at_ms",
        ] {
            let mut v = json!(t);
            if field == "selection_id" {
                v[field] = json!(uuid::Uuid::new_v4().to_string());
            } else {
                v[field] = json!(v[field].as_u64().unwrap() + 1);
            }
            let changed = serde_json::from_value(v).unwrap();
            assert!(
                s.transition(&id, "operate", changed, |_, _| panic!())
                    .is_err(),
                "{field}"
            );
        }
        // Terminal payload is compact on every refresh, while tombstones retain
        // full collision authority through restart (including same-provider A-B-A).
        for _ in 0..100 {
            let id = uuid::Uuid::new_v4().to_string();
            s.transition(&id, "standby", t.clone(), |q, t| Ok(reply(&q, t)))
                .unwrap();
        }
        assert_eq!(s.snapshot().unwrap()["receipts"], json!([]));
        let cold = Session::new(s.path.clone()).unwrap();
        assert_eq!(cold.receipt(&id).unwrap(), r);
    }
    #[test]
    fn amplifier_crash_unknown_review_and_malformed_reply_binding() {
        let (_d, s) = fixture();
        let t = target();
        let id = uuid::Uuid::new_v4().to_string();
        s.transition(&id, "operate", t.clone(), |_, _| Err("lost".into()))
            .unwrap();
        assert_eq!(s.receipt(&id).unwrap()["status"], "unknown");
        assert_eq!(
            s.transition(
                &uuid::Uuid::new_v4().to_string(),
                "operate",
                t.clone(),
                |q, t| Ok(reply(&q, t))
            )
            .unwrap()["status"],
            "acknowledged"
        );
        s.review(&id).unwrap();
        for change in [
            "id",
            "ok",
            "accepted",
            "confirmed",
            "action",
            "source",
            "generation",
        ] {
            let n = uuid::Uuid::new_v4().to_string();
            let r = s
                .transition(&n, "standby", t.clone(), |q, t| {
                    let mut r = reply(&q, t);
                    match change {
                        "id" => r["id"] = json!("other"),
                        "ok" => r["ok"] = json!(false),
                        "source" | "generation" => r["result"]["state"][change] = Value::Null,
                        _ => r["result"][change] = Value::Null,
                    };
                    Ok(r)
                })
                .unwrap();
            assert_eq!(r["status"], "unknown", "{change}");
        }
        let mut saved = s.state.lock().unwrap().clone();
        saved.receipts[0].status = "pending".into();
        s.persist(&saved).unwrap();
        let cold = Session::new(s.path.clone()).unwrap();
        assert_eq!(cold.receipt(&id).unwrap()["status"], "unknown");
        assert_eq!(
            cold.transition(&uuid::Uuid::new_v4().to_string(), "operate", t, |q, t| Ok(
                reply(&q, t)
            ))
            .unwrap()["status"],
            "acknowledged"
        );
    }
    #[test]
    fn amplifier_known_not_sent_failure_is_terminal_and_retryable() {
        let (_d, s) = fixture();
        let t = target();
        let rejected = s
            .transition(
                &uuid::Uuid::new_v4().to_string(),
                "operate",
                t.clone(),
                |_, _| Err(format!("{NOT_SENT}radio changed before dispatch")),
            )
            .unwrap();
        assert_eq!(rejected["status"], "rejected");
        assert_eq!(
            rejected["detail"]["message"],
            "radio changed before dispatch"
        );
        assert_eq!(s.snapshot().unwrap()["receipts"], json!([]));
        let retry = s
            .transition(&uuid::Uuid::new_v4().to_string(), "operate", t, |q, t| {
                Ok(reply(&q, t))
            })
            .unwrap();
        assert_eq!(retry["status"], "acknowledged");
    }
    #[test]
    fn amplifier_urgent_stale_standby_requires_exact_authority_not_readiness() {
        let t = target();
        let (selection, mut radio) = observations(&t);
        assert!(admission(&selection, &radio, &t, "operate", 10000).is_ok());
        radio["available"] = json!(false);
        radio["snapshot"]["radio"]["connected"] = json!(false);
        radio["snapshot"]["radio"]["transmitting"] = json!(true);
        radio["snapshot"]["station"]["inhibitors"] = json!(["alarm"]);
        radio["snapshot"]["station"]["allowed_actions"] = json!([]);
        assert!(admission(&selection, &radio, &t, "operate", 999999).is_err());
        assert!(admission(&selection, &radio, &t, "standby", 999999).is_ok());
        for field in [
            "provider",
            "selection_generation",
            "selection_id",
            "worker_generation",
        ] {
            let mut r = radio.clone();
            r[field] = Value::Null;
            assert!(
                admission(&selection, &r, &t, "standby", 10000).is_err(),
                "{field}"
            );
        }
        for field in ["provider", "generation", "selection_id", "control_revision"] {
            let mut s = selection.clone();
            s[field] = Value::Null;
            assert!(
                admission(&s, &radio, &t, "standby", 10000).is_err(),
                "{field}"
            );
        }
        radio["snapshot"]["generation"] = json!(8);
        assert!(admission(&selection, &radio, &t, "standby", 10000).is_err());
    }
    #[test]
    fn amplifier_operate_requires_each_fresh_observation_and_policy_field() {
        let t = target();
        let (s, r) = observations(&t);
        let mut newer = r.clone();
        newer["revision"] = json!(t.observation_revision + 1);
        newer["received_at_ms"] = json!(t.received_at_ms + 1);
        assert!(admission(&s, &newer, &t, "operate", 10001).is_ok());
        let mut older = r.clone();
        older["revision"] = json!(t.observation_revision - 1);
        assert!(admission(&s, &older, &t, "operate", 10000).is_err());
        for field in ["revision", "received_at_ms", "available"] {
            let mut r = r.clone();
            r[field] = Value::Null;
            assert!(admission(&s, &r, &t, "operate", 10000).is_err(), "{field}");
        }
        for field in ["connected", "observed", "transmitting", "observed_at"] {
            let mut r = r.clone();
            r["snapshot"]["radio"][field] = Value::Null;
            assert!(admission(&s, &r, &t, "operate", 10000).is_err(), "{field}");
        }
        for field in [
            "radio_known",
            "radio_stale",
            "inhibitors",
            "allowed_actions",
            "supported_commands",
        ] {
            let mut r = r.clone();
            r["snapshot"]["station"][field] = Value::Null;
            assert!(admission(&s, &r, &t, "operate", 10000).is_err(), "{field}");
        }
        assert!(admission(&s, &r, &t, "operate", 14000).is_err());
    }
    #[test]
    fn amplifier_concurrent_operate_and_standby_finalize_exact_ids_in_reverse_order() {
        let (_d, s) = fixture();
        let t = target();
        let old = uuid::Uuid::new_v4().to_string();
        let new = uuid::Uuid::new_v4().to_string();
        std::thread::scope(|scope| {
            let (entered, wait) = std::sync::mpsc::channel();
            let (release, held) = std::sync::mpsc::channel();
            let session = &s;
            let held_id = old.clone();
            let held_target = t.clone();
            let task = scope.spawn(move || {
                session.transition(&held_id, "operate", held_target, |q, t| {
                    entered.send(()).unwrap();
                    held.recv().unwrap();
                    Ok(reply(&q, t))
                })
            });
            wait.recv().unwrap();
            assert_eq!(
                s.transition(&old, "operate", t.clone(), |_, _| panic!(
                    "duplicate dispatch"
                ))
                .unwrap()["status"],
                "pending"
            );
            assert!(s
                .transition(
                    &uuid::Uuid::new_v4().to_string(),
                    "operate",
                    t.clone(),
                    |_, _| panic!()
                )
                .is_err());
            assert_eq!(
                s.transition(&new, "standby", t.clone(), |q, t| Ok(reply(&q, t)))
                    .unwrap()["status"],
                "acknowledged"
            );
            assert_eq!(s.receipt(&old).unwrap()["status"], "pending");
            release.send(()).unwrap();
            task.join().unwrap().unwrap();
        });
        assert_eq!(s.receipt(&old).unwrap()["action"], "operate");
        assert_eq!(s.receipt(&new).unwrap()["action"], "standby");
    }
    #[test]
    fn amplifier_storage_failures_never_dispatch_or_publish_false_terminal() {
        let (d, s) = fixture();
        std::fs::create_dir(&s.path).unwrap();
        assert!(s
            .transition(
                &uuid::Uuid::new_v4().to_string(),
                "standby",
                target(),
                |_, _| panic!("unsaved dispatch")
            )
            .is_err());
        std::fs::remove_dir(&s.path).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(s
            .transition(&id, "standby", target(), |q, t| {
                std::fs::remove_file(&s.path).unwrap();
                std::fs::create_dir(&s.path).unwrap();
                Ok(reply(&q, t))
            })
            .is_err());
        assert_eq!(s.receipt(&id).unwrap()["status"], "unknown");
        drop(d);
    }
    #[test]
    fn amplifier_rollback_failure_detail_is_retained_unknown() {
        let (_d, s) = fixture();
        let id = uuid::Uuid::new_v4().to_string();
        let r=s.transition(&id,"operate",target(),|q,_|Ok(json!({"id":q["id"],"ok":false,"error":{"code":"operate-rollback-incomplete","message":"drive proof failed"}}))).unwrap();
        assert_eq!(r["status"], "unknown");
        assert_eq!(r["detail"]["code"], "operate-rollback-incomplete");
    }
}
