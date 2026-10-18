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

public struct ContestStationGridMoveResult: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let draft: ContestDraftSnapshot
    public let previousGrid: String
    public let currentGrid: String
    public let operationTimestamp: Date
    public let score: ContestScoreSummarySnapshot
    public let receipt: ContestMutationReceipt
    public let qsoCount: Int
    public let projection: ContestMutationProjection

    public init(session: StoredContestSession, draft: ContestDraftSnapshot,
                previousGrid: String, currentGrid: String, operationTimestamp: Date,
                score: ContestScoreSummarySnapshot, receipt: ContestMutationReceipt,
                qsoCount: Int, projection: ContestMutationProjection) {
        self.session = session
        self.draft = draft
        self.previousGrid = previousGrid
        self.currentGrid = currentGrid
        self.operationTimestamp = operationTimestamp
        self.score = score
        self.receipt = receipt
        self.qsoCount = qsoCount
        self.projection = projection
    }
}

public enum ContestQSOChangeOperation: String, Codable, Hashable, Sendable {
    case correction
    case deletion
}

public struct ContestQSOReadSnapshot: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let qso: ContestQSO

    public init(session: StoredContestSession, qso: ContestQSO) {
        self.session = session
        self.qso = qso
    }
}

public struct ContestQSOAuditRecord: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let qsoID: UUID
    public let operation: ContestQSOChangeOperation
    public let before: ContestQSO
    public let after: ContestQSO?
    public let reason: String
    public let requestID: UUID
    public let operationTimestamp: Date
    public let committedAt: Date
    public let committedRevision: UInt64

    public init(sessionID: UUID, qsoID: UUID, operation: ContestQSOChangeOperation,
                before: ContestQSO, after: ContestQSO?, reason: String,
                requestID: UUID, operationTimestamp: Date, committedAt: Date,
                committedRevision: UInt64) {
        self.sessionID = sessionID
        self.qsoID = qsoID
        self.operation = operation
        self.before = before
        self.after = after
        self.reason = reason
        self.requestID = requestID
        self.operationTimestamp = operationTimestamp
        self.committedAt = committedAt
        self.committedRevision = committedRevision
    }
}

public struct ContestQSOChangeResult: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let operation: ContestQSOChangeOperation
    public let qsoID: UUID
    public let before: ContestQSO
    public let after: ContestQSO?
    public let score: ContestScoreSummarySnapshot
    public let receipt: ContestMutationReceipt
    public let qsoCount: Int

    public init(session: StoredContestSession, operation: ContestQSOChangeOperation,
                qsoID: UUID, before: ContestQSO, after: ContestQSO?,
                score: ContestScoreSummarySnapshot, receipt: ContestMutationReceipt, qsoCount: Int) {
        self.session = session
        self.operation = operation
        self.qsoID = qsoID
        self.before = before
        self.after = after
        self.score = score
        self.receipt = receipt
        self.qsoCount = qsoCount
    }
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
    public let canonicalDefinitionData: Data?

    public init(session: StoredContestSession, drafts: [ContestDraftSnapshot],
                activeReservations: [ContestSerialReservation], qsos: [ContestQSO],
                canonicalDefinitionData: Data? = nil) {
        self.session = session
        self.drafts = drafts
        self.activeReservations = activeReservations
        self.qsos = qsos
        self.canonicalDefinitionData = canonicalDefinitionData
    }

    public var qsoCount: Int { qsos.count }
}

public struct ContestSessionDefinitionSnapshot: Codable, Hashable, Sendable {
    public let session: StoredContestSession
    public let canonicalDefinitionData: Data?

    public init(session: StoredContestSession, canonicalDefinitionData: Data?) {
        self.session = session
        self.canonicalDefinitionData = canonicalDefinitionData
    }
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

public struct ContestRateStatisticsReadSnapshot: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let workspaceGeneration: UUID
    public let revision: UInt64
    public let statistics: ContestRateStatisticsSnapshot

    public init(sessionID: UUID, workspaceGeneration: UUID, revision: UInt64,
                statistics: ContestRateStatisticsSnapshot) {
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.revision = revision
        self.statistics = statistics
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
    case qsoDeleted(UUID)
    case invalidCorrectionReason
    case immutableQSOField(String)
    case invalidDeclarativeDefinition
    case declarativeDefinitionConflict
}

public protocol ContestDurableRepository: Sendable {
    func createSession(_ session: ContestSessionSnapshot, metadata: ContestSessionMetadata,
                       initialDraft: ContestDraftSnapshot,
                       scope: ContestMutationScope, committedAt: Date) async throws -> ContestSessionCreationResult
    func createDeclarativeSession(_ session: ContestSessionSnapshot, metadata: ContestSessionMetadata,
                                  initialDraft: ContestDraftSnapshot, canonicalDefinitionData: Data,
                                  scope: ContestMutationScope,
                                  committedAt: Date) async throws -> ContestSessionCreationResult
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
    func moveStationGrid(to grid: String, operationTimestamp: Date,
                         scope: ContestMutationScope,
                         committedAt: Date) async throws -> ContestStationGridMoveResult
    func qso(sessionID: UUID, id: UUID) async throws -> ContestQSO
    func qsoReadSnapshot(sessionID: UUID, id: UUID, expectedWorkspaceGeneration: UUID,
                         expectedRevision: UInt64) async throws -> ContestQSOReadSnapshot
    func correctQSO(_ corrected: ContestQSO, reason: String, operationTimestamp: Date,
                    scope: ContestMutationScope,
                    committedAt: Date) async throws -> ContestQSOChangeResult
    func deleteQSO(id: UUID, reason: String, operationTimestamp: Date,
                   scope: ContestMutationScope,
                   committedAt: Date) async throws -> ContestQSOChangeResult
    func qsoAuditTrail(sessionID: UUID, qsoID: UUID) async throws -> [ContestQSOAuditRecord]
    func logPage(sessionID: UUID, offset: Int, limit: Int) async throws -> ContestLogPage
    func scoreSnapshot(sessionID: UUID) async throws -> ContestScoreSnapshot
    func rateStatisticsSnapshot(sessionID: UUID, asOfUTC: Date) async throws
        -> ContestRateStatisticsReadSnapshot
}

public extension ContestDurableRepository {
    func createDeclarativeSession(_ session: ContestSessionSnapshot, metadata: ContestSessionMetadata,
                                  initialDraft: ContestDraftSnapshot, canonicalDefinitionData: Data,
                                  scope: ContestMutationScope,
                                  committedAt: Date) async throws -> ContestSessionCreationResult {
        throw ContestStoreError.invalidDeclarativeDefinition
    }

    func rateStatisticsSnapshot(sessionID: UUID, asOfUTC: Date) async throws
        -> ContestRateStatisticsReadSnapshot {
        throw ContestStoreError.invalidSession
    }

    func moveStationGrid(to grid: String, operationTimestamp: Date,
                         scope: ContestMutationScope,
                         committedAt: Date) async throws -> ContestStationGridMoveResult {
        throw ContestStoreError.invalidSession
    }
}
