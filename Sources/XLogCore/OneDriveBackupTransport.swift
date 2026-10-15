import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum OneDriveBackupError: Error, Equatable, Sendable {
    case invalidCredential, accountMismatch, credentialUnavailable, invalidDestination
    case invalidPackage, responseTooLarge, invalidResponse, remoteRejected, requestFailed
    case redirectRejected, operationInProgress, capacityReached
}

/// Ephemeral Microsoft Graph OAuth material supplied by a future trusted native
/// account owner. Provider identities are base64url-wrapped before persistence so
/// Graph's opaque `!`-bearing IDs never escape their provider namespace.
public struct OneDriveBackupCredential: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let accountID: UUID
    public let providerAccountID: String
    fileprivate let accessToken: String

    public init(accountID: UUID, providerAccountID: String, accessToken: String) throws {
        guard Self.isNamespacedID(providerAccountID, prefix: "odrive:"),
              let driveID = try? Self.decode(providerAccountID, prefix: "odrive:"),
              driveID.utf8.count <= 512,
              !accessToken.isEmpty, accessToken.utf8.count <= 8_192,
              accessToken.utf8.allSatisfy({ (33...126).contains($0) }) else {
            throw OneDriveBackupError.invalidCredential
        }
        self.accountID = accountID
        self.providerAccountID = providerAccountID
        self.accessToken = accessToken
    }

    public static func providerAccountID(for driveID: String) throws -> String {
        guard isProviderID(driveID) else { throw OneDriveBackupError.invalidCredential }
        return "odrive:" + encode(driveID)
    }

    public var description: String { "OneDriveBackupCredential(redacted)" }
    public var debugDescription: String { description }

    fileprivate static func isProviderID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && value.utf8.allSatisfy { (33...126).contains($0) }
    }

    fileprivate static func isNamespacedID(_ value: String, prefix: String) -> Bool {
        guard value.hasPrefix(prefix), value.utf8.count <= 700, value.count > prefix.count else { return false }
        return value.dropFirst(prefix.count).utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [45, 95].contains($0)
        }
    }

    static func encode(_ value: String) -> String {
        Data(value.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    fileprivate static func decode(_ value: String, prefix: String) throws -> String {
        guard isNamespacedID(value, prefix: prefix) else { throw OneDriveBackupError.invalidResponse }
        var encoded = String(value.dropFirst(prefix.count)).replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded), let decoded = String(data: data, encoding: .utf8),
              isProviderID(decoded) else { throw OneDriveBackupError.invalidResponse }
        return decoded
    }
}

public protocol OneDriveBackupCredentialSource: Sendable {
    func credential(for accountID: UUID) async throws -> OneDriveBackupCredential
}

public struct OneDriveBackupHTTPResponse: Sendable {
    public let url: URL
    public let statusCode: Int
    public let headers: [String: String]
    public let body: Data

    public init(url: URL, statusCode: Int, headers: [String: String] = [:], body: Data) {
        self.url = url; self.statusCode = statusCode; self.headers = headers; self.body = body
    }
}

public protocol OneDriveBackupHTTPClient: Sendable {
    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> OneDriveBackupHTTPResponse
}

public struct OneDriveBackupAccountProbe: Sendable {
    private let http: any OneDriveBackupHTTPClient

    public init(http: any OneDriveBackupHTTPClient = OneDriveBackupURLSessionClient()) { self.http = http }

    public func verify(_ credential: OneDriveBackupCredential) async throws -> String {
        var request = try OneDriveBackupTransport.authorizedRequest(
            OneDriveBackupTransport.accountURL, method: "GET", credential: credential)
        request.httpBody = nil
        let response = try await OneDriveBackupTransport.exchange(
            request, maximum: OneDriveBackupTransport.maximumMetadataBytes, http: http)
        guard response.statusCode == 200,
              let drive = try? JSONDecoder().decode(Drive.self, from: response.body),
              OneDriveBackupCredential.isProviderID(drive.id), !drive.driveType.isEmpty else {
            throw OneDriveBackupError.invalidResponse
        }
        let observed = try OneDriveBackupCredential.providerAccountID(for: drive.id)
        guard observed == credential.providerAccountID else { throw OneDriveBackupError.accountMismatch }
        return observed
    }

    private struct Drive: Decodable { let id: String; let driveType: String }
}

/// Narrow Microsoft Graph v1.0 adapter. Every backup uses a unique filename and
/// a conflict-failing upload session. Verification downloads the completed item,
/// hashes it locally, and brackets that read with matching eTag/cTag metadata.
public actor OneDriveBackupTransport: RemoteBackupUploadTransport, RemoteBackupRestoreTransport {
    public static let maximumPackageBytes = 150 * 1_024 * 1_024
    static let maximumMetadataBytes = 32 * 1_024
    static let uploadChunkBytes = 10 * 1_024 * 1_024
    static let accountURL = graphURL(path: "/v1.0/me/drive", query: ["$select": "id,driveType"])!
    static let metadataSelect = "id,name,size,eTag,cTag,parentReference,file,@microsoft.graph.downloadUrl"

    private let destination: RemoteBackupDestination
    private let credentials: any OneDriveBackupCredentialSource
    private let http: any OneDriveBackupHTTPClient

    private struct Attempt {
        let plan: RemoteBackupUploadPlan
        var metadata: Metadata?
        var providerAccountID: String?
        var verified = false
    }
    private var attempts: [UUID: Attempt] = [:]

    public init(destination: RemoteBackupDestination,
                credentials: any OneDriveBackupCredentialSource,
                http: any OneDriveBackupHTTPClient = OneDriveBackupURLSessionClient()) throws {
        guard destination.provider == .oneDrive,
              destination.security == .authenticatedEncryptionRequired,
              destination.retention.latestVerifiedCount == nil,
              case .cloudFolder(let folderID) = destination.location,
              OneDriveBackupCredential.isProviderID(folderID) else {
            throw OneDriveBackupError.invalidDestination
        }
        self.destination = destination; self.credentials = credentials; self.http = http
    }

    public func createExclusively(plan: RemoteBackupUploadPlan,
                                  bytes: Data) async throws -> RemoteBackupExclusiveCreateResult {
        try validate(plan)
        guard bytes.count <= Self.maximumPackageBytes, Int64(bytes.count) == plan.package.byteCount,
              BackupPackageSeal.hash(bytes) == plan.package.sha256 else {
            throw OneDriveBackupError.invalidPackage
        }
        try Task.checkCancellation()
        guard attempts[plan.backupID] == nil else { throw OneDriveBackupError.operationInProgress }
        guard attempts.count < RemoteBackupOperationStore.maximumOperations else {
            throw OneDriveBackupError.capacityReached
        }
        attempts[plan.backupID] = Attempt(plan: plan)
        let credential = try await checkedCredential()
        let account = try await checkedAccount(credential)
        let driveID = try OneDriveBackupCredential.decode(account, prefix: "odrive:")
        let session: URL
        do { session = try await createSession(plan: plan, driveID: driveID, credential: credential) }
        catch ConflictMarker.conflict { return .conflict }
        guard let metadata = try await upload(bytes, plan: plan, driveID: driveID,
                                              sessionURL: session) else { return .conflict }
        attempts[plan.backupID] = Attempt(plan: plan, metadata: metadata, providerAccountID: account)
        return .created
    }

    public func verifiedRemoteIdentity(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupPackageIdentity {
        try validate(plan)
        guard let attempt = attempts[plan.backupID], attempt.plan == plan,
              let created = attempt.metadata, let account = attempt.providerAccountID else {
            throw OneDriveBackupError.operationInProgress
        }
        let credential = try await checkedCredential()
        guard try await checkedAccount(credential) == account else { throw OneDriveBackupError.accountMismatch }
        let driveID = try OneDriveBackupCredential.decode(account, prefix: "odrive:")
        let bytes = try await stableDownload(plan: plan, driveID: driveID,
            itemID: created.id, expectedETag: created.eTag, expectedCTag: created.cTag,
            credential: credential)
        let identity = try RemoteBackupPackageIdentity(
            sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count))
        attempts[plan.backupID]?.verified = identity == plan.package
        return identity
    }

    public func verifiedRemoteObject(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupVerifiedObject? {
        try validate(plan)
        guard let attempt = attempts[plan.backupID], attempt.plan == plan, attempt.verified,
              let metadata = attempt.metadata, let account = attempt.providerAccountID else {
            throw OneDriveBackupError.operationInProgress
        }
        return try RemoteBackupVerifiedObject(provider: .oneDrive,
            providerAccountID: account,
            objectID: "oditem:" + OneDriveBackupCredential.encode(metadata.id),
            revision: "oetag:" + OneDriveBackupCredential.encode(metadata.eTag))
    }

    public func downloadVerified(receipt: RemoteBackupUploadReceipt) async throws -> Data {
        try validate(receipt.plan)
        guard case .verified(let package, _) = receipt.outcome, package == receipt.plan.package,
              let remote = receipt.remoteObject, remote.provider == .oneDrive else {
            throw OneDriveBackupError.invalidPackage
        }
        let itemID = try OneDriveBackupCredential.decode(remote.objectID, prefix: "oditem:")
        let eTag = try OneDriveBackupCredential.decode(remote.revision, prefix: "oetag:")
        let credential = try await checkedCredential()
        guard try await checkedAccount(credential) == remote.providerAccountID else {
            throw OneDriveBackupError.accountMismatch
        }
        let driveID = try OneDriveBackupCredential.decode(remote.providerAccountID, prefix: "odrive:")
        let bytes = try await stableDownload(plan: receipt.plan, driveID: driveID,
            itemID: itemID, expectedETag: eTag, expectedCTag: nil, credential: credential)
        guard Int64(bytes.count) == package.byteCount,
              BackupPackageSeal.hash(bytes) == package.sha256 else {
            throw OneDriveBackupError.invalidResponse
        }
        return bytes
    }

    private func validate(_ plan: RemoteBackupUploadPlan) throws {
        guard plan.destination == destination else { throw RemoteBackupPlanningError.staleContext }
        guard plan.package.byteCount <= Int64(Self.maximumPackageBytes) else {
            throw OneDriveBackupError.invalidPackage
        }
    }

    private func checkedCredential() async throws -> OneDriveBackupCredential {
        try Task.checkCancellation()
        let credential: OneDriveBackupCredential
        do { credential = try await credentials.credential(for: destination.accountID) }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw OneDriveBackupError.credentialUnavailable
        }
        guard credential.accountID == destination.accountID else { throw OneDriveBackupError.accountMismatch }
        return credential
    }

    private func checkedAccount(_ credential: OneDriveBackupCredential) async throws -> String {
        try await OneDriveBackupAccountProbe(http: http).verify(credential)
    }

    private func createSession(plan: RemoteBackupUploadPlan, driveID: String,
                               credential: OneDriveBackupCredential) async throws -> URL {
        guard case .cloudFolder(let folderID) = destination.location,
              let url = Self.createSessionURL(driveID: driveID, folderID: folderID,
                                              objectName: plan.objectName) else {
            throw OneDriveBackupError.invalidDestination
        }
        var request = try Self.authorizedRequest(url, method: "POST", credential: credential)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CreateSessionRequest(
            item: .init(conflictBehavior: "fail", name: plan.objectName)))
        let response = try await Self.exchange(request, maximum: Self.maximumMetadataBytes, http: http)
        guard response.statusCode == 200,
              let session = try? JSONDecoder().decode(UploadSession.self, from: response.body),
              session.nextExpectedRanges == ["0-"], !session.expirationDateTime.isEmpty,
              let uploadURL = URL(string: session.uploadUrl), Self.isSafeTransferURL(uploadURL) else {
            if response.statusCode == 409 { throw ConflictMarker.conflict }
            throw OneDriveBackupError.invalidResponse
        }
        return uploadURL
    }

    private func upload(_ bytes: Data, plan: RemoteBackupUploadPlan, driveID: String,
                        sessionURL: URL) async throws -> Metadata? {
        var offset = 0
        while offset < bytes.count {
            try Task.checkCancellation()
            let end = min(offset + Self.uploadChunkBytes, bytes.count) - 1
            var request = URLRequest(url: sessionURL, cachePolicy: .reloadIgnoringLocalCacheData,
                                     timeoutInterval: 60)
            request.httpMethod = "PUT"
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            request.setValue(String(end - offset + 1), forHTTPHeaderField: "Content-Length")
            request.setValue("bytes \(offset)-\(end)/\(bytes.count)", forHTTPHeaderField: "Content-Range")
            request.httpBody = bytes.subdata(in: offset..<(end + 1))
            let response = try await Self.exchange(request, maximum: Self.maximumMetadataBytes, http: http)
            if response.statusCode == 409 { return nil }
            if end + 1 < bytes.count {
                guard response.statusCode == 202,
                      let status = try? JSONDecoder().decode(UploadSessionStatus.self, from: response.body),
                      status.nextExpectedRanges == ["\(end + 1)-"] else {
                    throw OneDriveBackupError.invalidResponse
                }
            } else {
                guard response.statusCode == 200 || response.statusCode == 201 else {
                    throw OneDriveBackupError.remoteRejected
                }
                return try metadata(response.body, plan: plan, driveID: driveID, expectedItemID: nil)
            }
            offset = end + 1
        }
        throw OneDriveBackupError.invalidPackage
    }

    private func stableDownload(plan: RemoteBackupUploadPlan, driveID: String, itemID: String,
                                expectedETag: String, expectedCTag: String?,
                                credential: OneDriveBackupCredential) async throws -> Data {
        let before = try await fetchMetadata(plan: plan, driveID: driveID,
            itemID: itemID, credential: credential)
        guard before.eTag == expectedETag,
              expectedCTag.map({ before.cTag == $0 }) ?? true,
              let downloadURL = before.downloadURL, Self.isSafeTransferURL(downloadURL) else {
            throw OneDriveBackupError.invalidResponse
        }
        var request = URLRequest(url: downloadURL, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 60)
        request.httpMethod = "GET"
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let response = try await Self.exchange(request, maximum: Int(plan.package.byteCount), http: http)
        guard response.statusCode == 200, response.body.count <= Int(plan.package.byteCount) else {
            throw OneDriveBackupError.remoteRejected
        }
        let after = try await fetchMetadata(plan: plan, driveID: driveID,
            itemID: itemID, credential: credential)
        guard after.eTag == before.eTag, after.cTag == before.cTag else {
            throw OneDriveBackupError.invalidResponse
        }
        return response.body
    }

    private func fetchMetadata(plan: RemoteBackupUploadPlan, driveID: String, itemID: String,
                               credential: OneDriveBackupCredential) async throws -> Metadata {
        guard let url = Self.metadataURL(driveID: driveID, itemID: itemID) else {
            throw OneDriveBackupError.invalidResponse
        }
        let request = try Self.authorizedRequest(url, method: "GET", credential: credential)
        let response = try await Self.exchange(request, maximum: Self.maximumMetadataBytes, http: http)
        guard response.statusCode == 200 else { throw OneDriveBackupError.remoteRejected }
        return try metadata(response.body, plan: plan, driveID: driveID, expectedItemID: itemID)
    }

    private func metadata(_ data: Data, plan: RemoteBackupUploadPlan, driveID: String,
                          expectedItemID: String?) throws -> Metadata {
        guard data.count <= Self.maximumMetadataBytes,
              let value = try? JSONDecoder().decode(Metadata.self, from: data),
              expectedItemID.map({ value.id == $0 }) ?? true,
              OneDriveBackupCredential.isProviderID(value.id), value.name == plan.objectName,
              value.size == plan.package.byteCount,
              OneDriveBackupCredential.isProviderID(value.eTag),
              OneDriveBackupCredential.isProviderID(value.cTag),
              value.parentReference.driveId == driveID,
              case .cloudFolder(let folderID) = destination.location,
              value.parentReference.id == folderID else {
            throw OneDriveBackupError.invalidResponse
        }
        return value
    }

    fileprivate static func authorizedRequest(_ url: URL, method: String,
                                               credential: OneDriveBackupCredential) throws -> URLRequest {
        try Task.checkCancellation()
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = method
        request.setValue("Bearer " + credential.accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        return request
    }

    fileprivate static func exchange(_ request: URLRequest, maximum: Int,
                                     http: any OneDriveBackupHTTPClient) async throws -> OneDriveBackupHTTPResponse {
        try Task.checkCancellation()
        do {
            let response = try await http.send(request, maximumResponseBytes: maximum)
            try Task.checkCancellation()
            guard response.url == request.url else { throw OneDriveBackupError.redirectRejected }
            guard response.body.count <= maximum,
                  response.headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count })
                    <= maximumMetadataBytes else { throw OneDriveBackupError.responseTooLarge }
            return response
        } catch let error as ConflictMarker { throw error }
        catch let error as OneDriveBackupError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw OneDriveBackupError.requestFailed
        }
    }

    static func allows(_ request: URLRequest) -> Bool {
        guard let url = request.url, let method = request.httpMethod else { return false }
        if request.value(forHTTPHeaderField: "Authorization") != nil {
            guard url.scheme == "https", url.host == "graph.microsoft.com", url.port == nil,
                  url.user == nil, url.password == nil, url.fragment == nil else { return false }
            if url == accountURL { return method == "GET" }
            if url.path.hasSuffix("/createUploadSession") { return method == "POST" && url.query == nil }
            if url.path.hasPrefix("/v1.0/drives/"), url.path.contains("/items/") {
                let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
                return method == "GET" && query == [URLQueryItem(name: "$select", value: metadataSelect)]
            }
            return false
        }
        guard isSafeTransferURL(url) else { return false }
        return (method == "PUT" && request.value(forHTTPHeaderField: "Content-Range") != nil)
            || (method == "GET" && request.httpBody == nil)
    }

    static func isSafeTransferURL(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "https", let host = parts.host?.lowercased(), host.contains("."),
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              parts.port == nil || parts.port == 443, url.absoluteString.utf8.count <= 8_192,
              host != "localhost", !host.hasSuffix(".local"),
              !host.utf8.allSatisfy({ (48...57).contains($0) || $0 == 46 }) else { return false }
        return true
    }

    static func createSessionURL(driveID: String, folderID: String, objectName: String) -> URL? {
        guard let drive = segment(driveID), let folder = segment(folderID), let name = segment(objectName) else {
            return nil
        }
        return graphURL(path: "/v1.0/drives/\(drive)/items/\(folder):/\(name):/createUploadSession")
    }

    static func metadataURL(driveID: String, itemID: String) -> URL? {
        guard let drive = segment(driveID), let item = segment(itemID) else { return nil }
        return graphURL(path: "/v1.0/drives/\(drive)/items/\(item)", query: ["$select": metadataSelect])
    }

    static func graphURL(path: String, query: [String: String] = [:]) -> URL? {
        var parts = URLComponents(); parts.scheme = "https"; parts.host = "graph.microsoft.com"
        parts.percentEncodedPath = path
        if !query.isEmpty { parts.queryItems = query.sorted(by: { $0.key < $1.key }).map(URLQueryItem.init) }
        return parts.url
    }

    private static func segment(_ value: String) -> String? {
        guard OneDriveBackupCredential.isProviderID(value) else { return nil }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~!")
        return value.addingPercentEncoding(withAllowedCharacters: allowed)
    }

    private enum ConflictMarker: Error { case conflict }
    private struct CreateSessionRequest: Encodable {
        let item: Item
        struct Item: Encodable {
            let conflictBehavior: String
            let name: String
            enum CodingKeys: String, CodingKey {
                case conflictBehavior = "@microsoft.graph.conflictBehavior", name
            }
        }
    }
    private struct UploadSession: Decodable {
        let uploadUrl: String; let expirationDateTime: String; let nextExpectedRanges: [String]
    }
    private struct UploadSessionStatus: Decodable { let nextExpectedRanges: [String] }
    private struct Metadata: Decodable {
        let id: String; let name: String; let size: Int64; let eTag: String; let cTag: String
        let parentReference: ParentReference
        let file: FileFacet
        let downloadURL: URL?
        struct ParentReference: Decodable { let driveId: String; let id: String }
        struct FileFacet: Decodable {}
        enum CodingKeys: String, CodingKey {
            case id, name, size, eTag, cTag, parentReference, file
            case downloadURL = "@microsoft.graph.downloadUrl"
        }
    }
}

public actor OneDriveBackupExecutor: RemoteBackupClaimExecutor {
    private let coordinator: RemoteBackupUploadCoordinator
    private let transport: OneDriveBackupTransport

    public init(destination: RemoteBackupDestination, stateDirectory: URL,
                credentials: any OneDriveBackupCredentialSource,
                http: any OneDriveBackupHTTPClient = OneDriveBackupURLSessionClient()) throws {
        transport = try OneDriveBackupTransport(destination: destination, credentials: credentials, http: http)
        coordinator = try RemoteBackupUploadCoordinator(stateDirectory: stateDirectory)
    }

    public func execute(_ claim: RemoteBackupDueClaim) async throws -> RemoteBackupUploadReceipt {
        try await coordinator.upload(envelope: claim.envelope, plan: claim.plan,
            workspaceGeneration: claim.plan.workspaceGeneration,
            destination: claim.plan.destination, transport: transport)
    }
}
