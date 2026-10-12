import Foundation
import Security

public enum SecretStoreError: Error, LocalizedError {
    case keychain(OSStatus)
    case invalidData
    public var errorDescription: String? {
        switch self {
        case let .keychain(status): return "macOS Keychain returned status \(status)."
        case .invalidData: return "The Keychain value is not valid UTF-8."
        }
    }
}

public struct SecretStore: Sendable {
    public enum Account: String, Sendable {
        case wavelogToken = "wavelog-token"
        case qrzPassword = "qrz-password"
        case clubLogAPIKey = "clublog-api-key"
    }
    public static let service = "com.oliverbross.OM0RXXLog"
    private let serviceName: String
    public init(service: String = Self.service) { self.serviceName = service }

    public func load(_ account: Account) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SecretStoreError.keychain(status) }
        guard let data = item as? Data, let text = String(data: data, encoding: .utf8) else { throw SecretStoreError.invalidData }
        return text
    }

    public func save(_ value: String, for account: Account) throws {
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account.rawValue,
        ]
        if value.isEmpty {
            let status = SecItemDelete(identity as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw SecretStoreError.keychain(status) }
            return
        }
        let updates: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemUpdate(identity as CFDictionary, updates as CFDictionary)
        if status == errSecItemNotFound {
            var item = identity
            updates.forEach { item[$0.key] = $0.value }
            let add = SecItemAdd(item as CFDictionary, nil)
            guard add == errSecSuccess else { throw SecretStoreError.keychain(add) }
        } else if status != errSecSuccess {
            throw SecretStoreError.keychain(status)
        }
    }
}
