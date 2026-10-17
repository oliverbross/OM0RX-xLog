import Foundation
import CSQLitePrototype
import XContestCore

public actor SQLiteContestStore: ContestDurableRepository {
    private let database: SQLiteDatabase
    private let rules: ContestRuleRegistry
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var readSnapshotHookForTesting: (@Sendable () -> Void)?
    private var mutationWriteHookForTesting: (@Sendable (String) throws -> Void)?

    public init(databaseURL: URL, busyTimeoutMilliseconds: Int32 = 5_000,
                rules: ContestRuleRegistry = .pilots) throws {
        guard databaseURL.isFileURL, !databaseURL.path.isEmpty,
              databaseURL.lastPathComponent != ".", databaseURL.lastPathComponent != ".." else {
            throw ContestStoreError.invalidDatabaseURL
        }
        self.encoder = Self.makeEncoder()
        self.decoder = Self.makeDecoder()
        self.rules = rules
        self.database = try SQLiteDatabase(url: databaseURL, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
    }

    func installReadSnapshotHookForTesting(_ hook: (@Sendable () -> Void)?) {
        readSnapshotHookForTesting = hook
    }

    func installMutationWriteHookForTesting(_ hook: (@Sendable (String) throws -> Void)?) {
        mutationWriteHookForTesting = hook
    }

    public func createSession(_ session: ContestSessionSnapshot, metadata: ContestSessionMetadata,
                              initialDraft: ContestDraftSnapshot,
                              scope: ContestMutationScope, committedAt: Date) throws -> ContestSessionCreationResult {
        let canonical = try canonicalPayload(scope: scope, payload: CreatePayload(session: session, metadata: metadata, draft: initialDraft))
        return try database.transaction {
            if let result: ContestSessionCreationResult = try replay(scope: scope, canonicalPayload: canonical) { return result }
            guard !scope.payloadDigest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ContestRepositoryError.invalidPayloadDigest
            }
            guard scope.sessionID == session.id, scope.expectedRevision == 0,
                  scope.workspaceGeneration == session.workspaceGeneration,
                  scope.draftID == initialDraft.id, initialDraft.sessionID == session.id,
                  initialDraft.revision == 1 else { throw ContestRepositoryError.invalidDraft }
            guard rules.rule(for: session.rule) != nil else { throw ContestStoreError.unknownRule(session.rule) }
            try validateSession(session, metadata: metadata)
            try validateDraft(initialDraft, for: session)
            guard !session.referenceDataVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !metadata.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !metadata.operatorCallsign.isEmpty,
                  !metadata.operatorCategory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  session.station.operatorCallsigns.contains(metadata.operatorCallsign),
                  session.startedAt.timeIntervalSinceReferenceDate.isFinite,
                  session.endedAt?.timeIntervalSinceReferenceDate.isFinite != false,
                  committedAt.timeIntervalSinceReferenceDate.isFinite,
                  initialDraft.updatedAt.timeIntervalSinceReferenceDate.isFinite else {
                throw ContestRepositoryError.invalidDraft
            }
            guard try database.scalarInt("SELECT COUNT(*) FROM sessions WHERE id = ?", [.text(session.id.uuidString)]) == 0 else {
                throw ContestRepositoryError.requestPayloadConflict(requestID: scope.requestID)
            }
            let sessionData = try encode(session)
            let metadataData = try encode(metadata)
            let draftData = try encode(initialDraft)
            try database.execute(
                "INSERT INTO sessions(id, generation, revision, snapshot, metadata, created_at) VALUES(?, ?, 1, ?, ?, ?)",
                [.text(session.id.uuidString), .text(session.workspaceGeneration.uuidString.lowercased()), .blob(sessionData), .blob(metadataData),
                 .double(committedAt.timeIntervalSince1970)]
            )
            try database.execute(
                "INSERT INTO drafts(id, session_id, revision, snapshot, updated_at) VALUES(?, ?, 1, ?, ?)",
                [.text(initialDraft.id.uuidString), .text(session.id.uuidString), .blob(draftData), .double(initialDraft.updatedAt.timeIntervalSince1970)]
            )
            let receipt = ContestMutationReceipt(requestID: scope.requestID, payloadDigest: scope.payloadDigest,
                                                 committedRevision: 1, committedAt: committedAt,
                                                 result: .session(session.id))
            let stored = StoredContestSession(session: session, metadata: metadata, revision: 1, createdAt: committedAt)
            let result = ContestSessionCreationResult(session: stored, draft: initialDraft, receipt: receipt, qsoCount: 0,
                                                      projection: try mutationProjection(sessionID: session.id, draftID: initialDraft.id))
            try saveOperation(scope: scope, canonicalPayload: canonical, receipt: receipt, result: result)
            return result
        }
    }

    public func openSession(id: UUID) throws -> StoredContestSession {
        var value: StoredContestSession?
        try database.query("SELECT snapshot, metadata, revision, created_at FROM sessions WHERE id = ?", [.text(id.uuidString)]) { row in
            value = StoredContestSession(session: try self.decode(ContestSessionSnapshot.self, from: row.blob(0)),
                                         metadata: try self.decode(ContestSessionMetadata.self, from: row.blob(1)),
                                         revision: try row.uint(2), createdAt: Date(timeIntervalSince1970: row.double(3)))
        }
        guard let value else { throw ContestRepositoryError.notFound }
        return value
    }

    public func listStoredSessions() throws -> [StoredContestSession] {
        var values: [StoredContestSession] = []
        try database.query("SELECT snapshot, metadata, revision, created_at FROM sessions ORDER BY created_at DESC, id ASC") { row in
            values.append(StoredContestSession(session: try self.decode(ContestSessionSnapshot.self, from: row.blob(0)),
                                               metadata: try self.decode(ContestSessionMetadata.self, from: row.blob(1)),
                                               revision: try row.uint(2), createdAt: Date(timeIntervalSince1970: row.double(3))))
        }
        return values
    }

    public func sessionReadSnapshot(id: UUID) throws -> ContestSessionReadSnapshot {
        try database.readTransaction { try sessionReadSnapshotInsideTransaction(id: id) }
    }

    public func sessionPageSnapshot(id: UUID, offset: Int, limit: Int) throws -> ContestSessionPageSnapshot {
        guard offset >= 0, limit > 0, limit <= 1_000 else { throw ContestStoreError.invalidPage }
        return try database.readTransaction {
            let session = try openSession(id: id)
            readSnapshotHookForTesting?()
            let sessionDrafts = try drafts(sessionID: id)
            var active: [ContestSerialReservation] = []
            try database.query(
                "SELECT snapshot FROM serial_reservations WHERE session_id = ? " +
                "AND state IN ('reserved','transmitted','uncertain') ORDER BY number ASC, id ASC",
                [.text(id.uuidString)]
            ) { row in active.append(try self.decode(ContestSerialReservation.self, from: row.blob(0))) }
            let pageValues = try qsos(sessionID: id, offset: offset, limit: limit)
            let allValues = try qsos(sessionID: id, offset: 0, limit: Int.max)
            guard let rule = rules.rule(for: session.session.rule) else { throw ContestStoreError.unknownRule(session.session.rule) }
            let log = ContestLogPage(sessionID: id, workspaceGeneration: session.session.workspaceGeneration,
                                     revision: session.revision, qsos: pageValues, total: allValues.count,
                                     offset: offset, limit: limit)
            let score = ContestScoreSnapshot(sessionID: id, workspaceGeneration: session.session.workspaceGeneration,
                                             revision: session.revision,
                                             score: try ContestEngine.score(allValues, session: session.session, rule: rule))
            return ContestSessionPageSnapshot(session: session, drafts: sessionDrafts,
                                              activeReservations: active, log: log, score: score)
        }
    }

    public func listSessionReadSnapshots() throws -> [ContestSessionReadSnapshot] {
        try database.readTransaction {
            let sessions = try listStoredSessions()
            return try sessions.map { try sessionReadSnapshotInsideTransaction(id: $0.session.id) }
        }
    }

    private func sessionReadSnapshotInsideTransaction(id: UUID) throws -> ContestSessionReadSnapshot {
        let session = try openSession(id: id)
        readSnapshotHookForTesting?()
        let sessionDrafts = try drafts(sessionID: id)
        var reservations: [ContestSerialReservation] = []
        try database.query(
            "SELECT snapshot FROM serial_reservations WHERE session_id = ? " +
            "AND state IN ('reserved','transmitted','uncertain') ORDER BY number ASC, id ASC",
            [.text(id.uuidString)]
        ) { row in reservations.append(try self.decode(ContestSerialReservation.self, from: row.blob(0))) }
        let contacts = try qsos(sessionID: id, offset: 0, limit: Int.max)
        return ContestSessionReadSnapshot(session: session, drafts: sessionDrafts,
                                          activeReservations: reservations, qsos: contacts)
    }

    private func mutationProjection(sessionID: UUID, draftID: UUID) throws -> ContestMutationProjection {
        let session = try openSession(id: sessionID)
        let currentDraft = try draft(sessionID: sessionID, id: draftID)
        let active = try activeReservations(sessionID: sessionID, draftID: draftID)
        guard active.count <= 1 else { throw ContestStoreError.corruptRecord }
        guard let rule = rules.rule(for: session.session.rule) else {
            throw ContestStoreError.unknownRule(session.session.rule)
        }
        let contacts = try qsos(sessionID: sessionID, offset: 0, limit: Int.max)
        let score = try ContestEngine.score(contacts, session: session.session, rule: rule)
        let candidate = ContestQSO(id: currentDraft.id, sessionID: sessionID,
                                   timestampUTC: currentDraft.updatedAt,
                                   callsign: currentDraft.callsign, band: currentDraft.band,
                                   mode: currentDraft.mode, frequencyHz: currentDraft.frequencyHz ?? 0,
                                   rstSent: currentDraft.rstSent, rstReceived: currentDraft.rstReceived,
                                   exchange: currentDraft.exchange, entity: currentDraft.entity,
                                   operatorCallsign: currentDraft.operatorCallsign,
                                   stationLocation: currentDraft.stationLocation,
                                   provenance: ContestQSOProvenance(source: .operatorEntry))
        let evaluation = try ContestEngine.evaluate(candidate, session: session.session,
                                                    rule: rule, allowIncomplete: false)
        let validation = evaluation.validation + semanticFrequencyIssues(band: candidate.band,
                                                                          frequencyHz: candidate.frequencyHz)
        let incomplete = validation.contains { $0.severity == .error }
        let projectedDupeKey = incomplete
            ? rule.partialDraftDupeKey(for: candidate, in: session.session, validation: validation)
            : evaluation.dupeKey
        let isDuplicate: Bool? = projectedDupeKey.map { key in
            score.qsos.contains { $0.disposition != .invalid && $0.dupeKey == key }
        }
        let summary = ContestScoreSummarySnapshot(sessionID: sessionID,
                                                  workspaceGeneration: session.session.workspaceGeneration,
                                                  revision: session.revision, qsoCount: contacts.count,
                                                  totalPoints: score.totalPoints,
                                                  multiplierCount: score.multiplierCount,
                                                  claimedScore: score.claimedScore)
        let draftEvaluation = ContestDraftEvaluationSnapshot(validation: validation,
                                                             dupeKey: projectedDupeKey,
                                                             isDuplicate: isDuplicate)
        return ContestMutationProjection(session: session, draft: currentDraft,
                                         activeReservations: active, score: summary,
                                         draftEvaluation: draftEvaluation)
    }

    private func operationReceipt(sessionID: UUID, requestID: UUID) throws -> ContestMutationReceipt? {
        var receipt: ContestMutationReceipt?
        try database.query("SELECT receipt FROM operations WHERE session_id = ? AND request_id = ?",
                           [.text(sessionID.uuidString), .text(requestID.uuidString)]) { row in
            receipt = try self.decode(ContestMutationReceipt.self, from: row.blob(0))
        }
        return receipt
    }

    public func operationReceipt(sessionID: UUID, workspaceGeneration: UUID,
                                 requestID: UUID, payloadDigest: String) throws -> ContestMutationReceipt? {
        let stored = try openSession(id: sessionID)
        guard stored.session.workspaceGeneration == workspaceGeneration else {
            throw ContestRepositoryError.staleWorkspaceGeneration
        }
        guard let receipt = try operationReceipt(sessionID: sessionID, requestID: requestID) else { return nil }
        guard receipt.payloadDigest == payloadDigest else {
            throw ContestRepositoryError.requestPayloadConflict(requestID: requestID)
        }
        return receipt
    }

    public func draft(sessionID: UUID, id: UUID) throws -> ContestDraftSnapshot {
        var draft: ContestDraftSnapshot?
        try database.query("SELECT snapshot FROM drafts WHERE session_id = ? AND id = ?",
                           [.text(sessionID.uuidString), .text(id.uuidString)]) { row in
            draft = try self.decode(ContestDraftSnapshot.self, from: row.blob(0))
        }
        guard let draft else { throw ContestRepositoryError.notFound }
        return draft
    }

    public func drafts(sessionID: UUID) throws -> [ContestDraftSnapshot] {
        _ = try openSession(id: sessionID)
        var values: [ContestDraftSnapshot] = []
        try database.query("SELECT snapshot FROM drafts WHERE session_id = ? ORDER BY id ASC",
                           [.text(sessionID.uuidString)]) { row in
            values.append(try self.decode(ContestDraftSnapshot.self, from: row.blob(0)))
        }
        return values
    }

    public func updateDraft(_ draft: ContestDraftSnapshot, scope: ContestMutationScope,
                            committedAt: Date) throws -> ContestDraftMutationResult {
        let canonical = try canonicalPayload(scope: scope, payload: UpdateDraftPayload(draft: draft))
        return try database.transaction {
            if let result: ContestDraftMutationResult = try replay(scope: scope, canonicalPayload: canonical) { return result }
            let next = try verify(scope)
            guard scope.draftID == draft.id, draft.sessionID == scope.sessionID,
                  draft.revision == next, draft.updatedAt.timeIntervalSinceReferenceDate.isFinite,
                  committedAt.timeIntervalSinceReferenceDate.isFinite else { throw ContestRepositoryError.invalidDraft }
            guard try database.scalarInt("SELECT COUNT(*) FROM drafts WHERE session_id = ? AND id = ?",
                                         [.text(scope.sessionID.uuidString), .text(draft.id.uuidString)]) == 1 else {
                throw ContestRepositoryError.notFound
            }
            let before = try openSession(id: scope.sessionID)
            guard let rule = rules.rule(for: before.session.rule) else {
                throw ContestStoreError.unknownRule(before.session.rule)
            }
            let resolvedSerial = try rule.resolvedSerialRequirement(in: before.session)
            let oldDraft = try self.draft(sessionID: scope.sessionID, id: draft.id)
            let active = try activeReservations(sessionID: scope.sessionID, draftID: draft.id)
            try validateDraft(draft, for: before.session, allowsAllocatedSerial: !active.isEmpty)
            try validateReservationPreservingEdit(from: oldDraft, to: draft, reservations: active,
                                                   resolvedSerial: resolvedSerial)
            try database.execute("UPDATE drafts SET revision = ?, snapshot = ?, updated_at = ? WHERE session_id = ? AND id = ?",
                                 [.uint(next), .blob(try encode(draft)), .double(draft.updatedAt.timeIntervalSince1970),
                                  .text(scope.sessionID.uuidString), .text(draft.id.uuidString)])
            try advanceSession(scope.sessionID, to: next)
            for reservation in active {
                let updated = ContestSerialReservation(id: reservation.id, sessionID: reservation.sessionID,
                    draftID: reservation.draftID, scope: reservation.scope, scopeValue: reservation.scopeValue,
                    number: reservation.number, transmittedText: reservation.transmittedText,
                    state: reservation.state, reservedAt: reservation.reservedAt,
                    updatedAt: committedAt, revision: next)
                try database.execute("UPDATE serial_reservations SET snapshot = ? WHERE id = ?",
                                     [.blob(try encode(updated)), .text(updated.id.uuidString)])
            }
            let receipt = ContestMutationReceipt(requestID: scope.requestID, payloadDigest: scope.payloadDigest,
                                                 committedRevision: next, committedAt: committedAt,
                                                 result: .draft(draft.id))
            let stored = StoredContestSession(session: before.session, metadata: before.metadata,
                                              revision: next, createdAt: before.createdAt)
            let projection = try mutationProjection(sessionID: scope.sessionID, draftID: draft.id)
            let result = ContestDraftMutationResult(session: stored, draft: draft, receipt: receipt,
                                                    qsoCount: projection.score.qsoCount, projection: projection)
            try saveOperation(scope: scope, canonicalPayload: canonical, receipt: receipt, result: result)
            return result
        }
    }

    public func reserveSerial(reservationID: UUID, serialScope: ContestSerialScope, scopeValue: String,
                              scope: ContestMutationScope, committedAt: Date) throws -> ContestSerialReservationResult {
        let normalizedScope = scopeValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let canonical = try canonicalPayload(scope: scope, payload: ReservePayload(reservationID: reservationID,
                                                                                   serialScope: serialScope,
                                                                                   scopeValue: normalizedScope))
        return try database.transaction {
            if let result: ContestSerialReservationResult = try replay(scope: scope, canonicalPayload: canonical) { return result }
            let next = try verify(scope)
            let validSerialScope = serialScope == .session ? normalizedScope.isEmpty : !normalizedScope.isEmpty
            guard validSerialScope, committedAt.timeIntervalSinceReferenceDate.isFinite else {
                throw ContestRepositoryError.invalidDraft
            }
            guard let draftID = scope.draftID else { throw ContestRepositoryError.invalidDraft }
            _ = try draft(sessionID: scope.sessionID, id: draftID)
            let before = try openSession(id: scope.sessionID)
            guard let rule = rules.rule(for: before.session.rule) else {
                throw ContestStoreError.unknownRule(before.session.rule)
            }
            let serial = try rule.resolvedSerialRequirement(in: before.session)
            guard serial.requirement == .requiredForCommit,
                  serial.allowedScopes.contains(serialScope) else {
                throw ContestRepositoryError.invalidSerialTransition
            }
            let serialFieldID = serial.allocatedFieldID
            let serialField = serialFieldID.flatMap { id in
                rule.metadata.entry.exchange.sentFields.first { $0.id == id }
            }
            if rule.metadata.entry.version == .v2, serialField == nil {
                throw ContestRepositoryError.invalidSerialTransition
            }
            guard try activeReservations(sessionID: scope.sessionID, draftID: draftID).isEmpty else {
                throw ContestRepositoryError.invalidSerialTransition
            }
            let activeCount = try database.scalarInt(
                "SELECT COUNT(*) FROM serial_reservations WHERE session_id = ? AND draft_id = ? AND scope = ? AND scope_value = ? AND state IN ('reserved','transmitted','uncertain')",
                [.text(scope.sessionID.uuidString), .text(draftID.uuidString), .text(serialScope.rawValue), .text(normalizedScope)]
            )
            guard activeCount == 0 else { throw ContestRepositoryError.invalidSerialTransition }
            let current = try database.scalarUInt(
                "SELECT next_number FROM serial_counters WHERE session_id = ? AND scope = ? AND scope_value = ?",
                [.text(scope.sessionID.uuidString), .text(serialScope.rawValue), .text(normalizedScope)]) ?? 1
            guard current < UInt64.max else { throw ContestStoreError.serialExhausted }
            let text = String(format: "%03llu", current)
            guard Int(text).map({ $0 > 0 }) == true,
                  serialField.map({ text.utf8.count <= $0.maximumUTF8Bytes }) != false else {
                throw ContestStoreError.serialExhausted
            }
            let nextNumber = current + 1
            try database.execute(
                "INSERT INTO serial_counters(session_id, scope, scope_value, next_number) VALUES(?, ?, ?, ?) " +
                "ON CONFLICT(session_id, scope, scope_value) DO UPDATE SET next_number = excluded.next_number",
                [.text(scope.sessionID.uuidString), .text(serialScope.rawValue), .text(normalizedScope), .uint(nextNumber)]
            )
            let reservation = ContestSerialReservation(id: reservationID, sessionID: scope.sessionID, draftID: draftID,
                                                       scope: serialScope, scopeValue: normalizedScope, number: current,
                                                       transmittedText: text, state: .reserved, reservedAt: committedAt,
                                                       updatedAt: committedAt, revision: next)
            try database.execute(
                "INSERT INTO serial_reservations(id, session_id, draft_id, scope, scope_value, number, state, snapshot) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                [.text(reservationID.uuidString), .text(scope.sessionID.uuidString), .text(draftID.uuidString),
                 .text(serialScope.rawValue), .text(normalizedScope), .uint(current), .text(ContestSerialState.reserved.rawValue),
                 .blob(try encode(reservation))]
            )
            try bindSerialToDraft(sessionID: scope.sessionID, draftID: draftID, reservation: reservation,
                                  allocatedFieldID: serialFieldID,
                                  revision: next, updatedAt: committedAt)
            try advanceSession(scope.sessionID, to: next)
            let receipt = ContestMutationReceipt(requestID: scope.requestID, payloadDigest: scope.payloadDigest,
                                                 committedRevision: next, committedAt: committedAt,
                                                 result: .serialReservation(reservationID))
            let bumpedDraft = try draft(sessionID: scope.sessionID, id: draftID)
            let stored = StoredContestSession(session: before.session, metadata: before.metadata,
                                              revision: next, createdAt: before.createdAt)
            let projection = try mutationProjection(sessionID: scope.sessionID, draftID: draftID)
            let result = ContestSerialReservationResult(session: stored, draft: bumpedDraft,
                                                        reservation: reservation, receipt: receipt,
                                                        qsoCount: projection.score.qsoCount, projection: projection)
            try saveOperation(scope: scope, canonicalPayload: canonical, receipt: receipt, result: result)
            return result
        }
    }

    public func reservation(id: UUID) throws -> ContestSerialReservation {
        var value: ContestSerialReservation?
        try database.query("SELECT snapshot FROM serial_reservations WHERE id = ?", [.text(id.uuidString)]) { row in
            value = try self.decode(ContestSerialReservation.self, from: row.blob(0))
        }
        guard let value else { throw ContestRepositoryError.notFound }
        return value
    }

    public func activeReservations(sessionID: UUID, draftID: UUID) throws -> [ContestSerialReservation] {
        var values: [ContestSerialReservation] = []
        try database.query(
            "SELECT snapshot FROM serial_reservations WHERE session_id = ? AND draft_id = ? " +
            "AND state IN ('reserved','transmitted','uncertain') ORDER BY number ASC, id ASC",
            [.text(sessionID.uuidString), .text(draftID.uuidString)]
        ) { row in values.append(try self.decode(ContestSerialReservation.self, from: row.blob(0))) }
        return values
    }

    public func reservations(sessionID: UUID, draftID: UUID) throws -> [ContestSerialReservation] {
        var values: [ContestSerialReservation] = []
        try database.query(
            "SELECT snapshot FROM serial_reservations WHERE session_id = ? AND draft_id = ? ORDER BY number ASC, id ASC",
            [.text(sessionID.uuidString), .text(draftID.uuidString)]
        ) { row in values.append(try self.decode(ContestSerialReservation.self, from: row.blob(0))) }
        return values
    }

    public func transitionSerial(reservationID: UUID, to state: ContestSerialState,
                                 scope: ContestMutationScope, committedAt: Date) throws -> ContestSerialTransitionResult {
        let canonical = try canonicalPayload(scope: scope, payload: TransitionPayload(reservationID: reservationID, state: state))
        return try database.transaction {
            if let result: ContestSerialTransitionResult = try replay(scope: scope, canonicalPayload: canonical) { return result }
            let next = try verify(scope)
            guard committedAt.timeIntervalSinceReferenceDate.isFinite else { throw ContestRepositoryError.invalidDraft }
            let old = try reservation(id: reservationID)
            guard let draftID = scope.draftID, draftID == old.draftID,
                  old.sessionID == scope.sessionID, state != .committed,
                  old.state.canTransition(to: state) else {
                throw ContestRepositoryError.invalidSerialTransition
            }
            let before = try openSession(id: scope.sessionID)
            guard let rule = rules.rule(for: before.session.rule) else {
                throw ContestStoreError.unknownRule(before.session.rule)
            }
            let serial = try rule.resolvedSerialRequirement(in: before.session)
            guard serial.requirement == .requiredForCommit,
                  serial.allowedScopes.contains(old.scope),
                  rule.metadata.entry.version == .v1 || serial.allocatedFieldID != nil else {
                throw ContestRepositoryError.invalidSerialTransition
            }
            let updated = ContestSerialReservation(id: old.id, sessionID: old.sessionID, draftID: old.draftID,
                                                   scope: old.scope, scopeValue: old.scopeValue, number: old.number,
                                                   transmittedText: old.transmittedText, state: state,
                                                   reservedAt: old.reservedAt, updatedAt: committedAt, revision: next)
            try database.execute("UPDATE serial_reservations SET state = ?, snapshot = ? WHERE id = ?",
                                 [.text(state.rawValue), .blob(try encode(updated)), .text(reservationID.uuidString)])
            try bumpDraft(sessionID: scope.sessionID, draftID: draftID, revision: next,
                          updatedAt: committedAt, clearContact: false)
            try advanceSession(scope.sessionID, to: next)
            let receipt = ContestMutationReceipt(requestID: scope.requestID, payloadDigest: scope.payloadDigest,
                                                 committedRevision: next, committedAt: committedAt,
                                                 result: .serialReservation(reservationID))
            let bumpedDraft = try draft(sessionID: scope.sessionID, id: draftID)
            let stored = StoredContestSession(session: before.session, metadata: before.metadata,
                                              revision: next, createdAt: before.createdAt)
            let projection = try mutationProjection(sessionID: scope.sessionID, draftID: draftID)
            let result = ContestSerialTransitionResult(session: stored, draft: bumpedDraft,
                                                       reservation: updated, receipt: receipt,
                                                       qsoCount: projection.score.qsoCount, projection: projection)
            try saveOperation(scope: scope, canonicalPayload: canonical, receipt: receipt, result: result)
            return result
        }
    }

    public func commitQSO(_ qso: ContestQSO, reservationID: UUID?, scope: ContestMutationScope,
                          committedAt: Date) throws -> ContestQSOCommitResult {
        let canonical = try canonicalPayload(scope: scope, payload: CommitPayload(qso: qso, reservationID: reservationID))
        return try database.transaction {
            if let result: ContestQSOCommitResult = try replay(scope: scope, canonicalPayload: canonical) { return result }
            let next = try verify(scope)
            guard committedAt.timeIntervalSinceReferenceDate.isFinite else { throw ContestRepositoryError.invalidDraft }
            guard qso.sessionID == scope.sessionID else { throw ContestEvaluationError.wrongSession(qsoID: qso.id) }
            let stored = try openSession(id: scope.sessionID)
            guard let rule = rules.rule(for: stored.session.rule) else { throw ContestStoreError.unknownRule(stored.session.rule) }
            try validateQSOStructure(qso, for: stored.session)
            let semanticIssues = semanticFrequencyIssues(band: qso.band, frequencyHz: qso.frequencyHz)
            guard semanticIssues.isEmpty else { throw ContestStoreError.invalidQSO(semanticIssues) }
            let serialRequirement = try rule.resolvedSerialRequirement(in: stored.session)
            if serialRequirement.requirement == .requiredForCommit, reservationID == nil {
                throw ContestStoreError.reservationMismatch
            }
            if serialRequirement.requirement == .none, reservationID != nil { throw ContestStoreError.reservationMismatch }
            var existing = try qsos(sessionID: scope.sessionID, offset: 0, limit: Int.max)
            existing.append(qso)
            let score = try ContestEngine.score(existing, session: stored.session, rule: rule)
            if let result = score.qsos.first(where: { $0.qsoID == qso.id }), result.disposition == .invalid {
                throw ContestStoreError.invalidQSO(result.issues)
            }
            if let reservationID {
                let serial = try reservation(id: reservationID)
                let serialScopeMatches: Bool
                switch serial.scope {
                case .session: serialScopeMatches = serial.scopeValue.isEmpty
                case .band: serialScopeMatches = serial.scopeValue == qso.band.lowercased()
                case .transmitter: serialScopeMatches = serial.scopeValue == qso.operatorCallsign.lowercased()
                }
                guard serial.sessionID == scope.sessionID, serial.draftID == scope.draftID,
                      serialRequirement.allowedScopes.contains(serial.scope),
                      serialScopeMatches,
                      [.reserved, .transmitted, .uncertain].contains(serial.state),
                      qso.exchange.rawSent == serial.transmittedText,
                      qso.exchange.normalizedSent == serial.transmittedText else {
                    throw ContestStoreError.reservationMismatch
                }
                if rule.metadata.entry.version == .v2 {
                    guard let serialFieldID = serialRequirement.allocatedFieldID,
                          let value = qso.exchange.sentFields[serialFieldID],
                          value.raw == serial.transmittedText,
                          value.normalized == serial.transmittedText else {
                        throw ContestStoreError.reservationMismatch
                    }
                }
                let committed = ContestSerialReservation(id: serial.id, sessionID: serial.sessionID, draftID: serial.draftID,
                                                         scope: serial.scope, scopeValue: serial.scopeValue, number: serial.number,
                                                         transmittedText: serial.transmittedText, state: .committed,
                                                         reservedAt: serial.reservedAt, updatedAt: committedAt, revision: next)
                try database.execute("UPDATE serial_reservations SET state = 'committed', snapshot = ? WHERE id = ?",
                                     [.blob(try encode(committed)), .text(serial.id.uuidString)])
            }
            try database.execute("INSERT INTO qsos(id, session_id, timestamp, snapshot) VALUES(?, ?, ?, ?)",
                                 [.text(qso.id.uuidString), .text(scope.sessionID.uuidString),
                                  .double(qso.timestampUTC.timeIntervalSince1970), .blob(try encode(qso))])
            guard let draftID = scope.draftID else { throw ContestRepositoryError.invalidDraft }
            try bumpDraft(sessionID: scope.sessionID, draftID: draftID, revision: next,
                          updatedAt: committedAt, clearContact: true)
            try advanceSession(scope.sessionID, to: next)
            let receipt = ContestMutationReceipt(requestID: scope.requestID, payloadDigest: scope.payloadDigest,
                                                 committedRevision: next, committedAt: committedAt, result: .qso(qso.id))
            let bumpedDraft = try draft(sessionID: scope.sessionID, id: draftID)
            let committedSession = StoredContestSession(session: stored.session, metadata: stored.metadata,
                                                        revision: next, createdAt: stored.createdAt)
            let scoreSnapshot = ContestScoreSummarySnapshot(sessionID: scope.sessionID,
                                                            workspaceGeneration: stored.session.workspaceGeneration,
                                                            revision: next, qsoCount: score.qsos.count,
                                                            totalPoints: score.totalPoints,
                                                            multiplierCount: score.multiplierCount,
                                                            claimedScore: score.claimedScore)
            guard let committedEvaluation = score.qsos.first(where: { $0.qsoID == qso.id }) else {
                throw ContestStoreError.corruptRecord
            }
            let projection = try mutationProjection(sessionID: scope.sessionID, draftID: draftID)
            let result = ContestQSOCommitResult(session: committedSession, draft: bumpedDraft,
                                                qso: qso, committedEvaluation: committedEvaluation,
                                                score: scoreSnapshot, receipt: receipt,
                                                qsoCount: score.qsos.count, projection: projection)
            try saveOperation(scope: scope, canonicalPayload: canonical, receipt: receipt, result: result)
            return result
        }
    }

    public func qsoReadSnapshot(sessionID: UUID, id: UUID, expectedWorkspaceGeneration: UUID,
                                expectedRevision: UInt64) throws -> ContestQSOReadSnapshot {
        try database.readTransaction {
            let stored = try openSession(id: sessionID)
            guard stored.session.workspaceGeneration == expectedWorkspaceGeneration else {
                throw ContestRepositoryError.staleWorkspaceGeneration
            }
            guard stored.revision == expectedRevision else {
                throw ContestRepositoryError.staleRevision(expected: expectedRevision, actual: stored.revision)
            }
            readSnapshotHookForTesting?()
            let value = try qso(sessionID: sessionID, id: id)
            return ContestQSOReadSnapshot(session: stored, qso: value)
        }
    }

    public func correctQSO(_ corrected: ContestQSO, reason: String, operationTimestamp: Date,
                           scope: ContestMutationScope,
                           committedAt: Date) throws -> ContestQSOChangeResult {
        let normalizedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let canonical = try canonicalPayload(scope: scope,
                                             payload: CorrectQSOPayload(qso: corrected, reason: normalizedReason,
                                                                        operationTimestamp: operationTimestamp))
        return try database.transaction {
            if let result: ContestQSOChangeResult = try replay(scope: scope, canonicalPayload: canonical) { return result }
            let next = try verify(scope)
            try validateQSOChange(reason: normalizedReason, operationTimestamp: operationTimestamp,
                                  scope: scope, committedAt: committedAt)
            let before = try qso(sessionID: scope.sessionID, id: corrected.id)
            try validateImmutableQSOFields(before: before, after: corrected)
            let stored = try openSession(id: scope.sessionID)
            guard let rule = rules.rule(for: stored.session.rule) else {
                throw ContestStoreError.unknownRule(stored.session.rule)
            }
            try validateQSOStructure(corrected, for: stored.session)
            let semanticIssues = semanticFrequencyIssues(band: corrected.band, frequencyHz: corrected.frequencyHz)
            guard semanticIssues.isEmpty else { throw ContestStoreError.invalidQSO(semanticIssues) }
            var contacts = try qsos(sessionID: scope.sessionID, offset: 0, limit: Int.max)
            guard let index = contacts.firstIndex(where: { $0.id == corrected.id }) else {
                throw ContestRepositoryError.notFound
            }
            contacts[index] = corrected
            let score = try ContestEngine.score(contacts, session: stored.session, rule: rule)
            if let evaluation = score.qsos.first(where: { $0.qsoID == corrected.id }),
               evaluation.disposition == .invalid {
                throw ContestStoreError.invalidQSO(evaluation.issues)
            }
            let audit = ContestQSOAuditRecord(sessionID: scope.sessionID, qsoID: corrected.id,
                                              operation: .correction, before: before, after: corrected,
                                              reason: normalizedReason, requestID: scope.requestID,
                                              operationTimestamp: operationTimestamp,
                                              committedAt: committedAt, committedRevision: next)
            try appendAudit(audit)
            try mutationWriteHookForTesting?("afterAudit")
            try database.execute("UPDATE qsos SET snapshot = ? WHERE session_id = ? AND id = ? AND is_deleted = 0",
                                 [.blob(try encode(corrected)), .text(scope.sessionID.uuidString),
                                  .text(corrected.id.uuidString)])
            try advanceSession(scope.sessionID, to: next)
            let receipt = ContestMutationReceipt(requestID: scope.requestID, payloadDigest: scope.payloadDigest,
                                                 committedRevision: next, committedAt: committedAt,
                                                 result: .qso(corrected.id))
            let result = makeQSOChangeResult(stored: stored, operation: .correction,
                                             before: before, after: corrected, score: score,
                                             revision: next, receipt: receipt)
            try saveOperation(scope: scope, canonicalPayload: canonical, receipt: receipt, result: result)
            try mutationWriteHookForTesting?("beforeCommit")
            return result
        }
    }

    public func deleteQSO(id: UUID, reason: String, operationTimestamp: Date,
                          scope: ContestMutationScope,
                          committedAt: Date) throws -> ContestQSOChangeResult {
        let normalizedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let canonical = try canonicalPayload(scope: scope,
                                             payload: DeleteQSOPayload(qsoID: id, reason: normalizedReason,
                                                                       operationTimestamp: operationTimestamp))
        return try database.transaction {
            if let result: ContestQSOChangeResult = try replay(scope: scope, canonicalPayload: canonical) { return result }
            let next = try verify(scope)
            try validateQSOChange(reason: normalizedReason, operationTimestamp: operationTimestamp,
                                  scope: scope, committedAt: committedAt)
            let before = try qso(sessionID: scope.sessionID, id: id)
            let stored = try openSession(id: scope.sessionID)
            guard let rule = rules.rule(for: stored.session.rule) else {
                throw ContestStoreError.unknownRule(stored.session.rule)
            }
            let contacts = try qsos(sessionID: scope.sessionID, offset: 0, limit: Int.max)
                .filter { $0.id != id }
            let score = try ContestEngine.score(contacts, session: stored.session, rule: rule)
            let audit = ContestQSOAuditRecord(sessionID: scope.sessionID, qsoID: id,
                                              operation: .deletion, before: before, after: nil,
                                              reason: normalizedReason, requestID: scope.requestID,
                                              operationTimestamp: operationTimestamp,
                                              committedAt: committedAt, committedRevision: next)
            try appendAudit(audit)
            try mutationWriteHookForTesting?("afterAudit")
            try database.execute("UPDATE qsos SET is_deleted = 1, deleted_at = ? WHERE session_id = ? AND id = ? AND is_deleted = 0",
                                 [.double(committedAt.timeIntervalSince1970), .text(scope.sessionID.uuidString),
                                  .text(id.uuidString)])
            try advanceSession(scope.sessionID, to: next)
            let receipt = ContestMutationReceipt(requestID: scope.requestID, payloadDigest: scope.payloadDigest,
                                                 committedRevision: next, committedAt: committedAt,
                                                 result: .qso(id))
            let result = makeQSOChangeResult(stored: stored, operation: .deletion,
                                             before: before, after: nil, score: score,
                                             revision: next, receipt: receipt)
            try saveOperation(scope: scope, canonicalPayload: canonical, receipt: receipt, result: result)
            try mutationWriteHookForTesting?("beforeCommit")
            return result
        }
    }

    public func qsoAuditTrail(sessionID: UUID, qsoID: UUID) throws -> [ContestQSOAuditRecord] {
        _ = try openSession(id: sessionID)
        var values: [ContestQSOAuditRecord] = []
        try database.query(
            "SELECT record FROM qso_audit WHERE session_id = ? AND qso_id = ? ORDER BY committed_revision ASC, request_id ASC",
            [.text(sessionID.uuidString), .text(qsoID.uuidString)]
        ) { row in values.append(try self.decode(ContestQSOAuditRecord.self, from: row.blob(0))) }
        return values
    }

    public func qso(sessionID: UUID, id: UUID) throws -> ContestQSO {
        var value: ContestQSO?
        var deleted = false
        try database.query("SELECT snapshot, is_deleted FROM qsos WHERE session_id = ? AND id = ?",
                           [.text(sessionID.uuidString), .text(id.uuidString)]) { row in
            value = try self.decode(ContestQSO.self, from: row.blob(0))
            deleted = try row.uint(1) != 0
        }
        guard let value else { throw ContestRepositoryError.notFound }
        guard !deleted else { throw ContestStoreError.qsoDeleted(id) }
        return value
    }

    public func qsos(sessionID: UUID, offset: Int, limit: Int) throws -> [ContestQSO] {
        guard offset >= 0, limit > 0 else { throw ContestStoreError.invalidPage }
        var values: [ContestQSO] = []
        try database.query(
            "SELECT snapshot FROM qsos WHERE session_id = ? AND is_deleted = 0 ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?",
            [.text(sessionID.uuidString), .int64(Int64(limit)), .int64(Int64(offset))]
        ) { row in values.append(try self.decode(ContestQSO.self, from: row.blob(0))) }
        return values
    }

    private func qsoCount(sessionID: UUID) throws -> Int {
        try database.scalarInt("SELECT COUNT(*) FROM qsos WHERE session_id = ? AND is_deleted = 0", [.text(sessionID.uuidString)])
    }

    public func logPage(sessionID: UUID, offset: Int, limit: Int) throws -> ContestLogPage {
        guard limit <= 1_000 else { throw ContestStoreError.invalidPage }
        return try database.readTransaction {
            let stored = try openSession(id: sessionID)
            readSnapshotHookForTesting?()
            let values = try qsos(sessionID: sessionID, offset: offset, limit: limit)
            let total = try database.scalarInt("SELECT COUNT(*) FROM qsos WHERE session_id = ? AND is_deleted = 0", [.text(sessionID.uuidString)])
            return ContestLogPage(sessionID: sessionID, workspaceGeneration: stored.session.workspaceGeneration,
                                  revision: stored.revision, qsos: values, total: total, offset: offset, limit: limit)
        }
    }

    public func scoreSnapshot(sessionID: UUID) throws -> ContestScoreSnapshot {
        try database.readTransaction {
            let stored = try openSession(id: sessionID)
            readSnapshotHookForTesting?()
            guard let rule = rules.rule(for: stored.session.rule) else { throw ContestStoreError.unknownRule(stored.session.rule) }
            let values = try qsos(sessionID: sessionID, offset: 0, limit: Int.max)
            return ContestScoreSnapshot(sessionID: sessionID, workspaceGeneration: stored.session.workspaceGeneration,
                                        revision: stored.revision,
                                        score: try ContestEngine.score(values, session: stored.session, rule: rule))
        }
    }

    private func validateQSOChange(reason: String, operationTimestamp: Date,
                                   scope: ContestMutationScope, committedAt: Date) throws {
        guard scope.draftID == nil else { throw ContestRepositoryError.invalidDraft }
        guard !reason.isEmpty, reason.utf8.count <= 1_024 else {
            throw ContestStoreError.invalidCorrectionReason
        }
        guard operationTimestamp.timeIntervalSinceReferenceDate.isFinite,
              committedAt.timeIntervalSinceReferenceDate.isFinite else {
            throw ContestStoreError.invalidCorrectionReason
        }
    }

    private func validateImmutableQSOFields(before: ContestQSO, after: ContestQSO) throws {
        guard before.id == after.id else { throw ContestStoreError.immutableQSOField("id") }
        guard before.sessionID == after.sessionID else { throw ContestStoreError.immutableQSOField("sessionID") }
        guard before.timestampUTC == after.timestampUTC else { throw ContestStoreError.immutableQSOField("timestampUTC") }
        guard before.provenance == after.provenance else { throw ContestStoreError.immutableQSOField("provenance") }
        guard before.operatorCallsign == after.operatorCallsign else {
            throw ContestStoreError.immutableQSOField("operatorCallsign")
        }
        guard before.stationLocation == after.stationLocation else {
            throw ContestStoreError.immutableQSOField("stationLocation")
        }
        guard before.exchange.rawSent == after.exchange.rawSent,
              before.exchange.normalizedSent == after.exchange.normalizedSent,
              before.exchange.sentFields == after.exchange.sentFields else {
            throw ContestStoreError.immutableQSOField("allocatedSentSerial")
        }
    }

    private func validateQSOStructure(_ qso: ContestQSO, for session: ContestSessionSnapshot) throws {
        guard let rule = rules.rule(for: session.rule) else { throw ContestStoreError.unknownRule(session.rule) }
        let entry = rule.metadata.entry
        let descriptorIssues = entry.structuralIssues(mode: qso.mode, rstSent: qso.rstSent,
                                                      rstReceived: qso.rstReceived,
                                                      exchange: qso.exchange, allowIncomplete: true)
        let exchanges = [qso.exchange.rawSent, qso.exchange.normalizedSent,
                         qso.exchange.rawReceived, qso.exchange.normalizedReceived]
        let reportBound = entry.modeProfile(for: qso.mode)?.report.maximumUTF8Bytes
        let valid = validCallsign(qso.callsign) &&
            rule.metadata.supportedBands.contains(qso.band) && qso.band == qso.band.lowercased() &&
            entry.isCoherent(supportedModes: rule.metadata.supportedModes) && reportBound != nil &&
            qso.frequencyHz > 0 && qso.frequencyHz <= 100_000_000_000 &&
            qso.rstSent.utf8.count <= (reportBound ?? 0) &&
            qso.rstReceived.utf8.count <= (reportBound ?? 0) && descriptorIssues.isEmpty &&
            exchanges.allSatisfy { $0.utf8.count <= 64 } &&
            validCallsign(qso.operatorCallsign) && session.station.operatorCallsigns.contains(qso.operatorCallsign) &&
            qso.stationLocation.utf8.count <= 128 && qso.entity.map(validEntity) != false &&
            qso.timestampUTC.timeIntervalSinceReferenceDate.isFinite &&
            qso.provenance.sourceIdentity.map { $0.utf8.count <= 256 } != false
        guard valid else {
            throw ContestStoreError.invalidQSO([
                ContestValidationIssue(code: "qso_structural_bounds", field: "qso",
                                       message: "QSO exceeds durable contest field bounds")
            ])
        }
    }

    private func appendAudit(_ record: ContestQSOAuditRecord) throws {
        try database.execute(
            "INSERT INTO qso_audit(session_id, qso_id, operation, before_snapshot, after_snapshot, reason, request_id, operation_timestamp, committed_at, committed_revision, record) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [.text(record.sessionID.uuidString), .text(record.qsoID.uuidString),
             .text(record.operation.rawValue), .blob(try encode(record.before)),
             .blob(try record.after.map(encode) ?? Data()), .text(record.reason),
             .text(record.requestID.uuidString), .double(record.operationTimestamp.timeIntervalSince1970),
             .double(record.committedAt.timeIntervalSince1970),
             .uint(record.committedRevision), .blob(try encode(record))]
        )
    }

    private func makeQSOChangeResult(stored: StoredContestSession,
                                     operation: ContestQSOChangeOperation,
                                     before: ContestQSO, after: ContestQSO?, score: ContestScore,
                                     revision: UInt64, receipt: ContestMutationReceipt) -> ContestQSOChangeResult {
        let session = StoredContestSession(session: stored.session, metadata: stored.metadata,
                                           revision: revision, createdAt: stored.createdAt)
        let summary = ContestScoreSummarySnapshot(sessionID: stored.session.id,
                                                  workspaceGeneration: stored.session.workspaceGeneration,
                                                  revision: revision, qsoCount: score.qsos.count,
                                                  totalPoints: score.totalPoints,
                                                  multiplierCount: score.multiplierCount,
                                                  claimedScore: score.claimedScore)
        return ContestQSOChangeResult(session: session, operation: operation, qsoID: before.id,
                                      before: before, after: after, score: summary,
                                      receipt: receipt, qsoCount: score.qsos.count)
    }

    private func verify(_ scope: ContestMutationScope) throws -> UInt64 {
        guard !scope.payloadDigest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ContestRepositoryError.invalidPayloadDigest
        }
        let stored = try openSession(id: scope.sessionID)
        guard stored.session.workspaceGeneration == scope.workspaceGeneration else {
            throw ContestRepositoryError.staleWorkspaceGeneration
        }
        guard stored.revision == scope.expectedRevision else {
            throw ContestRepositoryError.staleRevision(expected: scope.expectedRevision, actual: stored.revision)
        }
        guard stored.revision < UInt64.max else { throw ContestStoreError.serialExhausted }
        return stored.revision + 1
    }

    private func replay<Result: Decodable>(scope: ContestMutationScope, canonicalPayload: Data) throws -> Result? {
        var storedPayload: Data?
        var resultData: Data?
        try database.query("SELECT canonical_payload, result FROM operations WHERE session_id = ? AND request_id = ?",
                           [.text(scope.sessionID.uuidString), .text(scope.requestID.uuidString)]) { row in
            storedPayload = row.blob(0)
            resultData = row.blob(1)
        }
        guard let storedPayload else { return nil }
        guard storedPayload == canonicalPayload else {
            throw ContestRepositoryError.requestPayloadConflict(requestID: scope.requestID)
        }
        guard let resultData else { throw ContestStoreError.corruptRecord }
        return try decode(Result.self, from: resultData)
    }

    private func saveOperation<Result: Encodable>(scope: ContestMutationScope, canonicalPayload: Data,
                                                  receipt: ContestMutationReceipt, result: Result) throws {
        try database.execute(
            "INSERT INTO operations(session_id, request_id, payload_digest, canonical_payload, receipt, result, committed_revision) VALUES(?, ?, ?, ?, ?, ?, ?)",
            [.text(scope.sessionID.uuidString), .text(scope.requestID.uuidString), .text(scope.payloadDigest),
             .blob(canonicalPayload), .blob(try encode(receipt)), .blob(try encode(result)), .uint(receipt.committedRevision)]
        )
    }

    private func advanceSession(_ sessionID: UUID, to revision: UInt64) throws {
        try database.execute("UPDATE sessions SET revision = ? WHERE id = ?", [.uint(revision), .text(sessionID.uuidString)])
    }

    private func bumpDraft(sessionID: UUID, draftID: UUID, revision: UInt64,
                           updatedAt: Date, clearContact: Bool) throws {
        let old = try draft(sessionID: sessionID, id: draftID)
        let session = try openSession(id: sessionID).session
        guard let rule = rules.rule(for: session.rule) else { throw ContestStoreError.unknownRule(session.rule) }
        let entry = rule.metadata.entry
        let resolvedSerial = try rule.resolvedSerialRequirement(in: session)
        let usesStationExchange = entry.exchange.sentDefault == .stationSnapshot ||
            entry.exchange.sentDefault == .stationFields
        var clearedSentFields = entry.exchange.sentDefault == .stationFields
            ? session.station.sentExchangeFields : [:]
        if let allocatedSerialFieldID = resolvedSerial.allocatedFieldID {
            clearedSentFields.removeValue(forKey: allocatedSerialFieldID)
        }
        let stationAggregate = usesStationExchange ? session.station.sentExchange : ""
        let clearedSentExchange: String
        let clearedNormalizedSentExchange: String
        switch rule.draftResetSentProjection {
        case .stationAggregate:
            clearedSentExchange = stationAggregate
            clearedNormalizedSentExchange = stationAggregate
        case .soleStationField:
            let soleStationField = entry.exchange.sentDefault == .stationFields && clearedSentFields.count == 1
                ? clearedSentFields.values.first : nil
            clearedSentExchange = soleStationField?.raw ?? stationAggregate
            clearedNormalizedSentExchange = soleStationField?.normalized ?? stationAggregate
        }
        let defaultReport = entry.modeProfile(for: old.mode)?.report ?? entry.report
        let updated = ContestDraftSnapshot(
            id: old.id, sessionID: old.sessionID, revision: revision, updatedAt: updatedAt,
            callsign: clearContact ? "" : old.callsign, band: old.band, mode: old.mode,
            frequencyHz: old.frequencyHz, rstSent: clearContact ? defaultReport.defaultSent : old.rstSent,
            rstReceived: clearContact ? defaultReport.defaultReceived : old.rstReceived,
            exchange: clearContact ? ContestExchangeSnapshot(rawSent: clearedSentExchange,
                                                              normalizedSent: clearedNormalizedSentExchange,
                                                               rawReceived: "", normalizedReceived: "",
                                                               sentFields: clearedSentFields) : old.exchange,
            entity: clearContact ? nil : old.entity, operatorCallsign: old.operatorCallsign,
            stationLocation: old.stationLocation
        )
        try database.execute("UPDATE drafts SET revision = ?, snapshot = ?, updated_at = ? WHERE session_id = ? AND id = ?",
                             [.uint(revision), .blob(try encode(updated)), .double(updatedAt.timeIntervalSince1970),
                              .text(sessionID.uuidString), .text(draftID.uuidString)])
    }

    private func bindSerialToDraft(sessionID: UUID, draftID: UUID,
                                   reservation: ContestSerialReservation,
                                   allocatedFieldID: String?,
                                   revision: UInt64, updatedAt: Date) throws {
        let old = try draft(sessionID: sessionID, id: draftID)
        let session = try openSession(id: sessionID).session
        guard rules.rule(for: session.rule) != nil else {
            throw ContestStoreError.unknownRule(session.rule)
        }
        var sentFields = old.exchange.sentFields
        if let allocatedFieldID {
            sentFields[allocatedFieldID] = .init(raw: reservation.transmittedText,
                                                 normalized: reservation.transmittedText)
        }
        let exchange = ContestExchangeSnapshot(rawSent: reservation.transmittedText,
                                               normalizedSent: reservation.transmittedText,
                                               rawReceived: old.exchange.rawReceived,
                                               normalizedReceived: old.exchange.normalizedReceived,
                                               sentFields: sentFields,
                                               receivedFields: old.exchange.receivedFields)
        let updated = ContestDraftSnapshot(id: old.id, sessionID: old.sessionID, revision: revision,
                                           updatedAt: updatedAt, callsign: old.callsign, band: old.band,
                                           mode: old.mode, frequencyHz: old.frequencyHz,
                                           rstSent: old.rstSent, rstReceived: old.rstReceived,
                                           exchange: exchange, entity: old.entity,
                                           operatorCallsign: old.operatorCallsign,
                                           stationLocation: old.stationLocation)
        try database.execute("UPDATE drafts SET revision = ?, snapshot = ?, updated_at = ? WHERE session_id = ? AND id = ?",
                             [.uint(revision), .blob(try encode(updated)), .double(updatedAt.timeIntervalSince1970),
                              .text(sessionID.uuidString), .text(draftID.uuidString)])
    }

    private func validateReservationPreservingEdit(from old: ContestDraftSnapshot,
                                                   to updated: ContestDraftSnapshot,
                                                    reservations: [ContestSerialReservation],
                                                    resolvedSerial: ContestResolvedSerialRequirement) throws {
        for reservation in reservations {
            guard resolvedSerial.requirement == .requiredForCommit,
                  resolvedSerial.allowedScopes.contains(reservation.scope) else {
                throw ContestRepositoryError.invalidSerialTransition
            }
            if let allocatedFieldID = resolvedSerial.allocatedFieldID {
                guard let oldValue = old.exchange.sentFields[allocatedFieldID],
                      let updatedValue = updated.exchange.sentFields[allocatedFieldID],
                      oldValue.raw == reservation.transmittedText,
                      oldValue.normalized == reservation.transmittedText,
                      updatedValue.raw == reservation.transmittedText,
                      updatedValue.normalized == reservation.transmittedText else {
                    throw ContestRepositoryError.invalidSerialTransition
                }
            }
            guard updated.exchange.rawSent == reservation.transmittedText,
                  updated.exchange.normalizedSent == reservation.transmittedText,
                  updated.exchange.sentFields == old.exchange.sentFields else {
                throw ContestRepositoryError.invalidSerialTransition
            }
            switch reservation.scope {
            case .session:
                guard reservation.scopeValue.isEmpty else { throw ContestRepositoryError.invalidSerialTransition }
            case .band:
                guard updated.band == old.band,
                      reservation.scopeValue == updated.band.lowercased() else {
                    throw ContestRepositoryError.invalidSerialTransition
                }
            case .transmitter:
                guard reservation.scopeValue == updated.operatorCallsign.lowercased(),
                      updated.operatorCallsign == old.operatorCallsign else {
                    throw ContestRepositoryError.invalidSerialTransition
                }
            }
        }
    }

    private func validateSession(_ session: ContestSessionSnapshot, metadata: ContestSessionMetadata) throws {
        guard let rule = rules.rule(for: session.rule),
              rule.metadata.entry.isCoherent(supportedModes: rule.metadata.supportedModes) else {
            throw ContestStoreError.unknownRule(session.rule)
        }
        let station = session.station
        let stationDescriptorIssues = rule.metadata.entry.stationExchangeIssues(station.sentExchangeFields)
        let stationRuleIssues = rule.validateSession(session)
        let missingStationEntityIsAllowed = station.entity == nil &&
            (rule as? any ContestRuleStationEntityPolicy)?.allowsMissingStationEntity(in: session) == true
        let resolvedSerialIsValid = (try? rule.resolvedSerialRequirement(in: session)) != nil
        let stationExchangeMaximum = rule.metadata.entry.version == .v2
            ? rule.metadata.entry.exchange.sentFields.reduce(0) { $0 + $1.maximumUTF8Bytes } +
                max(0, rule.metadata.entry.exchange.sentFields.count - 1)
            : 32
        let identityParts = [session.rule.id, session.rule.version, session.rule.edition,
                             session.rule.sourceRevision, session.referenceDataVersion]
        guard identityParts.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf8.count <= 128 }),
              validCallsign(station.callsign), station.sentExchange.utf8.count <= stationExchangeMaximum,
              station.location.utf8.count <= 128, !station.operatorCallsigns.isEmpty,
              station.operatorCallsigns.count <= 16,
              Set(station.operatorCallsigns).count == station.operatorCallsigns.count,
              station.operatorCallsigns.allSatisfy(validCallsign),
              metadata.name.utf8.count <= 128, !metadata.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              validCallsign(metadata.operatorCallsign), station.operatorCallsigns.contains(metadata.operatorCallsign),
              (1...64).contains(metadata.operatorCategory.utf8.count),
              session.startedAt.timeIntervalSinceReferenceDate.isFinite,
              session.endedAt?.timeIntervalSinceReferenceDate.isFinite != false,
              station.entity.map(validEntity) ?? missingStationEntityIsAllowed,
              stationDescriptorIssues.isEmpty, resolvedSerialIsValid,
              !stationRuleIssues.contains(where: { $0.severity == .error }) else {
            throw ContestStoreError.invalidSession
        }
    }

    private func validateDraft(_ draft: ContestDraftSnapshot, for session: ContestSessionSnapshot,
                               allowsAllocatedSerial: Bool = false) throws {
        guard let rule = rules.rule(for: session.rule) else { throw ContestStoreError.unknownRule(session.rule) }
        let entry = rule.metadata.entry
        let resolvedSerial = try rule.resolvedSerialRequirement(in: session)
        let descriptorIssues = entry.structuralIssues(mode: draft.mode, rstSent: draft.rstSent,
                                                      rstReceived: draft.rstReceived,
                                                      exchange: draft.exchange, allowIncomplete: true)
        let ruleDraftIssues = rule.validateDraft(draft, in: session)
        let reportBound = entry.modeProfile(for: draft.mode)?.report.maximumUTF8Bytes
        let exchangeValues = [draft.exchange.rawSent, draft.exchange.normalizedSent,
                              draft.exchange.rawReceived, draft.exchange.normalizedReceived]
        guard draft.callsign.utf8.count <= 32,
              draft.callsign.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "/" }),
              rule.metadata.supportedBands.contains(draft.band), draft.band == draft.band.lowercased(),
              entry.isCoherent(supportedModes: rule.metadata.supportedModes), reportBound != nil,
              draft.rstSent.utf8.count <= (reportBound ?? 0),
              draft.rstReceived.utf8.count <= (reportBound ?? 0), descriptorIssues.isEmpty,
              !ruleDraftIssues.contains(where: { $0.severity == .error }),
              exchangeValues.allSatisfy({ $0.utf8.count <= 64 }),
              validCallsign(draft.operatorCallsign), session.station.operatorCallsigns.contains(draft.operatorCallsign),
              draft.stationLocation.utf8.count <= 128,
              draft.updatedAt.timeIntervalSinceReferenceDate.isFinite,
              draft.entity.map(validEntity) != false else { throw ContestRepositoryError.invalidDraft }
        if entry.stationResolvedSerial != nil && !allowsAllocatedSerial {
            guard resolvedSerial.requirement == .none || resolvedSerial.requirement == .requiredForCommit,
                  draft.exchange.rawSent == session.station.sentExchange,
                  draft.exchange.normalizedSent == session.station.sentExchange,
                  draft.exchange.sentFields == session.station.sentExchangeFields else {
                throw ContestRepositoryError.invalidDraft
            }
        }
        if let frequency = draft.frequencyHz {
            guard frequency > 0, frequency <= 100_000_000_000 else {
                throw ContestRepositoryError.invalidDraft
            }
        }
    }

    private func validCallsign(_ value: String) -> Bool {
        value.utf8.count <= 32 &&
            value.range(of: #"^[A-Z0-9]+(?:/[A-Z0-9]+)*$"#, options: .regularExpression) != nil &&
            value.contains(where: \.isLetter) && value.contains(where: \.isNumber)
    }

    private func validEntity(_ entity: ContestEntitySnapshot) -> Bool {
        let continents = Set(["AF", "AN", "AS", "EU", "NA", "OC", "SA"])
        return entity.adif > 0 && entity.name.utf8.count <= 128 && !entity.name.isEmpty &&
            (1...16).contains(entity.countryPrefix.utf8.count) && continents.contains(entity.continent) &&
            (1...40).contains(entity.cqZone)
    }

    private func semanticFrequencyIssues(band: String, frequencyHz: Int64) -> [ContestValidationIssue] {
        guard frequencyHz > 0, ContestBandPlan.band(for: frequencyHz) != band else { return [] }
        return [ContestValidationIssue(code: "frequency_band_mismatch", field: "frequencyHz",
                                       message: "Frequency does not match the selected contest band")]
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data { try encoder.encode(value) }
    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do { return try decoder.decode(type, from: data) } catch { throw ContestStoreError.corruptRecord }
    }
    private func canonicalPayload<T: Encodable>(scope: ContestMutationScope, payload: T) throws -> Data {
        try encode(CanonicalMutation(sessionID: scope.sessionID, workspaceGeneration: scope.workspaceGeneration,
                                     expectedRevision: scope.expectedRevision, draftID: scope.draftID, payload: payload))
    }

    private static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return encoder
    }
    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }
}

private struct CreatePayload: Encodable { let operation = "createSession"; let session: ContestSessionSnapshot; let metadata: ContestSessionMetadata; let draft: ContestDraftSnapshot }
private struct UpdateDraftPayload: Encodable { let operation = "updateDraft"; let draft: ContestDraftSnapshot }
private struct ReservePayload: Encodable { let operation = "reserveSerial"; let reservationID: UUID; let serialScope: ContestSerialScope; let scopeValue: String }
private struct TransitionPayload: Encodable { let operation = "transitionSerial"; let reservationID: UUID; let state: ContestSerialState }
private struct CommitPayload: Encodable { let operation = "commitQSO"; let qso: ContestQSO; let reservationID: UUID? }
private struct CorrectQSOPayload: Encodable { let operation = "correctQSO"; let qso: ContestQSO; let reason: String; let operationTimestamp: Date }
private struct DeleteQSOPayload: Encodable { let operation = "deleteQSO"; let qsoID: UUID; let reason: String; let operationTimestamp: Date }
private struct CanonicalMutation<Payload: Encodable>: Encodable {
    let sessionID: UUID
    let workspaceGeneration: UUID
    let expectedRevision: UInt64
    let draftID: UUID?
    let payload: Payload
}

private enum SQLiteValue {
    case text(String), blob(Data), int64(Int64), uint(UInt64), double(Double)
}

private final class SQLiteDatabase: @unchecked Sendable {
    private var handle: OpaquePointer?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL, busyTimeoutMilliseconds: Int32) throws {
        let parent = url.deletingLastPathComponent()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: parent.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw ContestStoreError.invalidDatabaseURL
        }
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            sqlite3_close(handle); handle = nil
            throw ContestStoreError.database(message)
        }
        sqlite3_busy_timeout(handle, max(0, busyTimeoutMilliseconds))
        do {
            try execute("PRAGMA foreign_keys = ON")
            guard try scalarInt("PRAGMA foreign_keys") == 1 else { throw ContestStoreError.database("foreign keys unavailable") }
            try migrate()
        } catch {
            sqlite3_close(handle); handle = nil
            throw error
        }
    }

    deinit { sqlite3_close_v2(handle) }

    func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let value = try body()
            try execute("COMMIT")
            return value
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    func readTransaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN")
        do {
            let value = try body()
            try execute("COMMIT")
            return value
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    func execute(_ sql: String, _ values: [SQLiteValue] = []) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw error() }
        defer { sqlite3_finalize(statement) }
        try bind(values, to: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw error() }
    }

    func query(_ sql: String, _ values: [SQLiteValue] = [], row: (SQLiteRow) throws -> Void) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw error() }
        defer { sqlite3_finalize(statement) }
        try bind(values, to: statement)
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW: try row(SQLiteRow(statement: statement))
            case SQLITE_DONE: return
            default: throw error()
            }
        }
    }

    func scalarInt(_ sql: String, _ values: [SQLiteValue] = []) throws -> Int {
        var result: Int?
        try query(sql, values) { result = Int(sqlite3_column_int64($0.statement, 0)) }
        guard let result else { throw ContestStoreError.corruptRecord }
        return result
    }

    func scalarUInt(_ sql: String, _ values: [SQLiteValue] = []) throws -> UInt64? {
        var result: UInt64?
        try query(sql, values) { result = try $0.uint(0) }
        return result
    }

    private func bind(_ values: [SQLiteValue], to statement: OpaquePointer) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let result: Int32
            switch value {
            case .text(let value): result = sqlite3_bind_text(statement, index, value, -1, Self.transient)
            case .blob(let data):
                result = data.withUnsafeBytes { bytes in
                    sqlite3_bind_blob(statement, index, bytes.baseAddress, Int32(bytes.count), Self.transient)
                }
            case .int64(let value): result = sqlite3_bind_int64(statement, index, value)
            case .uint(let value):
                guard value <= UInt64(Int64.max) else { throw ContestStoreError.database("integer overflow") }
                result = sqlite3_bind_int64(statement, index, Int64(value))
            case .double(let value): result = sqlite3_bind_double(statement, index, value)
            }
            guard result == SQLITE_OK else { throw error() }
        }
    }

    private func migrate() throws {
        try transaction {
            let version = try scalarInt("PRAGMA user_version")
            guard version <= 2 else { throw ContestStoreError.unsupportedSchema(version) }
            if version == 0 {
                try execute("""
                CREATE TABLE sessions(
                    id TEXT PRIMARY KEY, generation TEXT NOT NULL, revision INTEGER NOT NULL,
                    snapshot BLOB NOT NULL, metadata BLOB NOT NULL, created_at REAL NOT NULL
                )
                """)
                try execute("""
                CREATE TABLE drafts(
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    revision INTEGER NOT NULL, snapshot BLOB NOT NULL, updated_at REAL NOT NULL,
                    UNIQUE(session_id, id)
                )
                """)
                try execute("""
                CREATE TABLE operations(
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    request_id TEXT NOT NULL, payload_digest TEXT NOT NULL, canonical_payload BLOB NOT NULL,
                    receipt BLOB NOT NULL, result BLOB NOT NULL, committed_revision INTEGER NOT NULL,
                    PRIMARY KEY(session_id, request_id)
                )
                """)
                try execute("""
                CREATE TABLE serial_counters(
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    scope TEXT NOT NULL, scope_value TEXT NOT NULL, next_number INTEGER NOT NULL,
                    PRIMARY KEY(session_id, scope, scope_value)
                )
                """)
                try execute("""
                CREATE TABLE serial_reservations(
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    draft_id TEXT NOT NULL REFERENCES drafts(id), scope TEXT NOT NULL, scope_value TEXT NOT NULL,
                    number INTEGER NOT NULL, state TEXT NOT NULL, snapshot BLOB NOT NULL,
                    UNIQUE(session_id, scope, scope_value, number)
                )
                """)
                try execute("""
                CREATE TABLE qsos(
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    timestamp REAL NOT NULL, snapshot BLOB NOT NULL,
                    is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at REAL
                )
                """)
                try execute("CREATE INDEX qsos_session_order ON qsos(session_id, is_deleted, timestamp, id)")
            } else if version == 1 {
                try execute("ALTER TABLE qsos ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
                try execute("ALTER TABLE qsos ADD COLUMN deleted_at REAL")
                try execute("DROP INDEX qsos_session_order")
                try execute("CREATE INDEX qsos_session_order ON qsos(session_id, is_deleted, timestamp, id)")
            }
            if version < 2 {
                try execute("""
                    CREATE TABLE qso_audit(
                        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                        qso_id TEXT NOT NULL REFERENCES qsos(id), operation TEXT NOT NULL,
                        before_snapshot BLOB NOT NULL, after_snapshot BLOB NOT NULL,
                        reason TEXT NOT NULL, request_id TEXT NOT NULL,
                        operation_timestamp REAL NOT NULL,
                        committed_at REAL NOT NULL, committed_revision INTEGER NOT NULL,
                        record BLOB NOT NULL,
                        PRIMARY KEY(session_id, request_id)
                    )
                    """)
                try execute("CREATE INDEX qso_audit_target_order ON qso_audit(session_id, qso_id, committed_revision, request_id)")
                try execute("PRAGMA user_version = 2")
            }
        }
    }

    private func error() -> ContestStoreError {
        .database(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "database closed")
    }
}

private struct SQLiteRow {
    fileprivate let statement: OpaquePointer
    func blob(_ index: Int32) -> Data {
        let count = Int(sqlite3_column_bytes(statement, index))
        guard count > 0, let bytes = sqlite3_column_blob(statement, index) else { return Data() }
        return Data(bytes: bytes, count: count)
    }
    func double(_ index: Int32) -> Double { sqlite3_column_double(statement, index) }
    func uint(_ index: Int32) throws -> UInt64 {
        let value = sqlite3_column_int64(statement, index)
        guard value >= 0 else { throw ContestStoreError.corruptRecord }
        return UInt64(value)
    }
}
