import Foundation
import XCTest
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

final class RemoteMergeNoOpTests: XCTestCase {
    private func withDatabase(_ body: (LogbookDatabase) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("remote-merge-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("synthetic.sqlite"))
        defer { database.close() }
        try body(database)
    }

    private func sql(_ url: URL, _ query: String) throws -> Int64 {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { throw LogbookDatabaseError.open("test fixture") }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, query, -1, &statement, nil) == SQLITE_OK else {
            throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        let step = sqlite3_step(statement)
        guard step == SQLITE_ROW || step == SQLITE_DONE else {
            throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
        }
        return step == SQLITE_ROW ? sqlite3_column_int64(statement, 0) : 0
    }

    private func remote(_ remoteID: Int = 42) -> QSO {
        QSO(wavelogID: remoteID, call: "K1ABC", start: Date(timeIntervalSince1970: 1_700_000_000),
            band: "20m", mode: "CW", frequencyHz: 14_025_000, isDirty: false)
    }

    func testRepeatPageKeepsTimestampsContactRevisionAndAggregateCacheAcrossRestart() throws {
        try withDatabase { db in
            let first = remote(), second = remote(43)
            XCTAssertEqual(try db.mergeRemoteBatch([first, second]), 0)
            let original = try db.fetchAll()
            let revision = try sql(db.url, "SELECT revision FROM xlog_qso_revision;")
            let snapshots = try original.map { try XCTUnwrap(db.contactSnapshot(localID: $0.id)) }
            let stats = try db.stats()
            let cacheRowIDs = try sql(db.url, "SELECT SUM(rowid) FROM xlog_aggregate_cache;")
            var repeated = first
            repeated.id = UUID()
            repeated.updatedAt = Date(timeIntervalSince1970: 2_000_000_000)
            repeated.isDirty = true // save(markDirty: false) overrides transport metadata.
            repeated.call = " k1abc \n"
            repeated.band = "20M"
            repeated.mode = "cw"
            XCTAssertEqual(try db.mergeRemoteBatch([second, repeated]), 0)
            XCTAssertEqual(try db.fetchAll(), original)
            XCTAssertEqual(try sql(db.url, "SELECT revision FROM xlog_qso_revision;"), revision)
            XCTAssertEqual(try original.map { try XCTUnwrap(db.contactSnapshot(localID: $0.id)) }, snapshots)
            XCTAssertEqual(try db.stats(), stats)
            XCTAssertEqual(try sql(db.url, "SELECT SUM(rowid) FROM xlog_aggregate_cache;"), cacheRowIDs)
            let reopened = try LogbookDatabase(url: db.url)
            defer { reopened.close() }
            XCTAssertEqual(try reopened.mergeRemoteBatch([first, second]), 0)
            XCTAssertEqual(try reopened.fetchAll(), original)
            XCTAssertEqual(try reopened.stats(), stats)
            XCTAssertEqual(try sql(db.url, "SELECT SUM(rowid) FROM xlog_aggregate_cache;"), cacheRowIDs)
        }
    }

    func testChangesOutsideConflictFingerprintStillPersistAndInvalidateAggregates() throws {
        try withDatabase { db in
            var value = remote()
            try db.mergeRemote(value)
            _ = try db.stats()
            let originalRevision = try sql(db.url, "SELECT revision FROM xlog_qso_revision;")
            let changes: [(inout QSO) -> Void] = [
                { $0.country = "United States" }, { $0.dxcc = 291 }, { $0.continent = "NA" },
                { $0.qslReceived = "Y" }, { $0.qslSent = "Y" }, { $0.qslMethod = "B" },
                { $0.lotwReceived = "Y" }, { $0.lotwSent = "Y" },
                { $0.extraFields["APP_REMOTE"] = "changed" }, { $0.comment = "remote edit" }
            ]
            for (index, change) in changes.enumerated() {
                change(&value)
                XCTAssertFalse(try db.mergeRemote(value))
                let stored = try XCTUnwrap(db.lookup(localID: value.id))
                var expected = value
                expected.updatedAt = stored.updatedAt
                XCTAssertEqual(stored, expected)
                XCTAssertEqual(try sql(db.url, "SELECT revision FROM xlog_qso_revision;"), originalRevision + Int64(index + 1))
                XCTAssertFalse(try db.mergeRemote(value))
                XCTAssertEqual(try db.lookup(localID: value.id), stored)
            }
            XCTAssertEqual(try db.stats().confirmedCount, 1)
            XCTAssertEqual(try db.dxccMapStatuses()[291], "confirmed")
        }
    }

    func testPreservedLocalFieldsDoNotTurnUnchangedRemoteEchoIntoAWrite() throws {
        try withDatabase { db in
            var local = remote()
            local.end = local.start.addingTimeInterval(60)
            local.country = "United States"; local.dxcc = 291; local.continent = "NA"
            local.sig = "CASTLE"; local.sigInfo = "K-001"; local.dok = "A01"
            local.stationLocation = "Home"; local.radio = "Test radio"; local.operatorCall = "K1OP"
            local.myCall = "K1SELF"; local.myGrid = "FN31"; local.antennaPath = "S"
            local.email = "synthetic@example.test"; local.qslMessage = "73"
            local.qslSent = "Y"; local.qslReceived = "Y"; local.qslMethod = "B"
            local.lotwSent = "Y"; local.lotwReceived = "Y"; local.extraFields = ["APP_LOCAL": "kept"]
            try db.save(local, markDirty: false)
            let original = try XCTUnwrap(db.contactSnapshot(localID: local.id))
            XCTAssertFalse(try db.mergeRemote(remote()))
            XCTAssertEqual(try db.contactSnapshot(localID: local.id), original)
            var changed = remote()
            changed.extraFields = ["APP_REMOTE": "new"]
            XCTAssertFalse(try db.mergeRemote(changed))
            let merged = try XCTUnwrap(db.lookup(localID: local.id))
            var expected = original.qso
            expected.extraFields["APP_REMOTE"] = "new"; expected.updatedAt = merged.updatedAt
            XCTAssertEqual(merged, expected)
            XCTAssertFalse(try db.mergeRemote(changed))
            XCTAssertEqual(try db.lookup(localID: local.id), merged)
        }
    }

    func testMissingStaleOrDamagedCleanBaselineIsRepairedBeforeSkipping() throws {
        try withDatabase { db in
            let value = remote()
            try db.mergeRemote(value)
            _ = try sql(db.url, "UPDATE qsos SET baseline_json = NULL;")
            let before = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertFalse(try db.mergeRemote(value))
            let initialized = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertEqual(initialized.revision, before.revision + 1)
            _ = try sql(db.url, "UPDATE qsos SET baseline_json = json_set(baseline_json, '$.comment', 'obsolete');")
            let stale = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertFalse(try db.mergeRemote(value))
            let repaired = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertEqual(repaired.revision, stale.revision + 1)
            _ = try sql(db.url, "UPDATE qsos SET baseline_json = X'7B7D';")
            let damaged = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertFalse(try db.mergeRemote(value))
            let recovered = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertEqual(recovered.revision, damaged.revision + 1)
            XCTAssertFalse(try db.mergeRemote(value))
            XCTAssertEqual(try db.contactSnapshot(localID: value.id), recovered)
            var edit = recovered.qso
            edit.comment = "local pending edit"
            try db.save(edit)
            let pending = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertFalse(try db.mergeRemote(value))
            XCTAssertEqual(try db.contactSnapshot(localID: value.id), pending)
            XCTAssertTrue(try db.conflicts().isEmpty)
        }
    }

    func testGridCaseOnlyRemoteEchoDoesNotConflictWithDirtyLocalEdit() throws {
        try withDatabase { db in
            var baseline = remote()
            baseline.gridSquare = "IK13pk"
            try db.save(baseline, markDirty: false)

            var edited = try XCTUnwrap(db.lookup(localID: baseline.id))
            edited.comment = "local pending edit"
            try db.save(edited)

            var remoteEcho = baseline
            remoteEcho.id = UUID()
            remoteEcho.gridSquare = "IK13PK"
            XCTAssertFalse(try db.mergeRemote(remoteEcho))
            XCTAssertTrue(try db.conflicts().isEmpty)
            XCTAssertEqual(try db.pending().map(\.comment), ["local pending edit"])
        }
    }

    func testDirtyEchoConflictAndCleanTombstoneResurrectionKeepExistingSemantics() throws {
        try withDatabase { db in
            let value = remote()
            try db.mergeRemote(value)
            try db.softDelete(try XCTUnwrap(db.lookup(localID: value.id)))
            let deleted = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertFalse(try db.mergeRemote(value))
            XCTAssertEqual(try db.contactSnapshot(localID: value.id), deleted)
            var changed = value
            changed.comment = "two-sided edit"
            XCTAssertTrue(try db.mergeRemote(changed))
            XCTAssertEqual(try db.contactSnapshot(localID: value.id), deleted)
            let conflict = try XCTUnwrap(db.conflicts().first)
            XCTAssertNotNil(conflict.localQSO.deletedAt)
            XCTAssertEqual(conflict.remoteQSO.comment, "two-sided edit")
            XCTAssertTrue(try db.mergeRemote(changed))
            XCTAssertEqual(try db.conflicts().count, 1)
            try db.resolveConflict(conflict, useRemote: true)
            XCTAssertEqual(try db.count(), 1)
            XCTAssertEqual(try db.removeCleanRemoteRecords(notIn: []), 1)
            let tombstone = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertNotNil(tombstone.qso.deletedAt)
            XCTAssertFalse(try db.mergeRemote(changed))
            let resurrected = try XCTUnwrap(db.contactSnapshot(localID: value.id))
            XCTAssertNil(resurrected.qso.deletedAt)
            XCTAssertEqual(resurrected.revision, tombstone.revision + 1)
            XCTAssertEqual(try db.count(), 1)
            XCTAssertFalse(try db.mergeRemote(changed))
            XCTAssertEqual(try db.contactSnapshot(localID: value.id), resurrected)
        }
    }

    func testSyntheticLargeRepeatImportHasNoQSORevisionWrites() throws {
        guard ProcessInfo.processInfo.environment["XLOG_REMOTE_MERGE_BENCHMARK"] == "1" else {
            throw XCTSkip("Opt-in synthetic 68k remote import benchmark")
        }
        try withDatabase { db in
            let values = (1...68_000).map { index -> QSO in
                var value = remote(index)
                value.call = "K\(index % 5_000)SYN"
                value.start = value.start.addingTimeInterval(Double(index))
                return value
            }
            let initialStart = Date()
            XCTAssertEqual(try db.mergeRemoteBatch(values), 0)
            let initialSeconds = Date().timeIntervalSince(initialStart)
            let before = try sql(db.url, "SELECT revision FROM xlog_qso_revision;")
            let repeatStart = Date()
            XCTAssertEqual(try db.mergeRemoteBatch(values), 0)
            let repeatSeconds = Date().timeIntervalSince(repeatStart)
            let after = try sql(db.url, "SELECT revision FROM xlog_qso_revision;")
            XCTAssertEqual(after, before)
            XCTAssertEqual(try db.count(), values.count)
            print("SYNTHETIC_REMOTE_MERGE_BENCHMARK count=\(values.count) initial_s=\(initialSeconds) repeat_s=\(repeatSeconds) repeat_qso_writes=\(after - before)")
        }
    }
}
