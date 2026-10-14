import Foundation
import XCTest
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

final class SyncMutationOwnerTests: XCTestCase {
    private func fixture() throws -> (URL, LiveLogbookMethods, LiveServiceMethods) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sync-owner-" + UUID().uuidString)
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        return (root, logbook, LiveServiceMethods(logbook: logbook, operation: { _, _ in SyncReport() }))
    }
    private func intent(_ service: LiveServiceMethods, method: String = "sync_configure",
                        payload: [String: Any] = ["enabled": false, "interval_minutes": 5, "confirm_single_writer": false]) async throws -> [String: Any] {
        let state = try await service.handle(method: "sync_status", params: [:])
        return ["operation_id": UUID().uuidString, "owner": try XCTUnwrap(state["mutation_owner"]), "method": method, "params": payload]
    }
    func testPassiveReadsDoNotSeedJournalAndRawWorkerMutationsAreDenied() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        _ = try await service.handle(method: "sync_status", params: [:])
        _ = try await service.handle(method: "sync_summary", params: [:])
        XCTAssertNil(try logbook.openedDatabase().syncMutationJournal())
        let worker = LiveWorker(logbook: logbook)
        for method in ["sync_run", "sync_configure", "sync_retry", "sync_resolve"] {
            let request = try JSONSerialization.data(withJSONObject: ["id": "raw", "method": method, "params": [:]])
            let data = await worker.response(to: request)
            let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual((result["error"] as? [String: Any])?["code"] as? String, "sync_owner_required")
        }
    }
    func testExactReceiptSurvivesReopenAndOperationReuseNeverDispatches() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let request = try await intent(service)
        let first = try await service.handle(method: "sync_mutation", params: request)
        XCTAssertEqual(first["status"] as? String, "acknowledged")
        let reopened = LiveServiceMethods(logbook: logbook)
        let repeatReceipt = try await reopened.handle(method: "sync_mutation", params: request)
        XCTAssertTrue(NSDictionary(dictionary: first).isEqual(to: repeatReceipt))
        let owner = request["owner"] as! [String: Any]
        let recovered = try await reopened.handle(method: "sync_receipt", params: ["generation": owner["generation"]!, "operation_id": request["operation_id"]!])
        XCTAssertTrue(NSDictionary(dictionary: first).isEqual(to: recovered["receipt"] as! [String: Any]))
        var reused = request; reused["params"] = ["enabled": false, "interval_minutes": 6, "confirm_single_writer": false]
        do { _ = try await reopened.handle(method: "sync_mutation", params: reused); XCTFail("Reused operation identity") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_operation_reused") }
        let current = try await reopened.handle(method: "sync_status", params: [:])["mutation_owner"] as! [String: Any]
        XCTAssertEqual(current["revision"] as? Int, 1)
    }
    func testTwoViewsAtTheSameRevisionCannotBothDispatch() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let first = try await intent(service)
        var other = first; other["operation_id"] = UUID().uuidString
        _ = try await service.handle(method: "sync_mutation", params: first)
        do { _ = try await service.handle(method: "sync_mutation", params: other); XCTFail("Stale second view admitted") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_changed") }
        let journal = try XCTUnwrap(logbook.openedDatabase().syncMutationJournal())
        XCTAssertEqual(((try JSONSerialization.jsonObject(with: journal) as! [String: Any])["receipts"] as! [Any]).count, 1)
    }
    func testRetryAndReviewedConflictMergeUseTheSameReceiptOwner() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let db = try logbook.openedDatabase()
        let local = QSO(wavelogID: 42, call: "OM0RX", start: Date(timeIntervalSince1970: 1_790_000_000), band: "20m", mode: "CW", frequencyHz: 14_025_000, comment: "local")
        try db.save(local)
        let retry = try await intent(service, method: "sync_retry", payload: ["id": local.id.uuidString])
        let retryReceipt = try await service.handle(method: "sync_mutation", params: retry)
        XCTAssertEqual(retryReceipt["status"] as? String, "acknowledged")
        var remote = local; remote.id = UUID(); remote.isDirty = false; remote.comment = "remote"
        _ = try db.mergeRemote(remote)
        let status = try await service.handle(method: "sync_status", params: [:])
        let conflict = try XCTUnwrap((status["conflicts"] as? [[String: Any]])?.first)
        let merge = try await intent(service, method: "sync_resolve", payload: ["id": conflict["id"]!, "remote_fields": ["comment"], "expected_revision": conflict["revision"]!])
        let receipt = try await service.handle(method: "sync_mutation", params: merge)
        XCTAssertEqual(receipt["status"] as? String, "acknowledged")
        XCTAssertEqual(try db.lookup(localID: local.id)?.comment, "remote")
        XCTAssertTrue(try db.conflicts().isEmpty)
        let repeated = try await service.handle(method: "sync_mutation", params: merge)
        XCTAssertEqual(repeated["status"] as? String, "acknowledged")
        let current = try await service.handle(method: "sync_status", params: [:])["mutation_owner"] as! [String: Any]
        XCTAssertEqual(current["revision"] as? Int, 2)
    }
    func testSettingsAndContactChangesFenceReviewedIntent() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let contactIntent = try await intent(service)
        try logbook.openedDatabase().save(QSO(call: "OM0RX", start: Date(), band: "20m", mode: "CW", frequencyHz: 14_025_000))
        do { _ = try await service.handle(method: "sync_mutation", params: contactIntent); XCTFail("Stale contacts admitted") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_changed") }
        let settingsIntent = try await intent(service)
        var settings = try XCTUnwrap(logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        settings["stationCall"] = "VK8TEST"
        _ = try logbook.saveSettingsForTest(settings)
        do { _ = try await service.handle(method: "sync_mutation", params: settingsIntent); XCTFail("Stale destination/settings admitted") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_changed") }
        XCTAssertNil(try logbook.openedDatabase().syncMutationJournal())
    }
    func testGenerationMismatchCannotDispatchOrRecoverForeignReceipts() async throws {
        let (root, _, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        var request = try await intent(service)
        var owner = request["owner"] as! [String: Any]; owner["generation"] = UUID().uuidString; request["owner"] = owner
        do { _ = try await service.handle(method: "sync_mutation", params: request); XCTFail("Foreign workspace admitted") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "workspace_changed") }
        do { _ = try await service.handle(method: "sync_receipt", params: ["generation": owner["generation"]!, "operation_id": request["operation_id"]!]); XCTFail("Foreign receipt read") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "workspace_changed") }
    }
    func testRestoreRetiresPriorGenerationReceiptsEvenWhenRevisionRepeats() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let request = try await intent(service)
        _ = try await service.handle(method: "sync_mutation", params: request)
        let backup = try logbook.handle(method: "backup_create", params: ["name": "sync-owner-fixture"])
        let name = try XCTUnwrap(backup["name"] as? String)
        _ = try logbook.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true])
        do { _ = try await service.handle(method: "sync_mutation", params: request); XCTFail("Restored workspace accepted old operation") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "workspace_changed") }
        let current = try await service.handle(method: "sync_status", params: [:])["mutation_owner"] as! [String: Any]
        XCTAssertNotEqual(current["generation"] as? String, (request["owner"] as! [String: Any])["generation"] as? String)
        XCTAssertEqual(current["revision"] as? Int, 0)
    }
    func testCrashAdmissionAndFailedDispatchStayUnknownAndNeverReplay() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let request = try await intent(service, method: "sync_run", payload: ["confirm_single_writer": true])
        // Local mode rejects transport. Admission is still durable and cannot be
        // mistaken for permission to retry with the original operation identity.
        let failed = try await service.handle(method: "sync_mutation", params: request)
        XCTAssertEqual(failed["status"] as? String, "unknown")
        let db = try logbook.openedDatabase()
        var journal = try JSONSerialization.jsonObject(with: XCTUnwrap(db.syncMutationJournal())) as! [String: Any]
        var receipts = journal["receipts"] as! [[String: Any]]; receipts[0]["status"] = "pending"; journal["receipts"] = receipts
        try db.saveSyncMutationJournal(JSONSerialization.data(withJSONObject: journal))
        let reopened = LiveServiceMethods(logbook: logbook)
        let receipt = try await reopened.handle(method: "sync_mutation", params: request)
        XCTAssertEqual(receipt["status"] as? String, "unknown")
        let status = try await reopened.handle(method: "sync_status", params: [:])
        XCTAssertEqual(status["running"] as? Bool, false)
        XCTAssertEqual((status["mutation_owner"] as? [String: Any])?["revision"] as? Int, 1)
    }
    func testMalformedIntentAndCorruptJournalFailBeforeDispatch() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        var request = try await intent(service)
        request["params"] = ["enabled": false, "interval_minutes": 5, "confirm_single_writer": false, "secret": "must not be retained"]
        do { _ = try await service.handle(method: "sync_mutation", params: request); XCTFail("Extra intent retained") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "invalid_params") }
        XCTAssertNil(try logbook.openedDatabase().syncMutationJournal())
        try logbook.openedDatabase().saveSyncMutationJournal(Data("{}".utf8))
        do { _ = try await service.handle(method: "sync_status", params: [:]); XCTFail("Corruption silently reset") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_journal_invalid") }
    }

    func testAcknowledgedJournalHistoryRollsOverWithoutBlockingNewMutations() async throws {
        let (root, logbook, service) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let status = try await service.handle(method: "sync_status", params: [:])
        let owner = status["mutation_owner"] as! [String: Any]
        let generation = owner["generation"] as! String
        let receipts: [[String: Any]] = (0..<1024).map { index in
            ["operation_id": UUID().uuidString, "request": ["historical": index], "status": "acknowledged"]
        }
        let journal: [String: Any] = ["generation": generation, "revision": 1024, "receipts": receipts]
        try logbook.openedDatabase().saveSyncMutationJournal(
            JSONSerialization.data(withJSONObject: journal, options: [.sortedKeys])
        )
        let request = try await intent(service)
        let receipt = try await service.handle(method: "sync_mutation", params: request)
        XCTAssertEqual(receipt["status"] as? String, "acknowledged")
        let saved = try XCTUnwrap(logbook.openedDatabase().syncMutationJournal())
        let savedJournal = try JSONSerialization.jsonObject(with: saved) as! [String: Any]
        XCTAssertEqual((savedJournal["receipts"] as! [Any]).count, 512)
    }
}
