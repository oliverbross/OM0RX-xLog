#if os(macOS)
import Foundation
import CSQLitePrototype
import Darwin

/// Durable per-receipt updates; SQLite arbitrates separate replacement workers.
/// The legacy JSON is retained as a recovery artifact and imported exactly once.
final class SpotInventoryStore {
    private var database: OpaquePointer?
    private let url: URL
    private let publisher = UUID().uuidString
    private var publisherLock: Int32 = -1
    private static let publishersLock = NSLock()
    nonisolated(unsafe) private static var livePublishers = Set<String>()
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL) throws {
        self.url = url
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
            try execute("CREATE TABLE IF NOT EXISTS quarantined_deliveries (key TEXT PRIMARY KEY, payload BLOB NOT NULL, identity TEXT);")
            try execute("CREATE UNIQUE INDEX IF NOT EXISTS quarantined_delivery_identity ON quarantined_deliveries(identity) WHERE identity IS NOT NULL;")
            try execute("CREATE TABLE IF NOT EXISTS active_delivery_leases (identity TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, publisher TEXT NOT NULL, archive_identity TEXT);")
            publisherLock = try openPublisherLock(publisher)
            guard flock(publisherLock, LOCK_EX | LOCK_NB) == 0 else { throw failure() }
            Self.publishersLock.withLock { _ = Self.livePublishers.insert(publisher) }
            try transaction { try recoverInactiveDeliveries() }
        } catch {
            Self.publishersLock.withLock { _ = Self.livePublishers.remove(publisher) }
            if publisherLock >= 0 { close(publisherLock); publisherLock = -1 }
            sqlite3_close(database); database = nil; throw error
        }
    }

    deinit {
        Self.publishersLock.withLock { _ = Self.livePublishers.remove(publisher) }
        if publisherLock >= 0 { close(publisherLock) }
        sqlite3_close(database)
    }

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
            if let finishingDelivery {
                try deleteDelivery(finishingDelivery, table: "pending_deliveries")
                try deleteDelivery(finishingDelivery, table: "quarantined_deliveries")
                try deleteDelivery(finishingDelivery, table: "active_delivery_leases")
            }
            try execute("DELETE FROM receipts WHERE key IN (SELECT key FROM receipts ORDER BY accepted_at DESC,key DESC LIMIT -1 OFFSET 4096);")
        }
    }

    struct DeliveryReservation {
        let key: String
        let payload: Data
        let hadPriorUncertainty: Bool
    }

    /// A SQLite lease coalesces a logical spot across worker processes. Only
    /// currently executing attempts consume admission capacity; uncertainty is
    /// retained separately and reused on a later settled retry.
    func reserveDelivery(identity: String, leaseIdentity: String, payload: (String, Data?) throws -> Data) throws -> DeliveryReservation {
        try transaction {
            try recoverInactiveDeliveries()
            let occupied = try statement("SELECT 1 FROM active_delivery_leases WHERE identity=?;") { handle in
                bind(leaseIdentity, to: 1, in: handle)
                return sqlite3_step(handle) == SQLITE_ROW
            }
            guard !occupied else { throw WorkerFailure("spot_broker_busy", "This radio spot already has an active delivery attempt.") }
            let count = try statement("SELECT count(*) FROM active_delivery_leases;") { handle in
                guard sqlite3_step(handle) == SQLITE_ROW else { throw failure() }
                return sqlite3_column_int(handle, 0)
            }
            guard count < 256 else { throw WorkerFailure("spot_broker_busy", "Radio spot delivery capacity is busy; retained uncertainty was preserved.") }
            let previous: (String, Data)? = try statement("SELECT key,payload FROM quarantined_deliveries WHERE identity=?;") { handle in
                bind(identity, to: 1, in: handle)
                let step = sqlite3_step(handle)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let key = sqlite3_column_text(handle, 0), let bytes = sqlite3_column_blob(handle, 1) else { throw failure() }
                return (String(cString: key), Data(bytes: bytes, count: Int(sqlite3_column_bytes(handle, 1))))
            }
            let key = UUID().uuidString
            let encoded = try payload(key, previous?.1)
            try statement("INSERT INTO pending_deliveries(key,payload) VALUES(?,?);") { handle in
                bind(key, to: 1, in: handle); bind(encoded, to: 2, in: handle)
                guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
            }
            try statement("INSERT INTO active_delivery_leases(identity,key,publisher,archive_identity) VALUES(?,?,?,?);") { handle in
                bind(leaseIdentity, to: 1, in: handle); bind(key, to: 2, in: handle); bind(publisher, to: 3, in: handle); bind(identity, to: 4, in: handle)
                guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
            }
            return DeliveryReservation(key: key, payload: encoded, hadPriorUncertainty: previous != nil)
        }
    }

    /// A failed/unknown remote result releases capacity, never its uncertainty.
    func quarantineDelivery(_ key: String, payload: Data? = nil) throws {
        try transaction {
            let entry: (Data, String?)? = try statement("SELECT p.payload,l.archive_identity FROM pending_deliveries p LEFT JOIN active_delivery_leases l ON l.key=p.key WHERE p.key=?;") { handle in
                bind(key, to: 1, in: handle)
                let step = sqlite3_step(handle)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(handle, 0) else { throw failure() }
                return (payload ?? Data(bytes: bytes, count: Int(sqlite3_column_bytes(handle, 0))),
                        sqlite3_column_text(handle, 1).map { String(cString: $0) })
            }
            if let entry { try quarantine(key: key, payload: entry.0, identity: entry.1) }
            try deleteDelivery(key, table: "pending_deliveries")
            try deleteDelivery(key, table: "active_delivery_leases")
        }
    }

    private func quarantine(key: String, payload: Data, identity: String?) throws {
        let prior: (String, Data)? = try statement("SELECT key,payload FROM quarantined_deliveries WHERE identity=?;") { handle in
            if let identity { bind(identity, to: 1, in: handle) } else { sqlite3_bind_null(handle, 1) }
            let step = sqlite3_step(handle)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW, let key = sqlite3_column_text(handle, 0), let bytes = sqlite3_column_blob(handle, 1) else { throw failure() }
            return (String(cString: key), Data(bytes: bytes, count: Int(sqlite3_column_bytes(handle, 1))))
        }
        var stored = payload
        if let prior {
            guard var old = try JSONSerialization.jsonObject(with: prior.1) as? [String: Any],
                  let new = try JSONSerialization.jsonObject(with: payload) as? [String: Any],
                  ["owner", "provider", "callsign"].allSatisfy({ old[$0] as? String == new[$0] as? String }),
                  old["frequencyHz"] as? Int64 == new["frequencyHz"] as? Int64 else { throw failure() }
            // Retain the first uncertainty's identity, the total observation
            // count, and conservative latest time/lifetime/radio uncertainty.
            old["attemptedAt"] = max(old["attemptedAt"] as? Double ?? 0, new["attemptedAt"] as? Double ?? 0)
            old["lifetimeSeconds"] = max(old["lifetimeSeconds"] as? Int ?? 0, new["lifetimeSeconds"] as? Int ?? 0)
            let count = (old["attemptCount"] as? Int ?? 1).addingReportingOverflow(new["attemptCount"] as? Int ?? 1)
            guard !count.overflow else { throw failure() }
            old["attemptCount"] = count.partialValue
            old["lastAttemptID"] = new["id"]
            if old["radioID"] as? String != new["radioID"] as? String { old.removeValue(forKey: "radioID") }
            stored = try JSONSerialization.data(withJSONObject: old, options: [.sortedKeys])
        }
        try statement("INSERT INTO quarantined_deliveries(key,payload,identity) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload;") { handle in
            bind(prior?.0 ?? key, to: 1, in: handle); bind(stored, to: 2, in: handle)
            if let identity { bind(identity, to: 3, in: handle) } else { sqlite3_bind_null(handle, 3) }
            guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
        }
    }

    func claimCleanup(leaseIdentity: String) throws -> String {
        try transaction {
            try recoverInactiveDeliveries()
            let token = UUID().uuidString
            let occupied = try statement("SELECT 1 FROM active_delivery_leases WHERE identity=?;") { handle in
                bind(leaseIdentity, to: 1, in: handle); return sqlite3_step(handle) == SQLITE_ROW
            }
            guard !occupied else { throw WorkerFailure("spot_broker_busy", "A current radio spot delivery prevents prior cleanup.") }
            let count = try statement("SELECT count(*) FROM active_delivery_leases;") { handle in
                guard sqlite3_step(handle) == SQLITE_ROW else { throw failure() }
                return sqlite3_column_int(handle, 0)
            }
            guard count < 256 else { throw WorkerFailure("spot_broker_busy", "Radio spot cleanup capacity is busy.") }
            try statement("INSERT INTO active_delivery_leases(identity,key,publisher,archive_identity) VALUES(?,?,?,NULL);") { handle in
                bind(leaseIdentity, to: 1, in: handle); bind(token, to: 2, in: handle); bind(publisher, to: 3, in: handle)
                guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
            }
            return token
        }
    }

    func releaseCleanup(_ token: String) throws { try deleteDelivery(token, table: "active_delivery_leases") }

    private func deleteDelivery(_ key: String, table: String) throws {
        try statement("DELETE FROM \(table) WHERE key=?;") { handle in
            bind(key, to: 1, in: handle)
            guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
        }
    }

    private func openPublisherLock(_ token: String) throws -> Int32 {
        guard UUID(uuidString: token) != nil else { throw failure() }
        let file = url.appendingPathExtension("publisher-" + token + ".lock")
        let descriptor = open(file.path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw failure() }
        return descriptor
    }

    private func recoverInactiveDeliveries() throws {
        // Legacy records have neither an attempt time nor a provable radio.
        // Copy opaque bytes and IDs atomically, with no expiry/resolution claim.
        try execute("INSERT INTO quarantined_deliveries(key,payload,identity) SELECT p.key,p.payload,NULL FROM pending_deliveries p WHERE NOT EXISTS(SELECT 1 FROM active_delivery_leases l WHERE l.key=p.key) ON CONFLICT(key) DO NOTHING;")
        try execute("DELETE FROM pending_deliveries WHERE NOT EXISTS(SELECT 1 FROM active_delivery_leases l WHERE l.key=pending_deliveries.key) AND EXISTS(SELECT 1 FROM quarantined_deliveries q WHERE q.key=pending_deliveries.key AND q.payload=pending_deliveries.payload);")
        let owners: [String] = try statement("SELECT DISTINCT publisher FROM active_delivery_leases;") { handle in
            var owners: [String] = [], step = sqlite3_step(handle)
            while step == SQLITE_ROW {
                guard let text = sqlite3_column_text(handle, 0) else { throw failure() }
                owners.append(String(cString: text)); step = sqlite3_step(handle)
            }
            guard step == SQLITE_DONE else { throw failure() }
            return owners
        }
        for owner in owners where owner != publisher {
            if Self.publishersLock.withLock({ Self.livePublishers.contains(owner) }) { continue }
            let descriptor = try openPublisherLock(owner)
            defer { close(descriptor) }
            if flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
                guard errno == EWOULDBLOCK || errno == EAGAIN else { throw failure() }
                continue
            }
            // A dead publisher cannot finish a new attempt. Retain all of its
            // outcomes before releasing admission, coalescing only new records.
            let abandoned: [(String, Data, String?)] = try statement("SELECT p.key,p.payload,l.archive_identity FROM pending_deliveries p JOIN active_delivery_leases l ON l.key=p.key WHERE l.publisher=?;") { handle in
                bind(owner, to: 1, in: handle)
                var values: [(String, Data, String?)] = [], step = sqlite3_step(handle)
                while step == SQLITE_ROW {
                    guard let key = sqlite3_column_text(handle, 0), let bytes = sqlite3_column_blob(handle, 1) else { throw failure() }
                    values.append((String(cString: key), Data(bytes: bytes, count: Int(sqlite3_column_bytes(handle, 1))), sqlite3_column_text(handle, 2).map { String(cString: $0) }))
                    step = sqlite3_step(handle)
                }
                guard step == SQLITE_DONE else { throw failure() }
                return values
            }
            for entry in abandoned {
                try quarantine(key: entry.0, payload: entry.1, identity: entry.2)
                try deleteDelivery(entry.0, table: "pending_deliveries")
            }
            try statement("DELETE FROM active_delivery_leases WHERE publisher=?;") { handle in
                bind(owner, to: 1, in: handle); guard sqlite3_step(handle) == SQLITE_DONE else { throw failure() }
            }
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
        try statement("SELECT payload FROM pending_deliveries UNION ALL SELECT q.payload FROM quarantined_deliveries q WHERE NOT EXISTS(SELECT 1 FROM pending_deliveries p WHERE p.key=q.key);") { handle in
            var rows: [Data] = []
            var step = sqlite3_step(handle)
            while step == SQLITE_ROW {
                guard let bytes = sqlite3_column_blob(handle, 0),
                      (1...4096).contains(Int(sqlite3_column_bytes(handle, 0))) else { throw failure() }
                rows.append(Data(bytes: bytes, count: Int(sqlite3_column_bytes(handle, 0))))
                step = sqlite3_step(handle)
            }
            guard step == SQLITE_DONE else { throw failure() }
            return rows
        }
    }

    func removeDelivery(_ key: String) throws {
        try transaction {
            try deleteDelivery(key, table: "pending_deliveries")
            try deleteDelivery(key, table: "quarantined_deliveries")
            try deleteDelivery(key, table: "active_delivery_leases")
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

    private func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE;")
        do { let value = try body(); try execute("COMMIT;"); return value }
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
