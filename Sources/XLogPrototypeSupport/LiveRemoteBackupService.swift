import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Native-only, default-off worker owner. No IPC route or provider is installed.
/// Construction does not open a workspace, create metadata, or start a timer.
actor LiveRemoteBackupService {
    private let logbook: LiveLogbookMethods
    private let clock: any RemoteBackupClock
    private let ticks: @Sendable () throws -> any RemoteBackupTickSource
    private nonisolated let lifetime = Lifetime()
    private var driver: RemoteBackupHostDriver?
    private var stopping = false
    private var starting = false
    private var cleanup: Task<Void, Error>?

    init(logbook: LiveLogbookMethods, clock: any RemoteBackupClock = RemoteBackupSystemClock(),
         ticks: @escaping @Sendable () throws -> any RemoteBackupTickSource = {
             try RemoteBackupPeriodicTickSource(interval: 30)
         }) {
        self.logbook = logbook; self.clock = clock; self.ticks = ticks
    }

    /// A future native command boundary owns approval; no constructor/start path
    /// silently creates consent or restores a previously running background task.
    func authorizationOwner() throws -> RemoteBackupAuthorizationOwner {
        try RemoteBackupAuthorizationOwner(workspace: logbook,
            stateDirectory: logbook.remoteBackupDirectory().appendingPathComponent("Authorization"))
    }

    func start(plan: RemoteBackupUploadPlan, authorization: RemoteBackupAuthorization,
               executor: any RemoteBackupClaimExecutor) async throws {
        guard !stopping, !starting else { throw RemoteBackupSchedulerError.operationInProgress }
        starting = true
        defer { starting = false }
        try Task.checkCancellation()
        let token = try lifetime.begin()
        var created: RemoteBackupHostDriver?
        do {
            let authority = try authorizationOwner()
            try await authority.validate(plan: plan, authorization: authorization)
            let checker = await authority.checker(for: authorization)
            let directory = try logbook.remoteBackupDirectory()
            let scheduler = try RemoteBackupScheduler(stateDirectory: directory.appendingPathComponent("Schedules"))
            let workspace = AuthorizedWorkspace(logbook: logbook, checker: checker)
            let source = try RemoteBackupLocalSnapshotSource(workspace: workspace,
                stagingDirectory: directory.appendingPathComponent("Staging"))
            let owner = RemoteBackupOwner(scheduler: scheduler, source: source,
                executor: AuthorizedExecutor(executor: executor, checker: checker))
            let host = RemoteBackupHostDriver(scheduler: scheduler, owner: owner, clock: clock, ticks: try ticks())
            created = host
            try checker.validate(workspaceGeneration: plan.workspaceGeneration, destination: plan.destination)
            guard lifetime.permits(token) else { throw CancellationError() }
            try await host.start(plan: plan, recurring: authorization.recurring)
            guard lifetime.permits(token), !Task.isCancelled else { throw CancellationError() }
            driver = host
            let task = Task { [weak self] in
                guard let self else { return }
                await self.run(token: token, plan: plan, checker: checker, scheduler: scheduler, host: host)
            }
            lifetime.install(task, token: token)
        } catch {
            if let created { try? await created.stop() }
            lifetime.end(token)
            throw error
        }
    }

    /// Synchronous cancellation is available at terminal EOF, before actor cleanup.
    nonisolated func beginTermination() { lifetime.cancel(terminal: true) }

    func stop() async throws {
        lifetime.cancel(terminal: false)
        if let cleanup { try await cleanup.value; return }
        stopping = true
        defer { stopping = false; cleanup = nil }
        let previous = driver
        driver = nil
        let joined = Task<Void, Error> { if let previous { try await previous.stop() } }
        cleanup = joined
        try await joined.value
    }

    func terminate() async {
        beginTermination()
        try? await stop()
    }

    var isRunning: Bool { lifetime.isActive }
    var currentTask: Task<Void, Never>? { lifetime.currentTask }

    private func run(token: UUID, plan: RemoteBackupUploadPlan, checker: RemoteBackupAuthorizationChecker,
                     scheduler: RemoteBackupScheduler, host: RemoteBackupHostDriver) async {
        while lifetime.permits(token), !Task.isCancelled {
            do {
                try checker.validate(workspaceGeneration: plan.workspaceGeneration, destination: plan.destination)
                _ = try await host.advance()
                guard lifetime.permits(token), !Task.isCancelled,
                      let current = try await scheduler.currentPlan(workspaceGeneration: plan.workspaceGeneration,
                          destination: plan.destination), try await scheduler.state(for: current) == .enabled else { break }
            } catch { break }
        }
        // A superseded run may finish its issued claim, but cannot stop a later run.
        guard lifetime.permits(token) else { return }
        try? await stop()
    }

    private struct AuthorizedWorkspace: RemoteBackupWorkspaceSnapshotSource {
        let logbook: LiveLogbookMethods
        let checker: RemoteBackupAuthorizationChecker
        func withActiveSnapshot<T: Sendable>(workspaceGeneration: UUID, destination: RemoteBackupDestination,
            capture: @Sendable (RemoteBackupWorkspaceSnapshot) throws -> T) async throws -> T {
            try await logbook.withAuthorizedBackupSnapshot(workspaceGeneration: workspaceGeneration,
                destination: destination, checker: checker, capture: capture)
        }
    }

    private struct AuthorizedExecutor: RemoteBackupClaimExecutor {
        let executor: any RemoteBackupClaimExecutor
        let checker: RemoteBackupAuthorizationChecker
        func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
            try checker.validate(workspaceGeneration: claim.plan.workspaceGeneration, destination: claim.plan.destination)
            return try await executor.execute(claim)
        }
    }

    private final class Lifetime: @unchecked Sendable {
        private let lock = NSLock()
        private var terminal = false
        private var token: UUID?
        private var task: Task<Void, Never>?

        func begin() throws -> UUID {
            try lock.withLock {
                guard !terminal else { throw CancellationError() }
                guard token == nil else { throw RemoteBackupSchedulerError.operationInProgress }
                let value = UUID(); token = value; return value
            }
        }
        func permits(_ expected: UUID) -> Bool { lock.withLock { !terminal && token == expected } }
        func install(_ value: Task<Void, Never>, token expected: UUID) {
            let installed = lock.withLock {
                guard !terminal, token == expected else { return false }
                task = value
                return true
            }
            if !installed { value.cancel() }
        }
        func end(_ expected: UUID) {
            lock.withLock {
                guard token == expected else { return }
                token = nil; task = nil
            }
        }
        func cancel(terminal: Bool) {
            let previous = lock.withLock {
                self.terminal = self.terminal || terminal
                let previous = task
                token = nil; task = nil
                return previous
            }
            previous?.cancel()
        }
        var isActive: Bool { lock.withLock { token != nil } }
        var currentTask: Task<Void, Never>? { lock.withLock { task } }
    }
}
