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

    @Test("Disposable FTP reservation refusal writes no object",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_FTP_REFUSAL_ENDPOINT"] != nil))
    func reservationRefusal() async throws {
        let endpoint = try #require(environment["XLOG_FTP_REFUSAL_ENDPOINT"])
        let username = try #require(environment["XLOG_FTP_LIVE_USERNAME"])
        let password = try #require(environment["XLOG_FTP_LIVE_PASSWORD"])
        let bytes = Data("reservation refusal must write nothing\n".utf8)
        let (plan, credentials) = try fixture(endpoint: endpoint, provider: .ftp,
                                              username: username, password: password,
                                              bytes: bytes)
        let transport = try FTPBackupTransport(destination: plan.destination,
                                               credentials: credentials)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .notCreated)
    }

    @Test("Lost FTP acknowledgement remains uncertain and is not replayed",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_FTP_LOST_ACK_ENDPOINT"] != nil))
    func lostAcknowledgement() async throws {
        let endpoint = try #require(environment["XLOG_FTP_LOST_ACK_ENDPOINT"])
        let username = try #require(environment["XLOG_FTP_LIVE_USERNAME"])
        let password = try #require(environment["XLOG_FTP_LIVE_PASSWORD"])
        let bytes = Data("stored bytes with deliberately lost acknowledgement\n".utf8)
        let (plan, credentials) = try fixture(endpoint: endpoint, provider: .ftp,
                                              username: username, password: password,
                                              bytes: bytes)
        let transport = try FTPBackupTransport(destination: plan.destination,
                                               credentials: credentials)
        await #expect(throws: FTPBackupError.remoteRejected) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        await #expect(throws: FTPBackupError.operationInProgress) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
    }

    @Test("Oversized advertised or streamed FTP download fails closed",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_FTP_OVERSIZED_ADVERTISED_ENDPOINT"] != nil),
          arguments: ["ADVERTISED", "STREAMED"])
    func oversizedDownload(mode: String) async throws {
        let endpoint = try #require(environment["XLOG_FTP_OVERSIZED_\(mode)_ENDPOINT"])
        let username = try #require(environment["XLOG_FTP_LIVE_USERNAME"])
        let password = try #require(environment["XLOG_FTP_LIVE_PASSWORD"])
        let bytes = Data("bounded synthetic FTP download\n".utf8)
        let (plan, credentials) = try fixture(endpoint: endpoint, provider: .ftp,
                                              username: username, password: password, bytes: bytes)
        let transport = try FTPBackupTransport(destination: plan.destination, credentials: credentials)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        await #expect(throws: FTPBackupError.responseTooLarge) {
            try await transport.verifiedRemoteIdentity(plan: plan)
        }
        await #expect(throws: FTPBackupError.operationInProgress) {
            try await transport.verifiedRemoteObject(plan: plan)
        }
    }

    @Test("FTP restore rejects an object that grew after verification",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_FTP_OVERSIZED_RESTORE_ENDPOINT"] != nil))
    func oversizedRestore() async throws {
        let endpoint = try #require(environment["XLOG_FTP_OVERSIZED_RESTORE_ENDPOINT"])
        let username = try #require(environment["XLOG_FTP_LIVE_USERNAME"])
        let password = try #require(environment["XLOG_FTP_LIVE_PASSWORD"])
        let bytes = Data("verified before synthetic remote growth\n".utf8)
        let (plan, credentials) = try fixture(endpoint: endpoint, provider: .ftp,
                                              username: username, password: password, bytes: bytes)
        let transport = try FTPBackupTransport(destination: plan.destination, credentials: credentials)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        let remote = try #require(try await transport.verifiedRemoteObject(plan: plan))
        let receipt = try RemoteBackupUploadReceipt(
            plan: plan, outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: remote)
        await #expect(throws: FTPBackupError.responseTooLarge) {
            try await transport.downloadVerified(receipt: receipt)
        }
    }

    @Test("FTP control handshake times out before any object write",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_FTP_TIMEOUT_ENDPOINT"] != nil))
    func controlHandshakeTimeout() async throws {
        let endpoint = try #require(environment["XLOG_FTP_TIMEOUT_ENDPOINT"])
        let username = try #require(environment["XLOG_FTP_LIVE_USERNAME"])
        let password = try #require(environment["XLOG_FTP_LIVE_PASSWORD"])
        let bytes = Data("timeout must write nothing\n".utf8)
        let (plan, credentials) = try fixture(endpoint: endpoint, provider: .ftp,
                                              username: username, password: password, bytes: bytes)
        let transport = try FTPBackupTransport(destination: plan.destination, credentials: credentials)
        let clock = ContinuousClock()
        let started = clock.now
        await #expect(throws: FTPBackupError.remoteRejected) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        let elapsed = started.duration(to: clock.now)
        #expect(elapsed >= .seconds(10))
        #expect(elapsed < .seconds(25))
        await #expect(throws: FTPBackupError.operationInProgress) {
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
