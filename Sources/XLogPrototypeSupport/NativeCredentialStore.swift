import Foundation
import CPlatformVault

/// Exact service/account access only. Never enumerates, migrates or writes a
/// fallback file. The macOS application continues to use its existing Keychain.
struct NativeCredentialStore: Sendable {
    let service: String
    static var supported: Bool { xlog_vault_supported() != 0 }
    static var maximumBytes: Int { Int(xlog_vault_max_secret_bytes()) }

    func load(_ account: String) throws -> String? {
        try validate(account)
        var bytes: UnsafeMutablePointer<UInt8>?
        var count = 0
        var nativeCode: UInt32 = 0
        let result = service.withCString { service in account.withCString { account in
            xlog_vault_load(service, account, &bytes, &count, &nativeCode)
        } }
        defer { xlog_vault_value_destroy(bytes, count) }
        if result == XLOG_VAULT_NOT_FOUND { return nil }
        try check(result)
        guard let bytes, count <= Self.maximumBytes,
              let value = String(bytes: UnsafeBufferPointer(start: bytes, count: count), encoding: .utf8) else {
            throw WorkerFailure("credential_invalid", "The stored credential has an invalid format.")
        }
        return value
    }

    func save(_ value: String, account: String) throws {
        try validate(account)
        guard value.utf8.count <= Self.maximumBytes else {
            throw WorkerFailure("credential_too_large", "This credential exceeds the platform secure-store limit.")
        }
        if value.isEmpty { try remove(account); return }
        let data = Data(value.utf8)
        var nativeCode: UInt32 = 0
        let result = service.withCString { service in account.withCString { account in
            data.withUnsafeBytes { value in
                xlog_vault_save(service, account, value.bindMemory(to: UInt8.self).baseAddress, data.count, &nativeCode)
            }
        } }
        try check(result)
    }

    func remove(_ account: String) throws {
        try validate(account)
        var nativeCode: UInt32 = 0
        let result = service.withCString { service in account.withCString { account in
            xlog_vault_remove(service, account, &nativeCode)
        } }
        try check(result)
    }

    private func validate(_ account: String) throws {
        guard [service, account].allSatisfy({ value in
            (1...128).contains(value.utf8.count) && !value.utf8.contains(where: { $0 < 32 || $0 == 127 })
        }) else { throw WorkerFailure("credential_identity_invalid", "The secure-store identity is invalid.") }
    }

    private func check(_ result: Int32) throws {
        switch result {
        case XLOG_VAULT_OK: return
        case XLOG_VAULT_UNAVAILABLE:
            throw WorkerFailure("credential_unavailable", "The platform secure store is unavailable. No plaintext fallback was used.")
        default:
            // OS error text may carry sensitive context. Keep it outside the
            // worker boundary; a failed mutation never reports success.
            throw WorkerFailure("credential_failed", "The platform secure-store operation failed. No success was confirmed.")
        }
    }
}
