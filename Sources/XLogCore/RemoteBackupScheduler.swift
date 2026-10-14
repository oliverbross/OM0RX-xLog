import Foundation

public enum RemoteBackupScheduleState: String, Codable, Equatable, Sendable {
    case disabled, enabled, claimed, completed, uncertain, clockReviewRequired
}

public enum RemoteBackupSchedulerError: Error, Equatable, Sendable {
    case operationInProgress, alreadyClaimed, invalidClock
}

/// The scheduler hands frozen content to an executor, never package URLs.
/// A claim is issued once; persistently unknown prior work cannot be reclaimed.
public struct RemoteBackupDueClaim: Sendable {
    public let plan: RemoteBackupUploadPlan
    public let envelope: XLogBackupEnvelope
    public let dueAt: Date
    public let claimedAt: Date
}

/// Durable, explicitly enabled schedule lanes, one active plan per destination ID.
/// Each run needs a fresh immutable plan. Verified completion can carry explicit
/// recurring consent into its next interval; snapshot capture belongs to the injected
/// backup owner. This type performs no networking or restore work.
public actor RemoteBackupScheduler {
    /// A gap over one day requires clock review, including legitimate long suspends.
    /// Longer configured intervals therefore require observations at least daily.
    public static let maximumObservationGap: TimeInterval = 86_400
    private let metadata: RemoteBackupOperationStore
    private let claims: RemoteBackupOperationStore

    public init(stateDirectory: URL) throws {
        metadata = try RemoteBackupOperationStore(directory: stateDirectory)
        claims = try RemoteBackupOperationStore(directory: stateDirectory.appendingPathComponent("claims"))
    }

    public func state(for plan: RemoteBackupUploadPlan) throws -> RemoteBackupScheduleState {
        try locked(plan.destination.id) {
            guard let record = try read(plan.destination.id) else { return .disabled }
            try record.validate(plan)
            return record.state
        }
    }

    /// Explicit consent is required even when the destination has a configured interval.
    /// Repeating enable for an already-enabled identical plan does not postpone its due time.
    @discardableResult
    public func enable(plan: RemoteBackupUploadPlan, at now: Date, recurring: Bool = false) throws -> Date {
        try validateClock(now)
        guard let hours = plan.destination.schedule.intervalHours else { throw RemoteBackupPlanningError.invalidSchedule }
        return try locked(plan.destination.id) {
            if var current = try read(plan.destination.id) {
                switch current.state {
                case .claimed, .uncertain: throw RemoteBackupSchedulerError.operationInProgress
                case .enabled:
                    try current.validate(plan)
                    current.recurring = recurring
                    try save(current)
                    return current.dueAt!
                case .completed:
                    guard try current.plan().backupID != plan.backupID else { throw RemoteBackupSchedulerError.alreadyClaimed }
                case .disabled, .clockReviewRequired: break
                }
            }
            let priorClaims = try claims.load()
            guard !priorClaims.contains(where: {
                guard $0.plan.destination.id == plan.destination.id else { return false }
                if case .uncertain = $0.outcome { return true }
                return false
            }) else { throw RemoteBackupSchedulerError.operationInProgress }
            guard !priorClaims.contains(where: { $0.plan.backupID == plan.backupID }) else {
                throw RemoteBackupSchedulerError.alreadyClaimed
            }
            let due = now.addingTimeInterval(TimeInterval(hours) * 3_600)
            try validateClock(due)
            try save(Record(operation: RemoteBackupStoredOperation(plan: plan, outcome: nil), state: .enabled,
                enabledAt: now, dueAt: due, lastObservedAt: now, recurring: recurring))
            return due
        }
    }

    public func disable(plan: RemoteBackupUploadPlan) throws {
        try locked(plan.destination.id) {
            guard var record = try read(plan.destination.id) else { return }
            try record.validate(plan)
            guard record.state == .enabled || record.state == .clockReviewRequired || record.state == .disabled else {
                throw RemoteBackupSchedulerError.operationInProgress
            }
            record.state = .disabled
            record.recurring = false
            record.enabledAt = nil; record.dueAt = nil; record.lastObservedAt = nil
            try save(record)
        }
    }

    /// Read only within the caller's exact approved workspace/destination context.
    /// This lets a host recover the fresh placeholder after a successful rearm.
    public func currentPlan(workspaceGeneration: UInt64, destination: RemoteBackupDestination) throws -> RemoteBackupUploadPlan? {
        try locked(destination.id) {
            guard let record = try read(destination.id) else { return nil }
            let plan = try record.plan()
            try plan.validate(workspaceGeneration: workspaceGeneration, destination: destination)
            return plan
        }
    }

    /// Revoke recurrence even while a claimed executor finishes. Reloading under the
    /// lane lock also covers a rearm that won the race with the host's stop request.
    public func stopRecurrence(workspaceGeneration: UInt64, destination: RemoteBackupDestination) throws {
        try locked(destination.id) {
            guard var record = try read(destination.id) else { return }
            try record.plan().validate(workspaceGeneration: workspaceGeneration, destination: destination)
            record.recurring = false
            if record.state == .enabled {
                record.state = .disabled
                record.enabledAt = nil; record.dueAt = nil; record.lastObservedAt = nil
            }
            try save(record)
        }
    }

    /// Only a durably recorded verified receipt may carry explicit recurring consent
    /// forward. Failed, uncertain, interrupted and clock-review lanes cannot rearm.
    @discardableResult
    public func rearm(after receipt: RemoteBackupUploadReceipt, at now: Date) throws -> RemoteBackupUploadPlan? {
        try validateClock(now)
        return try locked(receipt.plan.destination.id) {
            guard var record = try read(receipt.plan.destination.id) else { return nil }
            try record.validate(receipt.plan)
            guard record.state == .completed, record.recurring == true,
                  case .verified = receipt.outcome else { return nil }
            let history = try claims.load()
            guard history.contains(receipt), !history.contains(where: {
                guard $0.plan.destination.id == receipt.plan.destination.id else { return false }
                if case .uncertain = $0.outcome { return true }
                return false
            }) else { throw RemoteBackupPlanningError.invalidReceipt }
            let gap = now.timeIntervalSince(record.lastObservedAt!)
            guard gap >= 0, gap <= Self.maximumObservationGap else {
                record.state = .clockReviewRequired
                try save(record)
                return nil
            }
            let next = try RemoteBackupUploadPlan(workspaceGeneration: receipt.plan.workspaceGeneration,
                destination: receipt.plan.destination, backupID: UUID(), package: receipt.plan.package)
            let due = now.addingTimeInterval(TimeInterval(next.destination.schedule.intervalHours!) * 3_600)
            try validateClock(due)
            record.operation = RemoteBackupStoredOperation(plan: next, outcome: nil)
            record.state = .enabled
            record.enabledAt = now; record.dueAt = due; record.lastObservedAt = now
            try save(record)
            return next
        }
    }

    /// Caller supplies the current owner context and a fresh, already validated envelope.
    /// Clock anomalies durably suspend the lane; explicit enablement starts a new interval.
    public func claimDue(envelope: XLogBackupEnvelope, plan: RemoteBackupUploadPlan,
                         workspaceGeneration: UInt64, destination: RemoteBackupDestination,
                         at now: Date) throws -> RemoteBackupDueClaim? {
        try claim(envelope: envelope, plan: plan, scheduledPlan: plan,
            workspaceGeneration: workspaceGeneration, destination: destination, at: now)
    }

    /// Observe clocks even before a snapshot is needed. Observation never reserves work.
    public func observeDue(plan: RemoteBackupUploadPlan, at now: Date) throws -> Bool {
        try validateClock(now)
        return try locked(plan.destination.id) {
            guard var record = try read(plan.destination.id) else { return false }
            try record.validate(plan)
            let due = observe(&record, at: now)
            try save(record)
            return due
        }
    }

    /// Swap the approved lane's placeholder package for fresh sealed bytes atomically,
    /// preserving its consent, destination, generation and due time.
    public func claimFreshDue(envelope: XLogBackupEnvelope, scheduledPlan: RemoteBackupUploadPlan,
                              workspaceGeneration: UInt64, destination: RemoteBackupDestination,
                              at now: Date) throws -> RemoteBackupDueClaim? {
        try scheduledPlan.validate(workspaceGeneration: workspaceGeneration, destination: destination)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: workspaceGeneration,
            destination: destination, backupID: UUID(), package: envelope.identity)
        return try claim(envelope: envelope, plan: plan, scheduledPlan: scheduledPlan,
            workspaceGeneration: workspaceGeneration, destination: destination, at: now)
    }

    private func observe(_ record: inout Record, at now: Date) -> Bool {
        guard record.state == .enabled else { return false }
        let gap = now.timeIntervalSince(record.lastObservedAt!)
        if gap < 0 || gap > Self.maximumObservationGap {
            record.state = .clockReviewRequired
            return false
        }
        record.lastObservedAt = now
        return now >= record.dueAt!
    }

    private func claim(envelope: XLogBackupEnvelope, plan: RemoteBackupUploadPlan,
                       scheduledPlan: RemoteBackupUploadPlan, workspaceGeneration: UInt64,
                       destination: RemoteBackupDestination, at now: Date) throws -> RemoteBackupDueClaim? {
        try validateClock(now)
        try envelope.validate(for: plan, workspaceGeneration: workspaceGeneration, destination: destination)
        return try locked(plan.destination.id) {
            guard var record = try read(plan.destination.id) else { return nil }
            try record.validate(scheduledPlan)
            guard observe(&record, at: now) else { try save(record); return nil }
            // A fresh UUID must not bypass a reservation left by an interrupted
            // snapshot claim before its replacement lane record could be saved.
            if try claims.load().contains(where: {
                guard $0.plan.destination.id == plan.destination.id else { return false }
                if case .uncertain = $0.outcome { return true }
                return false
            }) {
                record.state = .uncertain
                try save(record)
                return nil
            }
            // Reserve before handing out bytes. If saving the lane then fails, this
            // durable reservation still prevents replay by another owner or restart.
            if try claims.reserve(plan: plan) != nil {
                record.state = .uncertain
                try save(record)
                return nil
            }
            record.operation = RemoteBackupStoredOperation(plan: plan, outcome: nil)
            record.state = .claimed
            try save(record)
            return RemoteBackupDueClaim(plan: plan, envelope: envelope, dueAt: record.dueAt!, claimedAt: now)
        }
    }

    /// Only an exact receipt can complete a claimed lane. Uncertainty keeps it blocked.
    public func finish(_ receipt: RemoteBackupUploadReceipt) throws {
        try locked(receipt.plan.destination.id) {
            guard var record = try read(receipt.plan.destination.id) else { throw RemoteBackupPlanningError.staleContext }
            try record.validate(receipt.plan)
            guard record.state == .claimed else { throw RemoteBackupSchedulerError.operationInProgress }
            try claims.complete(receipt)
            if case .uncertain = receipt.outcome { record.state = .uncertain }
            else { record.state = .completed }
            try save(record)
        }
    }

    private func validateClock(_ date: Date) throws {
        guard date.timeIntervalSince1970.isFinite else { throw RemoteBackupSchedulerError.invalidClock }
    }

    private func recordURL(_ id: UUID) -> URL {
        metadata.directory.appendingPathComponent(id.uuidString.lowercased() + ".schedule.json")
    }

    /// An abandoned lock is deliberately never stolen: prior work needs explicit review.
    /// Every owner reloads under this exclusive marker, so cached state cannot double-run.
    private func locked<T>(_ destinationID: UUID, _ body: () throws -> T) throws -> T {
        try metadata.validateDirectory()
        let files = try FileManager.default.contentsOfDirectory(at: metadata.directory, includingPropertiesForKeys: nil)
        guard files.count <= RemoteBackupOperationStore.maximumOperations * 2 + 1 else {
            throw RemoteBackupPersistenceError.capacityReached
        }
        let marker = metadata.directory.appendingPathComponent(destinationID.uuidString.lowercased() + ".lock")
        do { try Data().write(to: marker, options: .withoutOverwriting) }
        catch { throw RemoteBackupSchedulerError.operationInProgress }
        defer { try? FileManager.default.removeItem(at: marker) }
        do { try LocalFilePermissions.protectFile(marker) }
        catch { throw RemoteBackupPersistenceError.unavailable }
        return try body()
    }

    private func read(_ destinationID: UUID) throws -> Record? {
        let url = recordURL(destinationID)
        do {
            // Checking directory entries also detects dangling links, unlike fileExists.
            let names = try FileManager.default.contentsOfDirectory(atPath: metadata.directory.path)
            guard names.contains(url.lastPathComponent) else { return nil }
            let data = try metadata.read(url, maximum: RemoteBackupOperationStore.maximumRecordBytes)
            let document = try JSONDecoder().decode(Document.self, from: data)
            guard document.version == 1,
                  document.sha256 == BackupPackageSeal.hash(try BackupPackageSeal.encode(document.record)) else {
                throw RemoteBackupPersistenceError.invalidState
            }
            let plan = try document.record.plan()
            guard plan.destination.id == destinationID else { throw RemoteBackupPersistenceError.invalidState }
            try document.record.validateDates()
            return document.record
        } catch { throw RemoteBackupPersistenceError.invalidState }
    }

    private func save(_ record: Record) throws {
        do {
            let plan = try record.plan()
            try record.validateDates()
            let data = try BackupPackageSeal.encode(Document(version: 1, record: record,
                sha256: BackupPackageSeal.hash(try BackupPackageSeal.encode(record))))
            guard data.count <= RemoteBackupOperationStore.maximumRecordBytes else { throw RemoteBackupPersistenceError.capacityReached }
            let url = recordURL(plan.destination.id)
            try data.write(to: url, options: .atomic)
            try LocalFilePermissions.protectFile(url)
        } catch let error as RemoteBackupPersistenceError { throw error }
        catch { throw RemoteBackupPersistenceError.unavailable }
    }

    private struct Document: Codable {
        let version: Int
        let record: Record
        let sha256: String
    }

    private struct Record: Codable {
        var operation: RemoteBackupStoredOperation
        var state: RemoteBackupScheduleState
        var enabledAt: Date?
        var dueAt: Date?
        var lastObservedAt: Date?
        // Missing in version-1 records means no recurring consent.
        var recurring: Bool? = nil

        func plan() throws -> RemoteBackupUploadPlan {
            guard operation.status == "pending", operation.verifiedAt == nil else { throw RemoteBackupPersistenceError.invalidState }
            return try operation.receipt().plan
        }

        func validate(_ expected: RemoteBackupUploadPlan) throws {
            guard try plan() == expected else { throw RemoteBackupPlanningError.staleContext }
        }

        func validateDates() throws {
            let plan = try plan()
            if state == .disabled {
                guard enabledAt == nil, dueAt == nil, lastObservedAt == nil else { throw RemoteBackupPersistenceError.invalidState }
                return
            }
            guard let hours = plan.destination.schedule.intervalHours, let enabledAt, let dueAt, let lastObservedAt,
                  [enabledAt, dueAt, lastObservedAt].allSatisfy({ $0.timeIntervalSince1970.isFinite }),
                  dueAt == enabledAt.addingTimeInterval(TimeInterval(hours) * 3_600), lastObservedAt >= enabledAt else {
                throw RemoteBackupPersistenceError.invalidState
            }
            if state == .claimed || state == .completed || state == .uncertain {
                guard lastObservedAt >= dueAt else { throw RemoteBackupPersistenceError.invalidState }
            }
        }
    }
}
