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
}

public struct ClusterCountryDirectory: Sendable {
    private struct Rule: Sendable {
        var token: String
        var exact: Bool
        var country: ClusterCountry
    }

    private let rules: [Rule]
    private let ignoredSuffixes: Set<String> = ["P", "M", "MM", "AM", "QRP", "QRPP", "A", "B", "QTH"]

    public static let empty = ClusterCountryDirectory(csv: "")
    public var isEmpty: Bool { rules.isEmpty }

    public init(csv: String) {
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

    public func resolve(_ rawCallsign: String) -> ClusterCountry? {
        let call = rawCallsign.uppercased().filter { $0.isLetter || $0.isNumber || $0 == "/" }
        if call == "PJ6Y" || call.hasPrefix("PJ") {
            return rules.first(where: { $0.country.adif == 305 })?.country
        }
        let candidates = [call] + call.split(separator: "/").map(String.init)
            .filter { !ignoredSuffixes.contains($0) }.sorted { $0.count > $1.count }
        for candidate in candidates {
            for rule in rules where rule.exact ? candidate == rule.token : candidate.hasPrefix(rule.token) {
                if rule.token == "KG4", candidate.range(of: #"^KG4[A-Z]{3}$"#, options: .regularExpression) != nil,
                   rule.country.name.contains("GUANTANAMO") { continue }
                return rule.country
            }
        }
        return nil
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
