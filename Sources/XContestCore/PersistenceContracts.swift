import Foundation

public struct ContestMutationScope: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let workspaceGeneration: UUID
    public let requestID: UUID
    public let expectedRevision: UInt64
    public let draftID: UUID?
    public let payloadDigest: String

    public init(sessionID: UUID, workspaceGeneration: UUID, requestID: UUID,
                expectedRevision: UInt64, draftID: UUID? = nil, payloadDigest: String) {
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.requestID = requestID
        self.expectedRevision = expectedRevision
        self.draftID = draftID
        self.payloadDigest = payloadDigest
    }
}

public struct ContestMutationReceipt: Codable, Hashable, Sendable {
    public let requestID: UUID
    public let payloadDigest: String
    public let committedRevision: UInt64
    public let committedAt: Date
    public let result: ContestMutationResultReference

    public init(requestID: UUID, payloadDigest: String, committedRevision: UInt64, committedAt: Date,
                result: ContestMutationResultReference) {
        self.requestID = requestID
        self.payloadDigest = payloadDigest
        self.committedRevision = committedRevision
        self.committedAt = committedAt
        self.result = result
    }
}

public enum ContestMutationResultReference: Codable, Hashable, Sendable {
    case session(UUID)
    case draft(UUID)
    case serialReservation(UUID)
    case qso(UUID)
    case none
}

public enum ContestRepositoryError: Error, Equatable {
    case notFound
    case staleWorkspaceGeneration
    case staleRevision(expected: UInt64, actual: UInt64)
    case requestPayloadConflict(requestID: UUID)
    case operationUnresolved(requestID: UUID)
    case invalidPayloadDigest
    case invalidDraft
    case invalidSerialTransition
}

public struct ContestDraftSnapshot: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public let sessionID: UUID
    public let revision: UInt64
    public let updatedAt: Date
    public let callsign: String
    public let band: String
    public let mode: String
    public let frequencyHz: Int64?
    public let rstSent: String
    public let rstReceived: String
    public let exchange: ContestExchangeSnapshot
    public let entity: ContestEntitySnapshot?
    public let operatorCallsign: String
    public let stationLocation: String

    public init(id: UUID, sessionID: UUID, revision: UInt64, updatedAt: Date, callsign: String,
                band: String, mode: String, frequencyHz: Int64?, rstSent: String, rstReceived: String,
                exchange: ContestExchangeSnapshot, entity: ContestEntitySnapshot?,
                operatorCallsign: String, stationLocation: String) {
        self.id = id
        self.sessionID = sessionID
        self.revision = revision
        self.updatedAt = updatedAt
        self.callsign = callsign
        self.band = band
        self.mode = mode
        self.frequencyHz = frequencyHz
        self.rstSent = rstSent
        self.rstReceived = rstReceived
        self.exchange = exchange
        self.entity = entity
        self.operatorCallsign = operatorCallsign
        self.stationLocation = stationLocation
    }
}

public enum ContestSerialState: String, Codable, Sendable { case reserved, transmitted, uncertain, committed, void }
public enum ContestSerialScope: String, Codable, Sendable { case session, band, transmitter }

public extension ContestSerialState {
    func canTransition(to next: ContestSerialState) -> Bool {
        switch (self, next) {
        case (.reserved, .transmitted), (.reserved, .uncertain), (.reserved, .committed), (.reserved, .void),
             (.transmitted, .uncertain), (.transmitted, .committed), (.transmitted, .void),
             (.uncertain, .transmitted), (.uncertain, .committed), (.uncertain, .void): return true
        default: return false
        }
    }
}

public struct ContestSerialReservation: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public let sessionID: UUID
    public let draftID: UUID
    public let scope: ContestSerialScope
    public let scopeValue: String
    public let number: UInt64
    public let transmittedText: String
    public let state: ContestSerialState
    public let reservedAt: Date
    public let updatedAt: Date
    public let revision: UInt64

    public init(id: UUID, sessionID: UUID, draftID: UUID, scope: ContestSerialScope,
                scopeValue: String, number: UInt64, transmittedText: String,
                state: ContestSerialState, reservedAt: Date, updatedAt: Date, revision: UInt64) {
        self.id = id
        self.sessionID = sessionID
        self.draftID = draftID
        self.scope = scope
        self.scopeValue = scopeValue
        self.number = number
        self.transmittedText = transmittedText
        self.state = state
        self.reservedAt = reservedAt
        self.updatedAt = updatedAt
        self.revision = revision
    }
}

public protocol ContestRepository: Sendable {
    func createSession(_ session: ContestSessionSnapshot, scope: ContestMutationScope) async throws -> ContestMutationReceipt
    func session(id: UUID) async throws -> ContestSessionSnapshot
    func listSessions() async throws -> [ContestSessionSnapshot]
    func operationReceipt(sessionID: UUID, requestID: UUID) async throws -> ContestMutationReceipt?
    func draft(sessionID: UUID, id: UUID) async throws -> ContestDraftSnapshot
    func updateDraft(_ draft: ContestDraftSnapshot, scope: ContestMutationScope) async throws -> ContestMutationReceipt
    func reserveSerial(scope: ContestMutationScope) async throws -> (ContestSerialReservation, ContestMutationReceipt)
    func transitionSerial(reservationID: UUID, to state: ContestSerialState,
                          scope: ContestMutationScope) async throws -> ContestMutationReceipt
    func commitQSO(_ qso: ContestQSO, reservationID: UUID?, scope: ContestMutationScope) async throws -> ContestMutationReceipt
    func qsos(sessionID: UUID, offset: Int, limit: Int) async throws -> [ContestQSO]
}
