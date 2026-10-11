import Foundation

public struct DXCCBoundaryPolygon: Equatable, Sendable {
    public let outerRing: [GeoCoordinate]
    public let innerRings: [[GeoCoordinate]]

    public init(outerRing: [GeoCoordinate], innerRings: [[GeoCoordinate]] = []) {
        self.outerRing = outerRing
        self.innerRings = innerRings
    }
}

public struct DXCCBoundary: Equatable, Identifiable, Sendable {
    public let adif: Int
    public let prefix: String
    public let name: String
    public let polygons: [DXCCBoundaryPolygon]

    public var id: Int { adif }

    public init(adif: Int, prefix: String, name: String, polygons: [DXCCBoundaryPolygon]) {
        self.adif = adif
        self.prefix = prefix
        self.name = name
        self.polygons = polygons
    }
}

public enum DXCCBoundaryStore {
    public static func bundled() throws -> [DXCCBoundary] {
        guard let url = Bundle.module.url(forResource: "dxcc-boundaries", withExtension: "geojson") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try load(url: url)
    }

    public static func load(url: URL) throws -> [DXCCBoundary] {
        let collection = try JSONDecoder().decode(FeatureCollection.self, from: Data(contentsOf: url))
        var grouped: [Int: BoundaryBuilder] = [:]

        for feature in collection.features {
            guard let adif = feature.properties.dxccEntityCode, adif > 0 else { continue }
            let polygons = feature.geometry.polygons.compactMap(Self.makePolygon)
            guard !polygons.isEmpty else { continue }

            var builder = grouped[adif] ?? BoundaryBuilder(
                prefix: feature.properties.dxccPrefix ?? "",
                name: feature.properties.dxccName ?? "DXCC \(adif)",
                polygons: []
            )
            builder.polygons.append(contentsOf: polygons)
            grouped[adif] = builder
        }

        return grouped.map { adif, builder in
            DXCCBoundary(adif: adif, prefix: builder.prefix, name: builder.name, polygons: builder.polygons)
        }
        .sorted { lhs, rhs in lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending }
    }

    private static func makePolygon(_ rings: [[[Double]]]) -> DXCCBoundaryPolygon? {
        guard let first = rings.first, let outer = coordinates(first), outer.count >= 4 else { return nil }
        let holes = rings.dropFirst().compactMap { ring -> [GeoCoordinate]? in
            guard let result = coordinates(ring), result.count >= 4 else { return nil }
            return result
        }
        return DXCCBoundaryPolygon(outerRing: outer, innerRings: holes)
    }

    private static func coordinates(_ positions: [[Double]]) -> [GeoCoordinate]? {
        var result: [GeoCoordinate] = []
        result.reserveCapacity(positions.count)
        for position in positions {
            guard position.count >= 2 else { return nil }
            let longitude = position[0]
            let latitude = position[1]
            guard latitude.isFinite, longitude.isFinite,
                  (-90...90).contains(latitude), (-180...180).contains(longitude) else { return nil }
            result.append(GeoCoordinate(latitude: latitude, longitude: longitude))
        }
        return result
    }
}

private struct BoundaryBuilder {
    var prefix: String
    var name: String
    var polygons: [DXCCBoundaryPolygon]
}

private struct FeatureCollection: Decodable {
    let features: [Feature]
}

private struct Feature: Decodable {
    let properties: Properties
    let geometry: Geometry
}

private struct Properties: Decodable {
    let dxccPrefix: String?
    let dxccName: String?
    let dxccEntityCode: Int?

    enum CodingKeys: String, CodingKey {
        case dxccPrefix = "dxcc_prefix"
        case dxccName = "dxcc_name"
        case dxccEntityCode = "dxcc_entity_code"
    }
}

private struct Geometry: Decodable {
    let type: String
    let coordinates: GeoJSONCoordinates

    var polygons: [[[[Double]]]] {
        switch (type, coordinates) {
        case ("Polygon", .polygon(let polygon)):
            return [polygon]
        case ("MultiPolygon", .multiPolygon(let polygons)):
            return polygons
        default:
            return []
        }
    }
}

private enum GeoJSONCoordinates: Decodable {
    case polygon([[[Double]]])
    case multiPolygon([[[[Double]]]])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let polygons = try? container.decode([[[[Double]]]].self) {
            self = .multiPolygon(polygons)
        } else {
            self = .polygon(try container.decode([[[Double]]].self))
        }
    }
}
