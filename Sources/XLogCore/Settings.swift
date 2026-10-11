import Foundation

public struct XLogSettings: Codable, Equatable, Sendable {
    public var operatorCall: String
    public var stationCall: String
    public var gridSquare: String
    public var stationLocation: String
    public var defaultPower: String
    public var defaultRadio: String
    public var wavelogURL: String
    public var wavelogStationID: Int
    public var automaticSync: Bool
    public var syncIntervalMinutes: Int
    public var qrzUsername: String
    public var qrzEnabled: Bool
    public var xcatHost: String
    public var xcatRigCtlPort: Int
    public var clubLogCTYURL: String
    public var lotwActivityURL: String

    public static let defaults = XLogSettings(
        operatorCall: "OM0RX",
        stationCall: "OM0RX",
        gridSquare: "",
        stationLocation: "",
        defaultPower: "100",
        defaultRadio: "OM0RX-xCat",
        wavelogURL: "https://om0rx.wavelog.online",
        wavelogStationID: 0,
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
