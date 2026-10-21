//! Bounded Not1MM-compatible WAV profile loading for contest phone output.
//! Audio is decoded by the in-process webview; this module admits only canonical
//! PCM WAV files beneath the operator-selected profile directory.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

const MAX_PAYLOAD_BYTES: usize = 4_096;
const MAX_PROFILE_PATH_BYTES: usize = 2_048;
const MAX_SEGMENTS: usize = 128;
const MAX_WAV_BYTES: usize = 8 * 1_024 * 1_024;
const MAX_BATCH_SEGMENTS: usize = 256;
const MAX_BATCH_WAV_BYTES: usize = 32 * 1_024 * 1_024;
const MAX_BATCH_BASE64_BYTES: usize = 44 * 1_024 * 1_024;
const MAX_SEGMENT_DURATION_MS: u64 = 60_000;
const MAX_TOTAL_DURATION_MS: u64 = 120_000;
const PTT_CONFIRM_TIMEOUT: Duration = Duration::from_secs(8);
const PTT_CONFIRM_POLL: Duration = Duration::from_millis(100);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareRequest {
    schema_version: u8,
    session_id: String,
    workspace_generation: String,
    draft_id: String,
    action_id: String,
    payload: String,
    payload_sha256: String,
    profile_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareBatchRequest {
    requests: Vec<PrepareRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSegment {
    name: String,
    wav_base64: String,
    duration_ms: u64,
    sha256: String,
    decoded_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedVoice {
    session_id: String,
    workspace_generation: String,
    draft_id: String,
    action_id: String,
    payload_sha256: String,
    manifest_sha256: String,
    segments: Vec<PreparedSegment>,
    total_duration_ms: u64,
    total_decoded_bytes: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceAdmission {
    session_id: String,
    workspace_generation: String,
    draft_id: String,
    action_id: String,
    payload_sha256: String,
    manifest_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PTTRequest {
    action: String,
    #[serde(default)]
    admissions: Vec<VoiceAdmission>,
}

impl PTTRequest {
    pub fn acquiring(&self) -> bool {
        self.action == "acquire"
    }

    pub fn execute(self, app: &tauri::AppHandle) -> Result<Value, String> {
        match self.action.as_str() {
            "acquire" => acquire_ptt(app, self.admissions),
            "release" if self.admissions.is_empty() => release_ptt(app),
            _ => Err("Invalid contest voice PTT request.".into()),
        }
    }
}

#[derive(Default)]
struct VoiceRuntime {
    shutting_down: bool,
    active_ptt: bool,
    pending_acquisitions: usize,
    prepared: HashMap<AdmissionKey, VoiceAdmission>,
    consumed: VecDeque<AdmissionKey>,
}

type AdmissionKey = (String, String, String);

fn admission_key(admission: &VoiceAdmission) -> AdmissionKey {
    (admission.session_id.clone(), admission.workspace_generation.clone(), admission.action_id.clone())
}

fn request_key(request: &PrepareRequest) -> AdmissionKey {
    (request.session_id.clone(), request.workspace_generation.clone(), request.action_id.clone())
}

fn ensure_action_keys_available(state: &VoiceRuntime, keys: &[AdmissionKey]) -> Result<(), String> {
    if keys
        .iter()
        .any(|key| state.prepared.contains_key(key) || state.consumed.contains(key))
    {
        return Err(
            "The contest voice action is already prepared or consumed; replay denied.".into(),
        );
    }
    Ok(())
}

pub struct QueuedAcquisition;

impl Drop for QueuedAcquisition {
    fn drop(&mut self) {
        if let Ok(mut state) = runtime().lock() {
            state.pending_acquisitions = state.pending_acquisitions.saturating_sub(1);
        }
    }
}

pub fn queue_acquisition() -> Result<QueuedAcquisition, String> {
    let mut state = runtime().lock().map_err(|_| "Contest voice runtime unavailable")?;
    if state.shutting_down {
        return Err("Contest voice output is shutting down.".into());
    }
    state.pending_acquisitions = state.pending_acquisitions.checked_add(1)
        .ok_or("Contest voice acquisition count overflow")?;
    Ok(QueuedAcquisition)
}

static VOICE_RUNTIME: OnceLock<Mutex<VoiceRuntime>> = OnceLock::new();
static VOICE_LANE: OnceLock<Mutex<()>> = OnceLock::new();
static WINDOW_CLOSE_BARRIER: AtomicBool = AtomicBool::new(false);

fn runtime() -> &'static Mutex<VoiceRuntime> {
    VOICE_RUNTIME.get_or_init(|| Mutex::new(VoiceRuntime::default()))
}

fn lane() -> &'static Mutex<()> {
    VOICE_LANE.get_or_init(|| Mutex::new(()))
}

pub fn validate_invoker(
    label: &str,
    isolated: bool,
    exiting: bool,
    contesting_test: bool,
) -> Result<(), String> {
    if contesting_test {
        return Err(
            "Contest phone audio and PTT are disabled in the Contesting Test profile.".into(),
        );
    }
    if isolated || exiting || label != "main" {
        return Err(
            "Contest phone output is available only from the active production contest owner."
                .into(),
        );
    }
    Ok(())
}

pub fn prepare(
    request: PrepareRequest,
    active_session: &str,
    active_workspace: &str,
) -> Result<PreparedVoice, String> {
    prepare_one(request, active_session, active_workspace, &mut BatchBudget::default())
}

#[derive(Default)]
struct BatchBudget {
    segments: usize,
    decoded_bytes: usize,
    base64_bytes: usize,
    duration_ms: u64,
}

pub fn prepare_batch(
    request: PrepareBatchRequest,
    active_session: &str,
    active_workspace: &str,
) -> Result<Vec<PreparedVoice>, String> {
    if request.requests.is_empty() || request.requests.len() > 12 {
        return Err("Invalid contest voice action batch.".into());
    }
    let mut action_ids = HashSet::new();
    let mut keys = Vec::with_capacity(request.requests.len());
    for item in &request.requests {
        validate_request(item, active_session, active_workspace)?;
        let key = request_key(item);
        if !action_ids.insert(key.clone()) {
            return Err("Duplicate contest voice action identity.".into());
        }
        keys.push(key);
    }
    {
        let state = runtime().lock().map_err(|_| "Contest voice runtime unavailable")?;
        if state.shutting_down {
            return Err("Contest voice output is shutting down.".into());
        }
        ensure_action_keys_available(&state, &keys)?;
    }
    let mut prepared = Vec::with_capacity(request.requests.len());
    let mut budget = BatchBudget::default();
    for item in request.requests {
        prepared.push(prepare_one(item, active_session, active_workspace, &mut budget)?);
    }
    let mut state = runtime()
        .lock()
        .map_err(|_| "Contest voice runtime unavailable")?;
    if state.shutting_down {
        return Err("Contest voice output is shutting down.".into());
    }
    for value in &prepared {
        let admission = VoiceAdmission {
            session_id: value.session_id.clone(),
            workspace_generation: value.workspace_generation.clone(),
            draft_id: value.draft_id.clone(),
            action_id: value.action_id.clone(),
            payload_sha256: value.payload_sha256.clone(),
            manifest_sha256: value.manifest_sha256.clone(),
        };
        let key = admission_key(&admission);
        if state.prepared.contains_key(&key) || state.consumed.contains(&key) {
            return Err("The contest voice action was concurrently prepared or consumed; replay denied.".into());
        }
        state.prepared.insert(key, admission);
    }
    if state.prepared.len() > 256 {
        state.prepared.clear();
        return Err("Contest voice preparation journal is full; prepare the message again.".into());
    }
    Ok(prepared)
}

fn prepare_one(
    request: PrepareRequest,
    active_session: &str,
    active_workspace: &str,
    budget: &mut BatchBudget,
) -> Result<PreparedVoice, String> {
    validate_request(&request, active_session, active_workspace)?;
    let profile = canonical_profile(&request.profile_path)?;
    let names = wav_names(&request.payload)?;
    let mut total_duration_ms = 0_u64;
    let mut total_decoded_bytes = 0_usize;
    let mut segments = Vec::with_capacity(names.len());
    for name in names {
        let path = admitted_wav_path(&profile, &name)?;
        let decoded_bytes = usize::try_from(path.metadata()
            .map_err(|_| format!("Voice WAV {name}.wav metadata is unavailable."))?.len())
            .map_err(|_| format!("Voice WAV {name}.wav size is invalid."))?;
        if decoded_bytes > MAX_WAV_BYTES {
            return Err(format!("Voice WAV {name}.wav exceeds the 8 MiB safety limit."));
        }
        let encoded_bytes = decoded_bytes.checked_add(2).ok_or("Voice WAV encoding size overflow")?
            .checked_div(3).and_then(|value| value.checked_mul(4)).ok_or("Voice WAV encoding size overflow")?;
        let next_segments = budget.segments.checked_add(1).ok_or("Voice WAV segment count overflow")?;
        let next_decoded = budget.decoded_bytes.checked_add(decoded_bytes).ok_or("Voice WAV byte count overflow")?;
        let next_base64 = budget.base64_bytes.checked_add(encoded_bytes).ok_or("Voice WAV encoding size overflow")?;
        if next_segments > MAX_BATCH_SEGMENTS || next_decoded > MAX_BATCH_WAV_BYTES || next_base64 > MAX_BATCH_BASE64_BYTES {
            return Err("The contest voice batch exceeds its aggregate segment or byte safety limit before audio is read.".into());
        }
        budget.segments = next_segments; budget.decoded_bytes = next_decoded; budget.base64_bytes = next_base64;
        let bytes =
            fs::read(&path).map_err(|_| format!("Voice WAV {name}.wav could not be read."))?;
        if bytes.len() != decoded_bytes {
            return Err(format!("Voice WAV {name}.wav changed while it was being prepared."));
        }
        let duration_ms = pcm_wav_duration_ms(&bytes)?;
        if duration_ms > MAX_SEGMENT_DURATION_MS {
            return Err(format!(
                "Voice WAV {name}.wav exceeds the 60 second safety limit."
            ));
        }
        total_duration_ms = total_duration_ms
            .checked_add(duration_ms)
            .ok_or("Voice WAV duration overflow")?;
        if total_duration_ms > MAX_TOTAL_DURATION_MS {
            return Err("The resolved voice message exceeds the two minute safety limit.".into());
        }
        budget.duration_ms = budget.duration_ms.checked_add(duration_ms).ok_or("Voice WAV duration overflow")?;
        if budget.duration_ms > MAX_TOTAL_DURATION_MS {
            return Err("The contest voice batch exceeds its aggregate duration safety limit.".into());
        }
        total_decoded_bytes = total_decoded_bytes
            .checked_add(decoded_bytes)
            .ok_or("Voice WAV byte count overflow")?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        segments.push(PreparedSegment {
            name,
            wav_base64: STANDARD.encode(bytes),
            duration_ms,
            sha256,
            decoded_bytes,
        });
    }
    let manifest_sha256 = manifest_sha256(&segments);
    Ok(PreparedVoice {
        session_id: request.session_id,
        workspace_generation: request.workspace_generation,
        draft_id: request.draft_id,
        action_id: request.action_id,
        payload_sha256: request.payload_sha256,
        manifest_sha256,
        segments,
        total_duration_ms,
        total_decoded_bytes,
    })
}

fn manifest_sha256(segments: &[PreparedSegment]) -> String {
    let mut digest = Sha256::new();
    digest.update((segments.len() as u32).to_le_bytes());
    for segment in segments {
        digest.update((segment.name.len() as u32).to_le_bytes());
        digest.update(segment.name.as_bytes());
        digest.update((segment.decoded_bytes as u64).to_le_bytes());
        digest.update(segment.duration_ms.to_le_bytes());
        digest.update(segment.sha256.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn validate_request(
    request: &PrepareRequest,
    active_session: &str,
    active_workspace: &str,
) -> Result<(), String> {
    if request.schema_version != 1
        || uuid::Uuid::parse_str(&request.session_id).is_err()
        || uuid::Uuid::parse_str(&request.workspace_generation).is_err()
        || uuid::Uuid::parse_str(&request.draft_id).is_err()
        || request.session_id != active_session
        || request.workspace_generation != active_workspace
    {
        return Err(
            "The contest voice request belongs to a stale or invalid contest context.".into(),
        );
    }
    let (operation, index) = request
        .action_id
        .rsplit_once(':')
        .ok_or("Invalid contest voice action identity")?;
    if uuid::Uuid::parse_str(operation).is_err()
        || index.parse::<usize>().ok().is_none_or(|value| value >= 12)
    {
        return Err("Invalid contest voice action identity".into());
    }
    if request.payload.as_bytes().len() > MAX_PAYLOAD_BYTES
        || request.payload_sha256.len() != 64
        || !request
            .payload_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("Invalid contest voice payload".into());
    }
    let actual = format!("{:x}", Sha256::digest(request.payload.as_bytes()));
    if actual != request.payload_sha256 {
        return Err("The contest voice payload digest does not match the claimed output.".into());
    }
    Ok(())
}

fn canonical_profile(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.as_bytes().len() > MAX_PROFILE_PATH_BYTES {
        return Err("Choose a bounded voice WAV profile folder in Contest Sound settings.".into());
    }
    let path = fs::canonicalize(value)
        .map_err(|_| "The voice WAV profile folder is unavailable.".to_string())?;
    if !path.is_dir() {
        return Err("The selected voice WAV profile is not a folder.".into());
    }
    Ok(path)
}

fn admitted_wav_path(profile: &Path, name: &str) -> Result<PathBuf, String> {
    let candidate = profile.join(format!("{name}.wav"));
    let canonical = fs::canonicalize(&candidate)
        .map_err(|_| format!("Voice WAV {name}.wav is missing from the selected profile."))?;
    if canonical.parent() != Some(profile) || !canonical.is_file() {
        return Err(format!(
            "Voice WAV {name}.wav escapes the selected profile."
        ));
    }
    Ok(canonical)
}

fn wav_names(payload: &str) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let lowercase = payload.to_lowercase();
    let mut chars = lowercase.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '[' {
            let mut name = String::new();
            loop {
                match chars.next() {
                    Some(']') => break,
                    Some(value) if value.is_ascii_lowercase() || value.is_ascii_digit() || matches!(value, '_' | '-') => {
                        name.push(value);
                        if name.len() > 64 { return Err("A bracketed voice WAV name is too long.".into()); }
                    }
                    _ => return Err("Bracketed voice WAV names may contain only lowercase letters, digits, dash and underscore.".into()),
                }
            }
            if name.is_empty() {
                return Err("A bracketed voice WAV name cannot be empty.".into());
            }
            names.push(name);
        } else if character.is_ascii_lowercase() || character.is_ascii_digit() {
            names.push(character.to_string());
        } else if character == ' ' {
            names.push("space".into());
        } else if character == '/' {
            names.push("slash".into());
        } else {
            return Err(format!(
                "Unsupported voice message character U+{:04X}; use a bracketed WAV name instead.",
                character as u32
            ));
        }
        if names.len() > MAX_SEGMENTS {
            return Err("The resolved voice message has too many WAV segments.".into());
        }
    }
    if names.is_empty() {
        return Err("The voice message did not resolve to any recorded WAV segments.".into());
    }
    Ok(names)
}

fn validate_prepared_admissions(
    state: &mut VoiceRuntime,
    admissions: &[VoiceAdmission],
) -> Result<(), String> {
    if admissions.is_empty() || admissions.len() > 12 {
        return Err("Invalid contest voice admission batch.".into());
    }
    let mut seen = HashSet::new();
    for admission in admissions {
        let key = admission_key(admission);
        if !seen.insert(key.clone())
            || state.consumed.contains(&key)
            || state.prepared.get(&key) != Some(admission)
        {
            return Err(
                "The contest voice manifest is stale, replayed, or does not match native preparation."
                    .into(),
            );
        }
    }
    for admission in admissions {
        let key = admission_key(admission);
        state.prepared.remove(&key);
        state.consumed.push_back(key);
        while state.consumed.len() > 256 {
            state.consumed.pop_front();
        }
    }
    Ok(())
}

fn ptt_receipt_status(app: &tauri::AppHandle, operation_id: &str) -> Result<String, String> {
    let owner = crate::ptt_session::owner(app)?;
    owner.reconcile(&crate::station_telemetry::owner(app)?.snapshot()?)?;
    owner.receipt(operation_id)?["status"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "Contest voice PTT receipt is unavailable.".into())
}

fn wait_for_ptt_confirmation(
    app: &tauri::AppHandle,
    operation_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let deadline = Instant::now() + PTT_CONFIRM_TIMEOUT;
    loop {
        match ptt_receipt_status(app, operation_id)?.as_str() {
            "confirmed" => return Ok(()),
            "pending" | "unknown" | "acknowledged" | "reviewed" => {}
            status => {
                return Err(format!(
                    "Contest voice PTT {} ended with non-confirming status {status}.",
                    if enabled { "on" } else { "off" }
                ))
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Contest voice PTT {} lacks fresh authoritative {} confirmation after {} seconds.",
                if enabled { "on" } else { "off" },
                if enabled { "TX" } else { "RX" },
                PTT_CONFIRM_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(PTT_CONFIRM_POLL);
    }
}

fn ptt_release_required(app: &tauri::AppHandle) -> Result<bool, String> {
    let owner = crate::ptt_session::owner(app)?;
    owner.reconcile(&crate::station_telemetry::owner(app)?.snapshot()?)?;
    Ok(!owner.snapshot()?["release_required"].is_null())
}

fn apply_ptt(app: &tauri::AppHandle, enabled: bool) -> Result<String, String> {
    let owner = crate::ptt_session::owner(app)?;
    owner.reconcile(&crate::station_telemetry::owner(app)?.snapshot()?)?;
    let snapshot = owner.snapshot()?;
    if enabled && !snapshot["release_required"].is_null() {
        return Err("Resolve the retained GUI PTT release before contest phone output.".into());
    }
    if !enabled && snapshot["release_required"].is_null() {
        return Err("No retained contest voice PTT owner is available to release.".into());
    }
    if !enabled {
        crate::carrier_tune::revoke_output_intent()?;
    }
    let target = serde_json::from_value::<crate::ptt_session::Target>(
        crate::ptt_session::context(app)?["target"].clone(),
    )
    .map_err(|_| "Exact native contest voice PTT target is unavailable")?;
    let intent = crate::carrier_tune::output_intent()?;
    let operation_id = uuid::Uuid::new_v4().to_string();
    owner.apply_admitted(
        &operation_id,
        enabled,
        target.clone(),
        &intent,
        |candidate| crate::ptt_session::preflight(app, candidate, enabled, &intent),
        |request, candidate| crate::ptt_session::execute(app, request, candidate, &intent),
    )?;
    Ok(operation_id)
}

fn release_locked(app: &tauri::AppHandle) -> Result<(), String> {
    if !ptt_release_required(app)? {
        runtime()
            .lock()
            .map_err(|_| "Contest voice runtime unavailable")?
            .active_ptt = false;
        return Ok(());
    }
    let operation_id = apply_ptt(app, false)?;
    let result = wait_for_ptt_confirmation(app, &operation_id, false);
    let still_required = ptt_release_required(app).unwrap_or(true);
    runtime()
        .lock()
        .map_err(|_| "Contest voice runtime unavailable")?
        .active_ptt = still_required;
    result
}

pub fn acquire_ptt(
    app: &tauri::AppHandle,
    admissions: Vec<VoiceAdmission>,
) -> Result<Value, String> {
    let _lane = lane()
        .lock()
        .map_err(|_| "Contest voice PTT lane unavailable")?;
    let context = crate::contest_window_context::active()?;
    if admissions.iter().any(|item| {
        item.session_id != context.session_id
            || item.workspace_generation != context.workspace_generation
    }) {
        return Err("The contest voice PTT admission belongs to a stale contest context.".into());
    }
    {
        let mut state = runtime()
            .lock()
            .map_err(|_| "Contest voice runtime unavailable")?;
        if state.shutting_down {
            return Err("Contest voice output is shutting down.".into());
        }
        if state.active_ptt {
            return Err("Contest voice PTT is already active.".into());
        }
        validate_prepared_admissions(&mut state, &admissions)?;
    }
    let operation_id = match apply_ptt(app, true) {
        Ok(id) => id,
        Err(error) => {
            let retained = ptt_release_required(app).unwrap_or(true);
            runtime()
                .lock()
                .map_err(|_| "Contest voice runtime unavailable")?
                .active_ptt = retained;
            if retained {
                let _ = release_locked(app);
            }
            return Err(error);
        }
    };
    runtime()
        .lock()
        .map_err(|_| "Contest voice runtime unavailable")?
        .active_ptt = true;
    if let Err(error) = wait_for_ptt_confirmation(app, &operation_id, true) {
        let release = release_locked(app);
        return Err(match release {
            Ok(()) => error,
            Err(release_error) => {
                format!("{error} PTT release also remains uncertain: {release_error}")
            }
        });
    }
    Ok(json!({"accepted":true,"confirmed":true,"operationID":operation_id}))
}

pub fn release_ptt(app: &tauri::AppHandle) -> Result<Value, String> {
    let _lane = lane()
        .lock()
        .map_err(|_| "Contest voice PTT lane unavailable")?;
    release_locked(app)?;
    Ok(json!({"accepted":true,"confirmed":true}))
}

fn shutdown_barrier(
    operation_lane: &Mutex<()>,
    state_lock: &Mutex<VoiceRuntime>,
    release: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let _lane = operation_lane
        .lock()
        .map_err(|_| "Contest voice PTT lane unavailable")?;
    let active = {
        let mut state = state_lock
            .lock()
            .map_err(|_| "Contest voice runtime unavailable")?;
        state.shutting_down = true;
        state.prepared.clear();
        state.active_ptt
    };
    if active {
        release()
    } else {
        Ok(())
    }
}

pub fn shutdown(app: &tauri::AppHandle) -> Result<(), String> {
    shutdown_barrier(lane(), runtime(), || release_locked(app))
}

pub fn needs_shutdown_barrier() -> bool {
    if WINDOW_CLOSE_BARRIER.load(Ordering::Acquire) {
        return true;
    }
    let active = runtime()
        .lock()
        .map(|state| state.active_ptt || state.pending_acquisitions > 0)
        .unwrap_or(true);
    active || lane().try_lock().is_err()
}

pub fn begin_window_close_barrier() -> bool {
    !WINDOW_CLOSE_BARRIER.swap(true, Ordering::AcqRel)
}

fn pcm_wav_duration_ms(bytes: &[u8]) -> Result<u64, String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Voice profile files must be RIFF/WAVE audio.".into());
    }
    let mut offset = 12_usize;
    let mut format: Option<(u16, u16, u32, u32, u16)> = None;
    let mut data_bytes: Option<u32> = None;
    while offset.checked_add(8).is_some_and(|end| end <= bytes.len()) {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start.checked_add(size).ok_or("Invalid WAV chunk size")?;
        if end > bytes.len() {
            return Err("Voice WAV contains a truncated chunk.".into());
        }
        if id == b"fmt " {
            if size < 16 {
                return Err("Voice WAV has an invalid format chunk.".into());
            }
            format = Some((
                u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap()),
                u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()),
                u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap()),
                u32::from_le_bytes(bytes[start + 8..start + 12].try_into().unwrap()),
                u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()),
            ));
        } else if id == b"data" {
            data_bytes = Some(size as u32);
        }
        offset = end + (size & 1);
    }
    let (encoding, channels, sample_rate, byte_rate, bits) =
        format.ok_or("Voice WAV is missing its format chunk.")?;
    let data_bytes = data_bytes
        .filter(|value| *value > 0)
        .ok_or("Voice WAV has no audio data.")?;
    let expected_rate = u64::from(sample_rate) * u64::from(channels) * u64::from(bits) / 8;
    if encoding != 1
        || !(1..=2).contains(&channels)
        || !(8_000..=192_000).contains(&sample_rate)
        || !matches!(bits, 8 | 16 | 24 | 32)
        || byte_rate == 0
        || u64::from(byte_rate) != expected_rate
    {
        return Err(
            "Voice WAV must be mono/stereo PCM at 8–192 kHz with a valid byte rate.".into(),
        );
    }
    Ok((u64::from(data_bytes) * 1_000).div_ceil(u64::from(byte_rate)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SESSION: &str = "10000000-0000-4000-8000-000000000001";
    const WORKSPACE: &str = "20000000-0000-4000-8000-000000000002";
    const DRAFT: &str = "30000000-0000-4000-8000-000000000003";
    const OPERATION: &str = "40000000-0000-4000-8000-000000000004";

    fn wav(milliseconds: u32) -> Vec<u8> {
        let byte_rate = 8_000_u32 * 2;
        let data_len = byte_rate * milliseconds / 1_000;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8_000_u32.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        bytes.resize(bytes.len() + data_len as usize, 0);
        bytes
    }

    fn request(profile: &Path, payload: &str) -> PrepareRequest {
        PrepareRequest {
            schema_version: 1,
            session_id: SESSION.into(),
            workspace_generation: WORKSPACE.into(),
            draft_id: DRAFT.into(),
            action_id: format!("{OPERATION}:0"),
            payload: payload.into(),
            payload_sha256: format!("{:x}", Sha256::digest(payload.as_bytes())),
            profile_path: profile.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn resolves_not1mm_character_and_bracket_wavs_in_order() {
        let profile = tempfile::tempdir().unwrap();
        for name in ["c", "q", "space", "again"] {
            fs::File::create(profile.path().join(format!("{name}.wav")))
                .unwrap()
                .write_all(&wav(100))
                .unwrap();
        }
        let prepared = prepare(request(profile.path(), "CQ [again]"), SESSION, WORKSPACE).unwrap();
        assert_eq!(
            prepared
                .segments
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["c", "q", "space", "again"]
        );
        assert_eq!(prepared.total_duration_ms, 400);
    }

    #[test]
    fn stale_context_digest_missing_or_malformed_audio_fail_closed() {
        let profile = tempfile::tempdir().unwrap();
        fs::write(profile.path().join("c.wav"), wav(100)).unwrap();
        assert!(prepare(
            request(profile.path(), "c"),
            "50000000-0000-4000-8000-000000000005",
            WORKSPACE
        )
        .unwrap_err()
        .contains("stale"));
        let mut bad_digest = request(profile.path(), "c");
        bad_digest.payload_sha256 = "0".repeat(64);
        assert!(prepare(bad_digest, SESSION, WORKSPACE)
            .unwrap_err()
            .contains("digest"));
        assert!(prepare(request(profile.path(), "cq"), SESSION, WORKSPACE)
            .unwrap_err()
            .contains("q.wav is missing"));
        fs::write(profile.path().join("q.wav"), b"not wave").unwrap();
        assert!(prepare(request(profile.path(), "cq"), SESSION, WORKSPACE)
            .unwrap_err()
            .contains("RIFF/WAVE"));
    }

    #[test]
    fn maps_slash_explicitly_and_rejects_every_unsupported_character() {
        let profile = tempfile::tempdir().unwrap();
        for name in ["o", "m", "0", "r", "x", "slash", "p"] {
            fs::write(profile.path().join(format!("{name}.wav")), wav(10)).unwrap();
        }
        let prepared = prepare(request(profile.path(), "OM0RX/P"), SESSION, WORKSPACE).unwrap();
        assert_eq!(
            prepared
                .segments
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["o", "m", "0", "r", "x", "slash", "p"]
        );
        assert!(prepare(request(profile.path(), "CQ?"), SESSION, WORKSPACE)
            .unwrap_err()
            .contains("U+003F"));
    }

    #[test]
    fn batch_caps_aggregate_segments_and_binds_the_exact_manifest() {
        let profile = tempfile::tempdir().unwrap();
        fs::write(profile.path().join("c.wav"), wav(10)).unwrap();
        let requests = (0..3)
            .map(|index| {
                let mut item = request(profile.path(), &"c".repeat(100));
                item.action_id = format!("{OPERATION}:{index}");
                item
            })
            .collect();
        assert!(
            prepare_batch(PrepareBatchRequest { requests }, SESSION, WORKSPACE)
                .unwrap_err()
                .contains("aggregate")
        );

        let admission = VoiceAdmission {
            session_id: SESSION.into(),
            workspace_generation: WORKSPACE.into(),
            draft_id: DRAFT.into(),
            action_id: format!("{OPERATION}:0"),
            payload_sha256: "0".repeat(64),
            manifest_sha256: "1".repeat(64),
        };
        let mut state = VoiceRuntime::default();
        state
            .prepared
            .insert(admission_key(&admission), admission.clone());
        let mut wrong = admission.clone();
        wrong.manifest_sha256 = "2".repeat(64);
        assert!(validate_prepared_admissions(&mut state, &[wrong]).is_err());
        validate_prepared_admissions(&mut state, std::slice::from_ref(&admission)).unwrap();
        assert!(validate_prepared_admissions(&mut state, &[admission]).is_err());
    }

    #[test]
    fn prepare_acquire_release_prepare_replay_is_tombstoned_in_scope() {
        let profile = tempfile::tempdir().unwrap();
        fs::write(profile.path().join("c.wav"), wav(10)).unwrap();
        let action_id = format!("{}:0", uuid::Uuid::new_v4());
        let mut first = request(profile.path(), "c");
        first.action_id = action_id.clone();
        let mut replay = request(profile.path(), "c");
        replay.action_id = action_id;
        let prepared = prepare_batch(
            PrepareBatchRequest {
                requests: vec![first],
            },
            SESSION,
            WORKSPACE,
        )
        .unwrap()
        .pop()
        .unwrap();
        let admission = VoiceAdmission {
            session_id: prepared.session_id,
            workspace_generation: prepared.workspace_generation,
            draft_id: prepared.draft_id,
            action_id: prepared.action_id,
            payload_sha256: prepared.payload_sha256,
            manifest_sha256: prepared.manifest_sha256,
        };
        validate_prepared_admissions(&mut runtime().lock().unwrap(), &[admission]).unwrap();
        assert!(prepare_batch(
            PrepareBatchRequest {
                requests: vec![replay],
            },
            SESSION,
            WORKSPACE,
        )
        .unwrap_err()
        .contains("replay denied"));
    }

    #[test]
    fn queued_acquisition_is_retained_by_the_shutdown_barrier() {
        let operation_lane = Mutex::new(());
        let state = Mutex::new(VoiceRuntime {
            pending_acquisitions: 1,
            ..VoiceRuntime::default()
        });
        shutdown_barrier(&operation_lane, &state, || Ok(())).unwrap();
        let state = state.lock().unwrap();
        assert!(state.shutting_down);
        assert_eq!(state.pending_acquisitions, 1);
    }

    #[test]
    fn shutdown_waits_for_late_acquisition_then_releases_owned_ptt() {
        use std::sync::{mpsc, Arc};
        let operation_lane = Arc::new(Mutex::new(()));
        let state = Arc::new(Mutex::new(VoiceRuntime::default()));
        let (acquired_tx, acquired_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let lane_for_acquire = operation_lane.clone();
        let state_for_acquire = state.clone();
        let acquisition = std::thread::spawn(move || {
            let _guard = lane_for_acquire.lock().unwrap();
            acquired_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
            state_for_acquire.lock().unwrap().active_ptt = true;
        });
        acquired_rx.recv().unwrap();
        let lane_for_shutdown = operation_lane.clone();
        let state_for_shutdown = state.clone();
        let (released_tx, released_rx) = mpsc::channel();
        let shutdown = std::thread::spawn(move || {
            shutdown_barrier(&lane_for_shutdown, &state_for_shutdown, || {
                released_tx.send(()).unwrap();
                Ok(())
            })
        });
        assert!(released_rx.recv_timeout(Duration::from_millis(50)).is_err());
        finish_tx.send(()).unwrap();
        acquisition.join().unwrap();
        shutdown.join().unwrap().unwrap();
        released_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(state.lock().unwrap().shutting_down);
    }

    #[test]
    fn test_profile_and_non_owner_never_admit_io() {
        assert!(validate_invoker("main", false, false, true)
            .unwrap_err()
            .contains("disabled"));
        assert!(validate_invoker("contest--active-qso", false, false, false).is_err());
        assert!(validate_invoker("main", true, false, false).is_err());
        assert!(validate_invoker("main", false, true, false).is_err());
        assert!(validate_invoker("main", false, false, false).is_ok());
    }
}
