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
            // Never expose dependency messages: they may contain records/secrets.
            failures = min(6, failures + 1)
            nextAttempt = now.addingTimeInterval(min(3600, 60 * pow(2, Double(failures))))
            syncState = ["running": false, "status": "Automatic sync could not start; check configuration. Retrying with backoff."]
        }
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !stopped else { throw WorkerFailure("worker_stopping", "Synchronization service is shutting down.") }
        switch method {
        case "secret_save":
            let secrets = try workspaceSecrets()
            guard Set(params.keys) == ["account", "value"], let name = params["account"] as? String,
                  let account = WorkspaceCredentialStore.Account(rawValue: name), let value = params["value"] as? String,
                  value.utf8.count <= 8192 else { throw invalid() }
            if account == .wavelogToken { try logbook.configureAutomaticSync(enabled: false, intervalMinutes: 5, confirmed: false) }
            try secrets.save(value, for: account)
            #if os(macOS)
            if account == .qrzPassword { qrzClient = nil; qrzCredentialDigest = nil }
            #endif
            return ["saved": !value.isEmpty]
        case "secret_status":
            let secrets = try workspaceSecrets()
            guard params.isEmpty else { throw invalid() }
            var values: [String: Any] = [:]
            for account in [WorkspaceCredentialStore.Account.wavelogToken, .qrzPassword, .clubLogAPIKey] {
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
        case "sync_summary":
            guard params.isEmpty else { throw invalid() }
            let settings = try logbook.currentSettings()
            var result: [String: Any] = [:]
            for key in ["running", "status", "completion_id", "finished_at", "pushed", "pulled", "deleted", "conflicts_count", "failed"] {
                result[key] = syncState[key]
            }
            result["automatic_sync"] = settings.automaticSync
            result["interval_minutes"] = settings.syncIntervalMinutes
            result["next_attempt"] = settings.automaticSync ? nextAttempt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull() : NSNull()
            result["mode"] = settings.logbookMode.rawValue
            result["sync_available"] = settings.logbookMode == .wavelog
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
        let run: SyncOperation
        if let operation { run = operation } else {
            guard let url = URL(string: settings.wavelogURL), let token = try workspaceSecrets().load(.wavelogToken) else {
                throw WorkerFailure("sync_configuration_required", "Configure the Wavelog URL, station ID and token first.")
            }
            let configuration = try WavelogConfiguration(baseURL: url, token: token, stationID: settings.wavelogStationID)
            run = { database, _ in try await SyncEngine(database: database, configuration: configuration).synchronize() }
        }
        try logbook.beginManualSync(expected: settings, automatic: automatic)
        let database: LogbookDatabase
        do { database = try logbook.openedDatabase() }
        catch { logbook.endManualSync(); throw error }
        syncState = ["running": true, "status": "Synchronizing"]
        syncTask = Task {
            do {
                try Task.checkCancellation()
                let report = try await run(database, settings)
                self.finish(["running": false, "status": report.failed == 0 ? "Completed" : "Completed with failures",
                    "pushed": report.pushed, "pulled": report.pulled, "deleted": report.deleted,
                    "conflicts_count": report.conflicts, "failed": report.failed], failed: report.failed > 0, interval: settings.syncIntervalMinutes)
            } catch {
                self.finish(["running": false, "status": "Failed; review configuration and outbox before retrying"], failed: true, interval: settings.syncIntervalMinutes)
            }
        }
    }

    private func finish(_ state: [String: Any], failed: Bool, interval: Int) {
        logbook.endManualSync()
        syncState = state; syncState["finished_at"] = ISO8601DateFormatter().string(from: Date()); syncTask = nil
        syncState["completion_id"] = UUID().uuidString
        failures = failed ? min(6, failures + 1) : 0
        nextAttempt = Date().addingTimeInterval(min(3600, Double(max(1, interval) * 60) * pow(2, Double(failures))))
        if !stopped, logbook === LiveLogbookMethods.shared { Task { try? await LiveClusterMethods.shared.refreshContacts() } }
    }
    private func workspaceSecrets() throws -> WorkspaceCredentialStore {
        WorkspaceCredentialStore(service: try logbook.currentKeychainService())
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
