#if os(macOS)
import AppKit
import CryptoKit
import Darwin
import Foundation
import Security
import XCatIntegrationCore

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

    mutating func completeAction(_ action: RemoteStationAction) {
        if action == .cancel || action == .standby { tune = false }
    }

    var releases: [Release] {
        (cw ? [.clearCW] : []) + (tune ? [.cancelTune] : [])
            + (ptt || cw || tune ? [.releasePTT] : [])
    }
}

/// Explicitly connected direct Remote Station Agent owner. This uses the same
/// authenticated HTTPS/WSS client and authoritative state decoder as xCat.
actor LiveStationSession {
    static let shared = LiveStationSession()

    private var client: RemoteAgentClient?
    private var baseURL: String?
    private var transportState: RadioConnectionState = .stopped
    private var allowTransmit = false
    private var transmitOwnership = StationTransmitOwnership()
    private var connectionGeneration: UInt64 = 0
    private var rotorClient: DCU1RotatorClient?
    private var rotorState: DCU1RotatorClient.State = .stopped
    private var rotorName = "Rotor"
    private var rotorStatus = "Disconnected"
    private var rotorAzimuth: Double?
    private var rotorObservedAt: Date?
    private var rotorGeneration: UInt64 = 0

    static let methods: Set<String> = ["station_connect", "station_disconnect", "station_reconnect",
                                        "station_forget", "station_configuration", "station_configuration_save",
                                        "station_radio_control", "station_rotor_connect", "station_rotor_disconnect",
                                        "station_rotor_goto", "station_rotor_stop", "station_add_spot"]

    func handle(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        switch method {
        case "station_connect":
            try requireKeys(params, allowed: ["provider", "base_url", "token", "allow_transmit"])
            let endpoint = try Self.validatedURL(params["base_url"])
            let enteredToken = params["token"] as? String
            guard params["token"] == nil || enteredToken != nil else { throw Self.invalidParams() }
            let transmit: Bool
            if let rawTransmit = params["allow_transmit"] {
                guard let value = rawTransmit as? NSNumber,
                      CFGetTypeID(value) == CFBooleanGetTypeID() else { throw Self.invalidParams() }
                transmit = value.boolValue
            } else {
                transmit = false
            }
            let keychain = StationAgentKeychain(endpoint: endpoint)
            let token = try enteredToken?.trimmingCharacters(in: .whitespacesAndNewlines)
                ?? keychain.load()
            guard let token, !token.isEmpty, token.utf8.count <= 4_096 else {
                throw WorkerFailure("station_credentials_required", "Enter a Remote Station Agent token.")
            }
            try await ensureExclusiveWriter()
            let next: RemoteAgentClient
            let generation = connectionGeneration &+ 1
            do {
                next = try RemoteAgentClient(baseURL: endpoint, token: token,
                    onState: { [weak self] state, _ in
                        Task { await self?.recordState(state, generation: generation) }
                    })
            } catch {
                throw WorkerFailure("invalid_params", "Invalid Remote Station Agent connection settings.")
            }
            connectionGeneration = generation
            if let current = client {
                await stop(current)
            }
            client = next
            baseURL = endpoint
            transportState = .connecting
            allowTransmit = transmit
            if enteredToken != nil {
                try keychain.save(token)
            }
            await next.start()
            return await snapshot()

        case "station_disconnect":
            try requireKeys(params, allowed: ["provider"])
            await shutdown()
            return await snapshot()

        case "station_reconnect":
            try requireKeys(params, allowed: ["provider"])
            try await ensureExclusiveWriter()
            guard let current = client else {
                throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.")
            }
            transportState = .connecting
            await current.reconnectNow()
            return await snapshot()

        case "station_forget":
            try requireKeys(params, allowed: ["provider", "base_url"])
            let endpoint = try Self.validatedURL(params["base_url"])
            if endpoint == baseURL, client != nil {
                await shutdown()
            }
            try StationAgentKeychain(endpoint: endpoint).delete()
            return ["forgotten": true]

        case "station_configuration":
            try requireKeys(params, allowed: ["provider"])
            guard let current = client else {
                throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.")
            }
            do {
                let value = try await current.fetchConfiguration()
                let data = try JSONEncoder().encode(value)
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
            try await ensureExclusiveWriter()
            guard let current = client,
                  let object = params["configuration"] as? [String: Any],
                  JSONSerialization.isValidJSONObject(object),
                  let data = try? JSONSerialization.data(withJSONObject: object),
                  data.count <= 32_768,
                  let value = try? JSONDecoder().decode(RemoteStationConfiguration.self, from: data) else {
                throw Self.invalidParams()
            }
            do {
                let saved = try await current.saveConfiguration(value)
                let encoded = try JSONEncoder().encode(saved)
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

        case "station_rotor_connect":
            try requireKeys(params, allowed: ["provider", "host", "port", "name"])
            let host = try Self.validatedRotorHost(params["host"])
            guard let portValue = try Self.integer(params["port"]), (1...65_535).contains(portValue) else { throw Self.invalidParams() }
            let name = (params["name"] as? String ?? "Rotor").trimmingCharacters(in: .whitespacesAndNewlines)
            guard params["name"] == nil || params["name"] is String,
                  (1...64).contains(name.utf8.count) else { throw Self.invalidParams() }
            try await ensureExclusiveWriter()
            stopRotor()
            let generation = rotorGeneration
            rotorName = name
            rotorState = .connecting
            rotorStatus = "Connecting"
            let next = DCU1RotatorClient(host: host, port: UInt16(portValue), pollMilliseconds: 500,
                onState: { [weak self] state, _ in Task { await self?.recordRotorState(state, generation: generation) } },
                onAzimuth: { [weak self] azimuth in Task { await self?.recordRotorAzimuth(azimuth, generation: generation) } })
            rotorClient = next
            next.start()
            return await snapshot()

        case "station_rotor_disconnect":
            try requireKeys(params, allowed: ["provider"])
            stopRotor()
            return await snapshot()

        case "station_rotor_goto":
            try requireKeys(params, allowed: ["provider", "bearing"])
            guard let bearingValue = params["bearing"] as? NSNumber,
                  CFGetTypeID(bearingValue) != CFBooleanGetTypeID(),
                  bearingValue.doubleValue.isFinite,
                  (0...360).contains(bearingValue.doubleValue) else { throw Self.invalidParams() }
            try await ensureExclusiveWriter()
            guard rotorState == .connected, let rotorClient else {
                throw WorkerFailure("station_unavailable", "The rotor is not connected.")
            }
            do {
                try await rotorClient.turn(to: bearingValue.doubleValue)
                return ["accepted": true, "confirmed": false, "action": "rotor_goto", "state": await snapshot()]
            } catch {
                throw WorkerFailure("station_rejected", "The rotor rejected the turn command.")
            }

        case "station_rotor_stop":
            try requireKeys(params, allowed: ["provider"])
            try await ensureExclusiveWriter()
            guard rotorState == .connected, let rotorClient else {
                throw WorkerFailure("station_unavailable", "The rotor is not connected.")
            }
            do {
                try await rotorClient.stopRotation()
                return ["accepted": true, "confirmed": false, "action": "rotor_stop", "state": await snapshot()]
            } catch {
                throw WorkerFailure("station_rejected", "The rotor rejected the stop command.")
            }

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

        default:
            throw WorkerFailure("method_not_allowed", "Station method is not available.")
        }
    }

    func snapshot() async -> [String: Any] {
        guard let client else {
            return ["source": "direct_agent", "available": false,
                    "transport_state": RadioConnectionState.stopped.rawValue,
                    "radio": NSNull(), "station": NSNull(), "rotor": rotorProjection(),
                    "propagation": NSNull(), "allow_transmit": false]
        }
        let observed = await client.observedSnapshot()
        var result = Self.project(observed, transport: transportState, allowTransmit: allowTransmit)
        result["rotor"] = rotorProjection()
        return result
    }

    /// Used by explicit disconnect and worker EOF; a monitoring session issues
    /// no station commands, while activated controls get a best-effort release.
    func shutdown() async {
        connectionGeneration &+= 1
        let current = client
        client = nil
        baseURL = nil
        transportState = .stopped
        allowTransmit = false
        stopRotor()
        if let current { await stop(current) }
    }

    func tune(frequencyHz: Int64, mode: String) async throws -> [String: Any] {
        try await ensureExclusiveWriter()
        guard let client else { throw WorkerFailure("station_unavailable", "Connect to the Remote Station Agent first.") }
        let before = await client.observedSnapshot()
        guard before.isConnected, before.remoteStationStatus?.radioKnown == true,
              before.remoteStationStatus?.radioStale == false else {
            throw WorkerFailure("station_unavailable", "Observed radio state is unavailable.")
        }
        let normalized = Self.radioMode(mode, frequencyHz: frequencyHz)
        let startedAt = Date()
        do {
            try await client.tuneSimplex(frequencyHz, mode: normalized)
        } catch {
            throw WorkerFailure("station_rejected", "The Remote Station Agent rejected the tune.")
        }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(12))
        while clock.now < deadline {
            try Task.checkCancellation()
            let observed = await client.observedSnapshot()
            if observed.transportReceivedAt.map({ $0 > startedAt }) == true,
               Self.confirmsSimplex(observed, frequencyHz: frequencyHz, mode: normalized) {
                var result = Self.project(observed, transport: transportState, allowTransmit: allowTransmit)
                result["rotor"] = rotorProjection()
                return ["accepted": true, "confirmed": true, "state": result]
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw WorkerFailure("station_timeout", "The radio did not confirm the requested simplex target.")
    }

    func action(_ name: String) async throws -> [String: Any] {
        try await ensureExclusiveWriter()
        guard let client, let action = RemoteStationAction(rawValue: name) else {
            throw WorkerFailure("invalid_params", "Invalid direct station action.")
        }
        let observed = await client.observedSnapshot()
        guard observed.isConnected, let station = observed.remoteStationStatus,
              station.supportedCommands.contains("station_\(name)"),
              station.allowedActions.contains(name) else {
            throw WorkerFailure("station_action_blocked", "The station does not currently allow this action.")
        }
        if action != .standby && action != .cancel {
            guard allowTransmit, station.inhibitors.isEmpty else {
                throw WorkerFailure("station_action_blocked", "Transmit control is not enabled or the station has inhibitors.")
            }
        }
        transmitOwnership.beginAction(action)
        do {
            try await client.performStationAction(action)
            transmitOwnership.completeAction(action)
            return ["accepted": true, "confirmed": false, "action": name, "state": await snapshot()]
        } catch {
            throw WorkerFailure("station_rejected", "The Remote Station Agent rejected the action.")
        }
    }

    private func radioControl(_ params: [String: Any]) async throws -> [String: Any] {
        try requireKeys(params, allowed: ["provider", "control", "enabled", "offset_hz", "vfo",
                                         "watts", "words_per_minute", "text", "frequency_hz", "mode"])
        guard let control = params["control"] as? String else { throw Self.invalidParams() }
        let command: (RemoteAgentClient) async throws -> Void
        let advertised: String
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
        case "set_mode":
            guard let mode = try Self.mode(params["mode"]) else { throw Self.invalidParams() }
            advertised = control
            command = { try await $0.setMode(mode) }
        case "ptt":
            guard let enabled = try Self.boolean(params["enabled"]) else { throw Self.invalidParams() }
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
        guard let station = observed.remoteStationStatus,
              station.supportedCommands.contains(advertised),
              observed.isConnected || (control == "ptt" && !needsTransmitOptIn) || control == "clear_cw" else {
            throw WorkerFailure("station_action_blocked", "The radio does not currently support this control.")
        }
        if needsTransmitOptIn {
            guard allowTransmit, station.inhibitors.isEmpty, station.commissioned,
                  station.radioKnown, !station.radioStale else {
                throw WorkerFailure("station_action_blocked", "Transmit control is not enabled or the station is not ready.")
            }
        }
        transmitOwnership.beginControl(control, enabled: needsTransmitOptIn)
        do {
            try await command(client)
            transmitOwnership.completeControl(control, enabled: needsTransmitOptIn)
            return ["accepted": true, "confirmed": false, "control": control, "state": await snapshot()]
        } catch {
            throw WorkerFailure("station_rejected", "The Remote Station Agent rejected the radio control.")
        }
    }

    private func recordState(_ state: RadioConnectionState, generation: UInt64) {
        guard client != nil, generation == connectionGeneration else { return }
        transportState = state
    }

    private func recordRotorState(_ state: DCU1RotatorClient.State, generation: UInt64) {
        guard rotorClient != nil, generation == rotorGeneration else { return }
        rotorState = state
        rotorStatus = state.rawValue.capitalized
        if state != .connected { rotorAzimuth = nil; rotorObservedAt = nil }
    }

    private func recordRotorAzimuth(_ value: Double, generation: UInt64) {
        guard rotorClient != nil, generation == rotorGeneration, rotorState == .connected,
              value.isFinite, (0...360).contains(value) else { return }
        rotorAzimuth = value
        rotorObservedAt = Date()
    }

    private func stopRotor() {
        rotorGeneration &+= 1
        rotorClient?.stop()
        rotorClient = nil
        rotorState = .stopped
        rotorStatus = "Disconnected"
        rotorAzimuth = nil
        rotorObservedAt = nil
    }

    private func rotorProjection() -> [String: Any] {
        ["connected": rotorState == .connected,
         "name": rotorName, "status": rotorStatus,
         "azimuth": Self.optional(rotorAzimuth),
         "observed_at": Self.optional(rotorObservedAt?.timeIntervalSince1970),
         "target_bearing": NSNull(), "target_label": "",
         "moving": NSNull(), "motion_direction": NSNull()]
    }

    private func stop(_ current: RemoteAgentClient) async {
        let releases = transmitOwnership.releases
        transmitOwnership = StationTransmitOwnership()
        // Attempt every owned release immediately: a stalled CW/cancel reply
        // must not delay PTT-off. The desktop bounds graceful EOF to eight
        // seconds; crashes or missing acknowledgments cannot confirm RF safety.
        await withTaskGroup(of: Void.self) { group in
            for release in releases {
                group.addTask {
                    switch release {
                    case .clearCW: try? await current.clearCW()
                    case .cancelTune: try? await current.performStationAction(.cancel)
                    case .releasePTT: try? await current.setTransmit(false)
                    }
                }
            }
        }
        await current.stop()
    }

    private func ensureExclusiveWriter() async throws {
        let companionAppRunning = await MainActor.run {
            !NSRunningApplication.runningApplications(withBundleIdentifier: "com.oliverbross.OM0RXXCat").isEmpty
        }
        guard !companionAppRunning, !Self.companionListenerActive() else {
            throw WorkerFailure("station_owner_conflict", "Stop the standalone xCat radio owner before direct station control.")
        }
    }

    /// A TCP connect probe sends no CAT/RigCtlD bytes and cannot command a radio.
    private static func companionListenerActive() -> Bool {
        for port in [UInt16(14_532), 4_532, 15_002, 5_002] {
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
        case "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI": "DIGU"
        default: mode
        }
    }

    static func confirmsSimplex(_ observed: XCatIntegrationCore.RadioSnapshot,
                                frequencyHz: Int64, mode: String) -> Bool {
        observed.isConnected && observed.frequencyHz == frequencyHz
            && observed.transmitFrequencyHz == frequencyHz
            && observed.mode.uppercased() == mode
            && observed.slice.uppercased() == "A"
            && observed.transmitSlice.uppercased() == "A"
            && observed.vfo("A")?.isReceive == true
            && observed.vfo("A")?.isTransmit == true
    }

    private static func project(_ observed: XCatIntegrationCore.RadioSnapshot,
                                transport: RadioConnectionState, allowTransmit: Bool) -> [String: Any] {
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
        return ["source": "direct_agent", "available": observed.isConnected,
                "transport_state": transport.rawValue, "generated_at": Date().timeIntervalSince1970,
                "radio": radio, "station": station, "rotor": NSNull(),
                "propagation": NSNull(), "allow_transmit": allowTransmit]
    }

    private static func optional<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }
}

private struct StationAgentKeychain {
    private let service = "com.oliverbross.OM0RXXLog.remote-agent"
    private let account: String

    init(endpoint: String) {
        account = SHA256.hash(data: Data(endpoint.lowercased().utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    func load() throws -> String? {
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query(returnData: true) as CFDictionary, &item)
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
    }

    private func query(returnData: Bool = false) -> [String: Any] {
        var fields: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                     kSecAttrService as String: service,
                                     kSecAttrAccount as String: account]
        if returnData {
            fields[kSecReturnData as String] = true
            fields[kSecMatchLimit as String] = kSecMatchLimitOne
        }
        return fields
    }
}
#endif
