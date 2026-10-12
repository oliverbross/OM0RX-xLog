import Foundation
import Security
import CryptoKit

public struct SmartLinkTokenSet: Sendable {
    public let idToken: String
    public let refreshToken: String?
}

public enum SmartLinkAuthError: LocalizedError, Sendable {
    case invalidCredentials(String)
    case invalidResponse
    case keychain(OSStatus)

    public var errorDescription: String? {
        switch self {
        case let .invalidCredentials(message): message
        case .invalidResponse: "SmartLink authentication returned an invalid response."
        case let .keychain(status): "macOS Keychain returned status \(status)."
        }
    }
}

public struct SmartLinkKeychain: Sendable {
    private let service = "com.oliverbross.OM0RXXCat.smartlink"
    private let account: String
    private let legacyAccount = "refresh-token"

    public init(accountIdentifier: String = "default") {
        let normalized = accountIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        account = SHA256.hash(data: Data(normalized.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    public func loadRefreshToken() throws -> String? {
        if let token = try load(account: account) { return token }
        guard account != legacyAccount, let token = try load(account: legacyAccount) else { return nil }
        try save(token, account: account)
        try delete(account: legacyAccount)
        return token
    }

    private func load(account: String) throws -> String? {
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
            throw SmartLinkAuthError.keychain(status)
        }
        return token
    }

    public func saveRefreshToken(_ token: String) throws {
        try save(token, account: account)
    }

    private func save(_ token: String, account: String) throws {
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let updates: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(identity as CFDictionary, updates as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var add = identity
            updates.forEach { add[$0.key] = $0.value }
            let status = SecItemAdd(add as CFDictionary, nil)
            guard status == errSecSuccess else { throw SmartLinkAuthError.keychain(status) }
        } else if updateStatus != errSecSuccess {
            throw SmartLinkAuthError.keychain(updateStatus)
        }
    }

    public func deleteRefreshToken() throws {
        try delete(account: account)
    }

    private func delete(account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SmartLinkAuthError.keychain(status)
        }
    }
}

public struct SmartLinkCertificatePinStore: Sendable {
    private let service = "com.oliverbross.OM0RXXCat.smartlink-certificates"

    public init() {}

    public func verifyOrTrustFirstUse(identity: String, certificateData: Data) -> Bool {
        let fingerprint = SHA256.hash(data: certificateData).map { String(format: "%02x", $0) }.joined()
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: identity,
        ]
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess,
           let data = item as? Data,
           let stored = String(data: data, encoding: .utf8) {
            return stored == fingerprint
        }
        guard status == errSecItemNotFound else { return false }
        var add = identity
        add[kSecValueData as String] = Data(fingerprint.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    public func delete(identity: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: identity,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SmartLinkAuthError.keychain(status)
        }
    }
}

public actor SmartLinkAuthenticator {
    public static let clientID = "4Y9fEIIsVYyQo5u6jr7yBWc4lV5ugC2m"
    public static let tokenEndpoint = URL(string: "https://frtest.auth0.com/oauth/token")!
    public static let scope = "openid email given_name family_name profile picture offline_access"

    private let keychain: SmartLinkKeychain
    private let session: URLSession

    public init(keychain: SmartLinkKeychain = SmartLinkKeychain(), session: URLSession = .shared) {
        self.keychain = keychain
        self.session = session
    }

    public func authenticate(email: String, password: String) async throws -> SmartLinkTokenSet {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedEmail.isEmpty, !password.isEmpty else {
            throw SmartLinkAuthError.invalidCredentials("SmartLink email and password are required.")
        }
        return try await requestToken(body: Self.passwordGrantBody(email: trimmedEmail, password: password))
    }

    static func passwordGrantBody(email: String, password: String) -> [String: String] {
        [
            "grant_type": "http://auth0.com/oauth/grant-type/password-realm",
            "realm": "Username-Password-Authentication",
            "username": email,
            "password": password,
            "client_id": Self.clientID,
            "scope": Self.scope,
        ]
    }

    public func refresh() async throws -> SmartLinkTokenSet {
        guard let refreshToken = try keychain.loadRefreshToken(), !refreshToken.isEmpty else {
            throw SmartLinkAuthError.invalidCredentials("No saved SmartLink session is available. Enter the password once.")
        }
        return try await requestToken(body: [
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": Self.clientID,
        ])
    }

    public func clear() throws { try keychain.deleteRefreshToken() }

    private func requestToken(body: [String: String]) async throws -> SmartLinkTokenSet {
        var request = URLRequest(url: Self.tokenEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SmartLinkAuthError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = object?["error_description"] as? String
                ?? object?["error"] as? String
                ?? "SmartLink authentication failed (HTTP \(http.statusCode))."
            throw SmartLinkAuthError.invalidCredentials(message)
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = object["id_token"] as? String,
              !idToken.isEmpty else {
            throw SmartLinkAuthError.invalidResponse
        }
        let refreshToken = object["refresh_token"] as? String
        if let refreshToken, !refreshToken.isEmpty { try keychain.saveRefreshToken(refreshToken) }
        return SmartLinkTokenSet(idToken: idToken, refreshToken: refreshToken)
    }
}
