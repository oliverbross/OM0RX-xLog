//! Independent WK2/WK3 host-mode connection. No raw commands, EEPROM writes,
//! pin configuration, manual PTT, tune, automatic reconnect, or text retries.
//! Protocol: K1EL WK3 Datasheet v1.3, WK1-compatible status (Host Open default).
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};

const FRESH_MS: u64 = 2_000;
const ARM_MS: u64 = 60_000;
const WRITE_GAP_MS: u64 = 30;
const SETTLE_MS: u64 = 300; // K1EL documents up to 200 ms response latency.
const OPEN: &[u8] = &[0, 2];
const CLOSE: &[u8] = &[0, 3];
const CLEAR: &[u8] = &[0x0a];
const STATUS: &[u8] = &[0x15];

#[derive(Clone, Copy, Debug, Default, Serialize)]
struct Status {
    busy: bool,
    break_in: bool,
    xoff: bool,
    waiting: bool,
    key_down: bool,
}
impl Status {
    fn parse(byte: u8) -> Option<Self> {
        (byte & 0xe0 == 0xc0).then_some(Self {
            busy: byte & 4 != 0,
            break_in: byte & 2 != 0,
            xoff: byte & 1 != 0,
            waiting: byte & 16 != 0,
            key_down: byte & 8 != 0,
        })
    }
    fn idle(self) -> bool {
        !self.busy && !self.break_in && !self.xoff && !self.waiting && !self.key_down
    }
}

#[derive(Clone, Serialize)]
struct Snapshot {
    generation: u64,
    phase: &'static str,
    port: String,
    firmware: Option<u8>,
    status: Option<Status>,
    status_age_ms: Option<u64>,
    armed_remaining_ms: u64,
    owns_output: bool,
    pending_characters: usize,
    last_intent: u64,
    error: Option<String>,
}

/// Deterministic state machine; the serial actor is its only caller. All times
/// are monotonic milliseconds from that actor's start, never browser timestamps.
struct Core {
    snapshot: Snapshot,
    queue: VecDeque<u8>,
    last_status: Option<u64>,
    arm_until: u64,
    last_write: u64,
    last_output: u64,
    last_poll: u64,
    settling: bool,
    saw_busy: bool,
    transport_failed: bool,
}
impl Core {
    fn new(generation: u64, port: String) -> Self {
        Self {
            snapshot: Snapshot {
                generation,
                phase: "connecting",
                port,
                firmware: None,
                status: None,
                status_age_ms: None,
                armed_remaining_ms: 0,
                owns_output: false,
                pending_characters: 0,
                last_intent: 0,
                error: None,
            },
            queue: VecDeque::new(),
            last_status: None,
            arm_until: 0,
            last_write: 0,
            last_output: 0,
            last_poll: 0,
            settling: false,
            saw_busy: false,
            transport_failed: false,
        }
    }
    fn view(&self, now: u64) -> Snapshot {
        let mut value = self.snapshot.clone();
        value.status_age_ms = self.last_status.map(|then| now.saturating_sub(then));
        value.armed_remaining_ms = self.arm_until.saturating_sub(now);
        value.pending_characters = self.queue.len();
        value
    }
    fn fresh(&self, now: u64) -> bool {
        self.last_status
            .is_some_and(|then| now.saturating_sub(then) <= FRESH_MS)
    }
    fn receive(&mut self, byte: u8, now: u64) {
        // Ignore character echoes and speed-pot updates. Neither proves RF.
        let Some(status) = Status::parse(byte) else {
            return;
        };
        self.last_status = Some(now);
        self.snapshot.status = Some(status);
        if status.break_in {
            // The device has discarded its host FIFO. Do not resume our tail or
            // issue Clear Buffer against the operator's newly owned paddles.
            self.queue.clear();
            self.arm_until = 0;
            self.snapshot.owns_output = false;
            self.settling = false;
            self.saw_busy = false;
            self.snapshot.error =
                Some("Paddle break-in: macro cancelled; re-arm explicitly.".into());
        } else {
            if self.snapshot.owns_output && status.busy {
                self.saw_busy = true;
            }
            if self.queue.is_empty()
                && status.idle()
                && (self.settling || self.saw_busy)
                && now.saturating_sub(self.last_output) >= SETTLE_MS
            {
                self.snapshot.owns_output = false;
                self.settling = false;
                self.saw_busy = false;
            }
        }
    }
    fn arm(&mut self, now: u64) -> Result<(), String> {
        if self.snapshot.phase != "ready"
            || !self.fresh(now)
            || !self.snapshot.status.is_some_and(Status::idle)
            || self.snapshot.owns_output
        {
            return Err("WinKeyer must have fresh idle status before arming".into());
        }
        self.arm_until = now + ARM_MS;
        self.snapshot.error = None;
        Ok(())
    }
    fn send(&mut self, intent: u64, text: &str, now: u64) -> Result<(), String> {
        if intent == 0 || intent <= self.snapshot.last_intent {
            return Err("Stale or repeated CW intent".into());
        }
        // Consume even rejected intents: callers must never retry a possibly
        // delivered operation using a cached UI request.
        self.snapshot.last_intent = intent;
        if text.is_empty()
            || text.len() > 128
            || !text
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b" /?=+.,-".contains(&b))
            || text.trim().is_empty()
        {
            return Err("CW must contain 1–128 supported uppercase ASCII characters".into());
        }
        if self.snapshot.phase != "ready"
            || self.arm_until <= now
            || !self.fresh(now)
            || !self.snapshot.status.is_some_and(Status::idle)
            || self.snapshot.owns_output
        {
            return Err(
                "Arm a fresh, idle WinKeyer before sending; wait for the previous macro or Stop"
                    .into(),
            );
        }
        self.queue.extend(text.bytes());
        self.snapshot.owns_output = true; // before any serial write
        self.saw_busy = false;
        Ok(())
    }
    fn write<P: Write + ?Sized>(
        &mut self,
        port: &mut P,
        bytes: &[u8],
        now: u64,
    ) -> Result<(), String> {
        if self.transport_failed {
            return Err("Serial transport failed; output state is uncertain".into());
        }
        // A partial multi-byte command leaves the parser boundary unknown. Do
        // not append/retry it, or follow it with a release command interpreted
        // as its parameter. Retire the transport and retain uncertain ownership.
        match port.write(bytes) {
            Ok(n) if n == bytes.len() => {
                self.last_write = now;
                if bytes == CLEAR || bytes.len() == 1 && bytes[0] >= 0x20 {
                    self.last_output = now;
                }
                Ok(())
            }
            _ => {
                self.fail("Serial write failed or was partial; check the keyer physically. Nothing will be replayed.");
                Err(self.snapshot.error.clone().unwrap())
            }
        }
    }
    fn fail(&mut self, message: &str) {
        self.queue.clear();
        self.arm_until = 0;
        self.snapshot.phase = "uncertain";
        self.snapshot.error = Some(message.into());
        self.transport_failed = true;
    }
    fn stop<P: Write + ?Sized>(&mut self, port: &mut P, now: u64) -> Result<(), String> {
        self.queue.clear();
        self.arm_until = 0;
        if self.snapshot.owns_output {
            self.write(port, CLEAR, now)?;
            self.settling = true;
            self.write(port, STATUS, now)?;
        }
        Ok(())
    }
    fn tick<P: Write + ?Sized>(&mut self, port: &mut P, now: u64) -> Result<(), String> {
        if !matches!(self.snapshot.phase, "ready" | "closing") {
            return Ok(());
        }
        if !self.fresh(now) {
            self.stop(port, now)?;
            self.fail("WinKeyer status is stale; pending text cancelled. Reconnect explicitly after checking the keyer.");
            return Err(self.snapshot.error.clone().unwrap());
        }
        if self.arm_until != 0 && self.arm_until <= now {
            self.stop(port, now)?;
        }
        // At most one character per turn; continuously read before the next one.
        // This bounds overrun while an XOFF travels back over the 1200 baud link.
        if !self.queue.is_empty()
            && !self
                .snapshot
                .status
                .is_some_and(|s| s.xoff || s.break_in || s.waiting || s.key_down)
            && now.saturating_sub(self.last_write) >= WRITE_GAP_MS
        {
            let byte = self.queue.pop_front().unwrap();
            self.write(port, &[byte], now)?;
        }
        if now.saturating_sub(self.last_poll) >= 500 {
            self.write(port, STATUS, now)?;
            self.last_poll = now;
        }
        Ok(())
    }
}

trait Port: Read + Write + Send {}
impl<T: Read + Write + Send> Port for T {}

fn write_exact(port: &mut dyn Port, bytes: &[u8]) -> Result<(), String> {
    match port.write(bytes) {
        Ok(n) if n == bytes.len() => Ok(()),
        _ => Err("WinKeyer handshake write failed; port closed without retry".into()),
    }
}
fn read_until(
    port: &mut dyn Port,
    wanted: impl Fn(u8) -> bool,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<u8, String> {
    let start = Instant::now();
    let mut byte = [0];
    while start.elapsed() < timeout && !cancelled.load(Ordering::Acquire) {
        match port.read(&mut byte) {
            Ok(1) if wanted(byte[0]) => return Ok(byte[0]),
            Ok(0) => return Err("WinKeyer serial connection ended".into()),
            Ok(_) => {}
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::TimedOut
                        | io::ErrorKind::WouldBlock
                        | io::ErrorKind::Interrupted
                ) => {}
            Err(_) => return Err("WinKeyer serial read failed".into()),
        }
    }
    Err("WinKeyer handshake timed out or was cancelled".into())
}
fn handshake(port: &mut dyn Port, cancelled: &AtomicBool) -> Result<(u8, u8), String> {
    write_exact(port, &[0, 4, 0x55])?; // echo test; not CW text
    read_until(port, |b| b == 0x55, Duration::from_secs(1), cancelled)?;
    write_exact(port, OPEN)?;
    // Documented WK2 23, WK3 30 and WK3.1 31. Never assume future/clone
    // firmware or original WK1 uses this parser. No reset or calibration.
    let revision = match read_until(port, |b| b < 0x80, Duration::from_secs(1), cancelled) {
        Ok(revision) => revision,
        Err(error) => {
            let _ = write_exact(port, CLOSE);
            return Err(error);
        }
    };
    if !matches!(revision, 23 | 30 | 31) {
        let _ = write_exact(port, CLOSE);
        return Err(format!("Unsupported WinKeyer firmware {revision}; supported protocol revisions are 23, 30 and 31"));
    }
    write_exact(port, STATUS)?;
    let status = match read_until(
        port,
        |b| Status::parse(b).is_some(),
        Duration::from_secs(1),
        cancelled,
    ) {
        Ok(status) => status,
        Err(error) => {
            let _ = write_exact(port, CLOSE);
            return Err(error);
        }
    };
    Ok((revision, status))
}

enum Command {
    Arm,
    Send { intent: u64, text: String },
    Speed(u8),
}
struct Pending {
    command: Command,
    reply: mpsc::SyncSender<Result<(), String>>,
    cancelled: Arc<AtomicBool>,
}
struct Actor {
    generation: u64,
    shared: Arc<Mutex<Snapshot>>,
    commands: mpsc::SyncSender<Pending>,
    stop: Arc<AtomicBool>,
    close: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}
static SLOT: OnceLock<Mutex<Option<Actor>>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);
fn slot() -> &'static Mutex<Option<Actor>> {
    SLOT.get_or_init(|| Mutex::new(None))
}

fn serial_open(path: &str) -> Result<Box<dyn Port>, String> {
    // OS open can briefly assert DTR even when requested otherwise on Linux.
    // Only an explicit Connect reaches this function; enumeration never opens.
    let mut port = serialport::new(path, 1200)
        .data_bits(serialport::DataBits::Eight)
        .parity(serialport::Parity::None)
        .stop_bits(serialport::StopBits::Two)
        .flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(20))
        .dtr_on_open(true)
        .open()
        .map_err(|_| {
            "Cannot open WinKeyer port; check its path, permissions and other applications"
        })?;
    port.write_request_to_send(false)
        .map_err(|_| "Cannot set WinKeyer RTS")?;
    std::thread::sleep(Duration::from_millis(500));
    port.clear(serialport::ClearBuffer::Input)
        .map_err(|_| "Cannot clear WinKeyer input")?;
    Ok(Box::new(port))
}

fn publish(core: &Core, shared: &Mutex<Snapshot>, now: u64) {
    if let Ok(mut value) = shared.lock() {
        *value = core.view(now);
    }
}
fn run_actor(
    mut core: Core,
    shared: Arc<Mutex<Snapshot>>,
    commands: mpsc::Receiver<Pending>,
    stop: Arc<AtomicBool>,
    close: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
) {
    run_actor_with_open(&mut core, shared, commands, stop, close, done, serial_open);
}
fn run_actor_with_open(
    core: &mut Core,
    shared: Arc<Mutex<Snapshot>>,
    commands: mpsc::Receiver<Pending>,
    stop: Arc<AtomicBool>,
    close: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    open: impl FnOnce(&str) -> Result<Box<dyn Port>, String>,
) {
    let start = Instant::now();
    let now = || start.elapsed().as_millis() as u64;
    let result = (|| -> Result<(), String> {
        let mut port = open(&core.snapshot.port)?;
        if close.load(Ordering::Acquire) {
            return Ok(());
        }
        let (firmware, status) = handshake(port.as_mut(), &close)?;
        core.snapshot.firmware = Some(firmware);
        core.snapshot.phase = "ready";
        core.receive(status, now());
        let mut bytes = [0; 64];
        let mut closing_since = None;
        loop {
            // Read first, even on Stop, so a pending paddle break-in relinquishes
            // host ownership before Clear Buffer. The port timeout bounds this.
            match port.read(&mut bytes) {
                Ok(0) => {
                    let _ = core.stop(port.as_mut(), now());
                    return Err("WinKeyer disconnected; pending text cancelled. Check the keyer physically.".into());
                }
                Ok(n) => {
                    for byte in &bytes[..n] {
                        core.receive(*byte, now());
                    }
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::TimedOut
                            | io::ErrorKind::WouldBlock
                            | io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => {
                    let _ = core.stop(port.as_mut(), now());
                    return Err(
                        "WinKeyer read failed; pending text cancelled. Check the keyer physically."
                            .into(),
                    );
                }
            }
            // Stop bypasses the bounded command queue, including an Arm or Send
            // already enqueued. Reject that queue instead of running it later.
            if stop.swap(false, Ordering::AcqRel)
                || close.load(Ordering::Acquire) && closing_since.is_none()
            {
                while let Ok(pending) = commands.try_recv() {
                    let _ = pending
                        .reply
                        .send(Err("CW request cancelled by Stop/disconnect".into()));
                }
                core.stop(port.as_mut(), now())?;
            }
            if close.load(Ordering::Acquire) {
                let since = *closing_since.get_or_insert_with(now);
                core.snapshot.phase = "closing";
                if !core.snapshot.owns_output || now().saturating_sub(since) >= 1_000 {
                    core.write(port.as_mut(), CLOSE, now())?;
                    core.snapshot.phase = if core.snapshot.owns_output {
                        "uncertain"
                    } else {
                        "disconnected"
                    };
                    if core.snapshot.owns_output {
                        core.snapshot.error =
                            Some("Port closed after Stop; physical idle was not confirmed.".into());
                    }
                    return Ok(());
                }
                core.tick(port.as_mut(), now())?;
                publish(core, &shared, now());
                continue;
            }
            // Re-check priority cancellation after read, before any queued send.
            if stop.load(Ordering::Acquire) || close.load(Ordering::Acquire) {
                continue;
            }
            if let Ok(pending) = commands.try_recv() {
                let result = if pending.cancelled.load(Ordering::Acquire) {
                    Err("CW request expired before execution".into())
                } else {
                    match pending.command {
                        Command::Arm => core.arm(now()),
                        Command::Send { intent, text } => core.send(intent, &text, now()),
                        Command::Speed(wpm) => {
                            if core.snapshot.owns_output
                                || !core.fresh(now())
                                || !core.snapshot.status.is_some_and(Status::idle)
                            {
                                Err("Change speed only while WinKeyer has fresh idle status".into())
                            } else {
                                core.write(port.as_mut(), &[2, wpm], now())
                            }
                        }
                    }
                };
                let _ = pending.reply.send(result);
            }
            if stop.load(Ordering::Acquire) || close.load(Ordering::Acquire) {
                continue;
            }
            core.tick(port.as_mut(), now())?;
            publish(core, &shared, now());
        }
    })();
    if let Err(error) = result {
        core.fail(&error);
    }
    core.arm_until = 0;
    core.queue.clear();
    if core.snapshot.phase == "connecting" {
        core.snapshot.phase = "disconnected";
    }
    publish(core, &shared, now());
    done.store(true, Ordering::Release);
}

fn fenced<'a>(state: &'a Option<Actor>, params: &Value) -> Result<&'a Actor, String> {
    let actor = state.as_ref().ok_or("WinKeyer is not connected")?;
    if params["generation"].as_u64() != Some(actor.generation) {
        return Err("Stale WinKeyer connection; refresh before acting".into());
    }
    Ok(actor)
}
fn dispatch(method: &str, params: &Value) -> Result<Value, String> {
    if method == "winkeyer_ports" {
        let ports = serialport::available_ports()
            .map_err(|_| "Serial-port inventory unavailable; enter the device path manually")?;
        return Ok(
            json!({"ports":ports.into_iter().map(|p|p.port_name).collect::<Vec<_>>(), "inventory_only":true}),
        );
    }
    let mut state = slot().lock().map_err(|_| "WinKeyer owner lock failed")?;
    if method == "winkeyer_connect" {
        if state.is_some() {
            return Err(
                "Disconnect the previous WinKeyer session explicitly before connecting".into(),
            );
        }
        if params["confirm_serial_control"].as_bool() != Some(true) {
            return Err("Explicit serial control-line consent is required".into());
        }
        let path = params["port"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
            .ok_or("A valid WinKeyer serial-port path is required")?
            .to_owned();
        let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
        let core = Core::new(generation, path);
        let shared = Arc::new(Mutex::new(core.view(0)));
        let stop = Arc::new(AtomicBool::new(false));
        let close = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::sync_channel(8);
        let (a, b, c, d) = (shared.clone(), stop.clone(), close.clone(), done.clone());
        std::thread::Builder::new()
            .name("xlog-winkeyer".into())
            .spawn(move || run_actor(core, a, rx, b, c, d))
            .map_err(|_| "Could not start WinKeyer transport")?;
        *state = Some(Actor {
            generation,
            shared,
            commands: tx,
            stop,
            close,
            done,
        });
    }
    if method == "winkeyer_snapshot" || method == "winkeyer_connect" {
        return match state.as_ref() {
            Some(actor) => Ok(serde_json::to_value(
                actor
                    .shared
                    .lock()
                    .map_err(|_| "WinKeyer snapshot lock failed")?
                    .clone(),
            )
            .map_err(|_| "WinKeyer snapshot failed")?),
            None => Ok(
                json!({"phase":"disconnected","generation":0,"armed_remaining_ms":0,"owns_output":false,"pending_characters":0,"last_intent":0}),
            ),
        };
    }
    let actor = fenced(&state, params)?;
    if method == "winkeyer_disconnect" {
        actor.close.store(true, Ordering::Release);
        // Never drop a running owner and allow a second open on its port.
        if actor.done.load(Ordering::Acquire) {
            let last = actor
                .shared
                .lock()
                .map_err(|_| "WinKeyer snapshot lock failed")?
                .clone();
            if last.owns_output && params["confirm_output_stopped"].as_bool() != Some(true) {
                return Err("The port is closed but output is uncertain. Check that the keyer is physically stopped, then confirm before releasing this session.".into());
            }
            *state = None;
            return Ok(
                json!({"phase":"disconnected","previous_output_uncertain":last.owns_output}),
            );
        }
        return Ok(json!({"phase":"closing","generation":actor.generation}));
    }
    if method == "winkeyer_stop" {
        if actor.done.load(Ordering::Acquire) {
            return Err(
                "WinKeyer port is closed; physical output cannot be stopped by this connection"
                    .into(),
            );
        }
        actor.stop.store(true, Ordering::Release);
        return Ok(
            json!({"stop_requested":true,"generation":actor.generation,"physical_idle_confirmed":false}),
        );
    }
    if actor.done.load(Ordering::Acquire) {
        return Err(
            "WinKeyer transport ended; disconnect explicitly before opening another session".into(),
        );
    }
    if actor.close.load(Ordering::Acquire)
        || actor
            .shared
            .lock()
            .map_err(|_| "WinKeyer snapshot lock failed")?
            .phase
            != "ready"
    {
        return Err("Wait for WinKeyer to finish connecting; no CW command is queued while connecting or closing".into());
    }
    let command = match method {
        "winkeyer_arm" if params["confirm_transmit"].as_bool() == Some(true) => Command::Arm,
        "winkeyer_send" => Command::Send {
            intent: params["intent"].as_u64().ok_or("CW intent is required")?,
            text: params["text"]
                .as_str()
                .ok_or("CW text is required")?
                .to_owned(),
        },
        "winkeyer_speed" => Command::Speed(
            params["wpm"]
                .as_u64()
                .filter(|v| (5..=99).contains(v))
                .ok_or("CW speed must be 5–99 WPM")? as u8,
        ),
        _ => {
            return Err(
                "Unsupported WinKeyer operation or missing explicit transmit consent".into(),
            )
        }
    };
    let (tx, rx) = mpsc::sync_channel(1);
    let cancelled = Arc::new(AtomicBool::new(false));
    actor
        .commands
        .try_send(Pending {
            command,
            reply: tx,
            cancelled: cancelled.clone(),
        })
        .map_err(|_| "WinKeyer request queue unavailable; nothing was enqueued")?;
    drop(state); // Stop/snapshot/disconnect must not wait for this acknowledgement.
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(result) => {
            result?;
            Ok(json!({"accepted":true,"physical_transmission_confirmed":false}))
        }
        Err(_) => {
            cancelled.store(true, Ordering::Release);
            Err("WinKeyer acknowledgement unavailable; do not retry this send. Use Stop and inspect status.".into())
        }
    }
}
pub fn request(request: Value) -> Result<Value, String> {
    if request.to_string().len() > 4_096 {
        return Err("WinKeyer request exceeds size limit".into());
    }
    let id = request["id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .ok_or("Invalid request ID")?;
    let method = request["method"].as_str().ok_or("Method is required")?;
    if !request["params"].is_object() {
        return Err("Parameters must be an object".into());
    }
    match dispatch(method, &request["params"]) {
        Ok(result) => Ok(json!({"id":id,"ok":true,"result":result})),
        Err(message) => {
            Ok(json!({"id":id,"ok":false,"error":{"code":"WINKEYER","message":message}}))
        }
    }
}
pub fn validate_surface(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("Only the main workspace can access WinKeyer".into())
    }
}
pub fn shutdown() {
    if let Ok(state) = slot().lock() {
        if let Some(actor) = state.as_ref() {
            actor.close.store(true, Ordering::Release);
            let deadline = Instant::now() + Duration::from_secs(2);
            while !actor.done.load(Ordering::Acquire) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Fake {
        bytes: Vec<u8>,
        replies: VecDeque<u8>,
        partial: bool,
        auto_status: bool,
        eof_when_empty: bool,
    }
    impl Write for Fake {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let n = if self.partial {
                bytes.len().saturating_sub(1)
            } else {
                bytes.len()
            };
            self.bytes.extend_from_slice(&bytes[..n]);
            if self.auto_status && bytes == STATUS && n == bytes.len() {
                self.replies.push_back(0xc0);
            }
            Ok(n)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl Read for Fake {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            if let Some(b) = self.replies.pop_front() {
                bytes[0] = b;
                Ok(1)
            } else if self.eof_when_empty {
                Ok(0)
            } else {
                Err(io::ErrorKind::TimedOut.into())
            }
        }
    }
    fn ready() -> Core {
        let mut core = Core::new(7, "fake".into());
        core.snapshot.phase = "ready";
        core.receive(0xc0, 1);
        core
    }
    #[test]
    fn status_tags_and_all_wk1_bits() {
        for b in 0..=255 {
            assert_eq!(Status::parse(b).is_some(), (0xc0..=0xdf).contains(&b));
        }
        let all = Status::parse(0xdf).unwrap();
        assert!(all.busy && all.break_in && all.xoff && all.waiting && all.key_down);
        assert!(Status::parse(0xc0).unwrap().idle());
    }
    #[test]
    fn handshake_has_no_keying_configuration_or_reset() {
        for revision in [23, 30, 31] {
            let mut p = Fake {
                replies: [0x80, 0x55, revision, 0xc0].into(),
                ..Fake::default()
            };
            assert_eq!(
                handshake(&mut p, &AtomicBool::new(false)).unwrap(),
                (revision, 0xc0)
            );
            assert_eq!(p.bytes, [0, 4, 0x55, 0, 2, 0x15]);
        }
    }
    #[test]
    fn unsupported_revision_closes_without_text() {
        let mut p = Fake {
            replies: [0x55, 10].into(),
            ..Fake::default()
        };
        assert!(handshake(&mut p, &AtomicBool::new(false))
            .unwrap_err()
            .contains("Unsupported"));
        assert_eq!(p.bytes, [0, 4, 0x55, 0, 2, 0, 3]);
    }
    #[test]
    fn failed_handshake_releases_host_mode_only_with_known_command_boundary() {
        for replies in [vec![0x55], vec![0x55, 31]] {
            let mut p = Fake {
                replies: replies.into(),
                eof_when_empty: true,
                ..Fake::default()
            };
            assert!(handshake(&mut p, &AtomicBool::new(false)).is_err());
            assert!(p.bytes.ends_with(CLOSE));
        }
        let mut p = Fake {
            partial: true,
            ..Fake::default()
        };
        assert!(handshake(&mut p, &AtomicBool::new(false)).is_err());
        assert_eq!(p.bytes, [0, 4]); // no follow-up on a partial ADMIN command
    }
    #[test]
    fn explicit_fresh_arm_and_consumed_intents() {
        let mut c = ready();
        assert!(c.send(1, "CQ", 2).is_err());
        c.arm(3).unwrap();
        assert!(c.send(1, "CQ", 4).is_err());
        assert!(c.send(2, "CQ\n", 4).is_err());
        assert!(c.send(3, "é", 4).is_err());
        c.send(4, "CQ", 4).unwrap();
        assert!(c.send(5, "TU", 5).is_err());
        assert!(ready().arm(3_000).is_err());
    }
    #[test]
    fn xoff_pauses_tail_and_breakin_discards_without_clearing_paddles() {
        let mut c = ready();
        let mut p = Fake::default();
        c.arm(2).unwrap();
        c.send(1, "CQ CQ", 3).unwrap();
        c.tick(&mut p, 40).unwrap();
        assert_eq!(p.bytes, b"C");
        c.receive(0xc5, 50);
        c.tick(&mut p, 80).unwrap();
        assert_eq!(p.bytes, b"C");
        c.receive(0xc4, 90);
        c.tick(&mut p, 120).unwrap();
        assert_eq!(p.bytes, b"CQ");
        c.receive(0xc6, 130);
        c.stop(&mut p, 140).unwrap();
        c.tick(&mut p, 150).unwrap();
        assert_eq!(p.bytes, b"CQ");
        assert!(c.queue.is_empty());
        assert_eq!(c.arm_until, 0);
        c.receive(0xc0, 160);
        assert!(c.send(2, "TU", 170).is_err());
    }
    #[test]
    fn stop_discards_tail_and_retains_ownership_until_idle_settles() {
        let mut c = ready();
        let mut p = Fake::default();
        c.arm(2).unwrap();
        c.send(1, "CQ", 3).unwrap();
        c.tick(&mut p, 40).unwrap();
        c.stop(&mut p, 50).unwrap();
        assert_eq!(p.bytes, [b'C', 0x0a, 0x15]);
        assert!(c.snapshot.owns_output);
        c.receive(0xc0, 100);
        assert!(c.snapshot.owns_output);
        c.receive(0xc0, 400);
        assert!(!c.snapshot.owns_output);
        assert_eq!(c.arm_until, 0);
        assert!(c.queue.is_empty());
    }
    #[test]
    fn stale_status_releases_once_and_never_replays() {
        let mut c = ready();
        let mut p = Fake::default();
        c.arm(2).unwrap();
        c.send(1, "CQ", 3).unwrap();
        assert!(c.tick(&mut p, 3_000).is_err());
        assert_eq!(p.bytes, [0x0a, 0x15]);
        c.receive(0xc0, 3_100);
        c.tick(&mut p, 3_200).unwrap();
        assert!(c.arm(3_201).is_err());
        assert!(c.queue.is_empty());
    }
    #[test]
    fn partial_write_loses_parser_boundary_and_forbids_retry_or_clear() {
        let mut c = ready();
        let mut p = Fake {
            partial: true,
            ..Fake::default()
        };
        c.arm(2).unwrap();
        c.send(1, "CQ", 3).unwrap();
        assert!(c.write(&mut p, &[2, 20], 40).is_err());
        assert_eq!(p.bytes, [2]);
        p.partial = false;
        assert!(c.stop(&mut p, 50).is_err());
        assert_eq!(p.bytes, [2]);
        assert!(c.snapshot.owns_output);
        assert_eq!(c.snapshot.phase, "uncertain");
    }
    #[test]
    fn arm_expiry_cancels_owned_message_without_clearing_unowned_input() {
        let mut c = ready();
        let mut p = Fake::default();
        c.arm(2).unwrap();
        c.send(1, "CQ", 3).unwrap();
        c.receive(0xc4, 60_003);
        c.tick(&mut p, 60_003).unwrap();
        assert!(c.queue.is_empty());
        assert_eq!(p.bytes[..2], [0x0a, 0x15]);
        let mut idle = ready();
        let mut q = Fake::default();
        idle.stop(&mut q, 100).unwrap();
        assert!(q.bytes.is_empty());
    }
    #[test]
    fn completion_needs_busy_then_settled_idle_not_early_idle() {
        let mut c = ready();
        let mut p = Fake::default();
        c.arm(2).unwrap();
        c.send(1, "E", 3).unwrap();
        c.tick(&mut p, 40).unwrap();
        c.receive(0xc0, 400);
        assert!(c.snapshot.owns_output);
        c.receive(0xc4, 450);
        c.receive(0xc0, 500);
        assert!(!c.snapshot.owns_output);
    }
    #[test]
    fn status_polls_do_not_restart_output_settle_timer() {
        let mut c = ready();
        let mut p = Fake::default();
        c.arm(2).unwrap();
        c.send(1, "E", 3).unwrap();
        c.tick(&mut p, 40).unwrap();
        c.receive(0xc4, 45);
        c.tick(&mut p, 500).unwrap();
        assert_eq!(p.bytes, [b'E', 0x15]);
        c.receive(0xc0, 510);
        assert!(!c.snapshot.owns_output);
    }
    #[test]
    fn stale_generation_cannot_target_new_session() {
        let (tx, _) = mpsc::sync_channel(1);
        let state = Some(Actor {
            generation: 8,
            shared: Arc::new(Mutex::new(ready().view(1))),
            commands: tx,
            stop: Arc::new(AtomicBool::new(false)),
            close: Arc::new(AtomicBool::new(false)),
            done: Arc::new(AtomicBool::new(false)),
        });
        assert!(fenced(&state, &json!({"generation":7})).is_err());
        assert!(fenced(&state, &json!({"generation":8})).is_ok());
    }
    #[test]
    fn only_main_surface_can_connect_arm_or_send() {
        assert!(validate_surface("main").is_ok());
        for label in ["monitor", "world-map", "band-maps", "dx-cluster", ""] {
            assert!(validate_surface(label).is_err());
        }
        let reply = request(json!({"id":"test","method":"winkeyer_raw","params":{}})).unwrap();
        assert_eq!(reply["ok"], false);
        assert!(request(
            json!({"id":"test","method":"winkeyer_send","params":{"text":"E".repeat(5000)}})
        )
        .is_err());
    }

    struct LoopPort {
        wire: Arc<Mutex<Fake>>,
        ended: Arc<AtomicBool>,
    }
    impl Write for LoopPort {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.wire.lock().unwrap().write(bytes)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl Read for LoopPort {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            if self.ended.load(Ordering::Acquire) {
                return Ok(0);
            }
            let result = self.wire.lock().unwrap().read(bytes);
            if result.is_err() {
                std::thread::sleep(Duration::from_millis(5));
            }
            result
        }
    }
    fn wait_for(mut predicate: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !predicate() {
            assert!(
                Instant::now() < deadline,
                "fake actor did not reach expected state"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn enqueue(
        tx: &mpsc::SyncSender<Pending>,
        command: Command,
    ) -> mpsc::Receiver<Result<(), String>> {
        let (reply, result) = mpsc::sync_channel(1);
        tx.send(Pending {
            command,
            reply,
            cancelled: Arc::new(AtomicBool::new(false)),
        })
        .unwrap();
        result
    }
    fn fixture(
        stop_initial: bool,
    ) -> (
        Actor,
        Arc<Mutex<Fake>>,
        Arc<AtomicBool>,
        mpsc::Receiver<Pending>,
    ) {
        let wire = Arc::new(Mutex::new(Fake {
            replies: [0x55, 31, 0xc0].into(),
            ..Fake::default()
        }));
        let (commands, rx) = mpsc::sync_channel(8);
        (
            Actor {
                generation: 7,
                shared: Arc::new(Mutex::new(Core::new(7, "fake".into()).view(0))),
                commands,
                stop: Arc::new(AtomicBool::new(stop_initial)),
                close: Arc::new(AtomicBool::new(false)),
                done: Arc::new(AtomicBool::new(false)),
            },
            wire,
            Arc::new(AtomicBool::new(false)),
            rx,
        )
    }
    fn spawn_fake(
        actor: &Actor,
        wire: Arc<Mutex<Fake>>,
        ended: Arc<AtomicBool>,
        rx: mpsc::Receiver<Pending>,
    ) -> std::thread::JoinHandle<()> {
        let (shared, stop, close, done) = (
            actor.shared.clone(),
            actor.stop.clone(),
            actor.close.clone(),
            actor.done.clone(),
        );
        std::thread::spawn(move || {
            run_actor_with_open(
                &mut Core::new(7, "fake".into()),
                shared,
                rx,
                stop,
                close,
                done,
                move |_| Ok(Box::new(LoopPort { wire, ended })),
            )
        })
    }
    #[test]
    fn actor_stop_preempts_queued_arm_and_send_and_closes_without_unowned_clear() {
        let (actor, wire, ended, rx) = fixture(true);
        let arm = enqueue(&actor.commands, Command::Arm);
        let send = enqueue(
            &actor.commands,
            Command::Send {
                intent: 1,
                text: "CQ".into(),
            },
        );
        let thread = spawn_fake(&actor, wire.clone(), ended, rx);
        assert!(arm.recv_timeout(Duration::from_secs(2)).unwrap().is_err());
        assert!(send.recv_timeout(Duration::from_secs(2)).unwrap().is_err());
        actor.close.store(true, Ordering::Release);
        wait_for(|| actor.done.load(Ordering::Acquire));
        thread.join().unwrap();
        assert_eq!(wire.lock().unwrap().bytes, [0, 4, 0x55, 0, 2, 0x15, 0, 3]);
        assert_eq!(actor.shared.lock().unwrap().phase, "disconnected");
    }
    #[test]
    fn actor_eof_attempts_owned_release_without_replaying_text() {
        let (actor, wire, ended, rx) = fixture(false);
        let thread = spawn_fake(&actor, wire.clone(), ended.clone(), rx);
        wait_for(|| actor.shared.lock().unwrap().phase == "ready");
        enqueue(&actor.commands, Command::Arm)
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        enqueue(
            &actor.commands,
            Command::Send {
                intent: 1,
                text: "CQ CQ CQ".into(),
            },
        )
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
        wait_for(|| wire.lock().unwrap().bytes.len() > 6);
        ended.store(true, Ordering::Release);
        wait_for(|| actor.done.load(Ordering::Acquire));
        thread.join().unwrap();
        let bytes = &wire.lock().unwrap().bytes;
        assert!(bytes.ends_with(&[0x0a, 0x15]));
        let state = actor.shared.lock().unwrap();
        assert_eq!(state.phase, "uncertain");
        assert!(state.owns_output);
        assert_eq!(state.pending_characters, 0);
        assert_eq!(state.armed_remaining_ms, 0);
    }
    #[test]
    fn actor_disconnect_waits_for_device_idle_then_closes_host_mode_once() {
        let (actor, wire, ended, rx) = fixture(false);
        wire.lock().unwrap().auto_status = true;
        let thread = spawn_fake(&actor, wire.clone(), ended, rx);
        wait_for(|| actor.shared.lock().unwrap().phase == "ready");
        enqueue(&actor.commands, Command::Arm)
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        enqueue(
            &actor.commands,
            Command::Send {
                intent: 1,
                text: "CQ CQ CQ".into(),
            },
        )
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
        wait_for(|| wire.lock().unwrap().bytes.len() > 6);
        actor.close.store(true, Ordering::Release);
        wait_for(|| actor.done.load(Ordering::Acquire));
        thread.join().unwrap();
        let bytes = &wire.lock().unwrap().bytes;
        assert_eq!(bytes.iter().filter(|b| **b == 0x0a).count(), 1);
        assert!(bytes.ends_with(CLOSE));
        let state = actor.shared.lock().unwrap();
        assert_eq!(state.phase, "disconnected");
        assert!(!state.owns_output);
    }
    #[test]
    fn actor_open_failure_never_arms_or_opens_a_replacement() {
        let (actor, _, _, rx) = fixture(false);
        let mut core = Core::new(7, "busy-port".into());
        run_actor_with_open(
            &mut core,
            actor.shared.clone(),
            rx,
            actor.stop.clone(),
            actor.close.clone(),
            actor.done.clone(),
            |_| Err("Port already owned by another application".into()),
        );
        assert!(actor.done.load(Ordering::Acquire));
        let state = actor.shared.lock().unwrap();
        assert_eq!(state.phase, "uncertain");
        assert!(!state.owns_output);
        assert_eq!(state.armed_remaining_ms, 0);
        assert!(state.error.as_ref().unwrap().contains("already owned"));
    }
    #[test]
    fn actor_ignores_expired_request_and_handles_speed_as_atomic_command() {
        let (actor, wire, ended, rx) = fixture(false);
        let (reply, result) = mpsc::sync_channel(1);
        actor
            .commands
            .send(Pending {
                command: Command::Arm,
                reply,
                cancelled: Arc::new(AtomicBool::new(true)),
            })
            .unwrap();
        let speed = enqueue(&actor.commands, Command::Speed(22));
        let thread = spawn_fake(&actor, wire.clone(), ended, rx);
        assert!(result
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .is_err());
        speed.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
        actor.close.store(true, Ordering::Release);
        wait_for(|| actor.done.load(Ordering::Acquire));
        thread.join().unwrap();
        assert_eq!(
            wire.lock().unwrap().bytes,
            [0, 4, 0x55, 0, 2, 0x15, 2, 22, 0, 3]
        );
        assert_eq!(actor.shared.lock().unwrap().armed_remaining_ms, 0);
    }
}
