import Foundation

/// Validation errors shared by planning and immutable-envelope execution.
public enum RemoteBackupPlanningError: Error, Equatable, Sendable {
    case invalidDestination, invalidPath, invalidSchedule, invalidRetention
    case invalidPackage, staleContext, invalidReceipt
}

public enum RemoteBackupProvider: String, Equatable, Sendable {
    case googleDrive, oneDrive, dropbox, ftp, ftps, sftp
}

public enum RemoteBackupTransportSecurity: Equatable, Sendable {
    /// Executor must validate the TLS certificate or the SSH host key; trust-on-first-use is insufficient.
    case authenticatedEncryptionRequired
    /// Explicit opt-in for FTP only; credentials and backup contents travel without encryption.
    case explicitlyAcceptedPlainFTP
}

public struct RemoteBackupSchedule: Equatable, Sendable {
    public let intervalHours: Int?
    public static let disabled = RemoteBackupSchedule(intervalHours: nil)
    private init(intervalHours: Int?) { self.intervalHours = intervalHours }
    public static func every(hours: Int) throws -> Self {
        guard (1...8_760).contains(hours) else { throw RemoteBackupPlanningError.invalidSchedule }
        return Self(intervalHours: hours)
    }
}

public struct RemoteBackupRetention: Equatable, Sendable {
    public let latestVerifiedCount: Int?
    public static let keepAll = RemoteBackupRetention(latestVerifiedCount: nil)
    private init(latestVerifiedCount: Int?) { self.latestVerifiedCount = latestVerifiedCount }
    public static func keepLatestVerified(_ count: Int) throws -> Self {
        guard count > 0 else { throw RemoteBackupPlanningError.invalidRetention }
        return Self(latestVerifiedCount: count)
    }
}

public enum RemoteBackupLocation: Equatable, Sendable {
    /// Provider-issued folder identifier, never a sharing URL or access token.
    case cloudFolder(id: String)
    /// Endpoint contains only scheme/host/port; directory is an absolute remote path.
    case server(endpoint: URL, directory: String)
}

public struct RemoteBackupDestination: Equatable, Sendable {
    public let id: UUID
    public let revision: UInt64
    public let provider: RemoteBackupProvider
    /// An application-generated vault/account handle, never a username or credential.
    public let accountID: UUID
    public let location: RemoteBackupLocation
    public let security: RemoteBackupTransportSecurity
    public let schedule: RemoteBackupSchedule
    public let retention: RemoteBackupRetention

    public init(id: UUID, revision: UInt64, provider: RemoteBackupProvider, accountID: UUID,
                location: RemoteBackupLocation, security: RemoteBackupTransportSecurity = .authenticatedEncryptionRequired,
                schedule: RemoteBackupSchedule = .disabled, retention: RemoteBackupRetention = .keepAll) throws {
        guard revision > 0 else { throw RemoteBackupPlanningError.invalidDestination }
        switch (provider, location) {
        case (.googleDrive, .cloudFolder(let folder)), (.oneDrive, .cloudFolder(let folder)), (.dropbox, .cloudFolder(let folder)):
            guard Self.isFolderID(folder, provider: provider), security == .authenticatedEncryptionRequired else {
                throw RemoteBackupPlanningError.invalidDestination
            }
        case (.ftp, .server(let endpoint, let directory)), (.ftps, .server(let endpoint, let directory)), (.sftp, .server(let endpoint, let directory)):
            guard let parts = URLComponents(url: endpoint, resolvingAgainstBaseURL: false),
                  parts.scheme == provider.rawValue, let host = parts.host, !host.isEmpty,
                  parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
                  parts.path.isEmpty || parts.path == "/",
                  parts.port.map({ (1...65_535).contains($0) }) ?? true,
                  (provider == .ftp ? security == .explicitlyAcceptedPlainFTP : security == .authenticatedEncryptionRequired) else {
                throw RemoteBackupPlanningError.invalidDestination
            }
            try Self.validateDirectory(directory)
        default: throw RemoteBackupPlanningError.invalidDestination
        }
        self.id = id; self.revision = revision; self.provider = provider; self.accountID = accountID
        self.location = location; self.security = security; self.schedule = schedule; self.retention = retention
    }

    private static func isOpaqueID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && value.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [45, 95].contains($0)
        }
    }

    private static func isFolderID(_ value: String, provider: RemoteBackupProvider) -> Bool {
        // Folder IDs retain provider syntax (OneDrive uses !; Dropbox uses id:).
        switch provider {
        case .googleDrive: return isOpaqueID(value)
        case .oneDrive: return isOpaqueID(value.replacingOccurrences(of: "!", with: "_"))
        case .dropbox:
            return value.hasPrefix("id:") ? isOpaqueID(String(value.dropFirst(3))) : isOpaqueID(value)
        default: return false
        }
    }

    private static func validateDirectory(_ value: String) throws {
        guard value.hasPrefix("/"), value.utf8.count <= 4_096,
              !value.contains("\\"), !value.contains("%"),
              value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              value == "/" || (!value.hasSuffix("/") && !value.contains("//")),
              value.split(separator: "/").allSatisfy({ $0 != "." && $0 != ".." }) else {
            throw RemoteBackupPlanningError.invalidPath
        }
    }
}

public struct RemoteBackupPackageIdentity: Equatable, Sendable {
    public let sha256: String
    public let byteCount: Int64
    public init(sha256: String, byteCount: Int64) throws {
        guard byteCount > 0, sha256.utf8.count == 64,
              sha256.utf8.allSatisfy({ (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0) }) else {
            throw RemoteBackupPlanningError.invalidPackage
        }
        self.sha256 = sha256.lowercased(); self.byteCount = byteCount
    }
}

public struct RemoteBackupUploadPlan: Equatable, Sendable {
    public let workspaceGeneration: UInt64
    public let destination: RemoteBackupDestination
    public let backupID: UUID
    public let package: RemoteBackupPackageIdentity
    /// Executor must create exclusively; an existing object is a conflict, never an overwrite.
    public var objectName: String { "om0rx-xlog-\(backupID.uuidString.lowercased()).xlogbackup" }

    public init(workspaceGeneration: UInt64, destination: RemoteBackupDestination,
                backupID: UUID, package: RemoteBackupPackageIdentity) throws {
        guard workspaceGeneration > 0 else { throw RemoteBackupPlanningError.staleContext }
        self.workspaceGeneration = workspaceGeneration; self.destination = destination
        self.backupID = backupID; self.package = package
    }

    public func validate(workspaceGeneration: UInt64, destination: RemoteBackupDestination) throws {
        guard self.workspaceGeneration == workspaceGeneration, self.destination == destination else {
            throw RemoteBackupPlanningError.staleContext
        }
    }
}

public enum RemoteBackupUploadOutcome: Equatable, Sendable {
    case failed, uncertain
    /// Supplied only after independent remote content verification, not merely an upload acknowledgement.
    case verified(package: RemoteBackupPackageIdentity, at: Date)
}

/// An app-owned upload receipt ties its remote object to the original immutable plan.
/// Listings without a matching receipt have no representation as deletion candidates.
public struct RemoteBackupUploadReceipt: Equatable, Sendable {
    public let plan: RemoteBackupUploadPlan
    public let outcome: RemoteBackupUploadOutcome
    public init(plan: RemoteBackupUploadPlan, outcome: RemoteBackupUploadOutcome) throws {
        if case .verified(let package, let date) = outcome {
            guard package == plan.package, date.timeIntervalSince1970.isFinite else {
                throw RemoteBackupPlanningError.invalidReceipt
            }
        }
        self.plan = plan; self.outcome = outcome
    }
}

public struct RemoteBackupRetentionPlan: Equatable, Sendable {
    public let destination: RemoteBackupDestination
    public let deletions: [RemoteBackupUploadReceipt]

    public init(destination: RemoteBackupDestination, receipts: [RemoteBackupUploadReceipt]) {
        self.destination = destination
        guard let keep = destination.retention.latestVerifiedCount else { deletions = []; return }
        // A repeated backup ID may refer to one physical object: preserve every ambiguous receipt.
        let owned = receipts.filter { $0.plan.destination == destination }
        let counts = Dictionary(grouping: receipts, by: { $0.plan.backupID }).mapValues(\.count)
        let verified = owned.filter {
            guard counts[$0.plan.backupID] == 1 else { return false }
            if case .verified = $0.outcome { return true }
            return false
        }.sorted {
            guard case .verified(_, let left) = $0.outcome, case .verified(_, let right) = $1.outcome else { return false }
            if left != right { return left > right }
            return $0.plan.backupID.uuidString < $1.plan.backupID.uuidString
        }
        deletions = Array(verified.dropFirst(keep))
    }
}

public enum RemoteBackupExclusiveCreateResult: Equatable, Sendable {
    case created
    /// The adapter guarantees this attempt wrote no remote bytes.
    case notCreated
    /// A pre-existing object must never be overwritten or claimed by this operation.
    case conflict
}

/// Provider adapters must enforce destination transport security and create the named
/// object exclusively. They receive frozen bytes only; package URLs are never used.
/// A thrown error may follow a partial or completed write and is therefore uncertain.
public protocol RemoteBackupUploadTransport: Sendable {
    func createExclusively(plan: RemoteBackupUploadPlan, bytes: Data) async throws -> RemoteBackupExclusiveCreateResult
    /// Independently read/hash the remote content; upload acknowledgements and echoed
    /// client checksums are insufficient evidence of remote content identity.
    func verifiedRemoteIdentity(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupPackageIdentity
}

public enum RemoteBackupExecutionError: Error, Equatable, Sendable {
    case operationInProgress, conflictingOperation
}

/// Session-scoped idempotency. Keep one coordinator for the application's backup owner.
/// Receipts are not durable; restart recovery and authenticated receipt storage remain
/// separate work. Unknown/pre-existing remote objects always remain conflicts.
public actor RemoteBackupUploadCoordinator {
    private struct Operation {
        let plan: RemoteBackupUploadPlan
        var receipt: RemoteBackupUploadReceipt?
    }
    // A backup ID names one object even if destination configuration changes.
    private var operations: [UUID: Operation] = [:]

    public init() {}

    public func upload(envelope: XLogBackupEnvelope, plan: RemoteBackupUploadPlan,
                       workspaceGeneration: UInt64, destination: RemoteBackupDestination,
                       transport: any RemoteBackupUploadTransport) async throws -> RemoteBackupUploadReceipt {
        try envelope.validate(for: plan, workspaceGeneration: workspaceGeneration, destination: destination)
        if let operation = operations[plan.backupID] {
            guard operation.plan == plan else { throw RemoteBackupExecutionError.conflictingOperation }
            guard let receipt = operation.receipt else { throw RemoteBackupExecutionError.operationInProgress }
            return receipt
        }
        try Task.checkCancellation()
        operations[plan.backupID] = Operation(plan: plan)
        let outcome: RemoteBackupUploadOutcome
        do {
            switch try await transport.createExclusively(plan: plan, bytes: envelope.data) {
            case .notCreated, .conflict:
                outcome = .failed
            case .created:
                let identity = try await transport.verifiedRemoteIdentity(plan: plan)
                outcome = identity == plan.package ? .verified(package: identity, at: Date()) : .uncertain
            }
        } catch {
            // Do not expose provider errors, which may contain credentials, or retry
            // an ambiguous write. No uncertain result can become a retention candidate.
            outcome = .uncertain
        }
        let receipt = try RemoteBackupUploadReceipt(plan: plan, outcome: outcome)
        operations[plan.backupID] = Operation(plan: plan, receipt: receipt)
        return receipt
    }
}
