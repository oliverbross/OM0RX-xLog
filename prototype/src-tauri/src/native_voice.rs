//! The existing voice/PTT owner extended to normal logging and native audio.
use super::*;
use crate::voice_audio::{self, Profile, Route, PCM};
use std::sync::atomic::AtomicU64;
use tauri::Manager;
static QUEUE_GENERATION: AtomicU64 = AtomicU64::new(1);
pub fn native_generation() -> u64 {
    QUEUE_GENERATION.load(Ordering::Acquire)
}
fn require_generation(expected: u64) -> Result<(), String> {
    if expected != native_generation() {
        Err("Voice request was retired by Stop; nothing was restarted.".into())
    } else {
        Ok(())
    }
}
fn focused(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or("The initiating voice window was retired; no output was started.")?;
    if window.is_visible().ok() != Some(true) || window.is_focused().ok() != Some(true) {
        return Err(
            "The initiating voice window lost focus or visibility; the held QSO was retained."
                .into(),
        );
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NativeRequest {
    Capabilities,
    Snapshot,
    Save {
        profile: Profile,
        expected_revision: u64,
        generation: String,
        #[serde(rename = "operationID")]
        operation_id: String,
    },
    Inspect,
    Analyze {
        slot: usize,
    },
    Prepare {
        slot: usize,
        expected_revision: u64,
        generation: String,
        #[serde(rename = "intentID")]
        intent_id: String,
    },
    Send {
        #[serde(rename = "actionID")]
        action_id: String,
    },
    Preview {
        slot: usize,
        expected_revision: u64,
        generation: String,
    },
    Import {
        slot: usize,
        expected_revision: u64,
        generation: String,
        wav_base64: String,
        overwrite: bool,
    },
    RecordStart {
        slot: usize,
        expected_revision: u64,
        generation: String,
        overwrite: bool,
    },
    RecordStop {
        #[serde(rename = "actionID")]
        action_id: String,
    },
    Stop,
    ContestPlay {
        admissions: Vec<VoiceAdmission>,
    },
}
impl NativeRequest {
    pub fn is_output(&self) -> bool {
        matches!(
            self,
            Self::Send { .. } | Self::Prepare { .. } | Self::ContestPlay { .. }
        )
    }
    pub fn validate_surface(&self, label: &str) -> Result<(), String> {
        let allowed = match self {
            Self::ContestPlay { .. } | Self::Stop | Self::Snapshot | Self::Capabilities => {
                matches!(label, "main" | "contest-setup")
            }
            _ => label == "main",
        };
        if !allowed {
            return Err("That voice action is unavailable from this window. Normal memories belong to the main operator desk.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq)]
struct Canonical {
    worker: u64,
    module: Value,
    generation: String,
    draft_id: String,
    draft_revision: u64,
    settings_revision: u64,
    profile: Profile,
}
fn reviewed_preparation(
    canonical: &Canonical,
    revision: u64,
    generation: &str,
) -> Result<(), String> {
    if canonical.settings_revision != revision || canonical.generation != generation {
        return Err("Voice settings or workspace changed. Reload and review the voice desk before preparing audio.".into());
    }
    Ok(())
}
struct Prepared {
    canonical: Canonical,
    target: BoundVoiceTarget,
    pcm: PCM,
    created: Instant,
    identity: AudioIdentity,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioIdentity {
    #[serde(rename = "sourceSHA256")]
    source_sha256: String,
    #[serde(rename = "editedPCMSHA256")]
    edited_pcm_sha256: String,
    #[serde(rename = "outputPCMSHA256")]
    output_pcm_sha256: String,
    source_slot: String,
    edit: voice_audio::Edit,
    sample_rate: u32,
    frames: u64,
    transform: &'static str,
}
fn audio_identity(pcm: &PCM, profile: &Profile, index: usize) -> AudioIdentity {
    AudioIdentity {
        source_sha256: pcm.source_sha256.clone(),
        edited_pcm_sha256: pcm.edited_pcm_sha256.clone(),
        output_pcm_sha256: voice_audio::pcm_digest(pcm),
        source_slot: format!("f{index}.wav"),
        edit: profile.edits[index - 1].clone(),
        sample_rate: pcm.rate,
        frames: pcm.samples.len() as u64,
        transform: "integer-pcm-mono-edit-v1 / linear-resample-v1",
    }
}
struct Job {
    id: String,
    kind: &'static str,
    phase: String,
    cancel: Arc<AtomicBool>,
    save_recording: Arc<AtomicBool>,
    consumed: u64,
    total: u64,
}
#[derive(Default)]
struct NativeState {
    scope: String,
    prepared: HashMap<String, Prepared>,
    intents: HashMap<String, String>,
    consumed: HashSet<String>,
    job: Option<Job>,
    last: Value,
}
impl NativeState {
    fn cancel_job(&self, save: bool) {
        if let Some(job) = &self.job {
            // Explicit cancellation is terminal until this exact job retires.
            if job.cancel.load(Ordering::Acquire) && !job.save_recording.load(Ordering::Acquire) {
                return;
            }
            job.save_recording.store(save, Ordering::Release);
            job.cancel.store(true, Ordering::Release);
        }
    }
    fn publish_recording(
        &self,
        id: &str,
        original: &(u64, Value, Profile),
        current: &(u64, Value, Profile),
        slot: String,
        bytes: Vec<u8>,
        overwrite: bool,
    ) -> Result<(), String> {
        let job = self
            .job
            .as_ref()
            .filter(|job| job.kind == "recording" && job.id == id)
            .ok_or("That recording no longer owns publication; the original slot was retained.")?;
        recording_publication(
            original,
            current,
            job.cancel.load(Ordering::Acquire),
            job.save_recording.load(Ordering::Acquire),
        )?;
        profile_write(ProfileWriteRequest {
            profile_path: original.2.profile_path.clone(),
            slot,
            wav_base64: STANDARD.encode(bytes),
            overwrite,
        })?;
        Ok(())
    }
    fn finish_recording(&mut self, id: &str) -> Result<(), String> {
        let job = self.job.as_ref().filter(|job| job.kind == "recording" && job.id == id)
            .ok_or("That recording already ended or belongs to another job; no current audio was changed.")?;
        if job.cancel.load(Ordering::Acquire) && !job.save_recording.load(Ordering::Acquire) {
            return Err(
                "That recording was cancelled; Finish cannot save it or replace the original slot."
                    .into(),
            );
        }
        job.save_recording.store(true, Ordering::Release);
        job.cancel.store(true, Ordering::Release);
        self.prepared.clear();
        Ok(())
    }
    fn publish_preparation(
        &mut self,
        scope: &str,
        intent: &str,
        id: String,
        index: usize,
        prepared: Prepared,
    ) -> Result<Value, String> {
        if self.scope != scope {
            return Err(
                "Voice workspace changed during preparation; no action was published.".into(),
            );
        }
        // PCM preparation runs outside this lock. A concurrent request may
        // already have admitted the same intent while those bytes were decoded.
        if let Some(action) = self.intents.get(intent) {
            return Ok(json!({"actionID":action,"duplicate":true}));
        }
        self.prepared
            .retain(|_, p| p.created.elapsed() < Duration::from_secs(30));
        let retained_samples: usize = self.prepared.values().map(|p| p.pcm.samples.len()).sum();
        if self.prepared.len() >= 16
            || self.intents.len() >= 4096
            || retained_samples.saturating_add(prepared.pcm.samples.len()) > 32 * 1024 * 1024
        {
            return Err("Voice preparation/action journal is full; Stop clears prepared audio, and a deliberate workspace restart clears consumed intents.".into());
        }
        if self.job.is_some() {
            return Err("Voice audio is already active.".into());
        }
        let result = json!({"actionID":id,"durationMs":prepared.pcm.duration_ms(),"peak":prepared.pcm.peak,
            "clippedSamples":prepared.pcm.clipped,"slot":index,"audioIdentity":prepared.identity});
        self.intents.insert(intent.into(), id.clone());
        self.prepared.insert(id, prepared);
        Ok(result)
    }
}
static NATIVE: OnceLock<Mutex<NativeState>> = OnceLock::new();
fn state() -> &'static Mutex<NativeState> {
    NATIVE.get_or_init(|| Mutex::new(NativeState::default()))
}
pub(super) fn active() -> bool {
    state().lock().map(|s| s.job.is_some()).unwrap_or(true)
}
pub(super) fn cancel(save: bool) {
    QUEUE_GENERATION.fetch_add(1, Ordering::AcqRel);
    let mut revoke = false;
    if let Ok(mut s) = state().lock() {
        revoke =
            !s.prepared.is_empty() || s.job.as_ref().is_some_and(|j| j.kind.contains("transmit"));
        s.prepared.clear();
        s.cancel_job(save);
    }
    if let Ok(mut s) = runtime().lock() {
        revoke |= s.active_ptt || !s.prepared.is_empty();
        s.prepared.clear();
        s.prepared_audio.clear();
    }
    if revoke {
        let _ = crate::carrier_tune::revoke_output_intent();
    }
}
fn call(worker: u64, method: &str, params: Value) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let reply = crate::worker::request_existing_generation(
        json!({"id":id,"method":method,"params":params}),
        worker,
    )?;
    if crate::worker::generation() != worker || reply["id"] != id || reply["ok"] != true {
        return Err(reply["error"]["message"]
            .as_str()
            .unwrap_or("The native voice workspace reply is unavailable; no output is retried.")
            .into());
    }
    Ok(reply["result"].clone())
}
fn settings() -> Result<(u64, Value, Profile), String> {
    let worker = crate::worker::generation();
    if worker == 0 {
        return Err("Open a workspace before using voice memories.".into());
    }
    let saved = call(worker, "settings_load", json!({}))?;
    let profile: Profile = if saved["settings"]["voiceProfile"].is_null() {
        Profile::default()
    } else {
        serde_json::from_value(saved["settings"]["voiceProfile"].clone())
            .map_err(|_| "Saved native voice preferences are invalid.")?
    };
    profile.validate()?;
    Ok((worker, saved, profile))
}
fn require_reviewed_settings(saved: &Value, revision: u64, generation: &str) -> Result<(), String> {
    if saved["revision"] != revision || saved["generation"] != generation {
        return Err("Voice settings or workspace changed. Reload and review the voice desk before using audio or changing a WAV slot.".into());
    }
    Ok(())
}
fn reviewed_media_settings(
    revision: u64,
    generation: &str,
) -> Result<(u64, Value, Profile), String> {
    let value = settings()?;
    require_reviewed_settings(&value.1, revision, generation)?;
    Ok(value)
}
fn recording_publication(
    original: &(u64, Value, Profile),
    current: &(u64, Value, Profile),
    cancelled: bool,
    save: bool,
) -> Result<(), String> {
    if original.0 != current.0
        || original.1["generation"] != current.1["generation"]
        || original.2 != current.2
    {
        return Err("Voice workspace, library or routes changed during recording; the original slot was retained.".into());
    }
    if cancelled && !save {
        return Err("Voice recording cancelled; the original slot was retained.".into());
    }
    Ok(())
}
pub(super) fn contest_profile(session: &str) -> Result<PathBuf, String> {
    let setup = call(
        crate::worker::generation(),
        "contest_setup_get",
        json!({"sessionID":session}),
    )?;
    canonical_profile(
        setup["setup"]["preferences"]["voiceProfilePath"]
            .as_str()
            .ok_or("Canonical contest voice library is unavailable")?,
    )
}
fn canonical() -> Result<Canonical, String> {
    let module = crate::operating_module::owner()?.snapshot()?;
    if module["selected"] != "normal_logging" || module["transitioning"] != false {
        return Err("Normal voice output belongs to the active Normal Logging workspace.".into());
    }
    let (worker, saved, profile) = settings()?;
    let draft = call(worker, "logbook_operator_draft", json!({}))?["draft"].clone();
    if saved["generation"] != draft["generation"] {
        return Err("The voice draft and workspace generation changed.".into());
    }
    let generation = saved["generation"]
        .as_str()
        .filter(|s| uuid::Uuid::parse_str(s).is_ok())
        .ok_or("Voice workspace identity unavailable")?
        .to_owned();
    let draft_id = draft["qso"]["id"]
        .as_str()
        .filter(|s| uuid::Uuid::parse_str(s).is_ok())
        .ok_or("Voice new-QSO draft identity unavailable")?
        .to_owned();
    Ok(Canonical {
        worker,
        module,
        generation,
        draft_id,
        draft_revision: draft["revision"]
            .as_u64()
            .ok_or("Voice draft revision unavailable")?,
        settings_revision: saved["revision"]
            .as_u64()
            .ok_or("Voice settings revision unavailable")?,
        profile,
    })
}
fn phone(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        matches!(
            s.to_ascii_uppercase().as_str(),
            "SSB" | "USB" | "LSB" | "PHONE"
        )
    })
}
fn ssb(app: &tauri::AppHandle) -> Result<(), String> {
    let radio = crate::station_telemetry::owner(app)?.snapshot()?;
    require_phone_transmit(&radio)
}
fn require_phone_transmit(radio: &Value) -> Result<(), String> {
    let r = &radio["snapshot"]["radio"];
    // The general radio mode follows RX on Flex/agent split operation. Only
    // the uniquely marked, addressed TX VFO can authorize phone output there.
    // TCI modulation belongs to the addressed TRX and has no invented VFO.
    let source = radio["provider"].as_str();
    let mode = match source {
        Some("direct_agent" | "direct_flex_lan") => r["vfos"].as_array().and_then(|vs| {
            let mut tx = vs.iter().filter(|v| v["transmit"] == true);
            let v = tx.next()?;
            if tx.next().is_some()
                || r["transmit_vfo"].as_str().is_none_or(str::is_empty)
                || v["letter"] != r["transmit_vfo"]
            {
                return None;
            }
            v["mode"].as_str()
        }),
        Some("direct_tci")
            if radio["snapshot"]["tci"]["trx"].as_u64().is_some()
                && radio["snapshot"]["tci"]["channel"].as_u64().is_some() =>
        {
            r["mode"].as_str()
        }
        _ => None,
    };
    if radio["available"] != true
        || radio["snapshot"]["source"].as_str() != source
        || r["connected"] != true
        || r["observed"] != true
        || !mode.is_some_and(|m| phone(&json!(m)))
    {
        return Err("Voice transmit requires authoritative live SSB/USB/LSB mode on the selected transmitter; draft text and receive mode cannot grant it.".into());
    }
    Ok(())
}
fn slot(index: usize) -> Result<String, String> {
    if !(1..=10).contains(&index) {
        Err("Choose Voice 1 through Voice 10.".into())
    } else {
        Ok(format!("f{index}"))
    }
}
fn pcm(profile: &Profile, index: usize, route: &Route) -> Result<PCM, String> {
    let name = slot(index)?;
    let folder = canonical_profile(&profile.profile_path)?;
    let path = admitted_wav_path(&folder, &name)?;
    voice_audio::decode(
        &read_bounded_wav(&path, &name)?,
        &profile.edits[index - 1],
        route.sample_rate,
    )
}
fn begin(
    id: &str,
    kind: &'static str,
    total: u64,
    generation: u64,
) -> Result<(Arc<AtomicBool>, Arc<AtomicBool>), String> {
    if runtime()
        .lock()
        .map_err(|_| "Voice runtime unavailable")?
        .active_ptt
    {
        return Err("Another voice output owns PTT. Use its Stop first.".into());
    }
    let mut s = state()
        .lock()
        .map_err(|_| "Native voice state unavailable")?;
    require_generation(generation)?;
    if s.job.is_some() {
        return Err("Voice audio is already active. Use Stop before another operation.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    let save = Arc::new(AtomicBool::new(false));
    s.job = Some(Job {
        id: id.into(),
        kind,
        phase: "preparing".into(),
        cancel: cancel.clone(),
        save_recording: save.clone(),
        consumed: 0,
        total,
    });
    Ok((cancel, save))
}
fn progress(phase: &str, consumed: u64) {
    if let Ok(mut s) = state().lock() {
        if let Some(j) = &mut s.job {
            j.phase = phase.into();
            j.consumed = consumed;
        }
    }
}
fn finish(result: &Result<(), String>, cancelled: bool, identity: Option<&AudioIdentity>) {
    let uncertain = runtime().lock().map(|s| s.active_ptt).unwrap_or(true);
    if let Ok(mut s) = state().lock() {
        let id = s.job.as_ref().map(|j| j.id.clone());
        s.last = json!({"actionID":id,"status":if uncertain{"uncertain"}else if result.is_err(){"failed"}else if cancelled{"cancelled"}else{"completed"},"error":result.as_ref().err(),"evidence":"local audio presentation / PTT receipts; no RF claim"});
        if let Some(identity) = identity {
            s.last["audioIdentity"] = json!(identity);
        }
        s.job = None;
    }
}
fn snapshot() -> Result<Value, String> {
    let s = state()
        .lock()
        .map_err(|_| "Native voice state unavailable")?;
    Ok(
        json!({"nativeAvailable":cfg!(target_os="macos"),"job":s.job.as_ref().map(|j|json!({"actionID":j.id,"kind":j.kind,"phase":j.phase,"consumedFrames":j.consumed,"totalFrames":j.total})),"last":s.last}),
    )
}
fn wait_on(app: &tauri::AppHandle, id: &str, cancel: &AtomicBool) -> Result<(), String> {
    let deadline = Instant::now() + PTT_CONFIRM_TIMEOUT;
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("Voice send cancelled while acquiring PTT.".into());
        }
        if ptt_receipt_status(app, id)? == "confirmed" {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(
                "Voice PTT-on lacks authoritative TX confirmation; audio was not started.".into(),
            );
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn playback(
    app: &tauri::AppHandle,
    pcm: PCM,
    route: Route,
    target: Option<&BoundVoiceTarget>,
    cancel: Arc<AtomicBool>,
    validate: impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    let duration = pcm.duration_ms();
    let output = voice_audio::output(pcm, route, cancel.clone())?; // Running silence and clock evidence before any acquisition.
    validate()?;
    if cancel.load(Ordering::Acquire) {
        return Ok(());
    }
    let _lane = lane().lock().map_err(|_| "Voice PTT lane unavailable")?;
    if let Some(target) = target {
        current_bound_target(app, target)?;
        validate()?;
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        progress("acquiring", 0);
        let acquired = apply_ptt(app, true, Some(target));
        let retained = voice_release_required(app).unwrap_or(true);
        runtime()
            .lock()
            .map_err(|_| "Voice runtime unavailable")?
            .active_ptt = retained;
        let acquisition = acquired.and_then(|id| wait_on(app, &id, &cancel));
        if let Err(error) = acquisition {
            let release = release_locked(app);
            return Err(match release {
                Ok(()) => error,
                Err(off) => format!("{error} Release remains uncertain: {off}"),
            });
        }
    }
    let result = (|| {
        validate()?;
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        progress("playing", 0);
        output.signals.enabled.store(true, Ordering::Release);
        let deadline = Instant::now() + Duration::from_millis(duration + 3_000);
        let mut checked = Instant::now();
        loop {
            if cancel.load(Ordering::Acquire) {
                break;
            }
            if output.signals.failed.load(Ordering::Acquire) {
                return Err(
                    "The selected native audio stream failed; remaining audio was cancelled."
                        .into(),
                );
            }
            let consumed = output.signals.consumed.load(Ordering::Acquire);
            progress(
                if consumed > 0 {
                    "playing / draining"
                } else {
                    "playing"
                },
                consumed,
            );
            if output.signals.done.load(Ordering::Acquire) {
                break;
            }
            if Instant::now() >= deadline {
                return Err(
                    "The native voice presentation/drain watchdog expired; release was initiated."
                        .into(),
                );
            }
            if checked.elapsed() >= Duration::from_millis(250) {
                if !output.unchanged() {
                    return Err("The explicit audio device/rate/channels changed; no substitute was opened.".into());
                }
                validate()?;
                checked = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    })();
    output.signals.enabled.store(false, Ordering::Release);
    drop(output);
    if target.is_some() {
        progress("releasing", 0);
        let released = release_locked(app);
        if let Err(off) = released {
            return Err(format!(
                "{} PTT release remains uncertain: {off}",
                result.err().unwrap_or_default()
            ));
        }
    }
    result
}
fn validate_ongoing(
    app: &tauri::AppHandle,
    original: &Canonical,
    target: &BoundVoiceTarget,
) -> Result<(), String> {
    if &canonical()? != original {
        return Err(
            "Voice workspace, draft or settings changed; the original job was cancelled.".into(),
        );
    }
    let now: crate::ptt_session::Target =
        serde_json::from_value(crate::ptt_session::context(app)?["target"].clone())
            .map_err(|_| "Voice target observation unavailable")?;
    same_bound_identity(&target.target, &now)?;
    ssb(app)
}

pub fn native_request(
    app: &tauri::AppHandle,
    request: NativeRequest,
    generation: u64,
    surface: &str,
) -> Result<Value, String> {
    if !matches!(
        request,
        NativeRequest::Stop
            | NativeRequest::RecordStop { .. }
            | NativeRequest::Snapshot
            | NativeRequest::Capabilities
    ) {
        require_generation(generation)?;
    }
    match request {
        NativeRequest::Capabilities => Ok(
            json!({"nativeAvailable":cfg!(target_os="macos"),"backend":if cfg!(target_os="macos"){"CPAL/CoreAudio"}else{"legacy contest WebView; native routes unavailable"}}),
        ),
        NativeRequest::Snapshot => {
            let (_, saved, profile) = settings()?;
            let mut result = snapshot()?;
            result["profile"] = serde_json::to_value(profile).map_err(|e| e.to_string())?;
            result["revision"] = saved["revision"].clone();
            result["generation"] = saved["generation"].clone();
            result["devices"] = voice_audio::devices()?;
            Ok(result)
        }
        NativeRequest::Save {
            profile,
            expected_revision,
            generation,
            operation_id,
        } => {
            profile.validate()?;
            if uuid::Uuid::parse_str(&operation_id).is_err() {
                return Err("Invalid voice settings operation identity.".into());
            }
            let (worker, mut saved, _) = settings()?;
            if saved["revision"] != expected_revision || saved["generation"] != generation {
                return Err("Voice settings changed in another window or workspace. Reload before saving; current values were retained.".into());
            }
            saved["settings"]["voiceProfile"] =
                serde_json::to_value(profile).map_err(|e| e.to_string())?;
            call(
                worker,
                "settings_save",
                json!({"operationID":operation_id,"expectedRevision":expected_revision,"generation":generation,"settings":saved["settings"]}),
            )
        }
        NativeRequest::Inspect => {
            let (_, _, profile) = settings()?;
            Ok(serde_json::to_value(profile_manifest(ProfileRequest {
                profile_path: profile.profile_path,
            })?)
            .map_err(|e| e.to_string())?)
        }
        NativeRequest::Analyze { slot: index } => {
            let (_, _, profile) = settings()?;
            let route = profile
                .routes
                .transmit
                .as_ref()
                .or(profile.routes.monitor.as_ref())
                .ok_or("Choose an audio route to analyze the derived memory.")?;
            let value = pcm(&profile, index, route)?;
            Ok(
                json!({"durationMs":value.duration_ms(),"peak":value.peak,"clippedSamples":value.clipped,"sampleRate":value.rate,"audioIdentity":audio_identity(&value,&profile,index)}),
            )
        }
        NativeRequest::Prepare {
            slot: index,
            intent_id,
            expected_revision,
            generation: workspace_generation,
        } => {
            if uuid::Uuid::parse_str(&intent_id).is_err() {
                return Err("Invalid voice intent identity.".into());
            }
            let canonical = canonical()?;
            reviewed_preparation(&canonical, expected_revision, &workspace_generation)?;
            focused(app, surface)?;
            let scope = format!(
                "{}/{}/{}",
                canonical.worker, canonical.generation, canonical.module["context"]
            );
            {
                let mut s = state()
                    .lock()
                    .map_err(|_| "Native voice state unavailable")?;
                if s.scope != scope {
                    if s.job.is_some() {
                        return Err("The previous voice owner is still stopping.".into());
                    }
                    s.scope = scope.clone();
                    s.prepared.clear();
                    s.intents.clear();
                    s.consumed.clear();
                }
                if let Some(action) = s.intents.get(&intent_id) {
                    return Ok(json!({"actionID":action,"duplicate":true}));
                }
            }
            ssb(app)?;
            let route = canonical
                .profile
                .routes
                .transmit
                .as_ref()
                .ok_or("Select and save a reviewed native transmitter audio route first.")?;
            let pcm = pcm(&canonical.profile, index, route)?;
            let target = capture_target(app)?;
            let identity = audio_identity(&pcm, &canonical.profile, index);
            let id = uuid::Uuid::new_v4().to_string();
            let mut s = state()
                .lock()
                .map_err(|_| "Native voice state unavailable")?;
            require_generation(generation)?;
            s.publish_preparation(
                &scope,
                &intent_id,
                id,
                index,
                Prepared {
                    canonical,
                    target,
                    pcm,
                    created: Instant::now(),
                    identity,
                },
            )
        }
        NativeRequest::Send { action_id } => {
            let prepared = {
                let mut s = state()
                    .lock()
                    .map_err(|_| "Native voice state unavailable")?;
                if s.consumed.contains(&action_id) {
                    return Err(
                        "This native voice action was already consumed; replay denied.".into(),
                    );
                }
                let prepared = s.prepared.remove(&action_id).ok_or(
                    "Voice action is missing, stopped or expired; prepare a new explicit send.",
                )?;
                s.consumed.insert(action_id.clone());
                prepared
            };
            if prepared.created.elapsed() > Duration::from_secs(30) {
                return Err("Voice review expired; prepare a new explicit send.".into());
            }
            focused(app, surface)?;
            validate_ongoing(app, &prepared.canonical, &prepared.target)?;
            let route = prepared
                .canonical
                .profile
                .routes
                .transmit
                .clone()
                .ok_or("Native voice transmitter route unavailable")?;
            let total = prepared.pcm.samples.len() as u64;
            let (cancel, _) = begin(&action_id, "transmit", total, generation)?;
            let result = playback(
                app,
                prepared.pcm,
                route,
                Some(&prepared.target),
                cancel.clone(),
                || {
                    focused(app, surface)?;
                    validate_ongoing(app, &prepared.canonical, &prepared.target)
                },
            );
            let cancelled = cancel.load(Ordering::Acquire);
            finish(&result, cancelled, Some(&prepared.identity));
            result?;
            snapshot()
        }
        NativeRequest::Preview {
            slot: index,
            expected_revision,
            generation: workspace_generation,
        } => {
            let (worker, saved, profile) =
                reviewed_media_settings(expected_revision, &workspace_generation)?;
            let route = profile
                .routes
                .monitor
                .clone()
                .ok_or("Select and save a concrete native monitor route first.")?;
            voice_audio::monitor(&route, profile.routes.transmit.as_ref())?;
            let pcm = pcm(&profile, index, &route)?;
            let identity = audio_identity(&pcm, &profile, index);
            let id = uuid::Uuid::new_v4().to_string();
            let (cancel, _) = begin(&id, "preview", pcm.samples.len() as u64, generation)?;
            let result = playback(app, pcm, route, None, cancel.clone(), || {
                let (w, s, p) = settings()?;
                if w != worker || s["generation"] != saved["generation"] || p != profile {
                    return Err(
                        "Voice preview configuration changed; playback was cancelled.".into(),
                    );
                }
                Ok(())
            });
            finish(&result, cancel.load(Ordering::Acquire), Some(&identity));
            result?;
            snapshot()
        }
        NativeRequest::Import {
            slot: index,
            expected_revision,
            generation: workspace_generation,
            wav_base64,
            overwrite,
        } => {
            let (_, _, profile) =
                reviewed_media_settings(expected_revision, &workspace_generation)?;
            if active() {
                return Err("Stop active voice audio before changing a library slot.".into());
            }
            Ok(serde_json::to_value(profile_write(ProfileWriteRequest {
                profile_path: profile.profile_path,
                slot: slot(index)?,
                wav_base64,
                overwrite,
            })?)
            .map_err(|e| e.to_string())?)
        }
        NativeRequest::RecordStart {
            slot: index,
            expected_revision,
            generation: workspace_generation,
            overwrite,
        } => {
            let original = reviewed_media_settings(expected_revision, &workspace_generation)?;
            let profile = &original.2;
            let name = slot(index)?;
            let folder = canonical_profile(&profile.profile_path)?;
            if folder.join(format!("{name}.wav")).exists() && !overwrite {
                return Err(
                    "This voice slot exists. Choose Replace explicitly before recording.".into(),
                );
            }
            let route = profile
                .routes
                .input
                .clone()
                .ok_or("Select and save a concrete native microphone route first.")?;
            let id = uuid::Uuid::new_v4().to_string();
            let (cancel, save) = begin(&id, "recording", 0, generation)?;
            progress("recording", 0);
            let result = (|| {
                let bytes = voice_audio::record(&route, cancel.clone())?;
                if cancel.load(Ordering::Acquire) && !save.load(Ordering::Acquire) {
                    return Err("Voice recording cancelled; the original slot was retained.".into());
                }
                let current = settings()?;
                // Stop/workspace changes can arrive during the settings read.
                // Serialize the final admission/write with Stop and Finish.
                state()
                    .lock()
                    .map_err(|_| "Native voice state unavailable")?
                    .publish_recording(&id, &original, &current, name, bytes, overwrite)
            })();
            finish(&result, false, None);
            result?;
            snapshot()
        }
        NativeRequest::RecordStop { action_id } => {
            let mut s = state()
                .lock()
                .map_err(|_| "Native voice state unavailable")?;
            s.finish_recording(&action_id)?;
            QUEUE_GENERATION.fetch_add(1, Ordering::AcqRel);
            drop(s);
            snapshot()
        }
        NativeRequest::Stop => {
            cancel(false);
            if !active() {
                runtime()
                    .lock()
                    .map_err(|_| "Voice runtime unavailable")?
                    .ptt_release_operation = None;
            }
            // Off has its own native PTT lane. Reuse one journalled release UUID
            // with the supervisor's final path; never wait behind a lost On reply.
            let deadline = Instant::now() + Duration::from_millis(100);
            loop {
                if voice_release_required(app)? {
                    release_locked(app)?;
                    break;
                }
                let acquiring = state()
                    .lock()
                    .map_err(|_| "Voice state unavailable")?
                    .job
                    .as_ref()
                    .is_some_and(|j| j.phase == "acquiring");
                if !acquiring || Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            snapshot()
        }
        NativeRequest::ContestPlay { admissions } => {
            contest_play(app, admissions, generation, surface)
        }
    }
}

fn contest_play(
    app: &tauri::AppHandle,
    admissions: Vec<VoiceAdmission>,
    generation: u64,
    surface: &str,
) -> Result<Value, String> {
    let context = crate::contest_window_context::active()?;
    let (worker, _, profile) = settings()?;
    let route = profile.routes.transmit.clone().ok_or(
        "Choose a reviewed native TX audio route in Voice settings before contest phone output.",
    )?;
    if admissions.is_empty()
        || admissions.len() > 12
        || admissions.iter().any(|a| {
            a.session_id != context.session_id
                || a.workspace_generation != context.workspace_generation
        })
    {
        return Err("Contest voice native playback belongs to a stale context.".into());
    }
    let target = admissions[0]
        .bound_target
        .clone()
        .ok_or("Capture the native contest voice target before playback.")?;
    if admissions
        .iter()
        .any(|a| a.bound_target.as_ref() != Some(&target))
    {
        return Err("Contest native voice targets differ.".into());
    }
    let mut pcm = PCM {
        samples: vec![],
        rate: route.sample_rate,
        peak: 0.0,
        clipped: 0,
        source_sha256: String::new(),
        edited_pcm_sha256: String::new(),
    };
    let segments = {
        let s = runtime().lock().map_err(|_| "Voice runtime unavailable")?;
        if s.prepared_generation != generation {
            return Err(
                "Contest voice preparation was retired by Stop; no audio was admitted.".into(),
            );
        }
        let mut prepared = Vec::new();
        for admission in &admissions {
            if s.prepared.get(&admission_key(admission)) != Some(admission) {
                return Err("Contest native voice manifest is stale or replayed.".into());
            }
            let segments = s
                .prepared_audio
                .get(&admission_key(admission))
                .ok_or("Contest native audio preparation is missing")?;
            prepared.extend(segments.iter().cloned());
        }
        prepared
    };
    // Decode/resample outside the owner lock: Stop never waits behind PCM preparation.
    for segment in segments {
        let bytes = STANDARD
            .decode(&segment.wav_base64)
            .map_err(|_| "Invalid prepared voice PCM")?;
        let edit = segment
            .name
            .strip_prefix('f')
            .and_then(|n| n.parse::<usize>().ok())
            .filter(|n| (1..=10).contains(n))
            .map(|n| profile.edits[n - 1].clone())
            .unwrap_or_default();
        let decoded = voice_audio::decode(&bytes, &edit, route.sample_rate)?;
        pcm.peak = pcm.peak.max(decoded.peak);
        pcm.clipped += decoded.clipped;
        pcm.samples.extend(decoded.samples);
    }
    if pcm.duration_ms() > MAX_TOTAL_DURATION_MS {
        return Err("Native voice batch exceeds two minutes after preparation.".into());
    }
    ssb(app)?;
    current_bound_target(app, &target)?;
    let id = uuid::Uuid::new_v4().to_string();
    let (cancel, _) = begin(
        &id,
        "contest transmit",
        pcm.samples.len() as u64,
        generation,
    )?;
    // Claim is performed natively after complete PCM/stream readiness, never by a renderer flag.
    let claim = Mutex::new(false);
    let result = playback(app, pcm, route, Some(&target), cancel.clone(), || {
        focused(app, surface)?;
        let current = crate::contest_window_context::active()?;
        if current.session_id != context.session_id
            || current.workspace_generation != context.workspace_generation
            || crate::worker::generation() != worker
        {
            return Err("Contest voice owner changed; no audio is replayed.".into());
        }
        let observed: crate::ptt_session::Target =
            serde_json::from_value(crate::ptt_session::context(app)?["target"].clone())
                .map_err(|_| "Contest voice target evidence is unavailable")?;
        same_bound_identity(&target.target, &observed)?;
        let mut claimed = claim
            .lock()
            .map_err(|_| "Contest voice claim unavailable")?;
        if !*claimed {
            claim_contest(worker, &context.session_id, &admissions)?;
            let mut s = runtime().lock().map_err(|_| "Voice runtime unavailable")?;
            validate_prepared_admissions(&mut s, &admissions)?;
            for a in &admissions {
                s.prepared_audio.remove(&admission_key(a));
            }
            *claimed = true;
        }
        ssb(app)
    });
    finish(&result, cancel.load(Ordering::Acquire), None);
    result?;
    snapshot()
}
pub(super) fn claim_contest(
    worker: u64,
    session: &str,
    admissions: &[VoiceAdmission],
) -> Result<(), String> {
    let operation = admissions
        .first()
        .and_then(|a| a.action_id.rsplit_once(':'))
        .map(|(id, _)| id)
        .ok_or("Invalid voice output operation")?;
    if admissions
        .iter()
        .any(|a| a.action_id.rsplit_once(':').map(|(op, _)| op) != Some(operation))
    {
        return Err("Native contest voice batch must belong to one output operation.".into());
    }
    let receipt = call(
        worker,
        "contest_receipt",
        json!({"sessionID":session,"operationID":operation}),
    )?;
    let result = &receipt["result"];
    if receipt["found"] != true || result["revision"].as_u64().is_none() {
        return Err("Canonical contest output receipt is unavailable.".into());
    }
    let claimed = call(
        worker,
        "contest_output_claim",
        json!({"sessionID":session,"operationID":operation,"revision":result["revision"]}),
    )?;
    if claimed["claimed"] != true || claimed["operationID"] != operation {
        return Err("Native contest voice claim could not be confirmed; do not retry.".into());
    }
    let actions = claimed["actions"]
        .as_array()
        .ok_or("Canonical claimed voice actions are unavailable")?;
    validate_claimed_voice_actions(actions, admissions)
}
fn validate_claimed_voice_actions(
    actions: &[Value],
    admissions: &[VoiceAdmission],
) -> Result<(), String> {
    if actions.len() != admissions.len() {
        return Err("The complete native voice batch must match the canonical Host claim.".into());
    }
    let mut ids = HashSet::new();
    for a in admissions {
        if !ids.insert(&a.action_id) {
            return Err("A native voice action cannot occur twice in one claimed batch.".into());
        }
        let action = actions
            .iter()
            .find(|v| v["actionID"] == a.action_id)
            .ok_or("Voice action is absent from the canonical Host operation")?;
        if action["kind"] != "voice_keyer"
            || action["signal"] != "phone"
            || action["mode"] != "SSB"
            || action["payloadSHA256"] != a.payload_sha256
            || action["draftID"] != a.draft_id
        {
            return Err(
                "Voice action differs from the canonical Host operation; no PTT was acquired."
                    .into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn recording_fixture() -> NativeState {
        NativeState {
            job: Some(Job {
                id: "recording".into(),
                kind: "recording",
                phase: "recording".into(),
                cancel: Arc::new(AtomicBool::new(false)),
                save_recording: Arc::new(AtomicBool::new(false)),
                consumed: 0,
                total: 0,
            }),
            ..NativeState::default()
        }
    }
    fn cancelled_recording_retains_slot(order: &[&str]) {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("f1.wav");
        let retained = voice_audio::wav(&[1; 480], 48_000);
        std::fs::write(&path, &retained).unwrap();
        let mut profile = Profile::default();
        profile.profile_path = folder.path().to_str().unwrap().into();
        let settings = (1, json!({"generation":"original"}), profile);
        let mut state = recording_fixture();
        let mut last_finish = None;
        for action in order {
            match *action {
                "stop" => state.cancel_job(false),
                "finish" => last_finish = Some(state.finish_recording("recording")),
                "stale" => assert!(state.finish_recording("retired").is_err()),
                _ => panic!("Unknown fixture action"),
            }
        }
        let publication = state.publish_recording(
            "recording",
            &settings,
            &settings,
            "f1".into(),
            voice_audio::wav(&[2; 480], 48_000),
            true,
        );
        assert!(
            std::fs::read(path).unwrap() == retained,
            "Stop must retain the existing slot"
        );
        assert!(publication.is_err(), "Cancelled recording must not publish");
        if order.last() == Some(&"finish") {
            assert!(
                last_finish.unwrap().is_err(),
                "Delayed Finish cannot reverse Stop"
            );
        }
    }
    #[test]
    fn stop_then_same_recording_finish_cannot_publish_or_replace_a_slot() {
        cancelled_recording_retains_slot(&["stop", "finish"]);
    }
    #[test]
    fn finish_then_stop_is_terminal_before_publication() {
        cancelled_recording_retains_slot(&["finish", "stop"]);
        cancelled_recording_retains_slot(&["finish", "stop", "finish"]);
    }
    #[test]
    fn stale_finish_does_not_restore_a_cancelled_recording() {
        cancelled_recording_retains_slot(&["stop", "stale"]);
    }
    #[test]
    fn ordinary_finish_can_still_publish_the_original_recording() {
        let folder = tempfile::tempdir().unwrap();
        let mut profile = Profile::default();
        profile.profile_path = folder.path().to_str().unwrap().into();
        let settings = (1, json!({"generation":"original"}), profile);
        let mut state = recording_fixture();
        state.finish_recording("recording").unwrap();
        let bytes = voice_audio::wav(&[2; 480], 48_000);
        state
            .publish_recording(
                "recording",
                &settings,
                &settings,
                "f1".into(),
                bytes.clone(),
                false,
            )
            .unwrap();
        assert_eq!(std::fs::read(folder.path().join("f1.wav")).unwrap(), bytes);
    }
    fn prepared_fixture() -> Prepared {
        let profile = Profile::default();
        let pcm = PCM {
            samples: vec![0.25],
            rate: 48_000,
            peak: 0.25,
            clipped: 0,
            source_sha256: "source".into(),
            edited_pcm_sha256: "edited".into(),
        };
        let identity = audio_identity(&pcm, &profile, 1);
        let id = "11111111-1111-4111-8111-111111111111";
        Prepared {
            canonical: Canonical {
                worker: 1,
                module: json!({"context":id}),
                generation: id.into(),
                draft_id: id.into(),
                draft_revision: 1,
                settings_revision: 1,
                profile,
            },
            target: BoundVoiceTarget {
                schema_version: 1,
                output_intent: id.into(),
                target: crate::ptt_session::Target {
                    provider: "direct_agent".into(),
                    selection_id: id.into(),
                    selection_generation: 1,
                    worker_generation: 1,
                    connection_generation: 1,
                    control_revision: 1,
                    observation_revision: 1,
                    received_at_ms: 1,
                    radio_id: None,
                    tci: None,
                },
            },
            pcm,
            created: Instant::now(),
            identity,
        }
    }
    #[test]
    fn recording_finish_is_scoped_to_the_original_job_and_never_cancels_transmission() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let save = Arc::new(AtomicBool::new(false));
        let mut state = NativeState {
            job: Some(Job {
                id: "current".into(),
                kind: "recording",
                phase: "recording".into(),
                cancel: cancelled.clone(),
                save_recording: save.clone(),
                consumed: 0,
                total: 0,
            }),
            ..NativeState::default()
        };
        assert!(state.finish_recording("retired").is_err());
        assert!(!cancelled.load(Ordering::Acquire) && !save.load(Ordering::Acquire));
        state.finish_recording("current").unwrap();
        assert!(cancelled.load(Ordering::Acquire) && save.load(Ordering::Acquire));
        cancelled.store(false, Ordering::Release);
        save.store(false, Ordering::Release);
        state.job.as_mut().unwrap().kind = "transmit";
        assert!(state.finish_recording("current").is_err());
        assert!(!cancelled.load(Ordering::Acquire) && !save.load(Ordering::Acquire));
        assert!(serde_json::from_value::<NativeRequest>(json!({"action":"record_stop"})).is_err());
        assert!(serde_json::from_value::<NativeRequest>(
            json!({"action":"record_stop","actionID":"current"})
        )
        .is_ok());
    }
    #[test]
    fn recording_publication_rechecks_workspace_worker_and_stop_after_the_last_settings_read() {
        let original = (1, json!({"generation":"original"}), Profile::default());
        assert!(recording_publication(&original, &original, false, false).is_ok());
        assert!(recording_publication(&original, &original, true, true).is_ok());
        assert!(recording_publication(&original, &original, true, false).is_err());
        let mut replacement = original.clone();
        replacement.0 += 1;
        assert!(recording_publication(&original, &replacement, true, true).is_err());
        replacement = original.clone();
        replacement.1["generation"] = json!("replacement");
        assert!(recording_publication(&original, &replacement, false, false).is_err());
        replacement = original.clone();
        replacement.2.labels[0] = "Changed".into();
        assert!(recording_publication(&original, &replacement, false, false).is_err());
    }
    #[test]
    fn concurrent_preparation_of_one_intent_publishes_only_one_sendable_action() {
        let state = Mutex::new(NativeState {
            scope: "original".into(),
            ..NativeState::default()
        });
        let decoded = std::sync::Barrier::new(2);
        let replies = std::thread::scope(|scope| {
            let prepare = || {
                assert!(!state.lock().unwrap().intents.contains_key("one-intent"));
                let prepared = prepared_fixture();
                decoded.wait();
                state
                    .lock()
                    .unwrap()
                    .publish_preparation(
                        "original",
                        "one-intent",
                        uuid::Uuid::new_v4().to_string(),
                        1,
                        prepared,
                    )
                    .unwrap()
            };
            let first = scope.spawn(prepare);
            let second = scope.spawn(prepare);
            (first.join().unwrap(), second.join().unwrap())
        });
        assert_eq!(replies.0["actionID"], replies.1["actionID"]);
        assert_ne!(
            replies.0["duplicate"] == true,
            replies.1["duplicate"] == true
        );
        let state = state.lock().unwrap();
        assert_eq!(state.prepared.len(), 1);
        assert_eq!(state.intents.len(), 1);
    }
    #[test]
    fn decoded_preparation_cannot_publish_after_the_native_scope_changes() {
        let mut state = NativeState {
            scope: "replacement".into(),
            ..NativeState::default()
        };
        assert!(state
            .publish_preparation(
                "retired",
                "intent",
                uuid::Uuid::new_v4().to_string(),
                1,
                prepared_fixture()
            )
            .is_err());
        assert!(state.prepared.is_empty() && state.intents.is_empty());
        assert!(state
            .publish_preparation(
                "replacement",
                "intent",
                uuid::Uuid::new_v4().to_string(),
                1,
                prepared_fixture()
            )
            .is_ok());
    }
    #[test]
    fn normal_preparation_requires_the_settings_and_workspace_actually_reviewed_by_the_desk() {
        let canonical = prepared_fixture().canonical;
        assert!(reviewed_preparation(&canonical, 1, &canonical.generation).is_ok());
        assert!(reviewed_preparation(&canonical, 2, &canonical.generation).is_err());
        assert!(
            reviewed_preparation(&canonical, 1, "22222222-2222-4222-8222-222222222222").is_err()
        );
        assert!(serde_json::from_value::<NativeRequest>(
            json!({"action":"prepare","slot":1,"intentID":uuid::Uuid::new_v4().to_string()})
        )
        .is_err());
        assert!(serde_json::from_value::<NativeRequest>(
            json!({"action":"prepare","slot":1,"intentID":uuid::Uuid::new_v4().to_string(),
            "expectedRevision":1,"generation":canonical.generation})
        )
        .is_ok());
    }
    #[test]
    fn monitor_recording_and_import_require_the_reviewed_library_and_route_scope() {
        let generation = "11111111-1111-4111-8111-111111111111";
        let saved = json!({"revision":4,"generation":generation});
        assert!(require_reviewed_settings(&saved, 4, generation).is_ok());
        assert!(require_reviewed_settings(&saved, 3, generation).is_err());
        assert!(require_reviewed_settings(&saved, 4, "other-workspace").is_err());
        for action in ["preview", "record_start", "import"] {
            let mut request = json!({"action":action,"slot":1});
            if action != "preview" {
                request["overwrite"] = json!(false);
            }
            if action == "import" {
                request["wavBase64"] = json!("bounded input validated after scope admission");
            }
            assert!(serde_json::from_value::<NativeRequest>(request.clone()).is_err());
            request["expectedRevision"] = json!(4);
            request["generation"] = json!(generation);
            assert!(serde_json::from_value::<NativeRequest>(request.clone()).is_ok());
            request["profilePath"] = json!("/unreviewed");
            assert!(serde_json::from_value::<NativeRequest>(request).is_err());
        }
    }
    fn split_radio(provider: &str, receive_mode: &str, transmit_mode: &str) -> Value {
        json!({"provider":provider,"available":true,"snapshot":{"source":provider,"radio":{
            "connected":true,"observed":true,"mode":receive_mode,"receive_vfo":"A","transmit_vfo":"B",
            "vfos":[{"letter":"A","receive":true,"transmit":false,"mode":receive_mode},
                    {"letter":"B","receive":false,"transmit":true,"mode":transmit_mode}]}}})
    }
    #[test]
    fn phone_admission_uses_the_actual_transmit_vfo_for_flex_and_agent_split() {
        for provider in ["direct_flex_lan", "direct_agent"] {
            assert!(require_phone_transmit(&split_radio(provider, "USB", "CW")).is_err());
            assert!(require_phone_transmit(&split_radio(provider, "CW", "USB")).is_ok());
            for mode in ["LSB", "SSB", "PHONE"] {
                assert!(require_phone_transmit(&split_radio(provider, "CW", mode)).is_ok());
            }
            for mode in ["DIGU", "FM", "?", ""] {
                assert!(require_phone_transmit(&split_radio(provider, "USB", mode)).is_err());
            }
        }
    }
    #[test]
    fn phone_admission_rejects_absent_conflicting_or_unmarked_tx_evidence() {
        let base = split_radio("direct_agent", "USB", "USB");
        for (pointer, value) in [
            ("/snapshot/radio/transmit_vfo", Value::Null),
            ("/snapshot/radio/transmit_vfo", json!("C")),
            ("/snapshot/radio/vfos/1/transmit", json!(false)),
            ("/snapshot/radio/vfos/0/transmit", json!(true)),
            ("/snapshot/radio/vfos/1/mode", Value::Null),
            ("/snapshot/radio/vfos", json!([])),
            ("/snapshot/source", json!("direct_flex_lan")),
            ("/available", json!(false)),
            ("/snapshot/radio/observed", json!(false)),
        ] {
            let mut changed = base.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert!(require_phone_transmit(&changed).is_err(), "{pointer}");
        }
        // Hamlib has no admitted native voice PTT route. Its receive mode does
        // not become transmitter evidence through the general radio fallback.
        assert!(require_phone_transmit(&split_radio("hamlib", "USB", "USB")).is_err());
    }
    #[test]
    fn phone_admission_preserves_tci_addressed_modulation_without_a_vfo() {
        let mut tci = json!({"provider":"direct_tci","available":true,"snapshot":{
            "source":"direct_tci","tci":{"trx":0,"channel":1},"radio":{
            "connected":true,"observed":true,"mode":"USB","transmit_vfo":null,"vfos":[]}}});
        assert!(require_phone_transmit(&tci).is_ok());
        tci["snapshot"]["radio"]["mode"] = json!("CW");
        assert!(require_phone_transmit(&tci).is_err());
        tci["snapshot"]["radio"]["mode"] = json!("LSB");
        tci["snapshot"]["tci"]["trx"] = Value::Null;
        assert!(require_phone_transmit(&tci).is_err());
    }
    #[test]
    fn normal_context_never_uses_a_fake_contest_and_request_schema_rejects_audio_paths() {
        assert!(serde_json::from_value::<NativeRequest>(
            json!({"action":"send","actionID":uuid::Uuid::new_v4(),"profilePath":"/arbitrary"})
        )
        .is_err());
        assert!(serde_json::from_value::<NativeRequest>(
            json!({"action":"prepare","slot":1,"intentID":uuid::Uuid::new_v4(),"expectedRevision":1,"generation":uuid::Uuid::new_v4()})
        )
        .is_ok());
        assert!(phone(&json!("USB")));
        assert!(!phone(&json!("CW")));
        assert!(!phone(&Value::Null));
    }
    #[test]
    fn native_claim_requires_the_complete_canonical_payload_and_draft_before_any_output() {
        let admission:VoiceAdmission=serde_json::from_value(json!({"sessionID":"session","workspaceGeneration":"workspace","draftID":"draft","actionID":"op:0","payloadSHA256":"abc","manifestSHA256":"def"})).unwrap();
        let action = json!({"kind":"voice_keyer","signal":"phone","mode":"SSB","draftID":"draft","actionID":"op:0","payloadSHA256":"abc"});
        let mut effects = 0;
        assert!(
            validate_claimed_voice_actions(&[action.clone()], &[admission.clone()])
                .map(|_| {
                    effects += 1;
                })
                .is_ok()
        );
        let mut forged = action.clone();
        forged["payloadSHA256"] = json!("different");
        assert!(
            validate_claimed_voice_actions(&[forged], &[admission.clone()])
                .map(|_| {
                    effects += 1;
                })
                .is_err()
        );
        assert!(validate_claimed_voice_actions(
            &[action.clone(), action.clone()],
            &[admission.clone()]
        )
        .map(|_| {
            effects += 1;
        })
        .is_err());
        assert!(validate_claimed_voice_actions(
            &[action.clone(), action],
            &[admission.clone(), admission]
        )
        .map(|_| {
            effects += 1;
        })
        .is_err());
        assert_eq!(effects, 1);
    }
}
