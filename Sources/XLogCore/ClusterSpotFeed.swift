import Foundation

public struct ClusterSpot: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var receivedAt: Date
    public var callsign: String
    public var frequencyKHz: Double
    public var band: String
    public var mode: String
    public var country: String
    public var continent: String
    public var latitude: Double?
    public var longitude: Double?
    public var comment: String
    public var callStatus: String
    public var dxccStatus: String
    public var specialTags: [String]
    public var score: Int
    public var source: String
    public var statusHex: String
    public var bandHex: String
    public var modeHex: String
}

public struct ClusterSpotSnapshot: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var generatedAt: Date
    public var connectedClusters: Int
    public var spots: [ClusterSpot]
}

public enum ClusterSpotFeed {
    public static func defaultURL(fileManager: FileManager = .default) throws -> URL {
        let support = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support.appendingPathComponent("OM0RX-xCluster/spots.json")
    }

    public static func read(from url: URL? = nil) throws -> ClusterSpotSnapshot {
        let target = try url ?? defaultURL()
        return try JSONDecoder().decode(ClusterSpotSnapshot.self, from: Data(contentsOf: target))
    }
}

public enum MaidenheadLocator {
    public static func coordinate(_ locator: String) -> (latitude: Double, longitude: Double)? {
        let text = locator.uppercased().filter { $0.isLetter || $0.isNumber }
        guard text.count >= 4 else { return nil }
        let values = Array(text.utf8)
        guard let a = letter(values[0]), let b = letter(values[1]),
              let c = digit(values[2]), let d = digit(values[3]), a < 18, b < 18 else { return nil }
        let fieldLongitude = Double(a) * 20.0
        let squareLongitude = Double(c) * 2.0
        let fieldLatitude = Double(b) * 10.0
        let squareLatitude = Double(d)
        var longitude = -180.0 + fieldLongitude + squareLongitude + 1.0
        var latitude = -90.0 + fieldLatitude + squareLatitude + 0.5
        if values.count >= 6, let e = letter(values[4]), let f = letter(values[5]), e < 24, f < 24 {
            longitude += Double(e) / 12.0 - 1.0 + 1.0 / 24.0
            latitude += Double(f) / 24.0 - 0.5 + 1.0 / 48.0
        }
        return (latitude, longitude)
    }

    private static func letter(_ value: UInt8) -> Int? {
        guard value >= 65, value <= 90 else { return nil }
        return Int(value - 65)
    }

    private static func digit(_ value: UInt8) -> Int? {
        guard value >= 48, value <= 57 else { return nil }
        return Int(value - 48)
    }
}
