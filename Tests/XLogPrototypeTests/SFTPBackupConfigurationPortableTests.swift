import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

@Suite struct SFTPBackupConfigurationPortableTests {
    private let generation = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    private let account = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
    private var fingerprint: String { "SHA256:" + Data(repeating: 1, count: 32).base64EncodedString().dropLast() }

    private func configuration(endpoint: String = "sftp://backup.example", directory: String = "/backups",
                               username: String = "operator", revision: UInt64 = 1,
                               generation: UUID? = nil, account: UUID? = nil,
                               algorithm: SFTPBackupHostKeyAlgorithm = .ed25519,
                               fingerprint: String? = nil) throws -> SFTPBackupConfiguration {
        try SFTPBackupConfiguration(workspaceGeneration: generation ?? self.generation,
            accountHandle: account ?? self.account, credentialRevision: revision,
            endpoint: endpoint, directory: directory, username: username,
            hostKeyPin: SFTPBackupHostKeyPin(algorithm: algorithm, fingerprint: fingerprint ?? self.fingerprint))
    }

    @Test func canonicalPinsRoundTripThroughValidatedDecoding() throws {
        for algorithm in [SFTPBackupHostKeyAlgorithm.ed25519, .ecdsaP256] {
            let pin = try SFTPBackupHostKeyPin(algorithm: algorithm, fingerprint: fingerprint)
            #expect(try JSONDecoder().decode(SFTPBackupHostKeyPin.self, from: JSONEncoder().encode(pin)) == pin)
        }
        let invalid = ["", "MD5:00:11", fingerprint.lowercased(), fingerprint + "=", fingerprint + "\n",
            " " + fingerprint, "SHA256:" + String(repeating: "A", count: 42),
            "SHA256:" + String(repeating: "A", count: 44), "SHA256:" + String(repeating: "_", count: 43),
            "SHA256:" + Data(repeating: 1, count: 31).base64EncodedString(),
            "SHA256:" + Data(repeating: 1, count: 33).base64EncodedString(),
            // Nonzero unused base64 bits must not alias the canonical digest.
            String(fingerprint.dropLast()) + "F"]
        for value in invalid {
            #expect(throws: SFTPBackupConfigurationError.invalidHostKeyPin) {
                try SFTPBackupHostKeyPin(algorithm: .ed25519, fingerprint: value)
            }
            let json = try JSONSerialization.data(withJSONObject: ["algorithm": "ssh-ed25519", "fingerprint": value])
            #expect(throws: (any Error).self) { try JSONDecoder().decode(SFTPBackupHostKeyPin.self, from: json) }
        }
        for algorithm in ["", "ssh-rsa", "ssh-dss", "rsa-sha2-256", "SHA256", "SSH-ED25519"] {
            let json = try JSONSerialization.data(withJSONObject: ["algorithm": algorithm, "fingerprint": fingerprint])
            #expect(throws: (any Error).self) { try JSONDecoder().decode(SFTPBackupHostKeyPin.self, from: json) }
        }
    }

    @Test func endpointsAndDirectoriesFailClosed() throws {
        for endpoint in ["", "https://backup.example", "ftps://backup.example", "sftp://",
            "sftp://user@backup.example", "sftp://user:secret@backup.example",
            "sftp://backup.example/path", "sftp://backup.example/%2F", "sftp://backup.example?q=x",
            "sftp://backup.example?", "sftp://backup.example#fragment", "sftp://backup.example#",
            "sftp://backup.example:0", "sftp://backup.example:65536", "sftp://backup.example:abc",
            "sftp://back up.example", "sftp://backup.example\n"] {
            #expect(throws: (any Error).self) { try configuration(endpoint: endpoint) }
        }
        for directory in ["relative", "/a/../b", "/./a", "/a//b", "/a/", "/%2e%2e",
                          "/a\\b", "/a\nb", "/" + String(repeating: "a", count: 4096)] {
            #expect(throws: RemoteBackupPlanningError.invalidPath) { try configuration(directory: directory) }
        }
        for username in ["", "user\nname", "user\rname", "user\0name", String(repeating: "a", count: 513)] {
            #expect(throws: SFTPBackupConfigurationError.invalidConfiguration) { try configuration(username: username) }
        }
        #expect(throws: SFTPBackupConfigurationError.invalidConfiguration) { try configuration(revision: 0) }
        _ = try configuration(directory: "/")
        _ = try configuration(endpoint: "sftp://[::1]:22", directory: "/xLog backups")
    }

    @Test func allAuthorityFieldsFenceIdentityAndEquivalentEndpointsCanonicalize() throws {
        let base = try configuration()
        #expect(try configuration(endpoint: "sftp://BACKUP.EXAMPLE:22/") == base)
        #expect(base.destination.provider == .sftp)
        #expect(base.destination.security == .authenticatedEncryptionRequired)
        #expect(base.destination.schedule == .disabled)
        #expect(base.destination.retention == .keepAll)
        for changed in [
            try configuration(endpoint: "sftp://other.example"),
            try configuration(endpoint: "sftp://backup.example:2222"),
            try configuration(username: "other"),
            try configuration(revision: 2),
            try configuration(generation: UUID()),
            try configuration(account: UUID()),
            try configuration(algorithm: .ecdsaP256),
            try configuration(fingerprint: "SHA256:" + Data(repeating: 2, count: 32).base64EncodedString().dropLast())
        ] {
            #expect(changed.destination.accountID != base.destination.accountID)
            #expect(changed.destination.id != base.destination.id)
            #expect(changed != base)
        }
        let directory = try configuration(directory: "/other")
        #expect(directory.destination.accountID == base.destination.accountID)
        #expect(directory.destination.id != base.destination.id)
        #expect(directory != base)
        #expect(try configuration() == base)
    }

    @Test func credentialsAreBoundedRedactedAndCannotBeSerialized() throws {
        let credential = try SFTPBackupPasswordCredential(accountHandle: account, credentialRevision: 1,
                                                          password: "unique-secret-sentinel")
        #expect(credential.accountHandle == account)
        #expect(credential.credentialRevision == 1)
        #expect(String(describing: credential) == "SFTPBackupPasswordCredential(redacted)")
        #expect(String(reflecting: credential) == "SFTPBackupPasswordCredential(redacted)")
        #expect(Mirror(reflecting: credential).children.isEmpty)
        var output = ""
        dump(credential, to: &output)
        #expect(!output.contains("unique-secret-sentinel"))
        func serializable(_ value: Any) -> Bool { value is any Encodable || value is any Decodable }
        #expect(!serializable(credential))
        #expect(!serializable(try configuration()))
        for password in ["", "line\nfeed", "nul\0value", "control\u{7f}", String(repeating: "a", count: 4097)] {
            #expect(throws: SFTPBackupConfigurationError.invalidCredential) {
                try SFTPBackupPasswordCredential(accountHandle: account, credentialRevision: 1, password: password)
            }
        }
        #expect(throws: SFTPBackupConfigurationError.invalidCredential) {
            try SFTPBackupPasswordCredential(accountHandle: account, credentialRevision: 0, password: "secret")
        }
        _ = try SFTPBackupPasswordCredential(accountHandle: account, credentialRevision: UInt64.max,
                                              password: String(repeating: "a", count: 4096))
    }
}
