import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

final class LiveRemoteBackupPresentationTests: XCTestCase {
    private actor Probe {
        var prepares = 0, verifications = 0
        func prepared() { prepares += 1 }
        func verified() { verifications += 1 }
    }
    private struct Verifier: NativeDropboxBackupAccountVerifier {
        let probe: Probe
        var fail = false
        func verify(_ challenge: NativeDropboxBackupVerificationChallenge) async throws -> NativeDropboxBackupVerifiedAccount {
            await probe.verified()
            if fail { throw NativeDropboxBackupAccountError.verificationFailed }
            return NativeDropboxBackupVerifiedAccount(challenge: challenge, providerAccountID: challenge.binding.providerAccountID)
        }
    }
    private final class NoVault: NativeBackupCredentialVault, @unchecked Sendable {
        private let lock = NSLock(); private var reads = 0
        func read(service: String, account: String) throws -> String? {
            lock.withLock { reads += 1 }; throw CancellationError()
        }
        var count: Int { lock.withLock { reads } }
    }
    private actor NoHTTP: DropboxBackupHTTPClient {
        var calls = 0
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse {
            calls += 1; throw CancellationError()
        }
    }
    private actor IdleTicks: RemoteBackupTickSource {
        func nextTick() async throws -> Bool { try await Task.sleep(nanoseconds: 3_600_000_000_000); return false }
    }
    private struct Clock: RemoteBackupClock { func now() -> Date { Date(timeIntervalSince1970: 10_000) } }
    private struct Fixture {
        let root: URL, logbook: LiveLogbookMethods, service: LiveRemoteBackupService
        let owner: LiveRemoteBackupPresentation, environment: NativeRemoteBackupPresentationEnvironment
        let probe = Probe(), vault = NoVault(), http = NoHTTP()
        init(failVerification: Bool = false, available: Bool = true) throws {
            let createdRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-backup-ui-" + UUID().uuidString)
            let createdLogbook = LiveLogbookMethods(supportDirectory: createdRoot, inheritNativePreferences: false)
            root = createdRoot
            logbook = createdLogbook
            _ = try createdLogbook.handle(method: "workspace_create", params: ["mode": "empty"])
            let accounts = LiveDropboxBackupAccountOwner(logbook: createdLogbook, verifier: Verifier(probe: probe, fail: failVerification))
            let ticks = IdleTicks()
            let createdService = LiveRemoteBackupService(logbook: createdLogbook, clock: Clock(), accounts: accounts, ticks: { ticks })
            service = createdService
            let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
                accountID: UUID(), location: .cloudFolder(id: "id:fixture-folder"), schedule: .every(hours: 1))
            let probe = probe
            environment = NativeRemoteBackupPresentationEnvironment(prepare: { generation in
                await probe.prepared()
                let source = try RemoteBackupLocalSnapshotSource(workspace: createdLogbook,
                    stagingDirectory: createdRoot.appendingPathComponent("prepare-staging"))
                let envelope = try await source.capture(workspaceGeneration: generation, destination: destination)
                return NativeRemoteBackupOffer(plan: try RemoteBackupUploadPlan(workspaceGeneration: generation,
                    destination: destination, backupID: UUID(), package: envelope.identity),
                    envelope: envelope, providerAccountID: "dbid:fixture")
            }, vault: vault, http: http)
            owner = LiveRemoteBackupPresentation(logbook: createdLogbook, service: createdService, environment: available ? environment : nil)
        }
        func cleanup() {
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL) {
                workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            try? logbook.openedDatabase().close(); try? FileManager.default.removeItem(at: root)
        }
    }
    private func request(_ owner: LiveRemoteBackupPresentation, _ action: String) async throws -> [String: Any] {
        let state = try await owner.handle(["action": "snapshot"])
        return ["action": action, "operation_id": UUID().uuidString, "owner": state["owner"]!]
    }
    private func perform(_ owner: LiveRemoteBackupPresentation, _ action: String) async throws -> [String: Any] {
        try await owner.handle(request(owner, action))
    }
    func testProductionDefaultsArePassiveUnavailableAndDoNotCreateMetadata() async throws {
        let f = try Fixture(available: false); defer { f.cleanup() }
        let state = try await f.owner.handle(["action": "snapshot"])
        XCTAssertEqual(state["available"] as? Bool, false)
        XCTAssertEqual(state["retention_deletion_available"] as? Bool, false)
        XCTAssertNil(try f.logbook.openedDatabase().remoteBackupCommandJournal())
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.logbook.workspaceDirectoryURL.appendingPathComponent("Remote Backup").path))
        do { _ = try await perform(f.owner, "prepare"); XCTFail("Production preparation enabled") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "backup_unavailable") }
        let prepares = await f.probe.prepares; XCTAssertEqual(prepares, 0)
        XCTAssertEqual(f.vault.count, 0); let http = await f.http.calls; XCTAssertEqual(http, 0)
    }
    func testExplicitInjectedSetupApprovalStartStopRemainSeparateAndNeverUpload() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        for action in ["prepare", "verify_account", "approve"] {
            let receipt = try await perform(f.owner, action)
            XCTAssertEqual(receipt["status"] as? String, "acknowledged", action)
            let running = await f.service.isRunning; XCTAssertFalse(running)
        }
        var state = try await f.owner.handle(["action": "snapshot"])
        XCTAssertEqual(state["registered"] as? Bool, true); XCTAssertEqual(state["approved"] as? Bool, true)
        let review = try await perform(f.owner, "review_retention")
        XCTAssertEqual(review["status"] as? String, "acknowledged")
        state = try await f.owner.handle(["action": "snapshot"])
        XCTAssertEqual((state["retention_review"] as? [String: Int])?["candidates"], 0)
        let start = try await perform(f.owner, "start"); XCTAssertEqual(start["status"] as? String, "acknowledged")
        state = try await f.owner.handle(["action": "snapshot"]); XCTAssertEqual(state["running"] as? Bool, true)
        let stop = try await perform(f.owner, "stop"); XCTAssertEqual(stop["status"] as? String, "acknowledged")
        state = try await f.owner.handle(["action": "snapshot"]); XCTAssertNil(state["retention_review"])
        let running = await f.service.isRunning; XCTAssertFalse(running)
        XCTAssertEqual(f.vault.count, 0); let http = await f.http.calls; XCTAssertEqual(http, 0)
        await f.service.terminate()
    }
    func testLostReplyReopenReadsExactReceiptWithoutReplayingOrRestoringApproval() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let intent = try await request(f.owner, "prepare")
        let first = try await f.owner.handle(intent)
        let repeated = try await f.owner.handle(intent)
        XCTAssertTrue(NSDictionary(dictionary: first).isEqual(to: repeated))
        let prepares = await f.probe.prepares; XCTAssertEqual(prepares, 1)
        let reopened = LiveRemoteBackupPresentation(logbook: f.logbook, service: f.service, environment: f.environment)
        let owner = intent["owner"] as! [String: Any]
        let recovered = try await reopened.handle(["action": "receipt", "generation": owner["generation"]!, "operation_id": intent["operation_id"]!])
        XCTAssertTrue(NSDictionary(dictionary: first).isEqual(to: recovered["receipt"] as! [String: Any]))
        let snapshot = try await reopened.handle(["action": "snapshot"])
        XCTAssertEqual(snapshot["prepared"] as? Bool, false); XCTAssertEqual(snapshot["approved"] as? Bool, false)
    }
    func testUnknownVerificationCannotReplayOrBeMistakenForRegistration() async throws {
        let f = try Fixture(failVerification: true); defer { f.cleanup() }
        _ = try await perform(f.owner, "prepare")
        let intent = try await request(f.owner, "verify_account")
        let first = try await f.owner.handle(intent), second = try await f.owner.handle(intent)
        XCTAssertEqual(first["status"] as? String, "unknown"); XCTAssertEqual(second["status"] as? String, "unknown")
        let verifications = await f.probe.verifications; XCTAssertEqual(verifications, 1)
        let snapshot = try await f.owner.handle(["action": "snapshot"])
        XCTAssertEqual(snapshot["registered"] as? Bool, false)
        XCTAssertEqual(f.vault.count, 0); let http = await f.http.calls; XCTAssertEqual(http, 0)
    }
    func testStaleRevisionWorkspaceAndRendererProofsAreRejected() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let stale = try await request(f.owner, "prepare")
        _ = try await f.owner.handle(stale)
        var other = stale; other["operation_id"] = UUID().uuidString
        do { _ = try await f.owner.handle(other); XCTFail("Stale revision admitted") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "backup_context_changed") }
        var forged = try await request(f.owner, "verify_account"); forged["providerAccountID"] = "dbid:forged"
        do { _ = try await f.owner.handle(forged); XCTFail("Renderer proof admitted") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "backup_invalid_request") }
        let old = try await request(f.owner, "verify_account")
        try JSONEncoder().encode(UUID()).write(to: f.logbook.workspaceDirectoryURL.appendingPathComponent("edit-generation.json"), options: .atomic)
        do { _ = try await f.owner.handle(old); XCTFail("Restored workspace admitted") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "backup_context_changed") }
        let snapshot = try await f.owner.handle(["action": "snapshot"])
        XCTAssertEqual(snapshot["prepared"] as? Bool, false)
        let verifications = await f.probe.verifications; XCTAssertEqual(verifications, 0)
    }
    func testDeletionHasNoIPCAndShutdownBlocksEvenPreparation() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        do { _ = try await perform(f.owner, "delete"); XCTFail("Deletion exposed") }
        catch let error as WorkerFailure { XCTAssertEqual(error.code, "backup_invalid_request") }
        let worker = LiveWorker(logbook: f.logbook, remoteBackup: f.service, remoteBackupEnvironment: f.environment)
        await worker.shutdown()
        let input = try JSONSerialization.data(withJSONObject: ["id": "after-stop", "method": "remote_backup_request", "params": ["action": "snapshot"]])
        let output = await worker.response(to: input)
        let result = try JSONSerialization.jsonObject(with: output) as! [String: Any]
        XCTAssertEqual((result["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
    }
}
