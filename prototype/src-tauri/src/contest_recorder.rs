//! Application-lifetime recorder. Worker integration is metadata only and best effort.
use crate::contest_recorder_store::{self as store, Archive, Config, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::Manager;
pub const WINDOW: &str = "contest-recorder";
pub const MENU_ID: &str = "contest_recorder";
type Shared = Arc<Mutex<Archive>>;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Key {
    log_id: String,
    capture_id: String,
    root: PathBuf,
    #[serde(default)]
    started_utc_ms: u64,
    #[serde(default)]
    controlled_test: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    root: PathBuf,
    config: Option<Config>,
    captures: Vec<Key>,
}
struct Active {
    key: Key,
    archive: Shared,
    stop: Arc<AtomicBool>,
    frames: Arc<AtomicU64>,
    done: Arc<AtomicBool>,
    #[cfg(target_os = "macos")]
    peak: Arc<std::sync::atomic::AtomicU32>,
}
struct State {
    saved: Saved,
    active: Option<Active>,
    selected: Option<Key>,
    cache: BTreeMap<String, Shared>,
    selection: Value,
    error: String,
}
enum Notice {
    Marker(String, String, u64, u64),
    Confirmed(String),
}
pub struct Recorder {
    path: PathBuf,
    state: Mutex<State>,
    lifecycle: Mutex<()>,
    notices: mpsc::SyncSender<Notice>,
    playback_generation: Arc<AtomicU64>,
    reconciliation_cursor: AtomicU64,
    export_cancel: AtomicBool,
    export_running: AtomicBool,
    #[cfg(target_os = "macos")]
    playback: Mutex<Option<crate::contest_recorder_audio::Output>>,
    exiting: AtomicBool,
}
static OWNER: OnceLock<Arc<Recorder>> = OnceLock::new();
fn playback_epoch() -> Arc<AtomicU64> {
    static EPOCH: OnceLock<Arc<AtomicU64>> = OnceLock::new();
    EPOCH.get_or_init(|| Arc::new(AtomicU64::new(0))).clone()
}
fn existing() -> Option<&'static Arc<Recorder>> {
    OWNER.get()
}

pub fn observes(request: &Value) -> bool {
    request["method"]
        .as_str()
        .is_some_and(|m| m.starts_with("contest_") && m != "contest_recorder_changes")
}
pub fn admission(request: &Value) {
    let Some(owner) = existing() else {
        return;
    };
    admission_to(owner, request);
}

fn admission_to(owner: &Recorder, request: &Value) {
    if !matches!(request["method"].as_str(), Some("contest_qso_commit" | "contest_esm" | "contest_function_key")) {
        return;
    }
    let params = &request["params"];
    let (Some(log), Some(op)) = (params["sessionID"].as_str(), params["operationID"].as_str())
    else {
        return;
    };
    let Ok(state) = owner.state.try_lock() else {
        return;
    };
    if let Some(active) = state.active.as_ref().filter(|a| {
        a.key.log_id == log && !a.key.controlled_test && !a.done.load(Ordering::Acquire)
    }) {
        let _ = owner.notices.try_send(Notice::Marker(
            active.key.capture_id.clone(),
            op.into(),
            active.frames.load(Ordering::Acquire),
            store::utc_ms(),
        ));
    }
}
pub fn confirmed(request: &Value, response: &Result<Value>) {
    let Some(owner) = existing() else {
        return;
    };
    if !response.as_ref().is_ok_and(|v| v["ok"] == true) {
        return;
    }
    if matches!(
        request["method"].as_str(),
        Some(
            "contest_session_open"
                | "contest_open"
                | "contest_session_create"
                | "contest_create"
                | "contest_legacy_import"
        )
    ) {
        if let Some(log) = response
            .as_ref()
            .ok()
            .and_then(|v| v["result"]["projection"]["sessionID"].as_str())
        {
            if let Ok(s) = owner.state.try_lock() {
                if let Some(a) = s.active.as_ref().filter(|a| a.key.log_id != log) {
                    a.stop.store(true, Ordering::Release);
                    stop_replay();
                }
            }
            let _ = owner.notices.try_send(Notice::Confirmed(log.into()));
        }
    }
}
pub fn stop_replay() {
    // Even a Stop before owner initialization invalidates queued admissions.
    playback_epoch().fetch_add(1, Ordering::AcqRel);
    if let Some(owner) = existing() {
        #[cfg(target_os = "macos")]
        if let Ok(mut player) = owner.playback.try_lock() {
            *player = None;
        }
    }
}
#[tauri::command]
pub fn contest_recorder_stop_replay() {
    stop_replay();
}
pub fn shutdown() {
    if let Some(owner) = existing() {
        owner.exiting.store(true, Ordering::Release);
        stop_replay();
        let _ = owner.stop("stopped", "Application closed");
    }
}

/// Finalize the capture while its services still exist; a failed finalization
/// must be reported before the operating-module restart can proceed.
pub fn prepare_module_restart() -> Result<()> {
    if let Some(owner) = existing() {
        stop_replay();
        owner.stop("stopped", "Operating module changed")?;
    }
    Ok(())
}

fn owner(app: &tauri::AppHandle) -> Result<Arc<Recorder>> {
    if let Some(owner) = existing() {
        return Ok(owner.clone());
    }
    // All initializers serialize with the existing singleton-window creation owner.
    static INIT: Mutex<()> = Mutex::new(());
    let _init = INIT.lock().map_err(|_| "Recorder unavailable")?;
    if let Some(owner) = existing() {
        return Ok(owner.clone());
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("Contesting");
    store::safe_path(&directory)?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("recorder.json");
    let saved: Saved = if path.exists() {
        serde_json::from_reader(store::regular(&path)?)
            .map_err(|e| format!("Recorder settings retained but invalid: {e}"))?
    } else {
        let root = directory.join("Recordings");
        std::fs::create_dir(&root)
            .or_else(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    Ok(())
                } else {
                    Err(e)
                }
            })
            .map_err(|e| e.to_string())?;
        Saved {
            root,
            config: None,
            captures: vec![],
        }
    };
    store::safe_path(&saved.root)?;
    if saved.captures.len() > 10000 {
        return Err("Recorder catalog limit reached; existing archives retained".into());
    }
    let (tx, rx) = mpsc::sync_channel(256);
    let recorder = Arc::new(Recorder {
        path,
        state: Mutex::new(State {
            saved,
            active: None,
            selected: None,
            cache: BTreeMap::new(),
            selection: Value::Null,
            error: String::new(),
        }),
        lifecycle: Mutex::new(()),
        notices: tx,
        playback_generation: playback_epoch(),
        reconciliation_cursor: AtomicU64::new(0),
        export_cancel: AtomicBool::new(false),
        export_running: AtomicBool::new(false),
        #[cfg(target_os = "macos")]
        playback: Mutex::new(None),
        exiting: AtomicBool::new(false),
    });
    let _ = OWNER.set(recorder.clone());
    // Known recorder catalog only. Recovery never opens an input or output device.
    let keys = recorder
        .state
        .lock()
        .map_err(|_| "Recorder unavailable")?
        .saved
        .captures
        .clone();
    for key in &keys {
        match recorder.archive(key) {
            Ok(a) => {
                let mut a = a.lock().map_err(|_| "Archive unavailable")?;
                if matches!(
                    a.manifest.status.as_str(),
                    "recording" | "starting" | "recovery required"
                ) {
                    if let Err(e) = a.recover() {
                        recorder.error(format!("Recovery required for {}: {e}", key.capture_id));
                    }
                }
            }
            Err(e) => recorder.error(e),
        }
    }
    recorder
        .state
        .lock()
        .map_err(|_| "Recorder unavailable")?
        .selected = keys.last().cloned();
    let safety = Arc::downgrade(&recorder);
    std::thread::spawn(move || {
        while let Some(owner) = safety.upgrade() {
            if owner.exiting.load(Ordering::Acquire) {
                break;
            }
            owner.monitor_listening();
            std::thread::sleep(Duration::from_millis(50));
        }
    });
    let weak = Arc::downgrade(&recorder);
    std::thread::spawn(move || {
        let mut markers: BTreeMap<String, BTreeMap<String, (u64, u64)>> = BTreeMap::new();
        let mut last = Instant::now();
        while let Some(owner) = weak.upgrade() {
            if owner.exiting.load(Ordering::Acquire) {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Notice::Marker(capture, op, frame, utc)) => {
                    // Admissions are also journaled in their original capture, including
                    // notices dequeued after Pause/Start changed the active handle.
                    if !markers.contains_key(&capture) && markers.len() >= 64 {
                        markers.clear();
                    }
                    let map = markers.entry(capture.clone()).or_default();
                    if map.len() < 50000 {
                        map.entry(op.clone()).or_insert((frame, utc));
                    }
                    let key = owner.state.lock().ok().and_then(|s| {
                        s.saved
                            .captures
                            .iter()
                            .find(|k| k.capture_id == capture)
                            .cloned()
                    });
                    let archive = key.and_then(|k| owner.archive(&k).ok());
                    if let Some(archive) = archive {
                        let result=archive.lock().map_err(|_|"Archive unavailable".to_string()).and_then(|mut a|a.event(json!({"type":"admission","operationID":op,"frame":frame,"utcMs":utc})));
                        if let Err(e) = result {
                            owner.error(e);
                        }
                    }
                }
                Ok(Notice::Confirmed(log)) => {
                    let active = owner.state.lock().ok().and_then(|s| {
                        s.active
                            .as_ref()
                            .map(|a| (a.key.log_id.clone(), a.stop.clone()))
                    });
                    if let Some((old, stop)) = active {
                        if old != log {
                            stop.store(true, Ordering::Release);
                            stop_replay();
                        }
                    }
                }
                _ => {}
            }
            if last.elapsed() >= Duration::from_secs(1) {
                last = Instant::now();
                if let Err(e) = owner.catch_up(&markers) {
                    owner.error(format!("Audio linking degraded: {e}"));
                }
            }
        }
    });
    Ok(recorder)
}
/// Retained observations only; never starts a station poller or issues RX/PTT-off.
fn observed_transmit() -> bool {
    any_transmit(&crate::station_telemetry::retained_snapshots())
}
fn any_transmit(snapshots: &[Value]) -> bool {
    fn tx(value: &Value) -> bool {
        match value {
            Value::Object(map) => map.iter().any(|(k, v)| {
                ((k == "transmitting" || k == "output_active") && v == true) || tx(v)
            }),
            Value::Array(a) => a.iter().any(tx),
            _ => false,
        }
    }
    snapshots.iter().any(tx)
}
impl Recorder {
    fn monitor_listening(&self) {
        if observed_transmit() {
            stop_replay();
        }
        #[cfg(target_os = "macos")]
        if let Ok(mut player) = self.playback.try_lock() {
            if player
                .as_ref()
                .is_some_and(|p| !crate::contest_recorder_audio::output_unchanged(p))
            {
                self.playback_generation.fetch_add(1, Ordering::AcqRel);
                *player = None;
                self.error(
                    "Listening route lost or format changed; replay stopped, capture continues"
                        .into(),
                );
            }
            if player
                .as_ref()
                .is_some_and(|p| p.done.load(Ordering::Acquire))
            {
                if let Some(error) = player.as_mut().and_then(|p| p.failures.pop().ok()) {
                    self.error(format!("Listening output failed: {error}; replay stopped, capture continues"));
                }
                *player = None;
            }
        }
    }
    fn error(&self, message: String) {
        if let Ok(mut s) = self.state.lock() {
            s.error = message;
        }
    }
    fn archive(&self, key: &Key) -> Result<Shared> {
        let mut s = self.state.lock().map_err(|_| "Recorder unavailable")?;
        if let Some(a) = s.cache.get(&key.capture_id) {
            return Ok(a.clone());
        }
        if !s
            .saved
            .captures
            .iter()
            .any(|k| k.log_id == key.log_id && k.capture_id == key.capture_id && k.root == key.root)
        {
            return Err("Unknown recorder archive".into());
        }
        let a = Arc::new(Mutex::new(Archive::load(
            &key.root,
            &key.log_id,
            &key.capture_id,
        )?));
        if s.cache.len() >= 3 {
            let active = s.active.as_ref().map(|a| a.key.capture_id.clone());
            let victim = s
                .cache
                .keys()
                .find(|id| Some(*id) != active.as_ref())
                .cloned();
            if let Some(id) = victim {
                s.cache.remove(&id);
            }
        }
        s.cache.insert(key.capture_id.clone(), a.clone());
        Ok(a)
    }
    fn catch_up(&self, markers: &BTreeMap<String, BTreeMap<String, (u64, u64)>>) -> Result<()> {
        if let Ok(context) = crate::contest_window_context::active() {
            if let Ok(s) = self.state.lock() {
                if let Some(active) = &s.active {
                    if active.key.log_id != context.session_id {
                        active.stop.store(true, Ordering::Release);
                        stop_replay();
                    }
                }
            }
        }
        self.reconcile_keys(self.reconciliation_keys()?, markers, |request| {
            crate::worker::request_existing(request)
        })
    }
    fn reconciliation_keys(&self) -> Result<Vec<Key>> {
        let keys = {
            let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            let mut keys = vec![];
            if let Some(a) = &s.active {
                keys.push(a.key.clone());
            }
            if let Some(k) = &s.selected {
                if !keys.iter().any(|a| a.capture_id == k.capture_id) {
                    keys.push(k.clone());
                }
            }
            // Two historical captures per turn prevent receipts/corrections from
            // being stranded when active and selected both move to a newer epoch.
            let history: Vec<_> = s
                .saved
                .captures
                .iter()
                .filter(|k| !k.controlled_test)
                .collect();
            let cursor = self.reconciliation_cursor.fetch_add(2, Ordering::Relaxed) as usize;
            for offset in 0..history.len().min(2) {
                let k = history[(cursor + offset) % history.len()];
                if !keys.iter().any(|a| a.capture_id == k.capture_id) {
                    keys.push(k.clone());
                }
            }
            keys
        };
        Ok(keys)
    }
    fn reconcile_keys(
        &self,
        keys: Vec<Key>,
        markers: &BTreeMap<String, BTreeMap<String, (u64, u64)>>,
        mut read: impl FnMut(Value) -> Result<Value>,
    ) -> Result<()> {
        for key in keys {
            if key.controlled_test {
                continue;
            }
            let a = self.archive(&key)?;
            let cursor = a.lock().map_err(|_| "Archive unavailable")?.manifest.cursor;
            let response = read(
                json!({"id":uuid::Uuid::new_v4().to_string(),"method":"contest_recorder_changes","params":{"sessionID":key.log_id,"afterSequence":cursor,"limit":200}}),
            )?;
            if response["ok"] != true {
                return Err(response["error"]["message"]
                    .as_str()
                    .unwrap_or("Audit reader unavailable")
                    .into());
            }
            let empty = BTreeMap::new();
            a.lock().map_err(|_| "Archive unavailable")?.reconcile(
                &response["result"],
                markers.get(&key.capture_id).unwrap_or(&empty),
            )?;
        }
        Ok(())
    }
    fn selected(&self) -> Result<Shared> {
        let key = self
            .state
            .lock()
            .map_err(|_| "Recorder unavailable")?
            .selected
            .clone()
            .ok_or("Select an archive")?;
        self.archive(&key)
    }
    fn stop(&self, status: &str, reason: &str) -> Result<()> {
        let active = {
            let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            s.active
                .as_ref()
                .map(|a| (a.stop.clone(), a.done.clone(), a.archive.clone()))
        };
        if let Some((stop, done, a)) = active {
            stop.store(true, Ordering::Release);
            let deadline = Instant::now() + Duration::from_secs(2);
            while !done.load(Ordering::Acquire) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(5));
            }
            if !done.load(Ordering::Acquire) {
                return Err(
                    "Recorder finalization is still pending; partial tail remains recoverable"
                        .into(),
                );
            }
            let mut a = a.lock().map_err(|_| "Archive unavailable")?;
            if a.manifest.status == "stopped" {
                a.finish(status, Some(reason))?;
            }
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    fn start(&self, log: &str, generation: &str, test: bool) -> Result<()> {
        let _life = self
            .lifecycle
            .lock()
            .map_err(|_| "Recorder lifecycle unavailable")?;
        crate::contest_window_context::resolve(log, generation)?;
        {
            let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            if s.active
                .as_ref()
                .is_some_and(|a| !a.done.load(Ordering::Acquire))
            {
                return Err("A recorder is already active; stop it before starting another".into());
            }
        }
        let (mut root, config) = {
            let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            (
                s.saved.root.clone(),
                s.saved
                    .config
                    .clone()
                    .ok_or("Save explicit recorder settings first")?,
            )
        };
        crate::contest_recorder_audio::validate(&config)?;
        if test {
            root = root.join("Tests");
            store::safe_path(&root)?;
            std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        }
        let mut archive = Archive::create(&root, log, config.clone())?;
        archive.manifest.controlled_test = test;
        archive.checkpoint()?;
        let key = Key {
            log_id: log.into(),
            capture_id: archive.manifest.capture_id.clone(),
            root,
            started_utc_ms: archive.manifest.start_utc_ms,
            controlled_test: test,
        };
        let a = Arc::new(Mutex::new(archive));
        let stop = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        // Publish the catalog before opening the source: a crash cannot orphan media.
        {
            let mut s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            s.saved.captures.push(key.clone());
            store::atomic_json(&self.path, &s.saved)?;
            s.selected = Some(key.clone());
            s.cache.clear();
            s.cache.insert(key.capture_id.clone(), a.clone());
        }
        let mut input = match crate::contest_recorder_audio::input(&config) {
            Ok(input) => input,
            Err(e) => {
                a.lock().unwrap().finish("faulted", Some(&e))?;
                return Err(e);
            }
        };
        let frames = input.health.frames.clone();
        {
            let mut s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            s.active = Some(Active {
                key,
                archive: a.clone(),
                stop: stop.clone(),
                frames: frames.clone(),
                done: done.clone(),
                peak: input.health.peak.clone(),
            });
            s.error.clear();
        }
        std::thread::spawn(move || {
            let mut last_checkpoint = Instant::now();
            let began = Instant::now();
            let wall = store::utc_ms();
            let mut last_block = 0;
            let mut first = true;
            #[cfg(unix)]
            let volume = {
                use std::os::unix::fs::MetadataExt;
                std::fs::metadata(&a.lock().unwrap().dir)
                    .map(|m| m.dev())
                    .ok()
            };
            let mut run = || -> Result<()> {
                loop {
                    let stopping = stop.load(Ordering::Acquire)
                        || (test && began.elapsed() > Duration::from_secs(10));
                    if stopping && !input.health.stop.swap(true, Ordering::AcqRel) {
                        use cpal::traits::StreamTrait;
                        input._stream.pause().map_err(|e| e.to_string())?;
                    }
                    if input.health.failed.load(Ordering::Acquire) {
                        return Err("Input device/format lost or bounded writer queue overrun; unknown missing frames; explicit Start required".into());
                    }
                    while let Ok(block) = input.queue.pop() {
                        let mut archive = a.lock().map_err(|_| "Archive writer unavailable")?;
                        if block.first_frame != archive.manifest.frames {
                            return Err("Noncontinuous input frame sequence".into());
                        }
                        if !first && block.elapsed_ms.saturating_sub(last_block) > 2000 {
                            return Err("Capture callback interruption / sleep; unknown gap; start a new epoch".into());
                        }
                        if first {
                            archive.manifest.start_utc_ms = wall + block.elapsed_ms;
                            first = false;
                        }
                        last_block = block.elapsed_ms;
                        archive.append(&block.samples[..block.len])?;
                    }
                    if stopping {
                        break;
                    }
                    if input.clock.elapsed().as_millis() as u64
                        > input.health.last_ms.load(Ordering::Acquire) + 2000
                    {
                        return Err("No advancing input callbacks; input interrupted".into());
                    }
                    if last_checkpoint.elapsed() >= Duration::from_secs(1) {
                        last_checkpoint = Instant::now();
                        let mut archive = a.lock().map_err(|_| "Archive writer unavailable")?;
                        crate::contest_recorder_audio::validate_input(&config)?;
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::MetadataExt;
                            if std::fs::metadata(&archive.dir).map(|m| m.dev()).ok() != volume {
                                return Err(
                                    "Destination volume disappeared; no alternate path is allowed"
                                        .into(),
                                );
                            }
                        }
                        if store::free_bytes(&archive.dir)? < config.reserve() {
                            return Err("Disk low: protected reserve reached; originals retained, no pruning".into());
                        }
                        if store::utc_ms().abs_diff(wall + began.elapsed().as_millis() as u64)
                            > 1000
                        {
                            return Err("UTC clock discontinuity; prior sample mapping retained; start a new epoch".into());
                        }
                        archive.flush_tail()?;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                Ok(())
            };
            let result = run();
            input.health.stop.store(true, Ordering::Release);
            drop(input);
            if let Err(ref e) = result {
                if let Some(owner) = existing() {
                    owner.error(e.clone());
                }
            }
            if let Ok(mut archive) = a.lock() {
                let final_result = match result {
                    Ok(()) => archive.finish("stopped", None),
                    Err(ref e) => archive.finish("interrupted", Some(e)),
                };
                if let Err(e) = final_result {
                    archive.manifest.status = "recovery required".into();
                    let _ = archive.event(json!({"type":"writer-fault","message":e}));
                }
            }
            done.store(true, Ordering::Release);
        });
        Ok(())
    }
    fn status(&self) -> Result<Value> {
        let (config, root, keys, selected, selection, mut error, active) = {
            let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            (
                s.saved.config.clone(),
                s.saved.root.clone(),
                s.saved.captures.clone(),
                s.selected.clone(),
                s.selection.clone(),
                s.error.clone(),
                s.active
                    .as_ref()
                    .map(|a| (a.archive.clone(), a.done.load(Ordering::Acquire))),
            )
        };
        let archive = match selected.as_ref().map(|k| self.archive(k)).transpose() {
            Ok(a) => a,
            Err(e) => {
                error = e;
                None
            }
        };
        let details = if let Some(a) = archive {
            let deadline = Instant::now() + Duration::from_millis(100);
            let a = loop {
                if let Ok(a) = a.try_lock() {
                    break a;
                }
                if Instant::now() >= deadline {
                    return Err(
                        "Recorder writer busy/blocked; no fresh recording-health proof".into(),
                    );
                }
                std::thread::sleep(Duration::from_millis(5));
            };
            json!({"manifest":a.manifest,"bookmarks":[],"bookmarkCount":a.links.len()})
        } else {
            Value::Null
        };
        #[cfg(target_os = "macos")]
        let permission = crate::contest_recorder_audio::permission();
        #[cfg(not(target_os = "macos"))]
        let permission = "Native capture is available on macOS only";
        #[cfg(target_os = "macos")]
        let level = self.state.lock().ok().and_then(|s| {
            s.active
                .as_ref()
                .map(|a| a.peak.load(Ordering::Relaxed) as f64 / 32768.0)
        });
        #[cfg(not(target_os = "macos"))]
        let level: Option<f64> = None;
        let active=active.map(|(a,done)|->Result<Value>{let a=a.try_lock().map_err(|_|"Recorder writer busy; recording health unavailable")?;Ok(json!({"logId":a.manifest.log_id,"captureId":a.manifest.capture_id,"status":a.manifest.status,"inputState":if done{"Stopped"}else if a.manifest.frames==0{"Starting — waiting for samples"}else if level.unwrap_or(0.0)<0.001{"Input silent — valid callbacks"}else{"Input present"},"inputLevel":level,"frames":a.manifest.frames,"savedFrames":a.manifest.saved_frames,"startUtcMs":a.manifest.start_utc_ms,"rate":a.manifest.config.rate,"roles":a.manifest.config.roles,"finished":done}))}).transpose()?;
        #[cfg(target_os="macos")]let playback=self.playback.lock().ok().and_then(|p|p.as_ref().map(|p|json!({"position":p.cursor.load(Ordering::Acquire),"frames":p.frames,"rate":p.rate,"paused":p.paused.load(Ordering::Acquire),"underruns":p.underruns.load(Ordering::Relaxed)})));
        #[cfg(not(target_os = "macos"))]
        let playback: Option<Value> = None;
        let context = crate::contest_window_context::active()
            .ok()
            .map(|c| json!({"logId":c.session_id,"workspaceGeneration":c.workspace_generation}));
        Ok(
            json!({"context":context,"config":config,"root":root,"freeBytes":store::free_bytes(&root).ok(),"captures":keys,"selected":details,"selection":selection,"active":active,"permission":permission,"error":error,"playback":playback,"stationState":if observed_transmit(){"Transmit observed — replay stopped"}else{"Listening route must be verified; station receive state may be unknown"}}),
        )
    }
}

pub fn validate_request(label: &str, request: &Value) -> Result<&'static str> {
    let action = request["action"]
        .as_str()
        .ok_or("Missing recorder action")?;
    let allowed: &[&str] = match action {
        "status" | "devices" | "stop_replay" | "pause_replay" | "choose_root" | "recover"
        | "cancel_export" => &["action"],
        "configure" => &["action", "config"],
        "listening" => &["action", "outputId", "routeVerified"],
        "start" | "record_test" => &["action", "logId", "workspaceGeneration"],
        "stop" | "pause" => &["action", "captureId"],
        "bookmark" => &["action", "captureId", "note"],
        "select" => &["action", "logId", "captureId", "qsoId"],
        "links" => &["action", "logId", "qsoIds"],
        "bookmarks" => &["action", "logId", "captureId", "offset", "limit", "query"],
        "prepare" => &["action", "logId", "qsoId", "fromUtcMs", "toUtcMs"],
        "replay_recent" => &[
            "action",
            "lastSeconds",
            "channel",
            "outputChannel",
            "volume",
        ],
        "replay" => &[
            "action",
            "logId",
            "captureId",
            "lastSeconds",
            "startFrame",
            "endFrame",
            "channel",
            "outputChannel",
            "volume",
        ],
        "seek" => &["action", "frame"],
        "volume" => &["action", "value"],
        "export" => &["action", "includeNotes"],
        _ => return Err("Unsupported recorder action".into()),
    };
    if request.to_string().len() > 32768
        || !request
            .as_object()
            .is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str())))
    {
        return Err("Unexpected recorder parameters".into());
    }
    let role = crate::workspace_windows::surface_role(label);
    if !matches!(label, "contest-setup" | WINDOW | "contest-analytics")
        && !matches!(role, "contest--active-qso" | "contest--logbook")
    {
        return Err("This window cannot access contest recordings".into());
    }
    if matches!(
        action,
        "configure"
            | "listening"
            | "choose_root"
            | "start"
            | "record_test"
            | "recover"
            | "export"
            | "cancel_export"
    ) && label != WINDOW
    {
        return Err("Open Contest → Recorder for this action".into());
    }
    if label == "contest-analytics"
        && !matches!(
            action,
            "status" | "links" | "prepare" | "select" | "stop_replay"
        )
    {
        return Err("Analytics audio actions are read-only".into());
    }
    Ok(match action {
        "status" => "status",
        "devices" => "devices",
        "stop_replay" => "stop_replay",
        "pause_replay" => "pause_replay",
        "choose_root" => "choose_root",
        "recover" => "recover",
        "configure" => "configure",
        "listening" => "listening",
        "start" => "start",
        "record_test" => "record_test",
        "stop" => "stop",
        "pause" => "pause",
        "bookmark" => "bookmark",
        "select" => "select",
        "links" => "links",
        "bookmarks" => "bookmarks",
        "prepare" => "prepare",
        "replay" => "replay",
        "replay_recent" => "replay_recent",
        "seek" => "seek",
        "volume" => "volume",
        "export" => "export",
        "cancel_export" => "cancel_export",
        _ => unreachable!(),
    })
}

#[tauri::command]
pub async fn contest_recorder_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::acceptance::Acceptance>,
    mut request: Value,
) -> Result<Value> {
    let action = validate_request(window.label(), &request)?;
    // Ticket is acquired before initialization or queued blocking work.
    let ticket = matches!(action, "replay" | "replay_recent")
        .then(|| playback_epoch().fetch_add(1, Ordering::AcqRel) + 1);
    if action == "stop_replay" {
        stop_replay();
        return Ok(json!({"stopped":true}));
    }
    if crate::APP_EXITING.load(Ordering::Acquire) {
        return Err("Recorder is shutting down".into());
    }
    let isolated = crate::runtime_profile::isolated(state.path.is_some());
    if isolated
        && matches!(
            action,
            "start"
                | "record_test"
                | "replay"
                | "replay_recent"
                | "configure"
                | "listening"
                | "choose_root"
                | "export"
        )
    {
        return Err("Real audio/storage setup is disabled in isolated acceptance".into());
    }
    let recorder = owner(&app)?;
    if let Some(ticket) = ticket {
        let context = if action == "replay_recent" {
            Some(crate::contest_window_context::active()?.session_id)
        } else {
            None
        };
        recorder.admit_replay(&mut request, ticket, context.as_deref())?;
    }
    if action == "cancel_export" {
        recorder.export_cancel.store(true, Ordering::Release);
        return Ok(json!({"cancelRequested":true}));
    }
    if matches!(action, "choose_root" | "export") {
        let directory = choose_directory(window, action == "export").await?;
        let Some(directory) = directory else {
            return Ok(json!({"cancelled":true}));
        };
        return tauri::async_runtime::spawn_blocking(move ||{
            store::safe_path(&directory)?;
            if action=="choose_root"{let _life=recorder.lifecycle.lock().map_err(|_|"Recorder lifecycle unavailable")?;let mut s=recorder.state.lock().map_err(|_|"Recorder unavailable")?;
                if s.active.as_ref().is_some_and(|a|!a.done.load(Ordering::Acquire)){return Err("Stop capture before changing storage".into());}
                s.saved.root=directory;store::atomic_json(&recorder.path,&s.saved)?;Ok(json!({"saved":true}))
            }else{if recorder.export_running.swap(true,Ordering::AcqRel){return Err("An archive export is already running".into());}recorder.export_cancel.store(false,Ordering::Release);
                let result=(|| {let a=recorder.selected()?;let snapshot=a.lock().map_err(|_|"Archive unavailable")?.snapshot();Ok(json!({"saved":true,"path":snapshot.export_cancellable(&directory,request["includeNotes"]==true,&recorder.export_cancel)?}))})();recorder.export_running.store(false,Ordering::Release);result}
        }).await.map_err(|_|"Recorder export task failed".to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || recorder.dispatch(action, request))
        .await
        .map_err(|_| "Recorder task failed".to_string())?
}
impl Recorder {
    fn dispatch(&self, action: &str, r: Value) -> Result<Value> {
        match action {
            "status" => self.status(),
            "devices" => {
                #[cfg(target_os = "macos")]
                {
                    crate::contest_recorder_audio::devices()
                }
                #[cfg(not(target_os = "macos"))]
                {
                    Ok(json!([]))
                }
            }
            "listening" => {
                let output = r["outputId"]
                    .as_str()
                    .filter(|v| !v.is_empty() && v.len() <= 512)
                    .ok_or("Choose an exact listening output")?;
                if r["routeVerified"] != true {
                    return Err("Verify the physical headset/listening route before saving".into());
                }
                #[cfg(target_os = "macos")]
                crate::contest_recorder_audio::validate_listening(output)?;
                stop_replay();
                let mut s = self.state.lock().map_err(|_| "Recorder unavailable")?;
                let config = s
                    .saved
                    .config
                    .as_mut()
                    .ok_or("Save initial recorder setup first")?;
                config.output_id = output.into();
                config.route_verified = true;
                store::atomic_json(&self.path, &s.saved)?;
                Ok(json!({"saved":true}))
            }
            "configure" => {
                let config: Config =
                    serde_json::from_value(r["config"].clone()).map_err(|e| e.to_string())?;
                config.validate()?;
                #[cfg(target_os = "macos")]
                crate::contest_recorder_audio::validate(&config)?;
                let _life = self
                    .lifecycle
                    .lock()
                    .map_err(|_| "Recorder lifecycle unavailable")?;
                let mut s = self.state.lock().map_err(|_| "Recorder unavailable")?;
                if s.active
                    .as_ref()
                    .is_some_and(|a| !a.done.load(Ordering::Acquire))
                {
                    return Err("Stop capture before changing its source/mapping".into());
                }
                s.saved.config = Some(config);
                store::atomic_json(&self.path, &s.saved)?;
                Ok(json!({"saved":true}))
            }
            "start" | "record_test" => {
                #[cfg(target_os = "macos")]
                self.start(
                    r["logId"].as_str().ok_or("Select an active contest")?,
                    r["workspaceGeneration"]
                        .as_str()
                        .ok_or("Missing workspace fence")?,
                    action == "record_test",
                )?;
                #[cfg(not(target_os = "macos"))]
                return Err("Native capture is available on macOS only".into());
                #[allow(unreachable_code)]
                Ok(json!({"started":true}))
            }
            "stop" | "pause" | "bookmark" => {
                let _life = self
                    .lifecycle
                    .lock()
                    .map_err(|_| "Recorder lifecycle unavailable")?;
                let (id, a) = {
                    let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
                    let a = s.active.as_ref().ok_or("No active recorder")?;
                    (a.key.capture_id.clone(), a.archive.clone())
                };
                if r["captureId"] != id {
                    return Err("Recorder changed; refresh before this action".into());
                }
                if action == "bookmark" {
                    if self
                        .state
                        .lock()
                        .map_err(|_| "Recorder unavailable")?
                        .active
                        .as_ref()
                        .is_none_or(|a| a.done.load(Ordering::Acquire))
                    {
                        return Err("No advancing capture for Bookmark now".into());
                    }
                    let link = a
                        .lock()
                        .map_err(|_| "Archive unavailable")?
                        .manual(r["note"].as_str().unwrap_or(""))?;
                    Ok(json!(link))
                } else {
                    self.stop(
                        if action == "pause" {
                            "paused"
                        } else {
                            "stopped"
                        },
                        if action == "pause" {
                            "Operator paused; resume starts a new capture epoch"
                        } else {
                            "Operator stopped"
                        },
                    )?;
                    Ok(json!({"stopped":true}))
                }
            }
            "select" => {
                let log = r["logId"].as_str().ok_or("Missing log ID")?;
                let capture = r["captureId"].as_str().ok_or("Missing capture ID")?;
                let key = {
                    let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
                    s.saved
                        .captures
                        .iter()
                        .find(|k| k.log_id == log && k.capture_id == capture)
                        .cloned()
                        .ok_or("No archive for this log/capture")?
                };
                self.archive(&key)?;
                stop_replay();
                let mut s = self.state.lock().map_err(|_| "Recorder unavailable")?;
                s.selected = Some(key);
                s.selection = Value::Null;
                drop(s);
                self.status()
            }
            "bookmarks" => {
                let a = self.selected()?;
                let a = a.lock().map_err(|_| "Archive unavailable")?.snapshot();
                if r["logId"] != a.manifest.log_id || r["captureId"] != a.manifest.capture_id {
                    return Err("Bookmark scope changed; refresh".into());
                }
                let offset = r["offset"]
                    .as_u64()
                    .filter(|n| *n <= 50000)
                    .ok_or("Invalid bookmark page")? as usize;
                let limit = r["limit"]
                    .as_u64()
                    .filter(|n| (1..=100).contains(n))
                    .ok_or("Choose up to 100 bookmarks")? as usize;
                let query = r["query"]
                    .as_str()
                    .filter(|q| q.len() <= 128)
                    .ok_or("Bookmark search is too long")?
                    .to_lowercase();
                let mut links: Vec<_> = a
                    .links
                    .values()
                    .filter(|l| {
                        format!("{} {}", l.current["Call"].as_str().unwrap_or(""), l.note)
                            .to_lowercase()
                            .contains(&query)
                    })
                    .collect();
                links.sort_unstable_by_key(|l| std::cmp::Reverse((l.frame, l.id.as_str())));
                let total = links.len();
                let rows: Vec<_> = links
                    .into_iter()
                    .skip(offset)
                    .take(limit)
                    .map(|l| {
                        let mut value = serde_json::to_value(l).unwrap();
                        value["coverage"] = json!(if l.deleted {
                            "tombstoned".into()
                        } else {
                            a.coverage(
                                l.frame.saturating_sub(
                                    a.manifest.config.pre_seconds as u64
                                        * a.manifest.config.rate as u64,
                                ),
                                l.frame
                                    + a.manifest.config.post_seconds as u64
                                        * a.manifest.config.rate as u64,
                            )
                        });
                        value
                    })
                    .collect();
                Ok(json!({"total":total,"offset":offset,"rows":rows}))
            }
            "links" => {
                let log = r["logId"].as_str().ok_or("Missing log identity")?;
                store::uuid(log)?;
                let ids = r["qsoIds"]
                    .as_array()
                    .filter(|v| v.len() <= 500)
                    .ok_or("Query up to 500 visible contacts")?;
                let mut result = serde_json::Map::new();
                let keys = {
                    let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
                    s.saved
                        .captures
                        .iter()
                        .filter(|k| k.log_id == log && !k.controlled_test)
                        .cloned()
                        .collect::<Vec<_>>()
                };
                for id in ids {
                    let id = id.as_str().ok_or("Invalid QSO identity")?;
                    store::uuid(id)?;
                    result.insert(
                        id.into(),
                        json!({"status":"recorder off / no matching local archive"}),
                    );
                }
                for key in keys {
                    let a = self.archive(&key)?;
                    let a = a.lock().map_err(|_| "Archive unavailable")?.snapshot();
                    for id in ids {
                        let id = id.as_str().unwrap();
                        if let Some(link) = a.links.get(id) {
                            result.insert(id.into(),json!({"status":if link.deleted{"tombstoned".into()}else{a.coverage(link.frame.saturating_sub(a.manifest.config.pre_seconds as u64*a.manifest.config.rate as u64),link.frame+a.manifest.config.post_seconds as u64*a.manifest.config.rate as u64)},"captureId":key.capture_id,"basis":link.basis}));
                        }
                    }
                }
                Ok(Value::Object(result))
            }
            "prepare" => self.prepare(&r),
            "recover" => {
                let _life = self
                    .lifecycle
                    .lock()
                    .map_err(|_| "Recorder lifecycle unavailable")?;
                let a = self.selected()?;
                if self
                    .state
                    .lock()
                    .map_err(|_| "Recorder unavailable")?
                    .active
                    .as_ref()
                    .is_some_and(|active| {
                        Arc::ptr_eq(&active.archive, &a) && !active.done.load(Ordering::Acquire)
                    })
                {
                    return Err("Stop capture before repairing its archive".into());
                }
                let mut a = a.lock().map_err(|_| "Archive unavailable")?;
                if matches!(
                    a.manifest.status.as_str(),
                    "recording" | "starting" | "interrupted" | "recovery required"
                ) {
                    a.recover()?;
                }
                Ok(json!({"recovered":true}))
            }
            "replay" | "replay_recent" => self.replay(&r),
            "pause_replay" | "seek" | "volume" => {
                #[cfg(target_os = "macos")]
                {
                    let mut p = self
                        .playback
                        .lock()
                        .map_err(|_| "Listening player unavailable")?;
                    let p = p.as_mut().ok_or("No replay is active")?;
                    if action == "pause_replay" {
                        p.paused.fetch_xor(true, Ordering::AcqRel);
                    } else if action == "volume" {
                        let value = r["value"]
                            .as_f64()
                            .filter(|v| v.is_finite() && (0.0..=0.5).contains(v))
                            .ok_or("Invalid listening volume")?;
                        p.volume.store((value as f32).to_bits(), Ordering::Release);
                    } else {
                        let frame = r["frame"]
                            .as_u64()
                            .filter(|n| *n < p.frames)
                            .ok_or("Seek within the frozen replay interval")?;
                        p.cursor.store(frame, Ordering::Release);
                    }
                }
                Ok(json!({"applied":true}))
            }
            _ => Err("Unsupported recorder action".into()),
        }
    }
    fn prepare(&self, r: &Value) -> Result<Value> {
        let log = r["logId"]
            .as_str()
            .ok_or("Missing exact dataset log identity")?;
        store::uuid(log)?;
        let keys = {
            let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
            s.saved
                .captures
                .iter()
                .filter(|k| k.log_id == log && !k.controlled_test)
                .cloned()
                .collect::<Vec<_>>()
        };
        let mut matches = vec![];
        for key in keys {
            let a = self.archive(&key)?;
            let a = a.lock().map_err(|_| "Archive unavailable")?;
            let rate = a.manifest.config.rate as u64;
            if let Some(qso) = r["qsoId"].as_str() {
                store::uuid(qso)?;
                if let Some(l) = a.links.get(qso) {
                    if !l.deleted {
                        matches.push((key.clone(),json!({"logId":log,"captureId":key.capture_id,"qsoId":qso,"startFrame":l.frame.saturating_sub(a.manifest.config.pre_seconds as u64*rate),"endFrame":l.frame+a.manifest.config.post_seconds as u64*rate,"label":l.current,"basis":l.basis})));
                    }
                }
            } else {
                let from = r["fromUtcMs"].as_u64().ok_or("Choose a UTC interval")?;
                let to = r["toUtcMs"].as_u64().ok_or("Choose a UTC interval")?;
                if from < to
                    && from >= a.manifest.start_utc_ms
                    && to <= a.manifest.start_utc_ms + a.manifest.frames * 1000 / rate
                {
                    matches.push((key.clone(),json!({"logId":log,"captureId":key.capture_id,"startFrame":(from-a.manifest.start_utc_ms)*rate/1000,"endFrame":(to-a.manifest.start_utc_ms)*rate/1000,"basis":a.manifest.time_basis})));
                }
            }
        }
        if matches.len() != 1 {
            return Err(if matches.is_empty(){"Audio unavailable for this exact log/contact/interval"}else{"Audio mapping is ambiguous across captures/clock epochs; select an archive explicitly"}.into());
        }
        let (key, selection) = matches.remove(0);
        stop_replay();
        let mut s = self.state.lock().map_err(|_| "Recorder unavailable")?;
        s.selected = Some(key);
        s.selection = selection.clone();
        Ok(selection)
    }
    fn admit_replay(&self, r: &mut Value, ticket: u64, current_log: Option<&str>) -> Result<()> {
        if self.playback_generation.load(Ordering::Acquire) != ticket {
            return Err("Replay cancelled".into());
        }
        let s = self.state.lock().map_err(|_| "Recorder unavailable")?;
        if r["action"] == "replay_recent" {
            let a = s
                .active
                .as_ref()
                .filter(|a| !a.key.controlled_test)
                .ok_or("No local recording is available")?;
            if Some(a.key.log_id.as_str()) != current_log {
                return Err("Contest changed; open the exact archive".into());
            }
            r["logId"] = json!(a.key.log_id);
            r["captureId"] = json!(a.key.capture_id);
        }
        if r["lastSeconds"].is_number() {
            let a = s
                .active
                .as_ref()
                .filter(|a| r["captureId"] == a.key.capture_id);
            r["_frozenEnd"] = json!(a
                .filter(|a| !a.done.load(Ordering::Acquire))
                .map(|a| a.frames.load(Ordering::Acquire)));
        }
        r["_generation"] = json!(ticket);
        Ok(())
    }
    fn replay(&self, r: &Value) -> Result<Value> {
        let generation = r["_generation"]
            .as_u64()
            .ok_or("Missing replay admission")?;
        if self.playback_generation.load(Ordering::Acquire) != generation {
            return Err("Replay cancelled".into());
        }
        let key = self
            .state
            .lock()
            .map_err(|_| "Recorder unavailable")?
            .saved
            .captures
            .iter()
            .find(|k| r["logId"] == k.log_id && r["captureId"] == k.capture_id)
            .cloned()
            .ok_or("Unknown exact replay archive")?;
        let a = self.archive(&key)?;
        // Freeze the callback watermark ONCE. Wait for that exact prefix to reach
        // the writer without holding its lock; later input never moves the endpoint.
        let live_end = r["_frozenEnd"].as_u64();
        if let Some(end) = live_end {
            let deadline = Instant::now() + Duration::from_millis(500);
            loop {
                if self.playback_generation.load(Ordering::Acquire) != generation {
                    return Err("Replay cancelled".into());
                }
                if a.lock().map_err(|_| "Archive unavailable")?.manifest.frames >= end {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err("Captured replay prefix is still waiting for the writer; no alternate interval was played".into());
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        let snapshot = a.lock().map_err(|_| "Archive unavailable")?.snapshot();
        let (samples, mut config, start, end) = {
            let a = snapshot;
            if r["logId"] != a.manifest.log_id || r["captureId"] != a.manifest.capture_id {
                return Err("Replay scope changed; select the exact archive again".into());
            }
            let end = r["lastSeconds"]
                .as_u64()
                .map(|_| live_end.unwrap_or(a.manifest.frames))
                .unwrap_or(
                    r["endFrame"]
                        .as_u64()
                        .ok_or("Missing frozen replay endpoint")
                        .unwrap_or(0),
                );
            let start = if let Some(seconds) = r["lastSeconds"].as_u64() {
                if ![5, 10, 30].contains(&seconds) {
                    return Err("Replay supports 5, 10 or 30 seconds".into());
                }
                end.saturating_sub(seconds * a.manifest.config.rate as u64)
            } else {
                r["startFrame"].as_u64().ok_or("Missing replay start")?
            };
            (
                a.read_pcm(start, end)?,
                a.manifest.config.clone(),
                start,
                end,
            )
        };
        if let Some(listening) = self
            .state
            .lock()
            .map_err(|_| "Recorder unavailable")?
            .saved
            .config
            .as_ref()
        {
            config.output_id = listening.output_id.clone();
            config.route_verified = listening.route_verified;
        }
        if observed_transmit() {
            return Err(
                "Transmit/output activity observed; replay rejected, capture continues".into(),
            );
        }
        #[cfg(target_os = "macos")]
        {
            crate::contest_recorder_audio::validate_listening(&config.output_id)?;
            let mut player = self
                .playback
                .lock()
                .map_err(|_| "Listening player unavailable")?;
            if self.playback_generation.load(Ordering::Acquire) != generation {
                return Err("Replay cancelled while preparing".into());
            }
            *player = None;
            let channel = r["channel"]
                .as_u64()
                .filter(|n| *n <= config.channels as u64)
                .ok_or("Choose a valid recorded channel")? as u16;
            let output_channel = r["outputChannel"]
                .as_u64()
                .filter(|n| *n < 64)
                .ok_or("Choose an explicit listening channel")?
                as u16;
            let volume = r["volume"]
                .as_f64()
                .filter(|n| n.is_finite() && (0.0..=0.5).contains(n))
                .ok_or("Invalid listening volume")? as f32;
            let spec = crate::contest_recorder_audio::PlaySpec {
                output_id: config.output_id,
                rate: config.rate,
                source_channels: config.channels,
                channel,
                output_channel,
                volume,
            };
            *player = Some(crate::contest_recorder_audio::output(
                samples,
                spec,
                self.playback_generation.clone(),
                generation,
            )?);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (samples, config, generation);
            return Err("Native listening playback is available on macOS only".into());
        }
        #[allow(unreachable_code)]
        Ok(json!({"playing":true,"startFrame":start,"endFrame":end,"frozen":true}))
    }
}

#[cfg(target_os = "macos")]
async fn choose_directory(window: tauri::WebviewWindow, export: bool) -> Result<Option<PathBuf>> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::NSString;
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let result = MainThreadMarker::new()
                .ok_or("Folder chooser unavailable")
                .map(|main| {
                    let panel = NSOpenPanel::openPanel(main);
                    panel.setCanChooseFiles(false);
                    panel.setCanChooseDirectories(true);
                    panel.setAllowsMultipleSelection(false);
                    panel.setMessage(Some(&NSString::from_str(if export {
                        "Choose a separate export parent. Originals remain unchanged."
                    } else {
                        "Choose an existing local recording folder. Retention is user managed."
                    })));
                    if panel.runModal() == NSModalResponseOK {
                        panel
                            .URL()
                            .and_then(|u| u.path())
                            .map(|p| PathBuf::from(p.to_string()))
                    } else {
                        None
                    }
                });
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|_| "Folder chooser closed".to_string())?
            .map_err(str::to_string)
    })
    .await
    .map_err(|_| "Folder chooser failed".to_string())?
}
#[cfg(not(target_os = "macos"))]
async fn choose_directory(_window: tauri::WebviewWindow, _export: bool) -> Result<Option<PathBuf>> {
    tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_entry_admission_marks_esm_logit_and_direct_commits_without_audio_devices() {
        let (_temp, mut recorder, config) = fixture();
        let (tx, rx) = mpsc::sync_channel(10);
        recorder.notices = tx;
        let root = recorder.state.lock().unwrap().saved.root.clone();
        let log = uuid::Uuid::new_v4().to_string();
        let mut archive = Archive::create(&root, &log, config).unwrap();
        archive.append(&[0; 100]).unwrap();
        let capture = archive.manifest.capture_id.clone();
        let shared = archive.into_shared();
        recorder.state.lock().unwrap().active = Some(Active {
            key: Key { log_id: log.clone(), capture_id: capture.clone(), root,
                started_utc_ms: store::utc_ms(), controlled_test: false },
            archive: shared.clone(), stop: Arc::new(AtomicBool::new(false)),
            frames: Arc::new(AtomicU64::new(100)), done: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            peak: Arc::new(std::sync::atomic::AtomicU32::new(0)),
        });
        for (index, method) in ["contest_qso_commit", "contest_esm", "contest_function_key"].iter().enumerate() {
            let op = uuid::Uuid::new_v4().to_string();
            let qso = uuid::Uuid::new_v4().to_string();
            admission_to(&recorder, &json!({"method":method,"params":{"sessionID":log,"operationID":op}}));
            let Notice::Marker(key, marked_op, frame, time) = rx.try_recv().unwrap() else { panic!("Missing entry marker") };
            assert_eq!((key, marked_op.clone(), frame), (capture.clone(), op, 100));
            let mut archive = shared.lock().unwrap();
            let page = json!({"engine":"not1mm-python","sessionID":log,"events":[{
                "sequence":index+1,"revision":index+1,"qsoID":qso,"operationID":marked_op,
                "kind":"commit","local":true,"utcMs":time,"after":{"Call":"K1ABC"}}]});
            let markers = BTreeMap::from([(marked_op, (frame, time))]);
            archive.reconcile(&page, &markers).unwrap();
            archive.reconcile(&page, &markers).unwrap();
            assert_eq!(archive.links[&qso].frame, 100);
            assert_eq!(archive.links.len(), index + 1);
        }
        for method in ["contest_strategy_apply", "contest_multi_contact_apply", "contest_multi_replica_apply", "contest_recorder_changes"] {
            admission_to(&recorder, &json!({"method":method,"params":{"sessionID":log,"operationID":uuid::Uuid::new_v4()}}));
            assert!(rx.try_recv().is_err(), "Remote/import method received a local marker");
        }
        recorder.state.lock().unwrap().active.as_mut().unwrap().key.controlled_test = true;
        admission_to(&recorder, &json!({"method":"contest_esm","params":{"sessionID":log,"operationID":uuid::Uuid::new_v4()}}));
        assert!(rx.try_recv().is_err(), "Controlled-test capture acquired a production entry marker");
        shared.lock().unwrap().finish("stopped", None).unwrap();
    }
    #[test]
    fn recorder_capabilities_reject_station_writes_paths_and_analytics_capture() {
        for action in [
            "station_action",
            "contest_qso_commit",
            "contest_voice_ptt",
            "rotor_goto",
            "radio_tune",
            "sql",
            "read_file",
        ] {
            assert!(validate_request(WINDOW, &json!({"action":action})).is_err());
        }
        for label in ["main", "settings", "cw", "rotor", "unknown"] {
            assert!(validate_request(label, &json!({"action":"status"})).is_err());
        }
        for action in ["start", "configure", "replay", "bookmark", "export"] {
            assert!(validate_request("contest-analytics", &json!({"action":action})).is_err());
        }
        assert!(validate_request("contest-analytics",&json!({"action":"prepare","logId":uuid::Uuid::new_v4().to_string(),"qsoId":uuid::Uuid::new_v4().to_string()})).is_ok());
        assert!(
            validate_request(WINDOW, &json!({"action":"replay","path":"/etc/passwd"})).is_err()
        );
        assert!(validate_request("contest--active-qso", &json!({"action":"stop_replay"})).is_ok());
    }
    fn fixture() -> (tempfile::TempDir, Recorder, Config) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let config:Config=serde_json::from_value(json!({"inputId":"fixture-input","outputId":"fixture-headphones","channels":1,"rate":8000,"mapping":"Receiver audio only","roles":["RX fixture"],"routeVerified":true,"preSeconds":1,"postSeconds":1,"reserveBytes":1073741824u64,"warningBytes":5368709120u64})).unwrap();
        let (tx, _rx) = mpsc::sync_channel(10);
        let recorder = Recorder {
            path: root.join("settings.json"),
            state: Mutex::new(State {
                saved: Saved {
                    root,
                    config: Some(config.clone()),
                    captures: vec![],
                },
                active: None,
                selected: None,
                cache: BTreeMap::new(),
                selection: Value::Null,
                error: String::new(),
            }),
            lifecycle: Mutex::new(()),
            notices: tx,
            playback_generation: Arc::new(AtomicU64::new(0)),
            reconciliation_cursor: AtomicU64::new(0),
            export_cancel: AtomicBool::new(false),
            export_running: AtomicBool::new(false),
            #[cfg(target_os = "macos")]
            playback: Mutex::new(None),
            exiting: AtomicBool::new(false),
        };
        (temp, recorder, config)
    }
    #[test]
    fn exact_log_identity_and_ambiguous_clock_capture_intervals_never_cross_link() {
        let (_temp, recorder, config) = fixture();
        let log = uuid::Uuid::new_v4().to_string();
        let qso = uuid::Uuid::new_v4().to_string();
        for _ in 0..2 {
            let root = recorder.state.lock().unwrap().saved.root.clone();
            let mut a = Archive::create(&root, &log, config.clone()).unwrap();
            a.append(&[1; 100]).unwrap();
            a.manifest.start_utc_ms = 100000;
            a.save_link(store::Link {
                id: qso.clone(),
                qso_id: Some(qso.clone()),
                operation_id: Some(uuid::Uuid::new_v4().to_string()),
                sequence: 1,
                revision: 1,
                frame: 20,
                anchor_utc_ms: 100002,
                basis: "fixture".into(),
                original: json!({"Call":"K1ABC"}),
                current: json!({"Call":"K1ABC"}),
                deleted: false,
                note: String::new(),
            })
            .unwrap();
            a.finish("stopped", None).unwrap();
            let key = Key {
                log_id: log.clone(),
                capture_id: a.manifest.capture_id.clone(),
                root,
                started_utc_ms: a.manifest.start_utc_ms,
                controlled_test: false,
            };
            let mut s = recorder.state.lock().unwrap();
            s.saved.captures.push(key.clone());
            s.cache.insert(key.capture_id, a.into_shared());
        }
        assert!(recorder
            .prepare(&json!({"logId":log,"qsoId":qso}))
            .unwrap_err()
            .contains("ambiguous"));
        assert!(recorder
            .prepare(&json!({"logId":uuid::Uuid::new_v4().to_string(),"qsoId":qso}))
            .unwrap_err()
            .contains("unavailable"));
        assert!(recorder
            .prepare(&json!({"logId":log,"fromUtcMs":100000,"toUtcMs":100010}))
            .unwrap_err()
            .contains("ambiguous"));
        assert!(recorder.state.lock().unwrap().selection.is_null());
    }
    trait IntoShared {
        fn into_shared(self) -> Shared;
    }
    #[test]
    fn active_recovery_and_stale_stop_are_rejected_before_file_mutation() {
        let (_temp, recorder, config) = fixture();
        let log = uuid::Uuid::new_v4().to_string();
        let root = recorder.state.lock().unwrap().saved.root.clone();
        let mut a = Archive::create(&root, &log, config).unwrap();
        a.append(&[1; 20]).unwrap();
        a.flush_tail().unwrap();
        let partial = store::segment_path(&a.dir, 0, true);
        let original = std::fs::read(&partial).unwrap();
        let key = Key {
            log_id: log,
            capture_id: a.manifest.capture_id.clone(),
            root,
            started_utc_ms: a.manifest.start_utc_ms,
            controlled_test: false,
        };
        let shared = a.into_shared();
        {
            let mut s = recorder.state.lock().unwrap();
            s.saved.captures.push(key.clone());
            s.selected = Some(key.clone());
            s.cache.insert(key.capture_id.clone(), shared.clone());
            s.active = Some(Active {
                key,
                archive: shared,
                stop: Arc::new(AtomicBool::new(false)),
                frames: Arc::new(AtomicU64::new(20)),
                done: Arc::new(AtomicBool::new(false)),
                #[cfg(target_os = "macos")]
                peak: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            });
        }
        assert!(recorder
            .dispatch("recover", json!({"action":"recover"}))
            .unwrap_err()
            .contains("Stop capture"));
        assert!(recorder
            .dispatch(
                "stop",
                json!({"action":"stop","captureId":uuid::Uuid::new_v4().to_string()})
            )
            .unwrap_err()
            .contains("changed"));
        assert_eq!(std::fs::read(&partial).unwrap(), original);
        assert!(!recorder
            .state
            .lock()
            .unwrap()
            .active
            .as_ref()
            .unwrap()
            .stop
            .load(Ordering::Acquire));
    }
    #[test]
    fn bookmark_paging_searches_the_full_durable_index() {
        let (_temp, recorder, config) = fixture();
        let root = recorder.state.lock().unwrap().saved.root.clone();
        let mut a = Archive::create(&root, &uuid::Uuid::new_v4().to_string(), config).unwrap();
        a.append(&[1; 20]).unwrap();
        for index in 0..35 {
            a.manual(&format!("Marker {index:02}")).unwrap();
        }
        a.finish("stopped", None).unwrap();
        let key = Key {
            log_id: a.manifest.log_id.clone(),
            capture_id: a.manifest.capture_id.clone(),
            root,
            started_utc_ms: a.manifest.start_utc_ms,
            controlled_test: false,
        };
        let base = json!({"action":"bookmarks","logId":key.log_id,"captureId":key.capture_id,"offset":0,"limit":10,"query":""});
        {
            let mut s = recorder.state.lock().unwrap();
            s.saved.captures.push(key.clone());
            s.selected = Some(key.clone());
            s.cache.insert(key.capture_id, a.into_shared());
        }
        let first = recorder.dispatch("bookmarks", base.clone()).unwrap();
        assert_eq!(first["total"], 35);
        assert_eq!(first["rows"].as_array().unwrap().len(), 10);
        let mut next = base.clone();
        next["offset"] = json!(10);
        let second = recorder.dispatch("bookmarks", next).unwrap();
        assert!(first["rows"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| second["rows"]
                .as_array()
                .unwrap()
                .iter()
                .all(|b| a["id"] != b["id"])));
        let mut search = base;
        search["query"] = json!("Marker 34");
        assert_eq!(recorder.dispatch("bookmarks", search).unwrap()["total"], 1);
    }
    #[test]
    fn queued_replay_never_restarts_after_stop_or_newer_admission() {
        let (_temp, recorder, _) = fixture();
        let mut request = json!({"action":"replay","logId":uuid::Uuid::new_v4().to_string(),"captureId":uuid::Uuid::new_v4().to_string()});
        let ticket = recorder.playback_generation.fetch_add(1, Ordering::AcqRel) + 1;
        recorder.admit_replay(&mut request, ticket, None).unwrap();
        recorder.playback_generation.fetch_add(1, Ordering::AcqRel); // Stop while queued.
        assert!(recorder
            .dispatch("replay", request.clone())
            .unwrap_err()
            .contains("cancelled"));
        assert!(recorder
            .admit_replay(&mut request, ticket, None)
            .unwrap_err()
            .contains("cancelled"));
        assert!(validate_request(WINDOW, &json!({"action":"replay","_generation":999})).is_err());
    }
    #[test]
    fn retained_transmit_in_either_radio_slot_inhibits_listening() {
        let rx = json!({"snapshot":{"radio":{"transmitting":false}}});
        let tx = json!({"snapshot":{"radio":{"transmitting":true}}});
        assert!(!any_transmit(&[rx.clone(), rx.clone()]));
        assert!(any_transmit(&[rx.clone(), tx.clone()]));
        assert!(any_transmit(&[tx, rx]));
        assert!(any_transmit(&[json!({"voice":{"output_active":true}})]));
    }
    #[test]
    fn previous_capture_reconciles_delayed_commit_correction_and_delete() {
        let (_temp, recorder, config) = fixture();
        let root = recorder.state.lock().unwrap().saved.root.clone();
        let log = uuid::Uuid::new_v4().to_string();
        let qso = uuid::Uuid::new_v4().to_string();
        let op = uuid::Uuid::new_v4().to_string();
        let mut first = Archive::create(&root, &log, config.clone()).unwrap();
        first.append(&[1; 100]).unwrap();
        first.event(json!({"type":"admission","operationID":op,"frame":70,"utcMs":first.manifest.start_utc_ms})).unwrap();
        first.finish("paused", None).unwrap();
        let old = Key {
            log_id: log.clone(),
            capture_id: first.manifest.capture_id.clone(),
            root: root.clone(),
            started_utc_ms: first.manifest.start_utc_ms,
            controlled_test: false,
        };
        let mut second = Archive::create(&root, &log, config).unwrap();
        second.append(&[2; 100]).unwrap();
        let new = Key {
            capture_id: second.manifest.capture_id.clone(),
            ..old.clone()
        };
        {
            let mut s = recorder.state.lock().unwrap();
            s.saved.captures = vec![old.clone(), new.clone()];
            s.selected = Some(new.clone());
            s.cache.insert(old.capture_id.clone(), first.into_shared());
            s.cache.insert(new.capture_id.clone(), second.into_shared());
        }
        for (seq, kind, call) in [
            (1, "commit", "K1ABC"),
            (2, "correct", "DL1ABC"),
            (3, "delete", "DL1ABC"),
        ] {
            let keys = recorder.reconciliation_keys().unwrap();
            assert!(keys.iter().any(|k| k.capture_id == old.capture_id));
            recorder.reconcile_keys(keys,&BTreeMap::new(),|_|Ok(json!({"ok":true,"result":{"engine":"not1mm-python","sessionID":log,"events":[{"sequence":seq,"revision":seq,"operationID":op,"qsoID":qso,"kind":kind,"local":true,"utcMs":0,"after":{"Call":call}}]}}))).unwrap();
            let a = recorder.archive(&old).unwrap();
            let a = a.lock().unwrap();
            assert_eq!(a.links[&qso].frame, 70);
            assert_eq!(a.links[&qso].current["Call"], call);
            assert_eq!(a.links[&qso].deleted, kind == "delete");
        }
        assert!(recorder
            .archive(&new)
            .unwrap()
            .lock()
            .unwrap()
            .links
            .is_empty());
    }
    impl IntoShared for Archive {
        fn into_shared(self) -> Shared {
            Arc::new(Mutex::new(self))
        }
    }
}
