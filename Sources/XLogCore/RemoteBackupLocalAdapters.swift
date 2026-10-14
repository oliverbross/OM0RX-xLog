import Foundation

/// Values must be captured together by the active workspace owner. The database
/// is used only synchronously while that owner holds its workspace lifetime lease.
public struct RemoteBackupWorkspaceSnapshot: Sendable {
    public let workspaceGeneration: UUID
    public let destination: RemoteBackupDestination
    public let database: LogbookDatabase
    public let settings: XLogSettings
    public let preferences: XLogBackupPreferences
    public let referenceDataURL: URL?

    public init(workspaceGeneration: UUID, destination: RemoteBackupDestination,
                database: LogbookDatabase, settings: XLogSettings,
                preferences: XLogBackupPreferences, referenceDataURL: URL? = nil) {
        self.workspaceGeneration = workspaceGeneration; self.destination = destination
        self.database = database; self.settings = settings; self.preferences = preferences
        self.referenceDataURL = referenceDataURL
    }
}

public protocol RemoteBackupWorkspaceSnapshotSource: Sendable {
    /// Execute capture on the workspace owner's isolation domain, without releasing
    /// its context or closing/replacing its database until capture returns. Reject a
    /// stale generation/destination rather than opening a default or replacement DB.
    func withActiveSnapshot<T: Sendable>(workspaceGeneration: UUID, destination: RemoteBackupDestination,
        capture: @Sendable (RemoteBackupWorkspaceSnapshot) throws -> T) async throws -> T
}

public enum RemoteBackupLocalAdapterError: Error, Equatable, Sendable {
    case cleanupFailed, invalidInterval, tickAlreadyPending
}

/// Captures fresh SQLite/settings/preferences through an injected workspace owner.
/// Only immutable validated bytes escape; staging is removed before returning them.
public actor RemoteBackupLocalSnapshotSource: RemoteBackupSnapshotSource {
    private let workspace: any RemoteBackupWorkspaceSnapshotSource
    private let staging: RemoteBackupOperationStore

    public init(workspace: any RemoteBackupWorkspaceSnapshotSource, stagingDirectory: URL =
        FileManager.default.temporaryDirectory.appendingPathComponent("om0rx-xlog-backup-staging")) throws {
        self.workspace = workspace
        staging = try RemoteBackupOperationStore(directory: stagingDirectory)
    }

    public func capture(workspaceGeneration: UUID, destination: RemoteBackupDestination) async throws -> XLogBackupEnvelope {
        try Task.checkCancellation()
        let staging = staging
        let envelope = try await workspace.withActiveSnapshot(workspaceGeneration: workspaceGeneration,
            destination: destination) { snapshot in
            guard workspaceGeneration.uuidString != "00000000-0000-0000-0000-000000000000", snapshot.workspaceGeneration == workspaceGeneration,
                  snapshot.destination == destination else { throw RemoteBackupPlanningError.staleContext }
            try Task.checkCancellation()
            try staging.validateDirectory()
            let root = staging.directory.appendingPathComponent("capture-\(UUID().uuidString)", isDirectory: true)
            let files = FileManager.default
            let result: Result<XLogBackupEnvelope, Error>
            do {
                try files.createDirectory(at: root, withIntermediateDirectories: false,
                    attributes: LocalFilePermissions.directoryAttributes)
                try Task.checkCancellation()
                let manager = XLogBackupManager()
                let package = root.appendingPathComponent("snapshot.xlogbackup", isDirectory: true)
                try manager.create(database: snapshot.database, at: package, settings: snapshot.settings,
                    preferences: snapshot.preferences, referenceDataURL: snapshot.referenceDataURL)
                try Task.checkCancellation()
                let envelope = try manager.prepareEnvelope(at: package, validationStagingDirectory: root)
                try Task.checkCancellation()
                result = .success(envelope)
            } catch { result = .failure(error) }
            // Cleanup failure is explicit and never returns backup bytes as success.
            do {
                if try files.contentsOfDirectory(atPath: staging.directory.path).contains(root.lastPathComponent) {
                    try files.removeItem(at: root)
                }
            }
            catch { throw RemoteBackupLocalAdapterError.cleanupFailed }
            return try result.get()
        }
        try Task.checkCancellation()
        return envelope
    }
}

public struct RemoteBackupSystemClock: RemoteBackupClock {
    public init() {}
    public func now() -> Date { Date() }
}

/// Waits a full interval before every tick; late consumers never receive a burst
/// of catch-up ticks. Cancel the task awaiting nextTick to interrupt the wait.
public actor RemoteBackupPeriodicTickSource: RemoteBackupTickSource {
    private let nanoseconds: UInt64
    private var waiting = false

    public init(interval: TimeInterval) throws {
        guard interval.isFinite, (0.001...86_400).contains(interval) else {
            throw RemoteBackupLocalAdapterError.invalidInterval
        }
        nanoseconds = UInt64(interval * 1_000_000_000)
    }

    public func nextTick() async throws -> Bool {
        try Task.checkCancellation()
        guard !waiting else { throw RemoteBackupLocalAdapterError.tickAlreadyPending }
        waiting = true
        defer { waiting = false }
        try await Task.sleep(nanoseconds: nanoseconds)
        try Task.checkCancellation()
        return true
    }
}
