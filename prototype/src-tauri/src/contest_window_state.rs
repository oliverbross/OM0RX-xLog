//! Machine-local memory for contest windows opened outside the portable layout.
//! Geometry remains owned by `detached_geometry`; this file stores only the
//! native contest panel set that should be reopened for the next active session.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const FILE_NAME: &str = "contest-window-state.json";
const VERSION: u8 = 2;
const DEFAULT_OPEN: [&str; 7] = [
    "active-qso",
    "band-maps",
    "propagation",
    "logbook",
    "callsign-intelligence",
    "monitor",
    "dx-cluster",
];

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
struct Document {
    version: u8,
    open: BTreeSet<String>,
}

fn lock() -> &'static Mutex<()> {
    static FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    FILE_LOCK.get_or_init(|| Mutex::new(()))
}

fn path(directory: &Path) -> PathBuf {
    directory.join(FILE_NAME)
}

fn default_document() -> Document {
    Document { version: VERSION, open: DEFAULT_OPEN.into_iter().map(str::to_owned).collect() }
}

fn checked(mut document: Document) -> Result<Document, String> {
    if !matches!(document.version, 1 | VERSION)
        || document.open.len() > crate::workspace_windows::CONTEST_WINDOWS.len()
        || document.open.iter().any(|panel| {
            !crate::workspace_windows::supports_panel(
                crate::workspace_windows::WorkspaceWindowScope::Contesting,
                panel,
            )
        })
    {
        return Err("Saved contest window state is invalid.".into());
    }
    // Version 1 was written before the contest desk had a first-run set. An
    // empty v1 document therefore records the old defect, not operator intent.
    if document.version == 1 && document.open.is_empty() {
        document = default_document();
    } else {
        document.version = VERSION;
    }
    Ok(document)
}

fn read(directory: &Path) -> Result<Document, String> {
    match std::fs::read(path(directory)) {
        Ok(bytes) => {
            if bytes.len() > 16_384 {
                return Err("Saved contest window state is too large.".into());
            }
            checked(
                serde_json::from_slice(&bytes)
                    .map_err(|_| "Saved contest window state is invalid.")?,
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(default_document()),
        Err(error) => Err(error.to_string()),
    }
}

fn write(directory: &Path, document: &Document) -> Result<(), String> {
    checked(document.clone())?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    serde_json::to_writer(temporary.as_file_mut(), document).map_err(|error| error.to_string())?;
    temporary
        .as_file_mut()
        .flush()
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path(directory))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn panel(label: &str) -> Result<&str, String> {
    let identity = crate::workspace_windows::WorkspaceWindowIdentity::parse_native_label(label)?;
    if identity.scope != crate::workspace_windows::WorkspaceWindowScope::Contesting {
        return Err("Only contest windows can be remembered.".into());
    }
    Ok(identity.panel_id)
}

pub fn labels(directory: &Path) -> Result<Vec<String>, String> {
    let _guard = lock()
        .lock()
        .map_err(|_| "Contest window state is unavailable.")?;
    let mut open = read(directory)?.open;
    // Every activated contest gets the standard operating desk. The saved set
    // may add auxiliary tools, but closing Main Logging (or another standard
    // window) in one session must not strand the next New/Open Contest flow.
    open.extend(DEFAULT_OPEN.into_iter().map(str::to_owned));
    Ok(open
        .into_iter()
        .map(|panel| {
            crate::workspace_windows::WorkspaceWindowIdentity::new(
                crate::workspace_windows::WorkspaceWindowScope::Contesting,
                &panel,
            )
            .expect("validated contest panel")
            .native_label()
        })
        .collect())
}

pub fn remember(directory: &Path, label: &str, open: bool) -> Result<(), String> {
    let panel = panel(label)?.to_owned();
    let _guard = lock()
        .lock()
        .map_err(|_| "Contest window state is unavailable.")?;
    let mut document = read(directory)?;
    if open {
        document.open.insert(panel);
    } else {
        document.open.remove(&panel);
    }
    write(directory, &document)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_labels() -> Vec<String> {
        DEFAULT_OPEN.into_iter().map(|panel| format!("contest--{panel}")).collect::<BTreeSet<_>>().into_iter().collect()
    }

    #[test]
    fn remembers_exact_open_contest_set_across_process_lifetimes() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(labels(directory.path()).unwrap(), default_labels());
        remember(directory.path(), "contest--active-qso", true).unwrap();
        remember(directory.path(), "contest--logbook", true).unwrap();
        remember(directory.path(), "contest--active-qso", true).unwrap();
        remember(directory.path(), "contest--active-qso", false).unwrap();
        assert!(labels(directory.path()).unwrap().contains(&"contest--active-qso".to_owned()));
        assert!(remember(directory.path(), "logbook", true).is_err());
    }

    #[test]
    fn every_session_restores_the_standard_contest_desk_alongside_remembered_tools() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(path(directory.path()), br#"{"version":2,"open":["rotor"]}"#).unwrap();
        let restored = labels(directory.path()).unwrap();
        for label in default_labels() {
            assert!(restored.contains(&label), "missing standard contest window {label}");
        }
        assert!(restored.contains(&"contest--rotor".to_owned()));
    }

    #[test]
    fn migrates_the_legacy_empty_state_to_the_useful_contest_desk() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(path(directory.path()), br#"{"version":1,"open":[]}"#).unwrap();
        assert_eq!(labels(directory.path()).unwrap(), default_labels());
        remember(directory.path(), "contest--band-maps", false).unwrap();
        let saved: Document = serde_json::from_slice(&std::fs::read(path(directory.path())).unwrap()).unwrap();
        assert_eq!(saved.version, VERSION);
        assert!(!saved.open.contains("band-maps"));
    }

    #[test]
    fn malformed_or_unknown_state_fails_closed_without_replacing_it() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            path(directory.path()),
            br#"{"version":1,"open":["not-a-panel"]}"#,
        )
        .unwrap();
        assert!(labels(directory.path()).is_err());
        assert!(remember(directory.path(), "contest--active-qso", true).is_err());
        assert_eq!(
            std::fs::read(path(directory.path())).unwrap(),
            br#"{"version":1,"open":["not-a-panel"]}"#
        );
    }
}
