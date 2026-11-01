import Foundation
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
import Testing
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite("Thin award catalogue projection")
struct AwardCatalogProjectionTests {
    private func rawSQL(_ url: URL, _ query: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { throw LogbookDatabaseError.open("fixture") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, query, nil, nil, nil) == SQLITE_OK else {
            throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
        }
    }

    @Test("All selected fields and calculators equal full JSON with portable calls, fractional dates, NUL and large ADIF extras")
    func fullOracle() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("catalog.sqlite"))
        defer { try? db.close() }
        let schools = Set(try AwardCatalogEngine.candidateSchoolCalls())
        let entities = Set(AwardCatalogEngine.candidateDXCCs)
        for index in 0..<64 {
            let entity: Int? = [339, 177, 192, 318, 386, 321, 152, nil][index % 8]
            let call = index % 3 == 0 ? "TEST/BY1QH/P" : "JA1CAT\(index)"
            var extra = ["COMMENT": String(repeating: "é Generated ADIF only ", count: 512),
                         "EQSL_QSL_RCVD": index % 2 == 0 ? "Y" : "N", "satelliteName": "IO-86"]
            if index == 0 { extra["COMMENT"] = "before\0after é" }
            try db.save(QSO(call: call, start: Date(timeIntervalSince1970: 1_700_000_000.123456 + Double(index)),
                band: index % 2 == 0 ? "20m" : "40m", mode: "DATA", submode: "FT8", dxcc: entity,
                state: index % 8 == 3 ? "BJ" : "01", county: "0102",
                propagationMode: index % 2 == 0 ? "SAT" : "EME", qslReceived: index % 2 == 0 ? " y " : "N",
                lotwReceived: index % 3 == 0 ? "V" : "N",
                extraFields: extra))
        }
        try db.save(QSO(call: "K1UNRELATED", band: "20m", mode: "CW", dxcc: 291))
        let all = try db.fetchAll()
        let expected = all.filter { qso in
            entities.contains(qso.dxcc ?? -1) || qso.call.contains("/")
                || schools.contains(qso.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
        }.map(AwardCatalogContact.init).sorted { $0.start < $1.start }
        #expect(try db.awardCatalogContacts() == expected)
        #expect(try db.awardCatalog() == AwardCatalogEngine.compute(qsos: all))
        #expect(try db.awardCatalogContacts().count == expected.count)
    }

    @Test("Candidate rowids remain the outer loop instead of scanning every QSO in start order")
    func queryPlan() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("plan.sqlite"), db = try LogbookDatabase(url: url)
        defer { try? db.close() }
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            throw LogbookDatabaseError.open("fixture")
        }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        let query = "EXPLAIN QUERY PLAN " + LogbookDatabase.awardCatalogQuery(schoolCount: 1)
        guard sqlite3_prepare_v2(handle, query, -1, &statement, nil) == SQLITE_OK else {
            throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        var plan: [String] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            plan.append(String(cString: sqlite3_column_text(statement, 3)))
        }
        #expect(plan.contains { $0.contains("SEARCH qsos USING INTEGER PRIMARY KEY") })
        #expect(!plan.contains { $0.contains("idx_qsos_start") })
        #expect(plan.contains { $0.contains("COVERING INDEX idx_qsos_call") })
    }

    @Test("Projection rejects invalid scalar types just as the original decoder does", arguments: [
        ("call", "{}"), ("start", "true"), ("dxcc", "true"), ("dxcc", "339.5"),
        ("state", "[]"), ("extraFields", "\"{}\"")
    ])
    func rejectsInvalidTypes(field: String, value: String) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("invalid.sqlite"), db = try LogbookDatabase(url: url)
        defer { try? db.close() }
        try db.save(QSO(call: "TEST/BY1QH/P", band: "20m", mode: "CW", dxcc: 339))
        try rawSQL(url, "UPDATE qsos SET record_json=json_set(record_json,'$.\(field)',json('\(value)'));")
        #expect(throws: (any Error).self) { try db.fetchAll() }
        #expect(throws: (any Error).self) { try db.awardCatalogContacts() }
    }
}
