import CryptoKit
import Foundation
import Security

public enum RemoteAgentCredentialError: LocalizedError, Sendable {
    case keychain(OSStatus)

    public var errorDescription: String? {
        switch self {
        case let .keychain(status): "macOS Keychain returned status \(status)."
        }
    }
}

public struct RemoteAgentKeychain: Sendable {
    private let service = "com.oliverbross.OM0RXXCat.remote-agent"
    private let account: String

    public init(endpointIdentifier: String) {
        var normalized = endpointIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        while normalized.hasSuffix("/") { normalized.removeLast() }
        account = SHA256.hash(data: Data(normalized.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    public func loadToken() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else {
            throw RemoteAgentCredentialError.keychain(status)
        }
        return token
    }

    public func saveToken(_ token: String) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let updates: [String: Any] = [
            kSecValueData as String: Data(trimmed.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(identity as CFDictionary, updates as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var add = identity
            updates.forEach { add[$0.key] = $0.value }
            let status = SecItemAdd(add as CFDictionary, nil)
            guard status == errSecSuccess else { throw RemoteAgentCredentialError.keychain(status) }
        } else if updateStatus != errSecSuccess {
            throw RemoteAgentCredentialError.keychain(updateStatus)
        }
    }

    public func deleteToken() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw RemoteAgentCredentialError.keychain(status)
        }
    }
}
