//! One-shot carrier acquisition. Recovery reads receipts; it never keys again.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
const MAX: u64 = 9_007_199_254_740_991;
// CW arm/send and carrier acquisition share this nonblocking authority. Their
// urgent release paths deliberately never acquire it.
static OUTPUT_ACQUISITION: Mutex<()> = Mutex::new(());
#[cfg(test)]
pub static OUTPUT_TEST:Mutex<()>=Mutex::new(());
static OUTPUT_INTENT: OnceLock<Mutex<String>> = OnceLock::new();
pub fn output_intent() -> Result<String,String> { Ok(OUTPUT_INTENT.get_or_init(||Mutex::new(uuid::Uuid::new_v4().to_string())).lock().map_err(|_|"Output intent unavailable")?.clone()) }
pub fn revoke_output_intent() -> Result<(),String> { *OUTPUT_INTENT.get_or_init(||Mutex::new(uuid::Uuid::new_v4().to_string())).lock().map_err(|_|"Output intent unavailable")?=uuid::Uuid::new_v4().to_string();Ok(()) }
pub fn require_output_intent(expected:&str)->Result<(),String>{if output_intent()?!=expected{return Err("A later PTT off/Cancel retired this acquisition preparation".into());}Ok(())}
pub fn reserve_output() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    OUTPUT_ACQUISITION.try_lock().map_err(|_| {
        "A radio/CW acquisition is in progress. Stop and Cancel remain available.".into()
    })
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub(crate) provider: String,
    pub(crate) selection_generation: u64,
    pub(crate) selection_id: String,
    pub(crate) worker_generation: u64,
    pub(crate) connection_generation: u64,
    pub(crate) control_revision: u64,
    pub(crate) observation_revision: u64,
    pub(crate) received_at_ms: u64,
}
impl Target {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if !matches!(self.provider.as_str(), "direct_agent" | "direct_flex_lan")
            || uuid::Uuid::parse_str(&self.selection_id).is_err()
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
            return Err("Invalid carrier Tune target.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    operation_id: String,
    target: Target,
    status: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    version: u8,
    receipts: Vec<Receipt>,
}
pub struct Session {
    path: PathBuf,
    state: Mutex<Saved>,
    acquisition: Mutex<()>,
}
pub fn validate(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if isolated
        || exiting
        || !matches!(label, "main" | "monitor" | "station-control")
        || !matches!(action, "snapshot" | "tune" | "receipt" | "review")
    {
        return Err("Carrier Tune is unavailable in this window.".into());
    }
    Ok(())
}
impl Session {
    fn new(path: PathBuf) -> Result<Self, String> {
        let mut saved = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Saved>(&bytes)
                .map_err(|_| "Carrier Tune journal is invalid; it was not overwritten.")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Saved {
                version: 1,
                receipts: vec![],
            },
            Err(_) => return Err("Carrier Tune journal unavailable.".into()),
        };
        if saved.version != 1 {
            return Err("Unsupported carrier Tune journal.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for r in &mut saved.receipts {
            r.target.validate()?;
            if uuid::Uuid::parse_str(&r.operation_id).is_err()
                || !ids.insert(r.operation_id.clone())
                || !matches!(
                    r.status.as_str(),
                    "pending" | "unknown" | "acknowledged" | "confirmed" | "reviewed"
                )
            {
                return Err("Invalid carrier Tune receipt.".into());
            }
            if r.status == "pending" {
                r.status = "unknown".into();
            }
        }
        Ok(Self {
            path,
            state: Mutex::new(saved),
            acquisition: Mutex::new(()),
        })
    }
    fn persist(&self, saved: &Saved) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Carrier Tune storage unavailable.")?;
        std::fs::create_dir_all(parent).map_err(|_| "Carrier Tune storage unavailable.")?;
        let mut file = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Carrier Tune receipt could not be saved.")?;
        file.write_all(
            &serde_json::to_vec(saved).map_err(|_| "Carrier Tune serialization failed.")?,
        )
        .map_err(|_| "Carrier Tune receipt could not be saved.")?;
        file.as_file()
            .sync_all()
            .map_err(|_| "Carrier Tune receipt could not be saved.")?;
        file.persist(&self.path)
            .map_err(|_| "Carrier Tune receipt could not be saved.")?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Carrier Tune journal unavailable.")?;
        Ok(
            json!({"receipts":state.receipts.iter().filter(|r| matches!(r.status.as_str(),"pending"|"unknown")).collect::<Vec<_>>()}),
        )
    }
    fn require_cw_ready(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Carrier Tune journal unavailable")?;
        if state
            .receipts
            .iter()
            .any(|r| matches!(r.status.as_str(), "pending" | "unknown"))
        {
            return Err("Resolve the retained carrier Tune before arming or sending CW. Cancel remains available.".into());
        }
        Ok(())
    }
    pub fn receipt(&self, id: &str) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Carrier Tune journal unavailable.")?;
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
            .map_err(|_| "Carrier Tune journal unavailable.")?;
        let index = state
            .receipts
            .iter()
            .position(|r| r.operation_id == id)
            .ok_or("Carrier Tune receipt not found.")?;
        if state.receipts[index].status == "reviewed" {
            return Ok(json!(state.receipts[index]));
        }
        if state.receipts[index].status != "unknown" {
            return Err("Only an unknown carrier Tune may be reviewed.".into());
        }
        let mut next = state.clone();
        next.receipts[index].status = "reviewed".into();
        self.persist(&next)?;
        *state = next;
        Ok(json!(state.receipts[index]))
    }
    pub fn tune(
        &self,
        id: &str,
        target: Target,
        dispatch: impl FnOnce(Value, &Target) -> Result<Value, String>,
    ) -> Result<Value, String> {
        target.validate()?;
        if uuid::Uuid::parse_str(id).is_err() {
            return Err("Invalid carrier Tune identity.".into());
        }
        // Duplicate recovery remains available while the original dispatch runs.
        {
            let state = self
                .state
                .lock()
                .map_err(|_| "Carrier Tune journal unavailable.")?;
            if let Some(old) = state.receipts.iter().find(|r| r.operation_id == id) {
                if old.target != target {
                    return Err("Carrier Tune identity collision.".into());
                }
                return Ok(json!(old));
            }
        }
        let _acquisition = self.acquisition.try_lock().map_err(|_| {
            "A carrier Tune acquisition is already in progress. Cancel remains available."
        })?;
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Carrier Tune journal unavailable.")?;
            if let Some(old) = state.receipts.iter().find(|r| r.operation_id == id) {
                if old.target != target {
                    return Err("Carrier Tune identity collision.".into());
                }
                return Ok(json!(old));
            }
            if state
                .receipts
                .iter()
                .any(|r| matches!(r.status.as_str(), "pending" | "unknown"))
            {
                return Err("Review the unknown carrier Tune and observe RX before another acquisition. Cancel remains available.".into());
            }
            let mut next = state.clone();
            next.receipts.push(Receipt {
                operation_id: id.into(),
                target: target.clone(),
                status: "pending".into(),
            });
            self.persist(&next)?;
            *state = next;
        }
        let result = dispatch(
            json!({"id":id,"method":"station_action","params":{"provider":target.provider,"action":"tune","expected_generation":target.connection_generation}}),
            &target,
        );
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Carrier Tune outcome unknown; inspect its receipt.")?;
        let mut next = state.clone();
        let receipt = next
            .receipts
            .iter_mut()
            .find(|r| r.operation_id == id)
            .ok_or("Carrier Tune receipt missing.")?;
        receipt.status = outcome(id, &target, &result).into();
        let value = json!(receipt);
        if self.persist(&next).is_err() {
            next.receipts
                .iter_mut()
                .find(|r| r.operation_id == id)
                .unwrap()
                .status = "unknown".into();
            *state = next;
            return Err("Carrier Tune outcome could not be saved; inspect its receipt. No Tune will be replayed.".into());
        }
        *state = next;
        Ok(value)
    }
}
fn outcome(id: &str, target: &Target, result: &Result<Value, String>) -> &'static str {
    let Ok(reply) = result else {
        return "unknown";
    };
    let result = &reply["result"];
    let state = &result["state"];
    if reply["id"] != id
        || reply["ok"] != true
        || result["accepted"] != true
        || result["action"] != "tune"
        || state["source"] != target.provider
        || state["generation"] != target.connection_generation
    {
        return "unknown";
    }
    if target.provider == "direct_agent" {
        if result["confirmed"] == false {
            "acknowledged"
        } else {
            "unknown"
        }
    } else if result["confirmed"] == true
        && state["radio"]["connected"] == true
        && state["radio"]["observed"] == true
        && state["radio"]["transmitting"] == true
    {
        "confirmed"
    } else {
        "unknown"
    }
}
fn cw_idle(value: &Value) -> bool {
    value["armed"] == false
        && value["pending"] == false
        && value["owner"].is_null()
        && value["lease"].is_null()
}
pub(crate) fn admission(
    selection: &Value,
    radio: &Value,
    target: &Target,
    now: u64,
    cw: &Value,
) -> Result<(), String> {
    target.validate()?;
    let snapshot = &radio["snapshot"];
    let station = &snapshot["station"];
    let observed = &snapshot["radio"];
    let recent = |value: &Value, scale: f64| {
        value.as_f64().is_some_and(|time| {
            time.is_finite() && (-1000.0..=3000.0).contains(&(now as f64 - time * scale))
        })
    };
    let common = selection["provider"] == target.provider
        && selection["generation"] == target.selection_generation
        && selection["selection_id"] == target.selection_id
        && selection["control_revision"] == target.control_revision
        && radio["provider"] == target.provider
        && radio["selection_generation"] == target.selection_generation
        && radio["selection_id"] == target.selection_id
        && radio["worker_generation"] == target.worker_generation
        && radio["revision"] == target.observation_revision
        && radio["received_at_ms"] == target.received_at_ms
        && radio["available"] == true
        && recent(&radio["received_at_ms"], 1.0)
        && recent(&snapshot["generated_at"], 1000.0)
        && recent(&observed["observed_at"], 1000.0)
        && snapshot["source"] == target.provider
        && snapshot["generation"] == target.connection_generation
        && snapshot["allow_transmit"] == true
        && snapshot["carrier_tune"]["pending"] == false
        && snapshot["carrier_tune"]["release_required"] == false
        && observed["connected"] == true
        && observed["observed"] == true
        && observed["transmitting"] == false
        && station["radio_stale"] != true
        && cw_idle(cw);
    let permitted = if target.provider == "direct_agent" {
        station["commissioned"] == true
            && station["radio_known"] == true
            && station["radio_stale"] == false
            && station["inhibitors"]
                .as_array()
                .is_some_and(|v| v.is_empty())
            && station["allowed_actions"]
                .as_array()
                .is_some_and(|v| v.iter().any(|x| x == "tune"))
            && station["supported_commands"]
                .as_array()
                .is_some_and(|v| v.iter().any(|x| x == "station_tune"))
    } else {
        snapshot["capabilities"]["supported_commands"]
            .as_array()
            .is_some_and(|v| v.iter().any(|x| x == "tune"))
            && observed["vfos"].as_array().is_some_and(|vfos| {
                vfos.iter()
                    .any(|v| v["letter"] == observed["receive_vfo"] && v["receive"] == true)
                    && vfos
                        .iter()
                        .any(|v| v["letter"] == observed["transmit_vfo"] && v["transmit"] == true)
            })
    };
    if !common || !permitted {
        return Err("Carrier Tune requires the same fresh idle radio, transmit consent, current capability and no CW lease. No Tune was sent.".into());
    }
    Ok(())
}
fn cw_snapshot() -> Result<Value, String> {
    crate::cw_session_backend::existing().map_or_else(
        || Ok(json!({"armed":false,"pending":false,"owner":null,"lease":null})),
        |owner| owner.snapshot(),
    )
}
pub fn context(app: &tauri::AppHandle) -> Result<Value, String> {
    let selection = crate::station_selection::owner(app)?.snapshot()?;
    let radio = crate::station_telemetry::owner(app)?.snapshot()?;
    let target=serde_json::from_value::<Target>(json!({"provider":selection["provider"],"selection_generation":selection["generation"],"selection_id":selection["selection_id"],"control_revision":selection["control_revision"],
        "worker_generation":radio["worker_generation"],"connection_generation":radio["snapshot"]["generation"],"observation_revision":radio["revision"],"received_at_ms":radio["received_at_ms"]})).ok().filter(|t|t.validate().is_ok());
    Ok(json!({"target":target}))
}
pub fn execute(app: &tauri::AppHandle, request: Value, target: &Target) -> Result<Value, String> {
    let _output = reserve_output()?;
    crate::ptt_session::require_idle(app)?;
    crate::worker::require_existing_generation(target.worker_generation)?;
    let selection = crate::station_selection::owner(app)?;
    let telemetry = crate::station_telemetry::owner(app)?;
    let expected = json!({"provider":target.provider,"generation":target.selection_generation,"selection_id":target.selection_id,"control_revision":target.control_revision});
    selection.carrier_tune(
        request,
        &expected,
        || {
            crate::worker::require_existing_generation(target.worker_generation)?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "Radio clock unavailable")?
                .as_millis() as u64;
            admission(
                &expected,
                &telemetry.snapshot()?,
                target,
                now,
                &cw_snapshot()?,
            )?;
            telemetry.control()
        },
        |request| {
            let response =
                crate::worker::request_existing_generation(request, target.worker_generation)?;
            crate::worker::require_existing_generation(target.worker_generation)?;
            let actual = selection.snapshot()?;
            if actual["provider"] != target.provider
                || actual["generation"] != target.selection_generation
                || actual["selection_id"] != target.selection_id
                || actual["control_revision"].as_u64() != target.control_revision.checked_add(1)
            {
                return Err(
                    "Carrier Tune was superseded by another radio action; its outcome is unknown."
                        .into(),
                );
            }
            Ok(response)
        },
    )
}
static OWNER: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
pub fn require_cw_ready(app: &tauri::AppHandle) -> Result<(), String> {
    // Durable uncertainty exists independently of renderer lifetime. Always
    // load/validate the journal on the first selected-radio CW admission.
    owner(app)?.require_cw_ready()
}
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<Session>, String> {
    let mut slot = OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Carrier Tune owner unavailable")?;
    if let Some(owner) = slot.as_ref() {
        return Ok(owner.clone());
    }
    let owner = Arc::new(Session::new(
        app.path()
            .app_config_dir()
            .map_err(|_| "Carrier Tune storage unavailable")?
            .join("carrier-tune.json"),
    )?);
    *slot = Some(owner.clone());
    Ok(owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(provider: &str) -> (Target, Value, Value, Value) {
        let t = Target {
            provider: provider.into(),
            selection_generation: 2,
            selection_id: uuid::Uuid::new_v4().to_string(),
            worker_generation: 4,
            connection_generation: 7,
            control_revision: 3,
            observation_revision: 8,
            received_at_ms: 10000,
        };
        let selection = json!({"provider":provider,"generation":2,"selection_id":t.selection_id,"control_revision":3});
        let radio = json!({"available":true,"provider":provider,"selection_generation":2,"selection_id":t.selection_id,"worker_generation":4,"revision":8,"received_at_ms":10000,
            "snapshot":{"source":provider,"generation":7,"generated_at":10.0,"allow_transmit":true,"carrier_tune":{"pending":false,"release_required":false},"radio":{"connected":true,"observed":true,"observed_at":10.0,"transmitting":false,"receive_vfo":"A","transmit_vfo":"A","vfos":[{"letter":"A","receive":true,"transmit":true}]},
            "station":{"commissioned":true,"radio_known":true,"radio_stale":false,"inhibitors":[],"allowed_actions":["tune"],"supported_commands":["station_tune"]},"capabilities":{"supported_commands":["tune"]}}});
        (
            t,
            selection,
            radio,
            json!({"armed":false,"pending":false,"owner":null,"lease":null}),
        )
    }
    fn response(request: &Value, t: &Target) -> Value {
        json!({"id":request["id"],"ok":true,"result":{"accepted":true,"confirmed":false,"action":"tune","state":{"source":t.provider,"generation":t.connection_generation}}})
    }
    #[test]
    fn carrier_admission_requires_exact_fresh_idle_consent_policy_and_no_cw() {
        for provider in ["direct_agent", "direct_flex_lan"] {
            let (t, s, r, cw) = fixture(provider);
            assert!(admission(&s, &r, &t, 10000, &cw).is_ok());
            for change in 0..19 {
                let mut next = r.clone();
                let mut selection = s.clone();
                let mut cw = cw.clone();
                match change {
                    0 => next["received_at_ms"] = json!(6000),
                    1 => next["snapshot"]["radio"]["transmitting"] = Value::Null,
                    2 => next["snapshot"]["radio"]["transmitting"] = json!(true),
                    3 => next["snapshot"]["allow_transmit"] = json!(false),
                    4 => next["worker_generation"] = json!(5),
                    5 => next["snapshot"]["generation"] = json!(8),
                    6 => selection["control_revision"] = json!(4),
                    7 => selection["selection_id"] = json!(uuid::Uuid::new_v4().to_string()),
                    8 => next["revision"] = json!(9),
                    9 => next["available"] = json!(false),
                    10 => next["snapshot"]["radio"]["observed_at"] = json!(1.0),
                    11 => cw["armed"] = json!(true),
                    12 => cw["pending"] = json!(true),
                    13 => cw["owner"] = json!({"output":"radio"}),
                    14 => cw["lease"] = json!("lease"),
                    15 => {
                        if provider == "direct_agent" {
                            next["snapshot"]["station"]["inhibitors"] = json!(["unsafe"])
                        } else {
                            next["snapshot"]["radio"]["vfos"] = json!([])
                        }
                    }
                    16 => {
                        if provider == "direct_agent" {
                            next["snapshot"]["station"]["commissioned"] = json!(false)
                        } else {
                            next["snapshot"]["capabilities"]["supported_commands"] = json!([])
                        }
                    }
                    17 => next["snapshot"]["carrier_tune"]["pending"] = json!(true),
                    _ => next["snapshot"]["carrier_tune"]["release_required"] = json!(true),
                }
                assert!(
                    admission(&selection, &next, &t, 10000, &cw).is_err(),
                    "{provider}:{change}"
                );
            }
        }
    }
    #[test]
    fn durable_carrier_admission_never_replays_and_unknown_blocks_only_acquisition() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("carrier.json");
        let owner = Session::new(path.clone()).unwrap();
        let (t, _, _, _) = fixture("direct_agent");
        let id = uuid::Uuid::new_v4().to_string();
        let value = owner
            .tune(&id, t.clone(), |request, t| {
                assert_eq!(owner.receipt(&id).unwrap()["status"], "pending");
                assert_eq!(
                    owner
                        .tune(&id, t.clone(), |_, _| panic!("duplicate dispatched"))
                        .unwrap()["status"],
                    "pending"
                );
                assert!(owner
                    .tune(&uuid::Uuid::new_v4().to_string(), t.clone(), |_, _| panic!(
                        "second acquisition dispatched"
                    ))
                    .is_err());
                Ok(response(&request, t))
            })
            .unwrap();
        assert_eq!(value["status"], "acknowledged");
        let mut collision = t.clone();
        collision.connection_generation += 1;
        assert!(owner.tune(&id, collision, |_, _| panic!()).is_err());
        assert_eq!(
            Session::new(path.clone())
                .unwrap()
                .tune(&id, t.clone(), |_, _| panic!("restart replay"))
                .unwrap()["status"],
            "acknowledged"
        );
        let lost = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            owner
                .tune(&lost, t.clone(), |_, _| Err("lost".into()))
                .unwrap()["status"],
            "unknown"
        );
        assert!(
            owner.require_cw_ready().is_err(),
            "Unreviewed unknown acquisition blocks selected-radio CW"
        );
        assert!(owner
            .tune(
                &uuid::Uuid::new_v4().to_string(),
                t.clone(),
                |_, _| panic!()
            )
            .is_err());
        assert!(crate::radio_release::validate("monitor", false, false, "cancel").is_ok());
        owner.review(&lost).unwrap();
        assert!(owner.require_cw_ready().is_ok(),"Review retires durable uncertainty only; backend release ownership is checked independently");
        assert_eq!(
            Session::new(path)
                .unwrap()
                .tune(&lost, t, |_, _| panic!("review replay"))
                .unwrap()["status"],
            "reviewed"
        );
    }
    #[test]
    fn crash_and_storage_failures_stay_unknown_without_duplicate_send() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("carrier.json");
        let owner = Session::new(path.clone()).unwrap();
        let (t, _, _, _) = fixture("direct_agent");
        let id = uuid::Uuid::new_v4().to_string();
        owner
            .persist(&Saved {
                version: 1,
                receipts: vec![Receipt {
                    operation_id: id.clone(),
                    target: t.clone(),
                    status: "pending".into(),
                }],
            })
            .unwrap();
        assert_eq!(
            Session::new(path.clone())
                .unwrap()
                .tune(&id, t.clone(), |_, _| panic!())
                .unwrap()["status"],
            "unknown"
        );
        let bad = Session::new(dir.path().join("bad").join("carrier.json")).unwrap();
        std::fs::write(dir.path().join("bad"), b"file").unwrap();
        assert!(bad
            .tune(&uuid::Uuid::new_v4().to_string(), t.clone(), |_, _| panic!(
                "write failed but sent"
            ))
            .is_err());
        assert!(owner
            .tune(&id, t.clone(), |request, t| {
                std::fs::rename(&path, dir.path().join("pending.json")).unwrap();
                std::fs::create_dir(&path).unwrap();
                Ok(response(&request, t))
            })
            .is_err());
        assert_eq!(owner.receipt(&id).unwrap()["status"], "unknown");
    }
    #[test]
    fn cold_start_persisted_unknown_blocks_radio_cw_before_any_renderer_read() {
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("carrier.json");
        let (target,_,_,_)=fixture("direct_agent");
        Session::new(path.clone()).unwrap().persist(&Saved{version:1,receipts:vec![Receipt{
            operation_id:uuid::Uuid::new_v4().to_string(),target,status:"unknown".into()
        }]}).unwrap();
        // The production CW gate calls owner(app) to load this journal. There
        // has been no snapshot, renderer mount, or carrier request this run.
        let cold=Session::new(path).unwrap();
        assert!(crate::cw_session_backend::carrier_output_admission("radio",||cold.require_cw_ready()).is_err());
        assert_eq!(cold.snapshot().unwrap()["receipts"][0]["status"],"unknown");
    }
    #[test]
    fn flex_requires_exact_fresh_confirmed_tx_and_cw_carrier_reservation_is_shared() {
        let (t, _, _, _) = fixture("direct_flex_lan");
        let id = uuid::Uuid::new_v4().to_string();
        let mut reply = response(&json!({"id":id}), &t);
        assert_eq!(outcome(&id, &t, &Ok(reply.clone())), "unknown");
        reply["result"]["confirmed"] = json!(true);
        assert_eq!(outcome(&id, &t, &Ok(reply.clone())), "unknown");
        reply["result"]["state"]["radio"] =
            json!({"connected":true,"observed":true,"transmitting":true});
        assert_eq!(outcome(&id, &t, &Ok(reply.clone())), "confirmed");
        reply["id"] = json!("wrong");
        assert_eq!(outcome(&id, &t, &Ok(reply)), "unknown");
    }
    #[test]
    fn cw_and_carrier_races_are_nonblocking_in_both_orders() {
        let _serial=OUTPUT_TEST.lock().unwrap();
        // Both production entry points use reserve_output. Labels describe the
        // competing roles; neither may queue an acquisition after the other.
        for (first, second) in [("carrier", "cw"), ("cw", "carrier")] {
            let guard = reserve_output().unwrap();
            let denied = std::thread::spawn(|| reserve_output().is_err())
                .join()
                .unwrap();
            assert!(denied, "{second} entered while {first} prepared/dispatched");
            assert!(crate::radio_release::validate("monitor", false, false, "cancel").is_ok());
            drop(guard);
        }
    }
}
