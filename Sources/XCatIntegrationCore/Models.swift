import Foundation

public enum RadioConnectionState: String, Codable, Sendable {
    case stopped
    case discovering
    case authenticating
    case connecting
    case ready
    case retrying
    case failed
}

public struct RadioVFO: Equatable, Sendable {
    public var letter: String
    public var frequencyHz: Int64
    public var mode: String
    public var isReceive: Bool
    public var isTransmit: Bool
    public var ritEnabled: Bool
    public var ritOffsetHz: Int
    public var xitEnabled: Bool
    public var xitOffsetHz: Int

    public init(
        letter: String,
        frequencyHz: Int64,
        mode: String,
        isReceive: Bool = false,
        isTransmit: Bool = false,
        ritEnabled: Bool = false,
        ritOffsetHz: Int = 0,
        xitEnabled: Bool = false,
        xitOffsetHz: Int = 0
    ) {
        self.letter = letter.uppercased()
        self.frequencyHz = frequencyHz
        self.mode = mode.uppercased()
        self.isReceive = isReceive
        self.isTransmit = isTransmit
        self.ritEnabled = ritEnabled
        self.ritOffsetHz = ritOffsetHz
        self.xitEnabled = xitEnabled
        self.xitOffsetHz = xitOffsetHz
    }
}

public enum RemoteStationAction: String, CaseIterable, Sendable {
    case standby
    case operate
    case tune
    case cancel
}

public struct RemoteStationStatus: Equatable, Sendable {
    public var revision: Int
    public var radioKnown: Bool
    public var radioStale: Bool
    public var stationBound: Bool
    public var commissioned: Bool
    public var coordinatorState: String
    public var supportedCommands: Set<String>
    public var allowedActions: Set<String>
    public var inhibitors: [String]
    public var kpaSummary: String
    public var kpaOperate: Bool?
    public var katSummary: String
    public var routeSummary: String
    public var alarmSummary: String
    public var alarmMessages: [String]
    public var band: String
    public var routeAlignment: String
    public var interlockState: String
    public var txPowerWatts: Double?
    public var swr: Double?
    public var swrIsLive: Bool
    public var kpaDetailPrimary: String
    public var kpaDetailSecondary: String
    public var katDetailPrimary: String
    public var katDetailSecondary: String
    public var routeDetail: String

    public init(
        revision: Int = 0,
        radioKnown: Bool = false,
        radioStale: Bool = true,
        stationBound: Bool = false,
        commissioned: Bool = false,
        coordinatorState: String = "unknown",
        supportedCommands: Set<String> = [],
        allowedActions: Set<String> = [],
        inhibitors: [String] = ["Agent state is not available"],
        kpaSummary: String = "KPA unknown",
        kpaOperate: Bool? = nil,
        katSummary: String = "KAT unknown",
        routeSummary: String = "Route unknown",
        alarmSummary: String = "ALARM unknown",
        alarmMessages: [String] = [],
        band: String = "--",
        routeAlignment: String = "unknown",
        interlockState: String = "--",
        txPowerWatts: Double? = nil,
        swr: Double? = nil,
        swrIsLive: Bool = false,
        kpaDetailPrimary: String = "KPA500 --",
        kpaDetailSecondary: String = "Telemetry unavailable",
        katDetailPrimary: String = "KAT500 --",
        katDetailSecondary: String = "Telemetry unavailable",
        routeDetail: String = "Route unavailable"
    ) {
        self.revision = revision
        self.radioKnown = radioKnown
        self.radioStale = radioStale
        self.stationBound = stationBound
        self.commissioned = commissioned
        self.coordinatorState = coordinatorState
        self.supportedCommands = supportedCommands
        self.allowedActions = allowedActions
        self.inhibitors = inhibitors
        self.kpaSummary = kpaSummary
        self.kpaOperate = kpaOperate
        self.katSummary = katSummary
        self.routeSummary = routeSummary
        self.alarmSummary = alarmSummary
        self.alarmMessages = alarmMessages
        self.band = band
        self.routeAlignment = routeAlignment
        self.interlockState = interlockState
        self.txPowerWatts = txPowerWatts
        self.swr = swr
        self.swrIsLive = swrIsLive
        self.kpaDetailPrimary = kpaDetailPrimary
        self.kpaDetailSecondary = kpaDetailSecondary
        self.katDetailPrimary = katDetailPrimary
        self.katDetailSecondary = katDetailSecondary
        self.routeDetail = routeDetail
    }

}

/// Explicit meter evidence, distinct from a transmitter drive setting.
/// Providers may report a radio or amplifier output meter, but never promote a
/// configured drive percentage to measured watts.
public struct MeasuredTransmitPowerObservation: Equatable, Sendable {
    public enum Source: String, Sendable {
        case kpa500Output = "kpa500_output"
        case radioOutput = "radio_output"
    }
    public let source: Source
    public let watts: Double
    public let observedAt: Date
    public let radioObservedAt: Date
    public let amplifierObservedAt: Date
    public let receivedAt: Date

    public init?(source: Source = .kpa500Output, watts: Double, observedAt: Date, radioObservedAt: Date,
                 amplifierObservedAt: Date, receivedAt: Date) {
        // A conservative plausibility ceiling admits normal radio and amplifier
        // meters without accepting arbitrary control values as RF evidence.
        guard watts.isFinite, watts > 0, watts <= 1_000 else { return nil }
        self.source = source
        self.watts = watts
        self.observedAt = observedAt
        self.radioObservedAt = radioObservedAt
        self.amplifierObservedAt = amplifierObservedAt
        self.receivedAt = receivedAt
        guard isFresh(at: receivedAt) else { return nil }
    }

    /// Recheck on every consumer read: receipt time never renews meter age.
    /// The amplifier status envelope uses the agent's 15-second stale limit;
    /// meter, retained radio observation and transport evidence must each be at
    /// most 2 seconds old. Context envelope ages are not per-field MOX/fault
    /// provenance; this is meter evidence for logging, never transmit authority.
    public func isFresh(at now: Date, sessionStartedAt: Date? = nil) -> Bool {
        func fresh(_ date: Date, maximumAge: TimeInterval) -> Bool {
            let timestamp = date.timeIntervalSince1970
            let age = now.timeIntervalSince(date)
            return timestamp.isFinite && timestamp > 0 && age.isFinite && age >= 0 && age <= maximumAge
        }
        guard fresh(observedAt, maximumAge: 2), fresh(radioObservedAt, maximumAge: 2),
              fresh(receivedAt, maximumAge: 2), fresh(amplifierObservedAt, maximumAge: 15) else { return false }
        if let sessionStartedAt {
            guard sessionStartedAt.timeIntervalSince1970.isFinite,
                  observedAt >= sessionStartedAt, radioObservedAt >= sessionStartedAt,
                  receivedAt >= sessionStartedAt else { return false }
        }
        return true
    }
}

public struct RadioSnapshot: Equatable, Sendable {
    public var frequencyHz: Int64
    public var mode: String
    public var isConnected: Bool
    public var isTransmitting: Bool
    public var slice: String
    public var transmitSlice: String
    public var transmitFrequencyHz: Int64
    public var station: String
    public var vfos: [RadioVFO]
    public var remoteStationStatus: RemoteStationStatus?
    public var rfPowerWatts: Int?
    /// FLEX transmitter RF drive setting (0–100), not measured output watts.
    public var rfPowerLevel: Int?
    public var agentObservedAt: Date?
    public var transportReceivedAt: Date?
    public var measuredTransmitPower: MeasuredTransmitPowerObservation?

    public init(
        frequencyHz: Int64 = 14_074_000,
        mode: String = "DIGU",
        isConnected: Bool = true,
        isTransmitting: Bool = false,
        slice: String = "A",
        transmitSlice: String? = nil,
        transmitFrequencyHz: Int64? = nil,
        station: String = "",
        vfos: [RadioVFO]? = nil,
        remoteStationStatus: RemoteStationStatus? = nil,
        rfPowerWatts: Int? = nil,
        rfPowerLevel: Int? = nil,
        agentObservedAt: Date? = nil,
        transportReceivedAt: Date? = nil,
        measuredTransmitPower: MeasuredTransmitPowerObservation? = nil
    ) {
        self.frequencyHz = frequencyHz
        self.mode = mode
        self.isConnected = isConnected
        self.isTransmitting = isTransmitting
        self.slice = slice
        self.transmitSlice = transmitSlice ?? slice
        self.transmitFrequencyHz = transmitFrequencyHz ?? frequencyHz
        self.station = station
        self.remoteStationStatus = remoteStationStatus
        self.rfPowerWatts = rfPowerWatts
        self.rfPowerLevel = rfPowerLevel
        self.agentObservedAt = agentObservedAt
        self.transportReceivedAt = transportReceivedAt
        self.measuredTransmitPower = measuredTransmitPower
        self.vfos = vfos ?? [RadioVFO(
            letter: slice,
            frequencyHz: frequencyHz,
            mode: mode,
            isReceive: true,
            isTransmit: (transmitSlice ?? slice).uppercased() == slice.uppercased()
        )]
    }

    public func vfo(_ letter: String) -> RadioVFO? {
        vfos.first { $0.letter == letter.uppercased() }
    }
}

public struct AppConfiguration: Codable, Equatable, Sendable {
    public enum ConnectionKind: String, Codable, CaseIterable, Sendable {
        case smartLink = "SmartLink"
        case remoteAgent = "Remote Station Agent"
        case local = "Local network"
        case legacyXCAT = "Remote via supervised xCAT"
        case simulator = "Simulator"
    }

    public var connectionKind: ConnectionKind
    public var radioHost: String
    public var radioPort: UInt16
    public var stationName: String
    public var sliceLetter: String
    public var smartLinkEmail: String
    public var smartLinkRadioSerial: String
    public var remoteAgentBaseURL: String
    public var catPort: UInt16
    public var rigCtlPort: UInt16
    public var legacyXCATHost: String
    public var legacyXCATPort: UInt16
    public var superviseLegacyXCAT: Bool
    public var allowCATTransmit: Bool
    public var launchServersAutomatically: Bool
    public var spotBridge: SpotBridgeConfiguration
    public var rotator: RotatorConfiguration

    public init(
        connectionKind: ConnectionKind = .smartLink,
        radioHost: String = "",
        radioPort: UInt16 = 4992,
        stationName: String = "Maestro",
        sliceLetter: String = "A",
        smartLinkEmail: String = "",
        smartLinkRadioSerial: String = "",
        remoteAgentBaseURL: String = "",
        catPort: UInt16 = 5002,
        rigCtlPort: UInt16 = 4532,
        legacyXCATHost: String = "127.0.0.1",
        legacyXCATPort: UInt16 = 5002,
        superviseLegacyXCAT: Bool = true,
        allowCATTransmit: Bool = false,
        launchServersAutomatically: Bool = true,
        spotBridge: SpotBridgeConfiguration = SpotBridgeConfiguration(),
        rotator: RotatorConfiguration = RotatorConfiguration()
    ) {
        self.connectionKind = connectionKind
        self.radioHost = radioHost
        self.radioPort = radioPort
        self.stationName = stationName
        self.sliceLetter = sliceLetter
        self.smartLinkEmail = smartLinkEmail
        self.smartLinkRadioSerial = smartLinkRadioSerial
        self.remoteAgentBaseURL = remoteAgentBaseURL
        self.catPort = catPort
        self.rigCtlPort = rigCtlPort
        self.legacyXCATHost = legacyXCATHost
        self.legacyXCATPort = legacyXCATPort
        self.superviseLegacyXCAT = superviseLegacyXCAT
        self.allowCATTransmit = allowCATTransmit
        self.launchServersAutomatically = launchServersAutomatically
        self.spotBridge = spotBridge
        self.rotator = rotator
    }

    private enum CodingKeys: String, CodingKey {
        case connectionKind, radioHost, radioPort, stationName, sliceLetter
        case smartLinkEmail, smartLinkRadioSerial, remoteAgentBaseURL
        case catPort, rigCtlPort, legacyXCATHost, legacyXCATPort
        case superviseLegacyXCAT, allowCATTransmit, launchServersAutomatically, spotBridge, rotator
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        connectionKind = try values.decodeIfPresent(ConnectionKind.self, forKey: .connectionKind) ?? .smartLink
        radioHost = try values.decodeIfPresent(String.self, forKey: .radioHost) ?? ""
        radioPort = try values.decodeIfPresent(UInt16.self, forKey: .radioPort) ?? 4992
        stationName = try values.decodeIfPresent(String.self, forKey: .stationName) ?? "Maestro"
        sliceLetter = try values.decodeIfPresent(String.self, forKey: .sliceLetter) ?? "A"
        smartLinkEmail = try values.decodeIfPresent(String.self, forKey: .smartLinkEmail) ?? ""
        smartLinkRadioSerial = try values.decodeIfPresent(String.self, forKey: .smartLinkRadioSerial) ?? ""
        remoteAgentBaseURL = try values.decodeIfPresent(String.self, forKey: .remoteAgentBaseURL) ?? ""
        catPort = try values.decodeIfPresent(UInt16.self, forKey: .catPort) ?? 5002
        rigCtlPort = try values.decodeIfPresent(UInt16.self, forKey: .rigCtlPort) ?? 4532
        legacyXCATHost = try values.decodeIfPresent(String.self, forKey: .legacyXCATHost) ?? "127.0.0.1"
        legacyXCATPort = try values.decodeIfPresent(UInt16.self, forKey: .legacyXCATPort) ?? 5002
        superviseLegacyXCAT = try values.decodeIfPresent(Bool.self, forKey: .superviseLegacyXCAT) ?? true
        allowCATTransmit = try values.decodeIfPresent(Bool.self, forKey: .allowCATTransmit) ?? false
        launchServersAutomatically = try values.decodeIfPresent(Bool.self, forKey: .launchServersAutomatically) ?? true
        spotBridge = try values.decodeIfPresent(SpotBridgeConfiguration.self, forKey: .spotBridge) ?? SpotBridgeConfiguration()
        rotator = try values.decodeIfPresent(RotatorConfiguration.self, forKey: .rotator) ?? RotatorConfiguration()
    }
}

public enum CATTransmitMode: Sendable {
    case microphone
    case data
    case tune
}

public protocol RadioControlling: Actor {
    func snapshot() async -> RadioSnapshot
    func primaryFrequency() async -> Int64?
    func setPrimaryFrequency(_ frequencyHz: Int64) async throws
    func setFrequency(_ frequencyHz: Int64) async throws
    func setFrequencyAndMode(_ frequencyHz: Int64, mode: String) async throws
    func tuneSimplex(_ frequencyHz: Int64, mode: String) async throws
    func setMode(_ mode: String) async throws
    func setTransmit(_ enabled: Bool) async throws
    func secondaryFrequency() async -> Int64?
    func setSecondaryFrequency(_ frequencyHz: Int64) async throws
    func setSplitTransmit(_ enabled: Bool) async throws
    func setReceiveVFO(_ vfo: Int) async throws
    func cwSpeed() async -> Int
    func setCWSpeed(_ wordsPerMinute: Int) async throws
    func sendCW(_ text: String) async throws
    func clearCW() async throws
    func setTransmit(_ mode: CATTransmitMode) async throws
    func setRIT(enabled: Bool, offsetHz: Int, vfo: String?) async throws
    func setXIT(enabled: Bool, offsetHz: Int, vfo: String?) async throws
    func setRFPower(_ watts: Int) async throws
    func performStationAction(_ action: RemoteStationAction) async throws
    func addSpot(_ spot: FlexSpot) async throws
}

public extension RadioControlling {
    func tuneSimplex(_ frequencyHz: Int64, mode: String) async throws {
        try await tuneSimplexLegacy(frequencyHz, mode: mode)
    }
    func tuneSimplexLegacy(_ frequencyHz: Int64, mode: String) async throws {
        let before = await snapshot()
        if before.slice.uppercased() != "A" { try await setReceiveVFO(0) }
        if before.transmitSlice.uppercased() != "A" { try await setSplitTransmit(false) }
        try await setFrequencyAndMode(frequencyHz, mode: mode)
    }
    func primaryFrequency() async -> Int64? { await snapshot().vfo("A")?.frequencyHz }
    func setPrimaryFrequency(_ frequencyHz: Int64) async throws { try await setFrequency(frequencyHz) }
    func setFrequencyAndMode(_ frequencyHz: Int64, mode: String) async throws {
        try await setFrequency(frequencyHz)
        try await setMode(mode)
    }
    func secondaryFrequency() async -> Int64? { nil }
    func setSecondaryFrequency(_ frequencyHz: Int64) async throws { throw XCatError.unsupported }
    func setSplitTransmit(_ enabled: Bool) async throws {
        if enabled { throw XCatError.unsupported }
    }
    func setReceiveVFO(_ vfo: Int) async throws {
        if vfo != 0 { throw XCatError.unsupported }
    }
    func cwSpeed() async -> Int { 25 }
    func setCWSpeed(_ wordsPerMinute: Int) async throws { throw XCatError.unsupported }
    func sendCW(_ text: String) async throws { throw XCatError.unsupported }
    func clearCW() async throws { throw XCatError.unsupported }
    func setTransmit(_ mode: CATTransmitMode) async throws { try await setTransmit(true) }
    func setRIT(enabled: Bool, offsetHz: Int, vfo: String? = nil) async throws { throw XCatError.unsupported }
    func setXIT(enabled: Bool, offsetHz: Int, vfo: String? = nil) async throws { throw XCatError.unsupported }
    func setRFPower(_ watts: Int) async throws { throw XCatError.unsupported }
    func performStationAction(_ action: RemoteStationAction) async throws { throw XCatError.unsupported }
    func addSpot(_ spot: FlexSpot) async throws { throw XCatError.unsupported }
}
