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
}

public enum ContestDeclarativeEligibilityPolicy: Codable, Hashable, Sendable {
    case unrestricted
    case stationFieldIntegerGreaterThan(fieldID: String, threshold: Int)
}

public enum ContestDeclarativeExportPolicy: String, Codable, Hashable, Sendable {
    case unsupported
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
    public let scoring: ContestDeclarativeScoringPolicy
    public let eligibilityPolicy: ContestDeclarativeEligibilityPolicy
    public let exportPolicy: ContestDeclarativeExportPolicy
    public let stationEntityRequired: Bool
    public let adapterID: String?

    public init(id: String, version: String, edition: String, displayName: String, cabrilloName: String,
                supportedBands: Set<String>, supportedModes: Set<String>, entry: ContestEntryDescriptor,
                sourceProvenance: String, dupePolicy: ContestDeclarativeDupePolicy,
                multiplierPolicy: ContestDeclarativeMultiplierPolicy,
                scoring: ContestDeclarativeScoringPolicy,
                eligibilityPolicy: ContestDeclarativeEligibilityPolicy = .unrestricted,
                exportPolicy: ContestDeclarativeExportPolicy = .unsupported,
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
        self.scoring = scoring
        self.eligibilityPolicy = eligibilityPolicy
        self.exportPolicy = exportPolicy
        self.stationEntityRequired = stationEntityRequired
        self.adapterID = adapterID
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case id, version, edition, displayName, cabrilloName, supportedBands, supportedModes, entry,
             sourceProvenance, dupePolicy, multiplierPolicy, scoring, eligibilityPolicy, exportPolicy,
             stationEntityRequired, adapterID
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
        scoring = try values.decode(ContestDeclarativeScoringPolicy.self, forKey: key(.scoring))
        eligibilityPolicy = try values.decode(ContestDeclarativeEligibilityPolicy.self, forKey: key(.eligibilityPolicy))
        exportPolicy = try values.decode(ContestDeclarativeExportPolicy.self, forKey: key(.exportPolicy))
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
        try values.encode(scoring, forKey: .scoring)
        try values.encode(eligibilityPolicy, forKey: .eligibilityPolicy)
        try values.encode(exportPolicy, forKey: .exportPolicy)
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
        if draft.adapterID != nil { result.append("custom adapters are not supported by the declarative engine") }
        if draft.supportedBands.isEmpty || draft.supportedModes.isEmpty { result.append("bands and modes are required") }
        let coherentEntry = draft.entry.isCoherent(supportedModes: draft.supportedModes)
        if !coherentEntry { result.append("entry descriptor is incoherent") }
        switch (draft.entry.scorePolicy, draft.multiplierPolicy) {
        case (.pointsOnly, .none), (.pointsTimesMultipliers, .uniqueCallsign):
            break
        default:
            result.append("score and multiplier policies are incompatible")
        }
        if draft.exportPolicy != .unsupported { result.append("pilot export must remain unsupported") }
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
}

public struct DeclarativeContestRule: ContestRule, ContestRuleStationEntityPolicy {
    public let definition: ContestDeclarativeDefinition
    public let metadata: ContestRuleMetadata

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
        let invalid = issues.contains { $0.severity == .error }
        return .init(validation: issues, dupeKey: dupeKey(qso), points: invalid ? 0 : points(qso),
                     multiplierCandidates: invalid ? [] : multiplierCandidates(qso))
    }

    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }

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

    private func multiplierCandidates(_ qso: ContestQSO) -> Set<ContestMultiplierKey> {
        switch definition.draft.multiplierPolicy {
        case .none:
            return []
        case .uniqueCallsign:
            return [.init(kind: "callsign", value: qso.callsign, scope: "session")]
        }
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
        return (3...32).contains(bytes.count) && bytes.contains(where: { (65...90).contains($0) }) &&
            bytes.contains(where: { (48...57).contains($0) }) &&
            bytes.allSatisfy { (65...90).contains($0) || (48...57).contains($0) || $0 == 47 }
    }
}
