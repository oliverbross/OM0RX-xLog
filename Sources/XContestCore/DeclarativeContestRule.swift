import Foundation

private struct ContestDefinitionCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

public enum ContestDeclarativeDupePolicy: String, Codable, Hashable, Sendable {
    case oncePerContest
    case perBand
    case perBandMode
    case none
}

public enum ContestDeclarativeMultiplierPolicy: String, Codable, Hashable, Sendable {
    case none
    case uniqueCallsign
    case geographic
}

public struct ContestDeclarativeGeographicSubdivisionPolicy: Codable, Hashable, Sendable {
    public let entityADIF: Int
    public let authority: String
    public let values: Set<String>

    public init(entityADIF: Int, authority: String, values: Set<String>) {
        self.entityADIF = entityADIF
        self.authority = authority
        self.values = values
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case entityADIF, authority, values }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: ContestDefinitionCodingKey.self)
        let expected = Set(CodingKeys.allCases.map(\.rawValue))
        let unknown = Set(dynamic.allKeys.map(\.stringValue)).subtracting(expected)
        guard unknown.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                    debugDescription: "Unknown geographic subdivision keys: \(unknown.sorted())"))
        }
        let values = try decoder.container(keyedBy: CodingKeys.self)
        entityADIF = try values.decode(Int.self, forKey: .entityADIF)
        authority = try values.decode(String.self, forKey: .authority)
        let decodedValues = try values.decode([String].self, forKey: .values)
        guard Set(decodedValues).count == decodedValues.count else {
            throw DecodingError.dataCorruptedError(forKey: .values, in: values,
                                                   debugDescription: "Geographic subdivision values must be unique.")
        }
        self.values = Set(decodedValues)
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(entityADIF, forKey: .entityADIF)
        try values.encode(authority, forKey: .authority)
        try values.encode(self.values.sorted(), forKey: .values)
    }
}

public struct ContestDeclarativeGeographicEntityFallback: Codable, Hashable, Sendable {
    public let authority: String
    public let locationToken: String

    public init(authority: String, locationToken: String) {
        self.authority = authority
        self.locationToken = locationToken
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case authority, locationToken }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: ContestDefinitionCodingKey.self)
        let expected = Set(CodingKeys.allCases.map(\.rawValue))
        let unknown = Set(dynamic.allKeys.map(\.stringValue)).subtracting(expected)
        guard unknown.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                    debugDescription: "Unknown geographic entity fallback keys: \(unknown.sorted())"))
        }
        let values = try decoder.container(keyedBy: CodingKeys.self)
        authority = try values.decode(String.self, forKey: .authority)
        locationToken = try values.decode(String.self, forKey: .locationToken)
    }
}

public struct ContestDeclarativeGeographicMultiplierPolicy: Codable, Hashable, Sendable {
    public let locationFieldID: String
    public let subdivisions: [ContestDeclarativeGeographicSubdivisionPolicy]
    public let entityFallback: ContestDeclarativeGeographicEntityFallback

    public init(locationFieldID: String,
                subdivisions: [ContestDeclarativeGeographicSubdivisionPolicy],
                entityFallback: ContestDeclarativeGeographicEntityFallback) {
        self.locationFieldID = locationFieldID
        self.subdivisions = subdivisions.sorted {
            ($0.entityADIF, $0.authority) < ($1.entityADIF, $1.authority)
        }
        self.entityFallback = entityFallback
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case locationFieldID, subdivisions, entityFallback
    }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: ContestDefinitionCodingKey.self)
        let expected = Set(CodingKeys.allCases.map(\.rawValue))
        let unknown = Set(dynamic.allKeys.map(\.stringValue)).subtracting(expected)
        guard unknown.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                    debugDescription: "Unknown geographic multiplier keys: \(unknown.sorted())"))
        }
        let values = try decoder.container(keyedBy: CodingKeys.self)
        locationFieldID = try values.decode(String.self, forKey: .locationFieldID)
        subdivisions = try values.decode([ContestDeclarativeGeographicSubdivisionPolicy].self,
                                          forKey: .subdivisions).sorted {
            ($0.entityADIF, $0.authority) < ($1.entityADIF, $1.authority)
        }
        entityFallback = try values.decode(ContestDeclarativeGeographicEntityFallback.self,
                                           forKey: .entityFallback)
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(locationFieldID, forKey: .locationFieldID)
        try values.encode(subdivisions.sorted {
            ($0.entityADIF, $0.authority) < ($1.entityADIF, $1.authority)
        }, forKey: .subdivisions)
        try values.encode(entityFallback, forKey: .entityFallback)
    }
}

public enum ContestDeclarativeEligibilityPolicy: Codable, Hashable, Sendable {
    case unrestricted
    case stationFieldIntegerGreaterThan(fieldID: String, threshold: Int)
}

public enum ContestDeclarativeExportPolicy: String, Codable, Hashable, Sendable {
    case unsupported
    case operatorArchive
}

public enum ContestDeclarativeExportPurpose: String, Codable, Hashable, Sendable {
    case operatorArchive
}

public enum ContestDeclarativeDuplicateRecords: String, Codable, Hashable, Sendable {
    case retainAll
}

public enum ContestDeclarativeColumnAlignment: String, Codable, Hashable, Sendable {
    case left
    case right
}

public enum ContestDeclarativeColumnSource: Codable, Hashable, Sendable {
    case frequencyKHz
    case mode
    case date
    case time
    case stationCallsign
    case contactedCallsign
    case sentReport
    case receivedReport
    case sentField(String)
    case receivedField(String)
}

public struct ContestDeclarativeExportColumn: Codable, Hashable, Sendable {
    public let source: ContestDeclarativeColumnSource
    public let width: Int
    public let alignment: ContestDeclarativeColumnAlignment
    public let required: Bool

    public init(source: ContestDeclarativeColumnSource, width: Int,
                alignment: ContestDeclarativeColumnAlignment = .left, required: Bool = true) {
        self.source = source
        self.width = width
        self.alignment = alignment
        self.required = required
    }
}

public struct ContestDeclarativeExportProjection: Codable, Hashable, Sendable {
    public let formatterVersion: String
    public let purpose: ContestDeclarativeExportPurpose
    public let duplicateRecords: ContestDeclarativeDuplicateRecords
    public let columns: [ContestDeclarativeExportColumn]

    public init(formatterVersion: String, purpose: ContestDeclarativeExportPurpose = .operatorArchive,
                duplicateRecords: ContestDeclarativeDuplicateRecords = .retainAll,
                columns: [ContestDeclarativeExportColumn]) {
        self.formatterVersion = formatterVersion
        self.purpose = purpose
        self.duplicateRecords = duplicateRecords
        self.columns = columns
    }
}

public enum ContestIntegerComparison: String, Codable, Hashable, Sendable {
    case greaterThan
}

public struct ContestIntegerPointClause: Codable, Hashable, Sendable {
    public let fieldID: String
    public let comparison: ContestIntegerComparison
    public let threshold: Int
    public let points: Int64

    public init(fieldID: String, comparison: ContestIntegerComparison, threshold: Int, points: Int64) {
        self.fieldID = fieldID
        self.comparison = comparison
        self.threshold = threshold
        self.points = points
    }
}

public struct ContestDeclarativeScoringPolicy: Codable, Hashable, Sendable {
    public let defaultPoints: Int64
    public let clauses: [ContestIntegerPointClause]

    public init(defaultPoints: Int64, clauses: [ContestIntegerPointClause]) {
        self.defaultPoints = defaultPoints
        self.clauses = clauses
    }
}

public struct ContestDefinitionDraft: Codable, Hashable, Sendable {
    public let id: String
    public let version: String
    public let edition: String
    public let displayName: String
    public let cabrilloName: String
    public let supportedBands: Set<String>
    public let supportedModes: Set<String>
    public let entry: ContestEntryDescriptor
    public let sourceProvenance: String
    public let dupePolicy: ContestDeclarativeDupePolicy
    public let multiplierPolicy: ContestDeclarativeMultiplierPolicy
    public let geographicMultiplier: ContestDeclarativeGeographicMultiplierPolicy?
    public let scoring: ContestDeclarativeScoringPolicy
    public let eligibilityPolicy: ContestDeclarativeEligibilityPolicy
    public let exportPolicy: ContestDeclarativeExportPolicy
    public let exportProjection: ContestDeclarativeExportProjection?
    public let operatorPolicy: ContestDeclarativeOperatorPolicy?
    public let stationEntityRequired: Bool
    public let adapterID: String?

    public init(id: String, version: String, edition: String, displayName: String, cabrilloName: String,
                supportedBands: Set<String>, supportedModes: Set<String>, entry: ContestEntryDescriptor,
                sourceProvenance: String, dupePolicy: ContestDeclarativeDupePolicy,
                multiplierPolicy: ContestDeclarativeMultiplierPolicy,
                geographicMultiplier: ContestDeclarativeGeographicMultiplierPolicy? = nil,
                scoring: ContestDeclarativeScoringPolicy,
                eligibilityPolicy: ContestDeclarativeEligibilityPolicy = .unrestricted,
                exportPolicy: ContestDeclarativeExportPolicy = .unsupported,
                exportProjection: ContestDeclarativeExportProjection? = nil,
                operatorPolicy: ContestDeclarativeOperatorPolicy? = nil,
                stationEntityRequired: Bool,
                adapterID: String? = nil) {
        self.id = id
        self.version = version
        self.edition = edition
        self.displayName = displayName
        self.cabrilloName = cabrilloName
        self.supportedBands = supportedBands
        self.supportedModes = supportedModes
        self.entry = entry
        self.sourceProvenance = sourceProvenance
        self.dupePolicy = dupePolicy
        self.multiplierPolicy = multiplierPolicy
        self.geographicMultiplier = geographicMultiplier
        self.scoring = scoring
        self.eligibilityPolicy = eligibilityPolicy
        self.exportPolicy = exportPolicy
        self.exportProjection = exportProjection
        self.operatorPolicy = operatorPolicy
        self.stationEntityRequired = stationEntityRequired
        self.adapterID = adapterID
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case id, version, edition, displayName, cabrilloName, supportedBands, supportedModes, entry,
             sourceProvenance, dupePolicy, multiplierPolicy, geographicMultiplier, scoring, eligibilityPolicy, exportPolicy,
             exportProjection, operatorPolicy, stationEntityRequired, adapterID
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: ContestDefinitionCodingKey.self)
        let expected = Set(CodingKeys.allCases.map(\.rawValue))
        let unknown = Set(values.allKeys.map(\.stringValue)).subtracting(expected)
        guard unknown.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                    debugDescription: "Unknown definition keys: \(unknown.sorted())"))
        }
        func key(_ value: CodingKeys) -> ContestDefinitionCodingKey { .init(stringValue: value.rawValue) }
        id = try values.decode(String.self, forKey: key(.id))
        version = try values.decode(String.self, forKey: key(.version))
        edition = try values.decode(String.self, forKey: key(.edition))
        displayName = try values.decode(String.self, forKey: key(.displayName))
        cabrilloName = try values.decode(String.self, forKey: key(.cabrilloName))
        supportedBands = try values.decode(Set<String>.self, forKey: key(.supportedBands))
        supportedModes = try values.decode(Set<String>.self, forKey: key(.supportedModes))
        entry = try values.decode(ContestEntryDescriptor.self, forKey: key(.entry))
        sourceProvenance = try values.decode(String.self, forKey: key(.sourceProvenance))
        dupePolicy = try values.decode(ContestDeclarativeDupePolicy.self, forKey: key(.dupePolicy))
        multiplierPolicy = try values.decode(ContestDeclarativeMultiplierPolicy.self, forKey: key(.multiplierPolicy))
        geographicMultiplier = try values.decodeIfPresent(ContestDeclarativeGeographicMultiplierPolicy.self,
                                                           forKey: key(.geographicMultiplier))
        scoring = try values.decode(ContestDeclarativeScoringPolicy.self, forKey: key(.scoring))
        eligibilityPolicy = try values.decode(ContestDeclarativeEligibilityPolicy.self, forKey: key(.eligibilityPolicy))
        exportPolicy = try values.decode(ContestDeclarativeExportPolicy.self, forKey: key(.exportPolicy))
        exportProjection = try values.decodeIfPresent(ContestDeclarativeExportProjection.self,
                                                      forKey: key(.exportProjection))
        operatorPolicy = try values.decodeIfPresent(ContestDeclarativeOperatorPolicy.self,
                                                    forKey: key(.operatorPolicy))
        stationEntityRequired = try values.decode(Bool.self, forKey: key(.stationEntityRequired))
        adapterID = try values.decodeIfPresent(String.self, forKey: key(.adapterID))
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(version, forKey: .version)
        try values.encode(edition, forKey: .edition)
        try values.encode(displayName, forKey: .displayName)
        try values.encode(cabrilloName, forKey: .cabrilloName)
        try values.encode(supportedBands.sorted(), forKey: .supportedBands)
        try values.encode(supportedModes.sorted(), forKey: .supportedModes)
        try values.encode(entry, forKey: .entry)
        try values.encode(sourceProvenance, forKey: .sourceProvenance)
        try values.encode(dupePolicy, forKey: .dupePolicy)
        try values.encode(multiplierPolicy, forKey: .multiplierPolicy)
        try values.encodeIfPresent(geographicMultiplier, forKey: .geographicMultiplier)
        try values.encode(scoring, forKey: .scoring)
        try values.encode(eligibilityPolicy, forKey: .eligibilityPolicy)
        try values.encode(exportPolicy, forKey: .exportPolicy)
        try values.encodeIfPresent(exportProjection, forKey: .exportProjection)
        try values.encodeIfPresent(operatorPolicy, forKey: .operatorPolicy)
        try values.encode(stationEntityRequired, forKey: .stationEntityRequired)
        try values.encodeIfPresent(adapterID, forKey: .adapterID)
    }

    public func materialized() throws -> ContestDeclarativeDefinition {
        try ContestDeclarativeDefinition(draft: self)
    }
}

public enum ContestDefinitionError: Error, Equatable {
    case invalidDefinition([String])
    case digestMismatch
}

public struct ContestDeclarativeDefinition: Codable, Hashable, Sendable {
    public let draft: ContestDefinitionDraft
    public let definitionDigest: String

    public var identity: ContestRuleIdentity {
        .init(id: draft.id, version: draft.version, edition: draft.edition, sourceRevision: definitionDigest)
    }

    public init(draft: ContestDefinitionDraft) throws {
        let diagnostics = Self.diagnostics(for: draft)
        guard diagnostics.isEmpty else { throw ContestDefinitionError.invalidDefinition(diagnostics) }
        self.draft = draft
        self.definitionDigest = try Self.digest(draft)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case draft, definitionDigest }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: ContestDefinitionCodingKey.self)
        let expected = Set(CodingKeys.allCases.map(\.rawValue))
        let unknown = Set(dynamic.allKeys.map(\.stringValue)).subtracting(expected)
        guard unknown.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                    debugDescription: "Unknown materialized definition keys: \(unknown.sorted())"))
        }
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let draft = try values.decode(ContestDefinitionDraft.self, forKey: .draft)
        let supplied = try values.decode(String.self, forKey: .definitionDigest)
        let materialized = try ContestDeclarativeDefinition(draft: draft)
        guard supplied == materialized.definitionDigest else { throw ContestDefinitionError.digestMismatch }
        self = materialized
    }

    public func canonicalStorageData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    private static func digest(_ draft: ContestDefinitionDraft) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return ContestSCPIndex.sha256(try encoder.encode(draft))
    }

    private static func diagnostics(for draft: ContestDefinitionDraft) -> [String] {
        var result: [String] = []
        let identityParts = [draft.id, draft.version, draft.edition]
        if identityParts.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.utf8.count > 128 }) {
            result.append("identity fields must be nonempty and bounded")
        }
        let cabrilloBytes = Array(draft.cabrilloName.utf8)
        if !(1...64).contains(cabrilloBytes.count) ||
            !cabrilloBytes.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 45 }) {
            result.append("Cabrillo contest name must be bounded uppercase ASCII letters, digits, or hyphens")
        }
        if draft.adapterID != nil { result.append("custom adapters are not supported by the declarative engine") }
        if draft.supportedBands.isEmpty || draft.supportedModes.isEmpty { result.append("bands and modes are required") }
        let coherentEntry = draft.entry.isCoherent(supportedModes: draft.supportedModes)
        if !coherentEntry { result.append("entry descriptor is incoherent") }
        switch (draft.entry.scorePolicy, draft.multiplierPolicy, draft.geographicMultiplier) {
        case (.pointsOnly, .none, nil), (.pointsTimesMultipliers, .uniqueCallsign, nil):
            break
        case (.pointsTimesMultipliers, .geographic, let policy?):
            result += geographicDiagnostics(policy, draft: draft)
        default:
            result.append("score and multiplier policies are incompatible")
        }
        result += exportDiagnostics(for: draft)
        result += operatorDiagnostics(for: draft)
        if draft.scoring.defaultPoints < 0 { result.append("default points must be nonnegative") }
        guard coherentEntry else { return result }
        let fields = Dictionary(uniqueKeysWithValues: draft.entry.exchange.receivedFields.map { ($0.id, $0) })
        for clause in draft.scoring.clauses {
            guard let field = fields[clause.fieldID], field.acceptedKinds == [.nonnegativeInteger],
                  field.maximumUTF8Bytes <= 18 else {
                result.append("point clause field \(clause.fieldID) must be a received nonnegativeInteger")
                continue
            }
            if clause.threshold < 0 || clause.points < 0 { result.append("point clauses must use nonnegative values") }
        }
        switch draft.eligibilityPolicy {
        case .unrestricted:
            break
        case let .stationFieldIntegerGreaterThan(fieldID, threshold):
            let sent = Dictionary(uniqueKeysWithValues: draft.entry.exchange.sentFields.map { ($0.id, $0) })
            if threshold < 0 || sent[fieldID]?.acceptedKinds != [.nonnegativeInteger] ||
                (sent[fieldID]?.maximumUTF8Bytes ?? 19) > 18 {
                result.append("eligibility field must be a sent nonnegativeInteger with a nonnegative threshold")
            }
        }
        return result
    }

    private static func geographicDiagnostics(_ policy: ContestDeclarativeGeographicMultiplierPolicy,
                                              draft: ContestDefinitionDraft) -> [String] {
        var result: [String] = []
        let locationField = draft.entry.exchange.receivedFields.first { $0.id == policy.locationFieldID }
        if locationField?.required != true || locationField?.acceptedKinds != [.subdivision] {
            result.append("geographic location field must be a required received subdivision")
        }
        if let maximum = locationField?.maximumUTF8Bytes,
           policy.subdivisions.flatMap(\.values).contains(where: { $0.utf8.count > maximum }) ||
            policy.entityFallback.locationToken.utf8.count > maximum {
            result.append("geographic location values must fit the received field byte bound")
        }
        if policy.subdivisions.count > 8 {
            result.append("geographic subdivision policies must contain 0...8 items")
        }
        if Set(policy.subdivisions.map(\.entityADIF)).count != policy.subdivisions.count {
            result.append("geographic subdivision entity policies must be unique")
        }
        for subdivision in policy.subdivisions {
            if subdivision.entityADIF <= 0 { result.append("geographic entity codes must be positive") }
            if !(1...128).contains(subdivision.values.count) {
                result.append("geographic subdivision values must contain 1...128 items")
            }
            if !validGeographicAuthority(subdivision.authority) {
                result.append("geographic subdivision authorities must be bounded visible ASCII without separators")
            }
            if !subdivision.values.allSatisfy(validGeographicToken) {
                result.append("geographic subdivision values must be bounded uppercase ASCII tokens")
            }
        }
        if !validGeographicAuthority(policy.entityFallback.authority) {
            result.append("geographic entity authority must be bounded visible ASCII without separators")
        }
        if !validGeographicToken(policy.entityFallback.locationToken) {
            result.append("geographic entity fallback token must be a bounded uppercase ASCII token")
        }
        return result
    }

    private static func validGeographicAuthority(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return (1...64).contains(bytes.count) && bytes.allSatisfy { (33...126).contains($0) && $0 != 124 }
    }

    private static func validGeographicToken(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return (1...8).contains(bytes.count) && bytes.allSatisfy {
            (65...90).contains($0) || (48...57).contains($0)
        }
    }

    private static func exportDiagnostics(for draft: ContestDefinitionDraft) -> [String] {
        switch (draft.exportPolicy, draft.exportProjection) {
        case (.unsupported, nil):
            return []
        case (.operatorArchive, let projection?):
            var result: [String] = []
            if projection.formatterVersion.isEmpty || projection.formatterVersion.utf8.count > 64 ||
                !projection.formatterVersion.unicodeScalars.allSatisfy({ (33...126).contains($0.value) }) {
                result.append("export formatter version must be bounded visible ASCII")
            }
            if projection.purpose != .operatorArchive || projection.duplicateRecords != .retainAll {
                result.append("only retain-all operator archives are supported")
            }
            if projection.columns.isEmpty || projection.columns.count > 24 {
                result.append("export columns must contain 1...24 items")
            }
            let requiredSources: Set<ContestDeclarativeColumnSource> = [
                .frequencyKHz, .mode, .date, .time, .stationCallsign, .contactedCallsign,
            ]
            if !requiredSources.isSubset(of: Set(projection.columns.map(\.source))) {
                result.append("export columns are missing required QSO coordinates")
            }
            if Set(projection.columns.map(\.source)).count != projection.columns.count {
                result.append("export column sources must be unique")
            }
            let sent = Set(draft.entry.exchange.sentFields.map(\.id))
            let received = Set(draft.entry.exchange.receivedFields.map(\.id))
            let projected = Set(projection.columns.map(\.source))
            let requiredSent = Set(draft.entry.exchange.sentFields.filter(\.required).map {
                ContestDeclarativeColumnSource.sentField($0.id)
            })
            let requiredReceived = Set(draft.entry.exchange.receivedFields.filter(\.required).map {
                ContestDeclarativeColumnSource.receivedField($0.id)
            })
            if !requiredSent.union(requiredReceived).isSubset(of: projected) {
                result.append("export columns must include every required exchange field")
            }
            if draft.entry.modeProfiles.contains(where: { $0.report.format != .none }) &&
                !Set([ContestDeclarativeColumnSource.sentReport, .receivedReport]).isSubset(of: projected) {
                result.append("export columns must include both required reports")
            }
            for column in projection.columns {
                if !(1...64).contains(column.width) { result.append("export column widths must be in 1...64") }
                switch column.source {
                case let .sentField(id) where !sent.contains(id):
                    result.append("unknown sent export field \(id)")
                case let .receivedField(id) where !received.contains(id):
                    result.append("unknown received export field \(id)")
                default:
                    break
                }
            }
            if projection.formatterVersion != draft.entry.cabrilloFormatterVersion ||
                projection.formatterVersion != draft.entry.cabrilloProjectionFormatterVersion {
                result.append("export formatter version must match both entry formatter versions")
            }
            return result
        default:
            return ["export policy and projection must be supplied together"]
        }
    }

    private static func operatorDiagnostics(for draft: ContestDefinitionDraft) -> [String] {
        guard let policy = draft.operatorPolicy else { return [] }
        guard policy.version == ContestDeclarativeOperatorPolicy.version,
              policy.policy == ContestDeclarativeOperatorPolicy.policy,
              policy.output == ContestDeclarativeOperatorPolicy.output else {
            return ["operator policy identifier or version is unsupported"]
        }
        let expected = draft.supportedModes.sorted()
        let actual = policy.signalProfiles.map(\.mode)
        guard actual == expected, Set(actual).count == actual.count else {
            return ["operator policy must map every supported mode exactly once in sorted order"]
        }
        for profile in policy.signalProfiles {
            switch (profile.mode, profile.signal) {
            case ("CW", .cw), ("SSB", .phone), ("AM", .phone), ("FM", .phone):
                continue
            default:
                return ["operator policy contains an unsupported mode or signal mapping"]
            }
        }
        return []
    }
}

public protocol ContestRuleDeclarativeExportPolicy: Sendable {
    var declarativeExportProjection: ContestDeclarativeExportProjection? { get }
}

public struct DeclarativeContestRule: ContestRule, ContestRuleStationEntityPolicy,
                                      ContestRuleDeclarativeExportPolicy {
    public let definition: ContestDeclarativeDefinition
    public let metadata: ContestRuleMetadata
    public var declarativeExportProjection: ContestDeclarativeExportProjection? {
        definition.draft.exportProjection
    }

    public init(definition: ContestDeclarativeDefinition) {
        self.definition = definition
        let draft = definition.draft
        metadata = .init(identity: definition.identity, displayName: draft.displayName,
                         cabrilloName: draft.cabrilloName, supportedBands: draft.supportedBands,
                         supportedModes: draft.supportedModes, entry: draft.entry,
                         sourceProvenance: draft.sourceProvenance)
    }

    public func allowsMissingStationEntity(in session: ContestSessionSnapshot) -> Bool {
        !definition.draft.stationEntityRequired
    }

    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        switch definition.draft.eligibilityPolicy {
        case .unrestricted:
            return []
        case let .stationFieldIntegerGreaterThan(fieldID, threshold):
            guard let text = session.station.sentExchangeFields[fieldID]?.normalized,
                  let value = Int(text), value > threshold else {
                return [.init(code: "ineligibleStationExchange", field: "station.sentExchangeFields.\(fieldID)",
                              message: "Station exchange does not satisfy the definition's entrant eligibility policy.")]
            }
            return []
        }
    }

    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        var issues: [ContestValidationIssue] = []
        if !Self.validCallsign(qso.callsign) {
            issues.append(.init(code: "invalidCallsign", field: "callsign", message: "A bounded ASCII callsign is required."))
        }
        if !metadata.supportedBands.contains(qso.band) {
            issues.append(.init(code: "unsupportedBand", field: "band", message: "The band is not supported by this definition."))
        }
        if !metadata.supportedModes.contains(qso.mode) {
            issues.append(.init(code: "unsupportedMode", field: "mode", message: "The mode is not supported by this definition."))
        }
        if qso.frequencyHz <= 0 || ContestBandPlan.band(for: qso.frequencyHz) != qso.band {
            issues.append(.init(code: "frequencyBandMismatch", field: "frequencyHz", message: "Frequency does not match the recorded band."))
        }
        if qso.callsign == session.station.callsign {
            issues.append(.init(code: "selfContact", field: "callsign", message: "A station cannot contact itself."))
        }
        if !sentExchangeMatches(qso, session: session) {
            issues.append(.init(code: "sentExchangeMismatch", field: "exchange.sent", message: "Sent exchange must match the session snapshot."))
        }
        issues += aggregateIssues(fields: qso.exchange.sentFields,
                                  descriptors: metadata.entry.exchange.sentFields,
                                  aggregate: qso.exchange.normalizedSent, direction: "sent")
        issues += aggregateIssues(fields: qso.exchange.receivedFields,
                                  descriptors: metadata.entry.exchange.receivedFields,
                                  aggregate: qso.exchange.normalizedReceived, direction: "received")
        let geographic = geographicEvaluation(qso, session: session)
        issues += geographic.issues
        let invalid = issues.contains { $0.severity == .error }
        return .init(validation: issues, dupeKey: dupeKey(qso), points: invalid ? 0 : points(qso),
                     multiplierCandidates: invalid ? [] : multiplierCandidates(qso, geographic: geographic.candidate))
    }

    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }

    public func partialDraftDupeKey(for qso: ContestQSO, in session: ContestSessionSnapshot,
                                    validation: [ContestValidationIssue]) -> String? {
        guard definition.draft.operatorPolicy != nil else { return nil }
        return ContestOperatorProjection.partialDraftDupeKey(
            for: self, qso: qso, session: session, validation: validation)
    }

    private func points(_ qso: ContestQSO) -> Int64 {
        for clause in definition.draft.scoring.clauses {
            guard let raw = qso.exchange.receivedFields[clause.fieldID]?.normalized, let value = Int(raw) else { continue }
            switch clause.comparison {
            case .greaterThan where value > clause.threshold: return clause.points
            default: continue
            }
        }
        return definition.draft.scoring.defaultPoints
    }

    private func dupeKey(_ qso: ContestQSO) -> String? {
        switch definition.draft.dupePolicy {
        case .oncePerContest: return qso.callsign
        case .perBand: return "\(qso.callsign)|\(qso.band)"
        case .perBandMode: return "\(qso.callsign)|\(qso.band)|\(qso.mode)"
        case .none: return nil
        }
    }

    private func multiplierCandidates(_ qso: ContestQSO,
                                      geographic: ContestMultiplierKey?) -> Set<ContestMultiplierKey> {
        switch definition.draft.multiplierPolicy {
        case .none:
            return []
        case .uniqueCallsign:
            return [.init(kind: "callsign", value: qso.callsign, scope: "session")]
        case .geographic:
            return Set(geographic.map { [$0] } ?? [])
        }
    }

    private func geographicEvaluation(_ qso: ContestQSO, session: ContestSessionSnapshot)
        -> (issues: [ContestValidationIssue], candidate: ContestMultiplierKey?) {
        guard definition.draft.multiplierPolicy == .geographic,
              let policy = definition.draft.geographicMultiplier else { return ([], nil) }
        let referenceBytes = Array(session.referenceDataVersion.utf8)
        guard (1...160).contains(referenceBytes.count),
              session.referenceDataVersion == session.referenceDataVersion.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return ([.init(code: "invalidReferenceDataVersion", field: "session.referenceDataVersion",
                           message: "Geographic scoring requires a bounded pinned reference-data version.")], nil)
        }
        guard let entity = qso.entity else {
            return ([.init(code: "unresolvedGeography", field: "entity",
                           message: "Geographic scoring requires an immutable resolved entity snapshot.")], nil)
        }
        guard entity.adif > 0,
              !entity.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !entity.countryPrefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !entity.continent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              (1...40).contains(entity.cqZone) else {
            return ([.init(code: "invalidEntity", field: "entity",
                           message: "Resolved contest geography is incomplete or invalid.")], nil)
        }
        guard let location = qso.exchange.receivedFields[policy.locationFieldID]?.normalized else {
            return ([.init(code: "locationClassificationMismatch",
                           field: "exchange.receivedFields.\(policy.locationFieldID)",
                           message: "Location is missing for the resolved entity classification.")], nil)
        }
        if let subdivision = policy.subdivisions.first(where: { $0.entityADIF == entity.adif }) {
            guard subdivision.values.contains(location) else {
                return ([.init(code: "locationClassificationMismatch",
                               field: "exchange.receivedFields.\(policy.locationFieldID)",
                               message: "Location does not match the resolved subdivision entity.")], nil)
            }
            return ([], .init(kind: "administrativeSubdivision",
                              value: canonicalGeographicComponents([
                                  subdivision.authority, session.referenceDataVersion,
                                  String(entity.adif), location,
                              ]), scope: qso.band))
        }
        guard location == policy.entityFallback.locationToken else {
            return ([.init(code: "locationClassificationMismatch",
                           field: "exchange.receivedFields.\(policy.locationFieldID)",
                           message: "Location does not match the resolved DXCC entity fallback.")], nil)
        }
        return ([], .init(kind: "dxccEntity",
                          value: canonicalGeographicComponents([
                              policy.entityFallback.authority, session.referenceDataVersion, String(entity.adif),
                          ]), scope: qso.band))
    }

    /// Length-prefixed UTF-8 components keep the persisted key unambiguous when a
    /// pinned reference version contains punctuation or non-ASCII version metadata.
    private func canonicalGeographicComponents(_ components: [String]) -> String {
        components.map { "\($0.utf8.count):\($0)" }.joined()
    }

    private func sentExchangeMatches(_ qso: ContestQSO, session: ContestSessionSnapshot) -> Bool {
        guard let serialFieldID = metadata.entry.allocatedSerialField?.id else {
            return qso.exchange.sentFields == session.station.sentExchangeFields &&
                qso.exchange.normalizedSent == session.station.sentExchange
        }
        var nonserial = qso.exchange.sentFields
        nonserial.removeValue(forKey: serialFieldID)
        let stationDescriptors = metadata.entry.exchange.sentFields.filter { $0.id != serialFieldID }
        return nonserial == session.station.sentExchangeFields &&
            session.station.sentExchange == stationDescriptors.compactMap {
                session.station.sentExchangeFields[$0.id]?.normalized
            }.joined(separator: " ")
    }

    private func aggregateIssues(fields: [String: ContestExchangeFieldValue],
                                 descriptors: [ContestExchangeFieldDescriptor], aggregate: String,
                                 direction: String) -> [ContestValidationIssue] {
        let expected = descriptors.compactMap { fields[$0.id]?.normalized }.joined(separator: " ")
        guard aggregate == expected else {
            return [.init(code: "structuredAggregateMismatch", field: "exchange.\(direction)",
                          message: "Normalized aggregate exchange must match its ordered typed fields.")]
        }
        return []
    }

    private static func validCallsign(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        let slashComponents = value.split(separator: "/", omittingEmptySubsequences: false)
        return (3...32).contains(bytes.count) && slashComponents.allSatisfy { !$0.isEmpty } &&
            bytes.contains(where: { (65...90).contains($0) }) &&
            bytes.contains(where: { (48...57).contains($0) }) &&
            bytes.allSatisfy { (65...90).contains($0) || (48...57).contains($0) || $0 == 47 }
    }
}
