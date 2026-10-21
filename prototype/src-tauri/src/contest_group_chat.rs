//! One bounded multicast owner for the active Not1MM contest Group Chat.
//! This is operator text only: it never dispatches worker, CAT, PTT, CW or RF actions.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, VecDeque};
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
const MAX_RECEIPTS: usize = 500;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub enabled: bool,
    pub multicast_group: String,
    pub multicast_port: u16,
    pub interface: String,
    pub operator: String,
    pub station_name: String,
}

#[derive(Clone, Debug, Deserialize)]
struct WireChat {
    #[allow(dead_code)]
    cmd: String,
    sender: String,
    message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireResponse {
    cmd: String,
    recipient: String,
    subject: String,
    unique_id: String,
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
    pub contact_receipts: Vec<String>,
    pub capabilities: Capabilities,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub chat: bool,
    pub contact_publication: bool,
    pub shared_serial: bool,
    pub duplicate_inquiry: bool,
    pub authority_limitation: &'static str,
}

#[derive(Debug)]
struct SharedState {
    status: &'static str,
    error: Option<String>,
    next_sequence: u64,
    messages: VecDeque<Message>,
    outstanding_contacts: BTreeSet<String>,
    contact_receipts: VecDeque<String>,
}

impl Default for SharedState {
    fn default() -> Self {
        Self {
            status: "disabled",
            error: None,
            next_sequence: 1,
            messages: VecDeque::new(),
            outstanding_contacts: BTreeSet::new(),
            contact_receipts: VecDeque::new(),
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

    pub fn publish_contact(&self, context: &str, contact: Value) -> Result<(), String> {
        let slot = self
            .0
            .lock()
            .map_err(|_| "Group network owner is unavailable.")?;
        let owner = slot
            .as_ref()
            .ok_or("Group network has not been configured for the active contest.")?;
        if owner.context != context {
            return Err("That contact publication belongs to an expired contest context.".into());
        }
        if !owner.configuration.enabled {
            return Err("Group networking is disabled in Contest Setup.".into());
        }
        let worker = owner
            .worker
            .as_ref()
            .ok_or("Group networking is not connected.")?;
        let (qso_id, packet) = post_packet(&owner.configuration, contact)?;
        {
            let mut state = owner
                .state
                .lock()
                .map_err(|_| "Group network state is unavailable.")?;
            state.outstanding_contacts.insert(qso_id.clone());
        }
        if let Err(error) = worker.socket.send_to(
            &packet,
            SocketAddrV4::new(
                owner
                    .configuration
                    .multicast_group
                    .parse()
                    .map_err(|_| "Group multicast address is invalid.")?,
                owner.configuration.multicast_port,
            ),
        ) {
            if let Ok(mut state) = owner.state.lock() {
                state.outstanding_contacts.remove(&qso_id);
            }
            return Err(format!("Contest contact publication failed: {error}"));
        }
        Ok(())
    }

    pub fn take_contact_receipts(&self, context: &str) -> Result<Vec<String>, String> {
        let slot = self
            .0
            .lock()
            .map_err(|_| "Group network owner is unavailable.")?;
        let owner = slot
            .as_ref()
            .ok_or("Group network has not been configured for the active contest.")?;
        if owner.context != context {
            return Err("Those contact receipts belong to an expired contest context.".into());
        }
        let mut state = owner
            .state
            .lock()
            .map_err(|_| "Group network state is unavailable.")?;
        Ok(state.contact_receipts.drain(..).collect())
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
    validate_text(&value.station_name, MAX_SENDER_BYTES, "Station name")?;
    if value.enabled && value.station_name.trim().is_empty() {
        return Err("Set a unique station name before enabling Group networking.".into());
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
    let receiver_configuration = configuration.clone();
    let thread = std::thread::Builder::new()
        .name("xlog-contest-group-chat".into())
        .spawn(move || {
            let mut datagram = [0_u8; MAX_DATAGRAM_BYTES + 1];
            while !stopped.load(Ordering::Acquire) {
                match receive.recv_from(&mut datagram) {
                    Ok((length, _)) if length <= MAX_DATAGRAM_BYTES => {
                        process_wire(&datagram[..length], &receiver_configuration, &shared);
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

#[cfg(test)]
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

fn process_wire(bytes: &[u8], configuration: &Configuration, state: &Arc<Mutex<SharedState>>) {
    if bytes.len() > MAX_DATAGRAM_BYTES || !bytes.is_ascii() {
        return;
    }
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return;
    };
    match value.get("cmd").and_then(Value::as_str) {
        Some("CHAT") => {
            if let Ok(message) = serde_json::from_value::<WireChat>(value) {
                if validate_text(&message.sender, MAX_SENDER_BYTES, "Chat sender").is_ok()
                    && validate_text(&message.message, MAX_MESSAGE_BYTES, "Chat message").is_ok()
                {
                    push_message(state, message);
                }
            }
        }
        Some("RESPONSE") => {
            let Ok(response) = serde_json::from_value::<WireResponse>(value) else {
                return;
            };
            if response.cmd != "RESPONSE"
                || response.subject != "POST"
                || response.recipient != configuration.station_name
            {
                return;
            }
            let Ok(mut current) = state.lock() else {
                return;
            };
            if current.outstanding_contacts.remove(&response.unique_id)
                && !current.contact_receipts.contains(&response.unique_id)
            {
                current.contact_receipts.push_back(response.unique_id);
                while current.contact_receipts.len() > MAX_RECEIPTS {
                    current.contact_receipts.pop_front();
                }
            }
        }
        _ => {}
    }
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
        contact_receipts: state.contact_receipts.iter().cloned().collect(),
        capabilities: Capabilities {
            chat: true,
            contact_publication: true,
            shared_serial: false,
            duplicate_inquiry: false,
            authority_limitation: "Pinned Renfield GET_SN and ISDUPE replies have no request identity; loss, retry or reordering cannot be correlated safely.",
        },
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

fn post_packet(configuration: &Configuration, contact: Value) -> Result<(String, Vec<u8>), String> {
    let mut object = contact
        .as_object()
        .cloned()
        .ok_or("Contest contact publication is invalid.")?;
    let qso_id = object
        .get("ID")
        .and_then(Value::as_str)
        .filter(|value| uuid::Uuid::parse_str(value).is_ok())
        .ok_or("Contest contact publication has no valid QSO identity.")?
        .to_owned();
    let contest = object
        .get("ContestName")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or("Contest contact publication has no contest identity.")?;
    if contest.chars().any(|character| character == '\0') {
        return Err("Contest contact publication has an invalid contest identity.".into());
    }
    object.insert("cmd".into(), Value::String("POST".into()));
    object.insert(
        "Operator".into(),
        Value::String(configuration.operator.clone()),
    );
    object.insert(
        "NetBiosName".into(),
        Value::String(configuration.station_name.clone()),
    );
    let packet = serde_json::to_vec(&object)
        .map_err(|_| "Contest contact publication could not be encoded.")?;
    if packet.len() > MAX_DATAGRAM_BYTES {
        return Err(
            "Contest contact publication exceeds the pinned Renfield datagram limit.".into(),
        );
    }
    Ok((qso_id, packet))
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
            station_name: "xlog-a".into(),
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
        assert_eq!(
            (value.multicast_group.as_str(), value.multicast_port),
            ("239.1.1.1", 2239)
        );
        value.multicast_group = "127.0.0.1".into();
        assert!(validate_configuration(&value).is_err());
        value.multicast_group = "239.1.1.1".into();
        value.operator.clear();
        assert!(validate_configuration(&value).is_err());
        value.enabled = false;
        assert!(validate_configuration(&value).is_ok());
    }

    #[test]
    fn accepts_only_group_chat_from_the_pinned_renfield_multicast_protocol() {
        assert!(
            parse_wire(br#"{"cmd":"GET_SN","Operator":"OM0RX","NetBiosName":"xlog"}"#).is_err()
        );
        assert!(parse_wire(br#"{"cmd":"ISDUPE","Call":"K1ABC","Band":14,"Mode":"CW"}"#).is_err());
        assert!(parse_wire(br#"{"cmd":"POST","ID":"one"}"#).is_err());
        assert!(parse_wire(br#"{"cmd":"CHAT","sender":"OM0RX","message":"Run is clear"}"#).is_ok());
    }

    #[test]
    fn pinned_serial_and_dupe_queries_are_explicitly_fail_closed() {
        let chat = GroupChat::default();
        let snapshot = chat
            .configure("context/session/generation".into(), configuration(false))
            .unwrap();
        assert!(!snapshot.capabilities.shared_serial);
        assert!(!snapshot.capabilities.duplicate_inquiry);
        assert!(snapshot
            .capabilities
            .authority_limitation
            .contains("no request identity"));
    }

    #[test]
    fn simultaneous_peer_serial_requests_never_create_local_authority() {
        let first = Arc::new(Mutex::new(SharedState::default()));
        let second = Arc::new(Mutex::new(SharedState::default()));
        let request_a = br#"{"cmd":"GET_SN","Operator":"OM0RX","NetBiosName":"xlog-a"}"#;
        let request_b = br#"{"cmd":"GET_SN","Operator":"VK6ABC","NetBiosName":"xlog-b"}"#;
        process_wire(request_a, &configuration(true), &first);
        process_wire(request_b, &configuration(true), &first);
        process_wire(request_a, &configuration(true), &second);
        process_wire(request_b, &configuration(true), &second);
        for state in [&first, &second] {
            let state = state.lock().unwrap();
            assert!(state.outstanding_contacts.is_empty());
            assert!(state.contact_receipts.is_empty());
            assert!(state.messages.is_empty());
        }
    }

    #[test]
    fn post_publication_uses_stable_uuid_and_pinned_recipient_fields() {
        let qso_id = "11111111-1111-4111-8111-111111111111";
        let (identity, packet) = post_packet(
            &configuration(true),
            serde_json::json!({"ID":qso_id,"ContestName":"CQ-WW-CW","Call":"K1ABC","Dirty":1}),
        )
        .unwrap();
        assert_eq!(identity, qso_id);
        let value: Value = serde_json::from_slice(&packet).unwrap();
        assert_eq!(value["cmd"], "POST");
        assert_eq!(value["Operator"], "OM0RX");
        assert_eq!(value["NetBiosName"], "xlog-a");
    }

    #[test]
    fn two_peers_accept_only_their_outstanding_receipts_under_loss_and_reordering() {
        let first = Arc::new(Mutex::new(SharedState::default()));
        let second = Arc::new(Mutex::new(SharedState::default()));
        let one = "11111111-1111-4111-8111-111111111111";
        let two = "22222222-2222-4222-8222-222222222222";
        first
            .lock()
            .unwrap()
            .outstanding_contacts
            .extend([one.into(), two.into()]);
        second
            .lock()
            .unwrap()
            .outstanding_contacts
            .insert(two.into());
        let first_configuration = configuration(true);
        let mut second_configuration = configuration(true);
        second_configuration.station_name = "xlog-b".into();

        let response = |recipient: &str, id: &str| {
            serde_json::to_vec(&serde_json::json!({
                "cmd":"RESPONSE","recipient":recipient,"subject":"POST","unique_id":id
            }))
            .unwrap()
        };
        // The first response is lost. A later receipt arrives out of order, and
        // multicast delivers it to both simulated peers.
        let two_for_first = response("xlog-a", two);
        process_wire(&two_for_first, &first_configuration, &first);
        process_wire(&two_for_first, &second_configuration, &second);
        process_wire(&response("xlog-a", one), &first_configuration, &first);
        process_wire(&two_for_first, &first_configuration, &first); // duplicate frame
        assert_eq!(
            first
                .lock()
                .unwrap()
                .contact_receipts
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            [two, one]
        );
        assert!(second.lock().unwrap().contact_receipts.is_empty());

        process_wire(&response("xlog-b", two), &second_configuration, &second);
        assert_eq!(
            second
                .lock()
                .unwrap()
                .contact_receipts
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            [two]
        );
    }

    #[test]
    fn restart_and_stale_or_foreign_frames_cannot_retire_a_new_session_contact() {
        let qso_id = "11111111-1111-4111-8111-111111111111";
        let restarted = Arc::new(Mutex::new(SharedState::default()));
        let packet = serde_json::to_vec(&serde_json::json!({
            "cmd":"RESPONSE","recipient":"xlog-a","subject":"POST","unique_id":qso_id
        }))
        .unwrap();
        process_wire(&packet, &configuration(true), &restarted);
        assert!(restarted.lock().unwrap().contact_receipts.is_empty());
        restarted
            .lock()
            .unwrap()
            .outstanding_contacts
            .insert(qso_id.into());
        process_wire(
            &serde_json::to_vec(&serde_json::json!({
                "cmd":"RESPONSE","recipient":"foreign","subject":"POST","unique_id":qso_id
            }))
            .unwrap(),
            &configuration(true),
            &restarted,
        );
        assert!(restarted.lock().unwrap().contact_receipts.is_empty());
    }
}
