import Foundation
import CoreFoundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

public struct SpotHistoryObservation: Codable, Equatable, Sendable {
    public let id: UUID
    public let sessionID: UUID
    public let sequence: Int64
    public let clusterID: UUID
    public let clusterName: String
    public let clusterHost: String
    public let arrivedAt: Date
    public let reportedAt: Date?
    public let timeBasis: String
    public let recordKind: String
    public let rawLine: String
    public let callsign: String
    public let spotter: String
    public let frequencyKHz: Double
    public let frequencyText: String
    public let band: String
    public let mode: String
    public let source: String
    public let country: String
    public let adif: Int?
    public let comment: String
    public let specialTags: [String]
    public let callStatus: String
    public let dxccStatus: String
    public let classificationJSON: String

    public init(id: UUID = UUID(), sessionID: UUID, sequence: Int64, clusterID: UUID,
                clusterName: String = "", clusterHost: String = "", arrivedAt: Date,
                reportedAt: Date? = nil, timeBasis: String = "arrival", recordKind: String = "live",
                rawLine: String, callsign: String, spotter: String, frequencyKHz: Double,
                frequencyText: String = "", band: String = "", mode: String = "", source: String = "",
                country: String = "", adif: Int? = nil, comment: String = "", specialTags: [String] = [],
                callStatus: String = "", dxccStatus: String = "", classificationJSON: String = "{}") {
        self.id = id; self.sessionID = sessionID; self.sequence = sequence; self.clusterID = clusterID
        self.clusterName = clusterName; self.clusterHost = clusterHost; self.arrivedAt = arrivedAt
        self.reportedAt = reportedAt; self.timeBasis = timeBasis; self.recordKind = recordKind
        self.rawLine = rawLine; self.callsign = callsign; self.spotter = spotter
        self.frequencyKHz = frequencyKHz; self.frequencyText = frequencyText; self.band = band
        self.mode = mode; self.source = source; self.country = country; self.adif = adif
        self.comment = comment; self.specialTags = specialTags; self.callStatus = callStatus
        self.dxccStatus = dxccStatus; self.classificationJSON = classificationJSON
    }
}

public struct SpotHistoryQuery: Codable, Equatable, Sendable {
    public var call: String
    public var spotter: String
    public var match: String
    public var from: Date?
    public var to: Date?
    public var band: String
    public var mode: String
    public var source: String
    public var limit: Int
    public var cursor: String?
    public var watermark: Int64?
    public init(call: String = "", spotter: String = "", match: String = "exact", from: Date? = nil,
                to: Date? = nil, band: String = "", mode: String = "", source: String = "",
                limit: Int = 100, cursor: String? = nil, watermark: Int64? = nil) {
        self.call = call; self.spotter = spotter; self.match = match; self.from = from; self.to = to
        self.band = band; self.mode = mode; self.source = source; self.limit = limit
        self.cursor = cursor; self.watermark = watermark
    }
}

public struct SpotHistoryPage: Codable, Sendable {
    public let rows: [SpotHistoryObservation]
    public let nextCursor: String?
    public let watermark: Int64
    public let revision: Int64
}
public struct SpotHistoryCount: Codable, Equatable, Sendable {
    public let key: String
    public let count: Int64
}
public struct SpotHistoryHour: Codable, Equatable, Sendable {
    public let hour: Date
    public let count: Int64
}
public struct SpotHistoryStats: Codable, Sendable {
    public let total: Int64
    public let distinctCalls: Int64
    public let distinctSpotters: Int64
    public let bands: [SpotHistoryCount]
    public let modes: [SpotHistoryCount]
    public let countries: [SpotHistoryCount]
    public let sources: [SpotHistoryCount]
    public let spotters: [SpotHistoryCount]
    public let hourly: [SpotHistoryHour]
    public let earliest: Date?
    public let latest: Date?
    public let watermark: Int64
    public let revision: Int64
    public let bucketsTruncated: Bool
}
public struct SpotHistoryStatus: Codable, Sendable {
    public let revision: Int64
    public let total: Int64
    public let earliest: Date?
    public let latest: Date?
    public let lastCommit: Date?
    public let schemaVersion: Int
    public let fileBytes: Int64
}
public struct SpotHistoryEvent: Codable, Equatable, Sendable {
    public let id: UUID
    public let occurredAt: Date
    public let kind: String
    public let payloadJSON: String
}
public struct SpotHistoryHealthSummary: Codable, Equatable, Sendable {
    public let knownUnrecorded: Int64
    public let unknownGap: Bool
    public let lastProcessID: UUID?
    public let lastProcessClean: Bool
    public let lastProcessStartedAt: Date?
    public let lastProcessStoppedAt: Date?
}
public enum SpotHistoryDatabaseError: Error, LocalizedError {
    case unsafePath, unavailable(String), futureSchema(Int64), invalidInput(String), invalidCursor, identityConflict, corruptRecord, closed
    public var errorDescription: String? {
        switch self {
        case .unsafePath: return "Spot History requires a private regular file path without symbolic links."
        case .unavailable(let reason): return "Spot History unavailable: \(reason)"
        case .futureSchema(let version): return "Spot History schema \(version) is newer than this application supports."
        case .invalidInput(let reason): return "Invalid Spot History input: \(reason)"
        case .invalidCursor: return "Spot History cursor does not match this search. Refresh the search."
        case .identityConflict: return "Spot History observation identity was reused with different content."
        case .corruptRecord: return "A Spot History observation could not be decoded."
        case .closed: return "Spot History is closed."
        }
    }
}

/// Separate append-only archive. No default URL, network actions, deletion or export.
/// Callers own bounded ingestion and shutdown; independent instances permit WAL readers.
public final class SpotHistoryDatabase: @unchecked Sendable {
    public let url: URL
    private var handle: OpaquePointer?
    private let lock = NSRecursiveLock()
    private let encoder: JSONEncoder = { let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]; return e }()
    private let decoder = JSONDecoder()
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private enum Value { case text(String), integer(Int64) }
    private struct Cursor: Codable {
        let version: Int
        let scope: String
        let watermark: Int64
        let revision: Int64
        let time: Int64
        let rowID: Int64
    }
    private final class Deadline { let end = Date.timeIntervalSinceReferenceDate + 2 }

    public init(url requestedURL: URL) throws {
        guard requestedURL.isFileURL, LocalFilePath.isAbsoluteWithoutTraversal(requestedURL.path) else { throw SpotHistoryDatabaseError.unsafePath }
        let url = Self.canonicalSystemPath(requestedURL)
        self.url = url
        try Self.validatePath(url)
        let fm = FileManager.default, parent = url.deletingLastPathComponent()
        try fm.createDirectory(at: parent, withIntermediateDirectories: true, attributes: LocalFilePermissions.directoryAttributes)
        try Self.validatePath(url)
        #if !os(Windows)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: parent.path)
        #endif
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX | SQLITE_OPEN_NOFOLLOW
        guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK else {
            let reason = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            sqlite3_close(handle); handle = nil; throw SpotHistoryDatabaseError.unavailable(reason)
        }
        do {
            sqlite3_busy_timeout(handle, 2_000)
            let version = try scalar("PRAGMA user_version")
            guard version <= 2 else { throw SpotHistoryDatabaseError.futureSchema(version) }
            // Opening readers validates the header/schema/state, not every archive
            // page. Full integrity scans must be a separate explicit diagnostic;
            // their cost must not make large valid archives unavailable on restart.
            if version == 0 {
                guard try scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") == 0 else {
                    throw SpotHistoryDatabaseError.unavailable("unrecognized existing database")
                }
                try transaction {
                    try execute("CREATE TABLE history_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, total INTEGER NOT NULL, earliest INTEGER, latest INTEGER, last_commit INTEGER);")
                    try execute("INSERT INTO history_state VALUES (1,0,0,NULL,NULL,NULL);")
                    try execute("CREATE TABLE history_events (row_id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, occurred_at_us INTEGER NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL);")
                    try createHealthState()
                    try execute("CREATE TABLE spot_observations (row_id INTEGER PRIMARY KEY AUTOINCREMENT, observation_id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, cluster_id TEXT NOT NULL, arrived_at_us INTEGER NOT NULL, reported_at_us INTEGER, callsign_key TEXT NOT NULL, spotter_key TEXT NOT NULL, band TEXT NOT NULL, mode TEXT NOT NULL, source TEXT NOT NULL, country TEXT NOT NULL, payload BLOB NOT NULL, UNIQUE(session_id,sequence));")
                    for columns in ["arrived_at_us DESC,row_id DESC", "callsign_key,arrived_at_us DESC,row_id DESC", "spotter_key,arrived_at_us DESC,row_id DESC", "reported_at_us DESC,row_id DESC", "band,mode,arrived_at_us DESC,row_id DESC", "cluster_id,arrived_at_us DESC,row_id DESC", "source,arrived_at_us DESC,row_id DESC"] {
                        let index = columns.components(separatedBy: ",").first!.components(separatedBy: " ").first!
                        try execute("CREATE INDEX spot_history_\(index) ON spot_observations(\(columns));")
                    }
                    try execute("PRAGMA user_version=2;")
                }
            }
            // Refuse malformed version-1 schemas rather than treating missing data as empty.
            try statement("SELECT revision,total,earliest,latest,last_commit FROM history_state WHERE id=1") { s in
                guard sqlite3_step(s) == SQLITE_ROW else { throw SpotHistoryDatabaseError.unavailable("missing history state") }
            }
            try statement("SELECT row_id,observation_id,session_id,sequence,cluster_id,arrived_at_us,reported_at_us,callsign_key,spotter_key,band,mode,source,country,payload FROM spot_observations LIMIT 0") { _ in }
            try statement("SELECT event_id,occurred_at_us,kind,payload_json FROM history_events LIMIT 0") { _ in }
            if version == 1 {
                try transaction {
                    try createHealthState()
                    // Version 1 retained bounded details but no durable summary.
                    // Replay what remains; absent older details cannot be recovered.
                    try statement("SELECT event_id,occurred_at_us,kind,payload_json FROM history_events ORDER BY row_id") { s in
                        try each(s) {
                            let kind = text(s, 2), json = text(s, 3), time = sqlite3_column_int64(s, 1)
                            _ = try healthReceipt(id: text(s, 0), kind: kind, payloadJSON: json, occurredAt: time)
                            try updateHealthState(kind: kind, payloadJSON: json, occurredAt: time)
                        }
                    }
                    if try scalar("SELECT COALESCE(MAX(row_id),0) FROM history_events") > 1024 {
                        try execute("UPDATE history_health_state SET unknown_gap=1 WHERE id=1")
                    }
                    try execute("UPDATE history_state SET revision=revision+1 WHERE id=1")
                    try execute("PRAGMA user_version=2")
                }
            }
            _ = try healthSummary()
            try execute("PRAGMA journal_mode=WAL;")
            try execute("PRAGMA synchronous=NORMAL;")
            try execute("PRAGMA case_sensitive_like=ON;")
            try protectFiles()
        } catch { close(); throw error }
    }
    deinit { close() }
    public func close() { lock.withLock { if let handle { sqlite3_close_v2(handle); self.handle = nil } } }

    @discardableResult public func append(_ observations: [SpotHistoryObservation]) throws -> Int {
        try lock.withLock {
            guard observations.count <= 100 else { throw SpotHistoryDatabaseError.invalidInput("batch exceeds 100 observations") }
            let encoded = try observations.map { observation -> Data in
                guard observation.sequence >= 0, observation.frequencyKHz.isFinite, observation.frequencyKHz > 0,
                      observation.frequencyKHz <= 1_000_000_000, !observation.callsign.isEmpty,
                      observation.callsign.utf8.count <= 64, observation.spotter.utf8.count <= 64,
                      observation.rawLine.utf8.count <= 4096, observation.comment.utf8.count <= 4096,
                      observation.classificationJSON.utf8.count <= 8192, observation.specialTags.count <= 64,
                      [observation.callsign, observation.spotter, observation.band, observation.mode, observation.source, observation.country].allSatisfy({ !$0.contains("\0") }),
                      ["live", "historical_reply", "import"].contains(observation.recordKind) else {
                    throw SpotHistoryDatabaseError.invalidInput("observation exceeds field bounds")
                }
                _ = try microseconds(observation.arrivedAt)
                if let reportedAt = observation.reportedAt { _ = try microseconds(reportedAt) }
                guard let json = observation.classificationJSON.data(using: .utf8),
                      (try? JSONSerialization.jsonObject(with: json)) != nil else { throw SpotHistoryDatabaseError.invalidInput("classification is not JSON") }
                let payload = try encoder.encode(observation)
                guard payload.count <= 32768 else { throw SpotHistoryDatabaseError.invalidInput("observation exceeds 32768 bytes") }
                return payload
            }
            var inserted = 0
            try transaction {
                for (observation, payload) in zip(observations, encoded) {
                    let existing = try payloadFor("observation_id=? OR (session_id=? AND sequence=?)", [.text(observation.id.uuidString), .text(observation.sessionID.uuidString), .integer(observation.sequence)])
                    if let existing {
                        guard existing == payload else { throw SpotHistoryDatabaseError.identityConflict }
                        continue
                    }
                    try statement("INSERT INTO spot_observations(observation_id,session_id,sequence,cluster_id,arrived_at_us,reported_at_us,callsign_key,spotter_key,band,mode,source,country,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)") { s in
                        try bind([.text(observation.id.uuidString), .text(observation.sessionID.uuidString), .integer(observation.sequence), .text(observation.clusterID.uuidString), .integer(try microseconds(observation.arrivedAt))], to: s)
                        if let date = observation.reportedAt { sqlite3_bind_int64(s, 6, try microseconds(date)) } else { sqlite3_bind_null(s, 6) }
                        try bind([.text(key(observation.callsign)), .text(key(observation.spotter)), .text(key(observation.band)), .text(key(observation.mode)), .text(key(observation.source)), .text(observation.country)], to: s, startingAt: 7)
                        _ = payload.withUnsafeBytes { sqlite3_bind_blob(s, 13, $0.baseAddress, Int32(payload.count), Self.transient) }
                        guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
                    }
                    inserted += 1
                }
                if inserted > 0 {
                    try statement("UPDATE history_state SET revision=revision+1,total=total+?,earliest=(SELECT MIN(arrived_at_us) FROM spot_observations),latest=(SELECT MAX(arrived_at_us) FROM spot_observations),last_commit=? WHERE id=1") { s in
                        try bind([.integer(Int64(inserted)), .integer(try microseconds(Date()))], to: s)
                        guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
                    }
                }
            }
            try protectFiles()
            return inserted
        }
    }

    public func query(_ query: SpotHistoryQuery) throws -> SpotHistoryPage {
        try lock.withLock { try readSnapshot {
            let (whereSQL, values, scope) = try filters(query)
            guard (1...500).contains(query.limit) else { throw SpotHistoryDatabaseError.invalidInput("limit must be 1...500") }
            let current = try state(), maxID = try scalar("SELECT COALESCE(MAX(row_id),0) FROM spot_observations")
            var watermark = query.watermark ?? maxID, revision = current.revision
            var boundary = "", bindings = values
            if let opaque = query.cursor {
                guard opaque.utf8.count <= 4096, let data = Data(base64Encoded: opaque), let cursor = try? decoder.decode(Cursor.self, from: data),
                      cursor.version == 1, cursor.scope == scope, cursor.watermark <= maxID, cursor.watermark >= 0,
                      cursor.rowID > 0, cursor.rowID <= cursor.watermark, cursor.revision <= current.revision,
                      query.watermark == nil || query.watermark == cursor.watermark else { throw SpotHistoryDatabaseError.invalidCursor }
                watermark = cursor.watermark; revision = cursor.revision
                boundary = " AND (arrived_at_us < ? OR (arrived_at_us = ? AND row_id < ?))"
                bindings += [.integer(cursor.time), .integer(cursor.time), .integer(cursor.rowID)]
            }
            guard watermark >= 0, watermark <= maxID else { throw SpotHistoryDatabaseError.invalidCursor }
            var rows: [SpotHistoryObservation] = [], positions: [(Int64, Int64)] = []
            try statement("SELECT payload,arrived_at_us,row_id FROM spot_observations WHERE \(whereSQL)\(boundary) AND row_id<=? ORDER BY arrived_at_us DESC,row_id DESC LIMIT ?") { s in
                try bind(bindings + [.integer(watermark), .integer(Int64(query.limit + 1))], to: s)
                try each(s) { rows.append(try decode(s, 0)); positions.append((sqlite3_column_int64(s, 1), sqlite3_column_int64(s, 2))) }
            }
            var cursor: String?
            if rows.count > query.limit {
                rows.removeLast(); positions.removeLast()
                let last = positions.last!
                cursor = try encoder.encode(Cursor(version: 1, scope: scope, watermark: watermark, revision: revision, time: last.0, rowID: last.1)).base64EncodedString()
            }
            return SpotHistoryPage(rows: rows, nextCursor: cursor, watermark: watermark, revision: revision)
        } }
    }

    public func stats(_ query: SpotHistoryQuery) throws -> SpotHistoryStats {
        try lock.withLock { try readSnapshot {
            let (filter, values, _) = try filters(query)
            let current = try state(), maxID = try scalar("SELECT COALESCE(MAX(row_id),0) FROM spot_observations")
            let watermark = query.watermark ?? maxID
            guard watermark >= 0, watermark <= maxID else { throw SpotHistoryDatabaseError.invalidCursor }
            let sql = "\(filter) AND row_id<=?", bindings = values + [.integer(watermark)]
            var total: Int64 = 0, calls: Int64 = 0, spotters: Int64 = 0, earliest: Date?, latest: Date?
            try statement("SELECT COUNT(*),COUNT(DISTINCT callsign_key),COUNT(DISTINCT spotter_key),MIN(arrived_at_us),MAX(arrived_at_us) FROM spot_observations WHERE \(sql)") { s in
                try bind(bindings, to: s); guard sqlite3_step(s) == SQLITE_ROW else { throw error() }
                total = sqlite3_column_int64(s, 0); calls = sqlite3_column_int64(s, 1); spotters = sqlite3_column_int64(s, 2)
                earliest = date(s, 3); latest = date(s, 4)
            }
            var truncated = false
            func groups(_ column: String) throws -> [SpotHistoryCount] {
                var rows: [SpotHistoryCount] = []
                try statement("SELECT \(column),COUNT(*) FROM spot_observations WHERE \(sql) GROUP BY \(column) ORDER BY COUNT(*) DESC,\(column) LIMIT 51") { s in
                    try bind(bindings, to: s); try each(s) { rows.append(SpotHistoryCount(key: text(s, 0), count: sqlite3_column_int64(s, 1))) }
                }
                if rows.count > 50 { rows.removeLast(); truncated = true }; return rows
            }
            let bands = try groups("band"), modes = try groups("mode"), countries = try groups("country"), sources = try groups("source"), topSpotters = try groups("spotter_key")
            var hours: [SpotHistoryHour] = []
            try statement("SELECT CASE WHEN arrived_at_us<0 THEN (arrived_at_us-3599999999)/3600000000 ELSE arrived_at_us/3600000000 END,COUNT(*) FROM spot_observations WHERE \(sql) GROUP BY 1 ORDER BY 1 DESC LIMIT 745") { s in
                try bind(bindings, to: s); try each(s) { hours.append(SpotHistoryHour(hour: Date(timeIntervalSince1970: Double(sqlite3_column_int64(s, 0)) * 3600), count: sqlite3_column_int64(s, 1))) }
            }
            if hours.count > 744 { hours.removeLast(); truncated = true }
            return SpotHistoryStats(total: total, distinctCalls: calls, distinctSpotters: spotters, bands: bands, modes: modes, countries: countries, sources: sources, spotters: topSpotters, hourly: hours.reversed(), earliest: earliest, latest: latest, watermark: watermark, revision: current.revision, bucketsTruncated: truncated)
        } }
    }
    public func detail(id: UUID) throws -> SpotHistoryObservation? {
        try lock.withLock {
            guard let payload = try payloadFor("observation_id=?", [.text(id.uuidString)]) else { return nil }
            guard let observation = try? decoder.decode(SpotHistoryObservation.self, from: payload) else { throw SpotHistoryDatabaseError.corruptRecord }
            return observation
        }
    }
    public func status() throws -> SpotHistoryStatus { try lock.withLock { try state() } }

    /// Operational evidence is bounded separately from the retained observations.
    public func appendHistoryEvent(id: UUID, occurredAt: Date, kind: String, payloadJSON: String) throws {
        try lock.withLock {
            guard !kind.isEmpty, kind.utf8.count <= 64, !kind.contains("\0"), payloadJSON.utf8.count <= 8192,
                  !payloadJSON.contains("\0"), let json = payloadJSON.data(using: .utf8),
                  (try? JSONSerialization.jsonObject(with: json)) != nil else { throw SpotHistoryDatabaseError.invalidInput("invalid recording event") }
            let time = try microseconds(occurredAt)
            try transaction {
                var found = false
                try statement("SELECT occurred_at_us,kind,payload_json FROM history_events WHERE event_id=?") { s in
                    try bind([.text(id.uuidString)], to: s)
                    let step = sqlite3_step(s)
                    if step == SQLITE_ROW {
                        guard sqlite3_column_int64(s, 0) == time, text(s, 1) == kind, text(s, 2) == payloadJSON else { throw SpotHistoryDatabaseError.identityConflict }
                        found = true
                    } else if step != SQLITE_DONE { throw error() }
                }
                if !found {
                    guard try healthReceipt(id: id.uuidString, kind: kind, payloadJSON: payloadJSON, occurredAt: time) else { return }
                    try statement("INSERT INTO history_events(event_id,occurred_at_us,kind,payload_json) VALUES(?,?,?,?)") { s in
                        try bind([.text(id.uuidString), .integer(time), .text(kind), .text(payloadJSON)], to: s)
                        guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
                    }
                    try updateHealthState(kind: kind, payloadJSON: payloadJSON, occurredAt: time)
                    try execute("DELETE FROM history_events WHERE row_id NOT IN (SELECT row_id FROM history_events ORDER BY row_id DESC LIMIT 1024)")
                    try statement("UPDATE history_state SET revision=revision+1,last_commit=? WHERE id=1") { s in
                        try bind([.integer(try microseconds(Date()))], to: s)
                        guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
                    }
                }
            }
            try protectFiles()
        }
    }
    public func historyEvents(limit: Int = 128) throws -> [SpotHistoryEvent] {
        try lock.withLock {
            guard (1...128).contains(limit) else { throw SpotHistoryDatabaseError.invalidInput("event limit must be 1...128") }
            var rows: [SpotHistoryEvent] = []
            try statement("SELECT event_id,occurred_at_us,kind,payload_json FROM history_events ORDER BY row_id DESC LIMIT ?") { s in
                try bind([.integer(Int64(limit))], to: s)
                try each(s) {
                    guard let id = UUID(uuidString: text(s, 0)), let occurredAt = date(s, 1) else { throw SpotHistoryDatabaseError.corruptRecord }
                    rows.append(SpotHistoryEvent(id: id, occurredAt: occurredAt, kind: text(s, 2), payloadJSON: text(s, 3)))
                }
            }
            return rows
        }
    }
    public func healthSummary() throws -> SpotHistoryHealthSummary {
        try lock.withLock {
            var summary: SpotHistoryHealthSummary?
            try statement("SELECT known_unrecorded,unknown_gap,process_id,process_clean,started_at_us,stopped_at_us FROM history_health_state WHERE id=1") { s in
                guard sqlite3_step(s) == SQLITE_ROW else { throw error() }
                let processText = text(s, 2), processID = processText.isEmpty ? nil : UUID(uuidString: processText)
                guard processText.isEmpty || processID != nil, sqlite3_column_int64(s, 0) >= 0 else { throw SpotHistoryDatabaseError.corruptRecord }
                summary = SpotHistoryHealthSummary(knownUnrecorded: sqlite3_column_int64(s, 0), unknownGap: sqlite3_column_int(s, 1) != 0,
                    lastProcessID: processID, lastProcessClean: sqlite3_column_int(s, 3) != 0,
                    lastProcessStartedAt: date(s, 4), lastProcessStoppedAt: date(s, 5))
            }
            return summary!
        }
    }

    private func createHealthState() throws {
        try execute("CREATE TABLE history_health_state(id INTEGER PRIMARY KEY CHECK(id=1),known_unrecorded INTEGER NOT NULL,unknown_gap INTEGER NOT NULL,process_id TEXT,process_clean INTEGER NOT NULL,started_at_us INTEGER,stopped_at_us INTEGER)")
        try execute("INSERT INTO history_health_state VALUES(1,0,0,NULL,1,NULL,NULL)")
        // Compact permanent identities keep cumulative health idempotent even
        // when its bounded event details have been compacted away.
        try execute("CREATE TABLE history_health_receipts(event_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL)")
    }
    private func healthReceipt(id: String, kind: String, payloadJSON: String, occurredAt: Int64) throws -> Bool {
        let encoded = try encoder.encode([kind, String(occurredAt), payloadJSON])
        let fingerprint = Data(SHA256.hash(data: encoded)).base64EncodedString()
        var existing: String?
        try statement("SELECT fingerprint FROM history_health_receipts WHERE event_id=?") { s in
            try bind([.text(id)], to: s)
            let step = sqlite3_step(s)
            if step == SQLITE_ROW { existing = text(s, 0) } else if step != SQLITE_DONE { throw error() }
        }
        if let existing {
            guard existing == fingerprint else { throw SpotHistoryDatabaseError.identityConflict }
            return false
        }
        guard ["process_start", "clean_stop", "recording_gap"].contains(kind) else { return true }
        try statement("INSERT INTO history_health_receipts VALUES(?,?)") { s in
            try bind([.text(id), .text(fingerprint)], to: s)
            guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
        }
        return true
    }
    private func updateHealthState(kind: String, payloadJSON: String, occurredAt: Int64) throws {
        guard ["process_start", "clean_stop", "recording_gap"].contains(kind) else { return }
        guard let payload = try JSONSerialization.jsonObject(with: Data(payloadJSON.utf8)) as? [String: Any] else { throw SpotHistoryDatabaseError.invalidInput("health event requires object") }
        if kind == "recording_gap" {
            let count: Int64
            if let value = payload["count"] {
                guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                      number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue < 9_007_199_254_740_992,
                      number.doubleValue.rounded() == number.doubleValue else { throw SpotHistoryDatabaseError.invalidInput("invalid gap count") }
                count = number.int64Value
            } else { count = 0 }
            let current = try healthSummary()
            let (total, overflow) = current.knownUnrecorded.addingReportingOverflow(count)
            guard !overflow else { throw SpotHistoryDatabaseError.invalidInput("gap counter overflow") }
            try statement("UPDATE history_health_state SET known_unrecorded=?,unknown_gap=? WHERE id=1") { s in
                try bind([.integer(total), .integer(current.unknownGap || (payload["unknownLoss"] as? Bool == true) ? 1 : 0)], to: s)
                guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
            }
        } else {
            guard let process = payload["processID"] as? String, let id = UUID(uuidString: process) else { throw SpotHistoryDatabaseError.invalidInput("health event requires process identity") }
            if kind == "process_start" {
                try statement("UPDATE history_health_state SET process_id=?,process_clean=0,started_at_us=?,stopped_at_us=NULL WHERE id=1") { s in
                    try bind([.text(id.uuidString), .integer(occurredAt)], to: s)
                    guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
                }
            } else {
                try statement("UPDATE history_health_state SET process_clean=1,stopped_at_us=? WHERE id=1 AND process_id=?") { s in
                    try bind([.integer(occurredAt), .text(id.uuidString)], to: s)
                    guard sqlite3_step(s) == SQLITE_DONE else { throw error() }
                }
            }
        }
    }

    private func state() throws -> SpotHistoryStatus {
        var result: SpotHistoryStatus?
        try statement("SELECT revision,total,earliest,latest,last_commit FROM history_state WHERE id=1") { s in
            guard sqlite3_step(s) == SQLITE_ROW else { throw error() }
            let bytes = [url, URL(fileURLWithPath: url.path + "-wal"), URL(fileURLWithPath: url.path + "-shm")].reduce(Int64(0)) { sum, file in
                sum + ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0)
            }
            result = SpotHistoryStatus(revision: sqlite3_column_int64(s, 0), total: sqlite3_column_int64(s, 1), earliest: date(s, 2), latest: date(s, 3), lastCommit: date(s, 4), schemaVersion: 2, fileBytes: bytes)
        }
        return result!
    }
    private func filters(_ query: SpotHistoryQuery) throws -> (String, [Value], String) {
        guard ["exact", "prefix"].contains(query.match), [query.call, query.spotter, query.band, query.mode, query.source].allSatisfy({ $0.utf8.count <= 128 && !$0.contains("\0") }) else { throw SpotHistoryDatabaseError.invalidInput("unsupported match or oversized filter") }
        if let from = query.from, let to = query.to, from >= to { throw SpotHistoryDatabaseError.invalidInput("UTC end must follow start") }
        var sql = ["1=1"], values: [Value] = [], identity: [String] = [query.match]
        for (column, value, prefixAllowed) in [("callsign_key", query.call, true), ("spotter_key", query.spotter, true), ("band", query.band, false), ("mode", query.mode, false), ("source", query.source, false)] {
            let normalized = key(value); identity.append(normalized)
            if !normalized.isEmpty {
                if query.match == "prefix" && prefixAllowed {
                    sql.append("\(column) LIKE ? ESCAPE '\\'")
                    values.append(.text(normalized.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "%", with: "\\%").replacingOccurrences(of: "_", with: "\\_") + "%"))
                } else { sql.append("\(column)=?"); values.append(.text(normalized)) }
            }
        }
        for (operatorSQL, date) in [(">=", query.from), ("<", query.to)] {
            if let date { let time = try microseconds(date); sql.append("arrived_at_us\(operatorSQL)?"); values.append(.integer(time)); identity.append(String(time)) } else { identity.append("") }
        }
        let scope = try encoder.encode(identity).base64EncodedString()
        return (sql.joined(separator: " AND "), values, scope)
    }
    private func key(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
    private func microseconds(_ date: Date) throws -> Int64 {
        let value = date.timeIntervalSince1970 * 1_000_000
        guard value.isFinite, abs(value) < 8_000_000_000_000_000 else { throw SpotHistoryDatabaseError.invalidInput("timestamp outside supported range") }
        return Int64(value.rounded())
    }
    private func date(_ s: OpaquePointer?, _ index: Int32) -> Date? {
        sqlite3_column_type(s, index) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: Double(sqlite3_column_int64(s, index)) / 1_000_000)
    }
    private func text(_ s: OpaquePointer?, _ index: Int32) -> String { sqlite3_column_text(s, index).map { String(cString: $0) } ?? "" }
    private func decode(_ s: OpaquePointer?, _ index: Int32) throws -> SpotHistoryObservation {
        let payload = try data(s, index)
        guard let observation = try? decoder.decode(SpotHistoryObservation.self, from: payload) else { throw SpotHistoryDatabaseError.corruptRecord }
        return observation
    }
    private func data(_ s: OpaquePointer?, _ index: Int32) throws -> Data {
        let count = Int(sqlite3_column_bytes(s, index))
        guard (1...32768).contains(count), let bytes = sqlite3_column_blob(s, index) else { throw SpotHistoryDatabaseError.corruptRecord }
        return Data(bytes: bytes, count: count)
    }
    private func payloadFor(_ clause: String, _ values: [Value]) throws -> Data? {
        var payload: Data?
        try statement("SELECT payload FROM spot_observations WHERE \(clause) LIMIT 1") { s in
            try bind(values, to: s)
            let step = sqlite3_step(s)
            if step == SQLITE_ROW { payload = try data(s, 0) } else if step != SQLITE_DONE { throw error() }
        }; return payload
    }
    private func scalar(_ sql: String) throws -> Int64 {
        var value: Int64 = 0
        try statement(sql) { s in guard sqlite3_step(s) == SQLITE_ROW else { throw error() }; value = sqlite3_column_int64(s, 0) }; return value
    }
    private func bind(_ values: [Value], to s: OpaquePointer?, startingAt: Int32 = 1) throws {
        for (offset, value) in values.enumerated() {
            let index = startingAt + Int32(offset), result: Int32
            switch value { case .text(let text): result = sqlite3_bind_text(s, index, text, -1, Self.transient)
            case .integer(let number): result = sqlite3_bind_int64(s, index, number) }
            guard result == SQLITE_OK else { throw error() }
        }
    }
    private func each(_ s: OpaquePointer?, body: () throws -> Void) throws {
        while true { let step = sqlite3_step(s); if step == SQLITE_DONE { return }; guard step == SQLITE_ROW else { throw error() }; try body() }
    }
    private func statement<T>(_ sql: String, body: (OpaquePointer?) throws -> T) throws -> T {
        guard let handle else { throw SpotHistoryDatabaseError.closed }
        var s: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &s, nil) == SQLITE_OK else { throw error() }
        defer { sqlite3_finalize(s) }; return try body(s)
    }
    private func execute(_ sql: String) throws {
        guard let handle else { throw SpotHistoryDatabaseError.closed }
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw error() }
    }
    private func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do { let result = try body(); try execute("COMMIT"); return result } catch { try? execute("ROLLBACK"); throw error }
    }
    private func readSnapshot<T>(_ body: () throws -> T) throws -> T {
        guard let handle else { throw SpotHistoryDatabaseError.closed }
        let deadline = Deadline()
        sqlite3_progress_handler(handle, 1000, { pointer in
            guard let pointer else { return 1 }
            return Date.timeIntervalSinceReferenceDate > Unmanaged<Deadline>.fromOpaque(pointer).takeUnretainedValue().end ? 1 : 0
        }, Unmanaged.passUnretained(deadline).toOpaque())
        defer { sqlite3_progress_handler(handle, 0, nil, nil); withExtendedLifetime(deadline) {} }
        try execute("BEGIN")
        do { let result = try body(); try execute("COMMIT"); return result } catch { try? execute("ROLLBACK"); throw error }
    }
    private func error() -> SpotHistoryDatabaseError { .unavailable(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "closed") }
    private static func canonicalSystemPath(_ url: URL) -> URL {
        #if os(macOS)
        // Foundation normalizes resolved /private/var back to /var. Resolve only
        // these fixed OS aliases explicitly; arbitrary links remain forbidden.
        for alias in ["/var/", "/tmp/"] where url.path.hasPrefix(alias) {
            return URL(fileURLWithPath: "/private" + url.path)
        }
        #endif
        return url
    }
    private static func validatePath(_ url: URL) throws {
        let fm = FileManager.default
        var component = URL(fileURLWithPath: url.pathComponents.first ?? "/", isDirectory: true)
        for part in url.pathComponents.dropFirst() {
            component.appendPathComponent(part)
            if let attributes = try? fm.attributesOfItem(atPath: component.path) {
                let type = attributes[.type] as? FileAttributeType
                guard type != .typeSymbolicLink,
                      component.path == url.path ? type == .typeRegular : type == .typeDirectory else { throw SpotHistoryDatabaseError.unsafePath }
            }
        }
        for suffix in ["-wal", "-shm", "-journal"] {
            let sidecar = url.path + suffix
            if let attributes = try? fm.attributesOfItem(atPath: sidecar), attributes[.type] as? FileAttributeType != .typeRegular { throw SpotHistoryDatabaseError.unsafePath }
        }
    }
    private func protectFiles() throws {
        try Self.validatePath(url)
        for file in [url, URL(fileURLWithPath: url.path + "-wal"), URL(fileURLWithPath: url.path + "-shm")] where FileManager.default.fileExists(atPath: file.path) { try LocalFilePermissions.protectFile(file) }
    }
}
