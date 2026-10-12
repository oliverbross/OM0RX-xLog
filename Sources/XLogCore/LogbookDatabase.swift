import Foundation
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

public enum LogbookDatabaseError: Error, LocalizedError {
    case open(String)
    case sqlite(String)
    case corruptRecord
    case closed

    public var errorDescription: String? {
        switch self {
        case let .open(message): return "Could not open the xLog database: \(message)"
        case let .sqlite(message): return "xLog database error: \(message)"
        case .corruptRecord: return "A stored QSO could not be decoded."
        case .closed: return "The xLog database is closed."
        }
    }
}

public struct OpportunityReferenceHistory: Codable, Equatable, Sendable {
    public struct BandMode: Codable, Equatable, Sendable {
        public var band: String
        public var mode: String
        public var workedCount: Int
        public var confirmedCount: Int
    }
    public var kind: String
    public var reference: String
    public var workedCount: Int
    public var confirmedCount: Int
    public var bandModes: [BandMode]
}

/// Exact contact inputs needed by xCluster classification, without decoding
/// the rest of each full QSO record. Confirmation remains the consumer's rule:
/// raw QSL strings are intentionally not collapsed into a Boolean here.
public struct ClusterContactRow: Codable, Equatable, Sendable {
    public let call: String
    public let band: String
    public let mode: String
    public let dxcc: Int?
    public let start: Date
    public let qslReceived: String
    public let lotwReceived: String

    public init(call: String, band: String, mode: String, dxcc: Int?, start: Date,
                qslReceived: String, lotwReceived: String) {
        self.call = call
        self.band = band
        self.mode = mode
        self.dxcc = dxcc
        self.start = start
        self.qslReceived = qslReceived
        self.lotwReceived = lotwReceived
    }
}

/// Fields used by callsign/country intelligence. Large country histories must
/// not decode every editable QSO field or arbitrary ADIF payload just to count
/// contacts and paint a small band/mode matrix.
public struct ContactHistoryRow: Decodable, Sendable {
    public let id: UUID
    public let call: String
    public let start: Date
    public let band: String
    public let mode: String
    public let submode: String
    public let dxcc: Int?
    public let qslReceived: String
    public let lotwReceived: String
    public let lotwSent: String
    public let gridSquare: String
    public let rstSent: String
    public let rstReceived: String
    public let deletedAt: Date?

    public init(_ qso: QSO) {
        id = qso.id; call = qso.call; start = qso.start; band = qso.band
        mode = qso.mode; submode = qso.submode; dxcc = qso.dxcc
        qslReceived = qso.qslReceived; lotwReceived = qso.lotwReceived; lotwSent = qso.lotwSent
        gridSquare = qso.gridSquare; rstSent = qso.rstSent; rstReceived = qso.rstReceived
        deletedAt = qso.deletedAt
    }
}

public final class LogbookDatabase: @unchecked Sendable {
    private var handle: OpaquePointer?
    private let lock = NSRecursiveLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private var cachedDataVersion: Int?
    private var cachedStats: LogbookStats?
    private var cachedStatsYearStart: TimeInterval?
    private var cachedAwards: AwardProgressSnapshot?
    private var cachedDXCCStatuses: [Int: String]?
    private var cachedAwardCatalog: AwardCatalogSnapshot?
    private var cachedOpportunityReferences: [OpportunityReferenceHistory]?
    private var cachedClusterContactRows: [ClusterContactRow]?

    public let url: URL

    public static func defaultURL() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return support.appendingPathComponent("OM0RX-xLog", isDirectory: true)
            .appendingPathComponent("OM0RX-xLog.sqlite")
    }

    public init(url: URL? = nil) throws {
        self.url = try url ?? Self.defaultURL()
        try FileManager.default.createDirectory(
            at: self.url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(self.url.path, &handle, flags, nil) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
            sqlite3_close(handle)
            throw LogbookDatabaseError.open(message)
        }
        sqlite3_busy_timeout(handle, 5_000)
        try execute("PRAGMA journal_mode=WAL;")
        try execute("PRAGMA foreign_keys=ON;")
        try migrate()
    }

    deinit { close() }

    public func close() {
        lock.withLock {
            guard let handle else { return }
            sqlite3_close_v2(handle)
            self.handle = nil
        }
    }

    public func backup(to destination: URL) throws {
        try lock.withLock {
            guard let handle else { throw LogbookDatabaseError.closed }
            let fileManager = FileManager.default
            try fileManager.createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }

            var destinationHandle: OpaquePointer?
            let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
            guard sqlite3_open_v2(destination.path, &destinationHandle, flags, nil) == SQLITE_OK,
                  let destinationHandle else {
                let message = destinationHandle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
                sqlite3_close(destinationHandle)
                throw LogbookDatabaseError.open("Could not create backup: \(message)")
            }
            defer { sqlite3_close(destinationHandle) }

            guard let backup = sqlite3_backup_init(destinationHandle, "main", handle, "main") else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(destinationHandle)))
            }
            let result = sqlite3_backup_step(backup, -1)
            let finish = sqlite3_backup_finish(backup)
            guard result == SQLITE_DONE, finish == SQLITE_OK else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(destinationHandle)))
            }
            guard sqlite3_exec(destinationHandle, "PRAGMA journal_mode=DELETE;", nil, nil, nil) == SQLITE_OK else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(destinationHandle)))
            }
        }
    }

    public func save(_ value: QSO, markDirty: Bool = true) throws {
        try lock.withLock {
            var qso = value
            qso.call = qso.call.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
            qso.band = qso.band.lowercased()
            qso.mode = qso.mode.uppercased()
            qso.isDirty = markDirty
            qso.updatedAt = Date()
            let data = try encoder.encode(qso)
            let sql = """
            INSERT INTO qsos(local_id,wavelog_id,call,qso_start,band,mode,frequency_hz,is_dirty,deleted_at,updated_at,record_json,baseline_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(local_id) DO UPDATE SET
              wavelog_id=excluded.wavelog_id, call=excluded.call, qso_start=excluded.qso_start,
              band=excluded.band, mode=excluded.mode, frequency_hz=excluded.frequency_hz,
              is_dirty=excluded.is_dirty, deleted_at=excluded.deleted_at,
              updated_at=excluded.updated_at, record_json=excluded.record_json,
              baseline_json=CASE WHEN excluded.is_dirty = 0 THEN excluded.baseline_json ELSE qsos.baseline_json END;
            """
            try withStatement(sql) { statement in
                bind(qso.id.uuidString, to: 1, in: statement)
                bind(qso.wavelogID, to: 2, in: statement)
                bind(qso.call, to: 3, in: statement)
                sqlite3_bind_double(statement, 4, qso.start.timeIntervalSince1970)
                bind(qso.band, to: 5, in: statement)
                bind(qso.mode, to: 6, in: statement)
                bind(qso.frequencyHz, to: 7, in: statement)
                sqlite3_bind_int(statement, 8, qso.isDirty ? 1 : 0)
                if let deletedAt = qso.deletedAt { sqlite3_bind_double(statement, 9, deletedAt.timeIntervalSince1970) }
                else { sqlite3_bind_null(statement, 9) }
                sqlite3_bind_double(statement, 10, qso.updatedAt.timeIntervalSince1970)
                _ = data.withUnsafeBytes { bytes in
                    sqlite3_bind_blob(statement, 11, bytes.baseAddress, Int32(bytes.count), Self.transient)
                }
                if markDirty {
                    sqlite3_bind_null(statement, 12)
                } else {
                    let baseline = try syncFingerprint(qso)
                    _ = baseline.withUnsafeBytes { bytes in
                        sqlite3_bind_blob(statement, 12, bytes.baseAddress, Int32(bytes.count), Self.transient)
                    }
                }
                try stepDone(statement)
            }
            invalidateQSOAggregates()
        }
    }

    /// One joined SELECT pairs the contact with its revision atomically, including
    /// pre-migration rows (revision zero) without rewriting/scanning the logbook.
    public func contactSnapshot(localID: UUID) throws -> LogbookContactSnapshot? {
        try lock.withLock {
            try withStatement("SELECT q.record_json, COALESCE(r.revision,0) FROM qsos q LEFT JOIN xlog_contact_revisions r ON r.local_id=q.local_id WHERE q.local_id=?;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                let qso = try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
                return LogbookContactSnapshot(revision: sqlite3_column_int64(statement, 1), qso: qso)
            }
        }
    }

    public func contactReceipt(operationID: UUID) throws -> LogbookContactReceipt? {
        try lock.withLock {
            try withStatement("SELECT payload FROM xlog_contact_receipts WHERE operation_id=?;") { statement in
                bind(operationID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                return try decoder.decode(LogbookContactReceipt.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            }
        }
    }

    public func applyContactMutation(_ mutation: LogbookContactMutation) throws -> LogbookContactReceipt {
        try lock.withLock {
            guard (0..<9_007_199_254_740_991).contains(mutation.expectedRevision) else { throw LogbookContactError.invalid }
            try execute("BEGIN IMMEDIATE;")
            do {
                if let receipt = try contactReceipt(operationID: mutation.operationID) {
                    guard receipt.mutation == mutation else { throw LogbookContactError.operationReused }
                    try execute("COMMIT;")
                    return receipt
                }
                let snapshot = try contactSnapshot(localID: mutation.contactID)
                guard let current = snapshot, current.revision == mutation.expectedRevision else {
                    throw LogbookContactError.conflict(snapshot)
                }
                var updated = current.qso
                switch mutation.action {
                case .update:
                    guard current.qso.deletedAt == nil, let qso = mutation.qso,
                          qso.id == current.qso.id, qso.wavelogID == current.qso.wavelogID,
                          qso.deletedAt == nil else { throw LogbookContactError.invalid }
                    // Reuse bounded contact validation, without forbidding the
                    // existing remote mapping. The supplied mapping must match.
                    var validation = qso; validation.wavelogID = nil
                    do { try validation.validateOperatorDraft(forSave: true) }
                    catch { throw LogbookContactError.invalid }
                    updated = qso
                case .delete:
                    guard mutation.qso == nil, current.qso.deletedAt == nil else { throw LogbookContactError.invalid }
                    updated.deletedAt = Date()
                case .restore:
                    guard mutation.qso == nil, current.qso.deletedAt != nil else { throw LogbookContactError.invalid }
                    updated.deletedAt = nil
                }
                try save(updated)
                guard let contact = try contactSnapshot(localID: mutation.contactID), contact.revision == current.revision + 1 else {
                    throw LogbookDatabaseError.corruptRecord
                }
                let receipt = LogbookContactReceipt(mutation: mutation, contact: contact)
                let payload = try encoder.encode(receipt)
                try withStatement("INSERT INTO xlog_contact_receipts(operation_id,payload) VALUES(?,?);") { statement in
                    bind(mutation.operationID.uuidString, to: 1, in: statement)
                    _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), Self.transient) }
                    try stepDone(statement)
                }
                try execute("COMMIT;")
                return receipt
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    /// Initial creation and all mutations use SQLite's write lock as well as the
    /// instance lock, so two service instances cannot accept the same revision.
    public func operatorDraft(initial: QSO) throws -> OperatorDraftSnapshot {
        try lock.withLock {
            if let existing = try readOperatorDraft() { return existing }
            try execute("BEGIN IMMEDIATE;")
            do {
                if let existing = try readOperatorDraft() {
                    try execute("COMMIT;")
                    return existing
                }
                try initial.validateOperatorDraft(forSave: false)
                guard try lookup(localID: initial.id) == nil else { throw OperatorDraftError.existingContact }
                let draft = OperatorDraftSnapshot(revision: 0, qso: initial)
                try writeOperatorDraft(draft)
                try execute("COMMIT;")
                return draft
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func operatorDraftReceipt(operationID: UUID) throws -> OperatorDraftReceipt? {
        try lock.withLock {
            try withStatement("SELECT payload FROM xlog_operator_receipts WHERE operation_id = ?;") { statement in
                bind(operationID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                return try decoder.decode(OperatorDraftReceipt.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            }
        }
    }

    /// Save, draft advance and receipt are one transaction. A repeated operation
    /// returns its original receipt even after another window advances the draft.
    /// Only creating new contacts is exposed here; editing a logged QSO requires
    /// a separate record revision contract and cannot hijack this draft's ID.
    public func applyOperatorDraft(_ mutation: OperatorDraftMutation, nextDraft: QSO) throws -> OperatorDraftReceipt {
        try lock.withLock {
            guard (0..<9_007_199_254_740_991).contains(mutation.expectedRevision) else { throw OperatorDraftError.invalid }
            try execute("BEGIN IMMEDIATE;")
            do {
                if let receipt = try operatorDraftReceipt(operationID: mutation.operationID) {
                    guard receipt.mutation == mutation else { throw OperatorDraftError.operationReused }
                    try execute("COMMIT;")
                    return receipt
                }
                guard let current = try readOperatorDraft() else { throw OperatorDraftError.notInitialized }
                guard current.qso.id == mutation.draftID, current.revision == mutation.expectedRevision else {
                    throw OperatorDraftError.conflict(current)
                }
                let updated: QSO
                var saved: QSO?
                switch mutation.action {
                case .replace:
                    guard let replacement = mutation.qso, replacement.id == current.qso.id else { throw OperatorDraftError.invalid }
                    try replacement.validateOperatorDraft(forSave: false)
                    updated = replacement
                case .clear, .save:
                    guard mutation.qso == nil, nextDraft.id != current.qso.id, nextDraft.call.isEmpty else { throw OperatorDraftError.invalid }
                    try nextDraft.validateOperatorDraft(forSave: false)
                    guard try lookup(localID: nextDraft.id) == nil else { throw OperatorDraftError.existingContact }
                    updated = nextDraft
                    if mutation.action == .save {
                        try current.qso.validateOperatorDraft(forSave: true)
                        guard try lookup(localID: current.qso.id) == nil else { throw OperatorDraftError.existingContact }
                        try save(current.qso)
                        guard let value = try lookup(localID: current.qso.id) else { throw LogbookDatabaseError.corruptRecord }
                        saved = value
                    }
                }
                let draft = OperatorDraftSnapshot(revision: current.revision + 1, qso: updated)
                try writeOperatorDraft(draft)
                let receipt = OperatorDraftReceipt(mutation: mutation, draft: draft, savedQSO: saved)
                let payload = try encoder.encode(receipt)
                try withStatement("INSERT INTO xlog_operator_receipts(operation_id, action, revision, payload) VALUES(?,?,?,?);") { statement in
                    bind(mutation.operationID.uuidString, to: 1, in: statement)
                    bind(mutation.action.rawValue, to: 2, in: statement)
                    sqlite3_bind_int64(statement, 3, draft.revision)
                    _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 4, $0.baseAddress, Int32($0.count), Self.transient) }
                    try stepDone(statement)
                }
                // Keystroke/autofill receipts are bounded. Older retries still
                // fail the revision fence; contact-save receipts never expire.
                try withStatement("DELETE FROM xlog_operator_receipts WHERE action <> 'save' AND revision <= ?;") { statement in
                    sqlite3_bind_int64(statement, 1, draft.revision - 256)
                    try stepDone(statement)
                }
                try execute("COMMIT;")
                return receipt
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    private func readOperatorDraft() throws -> OperatorDraftSnapshot? {
        try withStatement("SELECT payload FROM xlog_operator_draft WHERE singleton = 1;") { statement in
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
            return try decoder.decode(OperatorDraftSnapshot.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
        }
    }

    private func writeOperatorDraft(_ draft: OperatorDraftSnapshot) throws {
        let payload = try encoder.encode(draft)
        try withStatement("INSERT INTO xlog_operator_draft(singleton, payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload;") { statement in
            _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
            try stepDone(statement)
        }
    }

    public func fetch(limit: Int = 500, search: String = "", offset: Int = 0) throws -> [QSO] {
        try lock.withLock {
            let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
            let filtered = !needle.isEmpty
            let sql = filtered
                ? "SELECT record_json FROM qsos WHERE deleted_at IS NULL AND (call LIKE ? OR record_json LIKE ?) ORDER BY qso_start DESC LIMIT ? OFFSET ?;"
                : "SELECT record_json FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC LIMIT ? OFFSET ?;"
            return try withStatement(sql) { statement in
                if filtered {
                    let pattern = "%\(needle)%"
                    bind(pattern, to: 1, in: statement); bind(pattern, to: 2, in: statement)
                    sqlite3_bind_int(statement, 3, Int32(limit))
                    sqlite3_bind_int(statement, 4, Int32(offset))
                } else {
                    sqlite3_bind_int(statement, 1, Int32(limit))
                    sqlite3_bind_int(statement, 2, Int32(offset))
                }
                return try decodeRows(statement)
            }
        }
    }

    /// One SQLite read statement gives consumers a consistent contact view even
    /// while another connection appends to the logbook.
    public func fetchAll() throws -> [QSO] {
        try lock.withLock {
            try withStatement("SELECT record_json FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC;") {
                try decodeRows($0)
            }
        }
    }

    /// A single consistent, nondeleted read for the cluster's contact index.
    /// Project from JSON so even an imported row with divergent scalar index
    /// columns has the same values as the former full-QSO decode.
    public func clusterContactRows() throws -> [ClusterContactRow] {
        try lock.withLock {
            try refreshAggregateCacheVersion()
            if let cachedClusterContactRows { return cachedClusterContactRows }
            let cacheKey = "cluster-contacts-v1"
            if let value: [ClusterContactRow] = try persistedAggregate(cacheKey) {
                cachedClusterContactRows = value
                return value
            }
            let revision = try qsoRevision()
            let rows = try withStatement("""
                SELECT json_extract(record_json,'$.call'),
                    json_extract(record_json,'$.band'),
                    json_extract(record_json,'$.mode'),
                    json_extract(record_json,'$.start'),
                    json_extract(record_json,'$.submode'),
                    json_extract(record_json,'$.dxcc'),
                    json_extract(record_json,'$.qslReceived'),
                    json_extract(record_json,'$.lotwReceived')
                FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC;
                """) { statement -> [ClusterContactRow] in
                func requiredString(_ column: Int32) throws -> String {
                    guard sqlite3_column_type(statement, column) == SQLITE_TEXT,
                          let value = sqlite3_column_text(statement, column) else {
                        throw LogbookDatabaseError.corruptRecord
                    }
                    return String(cString: value)
                }
                var values: [ClusterContactRow] = []
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    let call = try requiredString(0)
                    let band = try requiredString(1)
                    let mode = try requiredString(2)
                    guard [SQLITE_INTEGER, SQLITE_FLOAT].contains(sqlite3_column_type(statement, 3)) else {
                        throw LogbookDatabaseError.corruptRecord
                    }
                    let submode = try requiredString(4)
                    let dxcc: Int?
                    switch sqlite3_column_type(statement, 5) {
                    case SQLITE_NULL: dxcc = nil
                    case SQLITE_INTEGER: dxcc = Int(sqlite3_column_int64(statement, 5))
                    default: throw LogbookDatabaseError.corruptRecord
                    }
                    values.append(ClusterContactRow(
                        call: call, band: band, mode: submode.isEmpty ? mode : submode,
                        dxcc: dxcc,
                        start: Date(timeIntervalSinceReferenceDate: sqlite3_column_double(statement, 3)),
                        qslReceived: try requiredString(6), lotwReceived: try requiredString(7)
                    ))
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                return values
            }
            cachedClusterContactRows = rows
            persistAggregate(rows, key: cacheKey, revision: revision)
            return rows
        }
    }

    /// Returns only rows that can affect a callsign/DXCC history. SQL filters
    /// before JSON decoding; nil-DXCC rows remain candidates because their
    /// historical entity may be resolved from CTY at the QSO date.
    public func historyCandidates(call: String, adif: Int?) throws -> [QSO] {
        try historyCandidates(call: call, adif: adif, as: QSO.self)
    }

    public func historyRows(call: String, adif: Int?) throws -> [ContactHistoryRow] {
        try historyCandidates(call: call, adif: adif, as: ContactHistoryRow.self)
    }

    private func historyCandidates<T: Decodable>(call: String, adif: Int?, as type: T.Type) throws -> [T] {
        try lock.withLock {
            if let adif {
                return try withStatement("""
                    WITH candidates AS (
                        SELECT local_id FROM qsos INDEXED BY idx_qsos_call_live_nocase
                        WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE
                        UNION
                        SELECT local_id FROM qsos INDEXED BY idx_qsos_dxcc_live
                        WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) = ?
                        UNION
                        SELECT local_id FROM qsos INDEXED BY idx_qsos_dxcc_live
                        WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) IS NULL
                    )
                    SELECT qsos.record_json FROM candidates JOIN qsos USING(local_id)
                    ORDER BY qsos.qso_start DESC;
                    """) { statement in
                        bind(call.uppercased(), to: 1, in: statement)
                        sqlite3_bind_int(statement, 2, Int32(adif))
                        return try decodeRows(statement, as: type)
                    }
            }
            return try withStatement("""
                SELECT record_json FROM qsos WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE
                ORDER BY qso_start DESC;
                """) { statement in
                    bind(call.uppercased(), to: 1, in: statement)
                    return try decodeRows(statement, as: type)
                }
        }
    }

    public func count(search: String = "") throws -> Int {
        try lock.withLock {
            let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
            let filtered = !needle.isEmpty
            let sql = filtered
                ? "SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL AND (call LIKE ? OR record_json LIKE ?);"
                : "SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL;"
            return try withStatement(sql) { statement in
                if filtered {
                    let pattern = "%\(needle)%"
                    bind(pattern, to: 1, in: statement)
                    bind(pattern, to: 2, in: statement)
                }
                guard sqlite3_step(statement) == SQLITE_ROW else {
                    throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
                }
                return Int(sqlite3_column_int64(statement, 0))
            }
        }
    }

    public func pendingSyncCount() throws -> Int {
        try scalarCount("SELECT COUNT(*) FROM qsos WHERE is_dirty = 1;")
    }

    public func outboxCount() throws -> Int {
        try scalarCount("SELECT COUNT(*) FROM sync_outbox;")
    }

    private func scalarCount(_ sql: String) throws -> Int {
        try lock.withLock {
            try withStatement(sql) { statement in
                guard sqlite3_step(statement) == SQLITE_ROW else {
                    throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
                }
                return Int(sqlite3_column_int64(statement, 0))
            }
        }
    }

    /// Imports a bounded batch as one transaction, skipping identities already present.
    /// The original QSO and pending outbox state remain intact on any failure.
    public func importBatch(_ values: [QSO]) throws -> Int {
        try lock.withLock {
            var seen = Set<SemanticQSOIdentity>()
            var imported = 0
            try execute("BEGIN IMMEDIATE;")
            do {
                for value in values {
                    let identity = SemanticQSOIdentity(
                        call: value.call,
                        timestamp: ISO8601DateFormatter().string(from: value.start),
                        band: value.band,
                        mode: value.submode.isEmpty ? value.mode : value.submode
                    )
                    guard seen.insert(identity).inserted,
                          try lookupSemantic(value) == nil else { continue }
                    try save(value)
                    imported += 1
                }
                try execute("COMMIT;")
                return imported
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func previous(call: String, limit: Int = 20) throws -> [QSO] {
        try lock.withLock {
            try withStatement("SELECT record_json FROM qsos WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE ORDER BY qso_start DESC LIMIT ?;") { statement in
                bind(call, to: 1, in: statement)
                sqlite3_bind_int(statement, 2, Int32(limit))
                return try decodeRows(statement)
            }
        }
    }

    public func stats() throws -> LogbookStats {
        try lock.withLock {
            try refreshAggregateCacheVersion()
            let yearStart = Calendar(identifier: .gregorian).date(from: Calendar.current.dateComponents([.year], from: Date()))?.timeIntervalSince1970 ?? 0
            if let cachedStats, cachedStatsYearStart == yearStart { return cachedStats }
            let cacheKey = "stats-v1-\(yearStart)"
            if let value: LogbookStats = try persistedAggregate(cacheKey) {
                cachedStats = value
                cachedStatsYearStart = yearStart
                return value
            }
            let revision = try qsoRevision()
            let value: LogbookStats = try withStatement("""
                SELECT COUNT(*), COUNT(DISTINCT CASE WHEN json_extract(record_json,'$.dxcc') IS NOT NULL THEN json_extract(record_json,'$.dxcc') END),
                SUM(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V') OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END),
                SUM(CASE WHEN qso_start >= ? THEN 1 ELSE 0 END)
                FROM qsos INDEXED BY idx_qsos_metrics_live WHERE deleted_at IS NULL;
                """) { statement in
                    sqlite3_bind_double(statement, 1, yearStart)
                    guard sqlite3_step(statement) == SQLITE_ROW else { return .empty }
                    return LogbookStats(
                        qsoCount: Int(sqlite3_column_int(statement, 0)),
                        dxccCount: Int(sqlite3_column_int(statement, 1)),
                        confirmedCount: Int(sqlite3_column_int(statement, 2)),
                        thisYearCount: Int(sqlite3_column_int(statement, 3))
                    )
                }
            cachedStats = value
            cachedStatsYearStart = yearStart
            persistAggregate(value, key: cacheKey, revision: revision)
            return value
        }
    }

    public func awardProgress() throws -> AwardProgressSnapshot {
        try lock.withLock {
            try refreshAggregateCacheVersion()
            if let cachedAwards { return cachedAwards }
            // Bump this key if progress calculation semantics change.
            let cacheKey = "award-progress-v1"
            if let value: AwardProgressSnapshot = try persistedAggregate(cacheKey) {
                cachedAwards = value
                return value
            }
            let revision = try qsoRevision()
            let confirmed = "(UPPER(COALESCE(json_extract(record_json,'$.qslReceived'),'')) IN ('Y','V') OR UPPER(COALESCE(json_extract(record_json,'$.lotwReceived'),'')) IN ('Y','V'))"
            let effectiveMode = "UPPER(COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode))"
            let modeGroup = "CASE WHEN \(effectiveMode) = 'CW' THEN 'CW' WHEN \(effectiveMode) IN ('SSB','USB','LSB','AM','FM') THEN 'Phone' ELSE 'Digital' END"
            let validStates = Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(separator: " ").map(String.init))
            // One row projection replaces ten distinct aggregates plus four
            // independent scans. It never materializes or decodes QSO JSON.
            let value = try withStatement("""
                SELECT \(confirmed), CAST(json_extract(record_json,'$.dxcc') AS INTEGER),
                    CAST(json_extract(record_json,'$.cqZone') AS INTEGER),
                    UPPER(TRIM(COALESCE(json_extract(record_json,'$.state'),''))),
                    CASE WHEN LENGTH(TRIM(COALESCE(json_extract(record_json,'$.gridSquare'),''))) >= 4
                        THEN UPPER(SUBSTR(TRIM(json_extract(record_json,'$.gridSquare')),1,4)) END,
                    \(modeGroup), COALESCE(NULLIF(LOWER(band),''),'Unknown'),
                    COALESCE(NULLIF(UPPER(TRIM(json_extract(record_json,'$.continent'))),''),'Unknown'),
                    STRFTIME('%Y', qso_start, 'unixepoch')
                FROM qsos INDEXED BY idx_qsos_metrics_live WHERE deleted_at IS NULL;
                """) { statement -> AwardProgressSnapshot in
                func string(_ column: Int32) -> String? {
                    sqlite3_column_text(statement, column).map { String(cString: $0) }
                }
                func count(_ dictionary: inout [String: Int], _ key: String?) {
                    dictionary[(key?.isEmpty == false ? key : nil) ?? "Unknown", default: 0] += 1
                }
                var result = AwardProgressSnapshot()
                var workedDXCC = Set<Int>(), confirmedDXCC = Set<Int>()
                var workedZones = Set<Int>(), confirmedZones = Set<Int>()
                var workedStates = Set<String>(), confirmedStates = Set<String>()
                var workedGrids = Set<String>(), confirmedGrids = Set<String>()
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    result.qsoCount += 1
                    let isConfirmed = sqlite3_column_int(statement, 0) != 0
                    if isConfirmed { result.confirmedQSOs += 1 }
                    let dxcc = Int(sqlite3_column_int(statement, 1))
                    if dxcc > 0 {
                        workedDXCC.insert(dxcc)
                        if isConfirmed { confirmedDXCC.insert(dxcc) }
                    }
                    let zone = Int(sqlite3_column_int(statement, 2))
                    if (1...40).contains(zone) {
                        workedZones.insert(zone)
                        if isConfirmed { confirmedZones.insert(zone) }
                    }
                    if [291, 6, 110].contains(dxcc), let state = string(3), validStates.contains(state) {
                        workedStates.insert(state)
                        if isConfirmed { confirmedStates.insert(state) }
                    }
                    if let field = string(4) {
                        workedGrids.insert(field)
                        if isConfirmed { confirmedGrids.insert(field) }
                    }
                    count(&result.modeCounts, string(5))
                    count(&result.bandCounts, string(6))
                    count(&result.continentCounts, string(7))
                    count(&result.yearCounts, string(8))
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                result.dxccWorked = workedDXCC.count
                result.dxccConfirmed = confirmedDXCC.count
                result.cqZonesWorked = workedZones.count
                result.cqZonesConfirmed = confirmedZones.count
                result.statesWorked = workedStates.count
                result.statesConfirmed = confirmedStates.count
                result.gridsWorked = workedGrids.count
                result.gridsConfirmed = confirmedGrids.count
                return result
            }
            cachedAwards = value
            persistAggregate(value, key: cacheKey, revision: revision)
            return value
        }
    }

    /// One aggregate query for the map; never decode every QSO on every radio poll.
    public func dxccMapStatuses() throws -> [Int: String] {
        try lock.withLock {
            try refreshAggregateCacheVersion()
            if let cachedDXCCStatuses { return cachedDXCCStatuses }
            let cacheKey = "dxcc-map-v1"
            if let value: [Int: String] = try persistedAggregate(cacheKey) {
                cachedDXCCStatuses = value
                return value
            }
            let revision = try qsoRevision()
            let value = try withStatement("""
                SELECT CAST(json_extract(record_json,'$.dxcc') AS INTEGER),
                    MAX(CASE WHEN UPPER(COALESCE(json_extract(record_json,'$.qslReceived'),'')) IN ('Y','V')
                        OR UPPER(COALESCE(json_extract(record_json,'$.lotwReceived'),'')) IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos INDEXED BY idx_qsos_metrics_live
                WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) > 0
                GROUP BY CAST(json_extract(record_json,'$.dxcc') AS INTEGER);
                """) { statement in
                    var result: [Int: String] = [:]
                    while sqlite3_step(statement) == SQLITE_ROW {
                        result[Int(sqlite3_column_int(statement, 0))] = sqlite3_column_int(statement, 1) == 1 ? "confirmed" : "worked"
                    }
                    return result
                }
            cachedDXCCStatuses = value
            persistAggregate(value, key: cacheKey, revision: revision)
            return value
        }
    }

    public func awardCatalog() throws -> AwardCatalogSnapshot {
        try lock.withLock {
            try refreshAggregateCacheVersion()
            if let cachedAwardCatalog { return cachedAwardCatalog }
            let cacheKey = try AwardCatalogEngine.persistedCacheKey.get()
            if let value: AwardCatalogSnapshot = try persistedAggregate(cacheKey) {
                cachedAwardCatalog = value
                return value
            }
            let revision = try qsoRevision()
            // All current calculators are limited to Japan, WAPC entities,
            // or WCSA school calls. The slash arm is a portable-call superset.
            // `save` maintains the indexed call column alongside record_json;
            // use it to avoid parsing every full JSON blob on a cold open.
            let schools = try AwardCatalogEngine.candidateSchoolCalls()
            let placeholders = Array(repeating: "?", count: schools.count).joined(separator: ",")
            let entities = AwardCatalogEngine.candidateDXCCs.map(String.init).joined(separator: ",")
            let sql = """
                WITH candidates AS (
                    SELECT local_id FROM qsos
                    WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) IN (\(entities))
                    UNION
                    SELECT local_id FROM qsos INDEXED BY idx_qsos_call
                    WHERE INSTR(call,'/') > 0 OR UPPER(TRIM(call)) IN (\(placeholders))
                )
                SELECT qsos.record_json FROM candidates JOIN qsos USING (local_id)
                WHERE qsos.deleted_at IS NULL ORDER BY qsos.qso_start ASC;
                """
            let values = try withStatement(sql) { statement in
                for (index, call) in schools.enumerated() {
                    bind(call, to: Int32(index + 1), in: statement)
                }
                return try decodeRows(statement, as: AwardCatalogContact.self)
            }
            let catalog = try AwardCatalogEngine.compute(contacts: values)
            cachedAwardCatalog = catalog
            persistAggregate(catalog, key: cacheKey, revision: revision)
            return catalog
        }
    }

    /// Single narrow projection for worked/confirmed reference history. It
    /// does not decode QSO records or classify a missing/failed DB as "new".
    public func opportunityReferenceHistory() throws -> [OpportunityReferenceHistory] {
        try lock.withLock {
            try refreshAggregateCacheVersion()
            if let cachedOpportunityReferences { return cachedOpportunityReferences }
            struct Key: Hashable { let kind: String; let reference: String }
            struct BandModeKey: Hashable { let band: String; let mode: String }
            struct Tally { var worked = 0; var confirmed = 0; var cells: [BandModeKey: (Int, Int)] = [:] }
            let values = try withStatement("""
                SELECT json_extract(record_json,'$.potaReference'),
                    json_extract(record_json,'$.sotaReference'),
                    json_extract(record_json,'$.iota'),
                    json_extract(record_json,'$.wwffReference'),
                    json_extract(record_json,'$.sig'),
                    json_extract(record_json,'$.sigInfo'),
                    json_extract(record_json,'$.band'),
                    COALESCE(NULLIF(json_extract(record_json,'$.submode'),''),
                             json_extract(record_json,'$.mode')),
                    (UPPER(COALESCE(json_extract(record_json,'$.qslReceived'),'')) IN ('Y','V')
                     OR UPPER(COALESCE(json_extract(record_json,'$.lotwReceived'),'')) IN ('Y','V'))
                FROM qsos WHERE deleted_at IS NULL;
                """) { statement -> [OpportunityReferenceHistory] in
                func value(_ column: Int32) -> String {
                    sqlite3_column_text(statement, column).map { String(cString: $0) } ?? ""
                }
                func references(_ raw: String) -> Set<String> {
                    Set(raw.split(whereSeparator: { $0 == "," || $0 == ";" || $0.isNewline })
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
                        .filter { !$0.isEmpty })
                }
                var tallies: [Key: Tally] = [:]
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    let band = value(6).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                    let mode = value(7).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                    let confirmed = sqlite3_column_int(statement, 8) != 0
                    var entries = [("pota", value(0)), ("sota", value(1)),
                                   ("iota", value(2)), ("wwff", value(3))]
                    let sig = value(4).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                    if ["WCA", "COTA", "CASTLE"].contains(sig) { entries.append(("castle", value(5))) }
                    for (kind, raw) in entries {
                        for reference in references(raw) {
                            let key = Key(kind: kind, reference: reference)
                            var tally = tallies[key] ?? Tally()
                            tally.worked += 1
                            if confirmed { tally.confirmed += 1 }
                            let cell = BandModeKey(band: band, mode: mode)
                            var counts = tally.cells[cell] ?? (0, 0)
                            counts.0 += 1
                            if confirmed { counts.1 += 1 }
                            tally.cells[cell] = counts
                            tallies[key] = tally
                        }
                    }
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                return tallies.map { key, tally in
                    OpportunityReferenceHistory(
                        kind: key.kind, reference: key.reference,
                        workedCount: tally.worked, confirmedCount: tally.confirmed,
                        bandModes: tally.cells.map { cell, counts in
                            .init(band: cell.band, mode: cell.mode,
                                  workedCount: counts.0, confirmedCount: counts.1)
                        }.sorted { ($0.band, $0.mode) < ($1.band, $1.mode) }
                    )
                }.sorted { ($0.kind, $0.reference) < ($1.kind, $1.reference) }
            }
            cachedOpportunityReferences = values
            return values
        }
    }

    private func qsoRevision() throws -> Int64 {
        try withStatement("SELECT revision FROM xlog_qso_revision WHERE singleton = 1;") { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else { throw error() }
            return sqlite3_column_int64(statement, 0)
        }
    }

    private func persistedAggregate<T: Decodable>(_ key: String) throws -> T? {
        try withStatement("""
            SELECT payload FROM xlog_aggregate_cache c JOIN xlog_qso_revision r
                ON r.singleton = 1 AND c.revision = r.revision WHERE c.cache_key = ?;
            """) { statement in
            bind(key, to: 1, in: statement)
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW else { throw error() }
            guard let bytes = sqlite3_column_blob(statement, 0) else { return nil }
            let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
            // A damaged or obsolete derived payload is recomputed, never treated
            // as an empty logbook. Authoritative QSO data is not modified.
            return try? decoder.decode(T.self, from: data)
        }
    }

    private func persistAggregate<T: Encodable>(_ value: T, key: String, revision: Int64) {
        // An external writer may commit during calculation. Publish only if its
        // revision is still current in this atomic statement; otherwise a later
        // call recomputes. Cache write failure must not hide a valid calculation.
        try? withStatement("""
            INSERT OR REPLACE INTO xlog_aggregate_cache(cache_key, revision, payload)
                SELECT ?, ?, ? WHERE (SELECT revision FROM xlog_qso_revision WHERE singleton = 1) = ?;
            """) { statement in
            let data = try encoder.encode(value)
            bind(key, to: 1, in: statement)
            sqlite3_bind_int64(statement, 2, revision)
            _ = data.withUnsafeBytes { sqlite3_bind_blob(statement, 3, $0.baseAddress, Int32($0.count), Self.transient) }
            sqlite3_bind_int64(statement, 4, revision)
            try stepDone(statement)
        }
    }

    /// SQLite's data_version changes for commits made by other connections;
    /// this connection invalidates directly in save(), including sync merges.
    private func refreshAggregateCacheVersion() throws {
        let version = try withStatement("PRAGMA data_version;") { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
            }
            return Int(sqlite3_column_int64(statement, 0))
        }
        if let cachedDataVersion, cachedDataVersion != version { invalidateQSOAggregates() }
        cachedDataVersion = version
    }

    private func invalidateQSOAggregates() {
        cachedStats = nil
        cachedStatsYearStart = nil
        cachedAwards = nil
        cachedDXCCStatuses = nil
        cachedAwardCatalog = nil
        cachedOpportunityReferences = nil
        cachedClusterContactRows = nil
    }

    public func bandModeMatrix(call: String) throws -> Set<BandModeCell> {
        try lock.withLock {
            // A history page is not an award matrix: an older confirmation
            // must remain visible even after thousands of recent contacts.
            try withStatement("""
                SELECT band, COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode),
                    MAX(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V')
                        OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE
                GROUP BY band, COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode);
                """) { statement in
                bind(call, to: 1, in: statement)
                var cells: Set<BandModeCell> = []
                while sqlite3_step(statement) == SQLITE_ROW {
                    let band = sqlite3_column_text(statement, 0).map { String(cString: $0) } ?? ""
                    let mode = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""
                    cells.insert(BandModeCell(band: band, mode: mode, worked: true,
                                             confirmed: sqlite3_column_int(statement, 2) == 1))
                }
                return cells
            }
        }
    }

    public func dxccSummary(dxcc: Int) throws -> DXCCSummary {
        try lock.withLock {
            let predicate = "deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) = ?"
            let counts = try withStatement("""
                SELECT COUNT(*),
                SUM(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V')
                    OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos WHERE \(predicate);
                """) { statement -> (Int, Int) in
                    sqlite3_bind_int(statement, 1, Int32(dxcc))
                    guard sqlite3_step(statement) == SQLITE_ROW else { return (0, 0) }
                    return (Int(sqlite3_column_int(statement, 0)), Int(sqlite3_column_int(statement, 1)))
                }

            let matrix = try withStatement("""
                SELECT band,
                    COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode),
                    MAX(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V')
                        OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos WHERE \(predicate)
                GROUP BY band, COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode);
                """) { statement -> Set<BandModeCell> in
                    sqlite3_bind_int(statement, 1, Int32(dxcc))
                    var cells: Set<BandModeCell> = []
                    while sqlite3_step(statement) == SQLITE_ROW {
                        let band = sqlite3_column_text(statement, 0).map { String(cString: $0) } ?? ""
                        let mode = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""
                        cells.insert(BandModeCell(band: band, mode: mode, worked: true, confirmed: sqlite3_column_int(statement, 2) == 1))
                    }
                    return cells
                }

            let latest = try withStatement("SELECT record_json FROM qsos WHERE \(predicate) ORDER BY qso_start DESC LIMIT 1;") { statement -> QSO? in
                sqlite3_bind_int(statement, 1, Int32(dxcc))
                return try decodeRows(statement).first
            }
            return DXCCSummary(qsoCount: counts.0, confirmedCount: counts.1, matrix: matrix, latest: latest)
        }
    }

    public func pending(limit: Int = 100, includingDeferred: Bool = false) throws -> [QSO] {
        try lock.withLock {
            let dueClause = includingDeferred ? "" : "AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)"
            let sql = """
                SELECT q.record_json FROM qsos q
                LEFT JOIN sync_outbox o ON o.local_id = q.local_id
                WHERE q.is_dirty = 1 \(dueClause)
                ORDER BY q.updated_at ASC LIMIT ?;
                """
            return try withStatement(sql) { statement in
                var index: Int32 = 1
                if !includingDeferred {
                    sqlite3_bind_double(statement, index, Date().timeIntervalSince1970)
                    index += 1
                }
                sqlite3_bind_int(statement, index, Int32(limit))
                return try decodeRows(statement)
            }
        }
    }

    public func outboxEntries(limit: Int = 500) throws -> [SyncOutboxEntry] {
        try lock.withLock {
            try withStatement("""
                SELECT q.record_json, COALESCE(o.attempt_count, 0), o.last_attempt_at, o.next_attempt_at, o.last_error
                FROM qsos q LEFT JOIN sync_outbox o ON o.local_id = q.local_id
                WHERE q.is_dirty = 1
                ORDER BY COALESCE(o.next_attempt_at, q.updated_at) ASC LIMIT ?;
                """) { statement in
                sqlite3_bind_int(statement, 1, Int32(limit))
                var values: [SyncOutboxEntry] = []
                while sqlite3_step(statement) == SQLITE_ROW {
                    guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
                    let qso = try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
                    let attempts = Int(sqlite3_column_int(statement, 1))
                    let lastAttempt = sqlite3_column_type(statement, 2) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 2))
                    let nextAttempt = sqlite3_column_type(statement, 3) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 3))
                    let error = sqlite3_column_text(statement, 4).map { String(cString: $0) }
                    values.append(.init(qso: qso, attemptCount: attempts, lastAttemptAt: lastAttempt, nextAttemptAt: nextAttempt, lastError: error))
                }
                return values
            }
        }
    }

    public func recordSyncFailure(localID: UUID, message: String, at date: Date = Date()) throws {
        try lock.withLock {
            let previousAttempts = try withStatement("SELECT attempt_count FROM sync_outbox WHERE local_id = ? LIMIT 1;") { statement -> Int in
                bind(localID.uuidString, to: 1, in: statement)
                return sqlite3_step(statement) == SQLITE_ROW ? Int(sqlite3_column_int(statement, 0)) : 0
            }
            let attemptCount = previousAttempts + 1
            let delay = min(3_600.0, 30.0 * pow(2.0, Double(min(previousAttempts, 7))))
            try withStatement("""
                INSERT INTO sync_outbox(local_id, attempt_count, last_attempt_at, next_attempt_at, last_error)
                VALUES(?,?,?,?,?)
                ON CONFLICT(local_id) DO UPDATE SET
                  attempt_count=excluded.attempt_count,
                  last_attempt_at=excluded.last_attempt_at,
                  next_attempt_at=excluded.next_attempt_at,
                  last_error=excluded.last_error;
                """) { statement in
                bind(localID.uuidString, to: 1, in: statement)
                sqlite3_bind_int(statement, 2, Int32(attemptCount))
                sqlite3_bind_double(statement, 3, date.timeIntervalSince1970)
                sqlite3_bind_double(statement, 4, date.addingTimeInterval(delay).timeIntervalSince1970)
                bind(message, to: 5, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func retrySync(localID: UUID) throws {
        try lock.withLock {
            try withStatement("UPDATE sync_outbox SET next_attempt_at = NULL WHERE local_id = ?;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func clearSyncFailure(localID: UUID) throws {
        try lock.withLock {
            try withStatement("DELETE FROM sync_outbox WHERE local_id = ?;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func markSynced(localID: UUID, wavelogID: Int? = nil) throws {
        try lock.withLock {
            guard var qso = try lookup(localID: localID) else { return }
            if let wavelogID { qso.wavelogID = wavelogID }
            qso.isDirty = false
            try save(qso, markDirty: false)
            try clearSyncFailure(localID: localID)
        }
    }

    public func possibleDuplicate(call: String, band: String, mode: String, around date: Date, within seconds: TimeInterval = 600) throws -> QSO? {
        try lock.withLock {
            try withStatement("""
                SELECT record_json FROM qsos
                WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE AND band = ? COLLATE NOCASE
                  AND mode = ? COLLATE NOCASE AND ABS(qso_start - ?) <= ?
                ORDER BY ABS(qso_start - ?) ASC LIMIT 1;
                """) { statement in
                bind(call, to: 1, in: statement)
                bind(band, to: 2, in: statement)
                bind(mode, to: 3, in: statement)
                sqlite3_bind_double(statement, 4, date.timeIntervalSince1970)
                sqlite3_bind_double(statement, 5, seconds)
                sqlite3_bind_double(statement, 6, date.timeIntervalSince1970)
                return try decodeRows(statement).first
            }
        }
    }

    @discardableResult
    public func mergeRemote(_ remote: QSO) throws -> Bool {
        try lock.withLock {
            if let remoteID = remote.wavelogID, let existing = try lookup(wavelogID: remoteID), existing.isDirty {
                if try remoteMatchesBaseline(remote, localID: existing.id) { return false }
                try recordConflict(local: existing, remote: mergeRemoteFields(remote, preserving: existing))
                return true
            }
            var value = remote
            if let remoteID = value.wavelogID, let existing = try lookup(wavelogID: remoteID) {
                value = mergeRemoteFields(value, preserving: existing)
            }
            else if let existing = try lookupSemantic(value) {
                if existing.isDirty {
                    if try remoteMatchesBaseline(remote, localID: existing.id) { return false }
                    try recordConflict(local: existing, remote: mergeRemoteFields(remote, preserving: existing))
                    return true
                }
                value = mergeRemoteFields(value, preserving: existing)
            }
            try save(value, markDirty: false)
            return false
        }
    }

    /// Reconciles one Wavelog page in a single SQLite transaction. Initial
    /// station imports can contain tens of thousands of QSOs, so committing
    /// every row individually would make automatic sync effectively
    /// continuous on a large logbook.
    public func mergeRemoteBatch(_ remotes: [QSO]) throws -> Int {
        try lock.withLock {
            guard !remotes.isEmpty else { return 0 }
            try execute("BEGIN IMMEDIATE;")
            do {
                var conflicts = 0
                for remote in remotes where try mergeRemote(remote) {
                    conflicts += 1
                }
                try execute("COMMIT;")
                return conflicts
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func conflicts() throws -> [SyncConflict] {
        try lock.withLock {
            try withStatement("SELECT conflict_json FROM sync_conflicts ORDER BY detected_at DESC;") { statement in
                var values: [SyncConflict] = []
                while sqlite3_step(statement) == SQLITE_ROW {
                    guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
                    values.append(try decoder.decode(SyncConflict.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))))
                }
                return values
            }
        }
    }

    public func resolveConflict(_ conflict: SyncConflict, useRemote: Bool) throws {
        try lock.withLock {
            if useRemote {
                var remote = conflict.remoteQSO
                remote.id = conflict.localQSO.id
                try save(remote, markDirty: false)
            } else {
                try save(conflict.localQSO, markDirty: true)
            }
            try withStatement("DELETE FROM sync_conflicts WHERE conflict_id = ?;") { statement in
                bind(conflict.id.uuidString, to: 1, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func resolveConflict(_ conflict: SyncConflict, merged: QSO) throws {
        try lock.withLock {
            var value = merged
            value.id = conflict.localQSO.id
            value.wavelogID = conflict.remoteQSO.wavelogID ?? conflict.localQSO.wavelogID
            try save(value, markDirty: true)
            try withStatement("DELETE FROM sync_conflicts WHERE conflict_id = ?;") { statement in
                bind(conflict.id.uuidString, to: 1, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func hasConflict(localID: UUID) throws -> Bool {
        try lock.withLock {
            try withStatement("SELECT 1 FROM sync_conflicts WHERE local_id = ? LIMIT 1;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                return sqlite3_step(statement) == SQLITE_ROW
            }
        }
    }

    @discardableResult
    public func recordRemoteDeletionConflicts(notIn remoteIDs: Set<Int>) throws -> Int {
        try lock.withLock {
            let dirtyRemote = try withStatement("SELECT record_json FROM qsos WHERE wavelog_id IS NOT NULL AND is_dirty = 1 AND deleted_at IS NULL;") {
                try decodeRows($0)
            }
            var count = 0
            for local in dirtyRemote {
                guard let remoteID = local.wavelogID, !remoteIDs.contains(remoteID), try !hasConflict(localID: local.id) else { continue }
                var deletedRemote = local
                deletedRemote.isDirty = false
                deletedRemote.deletedAt = Date()
                try recordConflict(local: local, remote: deletedRemote)
                count += 1
            }
            return count
        }
    }

    public func softDelete(_ qso: QSO) throws {
        var deleted = qso
        deleted.deletedAt = Date()
        try save(deleted)
    }

    public func removeCleanRemoteRecords(notIn remoteIDs: Set<Int>) throws -> Int {
        try lock.withLock {
            let candidates = try withStatement("SELECT record_json FROM qsos WHERE wavelog_id IS NOT NULL AND is_dirty = 0 AND deleted_at IS NULL;") {
                try decodeRows($0)
            }
            var removed = 0
            for var qso in candidates {
                guard let remoteID = qso.wavelogID, !remoteIDs.contains(remoteID) else { continue }
                qso.deletedAt = Date()
                try save(qso, markDirty: false)
                removed += 1
            }
            return removed
        }
    }

    public func lookup(localID: UUID) throws -> QSO? {
        try lock.withLock {
            try lookup(sql: "SELECT record_json FROM qsos WHERE local_id = ? LIMIT 1;", value: localID.uuidString)
        }
    }

    private func lookup(wavelogID: Int) throws -> QSO? {
        try withStatement("SELECT record_json FROM qsos WHERE wavelog_id = ? LIMIT 1;") { statement in
            sqlite3_bind_int64(statement, 1, Int64(wavelogID))
            return try decodeRows(statement).first
        }
    }

    private func lookupSemantic(_ qso: QSO) throws -> QSO? {
        try withStatement("""
            SELECT record_json FROM qsos
            WHERE call = ? COLLATE NOCASE AND ABS(qso_start - ?) < 1
              AND band = ? COLLATE NOCASE AND mode = ? COLLATE NOCASE
            LIMIT 1;
            """) { statement in
                bind(qso.call, to: 1, in: statement)
                sqlite3_bind_double(statement, 2, qso.start.timeIntervalSince1970)
                bind(qso.band, to: 3, in: statement)
                bind(qso.mode, to: 4, in: statement)
                return try decodeRows(statement).first
            }
    }

    private func lookup(sql: String, value: String) throws -> QSO? {
        try withStatement(sql) { statement in
            bind(value, to: 1, in: statement)
            return try decodeRows(statement).first
        }
    }

    private func migrate() throws {
        try execute("""
        CREATE TABLE IF NOT EXISTS qsos(
          local_id TEXT PRIMARY KEY,
          wavelog_id INTEGER UNIQUE,
          call TEXT NOT NULL,
          qso_start REAL NOT NULL,
          band TEXT NOT NULL,
          mode TEXT NOT NULL,
          frequency_hz INTEGER,
          is_dirty INTEGER NOT NULL DEFAULT 1,
          deleted_at REAL,
          updated_at REAL NOT NULL,
          record_json BLOB NOT NULL,
          baseline_json BLOB
        );
        CREATE INDEX IF NOT EXISTS idx_qsos_call ON qsos(call);
        CREATE INDEX IF NOT EXISTS idx_qsos_call_live_nocase
          ON qsos(call COLLATE NOCASE, qso_start DESC) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_qsos_semantic
          ON qsos(call COLLATE NOCASE, band COLLATE NOCASE, mode COLLATE NOCASE, qso_start);
        -- Keep the exact source JSON values in a covering read index. SQLite
        -- maintains these derived values for all writers; no QSO is rewritten.
        CREATE INDEX IF NOT EXISTS idx_qsos_metrics_live ON qsos(
          CAST(json_extract(record_json,'$.dxcc') AS INTEGER),
          json_extract(record_json,'$.dxcc'), json_extract(record_json,'$.cqZone'),
          json_extract(record_json,'$.state'), json_extract(record_json,'$.gridSquare'),
          json_extract(record_json,'$.submode'), json_extract(record_json,'$.qslReceived'),
          json_extract(record_json,'$.lotwReceived'), json_extract(record_json,'$.continent'),
          band, mode, qso_start
        ) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_qsos_start ON qsos(qso_start DESC);
        CREATE INDEX IF NOT EXISTS idx_qsos_dxcc_live
          ON qsos(CAST(json_extract(record_json,'$.dxcc') AS INTEGER), qso_start DESC)
          WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_qsos_dirty ON qsos(is_dirty, updated_at);
        CREATE TABLE IF NOT EXISTS xlog_qso_revision(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          revision INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO xlog_qso_revision(singleton, revision) VALUES(1, 0);
        CREATE TABLE IF NOT EXISTS xlog_aggregate_cache(
          cache_key TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          payload BLOB NOT NULL
        );
        CREATE TRIGGER IF NOT EXISTS xlog_qso_revision_insert AFTER INSERT ON qsos BEGIN
          UPDATE xlog_qso_revision SET revision = revision + 1 WHERE singleton = 1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_qso_revision_update AFTER UPDATE ON qsos BEGIN
          UPDATE xlog_qso_revision SET revision = revision + 1 WHERE singleton = 1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_qso_revision_delete AFTER DELETE ON qsos BEGIN
          UPDATE xlog_qso_revision SET revision = revision + 1 WHERE singleton = 1;
        END;
        CREATE TABLE IF NOT EXISTS sync_conflicts(
          conflict_id TEXT PRIMARY KEY,
          local_id TEXT NOT NULL,
          detected_at REAL NOT NULL,
          conflict_json BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conflicts_detected ON sync_conflicts(detected_at DESC);
        CREATE TABLE IF NOT EXISTS xlog_operator_draft(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_operator_receipts(
          operation_id TEXT PRIMARY KEY,
          action TEXT NOT NULL CHECK(action IN ('replace','clear','save')),
          revision INTEGER NOT NULL,
          payload BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_transient_receipts
          ON xlog_operator_receipts(revision) WHERE action <> 'save';
        CREATE TABLE IF NOT EXISTS xlog_contact_revisions(
          local_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL CHECK(revision >= 0 AND revision <= 9007199254740991)
        );
        CREATE TRIGGER IF NOT EXISTS xlog_contact_revision_insert AFTER INSERT ON qsos BEGIN
          INSERT INTO xlog_contact_revisions(local_id,revision) VALUES(NEW.local_id,1)
          ON CONFLICT(local_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_contact_revision_update AFTER UPDATE ON qsos BEGIN
          INSERT INTO xlog_contact_revisions(local_id,revision) VALUES(NEW.local_id,1)
          ON CONFLICT(local_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_contact_revision_delete AFTER DELETE ON qsos BEGIN
          INSERT INTO xlog_contact_revisions(local_id,revision) VALUES(OLD.local_id,1)
          ON CONFLICT(local_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TABLE IF NOT EXISTS xlog_contact_receipts(
          operation_id TEXT PRIMARY KEY,
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_outbox(
          local_id TEXT PRIMARY KEY,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_attempt_at REAL,
          next_attempt_at REAL,
          last_error TEXT
        );
        """)
        try? execute("ALTER TABLE qsos ADD COLUMN baseline_json BLOB;")
    }

    private func recordConflict(local: QSO, remote: QSO) throws {
        if try hasConflict(localID: local.id) { return }
        let conflict = SyncConflict(localQSO: local, remoteQSO: remote)
        let data = try encoder.encode(conflict)
        try withStatement("INSERT OR REPLACE INTO sync_conflicts(conflict_id,local_id,detected_at,conflict_json) VALUES(?,?,?,?);") { statement in
            bind(conflict.id.uuidString, to: 1, in: statement)
            bind(local.id.uuidString, to: 2, in: statement)
            sqlite3_bind_double(statement, 3, conflict.detectedAt.timeIntervalSince1970)
            _ = data.withUnsafeBytes { bytes in sqlite3_bind_blob(statement, 4, bytes.baseAddress, Int32(bytes.count), Self.transient) }
            try stepDone(statement)
        }
    }

    private func remoteMatchesBaseline(_ remote: QSO, localID: UUID) throws -> Bool {
        try withStatement("SELECT baseline_json FROM qsos WHERE local_id = ? LIMIT 1;") { statement in
            bind(localID.uuidString, to: 1, in: statement)
            guard sqlite3_step(statement) == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { return false }
            let baseline = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
            return try decoder.decode(SyncedQSOState.self, from: baseline) == SyncedQSOState(remote)
        }
    }

    private func syncFingerprint(_ value: QSO) throws -> Data {
        try encoder.encode(SyncedQSOState(value))
    }

    private func mergeRemoteFields(_ remote: QSO, preserving local: QSO) -> QSO {
        var value = remote
        value.id = local.id
        value.end = local.end
        if value.country.isEmpty { value.country = local.country }
        if value.dxcc == nil { value.dxcc = local.dxcc }
        if value.continent.isEmpty { value.continent = local.continent }
        value.sig = local.sig
        value.sigInfo = local.sigInfo
        value.dok = local.dok
        value.stationLocation = local.stationLocation
        value.radio = local.radio
        value.operatorCall = local.operatorCall
        value.myCall = local.myCall
        value.myGrid = local.myGrid
        value.antennaPath = local.antennaPath
        value.email = local.email
        if value.qslSent.isEmpty { value.qslSent = local.qslSent }
        if value.qslReceived.isEmpty { value.qslReceived = local.qslReceived }
        if value.qslMethod.isEmpty { value.qslMethod = local.qslMethod }
        value.qslMessage = local.qslMessage
        if value.lotwSent.isEmpty { value.lotwSent = local.lotwSent }
        if value.lotwReceived.isEmpty { value.lotwReceived = local.lotwReceived }
        value.extraFields = local.extraFields.merging(remote.extraFields) { _, remoteValue in remoteValue }
        return value
    }

    private func decodeRows(_ statement: OpaquePointer?) throws -> [QSO] {
        try decodeRows(statement, as: QSO.self)
    }

    private func decodeRows<T: Decodable>(_ statement: OpaquePointer?, as type: T.Type) throws -> [T] {
        var values: [T] = []
        var step = sqlite3_step(statement)
        while step == SQLITE_ROW {
            guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
            let count = Int(sqlite3_column_bytes(statement, 0))
            values.append(try decoder.decode(type, from: Data(bytes: bytes, count: count)))
            step = sqlite3_step(statement)
        }
        guard step == SQLITE_DONE else { throw error() }
        return values
    }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw error() }
    }

    private func withStatement<T>(_ sql: String, _ body: (OpaquePointer?) throws -> T) throws -> T {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { throw error() }
        defer { sqlite3_finalize(statement) }
        return try body(statement)
    }

    private func stepDone(_ statement: OpaquePointer?) throws {
        guard sqlite3_step(statement) == SQLITE_DONE else { throw error() }
    }

    private func bind(_ value: String?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_text(statement, index, value, -1, Self.transient)
    }

    private func bind(_ value: Int?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_int64(statement, index, Int64(value))
    }

    private func bind(_ value: Int64?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_int64(statement, index, value)
    }

    private func error() -> LogbookDatabaseError {
        .sqlite(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error")
    }
}

private struct SyncedQSOState: Codable, Equatable {
    let wavelogID: Int?
    let call: String
    let start: Date
    let band: String
    let mode: String
    let submode: String
    let frequencyHz: Int64?
    let receiveFrequencyHz: Int64?
    let receiveBand: String
    let rstSent: String
    let rstReceived: String
    let name: String
    let gridSquare: String
    let cqZone: String
    let ituZone: String
    let state: String
    let county: String
    let qth: String
    let iota: String
    let sotaReference: String
    let potaReference: String
    let wwffReference: String
    let comment: String
    let notes: String
    let stationProfileID: Int?
    let txPower: String
    let propagationMode: String
    let qslVia: String

    init(_ value: QSO) {
        wavelogID = value.wavelogID
        call = value.call
        start = value.start
        band = value.band
        mode = value.mode
        submode = value.submode
        frequencyHz = value.frequencyHz
        receiveFrequencyHz = value.receiveFrequencyHz
        receiveBand = value.receiveBand
        rstSent = value.rstSent
        rstReceived = value.rstReceived
        name = value.name
        gridSquare = value.gridSquare
        cqZone = value.cqZone
        ituZone = value.ituZone
        state = value.state
        county = value.county
        qth = value.qth
        iota = value.iota
        sotaReference = value.sotaReference
        potaReference = value.potaReference
        wwffReference = value.wwffReference
        comment = value.comment
        notes = value.notes
        stationProfileID = value.stationProfileID
        txPower = value.txPower
        propagationMode = value.propagationMode
        qslVia = value.qslVia
    }
}

private extension NSRecursiveLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try body()
    }
}
