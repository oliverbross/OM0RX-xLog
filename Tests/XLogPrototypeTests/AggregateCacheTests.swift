#if os(macOS)
import Foundation
import Testing
import XLogCore

@Suite("Logbook aggregate cache invalidation")
struct AggregateCacheTests {
    @Test("Cluster projection equals full QSO mapping and follows local/external changes")
    func clusterContactProjection() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("cluster.sqlite")
        let db = try LogbookDatabase(url: url)
        let external = try LogbookDatabase(url: url)
        let first = QSO(call: "JA1ABC", start: Date(timeIntervalSince1970: 1_700_000_000),
                        band: "20m", mode: "DATA", submode: "FT8", dxcc: 339,
                        qslReceived: "YES", lotwReceived: "N")
        let fallback = QSO(call: "K1ABC", start: Date(timeIntervalSince1970: 1_600_000_000),
                           band: "40m", mode: "CW", qslReceived: "", lotwReceived: "X")
        try db.save(first)
        try db.save(fallback)
        func fullProjection() throws -> [ClusterContactRow] {
            try db.fetchAll().map { qso in
                ClusterContactRow(call: qso.call, band: qso.band,
                    mode: qso.submode.isEmpty ? qso.mode : qso.submode,
                    dxcc: qso.dxcc, start: qso.start,
                    qslReceived: qso.qslReceived, lotwReceived: qso.lotwReceived)
            }
        }
        let firstProjected = try db.clusterContactRows()
        let firstFull = try fullProjection()
        #expect(firstProjected == firstFull, "projected=\(firstProjected) full=\(firstFull)")
        #expect(try db.clusterContactRows().map(\.qslReceived) == ["YES", ""])
        try external.save(QSO(call: "OM0RX", band: "15m", mode: "SSB", dxcc: 504,
                              qslReceived: "Y"))
        let updatedProjected = try db.clusterContactRows()
        let updatedFull = try fullProjection()
        #expect(updatedProjected == updatedFull, "projected=\(updatedProjected) full=\(updatedFull)")
        try db.softDelete(first)
        #expect(try db.clusterContactRows() == fullProjection())
        #expect(try db.clusterContactRows().count == 2)
    }

    @Test("Reference history projects exact worked/confirmed counts and invalidates on edits")
    func opportunityReferences() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("references.sqlite")
        let db = try LogbookDatabase(url: url)
        let external = try LogbookDatabase(url: url)
        let first = QSO(call: "K1AAA", band: "20m", mode: "CW", potaReference: "US-0001, US-0002",
                        sig: "WCA", sigInfo: "WCA-123", qslReceived: "Y")
        let second = QSO(call: "K1BBB", band: "40m", mode: "SSB", sotaReference: "W1/AA-001",
                         potaReference: "US-0001", qslReceived: "N")
        let digital = QSO(call: "K1DIG", band: "20m", mode: "DATA", submode: "FT8",
                          potaReference: "US-0001", qslReceived: "V")
        try db.save(first)
        try db.save(second)
        try db.save(digital)
        func entry(_ kind: String, _ reference: String) throws -> OpportunityReferenceHistory {
            try #require(db.opportunityReferenceHistory().first {
                $0.kind == kind && $0.reference == reference
            })
        }
        #expect(try entry("pota", "US-0001").workedCount == 3)
        #expect(try entry("pota", "US-0001").confirmedCount == 2)
        #expect(try entry("pota", "US-0001").bandModes.count == 3)
        #expect(try entry("pota", "US-0001").bandModes.first { $0.mode == "FT8" }?.confirmedCount == 1)
        #expect(try entry("pota", "US-0001").bandModes.first { $0.mode == "DATA" } == nil)
        #expect(try entry("castle", "WCA-123").confirmedCount == 1)
        #expect(try entry("sota", "W1/AA-001").confirmedCount == 0)
        try external.softDelete(first)
        #expect(try entry("pota", "US-0001").workedCount == 2)
        #expect(try db.opportunityReferenceHistory().first { $0.kind == "castle" } == nil)
    }

    @Test("Catalogue candidate query is equivalent to full decode across all live calculators")
    func catalogCandidateSuperset() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("awards.sqlite"))
        let entries = [
            QSO(call: "JA8AAA", band: "20m", mode: "CW", dxcc: 339,
                state: "01", county: "0102", qslReceived: "Y"),
            QSO(call: "JD1AAA", band: "40m", mode: "CW", dxcc: 177, qslReceived: "Y"),
            QSO(call: "JD1BBB", band: "40m", mode: "CW", dxcc: 192, qslReceived: "Y"),
            QSO(call: "BY1AAA", band: "20m", mode: "SSB", dxcc: 318,
                state: "BJ", qslReceived: "Y"),
            QSO(call: "BV1AAA", band: "20m", mode: "CW", dxcc: 386,
                qslReceived: "Y"),
            QSO(call: "VR2AAA", band: "20m", mode: "CW", dxcc: 321,
                qslReceived: "Y"),
            QSO(call: "XX9AAA", band: "20m", mode: "CW", dxcc: 152,
                qslReceived: "Y"),
            // A school call without DXCC and a portable school component.
            QSO(call: "by1qh", band: "20m", mode: "CW", qslReceived: "Y"),
            QSO(call: "TEST/BY1QH/P", band: "40m", mode: "CW", qslReceived: "Y"),
            QSO(call: "W1AW", band: "10m", mode: "CW", dxcc: 291,
                qslReceived: "Y"),
        ]
        for entry in entries { try db.save(entry) }
        let full = try AwardCatalogEngine.compute(qsos: db.fetchAll())
        #expect(try db.awardCatalog() == full)
        try db.softDelete(entries[0])
        #expect(try db.awardCatalog() == AwardCatalogEngine.compute(qsos: db.fetchAll()))
    }

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
        var fullCatalog: AwardCatalogSnapshot?
        let uncachedCatalog = try elapsed { fullCatalog = try AwardCatalogEngine.compute(qsos: db.fetchAll()) }
        #expect(try db.awardCatalog() == fullCatalog)
        let coldProgress = try elapsed { _ = try db.awardProgress() }
        let warmProgress = try elapsed { _ = try db.awardProgress() }
        let coldStats = try elapsed { _ = try db.stats() }
        let warmStats = try elapsed { _ = try db.stats() }
        var projectedContacts: [ClusterContactRow] = []
        let projectedContactsTime = try elapsed { projectedContacts = try db.clusterContactRows() }
        var fullContacts: [QSO] = []
        let fullHistory = try elapsed { fullContacts = try db.fetchAll() }
        #expect(projectedContacts == fullContacts.map { qso in
            ClusterContactRow(call: qso.call, band: qso.band,
                mode: qso.submode.isEmpty ? qso.mode : qso.submode,
                dxcc: qso.dxcc, start: qso.start,
                qslReceived: qso.qslReceived, lotwReceived: qso.lotwReceived)
        })
        let indexedHistory = try elapsed { _ = try db.historyCandidates(call: "OM0AAO", adif: 504) }
        let restarted = try LogbookDatabase(url: URL(fileURLWithPath: path))
        var restartedCatalog: AwardCatalogSnapshot?
        var restartedProgress: AwardProgressSnapshot?
        var restartedStats: LogbookStats?
        let reopenedCatalog = try elapsed { restartedCatalog = try restarted.awardCatalog() }
        let reopenedProgress = try elapsed { restartedProgress = try restarted.awardProgress() }
        let reopenedStats = try elapsed { restartedStats = try restarted.stats() }
        #expect(restartedCatalog == fullCatalog)
        #expect(try restartedProgress == db.awardProgress())
        #expect(try restartedStats == db.stats())
        print("ISOLATED_LOGBOOK_BENCHMARK qso_count=\(try db.stats().qsoCount) " +
              "catalog_cold_s=\(coldCatalog) catalog_cached_s=\(warmCatalog) " +
              "catalog_uncached_s=\(uncachedCatalog) progress_cold_s=\(coldProgress) " +
              "progress_cached_s=\(warmProgress) stats_cold_s=\(coldStats) stats_cached_s=\(warmStats) " +
              "cluster_projection_s=\(projectedContactsTime) full_decode_s=\(fullHistory) " +
              "history_candidates_s=\(indexedHistory) " +
              "catalog_reopened_s=\(reopenedCatalog) progress_reopened_s=\(reopenedProgress) stats_reopened_s=\(reopenedStats)")
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
