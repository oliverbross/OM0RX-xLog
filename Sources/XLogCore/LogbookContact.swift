import Foundation

/// Existing logbook contacts have their own revisions, separate from the active
/// new-contact draft and from the aggregate-cache revision. SQLite triggers cover
/// every writer, including import, synchronization and older native code paths.
public struct LogbookContactSnapshot: Codable, Equatable, Sendable {
    public let revision: Int64
    public let qso: QSO
}

public struct LogbookContactMutation: Codable, Equatable, Sendable {
    public enum Action: String, Codable, Sendable { case update, delete, restore }
    public let operationID: UUID
    public let contactID: UUID
    public let expectedRevision: Int64
    public let action: Action
    public let qso: QSO?

    public init(operationID: UUID, contactID: UUID, expectedRevision: Int64, action: Action, qso: QSO? = nil) {
        self.operationID = operationID; self.contactID = contactID
        self.expectedRevision = expectedRevision; self.action = action; self.qso = qso
    }
}

/// Historical result of exactly one committed mutation, not a current snapshot.
public struct LogbookContactReceipt: Codable, Equatable, Sendable {
    public let mutation: LogbookContactMutation
    public let contact: LogbookContactSnapshot
    /// The retained before-value enables a revision-checked compensating edit.
    /// Missing in legacy receipts; never infer its historical contents.
    public let previousContact: LogbookContactSnapshot?
    public init(mutation: LogbookContactMutation, contact: LogbookContactSnapshot, previousContact: LogbookContactSnapshot? = nil) {
        self.mutation = mutation; self.contact = contact; self.previousContact = previousContact
    }
}

public enum CountryCorrectionField: String, Codable, CaseIterable, Sendable {
    case dxcc, country, continent, cqZone, ituZone, state, county
    public func value(in qso: QSO) -> String? {
        switch self {
        case .dxcc: return qso.dxcc.map(String.init)
        case .country: return qso.country
        case .continent: return qso.continent
        case .cqZone: return qso.cqZone
        case .ituZone: return qso.ituZone
        case .state: return qso.state
        case .county: return qso.county
        }
    }
    public func applying(_ value: String?, to qso: inout QSO) {
        switch self {
        case .dxcc: qso.dxcc = value.flatMap(Int.init)
        case .country: qso.country = value ?? ""
        case .continent: qso.continent = value ?? ""
        case .cqZone: qso.cqZone = value ?? ""
        case .ituZone: qso.ituZone = value ?? ""
        case .state: qso.state = value ?? ""
        case .county: qso.county = value ?? ""
        }
    }
}

public struct CountryCorrectionRow: Codable, Equatable, Sendable {
    public struct Change: Codable, Equatable, Sendable {
        public let field: CountryCorrectionField
        public let retained: String?
        public let proposed: String?
        public let retainedOrigin: String
        public let reason: String
    }
    public let contactID: UUID
    public let revision: Int64
    public let call: String
    public let start: Date
    public let facts: CTYResolver.Facts
    public let changes: [Change]
    public let dependentConflict: String?

    public static func inspect(_ snapshot: LogbookContactSnapshot, resolver: CTYResolver) -> Self {
        inspect(contactID: snapshot.qso.id, revision: snapshot.revision, call: snapshot.qso.call, start: snapshot.qso.start,
            retained: Dictionary(uniqueKeysWithValues: CountryCorrectionField.allCases.map { ($0, $0.value(in: snapshot.qso)) }),
            iota: snapshot.qso.iota, resolver: resolver)
    }
    static func inspect(contactID: UUID, revision: Int64, call: String, start: Date,
                        retained: [CountryCorrectionField: String?], iota: String, resolver: CTYResolver) -> Self {
        let facts = resolver.facts(call, at: start)
        var changes: [Change] = []
        if let country = facts.country {
            let proposed: [CountryCorrectionField: String] = [.dxcc: String(country.adif), .country: country.name,
                .continent: country.continent, .cqZone: String(country.cqZone), .ituZone: String(country.ituZone)]
            for field in CountryCorrectionField.allCases {
                guard let value = proposed[field], value != retained[field] ?? nil,
                      !([CountryCorrectionField.cqZone, .ituZone].contains(field) && value == "0") else { continue }
                changes.append(Change(field: field, retained: retained[field] ?? nil, proposed: value,
                    retainedOrigin: "retainedOriginUnknownProtected", reason: "\(facts.matchedRule ?? "reference rule") at QSO UTC date; explicit operator selection required"))
            }
            if changes.contains(where: { $0.field == .dxcc }) {
                for field in [CountryCorrectionField.state, .county] where !((retained[field] ?? nil) ?? "").isEmpty {
                    changes.append(Change(field: field, retained: retained[field] ?? nil, proposed: "",
                        retainedOrigin: "retainedOriginUnknownProtected", reason: "Entity change cannot justify retained subdivision; explicitly choose clearing or cancel the entity change"))
                }
            }
        }
        let conflict = changes.contains(where: { $0.field == .dxcc }) && !iota.isEmpty
            ? "Retained IOTA requires a separate location review before changing DXCC; no IOTA patch is authorized here." : nil
        return Self(contactID: contactID, revision: revision, call: call, start: start, facts: facts, changes: changes, dependentConflict: conflict)
    }
}

public struct CountryCorrectionPage: Codable, Sendable {
    public var rows: [CountryCorrectionRow]
    public var comparedCount: Int
    public var affectedCount: Int
    public var unresolvedCount: Int
    public let offset: Int
    public let limit: Int
    public let referenceRevision: String
}

public enum LogbookContactError: Error {
    case conflict(LogbookContactSnapshot?)
    case operationReused
    case invalid
}

/// Pure admission checks and raw proposal differences for the existing update
/// owner. This is not a mutation, saved-value simulation, source endorsement or
/// apply/undo capability. Workspace generation remains the bridge owner's job.
public enum LogbookContactUpdateReview {
    public static let maximumChanges = 128
    public static let maximumDiffInputBytes = 24_576
    /// These are owned by persistence, not editable proposal differences.
    public static let persistenceOwnedFields: Set<String> = ["isDirty", "updatedAt"]

    public enum Failure: String, Codable, Equatable, Sendable {
        case invalidRevision, contactMissing, staleRevision, contactIdentityMismatch
        case deletedContact, proposedContactMissing, protectedIdentityChanged, proposedDeletion, invalidValues
    }
    public enum FieldValue: Codable, Equatable, Sendable {
        case absent
        /// Canonical JSON preserves type and distinguishes absent from empty or
        /// null. Arbitrary additional-field names are separate path segments.
        case encodedJSON(String)
    }
    public struct Change: Codable, Equatable, Sendable {
        public let path: [String]
        public let retained: FieldValue
        public let proposed: FieldValue
    }
    public enum DiffStatus: String, Codable, Sendable { case notValidated, complete, truncated, unavailable }
    public struct Review: Codable, Equatable, Sendable {
        public let contactID: UUID
        public let expectedRevision: Int64
        public let observedRevision: Int64?
        public let failure: Failure?
        public let diffStatus: DiffStatus
        public let changes: [Change]
    }

    /// Exactly the existing update admission checks. Save-time normalization and
    /// additional-field metadata validation are intentionally not simulated.
    public static func validationFailure(current: LogbookContactSnapshot?, contactID: UUID,
        expectedRevision: Int64, proposed: QSO?) -> Failure? {
        guard (0..<9_007_199_254_740_991).contains(expectedRevision) else { return .invalidRevision }
        guard let current else { return .contactMissing }
        guard current.revision == expectedRevision else { return .staleRevision }
        guard current.qso.id == contactID else { return .contactIdentityMismatch }
        return admissionFailure(current: current, proposed: proposed)
    }

    /// Database apply already owns its lookup/revision fence; share exactly its
    /// previous update checks without replacing persistence's failure semantics.
    static func admissionFailure(current: LogbookContactSnapshot, proposed: QSO?) -> Failure? {
        guard current.qso.deletedAt == nil else { return .deletedContact }
        guard let proposed else { return .proposedContactMissing }
        guard proposed.id == current.qso.id, proposed.wavelogID == current.qso.wavelogID else { return .protectedIdentityChanged }
        guard proposed.deletedAt == nil else { return .proposedDeletion }
        var validation = proposed
        validation.wavelogID = nil
        do { try validation.validateOperatorDraft(forSave: true) }
        catch { return .invalidValues }
        return nil
    }

    public static func inspect(current: LogbookContactSnapshot?, contactID: UUID,
        expectedRevision: Int64, proposed: QSO?) -> Review {
        let failure = validationFailure(current: current, contactID: contactID, expectedRevision: expectedRevision, proposed: proposed)
        func report(_ status: DiffStatus, _ changes: [Change] = []) -> Review {
            Review(contactID: contactID, expectedRevision: expectedRevision, observedRevision: current?.revision,
                   failure: failure, diffStatus: status, changes: changes)
        }
        guard failure == nil, let current, let proposed else { return report(.notValidated) }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let beforeData = try encoder.encode(current.qso), afterData = try encoder.encode(proposed)
            guard beforeData.count <= maximumDiffInputBytes, afterData.count <= maximumDiffInputBytes,
                  let before = try JSONSerialization.jsonObject(with: beforeData) as? [String: Any],
                  let after = try JSONSerialization.jsonObject(with: afterData) as? [String: Any] else { return report(.unavailable) }
            func value(_ item: Any?) throws -> FieldValue {
                guard let item else { return .absent }
                let data = try JSONSerialization.data(withJSONObject: item, options: [.sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes])
                return .encodedJSON(String(decoding: data, as: UTF8.self))
            }
            var changes: [Change] = []
            func append(_ path: [String], _ left: Any?, _ right: Any?) throws {
                let retained = try value(left), proposed = try value(right)
                if retained != proposed { changes.append(Change(path: path, retained: retained, proposed: proposed)) }
            }
            for key in Set(before.keys).union(after.keys).subtracting(persistenceOwnedFields).sorted() {
                if key == "extraFields" {
                    let left = before[key] as? [String: String] ?? [:], right = after[key] as? [String: String] ?? [:]
                    for name in Set(left.keys).union(right.keys).sorted() {
                        try append([key, name], left[name], right[name])
                        if changes.count > maximumChanges { return report(.truncated, Array(changes.prefix(maximumChanges))) }
                    }
                } else { try append([key], before[key], after[key]) }
                if changes.count > maximumChanges { return report(.truncated, Array(changes.prefix(maximumChanges))) }
            }
            return report(.complete, changes)
        } catch { return report(.unavailable) }
    }
}
