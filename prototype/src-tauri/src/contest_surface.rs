//! Bounded native contest projections and action receipts.
//! Detached windows are projection clients; the main renderer remains the sole
//! contest controller and the only consumer of queued actions.
use crate::contest_window_context::ContestWindowContext;
use crate::workspace_windows::{WorkspaceWindowIdentity, WorkspaceWindowScope};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Mutex, OnceLock};

const MAX_ACTIONS: usize = 64;
const MAX_ESCAPE_ACTIONS: usize = 8;
const MAX_RECEIPTS_PER_PANEL: usize = 64;
const MAX_REQUEST_IDS_PER_CONTEXT: usize = 250_000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_ACTION_BYTES: usize = 16 * 1024;
const MAX_PROJECTION_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone)]
struct Receipt {
    envelope: Value,
    envelope_digest: String,
    status: &'static str,
    message: Option<String>,
    projection_revision: u64,
}

fn retained_receipt(envelope: &Value, status: &'static str, message: Option<String>, projection_revision: u64) -> Receipt {
    let digest = Sha256::digest(serde_json::to_vec(envelope).expect("JSON values always serialize"));
    let mut retained = envelope.clone();
    if retained["action"] == "score_configure" { retained["params"]["password"] = Value::String("[redacted]".into()); }
    Receipt { envelope: retained,
        envelope_digest: digest.iter().map(|byte| format!("{byte:02x}")).collect(),
        status, message, projection_revision }
}

fn envelope_digest(envelope: &Value) -> String {
    let digest = Sha256::digest(serde_json::to_vec(envelope).expect("JSON values always serialize"));
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Default)]
struct PanelState {
    projection: Option<(u64, Value)>,
    receipts: VecDeque<(String, Receipt)>,
}

struct QueuedAction {
    panel_id: String,
    request_id: String,
    envelope: Value,
}

#[derive(Default)]
struct State {
    context: Option<ContestWindowContext>,
    panels: BTreeMap<String, PanelState>,
    actions: VecDeque<QueuedAction>,
    escape_actions: VecDeque<QueuedAction>,
    seen_request_ids: BTreeSet<String>,
    focused_actions: BTreeSet<String>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State::default()))
}

pub fn register_context(context: &ContestWindowContext) {
    if let Ok(mut state) = state().lock() {
        register_context_in(&mut state, context);
    }
}

fn register_context_in(state: &mut State, context: &ContestWindowContext) {
    if state.context.as_ref() != Some(context) {
        *state = State {
            context: Some(context.clone()),
            ..State::default()
        };
    }
}

pub fn invalidate_context(context: &ContestWindowContext) {
    if let Ok(mut state) = state().lock() {
        invalidate_context_in(&mut state, context);
    }
}

fn invalidate_context_in(state: &mut State, context: &ContestWindowContext) {
    if state.context.as_ref() == Some(context) {
        *state = State::default();
    }
}

pub fn invalidate_all() {
    if let Ok(mut state) = state().lock() {
        *state = State::default();
    }
}

pub fn submit(label: &str, envelope: Value, focused: bool) -> Result<Value, String> {
    let panel_id = contest_panel(label)?;
    let checked = validate_action_envelope(&envelope)?;
    if checked.panel_id != panel_id {
        return Err("The contest action does not belong to this native window.".into());
    }
    crate::contest_window_context::with_admitted(&checked.context, || {
        let mut state = state()
            .lock()
            .map_err(|_| "Contest surface state unavailable")?;
        submit_after_admission_focused(&mut state, &panel_id, &checked, envelope, focused)
    })?
}

#[cfg(test)]
fn submit_after_admission(
    state: &mut State,
    panel_id: &str,
    checked: &CheckedAction,
    envelope: Value,
) -> Result<Value, String> {
    submit_after_admission_focused(state, panel_id, checked, envelope, true)
}

fn submit_after_admission_focused(
    state: &mut State,
    panel_id: &str,
    checked: &CheckedAction,
    envelope: Value,
    focused: bool,
) -> Result<Value, String> {
    require_context(state, &checked.context)?;
    if requires_focus_admission(&envelope) && !focused {
        return Err("Focus the contest Entry controls before using them.".into());
    }
    submit_checked(state, panel_id, checked, envelope)
}

fn submit_checked(
    state: &mut State,
    panel_id: &str,
    checked: &CheckedAction,
    envelope: Value,
) -> Result<Value, String> {
    for (existing_panel, panel) in &state.panels {
        if let Some((_, receipt)) = panel
            .receipts
            .iter()
            .find(|(request_id, _)| request_id == &checked.request_id)
        {
            if existing_panel != panel_id || receipt.envelope_digest != envelope_digest(&envelope) {
                return Err(
                    "That contest action requestID is already bound to another request.".into(),
                );
            }
            return Ok(submission_value(&checked.request_id, receipt));
        }
    }
    if state.seen_request_ids.contains(&checked.request_id) {
        return Err("That contest action receipt was retired and will not be replayed.".into());
    }
    let focus_admission = requires_focus_admission(&envelope);
    let escape = is_escape_action(&envelope);
    let projection_revision = state
        .panels
        .get(panel_id)
        .and_then(|panel| panel.projection.as_ref())
        .filter(|(revision, projection)| {
            projection["status"] == "ready"
                && if escape {
                    checked.projection_revision <= *revision
                } else {
                    checked.projection_revision == *revision
                }
        })
        .ok_or("Refresh this contest surface before sending an action.")?
        .0;
    if escape && state.escape_actions.len() >= MAX_ESCAPE_ACTIONS {
        return Err("The contest Escape queue is full; wait for the main desk.".into());
    }
    if !escape && state.actions.len() >= MAX_ACTIONS {
        return Err("The contest surface action queue is full; wait for the main desk.".into());
    }
    if state.seen_request_ids.len() >= MAX_REQUEST_IDS_PER_CONTEXT {
        return Err("The contest surface request ledger is full; reopen the contest session before sending more actions.".into());
    }
    let panel = state.panels.entry(panel_id.into()).or_default();
    if escape {
        retire_old_receipts(panel, true, MAX_ESCAPE_ACTIONS)?;
    } else {
        retire_old_receipts(panel, false, MAX_RECEIPTS_PER_PANEL)?;
    }
    panel.receipts.push_back((
        checked.request_id.clone(),
        retained_receipt(&envelope, "queued", None, projection_revision),
    ));
    let queued = QueuedAction {
        panel_id: panel_id.into(),
        request_id: checked.request_id.clone(),
        envelope,
    };
    if escape {
        state.escape_actions.push_back(queued);
    } else {
        state.actions.push_back(queued);
    }
    state.seen_request_ids.insert(checked.request_id.clone());
    if focus_admission {
        state.focused_actions.insert(checked.request_id.clone());
    }
    Ok(json!({"requestID":checked.request_id,"status":"queued"}))
}

fn requires_focus_admission(envelope: &Value) -> bool {
    envelope["action"] == "entry_operator_arm" && envelope["params"]["armed"] == true
        || envelope["action"] == "entry_operator_key" && envelope["params"]["key"] != "Escape"
        || envelope["action"] == "entry_send_cw_text"
}

pub fn consume_focus_admission(context: &ContestWindowContext, request_id: &str, action: &str) -> Result<bool, String> {
    canonical_uuid(request_id, "contest action requestID")?;
    crate::contest_window_context::with_admitted(context, || {
        let mut state = state().lock().map_err(|_| "Contest surface state unavailable")?;
        require_context(&state, context)?;
        Ok(consume_focus_admission_in(&mut state, request_id, action))
    })?
}

fn consume_focus_admission_in(state: &mut State, request_id: &str, action: &str) -> bool {
    let admitted = state.panels.get("active-qso").and_then(|panel| panel.receipts.iter()
        .find(|(candidate, _)| candidate == request_id)).is_some_and(|(_, receipt)| {
            receipt.status == "uncertain" && requires_focus_admission(&receipt.envelope)
                && matches!((action, receipt.envelope["action"].as_str()), ("arm", Some("entry_operator_arm"))
                    | ("contest", Some("entry_operator_key" | "entry_send_cw_text")))
        });
    admitted && state.focused_actions.remove(request_id)
}

pub fn revoke_focus_admissions(label: &str) {
    if label == "contest--active-qso" {
        if let Ok(mut state) = state().lock() {
            revoke_focus_admissions_in(&mut state);
        }
    }
}

fn revoke_focus_admissions_in(state: &mut State) {
    state.focused_actions.clear();
}

pub fn next(context: &ContestWindowContext) -> Result<Option<Value>, String> {
    crate::contest_window_context::with_admitted(context, || {
        let mut state = state()
            .lock()
            .map_err(|_| "Contest surface state unavailable")?;
        require_context(&state, context)?;
        take_next(&mut state)
    })?
}

pub fn next_escape(context: &ContestWindowContext) -> Result<Option<Value>, String> {
    crate::contest_window_context::with_admitted(context, || {
        let mut state = state()
            .lock()
            .map_err(|_| "Contest surface state unavailable")?;
        require_context(&state, context)?;
        take_next_escape(&mut state)
    })?
}

fn take_next(state: &mut State) -> Result<Option<Value>, String> {
    let Some(action) = state.actions.pop_front() else {
        return Ok(None);
    };
    let receipt = receipt_mut(state, &action.panel_id, &action.request_id)?;
    if receipt.status != "queued" {
        return Err("The queued contest action receipt is inconsistent.".into());
    }
    receipt.status = "uncertain";
    Ok(Some(action.envelope))
}

fn take_next_escape(state: &mut State) -> Result<Option<Value>, String> {
    let Some(action) = state.escape_actions.pop_front() else {
        return Ok(None);
    };
    let receipt = receipt_mut(state, &action.panel_id, &action.request_id)?;
    if receipt.status != "queued" {
        return Err("The queued contest Escape receipt is inconsistent.".into());
    }
    receipt.status = "uncertain";
    Ok(Some(action.envelope))
}

pub fn complete(
    context: &ContestWindowContext,
    request_id: &str,
    outcome: &str,
    message: Option<String>,
    projection_revision: u64,
) -> Result<Value, String> {
    canonical_uuid(request_id, "contest action requestID")?;
    if !matches!(outcome, "applied" | "rejected") {
        return Err("The contest action outcome is invalid.".into());
    }
    if projection_revision > MAX_SAFE_INTEGER {
        return Err("The contest projection revision is invalid.".into());
    }
    if let Some(message) = message.as_ref() {
        bounded_text(message, 1024, true, "contest action message")?;
    }
    crate::contest_window_context::with_admitted(context, || {
        let mut state = state()
            .lock()
            .map_err(|_| "Contest surface state unavailable")?;
        require_context(&state, context)?;
        complete_after_admission(
            &mut state,
            request_id,
            outcome,
            message,
            projection_revision,
        )
    })?
}

fn complete_after_admission(
    state: &mut State,
    request_id: &str,
    outcome: &str,
    message: Option<String>,
    projection_revision: u64,
) -> Result<Value, String> {
    let (panel_id, receipt) = find_receipt_mut(state, request_id)?;
    if receipt.status != "uncertain" {
        if receipt.status == outcome
            && receipt.message.as_deref() == message.as_deref()
            && receipt.projection_revision == projection_revision
        {
            return Ok(receipt_value(request_id, receipt));
        }
        return Err("That contest action was not taken by the main controller.".into());
    }
    if projection_revision < receipt.projection_revision {
        return Err("The contest action completion has a stale projection revision.".into());
    }
    receipt.status = if outcome == "applied" {
        "applied"
    } else {
        "rejected"
    };
    receipt.message = message;
    receipt.projection_revision = projection_revision;
    let value = receipt_value(request_id, receipt);
    state.focused_actions.remove(request_id);
    debug_assert!(!panel_id.is_empty());
    Ok(value)
}

pub fn publish(
    context: &ContestWindowContext,
    panel_id: &str,
    projection_revision: u64,
    projection: Value,
) -> Result<(), String> {
    validate_panel(panel_id)?;
    if projection_revision > MAX_SAFE_INTEGER {
        return Err("The contest projection revision is invalid.".into());
    }
    validate_projection(panel_id, &projection)?;
    crate::contest_window_context::with_admitted(context, || {
        let mut state = state()
            .lock()
            .map_err(|_| "Contest surface state unavailable")?;
        require_context(&state, context)?;
        publish_after_admission(&mut state, panel_id, projection_revision, projection)
    })?
}

fn publish_after_admission(
    state: &mut State,
    panel_id: &str,
    projection_revision: u64,
    projection: Value,
) -> Result<(), String> {
    let panel = state.panels.entry(panel_id.into()).or_default();
    if let Some((revision, current)) = panel.projection.as_ref() {
        if projection_revision < *revision {
            return Err(
                "Contest Setup is out of date. Close and reopen it before continuing.".into(),
            );
        }
        if projection_revision == *revision {
            if projection == *current {
                // React StrictMode can replay the owner publication during setup.
                // Treat only the exact current coordinate as an idempotent success;
                // a divergent same-revision projection remains a rejected replay.
                return Ok(());
            }
            return Err(
                "Contest Setup changed unexpectedly. Close and reopen it before continuing.".into(),
            );
        }
    }
    panel.projection = Some((projection_revision, projection));
    Ok(())
}

pub fn snapshot(label: &str, context: &ContestWindowContext) -> Result<Value, String> {
    let panel_id = contest_panel(label)?;
    crate::contest_window_context::with_admitted(context, || {
        let state = state()
            .lock()
            .map_err(|_| "Contest surface state unavailable")?;
        require_context(&state, context)?;
        let panel = state.panels.get(&panel_id);
        let (projection_revision, projection) = panel
            .and_then(|panel| panel.projection.as_ref())
            .map(|(revision, projection)| (*revision, projection.clone()))
            .unwrap_or((0, json!({"schemaVersion":1,"status":"unavailable"})));
        let receipts = panel
            .map(|panel| {
                panel
                    .receipts
                    .iter()
                    .map(|(request_id, receipt)| receipt_value(request_id, receipt))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(
            json!({"operatingContext":context.operating_context,"scope":"contesting","sessionID":context.session_id,
            "workspaceGeneration":context.workspace_generation,"panelID":panel_id,"projectionRevision":projection_revision,
            "projection":projection,"receipts":receipts}),
        )
    })?
}

pub fn rotor_target(label: &str, context: &ContestWindowContext) -> Result<Value, String> {
    if label != "contest--rotor" {
        return Err("The contest rotor target is unavailable in this window.".into());
    }
    crate::contest_window_context::with_admitted(context, || {
        let state = state().lock().map_err(|_| "Contest surface state unavailable")?;
        require_context(&state, context)?;
        let Some((revision, projection)) = state.panels.get("active-qso").and_then(|panel| panel.projection.as_ref()) else {
            return Ok(json!({"available":false,"projectionRevision":0,"callsign":null,
                "shortPathBearing":null,"longPathBearing":null}));
        };
        Ok(rotor_target_projection(*revision, projection))
    })?
}

fn rotor_target_projection(revision: u64, projection: &Value) -> Value {
    if projection["status"] != "ready" {
        return json!({"available":false,"projectionRevision":revision,"callsign":null,
            "shortPathBearing":null,"longPathBearing":null});
    }
    let callsign = projection["draft"]["callsign"].as_str().map(str::trim).filter(|call| !call.is_empty());
    let short = projection["manual"]["headingDegrees"].as_f64().filter(|bearing| *bearing >= 0.0 && *bearing <= 360.0);
    let long = projection["manual"]["longPathHeadingDegrees"].as_f64().filter(|bearing| *bearing >= 0.0 && *bearing <= 360.0);
    json!({"available":callsign.is_some(),"projectionRevision":revision,"callsign":callsign,
        "shortPathBearing":short,"longPathBearing":long})
}

fn receipt_mut<'a>(
    state: &'a mut State,
    panel_id: &str,
    request_id: &str,
) -> Result<&'a mut Receipt, String> {
    state
        .panels
        .get_mut(panel_id)
        .and_then(|panel| {
            panel
                .receipts
                .iter_mut()
                .find(|(candidate, _)| candidate == request_id)
                .map(|(_, receipt)| receipt)
        })
        .ok_or_else(|| "The contest action receipt is missing.".into())
}

fn find_receipt_mut<'a>(
    state: &'a mut State,
    request_id: &str,
) -> Result<(String, &'a mut Receipt), String> {
    for (panel_id, panel) in &mut state.panels {
        if let Some((_, receipt)) = panel
            .receipts
            .iter_mut()
            .find(|(candidate, _)| candidate == request_id)
        {
            return Ok((panel_id.clone(), receipt));
        }
    }
    Err("That contest action requestID is unknown.".into())
}

fn retire_old_receipts(
    panel: &mut PanelState,
    escape: bool,
    maximum: usize,
) -> Result<(), String> {
    while panel
        .receipts
        .iter()
        .filter(|(_, receipt)| is_escape_action(&receipt.envelope) == escape)
        .count()
        >= maximum
    {
        let oldest = panel
            .receipts
            .iter()
            .position(|(_, receipt)| is_escape_action(&receipt.envelope) == escape);
        let index = oldest.filter(|index| {
            matches!(panel.receipts[*index].1.status, "applied" | "rejected")
        });
        let Some(index) = index else {
            let lane = if escape { " Escape" } else { " action" };
            return Err(format!("This contest surface has too many unresolved{lane} receipts."));
        };
        panel.receipts.remove(index);
    }
    Ok(())
}

fn is_escape_action(envelope: &Value) -> bool {
    envelope["panelID"] == "active-qso"
        && envelope["action"] == "entry_operator_key"
        && envelope["params"]["key"] == "Escape"
}

fn receipt_value(request_id: &str, receipt: &Receipt) -> Value {
    json!({"requestID":request_id,"status":receipt.status,"message":receipt.message,
        "projectionRevision":receipt.projection_revision})
}

fn submission_value(request_id: &str, receipt: &Receipt) -> Value {
    json!({"requestID":request_id,"status":receipt.status})
}

fn require_context(state: &State, context: &ContestWindowContext) -> Result<(), String> {
    if state.context.as_ref() == Some(context) {
        Ok(())
    } else {
        Err("That contest surface belongs to an expired context.".into())
    }
}

fn contest_panel(label: &str) -> Result<String, String> {
    if label == "contest--edit-contact" { return Ok("logbook".into()); }
    let identity = WorkspaceWindowIdentity::parse_native_label(label)?;
    if identity.scope != WorkspaceWindowScope::Contesting {
        return Err("Only a contest native window can use contest surfaces.".into());
    }
    validate_panel(identity.panel_id)?;
    Ok(identity.panel_id.into())
}

fn validate_panel(panel_id: &str) -> Result<(), String> {
    if crate::workspace_windows::supports_panel(WorkspaceWindowScope::Contesting, panel_id) {
        Ok(())
    } else {
        Err("The contest surface panel is invalid.".into())
    }
}

struct CheckedAction {
    context: ContestWindowContext,
    panel_id: String,
    request_id: String,
    projection_revision: u64,
}

fn validate_action_envelope(value: &Value) -> Result<CheckedAction, String> {
    if serde_json::to_vec(value)
        .map_err(|_| "The contest action envelope is invalid.")?
        .len()
        > MAX_ACTION_BYTES
    {
        return Err("The contest action envelope is too large.".into());
    }
    let envelope = object(value, "contest action envelope")?;
    exact(
        envelope,
        &[
            "operatingContext",
            "scope",
            "sessionID",
            "workspaceGeneration",
            "panelID",
            "projectionRevision",
            "requestID",
            "action",
            "params",
        ],
        "contest action envelope",
    )?;
    if envelope["scope"] != "contesting" {
        return Err("The contest action scope is invalid.".into());
    }
    let context = ContestWindowContext {
        operating_context: canonical_uuid_value(
            &envelope["operatingContext"],
            "operating context",
        )?
        .into(),
        session_id: canonical_uuid_value(&envelope["sessionID"], "contest session")?.into(),
        workspace_generation: canonical_uuid_value(
            &envelope["workspaceGeneration"],
            "contest workspace",
        )?
        .into(),
    };
    let panel_id = text_value(&envelope["panelID"], 32, false, "contest panel")?;
    validate_panel(panel_id)?;
    let request_id =
        canonical_uuid_value(&envelope["requestID"], "contest action requestID")?.into();
    let projection_revision = uint_value(
        &envelope["projectionRevision"],
        MAX_SAFE_INTEGER,
        "contest projection revision",
    )?;
    let action = text_value(&envelope["action"], 64, false, "contest action")?;
    let params = object(&envelope["params"], "contest action params")?;
    validate_action_params(action, params)?;
    let matches_panel = action.starts_with("spot_") && matches!(panel_id, "band-maps" | "dx-cluster")
        || action.starts_with("entry_") && panel_id == "active-qso"
        || action.starts_with("assistance_") && panel_id == "callsign-intelligence"
        || action.starts_with("log_") && panel_id == "logbook"
        || action.starts_with("score_") && panel_id == "score-reporting";
    if !matches_panel {
        return Err("The contest action is not available on that panel.".into());
    }
    Ok(CheckedAction {
        context,
        panel_id: panel_id.into(),
        request_id,
        projection_revision,
    })
}

fn validate_action_params(action: &str, params: &Map<String, Value>) -> Result<(), String> {
    match action {
        "spot_select" | "spot_confirm" | "spot_delete" => {
            draft(params, &["spotID"])?;
            text_value(&params["spotID"], 128, false, "spot ID")?;
        }
        "spot_set_marked" => {
            draft(params, &["spotID", "marked"])?;
            text_value(&params["spotID"], 128, false, "spot ID")?;
            boolean(&params["marked"], "spot marked state")?;
        }
        "spot_set_marked_only" => {
            draft(params, &["markedOnly"])?;
            boolean(&params["markedOnly"], "marked-only filter")?;
        }
        "entry_set_text" => {
            draft(params, &["field", "value"])?;
            enum_value(
                &params["field"],
                &["callsign", "sentReport", "receivedReport"],
                "entry field",
            )?;
            text_value(&params["value"], 160, true, "entry value")?;
        }
        "entry_set_exchange" => {
            draft(params, &["fieldID", "value"])?;
            text_value(&params["fieldID"], 64, false, "exchange field")?;
            text_value(&params["value"], 1024, true, "exchange value")?;
        }
        "entry_set_frequency_text" => {
            draft(params, &["value"])?;
            frequency_text(&params["value"])?;
        }
        "entry_set_band" | "entry_set_mode" => {
            draft(params, &["value"])?;
            text_value(&params["value"], 16, false, "entry selection")?;
        }
        "entry_reserve_serial" | "entry_commit" | "entry_clear" | "entry_spot" | "entry_mark_spot"
        | "entry_tune_spot" => draft(params, &[])?,
        "entry_step_spot" => {
            draft(params, &["direction"])?;
            enum_value(&params["direction"], &["previous", "next"], "spot direction")?;
        }
        "entry_focus" => {
            draft(params, &["fieldID"])?;
            enum_value(
                &params["fieldID"],
                &["callsign", "sent", "receive", "other_1", "other_2"],
                "operator focused field",
            )?;
        }
        "entry_operator_key" => {
            draft(params, &["key", "focusedField"])?;
            enum_value(
                &params["key"],
                &[
                    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
                    "Enter", "Escape",
                ],
                "operator key",
            )?;
            if !params["focusedField"].is_null() {
                enum_value(
                    &params["focusedField"],
                    &["callsign", "sent", "receive", "other_1", "other_2"],
                    "operator focused field",
                )?;
            }
        }
        "entry_operator_arm" => {
            draft(params, &["armed"])?;
            boolean(&params["armed"], "operator armed state")?;
        }
        "entry_operator_style" => {
            draft(params, &["value"])?;
            enum_value(
                &params["value"],
                &["run", "search-and-pounce"],
                "operator style",
            )?;
        }
        "entry_set_cw_speed" => {
            draft(params, &["value"])?;
            let speed = uint_value(&params["value"], 100, "CW speed")?;
            if speed < 5 { return Err("CW speed must be between 5 and 100 WPM.".into()); }
        }
        "entry_send_cw_text" => {
            draft(params, &["value"])?;
            let value = text_value(&params["value"], 80, false, "CW input")?;
            if !value.is_ascii() || value.chars().any(char::is_control) {
                return Err("CW input must use printable ASCII characters.".into());
            }
        }
        "assistance_query" => {
            draft(params, &["inputCallsign"])?;
            text_value(&params["inputCallsign"], 32, true, "assistance callsign")?;
        }
        "assistance_select" => {
            draft(params, &["kind", "candidateID"])?;
            enum_value(
                &params["kind"],
                &["scp", "history", "log", "cluster"],
                "assistance kind",
            )?;
            text_value(&params["candidateID"], 160, false, "assistance candidate")?;
        }
        "log_export_cabrillo" | "log_export_adif" | "log_export_edi" => {
            exact(params, &[], "contest export params")?
        }
        "log_recalculate" => {
            exact(params, &["expectedSessionRevision"], "log recalculation params")?;
            uint_value(&params["expectedSessionRevision"], MAX_SAFE_INTEGER, "session revision")?;
        }
        "score_configure" => {
            exact(params, &["service", "username", "password", "intervalMinutes", "enabled"], "score reporting params")?;
            enum_value(&params["service"], &["hamscore", "contestonlinescore"], "score reporting service")?;
            text_value(&params["username"], 128, true, "score reporting username")?;
            text_value(&params["password"], 8192, true, "score reporting password")?;
            let interval = uint_value(&params["intervalMinutes"], 60, "score reporting interval")?;
            if interval == 0 { return Err("The score reporting interval is invalid.".into()); }
            boolean(&params["enabled"], "score reporting enabled state")?;
        }
        "score_send_now" => exact(params, &[], "score reporting send params")?,
        "log_page" => {
            exact(params, &["offset"], "log page params")?;
            uint_value(&params["offset"], 1_000_000, "log offset")?;
        }
        "log_edit_begin" | "log_edit_cancel" => qso(params, &[])?,
        "log_edit_set_text" => {
            qso(params, &["field", "value"])?;
            enum_value(
                &params["field"],
                &[
                    "callsign",
                    "sentReport",
                    "receivedReport",
                    "timestamp",
                    "operator",
                    "correctionReason",
                    "deletionReason",
                ],
                "log edit field",
            )?;
            text_value(&params["value"], 1024, true, "log edit value")?;
        }
        "log_edit_set_exchange" => {
            qso(params, &["fieldID", "value"])?;
            text_value(&params["fieldID"], 64, false, "exchange field")?;
            text_value(&params["value"], 1024, true, "exchange value")?;
        }
        "log_edit_set_frequency_text" => {
            qso(params, &["value"])?;
            frequency_text(&params["value"])?;
        }
        "log_edit_set_band" => {
            qso(params, &["value"])?;
            text_value(&params["value"], 16, false, "log edit band")?;
        }
        "log_edit_save" | "log_edit_delete" => {
            qso(params, &["expectedSessionRevision"])?;
            uint_value(
                &params["expectedSessionRevision"],
                MAX_SAFE_INTEGER,
                "session revision",
            )?;
        }
        "log_edit_confirm_delete" => {
            qso(params, &["confirmed"])?;
            boolean(&params["confirmed"], "delete confirmation")?;
        }
        _ => return Err("The contest surface action is invalid.".into()),
    }
    Ok(())
}

fn draft(params: &Map<String, Value>, extras: &[&str]) -> Result<(), String> {
    let mut keys = vec!["draftID", "expectedDraftRevision"];
    keys.extend_from_slice(extras);
    exact(params, &keys, "draft action params")?;
    text_value(&params["draftID"], 160, false, "draft ID")?;
    uint_value(
        &params["expectedDraftRevision"],
        MAX_SAFE_INTEGER,
        "draft revision",
    )?;
    Ok(())
}

fn qso(params: &Map<String, Value>, extras: &[&str]) -> Result<(), String> {
    let mut keys = vec!["qsoID"];
    keys.extend_from_slice(extras);
    exact(params, &keys, "log action params")?;
    text_value(&params["qsoID"], 160, false, "QSO ID")?;
    Ok(())
}

fn frequency_text(value: &Value) -> Result<(), String> {
    text_value(value, 11, true, "frequency text").map(|_| ())
}

fn validate_projection(panel_id: &str, value: &Value) -> Result<(), String> {
    if serde_json::to_vec(value)
        .map_err(|_| "The contest surface projection is invalid.")?
        .len()
        > MAX_PROJECTION_BYTES
    {
        return Err("The contest surface projection is too large.".into());
    }
    let projection = object(value, "contest surface projection")?;
    let schema_version = projection
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or("The contest surface projection schema is invalid.")?;
    if projection.get("status").and_then(Value::as_str) == Some("unavailable") {
        if schema_version != 1 {
            return Err("The contest surface projection schema is invalid.".into());
        }
        return exact(
            projection,
            &["schemaVersion", "status"],
            "unavailable projection",
        );
    }
    if projection.get("status").and_then(Value::as_str) != Some("ready") {
        return Err("The contest surface projection status is invalid.".into());
    }
    match panel_id {
        "active-qso" | "qrz-details" if schema_version == 1 => validate_entry_projection(projection),
        "active-qso" | "qrz-details" if schema_version == 2 => validate_entry_projection_v2(projection),
        "callsign-intelligence" if schema_version == 1 => {
            validate_assistance_projection(projection)
        }
        "propagation" if schema_version == 1 => validate_statistics_projection(projection),
        "propagation" if schema_version == 2 => validate_statistics_projection_v2(projection),
        "propagation" if schema_version == 3 => validate_statistics_projection_v3(projection),
        "monitor" if schema_version == 1 => validate_rate_projection(projection),
        "score-reporting" if schema_version == 1 => validate_score_reporting_projection(projection),
        "awards" | "chaser-dx" if schema_version == 1 || schema_version == 4 => {
            validate_matrix_projection(projection)
        }
        "logbook" if schema_version == 1 => validate_logbook_projection(projection),
        "band-maps" | "dx-cluster" if schema_version == 2 => validate_spot_projection(projection),
        "station-control" if schema_version == 1 => validate_remote_vfo_projection(projection),
        "active-qso" | "qrz-details" | "callsign-intelligence" | "propagation" | "monitor"
        | "score-reporting" | "awards" | "chaser-dx" | "logbook" => {
            Err("The contest surface projection schema is invalid.".into())
        }
        _ => Err("That contest surface has no ready projection schema.".into()),
    }
}

fn validate_remote_vfo_projection(value: &Map<String, Value>) -> Result<(), String> {
    exact(value, &["schemaVersion", "status", "radioFrequencyHz", "contestFrequencyHz", "band", "mode", "busy"], "Remote VFO projection")?;
    nullable_uint(&value["radioFrequencyHz"], 100_000_000_000, "Remote VFO radio frequency")?;
    nullable_uint(&value["contestFrequencyHz"], 100_000_000_000, "Remote VFO contest frequency")?;
    text_value(&value["band"], 16, false, "Remote VFO band")?;
    text_value(&value["mode"], 16, false, "Remote VFO mode")?;
    boolean(&value["busy"], "Remote VFO busy state")
}

fn validate_spot_projection(value: &Map<String, Value>) -> Result<(), String> {
    exact(value, &["schemaVersion", "status", "draftID", "draftRevision", "radioFrequencyHz", "connectedClusters", "loadedSpots", "selectedSpotID", "configuredClusters", "connections", "markedOnly", "spots", "busy"], "spot projection")?;
    text_value(&value["draftID"], 160, false, "spot draft ID")?;
    uint_value(&value["draftRevision"], MAX_SAFE_INTEGER, "spot draft revision")?;
    nullable_uint(&value["radioFrequencyHz"], 100_000_000_000, "spot radio frequency")?;
    uint_value(&value["connectedClusters"], MAX_SAFE_INTEGER, "connected cluster count")?;
    uint_value(&value["loadedSpots"], MAX_SAFE_INTEGER, "loaded spot count")?;
    nullable_text(&value["selectedSpotID"], 128, "selected spot ID")?;
    for item in array(&value["configuredClusters"], 32, "configured clusters")? {
        let server = object(item, "configured cluster")?;
        exact(server, &["serverID", "serverName", "enabled"], "configured cluster")?;
        text_value(&server["serverID"], 128, false, "configured cluster ID")?;
        text_value(&server["serverName"], 160, false, "configured cluster name")?;
        boolean(&server["enabled"], "configured cluster enabled state")?;
    }
    for item in array(&value["connections"], 32, "cluster connections")? {
        let connection = object(item, "cluster connection")?;
        exact(connection, &["serverID", "serverName", "phase", "error"], "cluster connection")?;
        text_value(&connection["serverID"], 128, false, "cluster connection ID")?;
        text_value(&connection["serverName"], 160, false, "cluster connection name")?;
        text_value(&connection["phase"], 32, false, "cluster connection phase")?;
        nullable_text(&connection["error"], 512, "cluster connection error")?;
    }
    boolean(&value["markedOnly"], "marked-only filter")?;
    boolean(&value["busy"], "spot projection busy state")?;
    let mut ids = BTreeSet::new();
    for item in array(&value["spots"], 2_000, "contest spots")? {
        let spot = object(item, "contest spot")?;
        exact(spot, &["id", "receivedAt", "clusterName", "spotter", "spotterContinent", "frequencyKHz", "frequencyText", "callsign", "comment",
            "band", "mode", "country", "adif", "continent", "cqZone", "ituZone", "callStatus", "dxccStatus", "workedBefore", "specialTags", "score",
            "scoreReasons", "aggregateCount", "aggregateSpotters", "source", "statusHex", "bandHex", "modeHex", "marked"], "contest spot")?;
        let id = text_value(&spot["id"], 128, false, "spot ID")?;
        if !ids.insert(id) { return Err("Contest spot IDs must be unique.".into()); }
        for key in ["receivedAt", "frequencyKHz", "score"] {
            nullable_nonnegative_number(&spot[key], "spot number")?;
            if spot[key].is_null() { return Err("Contest spot numbers cannot be null.".into()); }
        }
        uint_value(&spot["aggregateCount"], MAX_SAFE_INTEGER, "aggregate spot count")?;
        for key in ["clusterName", "spotter", "frequencyText", "comment", "country", "continent", "callStatus", "dxccStatus", "source", "statusHex", "bandHex", "modeHex"] {
            text_value(&spot[key], 512, true, "spot text")?;
        }
        text_value(&spot["callsign"], 32, false, "spot callsign")?;
        text_value(&spot["band"], 16, false, "spot band")?;
        text_value(&spot["mode"], 16, false, "spot mode")?;
        nullable_text(&spot["spotterContinent"], 32, "spotter continent")?;
        for key in ["adif", "cqZone", "ituZone", "workedBefore"] { nullable_uint(&spot[key], MAX_SAFE_INTEGER, "spot integer")?; }
        string_array(&spot["specialTags"], 32, 64, "spot tags")?;
        string_array(&spot["scoreReasons"], 64, 160, "spot score reasons")?;
        string_array(&spot["aggregateSpotters"], 64, 64, "aggregate spotters")?;
        boolean(&spot["marked"], "spot marked state")?;
    }
    Ok(())
}

fn validate_entry_projection(value: &Map<String, Value>) -> Result<(), String> {
    let mut required = value.clone();
    let manual = required.remove("manual");
    exact(
        &required,
        &[
            "schemaVersion",
            "status",
            "session",
            "draft",
            "busy",
            "dirty",
            "uncertain",
        ],
        "entry projection",
    )?;
    if let Some(manual) = manual {
        validate_manual_context(&manual)?;
    }
    validate_entry_projection_body(value)
}

fn validate_entry_projection_v2(value: &Map<String, Value>) -> Result<(), String> {
    let mut required = value.clone();
    let manual = required.remove("manual");
    exact(
        &required,
        &[
            "schemaVersion",
            "status",
            "session",
            "draft",
            "descriptor",
            "operator",
            "busy",
            "dirty",
            "uncertain",
        ],
        "entry projection",
    )?;
    if let Some(manual) = manual {
        validate_manual_context(&manual)?;
    }
    validate_entry_projection_body(value)?;
    let sent_field_ids = validate_entry_descriptor(&value["descriptor"])?;
    validate_entry_operator(&value["operator"])?;
    let serial = object(&value["descriptor"]["serial"], "entry serial descriptor")?;
    if serial["reservedSerial"] != value["draft"]["reservedSerial"] {
        return Err("The entry serial descriptor does not match the current draft.".into());
    }
    if let Some(field_id) = serial["allocatedFieldID"].as_str() {
        if !sent_field_ids.contains(field_id) {
            return Err("The allocated serial field is not a sent exchange field.".into());
        }
    }
    Ok(())
}

fn validate_manual_context(value: &Value) -> Result<(), String> {
    let manual = object(value, "manual contest context")?;
    exact(
        manual,
        &[
            "operator",
            "cwSpeedWpm",
            "country",
            "cqZone",
            "ituZone",
            "headingDegrees",
            "longPathHeadingDegrees",
            "distanceKm",
            "qsos",
            "multipliers",
            "total",
        ],
        "manual contest context",
    )?;
    text_value(&manual["operator"], 32, true, "manual operator")?;
    nullable_text(&manual["country"], 160, "manual country")?;
    for key in [
        "cwSpeedWpm",
        "cqZone",
        "ituZone",
        "headingDegrees",
        "longPathHeadingDegrees",
        "distanceKm",
    ] {
        nullable_nonnegative_number(&manual[key], "manual numeric context")?;
    }
    for key in ["qsos", "multipliers", "total"] {
        uint_value(&manual[key], MAX_SAFE_INTEGER, "manual contest total")?;
    }
    Ok(())
}

fn validate_entry_projection_body(value: &Map<String, Value>) -> Result<(), String> {
    let session = object(&value["session"], "entry session")?;
    exact(session, &["name", "ruleName", "mode"], "entry session")?;
    for key in ["name", "ruleName"] {
        text_value(&session[key], 160, false, "entry session text")?;
    }
    text_value(&session["mode"], 16, false, "entry mode")?;
    let draft = object(&value["draft"], "entry draft")?;
    exact(
        draft,
        &[
            "draftID",
            "revision",
            "callsign",
            "sentReport",
            "receivedReport",
            "receivedFields",
            "frequencyHz",
            "frequencyText",
            "frequencyError",
            "band",
            "mode",
            "dupe",
            "validation",
            "reservedSerial",
        ],
        "entry draft",
    )?;
    text_value(&draft["draftID"], 160, false, "draft ID")?;
    uint_value(&draft["revision"], MAX_SAFE_INTEGER, "draft revision")?;
    for key in ["callsign", "sentReport", "receivedReport"] {
        text_value(&draft[key], 160, true, "entry text")?;
    }
    nullable_uint(&draft["frequencyHz"], 100_000_000_000, "entry frequency")?;
    text_value(&draft["frequencyText"], 11, true, "entry frequency text")?;
    text_value(&draft["frequencyError"], 512, true, "entry frequency error")?;
    text_value(&draft["band"], 16, true, "entry band")?;
    text_value(&draft["mode"], 16, true, "entry mode")?;
    fields(&draft["receivedFields"], true)?;
    let dupe = object(&draft["dupe"], "dupe")?;
    exact(dupe, &["state", "reason"], "dupe")?;
    enum_value(
        &dupe["state"],
        &["unchecked", "clear", "duplicate"],
        "dupe state",
    )?;
    text_value(&dupe["reason"], 1024, true, "dupe reason")?;
    let validation = object(&draft["validation"], "entry validation")?;
    exact(validation, &["errors", "warnings"], "entry validation")?;
    string_array(&validation["errors"], 32, 1024, "entry errors")?;
    string_array(&validation["warnings"], 32, 1024, "entry warnings")?;
    nullable_uint(
        &draft["reservedSerial"],
        MAX_SAFE_INTEGER,
        "reserved serial",
    )?;
    for key in ["busy", "dirty", "uncertain"] {
        boolean(&value[key], key)?;
    }
    Ok(())
}

fn validate_entry_descriptor(value: &Value) -> Result<BTreeSet<String>, String> {
    let descriptor = object(value, "entry descriptor")?;
    let mut required = descriptor.clone();
    let reports_visible = required.remove("reportsVisible");
    let report_fields = required.remove("reportFields");
    let allow_duplicate_commit = required.remove("allowDuplicateCommit");
    let automatic_serial = required.remove("automaticSerial");
    let advance_on_space = required.remove("advanceOnSpace");
    let key_bindings = required.remove("keyBindings");
    exact(
        &required,
        &["bands", "modes", "sentFields", "serial"],
        "entry descriptor",
    )?;
    if let Some(reports_visible) = reports_visible {
        boolean(&reports_visible, "entry report visibility")?;
    }
    if let Some(allow_duplicate_commit) = allow_duplicate_commit {
        boolean(&allow_duplicate_commit, "duplicate commit allowance")?;
    }
    if let Some(automatic_serial) = automatic_serial {
        boolean(&automatic_serial, "automatic serial allocation")?;
    }
    if let Some(advance_on_space) = advance_on_space {
        unique_text_array(
            &advance_on_space,
            5,
            16,
            Some(&["callsign", "sent", "receive", "other_1", "other_2"]),
            "space-advance fields",
        )?;
    }
    unique_text_array(&descriptor["bands"], 32, 16, None, "entry bands")?;
    unique_text_array(
        &descriptor["modes"],
        5,
        16,
        Some(&["CW", "SSB", "RTTY", "AM", "FM"]),
        "entry modes",
    )?;
    let empty_bindings = Vec::new();
    let key_bindings = match key_bindings.as_ref() {
        Some(value) => array(value, 32, "entry key bindings")?,
        None => &empty_bindings,
    };
    let mut bindings = BTreeSet::new();
    for binding in key_bindings {
        let binding = object(binding, "entry key binding")?;
        exact(binding, &["context", "key", "action"], "entry key binding")?;
        let context = enum_value(&binding["context"], &["*", "Callsign", "Report", "Exchange", "Other 1", "Other 2"],
            "entry key context")?;
        let key = text_value(&binding["key"], 64, false, "entry key")?;
        if !key.is_ascii() || key.chars().any(char::is_whitespace) {
            return Err("The entry key binding is not canonical.".into());
        }
        enum_value(&binding["action"], &["TOGGLE_RUN", "SET_RUN", "SET_S_AND_P", "LOG_NOW", "CLEAR_INPUTS",
            "PREV_SPOT", "NEXT_SPOT", "FOCUS_CALLSIGN", "FOCUS_NEXT", "FOCUS_PREVIOUS", "CW_SPEED_UP", "CW_SPEED_DOWN",
            "TOGGLE_CW_INPUT", "RST_INCR", "RST_DECR", "EXCH_INCR", "EXCH_DECR",
            "SEND_F1", "SEND_F2", "SEND_F3", "SEND_F4", "SEND_F5", "SEND_F6", "SEND_F7", "SEND_F8", "SEND_F9",
            "SEND_F10", "SEND_F11", "SEND_F12"],
            "entry key action")?;
        if !bindings.insert(format!("{context}:{key}")) {
            return Err("The entry key bindings are not unique.".into());
        }
    }
    let mut field_ids = descriptor_fields(&descriptor["sentFields"], "sent exchange fields")?;
    if let Some(report_fields) = report_fields {
        for field_id in descriptor_fields(&report_fields, "report fields")? {
            if !field_ids.insert(field_id) {
                return Err("The entry field IDs are not unique.".into());
            }
        }
    }
    let serial = object(&descriptor["serial"], "entry serial descriptor")?;
    exact(
        serial,
        &["requirement", "allocatedFieldID", "reservedSerial"],
        "entry serial descriptor",
    )?;
    let requirement = enum_value(
        &serial["requirement"],
        &["none", "requiredForCommit"],
        "serial requirement",
    )?;
    match requirement {
        "none" if !serial["allocatedFieldID"].is_null() || !serial["reservedSerial"].is_null() => {
            return Err("A contest without serial allocation cannot publish a serial field.".into())
        }
        "requiredForCommit" => {
            if !serial["allocatedFieldID"].is_null() {
                text_value(
                    &serial["allocatedFieldID"],
                    64,
                    false,
                    "allocated serial field",
                )?;
            }
            nullable_uint(
                &serial["reservedSerial"],
                MAX_SAFE_INTEGER,
                "reserved serial",
            )?;
        }
        _ => {}
    }
    Ok(field_ids)
}

fn validate_entry_operator(value: &Value) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let operator = object(value, "entry operator")?;
    let mut fields = vec![
        "output",
        "armed",
        "style",
        "status",
        "pending",
        "focusedField",
        "tabNext",
        "tabPrevious",
        "functionKeys",
        "readiness",
        "trace",
    ];
    if operator.contains_key("autoCQ") {
        fields.push("autoCQ");
    }
    exact(
        operator,
        &fields,
        "entry operator",
    )?;
    enum_value(
        &operator["output"],
        &["simulation-only", "xlog-native", "test-simulation"],
        "operator output",
    )?;
    boolean(&operator["armed"], "operator armed state")?;
    enum_value(
        &operator["style"],
        &["run", "search-and-pounce"],
        "operator style",
    )?;
    enum_value(
        &operator["status"],
        &["disarmed", "armed", "waiting", "uncertain"],
        "operator status",
    )?;
    if !operator["pending"].is_null() {
        enum_value(
            &operator["pending"],
            &["reserve-serial", "send", "commit"],
            "operator pending state",
        )?;
    }
    if !operator["focusedField"].is_null() {
        enum_value(
            &operator["focusedField"],
            &["callsign", "sent", "receive", "other_1", "other_2"],
            "operator focused field",
        )?;
    }
    validate_tab_map(&operator["tabNext"])?;
    validate_tab_map(&operator["tabPrevious"])?;
    let mut keys = BTreeSet::new();
    for mapping in array(&operator["functionKeys"], 12, "operator function keys")? {
        let mapping = object(mapping, "operator function key")?;
        exact(mapping, &["key", "macro"], "operator function key")?;
        let key = enum_value(
            &mapping["key"],
            &[
                "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
            ],
            "operator function key",
        )?;
        if !keys.insert(key) {
            return Err("The operator function keys are not unique.".into());
        }
        text_value(&mapping["macro"], 160, true, "operator macro label")?;
    }
    let readiness = object(&operator["readiness"], "operator readiness")?;
    exact(
        readiness,
        &[
            "canSendCQ",
            "canSendCall",
            "canSendDuplicate",
            "canReserveCall",
            "canReserveCommit",
            "canCommit",
        ],
        "operator readiness",
    )?;
    for key in [
        "canSendCQ",
        "canSendCall",
        "canSendDuplicate",
        "canReserveCall",
        "canReserveCommit",
        "canCommit",
    ] {
        boolean(&readiness[key], "operator readiness")?;
    }
    if let Some(auto_cq) = operator.get("autoCQ") {
        let auto_cq = object(auto_cq, "operator Auto CQ")?;
        exact(
            auto_cq,
            &["active", "delaySeconds", "remainingMs"],
            "operator Auto CQ",
        )?;
        boolean(&auto_cq["active"], "operator Auto CQ active state")?;
        let delay = uint_value(&auto_cq["delaySeconds"], 3600, "operator Auto CQ delay")?;
        if delay == 0 {
            return Err("The operator Auto CQ delay is invalid.".into());
        }
        nullable_uint(
            &auto_cq["remainingMs"],
            3_600_000,
            "operator Auto CQ remaining time",
        )?;
    }
    for trace in array(&operator["trace"], 24, "operator trace")? {
        let trace = object(trace, "operator trace")?;
        exact(
            trace,
            &["operationID", "mode", "macro", "text", "status"],
            "operator trace",
        )?;
        text_value(&trace["operationID"], 160, false, "operator operation ID")?;
        enum_value(
            &trace["mode"],
            &["CW", "SSB", "RTTY", "AM", "FM"],
            "operator mode",
        )?;
        contest_macro(&trace["macro"])?;
        text_value(&trace["text"], 1024, true, "operator trace text")?;
        enum_value(
            &trace["status"],
            &["pending", "confirmed", "failed", "stopped"],
            "operator trace status",
        )?;
    }
    Ok(())
}

fn validate_tab_map(value: &Value) -> Result<(), String> {
    let mapping = object(value, "operator tab map")?;
    if mapping.len() > 5 {
        return Err("The operator tab map is invalid.".into());
    }
    const FIELDS: &[&str] = &["callsign", "sent", "receive", "other_1", "other_2"];
    for (from, to) in mapping {
        if !FIELDS.contains(&from.as_str()) {
            return Err("The operator tab map is invalid.".into());
        }
        enum_value(to, FIELDS, "operator tab destination")?;
    }
    Ok(())
}

fn contest_macro(value: &Value) -> Result<(), String> {
    // The Python Not1MM host exposes the actual operator-visible macro label
    // (for example `Exch`, `73`, `NR??`, or a user-edited label), not the
    // legacy seven-token Swift pilot enum.  This trace is presentation-only;
    // execution remains fenced by the admitted F-key action and its hashes.
    text_value(value, 160, false, "contest macro").map(|_| ())
}

fn validate_assistance_projection(value: &Map<String, Value>) -> Result<(), String> {
    let mut required = value.clone();
    for key in ["loggedCalls", "clusterCalls"] {
        if let Some(calls) = required.remove(key) {
            string_array(&calls, 500, 32, "partial calls")?;
        }
    }
    for key in ["loggedCandidates", "clusterCandidates"] {
        if let Some(candidates) = required.remove(key) {
            let mut ids = BTreeSet::new();
            for candidate in array(&candidates, 500, "partial candidates")? {
                let candidate = object(candidate, "partial candidate")?;
                exact(candidate, &["candidateID", "callsign"], "partial candidate")?;
                let id = text_value(&candidate["candidateID"], 160, false, "candidate ID")?;
                let call = text_value(&candidate["callsign"], 32, false, "candidate callsign")?;
                if !ids.insert(id)
                    || !call.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'/'
                    })
                {
                    return Err("The partial candidate is invalid.".into());
                }
            }
        }
    }
    exact(
        &required,
        &[
            "schemaVersion",
            "status",
            "draftID",
            "draftRevision",
            "inputCallsign",
            "scp",
            "history",
            "busy",
        ],
        "assistance projection",
    )?;
    text_value(&value["draftID"], 160, false, "draft ID")?;
    uint_value(&value["draftRevision"], MAX_SAFE_INTEGER, "draft revision")?;
    text_value(&value["inputCallsign"], 32, true, "input callsign")?;
    boolean(&value["busy"], "assistance busy")?;
    let scp = object(&value["scp"], "SCP projection")?;
    exact(scp, &["source", "candidates"], "SCP projection")?;
    nullable_text(&scp["source"], 160, "SCP source")?;
    let candidates = array(&scp["candidates"], 200, "SCP candidates")?;
    for candidate in candidates {
        let candidate = object(candidate, "SCP candidate")?;
        exact(candidate, &["candidateID", "callsign"], "SCP candidate")?;
        text_value(&candidate["candidateID"], 160, false, "SCP candidate ID")?;
        text_value(&candidate["callsign"], 32, false, "SCP callsign")?;
    }
    let history = object(&value["history"], "history projection")?;
    exact(history, &["source", "rows"], "history projection")?;
    nullable_text(&history["source"], 160, "history source")?;
    let rows = array(&history["rows"], 200, "history rows")?;
    for row in rows {
        let row = object(row, "history row")?;
        exact(row, &["candidateID", "callsign", "fields"], "history row")?;
        text_value(&row["candidateID"], 160, false, "history candidate ID")?;
        text_value(&row["callsign"], 32, false, "history callsign")?;
        fields(&row["fields"], false)?;
    }
    Ok(())
}

fn validate_statistics_projection(value: &Map<String, Value>) -> Result<(), String> {
    exact(
        value,
        &["schemaVersion", "status", "score", "busy"],
        "statistics projection",
    )?;
    boolean(&value["busy"], "statistics busy")?;
    validate_statistics_score(&value["score"])
}

fn validate_statistics_score(value: &Value) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let score = object(value, "contest score")?;
    exact(
        score,
        &[
            "qsos",
            "points",
            "multipliers",
            "claimedScore",
            "multiplierLabels",
            "multiplierDisplayLabels",
            "sourceVerification",
        ],
        "contest score",
    )?;
    for key in ["qsos", "points", "multipliers", "claimedScore"] {
        uint_value(&score[key], MAX_SAFE_INTEGER, "contest score value")?;
    }
    string_array(&score["multiplierLabels"], 10_000, 160, "multiplier labels")?;
    string_array(
        &score["multiplierDisplayLabels"],
        10_000,
        160,
        "multiplier display labels",
    )?;
    enum_value(
        &score["sourceVerification"],
        &["verified", "provisional", "unverified"],
        "score source verification",
    )?;
    Ok(())
}

fn validate_score_reporting_projection(value: &Map<String, Value>) -> Result<(), String> {
    exact(
        value,
        &[
            "schemaVersion",
            "status",
            "score",
            "intervalMinutes",
            "reportingEnabled",
            "availability",
            "reason",
            "service",
            "username",
            "credentialSaved",
            "reportState",
            "lastOutcome",
            "nextAttempt",
            "services",
            "busy",
        ],
        "score reporting projection",
    )?;
    validate_statistics_score(&value["score"])?;
    let interval = uint_value(
        &value["intervalMinutes"],
        1_440,
        "score reporting interval",
    )?;
    if interval == 0 {
        return Err("The score reporting interval is invalid.".into());
    }
    boolean(&value["reportingEnabled"], "score reporting enabled state")?;
    enum_value(
        &value["availability"],
        &["available", "unavailable"],
        "score reporting availability",
    )?;
    text_value(&value["reason"], 512, false, "score reporting reason")?;
    enum_value(&value["service"], &["hamscore", "contestonlinescore"], "score reporting service")?;
    text_value(&value["username"], 128, true, "score reporting username")?;
    boolean(&value["credentialSaved"], "score reporting credential state")?;
    enum_value(&value["reportState"], &["disabled", "scheduled", "posting", "sent", "failed", "paused"], "score reporting state")?;
    text_value(&value["lastOutcome"], 512, false, "score reporting outcome")?;
    nullable_text(&value["nextAttempt"], 64, "score reporting next attempt")?;
    let services = array(&value["services"], 3, "score reporting services")?;
    if services.len() != 3 {
        return Err("The score reporting services are incomplete.".into());
    }
    for service in services {
        let service = object(service, "score reporting service")?;
        exact(
            service,
            &["id", "name", "url", "transportSecurity"],
            "score reporting service",
        )?;
        enum_value(
            &service["id"],
            &["hamscore", "contestonlinescore", "contest-run"],
            "score reporting service",
        )?;
        text_value(&service["name"], 80, false, "score reporting service name")?;
        text_value(&service["url"], 256, false, "score reporting service URL")?;
        enum_value(
            &service["transportSecurity"],
            &["https", "legacy-http"],
            "score reporting transport security",
        )?;
    }
    boolean(&value["busy"], "score reporting busy state")
}

fn validate_rate_projection(value: &Map<String, Value>) -> Result<(), String> {
    if value.contains_key("lastHourQsoPerHour") {
        return validate_native_rate_projection(value);
    }
    exact(
        value,
        &[
            "schemaVersion",
            "status",
            "sessionRevision",
            "asOfUTC",
            "fullLogQSOs",
            "loggedQSOs",
            "acceptedQSOs",
            "duplicateQSOs",
            "invalidQSOs",
            "currentHourQSOs",
            "operatorStyles",
            "trailing60Minutes",
            "latest10",
            "latest100",
            "busy",
        ],
        "rate projection",
    )?;
    validate_rate_fields(value)?;
    boolean(&value["busy"], "rate busy")
}

fn validate_native_rate_projection(value: &Map<String, Value>) -> Result<(), String> {
    exact(
        value,
        &[
            "schemaVersion",
            "status",
            "lastHourQsoPerHour",
            "last10QsoPerHour",
            "last100QsoPerHour",
            "sinceHourUTC",
            "sinceHourQso",
            "runQso",
            "searchAndPounceQso",
            "hourRunQso",
            "hourSearchAndPounceQso",
            "busy",
        ],
        "native rate projection",
    )?;
    for key in [
        "lastHourQsoPerHour",
        "last10QsoPerHour",
        "last100QsoPerHour",
    ] {
        nullable_nonnegative_number(&value[key], "native contest rate")?;
    }
    uint_value(&value["sinceHourUTC"], 23, "native contest UTC hour")?;
    for key in [
        "sinceHourQso",
        "runQso",
        "searchAndPounceQso",
        "hourRunQso",
        "hourSearchAndPounceQso",
    ] {
        uint_value(&value[key], MAX_SAFE_INTEGER, "native contest count")?;
    }
    boolean(&value["busy"], "native rate busy")
}

fn validate_matrix_projection(value: &Map<String, Value>) -> Result<(), String> {
    let version = value["schemaVersion"].as_u64();
    let keys = if version == Some(4) {
        vec![
            "schemaVersion",
            "status",
            "title",
            "tracker",
            "zoneSystem",
            "current",
            "bands",
            "rows",
            "total",
            "busy",
        ]
    } else {
        vec!["schemaVersion", "status", "title", "bands", "rows", "total", "busy"]
    };
    exact(
        value,
        &keys,
        "multiplier matrix projection",
    )?;
    text_value(&value["title"], 160, false, "multiplier matrix title")?;
    if version == Some(4) {
        let tracker = text_value(&value["tracker"], 8, false, "multiplier matrix tracker")?;
        if !matches!(tracker, "dxcc" | "zone") {
            return Err("The multiplier matrix tracker is invalid.".into());
        }
        match tracker {
            "dxcc" if !value["zoneSystem"].is_null() => {
                return Err("A DXCC matrix cannot select a zone system.".into())
            }
            "zone" => {
                let zone_system = text_value(
                    &value["zoneSystem"],
                    3,
                    false,
                    "multiplier matrix zone system",
                )?;
                if !matches!(zone_system, "cq" | "itu") {
                    return Err("The multiplier matrix zone system is invalid.".into());
                }
            }
            _ => {}
        }
        let current = object(&value["current"], "multiplier matrix current target")?;
        exact(
            current,
            &["dxcc", "cqZone", "ituZone"],
            "multiplier matrix current target",
        )?;
        nullable_text(&current["dxcc"], 160, "multiplier matrix current DXCC")?;
        nullable_uint(&current["cqZone"], 90, "multiplier matrix current CQ zone")?;
        nullable_uint(&current["ituZone"], 90, "multiplier matrix current ITU zone")?;
    }
    let bands = array(&value["bands"], 32, "multiplier matrix bands")?;
    let mut band_names = BTreeSet::new();
    for band in bands {
        let band = text_value(band, 16, false, "multiplier matrix band")?;
        if !band_names.insert(band) {
            return Err("The multiplier matrix bands are not unique.".into());
        }
    }
    let mut labels = BTreeSet::new();
    for row in array(&value["rows"], 10_000, "multiplier matrix rows")? {
        let row = object(row, "multiplier matrix row")?;
        exact(row, &["label", "counts", "total"], "multiplier matrix row")?;
        let label = text_value(&row["label"], 160, false, "multiplier matrix label")?;
        if !labels.insert(label) {
            return Err("The multiplier matrix labels are not unique.".into());
        }
        let counts = object(&row["counts"], "multiplier matrix counts")?;
        if counts.len() != band_names.len() || !band_names.iter().all(|band| counts.contains_key(*band)) {
            return Err("The multiplier matrix counts do not match its bands.".into());
        }
        for count in counts.values() {
            uint_value(count, MAX_SAFE_INTEGER, "multiplier matrix count")?;
        }
        uint_value(&row["total"], MAX_SAFE_INTEGER, "multiplier matrix total")?;
    }
    uint_value(&value["total"], MAX_SAFE_INTEGER, "multiplier matrix total")?;
    boolean(&value["busy"], "multiplier matrix busy")
}

fn validate_statistics_projection_v2(value: &Map<String, Value>) -> Result<(), String> {
    exact(
        value,
        &[
            "schemaVersion",
            "status",
            "score",
            "busy",
            "sessionRevision",
            "asOfUTC",
            "fullLogQSOs",
            "loggedQSOs",
            "acceptedQSOs",
            "duplicateQSOs",
            "invalidQSOs",
            "bands",
            "total",
        ],
        "statistics projection",
    )?;
    boolean(&value["busy"], "statistics busy")?;
    validate_statistics_score(&value["score"])?;
    let counts = validate_summary_counts(value)?;
    let bands = array(&value["bands"], 64, "statistics bands")?;
    let mut names = BTreeSet::new();
    let mut sums = [0_u64; 4];
    let mut points = 0_i64;
    for band in bands {
        let row = validate_band_statistics(band, false)?;
        if !names.insert(row.0) {
            return Err("The statistics bands are not unique.".into());
        }
        for (sum, value) in sums.iter_mut().zip(row.1) {
            *sum = sum
                .checked_add(value)
                .ok_or("The statistics band totals overflow.")?;
        }
        points = points
            .checked_add(row.2)
            .ok_or("The statistics credited points overflow.")?;
    }
    let total = validate_band_statistics(&value["total"], true)?;
    if sums[0] != total.1[0]
        || sums[1] != total.1[1]
        || sums[3] != total.1[3]
        || points != total.2
        || total.1[0] != counts.1
        || total.1[1] != counts.2
    {
        return Err("The statistics band totals do not match the summary.".into());
    }
    if let Some(score) = value["score"].as_object() {
        if uint_value(&score["qsos"], MAX_SAFE_INTEGER, "contest score QSOs")? != counts.0 {
            return Err("The contest score does not match the full log.".into());
        }
    }
    Ok(())
}

fn validate_statistics_projection_v3(value: &Map<String, Value>) -> Result<(), String> {
    exact(
        value,
        &["schemaVersion", "status", "score", "rows", "total", "busy"],
        "statistics projection",
    )?;
    boolean(&value["busy"], "statistics busy")?;
    validate_statistics_score_v3(&value["score"])?;
    let rows = array(&value["rows"], 64, "statistics rows")?;
    let mut bands = BTreeSet::new();
    let mut sums = [0_u64; 6];
    let mut points = 0_i64;
    for row in rows {
        let row = validate_statistics_row_v3(row, false)?;
        if !bands.insert(row.0) {
            return Err("The statistics bands are not unique.".into());
        }
        for (sum, value) in sums.iter_mut().zip(row.1) {
            *sum = sum
                .checked_add(value)
                .ok_or("The statistics band totals overflow.")?;
        }
        points = points
            .checked_add(row.2)
            .ok_or("The statistics points overflow.")?;
    }
    let total = validate_statistics_row_v3(&value["total"], true)?;
    if sums[0] != total.1[0]
        || sums[2] != total.1[2]
        || sums[3] != total.1[3]
        || sums[4] != total.1[4]
        || sums[5] != total.1[5]
        || total.1[1] > sums[1]
        || total.1[1] > total.1[0]
        || points != total.2
    {
        return Err("The statistics totals do not match the band rows.".into());
    }
    let score = object(&value["score"], "contest score")?;
    if uint_value(&score["qsos"], MAX_SAFE_INTEGER, "contest score QSOs")? != total.1[0]
        || integer_value(&score["points"], "contest score points")? != total.2
    {
        return Err("The contest score does not match the statistics total.".into());
    }
    Ok(())
}

fn validate_statistics_score_v3(value: &Value) -> Result<(), String> {
    let score = object(value, "contest score")?;
    exact(
        score,
        &[
            "qsos",
            "points",
            "multipliers",
            "claimedScore",
            "multiplierLabels",
            "multiplierDisplayLabels",
            "sourceVerification",
        ],
        "contest score",
    )?;
    uint_value(&score["qsos"], MAX_SAFE_INTEGER, "contest score QSOs")?;
    integer_value(&score["points"], "contest score points")?;
    for key in ["multipliers", "claimedScore"] {
        uint_value(&score[key], MAX_SAFE_INTEGER, "contest score value")?;
    }
    string_array(&score["multiplierLabels"], 10_000, 160, "multiplier labels")?;
    string_array(
        &score["multiplierDisplayLabels"],
        10_000,
        160,
        "multiplier display labels",
    )?;
    enum_value(
        &score["sourceVerification"],
        &["verified", "provisional", "unverified"],
        "score source verification",
    )?;
    Ok(())
}

fn validate_statistics_row_v3(value: &Value, total: bool) -> Result<(String, [u64; 6], i64), String> {
    let row = object(value, "statistics row")?;
    exact(
        row,
        &["band", "qsos", "calls", "cw", "phone", "digital", "wpx", "points"],
        "statistics row",
    )?;
    let band = text_value(&row["band"], 16, false, "statistics band")?;
    if (band == "TOTAL") != total {
        return Err("The statistics band identifier is invalid.".into());
    }
    let counts = ["qsos", "calls", "cw", "phone", "digital", "wpx"]
        .map(|key| uint_value(&row[key], MAX_SAFE_INTEGER, "statistics count"))
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let counts: [u64; 6] = counts
        .try_into()
        .map_err(|_| String::from("The statistics row is invalid."))?;
    let classified = counts[2]
        .checked_add(counts[3])
        .and_then(|value| value.checked_add(counts[4]))
        .ok_or("The statistics mode counts overflow.")?;
    if counts[1] > counts[0] || counts[5] > counts[0] || classified > counts[0] {
        return Err("The statistics row counts exceed its QSOs.".into());
    }
    Ok((band.to_owned(), counts, integer_value(&row["points"], "statistics points")?))
}

fn validate_rate_fields(value: &Map<String, Value>) -> Result<(), String> {
    let counts = validate_summary_counts(value)?;
    if counts.5 > counts.1 {
        return Err("The current-hour count exceeds the visible log.".into());
    }
    let styles = object(&value["operatorStyles"], "operator styles")?;
    exact(styles, &["total", "currentHour"], "operator styles")?;
    if validate_operator_styles(&styles["total"])? != counts.1
        || validate_operator_styles(&styles["currentHour"])? != counts.5
    {
        return Err("The operator-style counts do not match the log.".into());
    }
    let trailing = validate_rate_metric(&value["trailing60Minutes"], None)?;
    if trailing > counts.1 {
        return Err("The trailing rate count exceeds the visible log.".into());
    }
    validate_nullable_rate_metric(&value["latest10"], 10, counts.1)?;
    validate_nullable_rate_metric(&value["latest100"], 100, counts.1)?;
    Ok(())
}

fn validate_summary_counts(
    value: &Map<String, Value>,
) -> Result<(u64, u64, u64, u64, u64, u64), String> {
    uint_value(
        &value["sessionRevision"],
        MAX_SAFE_INTEGER,
        "session revision",
    )?;
    canonical_timestamp(&value["asOfUTC"], "statistics timestamp")?;
    let full = uint_value(&value["fullLogQSOs"], MAX_SAFE_INTEGER, "full log QSOs")?;
    let logged = uint_value(&value["loggedQSOs"], MAX_SAFE_INTEGER, "logged QSOs")?;
    let accepted = uint_value(&value["acceptedQSOs"], MAX_SAFE_INTEGER, "accepted QSOs")?;
    let duplicate = uint_value(&value["duplicateQSOs"], MAX_SAFE_INTEGER, "duplicate QSOs")?;
    let invalid = uint_value(&value["invalidQSOs"], MAX_SAFE_INTEGER, "invalid QSOs")?;
    let current = value
        .get("currentHourQSOs")
        .map(|item| uint_value(item, MAX_SAFE_INTEGER, "current-hour QSOs"))
        .transpose()?
        .unwrap_or(0);
    if full < logged
        || accepted
            .checked_add(duplicate)
            .and_then(|sum| sum.checked_add(invalid))
            != Some(logged)
    {
        return Err("The statistics QSO counts are inconsistent.".into());
    }
    Ok((full, logged, accepted, duplicate, invalid, current))
}

fn validate_operator_styles(value: &Value) -> Result<u64, String> {
    let value = object(value, "operator style counts")?;
    exact(
        value,
        &["run", "searchAndPounce", "unknown"],
        "operator style counts",
    )?;
    ["run", "searchAndPounce", "unknown"]
        .into_iter()
        .try_fold(0_u64, |sum, key| {
            sum.checked_add(uint_value(
                &value[key],
                MAX_SAFE_INTEGER,
                "operator style count",
            )?)
            .ok_or_else(|| String::from("The operator style counts overflow."))
        })
}

fn validate_nullable_rate_metric(value: &Value, expected: u64, logged: u64) -> Result<(), String> {
    if value.is_null() {
        if logged >= expected {
            return Err("A complete rate sample is missing.".into());
        }
        return Ok(());
    }
    if logged < expected || validate_rate_metric(value, Some(expected))? != expected {
        return Err("The rate sample count is invalid.".into());
    }
    Ok(())
}

fn validate_rate_metric(value: &Value, expected: Option<u64>) -> Result<u64, String> {
    let value = object(value, "rate metric")?;
    exact(
        value,
        &["qsoCount", "spanSeconds", "qsosPerHour"],
        "rate metric",
    )?;
    let count = uint_value(&value["qsoCount"], MAX_SAFE_INTEGER, "rate QSO count")?;
    if expected.is_some_and(|expected| count != expected) {
        return Err("The rate sample count is invalid.".into());
    }
    nullable_nonnegative_number(&value["spanSeconds"], "rate span")?;
    nullable_nonnegative_number(&value["qsosPerHour"], "rate value")?;
    Ok(count)
}

fn validate_band_statistics(value: &Value, total: bool) -> Result<(String, [u64; 4], i64), String> {
    let value = object(value, "band statistics")?;
    exact(
        value,
        &[
            "band",
            "loggedQSOs",
            "acceptedQSOs",
            "distinctCallsigns",
            "modes",
            "distinctWPXPrefixes",
            "creditedPoints",
        ],
        "band statistics",
    )?;
    let band = text_value(&value["band"], 16, false, "statistics band")?;
    if (band == "total") != total {
        return Err("The statistics band identifier is invalid.".into());
    }
    let logged = uint_value(&value["loggedQSOs"], MAX_SAFE_INTEGER, "band logged QSOs")?;
    let accepted = uint_value(
        &value["acceptedQSOs"],
        MAX_SAFE_INTEGER,
        "band accepted QSOs",
    )?;
    let distinct = uint_value(
        &value["distinctCallsigns"],
        MAX_SAFE_INTEGER,
        "distinct callsigns",
    )?;
    let prefixes = uint_value(
        &value["distinctWPXPrefixes"],
        MAX_SAFE_INTEGER,
        "distinct WPX prefixes",
    )?;
    if accepted > logged || distinct > logged || prefixes > logged {
        return Err("The band statistics exceed the logged count.".into());
    }
    let modes = object(&value["modes"], "mode statistics")?;
    exact(
        modes,
        &["cw", "phone", "digital", "other"],
        "mode statistics",
    )?;
    let mode_total =
        ["cw", "phone", "digital", "other"]
            .into_iter()
            .try_fold(0_u64, |sum, key| {
                sum.checked_add(uint_value(&modes[key], MAX_SAFE_INTEGER, "mode count")?)
            .ok_or_else(|| String::from("The mode counts overflow."))
            })?;
    if mode_total != logged {
        return Err("The mode counts do not match the band log.".into());
    }
    Ok((
        band.into(),
        [logged, accepted, distinct, prefixes],
        integer_value(&value["creditedPoints"], "credited points")?,
    ))
}

fn validate_logbook_projection(value: &Map<String, Value>) -> Result<(), String> {
    let mut required = value.clone();
    let can_export_adif = required.remove("canExportAdif");
    let can_export_edi = required.remove("canExportEdi");
    let manual_rows = required.remove("manualRows");
    let partial_rows = required.remove("partialRows");
    let layout = required.remove("exchangeLayout");
    let plugin_columns = required.remove("pluginColumns");
    let plugin_rows = required.remove("pluginRows");
    let plugin_partial_rows = required.remove("pluginPartialRows");
    let plugin_layout = layout.is_some();
    let plugin_row_ids = if let Some(layout) = layout {
        enum_value(&layout, &["plugin"], "log exchange layout")?;
        if manual_rows.is_some() || partial_rows.is_some() {
            return Err("The plugin log projection cannot include manual rows.".into());
        }
        let columns = validate_plugin_columns(plugin_columns.as_ref().ok_or(
            "The plugin log projection is missing its columns.",
        )?)?;
        let rows = validate_plugin_rows(
            plugin_rows
                .as_ref()
                .ok_or("The plugin log projection is missing its rows.")?,
            columns,
            20,
        )?;
        validate_plugin_rows(
            plugin_partial_rows
                .as_ref()
                .ok_or("The plugin log projection is missing its partial rows.")?,
            columns,
            500,
        )?;
        Some(rows)
    } else {
        if plugin_columns.is_some() || plugin_rows.is_some() || plugin_partial_rows.is_some() {
            return Err("The manual log projection cannot include plugin rows.".into());
        }
        if let Some(rows) = manual_rows {
            validate_manual_rows(&rows)?;
        }
        if let Some(rows) = partial_rows {
            validate_manual_rows(&rows)?;
        }
        None
    };
    exact(
        &required,
        &[
            "schemaVersion",
            "status",
            "sessionRevision",
            "canExportCabrillo",
            "page",
            "editing",
            "busy",
        ],
        "logbook projection",
    )?;
    uint_value(
        &value["sessionRevision"],
        MAX_SAFE_INTEGER,
        "session revision",
    )?;
    boolean(&value["canExportCabrillo"], "Cabrillo export availability")?;
    if let Some(can_export_adif) = can_export_adif {
        boolean(&can_export_adif, "ADIF export availability")?;
    }
    if let Some(can_export_edi) = can_export_edi {
        boolean(&can_export_edi, "EDI export availability")?;
    }
    boolean(&value["busy"], "logbook busy")?;
    let page = object(&value["page"], "log page")?;
    exact(page, &["offset", "limit", "total", "rows"], "log page")?;
    uint_value(&page["offset"], 1_000_000, "log offset")?;
    uint_value(&page["limit"], 20, "log limit")?;
    uint_value(&page["total"], MAX_SAFE_INTEGER, "log total")?;
    let rows = array(&page["rows"], 20, "log rows")?;
    let mut page_row_ids = Vec::with_capacity(rows.len());
    for row in rows {
        let row = object(row, "log row")?;
        exact(
            row,
            &[
                "qsoID",
                "workedAt",
                "callsign",
                "band",
                "mode",
                "sentExchange",
                "receivedExchange",
                "points",
                "multiplierLabels",
            ],
            "log row",
        )?;
        page_row_ids.push(text_value(&row["qsoID"], 160, false, "log identity")?.to_string());
        text_value(&row["workedAt"], 160, false, "log identity")?;
        text_value(&row["callsign"], 32, false, "log callsign")?;
        for key in ["band", "mode"] {
            text_value(&row[key], 16, false, "log radio value")?;
        }
        for key in ["sentExchange", "receivedExchange"] {
            text_value(&row[key], 1024, true, "log exchange")?;
        }
        integer(&row["points"], "log points")?;
        string_array(&row["multiplierLabels"], 64, 160, "multiplier labels")?;
    }
    if plugin_layout && plugin_row_ids.as_ref() != Some(&page_row_ids) {
        return Err("The plugin log rows do not match the visible page.".into());
    }
    if !value["editing"].is_null() {
        let edit = object(&value["editing"], "log edit")?;
        let mut required_edit = edit.clone();
        let worked_at = required_edit.remove("workedAt");
        let operator = required_edit.remove("operator");
        let entry_fields = required_edit.remove("entryFields");
        let reports_visible = required_edit.remove("reportsVisible");
        let details = required_edit.remove("details");
        exact(
            &required_edit,
            &[
                "qsoID",
                "callsign",
                "band",
                "mode",
                "sentReport",
                "receivedReport",
                "receivedFields",
                "frequencyHz",
                "editFrequencyText",
                "frequencyError",
                "correctionReason",
                "confirmDelete",
                "deletionReason",
            ],
            "log edit",
        )?;
        if let Some(worked_at) = worked_at {
            text_value(&worked_at, 32, false, "log edit timestamp")?;
        }
        if let Some(operator) = operator {
            text_value(&operator, 32, true, "log edit operator")?;
        }
        if let Some(entry_fields) = entry_fields {
            fields(&entry_fields, true)?;
        }
        if let Some(reports_visible) = reports_visible {
            boolean(&reports_visible, "log edit report visibility")?;
        }
        if let Some(details) = details {
            let details = object(&details, "log edit details")?;
            exact(
                details,
                &[
                    "rxFrequency", "contest", "country", "stationCall", "name", "qth", "comment",
                    "receivedNumber", "sentNumber", "points", "power", "zone", "section", "check",
                    "precedence", "multiplier1", "multiplier2", "multiplier3", "wpx", "exchange",
                    "run", "radio", "grid", "misc", "roverQTH",
                ],
                "log edit details",
            )?;
            for field in details.values() {
                text_value(field, 2048, true, "log edit detail")?;
            }
        }
        text_value(&edit["qsoID"], 160, false, "QSO ID")?;
        text_value(&edit["callsign"], 32, true, "log callsign")?;
        for key in ["band", "mode"] {
            text_value(&edit[key], 16, true, "log radio value")?;
        }
        for key in [
            "sentReport",
            "receivedReport",
            "correctionReason",
            "deletionReason",
        ] {
            text_value(&edit[key], 1024, true, "log edit text")?;
        }
        fields(&edit["receivedFields"], true)?;
        nullable_uint(&edit["frequencyHz"], 100_000_000_000, "log frequency")?;
        text_value(&edit["editFrequencyText"], 11, true, "log frequency text")?;
        text_value(&edit["frequencyError"], 512, true, "log frequency error")?;
        boolean(&edit["confirmDelete"], "delete confirmation")?;
    }
    Ok(())
}

fn validate_manual_rows(value: &Value) -> Result<(), String> {
    for row in array(value, 500, "manual log rows")? {
        let row = object(row, "manual log row")?;
        exact(
            row,
            &["qsoID", "TS", "Call", "Freq", "SNT", "RCV", "M1", "ZN", "M2", "prefix", "Points"],
            "manual log row",
        )?;
        for field in row.values() {
            text_value(field, 160, true, "manual log value")?;
        }
    }
    Ok(())
}

fn validate_plugin_columns(value: &Value) -> Result<usize, String> {
    let columns = array(value, 32, "plugin log columns")?;
    if columns.is_empty() {
        return Err("The plugin log columns are invalid.".into());
    }
    let mut unique = BTreeSet::new();
    let mut calls = 0;
    for column in columns {
        let column = text_value(column, 64, false, "plugin log column")?;
        if column != column.trim() || !unique.insert(column) {
            return Err("The plugin log columns are invalid.".into());
        }
        if column == "Call" {
            calls += 1;
        }
    }
    if calls != 1 {
        return Err("The plugin log columns require exactly one Call column.".into());
    }
    Ok(columns.len())
}

fn validate_plugin_rows(value: &Value, columns: usize, maximum: usize) -> Result<Vec<String>, String> {
    let rows = array(value, maximum, "plugin log rows")?;
    let mut ids = Vec::with_capacity(rows.len());
    for row in rows {
        let row = object(row, "plugin log row")?;
        exact(row, &["qsoID", "values"], "plugin log row")?;
        ids.push(text_value(&row["qsoID"], 160, false, "plugin log QSO ID")?.to_string());
        let values = array(&row["values"], columns, "plugin log values")?;
        if values.len() != columns {
            return Err("The plugin log row does not match its columns.".into());
        }
        for value in values {
            text_value(value, 512, true, "plugin log value")?;
        }
    }
    Ok(ids)
}

fn descriptor_fields(value: &Value, name: &str) -> Result<BTreeSet<String>, String> {
    let mut ids = BTreeSet::new();
    for field in array(value, 16, name)? {
        let field = object(field, name)?;
        let mut required = field.clone();
        let enabled = required.remove("enabled");
        let read_only = required.remove("readOnly");
        exact(
            &required,
            &["id", "label", "value", "required", "maximumUTF8Bytes"],
            name,
        )?;
        let field_id = text_value(&field["id"], 64, false, "field ID")?;
        if !ids.insert(field_id.to_string()) {
            return Err(format!("The {name} IDs are not unique."));
        }
        text_value(&field["label"], 160, false, "field label")?;
        boolean(&field["required"], "field required")?;
        let maximum = uint_value(&field["maximumUTF8Bytes"], 1024, "field maximum")?;
        if maximum == 0 {
            return Err(format!("The {name} maximum is invalid."));
        }
        text_value(&field["value"], maximum as usize, true, "field value")?;
        if let Some(enabled) = enabled {
            boolean(&enabled, "field enabled")?;
        }
        if let Some(read_only) = read_only {
            boolean(&read_only, "field read-only")?;
        }
    }
    Ok(ids)
}

fn fields(value: &Value, descriptor: bool) -> Result<(), String> {
    if descriptor {
        descriptor_fields(value, "exchange fields")?;
        return Ok(());
    }
    let fields = array(value, 16, "exchange fields")?;
    for field in fields {
        let field = object(field, "exchange field")?;
        exact(field, &["id", "label", "value"], "exchange field")?;
        text_value(&field["id"], 64, false, "field ID")?;
        text_value(&field["label"], 160, false, "field label")?;
        text_value(&field["value"], 1024, true, "field value")?;
    }
    Ok(())
}

fn exact(object: &Map<String, Value>, keys: &[&str], name: &str) -> Result<(), String> {
    if object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key)) {
        Ok(())
    } else {
        Err(format!("The {name} has unknown or missing fields."))
    }
}
fn object<'a>(value: &'a Value, name: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("The {name} is invalid."))
}
fn array<'a>(value: &'a Value, maximum: usize, name: &str) -> Result<&'a Vec<Value>, String> {
    value
        .as_array()
        .filter(|values| values.len() <= maximum)
        .ok_or_else(|| format!("The {name} is invalid."))
}
fn text_value<'a>(
    value: &'a Value,
    maximum: usize,
    allow_empty: bool,
    name: &str,
) -> Result<&'a str, String> {
    let value = value
        .as_str()
        .ok_or_else(|| format!("The {name} is invalid."))?;
    bounded_text(value, maximum, allow_empty, name)?;
    Ok(value)
}
fn bounded_text(value: &str, maximum: usize, allow_empty: bool, name: &str) -> Result<(), String> {
    if value.len() <= maximum && (allow_empty || !value.trim().is_empty()) {
        Ok(())
    } else {
        Err(format!("The {name} is invalid."))
    }
}
fn nullable_text(value: &Value, maximum: usize, name: &str) -> Result<(), String> {
    if value.is_null() {
        Ok(())
    } else {
        text_value(value, maximum, true, name).map(|_| ())
    }
}
fn uint_value(value: &Value, maximum: u64, name: &str) -> Result<u64, String> {
    value
        .as_u64()
        .filter(|value| *value <= maximum)
        .ok_or_else(|| format!("The {name} is invalid."))
}
fn nullable_uint(value: &Value, maximum: u64, name: &str) -> Result<(), String> {
    if value.is_null() {
        Ok(())
    } else {
        uint_value(value, maximum, name).map(|_| ())
    }
}
fn integer(value: &Value, name: &str) -> Result<(), String> {
    integer_value(value, name).map(|_| ())
}
fn integer_value(value: &Value, name: &str) -> Result<i64, String> {
    value
        .as_i64()
        .filter(|value| value.unsigned_abs() <= MAX_SAFE_INTEGER)
        .ok_or_else(|| format!("The {name} is invalid."))
}
fn nullable_nonnegative_number(value: &Value, name: &str) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|_| ())
        .ok_or_else(|| format!("The {name} is invalid."))
}
fn canonical_timestamp(value: &Value, name: &str) -> Result<(), String> {
    let value = value
        .as_str()
        .filter(|value| value.len() == 24 && value.is_ascii())
        .ok_or_else(|| format!("The {name} is invalid."))?;
    let bytes = value.as_bytes();
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
        || bytes.iter().enumerate().any(|(index, byte)| {
            !matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) && !byte.is_ascii_digit()
        })
    {
        return Err(format!("The {name} is invalid."));
    }
    let number =
        |range: std::ops::Range<usize>| -> u32 { value[range].parse::<u32>().unwrap_or(u32::MAX) };
    let year = number(0..4);
    let month = number(5..7);
    let day = number(8..10);
    let hour = number(11..13);
    let minute = number(14..16);
    let second = number(17..19);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if year == 0 || day == 0 || day > days || hour > 23 || minute > 59 || second > 59 {
        return Err(format!("The {name} is invalid."));
    }
    Ok(())
}
fn boolean(value: &Value, name: &str) -> Result<(), String> {
    value
        .as_bool()
        .map(|_| ())
        .ok_or_else(|| format!("The {name} is invalid."))
}
fn string_array(
    value: &Value,
    maximum: usize,
    maximum_text: usize,
    name: &str,
) -> Result<(), String> {
    for value in array(value, maximum, name)? {
        text_value(value, maximum_text, true, name)?;
    }
    Ok(())
}
fn unique_text_array(
    value: &Value,
    maximum: usize,
    maximum_text: usize,
    choices: Option<&[&str]>,
    name: &str,
) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for value in array(value, maximum, name)? {
        let value = text_value(value, maximum_text, false, name)?;
        if choices.is_some_and(|choices| !choices.contains(&value)) || !seen.insert(value) {
            return Err(format!("The {name} is invalid."));
        }
    }
    Ok(())
}
fn enum_value<'a>(value: &'a Value, choices: &[&str], name: &str) -> Result<&'a str, String> {
    let value = value
        .as_str()
        .filter(|value| choices.contains(value))
        .ok_or_else(|| format!("The {name} is invalid."))?;
    Ok(value)
}
fn canonical_uuid_value<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    let value = value
        .as_str()
        .ok_or_else(|| format!("The {name} is invalid."))?;
    canonical_uuid(value, name)
}
fn canonical_uuid<'a>(value: &'a str, name: &str) -> Result<&'a str, String> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| format!("The {name} is invalid."))?;
    if parsed.to_string() != value {
        return Err(format!("The {name} is invalid."));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    const OPERATING: &str = "10000000-0000-4000-8000-000000000001";
    const SESSION: &str = "20000000-0000-4000-8000-000000000001";
    const WORKSPACE: &str = "30000000-0000-4000-8000-000000000001";
    const REQUEST: &str = "40000000-0000-4000-8000-000000000001";
    fn context() -> ContestWindowContext {
        ContestWindowContext {
            operating_context: OPERATING.into(),
            session_id: SESSION.into(),
            workspace_generation: WORKSPACE.into(),
        }
    }
    fn action(action: &str, panel: &str, params: Value) -> Value {
        json!({"operatingContext":OPERATING,"scope":"contesting",
        "sessionID":SESSION,"workspaceGeneration":WORKSPACE,"panelID":panel,"projectionRevision":7,
        "requestID":REQUEST,"action":action,"params":params})
    }

    #[test]
    fn action_schema_rejects_unknown_fields_coercion_wrong_panel_and_old_numeric_frequency() {
        assert_eq!(contest_panel("contest--active-qso").unwrap(), "active-qso");
        assert_eq!(contest_panel("contest--edit-contact").unwrap(), "logbook");
        assert!(contest_panel("active-qso").is_err());
        assert!(contest_panel("contest--unknown").is_err());
        let params = json!({"draftID":"draft","expectedDraftRevision":2,"value":""});
        assert!(validate_action_envelope(&action(
            "entry_set_frequency_text",
            "active-qso",
            params.clone()
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "entry_set_frequency",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"value":14_025_000})
        ))
        .is_err());
        assert!(validate_action_envelope(&action(
            "log_export_cabrillo",
            "logbook",
            json!({})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "log_export_adif",
            "logbook",
            json!({})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "log_export_edi",
            "logbook",
            json!({})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "log_recalculate",
            "logbook",
            json!({"expectedSessionRevision":2})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "score_configure",
            "score-reporting",
            json!({"service":"hamscore","username":"OM0RX","password":"secret","intervalMinutes":2,"enabled":true})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "score_send_now",
            "score-reporting",
            json!({})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "score_configure",
            "score-reporting",
            json!({"service":"contest-run","username":"OM0RX","password":"secret","intervalMinutes":2,"enabled":true})
        ))
        .is_err());
        assert!(validate_action_envelope(&action(
            "score_send_now",
            "logbook",
            json!({})
        ))
        .is_err());
        assert!(validate_action_envelope(&action(
            "log_export_cabrillo",
            "logbook",
            json!({"extra":true})
        ))
        .is_err());
        assert!(validate_action_envelope(&action(
            "log_export_edi",
            "logbook",
            json!({"extra":true})
        ))
        .is_err());
        assert!(validate_action_envelope(&action(
            "entry_set_frequency_text",
            "logbook",
            params.clone()
        ))
        .is_err());
        assert!(validate_action_envelope(&action(
            "entry_set_frequency_text",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"value":14_025_000})
        ))
        .is_err());
        let mut extra = action("entry_set_frequency_text", "active-qso", params);
        extra["extra"] = json!(true);
        assert!(validate_action_envelope(&extra).is_err());
        let mut coerced = action(
            "entry_commit",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2}),
        );
        coerced["requestID"] = json!([REQUEST]);
        assert!(validate_action_envelope(&coerced).is_err());
    }

    #[test]
    fn score_credentials_are_not_retained_in_action_receipts() {
        let mut state = State { context: Some(context()), ..State::default() };
        publish_after_admission(&mut state, "score-reporting", 7, json!({"status":"ready"})).unwrap();
        let envelope = action("score_configure", "score-reporting", json!({
            "service":"hamscore","username":"OM0RX","password":"fixture-secret",
            "intervalMinutes":2,"enabled":true
        }));
        let checked = validate_action_envelope(&envelope).unwrap();
        submit_checked(&mut state, "score-reporting", &checked, envelope.clone()).unwrap();
        let receipt = &state.panels["score-reporting"].receipts[0].1;
        assert_eq!(receipt.envelope["params"]["password"], "[redacted]");
        assert!(!receipt.envelope.to_string().contains("fixture-secret"));
        assert_eq!(receipt.envelope_digest, envelope_digest(&envelope));
        let mut changed = envelope;
        changed["params"]["password"] = json!("different-secret");
        assert!(submit_checked(&mut state, "score-reporting", &checked, changed).is_err());
    }

    #[test]
    fn raw_entry_and_log_frequency_text_keep_bounded_invalid_intermediate_edits() {
        for value in ["", "1", "14025000", "99999999999"] {
            assert!(validate_action_envelope(&action(
                "entry_set_frequency_text",
                "active-qso",
                json!({"draftID":"draft","expectedDraftRevision":2,"value":value})
            ))
            .is_ok());
            assert!(validate_action_envelope(&action(
                "log_edit_set_frequency_text",
                "logbook",
                json!({"qsoID":"qso","value":value})
            ))
            .is_ok());
        }
        for value in ["", "1", "14.025", "bad", "ééééé"] {
            assert!(validate_action_envelope(&action(
                "entry_set_frequency_text",
                "active-qso",
                json!({"draftID":"draft","expectedDraftRevision":2,"value":value})
            ))
            .is_ok());
        }
        for value in ["999999999999", "éééééé"] {
            assert!(validate_action_envelope(&action(
                "entry_set_frequency_text",
                "active-qso",
                json!({"draftID":"draft","expectedDraftRevision":2,"value":value})
            ))
            .is_err());
        }
    }

    #[test]
    fn entry_operator_actions_are_typed_and_revision_fenced() {
        assert!(validate_action_envelope(&action("entry_clear", "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2}))).is_ok());
        for direction in ["previous", "next"] {
            assert!(validate_action_envelope(&action("entry_step_spot", "active-qso",
                json!({"draftID":"draft","expectedDraftRevision":2,"direction":direction}))).is_ok());
        }
        assert!(validate_action_envelope(&action("entry_step_spot", "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"direction":"up"}))).is_err());
        for speed in [json!(5), json!(26), json!(100)] {
            assert!(validate_action_envelope(&action("entry_set_cw_speed", "active-qso",
                json!({"draftID":"draft","expectedDraftRevision":2,"value":speed}))).is_ok());
        }
        for speed in [json!(4), json!(101), json!(26.5), json!("26"), Value::Null] {
            assert!(validate_action_envelope(&action("entry_set_cw_speed", "active-qso",
                json!({"draftID":"draft","expectedDraftRevision":2,"value":speed}))).is_err());
        }
        assert!(validate_action_envelope(&action("entry_send_cw_text", "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"value":"CQ TEST DE OM0RX"}))).is_ok());
        for value in [json!(""), json!("CQ\nTEST"), json!("é"), json!("X".repeat(81))] {
            assert!(validate_action_envelope(&action("entry_send_cw_text", "active-qso",
                json!({"draftID":"draft","expectedDraftRevision":2,"value":value}))).is_err());
        }
        assert!(validate_action_envelope(&action(
            "entry_operator_arm",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"armed":true})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "entry_operator_style",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"value":"search-and-pounce"})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "entry_focus",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"fieldID":"receive"})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "entry_operator_key",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"key":"Enter","focusedField":"other_2"})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "entry_operator_key",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"key":"F1","focusedField":null})
        ))
        .is_ok());
        for (name, params) in [
            (
                "entry_operator_arm",
                json!({"draftID":"draft","expectedDraftRevision":2,"armed":"true"}),
            ),
            (
                "entry_operator_style",
                json!({"draftID":"draft","expectedDraftRevision":2,"value":"assisted"}),
            ),
            (
                "entry_operator_key",
                json!({"draftID":"draft","expectedDraftRevision":2,"key":"Enter","focusedField":"band"}),
            ),
            (
                "entry_focus",
                json!({"draftID":"draft","expectedDraftRevision":2,"fieldID":"band"}),
            ),
        ] {
            assert!(validate_action_envelope(&action(name, "active-qso", params)).is_err());
        }
        assert!(validate_action_envelope(&action(
            "entry_operator_key",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"key":"Enter"})
        ))
        .is_err());
        assert!(validate_action_envelope(&action(
            "log_edit_confirm_delete",
            "logbook",
            json!({"qsoID":"qso","confirmed":true})
        ))
        .is_ok());
        assert!(validate_action_envelope(&action(
            "log_edit_confirm_delete",
            "logbook",
            json!({"qsoID":"qso","confirmed":1})
        ))
        .is_err());
    }

    #[test]
    fn projection_schemas_are_exact_and_unavailable_roles_have_no_ready_shape() {
        assert!(validate_projection(
            "monitor",
            &json!({"schemaVersion":1,"status":"unavailable"})
        )
        .is_ok());
        assert!(validate_projection("monitor", &rate_projection()).is_ok());
        let remote_vfo = json!({"schemaVersion":1,"status":"ready","radioFrequencyHz":14025000,
            "contestFrequencyHz":14025000,"band":"20m","mode":"CW","busy":false});
        assert!(validate_projection("station-control", &remote_vfo).is_ok());
        let mut unsafe_remote_vfo = remote_vfo.clone();
        unsafe_remote_vfo.as_object_mut().unwrap().insert("action".into(), json!("tune"));
        assert!(validate_projection("station-control", &unsafe_remote_vfo).is_err());
        assert!(validate_projection(
            "active-qso",
            &json!({"schemaVersion":1,"status":"unavailable","extra":true})
        )
        .is_err());
        let entry = json!({"schemaVersion":1,"status":"ready","session":{"name":"CQ WW","ruleName":"CQ WW CW","mode":"CW"},
            "draft":{"draftID":"draft","revision":2,"callsign":"DL1AAA","sentReport":"599","receivedReport":"599",
                "receivedFields":[],"frequencyHz":null,"frequencyText":"14.","frequencyError":"Enter a frequency",
                "band":"20m","mode":"CW","dupe":{"state":"unchecked","reason":""},
                "validation":{"errors":[],"warnings":[]},"reservedSerial":null},
            "busy":false,"dirty":true,"uncertain":false});
        assert!(validate_projection("active-qso", &entry).is_ok());
        let mut missing_frequency_text = entry;
        missing_frequency_text["draft"]
            .as_object_mut()
            .unwrap()
            .remove("frequencyText");
        assert!(validate_projection("active-qso", &missing_frequency_text).is_err());
        let logbook = json!({"schemaVersion":1,"status":"ready","sessionRevision":4,"canExportCabrillo":false,
            "page":{"offset":0,"limit":20,"total":1,"rows":[{"qsoID":"qso","workedAt":"2026-10-18T00:00:00Z",
                "callsign":"DL1AAA","band":"20m","mode":"CW","sentExchange":"599 15","receivedExchange":"599 14",
                "points":3,"multiplierLabels":["Germany"]}]},
            "editing":{"qsoID":"qso","callsign":"DL1AAA","band":"20m","mode":"CW","sentReport":"599",
                "receivedReport":"599","receivedFields":[],"frequencyHz":null,"editFrequencyText":"bad",
                "frequencyError":"Enter a frequency","correctionReason":"","confirmDelete":false,"deletionReason":""},"busy":false});
        assert!(validate_projection("logbook", &logbook).is_ok());
        let mut edi_logbook = logbook.clone();
        edi_logbook["canExportEdi"] = json!(true);
        assert!(validate_projection("logbook", &edi_logbook).is_ok());
        edi_logbook["canExportEdi"] = json!("true");
        assert!(validate_projection("logbook", &edi_logbook).is_err());
        let mut unknown_export_availability = logbook.clone();
        unknown_export_availability["canExportReg1Test"] = json!(true);
        assert!(validate_projection("logbook", &unknown_export_availability).is_err());
        let mut not1mm_logbook = json!({"schemaVersion":1,"status":"ready","sessionRevision":4,"canExportCabrillo":true,"exchangeLayout":"plugin",
            "page":{"offset":0,"limit":20,"total":1,"rows":[{"qsoID":"qso","workedAt":"2026-10-18T00:00:00.000Z",
                "callsign":"DL1AAA","band":"20m","mode":"CW","sentExchange":"599 15","receivedExchange":"599 14",
                "points":3,"multiplierLabels":["Germany"]}]},
            "pluginColumns":["TS","Call","Freq","SNT","RCV","ZN","SentNr","prefix","Points"],
            "pluginRows":[{"qsoID":"qso","values":["2026-10-18 00:00:00","DL1AAA","14025.0","599","599","14","15","DL","3"]}],
            "pluginPartialRows":[],
            "editing":{"qsoID":"qso","workedAt":"2026-10-18 00:00:00","operator":"OM0RX","callsign":"DL1AAA","reportsVisible":false,
                "band":"20m","mode":"CW","sentReport":"599","receivedReport":"599","receivedFields":[],
                "frequencyHz":14025000,"editFrequencyText":"14025000","frequencyError":"","correctionReason":"Operator correction",
                "confirmDelete":false,"deletionReason":"Operator deletion"},"busy":false});
        not1mm_logbook["editing"]["details"] = json!({
            "rxFrequency":"","contest":"CQWW","country":"DL","stationCall":"OM0RX","name":"","qth":"","comment":"",
            "receivedNumber":"14","sentNumber":"15","points":"3","power":"100","zone":"14","section":"","check":"","precedence":"A",
            "multiplier1":"Yes","multiplier2":"No","multiplier3":"","wpx":"DL1","exchange":"","run":"1","radio":"1","grid":"","misc":"","roverQTH":""
        });
        not1mm_logbook["editing"]["entryFields"] = json!([
            {"id":"sent","label":"Sent serial","value":"001","required":true,
                "maximumUTF8Bytes":160,"enabled":true,"readOnly":true},
            {"id":"other_1","label":"Received county","value":"ALAM","required":true,
                "maximumUTF8Bytes":32,"enabled":true,"readOnly":false}
        ]);
        assert!(validate_projection("logbook", &not1mm_logbook).is_ok());
        let mut malformed_details = not1mm_logbook.clone();
        malformed_details["editing"]["details"]["points"] = json!(3);
        assert!(validate_projection("logbook", &malformed_details).is_err());
        let mut missing_call_column = not1mm_logbook.clone();
        missing_call_column["pluginColumns"][1] = json!("Station");
        assert!(validate_projection("logbook", &missing_call_column).is_err());
        let mut mismatched_plugin_row = not1mm_logbook.clone();
        mismatched_plugin_row["pluginRows"][0]["qsoID"] = json!("other");
        assert!(validate_projection("logbook", &mismatched_plugin_row).is_err());
        let mut short_plugin_row = not1mm_logbook.clone();
        short_plugin_row["pluginRows"][0]["values"].as_array_mut().unwrap().pop();
        assert!(validate_projection("logbook", &short_plugin_row).is_err());
        let mut crossed_layout = not1mm_logbook;
        crossed_layout["manualRows"] = json!([]);
        assert!(validate_projection("logbook", &crossed_layout).is_err());
        let statistics = json!({"schemaVersion":1,"status":"ready","score":{"qsos":12,"points":12,"multipliers":10,
            "claimedScore":120,"multiplierLabels":["country:K"],"multiplierDisplayLabels":["United States"],
            "sourceVerification":"verified"},"busy":false});
        assert!(validate_projection("propagation", &statistics).is_ok());
        let mut missing_display = statistics;
        missing_display["score"]
            .as_object_mut()
            .unwrap()
            .remove("multiplierDisplayLabels");
        assert!(validate_projection("propagation", &missing_display).is_err());
        let too_many = vec![json!("K"); 10_001];
        missing_display["score"]["multiplierDisplayLabels"] = json!(too_many);
        assert!(validate_projection("propagation", &missing_display).is_err());
        assert!(validate_projection("propagation", &statistics_v2()).is_ok());
        assert!(validate_projection("propagation", &statistics_v3()).is_ok());
        let score_reporting = json!({"schemaVersion":1,"status":"ready","score":{
                "qsos":12,"points":12,"multipliers":10,"claimedScore":120,
                "multiplierLabels":["country:K"],"multiplierDisplayLabels":["United States"],
                "sourceVerification":"verified"},
            "intervalMinutes":2,"reportingEnabled":false,"availability":"available",
            "reason":"HTTPS RTC posting is separate from N1MM UDP.","service":"hamscore","username":"OM0RX",
            "credentialSaved":true,"reportState":"disabled","lastOutcome":"Not sent yet.","nextAttempt":null,"services":[
                {"id":"hamscore","name":"Real Time Contest Server","url":"https://hamscore.com/postxml/","transportSecurity":"https"},
                {"id":"contestonlinescore","name":"Contest Online ScoreBoard","url":"https://contestonlinescore.com/post/","transportSecurity":"https"},
                {"id":"contest-run","name":"Live Contest Score","url":"http://contest.run","transportSecurity":"legacy-http"}
            ],"busy":false});
        assert!(validate_projection("score-reporting", &score_reporting).is_ok());
        let mut enabled_reporting = score_reporting.clone();
        enabled_reporting["reportingEnabled"] = json!(true);
        enabled_reporting["reportState"] = json!("scheduled");
        assert!(validate_projection("score-reporting", &enabled_reporting).is_ok());
        let mut malformed_service = score_reporting.clone();
        malformed_service["services"][0]["transportSecurity"] = json!("plaintext");
        assert!(validate_projection("score-reporting", &malformed_service).is_err());
        let mut extra_field = score_reporting.clone();
        extra_field["retry"] = json!(true);
        assert!(validate_projection("score-reporting", &extra_field).is_err());
        let mut wrong_schema = score_reporting;
        wrong_schema["schemaVersion"] = json!(2);
        assert!(validate_projection("score-reporting", &wrong_schema).is_err());
        let native_rates = json!({"schemaVersion":1,"status":"ready","lastHourQsoPerHour":null,
            "last10QsoPerHour":120.5,"last100QsoPerHour":null,"sinceHourUTC":19,"sinceHourQso":2,
            "runQso":2,"searchAndPounceQso":1,"hourRunQso":1,"hourSearchAndPounceQso":0,"busy":false});
        assert!(validate_projection("monitor", &native_rates).is_ok());
        let mut invalid_hour = native_rates.clone();
        invalid_hour["sinceHourUTC"] = json!(24);
        assert!(validate_projection("monitor", &invalid_hour).is_err());
        for hour in [json!(-1), json!(1.5)] {
            let mut invalid_hour = native_rates.clone();
            invalid_hour["sinceHourUTC"] = hour;
            assert!(validate_projection("monitor", &invalid_hour).is_err());
        }
        for hour in [0, 23] {
            let mut boundary_hour = native_rates.clone();
            boundary_hour["sinceHourUTC"] = json!(hour);
            assert!(validate_projection("monitor", &boundary_hour).is_ok());
        }
        let mut legacy_rates = native_rates;
        legacy_rates.as_object_mut().unwrap().remove("sinceHourUTC");
        legacy_rates.as_object_mut().unwrap().remove("sinceHourQso");
        legacy_rates["sinceMinuteQsoPerHour"] = json!(120.0);
        assert!(validate_projection("monitor", &legacy_rates).is_err());
        let matrix = json!({"schemaVersion":1,"status":"ready","title":"DXCC","bands":["20m","40m"],
            "rows":[{"label":"Germany","counts":{"20m":1,"40m":0},"total":1}],"total":1,"busy":false});
        assert!(validate_projection("awards", &matrix).is_ok());
        assert!(validate_projection("chaser-dx", &matrix).is_ok());
        let zone_matrix = json!({"schemaVersion":4,"status":"ready","title":"CQ Zones","tracker":"zone","zoneSystem":"cq",
            "current":{"dxcc":"Germany","cqZone":14,"ituZone":28},"bands":["20m","40m"],
            "rows":[{"label":"14","counts":{"20m":1,"40m":0},"total":1}],"total":1,"busy":false});
        assert!(validate_projection("chaser-dx", &zone_matrix).is_ok());
        let mut malformed_zone_matrix = zone_matrix;
        malformed_zone_matrix["zoneSystem"] = Value::Null;
        assert!(validate_projection("chaser-dx", &malformed_zone_matrix).is_err());
    }

    #[test]
    fn rate_and_statistics_projections_reject_noncanonical_or_inconsistent_snapshots() {
        let mut rate = rate_projection();
        rate["asOfUTC"] = json!("2026-10-18T00:00:00Z");
        assert!(validate_projection("monitor", &rate).is_err(), "timestamp");

        let mut rate = rate_projection();
        rate["operatorStyles"]["total"]["unknown"] = json!(2);
        assert!(validate_projection("monitor", &rate).is_err(), "operator styles");

        let mut rate = rate_projection();
        rate["latest10"] = json!({"qsoCount":10,"spanSeconds":60.0,"qsosPerHour":600.0});
        assert!(validate_projection("monitor", &rate).is_err(), "latest sample");

        let mut statistics = statistics_v2();
        statistics["bands"][0]["modes"]["cw"] = json!(1);
        assert!(validate_projection("propagation", &statistics).is_err());

        let mut statistics = statistics_v2();
        statistics["score"]["qsos"] = json!(2);
        assert!(validate_projection("propagation", &statistics).is_err());

        let mut statistics = statistics_v2();
        statistics["bands"] = json!((0..65).map(|index| json!({
            "band":format!("b{index}"),"loggedQSOs":0,"acceptedQSOs":0,"distinctCallsigns":0,
            "modes":{"cw":0,"phone":0,"digital":0,"other":0},"distinctWPXPrefixes":0,"creditedPoints":0
        })).collect::<Vec<_>>());
        assert!(validate_projection("propagation", &statistics).is_err());
    }

    #[test]
    fn statistics_v3_is_exact_bounded_and_matches_the_not1mm_table() {
        let statistics = statistics_v3();
        assert!(validate_projection("propagation", &statistics).is_ok());

        let mut empty = statistics.clone();
        empty["rows"] = json!([]);
        empty["total"] = json!({"band":"TOTAL","qsos":0,"calls":0,"cw":0,"phone":0,"digital":0,"wpx":0,"points":0});
        empty["score"]["qsos"] = json!(0);
        empty["score"]["points"] = json!(0);
        assert!(validate_projection("propagation", &empty).is_ok());

        let mut signed_points = statistics.clone();
        signed_points["rows"][0]["points"] = json!(-3);
        signed_points["total"]["points"] = json!(-1);
        signed_points["score"]["points"] = json!(-1);
        assert!(validate_projection("propagation", &signed_points).is_ok());

        let mut extra = statistics.clone();
        extra["rows"][0]["extra"] = json!(true);
        assert!(validate_projection("propagation", &extra).is_err());

        let mut duplicate = statistics.clone();
        let row = duplicate["rows"][0].clone();
        duplicate["rows"].as_array_mut().unwrap().push(row);
        assert!(validate_projection("propagation", &duplicate).is_err());

        let mut boolean = statistics.clone();
        boolean["rows"][0]["qsos"] = json!(true);
        assert!(validate_projection("propagation", &boolean).is_err());

        let mut overflow = statistics.clone();
        overflow["rows"][0]["qsos"] = json!(MAX_SAFE_INTEGER + 1);
        assert!(validate_projection("propagation", &overflow).is_err());

        let mut mismatch = statistics.clone();
        mismatch["total"]["cw"] = json!(2);
        assert!(validate_projection("propagation", &mismatch).is_err());

        let mut score_mismatch = statistics.clone();
        score_mismatch["score"]["points"] = json!(4);
        assert!(validate_projection("propagation", &score_mismatch).is_err());

        let mut too_many = statistics;
        too_many["rows"] = json!((0..65).map(|index| json!({
            "band":format!("{index}.0"),"qsos":0,"calls":0,"cw":0,"phone":0,
            "digital":0,"wpx":0,"points":0
        })).collect::<Vec<_>>());
        assert!(validate_projection("propagation", &too_many).is_err());
    }

    #[test]
    fn entry_v2_projects_resolved_sent_exchange_and_simulation_state_exactly() {
        let entry = entry_v2();
        assert!(validate_projection("active-qso", &entry).is_ok());
        let mut native = entry.clone();
        native["manual"] = json!({"operator":"OM0RX","cwSpeedWpm":20,"country":null,"cqZone":null,"ituZone":null,
            "headingDegrees":null,"longPathHeadingDegrees":null,"distanceKm":null,"qsos":0,"multipliers":0,"total":0});
        native["operator"]["output"] = json!("xlog-native");
        native["operator"]["functionKeys"][0]["macro"] = json!("Run CQ");
        native["operator"]["autoCQ"] = json!({"active":false,"delaySeconds":15,"remainingMs":null});
        assert!(validate_projection("active-qso", &native).is_ok());
        let mut bad_auto_cq = native.clone();
        bad_auto_cq["operator"]["autoCQ"]["delaySeconds"] = json!(0);
        assert!(validate_projection("active-qso", &bad_auto_cq).is_err());
        bad_auto_cq = native.clone();
        bad_auto_cq["operator"]["autoCQ"]["remainingMs"] = json!(3_600_001);
        assert!(validate_projection("active-qso", &bad_auto_cq).is_err());
        bad_auto_cq = native.clone();
        bad_auto_cq["operator"]["autoCQ"]["unexpected"] = json!(true);
        assert!(validate_projection("active-qso", &bad_auto_cq).is_err());
        let mut not1mm_phone_trace = entry.clone();
        not1mm_phone_trace["operator"]["trace"][0]["mode"] = json!("SSB");
        not1mm_phone_trace["operator"]["trace"][0]["macro"] = json!("Exch");
        not1mm_phone_trace["operator"]["trace"][0]["text"] = json!("59 001");
        assert!(validate_projection("active-qso", &not1mm_phone_trace).is_ok());
        not1mm_phone_trace["operator"]["trace"][0]["macro"] = json!("");
        assert!(validate_projection("active-qso", &not1mm_phone_trace).is_err());
        not1mm_phone_trace["operator"]["trace"][0]["macro"] = json!("X".repeat(161));
        assert!(validate_projection("active-qso", &not1mm_phone_trace).is_err());
        assert!(validate_projection(
            "active-qso",
            &json!({"schemaVersion":2,"status":"unavailable"})
        )
        .is_err());

        for key in ["allowDuplicateCommit", "automaticSerial"] {
            for value in [true, false] {
                let mut metadata_entry = entry.clone();
                metadata_entry["descriptor"][key] = json!(value);
                assert!(validate_projection("active-qso", &metadata_entry).is_ok());
            }
            for value in [json!("true"), json!(null)] {
                let mut metadata_entry = entry.clone();
                metadata_entry["descriptor"][key] = value;
                assert!(validate_projection("active-qso", &metadata_entry).is_err());
            }
        }
        let mut space_advance = entry.clone();
        space_advance["descriptor"]["advanceOnSpace"] =
            json!(["callsign", "sent", "receive", "other_1", "other_2"]);
        assert!(validate_projection("active-qso", &space_advance).is_ok());
        space_advance["descriptor"]["advanceOnSpace"] = json!(["callsign", "callsign"]);
        assert!(validate_projection("active-qso", &space_advance).is_err());
        space_advance["descriptor"]["advanceOnSpace"] = json!(["band"]);
        assert!(validate_projection("active-qso", &space_advance).is_err());
        let mut unknown_metadata = entry.clone();
        unknown_metadata["descriptor"]["unknown"] = json!(false);
        assert!(validate_projection("active-qso", &unknown_metadata).is_err());

        let mut duplicate_binding = entry.clone();
        duplicate_binding["descriptor"]["keyBindings"] = json!([
            {"context":"*","key":"Ctrl+R","action":"TOGGLE_RUN"},
            {"context":"*","key":"Ctrl+R","action":"LOG_NOW"}
        ]);
        assert!(validate_projection("active-qso", &duplicate_binding).is_err());
        for action in ["TOGGLE_RUN", "SET_RUN", "SET_S_AND_P", "LOG_NOW", "CLEAR_INPUTS", "PREV_SPOT", "NEXT_SPOT",
            "FOCUS_CALLSIGN", "FOCUS_NEXT", "FOCUS_PREVIOUS", "CW_SPEED_UP", "CW_SPEED_DOWN", "TOGGLE_CW_INPUT", "RST_INCR", "RST_DECR", "EXCH_INCR", "EXCH_DECR", "SEND_F1", "SEND_F2",
            "SEND_F3", "SEND_F4", "SEND_F5", "SEND_F6", "SEND_F7", "SEND_F8", "SEND_F9", "SEND_F10", "SEND_F11", "SEND_F12"] {
            let mut supported_binding = entry.clone();
            supported_binding["descriptor"]["keyBindings"][0]["action"] = json!(action);
            assert!(validate_projection("active-qso", &supported_binding).is_ok(), "{action}");
        }
        let mut unsupported_binding = entry.clone();
        unsupported_binding["descriptor"]["keyBindings"][0]["action"] = json!("SHELL");
        assert!(validate_projection("active-qso", &unsupported_binding).is_err());

        let mut serial_entry = entry.clone();
        serial_entry["descriptor"]["allowDuplicateCommit"] = json!(true);
        serial_entry["descriptor"]["automaticSerial"] = json!(true);
        serial_entry["draft"]["reservedSerial"] = json!(1);
        serial_entry["descriptor"]["sentFields"]
            .as_array_mut()
            .unwrap()
            .push(
                json!({"id":"serial","label":"Serial","value":"001","required":true,
                "maximumUTF8Bytes":3}),
            );
        serial_entry["descriptor"]["serial"] = json!({
            "requirement":"requiredForCommit","allocatedFieldID":"serial","reservedSerial":1
        });
        assert!(validate_projection("active-qso", &serial_entry).is_ok());

        let mut host_serial_entry = entry.clone();
        host_serial_entry["draft"]["reservedSerial"] = json!(1);
        host_serial_entry["descriptor"]["reportFields"] = json!([
            {"id":"sent","label":"Sent serial","value":"001","required":true,
                "maximumUTF8Bytes":160,"enabled":true,"readOnly":true},
            {"id":"receive","label":"Received serial","value":"42","required":true,
                "maximumUTF8Bytes":160,"enabled":true,"readOnly":false}
        ]);
        host_serial_entry["descriptor"]["serial"] = json!({
            "requirement":"requiredForCommit","allocatedFieldID":"sent","reservedSerial":1
        });
        assert!(validate_projection("active-qso", &host_serial_entry).is_ok());

        let mut non_field_serial = entry.clone();
        non_field_serial["draft"]["reservedSerial"] = json!(1);
        non_field_serial["descriptor"]["serial"] = json!({
            "requirement":"requiredForCommit","allocatedFieldID":null,"reservedSerial":1
        });
        assert!(validate_projection("active-qso", &non_field_serial).is_ok());

        let mut overlong_value = entry.clone();
        overlong_value["descriptor"]["sentFields"][0]["value"] = json!("ABCDEF");
        assert!(validate_projection("active-qso", &overlong_value).is_err());

        let mut wrong_serial_field = entry.clone();
        wrong_serial_field["draft"]["reservedSerial"] = json!(1);
        wrong_serial_field["descriptor"]["serial"] = json!({
            "requirement":"requiredForCommit","allocatedFieldID":"missing","reservedSerial":1
        });
        assert!(validate_projection("active-qso", &wrong_serial_field).is_err());

        let mut mismatched_serial = entry.clone();
        mismatched_serial["descriptor"]["serial"]["reservedSerial"] = json!(1);
        assert!(validate_projection("active-qso", &mismatched_serial).is_err());

        let mut duplicate_modes = entry.clone();
        duplicate_modes["descriptor"]["modes"] = json!(["CW", "CW"]);
        assert!(validate_projection("active-qso", &duplicate_modes).is_err());

        let mut excessive_trace = entry;
        excessive_trace["operator"]["trace"] = json!((0..25)
            .map(
                |index| json!({"operationID":format!("simulation-{index}"),"mode":"CW","macro":"CQ",
                "text":"CQ TEST","status":"confirmed"})
            )
            .collect::<Vec<_>>());
        assert!(validate_projection("active-qso", &excessive_trace).is_err());
    }

    #[test]
    fn assistance_projection_requires_owner_resolvable_candidate_ids() {
        let projection = json!({"schemaVersion":1,"status":"ready","draftID":"draft","draftRevision":2,
            "inputCallsign":"K1","scp":{"source":"master.scp","candidates":[{"candidateID":"scp:K1ABC","callsign":"K1ABC"}]},
            "history":{"source":null,"rows":[{"candidateID":"history:qso-1","callsign":"K1ABC",
                "fields":[{"id":"state","label":"State","value":"MA"}]}]},"busy":false});
        assert!(validate_projection("callsign-intelligence", &projection).is_ok());
        let mut missing_id = projection;
        missing_id["scp"]["candidates"][0]
            .as_object_mut()
            .unwrap()
            .remove("candidateID");
        assert!(validate_projection("callsign-intelligence", &missing_id).is_err());
    }

    #[test]
    fn partial_columns_require_unique_bounded_candidates() {
        for (kind, key) in [
            ("log", "loggedCandidates"),
            ("cluster", "clusterCandidates"),
        ] {
            let mut projection = json!({"schemaVersion":1,"status":"ready","draftID":"draft","draftRevision":2,
                "inputCallsign":"K1","scp":{"source":null,"candidates":[]},
                "history":{"source":null,"rows":[]},"loggedCalls":["K1ABC"],"clusterCalls":[],"busy":false});
            let candidate = json!({"candidateID":format!("{kind}:K1ABC"),"callsign":"K1ABC"});
            projection[key] = json!([candidate.clone()]);
            assert!(validate_projection("callsign-intelligence", &projection).is_ok());
            let params = json!({"draftID":"draft","expectedDraftRevision":2,"kind":kind,"candidateID":format!("{kind}:K1ABC")});
            assert!(
                validate_action_params("assistance_select", params.as_object().unwrap()).is_ok()
            );
            projection[key] = json!([candidate.clone(), candidate.clone()]);
            assert!(validate_projection("callsign-intelligence", &projection).is_err());
            projection[key] = json!([{"callsign":"K1ABC"}]);
            assert!(validate_projection("callsign-intelligence", &projection).is_err());
            projection[key] = json!([{"candidateID":"id","callsign":"bad call"}]);
            assert!(validate_projection("callsign-intelligence", &projection).is_err());
            projection[key] = Value::Array(vec![candidate; 501]);
            assert!(validate_projection("callsign-intelligence", &projection).is_err());
        }
    }

    #[test]
    fn context_registration_and_invalidation_are_exact() {
        let current = context();
        let mut state = State::default();
        register_context_in(&mut state, &current);
        state.panels.insert(
            "active-qso".into(),
            PanelState {
                projection: None,
                receipts: VecDeque::from([(
                    "receipt".into(),
                    retained_receipt(&json!({}), "uncertain", None, 7),
                )]),
            },
        );
        register_context_in(&mut state, &current);
        assert_eq!(state.panels["active-qso"].receipts.len(), 1);
        let stale = ContestWindowContext {
            session_id: "20000000-0000-4000-8000-000000000002".into(),
            ..current.clone()
        };
        invalidate_context_in(&mut state, &stale);
        assert_eq!(state.context, Some(current.clone()));
        register_context_in(&mut state, &stale);
        assert!(state.panels.is_empty());
        let mut restored = entry_v2();
        restored["operator"]["autoCQ"] =
            json!({"active":false,"delaySeconds":15,"remainingMs":null});
        validate_projection("active-qso", &restored).unwrap();
        publish_after_admission(&mut state, "active-qso", 1, restored).unwrap();
        assert_eq!(state.panels["active-qso"].projection.as_ref().unwrap().0, 1);
        invalidate_context_in(&mut state, &current);
        assert_eq!(state.context, Some(stale.clone()));
        invalidate_context_in(&mut state, &stale);
        assert!(state.context.is_none());
    }

    #[test]
    fn stale_context_and_capacity_failures_do_not_mutate_admission_state() {
        let current = context();
        let stale = ContestWindowContext {
            session_id: "20000000-0000-4000-8000-000000000002".into(),
            ..current.clone()
        };
        let mut state = State {
            context: Some(current.clone()),
            ..State::default()
        };
        assert!(require_context(&state, &stale).is_err());
        assert!(state.actions.is_empty());
        assert!(state.panels.is_empty());

        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        for index in 0..MAX_ACTIONS {
            state.actions.push_back(QueuedAction {
                panel_id: "active-qso".into(),
                request_id: format!("queued-{index}"),
                envelope: json!({}),
            });
        }
        let envelope = action(
            "entry_commit",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2}),
        );
        let checked = validate_action_envelope(&envelope).unwrap();
        assert!(submit_checked(&mut state, "active-qso", &checked, envelope).is_err());
        assert_eq!(state.actions.len(), MAX_ACTIONS);
        assert!(state.seen_request_ids.is_empty());
        assert!(state.panels["active-qso"].receipts.is_empty());
    }

    #[test]
    fn unresolved_receipts_block_eviction_and_retired_ids_never_replay() {
        let mut state = State {
            context: Some(context()),
            ..State::default()
        };
        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        let panel = state.panels.get_mut("active-qso").unwrap();
        for index in 0..MAX_RECEIPTS_PER_PANEL {
            let request_id = format!("00000000-0000-4000-8000-{index:012x}");
            let envelope = action_with_request(&request_id);
            panel.receipts.push_back((
                request_id.clone(),
                retained_receipt(&envelope, "uncertain", None, 7),
            ));
            state.seen_request_ids.insert(request_id);
        }
        let envelope = action(
            "entry_commit",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2}),
        );
        let checked = validate_action_envelope(&envelope).unwrap();
        assert!(submit_checked(&mut state, "active-qso", &checked, envelope.clone()).is_err());
        assert_eq!(
            state.panels["active-qso"].receipts.len(),
            MAX_RECEIPTS_PER_PANEL
        );
        assert!(state.actions.is_empty());
        assert!(!state.seen_request_ids.contains(REQUEST));

        for (_, receipt) in &mut state.panels.get_mut("active-qso").unwrap().receipts {
            receipt.status = "applied";
        }
        assert_eq!(
            submit_checked(&mut state, "active-qso", &checked, envelope).unwrap()["status"],
            "queued"
        );
        assert_eq!(
            state.panels["active-qso"].receipts.len(),
            MAX_RECEIPTS_PER_PANEL
        );
        let retired = action_with_request("00000000-0000-4000-8000-000000000000");
        let retired_checked = validate_action_envelope(&retired).unwrap();
        assert!(submit_checked(&mut state, "active-qso", &retired_checked, retired).is_err());
        assert_eq!(state.actions.len(), 1);
    }

    #[test]
    fn unavailable_projection_cannot_enqueue_actions() {
        let mut state = State {
            context: Some(context()),
            ..State::default()
        };
        publish_after_admission(
            &mut state,
            "active-qso",
            7,
            json!({"schemaVersion":1,"status":"unavailable"}),
        )
        .unwrap();
        let envelope = action(
            "entry_commit",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2}),
        );
        let checked = validate_action_envelope(&envelope).unwrap();

        assert!(submit_checked(&mut state, "active-qso", &checked, envelope).is_err());
        assert!(state.actions.is_empty());
        assert!(state.seen_request_ids.is_empty());
        assert!(state.panels["active-qso"].receipts.is_empty());
    }

    #[test]
    fn action_queue_marks_taken_work_uncertain_and_never_replays_duplicate_ids() {
        let mut state = State {
            context: Some(context()),
            ..State::default()
        };
        let envelope = action(
            "entry_commit",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2}),
        );
        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        let mut stale = envelope.clone();
        stale["projectionRevision"] = json!(6);
        let stale_checked = validate_action_envelope(&stale).unwrap();
        assert!(submit_checked(&mut state, "active-qso", &stale_checked, stale).is_err());
        let checked = validate_action_envelope(&envelope).unwrap();
        assert_eq!(
            submit_checked(&mut state, "active-qso", &checked, envelope.clone()).unwrap()["status"],
            "queued"
        );
        assert_eq!(
            submit_checked(&mut state, "active-qso", &checked, envelope.clone()).unwrap()["status"],
            "queued"
        );
        assert_eq!(state.actions.len(), 1);
        assert_eq!(take_next(&mut state).unwrap(), Some(envelope.clone()));
        assert_eq!(
            submit_checked(&mut state, "active-qso", &checked, envelope.clone()).unwrap()["status"],
            "uncertain"
        );
        assert!(state.actions.is_empty());
        assert_eq!(
            complete_after_admission(&mut state, REQUEST, "applied", None, 8).unwrap()["status"],
            "applied"
        );
        assert_eq!(
            complete_after_admission(&mut state, REQUEST, "applied", None, 8).unwrap()["status"],
            "applied"
        );
        assert!(complete_after_admission(&mut state, REQUEST, "applied", None, 9).is_err());
        assert!(complete_after_admission(&mut state, REQUEST, "rejected", None, 8).is_err());
        let mut changed = envelope;
        changed["params"]["expectedDraftRevision"] = json!(3);
        assert!(submit_checked(&mut state, "active-qso", &checked, changed).is_err());
        assert_eq!(state.panels["active-qso"].receipts.len(), 1);
        state.panels.get_mut("active-qso").unwrap().receipts.clear();
        assert!(submit_checked(&mut state, "active-qso", &checked, checked_value()).is_err());
    }

    #[test]
    fn setup_publication_replay_accepts_only_the_exact_current_projection() {
        let mut state = State {
            context: Some(context()),
            ..State::default()
        };
        let current = json!({"schemaVersion":1,"status":"unavailable"});
        publish_after_admission(&mut state, "active-qso", 7, current.clone()).unwrap();

        // The main React owner is mounted under StrictMode, so ordinary New
        // Contest setup can replay this exact UI/native publication.
        publish_after_admission(&mut state, "active-qso", 7, current.clone()).unwrap();

        let conflicting = publish_after_admission(
            &mut state,
            "active-qso",
            7,
            json!({"schemaVersion":1,"status":"ready"}),
        )
        .unwrap_err();
        assert_eq!(
            conflicting,
            "Contest Setup changed unexpectedly. Close and reopen it before continuing."
        );
        let stale = publish_after_admission(&mut state, "active-qso", 6, current).unwrap_err();
        assert_eq!(
            stale,
            "Contest Setup is out of date. Close and reopen it before continuing."
        );
        assert_eq!(state.panels["active-qso"].projection.as_ref().unwrap().0, 7);
    }

    #[test]
    fn rejected_completion_replay_requires_the_exact_terminal_coordinate() {
        let request_id = "00000000-0000-4000-8000-000000000005";
        let mut state = State {
            context: Some(context()),
            panels: BTreeMap::from([(
                "logbook".into(),
                PanelState {
                    projection: Some((7, json!({"status":"ready"}))),
                    receipts: VecDeque::from([(
                        request_id.into(),
                        retained_receipt(&json!({"action":"log_export_cabrillo"}), "uncertain", None, 7),
                    )]),
                },
            )]),
            ..State::default()
        };

        let message = Some("Native export save failed.".to_string());
        assert_eq!(
            complete_after_admission(&mut state, request_id, "rejected", message.clone(), 8)
                .unwrap()["status"],
            "rejected"
        );
        assert!(complete_after_admission(&mut state, request_id, "rejected", message, 8).is_ok());
        assert!(complete_after_admission(
            &mut state,
            request_id,
            "rejected",
            Some("Different failure.".into()),
            8
        )
        .is_err());
        assert!(complete_after_admission(&mut state, request_id, "applied", None, 8).is_err());
    }

    #[test]
    fn relayed_operator_focus_is_exact_one_shot_and_rejects_unfocused_submission() {
        let mut state = State { context: Some(context()), ..State::default() };
        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        let envelope = action("entry_operator_key", "active-qso", json!({
            "draftID":"draft","expectedDraftRevision":2,"key":"F3","focusedField":"callsign"
        }));
        let checked = validate_action_envelope(&envelope).unwrap();

        assert!(submit_after_admission_focused(&mut state, "active-qso", &checked, envelope.clone(), false).is_err());
        assert!(state.actions.is_empty());
        assert!(state.focused_actions.is_empty());

        submit_after_admission_focused(&mut state, "active-qso", &checked, envelope.clone(), true).unwrap();
        assert_eq!(take_next(&mut state).unwrap(), Some(envelope));
        assert!(!consume_focus_admission_in(&mut state, REQUEST, "arm"));
        assert!(consume_focus_admission_in(&mut state, REQUEST, "contest"));
        assert!(!consume_focus_admission_in(&mut state, REQUEST, "contest"));
        complete_after_admission(&mut state, REQUEST, "rejected", Some("test".into()), 7).unwrap();
        assert!(state.focused_actions.is_empty());

        state.focused_actions.insert(REQUEST.into());
        revoke_focus_admissions_in(&mut state);
        assert!(!consume_focus_admission_in(&mut state, REQUEST, "contest"));

        let mut text_state = State { context: Some(context()), ..State::default() };
        publish_after_admission(&mut text_state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        let text_envelope = action("entry_send_cw_text", "active-qso", json!({
            "draftID":"draft","expectedDraftRevision":2,"value":"CQ TEST"
        }));
        let checked = validate_action_envelope(&text_envelope).unwrap();
        submit_after_admission_focused(&mut text_state, "active-qso", &checked, text_envelope, true).unwrap();
        assert!(take_next(&mut text_state).unwrap().is_some());
        assert!(consume_focus_admission_in(&mut text_state, REQUEST, "contest"));
        assert!(!consume_focus_admission_in(&mut text_state, REQUEST, "contest"));
    }

    #[test]
    fn partial_candidate_actions_are_revision_fenced_and_never_replayed() {
        for kind in ["log", "cluster", "scp", "history"] {
            let mut state = State {
                context: Some(context()),
                ..State::default()
            };
            let envelope = action(
                "assistance_select",
                "callsign-intelligence",
                json!({"draftID":"draft","expectedDraftRevision":2,"kind":kind,"candidateID":format!("{kind}:K1ABC")}),
            );
            publish_after_admission(
                &mut state,
                "callsign-intelligence",
                7,
                json!({"status":"ready"}),
            )
            .unwrap();
            let mut stale = envelope.clone();
            stale["projectionRevision"] = json!(6);
            let checked_stale = validate_action_envelope(&stale).unwrap();
            assert!(
                submit_checked(&mut state, "callsign-intelligence", &checked_stale, stale).is_err()
            );
            let checked = validate_action_envelope(&envelope).unwrap();
            submit_checked(
                &mut state,
                "callsign-intelligence",
                &checked,
                envelope.clone(),
            )
            .unwrap();
            submit_checked(
                &mut state,
                "callsign-intelligence",
                &checked,
                envelope.clone(),
            )
            .unwrap();
            assert_eq!(state.actions.len(), 1);
            assert_eq!(take_next(&mut state).unwrap(), Some(envelope.clone()));
            assert_eq!(
                submit_checked(
                    &mut state,
                    "callsign-intelligence",
                    &checked,
                    envelope.clone()
                )
                .unwrap()["status"],
                "uncertain"
            );
            complete_after_admission(&mut state, REQUEST, "applied", None, 8).unwrap();
            assert_eq!(
                submit_checked(&mut state, "callsign-intelligence", &checked, envelope).unwrap()
                    ["status"],
                "applied"
            );
            assert!(state.actions.is_empty());
        }
    }

    #[test]
    fn contest_spot_selection_is_scoped_revision_fenced_and_schema_bounded() {
        let spot = json!({"id":"spot-1","receivedAt":1,"clusterName":"SK6AW","spotter":"K1ABC","spotterContinent":null,
            "frequencyKHz":14025.0,"frequencyText":"14025.0","callsign":"DL1ABC","comment":"CQ","band":"20m","mode":"CW",
            "country":"Germany","adif":230,"continent":"EU","cqZone":14,"ituZone":28,"callStatus":"New","dxccStatus":"New",
            "workedBefore":null,"specialTags":[],"score":80,"scoreReasons":[],"aggregateCount":1,"aggregateSpotters":["K1ABC"],
            "source":"DX Cluster","statusHex":"","bandHex":"","modeHex":"","marked":false});
        let projection = json!({"schemaVersion":2,"status":"ready","draftID":"draft","draftRevision":2,
            "radioFrequencyHz":14025000,"connectedClusters":1,"loadedSpots":1,"selectedSpotID":"spot-1",
            "configuredClusters":[{"serverID":"server-1","serverName":"ShackCQ","enabled":true}],
            "connections":[{"serverID":"server-1","serverName":"ShackCQ","phase":"connected","error":null}],"markedOnly":false,
            "spots":[spot.clone()],"busy":false});
        for panel in ["band-maps", "dx-cluster"] { assert!(validate_projection(panel, &projection).is_ok()); }
        let mut duplicate = projection.clone(); duplicate["spots"] = json!([spot.clone(), spot]);
        assert!(validate_projection("band-maps", &duplicate).is_err());
        let mut state = State { context: Some(context()), ..State::default() };
        publish_after_admission(&mut state, "band-maps", 7, projection).unwrap();
        let envelope = action("spot_select", "band-maps", json!({"draftID":"draft","expectedDraftRevision":2,"spotID":"spot-1"}));
        let checked = validate_action_envelope(&envelope).unwrap();
        submit_checked(&mut state, "band-maps", &checked, envelope.clone()).unwrap();
        assert_eq!(take_next(&mut state).unwrap(), Some(envelope));
        for (index, (name, params)) in [
            ("spot_confirm", json!({"draftID":"draft","expectedDraftRevision":2,"spotID":"spot-1"})),
            ("spot_set_marked", json!({"draftID":"draft","expectedDraftRevision":2,"spotID":"spot-1","marked":true})),
            ("spot_delete", json!({"draftID":"draft","expectedDraftRevision":2,"spotID":"spot-1"})),
            ("spot_set_marked_only", json!({"draftID":"draft","expectedDraftRevision":2,"markedOnly":true})),
        ].into_iter().enumerate() {
            let mut lifecycle = action(name, "dx-cluster", params);
            lifecycle["requestID"] = json!(format!("40000000-0000-4000-8000-{:012}", 20 + index));
            assert!(validate_action_envelope(&lifecycle).is_ok());
        }
        let mut cross_panel = action("spot_select", "active-qso", json!({"draftID":"draft","expectedDraftRevision":2,"spotID":"spot-1"}));
        cross_panel["requestID"] = json!("40000000-0000-4000-8000-000000000010");
        assert!(validate_action_envelope(&cross_panel).is_err());
        let mut stale = action("spot_select", "band-maps", json!({"draftID":"draft","expectedDraftRevision":2,"spotID":"spot-1"}));
        stale["requestID"] = json!("40000000-0000-4000-8000-000000000011"); stale["projectionRevision"] = json!(6);
        let stale_checked = validate_action_envelope(&stale).unwrap();
        assert!(submit_checked(&mut state, "band-maps", &stale_checked, stale).is_err());
    }

    #[test]
    fn escape_has_a_separate_bounded_at_most_once_lane_without_touching_fifo_work() {
        let mut state = State {
            context: Some(context()),
            ..State::default()
        };
        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        let ordinary = checked_value();
        let ordinary_checked = validate_action_envelope(&ordinary).unwrap();
        submit_checked(&mut state, "active-qso", &ordinary_checked, ordinary.clone()).unwrap();

        let escape = escape_with_request("40000000-0000-4000-8000-000000000002");
        let escape_checked = validate_action_envelope(&escape).unwrap();
        submit_checked(&mut state, "active-qso", &escape_checked, escape.clone()).unwrap();
        assert_eq!(state.actions.len(), 1);
        assert_eq!(state.escape_actions.len(), 1);
        assert_eq!(take_next_escape(&mut state).unwrap(), Some(escape.clone()));
        assert_eq!(
            submit_checked(&mut state, "active-qso", &escape_checked, escape.clone()).unwrap()["status"],
            "uncertain"
        );
        assert_eq!(take_next_escape(&mut state).unwrap(), None);
        assert_eq!(take_next(&mut state).unwrap(), Some(ordinary.clone()));
        assert_eq!(
            submit_checked(&mut state, "active-qso", &ordinary_checked, ordinary).unwrap()["status"],
            "uncertain"
        );
        assert_eq!(
            complete_after_admission(
                &mut state,
                "40000000-0000-4000-8000-000000000002",
                "applied",
                None,
                8,
            )
            .unwrap()["status"],
            "applied"
        );
    }

    #[test]
    fn escape_accepts_an_older_ready_projection_but_rejects_future_and_expired_contexts() {
        let current = context();
        let mut state = State {
            context: Some(current),
            ..State::default()
        };
        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();

        let mut stale_escape = escape_with_request("40000000-0000-4000-8000-000000000010");
        stale_escape["projectionRevision"] = json!(6);
        let stale_escape_checked = validate_action_envelope(&stale_escape).unwrap();
        submit_after_admission(
            &mut state,
            "active-qso",
            &stale_escape_checked,
            stale_escape,
        )
        .unwrap();
        assert_eq!(
            state.panels["active-qso"].receipts.back().unwrap().1.projection_revision,
            7
        );

        let mut future_escape = escape_with_request("40000000-0000-4000-8000-000000000011");
        future_escape["projectionRevision"] = json!(8);
        let future_escape_checked = validate_action_envelope(&future_escape).unwrap();
        assert!(submit_after_admission(
            &mut state,
            "active-qso",
            &future_escape_checked,
            future_escape,
        )
        .is_err());

        let mut stale_ordinary = checked_value();
        stale_ordinary["requestID"] = json!("40000000-0000-4000-8000-000000000012");
        stale_ordinary["projectionRevision"] = json!(6);
        let stale_ordinary_checked = validate_action_envelope(&stale_ordinary).unwrap();
        assert!(submit_after_admission(
            &mut state,
            "active-qso",
            &stale_ordinary_checked,
            stale_ordinary,
        )
        .is_err());

        let mut wrong_context = escape_with_request("40000000-0000-4000-8000-000000000013");
        wrong_context["sessionID"] = json!("20000000-0000-4000-8000-000000000002");
        let wrong_context_checked = validate_action_envelope(&wrong_context).unwrap();
        assert!(submit_after_admission(
            &mut state,
            "active-qso",
            &wrong_context_checked,
            wrong_context,
        )
        .is_err());
        assert_eq!(state.escape_actions.len(), 1);
        assert_eq!(state.panels["active-qso"].receipts.len(), 1);
    }

    #[test]
    fn escape_lane_is_bounded_and_context_replacement_purges_it() {
        let current = context();
        let mut state = State {
            context: Some(current.clone()),
            ..State::default()
        };
        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        for index in 0..MAX_ESCAPE_ACTIONS {
            let envelope = escape_with_request(&format!("40000000-0000-4000-8000-{index:012x}"));
            let checked = validate_action_envelope(&envelope).unwrap();
            submit_checked(&mut state, "active-qso", &checked, envelope).unwrap();
        }
        let excess = escape_with_request("40000000-0000-4000-8000-000000000099");
        let excess_checked = validate_action_envelope(&excess).unwrap();
        assert!(submit_checked(&mut state, "active-qso", &excess_checked, excess).is_err());
        assert_eq!(state.escape_actions.len(), MAX_ESCAPE_ACTIONS);
        assert!(state.actions.is_empty());
        assert_eq!(take_next(&mut state).unwrap(), None);

        let replacement = ContestWindowContext {
            session_id: "20000000-0000-4000-8000-000000000002".into(),
            ..current
        };
        register_context_in(&mut state, &replacement);
        assert!(state.escape_actions.is_empty());
        assert!(state.actions.is_empty());
        assert!(state.panels.is_empty());
        assert!(state.seen_request_ids.is_empty());
    }

    #[test]
    fn completed_escape_receipts_reuse_only_the_reserved_escape_capacity() {
        let mut state = State {
            context: Some(context()),
            ..State::default()
        };
        publish_after_admission(&mut state, "active-qso", 7, json!({"status":"ready"})).unwrap();
        let panel = state.panels.get_mut("active-qso").unwrap();
        for index in 0..(MAX_RECEIPTS_PER_PANEL - 1) {
            let request_id = format!("50000000-0000-4000-8000-{index:012x}");
            panel.receipts.push_back((request_id, retained_receipt(&checked_value(), "uncertain", None, 7)));
        }
        for index in 0..MAX_ESCAPE_ACTIONS {
            let request_id = format!("60000000-0000-4000-8000-{index:012x}");
            panel.receipts.push_back((request_id.clone(), retained_receipt(
                &escape_with_request(&request_id), "applied", None, 8,
            )));
        }
        let ordinary = checked_value();
        let ordinary_checked = validate_action_envelope(&ordinary).unwrap();
        submit_checked(&mut state, "active-qso", &ordinary_checked, ordinary).unwrap();
        let envelope = escape_with_request("70000000-0000-4000-8000-000000000001");
        let checked = validate_action_envelope(&envelope).unwrap();
        submit_checked(&mut state, "active-qso", &checked, envelope).unwrap();
        assert_eq!(state.panels["active-qso"].receipts.len(),
                   MAX_RECEIPTS_PER_PANEL + MAX_ESCAPE_ACTIONS);
        assert_eq!(state.escape_actions.len(), 1);
        assert_eq!(state.panels["active-qso"].receipts.iter()
            .filter(|(_, receipt)| !is_escape_action(&receipt.envelope)).count(),
            MAX_RECEIPTS_PER_PANEL);
        assert_eq!(state.panels["active-qso"].receipts.iter()
            .filter(|(_, receipt)| is_escape_action(&receipt.envelope)).count(),
            MAX_ESCAPE_ACTIONS);
    }

    fn checked_value() -> Value {
        action(
            "entry_commit",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2}),
        )
    }

    fn action_with_request(request_id: &str) -> Value {
        let mut value = checked_value();
        value["requestID"] = json!(request_id);
        value
    }

    fn escape_with_request(request_id: &str) -> Value {
        let mut value = action(
            "entry_operator_key",
            "active-qso",
            json!({"draftID":"draft","expectedDraftRevision":2,"key":"Escape","focusedField":null}),
        );
        value["requestID"] = json!(request_id);
        value
    }

    fn rate_projection() -> Value {
        json!({"schemaVersion":1,"status":"ready","sessionRevision":7,
            "asOfUTC":"2026-10-18T00:00:00.000Z","fullLogQSOs":3,"loggedQSOs":2,
            "acceptedQSOs":1,"duplicateQSOs":1,"invalidQSOs":0,"currentHourQSOs":2,
            "operatorStyles":{"total":{"run":1,"searchAndPounce":0,"unknown":1},
                "currentHour":{"run":1,"searchAndPounce":0,"unknown":1}},
            "trailing60Minutes":{"qsoCount":2,"spanSeconds":60.0,"qsosPerHour":120.0},
            "latest10":null,"latest100":null,"busy":false})
    }

    fn statistics_v2() -> Value {
        json!({"schemaVersion":2,"status":"ready","score":{"qsos":3,"points":3,"multipliers":2,
                "claimedScore":6,"multiplierLabels":["country:K","country:DL"],
                "multiplierDisplayLabels":["United States","Germany"],"sourceVerification":"verified"},
            "busy":false,"sessionRevision":7,"asOfUTC":"2026-10-18T00:00:00.000Z",
            "fullLogQSOs":3,"loggedQSOs":2,"acceptedQSOs":1,"duplicateQSOs":1,"invalidQSOs":0,
            "bands":[{"band":"20m","loggedQSOs":2,"acceptedQSOs":1,"distinctCallsigns":1,
                "modes":{"cw":2,"phone":0,"digital":0,"other":0},"distinctWPXPrefixes":1,
                "creditedPoints":3}],
            "total":{"band":"total","loggedQSOs":2,"acceptedQSOs":1,"distinctCallsigns":1,
                "modes":{"cw":2,"phone":0,"digital":0,"other":0},"distinctWPXPrefixes":1,
                "creditedPoints":3}})
    }

    fn statistics_v3() -> Value {
        json!({"schemaVersion":3,"status":"ready","score":{"qsos":3,"points":5,"multipliers":2,
                "claimedScore":10,"multiplierLabels":["prefix:DL","prefix:K"],
                "multiplierDisplayLabels":["DL","K"],"sourceVerification":"verified"},
            "rows":[
                {"band":"14.0","qsos":2,"calls":1,"cw":1,"phone":1,"digital":0,"wpx":1,"points":3},
                {"band":"0.0","qsos":1,"calls":1,"cw":0,"phone":0,"digital":0,"wpx":1,"points":2}
            ],
            "total":{"band":"TOTAL","qsos":3,"calls":1,"cw":1,"phone":1,"digital":0,"wpx":2,"points":5},
            "busy":false})
    }

    fn entry_v2() -> Value {
        json!({"schemaVersion":2,"status":"ready","session":{"name":"CQ WW","ruleName":"CQ WW CW","mode":"CW"},
            "draft":{"draftID":"draft","revision":2,"callsign":"DL1AAA","sentReport":"599","receivedReport":"599",
                "receivedFields":[],"frequencyHz":14025000,"frequencyText":"14025000","frequencyError":"",
                "band":"20m","mode":"CW","dupe":{"state":"clear","reason":"Not worked on 20m."},
                "validation":{"errors":[],"warnings":[]},"reservedSerial":null},
            "descriptor":{"bands":["20m"],"modes":["CW"],"reportsVisible":false,
                "keyBindings":[{"context":"*","key":"Ctrl+R","action":"TOGGLE_RUN"}],
                "sentFields":[{"id":"zone","label":"CQ zone","value":"15","required":true,"maximumUTF8Bytes":2}],
                "serial":{"requirement":"none","allocatedFieldID":null,"reservedSerial":null}},
            "operator":{"output":"simulation-only","armed":true,"style":"run","status":"armed","pending":null,
                "focusedField":"other_2",
                "tabNext":{"callsign":"sent","sent":"receive","receive":"other_1","other_1":"other_2","other_2":"callsign"},
                "tabPrevious":{"callsign":"other_2","sent":"callsign","receive":"sent","other_1":"receive","other_2":"other_1"},
                "functionKeys":[{"key":"F1","macro":"CQ"},{"key":"F2","macro":"EXCH"}],
                "readiness":{"canSendCQ":true,"canSendCall":true,"canSendDuplicate":true,
                    "canReserveCall":true,"canReserveCommit":true,"canCommit":true},
                "trace":[{"operationID":"simulation-1","mode":"CW","macro":"CQ","text":"CQ TEST","status":"confirmed"}]},
            "busy":false,"dirty":true,"uncertain":false})
    }

    #[test]
    fn contest_rotor_target_uses_only_the_retained_active_entry_projection() {
        assert!(rotor_target("rotor", &context()).is_err());
        assert!(rotor_target("contest--band-maps", &context()).is_err());
        let mut entry = entry_v2();
        entry["manual"] = json!({"operator":"OM0RX","cwSpeedWpm":27,"country":"Germany","cqZone":14,"ituZone":28,
            "headingDegrees":123.4,"longPathHeadingDegrees":303.4,"distanceKm":9000,"qsos":1,"multipliers":1,"total":1});
        assert_eq!(rotor_target_projection(8, &entry), json!({"available":true,"projectionRevision":8,"callsign":"DL1AAA",
            "shortPathBearing":123.4,"longPathBearing":303.4}));
        entry["draft"]["callsign"] = json!("");
        assert_eq!(rotor_target_projection(9, &entry)["available"], false);
        assert_eq!(rotor_target_projection(10, &json!({"schemaVersion":1,"status":"unavailable"})),
            json!({"available":false,"projectionRevision":10,"callsign":null,"shortPathBearing":null,"longPathBearing":null}));
    }
}
