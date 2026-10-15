import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct LiveRemoteBackupRetentionTests {
    private struct Clock: RemoteBackupClock { func now() -> Date { Date(timeIntervalSince1970: 10_000) } }
    private final class Accounts: NativeDropboxBackupAccountRegistry, @unchecked Sendable {
        private let lock = NSRecursiveLock()
        private var value: NativeDropboxBackupRegistration?
        init(_ value: NativeDropboxBackupRegistration) { self.value = value }
        func remove() { lock.withLock { value = nil } }
        func withRegistration<T: Sendable>(workspaceGeneration: UUID, accountID: UUID, keychainService: String,
            _ body: (NativeDropboxBackupRegistration?) throws -> T) throws -> T { try lock.withLock { try body(value) } }
    }
    private struct Vault: NativeBackupCredentialVault {
        func read(service: String, account: String) throws -> String? { "fixture-token" }
    }
    private actor HTTP: DropboxBackupHTTPClient {
        let candidate: RemoteBackupUploadReceipt
        var requests: [URLRequest] = []
        init(_ candidate: RemoteBackupUploadReceipt) { self.candidate = candidate }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse {
            requests.append(request)
            if request.url == DropboxBackupTransport.accountURL {
                return DropboxBackupHTTPResponse(url: request.url!, statusCode: 200,
                    body: try JSONSerialization.data(withJSONObject: ["account_id": "dbid:fixture"]))
            }
            let object = try #require(candidate.remoteObject)
            return DropboxBackupHTTPResponse(url: request.url!, statusCode: 200,
                body: try JSONSerialization.data(withJSONObject: ["metadata": [
                    "id": object.objectID, "name": candidate.plan.objectName,
                    "rev": object.revision, "size": candidate.plan.package.byteCount]]))
        }
    }
    private actor RestoreHTTP: DropboxBackupHTTPClient {
        let receipt: RemoteBackupUploadReceipt
        let bytes: Data
        var requests: [URLRequest] = []
        init(_ receipt: RemoteBackupUploadReceipt, bytes: Data) { self.receipt = receipt; self.bytes = bytes }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse {
            requests.append(request)
            if request.url == DropboxBackupTransport.accountURL {
                return DropboxBackupHTTPResponse(url: request.url!, statusCode: 200,
                    body: try JSONSerialization.data(withJSONObject: ["account_id": "dbid:fixture"]))
            }
            let object = try #require(receipt.remoteObject)
            let metadata = try JSONSerialization.data(withJSONObject: ["id": object.objectID,
                "name": receipt.plan.objectName, "rev": object.revision,
                "size": receipt.plan.package.byteCount])
            return DropboxBackupHTTPResponse(url: request.url!, statusCode: 200,
                headers: ["Dropbox-API-Result": String(decoding: metadata, as: UTF8.self)], body: bytes)
        }
    }
    private struct Fixture {
        let logbook: LiveLogbookMethods
        let root: URL
        let workspace: IntegrationWorkspace
        let plan: RemoteBackupUploadPlan
        let service: LiveRemoteBackupService
        let accounts: Accounts
        let registration: NativeDropboxBackupRegistration
        init() throws {
            root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-retention-\(UUID().uuidString)")
            logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
            workspace = try IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL)
            plan = try RemoteBackupUploadPlan(workspaceGeneration: logbook.withCurrentWorkspaceGeneration { $0 },
                destination: RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox, accountID: UUID(),
                    location: .cloudFolder(id: "id:retention-fixture"), schedule: .every(hours: 1), retention: .keepLatestVerified(1)),
                backupID: UUID(), package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
            registration = try NativeDropboxBackupRegistration(revision: 1,
                binding: NativeDropboxBackupAccountBinding(workspaceGeneration: plan.workspaceGeneration,
                    destination: plan.destination, keychainService: workspace.keychainService, providerAccountID: "dbid:fixture"))
            accounts = Accounts(registration)
            service = LiveRemoteBackupService(logbook: logbook, clock: Clock(), accounts: accounts)
        }
        var backupDirectory: URL { workspace.directoryURL.appendingPathComponent("Remote Backup") }
        var operations: URL { backupDirectory.appendingPathComponent("Dropbox Operations").appendingPathComponent(plan.destination.id.uuidString.lowercased()) }
        var deletions: URL { backupDirectory.appendingPathComponent("Dropbox Deletions").appendingPathComponent(plan.destination.id.uuidString.lowercased()) }
        func approved() async throws -> (LiveRemoteBackupCommands, NativeRemoteBackupApproval) {
            let commands = await service.nativeCommands()
            return (commands, try await commands.approve(plan: plan, account: registration, expectedConfigurationRevision: 0))
        }
        func append(at date: Double, proof: Bool = true) throws -> RemoteBackupUploadReceipt {
            let id = UUID()
            let value = try RemoteBackupUploadPlan(workspaceGeneration: plan.workspaceGeneration, destination: plan.destination,
                backupID: id, package: plan.package)
            let receipt = try RemoteBackupUploadReceipt(plan: value,
                outcome: .verified(package: value.package, at: Date(timeIntervalSince1970: date)),
                remoteObject: proof ? RemoteBackupVerifiedObject(provider: .dropbox, providerAccountID: "dbid:fixture",
                    objectID: "id:" + id.uuidString.lowercased(), revision: "abcdef123456") : nil)
            let store = try RemoteBackupOperationStore(directory: operations)
            _ = try store.reserve(plan: value); try store.complete(receipt)
            return receipt
        }
        func clean() {
            try? logbook.openedDatabase().close()
            UserDefaults.standard.removePersistentDomain(forName: workspace.defaultsSuiteName)
            try? FileManager.default.removeItem(at: root)
        }
    }

    @Test func selectedCandidateUsesConditionalDeleteAndBecomesProtectedFromReplay() async throws {
        let f = try Fixture(); defer { f.clean() }
        let old = try f.append(at: 1), newest = try f.append(at: 2)
        let (commands, approval) = try await f.approved()
        let review = try await commands.reviewRetention(plan: f.plan, approval: approval)
        #expect(review.review.candidates == [old])
        let http = HTTP(old)
        let receipt = try await commands.deleteRetentionCandidate(old.plan.backupID, from: review,
            vault: Vault(), http: http)
        #expect(receipt.candidate == old)
        #expect(receipt.deletedAt == Date(timeIntervalSince1970: 10_000))
        let requests = await http.requests
        #expect(requests.map(\.url) == [DropboxBackupTransport.accountURL, DropboxBackupTransport.deleteURL])
        let body = try #require(requests.last?.httpBody)
        let arguments = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(arguments["path"] == old.remoteObject?.objectID)
        #expect(arguments["parent_rev"] == old.remoteObject?.revision)
        #expect(try RemoteBackupDeletionCoordinator.claimedBackupIDs(stateDirectory: f.deletions) == [old.plan.backupID])
        let refreshed = try await commands.reviewRetention(plan: f.plan, approval: approval)
        #expect(refreshed.review.candidates.isEmpty)
        #expect(refreshed.review.protected.contains { $0.receipt == old && $0.reason == .deletionClaimed })
        #expect(refreshed.review.protected.contains { $0.receipt == newest && $0.reason == .newestVerified })
        await #expect(throws: NativeRemoteBackupCommandError.staleRetentionReview) {
            try await commands.deleteRetentionCandidate(old.plan.backupID, from: review,
                vault: Vault(), http: http)
        }
        #expect(await http.requests.count == 2)
    }

    @Test func verifiedRevisionStagesIdempotentLocalPackageBeforeExplicitRestore() async throws {
        let f = try Fixture(); defer { f.clean() }
        try f.logbook.openedDatabase().save(QSO(call: "BEFORE", band: "20m", mode: "CW"))
        let created = try f.logbook.handle(method: "backup_create", params: ["name": "remote-source"])
        let localName = try #require(created["name"] as? String)
        let localPackage = f.workspace.directoryURL.appendingPathComponent("Backups").appendingPathComponent(localName)
        let envelope = try XLogBackupManager().prepareEnvelope(at: localPackage)
        let restorePlan = try RemoteBackupUploadPlan(workspaceGeneration: f.plan.workspaceGeneration,
            destination: f.plan.destination, backupID: UUID(), package: envelope.identity)
        let remote = try RemoteBackupVerifiedObject(provider: .dropbox, providerAccountID: "dbid:fixture",
            objectID: "id:restore-fixture", revision: "abcdef123456")
        let receipt = try RemoteBackupUploadReceipt(plan: restorePlan,
            outcome: .verified(package: restorePlan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: remote)
        let store = try RemoteBackupOperationStore(directory: f.operations)
        _ = try store.reserve(plan: restorePlan); try store.complete(receipt)
        let commands = await f.service.nativeCommands()
        let approval = try await commands.approve(plan: restorePlan, account: f.registration,
            expectedConfigurationRevision: 0)
        let http = RestoreHTTP(receipt, bytes: envelope.data)
        let staged = try await commands.stageVerifiedRestore(plan: restorePlan, approval: approval,
            vault: Vault(), http: http)
        #expect(staged.name == "Remote-\(restorePlan.backupID.uuidString.lowercased()).xlogbackup")
        #expect(staged.manifest.qsoCount == 1)
        #expect(try await commands.stageVerifiedRestore(plan: restorePlan, approval: approval,
            vault: Vault(), http: RestoreHTTP(receipt, bytes: envelope.data)) == staged)
        let inspected = try f.logbook.handle(method: "backup_inspect", params: ["name": staged.name])
        #expect((inspected["manifest"] as? [String: Any])?["qsoCount"] as? Int == 1)
        try f.logbook.openedDatabase().save(QSO(call: "AFTER", band: "20m", mode: "CW"))
        #expect(try f.logbook.openedDatabase().count() == 2)
        let restored = try f.logbook.handle(method: "backup_restore", params: ["name": staged.name,
            "confirm_restore": true, "restore_settings": false,
            "restore_preferences": false, "restore_reference_data": false])
        #expect(restored["restored"] as? Bool == true)
        #expect(try f.logbook.openedDatabase().count() == 1)
        let requests = await http.requests
        #expect(requests.map(\.url) == [DropboxBackupTransport.accountURL, DropboxBackupTransport.downloadURL])
    }

    @Test func explicitReviewUsesDurablePinnedHistoryAndNeverStartsOrCreatesAnExecutor() async throws {
        let f = try Fixture(); defer { f.clean() }
        let old = try f.append(at: 1), newest = try f.append(at: 2), legacy = try f.append(at: 99, proof: false)
        let (commands, approval) = try await f.approved()
        let review = try await commands.reviewRetention(plan: f.plan, approval: approval)
        #expect(review.review.candidates == [old])
        #expect(review.review.protected.contains { $0.receipt == newest && $0.reason == .newestVerified })
        #expect(review.review.protected.contains { $0.receipt == legacy && $0.reason == .missingRemoteIdentity })
        try await commands.validateRetentionReview(review)
        #expect(await f.service.isRunning == false)
        #expect(!FileManager.default.fileExists(atPath: f.backupDirectory.appendingPathComponent("Schedules").path))
        #expect(!FileManager.default.fileExists(atPath: f.backupDirectory.appendingPathComponent("Staging").path))
        #expect(try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: f.operations).count == 3)
    }

    @Test func emptyReviewDoesNotCreateHistoryAndNewReviewOrReceiptInvalidatesConfirmation() async throws {
        let f = try Fixture(); defer { f.clean() }
        let (commands, approval) = try await f.approved()
        let first = try await commands.reviewRetention(plan: f.plan, approval: approval)
        #expect(first.review.candidates.isEmpty)
        #expect(!FileManager.default.fileExists(atPath: f.operations.path))
        let second = try await commands.reviewRetention(plan: f.plan, approval: approval)
        await #expect(throws: NativeRemoteBackupCommandError.staleRetentionReview) { try await commands.validateRetentionReview(first) }
        _ = try f.append(at: 1)
        await #expect(throws: NativeRemoteBackupCommandError.staleRetentionReview) { try await commands.validateRetentionReview(second) }
        #expect(await f.service.isRunning == false)
    }

    @Test func stopAndTerminalShutdownInvalidateRetainedReview() async throws {
        let f = try Fixture(); defer { f.clean() }
        let (commands, approval) = try await f.approved()
        let stopped = try await commands.reviewRetention(plan: f.plan, approval: approval)
        try await f.service.stop()
        await #expect(throws: NativeRemoteBackupCommandError.staleRetentionReview) { try await commands.validateRetentionReview(stopped) }
        let terminal = try await commands.reviewRetention(plan: f.plan, approval: approval)
        let worker = LiveWorker(logbook: f.logbook, localAcceptance: true, remoteBackup: f.service)
        await worker.beginTerminalShutdown()
        await #expect(throws: CancellationError.self) { try await commands.validateRetentionReview(terminal) }
        await #expect(throws: CancellationError.self) { try await commands.reviewRetention(plan: f.plan, approval: approval) }
        await worker.shutdown()
    }

    @Test(arguments: [false, true])
    func registrationAndConsentRevocationRejectRetainedReview(revokeConsent: Bool) async throws {
        let f = try Fixture(); defer { f.clean() }
        let (commands, approval) = try await f.approved()
        let review = try await commands.reviewRetention(plan: f.plan, approval: approval)
        if revokeConsent {
            let authority = try await f.service.authorizationOwner()
            try await authority.revoke(expectedWorkspaceGeneration: f.plan.workspaceGeneration, expectedConfigurationRevision: 1)
            await #expect(throws: RemoteBackupAuthorizationError.notAuthorized) { try await commands.validateRetentionReview(review) }
        } else {
            f.accounts.remove()
            await #expect(throws: NativeRemoteBackupCommandError.accountUnavailable) { try await commands.validateRetentionReview(review) }
        }
        #expect(await f.service.isRunning == false)
    }

    @Test func workerRestoreCannotConfirmAPriorWorkspaceRetentionReview() async throws {
        let f = try Fixture(); defer { f.clean() }
        let backup = try f.logbook.handle(method: "backup_create", params: ["name": "retention-generation"])
        let name = try #require(backup["name"] as? String)
        _ = try f.append(at: 1); _ = try f.append(at: 2)
        let (commands, approval) = try await f.approved()
        let review = try await commands.reviewRetention(plan: f.plan, approval: approval)
        let worker = LiveWorker(logbook: f.logbook, localAcceptance: true, remoteBackup: f.service)
        let request = try JSONSerialization.data(withJSONObject: ["id": "restore-retention", "method": "backup_restore",
            "params": ["name": name, "confirm_restore": true, "restore_settings": false,
                       "restore_preferences": false, "restore_reference_data": false]])
        let result = try #require(JSONSerialization.jsonObject(with: await worker.response(to: request)) as? [String: Any])
        #expect(result["ok"] as? Bool == true)
        await #expect(throws: RemoteBackupPlanningError.staleContext) { try await commands.validateRetentionReview(review) }
        #expect(try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: f.operations).count == 2)
        await worker.shutdown()
    }

    @Test func corruptHistoryCannotBeReviewedOrTreatedAsDeletionEvidence() async throws {
        let f = try Fixture(); defer { f.clean() }
        let receipt = try f.append(at: 1)
        let (commands, approval) = try await f.approved()
        let url = f.operations.appendingPathComponent(receipt.plan.backupID.uuidString.lowercased() + ".json")
        try Data("{}".utf8).write(to: url); try LocalFilePermissions.protectFile(url)
        await #expect(throws: RemoteBackupPersistenceError.invalidState) { try await commands.reviewRetention(plan: f.plan, approval: approval) }
        #expect(await f.service.isRunning == false)
    }
}
