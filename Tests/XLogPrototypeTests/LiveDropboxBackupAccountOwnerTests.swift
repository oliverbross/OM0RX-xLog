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

@Suite struct LiveDropboxBackupAccountOwnerTests {
    private struct Fixture {
        let logbook: LiveLogbookMethods
        let root: URL
        let workspace: IntegrationWorkspace
        let plan: RemoteBackupUploadPlan
        init() throws {
            root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-backup-registration-\(UUID().uuidString)")
            logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
            workspace = try IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL)
            plan = try RemoteBackupUploadPlan(workspaceGeneration: logbook.withCurrentWorkspaceGeneration { $0 },
                destination: RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox, accountID: UUID(),
                    location: .cloudFolder(id: "id:registration-fixture"), schedule: .every(hours: 1)),
                backupID: UUID(), package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
        }
        var backupDirectory: URL { workspace.directoryURL.appendingPathComponent("Remote Backup") }
        var accountDirectory: URL { backupDirectory.appendingPathComponent("Accounts") }
        func clean() {
            try? logbook.openedDatabase().close()
            UserDefaults.standard.removePersistentDomain(forName: workspace.defaultsSuiteName)
            try? FileManager.default.removeItem(at: root)
        }
    }

    private actor Verifier: NativeDropboxBackupAccountVerifier {
        enum Mode { case verified, wrongAccount, wrongChallenge, failure }
        let mode: Mode
        var challenges: [NativeDropboxBackupVerificationChallenge] = []
        init(_ mode: Mode = .verified) { self.mode = mode }
        func verify(_ challenge: NativeDropboxBackupVerificationChallenge) async throws -> NativeDropboxBackupVerifiedAccount {
            challenges.append(challenge)
            switch mode {
            case .verified: return NativeDropboxBackupVerifiedAccount(challenge: challenge, providerAccountID: challenge.binding.providerAccountID)
            case .wrongAccount: return NativeDropboxBackupVerifiedAccount(challenge: challenge, providerAccountID: "dbid:wrong")
            case .wrongChallenge:
                return NativeDropboxBackupVerifiedAccount(challenge: NativeDropboxBackupVerificationChallenge(id: UUID(),
                    binding: challenge.binding, expectedRegistrationRevision: challenge.expectedRegistrationRevision),
                    providerAccountID: challenge.binding.providerAccountID)
            case .failure: throw NSError(domain: "untrusted-verification-detail", code: 7)
            }
        }
    }

    /// Deliberately ignores cancellation to prove late replies cannot commit.
    private actor DeferredVerifier: NativeDropboxBackupAccountVerifier {
        private var pending: [(NativeDropboxBackupVerificationChallenge, CheckedContinuation<NativeDropboxBackupVerifiedAccount, Never>)] = []
        private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []
        func verify(_ challenge: NativeDropboxBackupVerificationChallenge) async throws -> NativeDropboxBackupVerifiedAccount {
            await withCheckedContinuation { continuation in
                pending.append((challenge, continuation))
                let ready = waiters.filter { pending.count >= $0.0 }
                waiters.removeAll { pending.count >= $0.0 }
                ready.forEach { $0.1.resume() }
            }
        }
        func wait(for count: Int = 1) async {
            if pending.count >= count { return }
            await withCheckedContinuation { waiters.append((count, $0)) }
        }
        func complete() {
            let replies = pending; pending = []
            for (challenge, continuation) in replies {
                continuation.resume(returning: NativeDropboxBackupVerifiedAccount(challenge: challenge,
                    providerAccountID: challenge.binding.providerAccountID))
            }
        }
    }

    private final class Vault: NativeBackupCredentialVault, @unchecked Sendable {
        struct Read: Equatable { let service: String; let account: String }
        private let lock = NSLock()
        private let value: String?
        private var reads: [Read] = []
        init(_ value: String?) { self.value = value }
        func read(service: String, account: String) throws -> String? {
            lock.withLock { reads.append(Read(service: service, account: account)) }
            return value
        }
        var recorded: [Read] { lock.withLock { reads } }
    }

    private actor HTTP: DropboxBackupHTTPClient {
        let accountID: String
        var requests: [URLRequest] = []
        init(accountID: String) { self.accountID = accountID }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse {
            requests.append(request)
            return DropboxBackupHTTPResponse(url: request.url!, statusCode: 200,
                body: try JSONSerialization.data(withJSONObject: ["account_id": accountID]))
        }
    }

    @Test func systemProvisioningVaultRejectsInvalidInputsBeforeSecureStoreAccess() throws {
        let vault = SystemNativeBackupCredentialVault()
        let service = "com.oliverbross.OM0RXXLog.Integration.fixture"
        let account = "dropbox-backup-v1-" + String(repeating: "a", count: 64)

        #expect(throws: DropboxBackupError.accountMismatch) {
            try vault.save("fixture-token", service: "invalid-service", account: account)
        }
        #expect(throws: DropboxBackupError.accountMismatch) {
            try vault.remove(service: service, account: "dropbox-backup-v1-not-a-hash")
        }
        #expect(throws: DropboxBackupError.invalidCredential) {
            try vault.save("", service: service, account: account)
        }
        #expect(throws: DropboxBackupError.invalidCredential) {
            try vault.save("contains space", service: service, account: account)
        }
        #expect(throws: DropboxBackupError.invalidCredential) {
            try vault.save(String(repeating: "x", count: 8_193), service: service, account: account)
        }
    }

    @Test func nativeVerifierReadsOnlyTheExactVaultIdentityAndAuthenticatesObservedAccount() async throws {
        let f = try Fixture(); defer { f.clean() }
        let binding = try NativeDropboxBackupAccountBinding(workspaceGeneration: f.plan.workspaceGeneration,
            destination: f.plan.destination, keychainService: f.workspace.keychainService,
            providerAccountID: "dbid:fixture")
        let challenge = NativeDropboxBackupVerificationChallenge(id: UUID(), binding: binding,
            expectedRegistrationRevision: 0)
        let vault = Vault("fixture-only-access-value"), http = HTTP(accountID: "dbid:fixture")
        let verified = try await LiveDropboxBackupAccountVerifier(vault: vault, http: http).verify(challenge)
        #expect(verified.challenge == challenge)
        #expect(verified.providerAccountID == "dbid:fixture")
        #expect(vault.recorded == [Vault.Read(service: binding.keychainService, account: binding.vaultAccount)])
        let requests = await http.requests
        #expect(requests.count == 1)
        #expect(requests[0].url == DropboxBackupTransport.accountURL)
        #expect(requests[0].httpMethod == "POST")
        #expect(requests[0].httpBody == Data("null".utf8))
        #expect(requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer fixture-only-access-value")
    }

    @Test func nativeVerifierRejectsMissingOrDifferentAccountBeforeRegistration() async throws {
        let f = try Fixture(); defer { f.clean() }
        let binding = try NativeDropboxBackupAccountBinding(workspaceGeneration: f.plan.workspaceGeneration,
            destination: f.plan.destination, keychainService: f.workspace.keychainService,
            providerAccountID: "dbid:fixture")
        let challenge = NativeDropboxBackupVerificationChallenge(id: UUID(), binding: binding,
            expectedRegistrationRevision: 0)
        let unusedHTTP = HTTP(accountID: "dbid:fixture")
        await #expect(throws: DropboxBackupError.credentialUnavailable) {
            try await LiveDropboxBackupAccountVerifier(vault: Vault(nil), http: unusedHTTP).verify(challenge)
        }
        #expect(await unusedHTTP.requests.isEmpty)
        await #expect(throws: DropboxBackupError.accountMismatch) {
            try await LiveDropboxBackupAccountVerifier(vault: Vault("fixture-only-access-value"),
                http: HTTP(accountID: "dbid:different")).verify(challenge)
        }
    }

    @Test func defaultOwnerIsInertAndCannotInventRegistration() async throws {
        let f = try Fixture(); defer { f.clean() }
        let service = LiveRemoteBackupService(logbook: f.logbook)
        let state = try await service.accountRegistrationState()
        #expect(state.workspaceGeneration == f.plan.workspaceGeneration)
        #expect(state.revision == 0 && state.registration == nil)
        let commands = await service.nativeCommands()
        #expect(try await commands.availableAccount(for: f.plan) == nil)
        await #expect(throws: NativeDropboxBackupAccountError.verificationUnavailable) {
            try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        }
        #expect(await service.isRunning == false)
        #expect(!FileManager.default.fileExists(atPath: f.backupDirectory.path))
    }

    @Test func verifiedRegistrationSurvivesRestartWithoutGrantingConsentOrStarting() async throws {
        let f = try Fixture(); defer { f.clean() }
        let verifier = Verifier(), owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: verifier)
        let service = LiveRemoteBackupService(logbook: f.logbook, accounts: owner)
        let registration = try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        #expect(registration.revision == 1)
        #expect(registration.binding.destination == f.plan.destination)
        #expect(registration.binding.workspaceGeneration == f.plan.workspaceGeneration)
        #expect(registration.binding.keychainService == f.workspace.keychainService)
        let challenges = await verifier.challenges
        #expect(challenges.count == 1)
        #expect(challenges.first?.binding == registration.binding)
        #expect(challenges.first?.expectedRegistrationRevision == 0)
        let restarted = LiveRemoteBackupService(logbook: f.logbook)
        #expect(try await restarted.accountRegistrationState().registration == registration)
        let commands = await restarted.nativeCommands()
        #expect(try await commands.availableAccount(for: f.plan) == registration)
        #expect(await service.isRunning == false)
        #expect(await restarted.isRunning == false)
        #expect(!FileManager.default.fileExists(atPath: f.backupDirectory.appendingPathComponent("Authorization").path))
        #expect(!FileManager.default.fileExists(atPath: f.backupDirectory.appendingPathComponent("Schedules").path))
        #expect(try FileManager.default.contentsOfDirectory(atPath: f.accountDirectory.path) == ["account.json"])
    }

    @Test func replacementAndRemovalAreRevisionFencedAndInvalidateOldApprovals() async throws {
        let f = try Fixture(); defer { f.clean() }
        let verifier = Verifier(), owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: verifier)
        let service = LiveRemoteBackupService(logbook: f.logbook, accounts: owner)
        let first = try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        let commands = await service.nativeCommands()
        let approval = try await commands.approve(plan: f.plan, account: first, expectedConfigurationRevision: 0)
        let second = try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 1)
        #expect(second.id != first.id && second.revision == 2)
        await #expect(throws: NativeRemoteBackupCommandError.accountUnavailable) {
            try await commands.start(plan: f.plan, approval: approval)
        }
        await #expect(throws: NativeDropboxBackupAccountError.staleRevision) {
            try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 1)
        }
        await #expect(throws: NativeDropboxBackupAccountError.staleRevision) {
            try await service.removeDropboxAccount(expectedWorkspaceGeneration: f.plan.workspaceGeneration, expectedRevision: 1)
        }
        try await service.removeDropboxAccount(expectedWorkspaceGeneration: f.plan.workspaceGeneration, expectedRevision: 2)
        let state = try LiveDropboxBackupAccountOwner(logbook: f.logbook).state()
        #expect(state.revision == 3 && state.registration == nil)
        #expect(try await commands.availableAccount(for: f.plan) == nil)
        #expect(await verifier.challenges.count == 2)
        #expect(await service.isRunning == false)
    }

    @Test func mismatchedAndUntrustedVerifierRepliesFailClosed() async throws {
        for mode in [Verifier.Mode.wrongAccount, .wrongChallenge, .failure] {
            let f = try Fixture(); defer { f.clean() }
            let owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: Verifier(mode))
            await #expect(throws: NativeDropboxBackupAccountError.verificationFailed) {
                try await owner.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
            }
            #expect(try owner.state().registration == nil)
            #expect(!FileManager.default.fileExists(atPath: f.accountDirectory.appendingPathComponent("account.json").path))
        }
    }

    @Test func independentOwnersCannotCommitTheSameRegistrationRevision() async throws {
        let f = try Fixture(); defer { f.clean() }
        let verifier = DeferredVerifier()
        let first = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: verifier)
        let second = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: verifier)
        let left = Task { try await first.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0) }
        let right = Task { try await second.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0) }
        await verifier.wait(for: 2); await verifier.complete()
        let results = await [left.result, right.result]
        #expect(results.filter { if case .success = $0 { return true }; return false }.count == 1)
        #expect(results.filter { if case .failure(let error) = $0 { return error as? NativeDropboxBackupAccountError == .staleRevision }; return false }.count == 1)
        #expect(try first.state().revision == 1)
    }

    @Test func cancellationRejectsALateVerifierReplyWithoutMetadata() async throws {
        let f = try Fixture(); defer { f.clean() }
        let verifier = DeferredVerifier(), owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: verifier)
        let task = Task { try await owner.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0) }
        await verifier.wait(); task.cancel(); await verifier.complete()
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(try owner.state().registration == nil)
        #expect(!FileManager.default.fileExists(atPath: f.accountDirectory.appendingPathComponent("account.json").path))
    }

    @Test func terminalWorkerShutdownCancelsPendingVerificationAndRejectsRestart() async throws {
        let f = try Fixture(); defer { f.clean() }
        let verifier = DeferredVerifier(), owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: verifier)
        let service = LiveRemoteBackupService(logbook: f.logbook, accounts: owner)
        let worker = LiveWorker(logbook: f.logbook, localAcceptance: true, remoteBackup: service)
        let task = Task { try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0) }
        await verifier.wait(); await worker.beginTerminalShutdown(); await verifier.complete()
        await #expect(throws: CancellationError.self) { try await task.value }
        await #expect(throws: CancellationError.self) {
            try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        }
        #expect(try owner.state().registration == nil)
        #expect(await service.isRunning == false)
        await worker.shutdown()
    }

    @Test func workerRestoreCancelsVerificationAndRotatesDurableRegistrationAuthority() async throws {
        let f = try Fixture(); defer { f.clean() }
        let backup = try f.logbook.handle(method: "backup_create", params: ["name": "registration-generation"])
        let name = try #require(backup["name"] as? String)
        let verifier = DeferredVerifier(), owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: verifier)
        let service = LiveRemoteBackupService(logbook: f.logbook, accounts: owner)
        let worker = LiveWorker(logbook: f.logbook, localAcceptance: true, remoteBackup: service)
        let task = Task { try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0) }
        await verifier.wait()
        let request = try JSONSerialization.data(withJSONObject: ["id": "restore-registration", "method": "backup_restore",
            "params": ["name": name, "confirm_restore": true, "restore_settings": false,
                       "restore_preferences": false, "restore_reference_data": false]])
        let response = await worker.response(to: request)
        let result = try #require(JSONSerialization.jsonObject(with: response) as? [String: Any])
        #expect(result["ok"] as? Bool == true)
        await verifier.complete()
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(try owner.state().workspaceGeneration != f.plan.workspaceGeneration)
        #expect(try owner.state().registration == nil)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await service.registerDropboxAccount(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        }
        await worker.shutdown()
    }

    @Test func corruptMetadataAndAbandonedMutationLockFailClosed() async throws {
        let f = try Fixture(); defer { f.clean() }
        let owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: Verifier())
        _ = try await owner.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        let marker = f.accountDirectory.appendingPathComponent("account.lock")
        try Data().write(to: marker); try LocalFilePermissions.protectFile(marker)
        #expect(throws: RemoteBackupSchedulerError.operationInProgress) { try owner.state() }
        try FileManager.default.removeItem(at: marker)
        let record = f.accountDirectory.appendingPathComponent("account.json")
        try Data("{}".utf8).write(to: record); try LocalFilePermissions.protectFile(record)
        #expect(throws: RemoteBackupPersistenceError.invalidState) { try owner.state() }
    }

    @Test func durableRegistryRejectsWrongWorkspaceAccountServiceAndDestinationRevision() async throws {
        let f = try Fixture(); defer { f.clean() }
        let owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: Verifier())
        let registration = try await owner.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        #expect(try owner.withRegistration(workspaceGeneration: UUID(), accountID: f.plan.destination.accountID,
            keychainService: f.workspace.keychainService) { $0 } == nil)
        #expect(try owner.withRegistration(workspaceGeneration: f.plan.workspaceGeneration, accountID: UUID(),
            keychainService: f.workspace.keychainService) { $0 } == nil)
        #expect(try owner.withRegistration(workspaceGeneration: f.plan.workspaceGeneration, accountID: f.plan.destination.accountID,
            keychainService: f.workspace.keychainService + "-wrong") { $0 } == nil)
        let original = f.plan.destination
        let destination = try RemoteBackupDestination(id: original.id, revision: original.revision + 1,
            provider: original.provider, accountID: original.accountID, location: original.location, schedule: original.schedule)
        let changed = try RemoteBackupUploadPlan(workspaceGeneration: f.plan.workspaceGeneration, destination: destination,
            backupID: f.plan.backupID, package: f.plan.package)
        let service = LiveRemoteBackupService(logbook: f.logbook, accounts: owner), commands = await service.nativeCommands()
        #expect(try await commands.availableAccount(for: changed) == nil)
        #expect(try owner.state().registration == registration)
    }

    @Test func restoreNeverRebindsPersistedRegistrationToTheNewGeneration() async throws {
        let f = try Fixture(); defer { f.clean() }
        let owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: Verifier())
        _ = try await owner.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        let backup = try f.logbook.handle(method: "backup_create", params: ["name": "registered-generation"])
        let name = try #require(backup["name"] as? String)
        _ = try f.logbook.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
            "restore_settings": false, "restore_preferences": false, "restore_reference_data": false])
        let state = try owner.state()
        #expect(state.workspaceGeneration != f.plan.workspaceGeneration)
        #expect(state.registration == nil && state.revision == 1)
        let current = try RemoteBackupUploadPlan(workspaceGeneration: state.workspaceGeneration,
            destination: f.plan.destination, backupID: UUID(), package: f.plan.package)
        await #expect(throws: NativeDropboxBackupAccountError.staleRevision) {
            try await owner.register(plan: current, providerAccountID: "dbid:fixture", expectedRevision: 0)
        }
        let registration = try await owner.register(plan: current, providerAccountID: "dbid:fixture", expectedRevision: 1)
        #expect(registration.revision == 2 && registration.binding.workspaceGeneration == state.workspaceGeneration)
    }

    @Test(arguments: ["oversized", "symlink", "publicPermissions"])
    func unsafeRegistrationFilesFailClosed(kind: String) async throws {
        #if os(Windows)
        if kind != "oversized" { return }
        #endif
        let f = try Fixture(); defer { f.clean() }
        let owner = LiveDropboxBackupAccountOwner(logbook: f.logbook, verifier: Verifier())
        _ = try await owner.register(plan: f.plan, providerAccountID: "dbid:fixture", expectedRevision: 0)
        let record = f.accountDirectory.appendingPathComponent("account.json")
        if kind == "oversized" {
            try Data(repeating: 32, count: 32_769).write(to: record)
            try LocalFilePermissions.protectFile(record)
        } else if kind == "symlink" {
            let target = f.root.appendingPathComponent("untrusted.json")
            try Data("{}".utf8).write(to: target)
            try FileManager.default.removeItem(at: record)
            try FileManager.default.createSymbolicLink(at: record, withDestinationURL: target)
        } else {
            try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: record.path)
        }
        #expect(throws: RemoteBackupPersistenceError.invalidState) { try owner.state() }
    }
}
