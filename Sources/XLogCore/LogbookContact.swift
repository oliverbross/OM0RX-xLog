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
