//! Production activation adapter. Renderers supply identities only; retained
//! native reports and generation-pinned worker receipts supply every field.
use crate::{spot_activation::{Backend, Request}, auto_rotor::{self, Permit, Target}};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::{Emitter, Manager};

const MAX_REVISION: u64 = 9_007_199_254_740_991;
struct Context {
    request: Request,
    worker: u64,
    generation: String,
    draft: String,
    revision: u64,
    spot: Value,
    expected_radio: Value,
    lease: Option<String>,
    permit: Option<Permit>,
}
pub struct NativeBackend { app: tauri::AppHandle, operations: Mutex<BTreeMap<String, Context>> }
impl NativeBackend {
    pub fn new(app: tauri::AppHandle) -> Self { Self { app, operations: Mutex::new(BTreeMap::new()) } }
    fn context<T>(&self, request: &Request, read: impl FnOnce(&Context) -> Result<T, String>) -> Result<T, String> {
        let operations = self.operations.lock().map_err(|_| "Activation context unavailable")?;
        let context = operations.get(&request.operation_id).filter(|value| value.request == *request)
            .ok_or("Activation context is no longer current")?;
        read(context)
    }
    fn control_params(&self, request: &Request, applied: &Value) -> Result<(u64, Value), String> {
        self.context(request, |context| {
            validate_receipt(applied, context)?;
            let lease = valid_uuid(&applied["leaseID"])?;
            if context.lease.as_deref() != Some(&lease) { return Err("Activation lease changed; no action is permitted.".into()); }
            Ok((context.worker, json!({"operationID":request.operation_id,"generation":context.generation,"leaseID":lease})))
        })
    }
}

fn valid_uuid(value: &Value) -> Result<String, String> {
    let id = value.as_str().and_then(|value| uuid::Uuid::parse_str(value).ok()).filter(|id| !id.is_nil())
        .ok_or("Native activation identity is invalid")?;
    Ok(id.to_string())
}
fn keys(value: &Value, allowed: &[&str]) -> Result<(), String> {
    if !value.as_object().is_some_and(|value| value.keys().all(|key| allowed.contains(&key.as_str()))) {
        return Err("Unexpected native activation response fields".into());
    }
    Ok(())
}
fn result(request: &Value, response: Value) -> Result<Value, String> {
    keys(&response, &["id", "ok", "result", "error"])?;
    if response["id"] != request["id"] || !response["ok"].is_boolean() { return Err("Native worker response identity did not match".into()); }
    if response["ok"] != true {
        return Err(response["error"]["message"].as_str().unwrap_or("Native worker operation was not confirmed").chars().take(256).collect());
    }
    if !response["result"].is_object() || !response["error"].is_null() { return Err("Native worker response was malformed".into()); }
    Ok(response["result"].clone())
}
/// These worker failures prove that native control admission stopped before a
/// radio command was dispatched. Lost replies and post-dispatch readback errors
/// deliberately stay outside this list and therefore remain uncertain.
fn definitely_not_admitted(response: &Value) -> bool {
    response["ok"] == false && matches!(response["error"]["code"].as_str(), Some(
        "station_busy" | "station_changed" | "station_unavailable" |
        "station-busy" | "station-stopped" | "station-training-active" |
        "station-maintenance-active" | "startup-recovery-required" |
        "station-control-lease-unavailable" | "digital-engine-owns-radio" |
        "flex-station-unbound" | "agent-not-ready" |
        "frequency-outside-policy" | "mode-invalid"
    ))
}
fn call(worker: u64, method: &str, params: Value) -> Result<Value, String> {
    let request = json!({"id":format!("native-activation-{}",uuid::Uuid::new_v4()),"method":method,"params":params});
    let response = crate::worker::request_existing_generation(request.clone(), worker)?;
    let result = result(&request, response)?;
    if crate::worker::generation() != worker { return Err("Worker changed before activation acknowledgement; do not replay the operation.".into()); }
    Ok(result)
}
fn validate_draft(draft: &Value) -> Result<(), String> {
    valid_uuid(&draft["generation"])?; valid_uuid(&draft["qso"]["id"])?;
    if !draft["revision"].as_u64().is_some_and(|value| value <= MAX_REVISION)
        || !draft["qso"]["call"].is_string() { return Err("Canonical draft snapshot is invalid".into()); }
    Ok(())
}
fn read_canonical(worker: u64) -> Result<Value, String> {
    let reply = call(worker, "logbook_operator_draft", json!({}))?;
    keys(&reply, &["draft", "power_capture_status"])?;
    validate_draft(&reply["draft"])?;
    Ok(reply["draft"].clone())
}
fn running_worker() -> Result<u64, String> {
    let mut generation = crate::worker::generation();
    if generation == 0 {
        let request = json!({"id":format!("native-activation-health-{}",uuid::Uuid::new_v4()),"method":"health","params":{}});
        result(&request, crate::worker::request(request.clone())?)?;
        generation = crate::worker::generation();
    }
    if generation == 0 { return Err("Native worker generation is unavailable".into()); }
    Ok(generation)
}
pub fn canonical_editor_state() -> Result<Value, String> { Ok(json!({"draft":read_canonical(running_worker()?)?})) }
/// Only explicit recovery calls this path. The current worker transaction either
/// tombstones a missing draft apply or returns its exact durable lease/receipt.
/// There is no effect staging, station command or rotor call here.
fn recover_missing_with(operation_id: &str, mut request: impl FnMut(&str, Value) -> Result<Value, String>) -> Result<Value, String> {
    let operation = valid_uuid(&json!(operation_id))?;
    let current = request("logbook_operator_draft", json!({}))?;
    validate_draft(&current["draft"])?;
    let generation = valid_uuid(&current["draft"]["generation"])?;
    let params = json!({"operationID":operation,"generation":generation});
    let mut receipt = request("spot_draft_abandon", params.clone())?;
    if receipt["status"] == "abandoned" {
        keys(&receipt, &["status","receipt","replay","generation"])?;
        if receipt["replay"] != true || !receipt["receipt"].is_null() || valid_uuid(&receipt["generation"])? != generation {
            return Err("Missing activation identity could not be tombstoned.".into());
        }
    } else {
        let validate = |value: &Value| -> Result<(), String> {
            keys(value, &["status","replay","phase","receipt","leaseID"])?;
            keys(&value["receipt"], &["operationID","generation","phase","draft"])?;
            validate_draft(&value["receipt"]["draft"])?;
            if valid_uuid(&value["receipt"]["operationID"])? != operation
                || valid_uuid(&value["receipt"]["generation"])? != generation
                || valid_uuid(&value["receipt"]["draft"]["generation"])? != generation
                || value["receipt"]["phase"] != "draft_applied" || value["replay"] != true || !phase(&value["phase"])
                || terminal(&value["phase"]) && value.get("leaseID").is_some() { return Err("Recovered activation receipt did not match.".into()); }
            Ok(())
        };
        validate(&receipt)?;
        if receipt["status"] != "found" { return Err("Activation receipt was unavailable.".into()); }
        if let Some(lease) = receipt.get("leaseID") {
            let mut finish = params; finish["leaseID"] = json!(valid_uuid(lease)?); finish["outcome"] = json!("uncertain");
            receipt = request("spot_draft_finish", finish)?;
            validate(&receipt)?;
            if receipt["status"] != "finished" || receipt["phase"] != "uncertain" || receipt.get("leaseID").is_some() {
                return Err("Activation lease retirement was not confirmed.".into());
            }
        }
    }
    // Re-read current draft after retirement; historical receipts cannot replace
    // operator edits made since the original selection.
    let current = request("logbook_operator_draft", json!({}))?;
    validate_draft(&current["draft"])?;
    if valid_uuid(&current["draft"]["generation"])? != generation { return Err("Workspace changed during activation recovery.".into()); }
    Ok(json!({"operationId":operation_id,"phase":"uncertain","reservationActive":false,"tuneConfirmed":false,
        "rotor":"not_replayed","draft":current["draft"],"error":"Previous activation identity retired. Review the observed radio and rotor state; uncertain effects were not replayed. A new report can be selected."}))
}
fn precise_lookup_with(call_sign: &str, request: impl FnOnce(&str, Value) -> Result<Value, String>) -> Result<Value, String> {
    // Preserve the existing native QRZ-coordinate/grid preference and its CTY
    // fallback. The caller still pins this read to the canonical worker epoch.
    request("lookup_call", json!({"call":call_sign}))
}
fn precise_lookup(worker: u64, call_sign: &str) -> Result<Value, String> {
    precise_lookup_with(call_sign, |method, params| call(worker, method, params))
}
pub fn reconcile_auto() -> Result<Value, String> {
    if crate::worker::local_acceptance() { return Err("Automatic rotor is unavailable in isolated acceptance".into()); }
    let worker = running_worker()?;
    auto_rotor::reconcile_generation(worker, || Target::from_snapshot(&read_canonical(worker)?), |call| precise_lookup(worker, call))
}
fn phase(value: &Value) -> bool {
    matches!(value.as_str(), Some("draft_applied" | "tune_started" | "tune_confirmed" | "rotor_started" | "confirmed" | "failed" | "uncertain"))
}
fn terminal(value: &Value) -> bool { matches!(value.as_str(), Some("confirmed" | "failed" | "uncertain")) }
fn validate_receipt(response: &Value, context: &Context) -> Result<(), String> {
    keys(response, &["status", "replay", "phase", "receipt", "leaseID"])?;
    let receipt = &response["receipt"];
    keys(receipt, &["operationID", "generation", "draft", "phase"])?;
    validate_draft(&receipt["draft"])?;
    if valid_uuid(&receipt["operationID"])? != valid_uuid(&json!(context.request.operation_id))?
        || valid_uuid(&receipt["generation"])? != context.generation
        || valid_uuid(&receipt["draft"]["generation"])? != context.generation
        || valid_uuid(&receipt["draft"]["qso"]["id"])? != context.draft
        || receipt["draft"]["revision"].as_u64() != context.revision.checked_add(1)
        || receipt["draft"]["qso"]["call"] != context.spot["call"]
        || receipt["draft"]["qso"]["frequencyHz"] != context.expected_radio["frequencyHz"]
        || context.spot.get("opportunity").is_none() && (
            receipt["draft"]["qso"]["mode"].as_str().map(str::to_uppercase) != context.expected_radio["mode"].as_str().map(str::to_uppercase)
            || receipt["draft"]["qso"]["band"].as_str().map(str::to_lowercase) != context.expected_radio["band"].as_str().map(str::to_lowercase))
        || receipt["phase"] != "draft_applied" || !phase(&response["phase"]) || !response["replay"].is_boolean() {
        return Err("Durable activation receipt did not match its canonical operation".into());
    }
    if let Some(lease) = response.get("leaseID") { valid_uuid(lease)?; }
    if terminal(&response["phase"]) && response.get("leaseID").is_some() { return Err("Terminal activation unexpectedly retained an effect lease".into()); }
    Ok(())
}
fn validate_recovery(response: &Value, context: &Context, worker: u64) -> Result<(), String> {
    if response["status"] == "abandoned" {
        keys(response, &["status","receipt","replay","generation"])?;
        if !response["receipt"].is_null() || response["replay"] != true
            || valid_uuid(&response["generation"])? != context.generation {
            return Err("Abandoned identity did not match its original workspace".into());
        }
        return Ok(());
    }
    validate_receipt(response, context)?;
    if response["status"] != "found" || response["replay"] != true
        || worker != context.worker && (!terminal(&response["phase"]) || response.get("leaseID").is_some()) {
        return Err("Activation reservation is still unverified".into());
    }
    Ok(())
}
fn selection_identity(value: &Value) -> Result<Value, String> {
    let radio_id = value["radio_id"].as_str().filter(|value| crate::radio_slots::valid(value))
        .ok_or("Native radio slot is invalid")?;
    let provider = value["provider"].as_str().filter(|value| crate::station_telemetry::valid_provider(value))
        .ok_or("Choose a native radio before selecting a spot")?;
    let identity = valid_uuid(&value["selection_id"])?;
    let generation = value["generation"].as_u64().filter(|value| *value <= MAX_REVISION).ok_or("Native radio selection generation is invalid")?;
    let revision = value["control_revision"].as_u64().filter(|value| *value <= MAX_REVISION).ok_or("Native radio control revision is invalid")?;
    Ok(json!({"radio_id":radio_id,"provider":provider,"generation":generation,"selection_id":identity,"control_revision":revision}))
}
fn tune_request(provider: &str, spot: &Value) -> Result<Value, String> {
    let hz = spot["frequencyHz"].as_u64().filter(|value| (100..=10_000_000_000).contains(value)).ok_or("Spot frequency is invalid")?;
    let mode = spot["mode"].as_str().filter(|value| !value.is_empty() && value.len() <= 16 && value.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        .ok_or("Spot mode is unsupported for native tuning")?.to_uppercase();
    let id = format!("native-spot-tune-{}",uuid::Uuid::new_v4());
    if provider == "hamlib" {
        let mode = match mode.as_str() {
            "SSB" => if hz < 10_000_000 { "LSB" } else { "USB" },
            "FT8" | "FT4" | "FT2" | "PSK" | "DIGI" | "DATA" | "DIGU" => "PKTUSB", "DIGL" => "PKTLSB", _ => &mode,
        };
        Ok(json!({"id":id,"method":"hamlib_control","params":{"device":"radio","action":"tune_simplex","hz":hz,"mode":mode}}))
    } else if matches!(provider, "direct_agent" | "direct_flex_lan" | "direct_tci") {
        Ok(json!({"id":id,"method":"station_tune","params":{"provider":provider,"frequency_hz":hz,"mode":mode}}))
    } else { Err("Native radio provider is unsupported".into()) }
}
impl Backend for NativeBackend {
    fn supersede_rotor(&self) -> Result<(), String> { crate::rotor::supersede_spot_turn() }
    fn recover_missing(&self, operation_id: &str) -> Result<Value, String> {
        if crate::worker::local_acceptance() { return Err("Live activation recovery is unavailable in isolated acceptance".into()); }
        let worker = running_worker()?;
        recover_missing_with(operation_id, |method, params| call(worker, method, params))
    }
    fn draft_only(&self, request: &Request) -> bool { crate::opportunity_selection::owns(&request.source_epoch) || crate::cw_track_selection::owns(&request.source_epoch) }
    fn resolve(&self, request: &Request) -> Result<Value, String> {
        if crate::worker::local_acceptance() { return Err("Live reports are unavailable in isolated acceptance".into()); }
        if crate::cw_track_selection::owns(&request.source_epoch) {return crate::cw_track_selection::resolve(request);}
        if crate::opportunity_selection::owns(&request.source_epoch) { return crate::opportunity_selection::resolve(request); }
        crate::cluster_session::owner(&self.app)?.activation_spot(&request.source_epoch, &request.spot_id, &request.spot_version)
    }
    fn canonical(&self) -> Result<Value, String> {
        if crate::worker::local_acceptance() { return Err("Live activation is unavailable in isolated acceptance".into()); }
        let worker = running_worker()?;
        let mut draft = read_canonical(worker)?; draft["nativeWorkerGeneration"] = json!(worker); Ok(draft)
    }
    fn open_editors(&self) -> Result<Vec<String>, String> {
        Ok(self.app.webview_windows().into_keys().filter(|label| crate::spot_editor_barrier::editor_role(label)).collect())
    }
    fn selection(&self) -> Result<Value, String> { selection_identity(&crate::station_selection::owner(&self.app)?.snapshot()?) }
    fn apply(&self, request: &Request, base: &Value, spot: &Value) -> Result<Value, String> {
        if crate::worker::local_acceptance() { return Err("Live activation is unavailable in isolated acceptance".into()); }
        validate_draft(base)?;
        let worker = base["nativeWorkerGeneration"].as_u64().filter(|value| *value > 0).ok_or("Activation worker generation is unavailable")?;
        let generation = valid_uuid(&base["generation"])?; let draft = valid_uuid(&base["qso"]["id"])?;
        let revision = base["revision"].as_u64().filter(|value| *value < MAX_REVISION).ok_or("Draft revision exhausted")?;
        {
            let mut contexts = self.operations.lock().map_err(|_| "Activation context unavailable")?;
            if contexts.contains_key(&request.operation_id) { return Err("Activation apply was already attempted; read its durable status instead".into()); }
            let radio=if crate::cw_track_selection::owns(&request.source_epoch) {&base["qso"]} else {spot};
            let expected_radio=json!({"frequencyHz":radio["frequencyHz"],"mode":radio["mode"],"band":radio["band"]});
            contexts.insert(request.operation_id.clone(), Context { request:request.clone(), worker, generation:generation.clone(),
                draft:draft.clone(), revision, spot:spot.clone(), expected_radio, lease:None, permit:None });
        }
        // Fence this target before the worker can commit it. Otherwise a
        // concurrent ordinary-follow read could turn between commit and reply.
        if self.draft_only(request) {
            if let Some(owner) = crate::cw_session_backend::existing() {
                owner.revoke()?;
                let state = owner.snapshot()?;
                if state["pending"] == true || !state["owner"].is_null() {
                    return Err("Use CW Stop and verify its outcome before loading a callsign. The draft is unchanged.".into());
                }
            }
            // Draft-only selection always retires follow intent before commit.
            auto_rotor::revoke();
        } else {
            let permit = auto_rotor::activation_started(Target { generation:generation.clone(), draft_id:draft.clone(),
                call:spot["call"].as_str().ok_or("Native report callsign unavailable")?.into(),
                band:spot["band"].as_str().unwrap_or("").into() })?;
            self.operations.lock().map_err(|_| "Activation context unavailable")?.get_mut(&request.operation_id)
                .ok_or("Activation context unavailable")?.permit = Some(permit);
        }
        let response = call(worker, "spot_draft_apply", json!({"operationID":request.operation_id,"generation":generation,
            "draftID":draft,"expectedRevision":revision,"spot":spot}))?;
        match response["status"].as_str() {
            Some("conflict") => { keys(&response, &["status","draft"])?; validate_draft(&response["draft"])?; return Ok(response); },
            Some("workspace_changed") => { keys(&response, &["status","generation"])?; valid_uuid(&response["generation"])?; return Ok(response); },
            Some("abandoned") => { self.context(request, |context| validate_recovery(&response,context,worker))?; return Ok(response); },
            Some("applied") => {}, _ => return Err("Activation apply acknowledgement was unrecognized; inspect its receipt before releasing editors".into()),
        }
        self.context(request, |context| validate_receipt(&response, context))?;
        let lease = response.get("leaseID").map(valid_uuid).transpose()?;
        let mut contexts = self.operations.lock().map_err(|_| "Activation context unavailable")?;
        let context = contexts.get_mut(&request.operation_id).ok_or("Activation context unavailable")?;
        context.lease = lease;
        if response["replay"] != false || context.lease.is_none() { context.permit = None; }
        Ok(response)
    }
    fn stage(&self, request: &Request, applied: &Value, stage: &str) -> Result<Value, String> {
        let (worker, mut params) = self.control_params(request, applied)?; params["stage"] = json!(stage);
        let response = call(worker, "spot_draft_stage", params)?;
        self.context(request, |context| validate_receipt(&response, context))?;
        if !matches!(response["status"].as_str(), Some("staged" | "already_staged")) || response["phase"] != stage
            || response["leaseID"] != applied["leaseID"] || response["replay"] != (response["status"] == "already_staged") {
            return Err("Activation stage acknowledgement was invalid; no effect is permitted".into());
        }
        Ok(response)
    }
    fn tune(&self, request: &Request, selection: &Value, spot: &Value, effect_started: &mut bool) -> Result<Value, String> {
        let worker = self.context(request, |context| if context.spot == *spot { Ok(context.worker) } else { Err("Activation report changed".into()) })?;
        let selection = selection_identity(selection)?;
        let radio_id = selection["radio_id"].as_str().ok_or("Radio slot unavailable")?;
        let provider = selection["provider"].as_str().ok_or("Radio selection unavailable")?;
        let tune = tune_request(provider, spot)?;
        let owner = crate::station_selection::owner_for(&self.app, radio_id)?;
        let telemetry = crate::station_telemetry::owner_for(&self.app, radio_id)?;
        let id = tune["id"].clone();
        let response = owner.activation_tune(tune, &selection, || {
            crate::worker::require_existing_generation(worker)?;
            if self.resolve(request)? != *spot { return Err("Spot source changed before control admission".into()); }
            telemetry.spot_tune_control(selection["generation"].as_u64().ok_or("Radio selection generation unavailable")?,
                selection["selection_id"].as_str().ok_or("Radio selection identity unavailable")?)
        }, |request| {
            crate::worker::require_existing_generation(worker)?;
            *effect_started = true;
            let response = if provider == "hamlib" { crate::hamlib::request(request) }
                else { crate::worker::request_existing_generation(request, worker) };
            if response.as_ref().is_ok_and(definitely_not_admitted) { *effect_started = false; }
            response
        })?;
        let tuned = result(&json!({"id":id}), response)?;
        if crate::worker::generation() != worker { return Err("Worker changed during tuning; no automatic turn is permitted".into()); }
        Ok(tuned)
    }
    fn rotor(&self, request: &Request, applied: &Value) -> Result<Value, String> {
        let (worker, permit) = self.context(request, |context| {
            validate_receipt(applied, context)?;
            Ok((context.worker, context.permit.clone().ok_or("Automatic rotor activation permit unavailable")?))
        })?;
        auto_rotor::activation_confirmed(&permit)?;
        auto_rotor::complete_activation_generation(&permit, worker, || Target::from_snapshot(&read_canonical(worker)?), |call| precise_lookup(worker, call))
    }
    fn finish(&self, request: &Request, applied: &Value, outcome: &str) -> Result<(), String> {
        let (worker, mut params) = self.control_params(request, applied)?; params["outcome"] = json!(outcome);
        let response = call(worker, "spot_draft_finish", params)?;
        self.context(request, |context| validate_receipt(&response, context))?;
        if response["status"] != "finished" || response["phase"] != outcome || response.get("leaseID").is_some() {
            return Err("Activation reservation release was not confirmed".into());
        }
        if let Ok(mut contexts) = self.operations.lock() {
            if let Some(context) = contexts.get_mut(&request.operation_id) { context.lease = None; context.permit = None; }
        }
        Ok(())
    }
    fn durable_status(&self, request: &Request, generation: &str) -> Result<Value, String> {
        let expected_generation = self.context(request, |context| Ok(context.generation.clone()))?;
        if valid_uuid(&json!(generation))? != expected_generation { return Err("Activation workspace changed".into()); }
        let worker = running_worker()?;
        let mut response = call(worker, "spot_draft_status", json!({"operationID":request.operation_id,"generation":generation}))?;
        if response["status"] == "not_found" {
            // Absence is not a FIFO barrier. Durably prevent a queued late
            // apply before allowing the coordinator to release editor buffers.
            response = call(worker,"spot_draft_abandon",json!({"operationID":request.operation_id,"generation":generation}))?;
        }
        self.context(request, |context| validate_recovery(&response, context, worker))?;
        if let Some(lease) = response.get("leaseID") {
            let lease = valid_uuid(lease)?;
            let mut contexts = self.operations.lock().map_err(|_| "Activation context unavailable")?;
            contexts.get_mut(&request.operation_id).ok_or("Activation context unavailable")?.lease = Some(lease);
        }
        Ok(response)
    }
    fn wake(&self) {
        for label in self.app.webview_windows().into_keys() {
            let _ = self.app.emit_to(&label, "xlog:spot-activation", ());
            let _ = self.app.emit_to(&label, "xlog:auto-rotor", ());
            if crate::spot_editor_barrier::editor_role(&label) || matches!(label.as_str(), "callsign-intelligence" | "previous-qsos") {
                let _ = self.app.emit_to(&label, "xlog:operator-draft-changed", ());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pre_dispatch_worker_failures_are_definitively_not_admitted() {
        for code in ["station-busy", "station_busy", "digital-engine-owns-radio", "station_unavailable"] {
            assert!(definitely_not_admitted(&json!({"ok":false,"error":{"code":code}})), "{code}");
        }
        for code in ["station_timeout", "station_rejected", "route-readback-mismatch"] {
            assert!(!definitely_not_admitted(&json!({"ok":false,"error":{"code":code}})), "{code}");
        }
        assert!(!definitely_not_admitted(&json!({"ok":true,"error":null})));
    }
    fn context() -> Context {
        Context { request:Request { operation_id:uuid::Uuid::new_v4().to_string(),source_epoch:uuid::Uuid::new_v4().to_string(),
            spot_id:"fixture".into(),spot_version:uuid::Uuid::new_v4().to_string() }, worker:7,
            generation:uuid::Uuid::new_v4().to_string(),draft:uuid::Uuid::new_v4().to_string(),revision:4,
            spot:json!({"call":"K1ABC","frequencyHz":14074000,"mode":"FT8","band":"20m"}),
            expected_radio:json!({"frequencyHz":14074000,"mode":"FT8","band":"20m"}),
            lease:Some(uuid::Uuid::new_v4().to_string()),permit:None }
    }
    #[test]
    fn missing_retirement_tombstones_before_canonical_read_and_never_dispatches_effects() {
        let context = context(); let mut calls = vec![];
        let draft = receipt(&context)["receipt"]["draft"].clone();
        let recovered = recover_missing_with(&context.request.operation_id, |method, params| {
            calls.push(method.to_owned());
            match method {
                "logbook_operator_draft" => Ok(json!({"draft":draft})),
                "spot_draft_abandon" => {
                    assert_eq!(params["operationID"],context.request.operation_id);
                    Ok(json!({"status":"abandoned","receipt":null,"replay":true,"generation":context.generation}))
                },
                _ => panic!("unexpected effect: {method}"),
            }
        }).unwrap();
        assert_eq!(calls,["logbook_operator_draft","spot_draft_abandon","logbook_operator_draft"]);
        assert_eq!(recovered["reservationActive"],false); assert_eq!(recovered["tuneConfirmed"],false);
    }
    #[test]
    fn orphan_receipt_releases_only_its_exact_lease_without_staging_or_replaying_effects() {
        let context = context(); let mut calls = vec![];
        let mut recovered = receipt(&context); recovered["status"] = json!("found"); recovered["replay"] = json!(true);
        let draft = recovered["receipt"]["draft"].clone();
        let result = recover_missing_with(&context.request.operation_id, |method, params| {
            calls.push(method.to_owned());
            match method {
                "logbook_operator_draft" => Ok(json!({"draft":draft})),
                "spot_draft_abandon" => Ok(recovered.clone()),
                "spot_draft_finish" => {
                    assert_eq!(params["leaseID"], json!(context.lease)); assert_eq!(params["outcome"], "uncertain");
                    let mut finished = recovered.clone(); finished["status"] = json!("finished"); finished["phase"] = json!("uncertain");
                    finished.as_object_mut().unwrap().remove("leaseID"); Ok(finished)
                },
                _ => panic!("unexpected effect: {method}"),
            }
        }).unwrap();
        assert_eq!(calls,["logbook_operator_draft","spot_draft_abandon","spot_draft_finish","logbook_operator_draft"]);
        assert_eq!(result["reservationActive"],false);
    }
    fn receipt(context: &Context) -> Value {
        json!({"status":"applied","replay":false,"phase":"draft_applied","leaseID":context.lease,
            "receipt":{"operationID":context.request.operation_id,"generation":context.generation,"phase":"draft_applied",
                "draft":{"generation":context.generation,"revision":context.revision+1,"qso":{"id":context.draft,
                    "call":"K1ABC","frequencyHz":14074000,"mode":"FT8","band":"20m"}}}})
    }
    #[test]
    fn automatic_bearing_uses_existing_precise_native_lookup_not_cty_only_route() {
        let profile = precise_lookup_with("K1ABC", |method, params| {
            assert_eq!(method, "lookup_call");
            assert_eq!(params, json!({"call":"K1ABC"}));
            Ok(json!({"call":"K1ABC","source":"QRZ","location_source":"QRZ coordinates","bearing":287.25}))
        }).unwrap();
        assert_eq!(profile["bearing"], 287.25);
        assert_eq!(profile["location_source"], "QRZ coordinates");
    }
    #[test]
    fn worker_envelope_is_exact_and_never_turns_unknown_success_into_confirmation() {
        let request = json!({"id":"one"});
        assert_eq!(result(&request,json!({"id":"one","ok":true,"result":{"confirmed":false}})).unwrap()["confirmed"],false);
        for response in [json!({"id":"wrong","ok":true,"result":{}}),json!({"id":"one","ok":1,"result":{}}),
            json!({"id":"one","ok":true,"result":null}),json!({"id":"one","ok":true,"result":{},"extra":true}),
            json!({"id":"one","ok":false,"result":{"confirmed":true}})] {
            assert!(result(&request,response).is_err());
        }
    }
    #[test]
    fn receipt_must_match_operation_workspace_draft_revision_and_native_target() {
        let context = context(); let valid = receipt(&context); validate_receipt(&valid,&context).unwrap();
        for path in ["/receipt/operationID","/receipt/generation","/receipt/draft/generation","/receipt/draft/qso/id"] {
            let mut changed = valid.clone(); *changed.pointer_mut(path).unwrap() = json!(uuid::Uuid::new_v4().to_string());
            assert!(validate_receipt(&changed,&context).is_err(),"{path}");
        }
        for (path,value) in [("/receipt/draft/revision",json!(context.revision)),("/receipt/draft/qso/call",json!("K2ABC")),
            ("/receipt/draft/qso/frequencyHz",json!(7074000)),("/receipt/draft/qso/mode",json!("CW")),
            ("/receipt/draft/qso/band",json!("40m")),("/receipt/phase",json!("confirmed")),("/replay",json!(null))] {
            let mut changed = valid.clone(); *changed.pointer_mut(path).unwrap()=value;
            assert!(validate_receipt(&changed,&context).is_err(),"{path}");
        }
    }
    #[test]
    fn callsign_only_receipts_must_preserve_the_canonical_radio_fields() {
        let mut context=context();
        context.spot=json!({"call":"K1ABC","frequencyHz":null,"mode":"","band":"","cwCallsign":{}});
        context.expected_radio=json!({"frequencyHz":7188000,"mode":"LSB","band":"40m"});
        let mut valid=receipt(&context);
        valid["receipt"]["draft"]["qso"]["frequencyHz"]=json!(7188000);
        valid["receipt"]["draft"]["qso"]["mode"]=json!("LSB");valid["receipt"]["draft"]["qso"]["band"]=json!("40m");
        validate_receipt(&valid,&context).unwrap();
        for (field,value) in [("frequencyHz",Value::Null),("mode",json!("CW")),("band",json!("20m"))] {
            let mut changed=valid.clone();changed["receipt"]["draft"]["qso"][field]=value;
            assert!(validate_receipt(&changed,&context).is_err(),"{field}");
        }
    }
    #[test]
    fn replacement_worker_never_relabels_absent_or_live_reservation_as_safe() {
        let context=context();
        let absent=json!({"status":"not_found","receipt":null,"replay":true,"generation":context.generation});
        assert!(validate_recovery(&absent,&context,7).is_err());
        assert!(validate_recovery(&absent,&context,8).is_err());
        let mut abandoned=absent.clone();abandoned["status"]=json!("abandoned");
        validate_recovery(&abandoned,&context,7).unwrap();validate_recovery(&abandoned,&context,8).unwrap();
        abandoned["generation"]=json!(uuid::Uuid::new_v4().to_string());assert!(validate_recovery(&abandoned,&context,7).is_err());
        let mut found=receipt(&context);found["status"]=json!("found");found["replay"]=json!(true);
        validate_recovery(&found,&context,7).unwrap();
        assert!(validate_recovery(&found,&context,8).is_err());
        found["phase"]=json!("uncertain");found.as_object_mut().unwrap().remove("leaseID");
        validate_recovery(&found,&context,8).unwrap();
        found["leaseID"]=json!(context.lease);
        assert!(validate_recovery(&found,&context,8).is_err());
    }
    #[test]
    fn selection_comparison_ignores_notification_noise_not_control_or_source_identity() {
        let value=json!({"radio_id":"radio1","provider":"direct_agent","generation":2,"selection_id":uuid::Uuid::new_v4().to_string(),
            "control_revision":5,"power_notification":{"state":"pending"}});
        let mut changed=value.clone();changed["power_notification"]=json!({"state":"ready"});
        assert_eq!(selection_identity(&value).unwrap(),selection_identity(&changed).unwrap());
        changed["control_revision"]=json!(6);assert_ne!(selection_identity(&value).unwrap(),selection_identity(&changed).unwrap());
        changed=value.clone();changed["radio_id"]=json!("radio2");assert_ne!(selection_identity(&value).unwrap(),selection_identity(&changed).unwrap());
        changed["selection_id"]=json!("invalid");assert!(selection_identity(&changed).is_err());
    }
    #[test]
    fn native_hamlib_tune_mode_mapping_matches_embedded_contract_without_transmit_commands() {
        for (mode,hz,expected) in [("SSB",7_100_000,"LSB"),("SSB",14_195_000,"USB"),("FT8",14_074_000,"PKTUSB"),("DIGL",7_074_000,"PKTLSB")] {
            let request=tune_request("hamlib",&json!({"frequencyHz":hz,"mode":mode})).unwrap();
            assert_eq!(request["method"],"hamlib_control");assert_eq!(request["params"]["action"],"tune_simplex");
            assert_eq!(request["params"]["mode"],expected);
        }
        for spot in [json!({"frequencyHz":0,"mode":"CW"}),json!({"frequencyHz":14025000,"mode":"raw command"}),json!({"frequencyHz":14025000.5,"mode":"CW"})] {
            assert!(tune_request("direct_agent",&spot).is_err());
        }
        let tci=tune_request("direct_tci",&json!({"frequencyHz":14025000,"mode":"CW"})).unwrap();
        assert_eq!(tci["method"],"station_tune");assert_eq!(tci["params"]["provider"],"direct_tci");
        assert!(tune_request("xcat_loopback",&json!({"frequencyHz":14025000,"mode":"CW"})).is_err());
    }
}
