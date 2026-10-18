import Foundation

public struct ContestCallHistoryProjection: Codable, Equatable, Sendable {
    public enum Target: String, Codable, Sendable {
        case legacyReceivedExchange
        case receivedField
    }

    public let id: String
    public let sourceKey: ContestCallHistoryKnownKey
    public let target: Target
    public let fieldID: String?
    public let label: String
    public let rawValue: String
    public let normalizedValue: String

    public init(id: String, sourceKey: ContestCallHistoryKnownKey, target: Target,
                fieldID: String?, label: String, rawValue: String, normalizedValue: String) {
        self.id = id
        self.sourceKey = sourceKey
        self.target = target
        self.fieldID = fieldID
        self.label = label
        self.rawValue = rawValue
        self.normalizedValue = normalizedValue
    }
}

public enum ContestCallHistoryProjectionError: Error, Equatable {
    case unsupportedRule
    case invalidRecord
    case unknownProjection
    case occupiedTarget
    case invalidProjection
}

public enum ContestCallHistoryProjector {
    public static func proposals(headers: [ContestCallHistoryHeader],
                                 row: ContestCallHistoryRow,
                                 rule: any ContestRule,
                                 session: ContestSessionSnapshot,
                                 draft: ContestDraftSnapshot) throws -> [ContestCallHistoryProjection] {
        guard row.normalizedCallsign == draft.callsign else {
            throw ContestCallHistoryProjectionError.invalidRecord
        }
        let id = rule.metadata.identity.id
        switch id {
        case "cq-ww-cw", "cq-ww-ssb":
            guard draft.exchange.rawReceived.isEmpty else { return [] }
            return proposal(headers: headers, row: row, key: .cqZone,
                            id: "legacy-received-zone", target: .legacyReceivedExchange,
                            fieldID: nil, label: "CQ zone", kind: .cqZone).map { [$0] } ?? []
        case "naqp-cw", "naqp-ssb", "naqp-rtty":
            return [
                draft.exchange.receivedFields["name"] == nil
                    ? proposal(headers: headers, row: row, key: .name, id: "received-name",
                               target: .receivedField, fieldID: "name", label: "Name", kind: .operatorName) : nil,
                draft.exchange.receivedFields["location"] == nil
                    ? proposal(headers: headers, row: row, key: .state, id: "received-location",
                               target: .receivedField, fieldID: "location", label: "Location", kind: .subdivision) : nil,
            ].compactMap { $0 }
        case "arrl-rtty-roundup":
            guard draft.exchange.receivedFields["exchange"] == nil,
                  let worked = draft.entity, arrlRTTYIsWVE(worked) else { return [] }
            return proposal(headers: headers, row: row, key: .state, id: "received-location",
                            target: .receivedField, fieldID: "exchange", label: "State or province",
                            kind: .subdivision).map { [$0] } ?? []
        case "arrl-dx-cw", "arrl-dx-ssb":
            guard draft.exchange.receivedFields.isEmpty,
                  let entrant = session.station.entity, let worked = draft.entity,
                  arrlRTTYIsWVE(entrant) != arrlRTTYIsWVE(worked) else { return [] }
            if arrlRTTYIsWVE(entrant) {
                return proposal(headers: headers, row: row, key: .power, id: "received-power",
                                target: .receivedField, fieldID: "power", label: "Power",
                                kind: .power).map { [$0] } ?? []
            }
            return proposal(headers: headers, row: row, key: .state, id: "received-location",
                            target: .receivedField, fieldID: "location", label: "State or province",
                            kind: .subdivision).map { [$0] } ?? []
        default:
            throw ContestCallHistoryProjectionError.unsupportedRule
        }
    }

    public static func applying(_ projectionIDs: [String], from proposals: [ContestCallHistoryProjection],
                                to draft: ContestDraftSnapshot, rule: any ContestRule,
                                session: ContestSessionSnapshot, revision: UInt64,
                                updatedAt: Date) throws -> ContestDraftSnapshot {
        guard !projectionIDs.isEmpty, Set(projectionIDs).count == projectionIDs.count else {
            throw ContestCallHistoryProjectionError.unknownProjection
        }
        let byID = Dictionary(uniqueKeysWithValues: proposals.map { ($0.id, $0) })
        let selected = try projectionIDs.map { id -> ContestCallHistoryProjection in
            guard let value = byID[id] else { throw ContestCallHistoryProjectionError.unknownProjection }
            return value
        }
        var rawReceived = draft.exchange.rawReceived
        var normalizedReceived = draft.exchange.normalizedReceived
        var receivedFields = draft.exchange.receivedFields
        for value in selected {
            switch value.target {
            case .legacyReceivedExchange:
                guard rawReceived.isEmpty, normalizedReceived.isEmpty else {
                    throw ContestCallHistoryProjectionError.occupiedTarget
                }
                rawReceived = value.rawValue
                normalizedReceived = value.normalizedValue
            case .receivedField:
                guard let fieldID = value.fieldID, receivedFields[fieldID] == nil else {
                    throw ContestCallHistoryProjectionError.occupiedTarget
                }
                receivedFields[fieldID] = .init(raw: value.rawValue, normalized: value.normalizedValue)
            }
        }
        if rule.metadata.entry.version == .v2 {
            let descriptors = rule.metadata.entry.exchange.receivedFields
            rawReceived = descriptors.compactMap { receivedFields[$0.id]?.raw }.joined(separator: " ")
            normalizedReceived = descriptors.compactMap { receivedFields[$0.id]?.normalized }.joined(separator: " ")
        }
        let candidate = ContestDraftSnapshot(
            id: draft.id, sessionID: draft.sessionID, revision: revision, updatedAt: updatedAt,
            callsign: draft.callsign, band: draft.band, mode: draft.mode, frequencyHz: draft.frequencyHz,
            rstSent: draft.rstSent, rstReceived: draft.rstReceived,
            exchange: .init(rawSent: draft.exchange.rawSent, normalizedSent: draft.exchange.normalizedSent,
                            rawReceived: rawReceived, normalizedReceived: normalizedReceived,
                            sentFields: draft.exchange.sentFields, receivedFields: receivedFields),
            entity: draft.entity, operatorCallsign: draft.operatorCallsign,
            stationLocation: draft.stationLocation)
        let before = Set(rule.validateDraft(draft, in: session).filter { $0.severity == .error }
            .map { "\($0.code)|\($0.field)|\($0.message)" })
        let after = Set(rule.validateDraft(candidate, in: session).filter { $0.severity == .error }
            .map { "\($0.code)|\($0.field)|\($0.message)" })
        guard after.isSubset(of: before) else { throw ContestCallHistoryProjectionError.invalidProjection }
        return candidate
    }

    private static func proposal(headers: [ContestCallHistoryHeader], row: ContestCallHistoryRow,
                                 key: ContestCallHistoryKnownKey, id: String,
                                 target: ContestCallHistoryProjection.Target, fieldID: String?,
                                 label: String, kind: ContestExchangeFieldKind) -> ContestCallHistoryProjection? {
        guard let index = headers.firstIndex(where: { $0.knownKey == key }) else { return nil }
        let raw = row.values.indices.contains(index) ? row.values[index] : ""
        guard !raw.isEmpty,
              raw == raw.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        let normalized: String
        if kind == .power {
            guard let value = arrlDXNormalizePower(raw) else { return nil }
            normalized = value
        } else {
            normalized = raw.uppercased()
        }
        guard kind.accepts(normalized) else { return nil }
        return .init(id: id, sourceKey: key, target: target, fieldID: fieldID, label: label,
                     rawValue: raw, normalizedValue: normalized)
    }
}
