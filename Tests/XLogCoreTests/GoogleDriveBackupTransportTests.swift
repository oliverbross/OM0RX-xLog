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

@Suite struct GoogleDriveBackupTransportTests {
    private struct Credentials: GoogleDriveBackupCredentialSource {
        let value: GoogleDriveBackupCredential
        func credential(for accountID: UUID) async throws -> GoogleDriveBackupCredential { value }
    }

    private struct Step: Sendable {
        let status: Int
        let body: Data
        var url: URL?
        var fail = false
    }

    private actor HTTP: GoogleDriveBackupHTTPClient {
        var steps: [Step]
        var requests: [URLRequest] = []
        init(_ steps: [Step]) { self.steps = steps }

        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> GoogleDriveBackupHTTPResponse {
            requests.append(request)
            guard !steps.isEmpty else { throw GoogleDriveBackupError.requestFailed }
            let step = steps.removeFirst()
            if step.fail { throw URLError(.timedOut, userInfo: [NSLocalizedDescriptionKey: "untrusted-provider-detail"]) }
            return GoogleDriveBackupHTTPResponse(url: step.url ?? request.url!,
                statusCode: step.status, body: step.body)
        }
    }

    private func fixture() throws -> (RemoteBackupUploadPlan, Data, Credentials) {
        let bytes = Data("isolated google drive backup bytes".utf8)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1,
            provider: .googleDrive, accountID: UUID(),
            location: .cloudFolder(id: "Fixture_Folder"))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(), destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(
                sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count)))
        let credential = try GoogleDriveBackupCredential(accountID: destination.accountID,
            providerAccountID: "gdrive:permission_fixture", accessToken: "fixture-only-not-a-real-token")
        return (plan, bytes, Credentials(value: credential))
    }

    private func account(_ id: String = "permission_fixture") throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "user": ["me": true, "permissionId": id],
        ]))
    }

    private func generated(_ id: String = "generated_file_123") throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: [
            "ids": [id], "space": "drive", "kind": "drive#generatedIds",
        ]))
    }

    private func metadata(_ plan: RemoteBackupUploadPlan,
                          id: String = "generated_file_123",
                          revision: String = "head_revision_456",
                          sha256: String? = nil) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "id": id,
            "name": plan.objectName,
            "size": String(plan.package.byteCount),
            "sha256Checksum": sha256 ?? plan.package.sha256,
            "headRevisionId": revision,
            "mimeType": GoogleDriveBackupTransport.mimeType,
            "parents": ["Fixture_Folder"],
            "appProperties": [
                "xlog_backup_id": plan.backupID.uuidString.lowercased(),
                "xlog_sha256": plan.package.sha256,
            ],
            "trashed": false,
            "capabilities": ["canDownload": true],
        ])
    }

    private func receipt(_ plan: RemoteBackupUploadPlan) throws -> RemoteBackupUploadReceipt {
        try RemoteBackupUploadReceipt(plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: RemoteBackupVerifiedObject(provider: .googleDrive,
                providerAccountID: "gdrive:permission_fixture",
                objectID: "gfile:generated_file_123",
                revision: "grev:head_revision_456"))
    }

    @Test func preGeneratedCreatePinsAndVerifiesExactRevision() async throws {
        let (plan, bytes, credentials) = try fixture()
        let value = try metadata(plan)
        let http = HTTP([try account(), try generated(), Step(status: 200, body: value),
            try account(), Step(status: 200, body: value), Step(status: 200, body: bytes)])
        let transport = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)

        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        await #expect(throws: GoogleDriveBackupError.operationInProgress) {
            try await transport.verifiedRemoteObject(plan: plan)
        }
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        #expect(try await transport.verifiedRemoteObject(plan: plan) == RemoteBackupVerifiedObject(
            provider: .googleDrive, providerAccountID: "gdrive:permission_fixture",
            objectID: "gfile:generated_file_123", revision: "grev:head_revision_456"))

        let requests = await http.requests
        #expect(requests.count == 6)
        #expect(requests[0].url == GoogleDriveBackupTransport.accountURL)
        #expect(requests[1].url == GoogleDriveBackupTransport.generateIDURL)
        #expect(requests[2].url == GoogleDriveBackupTransport.uploadURL)
        #expect(requests[4].url == GoogleDriveBackupTransport.metadataURL(objectID: "generated_file_123"))
        #expect(requests[5].url == GoogleDriveBackupTransport.revisionURL(
            objectID: "generated_file_123", revisionID: "head_revision_456"))
        #expect(requests.allSatisfy { $0.url?.scheme == "https" && $0.timeoutInterval == 30 })
        let body = try #require(requests[2].httpBody)
        #expect(String(decoding: body, as: UTF8.self).contains(plan.objectName))
        #expect(String(decoding: body, as: UTF8.self).contains("generated_file_123"))
        #expect(body.range(of: bytes) != nil)
        #expect(credentials.value.description == "GoogleDriveBackupCredential(redacted)")
    }

    @Test func restoreReadsOnlyPinnedRevisionAndRechecksHash() async throws {
        let (plan, bytes, credentials) = try fixture()
        let http = HTTP([try account(), Step(status: 200, body: bytes)])
        let transport = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        #expect(try await transport.downloadVerified(receipt: receipt(plan)) == bytes)
        let requests = await http.requests
        #expect(requests.count == 2)
        #expect(requests[1].url == GoogleDriveBackupTransport.revisionURL(
            objectID: "generated_file_123", revisionID: "head_revision_456"))
        #expect(!(requests[1].url?.absoluteString.contains(plan.objectName) ?? true))

        let corrupt = HTTP([try account(), Step(status: 200, body: Data("changed".utf8))])
        let rejected = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: corrupt)
        await #expect(throws: GoogleDriveBackupError.invalidResponse) {
            try await rejected.downloadVerified(receipt: receipt(plan))
        }
    }

    @Test func conflictAndAmbiguousCreateAreNeverReplayed() async throws {
        let (plan, bytes, credentials) = try fixture()
        let conflict = HTTP([try account(), try generated(), Step(status: 409, body: Data())])
        let transport = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: conflict)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .conflict)
        await #expect(throws: GoogleDriveBackupError.operationInProgress) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await conflict.requests.count == 3)

        let failed = HTTP([try account(), try generated(), Step(status: 200, body: Data(), fail: true)])
        let uncertain = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: failed)
        await #expect(throws: GoogleDriveBackupError.requestFailed) {
            try await uncertain.createExclusively(plan: plan, bytes: bytes)
        }
        await #expect(throws: GoogleDriveBackupError.operationInProgress) {
            try await uncertain.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await failed.requests.count == 3)
    }

    @Test func accountContextMetadataAndRedirectsFailClosed() async throws {
        let (plan, bytes, credentials) = try fixture()
        let wrong = HTTP([try account("another_permission")])
        let mismatch = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: wrong)
        await #expect(throws: GoogleDriveBackupError.accountMismatch) {
            try await mismatch.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await wrong.requests.count == 1)

        let badHash = try metadata(plan, sha256: String(repeating: "0", count: 64))
        let invalid = HTTP([try account(), try generated(), Step(status: 200, body: badHash)])
        let badMetadata = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: invalid)
        await #expect(throws: GoogleDriveBackupError.invalidResponse) {
            try await badMetadata.createExclusively(plan: plan, bytes: bytes)
        }

        let redirected = URL(string: "https://example.invalid/drive")!
        let redirect = HTTP([Step(status: 200, body: Data(), url: redirected)])
        await #expect(throws: GoogleDriveBackupError.redirectRejected) {
            try await GoogleDriveBackupAccountProbe(http: redirect).verify(credentials.value)
        }

        let changed = try RemoteBackupDestination(id: plan.destination.id, revision: 2,
            provider: .googleDrive, accountID: plan.destination.accountID,
            location: plan.destination.location)
        let rebound = try RemoteBackupUploadPlan(workspaceGeneration: plan.workspaceGeneration,
            destination: changed, backupID: plan.backupID, package: plan.package)
        let unused = HTTP([])
        let stale = try GoogleDriveBackupTransport(destination: plan.destination,
            credentials: credentials, http: unused)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await stale.createExclusively(plan: rebound, bytes: bytes)
        }
        #expect(await unused.requests.isEmpty)
    }

    @Test func executorPersistsVerifiedReceiptAndRestartDoesNotContactDrive() async throws {
        let (initial, _, credentials) = try fixture()
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-google-drive-executor-\(UUID().uuidString)")
        let database = try LogbookDatabase(url: root.appendingPathComponent("isolated.sqlite"))
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let manager = XLogBackupManager()
        let package = root.appendingPathComponent("fixture.xlogbackup")
        try manager.create(database: database, at: package, settings: .defaults,
            preferences: XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
                deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false))
        let envelope = try manager.prepareEnvelope(at: package)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: initial.workspaceGeneration,
            destination: initial.destination, backupID: initial.backupID, package: envelope.identity)
        let value = try metadata(plan)
        let http = HTTP([try account(), try generated(), Step(status: 200, body: value),
            try account(), Step(status: 200, body: value), Step(status: 200, body: envelope.data)])
        let directory = root.appendingPathComponent("operations")
        let executor = try GoogleDriveBackupExecutor(destination: plan.destination,
            stateDirectory: directory, credentials: credentials, http: http)
        let claim = RemoteBackupDueClaim(plan: plan, envelope: envelope,
            dueAt: Date(timeIntervalSince1970: 10_000), claimedAt: Date(timeIntervalSince1970: 10_000))
        let saved = try await executor.execute(claim)
        #expect(saved.remoteObject?.provider == .googleDrive)
        #expect(saved.remoteObject?.objectID == "gfile:generated_file_123")
        #expect(saved.remoteObject?.revision == "grev:head_revision_456")
        #expect(try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: directory) == [saved])

        let unused = HTTP([])
        let restarted = try GoogleDriveBackupExecutor(destination: plan.destination,
            stateDirectory: directory, credentials: credentials, http: unused)
        #expect(try await restarted.execute(claim) == saved)
        #expect(await unused.requests.isEmpty)
    }

    @Test func verifiedObjectNamespacesRejectCrossProviderRebinding() throws {
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            try RemoteBackupVerifiedObject(provider: .googleDrive,
                providerAccountID: "dbid:account", objectID: "gfile:file", revision: "grev:revision")
        }
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            try RemoteBackupVerifiedObject(provider: .dropbox,
                providerAccountID: "gdrive:account", objectID: "id:file", revision: "abcdef123")
        }
    }

    @Test func adapterRejectsRetentionUntilConditionalDriveDeletionExists() throws {
        let (plan, _, credentials) = try fixture()
        let destination = try RemoteBackupDestination(id: plan.destination.id, revision: 2,
            provider: .googleDrive, accountID: plan.destination.accountID,
            location: plan.destination.location, retention: .keepLatestVerified(3))
        #expect(throws: GoogleDriveBackupError.invalidDestination) {
            try GoogleDriveBackupTransport(destination: destination,
                credentials: credentials, http: HTTP([]))
        }
    }

    @Test func defaultClientAllowlistAcceptsOnlyExactDriveRoutes() throws {
        let (_, _, credentials) = try fixture()
        var account = URLRequest(url: GoogleDriveBackupTransport.accountURL)
        account.httpMethod = "GET"
        #expect(GoogleDriveBackupTransport.allows(account))
        var upload = URLRequest(url: GoogleDriveBackupTransport.uploadURL)
        upload.httpMethod = "POST"
        #expect(GoogleDriveBackupTransport.allows(upload))
        var revision = URLRequest(url: try #require(GoogleDriveBackupTransport.revisionURL(
            objectID: "file_id", revisionID: "revision_id")))
        revision.httpMethod = "GET"
        #expect(GoogleDriveBackupTransport.allows(revision))

        var wrongHost = URLRequest(url: URL(string: "https://example.invalid/drive/v3/about?fields=user(me,permissionId)")!)
        wrongHost.httpMethod = "GET"
        #expect(!GoogleDriveBackupTransport.allows(wrongHost))
        var wrongMethod = account
        wrongMethod.httpMethod = "POST"
        #expect(!GoogleDriveBackupTransport.allows(wrongMethod))
        var extraQuery = account
        extraQuery.url = URL(string: account.url!.absoluteString + "&pageToken=foreign")
        #expect(!GoogleDriveBackupTransport.allows(extraQuery))
        #expect(credentials.value.description == "GoogleDriveBackupCredential(redacted)")
    }
}
