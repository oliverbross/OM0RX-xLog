//! Passive DX opportunity alert owner.
//! It observes the single native cluster projection, persists only bounded
//! non-secret rule configuration, and exposes no radio or station capability.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashSet, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

const MAX_REVISION: u64 = 9_007_199_254_740_991;
const MAX_RULES: usize = 32;
const MAX_ENTRIES: usize = 200;
const MAX_SEEN: usize = 4_096;
const FILE_LIMIT: usize = 262_144;
const DELIVERY_LIMIT: usize = 3;
const DELIVERY_WINDOW_MS: u64 = 10_000;
const CALL_STATUSES: [&str; 7] = [
    "New Call",
    "New Band",
    "New Mode",
    "New Band+Mode",
    "Worked",
    "Confirmed",
    "Unknown",
];
const DXCC_STATUSES: [&str; 10] = [
    "ATNO",
    "C/New Band",
    "C/New Mode",
    "C/New Band+Mode",
    "W/New Band",
    "W/New Mode",
    "W/New Band+Mode",
    "Worked",
    "Confirmed",
    "Unknown",
];
const BANDS: [&str; 13] = [
    "160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm",
];
const MODE_GROUPS: [&str; 3] = ["cw", "data", "phone"];

type Publish = dyn Fn() + Send + Sync;
type Deliver = dyn Fn(&Entry, bool) -> Result<(), String> + Send + Sync;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    id: String,
    name: String,
    enabled: bool,
    #[serde(default = "cluster_source")]
    sources: Vec<String>,
    callsign_glob: String,
    #[serde(default)]
    comment_contains: String,
    bands: Vec<String>,
    modes: Vec<String>,
    call_statuses: Vec<String>,
    dxcc_statuses: Vec<String>,
    specials: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditableConfiguration {
    enabled: bool,
    dedup_seconds: u64,
    retention_minutes: u64,
    #[serde(default)]
    native_popup: bool,
    #[serde(default)]
    notification_sound: bool,
    rules: Vec<Rule>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Configuration {
    version: u64,
    generation: String,
    revision: u64,
    enabled: bool,
    dedup_seconds: u64,
    retention_minutes: u64,
    #[serde(default)]
    native_popup: bool,
    #[serde(default)]
    notification_sound: bool,
    rules: Vec<Rule>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    test: bool,
    source: String,
    callsign: String,
    frequency_khz: f64,
    band: String,
    mode: String,
    comment: String,
    call_status: String,
    dxcc_status: String,
    special_tags: Vec<String>,
    rule_names: Vec<String>,
    count: u64,
    first_seen_ms: u64,
    last_seen_ms: u64,
}

#[derive(Clone, Debug)]
struct Spot {
    source: String,
    source_key: String,
    callsign: String,
    frequency_khz: f64,
    band: String,
    mode: String,
    comment: String,
    mode_group: String,
    call_status: String,
    dxcc_status: String,
    special_tags: Vec<String>,
}

struct State {
    activity: ActivitySource,
    configuration: Configuration,
    storage_error: Option<String>,
    epoch: String,
    revision: u64,
    source_revision: u64,
    source_available: bool,
    source_received_at_ms: u64,
    baselined: bool,
    baseline_next: bool,
    seen: HashSet<String>,
    seen_order: VecDeque<String>,
    entries: VecDeque<Entry>,
    delivery_error: Option<String>,
    delivery_suppressed: u64,
    delivery_times: VecDeque<u64>,
}

fn cluster_source() -> Vec<String> { vec!["cluster".into()] }

#[derive(Default)]
struct ActivitySource {
    epoch: Option<String>,
    revision: u64,
    available: bool,
    baselined: bool,
    received_at_ms: u64,
    seen: HashSet<String>,
    order: VecDeque<String>,
}

impl ActivitySource {
    fn remember(&mut self, key: String) -> bool {
        if !self.seen.insert(key.clone()) { return false; }
        self.order.push_back(key);
        while self.order.len() > MAX_SEEN {
            if let Some(old) = self.order.pop_front() { self.seen.remove(&old); }
        }
        true
    }
}

pub struct Owner {
    path: PathBuf,
    publish: Arc<Publish>,
    deliver: Arc<Deliver>,
    stopped: AtomicBool,
    state: Mutex<State>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn identifier(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok()
}

fn visible_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= maximum
        && !value.chars().any(|character| character.is_control())
}

fn normalized_unique(values: &[String], maximum: usize) -> bool {
    values.len() <= maximum
        && values.iter().all(|value| !value.is_empty())
        && values.iter().collect::<HashSet<_>>().len() == values.len()
}

impl Rule {
    fn validate(&self) -> Result<(), String> {
        if !identifier(&self.id)
            || self.sources.is_empty() || self.sources.len() > 2
            || self.sources.iter().any(|source| !matches!(source.as_str(), "cluster" | "wsjtx"))
            || self.sources.iter().collect::<HashSet<_>>().len() != self.sources.len()
            || !visible_text(&self.name, 80)
            || self.callsign_glob.len() > 32
            || !self.comment_contains.is_empty() && !visible_text(&self.comment_contains, 80)
            || !self.callsign_glob.bytes().all(|byte| {
                byte.is_ascii_uppercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'/' | b'*' | b'?')
            })
            || !normalized_unique(&self.bands, BANDS.len())
            || self
                .bands
                .iter()
                .any(|value| !BANDS.contains(&value.as_str()))
            || !normalized_unique(&self.modes, MODE_GROUPS.len())
            || self
                .modes
                .iter()
                .any(|value| !MODE_GROUPS.contains(&value.as_str()))
            || !normalized_unique(&self.call_statuses, CALL_STATUSES.len())
            || self
                .call_statuses
                .iter()
                .any(|value| !CALL_STATUSES.contains(&value.as_str()))
            || !normalized_unique(&self.dxcc_statuses, DXCC_STATUSES.len())
            || self
                .dxcc_statuses
                .iter()
                .any(|value| !DXCC_STATUSES.contains(&value.as_str()))
            || !normalized_unique(&self.specials, 16)
            || self.specials.iter().any(|value| {
                value.len() > 16
                    || !value.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-'
                    })
            })
            || self.callsign_glob.is_empty()
                && self.comment_contains.is_empty()
                && self.bands.is_empty()
                && self.modes.is_empty()
                && self.call_statuses.is_empty()
                && self.dxcc_statuses.is_empty()
                && self.specials.is_empty()
        {
            return Err("A DX alert rule is invalid or has no condition.".into());
        }
        Ok(())
    }

    fn matches(&self, spot: &Spot) -> bool {
        self.enabled
            && self.sources.contains(&spot.source)
            && (self.callsign_glob.is_empty() || glob_matches(&self.callsign_glob, &spot.callsign))
            && (self.comment_contains.is_empty()
                || spot
                    .comment
                    .to_lowercase()
                    .contains(&self.comment_contains.trim().to_lowercase()))
            && (self.bands.is_empty() || self.bands.contains(&spot.band))
            && (self.modes.is_empty() || self.modes.contains(&spot.mode_group))
            && (self.call_statuses.is_empty() || self.call_statuses.contains(&spot.call_status))
            && (self.dxcc_statuses.is_empty() || self.dxcc_statuses.contains(&spot.dxcc_status))
            && (self.specials.is_empty()
                || spot
                    .special_tags
                    .iter()
                    .any(|tag| self.specials.contains(tag)))
    }
}

impl EditableConfiguration {
    fn validate(&self) -> Result<(), String> {
        if !(15..=3_600).contains(&self.dedup_seconds)
            || !(1..=1_440).contains(&self.retention_minutes)
            || self.notification_sound && !self.native_popup
            || self.rules.len() > MAX_RULES
            || self
                .rules
                .iter()
                .map(|rule| &rule.id)
                .collect::<HashSet<_>>()
                .len()
                != self.rules.len()
        {
            return Err("DX alert settings are outside their supported bounds.".into());
        }
        for rule in &self.rules {
            rule.validate()?;
        }
        Ok(())
    }
}

impl Configuration {
    fn default_off() -> Self {
        Self {
            version: 1,
            generation: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            enabled: false,
            dedup_seconds: 300,
            retention_minutes: 120,
            native_popup: false,
            notification_sound: false,
            rules: vec![Rule {
                id: "new-dxcc".into(),
                name: "New DXCC".into(),
                enabled: true,
                sources: cluster_source(),
                callsign_glob: String::new(),
                comment_contains: String::new(),
                bands: vec![],
                modes: vec![],
                call_statuses: vec![],
                dxcc_statuses: vec!["ATNO".into()],
                specials: vec![],
            }],
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.version != 1 || !valid_uuid(&self.generation) || self.revision > MAX_REVISION {
            return Err("The saved DX alert configuration is invalid.".into());
        }
        EditableConfiguration {
            enabled: self.enabled,
            dedup_seconds: self.dedup_seconds,
            retention_minutes: self.retention_minutes,
            native_popup: self.native_popup,
            notification_sound: self.notification_sound,
            rules: self.rules.clone(),
        }
        .validate()
    }
}

fn glob_matches(pattern: &str, value: &str) -> bool {
    let (pattern, value) = (pattern.as_bytes(), value.as_bytes());
    let mut current = vec![false; value.len() + 1];
    current[0] = true;
    for token in pattern {
        let mut next = vec![false; value.len() + 1];
        if *token == b'*' {
            next[0] = current[0];
        }
        for index in 1..=value.len() {
            next[index] = if *token == b'*' {
                next[index - 1] || current[index]
            } else {
                current[index - 1] && (*token == b'?' || *token == value[index - 1])
            };
        }
        current = next;
    }
    current[value.len()]
}

fn mode_group(mode: &str) -> &'static str {
    match mode.trim().to_ascii_uppercase().as_str() {
        "CW" | "CWR" => "cw",
        "SSB" | "USB" | "LSB" | "AM" | "FM" | "PHONE" => "phone",
        _ => "data",
    }
}

fn bounded_text(value: &Value, key: &str, maximum: usize) -> Option<String> {
    value[key]
        .as_str()
        .map(str::trim)
        .filter(|text| {
            !text.is_empty()
                && text.len() <= maximum
                && !text.chars().any(|character| character.is_control())
        })
        .map(str::to_owned)
}

fn spot(value: &Value) -> Option<Spot> {
    let source_key = value["activation"]["sourceEpoch"]
        .as_str()
        .zip(value["activation"]["spotVersion"].as_str())
        .filter(|(epoch, version)| valid_uuid(epoch) && !version.is_empty() && version.len() <= 128)
        .map(|(epoch, version)| format!("{epoch}:{version}"))
        .or_else(|| bounded_text(value, "id", 128))?;
    let callsign = bounded_text(value, "callsign", 32)?.to_ascii_uppercase();
    let frequency_khz = value["frequencyKHz"].as_f64().filter(|frequency| {
        frequency.is_finite() && *frequency >= 0.0 && *frequency <= 10_000_000.0
    })?;
    let band = bounded_text(value, "band", 16)?;
    let mode = bounded_text(value, "mode", 24)?;
    let call_status = bounded_text(value, "callStatus", 32)?;
    let dxcc_status = bounded_text(value, "dxccStatus", 32)?;
    if !BANDS.contains(&band.as_str())
        || !CALL_STATUSES.contains(&call_status.as_str())
        || !DXCC_STATUSES.contains(&dxcc_status.as_str())
    {
        return None;
    }
    let special_tags: Vec<String> = value["specialTags"]
        .as_array()?
        .iter()
        .filter_map(|tag| tag.as_str())
        .filter(|tag| {
            !tag.is_empty()
                && tag.len() <= 16
                && tag
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
        })
        .take(16)
        .map(str::to_owned)
        .collect();
    Some(Spot {
        source: "cluster".into(),
        source_key,
        callsign,
        frequency_khz,
        band,
        mode: mode.clone(),
        comment: value["comment"]
            .as_str()
            .filter(|text| text.len() <= 512 && !text.chars().any(char::is_control))
            .map(str::trim)
            .unwrap_or_default()
            .to_owned(),
        mode_group: mode_group(&mode).into(),
        call_status,
        dxcc_status,
        special_tags,
    })
}

fn read(path: &Path) -> (Configuration, Option<String>) {
    match std::fs::read(path) {
        Ok(bytes) if bytes.len() <= FILE_LIMIT => match serde_json::from_slice::<Configuration>(&bytes) {
            Ok(configuration) if configuration.validate().is_ok() => (configuration, None),
            _ => (Configuration::default_off(), Some("Saved DX alert rules could not be verified. Saving replaces that file with the reviewed settings.".into())),
        },
        Ok(_) => (Configuration::default_off(), Some("Saved DX alert rules are too large. Saving replaces that file with the reviewed settings.".into())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Configuration::default_off(), None),
        Err(_) => (Configuration::default_off(), Some("Saved DX alert rules could not be read. Check the application configuration permissions before saving.".into())),
    }
}

fn persist(path: &Path, configuration: &Configuration) -> Result<(), String> {
    let directory = path.parent().ok_or("DX alert storage is unavailable.")?;
    std::fs::create_dir_all(directory)
        .map_err(|_| "DX alert storage could not be created.".to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(directory)
        .map_err(|_| "DX alert settings could not be staged.".to_string())?;
    serde_json::to_writer(file.as_file_mut(), configuration)
        .map_err(|_| "DX alert settings could not be encoded.".to_string())?;
    file.flush()
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "DX alert settings could not be sealed.".to_string())?;
    file.persist(path)
        .map_err(|_| "DX alert settings could not be saved atomically.".to_string())?;
    Ok(())
}

impl State {
    fn remember(&mut self, key: String) -> bool {
        if !self.seen.insert(key.clone()) {
            return false;
        }
        self.seen_order.push_back(key);
        while self.seen_order.len() > MAX_SEEN {
            if let Some(oldest) = self.seen_order.pop_front() {
                self.seen.remove(&oldest);
            }
        }
        true
    }

    fn purge(&mut self, now: u64) -> bool {
        let previous_count = self.entries.len();
        let maximum_age = self.configuration.retention_minutes.saturating_mul(60_000);
        self.entries
            .retain(|entry| entry.test || now.saturating_sub(entry.last_seen_ms) <= maximum_age);
        while self.entries.len() > MAX_ENTRIES {
            self.entries.pop_back();
        }
        self.entries.len() != previous_count
    }

    fn delivery(&mut self, entry: &Entry, now: u64) -> Option<(Entry, bool)> {
        if !self.configuration.native_popup {
            return None;
        }
        while self
            .delivery_times
            .front()
            .is_some_and(|sent| now.saturating_sub(*sent) >= DELIVERY_WINDOW_MS)
        {
            self.delivery_times.pop_front();
        }
        if self.delivery_times.len() >= DELIVERY_LIMIT {
            self.delivery_suppressed = self.delivery_suppressed.saturating_add(1).min(MAX_REVISION);
            return None;
        }
        self.delivery_times.push_back(now);
        Some((entry.clone(), self.configuration.notification_sound))
    }

    fn snapshot(&self) -> Value {
        json!({
            "epoch": self.epoch,
            "revision": self.revision,
            "configuration": self.configuration,
            "storageError": self.storage_error,
            "source": {
                "available": self.source_available,
                "baselined": self.baselined,
                "revision": self.source_revision,
                "receivedAtMs": self.source_received_at_ms,
            },
            "activitySource": {
                "available": self.activity.available,
                "baselined": self.activity.baselined,
                "revision": self.activity.revision,
                "receivedAtMs": self.activity.received_at_ms,
            },
            "entries": self.entries,
            "delivery": {
                "error": self.delivery_error,
                "suppressed": self.delivery_suppressed,
                "maximumPerWindow": DELIVERY_LIMIT,
                "windowSeconds": DELIVERY_WINDOW_MS / 1_000,
            },
            "limits": { "maximumRules": MAX_RULES, "maximumEntries": MAX_ENTRIES },
        })
    }
}

impl Owner {
    fn new(path: PathBuf, publish: Arc<Publish>, deliver: Arc<Deliver>) -> Self {
        let (configuration, storage_error) = read(&path);
        Self {
            path,
            publish,
            deliver,
            stopped: AtomicBool::new(false),
            state: Mutex::new(State {
                activity: ActivitySource::default(),
                configuration,
                storage_error,
                epoch: uuid::Uuid::new_v4().to_string(),
                revision: 0,
                source_revision: 0,
                source_available: false,
                source_received_at_ms: 0,
                baselined: false,
                baseline_next: true,
                seen: HashSet::new(),
                seen_order: VecDeque::new(),
                entries: VecDeque::new(),
                delivery_error: None,
                delivery_suppressed: 0,
                delivery_times: VecDeque::new(),
            }),
        }
    }

    fn deliver_all(&self, deliveries: Vec<(Entry, bool)>) {
        if deliveries.is_empty() {
            return;
        }
        let mut error = None;
        for (entry, sound) in deliveries {
            if let Err(failure) = (self.deliver)(&entry, sound) {
                if error.is_none() { error = Some(failure); }
            }
        }
        if let Ok(mut state) = self.state.lock() {
            if state.delivery_error != error {
                state.delivery_error = error;
                state.revision = state.revision.saturating_add(1).min(MAX_REVISION);
            }
        }
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("DX alerts are shutting down.".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "DX alert state is unavailable")?;
        let changed = state.purge(now_ms());
        if changed { state.revision = state.revision.saturating_add(1).min(MAX_REVISION); }
        let snapshot = state.snapshot();
        drop(state);
        if changed { (self.publish)(); }
        Ok(snapshot)
    }

    pub fn save(
        &self,
        expected_generation: &str,
        expected_revision: u64,
        editable: Value,
    ) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("DX alerts are shutting down.".into());
        }
        let editable: EditableConfiguration = serde_json::from_value(editable)
            .map_err(|_| "DX alert settings could not be verified.".to_string())?;
        editable.validate()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "DX alert state is unavailable")?;
        if state.configuration.generation != expected_generation
            || state.configuration.revision != expected_revision
        {
            return Err(
                "DX alert settings changed in another window. Reload them before saving.".into(),
            );
        }
        let revision = state
            .configuration
            .revision
            .checked_add(1)
            .filter(|value| *value <= MAX_REVISION)
            .ok_or("DX alert settings revision exhausted.")?;
        let next = Configuration {
            version: 1,
            generation: state.configuration.generation.clone(),
            revision,
            enabled: editable.enabled,
            dedup_seconds: editable.dedup_seconds,
            retention_minutes: editable.retention_minutes,
            native_popup: editable.native_popup,
            notification_sound: editable.notification_sound,
            rules: editable.rules,
        };
        persist(&self.path, &next)?;
        state.configuration = next;
        state.activity = ActivitySource::default();
        state.storage_error = None;
        state.baseline_next = true;
        state.baselined = false;
        state.seen.clear();
        state.seen_order.clear();
        state.delivery_error = None;
        state.delivery_suppressed = 0;
        state.delivery_times.clear();
        state.revision = state.revision.saturating_add(1).min(MAX_REVISION);
        let snapshot = state.snapshot();
        drop(state);
        (self.publish)();
        Ok(snapshot)
    }

    pub fn test_alert(&self) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("DX alerts are shutting down.".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "DX alert state is unavailable")?;
        let now = now_ms();
        let entry = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            test: true,
            source: "test".into(),
            callsign: "TEST".into(),
            frequency_khz: 14_074.0,
            band: "20m".into(),
            mode: "FT8".into(),
            comment: String::new(),
            call_status: "New Call".into(),
            dxcc_status: "ATNO".into(),
            special_tags: vec![],
            rule_names: vec!["Test alert".into()],
            count: 1,
            first_seen_ms: now,
            last_seen_ms: now,
        };
        let delivery = state.delivery(&entry, now).into_iter().collect();
        state.entries.push_front(entry);
        state.purge(now);
        state.revision = state.revision.saturating_add(1).min(MAX_REVISION);
        drop(state);
        self.deliver_all(delivery);
        (self.publish)();
        self.snapshot()
    }

    pub fn clear(&self) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("DX alerts are shutting down.".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "DX alert state is unavailable")?;
        state.entries.clear();
        state.revision = state.revision.saturating_add(1).min(MAX_REVISION);
        let snapshot = state.snapshot();
        drop(state);
        (self.publish)();
        Ok(snapshot)
    }

    pub fn observe(&self, projection: &Value) -> Result<bool, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Ok(false);
        }
        let revision = projection["revision"]
            .as_u64()
            .filter(|value| *value <= MAX_REVISION)
            .ok_or("DX alert source revision is invalid.")?;
        let available = projection["available"]
            .as_bool()
            .ok_or("DX alert source availability is invalid.")?;
        let received_at_ms = projection["received_at_ms"].as_u64().unwrap_or(0);
        let values: &[Value] = if available {
            projection["response"]["snapshot"]["spots"]
                .as_array()
                .filter(|spots| spots.len() <= 500)
                .ok_or("DX alert source spots are invalid.")?
                .as_slice()
        } else {
            &[]
        };
        let parsed: Vec<Spot> = values.iter().filter_map(spot).collect();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "DX alert state is unavailable")?;
        let availability_changed = state.source_available != available;
        let source_changed = availability_changed || state.source_revision != revision
            || state.source_received_at_ms != received_at_ms;
        state.source_revision = revision;
        state.source_available = available;
        state.source_received_at_ms = received_at_ms;
        if !available {
            if availability_changed {
                state.baseline_next = true;
                state.baselined = false;
                state.seen.clear();
                state.seen_order.clear();
            }
            return self.evaluate(state, vec![], source_changed);
        }
        if state.baseline_next {
            for spot in parsed {
                state.remember(spot.source_key);
            }
            state.baseline_next = false;
            state.baselined = true;
            return self.evaluate(state, vec![], true);
        }
        let parsed = parsed.into_iter().filter(|spot| state.remember(spot.source_key.clone())).collect();
        self.evaluate(state, parsed, source_changed)
    }

    /// Called only by the existing native projection loop; never by a renderer.
    pub fn observe_activity(&self, projection: &Value) -> Result<bool, String> {
        if self.stopped.load(Ordering::Acquire) { return Ok(false); }
        let epoch = projection["epoch"].as_str().filter(|epoch| valid_uuid(epoch)).ok_or("Invalid WSJT-X activity epoch.")?;
        let revision = projection["revision"].as_u64().filter(|value| *value <= MAX_REVISION).ok_or("Invalid WSJT-X activity revision.")?;
        let available = projection["available"].as_bool().ok_or("Invalid WSJT-X activity availability.")?;
        let values = projection["spots"].as_array().filter(|values| values.len() <= 200).ok_or("Invalid WSJT-X activity spots.")?;
        let now = now_ms();
        let parsed: Vec<Spot> = values.iter().filter(|value| value["receivedAtMs"].as_u64().is_some_and(|at| at <= now && now - at <= 60_000))
            .filter_map(spot).map(|mut spot| { spot.source = "wsjtx".into(); spot }).collect();
        let mut state = self.state.lock().map_err(|_| "DX alert state is unavailable")?;
        if state.activity.epoch.as_deref() == Some(epoch) && revision < state.activity.revision { return Err("WSJT-X activity revision regressed.".into()); }
        if state.activity.epoch.as_deref() == Some(epoch) && revision == state.activity.revision && state.activity.available == available { return Ok(false); }
        let baseline = !state.activity.baselined || state.activity.epoch.as_deref() != Some(epoch);
        if state.activity.epoch.as_deref() != Some(epoch) { state.activity = ActivitySource::default(); }
        state.activity.epoch = Some(epoch.to_owned()); state.activity.revision = revision;
        state.activity.available = available; state.activity.received_at_ms = projection["received_at_ms"].as_u64().unwrap_or(0);
        state.activity.baselined = available;
        let fresh = parsed.into_iter().filter(|spot| state.activity.remember(spot.source_key.clone())).collect();
        if !available || baseline {
            return self.evaluate(state, vec![], true);
        }
        self.evaluate(state, fresh, true)
    }

    pub fn activity_unavailable(&self) {
        if let Ok(mut state) = self.state.lock() {
            if state.activity.available {
                state.activity.available = false; state.activity.baselined = false;
                state.revision = state.revision.saturating_add(1).min(MAX_REVISION);
                drop(state); (self.publish)();
            }
        }
    }

    fn evaluate(&self, mut state: std::sync::MutexGuard<'_, State>, parsed: Vec<Spot>, mut changed: bool) -> Result<bool, String> {
        let now = now_ms();
        let mut deliveries = Vec::new();
        for spot in parsed {
            if !state.configuration.enabled {
                continue;
            }
            let rules: Vec<_> = state
                .configuration
                .rules
                .iter()
                .filter(|rule| rule.matches(&spot))
                .collect();
            if rules.is_empty() {
                continue;
            }
            let mut rule_names: Vec<String> = rules.iter().map(|rule| rule.name.clone()).collect();
            rule_names.sort();
            rule_names.dedup();
            let semantic = format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
                spot.source,
                spot.callsign,
                spot.band,
                spot.mode_group,
                rule_names.join("\u{1e}")
            );
            let dedup_ms = state.configuration.dedup_seconds.saturating_mul(1_000);
            if let Some(entry) = state.entries.iter_mut().find(|entry| {
                !entry.test
                    && format!(
                        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
                        entry.source,
                        entry.callsign,
                        entry.band,
                        mode_group(&entry.mode),
                        entry.rule_names.join("\u{1e}")
                    ) == semantic
                    && now.saturating_sub(entry.last_seen_ms) <= dedup_ms
            }) {
                entry.count = entry.count.saturating_add(1).min(MAX_REVISION);
                entry.last_seen_ms = now;
                entry.frequency_khz = spot.frequency_khz;
                entry.mode = spot.mode;
                entry.comment = spot.comment;
                entry.call_status = spot.call_status;
                entry.dxcc_status = spot.dxcc_status;
                entry.special_tags = spot.special_tags;
                changed = true;
                continue;
            }
            let entry = Entry {
                id: uuid::Uuid::new_v4().to_string(),
                test: false,
                source: spot.source,
                callsign: spot.callsign,
                frequency_khz: spot.frequency_khz,
                band: spot.band,
                mode: spot.mode,
                comment: spot.comment,
                call_status: spot.call_status,
                dxcc_status: spot.dxcc_status,
                special_tags: spot.special_tags,
                rule_names,
                count: 1,
                first_seen_ms: now,
                last_seen_ms: now,
            };
            if let Some(delivery) = state.delivery(&entry, now) {
                deliveries.push(delivery);
            }
            state.entries.push_front(entry);
            changed = true;
        }
        changed |= state.purge(now);
        if changed {
            state.revision = state.revision.saturating_add(1).min(MAX_REVISION);
        }
        drop(state);
        if changed {
            self.deliver_all(deliveries);
            (self.publish)();
        }
        Ok(changed)
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }
}

static OWNER: OnceLock<Arc<Owner>> = OnceLock::new();

pub fn install(app: &tauri::AppHandle) -> Result<Arc<Owner>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "DX alert storage is unavailable.")?
        .join("dx-alert-rules.json");
    Ok(OWNER
        .get_or_init(|| {
            let publisher = app.clone();
            let notifier = app.clone();
            Arc::new(Owner::new(
                path,
                Arc::new(move || {
                    let _ = publisher.emit_to("alerts", "xlog:dx-alerts", ());
                }),
                Arc::new(move |entry, sound| {
                    let body = format!(
                        "{} · {:.3} MHz · {}",
                        entry.rule_names.join(", "),
                        entry.frequency_khz / 1_000.0,
                        entry.mode
                    );
                    let mut notification = notifier
                        .notification()
                        .builder()
                        .title(format!("DX alert · {}", entry.callsign))
                        .body(body)
                        .group("dx-alerts");
                    if sound {
                        #[cfg(target_os = "macos")]
                        {
                            notification = notification.sound("Ping");
                        }
                        #[cfg(target_os = "linux")]
                        {
                            notification = notification.sound("message-new-instant");
                        }
                    } else {
                        notification = notification.silent();
                    }
                    notification
                        .show()
                        .map_err(|_| "Native DX alert notification could not be shown.".to_string())
                }),
            ))
        })
        .clone())
}
pub fn existing() -> Option<Arc<Owner>> {
    OWNER.get().cloned()
}
pub fn shutdown() {
    if let Some(owner) = OWNER.get() {
        owner.stop();
    }
}
pub fn validate(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if crate::workspace_windows::surface_role(label) != "alerts" || isolated || exiting {
        return Err("DX alerts are unavailable in this window.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn owner(directory: &Path) -> Owner {
        Owner::new(
            directory.join("dx-alert-rules.json"),
            Arc::new(|| {}),
            Arc::new(|_, _| Ok(())),
        )
    }
    fn editable(enabled: bool, rules: Vec<Rule>) -> Value {
        serde_json::to_value(EditableConfiguration {
            enabled,
            dedup_seconds: 300,
            retention_minutes: 120,
            native_popup: false,
            notification_sound: false,
            rules,
        })
        .unwrap()
    }
    fn rule(id: &str, name: &str, dxcc: &[&str]) -> Rule {
        Rule {
            sources: cluster_source(),
            id: id.into(),
            name: name.into(),
            enabled: true,
            callsign_glob: String::new(),
            comment_contains: String::new(),
            bands: vec![],
            modes: vec![],
            call_statuses: vec![],
            dxcc_statuses: dxcc.iter().map(|value| (*value).into()).collect(),
            specials: vec![],
        }
    }
    fn spot(id: &str, callsign: &str, dxcc_status: &str) -> Value {
        json!({"id":id,"callsign":callsign,
        "frequencyKHz":14074.0,"band":"20m","mode":"FT8","callStatus":"New Call","dxccStatus":dxcc_status,
        "specialTags":[],"activation":{"sourceEpoch":"00000000-0000-4000-8000-000000000001","spotVersion":id}})
    }
    fn projection(revision: u64, spots: Vec<Value>) -> Value {
        json!({"revision":revision,"available":true,
        "received_at_ms":revision * 1000,"response":{"snapshot":{"spots":spots}}})
    }

    #[test]
    fn source_metadata_changes_advance_once_even_without_matching_entries() {
        let directory = tempfile::tempdir().unwrap();
        let owner = owner(directory.path());
        owner.observe(&projection(1, vec![])).unwrap();
        let before = owner.snapshot().unwrap();
        assert!(owner.observe(&projection(2, vec![])).unwrap());
        let after = owner.snapshot().unwrap();
        assert_eq!(after["revision"].as_u64().unwrap(), before["revision"].as_u64().unwrap() + 1);
        assert_eq!(after["source"]["revision"], 2);
        assert_eq!(after["source"]["receivedAtMs"], 2000);
        assert!(!owner.observe(&projection(2, vec![])).unwrap());
        assert_eq!(owner.snapshot().unwrap(), after);

        owner.observe(&json!({"revision":3,"available":false})).unwrap();
        let unavailable = owner.snapshot().unwrap();
        assert!(owner.observe(&json!({"revision":4,"available":false})).unwrap());
        assert_eq!(owner.snapshot().unwrap()["revision"].as_u64().unwrap(), unavailable["revision"].as_u64().unwrap() + 1);

        let configuration = owner.snapshot().unwrap()["configuration"].clone();
        let mut both_sources = rule("watch", "Watch", &[]);
        both_sources.sources = vec!["cluster".into(), "wsjtx".into()];
        both_sources.callsign_glob = "W1*".into();
        owner.save(configuration["generation"].as_str().unwrap(), 0,
            editable(true, vec![both_sources])).unwrap();
        owner.observe(&projection(5, vec![])).unwrap();
        let before_match = owner.snapshot().unwrap()["revision"].as_u64().unwrap();
        owner.observe(&projection(6, vec![spot("fresh", "W1AW", "ATNO")])).unwrap();
        assert_eq!(owner.snapshot().unwrap()["revision"].as_u64().unwrap(), before_match + 1);

        owner.observe_activity(&activity(1, vec![])).unwrap();
        let before_cq = owner.snapshot().unwrap()["revision"].as_u64().unwrap();
        owner.observe_activity(&activity(2, vec![cq("fresh-cq", "W1AW", now_ms())])).unwrap();
        assert_eq!(owner.snapshot().unwrap()["revision"].as_u64().unwrap(), before_cq + 1);
    }

    #[test]
    fn retention_purges_advance_revision_and_publish_once_on_reads_or_observations() {
        let directory = tempfile::tempdir().unwrap();
        let publishes = Arc::new(AtomicU64::new(0));
        let count = publishes.clone();
        let owner = Owner::new(directory.path().join("rules.json"),
            Arc::new(move || { count.fetch_add(1, Ordering::SeqCst); }), Arc::new(|_, _| Ok(())));
        for read in [true, false] {
            owner.test_alert().unwrap();
            {
                let mut state = owner.state.lock().unwrap();
                state.entries[0].test = false;
                state.entries[0].last_seen_ms = now_ms() - 86_400_001;
            }
            let revision = owner.state.lock().unwrap().revision;
            let notices = publishes.load(Ordering::SeqCst);
            if read { owner.snapshot().unwrap(); }
            else { assert!(owner.observe(&json!({"revision":0,"available":false})).unwrap()); }
            let snapshot = owner.snapshot().unwrap();
            assert_eq!(snapshot["entries"], json!([]));
            assert_eq!(snapshot["revision"].as_u64().unwrap(), revision + 1);
            assert_eq!(publishes.load(Ordering::SeqCst), notices + 1);
            assert_eq!(owner.snapshot().unwrap(), snapshot);
        }
    }

    #[test]
    fn queued_notifications_are_all_attempted_and_first_failure_is_retained() {
        let directory = tempfile::tempdir().unwrap();
        let attempts = Arc::new(AtomicU64::new(0));
        let count = attempts.clone();
        let owner = Owner::new(directory.path().join("rules.json"), Arc::new(|| {}),
            Arc::new(move |_, _| match count.fetch_add(1, Ordering::SeqCst) {
                0 => Err("first failure".into()),
                1 => Err("later failure".into()),
                _ => Ok(()),
            }));
        let initial = owner.snapshot().unwrap();
        let mut settings = editable(true, vec![rule("new-dxcc", "New DXCC", &["ATNO"])]);
        settings["nativePopup"] = json!(true);
        owner.save(initial["configuration"]["generation"].as_str().unwrap(), 0, settings).unwrap();
        owner.observe(&projection(1, vec![])).unwrap();
        owner.observe(&projection(2, (0..3).map(|index|
            spot(&format!("fresh-{index}"), &format!("NEW{index}"), "ATNO")).collect())).unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["entries"].as_array().unwrap().len(), 3);
        assert_eq!(snapshot["delivery"]["error"], "first failure");
        assert_eq!(snapshot["delivery"]["suppressed"], 0);
    }

    #[test]
    fn default_is_off_and_first_projection_only_establishes_a_baseline() {
        let directory = tempfile::tempdir().unwrap();
        let owner = owner(directory.path());
        owner
            .observe(&projection(1, vec![spot("one", "OM0RX", "ATNO")]))
            .unwrap();
        let value = owner.snapshot().unwrap();
        assert_eq!(value["configuration"]["enabled"], false);
        assert_eq!(value["source"]["baselined"], true);
        assert_eq!(value["entries"], json!([]));
    }

    fn activity(revision: u64, spots: Vec<Value>) -> Value {
        json!({"epoch":"00000000-0000-4000-8000-000000000009","revision":revision,"available":true,"received_at_ms":now_ms(),"spots":spots})
    }
    fn cq(id: &str, callsign: &str, at: u64) -> Value {
        let mut value = spot(id, callsign, "Unknown");
        value["receivedAtMs"] = json!(at); value["callStatus"] = json!("Unknown"); value["comment"] = json!(format!("CQ {callsign}")); value
    }

    #[test]
    fn cq_activity_uses_same_rules_with_independent_baseline_repeat_merge_and_expiry() {
        let directory = tempfile::tempdir().unwrap(); let owner = owner(directory.path());
        let mut cq_rule = rule("cq", "CQ watch", &[]); cq_rule.sources = vec!["wsjtx".into()]; cq_rule.callsign_glob = "W1*".into();
        let initial = owner.snapshot().unwrap();
        owner.save(initial["configuration"]["generation"].as_str().unwrap(), 0, editable(true, vec![cq_rule])).unwrap();
        // The cluster is unavailable throughout; WSJT-X independently establishes its baseline.
        owner.observe(&json!({"revision":1,"available":false})).unwrap();
        owner.observe_activity(&activity(1, vec![cq("baseline", "W1AW", now_ms())])).unwrap();
        assert_eq!(owner.snapshot().unwrap()["entries"], json!([]));
        let first = cq("sender-one-period-one", "W1AW", now_ms());
        owner.observe_activity(&activity(2, vec![first.clone()])).unwrap();
        owner.observe_activity(&activity(3, vec![first.clone()])).unwrap();
        assert_eq!(owner.snapshot().unwrap()["entries"][0]["count"], 1);
        owner.observe_activity(&activity(4, vec![first, cq("sender-two-period-one", "W1AW", now_ms())])).unwrap();
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["entries"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["entries"][0]["count"], 2); assert_eq!(snapshot["entries"][0]["source"], "wsjtx");
        owner.observe_activity(&activity(5, vec![cq("stale", "W1AW", now_ms() - 60_001)])).unwrap();
        assert_eq!(owner.snapshot().unwrap()["entries"][0]["count"], 2);
        // A stopped/replaced listener baselines all retained reports again.
        owner.activity_unavailable();
        owner.observe_activity(&activity(6, vec![cq("after-reconnect", "W1AW", now_ms())])).unwrap();
        assert_eq!(owner.snapshot().unwrap()["entries"][0]["count"], 2);
    }

    #[test]
    fn legacy_cluster_rules_cannot_start_matching_cq_and_malformed_sources_fail_closed() {
        let legacy = serde_json::to_value(rule("legacy", "Cluster only", &[])).unwrap();
        let mut legacy_object = legacy.as_object().unwrap().clone(); legacy_object.remove("sources");
        let migrated: Rule = serde_json::from_value(Value::Object(legacy_object)).unwrap();
        assert_eq!(migrated.sources, cluster_source());
        let mut value = super::spot(&cq("one", "W1AW", now_ms())).unwrap(); value.source = "wsjtx".into();
        assert!(!migrated.matches(&value));
        let directory = tempfile::tempdir().unwrap(); let owner = owner(directory.path());
        assert!(owner.observe_activity(&json!({"epoch":"bad","revision":1,"available":true,"spots":[]})).is_err());
        let mut invalid = activity(1, vec![]); invalid["spots"] = json!(vec![Value::Null; 201]);
        assert!(owner.observe_activity(&invalid).is_err());
        assert_eq!(owner.snapshot().unwrap()["entries"], json!([]));
    }

    #[test]
    fn comment_condition_is_literal_case_insensitive_and_combines_with_other_conditions() {
        let mut rule = rule("parks", "New park", &["ATNO"]);
        rule.comment_contains = " pOtA K-1234 ".into();
        assert!(rule.validate().is_ok());
        let mut value = spot("one", "OM0RX", "ATNO");
        value["comment"] = json!("CQ POTA k-1234 in park");
        assert!(rule.matches(&super::spot(&value).unwrap()));
        value["dxccStatus"] = json!("Worked");
        assert!(!rule.matches(&super::spot(&value).unwrap()));
        value["dxccStatus"] = json!("ATNO");
        rule.comment_contains = "POTA.*".into();
        assert!(!rule.matches(&super::spot(&value).unwrap()));
        value["comment"] = json!("CQ POTA.* literal");
        assert!(rule.matches(&super::spot(&value).unwrap()));
        for comment in [
            Value::Null,
            json!(""),
            json!("POTA.*\n"),
            json!("x".repeat(513)),
        ] {
            value["comment"] = comment;
            assert!(!rule.matches(&super::spot(&value).unwrap()));
        }
        rule.comment_contains.clear();
        assert!(rule.matches(&super::spot(&value).unwrap()));
    }

    #[test]
    fn comment_filtered_reports_retain_latest_matching_evidence_without_replay() {
        let directory = tempfile::tempdir().unwrap();
        let owner = owner(directory.path());
        let initial = owner.snapshot().unwrap();
        let mut parks = rule("parks", "Park watch", &["ATNO"]);
        parks.comment_contains = "POTA".into();
        owner
            .save(
                initial["configuration"]["generation"].as_str().unwrap(),
                0,
                editable(true, vec![parks]),
            )
            .unwrap();
        owner.observe(&projection(1, vec![])).unwrap();
        let mut matched = spot("matched", "OM0RX", "ATNO");
        matched["comment"] = json!("CQ pota K-1234");
        owner
            .observe(&projection(
                2,
                vec![spot("missing", "OM1RX", "ATNO"), matched.clone()],
            ))
            .unwrap();
        owner.observe(&projection(3, vec![matched])).unwrap();
        let first = owner.snapshot().unwrap();
        assert_eq!(first["entries"].as_array().unwrap().len(), 1);
        assert_eq!(first["entries"][0]["comment"], "CQ pota K-1234");
        assert_eq!(first["entries"][0]["count"], 1);
        let mut repeat = spot("repeat", "OM0RX", "ATNO");
        repeat["comment"] = json!("POTA K-5678");
        owner.observe(&projection(4, vec![repeat])).unwrap();
        let latest = owner.snapshot().unwrap();
        assert_eq!(latest["entries"][0]["count"], 2);
        assert_eq!(latest["entries"][0]["comment"], "POTA K-5678");
        let (saved, error) = read(&directory.path().join("dx-alert-rules.json"));
        assert!(error.is_none());
        assert_eq!(saved.rules[0].comment_contains, "POTA");
        let mut invalid = saved.rules.clone();
        invalid[0].comment_contains = "x".repeat(81);
        assert!(owner
            .save(&saved.generation, saved.revision, editable(true, invalid))
            .is_err());
        assert_eq!(read(&directory.path().join("dx-alert-rules.json")).0, saved);
    }

    #[test]
    fn comment_condition_migrates_unrestricted_and_rejects_unbounded_or_hidden_text() {
        let mut legacy = serde_json::to_value(Configuration::default_off()).unwrap();
        legacy["rules"][0]
            .as_object_mut()
            .unwrap()
            .remove("commentContains");
        let configuration: Configuration = serde_json::from_value(legacy).unwrap();
        assert!(configuration.validate().is_ok());
        assert_eq!(configuration.rules[0].comment_contains, "");
        let mut rule = rule("comment", "Comment only", &[]);
        for invalid in [
            " ".to_owned(),
            "POTA\n".into(),
            "é".repeat(41),
            "x".repeat(81),
        ] {
            rule.comment_contains = invalid;
            assert!(rule.validate().is_err());
        }
        rule.comment_contains = "POTA".into();
        assert!(rule.validate().is_ok());
    }

    #[test]
    fn named_rules_merge_new_source_reports_and_stable_identity_blocks_snapshot_replay() {
        let directory = tempfile::tempdir().unwrap();
        let owner = owner(directory.path());
        let initial = owner.snapshot().unwrap();
        let rules = vec![
            rule("new-dxcc", "New DXCC", &["ATNO"]),
            rule("all-new", "All new", &["ATNO", "C/New Band"]),
        ];
        owner
            .save(
                initial["configuration"]["generation"].as_str().unwrap(),
                0,
                editable(true, rules),
            )
            .unwrap();
        owner
            .observe(&projection(1, vec![spot("baseline", "OLD1", "ATNO")]))
            .unwrap();
        owner
            .observe(&projection(
                2,
                vec![
                    spot("baseline", "OLD1", "ATNO"),
                    spot("fresh-a", "NEW1", "ATNO"),
                ],
            ))
            .unwrap();
        owner
            .observe(&projection(
                3,
                vec![
                    spot("fresh-a", "NEW1", "ATNO"),
                    spot("fresh-b", "NEW1", "ATNO"),
                ],
            ))
            .unwrap();
        let value = owner.snapshot().unwrap();
        let entries = value["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["callsign"], "NEW1");
        assert_eq!(entries[0]["count"], 2);
        assert_eq!(entries[0]["ruleNames"], json!(["All new", "New DXCC"]));
    }

    #[test]
    fn save_is_revision_checked_atomic_and_invalid_rules_never_replace_saved_state() {
        let directory = tempfile::tempdir().unwrap();
        let owner = owner(directory.path());
        let before = owner.snapshot().unwrap();
        let generation = before["configuration"]["generation"].as_str().unwrap();
        let saved = owner
            .save(
                generation,
                0,
                editable(true, vec![rule("new-dxcc", "New DXCC", &["ATNO"])]),
            )
            .unwrap();
        assert_eq!(saved["configuration"]["revision"], 1);
        assert!(owner.save(generation, 0, editable(false, vec![])).is_err());
        let invalid = Rule {
            sources: cluster_source(),
            id: "all".into(),
            name: "Everything".into(),
            enabled: true,
            callsign_glob: String::new(),
            comment_contains: String::new(),
            bands: vec![],
            modes: vec![],
            call_statuses: vec![],
            dxcc_statuses: vec![],
            specials: vec![],
        };
        assert!(owner
            .save(generation, 1, editable(true, vec![invalid]))
            .is_err());
        let (reloaded, error) = read(&directory.path().join("dx-alert-rules.json"));
        assert!(error.is_none());
        assert!(reloaded.enabled);
        assert_eq!(reloaded.revision, 1);
    }

    #[test]
    fn version_one_settings_migrate_delivery_off_and_reject_sound_without_popup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dx-alert-rules.json");
        let mut legacy = serde_json::to_value(Configuration::default_off()).unwrap();
        legacy.as_object_mut().unwrap().remove("nativePopup");
        legacy.as_object_mut().unwrap().remove("notificationSound");
        std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let (configuration, error) = read(&path);
        assert!(error.is_none());
        assert!(!configuration.native_popup);
        assert!(!configuration.notification_sound);

        let owner = owner(directory.path());
        let initial = owner.snapshot().unwrap();
        let mut invalid = editable(false, vec![]);
        invalid["notificationSound"] = json!(true);
        assert!(owner
            .save(
                initial["configuration"]["generation"].as_str().unwrap(),
                0,
                invalid,
            )
            .is_err());
    }

    #[test]
    fn test_and_clear_are_dashboard_only_and_publishing_is_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let publishes = Arc::new(AtomicU64::new(0));
        let count = publishes.clone();
        let owner = Owner::new(
            directory.path().join("dx-alert-rules.json"),
            Arc::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
            }),
            Arc::new(|_, _| Ok(())),
        );
        assert_eq!(owner.test_alert().unwrap()["entries"][0]["test"], true);
        assert_eq!(publishes.load(Ordering::SeqCst), 1);
        assert_eq!(owner.clear().unwrap()["entries"], json!([]));
        assert_eq!(publishes.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn native_delivery_is_opt_in_and_rate_limited_without_replaying_spots() {
        let directory = tempfile::tempdir().unwrap();
        let deliveries = Arc::new(AtomicU64::new(0));
        let delivered = deliveries.clone();
        let owner = Owner::new(
            directory.path().join("dx-alert-rules.json"),
            Arc::new(|| {}),
            Arc::new(move |entry, sound| {
                assert!(!entry.test);
                assert!(sound);
                delivered.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }),
        );
        let initial = owner.snapshot().unwrap();
        let mut settings = editable(true, vec![rule("new-dxcc", "New DXCC", &["ATNO"])]);
        settings["nativePopup"] = json!(true);
        settings["notificationSound"] = json!(true);
        owner
            .save(
                initial["configuration"]["generation"].as_str().unwrap(),
                0,
                settings,
            )
            .unwrap();
        owner.observe(&projection(1, vec![])).unwrap();
        owner
            .observe(&projection(
                2,
                (0..5)
                    .map(|index| spot(&format!("fresh-{index}"), &format!("NEW{index}"), "ATNO"))
                    .collect(),
            ))
            .unwrap();
        assert_eq!(deliveries.load(Ordering::SeqCst), DELIVERY_LIMIT as u64);
        let snapshot = owner.snapshot().unwrap();
        assert_eq!(snapshot["entries"].as_array().unwrap().len(), 5);
        assert_eq!(snapshot["delivery"]["suppressed"], 2);
        assert_eq!(snapshot["delivery"]["error"], Value::Null);
    }

    #[test]
    fn explicit_test_uses_enabled_delivery_and_retains_a_bounded_failure() {
        let directory = tempfile::tempdir().unwrap();
        let owner = Owner::new(
            directory.path().join("dx-alert-rules.json"),
            Arc::new(|| {}),
            Arc::new(|entry, _| {
                assert!(entry.test);
                Err("fixture notification failure".into())
            }),
        );
        let initial = owner.snapshot().unwrap();
        let mut settings = editable(false, vec![]);
        settings["nativePopup"] = json!(true);
        owner
            .save(
                initial["configuration"]["generation"].as_str().unwrap(),
                0,
                settings,
            )
            .unwrap();
        let snapshot = owner.test_alert().unwrap();
        assert_eq!(
            snapshot["delivery"]["error"],
            "fixture notification failure"
        );
        assert_eq!(snapshot["entries"][0]["test"], true);
    }

    #[test]
    fn safe_globs_and_surface_gate_are_explicit() {
        assert!(glob_matches("VP2*", "VP2MUW"));
        assert!(glob_matches("?M0RX", "OM0RX"));
        assert!(!glob_matches("VP2?", "VP2MUW"));
        assert!(validate("alerts", false, false).is_ok());
        assert!(validate("main", false, false).is_err());
        assert!(validate("alerts", true, false).is_err());
        assert!(validate("alerts", false, true).is_err());
    }

    #[test]
    fn reconnect_rebaselines_without_replaying_reports_as_alerts() {
        let directory = tempfile::tempdir().unwrap();
        let owner = owner(directory.path());
        let initial = owner.snapshot().unwrap();
        owner
            .save(
                initial["configuration"]["generation"].as_str().unwrap(),
                0,
                editable(true, vec![rule("new-dxcc", "New DXCC", &["ATNO"])]),
            )
            .unwrap();
        owner
            .observe(&projection(1, vec![spot("old", "OLD1", "ATNO")]))
            .unwrap();
        assert!(owner
            .observe(&json!({"revision":2,"available":false,"received_at_ms":0}))
            .unwrap());
        assert_eq!(owner.snapshot().unwrap()["source"]["baselined"], false);
        owner
            .observe(&projection(3, vec![spot("during-outage", "NEW1", "ATNO")]))
            .unwrap();
        assert_eq!(owner.snapshot().unwrap()["entries"], json!([]));
        assert_eq!(owner.snapshot().unwrap()["source"]["baselined"], true);
    }
}
