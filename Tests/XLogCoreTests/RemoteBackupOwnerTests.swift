import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct RemoteBackupOwnerTests {
    private let start = Date(timeIntervalSince1970: 10_000)

    private actor Source: RemoteBackupSnapshotSource {
        let envelope: XLogBackupEnvelope
        var captures = 0
        var blocked = false
        var fail = false
        var continuation: CheckedContinuation<Void, Never>?
        init(_ envelope: XLogBackupEnvelope, blocked: Bool = false) {
            self.envelope = envelope; self.blocked = blocked
        }
        func capture(workspaceGeneration: UInt64, destination: RemoteBackupDestination) async throws -> XLogBackupEnvelope {
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
        init(throwsError: Bool = false) { self.throwsError = throwsError }
        func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
            claims.append(claim)
            if throwsError { throw RemoteBackupPlanningError.invalidReceipt }
            return try RemoteBackupUploadReceipt(plan: claim.plan,
                outcome: .verified(package: claim.envelope.identity, at: claim.claimedAt))
        }
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
        return (envelope, try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: destination,
            backupID: UUID(), package: placeholder), root)
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
            workspaceGeneration: 1, destination: plan.destination, at: due) == nil)
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
                            workspaceGeneration: 1, destination: plan.destination, at: due) == nil ? 0 : 1
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
        let fresh = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: plan.destination,
            backupID: UUID(), package: envelope.identity)
        let store = try RemoteBackupOperationStore(directory: directory.appendingPathComponent("claims"))
        _ = try store.reserve(plan: fresh)
        #expect(try await scheduler.claimFreshDue(envelope: envelope, scheduledPlan: plan,
            workspaceGeneration: 1, destination: plan.destination, at: start.addingTimeInterval(3_600)) == nil)
        #expect(try await scheduler.state(for: plan) == .uncertain)
    }
}
