//! Application-owned radio choice. Opening views is read-only; handover is explicit.
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{Emitter, Manager};
type Transport = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn() + Send + Sync;
struct State {
    provider: Option<String>,
    generation: u64,
    controls: usize,
}
pub struct Selection {
    state: Mutex<State>,
    path: PathBuf,
    transport: Arc<Transport>,
    publish: Arc<Publish>,
    stopped: AtomicBool,
}
fn value(state: &State) -> Value {
    json!({"provider":state.provider,"generation":state.generation})
}
pub fn validate(label: &str, isolated: bool, mutation: bool) -> Result<(), String> {
    if isolated || !(label == "main" || label == "monitor" && !mutation) {
        return Err("Radio selection is unavailable in this window.".into());
    }
    Ok(())
}
impl Selection {
    fn new(
        path: PathBuf,
        transport: Arc<Transport>,
        publish: Arc<Publish>,
    ) -> Result<Self, String> {
        let provider = match std::fs::read(&path) {
            Ok(bytes) => {
                let stored: Value = serde_json::from_slice(&bytes)
                    .map_err(|_| "Saved radio selection is invalid; it was not overwritten.")?;
                let provider = stored["provider"]
                    .as_str()
                    .filter(|value| crate::station_telemetry::valid_provider(value));
                if stored["version"] != 1 || provider.is_none() {
                    return Err(
                        "Saved radio selection is unsupported; it was not overwritten.".into(),
                    );
                }
                provider.map(str::to_owned)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Saved radio selection could not be read.".into()),
        };
        Ok(Self {
            state: Mutex::new(State {
                provider,
                generation: 0,
                controls: 0,
            }),
            path,
            transport,
            publish,
            stopped: AtomicBool::new(false),
        })
    }
    fn active(&self) -> Result<(), String> {
        if self.stopped.load(Ordering::Acquire) {
            Err("Radio session is shutting down.".into())
        } else {
            Ok(())
        }
    }
    fn save(&self, provider: &str) -> Result<(), String> {
        let directory = self
            .path
            .parent()
            .ok_or("Radio selection directory is unavailable")?;
        std::fs::create_dir_all(directory)
            .map_err(|_| "Radio selection directory could not be created")?;
        let mut file = tempfile::NamedTempFile::new_in(directory)
            .map_err(|_| "Radio selection could not be saved")?;
        file.write_all(
            json!({"version":1,"provider":provider})
                .to_string()
                .as_bytes(),
        )
        .map_err(|_| "Radio selection could not be saved")?;
        file.as_file()
            .sync_all()
            .map_err(|_| "Radio selection could not be saved")?;
        file.persist(&self.path)
            .map_err(|_| "Radio selection could not be saved")?;
        Ok(())
    }
    pub fn initialize(&self, legacy: Option<&str>) -> Result<Value, String> {
        let mut state = self
            .state
            .try_lock()
            .map_err(|_| "Radio session is busy; wait for its current action.")?;
        self.active()?;
        if state.provider.is_none() {
            let provider = legacy
                .filter(|value| crate::station_telemetry::valid_provider(value))
                .unwrap_or("direct_agent");
            self.save(provider)?;
            state.provider = Some(provider.into());
        }
        Ok(value(&state))
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        self.active()?;
        self.state
            .try_lock()
            .map(|state| value(&state))
            .map_err(|_| "Radio session is busy; wait for its current action.".into())
    }
    pub fn handover(&self, expected: u64, next: &str) -> Result<Value, String> {
        if !crate::station_telemetry::valid_provider(next) {
            return Err("Unknown radio provider.".into());
        }
        let mut state = self
            .state
            .try_lock()
            .map_err(|_| "Radio session is busy; wait for its current action.")?;
        self.active()?;
        if state.controls != 0 {
            return Err("Wait for the current radio action before changing radios.".into());
        }
        let previous = state
            .provider
            .as_deref()
            .ok_or("Read the radio selection before changing it.")?;
        if state.generation != expected {
            return Err("Radio selection changed. Review it before applying again.".into());
        }
        if previous == next {
            return Ok(value(&state));
        }
        if state.generation >= 9_007_199_254_740_990 {
            return Err("Radio selection generation exhausted.".into());
        }
        let id = format!("native-radio-handover-{}", state.generation);
        let request = if previous == "hamlib" {
            json!({"id":id,"method":"hamlib_disconnect","params":{"device":"radio"}})
        } else {
            json!({"id":id,"method":"station_disconnect","params":{"provider":previous}})
        };
        let result = (|| {
            let response = (self.transport)(request)?;
            self.active()?;
            if response["id"] != id || response["ok"] != true {
                return Err(response["error"]["message"]
                    .as_str()
                    .unwrap_or("Previous radio retirement was not confirmed.")
                    .to_owned());
            }
            // A failed save leaves the old choice authoritative and disconnected.
            // Never connect either radio or silently retry the retirement.
            self.save(next)?;
            state.provider = Some(next.into());
            state.generation += 1;
            Ok(value(&state))
        })();
        drop(state);
        (self.publish)();
        result
    }
    /// Exclude handover from radio writes, but preserve concurrent urgent actions
    /// such as PTT off / Clear CW. The existing radio backend arbitrates controls.
    pub fn control(&self, request: Value) -> Result<Value, String> {
        let mut state = self
            .state
            .try_lock()
            .map_err(|_| "Radio session is busy; wait for its current action.")?;
        self.active()?;
        let requested = if request["method"]
            .as_str()
            .is_some_and(|method| method.starts_with("hamlib_"))
        {
            Some("hamlib")
        } else {
            request["params"]["provider"].as_str()
        };
        if requested.is_none() || requested != state.provider.as_deref() {
            return Err(
                "Selected radio changed. Review its current selection before sending controls."
                    .into(),
            );
        }
        state.controls += 1;
        drop(state);
        let _guard = ControlGuard(self);
        let result = (self.transport)(request);
        self.active()?;
        result
    }
}
struct ControlGuard<'a>(&'a Selection);
impl Drop for ControlGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.controls = state.controls.saturating_sub(1);
        }
        (self.0.publish)();
    }
}
static OWNER: OnceLock<Mutex<Option<Arc<Selection>>>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<Selection>, String> {
    if STOPPED.load(Ordering::Acquire) {
        return Err("Radio session is shutting down.".into());
    }
    let mut slot = OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Radio selection is unavailable")?;
    if let Some(owner) = slot.as_ref() {
        return Ok(owner.clone());
    }
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Radio selection directory is unavailable")?
        .join("radio-selection.json");
    let events = app.clone();
    let owner = Arc::new(Selection::new(
        path,
        Arc::new(|request| {
            if request["method"]
                .as_str()
                .is_some_and(|method| method.starts_with("hamlib_"))
            {
                crate::hamlib::request(request)
            } else {
                crate::worker::request(request)
            }
        }),
        Arc::new(move || {
            for label in ["main", "monitor"] {
                let _ = events.emit_to(label, "xlog:station-selection", ());
            }
        }),
    )?);
    *slot = Some(owner.clone());
    Ok(owner)
}
pub fn shutdown() {
    STOPPED.store(true, Ordering::Release);
    if let Some(slot) = OWNER.get() {
        if let Ok(slot) = slot.lock() {
            if let Some(owner) = slot.as_ref() {
                owner.stopped.store(true, Ordering::Release);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Selection, Arc<Mutex<Vec<Value>>>) {
        let directory = tempfile::tempdir().unwrap();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Selection::new(
            directory.path().join("choice.json"),
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request.clone());
                Ok(json!({"id":request["id"],"ok":true,"result":{}}))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        (directory, owner, calls)
    }
    #[test]
    fn durable_selection_wins_over_stale_renderer_and_reads_never_control() {
        let (_directory, owner, calls) = fixture();
        assert_eq!(
            owner.initialize(Some("hamlib")).unwrap()["provider"],
            "hamlib"
        );
        assert_eq!(
            owner.initialize(Some("direct_agent")).unwrap()["provider"],
            "hamlib"
        );
        let reopened =
            Selection::new(owner.path.clone(), owner.transport.clone(), Arc::new(|| {})).unwrap();
        assert_eq!(
            reopened.initialize(Some("direct_flex_lan")).unwrap()["provider"],
            "hamlib"
        );
        assert!(calls.lock().unwrap().is_empty());
    }
    #[test]
    fn handover_retires_exact_radio_once_and_rejects_stale_generation() {
        let (_directory, owner, calls) = fixture();
        owner.initialize(Some("hamlib")).unwrap();
        assert_eq!(
            owner.handover(0, "direct_flex_lan").unwrap()["generation"],
            1
        );
        assert!(owner.handover(0, "direct_agent").is_err());
        assert!(owner
            .control(json!({"method":"hamlib_connect","params":{"device":"radio"}}))
            .is_err());
        let values = calls.lock().unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["method"], "hamlib_disconnect");
        assert_eq!(values[0]["params"], json!({"device":"radio"}));
    }
    #[test]
    fn unsuccessful_or_mismatched_retirement_keeps_prior_choice() {
        for response in [json!({"ok":false}), json!({"ok":true,"id":"wrong"})] {
            let (directory, owner, _) = fixture();
            owner.initialize(Some("direct_agent")).unwrap();
            let failed = Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |_| Ok(response.clone())),
                Arc::new(|| {}),
            )
            .unwrap();
            assert!(failed.handover(0, "hamlib").is_err());
            assert_eq!(failed.snapshot().unwrap()["provider"], "direct_agent");
        }
    }
    #[test]
    fn busy_handover_blocks_second_handover_and_radio_writes_without_queueing() {
        let (directory, owner, _) = fixture();
        owner.initialize(Some("direct_agent")).unwrap();
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let owner = Arc::new(
            Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    entered.send(()).unwrap();
                    finish.lock().unwrap().recv().unwrap();
                    Ok(json!({"id":request["id"],"ok":true}))
                }),
                Arc::new(|| {}),
            )
            .unwrap(),
        );
        let pending = owner.clone();
        let thread = std::thread::spawn(move || pending.handover(0, "hamlib"));
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert!(owner.handover(0, "direct_flex_lan").is_err());
        assert!(owner
            .control(json!({"method":"station_connect","params":{"provider":"direct_agent"}}))
            .is_err());
        release.send(()).unwrap();
        thread.join().unwrap().unwrap();
    }
    #[test]
    fn malformed_file_and_invalid_authority_do_not_silently_reset_choice() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("choice.json");
        std::fs::write(&path, "invalid").unwrap();
        assert!(
            Selection::new(path.clone(), Arc::new(|_| unreachable!()), Arc::new(|| {})).is_err()
        );
        assert_eq!(std::fs::read_to_string(path).unwrap(), "invalid");
        assert!(validate("main", false, true).is_ok());
        assert!(validate("monitor", false, false).is_ok());
        for (label, isolated, mutation) in [
            ("main", true, false),
            ("monitor", false, true),
            ("logbook", false, false),
            ("awards", false, true),
        ] {
            assert!(validate(label, isolated, mutation).is_err());
        }
    }
    #[test]
    fn save_failure_keeps_old_choice_and_never_connects_either_radio() {
        let (_directory, owner, calls) = fixture();
        owner.initialize(Some("direct_flex_lan")).unwrap();
        std::fs::remove_file(&owner.path).unwrap();
        std::fs::create_dir(&owner.path).unwrap();
        assert!(owner.handover(0, "hamlib").is_err());
        assert_eq!(
            owner.snapshot().unwrap(),
            json!({"provider":"direct_flex_lan","generation":0})
        );
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["method"], "station_disconnect");
        assert_eq!(calls[0]["params"], json!({"provider":"direct_flex_lan"}));
    }
    #[test]
    fn shutdown_prevents_commands_initialization_and_late_handover_commit() {
        let (directory, owner, calls) = fixture();
        owner.initialize(Some("hamlib")).unwrap();
        owner.stopped.store(true, Ordering::Release);
        assert!(owner.initialize(None).is_err());
        assert!(owner.handover(0, "direct_agent").is_err());
        assert!(owner
            .control(json!({"method":"hamlib_control","params":{"device":"radio"}}))
            .is_err());
        assert!(calls.lock().unwrap().is_empty());
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let pending = Arc::new(
            Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    entered.send(()).unwrap();
                    finish.lock().unwrap().recv().unwrap();
                    Ok(json!({"id":request["id"],"ok":true}))
                }),
                Arc::new(|| {}),
            )
            .unwrap(),
        );
        let target = pending.clone();
        let thread = std::thread::spawn(move || target.handover(0, "direct_agent"));
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        pending.stopped.store(true, Ordering::Release);
        release.send(()).unwrap();
        assert!(thread.join().unwrap().is_err());
        assert_eq!(
            pending.state.lock().unwrap().provider.as_deref(),
            Some("hamlib")
        );
    }
    #[test]
    fn in_flight_control_blocks_handover_but_not_an_urgent_control_to_same_radio() {
        let (directory, owner, _) = fixture();
        owner.initialize(Some("direct_agent")).unwrap();
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let pending = Arc::new(
            Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    if request["method"] == "station_tune" {
                        entered.send(()).unwrap();
                        finish.lock().unwrap().recv().unwrap();
                    }
                    Ok(json!({"id":request["id"],"ok":true}))
                }),
                Arc::new(|| {}),
            )
            .unwrap(),
        );
        let target = pending.clone();
        let thread = std::thread::spawn(move || {
            target.control(json!({"method":"station_tune","params":{"provider":"direct_agent"}}))
        });
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert!(pending.handover(0, "hamlib").is_err());
        assert!(pending
            .control(
                json!({"method":"station_ptt","params":{"provider":"direct_agent","enabled":false}})
            )
            .is_ok());
        assert_eq!(pending.snapshot().unwrap()["provider"], "direct_agent");
        release.send(()).unwrap();
        thread.join().unwrap().unwrap();
        assert_eq!(pending.state.lock().unwrap().controls, 0);
    }
}
