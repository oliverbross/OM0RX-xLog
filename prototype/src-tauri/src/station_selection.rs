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
struct PowerPublication {
    sequence: u64,
    context: (Option<String>, Option<String>),
    status: &'static str,
    error: String,
}
struct PowerNotice {
    sequence: u64,
    request: Value,
}
struct State {
    provider: Option<String>,
    selection_id: Option<String>,
    generation: u64,
    controls: usize,
}
pub struct Selection {
    state: Mutex<State>,
    path: PathBuf,
    transport: Arc<Transport>,
    publish: Arc<Publish>,
    power: Arc<Mutex<PowerPublication>>,
    stopped: Arc<AtomicBool>,
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
        let (provider, selection_id, migrate) = match std::fs::read(&path) {
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
                let selection_id = match stored.get("selection_id") {
                    None => uuid::Uuid::new_v4().to_string(),
                    Some(Value::String(value)) => {
                        let id = uuid::Uuid::parse_str(value).map_err(|_| {
                            "Saved radio selection identity is invalid; it was not overwritten."
                        })?;
                        if id.is_nil() {
                            return Err("Saved radio selection identity is invalid; it was not overwritten.".into());
                        }
                        id.to_string()
                    }
                    _ => {
                        return Err(
                            "Saved radio selection identity is invalid; it was not overwritten."
                                .into(),
                        )
                    }
                };
                (
                    provider.map(str::to_owned),
                    Some(selection_id),
                    stored.get("selection_id").is_none(),
                )
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, None, false),
            Err(_) => return Err("Saved radio selection could not be read.".into()),
        };
        let owner = Self {
            state: Mutex::new(State {
                provider,
                selection_id,
                generation: 0,
                controls: 0,
            }),
            path,
            transport,
            publish,
            power: Arc::new(Mutex::new(PowerPublication {
                sequence: 0,
                context: (None, None),
                status: "not_attempted",
                error: String::new(),
            })),
            stopped: Arc::new(AtomicBool::new(false)),
        };
        if migrate {
            let state = owner
                .state
                .lock()
                .map_err(|_| "Radio selection is unavailable")?;
            owner.save(
                state.provider.as_deref().unwrap(),
                state.selection_id.as_deref().unwrap(),
            )?;
        }
        Ok(owner)
    }
    fn active(&self) -> Result<(), String> {
        if self.stopped.load(Ordering::Acquire) {
            Err("Radio session is shutting down.".into())
        } else {
            Ok(())
        }
    }
    fn value(&self, state: &State) -> Value {
        let power = self.power.lock().unwrap_or_else(|error| error.into_inner());
        json!({"provider":state.provider,"generation":state.generation,"selection_id":state.selection_id,
            "power_notification":{"state":power.status,"error":power.error}})
    }
    fn save(&self, provider: &str, selection_id: &str) -> Result<(), String> {
        let directory = self
            .path
            .parent()
            .ok_or("Radio selection directory is unavailable")?;
        std::fs::create_dir_all(directory)
            .map_err(|_| "Radio selection directory could not be created")?;
        let mut file = tempfile::NamedTempFile::new_in(directory)
            .map_err(|_| "Radio selection could not be saved")?;
        file.write_all(
            json!({"version":1,"provider":provider,"selection_id":selection_id})
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
    fn power_notice(
        &self,
        provider: Option<&str>,
        selection_id: Option<&str>,
        optional: bool,
    ) -> Result<Option<PowerNotice>, String> {
        let mut power = self
            .power
            .lock()
            .map_err(|_| "Power notification status is unavailable")?;
        let context = (provider.map(str::to_owned), selection_id.map(str::to_owned));
        // A completion wake causes another renderer read. Coalesce that read,
        // including failures, rather than creating a notification feedback loop.
        if optional && power.context == context && power.status != "not_attempted" {
            return Ok(None);
        }
        power.sequence = power
            .sequence
            .checked_add(1)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or("Power notification sequence exhausted")?;
        power.context = context;
        power.status = "pending";
        power.error.clear();
        let id = format!("native-power-selection-{}", uuid::Uuid::new_v4());
        Ok(Some(PowerNotice {
            sequence: power.sequence,
            request: json!({"id":id,"method":"station_power_selection",
            "params":{"provider":provider,"selection_id":selection_id,"sequence":power.sequence}}),
        }))
    }
    fn send_power(transport: &Transport, notice: &PowerNotice) -> Result<(), String> {
        let response = transport(notice.request.clone())?;
        if response["id"] != notice.request["id"]
            || response["ok"] != true
            || response["result"]["accepted"] != true
        {
            return Err(response["error"]["message"]
                .as_str()
                .unwrap_or("Power selection was not confirmed.")
                .to_owned());
        }
        Ok(())
    }
    fn finish_power(
        power: &Mutex<PowerPublication>,
        sequence: u64,
        result: &Result<(), String>,
    ) -> bool {
        let mut power = power.lock().unwrap_or_else(|error| error.into_inner());
        if power.sequence != sequence {
            return false;
        }
        power.status = if result.is_ok() {
            "ready"
        } else {
            "unavailable"
        };
        power.error = result
            .as_ref()
            .err()
            .map(|error| error.chars().take(256).collect())
            .unwrap_or_default();
        true
    }
    fn notify_power(
        &self,
        provider: Option<&str>,
        selection_id: Option<&str>,
    ) -> Result<(), String> {
        let notice = self.power_notice(provider, selection_id, false)?.unwrap();
        let result = Self::send_power(self.transport.as_ref(), &notice);
        Self::finish_power(&self.power, notice.sequence, &result);
        result
    }
    fn queue_power(
        &self,
        provider: Option<&str>,
        selection_id: Option<&str>,
    ) -> Result<(), String> {
        let Some(notice) = self.power_notice(provider, selection_id, true)? else {
            return Ok(());
        };
        let transport = self.transport.clone();
        let power = self.power.clone();
        let publish = self.publish.clone();
        let stopped = self.stopped.clone();
        let sequence = notice.sequence;
        if std::thread::Builder::new()
            .name("xlog-power-selection".into())
            .spawn(move || {
                let result = if stopped.load(Ordering::Acquire) {
                    Err("Radio session is shutting down.".into())
                } else {
                    Self::send_power(transport.as_ref(), &notice)
                };
                if Self::finish_power(&power, notice.sequence, &result) {
                    publish();
                }
            })
            .is_err()
        {
            let result = Err("Power notification could not be queued".to_owned());
            Self::finish_power(&self.power, sequence, &result);
            return result;
        }
        Ok(())
    }
    /// Startup reads only native saved state. Unset preferences stay unset;
    /// publishing a choice never connects either radio transport.
    pub fn notify_saved(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Radio selection is unavailable")?;
        self.active()?;
        if state.provider.is_some() && state.controls == 0 {
            self.queue_power(state.provider.as_deref(), state.selection_id.as_deref())?;
        }
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
            let selection_id = uuid::Uuid::new_v4().to_string();
            self.save(provider, &selection_id)?;
            state.provider = Some(provider.into());
            state.selection_id = Some(selection_id);
        }
        // Power publication is optional for reading the selected radio. Its
        // failure is exposed as status, never substituted for the saved choice.
        if state.controls == 0 {
            // Reads cannot supersede a mandatory lifecycle's null fence while
            // that control awaits its acknowledgement or source operation.
            if let Err(error) =
                self.queue_power(state.provider.as_deref(), state.selection_id.as_deref())
            {
                let mut power = self
                    .power
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                power.status = "unavailable";
                power.error = error;
            }
        }
        self.active()?;
        Ok(self.value(&state))
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        self.active()?;
        self.state
            .try_lock()
            .map(|state| self.value(&state))
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
            .ok_or("Read the radio selection before changing it.")?
            .to_owned();
        let previous_id = state
            .selection_id
            .clone()
            .ok_or("Radio selection identity is unavailable")?;
        if state.generation != expected {
            return Err("Radio selection changed. Review it before applying again.".into());
        }
        if previous == next {
            return Ok(self.value(&state));
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
        let next_id = uuid::Uuid::new_v4().to_string();
        let mut saved_next = false;
        let result = (|| {
            self.notify_power(None, None)?;
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
            self.save(next, &next_id)?;
            saved_next = true;
            self.notify_power(Some(next), Some(&next_id))?;
            self.active()?;
            state.provider = Some(next.into());
            state.selection_id = Some(next_id.clone());
            state.generation += 1;
            Ok(self.value(&state))
        })();
        let result = match result {
            Err(error) if !self.stopped.load(Ordering::Acquire) => {
                if saved_next {
                    if let Err(rollback) = self.save(&previous, &previous_id) {
                        // The next saved choice is now authoritative. Never
                        // claim that the prior choice was restored in memory.
                        state.provider = Some(next.into());
                        state.selection_id = Some(next_id);
                        state.generation += 1;
                        let _ = self.notify_power(None, None);
                        drop(state);
                        (self.publish)();
                        return Err(format!("{error}; saved radio choice changed and could not be restored: {rollback}"));
                    }
                }
                match self.notify_power(Some(&previous), Some(&previous_id)) {
                    Ok(()) => Err(error),
                    Err(restore) => Err(format!(
                        "{error}; previous power selection could not be restored: {restore}"
                    )),
                }
            }
            other => other,
        };
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
        let lifecycle = matches!(
            request["method"].as_str(),
            Some(
                "station_connect"
                    | "station_reconnect"
                    | "station_forget"
                    | "hamlib_connect"
                    | "hamlib_reconnect"
            )
        );
        // Disconnect must reach the authoritative source shutdown even when
        // optional logging notification is unavailable. That source detaches
        // capture synchronously before awaiting station retirement.
        let provider = state.provider.clone();
        let selection_id = state.selection_id.clone();
        state.controls += 1;
        drop(state);
        let _guard = ControlGuard(self);
        let result = (|| {
            if lifecycle {
                self.notify_power(None, None)?;
            }
            (self.transport)(request)
        })();
        self.active()?;
        if lifecycle {
            if let Err(restore) = self.notify_power(provider.as_deref(), selection_id.as_deref()) {
                return Err(format!("Radio lifecycle finished, but power selection could not be restored: {restore}"));
            }
        }
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
                // Do not wait on a logging RPC ahead of worker EOF. Swift's
                // terminal shutdown terminates capture before its first await.
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reply(request: &Value, ok: bool) -> Value {
        json!({"id":request["id"],"ok":ok,"result":{"accepted":true}})
    }
    fn wait_for_power(owner: &Selection) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while owner.snapshot().unwrap()["power_notification"]["state"] == "pending" {
            assert!(
                std::time::Instant::now() < deadline,
                "fixture notification did not finish"
            );
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }
    fn initialized(owner: &Selection, legacy: Option<&str>) -> Value {
        owner.initialize(legacy).unwrap();
        wait_for_power(owner);
        owner.snapshot().unwrap()
    }
    fn choice(mut value: Value) -> Value {
        value.as_object_mut().unwrap().remove("power_notification");
        value
    }
    fn power_context(request: &Value) -> Value {
        let mut params = request["params"].clone();
        let sequence = params
            .as_object_mut()
            .unwrap()
            .remove("sequence")
            .unwrap()
            .as_u64()
            .unwrap();
        assert!((1..=9_007_199_254_740_991).contains(&sequence));
        params
    }
    #[test]
    fn optional_failure_is_visible_without_blocking_reads_or_ordinary_controls() {
        let (_directory, saved, _) = fixture();
        let selected = initialized(&saved, Some("direct_agent"));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Selection::new(
            saved.path.clone(),
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request.clone());
                if request["method"] == "station_power_selection" {
                    Err("Power feature unavailable".into())
                } else {
                    Ok(reply(&request, true))
                }
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        assert_eq!(
            choice(owner.initialize(Some("hamlib")).unwrap()),
            choice(selected.clone())
        );
        wait_for_power(&owner);
        let status = owner.snapshot().unwrap()["power_notification"].clone();
        assert_eq!(
            status,
            json!({"state":"unavailable","error":"Power feature unavailable"})
        );
        for _ in 0..20 {
            assert_eq!(
                choice(owner.initialize(None).unwrap()),
                choice(selected.clone())
            );
        }
        owner.control(json!({"id":"control","method":"station_tune","params":{"provider":"direct_agent"}})).unwrap();
        assert_eq!(
            calls
                .lock()
                .unwrap()
                .iter()
                .filter(|request| request["method"] == "station_power_selection")
                .count(),
            1
        );
        assert_eq!(owner.snapshot().unwrap()["power_notification"], status);
    }
    #[test]
    fn pending_optional_publication_holds_no_selection_lock_and_is_coalesced() {
        let (_directory, saved, _) = fixture();
        initialized(&saved, Some("direct_agent"));
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Selection::new(
            saved.path.clone(),
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request.clone());
                if request["method"] == "station_power_selection" {
                    entered.send(()).unwrap();
                    finish.lock().unwrap().recv().unwrap();
                }
                Ok(reply(&request, true))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        owner.notify_saved().unwrap();
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "pending"
        );
        for _ in 0..20 {
            assert_eq!(owner.initialize(None).unwrap()["provider"], "direct_agent");
        }
        owner.control(json!({"id":"control","method":"station_tune","params":{"provider":"direct_agent"}})).unwrap();
        assert_eq!(
            calls
                .lock()
                .unwrap()
                .iter()
                .filter(|request| request["method"] == "station_power_selection")
                .count(),
            1
        );
        release.send(()).unwrap();
        wait_for_power(&owner);
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
    }
    #[test]
    fn delayed_startup_cannot_replace_a_newer_handover_context() {
        let (_directory, saved, _) = fixture();
        initialized(&saved, Some("direct_agent"));
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let (finished, drained) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let gate = Arc::new(Mutex::new((0u64, Value::Null)));
        let receiver = gate.clone();
        let owner = Selection::new(saved.path.clone(), Arc::new(move |request| {
            if request["method"] != "station_power_selection" { return Ok(reply(&request, true)); }
            let sequence = request["params"]["sequence"].as_u64().unwrap();
            if sequence == 1 { entered.send(()).unwrap(); finish.lock().unwrap().recv().unwrap(); }
            let mut gate = receiver.lock().unwrap();
            let accepted = sequence > gate.0;
            if accepted { gate.0 = sequence; gate.1 = request["params"].clone(); }
            if sequence == 1 { finished.send(()).unwrap(); }
            Ok(json!({"id":request["id"],"ok":true,"result":{"accepted":accepted,"superseded":!accepted}}))
        }), Arc::new(|| {})).unwrap();
        owner.notify_saved().unwrap();
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let switched = owner.handover(0, "hamlib").unwrap();
        assert_eq!(switched["power_notification"]["state"], "ready");
        release.send(()).unwrap();
        drained
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let gate = gate.lock().unwrap();
        assert_eq!(gate.0, 3);
        assert_eq!(gate.1["provider"], "hamlib");
        assert_eq!(gate.1["selection_id"], switched["selection_id"]);
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
    }
    #[test]
    fn delayed_startup_context_cannot_rearm_a_disconnected_source() {
        let (_directory, saved, _) = fixture();
        initialized(&saved, Some("direct_agent"));
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        // Model the Swift gate's independent selection and source readiness:
        // source shutdown clears readiness before awaiting retirement.
        let gate = Arc::new(Mutex::new((Value::Null, true)));
        let receiver = gate.clone();
        let owner = Selection::new(
            saved.path.clone(),
            Arc::new(move |request| {
                if request["method"] == "station_power_selection" {
                    entered.send(()).unwrap();
                    finish.lock().unwrap().recv().unwrap();
                    receiver.lock().unwrap().0 = request["params"]["provider"].clone();
                } else if request["method"] == "station_disconnect" {
                    receiver.lock().unwrap().1 = false;
                }
                Ok(reply(&request, true))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        owner.notify_saved().unwrap();
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        owner.control(json!({"id":"disconnect","method":"station_disconnect","params":{"provider":"direct_agent"}})).unwrap();
        release.send(()).unwrap();
        wait_for_power(&owner);
        let gate = gate.lock().unwrap();
        assert_eq!(gate.0, "direct_agent");
        assert!(
            !gate.1,
            "Late selection metadata cannot restore source readiness"
        );
    }
    #[test]
    fn selection_reads_cannot_supersede_a_mandatory_reconnect_fence() {
        let (_directory, saved, _) = fixture();
        initialized(&saved, Some("direct_agent"));
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Arc::new(
            Selection::new(
                saved.path.clone(),
                Arc::new(move |request| {
                    recorded.lock().unwrap().push(request.clone());
                    if request["method"] == "station_power_selection"
                        && request["params"]["provider"].is_null()
                    {
                        entered.send(()).unwrap();
                        finish.lock().unwrap().recv().unwrap();
                    }
                    Ok(reply(&request, true))
                }),
                Arc::new(|| {}),
            )
            .unwrap(),
        );
        let pending = owner.clone();
        let thread = std::thread::spawn(move || {
            pending.control(json!({"id":"reconnect","method":"station_reconnect","params":{"provider":"direct_agent"}}))
        });
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        for _ in 0..20 {
            assert_eq!(owner.initialize(None).unwrap()["provider"], "direct_agent");
        }
        owner.notify_saved().unwrap();
        assert_eq!(calls.lock().unwrap().len(), 1);
        release.send(()).unwrap();
        thread.join().unwrap().unwrap();
        let requests = calls.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0]["params"]["sequence"], 1);
        assert_eq!(requests[1]["method"], "station_reconnect");
        assert_eq!(requests[2]["params"]["sequence"], 2);
    }
    fn fixture() -> (tempfile::TempDir, Selection, Arc<Mutex<Vec<Value>>>) {
        let directory = tempfile::tempdir().unwrap();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Selection::new(
            directory.path().join("choice.json"),
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request.clone());
                Ok(reply(&request, true))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        (directory, owner, calls)
    }
    #[test]
    fn saved_startup_migrates_identity_once_and_only_notifies_worker() {
        let (directory, owner, calls) = fixture();
        owner.notify_saved().unwrap();
        assert!(calls.lock().unwrap().is_empty());
        assert!(!owner.path.exists());
        std::fs::write(&owner.path, r#"{"version":1,"provider":"direct_agent"}"#).unwrap();
        let migrated =
            Selection::new(owner.path.clone(), owner.transport.clone(), Arc::new(|| {})).unwrap();
        let selection = migrated.snapshot().unwrap();
        let id = selection["selection_id"].as_str().unwrap();
        assert!(!uuid::Uuid::parse_str(id).unwrap().is_nil());
        migrated.notify_saved().unwrap();
        wait_for_power(&migrated);
        let reopened = Selection::new(
            directory.path().join("choice.json"),
            owner.transport.clone(),
            Arc::new(|| {}),
        )
        .unwrap();
        assert_eq!(reopened.snapshot().unwrap(), selection);
        let requests = calls.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["method"], "station_power_selection");
        assert_eq!(
            power_context(&requests[0]),
            json!({"provider":"direct_agent","selection_id":id})
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&owner.path).unwrap()).unwrap()
                ["selection_id"],
            id
        );
    }
    #[test]
    fn handover_fences_before_retirement_and_rotates_identity_only_on_switch() {
        let (_directory, owner, calls) = fixture();
        let initial = initialized(&owner, Some("direct_agent"));
        let previous = initial["selection_id"].as_str().unwrap();
        calls.lock().unwrap().clear();
        assert_eq!(owner.handover(0, "direct_agent").unwrap(), initial);
        assert!(calls.lock().unwrap().is_empty());
        let switched = owner.handover(0, "hamlib").unwrap();
        assert_ne!(switched["selection_id"], previous);
        let requests = calls.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0]["method"], "station_power_selection");
        assert_eq!(
            power_context(&requests[0]),
            json!({"provider":null,"selection_id":null})
        );
        assert_eq!(requests[1]["method"], "station_disconnect");
        assert_eq!(requests[1]["params"], json!({"provider":"direct_agent"}));
        assert_eq!(
            power_context(&requests[2]),
            json!({"provider":"hamlib","selection_id":switched["selection_id"]})
        );
    }
    #[test]
    fn reconnect_invalidates_before_transport_then_restores_stable_choice() {
        for (provider, method, params) in [
            (
                "direct_agent",
                "station_reconnect",
                json!({"provider":"direct_agent"}),
            ),
            ("hamlib", "hamlib_reconnect", json!({"device":"radio"})),
        ] {
            let (_directory, owner, calls) = fixture();
            let selected = initialized(&owner, Some(provider));
            calls.lock().unwrap().clear();
            owner
                .control(json!({"id":"reconnect","method":method,"params":params}))
                .unwrap();
            assert_eq!(owner.snapshot().unwrap(), selected);
            let requests = calls.lock().unwrap();
            assert_eq!(requests.len(), 3);
            assert_eq!(
                power_context(&requests[0]),
                json!({"provider":null,"selection_id":null})
            );
            assert_eq!(requests[1]["method"], method);
            assert_eq!(
                power_context(&requests[2]),
                json!({"provider":provider,"selection_id":selected["selection_id"]})
            );
        }
    }
    #[test]
    fn disconnect_never_depends_on_power_notifications_or_changes_its_result() {
        for (provider, method, params) in [
            (
                "direct_agent",
                "station_disconnect",
                json!({"provider":"direct_agent"}),
            ),
            ("hamlib", "hamlib_disconnect", json!({"device":"radio"})),
        ] {
            for response in [
                Ok(json!({"id":"disconnect","ok":true,"result":{"retired":true}})),
                Ok(
                    json!({"id":"disconnect","ok":false,"error":{"message":"Source retirement failed"}}),
                ),
                Err("Source transport unavailable".to_owned()),
            ] {
                let (_directory, saved, _) = fixture();
                let selected = initialized(&saved, Some(provider));
                let calls = Arc::new(Mutex::new(Vec::new()));
                let recorded = calls.clone();
                let result = response.clone();
                let owner = Selection::new(
                    saved.path.clone(),
                    Arc::new(move |request| {
                        assert_ne!(
                            request["method"], "station_power_selection",
                            "Logging must not delay disconnect"
                        );
                        recorded.lock().unwrap().push(request.clone());
                        result.clone()
                    }),
                    Arc::new(|| {}),
                )
                .unwrap();
                assert_eq!(
                    owner.control(json!({"id":"disconnect","method":method,"params":params})),
                    response
                );
                assert_eq!(choice(owner.snapshot().unwrap()), choice(selected));
                assert_eq!(calls.lock().unwrap().len(), 1);
            }
        }
    }
    #[test]
    fn failed_fence_never_retires_radio_and_restores_previous_context() {
        let (_directory, saved, _) = fixture();
        let previous = initialized(&saved, Some("hamlib"));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Selection::new(
            saved.path.clone(),
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request.clone());
                Ok(reply(&request, !request["params"]["provider"].is_null()))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        assert!(owner.handover(0, "direct_agent").is_err());
        assert_eq!(choice(owner.snapshot().unwrap()), choice(previous.clone()));
        let requests = calls.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests
            .iter()
            .all(|request| request["method"] == "station_power_selection"));
        assert_eq!(
            power_context(&requests[1]),
            json!({"provider":"hamlib","selection_id":previous["selection_id"]})
        );
    }
    #[test]
    fn failed_retirement_restores_exact_previous_identity_without_rotating() {
        let (_directory, saved, _) = fixture();
        let previous = initialized(&saved, Some("direct_agent"));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Selection::new(
            saved.path.clone(),
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request.clone());
                Ok(reply(
                    &request,
                    request["method"] == "station_power_selection",
                ))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        assert!(owner.handover(0, "hamlib").is_err());
        assert_eq!(choice(owner.snapshot().unwrap()), choice(previous.clone()));
        let requests = calls.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(
            power_context(&requests[2]),
            json!({"provider":"direct_agent","selection_id":previous["selection_id"]})
        );
    }
    #[test]
    fn failed_next_notification_rolls_back_saved_choice_before_restoring_context() {
        let (_directory, saved, _) = fixture();
        let previous = initialized(&saved, Some("direct_agent"));
        let saved_path = saved.path.clone();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Selection::new(
            saved.path.clone(),
            Arc::new(move |request| {
                if request["method"] == "station_power_selection"
                    && request["params"]["provider"] == "direct_agent"
                {
                    let disk: Value =
                        serde_json::from_slice(&std::fs::read(&saved_path).unwrap()).unwrap();
                    assert_eq!(disk["provider"], "direct_agent");
                    assert_eq!(disk["selection_id"], request["params"]["selection_id"]);
                }
                recorded.lock().unwrap().push(request.clone());
                Ok(reply(&request, request["params"]["provider"] != "hamlib"))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        assert!(owner.handover(0, "hamlib").is_err());
        assert_eq!(choice(owner.snapshot().unwrap()), choice(previous.clone()));
        let reopened =
            Selection::new(owner.path.clone(), saved.transport.clone(), Arc::new(|| {})).unwrap();
        assert_eq!(
            choice(reopened.snapshot().unwrap()),
            choice(previous.clone())
        );
        let requests = calls.lock().unwrap();
        assert_eq!(requests.len(), 4);
        assert_eq!(
            power_context(&requests[3]),
            json!({"provider":"direct_agent","selection_id":previous["selection_id"]})
        );
    }
    #[test]
    fn malformed_saved_identity_is_not_overwritten_or_notified() {
        for identity in [
            json!(null),
            json!("bad"),
            json!(uuid::Uuid::nil().to_string()),
            json!(4),
        ] {
            let (directory, owner, calls) = fixture();
            let bytes =
                json!({"version":1,"provider":"direct_agent","selection_id":identity}).to_string();
            std::fs::write(&owner.path, &bytes).unwrap();
            assert!(Selection::new(
                directory.path().join("choice.json"),
                owner.transport.clone(),
                Arc::new(|| {})
            )
            .is_err());
            assert_eq!(std::fs::read_to_string(owner.path).unwrap(), bytes);
            assert!(calls.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn durable_selection_wins_over_stale_renderer_and_reads_never_control() {
        let (_directory, owner, calls) = fixture();
        assert_eq!(initialized(&owner, Some("hamlib"))["provider"], "hamlib");
        assert_eq!(
            initialized(&owner, Some("direct_agent"))["provider"],
            "hamlib"
        );
        let reopened =
            Selection::new(owner.path.clone(), owner.transport.clone(), Arc::new(|| {})).unwrap();
        assert_eq!(
            initialized(&reopened, Some("direct_flex_lan"))["provider"],
            "hamlib"
        );
        assert!(calls
            .lock()
            .unwrap()
            .iter()
            .all(|request| request["method"] == "station_power_selection"));
    }
    #[test]
    fn handover_retires_exact_radio_once_and_rejects_stale_generation() {
        let (_directory, owner, calls) = fixture();
        initialized(&owner, Some("hamlib"));
        assert_eq!(
            owner.handover(0, "direct_flex_lan").unwrap()["generation"],
            1
        );
        assert!(owner.handover(0, "direct_agent").is_err());
        assert!(owner
            .control(json!({"method":"hamlib_connect","params":{"device":"radio"}}))
            .is_err());
        let calls = calls.lock().unwrap();
        let values: Vec<_> = calls
            .iter()
            .filter(|request| request["method"] != "station_power_selection")
            .collect();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["method"], "hamlib_disconnect");
        assert_eq!(values[0]["params"], json!({"device":"radio"}));
    }
    #[test]
    fn unsuccessful_or_mismatched_retirement_keeps_prior_choice() {
        for response in [json!({"ok":false}), json!({"ok":true,"id":"wrong"})] {
            let (directory, owner, _) = fixture();
            initialized(&owner, Some("direct_agent"));
            let failed = Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    if request["method"] == "station_power_selection" {
                        Ok(reply(&request, true))
                    } else {
                        Ok(response.clone())
                    }
                }),
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
        initialized(&owner, Some("direct_agent"));
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let owner = Arc::new(
            Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    if request["method"] != "station_power_selection" {
                        entered.send(()).unwrap();
                        finish.lock().unwrap().recv().unwrap();
                    }
                    Ok(reply(&request, true))
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
        initialized(&owner, Some("direct_flex_lan"));
        std::fs::remove_file(&owner.path).unwrap();
        std::fs::create_dir(&owner.path).unwrap();
        assert!(owner.handover(0, "hamlib").is_err());
        assert_eq!(owner.snapshot().unwrap()["provider"], "direct_flex_lan");
        assert_eq!(owner.snapshot().unwrap()["generation"], 0);
        let calls = calls.lock().unwrap();
        let calls: Vec<_> = calls
            .iter()
            .filter(|request| request["method"] != "station_power_selection")
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["method"], "station_disconnect");
        assert_eq!(calls[0]["params"], json!({"provider":"direct_flex_lan"}));
    }
    #[test]
    fn shutdown_prevents_commands_initialization_and_late_handover_commit() {
        let (directory, owner, calls) = fixture();
        initialized(&owner, Some("hamlib"));
        owner.stopped.store(true, Ordering::Release);
        assert!(owner.initialize(None).is_err());
        assert!(owner.handover(0, "direct_agent").is_err());
        assert!(owner
            .control(json!({"method":"hamlib_control","params":{"device":"radio"}}))
            .is_err());
        assert!(calls
            .lock()
            .unwrap()
            .iter()
            .all(|request| request["method"] == "station_power_selection"));
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let pending = Arc::new(
            Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    if request["method"] != "station_power_selection" {
                        entered.send(()).unwrap();
                        finish.lock().unwrap().recv().unwrap();
                    }
                    Ok(reply(&request, true))
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
        initialized(&owner, Some("direct_agent"));
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
                    Ok(reply(&request, true))
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
