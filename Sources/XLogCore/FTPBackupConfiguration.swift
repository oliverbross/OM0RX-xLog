import Foundation

public enum FTPBackupConfigurationError: Error, Equatable, Sendable {
    case invalidCertificateAuthority, invalidConfiguration
}

/// SHA-256 of the exact configured PEM bytes, plus its native trust revision.
/// This is approval/receipt identity, never a substitute for TLS verification.
public struct FTPSBackupTrustIdentity: Equatable, Sendable, Codable {
    public let sha256: String
    public let revision: UInt64

    public init(sha256: String, revision: UInt64) throws {
        guard revision > 0, sha256.utf8.count == 64,
              sha256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw FTPBackupConfigurationError.invalidCertificateAuthority
        }
        self.sha256 = sha256; self.revision = revision
    }

    private enum CodingKeys: String, CodingKey { case sha256, revision }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(sha256: values.decode(String.self, forKey: .sha256),
                      revision: values.decode(UInt64.self, forKey: .revision))
    }
}

/// One bounded PEM certificate held only in native memory. libcurl parses the
/// certificate and verifies both the peer chain and hostname on every request.
public struct FTPBackupCertificateAuthority: Equatable, Sendable {
    public let identity: FTPSBackupTrustIdentity
    let pem: Data

    public init(pem: Data, revision: UInt64) throws {
        let begin = "-----BEGIN CERTIFICATE-----\n", end = "-----END CERTIFICATE-----"
        guard !pem.isEmpty, pem.count <= 65_536, let text = String(data: pem, encoding: .utf8),
              text.hasPrefix(begin), text.hasSuffix(end) || text.hasSuffix(end + "\n") else {
            throw FTPBackupConfigurationError.invalidCertificateAuthority
        }
        let body = text.dropFirst(begin.count).components(separatedBy: end)
        guard body.count == 2, body[1] == "" || body[1] == "\n",
              body[0].utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0)
                || (48...57).contains($0) || [43, 47, 61, 10].contains($0) }),
              let der = Data(base64Encoded: body[0].replacingOccurrences(of: "\n", with: "")),
              !der.isEmpty else { throw FTPBackupConfigurationError.invalidCertificateAuthority }
        self.pem = pem
        self.identity = try FTPSBackupTrustIdentity(sha256: BackupPackageSeal.hash(pem), revision: revision)
    }
}

/// Native configuration only: no Settings, renderer, vault or persistence API.
/// Trust bytes/revision change both account and destination authority.
public struct FTPBackupConfiguration: Equatable, Sendable {
    public let workspaceGeneration: UUID
    public let accountHandle: UUID
    public let credentialRevision: UInt64
    public let username: String
    public let certificateAuthority: FTPBackupCertificateAuthority?
    public let destination: RemoteBackupDestination

    public init(workspaceGeneration: UUID, accountHandle: UUID, credentialRevision: UInt64,
                provider: RemoteBackupProvider, endpoint: String, directory: String, username: String,
                plainFTPConfirmed: Bool = false,
                certificateAuthority: FTPBackupCertificateAuthority? = nil) throws {
        guard credentialRevision > 0, [.ftp, .ftps].contains(provider),
              (provider == .ftp) == plainFTPConfirmed,
              certificateAuthority == nil || provider == .ftps,
              !username.isEmpty, username.utf8.count <= 512,
              !username.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              endpoint.utf8.count <= 4_096,
              !endpoint.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.contains($0)
                  || CharacterSet.controlCharacters.contains($0) }),
              var parts = URLComponents(string: endpoint), parts.scheme == provider.rawValue,
              let host = parts.host, !host.isEmpty,
              host.utf8.allSatisfy({ $0 > 32 && $0 < 127 && $0 != 37 }),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              !endpoint.dropFirst((provider.rawValue + "://").count).prefix(while: { !"/?#".contains($0) }).hasSuffix(":"),
              parts.port.map({ (1...65_535).contains($0) }) ?? true else {
            throw FTPBackupConfigurationError.invalidConfiguration
        }
        parts.host = host.lowercased(); parts.port = parts.port ?? (provider == .ftp ? 21 : 990); parts.path = ""
        guard let canonical = parts.url else { throw FTPBackupConfigurationError.invalidConfiguration }
        let trust = certificateAuthority?.identity
        let accountID = try Self.identifier(["ftp-native-account-v1", workspaceGeneration.uuidString.lowercased(),
            accountHandle.uuidString.lowercased(), String(credentialRevision), provider.rawValue,
            canonical.absoluteString, username, trust?.sha256 ?? "system",
            trust.map { String($0.revision) } ?? "system"])
        let destinationID = try Self.identifier(["ftp-native-destination-v1", accountID.uuidString.lowercased(), directory])
        destination = try RemoteBackupDestination(id: destinationID, revision: credentialRevision,
            provider: provider, accountID: accountID, location: .server(endpoint: canonical, directory: directory),
            security: provider == .ftp ? .explicitlyAcceptedPlainFTP : .authenticatedEncryptionRequired,
            ftpsTrust: trust)
        self.workspaceGeneration = workspaceGeneration; self.accountHandle = accountHandle
        self.credentialRevision = credentialRevision; self.username = username
        self.certificateAuthority = certificateAuthority
    }

    private static func identifier(_ components: [String]) throws -> UUID {
        let hex = BackupPackageSeal.hash(try JSONSerialization.data(withJSONObject: components))
        let text = "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20).prefix(12))"
        guard let value = UUID(uuidString: text) else { throw FTPBackupConfigurationError.invalidConfiguration }
        return value
    }
}
