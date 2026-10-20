use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_ARTIFACT_BYTES: usize = 32 * 1_024 * 1_024;
const MAX_CHUNK_BYTES: usize = 64 * 1_024;
const MAX_FILENAME_BYTES: usize = 160;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Cabrillo,
    Adif,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Cabrillo => "log",
            Self::Adif => "adi",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedCoordinate {
    #[serde(rename = "artifactID")]
    artifact_id: String,
    #[serde(rename = "sessionID")]
    session_id: String,
    workspace_generation: String,
    revision: u64,
    byte_length: usize,
    sha256: String,
    format: ExportFormat,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveStatus {
    Saved,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    status: SaveStatus,
    #[serde(rename = "artifactID")]
    artifact_id: String,
    sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl SaveResult {
    pub fn contest_action_completion(&self) -> (&'static str, Option<String>) {
        match self.status {
            SaveStatus::Saved | SaveStatus::Cancelled => ("applied", None),
            SaveStatus::Failed => ("rejected", self.message.clone()),
        }
    }
}

trait Admission {
    fn check(&self) -> Result<(), String>;
}
trait ExportWorker {
    fn request_existing(&self, request: Value) -> Result<(u64, Value), String>;
    fn request_generation(&self, generation: u64, request: Value) -> Result<Value, String>;
    fn release_best_effort(&self, generation: u64, request: Value);
}
trait SaveDialog {
    fn choose(&self, suggested: &str, format: ExportFormat) -> Result<Option<PathBuf>, String>;
}
trait Publisher {
    fn publish(
        &self,
        destination: &Path,
        bytes: &[u8],
        authorize: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<(), String>;
}

static SAVE_PENDING: AtomicBool = AtomicBool::new(false);
struct SaveLease;
impl SaveLease {
    fn acquire() -> Result<Self, String> {
        SAVE_PENDING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "A contest export save is already open.".into())
    }
}
impl Drop for SaveLease {
    fn drop(&mut self) {
        SAVE_PENDING.store(false, Ordering::Release);
    }
}

struct NativeAdmission {
    label: String,
    isolated: bool,
}
impl Admission for NativeAdmission {
    fn check(&self) -> Result<(), String> {
        let production_contesting = !crate::runtime_profile::CONTESTING_TEST
            && !self.isolated
            && crate::contest_window_context::active().is_ok();
        validate_admission(
            &self.label,
            crate::runtime_profile::CONTESTING_TEST,
            self.isolated,
            crate::APP_EXITING.load(Ordering::Acquire),
            production_contesting,
        )
    }
}

struct NativeWorker;
impl ExportWorker for NativeWorker {
    fn request_existing(&self, request: Value) -> Result<(u64, Value), String> {
        crate::worker::request_existing_with_generation(request)
    }
    fn request_generation(&self, generation: u64, request: Value) -> Result<Value, String> {
        let response = crate::worker::request_existing_generation(request, generation)?;
        crate::worker::require_existing_generation(generation)?;
        Ok(response)
    }
    fn release_best_effort(&self, generation: u64, request: Value) {
        dispatch_release(move || {
            let _ = Self.request_generation(generation, request);
        });
    }
}

fn dispatch_release(release: impl FnOnce() + Send + 'static) {
    // Cleanup cannot change a completed save's outcome. In particular, never
    // hold the save lease or its UI receipt while waiting for the shared worker.
    // A generation-pinned request cannot release an artifact in a replacement.
    let _ = std::thread::Builder::new()
        .name("contest-export-release".into())
        .spawn(release);
}

struct NativePublisher;
impl Publisher for NativePublisher {
    fn publish(
        &self,
        destination: &Path,
        bytes: &[u8],
        authorize: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        publish_noclobber(destination, bytes, authorize)
    }
}

struct NativeDialog {
    window: tauri::WebviewWindow,
}
impl SaveDialog for NativeDialog {
    fn choose(&self, suggested: &str, format: ExportFormat) -> Result<Option<PathBuf>, String> {
        choose_native(&self.window, suggested, format)
    }
}

pub async fn save(
    window: tauri::WebviewWindow,
    isolated: bool,
    prepared: PreparedCoordinate,
) -> Result<SaveResult, String> {
    let admission = NativeAdmission {
        label: window.label().to_owned(),
        isolated,
    };
    admission.check()?;
    prepared.validate()?;
    let lease = SaveLease::acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        with_save_lease(lease, || {
            save_with(
                &admission,
                &NativeWorker,
                &NativeDialog { window },
                &NativePublisher,
                prepared,
            )
        })
    })
    .await
    .map_err(|_| "Contest export save task failed.".to_string())?
}

fn with_save_lease<T>(lease: SaveLease, operation: impl FnOnce() -> T) -> T {
    let _lease = lease;
    operation()
}

fn validate_admission(
    label: &str,
    compiled_test: bool,
    isolated: bool,
    exiting: bool,
    production_contesting: bool,
) -> Result<(), String> {
    if label != "contest-setup" || exiting || !(compiled_test && isolated || production_contesting && !isolated) {
        Err("Contest export saving requires the active Contest Setup window.".into())
    } else {
        Ok(())
    }
}

fn save_with(
    admission: &dyn Admission,
    worker: &dyn ExportWorker,
    dialog: &dyn SaveDialog,
    publisher: &dyn Publisher,
    prepared: PreparedCoordinate,
) -> Result<SaveResult, String> {
    admission.check()?;
    prepared.validate()?;
    let suggested = prepared.suggested_filename();
    let (generation, bytes) = match download(worker, &prepared) {
        Ok(value) => value,
        Err(message) => return Ok(prepared.outcome(SaveStatus::Failed, None, Some(message))),
    };
    if let Err(message) = admission.check() {
        return Ok(prepared.outcome(SaveStatus::Failed, None, Some(message)));
    }
    let selected = match dialog.choose(&suggested, prepared.format) {
        Ok(value) => value,
        Err(message) => return Ok(prepared.outcome(SaveStatus::Failed, None, Some(message))),
    };
    let Some(path) = selected else {
        release_best_effort(worker, generation, &prepared);
        return Ok(prepared.outcome(SaveStatus::Cancelled, None, None));
    };
    let filename = match selected_filename(&path) {
        Ok(value) => value,
        Err(message) => return Ok(prepared.outcome(SaveStatus::Failed, None, Some(message))),
    };
    if let Err(message) = admission
        .check()
        .and_then(|_| verify_available(worker, generation, &prepared))
    {
        return Ok(prepared.outcome(SaveStatus::Failed, Some(filename), Some(message)));
    }
    let mut authorize_publish = || {
        admission
            .check()
            .and_then(|_| verify_available(worker, generation, &prepared))
            .and_then(|_| admission.check())
    };
    if let Err(message) = publisher.publish(&path, &bytes, &mut authorize_publish) {
        return Ok(prepared.outcome(SaveStatus::Failed, Some(filename), Some(message)));
    }
    release_best_effort(worker, generation, &prepared);
    Ok(prepared.outcome(SaveStatus::Saved, Some(filename), None))
}

impl PreparedCoordinate {
    fn validate(&self) -> Result<(), String> {
        if !canonical_uuid(&self.artifact_id)
            || !canonical_uuid(&self.session_id)
            || !canonical_uuid(&self.workspace_generation)
            || self.byte_length == 0
            || self.byte_length > MAX_ARTIFACT_BYTES
            || !lower_hex(&self.sha256, 64)
        {
            return Err("Prepared contest export coordinate is invalid.".into());
        }
        Ok(())
    }
    fn suggested_filename(&self) -> String {
        format!("xLog Contest.{}", self.format.extension())
    }
    fn outcome(
        &self,
        status: SaveStatus,
        filename: Option<String>,
        message: Option<String>,
    ) -> SaveResult {
        SaveResult {
            status,
            artifact_id: self.artifact_id.clone(),
            sha256: self.sha256.clone(),
            filename,
            message,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SuccessFrame<T> {
    id: String,
    ok: bool,
    result: T,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Chunk {
    #[serde(rename = "artifactID")]
    artifact_id: String,
    #[serde(rename = "sessionID")]
    session_id: String,
    workspace_generation: String,
    revision: u64,
    offset: usize,
    data_base64: String,
    eof: bool,
    byte_length: usize,
    sha256: String,
}

fn download(
    worker: &dyn ExportWorker,
    prepared: &PreparedCoordinate,
) -> Result<(u64, Vec<u8>), String> {
    let mut bytes = Vec::with_capacity(prepared.byte_length);
    let mut generation = None;
    while bytes.len() < prepared.byte_length {
        let offset = bytes.len();
        let length = MAX_CHUNK_BYTES.min(prepared.byte_length - offset);
        let id = uuid::Uuid::new_v4().to_string();
        let request = read_request(&id, prepared, offset, length);
        let response = if let Some(generation) = generation {
            worker.request_generation(generation, request)
        } else {
            let (served, response) = worker
                .request_existing(request)
                .map_err(|_| "Prepared contest export is unavailable.".to_string())?;
            generation = Some(served);
            Ok(response)
        }
        .map_err(|_| "Prepared contest export is unavailable.".to_string())?;
        let chunk = parse_chunk(response, &id, prepared, offset, length)?;
        bytes.extend_from_slice(&chunk);
    }
    if sha256_hex(&bytes) != prepared.sha256 {
        return Err("Prepared contest export digest does not match.".into());
    }
    validate_format(&bytes, prepared.format)?;
    Ok((
        generation.ok_or("Prepared contest export is empty.")?,
        bytes,
    ))
}

fn validate_format(bytes: &[u8], format: ExportFormat) -> Result<(), String> {
    let valid = match format {
        ExportFormat::Cabrillo => {
            bytes.starts_with(b"START-OF-LOG: 3.0\r\n") && bytes.ends_with(b"END-OF-LOG:\r\n")
        }
        ExportFormat::Adif => {
            bytes.starts_with(b"<ADIF_VER:5>3.1.7")
                && bytes
                    .windows(b"<EOH>\r\n".len())
                    .any(|value| value == b"<EOH>\r\n")
        }
    };
    if valid {
        Ok(())
    } else {
        Err("Prepared contest export format does not match.".into())
    }
}

fn verify_available(
    worker: &dyn ExportWorker,
    generation: u64,
    prepared: &PreparedCoordinate,
) -> Result<(), String> {
    let length = MAX_CHUNK_BYTES.min(prepared.byte_length);
    let id = uuid::Uuid::new_v4().to_string();
    let response = worker
        .request_generation(generation, read_request(&id, prepared, 0, length))
        .map_err(|_| "Prepared contest export is unavailable.".to_string())?;
    parse_chunk(response, &id, prepared, 0, length).map(|_| ())
}

fn release_best_effort(worker: &dyn ExportWorker, generation: u64, prepared: &PreparedCoordinate) {
    let id = uuid::Uuid::new_v4().to_string();
    worker.release_best_effort(
        generation,
        json!({"id": id, "method": "contest_export_release", "params": {
            "exportID": prepared.artifact_id, "sessionID": prepared.session_id,
            "workspaceGeneration": prepared.workspace_generation
        }}),
    );
}

fn read_request(id: &str, prepared: &PreparedCoordinate, offset: usize, length: usize) -> Value {
    json!({"id": id, "method": "contest_export_read", "params": {
        "exportID": prepared.artifact_id, "sessionID": prepared.session_id,
        "workspaceGeneration": prepared.workspace_generation, "offset": offset, "length": length
    }})
}

fn parse_chunk(
    response: Value,
    id: &str,
    prepared: &PreparedCoordinate,
    offset: usize,
    length: usize,
) -> Result<Vec<u8>, String> {
    let frame: SuccessFrame<Chunk> =
        serde_json::from_value(response).map_err(|_| "Prepared contest export read failed.")?;
    let expected_eof = offset + length == prepared.byte_length;
    if frame.id != id
        || !frame.ok
        || frame.result.artifact_id != prepared.artifact_id
        || frame.result.session_id != prepared.session_id
        || frame.result.workspace_generation != prepared.workspace_generation
        || frame.result.revision != prepared.revision
        || frame.result.offset != offset
        || frame.result.eof != expected_eof
        || frame.result.byte_length != prepared.byte_length
        || frame.result.sha256 != prepared.sha256
    {
        return Err("Prepared contest export chunk coordinate changed.".into());
    }
    if frame.result.data_base64.len() > 4 * length.div_ceil(3) {
        return Err("Prepared contest export chunk encoding is invalid.".into());
    }
    let decoded = decode_base64(&frame.result.data_base64)?;
    if decoded.len() != length {
        return Err("Prepared contest export chunk length is invalid.".into());
    }
    Ok(decoded)
}

fn selected_filename(path: &Path) -> Result<String, String> {
    let value = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Contest export filename is invalid.")?;
    if value.is_empty()
        || value.as_bytes().len() > MAX_FILENAME_BYTES
        || value
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
    {
        return Err("Contest export filename is invalid.".into());
    }
    Ok(value.to_owned())
}

fn publish_noclobber(
    destination: &Path,
    bytes: &[u8],
    authorize: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or("Contest export destination is invalid.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Contest export temporary file could not be created.")?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.flush())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "Contest export bytes could not be flushed.")?;
    let temporary = temporary.into_temp_path();
    authorize()?;
    temporary.persist_noclobber(destination).map_err(|_| {
        "The selected destination already exists or could not be published.".to_string()
    })?;
    Ok(())
}

fn canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|parsed| parsed.to_string() == value)
}
fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 4 != 0 {
        return Err("Prepared contest export chunk encoding is invalid.".into());
    }
    let mut output = Vec::with_capacity(value.len() / 4 * 3);
    for (index, chunk) in value.as_bytes().chunks_exact(4).enumerate() {
        let last = index + 1 == value.len() / 4;
        let a = b64(chunk[0])?;
        let b = b64(chunk[1])?;
        let c_pad = chunk[2] == b'=';
        let d_pad = chunk[3] == b'=';
        if c_pad && !d_pad || (!last && (c_pad || d_pad)) {
            return Err("Prepared contest export chunk encoding is invalid.".into());
        }
        let c = if c_pad { 0 } else { b64(chunk[2])? };
        let d = if d_pad { 0 } else { b64(chunk[3])? };
        output.push((a << 2) | (b >> 4));
        if !c_pad {
            output.push((b << 4) | (c >> 2));
        }
        if !d_pad {
            output.push((c << 6) | d);
        }
        if c_pad && b & 0x0f != 0 || d_pad && !c_pad && c & 0x03 != 0 {
            return Err("Prepared contest export chunk encoding is invalid.".into());
        }
    }
    Ok(output)
}
fn b64(value: u8) -> Result<u8, String> {
    match value {
        b'A'..=b'Z' => Ok(value - b'A'),
        b'a'..=b'z' => Ok(value - b'a' + 26),
        b'0'..=b'9' => Ok(value - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err("Prepared contest export chunk encoding is invalid.".into()),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut padded = bytes.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&(bytes.len() as u64 * 8).to_be_bytes());
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    for block in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(block[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (i, v) in [a, b, c, d, e, f, g, hh].into_iter().enumerate() {
            h[i] = h[i].wrapping_add(v);
        }
    }
    h.iter().map(|value| format!("{value:08x}")).collect()
}

#[cfg(target_os = "macos")]
fn choose_native(
    window: &tauri::WebviewWindow,
    suggested: &str,
    _format: ExportFormat,
) -> Result<Option<PathBuf>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;
    let suggested = suggested.to_owned();
    let window = window.clone();
    let queued_window = window.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let selected = validate_queued_dialog(
                queued_window.label(),
                crate::APP_EXITING.load(Ordering::Acquire),
            )
            .and_then(|_| MainThreadMarker::new().ok_or("Contest export chooser is unavailable."))
            .map(|main| {
                let panel = NSSavePanel::savePanel(main);
                panel.setNameFieldStringValue(&NSString::from_str(&suggested));
                panel.setMessage(Some(&NSString::from_str(
                    "Save the verified prepared contest export. Existing files are not replaced.",
                )));
                if panel.runModal() == NSModalResponseOK {
                    panel
                        .URL()
                        .and_then(|url| url.path())
                        .map(|path| PathBuf::from(path.to_string()))
                } else {
                    None
                }
            });
            let _ = sender.send(selected);
        })
        .map_err(|_| "Contest export chooser is unavailable.".to_string())?;
    receiver
        .recv()
        .map_err(|_| "Contest export chooser closed unexpectedly.".to_string())?
        .map_err(str::to_string)
}

fn validate_queued_dialog(label: &str, exiting: bool) -> Result<(), &'static str> {
    if label == "contest-setup" && !exiting {
        Ok(())
    } else {
        Err("Contest export chooser is unavailable.")
    }
}

#[cfg(not(target_os = "macos"))]
fn choose_native(
    _window: &tauri::WebviewWindow,
    suggested: &str,
    format: ExportFormat,
) -> Result<Option<PathBuf>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Save verified contest export")
        .set_file_name(suggested)
        .add_filter("Contest export", &[format.extension()])
        .save_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    static LEASE_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn save_outcomes_map_to_terminal_contest_action_receipts() {
        let result = |status, message| SaveResult {
            status,
            artifact_id: "018f0c8a-7b6d-7def-8123-456789abcdef".into(),
            sha256: "a".repeat(64),
            filename: None,
            message,
        };
        assert_eq!(result(SaveStatus::Saved, None).contest_action_completion(), ("applied", None));
        assert_eq!(result(SaveStatus::Cancelled, None).contest_action_completion(), ("applied", None));
        assert_eq!(result(SaveStatus::Failed, Some("disk full".into())).contest_action_completion(),
            ("rejected", Some("disk full".into())));
    }

    fn bytes() -> Vec<u8> {
        b"START-OF-LOG: 3.0\r\nEND-OF-LOG:\r\n".to_vec()
    }
    fn coordinate(data: &[u8]) -> PreparedCoordinate {
        PreparedCoordinate {
            artifact_id: "018f0c8a-7b6d-7def-8123-456789abcdef".into(),
            session_id: "00000000-0000-0000-0000-000000000001".into(),
            workspace_generation: "ffffffff-ffff-ffff-ffff-ffffffffffff".into(),
            revision: 7,
            byte_length: data.len(),
            sha256: sha256_hex(data),
            format: ExportFormat::Cabrillo,
        }
    }

    #[derive(Clone)]
    struct TestAdmission {
        checks: Arc<Mutex<usize>>,
        fail_on: Option<usize>,
    }
    impl TestAdmission {
        fn passing() -> Self {
            Self {
                checks: Arc::new(Mutex::new(0)),
                fail_on: None,
            }
        }
        fn failing_on(call: usize) -> Self {
            Self {
                checks: Arc::new(Mutex::new(0)),
                fail_on: Some(call),
            }
        }
    }
    impl Admission for TestAdmission {
        fn check(&self) -> Result<(), String> {
            let mut checks = self.checks.lock().unwrap();
            *checks += 1;
            if self.fail_on == Some(*checks) {
                Err("admission closed".into())
            } else {
                Ok(())
            }
        }
    }

    struct SwitchingAdmission(Arc<AtomicBool>);
    impl Admission for SwitchingAdmission {
        fn check(&self) -> Result<(), String> {
            if self.0.load(Ordering::Acquire) {
                Err("admission closed".into())
            } else {
                Ok(())
            }
        }
    }

    struct TestDialog {
        selected: Option<PathBuf>,
        calls: Arc<Mutex<usize>>,
    }
    impl SaveDialog for TestDialog {
        fn choose(
            &self,
            _suggested: &str,
            _format: ExportFormat,
        ) -> Result<Option<PathBuf>, String> {
            *self.calls.lock().unwrap() += 1;
            Ok(self.selected.clone())
        }
    }
    struct TestPublisher {
        calls: Arc<Mutex<Vec<(PathBuf, Vec<u8>)>>>,
        failure: bool,
    }
    impl Publisher for TestPublisher {
        fn publish(
            &self,
            path: &Path,
            bytes: &[u8],
            authorize: &mut dyn FnMut() -> Result<(), String>,
        ) -> Result<(), String> {
            authorize()?;
            self.calls
                .lock()
                .unwrap()
                .push((path.to_owned(), bytes.to_vec()));
            if self.failure {
                Err("disk failed".into())
            } else {
                Ok(())
            }
        }
    }

    struct TestWorker {
        data: Vec<u8>,
        coordinate: PreparedCoordinate,
        generation: u64,
        corrupt: bool,
        fail_pinned: bool,
        fail_pinned_on: Option<usize>,
        close_admission_on_pinned: Option<(usize, Arc<AtomicBool>)>,
        pinned_calls: Arc<Mutex<usize>>,
        fail_release: bool,
        methods: Arc<Mutex<Vec<String>>>,
    }
    impl TestWorker {
        fn new(data: Vec<u8>) -> Self {
            Self {
                coordinate: coordinate(&data),
                data,
                generation: 12,
                corrupt: false,
                fail_pinned: false,
                fail_pinned_on: None,
                close_admission_on_pinned: None,
                pinned_calls: Arc::new(Mutex::new(0)),
                fail_release: false,
                methods: Arc::new(Mutex::new(Vec::new())),
            }
        }
        fn response(&self, request: &Value) -> Result<Value, String> {
            let method = request["method"].as_str().ok_or("method")?.to_owned();
            self.methods.lock().unwrap().push(method.clone());
            if method == "contest_export_release" {
                if self.fail_release {
                    return Err("release failed".into());
                }
                return Ok(
                    json!({"id":request["id"],"ok":true,"result":{"artifactID":self.coordinate.artifact_id,"released":true}}),
                );
            }
            let offset = request["params"]["offset"].as_u64().ok_or("offset")? as usize;
            let length = request["params"]["length"].as_u64().ok_or("length")? as usize;
            let mut chunk = self.data[offset..offset + length].to_vec();
            if self.corrupt {
                chunk[0] ^= 1;
            }
            Ok(json!({"id":request["id"],"ok":true,"result":{
                "artifactID":self.coordinate.artifact_id,"sessionID":self.coordinate.session_id,
                "workspaceGeneration":self.coordinate.workspace_generation,"revision":self.coordinate.revision,
                "offset":offset,"dataBase64":encode_base64(&chunk),"eof":offset+length==self.data.len(),
                "byteLength":self.coordinate.byte_length,"sha256":self.coordinate.sha256}}))
        }
    }
    impl ExportWorker for TestWorker {
        fn release_best_effort(&self, generation: u64, request: Value) {
            let _ = self.request_generation(generation, request);
        }
        fn request_existing(&self, request: Value) -> Result<(u64, Value), String> {
            Ok((self.generation, self.response(&request)?))
        }
        fn request_generation(&self, generation: u64, request: Value) -> Result<Value, String> {
            let mut pinned_calls = self.pinned_calls.lock().unwrap();
            *pinned_calls += 1;
            if self.fail_pinned
                || self.fail_pinned_on == Some(*pinned_calls)
                || generation != self.generation
            {
                return Err("worker generation changed".into());
            }
            let pinned_call = *pinned_calls;
            drop(pinned_calls);
            let response = self.response(&request)?;
            if let Some((call, exiting)) = &self.close_admission_on_pinned {
                if *call == pinned_call {
                    exiting.store(true, Ordering::Release);
                }
            }
            Ok(response)
        }
    }

    fn run(
        worker: &TestWorker,
        admission: &TestAdmission,
        selected: Option<PathBuf>,
        publish_failure: bool,
    ) -> (
        SaveResult,
        Arc<Mutex<usize>>,
        Arc<Mutex<Vec<(PathBuf, Vec<u8>)>>>,
    ) {
        let dialog_calls = Arc::new(Mutex::new(0));
        let publish_calls = Arc::new(Mutex::new(Vec::new()));
        let result = save_with(
            admission,
            worker,
            &TestDialog {
                selected,
                calls: dialog_calls.clone(),
            },
            &TestPublisher {
                calls: publish_calls.clone(),
                failure: publish_failure,
            },
            worker.coordinate.clone(),
        )
        .unwrap();
        (result, dialog_calls, publish_calls)
    }

    #[test]
    fn admission_requires_setup_owner_profile_and_nonexiting_state() {
        assert!(validate_admission("contest-setup", true, true, false, false).is_ok());
        assert!(validate_admission("contest-setup", false, false, false, true).is_ok());
        for value in [
            ("other", true, true, false),
            ("main", true, true, false),
            ("contest-setup", false, true, false),
            ("contest-setup", true, false, false),
            ("contest-setup", true, true, true),
        ] {
            assert!(validate_admission(value.0, value.1, value.2, value.3, false).is_err());
        }
    }

    #[test]
    fn prepared_and_result_wire_contract_uses_exact_artifact_id_and_optional_filename() {
        let data = bytes();
        let value = json!({"artifactID":"018f0c8a-7b6d-7def-8123-456789abcdef",
            "sessionID":"00000000-0000-0000-0000-000000000001",
            "workspaceGeneration":"ffffffff-ffff-ffff-ffff-ffffffffffff",
            "revision":7,"byteLength":data.len(),"sha256":sha256_hex(&data),"format":"cabrillo"});
        let prepared: PreparedCoordinate = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(prepared.artifact_id, value["artifactID"]);
        let mut extra = value;
        extra["path"] = json!("/renderer/path");
        assert!(serde_json::from_value::<PreparedCoordinate>(extra).is_err());
        let cancelled =
            serde_json::to_value(prepared.outcome(SaveStatus::Cancelled, None, None)).unwrap();
        assert_eq!(cancelled["artifactID"], prepared.artifact_id);
        assert!(cancelled.get("artifactId").is_none());
        assert!(cancelled.get("filename").is_none());
    }

    #[test]
    fn failed_initial_admission_never_reaches_worker_dialog_or_publisher() {
        let worker = TestWorker::new(bytes());
        let dialog_calls = Arc::new(Mutex::new(0));
        let publish_calls = Arc::new(Mutex::new(Vec::new()));
        let result = save_with(
            &TestAdmission::failing_on(1),
            &worker,
            &TestDialog {
                selected: Some(PathBuf::from("out.log")),
                calls: dialog_calls.clone(),
            },
            &TestPublisher {
                calls: publish_calls.clone(),
                failure: false,
            },
            worker.coordinate.clone(),
        );
        assert_eq!(result.unwrap_err(), "admission closed");
        assert!(worker.methods.lock().unwrap().is_empty());
        assert_eq!(*dialog_calls.lock().unwrap(), 0);
        assert!(publish_calls.lock().unwrap().is_empty());
    }

    #[test]
    fn cancel_writes_nothing_and_releases_prepared_artifact() {
        let worker = TestWorker::new(bytes());
        let admission = TestAdmission::passing();
        let (result, dialog, writes) = run(&worker, &admission, None, false);
        assert_eq!(result.status, SaveStatus::Cancelled, "{:?}", result.message);
        assert_eq!(*dialog.lock().unwrap(), 1);
        assert!(writes.lock().unwrap().is_empty());
        assert_eq!(
            worker.methods.lock().unwrap().as_slice(),
            ["contest_export_read", "contest_export_release"]
        );
    }

    #[test]
    fn saved_result_is_truthful_and_uses_original_revision_bytes() {
        let worker = TestWorker::new(bytes());
        let path = PathBuf::from("/native/selected/entry.log");
        let (result, _, writes) = run(
            &worker,
            &TestAdmission::passing(),
            Some(path.clone()),
            false,
        );
        assert_eq!(result.status, SaveStatus::Saved, "{:?}", result.message);
        assert_eq!(result.filename.as_deref(), Some("entry.log"));
        assert_eq!(result.sha256, worker.coordinate.sha256);
        assert_eq!(writes.lock().unwrap().as_slice(), [(path, bytes())]);
        assert_eq!(
            worker.methods.lock().unwrap().as_slice(),
            [
                "contest_export_read",
                "contest_export_read",
                "contest_export_read",
                "contest_export_release"
            ]
        );
    }

    #[test]
    fn multichunk_download_is_reassembled_before_dialog_and_reverified() {
        let mut data = b"START-OF-LOG: 3.0\r\n".to_vec();
        data.extend(std::iter::repeat_n(b'Z', MAX_CHUNK_BYTES));
        data.extend_from_slice(b"\r\nEND-OF-LOG:\r\n");
        let worker = TestWorker::new(data.clone());
        let path = PathBuf::from("/native/selected/large.log");
        let (result, _, writes) = run(
            &worker,
            &TestAdmission::passing(),
            Some(path.clone()),
            false,
        );
        assert_eq!(result.status, SaveStatus::Saved, "{:?}", result.message);
        assert_eq!(writes.lock().unwrap().as_slice(), [(path, data)]);
        assert_eq!(
            worker.methods.lock().unwrap().as_slice(),
            [
                "contest_export_read",
                "contest_export_read",
                "contest_export_read",
                "contest_export_read",
                "contest_export_release"
            ]
        );
    }

    #[test]
    fn restart_or_postdialog_admission_failure_never_publishes_and_retains_artifact() {
        let mut worker = TestWorker::new(bytes());
        worker.fail_pinned = true;
        let (restart, _, writes) = run(
            &worker,
            &TestAdmission::passing(),
            Some(PathBuf::from("out.log")),
            false,
        );
        assert_eq!(restart.status, SaveStatus::Failed);
        assert!(writes.lock().unwrap().is_empty());
        assert_eq!(
            worker.methods.lock().unwrap().as_slice(),
            ["contest_export_read"]
        );

        let worker = TestWorker::new(bytes());
        let (closed, dialog, writes) = run(
            &worker,
            &TestAdmission::failing_on(2),
            Some(PathBuf::from("out.log")),
            false,
        );
        assert_eq!(closed.status, SaveStatus::Failed);
        assert_eq!(*dialog.lock().unwrap(), 0);
        assert!(writes.lock().unwrap().is_empty());
        assert_eq!(
            worker.methods.lock().unwrap().as_slice(),
            ["contest_export_read"]
        );

        let worker = TestWorker::new(bytes());
        let (closed, _, writes) = run(
            &worker,
            &TestAdmission::failing_on(3),
            Some(PathBuf::from("out.log")),
            false,
        );
        assert_eq!(closed.status, SaveStatus::Failed);
        assert!(writes.lock().unwrap().is_empty());
        assert_eq!(
            worker.methods.lock().unwrap().as_slice(),
            ["contest_export_read"]
        );
    }

    #[test]
    fn queued_dialog_shutdown_creates_no_panel_or_file() {
        struct QueuedShutdownDialog(Arc<Mutex<usize>>);
        impl SaveDialog for QueuedShutdownDialog {
            fn choose(
                &self,
                _suggested: &str,
                _format: ExportFormat,
            ) -> Result<Option<PathBuf>, String> {
                validate_queued_dialog("contest-setup", true).map_err(str::to_owned)?;
                *self.0.lock().unwrap() += 1;
                Ok(Some(PathBuf::from("out.log")))
            }
        }
        let worker = TestWorker::new(bytes());
        let panels = Arc::new(Mutex::new(0));
        let writes = Arc::new(Mutex::new(Vec::new()));
        let result = save_with(
            &TestAdmission::passing(),
            &worker,
            &QueuedShutdownDialog(panels.clone()),
            &TestPublisher {
                calls: writes.clone(),
                failure: false,
            },
            worker.coordinate.clone(),
        )
        .unwrap();
        assert_eq!(result.status, SaveStatus::Failed);
        assert_eq!(*panels.lock().unwrap(), 0);
        assert!(writes.lock().unwrap().is_empty());
    }

    #[test]
    fn shutdown_or_restart_after_temp_flush_cleans_owned_temp_and_does_not_publish() {
        let shutdown_directory = tempfile::tempdir().unwrap();
        let shutdown_destination = shutdown_directory.path().join("shutdown.log");
        let shutdown_worker = TestWorker::new(bytes());
        let shutdown = save_with(
            &TestAdmission::failing_on(4),
            &shutdown_worker,
            &TestDialog {
                selected: Some(shutdown_destination.clone()),
                calls: Arc::new(Mutex::new(0)),
            },
            &NativePublisher,
            shutdown_worker.coordinate.clone(),
        )
        .unwrap();
        assert_eq!(shutdown.status, SaveStatus::Failed);
        assert!(!shutdown_destination.exists());
        assert_eq!(
            std::fs::read_dir(shutdown_directory.path())
                .unwrap()
                .count(),
            0
        );

        let restart_directory = tempfile::tempdir().unwrap();
        let restart_destination = restart_directory.path().join("restart.log");
        let mut restart_worker = TestWorker::new(bytes());
        restart_worker.fail_pinned_on = Some(2);
        let restart = save_with(
            &TestAdmission::passing(),
            &restart_worker,
            &TestDialog {
                selected: Some(restart_destination.clone()),
                calls: Arc::new(Mutex::new(0)),
            },
            &NativePublisher,
            restart_worker.coordinate.clone(),
        )
        .unwrap();
        assert_eq!(restart.status, SaveStatus::Failed);
        assert!(!restart_destination.exists());
        assert_eq!(
            std::fs::read_dir(restart_directory.path()).unwrap().count(),
            0
        );

        let response_shutdown_directory = tempfile::tempdir().unwrap();
        let response_shutdown_destination = response_shutdown_directory
            .path()
            .join("response-shutdown.log");
        let exiting = Arc::new(AtomicBool::new(false));
        let mut response_shutdown_worker = TestWorker::new(bytes());
        response_shutdown_worker.close_admission_on_pinned = Some((2, exiting.clone()));
        let response_shutdown = save_with(
            &SwitchingAdmission(exiting),
            &response_shutdown_worker,
            &TestDialog {
                selected: Some(response_shutdown_destination.clone()),
                calls: Arc::new(Mutex::new(0)),
            },
            &NativePublisher,
            response_shutdown_worker.coordinate.clone(),
        )
        .unwrap();
        assert_eq!(response_shutdown.status, SaveStatus::Failed);
        assert!(!response_shutdown_destination.exists());
        assert_eq!(
            std::fs::read_dir(response_shutdown_directory.path())
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn published_save_completes_while_worker_release_is_blocked() {
        #[derive(Clone)]
        struct BlockedReleaseWorker {
            inner: Arc<TestWorker>,
            started: std::sync::mpsc::Sender<()>,
            resume: Arc<Mutex<std::sync::mpsc::Receiver<()>>>,
        }
        impl ExportWorker for BlockedReleaseWorker {
            fn request_existing(&self, request: Value) -> Result<(u64, Value), String> {
                self.inner.request_existing(request)
            }
            fn request_generation(&self, generation: u64, request: Value) -> Result<Value, String> {
                if request["method"] == "contest_export_release" {
                    self.started.send(()).unwrap();
                    self.resume.lock().unwrap().recv().unwrap();
                }
                self.inner.request_generation(generation, request)
            }
            fn release_best_effort(&self, generation: u64, request: Value) {
                let worker = self.clone();
                dispatch_release(move || {
                    let _ = worker.request_generation(generation, request);
                });
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("saved.log");
        let path = destination.clone();
        let (started, release_started) = std::sync::mpsc::channel();
        let (resume, release_resume) = std::sync::mpsc::channel();
        let worker = BlockedReleaseWorker {
            inner: Arc::new(TestWorker::new(bytes())),
            started,
            resume: Arc::new(Mutex::new(release_resume)),
        };
        let (complete, completed) = std::sync::mpsc::channel();
        let save = std::thread::spawn(move || {
            let result = save_with(
                &TestAdmission::passing(),
                &worker,
                &TestDialog {
                    selected: Some(path),
                    calls: Arc::new(Mutex::new(0)),
                },
                &NativePublisher,
                worker.inner.coordinate.clone(),
            );
            complete.send(result).unwrap();
        });
        let started = release_started.recv_timeout(std::time::Duration::from_secs(2));
        let result = completed.recv_timeout(std::time::Duration::from_secs(1));
        // Always unblock cleanup before asserting so a regression leaves no
        // stranded worker thread in the test process.
        resume.send(()).unwrap();
        save.join().unwrap();
        started.unwrap();
        assert_eq!(result.unwrap().unwrap().status, SaveStatus::Saved);
        assert_eq!(std::fs::read(destination).unwrap(), bytes());
    }

    #[test]
    fn postpublication_release_failure_does_not_downgrade_saved_result() {
        let mut worker = TestWorker::new(bytes());
        worker.fail_release = true;
        let (result, _, writes) = run(
            &worker,
            &TestAdmission::passing(),
            Some(PathBuf::from("out.log")),
            false,
        );
        assert_eq!(result.status, SaveStatus::Saved, "{:?}", result.message);
        assert_eq!(writes.lock().unwrap().len(), 1);
        assert_eq!(
            worker.methods.lock().unwrap().as_slice(),
            [
                "contest_export_read",
                "contest_export_read",
                "contest_export_read",
                "contest_export_release"
            ]
        );
    }

    #[test]
    fn corrupt_or_oversized_artifact_fails_before_dialog_or_publish() {
        let mut worker = TestWorker::new(bytes());
        worker.corrupt = true;
        let (corrupt, dialog, writes) = run(
            &worker,
            &TestAdmission::passing(),
            Some(PathBuf::from("out.log")),
            false,
        );
        assert_eq!(corrupt.status, SaveStatus::Failed);
        assert_eq!(*dialog.lock().unwrap(), 0);
        assert!(writes.lock().unwrap().is_empty());
        let mut invalid = worker.coordinate.clone();
        invalid.byte_length = MAX_ARTIFACT_BYTES + 1;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn declared_format_must_match_downloaded_artifact_before_dialog() {
        let mut worker = TestWorker::new(bytes());
        worker.coordinate.format = ExportFormat::Adif;
        let (result, dialog, writes) = run(
            &worker,
            &TestAdmission::passing(),
            Some(PathBuf::from("out.adi")),
            false,
        );
        assert_eq!(result.status, SaveStatus::Failed);
        assert_eq!(
            result.message.as_deref(),
            Some("Prepared contest export format does not match.")
        );
        assert_eq!(*dialog.lock().unwrap(), 0);
        assert!(writes.lock().unwrap().is_empty());
    }

    #[test]
    fn disk_failure_is_reported_and_retains_artifact() {
        let worker = TestWorker::new(bytes());
        let (result, _, writes) = run(
            &worker,
            &TestAdmission::passing(),
            Some(PathBuf::from("out.log")),
            true,
        );
        assert_eq!(result.status, SaveStatus::Failed, "{:?}", result.message);
        assert_eq!(writes.lock().unwrap().len(), 1);
        assert!(!worker
            .methods
            .lock()
            .unwrap()
            .contains(&"contest_export_release".to_string()));
    }

    #[test]
    fn exclusive_publication_preserves_existing_destination_and_cleans_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("entry.log");
        std::fs::write(&destination, b"existing").unwrap();
        let mut authorize = || Ok(());
        assert!(publish_noclobber(&destination, &bytes(), &mut authorize).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"existing");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        let fresh = directory.path().join("fresh.log");
        publish_noclobber(&fresh, &bytes(), &mut authorize).unwrap();
        assert_eq!(std::fs::read(&fresh).unwrap(), bytes());
    }

    #[test]
    fn native_save_lease_is_exclusive() {
        let _test_lock = LEASE_TEST_LOCK.lock().unwrap();
        let first = SaveLease::acquire().unwrap();
        assert!(SaveLease::acquire().is_err());
        drop(first);
        assert!(SaveLease::acquire().is_ok());
    }

    #[test]
    fn aborting_async_waiter_does_not_release_running_blocking_save_lease() {
        let _test_lock = LEASE_TEST_LOCK.lock().unwrap();
        let (started_sender, started_receiver) = std::sync::mpsc::sync_channel(1);
        let (finish_sender, finish_receiver) = std::sync::mpsc::sync_channel(1);
        let lease = SaveLease::acquire().unwrap();
        let task = tauri::async_runtime::spawn_blocking(move || {
            with_save_lease(lease, || {
                started_sender.send(()).unwrap();
                finish_receiver.recv().unwrap();
            });
        });
        started_receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        task.abort();
        assert!(SaveLease::acquire().is_err());
        finish_sender.send(()).unwrap();
        tauri::async_runtime::block_on(task).unwrap();
        assert!(SaveLease::acquire().is_ok());
    }

    #[test]
    fn queued_blocking_save_reserves_lease_before_operation_starts() {
        let _test_lock = LEASE_TEST_LOCK.lock().unwrap();
        let (start_sender, start_receiver) = std::sync::mpsc::sync_channel(1);
        let lease = SaveLease::acquire().unwrap();
        let task = tauri::async_runtime::spawn_blocking(move || {
            start_receiver.recv().unwrap();
            with_save_lease(lease, || ());
        });
        assert!(SaveLease::acquire().is_err());
        start_sender.send(()).unwrap();
        tauri::async_runtime::block_on(task).unwrap();
        assert!(SaveLease::acquire().is_ok());
    }

    #[test]
    fn sha256_and_base64_are_strict() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(decode_base64("YWJj").unwrap(), b"abc");
        for invalid in ["YQ=A", "YQ==AAAA", "Y===", "YQ=/"] {
            assert!(decode_base64(invalid).is_err(), "{invalid}");
        }
    }

    fn encode_base64(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let a = chunk[0];
            let b = *chunk.get(1).unwrap_or(&0);
            let c = *chunk.get(2).unwrap_or(&0);
            out.push(TABLE[(a >> 2) as usize] as char);
            out.push(TABLE[(((a & 3) << 4) | (b >> 4)) as usize] as char);
            out.push(if chunk.len() > 1 {
                TABLE[(((b & 15) << 2) | (c >> 6)) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                TABLE[(c & 63) as usize] as char
            } else {
                '='
            });
        }
        out
    }
}
