import Foundation
import Testing
@testable import XLogCore

struct LogbookQueryTests {
    private func database() throws -> LogbookDatabase {
        try LogbookDatabase(url: FileManager.default.temporaryDirectory.appendingPathComponent("query-\(UUID()).sqlite"))
    }
    @Test func exactSelectionUnknownsAndLiteralText() throws {
        let db = try database()
        let a = QSO(call: "OM1AAA", band: "80m", mode: "CW", dxcc: 504, notes: "O'Brien 100%_ Š", txPower: "5", myCall: "OM0RX", lotwReceived: "N")
        let b = QSO(call: "VK1AAA", band: "160m", mode: "SSB", dxcc: 150, txPower: "", myCall: "VK8RX", lotwReceived: "")
        let c = QSO(call: "OM1BBB", band: "80m", mode: "AM", dxcc: 504, txPower: "bad", myCall: "OM0RX", lotwReceived: "Y")
        for qso in [a,b,c] { try db.save(qso) }
        let all = LogbookQuery(clauses: [.init("stationCall", "eq", ["om0rx"]), .init("band", "in", ["80m", "160m"]), .init("lotw", "eq", ["N"])])
        #expect(try db.fetch(query: all).map(\.id) == [a.id])
        #expect(try db.count(query: all) == 1)
        #expect(try db.fetch(query: .init(clauses: [.init("power", "lte", ["0"])] )).isEmpty)
        #expect(Set(try db.fetch(query: .init(clauses: [.init("power", "unset")])).map(\.id)) == [b.id,c.id])
        #expect(try db.fetch(query: .init(clauses: [.init("lotw", "ne", ["Y"])] )).map(\.id) == [a.id])
        #expect(try db.fetch(query: .init(clauses: [.init("mode", "eq", ["SSB"])] )).map(\.id) == [b.id])
        #expect(Set(try db.fetch(query: .init(clauses: [.init("modeGroup", "eq", ["PHONE"])] )).map(\.id)) == [b.id,c.id])
        let any = LogbookQuery(join: "any", clauses: [.init("call", "eq", ["VK1AAA"]), .init("lotw", "eq", ["N"])])
        #expect(Set(try db.fetch(query: any).map(\.id)) == [a.id,b.id])
        #expect(try db.fetch(search: "O'Brien 100%_", query: any).map(\.id) == [a.id])
        #expect(try db.fetch(query: .init(clauses: [.init("call", "contains", ["%_"])] )).isEmpty)
        let snapshot = ADIFExportSnapshot(contacts: try db.fetch(query: all), scope: .all)
        #expect(snapshot.contactIDs == [a.id])
    }
    @Test func utcBoundaryAndFrozenExport() throws {
        let db = try database(), parser = ISO8601DateFormatter()
        let midnight = parser.date(from: "2026-11-03T00:00:00Z")!
        let a = QSO(call: "K1A", start: midnight.addingTimeInterval(-1), band: "20m", mode: "CW")
        let b = QSO(call: "K1B", start: midnight, band: "20m", mode: "CW")
        try db.save(a); try db.save(b)
        let query = LogbookQuery(clauses: [.init("date", "relative", ["today"])])
        #expect(try db.fetch(query: query, at: midnight.addingTimeInterval(-1)).map(\.id) == [a.id])
        let frozen = ADIFExportSnapshot(contacts: try db.fetch(query: query, at: midnight), scope: .all)
        var changed = b; changed.call = "K1EDIT"; try db.save(changed)
        #expect(frozen.records.first?["CALL"] == "K1B")
        #expect(try db.count(query: query, at: midnight) == 1)
    }
    @Test func rejectsInvalidTypesAndOperators() throws {
        for clause in [LogbookQuery.Clause("unknown", "eq", ["x"]), .init("power", "gt", ["nan"]), .init("call", "gt", ["5"]), .init("date", "eq", ["2026-11-03"]), .init("power", "between", ["9", "1"])] {
            #expect(throws: (any Error).self) { try LogbookQuery(clauses: [clause]).validate() }
        }
    }
    @Test func fractionalUTCAndNormalizedModeGroups() throws {
        let db=try database()
        let instant=try #require(LogbookQuery.absoluteUTCDate("2026-11-03T00:00:00.500Z"))
        let q=QSO(call:"K1FRACTION",start:instant,band:"20m",mode:" cw ")
        try db.save(q)
        let query=LogbookQuery(clauses:[.init("date","between",["2026-11-03T00:00:00.250Z","2026-11-03T00:00:00.750Z"]),.init("modeGroup","eq",["CW"])])
        #expect(try db.fetch(query:query).map(\.id) == [q.id])
        #expect(LogbookQuery.absoluteUTCDate("2026-11-03T00:00:00+01:00") == nil)
    }
    @Test func multiReferenceMembershipAndUnicodeLocation() throws {
        let db=try database()
        var q=QSO(call:"K1REF",band:"20m",mode:"CW",stationLocation:"žilina 100%_",extraFields:["MY_POTA_REF":" ","MY_SIG":"POTA","MY_SIG_INFO":"SK-0001 SK-0002"])
        q.sig="POTA";q.sigInfo="US-0001,US-0002@US-MI"
        try db.save(q)
        for clause in [LogbookQuery.Clause("pota","eq",["US-0002"]),.init("ownPota","in",["SK-0002","SK-9999"]),.init("ownLocation","contains",["ŽILINA 100%_"])] {
            #expect(try db.fetch(query:.init(clauses:[clause])).map(\.id) == [q.id])
        }
        #expect(try db.fetch(query:.init(clauses:[.init("pota","eq",["US-000"])] )).isEmpty)
    }
    @Test func embeddedNULAndMissingModeNeverBecomePartialOrDataMatches() throws {
        let db=try database()
        let q=QSO(call:"K1\0TAIL",band:"20m",mode:"",txPower:"100\0junk")
        try db.save(q)
        #expect(try db.fetch(query:.init(clauses:[.init("call","eq",["K1"])] )).isEmpty)
        #expect(try db.fetch(query:.init(clauses:[.init("power","eq",["100"])] )).isEmpty)
        #expect(try db.fetch(query:.init(clauses:[.init("modeGroup","eq",["DATA"])] )).isEmpty)
        #expect(try db.fetch(query:.init(clauses:[.init("modeGroup","unset")])).map(\.id) == [q.id])
    }
}
