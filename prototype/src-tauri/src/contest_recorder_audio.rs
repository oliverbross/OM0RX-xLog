//! Native audio only. No worker, voice-keyer, PTT, CAT, rotor or log mutation API.
use super::contest_recorder_store::{Config, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc,
};
use std::time::Instant;

pub const BLOCK_SAMPLES: usize = 4096;
pub struct Block {
    pub samples: [i16; BLOCK_SAMPLES],
    pub len: usize,
    pub first_frame: u64,
    pub elapsed_ms: u64,
}
pub struct Health {
    pub frames: Arc<AtomicU64>,
    pub last_ms: AtomicU64,
    pub peak: Arc<AtomicU32>,
    pub failed: AtomicBool,
    pub stop: AtomicBool,
}
impl Health {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            frames: Arc::new(AtomicU64::new(0)),
            last_ms: AtomicU64::new(0),
            peak: Arc::new(AtomicU32::new(0)),
            failed: AtomicBool::new(false),
            stop: AtomicBool::new(false),
        })
    }
}
pub struct Input {
    pub _stream: cpal::Stream,
    pub queue: rtrb::Consumer<Block>,
    pub health: Arc<Health>,
    pub clock: Instant,
}
fn device(id: &str) -> Result<cpal::Device> {
    cpal::default_host()
        .devices()
        .map_err(|e| e.to_string())?
        .find(|d| d.id().is_ok_and(|v| v.to_string() == id))
        .ok_or_else(|| {
            "The selected audio device is missing; no default substitution is allowed".into()
        })
}
pub fn devices() -> Result<Value> {
    let mut result = vec![];
    for d in cpal::default_host().devices().map_err(|e| e.to_string())? {
        let id = d.id().map_err(|e| e.to_string())?.to_string();
        let name = d
            .description()
            .map_err(|e| e.to_string())?
            .name()
            .to_owned();
        let formats = |input: bool| -> Vec<Value> {
            let ranges = if input {
                d.supported_input_configs().map(|v| v.collect::<Vec<_>>())
            } else {
                d.supported_output_configs().map(|v| v.collect::<Vec<_>>())
            };
            ranges.map(|r|r.into_iter().take(64).map(|f|json!({"channels":f.channels(),"minRate":f.min_sample_rate(),"maxRate":f.max_sample_rate(),"format":format!("{:?}",f.sample_format())})).collect()).unwrap_or_default()
        };
        let default = cpal::default_host()
            .default_output_device()
            .and_then(|d| d.id().ok())
            .is_some_and(|v| v.to_string() == id);
        let lower = name.to_ascii_lowercase();
        result.push(json!({"id":id,"name":name,"inputs":formats(true),"outputs":formats(false),"inputRate":d.default_input_config().ok().map(|c|c.sample_rate()),"outputRate":d.default_output_config().ok().map(|c|c.sample_rate()),"knownTx":default||lower.contains("transmit")||lower.contains("dax tx")||lower.contains(" tx")}));
    }
    Ok(json!(result))
}
fn format(d: &cpal::Device, input: bool, channels: u16, rate: u32) -> Result<cpal::SampleFormat> {
    let ranges = if input {
        d.supported_input_configs().map(|v| v.collect::<Vec<_>>())
    } else {
        d.supported_output_configs().map(|v| v.collect::<Vec<_>>())
    }
    .map_err(|e| e.to_string())?;
    ranges.into_iter().filter(|r|r.channels()==channels&&r.min_sample_rate()<=rate&&r.max_sample_rate()>=rate)
        .map(|r|r.sample_format()).find(|f|matches!(f,cpal::SampleFormat::F32|cpal::SampleFormat::I16|cpal::SampleFormat::U16))
        .ok_or_else(||"The exact device/channel/rate format is unavailable; choose a supported format (no downmix or resampling)".into())
}
pub fn validate_listening(id: &str) -> Result<()> {
    let d = device(id)?;
    let name = d
        .description()
        .map_err(|e| e.to_string())?
        .name()
        .to_ascii_lowercase();
    if cpal::default_host()
        .default_output_device()
        .and_then(|d| d.id().ok())
        .is_some_and(|v| v.to_string() == id)
        || name.contains("transmit")
        || name.contains("dax tx")
        || name.contains(" tx")
    {
        return Err("Listening output is a known/possible TX route (including system voice-keyer output); choose a separate verified headset device".into());
    }
    Ok(())
}
pub fn validate_input(c: &Config) -> Result<()> {
    c.validate()?;
    let d = device(&c.input_id)?;
    if d.default_input_config()
        .map_err(|e| e.to_string())?
        .sample_rate()
        != c.rate
    {
        return Err("Choose the source's current native sample rate; recorder does not change Audio MIDI/device settings".into());
    }
    format(&d, true, c.channels, c.rate)?;
    Ok(())
}
pub fn validate(c: &Config) -> Result<()> {
    validate_input(c)?;
    validate_listening(&c.output_id)
}
fn stream_config(channels: u16, rate: u32) -> cpal::StreamConfig {
    cpal::StreamConfig {
        channels,
        sample_rate: rate,
        buffer_size: cpal::BufferSize::Default,
    }
}

fn enqueue<T>(
    samples: &[T],
    producer: &mut rtrb::Producer<Block>,
    health: &Health,
    clock: Instant,
    channels: usize,
) where
    T: cpal::SizedSample + Copy,
    f32: cpal::FromSample<T>,
{
    // Fixed preallocated SPSC blocks. No callback allocation, locks, I/O or JSON.
    for chunk in samples.chunks(BLOCK_SAMPLES / channels * channels) {
        if health.stop.load(Ordering::Acquire) || health.failed.load(Ordering::Acquire) {
            return;
        }
        if chunk.len() % channels != 0 {
            health.failed.store(true, Ordering::Release);
            return;
        }
        let mut block = Block {
            samples: [0; BLOCK_SAMPLES],
            len: chunk.len(),
            first_frame: health.frames.load(Ordering::Relaxed),
            elapsed_ms: clock.elapsed().as_millis() as u64,
        };
        let mut peak = 0;
        for (index, sample) in chunk.iter().enumerate() {
            let raw = <f32 as cpal::Sample>::from_sample(*sample);
            let value = if raw.is_finite() {
                (raw.clamp(-1.0, 1.0) * 32768.0).clamp(-32768.0, 32767.0) as i16
            } else {
                0
            };
            block.samples[index] = value;
            peak = peak.max(value.unsigned_abs() as u32);
        }
        let frames = (chunk.len() / channels) as u64;
        if producer.push(block).is_err() {
            health.failed.store(true, Ordering::Release);
            return;
        }
        health.frames.fetch_add(frames, Ordering::Release);
        health
            .last_ms
            .store(clock.elapsed().as_millis() as u64, Ordering::Release);
        health.peak.store(peak, Ordering::Relaxed);
    }
}
fn input_stream<T>(
    d: &cpal::Device,
    c: &Config,
    mut producer: rtrb::Producer<Block>,
    health: Arc<Health>,
    clock: Instant,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + Copy,
    f32: cpal::FromSample<T>,
{
    let channels = c.channels as usize;
    let fault = health.clone();
    d.build_input_stream::<T, _, _>(
        stream_config(c.channels, c.rate),
        move |samples, _| enqueue(samples, &mut producer, &health, clock, channels),
        move |_| {
            fault.failed.store(true, Ordering::Release);
        },
        None,
    )
    .map_err(|e| format!("Selected input could not start (check microphone permission): {e}"))
}
pub fn input(c: &Config) -> Result<Input> {
    validate_input(c)?;
    let d = device(&c.input_id)?;
    let f = format(&d, true, c.channels, c.rate)?;
    // About 5.5 seconds at 48 kHz stereo; fixed ~1 MiB regardless of event length.
    let (producer, queue) = rtrb::RingBuffer::new(128);
    let health = Health::new();
    let clock = Instant::now();
    let stream = match f {
        cpal::SampleFormat::F32 => input_stream::<f32>(&d, c, producer, health.clone(), clock)?,
        cpal::SampleFormat::I16 => input_stream::<i16>(&d, c, producer, health.clone(), clock)?,
        cpal::SampleFormat::U16 => input_stream::<u16>(&d, c, producer, health.clone(), clock)?,
        _ => return Err("Unsupported PCM format".into()),
    };
    stream.play().map_err(|e| e.to_string())?;
    Ok(Input {
        _stream: stream,
        queue,
        health,
        clock,
    })
}
pub struct Output {
    pub _stream: cpal::Stream,
    pub cursor: Arc<AtomicU64>,
    pub done: Arc<AtomicBool>,
    pub frames: u64,
    pub rate: u32,
    pub paused: Arc<AtomicBool>,
    pub volume: Arc<AtomicU32>,
    pub output_id: String,
    pub device_channels: u16,
}
pub struct PlaySpec {
    pub output_id: String,
    pub rate: u32,
    pub source_channels: u16,
    pub channel: u16,
    pub output_channel: u16,
    pub volume: f32,
}
struct Signals {
    cursor: Arc<AtomicU64>,
    done: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    cancel: Arc<AtomicU64>,
    generation: u64,
    volume: Arc<AtomicU32>,
}
fn render<T>(samples: &[i16], s: &PlaySpec, channels: u16, signals: &Signals, out: &mut [T])
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    for frame in out.chunks_mut(channels as usize) {
        for sample in frame.iter_mut() {
            *sample = T::from_sample(0.0);
        }
        if signals.cancel.load(Ordering::Acquire) != signals.generation
            || signals.done.load(Ordering::Acquire)
            || signals.paused.load(Ordering::Acquire)
        {
            continue;
        }
        let index = signals.cursor.fetch_add(1, Ordering::AcqRel) as usize;
        if index >= samples.len() / s.source_channels as usize {
            signals.done.store(true, Ordering::Release);
            continue;
        }
        let n = if s.channel == 0 { s.source_channels } else { 1 };
        let volume = f32::from_bits(signals.volume.load(Ordering::Relaxed));
        for channel in 0..n {
            let src = if s.channel == 0 {
                channel
            } else {
                s.channel - 1
            };
            frame[(s.output_channel + channel) as usize] = T::from_sample(
                samples[index * s.source_channels as usize + src as usize] as f32 / 32768.0
                    * volume,
            );
        }
    }
}
pub fn output_unchanged(output: &Output) -> bool {
    validate_listening(&output.output_id).is_ok()
        && device(&output.output_id)
            .and_then(|d| d.default_output_config().map_err(|e| e.to_string()))
            .is_ok_and(|c| c.channels() == output.device_channels && c.sample_rate() == output.rate)
}
pub fn output(
    samples: Vec<i16>,
    spec: PlaySpec,
    cancel: Arc<AtomicU64>,
    generation: u64,
) -> Result<Output> {
    validate_listening(&spec.output_id)?;
    let d = device(&spec.output_id)?;
    let cfg = d.default_output_config().map_err(|e| e.to_string())?;
    let channels = cfg.channels();
    if cfg.sample_rate() != spec.rate {
        return Err("Listening output and archive native rates differ; select a matching listening device. No audio-system sample rate is changed".into());
    }
    let count = if spec.channel == 0 {
        spec.source_channels
    } else {
        1
    };
    if spec.channel > spec.source_channels
        || spec.output_channel + count > channels
        || !spec.volume.is_finite()
        || !(0.0..=0.5).contains(&spec.volume)
    {
        return Err(
            "Invalid listening channel/volume; choose explicit available output channels".into(),
        );
    }
    let f = format(&d, false, channels, spec.rate)?;
    let cursor = Arc::new(AtomicU64::new(0));
    let done = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let volume = Arc::new(AtomicU32::new(spec.volume.to_bits()));
    let output_id = spec.output_id.clone();
    let frames = samples.len() as u64 / spec.source_channels as u64;
    let rate = spec.rate;
    let build = |f| -> Result<cpal::Stream> {
        match f {
            cpal::SampleFormat::F32 => output_stream::<f32>(
                &d,
                samples,
                spec,
                channels,
                Signals {
                    cursor: cursor.clone(),
                    done: done.clone(),
                    paused: paused.clone(),
                    cancel,
                    generation,
                    volume: volume.clone(),
                },
            ),
            cpal::SampleFormat::I16 => output_stream::<i16>(
                &d,
                samples,
                spec,
                channels,
                Signals {
                    cursor: cursor.clone(),
                    done: done.clone(),
                    paused: paused.clone(),
                    cancel,
                    generation,
                    volume: volume.clone(),
                },
            ),
            cpal::SampleFormat::U16 => output_stream::<u16>(
                &d,
                samples,
                spec,
                channels,
                Signals {
                    cursor: cursor.clone(),
                    done: done.clone(),
                    paused: paused.clone(),
                    cancel,
                    generation,
                    volume: volume.clone(),
                },
            ),
            _ => Err("Unsupported listening format".into()),
        }
    };
    let stream = build(f)?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Output {
        _stream: stream,
        cursor,
        done,
        frames,
        rate,
        paused,
        volume,
        output_id,
        device_channels: channels,
    })
}
#[allow(clippy::too_many_arguments)]
fn output_stream<T>(
    d: &cpal::Device,
    samples: Vec<i16>,
    s: PlaySpec,
    channels: u16,
    signals: Signals,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    let fault = signals.done.clone();
    d.build_output_stream::<T, _, _>(
        stream_config(channels, s.rate),
        move |out, _| render(&samples, &s, channels, &signals, out),
        move |_| {
            fault.store(true, Ordering::Release);
        },
        None,
    )
    .map_err(|e| e.to_string())
}

/// Read-only permission state; enumeration/status do not trigger a prompt.
pub fn permission() -> String {
    use objc2::{msg_send, runtime::AnyClass};
    use objc2_foundation::NSString;
    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {}
    let Some(class) = AnyClass::get(c"AVCaptureDevice") else {
        return "unknown".into();
    };
    let media = NSString::from_str("soun");
    let status: isize = unsafe { msg_send![class,authorizationStatusForMediaType:&*media] };
    match status {
        0 => "not requested",
        1 => "restricted",
        2 => "denied — System Settings → Privacy & Security → Microphone",
        3 => "authorized",
        _ => "unknown",
    }
    .into()
}

/// Explicit CLI evidence fixture; this never enumerates or opens a device.
pub fn fixture_input() -> Result<Vec<i16>> {
    let (mut tx, mut rx) = rtrb::RingBuffer::new(128);
    let health = Health::new();
    let clock = Instant::now();
    let mut result = Vec::with_capacity(16000);
    let samples: Vec<f32> = (0..8000)
        .flat_map(|i| [i as i16 % 1000, -(i as i16 % 1000) - 100])
        .map(|v| v as f32 / 32768.0)
        .collect();
    for chunk in samples.chunks(BLOCK_SAMPLES) {
        enqueue(chunk, &mut tx, &health, clock, 2);
        while let Ok(block) = rx.pop() {
            if block.first_frame != result.len() as u64 / 2 {
                return Err("Callback fixture frame gap".into());
            }
            result.extend_from_slice(&block.samples[..block.len]);
        }
    }
    if health.failed.load(Ordering::Acquire) || result.len() != 16000 {
        return Err("Callback fixture overrun".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_clamps_pcm_preserves_stereo_and_reports_bounded_queue_overrun() {
        let (mut tx, mut rx) = rtrb::RingBuffer::new(1);
        let health = Health::new();
        let clock = Instant::now();
        enqueue(&[1.5f32, -1.5, 0.5, f32::NAN], &mut tx, &health, clock, 2);
        let block = rx.pop().unwrap();
        assert_eq!(&block.samples[..4], &[32767, -32768, 16384, 0]);
        assert_eq!(block.first_frame, 0);
        assert_eq!(health.frames.load(Ordering::Acquire), 2);
        enqueue(&[0.0f32, 0.0], &mut tx, &health, clock, 2);
        enqueue(&[0.0f32, 0.0], &mut tx, &health, clock, 2);
        assert!(health.failed.load(Ordering::Acquire));
        assert_eq!(health.frames.load(Ordering::Acquire), 3);
        assert_eq!(rx.pop().unwrap().first_frame, 2);
        assert!(rx.pop().is_err());
    }
    fn signals() -> Signals {
        Signals {
            cursor: Arc::new(AtomicU64::new(0)),
            done: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicU64::new(7)),
            generation: 7,
            volume: Arc::new(AtomicU32::new(0.25f32.to_bits())),
        }
    }
    fn spec() -> PlaySpec {
        PlaySpec {
            output_id: "explicit-fixture-headphones".into(),
            rate: 48000,
            source_channels: 2,
            channel: 0,
            output_channel: 0,
            volume: 0.25,
        }
    }
    #[test]
    fn replay_cancellation_and_delayed_callbacks_cannot_restart_sound() {
        let signals = signals();
        let spec = spec();
        let samples = [32767, -32768, 16384, -16384];
        let mut output = [0.0f32; 2];
        render(&samples, &spec, 2, &signals, &mut output);
        assert!(output[0] > 0.24);
        assert_eq!(output[1], -0.25);
        signals.cancel.fetch_add(1, Ordering::AcqRel);
        output.fill(1.0);
        render(&samples, &spec, 2, &signals, &mut output);
        assert_eq!(output, [0.0, 0.0]);
        signals.cursor.store(0, Ordering::Release);
        output.fill(1.0);
        render(&samples, &spec, 2, &signals, &mut output);
        assert_eq!(output, [0.0, 0.0]);
        assert_eq!(signals.cursor.load(Ordering::Acquire), 0);
    }
    #[test]
    fn pause_seek_channel_selection_and_listening_gain_leave_samples_unchanged() {
        let signals = signals();
        let mut spec = spec();
        let samples = [32767, -32768, 16384, -16384];
        let original = samples;
        signals.paused.store(true, Ordering::Release);
        let mut output = [1.0f32; 4];
        render(&samples, &spec, 4, &signals, &mut output);
        assert_eq!(output, [0.0; 4]);
        signals.paused.store(false, Ordering::Release);
        signals.cursor.store(1, Ordering::Release);
        signals.volume.store(0.5f32.to_bits(), Ordering::Release);
        spec.channel = 2;
        spec.output_channel = 2;
        render(&samples, &spec, 4, &signals, &mut output);
        assert_eq!(output, [0.0, 0.0, -0.25, 0.0]);
        assert_eq!(samples, original);
    }
}
