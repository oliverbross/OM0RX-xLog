//! Explicit authoritative radio read into the canonical new-QSO draft.
//! Renderers receive no raw station API; native admission owns the radio
//! selection fence, editor barrier, worker generation and durable receipt.
use crate::spot_editor_barrier::EditorBarrier;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager};

const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Canonical {
    worker: u64,
    generation: String,
    draft: String,
    revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Evidence {
    frequency_hz: u64,
    observed_mode: String,
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
fn verify(
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
        || !receipt["draft"]["qso"]["mode"]
            .as_str()
            .is_some_and(|mode| !mode.is_empty())
    {
        return Err("Durable radio-read receipt did not match the admitted transaction.".into());
    }
    Ok(())
}

struct NativeBackend {
    app: tauri::AppHandle,
}
impl NativeBackend {
    fn call(worker: u64, method: &str, params: Value) -> Result<Value, String> {
        let request = json!({"id":format!("native-radio-read-{}",uuid::Uuid::new_v4()),"method":method,"params":params});
        let response = crate::worker::request_existing_generation(request.clone(), worker)?;
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
        let (frequency, mode) = if provider == "hamlib" {
            let frequency = value["fields"]["frequency"]["Frequency"]
                .as_u64()
                .or_else(|| {
                    value["fields"]["frequency"]["Frequency"]
                        .as_str()?
                        .parse()
                        .ok()
                });
            (frequency, value["fields"]["mode"]["Mode"].as_str())
        } else {
            if value["source"].as_str() != Some(provider)
                || value["radio"]["connected"] != true
                || value["radio"]["observed"] != true
            {
                return Err("Radio frequency and mode are not currently observed.".into());
            }
            (
                value["radio"]["frequency_hz"].as_u64(),
                value["radio"]["mode"].as_str(),
            )
        };
        let frequency_hz = frequency
            .filter(|value| (1..=1_000_000_000_000).contains(value))
            .ok_or("Radio frequency is not currently observed.")?;
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
            "generation":canonical.generation,"frequencyHz":evidence.frequency_hz,"observedMode":evidence.observed_mode});
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
        assert_eq!(
            NativeBackend::evidence(
                "hamlib",
                &json!({"fields":{"frequency":{"Frequency":"7100000"},"mode":{"Mode":"LSB"}}})
            )
            .unwrap()
            .frequency_hz,
            7_100_000
        );
    }
}
