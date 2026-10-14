import Foundation
import Testing
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

@Suite("Indexed import identity lookup")
struct ImportIndexTests {
    @Test("Semantic matching uses an all-record case-insensitive index")
    func indexedIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("import.sqlite"))
        defer { database.close() }
        var handle: OpaquePointer?
        #expect(sqlite3_open(database.url.path, &handle) == SQLITE_OK)
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        let query = """
            EXPLAIN QUERY PLAN SELECT record_json FROM qsos
            WHERE call = 'k1abc' COLLATE NOCASE AND ABS(qso_start - 1700000000) < 1
              AND band = '20M' COLLATE NOCASE
              AND UPPER(COALESCE(NULLIF(TRIM(json_extract(record_json, '$.submode')), ''), mode)) = 'CW' COLLATE NOCASE
              LIMIT 1;
            """
        #expect(sqlite3_prepare_v2(handle, query, -1, &statement, nil) == SQLITE_OK)
        defer { sqlite3_finalize(statement) }
        #expect(sqlite3_step(statement) == SQLITE_ROW)
        let plan = String(cString: try #require(sqlite3_column_text(statement, 3)))
        #expect(plan.contains("SEARCH qsos USING INDEX idx_qsos_semantic"))
        #expect(!plan.contains("SCAN qsos"))

        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let original = QSO(call: "K1ABC", start: start, band: "20m", mode: "CW", comment: "retain")
        try database.save(original)
        // Soft-deleted matches must still prevent accidental resurrection by import.
        try database.softDelete(original)
        let duplicate = QSO(call: "k1abc", start: start.addingTimeInterval(0.5), band: "20M", mode: "cw")
        #expect(try database.importBatch([duplicate]) == 0)
        #expect(try database.count() == 0)
        let separate = QSO(call: "K1ABC", start: start.addingTimeInterval(1), band: "20m", mode: "CW")
        #expect(try database.importBatch([separate]) == 1)
        #expect(try database.count() == 1)

        let digitalStart = start.addingTimeInterval(10)
        let ft8 = QSO(call: "K1DIG", start: digitalStart, band: "20m", mode: "MFSK", submode: "FT8")
        try database.save(ft8)
        let ft4 = QSO(call: "K1DIG", start: digitalStart, band: "20m", mode: "MFSK", submode: "FT4")
        #expect(try database.importBatch([ft4]) == 1)
        let equivalentFT8 = QSO(call: "K1DIG", start: digitalStart, band: "20m", mode: "FT8")
        #expect(try database.importBatch([equivalentFT8]) == 0)
    }
}
