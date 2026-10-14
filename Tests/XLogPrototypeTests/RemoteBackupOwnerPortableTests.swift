import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct RemoteBackupOwnerPortableTests {
    private let start = Date(timeIntervalSince1970: 10_000)

    private final class Clock: RemoteBackupClock, @unchecked Sendable {
        private let lock = NSLock()
        private var date: Date
        init(_ date: Date) { self.date = date }
        func now() -> Date { lock.withLock { date } }
        func set(_ date: Date) { lock.withLock { self.date = date } }
    }

    private actor Ticks: RemoteBackupTickSource {
        var calls = 0
        func nextTick() async throws -> Bool { calls += 1; return true }
    }

    private actor Source: RemoteBackupSnapshotSource {
        let envelope: XLogBackupEnvelope
        var captures = 0
        var blocked = false
        var fail = false
        var continuation: CheckedContinuation<Void, Never>?
        init(_ envelope: XLogBackupEnvelope, blocked: Bool = false) {
            self.envelope = envelope; self.blocked = blocked
        }
        func capture(workspaceGeneration: UUID, destination: RemoteBackupDestination) async throws -> XLogBackupEnvelope {
            captures += 1
            if fail { throw RemoteBackupPlanningError.invalidPackage }
            if blocked { await withCheckedContinuation { continuation = $0 } }
            return envelope
        }
        func release() { blocked = false; continuation?.resume(); continuation = nil }
        func setFailure(_ value: Bool) { fail = value }
    }

    private actor Executor: RemoteBackupClaimExecutor {
        var claims: [RemoteBackupDueClaim] = []
        let throwsError: Bool
        var failReceipt = false
        var blocked = false
        var continuation: CheckedContinuation<Void, Never>?
        init(throwsError: Bool = false) { self.throwsError = throwsError }
        func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
            claims.append(claim)
            if blocked { await withCheckedContinuation { continuation = $0 } }
            if throwsError { throw RemoteBackupPlanningError.invalidReceipt }
            if failReceipt { return try RemoteBackupUploadReceipt(plan: claim.plan, outcome: .failed) }
            return try RemoteBackupUploadReceipt(plan: claim.plan,
                outcome: .verified(package: claim.envelope.identity, at: claim.claimedAt))
        }
        func setFailedReceipt() { failReceipt = true }
        func block() { blocked = true }
        func release() { blocked = false; continuation?.resume(); continuation = nil }
    }

    private func fixture() throws -> (XLogBackupEnvelope, RemoteBackupUploadPlan, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-owner-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let database = try LogbookDatabase(url: root.appendingPathComponent("source.sqlite"))
        defer { database.close() }
        let manager = XLogBackupManager()
        let package = root.appendingPathComponent("test.xlogbackup")
        try manager.create(database: database, at: package, settings: .defaults,
            preferences: XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
                deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false))
        let envelope = try manager.prepareEnvelope(at: package)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "folder"), schedule: .every(hours: 1))
        // Deliberately different: the due snapshot replaces the placeholder identity.
        let placeholder = try RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1)
        return (envelope, try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: destination,
            backupID: UUID(), package: placeholder), root)
    }

    @Test func recurringDriverUsesFreshIdentityAndExactContextAcrossIntervals() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        let source = Source(envelope), executor = Executor(), ticks = Ticks(), clock = Clock(start)
        let owner = RemoteBackupOwner(scheduler: scheduler, source: source, executor: executor)
        let host = RemoteBackupHostDriver(scheduler: scheduler, owner: owner, clock: clock, ticks: ticks)
        #expect(try await host.advance() == nil)
        #expect(await ticks.calls == 0)
        try await host.start(plan: plan, recurring: true)
        #expect(try await host.advance() == nil)
        clock.set(start.addingTimeInterval(3_600))
        let first = try #require(try await host.advance())
        let placeholder = try #require(try await scheduler.currentPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination))
        #expect(placeholder.backupID != first.plan.backupID)
        #expect(placeholder.backupID != plan.backupID)
        #expect(placeholder.destination == plan.destination)
        #expect(placeholder.workspaceGeneration == plan.workspaceGeneration)
        #expect(try await scheduler.state(for: placeholder) == .enabled)
        let restarted = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        #expect(try await restarted.currentPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination) == placeholder)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await restarted.currentPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, destination: plan.destination)
        }
        #expect(try await host.advance() == nil)
        clock.set(start.addingTimeInterval(7_200))
        let second = try #require(try await host.advance())
        #expect(second.plan.backupID != first.plan.backupID)
        #expect(second.plan.backupID != placeholder.backupID)
        #expect(await source.captures == 2)
        #expect(await executor.claims.count == 2)
        try await host.stop()
        let stopped = try #require(try await scheduler.currentPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination))
        #expect(try await scheduler.state(for: stopped) == .disabled)
    }

    @Test(arguments: [false, true])
    func defaultOnceAndFailureNeverRearm(failed: Bool) async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        let executor = Executor(), clock = Clock(start)
        if failed { await executor.setFailedReceipt() }
        let owner = RemoteBackupOwner(scheduler: scheduler, source: Source(envelope), executor: executor)
        let host = RemoteBackupHostDriver(scheduler: scheduler, owner: owner, clock: clock, ticks: Ticks())
        try await host.start(plan: plan, recurring: failed)
        clock.set(start.addingTimeInterval(3_600))
        let receipt = try #require(try await host.advance())
        #expect(try await scheduler.state(for: receipt.plan) == .completed)
        #expect(try await host.advance() == nil)
        #expect(await executor.claims.count == 1)
        if failed {
            let forged = try RemoteBackupUploadReceipt(plan: receipt.plan,
                outcome: .verified(package: receipt.plan.package, at: clock.now()))
            await #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
                try await scheduler.rearm(after: forged, at: clock.now())
            }
        }
    }

    @Test func preparedClaimModeRejectsRecurringBeforeEnablingOrCapturing() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        let source = Source(envelope), ticks = Ticks()
        let owner = RemoteBackupOwner(scheduler: scheduler, source: source, executor: Executor(),
            claimMode: .preparedOneShot)
        let host = RemoteBackupHostDriver(scheduler: scheduler, owner: owner, clock: Clock(start), ticks: ticks)
        await #expect(throws: RemoteBackupPlanningError.invalidSchedule) {
            try await host.start(plan: plan, recurring: true)
        }
        #expect(try await scheduler.state(for: plan) == .disabled)
        #expect(await source.captures == 0)
        #expect(await ticks.calls == 0)
    }

    @Test func recurringUncertainOutcomeCannotRearm() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        let executor = Executor(throwsError: true), clock = Clock(start)
        let owner = RemoteBackupOwner(scheduler: scheduler, source: Source(envelope), executor: executor)
        let host = RemoteBackupHostDriver(scheduler: scheduler, owner: owner, clock: clock, ticks: Ticks())
        try await host.start(plan: plan, recurring: true)
        clock.set(start.addingTimeInterval(3_600))
        await #expect(throws: RemoteBackupOwnerError.executionUncertain) { try await host.advance() }
        let claim = try #require(await executor.claims.first)
        #expect(try await scheduler.state(for: claim.plan) == .uncertain)
        let forged = try RemoteBackupUploadReceipt(plan: claim.plan,
            outcome: .verified(package: claim.plan.package, at: clock.now()))
        #expect(try await scheduler.rearm(after: forged, at: clock.now()) == nil)
        #expect(try await host.advance() == nil)
        #expect(await executor.claims.count == 1)
    }

    @Test(arguments: [false, true])
    func stopOrClockJumpDuringExecutionPreventsRearm(stop: Bool) async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        let executor = Executor(), clock = Clock(start)
        await executor.block()
        let owner = RemoteBackupOwner(scheduler: scheduler, source: Source(envelope), executor: executor)
        let host = RemoteBackupHostDriver(scheduler: scheduler, owner: owner, clock: clock, ticks: Ticks())
        try await host.start(plan: plan, recurring: true)
        clock.set(start.addingTimeInterval(3_600))
        let task = Task { try await host.advance() }
        while await executor.continuation == nil { await Task.yield() }
        if stop { try await host.stop() }
        else { clock.set(start.addingTimeInterval(3_600 + 86_401)) }
        await executor.release()
        let receipt = try #require(try await task.value)
        #expect(try await scheduler.state(for: receipt.plan) == (stop ? .completed : .clockReviewRequired))
        #expect(try await scheduler.rearm(after: receipt, at: clock.now()) == nil)
        #expect(await executor.claims.count == 1)
    }

    @Test func defaultOffThenFreshFrozenClaimAndNoReplay() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        let source = Source(envelope), executor = Executor()
        let owner = RemoteBackupOwner(scheduler: scheduler, source: source, executor: executor)
        let due = start.addingTimeInterval(3_600)
        #expect(try await owner.tick(plan: plan, at: due) == nil)
        await owner.setRunning(true)
        #expect(try await owner.tick(plan: plan, at: due) == nil)
        _ = try await scheduler.enable(plan: plan, at: start)
        #expect(try await owner.tick(plan: plan, at: start) == nil)
        #expect(await source.captures == 0)
        let receipt = try #require(try await owner.tick(plan: plan, at: due))
        #expect(receipt.plan.backupID != plan.backupID)
        #expect(receipt.plan.package == envelope.identity)
        let claim = try #require(await executor.claims.first)
        #expect(claim.envelope.data == envelope.data)
        #expect(claim.dueAt == due)
        #expect(try await scheduler.state(for: receipt.plan) == .completed)
        let restarted = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        #expect(try await restarted.claimDue(envelope: envelope, plan: receipt.plan,
            workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination, at: due) == nil)
        #expect(await source.captures == 1)
        #expect(await executor.claims.count == 1)
    }

    @Test(arguments: [-1.0, 86_401.0])
    func clockReviewPrecedesCapture(delta: Double) async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        _ = try await scheduler.enable(plan: plan, at: start)
        let source = Source(envelope), executor = Executor()
        let owner = RemoteBackupOwner(scheduler: scheduler, source: source, executor: executor)
        await owner.setRunning(true)
        #expect(try await owner.tick(plan: plan, at: start.addingTimeInterval(delta)) == nil)
        #expect(try await scheduler.state(for: plan) == .clockReviewRequired)
        #expect(await source.captures == 0)
    }

    @Test func stopAndConcurrentTickCannotIssueDuringCapture() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        _ = try await scheduler.enable(plan: plan, at: start)
        let source = Source(envelope, blocked: true), executor = Executor()
        let owner = RemoteBackupOwner(scheduler: scheduler, source: source, executor: executor)
        await owner.setRunning(true)
        let due = start.addingTimeInterval(3_600)
        let tick = Task { try await owner.tick(plan: plan, at: due) }
        while await source.continuation == nil { await Task.yield() }
        #expect(try await owner.tick(plan: plan, at: due) == nil)
        await owner.setRunning(false)
        await source.release()
        #expect(try await tick.value == nil)
        #expect(await executor.claims.isEmpty)
        #expect(try await scheduler.state(for: plan) == .enabled)
    }

    @Test func thrownExecutorPersistsUncertainty() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        _ = try await scheduler.enable(plan: plan, at: start)
        let source = Source(envelope), executor = Executor(throwsError: true)
        let owner = RemoteBackupOwner(scheduler: scheduler, source: source, executor: executor)
        await owner.setRunning(true)
        await #expect(throws: RemoteBackupOwnerError.executionUncertain) {
            try await owner.tick(plan: plan, at: start.addingTimeInterval(3_600))
        }
        let claim = try #require(await executor.claims.first)
        let restarted = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        #expect(try await restarted.state(for: claim.plan) == .uncertain)
        await #expect(throws: RemoteBackupSchedulerError.operationInProgress) {
            try await restarted.enable(plan: plan, at: start)
        }
    }

    @Test func captureFailureDoesNotReserveAndCanBeRetried() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root.appendingPathComponent("state"))
        _ = try await scheduler.enable(plan: plan, at: start)
        let source = Source(envelope), executor = Executor()
        let owner = RemoteBackupOwner(scheduler: scheduler, source: source, executor: executor)
        await owner.setRunning(true)
        await source.setFailure(true)
        let due = start.addingTimeInterval(3_600)
        await #expect(throws: RemoteBackupPlanningError.invalidPackage) {
            try await owner.tick(plan: plan, at: due)
        }
        #expect(try await scheduler.state(for: plan) == .enabled)
        #expect(await executor.claims.isEmpty)
        await source.setFailure(false)
        #expect(try await owner.tick(plan: plan, at: due) != nil)
    }

    @Test func concurrentFreshClaimsIssueOnceAcrossSchedulers() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("state")
        let first = try RemoteBackupScheduler(stateDirectory: directory)
        let second = try RemoteBackupScheduler(stateDirectory: directory)
        _ = try await first.enable(plan: plan, at: start)
        let due = start.addingTimeInterval(3_600)
        let count = await withTaskGroup(of: Int.self) { group in
            for scheduler in [first, second] {
                group.addTask {
                    do {
                        return try await scheduler.claimFreshDue(envelope: envelope, scheduledPlan: plan,
                            workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination, at: due) == nil ? 0 : 1
                    } catch { return 0 }
                }
            }
            var total = 0
            for await value in group { total += value }
            return total
        }
        #expect(count == 1)
    }

    @Test func interruptedFreshReservationBlocksAnotherFreshID() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("state")
        let scheduler = try RemoteBackupScheduler(stateDirectory: directory)
        _ = try await scheduler.enable(plan: plan, at: start)
        let fresh = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination,
            backupID: UUID(), package: envelope.identity)
        let store = try RemoteBackupOperationStore(directory: directory.appendingPathComponent("claims"))
        _ = try store.reserve(plan: fresh)
        #expect(try await scheduler.claimFreshDue(envelope: envelope, scheduledPlan: plan,
            workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination, at: start.addingTimeInterval(3_600)) == nil)
        #expect(try await scheduler.state(for: plan) == .uncertain)
    }
}
