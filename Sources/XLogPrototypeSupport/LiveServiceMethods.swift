import Foundation
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

/// Real production services reused by the shared UI. No network job starts on
/// initialization and synchronization is never automatically enabled on a copy.
actor LiveServiceMethods {
    static let shared = LiveServiceMethods()
    private let logbook: LiveLogbookMethods
    private var syncTask: Task<Void, Never>?
    private var syncState: [String: Any] = ["running": false, "status": "Not started"]
    private var automaticTask: Task<Void, Never>?
    private var nextAttempt: Date?
    private var failures = 0
    private var stopped = false
    typealias SyncOperation = @Sendable (LogbookDatabase, XLogSettings) async throws -> SyncReport
    private let operation: SyncOperation?
    #if os(macOS)
    private var qrzClient: QRZClient?
    private var qrzCredentialDigest: Data?
    #endif

    init(logbook: LiveLogbookMethods = .shared, operation: SyncOperation? = nil) { self.logbook = logbook; self.operation = operation }

    func startAutomaticSync() {
        guard automaticTask == nil, !stopped else { return }
        automaticTask = Task { [weak self] in
            while !Task.isCancelled {
                if let owner = self { await owner.automaticTick() } else { return }
                do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
            }
        }
    }

    func beginTermination() {
        stopped = true
        automaticTask?.cancel(); automaticTask = nil
        syncTask?.cancel()
    }

    func terminate() async {
        beginTermination()
        let running = syncTask
        await running?.value
    }

    func automaticTick(now: Date = Date()) {
        guard !stopped, syncTask == nil else { return }
        // No workspace (or unreadable consent) is not permission to start a job.
        guard let settings = try? logbook.currentSettings(), settings.logbookMode == .wavelog, settings.automaticSync else {
            nextAttempt = nil; return
        }
        guard nextAttempt == nil || now >= nextAttempt! else { return }
        do {
            try startSync(settings: settings, automatic: true)
        } catch {
            failures = min(6, failures + 1)
            nextAttempt = now.addingTimeInterval(min(3600, 60 * pow(2, Double(failures))))
            syncState = Self.syncFailure(error, phase: "startup")
        }
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !stopped else { throw WorkerFailure("worker_stopping", "Synchronization service is shutting down.") }
        if method.hasPrefix("sync_") {
            return try logbook.withSyncOwnerLock { try handleSync(method: method, params: params) }
        }
        switch method {
        case "online_log_status":
            guard params.isEmpty || Set(params.keys) == ["service"] else { throw invalid() }
            return try onlineLogStatus(service: try onlineLogService(params))
        case "online_log_configure":
            let keys = Set(params.keys)
            guard keys == ["enabled", "confirm_new_contacts_only"] ||
                    keys == ["service", "enabled", "confirm_new_contacts_only"],
                  let enabled = params["enabled"] as? NSNumber, isJSONBoolean(enabled),
                  let confirmation = params["confirm_new_contacts_only"] as? NSNumber,
                  isJSONBoolean(confirmation), !enabled.boolValue || confirmation.boolValue else { throw invalid() }
            let service = try onlineLogService(params)
            if enabled.boolValue {
                switch service {
                case .qrz:
                    guard let key = try workspaceSecrets().load(.qrzLogbookKey), Self.validQRZLogbookKey(key) else {
                        throw WorkerFailure("credential_required", "Save a valid QRZ Logbook API key before enabling uploads.")
                    }
                case .clubLog:
                    guard try clubLogCredentials()?.isValid == true else {
                        throw WorkerFailure("credential_required", "Save a valid Club Log API key, email, application password and callsign before enabling uploads.")
                    }
                }
            }
            _ = try logbook.openedDatabase().configureOnlineLogEnrollment(service: service, enabled: enabled.boolValue)
            return try onlineLogStatus(service: service)
        case "secret_save":
            guard Set(params.keys) == ["account", "value"], let name = params["account"] as? String,
                  let account = WorkspaceCredentialStore.Account(rawValue: name), let value = params["value"] as? String,
                  value.utf8.count <= 8192 else { throw invalid() }
            try logbook.withSyncOwnerLock {
                let secrets = try workspaceSecrets()
                if account == .wavelogToken {
                    let generation = try logbook.syncOwnerContext()["generation"] as! String
                    var journal = try syncJournal(generation: generation)
                    journal["revision"] = (journal["revision"] as! NSNumber).int64Value + 1
                    try logbook.openedDatabase().saveSyncMutationJournal(JSONSerialization.data(withJSONObject: journal, options: [.sortedKeys]))
                    try logbook.configureAutomaticSync(enabled: false, intervalMinutes: 5, confirmed: false)
                }
                if account == .qrzLogbookKey, value.isEmpty {
                    _ = try logbook.openedDatabase().configureOnlineLogEnrollment(service: .qrz, enabled: false)
                }
                if [.clubLogAPIKey, .clubLogEmail, .clubLogApplicationPassword, .clubLogCallsign].contains(account), value.isEmpty {
                    _ = try logbook.openedDatabase().configureOnlineLogEnrollment(service: .clubLog, enabled: false)
                }
                try secrets.save(value, for: account)
            }
            #if os(macOS)
            if account == .qrzPassword { qrzClient = nil; qrzCredentialDigest = nil }
            #endif
            return ["saved": !value.isEmpty]
        case "secret_status":
            let secrets = try workspaceSecrets()
            guard params.isEmpty else { throw invalid() }
            var values: [String: Any] = [:]
            for account in [WorkspaceCredentialStore.Account.wavelogToken, .qrzPassword,
                            .qrzLogbookKey, .clubLogAPIKey, .clubLogEmail,
                            .clubLogApplicationPassword, .clubLogCallsign] {
                values[account.rawValue] = !(try secrets.load(account) ?? "").isEmpty
            }
            return values
        case "lookup_call":
            #if os(macOS)
            let call = try LocalCallsignProfile.validatedCall(params)
            let settings = try logbook.currentSettings()
            let secrets = try workspaceSecrets()
            var profile = try LocalCallsignProfile.base(call, logbook: logbook)
            if settings.qrzEnabled, let password = try secrets.load(.qrzPassword), !password.isEmpty {
                let client = try cachedQRZClient(username: settings.qrzUsername, password: password)
                profile = await CallsignEnrichment.resolve(base: profile) {
                    let result = try await client.lookup(call)
                    return ["call": result.call, "name": result.name, "gridSquare": result.gridSquare, "country": result.country,
                    "dxcc": result.dxcc as Any? ?? NSNull(), "cqZone": result.cqZone, "ituZone": result.ituZone,
                    "state": result.state, "county": result.county, "qth": result.qth, "email": result.email,
                    "nickname": result.nickname, "websiteURL": result.websiteURL,
                    "imageURL": result.imageURL, "qslManager": result.qslManager,
                    "iota": result.iota, "licenseClass": result.licenseClass,
                    "latitude": result.latitude as Any? ?? NSNull(), "longitude": result.longitude as Any? ?? NSNull()]
                }
            } else {
                qrzClient = nil
                qrzCredentialDigest = nil
            }
            LocalCallsignProfile.addGeometry(to: &profile, grid: settings.gridSquare)
            return profile
            #else
            throw WorkerFailure("platform_pending", "QRZ enrichment is not yet available on this platform.")
            #endif
        default: throw WorkerFailure("method_not_allowed", "Unknown service operation.")
        }
    }

    private func handleSync(method: String, params: [String: Any]) throws -> [String: Any] {
        switch method {
        case "sync_mutation": return try mutateSync(params)
        case "sync_receipt":
            guard Set(params.keys) == ["generation", "operation_id"],
                  let text = params["operation_id"] as? String, let operationID = UUID(uuidString: text) else { throw invalid() }
            let id = operationID.uuidString
            let context = try logbook.syncOwnerContext()
            guard params["generation"] as? String == context["generation"] as? String else {
                throw WorkerFailure("workspace_changed", "The workspace changed. The previous operation was not replayed.")
            }
            let journal = try syncJournal(generation: context["generation"] as! String)
            let receipt = (journal["receipts"] as! [[String: Any]]).first { $0["operation_id"] as? String == id }
            return ["receipt": receipt.map(publicSyncReceipt) ?? NSNull()]
        case "sync_summary":
            guard params.isEmpty else { throw invalid() }
            let settings = try logbook.currentSettings()
            let database = try logbook.openedDatabase()
            var result: [String: Any] = [:]
            for key in ["running", "status", "completion_id", "finished_at", "pushed", "pulled", "deleted", "conflicts_count", "failed", "held", "error_code", "error_phase", "http_status"] {
                result[key] = syncState[key]
            }
            result["automatic_sync"] = settings.automaticSync
            result["interval_minutes"] = settings.syncIntervalMinutes
            result["next_attempt"] = settings.automaticSync ? nextAttempt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull() : NSNull()
            result["mode"] = settings.logbookMode.rawValue
            result["sync_available"] = settings.logbookMode == .wavelog
            result["logbook_revision"] = try database.currentRevision()
            if settings.logbookMode == .local {
                result["running"] = false
                result["status"] = "Local logbook · Wavelog sync disabled"
            }
            return result
        case "sync_status":
            guard params.isEmpty else { throw invalid() }
            let database = try logbook.openedDatabase()
            var result = syncState
            let settings = try logbook.currentSettings()
            let mode = settings.logbookMode
            result["automatic_sync"] = settings.automaticSync
            result["interval_minutes"] = settings.syncIntervalMinutes
            result["next_attempt"] = settings.automaticSync ? nextAttempt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull() : NSNull()
            result["mode"] = mode.rawValue
            result["sync_available"] = mode == .wavelog
            if mode == .local {
                result["running"] = false
                result["status"] = "Local logbook · Wavelog sync disabled"
            }
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            result["conflicts"] = try database.conflicts().map { stored -> [String: Any] in
                let conflict = try currentConflict(stored, database: database)
                var projected = try JSONSerialization.jsonObject(with: encoder.encode(conflict)) as! [String: Any]
                projected["revision"] = try conflictRevision(conflict)
                projected["fields"] = QSOConflictMerge.differingFields(in: conflict).map {
                    ["key": $0.key, "label": $0.label, "local": $0.localValue, "remote": $0.remoteValue]
                }
                return projected
            }
            result["outbox"] = try database.outboxEntries(limit: 100).map { entry -> [String: Any] in
                ["id": entry.id.uuidString, "call": entry.qso.call, "attempt_count": entry.attemptCount,
                 "waiting": entry.isWaiting, "has_error": entry.lastError != nil]
            }
            let context = try logbook.syncOwnerContext()
            let generation = context["generation"] as! String
            let journal = try syncJournal(generation: generation)
            var fenced = result
            fenced.removeValue(forKey: "next_attempt")
            fenced["workspace"] = context
            let digest = SHA256.hash(data: try JSONSerialization.data(withJSONObject: fenced, options: [.sortedKeys]))
                .map { String(format: "%02x", $0) }.joined()
            result["mutation_owner"] = ["generation": generation, "revision": journal["revision"]!, "context": digest]
            return result
        case "sync_run":
            guard Set(params.keys) == ["confirm_single_writer"],
                  let confirmed = params["confirm_single_writer"] as? NSNumber,
                  isJSONBoolean(confirmed), confirmed.boolValue else {
                throw WorkerFailure("sync_confirmation_required", "Close other Wavelog sync applications and confirm this logbook is the only writer before synchronizing.")
            }
            guard syncTask == nil else { throw WorkerFailure("sync_busy", "Synchronization is already running.") }
            let settings = try logbook.currentSettings()
            guard settings.logbookMode == .wavelog else {
                throw WorkerFailure("sync_mode_local", "Choose Wavelog mode in Settings before synchronizing.")
            }
            try startSync(settings: settings)
            return syncState
        case "sync_configure":
            guard Set(params.keys) == ["enabled", "interval_minutes", "confirm_single_writer"],
                  let enabled = params["enabled"] as? NSNumber, isJSONBoolean(enabled),
                  let confirmed = params["confirm_single_writer"] as? NSNumber, isJSONBoolean(confirmed),
                  let interval = params["interval_minutes"] as? NSNumber, !isJSONBoolean(interval),
                  interval.doubleValue.isFinite, (1...60).contains(interval.doubleValue),
                  interval.doubleValue == Double(interval.intValue) else { throw invalid() }
            guard syncTask == nil else { throw WorkerFailure("sync_busy", "Wait for synchronization to finish before changing its schedule.") }
            if enabled.boolValue, try logbook.currentSettings().logbookMode != .wavelog {
                throw WorkerFailure("sync_mode_local", "Choose Wavelog mode in Settings before enabling synchronization.")
            }
            if enabled.boolValue && operation == nil {
                guard !(try workspaceSecrets().load(.wavelogToken) ?? "").isEmpty else {
                    throw WorkerFailure("sync_configuration_required", "Save the Wavelog token before enabling automatic synchronization.")
                }
            }
            try logbook.configureAutomaticSync(enabled: enabled.boolValue, intervalMinutes: interval.intValue, confirmed: confirmed.boolValue)
            nextAttempt = nil; failures = 0
            return ["automatic_sync": try logbook.currentSettings().automaticSync, "interval_minutes": interval.intValue]
        case "sync_retry":
            guard syncTask == nil else { throw WorkerFailure("sync_busy", "Wait for synchronization to finish before changing the outbox.") }
            guard Set(params.keys) == ["id"], let text = params["id"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
            try logbook.openedDatabase().retrySync(localID: id)
            return ["queued": true]
        case "sync_resolve":
            guard syncTask == nil else { throw WorkerFailure("sync_busy", "Wait for synchronization to finish before resolving conflicts.") }
            let keys = Set(params.keys)
            guard keys.subtracting(["id", "use_remote", "remote_fields", "expected_revision"]).isEmpty,
                  let text = params["id"] as? String, let id = UUID(uuidString: text),
                  (params["use_remote"] != nil) != (params["remote_fields"] != nil),
                  params["expected_revision"] == nil || params["expected_revision"] is String else { throw invalid() }
            let db = try logbook.openedDatabase()
            guard let stored = try db.conflicts().first(where: { $0.id == id }) else {
                throw WorkerFailure("conflict_missing", "This conflict was already resolved. Refresh the conflict list.")
            }
            let conflict = try currentConflict(stored, database: db)
            if let expected = params["expected_revision"] as? String, expected != (try conflictRevision(conflict)) {
                throw WorkerFailure("conflict_changed", "This contact changed while you were choosing fields. Refresh and review the current values.")
            }
            if let raw = params["use_remote"] {
                guard let boolean = raw as? NSNumber, isJSONBoolean(boolean) else { throw invalid() }
                try db.resolveConflict(conflict, useRemote: boolean.boolValue)
                return ["resolved": true, "queued": !boolean.boolValue]
            }
            guard let fields = params["remote_fields"] as? [String], fields.count <= 100,
                  Set(fields).count == fields.count,
                  Set(fields).isSubset(of: Set(QSOConflictMerge.differingFields(in: conflict).map(\.key))) else { throw invalid() }
            let merged = try QSOConflictMerge.merge(conflict, remoteFields: Set(fields))
            let errors = QSOValidator.validate(merged).filter { $0.severity == .error }
            guard errors.isEmpty else {
                throw WorkerFailure("merge_invalid", "These field choices cannot form a valid contact: " + errors.map(\.message).joined(separator: " "))
            }
            try db.resolveConflict(conflict, merged: merged)
            return ["resolved": true, "queued": true]
        default: throw WorkerFailure("method_not_allowed", "Unknown service operation.")
        }
    }

    private func syncJournal(generation: String) throws -> [String: Any] {
        guard let data = try logbook.openedDatabase().syncMutationJournal() else {
            return ["generation": generation, "revision": 0, "receipts": [[String: Any]]()]
        }
        guard let journal = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              journal["generation"] is String,
              let revision = journal["revision"] as? NSNumber, !isJSONBoolean(revision),
              revision.doubleValue >= 0, revision.doubleValue < 9_007_199_254_740_991,
              revision.doubleValue == Double(revision.int64Value),
              let receipts = journal["receipts"] as? [[String: Any]], receipts.count <= 1024,
              receipts.allSatisfy({ $0["operation_id"] is String && $0["request"] is [String: Any]
                  && ["pending", "acknowledged", "unknown"].contains($0["status"] as? String ?? "") }) else {
            throw WorkerFailure("sync_journal_invalid", "Sync ownership records are unreadable. No operation was dispatched.")
        }
        guard journal["generation"] as? String == generation else {
            return ["generation": generation, "revision": 0, "receipts": [[String: Any]]()]
        }
        return journal
    }

    private func publicSyncReceipt(_ receipt: [String: Any]) -> [String: Any] {
        var result = receipt
        if result["status"] as? String == "pending" { result["status"] = "unknown" }
        return result
    }

    private func mutateSync(_ params: [String: Any]) throws -> [String: Any] {
        guard Set(params.keys) == ["operation_id", "owner", "method", "params"],
              let text = params["operation_id"] as? String, let operationID = UUID(uuidString: text),
              let owner = params["owner"] as? [String: Any], Set(owner.keys) == ["generation", "revision", "context"],
              let revision = owner["revision"] as? NSNumber, !isJSONBoolean(revision),
              revision.doubleValue >= 0, revision.doubleValue < 9_007_199_254_740_991,
              revision.doubleValue == Double(revision.int64Value),
              let digest = owner["context"] as? String, digest.utf8.count == 64,
              let method = params["method"] as? String,
              ["sync_run", "sync_configure", "sync_retry", "sync_resolve"].contains(method),
              let payload = params["params"] as? [String: Any] else { throw invalid() }
        let id = operationID.uuidString
        try validateSyncIntent(method: method, payload: payload)
        let context = try logbook.syncOwnerContext()
        let generation = context["generation"] as! String
        guard owner["generation"] as? String == generation else {
            throw WorkerFailure("workspace_changed", "The workspace changed. Refresh and review Sync before another action.")
        }
        var journal = try syncJournal(generation: generation)
        var receipts = journal["receipts"] as! [[String: Any]]
        let descriptor: [String: Any] = ["owner": owner, "method": method, "params": payload]
        let encoded = try JSONSerialization.data(withJSONObject: descriptor, options: [.sortedKeys])
        guard encoded.count <= 32_768 else { throw invalid() }
        if let prior = receipts.first(where: { $0["operation_id"] as? String == id }) {
            guard try JSONSerialization.data(withJSONObject: prior["request"]!, options: [.sortedKeys]) == encoded else {
                throw WorkerFailure("sync_operation_reused", "That Sync operation identity was already used for different intent.")
            }
            return publicSyncReceipt(prior)
        }
        let current = try handleSync(method: "sync_status", params: [:])["mutation_owner"] as! [String: Any]
        guard NSDictionary(dictionary: current).isEqual(to: owner) else {
            throw WorkerFailure("sync_changed", "Sync state changed. Refresh and review before another action.")
        }
        if receipts.count >= 1024 {
            var removalsRemaining = receipts.count - 511
            receipts.removeAll { receipt in
                guard removalsRemaining > 0, receipt["status"] as? String == "acknowledged" else { return false }
                removalsRemaining -= 1
                return true
            }
        }
        guard receipts.count < 1024 else { throw WorkerFailure("sync_journal_full", "Sync operation history is full; no operation was dispatched.") }
        var receipt: [String: Any] = ["operation_id": id, "request": descriptor, "status": "pending"]
        receipts.append(receipt)
        journal["revision"] = (journal["revision"] as! NSNumber).int64Value + 1
        journal["receipts"] = receipts
        let db = try logbook.openedDatabase()
        try db.saveSyncMutationJournal(JSONSerialization.data(withJSONObject: journal, options: [.sortedKeys]))
        do {
            _ = try handleSync(method: method, params: payload)
            receipt["status"] = "acknowledged"
        } catch {
            // A dispatch error may follow a local write or scheduled transport.
            // Retain admission and never guess that the action is safe to replay.
            receipt["status"] = "unknown"
        }
        receipts[receipts.count - 1] = receipt; journal["receipts"] = receipts
        try db.saveSyncMutationJournal(JSONSerialization.data(withJSONObject: journal, options: [.sortedKeys]))
        return receipt
    }

    private func validateSyncIntent(method: String, payload: [String: Any]) throws {
        let keys = Set(payload.keys)
        func boolean(_ key: String) -> Bool {
            guard let number = payload[key] as? NSNumber else { return false }
            return isJSONBoolean(number)
        }
        switch method {
        case "sync_run":
            guard keys == ["confirm_single_writer"], boolean("confirm_single_writer"),
                  payload["confirm_single_writer"] as? Bool == true else { throw invalid() }
        case "sync_configure":
            guard keys == ["enabled", "interval_minutes", "confirm_single_writer"],
                  boolean("enabled"), boolean("confirm_single_writer"),
                  let interval = payload["interval_minutes"] as? NSNumber, !isJSONBoolean(interval),
                  (1...60).contains(interval.doubleValue), interval.doubleValue == Double(interval.intValue) else { throw invalid() }
        case "sync_retry", "sync_resolve":
            guard let id = payload["id"] as? String, UUID(uuidString: id) != nil else { throw invalid() }
            if method == "sync_retry" { guard keys == ["id"] else { throw invalid() }; return }
            guard keys == ["id", "remote_fields", "expected_revision"],
                  let revision = payload["expected_revision"] as? String, revision.utf8.count == 64,
                  let fields = payload["remote_fields"] as? [String], fields.count <= 100,
                  Set(fields).count == fields.count, fields.allSatisfy({ $0.utf8.count <= 64 }) else { throw invalid() }
        default: throw invalid()
        }
    }

    private func currentConflict(_ stored: SyncConflict, database: LogbookDatabase) throws -> SyncConflict {
        guard let current = try database.lookup(localID: stored.localQSO.id) else {
            throw WorkerFailure("conflict_missing", "The local contact is unavailable. Refresh the logbook before resolving this conflict.")
        }
        return SyncConflict(id: stored.id, localQSO: current, remoteQSO: stored.remoteQSO, detectedAt: stored.detectedAt)
    }

    private func conflictRevision(_ conflict: SyncConflict) throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return SHA256.hash(data: try encoder.encode(conflict)).map { String(format: "%02x", $0) }.joined()
    }

    private func startSync(settings: XLogSettings, automatic: Bool = false) throws {
        guard !stopped, syncTask == nil else { throw WorkerFailure("sync_busy", "Synchronization is already running or stopping.") }
        let configuration: WavelogConfiguration?
        if operation != nil { configuration = nil } else {
            guard let url = URL(string: settings.wavelogURL), let token = try workspaceSecrets().load(.wavelogToken) else {
                throw WorkerFailure("sync_configuration_required", "Configure the Wavelog URL, station ID and token first.")
            }
            configuration = try WavelogConfiguration(baseURL: url, token: token, stationID: settings.wavelogStationID)
        }
        let lease = try logbook.beginManualSync(expected: settings, automatic: automatic)
        let owner = logbook
        let run: SyncOperation
        if let operation { run = operation } else {
            guard let configuration else { _ = owner.endManualSync(lease); throw invalid() }
            run = { database, _ in
                try await SyncEngine(database: database, configuration: configuration,
                    validateRun: { try owner.validateManualSync(lease) }).synchronize()
            }
        }
        syncState = ["running": true, "status": "Synchronizing"]
        syncTask = Task {
            do {
                try Task.checkCancellation()
                try owner.validateManualSync(lease)
                let report = try await run(lease.database, settings)
                self.finish(["running": false, "status": report.failed > 0 ? "Completed with failures" : report.held > 0 ? "Completed; ambiguous remote contacts held for review" : "Completed",
                    "pushed": report.pushed, "pulled": report.pulled, "deleted": report.deleted,
                    "conflicts_count": report.conflicts, "failed": report.failed, "held": report.held], failed: report.failed > 0, interval: settings.syncIntervalMinutes, lease: lease)
            } catch {
                self.finish(Self.syncFailure(error, phase: "run"), failed: true, interval: settings.syncIntervalMinutes, lease: lease)
            }
        }
    }

    /// Dependency messages and decoding contexts can contain credentials, URLs
    /// or contact data. Project only known types and fixed, bounded guidance.
    private static func syncFailure(_ error: Error, phase: String) -> [String: Any] {
        let code: String
        let detail: String
        var httpStatus: Int?
        if let error = error as? WavelogClientError {
            switch error {
            case .invalidConfiguration, .invalidURL:
                code = "wavelog_configuration"
                detail = "Check the Wavelog URL, station ID and API v2 token."
            case .invalidResponse:
                code = "wavelog_invalid_response"
                detail = "Wavelog returned an unexpected response or changing history."
            case .invalidData:
                code = "wavelog_reconciliation"
                detail = "The remote JSON and ADIF histories could not be safely reconciled."
            case .writeVerificationFailed:
                code = "wavelog_write_readback"
                detail = "A remote edit could not be verified by readback."
            case let .rejected(status, _, _):
                code = "wavelog_http"
                if (100...599).contains(status) { httpStatus = status }
                switch status {
                case 401, 403: detail = "Check the token's Wavelog access and station permissions."
                case 404: detail = "Check the Wavelog URL and API v2 availability."
                case 429: detail = "Wavelog is rate limiting requests; retry after backoff."
                case 500...599: detail = "Wavelog reported a server error; retry after backoff."
                default: detail = "Wavelog rejected a request; check its API configuration."
                }
            }
        } else if error is DecodingError {
            code = "wavelog_decoding"
            detail = "The Wavelog response did not match the expected API v2 format."
        } else if let error = error as? URLError {
            switch error.code {
            case .timedOut: code = "network_timeout"
            case .cannotFindHost, .dnsLookupFailed: code = "network_dns"
            case .secureConnectionFailed, .serverCertificateHasBadDate, .serverCertificateUntrusted,
                 .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
                 .clientCertificateRejected, .clientCertificateRequired: code = "network_tls"
            case .cancelled: code = "cancelled"
            default: code = "network_unavailable"
            }
            detail = code == "cancelled" ? "Synchronization was cancelled." : "Check connectivity to Wavelog; retry after backoff."
        } else if error is CancellationError {
            code = "cancelled"
            detail = "Synchronization was cancelled."
        } else if let error = error as? WorkerFailure,
                  ["sync_configuration_required", "sync_configuration_changed", "sync_busy", "sync_disabled", "sync_mode_local"].contains(error.code) {
            code = error.code
            detail = "Review the saved Wavelog configuration and synchronization authorization."
        } else {
            code = "sync_internal"
            detail = "Synchronization could not complete; review configuration and the local logbook."
        }
        let prefix = phase == "startup" ? "Automatic sync could not start" : "Failed"
        var state: [String: Any] = ["running": false, "status": "\(prefix) · \(httpStatus.map { "HTTP \($0). " } ?? "")\(detail)",
                                    "error_code": code, "error_phase": phase]
        if let httpStatus { state["http_status"] = httpStatus }
        return state
    }

    private func finish(_ state: [String: Any], failed: Bool, interval: Int, lease: LiveLogbookSyncLease) {
        guard logbook.endManualSync(lease) else { return }
        syncState = state; syncState["finished_at"] = ISO8601DateFormatter().string(from: Date()); syncTask = nil
        syncState["completion_id"] = UUID().uuidString
        failures = failed ? min(6, failures + 1) : 0
        nextAttempt = Date().addingTimeInterval(min(3600, Double(max(1, interval) * 60) * pow(2, Double(failures))))
        if !stopped, logbook === LiveLogbookMethods.shared { Task { try? await LiveClusterMethods.shared.refreshContacts() } }
    }
    private func workspaceSecrets() throws -> WorkspaceCredentialStore {
        WorkspaceCredentialStore(service: try logbook.currentKeychainService())
    }
    private func onlineLogStatus(service: OnlineLogService) throws -> [String: Any] {
        let summary = try logbook.openedDatabase().onlineLogDeliverySummary(service: service)
        return [
            "service": summary.enrollment.service.rawValue,
            "enabled": summary.enrollment.enabled,
            "enabled_at": summary.enrollment.enabledAt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull(),
            "pending_new_contacts": summary.enrollment.pendingNewContacts,
            "states": Dictionary(uniqueKeysWithValues: OnlineLogDeliveryState.allCases.map {
                ($0.rawValue, summary.counts[$0] ?? 0)
            }),
            "latest_state": summary.latestState?.rawValue as Any? ?? NSNull(),
            "latest_attempt_at": summary.latestAttemptAt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull(),
            "latest_error_code": summary.latestSafeErrorCode as Any? ?? NSNull(),
        ]
    }
    private func onlineLogService(_ params: [String: Any]) throws -> OnlineLogService {
        guard let value = params["service"] else { return .qrz }
        guard let raw = value as? String, let service = OnlineLogService(rawValue: raw) else { throw invalid() }
        return service
    }
    private func clubLogCredentials() throws -> ClubLogCredentials? {
        let secrets = try workspaceSecrets()
        guard let email = try secrets.load(.clubLogEmail),
              let password = try secrets.load(.clubLogApplicationPassword),
              let callsign = try secrets.load(.clubLogCallsign),
              let apiKey = try secrets.load(.clubLogAPIKey) else { return nil }
        return ClubLogCredentials(email: email, applicationPassword: password,
                                  callsign: callsign, apiKey: apiKey)
    }
    private static func validQRZLogbookKey(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 256 &&
            !value.unicodeScalars.contains(where: {
                CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0)
            })
    }
    #if os(macOS)
    private func cachedQRZClient(username: String, password: String) throws -> QRZClient {
        // A new client logs in again. Reuse the XML session only while the
        // workspace credentials are unchanged; never persist the digest/key.
        let workspaceID = try logbook.currentKeychainService()
        let identity = Data(SHA256.hash(data: Data("\(workspaceID)\0\(username)\0\(password)".utf8)))
        if let qrzClient, qrzCredentialDigest == identity { return qrzClient }
        let client = QRZClient(username: username, password: password)
        qrzClient = client
        qrzCredentialDigest = identity
        return client
    }
    #endif
    private func isJSONBoolean(_ number: NSNumber) -> Bool {
        // Match the portable station boundary: Windows Foundation has no
        // CoreFoundation type IDs. Preserve true/false versus numeric 0/1.
        guard let encoded = try? JSONSerialization.data(withJSONObject: [number]) else { return false }
        return encoded == Data("[true]".utf8) || encoded == Data("[false]".utf8)
    }
    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid service parameters.") }
}
