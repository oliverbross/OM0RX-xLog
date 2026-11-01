//! Atomic, durable publication of prepared files and restart journals.
use std::{fs, io::{self, Write}, path::{Path, PathBuf}};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublishMode { Replace, NoClobber }

fn parent(path: &Path) -> io::Result<&Path> {
    path.parent().filter(|value| !value.as_os_str().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "File parent is unavailable"))
}

fn same_directory_paths(source: &Path, destination: &Path) -> io::Result<(PathBuf, PathBuf)> {
    let source_parent = parent(source)?.canonicalize()?;
    let destination_parent = parent(destination)?.canonicalize()?;
    if source_parent != destination_parent {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Durable publication requires the same existing parent"));
    }
    let name = |path: &Path| path.file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "File name is unavailable"))
        .map(|value| value.to_os_string());
    Ok((source_parent.join(name(source)?), destination_parent.join(name(destination)?)))
}

#[cfg(unix)]
fn move_file(source: &Path, destination: &Path, mode: PublishMode) -> io::Result<()> {
    match mode {
        PublishMode::Replace => fs::rename(source, destination)?,
        PublishMode::NoClobber => rename_noclobber(source, destination)?,
    }
    fs::File::open(parent(destination)?)?.sync_all()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn rename_noclobber(source: &Path, destination: &Path) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let path = |value: &Path| CString::new(value.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "File path contains NUL"));
    let source = path(source)?;
    let destination = path(destination)?;
    // An exclusive rename is atomic: never replace another publisher's file,
    // and never expose a hard-link/copy intermediate as a completed segment.
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renameatx_np(libc::AT_FDCWD, source.as_ptr(), libc::AT_FDCWD, destination.as_ptr(), libc::RENAME_EXCL) };
    #[cfg(target_os = "linux")]
    let result = unsafe { libc::syscall(libc::SYS_renameat2, libc::AT_FDCWD, source.as_ptr(), libc::AT_FDCWD, destination.as_ptr(), libc::RENAME_NOREPLACE) };
    if result == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn rename_noclobber(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "Atomic exclusive rename is unavailable on this platform"))
}

#[cfg(windows)]
fn move_file(source: &Path, destination: &Path, mode: PublishMode) -> io::Result<()> {
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
    let flags = WRITE_THROUGH | if mode == PublishMode::Replace { REPLACE_EXISTING } else { 0 };
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), flags) };
    if result == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(windows)]
fn normalize_temporary_attributes(path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn SetFileAttributesW(path: *const u16, attributes: u32) -> i32;
    }
    let mut path: Vec<u16> = path.as_os_str().encode_wide().collect();
    if path.contains(&0) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "File path contains NUL")); }
    path.push(0);
    // NamedTempFile uses FILE_ATTRIBUTE_TEMPORARY. The published file is no
    // longer temporary; match tempfile's native persistence normalization.
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
    if unsafe { SetFileAttributesW(path.as_ptr(), FILE_ATTRIBUTE_NORMAL) } == 0 {
        Err(io::Error::last_os_error())
    } else { Ok(()) }
}

/// Publish an owned, streamed temporary file in an already admitted directory.
/// No parent is created. The data handle is closed before the durable rename.
pub fn publish_temp(temporary: tempfile::NamedTempFile, destination: &Path, mode: PublishMode) -> io::Result<()> {
    let (source, destination) = same_directory_paths(temporary.path(), destination)?;
    temporary.as_file().sync_all()?;
    let _cleanup = temporary.into_temp_path();
    #[cfg(windows)]
    normalize_temporary_attributes(&source)?;
    move_file(&source, &destination, mode)
}

/// Durably move an owned existing media file without replacing another file.
/// Prepublication failures retain the source. A later directory-sync failure
/// leaves the completed destination in place and reports uncertain durability.
pub fn move_noclobber(source: &Path, destination: &Path) -> io::Result<()> {
    let (source, destination) = same_directory_paths(source, destination)?;
    if !fs::symlink_metadata(&source)?.file_type().is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Durable move requires a regular source file"));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.custom_flags(libc::O_NOFOLLOW); }
    let file = options.open(&source)?;
    file.sync_all()?;
    drop(file);
    move_file(&source, &destination, PublishMode::NoClobber)
}

pub fn publish(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = parent(path)?;
    fs::create_dir_all(directory)?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    temporary.write_all(bytes)?;
    publish_temp(temporary, path, PublishMode::Replace)
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
        let (source, destination) = same_directory_paths(path, tombstone.as_ref())?;
        move_file(&source, &destination, PublishMode::Replace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prepared(directory: &Path, bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new_in(directory).unwrap();
        // Exercise prepared streaming callers without a whole-file helper.
        let middle = bytes.len() / 2;
        file.write_all(&bytes[..middle]).unwrap();
        file.write_all(&bytes[middle..]).unwrap();
        file
    }

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
    fn prepared_publication_preserves_collision_bytes_and_never_creates_parents() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("recording.wav");
        fs::write(&path, b"original").unwrap();
        let error = publish_temp(prepared(root.path(), b"collision"), &path, PublishMode::NoClobber).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
        publish_temp(prepared(root.path(), b"replacement"), &path, PublishMode::Replace).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");

        let missing = root.path().join("missing");
        assert!(publish_temp(prepared(root.path(), b"no recreate"), &missing.join("recording.wav"), PublishMode::Replace).is_err());
        assert!(!missing.exists());
        let other = root.path().join("other");
        fs::create_dir(&other).unwrap();
        assert_eq!(publish_temp(prepared(root.path(), b"wrong parent"), &other.join("recording.wav"), PublishMode::NoClobber).unwrap_err().kind(), io::ErrorKind::InvalidInput);
        assert_eq!(fs::read_dir(&other).unwrap().count(), 0);
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
    }

    #[test]
    fn concurrent_exclusive_publications_have_one_winner_and_no_temporary_leaks() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("recovery.wav");
        let first = prepared(root.path(), b"first complete media");
        let second = prepared(root.path(), b"second complete media");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let first_barrier = barrier.clone();
        let first_destination = destination.clone();
        let first = std::thread::spawn(move || {
            first_barrier.wait();
            publish_temp(first, &first_destination, PublishMode::NoClobber)
        });
        let second = std::thread::spawn(move || {
            barrier.wait();
            publish_temp(second, &destination, PublishMode::NoClobber)
        });
        let results = [first.join().unwrap(), second.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.as_ref().is_err_and(|error| error.kind() == io::ErrorKind::AlreadyExists)).count(), 1);
        let actual = fs::read(root.path().join("recovery.wav")).unwrap();
        assert!(actual == b"first complete media" || actual == b"second complete media");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn existing_media_move_never_clobbers_or_deletes_a_failed_source() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("segment.partial.wav");
        let destination = root.path().join("segment.wav");
        fs::write(&source, b"complete source").unwrap();
        fs::write(&destination, b"retained destination").unwrap();
        assert_eq!(move_noclobber(&source, &destination).unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&source).unwrap(), b"complete source");
        assert_eq!(fs::read(&destination).unwrap(), b"retained destination");
        fs::remove_file(&destination).unwrap();
        move_noclobber(&source, &destination).unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read(&destination).unwrap(), b"complete source");
        assert!(move_noclobber(&source, &destination).is_err());

        let other = root.path().join("other");
        fs::create_dir(&other).unwrap();
        assert_eq!(move_noclobber(&destination, &other.join("segment.wav")).unwrap_err().kind(), io::ErrorKind::InvalidInput);
        assert_eq!(fs::read(&destination).unwrap(), b"complete source");
        assert_eq!(fs::read_dir(&other).unwrap().count(), 0);
    }

    #[test]
    fn disappeared_media_parent_is_not_recreated_and_relocated_bytes_are_retained() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("archive");
        let relocated = root.path().join("retained-archive");
        fs::create_dir(&original).unwrap();
        fs::write(original.join("segment.partial.wav"), b"retained media").unwrap();
        fs::rename(&original, &relocated).unwrap();
        assert_eq!(move_noclobber(&original.join("segment.partial.wav"), &original.join("segment.wav")).unwrap_err().kind(), io::ErrorKind::NotFound);
        assert!(!original.exists());
        assert_eq!(fs::read(relocated.join("segment.partial.wav")).unwrap(), b"retained media");
        assert_eq!(fs::read_dir(&relocated).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn prepared_windows_publication_clears_temporary_attribute_on_extended_unicode_paths() {
        use std::os::windows::{ffi::OsStrExt, fs::MetadataExt};
        let root = tempfile::tempdir().unwrap();
        let mut directory = root.path().to_path_buf();
        while directory.as_os_str().encode_wide().count() < 300 {
            directory.push("stanica-žluť-電台");
        }
        fs::create_dir_all(&directory).unwrap();
        let temporary = prepared(&directory, b"durable media");
        let destination = directory.join("recovery.wav");
        publish_temp(temporary, &destination, PublishMode::NoClobber).unwrap();
        const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x100;
        assert_eq!(fs::metadata(&destination).unwrap().file_attributes() & FILE_ATTRIBUTE_TEMPORARY, 0);
        assert_eq!(fs::read(&destination).unwrap(), b"durable media");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
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
