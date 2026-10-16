//! Native continuous Follow Radio. Retained telemetry is the only input; this
//! owner never connects, polls or commands a radio. Permission starts disabled.
use crate::{
    radio_read::{Canonical, Evidence},
    spot_editor_barrier::EditorBarrier,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    provider: String,
    identity: String,
    generation: u64,
    control: u64,
}
impl Selection {
    fn parse(value: &Value) -> Result<Self, String> {
        let provider = value["provider"]
            .as_str()
            .filter(|p| crate::station_telemetry::valid_provider(p))
            .ok_or("Select a radio before enabling Follow Radio.")?;
        let identity = value["selection_id"]
            .as_str()
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
            .ok_or("Radio selection identity is unavailable.")?
            .to_string();
        let number = |key: &str| {
            value[key]
                .as_u64()
                .filter(|n| *n <= 9_007_199_254_740_991)
                .ok_or_else(|| "Radio selection epoch is unavailable.".to_string())
        };
        Ok(Self {
            provider: provider.into(),
            identity,
            generation: number("generation")?,
            control: number("control_revision")?,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    selection: Selection,
    revision: u64,
    frequency: u64,
    mode: String,
    connection: Option<u64>,
}
fn observation(projection: &Value, selected: &Value, now: u64) -> Result<Observation, String> {
    let selection = Selection::parse(selected)?;
    let snapshot = &projection["snapshot"];
    let radio = &snapshot["radio"];
    let age = |value: &Value, scale: f64| {
        value
            .as_f64()
            .is_some_and(|time| time.is_finite() && (now as f64 - time * scale).abs() <= 5000.0)
    };
    let received_age = projection["received_at_ms"]
        .as_u64()
        .map(|received| i128::from(now) - i128::from(received));
    if projection["available"] != true
        || projection["provider"] != selection.provider
        || projection["selection_id"] != selection.identity
        || projection["selection_generation"].as_u64() != Some(selection.generation)
        || received_age.is_none_or(|age| !(-1000..=5000).contains(&age))
    {
        return Err("Fresh authoritative radio telemetry is unavailable for Follow Radio.".into());
    }
    let (frequency, mode, connection) = if selection.provider == "hamlib" {
        // Native Hamlib telemetry retains its raw successful f/m fields. Never
        // issue additional probes or manufacture a projected observation time.
        if snapshot["device"] != "radio"
            || !age(&snapshot["observed_at_ms"], 1.0)
            || !age(&snapshot["field_observed_at_ms"]["frequency"], 1.0)
            || !age(&snapshot["field_observed_at_ms"]["mode"], 1.0)
        {
            return Err("Fresh Hamlib frequency and mode are unavailable.".into());
        }
        let value = &snapshot["fields"]["frequency"]["Frequency"];
        let frequency = value.as_u64().or_else(|| value.as_str()?.parse().ok());
        let connection = snapshot["generation"]
            .as_u64()
            .ok_or("Hamlib connection generation is unavailable.")?;
        (
            frequency,
            snapshot["fields"]["mode"]["Mode"].as_str(),
            Some(connection),
        )
    } else {
        if snapshot["source"] != selection.provider
            || radio["connected"] != true
            || radio["observed"] != true
            || radio["transmitting"] != false
            || snapshot["station"]["radio_stale"] == true
            || !age(&snapshot["generated_at"], 1000.0)
            || !age(&radio["observed_at"], 1000.0)
        {
            return Err(
                "Fresh authoritative radio telemetry is unavailable for Follow Radio.".into(),
            );
        }
        (radio["frequency_hz"].as_u64(), radio["mode"].as_str(), None)
    };
    let frequency = frequency
        .filter(|n| (1..=1_000_000_000_000).contains(n))
        .ok_or("Observed radio frequency is invalid.")?;
    let mode = mode
        .map(str::to_uppercase)
        .filter(|mode| {
            !mode.is_empty()
                && mode.len() <= 16
                && mode
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        .ok_or("Observed radio mode is invalid.")?;
    let revision = projection["revision"]
        .as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or("Radio telemetry revision is invalid.")?;
    Ok(Observation {
        selection,
        revision,
        frequency,
        mode,
        connection,
    })
}

pub trait Backend: Send + Sync {
    fn canonical(&self) -> Result<Canonical, String>;
    fn selection(&self) -> Result<Selection, String>;
    fn open_editors(&self) -> Result<Vec<String>, String>;
    fn transact(
        &self,
        operation: &str,
        canonical: &Canonical,
        observation: &Observation,
    ) -> Result<Value, String>;
    fn publish(&self);
}
struct State {
    enabled: bool,
    epoch: u64,
    anchor: Option<(u64, String, Selection)>,
    pending: Option<Observation>,
    last: Option<Observation>,
    running: bool,
    latest: Value,
    settling: BTreeMap<String, String>,
    error: String,
}
pub struct FollowRadio {
    backend: Arc<dyn Backend>,
    editors: Arc<EditorBarrier>,
    state: Mutex<State>,
    admission: Mutex<()>,
}
fn idle() -> Value {
    json!({"operationId":null,"phase":"idle","barrier":null})
}
impl FollowRadio {
    pub fn new(backend: Arc<dyn Backend>, editors: Arc<EditorBarrier>) -> Self {
        Self {
            backend,
            editors,
            state: Mutex::new(State {
                enabled: false,
                epoch: 0,
                anchor: None,
                pending: None,
                last: None,
                running: false,
                latest: idle(),
                settling: BTreeMap::new(),
                error: String::new(),
            }),
            admission: Mutex::new(()),
        }
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Follow Radio state unavailable")?;
        Ok(
            json!({"enabled":state.enabled,"epoch":state.epoch,"error":state.error,
            "operation":state.latest,"settlementPending":!state.settling.is_empty()}),
        )
    }
    fn activation(&self) -> Value {
        self.snapshot()
            .map(|v| v["operation"].clone())
            .unwrap_or_else(|_| idle())
    }
    pub fn set(&self, enabled: bool, expected: u64) -> Result<Value, String> {
        let _admission = self
            .admission
            .lock()
            .map_err(|_| "Follow Radio admission unavailable")?;
        // Reads cannot start a worker or initialize a station session.
        let anchor = if enabled {
            let c = self.backend.canonical()?;
            Some((c.worker, c.generation, self.backend.selection()?))
        } else {
            None
        };
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Follow Radio state unavailable")?;
            if state.epoch != expected {
                return Err("Follow Radio permission changed. Review its current state.".into());
            }
            if enabled
                && (state.running
                    || !state.settling.is_empty()
                    || state.latest["phase"] == "uncertain")
            {
                return Err(
                    "Reconcile the existing Follow Radio outcome before enabling it.".into(),
                );
            }
            state.epoch = state
                .epoch
                .checked_add(1)
                .filter(|n| *n <= 9_007_199_254_740_991)
                .ok_or("Follow Radio epoch exhausted")?;
            state.enabled = enabled;
            state.anchor = anchor;
            state.pending = None;
            state.last = None;
            state.error.clear();
        }
        self.backend.publish();
        self.snapshot()
    }
    fn disable_locked(state: &mut State, error: &str) {
        state.enabled = false;
        state.pending = None;
        state.anchor = None;
        state.epoch = state.epoch.saturating_add(1);
        state.error = error.chars().take(1024).collect();
    }
    pub fn revoke(&self, error: &str) {
        let Ok(_admission) = self.admission.lock() else {
            return;
        };
        if let Ok(mut state) = self.state.lock() {
            Self::disable_locked(&mut state, error);
        }
        self.backend.publish();
    }
    fn editor_changed(&self, label: &str, instance: Option<&str>) {
        // Opening, closing or remounting an editor intentionally retires the
        // shared Follow permission. This routine lifecycle change is not a
        // radio or agent fault, so keep it out of the global error banner.
        self.revoke("");
        if let Ok(mut state) = self.state.lock() {
            if state.settling.contains_key(label) {
                if let Some(instance) = instance {
                    state.settling.insert(label.into(), instance.into());
                } else {
                    state.settling.remove(label);
                }
            }
        }
        self.backend.publish();
    }
    /// One bounded slot retains the newest observation. At most one drain runs.
    fn offer(&self, incoming: Observation) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Follow Radio state unavailable")?;
        if !state.enabled {
            return Ok(false);
        }
        if state
            .anchor
            .as_ref()
            .is_none_or(|(_, _, selected)| *selected != incoming.selection)
        {
            Self::disable_locked(
                &mut state,
                "Radio selection or command epoch changed. Follow Radio is off.",
            );
            drop(state);
            self.backend.publish();
            return Ok(false);
        }
        if state
            .last
            .as_ref()
            .is_some_and(|last| last.connection != incoming.connection)
        {
            Self::disable_locked(&mut state, "Radio connection changed. Follow Radio is off.");
            drop(state);
            self.backend.publish();
            return Ok(false);
        }
        if state
            .last
            .as_ref()
            .is_some_and(|last| incoming.revision <= last.revision)
        {
            return Ok(false);
        }
        if !state.running
            && state.last.as_ref().is_some_and(|last| {
                last.frequency == incoming.frequency && last.mode == incoming.mode
            })
        {
            state.pending = None;
            state.last = Some(incoming);
            return Ok(false);
        }
        if state
            .pending
            .as_ref()
            .is_none_or(|pending| incoming.revision > pending.revision)
        {
            state.pending = Some(incoming);
        }
        if state.running || !state.settling.is_empty() {
            return Ok(false);
        }
        state.running = true;
        Ok(true)
    }
    fn store(&self, latest: Value) {
        if let Ok(mut state) = self.state.lock() {
            state.latest = latest;
        }
        self.backend.publish();
    }
    fn drain(&self) {
        loop {
            let next = self.state.lock().ok().and_then(|mut state| {
                if !state.enabled || !state.settling.is_empty() {
                    state.running = false;
                    return None;
                }
                match state.pending.take() {
                    Some(value) => Some((state.epoch, value)),
                    None => {
                        state.running = false;
                        None
                    }
                }
            });
            let Some((epoch, observed)) = next else {
                return;
            };
            let operation = uuid::Uuid::new_v4().to_string();
            let mut began = false;
            let mut transacted = false;
            let result = (|| -> Result<(), String> {
                let canonical = self.backend.canonical()?;
                {
                    let state = self
                        .state
                        .lock()
                        .map_err(|_| "Follow Radio state unavailable")?;
                    if !state.enabled
                        || state.epoch != epoch
                        || state.anchor.as_ref()
                            != Some(&(
                                canonical.worker,
                                canonical.generation.clone(),
                                observed.selection.clone(),
                            ))
                    {
                        return Err("Workspace, worker or Follow Radio permission changed.".into());
                    }
                }
                let open = self.backend.open_editors()?;
                self.editors.instances(&open)?;
                self.editors.begin(
                    &operation,
                    &canonical.generation,
                    &canonical.draft,
                    canonical.revision,
                    &open,
                )?;
                began = true;
                self.store(json!({"operationId":operation,"phase":"preparing","barrier":self.editors.snapshot()?,
                    "reservationActive":true,"admitted":false,"draftOnly":true,"intent":"follow-radio"}));
                self.editors
                    .wait_ready(&operation, Duration::from_secs(3))?;
                // Serialize revocation against the final admitted mutation. A
                // caller can revoke before this lock, or after its commit.
                let _admission = self
                    .admission
                    .lock()
                    .map_err(|_| "Follow Radio admission unavailable")?;
                let state = self
                    .state
                    .lock()
                    .map_err(|_| "Follow Radio state unavailable")?;
                if !state.enabled || state.epoch != epoch {
                    return Err("Follow Radio was disabled before admission.".into());
                }
                drop(state);
                transacted = true;
                let result = self.backend.transact(&operation, &canonical, &observed)?;
                if result["status"] == "unchanged" {
                    let current = &result["draft"];
                    if current["generation"] != canonical.generation
                        || current["qso"]["id"] != canonical.draft
                        || current["revision"].as_u64() != Some(canonical.revision)
                        || current["qso"]["frequencyHz"].as_u64() != Some(observed.frequency)
                    {
                        return Err(
                            "Unchanged Follow Radio result did not match its admitted draft."
                                .into(),
                        );
                    }
                } else {
                    crate::radio_read::verify(
                        &operation,
                        &canonical,
                        &Evidence {
                            frequency_hz: observed.frequency,
                            observed_mode: observed.mode.clone(),
                        },
                        &result,
                    )?;
                }
                // Capture current native membership while revocation is still
                // serialized; a reloaded editor must settle its new instance.
                let instances = self.editors.instances(&self.backend.open_editors()?)?;
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| "Follow Radio state unavailable")?;
                state.latest = json!({"operationId":operation,"phase":"confirmed","barrier":null,"reservationActive":false,
                    "admitted":true,"draftOnly":true,"intent":"follow-radio","tuneConfirmed":false,"rotor":"not-requested"});
                state.settling = instances;
                state.last = Some(observed.clone());
                Ok(())
            })();
            if began {
                let _ = self.editors.finish(&operation);
            }
            match result {
                Ok(()) => {
                    self.backend.publish();
                }
                Err(error) => {
                    if let Ok(mut state) = self.state.lock() {
                        Self::disable_locked(&mut state, &error);
                        state.latest = json!({"operationId":operation,"phase":if transacted { "uncertain" } else { "blocked" },"barrier":null,"reservationActive":false,
                            "admitted":false,"draftOnly":true,"intent":"follow-radio","tuneConfirmed":false,"rotor":"not-requested","error":error});
                    }
                    self.backend.publish();
                }
            }
        }
    }
    /// Renderer calls only after canonical reconciliation. A new preparation
    /// must never supersede a terminal status still needed by another editor.
    fn settled(&self, label: &str, instance: &str, operation: &str) -> Result<bool, String> {
        let registered = self.editors.instances(&[label.into()])?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Follow Radio state unavailable")?;
        if state.latest["operationId"].as_str() != Some(operation)
            || state.latest["phase"] != "confirmed"
            || registered.get(label).map(String::as_str) != Some(instance)
            || state.settling.get(label).map(String::as_str) != Some(instance)
        {
            return Err(
                "This Follow Radio settlement is obsolete or belongs to another editor instance."
                    .into(),
            );
        }
        state.settling.remove(label);
        if state.settling.is_empty() && state.enabled && state.pending.is_some() && !state.running {
            state.running = true;
            return Ok(true);
        }
        Ok(false)
    }
}

struct NativeBackend {
    app: tauri::AppHandle,
}
impl Backend for NativeBackend {
    fn canonical(&self) -> Result<Canonical, String> {
        crate::radio_read::Backend::canonical(&crate::radio_read::NativeBackend {
            app: self.app.clone(),
        })
    }
    fn selection(&self) -> Result<Selection, String> {
        Selection::parse(&crate::station_selection::retained_snapshot()?)
    }
    fn open_editors(&self) -> Result<Vec<String>, String> {
        Ok(self
            .app
            .webview_windows()
            .into_keys()
            .filter(|label| crate::spot_editor_barrier::editor_role(label))
            .collect())
    }
    fn transact(
        &self,
        operation: &str,
        canonical: &Canonical,
        observed: &Observation,
    ) -> Result<Value, String> {
        use crate::radio_read::NativeBackend as Worker;
        crate::worker::require_existing_generation(canonical.worker)?;
        let selected = crate::station_selection::retained_snapshot()?;
        if Selection::parse(&selected)? != observed.selection {
            return Err("Selected radio changed before Follow Radio commit.".into());
        }
        let _fence =
            crate::station_selection::owner(&self.app)?.fence_radio_read_epoch(&selected)?;
        let retained = crate::station_telemetry::retained_snapshot()?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Radio clock unavailable")?
            .as_millis() as u64;
        let current = observation(&retained, &selected, now)?;
        if current.selection != observed.selection
            || current.connection != observed.connection
            || current.revision < observed.revision
            || current.frequency != observed.frequency
            || current.mode != observed.mode
        {
            return Err("Observed radio fields changed before Follow Radio commit.".into());
        }
        let params = json!({"operationID":operation,"draftID":canonical.draft,"expectedRevision":canonical.revision,
            "generation":canonical.generation,"frequencyHz":observed.frequency,"observedMode":observed.mode});
        match Worker::call(
            canonical.worker,
            "logbook_operator_draft_radio_follow",
            params,
        ) {
            Ok(result) => Ok(result),
            Err(original) => {
                // Receipt lookup is read-only. An unknown outcome is never replayed.
                Worker::call(
                    canonical.worker,
                    "logbook_operator_draft_receipt",
                    json!({"operationID":operation,"generation":canonical.generation}),
                )
                .ok()
                .and_then(|value| value.get("receipt").filter(|v| v.is_object()).cloned())
                .map(|receipt| json!({"status":"applied","receipt":receipt}))
                .ok_or(original)
            }
        }
    }
    fn publish(&self) {
        for label in ["main", "log-qso", "logbook"] {
            let _ = self.app.emit_to(label, "xlog:spot-activation", ());
            let _ = self.app.emit_to(label, "xlog:operator-draft-follow", ());
        }
        let _ = self.app.emit("xlog:operator-draft-changed", ());
    }
}
static OWNER: OnceLock<Arc<FollowRadio>> = OnceLock::new();
pub fn install(app: &tauri::AppHandle, editors: Arc<EditorBarrier>) {
    OWNER.get_or_init(|| {
        Arc::new(FollowRadio::new(
            Arc::new(NativeBackend { app: app.clone() }),
            editors,
        ))
    });
}
fn owner() -> Result<Arc<FollowRadio>, String> {
    OWNER
        .get()
        .cloned()
        .ok_or("Follow Radio owner is unavailable.".into())
}
pub fn snapshot() -> Result<Value, String> {
    owner()?.snapshot()
}
pub fn activation_snapshot() -> Option<Value> {
    OWNER
        .get()
        .map(|o| o.activation())
        .filter(|v| v["operationId"].is_string())
}
pub fn reservation_active() -> bool {
    activation_snapshot().is_some_and(|v| v["reservationActive"] == true)
}
pub fn owns(operation: &str) -> bool {
    activation_snapshot().is_some_and(|v| v["operationId"].as_str() == Some(operation))
}
pub fn set(enabled: bool, expected: u64) -> Result<Value, String> {
    owner()?.set(enabled, expected)
}
pub fn revoke(reason: &str) {
    if let Some(owner) = OWNER.get() {
        owner.revoke(reason);
    }
}

/// Revoke an explicit operator permission without presenting the expected
/// transition as a fault in every open editor.
pub fn revoke_silently() {
    revoke("");
}
pub fn editor_changed(label: &str, instance: Option<&str>) {
    if let Some(owner) = OWNER.get() {
        owner.editor_changed(label, instance);
    }
}
pub fn settled(label: &str, instance: &str, operation: &str) -> Result<(), String> {
    let owner = owner()?;
    if owner.settled(label, instance, operation)? {
        std::thread::spawn(move || owner.drain());
    }
    Ok(())
}
pub fn observe(projection: &Value) {
    let Some(owner) = OWNER.get() else {
        return;
    };
    if !owner.snapshot().is_ok_and(|s| s["enabled"] == true) {
        return;
    }
    let result = (|| {
        let selected = crate::station_selection::retained_snapshot()?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Radio clock unavailable".to_string())?
            .as_millis() as u64;
        owner.offer(observation(projection, &selected, now)?)
    })();
    match result {
        Ok(true) => {
            let owner = owner.clone();
            std::thread::spawn(move || owner.drain());
        }
        Ok(false) => {}
        Err(error) => owner.revoke(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    fn id() -> String {
        uuid::Uuid::new_v4().to_string()
    }
    fn selected() -> Value {
        json!({"provider":"direct_agent","selection_id":id(),"generation":3,"control_revision":7})
    }
    fn observed(selection: &Selection, revision: u64, frequency: u64) -> Observation {
        Observation {
            selection: selection.clone(),
            revision,
            frequency,
            mode: "USB".into(),
            connection: None,
        }
    }
    struct Fake {
        canonical: Mutex<Canonical>,
        selection: Selection,
        open: Vec<String>,
        calls: Mutex<Vec<Observation>>,
        fail: bool,
    }
    impl Backend for Fake {
        fn canonical(&self) -> Result<Canonical, String> {
            Ok(self.canonical.lock().unwrap().clone())
        }
        fn selection(&self) -> Result<Selection, String> {
            Ok(self.selection.clone())
        }
        fn open_editors(&self) -> Result<Vec<String>, String> {
            Ok(self.open.clone())
        }
        fn transact(
            &self,
            operation: &str,
            canonical: &Canonical,
            observation: &Observation,
        ) -> Result<Value, String> {
            self.calls.lock().unwrap().push(observation.clone());
            if self.fail {
                return Err("Lost worker response and no receipt".into());
            }
            self.canonical.lock().unwrap().revision += 1;
            Ok(
                json!({"status":"applied","receipt":{"mutation":{"operationID":operation,"draftID":canonical.draft,
                "expectedRevision":canonical.revision,"action":"replace"},"draft":{"generation":canonical.generation,
                "revision":canonical.revision+1,"qso":{"id":canonical.draft,"frequencyHz":observation.frequency,"mode":"SSB"}}}}),
            )
        }
        fn publish(&self) {}
    }
    fn fixture(open: Vec<String>, fail: bool) -> (Arc<FollowRadio>, Arc<Fake>, Arc<EditorBarrier>) {
        let backend = Arc::new(Fake {
            canonical: Mutex::new(Canonical {
                worker: 1,
                generation: id(),
                draft: id(),
                revision: 2,
            }),
            selection: Selection::parse(&selected()).unwrap(),
            open,
            calls: Mutex::new(Vec::new()),
            fail,
        });
        let editors = Arc::new(EditorBarrier::default());
        (
            Arc::new(FollowRadio::new(backend.clone(), editors.clone())),
            backend,
            editors,
        )
    }
    fn preparing(owner: &FollowRadio) -> Value {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let state = owner.activation();
            if state["phase"] == "preparing" {
                return state["barrier"].clone();
            }
            assert!(
                Instant::now() < deadline,
                "preparation did not start: {state}"
            );
            std::thread::yield_now();
        }
    }
    fn acknowledge(editors: &EditorBarrier, barrier: &Value, instance: &str, ready: bool) {
        editors
            .acknowledge(
                "log-qso",
                instance,
                barrier["operationId"].as_str().unwrap(),
                barrier["barrierId"].as_str().unwrap(),
                ready,
                Some("Buffered or dirty editor input"),
            )
            .unwrap();
    }
    #[test]
    fn starts_off_and_coalesces_to_one_newest_observation_without_main_or_radio_reads() {
        let (owner, backend, _) = fixture(vec![], false);
        assert!(!owner
            .offer(observed(&backend.selection, 1, 14_200_000))
            .unwrap());
        owner.set(true, 0).unwrap();
        assert!(owner
            .offer(observed(&backend.selection, 1, 14_200_000))
            .unwrap());
        for revision in 2..100 {
            assert!(!owner
                .offer(observed(
                    &backend.selection,
                    revision,
                    14_200_000 + revision
                ))
                .unwrap());
        }
        owner.drain();
        let calls = backend.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].revision, 99);
        assert_eq!(calls[0].frequency, 14_200_099);
        assert_eq!(owner.activation()["phase"], "confirmed");
    }
    #[test]
    fn silent_revocation_disables_permission_without_an_error_message() {
        let (owner, _, _) = fixture(vec![], false);
        owner.set(true, 0).unwrap();

        owner.revoke("");

        let state = owner.snapshot().unwrap();
        assert_eq!(state["enabled"], false);
        assert_eq!(state["error"], "");
    }
    #[test]
    fn repeats_are_ignored_but_mode_only_change_is_followed() {
        let (owner, backend, _) = fixture(vec![], false);
        owner.set(true, 0).unwrap();
        assert!(owner
            .offer(observed(&backend.selection, 1, 14_200_000))
            .unwrap());
        owner.drain();
        assert!(!owner
            .offer(observed(&backend.selection, 2, 14_200_000))
            .unwrap());
        let mut next = observed(&backend.selection, 3, 14_200_000);
        next.mode = "CW".into();
        assert!(owner.offer(next).unwrap());
        owner.drain();
        assert_eq!(backend.calls.lock().unwrap().len(), 2);
    }
    #[test]
    fn detached_editor_admission_and_exact_terminal_settlement_gate_the_next_update() {
        let (owner, backend, editors) = fixture(vec!["log-qso".into()], false);
        let instance = id();
        editors.register("log-qso", &instance).unwrap();
        owner.set(true, 0).unwrap();
        owner
            .offer(observed(&backend.selection, 1, 14_200_000))
            .unwrap();
        let running = owner.clone();
        let task = std::thread::spawn(move || running.drain());
        let barrier = preparing(&owner);
        assert!(backend.calls.lock().unwrap().is_empty());
        acknowledge(&editors, &barrier, &instance, true);
        task.join().unwrap();
        assert_eq!(owner.activation()["phase"], "confirmed");
        assert!(!owner
            .offer(observed(&backend.selection, 2, 7_100_000))
            .unwrap());
        assert!(!owner
            .offer(observed(&backend.selection, 3, 7_150_000))
            .unwrap());
        let operation = owner.activation()["operationId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(owner.settled("log-qso", &id(), &operation).is_err());
        assert!(owner.settled("log-qso", &instance, &operation).unwrap());
        let running = owner.clone();
        let task = std::thread::spawn(move || running.drain());
        let next = preparing(&owner);
        assert_ne!(next["operationId"], barrier["operationId"]);
        acknowledge(&editors, &next, &instance, true);
        task.join().unwrap();
        let calls = backend.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].frequency, 7_150_000);
    }
    #[test]
    fn buffered_dirty_veto_and_editor_reload_disable_without_mutating() {
        for reload in [false, true] {
            let (owner, backend, editors) = fixture(vec!["log-qso".into()], false);
            let instance = id();
            editors.register("log-qso", &instance).unwrap();
            owner.set(true, 0).unwrap();
            owner
                .offer(observed(&backend.selection, 1, 14_200_000))
                .unwrap();
            let running = owner.clone();
            let task = std::thread::spawn(move || running.drain());
            let barrier = preparing(&owner);
            if reload {
                editors.register("log-qso", &id()).unwrap();
            } else {
                acknowledge(&editors, &barrier, &instance, false);
            }
            task.join().unwrap();
            assert_eq!(owner.snapshot().unwrap()["enabled"], false);
            assert!(backend.calls.lock().unwrap().is_empty());
            assert_eq!(owner.activation()["phase"], "blocked");
        }
    }
    #[test]
    fn worker_workspace_selection_and_control_epoch_drift_disable_permission() {
        for drift in ["worker", "workspace", "selection", "control"] {
            let (owner, backend, _) = fixture(vec![], false);
            owner.set(true, 0).unwrap();
            let mut incoming = observed(&backend.selection, 1, 14_200_000);
            match drift {
                "worker" => backend.canonical.lock().unwrap().worker += 1,
                "workspace" => backend.canonical.lock().unwrap().generation = id(),
                "selection" => incoming.selection.identity = id(),
                _ => incoming.selection.control += 1,
            }
            if owner.offer(incoming).unwrap() {
                owner.drain();
            }
            assert_eq!(owner.snapshot().unwrap()["enabled"], false, "{drift}");
            assert!(backend.calls.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn unknown_outcome_is_retained_and_never_replayed_under_a_new_operation() {
        let (owner, backend, _) = fixture(vec![], true);
        owner.set(true, 0).unwrap();
        owner
            .offer(observed(&backend.selection, 1, 14_200_000))
            .unwrap();
        owner.drain();
        let terminal = owner.activation();
        assert_eq!(terminal["phase"], "uncertain");
        assert!(!owner
            .offer(observed(&backend.selection, 2, 14_200_000))
            .unwrap());
        let epoch = owner.snapshot().unwrap()["epoch"].as_u64().unwrap();
        assert!(owner.set(true, epoch).is_err());
        assert_eq!(backend.calls.lock().unwrap().len(), 1);
        assert_eq!(owner.activation(), terminal);
    }
    #[test]
    fn permission_epoch_prevents_delayed_enable_and_pending_disable_prevents_mutation() {
        let (owner, backend, _) = fixture(vec![], false);
        owner.set(true, 0).unwrap();
        owner
            .offer(observed(&backend.selection, 1, 14_200_000))
            .unwrap();
        owner.set(false, 1).unwrap();
        assert!(owner.set(true, 1).is_err());
        owner.drain();
        assert!(backend.calls.lock().unwrap().is_empty());
    }
    #[test]
    fn observation_rejects_stale_disconnected_transmitting_and_wrong_selection_provenance() {
        let selected = selected();
        let now = 1_800_000_000_000u64;
        let projection = json!({"available":true,"provider":"direct_agent","selection_id":selected["selection_id"],"selection_generation":3,
            "revision":1,"received_at_ms":now,"snapshot":{"source":"direct_agent","generated_at":now/1000,
            "radio":{"connected":true,"observed":true,"transmitting":false,"frequency_hz":14_200_000,"mode":"USB","observed_at":now/1000}}});
        assert!(observation(&projection, &selected, now).is_ok());
        assert!(observation(&projection, &selected, now + 5001).is_err());
        for path in [
            "connected",
            "observed",
            "transmitting",
            "frequency_hz",
            "mode",
        ] {
            let mut changed = projection.clone();
            changed["snapshot"]["radio"][path] = match path {
                "connected" | "observed" => json!(false),
                "transmitting" => json!(true),
                "frequency_hz" => json!(0),
                _ => json!("CW;TX"),
            };
            assert!(observation(&changed, &selected, now).is_err(), "{path}");
        }
        let mut changed = projection;
        changed["selection_id"] = json!(id());
        assert!(observation(&changed, &selected, now).is_err());
    }
    #[test]
    fn hamlib_uses_only_fresh_retained_frequency_mode_and_connection_generation() {
        let mut selected = selected();
        selected["provider"] = json!("hamlib");
        let now = 1_800_000_000_000u64;
        let projection = json!({"available":true,"provider":"hamlib","selection_id":selected["selection_id"],"selection_generation":3,
            "revision":1,"received_at_ms":now,"snapshot":{"device":"radio","generation":42,"observed_at_ms":now,
            "field_observed_at_ms":{"frequency":now,"mode":now},"fields":{"frequency":{"Frequency":"14074000"},"mode":{"Mode":"PKTUSB"}}}});
        let value = observation(&projection, &selected, now).unwrap();
        assert_eq!(value.frequency, 14_074_000);
        assert_eq!(value.mode, "PKTUSB");
        assert_eq!(value.connection, Some(42));
        let mut stale = projection.clone();
        stale["snapshot"]["field_observed_at_ms"]["mode"] = json!(now - 5001);
        assert!(observation(&stale, &selected, now).is_err());
        let mut unavailable = projection;
        unavailable["snapshot"]["fields"]["mode"] = Value::Null;
        assert!(observation(&unavailable, &selected, now).is_err());
    }

    #[test]
    fn native_editor_reload_rebinds_settlement_but_never_rearms_follow() {
        let (owner, backend, editors) = fixture(vec!["log-qso".into()], false);
        let instance = id();
        editors.register("log-qso", &instance).unwrap();
        owner.set(true, 0).unwrap();
        owner
            .offer(observed(&backend.selection, 1, 14_200_000))
            .unwrap();
        let running = owner.clone();
        let task = std::thread::spawn(move || running.drain());
        let barrier = preparing(&owner);
        acknowledge(&editors, &barrier, &instance, true);
        task.join().unwrap();
        let operation = owner.activation()["operationId"]
            .as_str()
            .unwrap()
            .to_owned();
        let replacement = id();
        editors.register("log-qso", &replacement).unwrap();
        owner.editor_changed("log-qso", Some(&replacement));
        assert!(owner.settled("log-qso", &instance, &operation).is_err());
        assert!(!owner.settled("log-qso", &replacement, &operation).unwrap());
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["enabled"], false);
        assert_eq!(snapshot["error"], "");
        assert_eq!(snapshot["settlementPending"], false);
        assert_eq!(backend.calls.lock().unwrap().len(), 1);
    }
}
