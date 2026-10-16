//! Clear-after-QSY admission and transaction primitives.
//! Observation proves only RX movement; it never commands or infers a TX VFO.
use crate::spot_editor_barrier::EditorBarrier;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceEpoch {
    pub provider: String,
    pub selection_id: String,
    pub selection_generation: u64,
    pub control_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfirmedQSY {
    pub epoch: SourceEpoch,
    pub telemetry_revision: u64,
    pub receive_frequency_hz: u64,
    pub observed_mode: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Sample {
    epoch: SourceEpoch,
    telemetry_revision: u64,
    receive_frequency_hz: u64,
    observed_mode: String,
}

#[derive(Default)]
pub struct Observer {
    baseline: Option<Sample>,
    candidate: Option<Sample>,
}

impl Observer {
    /// Two distinct, fresh telemetry revisions must agree on the new RX value.
    /// Invalid/reconnected/changed-command evidence resets the baseline, so the
    /// first subsequent observation can never erase a draft.
    pub fn observe(
        &mut self,
        projection: &Value,
        selection: &Value,
        now_ms: u64,
    ) -> Option<ConfirmedQSY> {
        let Some(sample) = sample(projection, selection, now_ms) else {
            self.baseline = None;
            self.candidate = None;
            return None;
        };
        let Some(baseline) = self.baseline.as_ref() else {
            self.baseline = Some(sample);
            return None;
        };
        if sample.epoch != baseline.epoch
            || sample.telemetry_revision <= baseline.telemetry_revision
        {
            self.baseline = Some(sample);
            self.candidate = None;
            return None;
        }
        if sample.receive_frequency_hz == baseline.receive_frequency_hz {
            self.baseline = Some(sample);
            self.candidate = None;
            return None;
        }
        if self.candidate.as_ref().is_some_and(|candidate| {
            candidate.epoch == sample.epoch
                && candidate.receive_frequency_hz == sample.receive_frequency_hz
                && candidate.observed_mode == sample.observed_mode
                && candidate.telemetry_revision < sample.telemetry_revision
        }) {
            self.baseline = Some(sample.clone());
            self.candidate = None;
            return Some(ConfirmedQSY {
                epoch: sample.epoch,
                telemetry_revision: sample.telemetry_revision,
                receive_frequency_hz: sample.receive_frequency_hz,
                observed_mode: sample.observed_mode,
            });
        }
        self.candidate = Some(sample);
        None
    }
}

fn sample(projection: &Value, selection: &Value, now_ms: u64) -> Option<Sample> {
    let provider = projection["provider"].as_str()?;
    if !crate::station_telemetry::valid_provider(provider)
        || selection["provider"].as_str()? != provider
        || projection["available"] != true
    {
        return None;
    }
    let selection_id = projection["selection_id"].as_str()?;
    let selection_generation = projection["selection_generation"].as_u64()?;
    let control_revision = selection["control_revision"].as_u64()?;
    if selection["selection_id"].as_str()? != selection_id
        || selection["generation"].as_u64()? != selection_generation
        || selection_generation > MAX_REVISION
        || control_revision > MAX_REVISION
    {
        return None;
    }
    let revision = projection["revision"]
        .as_u64()
        .filter(|value| *value <= MAX_REVISION)?;
    let received = projection["received_at_ms"].as_u64()?;
    let age = i128::from(now_ms) - i128::from(received);
    let snapshot = &projection["snapshot"];
    let radio = &snapshot["radio"];
    let source_age = snapshot["generated_at"]
        .as_f64()
        .map(|time| now_ms as f64 - time * 1000.0)?;
    let observed_age = radio["observed_at"]
        .as_f64()
        .map(|time| now_ms as f64 - time * 1000.0)?;
    if !(-1000..=5000).contains(&age)
        || !source_age.is_finite()
        || source_age.abs() > 5000.0
        || !observed_age.is_finite()
        || observed_age.abs() > 5000.0
        || snapshot["source"].as_str()? != provider
        || radio["connected"] != true
        || radio["observed"] != true
        || radio["transmitting"] != false
        || snapshot["station"]["radio_stale"] == true
    {
        return None;
    }
    // Deliberately no fallback to frequency_hz or transmit_frequency_hz: split
    // TX may be any same-band or cross-band value and is irrelevant to clearing.
    let receive_frequency_hz = radio["receive_frequency_hz"]
        .as_u64()
        .filter(|value| (1..=1_000_000_000_000).contains(value))?;
    let observed_mode = radio["mode"].as_str()?.to_uppercase();
    if observed_mode.is_empty()
        || observed_mode.len() > 16
        || !observed_mode
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return None;
    }
    Some(Sample {
        epoch: SourceEpoch {
            provider: provider.into(),
            selection_id: selection_id.into(),
            selection_generation,
            control_revision,
        },
        telemetry_revision: revision,
        receive_frequency_hz,
        observed_mode,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionRequest {
    pub operation_id: String,
    pub qsy: ConfirmedQSY,
    pub cluster_selection_revision: u64,
}

pub trait Backend: Send + Sync {
    fn enabled(&self) -> Result<bool, String>;
    fn canonical(&self, request: &TransactionRequest) -> Result<Value, String>;
    fn open_editors(&self) -> Result<Vec<String>, String>;
    fn publish(&self, snapshot: &Value);
    /// Revalidates telemetry, radio selection/control epoch, cluster selection
    /// revision and worker generation immediately before the durable mutation.
    fn precommit(&self, request: &TransactionRequest) -> Result<(), String>;
    fn apply(&self, request: &TransactionRequest, canonical: &Value) -> Result<Value, String>;
    fn finish(&self, _request: &TransactionRequest) {}
}

pub struct Coordinator {
    backend: Arc<dyn Backend>,
    editors: Arc<EditorBarrier>,
    active: Mutex<()>,
    latest: Mutex<Value>,
}

impl Coordinator {
    pub fn new(backend: Arc<dyn Backend>, editors: Arc<EditorBarrier>) -> Self {
        Self {
            backend,
            editors,
            active: Mutex::new(()),
            latest: Mutex::new(json!({"operationId":null,"phase":"idle","barrier":null})),
        }
    }
    pub fn snapshot(&self) -> Value {
        self.latest
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| json!({"operationId":null,"phase":"idle","barrier":null}))
    }
    pub fn retire_terminal(&self) {
        if let Ok(mut latest) = self.latest.lock() {
            if latest["reservationActive"] != true {
                *latest = json!({"operationId":null,"phase":"idle","barrier":null});
            }
        }
    }
    fn store(&self, value: Value) -> Value {
        if let Ok(mut latest) = self.latest.lock() {
            *latest = value.clone();
        }
        self.backend.publish(&value);
        value
    }
    pub fn execute(&self, request: TransactionRequest) -> Value {
        match self.backend.enabled() {
            Ok(false) => return json!({"operationId":null,"phase":"idle","barrier":null}),
            Err(error) => return self.store(terminal(&request.operation_id, "blocked", &error)),
            Ok(true) => {}
        }
        let Ok(_active) = self.active.try_lock() else {
            return self.store(terminal(
                &request.operation_id,
                "blocked",
                "Another QSY clear is in progress.",
            ));
        };
        let result = (|| -> Result<Value, String> {
            let operation_id = uuid::Uuid::parse_str(&request.operation_id)
                .map_err(|_| "Invalid QSY operation identity.")?;
            let canonical = self.backend.canonical(&request)?;
            let generation = canonical["generation"]
                .as_str()
                .ok_or("Canonical draft generation is unavailable")?;
            let draft = canonical["qso"]["id"]
                .as_str()
                .ok_or("Canonical draft identity is unavailable")?;
            let revision = canonical["revision"]
                .as_u64()
                .filter(|value| *value < MAX_REVISION)
                .ok_or("Canonical draft revision is unavailable")?;
            let editors = self.backend.open_editors()?;
            let _barrier_id =
                self.editors
                    .begin(&request.operation_id, generation, draft, revision, &editors)?;
            let barrier = self.editors.snapshot()?;
            self.store(
                json!({"operationId":request.operation_id,"phase":"preparing","barrier":barrier,
                "admitted":false,"reservationActive":true,"draftOnly":true}),
            );
            let admitted = self
                .editors
                .wait_ready(&request.operation_id, Duration::from_secs(3));
            if let Err(error) = admitted {
                let _ = self.editors.finish(&request.operation_id);
                return Err(error);
            }
            self.backend.precommit(&request)?;
            let response = self.backend.apply(&request, &canonical)?;
            if response["status"] != "applied"
                || response["receipt"]["mutation"]["operationID"]
                    .as_str()
                    .and_then(|value| uuid::Uuid::parse_str(value).ok())
                    != Some(operation_id)
                || response["receipt"]["draft"]["generation"].as_str() != Some(generation)
                || response["receipt"]["draft"]["revision"].as_u64() != revision.checked_add(1)
                || response["receipt"]["draft"]["qso"]["id"]
                    .as_str()
                    .is_none_or(|value| value == draft)
                || response["receipt"]["draft"]["qso"]["call"] != ""
                || response["receipt"]["draft"]["qso"]["frequencyHz"].as_u64()
                    != Some(request.qsy.receive_frequency_hz)
            {
                return Err(
                    "Durable QSY clear receipt did not match the admitted transaction.".into(),
                );
            }
            let _ = self.editors.finish(&request.operation_id);
            Ok(
                json!({"operationId":request.operation_id,"phase":"confirmed","barrier":null,
                "admitted":true,"reservationActive":false,"draftOnly":true,"tuneConfirmed":false,"rotor":"not-requested"}),
            )
        })();
        self.backend.finish(&request);
        match result {
            Ok(value) => self.store(value),
            Err(error) => {
                let _ = self.editors.finish(&request.operation_id);
                self.store(terminal(&request.operation_id, "blocked", &error))
            }
        }
    }
}

fn terminal(operation: &str, phase: &str, error: &str) -> Value {
    json!({"operationId":operation,"phase":phase,"barrier":null,"admitted":false,"reservationActive":false,
        "draftOnly":true,"tuneConfirmed":false,"rotor":"not-requested","error":error})
}

struct NativeContext {
    worker: u64,
    generation: String,
    draft: String,
    revision: u64,
    cluster_fence: Option<crate::cluster_session::SelectionFence>,
    station_fence: Option<crate::station_selection::QSYEpochFence>,
}
struct NativeBackend {
    app: tauri::AppHandle,
    contexts: Mutex<std::collections::BTreeMap<String, NativeContext>>,
}

impl NativeBackend {
    fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            contexts: Mutex::new(std::collections::BTreeMap::new()),
        }
    }
    fn call(worker: u64, method: &str, params: Value) -> Result<Value, String> {
        let request = json!({"id":format!("native-qsy-clear-{}",uuid::Uuid::new_v4()),"method":method,"params":params});
        let response = crate::worker::request_existing_generation(request.clone(), worker)?;
        if response["id"] != request["id"]
            || response["ok"] != true
            || !response["result"].is_object()
        {
            return Err(response["error"]["message"]
                .as_str()
                .unwrap_or("Native QSY transaction was not confirmed")
                .to_owned());
        }
        if crate::worker::generation() != worker {
            return Err("Worker generation changed during QSY transaction.".into());
        }
        Ok(response["result"].clone())
    }
    fn worker() -> Result<u64, String> {
        let worker = crate::worker::generation();
        if worker == 0 {
            Err("The existing logbook worker is unavailable.".into())
        } else {
            Ok(worker)
        }
    }
}

impl Backend for NativeBackend {
    fn enabled(&self) -> Result<bool, String> {
        let worker = Self::worker()?;
        Ok(Self::call(worker, "settings_load", json!({}))?["settings"]["clearAfterQSY"] == true)
    }
    fn canonical(&self, request: &TransactionRequest) -> Result<Value, String> {
        let worker = Self::worker()?;
        let result = Self::call(worker, "logbook_operator_draft", json!({}))?;
        let draft = result["draft"].clone();
        let generation = draft["generation"]
            .as_str()
            .and_then(|value| uuid::Uuid::parse_str(value).ok())
            .ok_or("Canonical draft generation is invalid")?
            .to_string();
        let draft_id = draft["qso"]["id"]
            .as_str()
            .and_then(|value| uuid::Uuid::parse_str(value).ok())
            .ok_or("Canonical draft identity is invalid")?
            .to_string();
        let revision = draft["revision"]
            .as_u64()
            .filter(|value| *value < MAX_REVISION)
            .ok_or("Canonical draft revision is invalid")?;
        self.contexts
            .lock()
            .map_err(|_| "QSY transaction context unavailable")?
            .insert(
                request.operation_id.clone(),
                NativeContext {
                    worker,
                    generation,
                    draft: draft_id,
                    revision,
                    cluster_fence: None,
                    station_fence: None,
                },
            );
        Ok(draft)
    }
    fn open_editors(&self) -> Result<Vec<String>, String> {
        Ok(self
            .app
            .webview_windows()
            .into_keys()
            .filter(|label| crate::spot_editor_barrier::editor_role(label))
            .collect())
    }
    fn publish(&self, _: &Value) {
        for label in ["main", "log-qso", "logbook"] {
            let _ = self.app.emit_to(label, "xlog:spot-activation", ());
        }
    }
    fn precommit(&self, request: &TransactionRequest) -> Result<(), String> {
        let mut contexts = self
            .contexts
            .lock()
            .map_err(|_| "QSY transaction context unavailable")?;
        let context = contexts
            .get_mut(&request.operation_id)
            .ok_or("QSY transaction context expired")?;
        if crate::worker::generation() != context.worker {
            return Err("Worker generation changed before QSY clear.".into());
        }
        let selection = crate::station_selection::retained_snapshot()?;
        if selection["provider"] != request.qsy.epoch.provider
            || selection["selection_id"] != request.qsy.epoch.selection_id
            || selection["generation"].as_u64() != Some(request.qsy.epoch.selection_generation)
            || selection["control_revision"].as_u64() != Some(request.qsy.epoch.control_revision)
        {
            return Err("Radio selection or command epoch changed before QSY clear.".into());
        }
        context.station_fence =
            Some(crate::station_selection::owner(&self.app)?.fence_qsy_epoch(&selection)?);
        let telemetry = crate::station_telemetry::retained_snapshot()?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Radio clock unavailable")?
            .as_millis() as u64;
        let current = sample(&telemetry, &selection, now)
            .ok_or("Fresh observed RX evidence is no longer available.")?;
        if current.epoch != request.qsy.epoch
            || current.telemetry_revision < request.qsy.telemetry_revision
            || current.receive_frequency_hz != request.qsy.receive_frequency_hz
            || current.observed_mode != request.qsy.observed_mode
        {
            return Err("Observed RX evidence changed before QSY clear.".into());
        }
        context.cluster_fence = Some(
            crate::cluster_session::owner(&self.app)?
                .fence_selection(request.cluster_selection_revision)?,
        );
        Ok(())
    }
    fn apply(&self, request: &TransactionRequest, _: &Value) -> Result<Value, String> {
        let mut contexts = self
            .contexts
            .lock()
            .map_err(|_| "QSY transaction context unavailable")?;
        let context = contexts
            .remove(&request.operation_id)
            .ok_or("QSY transaction context expired")?;
        let params = json!({
            "operationID":request.operation_id,"draftID":context.draft,"expectedRevision":context.revision,
            "generation":context.generation,"receiveFrequencyHz":request.qsy.receive_frequency_hz,"observedMode":request.qsy.observed_mode
        });
        match Self::call(context.worker, "logbook_operator_draft_qsy_clear", params) {
            Ok(result) => Ok(result),
            Err(original) => {
                // Never replay an uncertain mutation. The same operation's
                // durable receipt proves whether the atomic clear committed.
                let recovered = Self::call(
                    context.worker,
                    "logbook_operator_draft_receipt",
                    json!({
                        "operationID":request.operation_id,"generation":context.generation
                    }),
                )
                .ok()
                .and_then(|value| {
                    value
                        .get("receipt")
                        .filter(|value| value.is_object())
                        .cloned()
                });
                recovered
                    .map(|receipt| json!({"status":"applied","receipt":receipt}))
                    .ok_or(original)
            }
        }
    }
    fn finish(&self, request: &TransactionRequest) {
        if let Ok(mut contexts) = self.contexts.lock() {
            contexts.remove(&request.operation_id);
        }
    }
}

struct Owner {
    observer: Mutex<Observer>,
    coordinator: Arc<Coordinator>,
    app: tauri::AppHandle,
}
static OWNER: OnceLock<Arc<Owner>> = OnceLock::new();

pub fn install(app: &tauri::AppHandle, editors: Arc<EditorBarrier>) {
    let app = app.clone();
    OWNER.get_or_init(|| {
        let backend = Arc::new(NativeBackend::new(app.clone()));
        Arc::new(Owner {
            observer: Mutex::new(Observer::default()),
            coordinator: Arc::new(Coordinator::new(backend, editors)),
            app,
        })
    });
}
pub fn observe(projection: &Value) {
    let Some(owner) = OWNER.get().cloned() else {
        return;
    };
    let Ok(selection) = crate::station_selection::retained_snapshot() else {
        return;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    let qsy = owner
        .observer
        .lock()
        .ok()
        .and_then(|mut observer| observer.observe(projection, &selection, now));
    let Some(qsy) = qsy else {
        return;
    };
    let Ok(cluster) =
        crate::cluster_session::owner(&owner.app).and_then(|owner| owner.projection_value())
    else {
        return;
    };
    let Some(cluster_selection_revision) = cluster["selection_revision"].as_u64() else {
        return;
    };
    std::thread::spawn(move || {
        crate::radio_read::retire_terminal();
        owner.coordinator.execute(TransactionRequest {
            operation_id: uuid::Uuid::new_v4().to_string(),
            qsy,
            cluster_selection_revision,
        });
    });
}
pub fn snapshot() -> Option<Value> {
    OWNER.get().map(|owner| owner.coordinator.snapshot())
}
pub fn owns(operation: &str) -> bool {
    snapshot().is_some_and(|value| value["operationId"] == operation)
}
pub fn reservation_active() -> bool {
    snapshot().is_some_and(|value| value["reservationActive"] == true)
}
pub fn retire_terminal() {
    if let Some(owner) = OWNER.get() {
        owner.coordinator.retire_terminal();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn id() -> String {
        uuid::Uuid::new_v4().to_string()
    }
    fn selection(control_revision: u64) -> Value {
        json!({"provider":"direct_agent","selection_id":id(),"generation":3,"control_revision":control_revision})
    }
    fn projection(selection: &Value, revision: u64, rx: u64, tx: u64, now: u64) -> Value {
        json!({
            "revision":revision,"available":true,"provider":"direct_agent","selection_id":selection["selection_id"],"selection_generation":3,"received_at_ms":now,
            "snapshot":{"source":"direct_agent","generated_at":now as f64/1000.0,"station":{"radio_stale":false},
                "radio":{"connected":true,"observed":true,"observed_at":now as f64/1000.0,"transmitting":false,
                    "receive_frequency_hz":rx,"transmit_frequency_hz":tx,"frequency_hz":tx,"mode":"USB"}}
        })
    }

    #[test]
    fn arbitrary_split_tx_is_ignored_and_two_rx_observations_confirm() {
        let selection = selection(0);
        let now = 10_000;
        let mut observer = Observer::default();
        assert_eq!(
            observer.observe(
                &projection(&selection, 1, 14_200_000, 14_230_000, now),
                &selection,
                now
            ),
            None
        );
        assert_eq!(
            observer.observe(
                &projection(&selection, 2, 14_210_000, 29_900_000, now + 1),
                &selection,
                now + 1
            ),
            None
        );
        let qsy = observer
            .observe(
                &projection(&selection, 3, 14_210_000, 14_999_999, now + 2),
                &selection,
                now + 2,
            )
            .unwrap();
        assert_eq!(qsy.receive_frequency_hz, 14_210_000);
    }

    #[test]
    fn reconnect_stale_and_selection_or_command_epoch_changes_only_seed_a_baseline() {
        let mut observer = Observer::default();
        let now = 10_000;
        let selected = selection(0);
        assert!(observer
            .observe(
                &projection(&selected, 1, 14_200_000, 14_230_000, now),
                &selected,
                now
            )
            .is_none());
        let mut stale = projection(&selected, 2, 14_210_000, 14_230_000, now);
        stale["received_at_ms"] = json!(0);
        assert!(observer.observe(&stale, &selected, now).is_none());
        assert!(observer
            .observe(
                &projection(&selected, 3, 14_210_000, 14_230_000, now),
                &selected,
                now
            )
            .is_none());
        let commanded = json!({"provider":"direct_agent","selection_id":selected["selection_id"],"generation":3,"control_revision":1});
        assert!(observer
            .observe(
                &projection(&commanded, 4, 14_220_000, 14_230_000, now),
                &commanded,
                now
            )
            .is_none());
        assert!(observer
            .observe(
                &projection(&commanded, 5, 14_220_000, 14_230_000, now + 1),
                &commanded,
                now + 1
            )
            .is_none());
    }

    struct Fake {
        canonical: Value,
        calls: AtomicUsize,
        fail_precommit: bool,
    }
    impl Backend for Fake {
        fn enabled(&self) -> Result<bool, String> {
            Ok(true)
        }
        fn canonical(&self, _: &TransactionRequest) -> Result<Value, String> {
            Ok(self.canonical.clone())
        }
        fn open_editors(&self) -> Result<Vec<String>, String> {
            Ok(vec![])
        }
        fn publish(&self, _: &Value) {}
        fn precommit(&self, _: &TransactionRequest) -> Result<(), String> {
            if self.fail_precommit {
                Err("Selection changed".into())
            } else {
                Ok(())
            }
        }
        fn apply(&self, request: &TransactionRequest, canonical: &Value) -> Result<Value, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(
                json!({"status":"applied","receipt":{"mutation":{"operationID":request.operation_id.to_uppercase()},"draft":{"generation":canonical["generation"],
                "revision":canonical["revision"].as_u64().unwrap()+1,"qso":{"id":id(),"call":"","frequencyHz":request.qsy.receive_frequency_hz}}}}),
            )
        }
    }
    fn request() -> TransactionRequest {
        TransactionRequest {
            operation_id: id(),
            cluster_selection_revision: 7,
            qsy: ConfirmedQSY {
                epoch: SourceEpoch {
                    provider: "direct_agent".into(),
                    selection_id: id(),
                    selection_generation: 3,
                    control_revision: 0,
                },
                telemetry_revision: 9,
                receive_frequency_hz: 14_200_000,
                observed_mode: "USB".into(),
            },
        }
    }
    #[test]
    fn transaction_applies_once_only_after_editor_admission_and_precommit() {
        let canonical = json!({"generation":id(),"revision":2,"qso":{"id":id(),"call":"VK8TEST"}});
        let backend = Arc::new(Fake {
            canonical,
            calls: AtomicUsize::new(0),
            fail_precommit: false,
        });
        let coordinator = Coordinator::new(backend.clone(), Arc::new(EditorBarrier::default()));
        assert_eq!(coordinator.execute(request())["phase"], "confirmed");
        assert_eq!(backend.calls.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn changed_epoch_or_selection_vetoes_before_worker_mutation() {
        let canonical = json!({"generation":id(),"revision":2,"qso":{"id":id(),"call":"VK8TEST"}});
        let backend = Arc::new(Fake {
            canonical,
            calls: AtomicUsize::new(0),
            fail_precommit: true,
        });
        let coordinator = Coordinator::new(backend.clone(), Arc::new(EditorBarrier::default()));
        assert_eq!(coordinator.execute(request())["phase"], "blocked");
        assert_eq!(backend.calls.load(Ordering::SeqCst), 0);
    }
}
