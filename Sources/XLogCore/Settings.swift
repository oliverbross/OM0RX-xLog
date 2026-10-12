import Foundation

public enum LogbookMode: String, Codable, Equatable, Sendable {
    case local
    case wavelog
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
    public var defaultRadio: String
    public var wavelogURL: String
    public var wavelogStationID: Int
    public var logbookMode: LogbookMode
    public var automaticSync: Bool
    public var syncIntervalMinutes: Int
    public var qrzUsername: String
    public var qrzEnabled: Bool
    public var xcatHost: String
    public var xcatRigCtlPort: Int
    public var clubLogCTYURL: String
    public var lotwActivityURL: String
    public var stationEquipment = StationEquipment()

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
        xcatHost: "127.0.0.1",
        xcatRigCtlPort: 14532,
        clubLogCTYURL: "https://cdn.clublog.org/cty.php",
        lotwActivityURL: "https://lotw.arrl.org/lotw-user-activity.csv"
    )
}

extension XLogSettings {
    private enum CodingKeys: String, CodingKey {
        case operatorCall, stationCall, gridSquare, stationLocation, defaultPower, defaultRadio
        case wavelogURL, wavelogStationID, logbookMode, automaticSync, syncIntervalMinutes
        case qrzUsername, qrzEnabled, xcatHost, xcatRigCtlPort, clubLogCTYURL, lotwActivityURL
        case stationEquipment
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        operatorCall = try values.decode(String.self, forKey: .operatorCall)
        stationCall = try values.decode(String.self, forKey: .stationCall)
        gridSquare = try values.decode(String.self, forKey: .gridSquare)
        stationLocation = try values.decode(String.self, forKey: .stationLocation)
        defaultPower = try values.decode(String.self, forKey: .defaultPower)
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
        xcatHost = try values.decode(String.self, forKey: .xcatHost)
        xcatRigCtlPort = try values.decode(Int.self, forKey: .xcatRigCtlPort)
        clubLogCTYURL = try values.decode(String.self, forKey: .clubLogCTYURL)
        lotwActivityURL = try values.decode(String.self, forKey: .lotwActivityURL)
        stationEquipment = try values.decodeIfPresent(StationEquipment.self, forKey: .stationEquipment) ?? StationEquipment()
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
}
