//! Correlated renderer preparation before retiring the Contesting module.
use std::{collections::BTreeMap, sync::{Condvar, Mutex, OnceLock}, time::{Duration, Instant}};

#[derive(Default)]
struct Pending { id: String, replies: BTreeMap<String, Option<Result<(), String>>>, restart: bool }

#[derive(Default)]
pub struct Preparation { pending: Mutex<Option<Pending>>, changed: Condvar }

static PREPARATION: OnceLock<Preparation> = OnceLock::new();

pub fn preparation() -> &'static Preparation { PREPARATION.get_or_init(Preparation::default) }

impl Preparation {
    pub fn begin(&self, windows: &[String]) -> Result<String, String> {
        let mut pending = self.pending.lock().map_err(|_| "Contest transition preparation unavailable")?;
        if pending.is_some() { return Err("Another contest transition is still preparing.".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        *pending = Some(Pending { id: id.clone(), replies: windows.iter().map(|window| (window.clone(), None)).collect(), restart: false });
        eprintln!("Workspace preparation begin pid={} request={id} windows={windows:?}", std::process::id());
        Ok(id)
    }

    pub fn request_for(&self, window: &str) -> Result<Option<String>, String> {
        let pending = self.pending.lock().map_err(|_| "Operating-module preparation unavailable")?;
        Ok(pending.as_ref().filter(|pending| pending.replies.get(window).is_some_and(Option::is_none)).map(|pending| pending.id.clone()))
    }

    pub fn acknowledge(&self, window: &str, id: &str, ready: bool, reason: Option<&str>) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "Contest transition preparation unavailable")?;
        let current = pending.as_mut().filter(|pending| pending.id == id)
            .ok_or("This contest transition acknowledgement is obsolete.")?;
        let reply = current.replies.get_mut(window).ok_or("This window is not preparing to change operating module.")?;
        if reply.is_some() { return Err("This contest transition was already acknowledged.".into()); }
        *reply = Some(if ready { Ok(()) } else { Err(reason.filter(|reason| !reason.trim().is_empty()).unwrap_or("Finish the current entry or resolve its retained operation before changing operating module.").to_owned()) });
        eprintln!("Workspace preparation reply pid={} request={id} window={window} ready={ready}", std::process::id());
        self.changed.notify_all();
        Ok(())
    }

    pub fn wait(&self, id: &str, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let mut pending = self.pending.lock().map_err(|_| "Contest transition preparation unavailable")?;
        loop {
            let current = pending.as_ref().filter(|pending| pending.id == id)
                .ok_or("Contest transition preparation was superseded.")?;
            for (window, reply) in &current.replies {
                if let Some(Err(reason)) = reply { return Err(format!("{window}: {reason}")); }
            }
            if current.replies.values().all(|reply| matches!(reply, Some(Ok(())))) { return Ok(()); }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let waiting = current.replies.iter().filter(|(_, reply)| reply.is_none()).map(|(window, _)| window.as_str()).collect::<Vec<_>>();
                return Err(format!("{} did not confirm that its entry was saved. Finish loading or resolve its changes, then retry.", waiting.join(", ")));
            }
            (pending, _) = self.changed.wait_timeout(pending, remaining)
                .map_err(|_| "Contest transition preparation unavailable")?;
        }
    }

    pub fn finish(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            if pending.as_ref().is_some_and(|pending| pending.id == id) { *pending = None; }
        }
    }

    /// Carry this exact successful preflight into Tauri's restart ExitRequested.
    /// Editors stay frozen; asking them to prepare again after retirement would
    /// veto against a stopped worker (and Tauri cannot cancel a restart exit).
    pub fn authorize_restart(&self, id: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "Contest transition preparation unavailable")?;
        let current = pending.as_mut().filter(|pending| pending.id == id)
            .ok_or("This workspace restart preparation is obsolete.")?;
        if current.restart || !current.replies.values().all(|reply| matches!(reply, Some(Ok(())))) {
            return Err("Every editor must prepare before restarting the workspace.".into());
        }
        current.restart = true;
        Ok(())
    }

    pub fn take_restart(&self, restart_exit: bool) -> Option<String> {
        if !restart_exit { return None; }
        let mut pending = self.pending.lock().ok()?;
        if !pending.as_ref().is_some_and(|pending| pending.restart) { return None; }
        pending.take().map(|pending| pending.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_exit_uses_exact_preparation_once_and_never_bypasses_ordinary_quit() {
        let p = Preparation::default();
        let id = p.begin(&["contest-setup".into(), "main".into()]).unwrap();
        assert!(p.authorize_restart("stale").is_err());
        assert!(p.authorize_restart(&id).is_err());
        p.acknowledge("main", &id, true, None).unwrap();
        assert!(p.authorize_restart(&id).is_err());
        p.acknowledge("contest-setup", &id, true, None).unwrap();
        p.wait(&id, Duration::ZERO).unwrap();
        p.authorize_restart(&id).unwrap();
        assert!(p.authorize_restart(&id).is_err());
        assert_eq!(p.take_restart(false), None);
        assert_eq!(p.take_restart(true), Some(id));
        assert_eq!(p.take_restart(true), None);
        let veto = p.begin(&["contest-setup".into()]).unwrap();
        p.acknowledge("contest-setup", &veto, false, Some("Retained operation")).unwrap();
        assert!(p.authorize_restart(&veto).is_err());
        assert_eq!(p.take_restart(true), None);
        p.finish(&veto);
        let timeout = p.begin(&["main".into()]).unwrap();
        assert!(p.wait(&timeout, Duration::ZERO).is_err());
        assert!(p.authorize_restart(&timeout).is_err());
        assert_eq!(p.take_restart(true), None);
        p.finish(&timeout);
        assert!(p.acknowledge("main", &timeout, true, None).is_err());
        assert_eq!(p.take_restart(true), None);
        let retry = p.begin(&["main".into()]).unwrap();
        p.acknowledge("main", &retry, true, None).unwrap();
        p.wait(&retry, Duration::ZERO).unwrap();
        p.authorize_restart(&retry).unwrap();
        assert_eq!(p.take_restart(true), Some(retry));
    }

    #[test]
    fn exact_acknowledgement_is_required_and_veto_is_preserved() {
        let preparation = Preparation::default();
        let id = preparation.begin(&["main".into()]).unwrap();
        assert!(preparation.acknowledge("contest-setup", &id, true, None).is_err());
        assert!(preparation.acknowledge("main", "obsolete", true, None).is_err());
        assert!(preparation.wait(&id, Duration::ZERO).is_err());
        preparation.acknowledge("main", &id, false, Some("Unsaved logging entry")).unwrap();
        assert!(preparation.wait(&id, Duration::ZERO).unwrap_err().contains("Unsaved logging entry"));
        preparation.finish(&id);

        let id = preparation.begin(&["contest-setup".into()]).unwrap();
        preparation.acknowledge("contest-setup", &id, true, None).unwrap();
        preparation.wait(&id, Duration::ZERO).unwrap();
        assert!(preparation.acknowledge("contest-setup", &id, true, None).is_err());
        preparation.finish(&id);
    }

    #[test]
    fn only_one_preparation_can_own_the_renderer_at_a_time() {
        let preparation = Preparation::default();
        let id = preparation.begin(&["main".into()]).unwrap();
        assert!(preparation.begin(&["contest-setup".into()]).is_err());
        preparation.finish("obsolete");
        assert!(preparation.begin(&["contest-setup".into()]).is_err());
        preparation.finish(&id);
        assert!(preparation.begin(&["contest-setup".into()]).is_ok());
    }

    #[test]
    fn every_open_editor_must_prepare_but_absent_controllers_do_not_block() {
        let p = Preparation::default();
        let id = p.begin(&["main".into(), "log-qso".into(), "logbook".into()]).unwrap();
        assert_eq!(p.request_for("log-qso").unwrap(), Some(id.clone()));
        assert_eq!(p.request_for("contest-setup").unwrap(), None);
        p.acknowledge("main", &id, true, None).unwrap();
        p.acknowledge("log-qso", &id, true, None).unwrap();
        assert!(p.wait(&id, Duration::ZERO).unwrap_err().contains("logbook"));
        p.acknowledge("logbook", &id, false, Some("Contact edit is unsaved")).unwrap();
        assert!(p.wait(&id, Duration::ZERO).unwrap_err().contains("Contact edit is unsaved"));
        p.finish(&id);
        let id = p.begin(&[]).unwrap();
        p.wait(&id, Duration::ZERO).unwrap();
    }
}
