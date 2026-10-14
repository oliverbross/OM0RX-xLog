import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

struct NativeDropboxBackupVerificationChallenge: Equatable, Sendable {
    let id: UUID
    let binding: NativeDropboxBackupAccountBinding
    let expectedRegistrationRevision: UInt64
}

struct NativeDropboxBackupVerifiedAccount: Sendable {
    let challenge: NativeDropboxBackupVerificationChallenge
    let providerAccountID: String
}

/// Trusted native account/OAuth integration must authenticate the account for the
/// exact vault identity and return the provider-observed dbid, not echo form input.
/// This seam neither provisions credentials nor permits a renderer-supplied proof.
protocol NativeDropboxBackupAccountVerifier: Sendable {
    func verify(_ challenge: NativeDropboxBackupVerificationChallenge) async throws -> NativeDropboxBackupVerifiedAccount
}

struct UnavailableDropboxBackupAccountVerifier: NativeDropboxBackupAccountVerifier {
    func verify(_ challenge: NativeDropboxBackupVerificationChallenge) async throws -> NativeDropboxBackupVerifiedAccount {
        throw NativeDropboxBackupAccountError.verificationUnavailable
    }
}

enum NativeDropboxBackupAccountError: Error, Equatable {
    case staleRevision, verificationUnavailable, verificationFailed
}

struct NativeDropboxBackupAccountState: Equatable, Sendable {
    let workspaceGeneration: UUID
    let revision: UInt64
    let registration: NativeDropboxBackupRegistration?
}

/// Durable non-secret metadata owner for one explicit Dropbox registration in the
/// active workspace. Construction/reads are inert. Registration never approves,
/// starts, resumes, deletes, or changes a credential. A fresh challenge is checked
/// after asynchronous verification under the real workspace/revision lease.
final class LiveDropboxBackupAccountOwner: NativeDropboxBackupAccountRegistry, @unchecked Sendable {
    private let logbook: LiveLogbookMethods
    private let verifier: any NativeDropboxBackupAccountVerifier
    private let lock = NSRecursiveLock()
    private var pending: UUID?
    private var verificationTask: Task<NativeDropboxBackupVerifiedAccount, Error>?
    private var terminal = false

    init(logbook: LiveLogbookMethods,
         verifier: any NativeDropboxBackupAccountVerifier = UnavailableDropboxBackupAccountVerifier()) {
        self.logbook = logbook; self.verifier = verifier
    }

    func state() throws -> NativeDropboxBackupAccountState {
        try context(create: false) { generation, record in
            NativeDropboxBackupAccountState(workspaceGeneration: generation, revision: record?.revision ?? 0,
                registration: record?.workspaceGeneration == generation ? try record?.registration() : nil)
        }
    }

    func withRegistration<T: Sendable>(workspaceGeneration: UUID, accountID: UUID, keychainService: String,
        _ body: (NativeDropboxBackupRegistration?) throws -> T) throws -> T {
        try context(create: false) { current, record in
            guard current == workspaceGeneration, record?.workspaceGeneration == current,
                  let registration = try record?.registration(),
                  registration.binding.destination.accountID == accountID,
                  registration.binding.keychainService == keychainService,
                  try logbook.currentKeychainService() == keychainService else { return try body(nil) }
            return try body(registration)
        }
    }

    func register(plan: RemoteBackupUploadPlan, providerAccountID: String,
                  expectedRevision: UInt64) async throws -> NativeDropboxBackupRegistration {
        try Task.checkCancellation()
        let challenge = try context(create: false) { generation, record in
            guard !terminal else { throw CancellationError() }
            guard pending == nil else { throw RemoteBackupSchedulerError.operationInProgress }
            try plan.validate(workspaceGeneration: generation, destination: plan.destination)
            guard (record?.revision ?? 0) == expectedRevision else { throw NativeDropboxBackupAccountError.staleRevision }
            guard expectedRevision < UInt64.max else { throw RemoteBackupPersistenceError.capacityReached }
            let binding = try NativeDropboxBackupAccountBinding(workspaceGeneration: generation,
                destination: plan.destination, keychainService: logbook.currentKeychainService(), providerAccountID: providerAccountID)
            let value = NativeDropboxBackupVerificationChallenge(id: UUID(), binding: binding,
                expectedRegistrationRevision: expectedRevision)
            pending = value.id
            return value
        }
        defer { finish(challenge.id) }
        return try await withTaskCancellationHandler {
            let task = Task { try await verifier.verify(challenge) }
            let installed = lock.withLock {
                guard !terminal, pending == challenge.id else { return false }
                verificationTask = task
                return true
            }
            guard installed else { task.cancel(); throw CancellationError() }
            let verified: NativeDropboxBackupVerifiedAccount
            do { verified = try await task.value }
            catch {
                if Task.isCancelled || error is CancellationError { throw CancellationError() }
                if error as? NativeDropboxBackupAccountError == .verificationUnavailable {
                    throw NativeDropboxBackupAccountError.verificationUnavailable
                }
                throw NativeDropboxBackupAccountError.verificationFailed
            }
            try Task.checkCancellation()
            return try context(create: true) { generation, record in
                guard !terminal, pending == challenge.id else { throw CancellationError() }
                try plan.validate(workspaceGeneration: generation, destination: plan.destination)
                guard (record?.revision ?? 0) == expectedRevision else { throw NativeDropboxBackupAccountError.staleRevision }
                guard verified.challenge == challenge, verified.providerAccountID == challenge.binding.providerAccountID,
                      try logbook.currentKeychainService() == challenge.binding.keychainService else {
                    throw NativeDropboxBackupAccountError.verificationFailed
                }
                let registration = try NativeDropboxBackupRegistration(revision: expectedRevision + 1,
                    binding: challenge.binding)
                guard let directory = try directory(create: true) else { throw RemoteBackupPersistenceError.unavailable }
                try save(Record(registration: registration), in: directory)
                return registration
            }
        } onCancel: { self.cancel(challenge.id) }
    }

    /// Removes registration metadata only, with a durable tombstone/revision.
    /// The account/vault item and all remote objects remain untouched.
    func remove(expectedWorkspaceGeneration: UUID, expectedRevision: UInt64) throws {
        let task = try context(create: true) { generation, record in
            guard !terminal else { throw CancellationError() }
            guard generation == expectedWorkspaceGeneration else { throw RemoteBackupPlanningError.staleContext }
            guard (record?.revision ?? 0) == expectedRevision else { throw NativeDropboxBackupAccountError.staleRevision }
            guard expectedRevision < UInt64.max else { throw RemoteBackupPersistenceError.capacityReached }
            guard let directory = try directory(create: true) else { throw RemoteBackupPersistenceError.unavailable }
            try save(Record(workspaceGeneration: generation, revision: expectedRevision + 1), in: directory)
            pending = nil
            let task = verificationTask; verificationTask = nil
            return task
        }
        task?.cancel()
    }

    /// Worker stop/replacement/shutdown cancels the injected verification task.
    /// A verifier that ignores cancellation still cannot commit its stale result.
    func cancelPendingVerification(terminal: Bool = false) {
        let task = lock.withLock {
            self.terminal = self.terminal || terminal
            pending = nil
            let task = verificationTask; verificationTask = nil
            return task
        }
        task?.cancel()
    }

    private func finish(_ id: UUID) { lock.withLock { if pending == id { pending = nil; verificationTask = nil } } }
    private func cancel(_ id: UUID) {
        let task = lock.withLock {
            guard pending == id else { return Task<NativeDropboxBackupVerifiedAccount, Error>?.none }
            pending = nil
            let task = verificationTask; verificationTask = nil
            return task
        }
        task?.cancel()
    }

    private func context<T: Sendable>(create: Bool, _ body: (UUID, Record?) throws -> T) throws -> T {
        try logbook.withCurrentWorkspaceGeneration { generation in
            try lock.withLock {
                guard let directory = try directory(create: create) else { return try body(generation, nil) }
                let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
                guard names.allSatisfy({ ["account.json", "account.lock"].contains($0) }) else {
                    throw RemoteBackupPersistenceError.invalidState
                }
                let marker = directory.appendingPathComponent("account.lock")
                do { try Data().write(to: marker, options: .withoutOverwriting) }
                catch { throw RemoteBackupSchedulerError.operationInProgress }
                // Never steal an abandoned lock left by an interrupted mutation.
                defer { try? FileManager.default.removeItem(at: marker) }
                try LocalFilePermissions.protectFile(marker)
                return try body(generation, read(directory))
            }
        }
    }

    private func directory(create: Bool) throws -> URL? {
        let root = logbook.workspaceDirectoryURL.appendingPathComponent("Remote Backup")
        if !create, !FileManager.default.fileExists(atPath: root.path) { return nil }
        let directory = try logbook.remoteBackupDirectory().appendingPathComponent("Accounts")
        if !FileManager.default.fileExists(atPath: directory.path) {
            guard create else { return nil }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                attributes: LocalFilePermissions.directoryAttributes)
        }
        try validate(directory, isDirectory: true)
        return directory
    }

    private func validate(_ url: URL, isDirectory: Bool) throws {
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isSymbolicLink != true, isDirectory ? values.isDirectory == true : values.isRegularFile == true,
              isDirectory || (values.fileSize ?? Int.max) <= 32_768 else { throw RemoteBackupPersistenceError.invalidState }
        #if !os(Windows)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let permissions = attributes[.posixPermissions] as? NSNumber, permissions.intValue & 0o077 == 0 else {
            throw RemoteBackupPersistenceError.invalidState
        }
        #endif
    }

    private func read(_ directory: URL) throws -> Record? {
        let url = directory.appendingPathComponent("account.json")
        guard try FileManager.default.contentsOfDirectory(atPath: directory.path).contains("account.json") else { return nil }
        do {
            try validate(url, isDirectory: false)
            let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
            let data = try handle.read(upToCount: 32_769) ?? Data()
            guard data.count <= 32_768 else { throw RemoteBackupPersistenceError.invalidState }
            let document = try JSONDecoder().decode(Document.self, from: data)
            guard document.version == 1, document.sha256 == hash(try encode(document.record)) else {
                throw RemoteBackupPersistenceError.invalidState
            }
            _ = try document.record.registration()
            return document.record
        } catch { throw RemoteBackupPersistenceError.invalidState }
    }

    private func save(_ record: Record, in directory: URL) throws {
        _ = try record.registration()
        let data = try encode(Document(version: 1, record: record, sha256: hash(try encode(record))))
        guard data.count <= 32_768 else { throw RemoteBackupPersistenceError.capacityReached }
        let url = directory.appendingPathComponent("account.json")
        if FileManager.default.fileExists(atPath: url.path) { try validate(url, isDirectory: false) }
        do { try data.write(to: url, options: .atomic); try LocalFilePermissions.protectFile(url) }
        catch { throw RemoteBackupPersistenceError.unavailable }
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
    private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    private struct Document: Codable { let version: Int; let record: Record; let sha256: String }
    /// Decode through validated domain initializers; no token/proof/package bytes.
    private struct Record: Codable {
        let workspaceGeneration: UUID
        let revision: UInt64
        var registrationID: UUID?
        var destinationID: UUID?
        var destinationRevision: UInt64?
        var accountID: UUID?
        var folderID: String?
        var intervalHours: Int?
        var latestVerifiedCount: Int?
        var keychainService: String?
        var providerAccountID: String?

        init(workspaceGeneration: UUID, revision: UInt64) { self.workspaceGeneration = workspaceGeneration; self.revision = revision }
        init(registration: NativeDropboxBackupRegistration) {
            let binding = registration.binding, destination = binding.destination
            workspaceGeneration = binding.workspaceGeneration; revision = registration.revision
            registrationID = registration.id; destinationID = destination.id; destinationRevision = destination.revision
            accountID = destination.accountID
            if case .cloudFolder(let folder) = destination.location { folderID = folder }
            intervalHours = destination.schedule.intervalHours; latestVerifiedCount = destination.retention.latestVerifiedCount
            keychainService = binding.keychainService; providerAccountID = binding.providerAccountID
        }
        func registration() throws -> NativeDropboxBackupRegistration? {
            guard revision > 0, workspaceGeneration != UUID(uuid: (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) else {
                throw RemoteBackupPersistenceError.invalidState
            }
            guard let registrationID else {
                guard destinationID == nil, destinationRevision == nil, accountID == nil, folderID == nil,
                      intervalHours == nil, latestVerifiedCount == nil, keychainService == nil, providerAccountID == nil else {
                    throw RemoteBackupPersistenceError.invalidState
                }
                return nil
            }
            guard let destinationID, let destinationRevision, let accountID, let folderID,
                  let keychainService, let providerAccountID else { throw RemoteBackupPersistenceError.invalidState }
            let destination = try RemoteBackupDestination(id: destinationID, revision: destinationRevision,
                provider: .dropbox, accountID: accountID, location: .cloudFolder(id: folderID),
                schedule: intervalHours.map { try RemoteBackupSchedule.every(hours: $0) } ?? .disabled,
                retention: latestVerifiedCount.map { try RemoteBackupRetention.keepLatestVerified($0) } ?? .keepAll)
            return try NativeDropboxBackupRegistration(id: registrationID, revision: revision,
                binding: NativeDropboxBackupAccountBinding(workspaceGeneration: workspaceGeneration,
                    destination: destination, keychainService: keychainService, providerAccountID: providerAccountID))
        }
    }
}
