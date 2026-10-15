//! Local Hamlib transport. One serialized connection owns each rig/rotor session.
//! The UI never supplies executable names or raw Hamlib commands.
use serde_json::{json, Map, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const LOOPBACK: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
const IO_TIMEOUT: Duration = Duration::from_secs(3);
const START_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_FRAME: usize = 8_192;
const MAX_MODELS: usize = 512 * 1024;
const MAX_CAPABILITIES: usize = 256 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Device {
    Radio,
    Rotor,
}
impl Device {
    fn parse(value: &Value) -> Result<Self, String> {
        match value.as_str() {
            Some("radio") => Ok(Self::Radio),
            Some("rotor") => Ok(Self::Rotor),
            _ => Err("device must be radio or rotor".into()),
        }
    }
    fn binary(self) -> &'static str {
        if self == Self::Radio {
            "rigctld"
        } else {
            "rotctld"
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Radio {
            "radio"
        } else {
            "rotor"
        }
    }
}

struct Session {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
    child: Option<Child>,
    mode: &'static str,
    port: u16,
    model: Option<u32>,
    tx_enabled: bool,
    generation: u64,
    ptt_owned: bool,
    tuner_owned: bool,
    cw_owned: bool,
    radio_extras: Map<String, Value>,
    radio_errors: Map<String, Value>,
    field_observed_at_ms: Map<String, Value>,
    next_extra_probe: usize,
}
impl Drop for Session {
    fn drop(&mut self) {
        // Release only TX operations this xLog session requested. A failed
        // release is best effort; hardware watchdogs remain the final guard.
        if self.cw_owned {
            let _ = self.exchange("+\\stop_morse", "stop_morse");
        }
        if self.tuner_owned {
            let _ = self.exchange("+U TUNER 0", "set_func");
        }
        if self.ptt_owned {
            let _ = self.exchange("+T 0", "set_ptt");
        }
        // Only a process started by this Session is reaped. External daemons are untouched.
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Session {
    fn new(
        reader: BufReader<TcpStream>,
        writer: TcpStream,
        child: Option<Child>,
        mode: &'static str,
        port: u16,
        model: Option<u32>,
        tx_enabled: bool,
        generation: u64,
    ) -> Self {
        Self {
            reader,
            writer,
            child,
            mode,
            port,
            model,
            tx_enabled,
            generation,
            ptt_owned: false,
            tuner_owned: false,
            cw_owned: false,
            radio_extras: Map::new(),
            radio_errors: Map::new(),
            field_observed_at_ms: Map::new(),
            next_extra_probe: 0,
        }
    }
}

static RADIO: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
static ROTOR: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);
fn slot(device: Device) -> &'static Mutex<Option<Session>> {
    if device == Device::Radio {
        RADIO.get_or_init(|| Mutex::new(None))
    } else {
        ROTOR.get_or_init(|| Mutex::new(None))
    }
}

fn binary_path(device: Device) -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Ok(path) = std::env::var(if device == Device::Radio {
        "XLOG_TEST_RIGCTLD"
    } else {
        "XLOG_TEST_ROTCTLD"
    }) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    let exe = std::env::current_exe().map_err(|_| "Cannot locate xLog executable")?;
    let dir = exe
        .parent()
        .ok_or("Cannot locate xLog executable directory")?;
    let name = if cfg!(windows) {
        format!("{}.exe", device.binary())
    } else {
        device.binary().into()
    };
    let path = dir.join(name);
    if !path.is_file() {
        return Err(format!(
            "Bundled {} Hamlib helper is missing",
            device.name()
        ));
    }
    Ok(path)
}

fn loopback_address(params: &Value) -> Result<SocketAddr, String> {
    let host = params
        .get("host")
        .and_then(Value::as_str)
        .unwrap_or("127.0.0.1");
    let port = params
        .get("port")
        .and_then(Value::as_u64)
        .filter(|p| (1..=65535).contains(p))
        .ok_or("External daemon port must be 1..65535")? as u16;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "Cannot resolve external daemon host")?;
    addresses.into_iter().find(|address| address.ip().is_loopback())
        .ok_or("External Hamlib daemon must be on loopback; use an authenticated tunnel for remote access".into())
}

fn connect_stream(address: SocketAddr) -> Result<(BufReader<TcpStream>, TcpStream), String> {
    let stream = TcpStream::connect_timeout(&address, IO_TIMEOUT)
        .map_err(|_| "Hamlib daemon is unreachable")?;
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|_| "Cannot set Hamlib read deadline")?;
    stream
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|_| "Cannot set Hamlib write deadline")?;
    let writer = stream
        .try_clone()
        .map_err(|_| "Cannot clone Hamlib socket")?;
    Ok((BufReader::new(stream), writer))
}

fn validate_path(value: &Value) -> Result<&str, String> {
    let path = value.as_str().ok_or("Device path is required")?;
    if path.is_empty() || path.len() > 256 || path.chars().any(|c| c.is_control()) {
        return Err("Invalid device path".into());
    }
    Ok(path)
}

// Hamlib's -C accepts comma-separated key=value tokens. Keep the grammar
// closed: no UI-provided option names, commas, or arbitrary daemon arguments.
fn serial_configuration(params: &Value) -> Result<Option<String>, String> {
    let Some(value) = params.get("serial") else {
        return Ok(None);
    };
    let object = value.as_object().ok_or("serial must be an object")?;
    let mut settings = Vec::new();
    for (key, value) in object {
        let hamlib_key = match key.as_str() {
            "data_bits" | "stop_bits" | "dtr_state" | "rts_state" => key.as_str(),
            "parity" => "serial_parity",
            "handshake" => "serial_handshake",
            _ => return Err(format!("Unsupported serial option {key}")),
        };
        if value.as_str() == Some("") || value.as_u64() == Some(0) {
            continue;
        }
        let selected = match key.as_str() {
            "data_bits" => match value.as_u64() {
                Some(7 | 8) => value.to_string(),
                _ => return Err("serial.data_bits must be 7 or 8".into()),
            },
            "stop_bits" => match value.as_u64() {
                Some(1 | 2) => value.to_string(),
                _ => return Err("serial.stop_bits must be 1 or 2".into()),
            },
            "parity" => match value.as_str() {
                Some("None" | "Odd" | "Even" | "Mark" | "Space") => value.as_str().unwrap().into(),
                _ => return Err("Invalid serial parity".into()),
            },
            "handshake" => match value.as_str() {
                Some("None" | "XONXOFF" | "Hardware") => value.as_str().unwrap().into(),
                _ => return Err("Invalid serial handshake".into()),
            },
            "dtr_state" | "rts_state" => match value.as_str() {
                Some("Unset" | "ON" | "OFF") => value.as_str().unwrap().into(),
                _ => return Err(format!("Invalid serial {key}")),
            },
            _ => unreachable!(),
        };
        settings.push(format!("{hamlib_key}={selected}"));
    }
    if settings.is_empty() {
        Ok(None)
    } else {
        Ok(Some(settings.join(",")))
    }
}

fn start_managed(device: Device, params: &Value, generation: u64) -> Result<Session, String> {
    let model = params
        .get("model")
        .and_then(Value::as_u64)
        .filter(|m| (1..=u32::MAX as u64).contains(m))
        .ok_or("A Hamlib model ID is required")? as u32;
    // Model 2 is itself a NET daemon client: managing it would create an extra owner.
    if model == 2 {
        return Err("Use external mode for an existing Hamlib daemon".into());
    }
    let path = if model == 1 {
        None
    } else {
        Some(validate_path(
            params.get("path").ok_or("Device path is required")?,
        )?)
    };
    let baud = if let Some(value) = params.get("baud") {
        Some(value.as_u64().ok_or("Invalid baud rate")?)
    } else {
        None
    };
    if baud.is_some_and(|n| !(300..=921_600).contains(&n)) {
        return Err("Invalid baud rate".into());
    }
    let serial = serial_configuration(params)?;
    let bind =
        TcpListener::bind((LOOPBACK, 0)).map_err(|_| "Cannot reserve Hamlib loopback port")?;
    let port = bind
        .local_addr()
        .map_err(|_| "Cannot allocate Hamlib port")?
        .port();
    let executable = binary_path(device)?;
    let mut command = Command::new(executable);
    command.args([
        "-m",
        &model.to_string(),
        "-T",
        "127.0.0.1",
        "-t",
        &port.to_string(),
    ]);
    if let Some(path) = path {
        command.args(["-r", path]);
    }
    if let Some(baud) = baud {
        command.args(["-s", &baud.to_string()]);
    }
    if let Some(serial) = serial {
        command.args(["-C", &serial]);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    drop(bind); // Narrow bind race; a live child and valid framed reply are also required.
    let mut child = command
        .spawn()
        .map_err(|_| "Bundled Hamlib helper could not start")?;
    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        if child
            .try_wait()
            .map_err(|_| "Cannot inspect Hamlib helper")?
            .is_some()
        {
            return Err(
                "Hamlib helper exited before it was ready (device or port may be busy)".into(),
            );
        }
        let address = SocketAddr::new(LOOPBACK, port);
        if let Ok((reader, writer)) = connect_stream(address) {
            let mut session = Session::new(
                reader,
                writer,
                Some(child),
                "managed",
                port,
                Some(model),
                tx_enabled(params),
                generation,
            );
            std::thread::sleep(Duration::from_millis(75));
            if session
                .child
                .as_mut()
                .is_some_and(|c| matches!(c.try_wait(), Ok(Some(_))))
            {
                return Err("Hamlib helper exited during startup".into());
            }
            // A framed response verifies the endpoint's dialect; no hardware write is sent.
            let probe = if device == Device::Radio {
                ("+f", "get_freq")
            } else {
                ("+p", "get_pos")
            };
            let _ = session.exchange(probe.0, probe.1)?;
            return Ok(session);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Hamlib helper startup timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn tx_enabled(params: &Value) -> bool {
    params.get("tx_enabled").and_then(Value::as_bool) == Some(true)
}

fn validate_connection_config(params: &Value) -> Result<(), String> {
    match params["mode"].as_str() {
        Some("managed") => {
            let model = params["model"]
                .as_u64()
                .filter(|id| (1..=u32::MAX as u64).contains(id))
                .ok_or("A Hamlib model ID is required")?;
            if model == 2 {
                return Err("Use external mode for an existing Hamlib daemon".into());
            }
            if model != 1 {
                validate_path(&params["path"])?;
            }
            if let Some(baud) = params.get("baud") {
                let baud = baud.as_u64().ok_or("Invalid baud rate")?;
                if !(300..=921_600).contains(&baud) {
                    return Err("Invalid baud rate".into());
                }
            }
            let _ = serial_configuration(params)?;
            Ok(())
        }
        Some("external") => {
            let _ = loopback_address(params)?;
            Ok(())
        }
        _ => Err("mode must be managed or external".into()),
    }
}

/// Closed, non-secret radio setup for the shared journal. Validation performs
/// no DNS, device discovery, process startup or network I/O.
pub(crate) fn saved_radio_configuration(value: &Value) -> Result<Value, String> {
    let object = value.as_object().ok_or("Invalid saved Hamlib configuration.")?;
    let keys: &[&str] = match value["mode"].as_str() {
        Some("managed") => &["mode", "model", "path", "baud", "serial"],
        Some("external") => &["mode", "host", "port"],
        _ => return Err("Choose managed or external Hamlib mode.".into()),
    };
    if object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err("Unsupported saved Hamlib option.".into());
    }
    if value["mode"] == "managed" {
        if let Some(path) = value.get("path") {
            let path = path.as_str().ok_or("Invalid Hamlib device path.")?;
            if path.len() > 256 || path.chars().any(|c| c.is_control()) || path.contains(['@', '?', '#']) || path.contains("://") {
                return Err("Use a device path or host:port without credentials.".into());
            }
        }
        validate_connection_config(value)?;
    } else {
        if !matches!(value["host"].as_str(), Some("127.0.0.1" | "::1" | "localhost"))
            || value["port"].as_u64().is_none_or(|port| !(1..=65535).contains(&port)) {
            return Err("Use a loopback Hamlib host and port 1..65535.".into());
        }
    }
    Ok(value.clone())
}

fn start_external(device: Device, params: &Value, generation: u64) -> Result<Session, String> {
    let address = loopback_address(params)?;
    let (reader, writer) = connect_stream(address)?;
    let mut session = Session::new(
        reader,
        writer,
        None,
        "external",
        address.port(),
        None,
        tx_enabled(params),
        generation,
    );
    let probe = if device == Device::Radio {
        ("+f", "get_freq")
    } else {
        ("+p", "get_pos")
    };
    let _ = session.exchange(probe.0, probe.1)?;
    Ok(session)
}

struct Frame {
    values: Map<String, Value>,
    code: i32,
}
impl Session {
    fn exchange(&mut self, command: &str, expected: &str) -> Result<Frame, String> {
        if command.len() > 256 || command.contains(['\n', '\r']) {
            return Err("Invalid Hamlib command".into());
        }
        self.writer
            .write_all(command.as_bytes())
            .and_then(|_| self.writer.write_all(b"\n"))
            .map_err(|_| "Hamlib write failed; command outcome unknown".to_string())?;
        parse_frame(&mut self.reader, expected)
    }
}

fn parse_frame<R: BufRead>(reader: &mut R, expected: &str) -> Result<Frame, String> {
    let mut bytes = 0usize;
    let mut values = Map::new();
    for line_number in 0..32 {
        let mut line = Vec::new();
        let count = (&mut *reader)
            .take((MAX_FRAME - bytes + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|_| "Hamlib read failed; command outcome unknown".to_string())?;
        bytes += count;
        if count == 0 || bytes > MAX_FRAME || !line.ends_with(b"\n") {
            return Err("Hamlib response incomplete or too large; command outcome unknown".into());
        }
        let line =
            String::from_utf8(line).map_err(|_| "Hamlib response is not UTF-8".to_string())?;
        let line = line.trim_end_matches(['\r', '\n']);
        if line_number == 0 {
            if !line.starts_with(expected) || !line[expected.len()..].starts_with(':') {
                return Err("Hamlib response command did not match".into());
            }
            continue;
        }
        if let Some(code) = line.strip_prefix("RPRT ") {
            let code = code
                .parse::<i32>()
                .map_err(|_| "Invalid Hamlib result code")?;
            return Ok(Frame { values, code });
        }
        // Some 4.x level/function handlers emit an unlabeled value even with
        // the extended prefix. Keep the terminal RPRT requirement for framing.
        let (key, value) = if let Some(pair) = line.split_once(": ") {
            pair
        } else if matches!(expected, "get_level" | "get_func") && line.parse::<f64>().is_ok() {
            (
                if expected == "get_level" {
                    "RFPOWER"
                } else {
                    "TUNER"
                },
                line,
            )
        } else {
            return Err("Malformed Hamlib response field".into());
        };
        if key.is_empty() || key.len() > 64 || values.contains_key(key) {
            return Err("Malformed Hamlib response field".into());
        }
        values.insert(key.into(), Value::String(value.into()));
    }
    Err("Hamlib response exceeded line limit".into())
}

fn run_command(
    session: &mut Session,
    command: &str,
    expected: &str,
) -> Result<Map<String, Value>, String> {
    let frame = session.exchange(command, expected)?;
    if frame.code != 0 {
        return Err(format!(
            "Hamlib backend returned RPRT {} for {expected}",
            frame.code
        ));
    }
    Ok(frame.values)
}

fn required_number(params: &Value, key: &str, min: f64, max: f64) -> Result<f64, String> {
    let n = params
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("{key} is required"))?;
    if !n.is_finite() || n < min || n > max {
        return Err(format!("{key} is out of range"));
    }
    if matches!(key, "hz" | "passband_hz" | "number") && n.fract() != 0.0 {
        return Err(format!("{key} must be an integer"));
    }
    Ok(n)
}
fn required_bool(params: &Value, key: &str) -> Result<bool, String> {
    params
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("{key} must be a boolean"))
}
fn token(params: &Value, key: &str, choices: &[&str]) -> Result<String, String> {
    let value = params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} is required"))?;
    if !choices.contains(&value) {
        return Err(format!("Invalid {key}"));
    }
    Ok(value.into())
}
#[cfg(test)]
fn text_value(values: &Map<String, Value>, key: &str) -> Option<String> {
    values.get(key).and_then(Value::as_str).map(str::to_owned)
}
fn observed(session: &mut Session, device: Device) -> Result<Value, String> {
    const EXTRAS: [(&str, &str, &str); 8] = [
        ("vfo", "+v", "get_vfo"),
        ("split", "+s", "get_split_vfo"),
        ("tx_frequency", "+i", "get_split_freq"),
        ("tx_mode", "+x", "get_split_mode"),
        ("ptt", "+t", "get_ptt"),
        ("rf_power", "+l RFPOWER", "get_level"),
        ("rit", "+j", "get_rit"),
        ("xit", "+z", "get_xit"),
    ];
    let mut fields = if device == Device::Radio {
        session.radio_extras.clone()
    } else {
        Map::new()
    };
    let mut errors = if device == Device::Radio {
        session.radio_errors.clone()
    } else {
        Map::new()
    };
    let fast: &[(&str, &str, &str)] = if device == Device::Radio {
        &[("frequency", "+f", "get_freq"), ("mode", "+m", "get_mode")]
    } else {
        &[("position", "+p", "get_pos")]
    };
    let mut probes = fast.to_vec();
    if device == Device::Radio {
        probes.push(EXTRAS[session.next_extra_probe % EXTRAS.len()]);
        session.next_extra_probe = (session.next_extra_probe + 1) % EXTRAS.len();
    }
    for (name, command, expected) in probes {
        match session.exchange(command, expected) {
            Ok(frame) if frame.code == 0 => {
                fields.insert(name.into(), Value::Object(frame.values));
                errors.remove(name);
            }
            Ok(frame) => {
                fields.remove(name);
                errors.insert(
                    name.into(),
                    json!({"state":"unavailable","code":frame.code}),
                );
            }
            Err(error) => return Err(error),
        }
        session.field_observed_at_ms.insert(
            name.into(),
            json!(SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()),
        );
    }
    if device == Device::Radio {
        session.radio_extras = fields
            .iter()
            .filter(|(name, _)| !["frequency", "mode"].contains(&name.as_str()))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        session.radio_errors = errors.clone();
    }
    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(
        json!({"device":device.name(),"mode":session.mode,"model":session.model,"port":session.port,
        "generation":session.generation,"observed_at_ms":observed_at_ms,"field_observed_at_ms":session.field_observed_at_ms,"fields":fields,"errors":errors,
        "tx_enabled":session.tx_enabled}),
    )
}

const MODES: &[&str] = &[
    "USB", "LSB", "CW", "CWR", "RTTY", "RTTYR", "AM", "FM", "WFM", "AMS", "PKTLSB", "PKTUSB",
    "PKTFM", "ECSSUSB", "ECSSLSB", "FA", "SAM", "SAL", "SAH", "DSB",
];
const VFOS: &[&str] = &[
    "VFOA", "VFOB", "VFOC", "currVFO", "VFO", "MEM", "Main", "Sub", "TX", "RX",
];

fn control(session: &mut Session, device: Device, params: &Value) -> Result<Value, String> {
    validate_expected_generation(params, session.generation)?;
    let action = params
        .get("action")
        .and_then(Value::as_str)
        .ok_or("action is required")?;
    if device == Device::Radio
        && matches!(
            action,
            "set_receive_frequency_a" | "set_receive_mode_a"
        )
    {
        let target_frequency = if action == "set_receive_frequency_a" {
            Some(required_number(params, "hz", 100.0, 10_000_000_000.0)?)
        } else {
            None
        };
        let target_mode = if action == "set_receive_mode_a" {
            let requested = token(
                params,
                "mode",
                &[
                    "USB", "LSB", "CW", "CWR", "AM", "FM", "RTTY", "RTTYR", "DIGU", "DIGL",
                ],
            )?;
            Some(
                match requested.as_str() {
                    "DIGU" => "PKTUSB",
                    "DIGL" => "PKTLSB",
                    value => value,
                }
                .to_owned(),
            )
        } else {
            None
        };
        // The whole check/write/readback sequence owns the one Hamlib session
        // lock. Never select a VFO implicitly: this narrow control is available
        // only when the radio already proves VFO A is receive and PTT is off.
        let before_vfo = run_command(session, "+v", "get_vfo")?;
        let before_ptt = run_command(session, "+t", "get_ptt")?;
        if before_vfo.get("VFO").and_then(Value::as_str) != Some("VFOA")
            || before_ptt.get("PTT").and_then(Value::as_str) != Some("0") {
            return Err(
                "Hamlib did not prove receive VFO A with PTT off; no receive write was sent."
                    .into(),
            );
        }
        if let Some(hz) = target_frequency {
            run_command(session, &format!("+F {hz:.0}"), "set_freq")?;
        }
        if let Some(mode) = target_mode.as_deref() {
            run_command(session, &format!("+M {mode} 0"), "set_mode")?;
        }
        let target = if target_frequency.is_some() {
            session.exchange("+f", "get_freq")?
        } else {
            session.exchange("+m", "get_mode")?
        };
        let after_vfo = session.exchange("+v", "get_vfo")?;
        let after_ptt = session.exchange("+t", "get_ptt")?;
        let target_matches = target.code == 0 && if let Some(hz) = target_frequency {
            target
                .values
                .get("Frequency")
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<f64>().ok())
                == Some(hz)
        } else {
            target.values.get("Mode").and_then(Value::as_str) == target_mode.as_deref()
        };
        let confirmed = target_matches
            && after_vfo.code == 0
            && after_ptt.code == 0
            && after_vfo.values.get("VFO").and_then(Value::as_str) == Some("VFOA")
            && after_ptt.values.get("PTT").and_then(Value::as_str) == Some("0");
        if !confirmed {
            return Err("Hamlib accepted the receive write but did not confirm the exact idle VFO-A state; inspect the radio before retrying.".into());
        }
        session.radio_extras.clear();
        session.radio_errors.clear();
        session.field_observed_at_ms.clear();
        session
            .radio_extras
            .insert("vfo".into(), Value::Object(after_vfo.values));
        session
            .radio_extras
            .insert("ptt".into(), Value::Object(after_ptt.values));
        let observed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        session
            .field_observed_at_ms
            .insert("vfo".into(), json!(observed));
        session
            .field_observed_at_ms
            .insert("ptt".into(), json!(observed));
        return Ok(json!({"state":"accepted","device":"radio","action":action,"confirmed":true,
            "generation":session.generation,"readback":{"state":"observed","target":target.values,"vfo":"A","ptt":false}}));
    }
    if device == Device::Radio && action == "tune_simplex" {
        let hz = required_number(params, "hz", 100.0, 10_000_000_000.0)?;
        let mode = token(params, "mode", MODES)?;
        // This whole sequence runs under the same radio-session lock. Neither
        // polling nor another UI command can split mode/frequency/VFO ownership.
        // Refuse the transaction before any write if RX VFO or split/TX VFO
        // ownership cannot be observed. A model with unproven single-VFO
        // semantics is not safe to treat as simplex by assumption.
        let before_vfo = run_command(session, "+v", "get_vfo")
            .map_err(|error| format!("Cannot verify RX VFO; simplex tune was not started: {error}"))?;
        if !matches!(before_vfo.get("VFO").and_then(Value::as_str), Some("VFOA" | "VFOB" | "VFOC")) {
            return Err("Hamlib does not report a selectable VFO A/B/C; simplex tune was not started".into());
        }
        let before_split = run_command(session, "+s", "get_split_vfo")
            .map_err(|error| format!("Cannot verify split state; simplex tune was not started: {error}"))?;
        if !matches!(before_split.get("Split").and_then(Value::as_str), Some("0" | "1")) {
            return Err("Hamlib split state is unknown; simplex tune was not started".into());
        }
        if before_split.get("Split").and_then(Value::as_str) == Some("1")
            && !matches!(before_split.get("TX VFO").and_then(Value::as_str), Some("VFOA" | "VFOB" | "VFOC"))
        {
            return Err("Hamlib TX VFO is unknown; simplex tune was not started".into());
        }
        run_command(session, "+V VFOA", "set_vfo")?;
        let selected_vfo = run_command(session, "+v", "get_vfo")?;
        if selected_vfo.get("VFO").and_then(Value::as_str) != Some("VFOA") {
            return Err("Hamlib did not confirm RX VFO A; frequency and mode were not written".into());
        }
        run_command(session, "+S 0 VFOA", "set_split_vfo")?;
        let simplex = run_command(session, "+s", "get_split_vfo")?;
        if simplex.get("Split").and_then(Value::as_str) != Some("0") {
            return Err("Hamlib did not confirm split OFF; frequency and mode were not written".into());
        }
        run_command(session, &format!("+M {mode} 0"), "set_mode")?;
        run_command(session, &format!("+F {hz:.0}"), "set_freq")?;
        session.radio_extras.clear();
        session.radio_errors.clear();
        session.field_observed_at_ms.clear();
        let freq = session.exchange("+f", "get_freq")?;
        let mode_read = session.exchange("+m", "get_mode")?;
        let split = session.exchange("+s", "get_split_vfo")?;
        let vfo = session.exchange("+v", "get_vfo")?;
        let confirmed = freq.code == 0
            && mode_read.code == 0
            && split.code == 0
            && vfo.code == 0
            && freq
                .values
                .get("Frequency")
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<f64>().ok())
                == Some(hz)
            && mode_read.values.get("Mode").and_then(Value::as_str) == Some(mode.as_str())
            && split.values.get("Split").and_then(Value::as_str) == Some("0")
            && vfo.values.get("VFO").and_then(Value::as_str) == Some("VFOA");
        if split.code == 0 {
            session
                .radio_extras
                .insert("split".into(), Value::Object(split.values));
        }
        if vfo.code == 0 {
            session
                .radio_extras
                .insert("vfo".into(), Value::Object(vfo.values));
        }
        let observed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        for name in ["split", "vfo"] {
            if session.radio_extras.contains_key(name) {
                session
                    .field_observed_at_ms
                    .insert(name.into(), json!(observed));
            }
        }
        return Ok(
            json!({"state":"accepted", "device":"radio", "action":action, "confirmed":confirmed,
            "generation":session.generation, "readback":{"state":"observed", "frequency":freq.values, "mode":mode_read.values}}),
        );
    }
    let (command, expected, readback, tx_action) = match (device, action) {
        (Device::Radio, "frequency") => (
            format!(
                "+F {:.0}",
                required_number(params, "hz", 100.0, 10_000_000_000.0)?
            ),
            "set_freq",
            Some(("+f", "get_freq")),
            false,
        ),
        (Device::Radio, "mode") => (
            format!(
                "+M {} {:.0}",
                token(params, "mode", MODES)?,
                required_number(params, "passband_hz", 0.0, 100_000.0)?
            ),
            "set_mode",
            Some(("+m", "get_mode")),
            false,
        ),
        (Device::Radio, "vfo") => (
            format!("+V {}", token(params, "vfo", VFOS)?),
            "set_vfo",
            Some(("+v", "get_vfo")),
            false,
        ),
        (Device::Radio, "split") => (
            format!(
                "+S {} {}",
                if required_bool(params, "enabled")? {
                    1
                } else {
                    0
                },
                token(params, "tx_vfo", VFOS)?
            ),
            "set_split_vfo",
            Some(("+s", "get_split_vfo")),
            false,
        ),
        (Device::Radio, "tx_frequency") => (
            format!(
                "+I {:.0}",
                required_number(params, "hz", 100.0, 10_000_000_000.0)?
            ),
            "set_split_freq",
            Some(("+i", "get_split_freq")),
            false,
        ),
        (Device::Radio, "tx_mode") => (
            format!(
                "+X {} {:.0}",
                token(params, "mode", MODES)?,
                required_number(params, "passband_hz", 0.0, 100_000.0)?
            ),
            "set_split_mode",
            Some(("+x", "get_split_mode")),
            false,
        ),
        (Device::Radio, "rit") => (
            format!(
                "+J {:.0}",
                required_number(params, "hz", -100_000.0, 100_000.0)?
            ),
            "set_rit",
            Some(("+j", "get_rit")),
            false,
        ),
        (Device::Radio, "xit") => (
            format!(
                "+Z {:.0}",
                required_number(params, "hz", -100_000.0, 100_000.0)?
            ),
            "set_xit",
            Some(("+z", "get_xit")),
            false,
        ),
        (Device::Radio, "rf_power") => (
            format!("+L RFPOWER {}", required_number(params, "value", 0.0, 1.0)?),
            "set_level",
            Some(("+l RFPOWER", "get_level")),
            false,
        ),
        (Device::Radio, "antenna") => (
            format!("+Y {:.0}", required_number(params, "number", 0.0, 255.0)?),
            "set_ant",
            Some(("+y", "get_ant")),
            false,
        ),
        (Device::Radio, "ptt") => (
            format!("+T {}", if required_bool(params, "on")? { 1 } else { 0 }),
            "set_ptt",
            Some(("+t", "get_ptt")),
            params["on"] == true,
        ),
        (Device::Radio, "tuner") => (
            format!(
                "+U TUNER {}",
                if required_bool(params, "on")? { 1 } else { 0 }
            ),
            "set_func",
            Some(("+u TUNER", "get_func")),
            params["on"] == true,
        ),
        (Device::Radio, "cw") => {
            let text = params["text"].as_str().ok_or("CW text is required")?;
            if text.is_empty()
                || text.len() > 80
                || !text
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || " /?=+.-,':".contains(c))
            {
                return Err("Invalid CW text".into());
            }
            (format!("+b {text}"), "send_morse", None, true)
        }
        (Device::Radio, "cw_stop") => ("+\\stop_morse".into(), "stop_morse", None, false),
        (Device::Rotor, "goto") => (
            format!(
                "+P {} {}",
                required_number(params, "azimuth", 0.0, 450.0)?,
                required_number(params, "elevation", 0.0, 180.0)?
            ),
            "set_pos",
            Some(("+p", "get_pos")),
            false,
        ),
        (Device::Rotor, "stop") => ("+S".into(), "stop", Some(("+p", "get_pos")), false),
        (Device::Rotor, "park") => ("+K".into(), "park", Some(("+p", "get_pos")), false),
        _ => return Err("Unsupported Hamlib control action".into()),
    };
    if tx_action && !session.tx_enabled {
        return Err("Transmit control is disabled for this session".into());
    }
    // Mark a possible TX before writing. If the acknowledgement is lost, Drop
    // still attempts release instead of assuming the device stayed in RX.
    match action {
        "ptt" if params["on"] == true => session.ptt_owned = true,
        "tuner" if params["on"] == true => session.tuner_owned = true,
        "cw" => session.cw_owned = true,
        _ => {}
    }
    run_command(session, &command, expected)?;
    session.radio_extras.clear();
    session.radio_errors.clear();
    let readback = if let Some((get, expected)) = readback {
        match session.exchange(get, expected) {
            Ok(frame) if frame.code == 0 => json!({"state":"observed","fields":frame.values}),
            Ok(frame) => json!({"state":"unavailable","code":frame.code}),
            Err(error) => return Err(error),
        }
    } else {
        json!({"state":"unverified"})
    };
    // A setter ACK is not a physical OFF observation. Retain ownership when a
    // backend ignores the command or cannot provide a readback, so Drop still
    // makes a best-effort release. CW has no Hamlib stop-state readback and is
    // likewise retained after stop_morse's ACK.
    if matches!(action, "ptt" | "tuner") {
        let field = if action == "ptt" { "PTT" } else { "TUNER" };
        let observed_on = readback["fields"][field]
            .as_str()
            .and_then(|value| value.parse::<i32>().ok())
            .map(|value| value != 0);
        if observed_on == Some(false) {
            if action == "ptt" {
                session.ptt_owned = false;
            } else {
                session.tuner_owned = false;
            }
        }
        if observed_on != Some(params["on"] == true) {
            return Err(format!(
                "Hamlib {action} readback did not confirm the requested state; inspect and retry the control"
            ));
        }
    }
    Ok(
        json!({"state":"accepted","device":device.name(),"action":action,"readback":readback,"generation":session.generation}),
    )
}

fn validate_expected_generation(params: &Value, generation: u64) -> Result<(), String> {
    if let Some(expected) = params.get("expected_generation") {
        if expected.as_u64() != Some(generation) {
            return Err("Radio connection changed; stale control was not sent".into());
        }
    }
    Ok(())
}

fn release_owned_tx(session: &mut Session) -> Result<(), String> {
    let mut unverified = Vec::new();
    if session.cw_owned {
        if run_command(session, "+\\stop_morse", "stop_morse").is_ok() {
            // Hamlib has no CW-running query; the stop command's ACK is the
            // strongest available release evidence. Drop retries on failure.
            session.cw_owned = false;
        } else {
            unverified.push("CW");
        }
    }
    if session.tuner_owned
        && control(session, Device::Radio, &json!({"action":"tuner","on":false})).is_err()
    {
        unverified.push("tuner");
    }
    if session.ptt_owned
        && control(session, Device::Radio, &json!({"action":"ptt","on":false})).is_err()
    {
        unverified.push("PTT");
    }
    if unverified.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Owned transmit release is unverified for {}; connection remains open for retry",
            unverified.join(", ")
        ))
    }
}

fn disconnect_session(session_slot: &mut Option<Session>, device: Device) -> Result<Value, String> {
    if device == Device::Radio {
        if let Some(session) = session_slot.as_mut() {
            release_owned_tx(session)?;
        }
    }
    let existed = session_slot.take().is_some();
    let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    Ok(json!({"device":device.name(),"disconnected":existed,"generation":generation}))
}

fn models(device: Device) -> Result<Value, String> {
    let path = binary_path(device)?;
    let mut child = Command::new(path)
        .arg("-l")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Cannot enumerate bundled Hamlib models")?;
    let mut output = child
        .stdout
        .take()
        .ok_or("Hamlib model stream unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = (&mut output)
            .take((MAX_MODELS + 1) as u64)
            .read_to_end(&mut bytes);
        (result, bytes)
    });
    let deadline = Instant::now() + IO_TIMEOUT;
    loop {
        if child
            .try_wait()
            .map_err(|_| "Cannot inspect Hamlib model process")?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Hamlib model enumeration timed out".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let (read_result, bytes) = reader.join().map_err(|_| "Hamlib model reader failed")?;
    read_result.map_err(|_| "Hamlib model listing failed")?;
    if bytes.len() > MAX_MODELS {
        return Err("Hamlib model listing exceeds limit".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "Hamlib model list is not UTF-8")?;
    let entries: Vec<Value> = text.lines().filter_map(parse_model_line).collect();
    if entries.is_empty() {
        return Err("Bundled Hamlib returned no models".into());
    }
    Ok(json!({"device":device.name(),"models":entries}))
}

fn bounded_helper_output(mut command: Command, limit: usize) -> Result<String, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Bundled Hamlib query could not start")?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Hamlib query stream unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = (&mut stdout)
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes);
        (result, bytes)
    });
    let deadline = Instant::now() + IO_TIMEOUT;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "Cannot inspect Hamlib query")?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("Bundled Hamlib query timed out".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let (read, bytes) = reader.join().map_err(|_| "Hamlib query reader failed")?;
    read.map_err(|_| "Hamlib query read failed")?;
    if bytes.len() > limit {
        return Err("Hamlib query exceeded output limit".into());
    }
    if !status.success() {
        return Err("Hamlib rejected the model capability query".into());
    }
    String::from_utf8(bytes).map_err(|_| "Hamlib capability output is not UTF-8".into())
}

fn parse_capability_lines(text: &str) -> Map<String, Value> {
    let mut values = Map::new();
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() || key.len() > 96 {
            continue;
        }
        let value = Value::String(value.trim().into());
        if let Some(previous) = values.get_mut(key) {
            if let Some(array) = previous.as_array_mut() {
                array.push(value);
            } else {
                *previous = Value::Array(vec![previous.clone(), value]);
            }
        } else {
            values.insert(key.into(), value);
        }
    }
    values
}

fn remote_capabilities(session: &mut Session) -> Result<String, String> {
    session
        .writer
        .write_all(b"+\\dump_caps\n")
        .map_err(|_| "Hamlib capability write failed; connection outcome unknown")?;
    let mut text = String::new();
    for number in 0..2048 {
        let mut line = Vec::new();
        let count = (&mut session.reader)
            .take((MAX_CAPABILITIES - text.len() + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|_| "Hamlib capability read failed; connection outcome unknown")?;
        if count == 0 || text.len() + count > MAX_CAPABILITIES || !line.ends_with(b"\n") {
            return Err(
                "Hamlib capability response incomplete or too large; connection outcome unknown"
                    .into(),
            );
        }
        let line =
            String::from_utf8(line).map_err(|_| "Hamlib capability response is not UTF-8")?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if number == 0 && !trimmed.starts_with("dump_caps:") {
            return Err(
                "Hamlib capability response did not match; connection outcome unknown".into(),
            );
        }
        if let Some(code) = trimmed.strip_prefix("RPRT ") {
            let code = code
                .parse::<i32>()
                .map_err(|_| "Invalid Hamlib capability result")?;
            if code != 0 {
                return Err(format!("Hamlib backend returned RPRT {code} for dump_caps"));
            }
            return Ok(text);
        }
        if number > 0 {
            text.push_str(&line);
        }
    }
    Err("Hamlib capability response exceeded line limit; connection outcome unknown".into())
}

fn capabilities(
    device: Device,
    params: &Value,
    session: Option<&mut Session>,
) -> Result<Value, String> {
    let (text, source, model) = if let Some(model) = params.get("model") {
        let model = model
            .as_u64()
            .filter(|id| (1..=u32::MAX as u64).contains(id))
            .ok_or("A Hamlib model ID is required")? as u32;
        if model == 2 {
            return Err("Use an existing connected daemon for NET Hamlib capabilities".into());
        }
        let mut command = Command::new(binary_path(device)?);
        command.args(["-m", &model.to_string(), "-u"]);
        (
            bounded_helper_output(command, MAX_CAPABILITIES)?,
            "bundled_model",
            Some(model),
        )
    } else {
        let session = session.ok_or("Connect a Hamlib device or select a model first")?;
        (
            remote_capabilities(session)?,
            "connected_daemon",
            session.model,
        )
    };
    let parsed = parse_capability_lines(&text);
    if parsed.is_empty() {
        return Err("Hamlib returned no readable capabilities".into());
    }
    Ok(
        json!({"device":device.name(),"model":model,"source":source,"text":text,"capabilities":parsed}),
    )
}

fn serial_ports(device: Device) -> Value {
    let mut ports = Vec::new();
    #[cfg(unix)]
    {
        let mut candidates = Vec::new();
        #[cfg(target_os = "macos")]
        if let Ok(entries) = std::fs::read_dir("/dev") {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("cu.") {
                    candidates.push(("/dev".to_owned(), name));
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(entries) = std::fs::read_dir("/dev/serial/by-id") {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    candidates.push(("/dev/serial/by-id".to_owned(), name));
                }
            }
            if let Ok(entries) = std::fs::read_dir("/dev") {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("ttyUSB")
                        || name.starts_with("ttyACM")
                        || name.starts_with("ttyS")
                    {
                        candidates.push(("/dev".to_owned(), name));
                    }
                }
            }
        }
        candidates.sort();
        for (directory, name) in candidates.into_iter().take(256) {
            let path = format!("{directory}/{name}");
            ports.push(json!({"path":path,"label":name,"kind":"serial"}));
        }
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("reg");
        command.args(["query", r"HKLM\HARDWARE\DEVICEMAP\SERIALCOMM"]);
        if let Ok(output) = bounded_helper_output(command, 65_536) {
            for line in output.lines() {
                let Some(port) = line.split_whitespace().last() else {
                    continue;
                };
                if port.starts_with("COM") && port[3..].parse::<u16>().is_ok() {
                    ports.push(json!({"path":port,"label":port,"kind":"serial"}));
                }
            }
        }
    }
    json!({"device":device.name(),"ports":ports,"inventory_only":true})
}

fn session_status(session_slot: &mut Option<Session>, device: Device) -> Value {
    let Some(session) = session_slot.as_mut() else {
        return json!({"device":device.name(),"connected":false,"state":"disconnected",
            "reconnect_required":true});
    };
    if session
        .child
        .as_mut()
        .is_some_and(|child| matches!(child.try_wait(), Ok(Some(_))))
    {
        let generation = session.generation;
        *session_slot = None;
        return json!({"device":device.name(),"connected":false,"state":"helper_exited",
            "generation":generation,"reconnect_required":true});
    }
    let probe = if device == Device::Radio {
        ("+f", "get_freq")
    } else {
        ("+p", "get_pos")
    };
    let generation = session.generation;
    let mode = session.mode;
    let model = session.model;
    match session.exchange(probe.0, probe.1) {
        Ok(frame) if frame.code == 0 => json!({"device":device.name(),"connected":true,
            "state":"responsive","generation":generation,"mode":mode,"model":model,
            "reconnect_required":false}),
        Ok(frame) => json!({"device":device.name(),"connected":true,
            "state":"backend_unavailable","code":frame.code,"generation":generation,
            "mode":mode,"model":model,"reconnect_required":false}),
        Err(_) => {
            *session_slot = None;
            json!({"device":device.name(),"connected":false,"state":"connection_lost",
                "generation":generation,"reconnect_required":true})
        }
    }
}

fn parse_model_line(line: &str) -> Option<Value> {
    let mut columns = Vec::new();
    let mut start = 0usize;
    let bytes = line.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b' ' {
            let run = index;
            while index < bytes.len() && bytes[index] == b' ' {
                index += 1;
            }
            if index - run >= 2 {
                if let Some(value) = line
                    .get(start..run)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    columns.push(value);
                }
                start = index;
            }
        } else {
            index += 1;
        }
    }
    if let Some(value) = line.get(start..).map(str::trim).filter(|s| !s.is_empty()) {
        columns.push(value);
    }
    if columns.len() < 5 {
        return None;
    }
    let id = columns[0].parse::<u32>().ok()?;
    Some(
        json!({"id":id,"manufacturer":columns[1],"model":columns[2],"backend_version":columns[3],"maturity":columns[4]}),
    )
}

fn dispatch(method: &str, params: &Value) -> Result<Value, String> {
    let device = Device::parse(&params["device"])?;
    if method == "hamlib_models" {
        return models(device);
    }
    if method == "hamlib_serial_ports" {
        return Ok(serial_ports(device));
    }
    if method == "hamlib_capabilities" && params.get("model").is_some() {
        return capabilities(device, params, None);
    }
    // Rig and rotor have independent locks, so a slow rig poll cannot delay rotor stop.
    let mut session_slot = slot(device)
        .lock()
        .map_err(|_| "Hamlib device lock failed")?;
    match method {
        "hamlib_connect" | "hamlib_reconnect" => {
            if method == "hamlib_connect" && session_slot.is_some() {
                return Err("Device already has a Hamlib session; disconnect it first".into());
            }
            validate_connection_config(params)?;
            if method == "hamlib_reconnect" {
                // Explicit reconnect creates a new generation. No frequency,
                // mode, PTT, CW, or rotor command is copied to the new session.
                if device == Device::Radio {
                    if let Some(session) = session_slot.as_mut() {
                        release_owned_tx(session)?;
                    }
                }
                *session_slot = None;
            }
            let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
            let session = match params["mode"].as_str() {
                Some("managed") => start_managed(device, params, generation)?,
                Some("external") => start_external(device, params, generation)?,
                _ => return Err("mode must be managed or external".into()),
            };
            *session_slot = Some(session);
            let result = observed(session_slot.as_mut().unwrap(), device);
            if result.is_err() {
                *session_slot = None;
            }
            result
        }
        "hamlib_disconnect" => disconnect_session(&mut session_slot, device),
        "hamlib_status" => Ok(session_status(&mut session_slot, device)),
        "hamlib_capabilities" => {
            let result = capabilities(device, params, session_slot.as_mut());
            if result.as_ref().err().is_some_and(|error| {
                error.contains("outcome unknown")
                    || error.contains("response did not match")
                    || error.contains("response exceeded")
                    || error.contains("response is not UTF-8")
            }) {
                *session_slot = None;
            }
            result
        }
        "hamlib_snapshot" | "hamlib_control" => {
            let session = session_slot
                .as_mut()
                .ok_or("Hamlib device is not connected")?;
            let result = if method == "hamlib_snapshot" {
                observed(session, device)
            } else {
                control(session, device, params)
            };
            if result.as_ref().err().is_some_and(|e| {
                e.contains("outcome unknown")
                    || e.contains("command did not match")
                    || e.contains("response incomplete")
                    || e.contains("response exceeded")
                    || e.contains("response is not UTF-8")
                    || e.contains("Malformed Hamlib response")
                    || e.contains("Invalid Hamlib result")
            }) {
                *session_slot = None;
            }
            result
        }
        _ => Err("Unknown Hamlib method".into()),
    }
}

pub fn request(request: Value) -> Result<Value, String> {
    let id = request
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .ok_or("Invalid request ID")?;
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .ok_or("Method is required")?;
    let params = request
        .get("params")
        .filter(|p| p.is_object())
        .ok_or("Parameters must be an object")?;
    if serde_json::to_vec(&request)
        .map_err(|_| "Invalid request")?
        .len()
        > 32_768
    {
        return Err("Hamlib request exceeds size limit".into());
    }
    if ![
        "hamlib_models",
        "hamlib_serial_ports",
        "hamlib_capabilities",
        "hamlib_status",
        "hamlib_connect",
        "hamlib_reconnect",
        "hamlib_disconnect",
        "hamlib_snapshot",
        "hamlib_control",
    ]
    .contains(&method)
    {
        return Err("Unknown Hamlib method".into());
    }
    match dispatch(method, params) {
        Ok(result) => Ok(json!({"id":id,"ok":true,"result":result})),
        Err(message) => Ok(json!({"id":id,"ok":false,"error":{"code":"HAMLIB","message":message}})),
    }
}

pub fn shutdown() {
    if let Some(radio) = RADIO.get() {
        if let Ok(mut radio) = radio.lock() {
            *radio = None;
        }
    }
    if let Some(rotor) = ROTOR.get() {
        if let Ok(mut rotor) = rotor.lock() {
            *rotor = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn macro_controls_require_the_exact_generation_when_supplied() {
        assert!(validate_expected_generation(&json!({}), 7).is_ok());
        assert!(validate_expected_generation(&json!({"expected_generation":7}), 7).is_ok());
        for value in [json!(8), json!(6), json!(-1), json!(7.5), json!("7"), json!(true), Value::Null] {
            assert!(validate_expected_generation(&json!({"expected_generation":value}), 7).is_err());
        }
    }

    #[test]
    fn stale_macro_send_and_stop_never_reach_the_transport() {
        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (reader, writer) = connect_stream(address).unwrap();
        let (mut peer, _) = listener.accept().unwrap();
        peer.set_read_timeout(Some(Duration::from_millis(50))).unwrap();
        let mut session = Session::new(reader, writer, None, "external", address.port(), None, true, 7);
        for action in ["cw", "cw_stop"] {
            let result = control(&mut session, Device::Radio, &json!({"action":action,"text":"CQ", "expected_generation":6}));
            assert!(result.unwrap_err().contains("connection changed"));
        }
        let mut byte = [0u8; 1];
        let error = peer.read(&mut byte).unwrap_err();
        assert!(matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut));
        assert!(!session.cw_owned);
    }

    #[test]
    fn parser_handles_multiline_extended_frame() {
        let mut input = Cursor::new(b"get_mode:\nMode: USB\nPassband: 2400\nRPRT 0\n");
        let frame = parse_frame(&mut input, "get_mode").unwrap();
        assert_eq!(frame.code, 0);
        assert_eq!(text_value(&frame.values, "Mode").as_deref(), Some("USB"));
        assert_eq!(
            text_value(&frame.values, "Passband").as_deref(),
            Some("2400")
        );
    }
    #[test]
    fn parser_rejects_wrong_command_and_unterminated_reply() {
        assert!(parse_frame(&mut Cursor::new(b"get_pos:\nRPRT 0\n"), "get_freq").is_err());
        assert!(parse_frame(
            &mut Cursor::new(b"get_freq:\nFrequency: 14000000"),
            "get_freq"
        )
        .is_err());
    }
    #[test]
    fn framed_tcp_read_handles_fragmentation_without_losing_next_reply() {
        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut command = [0u8; 3];
            socket.read_exact(&mut command).unwrap();
            assert_eq!(&command, b"+f\n");
            socket.write_all(b"get_freq:\nFre").unwrap();
            std::thread::sleep(Duration::from_millis(10));
            socket.write_all(b"quency: 14074000\nRPRT 0\n").unwrap();
        });
        let (reader, writer) = connect_stream(address).unwrap();
        let mut session = Session::new(
            reader,
            writer,
            None,
            "external",
            address.port(),
            None,
            false,
            1,
        );
        let frame = session.exchange("+f", "get_freq").unwrap();
        assert_eq!(
            text_value(&frame.values, "Frequency").as_deref(),
            Some("14074000")
        );
        server.join().unwrap();

        let mut combined =
            Cursor::new(b"get_freq:\nFrequency: 1\nRPRT 0\nget_freq:\nFrequency: 2\nRPRT 0\n");
        assert_eq!(
            text_value(
                &parse_frame(&mut combined, "get_freq").unwrap().values,
                "Frequency"
            )
            .as_deref(),
            Some("1")
        );
        assert_eq!(
            text_value(
                &parse_frame(&mut combined, "get_freq").unwrap().values,
                "Frequency"
            )
            .as_deref(),
            Some("2")
        );
    }
    #[test]
    fn shutdown_releases_only_session_owned_tx() {
        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            for (command, response) in [
                ("+\\stop_morse\n", "stop_morse:\nRPRT 0\n"),
                ("+U TUNER 0\n", "set_func: TUNER 0\nRPRT 0\n"),
                ("+T 0\n", "set_ptt: 0\nRPRT 0\n"),
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line, command);
                socket.write_all(response.as_bytes()).unwrap();
            }
        });
        let (reader, writer) = connect_stream(address).unwrap();
        let mut session = Session::new(
            reader,
            writer,
            None,
            "external",
            address.port(),
            None,
            true,
            1,
        );
        session.ptt_owned = true;
        session.tuner_owned = true;
        session.cw_owned = true;
        drop(session);
        server.join().unwrap();

        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_millis(500)))
                .unwrap();
            let mut byte = [0u8; 1];
            assert_eq!(socket.read(&mut byte).unwrap(), 0);
        });
        let (reader, writer) = connect_stream(address).unwrap();
        drop(Session::new(
            reader,
            writer,
            None,
            "external",
            address.port(),
            None,
            false,
            2,
        ));
        server.join().unwrap();
    }

    #[test]
    fn exact_receive_controls_confirm_idle_vfo_a_and_the_requested_target() {
        for (params, exchanges, expected) in [
            (
                json!({"action":"set_receive_frequency_a","hz":14_075_100,"expected_generation":7}),
                vec![
                    ("+v\n", "get_vfo:\nVFO: VFOA\nRPRT 0\n"),
                    ("+t\n", "get_ptt:\nPTT: 0\nRPRT 0\n"),
                    ("+F 14075100\n", "set_freq: 14075100\nRPRT 0\n"),
                    ("+f\n", "get_freq:\nFrequency: 14075100\nRPRT 0\n"),
                    ("+v\n", "get_vfo:\nVFO: VFOA\nRPRT 0\n"),
                    ("+t\n", "get_ptt:\nPTT: 0\nRPRT 0\n"),
                ],
                "14075100",
            ),
            (
                json!({"action":"set_receive_mode_a","mode":"DIGU","expected_generation":7}),
                vec![
                    ("+v\n", "get_vfo:\nVFO: VFOA\nRPRT 0\n"),
                    ("+t\n", "get_ptt:\nPTT: 0\nRPRT 0\n"),
                    ("+M PKTUSB 0\n", "set_mode: PKTUSB 0\nRPRT 0\n"),
                    ("+m\n", "get_mode:\nMode: PKTUSB\nPassband: 0\nRPRT 0\n"),
                    ("+v\n", "get_vfo:\nVFO: VFOA\nRPRT 0\n"),
                    ("+t\n", "get_ptt:\nPTT: 0\nRPRT 0\n"),
                ],
                "PKTUSB",
            ),
        ] {
            let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                for (command, response) in exchanges {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    assert_eq!(line, command);
                    socket.write_all(response.as_bytes()).unwrap();
                }
            });
            let (reader, writer) = connect_stream(address).unwrap();
            let mut session = Session::new(
                reader,
                writer,
                None,
                "external",
                address.port(),
                None,
                false,
                7,
            );
            let receipt = control(&mut session, Device::Radio, &params).unwrap();
            assert_eq!(receipt["confirmed"], true);
            assert!(receipt["readback"]["target"]
                .as_object()
                .unwrap()
                .values()
                .any(|value| value == expected));
            assert_eq!(receipt["readback"]["vfo"], "A");
            assert_eq!(receipt["readback"]["ptt"], false);
            drop(session);
            server.join().unwrap();
        }
    }

    #[test]
    fn exact_receive_control_sends_no_write_without_idle_vfo_a() {
        for (vfo, ptt) in [("VFOB", "0"), ("VFOA", "1")] {
            let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                for (command, response) in [
                    ("+v\n", format!("get_vfo:\nVFO: {vfo}\nRPRT 0\n")),
                    ("+t\n", format!("get_ptt:\nPTT: {ptt}\nRPRT 0\n")),
                ] {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    assert_eq!(line, command);
                    socket.write_all(response.as_bytes()).unwrap();
                }
                let mut line = String::new();
                assert_eq!(reader.read_line(&mut line).unwrap(), 0);
            });
            let (reader, writer) = connect_stream(address).unwrap();
            let mut session = Session::new(
                reader,
                writer,
                None,
                "external",
                address.port(),
                None,
                false,
                7,
            );
            let error = control(
                &mut session,
                Device::Radio,
                &json!({"action":"set_receive_frequency_a","hz":14_075_100,"expected_generation":7}),
            )
            .unwrap_err();
            assert!(error.contains("no receive write was sent"));
            drop(session);
            server.join().unwrap();
        }
    }

    #[test]
    fn exact_receive_control_rejects_unconfirmed_readback() {
        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            for (command, response) in [
                ("+v\n", "get_vfo:\nVFO: VFOA\nRPRT 0\n"),
                ("+t\n", "get_ptt:\nPTT: 0\nRPRT 0\n"),
                ("+F 14075100\n", "set_freq: 14075100\nRPRT 0\n"),
                ("+f\n", "get_freq:\nFrequency: 14075200\nRPRT 0\n"),
                ("+v\n", "get_vfo:\nVFO: VFOA\nRPRT 0\n"),
                ("+t\n", "get_ptt:\nPTT: 0\nRPRT 0\n"),
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line, command);
                socket.write_all(response.as_bytes()).unwrap();
            }
        });
        let (reader, writer) = connect_stream(address).unwrap();
        let mut session = Session::new(
            reader,
            writer,
            None,
            "external",
            address.port(),
            None,
            false,
            7,
        );
        let error = control(
            &mut session,
            Device::Radio,
            &json!({"action":"set_receive_frequency_a","hz":14_075_100,"expected_generation":7}),
        )
        .unwrap_err();
        assert!(error.contains("did not confirm"));
        drop(session);
        server.join().unwrap();
    }

    #[test]
    fn rejected_vfo_or_split_probe_never_starts_simplex_writes() {
        for unsupported in ["vfo", "split", "tx_vfo"] {
            let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line, "+v\n");
                if unsupported == "vfo" {
                    socket.write_all(b"get_vfo:\nRPRT -11\n").unwrap();
                } else {
                    socket.write_all(b"get_vfo:\nVFO: VFOA\nRPRT 0\n").unwrap();
                    line.clear();
                    reader.read_line(&mut line).unwrap();
                    assert_eq!(line, "+s\n");
                    if unsupported == "split" {
                        socket.write_all(b"get_split_vfo:\nRPRT -11\n").unwrap();
                    } else {
                        socket.write_all(b"get_split_vfo:\nSplit: 1\nTX VFO: Unknown\nRPRT 0\n").unwrap();
                    }
                }
                line.clear();
                assert_eq!(reader.read_line(&mut line).unwrap(), 0);
            });
            let (reader, writer) = connect_stream(address).unwrap();
            let mut session = Session::new(reader, writer, None, "external", address.port(), None, false, 1);
            assert!(control(&mut session, Device::Radio, &json!({"action":"tune_simplex","hz":14_195_000,"mode":"USB"})).is_err());
            drop(session);
            server.join().unwrap();
        }
    }

    #[test]
    fn simplex_aborts_before_frequency_and_mode_when_ownership_ack_is_wrong() {
        for mismatch in ["vfo", "split"] {
            let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                let mut exchange = |command: &str, response: &str| {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    assert_eq!(line, command);
                    socket.write_all(response.as_bytes()).unwrap();
                };
                exchange("+v\n", "get_vfo:\nVFO: VFOB\nRPRT 0\n");
                exchange("+s\n", "get_split_vfo:\nSplit: 1\nTX VFO: VFOB\nRPRT 0\n");
                exchange("+V VFOA\n", "set_vfo: VFOA\nRPRT 0\n");
                exchange("+v\n", if mismatch == "vfo" {
                    "get_vfo:\nVFO: VFOB\nRPRT 0\n"
                } else {
                    "get_vfo:\nVFO: VFOA\nRPRT 0\n"
                });
                if mismatch == "split" {
                    exchange("+S 0 VFOA\n", "set_split_vfo: 0 VFOA\nRPRT 0\n");
                    exchange("+s\n", "get_split_vfo:\nSplit: 1\nTX VFO: VFOB\nRPRT 0\n");
                }
                let mut line = String::new();
                assert_eq!(reader.read_line(&mut line).unwrap(), 0);
            });
            let (reader, writer) = connect_stream(address).unwrap();
            let mut session = Session::new(reader, writer, None, "external", address.port(), None, false, 1);
            let error = control(&mut session, Device::Radio, &json!({"action":"tune_simplex","hz":14_195_000,"mode":"USB"})).unwrap_err();
            assert!(error.contains("frequency and mode were not written"), "{error}");
            drop(session);
            server.join().unwrap();
        }
    }

    #[test]
    fn tx_off_ack_with_on_readback_keeps_owned_release() {
        for action in ["ptt", "tuner"] {
            let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                let (off, ack, get, reading) = if action == "ptt" {
                    ("+T 0\n", "set_ptt: 0\nRPRT 0\n", "+t\n", "get_ptt:\nPTT: 1\nRPRT 0\n")
                } else {
                    ("+U TUNER 0\n", "set_func: TUNER 0\nRPRT 0\n", "+u TUNER\n", "get_func: TUNER\nTUNER: 1\nRPRT 0\n")
                };
                for (command, response) in [(off, ack), (get, reading), (off, ack)] {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    assert_eq!(line, command);
                    socket.write_all(response.as_bytes()).unwrap();
                }
            });
            let (reader, writer) = connect_stream(address).unwrap();
            let mut session = Session::new(reader, writer, None, "external", address.port(), None, true, 1);
            if action == "ptt" { session.ptt_owned = true; } else { session.tuner_owned = true; }
            let error = control(&mut session, Device::Radio, &json!({"action":action,"on":false})).unwrap_err();
            assert!(error.contains("readback did not confirm"), "{error}");
            assert!(if action == "ptt" { session.ptt_owned } else { session.tuner_owned });
            drop(session);
            server.join().unwrap();
        }
    }

    #[test]
    fn rejected_tx_on_command_keeps_possible_ownership_until_release() {
        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            for (command, response) in [
                ("+T 1\n", "set_ptt: 1\nRPRT -11\n"),
                ("+T 0\n", "set_ptt: 0\nRPRT 0\n"),
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line, command);
                socket.write_all(response.as_bytes()).unwrap();
            }
        });
        let (reader, writer) = connect_stream(address).unwrap();
        let mut session = Session::new(reader, writer, None, "external", address.port(), None, true, 1);
        assert!(control(&mut session, Device::Radio, &json!({"action":"ptt","on":true})).is_err());
        assert!(session.ptt_owned);
        drop(session);
        server.join().unwrap();
    }

    #[test]
    fn disconnect_keeps_session_when_owned_ptt_release_is_unverified() {
        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            for (command, response) in [
                ("+T 0\n", "set_ptt: 0\nRPRT 0\n"),
                ("+t\n", "get_ptt:\nPTT: 1\nRPRT 0\n"),
                ("+T 0\n", "set_ptt: 0\nRPRT 0\n"),
                ("+t\n", "get_ptt:\nPTT: 0\nRPRT 0\n"),
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line, command);
                socket.write_all(response.as_bytes()).unwrap();
            }
            let mut line = String::new();
            assert_eq!(reader.read_line(&mut line).unwrap(), 0);
        });
        let (reader, writer) = connect_stream(address).unwrap();
        let mut session = Session::new(reader, writer, None, "external", address.port(), None, true, 1);
        session.ptt_owned = true;
        let mut current = Some(session);
        let error = disconnect_session(&mut current, Device::Radio).unwrap_err();
        assert!(error.contains("PTT"));
        assert!(current.as_ref().unwrap().ptt_owned);
        let disconnected = disconnect_session(&mut current, Device::Radio).unwrap();
        assert_eq!(disconnected["disconnected"], true);
        assert!(current.is_none());
        server.join().unwrap();
    }
    #[test]
    fn model_parser_preserves_names_and_maturity() {
        let row = parse_model_line("  2045  Elecraft               KX3                     20250515.22     Stable      RIG_MODEL_KX3").unwrap();
        assert_eq!(row["id"], 2045);
        assert_eq!(row["model"], "KX3");
        assert_eq!(row["maturity"], "Stable");
    }
    #[test]
    fn external_mode_refuses_non_loopback() {
        assert!(loopback_address(&json!({"host":"8.8.8.8","port":4532})).is_err());
    }
    #[test]
    fn serial_options_are_closed_and_map_to_hamlib_tokens() {
        let config = serial_configuration(&json!({"serial":{
            "data_bits":7,"stop_bits":2,"parity":"Even","handshake":"Hardware",
            "dtr_state":"Unset","rts_state":"OFF"
        }}))
        .unwrap()
        .unwrap();
        assert!(config.contains("data_bits=7"));
        assert!(config.contains("stop_bits=2"));
        assert!(config.contains("serial_parity=Even"));
        assert!(config.contains("serial_handshake=Hardware"));
        assert!(config.contains("rts_state=OFF"));
        assert!(config.contains("dtr_state=Unset"));
        assert_eq!(
            serial_configuration(&json!({"serial":{"data_bits":0,"parity":""}})).unwrap(),
            None
        );
        for bad in [
            json!({"serial":{"data_bits":9}}),
            json!({"serial":{"parity":"NONE,ptt_type=DTR"}}),
            json!({"serial":{"unknown":"value"}}),
            json!({"serial":{"handshake":7}}),
        ] {
            assert!(serial_configuration(&bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn capability_parser_preserves_repeated_keys() {
        let caps = parse_capability_lines("Model name: Dummy\nMode: USB\nMode: CW\nno pair\n");
        assert_eq!(caps["Model name"], "Dummy");
        assert_eq!(caps["Mode"], json!(["USB", "CW"]));
    }
    #[test]
    fn invalid_reconnect_config_is_rejected_before_releasing_existing_session() {
        assert!(validate_connection_config(&json!({"mode":"managed","model":2})).is_err());
        assert!(validate_connection_config(
            &json!({"mode":"managed","model":1,"baud":"not a number"})
        )
        .is_err());
        assert!(validate_connection_config(
            &json!({"mode":"external","host":"8.8.8.8","port":4532})
        )
        .is_err());
        assert!(validate_connection_config(&json!({"mode":"managed","model":1})).is_ok());
    }
    #[test]
    fn status_retires_dead_external_session_without_any_control_replay() {
        let listener = TcpListener::bind((LOOPBACK, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line, "+f\n");
            socket
                .write_all(b"get_freq:\nFrequency: 14074000\nRPRT 0\n")
                .unwrap();
        });
        let (reader, writer) = connect_stream(address).unwrap();
        let mut session = Some(Session::new(
            reader,
            writer,
            None,
            "external",
            address.port(),
            None,
            false,
            991,
        ));
        let healthy = session_status(&mut session, Device::Radio);
        assert_eq!(healthy["connected"], true);
        server.join().unwrap();
        let lost = session_status(&mut session, Device::Radio);
        assert_eq!(lost["connected"], false);
        assert_eq!(lost["reconnect_required"], true);
        assert!(session.is_none());
    }
}
