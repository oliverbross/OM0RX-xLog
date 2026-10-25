//! Recorder-owned files only. No contest SQL, station controls, or audio devices.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn utc_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn err(e: impl std::fmt::Display) -> String {
    format!("Recorder storage: {e}")
}
pub fn uuid(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "Invalid recorder identity".into())
}

/// Refuse symlinks in every existing component, including roots/export parents.
pub fn safe_path(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err("Recorder paths must be absolute".into());
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("Unsafe recorder path".into());
        }
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Recorder paths cannot contain symbolic links".into())
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(err(e)),
            _ => {}
        }
    }
    Ok(())
}
pub fn regular(path: &Path) -> Result<File> {
    safe_path(path)?;
    let meta = fs::symlink_metadata(path).map_err(err)?;
    if !meta.is_file() {
        return Err("Recorder media is not a regular file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() != 1 {
            return Err("Linked recorder media rejected".into());
        }
    }
    File::open(path).map_err(err)
}
pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    safe_path(path)?;
    let parent = path.parent().ok_or("Missing recorder directory")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
    serde_json::to_writer(&mut file, value).map_err(err)?;
    file.as_file().sync_all().map_err(err)?;
    file.persist(path).map_err(err)?;
    File::open(parent).and_then(|f| f.sync_all()).map_err(err)
}
pub fn free_bytes(path: &Path) -> Result<u64> {
    safe_path(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(err)?;
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        let stat = unsafe { stat.assume_init() };
        Ok(stat.f_bavail as u64 * stat.f_frsize as u64)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err("Storage forecasting is unavailable on this platform".into())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub input_id: String,
    pub output_id: String,
    pub channels: u16,
    pub rate: u32,
    pub mapping: String,
    pub roles: Vec<String>,
    pub route_verified: bool,
    pub pre_seconds: u32,
    pub post_seconds: u32,
    pub reserve_bytes: u64,
    pub warning_bytes: u64,
}
impl Config {
    pub fn validate(&self) -> Result<()> {
        if self.input_id.is_empty()
            || self.input_id.len() > 512
            || self.output_id.is_empty()
            || self.output_id.len() > 512
            || !(1..=2).contains(&self.channels)
            || !(8000..=192000).contains(&self.rate)
            || ![
                "Receiver audio only",
                "Operator headphone mix",
                "Custom channel mapping",
            ]
            .contains(&self.mapping.as_str())
            || self.roles.len() != self.channels as usize
            || self
                .roles
                .iter()
                .any(|r| r.trim().is_empty() || r.len() > 128)
            || self.pre_seconds > 600
            || self.post_seconds > 120
            || self.reserve_bytes < 1024 * 1024 * 1024
            || self.warning_bytes < self.reserve_bytes
            || !self.route_verified
        {
            return Err("Choose an explicit mono/stereo source, channel labels, and verified listening route; reserve at least 1 GiB".into());
        }
        Ok(())
    }
    pub fn bytes_per_second(&self) -> u64 {
        self.rate as u64 * self.channels as u64 * 2
    }
    pub fn reserve(&self) -> u64 {
        self.reserve_bytes.max(self.bytes_per_second() * 600)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: u32,
    pub first_frame: u64,
    pub frames: u64,
    pub bytes: u64,
    pub hash: String,
    pub recovered: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: String,
    pub qso_id: Option<String>,
    pub operation_id: Option<String>,
    pub sequence: u64,
    pub revision: u64,
    pub frame: u64,
    pub anchor_utc_ms: u64,
    pub basis: String,
    pub original: Value,
    pub current: Value,
    pub deleted: bool,
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    pub log_id: String,
    pub capture_id: String,
    pub source_version: String,
    pub source_commit: String,
    pub config: Config,
    pub start_utc_ms: u64,
    pub frames: u64,
    #[serde(default)]
    pub saved_frames: u64,
    pub status: String,
    pub segments: Vec<Segment>,
    pub gaps: Vec<Value>,
    pub cursor: u64,
    pub time_basis: String,
    pub consent: String,
    #[serde(default)]
    pub controlled_test: bool,
}

pub struct Archive {
    pub dir: PathBuf,
    pub manifest: Manifest,
    pub links: BTreeMap<String, Link>,
    admissions: BTreeMap<String, (u64, u64)>,
    active: Option<File>,
    active_frames: u64,
    active_first: u64,
    pub segment_frames: u64,
    journal: File,
    #[cfg(unix)]
    directory_identity: (u64, u64),
}
#[derive(Clone)]
pub struct Snapshot {
    pub dir: PathBuf,
    pub manifest: Manifest,
    pub links: BTreeMap<String, Link>,
    active: bool,
    active_first: u64,
}
pub fn segment_path(dir: &Path, id: u32, partial: bool) -> PathBuf {
    dir.join(format!(
        "{id:06}.{}",
        if partial { "partial" } else { "wav" }
    ))
}
#[cfg(unix)]
fn directory_identity(path: &Path) -> Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let m = fs::metadata(path).map_err(err)?;
    Ok((m.dev(), m.ino()))
}
pub fn header(rate: u32, channels: u16, frames: u64) -> Result<[u8; 44]> {
    let bytes = frames
        .checked_mul(channels as u64 * 2)
        .ok_or("WAV overflow")?;
    if bytes > u32::MAX as u64 - 36 {
        return Err("WAV must be exported in bounded parts".into());
    }
    let mut h = [0; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(bytes as u32 + 36).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&rate.to_le_bytes());
    h[28..32].copy_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
    h[32..34].copy_from_slice(&(channels * 2).to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&(bytes as u32).to_le_bytes());
    Ok(h)
}
type IntegrityStamp = (u64, Option<std::time::SystemTime>, u64, u64, i64, i64);
fn stamp(meta: &fs::Metadata) -> IntegrityStamp {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (
            meta.len(),
            meta.modified().ok(),
            meta.dev(),
            meta.ino(),
            meta.ctime(),
            meta.ctime_nsec(),
        )
    }
    #[cfg(not(unix))]
    {
        (meta.len(), meta.modified().ok(), 0, 0, 0, 0)
    }
}
fn integrity_cache() -> &'static std::sync::Mutex<BTreeMap<PathBuf, (IntegrityStamp, String)>> {
    static CACHE: std::sync::OnceLock<
        std::sync::Mutex<BTreeMap<PathBuf, (IntegrityStamp, String)>>,
    > = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}
fn verified(path: &Path, segment: &Segment) -> bool {
    let Ok(file) = regular(path) else {
        return false;
    };
    let Ok(meta) = file.metadata() else {
        return false;
    };
    if meta.len() != segment.bytes {
        return false;
    }
    let identity = stamp(&meta);
    let cached = integrity_cache().lock().ok().and_then(|c| {
        c.get(path)
            .filter(|(s, _)| *s == identity)
            .map(|(_, h)| h.clone())
    });
    cached
        .or_else(|| digest(path).ok())
        .is_some_and(|hash| hash == segment.hash)
}
fn digest(path: &Path) -> Result<String> {
    let mut file = regular(path)?;
    let before = stamp(&file.metadata().map_err(err)?);
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        let n = file.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    if before != stamp(&file.metadata().map_err(err)?) {
        return Err("Recorder media changed during verification".into());
    }
    let hash = format!("{:x}", hash.finalize());
    if let Ok(mut cache) = integrity_cache().lock() {
        if cache.len() >= 8192 {
            cache.clear();
        }
        cache.insert(path.into(), (before, hash.clone()));
    }
    Ok(hash)
}
impl Archive {
    pub fn create(root: &Path, log_id: &str, config: Config) -> Result<Self> {
        uuid(log_id)?;
        config.validate()?;
        safe_path(root)?;
        if !root.is_dir() || free_bytes(root)? < config.reserve() {
            return Err("Recorder disk reserve reached or root unavailable".into());
        }
        let capture_id = uuid::Uuid::new_v4().to_string();
        let log_dir = root.join(log_id);
        safe_path(&log_dir)?;
        fs::create_dir_all(&log_dir).map_err(err)?;
        let dir = log_dir.join(&capture_id);
        fs::create_dir(&dir).map_err(err)?;
        let journal = OpenOptions::new()
            .create_new(true)
            .append(true)
            .open(dir.join("events.jsonl"))
            .map_err(err)?;
        let manifest=Manifest{schema:1,log_id:log_id.into(),capture_id,source_version:env!("CARGO_PKG_VERSION").into(),
            source_commit:option_env!("XLOG_SOURCE_COMMIT").unwrap_or("development-unrecorded").into(),
            config:config.clone(),start_utc_ms:utc_ms(),frames:0,saved_frames:0,status:"starting".into(),segments:vec![],gaps:vec![],cursor:0,
            time_basis:"Local callback arrival / monotonic frame order; hardware latency and distant RF timing unverified".into(),
            consent:"Explicit Start; no restart auto-start; user-managed retention; no automatic pruning".into(),controlled_test:false};
        #[cfg(unix)]
        let directory_identity = directory_identity(&dir)?;
        let result = Self {
            dir,
            manifest,
            links: BTreeMap::new(),
            admissions: BTreeMap::new(),
            active: None,
            active_frames: 0,
            active_first: 0,
            segment_frames: config.rate as u64 * 60,
            journal,
            #[cfg(unix)]
            directory_identity,
        };
        result.checkpoint()?;
        Ok(result)
    }
    pub fn load(root: &Path, log_id: &str, capture_id: &str) -> Result<Self> {
        uuid(log_id)?;
        uuid(capture_id)?;
        let dir = root.join(log_id).join(capture_id);
        let file = regular(&dir.join("manifest.json"))?;
        if file.metadata().map_err(err)?.len() > 8 * 1024 * 1024 {
            return Err("Recorder manifest too large".into());
        }
        let manifest: Manifest = serde_json::from_reader(file).map_err(err)?;
        if manifest.schema != 1 || manifest.log_id != log_id || manifest.capture_id != capture_id {
            return Err("Archive identity mismatch".into());
        }
        manifest.config.validate()?;
        let mut first = 0;
        for (index, s) in manifest.segments.iter().enumerate() {
            if s.id != index as u32
                || s.first_frame != first
                || s.frames > manifest.config.rate as u64 * 61
                || s.bytes != 44 + s.frames * manifest.config.channels as u64 * 2
                || s.hash.len() != 64
                || !s.hash.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("Invalid recorder segment inventory".into());
            }
            first = first
                .checked_add(s.frames)
                .ok_or("Recorder frame overflow")?;
        }
        if manifest.start_utc_ms > 253402300799999
            || manifest.frames < first
            || manifest.frames > first + manifest.config.rate as u64 * 60
            || manifest.frames > manifest.config.rate as u64 * 7 * 86400
            || manifest.gaps.len() > 10000
        {
            return Err("Invalid recorder time/frame inventory".into());
        }
        let path = dir.join("events.jsonl");
        let file = regular(&path)?;
        use std::io::BufRead;
        let mut links = BTreeMap::new();
        let mut admissions = BTreeMap::new();
        // A torn final journal line is ignored, never extended into a valid event.
        let mut reader = std::io::BufReader::new(file);
        let mut bytes = Vec::new();
        let mut valid_bytes = 0u64;
        let mut torn = false;
        loop {
            bytes.clear();
            let n = reader
                .by_ref()
                .take(32769)
                .read_until(b'\n', &mut bytes)
                .map_err(err)?;
            if n == 0 {
                break;
            }
            if n > 32768 {
                return Err("Recorder journal entry too large".into());
            }
            if bytes.last() != Some(&b'\n') {
                torn = true;
                break;
            }
            let event: Value = serde_json::from_slice(&bytes).map_err(err)?;
            if event["type"] == "link" {
                let link: Link = serde_json::from_value(event["link"].clone()).map_err(err)?;
                uuid(&link.id)?;
                if link.note.len() > 1024
                    || link.frame > manifest.config.rate as u64 * 7 * 86400
                    || links.len() > 50000
                {
                    return Err("Invalid recorder bookmark inventory".into());
                }
                links.insert(link.id.clone(), link);
            }
            if event["type"] == "admission" {
                if let (Some(op), Some(frame), Some(utc)) = (
                    event["operationID"].as_str(),
                    event["frame"].as_u64(),
                    event["utcMs"].as_u64(),
                ) {
                    uuid(op)?;
                    if admissions.len() < 50000 {
                        admissions.insert(op.to_owned(), (frame, utc));
                    }
                }
            }
            valid_bytes += n as u64;
        }
        if torn {
            drop(reader);
            let original = dir.join(format!(
                "events.torn-original-{}.jsonl",
                uuid::Uuid::new_v4()
            ));
            fs::copy(&path, &original).map_err(err)?;
            let file = OpenOptions::new().write(true).open(&path).map_err(err)?;
            file.set_len(valid_bytes).map_err(err)?;
            file.sync_all().map_err(err)?;
        }
        let journal = OpenOptions::new().append(true).open(path).map_err(err)?;
        #[cfg(unix)]
        let directory_identity = directory_identity(&dir)?;
        Ok(Self {
            segment_frames: manifest.config.rate as u64 * 60,
            dir,
            manifest,
            links,
            admissions,
            active: None,
            active_frames: 0,
            active_first: 0,
            journal,
            #[cfg(unix)]
            directory_identity,
        })
    }
    fn check_destination(&self) -> Result<()> {
        safe_path(&self.dir)?;
        #[cfg(unix)]
        if directory_identity(&self.dir)? != self.directory_identity {
            return Err(
                "Recording directory/volume changed; no alternate destination permitted".into(),
            );
        }
        Ok(())
    }
    pub fn event(&mut self, event: Value) -> Result<()> {
        self.check_destination()?;
        let mut bytes = serde_json::to_vec(&event).map_err(err)?;
        if bytes.len() > 32767 {
            return Err("Recorder event too large".into());
        }
        bytes.push(b'\n');
        self.journal
            .write_all(&bytes)
            .and_then(|_| self.journal.sync_data())
            .map_err(err)?;
        if event["type"] == "admission" {
            if let (Some(op), Some(frame), Some(utc)) = (
                event["operationID"].as_str(),
                event["frame"].as_u64(),
                event["utcMs"].as_u64(),
            ) {
                if self.admissions.len() < 50000 {
                    self.admissions.entry(op.into()).or_insert((frame, utc));
                }
            }
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> Result<()> {
        self.check_destination()?;
        atomic_json(&self.dir.join("manifest.json"), &self.manifest)
    }
    fn open_segment(&mut self) -> Result<()> {
        let id = self.manifest.segments.len() as u32;
        let path = segment_path(&self.dir, id, true);
        safe_path(&path)?;
        let mut f = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(path)
            .map_err(err)?;
        f.write_all(&header(
            self.manifest.config.rate,
            self.manifest.config.channels,
            0,
        )?)
        .map_err(err)?;
        self.active = Some(f);
        self.active_frames = 0;
        self.active_first = self.manifest.frames;
        Ok(())
    }
    pub fn append(&mut self, samples: &[i16]) -> Result<()> {
        self.check_destination()?;
        if self.manifest.frames > self.manifest.config.rate as u64 * 7 * 86400 {
            return Err("Seven-day capture bound reached; explicitly start a new capture".into());
        }
        let channels = self.manifest.config.channels as usize;
        if samples.len() % channels != 0 {
            return Err("Incomplete PCM frame".into());
        }
        let mut offset = 0;
        while offset < samples.len() {
            if self.active.is_none() {
                self.open_segment()?;
            }
            let n = ((self.segment_frames - self.active_frames) as usize * channels)
                .min(samples.len() - offset);
            let mut bytes = Vec::with_capacity(n * 2);
            for sample in &samples[offset..offset + n] {
                bytes.extend(sample.to_le_bytes());
            }
            self.active
                .as_mut()
                .unwrap()
                .write_all(&bytes)
                .map_err(err)?;
            let frames = (n / channels) as u64;
            self.active_frames += frames;
            self.manifest.frames += frames;
            offset += n;
            self.manifest.status = "recording".into();
            if self.active_frames == self.segment_frames {
                self.finalize_segment()?;
            }
        }
        Ok(())
    }
    pub fn flush_tail(&mut self) -> Result<()> {
        if let Some(file) = self.active.as_mut() {
            file.seek(SeekFrom::Start(0)).map_err(err)?;
            file.write_all(&header(
                self.manifest.config.rate,
                self.manifest.config.channels,
                self.active_frames,
            )?)
            .map_err(err)?;
            file.seek(SeekFrom::End(0)).map_err(err)?;
            file.sync_data().map_err(err)?;
        }
        self.manifest.saved_frames = self.manifest.frames;
        self.checkpoint()
    }
    pub fn finalize_segment(&mut self) -> Result<()> {
        self.flush_tail()?;
        if let Some(file) = self.active.take() {
            file.sync_all().map_err(err)?;
            drop(file);
            let id = self.manifest.segments.len() as u32;
            let partial = segment_path(&self.dir, id, true);
            let path = segment_path(&self.dir, id, false);
            safe_path(&path)?;
            if path.exists() {
                return Err("Recorder refuses to overwrite an original".into());
            }
            fs::rename(&partial, &path).map_err(err)?;
            let segment = Segment {
                id,
                first_frame: self.active_first,
                frames: self.active_frames,
                bytes: fs::metadata(&path).map_err(err)?.len(),
                hash: digest(&path)?,
                recovered: false,
            };
            self.event(json!({"type":"segment","segment":segment}))?;
            self.manifest.segments.push(segment);
            self.active_frames = 0;
            self.checkpoint()?;
        }
        Ok(())
    }
    pub fn finish(&mut self, status: &str, reason: Option<&str>) -> Result<()> {
        self.finalize_segment()?;
        self.manifest.status = status.into();
        if let Some(reason) = reason {
            let gap = json!({"utcMs":utc_ms(),"afterFrame":self.manifest.frames,"reason":reason,"end":"unknown"});
            self.event(json!({"type":"gap","gap":gap}))?;
            self.manifest.gaps.push(gap);
        }
        self.checkpoint()
    }
    pub fn manual(&mut self, note: &str) -> Result<Link> {
        if note.len() > 1024 || self.manifest.frames == 0 {
            return Err("Bookmark needs captured samples and a note of at most 1024 bytes".into());
        }
        let link = Link {
            id: uuid::Uuid::new_v4().to_string(),
            qso_id: None,
            operation_id: None,
            sequence: 0,
            revision: 0,
            frame: self.manifest.frames,
            anchor_utc_ms: self.manifest.start_utc_ms
                + self.manifest.frames * 1000 / self.manifest.config.rate as u64,
            basis: "captured sample watermark".into(),
            original: Value::Null,
            current: Value::Null,
            deleted: false,
            note: note.into(),
        };
        self.save_link(link.clone())?;
        Ok(link)
    }
    pub fn save_link(&mut self, link: Link) -> Result<()> {
        if !self.links.contains_key(&link.id) && self.links.len() >= 50000 {
            return Err("Recorder bookmark limit reached; originals retained".into());
        }
        self.event(json!({"type":"link","link":link}))?;
        self.links.insert(link.id.clone(), link);
        Ok(())
    }
    /// Idempotent committed audit catch-up. Admission markers never create contacts.
    pub fn reconcile(
        &mut self,
        page: &Value,
        markers: &BTreeMap<String, (u64, u64)>,
    ) -> Result<()> {
        if page["engine"] != "not1mm-python" || page["sessionID"] != self.manifest.log_id {
            return Err("Wrong recorder audit scope".into());
        }
        let events = page["events"]
            .as_array()
            .ok_or("Invalid recorder audit page")?;
        if events.is_empty() {
            return Ok(());
        }
        for event in events {
            let seq = event["sequence"].as_u64().ok_or("Invalid audit sequence")?;
            if seq <= self.manifest.cursor {
                continue;
            }
            let id = event["qsoID"].as_str().ok_or("Missing QSO identity")?;
            uuid(id)?;
            if let Some(mut link) = self.links.get(id).cloned() {
                link.current = event["after"].clone();
                link.revision = event["revision"].as_u64().unwrap_or(0);
                link.deleted = event["kind"] == "delete";
                self.save_link(link)?;
            } else if event["kind"] == "commit" && event["local"] == true {
                let op = event["operationID"]
                    .as_str()
                    .ok_or("Missing commit operation")?;
                let estimate = event["utcMs"].as_u64().unwrap_or(0);
                let marker = markers.get(op).or_else(|| self.admissions.get(op)).copied();
                let (frame, utc, basis) = if let Some((frame, utc)) = marker {
                    (frame, utc, "local operation admission / callback watermark")
                } else if estimate >= self.manifest.start_utc_ms
                    && estimate
                        <= self.manifest.start_utc_ms
                            + self.manifest.frames * 1000 / self.manifest.config.rate as u64
                {
                    (
                        (estimate - self.manifest.start_utc_ms) * self.manifest.config.rate as u64
                            / 1000,
                        estimate,
                        "recorded QSO time estimate / no admission marker",
                    )
                } else {
                    self.manifest.cursor = seq;
                    continue;
                };
                let link = Link {
                    id: id.into(),
                    qso_id: Some(id.into()),
                    operation_id: Some(op.into()),
                    sequence: seq,
                    revision: event["revision"].as_u64().unwrap_or(0),
                    frame,
                    anchor_utc_ms: utc,
                    basis: basis.into(),
                    original: event["after"].clone(),
                    current: event["after"].clone(),
                    deleted: false,
                    note: String::new(),
                };
                self.save_link(link)?;
            }
            self.manifest.cursor = seq;
        }
        self.checkpoint()
    }
    /// Repair to a NEW file, retaining the partial original. No fabricated samples.
    pub fn recover(&mut self) -> Result<()> {
        let id = self.manifest.segments.len() as u32;
        // Rename may have succeeded before manifest publication: verify and adopt it.
        let final_path = segment_path(&self.dir, id, false);
        let partial = segment_path(&self.dir, id, true);
        let source = if final_path.exists() {
            final_path.clone()
        } else {
            partial.clone()
        };
        if source.exists() {
            let mut input = regular(&source)?;
            let len = input.metadata().map_err(err)?.len();
            let channels = self.manifest.config.channels;
            let rate = self.manifest.config.rate;
            let mut h = [0; 44];
            input.read_exact(&mut h).map_err(err)?;
            let expected = header(rate, channels, 0)?;
            if h[0..4] != expected[0..4]
                || h[8..40] != expected[8..40]
                || len < 44
                || len > 44 + rate as u64 * channels as u64 * 2 * 61
            {
                return Err("Unrecognized partial audio; retained for manual recovery".into());
            }
            let frames = (len - 44) / (channels as u64 * 2);
            let path = if source == partial {
                self.dir.join(format!("{id:06}.recovered.wav"))
            } else {
                source.clone()
            };
            if source == partial {
                safe_path(&path)?;
                let mut out = tempfile::NamedTempFile::new_in(&self.dir).map_err(err)?;
                out.write_all(&header(rate, channels, frames)?)
                    .map_err(err)?;
                std::io::copy(&mut input.take(frames * channels as u64 * 2), &mut out)
                    .map_err(err)?;
                out.as_file().sync_all().map_err(err)?;
                // A prior recovery may have synced its output before publishing
                // the manifest. Adopt only byte-identical complete output.
                let prepared_hash = digest(out.path())?;
                if path.exists() && digest(&path).is_ok_and(|hash| hash == prepared_hash) {
                    // Temp copy drops; prior complete recovery is preserved.
                } else {
                    if path.exists() {
                        regular(&path)?;
                        let retained = self.dir.join(format!(
                            "{id:06}.interrupted-recovery-{}.wav",
                            uuid::Uuid::new_v4()
                        ));
                        fs::rename(&path, retained).map_err(err)?;
                    }
                    out.persist_noclobber(&path).map_err(err)?;
                    File::open(&self.dir)
                        .and_then(|f| f.sync_all())
                        .map_err(err)?;
                }
            }
            let first = self
                .manifest
                .segments
                .last()
                .map(|s| s.first_frame + s.frames)
                .unwrap_or(0);
            self.manifest.segments.push(Segment {
                id,
                first_frame: first,
                frames,
                bytes: 44 + frames * channels as u64 * 2,
                hash: digest(&path)?,
                recovered: source == partial,
            });
            self.manifest.frames = first + frames;
            self.event(json!({"type":"recovery","retainedOriginal":source.file_name().unwrap().to_string_lossy(),"discardedIncompleteFrameBytes":(len-44)%(channels as u64*2),"powerLossGuarantee":"OS sync checkpoint only; hardware cache durability unproven"}))?;
        }
        self.finish(
            "recovered",
            Some("Application interruption; explicit Start required, unknown missing interval"),
        )
    }
    pub fn media_path(&self, segment: &Segment) -> PathBuf {
        if segment.recovered {
            self.dir.join(format!("{:06}.recovered.wav", segment.id))
        } else {
            segment_path(&self.dir, segment.id, false)
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            dir: self.dir.clone(),
            manifest: self.manifest.clone(),
            links: self.links.clone(),
            active: self.active.is_some(),
            active_first: self.active_first,
        }
    }
    pub fn coverage(&self, start: u64, end: u64) -> String {
        coverage(&self.dir, &self.manifest, start, end)
    }
    #[cfg(test)]
    pub fn read_pcm(&self, start: u64, end: u64) -> Result<Vec<i16>> {
        self.snapshot().read_pcm(start, end)
    }
}
impl Snapshot {
    pub fn coverage(&self, start: u64, end: u64) -> String {
        coverage(&self.dir, &self.manifest, start, end)
    }
    pub fn media_path(&self, segment: &Segment) -> PathBuf {
        if segment.recovered {
            self.dir.join(format!("{:06}.recovered.wav", segment.id))
        } else {
            segment_path(&self.dir, segment.id, false)
        }
    }
    /// Bounded read; playback never loads an event-length recording into memory.
    pub fn read_pcm(&self, start: u64, end: u64) -> Result<Vec<i16>> {
        if start >= end
            || end > self.manifest.frames
            || end - start > self.manifest.config.rate as u64 * 720
        {
            return Err(
                "Choose up to 12 minutes of captured audio; pending/gap intervals cannot play"
                    .into(),
            );
        }
        let channels = self.manifest.config.channels as u64;
        let mut output = Vec::with_capacity(((end - start) * channels) as usize);
        for s in &self.manifest.segments {
            let a = start.max(s.first_frame);
            let b = end.min(s.first_frame + s.frames);
            if a >= b {
                continue;
            }
            let path = self.media_path(s);
            if digest(&path)? != s.hash {
                return Err("Recorder media hash mismatch; original retained".into());
            }
            read_range(&path, a - s.first_frame, b - a, channels, &mut output)?;
        }
        if self.active {
            let a = start.max(self.active_first);
            if a < end {
                let partial = segment_path(&self.dir, self.manifest.segments.len() as u32, true);
                // Rotation may have renamed the frozen active tail while this reader prepared.
                let path = if partial.exists() {
                    partial
                } else {
                    segment_path(&self.dir, self.manifest.segments.len() as u32, false)
                };
                read_range(&path, a - self.active_first, end - a, channels, &mut output)?;
            }
        }
        if output.len() as u64 != (end - start) * channels {
            return Err("Audio interval has a coverage gap".into());
        }
        Ok(output)
    }
    pub fn export(&self, parent: &Path, include_notes: bool) -> Result<PathBuf> {
        self.export_cancellable(
            parent,
            include_notes,
            &std::sync::atomic::AtomicBool::new(false),
        )
    }
    pub fn export_cancellable(
        &self,
        parent: &Path,
        include_notes: bool,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<PathBuf> {
        safe_path(parent)?;
        if !parent.is_dir() || parent.starts_with(&self.dir) {
            return Err("Choose a separate export folder".into());
        }
        let dir = parent.join(format!(
            "xlog-audio-{}-{}",
            self.manifest.capture_id,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&dir).map_err(err)?;
        let mut manifest = self.manifest.clone();
        manifest.frames = manifest
            .segments
            .last()
            .map(|s| s.first_frame + s.frames)
            .unwrap_or(0);
        manifest.status = "export snapshot / finalized segments only".into();
        // No completion manifest until EVERY member is copied and independently hashed.
        for s in &manifest.segments {
            let source = self.media_path(s);
            if digest(&source)? != s.hash {
                return Err(
                    "Export stopped: missing/corrupt original; incomplete folder has no manifest"
                        .into(),
                );
            }
            let target = dir.join(source.file_name().ok_or("Missing media name")?);
            let mut input = regular(&source)?;
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&target)
                .map_err(err)?;
            let mut buffer = [0u8; 65536];
            loop {
                if cancel.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(
                        "Export cancelled; incomplete directory has no completion manifest".into(),
                    );
                }
                let n = input.read(&mut buffer).map_err(err)?;
                if n == 0 {
                    break;
                }
                output.write_all(&buffer[..n]).map_err(err)?;
            }
            output.sync_all().map_err(err)?;
            if digest(&target)? != s.hash {
                return Err("Export integrity check failed".into());
            }
        }
        let mut links: Vec<_> = self.links.values().cloned().collect();
        if !include_notes {
            for link in &mut links {
                link.note.clear();
            }
        }
        atomic_json(&dir.join("bookmarks.json"), &links)?;
        let playlist = manifest
            .segments
            .iter()
            .map(|s| {
                self.media_path(s)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(dir.join("continuous.m3u"), format!("#EXTM3U\n{playlist}\n")).map_err(err)?;
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err("Export cancelled; no completion manifest".into());
        }
        atomic_json(&dir.join("manifest.json"), &manifest)?;
        Ok(dir)
    }
}
fn coverage(dir: &Path, m: &Manifest, start: u64, end: u64) -> String {
    if start >= end || start >= m.frames {
        return "unavailable".into();
    }
    if end > m.frames {
        return if m.status == "recording" {
            "pending-tail"
        } else {
            "partial"
        }
        .into();
    }
    for s in &m.segments {
        let path = if s.recovered {
            dir.join(format!("{:06}.recovered.wav", s.id))
        } else {
            segment_path(dir, s.id, false)
        };
        if s.first_frame < end && s.first_frame + s.frames > start && !verified(&path, s) {
            return "file missing/corrupt".into();
        }
    }
    let finalized = m
        .segments
        .last()
        .map(|s| s.first_frame + s.frames)
        .unwrap_or(0);
    if end > finalized {
        let path = segment_path(dir, m.segments.len() as u32, true);
        let minimum = 44 + (end - finalized) * m.config.channels as u64 * 2;
        if !regular(&path)
            .and_then(|f| f.metadata().map_err(err))
            .is_ok_and(|meta| meta.len() >= minimum)
        {
            return "file missing/corrupt".into();
        }
    }
    "available".into()
}
fn read_range(
    path: &Path,
    first: u64,
    frames: u64,
    channels: u64,
    output: &mut Vec<i16>,
) -> Result<()> {
    let mut file = regular(path)?;
    file.seek(SeekFrom::Start(44 + first * channels * 2))
        .map_err(err)?;
    let mut bytes = vec![0; (frames * channels * 2) as usize];
    file.read_exact(&mut bytes).map_err(err)?;
    output.extend(
        bytes
            .chunks_exact(2)
            .map(|v| i16::from_le_bytes([v[0], v[1]])),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(channels: u16) -> Config {
        Config {
            input_id: "fixture-input-uid".into(),
            output_id: "fixture-headphones-uid".into(),
            channels,
            rate: 8000,
            mapping: "Custom channel mapping".into(),
            roles: (0..channels)
                .map(|i| format!("Receiver {} / fixture only", i + 1))
                .collect(),
            route_verified: true,
            pre_seconds: 45,
            post_seconds: 10,
            reserve_bytes: 1 << 30,
            warning_bytes: 5 << 30,
        }
    }
    fn root() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap();
        (temp, path)
    }
    fn archive(root: &Path, channels: u16) -> Archive {
        Archive::create(root, &uuid::Uuid::new_v4().to_string(), config(channels)).unwrap()
    }
    fn signal(frames: usize, channels: usize) -> Vec<i16> {
        (0..frames)
            .flat_map(|f| {
                (0..channels).map(move |c| if c == 0 { f as i16 } else { -(f as i16) - 100 })
            })
            .collect()
    }
    #[test]
    fn mono_stereo_rotation_and_frozen_replay_inspect_every_sample() {
        for channels in [1, 2] {
            let (_t, root) = root();
            let mut a = archive(&root, channels);
            a.segment_frames = 11;
            let samples = signal(90, channels as usize);
            a.append(&samples[..27 * channels as usize]).unwrap();
            let snapshot = a.snapshot();
            let end = snapshot.manifest.frames;
            a.append(&samples[27 * channels as usize..]).unwrap();
            assert_eq!(
                snapshot.read_pcm(0, end).unwrap(),
                samples[..27 * channels as usize]
            );
            a.finish("stopped", None).unwrap();
            assert_eq!(a.manifest.frames, 90);
            assert_eq!(a.read_pcm(0, 90).unwrap(), samples);
            assert!(a
                .manifest
                .segments
                .windows(2)
                .all(|s| s[0].first_frame + s[0].frames == s[1].first_frame));
        }
    }
    #[test]
    fn crash_partial_recovery_preserves_original_and_reports_torn_frame() {
        let (_t, root) = root();
        let mut a = archive(&root, 2);
        let id = a.manifest.capture_id.clone();
        let log = a.manifest.log_id.clone();
        let samples = signal(42, 2);
        a.append(&samples).unwrap();
        a.flush_tail().unwrap();
        let partial = segment_path(&a.dir, 0, true);
        drop(a);
        OpenOptions::new()
            .append(true)
            .open(&partial)
            .unwrap()
            .write_all(&[99])
            .unwrap();
        let original = fs::read(&partial).unwrap();
        let mut recovered = Archive::load(&root, &log, &id).unwrap();
        recovered.recover().unwrap();
        assert_eq!(fs::read(&partial).unwrap(), original);
        assert_eq!(recovered.read_pcm(0, 42).unwrap(), samples);
        assert_eq!(recovered.manifest.status, "recovered");
        assert!(!recovered.manifest.gaps.is_empty());
        let again = Archive::load(&root, &log, &id).unwrap();
        assert_eq!(again.read_pcm(0, 42).unwrap(), samples);
    }
    #[test]
    fn recovery_output_before_manifest_can_be_retried_and_partial_outputs_are_retained() {
        for interrupted in [false, true] {
            let (_t, root) = root();
            let mut a = archive(&root, 2);
            let samples = signal(42, 2);
            a.append(&samples).unwrap();
            a.flush_tail().unwrap();
            let key = (a.manifest.log_id.clone(), a.manifest.capture_id.clone());
            let partial = segment_path(&a.dir, 0, true);
            let original = fs::read(&partial).unwrap();
            let recovered = a.dir.join("000000.recovered.wav");
            let mut output = header(8000, 2, 42).unwrap().to_vec();
            output.extend_from_slice(&original[44..]);
            if interrupted {
                output.truncate(50);
            }
            fs::write(&recovered, &output).unwrap();
            drop(a);
            let mut a = Archive::load(&root, &key.0, &key.1).unwrap();
            a.recover().unwrap();
            assert_eq!(a.read_pcm(0, 42).unwrap(), samples);
            assert_eq!(fs::read(partial).unwrap(), original);
            if interrupted {
                assert!(fs::read_dir(&a.dir).unwrap().flatten().any(|e| e
                    .file_name()
                    .to_string_lossy()
                    .contains("interrupted-recovery")));
            }
            a.recover().unwrap();
            assert_eq!(a.manifest.segments.len(), 1);
        }
    }
    #[test]
    fn rename_before_manifest_is_adopted_without_overwrite() {
        let (_t, root) = root();
        let mut a = archive(&root, 1);
        a.append(&signal(10, 1)).unwrap();
        a.flush_tail().unwrap();
        let key = (a.manifest.log_id.clone(), a.manifest.capture_id.clone());
        let dir = a.dir.clone();
        drop(a);
        fs::rename(segment_path(&dir, 0, true), segment_path(&dir, 0, false)).unwrap();
        let hash = digest(&segment_path(&dir, 0, false)).unwrap();
        let mut a = Archive::load(&root, &key.0, &key.1).unwrap();
        a.recover().unwrap();
        assert_eq!(a.manifest.segments.len(), 1);
        assert_eq!(a.manifest.segments[0].hash, hash);
        assert_eq!(a.read_pcm(0, 10).unwrap(), signal(10, 1));
    }
    #[test]
    fn journal_torn_tail_keeps_backup_and_manual_bookmark_survives_restart() {
        let (_t, root) = root();
        let mut a = archive(&root, 1);
        a.append(&signal(20, 1)).unwrap();
        let link = a.manual("Operator note").unwrap();
        a.finish("paused", Some("pause fixture")).unwrap();
        let key = (a.manifest.log_id.clone(), a.manifest.capture_id.clone());
        let dir = a.dir.clone();
        drop(a);
        OpenOptions::new()
            .append(true)
            .open(dir.join("events.jsonl"))
            .unwrap()
            .write_all(b"{\"type\":")
            .unwrap();
        let mut a = Archive::load(&root, &key.0, &key.1).unwrap();
        assert_eq!(a.links[&link.id].frame, 20);
        assert_eq!(a.links[&link.id].note, "Operator note");
        a.manual("After restart").unwrap();
        drop(a);
        assert_eq!(Archive::load(&root, &key.0, &key.1).unwrap().links.len(), 2);
        assert!(fs::read_dir(&dir).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("events.torn-original")));
    }
    #[test]
    fn actual_python_commit_correction_delete_retry_and_durable_admission() {
        let (_t, root) = root();
        let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let result = std::process::Command::new(
            std::env::var("XLOG_TEST_PYTHON").unwrap_or_else(|_| "python3.12".into()),
        )
        .arg(project.join("python/tests/recorder_fixture.py"))
        .env("PYTHONPATH", project.join("python"))
        .output()
        .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let fixture: Value = serde_json::from_slice(&result.stdout).unwrap();
        let commit = &fixture["commit"];
        let log = commit["sessionID"].as_str().unwrap();
        let mut a = Archive::create(&root, log, config(2)).unwrap();
        a.append(&signal(100, 2)).unwrap();
        let event = &commit["events"][0];
        let op = event["operationID"].as_str().unwrap();
        let qso = event["qsoID"].as_str().unwrap();
        a.event(json!({"type":"admission","operationID":op,"frame":70,"utcMs":a.manifest.start_utc_ms+8})).unwrap();
        let key = a.manifest.capture_id.clone();
        a.finish("stopped", None).unwrap();
        drop(a);
        let mut a = Archive::load(&root, log, &key).unwrap();
        let markers = BTreeMap::new();
        a.reconcile(commit, &markers).unwrap();
        a.reconcile(commit, &markers).unwrap();
        assert_eq!(a.links.len(), 1);
        let original = a.links[qso].clone();
        assert_eq!(original.frame, 70);
        assert!(original.basis.starts_with("local operation"));
        a.reconcile(&fixture["correction"], &markers).unwrap();
        assert_eq!(a.links[qso].frame, 70);
        assert_eq!(a.links[qso].original, original.original);
        assert_eq!(a.links[qso].current["Call"], "DL1ABC");
        a.reconcile(&fixture["deletion"], &markers).unwrap();
        assert!(a.links[qso].deleted);
        assert_eq!(a.read_pcm(0, 100).unwrap(), signal(100, 2));
        let mut other = archive(&root, 2);
        assert!(other.reconcile(commit, &markers).is_err());
        assert!(other.links.is_empty());
    }
    #[test]
    fn remote_contacts_never_inherit_local_audio_and_pending_tail_is_truthful() {
        let (_t, root) = root();
        let mut a = archive(&root, 1);
        a.append(&signal(100, 1)).unwrap();
        let qso = uuid::Uuid::new_v4().to_string();
        let op = uuid::Uuid::new_v4().to_string();
        let mut page = json!({"engine":"not1mm-python","sessionID":a.manifest.log_id,"events":[{"sequence":1,"revision":1,"operationID":op,"qsoID":qso,"kind":"commit","after":{"Call":"K1ABC"},"local":false}]});
        let markers = BTreeMap::from([(op, (90, a.manifest.start_utc_ms + 10))]);
        a.reconcile(&page, &markers).unwrap();
        assert!(a.links.is_empty());
        page["events"][0]["local"] = json!(true);
        page["events"][0]["sequence"] = json!(2);
        a.reconcile(&page, &markers).unwrap();
        assert_eq!(a.coverage(0, 101), "pending-tail");
        a.finish("stopped", None).unwrap();
        assert_eq!(a.coverage(0, 101), "partial");
    }
    #[test]
    fn export_independently_decodes_order_and_preserves_original_hashes() {
        let (_t, root) = root();
        let mut a = archive(&root, 2);
        a.segment_frames = 13;
        let samples = signal(101, 2);
        a.append(&samples).unwrap();
        a.finish("stopped", Some("Explicit fixture gap")).unwrap();
        let hashes: Vec<_> = a.manifest.segments.iter().map(|s| s.hash.clone()).collect();
        let export = a.snapshot().export(&root, false).unwrap();
        let result=std::process::Command::new("python3").arg("-c").arg("import wave,struct,json,sys,pathlib; p=pathlib.Path(sys.argv[1]); m=json.loads((p/'manifest.json').read_text()); data=[]\nfor s in m['segments']:\n f=wave.open(str(p/(str(s['id']).zfill(6)+'.wav'))); assert f.getnchannels()==2 and f.getframerate()==8000; b=f.readframes(f.getnframes()); data.extend(struct.unpack('<'+'h'*(len(b)//2),b))\nassert data==[v for i in range(101) for v in (i,-i-100)]; assert m['gaps']; print('independent PCM decoder: 101 stereo frames match')").arg(&export).output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(export.join("manifest.json").is_file());
        assert_eq!(
            a.manifest
                .segments
                .iter()
                .map(|s| digest(&a.media_path(s)).unwrap())
                .collect::<Vec<_>>(),
            hashes
        );
    }
    #[test]
    fn corrupt_missing_symlink_and_volume_replacement_are_rejected() {
        let (_t, root) = root();
        let mut a = archive(&root, 1);
        a.append(&signal(10, 1)).unwrap();
        a.finish("stopped", None).unwrap();
        let media = a.media_path(&a.manifest.segments[0]);
        let original = fs::read(&media).unwrap();
        assert_eq!(a.coverage(0, 10), "available");
        let mut changed = original.clone();
        changed[44] ^= 1;
        fs::write(&media, changed).unwrap();
        assert_eq!(a.coverage(0, 10), "file missing/corrupt");
        fs::write(&media, &original[..50]).unwrap();
        assert_eq!(a.coverage(0, 10), "file missing/corrupt");
        fs::write(&media, &original).unwrap();
        assert_eq!(a.coverage(0, 10), "available");
        fs::write(&media, &original[..50]).unwrap();
        assert!(a.read_pcm(0, 10).is_err());
        fs::remove_file(&media).unwrap();
        assert_eq!(a.coverage(0, 10), "file missing/corrupt");
        assert!(a.snapshot().export(&root, false).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", &media).unwrap();
            assert_eq!(a.coverage(0, 10), "file missing/corrupt");
            assert!(a.read_pcm(0, 10).is_err());
            let moved = a.dir.with_extension("retained-original");
            fs::rename(&a.dir, &moved).unwrap();
            fs::create_dir(&a.dir).unwrap();
            assert!(a.append(&[1]).is_err());
            assert_eq!(fs::read_dir(&a.dir).unwrap().count(), 0);
        }
    }
    #[test]
    fn low_disk_refuses_start_without_pruning_and_riff_overflow_is_rejected() {
        let (_t, root) = root();
        let mut c = config(2);
        c.reserve_bytes = u64::MAX;
        c.warning_bytes = u64::MAX;
        fs::write(root.join("retain-me"), b"operator archive").unwrap();
        assert!(Archive::create(&root, &uuid::Uuid::new_v4().to_string(), c).is_err());
        assert_eq!(
            fs::read(root.join("retain-me")).unwrap(),
            b"operator archive"
        );
        assert!(header(48000, 2, 48 * 3600 * 48000).is_err());
        assert_eq!(config(2).bytes_per_second(), 32000);
    }
    #[test]
    fn full_event_index_uses_u64_and_reports_missing_media_without_allocating_audio() {
        let (_t, root) = root();
        let mut a = archive(&root, 2);
        let frames = 8000u64 * 60;
        a.manifest.segments = (0..2880)
            .map(|id| Segment {
                id,
                first_frame: id as u64 * frames,
                frames,
                bytes: 44 + frames * 4,
                hash: "0".repeat(64),
                recovered: false,
            })
            .collect();
        a.manifest.frames = 8000 * 48 * 3600;
        a.manifest.status = "stopped".into();
        a.checkpoint().unwrap();
        let key = (a.manifest.log_id.clone(), a.manifest.capture_id.clone());
        drop(a);
        let a = Archive::load(&root, &key.0, &key.1).unwrap();
        assert_eq!(a.manifest.segments.len(), 2880);
        assert!(a.manifest.frames * 4 > u32::MAX as u64);
        assert_eq!(
            a.coverage(a.manifest.frames - 1, a.manifest.frames),
            "file missing/corrupt"
        );
    }
}
