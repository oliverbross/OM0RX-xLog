import Foundation

public protocol RemoteBackupClock: Sendable {
    func now() -> Date
}

/// The host owns delivery and cancellation of ticks. No system timer is installed.
public protocol RemoteBackupTickSource: Sendable {
    func nextTick() async throws -> Bool
}

/// Default-off portable host seam. Each advance consumes at most one injected tick;
/// the application must explicitly start it and drive advances from its lifecycle.
public actor RemoteBackupHostDriver {
    private let scheduler: RemoteBackupScheduler
    private let owner: RemoteBackupOwner
    private let clock: any RemoteBackupClock
    private let ticks: any RemoteBackupTickSource
    private var context: RemoteBackupUploadPlan?
    private var advancing = false
    private var epoch: UInt64 = 0

    public init(scheduler: RemoteBackupScheduler, owner: RemoteBackupOwner,
                clock: any RemoteBackupClock, ticks: any RemoteBackupTickSource) {
        self.scheduler = scheduler; self.owner = owner; self.clock = clock; self.ticks = ticks
    }

    /// Recurrence is separately explicit; a configured interval alone never grants it.
    public func start(plan: RemoteBackupUploadPlan, recurring: Bool = false) async throws {
        try Task.checkCancellation()
        guard context == nil, !advancing else { throw RemoteBackupSchedulerError.operationInProgress }
        try await owner.validateStart(recurring: recurring)
        epoch &+= 1
        let startingEpoch = epoch
        context = plan
        do {
            _ = try await scheduler.enable(plan: plan, at: clock.now(), recurring: recurring)
        } catch {
            if epoch == startingEpoch { context = nil }
            throw error
        }
        guard epoch == startingEpoch else { return }
        if Task.isCancelled { try await stop(); throw CancellationError() }
        await owner.setRunning(true)
    }

    /// A claimed operation completes safely, but stopping revokes further recurrence.
    public func stop() async throws {
        epoch &+= 1
        let previous = context
        context = nil
        await owner.setRunning(false)
        guard let previous else { return }
        try await scheduler.stopRecurrence(workspaceGeneration: previous.workspaceGeneration,
            destination: previous.destination)
    }

    @discardableResult
    public func advance() async throws -> RemoteBackupUploadReceipt? {
        guard let context, !advancing else { return nil }
        advancing = true
        defer { advancing = false }
        let advancingEpoch = epoch
        guard try await ticks.nextTick(), epoch == advancingEpoch else { return nil }
        try Task.checkCancellation()
        guard let current = try await scheduler.currentPlan(workspaceGeneration: context.workspaceGeneration,
            destination: context.destination), epoch == advancingEpoch else { return nil }
        guard let receipt = try await owner.tick(plan: current, at: clock.now()) else { return nil }
        guard epoch == advancingEpoch, self.context != nil, !Task.isCancelled else { return receipt }
        _ = try await scheduler.rearm(after: receipt, at: clock.now())
        return receipt
    }
}
