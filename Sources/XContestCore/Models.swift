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

    public init(callsign: String, entity: ContestEntitySnapshot?, sentExchange: String,
                operatorCallsigns: [String] = [], location: String = "") {
        self.callsign = callsign.uppercased()
        self.entity = entity
        self.sentExchange = sentExchange
        self.operatorCallsigns = operatorCallsigns.map { $0.uppercased() }
        self.location = location
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

public struct ContestExchangeSnapshot: Codable, Hashable, Sendable {
    public let rawSent: String
    public let normalizedSent: String
    public let rawReceived: String
    public let normalizedReceived: String

    public init(rawSent: String, normalizedSent: String, rawReceived: String, normalizedReceived: String) {
        self.rawSent = rawSent
        self.normalizedSent = normalizedSent
        self.rawReceived = rawReceived
        self.normalizedReceived = normalizedReceived
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

    public init(id: UUID, sessionID: UUID, timestampUTC: Date, callsign: String, band: String,
                mode: String, frequencyHz: Int64, rstSent: String, rstReceived: String,
                exchange: ContestExchangeSnapshot, entity: ContestEntitySnapshot?,
                operatorCallsign: String = "", stationLocation: String = "",
                provenance: ContestQSOProvenance) {
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
