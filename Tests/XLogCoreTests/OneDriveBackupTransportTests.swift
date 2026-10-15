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

@Suite struct OneDriveBackupTransportTests {
    private struct Credentials: OneDriveBackupCredentialSource {
        let value: OneDriveBackupCredential
        func credential(for accountID: UUID) async throws -> OneDriveBackupCredential { value }
    }

    private struct Step: Sendable {
        let status: Int
        let body: Data
        var url: URL?
        var fail = false
    }

    private actor HTTP: OneDriveBackupHTTPClient {
        var steps: [Step]
        var requests: [URLRequest] = []
        init(_ steps: [Step]) { self.steps = steps }

        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> OneDriveBackupHTTPResponse {
            requests.append(request)
            guard !steps.isEmpty else { throw OneDriveBackupError.requestFailed }
            let step = steps.removeFirst()
            if step.fail { throw URLError(.timedOut) }
            return OneDriveBackupHTTPResponse(url: step.url ?? request.url!,
                statusCode: step.status, body: step.body)
        }
    }

    private let driveID = "drive!fixture"
    private let folderID = "folder!fixture"
    private let itemID = "item!123"
    private let eTag = "\"etag,{fixture},1\""
    private let cTag = "\"ctag:{fixture},0\""
    private let uploadURL = URL(string: "https://upload.example.com/session/fixture")!
    private let downloadURL = URL(string: "https://download.example.com/content/fixture")!

    private func fixture(bytes: Data = Data("isolated onedrive backup bytes".utf8)) throws
        -> (RemoteBackupUploadPlan, Data, Credentials) {
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1,
            provider: .oneDrive, accountID: UUID(), location: .cloudFolder(id: folderID))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(), destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(
                sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count)))
        let account = try OneDriveBackupCredential.providerAccountID(for: driveID)
        let credential = try OneDriveBackupCredential(accountID: destination.accountID,
            providerAccountID: account, accessToken: String(repeating: "x", count: 16))
        return (plan, bytes, Credentials(value: credential))
    }

    private func account(_ id: String? = nil) throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "id": id ?? driveID, "driveType": "personal",
        ]))
    }

    private func session(next: [String] = ["0-"]) throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "uploadUrl": uploadURL.absoluteString,
            "expirationDateTime": "2026-10-16T00:00:00Z",
            "nextExpectedRanges": next,
        ]))
    }

    private func metadata(_ plan: RemoteBackupUploadPlan, id: String? = nil,
                          tag: String? = nil, includeDownload: Bool = false) throws -> Data {
        var value: [String: Any] = [
            "id": id ?? itemID, "name": plan.objectName,
            "size": plan.package.byteCount, "eTag": tag ?? eTag, "cTag": cTag,
            "parentReference": ["driveId": driveID, "id": folderID], "file": [:],
        ]
        if includeDownload { value["@microsoft.graph.downloadUrl"] = downloadURL.absoluteString }
        return try JSONSerialization.data(withJSONObject: value)
    }

    private func receipt(_ plan: RemoteBackupUploadPlan) throws -> RemoteBackupUploadReceipt {
        try RemoteBackupUploadReceipt(plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: RemoteBackupVerifiedObject(provider: .oneDrive,
                providerAccountID: try OneDriveBackupCredential.providerAccountID(for: driveID),
                objectID: "oditem:" + OneDriveBackupCredential.encode(itemID),
                revision: "oetag:" + OneDriveBackupCredential.encode(eTag)))
    }

    @Test func conflictFailingCreateAndStableDownloadProduceNamespacedReceipt() async throws {
        let (plan, bytes, credentials) = try fixture()
        let value = try metadata(plan)
        let readable = try metadata(plan, includeDownload: true)
        let http = HTTP([try account(), try session(), Step(status: 201, body: value),
            try account(), Step(status: 200, body: readable), Step(status: 200, body: bytes),
            Step(status: 200, body: readable)])
        let transport = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)

        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        await #expect(throws: OneDriveBackupError.operationInProgress) {
            try await transport.verifiedRemoteObject(plan: plan)
        }
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        #expect(try await transport.verifiedRemoteObject(plan: plan) == receipt(plan).remoteObject)

        let requests = await http.requests
        #expect(requests.count == 7)
        #expect(requests[0].url == OneDriveBackupTransport.accountURL)
        #expect(requests[1].url == OneDriveBackupTransport.createSessionURL(
            driveID: driveID, folderID: folderID, objectName: plan.objectName))
        #expect(requests[2].url == uploadURL)
        #expect(requests[5].url == downloadURL)
        #expect(requests[2].value(forHTTPHeaderField: "Authorization") == nil)
        #expect(requests[5].value(forHTTPHeaderField: "Authorization") == nil)
        #expect(requests[2].value(forHTTPHeaderField: "Content-Range") == "bytes 0-\(bytes.count - 1)/\(bytes.count)")
        #expect(String(decoding: try #require(requests[1].httpBody), as: UTF8.self).contains("fail"))
        #expect(credentials.value.description == "OneDriveBackupCredential(redacted)")
    }

    @Test func restoreUsesReceiptItemAndETagAndRechecksBytes() async throws {
        let (plan, bytes, credentials) = try fixture()
        let readable = try metadata(plan, includeDownload: true)
        let http = HTTP([try account(), Step(status: 200, body: readable),
            Step(status: 200, body: bytes), Step(status: 200, body: readable)])
        let transport = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        #expect(try await transport.downloadVerified(receipt: receipt(plan)) == bytes)
        let requests = await http.requests
        #expect(requests.count == 4)
        #expect(requests[1].url == OneDriveBackupTransport.metadataURL(driveID: driveID, itemID: itemID))
        #expect(requests[2].url == downloadURL)

        let corrupt = HTTP([try account(), Step(status: 200, body: readable),
            Step(status: 200, body: Data("changed".utf8)), Step(status: 200, body: readable)])
        let rejected = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: corrupt)
        await #expect(throws: OneDriveBackupError.invalidResponse) {
            try await rejected.downloadVerified(receipt: receipt(plan))
        }
    }

    @Test func metadataChangeDuringDownloadFailsClosed() async throws {
        let (plan, bytes, credentials) = try fixture()
        let before = try metadata(plan, includeDownload: true)
        let after = try metadata(plan, tag: "\"etag,{fixture},2\"", includeDownload: true)
        let http = HTTP([try account(), Step(status: 200, body: before),
            Step(status: 200, body: bytes), Step(status: 200, body: after)])
        let transport = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        await #expect(throws: OneDriveBackupError.invalidResponse) {
            try await transport.downloadVerified(receipt: receipt(plan))
        }
    }

    @Test func conflictAndAmbiguousUploadAreNeverReplayed() async throws {
        let (plan, bytes, credentials) = try fixture()
        let conflict = HTTP([try account(), Step(status: 409, body: Data())])
        let transport = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: conflict)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .conflict)
        await #expect(throws: OneDriveBackupError.operationInProgress) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await conflict.requests.count == 2)

        let failed = HTTP([try account(), try session(), Step(status: 201, body: Data(), fail: true)])
        let uncertain = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: failed)
        await #expect(throws: OneDriveBackupError.requestFailed) {
            try await uncertain.createExclusively(plan: plan, bytes: bytes)
        }
        await #expect(throws: OneDriveBackupError.operationInProgress) {
            try await uncertain.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await failed.requests.count == 3)
    }

    @Test func largeUploadUsesSequentialAlignedChunks() async throws {
        let bytes = Data(repeating: 0x5a, count: OneDriveBackupTransport.uploadChunkBytes + 7)
        let (plan, _, credentials) = try fixture(bytes: bytes)
        let next = try JSONSerialization.data(withJSONObject: [
            "nextExpectedRanges": ["\(OneDriveBackupTransport.uploadChunkBytes)-"],
        ])
        let http = HTTP([try account(), try session(), Step(status: 202, body: next),
            Step(status: 201, body: try metadata(plan))])
        let transport = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        let requests = await http.requests
        #expect(requests[2].value(forHTTPHeaderField: "Content-Range") ==
            "bytes 0-\(OneDriveBackupTransport.uploadChunkBytes - 1)/\(bytes.count)")
        #expect(requests[3].value(forHTTPHeaderField: "Content-Range") ==
            "bytes \(OneDriveBackupTransport.uploadChunkBytes)-\(bytes.count - 1)/\(bytes.count)")
        #expect(requests[2].httpBody?.count == OneDriveBackupTransport.uploadChunkBytes)
        #expect(requests[3].httpBody?.count == 7)
    }

    @Test func accountRedirectAndCrossProviderReceiptFailClosed() async throws {
        let (plan, bytes, credentials) = try fixture()
        let wrong = HTTP([try account("drive!other")])
        let mismatch = try OneDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: wrong)
        await #expect(throws: OneDriveBackupError.accountMismatch) {
            try await mismatch.createExclusively(plan: plan, bytes: bytes)
        }

        let redirect = HTTP([Step(status: 200, body: Data(),
            url: URL(string: "https://example.invalid/drive")!)])
        await #expect(throws: OneDriveBackupError.redirectRejected) {
            try await OneDriveBackupAccountProbe(http: redirect).verify(credentials.value)
        }
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            try RemoteBackupVerifiedObject(provider: .oneDrive,
                providerAccountID: "gdrive:account", objectID: "oditem:aXRlbQ", revision: "oetag:dGFn")
        }
    }

    @Test func adapterRejectsRetentionUntilConditionalDeletionExists() throws {
        let (plan, _, credentials) = try fixture()
        let destination = try RemoteBackupDestination(id: plan.destination.id, revision: 2,
            provider: .oneDrive, accountID: plan.destination.accountID,
            location: plan.destination.location, retention: .keepLatestVerified(3))
        #expect(throws: OneDriveBackupError.invalidDestination) {
            try OneDriveBackupTransport(destination: destination, credentials: credentials, http: HTTP([]))
        }
    }

    @Test func routeAllowlistSeparatesBearerAndCapabilityURLs() throws {
        let (plan, _, credentials) = try fixture()
        var account = URLRequest(url: OneDriveBackupTransport.accountURL)
        account.httpMethod = "GET"
        account.setValue("Bearer " + String(repeating: "x", count: 16),
            forHTTPHeaderField: "Authorization")
        #expect(OneDriveBackupTransport.allows(account))
        var create = URLRequest(url: try #require(OneDriveBackupTransport.createSessionURL(
            driveID: driveID, folderID: folderID, objectName: plan.objectName)))
        create.httpMethod = "POST"
        create.setValue("Bearer " + String(repeating: "x", count: 16),
            forHTTPHeaderField: "Authorization")
        #expect(OneDriveBackupTransport.allows(create))
        var upload = URLRequest(url: uploadURL)
        upload.httpMethod = "PUT"
        upload.setValue("bytes 0-1/2", forHTTPHeaderField: "Content-Range")
        #expect(OneDriveBackupTransport.allows(upload))
        var download = URLRequest(url: downloadURL)
        download.httpMethod = "GET"
        #expect(OneDriveBackupTransport.allows(download))
        upload.setValue("Bearer " + String(repeating: "x", count: 16),
            forHTTPHeaderField: "Authorization")
        #expect(!OneDriveBackupTransport.allows(upload))
        var local = download
        local.url = URL(string: "https://127.0.0.1/content")!
        #expect(!OneDriveBackupTransport.allows(local))
        #expect(credentials.value.description == "OneDriveBackupCredential(redacted)")
    }
}
