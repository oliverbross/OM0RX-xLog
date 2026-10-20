//! Narrow setup-only mailbox. Children never acquire worker/session ownership.
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

pub fn kind(label: &str) -> Option<&'static str> {
    match label { "contest-setup-station" => Some("station"), "contest-setup-configuration" => Some("configuration"), _ => None }
}
pub fn spec(kind: &str) -> Option<(&'static str, &'static str, f64, f64)> {
    match kind {
        "station" => Some(("contest-setup-station", "Station Settings", 760.0, 660.0)),
        "configuration" => Some(("contest-setup-configuration", "Configuration Settings", 820.0, 520.0)),
        _ => None,
    }
}
#[derive(Default)]
pub struct State { snapshot: Option<Value>, pending: Option<Value>, receipts: Vec<(String, Value, Value)> }

fn text(value: &Value) -> bool { value.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 512) }
fn document(value: &Value) -> bool {
    value.is_object() && ["station", "settings", "preferences", "network"].iter().all(|key| value[key].is_object())
        && value["macros"].is_array() && value.to_string().len() <= 65_536
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
                if !text(&params["epoch"]) || !text(&params["context"]) || !document(&params["document"]) {
                    return Err("Invalid setup owner snapshot.".into());
                }
                let unchanged = self.snapshot.as_ref().is_some_and(|s| s["epoch"] == params["epoch"] && s["context"] == params["context"] && s["document"] == params["document"]);
                if !unchanged {
                    let revision = self.snapshot.as_ref().and_then(|s| s["revision"].as_u64()).unwrap_or(0) + 1;
                    if let Some(pending) = self.pending.take() { self.settle(pending, false, "Setup changed. Reopen the dialog before saving."); }
                    self.snapshot = Some(json!({"epoch":params["epoch"],"context":params["context"],"revision":revision,"document":params["document"]}));
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
                if !text(&params["requestID"]) || !document(&params["document"]) { return Err("Invalid setup save request.".into()); }
                let mut request = params; request["kind"] = json!(dialog);
                if let Some((_, original, receipt)) = self.receipts.iter().find(|(_,p,_)| p["requestID"] == request["requestID"]) {
                    return if *original == request { Ok(receipt.clone()) } else { Err("Setup request ID was reused.".into()) };
                }
                if let Some(pending) = &self.pending {
                    return if *pending == request { Ok(json!({"requestID":request["requestID"],"status":"pending"})) } else { Err("Another setup save is pending. Try again after it finishes.".into()) };
                }
                let snapshot = self.snapshot.as_ref().ok_or("Contest Setup is unavailable.")?;
                if snapshot["epoch"] != request["epoch"] || snapshot["revision"] != request["revision"] || snapshot["context"] != request["context"] {
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
    fn publish(s: &mut State) -> Value { s.request("contest-setup", "publish", json!({"epoch":"owner-1","context":"workspace-1","document":doc()})).unwrap() }
    fn submission(snapshot: &Value) -> Value { let mut p = snapshot.clone(); p["requestID"] = json!("save-1"); p }
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
    fn only_exposes_two_compact_distinct_windows() {
        assert_eq!(spec("station"),Some(("contest-setup-station","Station Settings",760.0,660.0)));
        assert_eq!(spec("configuration"),Some(("contest-setup-configuration","Configuration Settings",820.0,520.0)));
        for label in ["contest-setup-station", "contest-setup-configuration"] { assert_eq!(crate::workspace_windows::native_minimum(label),(620.0,480.0)); }
        assert!(spec("logbook").is_none()); assert!(kind("contest-setup").is_none());
    }
    #[test]
    fn dialogs_have_only_their_finite_core_capability() {
        let capability: Value = serde_json::from_str(include_str!("../capabilities/contest-setup-dialogs.json")).unwrap();
        assert_eq!(capability["windows"],json!(["contest-setup-station","contest-setup-configuration"]));
        assert_eq!(capability["permissions"],json!(["core:default"]));
    }
}
