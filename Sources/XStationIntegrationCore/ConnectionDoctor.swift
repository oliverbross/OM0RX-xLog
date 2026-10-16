// GPL-3.0-only; Copyright Oliver Bross OM0RX.
import Foundation
import CoreFoundation

/// A passive explanation of a previously retained worker snapshot. This module
/// has no provider, credential store, file, network or command dependencies.
public enum ConnectionDoctor {
    public enum Provider: String, Codable, Sendable { case directAgent = "direct_agent", directFlexLAN = "direct_flex_lan", directTCI = "direct_tci", hamlib, unknown }
    public enum Configuration: String, Codable, Sendable { case unknown, configured, missing, invalid }
    public enum Stage: String, Codable, Sendable { case provider, configuration, connection, freshness, capabilities }
    public enum Status: String, Codable, Sendable { case passed, attention, unknown }
    public enum Transport: String, Codable, Sendable { case stopped, connecting, synchronizing, ready, unknown }
    public enum Freshness: String, Codable, Sendable { case fresh, stale, unavailable, unknown }
    public enum Capability: String, Codable, CaseIterable, Sendable { case observe, tune, ptt, cw, rfPower }
    public enum Reason: String, Codable, Sendable {
        case providerRecognized, providerUnknown, configurationRetained, configurationMissing, configurationInvalid, configurationUnknown
        case connected, connectionPending, disconnected, connectionUnknown
        case observationFresh, observationStale, observationUnavailable, observationTimeUnknown
        case readOnly, capabilitiesAdvertised, capabilitiesUnknown
    }
    public struct Check: Codable, Equatable, Sendable {
        public let stage: Stage
        public let status: Status
        public let reason: Reason
    }

    /// Closed allowlist for a future opt-in support preview. No raw snapshot,
    /// endpoints, identifiers, timestamps, radio values, errors, configuration
    /// payloads, credential references, QSO or log contents can be represented.
    /// Constructing this value does not authorize or perform an export.
    public struct SupportPreview: Encodable, Equatable, Sendable {
        public let schemaVersion: Int
        public let evidence: String
        public let provider: Provider
        public let configuration: Configuration
        public let transport: Transport
        public let freshness: Freshness
        public let readOnly: Bool?
        public let advertisedCapabilities: [Capability]
        public let checks: [Check]

        fileprivate init(provider: Provider, configuration: Configuration, transport: Transport,
                         freshness: Freshness, readOnly: Bool?, capabilities: [Capability], checks: [Check]) {
            schemaVersion = 1
            evidence = "retained-worker-state-only"
            self.provider = provider; self.configuration = configuration; self.transport = transport
            self.freshness = freshness; self.readOnly = readOnly
            advertisedCapabilities = capabilities; self.checks = checks
        }
    }

    /// The caller supplies a value already held in memory, plus the evaluation
    /// time. Do not fetch a session snapshot, load saved configuration or inspect
    /// the vault to call this API. Unknown configuration is deliberately honest:
    /// a connected transport is not proof that persisted configuration is valid.
    /// Capabilities describe advertisements only, never permission to execute.
    public static func project(retainedSnapshot snapshot: [String: Any],
                               configuration: Configuration = .unknown,
                               now: TimeInterval, maximumAge: TimeInterval = 5) -> SupportPreview {
        let provider = (snapshot["source"] as? String).flatMap(Provider.init(rawValue:)) ?? .unknown
        // Unknown providers are not interpreted using another provider's schema.
        guard provider != .unknown else {
            return SupportPreview(provider: .unknown, configuration: .unknown, transport: .unknown,
                                  freshness: .unknown, readOnly: nil, capabilities: [], checks: [
                                    check(.provider, .attention, .providerUnknown),
                                    check(.configuration, .unknown, .configurationUnknown),
                                    check(.connection, .unknown, .connectionUnknown),
                                    check(.freshness, .unknown, .observationTimeUnknown),
                                    check(.capabilities, .unknown, .capabilitiesUnknown)])
        }
        let transport = (snapshot["transport_state"] as? String).flatMap(Transport.init(rawValue:)) ?? .unknown
        let radio = snapshot["radio"] as? [String: Any] ?? [:]
        let station = snapshot["station"] as? [String: Any] ?? [:]
        let capabilities = snapshot["capabilities"] as? [String: Any] ?? [:]
        let readOnly = provider == .directTCI ? true : boolean(capabilities["read_only"])
        let connected = transport == .ready && boolean(snapshot["available"]) == true
            && boolean(radio["connected"]) == true
        let authoritative = boolean(radio["observed"]) == true
            && (provider != .directAgent || boolean(station["radio_known"]) == true)
        let freshness: Freshness
        if !connected || !authoritative {
            freshness = .unavailable
        } else if boolean(station["radio_stale"]) == true {
            freshness = .stale
        } else if let received = number(radio["received_at"]), now.isFinite,
                  maximumAge.isFinite, maximumAge > 0 {
            // Keep the worker's one-second clock-skew tolerance; receipt time,
            // never generated_at/observed_at, is the freshness evidence.
            let age = now - received
            freshness = (-1...maximumAge).contains(age) ? .fresh : .stale
        } else {
            freshness = .unknown
        }
        let commands = (capabilities["supported_commands"] as? [String])
            ?? (station["supported_commands"] as? [String])
        var advertised: [Capability] = []
        if authoritative { advertised.append(.observe) }
        if readOnly != true, let commands {
            if commands.contains("station_tune") { advertised.append(.tune) }
            if commands.contains("ptt") { advertised.append(.ptt) }
            if commands.contains("send_cw") { advertised.append(.cw) }
            if commands.contains("set_rf_power") { advertised.append(.rfPower) }
        }
        let configCheck: Check = switch configuration {
        case .configured: check(.configuration, .passed, .configurationRetained)
        case .missing: check(.configuration, .attention, .configurationMissing)
        case .invalid: check(.configuration, .attention, .configurationInvalid)
        case .unknown: check(.configuration, .unknown, .configurationUnknown)
        }
        let connectionCheck: Check
        if connected { connectionCheck = check(.connection, .passed, .connected) }
        else if transport == .connecting || transport == .synchronizing { connectionCheck = check(.connection, .attention, .connectionPending) }
        else if transport == .unknown { connectionCheck = check(.connection, .unknown, .connectionUnknown) }
        else { connectionCheck = check(.connection, .attention, .disconnected) }
        let freshnessCheck: Check = switch freshness {
        case .fresh: check(.freshness, .passed, .observationFresh)
        case .stale: check(.freshness, .attention, .observationStale)
        case .unavailable: check(.freshness, .attention, .observationUnavailable)
        case .unknown: check(.freshness, .unknown, .observationTimeUnknown)
        }
        return SupportPreview(provider: provider, configuration: configuration, transport: transport,
                              freshness: freshness, readOnly: readOnly, capabilities: advertised, checks: [
                                check(.provider, .passed, .providerRecognized), configCheck, connectionCheck, freshnessCheck,
                                readOnly == true ? check(.capabilities, .passed, .readOnly)
                                    : commands != nil ? check(.capabilities, .passed, .capabilitiesAdvertised)
                                    : check(.capabilities, .unknown, .capabilitiesUnknown)])
    }

    private static func check(_ stage: Stage, _ status: Status, _ reason: Reason) -> Check {
        Check(stage: stage, status: status, reason: reason)
    }
    private static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite else { return nil }
        return number.doubleValue
    }
}
