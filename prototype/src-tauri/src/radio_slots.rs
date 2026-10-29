//! Process-wide two-radio routing policy.
//!
//! Radio connections are independently owned by their fixed slot.  Only the
//! active slot is used by legacy callers which do not yet carry an explicit
//! target, and transmit authority remains a single process-wide lease.
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::Manager;

pub const RADIO1: &str = "radio1";
pub const RADIO2: &str = "radio2";

pub fn valid(value: &str) -> bool {
    matches!(value, RADIO1 | RADIO2)
}
pub fn index(value: &str) -> Result<usize, String> {
    match value {
        RADIO1 => Ok(0),
        RADIO2 => Ok(1),
        _ => Err("Unknown radio slot.".into()),
    }
}

#[derive(Clone)]
struct Routing {
    path: PathBuf,
    active_radio: String,
    power: PowerAuthority,
    changing: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PowerAuthority {
    radio_id: Option<String>,
    generation: u64,
}
impl PowerAuthority {
    pub(crate) fn request(&self) -> Value {
        json!({"id":format!("native-power-active-{}", uuid::Uuid::new_v4()),
            "method":"station_power_selection", "params": {
                "active_radio_id":self.radio_id, "active_generation":self.generation}})
    }
}

static ROUTING: OnceLock<Mutex<Option<Arc<Mutex<Routing>>>>> = OnceLock::new();
static TX_OWNER: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn validate_route_change(
    current: &str,
    requested: &str,
    tx_owner: Option<&str>,
) -> Result<(), String> {
    if current != requested && tx_owner.is_some() {
        Err("Release transmit authority before changing the active radio.".into())
    } else {
        Ok(())
    }
}
fn validate_tx_route(active: &str, requested: &str) -> Result<(), String> {
    if active == requested {
        Ok(())
    } else {
        Err("Only the active radio may obtain transmit authority.".into())
    }
}

fn admit_tx_route(routing: &Routing, radio_id: &str) -> Result<(), String> {
    if routing.changing { return Err("Wait for the active radio change before transmitting.".into()); }
    validate_tx_route(&routing.active_radio, radio_id)
}

fn load(app: &tauri::AppHandle) -> Result<Routing, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Radio routing storage is unavailable.")?
        .join("radio-routing.json");
    let active_radio = match std::fs::read(&path) {
        Ok(bytes) => {
            let saved: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "Saved radio routing is invalid; it was not overwritten.")?;
            let active = saved["active_radio"].as_str().filter(|value| valid(value));
            if saved["version"] != 2 || active.is_none() {
                return Err("Saved radio routing is unsupported; it was not overwritten.".into());
            }
            active.unwrap().to_owned()
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => RADIO1.into(),
        Err(_) => return Err("Saved radio routing could not be read.".into()),
    };
    Ok(Routing { path, power: PowerAuthority { radio_id: Some(active_radio.clone()), generation: 1 },
                 active_radio, changing: false })
}

fn persist(routing: &Routing) -> Result<(), String> {
    let parent = routing
        .path
        .parent()
        .ok_or("Radio routing storage is unavailable.")?;
    std::fs::create_dir_all(parent).map_err(|_| "Radio routing storage is unavailable.")?;
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Radio routing could not be saved.")?;
    file.write_all(
        json!({"version":2,"active_radio":routing.active_radio})
            .to_string()
            .as_bytes(),
    )
    .map_err(|_| "Radio routing could not be saved.")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "Radio routing could not be saved.")?;
    file.persist(&routing.path)
        .map_err(|_| "Radio routing could not be saved.")?;
    Ok(())
}

fn routing_owner(app: &tauri::AppHandle) -> Result<Arc<Mutex<Routing>>, String> {
    let mut slot = ROUTING
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Radio routing is unavailable.")?;
    if slot.is_none() {
        *slot = Some(Arc::new(Mutex::new(load(app)?)));
    }
    Ok(slot.as_ref().unwrap().clone())
}

fn with_routing<T>(app: &tauri::AppHandle, action: impl FnOnce(&mut Routing) -> Result<T, String>) -> Result<T, String> {
    let owner = routing_owner(app)?;
    let mut routing = owner.lock().map_err(|_| "Radio routing is unavailable.")?;
    action(&mut routing)
}

pub fn active(app: &tauri::AppHandle) -> Result<String, String> {
    with_routing(app, |routing| Ok(routing.active_radio.clone()))
}

/// Initialize native routing before any selection transport can start a worker.
pub(crate) fn prepare_power_authority(app: &tauri::AppHandle) -> Result<(), String> {
    routing_owner(app).map(|_| ())
}

/// Stamp both ordinary notices and exact-child bootstrap notices from the same
/// authority. An inactive metadata publisher never becomes the active meter.
pub(crate) fn bind_power_authority(request: Value) -> Result<Value, String> {
    if request["method"] != "station_power_selection" { return Ok(request); }
    let owner = ROUTING.get().and_then(|slot| slot.lock().ok()?.clone())
        .ok_or("Native power routing is unavailable")?;
    let power = owner.lock().map_err(|_| "Radio routing is unavailable.")?.power.clone();
    stamp_power_authority(request, &power)
}

fn stamp_power_authority(mut request: Value, power: &PowerAuthority) -> Result<Value, String> {
    let params = request["params"].as_object_mut().ok_or("Invalid power selection parameters")?;
    params.insert("active_radio_id".into(), json!(power.radio_id));
    params.insert("active_generation".into(), json!(power.generation));
    Ok(request)
}

fn set_active_on(
    owner: &Mutex<Routing>, radio_id: &str,
    tx_owner: impl Fn() -> Result<Option<String>, String>,
    mut publish: impl FnMut(&PowerAuthority) -> Result<(), String>,
) -> Result<Value, String> {
    index(radio_id)?;
    let (fence, original, changed) = {
        let mut routing = owner.lock().map_err(|_| "Radio routing is unavailable.")?;
        if routing.changing { return Err("An active radio change is still finishing.".into()); }
        validate_route_change(&routing.active_radio, radio_id, tx_owner()?.as_deref())?;
        if routing.active_radio == radio_id {
            (routing.power.clone(), routing.active_radio.clone(), false)
        } else {
            let next = routing.power.generation.checked_add(2).filter(|value| *value <= 9_007_199_254_740_991)
                .ok_or("Active power generation exhausted")?;
            routing.power = PowerAuthority { radio_id: None, generation: next - 1 };
            routing.changing = true;
            (routing.power.clone(), routing.active_radio.clone(), true)
        }
    };
    if !changed {
        publish(&fence)?;
        return Ok(json!({"version":2,"active_radio":radio_id}));
    }
    // No routing lock is held across IPC. The nil generation must be admitted
    // before native routing changes, so a failed publication cannot leave the
    // old radio's draft lease armed against the newly persisted active route.
    let admitted = publish(&fence);
    let (power, result) = {
        let mut routing = owner.lock().map_err(|_| "Radio routing is unavailable.")?;
        let mut next = routing.clone();
        next.changing = false;
        next.power = PowerAuthority { radio_id: Some(original.clone()), generation: fence.generation + 1 };
        let result = if admitted.is_ok() {
            next.active_radio = radio_id.into();
            match persist(&next) {
                Ok(()) => { next.power.radio_id = Some(radio_id.into()); Ok(()) }
                Err(error) => { next.active_radio = original; Err(error) }
            }
        } else { admitted };
        *routing = next;
        (routing.power.clone(), result)
    };
    // Also restore the old authority after rejected fencing/persistence. A lost
    // final reply leaves either the correct route or the nil fence, never the
    // earlier active generation; repeating the action republishes idempotently.
    let publication = publish(&power);
    result?;
    publication?;
    Ok(json!({"version":2,"active_radio":radio_id}))
}

pub(crate) fn set_active(app: &tauri::AppHandle, radio_id: &str,
                  publish: impl FnMut(&PowerAuthority) -> Result<(), String>) -> Result<Value, String> {
    let owner = routing_owner(app)?;
    set_active_on(&owner, radio_id, || {
        TX_OWNER.get_or_init(|| Mutex::new(None)).lock()
            .map(|owner| owner.clone()).map_err(|_| "Transmit authority is unavailable.".into())
    }, publish)
}

/// Atomically verifies routing and acquires the process-wide transmit lease.
/// `set_active` uses the same routing→TX lock order, so the active slot cannot
/// change between this check and acquisition.
pub fn claim_active_tx(app: &tauri::AppHandle, radio_id: &str) -> Result<(), String> {
    index(radio_id)?;
    with_routing(app, |routing| {
        admit_tx_route(routing, radio_id)?;
        claim_tx_lease(radio_id)
    })
}

/// Acquire the only transmit-capable lease. Re-acquiring the same slot is
/// idempotent; a second slot must remain receive-only until the owner releases.
pub fn claim_tx(radio_id: &str) -> Result<(), String> {
    index(radio_id)?;
    // Hamlib reconnect reacquires the lease inside its backend, after native
    // preflight. It must share the routing fence rather than bypass that window.
    let routing = ROUTING.get().map(|slot| slot.lock().map(|slot| slot.clone())
        .map_err(|_| "Radio routing is unavailable.")).transpose()?.flatten();
    if let Some(owner) = routing {
        let routing = owner.lock().map_err(|_| "Radio routing is unavailable.")?;
        admit_tx_route(&routing, radio_id)?;
        return claim_tx_lease(radio_id);
    }
    claim_tx_lease(radio_id)
}

fn claim_tx_lease(radio_id: &str) -> Result<(), String> {
    let mut owner = TX_OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Transmit authority is unavailable.")?;
    if owner.as_deref().is_some_and(|current| current != radio_id) {
        return Err("The other radio currently owns transmit authority.".into());
    }
    *owner = Some(radio_id.into());
    Ok(())
}

pub fn release_tx(radio_id: &str) {
    if let Ok(mut owner) = TX_OWNER.get_or_init(|| Mutex::new(None)).lock() {
        if owner.as_deref() == Some(radio_id) {
            *owner = None;
        }
    }
}

pub fn tx_owner() -> Option<String> {
    TX_OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()?
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(path: PathBuf) -> Mutex<Routing> {
        Mutex::new(Routing { path, active_radio: RADIO1.into(), changing: false,
            power: PowerAuthority { radio_id: Some(RADIO1.into()), generation: 1 } })
    }

    #[test]
    fn ordinary_and_bootstrap_metadata_keep_their_slot_under_native_active_authority() {
        let notice = json!({"id":"slot2","method":"station_power_selection","params":{
            "radio_id":RADIO2,"provider":"direct_agent","selection_id":"selection2","sequence":7}});
        for power in [PowerAuthority { radio_id: Some(RADIO1.into()), generation: 1 },
                      PowerAuthority { radio_id: None, generation: 2 },
                      PowerAuthority { radio_id: Some(RADIO2.into()), generation: 3 }] {
            let stamped = stamp_power_authority(notice.clone(), &power).unwrap();
            assert_eq!(stamped["params"]["radio_id"], RADIO2);
            assert_eq!(stamped["params"]["sequence"], 7);
            assert_eq!(stamped["params"]["active_radio_id"], json!(power.radio_id));
            assert_eq!(stamped["params"]["active_generation"], power.generation);
            assert_eq!(power.request()["params"].as_object().unwrap().len(), 2);
        }
    }

    #[test]
    fn active_power_is_fenced_before_persist_and_published_even_without_metadata_changes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("radio-routing.json");
        let owner = fixture(path.clone());
        let mut notices = Vec::new();
        set_active_on(&owner, RADIO2, || Ok(None), |power| {
            if power.radio_id.is_none() {
                assert_eq!(owner.lock().unwrap().active_radio, RADIO1);
                assert!(!path.exists(), "Fence must precede durable route publication");
                assert!(set_active_on(&owner, RADIO1, || Ok(None), |_| Ok(())).is_err());
                assert!(admit_tx_route(&owner.lock().unwrap(), RADIO1).is_err(), "Backend reacquisition cannot bypass an in-progress routing fence");
            }
            notices.push(power.clone()); Ok(())
        }).unwrap();
        assert_eq!(notices, [PowerAuthority { radio_id: None, generation: 2 },
            PowerAuthority { radio_id: Some(RADIO2.into()), generation: 3 }]);
        assert_eq!(serde_json::from_slice::<Value>(&std::fs::read(path).unwrap()).unwrap()["active_radio"], RADIO2);
        notices.clear();
        set_active_on(&owner, RADIO2, || Ok(None), |power| { notices.push(power.clone()); Ok(()) }).unwrap();
        assert_eq!(notices, [PowerAuthority { radio_id: Some(RADIO2.into()), generation: 3 }]);
    }

    #[test]
    fn rejected_fence_preserves_route_and_advances_restoration_generation() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("radio-routing.json");
        let owner = fixture(path.clone());
        let mut notices = Vec::new();
        let result = set_active_on(&owner, RADIO2, || Ok(None), |power| {
            notices.push(power.clone());
            if power.radio_id.is_none() { Err("unconfirmed fence".into()) } else { Ok(()) }
        });
        assert!(result.is_err()); assert!(!path.exists());
        assert_eq!(owner.lock().unwrap().active_radio, RADIO1);
        assert_eq!(notices.last().unwrap(), &PowerAuthority { radio_id: Some(RADIO1.into()), generation: 3 });
        set_active_on(&owner, RADIO2, || Ok(None), |_| Ok(())).unwrap();
        assert_eq!(owner.lock().unwrap().power.generation, 5);
    }

    #[test]
    fn failed_persistence_restores_old_authority_and_failed_final_reply_is_retryable() {
        let temp = tempfile::tempdir().unwrap();
        let blocked = temp.path().join("blocked"); std::fs::write(&blocked, "file").unwrap();
        let owner = fixture(blocked.join("route.json"));
        let mut notices = Vec::new();
        assert!(set_active_on(&owner, RADIO2, || Ok(None), |power| { notices.push(power.clone()); Ok(()) }).is_err());
        assert_eq!(owner.lock().unwrap().active_radio, RADIO1);
        assert_eq!(notices.last().unwrap().radio_id.as_deref(), Some(RADIO1));
        let owner = fixture(temp.path().join("route.json"));
        assert!(set_active_on(&owner, RADIO2, || Ok(None), |power| {
            if power.radio_id.is_some() { Err("reply lost".into()) } else { Ok(()) }
        }).is_err());
        assert_eq!(owner.lock().unwrap().active_radio, RADIO2);
        set_active_on(&owner, RADIO2, || Ok(None), |power| {
            assert_eq!(power.radio_id.as_deref(), Some(RADIO2)); assert_eq!(power.generation, 3); Ok(())
        }).unwrap();
    }

    #[test]
    fn owned_transmit_vetoes_active_power_change_before_any_publication() {
        let temp = tempfile::tempdir().unwrap(); let owner = fixture(temp.path().join("route.json"));
        assert!(set_active_on(&owner, RADIO2, || Ok(Some(RADIO1.into())), |_| panic!("TX veto must precede power fence")).is_err());
        assert_eq!(owner.lock().unwrap().power.generation, 1);
    }

    #[test]
    fn fixed_ids_are_closed() {
        assert_eq!(index(RADIO1).unwrap(), 0);
        assert_eq!(index(RADIO2).unwrap(), 1);
        assert!(index("radio3").is_err());
    }

    #[test]
    fn transmit_lease_is_global_and_exact() {
        release_tx(RADIO1);
        release_tx(RADIO2);
        claim_tx(RADIO1).unwrap();
        claim_tx(RADIO1).unwrap();
        assert!(claim_tx(RADIO2).is_err());
        release_tx(RADIO2);
        assert_eq!(tx_owner().as_deref(), Some(RADIO1));
        release_tx(RADIO1);
        claim_tx(RADIO2).unwrap();
        release_tx(RADIO2);
    }

    #[test]
    fn route_change_policy_allows_same_slot_but_fences_any_owned_tx() {
        assert!(validate_route_change(RADIO1, RADIO1, Some(RADIO1)).is_ok());
        assert!(validate_route_change(RADIO1, RADIO2, Some(RADIO1)).is_err());
        assert!(validate_route_change(RADIO1, RADIO2, Some(RADIO2)).is_err());
        assert!(validate_route_change(RADIO1, RADIO2, None).is_ok());
        assert!(validate_tx_route(RADIO1, RADIO1).is_ok());
        assert!(validate_tx_route(RADIO1, RADIO2).is_err());
    }
}
