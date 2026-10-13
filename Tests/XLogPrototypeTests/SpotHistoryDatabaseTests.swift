import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

@Suite("Separate append-only Spot History")
struct SpotHistoryDatabaseTests {
    private func location() -> URL {
        FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("spot-history-test-\(UUID().uuidString)").appendingPathComponent("history.sqlite")
    }
    private func observation(_ sequence: Int64, session: UUID = UUID(), call: String = "OM0RX/P",
                             spotter: String = "K1ABC", date: Date = Date(timeIntervalSince1970: 1_700_000_000),
                             band: String = "20m", mode: String = "CW", source: String = "cluster") -> SpotHistoryObservation {
        SpotHistoryObservation(sessionID: session, sequence: sequence, clusterID: UUID(), clusterName: "Synthetic",
            clusterHost: "example.invalid", arrivedAt: date, reportedAt: date.addingTimeInterval(-90),
            timeBasis: "explicit_utc", recordKind: "historical_reply", rawLine: "DX de K1ABC: 14025.125 OM0RX/P full Unicode café 2213Z",
            callsign: call, spotter: spotter, frequencyKHz: 14025.125, frequencyText: "14025.125", band: band,
            mode: mode, source: source, country: "Slovakia", adif: 504, comment: "full Unicode café " + String(repeating: "x", count: 900),
            specialTags: ["POTA"], callStatus: "new", dxccStatus: "worked", classificationJSON: "{\"revision\":42}")
    }
    private func sql(_ url: URL, _ command: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { throw SpotHistoryDatabaseError.unavailable("fixture") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, command, nil, nil, nil) == SQLITE_OK else { throw SpotHistoryDatabaseError.unavailable("fixture") }
    }

    @Test("Immutable fidelity, genuine repeats, retries and restart")
    func fidelityAndIdentity() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try SpotHistoryDatabase(url: url), session = UUID()
        let first = observation(1, session: session), repeatReport = observation(2, session: session)
        #expect(try db.append([first, repeatReport]) == 2)
        #expect(try db.append([first]) == 0)
        #expect(try db.status().revision == 1)
        #expect(try db.status().total == 2)
        #expect(try db.detail(id: first.id) == first)
        #expect(throws: SpotHistoryDatabaseError.self) { try db.append([observation(1, session: session)]) }
        let rolledBack = observation(3, session: session)
        #expect(throws: SpotHistoryDatabaseError.self) { try db.append([rolledBack, observation(1, session: session)]) }
        #expect(try db.detail(id: rolledBack.id) == nil)
        #expect(try db.status().total == 2)
        db.close()
        let reopened = try SpotHistoryDatabase(url: url); defer { reopened.close() }
        #expect(try reopened.detail(id: first.id) == first)
        #expect(try reopened.append([first]) == 0)
        #expect(try reopened.query(SpotHistoryQuery()).rows.count == 2)
        #if !os(Windows)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        #expect((try FileManager.default.attributesOfItem(atPath: url.deletingLastPathComponent().path)[.posixPermissions] as? NSNumber)?.intValue == 0o700)
        #endif
    }

    @Test("Stable equal-time pagination freezes concurrent inserts and filters")
    func pagination() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try SpotHistoryDatabase(url: url); defer { db.close() }
        let rows = (0..<13).map { observation(Int64($0)) }
        try db.append(rows)
        var query = SpotHistoryQuery(call: "om0rx/p", limit: 5)
        let first = try db.query(query)
        #expect(first.rows.count == 5)
        let secondWriter = try SpotHistoryDatabase(url: url); defer { secondWriter.close() }
        try secondWriter.append([observation(99)])
        var ids = Set(first.rows.map(\.id)); query.cursor = first.nextCursor
        while query.cursor != nil {
            let page = try db.query(query)
            #expect(page.watermark == first.watermark)
            #expect(page.revision == first.revision)
            ids.formUnion(page.rows.map(\.id)); query.cursor = page.nextCursor
        }
        #expect(ids == Set(rows.map(\.id)))
        #expect(try db.query(SpotHistoryQuery()).rows.count == 14)
        var wrong = SpotHistoryQuery(call: "W1AW", cursor: first.nextCursor)
        #expect(throws: SpotHistoryDatabaseError.self) { try db.query(wrong) }
        wrong = SpotHistoryQuery(limit: 501)
        #expect(throws: SpotHistoryDatabaseError.self) { try db.query(wrong) }
        #expect(try db.stats(SpotHistoryQuery(watermark: first.watermark)).total == 13)
    }

    @Test("Bound filters, literal wildcard prefixes and UTC start inclusive end exclusive")
    func filters() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try SpotHistoryDatabase(url: url); defer { db.close() }
        let time = Date(timeIntervalSince1970: 1_700_000_000)
        try db.append([observation(1, call: "K1%X", date: time), observation(2, call: "K1AX", date: time.addingTimeInterval(1)),
                       observation(3, call: "K1_X", date: time), observation(4, call: "W1AW", spotter: "S2ABC", date: time, band: "40m", mode: "SSB", source: "RBN")])
        #expect(try db.query(SpotHistoryQuery(call: "K1%", match: "prefix")).rows.map(\.callsign) == ["K1%X"])
        #expect(try db.query(SpotHistoryQuery(call: "K1_", match: "prefix")).rows.map(\.callsign) == ["K1_X"])
        #expect(try db.query(SpotHistoryQuery(call: "' OR 1=1 --")).rows.isEmpty)
        #expect(try db.query(SpotHistoryQuery(from: time, to: time.addingTimeInterval(1))).rows.count == 3)
        #expect(try db.query(SpotHistoryQuery(spotter: "s2", match: "prefix", band: "40m", mode: "ssb", source: "rbn")).rows.map(\.callsign) == ["W1AW"])
    }

    @Test("Statistics cover the full scope and retain operational evidence")
    func statisticsAndEvents() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try SpotHistoryDatabase(url: url)
        try db.append((0..<100).map { observation(Int64($0), call: $0.isMultiple(of: 2) ? "W1AW" : "OM0RX", spotter: "S\($0 % 4)", band: $0.isMultiple(of: 2) ? "40m" : "20m") })
        try db.append([observation(100)])
        #expect(try db.query(SpotHistoryQuery(limit: 5)).rows.count == 5)
        let stats = try db.stats(SpotHistoryQuery(limit: 5))
        #expect(stats.total == 101); #expect(stats.distinctCalls == 3); #expect(stats.distinctSpotters == 5)
        #expect(stats.bands.reduce(Int64(0)) { $0 + $1.count } == 101)
        #expect(stats.hourly.reduce(Int64(0)) { $0 + $1.count } == 101)
        #expect(try db.stats(SpotHistoryQuery(band: "40m")).total == 50)
        let id = UUID(), time = Date(timeIntervalSince1970: 1_700_000_000)
        try db.appendHistoryEvent(id: id, occurredAt: time, kind: "recording_gap", payloadJSON: "{\"count\":3}")
        try db.appendHistoryEvent(id: id, occurredAt: time, kind: "recording_gap", payloadJSON: "{\"count\":3}")
        #expect(try db.status().revision == 3)
        db.close()
        let reopened = try SpotHistoryDatabase(url: url); defer { reopened.close() }
        #expect(try reopened.historyEvents().map(\.id) == [id])
        #expect(throws: SpotHistoryDatabaseError.self) { try reopened.historyEvents(limit: 129) }
    }

    @Test("Future, foreign and corrupt databases remain intact; symlinks rejected")
    func unsafeAndFuture() throws {
        let url = location(), fm = FileManager.default
        defer { try? fm.removeItem(at: url.deletingLastPathComponent()) }
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try sql(url, "PRAGMA user_version=99; CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('untouched');")
        let original = try Data(contentsOf: url)
        #expect(throws: SpotHistoryDatabaseError.self) { try SpotHistoryDatabase(url: url) }
        #expect(try Data(contentsOf: url) == original)
        let corrupt = url.deletingLastPathComponent().appendingPathComponent("corrupt.sqlite")
        let bytes = Data("not a SQLite database".utf8); try bytes.write(to: corrupt)
        #expect(throws: SpotHistoryDatabaseError.self) { try SpotHistoryDatabase(url: corrupt) }
        #expect(try Data(contentsOf: corrupt) == bytes)
        let foreign = url.deletingLastPathComponent().appendingPathComponent("qso.sqlite")
        try sql(foreign, "CREATE TABLE qso(value TEXT)")
        let foreignBytes = try Data(contentsOf: foreign)
        #expect(throws: SpotHistoryDatabaseError.self) { try SpotHistoryDatabase(url: foreign) }
        #expect(try Data(contentsOf: foreign) == foreignBytes)
        #if !os(Windows)
        let link = url.deletingLastPathComponent().appendingPathComponent("linked.sqlite")
        try fm.createSymbolicLink(at: link, withDestinationURL: url)
        #expect(throws: SpotHistoryDatabaseError.self) { try SpotHistoryDatabase(url: link) }
        let directoryLink = url.deletingLastPathComponent().appendingPathComponent("linked-directory")
        try fm.createSymbolicLink(at: directoryLink, withDestinationURL: url.deletingLastPathComponent())
        #expect(throws: SpotHistoryDatabaseError.self) { try SpotHistoryDatabase(url: directoryLink.appendingPathComponent("other.sqlite")) }
        #endif
    }

    @Test("Synthetic archive paging and indexed search remain bounded")
    func syntheticArchive() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try SpotHistoryDatabase(url: url); defer { db.close() }
        for batch in 0..<50 {
            try db.append((0..<100).map { index in observation(Int64(batch * 100 + index), call: "K\(index)ABC", date: Date(timeIntervalSince1970: 1_700_000_000 + Double(batch * 100 + index))) })
        }
        #expect(try db.status().total == 5000)
        #expect(try db.query(SpotHistoryQuery(call: "K5ABC", limit: 10)).rows.count == 10)
        #expect(try db.stats(SpotHistoryQuery(call: "K5ABC")).total == 50)
        var handle: OpaquePointer?
        #expect(sqlite3_open(url.path, &handle) == SQLITE_OK); defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        #expect(sqlite3_prepare_v2(handle, "EXPLAIN QUERY PLAN SELECT row_id FROM spot_observations WHERE callsign_key='K5ABC' ORDER BY arrived_at_us DESC,row_id DESC LIMIT 10", -1, &statement, nil) == SQLITE_OK)
        defer { sqlite3_finalize(statement) }
        #expect(sqlite3_step(statement) == SQLITE_ROW)
        let plan = sqlite3_column_text(statement, 3).map { String(cString: $0) } ?? ""
        #expect(plan.contains("spot_history_callsign_key"))
    }

    @Test("Durable health survives ledger trimming and idempotent retries")
    func durableHealth() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let database = try SpotHistoryDatabase(url: url), process = UUID(), gapID = UUID(), unknownID = UUID()
        let time = Date(timeIntervalSince1970: 1_700_000_000)
        try database.appendHistoryEvent(id: process, occurredAt: time, kind: "process_start", payloadJSON: "{\"processID\":\"\(process.uuidString)\"}")
        let payload = "{\"count\":19,\"processID\":\"\(process.uuidString)\"}"
        try database.appendHistoryEvent(id: gapID, occurredAt: time, kind: "recording_gap", payloadJSON: payload)
        try database.appendHistoryEvent(id: gapID, occurredAt: time, kind: "recording_gap", payloadJSON: payload)
        try database.appendHistoryEvent(id: unknownID, occurredAt: time, kind: "recording_gap", payloadJSON: "{\"count\":0,\"unknownLoss\":true}")
        for index in 0..<1030 {
            try database.appendHistoryEvent(id: UUID(), occurredAt: time.addingTimeInterval(Double(index)), kind: "connection", payloadJSON: "{}")
        }
        #expect(try database.historyEvents().allSatisfy { $0.kind == "connection" })
        let summary = try database.healthSummary()
        #expect(summary.knownUnrecorded == 19)
        #expect(summary.unknownGap)
        #expect(summary.lastProcessID == process)
        #expect(!summary.lastProcessClean)
        #expect(summary.lastProcessStartedAt == time)
        let revision = try database.status().revision
        try database.appendHistoryEvent(id: gapID, occurredAt: time, kind: "recording_gap", payloadJSON: payload)
        #expect(try database.healthSummary().knownUnrecorded == 19)
        #expect(try database.status().revision == revision)
        #expect(throws: SpotHistoryDatabaseError.self) { try database.appendHistoryEvent(id: gapID, occurredAt: time, kind: "recording_gap", payloadJSON: "{\"count\":20}") }
        database.close()
        let reopened = try SpotHistoryDatabase(url: url); defer { reopened.close() }
        #expect(try reopened.healthSummary() == summary)
        let stoppedAt = time.addingTimeInterval(2000)
        try reopened.appendHistoryEvent(id: UUID(), occurredAt: stoppedAt, kind: "clean_stop", payloadJSON: "{\"processID\":\"\(process.uuidString)\"}")
        let stopped = try reopened.healthSummary()
        #expect(stopped.lastProcessClean)
        #expect(stopped.lastProcessStoppedAt == stoppedAt)
        #expect(stopped.knownUnrecorded == 19)
        #expect(stopped.unknownGap)
    }

    @Test("Gap counts accept JSON integers but reject booleans and invalid scalar values")
    func gapCountScalarValidation() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let database = try SpotHistoryDatabase(url: url); defer { database.close() }
        let time = Date(timeIntervalSince1970: 1_700_000_000)
        for scalar in ["true", "false", "1.5", "-1", "9007199254740992", "\"1\"", "null"] {
            #expect(throws: SpotHistoryDatabaseError.self) {
                try database.appendHistoryEvent(id: UUID(), occurredAt: time, kind: "recording_gap",
                    payloadJSON: "{\"count\":\(scalar)}")
            }
        }
        #expect(try database.healthSummary().knownUnrecorded == 0)
        #expect(try database.status().revision == 0)
        #expect(try database.historyEvents().isEmpty)
        for scalar in ["0", "1", "1.0"] {
            try database.appendHistoryEvent(id: UUID(), occurredAt: time, kind: "recording_gap",
                payloadJSON: "{\"count\":\(scalar)}")
        }
        #expect(try database.healthSummary().knownUnrecorded == 2)
        #expect(try database.status().revision == 3)
    }

    @Test("Version 1 health migration is transactional and conservatively marks trimmed evidence")
    func healthMigration() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let database = try SpotHistoryDatabase(url: url), process = UUID(), time = Date(timeIntervalSince1970: 1_700_000_000)
        try database.appendHistoryEvent(id: process, occurredAt: time, kind: "process_start", payloadJSON: "{\"processID\":\"\(process.uuidString)\"}")
        try database.appendHistoryEvent(id: UUID(), occurredAt: time, kind: "recording_gap", payloadJSON: "{\"count\":7}")
        database.close()
        try sql(url, "DROP TABLE history_health_state; DROP TABLE history_health_receipts; PRAGMA user_version=1;")
        let migrated = try SpotHistoryDatabase(url: url)
        #expect(try migrated.status().schemaVersion == 2)
        #expect(try migrated.healthSummary().knownUnrecorded == 7)
        #expect(try migrated.healthSummary().lastProcessID == process)
        #expect(try migrated.status().revision == 3)
        migrated.close()
        let unchanged = try SpotHistoryDatabase(url: url); defer { unchanged.close() }
        #expect(try unchanged.status().revision == 3)
    }

    @Test("A malformed version 1 health migration rolls back without replacing the archive")
    func failedHealthMigration() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let database = try SpotHistoryDatabase(url: url)
        try database.append([observation(1)])
        database.close()
        try sql(url, "DROP TABLE history_health_state; DROP TABLE history_health_receipts; PRAGMA user_version=1; INSERT INTO history_events(event_id,occurred_at_us,kind,payload_json) VALUES('\(UUID().uuidString)',1700000000000000,'process_start','{}');")
        let original = try Data(contentsOf: url)
        #expect(throws: SpotHistoryDatabaseError.self) { try SpotHistoryDatabase(url: url) }
        #expect(try Data(contentsOf: url) == original)
        var handle: OpaquePointer?
        #expect(sqlite3_open(url.path, &handle) == SQLITE_OK); defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        #expect(sqlite3_prepare_v2(handle, "SELECT (SELECT user_version FROM pragma_user_version),(SELECT COUNT(*) FROM sqlite_master WHERE name='history_health_state'),(SELECT COUNT(*) FROM spot_observations)", -1, &statement, nil) == SQLITE_OK)
        defer { sqlite3_finalize(statement) }
        #expect(sqlite3_step(statement) == SQLITE_ROW)
        #expect(sqlite3_column_int64(statement, 0) == 1)
        #expect(sqlite3_column_int64(statement, 1) == 0)
        #expect(sqlite3_column_int64(statement, 2) == 1)
    }

    @Test("Opt-in 100k archive measurement", .enabled(if: ProcessInfo.processInfo.environment["XLOG_SPOT_HISTORY_BENCHMARK"] == "1"))
    func benchmark100k() throws {
        let url = location(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try SpotHistoryDatabase(url: url); defer { db.close() }
        let start = Date(), epoch = Date(timeIntervalSince1970: 1_700_000_000)
        for batch in 0..<1000 {
            try db.append((0..<100).map { index in
                let count = batch * 100 + index
                return observation(Int64(count), call: "K\(count % 1000)ABC", spotter: "S\(count % 50)", date: epoch.addingTimeInterval(Double(count)))
            })
        }
        let ingest = Date().timeIntervalSince(start)
        var exactTimes: [Double] = []
        for _ in 0..<20 {
            let began = Date(); let page = try db.query(SpotHistoryQuery(call: "K5ABC"))
            exactTimes.append(Date().timeIntervalSince(began)); #expect(page.rows.count == 100)
        }
        let recentStart = Date()
        let recent = try db.query(SpotHistoryQuery(from: epoch.addingTimeInterval(100_000 - 86_400), limit: 100))
        let recentElapsed = Date().timeIntervalSince(recentStart)
        let statsStart = Date(), stats = try db.stats(SpotHistoryQuery())
        let statsElapsed = Date().timeIntervalSince(statsStart)
        let reopenStart = Date(); let reader = try SpotHistoryDatabase(url: url)
        let reopenElapsed = Date().timeIntervalSince(reopenStart); reader.close()
        #expect(stats.total == 100_000); #expect(stats.distinctCalls == 1000); #expect(recent.rows.count == 100)
        #expect(try db.status().total == 100_000)
        print("SPOT_HISTORY_BENCHMARK rows=100000 ingest_s=\(ingest) exact_call_p95_s=\(exactTimes.sorted()[18]) recent24h_s=\(recentElapsed) fullstats_s=\(statsElapsed) reopen_s=\(reopenElapsed) file_bytes=\(try db.status().fileBytes)")
    }
}
