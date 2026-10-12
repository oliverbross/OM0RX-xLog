import Foundation

/// One workspace draft shared by all operator surfaces. Revision is bounded to
/// JavaScript's exact integer range; neither window identity nor a QSO timestamp
/// is a concurrency token.
public struct OperatorDraftSnapshot: Codable, Equatable, Sendable {
    public let revision: Int64
    public let qso: QSO
}

public struct OperatorDraftMutation: Codable, Equatable, Sendable {
    public enum Action: String, Codable, Sendable { case replace, clear, save }
    public let operationID: UUID
    public let draftID: UUID
    public let expectedRevision: Int64
    public let action: Action
    public let qso: QSO?

    public init(operationID: UUID, draftID: UUID, expectedRevision: Int64, action: Action, qso: QSO? = nil) {
        self.operationID = operationID; self.draftID = draftID
        self.expectedRevision = expectedRevision; self.action = action; self.qso = qso
    }
}

/// A receipt describes the result at commit time. It must not be used as a fresh
/// snapshot after later edits. Save receipts remain durable for lost-ack retries.
public struct OperatorDraftReceipt: Codable, Equatable, Sendable {
    public let mutation: OperatorDraftMutation
    public let draft: OperatorDraftSnapshot
    public let savedQSO: QSO?
}

public enum OperatorDraftError: Error {
    case conflict(OperatorDraftSnapshot)
    case operationReused
    case notInitialized
    case invalid
    case existingContact
}

extension QSO {
    /// In-progress drafts may have an empty/partial callsign. Logging requires a
    /// complete call. Keep drafts bounded without manufacturing radio values.
    func validateOperatorDraft(forSave: Bool) throws {
        let normalizedCall = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard call.utf8.count <= 64, band.utf8.count <= 16, mode.utf8.count <= 16,
              start.timeIntervalSince1970.isFinite,
              (Date(timeIntervalSince1970: -2_208_988_800)...Date(timeIntervalSince1970: 4_102_444_800)).contains(start),
              end.map({ $0.timeIntervalSince1970.isFinite }) ?? true,
              frequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? true,
              receiveFrequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? true,
              wavelogID == nil, deletedAt == nil,
              (try? JSONEncoder().encode(self).count).map({ $0 <= 24_576 }) == true else {
            throw OperatorDraftError.invalid
        }
        if forSave {
            guard (3...32).contains(normalizedCall.utf8.count), !band.isEmpty, !mode.isEmpty,
                  normalizedCall.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 47 || $0 == 45 }) else {
                throw OperatorDraftError.invalid
            }
        }
    }
}
