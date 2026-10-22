//! Narrow setup-only mailbox. Children never acquire worker/session ownership.
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

pub fn kind(label: &str) -> Option<&'static str> {
    match label {
        "contest-setup-operator" => Some("operator"),
        "contest-setup-station" => Some("station"),
        "contest-setup-configuration" => Some("configuration"),
        "contest-setup-digital" => Some("digital"),
        "contest-setup-macros" => Some("macros"),
        "contest-setup-keys" => Some("keys"),
        "contest-setup-rover" => Some("rover"),
        "contest-setup-about" => Some("about"),
        _ => None,
    }
}
pub fn spec(kind: &str) -> Option<(&'static str, &'static str, f64, f64)> {
    match kind {
        "operator" => Some(("contest-setup-operator", "Operator", 420.0, 190.0)),
        "station" => Some(("contest-setup-station", "Station Settings", 760.0, 600.0)),
        "configuration" => Some(("contest-setup-configuration", "Configuration Settings", 820.0, 320.0)),
        "digital" => Some(("contest-setup-digital", "Digital Logging Setup", 760.0, 680.0)),
        "macros" => Some(("contest-setup-macros", "Edit Macros", 820.0, 560.0)),
        "keys" => Some(("contest-setup-keys", "Edit Keys", 820.0, 560.0)),
        "rover" => Some(("contest-setup-rover", "Rover", 382.0, 110.0)),
        "about" => Some(("contest-setup-about", "About Not1MM", 420.0, 500.0)),
        _ => None,
    }
}
pub fn can_open(label: &str, kind: &str) -> bool {
    label == "contest-setup" || label == "contest--active-qso" && kind == "operator"
}
#[derive(Default)]
pub struct State { snapshot: Option<Value>, pending: Option<Value>, receipts: Vec<(String, Value, Value)> }

fn text(value: &Value) -> bool { value.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 512) }
fn document(value: &Value) -> bool {
    value.is_object() && ["station", "settings", "preferences", "network"].iter().all(|key| value[key].is_object())
        && value["macros"].is_array() && value.to_string().len() <= 65_536
}
fn auxiliary(value: &Value) -> bool {
    value.is_object() && value["roverLocation"].as_str().is_some_and(|s| s.len() <= 10)
        && value["activeSessionID"].as_str().is_none_or(|s| s.len() <= 160)
        && value["effectiveMacros"].as_array().is_none_or(|_| value["effectiveMacros"].to_string().len() <= 32_768)
        && value["diagnostics"].is_object() && value["diagnostics"].to_string().len() <= 4_096
}
fn owned_state<'a>(kind: &str, document: &'a Value, auxiliary: &'a Value) -> Value {
    match kind {
        "operator" => document["operator"].clone(),
        "station" => document["station"].clone(),
        "macros" => document["macros"].clone(),
        "keys" => document["preferences"]["keyBindings"].clone(),
        "rover" => auxiliary["roverLocation"].clone(),
        "digital" => auxiliary["digital"].clone(),
        _ => json!({"preferences":document["preferences"],"network":document["network"]}),
    }
}
fn digital(value: &Value) -> bool {
    let configuration = &value["configuration"];
    let address = configuration["address"].as_str().unwrap_or("");
    let port = configuration["port"].as_u64().unwrap_or(0);
    let destination = configuration["destination"].as_str().unwrap_or("ordinary_logbook");
    let fldigi = &value["fldigi_configuration"];
    let fldigi_valid = fldigi.is_null() || fldigi.as_object().is_some_and(|object| object.len() == 2
        && fldigi["receive_enabled"].is_boolean() && fldigi["transmit_enabled"].is_boolean());
    configuration.is_object() && configuration["enabled"].is_boolean() && !address.is_empty() && address.len() <= 45
        && matches!(destination, "ordinary_logbook" | "active_contest")
        && (1..=65_535).contains(&port) && fldigi_valid
        && matches!(value["action"].as_str(), Some("save" | "start" | "stop"))
}
fn owner(label: &str) -> Result<(), String> {
    if label == "contest-setup" { Ok(()) } else { Err("Only Contest Setup owns setup changes.".into()) }
}
impl State {
    fn settle(&mut self, request: Value, ok: bool, message: &str) -> Value {
        let result = json!({"requestID":request["requestID"],"status":if ok {"saved"} else {"rejected"},"message":message});
        self.receipts.push((request["kind"].as_str().unwrap_or("").into(), request, result.clone()));
        if self.receipts.len() > 32 { self.receipts.remove(0); }
        result
    }
    pub fn request(&mut self, label: &str, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "publish" => {
                owner(label)?;
                if !text(&params["epoch"]) || !text(&params["context"]) || !document(&params["document"]) || !auxiliary(&params["auxiliary"]) {
                    return Err("Invalid setup owner snapshot.".into());
                }
                let unchanged = self.snapshot.as_ref().is_some_and(|s| s["epoch"] == params["epoch"] && s["context"] == params["context"] && s["document"] == params["document"] && s["auxiliary"] == params["auxiliary"]);
                if !unchanged {
                    let revision = self.snapshot.as_ref().and_then(|s| s["revision"].as_u64()).unwrap_or(0) + 1;
                    if self.pending.as_ref().is_some_and(|pending| {
                        let kind = pending["kind"].as_str().unwrap_or("");
                        pending["context"] != params["context"] ||
                            owned_state(kind, &pending["baseDocument"], &pending["baseAuxiliary"])
                                != owned_state(kind, &params["document"], &params["auxiliary"])
                    }) {
                        let pending = self.pending.take().unwrap();
                        self.settle(pending, false, "Setup changed. Reopen the dialog before saving.");
                    }
                    self.snapshot = Some(json!({"epoch":params["epoch"],"context":params["context"],"revision":revision,"document":params["document"],"auxiliary":params["auxiliary"]}));
                }
                Ok(self.snapshot.clone().unwrap())
            }
            "revoke" => {
                owner(label)?;
                if self.snapshot.as_ref().is_some_and(|s| s["epoch"] == params["epoch"]) {
                    self.snapshot = None;
                    if let Some(pending) = self.pending.take() { self.settle(pending, false, "Contest Setup closed. Reopen the dialog."); }
                }
                Ok(Value::Null)
            }
            "next" => {
                owner(label)?;
                if !self.snapshot.as_ref().is_some_and(|s| s["epoch"] == params["epoch"]) { return Err("Setup owner expired.".into()); }
                Ok(self.pending.clone().unwrap_or(Value::Null))
            }
            "complete" => {
                owner(label)?;
                if !self.snapshot.as_ref().is_some_and(|s| s["epoch"] == params["epoch"]) { return Err("Setup owner expired.".into()); }
                if !self.pending.as_ref().is_some_and(|p| p["requestID"] == params["requestID"]) { return Err("Setup request expired.".into()); }
                let pending = self.pending.take().unwrap();
                // Consume the draft revision even if its values did not change.
                // An uncertain client cannot submit a second write from the same draft.
                if params["ok"] == true {
                    if let Some(snapshot) = self.snapshot.as_mut() { snapshot["revision"] = json!(snapshot["revision"].as_u64().unwrap_or(0) + 1); }
                }
                Ok(self.settle(pending, params["ok"] == true, params["message"].as_str().unwrap_or("Setup save failed.")))
            }
            "snapshot" => {
                kind(label).ok_or("This window is not a setup dialog.")?;
                self.snapshot.clone().ok_or_else(|| "Contest Setup is unavailable. Reopen it and the dialog.".into())
            }
            "submit" => {
                let dialog = kind(label).ok_or("This window cannot save setup.")?;
                if dialog == "about" { return Err("The About window is read-only.".into()); }
                let valid_payload = if dialog == "rover" {
                    params["roverLocation"].as_str().is_some_and(|s| !s.trim().is_empty() && s.len() <= 10)
                } else if dialog == "digital" { digital(&params["digital"]) } else { document(&params["document"]) };
                if !text(&params["requestID"]) || !valid_payload || !document(&params["baseDocument"])
                    || !auxiliary(&params["baseAuxiliary"]) { return Err("Invalid setup save request.".into()); }
                let mut request = params; request["kind"] = json!(dialog);
                if let Some((_, original, receipt)) = self.receipts.iter().find(|(_,p,_)| p["requestID"] == request["requestID"]) {
                    return if *original == request { Ok(receipt.clone()) } else { Err("Setup request ID was reused.".into()) };
                }
                if let Some(pending) = &self.pending {
                    return if *pending == request { Ok(json!({"requestID":request["requestID"],"status":"pending"})) } else { Err("Another setup save is pending. Try again after it finishes.".into()) };
                }
                if self.receipts.iter().any(|(saved_kind, original, _)| saved_kind == dialog
                    && original["epoch"] == request["epoch"] && original["revision"] == request["revision"]) {
                    return Err("This setup draft was already consumed. Reopen the dialog before saving again.".into());
                }
                let snapshot = self.snapshot.as_ref().ok_or("Contest Setup is unavailable.")?;
                if snapshot["epoch"] != request["epoch"] || snapshot["context"] != request["context"] ||
                    owned_state(dialog, &request["baseDocument"], &request["baseAuxiliary"])
                        != owned_state(dialog, &snapshot["document"], &snapshot["auxiliary"]) {
                    return Err("Setup changed. Reopen the dialog before saving.".into());
                }
                let result = json!({"requestID":request["requestID"],"status":"pending"}); self.pending = Some(request); Ok(result)
            }
            "receipt" => {
                let dialog = kind(label).ok_or("This window cannot read setup receipts.")?;
                if self.pending.as_ref().is_some_and(|p| p["kind"] == dialog && p["requestID"] == params["requestID"]) {
                    return Ok(json!({"requestID":params["requestID"],"status":"pending"}));
                }
                Ok(self.receipts.iter().find(|(k,p,_)| k == dialog && p["requestID"] == params["requestID"]).map(|(_,_,r)| r.clone()).unwrap_or(Value::Null))
            }
            _ => Err("Unknown setup dialog action.".into()),
        }
    }
}
pub fn request(label: &str, method: &str, params: Value) -> Result<Value, String> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(Default::default).lock().map_err(|_| "Setup dialogs unavailable".to_string())?.request(label, method, params)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn doc() -> Value { json!({"station":{},"settings":{},"preferences":{},"network":{},"macros":[]}) }
    fn auxiliary() -> Value { json!({"roverLocation":"","diagnostics":{"engine":"Not1MM Python"}}) }
    fn publish(s: &mut State) -> Value { s.request("contest-setup", "publish", json!({"epoch":"owner-1","context":"workspace-1","document":doc(),"auxiliary":auxiliary()})).unwrap() }
    fn submission(snapshot: &Value) -> Value { let mut p = snapshot.clone(); p["requestID"] = json!("save-1");
        p["baseDocument"] = snapshot["document"].clone(); p["baseAuxiliary"] = snapshot["auxiliary"].clone(); p }
    #[test]
    fn admits_only_owner_and_dialog_operations() {
        let mut s = State::default(); let snapshot = publish(&mut s);
        for label in ["main", "contest--active-qso", "settings"] {
            for method in ["snapshot","submit","publish","next","complete","revoke","receipt"] { assert!(s.request(label,method,submission(&snapshot)).is_err()); }
        }
        assert!(s.request("contest-setup-station","publish",snapshot.clone()).is_err());
        assert!(s.request("contest-setup-configuration","next",json!({"epoch":"owner-1"})).is_err());
        assert!(s.request("contest-setup-station","contest_commit",Value::Null).is_err());
    }
    #[test]
    fn only_owner_or_main_logging_opon_can_open_dialogs() {
        for kind in ["operator", "station", "configuration", "digital", "macros", "keys", "rover", "about"] {
            assert!(can_open("contest-setup", kind));
        }
        assert!(can_open("contest--active-qso", "operator"));
        assert!(!can_open("contest--active-qso", "station"));
        assert!(!can_open("main", "operator"));
    }
    #[test]
    fn deduplicates_requests_and_preserves_single_writer() {
        let mut s = State::default(); let p = submission(&publish(&mut s));
        assert_eq!(s.request("contest-setup-station","submit",p.clone()).unwrap()["status"],"pending");
        assert_eq!(s.request("contest-setup-station","submit",p.clone()).unwrap()["status"],"pending");
        assert_eq!(s.request("contest-setup-station","receipt",json!({"requestID":"save-1"})).unwrap()["status"],"pending");
        assert!(s.request("contest-setup-configuration","submit",p.clone()).is_err());
        let reply = s.request("contest-setup","complete",json!({"epoch":"owner-1","requestID":"save-1","ok":true})).unwrap();
        assert_eq!(s.request("contest-setup-station","submit",p.clone()).unwrap(),reply);
        assert!(s.request("contest-setup-configuration","submit",p.clone()).is_err());
        let mut second = p; second["requestID"] = json!("save-2");
        assert!(s.request("contest-setup-station","submit",second).is_err());
        assert!(s.pending.is_none());
    }
    #[test]
    fn digital_requests_are_bounded_and_owned() {
        let mut s = State::default(); let snapshot = publish(&mut s);
        let mut request = submission(&snapshot); request["requestID"] = json!("digital-1");
        request["digital"] = json!({"configuration":{"enabled":false,"address":"224.0.0.1","port":2237,
            "destination":"active_contest"},"fldigi_configuration":{"receive_enabled":true,"transmit_enabled":false},"action":"start"});
        assert_eq!(s.request("contest-setup-digital","submit",request.clone()).unwrap()["status"],"pending");
        assert!(s.request("contest-setup-digital","submit",request).is_ok());
        let mut invalid = submission(&snapshot); invalid["requestID"] = json!("digital-2");
        invalid["digital"] = json!({"configuration":{"enabled":false,"address":"","port":0},"action":"connect"});
        assert!(s.request("contest-setup-digital","submit",invalid).is_err());
        let next = publish(&mut s); let mut invalid_destination = submission(&next); invalid_destination["requestID"] = json!("digital-3");
        invalid_destination["digital"] = json!({"configuration":{"enabled":false,"address":"127.0.0.1","port":2237,
            "destination":"another_contest"},"action":"start"});
        assert!(s.request("contest-setup-digital","submit",invalid_destination).is_err());
    }
    #[test]
    fn fences_changed_document_context_and_owner() {
        let mut s = State::default(); let snapshot = publish(&mut s); let p = submission(&snapshot);
        s.request("contest-setup-station","submit",p.clone()).unwrap();
        let mut changed = snapshot; changed["context"] = json!("workspace-2");
        s.request("contest-setup","publish",changed).unwrap();
        assert!(s.pending.is_none());
        assert_eq!(s.request("contest-setup-station","receipt",p.clone()).unwrap()["status"],"rejected");
        let mut fresh_id = p; fresh_id["requestID"] = json!("save-2");
        assert!(s.request("contest-setup-station","submit",fresh_id).is_err());
        assert!(s.request("contest-setup","next",json!({"epoch":"old-owner"})).is_err());
    }
    #[test]
    fn station_save_ignores_unrelated_owner_projection_churn_but_rejects_station_conflicts() {
        let mut s = State::default(); let snapshot = publish(&mut s); let mut request = submission(&snapshot);
        request["document"]["station"]["City"] = json!("Darwin");
        let mut unrelated = snapshot.clone(); unrelated["document"]["settings"]["Soapbox"] = json!("background");
        unrelated["auxiliary"]["diagnostics"]["version"] = json!("next");
        s.request("contest-setup", "publish", unrelated).unwrap();
        assert_eq!(s.request("contest-setup-station", "submit", request.clone()).unwrap()["status"], "pending");
        let mut more_churn = s.snapshot.clone().unwrap(); more_churn["auxiliary"]["diagnostics"]["version"] = json!("newest");
        s.request("contest-setup", "publish", more_churn).unwrap();
        assert!(s.pending.is_some());
        let mut station_change = s.snapshot.clone().unwrap(); station_change["document"]["station"]["City"] = json!("Bratislava");
        s.request("contest-setup", "publish", station_change).unwrap();
        assert!(s.pending.is_none());
        assert_eq!(s.request("contest-setup-station", "receipt", request).unwrap()["status"], "rejected");
    }
    #[test]
    fn exposes_compact_distinct_windows() {
        assert_eq!(spec("operator"),Some(("contest-setup-operator","Operator",420.0,190.0)));
        assert_eq!(spec("station"),Some(("contest-setup-station","Station Settings",760.0,600.0)));
        assert_eq!(spec("configuration"),Some(("contest-setup-configuration","Configuration Settings",820.0,320.0)));
        assert_eq!(spec("digital"),Some(("contest-setup-digital","Digital Logging Setup",760.0,680.0)));
        assert_eq!(spec("macros"),Some(("contest-setup-macros","Edit Macros",820.0,560.0)));
        assert_eq!(spec("keys"),Some(("contest-setup-keys","Edit Keys",820.0,560.0)));
        assert_eq!(spec("rover"),Some(("contest-setup-rover","Rover",382.0,110.0)));
        assert_eq!(spec("about"),Some(("contest-setup-about","About Not1MM",420.0,500.0)));
        assert_eq!(crate::workspace_windows::native_minimum("contest-setup-operator"),(360.0,170.0));
        assert_eq!(crate::workspace_windows::native_minimum("contest-setup-station"),(620.0,480.0));
        assert_eq!(crate::workspace_windows::native_minimum("contest-setup-configuration"),(680.0,300.0));
        assert_eq!(crate::workspace_windows::native_minimum("contest-setup-macros"),(620.0,420.0));
        assert_eq!(crate::workspace_windows::native_minimum("contest-setup-keys"),(620.0,420.0));
        assert!(spec("logbook").is_none()); assert!(kind("contest-setup").is_none());
    }
    #[test]
    fn dialogs_have_only_their_finite_core_capability() {
        let capability: Value = serde_json::from_str(include_str!("../capabilities/contest-setup-dialogs.json")).unwrap();
        assert_eq!(capability["windows"],json!(["contest-setup-operator","contest-setup-station","contest-setup-configuration","contest-setup-digital","contest-setup-macros","contest-setup-keys","contest-setup-rover","contest-setup-about"]));
        assert_eq!(capability["permissions"],json!(["core:default","core:window:allow-set-size"]));
    }
}
