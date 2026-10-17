//! Process-wide two-radio routing policy.
//!
//! Radio connections are independently owned by their fixed slot.  Only the
//! active slot is used by legacy callers which do not yet carry an explicit
//! target, and transmit authority remains a single process-wide lease.
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
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
}

static ROUTING: OnceLock<Mutex<Option<Routing>>> = OnceLock::new();
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
    Ok(Routing { path, active_radio })
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

fn with_routing<T>(
    app: &tauri::AppHandle,
    action: impl FnOnce(&mut Routing) -> Result<T, String>,
) -> Result<T, String> {
    let mut slot = ROUTING
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Radio routing is unavailable.")?;
    if slot.is_none() {
        *slot = Some(load(app)?);
    }
    action(slot.as_mut().unwrap())
}

pub fn active(app: &tauri::AppHandle) -> Result<String, String> {
    with_routing(app, |routing| Ok(routing.active_radio.clone()))
}

pub fn set_active(app: &tauri::AppHandle, radio_id: &str) -> Result<Value, String> {
    index(radio_id)?;
    with_routing(app, |routing| {
        if routing.active_radio != radio_id {
            let owner = TX_OWNER
                .get_or_init(|| Mutex::new(None))
                .lock()
                .map_err(|_| "Transmit authority is unavailable.")?;
            validate_route_change(&routing.active_radio, radio_id, owner.as_deref())?;
            let mut next = routing.clone();
            next.active_radio = radio_id.into();
            persist(&next)?;
            *routing = next;
        }
        Ok(json!({"version":2,"active_radio":routing.active_radio}))
    })
}

/// Atomically verifies routing and acquires the process-wide transmit lease.
/// `set_active` uses the same routing→TX lock order, so the active slot cannot
/// change between this check and acquisition.
pub fn claim_active_tx(app: &tauri::AppHandle, radio_id: &str) -> Result<(), String> {
    index(radio_id)?;
    with_routing(app, |routing| {
        validate_tx_route(&routing.active_radio, radio_id)?;
        claim_tx(radio_id)
    })
}

/// Acquire the only transmit-capable lease. Re-acquiring the same slot is
/// idempotent; a second slot must remain receive-only until the owner releases.
pub fn claim_tx(radio_id: &str) -> Result<(), String> {
    index(radio_id)?;
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
