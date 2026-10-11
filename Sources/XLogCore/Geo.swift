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

    /// Samples either arc of the great circle between two coordinates. The
    /// long-path variant deliberately takes the complementary arc so maps can
    /// render the same route the antenna is aimed along.
    public static func route(
        from origin: GeoCoordinate,
        to destination: GeoCoordinate,
        longPath: Bool,
        segments: Int = 96
    ) -> [GeoCoordinate] {
        let start = UnitVector(coordinate: origin)
        let end = UnitVector(coordinate: destination)
        let dot = min(1, max(-1, start.dot(end)))
        let shortSweep = acos(dot)
        guard shortSweep > 0.000_001 else { return [origin, destination] }

        var axis = start.cross(end)
        if axis.length < 0.000_001 {
            axis = abs(start.z) < 0.9
                ? start.cross(UnitVector(x: 0, y: 0, z: 1))
                : start.cross(UnitVector(x: 0, y: 1, z: 0))
        }
        axis = axis.normalized
        let sweep: Double
        if longPath {
            axis = axis.negated
            sweep = 2 * .pi - shortSweep
        } else {
            sweep = shortSweep
        }

        let count = max(2, segments)
        return (0...count).map { index in
            if index == 0 { return origin }
            if index == count { return destination }
            return start.rotated(around: axis, by: sweep * Double(index) / Double(count)).coordinate
        }
    }

    private static func normalized(_ degrees: Double) -> Double {
        let result = degrees.truncatingRemainder(dividingBy: 360)
        return result < 0 ? result + 360 : result
    }
}

private struct UnitVector {
    var x: Double
    var y: Double
    var z: Double

    init(x: Double, y: Double, z: Double) {
        self.x = x; self.y = y; self.z = z
    }

    init(coordinate: GeoCoordinate) {
        let latitude = coordinate.latitude.radians
        let longitude = coordinate.longitude.radians
        x = cos(latitude) * cos(longitude)
        y = cos(latitude) * sin(longitude)
        z = sin(latitude)
    }

    var length: Double { sqrt(x * x + y * y + z * z) }
    var normalized: UnitVector {
        let divisor = max(length, 0.000_001)
        return UnitVector(x: x / divisor, y: y / divisor, z: z / divisor)
    }
    var negated: UnitVector { UnitVector(x: -x, y: -y, z: -z) }

    func dot(_ other: UnitVector) -> Double { x * other.x + y * other.y + z * other.z }
    func cross(_ other: UnitVector) -> UnitVector {
        UnitVector(
            x: y * other.z - z * other.y,
            y: z * other.x - x * other.z,
            z: x * other.y - y * other.x
        )
    }
    func rotated(around axis: UnitVector, by angle: Double) -> UnitVector {
        let cosine = cos(angle)
        let sine = sin(angle)
        let cross = axis.cross(self)
        let projection = axis.dot(self) * (1 - cosine)
        return UnitVector(
            x: x * cosine + cross.x * sine + axis.x * projection,
            y: y * cosine + cross.y * sine + axis.y * projection,
            z: z * cosine + cross.z * sine + axis.z * projection
        ).normalized
    }

    var coordinate: GeoCoordinate {
        GeoCoordinate(
            latitude: atan2(z, sqrt(x * x + y * y)).degrees,
            longitude: atan2(y, x).degrees
        )
    }
}

extension Double {
    var radians: Double { self * .pi / 180 }
    var degrees: Double { self * 180 / .pi }
}
