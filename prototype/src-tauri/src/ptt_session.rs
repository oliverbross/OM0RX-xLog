//! Durable GUI PTT ownership. Review retires uncertainty, never a release duty.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
pub type Target = crate::carrier_tune::Target;
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    operation_id: String,
    enabled: bool,
    owner_id: String,
    target: Target,
    status: String,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Obligation {
    owner_id: String,
    target: Target,
    #[serde(default)]
    worker_epoch: Option<String>,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    version: u8,
    receipts: Vec<Receipt>,
    release_required: Option<Obligation>,
    #[serde(default)]
    recoveries: Vec<Recovery>,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Recovery {
    operation_id: String,
    enabled: bool,
    #[serde(default)]
    worker_epoch: Option<String>,
    owner_id: String,
    retired_target: Target,
    target: Target,
    status: String,
}
pub struct Session {
    path: PathBuf,
    state: Mutex<Saved>,
    on: Mutex<()>,
    off: Mutex<()>,
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| !id.is_nil())
}
fn same_session(a: &Target, b: &Target) -> bool {
    a.provider == b.provider
        && a.selection_generation == b.selection_generation
        && a.selection_id == b.selection_id
        && a.worker_generation == b.worker_generation
        && a.connection_generation == b.connection_generation
}
fn unresolved(r: &Receipt) -> bool {
    matches!(r.status.as_str(), "pending" | "unknown")
}
fn retire_release(saved: &mut Saved, owner: &str) {
    saved.release_required = None;
    // RX proof retires an acknowledged acquisition, without inventing TX-on
    // confirmation. Unknown acquisition history still requires explicit review.
    for r in &mut saved.receipts {
        if r.owner_id == owner && r.enabled && r.status == "acknowledged" {
            r.status = "released".into();
        }
    }
}
pub fn validate(label: &str, isolated: bool, exiting: bool, action: &str) -> Result<(), String> {
    if isolated
        || exiting
        || label != "main"
        || !matches!(
            action,
            "snapshot" | "prepare" | "on" | "off" | "receipt" | "review" | "recover"
        )
    {
        return Err("GUI PTT is available only in the main station controls".into());
    }
    Ok(())
}
impl Session {
    fn new(path: PathBuf) -> Result<Self, String> {
        let mut saved = match std::fs::read(&path) {
            Ok(b) => serde_json::from_slice::<Saved>(&b)
                .map_err(|_| "Invalid PTT journal; it was not overwritten")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Saved {
                version: 1,
                receipts: vec![],
                release_required: None,
                recoveries: vec![],
            },
            Err(_) => return Err("PTT journal unavailable".into()),
        };
        if saved.version != 1 {
            return Err("Unsupported PTT journal".into());
        }
        let mut ids = std::collections::HashSet::new();
        for r in &mut saved.receipts {
            r.target.validate()?;
            if !uuid(&r.operation_id)
                || !uuid(&r.owner_id)
                || !ids.insert(r.operation_id.clone())
                || !matches!(
                    r.status.as_str(),
                    "pending" | "unknown" | "acknowledged" | "confirmed" | "released" | "reviewed"
                )
            {
                return Err("Invalid PTT receipt".into());
            }
            if r.status == "pending" {
                r.status = "unknown".into();
            }
        }
        if let Some(o) = &saved.release_required {
            o.target.validate()?;
            if !uuid(&o.owner_id)
                || o.worker_epoch.as_ref().is_some_and(|epoch| !uuid(epoch))
                || !saved.receipts.iter().any(|r| {
                    r.enabled && r.owner_id == o.owner_id && same_session(&r.target, &o.target)
                })
            {
                return Err("Invalid PTT release obligation".into());
            }
        }
        for r in &saved.recoveries {
            r.target.validate()?;
            r.retired_target.validate()?;
            if !uuid(&r.operation_id)
                || !uuid(&r.owner_id)
                || r.enabled
                || r.status != "recovered"
                || !ids.insert(r.operation_id.clone())
            {
                return Err("Invalid PTT recovery decision".into());
            }
        }
        Ok(Self {
            path,
            state: Mutex::new(saved),
            on: Mutex::new(()),
            off: Mutex::new(()),
        })
    }
    fn persist(&self, s: &Saved) -> Result<(), String> {
        let parent = self.path.parent().ok_or("PTT storage unavailable")?;
        std::fs::create_dir_all(parent).map_err(|_| "PTT storage unavailable")?;
        let mut f =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "PTT receipt save failed")?;
        f.write_all(&serde_json::to_vec(s).map_err(|_| "PTT serialization failed")?)
            .map_err(|_| "PTT receipt save failed")?;
        f.as_file()
            .sync_all()
            .map_err(|_| "PTT receipt save failed")?;
        f.persist(&self.path)
            .map_err(|_| "PTT receipt save failed")?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Value, String> {
        let s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
        Ok(
            json!({"receipts":s.receipts.iter().filter(|r|unresolved(r)||r.status=="acknowledged").collect::<Vec<_>>(),"release_required":s.release_required}),
        )
    }
    pub fn require_idle(&self) -> Result<(), String> {
        let s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
        if s.release_required.is_some() || s.receipts.iter().any(unresolved) {
            return Err(
                "Resolve owned GUI PTT with PTT off and newer RX proof before another acquisition"
                    .into(),
            );
        }
        Ok(())
    }
    pub fn receipt(&self, id: &str) -> Result<Value, String> {
        let s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
        if let Some(r) = s.recoveries.iter().find(|r| r.operation_id == id) {
            return Ok(json!(r));
        }
        Ok(s.receipts
            .iter()
            .find(|r| r.operation_id == id)
            .map_or(Value::Null, |r| json!(r)))
    }
    pub fn review(&self, id: &str) -> Result<Value, String> {
        let mut s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
        let mut next = s.clone();
        let r = next
            .receipts
            .iter_mut()
            .find(|r| r.operation_id == id)
            .ok_or("PTT receipt missing")?;
        if r.status != "unknown" && r.status != "reviewed" {
            return Err("Only an unknown PTT receipt may be reviewed".into());
        }
        r.status = "reviewed".into();
        let v = json!(r);
        self.persist(&next)?;
        *s = next;
        Ok(v)
    }
    pub fn recover(
        &self,
        id: &str,
        owner_id: &str,
        target: Target,
        prove: impl FnOnce(&Target, &Target) -> Result<(), String>,
    ) -> Result<Value, String> {
        target.validate()?;
        if !uuid(id) || !uuid(owner_id) {
            return Err("Invalid PTT recovery identity".into());
        }
        let _output = crate::carrier_tune::reserve_output()?;
        let _on = self
            .on
            .try_lock()
            .map_err(|_| "PTT acquisition still pending")?;
        let _off = self
            .off
            .try_lock()
            .map_err(|_| "PTT release still pending")?;
        let mut s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
        if let Some(r) = s.recoveries.iter().find(|r| r.operation_id == id) {
            if r.owner_id != owner_id || r.target != target {
                return Err("PTT recovery identity collision".into());
            }
            return Ok(json!(r));
        }
        if s.receipts.iter().any(|r| r.operation_id == id) {
            return Err("PTT recovery identity collision".into());
        }
        let duty = s
            .release_required
            .as_ref()
            .ok_or("No retired PTT duty to recover")?;
        if duty.owner_id != owner_id {
            return Err("PTT owner changed before recovery".into());
        }
        if duty.worker_epoch.as_deref() != Some(crate::worker::process_epoch()) {
            return Err("Original PTT worker process epoch is unavailable or retired in a previous app; recovery denied".into());
        }
        crate::carrier_tune::revoke_output_intent()?;
        prove(&duty.target, &target)?;
        let decision = Recovery {
            operation_id: id.into(),
            enabled: false,
            worker_epoch: duty.worker_epoch.clone(),
            owner_id: owner_id.into(),
            retired_target: duty.target.clone(),
            target,
            status: "recovered".into(),
        };
        let mut next = s.clone();
        retire_release(&mut next, owner_id);
        for r in &mut next.receipts {
            if r.owner_id == owner_id && unresolved(r) {
                r.status = "reviewed".into();
            }
        }
        next.recoveries.push(decision.clone());
        self.persist(&next)?;
        *s = next;
        Ok(json!(decision))
    }
    pub fn reconcile(&self, radio: &Value) -> Result<(), String> {
        let mut s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
        let Some(owner) = s.release_required.clone() else {
            return Ok(());
        };
        let t = &owner.target;
        if owner.worker_epoch.as_deref() != Some(crate::worker::process_epoch())
            || radio["available"] != true
            || radio["provider"] != t.provider
            || radio["selection_generation"] != t.selection_generation
            || radio["selection_id"] != t.selection_id
            || radio["worker_generation"] != t.worker_generation
            || radio["snapshot"]["generation"] != t.connection_generation
            || radio["snapshot"]["source"] != t.provider
        {
            return Ok(());
        }
        let proof = &radio["snapshot"]["ptt"];
        if proof["owner_id"] != owner.owner_id
            || proof["source"] != "gui"
            || proof["confirmed"] != true
        {
            return Ok(());
        }
        let Some(on) = proof["transmitting"].as_bool() else {
            return Ok(());
        };
        if proof["pending"] != false || proof["release_required"] != on {
            return Ok(());
        }
        let mut next = s.clone();
        for r in &mut next.receipts {
            if r.owner_id == owner.owner_id
                && r.enabled == on
                && matches!(r.status.as_str(), "unknown" | "acknowledged" | "reviewed")
            {
                r.status = "confirmed".into();
            }
        }
        if !on
            && !next
                .receipts
                .iter()
                .any(|r| r.enabled && r.owner_id == owner.owner_id && r.status == "pending")
            && next
                .receipts
                .iter()
                .any(|r| !r.enabled && r.owner_id == owner.owner_id && r.status == "confirmed")
        {
            retire_release(&mut next, &owner.owner_id);
        }
        if next == *s {
            return Ok(());
        }
        self.persist(&next)?;
        *s = next;
        Ok(())
    }
    #[cfg(test)]
    fn apply(
        &self,
        id: &str,
        on: bool,
        target: Target,
        intent: &str,
        dispatch: impl FnOnce(Value, &Target) -> Result<Value, String>,
    ) -> Result<Value, String> {
        self.apply_admitted(id, on, target, intent, |_| Ok(()), dispatch)
    }
    pub fn apply_admitted(
        &self,
        id: &str,
        on: bool,
        target: Target,
        intent: &str,
        admit: impl FnOnce(&Target) -> Result<(), String>,
        dispatch: impl FnOnce(Value, &Target) -> Result<Value, String>,
    ) -> Result<Value, String> {
        target.validate()?;
        if !uuid(id) {
            return Err("Invalid PTT identity".into());
        }
        let duplicate = |s: &Saved| -> Result<Option<Value>, String> {
            if s.recoveries.iter().any(|r| r.operation_id == id) {
                return Err("PTT identity collision".into());
            }
            if let Some(r) = s.receipts.iter().find(|r| r.operation_id == id) {
                if r.enabled != on || r.target != target {
                    return Err("PTT identity collision".into());
                }
                return Ok(Some(json!(r)));
            }
            Ok(None)
        };
        {
            let s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
            if let Some(r) = duplicate(&s)? {
                return Ok(r);
            }
        }
        if !on {
            crate::carrier_tune::revoke_output_intent()?;
        }
        let _output = if on {
            Some(crate::carrier_tune::reserve_output()?)
        } else {
            None
        };
        let _lane = if on {
            self.on.try_lock()
        } else {
            self.off.try_lock()
        }
        .map_err(|_| "This PTT lane is busy; release remains independent of acquisition")?;
        // The shared output guard already excludes CW/Tune preparation. Reject
        // known stale/not-ready acquisition before creating a release duty.
        admit(&target)?;
        let owner_id;
        {
            let mut s = self.state.lock().map_err(|_| "PTT journal unavailable")?;
            if let Some(r) = duplicate(&s)? {
                return Ok(r);
            }
            if on {
                crate::carrier_tune::require_output_intent(intent)?;
                if s.release_required.is_some() || s.receipts.iter().any(unresolved) {
                    return Err("PTT release or receipt review remains required".into());
                }
                owner_id = id.to_owned();
            } else {
                let o = s
                    .release_required
                    .as_ref()
                    .ok_or("No retained GUI PTT owner may be released")?;
                if o.worker_epoch.as_deref() != Some(crate::worker::process_epoch())
                    || !same_session(&o.target, &target)
                {
                    return Err(
                        "PTT owner session changed; no unrelated TX will be released".into(),
                    );
                }
                owner_id = o.owner_id.clone();
            }
            let mut next = s.clone();
            if on {
                next.release_required = Some(Obligation {
                    owner_id: owner_id.clone(),
                    target: target.clone(),
                    worker_epoch: Some(crate::worker::process_epoch().to_owned()),
                });
            }
            next.receipts.push(Receipt {
                operation_id: id.into(),
                enabled: on,
                owner_id: owner_id.clone(),
                target: target.clone(),
                status: "pending".into(),
            });
            self.persist(&next)?;
            *s = next;
        }
        let result = dispatch(
            json!({"id":id,"method":"station_radio_control","params":{"provider":target.provider,"control":"ptt","enabled":on,"source":"gui","ptt_owner_id":owner_id,"expected_generation":target.connection_generation}}),
            &target,
        );
        let mut s = self.state.lock().map_err(|_| "PTT outcome unknown")?;
        let mut next = s.clone();
        let r = next
            .receipts
            .iter_mut()
            .find(|r| r.operation_id == id)
            .ok_or("PTT receipt missing")?;
        r.status = outcome(id, on, &owner_id, &target, &result).into();
        let v = json!(r);
        if !on
            && r.status == "confirmed"
            && !next
                .receipts
                .iter()
                .any(|r| r.enabled && r.owner_id == owner_id && r.status == "pending")
        {
            retire_release(&mut next, &owner_id);
        }
        if self.persist(&next).is_err() {
            next.receipts
                .iter_mut()
                .find(|r| r.operation_id == id)
                .unwrap()
                .status = "unknown".into();
            next.release_required = s.release_required.clone();
            *s = next;
            return Err("PTT outcome could not be saved; inspect its receipt; no replay".into());
        }
        *s = next;
        Ok(v)
    }
}
fn outcome(
    id: &str,
    on: bool,
    owner: &str,
    t: &Target,
    response: &Result<Value, String>,
) -> &'static str {
    let Ok(v) = response else { return "unknown" };
    let r = &v["result"];
    let s = &r["state"];
    if v["id"] != id
        || v["ok"] != true
        || r["accepted"] != true
        || r["control"] != "ptt"
        || r["enabled"] != on
        || r["owner_id"] != owner
        || s["source"] != t.provider
        || s["generation"] != t.connection_generation
    {
        return "unknown";
    }
    if t.provider == "direct_flex_lan"
        && r["confirmed"] == true
        && s["ptt"]["source"] == "gui"
        && s["ptt"]["owner_id"] == owner
        && s["ptt"]["confirmed"] == true
        && s["ptt"]["transmitting"] == on
        && s["ptt"]["release_required"] == on
        && s["ptt"]["pending"] == false
        && s["radio"]["observed"] == true
        && s["radio"]["connected"] == true
        && s["radio"]["transmitting"] == on
    {
        "confirmed"
    } else if t.provider == "direct_agent" && r["confirmed"] == false {
        "acknowledged"
    } else {
        "unknown"
    }
}
fn admission(
    selection: &Value,
    radio: &Value,
    t: &Target,
    on: bool,
    now: u64,
    cw: &Value,
) -> Result<(), String> {
    let s = &radio["snapshot"];
    let station = &s["station"];
    let r = &s["radio"];
    let exact = selection["provider"] == t.provider
        && selection["generation"] == t.selection_generation
        && selection["selection_id"] == t.selection_id
        && selection["control_revision"] == t.control_revision
        && radio["provider"] == t.provider
        && radio["selection_generation"] == t.selection_generation
        && radio["selection_id"] == t.selection_id
        && radio["worker_generation"] == t.worker_generation
        && s["source"] == t.provider
        && s["generation"] == t.connection_generation;
    if !exact {
        return Err("PTT exact native session changed".into());
    }
    if !on {
        return Ok(());
    }
    let recent = |v: &Value, k: f64| {
        v.as_f64()
            .is_some_and(|v| v.is_finite() && (-1000.0..=3000.0).contains(&(now as f64 - v * k)))
    };
    let cap = if t.provider == "direct_agent" {
        station["supported_commands"]
            .as_array()
            .is_some_and(|v| v.contains(&json!("set_ptt")))
            && station["commissioned"] == true
            && station["radio_known"] == true
            && station["radio_stale"] == false
            && station["inhibitors"]
                .as_array()
                .is_some_and(|v| v.is_empty())
    } else {
        s["capabilities"]["supported_commands"]
            .as_array()
            .is_some_and(|v| v.contains(&json!("ptt")))
            && r["vfos"].as_array().is_some_and(|vfos| {
                vfos.iter()
                    .any(|v| v["letter"] == r["receive_vfo"] && v["receive"] == true)
                    && vfos
                        .iter()
                        .any(|v| v["letter"] == r["transmit_vfo"] && v["transmit"] == true)
            })
    };
    if !cap
        || radio["revision"] != t.observation_revision
        || radio["received_at_ms"] != t.received_at_ms
        || radio["available"] != true
        || !recent(&radio["received_at_ms"], 1.0)
        || !recent(&s["generated_at"], 1000.0)
        || !recent(&r["observed_at"], 1000.0)
        || r["connected"] != true
        || r["observed"] != true
        || r["transmitting"] != false
        || s["allow_transmit"] != true
        || s["carrier_tune"]["pending"] != false
        || s["carrier_tune"]["release_required"] != false
        || s["ptt"]["release_required"] != false
        || cw["armed"] != false
        || cw["pending"] != false
        || !cw["owner"].is_null()
        || !cw["lease"].is_null()
    {
        return Err("PTT on requires fresh idle RX, consent, capability, station readiness and no Tune/CW ownership".into());
    }
    Ok(())
}
fn cw_for_acquisition(
    on: bool,
    read: impl FnOnce() -> Result<Value, String>,
) -> Result<Value, String> {
    if on {
        read()
    } else {
        Ok(json!({"armed":false,"pending":false,"owner":null,"lease":null}))
    }
}
pub fn preflight(app: &tauri::AppHandle, t: &Target, on: bool, intent: &str) -> Result<(), String> {
    crate::worker::require_existing_generation(t.worker_generation)?;
    if on {
        crate::carrier_tune::require_output_intent(intent)?;
        crate::carrier_tune::require_cw_ready(app)?;
    }
    let selected = crate::station_selection::owner(app)?.snapshot()?;
    let radio = crate::station_telemetry::owner(app)?.snapshot()?;
    let cw = cw_for_acquisition(on, || {
        crate::cw_session_backend::existing().map_or_else(
            || Ok(json!({"armed":false,"pending":false,"owner":null,"lease":null})),
            |s| s.snapshot(),
        )
    })?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "PTT clock unavailable")?
        .as_millis() as u64;
    admission(&selected, &radio, t, on, now, &cw)
}
pub fn context(app: &tauri::AppHandle) -> Result<Value, String> {
    crate::carrier_tune::context(app)
}
fn recovery_proof(
    old: &Target,
    current: &Target,
    selected: &Value,
    radio: &Value,
    now: u64,
    retired: impl FnOnce(u64, u64) -> Result<(), String>,
) -> Result<(), String> {
    // Recovery is not a handover or permission to release an unrelated station.
    if old.provider != current.provider
        || old.selection_id != current.selection_id
        || old.selection_generation != current.selection_generation
    {
        return Err("Select the original PTT station before retired-owner recovery".into());
    }
    retired(old.worker_generation, current.worker_generation)?;
    admission(selected, radio, current, false, now, &Value::Null)?;
    let s = &radio["snapshot"];
    let r = &s["radio"];
    let recent = |v: &Value, k: f64| {
        v.as_f64()
            .is_some_and(|v| v.is_finite() && (-1000.0..=3000.0).contains(&(now as f64 - v * k)))
    };
    if radio["available"] != true
        || radio["revision"] != current.observation_revision
        || radio["received_at_ms"] != current.received_at_ms
        || !recent(&radio["received_at_ms"], 1.0)
        || !recent(&s["generated_at"], 1000.0)
        || !recent(&r["observed_at"], 1000.0)
        || r["connected"] != true
        || r["observed"] != true
        || r["transmitting"] != false
        || s["ptt"]["pending"] != false
        || s["ptt"]["release_required"] != false
        || s["carrier_tune"]["pending"] != false
        || s["carrier_tune"]["release_required"] != false
        || current.provider == "direct_agent"
            && (s["station"]["radio_known"] != true || s["station"]["radio_stale"] != false)
    {
        return Err(
            "Retired PTT recovery requires fresh authoritative RX and no current TX obligations"
                .into(),
        );
    }
    Ok(())
}
pub fn recover(
    app: &tauri::AppHandle,
    session: &Session,
    id: &str,
    owner_id: &str,
    target: Target,
) -> Result<Value, String> {
    let selection = crate::station_selection::owner(app)?;
    let expected = json!({"provider":target.provider,"generation":target.selection_generation,"selection_id":target.selection_id,"control_revision":target.control_revision});
    let _selection = selection.fence_radio_read_epoch(&expected)?;
    session.recover(id, owner_id, target, |old, t| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "PTT clock unavailable")?
            .as_millis() as u64;
        recovery_proof(
            old,
            t,
            &expected,
            &crate::station_telemetry::owner(app)?.snapshot()?,
            now,
            crate::worker::require_retired_generation,
        )
    })
}
pub fn execute(
    app: &tauri::AppHandle,
    request: Value,
    t: &Target,
    intent: &str,
) -> Result<Value, String> {
    let on = request["params"]["enabled"] == true;
    if on {
        crate::carrier_tune::require_output_intent(intent)?;
        crate::carrier_tune::require_cw_ready(app)?;
    }
    crate::worker::require_existing_generation(t.worker_generation)?;
    let selection = crate::station_selection::owner(app)?;
    let telemetry = crate::station_telemetry::owner(app)?;
    let expected = json!({"provider":t.provider,"generation":t.selection_generation,"selection_id":t.selection_id,"control_revision":t.control_revision});
    selection.ptt_control(
        request,
        &expected,
        || {
            crate::worker::require_existing_generation(t.worker_generation)?;
            if on {
                crate::carrier_tune::require_output_intent(intent)?;
            }
            let cw = cw_for_acquisition(on, || {
                crate::cw_session_backend::existing().map_or_else(
                    || Ok(json!({"armed":false,"pending":false,"owner":null,"lease":null})),
                    |s| s.snapshot(),
                )
            })?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "PTT clock unavailable")?
                .as_millis() as u64;
            admission(&expected, &telemetry.snapshot()?, t, on, now, &cw)?;
            telemetry.control()
        },
        |q| {
            if on {
                crate::carrier_tune::require_output_intent(intent)?;
            }
            let v = crate::worker::request_existing_generation(q, t.worker_generation)?;
            crate::worker::require_existing_generation(t.worker_generation)?;
            let current = selection.snapshot()?;
            if current["provider"] != t.provider
                || current["generation"] != t.selection_generation
                || current["selection_id"] != t.selection_id
                || on && current["control_revision"].as_u64() != t.control_revision.checked_add(1)
            {
                return Err("PTT action superseded; inspect its unknown receipt".into());
            }
            Ok(v)
        },
    )
}
static OWNER: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
pub fn require_idle(app: &tauri::AppHandle) -> Result<(), String> {
    let owner = owner(app)?;
    owner.reconcile(&crate::station_telemetry::owner(app)?.snapshot()?)?;
    owner.require_idle()
}
pub fn owner(app: &tauri::AppHandle) -> Result<Arc<Session>, String> {
    let mut slot = OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "PTT owner unavailable")?;
    if let Some(s) = slot.as_ref() {
        return Ok(s.clone());
    }
    let s = Arc::new(Session::new(
        app.path()
            .app_config_dir()
            .map_err(|_| "PTT storage unavailable")?
            .join("ptt-session.json"),
    )?);
    *slot = Some(s.clone());
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ptt_known_readiness_rejection_has_no_durable_release_duty_or_dispatch() {
        let _serial = crate::carrier_tune::OUTPUT_TEST.lock().unwrap();
        let (_d, s) = fixture();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(s
            .apply_admitted(
                &id,
                true,
                target(),
                &crate::carrier_tune::output_intent().unwrap(),
                |_| {
                    assert!(crate::carrier_tune::reserve_output().is_err());
                    Err("CW is armed".into())
                },
                |_, _| panic!("Rejected readiness dispatched")
            )
            .is_err());
        assert!(s.receipt(&id).unwrap().is_null());
        assert!(s.require_idle().is_ok());
        assert!(!s.path.exists());
    }
    fn target() -> Target {
        Target {
            provider: "direct_agent".into(),
            selection_generation: 2,
            selection_id: uuid::Uuid::new_v4().to_string(),
            worker_generation: 4,
            connection_generation: 7,
            control_revision: 3,
            observation_revision: 8,
            received_at_ms: 10000,
        }
    }
    fn fixture() -> (tempfile::TempDir, Session) {
        let d = tempfile::tempdir().unwrap();
        let s = Session::new(d.path().join("ptt.json")).unwrap();
        (d, s)
    }
    #[test]
    fn ptt_previous_app_worker_one_cannot_alias_new_app_retired_worker_one() {
        let _serial = crate::carrier_tune::OUTPUT_TEST.lock().unwrap();
        let (_d, s) = fixture();
        let mut old = target();
        old.worker_generation = 1;
        let owner = uuid::Uuid::new_v4().to_string();
        s.apply(
            &owner,
            true,
            old.clone(),
            &crate::carrier_tune::output_intent().unwrap(),
            |_, _| Err("lost".into()),
        )
        .unwrap();
        let mut current = old.clone();
        current.worker_generation = 2;
        // This app may really have reaped its unrelated child 1. Even a
        // successful generation-only proof must not be consulted for old-app 1.
        for epoch in [Some(uuid::Uuid::new_v4().to_string()), None] {
            {
                let mut saved = s.state.lock().unwrap();
                saved.release_required.as_mut().unwrap().worker_epoch = epoch;
                s.persist(&saved).unwrap();
            }
            let reloaded = Session::new(s.path.clone()).unwrap();
            assert!(reloaded
                .recover(
                    &uuid::Uuid::new_v4().to_string(),
                    &owner,
                    current.clone(),
                    |_, _| panic!(
                        "Unrelated current-app retired generation 1 used as old-app proof"
                    )
                )
                .is_err());
            assert!(reloaded
                .apply(
                    &uuid::Uuid::new_v4().to_string(),
                    false,
                    old.clone(),
                    "",
                    |_, _| panic!("Old-app duty dispatched Off")
                )
                .is_err());
            let before = reloaded.snapshot().unwrap();
            reloaded.reconcile(&proof(&old, &owner, false)).unwrap();
            assert_eq!(reloaded.snapshot().unwrap(), before);
            assert!(reloaded.require_idle().is_err());
        }
    }
    #[test]
    fn ptt_retired_worker_recovery_is_explicit_durable_exact_and_never_dispatches_off() {
        let _serial = crate::carrier_tune::OUTPUT_TEST.lock().unwrap();
        let (d, s) = fixture();
        let old = target();
        let owner = uuid::Uuid::new_v4().to_string();
        s.apply(
            &owner,
            true,
            old.clone(),
            &crate::carrier_tune::output_intent().unwrap(),
            |_, _| Err("lost".into()),
        )
        .unwrap();
        drop(s);
        let s = Session::new(d.path().join("ptt.json")).unwrap();
        let mut current = old.clone();
        current.worker_generation += 1;
        current.connection_generation += 1;
        let id = uuid::Uuid::new_v4().to_string();
        assert!(s.require_idle().is_err());
        assert!(s
            .apply(
                &uuid::Uuid::new_v4().to_string(),
                false,
                current.clone(),
                "",
                |_, _| panic!("Generic replacement Off dispatched")
            )
            .is_err());
        assert!(s
            .recover(
                &id,
                &owner,
                current.clone(),
                |_, _| Err("Not reaped".into())
            )
            .is_err());
        assert!(s.snapshot().unwrap()["release_required"].is_object());
        let blocked_path = d.path().join("blocked");
        std::fs::write(&blocked_path, b"fixture").unwrap();
        let blocked = Session {
            path: blocked_path.join("ptt.json"),
            state: Mutex::new(s.state.lock().unwrap().clone()),
            on: Mutex::new(()),
            off: Mutex::new(()),
        };
        assert!(blocked
            .recover(
                &uuid::Uuid::new_v4().to_string(),
                &owner,
                current.clone(),
                |_, _| Ok(())
            )
            .is_err());
        assert!(blocked.snapshot().unwrap()["release_required"].is_object());
        assert!(blocked.require_idle().is_err());
        let selected = json!({"provider":current.provider,"generation":current.selection_generation,"selection_id":current.selection_id,"control_revision":current.control_revision});
        let radio = json!({"available":true,"provider":current.provider,"selection_generation":current.selection_generation,"selection_id":current.selection_id,"worker_generation":current.worker_generation,"revision":current.observation_revision,"received_at_ms":10000,"snapshot":{"source":current.provider,"generation":current.connection_generation,"generated_at":10,"radio":{"observed":true,"connected":true,"transmitting":false,"observed_at":10},"station":{"radio_known":true,"radio_stale":false},"ptt":{"pending":false,"release_required":false},"carrier_tune":{"pending":false,"release_required":false}}});
        let proof = |o: &Target, t: &Target| {
            recovery_proof(o, t, &selected, &radio, 10000, |a, b| {
                if a == old.worker_generation && b == current.worker_generation {
                    Ok(())
                } else {
                    Err("Not retired".into())
                }
            })
        };
        let mut stale = radio.clone();
        stale["snapshot"]["radio"]["transmitting"] = json!(true);
        assert!(recovery_proof(&old, &current, &selected, &stale, 10000, |_, _| Ok(())).is_err());
        assert!(recovery_proof(&old, &current, &selected, &radio, 20000, |_, _| Ok(())).is_err());
        let mut unrelated = current.clone();
        unrelated.selection_id = uuid::Uuid::new_v4().to_string();
        assert!(recovery_proof(&old, &unrelated, &selected, &radio, 10000, |_, _| Ok(())).is_err());
        let decision = s.recover(&id, &owner, current.clone(), proof).unwrap();
        assert_eq!(decision["status"], "recovered");
        assert!(s.require_idle().is_ok());
        assert_eq!(
            s.recover(&id, &owner, current.clone(), |_, _| panic!(
                "Duplicate reproved"
            ))
            .unwrap(),
            decision
        );
        assert!(s
            .recover(
                &id,
                &uuid::Uuid::new_v4().to_string(),
                current.clone(),
                |_, _| Ok(())
            )
            .is_err());
        drop(s);
        let s = Session::new(d.path().join("ptt.json")).unwrap();
        assert_eq!(s.receipt(&id).unwrap(), decision);
        assert!(s.require_idle().is_ok());
        s.apply(
            &uuid::Uuid::new_v4().to_string(),
            true,
            current,
            &crate::carrier_tune::output_intent().unwrap(),
            |q, t| Ok(reply(&q, t, false)),
        )
        .unwrap();
    }
    fn reply(q: &Value, t: &Target, confirmed: bool) -> Value {
        json!({"id":q["id"],"ok":true,"result":{"accepted":true,"confirmed":confirmed,"control":"ptt","enabled":q["params"]["enabled"],"owner_id":q["params"]["ptt_owner_id"],"state":{"source":t.provider,"generation":t.connection_generation,"radio":{"connected":true,"observed":true,"transmitting":q["params"]["enabled"]},"ptt":{"source":"gui","owner_id":q["params"]["ptt_owner_id"],"confirmed":confirmed,"pending":false,"release_required":q["params"]["enabled"],"transmitting":q["params"]["enabled"]}}}})
    }
    fn proof(t: &Target, id: &str, on: bool) -> Value {
        json!({"available":true,"provider":t.provider,"selection_generation":t.selection_generation,"selection_id":t.selection_id,"worker_generation":t.worker_generation,"snapshot":{"source":t.provider,"generation":t.connection_generation,"ptt":{"owner_id":id,"source":"gui","confirmed":true,"pending":false,"release_required":on,"transmitting":on}}})
    }
    #[test]
    fn ptt_ack_requires_newer_backend_proof_and_review_never_clears_duty() {
        let _serial = crate::carrier_tune::OUTPUT_TEST.lock().unwrap();
        let (_d, s) = fixture();
        let t = target();
        let id = uuid::Uuid::new_v4().to_string();
        let intent = crate::carrier_tune::output_intent().unwrap();
        let r = s
            .apply(&id, true, t.clone(), &intent, |q, t| {
                let saved: Saved =
                    serde_json::from_slice(&std::fs::read(&s.path).unwrap()).unwrap();
                assert_eq!(saved.receipts[0].status, "pending");
                assert!(saved.release_required.is_some());
                Ok(reply(&q, t, false))
            })
            .unwrap();
        assert_eq!(r["status"], "acknowledged");
        assert!(s.require_idle().is_err());
        s.reconcile(&proof(&t, &id, true)).unwrap();
        assert_eq!(s.receipt(&id).unwrap()["status"], "confirmed");
        assert!(s.require_idle().is_err());
        let off = uuid::Uuid::new_v4().to_string();
        let r = s
            .apply(&off, false, t.clone(), "", |q, t| Ok(reply(&q, t, false)))
            .unwrap();
        assert_eq!(r["status"], "acknowledged");
        assert!(s.require_idle().is_err());
        let mut wrong = proof(&t, &id, false);
        wrong["snapshot"]["ptt"]["source"] = json!("embedded_cat");
        s.reconcile(&wrong).unwrap();
        assert!(s.require_idle().is_err());
        s.reconcile(&proof(&t, &id, false)).unwrap();
        assert!(s.require_idle().is_ok());
        assert_eq!(s.receipt(&off).unwrap()["status"], "confirmed");
        let next = uuid::Uuid::new_v4().to_string();
        s.apply(
            &next,
            true,
            t.clone(),
            &crate::carrier_tune::output_intent().unwrap(),
            |_, _| Err("lost".into()),
        )
        .unwrap();
        s.review(&next).unwrap();
        assert!(s.require_idle().is_err());
        assert!(s.snapshot().unwrap()["release_required"].is_object());
    }
    #[test]
    fn ptt_restart_dedupe_collision_no_replay_and_retained_owner_only_off() {
        let _serial = crate::carrier_tune::OUTPUT_TEST.lock().unwrap();
        let (_d, s) = fixture();
        let t = target();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(s
            .apply(
                &uuid::Uuid::new_v4().to_string(),
                false,
                t.clone(),
                "",
                |_, _| panic!()
            )
            .is_err());
        let intent = crate::carrier_tune::output_intent().unwrap();
        s.apply(&id, true, t.clone(), &intent, |_, _| Err("lost".into()))
            .unwrap();
        assert_eq!(
            s.apply(&id, true, t.clone(), &intent, |_, _| panic!("replay"))
                .unwrap()["status"],
            "unknown"
        );
        let mut other = t.clone();
        other.selection_id = uuid::Uuid::new_v4().to_string();
        assert!(s
            .apply(&id, true, other.clone(), &intent, |_, _| panic!())
            .is_err());
        assert!(s
            .apply(
                &uuid::Uuid::new_v4().to_string(),
                false,
                other,
                "",
                |_, _| panic!("unrelated release")
            )
            .is_err());
        let cold = Session::new(s.path.clone()).unwrap();
        assert!(cold.require_idle().is_err());
        assert_eq!(cold.receipt(&id).unwrap()["status"], "unknown");
        assert!(cold
            .apply(
                &uuid::Uuid::new_v4().to_string(),
                true,
                t.clone(),
                &intent,
                |_, _| panic!()
            )
            .is_err());
        let mut saved = s.state.lock().unwrap().clone();
        saved.receipts[0].status = "pending".into();
        s.persist(&saved).unwrap();
        assert_eq!(
            Session::new(s.path.clone()).unwrap().receipt(&id).unwrap()["status"],
            "unknown"
        );
    }
    #[test]
    fn ptt_off_and_cancel_retire_old_preparations_and_share_atomic_cw_tune_gate() {
        let _serial = crate::carrier_tune::OUTPUT_TEST.lock().unwrap();
        let (_d, s) = fixture();
        let mut t = target();
        t.provider = "direct_flex_lan".into();
        let old = crate::carrier_tune::output_intent().unwrap();
        crate::carrier_tune::revoke_output_intent().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(s
            .apply(&id, true, t.clone(), &old, |_, _| panic!())
            .is_err());
        assert!(s.receipt(&id).unwrap().is_null());
        let guard = crate::carrier_tune::reserve_output().unwrap();
        let current = crate::carrier_tune::output_intent().unwrap();
        assert!(s
            .apply(&id, true, t.clone(), &current, |_, _| panic!())
            .is_err());
        assert!(s.snapshot().unwrap()["release_required"].is_null());
        drop(guard);
        s.apply(&id, true, t.clone(), &current, |q, t| {
            assert!(crate::carrier_tune::reserve_output().is_err());
            let off = uuid::Uuid::new_v4().to_string();
            let r = s
                .apply(&off, false, t.clone(), "", |q, t| Ok(reply(&q, t, true)))
                .unwrap();
            assert_eq!(r["status"], "confirmed");
            assert!(
                s.require_idle().is_err(),
                "An older in-flight acquisition retains its duty even after RX proof"
            );
            Ok(reply(&q, t, false))
        })
        .unwrap();
    }
    #[test]
    fn ptt_storage_failure_malformed_reply_and_terminal_retention() {
        let _serial = crate::carrier_tune::OUTPUT_TEST.lock().unwrap();
        let (_d, s) = fixture();
        let t = target();
        let intent = crate::carrier_tune::output_intent().unwrap();
        std::fs::create_dir(&s.path).unwrap();
        assert!(s
            .apply(
                &uuid::Uuid::new_v4().to_string(),
                true,
                t.clone(),
                &intent,
                |_, _| panic!()
            )
            .is_err());
        std::fs::remove_dir(&s.path).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let r = s
            .apply(&id, true, t.clone(), &intent, |q, t| {
                let mut v = reply(&q, t, false);
                v["result"]["owner_id"] = json!(uuid::Uuid::new_v4().to_string());
                Ok(v)
            })
            .unwrap();
        assert_eq!(r["status"], "unknown");
        s.review(&id).unwrap();
        assert!(s.snapshot().unwrap()["receipts"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(s.snapshot().unwrap()["release_required"].is_object());
        assert_eq!(
            s.apply(&id, true, t, &intent, |_, _| panic!()).unwrap()["status"],
            "reviewed"
        );
        let (_dir, failed) = fixture();
        let lost = uuid::Uuid::new_v4().to_string();
        assert!(failed
            .apply(&lost, true, target(), &intent, |q, t| {
                std::fs::remove_file(&failed.path).unwrap();
                std::fs::create_dir(&failed.path).unwrap();
                Ok(reply(&q, t, false))
            })
            .is_err());
        assert_eq!(failed.receipt(&lost).unwrap()["status"], "unknown");
        assert!(failed.snapshot().unwrap()["release_required"].is_object());
        assert!(failed.review(&lost).is_err());
        let q = json!({"id":lost,"params":{"enabled":true,"ptt_owner_id":lost}});
        assert_eq!(
            outcome(
                &lost,
                true,
                &lost,
                &target(),
                &Ok(reply(&q, &target(), true))
            ),
            "unknown",
            "Agent immediate confirmation is malformed; only later proof may promote an ACK"
        );
    }
    #[test]
    fn ptt_native_on_admission_requires_exact_fresh_policy_off_retains_stale_authority() {
        assert!(
            cw_for_acquisition(false, || panic!("Urgent PTT off queried a busy CW owner")).is_ok()
        );
        let t = target();
        let sel = json!({"provider":t.provider,"generation":t.selection_generation,"selection_id":t.selection_id,"control_revision":t.control_revision});
        let cw = json!({"armed":false,"pending":false,"owner":null,"lease":null});
        let r = json!({"provider":t.provider,"selection_generation":t.selection_generation,"selection_id":t.selection_id,"worker_generation":t.worker_generation,"revision":t.observation_revision,"received_at_ms":t.received_at_ms,"available":true,"snapshot":{"source":t.provider,"generation":t.connection_generation,"generated_at":10.0,"allow_transmit":true,"radio":{"connected":true,"observed":true,"observed_at":10.0,"transmitting":false},"carrier_tune":{"pending":false,"release_required":false},"ptt":{"release_required":false},"station":{"supported_commands":["set_ptt"],"commissioned":true,"radio_known":true,"radio_stale":false,"inhibitors":[]}}});
        assert!(admission(&sel, &r, &t, true, 10000, &cw).is_ok());
        for path in [
            ["snapshot", "allow_transmit"],
            ["snapshot", "radio"],
            ["snapshot", "station"],
            ["snapshot", "carrier_tune"],
            ["snapshot", "ptt"],
        ] {
            let mut bad = r.clone();
            bad[path[0]][path[1]] = Value::Null;
            assert!(admission(&sel, &bad, &t, true, 10000, &cw).is_err());
            assert!(admission(&sel, &bad, &t, false, 999999, &cw).is_ok());
        }
        let mut old = r.clone();
        old["worker_generation"] = json!(5);
        assert!(admission(&sel, &old, &t, false, 10000, &cw).is_err());
        assert!(admission(&sel, &r, &t, true, 999999, &cw).is_err());
        let mut active = cw.clone();
        active["armed"] = json!(true);
        assert!(admission(&sel, &r, &t, true, 10000, &active).is_err());
        for label in ["monitor", "station-control", "cw", "unknown"] {
            assert!(validate(label, false, false, "on").is_err());
            assert!(validate(label, false, false, "off").is_err());
        }
    }
}
