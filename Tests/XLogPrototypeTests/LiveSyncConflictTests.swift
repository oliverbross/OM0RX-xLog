#if os(macOS)
import Foundation
import XCTest
import XLogCore
@testable import XLogPrototypeSupport

final class LiveSyncConflictTests: XCTestCase {
    func testFieldProjectionAndSelectiveMergePreserveIdentityUnknownDataAndOutbox() async throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let status = try await fixture.service.handle(method: "sync_status", params: [:])
        let conflict = try XCTUnwrap((status["conflicts"] as? [[String: Any]])?.first)
        let fields = try XCTUnwrap(conflict["fields"] as? [[String: String]])
        XCTAssertEqual(Set(fields.map { $0["key"]! }), ["comment", "name"])
        XCTAssertFalse(fields.contains { ["id", "isDirty", "updatedAt", "wavelogID"].contains($0["key"]!) })
        let response = try await fixture.service.handle(method: "sync_resolve", params: ["id": conflict["id"]!, "remote_fields": ["comment"], "expected_revision": conflict["revision"]!])
        XCTAssertEqual(response["queued"] as? Bool, true)
        let merged = try XCTUnwrap(fixture.database.lookup(localID: fixture.local.id))
        XCTAssertEqual(merged.id, fixture.local.id)
        XCTAssertEqual(merged.wavelogID, 42)
        XCTAssertEqual(merged.comment, "remote note")
        XCTAssertEqual(merged.name, "Local name")
        XCTAssertEqual(merged.extraFields["APP_FUTURE_FIELD"], "preserved")
        XCTAssertTrue(merged.isDirty)
        XCTAssertTrue(try fixture.database.conflicts().isEmpty)
        XCTAssertEqual(try fixture.database.outboxEntries().map(\.id), [fixture.local.id])
    }

    func testInvalidFieldSelectionsNeverMutateOrResolveConflict() async throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let id = try XCTUnwrap(fixture.database.conflicts().first?.id.uuidString)
        for fields in [["id"], ["gridSquare"], ["unknown"], ["comment", "comment"]] {
            do {
                _ = try await fixture.service.handle(method: "sync_resolve", params: ["id": id, "remote_fields": fields])
                XCTFail("Accepted invalid selected field")
            } catch let error as WorkerFailure { XCTAssertEqual(error.code, "invalid_params") }
        }
        XCTAssertEqual(try fixture.database.lookup(localID: fixture.local.id)?.comment, "local note")
        XCTAssertEqual(try fixture.database.conflicts().count, 1)
    }

    func testChangedLocalContactRequiresReviewAndKeepsNewerLocalEdits() async throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let oldStatus = try await fixture.service.handle(method: "sync_status", params: [:])
        let oldConflict = try XCTUnwrap((oldStatus["conflicts"] as? [[String: Any]])?.first)
        var updated = try XCTUnwrap(fixture.database.lookup(localID: fixture.local.id))
        updated.name = "Edited after conflict"
        try fixture.database.save(updated)
        do {
            _ = try await fixture.service.handle(method: "sync_resolve", params: ["id": oldConflict["id"]!, "remote_fields": ["comment"], "expected_revision": oldConflict["revision"]!])
            XCTFail("Accepted a stale review")
        } catch let error as WorkerFailure { XCTAssertEqual(error.code, "conflict_changed") }
        let latest = try await fixture.service.handle(method: "sync_status", params: [:])
        let current = try XCTUnwrap((latest["conflicts"] as? [[String: Any]])?.first)
        _ = try await fixture.service.handle(method: "sync_resolve", params: ["id": current["id"]!, "remote_fields": ["comment"], "expected_revision": current["revision"]!])
        let saved = try XCTUnwrap(fixture.database.lookup(localID: fixture.local.id))
        XCTAssertEqual(saved.name, "Edited after conflict")
        XCTAssertEqual(saved.comment, "remote note")
    }

    func testIncompatibleBandAndFrequencyChoicesDoNotSave() async throws {
        let fixture = try Fixture(remoteBand: "40m", remoteFrequency: 7_025_000)
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let id = try XCTUnwrap(fixture.database.conflicts().first?.id.uuidString)
        do {
            _ = try await fixture.service.handle(method: "sync_resolve", params: ["id": id, "remote_fields": ["band"]])
            XCTFail("Accepted mismatched band/frequency")
        } catch let error as WorkerFailure { XCTAssertEqual(error.code, "merge_invalid") }
        XCTAssertEqual(try fixture.database.lookup(localID: fixture.local.id)?.band, "20m")
        XCTAssertEqual(try fixture.database.conflicts().count, 1)
    }

    func testLegacyWholeRemoteChoiceStillWorksAndSyncRequiresExplicitConfirmation() async throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        do {
            _ = try await fixture.service.handle(method: "sync_run", params: ["confirm_single_writer": false])
            XCTFail("Started sync without confirmation")
        } catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_confirmation_required") }
        let id = try XCTUnwrap(fixture.database.conflicts().first?.id.uuidString)
        _ = try await fixture.service.handle(method: "sync_resolve", params: ["id": id, "use_remote": true])
        XCTAssertEqual(try fixture.database.lookup(localID: fixture.local.id)?.comment, "remote note")
        XCTAssertFalse(try XCTUnwrap(fixture.database.lookup(localID: fixture.local.id)).isDirty)
        XCTAssertTrue(try fixture.database.outboxEntries().isEmpty)
    }
}

private struct Fixture {
    let root: URL
    let database: LogbookDatabase
    let service: LiveServiceMethods
    let local: QSO

    init(remoteBand: String = "20m", remoteFrequency: Int64 = 14_025_000) throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-conflict-test-" + UUID().uuidString)
        let logbook = LiveLogbookMethods(supportDirectory: root)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        database = try logbook.openedDatabase()
        service = LiveServiceMethods(logbook: logbook)
        local = QSO(wavelogID: 42, call: "OM0RX", start: Date(timeIntervalSince1970: 1_790_000_000), band: "20m", mode: "CW", frequencyHz: 14_025_000, name: "Local name", comment: "local note", extraFields: ["APP_FUTURE_FIELD": "preserved"])
        try database.save(local)
        var remote = local
        remote.id = UUID(); remote.isDirty = false
        remote.name = "Remote name"; remote.comment = "remote note"
        remote.band = remoteBand; remote.frequencyHz = remoteFrequency
        _ = try database.mergeRemote(remote)
    }
}
#endif
