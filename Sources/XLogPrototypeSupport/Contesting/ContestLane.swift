import Foundation
#if canImport(CoreFoundation)
import CoreFoundation
#endif
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
    private static let activeRules = ContestRuleRegistry([
        CQWWCWRule(), CQWPXCWRule(), CQWWSSBRule(), CQWPXSSBRule(),
        OceaniaDXCWRule(), OceaniaDXSSBRule(), SACCWRule(), SACSSBRule(),
        NAQPCWRule(), NAQPSSBRule(), NAQPRTTYRule(), ARRLRTTYRoundupRule(),
        JIDXCWRule(), JIDXSSBRule(), ARRLDXCWRule(), ARRLDXSSBRule(),
    ])
    private let rules: ContestRuleRegistry
    private let declarativeCatalog: [ContestRuleIdentity: ContestDeclarativeCatalogEntry]
    private var store: SQLiteContestStore?
    private var exportLane: ContestExportLane?
    private var assistanceService: ContestSCPService?
    private var callHistoryService: ContestCallHistoryService?
    private var tail: Task<Void, Never>?
    private var terminalShutdown = false

    init(databaseURL: URL, generationSource: @escaping GenerationSource,
         exportLane: ContestExportLane? = nil,
         rules: ContestRuleRegistry? = nil,
         declarativeDefinitions: [ContestDeclarativeDefinition]? = nil) throws {
        self.databaseURL = databaseURL
        self.generationSource = generationSource
        self.exportLane = exportLane
        self.rules = rules ?? Self.activeRules
        let definitions = try declarativeDefinitions.map { try $0.map(ContestDeclarativeCatalogEntry.init) }
            ?? (rules == nil ? ContestBuiltInDeclarativeCatalog.operatorArchiveEntries() : [])
        var catalog: [ContestRuleIdentity: ContestDeclarativeCatalogEntry] = [:]
        for entry in definitions {
            guard catalog[entry.identity] == nil, self.rules.rule(for: entry.identity) == nil else {
                throw ContestDefinitionError.invalidDefinition([
                    "catalog: duplicate or conflicting rule identity \(entry.identity.id)",
                ])
            }
            catalog[entry.identity] = entry
        }
        self.declarativeCatalog = catalog
        self.reference = try ContestReferenceData.bundled()
        try ContestDatabaseBoundary.validate(databaseURL: databaseURL)
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        if Self.isConcurrentMethod(method) {
            try requireConcurrentRunning(method)
            return try await perform(method: method, params: params)
        }
        let previous = tail
        let operation = Task { [self] in
            await previous?.value
            return try await perform(method: method, params: params)
        }
        tail = Task { _ = try? await operation.value }
        return try await operation.value
    }

    func shutdown() async {
        terminalShutdown = true
        await exportLane?.shutdown()
        await assistanceService?.shutdown()
    }

    private func perform(method: String, params: [String: Any]) async throws -> [String: Any] {
        if Self.isConcurrentMethod(method) { try requireConcurrentRunning(method) }
        let before = try Wire.generation(try await generationSource())
        if Self.isConcurrentMethod(method) { try requireConcurrentRunning(method) }
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
            case "contest_export_prepare", "contest_export_read", "contest_export_release":
                result = try await exportTransport().handle(method: method, params: params)
            case "contest_scp_status", "contest_scp_query", "contest_scp_cancel", "contest_scp_select",
                 "contest_scp_import_private":
                result = try await assistance(method: method, params: params)
            case "contest_history_status", "contest_history_preview_private", "contest_history_preview_page",
                 "contest_history_preview_cancel", "contest_history_preview_commit",
                 "contest_history_query", "contest_history_query_cancel", "contest_history_select",
                 "contest_history_apply":
                result = try await callHistory(method: method, params: params, generation: before)
            default: throw ContestLaneError.confirmed("unknown_method", "Unknown contest method.")
            }
        } catch let error as ContestLaneError { throw error }
          catch let error as ContestExportLaneError { throw Self.map(error) }
          catch let error as ContestAssistanceLaneError { throw Self.map(error) }
          catch is ContestSCPServiceError { throw ContestLaneError.confirmed("scp_import_failed", "The selected SCP file could not be imported.") }
          catch is ContestSCPError { throw ContestLaneError.confirmed("invalid_scp", "The SCP dataset or query is invalid.") }
          catch let error as ContestCallHistoryServiceError { throw Self.map(error) }
          catch let error as ContestCallHistoryError { throw Self.map(error) }
          catch is ContestCallHistoryProjectionError {
              throw ContestLaneError.confirmed("invalid_history_projection", "The selected call-history value cannot be applied to this draft.")
          }
          catch { throw Self.map(error) }
        if Self.isConcurrentMethod(method) { try requireConcurrentRunning(method) }
        let after: String
        do { after = try Wire.generation(try await generationSource()) }
        catch {
            if method.hasPrefix("contest_export_") {
                throw ContestLaneError.uncertain("workspace_fence_failed", "The export response could not be fenced; retry the exact export ID and payload.")
            }
            throw ContestLaneError.uncertain("workspace_fence_failed", "The workspace could not be verified after the contest request; check its receipt before retrying.")
        }
        if Self.isConcurrentMethod(method) { try requireConcurrentRunning(method) }
        guard before == after else {
            if method.hasPrefix("contest_export_") {
                throw ContestLaneError.uncertain("stale_workspace", "The isolated workspace changed while the export request was running; retry only with its exact coordinate.")
            }
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
        let created = try SQLiteContestStore(databaseURL: databaseURL, rules: rules)
        store = created
        return created
    }

    private func currentRule(for identity: ContestRuleIdentity) -> (any ContestRule)? {
        declarativeCatalog[identity]?.rule ?? rules.rule(for: identity)
    }

    private func rule(from snapshot: ContestSessionReadSnapshot) throws -> any ContestRule {
        if let data = snapshot.canonicalDefinitionData {
            do {
                let definition = try JSONDecoder().decode(ContestDeclarativeDefinition.self, from: data)
                guard definition.identity == snapshot.session.session.rule,
                      try definition.canonicalStorageData() == data else {
                    throw ContestDefinitionError.digestMismatch
                }
                return DeclarativeContestRule(definition: definition)
            } catch {
                throw ContestLaneError.confirmed("invalid_session", "The stored contest definition is invalid.")
            }
        }
        guard let rule = rules.rule(for: snapshot.session.session.rule) else {
            throw ContestLaneError.confirmed("unknown_rule", "The contest rule is unavailable.")
        }
        return rule
    }

    private func resolvedRule(for stored: StoredContestSession) async throws -> any ContestRule {
        if let rule = currentRule(for: stored.session.rule) { return rule }
        let snapshot = try await repository().sessionDefinitionSnapshot(id: stored.session.id)
        guard snapshot.session == stored else {
            throw ContestLaneError.confirmed("stale_revision", "The contest session changed; reload it before retrying.")
        }
        guard let data = snapshot.canonicalDefinitionData else {
            throw ContestLaneError.confirmed("unknown_rule", "The contest rule is unavailable.")
        }
        do {
            let definition = try JSONDecoder().decode(ContestDeclarativeDefinition.self, from: data)
            guard definition.identity == stored.session.rule,
                  try definition.canonicalStorageData() == data else {
                throw ContestDefinitionError.digestMismatch
            }
            return DeclarativeContestRule(definition: definition)
        } catch {
            throw ContestLaneError.confirmed("invalid_session", "The stored contest definition is invalid.")
        }
    }

    private func exportTransport() throws -> ContestExportLane {
        try requireExportRunning()
        if let exportLane { return exportLane }
        let service = ContestExportService(repository: try repository(), rules: rules)
        let generationSource = self.generationSource
        let created = ContestExportLane(service: service) {
            let raw = try await generationSource()
            guard let generation = UUID(uuidString: raw), raw == generation.uuidString.lowercased() else {
                throw ContestExportLaneError("workspace_fence_failed", "The workspace generation could not be verified.")
            }
            return generation
        }
        exportLane = created
        return created
    }

    private func assistanceTransport() throws -> ContestSCPService {
        if let assistanceService { return assistanceService }
        let repository = try repository()
        let generationSource = self.generationSource
        let databaseURL = self.databaseURL
        let cacheURL = databaseURL.deletingLastPathComponent()
            .appendingPathComponent("SuperCheckPartial", isDirectory: true)
            .appendingPathComponent("current.json")
        let created = try ContestSCPService(cacheURL: cacheURL,
                                            validatePrivateRoot: {
            try ContestDatabaseBoundary.validateCache(cacheURL: cacheURL, databaseURL: databaseURL)
        }) { scope in
            let current = try Wire.generation(try await generationSource())
            guard current == scope.workspaceGeneration,
                  let sessionID = UUID(uuidString: scope.sessionID), scope.sessionID == sessionID.uuidString.lowercased() else {
                throw ContestLaneError.confirmed("stale_workspace", "The callsign query belongs to another contest context.")
            }
            let stored = try await repository.openSession(id: sessionID)
            guard stored.session.workspaceGeneration == (try Wire.generationID(current)) else {
                throw ContestLaneError.confirmed("stale_workspace", "The callsign query belongs to another contest context.")
            }
        }
        assistanceService = created
        return created
    }

    private func assistance(method: String, params: [String: Any]) async throws -> [String: Any] {
        let service = try assistanceTransport()
        switch method {
        case "contest_scp_status":
            try Wire.exact(params, [])
            let status = await service.status()
            return ["dataset": status.dataset.map(Self.datasetWire) ?? NSNull(),
                    "unavailableReason": status.unavailableReason ?? NSNull()]
        case "contest_scp_import_private":
            try Wire.exact(params, ["path", "sourceName"])
            let dataset = try await service.importFile(path: try Wire.text(params, "path", max: 4_096),
                sourceName: try Wire.text(params, "sourceName", max: 256),
                retrievedAt: Date())
            return ["dataset": Self.datasetWire(dataset)]
        case "contest_scp_query":
            try Wire.exact(params, ["sessionID", "workspaceGeneration", "requestID", "query"])
            let context = try Wire.assistanceContext(params)
            let result = try await service.query(try Wire.text(params, "query", max: 32), context: context)
            return Self.queryWire(result)
        case "contest_scp_cancel":
            try Wire.exact(params, ["sessionID", "workspaceGeneration", "requestID"])
            return ["cancelled": try await service.cancel(context: Wire.assistanceContext(params))]
        case "contest_scp_select":
            try Wire.exact(params, ["sessionID", "workspaceGeneration", "requestID", "matchID"])
            let callsign = try await service.selectedCallsign(matchID: try Wire.text(params, "matchID", max: 160),
                                                              context: Wire.assistanceContext(params))
            return ["callsign": callsign]
        default: throw ContestLaneError.confirmed("unknown_method", "Unknown callsign-assistance method.")
        }
    }

    private static func datasetWire(_ dataset: ContestSCPDatasetInfo) -> [String: Any] {
        ["sourceID": dataset.provenance.sourceID, "version": dataset.provenance.version,
         "retrievedAtUTC": dataset.provenance.retrievedAtUTC.map(Wire.iso) ?? NSNull(),
         "sha256": dataset.sha256, "byteCount": dataset.byteCount, "recordCount": dataset.recordCount,
         "duplicateCount": dataset.duplicateCount, "digestVerification": dataset.digestVerification.rawValue]
    }

    private static func queryWire(_ result: ContestSCPQueryResult) -> [String: Any] {
        ["sessionID": result.context.sessionID, "workspaceGeneration": result.context.workspaceGeneration,
         "requestID": result.context.requestID, "normalizedQuery": result.normalizedQuery,
         "matches": result.matches.map { ["matchID": $0.matchID, "callsign": $0.callsign,
             "score": $0.score, "isPrefixMatch": $0.isPrefixMatch] },
         "dataset": datasetWire(result.dataset), "evaluatedRecordCount": result.evaluatedRecordCount,
         "isPartial": result.isPartial]
    }

    private func callHistoryTransport() throws -> ContestCallHistoryService {
        if let callHistoryService { return callHistoryService }
        let databaseURL = self.databaseURL
        let cacheURL = databaseURL.deletingLastPathComponent()
            .appendingPathComponent("CallHistory", isDirectory: true)
            .appendingPathComponent("current.json")
        let created = try ContestCallHistoryService(cacheURL: cacheURL, validatePrivateRoot: {
            try ContestDatabaseBoundary.validateCache(cacheURL: cacheURL, databaseURL: databaseURL)
        })
        callHistoryService = created
        return created
    }

    private func callHistory(method: String, params: [String: Any], generation: String) async throws -> [String: Any] {
        let service = try callHistoryTransport()
        switch method {
        case "contest_history_status":
            try Wire.exact(params, [])
            let status = await service.status()
            return ["dataset": status.dataset.map(Self.historyDatasetWire) ?? NSNull(),
                    "pendingPreview": status.pending.map(Self.historyPreviewWire) ?? NSNull(),
                    "unavailableReason": status.unavailableReason ?? NSNull()]
        case "contest_history_preview_private":
            try Wire.exact(params, ["path", "sourceName"])
            let receipt = try await service.previewFile(
                path: try Wire.text(params, "path", max: 4_096),
                sourceName: try Wire.text(params, "sourceName", max: 256),
                importedAtUTC: Date(), workspaceGeneration: generation)
            return Self.historyPreviewWire(receipt)
        case "contest_history_preview_page":
            try Wire.exact(params, ["previewID", "sha256", "workspaceGeneration", "offset", "limit"])
            let requestedGeneration = try Wire.generation(try Wire.text(params, "workspaceGeneration", max: 36))
            try Wire.requireGeneration(requestedGeneration, generation)
            let page = try await service.diagnosticPage(
                previewID: try Wire.text(params, "previewID", max: 36),
                expectedSHA256: try Wire.text(params, "sha256", max: 64),
                workspaceGeneration: requestedGeneration,
                offset: try Wire.int(params, "offset", range: 0...Int.max),
                limit: try Wire.int(params, "limit", range: 1...100))
            return Self.historyDiagnosticPageWire(page)
        case "contest_history_preview_cancel":
            try Wire.exact(params, ["previewID", "sha256", "workspaceGeneration"])
            let requestedGeneration = try Wire.generation(try Wire.text(params, "workspaceGeneration", max: 36))
            try Wire.requireGeneration(requestedGeneration, generation)
            return ["cancelled": try await service.cancelImport(
                previewID: try Wire.text(params, "previewID", max: 36),
                expectedSHA256: try Wire.text(params, "sha256", max: 64),
                workspaceGeneration: requestedGeneration)]
        case "contest_history_preview_commit":
            try Wire.exact(params, ["previewID", "sha256", "workspaceGeneration", "confirmAdvisories"])
            let requestedGeneration = try Wire.generation(try Wire.text(params, "workspaceGeneration", max: 36))
            try Wire.requireGeneration(requestedGeneration, generation)
            let dataset = try await service.commitImport(
                previewID: try Wire.text(params, "previewID", max: 36),
                expectedSHA256: try Wire.text(params, "sha256", max: 64),
                confirmAdvisories: try Wire.bool(params, "confirmAdvisories"),
                expectedWorkspaceGeneration: requestedGeneration)
            return ["dataset": Self.historyDatasetWire(dataset)]
        case "contest_history_query":
            let context = try await historyContext(params, generation: generation, selecting: false)
            let recordOffset = try Wire.int(params, "recordOffset", range: 0...100_000)
            let recordLimit = try Wire.int(params, "recordLimit", range: 1...20)
            let valueOffset = try Wire.int(params, "valueOffset", range: 0...128)
            let valueLimit = try Wire.int(params, "valueLimit", range: 1...128)
            let view = try await service.queryView(callsign: context.inputCallsign, context: context)
            guard try await historyContext(params, generation: generation, selecting: false) == context else {
                _ = await service.cancelQuery(context: context)
                throw ContestLaneError.confirmed("stale_history_context", "The contest draft changed while call history was queried.")
            }
            return try Self.historyQueryWire(view, recordOffset: recordOffset, recordLimit: recordLimit,
                                             valueOffset: valueOffset, valueLimit: valueLimit)
        case "contest_history_query_cancel":
            let context = try await historyContext(params, generation: generation,
                                                   selecting: false, cancelling: true)
            let cancelled = await service.cancelQuery(context: context)
            guard try await historyContext(params, generation: generation,
                                           selecting: false, cancelling: true) == context else {
                throw ContestLaneError.confirmed("stale_history_context", "The contest draft changed while call-history results were cancelled.")
            }
            return ["cancelled": cancelled]
        case "contest_history_select":
            let context = try await historyContext(params, generation: generation, selecting: true)
            let valueOffset = try Wire.int(params, "valueOffset", range: 0...128)
            let valueLimit = try Wire.int(params, "valueLimit", range: 1...128)
            let selected = try await service.selectedView(
                recordID: try Wire.text(params, "recordID", max: 192), expectedContext: context)
            guard try await historyContext(params, generation: generation, selecting: true) == context else {
                throw ContestLaneError.confirmed("stale_history_context", "The contest draft changed while call history was selected.")
            }
            let snapshot = try await repository().sessionReadSnapshot(id: try Wire.generationID(context.sessionID))
            let rule = try rule(from: snapshot)
            guard let draft = snapshot.drafts.first(where: { Wire.uuidString($0.id) == context.draftID }),
                  snapshot.session.revision == UInt64(context.sessionRevision),
                  draft.revision == UInt64(context.draftRevision), draft.callsign == context.inputCallsign,
                  snapshot.session.session.rule == context.ruleIdentity,
                  snapshot.session.session.referenceDataVersion == context.referenceDataVersion else {
                throw ContestLaneError.confirmed("stale_history_context", "The contest draft changed while call history was selected.")
            }
            let projections = try ContestCallHistoryProjector.proposals(
                headers: selected.headers, row: selected.row, rule: rule,
                session: snapshot.session.session, draft: draft)
            return try Self.historySelectionWire(selected, context: context, projections: projections,
                                                 valueOffset: valueOffset, valueLimit: valueLimit)
        case "contest_history_apply":
            return try await historyApply(params, generation: generation, service: service)
        default:
            throw ContestLaneError.confirmed("unknown_method", "Unknown call-history method.")
        }
    }

    private func historyContext(_ params: [String: Any], generation: String,
                                selecting: Bool, cancelling: Bool = false) async throws -> ContestCallHistorySelectionContext {
        var keys = ["sessionID", "workspaceGeneration", "expectedRevision", "draftID", "expectedDraftRevision",
                    "requestID", "callsign", "ruleIdentity", "referenceDataVersion"]
        if !cancelling { keys.append(contentsOf: ["valueOffset", "valueLimit"]) }
        if selecting { keys.append("recordID") }
        else if !cancelling { keys.append(contentsOf: ["recordOffset", "recordLimit"]) }
        try Wire.exact(params, Set(keys))
        try Wire.requireGeneration(try Wire.text(params, "workspaceGeneration", max: 36), generation)
        let sessionID = try Wire.uuid(params, "sessionID")
        let draftID = try Wire.uuid(params, "draftID")
        let expectedRevision = try Wire.uint(params, "expectedRevision")
        let expectedDraftRevision = try Wire.uint(params, "expectedDraftRevision")
        let requestID = try Wire.uuid(params, "requestID")
        let callsign = try Wire.callsign(params, "callsign")
        let ruleIdentity = try Wire.ruleIdentity(Wire.object(params, "ruleIdentity"))
        let referenceDataVersion = try Wire.text(params, "referenceDataVersion", max: 160)
        let snapshot = try await repository().sessionReadSnapshot(id: sessionID)
        try await checked(snapshot.session, generation: generation, revision: expectedRevision)
        guard snapshot.session.session.rule == ruleIdentity,
              snapshot.session.session.referenceDataVersion == referenceDataVersion,
              referenceDataVersion == reference.version,
              Self.historyRuleIDs.contains(ruleIdentity.id),
              let draft = snapshot.drafts.first(where: { $0.id == draftID }),
              draft.sessionID == sessionID, draft.revision == expectedDraftRevision,
              draft.callsign == callsign else {
            throw ContestLaneError.confirmed("stale_history_context", "The call-history request does not match the live contest draft.")
        }
        guard expectedRevision <= UInt64(Int64.max), expectedDraftRevision <= UInt64(Int64.max) else {
            throw ContestLaneError.confirmed("invalid_params", "Call-history revisions exceed the supported range.")
        }
        return .init(sessionID: Wire.uuidString(sessionID), workspaceGeneration: generation,
                     sessionRevision: Int64(expectedRevision), draftID: Wire.uuidString(draftID),
                     draftRevision: Int64(expectedDraftRevision), inputCallsign: callsign,
                     requestID: Wire.uuidString(requestID), ruleIdentity: ruleIdentity,
                     referenceDataVersion: referenceDataVersion)
    }

    private func historyApply(_ params: [String: Any], generation: String,
                              service: ContestCallHistoryService) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: ["selection", "projectionIDs", "fields"],
                                        requiresDraft: true)
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let selection = try Wire.object(request.payload, "selection")
        let context = try Wire.historySelectionContext(selection)
        let recordID = try Wire.text(selection, "recordID", max: 192)
        guard context.sessionID == Wire.uuidString(request.sessionID),
              context.workspaceGeneration == generation,
              context.sessionRevision == Int64(request.expectedRevision),
              context.draftID == request.draftID.map(Wire.uuidString) else {
            throw ContestLaneError.confirmed("stale_history_context", "The call-history selection does not match the draft mutation.")
        }
        guard let rawIDs = request.payload["projectionIDs"] as? [Any],
              let projectionIDs = rawIDs as? [String], (1...2).contains(projectionIDs.count),
              projectionIDs.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 64 }),
              Set(projectionIDs).count == projectionIDs.count else {
            throw ContestLaneError.confirmed("invalid_params", "Call-history projection identifiers are invalid.")
        }
        let prior = try await preflightReplay(request)
        let stored = try await checkedSession(request.sessionID, generation: generation,
                                              revision: prior == nil ? request.expectedRevision : nil)
        let rule = try await resolvedRule(for: stored)
        let current = try await repository().draft(sessionID: request.sessionID, id: request.draftID!)
        let projection = rule as? any ContestRuleExchangeFieldProjection
        let fields = try Wire.draftFields(Wire.object(request.payload, "fields"), metadata: rule.metadata,
                                          projection: projection.map { policy in { policy.projectExchangeFields($0) } })
        let provided = ContestDraftSnapshot(
            id: current.id, sessionID: current.sessionID,
            revision: prior?.committedRevision ?? (stored.revision + 1), updatedAt: request.timestamp,
            callsign: fields.callsign, band: fields.band, mode: fields.mode, frequencyHz: fields.frequencyHz,
            rstSent: fields.sentReport, rstReceived: fields.receivedReport,
            exchange: .init(rawSent: fields.sentExchange,
                            normalizedSent: projection != nil
                                ? Wire.normalizedAggregate(fields.sentExchangeFields, descriptors: rule.metadata.entry.exchange.sentFields)
                                : fields.sentExchange.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                            rawReceived: fields.receivedExchange,
                            normalizedReceived: projection != nil
                                ? Wire.normalizedAggregate(fields.receivedExchangeFields, descriptors: rule.metadata.entry.exchange.receivedFields)
                                : fields.receivedExchange.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                            sentFields: fields.sentExchangeFields, receivedFields: fields.receivedExchangeFields),
            entity: current.entity, operatorCallsign: current.operatorCallsign,
            stationLocation: current.stationLocation)
        if prior == nil {
            let live = ContestCallHistorySelectionContext(
                sessionID: Wire.uuidString(request.sessionID), workspaceGeneration: generation,
                sessionRevision: Int64(stored.revision), draftID: Wire.uuidString(current.id),
                draftRevision: Int64(current.revision), inputCallsign: current.callsign,
                requestID: context.requestID, ruleIdentity: stored.session.rule,
                referenceDataVersion: stored.session.referenceDataVersion)
            guard live == context else {
                throw ContestLaneError.confirmed("stale_history_context", "The contest draft changed before call history was applied.")
            }
            let selected = try await service.selectedView(recordID: recordID, expectedContext: context)
            let proposals = try ContestCallHistoryProjector.proposals(
                headers: selected.headers, row: selected.row, rule: rule,
                session: stored.session, draft: current)
            let expected = try ContestCallHistoryProjector.applying(
                projectionIDs, from: proposals, to: current, rule: rule, session: stored.session,
                revision: stored.revision + 1, updatedAt: request.timestamp)
            guard expected == provided else {
                throw ContestLaneError.confirmed("invalid_history_projection", "The draft does not exactly match the selected call-history projection.")
            }
        }
        let result = try await repository().updateDraft(
            provided, scope: request.coreScope(generation: stored.session.workspaceGeneration),
            committedAt: request.timestamp)
        _ = await service.cancelQuery(context: context)
        return try await projectCommitted {
            try await mutationWire(result.session, draft: result.draft, qsoCount: result.qsoCount,
                                   generation: generation, receipt: result.receipt,
                                   projection: result.projection)
        }
    }

    private static let historyRuleIDs: Set<String> = [
        "cq-ww-cw", "cq-ww-ssb", "naqp-cw", "naqp-ssb", "naqp-rtty",
        "arrl-rtty-roundup", "arrl-dx-cw", "arrl-dx-ssb",
    ]
    private static let historyWireBudget = 768 * 1_024

    private static func historyDatasetWire(_ value: ContestCallHistoryDatasetInfo) -> [String: Any] {
        ["generation": value.generation, "sha256": value.sha256,
         "sourceName": value.provenance.sourceName, "importedAtUTC": Wire.iso(value.provenance.importedAtUTC),
         "byteCount": value.byteCount, "recordCount": value.recordCount,
         "indexableRecordCount": value.indexableRecordCount,
         "unindexableRecordCount": value.unindexableRecordCount,
         "duplicateCallCount": value.duplicateCallCount]
    }

    private static func historyPreviewWire(_ value: ContestCallHistoryPendingPreview) -> [String: Any] {
        let preview = value.preview
        return ["previewID": value.previewID, "sha256": preview.sha256,
                "expiresAtUTC": Wire.iso(value.expiresAtUTC),
                "activeDatasetGeneration": value.activeDatasetGeneration ?? NSNull(),
                "workspaceGeneration": value.workspaceGeneration ?? NSNull(),
                "sourceName": preview.provenance.sourceName,
                "byteCount": preview.sourceBytes.count, "recordCount": preview.rows.count,
                "duplicateCallCount": preview.duplicateCallCount,
                "indexableRecordCount": preview.rows.filter { $0.normalizedCallsign != nil }.count,
                "unindexableRecordCount": preview.rows.filter { $0.normalizedCallsign == nil }.count,
                "isCommittable": preview.isCommittable,
                "requiresAdvisoryConfirmation": preview.requiresAdvisoryConfirmation,
                "diagnosticCount": preview.diagnostics.count,
                "headers": preview.headers.map(historyHeaderWire)]
    }

    private static func historyHeaderWire(_ value: ContestCallHistoryHeader) -> [String: Any] {
        ["originalName": value.originalName, "canonicalName": value.canonicalName,
         "knownKey": value.knownKey?.rawValue ?? NSNull()]
    }

    private static func historyDiagnosticPageWire(_ value: ContestCallHistoryDiagnosticPage) -> [String: Any] {
        ["preview": historyPreviewWire(value.pending), "offset": value.offset, "limit": value.limit,
         "total": value.total, "diagnostics": value.diagnostics.map {
            ["severity": $0.severity.rawValue, "code": $0.code.rawValue,
             "line": $0.line as Any? ?? NSNull(), "detail": $0.detail]
         }]
    }

    private static func historyQueryWire(_ view: ContestCallHistoryQueryView, recordOffset: Int,
                                         recordLimit: Int, valueOffset: Int,
                                         valueLimit: Int) throws -> [String: Any] {
        let result = view.result
        let upper = min(result.records.count, recordOffset + recordLimit)
        let records = recordOffset < upper ? Array(result.records[recordOffset..<upper]) : []
        var response: [String: Any] = [
            "context": historyContextWire(result.context), "normalizedCallsign": result.normalizedCallsign,
            "dataset": historyDatasetWire(result.dataset), "totalRecords": result.records.count,
            "recordOffset": recordOffset, "recordLimit": recordLimit,
            "valueOffset": valueOffset, "valueLimit": valueLimit, "records": [],
            "next": NSNull(),
        ]
        var rows: [[String: Any]] = []
        for (recordIndex, row) in records.enumerated() {
            let rowValueOffset = recordIndex == 0 ? valueOffset : 0
            let valuesUpper = min(view.headers.count, rowValueOffset + valueLimit)
            var cells: [[String: Any]] = []
            if rowValueOffset < valuesUpper {
                for index in rowValueOffset..<valuesUpper {
                    let value = row.values.indices.contains(index) ? row.values[index] : ""
                    let cell: [String: Any] = ["header": historyHeaderWire(view.headers[index]), "value": value]
                    var candidateCells = cells; candidateCells.append(cell)
                    var candidateRow = historyRowWire(row); candidateRow["values"] = candidateCells
                    var candidateRows = rows; candidateRows.append(candidateRow)
                    var candidate = response
                    candidate["records"] = candidateRows
                    candidate["next"] = ["recordOffset": recordOffset + recordIndex,
                                         "valueOffset": index + 1]
                    guard try JSONSerialization.data(withJSONObject: candidate).count < historyWireBudget else {
                        guard !cells.isEmpty || !rows.isEmpty else {
                            throw ContestLaneError.confirmed("response_too_large", "A call-history value exceeds the response budget.")
                        }
                        response["records"] = cells.isEmpty ? rows :
                            rows + [historyRowWire(row).merging(["values": cells]) { _, new in new }]
                        response["next"] = ["recordOffset": recordOffset + recordIndex, "valueOffset": index]
                        guard try JSONSerialization.data(withJSONObject: response).count < historyWireBudget else {
                            throw ContestLaneError.confirmed("response_too_large", "The call-history page exceeds the response budget.")
                        }
                        return response
                    }
                    cells = candidateCells
                }
            }
            var rowWire = historyRowWire(row); rowWire["values"] = cells
            rows.append(rowWire)
            if valuesUpper < view.headers.count {
                response["records"] = rows
                response["next"] = ["recordOffset": recordOffset + recordIndex, "valueOffset": valuesUpper]
                return response
            }
        }
        response["records"] = rows
        if upper < result.records.count {
            response["next"] = ["recordOffset": upper, "valueOffset": 0]
        }
        guard try JSONSerialization.data(withJSONObject: response).count < historyWireBudget else {
            throw ContestLaneError.confirmed("response_too_large", "The call-history page exceeds the response budget.")
        }
        return response
    }

    private static func historySelectionWire(_ view: ContestCallHistorySelectedView,
                                             context: ContestCallHistorySelectionContext,
                                              projections: [ContestCallHistoryProjection],
                                             valueOffset: Int, valueLimit: Int) throws -> [String: Any] {
        let upper = min(view.headers.count, valueOffset + valueLimit)
        var row = historyRowWire(view.row); row["values"] = []
        var response: [String: Any] = [
            "context": historyContextWire(context), "dataset": historyDatasetWire(view.dataset),
            "record": row, "valueOffset": valueOffset, "valueLimit": valueLimit,
            "nextValueOffset": NSNull(), "projections": projections.map(historyProjectionWire),
        ]
        var cells: [[String: Any]] = []
        if valueOffset < upper {
            for index in valueOffset..<upper {
                let cell: [String: Any] = [
                    "header": historyHeaderWire(view.headers[index]),
                    "value": view.row.values.indices.contains(index) ? view.row.values[index] : "",
                ]
                var candidateCells = cells; candidateCells.append(cell)
                var candidateRow = historyRowWire(view.row); candidateRow["values"] = candidateCells
                var candidate = response
                candidate["record"] = candidateRow
                candidate["nextValueOffset"] = index + 1
                guard try JSONSerialization.data(withJSONObject: candidate).count < historyWireBudget else {
                    guard !cells.isEmpty else {
                        throw ContestLaneError.confirmed("response_too_large", "A selected call-history value exceeds the response budget.")
                    }
                    row["values"] = cells
                    response["record"] = row
                    response["nextValueOffset"] = index
                    guard try JSONSerialization.data(withJSONObject: response).count < historyWireBudget else {
                        throw ContestLaneError.confirmed("response_too_large", "The selected call-history page exceeds the response budget.")
                    }
                    return response
                }
                cells = candidateCells
            }
        }
        row["values"] = cells
        response["record"] = row
        response["nextValueOffset"] = upper < view.headers.count ? upper : NSNull()
        guard try JSONSerialization.data(withJSONObject: response).count < historyWireBudget else {
            throw ContestLaneError.confirmed("response_too_large", "The selected call-history page exceeds the response budget.")
        }
        return response
    }

    private static func historyProjectionWire(_ value: ContestCallHistoryProjection) -> [String: Any] {
        ["id": value.id, "sourceKey": value.sourceKey.rawValue, "target": value.target.rawValue,
         "fieldID": value.fieldID ?? NSNull(), "label": value.label,
         "rawValue": value.rawValue, "normalizedValue": value.normalizedValue]
    }

    private static func historyRowWire(_ row: ContestCallHistoryRow) -> [String: Any] {
        ["recordID": row.recordID, "sourceOrdinal": row.sourceOrdinal, "sourceLine": row.sourceLine,
         "normalizedCallsign": row.normalizedCallsign ?? NSNull(),
         "indexingIssue": row.indexingIssue?.rawValue ?? NSNull()]
    }

    private static func historyContextWire(_ value: ContestCallHistorySelectionContext) -> [String: Any] {
        ["sessionID": value.sessionID, "workspaceGeneration": value.workspaceGeneration,
         "sessionRevision": value.sessionRevision, "draftID": value.draftID,
         "draftRevision": value.draftRevision, "inputCallsign": value.inputCallsign,
         "requestID": value.requestID, "ruleIdentity": Wire.ruleIdentityWire(value.ruleIdentity),
         "referenceDataVersion": value.referenceDataVersion]
    }

    private static func isExportMethod(_ method: String) -> Bool {
        method == "contest_export_prepare" || method == "contest_export_read" || method == "contest_export_release"
    }

    private static func isConcurrentMethod(_ method: String) -> Bool {
        isExportMethod(method) || method.hasPrefix("contest_scp_") ||
            (method.hasPrefix("contest_history_") && method != "contest_history_apply")
    }

    static func isJSONBoolean(_ number: NSNumber) -> Bool {
        #if canImport(CoreFoundation)
        CFGetTypeID(number) == CFBooleanGetTypeID()
        #else
        isFoundationBoolean(number)
        #endif
    }

    /// swift-corelibs-foundation represents JSON booleans with its canonical
    /// true/false NSNumber singletons. Identity avoids conflating Int8 with Bool.
    static func isFoundationBoolean(_ number: NSNumber) -> Bool {
        number === NSNumber(value: true) || number === NSNumber(value: false)
    }

    private func requireExportRunning() throws {
        guard !terminalShutdown else {
            throw ContestLaneError.confirmed("artifact_unavailable", "The contest export lane is shut down.")
        }
    }

    private func requireConcurrentRunning(_ method: String) throws {
        if Self.isExportMethod(method) { try requireExportRunning(); return }
        guard !terminalShutdown else {
            if method.hasPrefix("contest_scp_") {
                throw ContestLaneError.confirmed("scp_unavailable", "Callsign assistance is shut down.")
            }
            throw ContestLaneError.confirmed("history_unavailable", "Call history is shut down.")
        }
    }

    private func catalog(_ params: [String: Any], generation: String) throws -> [String: Any] {
        try Wire.exact(params, [])
        let staticRules = try rules.metadata.map {
            try reference.ruleWire($0, operatorCapability: operatorCapability(for: $0.identity))
        }
        let definitions = try declarativeCatalog.values.sorted {
            ($0.identity.id, $0.identity.version, $0.identity.edition, $0.identity.sourceRevision) <
            ($1.identity.id, $1.identity.version, $1.identity.edition, $1.identity.sourceRevision)
        }.map {
            try reference.ruleWire($0.rule.metadata,
                                   operatorCapability: try ContestOperatorProjection.capability(for: $0.rule),
                                   declarativeDefinition: $0.definition)
        }
        return ["workspaceGeneration": generation, "rules": staticRules + definitions]
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
        let mutationPayload = try Wire.object(params, "payload")
        let declarativeRequest = mutationPayload["definitionDigest"] != nil
        var payloadKeys: Set<String> = ["sessionID", "name", "ruleIdentity", "referenceDataVersion", "station", "operator"]
        if declarativeRequest { payloadKeys.insert("definitionDigest") }
        let request = try Wire.mutation(params, payloadKeys: payloadKeys, requiresDraft: false)
        guard request.sessionID == (try Wire.uuid(request.payload, "sessionID")), request.expectedRevision == 0 else {
            throw ContestLaneError.confirmed("invalid_params", "Create identity or revision is invalid.")
        }
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let identity = try Wire.ruleIdentity(Wire.object(request.payload, "ruleIdentity"))
        let priorReceipt = try await preflightReplay(request)
        var catalogEntry = declarativeCatalog[identity]
        if declarativeRequest {
            let requestedDigest = try Wire.text(request.payload, "definitionDigest", max: 64)
            if catalogEntry == nil, priorReceipt != nil {
                let stored = try await repository().sessionDefinitionSnapshot(id: request.sessionID)
                guard stored.session.session.rule == identity,
                      let data = stored.canonicalDefinitionData else {
                    throw ContestLaneError.confirmed("definition_mismatch", "The committed declarative contest definition is unavailable.")
                }
                do {
                    let definition = try JSONDecoder().decode(ContestDeclarativeDefinition.self, from: data)
                    let persisted = try ContestDeclarativeCatalogEntry(definition: definition)
                    guard persisted.canonicalDefinitionData == data else {
                        throw ContestDefinitionError.digestMismatch
                    }
                    catalogEntry = persisted
                } catch {
                    throw ContestLaneError.confirmed("definition_mismatch", "The committed declarative contest definition is invalid.")
                }
            }
            guard let catalogEntry, requestedDigest == catalogEntry.definitionDigest else {
                throw ContestLaneError.confirmed("definition_mismatch", "The selected declarative contest definition is unavailable or changed.")
            }
        } else if catalogEntry != nil {
            throw ContestLaneError.confirmed("definition_required", "Declarative contest creation requires its catalog digest.")
        }
        guard let rule = catalogEntry?.rule ?? rules.rule(for: identity) else {
            throw ContestLaneError.confirmed("unknown_rule", "The requested contest rule is unavailable.")
        }
        let referenceVersion = try Wire.text(request.payload, "referenceDataVersion", max: 160)
        guard referenceVersion == reference.version else { throw ContestLaneError.confirmed("reference_unavailable", "The requested offline reference data is unavailable.") }
        let stationInput = try Wire.object(request.payload, "station")
        if rule.metadata.entry.version == .v2 {
            var keys: Set<String> = ["callsign", "cqZone", "dxccEntity", "exchangeFields"]
            if !rule.metadata.entry.stationFields.isEmpty { keys.insert("stationFields") }
            try Wire.exact(stationInput, keys)
        } else {
            try Wire.exact(stationInput, ["callsign", "cqZone", "dxccEntity"])
        }
        let operatorInput = try Wire.object(request.payload, "operator")
        try Wire.exact(operatorInput, ["callsign", "category"])
        let stationCall = try Wire.callsign(stationInput, "callsign")
        let zoneText = try Wire.text(stationInput, "cqZone", max: 8)
        let entityText = try Wire.text(stationInput, "dxccEntity", max: 160, empty: true)
        guard let zone = Int(zoneText), (1...40).contains(zone) else {
            throw ContestLaneError.confirmed("station_mismatch", "The station snapshot does not match bundled offline CTY data.")
        }
        let operatorCall = try Wire.callsign(operatorInput, "callsign")
        let stationExchangeDescriptors = catalogEntry == nil
            ? rule.metadata.entry.exchange.sentFields
            : rule.metadata.entry.exchange.sentFields.filter {
                $0.id != rule.metadata.entry.allocatedSerialField?.id
            }
        var parsedStationFields = rule.metadata.entry.version == .v2
            ? try Wire.exchangeFields(Wire.object(stationInput, "exchangeFields"), descriptors: stationExchangeDescriptors)
            : [:]
        let isJIDX = [JIDXCWRule.identity, JIDXSSBRule.identity].contains(identity)
        if isJIDX { parsedStationFields = Wire.normalizedJIDXNumberFields(parsedStationFields) }
        if let projection = rule as? any ContestRuleExchangeFieldProjection {
            parsedStationFields = projection.projectExchangeFields(parsedStationFields)
        }
        let stationEntity: ContestEntitySnapshot?
        if entityText.isEmpty {
            guard isJIDX, stationCall.hasSuffix("/MM"),
                  parsedStationFields["number"]?.normalized == String(format: "%02d", zone) else {
                throw ContestLaneError.confirmed("station_mismatch", "Only a validated JIDX maritime-mobile station may omit its land entity.")
            }
            stationEntity = nil
        } else {
            guard !(isJIDX && stationCall.hasSuffix("/MM")) else {
                throw ContestLaneError.confirmed("station_mismatch", "A JIDX maritime-mobile station must not claim a land entity.")
            }
            guard let country = reference.resolve(stationCall, at: request.timestamp), country.cqZone == zone,
                  country.name.caseInsensitiveCompare(entityText) == .orderedSame else {
                throw ContestLaneError.confirmed("station_mismatch", "The station snapshot does not match bundled offline CTY data.")
            }
            stationEntity = try reference.entity(country)
        }
        let preservesRawFields = isJIDX || rule is any ContestRuleExchangeFieldProjection
        let stationFields = preservesRawFields ? parsedStationFields : parsedStationFields.mapValues {
            ContestExchangeFieldValue(raw: $0.normalized, normalized: $0.normalized)
        }
        let structuredStationFields = rule.metadata.entry.stationFields.isEmpty
            ? [:]
            : try Wire.stationFields(Wire.object(stationInput, "stationFields"),
                                     descriptors: rule.metadata.entry.stationFields)
        let stationExchange = rule.metadata.entry.version == .v2
            ? (rule is any ContestRuleExchangeFieldProjection
                ? Wire.aggregate(stationFields, descriptors: rule.metadata.entry.exchange.sentFields)
                : Wire.normalizedAggregate(stationFields, descriptors: rule.metadata.entry.exchange.sentFields))
            : (rule.metadata.entry.exchange.sentDefault == .stationSnapshot ? zoneText : "")
        let metadata = ContestSessionMetadata(name: try Wire.text(request.payload, "name", max: 128), operatorCallsign: operatorCall,
                                              operatorCategory: try Wire.text(operatorInput, "category", max: 80))
        let session = ContestSessionSnapshot(id: request.sessionID, workspaceGeneration: try Wire.generationID(generation), rule: identity,
            referenceDataVersion: referenceVersion, startedAt: request.timestamp,
            station: ContestStationSnapshot(callsign: stationCall, entity: stationEntity,
                sentExchange: stationExchange, operatorCallsigns: [operatorCall],
                location: rule.metadata.entry.cabrilloLocationField.flatMap { structuredStationFields[$0.id] }
                    ?? stationFields["location"]?.normalized ?? "",
                sentExchangeFields: stationFields))
        let initialBand = rule.metadata.supportedBands.contains("20m")
            ? "20m" : (rule.metadata.supportedBands.sorted().first ?? "")
        let draft = ContestDraftSnapshot(id: request.requestID, sessionID: request.sessionID, revision: 1, updatedAt: request.timestamp,
            callsign: "", band: initialBand, mode: rule.metadata.entry.mode, frequencyHz: nil,
            rstSent: rule.metadata.entry.report.defaultSent, rstReceived: rule.metadata.entry.report.defaultReceived,
            exchange: .init(rawSent: rule.metadata.entry.version == .v2
                                ? Wire.aggregate(stationFields, descriptors: rule.metadata.entry.exchange.sentFields)
                                : session.station.sentExchange,
                            normalizedSent: rule.metadata.entry.version == .v2
                                ? Wire.normalizedAggregate(stationFields, descriptors: rule.metadata.entry.exchange.sentFields)
                                : session.station.sentExchange,
                            rawReceived: "", normalizedReceived: "", sentFields: session.station.sentExchangeFields),
            entity: nil, operatorCallsign: operatorCall, stationLocation: session.station.location)
        let scope = request.coreScope(generation: session.workspaceGeneration, draftID: draft.id)
        let result: ContestSessionCreationResult
        if let catalogEntry {
            result = try await repository().createDeclarativeSession(
                session, metadata: metadata, initialDraft: draft,
                canonicalDefinitionData: catalogEntry.canonicalDefinitionData,
                scope: scope, committedAt: request.timestamp)
        } else {
            result = try await repository().createSession(
                session, metadata: metadata, initialDraft: draft,
                scope: scope, committedAt: request.timestamp)
        }
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
        try await checked(snapshot.session, generation: generation)
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
        let rule = try await resolvedRule(for: stored)
        let isJIDX = [JIDXCWRule.identity, JIDXSSBRule.identity].contains(stored.session.rule)
        let projection = rule as? any ContestRuleExchangeFieldProjection
        let fields = try Wire.draftFields(Wire.object(request.payload, "fields"), metadata: rule.metadata,
                                          normalizeJIDXNumbers: isJIDX,
                                          projection: projection.map { policy in { policy.projectExchangeFields($0) } })
        let entity = try fields.callsign.isEmpty ? nil : reference.resolve(fields.callsign, at: request.timestamp).map(reference.entity)
        let next = ContestDraftSnapshot(id: current.id, sessionID: current.sessionID,
            revision: prior?.committedRevision ?? (stored.revision + 1), updatedAt: request.timestamp,
            callsign: fields.callsign, band: fields.band, mode: fields.mode, frequencyHz: fields.frequencyHz,
            rstSent: fields.sentReport, rstReceived: fields.receivedReport,
            exchange: .init(rawSent: fields.sentExchange,
                            normalizedSent: isJIDX || projection != nil ? Wire.normalizedAggregate(fields.sentExchangeFields, descriptors: rule.metadata.entry.exchange.sentFields) : fields.sentExchange.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                            rawReceived: fields.receivedExchange,
                            normalizedReceived: isJIDX || projection != nil ? Wire.normalizedAggregate(fields.receivedExchangeFields, descriptors: rule.metadata.entry.exchange.receivedFields) : fields.receivedExchange.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                            sentFields: fields.sentExchangeFields, receivedFields: fields.receivedExchangeFields),
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
        let rule = try await resolvedRule(for: session)
        let requirement: ContestResolvedSerialRequirement
        do { requirement = try rule.resolvedSerialRequirement(in: session.session) }
        catch { throw ContestLaneError.confirmed("invalid_session", "The station serial policy is invalid.") }
        guard requirement.requirement == .requiredForCommit,
              requirement.allowedScopes.contains(.session) else {
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
            let rule = try await resolvedRule(for: stored)
            let normalizedSent = rule.metadata.entry.exchange.sentDefault == .reservedSerial
                ? (reservation?.transmittedText ?? draft.exchange.normalizedSent)
                : draft.exchange.normalizedSent
            let rawSent = rule.draftResetSentProjection == .soleStationField
                ? draft.exchange.rawSent : normalizedSent
            qso = ContestQSO(id: request.requestID, sessionID: request.sessionID, timestampUTC: request.timestamp,
                callsign: draft.callsign, band: draft.band, mode: draft.mode, frequencyHz: draft.frequencyHz ?? 0,
                rstSent: draft.rstSent, rstReceived: draft.rstReceived,
                exchange: .init(rawSent: rawSent, normalizedSent: normalizedSent,
                                rawReceived: draft.exchange.rawReceived, normalizedReceived: draft.exchange.normalizedReceived,
                                sentFields: draft.exchange.sentFields, receivedFields: draft.exchange.receivedFields),
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
        try await checked(snapshot.session, generation: generation, revision: snapshot.session.revision)
        return ["sessionID": Wire.uuidString(sessionID), "workspaceGeneration": generation,
                "revision": snapshot.session.revision,
                "qso": try await fullQSOWire(snapshot.qso, stored: snapshot.session)]
    }

    private func qsoCorrect(_ params: [String: Any], generation: String) async throws -> [String: Any] {
        let request = try Wire.mutation(params, payloadKeys: ["qso", "reason"], requiresDraft: false)
        try Wire.requireGeneration(request.workspaceGeneration, generation)
        let prior = try await preflightReplay(request, compareCommittedTimestamp: false)
        let stored = try await checkedSession(request.sessionID, generation: generation,
                                              revision: prior == nil ? request.expectedRevision : nil)
        let qso = try await correctedQSO(Wire.object(request.payload, "qso"), stored: stored)
        let reason = try Wire.text(request.payload, "reason", max: 1_024)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else { throw ContestLaneError.confirmed("invalid_params", "A correction reason is required.") }
        let result = try await repository().correctQSO(qso, reason: reason,
            operationTimestamp: request.timestamp,
            scope: request.coreScope(generation: stored.session.workspaceGeneration, draftID: nil),
            committedAt: prior?.committedAt ?? request.timestamp)
        return try await projectCommitted { try await changeWire(result, generation: generation) }
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
        return try await projectCommitted { try await changeWire(result, generation: generation) }
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
        try await checked(snapshot.session, generation: generation, revision: revision)
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
        try await checked(snapshot.session, generation: generation, revision: revision)
        return scoreWire(snapshot.score, generation: generation)
    }

    private func checkedSession(_ id: UUID, generation: String, revision: UInt64? = nil) async throws -> StoredContestSession {
        let stored = try await repository().openSession(id: id)
        try await checked(stored, generation: generation, revision: revision)
        return stored
    }

    private func checked(_ stored: StoredContestSession, generation: String, revision: UInt64? = nil) async throws {
        guard stored.session.workspaceGeneration == (try Wire.generationID(generation)) else { throw ContestLaneError.confirmed("stale_workspace", "The contest belongs to another workspace generation.") }
        if let revision, stored.revision != revision { throw ContestLaneError.confirmed("stale_revision", "The contest session changed; reload it before retrying.") }
        guard stored.session.referenceDataVersion == reference.version else {
            throw ContestLaneError.confirmed("reference_unavailable", "The session's pinned rule or reference data is unavailable.")
        }
        _ = try await resolvedRule(for: stored)
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
        let rule = try await resolvedRule(for: stored)
        let metadata = rule.metadata
        let entity = stored.session.station.entity
        guard entity != nil || (rule as? ContestRuleStationEntityPolicy)?.allowsMissingStationEntity(in: stored.session) == true else {
            throw ContestLaneError.confirmed("invalid_session", "Contest session metadata is incomplete.")
        }
        let projectedZone = entity.map { String($0.cqZone) }
            ?? stored.session.station.sentExchangeFields["number"]?.normalized
            ?? ""
        var station: [String: Any] = ["callsign": stored.session.station.callsign,
            "cqZone": projectedZone, "dxccEntity": entity?.name ?? ""]
        if metadata.entry.version == .v2 {
            station["exchangeFields"] = Wire.exchangeFieldsWire(stored.session.station.sentExchangeFields,
                                                                  descriptors: metadata.entry.exchange.sentFields)
            if !metadata.entry.stationFields.isEmpty {
                station["stationFields"] = Dictionary(uniqueKeysWithValues: metadata.entry.stationFields.map {
                    ($0.id, $0.role == .cabrilloLocation ? stored.session.station.location : "")
                })
            }
        }
        var result: [String: Any] = ["sessionID": Wire.uuidString(stored.session.id), "workspaceGeneration": generation, "revision": stored.revision,
            "name": stored.metadata.name,
            "rule": try reference.ruleWire(
                metadata, operatorCapability: try ContestOperatorProjection.capability(for: rule),
                declarativeDefinition: (rule as? DeclarativeContestRule)?.definition),
            "referenceDataVersion": stored.session.referenceDataVersion,
            "station": station,
            "operator": ["callsign": stored.metadata.operatorCallsign, "category": stored.metadata.operatorCategory],
            "qsoCount": suppliedCount,
            "updatedAt": Wire.iso(max(stored.createdAt, suppliedDate))]
        if metadata.entry.stationResolvedSerial != nil {
            result["resolvedSerial"] = try Wire.resolvedSerialWire(
                rule.resolvedSerialRequirement(in: stored.session))
        }
        return result
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
        let rule = try await resolvedRule(for: stored)
        let sent = rule.metadata.entry.exchange.sentDefault == .reservedSerial
            ? (serial?.transmittedText ?? draft.exchange.rawSent)
            : draft.exchange.rawSent
        let normalizedSent = rule.draftResetSentProjection == .soleStationField
            ? draft.exchange.normalizedSent : sent.uppercased()
        let candidate = ContestQSO(id: UUID(), sessionID: draft.sessionID, timestampUTC: draft.updatedAt, callsign: draft.callsign,
            band: draft.band, mode: draft.mode, frequencyHz: draft.frequencyHz ?? 0, rstSent: draft.rstSent, rstReceived: draft.rstReceived,
            exchange: .init(rawSent: sent, normalizedSent: normalizedSent,
                            rawReceived: draft.exchange.rawReceived, normalizedReceived: draft.exchange.normalizedReceived,
                            sentFields: draft.exchange.sentFields, receivedFields: draft.exchange.receivedFields),
            entity: draft.entity, operatorCallsign: draft.operatorCallsign, stationLocation: draft.stationLocation,
            provenance: .init(source: .operatorEntry, sourceIdentity: reference.version))
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
        var fields: [String: Any] = ["callsign": draft.callsign, "sentReport": draft.rstSent, "sentExchange": sent,
                       "receivedReport": draft.rstReceived, "receivedExchange": draft.exchange.rawReceived,
                       "frequencyHz": draft.frequencyHz as Any? ?? NSNull(), "band": draft.band, "mode": draft.mode]
        if rule.metadata.entry.version == .v2 {
            fields["sentExchangeFields"] = Wire.exchangeFieldsWire(draft.exchange.sentFields,
                                                                     descriptors: rule.metadata.entry.exchange.sentFields)
            fields["receivedExchangeFields"] = Wire.exchangeFieldsWire(draft.exchange.receivedFields,
                                                                         descriptors: rule.metadata.entry.exchange.receivedFields)
        }
        var result: [String: Any] = ["draftID": Wire.uuidString(draft.id), "sessionID": Wire.uuidString(draft.sessionID), "workspaceGeneration": generation, "revision": stored.revision,
            "fields": fields,
            "reservedSerial": serial?.number as Any? ?? NSNull(),
            "validation": ["errors": validation.filter { $0.severity == .error }.map(\.message),
                           "warnings": validation.filter { $0.severity == .warning }.map(\.message)],
            "dupe": ["state": duplicate == true ? "duplicate" : (duplicate == false ? "clear" : "unchecked"),
                     "reason": duplicate == true ? "This callsign and band are already logged in this contest."
                        : (duplicate == nil ? "Reload the contest session to check duplicate state." : "")],
            "updatedAt": Wire.iso(draft.updatedAt)]
        if let readiness = try ContestOperatorProjection.readiness(
            for: rule, qso: candidate, validation: validation,
            duplicate: duplicate, hasReservation: serial != nil) {
            result["operatorReadiness"] = Wire.operatorReadinessWire(readiness)
        }
        if rule.metadata.entry.stationResolvedSerial != nil {
            result["resolvedSerial"] = try Wire.resolvedSerialWire(
                rule.resolvedSerialRequirement(in: stored.session))
        }
        return result
    }

    private func operatorCapability(for identity: ContestRuleIdentity) throws -> ContestOperatorCapability? {
        guard let rule = currentRule(for: identity) else { return nil }
        return try ContestOperatorProjection.capability(for: rule)
    }

    private func qsoWire(_ qso: ContestQSO, scored: ContestScoredQSO?) throws -> [String: Any] {
        guard let scored else { throw ContestLaneError.confirmed("invalid_score", "The committed QSO is missing from the score projection.") }
        let multiplier = scored.newMultipliers.first.map { "\($0.kind):\($0.value):\($0.scope)" }
        return ["qsoID": Wire.uuidString(qso.id), "sessionID": Wire.uuidString(qso.sessionID), "workedAt": Wire.iso(qso.timestampUTC),
            "callsign": qso.callsign, "band": qso.band, "mode": qso.mode, "sentExchange": qso.exchange.rawSent,
            "receivedExchange": qso.exchange.rawReceived, "points": scored.points, "multiplier": multiplier as Any? ?? NSNull(),
            "multiplierDisplayLabels": scored.newMultipliers.map(reference.displayLabel),
            "isDupe": scored.disposition == .duplicate]
    }

    private func correctedQSO(_ value: [String: Any], stored: StoredContestSession) async throws -> ContestQSO {
        let rule = try await resolvedRule(for: stored)
        var keys: Set<String> = ["qsoID", "sessionID", "originalUTC", "callsign", "band", "mode",
                               "frequencyHz", "sentReport", "receivedReport", "sentExchange",
                               "normalizedSentExchange", "allocatedSerial", "receivedExchange",
                               "normalizedReceivedExchange", "operatorCallsign", "stationLocation",
                               "provenance", "ruleIdentity", "referenceDataVersion"]
        if rule.metadata.entry.version == .v2 {
            keys.formUnion(["sentExchangeFields", "receivedExchangeFields"])
        }
        try Wire.exact(value, keys)
        let qsoID = try Wire.uuid(value, "qsoID")
        let sessionID = try Wire.uuid(value, "sessionID")
        guard sessionID == stored.session.id else {
            throw ContestLaneError.confirmed("wrong_session", "The contact belongs to another contest session.")
        }
        let originalUTC = try Wire.date(value, "originalUTC")
        let callsign = try Wire.callsign(value, "callsign")
        let band = try Wire.text(value, "band", max: 8)
        let mode = try Wire.text(value, "mode", max: 8)
        guard rule.metadata.supportedBands.contains(band), rule.metadata.supportedModes.contains(mode) else {
            throw ContestLaneError.confirmed("invalid_params", "The corrected band or mode is unsupported.")
        }
        guard let modeProfile = rule.metadata.entry.modeProfile(for: mode) else {
            throw ContestLaneError.confirmed("invalid_params", "The corrected mode has no entry profile.")
        }
        let frequency = try Wire.uint(value, "frequencyHz")
        guard frequency > 0, frequency <= 100_000_000_000 else {
            throw ContestLaneError.confirmed("invalid_params", "The corrected frequency is invalid.")
        }
        let aggregateMaximum: ([ContestExchangeFieldDescriptor]) -> Int = { fields in
            fields.reduce(max(0, fields.count - 1)) { $0 + $1.maximumUTF8Bytes }
        }
        let sentMaximum = rule.metadata.entry.version == .v2 ? aggregateMaximum(rule.metadata.entry.exchange.sentFields) : 64
        let receivedMaximum = rule.metadata.entry.version == .v2 ? aggregateMaximum(rule.metadata.entry.exchange.receivedFields) : 64
        let rawSent = try Wire.text(value, "sentExchange", max: sentMaximum, empty: true)
        let normalizedSent = try Wire.text(value, "normalizedSentExchange", max: sentMaximum, empty: true)
        let normalizedReceived = try Wire.text(value, "normalizedReceivedExchange", max: receivedMaximum, empty: true)
        guard try Wire.text(value, "allocatedSerial", max: sentMaximum, empty: true) == normalizedSent else {
            throw ContestLaneError.confirmed("invalid_params", "The allocated sent value is inconsistent.")
        }
        guard let country = reference.resolve(callsign, at: originalUTC),
              let resolvedEntity = try? reference.entity(country) else {
            throw ContestLaneError.confirmed("reference_mismatch", "The corrected callsign does not resolve in pinned CTY data.")
        }
        guard try Wire.ruleIdentity(Wire.object(value, "ruleIdentity")) == stored.session.rule,
              try Wire.text(value, "referenceDataVersion", max: 160) == stored.session.referenceDataVersion else {
            throw ContestLaneError.confirmed("reference_mismatch", "The correction does not match the session's pinned rule and reference data.")
        }
        let provenance = try Wire.provenance(Wire.object(value, "provenance"))
        let structured = rule.metadata.entry.version == .v2
        let isJIDX = [JIDXCWRule.identity, JIDXSSBRule.identity].contains(stored.session.rule)
        var sentFields = structured ? try Wire.exchangeFields(Wire.object(value, "sentExchangeFields"), descriptors: rule.metadata.entry.exchange.sentFields) : [:]
        var receivedFields = structured ? try Wire.exchangeFields(Wire.object(value, "receivedExchangeFields"), descriptors: rule.metadata.entry.exchange.receivedFields) : [:]
        if isJIDX {
            sentFields = Wire.normalizedJIDXNumberFields(sentFields)
            receivedFields = Wire.normalizedJIDXNumberFields(receivedFields)
        }
        if let projection = rule as? any ContestRuleExchangeFieldProjection {
            sentFields = projection.projectExchangeFields(sentFields)
            receivedFields = projection.projectExchangeFields(receivedFields)
        }
        let rawReceived = try Wire.text(value, "receivedExchange", max: receivedMaximum, empty: true)
        if structured,
           (rawSent != Wire.aggregate(sentFields, descriptors: rule.metadata.entry.exchange.sentFields) ||
            rawReceived != Wire.aggregate(receivedFields, descriptors: rule.metadata.entry.exchange.receivedFields)) {
            throw ContestLaneError.confirmed("invalid_params", "Structured correction aggregates do not match their fields.")
        }
        if (isJIDX || rule is any ContestRuleExchangeFieldProjection),
           (normalizedSent != Wire.normalizedAggregate(sentFields, descriptors: rule.metadata.entry.exchange.sentFields) ||
            normalizedReceived != Wire.normalizedAggregate(receivedFields, descriptors: rule.metadata.entry.exchange.receivedFields)) {
            throw ContestLaneError.confirmed("invalid_params", "Structured correction normalization does not match its fields.")
        }
        return ContestQSO(id: qsoID, sessionID: sessionID, timestampUTC: originalUTC,
            callsign: callsign, band: band, mode: mode, frequencyHz: Int64(frequency),
            rstSent: try Wire.text(value, "sentReport", max: modeProfile.report.maximumUTF8Bytes, empty: true),
            rstReceived: try Wire.text(value, "receivedReport", max: modeProfile.report.maximumUTF8Bytes, empty: true),
            exchange: .init(rawSent: rawSent, normalizedSent: normalizedSent,
                            rawReceived: rawReceived,
                            normalizedReceived: normalizedReceived,
                            sentFields: sentFields, receivedFields: receivedFields),
            entity: resolvedEntity, operatorCallsign: try Wire.callsign(value, "operatorCallsign"),
            stationLocation: try Wire.text(value, "stationLocation", max: 128, empty: true),
            provenance: provenance)
    }

    private func fullQSOWire(_ qso: ContestQSO, stored: StoredContestSession) async throws -> [String: Any] {
        let entity: Any = qso.entity.map(Wire.entityWire) ?? NSNull()
        var wire: [String: Any] = ["qsoID": Wire.uuidString(qso.id), "sessionID": Wire.uuidString(qso.sessionID),
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
        let entry = try await resolvedRule(for: stored).metadata.entry
        if entry.version == .v2 {
            wire["sentExchangeFields"] = Wire.exchangeFieldsWire(qso.exchange.sentFields,
                                                                  descriptors: entry.exchange.sentFields)
            wire["receivedExchangeFields"] = Wire.exchangeFieldsWire(qso.exchange.receivedFields,
                                                                      descriptors: entry.exchange.receivedFields)
        }
        return wire
    }

    private func changeWire(_ result: ContestQSOChangeResult, generation: String) async throws -> [String: Any] {
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
        let currentTarget: Any
        if let after = result.after {
            currentTarget = try await fullQSOWire(after, stored: stored)
        } else {
            currentTarget = NSNull()
        }
        return ["session": session, "operation": result.operation.rawValue,
            "qsoID": Wire.uuidString(result.qsoID), "qsoCount": result.qsoCount,
            "score": scoreWire(result.score, generation: generation),
            "currentTarget": currentTarget,
            "auditReference": ["sessionID": Wire.uuidString(stored.session.id),
                               "qsoID": Wire.uuidString(result.qsoID),
                               "requestID": Wire.uuidString(result.receipt.requestID),
                               "revision": result.receipt.committedRevision],
            "receipt": receiptWire(result.receipt)]
    }

    private func scoreWire(_ value: ContestScoreSnapshot, generation: String) -> [String: Any] {
        let labels = Set(value.score.qsos.flatMap(\.newMultipliers).map { "\($0.kind):\($0.value):\($0.scope)" }).sorted()
        let displayLabels = Set(value.score.qsos.flatMap(\.newMultipliers).map(reference.displayLabel)).sorted()
        return ["sessionID": Wire.uuidString(value.sessionID), "workspaceGeneration": generation, "revision": value.revision,
            "qsos": value.score.qsos.count, "points": value.score.totalPoints, "multipliers": value.score.multiplierCount,
            "claimedScore": value.score.claimedScore, "multiplierLabels": labels,
            "multiplierDisplayLabels": displayLabels, "sourceVerification": "provisional"]
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

    private static func map(_ error: ContestExportLaneError) -> ContestLaneError {
        if ["workspace_fence_failed", "stale_workspace"].contains(error.code) {
            return .uncertain(error.code, error.message)
        }
        return .confirmed(error.code, error.message)
    }

    private static func map(_ error: ContestAssistanceLaneError) -> ContestLaneError {
        switch error {
        case .dataUnavailable: return .confirmed("scp_unavailable", "Import a local MASTER.SCP file to enable callsign suggestions.")
        case .invalidContext, .staleResult: return .confirmed("stale_context", "The callsign suggestion belongs to another contest context.")
        case .requestReused: return .confirmed("request_reused", "The callsign request ID was already used.")
        case .capacityExceeded: return .confirmed("scp_busy", "Callsign assistance is busy; wait for an earlier query to settle.")
        case .cancelled: return .confirmed("cancelled", "The callsign query was cancelled.")
        case .stopped: return .confirmed("scp_unavailable", "Callsign assistance is shut down.")
        case .resultUnavailable, .unknownMatch: return .confirmed("selection_unavailable", "The callsign suggestion is no longer available.")
        case .unverifiedDataset, .invalidLimits: return .confirmed("scp_unavailable", "The local SCP dataset is unavailable.")
        }
    }

    private static func map(_ error: ContestCallHistoryServiceError) -> ContestLaneError {
        switch error {
        case .invalidCache, .dataUnavailable:
            return .confirmed("history_unavailable", "Import a call-history file before querying it.")
        case .invalidImport:
            return .confirmed("history_import_failed", "The selected call-history file could not be read safely.")
        case .unknownPreview, .expiredPreview:
            return .confirmed("history_preview_unavailable", "The call-history preview is missing or expired.")
        case .digestMismatch, .staleGeneration:
            return .confirmed("stale_history_preview", "The call-history preview no longer matches the active context.")
        case .previewNotCommittable:
            return .confirmed("history_preview_blocked", "The call-history preview contains blocking issues.")
        case .advisoryConfirmationRequired:
            return .confirmed("history_confirmation_required", "Confirm the call-history advisory issues before import.")
        case .envelopeTooLarge:
            return .confirmed("history_import_failed", "The call-history cache exceeds the storage limit.")
        case .invalidPage:
            return .confirmed("invalid_params", "The call-history page is invalid.")
        case .resultUnavailable:
            return .confirmed("history_selection_unavailable", "The call-history query result is no longer available.")
        }
    }

    private static func map(_ error: ContestCallHistoryError) -> ContestLaneError {
        switch error {
        case .invalidQuery, .invalidContext, .invalidGeneration:
            return .confirmed("invalid_history_query", "The call-history query is invalid.")
        case .staleContext:
            return .confirmed("stale_history_context", "The call-history query belongs to another live context.")
        case .unknownRecord:
            return .confirmed("history_selection_unavailable", "The selected call-history record is unavailable.")
        case .previewNotCommittable:
            return .confirmed("history_preview_blocked", "The call-history preview contains blocking issues.")
        }
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
        case ContestExportServiceError.unsupportedOperatorCategory(let category):
            return .confirmed("unsupported_category", "Contest export does not support stored operator category \(category).")
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

enum ContestDatabaseBoundary {
    static func validate(databaseURL: URL, fileManager: FileManager = .default) throws {
        let database = databaseURL.standardizedFileURL
        let supportRoot = database.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL
        let applicationSupport = supportRoot.deletingLastPathComponent().standardizedFileURL
        try validatePrivateFile(database, privateRoot: supportRoot, ancestorBoundary: applicationSupport,
                                protectedFiles: protectedDatabases(applicationSupport), fileManager: fileManager)
    }

    static func validateCache(cacheURL: URL, databaseURL: URL, fileManager: FileManager = .default) throws {
        let database = databaseURL.standardizedFileURL
        let supportRoot = database.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL
        let applicationSupport = supportRoot.deletingLastPathComponent().standardizedFileURL
        try validatePrivateFile(cacheURL, privateRoot: supportRoot, ancestorBoundary: applicationSupport,
                                protectedFiles: protectedDatabases(applicationSupport), fileManager: fileManager)
    }

    static func validatePrivateFile(_ fileURL: URL, privateRoot: URL, ancestorBoundary: URL,
                                    protectedFiles: [URL], fileManager: FileManager = .default) throws {
        let file = fileURL.standardizedFileURL
        let root = privateRoot.standardizedFileURL
        let boundary = ancestorBoundary.standardizedFileURL
        guard isStrictDescendant(file, of: root),
              isStrictDescendant(root, of: boundary) else { throw unsafe() }

        var candidate = file
        while candidate.path != boundary.path {
            let values = try? candidate.resourceValues(forKeys: [.isSymbolicLinkKey])
            if fileManager.fileExists(atPath: candidate.path) || values?.isSymbolicLink == true {
                guard values?.isSymbolicLink != true else { throw unsafe() }
            }
            let parent = candidate.deletingLastPathComponent()
            guard parent.path != candidate.path else { throw unsafe() }
            candidate = parent
        }

        guard fileManager.fileExists(atPath: file.path) else { return }
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw unsafe() }
        let isolated = try fileManager.attributesOfItem(atPath: file.path)
        for protected in protectedFiles where fileManager.fileExists(atPath: protected.path) {
            let production = try fileManager.attributesOfItem(atPath: protected.path)
            if sameFile(isolated, production) { throw unsafe() }
        }
    }

    static func isStrictDescendant(_ childURL: URL, of ancestorURL: URL) -> Bool {
        let child = childURL.standardizedFileURL.pathComponents
        let ancestor = ancestorURL.standardizedFileURL.pathComponents
        return child.count > ancestor.count && child.prefix(ancestor.count).elementsEqual(ancestor)
    }

    private static func protectedDatabases(_ applicationSupport: URL) -> [URL] {
        [
            applicationSupport.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite"),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"),
        ]
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
    let entityNames: [Int: String]
    let entityNamesByPrefix: [String: String]

    static func bundled() throws -> Self {
        let csv = try CTYResolver.bundledCSV()
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in csv.utf8 { hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211 }
        var prefixes: [Int: String] = [:], names: [Int: String] = [:], namesByPrefix: [String: String] = [:]
        for line in csv.split(whereSeparator: \.isNewline) {
            let columns = csvColumns(String(line))
            if columns.count >= 3, let adif = Int(columns[2]), prefixes[adif] == nil {
                let prefix = columns[0].uppercased()
                prefixes[adif] = prefix
                names[adif] = columns[1]
                namesByPrefix[prefix] = columns[1]
            }
        }
        return .init(resolver: try CTYResolver.bundled(), version: String(format: "bundled-cty-fnv64-%016llx", hash),
                     primaryPrefixes: prefixes, entityNames: names, entityNamesByPrefix: namesByPrefix)
    }

    func resolve(_ callsign: String, at date: Date) -> CountryInfo? { resolver.resolve(callsign, at: date) }
    func entity(_ country: CountryInfo) throws -> ContestEntitySnapshot {
        guard let prefix = primaryPrefixes[country.adif], !prefix.isEmpty else {
            throw ContestLaneError.confirmed("reference_unavailable", "Bundled CTY data has no canonical prefix for the resolved entity.")
        }
        return ContestEntitySnapshot(adif: country.adif, name: country.name, countryPrefix: prefix,
                                     continent: country.continent, cqZone: country.cqZone)
    }
    func displayLabel(_ key: ContestMultiplierKey) -> String {
        let scoped = key.scope == "contest" ? "" : " · \(key.scope)"
        switch key.kind {
        case "cq-zone": return "CQ zone \(key.value)\(scoped)"
        case "wpx-prefix": return "\(key.value) prefix\(scoped)"
        case "country":
            let name = Int(key.value).flatMap { entityNames[$0] } ?? "DXCC \(key.value)"
            return "\(name)\(scoped)"
        case "country-prefix", "naqp-dxcc":
            return "\(entityNamesByPrefix[key.value] ?? "DXCC \(key.value)")\(scoped)"
        case "scandinavian-call-area": return "\(key.value) call area\(scoped)"
        case "naqp-state":
            let name = ["AK": "Alaska", "HI": "Hawaii"][key.value] ?? "\(key.value) state"
            return "\(name)\(scoped)"
        case "naqp-province": return "\(key.value) province\(scoped)"
        default: return "\(key.kind) \(key.value)\(scoped)"
        }
    }
    func ruleWire(_ metadata: XContestCore.ContestRuleMetadata,
                  operatorCapability: ContestOperatorCapability?,
                  declarativeDefinition: ContestDeclarativeDefinition? = nil) throws -> [String: Any] {
        var result: [String: Any] = ["identity": Wire.ruleIdentityWire(metadata.identity), "displayName": metadata.displayName,
         "entryDescriptorVersion": metadata.entry.version.rawValue,
         "mode": metadata.entry.mode, "entry": Wire.entryWire(metadata.entry),
         "supportedBands": metadata.supportedBands.sorted(), "supportedModes": metadata.supportedModes.sorted(),
         "referenceDataVersion": version, "sourceVerification": "provisional", "sourceNote": metadata.sourceProvenance]
        if let operatorCapability { result["operatorCapability"] = Wire.operatorCapabilityWire(operatorCapability) }
        if let declarativeDefinition {
            result["declarativeDefinition"] = [
                "definitionDigest": declarativeDefinition.definitionDigest,
                "immutablePerSession": true,
                "exportPurpose": declarativeDefinition.draft.exportPolicy.rawValue,
                "submissionReady": false,
            ]
        }
        return result
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
    static func historySelectionContext(_ value: [String: Any]) throws -> ContestCallHistorySelectionContext {
        try exact(value, ["sessionID", "workspaceGeneration", "sessionRevision", "draftID",
                          "draftRevision", "inputCallsign", "requestID", "ruleIdentity",
                          "referenceDataVersion", "recordID"])
        let sessionRevision = try uint(value, "sessionRevision")
        let draftRevision = try uint(value, "draftRevision")
        guard sessionRevision <= UInt64(Int64.max), draftRevision <= UInt64(Int64.max) else {
            throw ContestLaneError.confirmed("invalid_params", "Call-history revisions exceed the supported range.")
        }
        return .init(sessionID: uuidString(try uuid(value, "sessionID")),
                     workspaceGeneration: try generation(try text(value, "workspaceGeneration", max: 36)),
                     sessionRevision: Int64(sessionRevision),
                     draftID: uuidString(try uuid(value, "draftID")),
                     draftRevision: Int64(draftRevision),
                     inputCallsign: try callsign(value, "inputCallsign"),
                     requestID: uuidString(try uuid(value, "requestID")),
                     ruleIdentity: try ruleIdentity(object(value, "ruleIdentity")),
                     referenceDataVersion: try text(value, "referenceDataVersion", max: 160))
    }

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
    static func bool(_ value: [String: Any], _ key: String) throws -> Bool {
        guard let number = value[key] as? NSNumber,
              ContestLane.isJSONBoolean(number) else {
            throw ContestLaneError.confirmed("invalid_params", "Contest boolean is invalid.")
        }
        return number.boolValue
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
    static func assistanceContext(_ value: [String: Any]) throws -> ContestAssistanceContext {
        .init(sessionID: uuidString(try uuid(value, "sessionID")),
              workspaceGeneration: try generation(try text(value, "workspaceGeneration", max: 36)),
              requestID: uuidString(try uuid(value, "requestID")))
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
    static func operatorCapabilityWire(_ value: ContestOperatorCapability) -> [String: Any] {
        var result: [String: Any] = ["version": value.version, "auditDigest": value.auditDigest, "policy": value.policy,
         "output": value.output, "styles": value.styles.map(\.rawValue),
         "macros": value.macros.map(\.rawValue)]
        if let profiles = value.signalProfiles {
            result["signalProfiles"] = profiles.map { ["mode": $0.mode, "signal": $0.signal.rawValue] }
        }
        return result
    }
    static func operatorReadinessWire(_ value: ContestOperatorReadiness) -> [String: Any] {
        ["capabilityDigest": value.capabilityDigest, "callsign": value.callsign.rawValue,
         "exchange": value.exchange.rawValue, "canSendCQ": value.canSendCQ,
         "canSendCall": value.canSendCall, "canSendDuplicate": value.canSendDuplicate,
         "canReserveCall": value.canReserveCall, "canReserveCommit": value.canReserveCommit,
         "canCommit": value.canCommit]
    }
    static func entryWire(_ value: ContestEntryDescriptor) -> [String: Any] {
        var exchange: [String: Any] = ["sent": value.exchange.sent.rawValue, "received": value.exchange.received.rawValue,
                      "sentDefault": value.exchange.sentDefault.rawValue, "adifFields": value.exchange.adifFields.rawValue]
        var result: [String: Any] = ["mode": value.mode, "adifMode": value.adifMode, "cabrilloQSOType": value.cabrilloQSOType,
         "cabrilloFormatterVersion": value.cabrilloFormatterVersion,
         "cabrilloProjectionFormatterVersion": value.cabrilloProjectionFormatterVersion,
         "report": ["format": value.report.format.rawValue, "defaultSent": value.report.defaultSent,
                    "defaultReceived": value.report.defaultReceived, "maximumUTF8Bytes": value.report.maximumUTF8Bytes],
         "exchange": exchange,
         "serial": ["requirement": value.serial.requirement.rawValue,
                    "allowedScopes": value.serial.allowedScopes.map(\.rawValue)]]
        if value.version == .v2 {
            exchange["sentFields"] = value.exchange.sentFields.map(exchangeFieldWire)
            exchange["receivedFields"] = value.exchange.receivedFields.map(exchangeFieldWire)
            result["exchange"] = exchange
            result["version"] = value.version.rawValue
            result["modeProfiles"] = value.modeProfiles.map {
                ["mode": $0.mode, "adifMode": $0.adifMode,
                 "adifSubmode": $0.adifSubmode as Any? ?? NSNull(), "cabrilloQSOType": $0.cabrilloQSOType,
                 "report": ["format": $0.report.format.rawValue, "defaultSent": $0.report.defaultSent,
                            "defaultReceived": $0.report.defaultReceived, "maximumUTF8Bytes": $0.report.maximumUTF8Bytes]]
            }
            result["scorePolicy"] = value.scorePolicy.rawValue
            if let resolved = value.stationResolvedSerial {
                result["stationResolvedSerial"] = [
                    "policy": resolved.policy.rawValue,
                    "locationFieldID": resolved.locationFieldID,
                    "allocatedSerialFieldID": resolved.allocatedSerialFieldID,
                    "allowedScopes": resolved.allowedScopes.map(\.rawValue),
                ]
            }
            if !value.stationFields.isEmpty {
                result["stationFields"] = value.stationFields.map {
                    ["id": $0.id, "label": $0.label, "role": $0.role.rawValue,
                     "required": $0.required, "maximumUTF8Bytes": $0.maximumUTF8Bytes]
                }
            }
        }
        return result
    }
    private static func exchangeFieldWire(_ value: ContestExchangeFieldDescriptor) -> [String: Any] {
        ["id": value.id, "label": value.label, "acceptedKinds": value.acceptedKinds.map(\.rawValue),
         "required": value.required, "maximumUTF8Bytes": value.maximumUTF8Bytes,
         "adifField": value.adifField?.rawValue as Any? ?? NSNull()]
    }
    static func stationFields(_ value: [String: Any],
                              descriptors: [ContestStationFieldDescriptor]) throws -> [String: String] {
        try exact(value, Set(descriptors.map(\.id)))
        var result: [String: String] = [:]
        for descriptor in descriptors {
            let raw = try text(value, descriptor.id, max: descriptor.maximumUTF8Bytes,
                               empty: !descriptor.required)
            guard raw.unicodeScalars.allSatisfy({ (65...90).contains($0.value) || (48...57).contains($0.value) }) else {
                throw ContestLaneError.confirmed("invalid_params", "Contest station field is invalid.")
            }
            result[descriptor.id] = raw
        }
        return result
    }
    static func resolvedSerialWire(_ value: ContestResolvedSerialRequirement) -> [String: Any] {
        ["requirement": value.requirement.rawValue,
         "allowedScopes": value.allowedScopes.map(\.rawValue),
         "allocatedFieldID": value.allocatedFieldID as Any? ?? NSNull()]
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
    static func exchangeFields(_ value: [String: Any], descriptors: [ContestExchangeFieldDescriptor],
                               allowIncomplete: Bool = false) throws -> [String: ContestExchangeFieldValue] {
        try exact(value, Set(descriptors.map(\.id)))
        var result: [String: ContestExchangeFieldValue] = [:]
        for descriptor in descriptors {
            let raw = try text(value, descriptor.id, max: descriptor.maximumUTF8Bytes,
                               empty: allowIncomplete || !descriptor.required)
            let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            if !allowIncomplete && descriptor.required && normalized.isEmpty {
                throw ContestLaneError.confirmed("invalid_params", "A required structured exchange field is empty.")
            }
            if !raw.isEmpty { result[descriptor.id] = .init(raw: raw, normalized: normalized) }
        }
        return result
    }
    static func exchangeFieldsWire(_ value: [String: ContestExchangeFieldValue],
                                   descriptors: [ContestExchangeFieldDescriptor]) -> [String: Any] {
        Dictionary(uniqueKeysWithValues: descriptors.map { ($0.id, value[$0.id]?.raw ?? "") })
    }
    static func aggregate(_ value: [String: ContestExchangeFieldValue], descriptors: [ContestExchangeFieldDescriptor]) -> String {
        descriptors.compactMap { value[$0.id]?.raw }.filter { !$0.isEmpty }.joined(separator: " ")
    }
    static func normalizedAggregate(_ value: [String: ContestExchangeFieldValue], descriptors: [ContestExchangeFieldDescriptor]) -> String {
        descriptors.compactMap { value[$0.id]?.normalized }.filter { !$0.isEmpty }.joined(separator: " ")
    }
    static func normalizedJIDXNumberFields(_ value: [String: ContestExchangeFieldValue]) -> [String: ContestExchangeFieldValue] {
        guard value.count == 1, let number = value["number"], let numeric = Int(number.raw) else { return value }
        return ["number": .init(raw: number.raw, normalized: String(format: "%02d", numeric))]
    }
    struct DraftFields {
        let callsign, sentReport, sentExchange, receivedReport, receivedExchange, band, mode: String
        let frequencyHz: Int64?
        let sentExchangeFields, receivedExchangeFields: [String: ContestExchangeFieldValue]
    }
    static func draftFields(_ value: [String: Any], metadata: ContestRuleMetadata,
                            normalizeJIDXNumbers: Bool = false,
                            projection: (([String: ContestExchangeFieldValue]) ->
                                [String: ContestExchangeFieldValue])? = nil) throws -> DraftFields {
        let entry = metadata.entry
        var keys: Set<String> = ["callsign", "sentReport", "sentExchange", "receivedReport", "receivedExchange", "frequencyHz", "band", "mode"]
        if entry.version == .v2 { keys.formUnion(["sentExchangeFields", "receivedExchangeFields"]) }
        try exact(value, keys)
        let call = try text(value, "callsign", max: 32, empty: true).uppercased()
        guard call.range(of: #"^[A-Z0-9/]*$"#, options: .regularExpression) != nil else {
            throw ContestLaneError.confirmed("invalid_params", "Contest callsign draft contains unsupported characters.")
        }
        let mode = try text(value, "mode", max: 8)
        guard metadata.supportedModes.contains(mode), let profile = entry.modeProfile(for: mode) else {
            throw ContestLaneError.confirmed("invalid_params", "Contest mode does not match the selected rule.")
        }
        let band = try text(value, "band", max: 8)
        guard metadata.supportedBands.contains(band) else { throw ContestLaneError.confirmed("invalid_params", "Contest band is invalid.") }
        let frequency: Int64?
        if value["frequencyHz"] is NSNull { frequency = nil }
        else { let number = try uint(value, "frequencyHz"); guard number <= 100_000_000_000 else { throw ContestLaneError.confirmed("invalid_params", "Contest frequency is invalid.") }; frequency = Int64(number) }
        let sentReport = try text(value, "sentReport", max: profile.report.maximumUTF8Bytes, empty: true)
        let receivedReport = try text(value, "receivedReport", max: profile.report.maximumUTF8Bytes, empty: true)
        var sentFields = entry.version == .v2 ? try exchangeFields(object(value, "sentExchangeFields"), descriptors: entry.exchange.sentFields, allowIncomplete: true) : [:]
        var receivedFields = entry.version == .v2 ? try exchangeFields(object(value, "receivedExchangeFields"), descriptors: entry.exchange.receivedFields, allowIncomplete: true) : [:]
        if normalizeJIDXNumbers {
            sentFields = normalizedJIDXNumberFields(sentFields)
            receivedFields = normalizedJIDXNumberFields(receivedFields)
        }
        if let projection {
            sentFields = projection(sentFields)
            receivedFields = projection(receivedFields)
        }
        let aggregateMaximum: ([ContestExchangeFieldDescriptor]) -> Int = { fields in
            fields.reduce(max(0, fields.count - 1)) { $0 + $1.maximumUTF8Bytes }
        }
        let rawSent = try text(value, "sentExchange",
                               max: entry.version == .v2 ? aggregateMaximum(entry.exchange.sentFields) : 64,
                               empty: true)
        let rawReceived = try text(value, "receivedExchange",
                                   max: entry.version == .v2 ? aggregateMaximum(entry.exchange.receivedFields) : 64,
                                   empty: true)
        if entry.version == .v2,
           (rawSent != aggregate(sentFields, descriptors: entry.exchange.sentFields) ||
            rawReceived != aggregate(receivedFields, descriptors: entry.exchange.receivedFields)) {
            throw ContestLaneError.confirmed("invalid_params", "Structured exchange aggregates do not match their fields.")
        }
        return .init(callsign: call, sentReport: sentReport, sentExchange: rawSent,
            receivedReport: receivedReport, receivedExchange: rawReceived, band: band, mode: mode,
            frequencyHz: frequency, sentExchangeFields: sentFields, receivedExchangeFields: receivedFields)
    }
}
