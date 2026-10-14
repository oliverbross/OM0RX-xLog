import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import XLogPrototypeSupport
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

final class AutomaticSyncTests: XCTestCase {
    func testConsentPersistsAcrossOwnersButIsNotEnabledByOrdinarySettings() throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
        var fields = try fixture.fields()
        fields["automaticSync"] = true
        _ = try fixture.logbook.saveSettingsForTest(fields)
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
        XCTAssertThrowsError(try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 5, confirmed: false))
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 3, confirmed: true)
        let reopened = LiveLogbookMethods(supportDirectory: fixture.root, inheritNativePreferences: false)
        XCTAssertTrue(try reopened.currentSettings().automaticSync)
        XCTAssertEqual(try reopened.currentSettings().syncIntervalMinutes, 3)
        try reopened.configureAutomaticSync(enabled: false, intervalMinutes: 3, confirmed: false)
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
    }

    func testDestinationChangeAndWorkspaceGenerationRevokeConsent() throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 5, confirmed: true)
        var fields = try fixture.fields(); fields["wavelogStationID"] = 2
        _ = try fixture.logbook.saveSettingsForTest(fields)
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
        fields["wavelogStationID"] = 1
        _ = try fixture.logbook.saveSettingsForTest(fields)
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync, "Returning to a station is not new consent")
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 5, confirmed: true)
        let generation = fixture.logbook.workspaceDirectoryURL.appendingPathComponent("edit-generation.json")
        try JSONEncoder().encode(UUID()).write(to: generation, options: .atomic)
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
        fields["logbookMode"] = "local"
        _ = try fixture.logbook.saveSettingsForTest(fields)
        XCTAssertThrowsError(try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 5, confirmed: true))
    }

    func testFilesystemCopyCannotInheritWorkspaceConsent() throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 5, confirmed: true)
        let copiedRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-copy-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: copiedRoot) }
        let copied = LiveLogbookMethods(supportDirectory: copiedRoot, inheritNativePreferences: false)
        try FileManager.default.createDirectory(at: copiedRoot, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: fixture.logbook.workspaceDirectoryURL, to: copied.workspaceDirectoryURL)
        XCTAssertFalse(try copied.currentSettings().automaticSync)
        XCTAssertTrue(try fixture.logbook.currentSettings().automaticSync)
        try copied.openedDatabase().close()
    }

    func testBackupRestoreRevokesConsentWithoutChangingDestination() throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 5, confirmed: true)
        let backup = try fixture.logbook.handle(method: "backup_create", params: ["name": "consent-fixture"])
        let name = try XCTUnwrap(backup["name"] as? String)
        _ = try fixture.logbook.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true])
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
        XCTAssertEqual(try fixture.logbook.currentSettings().wavelogStationID, 1)
    }

    func testAlreadyDeletedRemoteRecordAcknowledgesTombstoneWithoutRepeatingDelete() async throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        let qso = QSO(wavelogID: 42, call: "K1ABC", band: "20m", mode: "CW")
        try db.save(qso)
        try db.softDelete(qso)
        EmptySyncHistoryProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [EmptySyncHistoryProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let destination = try WavelogConfiguration(baseURL: URL(string: "https://sync-fixture.invalid")!, token: "wl2_fixture", stationID: 1)
        _ = try await SyncEngine(database: db, configuration: destination, session: session).synchronize()
        XCTAssertFalse(try XCTUnwrap(db.lookup(localID: qso.id)).isDirty)
        XCTAssertNotNil(try db.lookup(localID: qso.id)?.deletedAt)
        XCTAssertEqual(EmptySyncHistoryProtocol.methods(), ["GET", "GET", "GET"])
    }

    func testAcknowledgementPreservesEditsAndRemoteBaseline() throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        var qso = QSO(wavelogID: 42, call: "K1ABC", band: "20m", mode: "CW", comment: "baseline")
        try db.save(qso, markDirty: false)
        qso.comment = "submitted"
        try db.save(qso)
        let submitted = try XCTUnwrap(db.lookup(localID: qso.id))
        var edited = submitted; edited.comment = "edited during request"
        try db.save(edited)
        try db.acknowledgeSynced(submitted)
        let current = try XCTUnwrap(db.lookup(localID: qso.id))
        XCTAssertTrue(current.isDirty)
        XCTAssertEqual(current.comment, "edited during request")
        XCTAssertFalse(try db.mergeRemote(submitted), "Remote echoes must compare with what was actually sent")
        XCTAssertEqual(try db.pending().count, 1)
        XCTAssertTrue(try db.conflicts().isEmpty)
        try db.acknowledgeSynced(current)
        XCTAssertFalse(try XCTUnwrap(db.lookup(localID: qso.id)).isDirty)
    }

    func testCreateAcknowledgementKeepsConcurrentDeleteQueuedWithoutDuplicateCreate() throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW")
        try db.save(qso)
        let submitted = try XCTUnwrap(db.lookup(localID: qso.id))
        try db.softDelete(submitted)
        try db.acknowledgeSynced(submitted, wavelogID: 42)
        let current = try XCTUnwrap(db.lookup(localID: qso.id))
        XCTAssertEqual(current.wavelogID, 42)
        XCTAssertNotNil(current.deletedAt)
        XCTAssertTrue(current.isDirty)
    }

    func testDeleteAcknowledgementKeepsConcurrentUndoQueuedWithFreshRemoteIdentity() throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        let qso = QSO(wavelogID: 42, call: "K1ABC", band: "20m", mode: "CW")
        try db.save(qso)
        try db.softDelete(qso)
        let submitted = try XCTUnwrap(db.lookup(localID: qso.id))
        var restored = submitted; restored.deletedAt = nil
        try db.save(restored)
        try db.acknowledgeSynced(submitted)
        let current = try XCTUnwrap(db.lookup(localID: qso.id))
        XCTAssertNil(current.wavelogID)
        XCTAssertNil(current.deletedAt)
        XCTAssertTrue(current.isDirty)
    }

    func testCancelledEngineDoesNotStartNetworkOrAcknowledgePendingRecords() async throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW")
        try db.save(qso)
        let configuration = try WavelogConfiguration(baseURL: URL(string: "https://sync-fixture.invalid")!, token: "wl2_fixture", stationID: 1)
        let run = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await SyncEngine(database: db, configuration: configuration).synchronize()
        }
        do { _ = try await run.value; XCTFail("Cancelled synchronization continued") }
        catch is CancellationError {}
        XCTAssertTrue(try XCTUnwrap(db.lookup(localID: qso.id)).isDirty)
        XCTAssertTrue(try db.outboxEntries().allSatisfy { $0.attemptCount == 0 })
    }

    func testShutdownCancelsAndWaitsForActiveOperationBeforeReleasingLogbook() async throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let counter = SyncCounter()
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { _, _ in
            await counter.increment()
            try await Task.sleep(nanoseconds: 60_000_000_000)
            return SyncReport()
        })
        _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": true])
        for _ in 0..<2000 { if await counter.count > 0 { break }; await Task.yield() }
        await service.terminate()
        // Consent configuration also checks the logbook reservation is released.
        try fixture.logbook.configureAutomaticSync(enabled: false, intervalMinutes: 5, confirmed: false)
        await service.automaticTick(now: Date.distantFuture)
        let count = await counter.count
        XCTAssertEqual(count, 1)
    }

    func testAutomaticAndManualRunsNeverOverlapAndDoNotDependOnStatusPolling() async throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let gate = SyncGate()
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { _, _ in await gate.run(); return SyncReport() })
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 5, confirmed: true)
        await service.startAutomaticSync()
        await gate.waitForStart()
        for _ in 0..<5 { await service.automaticTick() }
        let starts = await gate.starts
        XCTAssertEqual(starts, 1)
        do {
            _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": true])
            XCTFail("Overlapping manual run accepted")
        } catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_busy") }
        var fields = try fixture.fields(); fields["wavelogStationID"] = 2
        XCTAssertThrowsError(try fixture.logbook.saveSettingsForTest(fields))
        await gate.finish()
        let status = try await completed(service)
        XCTAssertEqual(status["status"] as? String, "Completed")
        XCTAssertNotNil(status["finished_at"])
        XCTAssertTrue(status["automatic_sync"] as? Bool == true)
        await service.automaticTick()
        let count = await gate.starts
        XCTAssertEqual(count, 1, "Completion schedules the next interval, not an immediate retry")
        await service.automaticTick(now: Date.distantFuture)
        await gate.waitForStart(count: 2)
        let repeated = await gate.starts
        XCTAssertEqual(repeated, 2)
        await gate.finish()
        _ = try await completed(service)
        await service.terminate()
    }

    func testFailureBackoffAndShutdownDoNotReplayJobs() async throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let counter = SyncCounter()
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { _, _ in
            await counter.increment(); throw URLError(.networkConnectionLost)
        })
        let configured = try await service.handle(method: "sync_configure", params: ["enabled": true, "interval_minutes": 1, "confirm_single_writer": true])
        XCTAssertEqual(configured["automatic_sync"] as? Bool, true)
        await service.automaticTick()
        let status = try await completed(service)
        XCTAssertTrue((status["status"] as? String)?.hasPrefix("Failed") == true)
        let next = try XCTUnwrap(ISO8601DateFormatter().date(from: try XCTUnwrap(status["next_attempt"] as? String)))
        XCTAssertGreaterThan(next.timeIntervalSinceNow, 100)
        for _ in 0..<4 { await service.automaticTick() }
        let count = await counter.count
        XCTAssertEqual(count, 1)
        await service.terminate()
        await service.automaticTick(now: Date.distantFuture)
        let after = await counter.count
        XCTAssertEqual(after, 1)
    }

    func testDisabledAndStandaloneNeverStartAnOperation() async throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let counter = SyncCounter()
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { _, _ in await counter.increment(); return SyncReport() })
        await service.automaticTick()
        var fields = try fixture.fields(); fields["logbookMode"] = "local"
        _ = try fixture.logbook.saveSettingsForTest(fields)
        await service.automaticTick(now: Date.distantFuture)
        let count = await counter.count
        XCTAssertEqual(count, 0)
        await service.terminate()
    }

    func testNumericConfirmationCannotEnableOrStartSynchronization() async throws {
        let fixture = try SyncFixture()
        defer { fixture.clean() }
        let counter = SyncCounter()
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { _, _ in await counter.increment(); return SyncReport() })
        for params in [
            ["enabled": true, "interval_minutes": 5, "confirm_single_writer": 1],
            ["enabled": 1, "interval_minutes": 5, "confirm_single_writer": true],
            ["enabled": true, "interval_minutes": true, "confirm_single_writer": true]
        ] as [[String: Any]] {
            do { _ = try await service.handle(method: "sync_configure", params: params); XCTFail("Accepted numeric consent") }
            catch let error as WorkerFailure { XCTAssertEqual(error.code, "invalid_params") }
        }
        do { _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": 1]); XCTFail("Accepted numeric consent") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_confirmation_required") }
        let count = await counter.count
        XCTAssertEqual(count, 0)
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
        await service.terminate()
    }

    private func completed(_ service: LiveServiceMethods) async throws -> [String: Any] {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while ContinuousClock.now < deadline {
            let status = try await service.handle(method: "sync_status", params: [:])
            if status["running"] as? Bool == false { return status }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("Synthetic sync did not finish")
        return [:]
    }
}

private actor SyncCounter {
    var count = 0
    func increment() { count += 1 }
}
private final class EmptySyncHistoryProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [String] = []
    static func reset() { lock.lock(); defer { lock.unlock() }; recorded = [] }
    static func methods() -> [String] { lock.lock(); defer { lock.unlock() }; return recorded }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.recorded.append(request.httpMethod ?? ""); Self.lock.unlock()
        let isADIF = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
            .contains(where: { $0.name == "format" && $0.value == "adif" }) == true
        let data: Any = isADIF ? ["exported": 0, "last_fetched_id": NSNull(), "adif": ""] as [String: Any] : [] as [Any]
        let body = try! JSONSerialization.data(withJSONObject: ["data": data, "meta": ["page": 1, "per_page": 1000,
            "count": 0, "total": 0, "total_pages": 1, "has_more": false]])
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
private actor SyncGate {
    var starts = 0
    private var continuation: CheckedContinuation<Void, Never>?
    private var startWaiters: [(count: Int, expectation: XCTestExpectation)] = []
    func run() async {
        starts += 1
        let ready = startWaiters.filter { starts >= $0.count }
        startWaiters.removeAll { starts >= $0.count }
        for waiter in ready { waiter.expectation.fulfill() }
        await withCheckedContinuation { continuation = $0 }
    }
    func finish() { continuation?.resume(); continuation = nil }
    func waitForStart(count: Int = 1) async {
        if starts >= count { return }
        // Yield counts do not bound elapsed time or guarantee another actor
        // gets scheduled. Wait for the injected operation's actual start.
        let started = XCTestExpectation(description: "Synthetic sync operation \(count) started")
        startWaiters.append((count, started))
        let result = await XCTWaiter.fulfillment(of: [started], timeout: 5)
        startWaiters.removeAll { $0.expectation === started }
        XCTAssertEqual(result, .completed, "Synthetic sync did not start")
    }
}
private struct SyncFixture {
    let root: URL
    let logbook: LiveLogbookMethods
    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-auto-sync-" + UUID().uuidString)
        logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var settings = try fields()
        settings["logbookMode"] = "wavelog"; settings["wavelogURL"] = "https://sync-fixture.invalid"; settings["wavelogStationID"] = 1
        _ = try logbook.saveSettingsForTest(settings)
    }
    func fields() throws -> [String: Any] { try XCTUnwrap(logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any]) }
    func clean() {
        if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL) {
            workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        try? logbook.openedDatabase().close()
        try? FileManager.default.removeItem(at: root)
    }
}
