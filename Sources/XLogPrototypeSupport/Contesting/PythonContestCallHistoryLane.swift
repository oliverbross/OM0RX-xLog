import Foundation
import XContestCore

/// Authoritative Python-host coordinates used to fence call-history reads.
/// Python owns one revision for both its session and current draft.
struct PythonContestCallHistoryScope: Equatable, Sendable {
    let sessionID: String
    let workspaceGeneration: String
    let revision: Int64
    let draftID: String
    let callsign: String
    let ruleIdentity: ContestRuleIdentity
    let referenceDataVersion: String

    func selectionContext(requestID: String) -> ContestCallHistorySelectionContext {
        .init(sessionID: sessionID, workspaceGeneration: workspaceGeneration,
              sessionRevision: revision, draftID: draftID, draftRevision: revision,
              inputCallsign: callsign, requestID: requestID, ruleIdentity: ruleIdentity,
              referenceDataVersion: referenceDataVersion)
    }
}

/// Local call-history transport for the active Not1MM Python session.
/// It deliberately stops at selection: applying a projection requires the
/// legacy Swift contest repository's draft mutation owner.
actor PythonContestCallHistoryLane {
    typealias ActiveScope = @Sendable () async throws -> PythonContestCallHistoryScope
    typealias HostRequest = @Sendable (String, [String: Any]) async throws -> [String: Any]

    private static let wireBudget = 768 * 1_024
    private let service: ContestCallHistoryService
    private let activeScope: ActiveScope
    private let hostRequest: HostRequest?

    init(contestingRoot: URL, hostRequest: HostRequest? = nil,
         activeScope: @escaping ActiveScope) throws {
        let root = contestingRoot.standardizedFileURL
        let cacheURL = root.appendingPathComponent("CallHistory", isDirectory: true)
            .appendingPathComponent("current.json")
        let applicationRoot = root.deletingLastPathComponent()
        let applicationSupport = applicationRoot.deletingLastPathComponent()
        let protected = [
            applicationRoot.appendingPathComponent("OM0RX-xLog.sqlite"),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"),
        ]
        self.activeScope = activeScope
        self.hostRequest = hostRequest
        service = try ContestCallHistoryService(cacheURL: cacheURL, validatePrivateRoot: {
            try ContestDatabaseBoundary.validatePrivateFile(
                cacheURL, privateRoot: root, ancestorBoundary: applicationRoot,
                protectedFiles: protected)
        })
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        do {
            switch method {
            case "contest_history_status":
                try Self.exact(params, ["sessionID", "workspaceGeneration"])
                let scope = try await checkedScope(params)
                let status = await service.status()
                let activation = await activationWire(scope: scope)
                try await requireUnchanged(scope)
                return ["dataset": status.dataset.map(Self.datasetWire) ?? NSNull(),
                        "pendingPreview": status.pending.map(Self.previewWire) ?? NSNull(),
                        "unavailableReason": status.unavailableReason ?? NSNull(),
                        "activation": activation]
            case "contest_history_preview_private":
                try Self.exact(params, ["path", "sourceName", "sessionID", "workspaceGeneration"])
                let scope = try await checkedScope(params)
                let preview = try await service.previewFile(
                    path: try Self.text(params, "path", maximum: 4_096),
                    sourceName: try Self.text(params, "sourceName", maximum: 256),
                    importedAtUTC: Date(), workspaceGeneration: scope.workspaceGeneration)
                do { try await requireUnchanged(scope) }
                catch {
                    _ = try? await service.cancelImport(previewID: preview.previewID,
                        expectedSHA256: preview.preview.sha256,
                        workspaceGeneration: scope.workspaceGeneration)
                    throw error
                }
                return Self.previewWire(preview)
            case "contest_history_preview_page":
                try Self.exact(params, ["previewID", "sha256", "sessionID", "workspaceGeneration", "offset", "limit"])
                let scope = try await checkedScope(params)
                let page = try await service.diagnosticPage(
                    previewID: try Self.uuid(params, "previewID"),
                    expectedSHA256: try Self.digest(params, "sha256"),
                    workspaceGeneration: scope.workspaceGeneration,
                    offset: try Self.integer(params, "offset", range: 0...100_000),
                    limit: try Self.integer(params, "limit", range: 1...100))
                try await requireUnchanged(scope)
                return Self.diagnosticPageWire(page)
            case "contest_history_preview_cancel":
                try Self.exact(params, ["previewID", "sha256", "sessionID", "workspaceGeneration"])
                let scope = try await checkedScope(params)
                let cancelled = try await service.cancelImport(
                    previewID: try Self.uuid(params, "previewID"),
                    expectedSHA256: try Self.digest(params, "sha256"),
                    workspaceGeneration: scope.workspaceGeneration)
                try await requireUnchanged(scope)
                return ["cancelled": cancelled]
            case "contest_history_preview_commit":
                try Self.exact(params, ["previewID", "sha256", "sessionID", "workspaceGeneration", "confirmAdvisories"])
                let scope = try await checkedScope(params)
                let dataset = try await service.commitImport(
                    previewID: try Self.uuid(params, "previewID"),
                    expectedSHA256: try Self.digest(params, "sha256"),
                    confirmAdvisories: try Self.boolean(params, "confirmAdvisories"),
                    expectedWorkspaceGeneration: scope.workspaceGeneration)
                try await requireUnchanged(scope)
                return ["dataset": Self.datasetWire(dataset),
                        "activation": await activationWire(scope: scope)]
            case "contest_history_activate":
                try Self.exact(params, ["sessionID", "workspaceGeneration"])
                let scope = try await checkedScope(params)
                let activation = await activationWire(scope: scope)
                try await requireUnchanged(scope)
                return ["activation": activation]
            case "contest_history_query":
                let context = try await context(params, selecting: false)
                let recordOffset = try Self.integer(params, "recordOffset", range: 0...100_000)
                let recordLimit = try Self.integer(params, "recordLimit", range: 1...20)
                let valueOffset = try Self.integer(params, "valueOffset", range: 0...128)
                let valueLimit = try Self.integer(params, "valueLimit", range: 1...128)
                let view = try await service.queryView(callsign: context.inputCallsign, context: context)
                try await requireUnchanged(context)
                return try Self.queryWire(view, recordOffset: recordOffset, recordLimit: recordLimit,
                                          valueOffset: valueOffset, valueLimit: valueLimit)
            case "contest_history_query_cancel":
                let context = try await context(params, selecting: false, cancelling: true)
                let cancelled = await service.cancelQuery(context: context)
                try await requireUnchanged(context)
                return ["cancelled": cancelled]
            case "contest_history_select":
                let context = try await context(params, selecting: true)
                let selected = try await service.selectedView(
                    recordID: try Self.text(params, "recordID", maximum: 192),
                    expectedContext: context)
                try await requireUnchanged(context)
                return try Self.selectionWire(selected, context: context,
                                              valueOffset: try Self.integer(params, "valueOffset", range: 0...128),
                                              valueLimit: try Self.integer(params, "valueLimit", range: 1...128))
            case "contest_history_apply":
                throw ContestLaneError.confirmed(
                    "history_apply_unsupported",
                    "Call-history apply is unavailable because the active Python draft is not owned by the legacy Swift contest repository.")
            default:
                throw ContestLaneError.confirmed("unknown_method", "Unknown call-history method.")
            }
        } catch let error as ContestLaneError { throw error }
          catch let error as ContestCallHistoryServiceError { throw Self.map(error) }
          catch let error as ContestCallHistoryError { throw Self.map(error) }
    }

    func reconcileCurrent() async -> [String: Any]? {
        do {
            let scope = try await checkedScope()
            guard await service.activeDataset() != nil else { return nil }
            return await activationWire(scope: scope)
        } catch {
            return nil
        }
    }

    private func activationWire(scope: PythonContestCallHistoryScope) async -> [String: Any] {
        guard let dataset = await service.activeDataset() else {
            return ["state": "not_imported", "generation": NSNull(), "digest": NSNull(),
                    "rowCount": NSNull(), "message": NSNull()]
        }
        guard hostRequest != nil else {
            return ["state": "unavailable", "generation": dataset.info.generation,
                    "digest": dataset.info.sha256, "rowCount": dataset.info.recordCount,
                    "message": "The Python contest host is unavailable."]
        }
        do {
            try await synchronize(dataset, scope: scope)
            return ["state": "active", "generation": dataset.info.generation,
                    "digest": dataset.info.sha256, "rowCount": dataset.info.recordCount,
                    "message": NSNull()]
        } catch {
            return ["state": "failed", "generation": dataset.info.generation,
                    "digest": dataset.info.sha256, "rowCount": dataset.info.recordCount,
                    "message": Self.message(error)]
        }
    }

    private func synchronize(_ dataset: ContestCallHistoryDataset,
                             scope: PythonContestCallHistoryScope) async throws {
        guard let hostRequest else { throw Self.unavailable() }
        let base: [String: Any] = ["sessionID": scope.sessionID,
            "workspaceGeneration": scope.workspaceGeneration,
            "generation": dataset.info.generation, "digest": dataset.info.sha256]
        let status = try await hostRequest("contest_history_status", [
            "sessionID": scope.sessionID, "workspaceGeneration": scope.workspaceGeneration,
        ])
        if try Self.activationMatches(status["activation"], dataset.info) { return }
        _ = try await hostRequest("contest_history_stage_begin",
            base.merging(["rowCount": dataset.info.recordCount]) { _, new in new })
        do {
            guard !dataset.rows.isEmpty, dataset.rows.count == dataset.info.recordCount else {
                throw Self.unavailable()
            }
            var offset = 0
            while offset < dataset.rows.count {
                var chunk: [[String: Any]] = []
                while offset + chunk.count < dataset.rows.count && chunk.count < 256 {
                    let row = Self.hostRow(dataset.rows[offset + chunk.count], dataset: dataset)
                    let candidate = chunk + [row]
                    let params = base.merging(["offset": offset, "rows": candidate]) { _, new in new }
                    if try Self.hostRequestSize(method: "contest_history_stage_chunk", params: params)
                        > PrototypeWorker.maxRequestBytes {
                        guard !chunk.isEmpty else { throw Self.tooLarge("A call-history row exceeds the activation budget.") }
                        break
                    }
                    chunk = candidate
                }
                guard !chunk.isEmpty else { throw Self.tooLarge("A call-history activation chunk is empty.") }
                _ = try await hostRequest("contest_history_stage_chunk",
                    base.merging(["offset": offset, "rows": chunk]) { _, new in new })
                offset += chunk.count
                try await requireUnchanged(scope)
            }
            let result = try await hostRequest("contest_history_stage_commit",
                base.merging(["rowCount": dataset.info.recordCount]) { _, new in new })
            guard try Self.activationMatches(result["activation"], dataset.info) else {
                throw Self.unavailable()
            }
        } catch {
            _ = try? await hostRequest("contest_history_stage_cancel", base)
            throw error
        }
    }

    private static func activationMatches(_ value: Any?, _ dataset: ContestCallHistoryDatasetInfo) throws -> Bool {
        if value is NSNull || value == nil { return false }
        guard let result = value as? [String: Any], Set(result.keys) == Set(["generation", "digest", "rowCount"]),
              let generation = result["generation"] as? String,
              let digest = result["digest"] as? String,
              let rowCount = result["rowCount"] as? Int else { throw unavailable() }
        return generation == dataset.generation && digest == dataset.sha256 && rowCount == dataset.recordCount
    }

    private static func hostRow(_ row: ContestCallHistoryRow,
                                dataset: ContestCallHistoryDataset) -> [String: Any] {
        var result = Dictionary(uniqueKeysWithValues: hostColumns.map { ($0.0, "") })
        for (column, key) in hostColumns {
            // The sidecar retains the operator's exact source bytes. SQLite
            // receives the canonical index key expected by Not1MM's exact
            // CALLHISTORY lookup, including for padded or lowercase input.
            result[column] = key == .call
                ? row.normalizedCallsign ?? ""
                : dataset.value(in: row, for: key) ?? ""
        }
        return result
    }

    private static let hostColumns: [(String, ContestCallHistoryKnownKey)] = [
        ("Call", .call), ("Name", .name), ("Loc1", .loc1), ("Loc2", .loc2),
        ("Sect", .sect), ("State", .state), ("CK", .ck), ("BirthDate", .birthDate),
        ("Exch1", .exch1), ("Misc", .misc), ("Power", .power), ("CqZone", .cqZone),
        ("ITUZone", .ituZone), ("UserText", .userText), ("LastUpdateNote", .lastUpdateNote),
    ]

    private static func message(_ error: Error) -> String {
        let value = (error as? ContestLaneError)?.message
            ?? (error as? LocalizedError)?.errorDescription
            ?? error.localizedDescription
        return String(value.prefix(512))
    }

    private static func hostRequestSize(method: String, params: [String: Any]) throws -> Int {
        // Match PythonContestLane.perform exactly: a canonical UUID-sized id,
        // the method and params envelope, plus its terminating newline.
        let envelope: [String: Any] = [
            "id": "00000000-0000-0000-0000-000000000000",
            "method": method,
            "params": params,
        ]
        return try encodedSize(envelope) + 1
    }

    private static func unavailable() -> ContestLaneError {
        .confirmed("history_activation_failed", "The Python call-history activation was not confirmed.")
    }

    private func checkedScope(_ params: [String: Any]? = nil) async throws -> PythonContestCallHistoryScope {
        let scope = try await activeScope()
        try Self.validate(scope)
        if let params {
            guard try Self.uuid(params, "sessionID") == scope.sessionID,
                  try Self.uuid(params, "workspaceGeneration") == scope.workspaceGeneration else {
                throw Self.stale()
            }
        }
        return scope
    }

    private func context(_ params: [String: Any], selecting: Bool,
                         cancelling: Bool = false) async throws -> ContestCallHistorySelectionContext {
        var keys: Set<String> = ["sessionID", "workspaceGeneration", "expectedRevision", "draftID",
                                 "expectedDraftRevision", "requestID", "callsign", "ruleIdentity",
                                 "referenceDataVersion"]
        if !cancelling { keys.formUnion(["valueOffset", "valueLimit"]) }
        if selecting { keys.insert("recordID") }
        else if !cancelling { keys.formUnion(["recordOffset", "recordLimit"]) }
        try Self.exact(params, keys)
        let scope = try await checkedScope()
        let revision = try Self.revision(params, "expectedRevision")
        let draftRevision = try Self.revision(params, "expectedDraftRevision")
        let requestID = try Self.uuid(params, "requestID")
        let supplied = ContestCallHistorySelectionContext(
            sessionID: try Self.uuid(params, "sessionID"),
            workspaceGeneration: try Self.uuid(params, "workspaceGeneration"),
            sessionRevision: revision, draftID: try Self.uuid(params, "draftID"),
            draftRevision: draftRevision, inputCallsign: try Self.callsign(params, "callsign"),
            requestID: requestID, ruleIdentity: try Self.ruleIdentity(params),
            referenceDataVersion: try Self.text(params, "referenceDataVersion", maximum: 160))
        guard supplied == scope.selectionContext(requestID: requestID) else { throw Self.stale() }
        return supplied
    }

    private func requireUnchanged(_ scope: PythonContestCallHistoryScope) async throws {
        guard try await activeScope() == scope else { throw Self.stale() }
    }

    private func requireUnchanged(_ context: ContestCallHistorySelectionContext) async throws {
        let scope = try await checkedScope()
        guard scope.selectionContext(requestID: context.requestID) == context else { throw Self.stale() }
    }

    private static func validate(_ scope: PythonContestCallHistoryScope) throws {
        let requestID = UUID().uuidString.lowercased()
        let context = scope.selectionContext(requestID: requestID)
        guard canonicalUUID(scope.sessionID), canonicalUUID(scope.workspaceGeneration),
              canonicalUUID(scope.draftID), scope.revision >= 0,
              (scope.callsign.isEmpty || validCallsign(scope.callsign)), !scope.referenceDataVersion.isEmpty,
              scope.referenceDataVersion.utf8.count <= 160,
              context.requestID == requestID else { throw stale() }
    }

    private static func datasetWire(_ value: ContestCallHistoryDatasetInfo) -> [String: Any] {
        ["generation": value.generation, "sha256": value.sha256,
         "sourceName": value.provenance.sourceName, "importedAtUTC": iso(value.provenance.importedAtUTC),
         "byteCount": value.byteCount, "recordCount": value.recordCount,
         "indexableRecordCount": value.indexableRecordCount,
         "unindexableRecordCount": value.unindexableRecordCount,
         "duplicateCallCount": value.duplicateCallCount]
    }

    private static func previewWire(_ value: ContestCallHistoryPendingPreview) -> [String: Any] {
        let preview = value.preview
        return ["previewID": value.previewID, "sha256": preview.sha256,
                "expiresAtUTC": iso(value.expiresAtUTC),
                "activeDatasetGeneration": value.activeDatasetGeneration ?? NSNull(),
                "workspaceGeneration": value.workspaceGeneration ?? NSNull(),
                "sourceName": preview.provenance.sourceName, "byteCount": preview.sourceBytes.count,
                "recordCount": preview.rows.count, "duplicateCallCount": preview.duplicateCallCount,
                "indexableRecordCount": preview.rows.filter { $0.normalizedCallsign != nil }.count,
                "unindexableRecordCount": preview.rows.filter { $0.normalizedCallsign == nil }.count,
                "isCommittable": preview.isCommittable,
                "requiresAdvisoryConfirmation": preview.requiresAdvisoryConfirmation,
                "diagnosticCount": preview.diagnostics.count,
                "headers": preview.headers.map(headerWire)]
    }

    private static func diagnosticPageWire(_ value: ContestCallHistoryDiagnosticPage) -> [String: Any] {
        ["preview": previewWire(value.pending), "offset": value.offset, "limit": value.limit,
         "total": value.total, "diagnostics": value.diagnostics.map {
            ["severity": $0.severity.rawValue, "code": $0.code.rawValue,
             "line": $0.line as Any? ?? NSNull(), "detail": $0.detail]
         }]
    }

    private static func queryWire(_ view: ContestCallHistoryQueryView, recordOffset: Int,
                                  recordLimit: Int, valueOffset: Int,
                                  valueLimit: Int) throws -> [String: Any] {
        let result = view.result
        let upper = min(result.records.count, recordOffset + recordLimit)
        let records = recordOffset < upper ? Array(result.records[recordOffset..<upper]) : []
        var response: [String: Any] = [
            "context": contextWire(result.context), "normalizedCallsign": result.normalizedCallsign,
            "dataset": datasetWire(result.dataset), "totalRecords": result.records.count,
            "recordOffset": recordOffset, "recordLimit": recordLimit,
            "valueOffset": valueOffset, "valueLimit": valueLimit, "records": [], "next": NSNull(),
        ]
        var rows: [[String: Any]] = []
        for (recordIndex, record) in records.enumerated() {
            let start = recordIndex == 0 ? valueOffset : 0
            let end = min(view.headers.count, start + valueLimit)
            var cells: [[String: Any]] = []
            if start < end {
                for index in start..<end {
                    let cell = ["header": headerWire(view.headers[index]),
                                "value": record.values.indices.contains(index) ? record.values[index] : ""] as [String: Any]
                    var candidateCells = cells; candidateCells.append(cell)
                    var candidateRow = rowWire(record); candidateRow["values"] = candidateCells
                    var candidate = response; candidate["records"] = rows + [candidateRow]
                    candidate["next"] = ["recordOffset": recordOffset + recordIndex, "valueOffset": index + 1]
                    guard try encodedSize(candidate) < wireBudget else {
                        guard !cells.isEmpty || !rows.isEmpty else { throw tooLarge("A call-history value exceeds the response budget.") }
                        response["records"] = cells.isEmpty ? rows : rows + [rowWire(record).merging(["values": cells]) { _, new in new }]
                        response["next"] = ["recordOffset": recordOffset + recordIndex, "valueOffset": index]
                        guard try encodedSize(response) < wireBudget else { throw tooLarge("The call-history page exceeds the response budget.") }
                        return response
                    }
                    cells = candidateCells
                }
            }
            var encoded = rowWire(record); encoded["values"] = cells; rows.append(encoded)
            if end < view.headers.count {
                response["records"] = rows
                response["next"] = ["recordOffset": recordOffset + recordIndex, "valueOffset": end]
                return response
            }
        }
        response["records"] = rows
        if upper < result.records.count { response["next"] = ["recordOffset": upper, "valueOffset": 0] }
        guard try encodedSize(response) < wireBudget else { throw tooLarge("The call-history page exceeds the response budget.") }
        return response
    }

    private static func selectionWire(_ view: ContestCallHistorySelectedView,
                                      context: ContestCallHistorySelectionContext,
                                      valueOffset: Int, valueLimit: Int) throws -> [String: Any] {
        let upper = min(view.headers.count, valueOffset + valueLimit)
        var record = rowWire(view.row)
        let cells = valueOffset < upper ? (valueOffset..<upper).map { index in
            ["header": headerWire(view.headers[index]),
             "value": view.row.values.indices.contains(index) ? view.row.values[index] : ""] as [String: Any]
        } : []
        record["values"] = cells
        let response: [String: Any] = [
            "context": contextWire(context), "dataset": datasetWire(view.dataset), "record": record,
            "valueOffset": valueOffset, "valueLimit": valueLimit,
            "nextValueOffset": upper < view.headers.count ? upper : NSNull(),
            // No proposal is safe until the Python draft owner exposes a revision-fenced apply operation.
            "projections": [],
        ]
        guard try encodedSize(response) < wireBudget else { throw tooLarge("The selected call-history page exceeds the response budget.") }
        return response
    }

    private static func headerWire(_ value: ContestCallHistoryHeader) -> [String: Any] {
        ["originalName": value.originalName, "canonicalName": value.canonicalName,
         "knownKey": value.knownKey?.rawValue ?? NSNull()]
    }

    private static func rowWire(_ value: ContestCallHistoryRow) -> [String: Any] {
        ["recordID": value.recordID, "sourceOrdinal": value.sourceOrdinal, "sourceLine": value.sourceLine,
         "normalizedCallsign": value.normalizedCallsign ?? NSNull(),
         "indexingIssue": value.indexingIssue?.rawValue ?? NSNull()]
    }

    private static func contextWire(_ value: ContestCallHistorySelectionContext) -> [String: Any] {
        ["sessionID": value.sessionID, "workspaceGeneration": value.workspaceGeneration,
         "sessionRevision": value.sessionRevision, "draftID": value.draftID,
         "draftRevision": value.draftRevision, "inputCallsign": value.inputCallsign,
         "requestID": value.requestID, "ruleIdentity": identityWire(value.ruleIdentity),
         "referenceDataVersion": value.referenceDataVersion]
    }

    private static func identityWire(_ value: ContestRuleIdentity) -> [String: Any] {
        ["id": value.id, "version": value.version, "edition": value.edition,
         "sourceRevision": value.sourceRevision]
    }

    private static func ruleIdentity(_ params: [String: Any]) throws -> ContestRuleIdentity {
        guard let value = params["ruleIdentity"] as? [String: Any] else { throw invalid() }
        try exact(value, ["id", "version", "edition", "sourceRevision"])
        return .init(id: try text(value, "id", maximum: 128),
                     version: try text(value, "version", maximum: 128),
                     edition: try text(value, "edition", maximum: 128),
                     sourceRevision: try text(value, "sourceRevision", maximum: 160))
    }

    private static func exact(_ params: [String: Any], _ keys: Set<String>) throws {
        guard Set(params.keys) == keys else { throw invalid() }
    }

    private static func text(_ params: [String: Any], _ key: String, maximum: Int) throws -> String {
        guard let value = params[key] as? String, !value.isEmpty, value.utf8.count <= maximum,
              !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { throw invalid() }
        return value
    }

    private static func uuid(_ params: [String: Any], _ key: String) throws -> String {
        let value = try text(params, key, maximum: 36)
        guard canonicalUUID(value) else { throw invalid() }
        return value
    }

    private static func digest(_ params: [String: Any], _ key: String) throws -> String {
        let value = try text(params, key, maximum: 64)
        guard value.count == 64, value.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { throw invalid() }
        return value
    }

    private static func callsign(_ params: [String: Any], _ key: String) throws -> String {
        let value = try text(params, key, maximum: 32).uppercased()
        guard validCallsign(value) else { throw invalid() }
        return value
    }

    private static func revision(_ params: [String: Any], _ key: String) throws -> Int64 {
        let value = try integer(params, key, range: 0...9_007_199_254_740_991)
        return Int64(value)
    }

    private static func integer(_ params: [String: Any], _ key: String,
                                range: ClosedRange<Int>) throws -> Int {
        guard let number = params[key] as? NSNumber,
              String(cString: number.objCType) != "c", number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(range.lowerBound),
              number.doubleValue <= Double(range.upperBound) else { throw invalid() }
        return number.intValue
    }

    private static func boolean(_ params: [String: Any], _ key: String) throws -> Bool {
        guard let value = params[key] as? Bool else { throw invalid() }
        return value
    }

    private static func canonicalUUID(_ value: String) -> Bool {
        UUID(uuidString: value)?.uuidString.lowercased() == value
    }

    private static func validCallsign(_ value: String) -> Bool {
        value.range(of: #"^[A-Z0-9]+(?:/[A-Z0-9]+)*$"#, options: .regularExpression) != nil &&
            value.contains(where: \.isLetter) && value.contains(where: \.isNumber)
    }

    private static func iso(_ value: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: value)
    }

    private static func encodedSize(_ value: [String: Any]) throws -> Int {
        try JSONSerialization.data(withJSONObject: value).count
    }

    private static func invalid() -> ContestLaneError {
        .confirmed("invalid_params", "The call-history request is invalid.")
    }

    private static func stale() -> ContestLaneError {
        .confirmed("stale_history_context", "The call-history request does not match the active Python contest draft.")
    }

    private static func tooLarge(_ message: String) -> ContestLaneError {
        .confirmed("response_too_large", message)
    }

    private static func map(_ error: ContestCallHistoryServiceError) -> ContestLaneError {
        switch error {
        case .invalidCache, .dataUnavailable: return .confirmed("history_unavailable", "Import a call-history file before querying it.")
        case .invalidImport, .envelopeTooLarge: return .confirmed("history_import_failed", "The selected call-history file could not be imported safely.")
        case .unknownPreview, .expiredPreview: return .confirmed("history_preview_unavailable", "The call-history preview is missing or expired.")
        case .digestMismatch, .staleGeneration: return .confirmed("stale_history_preview", "The call-history preview no longer matches the active Python workspace.")
        case .previewNotCommittable: return .confirmed("history_preview_blocked", "The call-history preview contains blocking issues.")
        case .advisoryConfirmationRequired: return .confirmed("history_confirmation_required", "Confirm the call-history advisory issues before import.")
        case .invalidPage: return invalid()
        case .resultUnavailable: return .confirmed("history_selection_unavailable", "The call-history query result is no longer available.")
        }
    }

    private static func map(_ error: ContestCallHistoryError) -> ContestLaneError {
        switch error {
        case .invalidQuery, .invalidContext, .invalidGeneration:
            return .confirmed("invalid_history_query", "The call-history query is invalid.")
        case .staleContext: return stale()
        case .unknownRecord: return .confirmed("history_selection_unavailable", "The selected call-history record is unavailable.")
        case .previewNotCommittable: return .confirmed("history_preview_blocked", "The call-history preview contains blocking issues.")
        }
    }
}
