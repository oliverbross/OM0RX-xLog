import Foundation

/// Capture must use the current workspace owner and return newly sealed, validated
/// bytes (for example through XLogBackupManager.prepareEnvelope), never a package URL.
public protocol RemoteBackupSnapshotSource: Sendable {
    func capture(workspaceGeneration: UUID, destination: RemoteBackupDestination) async throws -> XLogBackupEnvelope
}

public protocol RemoteBackupClaimExecutor: Sendable {
    func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt
}

public enum RemoteBackupOwnerError: Error, Equatable, Sendable {
    case executionUncertain
}

public enum RemoteBackupSnapshotClaimMode: Sendable {
    /// The scheduled plan is a consent placeholder; capture issues a fresh ID and identity.
    case freshSnapshot
    /// Capture returns the exact previously prepared bytes approved by the plan.
    case preparedOneShot
}

/// Deterministic orchestration only: the host supplies ticks and explicitly starts
/// this default-off owner. Scheduler enablement remains a separate explicit consent.
/// No timer, networking, recurring rearm, retention or deletion is performed here.
public actor RemoteBackupOwner {
    private let scheduler: RemoteBackupScheduler
    private let source: any RemoteBackupSnapshotSource
    private let executor: any RemoteBackupClaimExecutor
    private let claimMode: RemoteBackupSnapshotClaimMode
    private var running = false
    private var active = Set<UUID>()
    private var epoch: UInt64 = 0

    public init(scheduler: RemoteBackupScheduler, source: any RemoteBackupSnapshotSource,
                executor: any RemoteBackupClaimExecutor,
                claimMode: RemoteBackupSnapshotClaimMode = .freshSnapshot) {
        self.scheduler = scheduler; self.source = source; self.executor = executor
        self.claimMode = claimMode
    }

    func validateStart(recurring: Bool) throws {
        if case .preparedOneShot = claimMode, recurring {
            throw RemoteBackupPlanningError.invalidSchedule
        }
    }

    /// Stopping invalidates a capture already in flight; an issued claim still finishes.
    public func setRunning(_ value: Bool) {
        running = value
        epoch &+= 1
    }

    @discardableResult
    public func tick(plan: RemoteBackupUploadPlan, at now: Date) async throws -> RemoteBackupUploadReceipt? {
        guard running, active.insert(plan.destination.id).inserted else { return nil }
        defer { active.remove(plan.destination.id) }
        let capturedEpoch = epoch
        guard try await scheduler.observeDue(plan: plan, at: now) else { return nil }
        guard running, epoch == capturedEpoch else { return nil }
        try Task.checkCancellation()
        let envelope = try await source.capture(workspaceGeneration: plan.workspaceGeneration, destination: plan.destination)
        guard running, epoch == capturedEpoch else { return nil }
        try Task.checkCancellation()
        let claim = if case .preparedOneShot = claimMode {
            try await scheduler.claimDue(envelope: envelope, plan: plan,
                workspaceGeneration: plan.workspaceGeneration, destination: plan.destination, at: now)
        } else {
            try await scheduler.claimFreshDue(envelope: envelope, scheduledPlan: plan,
                workspaceGeneration: plan.workspaceGeneration, destination: plan.destination, at: now)
        }
        guard let claim else { return nil }
        let receipt: RemoteBackupUploadReceipt
        do {
            let result = try await executor.execute(claim)
            guard result.plan == claim.plan else { throw RemoteBackupPlanningError.invalidReceipt }
            receipt = result
        } catch {
            try await scheduler.finish(RemoteBackupUploadReceipt(plan: claim.plan, outcome: .uncertain))
            throw RemoteBackupOwnerError.executionUncertain
        }
        try await scheduler.finish(receipt)
        return receipt
    }
}
