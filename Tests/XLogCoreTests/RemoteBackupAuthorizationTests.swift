import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct RemoteBackupAuthorizationTests {
    private final class Workspace: RemoteBackupWorkspaceGenerationSource, @unchecked Sendable {
        private let lock = NSRecursiveLock()
        private var current = UUID()
        func withCurrentWorkspaceGeneration<T: Sendable>(_ body: (UUID) throws -> T) throws -> T {
            try lock.withLock { try body(current) }
        }
        func rotate() -> UUID { lock.withLock { current = UUID(); return current } }
    }

    private func plan(_ generation: UUID, destination: RemoteBackupDestination? = nil) throws -> RemoteBackupUploadPlan {
        let destination = try destination ?? RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "test-folder"), schedule: .every(hours: 1))
        return try RemoteBackupUploadPlan(workspaceGeneration: generation, destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(sha256: String(repeating: "a", count: 64), byteCount: 42))
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("xlog-backup-authorization-\(UUID().uuidString)")
    }

    @Test func defaultOffAndExactApprovalSurviveRestart() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = Workspace()
        let generation = try workspace.withCurrentWorkspaceGeneration { $0 }
        let owner = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        #expect(try await owner.state() == RemoteBackupAuthorizationState(workspaceGeneration: generation,
            configurationRevision: 0, authorization: nil))
        let approved = try plan(generation)
        let grant = try await owner.approve(plan: approved, expectedConfigurationRevision: 0)
        #expect(!grant.recurring)
        #expect(grant.workspaceGeneration == generation)
        #expect(grant.destination == approved.destination)
        let restarted = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        #expect(try await restarted.state().authorization == grant)
        try await restarted.validate(plan: approved, authorization: grant)
        let fresh = try plan(generation, destination: approved.destination)
        #expect(fresh.backupID != approved.backupID)
        try await restarted.validate(plan: fresh, authorization: grant)
    }

    @Test func explicitRecurrenceRevisionAndDestinationFences() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = Workspace()
        let generation = try workspace.withCurrentWorkspaceGeneration { $0 }
        let owner = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        let initial = try plan(generation)
        let grant = try await owner.approve(plan: initial, expectedConfigurationRevision: 0, recurring: true)
        #expect(grant.recurring)
        let destination = initial.destination
        let revised = try RemoteBackupDestination(id: destination.id, revision: 2, provider: destination.provider,
            accountID: destination.accountID, location: destination.location, schedule: destination.schedule)
        let next = try plan(generation, destination: revised)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await owner.validate(plan: next, authorization: grant)
        }
        await #expect(throws: RemoteBackupAuthorizationError.staleRevision) {
            try await owner.approve(plan: next, expectedConfigurationRevision: 0)
        }
        let replacement = try await owner.approve(plan: next, expectedConfigurationRevision: 1)
        #expect(!replacement.recurring)
        #expect(replacement.configurationRevision == 2)
        await #expect(throws: RemoteBackupAuthorizationError.notAuthorized) {
            try await owner.validate(plan: initial, authorization: grant)
        }
        try await owner.validate(plan: next, authorization: replacement)
    }

    @Test func workspaceRotationInvalidatesOldConsentAndPlans() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = Workspace()
        let oldGeneration = try workspace.withCurrentWorkspaceGeneration { $0 }
        let owner = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        let initial = try plan(oldGeneration)
        let grant = try await owner.approve(plan: initial, expectedConfigurationRevision: 0, recurring: true)
        let newGeneration = workspace.rotate()
        #expect(try await owner.state().workspaceGeneration == newGeneration)
        #expect(try await owner.state().authorization == nil)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await owner.validate(plan: initial, authorization: grant)
        }
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await owner.approve(plan: initial, expectedConfigurationRevision: 1)
        }
        let replacementPlan = try plan(newGeneration, destination: initial.destination)
        let replacement = try await owner.approve(plan: replacementPlan, expectedConfigurationRevision: 1)
        #expect(!replacement.recurring)
        let restarted = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        try await restarted.validate(plan: replacementPlan, authorization: replacement)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await restarted.validate(plan: initial, authorization: grant)
        }
    }

    @Test func revocationIsDurableAndCannotBeOverwrittenByStaleOwner() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = Workspace()
        let generation = try workspace.withCurrentWorkspaceGeneration { $0 }
        let owner = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        let initial = try plan(generation)
        let grant = try await owner.approve(plan: initial, expectedConfigurationRevision: 0)
        try await owner.revoke(expectedWorkspaceGeneration: generation, expectedConfigurationRevision: 1)
        let restarted = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        #expect(try await restarted.state().configurationRevision == 2)
        #expect(try await restarted.state().authorization == nil)
        await #expect(throws: RemoteBackupAuthorizationError.notAuthorized) {
            try await restarted.validate(plan: initial, authorization: grant)
        }
        await #expect(throws: RemoteBackupAuthorizationError.staleRevision) {
            try await owner.approve(plan: initial, expectedConfigurationRevision: 1)
        }
    }

    @Test func independentOwnersCannotApproveTheSameConfigurationRevisionTwice() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = Workspace()
        let generation = try workspace.withCurrentWorkspaceGeneration { $0 }
        let initial = try plan(generation)
        let first = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        let second = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        let count = await withTaskGroup(of: Int.self) { group in
            for owner in [first, second] {
                group.addTask {
                    do {
                        _ = try await owner.approve(plan: initial, expectedConfigurationRevision: 0)
                        return 1
                    } catch { return 0 }
                }
            }
            var total = 0
            for await value in group { total += value }
            return total
        }
        #expect(count == 1)
        #expect(try await first.state().configurationRevision == 1)
    }

    @Test func corruptConfigurationAndAbandonedLockFailClosed() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = Workspace()
        let generation = try workspace.withCurrentWorkspaceGeneration { $0 }
        let owner = try RemoteBackupAuthorizationOwner(workspace: workspace, stateDirectory: root)
        _ = try await owner.approve(plan: plan(generation), expectedConfigurationRevision: 0)
        let marker = root.appendingPathComponent("authorization.lock")
        try Data().write(to: marker, options: .withoutOverwriting)
        await #expect(throws: RemoteBackupSchedulerError.operationInProgress) { try await owner.state() }
        try FileManager.default.removeItem(at: marker)
        try Data("{".utf8).write(to: root.appendingPathComponent("authorization.json"))
        await #expect(throws: RemoteBackupPersistenceError.invalidState) { try await owner.state() }
    }

    @Test func legacyNumericOperationAndScheduleRecordsNeverAcquireUUIDAuthority() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let currentPlan = try plan(UUID())
        let operations = root.appendingPathComponent("uploads")
        let store = try RemoteBackupOperationStore(directory: operations)
        _ = try store.reserve(plan: currentPlan)
        let operationURL = operations.appendingPathComponent(currentPlan.backupID.uuidString.lowercased() + ".json")
        var document = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: operationURL)) as? [String: Any])
        var operation = try #require(document["operation"] as? [String: Any])
        operation["workspaceGeneration"] = 1
        document["version"] = 1; document["operation"] = operation
        document["sha256"] = BackupPackageSeal.hash(try JSONSerialization.data(withJSONObject: operation, options: .sortedKeys))
        try JSONSerialization.data(withJSONObject: document, options: .sortedKeys).write(to: operationURL)
        try LocalFilePermissions.protectFile(operationURL)
        #expect(throws: RemoteBackupPersistenceError.invalidState) {
            try RemoteBackupUploadCoordinator(stateDirectory: operations)
        }
        let schedules = root.appendingPathComponent("schedules")
        let scheduler = try RemoteBackupScheduler(stateDirectory: schedules)
        _ = try await scheduler.enable(plan: currentPlan, at: Date(timeIntervalSince1970: 10_000))
        let scheduleURL = schedules.appendingPathComponent(currentPlan.destination.id.uuidString.lowercased() + ".schedule.json")
        var schedule = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: scheduleURL)) as? [String: Any])
        schedule["version"] = 1
        try JSONSerialization.data(withJSONObject: schedule, options: .sortedKeys).write(to: scheduleURL)
        try LocalFilePermissions.protectFile(scheduleURL)
        await #expect(throws: RemoteBackupPersistenceError.invalidState) { try await scheduler.state(for: currentPlan) }
    }
}
