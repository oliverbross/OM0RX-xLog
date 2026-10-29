import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

private actor ReconciliationStepGate {
    private var reached = false
    private var released = false
    private var release: CheckedContinuation<Void, Never>?
    private let expectation = XCTestExpectation(description: "First reconciliation chunk committed")
    func step() async {
        guard !reached, !released else { return }
        reached = true
        await withCheckedContinuation { continuation in
            release = continuation
            expectation.fulfill()
        }
    }
    func started() async throws {
        let status = await XCTWaiter.fulfillment(of: [expectation], timeout: 10)
        guard status == .completed else { throw URLError(.timedOut) }
    }
    func resume() { released = true; release?.resume(); release = nil }
}

final class BoundedSyncReconciliationTests: XCTestCase {
    private func withDatabase(_ body: (LogbookDatabase) async throws -> Void) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("bounded-sync-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("generated.sqlite"))
        defer { db.close() }
        try await body(db)
    }
    private func remote(_ id: Int, comment: String = "remote") -> QSO {
        QSO(wavelogID: id, call: "SYN\(id)", start: Date(timeIntervalSince1970: 1_700_000_000),
            band: "20m", mode: "CW", frequencyHz: 14_025_000, comment: comment, isDirty: false)
    }
    private func engine(_ db: LogbookDatabase) throws -> (SyncEngine, URLSession) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BoundedHistoryProtocol.self]
        let session = URLSession(configuration: configuration)
        let destination = try WavelogConfiguration(baseURL: URL(string: "https://bounded.synthetic.invalid")!,
                                                   token: "wl2_synthetic", stationID: 1)
        return (SyncEngine(database: db, configuration: destination, session: session), session)
    }

    func testRegisteredForegroundPrecedesNextBackgroundAdmission() throws {
        let waiting = DispatchSemaphore(value: 0), finished = DispatchSemaphore(value: 0)
        let admission = SyncDatabaseAdmission(waitObserver: { waiting.signal() })
        let events = LockedEvents()
        admission.beginForeground()
        // Recursive foreground entries do not wait for background ownership.
        admission.beginForeground(); admission.endForeground()
        DispatchQueue(label: "synthetic-admission").async {
            do {
                try admission.beginBackground()
                events.append("background_admitted")
                admission.endBackground()
            } catch { events.append("unexpected_error") }
            finished.signal()
        }
        XCTAssertEqual(waiting.wait(timeout: .now() + 5), .success)
        events.append("foreground_complete")
        admission.endForeground()
        XCTAssertEqual(finished.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(events.values, ["foreground_complete", "background_admitted"])
    }

    func testForegroundDraftAndDirtyChangesBetweenFullSnapshotChunks() async throws {
        try await withDatabase { db in
            let absent = remote(999)
            XCTAssertEqual(try db.mergeRemoteBatch((1...400).map { remote($0, comment: "baseline") } + [absent]), 0)
            let (sync, session) = try engine(db); defer { session.invalidateAndCancel() }
            let gate = ReconciliationStepGate()
            await sync.setReconciliationStepObserver { await gate.step() }
            let job = Task { try await sync.synchronize() }
            defer { job.cancel(); Task { await gate.resume() } }
            try await gate.started()
            // First 128 rows committed; no lock remains held at this rendezvous.
            let current = try db.fetchAll()
            XCTAssertEqual(current.filter { $0.comment == "remote" && $0.wavelogID != 999 }.count, 128)
            let untouched = current.filter { $0.comment == "baseline" }
            let localEdit = try XCTUnwrap(untouched.first), localDelete = try XCTUnwrap(untouched.dropFirst().first)
            let draft = try db.operatorDraft(initial: QSO(call: "", band: "20m", mode: "CW"))
            var typed = draft.qso; typed.call = "K1SYN"; typed.comment = "foreground draft survives"
            _ = try db.applyOperatorDraft(OperatorDraftMutation(operationID: UUID(), draftID: typed.id,
                expectedRevision: draft.revision, action: .replace, qso: typed),
                nextDraft: QSO(call: "", band: "20m", mode: "CW"))
            let draftSnapshot = try db.operatorDraft(initial: typed).qso
            var changed = try XCTUnwrap(db.lookup(localID: localEdit.id))
            changed.comment = "unsent local edit"; try db.save(changed)
            try db.softDelete(try XCTUnwrap(db.lookup(localID: localDelete.id)))
            let editSnapshot = try db.lookup(localID: localEdit.id), deleteSnapshot = try db.lookup(localID: localDelete.id)
            await gate.resume()
            let report = try await job.value
            XCTAssertEqual(report.pulled, 400); XCTAssertEqual(report.conflicts, 2); XCTAssertEqual(report.deleted, 1)
            XCTAssertEqual(report.localChanges?.inserted, 0)
            XCTAssertEqual(report.localChanges?.updated, 398, "Foreground edits between chunks are not sync updates")
            XCTAssertEqual(report.localChanges?.markedDeleted, 1)
            XCTAssertEqual(try db.lookup(localID: localEdit.id), editSnapshot)
            XCTAssertEqual(try db.lookup(localID: localDelete.id), deleteSnapshot)
            XCTAssertNotNil(try db.lookup(localID: absent.id)?.deletedAt)
            XCTAssertEqual(try db.operatorDraft(initial: typed).qso, draftSnapshot)
            XCTAssertEqual(try db.count(), 399)
        }
    }

    func testCancellationAfterCommittedChunkSkipsDeletionAndIsResumable() async throws {
        try await withDatabase { db in
            let absent = remote(999); try db.mergeRemote(absent)
            let receipt = try db.beginSyncRun(automatic: true)
            let (sync, session) = try engine(db); defer { session.invalidateAndCancel() }
            let gate = ReconciliationStepGate()
            await sync.setReconciliationStepObserver { await gate.step() }
            let job = Task { try await sync.synchronize() }
            defer { job.cancel(); Task { await gate.resume() } }
            try await gate.started(); job.cancel(); await gate.resume()
            do { _ = try await job.value; XCTFail("Cancelled sync completed") } catch is CancellationError {}
            try db.finishSyncRun(receipt.id, outcome: "cancelled", report: nil, safeErrorCode: "cancelled")
            XCTAssertNil(try db.syncRunReceipts()[0].reportCounts, "Committed partial chunks must not become fabricated completed totals")
            XCTAssertEqual(try db.count(), 129)
            XCTAssertNil(try db.lookup(localID: absent.id)?.deletedAt)
            let (retry, retrySession) = try engine(db); defer { retrySession.invalidateAndCancel() }
            let retried = try await retry.synchronize()
            XCTAssertEqual(retried.pulled, 400)
            XCTAssertEqual(retried.localChanges?.inserted, 272)
            XCTAssertEqual(retried.localChanges?.updated, 0)
            XCTAssertEqual(retried.localChanges?.markedDeleted, 1)
            XCTAssertEqual(try db.count(), 400)
        }
    }

    func testCancellationRollsBackActiveChunkAndRunTokensFenceClosedConnections() async throws {
        try await withDatabase { db in
            let first = remote(1, comment: "baseline"), second = remote(2, comment: "baseline")
            _ = try db.mergeRemoteBatch([first, second])
            let before = try db.fetchAll(), run = try db.beginSyncReconciliation()
            XCTAssertThrowsError(try db.beginSyncReconciliation())
            let changed = [remote(1), remote(2)]
            let job = Task.detached {
                try db.mergeRemoteSyncStep(changed[...], run: run, preservingLocal: { _ in
                    withUnsafeCurrentTask { $0?.cancel() }
                    return false
                })
            }
            do { _ = try await job.value; XCTFail("Cancelled transaction committed") } catch is CancellationError {}
            XCTAssertEqual(try db.fetchAll(), before)
            db.endSyncReconciliation(run)
            let replacement = try db.beginSyncReconciliation()
            db.endSyncReconciliation(run) // A stale finish cannot release it.
            XCTAssertThrowsError(try db.beginSyncReconciliation())
            db.close()
            XCTAssertThrowsError(try db.withSyncDatabaseLock(replacement) { try db.save(remote(3)) })
        }
    }

    func testDeletionCursorVisitsPresentDirtyDeletedAndUnlinkedRowsWithoutStalling() async throws {
        try await withDatabase { db in
            let remotes = (1...300).map { remote($0) }
            _ = try db.mergeRemoteBatch(remotes)
            let dirty = try XCTUnwrap(db.lookup(localID: remotes[149].id))
            var edited = dirty; edited.comment = "local"; try db.save(edited)
            try db.softDelete(try XCTUnwrap(db.lookup(localID: remotes[199].id)))
            let unlinked = QSO(call: "K1NEW", band: "20m", mode: "CW"); try db.save(unlinked)
            let run = try db.beginSyncReconciliation(); defer { db.endSyncReconciliation(run) }
            let upper = try db.syncUpperRowID(run: run)
            var cursor: Int64 = 0, steps = 0, deleted = 0, conflicts = 0
            repeat {
                let step = try db.reconcileRemoteDeletionStep(notIn: Set(1...300).subtracting([150, 250]),
                    after: cursor, through: upper, run: run)
                XCTAssertGreaterThan(step.cursor, cursor)
                cursor = step.cursor; steps += 1; deleted += step.deleted; conflicts += step.conflicts
                if step.done { break }
            } while steps < 10 // Safety cap, not a scheduling/timing assertion.
            XCTAssertEqual(steps, 3); XCTAssertEqual(deleted, 1); XCTAssertEqual(conflicts, 1)
            XCTAssertEqual(try db.lookup(localID: dirty.id)?.comment, "local")
            XCTAssertTrue(try XCTUnwrap(db.lookup(localID: dirty.id)).isDirty)
            XCTAssertNotNil(try db.lookup(localID: unlinked.id))
        }
    }

    func testPendingPagesBoundHeldAndDeferredScanningAndRetainUpdateOrder() async throws {
        try await withDatabase { db in
            for index in 0..<300 { try db.save(QSO(call: "K\(index)SYN", band: "20m", mode: "CW")) }
            let original = try db.pending(limit: 500)
            for value in original.prefix(150) { try db.recordSyncFailure(localID: value.id, message: "synthetic") }
            let run = try db.beginSyncReconciliation(); defer { db.endSyncReconciliation(run) }
            let upper = try db.syncUpperRowID(run: run)
            var cursor: Int64 = 0
            var collected: [UUID] = [], steps = 0
            while true {
                let step = try db.pendingSyncStep(after: cursor, through: upper, due: Date(), run: run)
                cursor = step.cursor; steps += 1
                collected += step.rows.map(\.id)
                if step.done { break }
                XCTAssertLessThan(steps, 10)
            }
            XCTAssertEqual(steps, 3)
            XCTAssertEqual(Set(collected), Set(original.dropFirst(150).map(\.id)))
        }
    }

    func testConflictedRowsCannotStarveLaterPendingUploads() async throws {
        try await withDatabase { db in
            for index in 0..<129 {
                var local = QSO(wavelogID: index + 1, call: "K\(index)CON", band: "20m", mode: "CW")
                try db.save(local, markDirty: false)
                local.comment = "local"
                try db.save(local)
                var remote = local
                remote.id = UUID()
                remote.isDirty = false
                remote.comment = "remote"
                XCTAssertTrue(try db.mergeRemote(remote))
            }
            let upload = QSO(call: "K1READY", band: "20m", mode: "CW")
            try db.save(upload)
            let run = try db.beginSyncReconciliation()
            defer { db.endSyncReconciliation(run) }
            let upper = try db.syncUpperRowID(run: run)
            let step = try db.pendingSyncStep(after: 0, through: upper, due: Date(), run: run)
            XCTAssertEqual(step.rows.map(\.id), [upload.id])
            XCTAssertTrue(step.done)
        }
    }

    func testWorkspaceLeaseBlocksRestoreAndStaleReleaseCannotEndNewRun() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sync-lease-\(UUID().uuidString)")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer {
            try? service.openedDatabase().close()
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL) {
                workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            try? FileManager.default.removeItem(at: root)
        }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var fields = try XCTUnwrap(service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        fields["logbookMode"] = "wavelog"
        _ = try service.saveSettingsForTest(fields)
        let backup = try service.handle(method: "backup_create", params: ["name": "synthetic"])
        let first = try service.beginManualSync()
        XCTAssertThrowsError(try service.handle(method: "backup_restore", params: ["name": backup["name"]!, "confirm_restore": true]))
        XCTAssertTrue(service.endManualSync(first))
        let second = try service.beginManualSync()
        XCTAssertFalse(service.endManualSync(first))
        XCTAssertNoThrow(try service.validateManualSync(second))
        try JSONEncoder().encode(UUID()).write(to: service.workspaceDirectoryURL.appendingPathComponent("edit-generation.json"), options: .atomic)
        XCTAssertThrowsError(try service.validateManualSync(second))
        XCTAssertTrue(service.endManualSync(second))
    }

    func testPendingCursorDoesNotRevisitRowsMovedForwardByForegroundEdits() async throws {
        try await withDatabase { db in
            var held: [QSO] = []
            for index in 0..<300 {
                let value = QSO(call: "K\(index)SYN", band: "20m", mode: "CW")
                try db.save(value); if index < 128 { held.append(value) }
            }
            let run = try db.beginSyncReconciliation(); defer { db.endSyncReconciliation(run) }
            let upper = try db.syncUpperRowID(run: run)
            var cursor: Int64 = 0, seen = Set<UUID>(), steps = 0
            while true {
                let step = try db.pendingSyncStep(after: cursor, through: upper, due: Date(), run: run)
                cursor = step.cursor; steps += 1
                for value in step.rows { XCTAssertTrue(seen.insert(value.id).inserted) }
                // Mutable updated_at is deliberately pushed ahead of the old
                // cursor on every page; the physical cursor never rescans it.
                for var value in held { value.comment = "foreground \(steps)"; try db.save(value) }
                if step.done { break }
                XCTAssertLessThan(steps, 10)
            }
            XCTAssertEqual(steps, 3); XCTAssertEqual(seen.count, 300)
        }
    }

    func testRestoredAuthorityValidationPreservesClosedConnectionErrors() async throws {
        try await withDatabase { db in
            let destination = try WavelogConfiguration(baseURL: URL(string: "https://bounded.synthetic.invalid")!,
                                                       token: "wl2_synthetic", stationID: 1)
            db.close()
            XCTAssertThrowsError(try db.validateRestoredWavelogAuthority(settings: .defaults)) { error in
                guard case LogbookDatabaseError.closed = error else {
                    return XCTFail("Expected closed database, got \(error)")
                }
            }
            XCTAssertThrowsError(try db.validateRestoredWavelogAuthority(configuration: destination)) { error in
                guard case LogbookDatabaseError.syncRunChanged = error else {
                    return XCTFail("Expected invalidated sync session, got \(error)")
                }
            }
            let (sync, session) = try engine(db)
            defer { session.invalidateAndCancel() }
            do { _ = try await sync.synchronize(); XCTFail("Closed sync was accepted") }
            catch LogbookDatabaseError.syncRunChanged {}
        }
    }

    func testLateRemoteAcknowledgementCannotWriteAfterDatabaseClose() async throws {
        try await withDatabase { db in
            // Use the actual verified wire baseline, including missing-field
            // defaults; a hand-built baseline can correctly become a conflict
            // and never exercise the outgoing PATCH/late-ack path.
            let (initial, initialSession) = try engine(db)
            _ = try await initial.synchronize(); initialSession.invalidateAndCancel()
            var value = try XCTUnwrap(db.fetchAll().first { $0.wavelogID == 1 })
            value.comment = "pending local edit"; try db.save(value)
            BoundedHistoryProtocol.setPatchHandler { db.close() }
            defer { BoundedHistoryProtocol.setPatchHandler(nil) }
            let (sync, session) = try engine(db); defer { session.invalidateAndCancel() }
            do { _ = try await sync.synchronize(); XCTFail("Late acknowledgement was accepted") }
            catch LogbookDatabaseError.syncRunChanged {}
            let reopened = try LogbookDatabase(url: db.url); defer { reopened.close() }
            let retained = try XCTUnwrap(reopened.lookup(localID: value.id))
            XCTAssertTrue(retained.isDirty); XCTAssertEqual(retained.comment, "pending local edit")
            XCTAssertEqual(try reopened.outboxCount(), 0)
        }
    }
}

private final class LockedEvents: @unchecked Sendable {
    private let lock = NSLock(); private var stored: [String] = []
    func append(_ event: String) { lock.lock(); stored.append(event); lock.unlock() }
    var values: [String] { lock.lock(); defer { lock.unlock() }; return stored }
}

/// Intercepts every URL. Only fixed generated GET responses are permitted;
/// unexpected methods/hosts fail locally and can never escape to a network.
private final class BoundedHistoryProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var patchHandler: (@Sendable () -> Void)?
    static func setPatchHandler(_ value: (@Sendable () -> Void)?) {
        lock.lock(); patchHandler = value; lock.unlock()
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.httpMethod == "PATCH", request.url?.host == "bounded.synthetic.invalid" {
            Self.lock.lock(); let handler = Self.patchHandler; Self.lock.unlock()
            guard let handler else {
                XCTFail("Unexpected synthetic PATCH"); client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
            }
            handler()
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try! JSONSerialization.data(withJSONObject: ["data": ["id": 1, "station_id": 1, "call": "SYN1",
                "band": "20m", "mode": "CW", "freq": 14_025_000, "comment": "pending local edit",
                "qso_date": "2023-11-14 22:13:20"]])
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self); return
        }
        guard request.httpMethod == "GET", request.url?.host == "bounded.synthetic.invalid" else {
            XCTFail("Synthetic reconciliation attempted an unexpected transport write")
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        if let path = request.url?.lastPathComponent, let id = Int(path) {
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            let item: [String: Any] = [
                "id": id, "station_id": 1, "call": "SYN\(id)", "band": "20m", "mode": "CW",
                "freq": 14_025_000, "qso_date": "2023-11-14 22:13:20", "comment": "remote",
            ]
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: ["data": item]))
            client?.urlProtocolDidFinishLoading(self); return
        }
        let adif = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
            .contains { $0.name == "format" && $0.value == "adif" } == true
        let meta: [String: Any] = ["page": 1, "per_page": 1000, "count": 400, "total": 400,
                                   "total_pages": 1, "has_more": false]
        let data: Any
        if adif {
            let records = (1...400).map { id in
                ADIFRecord(fields: ["CALL": "SYN\(id)", "QSO_DATE": "20231114", "TIME_ON": "221320",
                    "BAND": "20m", "MODE": "CW", "FREQ": "14.025000", "COMMENT": "remote"])
                    .adifDocument.components(separatedBy: "<EOH>").last!
            }.joined()
            data = ["exported": 400, "lastfetchedid": 400, "adif": "<EOH>" + records] as [String: Any]
        } else {
            data = (1...400).map { id in
                ["id": id, "station_id": 1, "call": "SYN\(id)", "band": "20m", "mode": "CW",
                 "freq": 14_025_000, "qso_date": "2023-11-14 22:13:20", "comment": "remote"] as [String: Any]
            }
        }
        let bytes = try! JSONSerialization.data(withJSONObject: ["data": data, "meta": meta])
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                      headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
