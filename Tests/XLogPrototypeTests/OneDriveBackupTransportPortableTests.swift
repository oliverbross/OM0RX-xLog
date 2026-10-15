import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct OneDriveBackupTransportPortableTests {
    private struct Credentials: OneDriveBackupCredentialSource {
        let value: OneDriveBackupCredential
        func credential(for accountID: UUID) async throws -> OneDriveBackupCredential { value }
    }
    private struct Step: Sendable { let status: Int; let body: Data; var url: URL? }
    private actor HTTP: OneDriveBackupHTTPClient {
        var steps: [Step]; var requests: [URLRequest] = []
        init(_ steps: [Step]) { self.steps = steps }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> OneDriveBackupHTTPResponse {
            requests.append(request)
            guard !steps.isEmpty else { throw OneDriveBackupError.requestFailed }
            let step = steps.removeFirst()
            return OneDriveBackupHTTPResponse(url: step.url ?? request.url!,
                statusCode: step.status, body: step.body)
        }
    }

    private let driveID = "drive!portable"
    private let folderID = "folder!portable"
    private let itemID = "item!portable"
    private let eTag = "\"etag,{portable},1\""
    private let cTag = "\"ctag:{portable},0\""
    private let uploadURL = URL(string: "https://upload.example.com/portable")!
    private let downloadURL = URL(string: "https://download.example.com/portable")!

    private func fixture() throws -> (RemoteBackupUploadPlan, Data, Credentials) {
        let bytes = Data("portable onedrive bytes".utf8)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1,
            provider: .oneDrive, accountID: UUID(), location: .cloudFolder(id: folderID))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(), destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(
                sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count)))
        let credential = try OneDriveBackupCredential(accountID: destination.accountID,
            providerAccountID: OneDriveBackupCredential.providerAccountID(for: driveID),
            accessToken: String(repeating: "x", count: 16))
        return (plan, bytes, Credentials(value: credential))
    }

    private func account() throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "id": driveID, "driveType": "personal",
        ]))
    }

    private func session() throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "uploadUrl": uploadURL.absoluteString,
            "expirationDateTime": "2026-10-16T00:00:00Z", "nextExpectedRanges": ["0-"],
        ]))
    }

    private func metadata(_ plan: RemoteBackupUploadPlan, download: Bool) throws -> Data {
        var value: [String: Any] = [
            "id": itemID, "name": plan.objectName, "size": plan.package.byteCount,
            "eTag": eTag, "cTag": cTag,
            "parentReference": ["driveId": driveID, "id": folderID], "file": [:],
        ]
        if download { value["@microsoft.graph.downloadUrl"] = downloadURL.absoluteString }
        return try JSONSerialization.data(withJSONObject: value)
    }

    @Test func portableCreateAndVerify() async throws {
        let (plan, bytes, credentials) = try fixture()
        let http = HTTP([try account(), try session(), Step(status: 201, body: try metadata(plan, download: false)),
            try account(), Step(status: 200, body: try metadata(plan, download: true)),
            Step(status: 200, body: bytes), Step(status: 200, body: try metadata(plan, download: true))])
        let transport = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        let remote = try #require(try await transport.verifiedRemoteObject(plan: plan))
        #expect(remote.provider == .oneDrive)
        #expect(remote.providerAccountID.hasPrefix("odrive:"))
        #expect(remote.objectID.hasPrefix("oditem:"))
        #expect(remote.revision.hasPrefix("oetag:"))
    }

    @Test func portableRestoreRejectsChangedBytes() async throws {
        let (plan, _, credentials) = try fixture()
        let remote = try RemoteBackupVerifiedObject(provider: .oneDrive,
            providerAccountID: OneDriveBackupCredential.providerAccountID(for: driveID),
            objectID: "oditem:" + OneDriveBackupCredential.encode(itemID),
            revision: "oetag:" + OneDriveBackupCredential.encode(eTag))
        let receipt = try RemoteBackupUploadReceipt(plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: remote)
        let http = HTTP([try account(), Step(status: 200, body: try metadata(plan, download: true)),
            Step(status: 200, body: Data("changed".utf8)),
            Step(status: 200, body: try metadata(plan, download: true))])
        let transport = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        await #expect(throws: OneDriveBackupError.invalidResponse) {
            try await transport.downloadVerified(receipt: receipt)
        }
    }

    @Test func portableRejectsRetentionAndUnsafeTransferHosts() throws {
        let (plan, _, credentials) = try fixture()
        let destination = try RemoteBackupDestination(id: plan.destination.id, revision: 2,
            provider: .oneDrive, accountID: plan.destination.accountID,
            location: plan.destination.location, retention: .keepLatestVerified(2))
        #expect(throws: OneDriveBackupError.invalidDestination) {
            try OneDriveBackupTransport(destination: destination, credentials: credentials, http: HTTP([]))
        }
        var local = URLRequest(url: URL(string: "https://127.0.0.1/content")!)
        local.httpMethod = "GET"
        #expect(!OneDriveBackupTransport.allows(local))
    }
}
