import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Metadata issued by a future trusted account-registration owner, never by a
/// renderer form. Re-registration must change id/revision, including same-account
/// credential replacement. This value contains no credential.
struct NativeDropboxBackupRegistration: Equatable, Sendable {
    let id: UUID
    let revision: UInt64
    let binding: NativeDropboxBackupAccountBinding

    init(id: UUID = UUID(), revision: UInt64, binding: NativeDropboxBackupAccountBinding) throws {
        guard revision > 0 else { throw DropboxBackupError.accountMismatch }
        self.id = id; self.revision = revision; self.binding = binding
    }
}

/// The registration owner must serialize reads with account replacement/removal.
/// No implementation here registers accounts, probes the vault, or performs OAuth.
protocol NativeDropboxBackupAccountRegistry: Sendable {
    func withRegistration<T: Sendable>(workspaceGeneration: UUID, accountID: UUID, keychainService: String,
        _ body: (NativeDropboxBackupRegistration?) throws -> T) throws -> T
}

struct UnregisteredDropboxBackupAccounts: NativeDropboxBackupAccountRegistry {
    func withRegistration<T: Sendable>(workspaceGeneration: UUID, accountID: UUID, keychainService: String,
        _ body: (NativeDropboxBackupRegistration?) throws -> T) throws -> T { try body(nil) }
}

struct NativeRemoteBackupApproval: Equatable, Sendable {
    let registration: NativeDropboxBackupRegistration
    let authorization: RemoteBackupAuthorization
    fileprivate init(registration: NativeDropboxBackupRegistration, authorization: RemoteBackupAuthorization) {
        self.registration = registration; self.authorization = authorization
    }
}

enum NativeRemoteBackupCommandError: Error, Equatable {
    case accountUnavailable, staleRetentionReview
}

/// A retained native review, not deletion consent. There is deliberately no
/// executor/IPC deletion route: provider revision-conditional deletion is open.
struct NativeRemoteBackupRetentionReview: Equatable, Sendable {
    let id: UUID
    let review: RemoteBackupRetentionReview
    fileprivate let plan: RemoteBackupUploadPlan
    fileprivate let approval: NativeRemoteBackupApproval
    fileprivate let contextGeneration: UUID
    fileprivate let history: [RemoteBackupUploadReceipt]
}

/// Internal command boundary, deliberately not installed in IPC/frontend routes.
/// Default account authority is empty: even availability is hidden until a trusted
/// registration exists. Approval and start are separate explicit commands; neither
/// construction, availability, nor reconcile starts or resumes work.
actor LiveRemoteBackupCommands {
    private weak var service: LiveRemoteBackupService?
    private let logbook: LiveLogbookMethods
    private let accounts: any NativeDropboxBackupAccountRegistry
    private var active: (RemoteBackupUploadPlan, NativeRemoteBackupApproval)?
    private var retainedRetentionReview: NativeRemoteBackupRetentionReview?
    private let clock: any RemoteBackupClock
    private var mutating = false

    init(service: LiveRemoteBackupService, logbook: LiveLogbookMethods,
         accounts: any NativeDropboxBackupAccountRegistry = UnregisteredDropboxBackupAccounts(),
         clock: any RemoteBackupClock = RemoteBackupSystemClock()) {
        self.service = service; self.logbook = logbook; self.accounts = accounts; self.clock = clock
    }

    /// Nil means the backup command must remain hidden. Does not read a token or
    /// create backup metadata. A future command must retain this exact receipt.
    func availableAccount(for plan: RemoteBackupUploadPlan) throws -> NativeDropboxBackupRegistration? {
        try logbook.withCurrentWorkspaceGeneration { current in
            try plan.validate(workspaceGeneration: current, destination: plan.destination)
            let keychainService = try logbook.currentKeychainService()
            return try accounts.withRegistration(workspaceGeneration: current,
                accountID: plan.destination.accountID, keychainService: keychainService) { registration in
                guard let registration, registration.binding.workspaceGeneration == current,
                      registration.binding.destination == plan.destination,
                      registration.binding.keychainService == keychainService else { return nil }
                return registration
            }
        }
    }

    func approve(plan: RemoteBackupUploadPlan, account: NativeDropboxBackupRegistration,
                 expectedConfigurationRevision: UInt64, recurring: Bool = false) async throws -> NativeRemoteBackupApproval {
        try beginMutation(); defer { mutating = false }
        retainedRetentionReview = nil
        guard let service else { throw CancellationError() }
        try Task.checkCancellation()
        try check(plan: plan, account: account)
        // Changing consent stops previous work; it never silently enables a lane.
        try await service.stop()
        active = nil
        let authority = try await service.authorizationOwner()
        let authorization = try await authority.approve(plan: plan,
            expectedConfigurationRevision: expectedConfigurationRevision, recurring: recurring)
        do {
            try Task.checkCancellation()
            try check(plan: plan, account: account)
        } catch {
            // Optimistic revision prevents cleanup from revoking newer consent.
            try? await authority.revoke(expectedWorkspaceGeneration: authorization.workspaceGeneration,
                expectedConfigurationRevision: authorization.configurationRevision)
            throw error
        }
        return NativeRemoteBackupApproval(registration: account, authorization: authorization)
    }

    func start(plan: RemoteBackupUploadPlan, approval: NativeRemoteBackupApproval,
               vault: any NativeBackupCredentialVault = SystemNativeBackupCredentialVault(),
               http: any DropboxBackupHTTPClient = DropboxBackupURLSessionClient()) async throws {
        try beginMutation(); defer { mutating = false }
        retainedRetentionReview = nil
        guard let service else { throw CancellationError() }
        try Task.checkCancellation()
        try check(plan: plan, account: approval.registration)
        let registrationCheck = makeCheck(plan: plan, account: approval.registration)
        try await service.startDropbox(plan: plan, authorization: approval.authorization,
            binding: approval.registration.binding, vault: vault, http: http,
            registrationCheck: registrationCheck)
        do {
            try Task.checkCancellation()
            try registrationCheck()
        } catch {
            try? await service.stop()
            throw error
        }
        active = (plan, approval)
    }

    /// Account/consent removal or workspace rotation only stops work. Even an
    /// unchanged valid registration never enables/restarts an approved schedule.
    func reconcile() async throws {
        try beginMutation(); defer { mutating = false }
        guard let (plan, approval) = active else { return }
        guard let service else { throw CancellationError() }
        do {
            try check(plan: plan, account: approval.registration)
            let authority = try await service.authorizationOwner()
            try await authority.validate(plan: plan, authorization: approval.authorization)
        } catch {
            active = nil
            retainedRetentionReview = nil
            try await service.stop()
        }
    }

    func stop() async throws {
        try beginMutation(); defer { mutating = false }
        retainedRetentionReview = nil
        guard let service else { throw CancellationError() }
        active = nil
        try await service.stop()
    }

    func revoke(expectedWorkspaceGeneration: UUID, expectedConfigurationRevision: UInt64) async throws {
        try beginMutation(); defer { mutating = false }
        retainedRetentionReview = nil
        guard let service else { throw CancellationError() }
        let authority = try await service.authorizationOwner()
        try await authority.revoke(expectedWorkspaceGeneration: expectedWorkspaceGeneration,
            expectedConfigurationRevision: expectedConfigurationRevision)
        active = nil
        try await service.stop()
    }

    /// Explicit passive review only. Reads durable upload history; never a remote
    /// listing, vault read, timer, provider call, retention execution or deletion.
    func reviewRetention(plan: RemoteBackupUploadPlan, approval: NativeRemoteBackupApproval) async throws -> NativeRemoteBackupRetentionReview {
        try beginMutation(); defer { mutating = false }
        retainedRetentionReview = nil
        let review = try await makeRetentionReview(plan: plan, approval: approval)
        retainedRetentionReview = review
        return review
    }

    /// Fresh confirmation/review seam for a future deletion boundary. Any changed
    /// receipt, account/consent, stop, restore, shutdown or replacement invalidates
    /// the retained review. Validation itself still authorizes no remote action.
    func validateRetentionReview(_ review: NativeRemoteBackupRetentionReview) async throws {
        try beginMutation(); defer { mutating = false }
        guard retainedRetentionReview == review else { throw NativeRemoteBackupCommandError.staleRetentionReview }
        do {
            let current = try await makeRetentionReview(plan: review.plan, approval: review.approval)
            guard current.contextGeneration == review.contextGeneration, current.history == review.history,
                  current.review == review.review else { throw NativeRemoteBackupCommandError.staleRetentionReview }
        } catch {
            retainedRetentionReview = nil
            throw error
        }
    }

    private func makeRetentionReview(plan: RemoteBackupUploadPlan, approval: NativeRemoteBackupApproval) async throws -> NativeRemoteBackupRetentionReview {
        guard let service else { throw CancellationError() }
        try Task.checkCancellation()
        let generation = try service.retentionContextGeneration()
        try check(plan: plan, account: approval.registration)
        let authority = try await service.authorizationOwner()
        try await authority.validate(plan: plan, authorization: approval.authorization)
        let checker = await authority.checker(for: approval.authorization)
        return try logbook.withCurrentWorkspaceGeneration { current in
            try Task.checkCancellation()
            try check(plan: plan, account: approval.registration)
            try checker.validate(workspaceGeneration: current, destination: plan.destination)
            let root = try logbook.remoteBackupDirectory()
            let parent = root.appendingPathComponent("Dropbox Operations")
            let directory = parent.appendingPathComponent(plan.destination.id.uuidString.lowercased())
            guard LocalFilePath.contains(directory, in: root) else { throw RemoteBackupPersistenceError.invalidState }
            if FileManager.default.fileExists(atPath: parent.path) {
                let values = try parent.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                guard values.isDirectory == true, values.isSymbolicLink != true else { throw RemoteBackupPersistenceError.invalidState }
            }
            let history = try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: directory)
            let review = try RemoteBackupRetentionReview(workspaceGeneration: current, destination: plan.destination,
                providerAccountID: approval.registration.binding.providerAccountID, receipts: history, at: clock.now())
            guard try service.retentionContextGeneration() == generation else { throw NativeRemoteBackupCommandError.staleRetentionReview }
            return NativeRemoteBackupRetentionReview(id: UUID(), review: review, plan: plan, approval: approval,
                contextGeneration: generation, history: history)
        }
    }

    private func beginMutation() throws {
        guard !mutating else { throw RemoteBackupSchedulerError.operationInProgress }
        mutating = true
    }

    private func check(plan: RemoteBackupUploadPlan, account: NativeDropboxBackupRegistration) throws {
        try makeCheck(plan: plan, account: account)()
    }

    private func makeCheck(plan: RemoteBackupUploadPlan, account: NativeDropboxBackupRegistration) -> @Sendable () throws -> Void {
        let logbook = logbook, accounts = accounts
        return {
            try logbook.withCurrentWorkspaceGeneration { current in
                try plan.validate(workspaceGeneration: current, destination: plan.destination)
                let keychainService = try logbook.currentKeychainService()
                try accounts.withRegistration(workspaceGeneration: current,
                    accountID: plan.destination.accountID, keychainService: keychainService) { registered in
                    guard registered == account, account.binding.workspaceGeneration == current,
                          account.binding.destination == plan.destination,
                          account.binding.keychainService == keychainService else {
                        throw NativeRemoteBackupCommandError.accountUnavailable
                    }
                }
            }
        }
    }
}
