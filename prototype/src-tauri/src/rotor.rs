use serde_json::{json, Map, Value};
use std::sync::{Mutex, OnceLock};

use crate::{hamlib, worker};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Owner {
    Hamlib,
    NativeDcu1,
}

impl Owner {
    fn parse(value: &Value) -> Result<Self, String> {
        match value.as_str() {
            Some("hamlib") => Ok(Self::Hamlib),
            Some("native_dcu1") => Ok(Self::NativeDcu1),
            _ => Err("Rotor owner must be hamlib or native_dcu1".into()),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Hamlib => "hamlib",
            Self::NativeDcu1 => "native_dcu1",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Active,
    Uncertain,
}

#[derive(Default)]
struct State {
    owner: Option<Owner>,
    generation: u64,
    phase: Option<Phase>,
    revision: u64,
    intent_id: Option<String>,
}

/// This is the sole in-process rotor ingress. The lock serializes retirement
/// with commands; it never grants a second owner after an uncertain connect or
/// disconnect. It does not assert that physical movement has ceased.
pub struct RotorCoordinator {
    state: Mutex<State>,
}

impl RotorCoordinator {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(State::default()),
        }
    }

    pub fn handle<F>(&self, request: Value, backend: F) -> Result<Value, String>
    where
        F: FnOnce(Value) -> Result<Value, String>,
    {
        let id = request["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or("Invalid request ID")?
            .to_owned();
        let id = id.as_str();
        let method = request["method"].as_str().ok_or("Method is required")?;
        let params = request["params"]
            .as_object()
            .ok_or("Parameters must be an object")?;
        let mut state = self.state.lock().map_err(|_| "Rotor owner lock failed")?;

        if method == "rotor_snapshot" {
            if !params.is_empty() {
                return Err("Rotor snapshot takes no parameters".into());
            }
            let owner = state.owner;
            let generation = state.generation;
            let revision = state.revision;
            drop(state); // a slow readback must not delay Stop or retirement
            let (backend_result, backend_available) = if let Some(owner) = owner {
                let (method, params) = backend_snapshot(owner);
                match backend(envelope(id, method, params)).and_then(|reply| unpack(reply, id)) {
                    Ok(value) => (Some(value), true),
                    Err(_) => (None, false),
                }
            } else {
                (None, false)
            };
            let current = self.state.lock().map_err(|_| "Rotor owner lock failed")?;
            if current.generation != generation
                || current.revision != revision
                || current.owner != owner
            {
                return Ok(success(
                    id,
                    json!({"owner":current.owner.map(Owner::name),
                    "generation":current.generation,"state":phase_name(current.phase),
                    "intent_id":current.intent_id,
                    "backend":null,"backend_available":false}),
                ));
            }
            return Ok(success(
                id,
                json!({
                    "owner": owner.map(Owner::name), "generation": generation,
                    "state": phase_name(current.phase), "backend": backend_result,
                    "intent_id":current.intent_id,
                    "backend_available": backend_available,
                }),
            ));
        }

        if method.starts_with("rotor_") {
            let owner = Owner::parse(&params["owner"])?;
            validate_new_params(method, owner, params)?;
            if method == "rotor_connect" {
                if state.owner.is_some() {
                    return Err(
                        "A rotor owner already exists; disconnect it before connecting another"
                            .into(),
                    );
                }
                state.generation = state.generation.wrapping_add(1);
                state.owner = Some(owner);
                state.phase = Some(Phase::Uncertain);
                state.intent_id = None;
                let (backend_method, backend_params) = map_new(method, owner, params)?;
                let reply = backend(envelope(id, backend_method, backend_params))?;
                let value = unpack(reply, id)?;
                state.phase = Some(Phase::Active);
                return Ok(success(
                    id,
                    json!({"owner":owner.name(), "generation":state.generation,
                    "state":"active", "intent_id":state.intent_id, "backend":value}),
                ));
            }
            require_owner(&state, owner)?;
            if matches!(method, "rotor_goto" | "rotor_park") && state.phase != Some(Phase::Active) {
                return Err(
                    "Rotor connection outcome is uncertain; stop or disconnect before turning"
                        .into(),
                );
            }
            let expected = params["generation"]
                .as_u64()
                .ok_or("Rotor generation is required")?;
            if expected != state.generation {
                return Err("Rotor generation changed; refresh before sending a command".into());
            }
            let (backend_method, backend_params) = map_new(method, owner, params)?;
            if method == "rotor_disconnect" {
                state.phase = Some(Phase::Uncertain);
                state.intent_id = None;
            }
            if matches!(method, "rotor_goto" | "rotor_park" | "rotor_stop") {
                // Every motion intent invalidates an older automatic turn,
                // including when its backend reply is lost. Do this before
                // dispatch while holding the owner lock, so an old intent
                // cannot slip through behind a manual turn or park.
                state.generation = state.generation.wrapping_add(1);
                state.revision = state.revision.wrapping_add(1);
                state.phase = Some(Phase::Uncertain);
                state.intent_id = if method == "rotor_goto" {
                    params
                        .get("intent_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                } else {
                    None
                };
            }
            let reply = backend(envelope(id, backend_method, backend_params))?;
            let value = unpack(reply, id)?;
            if matches!(method, "rotor_goto" | "rotor_park" | "rotor_stop") {
                state.phase = Some(Phase::Active);
            }
            if method == "rotor_disconnect" {
                state.owner = None;
                state.phase = None;
                state.generation = state.generation.wrapping_add(1);
                state.intent_id = None;
            }
            return Ok(success(
                id,
                json!({"owner":state.owner.map(Owner::name),
                "generation":state.generation, "state":phase_name(state.phase),
                "intent_id":state.intent_id,
                "backend":value}),
            ));
        }

        let owner = if method.starts_with("hamlib_") {
            if params.get("device").and_then(Value::as_str) != Some("rotor") {
                return Err("This rotor route requires device rotor".into());
            }
            Owner::Hamlib
        } else if method.starts_with("station_rotor_") {
            if params.get("provider").and_then(Value::as_str) != Some("direct_agent") {
                return Err("Native rotor route requires the direct_agent backend".into());
            }
            Owner::NativeDcu1
        } else {
            return Err("Unknown rotor operation".into());
        };
        let introspection = matches!(
            method,
            "hamlib_models"
                | "hamlib_serial_ports"
                | "hamlib_capabilities"
                | "hamlib_status"
                | "hamlib_snapshot"
                | "station_rotor_snapshot"
        );
        if introspection {
            if state.owner.is_some_and(|existing| existing != owner) {
                return Err("Another rotor backend owns the device".into());
            }
            let generation = state.generation;
            let revision = state.revision;
            drop(state);
            let reply = backend(request);
            let current = self.state.lock().map_err(|_| "Rotor owner lock failed")?;
            if current.generation != generation || current.revision != revision {
                return Err("Rotor owner changed during readback; refresh the snapshot".into());
            }
            return reply;
        }
        Err("Legacy rotor mutation is unavailable; use rotor_connect, rotor_disconnect, rotor_goto, rotor_stop or rotor_park with the current generation".into())
    }
}

fn require_owner(state: &State, owner: Owner) -> Result<(), String> {
    if state.owner == Some(owner) {
        Ok(())
    } else {
        Err("The selected rotor backend does not own a connection".into())
    }
}

fn phase_name(phase: Option<Phase>) -> &'static str {
    match phase {
        Some(Phase::Active) => "active",
        Some(Phase::Uncertain) => "uncertain",
        None => "disconnected",
    }
}

fn envelope(id: &str, method: &str, params: Value) -> Value {
    json!({"id":id,"method":method,"params":params})
}

fn success(id: &str, result: Value) -> Value {
    json!({"id":id,"ok":true,"result":result})
}

fn unpack(reply: Value, id: &str) -> Result<Value, String> {
    if reply["id"].as_str() != Some(id) || !reply["ok"].is_boolean() {
        return Err("Rotor backend reply did not match the request".into());
    }
    if reply["ok"] != true {
        return Err(reply["error"]["message"]
            .as_str()
            .unwrap_or("Rotor backend rejected the request")
            .to_owned());
    }
    Ok(reply["result"].clone())
}

fn backend_snapshot(owner: Owner) -> (&'static str, Value) {
    match owner {
        Owner::Hamlib => ("hamlib_snapshot", json!({"device":"rotor"})),
        Owner::NativeDcu1 => ("station_rotor_snapshot", json!({"provider":"direct_agent"})),
    }
}

fn map_new(
    method: &str,
    owner: Owner,
    params: &Map<String, Value>,
) -> Result<(&'static str, Value), String> {
    let mut values = params.clone();
    values.remove("owner");
    values.remove("generation");
    values.remove("intent_id");
    let backend_method = match (method, owner) {
        ("rotor_connect", Owner::Hamlib) => "hamlib_connect",
        ("rotor_connect", Owner::NativeDcu1) => "station_rotor_connect",
        ("rotor_disconnect", Owner::Hamlib) => "hamlib_disconnect",
        ("rotor_disconnect", Owner::NativeDcu1) => "station_rotor_disconnect",
        ("rotor_goto", Owner::Hamlib) | ("rotor_stop", Owner::Hamlib) => "hamlib_control",
        ("rotor_park", Owner::Hamlib) => "hamlib_control",
        ("rotor_goto", Owner::NativeDcu1) => "station_rotor_goto",
        ("rotor_stop", Owner::NativeDcu1) => "station_rotor_stop",
        _ => return Err("Unknown rotor operation".into()),
    };
    match owner {
        Owner::Hamlib => {
            values.insert("device".into(), json!("rotor"));
            if method == "rotor_goto" {
                let bearing = values
                    .remove("bearing")
                    .ok_or("Rotor bearing is required")?;
                values.insert("action".into(), json!("goto"));
                values.insert("azimuth".into(), bearing);
                values.entry("elevation").or_insert_with(|| json!(0));
                values.remove("label");
            } else if method == "rotor_stop" {
                values.insert("action".into(), json!("stop"));
            } else if method == "rotor_park" {
                values.insert("action".into(), json!("park"));
            }
        }
        Owner::NativeDcu1 => {
            values.insert("provider".into(), json!("direct_agent"));
            // DCU-1 is azimuth-only; elevation is rejected by the API rather
            // than silently discarded.
        }
    }
    Ok((backend_method, Value::Object(values)))
}

fn validate_new_params(
    method: &str,
    owner: Owner,
    params: &Map<String, Value>,
) -> Result<(), String> {
    let allowed: &[&str] = match method {
        "rotor_connect" if owner == Owner::NativeDcu1 => &["owner", "host", "port", "name"],
        "rotor_connect" => {
            if params.contains_key("generation")
                || params.contains_key("device")
                || params.contains_key("provider")
                || params.contains_key("action")
                || params.contains_key("intent_id")
            {
                return Err("Unexpected rotor connection parameter".into());
            }
            return Ok(()); // Hamlib validates its model, transport and serial options.
        }
        "rotor_disconnect" | "rotor_stop" => &["owner", "generation"],
        "rotor_park" if owner == Owner::Hamlib => &["owner", "generation"],
        "rotor_goto" if owner == Owner::Hamlib => &[
            "owner",
            "generation",
            "bearing",
            "elevation",
            "label",
            "intent_id",
        ],
        "rotor_goto" => &["owner", "generation", "bearing", "label", "intent_id"],
        _ => return Err("Unknown rotor operation".into()),
    };
    if params.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("Unexpected rotor parameter".into());
    }
    if let Some(intent_id) = params.get("intent_id") {
        let valid = intent_id.as_str().is_some_and(|value| {
            (1..=128).contains(&value.len())
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        });
        if !valid {
            return Err("Rotor intent ID must be a bounded ASCII token".into());
        }
    }
    Ok(())
}

pub fn request(request: Value) -> Result<Value, String> {
    static COORDINATOR: OnceLock<RotorCoordinator> = OnceLock::new();
    COORDINATOR
        .get_or_init(RotorCoordinator::new)
        .handle(request, |request| {
            if request["method"]
                .as_str()
                .is_some_and(|method| method.starts_with("hamlib_"))
            {
                hamlib::request(request)
            } else {
                worker::request(request)
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    fn call(
        coordinator: &RotorCoordinator,
        id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        coordinator.handle(envelope(id, method, params), |request| {
            Ok(success(
                request["id"].as_str().unwrap(),
                json!({"method":request["method"],
                "params":request["params"]}),
            ))
        })
    }

    #[test]
    fn one_owner_survives_radio_handover_and_blocks_other_backend() {
        let coordinator = RotorCoordinator::new();
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"native_dcu1",
            "host":"fixture.invalid","port":4001}),
        )
        .unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        assert!(call(
            &coordinator,
            "b",
            "rotor_connect",
            json!({"owner":"hamlib","mode":"managed"})
        )
        .is_err());
        let snapshot = call(&coordinator, "c", "rotor_snapshot", json!({})).unwrap();
        assert_eq!(snapshot["result"]["owner"], "native_dcu1");
        assert_eq!(snapshot["result"]["generation"], generation);
        call(
            &coordinator,
            "d",
            "rotor_disconnect",
            json!({"owner":"native_dcu1","generation":generation}),
        )
        .unwrap();
        assert!(call(
            &coordinator,
            "e",
            "rotor_connect",
            json!({"owner":"hamlib","mode":"managed"})
        )
        .is_ok());
    }

    #[test]
    fn stale_generation_and_legacy_bypass_are_rejected() {
        let coordinator = RotorCoordinator::new();
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"hamlib"}),
        )
        .unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        assert!(call(
            &coordinator,
            "b",
            "rotor_goto",
            json!({"owner":"hamlib","generation":generation+1,"bearing":90})
        )
        .is_err());
        assert!(call(
            &coordinator,
            "c",
            "station_rotor_connect",
            json!({"provider":"direct_agent","host":"fixture.invalid","port":4001})
        )
        .is_err());
        assert!(call(
            &coordinator,
            "d",
            "station_rotor_goto",
            json!({"provider":"direct_agent","bearing":90})
        )
        .is_err());
        assert!(call(
            &coordinator,
            "d2",
            "hamlib_control",
            json!({"device":"rotor","action":"goto","azimuth":90})
        )
        .is_err());
        assert!(call(
            &coordinator,
            "d3",
            "hamlib_disconnect",
            json!({"device":"rotor"})
        )
        .is_err());
        let mapped = call(
            &coordinator,
            "e",
            "rotor_goto",
            json!({"owner":"hamlib","generation":generation,"bearing":90}),
        )
        .unwrap();
        assert_eq!(mapped["result"]["backend"]["params"]["action"], "goto");
        assert!(mapped["result"]["generation"].as_u64().unwrap() > generation);
    }

    #[test]
    fn uncertain_connect_keeps_owner_until_explicit_retirement() {
        let coordinator = RotorCoordinator::new();
        let failed = coordinator.handle(
            envelope("a", "rotor_connect", json!({"owner":"native_dcu1"})),
            |_| Ok(json!({"id":"a","ok":false,"error":{"message":"connection uncertain"}})),
        );
        assert!(failed.is_err());
        assert!(call(
            &coordinator,
            "b",
            "rotor_connect",
            json!({"owner":"hamlib"})
        )
        .is_err());
        let snapshot = call(&coordinator, "c", "rotor_snapshot", json!({})).unwrap();
        assert_eq!(snapshot["result"]["state"], "uncertain");
        let generation = snapshot["result"]["generation"].as_u64().unwrap();
        call(
            &coordinator,
            "d",
            "rotor_disconnect",
            json!({"owner":"native_dcu1","generation":generation}),
        )
        .unwrap();
        assert!(call(
            &coordinator,
            "e",
            "rotor_connect",
            json!({"owner":"hamlib"})
        )
        .is_ok());
    }

    #[test]
    fn stop_invalidates_old_motion_intent_even_when_reply_is_lost() {
        let coordinator = RotorCoordinator::new();
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"native_dcu1"}),
        )
        .unwrap();
        let before = connected["result"]["generation"].as_u64().unwrap();
        let stopped = coordinator.handle(
            envelope(
                "b",
                "rotor_stop",
                json!({
                    "owner":"native_dcu1","generation":before
                }),
            ),
            |_| Err("lost stop reply".into()),
        );
        assert!(stopped.is_err());
        let snapshot = call(&coordinator, "c", "rotor_snapshot", json!({})).unwrap();
        let after = snapshot["result"]["generation"].as_u64().unwrap();
        assert!(after > before);
        assert_eq!(snapshot["result"]["state"], "uncertain");
        assert!(call(
            &coordinator,
            "d",
            "rotor_goto",
            json!({
                "owner":"native_dcu1","generation":before,"bearing":90
            })
        )
        .is_err());
        assert!(call(
            &coordinator,
            "e",
            "station_rotor_goto",
            json!({
                "provider":"direct_agent","bearing":90
            })
        )
        .is_err());
        assert!(call(
            &coordinator,
            "f",
            "rotor_stop",
            json!({
                "owner":"native_dcu1","generation":after
            })
        )
        .is_ok());
    }

    #[test]
    fn manual_turn_fences_pending_same_owner_auto_intent_before_backend_dispatch() {
        let coordinator = Arc::new(RotorCoordinator::new());
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"native_dcu1"}),
        )
        .unwrap();
        let old_generation = connected["result"]["generation"].as_u64().unwrap();

        // The automatic lookup captured its intent before the operator's
        // manual turn, but resolves and reaches the host afterwards.
        let (release_tx, release_rx) = mpsc::channel();
        let pending = Arc::clone(&coordinator);
        let automatic = std::thread::spawn(move || {
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            pending.handle(
                envelope(
                    "auto",
                    "rotor_goto",
                    json!({"owner":"native_dcu1","generation":old_generation,"bearing":75}),
                ),
                |_| panic!("stale automatic turn reached the rotor backend"),
            )
        });

        let manual = call(
            &coordinator,
            "manual",
            "rotor_goto",
            json!({"owner":"native_dcu1","generation":old_generation,"bearing":120}),
        )
        .unwrap();
        let new_generation = manual["result"]["generation"].as_u64().unwrap();
        assert!(new_generation > old_generation);
        release_tx.send(()).unwrap();
        assert!(automatic.join().unwrap().is_err());
        let snapshot = call(&coordinator, "state", "rotor_snapshot", json!({})).unwrap();
        assert_eq!(snapshot["result"]["generation"], new_generation);
    }

    #[test]
    fn automatic_intent_id_is_correlated_only_to_its_accepted_motion() {
        let coordinator = RotorCoordinator::new();
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"hamlib"}),
        )
        .unwrap();
        let before = connected["result"]["generation"].as_u64().unwrap();
        assert_eq!(connected["result"]["intent_id"], Value::Null);
        let auto = call(
            &coordinator,
            "auto",
            "rotor_goto",
            json!({"owner":"hamlib","generation":before,"bearing":75,
                   "intent_id":"7fa9a624-4f41-4cb9-bf5e-01976afe9254"}),
        )
        .unwrap();
        let after_auto = auto["result"]["generation"].as_u64().unwrap();
        assert_eq!(after_auto, before + 1);
        assert_eq!(
            auto["result"]["intent_id"],
            "7fa9a624-4f41-4cb9-bf5e-01976afe9254"
        );
        assert!(auto["result"]["backend"]["params"]
            .get("intent_id")
            .is_none());
        let observed = call(&coordinator, "observed", "rotor_snapshot", json!({})).unwrap();
        assert_eq!(observed["result"]["intent_id"], auto["result"]["intent_id"]);

        let manual = call(
            &coordinator,
            "manual",
            "rotor_goto",
            json!({"owner":"hamlib","generation":after_auto,"bearing":120}),
        )
        .unwrap();
        let after_manual = manual["result"]["generation"].as_u64().unwrap();
        assert_eq!(manual["result"]["intent_id"], Value::Null);
        assert!(call(
            &coordinator,
            "stale-auto",
            "rotor_goto",
            json!({"owner":"hamlib","generation":before,"bearing":90,
                   "intent_id":"7fa9a624-4f41-4cb9-bf5e-01976afe9254"}),
        )
        .is_err());
        let parked = call(
            &coordinator,
            "park",
            "rotor_park",
            json!({"owner":"hamlib","generation":after_manual}),
        )
        .unwrap();
        assert_eq!(parked["result"]["intent_id"], Value::Null);
    }

    #[test]
    fn invalid_intent_ids_are_rejected_before_backend_dispatch() {
        let coordinator = RotorCoordinator::new();
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"native_dcu1"}),
        )
        .unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        for bad in [
            json!(""),
            json!("x".repeat(129)),
            json!("bad\nline"),
            json!(7),
        ] {
            assert!(coordinator
                .handle(
                    envelope(
                        "bad",
                        "rotor_goto",
                        json!({"owner":"native_dcu1","generation":generation,
                               "bearing":90,"intent_id":bad}),
                    ),
                    |_| panic!("invalid intent reached rotor backend"),
                )
                .is_err());
        }
        let current = call(&coordinator, "state", "rotor_snapshot", json!({})).unwrap();
        assert_eq!(current["result"]["generation"], generation);
        assert_eq!(current["result"]["intent_id"], Value::Null);
    }

    #[test]
    fn lost_goto_reply_still_fences_old_motion_and_requires_stop() {
        let coordinator = RotorCoordinator::new();
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"hamlib"}),
        )
        .unwrap();
        let before = connected["result"]["generation"].as_u64().unwrap();
        let result = coordinator.handle(
            envelope(
                "manual",
                "rotor_goto",
                json!({"owner":"hamlib","generation":before,"bearing":120,"elevation":20,
                       "intent_id":"lost-auto"}),
            ),
            |_| Err("lost turn reply".into()),
        );
        assert!(result.is_err());
        let snapshot = call(&coordinator, "state", "rotor_snapshot", json!({})).unwrap();
        let after = snapshot["result"]["generation"].as_u64().unwrap();
        assert!(after > before);
        assert_eq!(snapshot["result"]["state"], "uncertain");
        assert_eq!(snapshot["result"]["intent_id"], "lost-auto");
        assert!(call(
            &coordinator,
            "auto",
            "rotor_goto",
            json!({"owner":"hamlib","generation":before,"bearing":75}),
        )
        .is_err());
        assert!(call(
            &coordinator,
            "stop",
            "rotor_stop",
            json!({"owner":"hamlib","generation":after}),
        )
        .is_ok());
    }

    #[test]
    fn replacement_connection_invalidates_old_generation_without_replaying_turn() {
        let coordinator = RotorCoordinator::new();
        call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"hamlib"}),
        )
        .unwrap();
        let before = call(&coordinator, "b", "rotor_snapshot", json!({})).unwrap()["result"]
            ["generation"]
            .as_u64()
            .unwrap();
        call(
            &coordinator,
            "c",
            "rotor_disconnect",
            json!({"owner":"hamlib","generation":before}),
        )
        .unwrap();
        call(
            &coordinator,
            "c2",
            "rotor_connect",
            json!({"owner":"hamlib"}),
        )
        .unwrap();
        let after = call(&coordinator, "d", "rotor_snapshot", json!({})).unwrap()["result"]
            ["generation"]
            .as_u64()
            .unwrap();
        assert!(after > before);
        assert!(call(
            &coordinator,
            "e",
            "rotor_goto",
            json!({"owner":"hamlib",
            "generation":before,"bearing":30})
        )
        .is_err());
        assert!(call(
            &coordinator,
            "f",
            "hamlib_control",
            json!({"device":"rotor","action":"goto","azimuth":30})
        )
        .is_err());
    }

    #[test]
    fn same_owner_native_replacement_rejects_old_legacy_and_versioned_turns() {
        let coordinator = RotorCoordinator::new();
        let first = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"native_dcu1"}),
        )
        .unwrap();
        let old_generation = first["result"]["generation"].as_u64().unwrap();
        call(
            &coordinator,
            "b",
            "rotor_disconnect",
            json!({
                "owner":"native_dcu1","generation":old_generation
            }),
        )
        .unwrap();
        let second = call(
            &coordinator,
            "c",
            "rotor_connect",
            json!({"owner":"native_dcu1"}),
        )
        .unwrap();
        let new_generation = second["result"]["generation"].as_u64().unwrap();
        assert!(new_generation > old_generation);
        assert!(call(
            &coordinator,
            "d",
            "rotor_goto",
            json!({
                "owner":"native_dcu1","generation":old_generation,"bearing":90
            })
        )
        .is_err());
        assert!(call(
            &coordinator,
            "e",
            "station_rotor_goto",
            json!({
                "provider":"direct_agent","bearing":90
            })
        )
        .is_err());
    }

    #[test]
    fn azimuth_elevation_and_park_are_preserved_for_hamlib_only() {
        let coordinator = RotorCoordinator::new();
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"hamlib"}),
        )
        .unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        let moved = call(
            &coordinator,
            "b",
            "rotor_goto",
            json!({"owner":"hamlib",
            "generation":generation,"bearing":125,"elevation":42}),
        )
        .unwrap();
        assert_eq!(moved["result"]["backend"]["params"]["azimuth"], 125);
        assert_eq!(moved["result"]["backend"]["params"]["elevation"], 42);
        let moved_generation = moved["result"]["generation"].as_u64().unwrap();
        let parked = call(
            &coordinator,
            "c",
            "rotor_park",
            json!({"owner":"hamlib",
            "generation":moved_generation}),
        )
        .unwrap();
        assert_eq!(parked["result"]["backend"]["params"]["action"], "park");
        assert!(parked["result"]["generation"].as_u64().unwrap() > moved_generation);
        let native = RotorCoordinator::new();
        let connected = call(
            &native,
            "d",
            "rotor_connect",
            json!({"owner":"native_dcu1"}),
        )
        .unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        assert!(call(
            &native,
            "e",
            "rotor_goto",
            json!({"owner":"native_dcu1",
            "generation":generation,"bearing":125,"elevation":42})
        )
        .is_err());
        assert!(call(
            &native,
            "f",
            "rotor_park",
            json!({"owner":"native_dcu1",
            "generation":generation})
        )
        .is_err());
    }

    #[test]
    fn slow_snapshot_cannot_delay_stop_or_publish_pre_stop_readback() {
        let coordinator = Arc::new(RotorCoordinator::new());
        let connected = call(
            &coordinator,
            "a",
            "rotor_connect",
            json!({"owner":"native_dcu1"}),
        )
        .unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let slow = Arc::clone(&coordinator);
        let snapshot_thread = std::thread::spawn(move || {
            slow.handle(envelope("b", "rotor_snapshot", json!({})), |request| {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                Ok(success(
                    request["id"].as_str().unwrap(),
                    json!({"azimuth":12}),
                ))
            })
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let (stop_tx, stop_rx) = mpsc::channel();
        let stopping = Arc::clone(&coordinator);
        let stop_thread = std::thread::spawn(move || {
            let result = call(
                &stopping,
                "c",
                "rotor_stop",
                json!({
                    "owner":"native_dcu1","generation":generation
                }),
            );
            stop_tx.send(result).unwrap();
        });
        let stopped = stop_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("Stop was blocked by a readback")
            .unwrap();
        assert!(stopped["result"]["generation"].as_u64().unwrap() > generation);
        release_tx.send(()).unwrap();
        let stale = snapshot_thread.join().unwrap().unwrap();
        stop_thread.join().unwrap();
        assert_eq!(stale["result"]["backend"], Value::Null);
        assert_eq!(stale["result"]["backend_available"], false);
    }
}
