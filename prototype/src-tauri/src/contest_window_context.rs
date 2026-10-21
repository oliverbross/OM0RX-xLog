//! In-memory admission for detached contest projections.
//! The worker response establishes session identity; renderer state never does.
use serde_json::Value;
use std::sync::{Mutex, OnceLock};

const MAX_TICKET: u64 = 9_007_199_254_740_991;
static AUTHORITY: OnceLock<Mutex<ContestWindowContextAuthority>> = OnceLock::new();

fn authority() -> &'static Mutex<ContestWindowContextAuthority> {
    AUTHORITY.get_or_init(|| Mutex::new(ContestWindowContextAuthority::default()))
}

pub fn begin(request: &Value) -> Result<u64, String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    authority().lock().map_err(|_| "Contest window context unavailable")?.begin(&module, request)
}

pub fn complete(ticket: u64, response: &Value) -> Result<ContestWindowContext, String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    authority().lock().map_err(|_| "Contest window context unavailable")?.complete(ticket, &module, response)
}

pub fn admit(context: &ContestWindowContext) -> Result<(), String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    authority().lock().map_err(|_| "Contest window context unavailable")?.admit(&module, context)
}
pub fn with_admitted<T>(context: &ContestWindowContext, action: impl FnOnce() -> T) -> Result<T, String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    let authority = authority().lock().map_err(|_| "Contest window context unavailable")?;
    authority.admit(&module, context)?;
    Ok(action())
}

pub fn resolve(session_id: &str, workspace_generation: &str) -> Result<ContestWindowContext, String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    authority().lock().map_err(|_| "Contest window context unavailable")?
        .resolve(&module, session_id, workspace_generation)
}
pub fn resolve_workspace(workspace_generation: &str) -> Result<ContestWindowContext, String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    authority().lock().map_err(|_| "Contest window context unavailable")?
        .resolve_workspace(&module, workspace_generation)
}
pub fn active() -> Result<ContestWindowContext, String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    let authority = authority().lock().map_err(|_| "Contest window context unavailable")?;
    let context = authority.active.as_ref().ok_or("No contest session is active.")?.clone();
    authority.admit(&module, &context)?;
    Ok(context)
}

pub fn invalidate() {
    if let Ok(mut authority) = authority().lock() { authority.invalidate(); }
}
pub fn invalidate_if(context: &ContestWindowContext) -> bool {
    authority().lock().is_ok_and(|mut authority| authority.invalidate_if(context))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContestWindowContext {
    pub operating_context: String,
    pub session_id: String,
    pub workspace_generation: String,
}

#[derive(Clone, Debug)]
struct PendingContext {
    ticket: u64,
    operating_context: String,
    session_id: String,
    workspace_generation: String,
}

#[derive(Default, Debug)]
pub struct ContestWindowContextAuthority {
    issued_ticket: u64,
    pending: Option<PendingContext>,
    active: Option<ContestWindowContext>,
}

impl ContestWindowContextAuthority {
    pub fn begin(&mut self, module: &Value, request: &Value) -> Result<u64, String> {
        let operating_context = active_contest_context(module)?;
        let method = request["method"].as_str().unwrap_or("");
        if !matches!(
            method,
            "contest_create" | "contest_session_create" | "contest_open" | "contest_legacy_import"
        ) {
            return Err("Only a contest session open can establish detached window context.".into());
        }
        let supplied_context = canonical_uuid(&request["operatingContext"], "operating context")?;
        if supplied_context != operating_context {
            return Err("That contest window request belongs to an expired operating context.".into());
        }
        let session_id = canonical_uuid(&request["params"]["sessionID"], "contest session")?;
        let workspace_generation = canonical_uuid(&request["params"]["workspaceGeneration"], "contest workspace")?;
        let ticket = self.issued_ticket.checked_add(1).filter(|ticket| *ticket <= MAX_TICKET)
            .ok_or("Contest window context tickets exhausted; restart the application.")?;
        self.issued_ticket = ticket;
        self.pending = Some(PendingContext {
            ticket,
            operating_context: operating_context.into(),
            session_id: session_id.into(),
            workspace_generation: workspace_generation.into(),
        });
        Ok(ticket)
    }

    pub fn complete(&mut self, ticket: u64, module: &Value, response: &Value) -> Result<ContestWindowContext, String> {
        let pending = self.pending.as_ref().filter(|pending| pending.ticket == ticket)
            .ok_or("That contest session response was superseded.")?;
        let current = active_contest_context(module)?;
        if current != pending.operating_context {
            return Err("That contest session response belongs to an expired operating context.".into());
        }
        if response["ok"] != true {
            return Err("The contest session was not opened.".into());
        }
        let result = &response["result"];
        let session = if result["projection"].is_object() { &result["projection"] } else { &result["session"] };
        let session_id = canonical_uuid(&session["sessionID"], "contest session")?;
        let workspace_generation = canonical_uuid(&session["workspaceGeneration"], "contest workspace")?;
        if session_id != pending.session_id || workspace_generation != pending.workspace_generation {
            return Err("The contest session response did not match its request.".into());
        }
        if result["projection"].is_object() {
            canonical_uuid(&session["draftID"], "contest draft")?;
        } else {
            let draft = &result["draft"];
            if canonical_uuid(&draft["sessionID"], "contest draft session")? != session_id
                || canonical_uuid(&draft["workspaceGeneration"], "contest draft workspace")? != workspace_generation {
                return Err("The contest session response contains a mismatched draft.".into());
            }
        }
        let context = ContestWindowContext {
            operating_context: pending.operating_context.clone(),
            session_id: pending.session_id.clone(),
            workspace_generation: pending.workspace_generation.clone(),
        };
        self.pending = None;
        self.active = Some(context.clone());
        Ok(context)
    }

    pub fn admit(&self, module: &Value, context: &ContestWindowContext) -> Result<(), String> {
        let current = active_contest_context(module)?;
        if current != context.operating_context || self.active.as_ref() != Some(context) {
            return Err("That contest window belongs to an expired session context.".into());
        }
        Ok(())
    }

    pub fn resolve(&self, module: &Value, session_id: &str, workspace_generation: &str) -> Result<ContestWindowContext, String> {
        canonical_uuid_text(session_id, "contest session")?;
        canonical_uuid_text(workspace_generation, "contest workspace")?;
        let context = self.active.as_ref().filter(|context|
            context.session_id == session_id && context.workspace_generation == workspace_generation)
            .ok_or("That contest window belongs to an expired session context.")?.clone();
        self.admit(module, &context)?;
        Ok(context)
    }

    pub fn resolve_workspace(&self, module: &Value, workspace_generation: &str) -> Result<ContestWindowContext, String> {
        canonical_uuid_text(workspace_generation, "contest workspace")?;
        let context = self.active.as_ref().filter(|context|
            context.workspace_generation == workspace_generation)
            .ok_or("That contest window belongs to an expired session context.")?.clone();
        self.admit(module, &context)?;
        Ok(context)
    }

    #[cfg(test)]
    pub fn close(&mut self, module: &Value, context: &ContestWindowContext) -> Result<(), String> {
        self.admit(module, context)?;
        self.invalidate();
        Ok(())
    }

    pub fn invalidate(&mut self) {
        self.pending = None;
        self.active = None;
    }
    pub fn invalidate_if(&mut self, context: &ContestWindowContext) -> bool {
        if self.active.as_ref() != Some(context) { return false; }
        self.active = None;
        true
    }
}

fn active_contest_context(module: &Value) -> Result<&str, String> {
    if module["transitioning"] != false {
        return Err("The application operation context is changing.".into());
    }
    canonical_uuid(&module["context"], "operating context")
}

fn canonical_uuid<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    let value = value.as_str().ok_or_else(|| format!("The {name} is missing."))?;
    canonical_uuid_text(value, name)
}
fn canonical_uuid_text<'a>(value: &'a str, name: &str) -> Result<&'a str, String> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| format!("The {name} is invalid."))?;
    if parsed.to_string() != value { return Err(format!("The {name} is invalid.")); }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const OPERATING_A: &str = "10000000-0000-4000-8000-000000000001";
    const OPERATING_B: &str = "10000000-0000-4000-8000-000000000002";
    const SESSION_A: &str = "20000000-0000-4000-8000-000000000001";
    const SESSION_B: &str = "20000000-0000-4000-8000-000000000002";
    const WORKSPACE: &str = "30000000-0000-4000-8000-000000000001";
    const DRAFT: &str = "40000000-0000-4000-8000-000000000001";

    fn module(context: &str) -> Value {
        json!({"selected":"normal_logging","context":context,"transitioning":false})
    }
    fn request(method: &str, operating: &str, session: &str) -> Value {
        json!({"method":method,"operatingContext":operating,
            "params":{"sessionID":session,"workspaceGeneration":WORKSPACE}})
    }
    fn response(session: &str) -> Value {
        json!({"ok":true,"result":{"session":{"sessionID":session,"workspaceGeneration":WORKSPACE},
            "draft":{"draftID":DRAFT,"sessionID":session,"workspaceGeneration":WORKSPACE}}})
    }
    fn python_response(session: &str) -> Value {
        json!({"ok":true,"result":{"projection":{"sessionID":session,
            "workspaceGeneration":WORKSPACE,"draftID":DRAFT}}})
    }
    fn context(operating: &str, session: &str) -> ContestWindowContext {
        ContestWindowContext { operating_context: operating.into(), session_id: session.into(), workspace_generation: WORKSPACE.into() }
    }

    #[test]
    fn successful_worker_open_establishes_exact_context_and_close_invalidates_it() {
        let mut authority = ContestWindowContextAuthority::default();
        let ticket = authority.begin(&module(OPERATING_A), &request("contest_open", OPERATING_A, SESSION_A)).unwrap();
        assert_eq!(authority.complete(ticket, &module(OPERATING_A), &response(SESSION_A)).unwrap(), context(OPERATING_A, SESSION_A));
        authority.admit(&module(OPERATING_A), &context(OPERATING_A, SESSION_A)).unwrap();
        assert_eq!(authority.resolve(&module(OPERATING_A), SESSION_A, WORKSPACE).unwrap(), context(OPERATING_A, SESSION_A));
        assert_eq!(authority.resolve_workspace(&module(OPERATING_A), WORKSPACE).unwrap(), context(OPERATING_A, SESSION_A));
        assert!(authority.resolve(&module(OPERATING_A), SESSION_B, WORKSPACE).is_err());
        assert!(authority.resolve_workspace(&module(OPERATING_A), "30000000-0000-4000-8000-000000000002").is_err());
        assert!(authority.admit(&module(OPERATING_A), &context(OPERATING_A, SESSION_B)).is_err());
        authority.close(&module(OPERATING_A), &context(OPERATING_A, SESSION_A)).unwrap();
        assert!(authority.admit(&module(OPERATING_A), &context(OPERATING_A, SESSION_A)).is_err());
    }

    #[test]
    fn python_create_projection_establishes_the_same_exact_context() {
        let mut authority = ContestWindowContextAuthority::default();
        let ticket = authority.begin(&module(OPERATING_A), &request("contest_session_create", OPERATING_A, SESSION_A)).unwrap();
        assert_eq!(authority.complete(ticket, &module(OPERATING_A), &python_response(SESSION_A)).unwrap(),
            context(OPERATING_A, SESSION_A));

        let imported = authority.begin(
            &module(OPERATING_A),
            &request("contest_legacy_import", OPERATING_A, SESSION_B),
        ).unwrap();
        assert_eq!(
            authority.complete(imported, &module(OPERATING_A), &python_response(SESSION_B)).unwrap(),
            context(OPERATING_A, SESSION_B),
        );
    }

    #[test]
    fn late_reply_cannot_reinstate_prior_session_or_operating_context() {
        let mut authority = ContestWindowContextAuthority::default();
        let old = authority.begin(&module(OPERATING_A), &request("contest_open", OPERATING_A, SESSION_A)).unwrap();
        let current = authority.begin(&module(OPERATING_A), &request("contest_open", OPERATING_A, SESSION_B)).unwrap();
        assert!(authority.complete(old, &module(OPERATING_A), &response(SESSION_A)).is_err());
        authority.complete(current, &module(OPERATING_A), &response(SESSION_B)).unwrap();
        assert!(!authority.invalidate_if(&context(OPERATING_A, SESSION_A)));
        authority.admit(&module(OPERATING_A), &context(OPERATING_A, SESSION_B)).unwrap();
        assert!(authority.admit(&module(OPERATING_B), &context(OPERATING_A, SESSION_B)).is_err());
        authority.invalidate();
        assert!(authority.admit(&module(OPERATING_A), &context(OPERATING_A, SESSION_B)).is_err());
    }

    #[test]
    fn malformed_mismatched_and_inactive_inputs_fail_closed() {
        let mut authority = ContestWindowContextAuthority::default();
        for bad in [
            json!({"selected":"normal_logging","context":OPERATING_A,"transitioning":true}),
            json!({"selected":"contesting","context":OPERATING_A,"transitioning":true}),
        ] {
            assert!(authority.begin(&bad, &request("contest_open", OPERATING_A, SESSION_A)).is_err());
        }
        for bad in ["", "NOT-A-UUID", "20000000-0000-4000-8000-00000000000A"] {
            assert!(authority.begin(&module(OPERATING_A), &request("contest_open", OPERATING_A, bad)).is_err());
        }
        assert!(authority.begin(&module(OPERATING_A), &request("contest_score", OPERATING_A, SESSION_A)).is_err());
        let ticket = authority.begin(&module(OPERATING_A), &request("contest_create", OPERATING_A, SESSION_A)).unwrap();
        assert!(authority.complete(ticket, &module(OPERATING_A), &response(SESSION_B)).is_err());
        let mut mismatched_draft = response(SESSION_A);
        mismatched_draft["result"]["draft"]["sessionID"] = json!(SESSION_B);
        assert!(authority.complete(ticket, &module(OPERATING_A), &mismatched_draft).is_err());
        assert!(authority.complete(ticket, &module(OPERATING_B), &response(SESSION_A)).is_err());
    }
}
