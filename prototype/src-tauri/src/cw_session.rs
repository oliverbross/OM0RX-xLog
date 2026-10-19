//! Process-owned CW authority. Clients carry observations and leases, never text.
use serde_json::{json, Value};
use std::{collections::{BTreeMap, BTreeSet}, sync::{Arc, Mutex}, time::Instant};

pub fn validate_surface(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if !matches!(label, "main" | "cw" | "contest-setup") || isolated || exiting {
        return Err("Shared CW controls require the live Desk, CW, or Contest Setup window.".into());
    }
    if !matches!(action, "snapshot" | "arm" | "send" | "contest" | "stop" | "acknowledge" | "unregister") {
        return Err("Unknown CW session action".into());
    }
    Ok(())
}

pub trait Backend: Send + Sync {
    fn contest_operation(&self, _canonical: &Value, _params: &Value) -> Result<Value, String> { Err("Contest CW is unavailable".into()) }
    fn claim_contest_output(&self, _canonical: &Value, _result: &Value) -> Result<(), String> { Err("Contest CW is unavailable".into()) }
    fn canonical(&self) -> Result<Value, String>;
    fn inspect(&self, canonical: &Value, capabilities: bool) -> Result<Value, String>;
    fn output(&self, target: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String>;
    fn keyer_snapshot(&self) -> Result<Option<Value>, String> { Ok(None) }
}
struct Client { label: String, registration: String, sequence: u64, seen: u64 }
struct State {
    revision: u64, epoch: u64, clients: BTreeMap<String, Client>, closing: BTreeSet<String>, canonical: Value,
    holder: Option<String>, lease: Option<String>, target: Value, owner: Value, winkeyer: Value,
    armed_until: u64, pending: bool, stopping: bool, releases: usize, intent: u64,
    message: String, error: String, contest_result: Value, contest_pending: bool,
}
pub struct Session { state: Mutex<State>, backend: Arc<dyn Backend>, clock: Arc<dyn Fn() -> u64 + Send + Sync> }
impl Session {
    pub fn new(backend: Arc<dyn Backend>) -> Self {
        let start = Instant::now(); Self::with_clock(backend, Arc::new(move || start.elapsed().as_millis() as u64))
    }
    fn with_clock(backend: Arc<dyn Backend>, clock: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self { backend, clock, state: Mutex::new(State { revision: 0, epoch: 0, clients: BTreeMap::new(), closing: BTreeSet::new(), canonical: Value::Null,
            holder: None, lease: None, target: Value::Null, owner: Value::Null, winkeyer: Value::Null, armed_until: 0, pending: false, stopping: false, releases: 0,
            intent: 0, message: "CW disarmed".into(), error: String::new(), contest_result: Value::Null, contest_pending: false }) }
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, State>, String> { self.state.lock().map_err(|_| "CW session unavailable".into()) }
    fn snapshot_locked(&self, state: &State) -> Value {
        json!({"revision":state.revision,"armed":state.armed_until > (self.clock)(),"pending":state.pending || state.stopping,
            "owner":state.owner,"message":state.message,"error":state.error,"winkeyer":state.winkeyer,
            "client":state.holder,"lease":state.lease,"canonical":state.canonical,"contestResult":state.contest_result})
    }
    pub fn snapshot(&self) -> Result<Value, String> { let state = self.lock()?; Ok(self.snapshot_locked(&state)) }
    fn change(state: &mut State) { state.revision += 1; }
    fn check(state: &State, client: &str, params: &Value, lease: bool) -> Result<(), String> {
        if params["expectedRevision"].as_u64() != Some(state.revision) { return Err("CW observation changed; refresh and explicitly try again.".into()); }
        if lease && (state.holder.as_deref() != Some(client) || params["lease"].as_str() != state.lease.as_deref() || state.lease.is_none()) {
            return Err("This client does not own the CW arm lease.".into());
        }
        Ok(())
    }
    fn refresh(&self) -> Result<(), String> {
        // A native contest operation temporarily owns the canonical transition.
        // Its own post-operation read validates the new context before output.
        if self.lock()?.contest_pending { return Ok(()); }
        let canonical = self.backend.canonical()?;
        let changed = { let mut state = self.lock()?;
            if state.contest_pending { return Ok(()); }
            if canonical == state.canonical { false } else { state.canonical = canonical; Self::change(&mut state); true }
        };
        if changed { self.stop()?; }
        let revision = self.lock()?.revision;
        if let Some(value) = self.backend.keyer_snapshot()? {
            let mut state = self.lock()?;
            if state.revision == revision && !state.pending && !state.stopping && state.owner["output"] == "winkeyer"
                && value["generation"] == state.owner["generation"] && value["phase"] == "ready" && value["owns_output"] == false && value["pending_characters"] == 0 {
                state.owner = Value::Null; Self::change(&mut state);
            }
            state.winkeyer = value;
        }
        Ok(())
    }
    pub fn request(&self, label: &str, client: &str, sequence: u64, focused: bool, params: &Value) -> Result<Value, String> {
        if uuid::Uuid::parse_str(client).is_err() || sequence == 0 || sequence > 9_007_199_254_740_991 { return Err("Invalid CW client identity".into()); }
        let action = params["action"].as_str().unwrap_or("");
        validate_surface(label, false, false, action)?;
        { let mut state = self.lock()?;
            if state.closing.contains(label) && !matches!(action, "stop" | "unregister") { return Err("This CW window is closing; no operation was admitted.".into()); }
            if !state.clients.contains_key(client) {
                // Stop must remain reachable even while a close transition has
                // retired the renderer's registration or its first read failed.
                if !matches!(action, "snapshot" | "stop") { return Err("Register this CW client before using controls.".into()); }
                if state.clients.len() >= 32 { return Err("Too many CW clients".into()); }
                state.clients.insert(client.into(), Client { label: label.into(), registration: uuid::Uuid::new_v4().to_string(), sequence: 0, seen: (self.clock)() });
            }
            let entry = state.clients.get_mut(client).unwrap();
            if entry.label != label || sequence <= entry.sequence { return Err("CW request was already consumed; no operation was replayed.".into()); }
            entry.sequence = sequence; entry.seen = (self.clock)();
        }
        // Stop and unregister stay available without focus or fresh canonical I/O.
        match action {
            "stop" => { self.stop()?; },
            "unregister" => { self.release_client(client)?; },
            "snapshot" => { if !focused { self.release_client(client)?; } self.refresh()?; self.tick()?; },
            "arm" | "send" | "contest" | "acknowledge" => {
                if !focused { self.release_client(client)?; return Err("Focus the CW controls before using them.".into()); }
                self.refresh()?;
                match action { "arm" => self.arm(client, params)?, "send" => self.send(client, params)?,
                    "contest" => { if let Err(error) = self.contest(client, params) { self.lock()?.error = error; } }, _ => self.acknowledge(params)? }
            },
            _ => return Err("Unknown CW session action".into()),
        }
        self.snapshot()
    }
    fn arm(&self, client: &str, params: &Value) -> Result<(), String> {
        let (canonical, epoch) = { let mut state = self.lock()?; Self::check(&state, client, params, false)?;
            if state.pending || state.stopping || !state.owner.is_null() || state.holder.is_some() { return Err("Stop the current CW lease before arming.".into()); }
            state.epoch += 1; state.pending = true; state.error.clear(); state.holder = Some(client.into());
            state.lease = Some(uuid::Uuid::new_v4().to_string()); Self::change(&mut state); (state.canonical.clone(), state.epoch)
        };
        let result = (|| {
            let target = self.backend.inspect(&canonical, true)?;
            { let mut state = self.lock()?; self.current(&state, epoch, client)?;
                state.intent = state.intent.max(target["last_intent"].as_u64().unwrap_or(0)); state.target = target.clone();
                if target["output"] == "winkeyer" { state.owner = target.clone(); Self::change(&mut state); }
            }
            if target["output"] == "winkeyer" { self.backend.output(&target, "arm", None, 0)?; }
            // Canonical revisions are checked again after slow hardware reads.
            if self.backend.canonical()? != canonical { return Err("CW settings or new-QSO context changed while arming.".into()); }
            let mut state = self.lock()?; self.current(&state, epoch, client)?;
            state.armed_until = (self.clock)() + 60_000; state.owner = Value::Null;
            state.message = "CW armed for 60 seconds".into(); Ok(())
        })();
        self.complete(epoch, result, false)
    }
    fn current(&self, state: &State, epoch: u64, client: &str) -> Result<(), String> {
        if state.epoch != epoch || state.holder.as_deref() != Some(client) || state.stopping ||
            !state.clients.get(client).is_some_and(|entry| (self.clock)().saturating_sub(entry.seen) < 3_000) {
            return Err("CW lease or focus changed; nothing further was queued.".into());
        }
        Ok(())
    }
    fn send(&self, client: &str, params: &Value) -> Result<(), String> {
        let (canonical, target, epoch, text) = { let mut state = self.lock()?; Self::check(&state, client, params, true)?;
            if state.pending || state.stopping || state.armed_until <= (self.clock)() || state.target.is_null() { return Err("Arm CW before sending a macro.".into()); }
            let text = expand(&state.canonical, params["macroID"].as_u64().ok_or("Choose a saved CW macro")?, state.target["limit"].as_u64().unwrap_or(80) as usize)?;
            state.pending = true; state.error.clear(); Self::change(&mut state);
            (state.canonical.clone(), state.target.clone(), state.epoch, text)
        };
        let result = (|| {
            let observed = self.backend.inspect(&canonical, false)?;
            if self.backend.canonical()? != canonical { return Err("CW settings or new-QSO context changed; arm again.".into()); }
            let intent = { let mut state = self.lock()?; self.current(&state, epoch, client)?;
                if state.armed_until <= (self.clock)() { return Err("CW arming expired during readback; arm again.".into()); }
                if !same_target(&target, &observed) { return Err("Output connection changed. Arm the new connection explicitly.".into()); }
                if !state.owner.is_null() && !same_target(&state.owner, &target) { return Err("Stop the previous CW output first.".into()); }
                state.intent = state.intent.max(observed["last_intent"].as_u64().unwrap_or(0)).checked_add(1).ok_or("CW intent exhausted")?;
                state.owner = target.clone(); Self::change(&mut state); state.intent
            };
            self.backend.output(&target, "send", Some(&text), intent)?; Ok(())
        })();
        self.complete(epoch, result, true)
    }
    fn contest(&self, client: &str, params: &Value) -> Result<(), String> {
        let admission: Result<(Value, Value, u64), String> = (|| {
            let mut state = self.lock()?;
            Self::check(&state, client, params, true)?;
            if state.pending || state.stopping || state.armed_until <= (self.clock)() || state.target.is_null() {
                return Err("Arm CW before using contest ESM.".into());
            }
            let canonical = &state.canonical;
            if !canonical["contestSessionID"].is_string() || params["sessionID"] != canonical["contestSessionID"]
                || params["expectedContestRevision"] != canonical["draftRevision"] || params["draftID"] != canonical["draftID"]
                || params["operationID"].as_str().and_then(|id| uuid::Uuid::parse_str(id).ok()).is_none() {
                return Err("The armed contest context changed; refresh and arm again.".into());
            }
            let value = (state.canonical.clone(), state.target.clone(), state.epoch);
            state.pending = true; state.contest_pending = true; state.contest_result = Value::Null;
            state.error.clear(); Self::change(&mut state); Ok(value)
        })();
        let (canonical, target, epoch) = match admission {
            Ok(value) => value,
            Err(error) => { self.lock()?.error = error.clone(); return Err(error); }
        };
        let outcome = (|| {
            if self.backend.canonical()? != canonical { return Err("Contest context changed before ESM admission.".into()); }
            let result = self.backend.contest_operation(&canonical, params)?;
            { let mut state = self.lock()?; state.contest_result = result.clone(); }
            let after = self.backend.canonical()?;
            if !same_contest_authority(&canonical, &after) || result["sessionID"] != canonical["contestSessionID"]
                || result["projection"]["revision"] != after["draftRevision"] || result["projection"]["draftID"] != after["draftID"]
                || result["operationID"] != params["operationID"] || result["replayed"] != false {
                return Err("Contest operation was replayed or its authoritative context changed; output was not replayed.".into());
            }
            let actions = result["actions"].as_array().ok_or("Contest output actions unavailable")?;
            let mut messages = Vec::new();
            for (index, action) in actions.iter().enumerate() {
                if action["sessionID"] != canonical["contestSessionID"] || action["draftID"] != canonical["draftID"]
                    || action["actionID"] != format!("{}:{index}", params["operationID"].as_str().unwrap_or(""))
                    || action["kind"] != "function_key" {
                    return Err("Contest output identity could not be verified.".into());
                }
                let mut frozen = canonical.clone();
                frozen["context"] = json!({"MYCALL":action["stationCall"],"CALL":action["fields"]["callsign"],
                    "RST":action["fields"]["sent"],"EXCHANGE":action["sentExchange"],
                    "SERIAL":action["sentSerial"],"SENTNR":action["sentSerial"],"NAME":"","GRID":canonical["context"]["GRID"]});
                messages.push(expand_template(&frozen, action["template"].as_str().ok_or("Pinned contest CW template unavailable")?,
                    target["limit"].as_u64().unwrap_or(80) as usize)?);
            }
            let text = messages.join(" ");
            if text.len() > target["limit"].as_u64().unwrap_or(80) as usize { return Err("The contest CW sequence exceeds this output's message limit.".into()); }
            let observed = self.backend.inspect(&after, false)?;
            if !same_target(&target, &observed) || self.backend.canonical()? != after {
                return Err("Contest session, settings or radio changed before output.".into());
            }
            { let state = self.lock()?; self.current(&state, epoch, client)?;
                if state.armed_until <= (self.clock)() { return Err("CW arming expired before contest output.".into()); } }
            if !actions.is_empty() {
                // Durable consumption precedes physical output. An uncertain
                // write can never be replayed by retrying the host operation.
                self.backend.claim_contest_output(&after, &result)?;
                if self.backend.canonical()? != after { return Err("Contest changed during output claim; nothing was replayed.".into()); }
                let intent = { let mut state = self.lock()?; self.current(&state, epoch, client)?;
                    state.intent = state.intent.max(observed["last_intent"].as_u64().unwrap_or(0)).checked_add(1).ok_or("CW intent exhausted")?;
                    state.owner = target.clone(); Self::change(&mut state); state.intent };
                self.backend.output(&target, "send", Some(&text), intent)?;
            }
            let mut state = self.lock()?; self.current(&state, epoch, client)?;
            state.canonical = after; Ok(())
        })();
        self.lock()?.contest_pending = false;
        self.complete(epoch, outcome, true)
    }
    fn complete(&self, epoch: u64, result: Result<(), String>, sending: bool) -> Result<(), String> {
        let cleanup = { let mut state = self.lock()?;
            let cancelled = state.epoch != epoch;
            if let Err(error) = &result { state.error = error.clone(); state.armed_until = 0; }
            if cancelled || result.is_err() && (!sending || state.owner.is_null()) { state.armed_until = 0; state.stopping = true; }
            if !cancelled && result.is_ok() && sending { state.message = "Macro accepted · RF not verified".into(); }
            state.pending = false; Self::change(&mut state);
            if state.stopping { state.releases += 1; Some(if !state.owner.is_null() { state.owner.clone() } else if state.target["output"] == "winkeyer" { state.target.clone() } else { Value::Null }) } else { None }
        };
        if let Some(target) = cleanup { self.finish_release(&target)?; }
        result
    }
    pub fn stop(&self) -> Result<(), String> {
        let target = { let mut state = self.lock()?; Self::begin_stop(&mut state) };
        if let Some(target) = target { self.finish_release(&target)?; }
        Ok(())
    }
    fn begin_stop(state: &mut State) -> Option<Value> {
        state.epoch += 1; state.armed_until = 0; state.lease = None; state.message = "CW disarmed".into();
        Self::change(state);
        if state.stopping { return None; }
        state.stopping = true; state.releases += 1;
        Some(if !state.owner.is_null() { state.owner.clone() } else if state.target["output"] == "winkeyer" { state.target.clone() } else { Value::Null })
    }
    fn finish_release(&self, target: &Value) -> Result<(), String> {
        let result = if target.is_null() { Ok(json!({})) } else { self.backend.output(target, "stop", None, 0) };
        let mut state = self.lock()?;
        // A pending send/arm will release again after settling, even if this
        // immediate Stop succeeded. Never clear its retained output guard early.
        state.releases -= 1;
        if !state.pending && state.releases == 0 {
            state.stopping = false; state.target = Value::Null; state.holder = None; state.lease = None;
            if result.is_ok() { state.owner = Value::Null; state.error.clear(); }
        }
        if let Err(error) = &result { if !target.is_null() { state.owner = target.clone(); } state.error = error.clone(); }
        Self::change(&mut state); result.map(|_| ())
    }
    fn acknowledge(&self, params: &Value) -> Result<(), String> {
        let mut state = self.lock()?; Self::check(&state, "", params, false)?;
        if state.pending || state.stopping || params["confirmed"] != true { return Err("Verify idle output after pending operations settle.".into()); }
        state.epoch += 1; state.armed_until = 0; state.owner = Value::Null; state.target = Value::Null;
        state.holder = None; state.lease = None; state.error.clear(); state.message = "Operator confirmed CW stopped; re-arm explicitly.".into(); Self::change(&mut state); Ok(())
    }
    fn release_client(&self, client: &str) -> Result<(), String> {
        self.release_registration(client, None)
    }
    fn release_registration(&self, client: &str, registration: Option<&str>) -> Result<(), String> {
        let target = {
            let mut state = self.lock()?;
            if registration.is_some_and(|token| !state.clients.get(client).is_some_and(|entry| entry.registration == token)) { return Ok(()); }
            // Retirement and revocation share one admission lock. Unknown output
            // belongs to the guard and outlives the removed registration.
            state.clients.remove(client);
            if state.holder.as_deref() == Some(client) { Self::begin_stop(&mut state) } else { None }
        };
        if let Some(target) = target { self.finish_release(&target)?; }
        Ok(())
    }
    pub fn release_window(&self, label: &str) -> Result<(), String> {
        let clients: Vec<(String, String)> = self.lock()?.clients.iter().filter(|(_, entry)| entry.label == label).map(|(id, entry)| (id.clone(), entry.registration.clone())).collect();
        self.release_clients(&clients)
    }
    pub fn release_clients(&self, clients: &[(String, String)]) -> Result<(), String> {
        let mut first_error = None;
        for (client, registration) in clients {
            if let Err(error) = self.release_registration(client, Some(registration)) { if first_error.is_none() { first_error = Some(error); } }
        }
        match first_error { Some(error) => Err(error), None => Ok(()) }
    }
    /// Reserve the window transition before releasing its lease. Unknown or
    /// in-flight output keeps the guard visible; no other client's text is replayed.
    pub fn prepare_close(&self, label: &str) -> Result<(), String> {
        if !self.lock()?.closing.insert(label.into()) { return Err("This CW window transition is already in progress.".into()); }
        let result = self.release_window(label).and_then(|_| {
            let state = self.lock()?;
            if state.pending || state.stopping || state.holder.is_some() || !state.owner.is_null() {
                Err("Stop shared CW and resolve its output guard before closing or docking.".into())
            } else { Ok(()) }
        });
        if result.is_err() { self.allow_window(label)?; }
        result
    }
    /// Canvas presentation must never send Stop as a side effect. Admission and
    /// the idle check share the CW lock, so no new CW client can arm this window.
    pub fn reserve_idle_close(&self, labels: &[&str]) -> Result<(), String> {
        let mut state = self.lock()?;
        if state.pending || state.stopping || state.holder.is_some() || !state.owner.is_null() || state.armed_until > 0 || state.lease.is_some() {
            return Err("Stop and disarm shared CW, and resolve its output guard before switching to Canvas.".into());
        }
        if labels.iter().any(|label| state.closing.contains(*label)) { return Err("This CW window transition is already in progress.".into()); }
        state.closing.extend(labels.iter().map(|label| (*label).to_owned()));
        Ok(())
    }
    pub fn allow_window(&self, label: &str) -> Result<(), String> { self.lock()?.closing.remove(label); Ok(()) }
    pub fn revoke_window_clients(&self, label: &str) -> Result<Vec<(String, String)>, String> {
        let mut state = self.lock()?;
        if state.holder.as_ref().and_then(|id| state.clients.get(id)).is_some_and(|entry| entry.label == label) {
            state.epoch += 1; state.armed_until = 0; state.lease = None; Self::change(&mut state);
        }
        Ok(state.clients.iter().filter(|(_, entry)| entry.label == label).map(|(id, entry)| (id.clone(), entry.registration.clone())).collect())
    }
    pub fn revoke(&self) -> Result<(), String> {
        let mut state = self.lock()?; state.epoch += 1; state.armed_until = 0; state.lease = None; Self::change(&mut state); Ok(())
    }
    pub fn tick(&self) -> Result<(), String> {
        let expired = { let state = self.lock()?;
            state.holder.as_ref().is_some_and(|holder| state.armed_until > 0 && state.armed_until <= (self.clock)() ||
                !state.clients.get(holder).is_some_and(|entry| (self.clock)().saturating_sub(entry.seen) < 3_000))
        };
        if expired { self.stop()?; } Ok(())
    }
}
fn same_contest_authority(a: &Value, b: &Value) -> bool {
    a["contestSessionID"].is_string() && ["worker", "generation", "settingsRevision", "contestSessionID", "provider", "selection", "profile"]
        .iter().all(|key| a[*key] == b[*key])
}
fn same_target(a: &Value, b: &Value) -> bool {
    ["output", "provider", "generation", "worker", "selection"].iter().all(|key| a[key] == b[key])
}
fn allowed(byte: u8) -> bool { byte.is_ascii_alphanumeric() || b" /?=+.,-".contains(&byte) }
fn expand(canonical: &Value, id: u64, limit: usize) -> Result<String, String> {
    let macro_value = canonical["profile"]["macros"].as_array().and_then(|values| values.iter().find(|value| value["id"] == id && value["enabled"] == true)).ok_or("This macro is disabled or is not saved.")?;
    let source = macro_value["text"].as_str().ok_or("Invalid CW template")?;
    expand_template(canonical, source, limit)
}
fn expand_template(canonical: &Value, source: &str, limit: usize) -> Result<String, String> {
    if source.trim().is_empty() || source.len() > 512 { return Err("Use a CW template of 1–512 characters.".into()); }
    let mut rest = source; let mut expanded = String::new();
    while let Some(start) = rest.find('{') {
        expanded.push_str(&rest[..start]); let after = &rest[start + 1..];
        let end = after.find('}').ok_or("Invalid CW placeholder")?; let token = &after[..end];
        if !["MYCALL", "CALL", "RST", "NAME", "GRID", "SERIAL", "SENTNR", "EXCHANGE"].contains(&token) { return Err("Unknown CW placeholder".into()); }
        let value = canonical["context"][token].as_str().unwrap_or("").trim();
        if value.is_empty() { return Err(format!("Fill {token} before sending this macro.")); }
        if !value.bytes().all(allowed) { return Err(format!("{token} contains characters this CW output cannot send.")); }
        expanded.push_str(value); rest = &after[end + 1..];
    }
    expanded.push_str(rest);
    if !expanded.bytes().all(allowed) { return Err("Raw keyer commands and control characters are not allowed.".into()); }
    let text = expanded.split(' ').filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ").to_ascii_uppercase();
    if text.len() > limit { return Err(format!("Expanded CW is {} characters; this output allows {limit}. Shorten the macro.", text.len())); }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, mpsc};
    struct Fake {
        canonical: Mutex<Value>, target: Mutex<Value>, writes: Mutex<Vec<(String, Option<String>, u64)>>,
        claims: Mutex<BTreeSet<String>>,
        lost_send: AtomicBool, stop_fails: AtomicBool,
        gate: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
        arm_gate: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
    }
    impl Backend for Fake {
        fn contest_operation(&self, canonical: &Value, params: &Value) -> Result<Value, String> {
            let revision = canonical["draftRevision"].as_u64().unwrap() + 1;
            let mut after = canonical.clone(); after["draftRevision"] = json!(revision); after["draftID"] = json!("next-draft");
            after["context"]["CALL"] = json!("");
            if params["changeSettings"] == true { after["settingsRevision"] = json!(999); }
            *self.canonical.lock().unwrap() = after;
            Ok(json!({"operationID":params["operationID"],"sessionID":canonical["contestSessionID"],"revision":revision,
                "projection":{"revision":revision,"draftID":"next-draft"},"replayed":params["replayed"] == true,
                "actions":[{"kind":"function_key","key":"F2","sessionID":canonical["contestSessionID"],"draftID":canonical["draftID"],
                    "actionID":format!("{}:0",params["operationID"].as_str().unwrap()),"fields":params["fields"],"stationCall":"OM0RX","sentExchange":"15","sentSerial":"",
                    "template":"{CALL} {RST} {EXCHANGE}"}]}))
        }
        fn claim_contest_output(&self, _: &Value, result: &Value) -> Result<(), String> {
            if self.claims.lock().unwrap().insert(result["operationID"].as_str().unwrap().into()) { Ok(()) }
            else { Err("Output consumed".into()) }
        }
        fn canonical(&self) -> Result<Value, String> { Ok(self.canonical.lock().unwrap().clone()) }
        fn inspect(&self, _: &Value, _: bool) -> Result<Value, String> { Ok(self.target.lock().unwrap().clone()) }
        fn output(&self, _: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String> {
            self.writes.lock().unwrap().push((action.into(), text.map(str::to_owned), intent));
            if action == "arm" {
                if let Some((entered, resume)) = self.arm_gate.lock().unwrap().take() { entered.send(()).unwrap(); resume.recv().unwrap(); }
            }
            if action == "send" {
                let gate = self.gate.lock().unwrap().take();
                if let Some((entered, resume)) = gate { entered.send(()).unwrap(); resume.recv().unwrap(); }
                if self.lost_send.load(Ordering::SeqCst) { return Err("Reply lost".into()); }
            }
            if action == "stop" && self.stop_fails.load(Ordering::SeqCst) { return Err("Stop unconfirmed".into()); }
            Ok(json!({"accepted":true}))
        }
    }
    fn fixture() -> (Arc<Session>, Arc<Fake>, Arc<AtomicU64>) {
        let backend = Arc::new(Fake { canonical: Mutex::new(json!({"settingsRevision":1,"draftRevision":2,
            "profile":{"macros":[{"id":1,"enabled":true,"text":"{CALL} DE {MYCALL} {RST} K"}]},
            "context":{"CALL":"K1ABC","MYCALL":"OM0RX","RST":"599"}})),
            target: Mutex::new(json!({"output":"radio","provider":"direct_agent","generation":7,"worker":4,"selection":"choice","limit":128})),
            writes: Mutex::new(vec![]), claims: Mutex::new(BTreeSet::new()), lost_send: AtomicBool::new(false), stop_fails: AtomicBool::new(false), gate: Mutex::new(None), arm_gate: Mutex::new(None) });
        let clock = Arc::new(AtomicU64::new(0)); let ticking = clock.clone();
        (Arc::new(Session::with_clock(backend.clone(), Arc::new(move || ticking.load(Ordering::SeqCst)))), backend, clock)
    }
    struct Client { id: String, sequence: u64 }
    impl Client {
        fn new() -> Self { Self { id: uuid::Uuid::new_v4().to_string(), sequence: 0 } }
        fn call(&mut self, session: &Session, action: &str) -> Result<Value, String> {
            let snapshot = session.snapshot()?; self.sequence += 1;
            session.request("main", &self.id, self.sequence, true, &json!({"action":action,"expectedRevision":snapshot["revision"],"lease":snapshot["lease"],"macroID":1,"confirmed":true}))
        }
    }
    fn ready(client: &mut Client, session: &Session) { client.call(session, "snapshot").unwrap(); client.call(session, "arm").unwrap(); }
    fn contest_ready() -> (Arc<Session>, Arc<Fake>, Client) {
        let (session, backend, _) = fixture();
        { let mut canonical = backend.canonical.lock().unwrap(); canonical["contestSessionID"] = json!("contest-1");
            canonical["draftID"] = json!("draft-1"); canonical["context"]["CALL"] = json!(""); }
        let mut client = Client::new(); ready(&mut client, &session); (session, backend, client)
    }
    fn contest_call(client: &mut Client, session: &Session, extra: Value) -> Value {
        let snapshot = session.snapshot().unwrap(); client.sequence += 1;
        let mut params = json!({"action":"contest","expectedRevision":snapshot["revision"],"lease":snapshot["lease"],
            "sessionID":snapshot["canonical"]["contestSessionID"],"expectedContestRevision":snapshot["canonical"]["draftRevision"],
            "draftID":snapshot["canonical"]["draftID"],"operationID":uuid::Uuid::new_v4().to_string(),"fields":{"callsign":"K1ABC","sent":"599"}});
        for (key, value) in extra.as_object().unwrap() { params[key] = value.clone(); }
        session.request("main", &client.id, client.sequence, true, &params).unwrap()
    }
    #[test]
    fn contest_esm_uses_frozen_host_call_after_log_clears_draft_and_keeps_validated_lease() {
        let (session, backend, mut client) = contest_ready();
        let reply = contest_call(&mut client, &session, json!({}));
        assert_eq!(reply["canonical"]["context"]["CALL"], ""); assert_eq!(reply["armed"], true);
        assert!(backend.writes.lock().unwrap().iter().any(|(action,text,_)| action=="send" && text.as_deref()==Some("K1ABC 599 15")));
        assert_eq!(backend.claims.lock().unwrap().len(), 1);
    }
    #[test]
    fn contest_replay_and_authority_change_never_send() {
        for extra in [json!({"replayed":true}),json!({"changeSettings":true}),json!({"draftID":"wrong-draft"})] {
            let (session, backend, mut client) = contest_ready();
            let reply = contest_call(&mut client, &session, extra);
            assert_ne!(reply["error"], "");
            assert!(!backend.writes.lock().unwrap().iter().any(|(action,_,_)| action=="send"));
        }
    }
    #[test]
    fn contest_output_claim_survives_lost_send_and_rearming_cannot_replay_it() {
        let (session, backend, mut client) = contest_ready();
        let operation = uuid::Uuid::new_v4().to_string(); backend.lost_send.store(true, Ordering::SeqCst);
        let reply = contest_call(&mut client, &session, json!({"operationID":operation}));
        assert_eq!(reply["armed"], false); assert_eq!(backend.claims.lock().unwrap().len(), 1);
        client.call(&session,"stop").unwrap(); ready(&mut client,&session);
        let _ = contest_call(&mut client,&session,json!({"operationID":operation}));
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(action,_,_)|action=="send").count(),1);
    }
    #[test]
    fn contest_polling_does_not_cancel_owned_transition_but_stop_revokes_inflight_output() {
        let (session, backend, mut client) = contest_ready();
        let (entered_tx, entered_rx) = mpsc::channel(); let (resume_tx, resume_rx) = mpsc::channel();
        *backend.gate.lock().unwrap() = Some((entered_tx, resume_rx));
        let sending = session.clone();
        let thread = std::thread::spawn(move || contest_call(&mut client, &sending, json!({})));
        entered_rx.recv().unwrap();
        let mut observer = Client::new();
        let polling = observer.call(&session, "snapshot").unwrap();
        assert_eq!(polling["pending"], true);
        assert!(!backend.writes.lock().unwrap().iter().any(|(action,_,_)| action=="stop"));
        observer.call(&session,"stop").unwrap(); resume_tx.send(()).unwrap();
        let finished = thread.join().unwrap(); assert_eq!(finished["armed"], false);
        assert!(backend.writes.lock().unwrap().iter().filter(|(action,_,_)|action=="stop").count()>=2);
    }
    #[test]
    fn cw_admission_is_closed_to_other_surfaces_isolation_shutdown_and_raw_actions() {
        for label in ["main", "cw", "monitor", "station-control", "settings", "log-qso", "unknown", "CW"] {
            for action in ["snapshot", "arm", "send", "stop", "acknowledge", "unregister"] {
                assert_eq!(validate_surface(label, false, false, action).is_ok(), matches!(label, "main" | "cw" | "contest-setup"));
                assert!(validate_surface(label, true, false, action).is_err());
                assert!(validate_surface(label, false, true, action).is_err());
            }
        }
        for action in ["", "connect", "cw_control", "send_text", "set_speed"] {
            assert!(validate_surface("cw", false, false, action).is_err());
        }
    }
    #[test]
    fn delayed_focus_cleanup_cannot_retire_a_new_registration_of_the_same_renderer_client() {
        let (session, backend, _) = fixture(); let child = uuid::Uuid::new_v4().to_string();
        session.request("cw", &child, 1, true, &json!({"action":"snapshot"})).unwrap();
        let retired = session.revoke_window_clients("cw").unwrap();
        session.request("cw", &child, 2, true, &json!({"action":"unregister"})).unwrap();
        let registered = session.request("cw", &child, 3, true, &json!({"action":"snapshot"})).unwrap();
        session.request("cw", &child, 4, true, &json!({"action":"arm","expectedRevision":registered["revision"]})).unwrap();
        session.release_clients(&retired).unwrap();
        assert_eq!(session.snapshot().unwrap()["armed"], true);
        assert!(backend.writes.lock().unwrap().is_empty());
    }
    #[test]
    fn child_transition_cannot_hide_a_pending_send_or_admit_duplicate_close() {
        let (session, backend, _) = fixture(); let child = uuid::Uuid::new_v4().to_string();
        let observed = session.request("cw", &child, 1, true, &json!({"action":"snapshot"})).unwrap();
        let armed = session.request("cw", &child, 2, true, &json!({"action":"arm","expectedRevision":observed["revision"]})).unwrap();
        let (entered, wait) = mpsc::channel(); let (resume, receiver) = mpsc::channel();
        *backend.gate.lock().unwrap() = Some((entered, receiver));
        let sending = session.clone();
        let thread = std::thread::spawn(move || sending.request("cw", &child, 3, true,
            &json!({"action":"send","expectedRevision":armed["revision"],"lease":armed["lease"],"macroID":1})));
        wait.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        assert!(session.prepare_close("cw").is_err());
        assert_eq!(session.snapshot().unwrap()["pending"], true);
        assert!(!session.snapshot().unwrap()["owner"].is_null());
        resume.send(()).unwrap(); thread.join().unwrap().unwrap();
        session.prepare_close("cw").unwrap();
        assert!(session.prepare_close("cw").unwrap_err().contains("already in progress"));
        let safety_client = uuid::Uuid::new_v4().to_string();
        session.request("cw", &safety_client, 1, false, &json!({"action":"stop"})).unwrap();
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|value| value.0 == "send").count(), 1);
    }
    #[test]
    fn canvas_idle_reservation_rejects_armed_cw_without_stop_and_blocks_new_admission() {
        let (session, backend, _) = fixture(); let mut main = Client::new(); ready(&mut main, &session);
        assert!(session.reserve_idle_close(&["main", "cw"]).is_err());
        assert!(backend.writes.lock().unwrap().is_empty(), "Canvas preflight must not dispatch Stop");
        main.call(&session, "stop").unwrap(); backend.writes.lock().unwrap().clear();
        session.reserve_idle_close(&["main", "cw"]).unwrap();
        assert!(main.call(&session, "arm").is_err());
        assert!(session.reserve_idle_close(&["cw"]).is_err());
        assert!(backend.writes.lock().unwrap().is_empty());
        session.allow_window("main").unwrap(); session.allow_window("cw").unwrap();
        main.call(&session, "snapshot").unwrap(); main.call(&session, "arm").unwrap();
    }
    #[test]
    fn cw_observer_snapshot_and_focus_retirement_never_stop_another_windows_lease() {
        let (session, backend, _) = fixture(); let mut main = Client::new(); ready(&mut main, &session);
        let child = uuid::Uuid::new_v4().to_string();
        session.request("cw", &child, 1, true, &json!({"action":"snapshot"})).unwrap();
        let retiring = session.revoke_window_clients("cw").unwrap();
        session.release_clients(&retiring).unwrap();
        assert_eq!(session.snapshot().unwrap()["armed"], true);
        assert!(backend.writes.lock().unwrap().is_empty());
        assert!(session.prepare_close("cw").is_err(), "Observer close cannot hide a shared active guard");
        main.call(&session, "send").unwrap(); main.call(&session, "stop").unwrap();
        session.prepare_close("cw").unwrap();
        assert!(session.request("cw", &child, 2, true, &json!({"action":"snapshot"})).is_err());
        session.allow_window("cw").unwrap();
        session.request("cw", &child, 3, true, &json!({"action":"snapshot"})).unwrap();
    }
    #[test]
    fn child_close_retains_unknown_output_and_late_old_window_cleanup_cannot_revoke_replacement() {
        let (session, backend, _) = fixture();
        let child = uuid::Uuid::new_v4().to_string();
        session.request("cw", &child, 1, true, &json!({"action":"snapshot"})).unwrap();
        assert!(backend.writes.lock().unwrap().is_empty(), "Mount does not dispatch output");
        let revision = session.snapshot().unwrap()["revision"].clone();
        let armed = session.request("cw", &child, 2, true, &json!({"action":"arm","expectedRevision":revision})).unwrap();
        session.request("cw", &child, 3, true, &json!({"action":"send","expectedRevision":armed["revision"],"lease":armed["lease"],"macroID":1})).unwrap();
        backend.stop_fails.store(true, Ordering::SeqCst);
        assert!(session.prepare_close("cw").is_err());
        assert!(!session.snapshot().unwrap()["owner"].is_null());
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|value| value.0 == "send").count(), 1);
        let mut main = Client::new(); main.call(&session, "snapshot").unwrap();
        main.call(&session, "acknowledge").unwrap();
        let old = session.revoke_window_clients("cw").unwrap();
        session.prepare_close("cw").unwrap(); session.allow_window("cw").unwrap();
        let replacement = uuid::Uuid::new_v4().to_string();
        session.request("cw", &replacement, 1, true, &json!({"action":"snapshot"})).unwrap();
        let revision = session.snapshot().unwrap()["revision"].clone();
        session.request("cw", &replacement, 2, true, &json!({"action":"arm","expectedRevision":revision})).unwrap();
        session.release_clients(&old).unwrap();
        assert_eq!(session.snapshot().unwrap()["armed"], true);
    }
    #[test]
    fn two_clients_cannot_share_or_steal_an_arm_lease() {
        let (session, backend, _) = fixture(); let mut first = Client::new(); let mut second = Client::new();
        ready(&mut first, &session); second.call(&session, "snapshot").unwrap();
        assert!(second.call(&session, "arm").is_err()); assert!(second.call(&session, "send").is_err());
        first.call(&session, "send").unwrap(); assert_eq!(backend.writes.lock().unwrap().len(), 1);
        second.call(&session, "stop").unwrap(); assert_eq!(session.snapshot().unwrap()["armed"], false);
        second.call(&session, "arm").unwrap(); assert!(first.call(&session, "send").is_err());
    }
    #[test]
    fn stale_observations_and_duplicate_requests_never_dispatch() {
        let (session, backend, _) = fixture(); let mut client = Client::new();
        let old = client.call(&session, "snapshot").unwrap(); client.call(&session, "arm").unwrap(); client.sequence += 1;
        let stale = json!({"action":"send","expectedRevision":old["revision"],"lease":session.snapshot().unwrap()["lease"],"macroID":1});
        assert!(session.request("main", &client.id, client.sequence, true, &stale).is_err());
        assert!(session.request("main", &client.id, client.sequence, true, &json!({"action":"stop"})).is_err());
        assert!(backend.writes.lock().unwrap().is_empty());
    }
    #[test]
    fn canonical_revision_change_disarms_and_uses_only_new_qso_context() {
        let (session, backend, _) = fixture(); let mut client = Client::new(); ready(&mut client, &session);
        backend.canonical.lock().unwrap()["draftRevision"] = json!(3);
        assert!(client.call(&session, "send").is_err()); assert!(backend.writes.lock().unwrap().is_empty());
        client.call(&session, "arm").unwrap(); client.call(&session, "send").unwrap();
        assert_eq!(backend.writes.lock().unwrap()[0].1.as_deref(), Some("K1ABC DE OM0RX 599 K"));
        backend.canonical.lock().unwrap()["settingsRevision"] = json!(2);
        client.call(&session, "snapshot").unwrap(); assert_eq!(session.snapshot().unwrap()["armed"], false);
    }
    #[test]
    fn stop_is_immediate_and_releases_again_after_late_send() {
        let (session, backend, _) = fixture(); let mut client = Client::new(); ready(&mut client, &session);
        let (entered, wait) = mpsc::channel(); let (resume, receiver) = mpsc::channel(); *backend.gate.lock().unwrap() = Some((entered, receiver));
        let sending = session.clone(); let thread = std::thread::spawn(move || client.call(&sending, "send"));
        wait.recv_timeout(std::time::Duration::from_secs(2)).unwrap(); session.stop().unwrap();
        assert_eq!(backend.writes.lock().unwrap().iter().map(|value| value.0.as_str()).collect::<Vec<_>>(), vec!["send","stop"]);
        let before = session.snapshot().unwrap()["revision"].as_u64().unwrap();
        session.stop().unwrap();
        assert!(session.snapshot().unwrap()["revision"].as_u64().unwrap() > before, "Repeated Stop must publish its revocation even while release is pending");
        assert_eq!(backend.writes.lock().unwrap().len(), 2, "Repeated Stop must not replay output");
        assert!(!session.snapshot().unwrap()["owner"].is_null()); resume.send(()).unwrap(); thread.join().unwrap().unwrap();
        assert_eq!(backend.writes.lock().unwrap().iter().map(|value| value.0.as_str()).collect::<Vec<_>>(), vec!["send","stop","stop"]);
        assert!(session.snapshot().unwrap()["owner"].is_null());
    }
    #[test]
    fn lost_ack_retains_guard_and_never_replays_text() {
        let (session, backend, _) = fixture(); let mut client = Client::new(); ready(&mut client, &session);
        backend.lost_send.store(true, Ordering::SeqCst); assert!(client.call(&session, "send").is_err());
        assert!(!session.snapshot().unwrap()["owner"].is_null()); assert!(client.call(&session, "arm").is_err());
        backend.stop_fails.store(true, Ordering::SeqCst); assert!(client.call(&session, "stop").is_err());
        assert_eq!(session.snapshot().unwrap()["owner"]["generation"], 7);
        client.call(&session, "acknowledge").unwrap(); assert!(session.snapshot().unwrap()["owner"].is_null());
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|value| value.0 == "send").count(), 1);
    }
    #[test]
    fn late_winkeyer_arm_is_released_after_stop_and_cannot_restore_a_lease() {
        let (session, backend, _) = fixture(); backend.target.lock().unwrap()["output"] = json!("winkeyer");
        let mut client = Client::new(); client.call(&session, "snapshot").unwrap();
        let (entered, wait) = mpsc::channel(); let (resume, receiver) = mpsc::channel(); *backend.arm_gate.lock().unwrap() = Some((entered, receiver));
        let arming = session.clone(); let thread = std::thread::spawn(move || client.call(&arming, "arm"));
        wait.recv_timeout(std::time::Duration::from_secs(2)).unwrap(); session.stop().unwrap();
        assert_eq!(backend.writes.lock().unwrap().iter().map(|value| value.0.as_str()).collect::<Vec<_>>(), vec!["arm","stop"]);
        resume.send(()).unwrap(); assert!(thread.join().unwrap().is_err());
        assert_eq!(backend.writes.lock().unwrap().iter().map(|value| value.0.as_str()).collect::<Vec<_>>(), vec!["arm","stop","stop"]);
        assert_eq!(session.snapshot().unwrap()["armed"], false); assert!(session.snapshot().unwrap()["owner"].is_null());
    }
    #[test]
    fn focus_loss_window_destruction_and_missing_heartbeat_revoke_leases() {
        let (session, _, clock) = fixture(); let mut client = Client::new(); ready(&mut client, &session);
        session.release_window("main").unwrap(); assert_eq!(session.snapshot().unwrap()["armed"], false);
        ready(&mut client, &session); clock.store(3_001, Ordering::SeqCst); session.tick().unwrap(); assert_eq!(session.snapshot().unwrap()["armed"], false);
        client.call(&session, "arm").unwrap(); client.sequence += 1;
        assert!(session.request("main", &client.id, client.sequence, false, &json!({"action":"send"})).is_err());
        assert_eq!(session.snapshot().unwrap()["armed"], false);
    }
    #[test]
    fn failed_stop_does_not_leak_destroyed_or_unregistered_clients_or_release_the_guard() {
        for destroyed in [false, true] {
            let (session, backend, _) = fixture();
            let mut owner = Client { id: "00000000-0000-0000-0000-000000000001".into(), sequence: 0 };
            let mut observer = Client { id: "00000000-0000-0000-0000-000000000002".into(), sequence: 0 };
            ready(&mut owner, &session); observer.call(&session, "snapshot").unwrap(); owner.call(&session, "send").unwrap();
            backend.stop_fails.store(true, Ordering::SeqCst);
            let result = if destroyed { session.release_window("main").map(|_| Value::Null) } else { owner.call(&session, "unregister") };
            assert_eq!(result.unwrap_err(), "Stop unconfirmed");
            assert!(!session.lock().unwrap().clients.contains_key(&owner.id));
            if destroyed { assert!(session.lock().unwrap().clients.is_empty(), "Window cleanup must continue after the first Stop error"); }
            let guarded = session.snapshot().unwrap();
            assert_eq!(guarded["owner"]["generation"], 7); assert_eq!(guarded["error"], "Stop unconfirmed");
            assert!(guarded["lease"].is_null()); assert_eq!(guarded["armed"], false);
            for _ in 0..40 {
                let mut replacement = Client::new(); replacement.call(&session, "snapshot").unwrap();
                assert!(replacement.call(&session, "arm").is_err(), "A new renderer must not steal uncertain output");
                assert!(replacement.call(&session, "send").is_err());
                replacement.call(&session, "unregister").unwrap();
            }
            assert_eq!(session.snapshot().unwrap()["owner"]["generation"], 7);
            assert_eq!(backend.writes.lock().unwrap().iter().filter(|value| value.0 == "send").count(), 1);
        }
    }
    #[test]
    fn expiry_and_exact_connection_generation_block_send() {
        let (session, backend, clock) = fixture(); let mut client = Client::new(); ready(&mut client, &session);
        clock.store(60_001, Ordering::SeqCst); assert!(client.call(&session, "send").is_err()); session.tick().unwrap();
        client.call(&session, "arm").unwrap(); backend.target.lock().unwrap()["generation"] = json!(8);
        assert!(client.call(&session, "send").is_err()); assert!(backend.writes.lock().unwrap().is_empty());
    }
    #[test]
    fn winkeyer_intents_continue_from_backend_and_unregister_releases_arm() {
        let (session, backend, _) = fixture(); backend.target.lock().unwrap()["output"] = json!("winkeyer"); backend.target.lock().unwrap()["last_intent"] = json!(38);
        let mut client = Client::new(); ready(&mut client, &session); client.call(&session, "send").unwrap(); client.call(&session, "send").unwrap();
        let writes = backend.writes.lock().unwrap().clone(); assert_eq!(writes[0].0, "arm"); assert_eq!(writes[1].2, 39); assert_eq!(writes[2].2, 40);
        client.call(&session, "unregister").unwrap(); assert_eq!(backend.writes.lock().unwrap().last().unwrap().0, "stop");
    }
    #[test]
    fn macro_validation_rejects_injection_missing_tokens_and_output_limits() {
        let (session, backend, _) = fixture(); let mut canonical = backend.canonical.lock().unwrap().clone();
        canonical["context"]["CALL"] = json!("K1ABC\n"); assert!(expand(&canonical, 1, 128).is_ok());
        canonical["context"]["CALL"] = json!("K1{ABC}"); assert!(expand(&canonical, 1, 128).is_err());
        canonical["context"]["CALL"] = json!(""); assert!(expand(&canonical, 1, 128).is_err());
        canonical["profile"]["macros"][0]["text"] = json!("{EXCHANGE}"); canonical["context"]["EXCHANGE"] = json!("15"); assert_eq!(expand(&canonical, 1, 128).unwrap(), "15");
        canonical["profile"]["macros"][0]["text"] = json!("{EXCHANGE} {SENTNR}"); canonical["context"]["SENTNR"] = json!("0042");
        assert_eq!(expand(&canonical, 1, 128).unwrap(), "15 0042");
        canonical["profile"]["macros"][0]["text"] = json!("C".repeat(81)); assert!(expand(&canonical, 1, 80).is_err()); assert!(expand(&canonical, 1, 128).is_ok());
        canonical["profile"]["macros"][0]["text"] = json!("{UNKNOWN}"); assert!(expand(&canonical, 1, 128).is_err());
        assert!(session.snapshot().unwrap()["owner"].is_null());
    }
}
