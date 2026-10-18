import Foundation

public struct ContestRuleIdentity: Codable, Hashable, Sendable {
    public let id: String
    public let version: String
    public let edition: String
    public let sourceRevision: String

    public init(id: String, version: String, edition: String, sourceRevision: String) {
        self.id = id
        self.version = version
        self.edition = edition
        self.sourceRevision = sourceRevision
    }
}

public struct ContestEntitySnapshot: Codable, Hashable, Sendable {
    public let adif: Int
    public let name: String
    public let countryPrefix: String
    public let continent: String
    public let cqZone: Int

    public init(adif: Int, name: String, countryPrefix: String, continent: String, cqZone: Int) {
        self.adif = adif
        self.name = name
        self.countryPrefix = countryPrefix.uppercased()
        self.continent = continent.uppercased()
        self.cqZone = cqZone
    }
}

public struct ContestStationSnapshot: Codable, Hashable, Sendable {
    public let callsign: String
    public let entity: ContestEntitySnapshot?
    public let sentExchange: String
    public let operatorCallsigns: [String]
    public let location: String
    public let sentExchangeFields: [String: ContestExchangeFieldValue]

    public init(callsign: String, entity: ContestEntitySnapshot?, sentExchange: String,
                operatorCallsigns: [String] = [], location: String = "",
                sentExchangeFields: [String: ContestExchangeFieldValue] = [:]) {
        self.callsign = callsign.uppercased()
        self.entity = entity
        self.sentExchange = sentExchange
        self.operatorCallsigns = operatorCallsigns.map { $0.uppercased() }
        self.location = location
        self.sentExchangeFields = sentExchangeFields
    }

    private enum CodingKeys: String, CodingKey {
        case callsign, entity, sentExchange, operatorCallsigns, location, sentExchangeFields
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        callsign = try values.decode(String.self, forKey: .callsign)
        entity = try values.decodeIfPresent(ContestEntitySnapshot.self, forKey: .entity)
        sentExchange = try values.decode(String.self, forKey: .sentExchange)
        operatorCallsigns = try values.decode([String].self, forKey: .operatorCallsigns)
        location = try values.decode(String.self, forKey: .location)
        sentExchangeFields = try values.decodeIfPresent([String: ContestExchangeFieldValue].self,
                                                        forKey: .sentExchangeFields) ?? [:]
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(callsign, forKey: .callsign)
        try values.encodeIfPresent(entity, forKey: .entity)
        try values.encode(sentExchange, forKey: .sentExchange)
        try values.encode(operatorCallsigns, forKey: .operatorCallsigns)
        try values.encode(location, forKey: .location)
        if !sentExchangeFields.isEmpty { try values.encode(sentExchangeFields, forKey: .sentExchangeFields) }
    }
}

public struct ContestSessionSnapshot: Codable, Hashable, Sendable {
    public let id: UUID
    public let workspaceGeneration: UUID
    public let rule: ContestRuleIdentity
    public let referenceDataVersion: String
    public let startedAt: Date
    public let endedAt: Date?
    public let station: ContestStationSnapshot

    public init(id: UUID, workspaceGeneration: UUID, rule: ContestRuleIdentity,
                referenceDataVersion: String, startedAt: Date, endedAt: Date? = nil,
                station: ContestStationSnapshot) {
        self.id = id
        self.workspaceGeneration = workspaceGeneration
        self.rule = rule
        self.referenceDataVersion = referenceDataVersion
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.station = station
    }
}

public struct ContestExchangeFieldValue: Codable, Hashable, Sendable {
    public let raw: String
    public let normalized: String

    public init(raw: String, normalized: String) {
        self.raw = raw
        self.normalized = normalized
    }
}

public struct ContestExchangeSnapshot: Codable, Hashable, Sendable {
    public let rawSent: String
    public let normalizedSent: String
    public let rawReceived: String
    public let normalizedReceived: String
    public let sentFields: [String: ContestExchangeFieldValue]
    public let receivedFields: [String: ContestExchangeFieldValue]

    public init(rawSent: String, normalizedSent: String, rawReceived: String, normalizedReceived: String,
                sentFields: [String: ContestExchangeFieldValue] = [:],
                receivedFields: [String: ContestExchangeFieldValue] = [:]) {
        self.rawSent = rawSent
        self.normalizedSent = normalizedSent
        self.rawReceived = rawReceived
        self.normalizedReceived = normalizedReceived
        self.sentFields = sentFields
        self.receivedFields = receivedFields
    }

    private enum CodingKeys: String, CodingKey {
        case rawSent, normalizedSent, rawReceived, normalizedReceived, sentFields, receivedFields
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        rawSent = try values.decode(String.self, forKey: .rawSent)
        normalizedSent = try values.decode(String.self, forKey: .normalizedSent)
        rawReceived = try values.decode(String.self, forKey: .rawReceived)
        normalizedReceived = try values.decode(String.self, forKey: .normalizedReceived)
        sentFields = try values.decodeIfPresent([String: ContestExchangeFieldValue].self, forKey: .sentFields) ?? [:]
        receivedFields = try values.decodeIfPresent([String: ContestExchangeFieldValue].self, forKey: .receivedFields) ?? [:]
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(rawSent, forKey: .rawSent)
        try values.encode(normalizedSent, forKey: .normalizedSent)
        try values.encode(rawReceived, forKey: .rawReceived)
        try values.encode(normalizedReceived, forKey: .normalizedReceived)
        if !sentFields.isEmpty { try values.encode(sentFields, forKey: .sentFields) }
        if !receivedFields.isEmpty { try values.encode(receivedFields, forKey: .receivedFields) }
    }
}

public struct ContestQSOProvenance: Codable, Hashable, Sendable {
    public enum Source: String, Codable, Sendable { case operatorEntry, importFile, digitalReceiver, networkPeer }
    public let source: Source
    public let sourceIdentity: String?
    public let importedClaimedScore: Int64?

    public init(source: Source, sourceIdentity: String? = nil, importedClaimedScore: Int64? = nil) {
        self.source = source
        self.sourceIdentity = sourceIdentity
        self.importedClaimedScore = importedClaimedScore
    }
}

public struct ContestQSO: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public let sessionID: UUID
    public let timestampUTC: Date
    public let callsign: String
    public let band: String
    public let mode: String
    public let frequencyHz: Int64
    public let rstSent: String
    public let rstReceived: String
    public let exchange: ContestExchangeSnapshot
    public let entity: ContestEntitySnapshot?
    public let operatorCallsign: String
    public let stationLocation: String
    public let provenance: ContestQSOProvenance
    public let operatorStyle: ContestOperatorStyle?

    public init(id: UUID, sessionID: UUID, timestampUTC: Date, callsign: String, band: String,
                mode: String, frequencyHz: Int64, rstSent: String, rstReceived: String,
                exchange: ContestExchangeSnapshot, entity: ContestEntitySnapshot?,
                operatorCallsign: String = "", stationLocation: String = "",
                provenance: ContestQSOProvenance, operatorStyle: ContestOperatorStyle? = nil) {
        self.id = id
        self.sessionID = sessionID
        self.timestampUTC = timestampUTC
        self.callsign = callsign.uppercased()
        self.band = band.lowercased()
        self.mode = mode.uppercased()
        self.frequencyHz = frequencyHz
        self.rstSent = rstSent
        self.rstReceived = rstReceived
        self.exchange = exchange
        self.entity = entity
        self.operatorCallsign = operatorCallsign.uppercased()
        self.stationLocation = stationLocation
        self.provenance = provenance
        self.operatorStyle = operatorStyle
    }

    private enum CodingKeys: String, CodingKey {
        case id, sessionID, timestampUTC, callsign, band, mode, frequencyHz
        case rstSent, rstReceived, exchange, entity, operatorCallsign, stationLocation
        case provenance, operatorStyle
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        sessionID = try values.decode(UUID.self, forKey: .sessionID)
        timestampUTC = try values.decode(Date.self, forKey: .timestampUTC)
        callsign = try values.decode(String.self, forKey: .callsign)
        band = try values.decode(String.self, forKey: .band)
        mode = try values.decode(String.self, forKey: .mode)
        frequencyHz = try values.decode(Int64.self, forKey: .frequencyHz)
        rstSent = try values.decode(String.self, forKey: .rstSent)
        rstReceived = try values.decode(String.self, forKey: .rstReceived)
        exchange = try values.decode(ContestExchangeSnapshot.self, forKey: .exchange)
        entity = try values.decodeIfPresent(ContestEntitySnapshot.self, forKey: .entity)
        operatorCallsign = try values.decode(String.self, forKey: .operatorCallsign)
        stationLocation = try values.decode(String.self, forKey: .stationLocation)
        provenance = try values.decode(ContestQSOProvenance.self, forKey: .provenance)
        operatorStyle = try values.decodeIfPresent(ContestOperatorStyle.self, forKey: .operatorStyle)
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(sessionID, forKey: .sessionID)
        try values.encode(timestampUTC, forKey: .timestampUTC)
        try values.encode(callsign, forKey: .callsign)
        try values.encode(band, forKey: .band)
        try values.encode(mode, forKey: .mode)
        try values.encode(frequencyHz, forKey: .frequencyHz)
        try values.encode(rstSent, forKey: .rstSent)
        try values.encode(rstReceived, forKey: .rstReceived)
        try values.encode(exchange, forKey: .exchange)
        try values.encodeIfPresent(entity, forKey: .entity)
        try values.encode(operatorCallsign, forKey: .operatorCallsign)
        try values.encode(stationLocation, forKey: .stationLocation)
        try values.encode(provenance, forKey: .provenance)
        try values.encodeIfPresent(operatorStyle, forKey: .operatorStyle)
    }
}

public enum ContestValidationSeverity: String, Codable, Sendable { case warning, error }

public struct ContestValidationIssue: Codable, Hashable, Sendable {
    public let code: String
    public let field: String
    public let severity: ContestValidationSeverity
    public let message: String

    public init(code: String, field: String, severity: ContestValidationSeverity = .error, message: String) {
        self.code = code
        self.field = field
        self.severity = severity
        self.message = message
    }
}

public struct ContestMultiplierKey: Codable, Hashable, Sendable, Comparable {
    public let kind: String
    public let value: String
    public let scope: String

    public init(kind: String, value: String, scope: String) {
        self.kind = kind
        self.value = value
        self.scope = scope
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        (lhs.kind, lhs.scope, lhs.value) < (rhs.kind, rhs.scope, rhs.value)
    }
}
