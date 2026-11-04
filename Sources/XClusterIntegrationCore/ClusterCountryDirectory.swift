import Foundation

/// Adapted from OM0RX-xCluster's CTYResolver (GPL-3.0-only).
/// The host provides its vetted CTY CSV bytes; this module has no bundled fallback data.
public struct ClusterCountry: Codable, Hashable, Sendable {
    public var name: String
    public var adif: Int
    public var continent: String
    public var cqZone: Int
    public var ituZone: Int
    public var latitude: Double?
    public var longitude: Double?

    public init(name: String, adif: Int, continent: String, cqZone: Int, ituZone: Int,
                latitude: Double? = nil, longitude: Double? = nil) {
        self.name = name; self.adif = adif; self.continent = continent
        self.cqZone = cqZone; self.ituZone = ituZone; self.latitude = latitude; self.longitude = longitude
    }
}

public struct ClusterCountryFacts: Sendable {
    public let country: ClusterCountry?
    public let status: String
    public let referenceRevision: String?
    public let locationPrecision: String
    public init(country: ClusterCountry?, status: String, referenceRevision: String?, locationPrecision: String) {
        self.country = country; self.status = status; self.referenceRevision = referenceRevision; self.locationPrecision = locationPrecision
    }
}

public struct ClusterCountryDirectory: Sendable {
    private struct Rule: Sendable {
        var token: String
        var exact: Bool
        var country: ClusterCountry
    }

    private let rules: [Rule]
    private let sharedResolver: (@Sendable (String, Date) -> ClusterCountryFacts)?
    public let snapshotIdentity: String?
    private let ignoredSuffixes: Set<String> = ["P", "M", "MM", "AM", "QRP", "QRPP", "A", "B", "QTH"]

    public static let empty = ClusterCountryDirectory(csv: "")
    public var isEmpty: Bool { sharedResolver == nil && rules.isEmpty }

    /// The application host injects its immutable admitted reference snapshot.
    /// Cluster has no dependency on the logbook module and no second live parser.
    public init(snapshotIdentity: String, resolve: @escaping @Sendable (String, Date) -> ClusterCountryFacts) {
        rules = []; sharedResolver = resolve; self.snapshotIdentity = snapshotIdentity
    }

    public init(csv: String) {
        sharedResolver = nil; snapshotIdentity = nil
        var parsed: [Rule] = []
        for line in csv.split(whereSeparator: \.isNewline) {
            let columns = Self.csvColumns(String(line))
            guard columns.count >= 9, let adif = Int(columns[2]), let cq = Int(columns[4]),
                  let itu = Int(columns[5]) else { continue }
            let country = ClusterCountry(name: columns[1].uppercased(), adif: adif,
                                         continent: columns[3].uppercased(), cqZone: cq, ituZone: itu,
                                         latitude: Double(columns[6]), longitude: Double(columns[7]).map { -$0 })
            let aliases = columns.count > 9 ? columns[9] : columns[0]
            for raw in [columns[0]] + aliases.split(whereSeparator: { $0 == " " || $0 == ";" }).map(String.init) {
                let token = Self.cleanToken(raw)
                if !token.isEmpty { parsed.append(.init(token: token, exact: raw.hasPrefix("="), country: country)) }
            }
        }
        rules = parsed.sorted { lhs, rhs in
            lhs.token.count == rhs.token.count ? lhs.exact && !rhs.exact : lhs.token.count > rhs.token.count
        }
    }

    public func resolve(_ rawCallsign: String, at date: Date = Date()) -> ClusterCountry? {
        if let sharedResolver { return sharedResolver(rawCallsign, date).country }
        let call = rawCallsign.uppercased().filter { $0.isLetter || $0.isNumber || $0 == "/" }
        if let exact = rules.first(where: { $0.exact && call == $0.token }) { return exact.country }
        var components: [String] = []
        for (index, raw) in call.split(separator: "/").enumerated() {
            let part = String(raw)
            if (index == 0 || !ignoredSuffixes.contains(part)) && part.contains(where: \.isLetter) { components.append(part) }
        }
        let candidates = components.sorted { $0.count == $1.count ? $0 < $1 : $0.count < $1.count } + [call]
        for candidate in candidates {
            for rule in rules where rule.exact ? candidate == rule.token : candidate.hasPrefix(rule.token) {
                if rule.token == "KG4", candidate.range(of: #"^KG4[A-Z]{3}$"#, options: .regularExpression) != nil,
                   rule.country.name.contains("GUANTANAMO") { continue }
                return rule.country
            }
        }
        return nil
    }

    public func facts(_ call: String, at date: Date) -> ClusterCountryFacts {
        if let sharedResolver { return sharedResolver(call, date) }
        let country = resolve(call, at: date)
        return ClusterCountryFacts(country: country, status: country == nil ? "unknown" : "resolved", referenceRevision: nil,
            locationPrecision: country == nil ? "unavailable" : "entityApproximation")
    }

    private static func cleanToken(_ raw: String) -> String {
        var token = raw.uppercased().trimmingCharacters(in: CharacterSet(charactersIn: "*=;"))
        token = token.replacingOccurrences(of: #"\([^)]*\)|\[[^]]*\]|<[^>]*>"#, with: "", options: .regularExpression)
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func csvColumns(_ line: String) -> [String] {
        var columns: [String] = [], current = "", quoted = false
        for character in line {
            if character == "\"" { quoted.toggle() }
            else if character == "," && !quoted { columns.append(current.trimmingCharacters(in: .whitespaces)); current = "" }
            else { current.append(character) }
        }
        columns.append(current.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ";"))))
        return columns
    }
}
