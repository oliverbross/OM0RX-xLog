import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
import XCatIntegrationCore

/// Workspace-owned, credential-free services. Construction does not start I/O.
/// Uses the native parsers with a bounded, cookie/credential-free HTTP transport.
actor LivePublicServiceMethods {
    typealias Download = @Sendable (URLRequest, OpportunityDownload.Format, Int) async throws -> Data
    private let logbook: LiveLogbookMethods
    private let download: Download
    private let now: @Sendable () -> Date
    private var stopped = false
    private var propagationTask: Task<Void, Never>?
    private var propagationState: [String: Any] = ["status": "Not loaded", "source": "N0NBH / HamQSL"]
    private var weatherTask: (id: UUID, url: URL, task: Task<Data, Error>)?

    init(logbook: LiveLogbookMethods, now: @escaping @Sendable () -> Date = { Date() },
         download: @escaping Download = { request, format, limit in
             try await OpportunityDownload.fetch(request, configuration: .ephemeral, format: format, byteLimit: limit)
         }) {
        self.logbook = logbook
        self.now = now
        self.download = download
    }

    func terminate() {
        stopped = true
        propagationTask?.cancel(); propagationTask = nil
        weatherTask?.task.cancel(); weatherTask = nil
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !stopped else { throw WorkerFailure("worker_stopping", "Public services have stopped.") }
        switch method {
        case "lookup_call":
            let call = try LocalCallsignProfile.validatedCall(params)
            var profile = try LocalCallsignProfile.base(call, logbook: logbook)
            LocalCallsignProfile.addGeometry(to: &profile, grid: try logbook.currentSettings().gridSquare)
            // Do not imply a QRZ lookup occurred on platforms awaiting their vault.
            profile["qrz_available"] = false
            return profile
        case "propagation_snapshot":
            guard params.isEmpty else { throw invalid() }
            return propagationState
        case "propagation_refresh":
            guard params.isEmpty else { throw invalid() }
            if propagationTask == nil {
                let download = self.download
                propagationTask = Task { [weak self] in
                    do {
                        var request = URLRequest(url: PropagationConditionsClient.endpoint)
                        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
                        request.timeoutInterval = 15
                        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
                        request.setValue("OM0RX-xLog/0.4", forHTTPHeaderField: "User-Agent")
                        let data = try await download(request, .xml, 256_000)
                        let value = try PropagationConditionsParser.parse(data)
                        await self?.recordPropagation(value)
                    } catch { await self?.propagationFailed() }
                }
            }
            // Explicit refresh callers share one bounded, credential-free fetch.
            // Passive snapshots never start it or require a renderer poll loop.
            if let pending = propagationTask { await pending.value }
            guard !stopped else { throw WorkerFailure("worker_stopping", "Public services have stopped.") }
            return propagationState
        case "weather":
            guard params.isEmpty else { throw invalid() }
            guard let position = MaidenheadLocator.coordinate(try logbook.currentSettings().gridSquare),
                  let url = WeatherClient.url(latitude: position.latitude, longitude: position.longitude) else {
                throw WorkerFailure("grid_required", "Configure the station grid before requesting weather.")
            }
            if weatherTask?.url != url {
                weatherTask?.task.cancel()
                let download = self.download
                var request = URLRequest(url: url)
                request.timeoutInterval = 12
                let weatherRequest = request
                weatherTask = (UUID(), url, Task { try await download(weatherRequest, .json, 256_000) })
            }
            guard let active = weatherTask else { throw invalid() }
            defer { if weatherTask?.id == active.id { weatherTask = nil } }
            let data = try await active.task.value
            guard !stopped else { throw WorkerFailure("worker_stopping", "Public services have stopped.") }
            guard let current = MaidenheadLocator.coordinate(try logbook.currentSettings().gridSquare),
                  WeatherClient.url(latitude: current.latitude, longitude: current.longitude) == active.url else {
                throw WorkerFailure("weather_location_changed", "Station location changed; refresh weather for the current grid.")
            }
            let value = try WeatherClient.decode(data, fetchedAt: now())
            return ["temperature_c": value.temperatureC, "wind_kmh": value.windSpeedKMH,
                    "condition": value.condition.description, "observed_at": value.observedAt.timeIntervalSince1970,
                    "source": "Open-Meteo"]
        default: throw WorkerFailure("method_not_allowed", "Unknown public service operation.")
        }
    }

    private func recordPropagation(_ value: PropagationConditionsSnapshot) {
        guard !stopped else { return }
        propagationState = ["status": "Current", "source": "N0NBH / HamQSL", "stale": false,
            "updated_at": value.updatedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
            "received_at": now().timeIntervalSince1970,
            "solar_flux": value.solarFlux as Any? ?? NSNull(), "a_index": value.aIndex as Any? ?? NSNull(),
            "k_index": value.kIndex as Any? ?? NSNull(), "x_ray": value.xRay,
            "bands": value.displayBands.map { ["name": $0.name, "day": $0.day.rawValue, "night": $0.night.rawValue] }]
        propagationTask = nil
    }

    private func propagationFailed() {
        guard !stopped else { return }
        propagationState["status"] = "Refresh unavailable · retaining last observation"
        propagationState["stale"] = true
        propagationTask = nil
    }

    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid public service parameters.") }
}

enum LocalCallsignProfile {
    private static let bundledResolver = try? CTYResolver.bundled()

    static func validatedCall(_ params: [String: Any]) throws -> String {
        guard Set(params.keys) == ["call"], let raw = params["call"] as? String,
              (1...32).contains(raw.utf8.count), raw.utf8.allSatisfy({
                  (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 47
              }) else { throw WorkerFailure("invalid_params", "Invalid callsign lookup parameters.") }
        return raw.uppercased()
    }

    static func base(_ call: String, logbook: LiveLogbookMethods) throws -> [String: Any] {
        var profile: [String: Any] = ["call": call, "source": "No match"]
        // Callsign identity is useful before the workspace/database owner has
        // completed launch. Prefer its downloaded CTY snapshot, but never lose
        // bundled prefix resolution merely because that owner is unavailable.
        let resolver = logbook.currentCTYResolverIfReady()
        if let country = resolver?.resolve(call) ?? bundledResolver?.resolve(call) {
            profile.merge(["country": country.name, "dxcc": country.adif,
                "continent": country.continent, "cqZone": String(country.cqZone),
                "ituZone": String(country.ituZone), "source": "CTY approximate",
                "latitude": country.latitude as Any? ?? NSNull(),
                "longitude": country.longitude as Any? ?? NSNull()]) { _, new in new }
        }
        return profile
    }

    static func addGeometry(to profile: inout [String: Any], grid: String) {
        guard let origin = MaidenheadLocator.coordinate(grid),
              let lat = profile["latitude"] as? Double, let lon = profile["longitude"] as? Double else { return }
        let solution = GreatCircle.solve(from: .init(latitude: origin.latitude, longitude: origin.longitude),
                                        to: .init(latitude: lat, longitude: lon))
        profile["bearing"] = solution.shortPathBearing
        profile["long_path_bearing"] = solution.longPathBearing
        profile["distance_km"] = solution.distanceKilometres
    }
}
