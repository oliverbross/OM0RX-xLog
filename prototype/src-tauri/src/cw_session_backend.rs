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
    match output {"radio"=>check(),"winkeyer"=>Ok(()),_=>Err("Unknown CW output".into())}
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
        .filter(|provider| matches!(*provider, "direct_agent" | "direct_flex_lan" | "hamlib"))
        .ok_or("Choose a CW-capable radio before using CW.")?;
    Ok((provider.into(), json!({"generation":selection["generation"],"id":selection["selection_id"]})))
}
fn radio_request(target: &Value, action: &str, text: Option<&str>) -> Result<Value, String> {
    let identity = generation(&target["generation"])?;
    let provider = target["provider"].as_str().ok_or("CW target unavailable")?;
    let mut params = if provider == "hamlib" { json!({"device":"radio","action":if action == "stop" { "cw_stop" } else { "cw" },"expected_generation":identity}) }
        else { json!({"provider":provider,"control":if action == "stop" { "clear_cw" } else { "send_cw" },"expected_generation":identity}) };
    if action == "send" { params["text"] = json!(text.ok_or("CW text unavailable")?); }
    Ok(request(if provider == "hamlib" { "hamlib_control" } else { "station_radio_control" }, params))
}
impl Backend for Native {
    fn contest_operation(&self, canonical: &Value, params: &Value) -> Result<Value, String> {
        let worker = canonical["worker"].as_u64().ok_or("CW worker unavailable")?;
        let method = match params["operation"].as_str() {
            Some("esm") => "contest_esm", Some("function_key") => "contest_function_key",
            _ => return Err("Unknown contest CW operation".into()),
        };
        let result = call(worker, method, json!({
            "sessionID":canonical["contestSessionID"], "operationID":params["operationID"],
            "expectedRevision":canonical["draftRevision"], "draftID":canonical["draftID"],
            "fields":params["fields"], "frequencyHz":params["frequencyHz"],
            "field":params["field"], "key":params["key"]
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
    fn keyer_snapshot(&self) -> Result<Option<Value>, String> { local("winkeyer_snapshot", json!({})).map(Some) }
    fn canonical(&self) -> Result<Value, String> {
        let worker = crate::worker::generation(); if worker == 0 { return Err("Open a workspace before using CW.".into()); }
        let settings = call(worker, "settings_load", json!({}))?;
        let saved = &settings["settings"];
        // The Swift settings decoder validates every saved macro, including
        // duplicate shortcuts, labels, placeholders and WinKeyer preferences.
        let profile = saved["cwProfile"].clone();
        if !profile.is_object() || profile["version"] != 1 { return Err("Save valid CW preferences before arming.".into()); }
        let (provider, selection) = output_selection(&profile, || crate::station_selection::owner(&self.app)?.snapshot())?;
        if crate::contest_window_context::active().is_ok() {
            let contest = call(worker, "contest_cw_context", json!({}))?;
            let fields = &contest["fields"];
            if !settings["generation"].is_string() || !settings["revision"].is_u64()
                || !contest["revision"].is_u64() || !contest["draftID"].is_string()
                || !contest["sessionID"].is_string() || !contest["stationCall"].is_string()
                || !contest["sentExchange"].is_string() || !contest["sentSerial"].is_string()
                || !fields["callsign"].is_string() || !fields["sent"].is_string()
                || !fields["other_1"].is_string() {
                return Err("CW canonical contest revisions are unavailable.".into());
            }
            return Ok(json!({"worker":worker,"generation":settings["generation"],"settingsRevision":settings["revision"],
                "draftRevision":contest["revision"],"draftID":contest["draftID"],"contestSessionID":contest["sessionID"],
                "provider":provider,"selection":selection,"profile":profile,
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
        let provider = canonical["provider"].as_str().ok_or("CW radio selection unavailable")?;
        let output = canonical["profile"]["output"].as_str().ok_or("CW output unavailable")?;
        // The outer shared acquisition guard makes this durable veto and the
        // following backend ownership read atomic with carrier admission.
        carrier_output_admission(output,||{crate::carrier_tune::require_cw_ready(&self.app)?;crate::ptt_session::require_idle(&self.app)})?;
        let worker = canonical["worker"].as_u64().ok_or("CW worker unavailable")?;
        let (identity, limit, intent) = if output == "winkeyer" {
            let value = local("winkeyer_snapshot", json!({}))?;
            if value["phase"] != "ready" || !value["status"].is_object() || !value["status_age_ms"].as_f64().is_some_and(|age| age >= 0.0 && age <= 2_000.0) { return Err("Connect WinKeyer and wait for fresh status first.".into()); }
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
            (generation(&value["generation"])?, 128, 0)
        };
        Ok(json!({"output":output,"provider":if output == "winkeyer" { "winkeyer" } else { provider },"generation":identity,"limit":limit,"last_intent":intent,"worker":worker,"selection":canonical["selection"]}))
    }
    fn output(&self, target: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String> {
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
        let dispatch = |request: Value| if provider == "hamlib" { crate::hamlib::request(request) } else { crate::worker::request_existing_generation(request, worker) };
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
        assert!(carrier_output_admission("winkeyer",||panic!("Independent WinKeyer requested radio carrier authority")).is_ok());
        assert!(carrier_output_admission("radio",||Err("Carrier active".into())).is_err());
        let (provider, selection) = output_selection(&json!({"output":"winkeyer"}), || panic!("WinKeyer must not read or require radio selection")).unwrap();
        assert_eq!(provider, "winkeyer"); assert!(selection.is_null());
        assert!(output_selection(&json!({"output":"radio"}), || Ok(json!({"provider":null}))).is_err());
        assert!(output_selection(&json!({"output":"radio"}), || Err("Selection unavailable".into())).is_err());
        let (provider, selection) = output_selection(&json!({"output":"radio"}), || Ok(json!({"provider":"direct_agent","generation":17,"selection_id":"exact-radio-choice"}))).unwrap();
        assert_eq!(provider, "direct_agent"); assert_eq!(selection, json!({"generation":17,"id":"exact-radio-choice"}));
        assert!(output_selection(&json!({"output":"radio"}), || Ok(json!({"provider":"direct_tci","generation":18,"selection_id":"tci-choice"}))).is_err());
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
    }
    #[test]
    fn malformed_acknowledgements_are_uncertain_and_cannot_be_accepted() {
        let request = json!({"id":"one"});
        assert!(result(&request, json!({"id":"other","ok":true,"result":{}})).is_err());
        assert!(result(&request, json!({"id":"one","ok":true,"result":null})).is_err());
        assert!(result(&request, json!({"id":"one","ok":false,"error":{"message":"Reply lost"}})).is_err());
    }
}
