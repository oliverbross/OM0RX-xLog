import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum DropboxBackupError: Error, Equatable, Sendable {
    case invalidCredential, accountMismatch, credentialUnavailable, invalidDestination
    case invalidPackage, responseTooLarge, invalidResponse, remoteRejected, requestFailed
    case redirectRejected, operationInProgress, capacityReached
}

/// Ephemeral credential material supplied by the account owner, never Codable.
public struct DropboxBackupCredential: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let accountID: UUID
    public let providerAccountID: String
    fileprivate let accessToken: String

    public init(accountID: UUID, providerAccountID: String, accessToken: String) throws {
        guard Self.isID(providerAccountID, prefix: "dbid:"), !accessToken.isEmpty, accessToken.utf8.count <= 8_192,
              accessToken.utf8.allSatisfy({ (33...126).contains($0) }) else { throw DropboxBackupError.invalidCredential }
        self.accountID = accountID; self.providerAccountID = providerAccountID; self.accessToken = accessToken
    }
    public var description: String { "DropboxBackupCredential(redacted)" }
    public var debugDescription: String { description }

    fileprivate static func isID(_ value: String, prefix: String) -> Bool {
        guard value.hasPrefix(prefix), value.utf8.count <= 512 else { return false }
        let tail = value.dropFirst(prefix.count)
        return !tail.isEmpty && tail.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [45, 95].contains($0)
        }
    }
}

public protocol DropboxBackupCredentialSource: Sendable {
    func credential(for accountID: UUID) async throws -> DropboxBackupCredential
}

/// Explicitly constructed by a future provider boundary. Initialization performs
/// no HTTP requests and never enables scheduling; only private claim metadata is stored.
public actor DropboxBackupExecutor: RemoteBackupClaimExecutor {
    private let coordinator: RemoteBackupUploadCoordinator
    private let transport: DropboxBackupTransport

    public init(destination: RemoteBackupDestination, stateDirectory: URL,
                credentials: any DropboxBackupCredentialSource,
                http: any DropboxBackupHTTPClient = DropboxBackupURLSessionClient()) throws {
        transport = try DropboxBackupTransport(destination: destination, credentials: credentials, http: http)
        coordinator = try RemoteBackupUploadCoordinator(stateDirectory: stateDirectory)
    }

    public func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
        try await coordinator.upload(envelope: claim.envelope, plan: claim.plan,
            workspaceGeneration: claim.plan.workspaceGeneration, destination: claim.plan.destination, transport: transport)
    }
}

public struct DropboxBackupHTTPResponse: Sendable {
    public let url: URL
    public let statusCode: Int
    public let headers: [String: String]
    public let body: Data
    public init(url: URL, statusCode: Int, headers: [String: String] = [:], body: Data) {
        self.url = url; self.statusCode = statusCode; self.headers = headers; self.body = body
    }
}

/// Trusted injection seam: implementations must enforce the byte bound while
/// receiving, respect cancellation/deadlines, and never redirect credentials.
public protocol DropboxBackupHTTPClient: Sendable {
    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse
}

/// Bounded provider-account authentication shared by setup verification and upload.
/// It performs one fixed-endpoint request and returns only the provider-observed dbid.
public struct DropboxBackupAccountProbe: Sendable {
    private let http: any DropboxBackupHTTPClient

    public init(http: any DropboxBackupHTTPClient = DropboxBackupURLSessionClient()) {
        self.http = http
    }

    public func verify(_ credential: DropboxBackupCredential) async throws -> String {
        try Task.checkCancellation()
        var request = URLRequest(url: DropboxBackupTransport.accountURL,
            cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("Bearer " + credential.accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("null".utf8)
        let response: DropboxBackupHTTPResponse
        do {
            response = try await http.send(request,
                maximumResponseBytes: DropboxBackupTransport.maximumMetadataBytes)
        } catch let error as DropboxBackupError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw DropboxBackupError.requestFailed
        }
        try Task.checkCancellation()
        guard response.url == request.url else { throw DropboxBackupError.redirectRejected }
        guard response.body.count <= DropboxBackupTransport.maximumMetadataBytes,
              response.headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count })
                <= DropboxBackupTransport.maximumMetadataBytes else {
            throw DropboxBackupError.responseTooLarge
        }
        guard response.statusCode == 200 else { throw DropboxBackupError.remoteRejected }
        guard let account = try? JSONDecoder().decode(Account.self, from: response.body),
              account.account_id == credential.providerAccountID else {
            throw DropboxBackupError.accountMismatch
        }
        return account.account_id
    }

    private struct Account: Decodable { let account_id: String }
}

/// Fixed endpoints only. Tokens, response bodies and provider errors are never logged
/// or persisted. Durable replay protection belongs to RemoteBackupUploadCoordinator.
public actor DropboxBackupTransport: RemoteBackupUploadTransport {
    public static let maximumPackageBytes = 150 * 1_024 * 1_024
    static let maximumMetadataBytes = 32 * 1_024
    static let accountURL = URL(string: "https://api.dropboxapi.com/2/users/get_current_account")!
    static let uploadURL = URL(string: "https://content.dropboxapi.com/2/files/upload")!
    static let downloadURL = URL(string: "https://content.dropboxapi.com/2/files/download")!

    private let destination: RemoteBackupDestination
    private let credentials: any DropboxBackupCredentialSource
    private let http: any DropboxBackupHTTPClient
    private struct Attempt {
        let plan: RemoteBackupUploadPlan
        var created: Metadata?
        var providerAccountID: String?
        var verified = false
    }
    // A failed/ambiguous attempt remains reserved for this transport's lifetime.
    private var attempts: [UUID: Attempt] = [:]

    public init(destination: RemoteBackupDestination, credentials: any DropboxBackupCredentialSource,
                http: any DropboxBackupHTTPClient = DropboxBackupURLSessionClient()) throws {
        guard destination.provider == .dropbox, destination.security == .authenticatedEncryptionRequired,
              case .cloudFolder(let folderID) = destination.location,
              DropboxBackupCredential.isID(folderID, prefix: "id:") else { throw DropboxBackupError.invalidDestination }
        self.destination = destination; self.credentials = credentials; self.http = http
    }

    public func createExclusively(plan: RemoteBackupUploadPlan, bytes: Data) async throws -> RemoteBackupExclusiveCreateResult {
        try validate(plan)
        guard bytes.count <= Self.maximumPackageBytes, Int64(bytes.count) == plan.package.byteCount,
              BackupPackageSeal.hash(bytes) == plan.package.sha256 else { throw DropboxBackupError.invalidPackage }
        try Task.checkCancellation()
        guard attempts[plan.backupID] == nil else { throw DropboxBackupError.operationInProgress }
        guard attempts.count < RemoteBackupOperationStore.maximumOperations else { throw DropboxBackupError.capacityReached }
        attempts[plan.backupID] = Attempt(plan: plan)
        let credential = try await checkedCredential()
        let account = try await checkedAccount(credential)
        guard case .cloudFolder(let folderID) = destination.location else { throw DropboxBackupError.invalidDestination }
        let arguments = UploadArguments(path: folderID + "/" + plan.objectName,
            mode: "add", autorename: false, strict_conflict: true, mute: true)
        var request = try request(Self.uploadURL, credential: credential)
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(try header(arguments), forHTTPHeaderField: "Dropbox-API-Arg")
        request.httpBody = bytes
        let response = try await exchange(request, maximum: Self.maximumMetadataBytes)
        if response.statusCode == 409, isConflict(response.body) { return .conflict }
        guard response.statusCode == 200 else { throw DropboxBackupError.remoteRejected }
        let metadata = try metadata(response.body, plan: plan)
        attempts[plan.backupID] = Attempt(plan: plan, created: metadata, providerAccountID: account)
        return .created
    }

    public func verifiedRemoteIdentity(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupPackageIdentity {
        try validate(plan)
        guard let attempt = attempts[plan.backupID], attempt.plan == plan,
              let created = attempt.created, let expectedAccount = attempt.providerAccountID else {
            throw DropboxBackupError.operationInProgress
        }
        let credential = try await checkedCredential()
        guard try await checkedAccount(credential) == expectedAccount else { throw DropboxBackupError.accountMismatch }
        var request = try request(Self.downloadURL, credential: credential)
        // Pin the independently downloaded revision, not a mutable path or echoed hash.
        request.setValue(try header(DownloadArguments(path: "rev:" + created.rev)), forHTTPHeaderField: "Dropbox-API-Arg")
        let response = try await exchange(request, maximum: Int(plan.package.byteCount))
        guard response.statusCode == 200 else { throw DropboxBackupError.remoteRejected }
        guard let result = response.headers.first(where: { $0.key.lowercased() == "dropbox-api-result" })?.value,
              result.utf8.count <= Self.maximumMetadataBytes else { throw DropboxBackupError.invalidResponse }
        let downloaded = try metadata(Data(result.utf8), plan: plan)
        guard downloaded.id == created.id, downloaded.rev == created.rev,
              Int64(response.body.count) == plan.package.byteCount else { throw DropboxBackupError.invalidResponse }
        try Task.checkCancellation()
        let identity = try RemoteBackupPackageIdentity(sha256: BackupPackageSeal.hash(response.body), byteCount: Int64(response.body.count))
        attempts[plan.backupID]?.verified = identity == plan.package
        return identity
    }

    public func verifiedRemoteObject(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupVerifiedObject? {
        try validate(plan)
        try Task.checkCancellation()
        guard let attempt = attempts[plan.backupID], attempt.plan == plan, attempt.verified,
              let metadata = attempt.created, let account = attempt.providerAccountID else {
            throw DropboxBackupError.operationInProgress
        }
        return try RemoteBackupVerifiedObject(provider: .dropbox, providerAccountID: account,
            objectID: metadata.id, revision: metadata.rev)
    }

    private func validate(_ plan: RemoteBackupUploadPlan) throws {
        guard plan.destination == destination else { throw RemoteBackupPlanningError.staleContext }
        guard plan.package.byteCount <= Int64(Self.maximumPackageBytes) else { throw DropboxBackupError.invalidPackage }
    }

    private func checkedCredential() async throws -> DropboxBackupCredential {
        try Task.checkCancellation()
        let credential: DropboxBackupCredential
        do { credential = try await credentials.credential(for: destination.accountID) }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw DropboxBackupError.credentialUnavailable
        }
        guard credential.accountID == destination.accountID else { throw DropboxBackupError.accountMismatch }
        return credential
    }

    private func checkedAccount(_ credential: DropboxBackupCredential) async throws -> String {
        try await DropboxBackupAccountProbe(http: http).verify(credential)
    }

    private func request(_ url: URL, credential: DropboxBackupCredential) throws -> URLRequest {
        try Task.checkCancellation()
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("Bearer " + credential.accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        return request
    }

    private func exchange(_ request: URLRequest, maximum: Int) async throws -> DropboxBackupHTTPResponse {
        try Task.checkCancellation()
        do {
            let response = try await http.send(request, maximumResponseBytes: maximum)
            try Task.checkCancellation()
            guard response.url == request.url else { throw DropboxBackupError.redirectRejected }
            guard response.body.count <= maximum,
                  response.headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count }) <= Self.maximumMetadataBytes else {
                throw DropboxBackupError.responseTooLarge
            }
            return response
        } catch let error as DropboxBackupError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw DropboxBackupError.requestFailed
        }
    }

    private func header<T: Encodable>(_ arguments: T) throws -> String {
        // All generated argument values are bounded ASCII IDs/names/revisions.
        let data = try JSONEncoder().encode(arguments)
        guard data.count <= 4_096, let result = String(data: data, encoding: .ascii) else {
            throw DropboxBackupError.invalidResponse
        }
        return result
    }

    private func metadata(_ data: Data, plan: RemoteBackupUploadPlan) throws -> Metadata {
        guard data.count <= Self.maximumMetadataBytes, let metadata = try? JSONDecoder().decode(Metadata.self, from: data),
              DropboxBackupCredential.isID(metadata.id, prefix: "id:"), metadata.name == plan.objectName,
              metadata.size == plan.package.byteCount, (9...128).contains(metadata.rev.utf8.count),
              metadata.rev.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              metadata.is_downloadable != false, metadata.symlink_info == nil else { throw DropboxBackupError.invalidResponse }
        return metadata
    }

    private func isConflict(_ data: Data) -> Bool {
        guard let document = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = document["error"] as? [String: Any], error[".tag"] as? String == "path",
              let path = error["path"] as? [String: Any], let reason = path["reason"] as? [String: Any] else { return false }
        return reason[".tag"] as? String == "conflict"
    }

    private struct UploadArguments: Encodable {
        let path: String; let mode: String; let autorename: Bool; let strict_conflict: Bool; let mute: Bool
    }
    private struct DownloadArguments: Encodable { let path: String }
    private struct Metadata: Decodable, Sendable {
        let id: String; let name: String; let rev: String; let size: Int64
        let is_downloadable: Bool?
        let symlink_info: [String: String]?
    }
}
