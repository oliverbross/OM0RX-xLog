import Foundation

/// Explicit consent belongs to one workspace generation and one remote station.
/// It is not part of exported settings/backups and contains no credential.
struct SyncAuthorization: Codable, Equatable {
    let version: Int
    let generation: String
    let service: String
    let workspacePath: String
    let endpoint: String
    let stationID: Int
    let intervalMinutes: Int

    func matches(generation: String, service: String, workspacePath: String, endpoint: String, stationID: Int) -> Bool {
        version == 1 && (1...60).contains(intervalMinutes) && self.generation == generation &&
            self.service == service && self.workspacePath == workspacePath && self.endpoint == endpoint && self.stationID == stationID
    }
}
