import Foundation
import CCurlBackup

public enum FTPBackupError: Error, Equatable, Sendable {
    case invalidCredential, accountMismatch, credentialUnavailable, invalidDestination
    case invalidPackage, responseTooLarge, invalidResponse, remoteRejected
    case operationInProgress, capacityReached, unsupportedProvider
}

public struct FTPBackupCredential: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let accountID: UUID
    fileprivate let username: String
    fileprivate let password: String

    public init(accountID: UUID, username: String, password: String) throws {
        func valid(_ value: String, maximum: Int) -> Bool {
            !value.isEmpty && value.utf8.count <= maximum && value.unicodeScalars.allSatisfy {
                $0.value != 0 && $0.value != 10 && $0.value != 13
            }
        }
        guard valid(username, maximum: 512), valid(password, maximum: 4_096) else {
            throw FTPBackupError.invalidCredential
        }
        self.accountID = accountID; self.username = username; self.password = password
    }

    public var description: String { "FTPBackupCredential(redacted)" }
    public var debugDescription: String { description }
}

public protocol FTPBackupCredentialSource: Sendable {
    func credential(for accountID: UUID) async throws -> FTPBackupCredential
}

public enum FTPBackupCreateResult: Equatable, Sendable { case created, notCreated }

public protocol FTPBackupClient: Sendable {
    func createDirectoryAndUpload(url: URL, directory: String, credential: FTPBackupCredential,
                                  bytes: Data, requireTLS: Bool) async throws -> FTPBackupCreateResult
    func download(url: URL, credential: FTPBackupCredential,
                  maximumBytes: Int, requireTLS: Bool) async throws -> Data
}

/// macOS system-libcurl driver. It disables proxies/netrc/redirects, keeps
/// credentials in memory, validates FTPS certificates using the system trust
/// backend and bounds both time and downloaded bytes. The pre-transfer MKD is
/// the exclusive reservation; an acknowledged 550 proves only that no STOR was
/// sent because FTP uses that code for several failures. Any other failed or
/// lost acknowledgement remains uncertain upstream.
public struct LibcurlFTPBackupClient: FTPBackupClient {
    public init() {}

    public func createDirectoryAndUpload(url: URL, directory: String,
                                         credential: FTPBackupCredential, bytes: Data,
                                         requireTLS: Bool) async throws -> FTPBackupCreateResult {
        try Task.checkCancellation()
        let result = await Task.detached(priority: .utility) {
            var response: CLong = 0
            let code: Int32 = url.absoluteString.withCString { urlValue in
                credential.username.withCString { username in
                    credential.password.withCString { password in
                        ("MKD " + directory).withCString { command in
                            bytes.withUnsafeBytes { body in
                                xlog_ftp_upload(urlValue, username, password, command,
                                    body.bindMemory(to: UInt8.self).baseAddress, body.count,
                                    requireTLS ? 1 : 0, &response)
                            }
                        }
                    }
                }
            }
            return (code, response)
        }.value
        try Task.checkCancellation()
        switch result.0 {
        case Int32(XLOG_FTP_RESULT_OK): return .created
        case Int32(XLOG_FTP_RESULT_NOT_CREATED): return .notCreated
        default: throw FTPBackupError.remoteRejected
        }
    }

    public func download(url: URL, credential: FTPBackupCredential,
                         maximumBytes: Int, requireTLS: Bool) async throws -> Data {
        guard maximumBytes > 0 else { throw FTPBackupError.invalidPackage }
        try Task.checkCancellation()
        let result = await Task.detached(priority: .utility) { () -> (Int32, Data?) in
            var output: UnsafeMutablePointer<UInt8>?, length = 0
            var response: CLong = 0
            let code: Int32 = url.absoluteString.withCString { urlValue in
                credential.username.withCString { username in
                    credential.password.withCString { password in
                        xlog_ftp_download(urlValue, username, password, maximumBytes,
                            requireTLS ? 1 : 0, &output, &length, &response)
                    }
                }
            }
            defer { xlog_ftp_free(output) }
            let data = code == Int32(XLOG_FTP_RESULT_OK) && length > 0 && output != nil
                ? Data(bytes: output!, count: length) : nil
            return (code, data)
        }.value
        try Task.checkCancellation()
        if result.0 == Int32(XLOG_FTP_RESULT_TOO_LARGE) { throw FTPBackupError.responseTooLarge }
        guard result.0 == Int32(XLOG_FTP_RESULT_OK), let data = result.1 else {
            throw FTPBackupError.remoteRejected
        }
        return data
    }
}

/// FTP and implicit-FTPS immutable blob adapter. Each backup first reserves one
/// plan-derived directory with MKD, then stores exactly one object inside it.
/// Generic FTP has no conditional-delete primitive, so retention-count
/// destinations remain rejected. SFTP is deliberately a separate transport.
public actor FTPBackupTransport: RemoteBackupUploadTransport, RemoteBackupRestoreTransport {
    public static let maximumPackageBytes = 150 * 1_024 * 1_024

    private let destination: RemoteBackupDestination
    private let credentials: any FTPBackupCredentialSource
    private let client: any FTPBackupClient

    private struct Attempt {
        let plan: RemoteBackupUploadPlan
        let url: URL?
        let account: String?
        var verified = false
    }
    private var attempts: [UUID: Attempt] = [:]

    public init(destination: RemoteBackupDestination,
                credentials: any FTPBackupCredentialSource,
                client: any FTPBackupClient = LibcurlFTPBackupClient()) throws {
        guard [.ftp, .ftps].contains(destination.provider) else {
            throw FTPBackupError.unsupportedProvider
        }
        guard destination.retention.latestVerifiedCount == nil,
              case .server(let endpoint, _) = destination.location,
              endpoint.scheme == destination.provider.rawValue,
              (destination.provider == .ftp
                ? destination.security == .explicitlyAcceptedPlainFTP
                : destination.security == .authenticatedEncryptionRequired) else {
            throw FTPBackupError.invalidDestination
        }
        self.destination = destination; self.credentials = credentials; self.client = client
    }

    public func createExclusively(plan: RemoteBackupUploadPlan,
                                  bytes: Data) async throws -> RemoteBackupExclusiveCreateResult {
        try validate(plan)
        guard bytes.count <= Self.maximumPackageBytes,
              Int64(bytes.count) == plan.package.byteCount,
              BackupPackageSeal.hash(bytes) == plan.package.sha256 else {
            throw FTPBackupError.invalidPackage
        }
        try Task.checkCancellation()
        guard attempts[plan.backupID] == nil else { throw FTPBackupError.operationInProgress }
        guard attempts.count < RemoteBackupOperationStore.maximumOperations else {
            throw FTPBackupError.capacityReached
        }
        attempts[plan.backupID] = Attempt(plan: plan, url: nil, account: nil)
        let credential = try await checkedCredential()
        let path = try remotePath(plan)
        let url = try remoteURL(path)
        let result = try await client.createDirectoryAndUpload(url: url,
            directory: reservationDirectory(plan), credential: credential,
            bytes: bytes, requireTLS: destination.provider == .ftps)
        guard result == .created else { return .notCreated }
        attempts[plan.backupID] = Attempt(plan: plan, url: url,
            account: accountIdentity(destination.provider, destination.accountID))
        return .created
    }

    public func verifiedRemoteIdentity(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupPackageIdentity {
        try validate(plan)
        guard let attempt = attempts[plan.backupID], attempt.plan == plan,
              let url = attempt.url, let account = attempt.account else {
            throw FTPBackupError.operationInProgress
        }
        let credential = try await checkedCredential()
        guard accountIdentity(destination.provider, credential.accountID) == account else {
            throw FTPBackupError.accountMismatch
        }
        let bytes = try await client.download(url: url, credential: credential,
            maximumBytes: Int(plan.package.byteCount), requireTLS: destination.provider == .ftps)
        let identity = try RemoteBackupPackageIdentity(
            sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count))
        attempts[plan.backupID]?.verified = identity == plan.package
        return identity
    }

    public func verifiedRemoteObject(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupVerifiedObject? {
        try validate(plan)
        guard let attempt = attempts[plan.backupID], attempt.plan == plan,
              attempt.verified, let account = attempt.account else {
            throw FTPBackupError.operationInProgress
        }
        let prefix = destination.provider == .ftp ? "ftp" : "ftps"
        return try RemoteBackupVerifiedObject(provider: destination.provider,
            providerAccountID: account,
            objectID: "\(prefix)obj:" + compact(plan.backupID),
            revision: "\(prefix)sha:" + plan.package.sha256)
    }

    public func downloadVerified(receipt: RemoteBackupUploadReceipt) async throws -> Data {
        try validate(receipt.plan)
        guard case .verified(let package, _) = receipt.outcome,
              package == receipt.plan.package, let remote = receipt.remoteObject,
              remote.provider == destination.provider else { throw FTPBackupError.invalidPackage }
        let prefix = destination.provider == .ftp ? "ftp" : "ftps"
        guard remote.providerAccountID == accountIdentity(destination.provider, destination.accountID),
              remote.objectID == "\(prefix)obj:" + compact(receipt.plan.backupID),
              remote.revision == "\(prefix)sha:" + package.sha256 else {
            throw FTPBackupError.invalidResponse
        }
        let credential = try await checkedCredential()
        let bytes = try await client.download(url: remoteURL(remotePath(receipt.plan)),
            credential: credential, maximumBytes: Int(package.byteCount),
            requireTLS: destination.provider == .ftps)
        guard Int64(bytes.count) == package.byteCount,
              BackupPackageSeal.hash(bytes) == package.sha256 else {
            throw FTPBackupError.invalidResponse
        }
        return bytes
    }

    private func validate(_ plan: RemoteBackupUploadPlan) throws {
        guard plan.destination == destination else { throw RemoteBackupPlanningError.staleContext }
        guard plan.package.byteCount <= Int64(Self.maximumPackageBytes) else {
            throw FTPBackupError.invalidPackage
        }
    }

    private func checkedCredential() async throws -> FTPBackupCredential {
        try Task.checkCancellation()
        let credential: FTPBackupCredential
        do { credential = try await credentials.credential(for: destination.accountID) }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw FTPBackupError.credentialUnavailable
        }
        guard credential.accountID == destination.accountID else { throw FTPBackupError.accountMismatch }
        return credential
    }

    private func reservationDirectory(_ plan: RemoteBackupUploadPlan) -> String {
        guard case .server(_, let directory) = destination.location else { return "" }
        return directory + (directory == "/" ? "" : "/") + ".om0rx-xlog-" + compact(plan.backupID)
    }

    private func remotePath(_ plan: RemoteBackupUploadPlan) throws -> String {
        let reservation = reservationDirectory(plan)
        guard !reservation.isEmpty else { throw FTPBackupError.invalidDestination }
        return reservation + "/" + plan.objectName
    }

    private func remoteURL(_ path: String) throws -> URL {
        guard case .server(let endpoint, _) = destination.location,
              var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw FTPBackupError.invalidDestination
        }
        // A double leading slash makes libcurl address the server-root absolute
        // path instead of a path relative to the authenticated user's home.
        components.path = "/" + path
        guard components.query == nil, components.fragment == nil, let url = components.url else {
            throw FTPBackupError.invalidDestination
        }
        return url
    }

    private func compact(_ id: UUID) -> String {
        id.uuidString.lowercased().replacingOccurrences(of: "-", with: "")
    }

    private func accountIdentity(_ provider: RemoteBackupProvider, _ id: UUID) -> String {
        (provider == .ftp ? "ftpacct:" : "ftpsacct:") + compact(id)
    }
}

public actor FTPBackupExecutor: RemoteBackupClaimExecutor {
    private let coordinator: RemoteBackupUploadCoordinator
    private let transport: FTPBackupTransport

    public init(destination: RemoteBackupDestination, stateDirectory: URL,
                credentials: any FTPBackupCredentialSource,
                client: any FTPBackupClient = LibcurlFTPBackupClient()) throws {
        coordinator = try RemoteBackupUploadCoordinator(stateDirectory: stateDirectory)
        transport = try FTPBackupTransport(destination: destination, credentials: credentials, client: client)
    }

    public func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
        try await coordinator.upload(envelope: claim.envelope, plan: claim.plan,
            workspaceGeneration: claim.plan.workspaceGeneration,
            destination: claim.plan.destination, transport: transport)
    }
}
