import Foundation
import SQLite3
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
    private func equalProjection(_ lhs: HMControlLogbook, _ rhs: HMControlLogbook) throws -> Bool {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(lhs) == encoder.encode(rhs)
    }

    @Test("Known local edits patch only changed contacts and match authoritative full projections")
    func incrementalChanges() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), resolver = try CTYResolver.bundled()
        let db = try LogbookDatabase(url: url)
        var contacts: [QSO] = []
        for index in 0..<65 {
            let value = QSO(call: "OM\(index)TEST", start: Date(timeIntervalSince1970: 1_800_000_000 + Double(index / 2)),
                band: "20m", mode: "CW", gridSquare: "KN08", country: "Slovakia", dxcc: 504)
            contacts.append(value); try db.save(value)
        }
        let oracle = try LogbookDatabase(url: url)
        _ = try db.hmControlLogbook(resolver: resolver); _ = try oracle.hmControlLogbook(resolver: resolver)
        func compare() throws {
            let actual = try db.hmControlLogbook(resolver: resolver)
            let full = try oracle.hmControlLogbook(resolver: resolver)
            #expect(try equalProjection(actual, full))
            #expect(db.hmControlFullProjectionBuilds == 1)
        }
        var added = QSO(call: "MM/LY3X/P", start: Date(timeIntervalSince1970: 1_800_100_000),
            band: "40m", mode: "SSB", country: "Scotland", dxcc: 279)
        try db.save(added); try compare()
        #expect(try db.hmControlLogbook(resolver: resolver).added.first?.id == added.id.uuidString)
        // Move the sole newest representative into another cell and timestamp.
        added.gridSquare = "KN08"; added.start = Date(timeIntervalSince1970: 1_700_000_000)
        try db.save(added); try compare()
        contacts[64].lotwReceived = "Y"; try db.save(contacts[64]); try compare()
        #expect(try db.hmControlLogbook(resolver: resolver).confirmations.first?.id == contacts[64].id.uuidString)
        contacts[64].deletedAt = Date(); try db.save(contacts[64]); try compare()
        #expect(try db.hmControlLogbook(resolver: resolver).confirmedDXCC.isEmpty == true)
        contacts[64].deletedAt = nil; try db.save(contacts[64]); try compare()
        // Several commits to the same ID must count revisions but patch it once.
        contacts[10].lotwReceived = "Y"; try db.save(contacts[10])
        contacts[10].lotwReceived = ""; contacts[10].gridSquare = "JN99"; try db.save(contacts[10])
        try compare()
        #expect(try db.hmControlLogbook(resolver: resolver).confirmations.isEmpty == true)
        #expect(oracle.hmControlFullProjectionBuilds == 7)
    }

    @Test("Same-connection confirmation batches retain incremental announcements")
    func incrementalConfirmationBatch() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), resolver = try CTYResolver.bundled()
        let db = try LogbookDatabase(url: url)
        try db.save(QSO(call: "OM0RX", band: "20m", mode: "CW", gridSquare: "KN08", dxcc: 504))
        let oracle = try LogbookDatabase(url: url)
        _ = try db.hmControlLogbook(resolver: resolver); _ = try oracle.hmControlLogbook(resolver: resolver)
        let count = try db.applyConfirmationChanges { rows in rows.map {
            .init(contactID: $0.qso.id, revision: $0.revision, changes: [
                .init(field: .lotwReceived, retained: $0.qso.lotwReceived, proposed: "Y")])
        } }
        #expect(count == 1)
        let actual = try db.hmControlLogbook(resolver: resolver)
        #expect(try equalProjection(actual, oracle.hmControlLogbook(resolver: resolver)))
        #expect(actual.confirmations.count == 1); #expect(actual.confirmedDXCC == [504])
        #expect(db.hmControlFullProjectionBuilds == 1)
    }

    @Test("External and unknown same-connection revisions rebuild instead of guessing changed IDs")
    func uncertainRevisionFallbacks() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), resolver = try CTYResolver.bundled()
        let db = try LogbookDatabase(url: url)
        var value = QSO(call: "OM0RX", band: "20m", mode: "CW", gridSquare: "KN08", dxcc: 504)
        try db.save(value); _ = try db.hmControlLogbook(resolver: resolver)
        // Acknowledgement also updates baseline_json directly, beyond save's hint.
        try db.acknowledgeSynced(try #require(try db.lookup(localID: value.id)))
        _ = try db.hmControlLogbook(resolver: resolver)
        #expect(db.hmControlFullProjectionBuilds == 2)
        let other = try LogbookDatabase(url: url)
        value.lotwReceived = "Y"; try other.save(value)
        value.call = "OM0RX/P"; try db.save(value)
        let actual = try db.hmControlLogbook(resolver: resolver)
        #expect(actual.recent.first?.call == "OM0RX/P"); #expect(actual.confirmedDXCC == [504])
        #expect(db.hmControlFullProjectionBuilds == 3)
    }

    @Test("Resolver changes and oversized dirty batches retain authoritative rebuilds")
    func resolverAndBatchFallbacks() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let csv = root.appendingPathComponent("cty.csv")
        try "XY,Fixture,999,EU,14,28,48.00,-17.00,-1.0,ZZ;\n".write(to: csv, atomically: true, encoding: .utf8)
        let first = try CTYResolver(csvURL: csv), db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        try db.save(QSO(call: "ZZ1TEST", band: "20m", mode: "CW", dxcc: 999))
        let original = try db.hmControlLogbook(resolver: first)
        try "XY,Fixture,999,EU,14,28,58.00,-27.00,-1.0,ZZ;\n".write(to: csv, atomically: true, encoding: .utf8)
        let changed = try CTYResolver(csvURL: csv)
        let updated = try db.hmControlLogbook(resolver: changed)
        #expect(updated.points.first?.lat != original.points.first?.lat)
        #expect(updated.baseRevision == original.revision); #expect(updated.added.isEmpty)
        #expect(db.hmControlFullProjectionBuilds == 2)
        for index in 0..<257 { try db.save(QSO(call: "ZZ\(index)TEST", band: "20m", mode: "CW", dxcc: 999)) }
        #expect(try db.hmControlLogbook(resolver: changed).total == 258)
        #expect(db.hmControlFullProjectionBuilds == 3)
    }

    @Test("Rolled-back save hints cannot authorize a later incremental projection", arguments: ["ABORT", "ROLLBACK"])
    func rollbackInvalidatesHints(_ behavior: String) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), resolver = try CTYResolver.bundled()
        let db = try LogbookDatabase(url: url)
        let qso = QSO(call: "OM0RX", band: "20m", mode: "CW", gridSquare: "KN08", dxcc: 504)
        try db.save(qso)
        var raw: OpaquePointer?
        #expect(sqlite3_open(url.path, &raw) == SQLITE_OK)
        defer { sqlite3_close(raw) }
        // The save inside acknowledgeSynced changes NULL baseline successfully;
        // its following direct baseline update fails and rolls that save back.
        #expect(sqlite3_exec(raw, "CREATE TRIGGER hm_fail_ack BEFORE UPDATE OF baseline_json ON qsos WHEN OLD.baseline_json IS NOT NULL AND NEW.baseline_json = OLD.baseline_json BEGIN SELECT RAISE(\(behavior), 'forced HM rollback'); END;", nil, nil, nil) == SQLITE_OK)
        _ = try db.hmControlLogbook(resolver: resolver)
        do { try db.acknowledgeSynced(try #require(try db.lookup(localID: qso.id))); Issue.record("Expected fixture rollback") }
        catch { #expect(String(describing: error).contains("forced HM rollback")) }
        let actual = try db.hmControlLogbook(resolver: resolver)
        #expect(actual.total == 1); #expect(actual.recent.first?.id == qso.id.uuidString)
        #expect(db.hmControlFullProjectionBuilds == 2)
    }

}
