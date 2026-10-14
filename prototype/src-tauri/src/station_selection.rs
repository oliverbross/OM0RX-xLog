//! Application-owned radio choice. Opening views is read-only; handover is explicit.
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{Emitter, Manager};
pub(crate) type Transport = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
type Publish = dyn Fn() + Send + Sync;
struct PowerPublication {
    worker_generation: u64,
    sequence: u64,
    context: (Option<String>, Option<String>),
    native_context: (Option<String>, Option<String>),
    status: &'static str,
    error: String,
}
struct PowerNotice {
    worker_generation: u64,
    sequence: u64,
    request: Value,
}
struct State {
    provider: Option<String>,
    selection_id: Option<String>,
    generation: u64,
    controls: usize,
    control_revision: u64,
    activation_tune: bool,
}
pub struct Selection {
    state: Mutex<State>,
    activity: AtomicUsize,
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
        let native_context = (provider.clone(), selection_id.clone());
        let owner = Self {
            state: Mutex::new(State {
                provider,
                selection_id,
                generation: 0,
                controls: 0,
                control_revision: 0,
                activation_tune: false,
            }),
            activity: AtomicUsize::new(0),
            path,
            transport,
            publish,
            power: Arc::new(Mutex::new(PowerPublication {
                worker_generation: 0,
                sequence: 0,
                context: (None, None),
                native_context,
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
        json!({"provider":state.provider,"generation":state.generation,"selection_id":state.selection_id,"control_revision":state.control_revision,
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
        Self::allocate_notice(&mut power, provider, selection_id, optional)
    }
    fn allocate_notice(
        power: &mut PowerPublication,
        provider: Option<&str>,
        selection_id: Option<&str>,
        optional: bool,
    ) -> Result<Option<PowerNotice>, String> {
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
            worker_generation: power.worker_generation,
            sequence: power.sequence,
            request: json!({"id":id,"method":"station_power_selection",
            "params":{"provider":provider,"selection_id":selection_id,"sequence":power.sequence}}),
        }))
    }
    fn remember_native_context(&self, state: &State) {
        self.power
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .native_context = (state.provider.clone(), state.selection_id.clone());
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
        worker_generation: u64,
        sequence: u64,
        result: &Result<(), String>,
    ) -> bool {
        let mut power = power.lock().unwrap_or_else(|error| error.into_inner());
        if power.worker_generation != worker_generation || power.sequence != sequence {
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
        Self::finish_power(
            &self.power,
            notice.worker_generation,
            notice.sequence,
            &result,
        );
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
        let worker_generation = notice.worker_generation;
        if std::thread::Builder::new()
            .name("xlog-power-selection".into())
            .spawn(move || {
                let result = if stopped.load(Ordering::Acquire) {
                    Err("Radio session is shutting down.".into())
                } else {
                    Self::send_power(transport.as_ref(), &notice)
                };
                if Self::finish_power(&power, notice.worker_generation, notice.sequence, &result) {
                    publish();
                }
            })
            .is_err()
        {
            let result = Err("Power notification could not be queued".to_owned());
            Self::finish_power(&self.power, worker_generation, sequence, &result);
            return result;
        }
        Ok(())
    }
    /// Invalidate the old acknowledgement synchronously, without the selection
    /// state lock: a mandatory handover may own that lock while starting Swift.
    /// Only the background metadata send waits for native controls to finish.
    fn worker_started(self: &Arc<Self>, generation: u64, transport: Arc<Transport>) {
        {
            let mut power = self.power.lock().unwrap_or_else(|error| error.into_inner());
            if generation <= power.worker_generation || self.stopped.load(Ordering::Acquire) {
                return;
            }
            power.worker_generation = generation;
            power.status = "not_attempted";
            power.error.clear();
        }
        let owner = self.clone();
        if std::thread::Builder::new()
            .name("xlog-power-bootstrap".into())
            .spawn(move || {
                let result = owner.bootstrap_worker(generation, transport.as_ref());
                if let Err(error) = result {
                    eprintln!("Native power selection unavailable: {error}");
                }
            })
            .is_err()
        {
            let mut power = self.power.lock().unwrap_or_else(|error| error.into_inner());
            if power.worker_generation == generation {
                power.status = "unavailable";
                power.error = "Power notification could not be queued".into();
            }
        }
        (self.publish)();
    }
    fn bootstrap_worker(&self, generation: u64, transport: &Transport) -> Result<(), String> {
        let notice = loop {
            self.active()?;
            let mut power = self
                .power
                .lock()
                .map_err(|_| "Power notification status is unavailable")?;
            if power.worker_generation != generation {
                return Ok(());
            }
            if self.activity.load(Ordering::Acquire) == 0 {
                let (provider, selection_id) = power.native_context.clone();
                // The committed native choice is mirrored here so optional
                // metadata never competes for foreground control's state lock.
                // Unset stays unset; no renderer preference/default is read.
                if provider.is_none() {
                    return Ok(());
                }
                break Self::allocate_notice(
                    &mut power,
                    provider.as_deref(),
                    selection_id.as_deref(),
                    true,
                )?;
            }
            drop(power);
            // Lifecycle activity begins before its null fence. A bootstrap
            // allocated just before that activity has an older sequence and
            // cannot supersede the fence. Never sleep holding either mutex.
            std::thread::sleep(std::time::Duration::from_millis(25));
        };
        let Some(notice) = notice else {
            return Ok(());
        };
        let result = Self::send_power(transport, &notice);
        if Self::finish_power(&self.power, generation, notice.sequence, &result) {
            (self.publish)();
        }
        result
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
            self.remember_native_context(&state);
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
    #[cfg(test)]
    pub fn handover(&self, expected: u64, next: &str) -> Result<Value, String> {
        self.handover_identity(expected, None, next)
    }
    pub fn handover_checked(&self, expected: u64, identity: &str, next: &str) -> Result<Value, String> {
        self.handover_identity(expected, Some(identity), next)
    }
    fn handover_identity(&self, expected: u64, identity: Option<&str>, next: &str) -> Result<Value, String> {
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
        if state.generation != expected || identity.is_some_and(|identity| state.selection_id.as_deref() != Some(identity)) {
            return Err("Radio selection changed. Review it before applying again.".into());
        }
        if previous == next {
            return Ok(self.value(&state));
        }
        if state.generation >= 9_007_199_254_740_990 {
            return Err("Radio selection generation exhausted.".into());
        }
        // Native callers may bypass renderer lifecycle hooks. Retire queued
        // automatic turns before the old source can be disconnected/replaced.
        crate::auto_rotor::revoke();
        let _activity = ActivityGuard::new(&self.activity);
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
            self.remember_native_context(&state);
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
                        self.remember_native_context(&state);
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
        self.control_scoped(request, None, || Ok(()))
    }
    pub fn monitor_action<G>(&self, request: Value, expected: u64, selection_id: &str, admit: impl FnOnce() -> Result<G, String>) -> Result<Value, String> {
        if expected > 9_007_199_254_740_991 || uuid::Uuid::parse_str(selection_id).is_err() {
            return Err("The observed radio selection is invalid.".into());
        }
        self.control_scoped(request, Some((expected, selection_id)), admit)
    }
    pub fn receive_control<G>(&self, request: Value, expected: u64, identity: &str, control_revision: u64,
        admit: impl FnOnce() -> Result<G, String>) -> Result<Value, String> {
        self.control_scoped_dispatch(request, Some((expected, identity, Some(control_revision))), admit, |request| (self.transport)(request))
    }
    /// Native spot tuning reserves nonurgent radio controls, not a transport or
    /// telemetry mutex. Source identity is rechecked at this admission point.
    pub(crate) fn activation_tune<G>(&self, request: Value, expected: &Value,
        admit: impl FnOnce() -> Result<G, String>, dispatch: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
        let mut state = self.state.try_lock().map_err(|_| "Radio session is busy; no spot tune was sent.")?;
        self.active()?;
        if state.controls != 0 || state.activation_tune
            || expected["provider"].as_str() != state.provider.as_deref()
            || expected["generation"].as_u64() != Some(state.generation)
            || expected["selection_id"].as_str() != state.selection_id.as_deref()
            || expected["control_revision"].as_u64() != Some(state.control_revision) {
            return Err("Radio selection or controls changed; no spot tune was sent.".into());
        }
        let method = request["method"].as_str();
        let provider = if method == Some("hamlib_control") && request["params"]["device"] == "radio"
            && request["params"]["action"] == "tune_simplex" { Some("hamlib") }
            else if method == Some("station_tune") { request["params"]["provider"].as_str() } else { None };
        if provider.is_none() || provider != state.provider.as_deref() { return Err("Invalid native spot tune route.".into()); }
        let next_revision = state.control_revision.checked_add(1).filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or("Radio control revision exhausted")?;
        let _admission = admit()?;
        state.control_revision = next_revision; state.activation_tune = true; state.controls += 1;
        let _activity = ActivityGuard::new(&self.activity);
        drop(state);
        let _guard = ActivationTuneGuard(self);
        let result = dispatch(request);
        self.active()?;
        result
    }
    fn control_scoped<G>(&self, request: Value, expected: Option<(u64, &str)>, admit: impl FnOnce() -> Result<G, String>) -> Result<Value, String> {
        self.control_scoped_dispatch(request, expected.map(|(generation, identity)| (generation, identity, None)), admit, |request| (self.transport)(request))
    }
    /// CW retains its worker identity: a restarted worker must never receive a
    /// delayed macro through the ordinary reconnecting transport.
    pub(crate) fn cw_control(&self, request: Value, expected: u64, selection_id: &str,
        dispatch: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
        self.control_scoped_dispatch(request, Some((expected, selection_id, None)), || Ok(()), dispatch)
    }
    fn control_scoped_dispatch<G>(&self, request: Value, expected: Option<(u64, &str, Option<u64>)>, admit: impl FnOnce() -> Result<G, String>,
        dispatch: impl FnOnce(Value) -> Result<Value, String>) -> Result<Value, String> {
        let mut state = self
            .state
            .try_lock()
            .map_err(|_| "Radio session is busy; wait for its current action.")?;
        self.active()?;
        if state.activation_tune && !urgent_release(&request) {
            return Err("A spot tune is in progress; only urgent release controls are available.".into());
        }
        if expected.is_some_and(|(generation, identity, revision)| state.generation != generation || state.selection_id.as_deref() != Some(identity)
            || revision.is_some_and(|revision| revision != state.control_revision)) {
            return Err("Selected radio changed. Refresh before sending another monitor action.".into());
        }
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
        // Only quick retained admission runs under this lock. Its guard, not
        // either mutex, lives through transport and excludes stale observations.
        let _admission = admit()?;
        state.control_revision = state.control_revision.checked_add(1).filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or("Radio control revision exhausted")?;
        if matches!(request["method"].as_str(), Some("station_connect" | "station_disconnect" | "station_reconnect"
            | "station_forget" | "station_configure" | "station_configuration_apply" | "hamlib_connect" | "hamlib_disconnect" | "hamlib_reconnect")) {
            crate::auto_rotor::revoke();
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
        let _activity = ActivityGuard::new(&self.activity);
        state.controls += 1;
        drop(state);
        let _guard = ControlGuard(self);
        let result = (|| {
            if lifecycle {
                self.notify_power(None, None)?;
            }
            dispatch(request)
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
fn urgent_release(request: &Value) -> bool {
    match request["method"].as_str() {
        Some("station_action") => request["params"]["action"] == "cancel",
        Some("station_radio_control") => request["params"]["control"] == "clear_cw"
            || request["params"]["control"] == "ptt" && request["params"]["enabled"] == false,
        Some("hamlib_control") => request["params"]["device"] == "radio" &&
            (request["params"]["action"] == "cw_stop" || request["params"]["action"] == "ptt" && request["params"]["on"] == false
             || request["params"]["action"] == "tuner" && request["params"]["on"] == false),
        _ => false,
    }
}
struct ActivationTuneGuard<'a>(&'a Selection);
impl Drop for ActivationTuneGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() { state.activation_tune = false; state.controls = state.controls.saturating_sub(1); }
        (self.0.publish)();
    }
}
struct ActivityGuard<'a>(&'a AtomicUsize);
impl<'a> ActivityGuard<'a> {
    fn new(activity: &'a AtomicUsize) -> Self {
        activity.fetch_add(1, Ordering::AcqRel);
        Self(activity)
    }
}
impl Drop for ActivityGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
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
/// Called after worker registry unlock. Never initializes a preference or sends
/// through worker::request, which would recurse back into active_session.
pub(crate) fn worker_generation_started(generation: u64, transport: Arc<Transport>) {
    if let Some(slot) = OWNER.get() {
        if let Ok(slot) = slot.lock() {
            if let Some(owner) = slot.as_ref() {
                owner.worker_started(generation, transport);
            }
        }
    }
}
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
    #[test]
    fn activation_admission_rechecks_source_without_sending_or_consuming_revision_on_rejection() {
        let (_directory, owner, calls) = fixture();
        let expected = initialized(&owner, Some("direct_agent"));
        let tune = json!({"id":"tune","method":"station_tune","params":{"provider":"direct_agent","frequency_hz":14025000,"mode":"CW"}});
        assert!(owner.activation_tune(tune, &expected, || Err::<(),String>("report changed".into()), |_| panic!("rejected source dispatched")).is_err());
        assert_eq!(owner.snapshot().unwrap()["control_revision"], expected["control_revision"]);
        assert!(!owner.state.lock().unwrap().activation_tune);
        assert!(calls.lock().unwrap().iter().all(|request| request["method"] == "station_power_selection"));
    }
    #[test]
    fn prior_radio_control_or_reconnect_invalidates_activation_preparation() {
        let (_directory, owner, _) = fixture(); let expected = initialized(&owner, Some("direct_agent"));
        owner.control(json!({"id":"reconnect","method":"station_reconnect","params":{"provider":"direct_agent"}})).unwrap();
        assert_eq!(owner.snapshot().unwrap()["generation"],expected["generation"]);
        assert!(owner.activation_tune(json!({"id":"tune","method":"station_tune","params":{"provider":"direct_agent"}}),
            &expected, || -> Result<(),String> { panic!("obsolete source admitted") }, |_| panic!("obsolete source dispatched")).is_err());
    }
    #[test]
    fn activation_excludes_nonurgent_controls_but_preserves_release_and_cleans_up_after_unknown_reply() {
        let (_directory, owner, _) = fixture(); let expected = initialized(&owner, Some("direct_agent"));
        let owner=Arc::new(owner);let pending=owner.clone();
        let (entered,ready)=std::sync::mpsc::channel();let (release,released)=std::sync::mpsc::channel();
        let task=std::thread::spawn(move || pending.activation_tune(
            json!({"id":"tune","method":"station_tune","params":{"provider":"direct_agent"}}),&expected,||Ok(()),|_| {
                entered.send(()).unwrap();released.recv_timeout(std::time::Duration::from_secs(5)).unwrap();Err("unknown tune reply".into())
            }));
        ready.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        for method in ["station_connect","station_reconnect","station_disconnect","station_tune"] {
            assert!(owner.control(json!({"id":method,"method":method,"params":{"provider":"direct_agent"}})).is_err(),"{method}");
        }
        assert!(owner.control(json!({"id":"off","method":"station_radio_control","params":{"provider":"direct_agent","control":"ptt","enabled":false}})).is_ok());
        assert!(owner.control(json!({"id":"cancel","method":"station_action","params":{"provider":"direct_agent","action":"cancel"}})).is_ok());
        assert!(owner.handover(0,"hamlib").is_err());
        release.send(()).unwrap();assert!(task.join().unwrap().is_err());
        assert!(!owner.state.lock().unwrap().activation_tune);assert_eq!(owner.state.lock().unwrap().controls,0);
        assert!(owner.control(json!({"id":"reconnect","method":"station_reconnect","params":{"provider":"direct_agent"}})).is_ok());
    }
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
        let selected = owner.snapshot().unwrap();
        assert_native_context(owner, &selected);
        selected
    }
    fn assert_native_context(owner: &Selection, selected: &Value) {
        let native = owner.power.lock().unwrap().native_context.clone();
        assert_eq!(
            json!({"provider":native.0,"selection_id":native.1}),
            json!({"provider":selected["provider"],"selection_id":selected["selection_id"]})
        );
        assert_eq!(owner.activity.load(Ordering::Acquire), 0);
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
    fn replacement_bootstraps_same_saved_identity_once_without_a_renderer_read() {
        let (_directory, selection, ordinary) = fixture();
        let selected = initialized(&selection, Some("direct_agent"));
        let owner = Arc::new(selection);
        let initial_calls = ordinary.lock().unwrap().len();
        let (sent, received) = std::sync::mpsc::channel();
        let transport: Arc<Transport> = Arc::new(move |request| {
            sent.send(request.clone()).unwrap();
            Ok(reply(&request, true))
        });
        owner.worker_started(1, transport.clone());
        let first = received
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        wait_for_power(&owner);
        owner.worker_started(2, transport.clone());
        let replacement = received
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        wait_for_power(&owner);
        for request in [&first, &replacement] {
            assert_eq!(request["method"], "station_power_selection");
            assert_eq!(request["params"]["provider"], selected["provider"]);
            assert_eq!(request["params"]["selection_id"], selected["selection_id"]);
        }
        assert!(
            replacement["params"]["sequence"].as_u64().unwrap()
                > first["params"]["sequence"].as_u64().unwrap()
        );
        owner.worker_started(2, transport);
        owner.notify_saved().unwrap();
        assert!(received.try_recv().is_err());
        assert_eq!(ordinary.lock().unwrap().len(), initial_calls);
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
    }
    #[test]
    fn first_start_from_saved_notification_recovers_even_when_original_notice_is_superseded() {
        let directory = tempfile::tempdir().unwrap();
        let selection_id = uuid::Uuid::new_v4().to_string();
        std::fs::write(
            directory.path().join("choice.json"),
            json!({"version":1,"provider":"direct_agent","selection_id":selection_id}).to_string(),
        )
        .unwrap();
        let slot: Arc<Mutex<Option<std::sync::Weak<Selection>>>> = Arc::new(Mutex::new(None));
        let callback_owner = slot.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let originals = Arc::new(Mutex::new(Vec::new()));
        let recorded = originals.clone();
        let exact: Arc<Transport> = Arc::new(move |request| {
            sent.send(request.clone()).unwrap();
            Ok(reply(&request, true))
        });
        let owner = Arc::new(Selection::new(directory.path().join("choice.json"), Arc::new(move |request| {
            recorded.lock().unwrap().push(request.clone());
            let owner = callback_owner.lock().unwrap().as_ref().unwrap().upgrade().unwrap();
            owner.worker_started(1, exact.clone());
            // A fresh-generation bootstrap can arrive before this original
            // queued startup notice; its older acknowledgement is nonfatal.
            Ok(json!({"id":request["id"],"ok":true,"result":{"accepted":false,"superseded":true}}))
        }), Arc::new(|| {})).unwrap());
        *slot.lock().unwrap() = Some(Arc::downgrade(&owner));
        owner.notify_saved().unwrap();
        let bootstrap = received
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        wait_for_power(&owner);
        assert_eq!(bootstrap["params"]["selection_id"], selection_id);
        assert!(
            bootstrap["params"]["sequence"].as_u64().unwrap()
                > originals.lock().unwrap()[0]["params"]["sequence"]
                    .as_u64()
                    .unwrap()
        );
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
    }
    #[test]
    fn obsolete_bootstrap_exits_while_handover_holds_selection_state() {
        let (_directory, selection, _) = fixture();
        let owner = Arc::new(selection);
        owner.power.lock().unwrap().worker_generation = 1;
        let held = owner.state.lock().unwrap();
        let waiting = owner.clone();
        let (finished, completed) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            finished
                .send(waiting.bootstrap_worker(1, &|_| panic!("obsolete must not send")))
                .unwrap();
        });
        owner.power.lock().unwrap().worker_generation = 2;
        completed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap()
            .unwrap();
        thread.join().unwrap();
        drop(held);
    }
    #[test]
    fn bootstrap_snapshot_does_not_acquire_the_foreground_control_mutex() {
        let (_directory, selection, _) = fixture();
        let selected = initialized(&selection, Some("direct_agent"));
        let owner = Arc::new(selection);
        {
            let mut power = owner.power.lock().unwrap();
            power.worker_generation = 1;
            power.status = "not_attempted";
        }
        let held = owner.state.lock().unwrap();
        let bootstrapping = owner.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            bootstrapping.bootstrap_worker(1, &move |request| {
                sent.send(request.clone()).unwrap();
                Ok(reply(&request, true))
            })
        });
        let request = received.recv_timeout(std::time::Duration::from_millis(250));
        // Always release/join the fixture before asserting, including the
        // failing-before implementation which waits on this foreground mutex.
        drop(held);
        thread.join().unwrap().unwrap();
        let request =
            request.expect("optional bootstrap must not acquire the foreground control mutex");
        assert_eq!(request["params"]["selection_id"], selected["selection_id"]);
    }
    #[test]
    fn replacement_bootstrap_waits_for_mandatory_reconnect_without_superseding_null() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("choice.json"), json!({"version":1,"provider":"direct_agent","selection_id":uuid::Uuid::new_v4().to_string()}).to_string()).unwrap();
        let slot: Arc<Mutex<Option<std::sync::Weak<Selection>>>> = Arc::new(Mutex::new(None));
        let callback_owner = slot.clone();
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        let owner = Arc::new(
            Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    if request["method"] == "station_power_selection"
                        && request["params"]["provider"].is_null()
                    {
                        let owner = callback_owner
                            .lock()
                            .unwrap()
                            .as_ref()
                            .unwrap()
                            .upgrade()
                            .unwrap();
                        owner.worker_started(
                            1,
                            Arc::new(|_| panic!("mandatory reconnect publishes final context")),
                        );
                        entered.send(()).unwrap();
                        finish.lock().unwrap().recv().unwrap();
                    }
                    Ok(reply(&request, true))
                }),
                Arc::new(|| {}),
            )
            .unwrap(),
        );
        *slot.lock().unwrap() = Some(Arc::downgrade(&owner));
        let reconnecting = owner.clone();
        let thread = std::thread::spawn(move || {
            reconnecting.control(json!({"id":"reconnect","method":"station_reconnect","params":{"provider":"direct_agent"}}))
        });
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert_eq!(owner.power.lock().unwrap().sequence, 1);
        owner.control(json!({"id":"disconnect","method":"station_disconnect","params":{"provider":"direct_agent"}})).unwrap();
        release.send(()).unwrap();
        thread.join().unwrap().unwrap();
        owner
            .bootstrap_worker(1, &|_| panic!("must coalesce final context"))
            .unwrap();
        assert_eq!(owner.power.lock().unwrap().sequence, 2);
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
    }
    #[test]
    fn previous_worker_ack_cannot_mark_replacement_ready_and_disconnect_stays_prompt() {
        let (_directory, selection, _) = fixture();
        initialized(&selection, Some("direct_agent"));
        let owner = Arc::new(selection);
        let (sent, received) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        owner.worker_started(
            1,
            Arc::new(move |request| {
                sent.send(()).unwrap();
                finish.lock().unwrap().recv().unwrap();
                Ok(reply(&request, true))
            }),
        );
        received
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let old_sequence = owner.power.lock().unwrap().sequence;
        let (sent_new, received_new) = std::sync::mpsc::channel();
        let (release_new, finish_new) = std::sync::mpsc::channel();
        let finish_new = Mutex::new(finish_new);
        owner.worker_started(
            2,
            Arc::new(move |request| {
                sent_new.send(()).unwrap();
                finish_new.lock().unwrap().recv().unwrap();
                Ok(reply(&request, true))
            }),
        );
        // Invalidation does not acquire state: urgent source retirement can
        // finish while either optional worker acknowledgement is still pending.
        owner.control(json!({"id":"disconnect","method":"station_disconnect","params":{"provider":"direct_agent"}})).unwrap();
        received_new
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert!(!Selection::finish_power(
            &owner.power,
            1,
            old_sequence,
            &Ok(())
        ));
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "pending"
        );
        release.send(()).unwrap();
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "pending"
        );
        release_new.send(()).unwrap();
        wait_for_power(&owner);
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
        owner.worker_started(1, Arc::new(|_| panic!("obsolete generation must not send")));
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
    }
    #[test]
    fn bootstrap_captured_before_handover_is_sequence_fenced() {
        let (_directory, selection, _) = fixture();
        initialized(&selection, Some("direct_agent"));
        let owner = Arc::new(selection);
        let (sent, received) = std::sync::mpsc::channel();
        let (release, finish) = std::sync::mpsc::channel();
        let finish = Mutex::new(finish);
        owner.worker_started(
            1,
            Arc::new(move |request| {
                sent.send(request.clone()).unwrap();
                finish.lock().unwrap().recv().unwrap();
                Ok(reply(&request, true))
            }),
        );
        let bootstrap = received
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let selected = owner.handover(0, "hamlib").unwrap();
        assert_eq!(selected["power_notification"]["state"], "ready");
        assert!(
            owner.power.lock().unwrap().sequence
                > bootstrap["params"]["sequence"].as_u64().unwrap()
        );
        assert!(!Selection::finish_power(
            &owner.power,
            1,
            bootstrap["params"]["sequence"].as_u64().unwrap(),
            &Err("superseded".into())
        ));
        release.send(()).unwrap();
        assert_eq!(
            owner.snapshot().unwrap()["power_notification"]["state"],
            "ready"
        );
    }
    #[test]
    fn first_worker_start_during_handover_never_reacquires_its_state_or_supersedes_null() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("choice.json"), json!({"version":1,"provider":"direct_agent","selection_id":uuid::Uuid::new_v4().to_string()}).to_string()).unwrap();
        let slot: Arc<Mutex<Option<std::sync::Weak<Selection>>>> = Arc::new(Mutex::new(None));
        let callback_owner = slot.clone();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let owner = Arc::new(
            Selection::new(
                directory.path().join("choice.json"),
                Arc::new(move |request| {
                    recorded.lock().unwrap().push(request.clone());
                    if request["method"] == "station_power_selection"
                        && request["params"]["provider"].is_null()
                    {
                        let owner = callback_owner
                            .lock()
                            .unwrap()
                            .as_ref()
                            .unwrap()
                            .upgrade()
                            .unwrap();
                        assert!(owner.state.try_lock().is_err());
                        owner.worker_started(
                            1,
                            Arc::new(|_| {
                                panic!("handover's authoritative context was already published")
                            }),
                        );
                    }
                    Ok(reply(&request, true))
                }),
                Arc::new(|| {}),
            )
            .unwrap(),
        );
        *slot.lock().unwrap() = Some(Arc::downgrade(&owner));
        let next = owner.handover(0, "hamlib").unwrap();
        owner
            .bootstrap_worker(1, &|_| panic!("must coalesce acknowledged context"))
            .unwrap();
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert!(calls[0]["params"]["provider"].is_null());
        assert_eq!(calls[1]["method"], "station_disconnect");
        assert_eq!(calls[2]["params"]["provider"], "hamlib");
        assert_eq!(calls[2]["params"]["selection_id"], next["selection_id"]);
        assert_eq!(next["power_notification"]["state"], "ready");
    }
    #[test]
    fn replacement_failure_is_nonfatal_coalesced_and_unset_does_not_default() {
        let (_directory, selection, _) = fixture();
        let owner = Arc::new(selection);
        owner.worker_started(1, Arc::new(|_| panic!("unset must stay unset")));
        owner
            .bootstrap_worker(1, &|_| panic!("unset must stay unset"))
            .unwrap();
        assert!(!owner.path.exists());
        assert!(owner.snapshot().unwrap()["provider"].is_null());
        let (_second_directory, selection, _) = fixture();
        let owner = Arc::new(selection);
        initialized(&owner, Some("direct_agent"));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let recorded = calls.clone();
        owner.worker_started(
            2,
            Arc::new(move |_| {
                recorded.fetch_add(1, Ordering::AcqRel);
                Err("fixture unavailable".into())
            }),
        );
        // Use an acknowledgement channel via status polling only after the
        // bootstrap has allocated a notice, since invalidation starts unattempted.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while owner.snapshot().unwrap()["power_notification"]["state"] != "unavailable" {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        for _ in 0..20 {
            owner.notify_saved().unwrap();
            owner.initialize(None).unwrap();
        }
        assert_eq!(calls.load(Ordering::Acquire), 1);
        owner.control(json!({"id":"disconnect","method":"station_disconnect","params":{"provider":"direct_agent"}})).unwrap();
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
        assert_native_context(&owner, &switched);
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
            let mut after_control = selected.clone();
            after_control["control_revision"] = json!(selected["control_revision"].as_u64().unwrap() + 1);
            assert_eq!(owner.snapshot().unwrap(), after_control);
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
                let mut after_control = selected;
                after_control["control_revision"] = json!(after_control["control_revision"].as_u64().unwrap() + 1);
                assert_eq!(choice(owner.snapshot().unwrap()), choice(after_control));
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
        assert_native_context(&owner, &previous);
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
        assert_native_context(&owner, &previous);
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
    fn rollback_failure_mirrors_the_persisted_next_native_authority_for_recovery() {
        let (_directory, saved, _) = fixture();
        initialized(&saved, Some("direct_agent"));
        let path = saved.path.clone();
        let snapshot_path = path.with_extension("snapshot");
        let preserved = snapshot_path.clone();
        let owner = Selection::new(
            saved.path.clone(),
            Arc::new(move |request| {
                if request["method"] == "station_power_selection"
                    && request["params"]["provider"] == "hamlib"
                {
                    // Preserve the just-committed synthetic next choice, then make
                    // only this disposable fixture's target impossible to replace.
                    std::fs::rename(&path, &preserved).unwrap();
                    std::fs::create_dir(&path).unwrap();
                    return Err("fixture next notification failed".into());
                }
                Ok(reply(&request, true))
            }),
            Arc::new(|| {}),
        )
        .unwrap();
        assert!(owner
            .handover(0, "hamlib")
            .unwrap_err()
            .contains("could not be restored"));
        let selected = owner.snapshot().unwrap();
        assert_eq!(selected["provider"], "hamlib");
        assert_native_context(&owner, &selected);
        let persisted: Value =
            serde_json::from_slice(&std::fs::read(snapshot_path).unwrap()).unwrap();
        assert_eq!(persisted["selection_id"], selected["selection_id"]);
        {
            let mut power = owner.power.lock().unwrap();
            power.worker_generation = 1;
            power.status = "not_attempted";
        }
        owner
            .bootstrap_worker(1, &move |request| {
                assert_eq!(request["params"]["provider"], selected["provider"]);
                assert_eq!(request["params"]["selection_id"], selected["selection_id"]);
                Ok(reply(&request, true))
            })
            .unwrap();
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
    fn monitor_action_admission_rejects_old_identity_even_after_returning_to_same_provider() {
        let (_directory, owner, calls) = fixture();
        let first = initialized(&owner, Some("direct_agent"));
        let action = || crate::monitor_context::action_request("direct_agent", "standby").unwrap();
        let id = first["selection_id"].as_str().unwrap();
        assert!(owner.monitor_action(action(), 0, &uuid::Uuid::new_v4().to_string(), || Ok(())).is_err());
        owner.handover(0, "hamlib").unwrap(); owner.handover(1, "direct_agent").unwrap();
        assert!(owner.monitor_action(action(), 0, id, || -> Result<(), String> { panic!("obsolete intent admitted") }).is_err());
        assert!(owner.monitor_action(action(), 2, id, || -> Result<(), String> { panic!("obsolete intent admitted") }).is_err());
        assert!(calls.lock().unwrap().iter().all(|request| request["method"] != "station_action"));
        let current = owner.snapshot().unwrap();
        assert!(owner.monitor_action(action(), 2, current["selection_id"].as_str().unwrap(), || Err::<(), _>("stale native observation".to_owned())).is_err());
        assert!(owner.monitor_action(crate::monitor_context::action_request("direct_agent", "cancel").unwrap(), 2, id,
            || -> Result<(), String> { panic!("stale cancellation identity admitted") }).is_err());
        assert!(calls.lock().unwrap().iter().all(|request| request["method"] != "station_action"));
        owner.monitor_action(action(), 2, current["selection_id"].as_str().unwrap(), || Ok(())).unwrap();
        assert_eq!(calls.lock().unwrap().iter().filter(|request| request["method"] == "station_action").count(), 1);
    }
    #[test]
    fn shared_hamlib_lifecycle_rejects_old_identity_and_generation_after_returning_to_hamlib() {
        let (_directory, owner, calls) = fixture();
        let first = initialized(&owner, Some("hamlib"));
        let old_id = first["selection_id"].as_str().unwrap();
        owner.handover(0, "direct_agent").unwrap(); owner.handover(1, "hamlib").unwrap();
        let current = owner.snapshot().unwrap(); let id = current["selection_id"].as_str().unwrap();
        for method in ["hamlib_connect", "hamlib_reconnect", "hamlib_disconnect"] {
            let action = || json!({"id":"shared-lifecycle","method":method,"params":{"device":"radio","mode":"managed","model":1}});
            for (generation, identity) in [(0, old_id), (2, old_id), (0, id)] {
                assert!(owner.monitor_action(action(), generation, identity, || -> Result<(), String> { panic!("stale lifecycle admitted") }).is_err());
            }
            let before = calls.lock().unwrap().iter().filter(|request| request["method"] == method).count();
            owner.monitor_action(action(), 2, id, || Ok(())).unwrap();
            assert_eq!(calls.lock().unwrap().iter().filter(|request| request["method"] == method).count(), before + 1);
        }
    }
    #[test]
    fn shared_flex_lifecycle_rejects_stale_generation_identity_and_provider() {
        let (_directory, owner, calls) = fixture();
        let first = initialized(&owner, Some("direct_flex_lan"));
        let old_id = first["selection_id"].as_str().unwrap();
        owner.handover(0, "direct_agent").unwrap(); owner.handover(1, "direct_flex_lan").unwrap();
        let current = owner.snapshot().unwrap(); let id = current["selection_id"].as_str().unwrap();
        for method in ["station_connect", "station_disconnect"] {
            let action = || json!({"id":"shared-flex","method":method,"params":{"provider":"direct_flex_lan","host":"10.0.0.1","port":4992,"station_name":"xLog"}});
            for (generation, identity) in [(0, old_id), (2, old_id), (0, id)] {
                assert!(owner.monitor_action(action(), generation, identity, || -> Result<(), String> { panic!("stale FLEX lifecycle admitted") }).is_err());
            }
            let mut wrong_provider = action(); wrong_provider["params"]["provider"] = json!("direct_agent");
            assert!(owner.monitor_action(wrong_provider, 2, id, || -> Result<(), String> { panic!("wrong provider admitted") }).is_err());
            let before = calls.lock().unwrap().iter().filter(|request| request["method"] == method).count();
            owner.monitor_action(action(), 2, id, || Ok(())).unwrap();
            assert_eq!(calls.lock().unwrap().iter().filter(|request| request["method"] == method).count(), before + 1);
        }
    }
    #[test]
    fn child_receive_control_checks_selection_identity_and_control_revision_before_admission() {
        let (_directory, owner, calls) = fixture(); let first = initialized(&owner, Some("direct_flex_lan"));
        let identity = first["selection_id"].as_str().unwrap(); let revision = first["control_revision"].as_u64().unwrap();
        let request = || json!({"id":"receive-child","method":"station_radio_control","params":{"provider":"direct_flex_lan","control":"set_frequency_a","frequency_hz":14074000,"expected_generation":13}});
        for (generation, id, control_revision) in [(1, identity, revision), (0, "wrong", revision), (0, identity, revision + 1)] {
            assert!(owner.receive_control(request(), generation, id, control_revision, || -> Result<(), String> { panic!("stale receive action admitted") }).is_err());
        }
        owner.receive_control(request(), 0, identity, revision, || Ok(())).unwrap();
        assert!(owner.receive_control(request(), 0, identity, revision, || -> Result<(), String> { panic!("duplicate observation admitted") }).is_err());
        assert_eq!(calls.lock().unwrap().iter().filter(|request| request["method"] == "station_radio_control").count(), 1);
    }
    #[test]
    fn admitted_monitor_action_excludes_handover_without_holding_selection_lock_over_transport() {
        let (directory, original, _) = fixture();
        let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new())); let wait = gate.clone();
        let (entered, received) = std::sync::mpsc::channel();
        let owner = Arc::new(Selection::new(directory.path().join("monitor.json"), Arc::new(move |request| {
            if request["method"] == "station_action" {
                entered.send(()).unwrap();
                let _guard = wait.1.wait_while(wait.0.lock().unwrap(), |release| !*release).unwrap();
            }
            Ok(reply(&request, true))
        }), original.publish.clone()).unwrap());
        let selected = initialized(&owner, Some("direct_agent"));
        let pending = owner.clone(); let id = selected["selection_id"].as_str().unwrap().to_owned();
        let task = std::thread::spawn(move || pending.monitor_action(crate::monitor_context::action_request("direct_agent", "cancel").unwrap(), 0, &id, || Ok(())));
        received.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        assert!(owner.snapshot().is_ok());
        assert!(owner.handover(0, "hamlib").unwrap_err().contains("current radio action"));
        *gate.0.lock().unwrap() = true; gate.1.notify_all(); task.join().unwrap().unwrap();
        assert_eq!(owner.snapshot().unwrap()["provider"], "direct_agent");
    }
    #[test]
    fn checked_handover_rejects_prior_identity_after_a_b_a_and_after_restart() {
        let (_directory, owner, calls) = fixture();
        let first = initialized(&owner, Some("direct_agent"));
        let original = first["selection_id"].as_str().unwrap();
        let wrong = uuid::Uuid::new_v4().to_string();
        assert!(owner.handover_checked(0, &wrong, "hamlib").is_err());
        let second = owner.handover_checked(0, original, "hamlib").unwrap();
        let current = owner.handover_checked(1, second["selection_id"].as_str().unwrap(), "direct_agent").unwrap();
        let count = calls.lock().unwrap().len();
        assert!(owner.handover_checked(0, original, "hamlib").is_err());
        assert!(owner.handover_checked(2, original, "hamlib").is_err());
        assert_eq!(calls.lock().unwrap().len(), count);
        let reopened = Selection::new(owner.path.clone(), owner.transport.clone(), Arc::new(|| {})).unwrap();
        assert!(reopened.handover_checked(0, original, "hamlib").is_err());
        assert_eq!(reopened.snapshot().unwrap()["selection_id"], current["selection_id"]);
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
