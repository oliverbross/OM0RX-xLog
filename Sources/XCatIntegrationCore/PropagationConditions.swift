// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation

public enum PropagationRating: String, Equatable, Sendable {
    case good
    case fair
    case poor
    case closed
    case unknown

    public init(sourceValue: String) {
        let normalized = sourceValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.contains("good") { self = .good }
        else if normalized.contains("fair") { self = .fair }
        else if normalized.contains("poor") { self = .poor }
        else if normalized.contains("closed") { self = .closed }
        else { self = .unknown }
    }

    public var label: String {
        switch self {
        case .good: "GOOD"
        case .fair: "FAIR"
        case .poor: "POOR"
        case .closed: "CLOSED"
        case .unknown: "--"
        }
    }
}

public struct HFPropagationBand: Equatable, Identifiable, Sendable {
    public let name: String
    public let day: PropagationRating
    public let night: PropagationRating

    public var id: String { name }

    public init(name: String, day: PropagationRating, night: PropagationRating) {
        self.name = name
        self.day = day
        self.night = night
    }
}

public struct PropagationConditionsSnapshot: Equatable, Sendable {
    public let updatedAt: Date?
    public let solarFlux: Int?
    public let aIndex: Int?
    public let kIndex: Int?
    public let xRay: String
    public let bands: [HFPropagationBand]
    public let sixMeterEurope: PropagationRating

    public init(
        updatedAt: Date?,
        solarFlux: Int?,
        aIndex: Int?,
        kIndex: Int?,
        xRay: String,
        bands: [HFPropagationBand],
        sixMeterEurope: PropagationRating
    ) {
        self.updatedAt = updatedAt
        self.solarFlux = solarFlux
        self.aIndex = aIndex
        self.kIndex = kIndex
        self.xRay = xRay
        self.bands = bands
        self.sixMeterEurope = sixMeterEurope
    }

    public var displayBands: [HFPropagationBand] {
        bands + [HFPropagationBand(name: "6m", day: sixMeterEurope, night: sixMeterEurope)]
    }
}

public enum PropagationConditionsParser {
    public static func parse(_ data: Data) throws -> PropagationConditionsSnapshot {
        guard data.count <= 256_000 else {
            throw XCatError.server("Propagation data exceeded the safe response limit.")
        }
        let delegate = SolarXMLDelegate()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse() else {
            throw XCatError.server("The propagation service returned invalid XML.")
        }

        let preferredBands = ["80m-40m", "30m-20m", "17m-15m", "12m-10m"]
        let displayNames = ["80–40", "30–20", "17–15", "12–10"]
        let bands = zip(preferredBands, displayNames).map { sourceName, displayName in
            HFPropagationBand(
                name: displayName,
                day: PropagationRating(sourceValue: delegate.bandConditions["\(sourceName)|day"] ?? ""),
                night: PropagationRating(sourceValue: delegate.bandConditions["\(sourceName)|night"] ?? "")
            )
        }
        guard bands.contains(where: { $0.day != .unknown || $0.night != .unknown }) else {
            throw XCatError.server("The propagation service returned no HF conditions.")
        }

        return PropagationConditionsSnapshot(
            updatedAt: parseUpdateDate(delegate.values["updated"]),
            solarFlux: Int(delegate.values["solarflux"] ?? ""),
            aIndex: Int(delegate.values["aindex"] ?? ""),
            kIndex: Int(delegate.values["kindex"] ?? ""),
            xRay: delegate.values["xray"] ?? "--",
            bands: bands,
            sixMeterEurope: PropagationRating(sourceValue: delegate.phenomena["e-skip|europe_6m"] ?? "")
        )
    }

    private static func parseUpdateDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "d MMM yyyy HHmm zzz"
        return formatter.date(from: value.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

public struct PropagationConditionsClient: @unchecked Sendable {
    public static let endpoint = URL(string: "https://www.hamqsl.com/solarxml.php")!

    private let session: URLSession
    private let endpoint: URL

    public init(session: URLSession = .shared, endpoint: URL = Self.endpoint) {
        self.session = session
        self.endpoint = endpoint
    }

    public func fetch() async throws -> PropagationConditionsSnapshot {
        var request = URLRequest(url: endpoint)
        request.cachePolicy = .reloadRevalidatingCacheData
        request.timeoutInterval = 15
        request.setValue("OM0RX-xCat/0.5", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw XCatError.server("The propagation service is unavailable.")
        }
        return try PropagationConditionsParser.parse(data)
    }
}

private final class SolarXMLDelegate: NSObject, XMLParserDelegate {
    var values: [String: String] = [:]
    var bandConditions: [String: String] = [:]
    var phenomena: [String: String] = [:]

    private var currentElement = ""
    private var currentAttributes: [String: String] = [:]
    private var currentText = ""

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        currentElement = elementName.lowercased()
        currentAttributes = attributeDict.reduce(into: [:]) { $0[$1.key.lowercased()] = $1.value.lowercased() }
        currentText = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        currentText += string
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        let element = elementName.lowercased()
        let text = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
        if element == "band", let name = currentAttributes["name"], let time = currentAttributes["time"] {
            bandConditions["\(name)|\(time)"] = text
        } else if element == "phenomenon", let name = currentAttributes["name"], let location = currentAttributes["location"] {
            phenomena["\(name)|\(location)"] = text
        } else if !text.isEmpty {
            values[element] = text
        }
        currentElement = ""
        currentAttributes = [:]
        currentText = ""
    }
}
