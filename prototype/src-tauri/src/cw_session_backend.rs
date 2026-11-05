//! Production adapter. Only canonical saved settings and the new-QSO draft
//! supply macro text/context; no renderer draft, historical contact, or replay.
use crate::cw_session::{Backend, Session};
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};
static OWNER: OnceLock<Arc<Session>> = OnceLock::new();
pub fn existing() -> Option<Arc<Session>> { OWNER.get().cloned() }
pub fn owner(app: &tauri::AppHandle) -> Arc<Session> {
    OWNER.get_or_init(|| {
        let session = Arc::new(Session::new(Arc::new(Native { app: app.clone() })));
        let weak = Arc::downgrade(&session);
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let Some(session) = weak.upgrade() else { break; };
            let _ = session.tick();
        });
        session
    }).clone()
}
struct Native { app: tauri::AppHandle }
pub(crate) fn carrier_output_admission(output:&str, check:impl FnOnce()->Result<(),String>)->Result<(),String> {
    match output {"radio"|"winkeyer"=>check(),_=>Err("Unknown CW output".into())}
}
fn require_idle_carrier(value:&Value, require_rx:bool)->Result<(),String> {
    if value["carrier_tune"]["pending"]!=false || value["carrier_tune"]["release_required"]!=false || value["ptt"]["release_required"]!=false
        || require_rx && value["radio"]["transmitting"]!=false {
        return Err("Resolve owned carrier Tune with Cancel and observe RX before arming or sending CW.".into());
    }
    Ok(())
}
fn request(method: &str, params: Value) -> Value { json!({"id":format!("native-cw-{}",uuid::Uuid::new_v4()),"method":method,"params":params}) }
fn result(request: &Value, response: Value) -> Result<Value, String> {
    if response["id"] != request["id"] || !response["ok"].is_boolean() { return Err("CW acknowledgement identity was lost; use Stop, do not retry.".into()); }
    if response["ok"] != true { return Err(response["error"]["message"].as_str().unwrap_or("CW acknowledgement unavailable; use Stop, do not retry.").into()); }
    if !response["result"].is_object() { return Err("Invalid CW response; use Stop.".into()); } Ok(response["result"].clone())
}
fn call(worker: u64, method: &str, params: Value) -> Result<Value, String> {
    let request = request(method, params);
    let response = crate::worker::request_existing_generation(request.clone(), worker)?;
    let result = result(&request, response)?;
    if crate::worker::generation() != worker { return Err("Worker changed; CW was not replayed.".into()); } Ok(result)
}
fn local(method: &str, params: Value) -> Result<Value, String> {
    let request = request(method, params);
    let response = if method.starts_with("winkeyer_") { crate::winkeyer::request(request.clone()) } else { crate::hamlib::request(request.clone()) }?;
    result(&request, response)
}
fn generation(value: &Value) -> Result<u64, String> { value.as_u64().filter(|value| *value > 0 && *value <= 9_007_199_254_740_991).ok_or("Connection identity unavailable; reconnect explicitly.".into()) }
fn fresh(age: f64, limit: f64) -> bool { age.is_finite() && age >= -5_000.0 && age <= limit }
fn now() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as f64 }
fn output_selection(profile: &Value, read: impl FnOnce() -> Result<Value, String>) -> Result<(String, Value), String> {
    // An independent keyer does not acquire, default, or observe a radio choice.
    if profile["output"] == "winkeyer" { return Ok(("winkeyer".into(), Value::Null)); }
    if profile["output"] != "radio" { return Err("CW output unavailable".into()); }
    let selection = read()?;
    let provider = selection["provider"].as_str()
        .filter(|provider| matches!(*provider, "direct_agent" | "direct_flex_lan" | "direct_tci" | "hamlib"))
        .ok_or("Choose a CW-capable radio before using CW.")?;
    let mut identity=json!({"generation":selection["generation"],"id":selection["selection_id"]});
    if selection["radio_id"].is_string(){identity["radio_id"]=selection["radio_id"].clone();}
    Ok((provider.into(), identity))
}
fn radio_request(target: &Value, action: &str, text: Option<&str>) -> Result<Value, String> {
    let identity = generation(&target["generation"])?;
    let provider = target["provider"].as_str().ok_or("CW target unavailable")?;
    let mut params = if provider == "hamlib" { json!({"device":"radio","action":if action == "stop" { "cw_stop" } else { "cw" },"expected_generation":identity}) }
        else { json!({"provider":provider,"control":if action == "stop" { "clear_cw" } else { "send_cw" },"expected_generation":identity}) };
    if action == "send" { params["text"] = json!(text.ok_or("CW text unavailable")?); }
    if target["radio_id"].is_string(){params["radio_id"]=target["radio_id"].clone();}
    if action == "stop" && target["cwx_generation"].is_u64() { params["cwx_generation"] = target["cwx_generation"].clone(); }
    if action == "stop" && target["compositionJob"].is_string() { params["cwx_job"] = target["compositionJob"].clone(); }
    Ok(request(if provider == "hamlib" { "hamlib_control" } else { "station_radio_control" }, params))
}
fn contesting_test_target(canonical: &Value) -> Result<Value, String> {
    if !canonical["contestSessionID"].is_string() {
        return Err("Contesting Test CW simulation requires an active contest session.".into());
    }
    let worker = generation(&canonical["worker"])?;
    Ok(json!({"output":"test-simulation","provider":"test-simulation","generation":worker,
        "limit":128,"last_intent":0,"worker":worker,"selection":null}))
}
fn simulate_output(target: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String> {
    if target["output"] != "test-simulation" || target["provider"] != "test-simulation" {
        return Err("Contesting Test output target is invalid.".into());
    }
    generation(&target["generation"])?;
    match action {
        "arm" | "stop" if text.is_none() && intent == 0 => {}
        "send" if text.is_some_and(|value| !value.is_empty()) && intent > 0 => {}
        _ => return Err("Contesting Test output request is invalid.".into()),
    }
    Ok(json!({"accepted":true,"simulated":true,"externalIO":false,"action":action,"intent":intent}))
}
impl Backend for Native {
    fn contest_operation(&self, canonical: &Value, params: &Value) -> Result<Value, String> {
        let worker = canonical["worker"].as_u64().ok_or("CW worker unavailable")?;
        let method = match params["operation"].as_str() {
            Some("esm") => "contest_esm", Some("function_key") => "contest_function_key",
            Some("early_start") => "contest_early_cw_start", Some("early_append") => "contest_early_cw_append", Some("early_finish") => "contest_early_cw_finish",
            Some("qtc") => "contest_strategy_apply",
            _ => return Err("Unknown contest CW operation".into()),
        };
        let result = call(worker, method, json!({
            "sessionID":canonical["contestSessionID"], "operationID":params["operationID"],
            "workspaceGeneration":canonical["workspaceGeneration"],
            "expectedRevision":canonical["draftRevision"], "draftID":canonical["draftID"],
            "fields":params["fields"], "frequencyHz":params["frequencyHz"],
            "field":params["field"], "key":params["key"], "streamID":params["streamID"],
            "manualStart":params["manualStart"], "inputOrigin":params["inputOrigin"],
            "earlyStartEnabled":params["earlyStartEnabled"], "threshold":params["threshold"].as_u64().unwrap_or(3),
            "cwProviderContext":params["cwProviderContext"],
            "cwOwnerContext":params["cwOwnerContext"], "cwContinuationAdmission":params["cwContinuationAdmission"],
            "correctionPolicy":params["correctionPolicy"],
            "action":params["qtcAction"].as_str().unwrap_or("qtc_output"), "batchID":params["batchID"],
            "index":params["index"], "qtcField":params["qtcField"]
        }))?;
        Ok(result)
    }
    fn claim_contest_output(&self, canonical: &Value, result: &Value) -> Result<(), String> {
        let worker = canonical["worker"].as_u64().ok_or("CW worker unavailable")?;
        let claimed = call(worker, "contest_output_claim", json!({"sessionID":canonical["contestSessionID"],
            "operationID":result["operationID"], "revision":result["revision"]}))?;
        if claimed["claimed"] != true || claimed["operationID"] != result["operationID"] || claimed["actions"] != result["actions"] {
            return Err("Contest output claim could not be verified; do not replay.".into());
        }
        Ok(())
    }
    fn keyer_snapshot(&self) -> Result<Option<Value>, String> {
        if crate::runtime_profile::CONTESTING_TEST { Ok(None) } else { local("winkeyer_snapshot", json!({})).map(Some) }
    }
    fn canonical(&self) -> Result<Value, String> {
        let worker = crate::worker::generation(); if worker == 0 { return Err("Open a workspace before using CW.".into()); }
        let settings = call(worker, "settings_load", json!({}))?;
        let saved = &settings["settings"];
        // The Swift settings decoder validates every saved macro, including
        // duplicate shortcuts, labels, placeholders and WinKeyer preferences.
        let profile = saved["cwProfile"].clone();
        if !profile.is_object() || profile["version"] != 1 { return Err("Save valid CW preferences before arming.".into()); }
        let (provider, selection) = if crate::runtime_profile::CONTESTING_TEST {
            ("test-simulation".into(), Value::Null)
        } else {
            output_selection(&profile, || {let mut selected=crate::station_selection::owner(&self.app)?.snapshot()?;selected["radio_id"]=json!(crate::radio_slots::active(&self.app)?);Ok(selected)})?
        };
        if crate::runtime_profile::CONTESTING_TEST && crate::contest_window_context::active().is_err() {
            return Err("Contesting Test CW simulation is available only inside an active contest.".into());
        }
        if crate::contest_window_context::active().is_ok() {
            let contest = call(worker, "contest_cw_context", json!({}))?;
            let fields = &contest["fields"];
            if !settings["generation"].is_string() || !settings["revision"].is_u64()
                || !contest["revision"].is_u64() || !contest["draftID"].is_string()
                || !contest["sessionID"].is_string() || !contest["stationCall"].is_string()
                || !contest["sentExchange"].is_string() || !contest["sentSerial"].is_string()
                || !contest["cwFormatting"].is_object()
                || !fields["callsign"].is_string() || !fields["sent"].is_string()
                || !fields["other_1"].is_string() {
                return Err("CW canonical contest revisions are unavailable.".into());
            }
            return Ok(json!({"worker":worker,"generation":settings["generation"],"settingsRevision":settings["revision"],
                "draftRevision":contest["revision"],"draftID":contest["draftID"],"contestSessionID":contest["sessionID"],"workspaceGeneration":contest["workspaceGeneration"],
                "selectedLaneID":contest["selectedLaneID"],"bindingVersion":contest["bindingVersion"],
                "provider":provider,"selection":selection,"profile":profile,"cwFormatting":contest["cwFormatting"],"earlyCW":contest["earlyCW"],
                "context":{"MYCALL":contest["stationCall"],"CALL":fields["callsign"],"RST":fields["sent"],
                    "NAME":"","GRID":saved["gridSquare"].as_str().unwrap_or(""),"SERIAL":contest["sentSerial"],
                    "SENTNR":contest["sentSerial"],"EXCHANGE":contest["sentExchange"]}}));
        }
        let draft = call(worker, "logbook_operator_draft", json!({}))?["draft"].clone();
        if settings["generation"] != draft["generation"] || !settings["generation"].is_string() || !settings["revision"].is_u64() || !draft["revision"].is_u64() || !draft["qso"]["id"].is_string() {
            return Err("CW canonical settings/new-QSO revisions are unavailable.".into());
        }
        let qso = &draft["qso"];
        let mycall = saved["stationCall"].as_str().filter(|value| !value.is_empty()).or_else(|| saved["operatorCall"].as_str()).unwrap_or("");
        let serial = qso["extraFields"]["STX"].as_str().map(str::to_owned).unwrap_or_else(|| if qso["extraFields"]["STX"].is_number() { qso["extraFields"]["STX"].to_string() } else { String::new() });
        Ok(json!({"worker":worker,"generation":settings["generation"],"settingsRevision":settings["revision"],"draftRevision":draft["revision"],"draftID":qso["id"],
            "provider":provider,"selection":selection,"profile":profile,
            "context":{"MYCALL":mycall,"CALL":qso["call"].as_str().unwrap_or(""),"RST":qso["rstSent"].as_str().unwrap_or(""),"NAME":qso["name"].as_str().unwrap_or(""),"GRID":saved["gridSquare"].as_str().unwrap_or(""),"SERIAL":serial,"EXCHANGE":""}}))
    }
    fn inspect(&self, canonical: &Value, capabilities: bool) -> Result<Value, String> {
        if crate::runtime_profile::CONTESTING_TEST { return contesting_test_target(canonical); }
        let provider = canonical["provider"].as_str().ok_or("CW radio selection unavailable")?;
        let output = canonical["profile"]["output"].as_str().ok_or("CW output unavailable")?;
        // The outer shared acquisition guard makes this durable veto and the
        // following backend ownership read atomic with carrier admission.
        // Native TX obligations are process-wide, including an independent
        // keyer. These journal reads need no CAT connection or radio selection.
        carrier_output_admission(output,||{crate::carrier_tune::require_cw_ready(&self.app)?;crate::ptt_session::require_idle(&self.app)})?;
        let worker = canonical["worker"].as_u64().ok_or("CW worker unavailable")?;
        let mut speed_segments=output=="winkeyer";
        let mut flex_cwx = Value::Null;
        let (identity, limit, intent) = if output == "winkeyer" {
            let value = local("winkeyer_snapshot", json!({}))?;
            if value["phase"] != "ready" || !value["status"].is_object() || !value["status_age_ms"].as_f64().is_some_and(|age| age >= 0.0 && age <= 2_000.0) { return Err("Connect WinKeyer and wait for fresh status first.".into()); }
            speed_segments=value["speed_source"]!="pot";
            (generation(&value["generation"])?, 128, value["last_intent"].as_u64().unwrap_or(0))
        } else if provider == "hamlib" {
            let value = local("hamlib_snapshot", json!({"device":"radio"}))?;
            if value["tx_enabled"] != true || !value["observed_at_ms"].as_f64().is_some_and(|time| fresh(now() - time, 5_000.0)) || !matches!(value["fields"]["mode"]["Mode"].as_str(), Some("CW" | "CWR")) { return Err("Connect a local CW radio with transmit controls enabled and fresh readback.".into()); }
            if capabilities { let caps = local("hamlib_capabilities", json!({"device":"radio"}))?;
                if caps["capabilities"]["Can send Morse"] != "Y" || caps["capabilities"]["Can stop Morse"] != "Y" { return Err("Hamlib must support both Send Morse and Stop Morse.".into()); }
            }
            (generation(&value["generation"])?, 80, 0)
        } else {
            let value = call(worker, "station_snapshot", json!({"provider":provider}))?;
            require_idle_carrier(&value, capabilities)?;
            let commands = value["capabilities"]["supported_commands"].as_array().or_else(|| value["station"]["supported_commands"].as_array());
            let timestamp = value["radio"]["observed_at"].as_f64().or_else(|| value["radio"]["received_at"].as_f64());
            if value["source"] != provider || value["radio"]["connected"] != true || value["radio"]["observed"] != true || value["allow_transmit"] != true || !commands.is_some_and(|commands| commands.contains(&json!("send_cw")) && commands.contains(&json!("clear_cw"))) { return Err("Connect a CW-capable radio with transmit controls enabled first.".into()); }
            if !matches!(value["radio"]["mode"].as_str(), Some("CW" | "CWR")) || !timestamp.is_some_and(|time| fresh(now() - time * 1_000.0, 5_000.0)) { return Err("Set the radio to CW and wait for fresh readback.".into()); }
            let connection=generation(&value["generation"])?;
            if provider == "direct_flex_lan" { flex_cwx = value["cw_composition"].clone(); }
            if provider=="direct_tci"{crate::station_selection::owner(&self.app)?.require_tci_transmit_enabled(worker,connection)?;}
            (connection, 128, 0)
        };
        let mut target=json!({"output":output,"provider":if output == "winkeyer" { "winkeyer" } else { provider },"generation":identity,"limit":limit,"last_intent":intent,"worker":worker,"selection":canonical["selection"],
            "speedSegments":speed_segments, "streaming":output == "winkeyer", "composition":output == "winkeyer", "prosigns":output == "winkeyer", "progressEvidence":if output == "winkeyer" {"host-queue-and-device-status"} else {"command-acceptance-only"}});
        if canonical["selection"]["radio_id"].is_string(){target["radio_id"]=canonical["selection"]["radio_id"].clone();}
        if provider == "direct_flex_lan" && output == "radio" {
            let available = flex_cwx["available"] == true && generation(&flex_cwx["generation"]).is_ok();
            target["composition"] = json!(available);
            // Contest early-call streaming is deliberately unchanged. This
            // milestone enables only the shared literal composition workbench.
            target["compositionReason"] = flex_cwx["reason"].clone();
            target["cwx_generation"] = flex_cwx["generation"].clone();
            target["progressEvidence"] = json!("radio-reported-indexed-characters; RF-not-verified");
        }
        Ok(target)
    }
    fn sequence(&self, target: &Value, sequence: &crate::winkeyer::Sequence, intent: u64) -> Result<Value, String> {
        if target["output"] == "winkeyer" {
            return local("winkeyer_sequence", json!({"generation":generation(&target["generation"])?,"intent":intent,"sequence":sequence}));
        }
        if sequence.variable_speed() || sequence.has_prosigns() { return Err("This adapter cannot execute typed speed/prosign segments; choose a supported message.".into()); }
        self.output(target, "send", Some(&sequence.text()), intent)
    }
    fn stream(&self, target: &Value, stream: &Value, intent: u64) -> Result<Value, String> {
        if target["output"] != "winkeyer" { return Err("This adapter does not support qualified owned CW append.".into()); }
        local("winkeyer_stream", json!({"generation":generation(&target["generation"])?,"intent":intent,"streamID":stream["streamID"],
            "revision":stream["revision"],"text":stream["call"],"finish":stream["complete"]}))
    }
    fn compose(&self,target:&Value,sequence:&crate::winkeyer::Sequence,job:&str,append:u64,finish:bool,intent:u64)->Result<Value,String>{
        if target["output"]=="winkeyer" {
            return local("winkeyer_compose",json!({"generation":generation(&target["generation"])?,"intent":intent,"job":job,"append":append,"sequence":sequence,"finish":finish}));
        }
        if target["provider"] != "direct_flex_lan" || target["composition"] != true || sequence.variable_speed() || sequence.has_prosigns() {
            return Err("This output does not support owned literal CW composition append".into());
        }
        let mut params=json!({"provider":"direct_flex_lan","control":"compose_cw","expected_generation":generation(&target["generation"])?,
            "cwx_generation":generation(&target["cwx_generation"])?,"job":job,"append":append,"text":sequence.text(),"finish":finish});
        if target["radio_id"].is_string(){params["radio_id"]=target["radio_id"].clone();}
        let request=request("station_radio_control",params);
        let worker=generation(&target["worker"])?;
        let response=crate::station_selection::owner(&self.app)?.cw_control(request.clone(),target["selection"]["generation"].as_u64().ok_or("CW selection unavailable")?,
            target["selection"]["id"].as_str().ok_or("CW selection unavailable")?,|request|crate::worker::request_existing_generation(request,worker))?;
        result(&request,response)
    }
    fn composition_snapshot(&self,target:&Value)->Result<Option<Value>,String>{
        if target["provider"] != "direct_flex_lan" || target["output"] != "radio" { return Ok(None); }
        let mut params=json!({"provider":"direct_flex_lan"});
        if target["radio_id"].is_string(){params["radio_id"]=target["radio_id"].clone();}
        let value=call(generation(&target["worker"])?,"station_snapshot",params)?;
        if value["generation"] != target["generation"] || value["cw_composition"]["generation"] != target["cwx_generation"] {
            return Ok(Some(json!({"available":false,"reason":"CWX connection changed; Stop and re-arm explicitly. Pending text was not replayed."})));
        }
        Ok(Some(value["cw_composition"].clone()))
    }
    fn continue_sequence(&self,target:&Value,sequence:&crate::winkeyer::Sequence,stream:&str,intent:u64)->Result<Value,String>{
        if target["output"]!="winkeyer"{return Err("This output cannot continue an owned callsign stream.".into());}
        local("winkeyer_sequence",json!({"generation":generation(&target["generation"])?,"intent":intent,"sequence":sequence,"continuationStreamID":stream}))
    }
    fn contest_outcome(&self, canonical: &Value, result: &Value, target: &Value, outcome: &str) -> Result<(), String> {
        let worker = canonical["worker"].as_u64().ok_or("CW worker unavailable")?;
        let accepted_call = result["actions"].as_array().and_then(|actions| actions.iter().find_map(|action| {
            let call = action["fields"]["callsign"].as_str()?;
            if !action["template"].as_str()?.contains("{CALL}") { return None; }
            let text = if action["cwSequence"].is_object() { crate::winkeyer::Sequence::parse(&action["cwSequence"]).ok()?.text() }
                else { crate::cw_session::render_contest_action(action,&canonical["cwFormatting"],&canonical["context"]["GRID"],128).ok()? };
            text.split_ascii_whitespace().any(|part| part == call).then_some(call)
        }));
        call(worker, "contest_cw_outcome", json!({"sessionID":canonical["contestSessionID"],"operationID":uuid::Uuid::new_v4().to_string(),
            "outputOperationID":result["operationID"],"outcome":outcome,"providerID":target["provider"],"generation":target["generation"],
            "acceptedCall":accepted_call,
            "acceptanceLevel":if target["output"] == "winkeyer" {"native_queue"} else {"provider_accepted"}})).map(|_| ())
    }
    fn output(&self, target: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String> {
        if crate::runtime_profile::CONTESTING_TEST { return simulate_output(target, action, text, intent); }
        let generation = generation(&target["generation"])?;
        if target["output"] == "winkeyer" {
            let result = match action {
                "arm" => local("winkeyer_arm", json!({"generation":generation,"confirm_transmit":true})),
                "send" => local("winkeyer_send", json!({"generation":generation,"intent":intent,"text":text})),
                _ => local("winkeyer_stop", json!({"generation":generation})),
            }?;
            if action == "stop" {
                for _ in 0..30 { let value = local("winkeyer_snapshot", json!({}))?;
                    if value["generation"] != generation || value["phase"] != "ready" { break; }
                    if value["owns_output"] == false && value["pending_characters"] == 0 && value["armed_remaining_ms"] == 0 { return Ok(result); }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                return Err("WinKeyer idle is unconfirmed. Check the keyer; ownership is retained.".into());
            } return Ok(result);
        }
        let provider = target["provider"].as_str().ok_or("CW target unavailable")?;
        let request = radio_request(target, action, text)?;
        let worker = target["worker"].as_u64().ok_or("CW worker unavailable")?;
        let dispatch = |request: Value| {
            if action!="stop"&&provider=="direct_tci"{crate::station_selection::owner_for(&self.app,target["radio_id"].as_str().ok_or("TCI slot unavailable")?)?.require_tci_transmit_enabled(worker,generation)?;}
            if provider == "hamlib" { crate::hamlib::request(request) } else { crate::worker::request_existing_generation(request, worker) }
        };
        // Urgent Stop is pinned to the original provider/connection even after
        // handover; Send must additionally enter selected-radio arbitration.
        let response = if action == "stop" { dispatch(request.clone())? } else {
            crate::station_selection::owner(&self.app)?.cw_control(request.clone(), target["selection"]["generation"].as_u64().ok_or("CW selection unavailable")?,
                target["selection"]["id"].as_str().ok_or("CW selection unavailable")?, dispatch)?
        };
        result(&request, response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_radio_cw_vetoes_carrier_pending_owned_release_and_active_tx() {
        let idle=json!({"carrier_tune":{"pending":false,"release_required":false},"ptt":{"release_required":false},"radio":{"transmitting":false}});
        assert!(require_idle_carrier(&idle,true).is_ok());
        for key in ["pending","release_required"] {let mut value=idle.clone();value["carrier_tune"][key]=json!(true);assert!(require_idle_carrier(&value,true).is_err());assert!(require_idle_carrier(&value,false).is_err());}
        for source in ["gui","embedded_cat"]{let mut value=idle.clone();value["ptt"]=json!({"source":source,"release_required":true});assert!(require_idle_carrier(&value,true).is_err());assert!(require_idle_carrier(&value,false).is_err());}
        let mut tx=idle;tx["radio"]["transmitting"]=json!(true);assert!(require_idle_carrier(&tx,true).is_err());
        assert!(require_idle_carrier(&json!({"radio":{"transmitting":false}}),true).is_err(),"Old/missing backend obligation metadata must fail closed");
    }
    #[test]
    fn independent_winkeyer_needs_no_radio_and_radio_selection_stays_exact() {
        for output in ["winkeyer","radio"] {
            assert!(carrier_output_admission(output,||Err("Carrier active".into())).is_err());
            assert!(carrier_output_admission(output,||Err("PTT owned".into())).is_err());
            assert!(carrier_output_admission(output,||Ok(())).is_ok());
        }
        let (provider, selection) = output_selection(&json!({"output":"winkeyer"}), || panic!("WinKeyer must not read or require radio selection")).unwrap();
        assert_eq!(provider, "winkeyer"); assert!(selection.is_null());
        assert!(output_selection(&json!({"output":"radio"}), || Ok(json!({"provider":null}))).is_err());
        assert!(output_selection(&json!({"output":"radio"}), || Err("Selection unavailable".into())).is_err());
        let (provider, selection) = output_selection(&json!({"output":"radio"}), || Ok(json!({"provider":"direct_agent","generation":17,"selection_id":"exact-radio-choice"}))).unwrap();
        assert_eq!(provider, "direct_agent"); assert_eq!(selection, json!({"generation":17,"id":"exact-radio-choice"}));
        assert_eq!(output_selection(&json!({"output":"radio"}), || Ok(json!({"provider":"direct_tci","generation":18,"selection_id":"tci-choice"}))).unwrap().0,"direct_tci");
    }
    #[test]
    fn radio_release_preserves_strict_flex_schema_and_exact_target_identity() {
        for provider in ["direct_agent", "direct_flex_lan", "hamlib"] {
            let target = json!({"provider":provider,"generation":7});
            let stop = radio_request(&target, "stop", None).unwrap();
            assert_eq!(stop["params"]["expected_generation"], 7);
            assert!(stop["params"].get("text").is_none());
            let send = radio_request(&target, "send", Some("CQ")).unwrap();
            assert_eq!(send["params"]["text"], "CQ"); assert_eq!(send["params"]["expected_generation"], 7);
        }
        let stop=radio_request(&json!({"provider":"direct_flex_lan","generation":7,"cwx_generation":11,"compositionJob":"captured-job","radio_id":"slot-a"}),"stop",None).unwrap();
        assert_eq!(stop["params"]["cwx_generation"],11);
        assert_eq!(stop["params"]["cwx_job"],"captured-job");
        assert_eq!(stop["params"]["radio_id"],"slot-a");
    }
    #[test]
    fn malformed_acknowledgements_are_uncertain_and_cannot_be_accepted() {
        let request = json!({"id":"one"});
        assert!(result(&request, json!({"id":"other","ok":true,"result":{}})).is_err());
        assert!(result(&request, json!({"id":"one","ok":true,"result":null})).is_err());
        assert!(result(&request, json!({"id":"one","ok":false,"error":{"message":"Reply lost"}})).is_err());
    }
    #[test]
    fn contesting_test_simulator_accepts_only_bounded_non_external_output_shape() {
        let target = contesting_test_target(&json!({"contestSessionID":"session","worker":7})).unwrap();
        assert_eq!(target["output"], "test-simulation");
        assert_eq!(simulate_output(&target, "arm", None, 0).unwrap()["externalIO"], false);
        assert_eq!(simulate_output(&target, "send", Some("CQ TEST"), 1).unwrap()["simulated"], true);
        assert_eq!(simulate_output(&target, "stop", None, 0).unwrap()["action"], "stop");
        assert!(simulate_output(&target, "send", None, 1).is_err());
        assert!(simulate_output(&target, "send", Some("CQ"), 0).is_err());
        assert!(simulate_output(&target, "clear_cw", None, 0).is_err());
        assert!(contesting_test_target(&json!({"worker":7})).is_err());
    }
}
