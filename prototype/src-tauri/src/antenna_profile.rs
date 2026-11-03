//! Retained TX telemetry for software profile suggestions. No provider calls.
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}};
use std::{time::Duration, collections::BTreeMap};
use tauri::Emitter;
use crate::{radio_follow::{Observation, Selection}, radio_read::{Backend, NativeBackend}, spot_editor_barrier::EditorBarrier};

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn same_id(value: &Value, expected: &str) -> bool {
    match (value.as_str().and_then(|raw| uuid::Uuid::parse_str(raw).ok()), uuid::Uuid::parse_str(expected).ok()) {
        (Some(actual), Some(expected)) => actual == expected, _ => false,
    }
}
struct Owner { app: tauri::AppHandle, editors: Arc<EditorBarrier>, running: AtomicBool, latest: Mutex<Value>, settlements: Mutex<BTreeMap<String, BTreeMap<String, String>>>, last_attempt: Mutex<Option<String>> }
static OWNER: OnceLock<Arc<Owner>> = OnceLock::new();
pub fn install(app: &tauri::AppHandle, editors: Arc<EditorBarrier>) {
    let _ = OWNER.set(Arc::new(Owner { app: app.clone(), editors, running: AtomicBool::new(false),
        latest: Mutex::new(json!({"operationId":null,"phase":"idle","barrier":null})), settlements: Mutex::new(BTreeMap::new()), last_attempt: Mutex::new(None) }));
}
pub fn status() -> Option<Value> { OWNER.get()?.latest.lock().ok().map(|value| value.clone()) }
pub fn owns(operation: &str) -> bool { status().is_some_and(|value| value["operationId"] == operation) }
pub fn active() -> bool { status().is_some_and(|value| value["reservationActive"] == true) }
pub(crate) fn retire_snapshot(value: &mut Value) -> bool {
    if value["reservationActive"] == true { return false; }
    *value = json!({"operationId":null,"phase":"idle","barrier":null});
    true
}
pub fn retire() {
    if let Some(owner) = OWNER.get() { if let Ok(mut value) = owner.latest.lock() {
        if retire_snapshot(&mut value) {
            if let Ok(mut attempt) = owner.last_attempt.lock() { *attempt = None; }
        }
    } }
}
impl Owner {
    fn prior_settled(&self) -> Result<bool, String> {
        // The combined owner prioritizes every active/uncertain reservation.
        // A current-instance acknowledgement proves its canonical draft refresh
        // completed, including any older terminal receipt it supersedes.
        let latest = crate::combined_activation_snapshot(&self.app)?;
        let Some(operation) = latest["operationId"].as_str() else { return Ok(latest["phase"] == "idle"); };
        let instances = self.editors.instances(&NativeBackend { app: self.app.clone() }.open_editors()?)?;
        let settlements = self.settlements.lock().map_err(|_| "Antenna settlement registry unavailable.")?;
        Ok(terminal_ready(&latest, &instances, settlements.get(operation)))
    }
    fn store(&self, value: Value) {
        if let Ok(mut latest) = self.latest.lock() { *latest = value; }
        let _ = self.app.emit("xlog:spot-activation", ());
        let _ = self.app.emit("xlog:operator-draft-changed", ());
    }
    fn execute(&self, observed: Observation) -> Result<(), String> {
        let _module = crate::operating_module::owner()?.admit_selected(crate::operating_module::OperatingModule::NormalLogging)?;
        let backend = NativeBackend { app: self.app.clone() };
        let epoch = self.editors.epoch()?;
        if !self.prior_settled()? { return Ok(()); }
        let canonical = backend.canonical()?;
        let mut params = json!({"draftID":canonical.draft,"expectedRevision":canonical.revision,
            "generation":canonical.generation,"frequencyHz":observed.frequency});
        let proposal = NativeBackend::call(canonical.worker, "logbook_operator_draft_antenna_proposal", params.clone())?;
        if proposal["proposed"] != true { return Ok(()); }
        let labels = backend.open_editors()?;
        let attempt = serde_json::to_string(&json!({"workspace":canonical.generation,"draft":canonical.draft,"revision":canonical.revision,
            "selection":observed.selection,"connection":observed.connection,"frequency":observed.frequency,
            "profile":proposal["profileFingerprint"],"settingsRevision":proposal["settingsRevision"],"editors":self.editors.instances(&labels)?})).map_err(|_| "Antenna attempt context unavailable.")?;
        if self.last_attempt.lock().map_err(|_| "Antenna attempt state unavailable.")?.as_ref() == Some(&attempt) { return Ok(()); }
        if !self.prior_settled()? { return Ok(()); }
        let operation = uuid::Uuid::new_v4().to_string();
        self.editors.begin_at_epoch(&operation, &canonical.generation, &canonical.draft, canonical.revision, &labels, epoch)?;
        if let Ok(mut previous) = self.last_attempt.lock() { *previous = Some(attempt); }
        self.store(json!({"operationId":operation,"phase":"preparing","barrier":self.editors.snapshot().unwrap_or(Value::Null),
            "admitted":false,"reservationActive":true,"draftOnly":true,"intent":"antenna-profile"}));
        let mut unresolved = false;
        let result = (|| -> Result<bool, String> {
            self.editors.wait_ready(&operation, Duration::from_secs(3))?;
            let selection = crate::station_selection::retained_snapshot()?;
            if Selection::parse(&selection)? != observed.selection { return Err("The active radio changed before the antenna default could be applied.".into()); }
            let _fence = crate::station_selection::owner(&self.app)?.fence_radio_read_epoch(&selection)?;
            let current = crate::radio_follow::observation(&crate::station_telemetry::retained_snapshot()?, &selection, now())?;
            if current.selection != observed.selection || current.connection != observed.connection || current.frequency != observed.frequency {
                return Err("Transmit-band evidence changed; the retained antenna snapshot was kept.".into());
            }
            params["operationID"] = json!(operation);
            let response = match NativeBackend::call(canonical.worker, "logbook_operator_draft_antenna_follow", params) {
                Ok(value) => value,
                Err(original) => match NativeBackend::call(canonical.worker, "logbook_operator_draft_receipt", json!({"operationID":operation,"generation":canonical.generation})) {
                    Ok(value) if value["receipt"].is_object() => json!({"status":"applied","receipt":value["receipt"]}),
                    Ok(_) => return Err(original),
                    Err(_) => { unresolved = true; return Err("Antenna metadata acknowledgement is unresolved. No operation will be replayed.".into()); }
                },
            };
            if response["status"] == "unchanged" { return Ok(false); }
            let receipt = &response["receipt"];
            if response["status"] != "applied" || !same_id(&receipt["mutation"]["operationID"], &operation) ||
                !same_id(&receipt["mutation"]["draftID"], &canonical.draft) || receipt["mutation"]["expectedRevision"] != canonical.revision {
                return Err("The draft changed before the antenna metadata commit; its retained context was kept.".into());
            }
            Ok(true)
        })();
        if !unresolved { let _ = self.editors.finish(&operation); }
        let mut value = json!({"operationId":operation,"phase":if result.is_ok(){"confirmed"}else if unresolved{"uncertain"}else{"blocked"},
            "barrier":null,"admitted":result.as_ref().is_ok_and(|value|*value),"reservationActive":unresolved,"draftOnly":true,"intent":"antenna-profile","rotor":"not-requested","tuneConfirmed":false});
        if unresolved { value["pending"] = json!({"generation":canonical.generation,"draft":canonical.draft,"revision":canonical.revision,"frequencyHz":observed.frequency}); }
        if let Err(error) = result { value["error"] = json!(error); }
        self.store(value); Ok(())
    }
}
fn all_settled(instances: &BTreeMap<String, String>, settled: Option<&BTreeMap<String, String>>) -> bool {
    instances.iter().all(|(label, instance)| settled.and_then(|values| values.get(label)) == Some(instance))
}
fn terminal_ready(value: &Value, instances: &BTreeMap<String, String>, settled: Option<&BTreeMap<String, String>>) -> bool {
    value["reservationActive"] != true && matches!(value["phase"].as_str(), Some("confirmed" | "blocked" | "failed")) && all_settled(instances, settled)
}
pub fn settled(label: &str, instance: &str, operation: &str) -> Result<(), String> {
    let owner = OWNER.get().ok_or("Antenna metadata owner unavailable.")?;
    uuid::Uuid::parse_str(operation).map_err(|_| "Invalid settled operation identity.")?;
    let terminal = crate::combined_activation_snapshot(&owner.app)?;
    if !same_id(&terminal["operationId"], operation) || terminal["reservationActive"] == true ||
        !matches!(terminal["phase"].as_str(), Some("confirmed" | "blocked" | "failed")) {
        return Err("Only the retained completed operation can be acknowledged as settled.".into());
    }
    let expected = owner.editors.instances(&[label.to_owned()])?;
    if expected.get(label).map(String::as_str) != Some(instance) { return Err("Obsolete editor settlement instance.".into()); }
    let mut settlements = owner.settlements.lock().map_err(|_| "Antenna settlement registry unavailable.")?;
    // Settlements are only an admission optimization; pruning older operation
    // IDs may block until a fresh acknowledgement, never admit an old instance.
    if settlements.len() >= 256 && !settlements.contains_key(operation) { settlements.clear(); }
    settlements.entry(operation.into()).or_default().insert(label.into(), instance.into());
    Ok(())
}
/// Called only by the existing retained telemetry feed. It never subscribes,
/// polls a provider, changes radio fields or grants Follow Radio permission.
pub fn observe(projection: &Value) {
    let Some(owner) = OWNER.get() else { return; };
    if crate::APP_EXITING.load(Ordering::Acquire) || active() || crate::radio_follow::snapshot().is_ok_and(|value| value["enabled"] == true) { return; }
    let Ok(selection) = crate::station_selection::retained_snapshot() else { return; };
    let Ok(observed) = crate::radio_follow::observation(projection, &selection, now()) else { return; };
    if owner.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() { return; }
    let owner = owner.clone();
    std::thread::spawn(move || { let _ = owner.execute(observed); owner.running.store(false, Ordering::Release); });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_admission_waits_for_every_current_editor_instance() {
        let expected = BTreeMap::from([("main".into(), "main-new".into()), ("log-qso".into(), "qso-1".into())]);
        assert!(!all_settled(&expected, None));
        let mut acknowledged = BTreeMap::from([("main".into(), "main-old".into()), ("log-qso".into(), "qso-1".into())]);
        assert!(!all_settled(&expected, Some(&acknowledged)));
        acknowledged.insert("main".into(), "main-new".into());
        assert!(all_settled(&expected, Some(&acknowledged)));
        acknowledged.remove("log-qso");
        assert!(!all_settled(&expected, Some(&acknowledged)));
        acknowledged.insert("log-qso".into(), "qso-1".into());
        for phase in ["preparing", "draft_applied", "tuning", "uncertain"] {
            assert!(!terminal_ready(&json!({"phase":phase,"reservationActive":false}), &expected, Some(&acknowledged)));
        }
        assert!(!terminal_ready(&json!({"phase":"confirmed","reservationActive":true}), &expected, Some(&acknowledged)));
        assert!(terminal_ready(&json!({"phase":"confirmed","reservationActive":false}), &expected, Some(&acknowledged)));
    }
}
pub fn reconcile(operation: &str) -> Result<Value, String> {
    let owner = OWNER.get().ok_or("Antenna metadata owner unavailable.")?;
    if owner.running.load(Ordering::Acquire) { return Err("Wait for antenna metadata admission to finish.".into()); }
    let mut value = status().filter(|value| value["operationId"] == operation).ok_or("Antenna operation is no longer retained.")?;
    if value["reservationActive"] != true { return Ok(value); }
    let pending = &value["pending"];
    let response = NativeBackend::call(crate::worker::generation(), "logbook_operator_draft_receipt", json!({"operationID":operation,"generation":pending["generation"]}))?;
    let receipt = &response["receipt"];
    let applied = same_id(&receipt["mutation"]["operationID"], operation) && same_id(&receipt["mutation"]["draftID"], pending["draft"].as_str().unwrap_or("")) &&
        receipt["mutation"]["expectedRevision"] == pending["revision"] && receipt["draft"]["qso"]["extraFields"]["APP_OM0RXXLOG_ANTENNA_TX_HZ"].as_str() == pending["frequencyHz"].as_u64().map(|v|v.to_string()).as_deref();
    if !applied && response.get("receipt") != Some(&Value::Null) && response["status"] != "workspace_changed" { return Err("Antenna metadata receipt is not yet verified.".into()); }
    owner.editors.finish(operation)?;
    value["phase"] = json!(if applied { "confirmed" } else { "blocked" }); value["reservationActive"] = json!(false); value["admitted"] = json!(applied);
    value.as_object_mut().unwrap().remove("pending"); owner.store(value.clone()); Ok(value)
}

#[tauri::command]
pub fn antenna_transmit_context(window: tauri::WebviewWindow) -> Result<Value, String> {
    if !matches!(window.label(), "main" | "log-qso") { return Err("Antenna suggestions belong to the normal QSO editor.".into()); }
    if crate::APP_EXITING.load(std::sync::atomic::Ordering::Acquire) { return Err("Antenna context unavailable during shutdown.".into()); }
    let _admission = crate::operating_module::owner()?.admit_selected(crate::operating_module::OperatingModule::NormalLogging)?;
    let selected = crate::station_selection::retained_snapshot()?;
    let projection = crate::station_telemetry::retained_snapshot()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Station clock unavailable.")?.as_millis() as u64;
    match crate::radio_follow::observation(&projection, &selected, now) {
        Ok(observed) => Ok(json!({"fresh":true,"transmitFrequencyHz":observed.frequency,
            "selection":observed.selection,"observedAtMs":projection["received_at_ms"]})),
        Err(reason) => Ok(json!({"fresh":false,"reason":reason})),
    }
}
