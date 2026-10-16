import Foundation
import SQLite3
import Testing
@testable import XLogCore

@Suite("Persisted award aggregates")
struct PersistedAggregateTests {
    private func sql(_ url: URL, _ query: String) throws -> Int64 {
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw LogbookDatabaseError.open("fixture") }
        defer { sqlite3_close(db) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, query, -1, &statement, nil) == SQLITE_OK else {
            throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(statement) }
        let step = sqlite3_step(statement)
        guard step == SQLITE_ROW || step == SQLITE_DONE else {
            throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(db)))
        }
        return step == SQLITE_ROW ? sqlite3_column_int64(statement, 0) : 0
    }

    @Test("Reopening reuses valid aggregates without rewriting or decoding QSOs")
    func reopens() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite")
        let first = try LogbookDatabase(url: url)
        try first.save(QSO(call: "BY1AAA", band: "20m", mode: "CW", dxcc: 318, state: "BJ",
                           potaReference: "CN-0001", qslReceived: "Y"))
        let progress = try first.awardProgress()
        let catalog = try first.awardCatalog()
        let stats = try first.stats()
        let map = try first.dxccMapStatuses()
        let references = try first.opportunityReferenceHistory()
        let rowIDs = try sql(url, "SELECT SUM(rowid) FROM xlog_aggregate_cache;")
        #expect(try sql(url, "SELECT COUNT(*) FROM xlog_aggregate_cache;") == 5)
        first.close()
        let reopened = try LogbookDatabase(url: url)
        #expect(try reopened.awardProgress() == progress)
        #expect(try reopened.awardCatalog() == catalog)
        #expect(try reopened.stats() == stats)
        #expect(try reopened.dxccMapStatuses() == map)
        #expect(try reopened.opportunityReferenceHistory() == references)
        // Recomputing would replace the existing rows, changing their rowids.
        #expect(try sql(url, "SELECT SUM(rowid) FROM xlog_aggregate_cache;") == rowIDs)
    }

    @Test("Raw SQL writers invalidate persisted awards on insert, update and delete")
    func externalWriters() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite")
        let db = try LogbookDatabase(url: url)
        let qso = QSO(call: "BY1AAA", band: "20m", mode: "CW", dxcc: 318, state: "BJ", qslReceived: "N")
        try db.save(qso)
        let initial = try db.awardProgress()
        let initialCatalog = try db.awardCatalog()
        #expect(initial.qsoCount == 1 && initial.confirmedQSOs == 0)
        #expect(try db.stats().confirmedCount == 0)
        #expect(try db.dxccMapStatuses()[318] == "worked")
        let revision = try sql(url, "SELECT revision FROM xlog_qso_revision;")
        _ = try sql(url, "UPDATE qsos SET record_json = json_set(record_json, '$.qslReceived', 'Y');")
        #expect(try sql(url, "SELECT revision FROM xlog_qso_revision;") == revision + 1)
        #expect(try db.awardProgress().confirmedQSOs == 1)
        #expect(try db.stats().confirmedCount == 1)
        #expect(try db.dxccMapStatuses()[318] == "confirmed")
        #expect(try db.awardCatalog() != initialCatalog)
        _ = try sql(url, """
            INSERT INTO qsos(local_id,call,qso_start,band,mode,is_dirty,updated_at,record_json)
            SELECT 'external-copy',call,qso_start,band,mode,is_dirty,updated_at,record_json FROM qsos LIMIT 1;
            """)
        #expect(try db.awardProgress().qsoCount == 2)
        _ = try sql(url, "DELETE FROM qsos WHERE local_id = 'external-copy';")
        #expect(try db.awardProgress().qsoCount == 1)
        _ = try sql(url, "UPDATE qsos SET deleted_at = 1;")
        db.close()
        let reopened = try LogbookDatabase(url: url)
        #expect(try reopened.awardProgress().qsoCount == 0)
        #expect(try reopened.stats().qsoCount == 0)
        #expect(try reopened.dxccMapStatuses().isEmpty)
        #expect(try reopened.awardCatalog() == AwardCatalogEngine.compute(qsos: []))
    }

    @Test("Corrupt payloads and obsolete keys recompute rather than invent empty results")
    func damagedCache() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite")
        let db = try LogbookDatabase(url: url)
        try db.save(QSO(call: "K1ABC", band: "20m", mode: "CW", dxcc: 291))
        let expected = try db.awardProgress()
        let catalog = try db.awardCatalog()
        db.close()
        _ = try sql(url, "UPDATE xlog_aggregate_cache SET payload = X'7B7D';")
        let repaired = try LogbookDatabase(url: url)
        #expect(try repaired.awardProgress() == expected)
        #expect(try repaired.awardCatalog() == catalog)
        repaired.close()
        _ = try sql(url, "UPDATE xlog_aggregate_cache SET cache_key = cache_key || '-obsolete';")
        let upgraded = try LogbookDatabase(url: url)
        #expect(try upgraded.awardProgress() == expected)
        #expect(try upgraded.awardCatalog() == catalog)
        #expect(try sql(url, "SELECT COUNT(*) FROM xlog_aggregate_cache WHERE cache_key NOT LIKE '%-obsolete';") == 2)
    }

    @Test("Cluster rows persist exact raw fields and follow raw external mutations")
    func clusterProjection() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite")
        let db = try LogbookDatabase(url: url)
        try db.save(QSO(call: "K1ABC", start: Date(timeIntervalSince1970: 1_700_000_000.125),
                        band: "20m", mode: "DATA", submode: "FT8", dxcc: 291,
                        qslReceived: "YES", lotwReceived: "X"))
        // JSON is authoritative even when an external writer leaves scalar
        // search columns divergent. Keep raw QSL evidence, not a Boolean.
        _ = try sql(url, "UPDATE qsos SET call = 'INDEX-ONLY', band = '40m', mode = 'CW';")
        let rows = try db.clusterContactRows()
        #expect(rows.count == 1)
        #expect(rows[0].call == "K1ABC" && rows[0].band == "20m" && rows[0].mode == "FT8")
        #expect(rows[0].qslReceived == "YES" && rows[0].lotwReceived == "X")
        #expect(rows[0].start == Date(timeIntervalSince1970: 1_700_000_000.125))
        let cacheRow = try sql(url, "SELECT rowid FROM xlog_aggregate_cache WHERE cache_key = 'cluster-contacts-v1';")
        let reopened = try LogbookDatabase(url: url)
        #expect(try reopened.clusterContactRows() == rows)
        #expect(try sql(url, "SELECT rowid FROM xlog_aggregate_cache WHERE cache_key = 'cluster-contacts-v1';") == cacheRow)

        _ = try sql(url, "UPDATE qsos SET record_json = json_set(record_json, '$.qslReceived', 'Y', '$.submode', 'FT4');")
        #expect(try db.clusterContactRows().first?.qslReceived == "Y")
        #expect(try reopened.clusterContactRows().first?.mode == "FT4")
        _ = try sql(url, "UPDATE qsos SET deleted_at = 1;")
        #expect(try db.clusterContactRows().isEmpty)
        _ = try sql(url, "UPDATE qsos SET deleted_at = NULL;")
        #expect(try db.clusterContactRows().count == 1)
        _ = try sql(url, "UPDATE xlog_aggregate_cache SET payload = X'7B7D' WHERE cache_key = 'cluster-contacts-v1';")
        #expect(try db.clusterContactRows().first?.mode == "FT4")
        _ = try sql(url, "DELETE FROM qsos;")
        #expect(try reopened.clusterContactRows().isEmpty)
    }
}
