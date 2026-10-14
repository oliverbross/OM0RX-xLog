import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if os(macOS)
import Security
import LocalAuthentication
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Read-only injection: this backup path cannot provision, refresh, migrate or
/// delete credentials. Implementations must never log values or raw vault errors.
protocol NativeBackupCredentialVault: Sendable {
    func read(service: String, account: String) throws -> String?
}

struct SystemNativeBackupCredentialVault: NativeBackupCredentialVault {
    func read(service: String, account: String) throws -> String? {
        let prefix = "dropbox-backup-v1-"
        let suffix = account.dropFirst(prefix.count)
        guard service.hasPrefix("com.oliverbross.OM0RXXLog.Integration."), service.utf8.count <= 128,
              !service.utf8.contains(where: { $0 < 32 || $0 == 127 }),
              account.hasPrefix(prefix), suffix.utf8.count == 64,
              suffix.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw DropboxBackupError.accountMismatch
        }
        #if os(macOS)
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            // A background backup must not display an unlock/access prompt.
            kSecUseAuthenticationContext as String: context,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count <= 8_192,
              let value = String(data: data, encoding: .utf8) else { throw DropboxBackupError.credentialUnavailable }
        return value
        #else
        // Windows uses the existing exact-key native vault. Unsupported systems
        // fail closed there; no plaintext or environment-variable fallback exists.
        do { return try NativeCredentialStore(service: service).load(account) }
        catch { throw DropboxBackupError.credentialUnavailable }
        #endif
    }
}

/// Non-secret account identity supplied by a future explicit OAuth/account boundary.
/// The provider identity is an expectation, never inferred from whichever token is found.
struct NativeDropboxBackupAccountBinding: Equatable, Sendable {
    let workspaceGeneration: UUID
    let destination: RemoteBackupDestination
    let keychainService: String
    let providerAccountID: String

    init(workspaceGeneration: UUID, destination: RemoteBackupDestination,
         keychainService: String, providerAccountID: String) throws {
        let tail = providerAccountID.dropFirst(5)
        guard destination.provider == .dropbox, providerAccountID.hasPrefix("dbid:"),
              !tail.isEmpty, providerAccountID.utf8.count <= 512,
              tail.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [45, 95].contains($0) }),
              keychainService.hasPrefix("com.oliverbross.OM0RXXLog.Integration."),
              keychainService.utf8.count <= 128,
              !keychainService.utf8.contains(where: { $0 < 32 || $0 == 127 }) else {
            throw DropboxBackupError.accountMismatch
        }
        self.workspaceGeneration = workspaceGeneration; self.destination = destination
        self.keychainService = keychainService; self.providerAccountID = providerAccountID
    }

    /// A bounded, versioned exact key; contains no secret and cannot collide with
    /// existing Wavelog/QRZ/native-app accounts. Rotation selects a new vault item.
    var vaultAccount: String {
        let material = [workspaceGeneration.uuidString.lowercased(), destination.accountID.uuidString.lowercased(), providerAccountID]
            .joined(separator: "\n")
        return "dropbox-backup-v1-" + SHA256.hash(data: Data(material.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

struct LiveDropboxBackupCredentialSource: DropboxBackupCredentialSource {
    let logbook: LiveLogbookMethods
    let binding: NativeDropboxBackupAccountBinding
    let checker: RemoteBackupAuthorizationChecker
    let vault: any NativeBackupCredentialVault

    func credential(for accountID: UUID) async throws -> DropboxBackupCredential {
        try Task.checkCancellation()
        return try logbook.withCurrentWorkspaceGeneration { current in
            guard current == binding.workspaceGeneration, accountID == binding.destination.accountID,
                  try logbook.currentKeychainService() == binding.keychainService else {
                throw DropboxBackupError.accountMismatch
            }
            try checker.validate(workspaceGeneration: current, destination: binding.destination)
            try Task.checkCancellation()
            let value: String?
            do { value = try vault.read(service: binding.keychainService, account: binding.vaultAccount) }
            catch {
                if Task.isCancelled || error is CancellationError { throw CancellationError() }
                throw DropboxBackupError.credentialUnavailable
            }
            try Task.checkCancellation()
            guard let value else { throw DropboxBackupError.credentialUnavailable }
            return try DropboxBackupCredential(accountID: accountID, providerAccountID: binding.providerAccountID, accessToken: value)
        }
    }
}
