import Foundation
import XCTest
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

final class RemoteIdentityTests: XCTestCase {
    func testDistinctRemoteIDsSurviveIdenticalContactFieldsAndRepeatedPages() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("test.sqlite"))
        defer { db.close() }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let first = QSO(wavelogID: 100, call: "K1ABC", start: start, band: "20m", mode: "FT8", isDirty: false)
        let second = QSO(wavelogID: 101, call: "K1ABC", start: start, band: "20m", mode: "FT8", isDirty: false)
        XCTAssertEqual(try db.mergeRemoteBatch([first, second]), 0)
        let before = try db.fetchAll()
        XCTAssertEqual(before.count, 2, "Separate remote identities must never collapse into one local contact")
        XCTAssertEqual(Set(before.compactMap(\.wavelogID)), [100, 101])
        XCTAssertEqual(try db.mergeRemoteBatch([second, first]), 0)
        let after = try db.fetchAll()
        XCTAssertEqual(Set(after.map(\.id)), Set(before.map(\.id)))
        XCTAssertEqual(Set(after.compactMap(\.wavelogID)), [100, 101])
    }

    func testSimilarNewRemoteContactDoesNotConflictWithDifferentDirtyRemoteIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("test.sqlite"))
        defer { db.close() }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let local = QSO(wavelogID: 100, call: "K1ABC", start: start, band: "20m", mode: "CW", comment: "Unsynced local edit")
        try db.save(local)
        let remote = QSO(wavelogID: 101, call: "K1ABC", start: start, band: "20m", mode: "CW", isDirty: false)
        XCTAssertFalse(try db.mergeRemote(remote))
        XCTAssertEqual(try db.fetchAll().count, 2)
        XCTAssertTrue(try db.conflicts().isEmpty)
        XCTAssertEqual(try db.lookup(localID: local.id)?.comment, "Unsynced local edit")
        XCTAssertTrue(try XCTUnwrap(db.lookup(localID: local.id)).isDirty)
    }

    func testUnlinkedImportedContactCanStillAcquireOneRemoteIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("test.sqlite"))
        defer { db.close() }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let local = QSO(call: "K1ABC", start: start, band: "20m", mode: "CW", extraFields: ["APP_LOCAL": "kept"], isDirty: false)
        try db.save(local, markDirty: false)
        let remote = QSO(wavelogID: 100, call: "K1ABC", start: start, band: "20m", mode: "CW", isDirty: false)
        XCTAssertFalse(try db.mergeRemote(remote))
        XCTAssertEqual(try db.fetchAll().count, 1)
        XCTAssertEqual(try db.lookup(localID: local.id)?.wavelogID, 100)
        XCTAssertEqual(try db.lookup(localID: local.id)?.extraFields["APP_LOCAL"], "kept")
    }
}
