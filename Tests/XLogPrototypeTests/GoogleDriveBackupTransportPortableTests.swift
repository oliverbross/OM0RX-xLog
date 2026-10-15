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

@Suite struct GoogleDriveBackupTransportPortableTests {
    private struct Credentials: GoogleDriveBackupCredentialSource {
        let value: GoogleDriveBackupCredential
        func credential(for accountID: UUID) async throws -> GoogleDriveBackupCredential { value }
    }

    private struct Step: Sendable { let status: Int; let body: Data; var fail = false }
    private actor HTTP: GoogleDriveBackupHTTPClient {
        var steps: [Step]
        var requests: [URLRequest] = []
        init(_ steps: [Step]) { self.steps = steps }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> GoogleDriveBackupHTTPResponse {
            requests.append(request)
            guard !steps.isEmpty else { throw GoogleDriveBackupError.requestFailed }
            let step = steps.removeFirst()
            if step.fail { throw URLError(.timedOut) }
            return GoogleDriveBackupHTTPResponse(url: request.url!, statusCode: step.status, body: step.body)
        }
    }

    private func fixture() throws -> (RemoteBackupUploadPlan, Data, Credentials) {
        let bytes = Data("portable google drive backup".utf8)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1,
            provider: .googleDrive, accountID: UUID(), location: .cloudFolder(id: "Portable_Folder"))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(), destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(
                sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count)))
        return (plan, bytes, Credentials(value: try GoogleDriveBackupCredential(
            accountID: destination.accountID, providerAccountID: "gdrive:portable_permission",
            accessToken: "portable-fixture-token")))
    }

    private func account() throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "user": ["me": true, "permissionId": "portable_permission"],
        ]))
    }

    private func generated() throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "ids": ["portable_file"], "space": "drive", "kind": "drive#generatedIds",
        ]))
    }

    private func metadata(_ plan: RemoteBackupUploadPlan) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "id": "portable_file", "name": plan.objectName,
            "size": String(plan.package.byteCount), "sha256Checksum": plan.package.sha256,
            "headRevisionId": "portable_revision", "mimeType": GoogleDriveBackupTransport.mimeType,
            "parents": ["Portable_Folder"], "trashed": false,
            "capabilities": ["canDownload": true],
            "appProperties": ["xlog_backup_id": plan.backupID.uuidString.lowercased(),
                "xlog_sha256": plan.package.sha256],
        ])
    }

    @Test func exactRevisionUploadVerificationAndRestoreArePortable() async throws {
        let (plan, bytes, credentials) = try fixture()
        let value = try metadata(plan)
        let upload = HTTP([try account(), try generated(), Step(status: 200, body: value),
            try account(), Step(status: 200, body: value), Step(status: 200, body: bytes)])
        let transport = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: upload)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        let remote = try #require(try await transport.verifiedRemoteObject(plan: plan))
        #expect(remote.objectID == "gfile:portable_file")
        #expect(remote.revision == "grev:portable_revision")

        let receipt = try RemoteBackupUploadReceipt(plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: remote)
        let download = HTTP([try account(), Step(status: 200, body: bytes)])
        let restore = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: download)
        #expect(try await restore.downloadVerified(receipt: receipt) == bytes)
        let requests = await download.requests
        #expect(requests.last?.url == GoogleDriveBackupTransport.revisionURL(
            objectID: "portable_file", revisionID: "portable_revision"))
    }

    @Test func conflictsAndAmbiguousWritesRemainNonReplayable() async throws {
        let (plan, bytes, credentials) = try fixture()
        let http = HTTP([try account(), try generated(), Step(status: 409, body: Data())])
        let transport = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .conflict)
        await #expect(throws: GoogleDriveBackupError.operationInProgress) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await http.requests.count == 3)
    }

    @Test func providerNamespacesSurvivePersistence() throws {
        let remote = try RemoteBackupVerifiedObject(provider: .googleDrive,
            providerAccountID: "gdrive:portable_permission", objectID: "gfile:portable_file",
            revision: "grev:portable_revision")
        let encoded = try JSONEncoder().encode(remote)
        #expect(try JSONDecoder().decode(RemoteBackupVerifiedObject.self, from: encoded) == remote)
    }
}
