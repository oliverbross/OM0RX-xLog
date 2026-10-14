import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import XLogPrototypeSupport
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct LiveRemoteBackupServiceTests {
    private final class Clock: RemoteBackupClock, @unchecked Sendable {
        private let lock = NSLock()
        private var date = Date(timeIntervalSince1970: 10_000)
        func now() -> Date { lock.withLock { date } }
        func due() { lock.withLock { date = date.addingTimeInterval(3_600) } }
    }

    private actor Probe {
        var calls = 0
        private var entered: [CheckedContinuation<Void, Never>] = []
        func begin() { calls += 1; entered.forEach { $0.resume() }; entered = [] }
        func wait() async {
            if calls > 0 { return }
            await withCheckedContinuation { entered.append($0) }
        }
    }

    private final class Ticks: RemoteBackupTickSource, @unchecked Sendable {
        let probe = Probe()
        let stream: AsyncStream<Void>
        let continuation: AsyncStream<Void>.Continuation
        init() { (stream, continuation) = AsyncStream<Void>.makeStream() }
        func nextTick() async throws -> Bool {
            await probe.begin()
            for await _ in stream { try Task.checkCancellation(); return true }
            try Task.checkCancellation()
            return false
        }
        func emit() { continuation.yield(()) }
    }

    private actor Executor: RemoteBackupClaimExecutor {
        var claims: [RemoteBackupDueClaim] = []
        func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
            claims.append(claim)
            return try RemoteBackupUploadReceipt(plan: claim.plan,
                outcome: .verified(package: claim.envelope.identity, at: claim.claimedAt))
        }
    }

    private final class Accounts: NativeDropboxBackupAccountRegistry, @unchecked Sendable {
        private let lock = NSRecursiveLock()
        private var registration: NativeDropboxBackupRegistration?
        func set(_ registration: NativeDropboxBackupRegistration?) { lock.withLock { self.registration = registration } }
        func withRegistration<T: Sendable>(workspaceGeneration: UUID, accountID: UUID, keychainService: String,
            _ body: (NativeDropboxBackupRegistration?) throws -> T) throws -> T {
            try lock.withLock { try body(registration) }
        }
    }

    private func registration(_ plan: RemoteBackupUploadPlan, _ workspace: IntegrationWorkspace,
                              revision: UInt64 = 1) throws -> NativeDropboxBackupRegistration {
        try NativeDropboxBackupRegistration(revision: revision,
            binding: NativeDropboxBackupAccountBinding(workspaceGeneration: plan.workspaceGeneration,
                destination: plan.destination, keychainService: workspace.keychainService,
                providerAccountID: "dbid:fixture-owner"))
    }

    @Test func nativeCommandsStayHiddenAndRejectApprovalWithoutRegisteredAccount() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let service = LiveRemoteBackupService(logbook: logbook)
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        #expect(commands === (await service.nativeCommands()))
        #expect(try await commands.availableAccount(for: planned) == nil)
        let invented = try registration(planned, workspace)
        await #expect(throws: NativeRemoteBackupCommandError.accountUnavailable) {
            try await commands.approve(plan: planned, account: invented, expectedConfigurationRevision: 0)
        }
        try await commands.reconcile()
        #expect(await service.isRunning == false)
        #expect(!FileManager.default.fileExists(atPath: workspace.directoryURL.appendingPathComponent("Remote Backup").path))
    }

    @Test func nativeApprovalAndReconcileNeverStartAndRecurringConsentRemainsExplicit() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let accounts = Accounts(), ticks = Ticks()
        let service = LiveRemoteBackupService(logbook: logbook, accounts: accounts, ticks: { ticks })
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        #expect(try await commands.availableAccount(for: planned) == registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0)
        #expect(!approval.authorization.recurring)
        try await commands.reconcile()
        #expect(await service.isRunning == false)
        #expect(await ticks.probe.calls == 0)
        let recurring = try await commands.approve(plan: planned, account: registered,
            expectedConfigurationRevision: 1, recurring: true)
        #expect(recurring.authorization.recurring)
        #expect(await service.isRunning == false)
        await #expect(throws: RemoteBackupAuthorizationError.staleRevision) {
            try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 1)
        }
    }

    @Test func nativeExplicitStartUsesRegisteredAccountAndProducesVerifiedOneShot() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let accounts = Accounts(), ticks = Ticks(), clock = Clock(), vault = Vault(), http = DropboxHTTP()
        let service = LiveRemoteBackupService(logbook: logbook, clock: clock, accounts: accounts, ticks: { ticks })
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0)
        try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        #expect(vault.recorded.isEmpty)
        #expect(await http.calls == 0)
        clock.due(); ticks.emit(); await task.value
        #expect(await http.calls == 4)
        #expect(await service.isRunning == false)
        try await commands.reconcile()
        #expect(await service.isRunning == false)
    }

    @Test func nativeStaleRegistrationAndRevokedApprovalRejectBeforeCredentialRead() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let accounts = Accounts(), vault = Vault(), http = DropboxHTTP()
        let service = LiveRemoteBackupService(logbook: logbook, accounts: accounts)
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0)
        accounts.set(try registration(planned, workspace, revision: 2))
        await #expect(throws: NativeRemoteBackupCommandError.accountUnavailable) {
            try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        }
        accounts.set(registered)
        let authority = try await service.authorizationOwner()
        try await authority.revoke(expectedWorkspaceGeneration: planned.workspaceGeneration, expectedConfigurationRevision: 1)
        await #expect(throws: RemoteBackupAuthorizationError.notAuthorized) {
            try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        }
        #expect(vault.recorded.isEmpty)
        #expect(await http.calls == 0)
    }

    @Test func accountRemovalIsCheckedInsideDueCaptureWithoutExplicitReconcile() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let accounts = Accounts(), ticks = Ticks(), clock = Clock(), vault = Vault(), http = DropboxHTTP()
        let service = LiveRemoteBackupService(logbook: logbook, clock: clock, accounts: accounts, ticks: { ticks })
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0, recurring: true)
        try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        accounts.set(nil); clock.due(); ticks.emit(); await task.value
        #expect(await service.isRunning == false)
        #expect(vault.recorded.isEmpty)
        #expect(await http.calls == 0)
        let staging = workspace.directoryURL.appendingPathComponent("Remote Backup/Staging")
        #expect(try FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty)
        accounts.set(registered); try await commands.reconcile()
        #expect(await service.isRunning == false)
    }

    @Test func nativeReconcileCancelsPendingTickOnAccountReplacementAndNeverRestarts() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let accounts = Accounts(), ticks = Ticks(), vault = Vault(), http = DropboxHTTP()
        let service = LiveRemoteBackupService(logbook: logbook, accounts: accounts, ticks: { ticks })
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0, recurring: true)
        try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        accounts.set(try registration(planned, workspace, revision: 2))
        try await commands.reconcile(); await task.value
        #expect(await service.isRunning == false)
        accounts.set(registered); try await commands.reconcile()
        #expect(await service.isRunning == false)
        #expect(vault.recorded.isEmpty)
        #expect(await http.calls == 0)
    }

    @Test func nativeRevokeCancelsAndDurablyRejectsTheOldApproval() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let accounts = Accounts(), ticks = Ticks(), vault = Vault(), http = DropboxHTTP()
        let service = LiveRemoteBackupService(logbook: logbook, accounts: accounts, ticks: { ticks })
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0, recurring: true)
        try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        try await commands.revoke(expectedWorkspaceGeneration: planned.workspaceGeneration, expectedConfigurationRevision: 1)
        await task.value
        #expect(await service.isRunning == false)
        await #expect(throws: RemoteBackupAuthorizationError.notAuthorized) {
            try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        }
        #expect(vault.recorded.isEmpty)
        #expect(await http.calls == 0)
    }

    @Test func accountRemovalDuringMockWritePreservesUncertaintyAndCannotReplay() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let accounts = Accounts(), ticks = Ticks(), clock = Clock(), vault = Vault()
        let http = DropboxHTTP { path in if path == "/2/files/upload" { accounts.set(nil) } }
        let service = LiveRemoteBackupService(logbook: logbook, clock: clock, accounts: accounts, ticks: { ticks })
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0, recurring: true)
        try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        clock.due(); ticks.emit(); await task.value
        #expect(await service.isRunning == false)
        #expect(await http.calls == 2)
        let metadata = try metadataContents(in: workspace.directoryURL.appendingPathComponent("Remote Backup"))
        #expect(metadata.contains { $0.contains("uncertain") })
        accounts.set(registered)
        await #expect(throws: RemoteBackupSchedulerError.operationInProgress) {
            try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        }
        #expect(await http.calls == 2)
    }

    @Test func nativeReconcileStopsOnActualWorkspaceRotationAndOldReceiptCannotStart() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let backup = try logbook.handle(method: "backup_create", params: ["name": "command-generation"])
        let name = try #require(backup["name"] as? String)
        let accounts = Accounts(), ticks = Ticks(), vault = Vault(), http = DropboxHTTP()
        let service = LiveRemoteBackupService(logbook: logbook, accounts: accounts, ticks: { ticks })
        let commands = await service.nativeCommands(), planned = try plan(logbook)
        let registered = try registration(planned, workspace); accounts.set(registered)
        let approval = try await commands.approve(plan: planned, account: registered, expectedConfigurationRevision: 0, recurring: true)
        try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        _ = try logbook.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
            "restore_settings": false, "restore_preferences": false, "restore_reference_data": false])
        try await commands.reconcile(); await task.value
        #expect(await service.isRunning == false)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await commands.start(plan: planned, approval: approval, vault: vault, http: http)
        }
        #expect(vault.recorded.isEmpty)
        #expect(await http.calls == 0)
    }

    private func fixture() throws -> (LiveLogbookMethods, URL, IntegrationWorkspace) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-live-backup-\(UUID().uuidString)")
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL)
        return (logbook, root, workspace)
    }

    private func plan(_ logbook: LiveLogbookMethods) throws -> RemoteBackupUploadPlan {
        let generation = try logbook.withCurrentWorkspaceGeneration { $0 }
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "id:isolated-folder"), schedule: .every(hours: 1))
        return try RemoteBackupUploadPlan(workspaceGeneration: generation, destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
    }

    private func clean(_ logbook: LiveLogbookMethods, _ root: URL, _ workspace: IntegrationWorkspace) {
        try? logbook.openedDatabase().close()
        UserDefaults.standard.removePersistentDomain(forName: workspace.defaultsSuiteName)
        try? FileManager.default.removeItem(at: root)
    }

    private func metadataContents(in directory: URL) throws -> [String] {
        let enumerator = try #require(FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil))
        var values: [String] = []
        for case let url as URL in enumerator where url.pathExtension == "json" {
            values.append(String(decoding: try Data(contentsOf: url), as: UTF8.self))
        }
        return values
    }

    private final class Vault: NativeBackupCredentialVault, @unchecked Sendable {
        struct Read: Equatable { let service: String; let account: String }
        private let lock = NSLock()
        private var value: String? = "fixture-only-access-value"
        private var fail = false
        private var reads: [Read] = []
        func read(service: String, account: String) throws -> String? {
            try lock.withLock {
                reads.append(Read(service: service, account: account))
                if fail { throw NSError(domain: "untrusted-vault-detail", code: 1) }
                return value
            }
        }
        func set(_ value: String?, fail: Bool = false) { lock.withLock { self.value = value; self.fail = fail } }
        var recorded: [Read] { lock.withLock { reads } }
    }

    private actor DropboxHTTP: DropboxBackupHTTPClient {
        var calls = 0
        private let onRequest: @Sendable (String) -> Void
        private var bytes = Data()
        private var metadata = Data()
        init(onRequest: @escaping @Sendable (String) -> Void = { _ in }) { self.onRequest = onRequest }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse {
            calls += 1
            let url = request.url!
            onRequest(url.path)
            switch url.path {
            case "/2/users/get_current_account":
                return DropboxBackupHTTPResponse(url: url, statusCode: 200,
                    body: Data(#"{"account_id":"dbid:fixture-owner"}"#.utf8))
            case "/2/files/upload":
                bytes = request.httpBody ?? Data()
                let argument = try #require(request.value(forHTTPHeaderField: "Dropbox-API-Arg"))
                let object = try #require(JSONSerialization.jsonObject(with: Data(argument.utf8)) as? [String: Any])
                let path = try #require(object["path"] as? String)
                metadata = try JSONSerialization.data(withJSONObject: ["id": "id:fixture-created", "rev": "abcdef123456",
                    "name": String(path.split(separator: "/").last!), "size": bytes.count])
                return DropboxBackupHTTPResponse(url: url, statusCode: 200, body: metadata)
            case "/2/files/download":
                return DropboxBackupHTTPResponse(url: url, statusCode: 200,
                    headers: ["Dropbox-API-Result": String(decoding: metadata, as: UTF8.self)], body: bytes)
            default: throw DropboxBackupError.invalidDestination
            }
        }
    }

    @Test func dropboxBindingUsesIsolatedExactVaultKeyAndNoEagerReads() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let service = LiveRemoteBackupService(logbook: logbook)
        let approved = try plan(logbook)
        let authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0)
        let binding = try await service.dropboxAccountBinding(plan: approved, authorization: grant, providerAccountID: "dbid:fixture-owner")
        let again = try await service.dropboxAccountBinding(plan: approved, authorization: grant, providerAccountID: "dbid:fixture-owner")
        #expect(binding == again)
        #expect(binding.keychainService == workspace.keychainService)
        #expect(binding.vaultAccount == again.vaultAccount)
        #expect(binding.vaultAccount.utf8.count <= 128)
        #expect(!binding.vaultAccount.contains("fixture-owner"))
        let changed = try NativeDropboxBackupAccountBinding(workspaceGeneration: binding.workspaceGeneration,
            destination: binding.destination, keychainService: binding.keychainService, providerAccountID: "dbid:other-owner")
        #expect(changed.vaultAccount != binding.vaultAccount)
        let vault = Vault(), checker = await authority.checker(for: grant)
        let source = LiveDropboxBackupCredentialSource(logbook: logbook, binding: binding, checker: checker, vault: vault)
        #expect(vault.recorded.isEmpty)
        let credential = try await source.credential(for: approved.destination.accountID)
        #expect(credential.accountID == approved.destination.accountID)
        #expect(credential.providerAccountID == "dbid:fixture-owner")
        #expect(credential.description == "DropboxBackupCredential(redacted)")
        #expect(vault.recorded == [Vault.Read(service: workspace.keychainService, account: binding.vaultAccount)])
    }

    @Test func dropboxVaultMissingMalformedAndRawFailuresAreSafe() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let service = LiveRemoteBackupService(logbook: logbook)
        let approved = try plan(logbook), authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0)
        let binding = try await service.dropboxAccountBinding(plan: approved, authorization: grant, providerAccountID: "dbid:fixture-owner")
        let vault = Vault(), checker = await authority.checker(for: grant)
        let source = LiveDropboxBackupCredentialSource(logbook: logbook, binding: binding, checker: checker, vault: vault)
        vault.set(nil)
        await #expect(throws: DropboxBackupError.credentialUnavailable) { try await source.credential(for: approved.destination.accountID) }
        for value in ["", "invalid\nvalue", String(repeating: "a", count: 8_193)] {
            vault.set(value)
            await #expect(throws: DropboxBackupError.invalidCredential) { try await source.credential(for: approved.destination.accountID) }
        }
        vault.set(nil, fail: true)
        await #expect(throws: DropboxBackupError.credentialUnavailable) { try await source.credential(for: approved.destination.accountID) }
    }

    @Test func dropboxAccountRevocationAndCancellationRejectBeforeVaultAccess() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let service = LiveRemoteBackupService(logbook: logbook)
        let approved = try plan(logbook), authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0)
        let binding = try await service.dropboxAccountBinding(plan: approved, authorization: grant, providerAccountID: "dbid:fixture-owner")
        let vault = Vault(), checker = await authority.checker(for: grant)
        let source = LiveDropboxBackupCredentialSource(logbook: logbook, binding: binding, checker: checker, vault: vault)
        await #expect(throws: DropboxBackupError.accountMismatch) { try await source.credential(for: UUID()) }
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await source.credential(for: approved.destination.accountID)
        }
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        try await authority.revoke(expectedWorkspaceGeneration: approved.workspaceGeneration, expectedConfigurationRevision: 1)
        await #expect(throws: RemoteBackupAuthorizationError.notAuthorized) { try await source.credential(for: approved.destination.accountID) }
        #expect(vault.recorded.isEmpty)
    }

    @Test func dropboxNativeExecutorLoadsOnlyWhenDueAndNeverWritesTokenToMetadata() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let ticks = Ticks(), clock = Clock(), vault = Vault(), http = DropboxHTTP()
        let service = LiveRemoteBackupService(logbook: logbook, clock: clock, ticks: { ticks })
        let approved = try plan(logbook), authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0)
        let binding = try await service.dropboxAccountBinding(plan: approved, authorization: grant, providerAccountID: "dbid:fixture-owner")
        try await service.startDropbox(plan: approved, authorization: grant, binding: binding, vault: vault, http: http)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        #expect(vault.recorded.isEmpty)
        #expect(await http.calls == 0)
        clock.due(); ticks.emit()
        await task.value
        #expect(await service.isRunning == false)
        #expect(await http.calls == 4)
        #expect(vault.recorded.count == 2)
        #expect(vault.recorded.allSatisfy { $0.service == binding.keychainService && $0.account == binding.vaultAccount })
        let directory = workspace.directoryURL.appendingPathComponent("Remote Backup")
        let contents = try metadataContents(in: directory)
        #expect(contents.count >= 3)
        #expect(contents.allSatisfy { !$0.contains("fixture-only-access-value") })
    }

    @Test func dropboxCredentialLeaseRejectsWrongServiceAndRealWorkspaceRotation() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let service = LiveRemoteBackupService(logbook: logbook)
        let approved = try plan(logbook), authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0)
        let binding = try await service.dropboxAccountBinding(plan: approved, authorization: grant, providerAccountID: "dbid:fixture-owner")
        let wrong = try NativeDropboxBackupAccountBinding(workspaceGeneration: binding.workspaceGeneration,
            destination: binding.destination, keychainService: binding.keychainService + "-other", providerAccountID: binding.providerAccountID)
        let vault = Vault(), checker = await authority.checker(for: grant)
        let incorrect = LiveDropboxBackupCredentialSource(logbook: logbook, binding: wrong, checker: checker, vault: vault)
        await #expect(throws: DropboxBackupError.accountMismatch) { try await incorrect.credential(for: approved.destination.accountID) }
        let source = LiveDropboxBackupCredentialSource(logbook: logbook, binding: binding, checker: checker, vault: vault)
        let backup = try logbook.handle(method: "backup_create", params: ["name": "credential-generation"])
        let name = try #require(backup["name"] as? String)
        _ = try logbook.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
            "restore_settings": false, "restore_preferences": false, "restore_reference_data": false])
        await #expect(throws: DropboxBackupError.accountMismatch) { try await source.credential(for: approved.destination.accountID) }
        #expect(vault.recorded.isEmpty)
    }

    @Test func constructionAndBackgroundStartupRemainOffWithoutTouchingBackupState() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let ticks = Ticks()
        let service = LiveRemoteBackupService(logbook: logbook, ticks: { ticks })
        let worker = LiveWorker(logbook: logbook, localAcceptance: true, remoteBackup: service)
        await worker.startBackgroundServices()
        #expect(await service.isRunning == false)
        #expect(await ticks.probe.calls == 0)
        #expect(!FileManager.default.fileExists(atPath: workspace.directoryURL.appendingPathComponent("Remote Backup").path))
        await worker.shutdown()
    }

    @Test func approvedOneShotCapturesActualIsolatedOwnerAndCleansStaging() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let ticks = Ticks(), clock = Clock(), executor = Executor()
        let service = LiveRemoteBackupService(logbook: logbook, clock: clock, ticks: { ticks })
        let approved = try plan(logbook)
        let authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0)
        try await service.start(plan: approved, authorization: grant, executor: executor)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        clock.due(); ticks.emit()
        await task.value
        #expect(await service.isRunning == false)
        let claim = try #require(await executor.claims.first)
        #expect(claim.plan.workspaceGeneration == approved.workspaceGeneration)
        #expect(claim.plan.backupID != approved.backupID)
        #expect(claim.envelope.manifest.qsoCount == 0)
        #expect(claim.envelope.settings?.automaticSync == false)
        #expect(claim.envelope.preferences != nil)
        #expect(await executor.claims.count == 1)
        let staging = workspace.directoryURL.appendingPathComponent("Remote Backup/Staging")
        #expect(try FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty)
    }

    @Test func revokedConsentIsCheckedAgainInsideCaptureLease() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let ticks = Ticks(), clock = Clock(), executor = Executor()
        let service = LiveRemoteBackupService(logbook: logbook, clock: clock, ticks: { ticks })
        let approved = try plan(logbook)
        let authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0, recurring: true)
        try await service.start(plan: approved, authorization: grant, executor: executor)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        try await authority.revoke(expectedWorkspaceGeneration: approved.workspaceGeneration, expectedConfigurationRevision: 1)
        clock.due(); ticks.emit()
        await task.value
        #expect(await executor.claims.isEmpty)
        #expect(await service.isRunning == false)
        await #expect(throws: RemoteBackupAuthorizationError.notAuthorized) {
            try await service.start(plan: approved, authorization: grant, executor: executor)
        }
    }

    @Test func workerRestoreCancelsPendingAdvanceAndRotatesRealUUIDAuthority() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let backup = try logbook.handle(method: "backup_create", params: ["name": "isolated-fixture"])
        let name = try #require(backup["name"] as? String)
        let ticks = Ticks(), executor = Executor()
        let service = LiveRemoteBackupService(logbook: logbook, ticks: { ticks })
        let worker = LiveWorker(logbook: logbook, localAcceptance: true, remoteBackup: service)
        let approved = try plan(logbook)
        let authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0, recurring: true)
        try await service.start(plan: approved, authorization: grant, executor: executor)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        let request = try JSONSerialization.data(withJSONObject: ["id": "restore", "method": "backup_restore",
            "params": ["name": name, "confirm_restore": true, "restore_settings": false,
                       "restore_preferences": false, "restore_reference_data": false]])
        let response = await worker.response(to: request)
        let result = try #require(JSONSerialization.jsonObject(with: response) as? [String: Any])
        #expect(result["ok"] as? Bool == true)
        await task.value
        #expect(await service.isRunning == false)
        #expect(await executor.claims.isEmpty)
        let current = try logbook.withCurrentWorkspaceGeneration { $0 }
        #expect(current != approved.workspaceGeneration)
        #expect(try await authority.state().authorization == nil)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await service.start(plan: approved, authorization: grant, executor: executor)
        }
        await worker.shutdown()
    }

    @Test func terminalShutdownCancelsPendingTickAndRejectsNativeRestart() async throws {
        let (logbook, root, workspace) = try fixture()
        defer { clean(logbook, root, workspace) }
        let ticks = Ticks(), executor = Executor()
        let service = LiveRemoteBackupService(logbook: logbook, ticks: { ticks })
        let worker = LiveWorker(logbook: logbook, localAcceptance: true, remoteBackup: service)
        let approved = try plan(logbook)
        let authority = try await service.authorizationOwner()
        let grant = try await authority.approve(plan: approved, expectedConfigurationRevision: 0, recurring: true)
        try await service.start(plan: approved, authorization: grant, executor: executor)
        let task = try #require(await service.currentTask)
        await ticks.probe.wait()
        await worker.beginTerminalShutdown()
        await task.value
        await worker.shutdown()
        #expect(await service.isRunning == false)
        #expect(await executor.claims.isEmpty)
        await #expect(throws: CancellationError.self) {
            try await service.start(plan: approved, authorization: grant, executor: executor)
        }
    }
}
