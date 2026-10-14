import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct RemoteBackupSchedulerPortableTests {
    private let start = Date(timeIntervalSince1970: 10_000)

    private func fixture() throws -> (XLogBackupEnvelope, RemoteBackupUploadPlan, URL) {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-schedule-source-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: source) }
        let database = try LogbookDatabase(url: source.appendingPathComponent("source.sqlite"))
        defer { database.close() }
        let manager = XLogBackupManager()
        let package = source.appendingPathComponent("test.xlogbackup")
        try manager.create(database: database, at: package, settings: .defaults,
            preferences: XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
                deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false))
        let envelope = try manager.prepareEnvelope(at: package)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "folder"), schedule: .every(hours: 1))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: destination,
            backupID: UUID(), package: envelope.identity)
        return (envelope, plan, FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scheduler-\(UUID().uuidString)"))
    }

    private func claim(_ scheduler: RemoteBackupScheduler, _ envelope: XLogBackupEnvelope,
                       _ plan: RemoteBackupUploadPlan, at date: Date) async throws -> RemoteBackupDueClaim? {
        try await scheduler.claimDue(envelope: envelope, plan: plan, workspaceGeneration: plan.workspaceGeneration,
            destination: plan.destination, at: date)
    }

    @Test func defaultOffAndDeterministicDueClaimSurviveRestart() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let initial = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await initial.state(for: plan) == .disabled)
        #expect(try await claim(initial, envelope, plan, at: start.addingTimeInterval(7_200)) == nil)
        let due = try await initial.enable(plan: plan, at: start)
        #expect(due == start.addingTimeInterval(3_600))
        #expect(try await initial.enable(plan: plan, at: start.addingTimeInterval(30)) == due)
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await claim(restarted, envelope, plan, at: due.addingTimeInterval(-1)) == nil)
        let value = try #require(try await claim(restarted, envelope, plan, at: due))
        #expect(value.plan == plan)
        #expect(value.envelope.data == envelope.data)
        #expect(value.dueAt == due)
        #expect(value.claimedAt == due)
        #expect(try await claim(initial, envelope, plan, at: due) == nil)
        let afterClaim = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await afterClaim.state(for: plan) == .claimed)
        #expect(try await claim(afterClaim, envelope, plan, at: due) == nil)
    }

    @Test func disableIsDurableAndNoIntervalCannotEnable() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        try await scheduler.disable(plan: plan)
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await restarted.state(for: plan) == .disabled)
        #expect(try await claim(restarted, envelope, plan, at: start.addingTimeInterval(7_200)) == nil)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "folder"))
        let disabledPlan = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: destination,
            backupID: UUID(), package: envelope.identity)
        await #expect(throws: RemoteBackupPlanningError.invalidSchedule) {
            try await restarted.enable(plan: disabledPlan, at: start)
        }
    }

    @Test(arguments: [-1.0, 86_401.0])
    func clockAnomaliesRequireExplicitReenable(delta: Double) async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        #expect(try await claim(scheduler, envelope, plan, at: start.addingTimeInterval(delta)) == nil)
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await restarted.state(for: plan) == .clockReviewRequired)
        #expect(try await claim(restarted, envelope, plan, at: start.addingTimeInterval(3_600)) == nil)
        let newStart = start.addingTimeInterval(90_000)
        #expect(try await restarted.enable(plan: plan, at: newStart) == newStart.addingTimeInterval(3_600))
        #expect(try await claim(restarted, envelope, plan, at: newStart) == nil)
    }

    @Test func unfinishedOrUncertainWorkBlocksReplacementAndReplay() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        _ = try #require(try await claim(scheduler, envelope, plan, at: start.addingTimeInterval(3_600)))
        let next = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: plan.destination,
            backupID: UUID(), package: envelope.identity)
        await #expect(throws: RemoteBackupSchedulerError.operationInProgress) {
            try await scheduler.enable(plan: next, at: start)
        }
        try await scheduler.finish(RemoteBackupUploadReceipt(plan: plan, outcome: .uncertain))
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await restarted.state(for: plan) == .uncertain)
        #expect(try await claim(restarted, envelope, plan, at: start.addingTimeInterval(3_600)) == nil)
        await #expect(throws: RemoteBackupSchedulerError.operationInProgress) {
            try await restarted.enable(plan: next, at: start)
        }
    }

    @Test func completedWorkRequiresFreshPlanAndCannotReuseClaimedID() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        _ = try #require(try await claim(scheduler, envelope, plan, at: start.addingTimeInterval(3_600)))
        try await scheduler.finish(RemoteBackupUploadReceipt(plan: plan, outcome: .verified(package: plan.package, at: start)))
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await restarted.state(for: plan) == .completed)
        await #expect(throws: RemoteBackupSchedulerError.alreadyClaimed) { try await restarted.enable(plan: plan, at: start) }
        let next = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: plan.destination,
            backupID: UUID(), package: envelope.identity)
        let nextDue = try await restarted.enable(plan: next, at: start.addingTimeInterval(3_600))
        _ = try #require(try await claim(restarted, envelope, next, at: nextDue))
        try await restarted.finish(RemoteBackupUploadReceipt(plan: next, outcome: .failed))
        await #expect(throws: RemoteBackupSchedulerError.alreadyClaimed) { try await restarted.enable(plan: plan, at: nextDue) }
    }

    @Test func abandonedLockAndCorruptScheduleFailClosed() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        let lock = root.appendingPathComponent(plan.destination.id.uuidString.lowercased() + ".lock")
        try Data().write(to: lock, options: .withoutOverwriting)
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        await #expect(throws: RemoteBackupSchedulerError.operationInProgress) {
            try await claim(restarted, envelope, plan, at: start.addingTimeInterval(3_600))
        }
        try FileManager.default.removeItem(at: lock)
        let record = root.appendingPathComponent(plan.destination.id.uuidString.lowercased() + ".schedule.json")
        try Data("{".utf8).write(to: record, options: .atomic)
        await #expect(throws: RemoteBackupPersistenceError.invalidState) {
            try await claim(restarted, envelope, plan, at: start.addingTimeInterval(3_600))
        }
    }

    @Test func reservationBeforeInterruptedClaimSaveNeverReplays() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        let claims = try RemoteBackupOperationStore(directory: root.appendingPathComponent("claims"))
        _ = try claims.reserve(plan: plan)
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        #expect(try await claim(restarted, envelope, plan, at: start.addingTimeInterval(3_600)) == nil)
        #expect(try await restarted.state(for: plan) == .uncertain)
    }

    @Test func concurrentOwnersIssueOnlyOneClaim() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try RemoteBackupScheduler(stateDirectory: root)
        let second = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await first.enable(plan: plan, at: start)
        let due = start.addingTimeInterval(3_600)
        let count = await withTaskGroup(of: Int.self) { group in
            for owner in [first, second] {
                group.addTask {
                    do { return try await claim(owner, envelope, plan, at: due) == nil ? 0 : 1 }
                    catch RemoteBackupSchedulerError.operationInProgress { return 0 }
                    catch { Issue.record("Unexpected claim failure: \(error)"); return 0 }
                }
            }
            var count = 0
            for await value in group { count += value }
            return count
        }
        #expect(count == 1)
        #expect(try await first.state(for: plan) == .claimed)
    }

    @Test func missingScheduleCannotHideAnUnknownDestinationClaim() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        _ = try #require(try await claim(scheduler, envelope, plan, at: start.addingTimeInterval(3_600)))
        try FileManager.default.removeItem(at: root.appendingPathComponent(plan.destination.id.uuidString.lowercased() + ".schedule.json"))
        let restarted = try RemoteBackupScheduler(stateDirectory: root)
        let next = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: plan.destination,
            backupID: UUID(), package: envelope.identity)
        await #expect(throws: RemoteBackupSchedulerError.operationInProgress) {
            try await restarted.enable(plan: next, at: start)
        }
        #expect(try await claim(restarted, envelope, next, at: start.addingTimeInterval(3_600)) == nil)
    }

    @Test func staleContextAndInvalidClockNeverClaim() async throws {
        let (envelope, plan, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let scheduler = try RemoteBackupScheduler(stateDirectory: root)
        _ = try await scheduler.enable(plan: plan, at: start)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await scheduler.claimDue(envelope: envelope, plan: plan, workspaceGeneration: 2,
                destination: plan.destination, at: start.addingTimeInterval(3_600))
        }
        await #expect(throws: RemoteBackupSchedulerError.invalidClock) {
            try await scheduler.claimDue(envelope: envelope, plan: plan, workspaceGeneration: 1,
                destination: plan.destination, at: Date(timeIntervalSince1970: .infinity))
        }
        #expect(try await scheduler.state(for: plan) == .enabled)
    }
}

