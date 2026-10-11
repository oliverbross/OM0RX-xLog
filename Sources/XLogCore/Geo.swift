import Foundation

public struct GeoCoordinate: Codable, Equatable, Hashable, Sendable {
    public let latitude: Double
    public let longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

public struct GreatCircleSolution: Equatable, Sendable {
    public let distanceKilometres: Double
    public let shortPathBearing: Double
    public let longPathBearing: Double
}

public enum GreatCircle {
    private static let earthRadiusKilometres = 6_371.0088

    public static func solve(from origin: GeoCoordinate, to destination: GeoCoordinate) -> GreatCircleSolution {
        let lat1 = origin.latitude.radians
        let lat2 = destination.latitude.radians
        let deltaLat = (destination.latitude - origin.latitude).radians
        let deltaLon = (destination.longitude - origin.longitude).radians
        let a = sin(deltaLat / 2) * sin(deltaLat / 2)
            + cos(lat1) * cos(lat2) * sin(deltaLon / 2) * sin(deltaLon / 2)
        let distance = earthRadiusKilometres * 2 * atan2(sqrt(a), sqrt(max(0, 1 - a)))
        let y = sin(deltaLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        let short = normalized(atan2(y, x).degrees)
        return GreatCircleSolution(
            distanceKilometres: distance,
            shortPathBearing: short,
            longPathBearing: normalized(short + 180)
        )
    }

    private static func normalized(_ degrees: Double) -> Double {
        let result = degrees.truncatingRemainder(dividingBy: 360)
        return result < 0 ? result + 360 : result
    }
}

private extension Double {
    var radians: Double { self * .pi / 180 }
    var degrees: Double { self * 180 / .pi }
}
