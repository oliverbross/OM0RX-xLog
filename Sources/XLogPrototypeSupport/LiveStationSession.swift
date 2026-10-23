#if os(macOS)
import AppKit
import CryptoKit
import Darwin
import Foundation
import LocalAuthentication
import Security
import XCatIntegrationCore
import XLogCore

/// A failed reply can still mean that the agent started transmitting. Keep the
/// release obligation until a successful stop, without touching a read-only peer.
struct StationTransmitOwnership {
    enum Release: Equatable { case clearCW, cancelTune, releasePTT }
    private var ptt = false
    private var cw = false
    private var tune = false

    mutating func beginControl(_ control: String, enabled: Bool = false) {
        if control == "ptt", enabled { ptt = true }
        if control == "send_cw" { cw = true }
    }

    mutating func completeControl(_ control: String, enabled: Bool = false) {
        if control == "ptt", !enabled { ptt = false }
        if control == "clear_cw" { cw = false }
    }

    mutating func beginAction(_ action: RemoteStationAction) {
        if action == .tune { tune = true }
    }

    mutating func completeAction(_ action: RemoteStationAction, acquisitionsInFlight: Bool = false) {
        // A Cancel acknowledgement cannot retire the obligation of an older
        // HTTP acquisition whose reply is still outstanding. Its wire outcome
        // is unknown; keep explicit release available after it finishes.
        if action == .cancel && acquisitionsInFlight { return }
        if action == .cancel { tune = false }
    }

    var releases: [Release] {
        (cw ? [.clearCW] : []) + (tune ? [.cancelTune] : [])
            + (ptt || cw || tune ? [.releasePTT] : [])
    }
}

/// GUI PTT is deliberately separate from embedded CAT, CW and carrier Tune.
struct StationGUIPTT {
    private(set) var ownerID: String?
    private var lastID: String?
    private var desired: Bool?
    private var after: Date?
    private(set) var pending = false
    private(set) var confirmed = false
    mutating func begin(_ id: String, on: Bool) throws {
        guard UUID(uuidString:id) != nil, on ? ownerID == nil : ownerID == nil || ownerID == id else {
            throw WorkerFailure("station_action_blocked", "PTT release belongs to another source or acquisition")
        }
        if on { ownerID=id };lastID=id;pending=true;confirmed=false
    }
    mutating func acknowledged(on:Bool) {pending=false;desired=on;after=Date();confirmed=false}
    mutating func confirm(on:Bool) {pending=false;desired=on;confirmed=true;if !on{ownerID=nil}}
    mutating func retireAcquisition() { if desired == false {after=Date();confirmed=false} }
    mutating func invalidateProof() {confirmed=false}
    mutating func observe(_ sample: XCatIntegrationCore.RadioSnapshot, canRelease:Bool=true) {
        guard !pending, let after, let desired, sample.isConnected,
              sample.transportReceivedAt.map({$0 > after}) == true,
              sample.remoteStationStatus?.radioKnown == true, sample.remoteStationStatus?.radioStale == false,
              sample.isTransmitting == desired, desired || canRelease else{confirmed=false;return}
        confirm(on:desired)
    }
    var projection:[String:Any] {["source":"gui","owner_id":lastID as Any? ?? NSNull(),"release_required":ownerID != nil,
        "pending":pending,"confirmed":confirmed,"transmitting":confirmed ? desired as Any? ?? NSNull() : NSNull()]}
}

/// An explicit Cancel retires preparations even before they acquire ownership.
struct StationCarrierIntent {
    private var revision: UInt64 = 0
    private var nativeRevision: UInt64 = 0
    mutating func admitNative(_ expected: UInt64) throws {
        guard expected > nativeRevision else {
            throw WorkerFailure("station_changed", "A newer native radio intent already retired this carrier command; no older acquisition may start.")
        }
        nativeRevision = expected
    }
    mutating func begin() -> UInt64 { revision &+= 1; return revision }
    mutating func cancel() { revision &+= 1 }
    func require(_ expected: UInt64) throws {
        guard revision == expected else { throw WorkerFailure("station_changed", "Carrier Tune was superseded by a later transmit intent; no older acquisition may continue.") }
    }
}

/// Enqueue before yielding: overlapping listener retirement and station
/// shutdown must both wait for the same pending writes and release callbacks.
struct StationCATRetirement {
    private var pending: Task<Void, Never>?

    mutating func enqueue(_ operation: @escaping @Sendable () async -> Void) -> Task<Void, Never> {
        let previous = pending
        let next = Task {
            await previous?.value
            await operation()
        }
        pending = next
        return next
    }
}

struct StationPowerSessionEvent: Sendable {
    let sequence: UInt64
    let state: RadioConnectionState
    let sessionID: UUID
    let startedAt: Date?
}

/// Stamp at the synchronous callback boundary, before Tasks can reorder delivery.
/// Every event carries the attempt identity, so receiving READY first still
/// installs the identity established by the earlier CONNECTING callback.
final class StationPowerSessionEventSource: @unchecked Sendable {
    let id = UUID()
    private let lock = NSLock()
    private var sequence: UInt64 = 0
    private var sessionID = UUID()
    private var startedAt: Date?
    private var latestEvent: StationPowerSessionEvent?

    func stamp(_ state: RadioConnectionState, at now: Date = Date()) -> StationPowerSessionEvent {
        lock.withLock {
            sequence &+= 1
            if state == .connecting {
                sessionID = UUID()
                startedAt = now
            }
            let event = StationPowerSessionEvent(sequence: sequence, state: state,
                                                 sessionID: sessionID, startedAt: startedAt)
            latestEvent = event
            return event
        }
    }

    func latest() -> StationPowerSessionEvent? { lock.withLock { latestEvent } }
}

struct StationPowerSessionState {
    private(set) var lastSequence: UInt64 = 0
    private(set) var sessionID = UUID()
    private(set) var startedAt: Date?

    mutating func apply(_ event: StationPowerSessionEvent) -> Bool {
        guard event.sequence > lastSequence else { return false }
        lastSequence = event.sequence
        sessionID = event.sessionID
        startedAt = event.startedAt
        return true
    }

    mutating func reconcile(_ source: StationPowerSessionEventSource) -> RadioConnectionState? {
        guard let event = source.latest(), apply(event) else { return nil }
        return event.state
    }
}

struct StationAgentCredentialCache {
    private var tokens: [String: String] = [:]
    private var attemptedNoninteractive: Set<String> = []

    /// Background recovery gets one Keychain attempt per endpoint and worker.
    /// An explicit interactive connect bypasses a cached miss or denial.
    mutating func resolve(
        endpoint: String,
        interactionAllowed: Bool,
        load: (Bool) throws -> String?
    ) throws -> String? {
        if let token = tokens[endpoint] { return token }
        if !interactionAllowed, attemptedNoninteractive.contains(endpoint) { return nil }
        if !interactionAllowed { attemptedNoninteractive.insert(endpoint) }
        guard let token = try load(interactionAllowed), !token.isEmpty else { return nil }
        tokens[endpoint] = token
        return token
    }

    mutating func remember(_ token: String, endpoint: String) {
        tokens[endpoint] = token
        attemptedNoninteractive.insert(endpoint)
    }

    mutating func invalidate(endpoint: String) {
        tokens.removeValue(forKey: endpoint)
        attemptedNoninteractive.remove(endpoint)
    }
}

/// Explicitly connected direct Remote Station Agent owner. This uses the same
/// authenticated HTTPS/WSS client and authoritative state decoder as xCat.
actor LiveStationSession {
    private var carrierIntent = StationCarrierIntent()
    private var carrierReadbackAfter: Date?
    private var carrierCancelAcknowledged = false
    static let shared = LiveStationSession()
    private let rotor: LiveRotorSession
    private let receiveReadbackTimeout: Duration
    private let radioID: String

    init(radioID: String = "radio1", rotor: LiveRotorSession = .shared, receiveReadbackTimeout: Duration = .seconds(4)) {
        self.radioID = radioID
        self.rotor = rotor
        self.receiveReadbackTimeout = receiveReadbackTimeout
    }

    private var client: RemoteAgentClient?
    private var baseURL: String?
    private var transportState: RadioConnectionState = .stopped
    private var allowTransmit = false
    private var transmitOwnership = StationTransmitOwnership()
    private var guiPTT = StationGUIPTT()
    private var embeddedCATPTT = false
    private var connectionGeneration: UInt64 = 0
    private var powerEvents: StationPowerSessionEventSource?
    private var powerSession = StationPowerSessionState()
    private var powerCapture: NativeDraftPowerGate?
    private var powerSessionID: UUID { powerSession.sessionID }
    private var powerSessionStartedAt: Date? { powerSession.startedAt }
    private var catServers: EmbeddedCATServers?
    private var catConfiguration = EmbeddedCATServers.Configuration()
    private var catListenerEpoch: UInt64 = 0
    private var catRetirement = StationCATRetirement()
    private var lifecycleTransitions = 0
    private var terminalShutdown = false
    private var directTransmitAcquisitions = 0
    private var credentialCache = StationAgentCredentialCache()

    func installPowerCapture(_ capture: NativeDraftPowerGate) {
        // Worker startup registers before requests can explicitly connect.
        powerCapture = capture
    }

    static let methods: Set<String> = ["station_connect", "station_disconnect", "station_reconnect",
                                        "station_forget", "station_configuration", "station_configuration_save",
                                        "station_radio_control", "station_rotor_snapshot", "station_rotor_connect",
                                        "station_rotor_disconnect", "station_rotor_goto", "station_rotor_stop",
                                        "station_add_spot", "station_remove_spot", "station_cat_servers"]

    func handle(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        try requireActive()
        switch method {
        case "station_cat_servers":
            try requireKeys(params, allowed: ["provider", "cat_port", "rigctl_port", "allow_transmit"])
            func port(_ key: String) throws -> UInt16? {
                guard let raw = params[key], !(raw is NSNull) else { return nil }
                guard let value = try Self.integer(raw), (1...65535).contains(value) else { throw Self.invalidParams() }
                return UInt16(value)
            }
            let nextConfiguration = try EmbeddedCATServers.Configuration(catPort: port("cat_port"), rigCtlPort: port("rigctl_port"), allowTransmit: Self.boolean(params["allow_transmit"]) ?? false)
            try beginLifecycleTransition()
            defer { lifecycleTransitions -= 1 }
            if nextConfiguration.catPort == nil && nextConfiguration.rigCtlPort == nil {
                await stopCATServers()
                return await snapshot()
            }
            let generation = connectionGeneration
            let observedEpoch = catListenerEpoch
            guard let client, await client.observedSnapshot().isConnected else {
                throw WorkerFailure("station_unavailable", "Connect the embedded radio before enabling CAT listeners.")
            }
            guard generation == connectionGeneration, observedEpoch == catListenerEpoch,
                  self.client === client else { throw lifecycleChanged() }
            guard !nextConfiguration.allowTransmit || allowTransmit else {
                throw WorkerFailure("station_action_blocked", "Enable transmit for the radio connection before enabling CAT transmit commands.")
            }
            await stopCATServers()
            guard generation == connectionGeneration, self.client === client else { throw lifecycleChanged() }
            try requireActive()
            let epoch = catListenerEpoch
            let servers = EmbeddedCATServers(radio: client, configuration: nextConfiguration,
                observedSnapshot: { await client.observedSnapshot() },
                authorizeMutation: { [weak self] mutation in await self?.authorizeCATMutation(mutation, generation: generation, epoch: epoch) ?? false },
                didCompleteMutation: { [weak self] mutation in await self?.completeCATMutation(mutation, generation: generation) })
            do { try servers.start() }
            catch { throw WorkerFailure("cat_listener_failed", "Cannot open CAT listeners. Check for conflicting ports and close the other CAT server first.") }
            catServers = servers; catConfiguration = nextConfiguration
            return await snapshot()
        case "station_connect":
            try requireKeys(params, allowed: ["provider", "base_url", "token", "allow_transmit", "allow_keychain_interaction"])
            let endpoint = try Self.validatedURL(params["base_url"])
            let enteredToken = params["token"] as? String
            guard params["token"] == nil || enteredToken != nil else { throw Self.invalidParams() }
            if let rawInteraction = params["allow_keychain_interaction"] {
                guard let value = rawInteraction as? NSNumber,
                      CFGetTypeID(value) == CFBooleanGetTypeID() else { throw Self.invalidParams() }
            }
            let transmit: Bool
            if let rawTransmit = params["allow_transmit"] {
                guard let value = rawTransmit as? NSNumber,
                      CFGetTypeID(value) == CFBooleanGetTypeID() else { throw Self.invalidParams() }
                transmit = value.boolValue
            } else {
                transmit = false
            }
            let keychain = StationAgentKeychain(endpoint: endpoint, radioID: radioID)
            let token = try enteredToken?.trimmingCharacters(in: .whitespacesAndNewlines)
                ?? credentialCache.resolve(endpoint: endpoint, interactionAllowed: false) {
                    try keychain.load(interactionAllowed: $0)
                }
            guard let token, !token.isEmpty, token.utf8.count <= 4_096 else {
                throw WorkerFailure("station_credentials_required", "Enter a Remote Station Agent token.")
            }
            try beginLifecycleTransition()
            defer { lifecycleTransitions -= 1 }
            let expectedGeneration = connectionGeneration
            try await ensureExclusiveWriter()
            guard expectedGeneration == connectionGeneration else { throw lifecycleChanged() }
            let next: RemoteAgentClient
            let generation = connectionGeneration &+ 1
            let nextPowerEvents = StationPowerSessionEventSource()
            let capture = powerCapture
            do {
                next = try RemoteAgentClient(baseURL: endpoint, token: token,
                    onState: { [weak self] state, _ in
                        let event = nextPowerEvents.stamp(state)
                        capture?.connection(sourceID: nextPowerEvents.id, sequence: event.sequence,
                            sessionID: event.sessionID, startedAt: event.startedAt, ready: state == .ready)
                        Task { await self?.recordState(event, generation: generation) }
                    }, onObservedSnapshot: { snapshot in
                        guard let event = nextPowerEvents.latest(), event.state == .ready,
                              let startedAt = event.startedAt, snapshot.isConnected, snapshot.isTransmitting,
                              let meter = snapshot.measuredTransmitPower,
                              meter.isFresh(at: Date(), sessionStartedAt: startedAt),
                              snapshot.vfos.filter({ $0.isTransmit }).count == 1,
                              let tx = snapshot.vfos.first(where: { $0.isTransmit }),
                              let sample = OperatorDraftPowerSample(source: meter.source.rawValue, watts: meter.watts,
                                observedAt: meter.observedAt, radioObservedAt: meter.radioObservedAt,
                                amplifierObservedAt: meter.amplifierObservedAt, receivedAt: meter.receivedAt,
                                sessionID: event.sessionID) else { return }
                        capture?.observe(sourceID: nextPowerEvents.id, sample: sample,
                                         frequencyHz: tx.frequencyHz, mode: tx.mode)
                    })
            } catch {
                throw WorkerFailure("invalid_params", "Invalid Remote Station Agent connection settings.")
            }
            connectionGeneration = generation
            powerSession = StationPowerSessionState()
            powerEvents = nextPowerEvents
            capture?.attach(sourceID: nextPowerEvents.id,
                endpointID: "direct_agent:" + SHA256.hash(data: Data(endpoint.utf8)).map { String(format: "%02x", $0) }.joined())
            let current = client
            client = nil
            transportState = .stopped
            allowTransmit = false
            await stopCATServers()
            if let current {
                await stop(current)
            }
            guard generation == connectionGeneration else { throw lifecycleChanged() }
            try requireActive()
            client = next
            baseURL = endpoint
            recordState(nextPowerEvents.stamp(.connecting), generation: generation)
            allowTransmit = transmit
            if enteredToken != nil {
                try keychain.save(token)
                credentialCache.remember(token, endpoint: endpoint)
            }
            await next.start()
            guard !terminalShutdown, generation == connectionGeneration, client === next else {
                await next.stop()
                throw lifecycleChanged()
            }
            return await snapshot()

        case "station_disconnect":
            try requireKeys(params, allowed: ["provider"])
            await shutdown()
            return await snapshot()

        case "station_reconnect":
            try requireKeys(params, allowed: ["provider"])
            try beginLifecycleTransition()
            defer { lifecycleTransitions -= 1 }
            let generation = connectionGeneration
            try await ensureExclusiveWriter()
            guard generation == connectionGeneration else { throw lifecycleChanged() }
            guard let current = client else {
                throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.")
            }
            guard let powerEvents else { throw lifecycleChanged() }
            recordState(powerEvents.stamp(.connecting), generation: generation)
            await current.reconnectNow()
            guard !terminalShutdown, generation == connectionGeneration, client === current else {
                await current.stop()
                throw lifecycleChanged()
            }
            return await snapshot()

        case "station_forget":
            try requireKeys(params, allowed: ["provider", "base_url"])
            let endpoint = try Self.validatedURL(params["base_url"])
            try beginLifecycleTransition()
            defer { lifecycleTransitions -= 1 }
            if endpoint == baseURL, client != nil {
                await shutdown()
            }
            try requireActive()
            try StationAgentKeychain(endpoint: endpoint, radioID: radioID).delete()
            credentialCache.invalidate(endpoint: endpoint)
            return ["forgotten": true]

        case "station_configuration":
            try requireKeys(params, allowed: ["provider"])
            let generation = connectionGeneration
            guard let current = client else {
                throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.")
            }
            do {
                let data = try await current.fetchConfigurationData()
                guard generation == connectionGeneration, client === current else { throw lifecycleChanged() }
                guard data.count <= 32_768,
                      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw WorkerFailure("station_protocol", "Station configuration is too large or invalid.")
                }
                return ["source": "direct_agent", "configuration": object]
            } catch let failure as WorkerFailure {
                throw failure
            } catch {
                throw WorkerFailure("station_unavailable", "Station configuration is unavailable.")
            }

        case "station_configuration_save":
            try requireKeys(params, allowed: ["provider", "configuration"])
            try beginLifecycleTransition()
            defer { lifecycleTransitions -= 1 }
            let generation = connectionGeneration
            try await ensureExclusiveWriter()
            guard generation == connectionGeneration else { throw lifecycleChanged() }
            guard let current = client,
                  let object = params["configuration"] as? [String: Any],
                  JSONSerialization.isValidJSONObject(object),
                  let data = try? JSONSerialization.data(withJSONObject: object),
                  data.count <= 32_768,
                  (try? JSONDecoder().decode(RemoteStationConfiguration.self, from: data)) != nil else {
                throw Self.invalidParams()
            }
            do {
                let encoded = try await current.saveConfigurationData(data)
                guard generation == connectionGeneration, client === current else { throw lifecycleChanged() }
                guard encoded.count <= 32_768,
                      let result = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] else {
                    throw WorkerFailure("station_protocol", "Saved station configuration is invalid.")
                }
                return ["saved": true, "configuration": result]
            } catch let failure as WorkerFailure {
                throw failure
            } catch {
                throw WorkerFailure("station_rejected", "The Remote Station Agent rejected the configuration.")
            }

        case "station_radio_control":
            return try await radioControl(params)

        case "station_rotor_snapshot", "station_rotor_connect", "station_rotor_disconnect",
             "station_rotor_goto", "station_rotor_stop":
            var result = try await rotor.handle(method, params: params)
            if method == "station_rotor_snapshot" { return result }
            if method == "station_rotor_connect" || method == "station_rotor_disconnect" {
                return await snapshot()
            }
            result["state"] = await snapshot()
            return result

        case "station_add_spot":
            try requireKeys(params, allowed: ["provider", "spot"])
            guard let payload = params["spot"] as? [String: Any],
                  Set(payload.keys) == ["frequency_hz", "callsign", "mode", "source", "spotter",
                                        "comment", "timestamp", "lifetime_seconds", "priority", "color_hex"],
                  let frequency = try Self.integer(payload["frequency_hz"]), (100_000...60_000_000).contains(frequency),
                  let timestamp = try Self.integer(payload["timestamp"]),
                  timestamp >= Int64(Date().timeIntervalSince1970) - 86_400,
                  timestamp <= Int64(Date().timeIntervalSince1970) + 300,
                  let lifetime = try Self.integer(payload["lifetime_seconds"]), (30...86_400).contains(lifetime),
                  let priority = try Self.integer(payload["priority"]), (1...5).contains(priority),
                  let callsign = Self.spotText(payload["callsign"], maximum: 32, required: true),
                  let mode = Self.spotText(payload["mode"], maximum: 16, required: true),
                  let source = Self.spotText(payload["source"], maximum: 32, required: true),
                  let spotter = Self.spotText(payload["spotter"], maximum: 32, required: false),
                  let comment = Self.spotText(payload["comment"], maximum: 96, required: false),
                  let color = payload["color_hex"] as? String,
                  color.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil,
                  let spot = try? FlexSpot(frequencyHz: frequency, callsign: callsign, mode: mode,
                                           source: source, spotter: spotter, comment: comment,
                                           timestamp: timestamp, lifetimeSeconds: Int(lifetime),
                                           priority: Int(priority), colorHex: color) else { throw Self.invalidParams() }
            try await ensureExclusiveWriter()
            guard let client else { throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.") }
            let observed = await client.observedSnapshot()
            try requireActive()
            guard observed.isConnected,
                  observed.remoteStationStatus?.supportedCommands.contains("add_spot") == true else {
                throw WorkerFailure("station_action_blocked", "The agent does not advertise FLEX spot forwarding.")
            }
            do {
                try await client.addSpot(spot)
                return ["accepted": true, "confirmed": false, "action": "add_spot",
                        "source": "direct_agent", "state": await snapshot()]
            } catch {
                throw WorkerFailure("station_rejected", "The Remote Station Agent rejected the FLEX spot.")
            }

        case "station_remove_spot":
            try requireKeys(params, allowed: ["provider", "callsign", "frequency_hz"])
            guard let frequency = try Self.integer(params["frequency_hz"]),
                  (100_000...60_000_000).contains(frequency),
                  let callsign = Self.spotText(params["callsign"], maximum: 32, required: true) else {
                throw Self.invalidParams()
            }
            try await ensureExclusiveWriter()
            guard let client else { throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.") }
            let observed = await client.observedSnapshot()
            try requireActive()
            guard observed.isConnected,
                  observed.remoteStationStatus?.supportedCommands.contains("remove_spot") == true else {
                throw WorkerFailure("station_action_blocked", "The agent does not advertise FLEX spot removal.")
            }
            do {
                try await client.removeSpot(callsign: callsign, frequencyHz: frequency)
                return ["accepted": true, "confirmed": false, "action": "remove_spot",
                        "source": "direct_agent", "state": await snapshot()]
            } catch {
                throw WorkerFailure("station_rejected", "The Remote Station Agent rejected FLEX spot removal.")
            }

        default:
            throw WorkerFailure("method_not_allowed", "Station method is not available.")
        }
    }

    func snapshot() async -> [String: Any] {
        reconcilePowerObservationSession()
        let generation = connectionGeneration
        let sessionID = powerSessionID
        let currentClient = client
        let rotorProjection = await rotor.projection()
        reconcilePowerObservationSession()
        guard generation == connectionGeneration, sessionID == powerSessionID,
              self.client === currentClient else { return await snapshot() }
        guard let client else {
            return ["source": "direct_agent", "available": false, "generation": generation,
                    "transport_state": RadioConnectionState.stopped.rawValue,
                    "radio": NSNull(), "station": NSNull(), "rotor": rotorProjection,
                    "measured_tx_power": NSNull(), "power_session_id": NSNull(),
                    "power_session_started_at": NSNull(),
                    "propagation": NSNull(), "allow_transmit": false]
        }
        let observed = await client.observedSnapshot()
        reconcilePowerObservationSession()
        guard generation == connectionGeneration, sessionID == powerSessionID,
              self.client === client else { return await snapshot() }
        if carrierCancelAcknowledged, directTransmitAcquisitions == 0, !carrierReleaseUnconfirmed(observed) {
            transmitOwnership.completeAction(.cancel)
            carrierCancelAcknowledged = false
        }
        guiPTT.observe(observed,canRelease:directTransmitAcquisitions == 0)
        var result = Self.project(observed, transport: transportState, allowTransmit: allowTransmit,
                                  generation: generation, powerSessionID: powerSessionID,
                                  powerSessionStartedAt: powerSessionStartedAt)
        result["rotor"] = rotorProjection
        result["ptt"] = guiPTT.ownerID == nil && embeddedCATPTT
            ? ["source":"embedded_cat","owner_id":NSNull(),"release_required":true,"pending":false,"confirmed":false,"transmitting":NSNull()]
            : guiPTT.projection
        result["carrier_tune"] = ["pending": directTransmitAcquisitions > 0,
                                  "release_required": transmitOwnership.releases.contains(.cancelTune) || carrierReleaseUnconfirmed(observed)]
        result["cat_servers"] = ["cat_port": Self.optional(catConfiguration.catPort), "rigctl_port": Self.optional(catConfiguration.rigCtlPort), "allow_transmit": catConfiguration.allowTransmit]
        return result
    }

    /// Used by explicit disconnect and worker EOF; a monitoring session issues
    /// no station commands, while activated controls get a best-effort release.
    func terminate() async {
        terminalShutdown = true
        await shutdown()
    }

    func shutdown() async {
        lifecycleTransitions += 1
        defer { lifecycleTransitions -= 1 }
        connectionGeneration &+= 1
        powerCapture?.detach()
        powerSession = StationPowerSessionState()
        powerEvents = nil
        let current = client
        client = nil
        baseURL = nil
        transportState = .stopped
        allowTransmit = false
        await stopCATServers()
        // Leave most of the desktop host's eight-second EOF grace period for
        // the actual RF release requests. A stalled transmit acquisition must
        // not consume the only opportunity to send PTT-off/CW/tune releases.
        await drainDirectTransmitAcquisitions(for: .seconds(1))
        if let current { await stop(current) }
    }

    private func beginLifecycleTransition() throws {
        guard lifecycleTransitions == 0 else {
            throw WorkerFailure("station_busy", "A station connection or CAT listener change is still finishing. Retry when it completes.")
        }
        lifecycleTransitions += 1
    }

    private func lifecycleChanged() -> WorkerFailure {
        WorkerFailure("station_changed", "The station connection changed during the request. Retry with the current connection.")
    }

    private func stopCATServers() async {
        catListenerEpoch &+= 1
        let previous = catServers
        catServers = nil
        catConfiguration = .init()
        let drain = catRetirement.enqueue { await previous?.stopAndDrain() }
        await drain.value
    }

    func tune(frequencyHz: Int64, mode: String, expectedGeneration: UInt64? = nil) async throws -> [String: Any] {
        if let expectedGeneration, expectedGeneration != connectionGeneration { throw lifecycleChanged() }
        try await ensureExclusiveWriter()
        if let expectedGeneration, expectedGeneration != connectionGeneration { throw lifecycleChanged() }
        reconcilePowerObservationSession()
        guard let client else { throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.") }
        let generation = connectionGeneration
        let sessionID = powerSessionID
        let before = await client.observedSnapshot()
        reconcilePowerObservationSession()
        guard generation == connectionGeneration, sessionID == powerSessionID,
              self.client === client else { throw lifecycleChanged() }
        try requireActive()
        guard before.isConnected, !before.isTransmitting, before.remoteStationStatus?.radioKnown == true,
              before.remoteStationStatus?.radioStale == false else {
            throw WorkerFailure("station_unavailable", "Observed radio state is unavailable.")
        }
        let normalized = Self.radioMode(mode, frequencyHz: frequencyHz)
        let startedAt = Date()
        var tuneError: (any Error)?
        do {
            try await client.tuneSimplex(frequencyHz, mode: normalized)
        } catch {
            reconcilePowerObservationSession()
            guard generation == connectionGeneration, sessionID == powerSessionID,
                  self.client === client else { throw lifecycleChanged() }
            tuneError = error
        }
        reconcilePowerObservationSession()
        guard generation == connectionGeneration, sessionID == powerSessionID,
              self.client === client else { throw lifecycleChanged() }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: receiveReadbackTimeout)
        while clock.now < deadline {
            try Task.checkCancellation()
            let observed = await client.observedSnapshot()
            reconcilePowerObservationSession()
            guard generation == connectionGeneration, sessionID == powerSessionID,
                  self.client === client else { throw lifecycleChanged() }
            try requireActive()
            if Self.exactReceiveConfirmed(observed, after: startedAt, matches: {
                Self.confirmsReceiveTarget($0, frequencyHz: frequencyHz, mode: normalized)
            }) {
                let rotorProjection = await rotor.projection()
                reconcilePowerObservationSession()
                guard generation == connectionGeneration, sessionID == powerSessionID,
                      self.client === client else { throw lifecycleChanged() }
                var result = Self.project(observed, transport: transportState, allowTransmit: allowTransmit,
                                          generation: generation, powerSessionID: sessionID,
                                          powerSessionStartedAt: powerSessionStartedAt)
                result["rotor"] = rotorProjection
                return ["accepted": true, "confirmed": true, "state": result]
            }
            try await Task.sleep(for: .milliseconds(100))
            reconcilePowerObservationSession()
            guard generation == connectionGeneration, sessionID == powerSessionID,
                  self.client === client else { throw lifecycleChanged() }
        }
        if let failure = tuneError as? RemoteAgentCommandFailure {
            throw WorkerFailure(failure.code, failure.message)
        }
        if tuneError != nil {
            throw WorkerFailure("station_rejected", "The Remote Station Agent did not confirm the tune request.")
        }
        throw WorkerFailure("station_timeout", "The radio did not confirm the requested receive target.")
    }

    func action(_ name: String, expectedGeneration: UInt64? = nil, expectedNativeIntent: UInt64? = nil) async throws -> [String: Any] {
        if let expectedGeneration, expectedGeneration != connectionGeneration { throw lifecycleChanged() }
        if let expectedNativeIntent { try carrierIntent.admitNative(expectedNativeIntent) }
        // Cancel must retire a suspended preflight even when no tune obligation
        // exists yet. Its authority to send RF releases is checked separately.
        if name == "cancel" || name == "standby" { carrierIntent.cancel() }
        let intent = name == "tune" || name == "operate" ? carrierIntent.begin() : nil
        guard let client, let action = RemoteStationAction(rawValue: name) else {
            throw WorkerFailure("invalid_params", "Invalid direct station action.")
        }
        try await ensureExclusiveWriter()
        if let intent { try carrierIntent.require(intent) }
        if let expectedGeneration, expectedGeneration != connectionGeneration { throw lifecycleChanged() }
        let generation = connectionGeneration
        let observed = await client.observedSnapshot()
        if let intent { try carrierIntent.require(intent) }
        try requireActive()
        guard generation == connectionGeneration, self.client === client else { throw lifecycleChanged() }
        guard let station = observed.remoteStationStatus,
              Self.allowsAction(action, connected: observed.isConnected, supported: station.supportedCommands, allowed: station.allowedActions,
                                ownsTune: transmitOwnership.releases.contains(.cancelTune)) else {
            throw WorkerFailure("station_action_blocked", "The station does not currently allow this action.")
        }
        if Self.requiresTransmitOptIn(action) {
            guard lifecycleTransitions == 0, allowTransmit, station.inhibitors.isEmpty, station.commissioned,
                  station.radioKnown, !station.radioStale, !observed.isTransmitting,
                  guiPTT.ownerID == nil, transmitOwnership.releases.isEmpty, !carrierReleaseUnconfirmed(observed), observed.transportReceivedAt.map({ Date().timeIntervalSince($0) >= -1 && Date().timeIntervalSince($0) <= 3 }) == true else {
                throw WorkerFailure("station_action_blocked", "Transmit control is not enabled or the station has inhibitors.")
            }
        }
        transmitOwnership.beginAction(action)
        let acquiresTransmit = Self.requiresTransmitOptIn(action)
        if acquiresTransmit { beginDirectTransmitAcquisition() }
        defer { if acquiresTransmit { finishDirectTransmitAcquisition() } }
        if action == .tune || action == .cancel || action == .standby { carrierReadbackAfter = Date() }
        do {
            try await client.performStationAction(action)
            if let intent { try carrierIntent.require(intent) }
            guard generation == connectionGeneration, self.client === client else { throw lifecycleChanged() }
            // An ACK without returned radio state must not reuse an RX stream
            // sample that arrived while the HTTP command was still pending.
            if action == .cancel || action == .standby && transmitOwnership.releases.contains(.cancelTune) { acknowledgeCarrierCancel() }
            else { transmitOwnership.completeAction(action, acquisitionsInFlight: directTransmitAcquisitions > 0) }
            let state = await snapshot()
            if let intent { try carrierIntent.require(intent) }
            guard generation == connectionGeneration, self.client === client else { throw lifecycleChanged() }
            return ["accepted": true, "confirmed": false, "action": name, "state": state]
        } catch {
            if let failure = error as? RemoteAgentCommandFailure { throw WorkerFailure(failure.code, failure.message) }
            if let failure = error as? WorkerFailure { throw failure }
            throw WorkerFailure("station_rejected", "The Remote Station Agent rejected the action.")
        }
    }

    static func requiresTransmitOptIn(_ action: RemoteStationAction) -> Bool {
        action == .tune
    }
    private func carrierReleaseUnconfirmed(_ observed: XCatIntegrationCore.RadioSnapshot) -> Bool {
        guard let after = carrierReadbackAfter else { return false }
        return !Self.carrierReleaseObserved(observed, after: after)
    }
    private func acknowledgeCarrierCancel() {
        carrierReadbackAfter = Date()
        // Keep explicit Cancel/shutdown release authority until a later RX
        // observation proves this ACK retired the owned carrier. An older
        // outstanding HTTP acquisition requires another explicit Cancel.
        carrierCancelAcknowledged = directTransmitAcquisitions == 0
    }
    static func carrierReleaseObserved(_ observed: XCatIntegrationCore.RadioSnapshot, after: Date) -> Bool {
        observed.isConnected && observed.transportReceivedAt.map { $0 > after } == true && !observed.isTransmitting
            && observed.remoteStationStatus?.radioKnown == true && observed.remoteStationStatus?.radioStale == false
    }
    static func allowsAction(_ action: RemoteStationAction, connected: Bool, supported: Set<String>, allowed: Set<String>, ownsTune: Bool = false) -> Bool {
        // beginAction(.tune) acquires this authority before dispatch, so an
        // uncertain tune reply remains releasable. A replacement worker or a
        // monitoring-only connection never gains authority over another TX.
        supported.contains("station_\(action.rawValue)") && (action == .cancel ? ownsTune : action == .standby || connected && allowed.contains(action.rawValue))
    }

    private func radioControl(_ params: [String: Any]) async throws -> [String: Any] {
        if params["control"] as? String == "ptt", params["source"] as? String == "gui" { return try await guiPTTControl(params) }
        try requireKeys(params, allowed: ["provider", "control", "enabled", "offset_hz", "vfo",
                                         "watts", "words_per_minute", "text", "frequency_hz", "mode", "expected_generation"])
        let generation = connectionGeneration
        if let raw = params["expected_generation"] {
            guard let expected = try Self.integer(raw), expected >= 0, UInt64(expected) == generation else { throw lifecycleChanged() }
        }
        guard let control = params["control"] as? String else { throw Self.invalidParams() }
        let command: (RemoteAgentClient) async throws -> Void
        let advertised: String
        var exactReceive: ((XCatIntegrationCore.RadioSnapshot) -> Bool)?
        var needsTransmitOptIn = false
        switch control {
        case "set_rit", "set_xit":
            guard let enabled = try Self.boolean(params["enabled"]),
                  let offset = try Self.integer(params["offset_hz"]),
                  (-9_999...9_999).contains(offset),
                  params["watts"] == nil, params["text"] == nil,
                  params["frequency_hz"] == nil else { throw Self.invalidParams() }
            let vfo = try Self.vfo(params["vfo"])
            advertised = control
            if control == "set_rit" {
                command = { try await $0.setRIT(enabled: enabled, offsetHz: Int(offset), vfo: vfo) }
            } else {
                command = { try await $0.setXIT(enabled: enabled, offsetHz: Int(offset), vfo: vfo) }
            }
        case "set_rf_power":
            guard let watts = try Self.integer(params["watts"]), (1...100).contains(watts) else { throw Self.invalidParams() }
            advertised = control
            command = { try await $0.setRFPower(Int(watts)) }
        case "set_receive_vfo":
            guard let vfo = try Self.vfo(params["vfo"]) else { throw Self.invalidParams() }
            advertised = control
            command = { try await $0.setReceiveVFO(vfo == "A" ? 0 : 1) }
        case "set_split":
            guard let enabled = try Self.boolean(params["enabled"]) else { throw Self.invalidParams() }
            advertised = control
            command = { try await $0.setSplitTransmit(enabled) }
        case "set_cw_speed":
            guard let speed = try Self.integer(params["words_per_minute"]), (5...100).contains(speed) else { throw Self.invalidParams() }
            advertised = control
            command = { try await $0.setCWSpeed(Int(speed)) }
        case "set_frequency_a", "set_frequency_b":
            guard let frequency = try Self.integer(params["frequency_hz"]),
                  (100_000...1_000_000_000).contains(frequency) else { throw Self.invalidParams() }
            advertised = "set_frequency_hz"
            command = control == "set_frequency_a"
                ? { try await $0.setPrimaryFrequency(frequency) }
                : { try await $0.setSecondaryFrequency(frequency) }
        case "set_receive_frequency_a":
            guard let frequency = try Self.integer(params["frequency_hz"]),
                  (100_000...1_000_000_000).contains(frequency) else { throw Self.invalidParams() }
            advertised = "set_frequency_hz"
            command = { try await $0.setPrimaryFrequency(frequency) }
            exactReceive = { $0.vfo("A")?.frequencyHz == frequency }
        case "set_mode":
            guard let mode = try Self.mode(params["mode"]) else { throw Self.invalidParams() }
            advertised = control
            command = { try await $0.setMode(mode) }
        case "set_receive_mode_a":
            guard let mode = try Self.mode(params["mode"]) else { throw Self.invalidParams() }
            advertised = "set_mode"
            command = { try await $0.setPrimaryMode(mode) }
            exactReceive = { $0.vfo("A")?.mode.uppercased() == mode }
        case "ptt":
            guard let enabled = try Self.boolean(params["enabled"]) else { throw Self.invalidParams() }
            if !enabled { carrierIntent.cancel() }
            advertised = "set_ptt"
            needsTransmitOptIn = enabled
            command = { try await $0.setTransmit(enabled) }
        case "send_cw":
            guard let text = params["text"] as? String, (1...128).contains(text.utf8.count),
                  !text.contains("|"),
                  text.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw Self.invalidParams() }
            advertised = control
            needsTransmitOptIn = true
            command = { try await $0.sendCW(text) }
        case "clear_cw":
            advertised = control
            command = { try await $0.clearCW() }
        default:
            throw Self.invalidParams()
        }
        try await ensureExclusiveWriter()
        guard let client else { throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.") }
        let observed = await client.observedSnapshot()
        try requireActive()
        guard generation == connectionGeneration, self.client === client else { throw lifecycleChanged() }
        guard let station = observed.remoteStationStatus,
              station.supportedCommands.contains(advertised),
              observed.isConnected || (control == "ptt" && !needsTransmitOptIn) || control == "clear_cw" else {
            throw WorkerFailure("station_action_blocked", "The radio does not currently support this control.")
        }
        if exactReceive != nil {
            guard station.radioKnown, !station.radioStale, !observed.isTransmitting,
                  observed.vfo("A")?.isReceive == true else {
                throw WorkerFailure("station_action_blocked", "A fresh receive/PTT-off VFO-A observation is required.")
            }
        }
        if needsTransmitOptIn {
            guard lifecycleTransitions == 0, allowTransmit, station.inhibitors.isEmpty, station.commissioned,
                  station.radioKnown, !station.radioStale else {
                throw WorkerFailure("station_action_blocked", "Transmit control is not enabled or the station is not ready.")
            }
        }
        transmitOwnership.beginControl(control, enabled: needsTransmitOptIn)
        if needsTransmitOptIn { beginDirectTransmitAcquisition() }
        defer { if needsTransmitOptIn { finishDirectTransmitAcquisition() } }
        let startedAt = Date()
        do {
            try await command(client)
            guard generation == connectionGeneration, self.client === client else { throw lifecycleChanged() }
        } catch {
            throw WorkerFailure("station_rejected", "The Remote Station Agent rejected the radio control.")
        }
        if let exactReceive {
            _ = try await waitForExactReceive(client, generation: generation, after: startedAt,
                                              matches: exactReceive)
        }
        transmitOwnership.completeControl(control, enabled: needsTransmitOptIn)
        return ["accepted": true, "confirmed": exactReceive != nil, "control": control, "state": await snapshot()]
    }

    private func guiPTTControl(_ params:[String:Any]) async throws -> [String:Any] {
        try requireKeys(params,allowed:["provider","control","enabled","source","ptt_owner_id","expected_generation","expected_native_intent"])
        guard params["source"] as? String == "gui", let on=try Self.boolean(params["enabled"]),
              let id=params["ptt_owner_id"] as? String, UUID(uuidString:id) != nil,
              let raw=params["expected_generation"],let expected=try Self.integer(raw),expected>=0,UInt64(expected)==connectionGeneration,
              let token=try Self.integer(params["expected_native_intent"]),(1...9_007_199_254_740_991).contains(token) else {throw lifecycleChanged()}
        try carrierIntent.admitNative(UInt64(token));if !on{carrierIntent.cancel()}
        let intent=on ? carrierIntent.begin() : nil
        guard let client else{throw WorkerFailure("station_unavailable","No retained Agent connection")}
        let generation=connectionGeneration
        if on{try await ensureExclusiveWriter()};if let intent{try carrierIntent.require(intent)}
        let observed=await client.observedSnapshot();if let intent{try carrierIntent.require(intent)}
        guard generation==connectionGeneration,self.client===client,let station=observed.remoteStationStatus,
              station.supportedCommands.contains("set_ptt") else{throw lifecycleChanged()}
        if on {
            guard lifecycleTransitions==0,allowTransmit,observed.isConnected,!observed.isTransmitting,
                  station.commissioned,station.radioKnown,!station.radioStale,station.inhibitors.isEmpty,
                  transmitOwnership.releases.isEmpty,!carrierReleaseUnconfirmed(observed),
                  observed.transportReceivedAt.map({(-1...3).contains(Date().timeIntervalSince($0))})==true else {
                throw WorkerFailure("station_action_blocked","PTT on requires fresh idle station readiness and consent")
            }
        }
        let owned=guiPTT.ownerID==id
        try guiPTT.begin(id,on:on)
        if on{beginDirectTransmitAcquisition()};defer{if on{finishDirectTransmitAcquisition();guiPTT.retireAcquisition()}}
        do {
            // A release delivered before its older acquisition only retires its
            // token; it never sends PTT-off against CAT/Tune/CW or another TX.
            if on || owned {try await client.setGUIPTT(on)}
            if let intent{try carrierIntent.require(intent)}
            guard generation==connectionGeneration,self.client===client else{throw lifecycleChanged()}
            guiPTT.acknowledged(on:on)
            return ["accepted":true,"confirmed":false,"control":"ptt","enabled":on,"owner_id":id,"state":await snapshot()]
        }catch{throw WorkerFailure("station_rejected","GUI PTT outcome unknown; owned release duty retained")}
    }

    private func waitForExactReceive(_ current: RemoteAgentClient, generation: UInt64, after startedAt: Date,
                                     matches: @escaping (XCatIntegrationCore.RadioSnapshot) -> Bool) async throws -> XCatIntegrationCore.RadioSnapshot {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: receiveReadbackTimeout)
        while clock.now < deadline {
            try Task.checkCancellation()
            let observed = await current.observedSnapshot()
            reconcilePowerObservationSession()
            guard generation == connectionGeneration, client === current else { throw lifecycleChanged() }
            try requireActive()
            if Self.exactReceiveConfirmed(observed, after: startedAt, matches: matches) {
                return observed
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw WorkerFailure("station_timeout", "The Agent did not confirm the requested receive VFO-A state.")
    }

    static func exactReceiveConfirmed(_ observed: XCatIntegrationCore.RadioSnapshot, after startedAt: Date,
                                      matches: (XCatIntegrationCore.RadioSnapshot) -> Bool) -> Bool {
        observed.isConnected && observed.transportReceivedAt.map { $0 > startedAt } == true
            && observed.remoteStationStatus?.radioKnown == true
            && observed.remoteStationStatus?.radioStale == false
            && !observed.isTransmitting && observed.vfo("A")?.isReceive == true && matches(observed)
    }

    private func recordState(_ event: StationPowerSessionEvent, generation: UInt64) {
        guard client != nil, generation == connectionGeneration, powerSession.apply(event) else { return }
        if let powerEvents {
            powerCapture?.connection(sourceID: powerEvents.id, sequence: event.sequence,
                sessionID: event.sessionID, startedAt: event.startedAt, ready: event.state == .ready)
        }
        transportState = event.state
    }

    private func reconcilePowerObservationSession() {
        guard client != nil, let powerEvents,
              let state = powerSession.reconcile(powerEvents) else { return }
        transportState = state
    }

    private func beginDirectTransmitAcquisition() {
        directTransmitAcquisitions += 1
    }

    private func finishDirectTransmitAcquisition() {
        precondition(directTransmitAcquisitions > 0)
        directTransmitAcquisitions -= 1
        guard directTransmitAcquisitions == 0 else { return }
    }

    private func drainDirectTransmitAcquisitions(for budget: Duration) async {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: budget)
        while directTransmitAcquisitions > 0, clock.now < deadline {
            do { try await Task.sleep(for: .milliseconds(25)) }
            catch { return }
        }
    }

    private func stop(_ current: RemoteAgentClient) async {
        var releases = transmitOwnership.releases
        if guiPTT.ownerID != nil && !releases.contains(.releasePTT) {releases.append(.releasePTT)}
        guiPTT = StationGUIPTT()
        embeddedCATPTT = false
        transmitOwnership = StationTransmitOwnership()
        // Attempt every owned release immediately: a stalled CW/cancel reply
        // must not delay PTT-off. The desktop bounds graceful EOF to eight
        // seconds; crashes or missing acknowledgments cannot confirm RF safety.
        await withTaskGroup(of: Void.self) { group in
            for release in releases {
                group.addTask {
                    switch release {
                    case .clearCW: try? await current.shutdownClearCW()
                    case .cancelTune: try? await current.shutdownCancelTune()
                    case .releasePTT: try? await current.shutdownReleasePTT()
                    }
                }
            }
        }
        await current.stop()
    }

    private func authorizeCATMutation(_ mutation: EmbeddedCATServers.Mutation, generation: UInt64, epoch: UInt64) async -> Bool {
        guard !terminalShutdown, generation == connectionGeneration, let client else { return false }
        switch mutation {
        case .transmit(false), .stationAction(.cancel):
            carrierIntent.cancel()
            if transmitOwnership.releases.contains(.cancelTune) { carrierReadbackAfter = Date() }
        default: break
        }
        let observed = await client.observedSnapshot()
        guard !terminalShutdown, generation == connectionGeneration, self.client === client,
              let station = observed.remoteStationStatus else { return false }
        // A release remains available even if freshness/commissioning changed.
        switch mutation {
        case .transmit(false): return guiPTT.ownerID == nil && station.supportedCommands.contains("set_ptt")
        case .clearCW: return station.supportedCommands.contains("clear_cw")
        case .stationAction(.cancel): return transmitOwnership.releases.contains(.cancelTune)
        default: break
        }
        guard epoch == catListenerEpoch, observed.isConnected, station.radioKnown, !station.radioStale else { return false }
        let command: String
        var needsTX = false
        switch mutation {
        case .primaryFrequency, .frequency, .secondaryFrequency: command = "set_frequency_hz"
        case .frequencyAndMode, .tuneSimplex: command = "tune_simplex"
        case .mode: command = "set_mode"
        case .splitTransmit: command = "set_split"
        case .receiveVFO: command = "set_receive_vfo"
        case .cwSpeed: command = "set_cw_speed"
        case .sendCW: command = "send_cw"; needsTX = true
        case .clearCW: command = "clear_cw"
        case .transmit: command = "set_ptt"; needsTX = true
        case .transmitMode(let mode): command = mode == .tune ? "station_tune" : "set_ptt"; needsTX = true
        case .rit: command = "set_rit"
        case .xit: command = "set_xit"
        case .rfPower: command = "set_rf_power"
        case .stationAction(let action):
            guard station.allowedActions.contains(action.rawValue) else { return false }
            command = "station_\(action.rawValue)"; needsTX = action != .standby && action != .cancel
        case .namedStationAction: return false
        case .addSpot: command = "add_spot"
        }
        guard station.supportedCommands.contains(command) else { return false }
        if needsTX {
            guard guiPTT.ownerID == nil, lifecycleTransitions == 0, allowTransmit, catConfiguration.allowTransmit,
                  station.commissioned, station.inhibitors.isEmpty else { return false }
        }
        switch mutation {
        case .sendCW: transmitOwnership.beginControl("send_cw")
        case .transmit(true): embeddedCATPTT=true;transmitOwnership.beginControl("ptt", enabled: true)
        case .transmitMode(let mode):
            if mode == .tune { transmitOwnership.beginAction(.tune) }
            else { embeddedCATPTT=true;transmitOwnership.beginControl("ptt", enabled: true) }
        case .stationAction(let action): transmitOwnership.beginAction(action)
        default: break
        }
        return true
    }

    private func completeCATMutation(_ mutation: EmbeddedCATServers.Mutation, generation: UInt64) async {
        guard generation == connectionGeneration else { return }
        switch mutation {
        case .clearCW: transmitOwnership.completeControl("clear_cw")
        case .transmit(false):
            embeddedCATPTT=false
            if transmitOwnership.releases.contains(.cancelTune), let client {
                do { try await client.performStationAction(.cancel); acknowledgeCarrierCancel() } catch { }
            }
            transmitOwnership.completeControl("ptt", enabled: false)
        case .stationAction(let action):
            if action == .cancel { acknowledgeCarrierCancel() }
            else { transmitOwnership.completeAction(action, acquisitionsInFlight: directTransmitAcquisitions > 0) }
        default: break
        }
    }

    private func ensureExclusiveWriter() async throws {
        try requireActive()
        let companionAppRunning = await MainActor.run {
            !NSRunningApplication.runningApplications(withBundleIdentifier: "com.oliverbross.OM0RXXCat").isEmpty
        }
        try requireActive()
        let ownedPorts = Set([catConfiguration.catPort, catConfiguration.rigCtlPort].compactMap { $0 })
        guard !companionAppRunning, !Self.companionListenerActive(excluding: ownedPorts) else {
            throw WorkerFailure("station_owner_conflict", "Stop the standalone xCat radio owner before direct station control.")
        }
    }

    private func requireActive() throws {
        guard !terminalShutdown else {
            throw WorkerFailure("worker_stopping", "The station service is shutting down; no new station command was started.")
        }
    }

    /// A TCP connect probe sends no CAT/RigCtlD bytes and cannot command a radio.
    private static func companionListenerActive(excluding ownedPorts: Set<UInt16>) -> Bool {
        for port in [UInt16(14_532), 4_532, 15_002, 5_002] where !ownedPorts.contains(port) {
            let descriptor = socket(AF_INET, SOCK_STREAM, 0)
            guard descriptor >= 0 else { return true }
            defer { close(descriptor) }
            var timeout = timeval(tv_sec: 0, tv_usec: 200_000)
            _ = setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout,
                           socklen_t(MemoryLayout<timeval>.size))
            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = port.bigEndian
            _ = inet_pton(AF_INET, "127.0.0.1", &address.sin_addr)
            let result = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            if result == 0 { return true }
        }
        return false
    }

    static func validatedURL(_ value: Any?) throws -> String {
        guard let raw = value as? String, (1...2_048).contains(raw.utf8.count),
              var components = URLComponents(string: raw),
              components.scheme?.lowercased() == "https",
              components.host?.isEmpty == false,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else { throw invalidParams() }
        while components.path.count > 1 && components.path.hasSuffix("/") { components.path.removeLast() }
        guard let result = components.url?.absoluteString else { throw invalidParams() }
        return result
    }

    static func validatedRotorHost(_ value: Any?) throws -> String {
        guard let raw = value as? String else { throw invalidParams() }
        let host = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...253).contains(host.utf8.count),
              !host.contains(where: { $0.isWhitespace || $0.isNewline }),
              !host.contains("/"), !host.contains("@"), !host.contains(":") else { throw invalidParams() }
        return host
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed), params["provider"] as? String == "direct_agent" else {
            throw Self.invalidParams()
        }
    }

    private static func invalidParams() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid direct station parameters.")
    }

    private static func boolean(_ value: Any?) throws -> Bool? {
        guard let value else { return nil }
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else { throw invalidParams() }
        return number.boolValue
    }

    private static func integer(_ value: Any?) throws -> Int64? {
        guard let value else { return nil }
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(Int64.min),
              number.doubleValue < Double(Int64.max) else { throw invalidParams() }
        return number.int64Value
    }

    private static func vfo(_ value: Any?) throws -> String? {
        guard let value else { return nil }
        guard let vfo = value as? String, vfo == "A" || vfo == "B" else { throw invalidParams() }
        return vfo
    }

    private static func mode(_ value: Any?) throws -> String? {
        guard let value else { return nil }
        guard let mode = value as? String, (1...12).contains(mode.utf8.count),
              mode.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) }) else {
            throw invalidParams()
        }
        return mode
    }

    private static func spotText(_ value: Any?, maximum: Int, required: Bool) -> String? {
        guard let text = value as? String, text.utf8.count <= maximum,
              (!required || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
              text.unicodeScalars.allSatisfy({ (32...126).contains($0.value) && $0 != "|" }) else { return nil }
        return text
    }

    private static func radioMode(_ mode: String, frequencyHz: Int64) -> String {
        switch mode {
        case "SSB": frequencyHz < 10_000_000 ? "LSB" : "USB"
        case "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI": "DIGU"
        default: mode
        }
    }

    static func confirmsSimplex(_ observed: XCatIntegrationCore.RadioSnapshot,
                                frequencyHz: Int64, mode: String) -> Bool {
        observed.isConnected && !observed.isTransmitting && observed.frequencyHz == frequencyHz
            && observed.transmitFrequencyHz == frequencyHz
            && observed.mode.uppercased() == mode
            && observed.slice.uppercased() == "A"
            && observed.transmitSlice.uppercased() == "A"
            && observed.vfo("A")?.isReceive == true
            && observed.vfo("A")?.isTransmit == true
    }

    static func confirmsReceiveTarget(_ observed: XCatIntegrationCore.RadioSnapshot,
                                      frequencyHz: Int64, mode: String) -> Bool {
        observed.frequencyHz == frequencyHz && observed.mode.uppercased() == mode
    }

    static func project(_ observed: XCatIntegrationCore.RadioSnapshot,
                        transport: RadioConnectionState, allowTransmit: Bool,
                        generation: UInt64, powerSessionID: UUID,
                        powerSessionStartedAt: Date?, now: Date = Date()) -> [String: Any] {
        let radio: Any = observed.isConnected ? [
            "observed": true, "connected": true, "frequency_hz": observed.frequencyHz,
            "mode": observed.mode, "receive_frequency_hz": observed.frequencyHz,
            "transmit_frequency_hz": observed.transmitFrequencyHz,
            "receive_vfo": observed.slice, "transmit_vfo": observed.transmitSlice,
            "split": observed.slice != observed.transmitSlice || observed.frequencyHz != observed.transmitFrequencyHz,
            "transmitting": observed.isTransmitting,
            "observed_at": optional(observed.agentObservedAt?.timeIntervalSince1970),
            "received_at": optional(observed.transportReceivedAt?.timeIntervalSince1970),
            "vfos": observed.vfos.map { vfo in
                ["letter": vfo.letter, "frequency_hz": vfo.frequencyHz, "mode": vfo.mode,
                 "receive": vfo.isReceive, "transmit": vfo.isTransmit,
                 "rit_enabled": vfo.ritEnabled, "rit_offset_hz": vfo.ritOffsetHz,
                 "xit_enabled": vfo.xitEnabled, "xit_offset_hz": vfo.xitOffsetHz] as [String: Any]
            }
        ] as [String: Any] : NSNull()
        let station: Any = observed.remoteStationStatus.map { value in
            ["available": observed.isConnected, "commissioned": value.commissioned,
             "radio_known": value.radioKnown, "radio_stale": value.radioStale,
             "station_bound": value.stationBound, "coordinator_state": value.coordinatorState,
             "supported_commands": Array(value.supportedCommands).sorted(),
             "allowed_actions": Array(value.allowedActions).sorted(), "inhibitors": value.inhibitors,
             "kpa_operate": optional(value.kpaOperate), "band": value.band,
             "route_alignment": value.routeAlignment, "interlock_state": value.interlockState,
             "tx_power_watts": optional(value.txPowerWatts), "swr": optional(value.swr),
             "swr_is_live": value.swrIsLive, "rf_drive_watts": optional(observed.rfPowerWatts),
             "kpa_detail_primary": value.kpaDetailPrimary, "kpa_detail_secondary": value.kpaDetailSecondary,
             "kat_detail_primary": value.katDetailPrimary, "kat_detail_secondary": value.katDetailSecondary,
             "route_detail": value.routeDetail, "alarm_summary": value.alarmSummary,
             "alarm_messages": value.alarmMessages] as [String: Any]
        } ?? NSNull()
        let measuredPower: Any
        if transport == .ready, observed.isConnected, observed.isTransmitting,
           let observation = observed.measuredTransmitPower, let powerSessionStartedAt,
           observation.isFresh(at: now, sessionStartedAt: powerSessionStartedAt) {
            measuredPower = ["source": observation.source.rawValue,
                             "measurement_point": observation.source == .radioOutput ? "radio_output" : "amplifier_output",
                             "unit": "W", "watts": observation.watts,
                             "observed_at": observation.observedAt.timeIntervalSince1970,
                             "radio_observed_at": observation.radioObservedAt.timeIntervalSince1970,
                             "amplifier_observed_at": observation.amplifierObservedAt.timeIntervalSince1970,
                             "received_at": observation.receivedAt.timeIntervalSince1970,
                             "session_id": powerSessionID.uuidString,
                             "session_started_at": powerSessionStartedAt.timeIntervalSince1970,
                             "generation": generation] as [String: Any]
        } else {
            measuredPower = NSNull()
        }
        return ["source": "direct_agent", "available": observed.isConnected, "generation": generation,
                "transport_state": transport.rawValue, "generated_at": now.timeIntervalSince1970,
                "radio": radio, "station": station, "rotor": NSNull(),
                "measured_tx_power": measuredPower,
                "power_session_id": optional(powerSessionStartedAt.map { _ in powerSessionID.uuidString }),
                "power_session_started_at": optional(powerSessionStartedAt?.timeIntervalSince1970),
                "propagation": NSNull(), "allow_transmit": allowTransmit]
    }

    private static func optional<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }
}

private struct StationAgentKeychain {
    private let service = "com.oliverbross.OM0RXXLog.remote-agent"
    private let account: String
    private let legacyAccount: String?

    init(endpoint: String, radioID: String) {
        let digest = SHA256.hash(data: Data(endpoint.lowercased().utf8))
            .map { String(format: "%02x", $0) }.joined()
        account = radioID + ":" + digest
        legacyAccount = radioID == "radio1" ? digest : nil
    }

    func load(interactionAllowed: Bool) throws -> String? {
        var item: CFTypeRef?
        var status = SecItemCopyMatching(query(returnData: true, interactionAllowed: interactionAllowed) as CFDictionary, &item)
        if status == errSecItemNotFound, let legacyAccount {
            status = SecItemCopyMatching(query(account: legacyAccount, returnData: true, interactionAllowed: interactionAllowed) as CFDictionary, &item)
            if status == errSecSuccess, let data = item as? Data, let token = String(data: data, encoding: .utf8) {
                try save(token)
                return token
            }
        }
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else {
            throw WorkerFailure("station_credentials_unavailable", "Saved station credentials are unavailable.")
        }
        return token
    }

    func save(_ token: String) throws {
        let value = Data(token.utf8)
        let updateStatus = SecItemUpdate(query() as CFDictionary,
                                         [kSecValueData as String: value] as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var fields = query()
            fields[kSecValueData as String] = value
            fields[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(fields as CFDictionary, nil) == errSecSuccess else {
                throw WorkerFailure("station_credentials_unavailable", "Station credentials could not be saved.")
            }
        } else if updateStatus != errSecSuccess {
            throw WorkerFailure("station_credentials_unavailable", "Station credentials could not be saved.")
        }
    }

    func delete() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw WorkerFailure("station_credentials_unavailable", "Station credentials could not be removed.")
        }
        if let legacyAccount {
            let legacyStatus = SecItemDelete(query(account: legacyAccount) as CFDictionary)
            guard legacyStatus == errSecSuccess || legacyStatus == errSecItemNotFound else {
                throw WorkerFailure("station_credentials_unavailable", "Station credentials could not be removed.")
            }
        }
    }

    private func query(account selectedAccount: String? = nil, returnData: Bool = false, interactionAllowed: Bool = false) -> [String: Any] {
        var fields: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                     kSecAttrService as String: service,
                                     kSecAttrAccount as String: selectedAccount ?? account]
        if returnData {
            fields[kSecReturnData as String] = true
            fields[kSecMatchLimit as String] = kSecMatchLimitOne
        }
        if returnData && !interactionAllowed {
            let authentication = LAContext()
            authentication.interactionNotAllowed = true
            fields[kSecUseAuthenticationContext as String] = authentication
        }
        return fields
    }
}
#endif
