#if os(macOS)
import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class AutomaticReferenceTests: XCTestCase {
    private struct Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("reference-schedule-" + UUID().uuidString)
        let logbook: LiveLogbookMethods
        init() throws {
            logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        }
        func clean() {
            try? logbook.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
    }

    private actor Calls {
        var count = 0
        func record() { count += 1 }
    }

    private actor Gate {
        private var continuation: CheckedContinuation<Void, Never>?
        func wait(started: @Sendable () -> Void) async {
            await withCheckedContinuation { continuation in
                self.continuation = continuation
                started()
            }
        }
        func release() { continuation?.resume(); continuation = nil }
    }

    func testMigrationPreservesDisabledChoiceAcrossOwnersAndOrdinarySettings() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let refs = LiveReferenceMethods(logbook: fixture.logbook)
        XCTAssertNil(try fixture.logbook.automaticReferenceChecks())
        let initialStatus = try await refs.handle(method: "reference_status", params: [:])
        XCTAssertTrue(initialStatus["automatic_check"] is NSNull)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(initialStatus))
        let migrated = try await refs.handle(method: "reference_configure", params: ["enabled": false, "only_if_unset": true])
        XCTAssertEqual(migrated["automatic_check"] as? Bool, false)
        let disabledStatus = try await refs.handle(method: "reference_status", params: [:])
        XCTAssertEqual(disabledStatus["automatic_check"] as? Bool, false)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(disabledStatus))
        let reopened = LiveLogbookMethods(supportDirectory: fixture.root, inheritNativePreferences: false)
        XCTAssertEqual(try reopened.automaticReferenceChecks(), false)
        let staleRenderer = try await refs.handle(method: "reference_configure", params: ["enabled": true, "only_if_unset": true])
        XCTAssertEqual(staleRenderer["automatic_check"] as? Bool, false)
        let settings = try fixture.logbook.handle(method: "settings_load", params: [:])["settings"]!
        _ = try fixture.logbook.handle(method: "settings_save", params: ["settings": settings])
        XCTAssertEqual(try fixture.logbook.automaticReferenceChecks(), false)
        _ = try await refs.handle(method: "reference_configure", params: ["enabled": true])
        XCTAssertEqual(try reopened.automaticReferenceChecks(), true)
        XCTAssertFalse(try reopened.currentSettings().automaticSync, "Reference consent never enables QSO sync")
        try reopened.openedDatabase().close()
    }

    func testConfigurationRejectsNonBooleansAndUnknownFields() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let refs = LiveReferenceMethods(logbook: fixture.logbook)
        for params: [String: Any] in [["enabled": 1], ["enabled": "true"], ["enabled": true, "only_if_unset": 1], ["enabled": true, "unexpected": false], [:]] {
            do {
                _ = try await refs.handle(method: "reference_configure", params: params)
                XCTFail("Invalid configuration accepted")
            } catch { }
        }
        XCTAssertNil(try fixture.logbook.automaticReferenceChecks())
    }

    func testTicksRespectMigrationDisabledStateRestartSleepAndShutdown() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let calls = Calls()
        let refs = LiveReferenceMethods(logbook: fixture.logbook, scheduleOperation: { await calls.record() })
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        await refs.automaticTick(now: now)
        var count = await calls.count; XCTAssertEqual(count, 0)
        _ = try await refs.handle(method: "reference_configure", params: ["enabled": true])
        await refs.automaticTick(now: now)
        await refs.automaticTick(now: now.addingTimeInterval(59))
        count = await calls.count; XCTAssertEqual(count, 1)
        await refs.automaticTick(now: now.addingTimeInterval(60))
        await refs.automaticTick(now: now.addingTimeInterval(7_200))
        count = await calls.count; XCTAssertEqual(count, 3, "Wake catches up once without replaying missed intervals")
        _ = try await refs.handle(method: "reference_configure", params: ["enabled": false])
        await refs.automaticTick(now: now.addingTimeInterval(10_800))
        let disabled = try await refs.handle(method: "reference_schedule", params: [:])
        XCTAssertEqual(disabled["scheduled"] as? [String], [])
        count = await calls.count; XCTAssertEqual(count, 3)
        _ = try await refs.handle(method: "reference_configure", params: ["enabled": true])
        let restarted = LiveReferenceMethods(logbook: fixture.logbook, scheduleOperation: { await calls.record() })
        await restarted.automaticTick(now: now)
        count = await calls.count; XCTAssertEqual(count, 4, "New native owner sees saved preference without renderer")
        await refs.terminate(); await restarted.terminate()
        await refs.automaticTick(now: now.addingTimeInterval(20_000))
        await restarted.startAutomaticChecks()
        count = await calls.count; XCTAssertEqual(count, 4)
    }

    func testStartupTimerNeedsNoRendererAndIsIdempotent() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try fixture.logbook.configureReferenceChecks(enabled: true, onlyIfUnset: false)
        let started = expectation(description: "native automatic check")
        started.assertForOverFulfill = true
        let refs = LiveReferenceMethods(logbook: fixture.logbook, scheduleOperation: { started.fulfill() })
        await refs.startAutomaticChecks()
        await refs.startAutomaticChecks()
        await fulfillment(of: [started], timeout: 2)
        await refs.terminate()
    }

    func testStartupFailureBackoffAndWorkspaceTransitionGate() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try fixture.logbook.configureReferenceChecks(enabled: true, onlyIfUnset: false)
        let calls = Calls()
        let refs = LiveReferenceMethods(logbook: fixture.logbook, scheduleOperation: {
            await calls.record(); throw URLError(.notConnectedToInternet)
        })
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        await refs.automaticTick(now: now)
        await refs.automaticTick(now: now.addingTimeInterval(3_599))
        var count = await calls.count; XCTAssertEqual(count, 1)
        await refs.automaticTick(now: now.addingTimeInterval(3_600))
        count = await calls.count; XCTAssertEqual(count, 2)
        await refs.suspendForWorkspaceChange()
        await refs.automaticTick(now: now.addingTimeInterval(7_200))
        count = await calls.count; XCTAssertEqual(count, 2)
        await refs.finishWorkspaceChange()
        await refs.automaticTick(now: now.addingTimeInterval(7_200))
        count = await calls.count; XCTAssertEqual(count, 3)
        await refs.terminate()
    }

    func testObsoleteTickCannotRestoreItsBackoffAfterWorkspaceChange() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try fixture.logbook.configureReferenceChecks(enabled: true, onlyIfUnset: false)
        let calls = Calls(), gate = Gate()
        let started = expectation(description: "old workspace tick suspended")
        let refs = LiveReferenceMethods(logbook: fixture.logbook, scheduleOperation: {
            await calls.record()
            if await calls.count == 1 { await gate.wait { started.fulfill() } }
            throw URLError(.notConnectedToInternet)
        })
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let old = Task { await refs.automaticTick(now: now) }
        await fulfillment(of: [started], timeout: 2)
        await refs.suspendForWorkspaceChange()
        await refs.finishWorkspaceChange()
        await gate.release()
        await old.value
        await refs.automaticTick(now: now.addingTimeInterval(1))
        let count = await calls.count
        XCTAssertEqual(count, 2, "New workspace must not inherit an old tick's one-hour failure backoff")
        await refs.terminate()
    }

    func testRefreshLeaseExcludesAnotherOwnerAndReleasesWithoutUnlinking() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let directory = try fixture.logbook.referenceDirectoryURL()
        let first = try ReferenceRefreshLease(directory: directory)
        XCTAssertThrowsError(try ReferenceRefreshLease(directory: directory))
        first.release()
        let next = try ReferenceRefreshLease(directory: directory)
        next.release()
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.logbook.workspaceDirectoryURL.appendingPathComponent(".reference-refresh.lock").path))
    }

    func testReferenceDirectoryReplacementCannotReplaceLockIdentity() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let directory = try fixture.logbook.referenceDirectoryURL()
        let lease = try ReferenceRefreshLease(directory: directory)
        defer { lease.release() }
        try FileManager.default.removeItem(at: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        XCTAssertThrowsError(try ReferenceRefreshLease(directory: directory))
    }

    func testBackupsAndRestoreUseSameLeaseWithoutIncludingItInPayload() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let backup = try fixture.logbook.handle(method: "backup_create", params: ["name": "reference-lease"])
        let name = try XCTUnwrap(backup["name"] as? String)
        let directory = try fixture.logbook.referenceDirectoryURL()
        let lease = try ReferenceRefreshLease(directory: directory)
        XCTAssertThrowsError(try fixture.logbook.handle(method: "backup_create", params: ["name": "blocked"]))
        XCTAssertThrowsError(try fixture.logbook.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true]))
        lease.release()
        let restored = try fixture.logbook.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true])
        XCTAssertEqual(restored["restored"] as? Bool, true)
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertFalse(files.contains(".reference-refresh.lock"))
    }
}
#endif
