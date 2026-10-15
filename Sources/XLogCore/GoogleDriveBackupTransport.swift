import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum GoogleDriveBackupError: Error, Equatable, Sendable {
    case invalidCredential, accountMismatch, credentialUnavailable, invalidDestination
    case invalidPackage, responseTooLarge, invalidResponse, remoteRejected, requestFailed
    case redirectRejected, operationInProgress, capacityReached
}

/// Ephemeral OAuth material supplied by a future trusted native account owner.
/// The stable provider identity is Drive's permission ID in an app namespace.
public struct GoogleDriveBackupCredential: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let accountID: UUID
    public let providerAccountID: String
    fileprivate let accessToken: String

    public init(accountID: UUID, providerAccountID: String, accessToken: String) throws {
        guard Self.isNamespacedID(providerAccountID, prefix: "gdrive:"),
              !accessToken.isEmpty, accessToken.utf8.count <= 8_192,
              accessToken.utf8.allSatisfy({ (33...126).contains($0) }) else {
            throw GoogleDriveBackupError.invalidCredential
        }
        self.accountID = accountID
        self.providerAccountID = providerAccountID
        self.accessToken = accessToken
    }

    public var description: String { "GoogleDriveBackupCredential(redacted)" }
    public var debugDescription: String { description }

    fileprivate static func isOpaqueID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 500 && value.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [45, 95].contains($0)
        }
    }

    fileprivate static func isNamespacedID(_ value: String, prefix: String) -> Bool {
        value.hasPrefix(prefix) && isOpaqueID(String(value.dropFirst(prefix.count)))
    }

    fileprivate static func raw(_ value: String, prefix: String) throws -> String {
        guard isNamespacedID(value, prefix: prefix) else { throw GoogleDriveBackupError.invalidResponse }
        return String(value.dropFirst(prefix.count))
    }
}

public protocol GoogleDriveBackupCredentialSource: Sendable {
    func credential(for accountID: UUID) async throws -> GoogleDriveBackupCredential
}

public struct GoogleDriveBackupHTTPResponse: Sendable {
    public let url: URL
    public let statusCode: Int
    public let headers: [String: String]
    public let body: Data

    public init(url: URL, statusCode: Int, headers: [String: String] = [:], body: Data) {
        self.url = url
        self.statusCode = statusCode
        self.headers = headers
        self.body = body
    }
}

/// Implementations must enforce the byte bound, cancellation/deadlines and a
/// no-redirect policy so a bearer token cannot cross an origin boundary.
public protocol GoogleDriveBackupHTTPClient: Sendable {
    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> GoogleDriveBackupHTTPResponse
}

public struct GoogleDriveBackupAccountProbe: Sendable {
    private let http: any GoogleDriveBackupHTTPClient

    public init(http: any GoogleDriveBackupHTTPClient = GoogleDriveBackupURLSessionClient()) {
        self.http = http
    }

    public func verify(_ credential: GoogleDriveBackupCredential) async throws -> String {
        let response = try await exchange(GoogleDriveBackupTransport.accountURL, credential: credential,
            maximum: GoogleDriveBackupTransport.maximumMetadataBytes)
        guard response.statusCode == 200,
              let about = try? JSONDecoder().decode(About.self, from: response.body),
              about.user.me == true,
              GoogleDriveBackupCredential.isOpaqueID(about.user.permissionId) else {
            throw GoogleDriveBackupError.invalidResponse
        }
        let observed = "gdrive:" + about.user.permissionId
        guard observed == credential.providerAccountID else { throw GoogleDriveBackupError.accountMismatch }
        return observed
    }

    private func exchange(_ url: URL, credential: GoogleDriveBackupCredential,
                          maximum: Int) async throws -> GoogleDriveBackupHTTPResponse {
        try Task.checkCancellation()
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "GET"
        request.setValue("Bearer " + credential.accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        do {
            let response = try await http.send(request, maximumResponseBytes: maximum)
            try Task.checkCancellation()
            guard response.url == url else { throw GoogleDriveBackupError.redirectRejected }
            guard response.body.count <= maximum,
                  response.headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count })
                    <= GoogleDriveBackupTransport.maximumMetadataBytes else {
                throw GoogleDriveBackupError.responseTooLarge
            }
            return response
        } catch let error as GoogleDriveBackupError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw GoogleDriveBackupError.requestFailed
        }
    }

    private struct About: Decodable {
        let user: User
        struct User: Decodable { let me: Bool; let permissionId: String }
    }
}

/// A narrow Drive v3 blob adapter. It pre-generates the object ID so a repeated
/// create conflicts instead of duplicating data, pins the head revision forever,
/// and verifies bytes by downloading that exact revision rather than the mutable file.
public actor GoogleDriveBackupTransport: RemoteBackupUploadTransport, RemoteBackupRestoreTransport {
    public static let maximumPackageBytes = 150 * 1_024 * 1_024
    static let maximumMetadataBytes = 32 * 1_024
    static let mimeType = "application/vnd.om0rx-xlog.backup"
    static let metadataFields = "id,name,size,sha256Checksum,headRevisionId,mimeType,parents,appProperties,trashed,capabilities(canDownload)"
    static let accountURL = makeURL(path: "/drive/v3/about", query: ["fields": "user(me,permissionId)"])!
    static let generateIDURL = makeURL(path: "/drive/v3/files/generateIds",
        query: ["count": "1", "space": "drive", "type": "files"])!
    static let uploadURL = makeURL(path: "/upload/drive/v3/files", query: [
        "fields": metadataFields, "keepRevisionForever": "true",
        "supportsAllDrives": "true", "uploadType": "multipart",
    ])!

    private let destination: RemoteBackupDestination
    private let credentials: any GoogleDriveBackupCredentialSource
    private let http: any GoogleDriveBackupHTTPClient

    private struct Attempt {
        let plan: RemoteBackupUploadPlan
        var objectID: String?
        var metadata: Metadata?
        var providerAccountID: String?
        var verified = false
    }
    private var attempts: [UUID: Attempt] = [:]

    public init(destination: RemoteBackupDestination,
                credentials: any GoogleDriveBackupCredentialSource,
                http: any GoogleDriveBackupHTTPClient = GoogleDriveBackupURLSessionClient()) throws {
        guard destination.provider == .googleDrive,
              destination.security == .authenticatedEncryptionRequired,
              destination.retention.latestVerifiedCount == nil,
              case .cloudFolder(let folderID) = destination.location,
              GoogleDriveBackupCredential.isOpaqueID(folderID) else {
            throw GoogleDriveBackupError.invalidDestination
        }
        self.destination = destination
        self.credentials = credentials
        self.http = http
    }

    public func createExclusively(plan: RemoteBackupUploadPlan,
                                  bytes: Data) async throws -> RemoteBackupExclusiveCreateResult {
        try validate(plan)
        guard bytes.count <= Self.maximumPackageBytes,
              Int64(bytes.count) == plan.package.byteCount,
              BackupPackageSeal.hash(bytes) == plan.package.sha256 else {
            throw GoogleDriveBackupError.invalidPackage
        }
        try Task.checkCancellation()
        guard attempts[plan.backupID] == nil else { throw GoogleDriveBackupError.operationInProgress }
        guard attempts.count < RemoteBackupOperationStore.maximumOperations else {
            throw GoogleDriveBackupError.capacityReached
        }
        attempts[plan.backupID] = Attempt(plan: plan)
        let credential = try await checkedCredential()
        let account = try await checkedAccount(credential)
        let generated = try await generateObjectID(credential)
        attempts[plan.backupID]?.objectID = generated

        var request = try authorizedRequest(Self.uploadURL, method: "POST", credential: credential)
        let boundary = "xlog-" + plan.backupID.uuidString.lowercased()
        request.setValue("multipart/related; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = try multipart(plan: plan, objectID: generated, bytes: bytes, boundary: boundary)
        let response = try await exchange(request, maximum: Self.maximumMetadataBytes)
        if response.statusCode == 409 { return .conflict }
        guard response.statusCode == 200 else { throw GoogleDriveBackupError.remoteRejected }
        let metadata = try metadata(response.body, plan: plan, objectID: generated)
        attempts[plan.backupID] = Attempt(plan: plan, objectID: generated,
            metadata: metadata, providerAccountID: account)
        return .created
    }

    public func verifiedRemoteIdentity(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupPackageIdentity {
        try validate(plan)
        guard let attempt = attempts[plan.backupID], attempt.plan == plan,
              let created = attempt.metadata, let account = attempt.providerAccountID else {
            throw GoogleDriveBackupError.operationInProgress
        }
        let credential = try await checkedCredential()
        guard try await checkedAccount(credential) == account else { throw GoogleDriveBackupError.accountMismatch }
        let observed = try await fetchMetadata(plan: plan, objectID: created.id, credential: credential)
        guard observed.headRevisionId == created.headRevisionId else { throw GoogleDriveBackupError.invalidResponse }
        let bytes = try await downloadRevision(objectID: created.id,
            revisionID: created.headRevisionId, maximum: Int(plan.package.byteCount), credential: credential)
        let identity = try RemoteBackupPackageIdentity(sha256: BackupPackageSeal.hash(bytes),
            byteCount: Int64(bytes.count))
        attempts[plan.backupID]?.verified = identity == plan.package
        return identity
    }

    public func verifiedRemoteObject(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupVerifiedObject? {
        try validate(plan)
        guard let attempt = attempts[plan.backupID], attempt.plan == plan, attempt.verified,
              let metadata = attempt.metadata, let account = attempt.providerAccountID else {
            throw GoogleDriveBackupError.operationInProgress
        }
        return try RemoteBackupVerifiedObject(provider: .googleDrive,
            providerAccountID: account, objectID: "gfile:" + metadata.id,
            revision: "grev:" + metadata.headRevisionId)
    }

    public func downloadVerified(receipt: RemoteBackupUploadReceipt) async throws -> Data {
        try validate(receipt.plan)
        guard case .verified(let package, _) = receipt.outcome,
              package == receipt.plan.package,
              let remote = receipt.remoteObject,
              remote.provider == .googleDrive else {
            throw GoogleDriveBackupError.invalidPackage
        }
        let objectID = try GoogleDriveBackupCredential.raw(remote.objectID, prefix: "gfile:")
        let revisionID = try GoogleDriveBackupCredential.raw(remote.revision, prefix: "grev:")
        let credential = try await checkedCredential()
        guard try await checkedAccount(credential) == remote.providerAccountID else {
            throw GoogleDriveBackupError.accountMismatch
        }
        let bytes = try await downloadRevision(objectID: objectID, revisionID: revisionID,
            maximum: Int(package.byteCount), credential: credential)
        guard Int64(bytes.count) == package.byteCount,
              BackupPackageSeal.hash(bytes) == package.sha256 else {
            throw GoogleDriveBackupError.invalidResponse
        }
        return bytes
    }

    private func validate(_ plan: RemoteBackupUploadPlan) throws {
        guard plan.destination == destination else { throw RemoteBackupPlanningError.staleContext }
        guard plan.package.byteCount <= Int64(Self.maximumPackageBytes) else {
            throw GoogleDriveBackupError.invalidPackage
        }
    }

    private func checkedCredential() async throws -> GoogleDriveBackupCredential {
        try Task.checkCancellation()
        let credential: GoogleDriveBackupCredential
        do { credential = try await credentials.credential(for: destination.accountID) }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw GoogleDriveBackupError.credentialUnavailable
        }
        guard credential.accountID == destination.accountID else { throw GoogleDriveBackupError.accountMismatch }
        return credential
    }

    private func checkedAccount(_ credential: GoogleDriveBackupCredential) async throws -> String {
        try await GoogleDriveBackupAccountProbe(http: http).verify(credential)
    }

    private func generateObjectID(_ credential: GoogleDriveBackupCredential) async throws -> String {
        let request = try authorizedRequest(Self.generateIDURL, method: "GET", credential: credential)
        let response = try await exchange(request, maximum: Self.maximumMetadataBytes)
        guard response.statusCode == 200,
              let generated = try? JSONDecoder().decode(GeneratedIDs.self, from: response.body),
              generated.kind == "drive#generatedIds", generated.space == "drive",
              generated.ids.count == 1, let id = generated.ids.first,
              GoogleDriveBackupCredential.isOpaqueID(id) else {
            throw GoogleDriveBackupError.invalidResponse
        }
        return id
    }

    private func fetchMetadata(plan: RemoteBackupUploadPlan, objectID: String,
                               credential: GoogleDriveBackupCredential) async throws -> Metadata {
        guard let url = Self.metadataURL(objectID: objectID) else { throw GoogleDriveBackupError.invalidResponse }
        let response = try await exchange(authorizedRequest(url, method: "GET", credential: credential),
            maximum: Self.maximumMetadataBytes)
        guard response.statusCode == 200 else { throw GoogleDriveBackupError.remoteRejected }
        return try metadata(response.body, plan: plan, objectID: objectID)
    }

    private func downloadRevision(objectID: String, revisionID: String, maximum: Int,
                                  credential: GoogleDriveBackupCredential) async throws -> Data {
        guard let url = Self.revisionURL(objectID: objectID, revisionID: revisionID) else {
            throw GoogleDriveBackupError.invalidResponse
        }
        let response = try await exchange(authorizedRequest(url, method: "GET", credential: credential),
            maximum: maximum)
        guard response.statusCode == 200, response.body.count <= maximum else {
            throw GoogleDriveBackupError.remoteRejected
        }
        try Task.checkCancellation()
        return response.body
    }

    private func authorizedRequest(_ url: URL, method: String,
                                   credential: GoogleDriveBackupCredential) throws -> URLRequest {
        try Task.checkCancellation()
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = method
        request.setValue("Bearer " + credential.accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        return request
    }

    private func exchange(_ request: URLRequest, maximum: Int) async throws -> GoogleDriveBackupHTTPResponse {
        try Task.checkCancellation()
        do {
            let response = try await http.send(request, maximumResponseBytes: maximum)
            try Task.checkCancellation()
            guard response.url == request.url else { throw GoogleDriveBackupError.redirectRejected }
            guard response.body.count <= maximum,
                  response.headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count })
                    <= Self.maximumMetadataBytes else {
                throw GoogleDriveBackupError.responseTooLarge
            }
            return response
        } catch let error as GoogleDriveBackupError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw GoogleDriveBackupError.requestFailed
        }
    }

    private func multipart(plan: RemoteBackupUploadPlan, objectID: String,
                           bytes: Data, boundary: String) throws -> Data {
        guard case .cloudFolder(let folderID) = destination.location else {
            throw GoogleDriveBackupError.invalidDestination
        }
        let metadata = UploadMetadata(id: objectID, name: plan.objectName, mimeType: Self.mimeType,
            parents: [folderID], appProperties: ["xlog_backup_id": plan.backupID.uuidString.lowercased(),
                "xlog_sha256": plan.package.sha256])
        let document = try JSONEncoder().encode(metadata)
        guard document.count <= 4_096 else { throw GoogleDriveBackupError.invalidResponse }
        var result = Data()
        result.append(Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8))
        result.append(document)
        result.append(Data("\r\n--\(boundary)\r\nContent-Type: \(Self.mimeType)\r\n\r\n".utf8))
        result.append(bytes)
        result.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return result
    }

    private func metadata(_ data: Data, plan: RemoteBackupUploadPlan,
                          objectID: String) throws -> Metadata {
        guard data.count <= Self.maximumMetadataBytes,
              let value = try? JSONDecoder().decode(Metadata.self, from: data),
              value.id == objectID, value.name == plan.objectName,
              value.size == String(plan.package.byteCount),
              value.sha256Checksum == plan.package.sha256,
              GoogleDriveBackupCredential.isOpaqueID(value.id),
              GoogleDriveBackupCredential.isOpaqueID(value.headRevisionId),
              value.mimeType == Self.mimeType, value.trashed == false,
              value.capabilities.canDownload == true,
              case .cloudFolder(let folderID) = destination.location,
              value.parents == [folderID],
              value.appProperties == ["xlog_backup_id": plan.backupID.uuidString.lowercased(),
                  "xlog_sha256": plan.package.sha256] else {
            throw GoogleDriveBackupError.invalidResponse
        }
        return value
    }

    static func metadataURL(objectID: String) -> URL? {
        guard GoogleDriveBackupCredential.isOpaqueID(objectID) else { return nil }
        return makeURL(path: "/drive/v3/files/" + objectID,
            query: ["fields": metadataFields, "supportsAllDrives": "true"])
    }

    static func revisionURL(objectID: String, revisionID: String) -> URL? {
        guard GoogleDriveBackupCredential.isOpaqueID(objectID),
              GoogleDriveBackupCredential.isOpaqueID(revisionID) else { return nil }
        return makeURL(path: "/drive/v3/files/\(objectID)/revisions/\(revisionID)",
            query: ["alt": "media"])
    }

    fileprivate static func makeURL(path: String, query: [String: String]) -> URL? {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "www.googleapis.com"
        components.path = path
        components.queryItems = query.sorted { $0.key < $1.key }.map(URLQueryItem.init)
        return components.url
    }

    static func allows(_ request: URLRequest) -> Bool {
        guard let url = request.url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == "https", components.host == "www.googleapis.com",
              components.port == nil, components.user == nil, components.password == nil,
              components.fragment == nil else { return false }
        let items = components.queryItems ?? []
        guard Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ $0.value != nil }) else { return false }
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value!) })
        let method = request.httpMethod ?? ""
        if url == accountURL || url == generateIDURL { return method == "GET" }
        if url == uploadURL { return method == "POST" }
        let parts = components.path.split(separator: "/").map(String.init)
        if parts.count == 4, parts[0...2] == ["drive", "v3", "files"],
           GoogleDriveBackupCredential.isOpaqueID(parts[3]) {
            return method == "GET" && query == ["fields": metadataFields, "supportsAllDrives": "true"]
        }
        if parts.count == 6, parts[0...2] == ["drive", "v3", "files"], parts[4] == "revisions",
           GoogleDriveBackupCredential.isOpaqueID(parts[3]), GoogleDriveBackupCredential.isOpaqueID(parts[5]) {
            return method == "GET" && query == ["alt": "media"]
        }
        return false
    }

    private struct GeneratedIDs: Decodable { let ids: [String]; let space: String; let kind: String }
    private struct UploadMetadata: Encodable {
        let id: String
        let name: String
        let mimeType: String
        let parents: [String]
        let appProperties: [String: String]
    }
    private struct Metadata: Decodable, Sendable {
        let id: String
        let name: String
        let size: String
        let sha256Checksum: String
        let headRevisionId: String
        let mimeType: String
        let parents: [String]
        let appProperties: [String: String]
        let trashed: Bool
        let capabilities: Capabilities
        struct Capabilities: Decodable, Sendable { let canDownload: Bool }
    }
}

public actor GoogleDriveBackupExecutor: RemoteBackupClaimExecutor {
    private let coordinator: RemoteBackupUploadCoordinator
    private let transport: GoogleDriveBackupTransport

    public init(destination: RemoteBackupDestination, stateDirectory: URL,
                credentials: any GoogleDriveBackupCredentialSource,
                http: any GoogleDriveBackupHTTPClient = GoogleDriveBackupURLSessionClient()) throws {
        transport = try GoogleDriveBackupTransport(destination: destination, credentials: credentials, http: http)
        coordinator = try RemoteBackupUploadCoordinator(stateDirectory: stateDirectory)
    }

    public func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
        try await coordinator.upload(envelope: claim.envelope, plan: claim.plan,
            workspaceGeneration: claim.plan.workspaceGeneration,
            destination: claim.plan.destination, transport: transport)
    }
}
