//! Finite offline lane adapter around the existing single-owner CW Session.
//! This adapter never owns a physical transport or opens a device. Production
//! lanes stay explicitly unavailable until their exact route is qualified.
use crate::cw_session::{Backend, Session};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};

const CONTEXT_KEYS: [&str; 8] = ["sessionID", "workspaceGeneration", "laneID", "draftID", "bindingVersion", "binding", "workerGeneration", "action"];
fn identity(value: &Value) -> bool { value.as_str().is_some_and(|v| !v.is_empty() && v.len() <= 128 && !v.chars().any(char::is_control)) }
fn lane_id(value: &Value) -> Result<&str, String> { value.as_str().filter(|v| matches!(*v, "laneA" | "laneB")).ok_or("Choose an explicit contest lane.".into()) }
fn scope(value: &Value) -> Result<(), String> {
    if !identity(&value["sessionID"]) || !identity(&value["workspaceGeneration"]) { return Err("Contest lane session/workspace identity is unavailable.".into()); }
    lane_id(&value["laneID"])?;
    Ok(())
}
fn context(value: &Value) -> Result<Value, String> {
    scope(value)?;
    if !identity(&value["draftID"]) || value["bindingVersion"].as_u64().is_none_or(|n| n > 9_007_199_254_740_991) { return Err("Contest lane draft/binding identity is unavailable.".into()); }
    Ok(json!({"sessionID":value["sessionID"],"workspaceGeneration":value["workspaceGeneration"],"laneID":value["laneID"],
        "draftID":value["draftID"],"bindingVersion":value["bindingVersion"],"binding":value["binding"]}))
}
fn native_context(value: &Value) -> Result<Value, String> {
    if value["workerGeneration"].as_u64().is_none_or(|n| n == 0 || n > 9_007_199_254_740_991)
        || !identity(&value["operatingContext"]) { return Err("Trusted native worker/operating context is unavailable.".into()); }
    Ok(json!({"workerGeneration":value["workerGeneration"],"operatingContext":value["operatingContext"],
        "sessionID":value["sessionID"],"workspaceGeneration":value["workspaceGeneration"]}))
}
fn routes() -> Vec<Value> {
    let mut result = vec![];
    for radio in ["radio1", "radio2"] { for (receiver, vfo) in [("receiver1", "A"), ("receiver2", "B")] {
        result.push(json!({"radioID":radio,"receiverID":receiver,"vfo":vfo,"sliceID":null,"generation":1}));
    } }
    result
}
fn fake_binding(value: &Value) -> Result<(), String> {
    if value.as_object().is_none_or(|v| v.len() != 5)
        || !routes().contains(value) { return Err("The exact fake radio/receiver/VFO/slice/connection generation is unavailable; refresh capabilities and rebind.".into()); }
    Ok(())
}
fn capabilities(offline: bool) -> Value {
    json!({"supported":offline,"simulated":offline,"externalIO":false,"physicalQualified":false,
        "reason":if offline { "Marked offline fake routes only; no RF, audio, device or provider connection." } else { "Exact lane receiver/VFO/output route is not qualified. Existing SO1V controls remain available separately." },
        "routes":if offline {routes()} else {vec![]},"wholeString":true,"incrementalCancellation":false,"earlySend":false,
        "singleTransmitter":true,"voice":false,"listeningAudio":false,"splitProgramming":false,
        "transverterMapping": {"provider":"test-simulation","available":offline,"ifLowHz":100000,"ifHighHz":1000000000,"spectralInversion":false}})
}

fn transverter_if(params: &Value, canonical: &Value) -> Result<u64, String> {
    let rf = params["rfFrequencyHz"].as_u64().filter(|n| (100_000..=7_500_000_000_000).contains(n)).ok_or("Invalid declared transverter RF")?;
    if params["rfFrequencyHz"] != canonical["frequencyHz"] { return Err("The reviewed RF draft changed; no IF command was sent.".into()); }
    if !canonical["receiveFrequencyHz"].is_null() && canonical["receiveFrequencyHz"] != canonical["frequencyHz"] {
        return Err("Split RF/IF programming is unavailable for this route.".into());
    }
    let map = &params["mapping"];
    if map.as_object().is_none_or(|v|v.len()!=5 || v.keys().any(|k| !["band","loHz","inverted","ifLowHz","ifHighHz"].contains(&k.as_str()))) {
        return Err("Use the exact reviewed transverter mapping.".into());
    }
    if map["band"].as_str().is_none_or(|v|v.is_empty()||v.len()>16) || map["inverted"].as_bool().is_none() {
        return Err("Transverter band and spectral orientation are required.".into());
    }
    if map["band"].as_str().and_then(|v|v.parse::<f64>().ok()).filter(|v|v.is_finite()&&*v>0.0) != canonical["band"].as_f64() {
        return Err("Mapping band differs from the authoritative RF entry band.".into());
    }
    if map["inverted"] == true { return Err("This provider does not support spectral inversion/mode translation; no IF command was sent.".into()); }
    let lo = map["loHz"].as_u64().filter(|n|*n<=7_500_000_000_000).ok_or("Invalid transverter LO")?;
    let low = map["ifLowHz"].as_u64().filter(|n|(100_000..=1_000_000_000).contains(n)).ok_or("IF minimum exceeds the selected provider capability")?;
    let high = map["ifHighHz"].as_u64().filter(|n|(100_000..=1_000_000_000).contains(n)).ok_or("IF maximum exceeds the selected provider capability")?;
    if low > high { return Err("Invalid provider IF interval".into()); }
    rf.checked_sub(lo).filter(|n|(low..=high).contains(n)).ok_or("Mapped IF is outside the selected provider interval".into())
}

struct FakeBackend { canonical: Mutex<Value>, target: Mutex<Value>, events: Mutex<Vec<Value>>, uncertain_stop: AtomicBool }
impl Backend for FakeBackend {
    fn canonical(&self) -> Result<Value, String> { Ok(self.canonical.lock().map_err(|_| "Fake canonical unavailable")?.clone()) }
    fn inspect(&self, _: &Value, _: bool) -> Result<Value, String> { Ok(self.target.lock().map_err(|_| "Fake target unavailable")?.clone()) }
    fn output(&self, target: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String> {
        if target["output"] != "test-simulation" || target["provider"] != "test-simulation" { return Err("Offline lane target cannot acquire a physical provider.".into()); }
        if !matches!(action, "arm" | "send" | "stop") || action == "send" && (text.is_none() || intent == 0) { return Err("Invalid finite fake output action.".into()); }
        let mut events = self.events.lock().map_err(|_| "Fake output history unavailable")?;
        if events.len() == 128 { events.remove(0); }
        events.push(json!({"action":action,"text":text,"intent":intent,"binding":target["laneContext"]["binding"],
            "laneID":target["laneContext"]["laneID"],"draftID":target["laneContext"]["draftID"],"simulated":true,"externalIO":false}));
        if action == "stop" && self.uncertain_stop.load(Ordering::SeqCst) { return Err("Fake Stop remains unconfirmed; the original output owner is retained.".into()); }
        Ok(json!({"accepted":true,"confirmed":true,"simulated":true,"externalIO":false}))
    }
}
struct OfflineAdapter { backend: Arc<FakeBackend>, session: Session, client: String, sequence: u64,
    scope: Value, lanes: BTreeMap<String, Value>, listening: Option<String>, tx: Option<Value>, consumed: BTreeSet<String>,
    native: Value, tx_native: Value, retired_contexts: BTreeSet<String> }
impl OfflineAdapter {
    fn new() -> Self {
        let backend = Arc::new(FakeBackend { canonical: Mutex::new(Value::Null), target: Mutex::new(Value::Null),
            events: Mutex::new(vec![]), uncertain_stop: AtomicBool::new(false) });
        Self { session: Session::new(backend.clone()), backend, client: uuid::Uuid::new_v4().to_string(), sequence: 0,
            scope: Value::Null, lanes: BTreeMap::new(), listening: None, tx: None, consumed: BTreeSet::new(),
            native: Value::Null, tx_native: Value::Null, retired_contexts: BTreeSet::new() }
    }
    fn cw(&mut self, action: &str, extra: Value) -> Result<Value, String> {
        let snapshot = self.session.snapshot()?;
        self.sequence = self.sequence.checked_add(1).ok_or("Fake output sequence exhausted")?;
        let mut params = json!({"action":action,"expectedRevision":snapshot["revision"],"lease":snapshot["lease"],"confirmed":true});
        for (key, value) in extra.as_object().ok_or("Invalid fake output request")? { params[key] = value.clone(); }
        self.session.request("contest--active-qso", &self.client, self.sequence, true, &params)
    }
    fn snapshot(&self) -> Result<Value, String> {
        Ok(json!({"simulated":true,"externalIO":false,"capabilities":capabilities(true),"lanes":self.lanes,
            "listenLaneID":self.listening,"txLaneID":self.tx.as_ref().map(|v|v["laneID"].clone()),"txContext":self.tx,
            "nativeContext":self.native,"txNativeContext":self.tx_native,"releaseRequired":self.tx.is_some() && self.native != self.tx_native,
            "cw":self.session.snapshot()?,"events":self.backend.events.lock().map_err(|_| "Fake history unavailable")?.clone()}))
    }
    fn request(&mut self, params: &Value, canonical: &Value) -> Result<Value, String> {
        scope(params)?;
        let action = params["action"].as_str().ok_or("Missing contest lane action")?;
        let request_scope = json!({"sessionID":params["sessionID"],"workspaceGeneration":params["workspaceGeneration"]});
        if action == "stop" {
            if params.as_object().is_none_or(|v| v.keys().any(|k| !["action", "sessionID", "workspaceGeneration", "laneID", "stopOutcome"].contains(&k.as_str()))) { return Err("Stop releases only the retained lane owner.".into()); }
            if let Some(tx) = &self.tx {
                if request_scope != self.scope || params["laneID"] != tx["laneID"] { return Err("Stop must name the original retained contest lane; another draft is untouched.".into()); }
            } else { return self.snapshot(); }
            let outcome = params["stopOutcome"].as_str().unwrap_or("confirmed");
            if !matches!(outcome, "confirmed" | "uncertain") { return Err("Invalid fake Stop outcome.".into()); }
            self.backend.uncertain_stop.store(outcome == "uncertain", Ordering::SeqCst);
            let retired = self.tx.is_some() && self.tx_native != self.native;
            let result = self.cw("stop", json!({}));
            if result.is_ok() {
                self.tx = None; self.tx_native = Value::Null;
                if retired { self.lanes.clear(); self.listening = None; }
            }
            let mut snapshot = self.snapshot()?;
            snapshot["receipt"] = json!({"action":"stop","accepted":result.is_ok(),"confirmed":result.is_ok(),
                "error":result.err(),"simulated":true,"externalIO":false});
            return Ok(snapshot);
        }
        let current = context(canonical)?;
        let requested = context(params)?;
        if action == "tune" && !canonical["receiveFrequencyHz"].is_null()
            && (canonical["receiveFrequencyHz"] != canonical["frequencyHz"] || params["frequencyHz"] != canonical["receiveFrequencyHz"]) {
            return Err("This lane has distinct RX/TX frequencies, but exact split programming is unsupported; no tuning action was taken.".into());
        }
        let native = native_context(canonical)?;
        if self.native["workerGeneration"].as_u64().is_some_and(|old| native["workerGeneration"].as_u64().unwrap() < old)
            || native["operatingContext"].as_str().is_some_and(|id| self.retired_contexts.contains(id)) {
            return Err("This native worker/operating context was retired; no old request can rearm output.".into());
        }
        if native != self.native {
            if let Some(previous) = self.native["operatingContext"].as_str().filter(|id| *id != native["operatingContext"].as_str().unwrap()) {
                if self.retired_contexts.len() >= 32 { return Err("Native operating-context bound reached; restart the offline fixture safely.".into()); }
                self.retired_contexts.insert(previous.into());
            }
            self.native = native.clone();
            // Invalidate the old lease through its original retained target.
            // A failed release keeps that target and cannot grant a new owner.
            if self.tx.is_some() {
                self.cw("stop", json!({}))?;
                self.tx = None; self.tx_native = Value::Null;
            }
            self.lanes.clear(); self.listening = None;
        }
        if requested != current { return Err("Lane, draft or binding changed; no old request was rerouted.".into()); }
        if action != "capabilities" && params["workerGeneration"] != native["workerGeneration"] {
            return Err("Native worker changed; refresh lane capabilities before another explicit action.".into());
        }
        if self.scope != request_scope {
            if self.tx.is_some() { return Err("Release the original contest output before entering another session.".into()); }
            self.scope = request_scope; self.lanes.clear(); self.listening = None; self.consumed.clear();
        }
        if action == "capabilities" { return self.snapshot(); }
        if self.tx.is_some() && self.tx_native != self.native {
            return Err("Release of the retired native output remains unconfirmed; use Stop on its original lane.".into());
        }
        fake_binding(&current["binding"])?;
        let mut allowed = CONTEXT_KEYS.to_vec();
        match action { "tune" => allowed.extend(["frequencyHz", "mode"]), "transverter_tune" => allowed.extend(["rfFrequencyHz","mapping","mode"]), "send" => allowed.extend(["text", "operationID"]),
            "bind" | "listen" | "requestTX" => {}, _ => return Err("Unknown finite contest lane action.".into()) }
        if params.as_object().is_none_or(|v| v.keys().any(|k| !allowed.contains(&k.as_str()))) { return Err("Unexpected contest lane action fields.".into()); }
        let lane = lane_id(&current["laneID"])?;
        if self.tx.as_ref().is_some_and(|tx| tx["laneID"] == current["laneID"] && tx != &current) {
            return Err("Release the original output binding before changing this lane.".into());
        }
        match action {
            "bind" => {
                if self.lanes.iter().any(|(id, value)| id != lane && ["radioID", "receiverID", "vfo", "sliceID"].iter()
                    .all(|key| value["context"]["binding"][*key] == current["binding"][*key])) {
                    return Err("Two lanes cannot claim the same exact receiver/VFO/slice target.".into());
                }
                if self.listening.as_deref() == Some(lane) && self.lanes.get(lane).is_some_and(|previous|
                    previous["context"]["binding"] != current["binding"] || previous["context"]["bindingVersion"] != current["bindingVersion"]) {
                    self.listening = None;
                }
                self.lanes.insert(lane.into(), json!({"context":current,"frequencyHz":null,"mode":null}));
            }
            "tune" | "listen" | "transverter_tune" => {
                let mapped = if action == "transverter_tune" {Some(transverter_if(params,canonical)?)} else {None};
                let lane_state = self.lanes.get_mut(lane).filter(|v| v["context"] == current).ok_or("Bind this exact lane before tuning or listening")?;
                if action == "tune" || action == "transverter_tune" {
                    let hz = mapped.or_else(||params["frequencyHz"].as_u64()).filter(|n| (100_000..=1_000_000_000).contains(n)).ok_or("Invalid fake tuning frequency")?;
                    let mode = params["mode"].as_str().filter(|v| matches!(*v, "CW" | "SSB" | "RTTY")).ok_or("Invalid fake tuning mode")?;
                    lane_state["frequencyHz"] = json!(hz); lane_state["mode"] = json!(mode);
                    lane_state["rfFrequencyHz"] = if mapped.is_some(){params["rfFrequencyHz"].clone()}else{json!(hz)};
                    lane_state["transverterMapping"] = if mapped.is_some(){params["mapping"].clone()}else{Value::Null};
                } else { self.listening = Some(lane.into()); }
            }
            "requestTX" => {
                if self.tx.is_some() { return Err("Confirm Stop/release of the original output before requesting another TX lane.".into()); }
                if self.lanes.get(lane).is_none_or(|v| v["context"] != current) { return Err("Bind this exact lane before requesting TX.".into()); }
                let target = json!({"output":"test-simulation","provider":"test-simulation","generation":current["binding"]["generation"],
                    "worker":native["workerGeneration"],"selection":current,"laneContext":current,"limit":128,"last_intent":0});
                let cw_canonical = json!({"worker":native["workerGeneration"],"operatingContext":native["operatingContext"],"generation":"offline-lanes","settingsRevision":1,"draftRevision":current["bindingVersion"],
                    "contestSessionID":current["sessionID"],"draftID":current["draftID"],"laneContext":current,
                    "profile":{"output":"radio"},"provider":"test-simulation","selection":current,"context":{}});
                *self.backend.target.lock().map_err(|_| "Fake target unavailable")? = target;
                *self.backend.canonical.lock().map_err(|_| "Fake canonical unavailable")? = cw_canonical;
                self.cw("snapshot", json!({}))?;
                self.cw("arm", json!({}))?;
                self.tx = Some(current.clone());
                self.tx_native = native.clone();
            }
            "send" => {
                if self.tx.as_ref() != Some(&current) { return Err("Explicitly request TX for this exact lane before sending.".into()); }
                let operation = params["operationID"].as_str().filter(|v| uuid::Uuid::parse_str(v).is_ok()).ok_or("Exact fake output operation identity is required")?;
                if self.consumed.contains(operation) { return Err("That output operation was already consumed; no message was replayed.".into()); }
                if self.consumed.len() >= 256 { return Err("Offline output operation bound reached; no history was discarded or replayed.".into()); }
                self.consumed.insert(operation.into());
                let response = self.cw("contest", json!({"operation":"text","text":params["text"],"operationID":operation,
                    "sessionID":current["sessionID"],"draftID":current["draftID"],"expectedContestRevision":current["bindingVersion"]}))?;
                if response["contestResult"]["accepted"] != true || response["contestResult"]["operationID"] != operation { return Err("Fake whole-string output was not confirmed; no retry is authorized.".into()); }
            }
            _ => unreachable!(),
        }
        let mut snapshot = self.snapshot()?;
        snapshot["receipt"] = json!({"action":action,"accepted":true,"confirmed":true,"context":current,"operationID":params["operationID"],"simulated":true,"externalIO":false});
        Ok(snapshot)
    }
}
static OFFLINE: OnceLock<Mutex<OfflineAdapter>> = OnceLock::new();
/// The caller owns marked-root/native-window/context admission. False never dispatches.
pub fn request(params: &Value, canonical: &Value, offline: bool) -> Result<Value, String> {
    if !offline {
        if params["action"] == "capabilities" { return Ok(json!({"simulated":false,"externalIO":false,"capabilities":capabilities(false)})); }
        return Err("Exact physical contest lane routing is unavailable; use qualified SO1V controls.".into());
    }
    OFFLINE.get_or_init(|| Mutex::new(OfflineAdapter::new())).lock().map_err(|_| "Offline lane adapter unavailable".to_string())?.request(params, canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transverter_routes_only_valid_if_to_exact_fake_lane_without_widening_provider_or_rf_attribution() {
        let mut owner = OfflineAdapter::new();
        let mut a = canonical("laneA","radio1","receiver1","A");
        a["frequencyHz"] = json!(10_368_000_000u64); a["band"] = json!(10000);
        call(&mut owner,&a,"bind",json!({})).unwrap();
        let mapping=json!({"band":"10000","loHz":10_224_000_000u64,"inverted":false,"ifLowHz":140000000,"ifHighHz":148000000});
        let extra=json!({"mapping":mapping,"rfFrequencyHz":10_368_000_000u64,"mode":"CW"});
        let result=call(&mut owner,&a,"transverter_tune",extra.clone()).unwrap();
        assert_eq!(result["lanes"]["laneA"]["frequencyHz"],144000000);
        assert_eq!(result["lanes"]["laneA"]["rfFrequencyHz"],10_368_000_000u64);
        assert!(result["txLaneID"].is_null()); assert!(result["listenLaneID"].is_null());
        assert_eq!(result["events"].as_array().unwrap().len(),0);
        for key in ["loHz","ifHighHz","inverted","band","rfFrequencyHz"] {
            let mut invalid=extra.clone();
            match key {"loHz"=>invalid["mapping"][key]=json!(1),"ifHighHz"=>invalid["mapping"][key]=json!(2_000_000_000u64),
                "inverted"=>invalid["mapping"][key]=json!(true),"band"=>invalid["mapping"][key]=json!("20m"),_=>invalid[key]=json!(10_369_000_000u64)};
            assert!(call(&mut owner,&a,"transverter_tune",invalid).is_err(),"{key}");
            assert_eq!(owner.snapshot().unwrap()["lanes"]["laneA"]["frequencyHz"],144000000);
        }
        let mut split=a.clone();split["receiveFrequencyHz"]=json!(10_369_000_000u64);
        assert!(call(&mut owner,&split,"transverter_tune",extra.clone()).is_err());
        assert!(request(&extra,&a,false).is_err());
    }
    fn canonical(lane: &str, radio: &str, receiver: &str, vfo: &str) -> Value {
        json!({"sessionID":"fixture-session","workspaceGeneration":"fixture-workspace","laneID":lane,"draftID":format!("draft-{lane}"),
            "bindingVersion":1,"workerGeneration":4,"operatingContext":"operating-context-1", "binding":{"radioID":radio,"receiverID":receiver,"vfo":vfo,"sliceID":null,"generation":1}})
    }
    fn call(owner: &mut OfflineAdapter, ctx: &Value, action: &str, extra: Value) -> Result<Value, String> {
        let mut params = ctx.clone(); params["action"] = json!(action);
        params.as_object_mut().unwrap().remove("operatingContext");
        for key in ["band","frequencyHz","receiveFrequencyHz"] {params.as_object_mut().unwrap().remove(key);}
        for (key, value) in extra.as_object().unwrap() { params[key] = value.clone(); }
        owner.request(&params, ctx)
    }
    fn stop(owner: &mut OfflineAdapter, ctx: &Value, outcome: &str) -> Value {
        owner.request(&json!({"action":"stop","sessionID":ctx["sessionID"],"workspaceGeneration":ctx["workspaceGeneration"],"laneID":ctx["laneID"],"stopOutcome":outcome}), &Value::Null).unwrap()
    }
    #[test]
    fn unsupported_explicit_rx_tx_split_rejects_tune_without_any_effect() {
        let mut owner = OfflineAdapter::new(); let a = canonical("laneA", "radio1", "receiver1", "A");
        call(&mut owner, &a, "bind", json!({})).unwrap();
        call(&mut owner, &a, "tune", json!({"frequencyHz":14025000,"mode":"CW"})).unwrap();
        let before = owner.snapshot().unwrap();
        let mut split = a.clone(); split["frequencyHz"] = json!(14025000);
        split["receiveFrequencyHz"] = json!(14026000);
        let mut params = a.clone();
        params.as_object_mut().unwrap().remove("operatingContext");
        params["action"] = json!("tune");
        params["frequencyHz"] = json!(14025000); params["mode"] = json!("CW");
        let error = owner.request(&params, &split).unwrap_err();
        assert!(error.contains("split programming is unsupported"));
        assert_eq!(owner.snapshot().unwrap(), before, "Unsupported split cannot change frequency, listening, TX or ownership metadata");
        split["receiveFrequencyHz"] = json!(14025000);
        params["frequencyHz"] = json!(14027000);
        assert!(owner.request(&params, &split).unwrap_err().contains("split programming is unsupported"));
        assert_eq!(owner.snapshot().unwrap(), before, "A requested TX retune cannot silently move an explicitly fixed RX even when current RX equals TX");
        assert!(owner.backend.events.lock().unwrap().is_empty());
        assert_eq!(capabilities(true)["splitProgramming"], false);
        assert_eq!(capabilities(false)["splitProgramming"], false);
    }
    #[test]
    fn nonfocus_tune_listen_never_change_other_lane_or_acquire_tx() {
        let mut owner = OfflineAdapter::new();
        let a = canonical("laneA", "radio1", "receiver1", "A"); let b = canonical("laneB", "radio2", "receiver2", "B");
        call(&mut owner, &a, "bind", json!({})).unwrap(); call(&mut owner, &b, "bind", json!({})).unwrap();
        let result = call(&mut owner, &b, "tune", json!({"frequencyHz":14025000,"mode":"CW"})).unwrap();
        assert_eq!(result["lanes"]["laneA"]["frequencyHz"], Value::Null);
        assert_eq!(result["lanes"]["laneB"]["frequencyHz"], 14025000);
        assert_eq!(result["txLaneID"], Value::Null); assert_eq!(result["cw"]["armed"], false);
        assert_eq!(call(&mut owner, &b, "listen", json!({})).unwrap()["listenLaneID"], "laneB");
        assert_eq!(owner.backend.events.lock().unwrap().len(), 0);
        let same_receiver = canonical("laneB", "radio1", "receiver1", "A");
        assert!(call(&mut owner, &same_receiver, "bind", json!({})).is_err());
    }
    #[test]
    fn rebind_invalidates_only_changed_listening_route_and_draft_advance_preserves_it() {
        let mut owner = OfflineAdapter::new();
        let mut a = canonical("laneA", "radio1", "receiver1", "A"); let mut b = canonical("laneB", "radio2", "receiver2", "B");
        call(&mut owner, &a, "bind", json!({})).unwrap(); call(&mut owner, &b, "bind", json!({})).unwrap();
        call(&mut owner, &b, "listen", json!({})).unwrap();
        let before_b = owner.snapshot().unwrap()["lanes"]["laneB"].clone();
        a["bindingVersion"] = json!(2);
        let other = call(&mut owner, &a, "bind", json!({})).unwrap();
        assert_eq!(other["listenLaneID"], "laneB"); assert_eq!(other["lanes"]["laneB"], before_b);
        b["draftID"] = json!("next-draft-b");
        assert_eq!(call(&mut owner, &b, "bind", json!({})).unwrap()["listenLaneID"], "laneB");
        b["bindingVersion"] = json!(2);
        assert_eq!(call(&mut owner, &b, "bind", json!({})).unwrap()["listenLaneID"], Value::Null);
        call(&mut owner, &b, "listen", json!({})).unwrap();
        let before_a = owner.snapshot().unwrap()["lanes"]["laneA"].clone();
        b["binding"]["receiverID"] = json!("receiver1"); b["binding"]["vfo"] = json!("A");
        let changed = call(&mut owner, &b, "bind", json!({})).unwrap();
        assert_eq!(changed["listenLaneID"], Value::Null); assert_eq!(changed["lanes"]["laneA"], before_a);
        assert_eq!(changed["cw"]["armed"], false); assert!(owner.backend.events.lock().unwrap().is_empty());
    }
    #[test]
    fn one_tx_owner_requires_confirmed_release_and_stop_is_pinned_after_rebind() {
        let mut owner = OfflineAdapter::new();
        let a = canonical("laneA", "radio1", "receiver1", "A"); let b = canonical("laneB", "radio2", "receiver2", "B");
        for ctx in [&a, &b] { call(&mut owner, ctx, "bind", json!({})).unwrap(); }
        call(&mut owner, &a, "requestTX", json!({})).unwrap();
        let sent = call(&mut owner, &a, "send", json!({"text":"K1ABC/P","operationID":uuid::Uuid::new_v4().to_string()})).unwrap();
        assert_eq!(sent["txLaneID"], "laneA"); assert_eq!(sent["externalIO"], false);
        assert!(call(&mut owner, &b, "requestTX", json!({})).is_err());
        let uncertain = stop(&mut owner, &a, "uncertain");
        assert_eq!(uncertain["receipt"]["confirmed"], false); assert_eq!(uncertain["txLaneID"], "laneA");
        assert!(call(&mut owner, &b, "requestTX", json!({})).is_err());
        let mut reconnect = a.clone(); reconnect["bindingVersion"] = json!(2); reconnect["binding"]["generation"] = json!(2);
        let old = { let mut value = a.clone(); value["action"] = json!("send"); value["text"] = json!("STALE"); value["operationID"] = json!(uuid::Uuid::new_v4().to_string()); value };
        assert!(owner.request(&old, &reconnect).is_err());
        assert_eq!(stop(&mut owner, &a, "confirmed")["txLaneID"], Value::Null);
        call(&mut owner, &b, "requestTX", json!({})).unwrap();
        assert_eq!(owner.snapshot().unwrap()["txLaneID"], "laneB");
        let events = owner.backend.events.lock().unwrap();
        assert!(events.iter().filter(|v|v["action"]=="stop").all(|v|v["binding"]==a["binding"]));
    }
    #[test]
    fn consumed_whole_string_operation_never_replays_on_same_or_rearmed_lane() {
        let mut owner = OfflineAdapter::new(); let a = canonical("laneA", "radio1", "receiver1", "A");
        call(&mut owner, &a, "bind", json!({})).unwrap(); call(&mut owner, &a, "requestTX", json!({})).unwrap();
        let attempt = json!({"text":"K1ABC/P","operationID":uuid::Uuid::new_v4().to_string()});
        call(&mut owner, &a, "send", attempt.clone()).unwrap();
        assert!(call(&mut owner, &a, "send", attempt.clone()).is_err());
        stop(&mut owner, &a, "confirmed"); call(&mut owner, &a, "requestTX", json!({})).unwrap();
        assert!(call(&mut owner, &a, "send", attempt).is_err());
        assert_eq!(owner.backend.events.lock().unwrap().iter().filter(|e|e["action"]=="send").count(), 1);
    }
    #[test]
    fn fake_binding_capabilities_and_generation_types_are_exact_and_production_never_dispatches() {
        assert_eq!(capabilities(true)["routes"].as_array().unwrap().len(), 4);
        let mut current = canonical("laneA", "radio1", "receiver1", "A");
        let mut owner = OfflineAdapter::new();
        current["binding"]["generation"] = json!("1");
        assert!(call(&mut owner, &current, "bind", json!({})).is_err(), "String generation must not equal numeric generation");
        let unsupported = request(&json!({"action":"capabilities"}), &Value::Null, false).unwrap();
        assert_eq!(unsupported["capabilities"]["supported"], false);
        assert!(request(&json!({"action":"send"}), &Value::Null, false).is_err());
        assert!(owner.backend.events.lock().unwrap().is_empty());
    }
    #[test]
    fn native_worker_restart_disarms_exact_old_target_and_never_accepts_late_worker_requests() {
        let mut owner = OfflineAdapter::new(); let a = canonical("laneA", "radio1", "receiver1", "A");
        call(&mut owner, &a, "bind", json!({})).unwrap(); call(&mut owner, &a, "requestTX", json!({})).unwrap();
        call(&mut owner, &a, "send", json!({"text":"FIRST","operationID":uuid::Uuid::new_v4().to_string()})).unwrap();
        let mut replacement = a.clone(); replacement["workerGeneration"] = json!(5);
        let mut late = a.clone(); late.as_object_mut().unwrap().remove("operatingContext"); late["action"] = json!("requestTX");
        assert!(owner.request(&late, &replacement).is_err());
        assert_eq!(owner.snapshot().unwrap()["cw"]["armed"], false, "Observing replacement authority revokes the old lease even when the triggering request is stale");
        let refreshed = call(&mut owner, &replacement, "capabilities", json!({})).unwrap();
        assert_eq!(refreshed["cw"]["armed"], false); assert_eq!(refreshed["txLaneID"], Value::Null);
        assert_eq!(refreshed["nativeContext"]["workerGeneration"], 5);
        assert!(call(&mut owner, &a, "requestTX", json!({})).is_err());
        call(&mut owner, &replacement, "bind", json!({})).unwrap();
        call(&mut owner, &replacement, "requestTX", json!({})).unwrap();
        assert_eq!(owner.snapshot().unwrap()["txNativeContext"]["workerGeneration"], 5);
    }
    #[test]
    fn uncertain_release_across_operating_context_change_retains_owner_and_blocks_new_arm() {
        let mut owner = OfflineAdapter::new(); let a = canonical("laneA", "radio1", "receiver1", "A");
        call(&mut owner, &a, "bind", json!({})).unwrap(); call(&mut owner, &a, "requestTX", json!({})).unwrap();
        call(&mut owner, &a, "send", json!({"text":"FIRST","operationID":uuid::Uuid::new_v4().to_string()})).unwrap();
        owner.backend.uncertain_stop.store(true, Ordering::SeqCst);
        let mut replacement = a.clone(); replacement["operatingContext"] = json!("operating-context-2");
        assert!(call(&mut owner, &replacement, "capabilities", json!({})).is_err());
        let retained = owner.snapshot().unwrap();
        assert_eq!(retained["releaseRequired"], true); assert_eq!(retained["txLaneID"], "laneA");
        assert_eq!(retained["cw"]["armed"], false);
        assert!(call(&mut owner, &replacement, "requestTX", json!({})).is_err());
        assert!(call(&mut owner, &a, "requestTX", json!({})).is_err());
        stop(&mut owner, &a, "confirmed");
        call(&mut owner, &replacement, "bind", json!({})).unwrap();
        call(&mut owner, &replacement, "requestTX", json!({})).unwrap();
    }
}
