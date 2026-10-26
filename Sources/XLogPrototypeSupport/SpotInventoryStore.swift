#if os(macOS)
import Foundation
import CSQLitePrototype

/// Durable per-receipt updates; SQLite arbitrates separate replacement workers.
/// The legacy JSON is retained as a recovery artifact and imported exactly once.
final class SpotInventoryStore {
    private var database: OpaquePointer?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(database); database = nil
            throw failure()
        }
        sqlite3_busy_timeout(database, 5_000)
        do {
            try execute("PRAGMA journal_mode=WAL;")
            try execute("PRAGMA synchronous=FULL;")
            try execute("CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, payload BLOB NOT NULL, accepted_at REAL NOT NULL);")
            try execute("CREATE INDEX IF NOT EXISTS receipts_age ON receipts(accepted_at);")
            try execute("CREATE TABLE IF NOT EXISTS migration (version INTEGER PRIMARY KEY CHECK(version=1));")
            try execute("CREATE TABLE IF NOT EXISTS pending_deliveries (key TEXT PRIMARY KEY, payload BLOB NOT NULL);")
        } catch { sqlite3_close(database); database = nil; throw error }
    }

    deinit { sqlite3_close(database) }

    func migrate(_ legacy: () throws -> [(String, Data, TimeInterval)]) throws {
        try transaction {
            let initialized = try statement("SELECT version FROM migration;") { sqlite3_step($0) == SQLITE_ROW }
            guard !initialized else { return }
            for (key, payload, date) in try legacy() { try put(key: key, payload: payload, date: date) }
            try execute("INSERT INTO migration VALUES(1);")
        }
    }

    func rows() throws -> [Data] {
        try statement("SELECT payload FROM receipts ORDER BY accepted_at,key;") { handle in
            var rows: [Data] = []
            var result = sqlite3_step(handle)
            while result == SQLITE_ROW {
                guard let bytes = sqlite3_column_blob(handle, 0) else { throw failure() }
                rows.append(Data(bytes: bytes, count: Int(sqlite3_column_bytes(handle, 0))))
                result = sqlite3_step(handle)
            }
            guard result == SQLITE_DONE else { throw failure() }
            return rows
        }
    }

    func accept(key: String, payload: Data, date: TimeInterval, finishingDelivery: String? = nil) throws {
        try transaction {
            try put(key: key, payload: payload, date: date)
            if let finishingDelivery { try removeDelivery(finishingDelivery) }
            try execute("DELETE FROM receipts WHERE key IN (SELECT key FROM receipts ORDER BY accepted_at DESC,key DESC LIMIT -1 OFFSET 4096);")
        }
    }

    func beginDelivery(_ key: String, payload: Data) throws {
        try transaction {
            let count = try statement("SELECT count(*) FROM pending_deliveries;") { handle in
                guard sqlite3_step(handle) == SQLITE_ROW else { throw failure() }
                return sqlite3_column_int(handle, 0)
            }
            guard count < 256 else { throw failure() }
            try retainDelivery(key, payload: payload)
        }
    }

    func retainDelivery(_ key: String, payload: Data) throws {
        try statement("INSERT INTO pending_deliveries VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload;") { handle in
            bind(key, to: 1, in: handle); bind(payload, to: 2, in: handle)
            guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
        }
    }

    func pendingDeliveries() throws -> [Data] {
        try statement("SELECT payload FROM pending_deliveries ORDER BY key;") { handle in
            var rows: [Data] = []
            var step = sqlite3_step(handle)
            while step == SQLITE_ROW {
                guard rows.count < 256, let bytes = sqlite3_column_blob(handle, 0),
                      (1...4096).contains(Int(sqlite3_column_bytes(handle, 0))) else { throw failure() }
                rows.append(Data(bytes: bytes, count: Int(sqlite3_column_bytes(handle, 0))))
                step = sqlite3_step(handle)
            }
            guard step == SQLITE_DONE else { throw failure() }
            return rows
        }
    }

    func removeDelivery(_ key: String) throws {
        try statement("DELETE FROM pending_deliveries WHERE key=?;") { handle in
            bind(key, to: 1, in: handle)
            guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
        }
    }

    /// Conditional deletion cannot erase a newer receipt accepted during await.
    func remove(key: String, payload: Data? = nil) throws {
        try statement(payload == nil ? "DELETE FROM receipts WHERE key=?;" : "DELETE FROM receipts WHERE key=? AND payload=?;") { handle in
            bind(key, to: 1, in: handle)
            if let payload { bind(payload, to: 2, in: handle) }
            guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
        }
    }

    private func put(key: String, payload: Data, date: TimeInterval) throws {
        try statement("INSERT INTO receipts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,accepted_at=excluded.accepted_at;") { handle in
            bind(key, to: 1, in: handle); bind(payload, to: 2, in: handle)
            sqlite3_bind_double(handle, 3, date)
            guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
        }
    }

    private func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE;")
        do { try body(); try execute("COMMIT;") }
        catch { try? execute("ROLLBACK;"); throw error }
    }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw failure() }
    }

    private func statement<T>(_ sql: String, _ body: (OpaquePointer?) throws -> T) throws -> T {
        var handle: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &handle, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(handle) }
        return try body(handle)
    }

    private func bind(_ value: String, to index: Int32, in handle: OpaquePointer?) {
        _ = value.withCString { sqlite3_bind_text(handle, index, $0, -1, Self.transient) }
    }

    private func bind(_ value: Data, to index: Int32, in handle: OpaquePointer?) {
        _ = value.withUnsafeBytes { sqlite3_bind_blob(handle, index, $0.baseAddress, Int32($0.count), Self.transient) }
    }

    private func failure() -> WorkerFailure {
        WorkerFailure("spot_inventory_unavailable", "The xLog radio spot inventory could not be updated; retained radio identities were preserved.")
    }
}
#endif
