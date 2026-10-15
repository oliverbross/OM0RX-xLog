//! Correlated renderer vetoes before any detached Canvas window is closed.
use std::{collections::BTreeMap, sync::{Condvar, Mutex, OnceLock}, time::{Duration, Instant}};

#[derive(Default)]
struct Pending { id: String, replies: BTreeMap<String, Option<bool>> }
#[derive(Default)]
pub struct Preparation { pending: Mutex<Option<Pending>>, changed: Condvar }
static PREPARATION: OnceLock<Preparation> = OnceLock::new();
pub fn preparation() -> &'static Preparation { PREPARATION.get_or_init(Preparation::default) }
/// Preflight the complete native inventory before touching any member. A queued
/// request is successful only after authoritative native absence is confirmed.
pub fn apply<T>(windows: &[T], prepare: impl FnOnce() -> Result<(), String>, mut close: impl FnMut(&T) -> Result<(), String>, complete: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    prepare()?;
    for window in windows { close(window)?; }
    complete()
}
impl Preparation {
    pub fn begin(&self, labels: &[String]) -> Result<String, String> {
        let mut pending = self.pending.lock().map_err(|_| "Canvas close preparation unavailable")?;
        if pending.is_some() { return Err("Another Canvas transition is still preparing.".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        *pending = Some(Pending { id: id.clone(), replies: labels.iter().filter(|label| matches!(label.as_str(), "logbook" | "log-qso")).map(|label| (label.clone(), None)).collect() });
        Ok(id)
    }
    pub fn acknowledge(&self, label: &str, id: &str, ready: bool) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "Canvas close preparation unavailable")?;
        let pending = pending.as_mut().filter(|pending| pending.id == id).ok_or("This Canvas close acknowledgement is obsolete.")?;
        let reply = pending.replies.get_mut(label).ok_or("This window is not preparing to close.")?;
        if reply.is_some() { return Err("This window already acknowledged Canvas preparation.".into()); }
        *reply = Some(ready); self.changed.notify_all(); Ok(())
    }
    pub fn wait(&self, id: &str, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let mut pending = self.pending.lock().map_err(|_| "Canvas close preparation unavailable")?;
        loop {
            let current = pending.as_ref().filter(|pending| pending.id == id).ok_or("Canvas close preparation was superseded.")?;
            if let Some((label, _)) = current.replies.iter().find(|(_, ready)| **ready == Some(false)) {
                return Err(format!("Finish or cancel unsaved changes in {label}, then switch to Canvas again."));
            }
            if current.replies.values().all(|ready| *ready == Some(true)) { return Ok(()); }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { return Err("An editor did not confirm it was safe to close. Finish loading or resolve its changes, then retry Canvas.".into()); }
            (pending, _) = self.changed.wait_timeout(pending, remaining).map_err(|_| "Canvas close preparation unavailable")?;
        }
    }
    pub fn finish(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() { if pending.as_ref().is_some_and(|pending| pending.id == id) { *pending = None; } }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_editors_must_acknowledge_exact_request_and_veto_is_preserved() {
        let p = Preparation::default(); let id = p.begin(&["logbook".into(), "log-qso".into(), "band-map-20m".into()]).unwrap();
        assert!(p.acknowledge("logbook", "old", true).is_err());
        assert!(p.acknowledge("main", &id, true).is_err());
        p.acknowledge("logbook", &id, true).unwrap();
        assert!(p.wait(&id, Duration::ZERO).is_err());
        p.acknowledge("log-qso", &id, false).unwrap();
        assert!(p.wait(&id, Duration::ZERO).unwrap_err().contains("log-qso"));
        p.finish("old"); assert!(p.begin(&[]).is_err()); p.finish(&id);
        let id = p.begin(&["logbook".into()]).unwrap(); p.acknowledge("logbook", &id, true).unwrap();
        p.wait(&id, Duration::ZERO).unwrap();
    }
    #[test]
    fn preflight_veto_or_timeout_closes_nothing_and_success_includes_manual_band_instances() {
        use std::cell::RefCell;
        let windows = ["log-qso", "logbook", "awards", "band-map-20m", "band-map-40m", "cw"];
        let closed = RefCell::new(Vec::new());
        for reason in ["Unsaved editor input", "Editor acknowledgement timed out", "CW output unknown", "Spot reservation active"] {
            assert_eq!(apply(&windows, || Err(reason.into()), |label| { closed.borrow_mut().push(*label); Ok(()) }, || Ok(())).unwrap_err(), reason);
            assert!(closed.borrow().is_empty());
        }
        apply(&windows, || Ok(()), |label| { closed.borrow_mut().push(*label); Ok(()) }, || {
            assert_eq!(*closed.borrow(), windows); Ok(())
        }).unwrap();
    }
    #[test]
    fn accepted_close_requests_cannot_claim_completion_while_native_windows_remain() {
        assert!(apply(&["logbook"], || Ok(()), |_| Ok(()), || Err("Logbook refused close".into())).is_err());
    }
}
