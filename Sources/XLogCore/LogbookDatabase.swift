import Foundation
import SQLite3

public enum LogbookDatabaseError: Error, LocalizedError {
    case open(String)
    case sqlite(String)
    case corruptRecord

    public var errorDescription: String? {
        switch self {
        case let .open(message): return "Could not open the xLog database: \(message)"
        case let .sqlite(message): return "xLog database error: \(message)"
        case .corruptRecord: return "A stored QSO could not be decoded."
        }
    }
}

public final class LogbookDatabase: @unchecked Sendable {
    private var handle: OpaquePointer?
    private let lock = NSRecursiveLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

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

    deinit { sqlite3_close(handle) }

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
        }
    }

    public func fetch(limit: Int = 500, search: String = "") throws -> [QSO] {
        try lock.withLock {
            let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
            let filtered = !needle.isEmpty
            let sql = filtered
                ? "SELECT record_json FROM qsos WHERE deleted_at IS NULL AND (call LIKE ? OR record_json LIKE ?) ORDER BY qso_start DESC LIMIT ?;"
                : "SELECT record_json FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC LIMIT ?;"
            return try withStatement(sql) { statement in
                if filtered {
                    let pattern = "%\(needle)%"
                    bind(pattern, to: 1, in: statement); bind(pattern, to: 2, in: statement)
                    sqlite3_bind_int(statement, 3, Int32(limit))
                } else {
                    sqlite3_bind_int(statement, 1, Int32(limit))
                }
                return try decodeRows(statement)
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
            let yearStart = Calendar(identifier: .gregorian).date(from: Calendar.current.dateComponents([.year], from: Date()))?.timeIntervalSince1970 ?? 0
            return try withStatement("""
                SELECT COUNT(*), COUNT(DISTINCT CASE WHEN json_extract(record_json,'$.dxcc') IS NOT NULL THEN json_extract(record_json,'$.dxcc') END),
                SUM(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V') OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END),
                SUM(CASE WHEN qso_start >= ? THEN 1 ELSE 0 END)
                FROM qsos WHERE deleted_at IS NULL;
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
        }
    }

    public func bandModeMatrix(call: String) throws -> Set<BandModeCell> {
        let values = try previous(call: call, limit: 2_000)
        var cells: Set<BandModeCell> = []
        for qso in values {
            cells.insert(BandModeCell(band: qso.band, mode: qso.submode.isEmpty ? qso.mode : qso.submode, worked: true, confirmed: qso.isConfirmed))
        }
        return cells
    }

    public func pending(limit: Int = 100) throws -> [QSO] {
        try lock.withLock {
            try withStatement("SELECT record_json FROM qsos WHERE is_dirty = 1 ORDER BY updated_at ASC LIMIT ?;") { statement in
                sqlite3_bind_int(statement, 1, Int32(limit))
                return try decodeRows(statement)
            }
        }
    }

    public func markSynced(localID: UUID, wavelogID: Int? = nil) throws {
        try lock.withLock {
            guard var qso = try lookup(localID: localID) else { return }
            if let wavelogID { qso.wavelogID = wavelogID }
            qso.isDirty = false
            try save(qso, markDirty: false)
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

    private func lookup(localID: UUID) throws -> QSO? {
        try lookup(sql: "SELECT record_json FROM qsos WHERE local_id = ? LIMIT 1;", value: localID.uuidString)
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
        CREATE INDEX IF NOT EXISTS idx_qsos_start ON qsos(qso_start DESC);
        CREATE INDEX IF NOT EXISTS idx_qsos_dirty ON qsos(is_dirty, updated_at);
        CREATE TABLE IF NOT EXISTS sync_conflicts(
          conflict_id TEXT PRIMARY KEY,
          local_id TEXT NOT NULL,
          detected_at REAL NOT NULL,
          conflict_json BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conflicts_detected ON sync_conflicts(detected_at DESC);
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
        var values: [QSO] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
            let count = Int(sqlite3_column_bytes(statement, 0))
            values.append(try decoder.decode(QSO.self, from: Data(bytes: bytes, count: count)))
        }
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
