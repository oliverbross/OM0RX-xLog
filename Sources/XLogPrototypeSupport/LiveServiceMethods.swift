#if os(macOS)
import Foundation
import CryptoKit
import XLogCore
import XCatIntegrationCore

/// Real production services reused by the shared UI. No network job starts on
/// initialization and synchronization is never automatically enabled on a copy.
actor LiveServiceMethods {
    static let shared = LiveServiceMethods()
    private let logbook: LiveLogbookMethods
    private var syncTask: Task<Void, Never>?
    private var syncState: [String: Any] = ["running": false, "status": "Not started"]
    private var propagationTask: Task<Void, Never>?
    private var propagationLastAttempt: Date?
    private var propagationState: [String: Any] = ["status": "Not loaded", "source": "N0NBH / HamQSL"]
    private var qrzClient: QRZClient?
    private var qrzCredentialDigest: Data?

    init(logbook: LiveLogbookMethods = .shared) { self.logbook = logbook }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        switch method {
        case "propagation_snapshot":
            guard params.isEmpty else { throw invalid() }
            if propagationTask == nil && Date().timeIntervalSince(propagationLastAttempt ?? .distantPast) >= 600 {
                propagationLastAttempt = Date()
                propagationTask = Task { [weak self] in
                    do {
                        let value = try await PropagationConditionsClient().fetch()
                        await self?.recordPropagation(value)
                    } catch { await self?.propagationFailed() }
                }
            }
            return propagationState
        case "secret_save":
            let secrets = try workspaceSecrets()
            guard Set(params.keys) == ["account", "value"], let name = params["account"] as? String,
                  let account = SecretStore.Account(rawValue: name), let value = params["value"] as? String,
                  value.utf8.count <= 8192 else { throw invalid() }
            try secrets.save(value, for: account)
            if account == .qrzPassword { qrzClient = nil; qrzCredentialDigest = nil }
            return ["saved": !value.isEmpty]
        case "secret_status":
            let secrets = try workspaceSecrets()
            guard params.isEmpty else { throw invalid() }
            var values: [String: Any] = [:]
            for account in [SecretStore.Account.wavelogToken, .qrzPassword, .clubLogAPIKey] {
                values[account.rawValue] = !(try secrets.load(account) ?? "").isEmpty
            }
            return values
        case "lookup_call":
            guard Set(params.keys) == ["call"], let raw = params["call"] as? String,
                  (1...32).contains(raw.utf8.count), raw.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 47 }) else { throw invalid() }
            let call = raw.uppercased()
            let settings = try logbook.currentSettings()
            let secrets = try workspaceSecrets()
            var profile: [String: Any] = ["call": call, "source": "No match"]
            if let country = try logbook.currentCTYResolver().resolve(call) {
                profile.merge(["country": country.name, "dxcc": country.adif,
                               "continent": country.continent, "cqZone": String(country.cqZone),
                               "ituZone": String(country.ituZone), "source": "CTY approximate",
                               "latitude": country.latitude as Any? ?? NSNull(),
                               "longitude": country.longitude as Any? ?? NSNull()]) { _, new in new }
            }
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
            if let origin = MaidenheadLocator.coordinate(settings.gridSquare),
               let lat = profile["latitude"] as? Double, let lon = profile["longitude"] as? Double {
                let solution = GreatCircle.solve(from: .init(latitude: origin.latitude, longitude: origin.longitude),
                                                to: .init(latitude: lat, longitude: lon))
                profile["bearing"] = solution.shortPathBearing
                profile["long_path_bearing"] = solution.longPathBearing
                profile["distance_km"] = solution.distanceKilometres
            }
            return profile
        case "weather":
            guard params.isEmpty else { throw invalid() }
            let settings = try logbook.currentSettings()
            guard let position = MaidenheadLocator.coordinate(settings.gridSquare) else {
                throw WorkerFailure("grid_required", "Configure the station grid before requesting weather.")
            }
            let value = try await WeatherClient.fetch(latitude: position.latitude, longitude: position.longitude)
            return ["temperature_c": value.temperatureC, "wind_kmh": value.windSpeedKMH,
                    "condition": value.condition.description, "observed_at": value.observedAt.timeIntervalSince1970,
                    "source": "Open-Meteo"]
        case "sync_status":
            guard params.isEmpty else { throw invalid() }
            let database = try logbook.openedDatabase()
            var result = syncState
            let mode = try logbook.currentSettings().logbookMode
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
            guard Set(params.keys) == ["confirm_single_writer"], params["confirm_single_writer"] as? Bool == true else {
                throw WorkerFailure("sync_confirmation_required", "Close other Wavelog sync applications and confirm this logbook is the only writer before synchronizing.")
            }
            guard syncTask == nil else { throw WorkerFailure("sync_busy", "Synchronization is already running.") }
            let settings = try logbook.currentSettings()
            guard settings.logbookMode == .wavelog else {
                throw WorkerFailure("sync_mode_local", "Choose Wavelog mode in Settings before synchronizing.")
            }
            let secrets = try workspaceSecrets()
            guard let url = URL(string: settings.wavelogURL), let token = try secrets.load(.wavelogToken) else {
                throw WorkerFailure("sync_configuration_required", "Configure the Wavelog URL, station ID and token first.")
            }
            let configuration = try WavelogConfiguration(baseURL: url, token: token, stationID: settings.wavelogStationID)
            try logbook.beginManualSync()
            let engine = SyncEngine(database: try logbook.openedDatabase(), configuration: configuration)
            syncState = ["running": true, "status": "Synchronizing"]
            syncTask = Task {
                do {
                    let report = try await engine.synchronize()
                    self.finish(["running": false, "status": report.failed == 0 ? "Completed" : "Completed with failures",
                        "pushed": report.pushed, "pulled": report.pulled, "deleted": report.deleted,
                        "conflicts_count": report.conflicts, "failed": report.failed])
                } catch {
                    self.finish(["running": false, "status": "Failed; review configuration and outbox before retrying"])
                }
            }
            return syncState
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
                guard let boolean = raw as? NSNumber, CFGetTypeID(boolean) == CFBooleanGetTypeID() else { throw invalid() }
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

    private func recordPropagation(_ value: PropagationConditionsSnapshot) {
        propagationState = ["status": "Current", "source": "N0NBH / HamQSL", "stale": false,
            "updated_at": value.updatedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
            "received_at": Date().timeIntervalSince1970,
            "solar_flux": value.solarFlux as Any? ?? NSNull(), "a_index": value.aIndex as Any? ?? NSNull(),
            "k_index": value.kIndex as Any? ?? NSNull(), "x_ray": value.xRay,
            "bands": value.displayBands.map { ["name": $0.name, "day": $0.day.rawValue, "night": $0.night.rawValue] }]
        propagationTask = nil
    }
    private func propagationFailed() {
        propagationState["status"] = "Refresh unavailable · retaining last observation"
        propagationState["stale"] = true
        propagationTask = nil
    }

    private func finish(_ state: [String: Any]) {
        logbook.endManualSync()
        syncState = state; syncTask = nil
        Task { try? await LiveClusterMethods.shared.refreshContacts() }
    }
    private func workspaceSecrets() throws -> SecretStore {
        SecretStore(service: try logbook.currentKeychainService())
    }
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
    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid service parameters.") }
}
#endif
