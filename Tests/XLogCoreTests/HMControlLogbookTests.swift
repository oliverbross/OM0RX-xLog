import Foundation
import Testing
@testable import XLogCore

@Suite("HM Control read-only log projection")
struct HMControlLogbookTests {
    @Test("Entire log totals, grids and stored operating DXCC stay authoritative")
    func projection() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        let resolver = try CTYResolver.bundled()
        let scotland = QSO(call: "MM/LY3X/P", start: Date(timeIntervalSince1970: 1_800_000_000), band: "40m", mode: "SSB", country: "Scotland", dxcc: 279)
        let gridded = QSO(call: "OM0RX", band: "20m", mode: "CW", gridSquare: "KN08", dxcc: 504)
        let unknown = QSO(call: "N0UNKNOWN", band: "10m", mode: "SSB")
        for qso in [scotland, gridded, unknown] { try db.save(qso) }
        let before = try db.fetchAll()
        let view = try db.hmControlLogbook(resolver: resolver)
        #expect(view.total == 3); #expect(view.located == 2); #expect(view.approximate == 1)
        let portable = try #require(view.recent.first { $0.call == "MM/LY3X/P" })
        #expect(portable.whereName == "Scotland"); #expect(portable.approximate)
        #expect(portable.lat == resolver.entities.first { $0.adif == 279 }?.latitude)
        #expect(portable.start == scotland.start)
        let station = try #require(view.recent.first { $0.call == "OM0RX" })
        #expect(station.lat == MaidenheadLocator.coordinate("KN08")?.latitude)
        #expect(!station.approximate)
        #expect(try db.fetchAll() == before)
        #expect(try db.hmControlLogbook(resolver: resolver).revision == view.revision)
    }

    @Test("Same-count confirmations and changes from another connection invalidate cached data")
    func changes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), resolver = try CTYResolver.bundled()
        let db = try LogbookDatabase(url: url)
        var qso = QSO(call: "MM/LY3X/P", band: "40m", mode: "SSB", dxcc: 279)
        try db.save(qso)
        let first = try db.hmControlLogbook(resolver: resolver)
        let other = try LogbookDatabase(url: url)
        qso.lotwReceived = "Y"; try other.save(qso)
        let confirmed = try db.hmControlLogbook(resolver: resolver)
        #expect(confirmed.total == first.total); #expect(confirmed.revision != first.revision)
        #expect(confirmed.recent.first?.confirmed == true)
        #expect(confirmed.confirmations.first?.id == qso.id.uuidString)
        #expect(confirmed.baseRevision == first.revision)
        #expect(confirmed.confirmedDXCC == [279])
        qso.deletedAt = Date(); try other.save(qso)
        let removed = try db.hmControlLogbook(resolver: resolver)
        #expect(removed.total == 0); #expect(removed.points.isEmpty); #expect(removed.recent.isEmpty)
    }
}
