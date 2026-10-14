import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct RemoteBackupLocalAdapterPortableTests {
    private actor Workspace: RemoteBackupWorkspaceSnapshotSource {
        nonisolated let database: LogbookDatabase
        let destination: RemoteBackupDestination
        var generation: UInt64 = 1
        var settings = XLogSettings.defaults
        var preferences = XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
            deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
            intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false)
        var cancelAfter = false
        var captures = 0

        init(database: LogbookDatabase, destination: RemoteBackupDestination) {
            self.database = database; self.destination = destination
        }

        func withActiveSnapshot<T: Sendable>(workspaceGeneration: UInt64, destination: RemoteBackupDestination,
            capture: @Sendable (RemoteBackupWorkspaceSnapshot) throws -> T) async throws -> T {
            captures += 1
            let result = try capture(RemoteBackupWorkspaceSnapshot(workspaceGeneration: generation,
                destination: self.destination, database: database, settings: settings, preferences: preferences))
            if cancelAfter { withUnsafeCurrentTask { $0?.cancel() } }
            return result
        }

        func changeSettings() { settings.stationLocation = "isolated changed station" }
        func invalidate() { generation = 2 }
        func breakPreferences() { preferences.bandMapFontScale = .nan }
        func cancelAfterCapture() { cancelAfter = true }
    }

    private func fixture() throws -> (Workspace, RemoteBackupDestination, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-local-adapter-\(UUID().uuidString)")
        let database = try LogbookDatabase(url: root.appendingPathComponent("isolated.sqlite"))
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "isolated-folder"), schedule: .every(hours: 1))
        return (Workspace(database: database, destination: destination), destination, root)
    }

    @Test func freshSealedSnapshotsFollowInjectedOwnerAndRemoveEveryStage() async throws {
        let (workspace, destination, root) = try fixture()
        defer { workspace.database.close(); try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let source = try RemoteBackupLocalSnapshotSource(workspace: workspace, stagingDirectory: staging)
        let first = try await source.capture(workspaceGeneration: 1, destination: destination)
        #expect(try FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty)
        #expect(first.preferences?.bandMapFontScale == 1)
        #expect(first.manifest.includesSettings)
        #expect(first.manifest.includesPreferences)
        #expect(!first.manifest.includesReferenceData)
        await workspace.changeSettings()
        let second = try await source.capture(workspaceGeneration: 1, destination: destination)
        #expect(second.settings?.stationLocation == "isolated changed station")
        #expect(first.settings?.stationLocation != second.settings?.stationLocation)
        #expect(first.identity != second.identity)
        #expect(try FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty)
        let validated = try XLogBackupManager().validateRestoreEnvelope(second.data)
        #expect(validated.identity == second.identity)
        #expect(await workspace.captures == 2)
    }

    @Test func staleOwnerAndEncodingFailureLeaveStagingEmpty() async throws {
        let (workspace, destination, root) = try fixture()
        defer { workspace.database.close(); try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let source = try RemoteBackupLocalSnapshotSource(workspace: workspace, stagingDirectory: staging)
        await workspace.breakPreferences()
        await #expect(throws: (any Error).self) {
            try await source.capture(workspaceGeneration: 1, destination: destination)
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty)
        await workspace.invalidate()
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await source.capture(workspaceGeneration: 1, destination: destination)
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty)
    }

    @Test func cancellationAfterSnapshotNeverReturnsBytesOrLeavesStages() async throws {
        let (workspace, destination, root) = try fixture()
        defer { workspace.database.close(); try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let source = try RemoteBackupLocalSnapshotSource(workspace: workspace, stagingDirectory: staging)
        await workspace.cancelAfterCapture()
        let task = Task { try await source.capture(workspaceGeneration: 1, destination: destination) }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(try FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty)
    }

    @Test func stagingSymlinksAndPublicUnixPermissionsFailClosed() async throws {
        let (workspace, _, root) = try fixture()
        defer { workspace.database.close(); try? FileManager.default.removeItem(at: root) }
        let target = root.appendingPathComponent("target")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false,
            attributes: LocalFilePermissions.directoryAttributes)
        #if !os(Windows)
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        #expect(throws: RemoteBackupPersistenceError.invalidState) {
            try RemoteBackupLocalSnapshotSource(workspace: workspace, stagingDirectory: link)
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: target.path)
        #expect(throws: RemoteBackupPersistenceError.invalidState) {
            try RemoteBackupLocalSnapshotSource(workspace: workspace, stagingDirectory: target)
        }
        #endif
        #expect(try FileManager.default.contentsOfDirectory(atPath: target.path).isEmpty)
    }

    @Test func periodicTicksValidateIntervalsWaitAndRespectCancellation() async throws {
        for interval in [0, -1, Double.nan, Double.infinity, 0.0001, 86_401] {
            #expect(throws: RemoteBackupLocalAdapterError.invalidInterval) {
                try RemoteBackupPeriodicTickSource(interval: interval)
            }
        }
        let short = try RemoteBackupPeriodicTickSource(interval: 0.001)
        #expect(try await short.nextTick())
        let long = try RemoteBackupPeriodicTickSource(interval: 3_600)
        let task = Task { try await long.nextTick() }
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
        let clock = RemoteBackupSystemClock()
        let before = Date()
        let now = clock.now()
        #expect(now >= before && now <= Date())
    }
}
