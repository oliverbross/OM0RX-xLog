//! Read-only radio telemetry. Never substitutes for explicit command readback.
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
type Read = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn(Value) + Send + Sync;

pub fn valid_provider(provider: &str) -> bool {
    matches!(provider, "direct_agent" | "direct_flex_lan" | "hamlib")
}
pub fn validate(label: &str, isolated: bool, selection: bool) -> Result<(), String> {
    if isolated || !(label == "main" || !selection && label == "monitor") {
        return Err("Radio telemetry is unavailable in this window.".into());
    }
    Ok(())
}
pub fn changes_radio(request: &Value) -> bool {
    let method = request["method"].as_str().unwrap_or("");
    if method.starts_with("station_rotor_") {
        return false;
    }
    if method.starts_with("station_") {
        return !matches!(
            method,
            "station_snapshot"
                | "station_radio"
                | "station_capabilities"
                | "station_configuration"
                | "station_add_spot"
        );
    }
    request["params"]["device"] == "radio"
        && matches!(
            method,
            "hamlib_connect" | "hamlib_reconnect" | "hamlib_disconnect" | "hamlib_control"
        )
}
struct State {
    provider: Option<String>,
    selection_id: Option<String>,
    selection_generation: Option<u64>,
    epoch: u64,
    revision: u64,
    controls: usize,
    projection: Value,
}
pub struct StationTelemetry {
    read: Arc<Read>,
    publish: Arc<Publish>,
    state: Mutex<State>,
    reading: Mutex<()>,
    started: AtomicBool,
    stopped: AtomicBool,
    wake: (Mutex<()>, Condvar),
}
impl StationTelemetry {
    fn new(read: Arc<Read>, publish: Arc<Publish>) -> Self {
        Self {
            read,
            publish,
            state: Mutex::new(State {
                provider: None,
                selection_id: None,
                selection_generation: None,
                epoch: 0,
                revision: 0,
                controls: 0,
                projection: json!({"revision":0,"available":false,"provider":null,"snapshot":null}),
            }),
            reading: Mutex::new(()),
            started: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            wake: (Mutex::new(()), Condvar::new()),
        }
    }
    #[cfg(test)]
    fn select(&self, provider: &str, initialize_only: bool) -> Result<Value, String> {
        self.select_identity(provider, None, None, initialize_only)
    }
    pub fn select_selection(&self, selection: &Value, initialize_only: bool) -> Result<Value, String> {
        let provider = selection["provider"].as_str().ok_or("Native radio selection is unavailable.")?;
        let id = selection["selection_id"].as_str().filter(|id| uuid::Uuid::parse_str(id).is_ok()).ok_or("Native radio selection identity is invalid.")?;
        let generation = selection["generation"].as_u64().filter(|value| *value <= 9_007_199_254_740_991).ok_or("Native radio selection generation is invalid.")?;
        self.select_identity(provider, Some(id), Some(generation), initialize_only)
    }
    fn select_identity(&self, provider: &str, selection_id: Option<&str>, selection_generation: Option<u64>, initialize_only: bool) -> Result<Value, String> {
        if !valid_provider(provider) {
            return Err("Unknown radio provider.".into());
        }
        if self.stopped.load(Ordering::Acquire) {
            return Err("Radio telemetry has stopped.".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Radio telemetry unavailable")?;
        if selection_generation.zip(state.selection_generation).is_some_and(|(incoming, current)| incoming < current) {
            return Ok(state.projection.clone());
        }
        let newer = selection_generation.zip(state.selection_generation).is_some_and(|(incoming, current)| incoming > current);
        // Listener startup cannot undo a later explicit provider handover.
        if state.provider.is_none() || newer
            || !initialize_only && (state.provider.as_deref() != Some(provider)
                || state.selection_id.as_deref() != selection_id || state.selection_generation != selection_generation)
        {
            state.provider = Some(provider.into());
            state.selection_id = selection_id.map(str::to_owned);
            state.selection_generation = selection_generation;
            state.epoch += 1;
            state.revision += 1;
            state.projection = json!({"revision":state.revision,"available":false,"provider":provider,"snapshot":null,
                "selection_id":state.selection_id,"selection_generation":state.selection_generation});
        }
        Ok(state.projection.clone())
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("Radio telemetry has stopped.".into());
        }
        self.state
            .lock()
            .map(|state| state.projection.clone())
            .map_err(|_| "Radio telemetry unavailable".into())
    }
    pub fn control(self: &Arc<Self>) -> Result<ControlFence, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Radio telemetry unavailable")?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Radio telemetry has stopped.".into());
        }
        state.epoch += 1;
        state.controls += 1;
        // A new subscriber must not mistake a pre-command observation for current.
        state.projection["available"] = json!(false);
        Ok(ControlFence(self.clone()))
    }
    pub fn monitor_control(self: &Arc<Self>, provider: &str, generation: u64, identity: &str, action: &str) -> Result<ControlFence, String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Radio clock unavailable")?.as_millis() as u64;
        self.monitor_control_at(provider, generation, identity, action, now)
    }
    pub fn receive_control(self: &Arc<Self>, generation: u64, identity: &str, connection: u64, control: &str) -> Result<ControlFence, String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Radio clock unavailable")?.as_millis() as u64;
        self.receive_control_at(generation, identity, connection, control, now)
    }
    fn receive_control_at(self: &Arc<Self>, generation: u64, identity: &str, connection: u64, control: &str, now: u64) -> Result<ControlFence, String> {
        let mut state = self.state.lock().map_err(|_| "Radio telemetry unavailable")?;
        let value = &state.projection; let snapshot = &value["snapshot"];
        let provider = state.provider.as_deref().unwrap_or("");
        let (capability_owner, advertised) = match (provider, control) {
            ("direct_flex_lan", "set_frequency_a") => ("capabilities", "set_frequency_a"),
            ("direct_flex_lan", "set_mode_a") => ("capabilities", "set_mode_a"),
            ("direct_agent", "set_receive_frequency_a") => ("station", "set_frequency_hz"),
            ("direct_agent", "set_receive_mode_a") => ("station", "set_mode"),
            ("hamlib", "set_receive_frequency_a") => ("station", "set_receive_frequency_a"),
            ("hamlib", "set_receive_mode_a") => ("station", "set_receive_mode_a"),
            _ => return Err("This provider does not expose the requested exact receive control.".into()),
        };
        let age = value["received_at_ms"].as_u64().map(|time| i128::from(now) - i128::from(time));
        let exact_state = if provider == "hamlib" {
            let observed_age = snapshot["observed_at_ms"].as_u64().map(|time| i128::from(now) - i128::from(time));
            let field_fresh = ["vfo", "ptt"].iter().all(|field| snapshot["field_observed_at_ms"][field].as_u64()
                .map(|time| i128::from(now) - i128::from(time)).is_some_and(|age| (-1000..=5000).contains(&age)));
            snapshot["generation"].as_u64() == Some(connection)
                && observed_age.is_some_and(|age| (-1000..=5000).contains(&age)) && field_fresh
                && snapshot["fields"]["frequency"].is_object() && snapshot["fields"]["mode"].is_object()
                && snapshot["fields"]["vfo"]["VFO"] == "VFOA" && snapshot["fields"]["ptt"]["PTT"] == "0"
        } else {
            let radio = &snapshot["radio"];
            let source_age = snapshot["generated_at"].as_f64().map(|time| now as f64 - time * 1000.0);
            let observed_age = radio["observed_at"].as_f64().map(|time| now as f64 - time * 1000.0);
            source_age.is_some_and(|age| age.is_finite() && age.abs() <= 5000.0)
                && observed_age.is_some_and(|age| age.is_finite() && age.abs() <= 5000.0)
                && snapshot["source"] == provider && snapshot["generation"].as_u64() == Some(connection)
                && radio["connected"] == true && radio["observed"] == true && radio["transmitting"] == false && radio["receive_vfo"] == "A"
                && radio["vfos"].as_array().is_some_and(|vfos| vfos.iter().any(|vfo| vfo["letter"] == "A" && vfo["receive"] == true))
                && snapshot[capability_owner]["supported_commands"].as_array().is_some_and(|commands| commands.iter().any(|command| command == advertised))
        };
        if self.stopped.load(Ordering::Acquire) || state.controls != 0
            || state.selection_id.as_deref() != Some(identity) || state.selection_generation != Some(generation)
            || value["available"] != true || !age.is_some_and(|age| (-1000..=5000).contains(&age))
            || !exact_state {
            return Err("A fresh observed receive VFO A and supported exact control are required.".into());
        }
        state.epoch += 1; state.controls += 1; state.revision += 1;
        state.projection["available"] = json!(false); state.projection["revision"] = json!(state.revision);
        Ok(ControlFence(self.clone()))
    }
    fn monitor_control_at(self: &Arc<Self>, provider: &str, generation: u64, identity: &str, action: &str, now: u64) -> Result<ControlFence, String> {
        let mut state = self.state.lock().map_err(|_| "Radio telemetry unavailable")?;
        if self.stopped.load(Ordering::Acquire) { return Err("Radio telemetry has stopped.".into()); }
        if !matches!(provider, "direct_agent" | "direct_flex_lan") || !matches!(action, "operate" | "standby" | "tune" | "cancel")
            || provider == "direct_flex_lan" && !matches!(action, "tune" | "cancel") { return Err("Monitor action is unavailable.".into()); }
        // The selection owner already holds and validates its exact identity.
        // Cancel cannot initiate TX and must remain reachable during loss or
        // another in-flight action; backend policy still decides the operation.
        if action != "cancel" {
            let value = &state.projection; let snapshot = &value["snapshot"];
            let age = value["received_at_ms"].as_u64().map(|time| i128::from(now) - i128::from(time));
            let source_age = snapshot.get("generated_at").map(|time| time.as_f64().map(|time| now as f64 - time * 1000.0));
            let source_fresh = source_age.is_none() || source_age.is_some_and(|age| age.is_some_and(|age| age.is_finite() && age.abs() <= 5000.0));
            let allowed = if provider == "direct_agent" { &snapshot["station"]["allowed_actions"] } else { &snapshot["capabilities"]["supported_commands"] };
            if state.provider.as_deref() != Some(provider) || state.selection_id.as_deref() != Some(identity) || state.selection_generation != Some(generation)
                || value["available"] != true || !age.is_some_and(|age| (-1000..=5000).contains(&age)) || !source_fresh
                || snapshot["source"] != provider || snapshot["radio"]["connected"] != true || snapshot["radio"]["observed"] != true || snapshot["station"]["radio_stale"] == true
                || !allowed.as_array().is_some_and(|allowed| allowed.iter().any(|value| value == action))
                || action == "tune" && snapshot["allow_transmit"] != true {
                return Err("The native radio observation is stale, changed or does not permit this action.".into());
            }
        }
        state.epoch += 1; state.controls += 1; state.revision += 1;
        state.projection["available"] = json!(false); state.projection["revision"] = json!(state.revision);
        Ok(ControlFence(self.clone()))
    }
    fn refresh(&self) {
        let Ok(_reading) = self.reading.try_lock() else {
            return;
        };
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let (provider, epoch, request) = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if state.controls != 0 {
                return;
            }
            let Some(provider) = state.provider.clone() else {
                return;
            };
            state.revision += 1;
            let id = format!("radio-telemetry-{}", state.revision);
            let request = if provider == "hamlib" {
                json!({"id":id,"method":"hamlib_snapshot","params":{"device":"radio"}})
            } else {
                json!({"id":id,"method":"station_snapshot","params":{"provider":provider}})
            };
            (provider, state.epoch, request)
        };
        let id = request["id"].clone();
        let response = (self.read)(request);
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        // Control completion, provider changes and shutdown fence late reads.
        if state.epoch != epoch
            || state.controls != 0
            || state.provider.as_deref() != Some(&provider)
        {
            return;
        }
        let result = response
            .ok()
            .filter(|reply| reply["ok"] == true && reply["id"] == id)
            .map(|reply| reply["result"].clone())
            .filter(|value| {
                value.is_object() && (provider == "hamlib" || value["source"] == provider)
            });
        let available = result.is_some();
        let snapshot = result.unwrap_or_else(|| state.projection["snapshot"].clone());
        state.projection = json!({"revision":state.revision,"provider":provider,"snapshot":snapshot,"available":available,
            "selection_id":state.selection_id,"selection_generation":state.selection_generation,
            "received_at_ms":SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0)});
        let projection = state.projection.clone();
        drop(state);
        if !self.stopped.load(Ordering::Acquire) {
            (self.publish)(projection);
        }
    }
    fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let owner = self.clone();
        std::thread::spawn(move || {
            while !owner.stopped.load(Ordering::Acquire) {
                owner.refresh();
                let period = owner
                    .state
                    .lock()
                    .ok()
                    .map(|state| {
                        if state.provider.as_deref() == Some("hamlib") {
                            1000
                        } else {
                            250
                        }
                    })
                    .unwrap_or(1000);
                let Ok(guard) = owner.wake.0.lock() else {
                    break;
                };
                let _ =
                    owner
                        .wake
                        .1
                        .wait_timeout_while(guard, Duration::from_millis(period), |_| {
                            !owner.stopped.load(Ordering::Acquire)
                        });
            }
        });
    }
    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.wake.1.notify_all();
    }
}
pub struct ControlFence(Arc<StationTelemetry>);
impl Drop for ControlFence {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.epoch += 1;
            state.controls = state.controls.saturating_sub(1);
        }
    }
}
static OWNER: OnceLock<Arc<StationTelemetry>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);
fn retained(owner: Option<&StationTelemetry>, stopped: bool) -> Result<Value, String> {
    if stopped { return Err("Radio telemetry has stopped.".into()); }
    match owner {
        Some(owner) => owner.snapshot(),
        None => Ok(json!({"revision":0,"available":false,"provider":null,"snapshot":null})),
    }
}
/// Observation children may read only an already existing projection. This
/// path never creates the owner, selects a provider or starts device polling.
pub fn retained_snapshot() -> Result<Value, String> {
    retained(OWNER.get().map(Arc::as_ref), STOPPED.load(Ordering::Acquire))
}
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<StationTelemetry>, String> {
    if STOPPED.load(Ordering::Acquire) {
        return Err("Radio telemetry has stopped.".into());
    }
    let owner = OWNER
        .get_or_init(|| {
            let app = app.clone();
            Arc::new(StationTelemetry::new(
                Arc::new(|request| {
                    if request["method"] == "hamlib_snapshot" {
                        crate::hamlib::request(request)
                    } else {
                        crate::worker::request(request)
                    }
                }),
                Arc::new(move |value| {
                    crate::qsy_clear::observe(&value);
                    let _ = app.emit_to("alerts", "xlog:alerts", ());
                    for label in ["main", "monitor", "world-map", "band-maps", "station-status"] {
                        let _ = app.emit_to(
                            label,
                            "xlog:station-telemetry",
                            json!({"revision":value["revision"]}),
                        );
                    }
                }),
            ))
        })
        .clone();
    if STOPPED.load(Ordering::Acquire) {
        owner.stop();
        return Err("Radio telemetry has stopped.".into());
    }
    owner.start();
    Ok(owner)
}
pub fn shutdown() {
    STOPPED.store(true, Ordering::Release);
    if let Some(owner) = OWNER.get() {
        owner.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reply(request: &Value) -> Value {
        json!({"id":request["id"],"ok":true,"result":{"source":request["params"]["provider"],"radio":{"observed":false}}})
    }
    #[test]
    fn scopes_and_providers_are_explicit() {
        assert!(validate("main", false, true).is_ok());
        assert!(validate("monitor", false, false).is_ok());
        assert!(validate("monitor", false, true).is_err());
        assert!(validate("main", true, false).is_err());
        assert!(validate("logbook", false, false).is_err());
        assert!(!valid_provider("other"));
    }
    #[test]
    fn status_retained_reads_never_create_start_select_or_refresh_a_poller() {
        assert_eq!(retained(None, false).unwrap()["available"], false);
        let owner = StationTelemetry::new(Arc::new(|_| panic!("retained read performed I/O")), Arc::new(|_| {}));
        for _ in 0..20 { assert_eq!(retained(Some(&owner), false).unwrap()["revision"], 0); }
        assert!(!owner.started.load(Ordering::Acquire));
        assert!(owner.state.lock().unwrap().provider.is_none());
        assert!(retained(None, true).is_err()); assert!(retained(Some(&owner), true).is_err());
    }
    #[test]
    fn reads_are_passive_and_startup_cannot_reverse_handover() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let observed = calls.clone();
        let owner = StationTelemetry::new(
            Arc::new(move |request| {
                observed.lock().unwrap().push(request.clone());
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        );
        owner.refresh();
        assert!(calls.lock().unwrap().is_empty());
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        owner.select("hamlib", false).unwrap();
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        let reads = calls.lock().unwrap();
        assert_eq!(reads.len(), 2);
        assert_eq!(reads[0]["method"], "station_snapshot");
        assert_eq!(reads[1]["method"], "hamlib_snapshot");
        assert_eq!(reads[1]["params"], json!({"device":"radio"}));
        assert_eq!(owner.snapshot().unwrap()["provider"], "hamlib");
    }
    #[test]
    fn command_fence_blocks_polling_until_all_controls_finish() {
        let count = Arc::new(Mutex::new(0));
        let calls = count.clone();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                *calls.lock().unwrap() += 1;
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        ));
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        let first = owner.control().unwrap();
        let second = owner.control().unwrap();
        assert_eq!(owner.snapshot().unwrap()["available"], false);
        owner.refresh();
        drop(first);
        owner.refresh();
        assert_eq!(*count.lock().unwrap(), 1);
        drop(second);
        owner.refresh();
        assert_eq!(*count.lock().unwrap(), 2);
    }
    #[test]
    fn same_provider_new_selection_identity_retires_observation_and_stale_bootstrap_cannot_undo_it() {
        let owner = StationTelemetry::new(Arc::new(|request| Ok(reply(&request))), Arc::new(|_| {}));
        let first = json!({"provider":"direct_agent","generation":0,"selection_id":uuid::Uuid::new_v4().to_string()});
        let next = json!({"provider":"direct_agent","generation":2,"selection_id":uuid::Uuid::new_v4().to_string()});
        owner.select_selection(&first, true).unwrap(); owner.refresh();
        assert_eq!(owner.snapshot().unwrap()["available"], true);
        owner.select_selection(&next, false).unwrap();
        assert_eq!(owner.snapshot().unwrap()["available"], false);
        assert_eq!(owner.snapshot().unwrap()["snapshot"], Value::Null);
        owner.select_selection(&first, true).unwrap(); owner.select_selection(&first, false).unwrap();
        assert_eq!(owner.snapshot().unwrap()["selection_id"], next["selection_id"]);
        owner.refresh(); assert_eq!(owner.snapshot().unwrap()["selection_generation"], 2);
    }
    fn monitor_fixture() -> (Arc<StationTelemetry>, String) {
        let owner = Arc::new(StationTelemetry::new(Arc::new(|_| panic!("admission must not perform I/O")), Arc::new(|_| {})));
        let identity = uuid::Uuid::new_v4().to_string();
        owner.select_selection(&json!({"provider":"direct_agent","generation":2,"selection_id":identity}), true).unwrap();
        owner.state.lock().unwrap().projection = json!({"revision":1,"provider":"direct_agent","selection_id":identity,"selection_generation":2,
            "available":true,"received_at_ms":10000,"snapshot":{"source":"direct_agent","generated_at":10.0,"allow_transmit":true,
                "radio":{"connected":true,"observed":true},"station":{"allowed_actions":["operate","standby","tune","cancel"]}}});
        (owner, identity)
    }
    #[test]
    fn native_monitor_admission_checks_freshness_identity_policy_and_transmit_permission_without_io() {
        for change in 0..8 {
            let (owner, identity) = monitor_fixture();
            {
                let mut state = owner.state.lock().unwrap();
                match change {
                    0 => state.projection["received_at_ms"] = json!(4000),
                    1 => state.projection["received_at_ms"] = json!(12000),
                    2 => state.projection["snapshot"]["generated_at"] = json!(1.0),
                    3 => state.projection["snapshot"]["generated_at"] = json!(20.0),
                    4 => state.projection["snapshot"]["allow_transmit"] = json!(false),
                    5 => state.projection["snapshot"]["station"]["allowed_actions"] = json!([]),
                    6 => state.projection["available"] = json!(false),
                    _ => state.selection_id = Some(uuid::Uuid::new_v4().to_string()),
                }
            }
            assert!(owner.monitor_control_at("direct_agent", 2, &identity, "tune", 10000).is_err(), "{change}");
            assert_eq!(owner.state.lock().unwrap().controls, 0);
        }
        let (owner, identity) = monitor_fixture();
        let admission = owner.monitor_control_at("direct_agent", 2, &identity, "tune", 10000).unwrap();
        assert_eq!(owner.snapshot().unwrap()["available"], false);
        assert_eq!(owner.state.lock().unwrap().controls, 1); drop(admission);
        assert_eq!(owner.state.lock().unwrap().controls, 0);
    }
    fn receive_fixture(provider: &str) -> (Arc<StationTelemetry>, String) {
        let (owner, identity) = monitor_fixture();
        let mut state = owner.state.lock().unwrap(); state.provider = Some(provider.into());
        let snapshot = if provider == "hamlib" {
            json!({"generation":13,"observed_at_ms":10000,"field_observed_at_ms":{"frequency":10000,"mode":10000,"vfo":10000,"ptt":10000},
                "fields":{"frequency":{"Frequency":"14074000"},"mode":{"Mode":"USB"},"vfo":{"VFO":"VFOA"},"ptt":{"PTT":"0"}},"errors":{}})
        } else {
            json!({"source":provider,"generation":13,"generated_at":10.0,"radio":{"connected":true,"observed":true,"observed_at":10.0,"transmitting":false,"receive_vfo":"A","vfos":[{"letter":"A","receive":true}]},
                "station":{"supported_commands":["set_frequency_hz","set_mode"]},"capabilities":{"supported_commands":["set_frequency_a","set_mode_a"]}})
        };
        state.projection = json!({"revision":1,"provider":provider,"selection_id":identity,"selection_generation":2,"available":true,"received_at_ms":10000,"snapshot":snapshot});
        drop(state); (owner, identity)
    }
    #[test]
    fn exact_receive_admission_requires_fresh_known_receive_vfo_connection_and_capability_without_io() {
        for change in 0..14 {
            let (owner, identity) = receive_fixture("direct_flex_lan");
            { let mut state = owner.state.lock().unwrap(); match change {
                0 => state.projection["received_at_ms"] = json!(4000),
                1 => state.projection["snapshot"]["generated_at"] = json!(0),
                2 => state.projection["available"] = json!(false),
                3 => state.projection["snapshot"]["generation"] = json!(14),
                4 => state.projection["snapshot"]["radio"]["transmitting"] = Value::Null,
                5 => state.projection["snapshot"]["radio"]["transmitting"] = json!(true),
                6 => state.projection["snapshot"]["radio"]["receive_vfo"] = json!("B"),
                7 => state.projection["snapshot"]["radio"]["vfos"][0]["receive"] = json!(false),
                8 => state.projection["snapshot"]["capabilities"]["supported_commands"] = json!([]),
                9 => state.provider = Some("direct_agent".into()),
                10 => state.selection_id = Some(uuid::Uuid::new_v4().to_string()),
                11 => state.selection_generation = Some(3),
                12 => state.projection["snapshot"]["radio"]["observed_at"] = json!(0),
                _ => state.controls = 1,
            }}
            assert!(owner.receive_control_at(2, &identity, 13, "set_frequency_a", 10000).is_err(), "{change}");
        }
        for (provider, control) in [("direct_flex_lan", "set_frequency_a"), ("direct_flex_lan", "set_mode_a"),
                                    ("direct_agent", "set_receive_frequency_a"), ("direct_agent", "set_receive_mode_a"),
                                    ("hamlib", "set_receive_frequency_a"), ("hamlib", "set_receive_mode_a")] {
            let (owner, identity) = receive_fixture(provider); let fence = owner.receive_control_at(2, &identity, 13, control, 10000).unwrap();
            assert_eq!(owner.snapshot().unwrap()["available"], false); assert!(owner.receive_control_at(2, &identity, 13, control, 10000).is_err()); drop(fence);
            assert_eq!(owner.state.lock().unwrap().controls, 0);
        }
        let (owner, identity) = receive_fixture("direct_flex_lan"); assert!(owner.receive_control_at(2, &identity, 13, "ptt", 10000).is_err());
        assert!(owner.receive_control_at(2, &identity, 13, "set_mode", 10000).is_err());
        for change in ["vfo", "ptt", "frequency", "field_time", "observation_time"] {
            let (owner, identity) = receive_fixture("hamlib");
            { let mut state = owner.state.lock().unwrap(); match change {
                "vfo" => state.projection["snapshot"]["fields"]["vfo"]["VFO"] = json!("VFOB"),
                "ptt" => state.projection["snapshot"]["fields"]["ptt"]["PTT"] = json!("1"),
                "frequency" => state.projection["snapshot"]["fields"]["frequency"] = Value::Null,
                "field_time" => state.projection["snapshot"]["field_observed_at_ms"]["vfo"] = json!(4000),
                _ => state.projection["snapshot"]["observed_at_ms"] = json!(4000),
            }}
            assert!(owner.receive_control_at(2, &identity, 13, "set_receive_frequency_a", 10000).is_err(), "{change}");
        }
    }
    #[test]
    fn monitor_cancel_remains_possible_during_stale_disconnected_or_inflight_observation() {
        let (owner, identity) = monitor_fixture();
        let inflight = owner.control().unwrap();
        owner.state.lock().unwrap().projection["snapshot"] = Value::Null;
        let cancel = owner.monitor_control_at("direct_agent", 2, &identity, "cancel", 100000).unwrap();
        assert_eq!(owner.state.lock().unwrap().controls, 2); drop(cancel); drop(inflight);
        assert_eq!(owner.state.lock().unwrap().controls, 0);
    }
    #[test]
    fn late_pre_command_and_pre_handover_reads_are_discarded() {
        for handover in [false, true] {
            let gate = Arc::new((Mutex::new(false), Condvar::new()));
            let waiting = gate.clone();
            let (sent, received) = std::sync::mpsc::channel();
            let events = Arc::new(Mutex::new(0));
            let count = events.clone();
            let owner = Arc::new(StationTelemetry::new(
                Arc::new(move |request| {
                    sent.send(()).unwrap();
                    let _guard = waiting
                        .1
                        .wait_while(waiting.0.lock().unwrap(), |done| !*done)
                        .unwrap();
                    Ok(reply(&request))
                }),
                Arc::new(move |_| {
                    *count.lock().unwrap() += 1;
                }),
            ));
            owner.select("direct_agent", true).unwrap();
            let source = owner.clone();
            let thread = std::thread::spawn(move || source.refresh());
            received.recv_timeout(Duration::from_secs(2)).unwrap();
            if handover {
                owner.select("direct_flex_lan", false).unwrap();
            } else {
                drop(owner.control().unwrap());
            }
            *gate.0.lock().unwrap() = true;
            gate.1.notify_all();
            thread.join().unwrap();
            assert_eq!(*events.lock().unwrap(), 0);
            assert_eq!(owner.snapshot().unwrap()["available"], false);
        }
    }
    #[test]
    fn failure_retains_display_data_and_stopped_owner_cannot_restart() {
        let fail = Arc::new(AtomicBool::new(false));
        let failing = fail.clone();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                if failing.load(Ordering::Relaxed) {
                    Err("offline".into())
                } else {
                    Ok(reply(&request))
                }
            }),
            Arc::new(|_| {}),
        ));
        owner.select("direct_agent", true).unwrap();
        owner.refresh();
        let prior = owner.snapshot().unwrap();
        fail.store(true, Ordering::Relaxed);
        owner.refresh();
        let current = owner.snapshot().unwrap();
        assert_eq!(current["available"], false);
        assert_eq!(current["snapshot"], prior["snapshot"]);
        owner.stop();
        owner.start();
        owner.refresh();
        assert!(owner.snapshot().is_err());
        assert!(owner.control().is_err());
    }
    #[test]
    fn write_classification_excludes_readbacks_and_rotor() {
        for method in [
            "station_tune",
            "station_connect",
            "station_disconnect",
            "station_radio_control",
            "station_configuration_save",
        ] {
            assert!(changes_radio(&json!({"method":method,"params":{}})));
        }
        for method in [
            "station_snapshot",
            "station_radio",
            "station_capabilities",
            "station_rotor_stop",
            "rotor_goto",
        ] {
            assert!(!changes_radio(&json!({"method":method,"params":{}})));
        }
        assert!(changes_radio(
            &json!({"method":"hamlib_control","params":{"device":"radio"}})
        ));
        assert!(!changes_radio(
            &json!({"method":"hamlib_control","params":{"device":"rotor"}})
        ));
    }

    #[test]
    fn repeated_start_owns_one_loop_and_snapshot_reads_do_not_poll() {
        let (sent, received) = std::sync::mpsc::channel();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                sent.send(()).unwrap();
                Ok(reply(&request))
            }),
            Arc::new(|_| {}),
        ));
        owner.select("hamlib", true).unwrap();
        for _ in 0..20 {
            owner.snapshot().unwrap();
        }
        assert!(received.try_recv().is_err());
        for _ in 0..20 {
            owner.start();
        }
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.stop();
        assert!(received.recv_timeout(Duration::from_millis(50)).is_err());
    }

    #[test]
    fn shutdown_rejects_inflight_reads_and_never_publishes_them() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let waiting = gate.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let events = Arc::new(Mutex::new(0));
        let published = events.clone();
        let owner = Arc::new(StationTelemetry::new(
            Arc::new(move |request| {
                sent.send(()).unwrap();
                let _guard = waiting
                    .1
                    .wait_while(waiting.0.lock().unwrap(), |done| !*done)
                    .unwrap();
                Ok(reply(&request))
            }),
            Arc::new(move |_| {
                *published.lock().unwrap() += 1;
            }),
        ));
        owner.select("direct_agent", true).unwrap();
        let running = owner.clone();
        let thread = std::thread::spawn(move || running.refresh());
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        owner.refresh();
        owner.stop();
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        thread.join().unwrap();
        assert_eq!(*events.lock().unwrap(), 0);
        assert!(owner.select("hamlib", false).is_err());
    }
}
