import Foundation

public enum LogbookMode: String, Codable, Equatable, Sendable {
    case local
    case wavelog
}

public enum FTPBackupProtocol: String, Codable, Equatable, Sendable {
    case disabled
    case ftp
    case ftps
}

public enum CallsignLookupProvider: String, Codable, Equatable, Sendable {
    case qrz
    case hamQTH = "hamqth"

    public var displayName: String {
        switch self {
        case .qrz: return "QRZ"
        case .hamQTH: return "HamQTH"
        }
    }
}

/// Non-secret FTP-family backup configuration. The password is stored under a
/// separate workspace Keychain account and is never encoded with Settings.
public struct FTPBackupSettings: Codable, Equatable, Sendable {
    public var `protocol`: FTPBackupProtocol = .disabled
    public var endpoint: String = ""
    public var directory: String = "/OM0RX-xLog"
    public var username: String = ""
    public var plainFTPConfirmed = false

    public init() {}
}

/// Descriptive station equipment, never a request to connect or switch hardware.
public struct StationEquipment: Codable, Equatable, Sendable {
    public enum Display: String, Codable, Sendable { case automatic, antenna, hidden }
    public enum Antenna: String, Codable, Sendable { case vertical, wire, dipole, yagi, loop, other }
    public var display: Display = .automatic
    public var antenna: Antenna = .vertical
    public var name: String = ""
    public var bands: [String] = []
    public init() {}
}

public struct XLogSettings: Codable, Equatable, Sendable {
    public var operatorCall: String
    public var stationCall: String
    public var gridSquare: String
    public var stationLocation: String
    public var defaultPower: String
    /// Opt-in meter capture; existing profiles never enable it during decoding.
    public var automaticTransmitPower = false
    /// Opt-in only: clear an unlogged draft after a separately confirmed QSY.
    public var clearAfterQSY = false
    public var defaultRadio: String
    public var wavelogURL: String
    public var wavelogStationID: Int
    public var logbookMode: LogbookMode
    public var automaticSync: Bool
    public var syncIntervalMinutes: Int
    public var qrzUsername: String
    public var qrzEnabled: Bool
    public var callsignLookupProvider: CallsignLookupProvider = .qrz
    public var hamqthUsername: String = ""
    public var xcatHost: String
    public var xcatRigCtlPort: Int
    public var clubLogCTYURL: String
    public var lotwActivityURL: String
    public var stationEquipment = StationEquipment()
    public var cwProfile: CWProfile? = nil
    public var ftpBackup = FTPBackupSettings()

    public static let defaults = XLogSettings(
        operatorCall: "OM0RX",
        stationCall: "OM0RX",
        gridSquare: "",
        stationLocation: "",
        defaultPower: "100",
        defaultRadio: "OM0RX-xCat",
        wavelogURL: "https://om0rx.wavelog.online",
        wavelogStationID: 0,
        logbookMode: .local,
        automaticSync: true,
        syncIntervalMinutes: 5,
        qrzUsername: "",
        qrzEnabled: false,
        callsignLookupProvider: .qrz,
        hamqthUsername: "",
        xcatHost: "127.0.0.1",
        xcatRigCtlPort: 14532,
        clubLogCTYURL: "https://cdn.clublog.org/cty.php",
        lotwActivityURL: "https://lotw.arrl.org/lotw-user-activity.csv"
    )
}

/// Remote IDs are meaningful only within their exact saved Wavelog destination.
public enum WavelogDestinationError: Error, LocalizedError {
    case linkedContacts
    case databaseUnavailable
    case unsavedDestination

    public var errorDescription: String? {
        switch self {
        case .linkedContacts:
            return "This logbook contains Wavelog-linked contacts. Create a new workspace or use a reviewed migration before changing the destination."
        case .databaseUnavailable:
            return "Open the logbook before changing its Wavelog destination."
        case .unsavedDestination:
            return "Save or undo the pending Wavelog destination change before synchronizing or creating a backup."
        }
    }
}

extension XLogSettings {
    public func hasSameWavelogDestination(as other: XLogSettings) -> Bool {
        wavelogURL == other.wavelogURL && wavelogStationID == other.wavelogStationID
    }
}

/// Integration-only settings state. The original SwiftUI application continues
/// to use `SettingsStore`; the isolated workspace owns this revisioned snapshot.
public struct IntegrationSettingsSnapshot: Codable, Equatable, Sendable {
    public let revision: Int64
    public let settings: XLogSettings
    /// Advances atomically with every mode/destination change. Returning to a
    /// previous destination cannot revive consent left by an interrupted save.
    public let syncTargetRevision: Int64

    public init(revision: Int64, settings: XLogSettings, syncTargetRevision: Int64 = 0) {
        self.revision = revision
        self.settings = settings
        self.syncTargetRevision = syncTargetRevision
    }

    private enum CodingKeys: String, CodingKey { case revision, settings, syncTargetRevision }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        revision = try values.decode(Int64.self, forKey: .revision)
        settings = try values.decode(XLogSettings.self, forKey: .settings)
        syncTargetRevision = try values.decodeIfPresent(Int64.self, forKey: .syncTargetRevision) ?? 0
    }

    public func validate() throws {
        guard (0...9_007_199_254_740_991).contains(revision),
              (0...revision).contains(syncTargetRevision),
              (0...Int(Int32.max)).contains(settings.wavelogStationID),
              (1...1_440).contains(settings.syncIntervalMinutes),
              (1...65_535).contains(settings.xcatRigCtlPort) else {
            throw IntegrationSettingsError.invalid
        }
        let bounded: [(String, Int)] = [
            (settings.operatorCall, 64), (settings.stationCall, 64),
            (settings.gridSquare, 32), (settings.stationLocation, 512),
            (settings.defaultPower, 32), (settings.defaultRadio, 256),
            (settings.wavelogURL, 2_048), (settings.qrzUsername, 256),
            (settings.hamqthUsername, 256),
            (settings.xcatHost, 512), (settings.clubLogCTYURL, 2_048),
            (settings.lotwActivityURL, 2_048), (settings.stationEquipment.name, 256),
            (settings.ftpBackup.endpoint, 2_048), (settings.ftpBackup.directory, 4_096),
            (settings.ftpBackup.username, 512),
        ]
        guard bounded.allSatisfy({ $0.0.utf8.count <= $0.1 }),
              settings.stationEquipment.bands.count <= 64,
              settings.stationEquipment.bands.allSatisfy({ $0.utf8.count <= 32 }),
              Self.validFTPBackup(settings.ftpBackup),
              (try? JSONEncoder().encode(settings).count).map({ $0 <= 65_536 }) == true else {
            throw IntegrationSettingsError.invalid
        }
    }

    private static func validFTPBackup(_ value: FTPBackupSettings) -> Bool {
        guard !value.endpoint.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              !value.directory.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              !value.username.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else { return false }
        if value.protocol == .disabled { return !value.plainFTPConfirmed }
        guard !value.username.isEmpty, let endpoint = URL(string: value.endpoint) else { return false }
        let provider: RemoteBackupProvider = value.protocol == .ftp ? .ftp : .ftps
        let security: RemoteBackupTransportSecurity = value.protocol == .ftp
            ? .explicitlyAcceptedPlainFTP : .authenticatedEncryptionRequired
        guard (value.protocol == .ftp) == value.plainFTPConfirmed else { return false }
        return (try? RemoteBackupDestination(id: UUID(), revision: 1, provider: provider,
            accountID: UUID(), location: .server(endpoint: endpoint, directory: value.directory),
            security: security)) != nil
    }
}

public struct IntegrationSettingsMutation: Codable, Equatable, Sendable {
    public let operationID: UUID
    public let expectedRevision: Int64
    public let settings: XLogSettings

    public init(operationID: UUID, expectedRevision: Int64, settings: XLogSettings) {
        self.operationID = operationID
        self.expectedRevision = expectedRevision
        self.settings = settings
    }
}

/// Historical commit result. Replaying the exact mutation returns this receipt;
/// it is not a fresh read after later settings changes.
public struct IntegrationSettingsReceipt: Codable, Equatable, Sendable {
    public let mutation: IntegrationSettingsMutation
    public let snapshot: IntegrationSettingsSnapshot

    public init(mutation: IntegrationSettingsMutation, snapshot: IntegrationSettingsSnapshot) {
        self.mutation = mutation
        self.snapshot = snapshot
    }
}

public enum IntegrationSettingsError: Error {
    case conflict(IntegrationSettingsSnapshot)
    case operationReused
    case notInitialized
    case invalid
}

public enum RotorConfigurationOwner: String, Codable, Equatable, Sendable {
    case nativeDCU1 = "native_dcu1"
    case hamlib
}

public struct NativeRotorConfiguration: Codable, Equatable, Sendable {
    public var host: String
    public var port: Int
    public var name: String

    public init(host: String = "", port: Int = 4_001, name: String = "Rotor") {
        self.host = host; self.port = port; self.name = name
    }
}

public struct HamlibRotorSerialConfiguration: Codable, Equatable, Sendable {
    public var dataBits: Int?
    public var stopBits: Int?
    public var parity: String?
    public var handshake: String?
    public var dtrState: String?
    public var rtsState: String?

    public init(dataBits: Int? = nil, stopBits: Int? = nil, parity: String? = nil,
                handshake: String? = nil, dtrState: String? = nil, rtsState: String? = nil) {
        self.dataBits = dataBits; self.stopBits = stopBits; self.parity = parity
        self.handshake = handshake; self.dtrState = dtrState; self.rtsState = rtsState
    }

    private enum CodingKeys: String, CodingKey {
        case dataBits = "data_bits", stopBits = "stop_bits", parity, handshake
        case dtrState = "dtr_state", rtsState = "rts_state"
    }
}

public struct HamlibRotorConfiguration: Codable, Equatable, Sendable {
    public enum Mode: String, Codable, Sendable { case managed, external }
    public var mode: Mode
    public var model: Int?
    public var path: String
    public var baud: Int
    public var host: String
    public var port: Int
    public var serial: HamlibRotorSerialConfiguration

    public init(mode: Mode = .managed, model: Int? = nil, path: String = "", baud: Int = 9_600,
                host: String = "127.0.0.1", port: Int = 4_533,
                serial: HamlibRotorSerialConfiguration = .init()) {
        self.mode = mode; self.model = model; self.path = path; self.baud = baud
        self.host = host; self.port = port; self.serial = serial
    }
}

/// Passive connection preferences only. Reading, restoring or changing this value
/// never connects, arms, moves or stops hardware.
public struct RotorConfiguration: Codable, Equatable, Sendable {
    public var owner: RotorConfigurationOwner
    public var nativeDCU1: NativeRotorConfiguration
    public var hamlib: HamlibRotorConfiguration
    /// Launch-time automatic-rotor preference. Explicitly saved false values are
    /// preserved while configurations predating this field migrate to enabled.
    public var autoRotorAtStartup: Bool
    /// Native Auto Rotor admission is limited to these canonical bands.
    public var autoRotorBands: [String]

    public static let defaults = RotorConfiguration(owner: .nativeDCU1,
        nativeDCU1: .init(), hamlib: .init(), autoRotorAtStartup: true,
        autoRotorBands: BandPlan.bands)

    public init(owner: RotorConfigurationOwner, nativeDCU1: NativeRotorConfiguration,
                hamlib: HamlibRotorConfiguration, autoRotorAtStartup: Bool = true,
                autoRotorBands: [String] = BandPlan.bands) {
        self.owner = owner; self.nativeDCU1 = nativeDCU1; self.hamlib = hamlib
        self.autoRotorAtStartup = autoRotorAtStartup; self.autoRotorBands = autoRotorBands
    }

    private enum CodingKeys: String, CodingKey {
        case owner, nativeDCU1 = "native_dcu1", hamlib
        case autoRotorAtStartup = "auto_rotor_at_startup", autoRotorBands = "auto_rotor_bands"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        owner = try values.decode(RotorConfigurationOwner.self, forKey: .owner)
        nativeDCU1 = try values.decode(NativeRotorConfiguration.self, forKey: .nativeDCU1)
        hamlib = try values.decode(HamlibRotorConfiguration.self, forKey: .hamlib)
        autoRotorAtStartup = try values.decodeIfPresent(Bool.self, forKey: .autoRotorAtStartup) ?? true
        autoRotorBands = try values.decodeIfPresent([String].self, forKey: .autoRotorBands) ?? BandPlan.bands
    }

    public func validate() throws {
        let serial = hamlib.serial
        let supportedBands = Set(BandPlan.bands)
        guard nativeDCU1.host.utf8.count <= 512,
              (1...65_535).contains(nativeDCU1.port),
              (1...256).contains(nativeDCU1.name.utf8.count),
              hamlib.model.map({ (1...Int(Int32.max)).contains($0) }) ?? true,
              hamlib.path.utf8.count <= 512, hamlib.host.utf8.count <= 512,
              (300...921_600).contains(hamlib.baud), (1...65_535).contains(hamlib.port),
              serial.dataBits.map({ [7, 8].contains($0) }) ?? true,
              serial.stopBits.map({ [1, 2].contains($0) }) ?? true,
              serial.parity.map({ ["None", "Even", "Odd"].contains($0) }) ?? true,
              serial.handshake.map({ ["None", "XONXOFF", "Hardware"].contains($0) }) ?? true,
              serial.dtrState.map({ ["Unset", "OFF", "ON"].contains($0) }) ?? true,
              serial.rtsState.map({ ["Unset", "OFF", "ON"].contains($0) }) ?? true,
              autoRotorBands.count <= supportedBands.count,
              Set(autoRotorBands).count == autoRotorBands.count,
              Set(autoRotorBands).isSubset(of: supportedBands),
              (try? JSONEncoder().encode(self).count).map({ $0 <= 16_384 }) == true else {
            throw RotorConfigurationError.invalid
        }
    }
}

public struct RotorConfigurationSnapshot: Codable, Equatable, Sendable {
    public let revision: Int64
    public let configuration: RotorConfiguration
    public init(revision: Int64, configuration: RotorConfiguration) {
        self.revision = revision; self.configuration = configuration
    }
    public func validate() throws {
        guard (0...9_007_199_254_740_991).contains(revision) else { throw RotorConfigurationError.invalid }
        try configuration.validate()
    }
}

public struct RotorConfigurationMutation: Codable, Equatable, Sendable {
    public let operationID: UUID
    public let expectedRevision: Int64
    public let configuration: RotorConfiguration
    public init(operationID: UUID, expectedRevision: Int64, configuration: RotorConfiguration) {
        self.operationID = operationID; self.expectedRevision = expectedRevision; self.configuration = configuration
    }
}

public struct RotorConfigurationReceipt: Codable, Equatable, Sendable {
    public let mutation: RotorConfigurationMutation
    public let snapshot: RotorConfigurationSnapshot
    public init(mutation: RotorConfigurationMutation, snapshot: RotorConfigurationSnapshot) {
        self.mutation = mutation; self.snapshot = snapshot
    }
}

public enum RotorConfigurationError: Error {
    case conflict(RotorConfigurationSnapshot)
    case operationReused
    case notInitialized
    case invalid
}

extension XLogSettings {
    private enum CodingKeys: String, CodingKey {
        case operatorCall, stationCall, gridSquare, stationLocation, defaultPower, defaultRadio, automaticTransmitPower, clearAfterQSY
        case wavelogURL, wavelogStationID, logbookMode, automaticSync, syncIntervalMinutes
        case qrzUsername, qrzEnabled, callsignLookupProvider, hamqthUsername
        case xcatHost, xcatRigCtlPort, clubLogCTYURL, lotwActivityURL
        case stationEquipment, cwProfile, ftpBackup
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        operatorCall = try values.decode(String.self, forKey: .operatorCall)
        stationCall = try values.decode(String.self, forKey: .stationCall)
        gridSquare = try values.decode(String.self, forKey: .gridSquare)
        stationLocation = try values.decode(String.self, forKey: .stationLocation)
        defaultPower = try values.decode(String.self, forKey: .defaultPower)
        automaticTransmitPower = try values.decodeIfPresent(Bool.self, forKey: .automaticTransmitPower) ?? false
        clearAfterQSY = try values.decodeIfPresent(Bool.self, forKey: .clearAfterQSY) ?? false
        defaultRadio = try values.decode(String.self, forKey: .defaultRadio)
        wavelogURL = try values.decode(String.self, forKey: .wavelogURL)
        wavelogStationID = try values.decode(Int.self, forKey: .wavelogStationID)
        // Existing settings predate this choice. Preserve their Wavelog workflow;
        // only a genuinely fresh settings store starts in standalone mode.
        logbookMode = try values.decodeIfPresent(LogbookMode.self, forKey: .logbookMode) ?? .wavelog
        automaticSync = try values.decode(Bool.self, forKey: .automaticSync)
        syncIntervalMinutes = try values.decode(Int.self, forKey: .syncIntervalMinutes)
        qrzUsername = try values.decode(String.self, forKey: .qrzUsername)
        qrzEnabled = try values.decode(Bool.self, forKey: .qrzEnabled)
        callsignLookupProvider = try values.decodeIfPresent(CallsignLookupProvider.self, forKey: .callsignLookupProvider) ?? .qrz
        hamqthUsername = try values.decodeIfPresent(String.self, forKey: .hamqthUsername) ?? ""
        xcatHost = try values.decode(String.self, forKey: .xcatHost)
        xcatRigCtlPort = try values.decode(Int.self, forKey: .xcatRigCtlPort)
        clubLogCTYURL = try values.decode(String.self, forKey: .clubLogCTYURL)
        lotwActivityURL = try values.decode(String.self, forKey: .lotwActivityURL)
        stationEquipment = try values.decodeIfPresent(StationEquipment.self, forKey: .stationEquipment) ?? StationEquipment()
        cwProfile = try values.decodeIfPresent(CWProfile.self, forKey: .cwProfile)
        ftpBackup = try values.decodeIfPresent(FTPBackupSettings.self, forKey: .ftpBackup) ?? FTPBackupSettings()
    }
}

public final class SettingsStore: @unchecked Sendable {
    private let defaults: UserDefaults
    private let key = "OM0RX-xLog.settings.v1"
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func load() -> XLogSettings {
        guard let data = defaults.data(forKey: key),
              let value = try? JSONDecoder().decode(XLogSettings.self, from: data) else { return .defaults }
        return value
    }

    public func save(_ value: XLogSettings) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }

    /// Check before persisting either settings or secrets. Tombstones retain
    /// remote authority and are included by linkedRemoteCount().
    public func validateDestinationChange(to value: XLogSettings, database: LogbookDatabase?) throws {
        guard !load().hasSameWavelogDestination(as: value) else { return }
        guard let database else { throw WavelogDestinationError.databaseUnavailable }
        guard try database.linkedRemoteCount() == 0 else { throw WavelogDestinationError.linkedContacts }
    }

    public func save(_ value: XLogSettings, protecting database: LogbookDatabase?) throws {
        try validateDestinationChange(to: value, database: database)
        let data = try JSONEncoder().encode(value)
        defaults.set(data, forKey: key)
    }

    /// Pending form values must not relabel the current logbook's authority.
    public func validateCurrentDestination(_ value: XLogSettings) throws {
        guard load().hasSameWavelogDestination(as: value) else {
            throw WavelogDestinationError.unsavedDestination
        }
    }

    public func wavelogConfiguration(for value: XLogSettings, token: String) throws -> WavelogConfiguration {
        try validateCurrentDestination(value)
        guard let url = URL(string: value.wavelogURL) else { throw WavelogClientError.invalidURL }
        return try WavelogConfiguration(baseURL: url, token: token, stationID: value.wavelogStationID)
    }
}
