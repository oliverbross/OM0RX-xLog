import Foundation
import Testing
@testable import XLogCore

@Suite struct FTPBackupLiveServerTests {
    private struct Credentials: FTPBackupCredentialSource {
        let value: FTPBackupCredential
        func credential(for accountID: UUID) async throws -> FTPBackupCredential { value }
    }

    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    @Test("Disposable FTP upload, independent verification and restore",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_FTP_LIVE_ENDPOINT"] != nil))
    func disposablePlainFTP() async throws {
        let endpoint = try #require(environment["XLOG_FTP_LIVE_ENDPOINT"])
        let username = try #require(environment["XLOG_FTP_LIVE_USERNAME"])
        let password = try #require(environment["XLOG_FTP_LIVE_PASSWORD"])
        let bytes = Data("OM0RX-xLog synthetic disposable FTP acceptance\n".utf8)
        let (plan, credentials) = try fixture(endpoint: endpoint, provider: .ftp,
                                              username: username, password: password,
                                              bytes: bytes)
        let transport = try FTPBackupTransport(destination: plan.destination,
                                               credentials: credentials)

        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        let remote = try #require(try await transport.verifiedRemoteObject(plan: plan))
        let receipt = try RemoteBackupUploadReceipt(
            plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: remote)
        #expect(try await transport.downloadVerified(receipt: receipt) == bytes)

        let replay = try FTPBackupTransport(destination: plan.destination,
                                            credentials: credentials)
        #expect(try await replay.createExclusively(plan: plan, bytes: bytes) == .notCreated)
    }

    @Test("Untrusted implicit FTPS certificate fails closed before upload",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_FTPS_UNTRUSTED_ENDPOINT"] != nil))
    func untrustedImplicitFTPS() async throws {
        let endpoint = try #require(environment["XLOG_FTPS_UNTRUSTED_ENDPOINT"])
        let username = try #require(environment["XLOG_FTP_LIVE_USERNAME"])
        let password = try #require(environment["XLOG_FTP_LIVE_PASSWORD"])
        let bytes = Data("must not cross an untrusted FTPS channel\n".utf8)
        let (plan, credentials) = try fixture(endpoint: endpoint, provider: .ftps,
                                              username: username, password: password,
                                              bytes: bytes)
        let transport = try FTPBackupTransport(destination: plan.destination,
                                               credentials: credentials)
        await #expect(throws: FTPBackupError.remoteRejected) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
    }

    private func fixture(endpoint: String, provider: RemoteBackupProvider,
                         username: String, password: String, bytes: Data)
        throws -> (RemoteBackupUploadPlan, Credentials) {
        let accountID = UUID()
        let destination = try RemoteBackupDestination(
            id: UUID(), revision: 1, provider: provider, accountID: accountID,
            location: .server(endpoint: try #require(URL(string: endpoint)),
                              directory: "/backups/logs"),
            security: provider == .ftp
                ? .explicitlyAcceptedPlainFTP
                : .authenticatedEncryptionRequired)
        let identity = try RemoteBackupPackageIdentity(
            sha256: BackupPackageSeal.hash(bytes), byteCount: Int64(bytes.count))
        let plan = try RemoteBackupUploadPlan(
            workspaceGeneration: UUID(), destination: destination,
            backupID: UUID(), package: identity)
        let credential = try FTPBackupCredential(
            accountID: accountID, username: username, password: password)
        return (plan, Credentials(value: credential))
    }
}
