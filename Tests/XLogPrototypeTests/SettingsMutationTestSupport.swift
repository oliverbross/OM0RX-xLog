import Foundation
@testable import XLogPrototypeSupport

extension LiveLogbookMethods {
    func saveSettingsForTest(_ value: Any, operationID: UUID = UUID()) throws -> [String: Any] {
        guard let settings = value as? [String: Any] else {
            throw WorkerFailure("test_setup", "Settings fixture is not a JSON object.")
        }
        let loaded = try handle(method: "settings_load", params: [:])
        guard let generation = loaded["generation"] as? String,
              let revision = (loaded["revision"] as? NSNumber)?.int64Value else {
            throw WorkerFailure("test_setup", "Revisioned settings snapshot is unavailable.")
        }
        return try handle(method: "settings_save", params: [
            "operationID": operationID.uuidString,
            "expectedRevision": revision,
            "generation": generation,
            "settings": settings,
        ])
    }
}
