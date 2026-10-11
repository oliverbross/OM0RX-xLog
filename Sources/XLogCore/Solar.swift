import Foundation

public struct SolarMapState: Equatable, Sendable {
    public let subsolarPoint: GeoCoordinate
    public let terminator: [GeoCoordinate]

    public init(subsolarPoint: GeoCoordinate, terminator: [GeoCoordinate]) {
        self.subsolarPoint = subsolarPoint
        self.terminator = terminator
    }
}

/// Lightweight solar geometry for the operator map. The approximation is
/// derived from the standard low-precision solar ephemeris and is comfortably
/// within the visual accuracy required by a world-map greyline display.
public enum SolarEphemeris {
    public static func state(at date: Date, samples: Int = 240) -> SolarMapState {
        let point = subsolarPoint(at: date)
        return SolarMapState(
            subsolarPoint: point,
            terminator: smallCircle(around: point, angularDistanceDegrees: 90, samples: samples)
        )
    }

    public static func subsolarPoint(at date: Date) -> GeoCoordinate {
        let julianDay = date.timeIntervalSince1970 / 86_400 + 2_440_587.5
        let daysSinceJ2000 = julianDay - 2_451_545.0

        let meanLongitude = normalizedDegrees(280.460 + 0.985_647_4 * daysSinceJ2000)
        let meanAnomaly = normalizedDegrees(357.528 + 0.985_600_3 * daysSinceJ2000).radians
        let eclipticLongitude = (
            meanLongitude + 1.915 * sin(meanAnomaly) + 0.020 * sin(2 * meanAnomaly)
        ).radians
        let obliquity = (23.439 - 0.000_000_4 * daysSinceJ2000).radians

        let rightAscension = atan2(cos(obliquity) * sin(eclipticLongitude), cos(eclipticLongitude)).degrees
        let declination = asin(sin(obliquity) * sin(eclipticLongitude)).degrees

        let centuries = daysSinceJ2000 / 36_525
        let greenwichSidereal = normalizedDegrees(
            280.460_618_37
                + 360.985_647_366_29 * daysSinceJ2000
                + 0.000_387_933 * centuries * centuries
                - centuries * centuries * centuries / 38_710_000
        )
        return GeoCoordinate(
            latitude: declination,
            longitude: normalizedLongitude(rightAscension - greenwichSidereal)
        )
    }

    public static func smallCircle(
        around center: GeoCoordinate,
        angularDistanceDegrees: Double,
        samples: Int = 240
    ) -> [GeoCoordinate] {
        let count = max(24, samples)
        let latitude = center.latitude.radians
        let longitude = center.longitude.radians
        let distance = angularDistanceDegrees.radians

        return (0...count).map { index in
            let bearing = (360 * Double(index) / Double(count)).radians
            let destinationLatitude = asin(
                sin(latitude) * cos(distance)
                    + cos(latitude) * sin(distance) * cos(bearing)
            )
            let destinationLongitude = longitude + atan2(
                sin(bearing) * sin(distance) * cos(latitude),
                cos(distance) - sin(latitude) * sin(destinationLatitude)
            )
            return GeoCoordinate(
                latitude: destinationLatitude.degrees,
                longitude: normalizedLongitude(destinationLongitude.degrees)
            )
        }
    }

    private static func normalizedDegrees(_ value: Double) -> Double {
        let result = value.truncatingRemainder(dividingBy: 360)
        return result < 0 ? result + 360 : result
    }

    private static func normalizedLongitude(_ value: Double) -> Double {
        var result = value.truncatingRemainder(dividingBy: 360)
        if result > 180 { result -= 360 }
        if result < -180 { result += 360 }
        return result
    }
}
