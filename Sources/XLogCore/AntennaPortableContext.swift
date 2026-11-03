import Foundation

/// Software metadata only. This type has no provider or hardware authority.
public struct AntennaProfile: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var antennaType: StationEquipment.Antenna
    public var bands: [String]
    /// Durable reference to the workspace's existing single rotor configuration.
    public var rotorConfigurationID: String?
    public var azimuthOffsetDegrees: Double
    public var archived: Bool
    public var revision: Int
    public init(id: String = UUID().uuidString, name: String, antennaType: StationEquipment.Antenna = .vertical,
                bands: [String] = [], rotorConfigurationID: String? = nil, azimuthOffsetDegrees: Double = 0,
                archived: Bool = false, revision: Int = 0) {
        self.id = id; self.name = name; self.antennaType = antennaType; self.bands = bands
        self.rotorConfigurationID = rotorConfigurationID; self.azimuthOffsetDegrees = azimuthOffsetDegrees
        self.archived = archived; self.revision = revision
    }
    public static let workspaceRotorID = "workspace-rotor"
    public func antennaHeading(observedRotorHeading: Double) -> Double { Self.normalized(observedRotorHeading + azimuthOffsetDegrees) }
    public func rotorTarget(antennaBearing: Double) -> Double { Self.normalized(antennaBearing - azimuthOffsetDegrees) }
    private static func normalized(_ value: Double) -> Double { (value.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) }
    public func applying(to qso: QSO) -> QSO {
        var qso = qso
        for (key, value) in ["ID": id, "NAME": name, "TYPE": antennaType.rawValue,
                              "BANDS": bands.joined(separator: ","), "OFFSET": String(azimuthOffsetDegrees),
                              "REVISION": String(revision), "ROTOR": rotorConfigurationID ?? ""] {
            qso.extraFields["APP_OM0RXXLOG_ANTENNA_" + key] = value
        }
        return qso
    }
}

public extension StationEquipment {
    enum ProfileChoice: Equatable, Sendable { case selected(AntennaProfile), choice([String]), retained(String?) }
    func profileChoice(transmitBand: String?, fresh: Bool, manualOverride: Bool = false) -> ProfileChoice {
        let current = profiles.first { $0.id == selectedProfileID && !$0.archived }
        guard automaticSelection, !manualOverride, fresh, let band = transmitBand, !band.isEmpty else {
            return current.map(ProfileChoice.selected) ?? .retained(selectedProfileID)
        }
        let eligible = profiles.filter { !$0.archived && $0.bands.contains(band) }
        if let preference = bandPreferences[band], let selected = eligible.first(where: { $0.id == preference }) { return .selected(selected) }
        if eligible.count == 1 { return .selected(eligible[0]) }
        return eligible.isEmpty ? .retained(selectedProfileID) : .choice(eligible.map(\.id))
    }
    func validateProfiles() throws {
        guard version == 1, profiles.count <= 64, Set(profiles.map(\.id)).count == profiles.count,
              bandPreferences.count <= 64, bandPreferences.allSatisfy({ entry in entry.key.utf8.count <= 16 && profiles.contains(where: { $0.id == entry.value }) }),
              profiles.allSatisfy({ p in
                  !p.id.isEmpty && p.id.utf8.count <= 64 && !p.name.isEmpty && p.name.utf8.count <= 256 &&
                  p.bands.count <= 64 && p.bands.allSatisfy({ $0.utf8.count <= 16 }) &&
                  p.azimuthOffsetDegrees.isFinite && (-360...360).contains(p.azimuthOffsetDegrees) &&
                  (p.rotorConfigurationID == nil || p.rotorConfigurationID == AntennaProfile.workspaceRotorID) &&
                  (0...Int(Int32.max)).contains(p.revision)
              }), selectedProfileID == nil || profiles.contains(where: { $0.id == selectedProfileID }) else { throw IntegrationSettingsError.invalid }
    }
}

public struct PortablePreset: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var stationCall: String
    public var operatorCall: String
    public var locator: String
    public var location: String
    public var state: String
    public var ownReferences: [String: [String]]
    public var power: String
    public var antennaProfileID: String?
    public var ownDXCC: Int?
    public init(id: String = UUID().uuidString, name: String, stationCall: String = "", operatorCall: String = "",
                locator: String = "", location: String = "", state: String = "", ownReferences: [String: [String]] = [:],
                power: String = "", antennaProfileID: String? = nil, ownDXCC: Int? = nil) {
        self.id = id; self.name = name; self.stationCall = stationCall; self.operatorCall = operatorCall
        self.locator = locator; self.location = location; self.state = state; self.ownReferences = ownReferences
        self.power = power; self.antennaProfileID = antennaProfileID
        self.ownDXCC = ownDXCC
    }
}
public struct PortableActiveContext: Codable, Equatable, Sendable {
    public var sessionID: String
    public var revision: Int
    public var startedAt: Date
    public var preset: PortablePreset
    public init(preset: PortablePreset, sessionID: String = UUID().uuidString, revision: Int = 0, startedAt: Date = Date()) {
        self.preset = preset; self.sessionID = sessionID; self.revision = revision; self.startedAt = startedAt
    }
    public func applying(to qso: QSO, equipment: StationEquipment) -> QSO {
        var qso = qso
        qso.myCall = preset.stationCall; qso.operatorCall = preset.operatorCall
        qso.myGrid = preset.locator; qso.stationLocation = preset.location; qso.txPower = preset.power
        qso.extraFields["MY_STATE"] = preset.state
        if let ownDXCC = preset.ownDXCC { qso.extraFields["MY_DXCC"] = String(ownDXCC) }
        else { qso.extraFields.removeValue(forKey: "MY_DXCC") }
        qso.extraFields["APP_OM0RXXLOG_PORTABLE_SESSION"] = sessionID
        qso.extraFields["APP_OM0RXXLOG_PORTABLE_NAME"] = preset.name
        qso.extraFields["APP_OM0RXXLOG_PORTABLE_REVISION"] = String(revision)
        qso.extraFields["APP_OM0RXXLOG_PORTABLE_DEFAULT_POWER"] = preset.power
        qso.extraFields["APP_OM0RXXLOG_PORTABLE_STARTED"] = ISO8601DateFormatter().string(from: startedAt)
        for (programme, refs) in preset.ownReferences {
            let field = ["SOTA": "MY_SOTA_REF", "IOTA": "MY_IOTA", "WWFF": "MY_WWFF_REF", "POTA": "MY_POTA_REF"][programme]
            if let field { qso.extraFields[field] = refs.joined(separator: ",") }
        }
        if let parks = preset.ownReferences["POTA"], !parks.isEmpty {
            qso.extraFields["MY_SIG"] = "POTA"; qso.extraFields["MY_SIG_INFO"] = parks.joined(separator: ",")
        }
        if let antenna = equipment.profiles.first(where: { $0.id == preset.antennaProfileID && !$0.archived }) { qso = antenna.applying(to: qso) }
        return qso
    }
}
public struct PortableOperatingSettings: Codable, Equatable, Sendable {
    public var version = 1
    public var presets: [PortablePreset] = []
    public var activeContext: PortableActiveContext?
    public init() {}
    private enum CodingKeys: String, CodingKey { case version, presets, activeContext }
    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(version, forKey: .version); try values.encode(presets, forKey: .presets)
        if let activeContext { try values.encode(activeContext, forKey: .activeContext) }
        else { try values.encodeNil(forKey: .activeContext) }
    }
    public func validate() throws {
        let all = presets + (activeContext.map { [$0.preset] } ?? [])
        guard version == 1, presets.count <= 32, Set(presets.map(\.id)).count == presets.count,
              activeContext.map({ !$0.sessionID.isEmpty && $0.sessionID.utf8.count <= 64 && $0.revision >= 0 && $0.startedAt.timeIntervalSince1970.isFinite }) ?? true,
              all.allSatisfy({ p in
                  !p.id.isEmpty && p.id.utf8.count <= 64 && !p.name.isEmpty && p.name.utf8.count <= 128 &&
                  [p.stationCall, p.operatorCall, p.locator, p.state, p.power].allSatisfy({ $0.utf8.count <= 64 }) &&
                  p.location.utf8.count <= 512 && p.ownReferences.count <= 5 &&
                  (p.ownDXCC.map { (1...1000).contains($0) } ?? true) &&
                  p.ownReferences.allSatisfy({ ["POTA", "SOTA", "WWFF", "IOTA", "CASTLE"].contains($0.key) && $0.value.count <= 16 && $0.value.allSatisfy({ $0.utf8.count <= 64 }) })
              }) else { throw IntegrationSettingsError.invalid }
    }
}

public extension XLogSettings {
    /// Called only when constructing a new blank draft. Existing drafts/contacts
    /// retain their own immutable values even after a preset is edited or ended.
    func applyingOperatingDefaults(to qso: QSO, authoritativeTransmitBand: String? = nil) -> QSO {
        var qso = qso
        if case .selected(let profile) = stationEquipment.profileChoice(transmitBand: authoritativeTransmitBand, fresh: authoritativeTransmitBand != nil) { qso = profile.applying(to: qso) }
        if let active = portableOperating.activeContext { qso = active.applying(to: qso, equipment: stationEquipment) }
        return qso
    }
}
