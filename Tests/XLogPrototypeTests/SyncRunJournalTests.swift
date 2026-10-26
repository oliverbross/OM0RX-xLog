import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

final class SyncRunJournalTests: XCTestCase {
    func testActualMockedCreateIsJournalledBeforeDispatchAndSurvivesRestart() async throws {
        let fixture = try RunJournalFixture(); defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        var baseline = QSO(call: "BASELINE", band: "20m", mode: "CW", isDirty: false)
        try db.save(baseline, markDirty: false)
        baseline = try XCTUnwrap(db.lookup(localID: baseline.id))
        let outgoing = QSO(call: "OUTGOING", start: Date(timeIntervalSince1970: 1_700_000_000), band: "40m", mode: "CW")
        try db.save(outgoing)
        RunJournalProtocol.onPost = {
            let receipt = try! db.syncRunReceipts()[0]
            XCTAssertEqual(receipt.uploadAttempts, 1)
            XCTAssertEqual(receipt.confirmedCreates, 0)
        }
        defer { RunJournalProtocol.onPost = nil }
        let session = RunJournalProtocol.session(); defer { session.invalidateAndCancel() }
        let configuration = try WavelogConfiguration(baseURL: URL(string: "https://created.fixture.invalid")!, token: "wl2_synthetic_only", stationID: 1)
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { database, _ in
            try await SyncEngine(database: database, configuration: configuration, session: session,
                receiptID: database.syncRunReceipts()[0].id).synchronize()
        })
        _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": true])
        let completed = try await finished(service)
        let receipt = try XCTUnwrap(completed["last_run"] as? [String: Any])
        XCTAssertEqual(receipt["outcome"] as? String, "completed")
        XCTAssertEqual(receipt["trigger"] as? String, "manual")
        XCTAssertEqual(receipt["confirmed_creates"] as? Int, 1)
        XCTAssertEqual(receipt["unknown_writes"] as? Int, 0)
        XCTAssertEqual(receipt["upload_counts_complete"] as? Bool, true)
        XCTAssertEqual(try db.lookup(localID: baseline.id), baseline)
        XCTAssertEqual(try db.lookup(localID: outgoing.id)?.wavelogID, 42)
        await service.terminate()
        db.close()
        let reopened = LiveLogbookMethods(supportDirectory: fixture.root, inheritNativePreferences: false)
        let restarted = LiveServiceMethods(logbook: reopened)
        let summary = try await restarted.handle(method: "sync_summary", params: [:])
        XCTAssertEqual((summary["last_run"] as? [String: Any])?["run_id"] as? String, receipt["run_id"] as? String)
        let serialized = String(decoding: try JSONSerialization.data(withJSONObject: summary["last_run"]!), as: UTF8.self)
        XCTAssertFalse(serialized.contains("OUTGOING")); XCTAssertFalse(serialized.contains("fixture.invalid"))
        XCTAssertFalse(serialized.contains("wl2_synthetic_only"))
        await restarted.terminate(); try reopened.openedDatabase().close()
    }

    func testAutomaticConfirmedZeroIsDifferentFromAnUnobservedMockReport() async throws {
        let fixture = try RunJournalFixture(); defer { fixture.clean() }
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 1, confirmed: true)
        let session = RunJournalProtocol.session(); defer { session.invalidateAndCancel() }
        let configuration = try WavelogConfiguration(baseURL: URL(string: "https://empty.fixture.invalid")!, token: "wl2_synthetic_only", stationID: 1)
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { db, _ in
            try await SyncEngine(database: db, configuration: configuration, session: session,
                receiptID: db.syncRunReceipts()[0].id).synchronize()
        })
        await service.automaticTick()
        let status = try await finished(service)
        let receipt = try XCTUnwrap(status["last_run"] as? [String: Any])
        XCTAssertEqual(receipt["trigger"] as? String, "automatic")
        XCTAssertEqual(receipt["upload_attempts"] as? Int, 0)
        XCTAssertEqual(receipt["upload_counts_complete"] as? Bool, true)
        await service.terminate()
        let mock = LiveServiceMethods(logbook: fixture.logbook, operation: { _, _ in SyncReport() })
        _ = try await mock.handle(method: "sync_run", params: ["confirm_single_writer": true])
        let unobserved = try await finished(mock)["last_run"] as! [String: Any]
        XCTAssertTrue(unobserved["upload_attempts"] is NSNull)
        XCTAssertEqual(unobserved["upload_counts_complete"] as? Bool, false)
        await mock.terminate()
    }

    func testTimeoutAfterDispatchAndCancellationRetainUnknownWrites() async throws {
        let fixture = try RunJournalFixture(); defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        var baseline = QSO(call: "BASELINE", band: "20m", mode: "CW", isDirty: false)
        try db.save(baseline, markDirty: false)
        baseline = try XCTUnwrap(db.lookup(localID: baseline.id))
        try db.save(QSO(call: "OUTGOING", band: "40m", mode: "CW"))
        let session = RunJournalProtocol.session(); defer { session.invalidateAndCancel() }
        let configuration = try WavelogConfiguration(baseURL: URL(string: "https://timeout.fixture.invalid")!, token: "wl2_synthetic_only", stationID: 1)
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { database, _ in
            try await SyncEngine(database: database, configuration: configuration, session: session,
                receiptID: database.syncRunReceipts()[0].id).synchronize()
        })
        _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": true])
        let failed = try await finished(service)["last_run"] as! [String: Any]
        XCTAssertEqual(failed["outcome"] as? String, "completed_with_failures")
        XCTAssertEqual(failed["unknown_writes"] as? Int, 1)
        XCTAssertEqual(failed["upload_counts_complete"] as? Bool, false)
        XCTAssertEqual(try db.lookup(localID: baseline.id), baseline)
        await service.terminate()
        let cancelled = LiveServiceMethods(logbook: fixture.logbook, operation: { database, _ in
            let id = try database.syncRunReceipts()[0].id
            try database.trackSyncRunUploads(id); try database.recordSyncRunUpload(id, confirmed: nil)
            try await Task.sleep(nanoseconds: 60_000_000_000)
            return SyncReport()
        })
        _ = try await cancelled.handle(method: "sync_run", params: ["confirm_single_writer": true])
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while try db.syncRunReceipts()[0].uploadAttempts == 0 && ContinuousClock.now < deadline { await Task.yield() }
        await cancelled.terminate()
        let final = try db.syncRunReceipts()[0]
        XCTAssertEqual(final.outcome, "cancelled"); XCTAssertNotNil(final.finishedAt)
        XCTAssertEqual(final.uploadAttempts, 1); XCTAssertEqual(final.confirmedCreates, 0)
        XCTAssertEqual(try db.lookup(localID: baseline.id), baseline)
    }

    func testIncompleteReceiptReopensAsInterruptedAndRetentionDoesNotTouchContacts() async throws {
        let fixture = try RunJournalFixture(); defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        var baseline = QSO(call: "BASELINE", band: "20m", mode: "CW", isDirty: false)
        try db.save(baseline, markDirty: false)
        baseline = try XCTUnwrap(db.lookup(localID: baseline.id))
        let revision = try db.currentRevision()
        let interrupted = try db.beginSyncRun(automatic: true)
        try db.trackSyncRunUploads(interrupted.id); try db.recordSyncRunUpload(interrupted.id, confirmed: nil)
        db.close()
        let reopened = LiveLogbookMethods(supportDirectory: fixture.root, inheritNativePreferences: false)
        let service = LiveServiceMethods(logbook: reopened)
        let status = try await service.handle(method: "sync_status", params: [:])
        let receipt = status["last_run"] as! [String: Any]
        XCTAssertEqual(receipt["outcome"] as? String, "interrupted")
        XCTAssertTrue(receipt["finished_at"] is NSNull)
        XCTAssertEqual(receipt["unknown_writes"] as? Int, 1)
        let copy = try reopened.openedDatabase()
        for _ in 0..<101 {
            let run = try copy.beginSyncRun(automatic: false)
            try copy.finishSyncRun(run.id, outcome: "failed", report: nil, safeErrorCode: "sync_internal")
        }
        XCTAssertEqual(try copy.syncRunReceipts().count, 100)
        XCTAssertEqual(try copy.lookup(localID: baseline.id), baseline)
        XCTAssertEqual(try copy.currentRevision(), revision)
        await service.terminate(); copy.close()
    }

    func testCancellationAfterPredispatchReceiptPreventsTheRemoteWrite() async throws {
        let fixture = try RunJournalFixture(); defer { fixture.clean() }
        let db = try fixture.logbook.openedDatabase()
        let outgoing = QSO(call: "OUTGOING", band: "40m", mode: "CW")
        try db.save(outgoing)
        let before = try db.lookup(localID: outgoing.id)
        let receipt = try db.beginSyncRun(automatic: false)
        let session = RunJournalProtocol.session(); defer { session.invalidateAndCancel() }
        let configuration = try WavelogConfiguration(baseURL: URL(string: "https://created.fixture.invalid")!, token: "wl2_synthetic_only", stationID: 1)
        RunJournalProtocol.onPost = { XCTFail("Cancelled write crossed the network boundary") }
        defer { RunJournalProtocol.onPost = nil }
        let engine = SyncEngine(database: db, configuration: configuration, session: session, validateRun: {
            if try db.syncRunReceipts()[0].uploadAttempts > 0 { throw CancellationError() }
        }, receiptID: receipt.id)
        do { _ = try await engine.synchronize(); XCTFail("Cancelled run completed") }
        catch is CancellationError {}
        XCTAssertEqual(try db.syncRunReceipts()[0].uploadAttempts, 1)
        XCTAssertEqual(try db.syncRunReceipts()[0].confirmedCreates, 0)
        XCTAssertEqual(try db.lookup(localID: outgoing.id), before)
    }

    func testRunningReceiptsWithZeroOrAllAcknowledgedWritesRemainIncomplete() async throws {
        for count in [0, 2] {
            let fixture = try RunJournalFixture(); defer { fixture.clean() }
            let db = try fixture.logbook.openedDatabase()
            let service = LiveServiceMethods(logbook: fixture.logbook, operation: { database, _ in
                let id = try database.syncRunReceipts()[0].id
                try database.trackSyncRunUploads(id)
                for _ in 0..<count {
                    try database.recordSyncRunUpload(id, confirmed: nil)
                    try database.recordSyncRunUpload(id, confirmed: "create")
                }
                try await Task.sleep(nanoseconds: 60_000_000_000)
                return SyncReport()
            })
            _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": true])
            let deadline = ContinuousClock.now.advanced(by: .seconds(5))
            while ContinuousClock.now < deadline {
                let progress = try db.syncRunReceipts()[0]
                if progress.uploadTracking && progress.confirmedCreates == count { break }
                await Task.yield()
            }
            let status = try await service.handle(method: "sync_summary", params: [:])
            let receipt = status["last_run"] as! [String: Any]
            XCTAssertEqual(receipt["outcome"] as? String, "running")
            XCTAssertTrue(receipt["finished_at"] is NSNull)
            XCTAssertEqual(receipt["confirmed_creates"] as? Int, count)
            XCTAssertEqual(receipt["unknown_writes"] as? Int, 0)
            XCTAssertEqual(receipt["upload_counts_complete"] as? Bool, false)
            await service.terminate()
        }
    }

    func testInterruptedReceiptsWithZeroOrAllAcknowledgedWritesRemainIncomplete() async throws {
        for count in [0, 2] {
            let fixture = try RunJournalFixture(); defer { fixture.clean() }
            let db = try fixture.logbook.openedDatabase()
            let started = try db.beginSyncRun(automatic: true)
            try db.trackSyncRunUploads(started.id)
            for _ in 0..<count {
                try db.recordSyncRunUpload(started.id, confirmed: nil)
                try db.recordSyncRunUpload(started.id, confirmed: "create")
            }
            db.close()
            let reopened = LiveLogbookMethods(supportDirectory: fixture.root, inheritNativePreferences: false)
            let service = LiveServiceMethods(logbook: reopened)
            let status = try await service.handle(method: "sync_summary", params: [:])
            let receipt = status["last_run"] as! [String: Any]
            XCTAssertEqual(receipt["outcome"] as? String, "interrupted")
            XCTAssertTrue(receipt["finished_at"] is NSNull)
            XCTAssertEqual(receipt["confirmed_creates"] as? Int, count)
            XCTAssertEqual(receipt["unknown_writes"] as? Int, 0)
            XCTAssertEqual(receipt["upload_counts_complete"] as? Bool, false)
            await service.terminate(); try reopened.openedDatabase().close()
        }
    }

    private func finished(_ service: LiveServiceMethods) async throws -> [String: Any] {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while ContinuousClock.now < deadline {
            let status = try await service.handle(method: "sync_status", params: [:])
            if status["running"] as? Bool == false { return status }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("Disposable sync did not finish"); return [:]
    }
}

private struct RunJournalFixture {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sync-runs-" + UUID().uuidString)
    let logbook: LiveLogbookMethods
    init() throws {
        logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var settings = logbook.handleForSyncRunTests()
        settings["logbookMode"] = "wavelog"; settings["wavelogURL"] = "https://journal.fixture.invalid"; settings["wavelogStationID"] = 1
        _ = try logbook.saveSettingsForTest(settings)
    }
    func clean() {
        if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL) {
            workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        try? logbook.openedDatabase().close(); try? FileManager.default.removeItem(at: root)
    }
}

private extension LiveLogbookMethods {
    func handleForSyncRunTests() -> [String: Any] {
        try! handle(method: "settings_load", params: [:])["settings"] as! [String: Any]
    }
}

private final class RunJournalProtocol: URLProtocol {
    nonisolated(unsafe) static var onPost: (@Sendable () -> Void)?
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [RunJournalProtocol.self]
        return URLSession(configuration: configuration)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.httpMethod == "POST" {
            Self.onPost?()
            if request.url!.host == "timeout.fixture.invalid" {
                client?.urlProtocol(self, didFailWithError: URLError(.timedOut)); return
            }
            send(["data": ["id": 42, "call": "OUTGOING", "band": "40m", "mode": "CW", "qso_date": "2023-11-14 22:13:20"]]); return
        }
        let adif = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains { $0.name == "format" && $0.value == "adif" } == true
        send(["data": adif ? ["exported": 0, "last_fetched_id": NSNull(), "adif": ""] : [],
              "meta": ["page": 1, "per_page": 1000, "count": 0, "total": 0, "total_pages": 1, "has_more": false]])
    }
    private func send(_ object: [String: Any]) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: object))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
