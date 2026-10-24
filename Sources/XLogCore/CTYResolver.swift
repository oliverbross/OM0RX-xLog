import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

public final class CTYResolver: @unchecked Sendable {
    fileprivate struct Rule {
        var token: String
        var endpointToken: String
        var primaryPrefix: String
        var exact: Bool
        var country: CountryInfo
        var endpointCountry: CountryInfo
        var start: Date?
        var end: Date?
    }

    private let rules: [Rule]
    private let endpointRules: [Rule]
    private let ignoredSuffixes: Set<String> = ["P", "M", "MM", "AM", "QRP", "QRPP", "A", "B", "QTH"]

    public init(csvURL: URL) throws {
        let text = try String(contentsOf: csvURL, encoding: .utf8)
        var parsed: [Rule] = []
        for line in text.split(whereSeparator: \ .isNewline) {
            let columns = Self.csvColumns(String(line))
            guard columns.count >= 9, let adif = Int(columns[2]), let cq = Int(columns[4]), let itu = Int(columns[5]) else { continue }
            let info = CountryInfo(name: columns[1].uppercased(), adif: adif, continent: columns[3].uppercased(), cqZone: cq,
                                   ituZone: itu, latitude: Double(columns[6]), longitude: Double(columns[7]).map { -$0 })
            let tokenText = columns.count > 9 ? columns[9] : columns[0]
            let tokens = ([columns[0]] + tokenText.split(whereSeparator: { $0 == " " || $0 == ";" }).map(String.init))
            for raw in tokens {
                let exact = raw.hasPrefix("=")
                let legacyToken = Self.cleanLegacyToken(raw)
                let endpointToken = Self.cleanEndpointToken(raw)
                if !legacyToken.isEmpty, !endpointToken.isEmpty {
                    parsed.append(Rule(token: legacyToken, endpointToken: endpointToken,
                                       primaryPrefix: columns[0].uppercased(),
                                       exact: exact, country: info,
                                       endpointCountry: Self.applyingOverrides(in: raw, to: info),
                                       start: nil, end: nil))
                }
            }
        }
        rules = Self.sortedRules(parsed, by: \.token)
        endpointRules = Self.sortedRules(parsed, by: \.endpointToken)
    }

    public static func bundled() throws -> CTYResolver {
        guard let url = Bundle.module.url(forResource: "cty", withExtension: "csv") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try CTYResolver(csvURL: url)
    }

    public static func bundledCSV() throws -> String {
        guard let url = Bundle.module.url(forResource: "cty", withExtension: "csv") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// Every distinct country endpoint that the resolver can return at `date`, including token-level
    /// CQ-zone, ITU-zone, and continent overrides from the pinned CTY data. This deliberately does
    /// not collapse by ADIF identity.
    public func reachableCountryEndpoints(at date: Date) -> [CountryInfo] {
        Array(Set(endpointRules.compactMap { rule in
            if let start = rule.start, date < start { return nil }
            if let end = rule.end, date > end { return nil }
            return rule.endpointCountry
        })).sorted {
            ($0.adif, $0.name, $0.continent, $0.cqZone, $0.ituZone) <
                ($1.adif, $1.name, $1.continent, $1.cqZone, $1.ituZone)
        }
    }

    public convenience init(xmlURL: URL) throws {
        let parser = ClubLogXMLParser()
        try parser.parse(url: xmlURL)
        self.init(rules: parser.rules)
    }

    private init(rules: [Rule]) {
        self.rules = Self.sortedRules(rules, by: \.token)
        endpointRules = Self.sortedRules(rules, by: \.endpointToken)
    }

    public func resolve(_ rawCallsign: String, at date: Date = Date()) -> CountryInfo? {
        matchingRule(rawCallsign, at: date, rules: rules, token: \.token)?.country
    }

    /// Opt-in resolver endpoint including CTY token-level CQ-zone, ITU-zone, and continent
    /// overrides. The legacy `resolve` result remains unchanged for persisted callers.
    public func resolveCountryEndpoint(_ rawCallsign: String, at date: Date = Date()) -> CountryInfo? {
        matchingRule(rawCallsign, at: date, rules: endpointRules, token: \.endpointToken)?.endpointCountry
    }

    /// Resolves the country endpoint together with the primary prefix from the
    /// matched CTY row. The prefix must not be inferred from ADIF alone because
    /// named CQ WW entities can share an ADIF number with an ordinary country.
    public func resolveCountryEndpointWithPrimaryPrefix(
        _ rawCallsign: String, at date: Date = Date()
    ) -> (country: CountryInfo, primaryPrefix: String)? {
        guard let rule = matchingRule(rawCallsign, at: date, rules: endpointRules,
                                      token: \.endpointToken) else { return nil }
        return (rule.endpointCountry, rule.primaryPrefix)
    }

    private func matchingRule(_ rawCallsign: String, at date: Date, rules: [Rule],
                              token: KeyPath<Rule, String>) -> Rule? {
        let call = rawCallsign.uppercased().filter { $0.isLetter || $0.isNumber || $0 == "/" }
        // A dated/exact expedition exception for the complete portable call is
        // authoritative. Prefix rules for the home callsign are not: for
        // EA8/OM0RX and OM0RX/EA8 the shorter slash component is the explicit
        // operating prefix and must be considered before OM.
        if let exact = rules.first(where: { rule in
            rule.exact && call == rule[keyPath: token] && Self.isActive(rule, at: date)
        }) { return exact }
        let components = call.split(separator: "/").map(String.init).filter {
            !ignoredSuffixes.contains($0) && $0.contains(where: { $0.isLetter })
        }
        let candidates = components.sorted {
            $0.count == $1.count ? $0 < $1 : $0.count < $1.count
        } + [call]
        for candidate in candidates {
            for rule in rules {
                guard Self.isActive(rule, at: date) else { continue }
                let ruleToken = rule[keyPath: token]
                if rule.exact ? candidate == ruleToken : candidate.hasPrefix(ruleToken) {
                    if ruleToken == "KG4", candidate.range(of: #"^KG4[A-Z]{3}$"#, options: .regularExpression) != nil,
                       rule.country.name.contains("GUANTANAMO") { continue }
                    return rule
                }
            }
        }
        return nil
    }

    private static func isActive(_ rule: Rule, at date: Date) -> Bool {
        if let start = rule.start, date < start { return false }
        if let end = rule.end, date > end { return false }
        return true
    }

    /// Reproduces only the removed PJ shortcut for a local impact preview.
    /// This is a comparison of inference, never evidence of a stored field's origin.
    public func pjCorrection(_ rawCallsign: String, at date: Date) -> (previous: CountryInfo?, current: CountryInfo?)? {
        let call = rawCallsign.uppercased().filter { $0.isLetter || $0.isNumber || $0 == "/" }
        guard call.hasPrefix("PJ") else { return nil }
        return (rules.first(where: { $0.country.adif == 305 })?.country, resolve(rawCallsign, at: date))
    }

    public var entities: [CountryInfo] {
        var unique: [Int: CountryInfo] = [:]
        for rule in rules where rule.country.latitude != nil && rule.country.longitude != nil {
            unique[rule.country.adif] = unique[rule.country.adif] ?? rule.country
        }
        return unique.values.sorted { lhs, rhs in lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending }
    }

    private static func cleanLegacyToken(_ raw: String) -> String {
        var token = raw.uppercased().trimmingCharacters(in: CharacterSet(charactersIn: "*=;"))
        token = token.replacingOccurrences(of: #"\([^)]*\)|\[[^]]*\]|<[^>]*>"#,
                                           with: "", options: .regularExpression)
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func cleanEndpointToken(_ raw: String) -> String {
        cleanLegacyToken(raw).replacingOccurrences(of: #"\{[^}]*\}"#, with: "", options: .regularExpression)
    }

    private static func sortedRules(_ rules: [Rule], by token: KeyPath<Rule, String>) -> [Rule] {
        rules.sorted { lhs, rhs in
            let lhsToken = lhs[keyPath: token]
            let rhsToken = rhs[keyPath: token]
            if lhsToken.count != rhsToken.count { return lhsToken.count > rhsToken.count }
            if lhs.exact != rhs.exact { return lhs.exact }
            // CTY rows commonly repeat the primary prefix in their token list.
            // After stripping annotations both rules can have the same token;
            // keep the annotated endpoint authoritative instead of relying on
            // the standard library sort's unspecified ordering for equal keys.
            let lhsOverrides = lhs.endpointCountry != lhs.country
            let rhsOverrides = rhs.endpointCountry != rhs.country
            if lhsOverrides != rhsOverrides { return lhsOverrides }
            return false
        }
    }

    private static func applyingOverrides(in raw: String, to country: CountryInfo) -> CountryInfo {
        CountryInfo(
            name: country.name,
            adif: country.adif,
            continent: textOverride(in: raw, opening: "{", closing: "}")?.uppercased() ?? country.continent,
            cqZone: integerOverride(in: raw, opening: "(", closing: ")") ?? country.cqZone,
            ituZone: integerOverride(in: raw, opening: "[", closing: "]") ?? country.ituZone,
            latitude: country.latitude,
            longitude: country.longitude
        )
    }

    private static func integerOverride(in raw: String, opening: Character, closing: Character) -> Int? {
        textOverride(in: raw, opening: opening, closing: closing).flatMap(Int.init)
    }

    private static func textOverride(in raw: String, opening: Character, closing: Character) -> String? {
        guard let start = raw.firstIndex(of: opening),
              let end = raw[start...].firstIndex(of: closing), start < end else { return nil }
        let value = raw[raw.index(after: start)..<end]
        return value.isEmpty ? nil : String(value)
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

public struct CTYCorrectionPreview: Codable, Sendable {
    public struct Row: Codable, Sendable {
        public let id: UUID
        public let call: String
        public let start: Date
        public let previousADIF: Int?
        public let previousCountry: String?
        public let currentADIF: Int?
        public let currentCountry: String?
    }
    public var rows: [Row]
    public var affectedCount: Int
    public var protectedOverrideCount: Int
    public var limit: Int
    public var offset: Int
}

private final class ClubLogXMLParser: NSObject, XMLParserDelegate {
    fileprivate var rules: [CTYResolver.Rule] = []
    private var kind = ""
    private var currentElement = ""
    private var buffer = ""
    private var values: [String: String] = [:]

    func parse(url: URL) throws {
        guard let parser = XMLParser(contentsOf: url) else { throw CocoaError(.fileReadCorruptFile) }
        parser.delegate = self
        guard parser.parse() else { throw parser.parserError ?? CocoaError(.fileReadCorruptFile) }
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        currentElement = elementName.lowercased()
        buffer = ""
        if currentElement == "prefix" || currentElement == "exception" {
            kind = currentElement
            values = [:]
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { buffer += string }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let name = elementName.lowercased()
        let value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        if !kind.isEmpty, !value.isEmpty { values[name] = value }
        guard name == kind else { currentElement = ""; buffer = ""; return }
        defer { kind = ""; values = [:]; currentElement = ""; buffer = "" }
        guard let rawCall = values["call"] ?? values["prefix"],
              let adif = Int(values["adif"] ?? ""),
              let cq = Int(values["cqz"] ?? "0") else { return }
        let token = rawCall.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        let info = CountryInfo(
            name: (values["entity"] ?? values["name"] ?? "Unknown").uppercased(),
            adif: adif,
            continent: (values["cont"] ?? "").uppercased(),
            cqZone: cq,
            ituZone: Int(values["ituz"] ?? "0") ?? 0,
            latitude: Double(values["lat"] ?? ""),
            longitude: Double(values["long"] ?? "")
        )
        rules.append(CTYResolver.Rule(
            token: token,
            endpointToken: token,
            primaryPrefix: token,
            exact: name == "exception",
            country: info,
            endpointCountry: info,
            start: Self.date(values["start"]),
            end: Self.date(values["end"])
        ))
    }

    private static func date(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let formats = ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd", "yyyyMMdd"]
        for format in formats {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = format
            if let result = formatter.date(from: value) { return result }
        }
        return nil
    }
}
