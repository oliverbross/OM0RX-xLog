//! Voice PCM preparation and explicit native routes. No CAT/PTT or archive admission.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn callback_continuous(previous: Option<(u128, u64)>, now: u128) -> bool {
    previous.is_none_or(|(last, period)| {
        now.checked_sub(last).is_some_and(|gap| {
            gap <= u128::from(
                period
                    .saturating_mul(4)
                    .saturating_add(50_000_000)
                    .clamp(250_000_000, 2_000_000_000),
            )
        })
    })
}
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Route {
    pub device_id: String,
    pub channels: Vec<u16>,
    pub sample_rate: u32,
}
impl Route {
    pub fn validate(&self) -> Result<()> {
        if self.device_id.is_empty()
            || self.device_id.len() > 512
            || self.device_id.chars().any(char::is_control)
            || !(8_000..=192_000).contains(&self.sample_rate)
            || self.channels.is_empty()
            || self.channels.len() > 2
            || self.channels.iter().any(|c| *c >= 32)
            || (self.channels.len() == 2 && self.channels[0] == self.channels[1])
        {
            return Err(
                "Choose a concrete native audio device, rate and one or two distinct channels."
                    .into(),
            );
        }
        Ok(())
    }
    pub fn overlaps(&self, other: &Self) -> bool {
        self.device_id == other.device_id
            && self.channels.iter().any(|c| other.channels.contains(c))
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Routes {
    pub input: Option<Route>,
    pub monitor: Option<Route>,
    pub transmit: Option<Route>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edit {
    pub trim_start_ms: u32,
    pub trim_end_ms: Option<u32>,
    pub gain_db: f64,
}
impl Default for Edit {
    fn default() -> Self {
        Self {
            trim_start_ms: 0,
            trim_end_ms: None,
            gain_db: 0.0,
        }
    }
}
impl Edit {
    fn validate(&self) -> Result<()> {
        if self.trim_start_ms >= 60_000
            || self
                .trim_end_ms
                .is_some_and(|e| e <= self.trim_start_ms || e > 60_000)
            || !self.gain_db.is_finite()
            || !(-24.0..=12.0).contains(&self.gain_db)
        {
            return Err("Invalid voice trim/gain; the original recording was retained.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub version: u8,
    pub profile_path: String,
    pub labels: Vec<String>,
    pub routes: Routes,
    pub edits: Vec<Edit>,
}
impl Default for Profile {
    fn default() -> Self {
        Self {
            version: 1,
            profile_path: String::new(),
            labels: (1..=10).map(|i| format!("Voice {i}")).collect(),
            routes: Routes::default(),
            edits: vec![Edit::default(); 10],
        }
    }
}
impl Profile {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1
            || self.profile_path.len() > 2048
            || self.profile_path.chars().any(char::is_control)
            || self.labels.len() != 10
            || self.labels.iter().any(|s| {
                s.trim().is_empty()
                    || s.encode_utf16().count() > 40
                    || s.chars().any(char::is_control)
            })
            || self.edits.len() != 10
        {
            return Err("Invalid saved voice library preferences.".into());
        }
        for r in [
            &self.routes.input,
            &self.routes.monitor,
            &self.routes.transmit,
        ]
        .into_iter()
        .flatten()
        {
            r.validate()?;
        }
        for e in &self.edits {
            e.validate()?;
        }
        if self
            .routes
            .monitor
            .as_ref()
            .zip(self.routes.transmit.as_ref())
            .is_some_and(|(m, t)| m.overlaps(t))
        {
            return Err("Monitor and transmitter must use distinct device channels.".into());
        }
        Ok(())
    }
}

pub struct PCM {
    pub samples: Vec<f32>,
    pub rate: u32,
    pub peak: f32,
    pub clipped: u64,
    pub source_sha256: String,
    pub edited_pcm_sha256: String,
}
fn samples_digest(rate: u32, samples: &[f32]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"xlog-voice-pcm-v1\0");
    hash.update(rate.to_le_bytes());
    hash.update((samples.len() as u64).to_le_bytes());
    let mut block = [0u8; 4096];
    for chunk in samples.chunks(1024) {
        for (i, sample) in chunk.iter().enumerate() {
            block[i * 4..i * 4 + 4].copy_from_slice(&sample.to_bits().to_le_bytes());
        }
        hash.update(&block[..chunk.len() * 4]);
    }
    format!("{:x}", hash.finalize())
}
pub fn pcm_digest(pcm: &PCM) -> String {
    samples_digest(pcm.rate, &pcm.samples)
}
impl PCM {
    pub fn duration_ms(&self) -> u64 {
        (self.samples.len() as u64 * 1000).div_ceil(self.rate as u64)
    }
}
pub fn decode(bytes: &[u8], edit: &Edit, output_rate: u32) -> Result<PCM> {
    edit.validate()?;
    let duration = crate::contest_voice::pcm_wav_duration_ms(bytes)?;
    if duration > 60_000 || !(8_000..=192_000).contains(&output_rate) {
        return Err("Voice WAV exceeds its duration/rate limit.".into());
    }
    let mut at = 12;
    let (mut channels, mut rate, mut bits) = (0, 0, 0);
    let mut data = &[][..];
    while at + 8 <= bytes.len() {
        let n = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        let p = at + 8;
        if &bytes[at..at + 4] == b"fmt " {
            channels = u16::from_le_bytes(bytes[p + 2..p + 4].try_into().unwrap()) as usize;
            rate = u32::from_le_bytes(bytes[p + 4..p + 8].try_into().unwrap());
            bits = u16::from_le_bytes(bytes[p + 14..p + 16].try_into().unwrap()) as usize;
        }
        if &bytes[at..at + 4] == b"data" {
            data = &bytes[p..p + n];
        }
        at = p + n + (n & 1);
    }
    let size = bits / 8;
    let frames = data.len() / (size * channels);
    let start = edit.trim_start_ms as usize * rate as usize / 1000;
    let end = edit
        .trim_end_ms
        .map(|e| e as usize * rate as usize / 1000)
        .unwrap_or(frames);
    if start >= end || end > frames {
        return Err("Trim range is empty or outside the original voice recording.".into());
    }
    let gain = 10f64.powf(edit.gain_db / 20.0) as f32;
    let mut source = Vec::with_capacity(end - start);
    let (mut peak, mut clipped) = (0f32, 0);
    for frame in data[start * channels * size..end * channels * size].chunks_exact(channels * size)
    {
        let mut sum = 0f32;
        for s in frame.chunks_exact(size) {
            sum += match bits {
                8 => (s[0] as f32 - 128.0) / 128.0,
                16 => i16::from_le_bytes(s.try_into().unwrap()) as f32 / 32768.0,
                24 => ((i32::from_le_bytes([s[0], s[1], s[2], 0]) << 8) >> 8) as f32 / 8_388_608.0,
                32 => i32::from_le_bytes(s.try_into().unwrap()) as f32 / 2_147_483_648.0,
                _ => return Err("Unsupported voice PCM width.".into()),
            };
        }
        let sample = sum / channels as f32 * gain;
        peak = peak.max(sample.abs());
        if sample.abs() > 1.0 {
            clipped += 1;
        }
        source.push(sample.clamp(-1.0, 1.0));
    }
    // Defined offline linear interpolation; the callback only maps prepared mono samples.
    let edited_pcm_sha256 = samples_digest(rate, &source);
    let samples = if rate == output_rate {
        source
    } else {
        let count = (source.len() as u64 * output_rate as u64).div_ceil(rate as u64) as usize;
        (0..count)
            .map(|i| {
                let p = i as f64 * rate as f64 / output_rate as f64;
                let a = p.floor() as usize;
                let b = (a + 1).min(source.len() - 1);
                source[a.min(source.len() - 1)] * (1.0 - p.fract() as f32)
                    + source[b] * p.fract() as f32
            })
            .collect()
    };
    Ok(PCM {
        samples,
        rate: output_rate,
        peak,
        clipped,
        source_sha256: format!("{:x}", Sha256::digest(bytes)),
        edited_pcm_sha256,
    })
}

/// Backend presentation clock: final callback enqueue is deliberately not completion.
#[derive(Default)]
struct Render {
    cursor: usize,
    final_ns: Option<u64>,
}
impl Render {
    fn fill(
        &mut self,
        samples: &[f32],
        rate: u32,
        map: &[u16],
        channels: usize,
        out: &mut [f32],
        enabled: bool,
        cancelled: bool,
        callback_ns: u64,
        playback_ns: u64,
    ) -> bool {
        out.fill(0.0);
        if cancelled {
            return false;
        }
        if !enabled {
            return false;
        }
        if self.final_ns.is_some_and(|end| callback_ns >= end) {
            return true;
        }
        for (index, frame) in out.chunks_exact_mut(channels).enumerate() {
            if self.cursor >= samples.len() {
                break;
            }
            for &channel in map {
                frame[channel as usize] = samples[self.cursor];
            }
            self.cursor += 1;
            if self.cursor == samples.len() {
                self.final_ns = Some(
                    playback_ns
                        .saturating_add(((index as u64 + 1) * 1_000_000_000).div_ceil(rate as u64)),
                );
            }
        }
        false
    }
}
pub struct Signals {
    pub cancel: Arc<AtomicBool>,
    pub enabled: AtomicBool,
    pub ready: AtomicBool,
    pub done: AtomicBool,
    pub failed: AtomicBool,
    pub consumed: AtomicU64,
}
impl Signals {
    pub fn new(cancel: Arc<AtomicBool>) -> Arc<Self> {
        Arc::new(Self {
            cancel,
            enabled: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            done: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            consumed: AtomicU64::new(0),
        })
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use crate::contest_recorder_audio as shared;
    use cpal::traits::{DeviceTrait, StreamTrait};
    pub struct Output {
        _stream: cpal::Stream,
        pub signals: Arc<Signals>,
        route: Route,
        channels: u16,
    }
    impl Output {
        pub fn unchanged(&self) -> bool {
            shared::device(&self.route.device_id)
                .and_then(|d| d.default_output_config().map_err(|e| e.to_string()))
                .is_ok_and(|c| {
                    c.channels() == self.channels && c.sample_rate() == self.route.sample_rate
                })
        }
    }
    pub fn devices() -> Result<Value> {
        shared::devices()
    }
    fn route_device(route: &Route, input: bool) -> Result<(cpal::Device, u16)> {
        route.validate()?;
        let d = shared::device(&route.device_id)?;
        let cfg = if input {
            d.default_input_config()
        } else {
            d.default_output_config()
        }
        .map_err(|e| e.to_string())?;
        if cfg.sample_rate() != route.sample_rate
            || route.channels.iter().any(|c| *c >= cfg.channels())
        {
            return Err("The selected native rate/channels changed or are unavailable. Review the route; no device substitution or system setting change is allowed.".into());
        }
        Ok((d, cfg.channels()))
    }
    pub fn monitor(route: &Route, tx: Option<&Route>) -> Result<()> {
        if tx.is_some_and(|t| route.overlaps(t)) {
            return Err("Monitor preview cannot use transmitter channels.".into());
        }
        let (d, _) = route_device(route, false)?;
        let name = d
            .description()
            .map_err(|e| e.to_string())?
            .name()
            .to_ascii_lowercase();
        if name.contains("transmit") || name.contains("dax tx") || name.contains(" tx") {
            return Err(
                "The selected monitor is a known transmitter device; choose a separate monitor."
                    .into(),
            );
        }
        Ok(())
    }
    pub fn output(pcm: PCM, route: Route, cancel: Arc<AtomicBool>) -> Result<Output> {
        let (d, channels) = route_device(&route, false)?;
        let format = shared::format(&d, false, channels, route.sample_rate)?;
        // Conversion and scratch allocation happen before the callback and PTT acquisition.
        let signals = Signals::new(cancel);
        let frames = pcm.samples.len();
        let rate = route.sample_rate;
        let map = route.channels.clone();
        let make = |format| -> Result<cpal::Stream> {
            match format {
                cpal::SampleFormat::F32 => {
                    stream::<f32>(&d, channels, rate, pcm.samples, map, signals.clone())
                }
                cpal::SampleFormat::I16 => {
                    stream::<i16>(&d, channels, rate, pcm.samples, map, signals.clone())
                }
                cpal::SampleFormat::U16 => {
                    stream::<u16>(&d, channels, rate, pcm.samples, map, signals.clone())
                }
                _ => Err("Unsupported native voice output format.".into()),
            }
        };
        if frames == 0 {
            return Err("Voice memory has no prepared samples.".into());
        }
        let stream = make(format)?;
        stream.play().map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(3);
        while !signals.ready.load(Ordering::Acquire) {
            if signals.cancel.load(Ordering::Acquire) || signals.failed.load(Ordering::Acquire) {
                return Err("Voice stream preparation was cancelled or failed before PTT.".into());
            }
            if Instant::now() >= deadline {
                return Err(
                    "Voice output produced no usable presentation clock before PTT.".into(),
                );
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if signals.failed.load(Ordering::Acquire) || signals.cancel.load(Ordering::Acquire) {
            return Err("Voice stream readiness was retired before PTT.".into());
        }
        Ok(Output {
            _stream: stream,
            signals,
            route,
            channels,
        })
    }
    fn stream<T>(
        d: &cpal::Device,
        channels: u16,
        rate: u32,
        samples: Vec<f32>,
        map: Vec<u16>,
        signals: Arc<Signals>,
    ) -> Result<cpal::Stream>
    where
        T: cpal::SizedSample + cpal::FromSample<f32>,
    {
        let failure = signals.clone();
        let mut render = Render::default();
        let mut anchor = None;
        let mut last_wall = None;
        // Fixed maximum callback size; oversized buffers fail closed instead of allocating.
        let mut scratch = vec![0f32; 262_144];
        d.build_output_stream::<T, _, _>(
            shared::stream_config(channels, rate),
            move |out, info| {
                for s in out.iter_mut() {
                    *s = T::from_sample(0.0);
                }
                if signals.failed.load(Ordering::Acquire) || signals.cancel.load(Ordering::Acquire)
                {
                    return;
                }
                let wall = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|v| v.as_nanos())
                    .unwrap_or(0);
                if !callback_continuous(last_wall, wall) {
                    signals.failed.store(true, Ordering::Release);
                    signals.enabled.store(false, Ordering::Release);
                    return;
                }
                last_wall = Some((
                    wall,
                    (out.len() as u64 / channels as u64) * 1_000_000_000 / rate as u64,
                ));
                if out.len() > scratch.len() {
                    signals.failed.store(true, Ordering::Release);
                    return;
                }
                let stamp = info.timestamp();
                let epoch = *anchor.get_or_insert(stamp.callback);
                let Some(callback) = stamp.callback.checked_duration_since(epoch) else {
                    signals.failed.store(true, Ordering::Release);
                    return;
                };
                let Some(playback) = stamp.playback.checked_duration_since(epoch) else {
                    signals.failed.store(true, Ordering::Release);
                    return;
                };
                let Some(latency) = stamp.playback.checked_duration_since(stamp.callback) else {
                    signals.failed.store(true, Ordering::Release);
                    return;
                };
                if latency > Duration::from_secs(2) {
                    signals.failed.store(true, Ordering::Release);
                    return;
                }
                signals.ready.store(true, Ordering::Release);
                let done = render.fill(
                    &samples,
                    rate,
                    &map,
                    channels as usize,
                    &mut scratch[..out.len()],
                    signals.enabled.load(Ordering::Acquire),
                    signals.cancel.load(Ordering::Acquire),
                    callback.as_nanos() as u64,
                    playback.as_nanos() as u64,
                );
                for (dst, src) in out.iter_mut().zip(scratch.iter()) {
                    *dst = T::from_sample(*src);
                }
                signals
                    .consumed
                    .store(render.cursor as u64, Ordering::Release);
                if done {
                    signals.done.store(true, Ordering::Release);
                }
            },
            move |_| {
                failure.failed.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|e| format!("Native voice output unavailable: {e}"))
    }
    pub fn record(route: &Route, cancel: Arc<AtomicBool>) -> Result<Vec<u8>> {
        let (d, channels) = route_device(route, true)?;
        let format = shared::format(&d, true, channels, route.sample_rate)?;
        let (producer, mut queue) = rtrb::RingBuffer::<([i16; 4096], usize)>::new(128);
        let failed = Arc::new(AtomicBool::new(false));
        let make = |format| -> Result<cpal::Stream> {
            match format {
                cpal::SampleFormat::F32 => {
                    input::<f32>(&d, route, channels, producer, failed.clone())
                }
                cpal::SampleFormat::I16 => {
                    input::<i16>(&d, route, channels, producer, failed.clone())
                }
                cpal::SampleFormat::U16 => {
                    input::<u16>(&d, route, channels, producer, failed.clone())
                }
                _ => Err("Unsupported native microphone format.".into()),
            }
        };
        let stream = make(format)?;
        stream.play().map_err(|e| e.to_string())?;
        let limit = (route.sample_rate as usize * 60).min((8 * 1024 * 1024 - 44) / 2);
        let mut samples = Vec::with_capacity(limit);
        let deadline = Instant::now() + Duration::from_secs(60);
        while !cancel.load(Ordering::Acquire) && Instant::now() < deadline && samples.len() < limit
        {
            while let Ok((block, n)) = queue.pop() {
                let count = n.min(limit - samples.len());
                samples.extend_from_slice(&block[..count]);
                if samples.len() == limit {
                    break;
                }
            }
            if failed.load(Ordering::Acquire) {
                return Err("The selected microphone failed or its bounded capture queue overflowed; no slot was replaced.".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        drop(stream);
        while let Ok((block, n)) = queue.pop() {
            let count = n.min(limit - samples.len());
            samples.extend_from_slice(&block[..count]);
            if samples.len() == limit {
                break;
            }
        }
        recorded_wav(&samples, route.sample_rate, failed.load(Ordering::Acquire))
    }
    fn input<T>(
        d: &cpal::Device,
        route: &Route,
        channels: u16,
        mut queue: rtrb::Producer<([i16; 4096], usize)>,
        failed: Arc<AtomicBool>,
    ) -> Result<cpal::Stream>
    where
        T: cpal::SizedSample + Copy,
        f32: cpal::FromSample<T>,
    {
        let map = route.channels.clone();
        let error = failed.clone();
        let route_rate = route.sample_rate;
        let mut last_wall = None;
        d.build_input_stream::<T, _, _>(
            shared::stream_config(channels, route.sample_rate),
            move |input, _| {
                if failed.load(Ordering::Acquire) {
                    return;
                }
                let wall = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|v| v.as_nanos())
                    .unwrap_or(0);
                if !callback_continuous(last_wall, wall) {
                    failed.store(true, Ordering::Release);
                    return;
                }
                last_wall = Some((
                    wall,
                    (input.len() as u64 / channels as u64) * 1_000_000_000 / route_rate as u64,
                ));
                let mut block = [0i16; 4096];
                let mut n = 0;
                for frame in input.chunks_exact(channels as usize) {
                    let mut sum = 0f32;
                    for &c in &map {
                        sum += <f32 as cpal::Sample>::from_sample(frame[c as usize]);
                    }
                    let value = sum / map.len() as f32;
                    if !value.is_finite() {
                        failed.store(true, Ordering::Release);
                        return;
                    }
                    block[n] = (value * 32768.0).clamp(-32768.0, 32767.0) as i16;
                    n += 1;
                    if n == block.len() {
                        if queue.push((block, n)).is_err() {
                            failed.store(true, Ordering::Release);
                            return;
                        }
                        n = 0;
                    }
                }
                if n > 0 && queue.push((block, n)).is_err() {
                    failed.store(true, Ordering::Release);
                }
            },
            move |_| {
                error.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|e| format!("Native microphone unavailable (check permission): {e}"))
    }
}
#[cfg(target_os = "macos")]
pub use native::*;
#[cfg(not(target_os = "macos"))]
mod unsupported {
    use super::*;
    pub struct Output {
        pub signals: Arc<Signals>,
    }
    impl Output {
        pub fn unchanged(&self) -> bool {
            false
        }
    }
    pub fn devices() -> Result<Value> {
        Ok(serde_json::json!([]))
    }
    pub fn monitor(_: &Route, _: Option<&Route>) -> Result<()> {
        Err("Native voice routes are available on macOS only in this release.".into())
    }
    pub fn output(_: PCM, _: Route, _: Arc<AtomicBool>) -> Result<Output> {
        Err("Native voice routes are unavailable on this platform.".into())
    }
    pub fn record(_: &Route, _: Arc<AtomicBool>) -> Result<Vec<u8>> {
        Err("Native voice recording is unavailable on this platform.".into())
    }
}
#[cfg(not(target_os = "macos"))]
pub use unsupported::*;

#[cfg(any(target_os = "macos", test))]
fn recorded_wav(samples: &[i16], rate: u32, failed: bool) -> Result<Vec<u8>> {
    if failed {
        return Err("The selected microphone failed or its bounded capture queue overflowed; no slot was replaced.".into());
    }
    if samples.is_empty() {
        return Err(
            "No microphone samples were captured (check permission and selected device).".into(),
        );
    }
    Ok(wav(samples, rate))
}
pub fn wav(samples: &[i16], rate: u32) -> Vec<u8> {
    let n = (samples.len() * 2) as u32;
    let mut b = Vec::with_capacity(n as usize + 44);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + n).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * 2).to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&n.to_le_bytes());
    for s in samples {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_failure_reported_during_stream_teardown_cannot_publish_partial_audio() {
        struct FailedStream(Arc<AtomicBool>);
        impl Drop for FailedStream {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let failed = Arc::new(AtomicBool::new(false));
        let samples = [i16::MIN, i16::MAX];
        {
            let _stream = FailedStream(failed.clone());
            assert!(!failed.load(Ordering::Acquire));
        }
        assert!(recorded_wav(&samples, 48_000, failed.load(Ordering::Acquire)).is_err());
        assert!(recorded_wav(&[], 48_000, false).is_err());
        let bytes = recorded_wav(&samples, 48_000, false).unwrap();
        assert_eq!(
            decode(&bytes, &Edit::default(), 48_000)
                .unwrap()
                .samples
                .len(),
            2
        );
    }
    #[test]
    fn source_and_edited_memory_digest_are_stable_across_reviewed_route_resampling() {
        let bytes = wav(&[16_384, -16_384], 8000);
        let original = decode(&bytes, &Edit::default(), 8000).unwrap();
        // Independent hand-written domain/rate/frame/f32 golden, SHA-256 checked with Python hashlib.
        assert_eq!(
            pcm_digest(&original),
            "4f279977de5d1165dcb2687fab44368895fea8b2f73cb24b7da4c3bc5be34713"
        );
        let resampled = decode(&bytes, &Edit::default(), 16000).unwrap();
        assert_eq!(original.source_sha256, resampled.source_sha256);
        assert_eq!(original.edited_pcm_sha256, resampled.edited_pcm_sha256);
        assert_ne!(pcm_digest(&original), pcm_digest(&resampled));
        let edited = decode(
            &bytes,
            &Edit {
                trim_start_ms: 0,
                trim_end_ms: None,
                gain_db: -6.0,
            },
            8000,
        )
        .unwrap();
        assert_eq!(edited.source_sha256, original.source_sha256);
        assert_ne!(edited.edited_pcm_sha256, original.edited_pcm_sha256);
    }
    #[test]
    fn sleep_clock_reversal_and_backend_callback_gaps_retire_audio_before_another_sample() {
        assert!(callback_continuous(None, 1_000_000_000));
        assert!(callback_continuous(
            Some((1_000_000_000, 10_000_000)),
            1_010_000_000
        ));
        assert!(!callback_continuous(
            Some((1_000_000_000, 10_000_000)),
            31_000_000_000
        ));
        assert!(!callback_continuous(
            Some((1_000_000_000, 10_000_000)),
            999_999_999
        ));
    }
    #[test]
    fn source_edit_and_resample_preserve_endpoints_clipping_and_original() {
        let mut original = vec![0i16; 800];
        original[0] = 16384;
        original[799] = -16384;
        let bytes = wav(&original, 8000);
        let p = decode(&bytes, &Edit::default(), 8000).unwrap();
        assert_eq!(p.samples.len(), 800);
        assert_eq!(p.samples[0], 0.5);
        assert_eq!(p.samples[799], -0.5);
        let p = decode(
            &bytes,
            &Edit {
                trim_start_ms: 0,
                trim_end_ms: Some(100),
                gain_db: 12.0,
            },
            16000,
        )
        .unwrap();
        assert_eq!(p.samples.len(), 1600);
        assert_eq!(p.samples[0], 1.0);
        assert_eq!(p.samples[1599], -1.0);
        assert_eq!(p.clipped, 2);
        assert_eq!(bytes, wav(&original, 8000));
        assert!(decode(
            &bytes,
            &Edit {
                trim_start_ms: 99,
                trim_end_ms: Some(101),
                gain_db: 0.0
            },
            8000
        )
        .is_err());
    }
    #[test]
    fn presentation_drain_waits_for_final_nonzero_sample_and_stop_never_resumes() {
        let mut render = Render::default();
        let mut out = [0f32; 8];
        let samples = [0.5, -0.5];
        assert!(!render.fill(
            &samples,
            8000,
            &[1],
            2,
            &mut out,
            false,
            false,
            0,
            10_000_000
        ));
        assert_eq!(render.cursor, 0);
        assert_eq!(out, [0.0; 8]);
        assert!(!render.fill(
            &samples,
            8000,
            &[1],
            2,
            &mut out,
            true,
            false,
            1_000_000,
            11_000_000
        ));
        assert_eq!(out, [0.0, 0.5, 0.0, -0.5, 0.0, 0.0, 0.0, 0.0]);
        assert!(!render.fill(
            &samples,
            8000,
            &[1],
            2,
            &mut out,
            true,
            false,
            11_249_999,
            21_000_000
        ));
        assert!(render.fill(
            &samples,
            8000,
            &[1],
            2,
            &mut out,
            true,
            false,
            11_250_000,
            21_000_000
        ));
        assert!(!render.fill(
            &samples,
            8000,
            &[1],
            2,
            &mut out,
            true,
            true,
            99_000_000,
            100_000_000
        ));
        assert_eq!(out, [0.0; 8]);
    }
    #[test]
    fn routes_reject_legacy_ids_implicit_defaults_and_overlapping_monitor() {
        let mut p = Profile::default();
        p.routes.transmit = Some(Route {
            device_id: String::new(),
            channels: vec![0],
            sample_rate: 48000,
        });
        assert!(p.validate().is_err());
        let r = Route {
            device_id: "native-id".into(),
            channels: vec![1],
            sample_rate: 48000,
        };
        p.routes.transmit = Some(r.clone());
        p.routes.monitor = Some(r);
        assert!(p.validate().is_err());
        p.routes.monitor.as_mut().unwrap().channels = vec![0];
        assert!(p.validate().is_ok());
    }
}
