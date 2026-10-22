import Foundation
#if os(macOS)
import XLogCore
#endif

/// Identical account names across OS vaults; macOS retains its existing service.
struct WorkspaceCredentialStore {
    enum Account: String {
        case wavelogToken = "wavelog-token"
        case qrzPassword = "qrz-password"
        case hamqthPassword = "hamqth-password"
        case qrzLogbookKey = "qrz-logbook-key"
        case clubLogAPIKey = "clublog-api-key"
        case clubLogEmail = "clublog-email"
        case clubLogApplicationPassword = "clublog-application-password"
        case clubLogCallsign = "clublog-callsign"
        case ftpBackupPassword = "ftp-backup-password"
        case rtcScorePassword = "rtc-score-password"
    }
    let service: String
    /// Worker reads are non-interactive by default. Only an explicitly
    /// user-started operation may opt into a Keychain authorization dialog.
    func load(_ account: Account) throws -> String? {
        try load(account, allowInteraction: false)
    }
    func load(_ account: Account, allowInteraction: Bool) throws -> String? {
        #if os(macOS)
        return try SecretStore(service: service).load(SecretStore.Account(rawValue: account.rawValue)!,
                                                      allowInteraction: allowInteraction)
        #else
        return try NativeCredentialStore(service: service).load(account.rawValue)
        #endif
    }
    func contains(_ account: Account) throws -> Bool {
        #if os(macOS)
        return try SecretStore(service: service).contains(SecretStore.Account(rawValue: account.rawValue)!)
        #else
        return try load(account) != nil
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
