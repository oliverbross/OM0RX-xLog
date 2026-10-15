import Foundation

public enum SFTPBackupConfigurationError: Error, Equatable, Sendable {
    case invalidHostKeyPin, invalidConfiguration, invalidCredential
}

/// A deliberately limited host-key algorithm allowlist, independent of TLS/FTPS.
public enum SFTPBackupHostKeyAlgorithm: String, Codable, Sendable {
    case ed25519 = "ssh-ed25519"
    case ecdsaP256 = "ecdsa-sha2-nistp256"
}

/// SHA-256 of the complete SSH public host-key blob, in canonical OpenSSH form.
/// This value is configuration, never trust-on-first-use or connection authority.
public struct SFTPBackupHostKeyPin: Equatable, Sendable, Codable {
    public let algorithm: SFTPBackupHostKeyAlgorithm
    public let fingerprint: String

    public init(algorithm: SFTPBackupHostKeyAlgorithm, fingerprint: String) throws {
        guard fingerprint.hasPrefix("SHA256:") else { throw SFTPBackupConfigurationError.invalidHostKeyPin }
        let encoded = String(fingerprint.dropFirst(7))
        guard encoded.utf8.count == 43,
              let digest = Data(base64Encoded: encoded + "="), digest.count == 32,
              digest.base64EncodedString() == encoded + "=" else {
            throw SFTPBackupConfigurationError.invalidHostKeyPin
        }
        self.algorithm = algorithm
        self.fingerprint = fingerprint
    }

    private enum CodingKeys: String, CodingKey { case algorithm, fingerprint }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(algorithm: values.decode(SFTPBackupHostKeyAlgorithm.self, forKey: .algorithm),
                      fingerprint: values.decode(String.self, forKey: .fingerprint))
    }
}

/// Native, non-Codable configuration binding only. No live transport or Settings
/// registration exists. A future driver must verify this pin before authentication.
public struct SFTPBackupConfiguration: Equatable, Sendable {
    public let workspaceGeneration: UUID
    public let accountHandle: UUID
    public let credentialRevision: UInt64
    public let username: String
    public let hostKeyPin: SFTPBackupHostKeyPin
    public let destination: RemoteBackupDestination

    public init(workspaceGeneration: UUID, accountHandle: UUID, credentialRevision: UInt64,
                endpoint: String, directory: String, username: String,
                hostKeyPin: SFTPBackupHostKeyPin) throws {
        guard credentialRevision > 0, Self.validText(username, maximum: 512),
              endpoint.utf8.count <= 4_096,
              !endpoint.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.contains($0)
                  || CharacterSet.controlCharacters.contains($0) }),
              var parts = URLComponents(string: endpoint), parts.scheme == "sftp",
              let host = parts.host, !host.isEmpty,
              host.utf8.allSatisfy({ $0 > 32 && $0 < 127 && $0 != 37 }),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              parts.port.map({ (1...65_535).contains($0) }) ?? true else {
            throw SFTPBackupConfigurationError.invalidConfiguration
        }
        parts.host = host.lowercased()
        parts.port = parts.port ?? 22
        parts.path = ""
        guard let canonicalEndpoint = parts.url else { throw SFTPBackupConfigurationError.invalidConfiguration }
        // Length-delimited JSON avoids delimiter collisions in usernames/paths.
        let accountMaterial = ["sftp-account-v1", workspaceGeneration.uuidString.lowercased(),
            accountHandle.uuidString.lowercased(), String(credentialRevision), canonicalEndpoint.absoluteString,
            username, hostKeyPin.algorithm.rawValue, hostKeyPin.fingerprint]
        let accountID = try Self.identifier(accountMaterial)
        let destinationID = try Self.identifier(["sftp-destination-v1", accountID.uuidString.lowercased(), directory])
        self.destination = try RemoteBackupDestination(id: destinationID, revision: credentialRevision,
            provider: .sftp, accountID: accountID,
            location: .server(endpoint: canonicalEndpoint, directory: directory))
        self.workspaceGeneration = workspaceGeneration
        self.accountHandle = accountHandle
        self.credentialRevision = credentialRevision
        self.username = username
        self.hostKeyPin = hostKeyPin
    }

    private static func identifier(_ components: [String]) throws -> UUID {
        let data = try JSONSerialization.data(withJSONObject: components)
        let hex = BackupPackageSeal.hash(data)
        let formatted = "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20).prefix(12))"
        guard let id = UUID(uuidString: formatted) else { throw SFTPBackupConfigurationError.invalidConfiguration }
        return id
    }

    fileprivate static func validText(_ value: String, maximum: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= maximum
            && value.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
    }
}

/// Ephemeral native password value; intentionally neither Codable nor reflected.
/// No credential retrieval, persistence, or renderer API is provided here.
public struct SFTPBackupPasswordCredential: Sendable, CustomStringConvertible,
    CustomDebugStringConvertible, CustomReflectable {
    public let accountHandle: UUID
    public let credentialRevision: UInt64
    let password: String

    public init(accountHandle: UUID, credentialRevision: UInt64, password: String) throws {
        guard credentialRevision > 0, SFTPBackupConfiguration.validText(password, maximum: 4_096) else {
            throw SFTPBackupConfigurationError.invalidCredential
        }
        self.accountHandle = accountHandle
        self.credentialRevision = credentialRevision
        self.password = password
    }

    public var description: String { "SFTPBackupPasswordCredential(redacted)" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: [Mirror.Child]()) }
}
