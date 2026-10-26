import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct SyncHeldContactGroup: Equatable, Sendable {
    public let identity: String
    public let remoteIDs: [Int]
    public let differingFields: [String]
    public let valueShapes: [String]

    public init(identity: String, remoteIDs: [Int], differingFields: [String], valueShapes: [String]) {
        self.identity = identity
        self.remoteIDs = remoteIDs
        self.differingFields = differingFields
        self.valueShapes = valueShapes
    }
}

public struct SyncLocalChanges: Equatable, Sendable {
    public var inserted = 0
    public var updated = 0
    public var markedDeleted = 0
    public var baselineRepairs = 0
    public init() {}
}

public struct SyncReport: Equatable, Sendable {
    public init() {}
    public var pushed = 0
    public var pulled = 0
    public var deleted = 0
    public var conflicts = 0
    public var failed = 0
    public var held = 0
    public var heldGroups: [SyncHeldContactGroup] = []
    /// Present only when the complete reconciliation returned committed totals.
    public var localChanges: SyncLocalChanges?
}

/// Operational evidence only: no contact identities, destinations or credentials.
public struct SyncRunReceipt: Codable, Equatable, Sendable {
    public let id: UUID
    public let startedAt: Date
    public let automatic: Bool
    public var finishedAt: Date?
    public var outcome: String = "running"
    public var reportCounts: [String: Int]?
    public var safeErrorCode: String?
    public var uploadTracking = false
    public var uploadAttempts = 0
    public var confirmedCreates = 0
    public var confirmedUpdates = 0
    public var confirmedDeletes = 0

    public init(automatic: Bool, startedAt: Date = Date()) {
        id = UUID(); self.automatic = automatic; self.startedAt = startedAt
    }
}

public struct RemoteHistoryPreview: Sendable {
    public let qsos: [QSO]
    public let remoteIDs: Set<Int>
    public let heldRemoteIDs: Set<Int>
    public let heldIdentities: Set<String>
    public let heldRemoteIDsByIdentity: [String: [Int]]
    public let heldDifferencesByIdentity: [String: [String]]
    public let heldValueShapesByIdentity: [String: [String]]
}

private enum HistoryJoinError: Error { case ambiguous }

private func historyIdentity(_ qso: QSO) -> String {
    let mode = qso.submode.isEmpty ? qso.mode : qso.submode
    return "\(qso.call)|\(Int(qso.start.timeIntervalSince1970.rounded()))|\(qso.band)|\(mode)|\(qso.frequencyHz ?? 0)"
}

public actor SyncEngine {
    private let database: LogbookDatabase
    private let client: WavelogClient
    private let validateRun: @Sendable () throws -> Void
    private let receiptID: UUID?
    // Internal rendezvous permits deterministic scheduling tests without IPC.
    var betweenReconciliationSteps: @Sendable () async throws -> Void = { await Task.yield() }
    func setReconciliationStepObserver(_ observer: @escaping @Sendable () async throws -> Void) {
        betweenReconciliationSteps = observer
    }

    public init(database: LogbookDatabase, configuration: WavelogConfiguration, session: URLSession = .shared,
                validateRun: @escaping @Sendable () throws -> Void = {}, receiptID: UUID? = nil) {
        self.database = database
        self.client = WavelogClient(configuration: configuration, session: session)
        self.validateRun = validateRun
        self.receiptID = receiptID
    }

    /// Validates the same complete remote snapshot used by synchronization,
    /// without opening or mutating a local database or issuing remote writes.
    public static func previewRemoteHistory(configuration: WavelogConfiguration, session: URLSession = .shared) async throws -> RemoteHistoryPreview {
        try await readRemoteHistory(client: WavelogClient(configuration: configuration, session: session))
    }

    private static func readRemoteHistory(client: WavelogClient) async throws -> RemoteHistoryPreview {
        try Task.checkCancellation()
        var remoteIDs: Set<Int> = []
        var jsonRows: [WavelogQSO] = []
        var jsonByIdentity: [String: [WavelogQSO]] = [:]
        var adifRows: [QSO] = []
        var adifPageEnds: [(count: Int, lastID: Int?)] = []
        var adifByIdentity: [String: [QSO]] = [:]

        func hasStableMetadata(_ page: WavelogQSOPage, matching baseline: WavelogListMeta) -> Bool {
            page.meta.total == baseline.total &&
                page.meta.totalPages == baseline.totalPages &&
                page.meta.perPage == baseline.perPage &&
                page.meta.count == page.data.count
        }

        func hasStableMetadata(_ page: WavelogADIFPage, matching baseline: WavelogListMeta) -> Bool {
            page.meta.total == baseline.total &&
                page.meta.totalPages == baseline.totalPages &&
                page.meta.perPage == baseline.perPage &&
                page.meta.count == page.data.exported
        }

        func index(_ page: WavelogQSOPage) {
            remoteIDs.formUnion(page.data.map(\.id))
            jsonRows += page.data
            for remote in page.data {
                guard let qso = QSO(wavelog: remote) else { continue }
                jsonByIdentity[historyIdentity(qso), default: []].append(remote)
            }
        }

        func stage(_ page: WavelogADIFPage) throws {
            try Task.checkCancellation()
            let records = ADIFParser().records(in: page.data.adif)
            guard records.count == page.meta.count else {
                throw WavelogClientError.invalidData(
                    "ADIF page \(page.meta.page) declared \(page.meta.count) records but contained \(records.count)."
                )
            }
            for record in records {
                guard let qso = QSO(adif: record) else {
                    throw WavelogClientError.invalidData("ADIF page \(page.meta.page) contained an unreadable QSO.")
                }
                adifRows.append(qso)
                adifByIdentity[historyIdentity(qso), default: []].append(qso)
            }
            adifPageEnds.append((adifRows.count, page.data.lastFetchedID))
        }

        let firstPage = try await client.listQSOs(page: 1, perPage: 5_000)
        guard firstPage.meta.page == 1,
              firstPage.meta.count == firstPage.data.count else {
            throw WavelogClientError.invalidResponse
        }
        let baselineMeta = firstPage.meta
        let baselineFirstPageIDs = firstPage.data.map(\.id)
        index(firstPage)
        if firstPage.meta.hasMore {
            guard !firstPage.data.isEmpty, firstPage.meta.totalPages > 1 else {
                throw WavelogClientError.invalidResponse
            }
            // Wavelog installations commonly cap responses below the requested
            // page size. Four in-flight reads keep large initial imports fast
            // without turning synchronization into an aggressive API client.
            let pageSize = max(1, firstPage.meta.perPage)
            var nextPage = 2
            while nextPage <= firstPage.meta.totalPages {
                try Task.checkCancellation()
                let lastPage = min(firstPage.meta.totalPages, nextPage + 3)
                let pages = try await withThrowingTaskGroup(of: WavelogQSOPage.self) { group in
                    for pageNumber in nextPage...lastPage {
                        group.addTask {
                            try await client.listQSOs(page: pageNumber, perPage: pageSize)
                        }
                    }
                    var fetched: [WavelogQSOPage] = []
                    for try await page in group { fetched.append(page) }
                    return fetched.sorted { $0.meta.page < $1.meta.page }
                }
                for page in pages {
                    guard hasStableMetadata(page, matching: baselineMeta),
                          !page.data.isEmpty || page.meta.page == page.meta.totalPages else {
                        throw WavelogClientError.invalidResponse
                    }
                    index(page)
                }
                nextPage = lastPage + 1
            }
        }

        let convertibleJSONCount = jsonByIdentity.values.reduce(0) { $0 + $1.count }
        let firstADIFPage = try await client.exportADIF(page: 1, perPage: 1_000)
        guard firstADIFPage.meta.page == 1,
              firstADIFPage.meta.total == baselineMeta.total,
              firstADIFPage.meta.count == firstADIFPage.data.exported else {
            throw WavelogClientError.invalidResponse
        }
        let adifBaselineMeta = firstADIFPage.meta
        var adifRecordCount = firstADIFPage.meta.count
        try stage(firstADIFPage)
        if firstADIFPage.meta.hasMore {
            let pageSize = max(1, firstADIFPage.meta.perPage)
            var nextPage = 2
            while nextPage <= firstADIFPage.meta.totalPages {
                try Task.checkCancellation()
                let lastPage = min(firstADIFPage.meta.totalPages, nextPage + 3)
                let pages = try await withThrowingTaskGroup(of: WavelogADIFPage.self) { group in
                    for pageNumber in nextPage...lastPage {
                        group.addTask { try await client.exportADIF(page: pageNumber, perPage: pageSize) }
                    }
                    var fetched: [WavelogADIFPage] = []
                    for try await page in group { fetched.append(page) }
                    return fetched.sorted { $0.meta.page < $1.meta.page }
                }
                for page in pages {
                    guard hasStableMetadata(page, matching: adifBaselineMeta),
                          !page.data.adif.isEmpty || page.meta.page == page.meta.totalPages else {
                        throw WavelogClientError.invalidResponse
                    }
                    adifRecordCount += page.meta.count
                    try stage(page)
                }
                nextPage = lastPage + 1
            }
        }

        // Both endpoints paginate independently. Prefer the documented ADIF
        // primary-key order only when every page boundary proves it; otherwise
        // resolve complete identity groups without inferring row identity.
        var remoteQSOs: [QSO] = []
        var heldRemoteIDs: Set<Int> = []
        var heldIdentities: Set<String> = []
        var heldRemoteIDsByIdentity: [String: [Int]] = [:]
        var heldDifferencesByIdentity: [String: [String]] = [:]
        var heldValueShapesByIdentity: [String: [String]] = [:]
        var unmatchedADIFCount = 0
        let orderedJSON = jsonRows.sorted { $0.id < $1.id }
        let orderedPageEndsMatch = adifPageEnds.allSatisfy { boundary in
            guard boundary.count > 0 else { return boundary.lastID == nil }
            return boundary.count <= orderedJSON.count && boundary.lastID == orderedJSON[boundary.count - 1].id
        }
        if let joined = try joinedDocumentedADIFOrder(adifRows, with: orderedJSON, pageEndsMatch: orderedPageEndsMatch) {
            // API v2 documents ADIF rows as ascending by primary key. Matching
            // every page boundary and every semantic identity lets us retain
            // the exact remote ID even when confirmation-only ADIF fields make
            // otherwise identical contacts impossible to distinguish by value.
            remoteQSOs = joined
            jsonByIdentity.removeAll()
        } else {
            for (key, rows) in adifByIdentity {
                try Task.checkCancellation()
                guard let candidates = jsonByIdentity.removeValue(forKey: key) else {
                    unmatchedADIFCount += rows.count
                    continue
                }
                do {
                    remoteQSOs += try joinedADIF(rows, with: candidates)
                } catch HistoryJoinError.ambiguous {
                    // Hold the entire identity group, including any partially
                    // resolved members. Never assign an arbitrary ID or overwrite
                    // its local baseline; unrelated contacts can still sync.
                    heldRemoteIDs.formUnion(candidates.map(\.id))
                    heldIdentities.insert(key)
                    heldRemoteIDsByIdentity[key] = candidates.map(\.id).sorted()
                    heldDifferencesByIdentity[key] = Set(rows.flatMap { row in
                        candidates.flatMap { incompatibleADIFFields(row, with: $0) }
                    }).union(varyingADIFFields(rows)).sorted()
                    heldValueShapesByIdentity[key] = varyingADIFFields(rows).sorted().map { field in
                        let values = rows.map { $0.extraFields[field] ?? "" }
                        let populated = Set(values.filter { !$0.isEmpty })
                        let shape = populated.count > 1 ? "conflicting populated values" : populated.isEmpty ? "empty representations" : "empty and populated"
                        return "\(field): \(shape)"
                    }
                }
            }
        }
        let unmatchedJSONCount = jsonByIdentity.values.reduce(0) { $0 + $1.count }
        guard adifRecordCount == baselineMeta.total,
              remoteQSOs.count + heldRemoteIDs.count == convertibleJSONCount,
              unmatchedJSONCount == 0,
              unmatchedADIFCount == baselineMeta.total - convertibleJSONCount else {
            throw WavelogClientError.invalidData(
                "JSON and ADIF histories did not produce the same set of identifiable QSOs."
            )
        }

        // Offset pagination can shift if a QSO is created or removed while a
        // full scan is running. Never infer deletions from a hybrid snapshot:
        // require consistent metadata, complete unique-ID coverage and an
        // unchanged first page before tombstoning anything or pushing writes.
        let verificationPage = try await client.listQSOs(page: 1, perPage: baselineMeta.perPage)
        guard hasStableMetadata(verificationPage, matching: baselineMeta),
              verificationPage.meta.page == 1,
              verificationPage.data.map(\.id) == baselineFirstPageIDs,
              remoteIDs.count == baselineMeta.total else {
            throw WavelogClientError.invalidResponse
        }
        try Task.checkCancellation()
        return RemoteHistoryPreview(qsos: remoteQSOs, remoteIDs: remoteIDs,
                                    heldRemoteIDs: heldRemoteIDs, heldIdentities: heldIdentities,
                                    heldRemoteIDsByIdentity: heldRemoteIDsByIdentity,
                                    heldDifferencesByIdentity: heldDifferencesByIdentity,
                                    heldValueShapesByIdentity: heldValueShapesByIdentity)
    }

    public func synchronize() async throws -> SyncReport {
        try validateSyncRun()
        if let receiptID { try database.trackSyncRunUploads(receiptID) }
        let run = try database.beginSyncReconciliation()
        defer { database.endSyncReconciliation(run) }
        var report = SyncReport()
        var localChanges = SyncLocalChanges()
        let initialUpperRowID = try database.syncUpperRowID(run: run)
        var linkedCursor: Int64 = 0
        var linked: [QSO] = []
        let due = Date()
        while linked.count < 500 {
            try validateSyncRun()
            let step = try database.pendingSyncStep(after: linkedCursor, through: initialUpperRowID, due: due, run: run)
            linkedCursor = step.cursor
            linked.append(contentsOf: step.rows.filter { $0.wavelogID != nil && $0.deletedAt == nil }
                .prefix(500 - linked.count))
            if step.done { break }
        }
        for candidate in linked {
            try validateSyncRun()
            guard let remoteID = candidate.wavelogID else { continue }
            let remote: QSO
            do {
                try validateForNetwork(run)
                let response = try await client.getQSO(id: remoteID)
                guard let decoded = QSO(wavelog: response) else {
                    throw WavelogClientError.invalidData("The linked Wavelog QSO could not be decoded.")
                }
                remote = decoded
            } catch {
                // This bounded item read is an optimization, not the
                // authoritative snapshot. A missing/unsupported/transient
                // item response falls back to the complete reconciliation
                // without consuming an upload attempt or adding backoff.
                try validateForNetwork(run)
                continue
            }
            guard let current = try database.preflightLinkedUpdate(remote: remote, localID: candidate.id, run: run) else {
                continue
            }
            do {
                let startChanged = current.start != remote.start
                if current.end != nil && !startChanged {
                    // The item JSON does not expose TIME_OFF. Let the complete
                    // JSON/ADIF join decide whether an end-bearing QSO needs a
                    // patch rather than silently treating an unknown end as nil.
                    continue
                }
                var comparison = remote
                // A missing end in the item representation is unknown, not a
                // provider-side clear. Only the start delta can authorize a
                // timing patch on this bounded path.
                comparison.end = current.end
                try validateWavelogTimingUpdate(current, comparedTo: comparison)
                let fields = WavelogQSOUpdate(current, comparedTo: comparison)
                if !fields.isEmpty {
                    try validateForNetwork(run)
                    try uploadAttempt(run: run)
                    let updated = try await client.updateQSO(id: remoteID, fields: fields)
                    try await verifyUpdate(fields, response: updated, id: remoteID, run: run)
                    try uploadConfirmed("update")
                }
                try validateSyncRun()
                try database.withSyncDatabaseLock(run) { try database.acknowledgeSynced(current) }
                report.pushed += 1
            } catch {
                // A cancellation, workspace replacement, or database close
                // after the provider response must fence the late
                // acknowledgement instead of being converted into backoff.
                try validateForNetwork(run)
                try database.withSyncDatabaseLock(run) {
                    try database.recordSyncFailure(localID: candidate.id, message: error.localizedDescription)
                }
                report.failed += 1
            }
        }
        let snapshot = try await Self.readRemoteHistory(client: client)
        let remoteQSOs = snapshot.qsos
        let remoteByID = remoteQSOs.reduce(into: [Int: QSO]()) { result, qso in
            if let remoteID = qso.wavelogID { result[remoteID] = qso }
        }
        let remoteIDs = snapshot.remoteIDs
        let protectedIDs = snapshot.heldRemoteIDs
        let protectedIdentities = snapshot.heldIdentities
        report.held = snapshot.heldRemoteIDs.count
        report.heldGroups = snapshot.heldIdentities.sorted().map { identity in
            SyncHeldContactGroup(
                identity: identity,
                remoteIDs: snapshot.heldRemoteIDsByIdentity[identity, default: []],
                differingFields: snapshot.heldDifferencesByIdentity[identity, default: []],
                valueShapes: snapshot.heldValueShapesByIdentity[identity, default: []]
            )
        }
        func held(_ qso: QSO) -> Bool {
            qso.wavelogID.map(protectedIDs.contains) == true || protectedIdentities.contains(historyIdentity(qso))
        }
        for offset in stride(from: 0, to: remoteQSOs.count, by: 128) {
            try validateSyncRun()
            let step = try database.mergeRemoteSyncStepCounts(remoteQSOs[offset..<min(offset + 128, remoteQSOs.count)],
                                                             run: run, preservingLocal: held)
            report.conflicts += step.conflicts
            localChanges.inserted += step.localChanges.inserted
            localChanges.updated += step.localChanges.updated
            localChanges.baselineRepairs += step.localChanges.baselineRepairs
            try await betweenReconciliationSteps()
        }
        report.pulled += remoteQSOs.count
        try validateSyncRun()
        let upperRowID = try database.syncUpperRowID(run: run)
        var deletionCursor: Int64 = 0
        while true {
            try validateSyncRun()
            let step = try database.reconcileRemoteDeletionStep(notIn: remoteIDs, after: deletionCursor,
                                                                through: upperRowID, run: run)
            report.conflicts += step.conflicts; report.deleted += step.deleted
            localChanges.markedDeleted += step.deleted
            deletionCursor = step.cursor
            try await betweenReconciliationSteps()
            if step.done { break }
        }

        // Retain oldest-update order and the accepted-row cap, while held or
        // deferred contacts cannot force one all-history locked JSON decode.
        var pending: [QSO] = []
        var pendingCursor: Int64 = 0
        var seen = Set<UUID>()
        while true {
            try validateSyncRun()
            let step = try database.pendingSyncStep(after: pendingCursor, through: upperRowID, due: due, run: run)
            pendingCursor = step.cursor
            for qso in step.rows where seen.insert(qso.id).inserted && !held(qso) {
                pending.append(qso)
            }
            pending.sort {
                $0.updatedAt == $1.updatedAt ? $0.id.uuidString < $1.id.uuidString : $0.updatedAt < $1.updatedAt
            }
            if pending.count > 500 { pending.removeLast(pending.count - 500) }
            try await betweenReconciliationSteps()
            if step.done { break }
        }

        for candidate in pending {
            try validateSyncRun()
            guard let qso = try database.withSyncDatabaseLock(run, { try database.lookup(localID: candidate.id) }),
                  qso.isDirty else { continue }
            // Preserve both pending edits/deletes of held IDs and unlinked
            // local contacts which could otherwise create another duplicate.
            if held(qso) { continue }
            if try database.withSyncDatabaseLock(run, { try database.hasConflict(localID: qso.id) }) { continue }
            do {
                if qso.deletedAt != nil {
                    // A prior delete may have succeeded before its response was
                    // lost. The verified complete scan already proves absence.
                    if let remoteID = qso.wavelogID, remoteIDs.contains(remoteID) {
                        try validateForNetwork(run)
                        try uploadAttempt(run: run)
                        try await client.deleteQSO(id: remoteID)
                        try uploadConfirmed("delete")
                        report.deleted += 1
                    }
                    try validateSyncRun()
                    try database.withSyncDatabaseLock(run) { try database.acknowledgeSynced(qso) }
                    continue
                }
                if let remoteID = qso.wavelogID {
                    guard let previous = remoteByID[remoteID] else {
                        throw WavelogClientError.invalidData("The linked Wavelog QSO was not present in the verified remote snapshot.")
                    }
                    try validateWavelogTimingUpdate(qso, comparedTo: previous)
                    let fields = WavelogQSOUpdate(qso, comparedTo: previous)
                    if !fields.isEmpty {
                        try validateForNetwork(run)
                        try uploadAttempt(run: run)
                        let remote = try await client.updateQSO(id: remoteID, fields: fields)
                        try await verifyUpdate(fields, response: remote, id: remoteID, run: run)
                        try uploadConfirmed("update")
                    }
                    try validateSyncRun()
                    try database.withSyncDatabaseLock(run) { try database.acknowledgeSynced(qso) }
                } else {
                    guard let create = WavelogQSOCreate(adif: qso.adifRecord) else {
                        try validateSyncRun()
                        try database.withSyncDatabaseLock(run) { try database.recordSyncFailure(localID: qso.id, message: "This QSO cannot be converted to a valid Wavelog request.") }
                        report.failed += 1
                        continue
                    }
                    try validateForNetwork(run)
                    try uploadAttempt(run: run)
                    let remote = try await client.createQSO(create)
                    guard remote.representsSupportedCreate(of: qso) else {
                        throw WavelogClientError.writeVerificationFailed(id: remote.id)
                    }
                    try uploadConfirmed("create")
                    try validateSyncRun()
                    try database.withSyncDatabaseLock(run) { try database.acknowledgeSynced(qso, wavelogID: remote.id) }
                }
                report.pushed += 1
            } catch {
                try validateSyncRun()
                try database.withSyncDatabaseLock(run) { try database.recordSyncFailure(localID: qso.id, message: error.localizedDescription) }
                report.failed += 1
            }
        }

        report.localChanges = localChanges
        return report
    }

    private func uploadAttempt(run: SyncDatabaseRun) throws {
        if let receiptID { try database.recordSyncRunUpload(receiptID, confirmed: nil) }
        // Journal I/O may yield to a foreground workspace change or cancellation.
        // Revalidate before crossing the network boundary after that write.
        try validateForNetwork(run)
    }

    private func uploadConfirmed(_ kind: String) throws {
        if let receiptID { try database.recordSyncRunUpload(receiptID, confirmed: kind) }
    }

    private func verifyUpdate(_ fields: WavelogQSOUpdate, response: WavelogQSO,
                              id: Int, run: SyncDatabaseRun) async throws {
        guard id > 0, response.id == id else { throw WavelogClientError.writeVerificationFailed(id: id) }
        var verifiedTimeOff: String?
        if fields.timeOff != nil && !response.presentFields.contains("time_off") {
            // Older JSON serializers omit TIME_OFF. An exact one-row ADIF
            // boundary supplies evidence without rescanning the whole logbook.
            try validateForNetwork(run)
            let page = try await client.exportADIF(page: 1, perPage: 1, sinceID: id - 1)
            let records = ADIFParser().records(in: page.data.adif)
            guard page.meta.page == 1, page.meta.count == 1, page.data.exported == 1,
                  page.data.lastFetchedID == id, records.count == 1,
                  records[0]["TIME_OFF"] != nil,
                  let observed = QSO(adif: records[0]), let identity = QSO(wavelog: response),
                  historyIdentity(observed) == historyIdentity(identity), let end = observed.end else {
                throw WavelogClientError.writeVerificationFailed(id: id)
            }
            var utc = Calendar(identifier: .gregorian)
            utc.timeZone = TimeZone(secondsFromGMT: 0)!
            guard utc.isDate(observed.start, inSameDayAs: end) else {
                throw WavelogClientError.writeVerificationFailed(id: id)
            }
            let time = DateFormatter()
            time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = utc.timeZone; time.dateFormat = "HHmmss"
            verifiedTimeOff = time.string(from: end)
        }
        guard fields.isRepresented(by: response, verifiedTimeOff: verifiedTimeOff) else {
            throw WavelogClientError.writeVerificationFailed(id: id)
        }
    }

    private func validateSyncRun() throws {
        try Task.checkCancellation()
        try validateRun()
    }

    private func validateForNetwork(_ run: SyncDatabaseRun) throws {
        try validateSyncRun()
        try database.withSyncDatabaseLock(run) {}
    }
}

private func joinedDocumentedADIFOrder(
    _ rows: [QSO],
    with remotes: [WavelogQSO],
    pageEndsMatch: Bool
) throws -> [QSO]? {
    guard pageEndsMatch, rows.count == remotes.count else { return nil }
    try validateJoinFields(rows, remotes)
    var joined: [QSO] = []
    joined.reserveCapacity(rows.count)
    for (row, remote) in zip(rows, remotes) {
        guard let sparse = QSO(wavelog: remote),
              historyIdentity(row) == historyIdentity(sparse) else { return nil }
        joined.append(row.attachingWavelogIdentity(remote))
    }
    return joined
}

private func joinedADIF(_ rows: [QSO], with remotes: [WavelogQSO]) throws -> [QSO] {
    guard rows.count == remotes.count else {
        throw WavelogClientError.invalidData("JSON and ADIF identity groups have different record counts.")
    }
    try validateJoinFields(rows, remotes)
    if rows.count == 1 {
        return [rows[0].attachingWavelogIdentity(remotes[0])]
    }
    var pending = rows
    var candidates = remotes
    var joined: [QSO] = []
    while !pending.isEmpty {
        try Task.checkCancellation()
        // This also handles identical residual duplicates after a distinct
        // contact has been uniquely resolved. Export-only/unknown fields must
        // agree across the complete residual group, and every candidate must
        // agree with that payload before interchangeable IDs can be assigned.
        if pending.dropFirst().allSatisfy({ $0.extraFields == pending[0].extraFields }) {
            guard candidates.allSatisfy({ compatibleADIF(pending[0], with: $0) }) else {
                throw WavelogClientError.invalidData(duplicateMismatchSummary(pending, candidates))
            }
            joined += zip(pending, candidates.sorted { $0.id < $1.id }).map { original, remote in
                original.attachingWavelogIdentity(remote)
            }
            break
        }
        var resolved = false
        for index in pending.indices {
            let matches = candidates.indices.filter { compatibleADIF(pending[index], with: candidates[$0]) }
            guard matches.count == 1 else { continue }
            let row = pending.remove(at: index)
            let remote = candidates.remove(at: matches[0])
            joined.append(row.attachingWavelogIdentity(remote))
            resolved = true
            break
        }
        guard resolved else {
            guard hasCompleteMatching(pending, candidates) else {
                throw WavelogClientError.invalidData(duplicateMismatchSummary(pending, candidates))
            }
            throw HistoryJoinError.ambiguous
        }
    }
    return joined
}

private extension QSO {
    func attachingWavelogIdentity(_ remote: WavelogQSO) -> QSO {
        var value = self
        value.wavelogID = remote.id
        // Station identity is exposed only by the JSON representation. Retain
        // it when enriching that row with ADIF so baseline comparisons do not
        // manufacture a provider-side station change.
        value.stationProfileID = remote.stationID
        return value
    }
}

private func validateJoinFields(_ rows: [QSO], _ remotes: [WavelogQSO]) throws {
    // Malformed fields are not an identity ambiguity. Keep rejecting corrupt
    // snapshots before any write instead of quietly treating them as held.
    for row in rows {
        if let value = row.extraFields["FREQ_RX"], roundedHertz(value, multiplier: 1_000_000) == nil {
            throw WavelogClientError.invalidData("ADIF receive frequency is invalid.")
        }
    }
    for remote in remotes {
        if let value = remote.receiveFrequency, roundedHertz(value) == nil {
            throw WavelogClientError.invalidData("JSON receive frequency is invalid.")
        }
    }
}

/// Establish that at least one complete one-to-one assignment exists before
/// classifying a group as ambiguous. A zero-match or Hall-deficient group is
/// inconsistent data, not a safe hold. Iterative paths avoid recursive stacks.
private func hasCompleteMatching(_ rows: [QSO], _ remotes: [WavelogQSO]) -> Bool {
    let edges = rows.map { row in remotes.indices.filter { compatibleADIF(row, with: remotes[$0]) } }
    var owner = Array(repeating: -1, count: remotes.count)
    for start in rows.indices {
        var queue = [start], head = 0
        var seen = Set([start]), via = Array(repeating: -1, count: rows.count)
        var end = -1, lastRow = -1
        while head < queue.count && end == -1 {
            let row = queue[head]; head += 1
            for candidate in edges[row] {
                if owner[candidate] == -1 { end = candidate; lastRow = row; break }
                let next = owner[candidate]
                if seen.insert(next).inserted { via[next] = row; queue.append(next) }
            }
        }
        guard end != -1 else { return false }
        while lastRow != -1 {
            let old = owner.firstIndex(of: lastRow) ?? -1
            owner[end] = lastRow
            end = old
            lastRow = via[lastRow]
        }
    }
    return true
}

private func duplicateMismatchSummary(_ rows: [QSO], _ remotes: [WavelogQSO]) -> String {
    let differences = Set(rows.flatMap { row in remotes.flatMap { incompatibleADIFFields(row, with: $0) } })
    return "JSON and ADIF duplicate fields disagree: " + differences.sorted().joined(separator: ", ")
}

private func varyingADIFFields(_ rows: [QSO]) -> Set<String> {
    let keys = Set(rows.flatMap { $0.extraFields.keys })
    return Set(keys.filter { key in
        Set(rows.map { $0.extraFields[key] }).count > 1
    })
}

private func compatibleADIF(_ row: QSO, with remote: WavelogQSO) -> Bool {
    incompatibleADIFFields(row, with: remote).isEmpty
}

private func incompatibleADIFFields(_ row: QSO, with remote: WavelogQSO) -> [String] {
    var differences: [String] = []
    let fields: [(String, String?)] = [
        ("RST_SENT", remote.rstSent), ("RST_RCVD", remote.rstReceived),
        ("GRIDSQUARE", remote.gridSquare), ("NAME", remote.name),
        ("COMMENT", remote.comment), ("NOTES", remote.notes),
        ("QTH", remote.qth), ("STATE", remote.state), ("CNTY", remote.county),
        ("IOTA", remote.iota), ("QSL_VIA", remote.qslVia),
        ("TX_PWR", remote.power), ("CQZ", remote.cqZone), ("ITUZ", remote.ituZone),
        ("PROP_MODE", remote.propagationMode), ("SAT_NAME", remote.satelliteName),
        ("SAT_MODE", remote.satelliteMode), ("SOTA_REF", remote.sotaReference),
        ("POTA_REF", remote.potaReference), ("WWFF_REF", remote.wwffReference),
        ("BAND_RX", remote.receiveBand),
    ]
    for (key, value) in fields {
        // An omitted JSON field provides no evidence for or against a match.
        guard let value else { continue }
        let exported = row.extraFields[key] ?? ""
        if ["TX_PWR", "CQZ", "ITUZ"].contains(key),
           let lhs = Decimal(string: exported), let rhs = Decimal(string: value) {
            if lhs != rhs { differences.append(key) }
        } else if exported != value {
            let shape = exported.isEmpty ? "ADIF empty" : value.isEmpty ? "JSON empty" : "both present"
            differences.append("\(key) (\(shape))")
        }
    }
    if let value = remote.receiveFrequency {
        // The validated live duplicate group represents an unrecorded RX
        // frequency as literal JSON zero and an omitted ADIF FREQ_RX. Treat
        // only those two representations as equivalent; retain the original
        // ADIF payload and reject positive, malformed or TX-default mismatches.
        if isLiteralReceiveZero(value), row.extraFields["FREQ_RX"] == nil { return differences }
        let jsonHz = roundedHertz(value)
        let adifHz = row.extraFields["FREQ_RX"].flatMap { roundedHertz($0, multiplier: 1_000_000) }
        if jsonHz == nil || adifHz == nil || jsonHz != adifHz {
            // Fixed representation shapes aid read-only diagnostics without
            // exposing identities, frequencies or other contact values.
            let jsonShape = jsonHz == nil ? "invalid" : Double(value).map { $0 == 0 ? "zero" : $0 > 0 ? "positive" : "negative" } ?? "invalid"
            let adifShape: String
            if row.extraFields["FREQ_RX"] == nil {
                adifShape = "missing"
            } else if let adifHz {
                adifShape = adifHz == 0 ? "zero" : adifHz < 0 ? "negative" : adifHz == row.frequencyHz ? "transmit default" : "different positive"
            } else {
                adifShape = "invalid"
            }
            differences.append("FREQ_RX (JSON \(jsonShape); ADIF \(adifShape))")
        }
    }
    return differences
}

private func roundedHertz(_ text: String, multiplier: Double = 1) -> Int64? {
    guard let value = Double(text), value.isFinite else { return nil }
    let scaled = value * multiplier
    guard scaled.isFinite else { return nil }
    return Int64(exactly: scaled.rounded())
}

private func validateWavelogTimingUpdate(_ qso: QSO, comparedTo previous: QSO) throws {
    guard (qso.start != previous.start || qso.end != previous.end), let explicitEnd = qso.end else { return }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(secondsFromGMT: 0)!
    guard utc.isDate(qso.start, inSameDayAs: explicitEnd) else {
        // API v2 accepts TIME_OFF but not QSO_DATE_OFF. Failing closed avoids
        // moving a cross-midnight end onto the start date at the provider.
        throw WavelogClientError.invalidData(
            "Wavelog API v2 cannot safely represent an explicit QSO end on a different UTC date."
        )
    }
}

private func isLiteralReceiveZero(_ text: String) -> Bool {
    guard Double(text) == 0 else { return false }
    // Floating-point parsing can underflow a nonzero value such as 1e-400 to
    // zero. Require an all-zero decimal significand, independent of exponent.
    let significand = text.prefix { $0 != "e" && $0 != "E" }
    return significand.contains("0") && significand.allSatisfy { $0 == "0" || $0 == "." || $0 == "+" || $0 == "-" }
}

private extension QSO {
    init?(wavelog value: WavelogQSO) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        guard let date = formatter.date(from: value.qsoDate) else { return nil }
        let extraFields = [
            "SAT_NAME": value.satelliteName,
            "SAT_MODE": value.satelliteMode,
        ].compactMapValues { $0 }
        self.init(
            wavelogID: value.id,
            call: value.call,
            start: date,
            band: value.band,
            mode: value.mode,
            submode: value.submode ?? "",
            frequencyHz: value.frequency.flatMap { roundedHertz($0) },
            receiveFrequencyHz: value.receiveFrequency.flatMap { roundedHertz($0) },
            receiveBand: value.receiveBand ?? "",
            rstSent: value.rstSent ?? "",
            rstReceived: value.rstReceived ?? "",
            name: value.name ?? "",
            gridSquare: value.gridSquare ?? "",
            cqZone: value.cqZone ?? "",
            ituZone: value.ituZone ?? "",
            state: value.state ?? "",
            county: value.county ?? "",
            qth: value.qth ?? "",
            iota: value.iota ?? "",
            sotaReference: value.sotaReference ?? "",
            potaReference: value.potaReference ?? "",
            wwffReference: value.wwffReference ?? "",
            comment: value.comment ?? "",
            notes: value.notes ?? "",
            stationProfileID: value.stationID,
            txPower: value.power ?? "",
            propagationMode: value.propagationMode ?? "",
            qslVia: value.qslVia ?? "",
            extraFields: extraFields,
            isDirty: false
        )
    }
}

extension WavelogQSOUpdate {
    init(_ qso: QSO) {
        self.init()
        let date = DateFormatter()
        date.locale = Locale(identifier: "en_US_POSIX"); date.timeZone = TimeZone(secondsFromGMT: 0); date.dateFormat = "yyyy-MM-dd"
        let time = DateFormatter()
        time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = TimeZone(secondsFromGMT: 0); time.dateFormat = "HHmmss"
        let adif = qso.adifRecord
        call = qso.call; band = qso.band; mode = adif["SUBMODE"]?.nilIfEmpty ?? adif["MODE"] ?? qso.mode
        qsoDate = date.string(from: qso.start); timeOn = time.string(from: qso.start)
        frequency = qso.frequencyHz; receiveFrequency = qso.receiveFrequencyHz; receiveBand = qso.receiveBand.nilIfEmpty
        rstSent = qso.rstSent.nilIfEmpty; rstReceived = qso.rstReceived.nilIfEmpty
        gridSquare = qso.gridSquare.nilIfEmpty; name = qso.name.nilIfEmpty; comment = qso.comment.nilIfEmpty
        notes = qso.notes.nilIfEmpty; qth = qso.qth.nilIfEmpty; state = qso.state.nilIfEmpty
        county = qso.county.nilIfEmpty; iota = qso.iota.nilIfEmpty; qslVia = qso.qslVia.nilIfEmpty
        power = qso.txPower.nilIfEmpty; cqZone = qso.cqZone.nilIfEmpty; ituZone = qso.ituZone.nilIfEmpty
        propagationMode = qso.propagationMode.nilIfEmpty; sotaReference = qso.sotaReference.nilIfEmpty
        potaReference = qso.potaReference.nilIfEmpty; wwffReference = qso.wwffReference.nilIfEmpty
        satelliteName = adif["SAT_NAME"]?.nilIfEmpty; satelliteMode = adif["SAT_MODE"]?.nilIfEmpty
    }

    init(_ qso: QSO, comparedTo previous: QSO) {
        self.init()
        let date = DateFormatter()
        date.locale = Locale(identifier: "en_US_POSIX"); date.timeZone = TimeZone(secondsFromGMT: 0); date.dateFormat = "yyyy-MM-dd"
        let time = DateFormatter()
        time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = TimeZone(secondsFromGMT: 0); time.dateFormat = "HHmmss"
        let adif = qso.adifRecord, priorADIF = previous.adifRecord
        let effectiveMode = adif["SUBMODE"]?.nilIfEmpty ?? adif["MODE"] ?? qso.mode
        let previousMode = priorADIF["SUBMODE"]?.nilIfEmpty ?? priorADIF["MODE"] ?? previous.mode

        func assign(
            _ desired: String,
            _ prior: String,
            field: Field,
            keyPath: WritableKeyPath<WavelogQSOUpdate, String?>,
            normalize: (String) -> String = { $0 }
        ) {
            guard normalize(desired) != normalize(prior) else { return }
            if desired.isEmpty { clearedFields.insert(field) }
            else { self[keyPath: keyPath] = desired }
        }

        assign(qso.call, previous.call, field: .call, keyPath: \.call) { $0.uppercased() }
        assign(qso.band, previous.band, field: .band, keyPath: \.band) { $0.lowercased() }
        assign(effectiveMode, previousMode, field: .mode, keyPath: \.mode) { $0.uppercased() }
        let startChanged = qso.start != previous.start
        let endChanged = qso.end != previous.end
        if startChanged || endChanged {
            qsoDate = date.string(from: qso.start)
            timeOn = time.string(from: qso.start)
            if let explicitEnd = qso.end {
                timeOff = time.string(from: explicitEnd)
            } else if startChanged, let providerEnd = previous.end,
                      date.string(from: providerEnd) == qsoDate {
                // Wavelog couples qso_date/time_on and otherwise resets its
                // stored TIME_OFF to the new start. Preserve a same-day
                // provider end when xLog has no explicit local end.
                timeOff = time.string(from: providerEnd)
            }
        }
        if qso.frequencyHz != previous.frequencyHz {
            if let frequencyHz = qso.frequencyHz { frequency = frequencyHz }
            else { clearedFields.insert(.frequency) }
        }
        if qso.receiveFrequencyHz != previous.receiveFrequencyHz {
            if let receiveFrequencyHz = qso.receiveFrequencyHz { receiveFrequency = receiveFrequencyHz }
            else { clearedFields.insert(.receiveFrequency) }
        }
        assign(qso.receiveBand, previous.receiveBand, field: .receiveBand, keyPath: \.receiveBand) { $0.lowercased() }
        assign(qso.rstSent, previous.rstSent, field: .rstSent, keyPath: \.rstSent)
        assign(qso.rstReceived, previous.rstReceived, field: .rstReceived, keyPath: \.rstReceived)
        assign(qso.gridSquare, previous.gridSquare, field: .gridSquare, keyPath: \.gridSquare) { $0.uppercased() }
        assign(qso.name, previous.name, field: .name, keyPath: \.name)
        assign(qso.comment, previous.comment, field: .comment, keyPath: \.comment)
        assign(qso.notes, previous.notes, field: .notes, keyPath: \.notes)
        assign(qso.qth, previous.qth, field: .qth, keyPath: \.qth)
        assign(qso.state, previous.state, field: .state, keyPath: \.state) { $0.uppercased() }
        assign(qso.county, previous.county, field: .county, keyPath: \.county) { $0.uppercased() }
        assign(qso.iota, previous.iota, field: .iota, keyPath: \.iota) { $0.uppercased() }
        assign(qso.qslVia, previous.qslVia, field: .qslVia, keyPath: \.qslVia) { $0.uppercased() }
        assign(qso.txPower, previous.txPower, field: .power, keyPath: \.power)
        assign(qso.cqZone, previous.cqZone, field: .cqZone, keyPath: \.cqZone)
        assign(qso.ituZone, previous.ituZone, field: .ituZone, keyPath: \.ituZone)
        assign(qso.propagationMode, previous.propagationMode, field: .propagationMode, keyPath: \.propagationMode) { $0.uppercased() }
        assign(qso.sotaReference, previous.sotaReference, field: .sotaReference, keyPath: \.sotaReference) { $0.uppercased() }
        assign(qso.potaReference, previous.potaReference, field: .potaReference, keyPath: \.potaReference) { $0.uppercased() }
        assign(qso.wwffReference, previous.wwffReference, field: .wwffReference, keyPath: \.wwffReference) { $0.uppercased() }
        assign(adif["SAT_NAME"] ?? "", priorADIF["SAT_NAME"] ?? "", field: .satelliteName, keyPath: \.satelliteName) { $0.uppercased() }
        assign(adif["SAT_MODE"] ?? "", priorADIF["SAT_MODE"] ?? "", field: .satelliteMode, keyPath: \.satelliteMode) { $0.uppercased() }
    }

    func isRepresented(by remote: WavelogQSO, verifiedTimeOff: String? = nil) -> Bool {
        func exposed(_ field: Field) -> Bool { remote.presentFields.contains(field.rawValue) }
        func text(
            _ expected: String?,
            _ returned: String?,
            field: Field,
            normalize: (String) -> String = { $0 }
        ) -> Bool {
            guard expected != nil || clearedFields.contains(field) else { return true }
            guard exposed(field) else { return false }
            if let expected { return returned.map(normalize) == normalize(expected) }
            // Wavelog's text clears are submitted as an empty string. Some
            // deployed response serializers expose the cleared value as null;
            // container presence still proves that this is authoritative.
            return returned == nil || returned == ""
        }
        func number(_ expected: Int64?, _ returned: String?, field: Field) -> Bool {
            guard expected != nil || clearedFields.contains(field) else { return true }
            guard exposed(field) else { return false }
            if let expected { return returned.flatMap { roundedHertz($0) } == expected }
            return returned == nil
        }

        if !text(call, remote.call, field: .call, normalize: { $0.uppercased() }) { return false }
        if !text(band, remote.band, field: .band, normalize: { $0.lowercased() }) { return false }
        if mode != nil || clearedFields.contains(.mode) {
            let returnedMode = remote.submode?.nilIfEmpty ?? remote.mode
            guard exposed(.mode), text(mode, returnedMode, field: .mode, normalize: { $0.uppercased() }) else { return false }
        }
        if qsoDate != nil || timeOn != nil {
            guard exposed(.qsoDate), let qsoDate, let timeOn else { return false }
            let digits = timeOn.filter(\.isNumber)
            let padded = (digits + "000000").prefix(6)
            let expected = "\(qsoDate) \(padded.prefix(2)):\(padded.dropFirst(2).prefix(2)):\(padded.suffix(2))"
            guard remote.qsoDate == expected else { return false }
        }
        if let timeOff {
            let returned = remote.presentFields.contains("time_off") ? remote.timeOff : verifiedTimeOff
            guard let returned, returned.replacingOccurrences(of: ":", with: "") == timeOff else { return false }
        }
        if !number(frequency, remote.frequency, field: .frequency) { return false }
        if !number(receiveFrequency, remote.receiveFrequency, field: .receiveFrequency) { return false }
        if !text(receiveBand, remote.receiveBand, field: .receiveBand, normalize: { $0.lowercased() }) { return false }
        if !text(rstSent, remote.rstSent, field: .rstSent) { return false }
        if !text(rstReceived, remote.rstReceived, field: .rstReceived) { return false }
        if !text(gridSquare, remote.gridSquare, field: .gridSquare, normalize: { $0.uppercased() }) { return false }
        if !text(name, remote.name, field: .name) { return false }
        if !text(comment, remote.comment, field: .comment) { return false }
        if !text(notes, remote.notes, field: .notes) { return false }
        if !text(qth, remote.qth, field: .qth) { return false }
        if !text(state, remote.state, field: .state, normalize: { $0.uppercased() }) { return false }
        if !text(county, remote.county, field: .county, normalize: { $0.uppercased() }) { return false }
        if !text(iota, remote.iota, field: .iota, normalize: { $0.uppercased() }) { return false }
        if !text(qslVia, remote.qslVia, field: .qslVia, normalize: { $0.uppercased() }) { return false }
        if !text(power, remote.power, field: .power, normalize: decimalText) { return false }
        if !text(cqZone, remote.cqZone, field: .cqZone, normalize: decimalText) { return false }
        if !text(ituZone, remote.ituZone, field: .ituZone, normalize: decimalText) { return false }
        if !text(propagationMode, remote.propagationMode, field: .propagationMode, normalize: { $0.uppercased() }) { return false }
        if !text(satelliteName, remote.satelliteName, field: .satelliteName, normalize: { $0.uppercased() }) { return false }
        if !text(satelliteMode, remote.satelliteMode, field: .satelliteMode, normalize: { $0.uppercased() }) { return false }
        if !text(sotaReference, remote.sotaReference, field: .sotaReference, normalize: { $0.uppercased() }) { return false }
        if !text(potaReference, remote.potaReference, field: .potaReference, normalize: { $0.uppercased() }) { return false }
        if !text(wwffReference, remote.wwffReference, field: .wwffReference, normalize: { $0.uppercased() }) { return false }
        return true
    }
}

extension WavelogQSO {
    /// Create responses have historically exposed only the remote identity and
    /// core ADIF fields. PATCH acknowledgement is stricter because it can prove
    /// every intentionally changed field from the fresh response.
    func representsSupportedCreate(of qso: QSO) -> Bool {
        let adif = qso.adifRecord
        let expectedMode = (adif["SUBMODE"]?.nilIfEmpty ?? adif["MODE"] ?? qso.mode).uppercased()
        let returnedMode = (submode?.nilIfEmpty ?? mode).uppercased()
        guard call.uppercased() == qso.call.uppercased(), band.lowercased() == qso.band.lowercased(),
              returnedMode == expectedMode else { return false }
        if let expected = qso.frequencyHz, frequency.flatMap({ roundedHertz($0) }) != expected { return false }
        if let expected = qso.receiveFrequencyHz, receiveFrequency.flatMap({ roundedHertz($0) }) != expected { return false }
        if let expected = qso.receiveBand.nilIfEmpty, receiveBand?.lowercased() != expected.lowercased() { return false }
        if let expected = adif["SAT_NAME"]?.nilIfEmpty, satelliteName?.uppercased() != expected.uppercased() { return false }
        if let expected = adif["SAT_MODE"]?.nilIfEmpty, satelliteMode?.uppercased() != expected.uppercased() { return false }
        return true
    }
}

private func decimalText(_ value: String) -> String {
    Decimal(string: value).map { NSDecimalNumber(decimal: $0).stringValue } ?? value
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
