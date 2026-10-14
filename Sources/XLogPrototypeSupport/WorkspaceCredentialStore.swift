import Foundation
#if os(macOS)
import XLogCore
#endif

/// Identical account names across OS vaults; macOS retains its existing service.
struct WorkspaceCredentialStore {
    enum Account: String {
        case wavelogToken = "wavelog-token"
        case qrzPassword = "qrz-password"
        case qrzLogbookKey = "qrz-logbook-key"
        case clubLogAPIKey = "clublog-api-key"
        case clubLogEmail = "clublog-email"
        case clubLogApplicationPassword = "clublog-application-password"
        case clubLogCallsign = "clublog-callsign"
    }
    let service: String
    func load(_ account: Account) throws -> String? {
        #if os(macOS)
        return try SecretStore(service: service).load(SecretStore.Account(rawValue: account.rawValue)!)
        #else
        return try NativeCredentialStore(service: service).load(account.rawValue)
        #endif
    }
    func save(_ value: String, for account: Account) throws {
        #if os(macOS)
        try SecretStore(service: service).save(value, for: SecretStore.Account(rawValue: account.rawValue)!)
        #else
        try NativeCredentialStore(service: service).save(value, account: account.rawValue)
        #endif
    }
}
