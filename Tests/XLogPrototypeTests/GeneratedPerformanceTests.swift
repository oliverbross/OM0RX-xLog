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
@testable import XLogPrototypeSupport

@Suite("Generated large log performance")
struct GeneratedPerformanceTests {
    @Test("Isolate cold database work from native rendering",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_GENERATED_PERF"] == "1"))
    func coldQueries() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-generated-perf-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("generated.sqlite"))
        defer { db.close() }
        func elapsed(_ work: () throws -> Void) rethrows -> Int {
            let started = ProcessInfo.processInfo.systemUptime
            try work()
            return Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
        }
        let entities = [("DL1T", 230), ("K1T", 291), ("JA1T", 339), ("BY1T", 318),
                        ("OM1T", 504), ("VK1T", 150), ("G1T", 223), ("PY1T", 108)]
        let start = Date(timeIntervalSince1970: 1_577_836_800)
        let importMs = try elapsed {
            for offset in stride(from: 0, to: 100_000, by: 128) {
                let values = (offset..<min(offset + 128, 100_000)).map { index in
                    let entity = entities[index % entities.count]
                    return QSO(call: entity.0 + String(index % 2000, radix: 36).uppercased(),
                        start: start.addingTimeInterval(Double(index) * 60),
                        band: ["20m", "40m", "15m"][index % 3],
                        mode: ["CW", "SSB", "FT8"][index % 3], dxcc: entity.1,
                        qslReceived: index.isMultiple(of: 2) ? "Y" : "N")
                }
                let imported = try db.importBatch(values)
                #expect(imported == values.count)
            }
        }
        #expect(try db.count() == 100_000)
        let listMs = try elapsed {
            let rows = try db.fetch(limit: 20), count = try db.count()
            #expect(rows.count == 20); #expect(count == 100_000)
        }
        let statsMs = try elapsed { let stats = try db.stats(); #expect(stats.qsoCount == 100_000) }
        let progressMs = try elapsed { let progress = try db.awardProgress(); #expect(progress.qsoCount == 100_000) }
        let mapMs = try elapsed { let statuses = try db.dxccMapStatuses(); #expect(statuses.count == 8) }
        let catalogueMs = try elapsed { _ = try db.awardCatalog() }
        let historyMs = try elapsed {
            let history = LocalContactHistory.project(rows: try db.historyRows(call: "DL1T0", adif: 230), call: "DL1T0", adif: 230)
            #expect(history["previous_count"] as? Int == 50)
            #expect(history["dxcc_contact_count"] as? Int == 12_500)
        }
        // Measure the row-local concurrency boundary independently of aggregate
        // rebuilds. These timings are diagnostic evidence, not UI/RF latency.
        let target = try #require(try db.fetch(limit: 1).first)
        var contactReadTimes: [Double] = [], contactEditTimes: [Double] = []
        for _ in 0..<100 {
            let started = ProcessInfo.processInfo.systemUptime
            let snapshot = try db.contactSnapshot(localID: target.id)
            contactReadTimes.append((ProcessInfo.processInfo.systemUptime - started) * 1000)
            #expect(snapshot?.qso.id == target.id)
        }
        for index in 0..<25 {
            let snapshot = try #require(try db.contactSnapshot(localID: target.id))
            var changed = snapshot.qso; changed.comment = "Generated edit \(index)"
            let mutation = LogbookContactMutation(operationID: UUID(), contactID: target.id,
                expectedRevision: snapshot.revision, action: .update, qso: changed)
            let started = ProcessInfo.processInfo.systemUptime
            let receipt = try db.applyContactMutation(mutation)
            contactEditTimes.append((ProcessInfo.processInfo.systemUptime - started) * 1000)
            #expect(receipt.contact.revision == snapshot.revision + 1)
        }
        func p95(_ values: [Double]) -> String {
            String(format: "%.3f", values.sorted()[Int(ceil(Double(values.count) * 0.95)) - 1])
        }
        print("GENERATED_CONTACT_PERFORMANCE qso_count=100000 read_samples=100 read_p95_ms=\(p95(contactReadTimes)) edit_samples=25 edit_p95_ms=\(p95(contactEditTimes))")
        // Simulate the first launch of an existing log that predates the derived
        // index, only in this generated database. Include the migration cost.
        let firstBeforeMigration = try db.fetch(limit: 1)
        db.close()
        var handle: OpaquePointer?
        #expect(sqlite3_open(db.url.path, &handle) == SQLITE_OK)
        defer { if let handle { sqlite3_close(handle) } }
        func scalar(_ sql: String) throws -> Int64 {
            var statement: OpaquePointer?
            #expect(sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK)
            defer { sqlite3_finalize(statement) }
            #expect(sqlite3_step(statement) == SQLITE_ROW)
            return sqlite3_column_int64(statement, 0)
        }
        let freeBefore = try scalar("PRAGMA freelist_count;")
        let pageSize = try scalar("PRAGMA page_size;")
        #expect(sqlite3_exec(handle, "DROP INDEX idx_qsos_metrics_live;", nil, nil, nil) == SQLITE_OK)
        let indexBytes = try (scalar("PRAGMA freelist_count;") - freeBefore) * pageSize
        sqlite3_close(handle)
        handle = nil
        let migrationMs = try elapsed {
            let reopened = try LogbookDatabase(url: db.url)
            defer { reopened.close() }
            let count = try reopened.count()
            #expect(count == 100_000)
            let firstAfterMigration = try reopened.fetch(limit: 1)
            #expect(firstAfterMigration == firstBeforeMigration)
        }
        print("GENERATED_PERFORMANCE qso_count=100000 import_ms=\(importMs) list_ms=\(listMs) stats_ms=\(statsMs) progress_ms=\(progressMs) map_ms=\(mapMs) catalogue_ms=\(catalogueMs) history_ms=\(historyMs) migration_ms=\(migrationMs) metrics_index_bytes=\(indexBytes)")
    }
}
