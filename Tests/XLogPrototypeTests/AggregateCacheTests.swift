#if os(macOS)
import Foundation
import Testing
import XLogCore

@Suite("Logbook aggregate cache invalidation")
struct AggregateCacheTests {
    @Test("Optional isolated logbook query benchmark", .enabled(if: ProcessInfo.processInfo.environment["XLOG_PERF_DB"] != nil))
    func isolatedLogbookBenchmark() throws {
        let path = try #require(ProcessInfo.processInfo.environment["XLOG_PERF_DB"])
        let db = try LogbookDatabase(url: URL(fileURLWithPath: path))
        func elapsed(_ operation: () throws -> Void) rethrows -> Double {
            let start = ProcessInfo.processInfo.systemUptime
            try operation()
            return ProcessInfo.processInfo.systemUptime - start
        }
        let coldCatalog = try elapsed { _ = try db.awardCatalog() }
        let warmCatalog = try elapsed { _ = try db.awardCatalog() }
        let uncachedCatalog = try elapsed { _ = try AwardCatalogEngine.compute(qsos: db.fetchAll()) }
        let coldProgress = try elapsed { _ = try db.awardProgress() }
        let warmProgress = try elapsed { _ = try db.awardProgress() }
        let coldStats = try elapsed { _ = try db.stats() }
        let warmStats = try elapsed { _ = try db.stats() }
        let fullHistory = try elapsed { _ = try db.fetchAll() }
        let indexedHistory = try elapsed { _ = try db.historyCandidates(call: "OM0AAO", adif: 504) }
        print("ISOLATED_LOGBOOK_BENCHMARK qso_count=\(try db.stats().qsoCount) " +
              "catalog_cold_s=\(coldCatalog) catalog_cached_s=\(warmCatalog) " +
              "catalog_uncached_s=\(uncachedCatalog) progress_cold_s=\(coldProgress) " +
              "progress_cached_s=\(warmProgress) stats_cold_s=\(coldStats) stats_cached_s=\(warmStats) " +
              "full_decode_s=\(fullHistory) " +
              "history_candidates_s=\(indexedHistory)")
    }

    @Test("Awards, catalogue, map and stats follow local, sync and external QSO writes")
    func invalidatesEveryQSOView() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("cache.sqlite")
        let primary = try LogbookDatabase(url: url)
        let otherConnection = try LogbookDatabase(url: url)

        func wapcCount() throws -> Int {
            try #require(primary.awardCatalog().items.first(where: { $0.code == "WAPC" })).current
        }
        #expect(try primary.stats().qsoCount == 0)
        #expect(try primary.awardProgress().qsoCount == 0)
        #expect(try wapcCount() == 0)
        #expect(try primary.dxccMapStatuses().isEmpty)

        let beijing = QSO(call: "BY1AAA", band: "20m", mode: "SSB", dxcc: 318,
                          state: "BJ", qslReceived: "Y")
        try primary.save(beijing)
        #expect(try primary.stats().qsoCount == 1)
        #expect(try primary.awardProgress().confirmedQSOs == 1)
        #expect(try wapcCount() == 1)
        #expect(try primary.dxccMapStatuses()[318] == "confirmed")

        // The sync reconciliation path writes through save(markDirty: false).
        try primary.mergeRemote(QSO(call: "BY2AAA", band: "40m", mode: "CW", dxcc: 318,
                                    state: "SH", qslReceived: "Y"))
        #expect(try primary.stats().qsoCount == 2)
        #expect(try wapcCount() == 2)

        // SQLite data_version fences a second writer without a stale process cache.
        try otherConnection.save(QSO(call: "K1ABC", band: "10m", mode: "CW", dxcc: 291))
        #expect(try primary.stats().qsoCount == 3)
        #expect(try primary.awardProgress().qsoCount == 3)
        #expect(try primary.dxccMapStatuses()[291] == "worked")
        #expect(try wapcCount() == 2)

        try primary.softDelete(beijing)
        #expect(try primary.stats().qsoCount == 2)
        #expect(try primary.awardProgress().confirmedQSOs == 1)
        #expect(try wapcCount() == 1)
    }
}
#endif
