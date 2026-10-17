import Foundation
import XContestCore

public struct ContestSessionMetadata: Codable, Hashable, Sendable {
    public let name: String
    public let operatorCallsign: String
    public let operatorCategory: String

    public init(name: String, operatorCallsign: String, operatorCategory: String) {
        self.name = name
        self.operatorCallsign = operatorCallsign.uppercased()
        self.operatorCategory = operatorCategory
    }
}

public struct StoredContestSession: Codable, Hashable, Sendable {
    public let session: ContestSessionSnapshot
    public let metadata: ContestSessionMetadata
    public let revision: UInt64
    public let createdAt: Date

    public init(session: ContestSessionSnapshot, metadata: ContestSessionMetadata,
                revision: UInt64, createdAt: Date) {
        self.session = session
        self.metadata = metadata
        self.revision = revision
        self.createdAt = createdAt
    }
}

public struct ContestSerialReservationResult: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let draft: ContestDraftSnapshot
    public let reservation: ContestSerialReservation
    public let receipt: ContestMutationReceipt
    public let qsoCount: Int
    public let projection: ContestMutationProjection

    public init(session: StoredContestSession, draft: ContestDraftSnapshot,
                reservation: ContestSerialReservation, receipt: ContestMutationReceipt, qsoCount: Int,
                projection: ContestMutationProjection) {
        self.session = session
        self.draft = draft
        self.reservation = reservation
        self.receipt = receipt
        self.qsoCount = qsoCount
        self.projection = projection
    }
}

public struct ContestSessionCreationResult: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let draft: ContestDraftSnapshot
    public let receipt: ContestMutationReceipt
    public let qsoCount: Int
    public let projection: ContestMutationProjection
}

public struct ContestDraftMutationResult: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let draft: ContestDraftSnapshot
    public let receipt: ContestMutationReceipt
    public let qsoCount: Int
    public let projection: ContestMutationProjection
}

public struct ContestSerialTransitionResult: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let draft: ContestDraftSnapshot
    public let reservation: ContestSerialReservation
    public let receipt: ContestMutationReceipt
    public let qsoCount: Int
    public let projection: ContestMutationProjection
}

public struct ContestQSOCommitResult: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let draft: ContestDraftSnapshot
    public let qso: ContestQSO
    public let committedEvaluation: ContestScoredQSO
    public let score: ContestScoreSummarySnapshot
    public let receipt: ContestMutationReceipt
    public let qsoCount: Int
    public let projection: ContestMutationProjection
}

public struct ContestLogPage: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let workspaceGeneration: UUID
    public let revision: UInt64
    public let qsos: [ContestQSO]
    public let total: Int
    public let offset: Int
    public let limit: Int

    public init(sessionID: UUID, workspaceGeneration: UUID, revision: UInt64,
                qsos: [ContestQSO], total: Int, offset: Int, limit: Int) {
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.revision = revision
        self.qsos = qsos
        self.total = total
        self.offset = offset
        self.limit = limit
    }
}

public struct ContestSessionReadSnapshot: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let drafts: [ContestDraftSnapshot]
    public let activeReservations: [ContestSerialReservation]
    public let qsos: [ContestQSO]

    public var qsoCount: Int { qsos.count }
}

public struct ContestDraftEvaluationSnapshot: Codable, Hashable, Sendable {
    public let validation: [ContestValidationIssue]
    public let dupeKey: String?
    public let isDuplicate: Bool?
}

public struct ContestScoreSummarySnapshot: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let workspaceGeneration: UUID
    public let revision: UInt64
    public let qsoCount: Int
    public let totalPoints: Int64
    public let multiplierCount: Int64
    public let claimedScore: Int64
}

public struct ContestMutationProjection: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let draft: ContestDraftSnapshot
    public let activeReservations: [ContestSerialReservation]
    public let score: ContestScoreSummarySnapshot
    public let draftEvaluation: ContestDraftEvaluationSnapshot
}

public struct ContestSessionPageSnapshot: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let drafts: [ContestDraftSnapshot]
    public let activeReservations: [ContestSerialReservation]
    public let log: ContestLogPage
    public let score: ContestScoreSnapshot
}

public struct ContestScoreSnapshot: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let workspaceGeneration: UUID
    public let revision: UInt64
    public let score: ContestScore

    public init(sessionID: UUID, workspaceGeneration: UUID, revision: UInt64, score: ContestScore) {
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.revision = revision
        self.score = score
    }
}

public enum ContestStoreError: Error, Equatable {
    case invalidDatabaseURL
    case database(String)
    case corruptRecord
    case unsupportedSchema(Int)
    case unknownRule(ContestRuleIdentity)
    case invalidSession
    case invalidQSO([ContestValidationIssue])
    case reservationMismatch
    case serialExhausted
    case invalidPage
}

public protocol ContestDurableRepository: Sendable {
    func createSession(_ session: ContestSessionSnapshot, metadata: ContestSessionMetadata,
                       initialDraft: ContestDraftSnapshot,
                       scope: ContestMutationScope, committedAt: Date) async throws -> ContestSessionCreationResult
    func openSession(id: UUID) async throws -> StoredContestSession
    func listStoredSessions() async throws -> [StoredContestSession]
    func sessionReadSnapshot(id: UUID) async throws -> ContestSessionReadSnapshot
    func sessionPageSnapshot(id: UUID, offset: Int, limit: Int) async throws -> ContestSessionPageSnapshot
    func listSessionReadSnapshots() async throws -> [ContestSessionReadSnapshot]
    func operationReceipt(sessionID: UUID, workspaceGeneration: UUID, requestID: UUID,
                          payloadDigest: String) async throws -> ContestMutationReceipt?
    func draft(sessionID: UUID, id: UUID) async throws -> ContestDraftSnapshot
    func drafts(sessionID: UUID) async throws -> [ContestDraftSnapshot]
    func updateDraft(_ draft: ContestDraftSnapshot, scope: ContestMutationScope,
                     committedAt: Date) async throws -> ContestDraftMutationResult
    func reserveSerial(reservationID: UUID, serialScope: ContestSerialScope, scopeValue: String,
                       scope: ContestMutationScope, committedAt: Date) async throws -> ContestSerialReservationResult
    func reservation(id: UUID) async throws -> ContestSerialReservation
    func reservations(sessionID: UUID, draftID: UUID) async throws -> [ContestSerialReservation]
    func activeReservations(sessionID: UUID, draftID: UUID) async throws -> [ContestSerialReservation]
    func transitionSerial(reservationID: UUID, to state: ContestSerialState,
                          scope: ContestMutationScope, committedAt: Date) async throws -> ContestSerialTransitionResult
    func commitQSO(_ qso: ContestQSO, reservationID: UUID?, scope: ContestMutationScope,
                   committedAt: Date) async throws -> ContestQSOCommitResult
    func qso(sessionID: UUID, id: UUID) async throws -> ContestQSO
    func logPage(sessionID: UUID, offset: Int, limit: Int) async throws -> ContestLogPage
    func scoreSnapshot(sessionID: UUID) async throws -> ContestScoreSnapshot
}
