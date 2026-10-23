//! Correlated renderer preparation before retiring the Contesting module.
use std::{sync::{Condvar, Mutex, OnceLock}, time::{Duration, Instant}};

#[derive(Default)]
struct Pending { id: String, window: String, ready: Option<bool> }

#[derive(Default)]
pub struct Preparation { pending: Mutex<Option<Pending>>, changed: Condvar }

static PREPARATION: OnceLock<Preparation> = OnceLock::new();

pub fn preparation() -> &'static Preparation { PREPARATION.get_or_init(Preparation::default) }

impl Preparation {
    pub fn begin(&self, window: &str) -> Result<String, String> {
        let mut pending = self.pending.lock().map_err(|_| "Contest transition preparation unavailable")?;
        if pending.is_some() { return Err("Another contest transition is still preparing.".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        *pending = Some(Pending { id: id.clone(), window: window.to_owned(), ready: None });
        Ok(id)
    }

    pub fn acknowledge(&self, window: &str, id: &str, ready: bool) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "Contest transition preparation unavailable")?;
        let current = pending.as_mut().filter(|pending| pending.id == id && pending.window == window)
            .ok_or("This contest transition acknowledgement is obsolete.")?;
        if current.ready.is_some() { return Err("This contest transition was already acknowledged.".into()); }
        current.ready = Some(ready);
        self.changed.notify_all();
        Ok(())
    }

    pub fn wait(&self, id: &str, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let mut pending = self.pending.lock().map_err(|_| "Contest transition preparation unavailable")?;
        loop {
            let current = pending.as_ref().filter(|pending| pending.id == id)
                .ok_or("Contest transition preparation was superseded.")?;
            match current.ready {
                Some(true) => return Ok(()),
                Some(false) => return Err(match current.window.as_str() {
                    "main" => "Finish the current logging entry or resolve its retained operation before switching to Contesting.",
                    _ => "Finish the current contest entry or resolve its retained operation before returning to Normal Logging.",
                }.into()),
                None => {}
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(match current.window.as_str() {
                    "main" => "The main logging workspace did not confirm that its entry was safe. Keep it open, then retry.",
                    _ => "Contest Setup did not confirm that its entry was saved. Keep Contest Setup open, then retry.",
                }.into());
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_acknowledgement_is_required_and_veto_is_preserved() {
        let preparation = Preparation::default();
        let id = preparation.begin("main").unwrap();
        assert!(preparation.acknowledge("contest-setup", &id, true).is_err());
        assert!(preparation.acknowledge("main", "obsolete", true).is_err());
        assert!(preparation.wait(&id, Duration::ZERO).is_err());
        preparation.acknowledge("main", &id, false).unwrap();
        assert!(preparation.wait(&id, Duration::ZERO).unwrap_err().contains("current logging entry"));
        preparation.finish(&id);

        let id = preparation.begin("contest-setup").unwrap();
        preparation.acknowledge("contest-setup", &id, true).unwrap();
        preparation.wait(&id, Duration::ZERO).unwrap();
        assert!(preparation.acknowledge("contest-setup", &id, true).is_err());
        preparation.finish(&id);
    }

    #[test]
    fn only_one_preparation_can_own_the_renderer_at_a_time() {
        let preparation = Preparation::default();
        let id = preparation.begin("main").unwrap();
        assert!(preparation.begin("contest-setup").is_err());
        preparation.finish("obsolete");
        assert!(preparation.begin("contest-setup").is_err());
        preparation.finish(&id);
        assert!(preparation.begin("contest-setup").is_ok());
    }
}
