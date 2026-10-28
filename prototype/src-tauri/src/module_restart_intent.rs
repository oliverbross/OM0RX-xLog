use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

const VERSION: u8 = 1;
const FILE_NAME: &str = "operating-module-restart-intent.json";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContestRoute(String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Destination {
    NormalMain,
    ContestLogTransfer,
    ContestRoute(ContestRoute),
}

impl Destination {
    pub fn contest_route(route: &str) -> Result<Self, String> {
        if crate::workspace_navigation::contest_route(route) != Some(route) {
            return Err("The requested Contest destination is not available.".into());
        }
        Ok(Self::ContestRoute(ContestRoute(route.into())))
    }

    pub fn as_contest_route(&self) -> Option<&str> {
        match self { Self::ContestRoute(route) => Some(&route.0), Self::NormalMain | Self::ContestLogTransfer => None }
    }

    fn validate(self) -> Result<Self, String> {
        match self {
            Self::ContestRoute(route) if crate::workspace_navigation::contest_route(&route.0) != Some(route.0.as_str()) =>
                Err("The saved restart destination is unknown. Remove it or retry a Contest menu action.".into()),
            destination => Ok(destination),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Persisted {
    version: u8,
    destination: Destination,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Decision {
    None,
    DiscardInactive,
    WaitForNormal,
    OpenNormalMain,
    WaitForSetup,
    WaitForContest,
    ReplayContestRoute,
    OpenContestLogTransfer,
}

pub fn decision(contesting: bool, setup_ready: bool, contest_admitted: bool,
    pending: Option<&Destination>) -> Decision {
    match (contesting, setup_ready, contest_admitted, pending) {
        (_, _, _, None) => Decision::None,
        (true, _, _, Some(Destination::NormalMain)) => Decision::WaitForNormal,
        (false, _, _, Some(Destination::NormalMain)) => Decision::OpenNormalMain,
        (false, _, _, Some(_)) => Decision::DiscardInactive,
        (true, false, _, Some(_)) => Decision::WaitForSetup,
        (true, true, false, Some(Destination::ContestLogTransfer)) => Decision::WaitForContest,
        (true, true, true, Some(Destination::ContestLogTransfer)) => Decision::OpenContestLogTransfer,
        (true, true, false, Some(Destination::ContestRoute(route)))
            if route.0.starts_with("contest-window-") => Decision::WaitForContest,
        (true, true, _, Some(Destination::ContestRoute(_))) => Decision::ReplayContestRoute,
    }
}

fn path(directory: &Path) -> PathBuf { directory.join(FILE_NAME) }

pub fn publish(directory: &Path, destination: Destination) -> Result<(), String> {
    let bytes = serde_json::to_vec(&Persisted { version: VERSION, destination })
        .map_err(|error| error.to_string())?;
    crate::durable_file::publish(&path(directory), &bytes)
        .map_err(|error| format!("Could not publish the restart destination: {error}"))
}

pub fn load(directory: &Path) -> Result<Option<Destination>, String> {
    let bytes = match fs::read(path(directory)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read the restart destination: {error}")),
    };
    let value = serde_json::from_slice::<Persisted>(&bytes)
        .map_err(|_| "The saved restart destination is invalid. Remove it or retry the requested Contest action.".to_string())?;
    if value.version != VERSION {
        return Err("The saved restart destination version is unsupported. Remove it or retry the requested Contest action.".into());
    }
    value.destination.validate().map(Some)
}

pub fn consume(directory: &Path, expected: Destination) -> Result<(), String> {
    let current = load(directory)?;
    if current != Some(expected) {
        return Err("The saved restart destination changed before it could be opened.".into());
    }
    crate::durable_file::remove(&path(directory))
        .map_err(|error| format!("Could not consume the restart destination: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_and_consumption_preserve_unicode_parent_and_current_destination() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stanica-žluť-電台");
        publish(&directory, Destination::ContestLogTransfer).unwrap();
        publish(&directory, Destination::NormalMain).unwrap();
        assert_eq!(load(&directory).unwrap(), Some(Destination::NormalMain));
        assert!(consume(&directory, Destination::ContestLogTransfer).is_err());
        assert_eq!(load(&directory).unwrap(), Some(Destination::NormalMain));
        consume(&directory, Destination::NormalMain).unwrap();
        assert_eq!(load(&directory).unwrap(), None);
        assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
    }

    #[test]
    fn intent_is_durable_and_consumed_only_by_the_expected_destination() {
        let directory = tempfile::tempdir().unwrap();
        publish(directory.path(), Destination::ContestLogTransfer).unwrap();
        assert_eq!(load(directory.path()).unwrap(), Some(Destination::ContestLogTransfer));
        consume(directory.path(), Destination::ContestLogTransfer).unwrap();
        assert_eq!(load(directory.path()).unwrap(), None);
    }

    #[test]
    fn corrupt_and_unsupported_intents_fail_closed_without_being_deleted() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(path(directory.path()), b"not-json").unwrap();
        assert!(load(directory.path()).unwrap_err().contains("invalid"));
        assert!(path(directory.path()).exists());
        fs::write(path(directory.path()), br#"{"version":2,"destination":"contest_log_transfer"}"#).unwrap();
        assert!(load(directory.path()).unwrap_err().contains("unsupported"));
        assert!(path(directory.path()).exists());
        let unknown = serde_json::json!({"version":VERSION,
            "destination":{"contest_route":"contest-window-settings"}});
        fs::write(path(directory.path()), serde_json::to_vec(&unknown).unwrap()).unwrap();
        assert!(load(directory.path()).unwrap_err().contains("unknown"));
        assert!(path(directory.path()).exists());
    }

    #[test]
    fn route_decision_never_opens_before_contesting_context_admission() {
        let pending = Destination::ContestLogTransfer;
        assert_eq!(decision(false, false, false, Some(&pending)), Decision::DiscardInactive);
        assert_eq!(decision(true, false, false, Some(&pending)), Decision::WaitForSetup);
        assert_eq!(decision(true, true, false, Some(&pending)), Decision::WaitForContest);
        assert_eq!(decision(true, true, true, Some(&pending)), Decision::OpenContestLogTransfer);
        assert_eq!(decision(true, true, true, None), Decision::None);
    }

    #[test]
    fn normal_main_waits_for_the_authoritative_module_restart_before_opening() {
        let directory = tempfile::tempdir().unwrap();
        let destination = Destination::NormalMain;
        publish(directory.path(), destination.clone()).unwrap();
        assert_eq!(decision(true, true, true, Some(&destination)), Decision::WaitForNormal);
        assert_eq!(decision(false, false, false, Some(&destination)), Decision::OpenNormalMain);
        consume(directory.path(), destination).unwrap();
        assert_eq!(load(directory.path()).unwrap(), None);
    }

    #[test]
    fn every_registered_contest_menu_route_round_trips_and_replays_at_the_right_gate() {
        let directory = tempfile::tempdir().unwrap();
        for (route, _) in crate::workspace_navigation::CONTEST_MENU_ITEMS {
            let destination = Destination::contest_route(route).unwrap();
            publish(directory.path(), destination.clone()).unwrap();
            assert_eq!(load(directory.path()).unwrap(), Some(destination.clone()));
            assert_eq!(decision(true, false, false, Some(&destination)), Decision::WaitForSetup);
            let before_context = decision(true, true, false, Some(&destination));
            assert_eq!(before_context, if route.starts_with("contest-window-") {
                Decision::WaitForContest
            } else { Decision::ReplayContestRoute });
            assert_eq!(decision(true, true, true, Some(&destination)), Decision::ReplayContestRoute);
            consume(directory.path(), destination).unwrap();
        }
        assert!(Destination::contest_route("contest-window-settings").is_err());
        assert!(Destination::contest_route("https://example.invalid").is_err());
    }
}
