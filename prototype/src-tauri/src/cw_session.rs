//! Process-owned CW authority. Clients carry observations and leases, never text.
use serde_json::{json, Value};
use std::{collections::{BTreeMap, BTreeSet}, sync::{Arc, Mutex}, time::Instant};

pub fn validate_surface(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if !matches!(label, "main" | "cw" | "contest-setup" | "contest--active-qso") || isolated || exiting {
        return Err("Shared CW controls require the live Desk, CW, or contest Entry window.".into());
    }
    if !matches!(action, "snapshot" | "arm" | "send" | "compose" | "contest" | "stop" | "acknowledge" | "unregister") {
        return Err("Unknown CW session action".into());
    }
    Ok(())
}

pub fn validate_invoker(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if label == "contest--active-qso" {
        return Err("Contest Entry controls CW through its native Setup owner.".into());
    }
    validate_surface(label, isolated, exiting, action)
}

/// Setup hosts the controller, but the operator uses the detached Entry window.
/// Keep its label stable for snapshots and Stop even when a session is closed.
pub fn control_window(label: &str) -> &str {
    if label == "contest-setup" { "contest--active-qso" } else { label }
}

pub fn control_window_focused(label: &str, read: impl FnOnce(&str) -> Option<(bool, bool)>) -> bool {
    read(control_window(label)).is_some_and(|(focused, visible)| focused && visible)
}
/// A main Setup entry/QTC arm explicitly selects its focus surface. The choice
/// is retained for polling; it never grants a background or third-window arm.
pub fn focus_window<'a>(label: &'a str, params: &Value, retained: &Value) -> Result<&'a str, String> {
    let requested = params["controlSurface"].as_str();
    if requested.is_some_and(|value| value != "setup") || requested.is_some() && label != "contest-setup" {
        return Err("This CW focus surface is unavailable.".into());
    }
    let setup = if params["action"] == "arm" { requested == Some("setup") }
        else { retained["controlSurface"] == "setup" };
    Ok(if label == "contest-setup" && setup { "contest-setup" } else { control_window(label) })
}

pub fn validate_contest_route(label: &str, params: &Value, active_session: Option<&str>) -> Result<(), String> {
    if !matches!(params["action"].as_str(), Some("arm" | "send" | "compose" | "contest")) { return Ok(()); }
    let entry = control_window(label) == "contest--active-qso";
    match (entry, active_session) {
        (true, None) => Err("Open a contest session before arming or sending from Entry.".into()),
        (false, Some(_)) => Err("Contest Entry owns CW while a contest session is active. Stop remains available here.".into()),
        (true, Some(session)) if params["action"] == "contest" && params["sessionID"] != session =>
            Err("The contest Entry request belongs to an expired session.".into()),
        _ => Ok(()),
    }
}

pub trait Backend: Send + Sync {
    fn contest_operation(&self, _canonical: &Value, _params: &Value) -> Result<Value, String> { Err("Contest CW is unavailable".into()) }
    fn claim_contest_output(&self, _canonical: &Value, _result: &Value) -> Result<(), String> { Err("Contest CW is unavailable".into()) }
    fn canonical(&self) -> Result<Value, String>;
    fn inspect(&self, canonical: &Value, capabilities: bool) -> Result<Value, String>;
    fn output(&self, target: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String>;
    fn sequence(&self, target: &Value, sequence: &crate::winkeyer::Sequence, intent: u64) -> Result<Value, String> {
        if sequence.variable_speed() { return Err("This adapter does not support buffered CW speed segments.".into()); }
        if sequence.has_prosigns() { return Err("This adapter does not support typed CW prosigns.".into()); }
        self.output(target, "send", Some(&sequence.text()), intent)
    }
    fn stream(&self, _target: &Value, _stream: &Value, _intent: u64) -> Result<Value, String> { Err("This adapter does not support owned CW streaming.".into()) }
    fn compose(&self, _target: &Value, _sequence: &crate::winkeyer::Sequence, _job: &str, _append: u64, _finish: bool, _intent: u64) -> Result<Value, String> {
        Err("This adapter does not support live CW composition; stage the text and use explicit Send.".into())
    }
    fn continue_sequence(&self,target:&Value,sequence:&crate::winkeyer::Sequence,_stream:&str,intent:u64)->Result<Value,String>{self.sequence(target,sequence,intent)}
    fn contest_outcome(&self, _canonical: &Value, _result: &Value, _target: &Value, _outcome: &str) -> Result<(), String> { Ok(()) }
    fn keyer_snapshot(&self) -> Result<Option<Value>, String> { Ok(None) }
}
struct Client { label: String, registration: String, sequence: u64, seen: u64 }
struct State {
    revision: u64, epoch: u64, clients: BTreeMap<String, Client>, closing: BTreeSet<String>, canonical: Value,
    holder: Option<String>, lease: Option<String>, target: Value, owner: Value, winkeyer: Value,
    armed_until: u64, pending: bool, stopping: bool, releases: usize, intent: u64,
    message: String, error: String, contest_result: Value, contest_pending: bool, stream: Value, evidence: Value, control_surface: String, continuation: Value, composition: Value,
}
pub struct Session { state: Mutex<State>, backend: Arc<dyn Backend>, clock: Arc<dyn Fn() -> u64 + Send + Sync>, owner_id: String }
impl Session {
    pub fn new(backend: Arc<dyn Backend>) -> Self {
        let start = Instant::now(); Self::with_clock(backend, Arc::new(move || start.elapsed().as_millis() as u64))
    }
    fn with_clock(backend: Arc<dyn Backend>, clock: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self { backend, clock, owner_id: uuid::Uuid::new_v4().to_string(), state: Mutex::new(State { revision: 0, epoch: 0, clients: BTreeMap::new(), closing: BTreeSet::new(), canonical: Value::Null,
            holder: None, lease: None, target: Value::Null, owner: Value::Null, winkeyer: Value::Null, armed_until: 0, pending: false, stopping: false, releases: 0,
            intent: 0, message: "CW disarmed".into(), error: String::new(), contest_result: Value::Null, contest_pending: false, stream: Value::Null, evidence: Value::Null, control_surface:"entry".into(), continuation:Value::Null, composition:Value::Null }) }
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, State>, String> { self.state.lock().map_err(|_| "CW session unavailable".into()) }
    fn snapshot_locked(&self, state: &State) -> Value {
        json!({"revision":state.revision,"armed":state.armed_until > (self.clock)(),"pending":state.pending || state.stopping,
            "owner":state.owner,"message":state.message,"error":state.error,"winkeyer":state.winkeyer,
            "client":state.holder,"lease":state.lease,"canonical":state.canonical,"contestResult":state.contest_result,"stream":state.stream,"controlSurface":state.control_surface,
            "composition":state.composition,
            "capabilities":{"speedSegments":state.target["speedSegments"] == true,"streaming":state.target["streaming"] == true,
                "composition":state.target["composition"] == true,"prosigns":state.target["prosigns"] == true,
                "progressEvidence":state.target["progressEvidence"]}})
    }
    pub fn snapshot(&self) -> Result<Value, String> { let state = self.lock()?; Ok(self.snapshot_locked(&state)) }
    /// Validated offline fixtures may observe this process owner without reading
    /// a provider, registering a client, refreshing context or admitting output.
    pub fn isolated_snapshot(&self, label: &str, exiting: bool, action: &str) -> Result<Value, String> {
        validate_invoker(label, false, exiting, action)?;
        if action != "snapshot" { return Err("Offline CW permits owner observation only; output remains disabled.".into()); }
        self.snapshot()
    }
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
            if canonical == state.canonical { false } else {
                let admitted = !state.stream.is_null() && same_stream_context(&state.canonical, &canonical, &state.stream);
                state.canonical = canonical; Self::change(&mut state); !admitted
            }
        };
        if changed { self.stop()?; }
        let revision = self.lock()?.revision;
        if let Some(value) = self.backend.keyer_snapshot()? {
            let mut state = self.lock()?;
            let keyer_lease_ended = state.target["output"] == "winkeyer" && state.armed_until > (self.clock)()
                && (value["generation"] != state.target["generation"] || value["phase"] != "ready" || value["armed_remaining_ms"] == 0);
            if state.revision == revision && !state.pending && !state.stopping && state.owner["output"] == "winkeyer"
                && value["generation"] == state.owner["generation"] && value["phase"] == "ready" && value["owns_output"] == false && value["pending_characters"] == 0 {
                state.owner = Value::Null; Self::change(&mut state);
            }
            state.winkeyer = value;
            drop(state);
            if keyer_lease_ended { self.stop()?; }
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
            "arm" | "send" | "compose" | "contest" | "acknowledge" => {
                if !focused { self.release_client(client)?; return Err("Focus the CW controls before using them.".into()); }
                self.refresh()?;
                match action { "arm" => self.arm(client, params)?, "send" => self.send(client, params)?, "compose" => self.compose(client, params)?,
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
            state.control_surface = if params["controlSurface"] == "setup" { "setup".into() } else { "entry".into() };
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
            state.message = if target["output"] == "test-simulation" {
                "TEST SIMULATION · CW armed for 60 seconds · no RF, audio, or PTT".into()
            } else { "CW armed for 60 seconds".into() }; Ok(())
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
        let (canonical, target, epoch, plan) = { let mut state = self.lock()?; Self::check(&state, client, params, true)?;
            if state.pending || state.stopping || state.armed_until <= (self.clock)() || state.target.is_null() { return Err("Arm CW before sending a macro.".into()); }
            if !state.composition.is_null() && state.composition["closed"] != true { return Err("Finish or Stop the composition before sending a memory.".into()); }
            let id = params["macroID"].as_u64().ok_or("Choose a saved CW macro")?;
            let source = state.canonical["profile"]["macros"].as_array().and_then(|items| items.iter().find(|item| item["id"] == id && item["enabled"] == true))
                .and_then(|item| item["text"].as_str()).ok_or("This macro is disabled or is not saved.")?;
            let plan = crate::cw_message::compile(source, &state.canonical["context"], state.target["limit"].as_u64().unwrap_or(80) as usize, false)?;
            validate_plan(&plan, &state.target)?;
            state.pending = true; state.error.clear(); Self::change(&mut state);
            (state.canonical.clone(), state.target.clone(), state.epoch, plan)
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
            self.backend.sequence(&target, &plan, intent)?; Ok(())
        })();
        self.complete(epoch, result, true)
    }
    /// Composition appends immutable typed deltas to the same output owner.
    /// Only the editable tail lives in the renderer; no growing string is replayed.
    fn compose(&self, client: &str, params: &Value) -> Result<(), String> {
        let job = params["jobID"].as_str().filter(|id| uuid::Uuid::parse_str(id).is_ok()).ok_or("Invalid CW composition identity")?;
        let append = params["appendSequence"].as_u64().filter(|n| (1..=4096).contains(n)).ok_or("Invalid CW append sequence")?;
        let finish = params["finish"].as_bool().ok_or("Choose the CW composition boundary")?;
        let live = params["live"].as_bool().ok_or("Choose staged or live CW composition")?;
        let source = params["template"].as_str().ok_or("CW composition text is unavailable")?;
        if params["inputOrigin"] != "explicit-send" && !(live && !finish && params["inputOrigin"] == "typing") {
            return Err("Only deliberate committed typing or explicit Send can admit composition.".into());
        }
        let (canonical, target, epoch, plan, count) = {
            let mut state = self.lock()?;
            Self::check(&state, client, params, true)?;
            if state.pending || state.stopping || state.armed_until <= (self.clock)() || state.target.is_null() {
                return Err("Arm CW and wait for the current request before composing.".into());
            }
            if !state.stream.is_null() || !state.continuation.is_null() {
                return Err("Finish or Stop the contest callsign stream before composing.".into());
            }
            let previous = &state.composition;
            let same = previous["jobID"] == job;
            // An identical acknowledged append is idempotent. A lost IPC
            // acknowledgement still makes the renderer require Stop.
            if same && previous["appendSequence"] == append && previous["template"] == source && previous["finish"] == finish && previous["live"] == live {
                return Ok(());
            }
            if same && (previous["closed"] == true || previous["appendSequence"].as_u64().unwrap_or(0) + 1 != append)
                || !same && (append != 1 || !state.owner.is_null() || !previous.is_null() && previous["closed"] != true) {
                return Err("CW composition was changed or retired. Stop before starting another job.".into());
            }
            if live && state.target["composition"] != true || !live && (!finish || append != 1) {
                return Err("This output supports staged Send only; live append requires a capable adapter.".into());
            }
            if source.trim().is_empty() && !(same && live) {
                return Err("Enter a CW message before sending.".into());
            }
            let plan = if source.is_empty() && same && finish {
                crate::winkeyer::Sequence { schema: 1, segments: vec![] }
            } else { crate::cw_message::compile(source, &state.canonical["context"], state.target["limit"].as_u64().unwrap_or(80) as usize, live)? };
            validate_plan(&plan, &state.target)?;
            let count = if same { previous["characters"].as_u64().unwrap_or(0) } else { 0 } + plan.text().len() as u64;
            if count > 2048 { return Err("Finish this composition within 2,048 characters, then start a new job.".into()); }
            state.pending = true; state.error.clear(); Self::change(&mut state);
            (state.canonical.clone(), state.target.clone(), state.epoch, plan, count)
        };
        let outcome = (|| {
            let observed = self.backend.inspect(&canonical, false)?;
            if !same_target(&target, &observed) || self.backend.canonical()? != canonical {
                return Err("CW draft, settings or connection changed; Stop and review the staged text.".into());
            }
            let intent = {
                let mut state = self.lock()?; self.current(&state, epoch, client)?;
                if state.armed_until <= (self.clock)() { return Err("CW arming expired during composition admission.".into()); }
                state.intent = state.intent.max(observed["last_intent"].as_u64().unwrap_or(0)).checked_add(1).ok_or("CW intent exhausted")?;
                state.owner = target.clone(); Self::change(&mut state); state.intent
            };
            if live { self.backend.compose(&target, &plan, job, append, finish, intent)?; }
            else { self.backend.sequence(&target, &plan, intent)?; }
            let mut state = self.lock()?; self.current(&state, epoch, client)?;
            let accepted = if state.composition["jobID"] == job { state.composition["accepted"].as_str().unwrap_or("").to_owned() } else { String::new() };
            state.composition = json!({"jobID":job,"appendSequence":append,"template":source,"finish":finish,"live":live,
                "closed":finish,"characters":count,"accepted":format!("{accepted}{}", plan.text()),"evidence":"backend-accepted; RF not verified"});
            Ok(())
        })();
        self.complete(epoch, outcome, true)
    }
    fn contest(&self, client: &str, params: &Value) -> Result<(), String> {
        let admission: Result<(Value, Value, u64), String> = (|| {
            let mut state = self.lock()?;
            Self::check(&state, client, params, true)?;
            if state.pending || state.stopping || state.armed_until <= (self.clock)() || state.target.is_null() {
                return Err("Arm CW before using contest ESM.".into());
            }
            if !state.composition.is_null() && state.composition["closed"] != true {
                return Err("Finish or Stop the CW workbench before a contest message or ESM action.".into());
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
            if params["operation"] == "text" {
                let raw = params["text"].as_str().ok_or("Contest CW input is unavailable")?;
                let text = raw.split_ascii_whitespace().collect::<Vec<_>>().join(" ").to_ascii_uppercase();
                let limit = target["limit"].as_u64().unwrap_or(80) as usize;
                if text.is_empty() || text.len() > limit || !text.is_ascii() || text.chars().any(char::is_control) {
                    return Err(format!("Contest CW input must be 1 to {limit} printable ASCII characters."));
                }
                let observed = self.backend.inspect(&canonical, false)?;
                if !same_target(&target, &observed) || self.backend.canonical()? != canonical {
                    return Err("Contest session, settings or radio changed before CW input output.".into());
                }
                let intent = { let mut state = self.lock()?; self.current(&state, epoch, client)?;
                    if state.armed_until <= (self.clock)() { return Err("CW arming expired before contest output.".into()); }
                    state.intent = state.intent.max(observed["last_intent"].as_u64().unwrap_or(0)).checked_add(1).ok_or("CW intent exhausted")?;
                    state.owner = target.clone(); Self::change(&mut state); state.intent };
                self.backend.output(&target, "send", Some(&text), intent)?;
                let mut state = self.lock()?; self.current(&state, epoch, client)?;
                state.contest_result = json!({"accepted":true,"operationID":params["operationID"]});
                state.canonical = canonical.clone();
                return Ok(());
            }
            let mut operation_params=params.clone();
            operation_params["cwProviderContext"]=json!({"providerID":target["provider"],"generation":target["generation"]});
            let native_owner = json!({"ownerID":self.owner_id,"epoch":epoch});
            operation_params["cwOwnerContext"] = native_owner.clone();
            // Renderer values never grant continuation admission. Only this live
            // owner can attest to its one-use stream on the captured connection.
            let continuation = { let state = self.lock()?; self.current(&state, epoch, client)?;
                let value = &state.continuation;
                if params["operation"] == "esm" && value.is_object() && value["draftID"] == canonical["draftID"]
                    && value["nativeOwner"] == native_owner && value["providerContext"] == operation_params["cwProviderContext"] {
                    value.clone()
                } else { Value::Null }
            };
            operation_params["cwContinuationAdmission"] = continuation.clone();
            let result = self.backend.contest_operation(&canonical, &operation_params)?;
            { let mut state = self.lock()?; state.contest_result = result.clone(); }
            let after = self.backend.canonical()?;
            if !same_contest_authority(&canonical, &after) || result["sessionID"] != canonical["contestSessionID"]
                || result["projection"]["revision"] != after["draftRevision"] || result["projection"]["draftID"] != after["draftID"]
                || result["operationID"] != params["operationID"] || result["replayed"] != false {
                return Err("Contest operation was replayed or its authoritative context changed; output was not replayed.".into());
            }
            let actions = result["actions"].as_array().ok_or("Contest output actions unavailable")?;
            // A default {CALL} action disappears when suppressed. The fresh
            // Host operation carries its decision independently of text actions.
            // Legacy action markers still fail closed without live admission.
            let suppressed = result["earlyCallSuppressed"] == true
                || actions.iter().any(|action| action["earlyCallSuppressed"] == true);
            if suppressed && continuation.is_null() {
                return Err("Live CW continuation is unavailable; Stop and recover with the full callsign.".into());
            }
            let mut messages = Vec::new(); let mut segments = Vec::new();
            for (index, action) in actions.iter().enumerate() {
                if action["sessionID"] != canonical["contestSessionID"] || action["draftID"] != canonical["draftID"]
                    || action["actionID"] != format!("{}:{index}", params["operationID"].as_str().unwrap_or(""))
                    || action["kind"] != "function_key" {
                    return Err("Contest output identity could not be verified.".into());
                }
                let sequence = if action["cwSequence"].is_object() { crate::winkeyer::Sequence::parse(&action["cwSequence"])? }
                    else { crate::winkeyer::Sequence { schema: 1, segments: vec![crate::winkeyer::Segment::Text { text: render_contest_action(action, &canonical["cwFormatting"], &canonical["context"]["GRID"], target["limit"].as_u64().unwrap_or(80) as usize)? }] } };
                if !segments.is_empty() { segments.push(crate::winkeyer::Segment::Text { text:" ".into() }); }
                messages.push(sequence.text()); segments.extend(sequence.segments);
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
                let is_stream = matches!(params["operation"].as_str(), Some("early_start" | "early_append" | "early_finish"));
                { let mut state = self.lock()?; state.evidence = json!({"canonical":after,"result":result,"target":target}); }
                let sent = if is_stream {
                    let stream = &result["earlyCW"];
                    if target["streaming"] != true || !valid_stream(stream, &after) || stream["streamID"] != params["streamID"]
                        || text != stream["call"].as_str().unwrap_or("") { return Err("CW streaming admission could not be verified.".into()); }
                    { let mut state = self.lock()?; self.current(&state, epoch, client)?; state.stream = stream.clone(); }
                    self.backend.stream(&target, stream, intent)
                } else {
                    if !self.lock()?.stream.is_null() { return Err("Finish or Stop the current callsign stream before another message.".into()); }
                    let previous = { let mut state = self.lock()?; self.current(&state, epoch, client)?;
                        let value = state.continuation.take();
                        if suppressed && value != continuation { return Err("CW continuation changed; Stop and recover with the full callsign.".into()); }
                        (suppressed && !value.is_null()).then_some(value) };
                    let sequence=crate::winkeyer::Sequence {schema:1,segments};
                    if let Some(previous)=previous {self.backend.continue_sequence(&target,&sequence,previous["streamID"].as_str().ok_or("CW continuation identity unavailable")?,intent)}
                        else {self.backend.sequence(&target,&sequence,intent)}
                };
                let outcome = if sent.is_ok() { "accepted" } else { "uncertain" };
                if sent.is_err() && is_stream { let _ = self.stop(); }
                // Output admission is never retried if this ancillary receipt fails.
                let recorded = self.backend.contest_outcome(&after, &result, &target, outcome);
                sent?; recorded?;
                if is_stream && result["earlyCW"]["complete"] == true { let mut state=self.lock()?; self.current(&state, epoch, client)?;
                    state.continuation=result["earlyCW"].clone();
                    state.continuation["nativeOwner"] = native_owner;
                    state.continuation["providerContext"] = operation_params["cwProviderContext"].clone();
                    state.stream = Value::Null; }
            }
            let mut state = self.lock()?; self.current(&state, epoch, client)?;
            state.canonical = after; Ok(())
        })();
        self.lock()?.contest_pending = false;
        if outcome.is_err() && matches!(params["operation"].as_str(), Some("early_start" | "early_append" | "early_finish")) {
            let _ = self.stop();
        }
        self.complete(epoch, outcome, true)
    }
    fn complete(&self, epoch: u64, result: Result<(), String>, sending: bool) -> Result<(), String> {
        let cleanup = { let mut state = self.lock()?;
            let cancelled = state.epoch != epoch;
            if let Err(error) = &result { state.error = error.clone(); state.armed_until = 0; }
            if cancelled || result.is_err() && (!sending || state.owner.is_null()) { state.armed_until = 0; state.stopping = true; }
            if !cancelled && result.is_ok() && sending { state.message = if state.target["output"] == "test-simulation" {
                "TEST SIMULATION · CW output consumed · no RF, audio, or PTT".into()
            } else { "Macro accepted · RF not verified".into() }; }
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
    /// Permission retirement can cancel only this exact original radio route.
    /// It must not disarm an unrelated independent keyer or replacement slot.
    pub fn stop_route(&self, provider:&str, radio:&str, connection:u64)->Result<(),String>{
        let target={let mut state=self.lock()?;
            let target=if !state.owner.is_null(){&state.owner}else{&state.target};
            if target["provider"]!=provider || target["radio_id"]!=radio || target["generation"]!=connection {return Ok(());}
            Self::begin_stop(&mut state)
        };
        if let Some(target)=target{self.finish_release(&target)?;}
        Ok(())
    }
    fn begin_stop(state: &mut State) -> Option<Value> {
        let simulated = state.target["output"] == "test-simulation";
        state.epoch += 1; state.armed_until = 0; state.lease = None;
        state.stream = Value::Null;
        state.continuation = Value::Null;
        state.composition = Value::Null;
        state.message = if simulated { "TEST SIMULATION · CW stopped · no RF, audio, or PTT".into() } else { "CW disarmed".into() };
        Self::change(state);
        if state.stopping { return None; }
        state.stopping = true; state.releases += 1;
        Some(if !state.owner.is_null() { state.owner.clone() } else if state.target["output"] == "winkeyer" { state.target.clone() } else { Value::Null })
    }
    fn finish_release(&self, target: &Value) -> Result<(), String> {
        let result = if target.is_null() { Ok(json!({})) } else { self.backend.output(target, "stop", None, 0) };
        let evidence = self.lock()?.evidence.clone();
        let recorded = if !target.is_null() && evidence.is_object() {
            self.backend.contest_outcome(&evidence["canonical"], &evidence["result"], target, if result.is_ok() { "stopped" } else { "uncertain" })
        } else { Ok(()) };
        let result = result.and_then(|value| recorded.map(|_| value));
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
    a["contestSessionID"].is_string() && ["worker", "generation", "workspaceGeneration", "selectedLaneID", "bindingVersion", "settingsRevision", "contestSessionID", "provider", "selection", "profile", "cwFormatting"]
        .iter().all(|key| a[*key] == b[*key])
}
fn valid_stream(stream: &Value, canonical: &Value) -> bool {
    stream["schema"] == 1 && stream["admitted"] == true && stream["draftID"] == canonical["draftID"]
        && stream["revision"] == canonical["draftRevision"] && stream["call"] == canonical["context"]["CALL"]
        && stream["streamID"].as_str().is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}
fn same_stream_context(before: &Value, after: &Value, stream: &Value) -> bool {
    let admission = &after["earlyCW"];
    same_contest_authority(before, after) && before["draftID"] == after["draftID"] && valid_stream(admission, after)
        && admission["streamID"] == stream["streamID"] && admission["complete"] == false
        && admission["revision"].as_u64().zip(stream["revision"].as_u64()).is_some_and(|(next, previous)| next >= previous)
        && admission["call"].as_str().zip(stream["call"].as_str()).is_some_and(|(next, previous)| next.starts_with(previous))
}
fn same_target(a: &Value, b: &Value) -> bool {
    ["output", "provider", "generation", "worker", "selection"].iter().all(|key| a[key] == b[key])
}
fn validate_plan(plan: &crate::winkeyer::Sequence, target: &Value) -> Result<(), String> {
    if plan.variable_speed() && target["speedSegments"] != true { return Err("This output cannot execute per-part CW speeds.".into()); }
    if plan.has_prosigns() && target["prosigns"] != true { return Err("This output cannot execute typed CW prosigns.".into()); }
    Ok(())
}
fn allowed(byte: u8) -> bool { byte.is_ascii_alphanumeric() || b" /?=+.,-".contains(&byte) }
fn cw_formatting<'a>(formatting: &'a Value, key: &str) -> Result<&'a str, String> {
    formatting[key].as_str().ok_or_else(|| format!("Invalid contest CW formatting preference: {key}"))
}
fn format_contest_rst(rst: &str, formatting: &Value) -> Result<String, String> {
    let style = cw_formatting(formatting, "cwRSTFormat")?;
    if !matches!(style, "5NN" | "599" | "ENN") { return Err("Invalid contest CW RST format".into()); }
    if style == "ENN" && rst == "599" { return Ok("ENN".into()); }
    Ok(if matches!(style, "5NN" | "ENN") { rst.replace('9', "N") } else { rst.into() })
}
fn format_contest_serial(serial: &str, formatting: &Value) -> Result<String, String> {
    // A contest without a serial authority must not acquire a synthetic
    // padding-only serial merely because a macro mentions the token.
    if serial.is_empty() { return Ok(String::new()); }
    let padding = cw_formatting(formatting, "cwSerialPaddingCharacter")?;
    let one = cw_formatting(formatting, "cwSerialOne")?;
    let nine = cw_formatting(formatting, "cwSerialNine")?;
    let zero = cw_formatting(formatting, "cwSerialZero")?;
    if !matches!(padding, "0" | "O" | "T") || !matches!(one, "1" | "A") ||
        !matches!(nine, "9" | "N") || !matches!(zero, "0" | "O" | "T") {
        return Err("Invalid contest CW serial formatting".into());
    }
    let width = formatting["cwSerialPaddingLength"].as_u64().filter(|value| (1..=10).contains(value))
        .ok_or("Invalid contest CW serial padding length")? as usize;
    let mut result = serial.trim_start_matches('0').replace('1', one).replace('9', nine).replace('0', zero);
    if result.len() < width { result = format!("{}{}", padding.repeat(width - result.len()), result); }
    Ok(result)
}
pub(crate) fn render_contest_action(action: &Value, formatting: &Value, grid: &Value, limit: usize) -> Result<String, String> {
    let rst = format_contest_rst(action["fields"]["sent"].as_str().ok_or("Pinned contest CW report unavailable")?, formatting)?;
    let serial = format_contest_serial(action["sentSerial"].as_str().ok_or("Pinned contest CW serial unavailable")?, formatting)?;
    let frozen = json!({"context":{"MYCALL":action["stationCall"],"CALL":action["fields"]["callsign"],
        "RST":rst,"EXCHANGE":action["sentExchange"],"SERIAL":serial,"SENTNR":serial,"NAME":"","GRID":grid}});
    expand_template(&frozen, action["template"].as_str().ok_or("Pinned contest CW template unavailable")?, limit)
}

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
        received_provider_context: Mutex<Value>,
        host_frames: Mutex<std::collections::VecDeque<Value>>,
        keyer_probe: Mutex<Option<crate::winkeyer::continuation_probe::Probe>>,
        keyer_view: Mutex<Option<Value>>,
        lost_send: AtomicBool, stop_fails: AtomicBool, receipt_fails: AtomicBool,
        gate: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
        arm_gate: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
    }
    impl Backend for Fake {
        fn contest_operation(&self, canonical: &Value, params: &Value) -> Result<Value, String> {
            *self.received_provider_context.lock().unwrap()=params["cwProviderContext"].clone();
            if let Some(frame) = self.host_frames.lock().unwrap().pop_front() {
                assert_eq!(params["operationID"], frame["result"]["operationID"]);
                assert_eq!(params["fields"]["callsign"], frame["after"]["fields"]["callsign"]);
                if frame["operation"] == "esm" && frame["result"]["replayed"] == false {
                    for key in ["streamID", "draftID", "operationID", "nativeOwner", "providerContext"] {
                        assert_eq!(params["cwContinuationAdmission"][key], frame["admission"][key], "{key}");
                    }
                }
                *self.canonical.lock().unwrap() = host_canonical(canonical, &frame["after"]);
                return Ok(frame["result"].clone());
            }
            let revision = canonical["draftRevision"].as_u64().unwrap() + 1;
            let mut after = canonical.clone(); after["draftRevision"] = json!(revision); after["draftID"] = json!("next-draft");
            after["context"]["CALL"] = json!("");
            if params["changeSettings"] == true { after["settingsRevision"] = json!(999); }
            let sent_serial = params["testSentSerial"].as_str().unwrap_or("");
            let template = params["testTemplate"].as_str().unwrap_or("{CALL} {RST} {EXCHANGE}");
            let early = matches!(params["operation"].as_str(),Some("early_start" | "early_append" | "early_finish"));
            if early {
                after["draftID"] = canonical["draftID"].clone(); after["context"]["CALL"] = params["fields"]["callsign"].clone();
                after["earlyCW"] = json!({"schema":1,"admitted":true,"streamID":params["streamID"],"draftID":canonical["draftID"],
                    "revision":revision,"call":params["fields"]["callsign"],"complete":params["operation"] == "early_finish"});
            }
            let early_state = after["earlyCW"].clone(); let after_draft = after["draftID"].clone();
            *self.canonical.lock().unwrap() = after;
            Ok(json!({"operationID":params["operationID"],"sessionID":canonical["contestSessionID"],"revision":revision,
                "projection":{"revision":revision,"draftID":after_draft},"replayed":params["replayed"] == true,"earlyCW":early_state,
                "earlyCallSuppressed":params["testOperationEarlyCallSuppressed"] == true,
                "actions":[{"kind":"function_key","key":"F2","sessionID":canonical["contestSessionID"],"draftID":canonical["draftID"],
                    "actionID":format!("{}:0",params["operationID"].as_str().unwrap()),"fields":params["fields"],"stationCall":"OM0RX","sentExchange":"15","sentSerial":sent_serial,
                    "earlyCallSuppressed":params["testEarlyCallSuppressed"] == true,
                    "cwSequence":if early {json!({"schema":1,"segments":[{"kind":"text","text":params["fields"]["callsign"]}]})} else {params["testCWSequence"].clone()},"template":template}]}))
        }
        fn claim_contest_output(&self, _: &Value, result: &Value) -> Result<(), String> {
            if self.claims.lock().unwrap().insert(result["operationID"].as_str().unwrap().into()) { Ok(()) }
            else { Err("Output consumed".into()) }
        }
        fn canonical(&self) -> Result<Value, String> { Ok(self.canonical.lock().unwrap().clone()) }
        fn keyer_snapshot(&self)->Result<Option<Value>,String>{Ok(self.keyer_view.lock().unwrap().clone())}
        fn inspect(&self, _: &Value, _: bool) -> Result<Value, String> { Ok(self.target.lock().unwrap().clone()) }
        fn output(&self, _: &Value, action: &str, text: Option<&str>, intent: u64) -> Result<Value, String> {
            if action == "arm" { if let Some(probe) = self.keyer_probe.lock().unwrap().as_mut() { probe.arm()?; } }
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
        fn stream(&self, target: &Value, stream: &Value, intent: u64) -> Result<Value, String> {
            if let Some(probe) = self.keyer_probe.lock().unwrap().as_mut() { probe.stream(stream, intent)?; }
            self.output(target,"stream",stream["call"].as_str(),intent)
        }
        fn compose(&self, target: &Value, sequence: &crate::winkeyer::Sequence, _: &str, _: u64, _: bool, intent: u64) -> Result<Value,String> {
            self.output(target, "send", Some(&sequence.text()), intent)
        }
        fn sequence(&self, target: &Value, sequence: &crate::winkeyer::Sequence, intent: u64) -> Result<Value, String> {
            if let Some(probe) = self.keyer_probe.lock().unwrap().as_mut() { probe.sequence(sequence, None, intent)?; }
            else if sequence.variable_speed() { return Err("This adapter does not support buffered CW speed segments.".into()); }
            self.output(target, "send", Some(&sequence.text()), intent)
        }
        fn continue_sequence(&self,target:&Value,sequence:&crate::winkeyer::Sequence,stream:&str,intent:u64)->Result<Value,String> {
            if let Some(probe) = self.keyer_probe.lock().unwrap().as_mut() { probe.sequence(sequence, Some(stream), intent)?; }
            self.output(target,"continue",Some(&sequence.text()),intent)
        }
        fn contest_outcome(&self, _: &Value, _: &Value, _: &Value, _: &str) -> Result<(), String> {
            if self.receipt_fails.load(Ordering::SeqCst) { Err("Output journal unavailable".into()) } else { Ok(()) }
        }
    }
    fn fixture() -> (Arc<Session>, Arc<Fake>, Arc<AtomicU64>) {
        let backend = Arc::new(Fake { canonical: Mutex::new(json!({"settingsRevision":1,"draftRevision":2,
            "profile":{"macros":[{"id":1,"enabled":true,"text":"{CALL} DE {MYCALL} {RST} K"}]},
            "cwFormatting":{"cwRSTFormat":"5NN","cwSerialPaddingCharacter":"T","cwSerialPaddingLength":3,
                "cwSerialOne":"1","cwSerialNine":"9","cwSerialZero":"0"},
            "context":{"CALL":"K1ABC","MYCALL":"OM0RX","RST":"599"}})),
            target: Mutex::new(json!({"output":"radio","provider":"direct_agent","generation":7,"worker":4,"selection":"choice","limit":128})),
            writes: Mutex::new(vec![]), claims: Mutex::new(BTreeSet::new()), received_provider_context:Mutex::new(Value::Null),
            host_frames: Mutex::new(Default::default()), keyer_probe: Mutex::new(None), keyer_view:Mutex::new(None),
            lost_send: AtomicBool::new(false), stop_fails: AtomicBool::new(false), receipt_fails: AtomicBool::new(false), gate: Mutex::new(None), arm_gate: Mutex::new(None) });
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
    fn compose_call(client:&mut Client, session:&Session, job:&str, append:u64, text:&str, live:bool, finish:bool, origin:&str)->Result<Value,String> {
        let snapshot=session.snapshot()?;client.sequence+=1;
        session.request("main",&client.id,client.sequence,true,&json!({"action":"compose","expectedRevision":snapshot["revision"],"lease":snapshot["lease"],
            "jobID":job,"appendSequence":append,"template":text,"live":live,"finish":finish,"inputOrigin":origin}))
    }
    #[test]
    fn composition_appends_deltas_once_and_stop_retires_the_job() {
        let (session,backend,_)=fixture();backend.target.lock().unwrap()["composition"]=json!(true);
        let mut client=Client::new();ready(&mut client,&session);let job=uuid::Uuid::new_v4().to_string();
        compose_call(&mut client,&session,&job,1,"CQ ",true,false,"typing").unwrap();
        compose_call(&mut client,&session,&job,2,"DE OM0RX",true,false,"typing").unwrap();
        compose_call(&mut client,&session,&job,2,"DE OM0RX",true,false,"typing").unwrap();
        assert!(compose_call(&mut client,&session,&job,2,"CHANGED",true,false,"typing").is_err());
        let sent:Vec<_>=backend.writes.lock().unwrap().iter().filter(|(a,_,_)|a=="send").map(|(_,s,_)|s.clone().unwrap()).collect();
        assert_eq!(sent,vec!["CQ ","DE OM0RX"]);
        assert_eq!(session.snapshot().unwrap()["composition"]["accepted"],"CQ DE OM0RX");
        session.stop().unwrap();
        assert!(compose_call(&mut client,&session,&job,3," LATE",true,false,"typing").is_err());
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(a,_,_)|a=="send").count(),2);
    }
    #[test]
    fn keyer_preference_apply_or_paddle_disarm_retires_native_arm_without_a_send(){
        let(session,backend,_)=fixture();backend.target.lock().unwrap()["output"]=json!("winkeyer");
        let mut client=Client::new();ready(&mut client,&session);
        *backend.keyer_view.lock().unwrap()=Some(json!({"generation":7,"phase":"ready","armed_remaining_ms":0,"owns_output":false,"pending_characters":0}));
        let snapshot=client.call(&session,"snapshot").unwrap();assert_eq!(snapshot["armed"],false);assert!(snapshot["lease"].is_null());
        let writes=backend.writes.lock().unwrap();assert_eq!(writes.iter().filter(|(a,_,_)|a=="stop").count(),1);
        assert!(!writes.iter().any(|(a,_,_)|a=="send"));
    }
    #[test]
    fn permission_retirement_stops_only_its_exact_original_provider_radio_and_connection(){
        let(session,backend,_)=fixture();{
            let mut target=backend.target.lock().unwrap();target["provider"]=json!("direct_tci");target["radio_id"]=json!("radio1");
        }
        let mut client=Client::new();ready(&mut client,&session);
        client.call(&session,"send").unwrap();
        session.stop_route("direct_tci","radio2",7).unwrap();session.stop_route("direct_tci","radio1",8).unwrap();
        session.stop_route("winkeyer","radio1",7).unwrap();assert_eq!(session.snapshot().unwrap()["armed"],true);
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(a,_,_)|a=="stop").count(),0);
        session.stop_route("direct_tci","radio1",7).unwrap();assert_eq!(session.snapshot().unwrap()["armed"],false);
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(a,_,_)|a=="stop").count(),1);
    }
    #[test]
    fn open_workbench_cannot_mutate_a_contest_draft_through_esm(){
        let(session,backend,mut client)=contest_ready();backend.target.lock().unwrap()["composition"]=json!(true);
        // Re-arm the updated capability before beginning the workbench job.
        session.stop().unwrap();ready(&mut client,&session);
        let before=backend.canonical.lock().unwrap().clone();let job=uuid::Uuid::new_v4().to_string();
        compose_call(&mut client,&session,&job,1,"CQ ",true,false,"typing").unwrap();
        let result=contest_call(&mut client,&session,json!({}));
        assert!(result["error"].as_str().unwrap().contains("workbench"));
        assert_eq!(*backend.canonical.lock().unwrap(),before);assert!(backend.claims.lock().unwrap().is_empty());
    }
    #[test]
    fn composition_requires_deliberate_origin_and_capabilities_before_output() {
        let (session,backend,_)=fixture();let mut client=Client::new();ready(&mut client,&session);
        let job=uuid::Uuid::new_v4().to_string();
        for origin in ["paste","preedit","suggestion","reference-refresh","typing"] {
            assert!(compose_call(&mut client,&session,&job,1,"CQ",true,false,origin).is_err());
        }
        for source in ["{WPM:18}CQ", "{PROSIGN:AR}", "CQ\u{1b}"] {
            assert!(compose_call(&mut client,&session,&job,1,source,false,true,"explicit-send").is_err());
        }
        assert!(backend.writes.lock().unwrap().is_empty());
        compose_call(&mut client,&session,&job,1,"{CALL} DE {MYCALL}",false,true,"explicit-send").unwrap();
        assert_eq!(backend.writes.lock().unwrap()[0].1.as_deref(),Some("K1ABC DE OM0RX"));
        // Text output does not mutate the canonical draft/serial/settings.
        assert_eq!(backend.canonical.lock().unwrap()["draftRevision"],2);
    }
    #[test]
    fn composition_draft_or_route_change_invalidates_old_append_and_lost_reply_never_replays() {
        let (session,backend,_)=fixture();backend.target.lock().unwrap()["composition"]=json!(true);
        let mut client=Client::new();ready(&mut client,&session);let job=uuid::Uuid::new_v4().to_string();
        compose_call(&mut client,&session,&job,1,"CQ ",true,false,"typing").unwrap();
        backend.canonical.lock().unwrap()["draftRevision"]=json!(3);
        assert!(compose_call(&mut client,&session,&job,2,"LATE",true,false,"typing").is_err());
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(a,_,_)|a=="send").count(),1);
        ready(&mut client,&session);let next=uuid::Uuid::new_v4().to_string();backend.lost_send.store(true,Ordering::SeqCst);
        assert!(compose_call(&mut client,&session,&next,1,"NEW",true,false,"typing").is_err());
        assert!(!session.snapshot().unwrap()["owner"].is_null());
        assert!(compose_call(&mut client,&session,&next,1,"NEW",true,false,"typing").is_err());
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(a,_,_)|a=="send").count(),2);
    }
    fn host_canonical(base: &Value, context: &Value) -> Value {
        let mut value = base.clone();
        value["contestSessionID"] = context["sessionID"].clone();
        value["workspaceGeneration"] = context["workspaceGeneration"].clone();
        value["draftID"] = context["draftID"].clone(); value["draftRevision"] = context["revision"].clone();
        value["earlyCW"] = context["earlyCW"].clone(); value["cwFormatting"] = context["cwFormatting"].clone();
        value["context"]["CALL"] = context["fields"]["callsign"].clone(); value
    }
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
        assert!(backend.writes.lock().unwrap().iter().any(|(action,text,_)| action=="send" && text.as_deref()==Some("K1ABC 5NN 15")));
        assert_eq!(backend.claims.lock().unwrap().len(), 1);
    }
    #[test]
    fn typed_compiler_payload_is_used_without_expanding_the_mutable_entry() {
        let (session, backend, mut client) = contest_ready();
        let reply = contest_call(&mut client, &session, json!({"testCWSequence":{"schema":1,"segments":[{"kind":"text","text":"1459 DL1ABC T19"}]}}));
        assert_eq!(reply["error"], "");
        assert!(backend.writes.lock().unwrap().iter().any(|(action,text,_)| action=="send" && text.as_deref()==Some("1459 DL1ABC T19")));
        assert!(!backend.writes.lock().unwrap().iter().any(|(_,text,_)| text.as_deref()==Some("K1ABC 5NN 15")));
    }
    #[test]
    fn provider_context_is_authored_from_the_native_target_even_if_the_renderer_supplies_another() {
        let (session,backend,mut client)=contest_ready();
        contest_call(&mut client,&session,json!({"cwProviderContext":{"providerID":"foreign","generation":99}}));
        assert_eq!(*backend.received_provider_context.lock().unwrap(),json!({"providerID":"direct_agent","generation":7}));
    }
    #[test]
    fn absent_native_continuation_cannot_send_a_host_suppressed_callsign() {
        for operation_scope in [false, true] {
            let (session, backend, mut client) = contest_ready();
            let reply = contest_call(&mut client, &session, json!({"operation":"esm",
                "testEarlyCallSuppressed":!operation_scope, "testOperationEarlyCallSuppressed":operation_scope,
                "cwContinuationAdmission":{"draftID":"draft-1","streamID":"stale-renderer"},
                "testCWSequence":{"schema":1,"segments":[{"kind":"text","text":"5NN TT1"}]}}));
            assert!(reply["error"].as_str().unwrap().contains("Live CW continuation"));
            assert!(backend.writes.lock().unwrap().is_empty());
            assert!(backend.claims.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn isolated_observation_reports_actual_owner_guard_without_provider_or_output_admission() {
        let (session, backend, _) = fixture();
        let idle = session.isolated_snapshot("contest-setup", false, "snapshot").unwrap();
        assert_eq!(idle["armed"], false); assert_eq!(idle["pending"], false); assert_eq!(idle["error"], "");
        for action in ["arm", "send", "contest", "stop", "acknowledge", "unregister"] {
            assert!(session.isolated_snapshot("contest-setup", false, action).is_err());
        }
        assert!(session.isolated_snapshot("contest--active-qso", false, "snapshot").is_err());
        assert!(session.isolated_snapshot("main", true, "snapshot").is_err());
        { let mut state = session.lock().unwrap(); state.armed_until = 100; state.error = "retained uncertainty".into(); }
        let guarded = session.isolated_snapshot("contest-setup", false, "snapshot").unwrap();
        assert_eq!(guarded["armed"], true); assert_eq!(guarded["error"], "retained uncertainty");
        assert!(backend.writes.lock().unwrap().is_empty()); assert!(backend.claims.lock().unwrap().is_empty());
    }
    #[test]
    fn actual_host_default_macros_continue_pending_keyer_once_and_reject_replay() {
        let (session, backend, _) = fixture();
        let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let output = std::process::Command::new(std::env::var("XLOG_TEST_PYTHON").unwrap_or_else(|_| "python3.12".into()))
            .arg(project.join("python/tests/cw_continuation_fixture.py"))
            // Initial canonical observation retires epoch 0; explicit arm uses 2.
            .arg(json!({"ownerID":session.owner_id,"epoch":2}).to_string())
            .env("PYTHONPATH", project.join("python")).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let fixture: Value = serde_json::from_slice(&output.stdout).unwrap();
        let frames = fixture["frames"].as_array().unwrap();
        { let mut canonical = backend.canonical.lock().unwrap(); *canonical = host_canonical(&canonical, &frames[0]["before"]); }
        *backend.host_frames.lock().unwrap() = frames.iter().cloned().collect();
        *backend.keyer_probe.lock().unwrap() = Some(crate::winkeyer::continuation_probe::Probe::new());
        { let mut target = backend.target.lock().unwrap();
            target["output"] = json!("winkeyer"); target["provider"] = json!("winkeyer"); target["streaming"] = json!(true); }
        let mut client = Client::new(); ready(&mut client, &session);
        assert_eq!(session.lock().unwrap().epoch, 2);
        for (index, frame) in frames.iter().enumerate() {
            if index == 3 { assert!(backend.keyer_probe.lock().unwrap().as_ref().unwrap().pending()); }
            let reply = contest_call(&mut client, &session, json!({"operation":frame["operation"],
                "operationID":frame["result"]["operationID"], "streamID":frame["result"]["earlyCW"]["streamID"],
                "fields":frame["after"]["fields"], "field":"callsign", "earlyStartEnabled":true, "inputOrigin":"typing", "threshold":3}));
            if index == 4 { assert!(reply["error"].as_str().unwrap().contains("replayed")); }
            else { assert_eq!(reply["error"], "", "frame {index}"); }
        }
        assert_eq!(frames[3]["result"]["actions"].as_array().unwrap().len(), 1);
        assert_eq!(frames[3]["result"]["actions"][0]["key"], "F3");
        assert_eq!(frames[3]["result"]["earlyCallSuppressed"], true);
        assert!(frames[3]["result"]["actions"][0]["earlyCallSuppressed"].is_null());
        assert!(session.lock().unwrap().continuation.is_null());
        assert_eq!(backend.keyer_probe.lock().unwrap().as_ref().unwrap().bytes(), b"OM0RX 5NN TT1");
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(action,_,_)| action=="continue").count(), 1);
        assert_eq!(backend.claims.lock().unwrap().len(), 4);
        assert_eq!(fixture["serialBeforeLog"], 1); assert_eq!(fixture["qsoCountBeforeLog"], 0);
        assert_eq!(fixture["qsoCountAfterLog"], 1); assert_eq!(fixture["nextSerial"], 2);
    }
    #[test]
    fn stop_reaches_the_original_output_even_when_its_ancillary_outcome_journal_fails() {
        let (session, backend, mut client) = contest_ready();
        contest_call(&mut client,&session,json!({})); backend.receipt_fails.store(true,Ordering::SeqCst);
        assert!(client.call(&session,"stop").unwrap_err().contains("journal"));
        assert!(backend.writes.lock().unwrap().iter().any(|(action,_,_)| action=="stop"));
        let snapshot=session.snapshot().unwrap(); assert_eq!(snapshot["armed"],false); assert!(!snapshot["owner"].is_null());
    }
    #[test]
    fn unsupported_speed_segments_are_never_silently_flattened() {
        let (session, backend, mut client) = contest_ready();
        let reply = contest_call(&mut client, &session, json!({"testCWSequence":{"schema":1,"segments":[{"kind":"speed","wpm":18},{"kind":"text","text":"CQ"},{"kind":"restore"}]}}));
        assert!(reply["error"].as_str().unwrap().contains("does not support"));
        assert!(!backend.writes.lock().unwrap().iter().any(|(action,_,_)| action=="send"));
    }
    #[test]
    fn host_admitted_stream_revisions_preserve_the_same_owner_and_stop_on_foreign_updates() {
        let (session, backend, mut client) = contest_ready();
        backend.target.lock().unwrap()["streaming"] = json!(true);
        client.call(&session,"stop").unwrap(); client.call(&session,"arm").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let started = contest_call(&mut client,&session,json!({"operation":"early_start","streamID":id,"fields":{"callsign":"OM0"}}));
        assert_eq!(started["stream"]["call"],"OM0"); assert_eq!(started["armed"],true);
        { let mut canonical=backend.canonical.lock().unwrap(); canonical["draftRevision"]=json!(4); canonical["context"]["CALL"]=json!("OM0R");
            canonical["earlyCW"]["revision"]=json!(4); canonical["earlyCW"]["call"]=json!("OM0R"); }
        let observed=client.call(&session,"snapshot").unwrap(); assert_eq!(observed["armed"],true);
        let appended=contest_call(&mut client,&session,json!({"operation":"early_append","streamID":id,"fields":{"callsign":"OM0RX"}}));
        assert_eq!(appended["stream"]["call"],"OM0RX"); assert_eq!(appended["armed"],true);
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(action,_,_)| action=="stream").count(),2);
        { let mut canonical=backend.canonical.lock().unwrap(); canonical["draftRevision"]=json!(6); canonical["earlyCW"]["admitted"]=json!(false); }
        let observed=client.call(&session,"snapshot").unwrap(); assert_eq!(observed["armed"],false); assert!(observed["stream"].is_null());
        assert!(backend.writes.lock().unwrap().iter().any(|(action,_,_)| action=="stop"));
    }
    #[test]
    fn contest_text_uses_the_armed_contest_lease_without_a_host_macro_mutation() {
        let (session, backend, mut client) = contest_ready();
        let reply = contest_call(&mut client, &session, json!({"operation":"text","text":"cq test de om0rx"}));
        assert_eq!(reply["contestResult"]["accepted"], true);
        assert_eq!(reply["armed"], true);
        assert!(backend.writes.lock().unwrap().iter().any(|(action,text,_)|
            action == "send" && text.as_deref() == Some("CQ TEST DE OM0RX")));
        assert!(backend.claims.lock().unwrap().is_empty());
    }
    #[test]
    fn contest_cw_formatting_matches_original_not1mm_without_changing_raw_values() {
        let mut formatting = json!({"cwRSTFormat":"5NN","cwSerialPaddingCharacter":"T","cwSerialPaddingLength":3,
            "cwSerialOne":"A","cwSerialNine":"N","cwSerialZero":"T"});
        assert_eq!(format_contest_rst("599", &formatting).unwrap(), "5NN");
        assert_eq!(format_contest_serial("001", &formatting).unwrap(), "TTA");
        assert_eq!(format_contest_serial("190", &formatting).unwrap(), "ANT");
        assert_eq!(format_contest_serial("", &formatting).unwrap(), "");
        formatting["cwRSTFormat"] = json!("ENN");
        assert_eq!(format_contest_rst("599", &formatting).unwrap(), "ENN");
        assert_eq!(format_contest_rst("579", &formatting).unwrap(), "57N");
        formatting["cwRSTFormat"] = json!("599");
        formatting["cwSerialPaddingCharacter"] = json!("0");
        formatting["cwSerialPaddingLength"] = json!(4);
        assert_eq!(format_contest_rst("599", &formatting).unwrap(), "599");
        assert_eq!(format_contest_serial("8", &formatting).unwrap(), "0008");
        assert_eq!(format_contest_serial("12345", &formatting).unwrap(), "A2345");
    }
    #[test]
    fn contest_output_formats_the_frozen_rst_and_serial_only_at_native_expansion() {
        let (session, backend, mut client) = contest_ready();
        { let mut canonical = backend.canonical.lock().unwrap();
            canonical["cwFormatting"] = json!({"cwRSTFormat":"ENN","cwSerialPaddingCharacter":"T","cwSerialPaddingLength":3,
                "cwSerialOne":"A","cwSerialNine":"N","cwSerialZero":"T"}); }
        client.call(&session, "stop").unwrap(); ready(&mut client, &session);
        let reply = contest_call(&mut client, &session, json!({"testSentSerial":"001","testTemplate":"{RST} {SENTNR}"}));
        assert_eq!(reply["error"], "");
        assert!(backend.writes.lock().unwrap().iter().any(|(action,text,_)| action == "send" && text.as_deref() == Some("ENN TTA")));
        assert_eq!(reply["contestResult"]["actions"][0]["sentSerial"], "001");
        assert_eq!(reply["contestResult"]["actions"][0]["fields"]["sent"], "599");
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
        for label in ["main", "cw", "contest-setup", "contest--active-qso", "contest--logbook", "monitor", "station-control", "settings", "log-qso", "unknown", "CW"] {
            for action in ["snapshot", "arm", "send", "stop", "acknowledge", "unregister"] {
                assert_eq!(validate_surface(label, false, false, action).is_ok(), matches!(label, "main" | "cw" | "contest-setup" | "contest--active-qso"));
                assert!(validate_surface(label, true, false, action).is_err());
                assert!(validate_surface(label, false, true, action).is_err());
                assert_eq!(validate_invoker(label, false, false, action).is_ok(), matches!(label, "main" | "cw" | "contest-setup"));
            }
        }
        for action in ["", "connect", "cw_control", "send_text", "set_speed"] {
            assert!(validate_surface("cw", false, false, action).is_err());
        }
    }
    #[test]
    fn contest_controller_routes_only_to_entry_and_requires_the_active_contest() {
        assert_eq!(control_window("contest-setup"), "contest--active-qso");
        assert_eq!(control_window("main"), "main");
        for (observed, expected) in [(Some((true,true)),true),(Some((true,false)),false),(Some((false,true)),false),(None,false)] {
            assert_eq!(control_window_focused("contest-setup", |label| {
                assert_eq!(label,"contest--active-qso", "Setup focus is never consulted"); observed
            }),expected);
        }
        for label in ["contest-setup", "contest--active-qso"] {
            assert!(validate_contest_route(label, &json!({"action":"arm"}), Some("session")).is_ok());
            assert!(validate_contest_route(label, &json!({"action":"arm"}), None).is_err());
            assert!(validate_contest_route(label, &json!({"action":"contest","sessionID":"old"}), Some("session")).is_err());
            assert!(validate_contest_route(label, &json!({"action":"contest","sessionID":"session"}), Some("session")).is_ok());
            for active in [None, Some("session")] {
                assert!(validate_contest_route(label, &json!({"action":"stop"}), active).is_ok());
            }
        }
        assert!(validate_contest_route("main", &json!({"action":"arm"}), Some("session")).is_err());
        assert!(validate_contest_route("main", &json!({"action":"stop"}), Some("session")).is_ok());
    }
    #[test]
    fn setup_entry_and_qtc_focus_requires_an_explicit_retained_arm_scope() {
        assert_eq!(focus_window("contest-setup",&json!({"action":"arm"}),&json!({})).unwrap(),"contest--active-qso");
        assert_eq!(focus_window("contest-setup",&json!({"action":"arm","controlSurface":"setup"}),&json!({})).unwrap(),"contest-setup");
        for action in ["snapshot","contest","stop"] {
            assert_eq!(focus_window("contest-setup",&json!({"action":action}),&json!({"controlSurface":"setup"})).unwrap(),"contest-setup");
        }
        assert!(focus_window("main",&json!({"action":"arm","controlSurface":"setup"}),&json!({})).is_err());
        assert!(focus_window("contest-setup",&json!({"action":"arm","controlSurface":"contest--qtc"}),&json!({})).is_err());
    }
    #[test]
    fn contest_entry_focus_retirement_and_sequencing_remain_native() {
        for destroyed in [false, true] {
            let (session, _, _) = fixture(); let client = uuid::Uuid::new_v4().to_string();
            let label = control_window("contest-setup");
            let observed = session.request(label, &client, 1, false, &json!({"action":"snapshot"})).unwrap();
            assert!(session.request(label, &client, 2, false, &json!({"action":"arm","expectedRevision":observed["revision"]})).is_err(),
                "Setup focus cannot substitute for Entry focus");
            let observed = session.request(label, &client, 3, true, &json!({"action":"snapshot"})).unwrap();
            session.request(label, &client, 4, true, &json!({"action":"arm","expectedRevision":observed["revision"]})).unwrap();
            assert_eq!(session.snapshot().unwrap()["armed"], true);
            assert!(session.request(label, &client, 4, true, &json!({"action":"arm"})).is_err());
            session.release_window("contest-setup").unwrap();
            assert_eq!(session.snapshot().unwrap()["armed"], true, "Setup blur does not own this lease");
            if destroyed { session.release_window("contest--active-qso").unwrap(); }
            else { let retiring = session.revoke_window_clients("contest--active-qso").unwrap(); session.release_clients(&retiring).unwrap(); }
            assert_eq!(session.snapshot().unwrap()["armed"], false);
            session.request(label, &client, 5, false, &json!({"action":"stop"})).unwrap();
        }
    }
    #[test]
    fn contest_entry_executes_one_esm_with_its_own_native_lease() {
        let (session, backend, _) = fixture(); let client = uuid::Uuid::new_v4().to_string();
        { let mut canonical = backend.canonical.lock().unwrap(); canonical["contestSessionID"] = json!("contest-1");
            canonical["draftID"] = json!("draft-1"); canonical["context"]["CALL"] = json!(""); }
        let label = control_window("contest-setup");
        let observed = session.request(label, &client, 1, true, &json!({"action":"snapshot"})).unwrap();
        let armed = session.request(label, &client, 2, true, &json!({"action":"arm","expectedRevision":observed["revision"]})).unwrap();
        let params = json!({"action":"contest","expectedRevision":armed["revision"],"lease":armed["lease"],
            "sessionID":"contest-1","expectedContestRevision":2,"draftID":"draft-1","operationID":uuid::Uuid::new_v4().to_string(),
            "operation":"esm","field":"other_2","fields":{"callsign":"K1ABC","sent":"599"}});
        let result = session.request(label, &client, 3, true, &params).unwrap();
        assert_eq!(result["contestResult"]["projection"]["draftID"], "next-draft");
        assert_eq!(backend.writes.lock().unwrap().iter().filter(|(action,_,_)| action == "send").count(), 1);
        assert!(session.request(label, &client, 3, true, &params).is_err());
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
