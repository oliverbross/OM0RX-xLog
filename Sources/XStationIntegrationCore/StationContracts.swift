// GPL-3.0-only; Copyright Oliver Bross OM0RX.
import Foundation

public enum StationContractError: Error, Equatable, Sendable {
    case invalidProfile, invalidTarget, invalidClock, invalidContext, invalidTimeout
    case notReady, unsupported, stopped
}

/// Declarations are a provider's actual supported operations, never permission to transmit.
public enum StationCapability: String, Codable, CaseIterable, Sendable {
    case observeRadio, tune, setFrequency, setMode, selectReceiveVFO, selectTransmitVFO, split
    case ptt, cwSend, cwClear, cwSpeed, rit, xit, rfPower, stationAction
    case observeRotor, aimRotor, stopRotor, observeAccessories, controlAccessories, publishSpot
}

public struct ProviderSelection: Codable, Equatable, Sendable {
    public let providerID: String
    public let deviceID: String?
    public let endpoint: String?
    /// An opaque reference resolved by a platform credential store; never a token/password.
    public let credentialReference: String?

    public init(providerID: String, deviceID: String? = nil, endpoint: String? = nil, credentialReference: String? = nil) {
        self.providerID = providerID; self.deviceID = deviceID
        self.endpoint = endpoint; self.credentialReference = credentialReference
    }

    public func validate() throws {
        guard Self.validIdentifier(providerID), deviceID.map(Self.validIdentifier) ?? true,
              credentialReference.map(Self.validIdentifier) ?? true else { throw StationContractError.invalidProfile }
        if let endpoint {
            guard endpoint.utf8.count <= 2048, let url = URLComponents(string: endpoint),
                  ["https", "wss", "tcp", "udp"].contains(url.scheme?.lowercased() ?? ""),
                  url.host?.isEmpty == false, url.user == nil, url.password == nil,
                  url.query == nil, url.fragment == nil,
                  url.port.map({ (1...65535).contains($0) }) ?? true else { throw StationContractError.invalidProfile }
        }
    }

    static func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-:")).contains($0)
        }
    }
}

public struct StationProfile: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1
    public let schemaVersion: Int
    public let id: UUID
    public let name: String
    public let radio: ProviderSelection?
    public let rotor: ProviderSelection?
    public let accessories: [ProviderSelection]
    public let cluster: ProviderSelection?

    public init(id: UUID = UUID(), name: String, radio: ProviderSelection? = nil,
                rotor: ProviderSelection? = nil, accessories: [ProviderSelection] = [], cluster: ProviderSelection? = nil) {
        schemaVersion = Self.currentSchemaVersion; self.id = id; self.name = name
        self.radio = radio; self.rotor = rotor; self.accessories = accessories; self.cluster = cluster
    }

    public func validate() throws {
        guard schemaVersion == Self.currentSchemaVersion,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              name.utf8.count <= 128, !name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              accessories.count <= 16 else { throw StationContractError.invalidProfile }
        try radio?.validate(); try rotor?.validate(); try cluster?.validate()
        for accessory in accessories { try accessory.validate() }
    }
}

public struct ProviderContext: Codable, Equatable, Sendable {
    public let profileID: UUID
    public let generation: UInt64
    public let sessionID: UUID
    public init(profileID: UUID, generation: UInt64, sessionID: UUID = UUID()) {
        self.profileID = profileID; self.generation = generation; self.sessionID = sessionID
    }
}

public enum StationReadiness: String, Codable, Sendable { case ready, notReady, stale, unknown, disconnected }

/// Only authoritative radio telemetry belongs here. Optimistic pending values must stay outside it.
public struct ObservedStationSnapshot: Codable, Equatable, Sendable {
    public let context: ProviderContext
    public let sequence: UInt64
    public let observedAt: TimeInterval
    public let readiness: StationReadiness
    public let authoritative: Bool
    public let frequencyHz: Int64?
    public let mode: String?
    public let receiveVFO: String?
    public let transmitVFO: String?
    public let transmitFrequencyHz: Int64?
    public let transmitMode: String?
    public let capabilities: Set<StationCapability>

    public init(context: ProviderContext, sequence: UInt64, observedAt: TimeInterval,
                readiness: StationReadiness, authoritative: Bool, frequencyHz: Int64? = nil,
                mode: String? = nil, receiveVFO: String? = nil, transmitVFO: String? = nil,
                transmitFrequencyHz: Int64? = nil, transmitMode: String? = nil,
                capabilities: Set<StationCapability> = []) {
        self.context = context; self.sequence = sequence; self.observedAt = observedAt
        self.readiness = readiness; self.authoritative = authoritative; self.frequencyHz = frequencyHz
        self.mode = mode; self.receiveVFO = receiveVFO; self.transmitVFO = transmitVFO
        self.transmitFrequencyHz = transmitFrequencyHz; self.transmitMode = transmitMode
        self.capabilities = capabilities
    }

    public func isFresh(at now: TimeInterval, maximumAge: TimeInterval) -> Bool {
        now.isFinite && observedAt.isFinite && maximumAge.isFinite && maximumAge > 0
            && observedAt <= now && now - observedAt <= maximumAge
    }

    var hasValidRadioState: Bool {
        guard let frequencyHz, let mode else { return false }
        return (try? TuneTarget(frequencyHz: frequencyHz, mode: mode).validate()) != nil
    }
}

public enum StationMode {
    /// Physical comparison preserves USB, LSB, DIGU and DIGL as distinct modes.
    public static func physical(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
    /// Logging labels are separate from control targets and must never confirm a tune.
    public static func loggingFamily(_ value: String) -> String {
        let mode = physical(value)
        return ["USB", "LSB"].contains(mode) ? "SSB" : mode
    }
}

public struct TuneTarget: Codable, Equatable, Sendable {
    public let frequencyHz: Int64
    public let mode: String
    public let receiveVFO: String?
    public let transmitVFO: String?
    public let transmitFrequencyHz: Int64?
    public let transmitMode: String?
    public init(frequencyHz: Int64, mode: String, receiveVFO: String? = nil,
                transmitVFO: String? = nil, transmitFrequencyHz: Int64? = nil, transmitMode: String? = nil) {
        self.frequencyHz = frequencyHz; self.mode = StationMode.physical(mode)
        self.receiveVFO = receiveVFO.map(StationMode.physical); self.transmitVFO = transmitVFO.map(StationMode.physical)
        self.transmitFrequencyHz = transmitFrequencyHz; self.transmitMode = transmitMode.map(StationMode.physical)
    }
    public func validate() throws {
        let validMode: (String) -> Bool = { value in
            !value.isEmpty && value.utf8.count <= 16 && value.unicodeScalars.allSatisfy {
                CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-").contains($0)
            }
        }
        guard (1...1_000_000_000_000).contains(frequencyHz), validMode(mode),
              receiveVFO.map({ ProviderSelection.validIdentifier($0) }) ?? true,
              transmitVFO.map({ ProviderSelection.validIdentifier($0) }) ?? true,
              transmitFrequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? true,
              transmitMode.map(validMode) ?? true else { throw StationContractError.invalidTarget }
    }
    func matches(_ snapshot: ObservedStationSnapshot) -> Bool {
        snapshot.frequencyHz == frequencyHz && snapshot.mode.map(StationMode.physical) == StationMode.physical(mode)
            && (receiveVFO == nil || snapshot.receiveVFO.map(StationMode.physical) == receiveVFO)
            && (transmitVFO == nil || snapshot.transmitVFO.map(StationMode.physical) == transmitVFO)
            && (transmitFrequencyHz == nil || snapshot.transmitFrequencyHz == transmitFrequencyHz)
            && (transmitMode == nil || snapshot.transmitMode.map(StationMode.physical) == transmitMode)
    }
    var requiredCapabilities: Set<StationCapability> {
        var result: Set<StationCapability> = [.observeRadio, .tune]
        if receiveVFO != nil { result.insert(.selectReceiveVFO) }
        if transmitVFO != nil { result.insert(.selectTransmitVFO) }
        if transmitFrequencyHz != nil { result.insert(.split) }
        if transmitMode != nil { result.insert(.setMode) }
        return result
    }
}

/// A typed transport boundary covering the full product surface. Implementations validate bounds,
/// capability support and operator authority before writes; this module implements no provider.
public enum StationCommand: Codable, Equatable, Sendable {
    case tune(TuneTarget), frequency(Int64, vfo: String?), mode(String, vfo: String?)
    case receiveVFO(String), transmitVFO(String), split(Bool, transmitFrequencyHz: Int64?)
    case ptt(Bool), cwSend(String), cwClear, cwSpeed(Int), rit(Bool, offsetHz: Int), xit(Bool, offsetHz: Int)
    case rfPower(Int), stationAction(String), aimRotor(Double), stopRotor, accessory(String, action: String)
    case publishSpot(call: String, frequencyHz: Int64, mode: String)

    public var requiredCapabilities: Set<StationCapability> {
        switch self {
        case .tune(let target): return target.requiredCapabilities
        case .frequency: return [.setFrequency]
        case .mode: return [.setMode]
        case .receiveVFO: return [.selectReceiveVFO]
        case .transmitVFO: return [.selectTransmitVFO]
        case .split: return [.split]
        case .ptt: return [.ptt]
        case .cwSend: return [.cwSend]
        case .cwClear: return [.cwClear]
        case .cwSpeed: return [.cwSpeed]
        case .rit: return [.rit]
        case .xit: return [.xit]
        case .rfPower: return [.rfPower]
        case .stationAction: return [.stationAction]
        case .aimRotor: return [.aimRotor]
        case .stopRotor: return [.stopRotor]
        case .accessory: return [.controlAccessories]
        case .publishSpot: return [.publishSpot]
        }
    }

    /// Structural bounds only. A provider additionally enforces device limits and station authority.
    public func validate() throws {
        func identifier(_ value: String) throws {
            guard ProviderSelection.validIdentifier(value) else { throw StationContractError.invalidTarget }
        }
        switch self {
        case .tune(let target): try target.validate()
        case let .frequency(hz, vfo):
            try TuneTarget(frequencyHz: hz, mode: "CW", receiveVFO: vfo).validate()
        case let .mode(mode, vfo):
            try TuneTarget(frequencyHz: 1, mode: mode, receiveVFO: vfo).validate()
        case .receiveVFO(let vfo), .transmitVFO(let vfo): try identifier(vfo)
        case let .split(_, hz): if let hz { try TuneTarget(frequencyHz: hz, mode: "CW").validate() }
        case .cwSend(let text):
            guard !text.isEmpty, text.utf8.count <= 128, !text.contains("|"),
                  text.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw StationContractError.invalidTarget }
        case .cwSpeed(let speed): guard (5...100).contains(speed) else { throw StationContractError.invalidTarget }
        case .rit(_, let hz), .xit(_, let hz): guard (-9999...9999).contains(hz) else { throw StationContractError.invalidTarget }
        case .rfPower(let watts): guard (1...10000).contains(watts) else { throw StationContractError.invalidTarget }
        case .stationAction(let action): try identifier(action)
        case .aimRotor(let bearing): guard bearing.isFinite, (0...360).contains(bearing) else { throw StationContractError.invalidTarget }
        case .accessory(let id, let action): try identifier(id); try identifier(action)
        case let .publishSpot(call, hz, mode):
            guard !call.isEmpty, call.utf8.count <= 32,
                  call.uppercased().unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-").contains($0) }) else {
                throw StationContractError.invalidTarget
            }
            try TuneTarget(frequencyHz: hz, mode: mode).validate()
        case .ptt, .cwClear, .stopRotor: break
        }
    }
}

public struct StationCommandRequest: Codable, Equatable, Sendable {
    public let id: UUID
    public let context: ProviderContext
    public let command: StationCommand
    public init(id: UUID = UUID(), context: ProviderContext, command: StationCommand) {
        self.id = id; self.context = context; self.command = command
    }
}

public struct ProviderAcknowledgement: Codable, Equatable, Sendable {
    public let requestID: UUID
    public let context: ProviderContext
    public init(requestID: UUID, context: ProviderContext) { self.requestID = requestID; self.context = context }
}

public protocol StationProvider: Sendable {
    var capabilities: Set<StationCapability> { get }
    func connect(profile: StationProfile, context: ProviderContext) async throws
    func observations() async -> AsyncStream<ObservedStationSnapshot>
    func execute(_ request: StationCommandRequest) async throws -> ProviderAcknowledgement
    func disconnect() async
}
