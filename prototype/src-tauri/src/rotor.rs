use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

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
    last_observed: Option<Instant>,
}

/// This is the sole in-process rotor ingress. The lock serializes retirement
/// with commands; it never grants a second owner after an uncertain connect or
/// disconnect. It does not assert that physical movement has ceased.
pub struct RotorCoordinator {
    state: Mutex<State>,
    automatic: Arc<crate::auto_rotor::AutomaticRotor>,
}

impl RotorCoordinator {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(State::default()),
            automatic: crate::auto_rotor::owner().clone(),
        }
    }
    #[cfg(test)]
    pub(crate) fn with_authority(automatic: Arc<crate::auto_rotor::AutomaticRotor>) -> Self {
        Self { state: Mutex::new(State::default()), automatic }
    }

    pub fn handle<F>(&self, request: Value, backend: F) -> Result<Value, String>
    where
        F: FnOnce(Value) -> Result<Value, String>,
    {
        self.handle_scoped(request, None, false, None, backend)
    }

    pub(crate) fn handle_automatic<F>(&self, request: Value, permit: &crate::auto_rotor::Permit, backend: F) -> Result<Value, String>
    where F: FnOnce(Value) -> Result<Value, String> {
        self.handle_scoped(request, Some(permit), false, None, backend)
    }

    fn handle_scoped<F>(&self, request: Value, automatic: Option<&crate::auto_rotor::Permit>, startup: bool,
        startup_observation: Option<u64>, backend: F) -> Result<Value, String>
    where F: FnOnce(Value) -> Result<Value, String> {
        let id = request["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or("Invalid request ID")?
            .to_owned();
        let id = id.as_str();
        let requested_method = request["method"].as_str().ok_or("Method is required")?;
        // Internal native-only Stop ingress; worker_request never allowlists it.
        let monitor_stop = requested_method == "monitor_rotor_stop";
        let method = if monitor_stop { "rotor_stop" } else { requested_method };
        let params = request["params"]
            .as_object()
            .ok_or("Parameters must be an object")?;
        if monitor_stop && (params.len() != 1 || !params.contains_key("owner")) {
            return Err("Native Monitor Stop accepts only its observed owner".into());
        }
        // Bootstrap connect is part of the saved startup Arm transaction. It
        // cannot move and must not revoke the epoch reserved before webviews.
        let manual = !startup && automatic.is_none() && matches!(method, "rotor_connect" | "rotor_disconnect" | "rotor_goto" | "rotor_park" | "rotor_stop");
        // Revoke queued automatic work before waiting behind driver transport.
        // A turn already admitted under the lock remains ordered before Stop.
        if manual { self.automatic.revoke(); }
        let mut state = self.state.lock().map_err(|_| "Rotor owner lock failed")?;
        if startup && (method != "rotor_connect" || state.owner.is_some()) {
            return Err("Rotor owner changed; startup connection was not sent.".into());
        }
        if startup_observation.is_some() && method != "rotor_snapshot" {
            return Err("Automatic rotor startup observation is passive.".into());
        }
        // Also revoke at actual manual admission: an explicit Arm interleaved
        // while this command waited cannot survive the ensuing manual action.
        if manual { self.automatic.revoke(); }
        if automatic.is_some() && method != "rotor_goto" { return Err("Automatic rotor permission only admits a turn.".into()); }

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
            let mut current = self.state.lock().map_err(|_| "Rotor owner lock failed")?;
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
            if owner.is_some() {
                if backend_available && observed_connection(owner.unwrap(), backend_result.as_ref().unwrap()) {
                    current.last_observed = Some(Instant::now());
                } else {
                    current.last_observed = None;
                    // Only the untouched, disarmed startup reservation gets a
                    // readiness grace period. An intervening Arm or Off changes
                    // authority, so this failed telemetry must revoke normally.
                    if !startup_observation.is_some_and(|epoch| self.automatic.disarmed_at_epoch(epoch)) {
                        self.automatic.revoke();
                    }
                }
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
                state.last_observed = None;
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
            let expected = if monitor_stop { state.generation } else { params["generation"]
                .as_u64()
                .ok_or("Rotor generation is required")? };
            if expected != state.generation {
                return Err("Rotor generation changed; refresh before sending a command".into());
            }
            if automatic.is_none() && method == "rotor_goto" && !automatic_observation(&state) {
                return Err("Refresh the current rotor observation before manual Goto.".into());
            }
            let target_bearing = (method == "rotor_goto").then(|| params.get("bearing").cloned().unwrap_or(Value::Null));
            let target_label = (method == "rotor_goto").then(|| params.get("label").cloned().unwrap_or(Value::Null));
            let (backend_method, backend_params) = map_new(method, owner, params)?;
            // This is automatic motion's linearization point. It never holds
            // the authority mutex while waiting for this serialized driver.
            if automatic.is_some_and(|permit| !permit.admits() || !automatic_observation(&state)) {
                return Err("Automatic rotor permission changed before driver admission.".into());
            }
            if method == "rotor_disconnect" {
                state.phase = Some(Phase::Uncertain);
                state.last_observed = None;
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
                 "target_bearing":target_bearing,
                 "target_label":target_label,
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

    pub(crate) fn automatic_owner(&self) -> Result<Option<(String, u64)>, String> {
        let state = self.state.try_lock().map_err(|_| "Rotor is busy; automatic turn was not queued.")?;
        Ok(state.owner.filter(|_| automatic_observation(&state)).map(|owner| (owner.name().to_owned(), state.generation)))
    }
    pub(crate) fn with_automatic_owner<T>(&self, owner: &str, generation: u64, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let state = self.state.try_lock().map_err(|_| "Rotor is busy; observe it before arming automatic turns.")?;
        if state.owner.map(Owner::name) != Some(owner) || state.generation != generation || !automatic_observation(&state) {
            return Err("Observe the current connected rotor before arming automatic turns.".into());
        }
        action()
    }
}

fn automatic_observation(state: &State) -> bool {
    state.phase == Some(Phase::Active) && state.last_observed.is_some_and(|observed| observed.elapsed() <= Duration::from_secs(5))
}
fn observed_connection(owner: Owner, backend: &Value) -> bool {
    let number = |value: &Value| value.as_f64().or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
        .is_some_and(|value| value.is_finite() && (0.0..=360.0).contains(&value));
    match owner {
        Owner::NativeDcu1 => backend["connected"] == true && number(&backend["azimuth"]),
        Owner::Hamlib => number(&backend["fields"]["position"]["Azimuth"]),
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

fn coordinator() -> &'static RotorCoordinator {
    static COORDINATOR: OnceLock<RotorCoordinator> = OnceLock::new();
    COORDINATOR.get_or_init(RotorCoordinator::new)
}
fn dispatch(request: Value) -> Result<Value, String> {
    if request["method"].as_str().is_some_and(|method| method.starts_with("hamlib_")) {
        hamlib::request(request)
    } else {
        worker::request(request)
    }
}
pub fn request(request: Value) -> Result<Value, String> {
    coordinator().handle(request, dispatch)
}
pub(crate) fn request_manual_generation(request: Value, expected_worker: u64) -> Result<Value, String> {
    coordinator().handle(request, |request| dispatch_manual_generation(request, expected_worker,
        || Ok(worker::generation()), worker::request_existing_generation, hamlib::request))
}
pub(crate) fn request_startup(request: Value) -> Result<Value, String> {
    coordinator().handle_scoped(request, None, true, None, dispatch)
}
pub(crate) fn request_startup_with(
    request: Value,
    dispatch: impl FnOnce(Value) -> Result<Value, String>,
) -> Result<Value, String> {
    coordinator().handle_scoped(request, None, true, None, dispatch)
}
pub(crate) fn request_startup_observation(request: Value, expected_epoch: u64) -> Result<Value, String> {
    coordinator().handle_scoped(request, None, false, Some(expected_epoch), dispatch)
}
pub(crate) fn worker_restarted() -> Result<(), String> {
    crate::auto_rotor::revoke();
    let mut state = coordinator().state.lock().map_err(|_| "Rotor owner lock failed")?;
    state.owner = None;
    state.phase = None;
    state.intent_id = None;
    state.last_observed = None;
    state.generation = state.generation.saturating_add(1);
    state.revision = state.revision.saturating_add(1);
    Ok(())
}
pub(crate) fn automatic_owner() -> Result<Option<(String, u64)>, String> { coordinator().automatic_owner() }
pub(crate) fn with_automatic_owner<T>(owner: &str, generation: u64, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    coordinator().with_automatic_owner(owner, generation, action)
}
pub(crate) fn request_automatic_generation(permit: &crate::auto_rotor::Permit, bearing: f64, expected_worker: u64) -> Result<Value, String> {
    let reply = coordinator().handle_automatic(permit.request(bearing)?, permit, |request| {
        dispatch_generation(request, expected_worker, || {
            worker::require_existing_generation(expected_worker)?;
            Ok(worker::generation())
        }, worker::request_existing_generation, hamlib::request)
    })?;
    Ok(reply["result"].clone())
}

fn dispatch_generation(request: Value, expected: u64, current: impl FnOnce() -> Result<u64, String>,
    native: impl FnOnce(Value, u64) -> Result<Value, String>, local: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
    // This check runs inside the coordinator's actual serialized dispatch, not
    // before waiting for it. The native transport additionally pins its exact
    // existing Session, closing replacement between this check and worker I/O.
    if expected == 0 || current()? != expected { return Err("Worker generation changed; automatic rotor turn was not sent.".into()); }
    if request["method"].as_str().is_some_and(|method| method.starts_with("hamlib_")) {
        local(request)
    } else {
        native(request, expected)
    }
}

fn dispatch_manual_generation(request: Value, expected: u64, current: impl FnOnce() -> Result<u64, String>,
    native: impl FnOnce(Value, u64) -> Result<Value, String>, local: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
    if request["method"].as_str().is_some_and(|method| method.starts_with("hamlib_")) { return local(request); }
    if expected == 0 || current()? != expected { return Err("Worker generation changed; manual rotor Goto was not sent.".into()); }
    native(request, expected)
}

pub fn monitor_stop(owner: &str) -> Result<Value, String> {
    request(envelope(&uuid::Uuid::new_v4().to_string(), "monitor_rotor_stop", json!({"owner":owner})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn startup_connection_is_fenced_by_an_owner_and_cannot_be_motion() {
        let coordinator = RotorCoordinator::new();
        let connect = json!({"id":"startup","method":"rotor_connect",
            "params":{"owner":"native_dcu1","host":"rotor.example.invalid","port":4001,"name":"ARCO"}});
        coordinator.handle_scoped(connect.clone(), None, true, None, |request| {
            assert_eq!(request["method"], "station_rotor_connect");
            assert_eq!(request["params"], json!({"provider":"direct_agent","host":"rotor.example.invalid","port":4001,"name":"ARCO"}));
            Ok(success("startup", json!({"connected":false})))
        }).unwrap();
        assert!(coordinator.handle_scoped(connect.clone(), None, true, None, |_| panic!("Second startup connection")).is_err());
        let fresh = RotorCoordinator::new();
        for method in ["rotor_goto", "rotor_stop", "rotor_park", "rotor_disconnect"] {
            assert!(fresh.handle_scoped(json!({"id":"motion","method":method,"params":{"owner":"native_dcu1","generation":0,"bearing":90}}),
                None, true, None, |_| panic!("Startup issued motion")).is_err());
        }
    }

    #[test]
    fn startup_connection_preserves_reserved_arm_but_explicit_connect_revokes_it() {
        let startup_authority = Arc::new(crate::auto_rotor::AutomaticRotor::testing());
        startup_authority.arm("native_dcu1", 7).unwrap();
        let startup = RotorCoordinator::with_authority(startup_authority.clone());
        let connect = json!({"id":"startup","method":"rotor_connect",
            "params":{"owner":"native_dcu1","host":"rotor.example.invalid","port":4001,"name":"ARCO"}});
        startup.handle_scoped(connect.clone(), None, true, None, |request| {
            Ok(success(request["id"].as_str().unwrap(), json!({"connected":true})))
        }).unwrap();
        assert!(startup_authority.test_armed());

        let manual_authority = Arc::new(crate::auto_rotor::AutomaticRotor::testing());
        manual_authority.arm("native_dcu1", 7).unwrap();
        let manual = RotorCoordinator::with_authority(manual_authority.clone());
        manual.handle(connect, |_| Ok(success("startup", json!({"connected":true})))).unwrap();
        assert!(!manual_authority.test_armed());
    }

    #[test]
    fn startup_observation_preserves_exact_disarmed_epoch_but_an_ordinary_failure_revokes() {
        let authority = Arc::new(crate::auto_rotor::AutomaticRotor::testing());
        let startup_epoch = authority.test_epoch();
        let coordinator = RotorCoordinator::with_authority(authority.clone());
        let connect = json!({"id":"startup","method":"rotor_connect",
            "params":{"owner":"native_dcu1","host":"rotor.example.invalid","port":4001,"name":"ARCO"}});
        coordinator.handle_scoped(connect, None, true, None, |request| {
            Ok(success(request["id"].as_str().unwrap(), json!({"connected":true})))
        }).unwrap();

        let snapshot = json!({"id":"observe","method":"rotor_snapshot","params":{}});
        let pending = coordinator.handle_scoped(snapshot.clone(), None, false, Some(startup_epoch),
            |_| Err("DCU-1 is still starting".into())).unwrap();
        assert_eq!(pending["result"]["backend_available"], false);
        assert!(!authority.test_armed());
        assert!(coordinator.handle_scoped(json!({"id":"motion","method":"rotor_stop",
            "params":{"owner":"native_dcu1","generation":1}}), None, false, Some(startup_epoch),
            |_| panic!("Startup observation issued motion")).is_err());

        authority.arm("native_dcu1", 7).unwrap();
        coordinator.handle(snapshot, |_| Err("DCU-1 stopped responding".into())).unwrap();
        assert!(!authority.test_armed());
    }

    #[test]
    fn explicit_arm_between_startup_observations_is_revoked_by_the_next_failure() {
        let authority = Arc::new(crate::auto_rotor::AutomaticRotor::testing());
        let startup_epoch = authority.test_epoch();
        let coordinator = RotorCoordinator::with_authority(authority.clone());
        let connect = json!({"id":"startup","method":"rotor_connect",
            "params":{"owner":"native_dcu1","host":"rotor.example.invalid","port":4001,"name":"ARCO"}});
        coordinator.handle_scoped(connect, None, true, None, |request| {
            Ok(success(request["id"].as_str().unwrap(), json!({"connected":true})))
        }).unwrap();
        let snapshot = json!({"id":"observe","method":"rotor_snapshot","params":{}});
        coordinator.handle_scoped(snapshot.clone(), None, false, Some(startup_epoch), |request| {
            Ok(success(request["id"].as_str().unwrap(), json!({"connected":true,"azimuth":138})))
        }).unwrap();

        authority.arm("native_dcu1", 1).unwrap();
        coordinator.handle_scoped(snapshot, None, false, Some(startup_epoch), |request| {
            assert_eq!(request["method"], "station_rotor_snapshot");
            Err("DCU-1 telemetry dropped".into())
        }).unwrap();
        assert!(!authority.test_armed());
    }

    #[test]
    fn automatic_dispatch_rejects_replaced_or_absent_worker_before_any_backend() {
        for method in ["station_rotor_goto", "hamlib_control"] {
            for (expected, current) in [(7, 8), (0, 0)] {
                assert!(dispatch_generation(json!({"method":method}), expected, || Ok(current),
                    |_, _| panic!("obsolete native turn"), |_| panic!("obsolete local turn")).is_err());
            }
        }
    }

    #[test]
    fn native_dispatch_keeps_exact_generation_when_replacement_races_after_check() {
        let received = Mutex::new(Vec::new());
        let result = dispatch_generation(json!({"method":"station_rotor_goto","params":{"bearing":90}}), 7, || Ok(7),
            |request, expected| {
                received.lock().unwrap().push((request["method"].clone(), expected));
                // The real existing-generation transport rejects the replacement
                // here. It must not fall back to a generic spawning request.
                assert_eq!(expected, 7); Err("existing worker is now generation 8".into())
            }, |_| panic!("native failure fell back to a different backend"));
        assert!(result.is_err()); assert_eq!(*received.lock().unwrap(), [(json!("station_rotor_goto"), 7)]);
    }

    #[test]
    fn local_dispatch_uses_existing_local_owner_without_contacting_or_starting_worker() {
        let result = dispatch_generation(json!({"method":"hamlib_control","params":{"device":"rotor","action":"goto"}}), 7, || Ok(7),
            |_, _| panic!("local rotor reached Swift transport"), |request| {
                assert_eq!(request["params"]["device"], "rotor"); Ok(json!({"accepted":true}))
            }).unwrap();
        assert_eq!(result["accepted"], true);
    }
    #[test]
    fn manual_dispatch_keeps_hamlib_worker_independent_and_pins_native_generation() {
        let local = dispatch_manual_generation(json!({"method":"hamlib_control"}), 0, || panic!("Hamlib read worker generation"),
            |_,_| panic!("Hamlib reached native worker"), |_| Ok(json!({"state":"accepted"}))).unwrap();
        assert_eq!(local["state"], "accepted");
        assert!(dispatch_manual_generation(json!({"method":"station_rotor_goto"}), 7, || Ok(8),
            |_,_| panic!("stale native worker used"), |_| panic!("native reached Hamlib")).is_err());
        let native = dispatch_manual_generation(json!({"method":"station_rotor_goto"}), 7, || Ok(7),
            |request, generation| { assert_eq!(generation, 7); Ok(request) }, |_| panic!("native reached Hamlib")).unwrap();
        assert_eq!(native["method"], "station_rotor_goto");
    }
    #[test]
    fn retired_worker_rejects_local_turn_even_when_its_generation_counter_has_not_changed() {
        assert!(dispatch_generation(json!({"method":"hamlib_control"}), 7,
            || Err("existing generation 7 is retired".into()), |_, _| panic!("native send"), |_| panic!("local send")).is_err());
    }

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

    fn observe(coordinator: &RotorCoordinator, id: &str, owner: Owner) -> Value {
        let observed = coordinator
            .handle(envelope(id, "rotor_snapshot", json!({})), |request| {
                let result = match owner {
                    Owner::NativeDcu1 => json!({"connected":true,"azimuth":42}),
                    Owner::Hamlib => json!({"fields":{"position":{"Azimuth":"42"}}}),
                };
                Ok(success(request["id"].as_str().unwrap(), result))
            })
            .unwrap();
        assert_eq!(observed["result"]["backend_available"], true);
        observed
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
        observe(&coordinator, "observed", Owner::Hamlib);
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
             json!({"owner":"hamlib","generation":generation,"bearing":90,"label":"Exact target"}),
        )
        .unwrap();
        assert_eq!(mapped["result"]["backend"]["params"]["action"], "goto");
         assert_eq!(mapped["result"]["target_bearing"], 90);
         assert_eq!(mapped["result"]["target_label"], "Exact target");
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
        observe(&coordinator, "observed", Owner::NativeDcu1);

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
        observe(&coordinator, "observed", Owner::Hamlib);
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
        let observed = observe(&coordinator, "observed-after-auto", Owner::Hamlib);
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
        observe(&coordinator, "observed", Owner::Hamlib);
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
        observe(&coordinator, "observed", Owner::Hamlib);
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
    #[test]
    fn native_monitor_stop_uses_current_same_owner_generation_without_presnapshot_or_retries() {
        let coordinator = RotorCoordinator::new();
        assert!(coordinator.handle(envelope("none", "monitor_rotor_stop", json!({"owner":"native_dcu1"})), |_| panic!("no owner reached backend")).is_err());
        let connected = call(&coordinator, "a", "rotor_connect", json!({"owner":"native_dcu1"})).unwrap();
        let first = connected["result"]["generation"].as_u64().unwrap();
        observe(&coordinator, "observed", Owner::NativeDcu1);
        let turned = call(&coordinator, "b", "rotor_goto", json!({"owner":"native_dcu1","generation":first,"bearing":90})).unwrap();
        let generation = turned["result"]["generation"].as_u64().unwrap();
        assert!(coordinator.handle(envelope("wrong", "monitor_rotor_stop", json!({"owner":"hamlib"})), |_| panic!("changed owner reached backend")).is_err());
        assert!(coordinator.handle(envelope("extra", "monitor_rotor_stop", json!({"owner":"native_dcu1","generation":first})), |_| panic!("unexpected parameter reached backend")).is_err());
        let mut calls = 0;
        assert!(coordinator.handle(envelope("stop", "monitor_rotor_stop", json!({"owner":"native_dcu1"})), |request| {
            calls += 1; assert_eq!(request["method"], "station_rotor_stop"); Err("lost Stop reply".into())
        }).is_err());
        assert_eq!(calls, 1);
        let current = coordinator.state.lock().unwrap();
        assert!(current.generation > generation); assert_eq!(current.phase, Some(Phase::Uncertain));
        let generation = current.generation; drop(current);
        call(&coordinator, "disconnect", "rotor_disconnect", json!({"owner":"native_dcu1","generation":generation})).unwrap();
        call(&coordinator, "replace", "rotor_connect", json!({"owner":"hamlib"})).unwrap();
        assert!(coordinator.handle(envelope("obsolete", "monitor_rotor_stop", json!({"owner":"native_dcu1"})), |_| panic!("retired owner reached backend")).is_err());
    }
    #[test]
    fn native_monitor_stop_can_pass_an_inflight_snapshot_without_device_read_of_its_own() {
        let coordinator = Arc::new(RotorCoordinator::new());
        call(&coordinator, "a", "rotor_connect", json!({"owner":"native_dcu1"})).unwrap();
        let (started_tx, started_rx) = mpsc::channel(); let (release_tx, release_rx) = mpsc::channel();
        let reading = coordinator.clone();
        let snapshot = std::thread::spawn(move || reading.handle(envelope("read", "rotor_snapshot", json!({})), |request| {
            started_tx.send(()).unwrap(); release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            Ok(success(request["id"].as_str().unwrap(), json!({"azimuth":12})))
        }));
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let stopped = coordinator.handle(envelope("stop", "monitor_rotor_stop", json!({"owner":"native_dcu1"})), |request| {
            assert_eq!(request["method"], "station_rotor_stop"); Ok(success("stop", json!({"accepted":true})))
        }).unwrap();
        assert_eq!(stopped["result"]["state"], "active"); release_tx.send(()).unwrap();
        assert_eq!(snapshot.join().unwrap().unwrap()["result"]["backend_available"], false);
    }
    #[test]
    fn failed_snapshot_revokes_same_generation_manual_goto_before_motion_dispatch() {
        let coordinator = RotorCoordinator::new();
        let connected = call(&coordinator, "connect", "rotor_connect", json!({"owner":"native_dcu1"})).unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        coordinator.handle(envelope("observed", "rotor_snapshot", json!({})), |request|
            Ok(success(request["id"].as_str().unwrap(), json!({"connected":true,"azimuth":42})))).unwrap();
        assert!(automatic_observation(&coordinator.state.lock().unwrap()));
        let failed = coordinator.handle(envelope("failed", "rotor_snapshot", json!({})), |_| Err("snapshot unavailable".into())).unwrap();
        assert_eq!(failed["result"]["generation"], generation); assert_eq!(failed["result"]["backend_available"], false);
        assert!(!automatic_observation(&coordinator.state.lock().unwrap()));
        let motion_calls = std::sync::atomic::AtomicUsize::new(0);
        assert!(coordinator.handle(envelope("goto", "rotor_goto", json!({"owner":"native_dcu1","generation":generation,"bearing":90})), |_| {
            motion_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst); Ok(success("goto", json!({"accepted":true})))
        }).is_err());
        assert_eq!(motion_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
    #[test]
    fn native_monitor_stop_preserves_serialized_driver_order_behind_a_pending_goto() {
        let coordinator = Arc::new(RotorCoordinator::new());
        let connected = call(&coordinator, "connect", "rotor_connect", json!({"owner":"native_dcu1"})).unwrap();
        let generation = connected["result"]["generation"].as_u64().unwrap();
        observe(&coordinator, "observed", Owner::NativeDcu1);
        let order = Arc::new(Mutex::new(Vec::new()));
        let (entered_tx, entered_rx) = mpsc::channel(); let (release_tx, release_rx) = mpsc::channel();
        let turning = coordinator.clone(); let turns = order.clone();
        let goto = std::thread::spawn(move || turning.handle(envelope("goto", "rotor_goto", json!({"owner":"native_dcu1","generation":generation,"bearing":90})), |request| {
            turns.lock().unwrap().push(request["method"].as_str().unwrap().to_owned()); entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap(); Ok(success("goto", json!({"accepted":true})))
        }));
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let (started_tx, started_rx) = mpsc::channel(); let (sent_tx, sent_rx) = mpsc::channel();
        let stopping = coordinator.clone(); let stops = order.clone();
        let stop = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            stopping.handle(envelope("stop", "monitor_rotor_stop", json!({"owner":"native_dcu1"})), |request| {
                stops.lock().unwrap().push(request["method"].as_str().unwrap().to_owned()); sent_tx.send(()).unwrap();
                Ok(success("stop", json!({"accepted":true})))
            })
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap(); assert!(sent_rx.try_recv().is_err());
        release_tx.send(()).unwrap(); goto.join().unwrap().unwrap(); stop.join().unwrap().unwrap();
        assert_eq!(*order.lock().unwrap(), ["station_rotor_goto", "station_rotor_stop"]);
    }
}
