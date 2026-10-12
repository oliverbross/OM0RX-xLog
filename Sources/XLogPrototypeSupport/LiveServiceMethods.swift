#if os(macOS)
import Foundation
import XLogCore

/// Real production services reused by the shared UI. No network job starts on
/// initialization and synchronization is never automatically enabled on a copy.
actor LiveServiceMethods {
    static let shared = LiveServiceMethods()
    private var syncTask: Task<Void, Never>?
    private var syncState: [String: Any] = ["running": false, "status": "Not started"]

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        switch method {
        case "secret_save":
            let secrets = try workspaceSecrets()
            guard Set(params.keys) == ["account", "value"], let name = params["account"] as? String,
                  let account = SecretStore.Account(rawValue: name), let value = params["value"] as? String,
                  value.utf8.count <= 8192 else { throw invalid() }
            try secrets.save(value, for: account)
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
            let settings = try LiveLogbookMethods.shared.currentSettings()
            let secrets = try workspaceSecrets()
            var profile: [String: Any] = ["call": call, "source": "No match"]
            if let country = try LiveLogbookMethods.shared.currentCTYResolver().resolve(call) {
                profile.merge(["country": country.name, "dxcc": country.adif,
                               "continent": country.continent, "cqZone": String(country.cqZone),
                               "ituZone": String(country.ituZone), "source": "CTY approximate",
                               "latitude": country.latitude as Any? ?? NSNull(),
                               "longitude": country.longitude as Any? ?? NSNull()]) { _, new in new }
            }
            if settings.qrzEnabled, let password = try secrets.load(.qrzPassword), !password.isEmpty {
                let result = try await QRZClient(username: settings.qrzUsername, password: password).lookup(call)
                profile.merge(["name": result.name, "gridSquare": result.gridSquare, "country": result.country,
                    "dxcc": result.dxcc as Any? ?? NSNull(), "cqZone": result.cqZone, "ituZone": result.ituZone,
                    "state": result.state, "county": result.county, "qth": result.qth, "email": result.email,
                    "latitude": result.latitude as Any? ?? NSNull(), "longitude": result.longitude as Any? ?? NSNull(),
                    "source": "QRZ"]) { _, new in new }
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
            let settings = try LiveLogbookMethods.shared.currentSettings()
            guard let position = MaidenheadLocator.coordinate(settings.gridSquare) else {
                throw WorkerFailure("grid_required", "Configure the station grid before requesting weather.")
            }
            let value = try await WeatherClient.fetch(latitude: position.latitude, longitude: position.longitude)
            return ["temperature_c": value.temperatureC, "wind_kmh": value.windSpeedKMH,
                    "condition": value.condition.description, "observed_at": value.observedAt.timeIntervalSince1970,
                    "source": "Open-Meteo"]
        case "sync_status":
            guard params.isEmpty else { throw invalid() }
            let database = try LiveLogbookMethods.shared.openedDatabase()
            var result = syncState
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            result["conflicts"] = try JSONSerialization.jsonObject(with: encoder.encode(database.conflicts()))
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
            let settings = try LiveLogbookMethods.shared.currentSettings()
            let secrets = try workspaceSecrets()
            guard let url = URL(string: settings.wavelogURL), let token = try secrets.load(.wavelogToken) else {
                throw WorkerFailure("sync_configuration_required", "Configure the Wavelog URL, station ID and token first.")
            }
            let configuration = try WavelogConfiguration(baseURL: url, token: token, stationID: settings.wavelogStationID)
            try LiveLogbookMethods.shared.beginManualSync()
            let engine = SyncEngine(database: try LiveLogbookMethods.shared.openedDatabase(), configuration: configuration)
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
            guard Set(params.keys) == ["id"], let text = params["id"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
            try LiveLogbookMethods.shared.openedDatabase().retrySync(localID: id)
            return ["queued": true]
        case "sync_resolve":
            guard Set(params.keys) == ["id", "use_remote"], let text = params["id"] as? String,
                  let id = UUID(uuidString: text), let useRemote = params["use_remote"] as? Bool else { throw invalid() }
            let db = try LiveLogbookMethods.shared.openedDatabase()
            guard let conflict = try db.conflicts().first(where: { $0.id == id }) else { throw invalid() }
            try db.resolveConflict(conflict, useRemote: useRemote)
            return ["resolved": true]
        default: throw WorkerFailure("method_not_allowed", "Unknown service operation.")
        }
    }

    private func finish(_ state: [String: Any]) {
        LiveLogbookMethods.shared.endManualSync()
        syncState = state; syncTask = nil
        Task { try? await LiveClusterMethods.shared.refreshContacts() }
    }
    private func workspaceSecrets() throws -> SecretStore {
        SecretStore(service: try LiveLogbookMethods.shared.currentKeychainService())
    }
    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid service parameters.") }
}
#endif
