import Foundation

public protocol RemoteBackupWorkspaceGenerationSource: Sendable {
    /// The production workspace owner supplies its real durable UUID and holds its
    /// replacement/restore lock for this synchronous body. Never derive a counter.
    func withCurrentWorkspaceGeneration<T: Sendable>(_ body: (UUID) throws -> T) throws -> T
}

public enum RemoteBackupAuthorizationError: Error, Equatable, Sendable {
    case staleRevision, notAuthorized
}

/// A revisioned consent receipt, not a bearer credential. Every use must be checked
/// against the durable owner and the current workspace lease before starting work.
public struct RemoteBackupAuthorization: Equatable, Sendable {
    public let id: UUID
    public let configurationRevision: UInt64
    public let workspaceGeneration: UUID
    public let destination: RemoteBackupDestination
    public let recurring: Bool
}

public struct RemoteBackupAuthorizationState: Equatable, Sendable {
    public let workspaceGeneration: UUID
    public let configurationRevision: UInt64
    public let authorization: RemoteBackupAuthorization?
}

/// Synchronous validation can run inside a workspace snapshot's lifetime lease.
/// It reloads durable consent on every use; it does not cache permission.
public struct RemoteBackupAuthorizationChecker: Sendable {
    private let check: @Sendable (UUID, RemoteBackupDestination) throws -> Void
    fileprivate init(check: @escaping @Sendable (UUID, RemoteBackupDestination) throws -> Void) { self.check = check }
    public func validate(workspaceGeneration: UUID, destination: RemoteBackupDestination) throws {
        try check(workspaceGeneration, destination)
    }
}

/// One approved destination context per owner. Construction and reads never grant
/// permission. Workspace rotation invalidates consent without guessing identity or
/// replaying prior work. This owner never starts timers, captures or networking.
public actor RemoteBackupAuthorizationOwner {
    private let workspace: any RemoteBackupWorkspaceGenerationSource
    private let store: Store

    public init(workspace: any RemoteBackupWorkspaceGenerationSource, stateDirectory: URL) throws {
        self.workspace = workspace
        store = Store(metadata: try RemoteBackupOperationStore(directory: stateDirectory))
    }

    public func state() throws -> RemoteBackupAuthorizationState {
        try withWorkspace { current in
            let record = try store.read()
            return RemoteBackupAuthorizationState(workspaceGeneration: current,
                configurationRevision: record?.revision ?? 0,
                authorization: record?.workspaceGeneration == current ? try record?.authorization() : nil)
        }
    }

    /// A future native command boundary must explicitly approve a validated plan.
    /// The revision prevents a stale form/owner from replacing newer consent.
    @discardableResult
    public func approve(plan: RemoteBackupUploadPlan, expectedConfigurationRevision: UInt64,
                        recurring: Bool = false) throws -> RemoteBackupAuthorization {
        try withWorkspace { current in
            try plan.validate(workspaceGeneration: current, destination: plan.destination)
            guard !recurring || plan.destination.schedule.intervalHours != nil else {
                throw RemoteBackupPlanningError.invalidSchedule
            }
            let revision = try nextRevision(expectedConfigurationRevision)
            let record = Record(workspaceGeneration: current, revision: revision, id: UUID(),
                operation: RemoteBackupStoredOperation(plan: plan, outcome: nil), recurring: recurring)
            try store.save(record)
            guard let authorization = try record.authorization() else { throw RemoteBackupPersistenceError.invalidState }
            return authorization
        }
    }

    public func validate(plan: RemoteBackupUploadPlan, authorization: RemoteBackupAuthorization) throws {
        try withWorkspace { current in
            try plan.validate(workspaceGeneration: current, destination: authorization.destination)
            guard let record = try store.read(), record.workspaceGeneration == current,
                  try record.authorization() == authorization else {
                throw RemoteBackupAuthorizationError.notAuthorized
            }
        }
    }

    public func checker(for authorization: RemoteBackupAuthorization) -> RemoteBackupAuthorizationChecker {
        let workspace = workspace, store = store
        return RemoteBackupAuthorizationChecker { generation, destination in
            try workspace.withCurrentWorkspaceGeneration { current in
                guard generation == current, generation == authorization.workspaceGeneration,
                      destination == authorization.destination else { throw RemoteBackupPlanningError.staleContext }
                try store.locked {
                    guard let record = try store.read(), record.workspaceGeneration == current,
                          try record.authorization() == authorization else {
                        throw RemoteBackupAuthorizationError.notAuthorized
                    }
                }
            }
        }
    }

    public func revoke(expectedWorkspaceGeneration: UUID, expectedConfigurationRevision: UInt64) throws {
        try withWorkspace { current in
            guard current == expectedWorkspaceGeneration else { throw RemoteBackupPlanningError.staleContext }
            let revision = try nextRevision(expectedConfigurationRevision)
            try store.save(Record(workspaceGeneration: current, revision: revision,
                id: nil, operation: nil, recurring: false))
        }
    }

    private func nextRevision(_ expected: UInt64) throws -> UInt64 {
        guard (try store.read()?.revision ?? 0) == expected else { throw RemoteBackupAuthorizationError.staleRevision }
        guard expected < UInt64.max else { throw RemoteBackupPersistenceError.capacityReached }
        return expected + 1
    }

    private func withWorkspace<T: Sendable>(_ body: (UUID) throws -> T) throws -> T {
        try workspace.withCurrentWorkspaceGeneration { current in
            guard current.uuidString != "00000000-0000-0000-0000-000000000000" else {
                throw RemoteBackupPlanningError.staleContext
            }
            return try store.locked { try body(current) }
        }
    }

    private struct Record: Codable {
        let workspaceGeneration: UUID
        let revision: UInt64
        let id: UUID?
        let operation: RemoteBackupStoredOperation?
        let recurring: Bool

        func authorization() throws -> RemoteBackupAuthorization? {
            guard revision > 0, workspaceGeneration.uuidString != "00000000-0000-0000-0000-000000000000" else {
                throw RemoteBackupPersistenceError.invalidState
            }
            guard let operation else {
                guard id == nil, !recurring else { throw RemoteBackupPersistenceError.invalidState }
                return nil
            }
            guard let id, operation.status == "pending", operation.verifiedAt == nil else {
                throw RemoteBackupPersistenceError.invalidState
            }
            let plan = try operation.receipt().plan
            guard plan.workspaceGeneration == workspaceGeneration,
                  !recurring || plan.destination.schedule.intervalHours != nil else {
                throw RemoteBackupPersistenceError.invalidState
            }
            return RemoteBackupAuthorization(id: id, configurationRevision: revision,
                workspaceGeneration: workspaceGeneration, destination: plan.destination, recurring: recurring)
        }
    }

    private struct Document: Codable {
        let version: Int
        let record: Record
        let sha256: String
    }

    /// Private metadata and corruption checks only; not authentication against an
    /// account owner able to rewrite the application's private files.
    private struct Store: Sendable {
        let metadata: RemoteBackupOperationStore
        private var recordURL: URL { metadata.directory.appendingPathComponent("authorization.json") }

        func locked<T>(_ body: () throws -> T) throws -> T {
            try metadata.validateDirectory()
            let names = try FileManager.default.contentsOfDirectory(atPath: metadata.directory.path)
            guard names.allSatisfy({ ["authorization.json", "authorization.lock"].contains($0) }) else {
                throw RemoteBackupPersistenceError.invalidState
            }
            let marker = metadata.directory.appendingPathComponent("authorization.lock")
            do { try Data().write(to: marker, options: .withoutOverwriting) }
            catch { throw RemoteBackupSchedulerError.operationInProgress }
            // An abandoned lock is never stolen; interrupted configuration needs review.
            defer { try? FileManager.default.removeItem(at: marker) }
            try LocalFilePermissions.protectFile(marker)
            return try body()
        }

        func read() throws -> Record? {
            guard try FileManager.default.contentsOfDirectory(atPath: metadata.directory.path)
                .contains(recordURL.lastPathComponent) else { return nil }
            do {
                let data = try metadata.read(recordURL, maximum: RemoteBackupOperationStore.maximumRecordBytes)
                let document = try JSONDecoder().decode(Document.self, from: data)
                guard document.version == 1,
                      document.sha256 == BackupPackageSeal.hash(try BackupPackageSeal.encode(document.record)) else {
                    throw RemoteBackupPersistenceError.invalidState
                }
                _ = try document.record.authorization()
                return document.record
            } catch { throw RemoteBackupPersistenceError.invalidState }
        }

        func save(_ record: Record) throws {
            _ = try record.authorization()
            let document = Document(version: 1, record: record,
                sha256: BackupPackageSeal.hash(try BackupPackageSeal.encode(record)))
            let data = try BackupPackageSeal.encode(document)
            guard data.count <= RemoteBackupOperationStore.maximumRecordBytes else {
                throw RemoteBackupPersistenceError.capacityReached
            }
            do {
                try data.write(to: recordURL, options: .atomic)
                try LocalFilePermissions.protectFile(recordURL)
            } catch { throw RemoteBackupPersistenceError.unavailable }
        }
    }
}
