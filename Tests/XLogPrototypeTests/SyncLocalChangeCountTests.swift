import Foundation
import XCTest
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

final class SyncLocalChangeCountTests: XCTestCase {
    private func withDatabase(_ body: (LogbookDatabase) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("local-sync-counts-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("generated.sqlite"))
        defer { db.close() }
        try body(db)
    }
    private func remote(_ id: Int, comment: String = "remote") -> QSO {
        QSO(wavelogID: id, call: "SYN\(id)", start: Date(timeIntervalSince1970: 1_700_000_000),
            band: "20m", mode: "CW", frequencyHz: 14_025_000, comment: comment, isDirty: false)
    }
    private func sql(_ db: LogbookDatabase, _ query: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(db.url.path, &handle) == SQLITE_OK else { throw LogbookDatabaseError.open("generated fixture") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, query, nil, nil, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("generated fixture") }
    }
    private func linked(_ db: LogbookDatabase, _ remoteID: Int) throws -> QSO? {
        try db.fetchAll().first { $0.wavelogID == remoteID }
    }

    func testThreeInserts120UpdatesAndBaselineRepairRemainDistinctFromIdenticalReplay() throws {
        try withDatabase { db in
            _ = try db.mergeRemoteBatch((1...120).map { remote($0, comment: "old metadata") } + [remote(124), remote(125)])
            try sql(db, "UPDATE qsos SET baseline_json=NULL WHERE wavelog_id=125;")
            let run = try db.beginSyncReconciliation(); defer { db.endSyncReconciliation(run) }
            let incoming = (1...125).map { remote($0) }
            let result = try db.mergeRemoteSyncStepCounts(incoming[...], run: run, preservingLocal: { _ in false })
            XCTAssertEqual(result.localChanges.inserted, 3)
            XCTAssertEqual(result.localChanges.updated, 120)
            XCTAssertEqual(result.localChanges.baselineRepairs, 1)
            XCTAssertEqual(result.localChanges.markedDeleted, 0)
            XCTAssertEqual(result.conflicts, 0)
            let repeated = try db.mergeRemoteSyncStepCounts(incoming[...], run: run, preservingLocal: { _ in false })
            XCTAssertEqual(repeated.localChanges, SyncLocalChanges())
            XCTAssertEqual(repeated.conflicts, 0)
        }
    }

    func testSemanticAdoptionUpdatesOneExistingContactWhileConflictsAndHeldContactsDoNot() throws {
        try withDatabase { db in
            var unlinked = remote(7); unlinked.wavelogID = nil
            try db.save(unlinked, markDirty: false)
            _ = try db.mergeRemoteBatch([remote(8), remote(9)])
            var dirty = try XCTUnwrap(linked(db, 8)); dirty.comment = "foreground local edit"
            try db.save(dirty)
            let dirtyBefore = try db.lookup(localID: dirty.id), heldBefore = try linked(db, 9)
            let run = try db.beginSyncReconciliation(); defer { db.endSyncReconciliation(run) }
            let incoming = [remote(7), remote(8, comment: "remote changed"), remote(9, comment: "held change")]
            let result = try db.mergeRemoteSyncStepCounts(incoming[...], run: run, preservingLocal: { $0.wavelogID == 9 })
            XCTAssertEqual(result.localChanges.inserted, 0)
            XCTAssertEqual(result.localChanges.updated, 1)
            XCTAssertEqual(result.localChanges.baselineRepairs, 0)
            XCTAssertEqual(result.conflicts, 1)
            XCTAssertEqual(try db.lookup(localID: unlinked.id)?.wavelogID, 7)
            XCTAssertEqual(try db.lookup(localID: dirty.id), dirtyBefore)
            XCTAssertEqual(try linked(db, 9), heldBefore)
            XCTAssertEqual(try db.count(), 3)
            XCTAssertFalse(try db.mergeRemote(remote(7)), "Public Bool API still means conflict, not changed")
            XCTAssertTrue(try db.mergeRemote(remote(8, comment: "remote changed")))
        }
    }

    func testRemoteDeletionCountsOnlyNewCleanLocalTombstones() throws {
        try withDatabase { db in
            _ = try db.mergeRemoteBatch((1...4).map { remote($0) })
            let removedID = try XCTUnwrap(linked(db, 1)).id
            var dirty = try XCTUnwrap(linked(db, 2)); dirty.comment = "foreground edit"; try db.save(dirty)
            try db.softDelete(try XCTUnwrap(linked(db, 3)))
            let run = try db.beginSyncReconciliation(); defer { db.endSyncReconciliation(run) }
            let upper = try db.syncUpperRowID(run: run)
            let result = try db.reconcileRemoteDeletionStep(notIn: [4], after: 0, through: upper, run: run)
            XCTAssertEqual(result.deleted, 1); XCTAssertEqual(result.conflicts, 1)
            XCTAssertNotNil(try db.lookup(localID: removedID)?.deletedAt)
            XCTAssertNil(try db.lookup(localID: dirty.id)?.deletedAt)
            XCTAssertEqual(try db.reconcileRemoteDeletionStep(notIn: [4], after: 0, through: upper, run: run).deleted, 0)
        }
    }

    func testRolledBackChunkDoesNotReturnOrLeakInsertCounts() throws {
        try withDatabase { db in
            try sql(db, "CREATE TRIGGER reject_second_fixture BEFORE INSERT ON qsos WHEN NEW.call='SYN2' BEGIN SELECT RAISE(ABORT,'generated rollback'); END;")
            let run = try db.beginSyncReconciliation(); defer { db.endSyncReconciliation(run) }
            let incoming = [remote(1), remote(2)]
            XCTAssertThrowsError(try db.mergeRemoteSyncStepCounts(incoming[...], run: run, preservingLocal: { _ in false }))
            XCTAssertEqual(try db.count(), 0)
            try sql(db, "DROP TRIGGER reject_second_fixture;")
            let committed = try db.mergeRemoteSyncStepCounts(incoming[...], run: run, preservingLocal: { _ in false })
            XCTAssertEqual(committed.localChanges.inserted, 2)
            XCTAssertEqual(committed.localChanges.updated, 0)
        }
    }
}
