import Foundation
import Testing
@testable import XLogCore

@Suite struct FTPBackupTransportTests {
    private struct Credentials: FTPBackupCredentialSource {
        let value: FTPBackupCredential
        func credential(for accountID: UUID) async throws -> FTPBackupCredential { value }
    }

    private struct Upload: Sendable {
        let url: URL
        let directory: String
        let bytes: Data
        let requireTLS: Bool
    }

    private struct Download: Sendable {
        let url: URL
        let maximumBytes: Int
        let requireTLS: Bool
    }

    private actor Client: FTPBackupClient {
        var result: FTPBackupCreateResult
        var downloaded: [Data]
        var uploads: [Upload] = []
        var downloads: [Download] = []

        init(result: FTPBackupCreateResult = .created, downloaded: [Data] = []) {
            self.result = result
            self.downloaded = downloaded
        }

        func createDirectoryAndUpload(url: URL, directory: String,
                                      credential: FTPBackupCredential, bytes: Data,
                                      requireTLS: Bool) async throws -> FTPBackupCreateResult {
            uploads.append(Upload(url: url, directory: directory, bytes: bytes, requireTLS: requireTLS))
            return result
        }

        func download(url: URL, credential: FTPBackupCredential,
                      maximumBytes: Int, requireTLS: Bool) async throws -> Data {
            downloads.append(Download(url: url, maximumBytes: maximumBytes, requireTLS: requireTLS))
            guard !downloaded.isEmpty else { throw FTPBackupError.remoteRejected }
            return downloaded.removeFirst()
        }
    }

    private func fixture(provider: RemoteBackupProvider = .ftps,
                         bytes: Data = Data("immutable FTP fixture".utf8),
                         retention: RemoteBackupRetention = .keepAll)
        throws -> (RemoteBackupUploadPlan, Data, Credentials) {
        let accountID = UUID()
        let endpoint = try #require(URL(string: "\(provider.rawValue)://backup.example:990"))
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1,
            provider: provider, accountID: accountID,
            location: .server(endpoint: endpoint, directory: "/backups/logs"),
            security: provider == .ftp ? .explicitlyAcceptedPlainFTP : .authenticatedEncryptionRequired,
            retention: retention)
        let identity = try RemoteBackupPackageIdentity(
            sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(),
            destination: destination, backupID: UUID(), package: identity)
        let credential = try FTPBackupCredential(accountID: accountID,
            username: "fixture-user", password: "fixture-password")
        return (plan, bytes, Credentials(value: credential))
    }

    private func compact(_ id: UUID) -> String {
        id.uuidString.lowercased().replacingOccurrences(of: "-", with: "")
    }

    private func verifiedReceipt(_ plan: RemoteBackupUploadPlan) throws -> RemoteBackupUploadReceipt {
        let prefix = plan.destination.provider == .ftp ? "ftp" : "ftps"
        return try RemoteBackupUploadReceipt(plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: RemoteBackupVerifiedObject(provider: plan.destination.provider,
                providerAccountID: "\(prefix)acct:" + compact(plan.destination.accountID),
                objectID: "\(prefix)obj:" + compact(plan.backupID),
                revision: "\(prefix)sha:" + plan.package.sha256))
    }

    @Test func credentialsAreBoundedAndAlwaysRedacted() throws {
        let account = UUID()
        let value = try FTPBackupCredential(accountID: account, username: "user", password: "secret")
        #expect(value.accountID == account)
        #expect(value.description == "FTPBackupCredential(redacted)")
        #expect(value.debugDescription == "FTPBackupCredential(redacted)")
        for invalid in ["", "line\nfeed", "carriage\rreturn", "nul\0value"] {
            #expect(throws: FTPBackupError.invalidCredential) {
                _ = try FTPBackupCredential(accountID: account, username: invalid, password: "secret")
            }
            #expect(throws: FTPBackupError.invalidCredential) {
                _ = try FTPBackupCredential(accountID: account, username: "user", password: invalid)
            }
        }
    }

    @Test(arguments: [RemoteBackupProvider.ftp, .ftps])
    func exclusiveUploadAndIndependentRestoreUseAbsolutePinnedPath(provider: RemoteBackupProvider) async throws {
        let (plan, bytes, credentials) = try fixture(provider: provider)
        let client = Client(downloaded: [bytes, bytes])
        let transport = try FTPBackupTransport(destination: plan.destination,
            credentials: credentials, client: client)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        await #expect(throws: FTPBackupError.operationInProgress) {
            try await transport.verifiedRemoteObject(plan: plan)
        }
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        let receipt = try #require(try await transport.verifiedRemoteObject(plan: plan))
        #expect(try await transport.downloadVerified(
            receipt: RemoteBackupUploadReceipt(plan: plan,
                outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
                remoteObject: receipt)) == bytes)

        let reservation = "/backups/logs/.om0rx-xlog-" + compact(plan.backupID)
        let expected = "\(provider.rawValue)://backup.example:990/" + reservation
            + "/" + plan.objectName
        let uploads = await client.uploads
        let downloads = await client.downloads
        #expect(uploads.count == 1)
        #expect(uploads[0].directory == reservation)
        #expect(uploads[0].url.absoluteString == expected)
        #expect(uploads[0].bytes == bytes)
        #expect(uploads[0].requireTLS == (provider == .ftps))
        #expect(downloads.count == 2)
        #expect(downloads.allSatisfy { $0.url.absoluteString == expected })
        #expect(downloads.allSatisfy { $0.maximumBytes == bytes.count })
        #expect(downloads.allSatisfy { $0.requireTLS == (provider == .ftps) })
    }

    @Test func knownReservationRefusalWritesOnceAndCannotBeClaimedOrRetried() async throws {
        let (plan, bytes, credentials) = try fixture()
        let client = Client(result: .notCreated)
        let transport = try FTPBackupTransport(destination: plan.destination,
            credentials: credentials, client: client)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .notCreated)
        await #expect(throws: FTPBackupError.operationInProgress) {
            try await transport.verifiedRemoteIdentity(plan: plan)
        }
        await #expect(throws: FTPBackupError.operationInProgress) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await client.uploads.count == 1)
        #expect(await client.downloads.isEmpty)
    }

    @Test func mismatchedDownloadedBytesNeverProduceRemoteObjectOrVerifiedRestore() async throws {
        let (plan, bytes, credentials) = try fixture()
        let changed = Data("different bytes entirely".utf8)
        let client = Client(downloaded: [changed, changed])
        let transport = try FTPBackupTransport(destination: plan.destination,
            credentials: credentials, client: client)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) != plan.package)
        await #expect(throws: FTPBackupError.operationInProgress) {
            try await transport.verifiedRemoteObject(plan: plan)
        }
        await #expect(throws: FTPBackupError.invalidResponse) {
            try await transport.downloadVerified(receipt: verifiedReceipt(plan))
        }
    }

    @Test func providerSecurityRetentionAndAccountBoundariesFailClosed() async throws {
        let (plan, bytes, _) = try fixture()
        let wrong = Credentials(value: try FTPBackupCredential(accountID: UUID(),
            username: "wrong", password: "wrong"))
        let unused = Client()
        let transport = try FTPBackupTransport(destination: plan.destination,
            credentials: wrong, client: unused)
        await #expect(throws: FTPBackupError.accountMismatch) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await unused.uploads.isEmpty)

        let retention = try RemoteBackupRetention.keepLatestVerified(2)
        let retained = try fixture(retention: retention)
        #expect(throws: FTPBackupError.invalidDestination) {
            _ = try FTPBackupTransport(destination: retained.0.destination,
                credentials: retained.2, client: unused)
        }
        let sftp = try fixture(provider: .sftp)
        #expect(throws: FTPBackupError.unsupportedProvider) {
            _ = try FTPBackupTransport(destination: sftp.0.destination,
                credentials: sftp.2, client: unused)
        }
    }

    @Test func executorPersistsVerifiedReceiptAndRestartNeverReplays() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-ftp-executor-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("isolated.sqlite"))
        defer { database.close() }
        let manager = XLogBackupManager()
        let package = root.appendingPathComponent("fixture.xlogbackup")
        try manager.create(database: database, at: package, settings: .defaults,
            preferences: XLogBackupPreferences(deskBandMapBands: ["20m"],
                detachedBandMapBands: ["20m"], deskBandMapFollowsRadio: true,
                detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false))
        let envelope = try manager.prepareEnvelope(at: package)
        let (initial, _, credentials) = try fixture(bytes: envelope.data)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: initial.workspaceGeneration,
            destination: initial.destination, backupID: initial.backupID,
            package: envelope.identity)
        let client = Client(downloaded: [envelope.data])
        let state = root.appendingPathComponent("operations")
        let executor = try FTPBackupExecutor(destination: plan.destination,
            stateDirectory: state, credentials: credentials, client: client)
        let claim = RemoteBackupDueClaim(plan: plan, envelope: envelope,
            dueAt: Date(timeIntervalSince1970: 10_000),
            claimedAt: Date(timeIntervalSince1970: 10_000))
        let receipt = try await executor.execute(claim)
        guard case .verified(let identity, _) = receipt.outcome else {
            Issue.record("Expected independently verified FTP bytes")
            return
        }
        #expect(identity == envelope.identity)
        let expectedRemoteObject = try verifiedReceipt(plan).remoteObject
        #expect(receipt.remoteObject == expectedRemoteObject)
        #expect(try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: state) == [receipt])

        let unused = Client()
        let restarted = try FTPBackupExecutor(destination: plan.destination,
            stateDirectory: state, credentials: credentials, client: unused)
        #expect(try await restarted.execute(claim) == receipt)
        #expect(await unused.uploads.isEmpty)
        #expect(await unused.downloads.isEmpty)
    }

    @Test func verifiedObjectNamespacesCannotCrossProvidersOrAccounts() throws {
        let (plan, _, _) = try fixture(provider: .ftp)
        _ = try verifiedReceipt(plan)
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            _ = try RemoteBackupVerifiedObject(provider: .ftp,
                providerAccountID: "ftpsacct:" + compact(plan.destination.accountID),
                objectID: "ftpobj:" + compact(plan.backupID),
                revision: "ftpsha:" + plan.package.sha256)
        }
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            _ = try RemoteBackupVerifiedObject(provider: .ftps,
                providerAccountID: "ftpacct:" + compact(plan.destination.accountID),
                objectID: "ftpsobj:" + compact(plan.backupID),
                revision: "ftpssha:" + plan.package.sha256)
        }
    }
}
