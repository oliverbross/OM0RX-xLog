import Foundation
import CoreFoundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Issued only by trusted native provisioning/snapshot code. No renderer may
/// supply an account proof, vault identity, destination, package or plan.
struct NativeRemoteBackupOffer: Sendable {
    let plan: RemoteBackupUploadPlan
    let envelope: XLogBackupEnvelope
    let providerAccountID: String
}

/// Deliberately absent in production until native OAuth/provisioning and frozen
/// package preparation are implemented. Tests inject all three dependencies.
struct NativeRemoteBackupPresentationEnvironment: Sendable {
    let prepare: @Sendable (UUID) async throws -> NativeRemoteBackupOffer
    let vault: any NativeBackupCredentialVault
    let http: any DropboxBackupHTTPClient
}

/// One shared UI owner. Passive reads neither provision an account nor create
/// backup metadata, approve, start a timer, read credentials or contact a provider.
actor LiveRemoteBackupPresentation {
    private let logbook: LiveLogbookMethods
    private let service: LiveRemoteBackupService
    private let environment: NativeRemoteBackupPresentationEnvironment?
    private var token: UUID?
    private var offer: NativeRemoteBackupOffer?
    private var registration: NativeDropboxBackupRegistration?
    private var approval: NativeRemoteBackupApproval?
    private var configurationRevision: UInt64 = 0
    private var accountRevision: UInt64 = 0
    private var retention: (candidates: Int, protected: Int)?
    private var stagedRestore: NativeRemoteBackupStagedRestore?
    private var mutating = false

    init(logbook: LiveLogbookMethods, service: LiveRemoteBackupService,
         environment: NativeRemoteBackupPresentationEnvironment? = nil) {
        self.logbook = logbook; self.service = service; self.environment = environment
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
                let journal = try load(generation)
                return ["receipt": journal.receipts.first(where: { $0.id == id }).map(publicReceipt) ?? NSNull()]
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
              owner["token"] is NSNull || (owner["token"] as? String).flatMap(UUID.init(uuidString:)) != nil else { throw invalid() }
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
        guard let environment else { throw WorkerFailure("backup_unavailable", "Remote backup account setup and execution are unavailable in this build. Local backups remain available.") }
        let db = try logbook.withCurrentWorkspaceGeneration { current -> LogbookDatabase in
            guard current == generation else { throw stale() }
            var journal = try load(current)
            guard journal.revision == revision.int64Value,
                  (owner["token"] as? String) == token?.uuidString else { throw stale() }
            guard journal.receipts.count < 256 else { throw WorkerFailure("backup_history_full", "Backup command history is full. No command was started.") }
            if action != "prepare" { try checkOffer(current) }
            journal.revision += 1
            journal.receipts.append(Receipt(id: id, request: descriptor, status: "pending"))
            let db = try logbook.openedDatabase()
            try db.saveRemoteBackupCommandJournal(JSONEncoder().encode(journal))
            return db
        }
        retention = nil
        var status = "acknowledged"
        do {
            let commands = await service.nativeCommands()
            switch action {
            case "prepare":
                token = nil; offer = nil; registration = nil; approval = nil; retention = nil; stagedRestore = nil
                let prepared = try await environment.prepare(generation)
                try logbook.withCurrentWorkspaceGeneration { current in
                    try prepared.plan.validate(workspaceGeneration: current, destination: prepared.plan.destination)
                    try prepared.envelope.validate(for: prepared.plan, workspaceGeneration: current,
                        destination: prepared.plan.destination)
                    _ = try NativeDropboxBackupAccountBinding(workspaceGeneration: current, destination: prepared.plan.destination,
                        keychainService: logbook.currentKeychainService(), providerAccountID: prepared.providerAccountID)
                }
                let account = try await commands.availableAccount(for: prepared.plan)
                let authority = try await service.authorizationOwner()
                let state = try await authority.state()
                guard state.workspaceGeneration == generation else { throw stale() }
                configurationRevision = state.configurationRevision
                accountRevision = try await service.accountRegistrationState().revision
                offer = prepared; token = UUID()
                registration = account?.binding.providerAccountID == prepared.providerAccountID ? account : nil
            case "verify_account":
                let prepared = try requireOffer(generation)
                registration = try await service.registerDropboxAccount(plan: prepared.plan,
                    providerAccountID: prepared.providerAccountID, expectedRevision: accountRevision)
                accountRevision = registration!.revision
                approval = nil
            case "approve":
                let prepared = try requireOffer(generation)
                guard let registration else { throw stale() }
                approval = try await commands.approve(plan: prepared.plan, account: registration,
                    expectedConfigurationRevision: configurationRevision, recurring: false)
                configurationRevision = approval!.authorization.configurationRevision
            case "start":
                let prepared = try requireOffer(generation)
                guard let approval else { throw stale() }
                try await commands.start(plan: prepared.plan, approval: approval,
                    preparedEnvelope: prepared.envelope, vault: environment.vault, http: environment.http)
            case "stop": try await commands.stop()
            case "revoke":
                try await commands.revoke(expectedWorkspaceGeneration: generation, expectedConfigurationRevision: configurationRevision)
                configurationRevision += 1; approval = nil
            case "review_retention":
                let prepared = try requireOffer(generation)
                guard let approval else { throw stale() }
                let review = try await commands.reviewRetention(plan: prepared.plan, approval: approval)
                retention = (review.review.candidates.count, review.review.protected.count)
            case "stage_restore":
                let prepared = try requireOffer(generation)
                guard let approval else { throw stale() }
                stagedRestore = try await commands.stageVerifiedRestore(plan: prepared.plan,
                    approval: approval, vault: environment.vault, http: environment.http)
            default: throw invalid()
            }
            try logbook.withCurrentWorkspaceGeneration { current in
                guard current == generation else { throw stale() }
            }
        } catch {
            // Errors may follow a durable registration, consent or start. Never
            // infer rollback or replay; only a fresh snapshot/receipt can recover.
            status = "unknown"
        }
        return try logbook.withCurrentWorkspaceGeneration { current in
            guard current == generation, try logbook.openedDatabase() === db else { throw stale() }
            var journal = try load(current)
            guard let index = journal.receipts.firstIndex(where: { $0.id == id }) else { throw stale() }
            journal.receipts[index].status = status
            try db.saveRemoteBackupCommandJournal(JSONEncoder().encode(journal))
            return publicReceipt(journal.receipts[index])
        }
    }

    private func snapshot() async throws -> [String: Any] {
        let account = try await service.accountRegistrationState()
        let running = await service.isRunning
        if let offer, let approval {
            let reviewedToken = token
            do {
                let authority = try await service.authorizationOwner()
                try await authority.validate(plan: offer.plan, authorization: approval.authorization)
            } catch {
                if token == reviewedToken { self.approval = nil; retention = nil }
            }
        }
        if let offer, offer.plan.workspaceGeneration != account.workspaceGeneration {
            self.offer = nil; token = nil; registration = nil; approval = nil; retention = nil; stagedRestore = nil
        }
        return try logbook.withCurrentWorkspaceGeneration { current in
            if offer?.plan.workspaceGeneration != current {
                offer = nil; token = nil; registration = nil; approval = nil; retention = nil; stagedRestore = nil
            }
            let journal = try load(current)
            let currentOffer = offer?.plan.workspaceGeneration == current ? offer : nil
            let registered = account.workspaceGeneration == current && registration == account.registration && registration != nil
            if !registered { retention = nil }
            var result: [String: Any] = ["owner": ["generation": current.uuidString, "revision": journal.revision,
                "token": currentOffer == nil ? NSNull() : token?.uuidString as Any? ?? NSNull()],
                "available": environment != nil, "prepared": currentOffer != nil, "registered": registered,
                "approved": currentOffer != nil && approval != nil, "running": running, "busy": mutating,
                "retention_deletion_available": false, "last_receipt": journal.receipts.last.map(publicReceipt) ?? NSNull()]
            if let currentOffer {
                let destination = currentOffer.plan.destination
                result["account"] = currentOffer.providerAccountID
                if case .cloudFolder(let folder) = destination.location { result["folder"] = folder }
                result["backup_id"] = currentOffer.plan.backupID.uuidString
                result["byte_count"] = currentOffer.plan.package.byteCount
                result["destination_revision"] = destination.revision
                let root = logbook.workspaceDirectoryURL.appendingPathComponent("Remote Backup")
                if FileManager.default.fileExists(atPath: root.path) {
                    _ = try logbook.remoteBackupDirectory()
                    let parent = root.appendingPathComponent("Dropbox Operations")
                    if FileManager.default.fileExists(atPath: parent.path) {
                        let values = try parent.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                        guard values.isDirectory == true, values.isSymbolicLink != true else { throw invalid() }
                    }
                    let directory = parent.appendingPathComponent(destination.id.uuidString.lowercased())
                    let receipts = try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: directory)
                    if registered, let receipt = receipts.first(where: { $0.plan == currentOffer.plan }) {
                        let outcome: String
                        switch receipt.outcome { case .verified: outcome = "verified"; case .failed: outcome = "failed"; case .uncertain: outcome = "uncertain" }
                        result["upload_outcome"] = outcome
                        result["remote_identity_recorded"] = receipt.remoteObject?.providerAccountID == currentOffer.providerAccountID
                    }
                }
            }
            if let retention { result["retention_review"] = ["candidates": retention.candidates, "protected": retention.protected] }
            if let stagedRestore {
                result["staged_restore"] = ["name": stagedRestore.name,
                    "qso_count": stagedRestore.manifest.qsoCount,
                    "created_at": ISO8601DateFormatter().string(from: stagedRestore.manifest.createdAt)]
            }
            return result
        }
    }

    private func checkOffer(_ generation: UUID) throws { _ = try requireOffer(generation) }
    private func requireOffer(_ generation: UUID) throws -> NativeRemoteBackupOffer {
        guard let offer, token != nil, offer.plan.workspaceGeneration == generation else { throw stale() }
        return offer
    }
    private struct Receipt: Codable { let id: UUID; let request: Data; var status: String }
    private struct Journal: Codable { let generation: UUID; var revision: Int64 = 0; var receipts: [Receipt] = [] }
    private func load(_ generation: UUID) throws -> Journal {
        guard let data = try logbook.openedDatabase().remoteBackupCommandJournal() else { return Journal(generation: generation) }
        let journal = try JSONDecoder().decode(Journal.self, from: data)
        guard (0...9_007_199_254_740_990).contains(journal.revision), journal.receipts.count <= 256,
              Set(journal.receipts.map(\.id)).count == journal.receipts.count,
              journal.receipts.allSatisfy({ ["pending", "unknown", "acknowledged"].contains($0.status) && $0.request.count <= 2048 }) else { throw invalid() }
        return journal.generation == generation ? journal : Journal(generation: generation)
    }
    private func publicReceipt(_ receipt: Receipt) -> [String: Any] {
        ["operation_id": receipt.id.uuidString, "status": receipt.status == "pending" ? "unknown" : receipt.status,
         "request": (try? JSONSerialization.jsonObject(with: receipt.request)) ?? NSNull()]
    }
    private func invalid() -> WorkerFailure { WorkerFailure("backup_invalid_request", "The remote backup request or saved command record is invalid. Nothing was replayed.") }
    private func stale() -> WorkerFailure { WorkerFailure("backup_context_changed", "Backup context changed. Refresh and review the current workspace and account; no command was replayed.") }
}
