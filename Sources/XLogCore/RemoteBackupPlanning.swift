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
    public let ftpsTrust: FTPSBackupTrustIdentity?

    public init(id: UUID, revision: UInt64, provider: RemoteBackupProvider, accountID: UUID,
                location: RemoteBackupLocation, security: RemoteBackupTransportSecurity = .authenticatedEncryptionRequired,
                schedule: RemoteBackupSchedule = .disabled, retention: RemoteBackupRetention = .keepAll,
                ftpsTrust: FTPSBackupTrustIdentity? = nil) throws {
        guard revision > 0, ftpsTrust == nil || provider == .ftps else { throw RemoteBackupPlanningError.invalidDestination }
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
        self.ftpsTrust = ftpsTrust
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
    /// The durable edit-generation UUID owned by the active workspace. Legacy
    /// numeric backup identities cannot be mapped safely and must fail closed.
    public let workspaceGeneration: UUID
    public let destination: RemoteBackupDestination
    public let backupID: UUID
    public let package: RemoteBackupPackageIdentity
    /// Executor must create exclusively; an existing object is a conflict, never an overwrite.
    public var objectName: String { "om0rx-xlog-\(backupID.uuidString.lowercased()).xlogbackup" }

    public init(workspaceGeneration: UUID, destination: RemoteBackupDestination,
                backupID: UUID, package: RemoteBackupPackageIdentity) throws {
        guard workspaceGeneration.uuidString != "00000000-0000-0000-0000-000000000000" else { throw RemoteBackupPlanningError.staleContext }
        self.workspaceGeneration = workspaceGeneration; self.destination = destination
        self.backupID = backupID; self.package = package
    }

    public func validate(workspaceGeneration: UUID, destination: RemoteBackupDestination) throws {
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
    public let remoteObject: RemoteBackupVerifiedObject?
    public init(plan: RemoteBackupUploadPlan, outcome: RemoteBackupUploadOutcome,
                remoteObject: RemoteBackupVerifiedObject? = nil) throws {
        if case .verified(let package, let date) = outcome {
            guard package == plan.package, date.timeIntervalSince1970.isFinite else {
                throw RemoteBackupPlanningError.invalidReceipt
            }
        }
        if let remoteObject {
            guard case .verified = outcome, remoteObject.provider == plan.destination.provider else {
                throw RemoteBackupPlanningError.invalidReceipt
            }
        }
        self.plan = plan; self.outcome = outcome; self.remoteObject = remoteObject
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
    /// Optional pinned provider identity, only after the exact independent byte
    /// verification above. Legacy adapters remain proofless and retention-protected.
    func verifiedRemoteObject(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupVerifiedObject?
}

public extension RemoteBackupUploadTransport {
    func verifiedRemoteObject(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupVerifiedObject? { nil }
}

public enum RemoteBackupExecutionError: Error, Equatable, Sendable {
    case operationInProgress, conflictingOperation
}

/// Keep one coordinator for the application's backup owner. The directory initializer
/// persists reservations before transport and recovers interrupted writes as uncertain.
/// Unknown/pre-existing remote objects always remain conflicts.
public actor RemoteBackupUploadCoordinator {
    private struct Operation {
        let plan: RemoteBackupUploadPlan
        var receipt: RemoteBackupUploadReceipt?
    }
    // A backup ID names one object even if destination configuration changes.
    private var operations: [UUID: Operation] = [:]
    private let store: RemoteBackupOperationStore?

    public init() { store = nil }

    public init(stateDirectory: URL) throws {
        let store = try RemoteBackupOperationStore(directory: stateDirectory)
        self.store = store
        for receipt in try store.load() {
            operations[receipt.plan.backupID] = Operation(plan: receipt.plan, receipt: receipt)
        }
    }

    /// Read-only durable history for explicit native retention review. Never
    /// creates a missing directory or converts an interrupted claim to success.
    public static func persistedReceipts(stateDirectory: URL) throws -> [RemoteBackupUploadReceipt] {
        guard stateDirectory.isFileURL, LocalFilePath.isAbsoluteWithoutTraversal(stateDirectory.path),
              stateDirectory.standardizedFileURL.pathComponents.count > 1 else { throw RemoteBackupPersistenceError.invalidState }
        guard FileManager.default.fileExists(atPath: stateDirectory.path) else { return [] }
        return try RemoteBackupOperationStore(directory: stateDirectory, createIfMissing: false).load()
            .sorted { $0.plan.backupID.uuidString < $1.plan.backupID.uuidString }
    }

    public func upload(envelope: XLogBackupEnvelope, plan: RemoteBackupUploadPlan,
                       workspaceGeneration: UUID, destination: RemoteBackupDestination,
                       transport: any RemoteBackupUploadTransport) async throws -> RemoteBackupUploadReceipt {
        try envelope.validate(for: plan, workspaceGeneration: workspaceGeneration, destination: destination)
        if let operation = operations[plan.backupID] {
            guard operation.plan == plan else { throw RemoteBackupExecutionError.conflictingOperation }
            guard let receipt = operation.receipt else { throw RemoteBackupExecutionError.operationInProgress }
            return receipt
        }
        try Task.checkCancellation()
        if let receipt = try store?.reserve(plan: plan) {
            operations[plan.backupID] = Operation(plan: plan, receipt: receipt)
            return receipt
        }
        operations[plan.backupID] = Operation(plan: plan)
        let outcome: RemoteBackupUploadOutcome
        var remoteObject: RemoteBackupVerifiedObject?
        do {
            switch try await transport.createExclusively(plan: plan, bytes: envelope.data) {
            case .notCreated, .conflict:
                outcome = .failed
            case .created:
                let identity = try await transport.verifiedRemoteIdentity(plan: plan)
                if identity == plan.package {
                    remoteObject = try await transport.verifiedRemoteObject(plan: plan)
                    outcome = .verified(package: identity, at: Date())
                } else { outcome = .uncertain }
            }
        } catch {
            // Do not expose provider errors, which may contain credentials, or retry
            // an ambiguous write. No uncertain result can become a retention candidate.
            outcome = .uncertain
        }
        let receipt = try RemoteBackupUploadReceipt(plan: plan, outcome: outcome, remoteObject: remoteObject)
        do {
            try store?.complete(receipt)
        } catch {
            // A reserved operation remains non-replayable even if its final state
            // cannot be saved. Never report durable verification on a failed save.
            operations[plan.backupID] = Operation(plan: plan,
                receipt: try RemoteBackupUploadReceipt(plan: plan, outcome: .uncertain))
            throw error
        }
        operations[plan.backupID] = Operation(plan: plan, receipt: receipt)
        return receipt
    }
}

public enum RemoteBackupPersistenceError: Error, Equatable, Sendable {
    case invalidState, unavailable, capacityReached
}

/// Dedicated, app-private metadata only: no envelope bytes, secrets or provider errors.
/// The digest detects accidental corruption; it is not authentication against local
/// users able to rewrite this private directory. Records never authorize remote deletion.
internal struct RemoteBackupOperationStore: Sendable {
    static let maximumOperations = 1_024
    static let maximumRecordBytes = 32 * 1_024
    let directory: URL

    init(directory: URL, createIfMissing: Bool = true) throws {
        guard directory.isFileURL, LocalFilePath.isAbsoluteWithoutTraversal(directory.path),
              directory.standardizedFileURL.pathComponents.count > 1 else {
            throw RemoteBackupPersistenceError.invalidState
        }
        self.directory = directory
        do {
            if !FileManager.default.fileExists(atPath: directory.path) {
                guard createIfMissing else { throw RemoteBackupPersistenceError.unavailable }
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                    attributes: LocalFilePermissions.directoryAttributes)
            }
            try validateDirectory()
        } catch let error as RemoteBackupPersistenceError { throw error }
        catch { throw RemoteBackupPersistenceError.unavailable }
    }

    func validateDirectory() throws {
        let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else {
            throw RemoteBackupPersistenceError.invalidState
        }
        #if !os(Windows)
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
        guard let permissions = attributes[.posixPermissions] as? NSNumber,
              permissions.intValue & 0o077 == 0 else {
            throw RemoteBackupPersistenceError.invalidState
        }
        #endif
    }

    private func url(_ id: UUID, suffix: String) -> URL {
        directory.appendingPathComponent(id.uuidString.lowercased() + suffix)
    }

    func read(_ url: URL, maximum: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size <= maximum else {
            throw RemoteBackupPersistenceError.invalidState
        }
        #if !os(Windows)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let permissions = attributes[.posixPermissions] as? NSNumber,
              permissions.intValue & 0o077 == 0 else {
            throw RemoteBackupPersistenceError.invalidState
        }
        #endif
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: maximum + 1) ?? Data()
        guard data.count <= maximum else { throw RemoteBackupPersistenceError.invalidState }
        return data
    }

    func load() throws -> [RemoteBackupUploadReceipt] {
        do {
            try validateDirectory()
            let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            guard files.count <= Self.maximumOperations * 2 else { throw RemoteBackupPersistenceError.capacityReached }
            var reservations = Set<UUID>(), records = Set<UUID>()
            for file in files {
                let suffix: String
                if file.lastPathComponent.hasSuffix(".reserved") { suffix = ".reserved" }
                else if file.lastPathComponent.hasSuffix(".json") { suffix = ".json" }
                else { throw RemoteBackupPersistenceError.invalidState }
                let name = String(file.lastPathComponent.dropLast(suffix.count))
                guard let id = UUID(uuidString: name), id.uuidString.lowercased() == name else {
                    throw RemoteBackupPersistenceError.invalidState
                }
                if suffix == ".reserved" {
                    guard try read(file, maximum: 0).isEmpty else { throw RemoteBackupPersistenceError.invalidState }
                    reservations.insert(id)
                } else { records.insert(id) }
            }
            guard reservations == records else { throw RemoteBackupPersistenceError.invalidState }
            return try records.map { id in
                let data = try read(url(id, suffix: ".json"), maximum: Self.maximumRecordBytes)
                let document = try JSONDecoder().decode(RemoteBackupStoredDocument.self, from: data)
                guard document.version == 2,
                      document.sha256 == BackupPackageSeal.hash(try BackupPackageSeal.encode(document.operation)) else {
                    throw RemoteBackupPersistenceError.invalidState
                }
                let receipt = try document.operation.receipt()
                guard receipt.plan.backupID == id else { throw RemoteBackupPersistenceError.invalidState }
                return receipt
            }
        } catch let error as RemoteBackupPersistenceError { throw error }
        catch { throw RemoteBackupPersistenceError.invalidState }
    }

    /// An exclusive marker precedes the atomic pending record. A crash between them
    /// leaves an invalid store that fails closed instead of silently forgetting a write.
    func reserve(plan: RemoteBackupUploadPlan) throws -> RemoteBackupUploadReceipt? {
        let existing = try load()
        if let receipt = existing.first(where: { $0.plan.backupID == plan.backupID }) {
            guard receipt.plan == plan else { throw RemoteBackupExecutionError.conflictingOperation }
            return receipt
        }
        guard existing.count < Self.maximumOperations else { throw RemoteBackupPersistenceError.capacityReached }
        do {
            try Data().write(to: url(plan.backupID, suffix: ".reserved"), options: .withoutOverwriting)
            try LocalFilePermissions.protectFile(url(plan.backupID, suffix: ".reserved"))
            try save(RemoteBackupStoredOperation(plan: plan, outcome: nil))
            return nil
        } catch {
            // Concurrent/stale coordinators cannot replace an existing reservation.
            // A partial reservation or any I/O failure leaves transport untouched.
            throw RemoteBackupPersistenceError.unavailable
        }
    }

    func complete(_ receipt: RemoteBackupUploadReceipt) throws {
        do {
            guard try load().contains(where: { $0.plan == receipt.plan }) else {
                throw RemoteBackupPersistenceError.invalidState
            }
            try save(RemoteBackupStoredOperation(plan: receipt.plan, outcome: receipt.outcome, remoteObject: receipt.remoteObject))
        } catch { throw RemoteBackupPersistenceError.unavailable }
    }

    private func save(_ operation: RemoteBackupStoredOperation) throws {
        let document = RemoteBackupStoredDocument(version: 2, operation: operation,
            sha256: BackupPackageSeal.hash(try BackupPackageSeal.encode(operation)))
        let data = try BackupPackageSeal.encode(document)
        guard data.count <= Self.maximumRecordBytes else { throw RemoteBackupPersistenceError.capacityReached }
        let target = url(operation.backupID, suffix: ".json")
        try data.write(to: target, options: .atomic)
        try LocalFilePermissions.protectFile(target)
    }
}

private struct RemoteBackupStoredDocument: Codable {
    let version: Int
    let operation: RemoteBackupStoredOperation
    let sha256: String
}

/// Decode through validated domain initializers, never synthesized Codable on plans.
internal struct RemoteBackupStoredOperation: Codable {
    let backupID: UUID
    let workspaceGeneration: UUID
    let destinationID: UUID
    let destinationRevision: UInt64
    let provider: String
    let accountID: UUID
    let cloudFolderID: String?
    let endpoint: String?
    let directory: String?
    let plainFTP: Bool
    let ftpsTrust: FTPSBackupTrustIdentity?
    let scheduleHours: Int?
    let retainedCount: Int?
    let packageSHA256: String
    let packageByteCount: Int64
    let status: String
    let verifiedAt: Date?
    let remoteObject: RemoteBackupVerifiedObject?

    init(plan: RemoteBackupUploadPlan, outcome: RemoteBackupUploadOutcome?, remoteObject: RemoteBackupVerifiedObject? = nil) {
        self.remoteObject = remoteObject
        backupID = plan.backupID; workspaceGeneration = plan.workspaceGeneration
        let destination = plan.destination
        destinationID = destination.id; destinationRevision = destination.revision
        provider = destination.provider.rawValue; accountID = destination.accountID
        switch destination.location {
        case .cloudFolder(let id): cloudFolderID = id; endpoint = nil; directory = nil
        case .server(let url, let path): cloudFolderID = nil; endpoint = url.absoluteString; directory = path
        }
        plainFTP = destination.security == .explicitlyAcceptedPlainFTP
        ftpsTrust = destination.ftpsTrust
        scheduleHours = destination.schedule.intervalHours; retainedCount = destination.retention.latestVerifiedCount
        packageSHA256 = plan.package.sha256; packageByteCount = plan.package.byteCount
        switch outcome {
        case nil: status = "pending"; verifiedAt = nil
        case .failed: status = "failed"; verifiedAt = nil
        case .uncertain: status = "uncertain"; verifiedAt = nil
        case .verified(_, let date): status = "verified"; verifiedAt = date
        }
    }

    func receipt() throws -> RemoteBackupUploadReceipt {
        guard let provider = RemoteBackupProvider(rawValue: provider) else { throw RemoteBackupPersistenceError.invalidState }
        let location: RemoteBackupLocation
        if let cloudFolderID {
            guard endpoint == nil, directory == nil else { throw RemoteBackupPersistenceError.invalidState }
            location = .cloudFolder(id: cloudFolderID)
        } else {
            guard let endpoint, let url = URL(string: endpoint), let directory else { throw RemoteBackupPersistenceError.invalidState }
            location = .server(endpoint: url, directory: directory)
        }
        let destination = try RemoteBackupDestination(id: destinationID, revision: destinationRevision,
            provider: provider, accountID: accountID, location: location,
            security: plainFTP ? .explicitlyAcceptedPlainFTP : .authenticatedEncryptionRequired,
            schedule: try scheduleHours.map { try .every(hours: $0) } ?? .disabled,
            retention: try retainedCount.map { try .keepLatestVerified($0) } ?? .keepAll,
            ftpsTrust: ftpsTrust)
        let package = try RemoteBackupPackageIdentity(sha256: packageSHA256, byteCount: packageByteCount)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: workspaceGeneration, destination: destination,
            backupID: backupID, package: package)
        let outcome: RemoteBackupUploadOutcome
        switch status {
        case "pending", "uncertain": outcome = .uncertain
        case "failed": outcome = .failed
        case "verified":
            guard let verifiedAt else { throw RemoteBackupPersistenceError.invalidState }
            outcome = .verified(package: package, at: verifiedAt)
        default: throw RemoteBackupPersistenceError.invalidState
        }
        guard status == "verified" || verifiedAt == nil else { throw RemoteBackupPersistenceError.invalidState }
        return try RemoteBackupUploadReceipt(plan: plan, outcome: outcome, remoteObject: remoteObject)
    }
}
