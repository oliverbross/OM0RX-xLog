import Foundation
import CoreFoundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

#if os(macOS)

/// Exact non-secret Settings projection used as the native FTP/FTPS authority.
/// IDs are derived natively, so renderer input never supplies account or
/// destination identity. Any Settings revision produces a different destination
/// revision and therefore invalidates prior consent.
struct LiveFTPBackupConfigurationContext: Equatable, Sendable {
    let workspaceGeneration: UUID
    let settingsRevision: UInt64
    let destination: RemoteBackupDestination
    let username: String
    let keychainService: String

    init(workspaceGeneration: UUID, settingsRevision: Int64,
         settings: FTPBackupSettings, keychainService: String) throws {
        guard settingsRevision >= 0, settingsRevision < Int64.max,
              settings.protocol != .disabled, let endpoint = URL(string: settings.endpoint) else {
            throw RemoteBackupPlanningError.invalidDestination
        }
        let provider: RemoteBackupProvider = settings.protocol == .ftp ? .ftp : .ftps
        let security: RemoteBackupTransportSecurity = provider == .ftp
            ? .explicitlyAcceptedPlainFTP : .authenticatedEncryptionRequired
        guard (provider == .ftp) == settings.plainFTPConfirmed else {
            throw RemoteBackupPlanningError.invalidDestination
        }
        let accountID = Self.identifier([
            "ftp-account", workspaceGeneration.uuidString.lowercased(), keychainService,
            provider.rawValue, endpoint.absoluteString, settings.username,
        ].joined(separator: "\n"))
        let destinationID = Self.identifier([
            "ftp-destination", workspaceGeneration.uuidString.lowercased(), provider.rawValue,
            endpoint.absoluteString, settings.directory, accountID.uuidString.lowercased(),
        ].joined(separator: "\n"))
        self.workspaceGeneration = workspaceGeneration
        self.settingsRevision = UInt64(settingsRevision)
        self.username = settings.username
        self.keychainService = keychainService
        destination = try RemoteBackupDestination(id: destinationID,
            revision: UInt64(settingsRevision) + 1, provider: provider,
            accountID: accountID, location: .server(endpoint: endpoint, directory: settings.directory),
            // The shared scheduler requires an interval even for a one-shot run.
            // Recurrence remains disabled by the separately bound authorization.
            security: security, schedule: .every(hours: 1), retention: .keepAll)
    }

    var providerAccountID: String {
        let compact = destination.accountID.uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        return (destination.provider == .ftp ? "ftpacct:" : "ftpsacct:") + compact
    }

    private static func identifier(_ material: String) -> UUID {
        var bytes = Array(SHA256.hash(data: Data(material.utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x50
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}

extension LiveLogbookMethods {
    func ftpBackupConfigurationContext() throws -> LiveFTPBackupConfigurationContext? {
        try withSyncOwnerLock {
            let settings = try currentSettings()
            guard settings.ftpBackup.protocol != .disabled else { return nil }
            let owner = try syncOwnerContext()
            guard let revision = (owner["settings_revision"] as? NSNumber)?.int64Value,
                  let generationText = owner["generation"] as? String,
                  let generation = UUID(uuidString: generationText) else {
                throw RemoteBackupPlanningError.staleContext
            }
            return try LiveFTPBackupConfigurationContext(workspaceGeneration: generation,
                settingsRevision: revision, settings: settings.ftpBackup,
                keychainService: currentKeychainService())
        }
    }

    func validateFTPBackupConfiguration(_ expected: LiveFTPBackupConfigurationContext) throws {
        guard try ftpBackupConfigurationContext() == expected else {
            throw RemoteBackupPlanningError.staleContext
        }
    }
}

protocol LiveFTPBackupPasswordSource: Sendable {
    func password(service: String) throws -> String?
}

struct WorkspaceFTPBackupPasswordSource: LiveFTPBackupPasswordSource {
    func password(service: String) throws -> String? {
        try WorkspaceCredentialStore(service: service).load(.ftpBackupPassword)
    }
}

private struct LiveFTPBackupCredentialSource: FTPBackupCredentialSource {
    let logbook: LiveLogbookMethods
    let context: LiveFTPBackupConfigurationContext
    let passwords: any LiveFTPBackupPasswordSource

    func credential(for accountID: UUID) async throws -> FTPBackupCredential {
        try Task.checkCancellation()
        try logbook.validateFTPBackupConfiguration(context)
        guard accountID == context.destination.accountID,
              try logbook.currentKeychainService() == context.keychainService else {
            throw FTPBackupError.accountMismatch
        }
        let password: String?
        do {
            password = try passwords.password(service: context.keychainService)
        } catch { throw FTPBackupError.credentialUnavailable }
        try Task.checkCancellation()
        guard let password, !password.isEmpty else { throw FTPBackupError.credentialUnavailable }
        return try FTPBackupCredential(accountID: accountID, username: context.username, password: password)
    }
}

/// Production FTP/implicit-FTPS UI owner. Mount and snapshot read only non-secret
/// Settings plus existing local receipts. Server contact is possible only after
/// Prepare, local credential check, explicit approval and explicit Start.
actor LiveFTPBackupPresentation {
    private let logbook: LiveLogbookMethods
    private let service: LiveRemoteBackupService
    private let passwords: any LiveFTPBackupPasswordSource
    private let client: any FTPBackupClient
    private var token: UUID?
    private var prepared: (context: LiveFTPBackupConfigurationContext,
                           plan: RemoteBackupUploadPlan, envelope: XLogBackupEnvelope)?
    private var credentialChecked = false
    private var authorization: RemoteBackupAuthorization?
    private var configurationRevision: UInt64 = 0
    private var retention: (candidates: Int, protected: Int)?
    private var stagedRestore: NativeRemoteBackupStagedRestore?
    private var lastErrorCode: String?
    private var mutating = false

    init(logbook: LiveLogbookMethods, service: LiveRemoteBackupService,
         passwords: any LiveFTPBackupPasswordSource = WorkspaceFTPBackupPasswordSource(),
         client: any FTPBackupClient = LibcurlFTPBackupClient()) {
        self.logbook = logbook
        self.service = service
        self.passwords = passwords
        self.client = client
    }

    func retireConfiguration() async {
        clearPrepared()
        try? await service.stop()
    }

    func handle(_ params: [String: Any]) async throws -> [String: Any] {
        guard let action = params["action"] as? String else { throw invalid() }
        if action == "snapshot" {
            guard Set(params.keys) == ["action"] else { throw invalid() }
            return try await snapshot()
        }
        if action == "receipt" {
            guard Set(params.keys) == ["action", "generation", "operation_id"],
                  let raw = params["operation_id"] as? String, let id = UUID(uuidString: raw) else { throw invalid() }
            return try logbook.withCurrentWorkspaceGeneration { generation in
                guard params["generation"] as? String == generation.uuidString else { throw stale() }
                return ["receipt": try load(generation).receipts.first(where: { $0.id == id }).map(publicReceipt) ?? NSNull()]
            }
        }
        guard ["prepare", "verify_account", "approve", "start", "stop", "revoke", "review_retention", "stage_restore"].contains(action),
              Set(params.keys) == ["action", "operation_id", "owner"],
              let raw = params["operation_id"] as? String, let id = UUID(uuidString: raw),
              let owner = params["owner"] as? [String: Any], Set(owner.keys) == ["generation", "revision", "token"],
              let generationText = owner["generation"] as? String, let generation = UUID(uuidString: generationText),
              let revision = owner["revision"] as? NSNumber, CFGetTypeID(revision) != CFBooleanGetTypeID(),
              revision.doubleValue >= 0, revision.doubleValue < 9_007_199_254_740_991,
              revision.doubleValue == Double(revision.int64Value),
              owner["token"] is NSNull || (owner["token"] as? String).flatMap(UUID.init(uuidString:)) != nil else {
            throw invalid()
        }
        guard !mutating else { throw WorkerFailure("backup_busy", "A backup command is in progress. Refresh its status.") }
        mutating = true; defer { mutating = false }
        let descriptor = try JSONSerialization.data(withJSONObject: ["action": action, "owner": owner], options: [.sortedKeys])
        let prior = try logbook.withCurrentWorkspaceGeneration { current -> Receipt? in
            guard current == generation else { throw stale() }
            return try load(current).receipts.first { $0.id == id }
        }
        if let prior {
            guard prior.request == descriptor else { throw invalid() }
            return publicReceipt(prior)
        }
        let database = try logbook.withCurrentWorkspaceGeneration { current -> LogbookDatabase in
            guard current == generation else { throw stale() }
            var journal = try load(current)
            guard journal.revision == revision.int64Value,
                  (owner["token"] as? String) == token?.uuidString else { throw stale() }
            guard journal.receipts.count < 256 else {
                throw WorkerFailure("backup_history_full", "Backup command history is full. No command was started.")
            }
            if action != "prepare" { _ = try requirePrepared(generation) }
            journal.revision += 1
            journal.receipts.append(Receipt(id: id, request: descriptor, status: "pending"))
            let database = try logbook.openedDatabase()
            try database.saveRemoteBackupCommandJournal(JSONEncoder().encode(journal))
            return database
        }
        retention = nil
        var status = "acknowledged"
        do {
            switch action {
            case "prepare": try await prepare(generation)
            case "verify_account":
                let value = try requirePrepared(generation)
                _ = try await LiveFTPBackupCredentialSource(logbook: logbook,
                    context: value.context, passwords: passwords)
                    .credential(for: value.context.destination.accountID)
                credentialChecked = true
                authorization = nil
            case "approve":
                let value = try requirePrepared(generation)
                guard credentialChecked else { throw FTPBackupError.credentialUnavailable }
                try logbook.validateFTPBackupConfiguration(value.context)
                let authority = try await service.authorizationOwner()
                authorization = try await authority.approve(plan: value.plan,
                    expectedConfigurationRevision: configurationRevision, recurring: false)
                configurationRevision = authorization!.configurationRevision
            case "start": try await start(generation)
            case "stop": try await service.stop()
            case "revoke":
                let authority = try await service.authorizationOwner()
                try await authority.revoke(expectedWorkspaceGeneration: generation,
                    expectedConfigurationRevision: configurationRevision)
                configurationRevision += 1
                authorization = nil
            case "review_retention": try await reviewRetention(generation)
            case "stage_restore": stagedRestore = try await stageRestore(generation)
            default: throw invalid()
            }
            try logbook.withCurrentWorkspaceGeneration { current in
                guard current == generation else { throw stale() }
            }
            lastErrorCode = nil
        } catch {
            // A failed/lost response can follow an issued network write. Persist
            // uncertainty and require a fresh status review; never replay it.
            status = "unknown"
            lastErrorCode = safeErrorCode(error)
        }
        return try logbook.withCurrentWorkspaceGeneration { current in
            guard current == generation, try logbook.openedDatabase() === database else { throw stale() }
            var journal = try load(current)
            guard let index = journal.receipts.firstIndex(where: { $0.id == id }) else { throw stale() }
            journal.receipts[index].status = status
            try database.saveRemoteBackupCommandJournal(JSONEncoder().encode(journal))
            return publicReceipt(journal.receipts[index])
        }
    }

    private func prepare(_ generation: UUID) async throws {
        clearPrepared()
        try await service.stop()
        guard let context = try logbook.ftpBackupConfigurationContext(),
              context.workspaceGeneration == generation else {
            throw WorkerFailure("backup_configuration_required", "Save an FTP or implicit-FTPS destination before preparing a backup.")
        }
        let source = try RemoteBackupLocalSnapshotSource(workspace: logbook,
            stagingDirectory: try logbook.remoteBackupDirectory().appendingPathComponent("FTP Staging"))
        let envelope = try await source.capture(workspaceGeneration: generation,
            destination: context.destination)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: generation,
            destination: context.destination, backupID: UUID(), package: envelope.identity)
        let authority = try await service.authorizationOwner()
        let state = try await authority.state()
        guard state.workspaceGeneration == generation else { throw stale() }
        configurationRevision = state.configurationRevision
        prepared = (context, plan, envelope)
        token = UUID()
    }

    private func start(_ generation: UUID) async throws {
        let value = try requirePrepared(generation)
        guard credentialChecked, let authorization else { throw stale() }
        try logbook.validateFTPBackupConfiguration(value.context)
        let credentials = LiveFTPBackupCredentialSource(logbook: logbook,
            context: value.context, passwords: passwords)
        let directory = try operationDirectory(value.context.destination)
        let executor = try FTPBackupExecutor(destination: value.context.destination,
            stateDirectory: directory, credentials: credentials, client: client)
        let logbook = logbook, context = value.context
        try await service.start(plan: value.plan, authorization: authorization,
            executor: executor, preparedEnvelope: value.envelope,
            registrationCheck: { try logbook.validateFTPBackupConfiguration(context) })
    }

    private func reviewRetention(_ generation: UUID) async throws {
        let value = try requirePrepared(generation)
        guard credentialChecked, let authorization else { throw stale() }
        let authority = try await service.authorizationOwner()
        try await authority.validate(plan: value.plan, authorization: authorization)
        try logbook.validateFTPBackupConfiguration(value.context)
        let receipts = try RemoteBackupUploadCoordinator.persistedReceipts(
            stateDirectory: try operationDirectory(value.context.destination))
        retention = (0, receipts.count)
    }

    private func stageRestore(_ generation: UUID) async throws -> NativeRemoteBackupStagedRestore {
        let value = try requirePrepared(generation)
        guard credentialChecked, let authorization else { throw stale() }
        guard await !service.isRunning else { throw RemoteBackupSchedulerError.operationInProgress }
        let authority = try await service.authorizationOwner()
        try await authority.validate(plan: value.plan, authorization: authorization)
        try logbook.validateFTPBackupConfiguration(value.context)
        let receipts = try RemoteBackupUploadCoordinator.persistedReceipts(
            stateDirectory: try operationDirectory(value.context.destination))
        let matches = receipts.filter { receipt in
            guard receipt.plan == value.plan,
                  receipt.remoteObject?.providerAccountID == value.context.providerAccountID else { return false }
            if case .verified(let package, _) = receipt.outcome { return package == value.plan.package }
            return false
        }
        guard matches.count == 1 else { throw NativeRemoteBackupCommandError.verifiedBackupUnavailable }
        let transport = try FTPBackupTransport(destination: value.context.destination,
            credentials: LiveFTPBackupCredentialSource(logbook: logbook,
                context: value.context, passwords: passwords), client: client)
        let data = try await transport.downloadVerified(receipt: matches[0])
        try logbook.validateFTPBackupConfiguration(value.context)
        let context = value.context
        let staged = try logbook.stageRemoteBackupEnvelope(plan: value.plan, data: data,
            authorize: { try logbook.validateFTPBackupConfiguration(context) })
        return NativeRemoteBackupStagedRestore(name: staged.name, manifest: staged.preview.manifest)
    }

    private func snapshot() async throws -> [String: Any] {
        let current = try logbook.ftpBackupConfigurationContext()
        if let prepared, current != prepared.context {
            clearPrepared()
            try? await service.stop()
        }
        if let value = prepared, let authorization {
            do {
                let authority = try await service.authorizationOwner()
                try await authority.validate(plan: value.plan, authorization: authorization)
            } catch { self.authorization = nil; retention = nil }
        }
        let running = await service.isRunning
        return try logbook.withCurrentWorkspaceGeneration { generation in
            let journal = try load(generation)
            let value = prepared?.context.workspaceGeneration == generation ? prepared : nil
            var result: [String: Any] = [
                "owner": ["generation": generation.uuidString, "revision": journal.revision,
                          "token": value == nil ? NSNull() : token?.uuidString as Any? ?? NSNull()],
                "available": true, "configured": current != nil, "prepared": value != nil,
                "registered": value != nil && credentialChecked,
                "approved": value != nil && authorization != nil,
                "running": running, "busy": mutating,
                "retention_deletion_available": false,
                "last_receipt": journal.receipts.last.map(publicReceipt) ?? NSNull(),
            ]
            if let current {
                result["provider"] = current.destination.provider.rawValue
                result["account"] = current.username
                if case .server(let endpoint, let directory) = current.destination.location {
                    result["endpoint"] = endpoint.absoluteString
                    result["folder"] = directory
                }
                result["plain_ftp_confirmed"] = current.destination.provider == .ftp
            }
            if let value {
                result["backup_id"] = value.plan.backupID.uuidString
                result["byte_count"] = value.plan.package.byteCount
                result["destination_revision"] = value.context.destination.revision
                let directory = try operationDirectory(value.context.destination)
                if FileManager.default.fileExists(atPath: directory.path) {
                    let receipts = try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: directory)
                    if credentialChecked, let receipt = receipts.first(where: { $0.plan == value.plan }) {
                        let outcome: String
                        switch receipt.outcome {
                        case .verified: outcome = "verified"
                        case .failed: outcome = "failed"
                        case .uncertain: outcome = "uncertain"
                        }
                        result["upload_outcome"] = outcome
                        result["remote_identity_recorded"] = receipt.remoteObject?.providerAccountID == value.context.providerAccountID
                    }
                }
            }
            if let retention {
                result["retention_review"] = ["candidates": retention.candidates, "protected": retention.protected]
            }
            if let stagedRestore {
                result["staged_restore"] = ["name": stagedRestore.name,
                    "qso_count": stagedRestore.manifest.qsoCount,
                    "created_at": ISO8601DateFormatter().string(from: stagedRestore.manifest.createdAt)]
            }
            if let lastErrorCode { result["last_error_code"] = lastErrorCode }
            return result
        }
    }

    private func operationDirectory(_ destination: RemoteBackupDestination) throws -> URL {
        let root = try logbook.remoteBackupDirectory()
        let parent = root.appendingPathComponent("FTP Operations")
        let directory = parent.appendingPathComponent(destination.id.uuidString.lowercased())
        guard LocalFilePath.contains(directory, in: root) else {
            throw RemoteBackupPersistenceError.invalidState
        }
        if FileManager.default.fileExists(atPath: parent.path) {
            let values = try parent.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
                throw RemoteBackupPersistenceError.invalidState
            }
        }
        return directory
    }

    private func requirePrepared(_ generation: UUID)
        throws -> (context: LiveFTPBackupConfigurationContext, plan: RemoteBackupUploadPlan, envelope: XLogBackupEnvelope) {
        guard let prepared, token != nil, prepared.context.workspaceGeneration == generation else { throw stale() }
        try logbook.validateFTPBackupConfiguration(prepared.context)
        return prepared
    }

    private func clearPrepared() {
        token = nil
        prepared = nil
        credentialChecked = false
        authorization = nil
        retention = nil
        stagedRestore = nil
        lastErrorCode = nil
    }

    private func safeErrorCode(_ error: Error) -> String {
        if error is CancellationError { return "cancelled" }
        if let error = error as? FTPBackupError {
            switch error {
            case .invalidCredential, .accountMismatch, .credentialUnavailable:
                return "credential_unavailable"
            case .invalidDestination, .unsupportedProvider:
                return "configuration_changed"
            case .operationInProgress:
                return "backup_busy"
            case .capacityReached:
                return "backup_capacity"
            case .invalidPackage:
                return "backup_package"
            case .responseTooLarge, .invalidResponse, .remoteRejected:
                return "ftp_transport"
            }
        }
        if error is RemoteBackupPersistenceError { return "backup_state" }
        if error is RemoteBackupSchedulerError { return "backup_busy" }
        if error is RemoteBackupAuthorizationError { return "authorization_changed" }
        if error is RemoteBackupPlanningError { return "configuration_changed" }
        if let failure = error as? WorkerFailure,
           ["backup_context_changed", "backup_configuration_required"].contains(failure.code) {
            return failure.code
        }
        return "operation_failed"
    }

    private struct Receipt: Codable { let id: UUID; let request: Data; var status: String }
    private struct Journal: Codable { let generation: UUID; var revision: Int64 = 0; var receipts: [Receipt] = [] }
    private func load(_ generation: UUID) throws -> Journal {
        guard let data = try logbook.openedDatabase().remoteBackupCommandJournal() else {
            return Journal(generation: generation)
        }
        let journal = try JSONDecoder().decode(Journal.self, from: data)
        guard (0...9_007_199_254_740_990).contains(journal.revision), journal.receipts.count <= 256,
              Set(journal.receipts.map(\.id)).count == journal.receipts.count,
              journal.receipts.allSatisfy({ ["pending", "unknown", "acknowledged"].contains($0.status) && $0.request.count <= 2_048 }) else {
            throw invalid()
        }
        return journal.generation == generation ? journal : Journal(generation: generation)
    }

    private func publicReceipt(_ receipt: Receipt) -> [String: Any] {
        ["operation_id": receipt.id.uuidString,
         "status": receipt.status == "pending" ? "unknown" : receipt.status,
         "request": (try? JSONSerialization.jsonObject(with: receipt.request)) ?? NSNull()]
    }
    private func invalid() -> WorkerFailure {
        WorkerFailure("backup_invalid_request", "The remote backup request or saved command record is invalid. Nothing was replayed.")
    }
    private func stale() -> WorkerFailure {
        WorkerFailure("backup_context_changed", "Backup context changed. Refresh and review the current workspace and destination; no command was replayed.")
    }
}
#else
/// FTP/FTPS uses the macOS system libcurl implementation in this programme
/// stage. Other platforms remain unavailable until their packages are accepted.
actor LiveFTPBackupPresentation {
    init(logbook: LiveLogbookMethods, service: LiveRemoteBackupService) {}
    func retireConfiguration() async {}
    func handle(_ params: [String: Any]) async throws -> [String: Any] {
        throw WorkerFailure("backup_unavailable", "FTP and FTPS backup are not available on this platform build.")
    }
}
#endif
