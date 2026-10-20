//! One bounded multicast owner for the active Not1MM contest Group Chat.
//! This is operator text only: it never dispatches worker, CAT, PTT, CW or RF actions.
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_DATAGRAM_BYTES: usize = 2_048;
const MAX_MESSAGE_BYTES: usize = 512;
const MAX_SENDER_BYTES: usize = 32;
const MAX_HISTORY: usize = 200;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub enabled: bool,
    pub multicast_group: String,
    pub multicast_port: u16,
    pub interface: String,
    pub operator: String,
}

#[derive(Clone, Debug, Deserialize)]
struct WireChat {
    cmd: String,
    sender: String,
    message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub sequence: u64,
    pub sender: String,
    pub message: String,
    pub received_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: &'static str,
    pub error: Option<String>,
    pub enabled: bool,
    pub operator: String,
    pub multicast_group: String,
    pub multicast_port: u16,
    pub messages: Vec<Message>,
}

#[derive(Debug)]
struct SharedState {
    status: &'static str,
    error: Option<String>,
    next_sequence: u64,
    messages: VecDeque<Message>,
}

impl Default for SharedState {
    fn default() -> Self {
        Self {
            status: "disabled",
            error: None,
            next_sequence: 1,
            messages: VecDeque::new(),
        }
    }
}

struct Worker {
    socket: UdpSocket,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Owner {
    context: String,
    configuration: Configuration,
    state: Arc<Mutex<SharedState>>,
    worker: Option<Worker>,
}

#[derive(Default)]
pub struct GroupChat(Mutex<Option<Owner>>);

impl GroupChat {
    pub fn configure(
        &self,
        context: String,
        configuration: Configuration,
    ) -> Result<Snapshot, String> {
        validate_context(&context)?;
        validate_configuration(&configuration)?;
        let mut slot = self
            .0
            .lock()
            .map_err(|_| "Group Chat owner is unavailable.")?;
        if slot
            .as_ref()
            .is_some_and(|owner| owner.context == context && owner.configuration == configuration)
        {
            return snapshot(slot.as_ref().expect("matched owner"));
        }
        *slot = None; // Drop and join the previous socket owner before binding a replacement.
        let state = Arc::new(Mutex::new(SharedState::default()));
        let worker = if configuration.enabled {
            match start_worker(&configuration, state.clone()) {
                Ok(worker) => Some(worker),
                Err(error) => {
                    set_error(&state, error);
                    None
                }
            }
        } else {
            None
        };
        *slot = Some(Owner {
            context,
            configuration,
            state,
            worker,
        });
        snapshot(slot.as_ref().expect("installed owner"))
    }

    pub fn snapshot(&self, context: &str) -> Result<Snapshot, String> {
        let slot = self
            .0
            .lock()
            .map_err(|_| "Group Chat owner is unavailable.")?;
        let owner = slot
            .as_ref()
            .ok_or("Group Chat has not been configured for the active contest.")?;
        if owner.context != context {
            return Err("That Group Chat request belongs to an expired contest context.".into());
        }
        snapshot(owner)
    }

    pub fn send(&self, context: &str, message: &str) -> Result<(), String> {
        validate_text(message, MAX_MESSAGE_BYTES, "Chat message")?;
        let slot = self
            .0
            .lock()
            .map_err(|_| "Group Chat owner is unavailable.")?;
        let owner = slot
            .as_ref()
            .ok_or("Group Chat has not been configured for the active contest.")?;
        if owner.context != context {
            return Err("That Group Chat request belongs to an expired contest context.".into());
        }
        if !owner.configuration.enabled {
            return Err("Group networking is disabled in Contest Setup.".into());
        }
        let worker = owner.worker.as_ref().ok_or_else(|| {
            owner
                .state
                .lock()
                .ok()
                .and_then(|state| state.error.clone())
                .unwrap_or_else(|| "Group Chat is not connected.".into())
        })?;
        if owner
            .state
            .lock()
            .map_err(|_| "Group Chat state is unavailable.")?
            .status
            != "connected"
        {
            return Err("Group Chat is not connected.".into());
        }
        let packet = wire_packet(&owner.configuration.operator, message);
        if packet.len() > MAX_DATAGRAM_BYTES {
            return Err("Chat datagram is too large.".into());
        }
        let destination = SocketAddrV4::new(
            owner
                .configuration
                .multicast_group
                .parse()
                .map_err(|_| "Group multicast address is invalid.")?,
            owner.configuration.multicast_port,
        );
        worker
            .socket
            .send_to(&packet, destination)
            .map_err(|error| {
                let message = format!("Group Chat send failed: {error}");
                set_error(&owner.state, message.clone());
                message
            })?;
        Ok(())
    }

    pub fn shutdown(&self) {
        if let Ok(mut owner) = self.0.lock() {
            *owner = None;
        }
    }
}

fn validate_context(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 400 {
        Err("Group Chat context is invalid.".into())
    } else {
        Ok(())
    }
}
fn validate_text(value: &str, maximum: usize, name: &str) -> Result<(), String> {
    if value.as_bytes().len() > maximum || value.chars().any(|character| character == '\0') {
        Err(format!("{name} is invalid or too long."))
    } else {
        Ok(())
    }
}
fn validate_configuration(value: &Configuration) -> Result<(), String> {
    validate_text(&value.operator, MAX_SENDER_BYTES, "Operator")?;
    if value.enabled && value.operator.trim().is_empty() {
        return Err("Set the contest operator before enabling Group Chat.".into());
    }
    let group: Ipv4Addr = value
        .multicast_group
        .parse()
        .map_err(|_| "Group multicast address is invalid.")?;
    if !group.is_multicast() {
        return Err("Group Chat requires an IPv4 multicast address.".into());
    }
    let _: Ipv4Addr = value
        .interface
        .parse()
        .map_err(|_| "Group multicast interface is invalid.")?;
    if value.multicast_port == 0 {
        return Err("Group multicast port is invalid.".into());
    }
    Ok(())
}

fn start_worker(
    configuration: &Configuration,
    state: Arc<Mutex<SharedState>>,
) -> Result<Worker, String> {
    let group: Ipv4Addr = configuration
        .multicast_group
        .parse()
        .map_err(|_| "Group multicast address is invalid.")?;
    let interface: Ipv4Addr = configuration
        .interface
        .parse()
        .map_err(|_| "Group multicast interface is invalid.")?;
    let socket = UdpSocket::bind(SocketAddrV4::new(
        Ipv4Addr::UNSPECIFIED,
        configuration.multicast_port,
    ))
    .map_err(|error| {
        format!(
            "Group Chat could not bind UDP port {}: {error}",
            configuration.multicast_port
        )
    })?;
    socket
        .join_multicast_v4(&group, &interface)
        .map_err(|error| {
            format!(
                "Group Chat could not join {}: {error}",
                configuration.multicast_group
            )
        })?;
    socket
        .set_multicast_loop_v4(true)
        .map_err(|error| format!("Group Chat loopback could not be enabled: {error}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|error| format!("Group Chat receive timeout failed: {error}"))?;
    let receive = socket
        .try_clone()
        .map_err(|error| format!("Group Chat socket could not start: {error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let shared = state.clone();
    let thread = std::thread::Builder::new()
        .name("xlog-contest-group-chat".into())
        .spawn(move || {
            let mut datagram = [0_u8; MAX_DATAGRAM_BYTES + 1];
            while !stopped.load(Ordering::Acquire) {
                match receive.recv_from(&mut datagram) {
                    Ok((length, _)) if length <= MAX_DATAGRAM_BYTES => {
                        if let Ok(message) = parse_wire(&datagram[..length]) {
                            push_message(&shared, message);
                        }
                    }
                    Ok(_) => {}
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) => {}
                    Err(error) => {
                        set_error(&shared, format!("Group Chat receive failed: {error}"));
                        break;
                    }
                }
            }
        })
        .map_err(|error| format!("Group Chat receiver could not start: {error}"))?;
    if let Ok(mut current) = state.lock() {
        current.status = "connected";
        current.error = None;
    }
    Ok(Worker {
        socket,
        stop,
        thread: Some(thread),
    })
}

fn parse_wire(bytes: &[u8]) -> Result<WireChat, String> {
    if bytes.len() > MAX_DATAGRAM_BYTES || !bytes.is_ascii() {
        return Err("Chat datagram is not bounded ASCII JSON.".into());
    }
    let message: WireChat =
        serde_json::from_slice(bytes).map_err(|_| "Chat datagram is invalid JSON.")?;
    if message.cmd != "CHAT" {
        return Err("Datagram is not a chat message.".into());
    }
    validate_text(&message.sender, MAX_SENDER_BYTES, "Chat sender")?;
    validate_text(&message.message, MAX_MESSAGE_BYTES, "Chat message")?;
    Ok(message)
}

fn push_message(state: &Arc<Mutex<SharedState>>, wire: WireChat) {
    let Ok(mut state) = state.lock() else {
        return;
    };
    let sequence = state.next_sequence;
    state.next_sequence = state.next_sequence.saturating_add(1);
    state.messages.push_back(Message {
        sequence,
        sender: wire.sender,
        message: wire.message,
        received_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u64::MAX as u128) as u64,
    });
    while state.messages.len() > MAX_HISTORY {
        state.messages.pop_front();
    }
}
fn set_error(state: &Arc<Mutex<SharedState>>, error: String) {
    if let Ok(mut state) = state.lock() {
        state.status = "error";
        state.error = Some(error);
    }
}
fn snapshot(owner: &Owner) -> Result<Snapshot, String> {
    let state = owner
        .state
        .lock()
        .map_err(|_| "Group Chat state is unavailable.")?;
    Ok(Snapshot {
        status: state.status,
        error: state.error.clone(),
        enabled: owner.configuration.enabled,
        operator: owner.configuration.operator.clone(),
        multicast_group: owner.configuration.multicast_group.clone(),
        multicast_port: owner.configuration.multicast_port,
        messages: state.messages.iter().cloned().collect(),
    })
}

fn quoted_ascii(value: &str) -> String {
    let mut result = String::from("\"");
    for character in value.chars() {
        match character {
            '\"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\u{08}' => result.push_str("\\b"),
            '\u{0c}' => result.push_str("\\f"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            character if (' '..='~').contains(&character) => result.push(character),
            character => {
                for unit in character.encode_utf16(&mut [0; 2]) {
                    result.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    result.push('\"');
    result
}
fn wire_packet(sender: &str, message: &str) -> Vec<u8> {
    format!(
        "{{\"cmd\":\"CHAT\",\"sender\":{},\"message\":{}}}",
        quoted_ascii(sender),
        quoted_ascii(message)
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn configuration(enabled: bool) -> Configuration {
        Configuration {
            enabled,
            multicast_group: "239.1.1.1".into(),
            multicast_port: 2239,
            interface: "0.0.0.0".into(),
            operator: "OM0RX".into(),
        }
    }

    #[test]
    fn wire_is_ascii_json_and_round_trips_unicode() {
        let packet = wire_packet("OM0RX", "Ahoj Žluťoučký 👋");
        assert!(packet.is_ascii());
        let decoded = parse_wire(&packet).unwrap();
        assert_eq!(
            (
                decoded.cmd.as_str(),
                decoded.sender.as_str(),
                decoded.message.as_str()
            ),
            ("CHAT", "OM0RX", "Ahoj Žluťoučký 👋")
        );
    }

    #[test]
    fn rejects_unbounded_non_ascii_and_non_chat_datagrams() {
        assert!(
            parse_wire("{\"cmd\":\"CHAT\",\"sender\":\"OM0RX\",\"message\":\"č\"}".as_bytes())
                .is_err()
        );
        assert!(parse_wire(br#"{"cmd":"STATUS","sender":"OM0RX","message":"hi"}"#).is_err());
        assert!(parse_wire(&vec![b' '; MAX_DATAGRAM_BYTES + 1]).is_err());
        assert!(
            parse_wire(wire_packet("OM0RX", &"x".repeat(MAX_MESSAGE_BYTES + 1)).as_slice())
                .is_err()
        );
    }

    #[test]
    fn disabled_owner_never_binds_or_sends() {
        let chat = GroupChat::default();
        let snapshot = chat
            .configure("context/session/generation".into(), configuration(false))
            .unwrap();
        assert_eq!(snapshot.status, "disabled");
        assert!(chat
            .send("context/session/generation", "hello")
            .unwrap_err()
            .contains("disabled"));
    }

    #[test]
    fn history_is_bounded_and_keeps_arrival_order() {
        let state = Arc::new(Mutex::new(SharedState::default()));
        for index in 0..MAX_HISTORY + 3 {
            push_message(
                &state,
                WireChat {
                    cmd: "CHAT".into(),
                    sender: "N0CALL".into(),
                    message: index.to_string(),
                },
            );
        }
        let state = state.lock().unwrap();
        assert_eq!(state.messages.len(), MAX_HISTORY);
        assert_eq!(state.messages.front().unwrap().message, "3");
        assert_eq!(
            state.messages.back().unwrap().message,
            (MAX_HISTORY + 2).to_string()
        );
    }

    #[test]
    fn validates_multicast_settings_and_operator_only_when_enabled() {
        let mut value = configuration(true);
        value.multicast_group = "127.0.0.1".into();
        assert!(validate_configuration(&value).is_err());
        value.multicast_group = "239.1.1.1".into();
        value.operator.clear();
        assert!(validate_configuration(&value).is_err());
        value.enabled = false;
        assert!(validate_configuration(&value).is_ok());
    }
}
