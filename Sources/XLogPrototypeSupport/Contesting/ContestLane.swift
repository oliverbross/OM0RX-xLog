import Foundation
import XContestCore
import XContestStore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Serialized, local-only boundary for the isolated contest database.
actor ContestLane {
    typealias GenerationSource = @Sendable () async throws -> String

    private let databaseURL: URL
    private let generationSource: GenerationSource
    private let reference: ContestReferenceData
    private let rules = ContestRuleRegistry.pilots
    private var store: SQLiteContestStore?
    private var tail: Task<Void, Never>?

    init(databaseURL: URL, generationSource: @escaping GenerationSource) throws {
        self.databaseURL = databaseURL
        self.generationSource = generationSource
        self.reference = try ContestReferenceData.bundled()
        try ContestDatabaseBoundary.validate(databaseURL: databaseURL)
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        let previous = tail
        let operation = Task { [self] in
            await previous?.value
            return try await perform(method: method, params: params)
        }
        tail = Task { _ = try? await operation.value }
        return try await operation.value
    }

    private func perform(method: String, params: [String: Any]) async throws -> [String: Any] {
        let before = try Wire.generation(try await generationSource())
        let result: [String: Any]
        do {
            switch method {
            case "contest_catalog": result = try catalog(params, generation: before)
            case "contest_sessions": result = try await sessions(params, generation: before)
            case "contest_create": result = try await create(params, generation: before)
            case "contest_open": result = try await open(params, generation: before)
            case "contest_draft_get": result = try await draftGet(params, generation: before)
            case "contest_draft_apply": result = try await draftApply(params, generation: before)
            case "contest_serial_reserve": result = try await reserve(params, generation: before)
            case "contest_qso_commit": result = try await commit(params, generation: before)
            case "contest_qso_get": result = try await qsoGet(params, generation: before)
            case "contest_qso_correct": result = try await qsoCorrect(params, generation: before)
            case "contest_qso_delete": result = try await qsoDelete(params, generation: before)
            case "contest_operation_receipt": result = try await receipt(params, generation: before)
            case "contest_log_page": result = try await logPage(params, generation: before)
            case "contest_score": result = try await score(params, generation: before)
            default: throw ContestLaneError.confirmed("unknown_method", "Unknown contest method.")
            }
        } catch let error as ContestLaneError { throw error }
          catch { throw Self.map(error) }
        let after: String
        do { after = try Wire.generation(try await generationSource()) }
        catch {
            throw ContestLaneError.uncertain("workspace_fence_failed", "The workspace could not be verified after the contest request; check its receipt before retrying.")
        }
        guard before == after else {
            throw ContestLaneError.uncertain("stale_workspace", "The isolated workspace changed while the contest request was running.")
        }
        return result
    }

    private func repository() throws -> SQLiteContestStore {
        if let store { return store }
        try ContestDatabaseBoundary.validate(databaseURL: databaseURL)
        let parent = databaseURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        try ContestDatabaseBoundary.validate(databaseURL: databaseURL)
        let created = try SQLiteContestStore(databaseURL: databaseURL)
        store = created
        return created
    }

    private func catalog(_ params: [String: Any], generation: String) throws -> [String: Any] {
        try Wire.exact(params, [])
        return ["workspaceGeneration": generation, "rules": rules.metadata.map { reference.ruleWire($0) }]
    }

    private func sessions(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        try Wire.exact(params, [])
        let generationID = try Wire.generationID(generation)
        let values = try await repository().listSessionReadSnapshots().filter { $0.session.session.workspaceGeneration == generationID }
        var rows: [[String: Any]] = []
        for value in values {
            guard value.drafts.count == 1, let draft = value.drafts.first else {
                throw ContestLaneError.confirmed("invalid_session", "The session does not have exactly one active draft.")
            }
            rows.append(try await sessionWire(value.session, generation: generation, qsoCount: value.qsoCount, updatedAt: draft.updatedAt))
        }
        return ["sessions": rows]
    }

    private func create(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: ["sessionID", "name", "ruleIdentity", "referenceDataVersion", "station", "operator"], requiresDraft: false)
        guard request.sessionID == (try Wire.uuid(request.payload, "sessionID")), request.expectedRevision == 0 else {
            throw ContestLaneError.confirmed("invalid_params", "Create identity or revision is invalid.")
        }
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let identity = try Wire.ruleIdentity(Wire.object(request.payload, "ruleIdentity"))
        guard rules.rule(for: identity) != nil else { throw ContestLaneError.confirmed("unknown_rule", "The requested contest rule is unavailable.") }
        let referenceVersion = try Wire.text(request.payload, "referenceDataVersion", max: 160)
        guard referenceVersion == reference.version else { throw ContestLaneError.confirmed("reference_unavailable", "The requested offline reference data is unavailable.") }
        let stationInput = try Wire.object(request.payload, "station")
        try Wire.exact(stationInput, ["callsign", "cqZone", "dxccEntity"])
        let operatorInput = try Wire.object(request.payload, "operator")
        try Wire.exact(operatorInput, ["callsign", "category"])
        let stationCall = try Wire.callsign(stationInput, "callsign")
        let zoneText = try Wire.text(stationInput, "cqZone", max: 8)
        guard let zone = Int(zoneText), (1...40).contains(zone),
              let country = reference.resolve(stationCall, at: request.timestamp), country.cqZone == zone,
              country.name.caseInsensitiveCompare(try Wire.text(stationInput, "dxccEntity", max: 160)) == .orderedSame else {
            throw ContestLaneError.confirmed("station_mismatch", "The station snapshot does not match bundled offline CTY data.")
        }
        let operatorCall = try Wire.callsign(operatorInput, "callsign")
        let metadata = ContestSessionMetadata(name: try Wire.text(request.payload, "name", max: 128), operatorCallsign: operatorCall,
                                              operatorCategory: try Wire.text(operatorInput, "category", max: 80))
        let session = ContestSessionSnapshot(id: request.sessionID, workspaceGeneration: try Wire.generationID(generation), rule: identity,
            referenceDataVersion: referenceVersion, startedAt: request.timestamp,
            station: ContestStationSnapshot(callsign: stationCall, entity: try reference.entity(country),
                sentExchange: identity.id == CQWWCWRule.identity.id ? zoneText : "", operatorCallsigns: [operatorCall]))
        let draft = ContestDraftSnapshot(id: request.requestID, sessionID: request.sessionID, revision: 1, updatedAt: request.timestamp,
            callsign: "", band: "20m", mode: "CW", frequencyHz: nil, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: session.station.sentExchange, normalizedSent: session.station.sentExchange, rawReceived: "", normalizedReceived: ""),
            entity: nil, operatorCallsign: operatorCall, stationLocation: session.station.location)
        let scope = request.coreScope(generation: session.workspaceGeneration, draftID: draft.id)
        _ = try await preflightReplay(request)
        let result = try await repository().createSession(session, metadata: metadata, initialDraft: draft, scope: scope, committedAt: request.timestamp)
        return try await projectCommitted {
            try await mutationWire(result.session, draft: result.draft, qsoCount: result.qsoCount,
                                   generation: generation, receipt: result.receipt, projection: result.projection)
        }
    }

    private func open(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        try Wire.exact(params, ["sessionID", "workspaceGeneration"])
        try Wire.requireGeneration(try Wire.text(params, "workspaceGeneration", max: 128), generation)
        let id = try Wire.uuid(params, "sessionID")
        let snapshot = try await repository().sessionReadSnapshot(id: id)
        try checked(snapshot.session, generation: generation)
        guard snapshot.drafts.count == 1, let draft = snapshot.drafts.first,
              snapshot.activeReservations.count <= 1 else {
            throw ContestLaneError.confirmed("invalid_session", "The session draft or serial state is ambiguous.")
        }
        return ["session": try await sessionWire(snapshot.session, generation: generation,
                                                  qsoCount: snapshot.qsoCount, updatedAt: draft.updatedAt),
                "draft": try await draftWire(draft, stored: snapshot.session, generation: generation,
                    reservation: snapshot.activeReservations.first, loadCurrentReservation: false, qsos: snapshot.qsos)]
    }

    private func draftGet(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        try Wire.exact(params, ["sessionID", "workspaceGeneration"])
        try Wire.requireGeneration(try Wire.text(params, "workspaceGeneration", max: 128), generation)
        return try await open(params, generation: generation)
    }

    private func draftApply(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: ["fields"], requiresDraft: true)
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let prior = try await preflightReplay(request)
        let stored = try await checkedSession(request.sessionID, generation: generation,
                                              revision: prior == nil ? request.expectedRevision : nil)
        let current = try await repository().draft(sessionID: request.sessionID, id: request.draftID!)
        let fields = try Wire.draftFields(Wire.object(request.payload, "fields"))
        let entity = try fields.callsign.isEmpty ? nil : reference.resolve(fields.callsign, at: request.timestamp).map(reference.entity)
        let next = ContestDraftSnapshot(id: current.id, sessionID: current.sessionID,
            revision: prior?.committedRevision ?? (stored.revision + 1), updatedAt: request.timestamp,
            callsign: fields.callsign, band: fields.band, mode: fields.mode, frequencyHz: fields.frequencyHz,
            rstSent: fields.sentReport, rstReceived: fields.receivedReport,
            exchange: .init(rawSent: fields.sentExchange, normalizedSent: fields.sentExchange.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                            rawReceived: fields.receivedExchange, normalizedReceived: fields.receivedExchange.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()),
            entity: entity, operatorCallsign: current.operatorCallsign, stationLocation: current.stationLocation)
        let result = try await repository().updateDraft(next, scope: request.coreScope(generation: stored.session.workspaceGeneration), committedAt: request.timestamp)
        return try await projectCommitted {
            try await mutationWire(result.session, draft: result.draft, qsoCount: result.qsoCount,
                                   generation: generation, receipt: result.receipt, projection: result.projection)
        }
    }

    private func reserve(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: [], requiresDraft: true)
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let prior = try await preflightReplay(request)
        let session = try await checkedSession(request.sessionID, generation: generation,
                                               revision: prior == nil ? request.expectedRevision : nil)
        guard session.session.rule.id == CQWPXCWRule.identity.id else {
            throw ContestLaneError.confirmed("serial_not_supported", "This contest does not allocate serial numbers.")
        }
        _ = try await repository().draft(sessionID: request.sessionID, id: request.draftID!)
        let result = try await repository().reserveSerial(reservationID: request.requestID, serialScope: .session, scopeValue: "",
            scope: request.coreScope(generation: try Wire.generationID(generation)), committedAt: request.timestamp)
        return try await projectCommitted {
            try await mutationWire(result.session, draft: result.draft, qsoCount: result.qsoCount,
                generation: generation, receipt: result.receipt, projection: result.projection)
        }
    }

    private func commit(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: [], requiresDraft: true)
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let prior = try await preflightReplay(request)
        let stored = try await checkedSession(request.sessionID, generation: generation,
                                              revision: prior == nil ? request.expectedRevision : nil)
        let draft = try await repository().draft(sessionID: request.sessionID, id: request.draftID!)
        let reservations = prior == nil
            ? try await repository().activeReservations(sessionID: request.sessionID, draftID: draft.id)
            : try await repository().reservations(sessionID: request.sessionID, draftID: draft.id)
                .filter { $0.state == .committed && $0.revision == prior?.committedRevision }
        guard reservations.count <= 1 else { throw ContestLaneError.confirmed("ambiguous_serial", "The draft has multiple active serial reservations.") }
        let reservation = reservations.first
        let qso: ContestQSO
        if prior != nil {
            qso = try await repository().qso(sessionID: request.sessionID, id: request.requestID)
            guard qso.timestampUTC == request.timestamp else { throw ContestLaneError.confirmed("request_conflict", "This request ID was already used with another operation timestamp.") }
        } else {
            let sent = stored.session.rule.id == CQWPXCWRule.identity.id ? (reservation?.transmittedText ?? draft.exchange.normalizedSent) : draft.exchange.normalizedSent
            qso = ContestQSO(id: request.requestID, sessionID: request.sessionID, timestampUTC: request.timestamp,
                callsign: draft.callsign, band: draft.band, mode: draft.mode, frequencyHz: draft.frequencyHz ?? 0,
                rstSent: draft.rstSent, rstReceived: draft.rstReceived,
                exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: draft.exchange.rawReceived, normalizedReceived: draft.exchange.normalizedReceived),
                entity: draft.entity, operatorCallsign: draft.operatorCallsign, stationLocation: draft.stationLocation,
                provenance: .init(source: .operatorEntry, sourceIdentity: reference.version))
        }
        let result = try await repository().commitQSO(qso, reservationID: reservation?.id,
            scope: request.coreScope(generation: stored.session.workspaceGeneration), committedAt: request.timestamp)
        return try await projectCommitted {
            var wire = try await mutationWire(result.session, draft: result.draft, qsoCount: result.qsoCount,
                                              generation: generation, receipt: result.receipt, projection: result.projection)
            wire["qso"] = try qsoWire(result.qso, scored: result.committedEvaluation)
            wire["score"] = scoreWire(result.score, generation: generation)
            return wire
        }
    }

    private func qsoGet(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        try Wire.exact(params, ["sessionID", "workspaceGeneration", "expectedRevision", "qsoID"])
        try Wire.requireGeneration(try Wire.text(params, "workspaceGeneration", max: 128), generation)
        let sessionID = try Wire.uuid(params, "sessionID")
        let snapshot = try await repository().qsoReadSnapshot(
            sessionID: sessionID, id: Wire.uuid(params, "qsoID"),
            expectedWorkspaceGeneration: try Wire.generationID(generation),
            expectedRevision: try Wire.uint(params, "expectedRevision"))
        try checked(snapshot.session, generation: generation, revision: snapshot.session.revision)
        return ["sessionID": Wire.uuidString(sessionID), "workspaceGeneration": generation,
                "revision": snapshot.session.revision,
                "qso": fullQSOWire(snapshot.qso, stored: snapshot.session)]
    }

    private func qsoCorrect(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: ["qso", "reason"], requiresDraft: false)
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let prior = try await preflightReplay(request, compareCommittedTimestamp: false)
        let stored = try await checkedSession(request.sessionID, generation: generation,
                                              revision: prior == nil ? request.expectedRevision : nil)
        let qso = try correctedQSO(Wire.object(request.payload, "qso"), stored: stored)
        let reason = try Wire.text(request.payload, "reason", max: 1_024)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else { throw ContestLaneError.confirmed("invalid_params", "A correction reason is required.") }
        let result = try await repository().correctQSO(qso, reason: reason,
            operationTimestamp: request.timestamp,
            scope: request.coreScope(generation: stored.session.workspaceGeneration, draftID: nil),
            committedAt: prior?.committedAt ?? request.timestamp)
        return try await projectCommitted { try changeWire(result, generation: generation) }
    }

    private func qsoDelete(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: ["qsoID", "reason"], requiresDraft: false)
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let prior = try await preflightReplay(request, compareCommittedTimestamp: false)
        let stored = try await checkedSession(request.sessionID, generation: generation,
                                              revision: prior == nil ? request.expectedRevision : nil)
        let reason = try Wire.text(request.payload, "reason", max: 1_024)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else { throw ContestLaneError.confirmed("invalid_params", "A deletion reason is required.") }
        let result = try await repository().deleteQSO(id: Wire.uuid(request.payload, "qsoID"), reason: reason,
            operationTimestamp: request.timestamp,
            scope: request.coreScope(generation: stored.session.workspaceGeneration, draftID: nil),
            committedAt: prior?.committedAt ?? request.timestamp)
        return try await projectCommitted { try changeWire(result, generation: generation) }
    }

    private func receipt(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        try Wire.exact(params, ["sessionID", "workspaceGeneration", "requestID", "payloadDigest"])
        try Wire.requireGeneration(try Wire.text(params, "workspaceGeneration", max: 128), generation)
        let value = try await repository().operationReceipt(sessionID: Wire.uuid(params, "sessionID"),
            workspaceGeneration: try Wire.generationID(generation), requestID: Wire.uuid(params, "requestID"),
            payloadDigest: try Wire.text(params, "payloadDigest", max: 512))
        guard let value else { return ["status": "not_found"] }
        return ["status": "committed", "receipt": receiptWire(value)]
    }

    private func logPage(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        try Wire.exact(params, ["sessionID", "workspaceGeneration", "expectedRevision", "offset", "limit"])
        try Wire.requireGeneration(try Wire.text(params, "workspaceGeneration", max: 128), generation)
        let id = try Wire.uuid(params, "sessionID"), revision = try Wire.uint(params, "expectedRevision")
        let offset = try Wire.int(params, "offset", range: 0...Int.max), limit = try Wire.int(params, "limit", range: 1...200)
        let snapshot = try await repository().sessionPageSnapshot(id: id, offset: offset, limit: limit)
        try checked(snapshot.session, generation: generation, revision: revision)
        let page = snapshot.log
        let scored = Dictionary(uniqueKeysWithValues: snapshot.score.score.qsos.map { ($0.qsoID, $0) })
        return ["sessionID": Wire.uuidString(id), "workspaceGeneration": generation, "revision": page.revision,
                "qsos": try page.qsos.map { try qsoWire($0, scored: scored[$0.id]) }, "total": page.total, "offset": page.offset, "limit": page.limit]
    }

    private func score(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        try Wire.exact(params, ["sessionID", "workspaceGeneration", "expectedRevision"])
        try Wire.requireGeneration(try Wire.text(params, "workspaceGeneration", max: 128), generation)
        let id = try Wire.uuid(params, "sessionID"), revision = try Wire.uint(params, "expectedRevision")
        let snapshot = try await repository().sessionPageSnapshot(id: id, offset: 0, limit: 1)
        try checked(snapshot.session, generation: generation, revision: revision)
        return scoreWire(snapshot.score, generation: generation)
    }

    private func checkedSession(_ id: UUID, generation: String, revision: UInt64? = nil) async throws -> StoredContestSession {
        let stored = try await repository().openSession(id: id)
        try checked(stored, generation: generation, revision: revision)
        return stored
    }

    private func checked(_ stored: StoredContestSession, generation: String, revision: UInt64? = nil) throws {
        guard stored.session.workspaceGeneration == (try Wire.generationID(generation)) else { throw ContestLaneError.confirmed("stale_workspace", "The contest belongs to another workspace generation.") }
        if let revision, stored.revision != revision { throw ContestLaneError.confirmed("stale_revision", "The contest session changed; reload it before retrying.") }
        guard stored.session.referenceDataVersion == reference.version, rules.rule(for: stored.session.rule) != nil else {
            throw ContestLaneError.confirmed("reference_unavailable", "The session's pinned rule or reference data is unavailable.")
        }
    }

    private func preflightReplay(_ request: ContestMutationRequest,
                                 compareCommittedTimestamp: Bool = true) async throws -> ContestMutationReceipt? {
        do {
            let receipt = try await repository().operationReceipt(sessionID: request.sessionID,
                workspaceGeneration: try Wire.generationID(request.workspaceGeneration), requestID: request.requestID,
                payloadDigest: request.payloadDigest)
            if compareCommittedTimestamp, let receipt, receipt.committedAt != request.timestamp {
                throw ContestLaneError.confirmed("request_conflict", "This request ID was already used with another operation timestamp.")
            }
            return receipt
        } catch ContestRepositoryError.notFound {
            // A create has no session row until its first transaction commits.
            return nil
        }
    }

    private func projectCommitted(_ body: () async throws -> [String: Any]) async throws -> [String: Any] {
        do { return try await body() }
        catch let error as ContestLaneError where error.outcome == "uncertain" { throw error }
        catch {
            throw ContestLaneError.uncertain("invalid_result", "The contest mutation committed, but its response could not be verified; recover it from the receipt.")
        }
    }

    private func mutationWire(_ stored: StoredContestSession, draft: ContestDraftSnapshot, qsoCount: Int,
                              generation: String, receipt: ContestMutationReceipt,
                              projection: ContestMutationProjection) async throws -> [String: Any] {
        guard stored.revision == draft.revision, stored.revision == receipt.committedRevision else {
            throw ContestLaneError.uncertain("invalid_result", "The durable contest mutation result is incoherent.")
        }
        guard projection.session == stored, projection.score.qsoCount == qsoCount,
              projection.draft == draft else {
            throw ContestLaneError.uncertain("invalid_result", "The durable contest mutation projection is incoherent.")
        }
        let reservations = projection.activeReservations.filter { $0.draftID == draft.id }
        guard reservations.count <= 1 else {
            throw ContestLaneError.uncertain("invalid_result", "The durable contest mutation has ambiguous serial state.")
        }
        return ["session": try await sessionWire(stored, generation: generation, qsoCount: qsoCount, updatedAt: draft.updatedAt),
                "draft": try await draftWire(draft, stored: stored, generation: generation,
                                              reservation: reservations.first, loadCurrentReservation: false,
                                              evaluation: projection.draftEvaluation),
                "receipt": receiptWire(receipt)]
    }

    private func sessionWire(_ stored: StoredContestSession, generation: String, qsoCount suppliedCount: Int? = nil,
                             updatedAt suppliedDate: Date? = nil) async throws -> [String: Any] {
        guard let suppliedCount, let suppliedDate else {
            throw ContestLaneError.uncertain("invalid_result", "Contest session projection requires one coherent read snapshot.")
        }
        guard let metadata = rules.rule(for: stored.session.rule)?.metadata, let entity = stored.session.station.entity else { throw ContestLaneError.confirmed("invalid_session", "Contest session metadata is incomplete.") }
        return ["sessionID": Wire.uuidString(stored.session.id), "workspaceGeneration": generation, "revision": stored.revision,
            "name": stored.metadata.name, "rule": reference.ruleWire(metadata), "referenceDataVersion": stored.session.referenceDataVersion,
            "station": ["callsign": stored.session.station.callsign, "cqZone": String(entity.cqZone), "dxccEntity": entity.name],
            "operator": ["callsign": stored.metadata.operatorCallsign, "category": stored.metadata.operatorCategory],
            "qsoCount": suppliedCount,
            "updatedAt": Wire.iso(max(stored.createdAt, suppliedDate))]
    }

    private func draftWire(_ draft: ContestDraftSnapshot, stored: StoredContestSession, generation: String,
                           reservation suppliedReservation: ContestSerialReservation? = nil,
                           loadCurrentReservation: Bool = true, qsos suppliedQSOs: [ContestQSO]? = nil,
                           evaluation suppliedEvaluation: ContestDraftEvaluationSnapshot? = nil) async throws -> [String: Any] {
        let reservations: [ContestSerialReservation]
        if loadCurrentReservation {
            reservations = try await repository().activeReservations(sessionID: draft.sessionID, draftID: draft.id)
        } else {
            reservations = suppliedReservation.map { [$0] } ?? []
        }
        guard reservations.count <= 1 else { throw ContestLaneError.confirmed("ambiguous_serial", "The draft has multiple active serial reservations.") }
        let serial = reservations.first
        let sent = stored.session.rule.id == CQWPXCWRule.identity.id ? (serial?.transmittedText ?? draft.exchange.rawSent) : draft.exchange.rawSent
        let candidate = ContestQSO(id: UUID(), sessionID: draft.sessionID, timestampUTC: draft.updatedAt, callsign: draft.callsign,
            band: draft.band, mode: draft.mode, frequencyHz: draft.frequencyHz ?? 0, rstSent: draft.rstSent, rstReceived: draft.rstReceived,
            exchange: .init(rawSent: sent, normalizedSent: sent.uppercased(), rawReceived: draft.exchange.rawReceived, normalizedReceived: draft.exchange.normalizedReceived),
            entity: draft.entity, operatorCallsign: draft.operatorCallsign, stationLocation: draft.stationLocation,
            provenance: .init(source: .operatorEntry, sourceIdentity: reference.version))
        guard let rule = rules.rule(for: stored.session.rule) else { throw ContestLaneError.confirmed("unknown_rule", "The contest rule is unavailable.") }
        let evaluated = rule.evaluate(candidate, in: stored.session)
        let validation = suppliedEvaluation?.validation ?? evaluated.validation
        let dupeKey = suppliedEvaluation?.dupeKey ?? evaluated.dupeKey
        let duplicate: Bool?
        if let suppliedEvaluation {
            duplicate = suppliedEvaluation.dupeKey == nil ? nil : suppliedEvaluation.isDuplicate
        } else {
            duplicate = suppliedQSOs.flatMap { qsos in
                dupeKey.map { key in qsos.contains { rule.evaluate($0, in: stored.session).dupeKey == key } }
            }
        }
        return ["draftID": Wire.uuidString(draft.id), "sessionID": Wire.uuidString(draft.sessionID), "workspaceGeneration": generation, "revision": stored.revision,
            "fields": ["callsign": draft.callsign, "sentReport": draft.rstSent, "sentExchange": sent,
                       "receivedReport": draft.rstReceived, "receivedExchange": draft.exchange.rawReceived,
                       "frequencyHz": draft.frequencyHz as Any? ?? NSNull(), "band": draft.band, "mode": draft.mode],
            "reservedSerial": serial?.number as Any? ?? NSNull(),
            "validation": ["errors": validation.filter { $0.severity == .error }.map(\.message),
                           "warnings": validation.filter { $0.severity == .warning }.map(\.message)],
            "dupe": ["state": duplicate == true ? "duplicate" : (duplicate == false ? "clear" : "unchecked"),
                     "reason": duplicate == true ? "This callsign and band are already logged in this contest."
                        : (duplicate == nil ? "Reload the contest session to check duplicate state." : "")],
            "updatedAt": Wire.iso(draft.updatedAt)]
    }

    private func qsoWire(_ qso: ContestQSO, scored: ContestScoredQSO?) throws -> [String: Any] {
        guard let scored else { throw ContestLaneError.confirmed("invalid_score", "The committed QSO is missing from the score projection.") }
        let multiplier = scored.newMultipliers.first.map { "\($0.kind):\($0.value):\($0.scope)" }
        return ["qsoID": Wire.uuidString(qso.id), "sessionID": Wire.uuidString(qso.sessionID), "workedAt": Wire.iso(qso.timestampUTC),
            "callsign": qso.callsign, "band": qso.band, "mode": qso.mode, "sentExchange": qso.exchange.rawSent,
            "receivedExchange": qso.exchange.rawReceived, "points": scored.points, "multiplier": multiplier as Any? ?? NSNull(),
            "isDupe": scored.disposition == .duplicate]
    }

    private func correctedQSO(_ value: [String: Any], stored: StoredContestSession) throws -> ContestQSO {
        try Wire.exact(value, ["qsoID", "sessionID", "originalUTC", "callsign", "band", "mode",
                               "frequencyHz", "sentReport", "receivedReport", "sentExchange",
                               "normalizedSentExchange", "allocatedSerial", "receivedExchange",
                               "normalizedReceivedExchange", "entity", "operatorCallsign", "stationLocation",
                               "provenance", "ruleIdentity", "referenceDataVersion"])
        let qsoID = try Wire.uuid(value, "qsoID")
        let sessionID = try Wire.uuid(value, "sessionID")
        guard sessionID == stored.session.id else {
            throw ContestLaneError.confirmed("wrong_session", "The contact belongs to another contest session.")
        }
        let originalUTC = try Wire.date(value, "originalUTC")
        let callsign = try Wire.callsign(value, "callsign")
        let band = try Wire.text(value, "band", max: 8)
        let mode = try Wire.text(value, "mode", max: 8)
        guard let rule = rules.rule(for: stored.session.rule),
              rule.metadata.supportedBands.contains(band), rule.metadata.supportedModes.contains(mode) else {
            throw ContestLaneError.confirmed("invalid_params", "The corrected band or mode is unsupported.")
        }
        let frequency = try Wire.uint(value, "frequencyHz")
        guard frequency > 0, frequency <= 100_000_000_000 else {
            throw ContestLaneError.confirmed("invalid_params", "The corrected frequency is invalid.")
        }
        let rawSent = try Wire.text(value, "sentExchange", max: 64, empty: true)
        let normalizedSent = try Wire.text(value, "normalizedSentExchange", max: 64, empty: true)
        guard try Wire.text(value, "allocatedSerial", max: 64, empty: true) == normalizedSent else {
            throw ContestLaneError.confirmed("invalid_params", "The allocated sent value is inconsistent.")
        }
        let suppliedEntity = try Wire.entity(Wire.object(value, "entity"))
        guard let country = reference.resolve(callsign, at: originalUTC),
              let resolvedEntity = try? reference.entity(country), suppliedEntity == resolvedEntity else {
            throw ContestLaneError.confirmed("reference_mismatch", "The corrected callsign entity does not match pinned CTY data.")
        }
        guard try Wire.ruleIdentity(Wire.object(value, "ruleIdentity")) == stored.session.rule,
              try Wire.text(value, "referenceDataVersion", max: 160) == stored.session.referenceDataVersion else {
            throw ContestLaneError.confirmed("reference_mismatch", "The correction does not match the session's pinned rule and reference data.")
        }
        let provenance = try Wire.provenance(Wire.object(value, "provenance"))
        return ContestQSO(id: qsoID, sessionID: sessionID, timestampUTC: originalUTC,
            callsign: callsign, band: band, mode: mode, frequencyHz: Int64(frequency),
            rstSent: try Wire.text(value, "sentReport", max: 3, empty: true),
            rstReceived: try Wire.text(value, "receivedReport", max: 3, empty: true),
            exchange: .init(rawSent: rawSent, normalizedSent: normalizedSent,
                            rawReceived: try Wire.text(value, "receivedExchange", max: 64, empty: true),
                            normalizedReceived: try Wire.text(value, "normalizedReceivedExchange", max: 64, empty: true)),
            entity: resolvedEntity, operatorCallsign: try Wire.callsign(value, "operatorCallsign"),
            stationLocation: try Wire.text(value, "stationLocation", max: 128, empty: true),
            provenance: provenance)
    }

    private func fullQSOWire(_ qso: ContestQSO, stored: StoredContestSession) -> [String: Any] {
        let entity: Any = qso.entity.map(Wire.entityWire) ?? NSNull()
        return ["qsoID": Wire.uuidString(qso.id), "sessionID": Wire.uuidString(qso.sessionID),
            "originalUTC": Wire.iso(qso.timestampUTC), "callsign": qso.callsign,
            "band": qso.band, "mode": qso.mode, "frequencyHz": qso.frequencyHz,
            "sentReport": qso.rstSent, "receivedReport": qso.rstReceived,
            "sentExchange": qso.exchange.rawSent, "normalizedSentExchange": qso.exchange.normalizedSent,
            "allocatedSerial": qso.exchange.normalizedSent,
            "receivedExchange": qso.exchange.rawReceived,
            "normalizedReceivedExchange": qso.exchange.normalizedReceived,
            "entity": entity, "operatorCallsign": qso.operatorCallsign,
            "stationLocation": qso.stationLocation, "provenance": Wire.provenanceWire(qso.provenance),
            "ruleIdentity": Wire.ruleIdentityWire(stored.session.rule),
            "referenceDataVersion": stored.session.referenceDataVersion]
    }

    private func changeWire(_ result: ContestQSOChangeResult, generation: String) throws -> [String: Any] {
        guard result.session.revision == result.receipt.committedRevision,
              result.score.revision == result.session.revision,
              result.score.qsoCount == result.qsoCount,
              result.session.session.id == result.before.sessionID,
              result.before.id == result.qsoID,
              result.after?.id == result.qsoID || result.after == nil,
              (result.operation == .correction && result.after != nil) ||
                (result.operation == .deletion && result.after == nil) else {
            throw ContestLaneError.uncertain("invalid_result", "The durable QSO mutation result is incoherent.")
        }
        let stored = result.session
        guard stored.session.workspaceGeneration == (try Wire.generationID(generation)) else {
            throw ContestLaneError.uncertain("invalid_result", "The durable QSO mutation result has another workspace generation.")
        }
        let session: [String: Any] = ["sessionID": Wire.uuidString(stored.session.id),
            "workspaceGeneration": generation, "revision": stored.revision,
            "name": stored.metadata.name, "ruleIdentity": Wire.ruleIdentityWire(stored.session.rule),
            "referenceDataVersion": stored.session.referenceDataVersion,
            "qsoCount": result.qsoCount, "updatedAt": Wire.iso(result.receipt.committedAt)]
        return ["session": session, "operation": result.operation.rawValue,
            "qsoID": Wire.uuidString(result.qsoID), "qsoCount": result.qsoCount,
            "score": scoreWire(result.score, generation: generation),
            "currentTarget": result.after.map { fullQSOWire($0, stored: stored) } as Any? ?? NSNull(),
            "auditReference": ["sessionID": Wire.uuidString(stored.session.id),
                               "qsoID": Wire.uuidString(result.qsoID),
                               "requestID": Wire.uuidString(result.receipt.requestID),
                               "revision": result.receipt.committedRevision],
            "receipt": receiptWire(result.receipt)]
    }

    private func scoreWire(_ value: ContestScoreSnapshot, generation: String) -> [String: Any] {
        let labels = Set(value.score.qsos.flatMap(\.newMultipliers).map { "\($0.kind):\($0.value):\($0.scope)" }).sorted()
        return ["sessionID": Wire.uuidString(value.sessionID), "workspaceGeneration": generation, "revision": value.revision,
            "qsos": value.score.qsos.count, "points": value.score.totalPoints, "multipliers": value.score.multiplierCount,
            "claimedScore": value.score.claimedScore, "multiplierLabels": labels, "sourceVerification": "provisional"]
    }

    private func scoreWire(_ value: ContestScoreSummarySnapshot, generation: String) -> [String: Any] {
        ["sessionID": Wire.uuidString(value.sessionID), "workspaceGeneration": generation, "revision": value.revision,
         "qsos": value.qsoCount, "points": value.totalPoints, "multipliers": value.multiplierCount,
         "claimedScore": value.claimedScore, "sourceVerification": "provisional"]
    }

    private func receiptWire(_ value: ContestMutationReceipt) -> [String: Any] {
        ["requestID": Wire.uuidString(value.requestID), "payloadDigest": value.payloadDigest,
         "committedRevision": value.committedRevision, "committedAt": Wire.iso(value.committedAt)]
    }

    private static func map(_ error: Error) -> ContestLaneError {
        switch error {
        case ContestRepositoryError.notFound: return .confirmed("not_found", "The contest record was not found.")
        case ContestRepositoryError.staleWorkspaceGeneration: return .confirmed("stale_workspace", "The contest belongs to another workspace generation.")
        case ContestRepositoryError.staleRevision: return .confirmed("stale_revision", "The contest session changed; reload it before retrying.")
        case ContestRepositoryError.requestPayloadConflict: return .confirmed("request_conflict", "This request ID was already used for different contest data.")
        case ContestRepositoryError.invalidPayloadDigest, ContestRepositoryError.invalidDraft,
             ContestRepositoryError.invalidSerialTransition: return .confirmed("invalid_request", "The contest mutation is invalid.")
        case ContestRepositoryError.operationUnresolved: return .uncertain("operation_unresolved", "The contest operation outcome must be recovered from its receipt.")
        case ContestStoreError.invalidQSO(let issues): return .confirmed("invalid_qso", issues.map(\.message).joined(separator: " "))
        case ContestStoreError.unknownRule: return .confirmed("unknown_rule", "The requested contest rule is unavailable.")
        case ContestStoreError.invalidPage: return .confirmed("invalid_params", "The requested contest page is invalid.")
        case ContestStoreError.invalidDatabaseURL: return .confirmed("invalid_database", "The contest database path is invalid.")
        case ContestStoreError.invalidSession: return .confirmed("invalid_session", "The contest session is invalid.")
        case ContestStoreError.reservationMismatch: return .confirmed("reservation_mismatch", "The serial reservation does not match this contact.")
        case ContestStoreError.serialExhausted: return .confirmed("serial_exhausted", "No further serial number can be allocated.")
        case ContestStoreError.qsoDeleted: return .confirmed("qso_deleted", "The contest contact has already been deleted.")
        case ContestStoreError.invalidCorrectionReason: return .confirmed("invalid_params", "A bounded correction reason is required.")
        case ContestStoreError.immutableQSOField(let field): return .confirmed("immutable_qso", "The correction changed immutable field \(field).")
        case is ContestEvaluationError: return .confirmed("invalid_qso", "The contest contact is invalid.")
        default: return .uncertain("contest_store_failed", "The contest operation did not return a confirmed result.")
        }
    }
}

struct ContestLaneError: Error {
    let code: String
    let message: String
    let outcome: String
    static func confirmed(_ code: String, _ message: String) -> Self { .init(code: code, message: message, outcome: "confirmed") }
    static func uncertain(_ code: String, _ message: String) -> Self { .init(code: code, message: message, outcome: "uncertain") }
}

private enum ContestDatabaseBoundary {
    static func validate(databaseURL: URL, fileManager: FileManager = .default) throws {
        let database = databaseURL.standardizedFileURL
        let supportRoot = database.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL
        let applicationSupport = supportRoot.deletingLastPathComponent().standardizedFileURL
        guard database.path.hasPrefix(supportRoot.path + "/") else { throw unsafe() }

        var candidate = database
        while candidate.path != applicationSupport.path {
            let values = try? candidate.resourceValues(forKeys: [.isSymbolicLinkKey])
            if fileManager.fileExists(atPath: candidate.path) || values?.isSymbolicLink == true {
                guard values?.isSymbolicLink != true else { throw unsafe() }
            }
            let parent = candidate.deletingLastPathComponent()
            guard parent.path != candidate.path else { throw unsafe() }
            candidate = parent
        }

        guard fileManager.fileExists(atPath: database.path) else { return }
        let values = try database.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw unsafe() }
        let isolated = try fileManager.attributesOfItem(atPath: database.path)
        for protected in [
            applicationSupport.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite"),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"),
        ] where fileManager.fileExists(atPath: protected.path) {
            let production = try fileManager.attributesOfItem(atPath: protected.path)
            if sameFile(isolated, production) { throw unsafe() }
        }
    }

    private static func sameFile(_ lhs: [FileAttributeKey: Any], _ rhs: [FileAttributeKey: Any]) -> Bool {
        guard let lhsFile = lhs[.systemFileNumber] as? NSNumber, let rhsFile = rhs[.systemFileNumber] as? NSNumber,
              let lhsSystem = lhs[.systemNumber] as? NSNumber, let rhsSystem = rhs[.systemNumber] as? NSNumber else { return false }
        return lhsFile == rhsFile && lhsSystem == rhsSystem
    }

    private static func unsafe() -> ContestLaneError {
        .confirmed("unsafe_workspace", "The contest database path is not isolated from production data.")
    }
}

private struct ContestReferenceData {
    let resolver: CTYResolver
    let version: String
    let primaryPrefixes: [Int: String]

    static func bundled() throws -> Self {
        let csv = try CTYResolver.bundledCSV()
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in csv.utf8 { hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211 }
        var prefixes: [Int: String] = [:]
        for line in csv.split(whereSeparator: \.isNewline) {
            let columns = csvColumns(String(line))
            if columns.count >= 3, let adif = Int(columns[2]), prefixes[adif] == nil { prefixes[adif] = columns[0].uppercased() }
        }
        return .init(resolver: try CTYResolver.bundled(), version: String(format: "bundled-cty-fnv64-%016llx", hash), primaryPrefixes: prefixes)
    }

    func resolve(_ callsign: String, at date: Date) -> CountryInfo? { resolver.resolve(callsign, at: date) }
    func entity(_ country: CountryInfo) throws -> ContestEntitySnapshot {
        guard let prefix = primaryPrefixes[country.adif], !prefix.isEmpty else {
            throw ContestLaneError.confirmed("reference_unavailable", "Bundled CTY data has no canonical prefix for the resolved entity.")
        }
        return ContestEntitySnapshot(adif: country.adif, name: country.name, countryPrefix: prefix,
                                     continent: country.continent, cqZone: country.cqZone)
    }
    func ruleWire(_ metadata: XContestCore.ContestRuleMetadata) -> [String: Any] {
        ["identity": Wire.ruleIdentityWire(metadata.identity), "displayName": metadata.displayName, "mode": "CW",
         "referenceDataVersion": version, "sourceVerification": "provisional", "sourceNote": metadata.sourceProvenance]
    }
    private static func csvColumns(_ line: String) -> [String] {
        var values: [String] = [], current = "", quoted = false
        for character in line {
            if character == "\"" { quoted.toggle() }
            else if character == "," && !quoted { values.append(current.trimmingCharacters(in: .whitespaces)); current = "" }
            else { current.append(character) }
        }
        values.append(current.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ";"))))
        return values
    }
}

private struct ContestMutationRequest {
    let sessionID: UUID, workspaceGeneration: String, requestID: UUID, expectedRevision: UInt64
    let draftID: UUID?, payloadDigest: String, timestamp: Date, payload: [String: Any]
    func coreScope(generation: UUID, draftID override: UUID? = nil) -> XContestCore.ContestMutationScope {
        .init(sessionID: sessionID, workspaceGeneration: generation, requestID: requestID, expectedRevision: expectedRevision,
              draftID: override ?? draftID, payloadDigest: payloadDigest)
    }
}

private enum Wire {
    static func exact(_ value: [String: Any], _ keys: Set<String>) throws {
        guard Set(value.keys) == keys else { throw ContestLaneError.confirmed("invalid_params", "Contest request fields are invalid.") }
    }
    static func object(_ value: [String: Any], _ key: String) throws -> [String: Any] {
        guard let result = value[key] as? [String: Any] else { throw ContestLaneError.confirmed("invalid_params", "Contest request object is invalid.") }
        return result
    }
    static func text(_ value: [String: Any], _ key: String, max: Int, empty: Bool = false) throws -> String {
        guard let result = value[key] as? String, result.utf8.count <= max, empty || !result.isEmpty else { throw ContestLaneError.confirmed("invalid_params", "Contest text is invalid.") }
        return result
    }
    static func callsign(_ value: [String: Any], _ key: String) throws -> String {
        let result = try text(value, key, max: 32).uppercased()
        guard result.range(of: #"^[A-Z0-9]+(?:/[A-Z0-9]+)*$"#, options: .regularExpression) != nil,
              result.contains(where: \.isLetter), result.contains(where: \.isNumber) else { throw ContestLaneError.confirmed("invalid_params", "Callsign is invalid.") }
        return result
    }
    static func uuid(_ value: [String: Any], _ key: String) throws -> UUID {
        let raw = try text(value, key, max: 36)
        guard let id = UUID(uuidString: raw), raw == uuidString(id) else {
            throw ContestLaneError.confirmed("invalid_params", "Contest identity must be a canonical lowercase UUID.")
        }
        return id
    }
    static func uuidString(_ value: UUID) -> String { value.uuidString.lowercased() }
    static func generation(_ raw: String) throws -> String {
        guard let value = UUID(uuidString: raw), raw == uuidString(value) else {
            throw ContestLaneError.confirmed("invalid_workspace", "Workspace generation must be a canonical lowercase UUID.")
        }
        return raw
    }
    static func uint(_ value: [String: Any], _ key: String) throws -> UInt64 {
        guard let number = value[key] as? NSNumber, String(cString: number.objCType) != "c", number.doubleValue.isFinite,
              number.doubleValue >= 0, number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue <= 9_007_199_254_740_991 else { throw ContestLaneError.confirmed("invalid_params", "Contest number is invalid.") }
        return number.uint64Value
    }
    static func int(_ value: [String: Any], _ key: String, range: ClosedRange<Int>) throws -> Int {
        let number = try uint(value, key), result = Int(number)
        guard range.contains(result) else { throw ContestLaneError.confirmed("invalid_params", "Contest number is outside the supported range.") }
        return result
    }
    static func date(_ value: [String: Any], _ key: String) throws -> Date {
        let raw = try text(value, key, max: 32)
        guard raw.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#, options: .regularExpression) != nil else {
            throw ContestLaneError.confirmed("invalid_params", "Contest timestamp must be finite ISO UTC with milliseconds.")
        }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let result = formatter.date(from: raw), result.timeIntervalSinceReferenceDate.isFinite else { throw ContestLaneError.confirmed("invalid_params", "Contest timestamp is invalid.") }
        return result
    }
    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
    static func generationID(_ generation: String) throws -> UUID {
        guard let uuid = UUID(uuidString: generation), generation == uuidString(uuid) else {
            throw ContestLaneError.confirmed("invalid_workspace", "Workspace generation is invalid.")
        }
        return uuid
    }
    static func requireGeneration(_ requested: String, _ actual: String) throws {
        guard try generation(requested) == actual else { throw ContestLaneError.confirmed("stale_workspace", "The isolated workspace generation changed.") }
    }
    static func ruleIdentity(_ value: [String: Any]) throws -> ContestRuleIdentity {
        try exact(value, ["id", "version", "edition", "sourceRevision"])
        return .init(id: try text(value, "id", max: 32), version: try text(value, "version", max: 64),
                     edition: try text(value, "edition", max: 32), sourceRevision: try text(value, "sourceRevision", max: 160))
    }
    static func ruleIdentityWire(_ value: ContestRuleIdentity) -> [String: Any] {
        ["id": value.id, "version": value.version, "edition": value.edition, "sourceRevision": value.sourceRevision]
    }
    static func entity(_ value: [String: Any]) throws -> ContestEntitySnapshot {
        try exact(value, ["adif", "name", "countryPrefix", "continent", "cqZone"])
        return .init(adif: try int(value, "adif", range: 1...Int.max),
                     name: try text(value, "name", max: 128),
                     countryPrefix: try text(value, "countryPrefix", max: 16),
                     continent: try text(value, "continent", max: 2),
                     cqZone: try int(value, "cqZone", range: 1...40))
    }
    static func entityWire(_ value: ContestEntitySnapshot) -> [String: Any] {
        ["adif": value.adif, "name": value.name, "countryPrefix": value.countryPrefix,
         "continent": value.continent, "cqZone": value.cqZone]
    }
    static func provenance(_ value: [String: Any]) throws -> ContestQSOProvenance {
        try exact(value, ["source", "sourceIdentity", "importedClaimedScore"])
        guard let source = ContestQSOProvenance.Source(rawValue: try text(value, "source", max: 32)) else {
            throw ContestLaneError.confirmed("invalid_params", "Contest provenance source is invalid.")
        }
        let sourceIdentity: String?
        if value["sourceIdentity"] is NSNull { sourceIdentity = nil }
        else { sourceIdentity = try text(value, "sourceIdentity", max: 256) }
        let importedClaimedScore: Int64?
        if value["importedClaimedScore"] is NSNull { importedClaimedScore = nil }
        else {
            let number = try uint(value, "importedClaimedScore")
            guard number <= UInt64(Int64.max) else {
                throw ContestLaneError.confirmed("invalid_params", "Imported claimed score is invalid.")
            }
            importedClaimedScore = Int64(number)
        }
        return .init(source: source, sourceIdentity: sourceIdentity, importedClaimedScore: importedClaimedScore)
    }
    static func provenanceWire(_ value: ContestQSOProvenance) -> [String: Any] {
        ["source": value.source.rawValue, "sourceIdentity": value.sourceIdentity as Any? ?? NSNull(),
         "importedClaimedScore": value.importedClaimedScore as Any? ?? NSNull()]
    }
    static func mutation(_ params: [String: Any], payloadKeys: Set<String>, requiresDraft: Bool) throws -> ContestMutationRequest {
        var keys: Set<String> = ["sessionID", "workspaceGeneration", "requestID", "expectedRevision", "payloadDigest", "operationTimestamp", "payload"]
        if requiresDraft { keys.insert("draftID") }
        try exact(params, keys)
        let payload = try object(params, "payload"); try exact(payload, payloadKeys)
        return .init(sessionID: try uuid(params, "sessionID"), workspaceGeneration: try text(params, "workspaceGeneration", max: 128),
            requestID: try uuid(params, "requestID"), expectedRevision: try uint(params, "expectedRevision"),
            draftID: requiresDraft ? try uuid(params, "draftID") : nil, payloadDigest: try text(params, "payloadDigest", max: 512),
            timestamp: try date(params, "operationTimestamp"), payload: payload)
    }
    struct DraftFields { let callsign, sentReport, sentExchange, receivedReport, receivedExchange, band, mode: String; let frequencyHz: Int64? }
    static func draftFields(_ value: [String: Any]) throws -> DraftFields {
        try exact(value, ["callsign", "sentReport", "sentExchange", "receivedReport", "receivedExchange", "frequencyHz", "band", "mode"])
        let call = try text(value, "callsign", max: 32, empty: true).uppercased()
        guard call.range(of: #"^[A-Z0-9/]*$"#, options: .regularExpression) != nil else {
            throw ContestLaneError.confirmed("invalid_params", "Contest callsign draft contains unsupported characters.")
        }
        let mode = try text(value, "mode", max: 8); guard mode == "CW" else { throw ContestLaneError.confirmed("invalid_params", "Only CW is supported.") }
        let band = try text(value, "band", max: 8); guard ["160m", "80m", "40m", "20m", "15m", "10m"].contains(band) else { throw ContestLaneError.confirmed("invalid_params", "Contest band is invalid.") }
        let frequency: Int64?
        if value["frequencyHz"] is NSNull { frequency = nil }
        else { let number = try uint(value, "frequencyHz"); guard number <= 100_000_000_000 else { throw ContestLaneError.confirmed("invalid_params", "Contest frequency is invalid.") }; frequency = Int64(number) }
        return .init(callsign: call, sentReport: try text(value, "sentReport", max: 3, empty: true),
            sentExchange: try text(value, "sentExchange", max: 32, empty: true), receivedReport: try text(value, "receivedReport", max: 3, empty: true),
            receivedExchange: try text(value, "receivedExchange", max: 32, empty: true), band: band, mode: mode, frequencyHz: frequency)
    }
}
