import Foundation
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
            accountID: UUID(), location: .cloudFolder(id: "isolated-folder"), schedule: .every(hours: 1))
        return try RemoteBackupUploadPlan(workspaceGeneration: generation, destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
    }

    private func clean(_ logbook: LiveLogbookMethods, _ root: URL, _ workspace: IntegrationWorkspace) {
        try? logbook.openedDatabase().close()
        UserDefaults.standard.removePersistentDomain(forName: workspace.defaultsSuiteName)
        try? FileManager.default.removeItem(at: root)
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
