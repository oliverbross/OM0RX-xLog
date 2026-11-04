import Foundation

/// Saved library and concrete native route intent. No action, stream or PTT lease is persisted.
public struct VoiceProfile: Codable, Equatable, Sendable {
    public struct Route: Codable, Equatable, Sendable {
        public var deviceId: String
        public var channels: [Int]
        public var sampleRate: Int
    }
    public struct Routes: Codable, Equatable, Sendable {
        public var input: Route?
        public var monitor: Route?
        public var transmit: Route?
    }
    public struct Edit: Codable, Equatable, Sendable {
        public var trimStartMs: Int
        public var trimEndMs: Int?
        public var gainDb: Double
    }
    public var version: Int
    public var profilePath: String
    public var labels: [String]
    public var routes: Routes
    public var edits: [Edit]

    private enum CodingKeys: String, CodingKey { case version, profilePath, labels, routes, edits }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        profilePath = try c.decode(String.self, forKey: .profilePath)
        labels = try c.decode([String].self, forKey: .labels)
        routes = try c.decode(Routes.self, forKey: .routes)
        edits = try c.decode([Edit].self, forKey: .edits)
        func valid(_ route: Route?) -> Bool {
            guard let route else { return true }
            return !route.deviceId.isEmpty && route.deviceId.utf8.count <= 512 &&
                !route.deviceId.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) &&
                (8_000...192_000).contains(route.sampleRate) && (1...2).contains(route.channels.count) &&
                Set(route.channels).count == route.channels.count && route.channels.allSatisfy { (0..<32).contains($0) }
        }
        guard version == 1, profilePath.utf8.count <= 2_048,
              !profilePath.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              labels.count == 10, labels.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                  $0.utf16.count <= 40 && !$0.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) }),
              edits.count == 10, edits.allSatisfy({ (0..<60_000).contains($0.trimStartMs) &&
                  ($0.trimEndMs == nil || ($0.trimEndMs! > $0.trimStartMs && $0.trimEndMs! <= 60_000)) &&
                  $0.gainDb.isFinite && (-24...12).contains($0.gainDb) }),
              valid(routes.input), valid(routes.monitor), valid(routes.transmit) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                debugDescription: "Invalid voice library/routes; no audio or station action was performed."))
        }
        if let monitor = routes.monitor, let transmit = routes.transmit,
           monitor.deviceId == transmit.deviceId,
           !Set(monitor.channels).isDisjoint(with: Set(transmit.channels)) {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                debugDescription: "Monitor and transmit audio channels must be separate."))
        }
    }
}
