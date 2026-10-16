import Foundation
import XStationIntegrationCore

/// Pure adapter for the native host's already-retained radio projection.
/// It never reads configuration, starts a session or contacts a provider.
enum LiveConnectionDoctorMethods {
    static let method = "connection_doctor_project"

    static func handle(_ params: [String: Any]) throws -> [String: Any] {
        guard Set(params.keys) == ["snapshot", "now"],
              let snapshot = params["snapshot"] as? [String: Any],
              let now = try? decodeNumber(params["now"]), now.isFinite else {
            throw WorkerFailure("invalid_params", "Invalid retained Connection Doctor projection.")
        }
        let preview = ConnectionDoctor.project(retainedSnapshot: snapshot, now: now)
        let data = try JSONEncoder().encode(preview)
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw WorkerFailure("projection_failed", "Connection Doctor preview is unavailable.")
        }
        return result
    }

    private static func decodeNumber(_ value: Any?) throws -> Double {
        let data = try JSONSerialization.data(withJSONObject: [value as Any])
        guard let result = try? JSONDecoder().decode([Double].self, from: data).first else {
            throw WorkerFailure("invalid_params", "Invalid retained Connection Doctor time.")
        }
        return result
    }
}
