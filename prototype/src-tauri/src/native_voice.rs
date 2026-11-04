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
        #[serde(rename = "intentID")]
        intent_id: String,
    },
    Send {
        #[serde(rename = "actionID")]
        action_id: String,
    },
    Preview {
        slot: usize,
    },
    Import {
        slot: usize,
        wav_base64: String,
        overwrite: bool,
    },
    RecordStart {
        slot: usize,
        overwrite: bool,
    },
    RecordStop,
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
        if let Some(job) = &s.job {
            job.save_recording.store(save, Ordering::Release);
            job.cancel.store(true, Ordering::Release);
        }
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
            | NativeRequest::RecordStop
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
        } => {
            if uuid::Uuid::parse_str(&intent_id).is_err() {
                return Err("Invalid voice intent identity.".into());
            }
            let canonical = canonical()?;
            focused(app, surface)?;
            {
                let mut s = state()
                    .lock()
                    .map_err(|_| "Native voice state unavailable")?;
                let scope = format!(
                    "{}/{}/{}",
                    canonical.worker, canonical.generation, canonical.module["context"]
                );
                if s.scope != scope {
                    if s.job.is_some() {
                        return Err("The previous voice owner is still stopping.".into());
                    }
                    s.scope = scope;
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
            let result = json!({"actionID":id,"durationMs":pcm.duration_ms(),"peak":pcm.peak,"clippedSamples":pcm.clipped,"slot":index,"audioIdentity":identity});
            let mut s = state()
                .lock()
                .map_err(|_| "Native voice state unavailable")?;
            require_generation(generation)?;
            s.prepared
                .retain(|_, p| p.created.elapsed() < Duration::from_secs(30));
            let retained_samples: usize = s.prepared.values().map(|p| p.pcm.samples.len()).sum();
            if s.prepared.len() >= 16
                || s.intents.len() >= 4096
                || retained_samples.saturating_add(pcm.samples.len()) > 32 * 1024 * 1024
            {
                return Err("Voice preparation/action journal is full; Stop clears prepared audio, and a deliberate workspace restart clears consumed intents.".into());
            }
            if s.job.is_some() {
                return Err("Voice audio is already active.".into());
            }
            s.intents.insert(intent_id.clone(), id.clone());
            s.prepared.insert(
                id,
                Prepared {
                    canonical,
                    target,
                    pcm,
                    created: Instant::now(),
                    identity,
                },
            );
            Ok(result)
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
        NativeRequest::Preview { slot: index } => {
            let (worker, saved, profile) = settings()?;
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
            wav_base64,
            overwrite,
        } => {
            let (_, _, profile) = settings()?;
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
            overwrite,
        } => {
            let (_, _, profile) = settings()?;
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
                let (_, _, current) = settings()?;
                if current != profile {
                    return Err("Voice library/routes changed during recording; the original slot was retained.".into());
                }
                profile_write(ProfileWriteRequest {
                    profile_path: profile.profile_path,
                    slot: name,
                    wav_base64: STANDARD.encode(bytes),
                    overwrite,
                })?;
                Ok(())
            })();
            finish(&result, false, None);
            result?;
            snapshot()
        }
        NativeRequest::RecordStop => {
            cancel(true);
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
            return Err("Contest voice preparation was retired by Stop; no audio was admitted.".into());
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
            json!({"action":"prepare","slot":1,"intentID":uuid::Uuid::new_v4()})
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
