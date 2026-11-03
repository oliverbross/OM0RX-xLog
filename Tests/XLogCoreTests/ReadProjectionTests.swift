import Foundation
import SQLite3
import Testing
@testable import XLogCore

@Suite("Startup read projection")
struct ReadProjectionTests {
    private func sql(_ url: URL, _ query: String, column: Int32 = 0, allRows: Bool = false) throws -> String {
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
        guard step == SQLITE_ROW else { return "" }
        var values = [sqlite3_column_text(statement, column).map { String(cString: $0) } ?? "NULL"]
        if allRows {
            while sqlite3_step(statement) == SQLITE_ROW {
                values.append(sqlite3_column_text(statement, column).map { String(cString: $0) } ?? "NULL")
            }
        }
        return values.joined(separator: "\n")
    }

    @Test("Upgrade preserves all authoritative bytes and revisions; reopen reuses the projection")
    func migration() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        let qso = QSO(call: "K1TEST", band: "20m", mode: "CW", dxcc: 291, comment: "Full source retained")
        try db.save(qso)
        let original = try db.fetch()
        let before = try sql(url, "SELECT hex(record_json)||':'||COALESCE(hex(baseline_json),'')||':'||is_dirty||':'||updated_at FROM qsos;")
        let revision = try db.currentRevision()
        db.close()
        for name in ["xlog_qso_read_insert", "xlog_qso_read_update", "xlog_qso_read_delete"] {
            _ = try sql(url, "DROP TRIGGER \(name);")
        }
        _ = try sql(url, "DROP TABLE xlog_qso_read_projection;")
        _ = try sql(url, "CREATE INDEX idx_qsos_metrics_live ON qsos(json_extract(record_json,'$.dxcc')) WHERE deleted_at IS NULL;")
        let upgraded = try LogbookDatabase(url: url)
        #expect(try upgraded.currentRevision() == revision)
        #expect(try upgraded.fetch() == original)
        #expect(try sql(url, "SELECT hex(record_json)||':'||COALESCE(hex(baseline_json),'')||':'||is_dirty||':'||updated_at FROM qsos;") == before)
        #expect(try sql(url, "SELECT COUNT(*) FROM sqlite_master WHERE name='idx_qsos_metrics_live';") == "0")
        #expect(try sql(url, "PRAGMA integrity_check;") == "ok")
        // An otherwise unused sentinel detects a needless full rebuild on reopen.
        _ = try sql(url, "UPDATE xlog_qso_read_projection SET json_continent='REOPEN-SENTINEL';")
        upgraded.close()
        let reopened = try LogbookDatabase(url: url)
        defer { reopened.close() }
        #expect(try sql(url, "SELECT json_continent FROM xlog_qso_read_projection;") == "REOPEN-SENTINEL")
        #expect(try reopened.currentRevision() == revision)
    }

    @Test("Live page index migrates without changing records, revisions or tied pagination")
    func stableLivePageMigration() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        let instant = Date(timeIntervalSince1970: 1_793_664_000)
        for call in ["K1TIE", "K2TIE", "K3DELETED"] {
            try db.save(QSO(call: call, start: instant, band: "20m", mode: "CW"))
        }
        _ = try sql(url, "UPDATE qsos SET deleted_at=1 WHERE call='K3DELETED';")
        let expected = try db.fetch().map(\.id), revision = try db.currentRevision()
        let bytes = try sql(url, "SELECT group_concat(hex(record_json)) FROM (SELECT record_json FROM qsos ORDER BY local_id);")
        db.close()
        _ = try sql(url, "DROP INDEX idx_qsos_live_order;")
        let upgraded = try LogbookDatabase(url: url)
        #expect(try upgraded.currentRevision() == revision)
        #expect(try sql(url, "SELECT group_concat(hex(record_json)) FROM (SELECT record_json FROM qsos ORDER BY local_id);") == bytes)
        #expect(try upgraded.count() == 2)
        #expect(try upgraded.fetch(limit: 1).map(\.id) + upgraded.fetch(limit: 1, offset: 1).map(\.id) == expected)
        #expect(expected == expected.sorted { $0.uuidString < $1.uuidString })
        let plan = try sql(url, "EXPLAIN QUERY PLAN SELECT record_json FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC,local_id ASC LIMIT 20;", column: 3, allRows: true)
        #expect(plan.contains("idx_qsos_live_order"))
        #expect(!plan.contains("TEMP B-TREE"))
        upgraded.close()
        let reopened = try LogbookDatabase(url: url)
        defer { reopened.close() }
        #expect(try reopened.fetch().map(\.id) == expected)
        #expect(try reopened.currentRevision() == revision)
    }

    @Test("Raw writers, primary key changes, tombstones, rollback and physical deletion stay atomic")
    func externalTransactions() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        try db.save(QSO(call: "K1TEST", band: "20m", mode: "DATA", submode: "FT8", dxcc: 291))
        _ = try sql(url, "UPDATE qsos SET record_json=json_set(record_json,'$.qslReceived','Y'), band='40m', mode='CW';")
        #expect(try db.stats().confirmedCount == 1)
        #expect(try db.clusterContactRows().first?.band == "20m")
        #expect(try db.dxccSummary(dxcc: 291).confirmedCount == 1)
        let renamed = UUID().uuidString
        _ = try sql(url, "UPDATE qsos SET local_id='\(renamed)', record_json=json_set(record_json,'$.id','\(renamed)');")
        #expect(try sql(url, "SELECT COUNT(*) FROM xlog_qso_read_projection;") == "1")
        #expect(try sql(url, "SELECT local_id FROM xlog_qso_read_projection;") == renamed)
        _ = try sql(url, "UPDATE qsos SET deleted_at=1;")
        #expect(try db.stats().qsoCount == 0)
        #expect(try db.clusterContactRows().isEmpty)
        _ = try sql(url, "UPDATE qsos SET deleted_at=NULL;")
        #expect(try db.clusterContactRows().count == 1)
        enum Rollback: Error { case fixture }
        #expect(throws: Rollback.self) {
            try db.applyConfirmationChanges { _ in
                try db.save(QSO(call: "K2ROLLBACK", band: "40m", mode: "SSB"))
                #expect(try db.stats().qsoCount == 2)
                throw Rollback.fixture
            }
        }
        #expect(try db.stats().qsoCount == 1)
        #expect(try sql(url, "SELECT COUNT(*) FROM xlog_qso_read_projection;") == "1")
        _ = try sql(url, "DELETE FROM qsos;")
        #expect(try sql(url, "SELECT COUNT(*) FROM xlog_qso_read_projection;") == "0")
        #expect(try db.clusterContactRows().isEmpty)
    }

    @Test("Missing or altered trigger and missing derived row rebuild from source", arguments: [0, 1, 2])
    func repairsIncompleteSchema(_ damage: Int) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        try db.save(QSO(call: "K1REPAIR", band: "20m", mode: "CW", dxcc: 291))
        db.close()
        if damage < 2 {
            _ = try sql(url, "DROP TRIGGER xlog_qso_read_update;")
            if damage == 1 { _ = try sql(url, "CREATE TRIGGER xlog_qso_read_update AFTER UPDATE ON qsos BEGIN SELECT 1; END;") }
            _ = try sql(url, "UPDATE qsos SET record_json=json_set(record_json,'$.qslReceived','Y');")
        } else {
            _ = try sql(url, "DELETE FROM xlog_qso_read_projection;")
        }
        let reopened = try LogbookDatabase(url: url)
        defer { reopened.close() }
        #expect(try sql(url, "SELECT COUNT(*) FROM xlog_qso_read_projection;") == "1")
        #expect(try reopened.clusterContactRows().first?.call == "K1REPAIR")
        #expect(try reopened.stats().confirmedCount == (damage < 2 ? 1 : 0))
    }

    @Test("Untyped fields retain distinctions and source JSON validation remains explicit")
    func valueTypesAndValidation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = try IntegrationWorkspaceBootstrap.createEmpty(at: root.appendingPathComponent("workspace"))
        let db = try LogbookDatabase(url: workspace.databaseURL)
        try db.save(QSO(call: "K1TYPE", band: "20m", mode: "CW", dxcc: 291))
        _ = try sql(db.url, "UPDATE qsos SET record_json=json_set(record_json,'$.dxcc','291');")
        #expect(try sql(db.url, "SELECT typeof(json_dxcc)||':'||typeof(dxcc_int) FROM xlog_qso_read_projection;") == "text:integer")
        #expect(throws: LogbookDatabaseError.self) { try db.clusterContactRows() }
        _ = try sql(db.url, "UPDATE qsos SET record_json=json_set(record_json,'$.dxcc',NULL);")
        #expect(try sql(db.url, "SELECT typeof(json_dxcc)||':'||typeof(dxcc_int) FROM xlog_qso_read_projection;") == "null:null")
        db.close()
        _ = try sql(workspace.databaseURL, "DROP TRIGGER xlog_qso_read_update;")
        _ = try sql(workspace.databaseURL, "UPDATE qsos SET record_json=X'7B';")
        #expect(throws: IntegrationWorkspaceError.self) { try IntegrationWorkspaceBootstrap.open(at: workspace.directoryURL) }
    }
}
