import Foundation
import SQLite3
import Testing
@testable import XLogCore

@Suite("Bounded normal contact history")
struct BoundedContactHistoryTests {
    @Test("History and duplicates stop decoding after enough portable matches")
    func boundedDecoding() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        defer { db.close() }
        let recent = QSO(call: "DL1ABC/P", start: Date(timeIntervalSince1970: 1_700_000_100), band: "20m", mode: "CW")
        try db.save(recent)
        // These share the SQL prefix but must not consume the result limit.
        try db.save(QSO(call: "DL1ABC/4", start: recent.start.addingTimeInterval(1), band: "20m", mode: "CW"))
        try db.save(QSO(call: "DL1ABC/MM/P", start: recent.start.addingTimeInterval(-1), band: "20m", mode: "CW"))
        var raw: OpaquePointer?
        #expect(sqlite3_open(db.url.path, &raw) == SQLITE_OK)
        defer { sqlite3_close(raw) }
        // Valid JSON with missing QSO keys makes any unnecessary tail decode
        // fail deterministically, without timing thresholds or test-only hooks.
        let sql = """
            INSERT INTO qsos(local_id,call,qso_start,band,mode,is_dirty,updated_at,record_json)
            VALUES('\(UUID().uuidString)','DL1ABC',1700000000,'20m','CW',0,0,CAST('{}' AS BLOB));
            """
        #expect(sqlite3_exec(raw, sql, nil, nil, nil) == SQLITE_OK)
        #expect(try db.previous(call: "DL1ABC", limit: 1).map(\.id) == [recent.id])
        #expect(try db.previous(call: "DL1ABC", limit: 2).map(\.call) == ["DL1ABC/P", "DL1ABC/MM/P"])
        #expect(try db.previous(call: "DL1ABC", limit: 0).isEmpty)
        #expect(try db.latestWorkedContact(call: "DL1ABC", band: "20m", mode: "CW")?.id == recent.id)
        #expect(try db.latestWorkedContact(call: "DL1ABC", band: "20m", mode: "CW", excludingID: recent.id)?.call == "DL1ABC/MM/P")
    }

    @Test("Large repeated-call lookups remain bounded and return the newest contact")
    func largeLogBenchmark() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        defer { db.close() }
        let start = Date(timeIntervalSince1970: 1_760_000_000)
        let rows = (0..<10_000).map { QSO(call: "DL1ABC", start: start.addingTimeInterval(Double($0)), band: "20m", mode: "CW") }
        _ = try db.importBatch(rows)
        var begin = Date()
        #expect(try db.previous(call: "DL1ABC", limit: 1).first?.id == rows.last?.id)
        let previousMS = Date().timeIntervalSince(begin) * 1000
        begin = Date()
        #expect(try db.latestWorkedContact(call: "DL1ABC", band: "20m", mode: "CW")?.id == rows.last?.id)
        print("HISTORY_BENCHMARK rows=10000 previous_ms=\(previousMS) duplicate_ms=\(Date().timeIntervalSince(begin) * 1000)")
    }
}
