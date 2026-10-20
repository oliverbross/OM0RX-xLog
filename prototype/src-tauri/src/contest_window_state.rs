//! Machine-local memory for contest windows opened outside the portable layout.
//! Geometry remains owned by `detached_geometry`; this file stores only the
//! native contest panel set that should be reopened for the next active session.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const FILE_NAME: &str = "contest-window-state.json";

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

fn checked(document: Document) -> Result<Document, String> {
    if document.version != 1
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
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Document {
            version: 1,
            open: BTreeSet::new(),
        }),
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
    Ok(read(directory)?
        .open
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

    #[test]
    fn remembers_exact_open_contest_set_across_process_lifetimes() {
        let directory = tempfile::tempdir().unwrap();
        assert!(labels(directory.path()).unwrap().is_empty());
        remember(directory.path(), "contest--active-qso", true).unwrap();
        remember(directory.path(), "contest--logbook", true).unwrap();
        remember(directory.path(), "contest--active-qso", true).unwrap();
        assert_eq!(
            labels(directory.path()).unwrap(),
            ["contest--active-qso", "contest--logbook"]
        );
        remember(directory.path(), "contest--active-qso", false).unwrap();
        assert_eq!(labels(directory.path()).unwrap(), ["contest--logbook"]);
        assert!(remember(directory.path(), "logbook", true).is_err());
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
