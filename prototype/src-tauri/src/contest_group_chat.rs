//! One bounded multicast owner for active Not1MM chat and first-party authority.
//! Authority dispatch is limited to four contest worker methods; never CAT, PTT, CW or RF actions.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_DATAGRAM_BYTES: usize = 2_048;
const MAX_AUTHORITY_DATAGRAM_BYTES: usize = 60_000;
const MAX_MESSAGE_BYTES: usize = 512;
const MAX_SENDER_BYTES: usize = 32;
const MAX_CONTEST_IDENTITY_BYTES: usize = 128;
const MAX_HISTORY: usize = 200;
const MAX_ACKNOWLEDGEMENTS: usize = 500;
const MAX_AUTHORITY_REPLAY: usize = 500;
const AUTHORITY_PROTOCOL: &str = "xlog-contest-authority-v1";
const AUTHORITY_LEASE_MS: u64 = 3_000;
const AUTHORITY_REQUEST_TIMEOUT_MS: u64 = 1_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub enabled: bool,
    pub multicast_group: String,
    pub multicast_port: u16,
    pub interface: String,
    pub operator: String,
    pub station_name: String,
    pub multi_master: bool,
    pub contest_identity: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthorityOperation {
    SerialReserve,
    DupeInquiry,
    ContactApply,
    Changes,
    Coordination,
}

impl AuthorityOperation {
    fn worker_method(self) -> &'static str {
        match self {
            Self::SerialReserve => "contest_multi_serial_reserve",
            Self::DupeInquiry => "contest_multi_dupe_inquiry",
            Self::ContactApply => "contest_multi_contact_apply",
            Self::Changes => "contest_multi_changes",
            Self::Coordination => "contest_multi_coordination",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityRequest {
    pub request_id: String,
    pub operation: AuthorityOperation,
    pub params: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritySnapshot {
    pub role: &'static str,
    pub status: &'static str,
    pub master_station: Option<String>,
    #[serde(rename="sessionID")]
    pub session_id: Option<String>,
    pub workspace_generation: Option<String>,
    pub lease_expires_at_ms: Option<u64>,
    pub reconnect_cursor: u64,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireAuthorityLease {
    protocol: String,
    kind: String,
    station_id: String,
    contest_identity: String,
    session_id: String,
    workspace_generation: String,
    lease_id: String,
    lease_token: String,
    expires_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireAuthorityRequest {
    protocol: String,
    kind: String,
    station_id: String,
    recipient_station_id: String,
    contest_identity: String,
    session_id: String,
    workspace_generation: String,
    lease_id: String,
    request_id: String,
    operation: AuthorityOperation,
    params: Value,
    auth_tag: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireAuthorityReply {
    protocol: String,
    kind: String,
    station_id: String,
    recipient_station_id: String,
    contest_identity: String,
    session_id: String,
    workspace_generation: String,
    lease_id: String,
    request_id: String,
    response: Value,
    reconnect_cursor: u64,
    auth_tag: String,
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
    pub unverified_transport_acknowledgements: Vec<String>,
    pub capabilities: Capabilities,
    pub authority: AuthoritySnapshot,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub chat: bool,
    pub contact_publication: bool,
    pub remote_persistence_verified: bool,
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
    unverified_transport_acknowledgements: VecDeque<String>,
    authority: AuthorityState,
}

#[derive(Clone, Debug)]
struct ContextIdentity {
    session_id: String,
    workspace_generation: String,
}

#[derive(Clone, Debug)]
struct Lease {
    station_id: String,
    contest_identity: String,
    session_id: String,
    workspace_generation: String,
    lease_id: String,
    token: String,
    expires_at_ms: u64,
}

#[derive(Debug)]
struct PendingAuthorityRequest {
    digest: String,
    packet: Vec<u8>,
    operation: AuthorityOperation,
}

#[derive(Debug)]
struct AuthorityState {
    identity: ContextIdentity,
    role: &'static str,
    status: &'static str,
    lease: Option<Lease>,
    pending: BTreeMap<String, PendingAuthorityRequest>,
    replies: BTreeMap<String, (String, Value)>,
    reply_order: VecDeque<String>,
    replay: BTreeMap<String, (String, Vec<u8>)>,
    replay_order: VecDeque<String>,
    reconnect_cursor: u64,
    remote_persistence_verified: bool,
}

impl AuthorityState {
    fn new(identity: ContextIdentity, configuration: &Configuration) -> Self {
        let (role, status, lease) = if !configuration.enabled {
            ("disabled", "disabled", None)
        } else if configuration.multi_master {
            let now = now_ms();
            (
                "master",
                "leasing",
                Some(Lease {
                    station_id: configuration.station_name.clone(),
                    contest_identity: configuration.contest_identity.clone(),
                    session_id: identity.session_id.clone(),
                    workspace_generation: identity.workspace_generation.clone(),
                    lease_id: uuid::Uuid::new_v4().to_string(),
                    token: uuid::Uuid::new_v4().to_string(),
                    expires_at_ms: now.saturating_add(AUTHORITY_LEASE_MS),
                }),
            )
        } else {
            ("client", "discovering", None)
        };
        Self {
            identity,
            role,
            status,
            lease,
            pending: BTreeMap::new(),
            replies: BTreeMap::new(),
            reply_order: VecDeque::new(),
            replay: BTreeMap::new(),
            replay_order: VecDeque::new(),
            reconnect_cursor: 0,
            remote_persistence_verified: false,
        }
    }
}

impl Default for SharedState {
    fn default() -> Self {
        Self {
            status: "disabled",
            error: None,
            next_sequence: 1,
            messages: VecDeque::new(),
            outstanding_contacts: BTreeSet::new(),
            unverified_transport_acknowledgements: VecDeque::new(),
            authority: AuthorityState {
                identity: ContextIdentity {
                    session_id: String::new(),
                    workspace_generation: String::new(),
                },
                role: "disabled",
                status: "disabled",
                lease: None,
                pending: BTreeMap::new(),
                replies: BTreeMap::new(),
                reply_order: VecDeque::new(),
                replay: BTreeMap::new(),
                replay_order: VecDeque::new(),
                reconnect_cursor: 0,
                remote_persistence_verified: false,
            },
        }
    }
}

impl SharedState {
    fn for_owner(identity: ContextIdentity, configuration: &Configuration) -> Self {
        Self {
            authority: AuthorityState::new(identity, configuration),
            ..Self::default()
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
        let identity = parse_context(&context)?;
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
        if let Some(current) = slot.as_ref() {
            revoke_authority(&current.state);
        }
        *slot = None; // Drop and join the previous socket owner before binding a replacement.
        let state = Arc::new(Mutex::new(SharedState::for_owner(identity, &configuration)));
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

    pub fn take_unverified_transport_acknowledgements(
        &self,
        context: &str,
    ) -> Result<Vec<String>, String> {
        let slot = self
            .0
            .lock()
            .map_err(|_| "Group network owner is unavailable.")?;
        let owner = slot
            .as_ref()
            .ok_or("Group network has not been configured for the active contest.")?;
        if owner.context != context {
            return Err(
                "Those transport acknowledgements belong to an expired contest context.".into(),
            );
        }
        let mut state = owner
            .state
            .lock()
            .map_err(|_| "Group network state is unavailable.")?;
        Ok(state
            .unverified_transport_acknowledgements
            .drain(..)
            .collect())
    }

    pub fn authority_request(
        &self,
        context: &str,
        mut request: AuthorityRequest,
    ) -> Result<Value, String> {
        validate_request_id(&request.request_id)?;
        if !request.params.is_object() {
            return Err("The authority request parameters are invalid.".into());
        }
        if request.operation == AuthorityOperation::Coordination {
            let slot = self.0.lock().map_err(|_| "Group network owner unavailable")?;
            let owner = slot.as_ref().ok_or("Group network unavailable")?;
            if owner.context != context { return Err("Expired group context".into()); }
            if request.params.get("senderStation").is_some() { return Err("The native owner supplies station identity".into()); }
            request.params.as_object_mut().unwrap().insert("senderStation".into(), Value::String(owner.configuration.station_name.clone()));
        }
        let digest = authority_request_digest(&request)?;
        let (state, socket, destination, packet, direct) = {
            let slot = self
                .0
                .lock()
                .map_err(|_| "Group network owner is unavailable.")?;
            let owner = slot
                .as_ref()
                .ok_or("Group network has not been configured for the active contest.")?;
            if owner.context != context {
                return Err("That authority request belongs to an expired contest context.".into());
            }
            if !owner.configuration.enabled {
                return Err("Group networking is disabled in Contest Setup.".into());
            }
            let worker = owner
                .worker
                .as_ref()
                .ok_or("Group networking is not connected.")?;
            let mut current = owner
                .state
                .lock()
                .map_err(|_| "Group network state is unavailable.")?;
            expire_authority_lease(&mut current.authority);
            if current.authority.status == "revoked" || current.authority.status == "lease_lost" {
                return Err(
                    "The group authority lease is unavailable; retry after reconnect.".into(),
                );
            }
            if let Some((previous, reply)) = current.authority.replies.get(&request.request_id) {
                if previous != &digest {
                    return Err(
                        "That authority request identity was reused with different parameters."
                            .into(),
                    );
                }
                return Ok(reply.clone());
            }
            if current.authority.role == "master" {
                (
                    owner.state.clone(),
                    worker
                        .socket
                        .try_clone()
                        .map_err(|_| "Group network socket is unavailable.")?,
                    SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0),
                    Vec::new(),
                    true,
                )
            } else {
                let lease = current
                    .authority
                    .lease
                    .clone()
                    .ok_or("No authoritative master lease is available yet.")?;
                let packet =
                    if let Some(previous) = current.authority.pending.get(&request.request_id) {
                        if previous.digest != digest {
                            return Err(
                            "That authority request identity was reused with different parameters."
                                .into(),
                        );
                        }
                        previous.packet.clone()
                    } else {
                        let packet = authority_request_packet(
                            &owner.configuration.station_name,
                            &lease,
                            &request,
                        )?;
                        current.authority.pending.insert(
                            request.request_id.clone(),
                            PendingAuthorityRequest {
                                digest: digest.clone(),
                                packet: packet.clone(),
                                operation: request.operation,
                            },
                        );
                        packet
                    };
                let group = owner
                    .configuration
                    .multicast_group
                    .parse()
                    .map_err(|_| "Group multicast address is invalid.")?;
                (
                    owner.state.clone(),
                    worker
                        .socket
                        .try_clone()
                        .map_err(|_| "Group network socket is unavailable.")?,
                    SocketAddrV4::new(group, owner.configuration.multicast_port),
                    packet,
                    false,
                )
            }
        };
        if direct {
            let reply = forward_authority_request(&state, &request)?;
            record_authority_reply(
                &state,
                &request.request_id,
                digest,
                request.operation,
                reply.clone(),
            );
            return Ok(reply);
        }
        socket
            .send_to(&packet, destination)
            .map_err(|error| format!("Authority request send failed: {error}"))?;
        let deadline = now_ms().saturating_add(AUTHORITY_REQUEST_TIMEOUT_MS);
        while now_ms() <= deadline {
            {
                let current = state
                    .lock()
                    .map_err(|_| "Group network state is unavailable.")?;
                if current.authority.status == "revoked" || current.authority.status == "lease_lost"
                {
                    return Err("The group authority lease was lost; retry after reconnect.".into());
                }
                if let Some((previous, reply)) = current.authority.replies.get(&request.request_id)
                {
                    if previous == &digest {
                        return Ok(reply.clone());
                    }
                    return Err(
                        "That authority request identity was reused with different parameters."
                            .into(),
                    );
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Err("The authoritative station did not reply; retry the same request identity.".into())
    }

    pub fn shutdown(&self) {
        if let Ok(mut owner) = self.0.lock() {
            if let Some(current) = owner.as_ref() {
                revoke_authority(&current.state);
            }
            *owner = None;
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn parse_context(value: &str) -> Result<ContextIdentity, String> {
    if value.is_empty() || value.len() > 400 {
        return Err("Group Chat context is invalid.".into());
    }
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| uuid::Uuid::parse_str(part).is_err())
    {
        return Err("Group Chat context identities are invalid.".into());
    }
    Ok(ContextIdentity {
        session_id: parts[1].into(),
        workspace_generation: parts[2].into(),
    })
}

fn validate_request_id(value: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(value).is_err() {
        Err("The authority request identity is invalid.".into())
    } else {
        Ok(())
    }
}

fn digest_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn authority_request_digest(request: &AuthorityRequest) -> Result<String, String> {
    serde_json::to_vec(&(request.operation, &request.params))
        .map(|bytes| digest_bytes(&bytes))
        .map_err(|_| "The authority request could not be encoded.".into())
}

fn lease_auth_tag(token: &str, material: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(token.as_bytes());
    digest.update(Sha256::digest(material));
    digest.update(token.as_bytes());
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn request_auth_material(frame: &WireAuthorityRequest) -> Vec<u8> {
    serde_json::to_vec(&(
        frame.protocol.as_str(),
        frame.kind.as_str(),
        frame.station_id.as_str(),
        frame.recipient_station_id.as_str(),
        frame.contest_identity.as_str(),
        frame.session_id.as_str(),
        frame.workspace_generation.as_str(),
        frame.lease_id.as_str(),
        frame.request_id.as_str(),
        frame.operation,
        &frame.params,
    ))
    .unwrap_or_default()
}

fn reply_auth_material(frame: &WireAuthorityReply) -> Vec<u8> {
    serde_json::to_vec(&(
        frame.protocol.as_str(),
        frame.kind.as_str(),
        frame.station_id.as_str(),
        frame.recipient_station_id.as_str(),
        frame.contest_identity.as_str(),
        frame.session_id.as_str(),
        frame.workspace_generation.as_str(),
        frame.lease_id.as_str(),
        frame.request_id.as_str(),
        &frame.response,
        frame.reconnect_cursor,
    ))
    .unwrap_or_default()
}

fn authority_request_packet(
    station_id: &str,
    lease: &Lease,
    request: &AuthorityRequest,
) -> Result<Vec<u8>, String> {
    let mut frame = WireAuthorityRequest {
        protocol: AUTHORITY_PROTOCOL.into(),
        kind: "request".into(),
        station_id: station_id.into(),
        recipient_station_id: lease.station_id.clone(),
        contest_identity: lease.contest_identity.clone(),
        session_id: lease.session_id.clone(),
        workspace_generation: lease.workspace_generation.clone(),
        lease_id: lease.lease_id.clone(),
        request_id: request.request_id.clone(),
        operation: request.operation,
        params: request.params.clone(),
        auth_tag: String::new(),
    };
    frame.auth_tag = lease_auth_tag(&lease.token, &request_auth_material(&frame));
    let packet =
        serde_json::to_vec(&frame).map_err(|_| "The authority request could not be encoded.")?;
    if packet.len() > MAX_AUTHORITY_DATAGRAM_BYTES {
        return Err("The authority request exceeds the bounded datagram limit.".into());
    }
    Ok(packet)
}

fn authority_reply_packet(
    station_id: &str,
    recipient: &str,
    lease: &Lease,
    request_id: &str,
    response: Value,
    reconnect_cursor: u64,
) -> Result<Vec<u8>, String> {
    let mut frame = WireAuthorityReply {
        protocol: AUTHORITY_PROTOCOL.into(),
        kind: "reply".into(),
        station_id: station_id.into(),
        recipient_station_id: recipient.into(),
        contest_identity: lease.contest_identity.clone(),
        session_id: lease.session_id.clone(),
        workspace_generation: lease.workspace_generation.clone(),
        lease_id: lease.lease_id.clone(),
        request_id: request_id.into(),
        response,
        reconnect_cursor,
        auth_tag: String::new(),
    };
    frame.auth_tag = lease_auth_tag(&lease.token, &reply_auth_material(&frame));
    let packet =
        serde_json::to_vec(&frame).map_err(|_| "The authority reply could not be encoded.")?;
    if packet.len() > MAX_AUTHORITY_DATAGRAM_BYTES {
        return Err("The authority reply exceeds the bounded datagram limit.".into());
    }
    Ok(packet)
}

fn refresh_lease_packet(state: &Arc<Mutex<SharedState>>) -> Option<Vec<u8>> {
    let mut current = state.lock().ok()?;
    if current.authority.role != "master" || current.authority.status == "revoked" {
        return None;
    }
    current.authority.status = "connected";
    let lease = current.authority.lease.as_mut()?;
    lease.expires_at_ms = now_ms().saturating_add(AUTHORITY_LEASE_MS);
    serde_json::to_vec(&WireAuthorityLease {
        protocol: AUTHORITY_PROTOCOL.into(),
        kind: "lease".into(),
        station_id: lease.station_id.clone(),
        contest_identity: lease.contest_identity.clone(),
        session_id: lease.session_id.clone(),
        workspace_generation: lease.workspace_generation.clone(),
        lease_id: lease.lease_id.clone(),
        lease_token: lease.token.clone(),
        expires_at_ms: lease.expires_at_ms,
    })
    .ok()
}

fn expire_authority_lease(authority: &mut AuthorityState) {
    if authority.role == "client"
        && authority
            .lease
            .as_ref()
            .is_some_and(|lease| lease.expires_at_ms <= now_ms())
    {
        authority.lease = None;
        authority.pending.clear();
        authority.status = "lease_lost";
        authority.remote_persistence_verified = false;
    }
}

fn revoke_authority(state: &Arc<Mutex<SharedState>>) {
    if let Ok(mut current) = state.lock() {
        current.authority.lease = None;
        current.authority.pending.clear();
        current.authority.status = "revoked";
        current.authority.remote_persistence_verified = false;
    }
}

fn response_proves_remote_persistence(operation: AuthorityOperation, response: &Value) -> bool {
    operation == AuthorityOperation::ContactApply
        && response.get("ok").and_then(Value::as_bool) == Some(true)
}

fn record_authority_reply(
    state: &Arc<Mutex<SharedState>>,
    request_id: &str,
    digest: String,
    operation: AuthorityOperation,
    reply: Value,
) {
    let Ok(mut current) = state.lock() else {
        return;
    };
    if response_proves_remote_persistence(operation, &reply) {
        current.authority.remote_persistence_verified = true;
    }
    current
        .authority
        .replies
        .insert(request_id.into(), (digest, reply));
    current.authority.reply_order.push_back(request_id.into());
    while current.authority.reply_order.len() > MAX_AUTHORITY_REPLAY {
        if let Some(expired) = current.authority.reply_order.pop_front() {
            current.authority.replies.remove(&expired);
        }
    }
}

fn forward_authority_request(
    state: &Arc<Mutex<SharedState>>,
    request: &AuthorityRequest,
) -> Result<Value, String> {
    let (session_id, workspace_generation) = {
        let current = state
            .lock()
            .map_err(|_| "Group authority state is unavailable.")?;
        if current.authority.role != "master" || current.authority.status == "revoked" {
            return Err("This station does not hold the group authority lease.".into());
        }
        (
            current.authority.identity.session_id.clone(),
            current.authority.identity.workspace_generation.clone(),
        )
    };
    let mut params = request
        .params
        .as_object()
        .cloned()
        .ok_or("The authority request parameters are invalid.")?;
    params.insert("sessionID".into(), Value::String(session_id));
    params.insert(
        "workspaceGeneration".into(),
        Value::String(workspace_generation),
    );
    params.insert(
        "requestID".into(),
        Value::String(request.request_id.clone()),
    );
    let response = crate::worker::request_existing(serde_json::json!({
        "id": request.request_id, "method": request.operation.worker_method(), "params": params,
    }))?;
    if let Ok(mut current) = state.lock() {
        let result = &response["result"];
        let cursor = result["currentRevision"]
            .as_u64()
            .or_else(|| result["nextRevision"].as_u64())
            .or_else(|| result["revision"].as_u64());
        if let Some(cursor) = cursor {
            current.authority.reconnect_cursor = current.authority.reconnect_cursor.max(cursor);
        }
    }
    Ok(response)
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
    validate_text(
        &value.contest_identity,
        MAX_CONTEST_IDENTITY_BYTES,
        "Contest identity",
    )?;
    if value.enabled && value.contest_identity.trim().is_empty() {
        return Err("A contest identity is required before enabling Group networking.".into());
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

#[cfg(unix)]
fn bind_group_socket(interface:Ipv4Addr,port:u16)->Result<UdpSocket,String>{
    use std::os::fd::{FromRawFd,AsRawFd};
    let fd=unsafe{libc::socket(libc::AF_INET,libc::SOCK_DGRAM,0)};
    if fd<0{return Err(std::io::Error::last_os_error().to_string());}
    let socket=unsafe{UdpSocket::from_raw_fd(fd)};
    let reuse:libc::c_int=1;
    for option in [libc::SO_REUSEADDR,libc::SO_REUSEPORT]{
        if unsafe{libc::setsockopt(socket.as_raw_fd(),libc::SOL_SOCKET,option,&reuse as *const _ as *const _,std::mem::size_of_val(&reuse) as _)}!=0{return Err(std::io::Error::last_os_error().to_string());}
    }
    let mut address:libc::sockaddr_in=unsafe{std::mem::zeroed()};address.sin_family=libc::AF_INET as _;address.sin_port=port.to_be();
    #[cfg(target_os="macos")] {address.sin_len=std::mem::size_of_val(&address) as _;}
    if unsafe{libc::bind(socket.as_raw_fd(),&address as *const _ as *const _,std::mem::size_of_val(&address) as _)}!=0{return Err(std::io::Error::last_os_error().to_string());}
    if !interface.is_unspecified(){
        let outbound=libc::in_addr{s_addr:u32::from_ne_bytes(interface.octets())};
        if unsafe{libc::setsockopt(socket.as_raw_fd(),libc::IPPROTO_IP,libc::IP_MULTICAST_IF,&outbound as *const _ as *const _,std::mem::size_of_val(&outbound) as _)}!=0{return Err(std::io::Error::last_os_error().to_string());}
    }
    Ok(socket)
}
#[cfg(not(unix))]
fn bind_group_socket(interface:Ipv4Addr,port:u16)->Result<UdpSocket,String>{
    if !interface.is_unspecified(){return Err("Explicit outgoing multicast interfaces remain unqualified on this platform.".into());}
    UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED,port)).map_err(|e|e.to_string())
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
    let socket = bind_group_socket(interface,configuration.multicast_port)
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
    let destination = SocketAddrV4::new(group, configuration.multicast_port);
    let thread = std::thread::Builder::new()
        .name("xlog-contest-group-chat".into())
        .spawn(move || {
            let mut datagram = [0_u8; MAX_AUTHORITY_DATAGRAM_BYTES + 1];
            let mut last_lease_at_ms = 0;
            while !stopped.load(Ordering::Acquire) {
                let now = now_ms();
                if receiver_configuration.multi_master
                    && now.saturating_sub(last_lease_at_ms) >= 1_000
                {
                    if let Some(packet) = refresh_lease_packet(&shared) {
                        let _ = receive.send_to(&packet, destination);
                    }
                    last_lease_at_ms = now;
                } else if let Ok(mut current) = shared.lock() {
                    expire_authority_lease(&mut current.authority);
                }
                match receive.recv_from(&mut datagram) {
                    Ok((length, source)) if length <= MAX_AUTHORITY_DATAGRAM_BYTES => {
                        if interface.is_loopback() && !source.ip().is_loopback(){continue;}
                        if let Some(reply) = process_authority_wire(
                            &datagram[..length],
                            &receiver_configuration,
                            &shared,
                            |request| forward_authority_request(&shared, request),
                        ) {
                            let _ = receive.send_to(&reply, destination);
                        } else {
                            process_wire(&datagram[..length], &receiver_configuration, &shared);
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

fn process_authority_wire<F>(
    bytes: &[u8],
    configuration: &Configuration,
    state: &Arc<Mutex<SharedState>>,
    dispatch: F,
) -> Option<Vec<u8>>
where
    F: FnOnce(&AuthorityRequest) -> Result<Value, String>,
{
    if bytes.len() > MAX_AUTHORITY_DATAGRAM_BYTES {
        return None;
    }
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    if value.get("protocol").and_then(Value::as_str) != Some(AUTHORITY_PROTOCOL) {
        return None;
    }
    match value.get("kind").and_then(Value::as_str)? {
        "lease" => {
            let frame = serde_json::from_value::<WireAuthorityLease>(value).ok()?;
            if frame.protocol != AUTHORITY_PROTOCOL
                || frame.kind != "lease"
                || frame.expires_at_ms <= now_ms()
                || uuid::Uuid::parse_str(&frame.session_id).is_err()
                || uuid::Uuid::parse_str(&frame.workspace_generation).is_err()
                || uuid::Uuid::parse_str(&frame.lease_id).is_err()
                || uuid::Uuid::parse_str(&frame.lease_token).is_err()
                || validate_text(&frame.station_id, MAX_SENDER_BYTES, "Authority station").is_err()
                || validate_text(
                    &frame.contest_identity,
                    MAX_CONTEST_IDENTITY_BYTES,
                    "Contest identity",
                )
                .is_err()
                || frame.contest_identity != configuration.contest_identity
            {
                return None;
            }
            let mut current = state.lock().ok()?;
            if current.authority.role == "master" {
                if frame.station_id != configuration.station_name {
                    current.authority.status = "lease_conflict";
                    current.authority.lease = None;
                    current.authority.remote_persistence_verified = false;
                }
                return None;
            }
            if current.authority.role != "client" {
                return None;
            }
            if current.authority.status == "lease_conflict" {
                return None;
            }
            if current.authority.lease.as_ref().is_some_and(|lease| {
                lease.expires_at_ms > now_ms()
                    && (lease.station_id != frame.station_id
                        || lease.session_id != frame.session_id
                        || lease.workspace_generation != frame.workspace_generation)
            }) {
                current.authority.status = "lease_conflict";
                current.authority.lease = None;
                current.authority.pending.clear();
                current.authority.remote_persistence_verified = false;
                return None;
            }
            if current.authority.lease.as_ref().is_some_and(|lease| {
                lease.expires_at_ms > now_ms()
                    && lease.lease_id != frame.lease_id
                    && frame.expires_at_ms <= lease.expires_at_ms
            }) {
                // A delayed lease from the previous process must not roll a
                // client back after it adopted a newer same-master lease.
                return None;
            }
            if current.authority.lease.as_ref().is_some_and(|lease| {
                lease.expires_at_ms <= now_ms()
                    || lease.station_id != frame.station_id
                    || lease.lease_id != frame.lease_id
                    || lease.session_id != frame.session_id
                    || lease.workspace_generation != frame.workspace_generation
            }) {
                current.authority.pending.clear();
                current.authority.replies.clear();
                current.authority.reply_order.clear();
                current.authority.remote_persistence_verified = false;
                current.authority.status = "leasing";
            }
            current.authority.lease = Some(Lease {
                station_id: frame.station_id,
                contest_identity: frame.contest_identity,
                session_id: frame.session_id,
                workspace_generation: frame.workspace_generation,
                lease_id: frame.lease_id,
                token: frame.lease_token,
                expires_at_ms: frame.expires_at_ms,
            });
            if current.authority.status != "connected" {
                current.authority.status = "leasing";
            }
            None
        }
        "request" => {
            let frame = serde_json::from_value::<WireAuthorityRequest>(value).ok()?;
            let (lease, identity, replay) = {
                let current = state.lock().ok()?;
                if current.authority.role != "master" || current.authority.status == "revoked" {
                    return None;
                }
                let lease = current.authority.lease.clone()?;
                (
                    lease,
                    current.authority.identity.clone(),
                    current.authority.replay.get(&frame.request_id).cloned(),
                )
            };
            if frame.protocol != AUTHORITY_PROTOCOL
                || frame.kind != "request"
                || frame.recipient_station_id != configuration.station_name
                || frame.contest_identity != configuration.contest_identity
                || frame.contest_identity != lease.contest_identity
                || frame.session_id != identity.session_id
                || frame.workspace_generation != identity.workspace_generation
                || frame.lease_id != lease.lease_id
                || lease.expires_at_ms <= now_ms()
                || validate_request_id(&frame.request_id).is_err()
                || validate_text(&frame.station_id, MAX_SENDER_BYTES, "Authority station").is_err()
                || frame.params.as_object().is_none()
                || frame.operation == AuthorityOperation::Coordination && frame.params["senderStation"] != frame.station_id
                || frame.auth_tag != lease_auth_tag(&lease.token, &request_auth_material(&frame))
            {
                return None;
            }
            let request = AuthorityRequest {
                request_id: frame.request_id.clone(),
                operation: frame.operation,
                params: frame.params.clone(),
            };
            let digest = authority_request_digest(&request).ok()?;
            if let Some((previous, packet)) = replay {
                if previous == digest {
                    return Some(packet);
                }
                let response = serde_json::json!({"id":request.request_id,"ok":false,"error":{
                    "code":"payload_conflict","message":"That request identity was already used with different parameters.","outcome":"confirmed"}});
                return authority_reply_packet(
                    &configuration.station_name,
                    &frame.station_id,
                    &lease,
                    &request.request_id,
                    response,
                    state.lock().ok()?.authority.reconnect_cursor,
                )
                .ok();
            }
            let response = dispatch(&request).unwrap_or_else(|message| serde_json::json!({"id":request.request_id,
                "ok":false,"error":{"code":"authority_unavailable","message":message,"outcome":"uncertain"}}));
            if response_proves_remote_persistence(request.operation, &response) {
                if let Ok(mut current) = state.lock() {
                    current.authority.remote_persistence_verified = true;
                }
            }
            if let Some(cursor) = response["result"]["currentRevision"]
                .as_u64()
                .or_else(|| response["result"]["nextRevision"].as_u64())
                .or_else(|| response["result"]["revision"].as_u64())
            {
                if let Ok(mut current) = state.lock() {
                    current.authority.reconnect_cursor =
                        current.authority.reconnect_cursor.max(cursor);
                }
            }
            let cursor = state.lock().ok()?.authority.reconnect_cursor;
            let packet = authority_reply_packet(
                &configuration.station_name,
                &frame.station_id,
                &lease,
                &request.request_id,
                response,
                cursor,
            )
            .ok()?;
            let mut current = state.lock().ok()?;
            current
                .authority
                .replay
                .insert(request.request_id.clone(), (digest, packet.clone()));
            current.authority.replay_order.push_back(request.request_id);
            while current.authority.replay_order.len() > MAX_AUTHORITY_REPLAY {
                if let Some(expired) = current.authority.replay_order.pop_front() {
                    current.authority.replay.remove(&expired);
                }
            }
            Some(packet)
        }
        "reply" => {
            let frame = serde_json::from_value::<WireAuthorityReply>(value).ok()?;
            let mut current = state.lock().ok()?;
            expire_authority_lease(&mut current.authority);
            let lease = current.authority.lease.clone()?;
            if current.authority.role != "client"
                || !matches!(current.authority.status, "leasing" | "connected")
                || frame.protocol != AUTHORITY_PROTOCOL
                || frame.kind != "reply"
                || frame.recipient_station_id != configuration.station_name
                || frame.station_id != lease.station_id
                || frame.contest_identity != configuration.contest_identity
                || frame.contest_identity != lease.contest_identity
                || frame.session_id != lease.session_id
                || frame.workspace_generation != lease.workspace_generation
                || frame.lease_id != lease.lease_id
                || validate_request_id(&frame.request_id).is_err()
                || frame.auth_tag != lease_auth_tag(&lease.token, &reply_auth_material(&frame))
            {
                return None;
            }
            let pending = current.authority.pending.remove(&frame.request_id)?;
            current.authority.reconnect_cursor = current
                .authority
                .reconnect_cursor
                .max(frame.reconnect_cursor);
            current.authority.status = "connected";
            if response_proves_remote_persistence(pending.operation, &frame.response) {
                current.authority.remote_persistence_verified = true;
            }
            current
                .authority
                .replies
                .insert(frame.request_id.clone(), (pending.digest, frame.response));
            current.authority.reply_order.push_back(frame.request_id);
            while current.authority.reply_order.len() > MAX_AUTHORITY_REPLAY {
                if let Some(expired) = current.authority.reply_order.pop_front() {
                    current.authority.replies.remove(&expired);
                }
            }
            None
        }
        _ => None,
    }
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
            // Pinned Renfield emits RESPONSE even when its SQLite insert fails.
            // Record transport observation only; never retire the publication.
            if current.outstanding_contacts.contains(&response.unique_id)
                && !current
                    .unverified_transport_acknowledgements
                    .contains(&response.unique_id)
            {
                current
                    .unverified_transport_acknowledgements
                    .push_back(response.unique_id);
                while current.unverified_transport_acknowledgements.len() > MAX_ACKNOWLEDGEMENTS {
                    current.unverified_transport_acknowledgements.pop_front();
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
    let authoritative = state.authority.status == "connected" && state.authority.lease.is_some();
    let persistence_verified = authoritative && state.authority.remote_persistence_verified;
    let lease = state.authority.lease.as_ref();
    Ok(Snapshot {
        status: state.status,
        error: state.error.clone(),
        enabled: owner.configuration.enabled,
        operator: owner.configuration.operator.clone(),
        multicast_group: owner.configuration.multicast_group.clone(),
        multicast_port: owner.configuration.multicast_port,
        messages: state.messages.iter().cloned().collect(),
        unverified_transport_acknowledgements: state
            .unverified_transport_acknowledgements
            .iter()
            .cloned()
            .collect(),
        capabilities: Capabilities {
            chat: true,
            contact_publication: true,
            remote_persistence_verified: persistence_verified,
            shared_serial: authoritative,
            duplicate_inquiry: authoritative,
            authority_limitation: if persistence_verified {
                "An OK first-party contactApply reply verified persistence under the current master lease. Lease tags only correlate frames inside the explicitly trusted multicast LAN; they do not establish cryptographic peer identity."
            } else if authoritative {
                "The first-party v1 path is connected, but persistence is not verified until an OK contactApply reply. Lease tags only correlate frames inside the explicitly trusted multicast LAN; they do not establish cryptographic peer identity."
            } else {
                "No proven first-party master lease is active. The multicast LAN is an explicit trust boundary, not cryptographic peer identity. Pinned Renfield POST replies do not prove SQLite persistence, and legacy GET_SN/ISDUPE replies have no request identity."
            },
        },
        authority: AuthoritySnapshot {
            role: state.authority.role,
            status: state.authority.status,
            master_station: lease.map(|value| value.station_id.clone()),
            session_id: lease.map(|value| value.session_id.clone()),
            workspace_generation: lease.map(|value| value.workspace_generation.clone()),
            lease_expires_at_ms: lease.map(|value| value.expires_at_ms),
            reconnect_cursor: state.authority.reconnect_cursor,
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
    let operator = object
        .get("Operator")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("Contest contact publication has no historical operator.")?;
    validate_text(operator, MAX_SENDER_BYTES, "Contact operator")?;
    object.insert("cmd".into(), Value::String("POST".into()));
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
    #[test]
    #[cfg(unix)]
    fn two_local_group_sockets_use_the_explicit_loopback_interface() {
        use std::time::Duration;
        let interface=std::net::Ipv4Addr::LOCALHOST;
        let first=super::bind_group_socket(interface,0).unwrap();
        let port=first.local_addr().unwrap().port();
        let second=super::bind_group_socket(interface,port).unwrap();
        let group=std::net::Ipv4Addr::new(239,255,42,4);
        for socket in [&first,&second]{socket.join_multicast_v4(&group,&interface).unwrap();socket.set_multicast_loop_v4(true).unwrap();socket.set_read_timeout(Some(Duration::from_secs(1))).unwrap();}
        let payload=b"wave4-loopback-only";
        first.send_to(payload,(group,port)).unwrap();
        for socket in [&first,&second]{let mut packet=[0;64];let(count,source)=socket.recv_from(&mut packet).unwrap();assert_eq!(&packet[..count],payload);assert!(source.ip().is_loopback());}
    }
    use super::*;
    fn configuration(enabled: bool) -> Configuration {
        Configuration {
            enabled,
            multicast_group: "239.1.1.1".into(),
            multicast_port: 2239,
            interface: "0.0.0.0".into(),
            operator: "OM0RX".into(),
            station_name: "xlog-a".into(),
            multi_master: false,
            contest_identity: "cq-ww-cw:2026".into(),
        }
    }

    fn context() -> String {
        "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333".into()
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
        let snapshot = chat.configure(context(), configuration(false)).unwrap();
        assert_eq!(snapshot.status, "disabled");
        assert!(chat
            .send(&context(), "hello")
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
    fn contest_identity_is_required_when_enabled_and_always_bounded() {
        let mut value = configuration(true);
        value.contest_identity.clear();
        assert!(validate_configuration(&value).is_err());
        value.enabled = false;
        assert!(validate_configuration(&value).is_ok());
        value.contest_identity = "x".repeat(MAX_CONTEST_IDENTITY_BYTES + 1);
        assert!(validate_configuration(&value).is_err());
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
        let snapshot = chat.configure(context(), configuration(false)).unwrap();
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
            assert!(state.unverified_transport_acknowledgements.is_empty());
            assert!(state.messages.is_empty());
        }
    }

    #[test]
    fn post_publication_preserves_historical_operator_during_handoff_retry() {
        let qso_id = "11111111-1111-4111-8111-111111111111";
        let mut current_configuration = configuration(true);
        current_configuration.operator = "NEWOP".into();
        let (identity, packet) = post_packet(
            &current_configuration,
            serde_json::json!({"ID":qso_id,"ContestName":"CQ-WW-CW","Call":"K1ABC","Operator":"OLDOP","Dirty":1}),
        )
        .unwrap();
        assert_eq!(identity, qso_id);
        let value: Value = serde_json::from_slice(&packet).unwrap();
        assert_eq!(value["cmd"], "POST");
        assert_eq!(value["Operator"], "OLDOP");
        assert_eq!(value["NetBiosName"], "xlog-a");
    }

    #[test]
    fn post_publication_requires_a_bounded_historical_operator() {
        let qso_id = "11111111-1111-4111-8111-111111111111";
        assert!(post_packet(
            &configuration(true),
            serde_json::json!({"ID":qso_id,"ContestName":"CQ-WW-CW","Call":"K1ABC"}),
        )
        .is_err());
        assert!(post_packet(
            &configuration(true),
            serde_json::json!({"ID":qso_id,"ContestName":"CQ-WW-CW","Call":"K1ABC","Operator":"X".repeat(33)}),
        )
        .is_err());
    }

    #[test]
    fn two_peers_record_only_their_unverified_transport_acknowledgements() {
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
                .unverified_transport_acknowledgements
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            [two, one]
        );
        assert!(second
            .lock()
            .unwrap()
            .unverified_transport_acknowledgements
            .is_empty());
        assert!(first.lock().unwrap().outstanding_contacts.contains(one));
        assert!(first.lock().unwrap().outstanding_contacts.contains(two));

        process_wire(&response("xlog-b", two), &second_configuration, &second);
        assert_eq!(
            second
                .lock()
                .unwrap()
                .unverified_transport_acknowledgements
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
        assert!(restarted
            .lock()
            .unwrap()
            .unverified_transport_acknowledgements
            .is_empty());
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
        assert!(restarted
            .lock()
            .unwrap()
            .unverified_transport_acknowledgements
            .is_empty());
    }

    fn authority_fixture() -> (
        Configuration,
        Arc<Mutex<SharedState>>,
        Configuration,
        Arc<Mutex<SharedState>>,
    ) {
        let mut master_configuration = configuration(true);
        master_configuration.multi_master = true;
        let master_identity = parse_context(&context()).unwrap();
        let master = Arc::new(Mutex::new(SharedState::for_owner(
            master_identity,
            &master_configuration,
        )));
        let mut client_configuration = configuration(true);
        client_configuration.station_name = "xlog-b".into();
        let client_context = "44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666";
        let client = Arc::new(Mutex::new(SharedState::for_owner(
            parse_context(client_context).unwrap(),
            &client_configuration,
        )));
        let lease = refresh_lease_packet(&master).unwrap();
        process_authority_wire(&lease, &client_configuration, &client, |_| unreachable!());
        (master_configuration, master, client_configuration, client)
    }

    fn staged_request(client: &Arc<Mutex<SharedState>>, request: &AuthorityRequest) -> Vec<u8> {
        let digest = authority_request_digest(request).unwrap();
        let mut current = client.lock().unwrap();
        let packet =
            authority_request_packet("xlog-b", current.authority.lease.as_ref().unwrap(), request)
                .unwrap();
        current.authority.pending.insert(
            request.request_id.clone(),
            PendingAuthorityRequest {
                digest,
                packet: packet.clone(),
                operation: request.operation,
            },
        );
        packet
    }

    #[test]
    fn authority_duplicate_and_lost_frames_are_retry_safe_and_correlated() {
        let (master_configuration, master, client_configuration, client) = authority_fixture();
        let request = AuthorityRequest {
            request_id: "77777777-7777-4777-8777-777777777777".into(),
            operation: AuthorityOperation::SerialReserve,
            params: serde_json::json!({"frequencyHz":14025000}),
        };
        let packet = staged_request(&client, &request);
        let calls = std::cell::Cell::new(0);
        let first = process_authority_wire(&packet, &master_configuration, &master, |_| {
            calls.set(calls.get() + 1);
            Ok(serde_json::json!({"id":request.request_id,"ok":true,"result":{"serial":17,"replayed":false}}))
        }).unwrap();
        // Simulate a lost reply and retrying the exact request frame.
        let replay = process_authority_wire(&packet, &master_configuration, &master, |_| {
            calls.set(calls.get() + 1);
            unreachable!()
        })
        .unwrap();
        assert_eq!(first, replay);
        assert_eq!(calls.get(), 1);
        process_authority_wire(&replay, &client_configuration, &client, |_| unreachable!());
        process_authority_wire(&replay, &client_configuration, &client, |_| unreachable!());
        let current = client.lock().unwrap();
        assert_eq!(current.authority.replies.len(), 1);
        assert_eq!(
            current.authority.replies[&request.request_id].1["result"]["serial"],
            17
        );
    }

    #[test]
    fn persistence_is_verified_only_by_ok_contact_apply_and_resets_with_lease() {
        let (master_configuration, master, client_configuration, client) = authority_fixture();
        let serial = AuthorityRequest {
            request_id: "77777777-7777-4777-8777-777777777777".into(),
            operation: AuthorityOperation::SerialReserve,
            params: serde_json::json!({"frequencyHz":14025000}),
        };
        let serial_reply = process_authority_wire(
            &staged_request(&client, &serial),
            &master_configuration,
            &master,
            |_| Ok(serde_json::json!({"id":serial.request_id,"ok":true,"result":{"serial":17}})),
        )
        .unwrap();
        process_authority_wire(
            &serial_reply,
            &client_configuration,
            &client,
            |_| unreachable!(),
        );
        assert!(!master.lock().unwrap().authority.remote_persistence_verified);
        let client_owner = Owner {
            context: context(),
            configuration: client_configuration.clone(),
            state: client.clone(),
            worker: None,
        };
        let connected = snapshot(&client_owner).unwrap();
        assert!(connected.capabilities.shared_serial);
        assert!(connected.capabilities.duplicate_inquiry);
        assert!(!connected.capabilities.remote_persistence_verified);

        let failed_apply = AuthorityRequest {
            request_id: "88888888-8888-4888-8888-888888888888".into(),
            operation: AuthorityOperation::ContactApply,
            params: serde_json::json!({"action":"commit","qsoID":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}),
        };
        let failed_reply = process_authority_wire(
            &staged_request(&client, &failed_apply),
            &master_configuration,
            &master,
            |_| Ok(serde_json::json!({"id":failed_apply.request_id,"ok":false,"error":{"code":"write_failed"}})),
        )
        .unwrap();
        process_authority_wire(
            &failed_reply,
            &client_configuration,
            &client,
            |_| unreachable!(),
        );
        assert!(!master.lock().unwrap().authority.remote_persistence_verified);
        assert!(
            !snapshot(&client_owner)
                .unwrap()
                .capabilities
                .remote_persistence_verified
        );

        let applied = AuthorityRequest {
            request_id: "99999999-9999-4999-8999-999999999999".into(),
            operation: AuthorityOperation::ContactApply,
            params: serde_json::json!({"action":"commit","qsoID":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}),
        };
        let applied_reply = process_authority_wire(
            &staged_request(&client, &applied),
            &master_configuration,
            &master,
            |_| Ok(serde_json::json!({"id":applied.request_id,"ok":true,"result":{"revision":9}})),
        )
        .unwrap();
        assert!(master.lock().unwrap().authority.remote_persistence_verified);
        assert!(!client.lock().unwrap().authority.remote_persistence_verified);
        process_authority_wire(
            &applied_reply,
            &client_configuration,
            &client,
            |_| unreachable!(),
        );
        assert!(
            snapshot(&client_owner)
                .unwrap()
                .capabilities
                .remote_persistence_verified
        );

        {
            let mut current = client.lock().unwrap();
            current.authority.lease.as_mut().unwrap().expires_at_ms = 0;
            expire_authority_lease(&mut current.authority);
        }
        assert!(!client.lock().unwrap().authority.remote_persistence_verified);
        revoke_authority(&master);
        assert!(!master.lock().unwrap().authority.remote_persistence_verified);

        let direct_master = Arc::new(Mutex::new(SharedState::for_owner(
            parse_context(&context()).unwrap(),
            &master_configuration,
        )));
        record_authority_reply(
            &direct_master,
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "digest".into(),
            AuthorityOperation::ContactApply,
            serde_json::json!({"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","ok":true,"result":{"revision":10}}),
        );
        assert!(
            direct_master
                .lock()
                .unwrap()
                .authority
                .remote_persistence_verified
        );
    }

    #[test]
    fn authority_rejects_invalid_lease_tag_and_stale_workspace_before_dispatch() {
        let (master_configuration, master, _client_configuration, client) = authority_fixture();
        let request = AuthorityRequest {
            request_id: "77777777-7777-4777-8777-777777777777".into(),
            operation: AuthorityOperation::DupeInquiry,
            params: serde_json::json!({"call":"K1ABC","frequencyHz":14025000,"mode":"CW"}),
        };
        let packet = staged_request(&client, &request);
        let mut frame: WireAuthorityRequest = serde_json::from_slice(&packet).unwrap();
        frame.auth_tag = "0".repeat(64);
        let calls = std::cell::Cell::new(0);
        assert!(process_authority_wire(
            &serde_json::to_vec(&frame).unwrap(),
            &master_configuration,
            &master,
            |_| {
                calls.set(calls.get() + 1);
                Ok(Value::Null)
            }
        )
        .is_none());
        let token = master
            .lock()
            .unwrap()
            .authority
            .lease
            .as_ref()
            .unwrap()
            .token
            .clone();
        frame.workspace_generation = "88888888-8888-4888-8888-888888888888".into();
        frame.auth_tag = lease_auth_tag(&token, &request_auth_material(&frame));
        assert!(process_authority_wire(
            &serde_json::to_vec(&frame).unwrap(),
            &master_configuration,
            &master,
            |_| {
                calls.set(calls.get() + 1);
                Ok(Value::Null)
            }
        )
        .is_none());
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn authority_rejects_other_contest_on_shared_multicast_before_adoption_or_dispatch() {
        let mut master_configuration = configuration(true);
        master_configuration.multi_master = true;
        let master = Arc::new(Mutex::new(SharedState::for_owner(
            parse_context(&context()).unwrap(),
            &master_configuration,
        )));

        let mut other_contest_configuration = configuration(true);
        other_contest_configuration.station_name = "xlog-b".into();
        other_contest_configuration.contest_identity = "iaru-hf:2026".into();
        let other_contest = Arc::new(Mutex::new(SharedState::for_owner(
            parse_context("44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666").unwrap(),
            &other_contest_configuration,
        )));

        let lease_packet = refresh_lease_packet(&master).unwrap();
        assert!(process_authority_wire(
            &lease_packet,
            &other_contest_configuration,
            &other_contest,
            |_| unreachable!(),
        )
        .is_none());
        let other_state = other_contest.lock().unwrap();
        assert_eq!(other_state.authority.status, "discovering");
        assert!(other_state.authority.lease.is_none());
        drop(other_state);

        let lease = master
            .lock()
            .unwrap()
            .authority
            .lease
            .as_ref()
            .unwrap()
            .clone();
        let request = AuthorityRequest {
            request_id: "77777777-7777-4777-8777-777777777777".into(),
            operation: AuthorityOperation::DupeInquiry,
            params: serde_json::json!({"call":"K1ABC","frequencyHz":14025000,"mode":"CW"}),
        };
        let packet = authority_request_packet("xlog-b", &lease, &request).unwrap();
        let mut frame: WireAuthorityRequest = serde_json::from_slice(&packet).unwrap();
        frame.contest_identity = other_contest_configuration.contest_identity.clone();
        frame.auth_tag = lease_auth_tag(&lease.token, &request_auth_material(&frame));
        let calls = std::cell::Cell::new(0);
        assert!(process_authority_wire(
            &serde_json::to_vec(&frame).unwrap(),
            &master_configuration,
            &master,
            |_| {
                calls.set(calls.get() + 1);
                Ok(Value::Null)
            },
        )
        .is_none());
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn authority_lease_loss_revokes_pending_and_reconnect_replays_from_cursor() {
        let (master_configuration, master, client_configuration, client) = authority_fixture();
        let request = AuthorityRequest {
            request_id: "77777777-7777-4777-8777-777777777777".into(),
            operation: AuthorityOperation::ContactApply,
            params: serde_json::json!({"action":"commit","qsoID":"99999999-9999-4999-8999-999999999999"}),
        };
        let packet = staged_request(&client, &request);
        let reply = process_authority_wire(&packet, &master_configuration, &master, |_| Ok(serde_json::json!({
            "id":request.request_id,"ok":true,"result":{"revision":9,"qsoID":"99999999-9999-4999-8999-999999999999"}}))).unwrap();
        {
            let mut current = client.lock().unwrap();
            current.authority.lease.as_mut().unwrap().expires_at_ms = 0;
            expire_authority_lease(&mut current.authority);
            assert_eq!(current.authority.status, "lease_lost");
            assert!(current.authority.pending.is_empty());
        }
        assert!(
            process_authority_wire(&reply, &client_configuration, &client, |_| unreachable!())
                .is_none()
        );
        assert!(client.lock().unwrap().authority.replies.is_empty());

        let lease = refresh_lease_packet(&master).unwrap();
        process_authority_wire(&lease, &client_configuration, &client, |_| unreachable!());
        let retry = staged_request(&client, &request);
        let replay =
            process_authority_wire(&retry, &master_configuration, &master, |_| unreachable!())
                .unwrap();
        process_authority_wire(&replay, &client_configuration, &client, |_| unreachable!());
        let current = client.lock().unwrap();
        assert_eq!(current.authority.status, "connected");
        assert_eq!(current.authority.reconnect_cursor, 9);
        assert_eq!(
            current.authority.replies[&request.request_id].1["result"]["revision"],
            9
        );
    }

    #[test]
    fn same_master_process_restart_rebinds_to_newer_lease_and_retries_persisted_request() {
        let (master_configuration, master, client_configuration, client) = authority_fixture();
        let request = AuthorityRequest {
            request_id: "77777777-7777-4777-8777-777777777777".into(),
            operation: AuthorityOperation::SerialReserve,
            params: serde_json::json!({"frequencyHz":14025000}),
        };
        let old_lease_packet = refresh_lease_packet(&master).unwrap();
        process_authority_wire(
            &old_lease_packet,
            &client_configuration,
            &client,
            |_| unreachable!(),
        );
        let old_lease_id = client
            .lock()
            .unwrap()
            .authority
            .lease
            .as_ref()
            .unwrap()
            .lease_id
            .clone();
        let _lost_request = staged_request(&client, &request);

        std::thread::sleep(Duration::from_millis(2));
        let restarted_master = Arc::new(Mutex::new(SharedState::for_owner(
            parse_context(&context()).unwrap(),
            &master_configuration,
        )));
        let restarted_lease_packet = refresh_lease_packet(&restarted_master).unwrap();
        process_authority_wire(
            &restarted_lease_packet,
            &client_configuration,
            &client,
            |_| unreachable!(),
        );
        let new_lease_id = client
            .lock()
            .unwrap()
            .authority
            .lease
            .as_ref()
            .unwrap()
            .lease_id
            .clone();
        assert_ne!(new_lease_id, old_lease_id);
        assert_eq!(client.lock().unwrap().authority.status, "leasing");
        assert!(client.lock().unwrap().authority.pending.is_empty());

        // A delayed advertisement from the stopped process cannot roll the
        // client back after the newer expiry/lease pair has been adopted.
        process_authority_wire(
            &old_lease_packet,
            &client_configuration,
            &client,
            |_| unreachable!(),
        );
        assert_eq!(
            client
                .lock()
                .unwrap()
                .authority
                .lease
                .as_ref()
                .unwrap()
                .lease_id,
            new_lease_id
        );

        let retry = staged_request(&client, &request);
        let calls = std::cell::Cell::new(0);
        let reply =
            process_authority_wire(&retry, &master_configuration, &restarted_master, |_| {
                calls.set(calls.get() + 1);
                Ok(
                    serde_json::json!({"id":request.request_id,"ok":true,"result":{
                        "requestID":request.request_id,"serial":17,"replayed":true
                    }}),
                )
            })
            .unwrap();
        process_authority_wire(&reply, &client_configuration, &client, |_| unreachable!());
        assert_eq!(calls.get(), 1);
        assert_eq!(client.lock().unwrap().authority.status, "connected");
        assert_eq!(
            client.lock().unwrap().authority.replies[&request.request_id].1["result"]["serial"],
            17
        );
    }
}
