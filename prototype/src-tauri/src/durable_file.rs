//! Atomic, durable publication for the module selection and restart journal.
use std::{fs, io::{self, Write}, path::Path};

fn parent(path: &Path) -> io::Result<&Path> {
    path.parent().filter(|value| !value.as_os_str().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "File parent is unavailable"))
}

#[cfg(not(windows))]
fn replace(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)?;
    fs::File::open(parent(destination)?)?.sync_all()
}

#[cfg(windows)]
fn replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    fn wide(path: &Path) -> io::Result<Vec<u16>> {
        // Canonicalize only the parent: retain destination-link replacement
        // semantics and the extended Windows path prefix for long/Unicode paths.
        let name = path.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "File name is unavailable"))?;
        let absolute = parent(path)?.canonicalize()?.join(name);
        let mut value: Vec<u16> = absolute.as_os_str().encode_wide().collect();
        if value.contains(&0) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "File path contains NUL")); }
        value.push(0);
        Ok(value)
    }
    let source = wide(source)?;
    let destination = wide(destination)?;
    const REPLACE_EXISTING: u32 = 0x1;
    const WRITE_THROUGH: u32 = 0x8;
    // Both paths are in the same directory; do not enable copy-across-volume.
    // Windows has no Unix directory fsync. Require write-through publication
    // rather than reporting failure after a successful ordinary rename.
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), REPLACE_EXISTING | WRITE_THROUGH) };
    if result == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

pub fn publish(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = parent(path)?;
    fs::create_dir_all(directory)?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    // Close the data handle before Windows publication. TempPath still owns
    // cleanup on failure; after a rename it never deletes the destination.
    let source = temporary.into_temp_path();
    replace(source.as_ref(), path)
}

pub fn remove(path: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    {
        fs::remove_file(path)?;
        fs::File::open(parent(path)?)?.sync_all()
    }
    #[cfg(windows)]
    {
        // Durably remove the journal's logical name first. A crash/cleanup
        // failure may leave an unreferenced random tombstone, never a replayable
        // intent. TempPath cleans it up normally after write-through rename.
        let tombstone = tempfile::NamedTempFile::new_in(parent(path)?)?.into_temp_path();
        replace(path, tombstone.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_replaces_exact_bytes_in_unicode_directory_without_temp_leaks() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stanica-žluť-電台");
        let path = directory.join("selection.json");
        publish(&path, b"first").unwrap();
        publish(&path, b"replacement").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    }

    #[test]
    fn invalid_destination_preserves_existing_data_and_cleans_temporary_file() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("existing-directory");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("retained"), b"untouched").unwrap();
        assert!(publish(&destination, b"must-not-publish").is_err());
        assert_eq!(fs::read(destination.join("retained")).unwrap(), b"untouched");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn removal_retires_only_the_named_journal_and_reports_missing_paths() {
        let root = tempfile::tempdir().unwrap();
        let journal = root.path().join("intent.json");
        let other = root.path().join("settings.json");
        publish(&journal, b"intent").unwrap();
        publish(&other, b"keep").unwrap();
        remove(&journal).unwrap();
        assert!(!journal.exists());
        assert_eq!(fs::read(&other).unwrap(), b"keep");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
        assert!(remove(&journal).is_err());
    }
}
