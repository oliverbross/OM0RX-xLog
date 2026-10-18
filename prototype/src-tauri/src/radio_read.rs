//! Explicit authoritative radio read into the canonical new-QSO draft.
//! Renderers receive no raw station API; native admission owns the radio
//! selection fence, editor barrier, worker generation and durable receipt.
use crate::spot_editor_barrier::EditorBarrier;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager};

const MAX_REVISION: u64 = 9_007_199_254_740_991;
static ADMITTED_READS: AtomicUsize = AtomicUsize::new(0);
pub struct ReadAdmission;
pub fn admit() -> ReadAdmission { ADMITTED_READS.fetch_add(1, Ordering::AcqRel); ReadAdmission }
impl Drop for ReadAdmission {
    fn drop(&mut self) { ADMITTED_READS.fetch_sub(1, Ordering::AcqRel); }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Canonical {
    pub(crate) worker: u64,
    pub(crate) generation: String,
    pub(crate) draft: String,
    pub(crate) revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Evidence {
    pub(crate) frequency_hz: u64,
    pub(crate) receive_frequency_hz: Option<u64>,
    pub(crate) observed_mode: String,
}

pub trait Backend: Send + Sync {
    fn canonical(&self) -> Result<Canonical, String>;
    fn open_editors(&self) -> Result<Vec<String>, String>;
    fn transact(&self, operation: &str, canonical: &Canonical)
        -> Result<(Evidence, Value), String>;
    fn publish(&self, snapshot: &Value);
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
            latest: Mutex::new(idle()),
        }
    }
    pub fn snapshot(&self) -> Value {
        self.latest
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| idle())
    }
    pub fn owns(&self, operation: &str) -> bool {
        self.snapshot()["operationId"].as_str() == Some(operation)
    }
    pub fn reservation_active(&self) -> bool {
        self.snapshot()["reservationActive"] == true
    }
    pub fn retire_terminal(&self) {
        if let Ok(mut latest) = self.latest.lock() {
            if latest["reservationActive"] != true {
                *latest = idle();
            }
        }
    }
    fn recover(&self, operation: &str, generation: Option<&str>, receipt: impl FnOnce(&str) -> Result<Value, String>) -> Result<Value, String> {
        uuid::Uuid::parse_str(operation).map_err(|_| "Invalid radio-read recovery identity.")?;
        // Receipt absence is conclusive only while no read can still commit.
        let _active = self.active.try_lock().map_err(|_| "A radio read is still active. Check its outcome again after it finishes.")?;
        if ADMITTED_READS.load(Ordering::Acquire) != 0 { return Err("A radio read is still pending. Check its outcome again after it finishes.".into()); }
        if self.reservation_active() { return Err("A radio-read reservation is still active.".into()); }
        let Some(generation) = generation else {
            return Ok(terminal(operation, "This older Read radio journal has no workspace identity. The current draft was checked; no radio read was repeated."));
        };
        uuid::Uuid::parse_str(generation).map_err(|_| "Invalid radio-read recovery workspace.")?;
        let result = receipt(generation)?;
        if result["status"] == "workspace_changed" {
            return Ok(terminal(operation, "The Read radio workspace changed. Its old operation was not replayed; review the current draft."));
        }
        if result.get("receipt") == Some(&Value::Null) {
            return Ok(terminal(operation, "No durable Read radio receipt exists in the original workspace. The current draft was checked; no radio read was repeated."));
        }
        let receipt = &result["receipt"];
        let verified = (|| -> Result<(), String> {
            let canonical = Canonical { worker: 0, generation: generation.into(),
                draft: receipt["mutation"]["draftID"].as_str().filter(|id| uuid::Uuid::parse_str(id).is_ok()).ok_or("Recovered draft identity is invalid.")?.into(),
                revision: receipt["mutation"]["expectedRevision"].as_u64().filter(|revision| *revision < MAX_REVISION).ok_or("Recovered draft revision is invalid.")? };
            let evidence = Evidence { frequency_hz: receipt["draft"]["qso"]["frequencyHz"].as_u64().filter(|value| (1..=1_000_000_000_000).contains(value)).ok_or("Recovered radio frequency is invalid.")?,
                receive_frequency_hz: receipt["draft"]["qso"]["receiveFrequencyHz"].as_u64(),
                observed_mode: String::new() };
            verify(operation, &canonical, &evidence, &json!({"status":"applied","receipt":receipt}))
        })();
        if verified.is_err() {
            return Ok(terminal(operation, "The old Read radio receipt no longer matches its admitted transaction. It was retired without replaying a radio read."));
        }
        Ok(json!({"operationId":operation,"phase":"confirmed","barrier":null,"admitted":true,
            "reservationActive":false,"draftOnly":true,"intent":"read-radio","tuneConfirmed":false,"rotor":"not-requested"}))
    }
    fn store(&self, value: Value) -> Value {
        if let Ok(mut latest) = self.latest.lock() {
            *latest = value.clone();
        }
        self.backend.publish(&value);
        value
    }
    pub fn execute(&self, operation: String) -> Value {
        let Ok(_active) = self.active.try_lock() else {
            // The active operation remains the only retained status. Returning a
            // one-shot rejection for the competing caller must not hide the
            // barrier that the registered editors still need to acknowledge.
            return terminal(&operation, "Another radio read is already in progress.");
        };
        let result = (|| -> Result<Value, String> {
            uuid::Uuid::parse_str(&operation)
                .map_err(|_| "Invalid radio-read operation identity.")?;
            let canonical = self.backend.canonical()?;
            let editors = self.backend.open_editors()?;
            self.editors.begin(
                &operation,
                &canonical.generation,
                &canonical.draft,
                canonical.revision,
                &editors,
            )?;
            let barrier = self.editors.snapshot()?;
            self.store(
                json!({"operationId":operation,"phase":"preparing","barrier":barrier,
                "admitted":false,"reservationActive":true,"draftOnly":true,"intent":"read-radio"}),
            );
            self.editors
                .wait_ready(&operation, Duration::from_secs(3))?;
            let (evidence, response) = self.backend.transact(&operation, &canonical)?;
            verify(&operation, &canonical, &evidence, &response)?;
            self.editors.finish(&operation)?;
            Ok(
                json!({"operationId":operation,"phase":"confirmed","barrier":null,"admitted":true,
                "reservationActive":false,"draftOnly":true,"intent":"read-radio","tuneConfirmed":false,"rotor":"not-requested"}),
            )
        })();
        match result {
            Ok(value) => self.store(value),
            Err(error) => {
                let _ = self.editors.finish(&operation);
                self.store(terminal(&operation, &error))
            }
        }
    }
}

fn idle() -> Value {
    json!({"operationId":null,"phase":"idle","barrier":null})
}
fn terminal(operation: &str, error: &str) -> Value {
    json!({"operationId":operation,"phase":"blocked","barrier":null,"admitted":false,
        "reservationActive":false,"draftOnly":true,"intent":"read-radio","tuneConfirmed":false,
        "rotor":"not-requested","error":error})
}
pub(crate) fn verify(
    operation: &str,
    canonical: &Canonical,
    evidence: &Evidence,
    response: &Value,
) -> Result<(), String> {
    let receipt = &response["receipt"];
    if response["status"] != "applied"
        || receipt["mutation"]["operationID"].as_str() != Some(operation)
        || receipt["mutation"]["draftID"].as_str() != Some(&canonical.draft)
        || receipt["mutation"]["expectedRevision"].as_u64() != Some(canonical.revision)
        || receipt["mutation"]["action"] != "replace"
        || receipt["draft"]["generation"].as_str() != Some(&canonical.generation)
        || receipt["draft"]["revision"].as_u64() != canonical.revision.checked_add(1)
        || receipt["draft"]["qso"]["id"].as_str() != Some(&canonical.draft)
        || receipt["draft"]["qso"]["frequencyHz"].as_u64() != Some(evidence.frequency_hz)
        || receipt["draft"]["qso"]["receiveFrequencyHz"].as_u64() != evidence.receive_frequency_hz
        || !receipt["draft"]["qso"]["mode"]
            .as_str()
            .is_some_and(|mode| !mode.is_empty())
    {
        return Err("Durable radio-read receipt did not match the admitted transaction.".into());
    }
    Ok(())
}

pub(crate) struct NativeBackend {
    pub(crate) app: tauri::AppHandle,
}
impl NativeBackend {
    pub(crate) fn call(worker: u64, method: &str, params: Value) -> Result<Value, String> {
        let request = json!({"id":format!("native-radio-read-{}",uuid::Uuid::new_v4()),"method":method,"params":params});
        let response = crate::worker::request_existing_generation(request.clone(), worker)?;
        crate::worker::require_existing_generation(worker)?;
        if response["id"] != request["id"]
            || response["ok"] != true
            || !response["result"].is_object()
        {
            return Err(response["error"]["message"]
                .as_str()
                .unwrap_or("Native radio read was not confirmed")
                .to_owned());
        }
        Ok(response["result"].clone())
    }
    fn evidence(provider: &str, value: &Value) -> Result<Evidence, String> {
        let parse_frequency = |value: &Value| {
            value.as_u64().or_else(|| value.as_str()?.parse().ok())
                .filter(|value| (1..=1_000_000_000_000).contains(value))
        };
        let parse_split = |value: &Value| match (value.as_bool(), value.as_i64(), value.as_str()) {
            (Some(value), _, _) => Some(value),
            (_, Some(0), _) => Some(false),
            (_, Some(1), _) => Some(true),
            (_, _, Some("0")) => Some(false),
            (_, _, Some("1")) => Some(true),
            _ => None,
        };
        let (frequency_hz, receive_frequency_hz, mode) = if provider == "hamlib" {
            let receive = parse_frequency(&value["fields"]["frequency"]["Frequency"])
                .ok_or("Radio receive frequency is not currently observed.")?;
            let split = parse_split(&value["fields"]["split"]["Split"])
                .ok_or("Radio split state is not currently observed.")?;
            let frequency = if split {
                parse_frequency(&value["fields"]["tx_frequency"]["TX Frequency"])
                    .ok_or("Radio transmit frequency is not currently observed.")?
            } else { receive };
            (frequency, split.then_some(receive), value["fields"]["mode"]["Mode"].as_str())
        } else {
            if value["source"].as_str() != Some(provider)
                || value["radio"]["connected"] != true
                || value["radio"]["observed"] != true
            {
                return Err("Radio frequency and mode are not currently observed.".into());
            }
            let radio = &value["radio"];
            let split = radio["split"].as_bool()
                .ok_or("Radio split state is not currently observed.")?;
            let receive = (if radio["receive_frequency_hz"].is_null() {
                parse_frequency(&radio["frequency_hz"])
            } else {
                parse_frequency(&radio["receive_frequency_hz"])
            })
                .ok_or("Radio receive frequency is not currently observed.")?;
            let frequency = if split {
                parse_frequency(&radio["transmit_frequency_hz"])
                    .ok_or("Radio transmit frequency is not currently observed.")?
            } else { receive };
            (frequency, split.then_some(receive), radio["mode"].as_str())
        };
        let observed_mode = mode
            .map(str::to_uppercase)
            .filter(|mode| {
                !mode.is_empty()
                    && mode.len() <= 16
                    && mode
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            })
            .ok_or("Radio mode is not currently observed.")?;
        Ok(Evidence {
            frequency_hz,
            receive_frequency_hz,
            observed_mode,
        })
    }
}
impl Backend for NativeBackend {
    fn canonical(&self) -> Result<Canonical, String> {
        let worker = crate::worker::generation();
        if worker == 0 {
            return Err("The existing logbook worker is unavailable.".into());
        }
        let result = Self::call(worker, "logbook_operator_draft", json!({}))?;
        let draft = &result["draft"];
        Ok(Canonical {
            worker,
            generation: draft["generation"]
                .as_str()
                .and_then(|value| uuid::Uuid::parse_str(value).ok())
                .ok_or("Canonical draft generation is invalid")?
                .to_string(),
            draft: draft["qso"]["id"]
                .as_str()
                .and_then(|value| uuid::Uuid::parse_str(value).ok())
                .ok_or("Canonical draft identity is invalid")?
                .to_string(),
            revision: draft["revision"]
                .as_u64()
                .filter(|value| *value < MAX_REVISION)
                .ok_or("Canonical draft revision is invalid")?,
        })
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
    ) -> Result<(Evidence, Value), String> {
        let selection = crate::station_selection::retained_snapshot()?;
        let provider = selection["provider"]
            .as_str()
            .filter(|provider| crate::station_telemetry::valid_provider(provider))
            .ok_or("Select a radio before reading it.")?
            .to_owned();
        let _selection_fence =
            crate::station_selection::owner(&self.app)?.fence_radio_read_epoch(&selection)?;
        let radio = if provider == "hamlib" {
            Self::call(
                canonical.worker,
                "hamlib_snapshot",
                json!({"device":"radio"}),
            )?
        } else {
            Self::call(
                canonical.worker,
                "station_snapshot",
                json!({"provider":provider}),
            )?
        };
        let evidence = Self::evidence(&provider, &radio)?;
        crate::worker::require_existing_generation(canonical.worker)?;
        let current = crate::station_selection::retained_snapshot()?;
        if current["provider"] != selection["provider"]
            || current["selection_id"] != selection["selection_id"]
            || current["generation"] != selection["generation"]
            || current["control_revision"] != selection["control_revision"]
        {
            return Err("Radio selection or command epoch changed during radio readback.".into());
        }
        let params = json!({"operationID":operation,"draftID":canonical.draft,"expectedRevision":canonical.revision,
            "generation":canonical.generation,"frequencyHz":evidence.frequency_hz,
            "receiveFrequencyHz":evidence.receive_frequency_hz,"observedMode":evidence.observed_mode});
        let response = match Self::call(
            canonical.worker,
            "logbook_operator_draft_radio_read",
            params,
        ) {
            Ok(result) => result,
            Err(original) => Self::call(
                canonical.worker,
                "logbook_operator_draft_receipt",
                json!({"operationID":operation,"generation":canonical.generation}),
            )
            .ok()
            .and_then(|value| {
                value
                    .get("receipt")
                    .filter(|value| value.is_object())
                    .cloned()
            })
            .map(|receipt| json!({"status":"applied","receipt":receipt}))
            .ok_or(original)?,
        };
        Ok((evidence, response))
    }
    fn publish(&self, snapshot: &Value) {
        for label in ["main", "log-qso", "logbook"] {
            let _ = self.app.emit_to(label, "xlog:spot-activation", ());
        }
        if snapshot["phase"] == "confirmed" {
            let _ = self.app.emit("xlog:operator-draft-changed", ());
        }
    }
}

static OWNER: OnceLock<Arc<Coordinator>> = OnceLock::new();
pub fn install(app: &tauri::AppHandle, editors: Arc<EditorBarrier>) {
    let app = app.clone();
    OWNER.get_or_init(|| Arc::new(Coordinator::new(Arc::new(NativeBackend { app }), editors)));
}
pub fn snapshot() -> Option<Value> {
    OWNER.get().map(|owner| owner.snapshot())
}
pub fn owns(operation: &str) -> bool {
    OWNER.get().is_some_and(|owner| owner.owns(operation))
}
pub fn reservation_active() -> bool {
    OWNER.get().is_some_and(|owner| owner.reservation_active())
}
pub fn retire_terminal() {
    if let Some(owner) = OWNER.get() {
        owner.retire_terminal();
    }
}
pub fn execute(operation: String) -> Result<Value, String> {
    OWNER
        .get()
        .cloned()
        .ok_or("Radio-read owner is unavailable.".into())
        .map(|owner| owner.execute(operation))
}
pub fn recover(operation: String, generation: Option<String>) -> Result<Value, String> {
    let owner = OWNER.get().ok_or("Radio-read owner is unavailable.")?;
    owner.recover(&operation, generation.as_deref(), |generation| {
        let worker = crate::worker::generation();
        crate::worker::require_existing_generation(worker)?;
        let result = NativeBackend::call(worker, "logbook_operator_draft_receipt", json!({"operationID":operation,"generation":generation}))?;
        crate::worker::require_existing_generation(worker)?;
        Ok(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    fn id() -> String {
        uuid::Uuid::new_v4().to_string()
    }
    fn canonical() -> Canonical {
        Canonical {
            worker: 1,
            generation: id(),
            draft: id(),
            revision: 7,
        }
    }
    #[test]
    fn recovery_uses_the_original_workspace_receipt_without_reading_or_mutating_radio() {
        let canonical = canonical();
        let backend = Arc::new(Fake { canonical: canonical.clone(), editors: vec![], bad: false, published: Mutex::new(Vec::new()) });
        let owner = Coordinator::new(backend, Arc::new(EditorBarrier::default()));
        let operation = id();
        let evidence = Evidence { frequency_hz: 14_200_000, receive_frequency_hz: None, observed_mode: "USB".into() };
        let result = receipt(&operation, &canonical, &evidence);
        assert_eq!(owner.recover(&operation, Some(&canonical.generation), |generation| {
            assert_eq!(generation, canonical.generation); Ok(json!({"receipt":result["receipt"]}))
        }).unwrap()["phase"], "confirmed");
        for result in [json!({"receipt":null}), json!({"status":"workspace_changed","generation":id()})] {
            assert_eq!(owner.recover(&operation, Some(&canonical.generation), |_| Ok(result)).unwrap()["phase"], "blocked");
        }
        assert_eq!(owner.recover(&operation, Some(&canonical.generation), |_| Ok(json!({}))).unwrap()["phase"], "blocked");
        let mut wrong = result; wrong["receipt"]["draft"]["generation"] = json!(id());
        let retired = owner.recover(&operation, Some(&canonical.generation), |_| Ok(wrong)).unwrap();
        assert_eq!(retired["phase"], "blocked");
        assert_eq!(retired["reservationActive"], false);
        assert!(retired["error"].as_str().unwrap().contains("retired without replaying"));
        assert_eq!(owner.recover(&operation, None, |_| panic!("legacy recovery must not invent a workspace")).unwrap()["phase"], "blocked");
        let _active = owner.active.lock().unwrap();
        assert!(owner.recover(&operation, Some(&canonical.generation), |_| panic!("active read cannot prove receipt absence")).is_err());
        drop(_active);
        let _pending = admit();
        assert!(owner.recover(&operation, Some(&canonical.generation), |_| panic!("queued read cannot prove receipt absence")).is_err());
    }
    fn receipt(operation: &str, canonical: &Canonical, evidence: &Evidence) -> Value {
        json!({"status":"applied","receipt":{"mutation":{"operationID":operation,"draftID":canonical.draft,
            "expectedRevision":canonical.revision,"action":"replace"},"draft":{"generation":canonical.generation,
            "revision":canonical.revision + 1,"qso":{"id":canonical.draft,"frequencyHz":evidence.frequency_hz,"mode":"SSB"}}}})
    }
    struct Fake {
        canonical: Canonical,
        editors: Vec<String>,
        bad: bool,
        published: Mutex<Vec<Value>>,
    }
    impl Backend for Fake {
        fn canonical(&self) -> Result<Canonical, String> {
            Ok(self.canonical.clone())
        }
        fn open_editors(&self) -> Result<Vec<String>, String> {
            Ok(self.editors.clone())
        }
        fn transact(
            &self,
            operation: &str,
            canonical: &Canonical,
        ) -> Result<(Evidence, Value), String> {
            let evidence = Evidence {
                frequency_hz: 14_200_000,
                receive_frequency_hz: None,
                observed_mode: "USB".into(),
            };
            let mut result = receipt(operation, canonical, &evidence);
            if self.bad {
                result["receipt"]["mutation"]["draftID"] = json!(id());
            }
            Ok((evidence, result))
        }
        fn publish(&self, snapshot: &Value) {
            self.published.lock().unwrap().push(snapshot.clone());
        }
    }
    #[test]
    fn exact_receipt_confirms_one_editor_admitted_read() {
        let backend = Arc::new(Fake {
            canonical: canonical(),
            editors: vec!["main".into()],
            bad: false,
            published: Mutex::new(Vec::new()),
        });
        let editors = Arc::new(EditorBarrier::default());
        let instance = id();
        editors.register("main", &instance).unwrap();
        let owner = Arc::new(Coordinator::new(backend, editors.clone()));
        let operation = id();
        let running = owner.clone();
        let task = std::thread::spawn(move || running.execute(operation));
        while owner.snapshot()["phase"] != "preparing" {
            std::thread::yield_now();
        }
        let barrier = owner.snapshot()["barrier"].clone();
        editors
            .acknowledge(
                "main",
                &instance,
                barrier["operationId"].as_str().unwrap(),
                barrier["barrierId"].as_str().unwrap(),
                true,
                None,
            )
            .unwrap();
        let result = task.join().unwrap();
        assert_eq!(result["phase"], "confirmed");
        assert!(!owner.reservation_active());
    }
    #[test]
    fn competing_read_cannot_shadow_the_active_barrier() {
        let backend = Arc::new(Fake {
            canonical: canonical(),
            editors: vec!["main".into()],
            bad: false,
            published: Mutex::new(Vec::new()),
        });
        let editors = Arc::new(EditorBarrier::default());
        let instance = id();
        editors.register("main", &instance).unwrap();
        let owner = Arc::new(Coordinator::new(backend, editors.clone()));
        let operation = id();
        let running = owner.clone();
        let task = std::thread::spawn({
            let operation = operation.clone();
            move || running.execute(operation)
        });
        while owner.snapshot()["phase"] != "preparing" {
            std::thread::yield_now();
        }
        let barrier = owner.snapshot()["barrier"].clone();
        let competing = owner.execute(id());
        assert_eq!(competing["phase"], "blocked");
        assert_eq!(owner.snapshot()["operationId"], operation);
        assert_eq!(owner.snapshot()["phase"], "preparing");
        editors
            .acknowledge(
                "main",
                &instance,
                barrier["operationId"].as_str().unwrap(),
                barrier["barrierId"].as_str().unwrap(),
                true,
                None,
            )
            .unwrap();
        assert_eq!(task.join().unwrap()["phase"], "confirmed");
    }
    #[test]
    fn missing_editor_registration_and_mismatched_receipt_fail_closed() {
        let missing = Coordinator::new(
            Arc::new(Fake {
                canonical: canonical(),
                editors: vec!["main".into()],
                bad: false,
                published: Mutex::new(Vec::new()),
            }),
            Arc::new(EditorBarrier::default()),
        );
        assert_eq!(missing.execute(id())["phase"], "blocked");
        let bad = Coordinator::new(
            Arc::new(Fake {
                canonical: canonical(),
                editors: vec![],
                bad: true,
                published: Mutex::new(Vec::new()),
            }),
            Arc::new(EditorBarrier::default()),
        );
        assert_eq!(bad.execute(id())["phase"], "blocked");
    }
    #[test]
    fn invalid_identity_and_unavailable_observation_are_rejected() {
        let owner = Coordinator::new(
            Arc::new(Fake {
                canonical: canonical(),
                editors: vec![],
                bad: false,
                published: Mutex::new(Vec::new()),
            }),
            Arc::new(EditorBarrier::default()),
        );
        assert_eq!(owner.execute("not-an-operation".into())["phase"], "blocked");
        for value in [
            json!({}),
            json!({"source":"direct_agent","radio":{"connected":true,"observed":false,"frequency_hz":14200000,"mode":"USB"}}),
        ] {
            assert!(NativeBackend::evidence("direct_agent", &value).is_err());
        }
        let simplex = NativeBackend::evidence("hamlib", &json!({"fields":{
            "frequency":{"Frequency":"7100000"},"mode":{"Mode":"LSB"},"split":{"Split":"0"}}})).unwrap();
        assert_eq!(simplex.frequency_hz, 7_100_000);
        assert_eq!(simplex.receive_frequency_hz, None);
        let split = NativeBackend::evidence("direct_agent", &json!({"source":"direct_agent","radio":{
            "connected":true,"observed":true,"receive_frequency_hz":28_012_000,
            "transmit_frequency_hz":28_015_000,"frequency_hz":28_012_000,"split":true,"mode":"CW"}})).unwrap();
        assert_eq!(split.frequency_hz, 28_015_000);
        assert_eq!(split.receive_frequency_hz, Some(28_012_000));
        let hamlib_split = NativeBackend::evidence("hamlib", &json!({"fields":{
            "frequency":{"Frequency":"28012000"},"mode":{"Mode":"CW"},"split":{"Split":"1"},
            "tx_frequency":{"TX Frequency":"28015000"}}})).unwrap();
        assert_eq!(hamlib_split.frequency_hz, 28_015_000);
        assert_eq!(hamlib_split.receive_frequency_hz, Some(28_012_000));
        for unavailable in [
            json!({"source":"direct_agent","radio":{"connected":true,"observed":true,"receive_frequency_hz":28_012_000,"mode":"CW"}}),
            json!({"source":"direct_agent","radio":{"connected":true,"observed":true,"receive_frequency_hz":28_012_000,"split":true,"mode":"CW"}}),
        ] { assert!(NativeBackend::evidence("direct_agent", &unavailable).is_err()); }
    }
}
