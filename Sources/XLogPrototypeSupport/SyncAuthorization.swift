import Foundation

/// Explicit consent belongs to one workspace generation and one remote station.
/// It is not part of exported settings/backups and contains no credential.
struct SyncAuthorization: Codable, Equatable {
    // Version 1 cannot prove a durable mode/destination epoch. Require explicit
    // new consent after upgrade instead of migrating a potentially stale grant.
    let version: Int
    let generation: String
    let service: String
    let workspacePath: String
    let endpoint: String
    let stationID: Int
    let intervalMinutes: Int
    let targetRevision: Int64

    func matches(generation: String, service: String, workspacePath: String, endpoint: String, stationID: Int, targetRevision: Int64) -> Bool {
        version == 2 && self.targetRevision == targetRevision && (1...60).contains(intervalMinutes) && self.generation == generation &&
            self.service == service && self.workspacePath == workspacePath && self.endpoint == endpoint && self.stationID == stationID
    }
}
