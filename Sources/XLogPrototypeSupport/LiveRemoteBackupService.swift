import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Native-only, default-off worker owner. No IPC enable route is installed.
/// Construction does not open a workspace, create metadata, or start a timer.
actor LiveRemoteBackupService {
    private let logbook: LiveLogbookMethods
    private let clock: any RemoteBackupClock
    private let ticks: @Sendable () throws -> any RemoteBackupTickSource
    private let accounts: any NativeDropboxBackupAccountRegistry
    private nonisolated let accountOwner: LiveDropboxBackupAccountOwner?
    private var commandOwner: LiveRemoteBackupCommands?
    private nonisolated let lifetime = Lifetime()
    private var driver: RemoteBackupHostDriver?
    private var stopping = false
    private var starting = false
    private var cleanup: Task<Void, Error>?

    init(logbook: LiveLogbookMethods, clock: any RemoteBackupClock = RemoteBackupSystemClock(),
         accounts: (any NativeDropboxBackupAccountRegistry)? = nil,
         ticks: @escaping @Sendable () throws -> any RemoteBackupTickSource = {
             try RemoteBackupPeriodicTickSource(interval: 30)
         }) {
        let resolvedAccounts = accounts ?? LiveDropboxBackupAccountOwner(logbook: logbook)
        self.logbook = logbook; self.clock = clock; self.ticks = ticks; self.accounts = resolvedAccounts
        self.accountOwner = resolvedAccounts as? LiveDropboxBackupAccountOwner
    }

    /// A future native command boundary owns approval; no constructor/start path
    /// silently creates consent or restores a previously running background task.
    func authorizationOwner() throws -> RemoteBackupAuthorizationOwner {
        try RemoteBackupAuthorizationOwner(workspace: logbook,
            stateDirectory: logbook.remoteBackupDirectory().appendingPathComponent("Authorization"))
    }

    func nativeCommands() -> LiveRemoteBackupCommands {
        if let commandOwner { return commandOwner }
        let commands = LiveRemoteBackupCommands(service: self, logbook: logbook, accounts: accounts)
        commandOwner = commands
        return commands
    }

    func accountRegistrationState() throws -> NativeDropboxBackupAccountState {
        guard let accountOwner else { throw NativeDropboxBackupAccountError.verificationUnavailable }
        return try accountOwner.state()
    }

    /// Explicit native-only provisioning metadata boundary. Verification is
    /// unavailable by default; it never grants consent or starts/resumes a lane.
    func registerDropboxAccount(plan: RemoteBackupUploadPlan, providerAccountID: String,
                                expectedRevision: UInt64) async throws -> NativeDropboxBackupRegistration {
        guard let accountOwner else { throw NativeDropboxBackupAccountError.verificationUnavailable }
        try await stop()
        return try await accountOwner.register(plan: plan, providerAccountID: providerAccountID, expectedRevision: expectedRevision)
    }

    func removeDropboxAccount(expectedWorkspaceGeneration: UUID, expectedRevision: UInt64) async throws {
        guard let accountOwner else { throw NativeDropboxBackupAccountError.verificationUnavailable }
        try accountOwner.remove(expectedWorkspaceGeneration: expectedWorkspaceGeneration, expectedRevision: expectedRevision)
        try await stop()
    }

    func dropboxAccountBinding(plan: RemoteBackupUploadPlan, authorization: RemoteBackupAuthorization,
                               providerAccountID: String) async throws -> NativeDropboxBackupAccountBinding {
        let authority = try authorizationOwner()
        try await authority.validate(plan: plan, authorization: authorization)
        let checker = await authority.checker(for: authorization)
        return try logbook.withCurrentWorkspaceGeneration { current in
            try checker.validate(workspaceGeneration: current, destination: plan.destination)
            return try NativeDropboxBackupAccountBinding(workspaceGeneration: current, destination: plan.destination,
                keychainService: logbook.currentKeychainService(), providerAccountID: providerAccountID)
        }
    }

    /// Explicit native boundary only. Existing consent supplies recurrence; no token
    /// is read until a due claim executes, and no renderer route calls this method.
    func startDropbox(plan: RemoteBackupUploadPlan, authorization: RemoteBackupAuthorization,
                      binding: NativeDropboxBackupAccountBinding,
                      vault: any NativeBackupCredentialVault = SystemNativeBackupCredentialVault(),
                      http: any DropboxBackupHTTPClient = DropboxBackupURLSessionClient(),
                      registrationCheck: @escaping @Sendable () throws -> Void = {}) async throws {
        try Task.checkCancellation()
        try registrationCheck()
        guard !stopping, !starting else { throw RemoteBackupSchedulerError.operationInProgress }
        try lifetime.checkStartAllowed()
        let authority = try authorizationOwner()
        try await authority.validate(plan: plan, authorization: authorization)
        let checker = await authority.checker(for: authorization)
        try logbook.withCurrentWorkspaceGeneration { current in
            guard binding.workspaceGeneration == current, binding.destination == plan.destination,
                  try logbook.currentKeychainService() == binding.keychainService else { throw DropboxBackupError.accountMismatch }
            try checker.validate(workspaceGeneration: current, destination: plan.destination)
        }
        let source = RegisteredCredentials(source: LiveDropboxBackupCredentialSource(logbook: logbook,
            binding: binding, checker: checker, vault: vault), check: registrationCheck)
        let directory = try logbook.remoteBackupDirectory().appendingPathComponent("Dropbox Operations")
            .appendingPathComponent(plan.destination.id.uuidString.lowercased())
        let executor = try DropboxBackupExecutor(destination: plan.destination, stateDirectory: directory,
            credentials: source, http: RegisteredHTTP(client: http, check: registrationCheck))
        try await start(plan: plan, authorization: authorization, executor: executor, registrationCheck: registrationCheck)
    }

    func start(plan: RemoteBackupUploadPlan, authorization: RemoteBackupAuthorization,
               executor: any RemoteBackupClaimExecutor,
               registrationCheck: @escaping @Sendable () throws -> Void = {}) async throws {
        guard !stopping, !starting else { throw RemoteBackupSchedulerError.operationInProgress }
        starting = true
        defer { starting = false }
        try Task.checkCancellation()
        try registrationCheck()
        let token = try lifetime.begin()
        var created: RemoteBackupHostDriver?
        do {
            let authority = try authorizationOwner()
            try await authority.validate(plan: plan, authorization: authorization)
            let checker = await authority.checker(for: authorization)
            let directory = try logbook.remoteBackupDirectory()
            let scheduler = try RemoteBackupScheduler(stateDirectory: directory.appendingPathComponent("Schedules"))
            let workspace = AuthorizedWorkspace(logbook: logbook, checker: checker, check: registrationCheck)
            let source = try RemoteBackupLocalSnapshotSource(workspace: workspace,
                stagingDirectory: directory.appendingPathComponent("Staging"))
            let owner = RemoteBackupOwner(scheduler: scheduler, source: source,
                executor: AuthorizedExecutor(executor: executor, checker: checker, check: registrationCheck))
            let host = RemoteBackupHostDriver(scheduler: scheduler, owner: owner, clock: clock, ticks: try ticks())
            created = host
            try checker.validate(workspaceGeneration: plan.workspaceGeneration, destination: plan.destination)
            try registrationCheck()
            guard lifetime.permits(token) else { throw CancellationError() }
            try await host.start(plan: plan, recurring: authorization.recurring)
            guard lifetime.permits(token), !Task.isCancelled else { throw CancellationError() }
            driver = host
            let task = Task { [weak self] in
                guard let self else { return }
                await self.run(token: token, plan: plan, checker: checker, scheduler: scheduler, host: host,
                    registrationCheck: registrationCheck)
            }
            lifetime.install(task, token: token)
        } catch {
            if let created { try? await created.stop() }
            lifetime.end(token)
            throw error
        }
    }

    /// Synchronous cancellation is available at terminal EOF, before actor cleanup.
    nonisolated func beginTermination() {
        accountOwner?.cancelPendingVerification(terminal: true)
        lifetime.cancel(terminal: true)
    }

    func stop() async throws {
        accountOwner?.cancelPendingVerification()
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
                     scheduler: RemoteBackupScheduler, host: RemoteBackupHostDriver,
                     registrationCheck: @Sendable () throws -> Void) async {
        while lifetime.permits(token), !Task.isCancelled {
            do {
                try registrationCheck()
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
        let check: @Sendable () throws -> Void
        func withActiveSnapshot<T: Sendable>(workspaceGeneration: UUID, destination: RemoteBackupDestination,
            capture: @Sendable (RemoteBackupWorkspaceSnapshot) throws -> T) async throws -> T {
            try await logbook.withAuthorizedBackupSnapshot(workspaceGeneration: workspaceGeneration,
                destination: destination, checker: checker) { snapshot in
                try check()
                return try capture(snapshot)
            }
        }
    }

    private struct AuthorizedExecutor: RemoteBackupClaimExecutor {
        let executor: any RemoteBackupClaimExecutor
        let checker: RemoteBackupAuthorizationChecker
        let check: @Sendable () throws -> Void
        func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
            try check()
            try checker.validate(workspaceGeneration: claim.plan.workspaceGeneration, destination: claim.plan.destination)
            return try await executor.execute(claim)
        }
    }

    private struct RegisteredCredentials: DropboxBackupCredentialSource {
        let source: LiveDropboxBackupCredentialSource
        let check: @Sendable () throws -> Void
        func credential(for accountID: UUID) async throws -> DropboxBackupCredential {
            try check()
            let credential = try await source.credential(for: accountID)
            try check()
            return credential
        }
    }

    private struct RegisteredHTTP: DropboxBackupHTTPClient {
        let client: any DropboxBackupHTTPClient
        let check: @Sendable () throws -> Void
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse {
            try check()
            let response = try await client.send(request, maximumResponseBytes: maximumResponseBytes)
            // If account authority changed during a write, the existing coordinator
            // records uncertainty rather than treating the result as replayable.
            try check()
            return response
        }
    }

    private final class Lifetime: @unchecked Sendable {
        private let lock = NSLock()
        private var terminal = false
        private var token: UUID?
        private var task: Task<Void, Never>?

        func checkStartAllowed() throws {
            try lock.withLock {
                guard !terminal else { throw CancellationError() }
                guard token == nil else { throw RemoteBackupSchedulerError.operationInProgress }
            }
        }

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
