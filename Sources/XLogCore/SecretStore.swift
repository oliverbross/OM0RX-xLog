import Foundation
import LocalAuthentication
import Security

public enum SecretStoreError: Error, LocalizedError, Sendable {
    case keychain(OSStatus)
    case invalidData
    public var errorDescription: String? {
        switch self {
        case let .keychain(status): return "macOS Keychain returned status \(status)."
        case .invalidData: return "The Keychain value is not valid UTF-8."
        }
    }
}

/// Process-lifetime memoization for passive Keychain reads. The worker polls
/// several status surfaces; neither a missing item nor a denied noninteractive
/// read should turn those snapshots into a Keychain query loop.
final class SecretStorePassiveCache: @unchecked Sendable {
    struct Key: Hashable { let service: String; let account: String }
    enum Value { case present(String), missing, failed(SecretStoreError) }
    enum Presence { case present, missing, failed(SecretStoreError) }

    private let lock = NSLock()
    private var values: [Key: Value] = [:]
    private var presences: [Key: Presence] = [:]

    func load(key: Key, bypass: Bool, operation: () throws -> String?) throws -> String? {
        if bypass {
            do {
                let value = try operation()
                record(value, for: key)
                return value
            } catch { throw error }
        }
        lock.lock(); defer { lock.unlock() }
        if let cached = values[key] { return try resolve(cached) }
        do {
            let value = try operation()
            values[key] = value.map(Value.present) ?? .missing
            presences[key] = value == nil ? .missing : .present
            return value
        } catch let error as SecretStoreError {
            values[key] = .failed(error)
            throw error
        }
    }

    func contains(key: Key, operation: () throws -> Bool) throws -> Bool {
        lock.lock(); defer { lock.unlock() }
        if let value = values[key] {
            switch value {
            case .present: return true
            case .missing: return false
            case let .failed(error): throw error
            }
        }
        if let cached = presences[key] {
            switch cached {
            case .present: return true
            case .missing: return false
            case let .failed(error): throw error
            }
        }
        do {
            let present = try operation()
            presences[key] = present ? .present : .missing
            return present
        } catch let error as SecretStoreError {
            presences[key] = .failed(error)
            throw error
        }
    }

    func record(_ value: String?, for key: Key) {
        lock.lock(); defer { lock.unlock() }
        values[key] = value.map(Value.present) ?? .missing
        presences[key] = value == nil ? .missing : .present
    }

    private func resolve(_ value: Value) throws -> String? {
        switch value {
        case let .present(secret): return secret
        case .missing: return nil
        case let .failed(error): throw error
        }
    }
}

public struct SecretStore: Sendable {
    public enum Account: String, Sendable {
        case wavelogToken = "wavelog-token"
        case qrzPassword = "qrz-password"
        case qrzLogbookKey = "qrz-logbook-key"
        case clubLogAPIKey = "clublog-api-key"
        case clubLogEmail = "clublog-email"
        case clubLogApplicationPassword = "clublog-application-password"
        case clubLogCallsign = "clublog-callsign"
        case ftpBackupPassword = "ftp-backup-password"
    }
    public static let service = "com.oliverbross.OM0RXXLog"
    private static let passiveCache = SecretStorePassiveCache()
    private let serviceName: String
    public init(service: String = Self.service) { self.serviceName = service }

    public func load(_ account: Account, allowInteraction: Bool = true) throws -> String? {
        let key = SecretStorePassiveCache.Key(service: serviceName, account: account.rawValue)
        return try Self.passiveCache.load(key: key, bypass: allowInteraction) {
            try uncachedLoad(account, allowInteraction: allowInteraction)
        }
    }

    private func uncachedLoad(_ account: Account, allowInteraction: Bool) throws -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        // Background services must never put up an authorization dialog. A
        // legacy Keychain ACL can otherwise block Sync and its status controls
        // until the native worker times out.
        if !allowInteraction {
            if #available(macOS 11.0, *) {
                let context = LAContext()
                context.interactionNotAllowed = true
                query[kSecUseAuthenticationContext as String] = context
            } else {
                query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
            }
        }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SecretStoreError.keychain(status) }
        guard let data = item as? Data, let text = String(data: data, encoding: .utf8) else { throw SecretStoreError.invalidData }
        return text
    }

    /// Reports whether an item exists without requesting its protected value.
    /// Status surfaces use this so merely opening Settings cannot trigger an
    /// authorization dialog for a legacy ACL.
    public func contains(_ account: Account) throws -> Bool {
        let key = SecretStorePassiveCache.Key(service: serviceName, account: account.rawValue)
        return try Self.passiveCache.contains(key: key) { try uncachedContains(account) }
    }

    private func uncachedContains(_ account: Account) throws -> Bool {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account.rawValue,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if #available(macOS 11.0, *) {
            let context = LAContext()
            context.interactionNotAllowed = true
            query[kSecUseAuthenticationContext as String] = context
        } else {
            query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess || status == errSecInteractionNotAllowed { return true }
        if status == errSecItemNotFound { return false }
        throw SecretStoreError.keychain(status)
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
            Self.passiveCache.record(nil, for: .init(service: serviceName, account: account.rawValue))
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
        Self.passiveCache.record(value, for: .init(service: serviceName, account: account.rawValue))
    }
}
