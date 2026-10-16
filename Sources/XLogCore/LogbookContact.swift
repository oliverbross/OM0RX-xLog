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
