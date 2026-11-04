import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if canImport(FoundationXML)
import FoundationXML
#endif

public final class CTYResolver: @unchecked Sendable {
    /// Neutral inference, deliberately separate from retained QSO fields and
    /// programme-specific award/contest eligibility. Coordinates are entity
    /// approximations, never a portable station's operating position.
    public struct Facts: Codable, Equatable, Sendable {
        public enum Status: String, Codable, Sendable { case resolved, knownNoEntity, ambiguous, unknown, invalid, missingDate }
        public let literalCall: String
        public let normalizedCall: String
        public let operatorCall: String?
        public let qualifier: String?
        public let observedAt: Date?
        public let status: Status
        public let country: CountryInfo?
        public let operatingPrefix: String?
        public let matchedRule: String?
        public let matchedDescription: String?
        public let matchedReferenceRevision: String?
        public let validFrom: Date?
        public let validUntil: Date?
        public let referenceRevision: String
        public let policy: String
        public let locationPrecision: String
    }
    public static let factsPolicy = "xlog-country-facts-v2"
    public let contentDigest: String
    private var primarySnapshotIdentity: String {
        let catalogue = countryPack != nil ? ":entity-catalogue:\(Self.entityCatalogueDigest)" : ""
        return "\(Self.factsPolicy):\(contentDigest)\(catalogue)"
    }
    public var snapshotIdentity: String {
        guard let neutralFallback else { return primarySnapshotIdentity }
        return "\(primarySnapshotIdentity):fallback:\(Self.digest(Data(neutralFallback.snapshotIdentity.utf8)))"
    }
    public var primaryReferenceRevision: String { primarySnapshotIdentity }
    public var fallbackReferenceRevision: String? { neutralFallback?.snapshotIdentity }
    // Country/area/exact source descriptions are not interchangeable with an
    // entity name. Reuse the bundled CTY entity catalogue's established labels;
    // retain the original matched description separately in source evidence.
    private static let entityCatalogue: CTYResolver? = try? bundled()
    private static var entityCatalogueDigest: String { entityCatalogue?.contentDigest ?? "unavailable" }
    private static let entityNames: [Int: String] = {
        var names: [Int: String] = [:]
        // Use the same winning rules as entities, without sorting display names
        // just to rebuild a dictionary keyed by ADIF identity.
        for rule in entityCatalogue?.rules ?? [] where rule.country.latitude != nil && rule.country.longitude != nil {
            names[rule.country.adif] = names[rule.country.adif] ?? rule.country.name
        }
        return names
    }()
    private static func entityNamedCountry(_ country: CountryInfo) -> CountryInfo {
        CountryInfo(name: entityNames[country.adif] ?? country.name, adif: country.adif,
            continent: country.continent, cqZone: country.cqZone, ituZone: country.ituZone,
            latitude: country.latitude, longitude: country.longitude)
    }
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
    private let ignoredSuffixes: Set<String> = ["P", "M", "MM", "AM", "QRP", "QRPP", "A", "B", "QTH", "LH"]
    private let endpointIndex: [Character: [Rule]]
    public let countryPack: CountryReferencePack?
    private let packedRules: [CountryReferencePack.CompiledRule]
    private let packedExactIndex: [String: [CountryReferencePack.CompiledRule]]
    private let packedIndex: [String: [CountryReferencePack.CompiledRule]]
    private let packedWildcards: [CountryReferencePack.CompiledRule]
    private let neutralFallback: CTYResolver?

    public init(csvURL: URL) throws {
        neutralFallback = nil
        countryPack = nil; packedRules = []; packedExactIndex = [:]; packedIndex = [:]; packedWildcards = []
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
                let endpointToken = Self.cleanEndpointToken(legacyToken)
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
        endpointIndex = Dictionary(grouping: endpointRules, by: { $0.endpointToken.first! })
        contentDigest = Self.digest(Data(text.utf8))
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
        if let neutralFallback {
            return Array(Set(primaryOnly().reachableCountryEndpoints(at: date) + neutralFallback.reachableCountryEndpoints(at: date)))
                .sorted { ($0.adif, $0.name) < ($1.adif, $1.name) }
        }
        if countryPack != nil {
            return Array(Set(packedRules.filter { ($0.start == nil || date >= $0.start!) && ($0.end == nil || date <= $0.end!) }
                .map { Self.entityNamedCountry($0.record.country) })).sorted { ($0.adif, $0.name) < ($1.adif, $1.name) }
        }
        return Array(Set(endpointRules.compactMap { rule in
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
        self.init(rules: parser.rules, content: try Data(contentsOf: xmlURL))
    }

    private init(rules: [Rule], content: Data) {
        neutralFallback = nil
        countryPack = nil; packedRules = []; packedExactIndex = [:]; packedIndex = [:]; packedWildcards = []
        self.rules = Self.sortedRules(rules, by: \.token)
        endpointRules = Self.sortedRules(rules, by: \.endpointToken)
        endpointIndex = Dictionary(grouping: endpointRules, by: { $0.endpointToken.first! })
        contentDigest = Self.digest(content)
    }

    /// Bundle, imported bytes and downloaded bytes use this exact validator.
    public convenience init(countryPack data: Data) throws {
        try self.init(countryPack: data, constructionObserver: nil)
    }

    public init(countryPack data: Data, constructionObserver: (@Sendable (String) -> Void)?) throws {
        neutralFallback = nil
        constructionObserver?("packDecodeStarted")
        let (pack, compiled) = try CountryReferencePack.decodeAndCompile(data, constructionObserver: constructionObserver)
        countryPack = pack; packedRules = compiled
        // Literal exact exceptions need only their full-call bucket. Keeping
        // thousands of unrelated exceptions in every first-letter scan made
        // ordinary lookups and complete-log reviews repeat regex work.
        packedExactIndex = Dictionary(grouping: compiled.filter { $0.record.exact && $0.literalPattern != nil }, by: { $0.record.pattern })
        let patterns = compiled.filter { !$0.record.exact || $0.literalPattern == nil }
        packedIndex = Dictionary(grouping: patterns.filter { !$0.leadingLiteral.isEmpty }, by: { $0.leadingLiteral })
        packedWildcards = patterns.filter { $0.leadingLiteral.isEmpty }
        constructionObserver?("packIndicesBuilt")
        rules = []; endpointRules = []; endpointIndex = [:]
        constructionObserver?("packDigestStarted")
        contentDigest = Self.digest(data)
        constructionObserver?("packDigestReturned")
    }

    /// A downloaded XML source can intentionally cover only some prefixes.
    /// Neutral consumers share this immutable primary/fallback snapshot; legacy
    /// resolve APIs continue exposing the primary source's original coverage.
    public func fillingUnknownFacts(with fallback: CTYResolver) -> CTYResolver {
        precondition(countryPack == nil, "A complete normalized pack has no implicit fallback")
        return CTYResolver(primary: self, fallback: fallback)
    }

    private init(primary: CTYResolver, fallback: CTYResolver?) {
        rules = primary.rules; endpointRules = primary.endpointRules; endpointIndex = primary.endpointIndex
        countryPack = primary.countryPack; packedRules = primary.packedRules
        packedExactIndex = primary.packedExactIndex
        packedIndex = primary.packedIndex; packedWildcards = primary.packedWildcards
        contentDigest = primary.contentDigest; neutralFallback = fallback
    }

    private func primaryOnly() -> CTYResolver { CTYResolver(primary: self, fallback: nil) }

    public static func bundledCountryPack() throws -> CTYResolver {
        try bundledCountryPack(constructionObserver: nil)
    }

    public static func bundledCountryPack(constructionObserver: (@Sendable (String) -> Void)?) throws -> CTYResolver {
        let bytes = try bundledCountryPackBytes()
        constructionObserver?("packBytesRead")
        return try CTYResolver(countryPack: bytes, constructionObserver: constructionObserver)
    }

    public static func bundledCountryPackBytes() throws -> Data {
        guard let url = Bundle.module.url(forResource: "country-reference-pack", withExtension: "json") else { throw CocoaError(.fileNoSuchFile) }
        return try Data(contentsOf: url)
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Missing dates and malformed slash forms fail explicitly. This endpoint
    /// never substitutes today's date or strips invalid input into another call.
    /// The legacy resolve APIs retain their historical home-entity semantics.
    public func facts(_ literal: String, at date: Date?) -> Facts {
        let primary = primaryFacts(literal, at: date)
        guard primary.status == .unknown, let neutralFallback else { return primary }
        let fallback = neutralFallback.facts(literal, at: date)
        return Facts(literalCall: fallback.literalCall, normalizedCall: fallback.normalizedCall,
            operatorCall: fallback.operatorCall, qualifier: fallback.qualifier, observedAt: fallback.observedAt,
            status: fallback.status, country: fallback.country, operatingPrefix: fallback.operatingPrefix,
            matchedRule: fallback.matchedRule, matchedDescription: fallback.matchedDescription,
            matchedReferenceRevision: fallback.matchedReferenceRevision,
            validFrom: fallback.validFrom, validUntil: fallback.validUntil,
            referenceRevision: snapshotIdentity, policy: Self.factsPolicy, locationPrecision: fallback.locationPrecision)
    }

    private func primaryFacts(_ literal: String, at date: Date?) -> Facts {
        let call = literal.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let parts = call.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let modifiers = ignoredSuffixes.union(countryPack?.ignoredModifiers ?? [])
        let qualifier = parts.count > 1 ? parts.last.flatMap { modifiers.contains($0) ? $0 : nil } : nil
        let operatorCandidates = parts.filter { $0.range(of: #"^[A-Z0-9]*[0-9][A-Z][A-Z0-9]*$"#, options: .regularExpression) != nil }
        let operatorCall = operatorCandidates.count == 1 ? operatorCandidates[0] : nil
        func result(_ status: Facts.Status, _ rule: Rule? = nil) -> Facts {
            Facts(literalCall: literal, normalizedCall: call, operatorCall: operatorCall, qualifier: qualifier,
                observedAt: date.flatMap { $0.timeIntervalSince1970.isFinite ? $0 : nil }, status: status, country: status == .resolved ? rule?.endpointCountry : nil,
                operatingPrefix: rule?.primaryPrefix, matchedRule: rule?.endpointToken, matchedDescription: rule?.country.name,
                matchedReferenceRevision: rule == nil ? nil : primarySnapshotIdentity,
                validFrom: rule?.start, validUntil: rule?.end, referenceRevision: snapshotIdentity,
                policy: Self.factsPolicy, locationPrecision: status == .resolved ? "entityApproximation" : "unavailable")
        }
        guard (3...32).contains(call.utf8.count), (1...4).contains(parts.count),
              parts.allSatisfy({ !$0.isEmpty }), !operatorCandidates.isEmpty,
              literal.trimmingCharacters(in: .whitespacesAndNewlines).allSatisfy(\.isASCII),
              call.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "/") }) else { return result(.invalid) }
        guard let date, date.timeIntervalSince1970.isFinite else { return result(.missingDate) }
        if countryPack != nil { return packedFacts(literal, call: call, parts: parts, operatorCall: operatorCall, qualifier: qualifier, at: date) }
        func matches(_ candidate: String, exactOnly: Bool = false) -> [Rule] {
            guard let first = candidate.first else { return [] }
            return (endpointIndex[first] ?? []).filter { rule in
                guard Self.isActive(rule, at: date), !exactOnly || rule.exact,
                      rule.exact ? candidate == rule.endpointToken : candidate.hasPrefix(rule.endpointToken) else { return false }
                return !(rule.endpointToken == "KG4" && candidate.range(of: #"^KG4[A-Z]{3}$"#, options: .regularExpression) != nil
                    && rule.country.name.contains("GUANTANAMO"))
            }
        }
        func select(_ candidates: [Rule]) -> Facts? {
            guard let first = candidates.first else { return nil }
            let peers = candidates.filter { $0.endpointToken.count == first.endpointToken.count && $0.exact == first.exact
                && ($0.endpointCountry != $0.country) == (first.endpointCountry != first.country) }
            guard Set(peers.map(\.endpointCountry)).count == 1 else { return result(.ambiguous) }
            return result(first.endpointCountry.adif == 0 ? .knownNoEntity : .resolved, first)
        }
        // Date-valid complete-call exceptions precede all generic modifiers.
        if let exact = select(matches(call, exactOnly: true)) { return exact }
        if operatorCall == nil { return result(.ambiguous) }
        if parts.count == 1, call.last?.isNumber == true { return result(.unknown) }
        if qualifier == "MM" || qualifier == "AM" { return result(.knownNoEntity) }
        // A numeric area suffix is not an arbitrary geographic prefix. Until
        // a supplied dataset defines that area's semantics, retain uncertainty.
        if parts.count > 1, parts.last?.allSatisfy(\.isNumber) == true { return result(.unknown) }
        let candidates = parts.enumerated().compactMap { index, part -> String? in
            (index == 0 || !ignoredSuffixes.contains(part)) && part.contains(where: \.isLetter) ? part : nil
        }.sorted { $0.count == $1.count ? $0 < $1 : $0.count < $1.count }
        let operating = candidates.filter { $0 != operatorCall }
        if operating.count > 1 { return result(.ambiguous) }
        if let prefix = operating.first { return select(matches(prefix)) ?? result(.unknown) }
        for candidate in candidates { if let value = select(matches(candidate)) { return value } }
        return result(.unknown)
    }

    public func resolve(_ rawCallsign: String, at date: Date = Date()) -> CountryInfo? {
        if countryPack != nil {
            // Deliberate compatibility adapter for pre-C01 callers that used the
            // home entity for /MM and /AM. New consumers must use neutral facts.
            let parts = rawCallsign.uppercased().split(separator: "/").map(String.init)
            let call = ["MM", "AM"].contains(parts.last ?? "") ? parts.dropLast().joined(separator: "/") : rawCallsign
            return facts(call, at: date).country
        }
        return matchingRule(rawCallsign, at: date, rules: rules, token: \.token)?.country
    }

    /// Opt-in resolver endpoint including CTY token-level CQ-zone, ITU-zone, and continent
    /// overrides. The legacy `resolve` result remains unchanged for persisted callers.
    public func resolveCountryEndpoint(_ rawCallsign: String, at date: Date = Date()) -> CountryInfo? {
        if countryPack != nil { return facts(rawCallsign, at: date).country }
        return matchingRule(rawCallsign, at: date, rules: endpointRules, token: \.endpointToken)?.endpointCountry
    }

    /// Resolves the country endpoint together with the primary prefix from the
    /// matched CTY row. The prefix must not be inferred from ADIF alone because
    /// named CQ WW entities can share an ADIF number with an ordinary country.
    public func resolveCountryEndpointWithPrimaryPrefix(
        _ rawCallsign: String, at date: Date = Date()
    ) -> (country: CountryInfo, primaryPrefix: String)? {
        if countryPack != nil {
            let value = facts(rawCallsign, at: date)
            guard let country = value.country, let prefix = value.operatingPrefix else { return nil }
            return (country, prefix)
        }
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
        let components = call.split(separator: "/").map(String.init).enumerated().compactMap { index, part in
            // MM/LY3X/P operates in Scotland; LY3X/MM has a maritime-mobile
            // suffix. A leading operating prefix must survive suffix filtering.
            guard (index == 0 || !ignoredSuffixes.contains(part)),
                  part.contains(where: { $0.isLetter }) else { return nil as String? }
            return part
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
        let previous = countryPack?.records.first(where: { $0.country.adif == 305 })?.country
            ?? rules.first(where: { $0.country.adif == 305 })?.country
        return (previous, resolve(rawCallsign, at: date))
    }

    public var entities: [CountryInfo] {
        if let neutralFallback {
            return Array(Set(primaryOnly().entities + neutralFallback.entities)).sorted { $0.name < $1.name }
        }
        if let countryPack { return Array(Set(countryPack.records.map { Self.entityNamedCountry($0.country) })).sorted { $0.name < $1.name } }
        var unique: [Int: CountryInfo] = [:]
        for rule in rules where rule.country.latitude != nil && rule.country.longitude != nil {
            unique[rule.country.adif] = unique[rule.country.adif] ?? rule.country
        }
        return unique.values.sorted { lhs, rhs in lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending }
    }

    private func packedFacts(_ literal: String, call: String, parts: [String], operatorCall: String?,
                             qualifier: String?, at date: Date) -> Facts {
        guard let pack = countryPack else { preconditionFailure() }
        func output(_ status: Facts.Status, _ match: CountryReferencePack.CompiledRule? = nil) -> Facts {
            Facts(literalCall: literal, normalizedCall: call, operatorCall: operatorCall, qualifier: qualifier,
                observedAt: date, status: status, country: status == .resolved ? match.map { Self.entityNamedCountry($0.record.country) } : nil,
                operatingPrefix: match?.record.pattern, matchedRule: match.map { "\($0.record.component):\($0.record.line):\($0.record.pattern)" },
                matchedDescription: match?.record.country.name,
                matchedReferenceRevision: match == nil ? nil : primarySnapshotIdentity,
                validFrom: match?.start, validUntil: match?.end, referenceRevision: snapshotIdentity,
                policy: Self.factsPolicy, locationPrecision: status == .resolved ? "entityApproximation" : "unavailable")
        }
        func choose(_ key: String, exact: Bool = false) -> Facts? {
            guard !key.isEmpty else { return nil }
            var indexed = packedExactIndex[key] ?? []
            var prefix = ""
            for character in key {
                prefix.append(character)
                if let rules = packedIndex[prefix] { indexed.append(contentsOf: rules) }
            }
            indexed.append(contentsOf: packedWildcards)
            let candidates = indexed.filter { rule in
                (!exact || rule.record.exact) && (rule.start == nil || date >= rule.start!)
                    && (rule.end == nil || date <= rule.end!) && rule.matches(key)
            }.sorted(by: CountryReferencePack.CompiledRule.precedes)
            guard let best = candidates.first else {
                // An absent exact exception is not a geographic decision.
                // Qualifiers and finer area rules still need their normal turn.
                return !exact && pack.ambiguousPrefixes.contains(where: { key.hasPrefix($0) }) ? output(.ambiguous) : nil
            }
            let peers = candidates.prefix { $0.rank == best.rank }
            guard Set(peers.map { $0.record.country }).count == 1 else { return output(.ambiguous) }
            if best.record.country.adif == 0 { return output(.knownNoEntity, best) }
            // An explicitly ambiguous prefix needs a finer rule. Exact dated
            // exceptions remain usable without guessing from the broad prefix.
            if !best.record.exact, pack.ambiguousPrefixes.contains(where: {
                key.hasPrefix($0) && best.positions <= $0.count
            }) { return output(.ambiguous, best) }
            return output(.resolved, best)
        }
        if let exact = choose(call, exact: true) { return exact }
        if operatorCall == nil { return output(.ambiguous) }
        if parts.count == 1, call.last?.isNumber == true { return output(.unknown) }
        if qualifier == "MM" || qualifier == "AM" { return output(.knownNoEntity) }
        // Dataset-supported country-specific interpretation precedes generic
        // suffix handling. These describe rule semantics, not a live location.
        if parts.count == 2, let suffix = parts.last, suffix.count == 1 {
            let base = parts[0]
            if suffix.allSatisfy(\.isNumber),
               base.range(of: #"^(A[A-L]|K|N|W)[A-Z0-9]*[0-9][A-Z]+$"#, options: .regularExpression) != nil {
                return choose("W" + suffix) ?? output(.unknown)
            }
            if suffix.allSatisfy(\.isLetter),
               base.range(of: #"^(L[O-W]|AY|AZ)[0-9][A-Z]{2,}$"#, options: .regularExpression) != nil {
                var characters = Array(base); characters[3] = suffix.first!
                return choose(String(characters)) ?? output(.unknown)
            }
            if suffix.allSatisfy(\.isNumber) { return output(.unknown) }
        }
        let modifiers = ignoredSuffixes.union(pack.ignoredModifiers)
        let candidates = parts.enumerated().compactMap { index, part -> String? in
            (index == 0 || !modifiers.contains(part)) && part.contains(where: \.isLetter) ? part : nil
        }.sorted { $0.count == $1.count ? $0 < $1 : $0.count < $1.count }
        let operating = candidates.filter { $0 != operatorCall }
        if operating.count > 1 { return output(.ambiguous) }
        if let prefix = operating.first { return choose(prefix) ?? output(.unknown) }
        for candidate in candidates { if let value = choose(candidate) { return value } }
        return output(.unknown)
    }

    private static let legacyAnnotations = try! NSRegularExpression(pattern: #"\([^)]*\)|\[[^]]*\]|<[^>]*>"#)
    private static let endpointAnnotations = try! NSRegularExpression(pattern: #"\{[^}]*\}"#)
    private static func cleanLegacyToken(_ raw: String) -> String {
        var token = raw.uppercased().trimmingCharacters(in: CharacterSet(charactersIn: "*=;"))
        token = legacyAnnotations.stringByReplacingMatches(in: token, range: NSRange(token.startIndex..., in: token), withTemplate: "")
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func cleanEndpointToken(_ legacyToken: String) -> String {
        endpointAnnotations.stringByReplacingMatches(in: legacyToken, range: NSRange(legacyToken.startIndex..., in: legacyToken), withTemplate: "")
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

/// A deliberately scoped, reproducible derivative of the six OK1RR country
/// components. Unsupported upstream rows are enumerated in `excluded`; this
/// format does not claim CQRLOG's historical collation/truncation quirks.
public struct CountryReferenceSelection: Codable, Sendable {
    public enum Source: String, Codable, Sendable { case normalizedPack, clubLogXML }
    public let version: Int
    public let source: Source
    public let sourceVersion: String?
    public init(source: Source, sourceVersion: String? = nil) { version = 1; self.source = source; self.sourceVersion = sourceVersion }
    public static let fileName = "country-reference-selection.json"
    public static let previousFileName = "country-reference-previous-source.json"
    public static func read(directory: URL, previous: Bool = false) throws -> Self? {
        let url = directory.appendingPathComponent(previous ? previousFileName : fileName)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) <= 4096 else { throw CocoaError(.fileReadCorruptFile) }
        let value = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
        guard value.version == 1, (value.sourceVersion?.utf8.count ?? 0) <= 256 else { throw CocoaError(.fileReadCorruptFile) }
        return value
    }
    public func save(directory: URL, previous: Bool = false) throws {
        try JSONEncoder().encode(self).write(to: directory.appendingPathComponent(previous ? Self.previousFileName : Self.fileName), options: .atomic)
    }
}

public struct CountryReferencePack: Codable, Sendable {
    private static let publicationLock = NSRecursiveLock()
    /// Serialize only publication and reviewed correction admission. This lock
    /// is never used by radio, CW or ordinary immutable lookups.
    public static func withPublicationLock<T>(_ operation: () throws -> T) rethrows -> T {
        publicationLock.lock(); defer { publicationLock.unlock() }
        return try operation()
    }
    public struct Record: Codable, Sendable {
        public let pattern: String
        public let exact: Bool
        public let deleted: Bool
        public let country: CountryInfo
        public let start: String?
        public let end: String?
        public let component: String
        public let line: Int
    }
    public struct Exclusion: Codable, Sendable {
        public let component: String
        public let line: Int
        public let pattern: String?
        public let reason: String
    }
    public let schemaVersion: Int
    public let provider: String
    public let sourceURL: String
    public let sourceRevision: String
    public let sourceVersion: String?
    public let normalizerVersion: String
    public let attribution: String
    public let conflictPolicy: String
    public let components: [String: String]
    public let coverage: [String]
    public let excluded: [Exclusion]
    public let records: [Record]
    public let ignoredModifiers: [String]
    public let ambiguousPrefixes: [String]

    public enum ValidationError: Error, LocalizedError {
        case invalid(String)
        public var errorDescription: String? { if case .invalid(let reason) = self { return "Country pack rejected: \(reason)" }; return nil }
    }
    private static let requiredComponents: Set<String> = ["Country.tab", "CallResolution.tbl", "AreaOK1RR.tbl", "CountryDel.tab", "Exceptions.tab", "Ambiguous.tbl"]
    static func date(_ raw: String?) throws -> Date? {
        guard let raw else { return nil }
        let bytes = Array(raw.utf8)
        guard bytes.count == 20, bytes[4] == 45, bytes[7] == 45, bytes[10] == 84,
              bytes[13] == 58, bytes[16] == 58, bytes[19] == 90 else { throw ValidationError.invalid("invalid UTC date") }
        func number(_ range: Range<Int>) throws -> Int {
            guard bytes[range].allSatisfy({ (48...57).contains($0) }) else { throw ValidationError.invalid("invalid UTC date") }
            return bytes[range].reduce(0) { $0 * 10 + Int($1 - 48) }
        }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = try DateComponents(year: number(0..<4), month: number(5..<7), day: number(8..<10),
            hour: number(11..<13), minute: number(14..<16), second: number(17..<19))
        guard let value = calendar.date(from: components),
              calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: value) == components else {
            throw ValidationError.invalid("invalid UTC date")
        }
        return value
    }
    public static func decode(_ data: Data) throws -> CountryReferencePack {
        try decodeAndCompile(data).0
    }

    /// Keep the validated compiled rules instead of constructing them again on
    /// the first statistics/facts read. Imports still validate the entire pack.
    fileprivate static func decodeAndCompile(_ data: Data,
        constructionObserver: (@Sendable (String) -> Void)? = nil) throws -> (CountryReferencePack, [CompiledRule]) {
        guard (100...32_000_000).contains(data.count) else { throw ValidationError.invalid("size outside bounds") }
        let value = try JSONDecoder().decode(Self.self, from: data)
        constructionObserver?("packJSONDecoded")
        guard value.schemaVersion == 1, value.normalizerVersion == "xlog-ok1rr-1", value.conflictPolicy == "reportAmbiguous",
              value.provider.utf8.count <= 256, !value.provider.isEmpty, value.attribution.utf8.count <= 4096,
              (value.sourceVersion?.utf8.count ?? 0) <= 256, value.sourceURL.utf8.count <= 2048,
              value.sourceRevision.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil,
              let url = URLComponents(string: value.sourceURL), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              Set(value.components.keys) == requiredComponents,
              value.components.values.allSatisfy({ $0.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil }),
              (100...100_000).contains(value.records.count), value.excluded.count <= 10_000,
              value.ignoredModifiers.count <= 1024, value.ambiguousPrefixes.count <= 2048,
              value.coverage.count <= 32 else { throw ValidationError.invalid("manifest, components or counts") }
        guard Set(value.records.map(\.component)) == ["Country.tab", "CallResolution.tbl", "AreaOK1RR.tbl", "CountryDel.tab"],
              Set(value.coverage) == ["current-and-deleted", "date-valid-exact", "finite-wildcard-area-patterns", "ignored-modifiers",
                "declared-ambiguous-prefixes", "us-digit-district", "argentine-letter-area"] else {
            throw ValidationError.invalid("required normalized coverage or country component is missing")
        }
        let tokens = value.ignoredModifiers + value.ambiguousPrefixes
        guard tokens.allSatisfy({ (1...32).contains($0.utf8.count) && $0.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "/") }) }) else {
            throw ValidationError.invalid("invalid modifier or ambiguity token")
        }
        for item in value.excluded {
            guard requiredComponents.contains(item.component), item.line > 0, item.reason.utf8.count <= 512,
                  (item.pattern?.utf8.count ?? 0) <= 256 else { throw ValidationError.invalid("invalid exclusion") }
        }
        var identities = Set<String>()
        var compiled: [CompiledRule] = []
        compiled.reserveCapacity(value.records.count)
        var dates: [String: Date] = [:]
        func validatedDate(_ raw: String?) throws -> Date? {
            guard let raw else { return nil }
            if let cached = dates[raw] { return cached }
            let parsed = try date(raw)!
            dates[raw] = parsed
            return parsed
        }
        for item in value.records {
            let identity = "\(item.component)|\(item.line)|\(item.pattern)|\(item.exact)|\(item.start ?? "")|\(item.end ?? "")"
            guard identities.insert(identity).inserted else { throw ValidationError.invalid("duplicate rule identity") }
            let country = item.country
            guard requiredComponents.contains(item.component), item.line > 0,
                  (0...1000).contains(country.adif), (0...40).contains(country.cqZone), (0...90).contains(country.ituZone),
                  ["AF", "AN", "AS", "EU", "NA", "OC", "SA"].contains(country.continent),
                  !country.name.isEmpty, country.name.utf8.count <= 512,
                  country.latitude.map({ $0.isFinite && (-90...90).contains($0) }) ?? true,
                  country.longitude.map({ $0.isFinite && (-180...180).contains($0) }) ?? true else { throw ValidationError.invalid("invalid country values") }
            let rule = try CompiledRule(item, start: validatedDate(item.start), end: validatedDate(item.end))
            guard rule.start == nil || rule.end == nil || rule.start! <= rule.end! else { throw ValidationError.invalid("inverted date window") }
            compiled.append(rule)
        }
        constructionObserver?("packRulesCompiled")
        return (value, compiled)
    }

    fileprivate struct CompiledRule: @unchecked Sendable {
        let record: Record
        let expression: NSRegularExpression?
        let start: Date?
        let end: Date?
        let positions: Int
        let specificity: [Int]
        let leadingLiteral: String
        let literalPattern: String?
        private var authority: Int { record.component == "CallResolution.tbl" ? 2 : record.component == "AreaOK1RR.tbl" ? 1 : 0 }
        struct Rank: Equatable { let deleted: Bool; let exact: Bool; let positions: Int; let specificity: [Int]; let authority: Int }
        var rank: Rank { Rank(deleted: record.deleted, exact: record.exact, positions: positions, specificity: specificity, authority: authority) }
        init(_ record: Record, start: Date?, end: Date?) throws {
            self.record = record; self.start = start; self.end = end
            let chars = Array(record.pattern)
            guard (1...128).contains(chars.count) else { throw ValidationError.invalid("pattern size") }
            // Most exact exceptions and many prefixes are plain ASCII. They
            // need the same validated dates/rank, but no regex compilation.
            if record.pattern.utf8.allSatisfy({ $0 >= 65 && $0 <= 90 || $0 >= 48 && $0 <= 57 || $0 == 47 }) {
                literalPattern = record.pattern; expression = nil
                positions = chars.count; specificity = Array(repeating: 3, count: chars.count)
                leadingLiteral = record.pattern
                return
            }
            literalPattern = nil
            var expression = "^", cursor = 0, scores: [Int] = []
            while cursor < chars.count {
                let ch = chars[cursor]
                if ch.isASCII && (ch.isUppercase || ch.isNumber || ch == "/") {
                    // These admitted ASCII literals are never regex metacharacters.
                    expression.append(ch); scores.append(3)
                } else if ch == "#" { expression += "[0-9]"; scores.append(2) }
                else if ch == "?" { expression += "[A-Z]"; scores.append(1) }
                else if ch == "%" { expression += "[A-Z0-9]"; scores.append(0) }
                else if ch == "[" {
                    guard let closing = chars[(cursor + 1)...].firstIndex(of: "]"), closing > cursor + 1 else { throw ValidationError.invalid("unterminated class") }
                    let body = chars[(cursor + 1)..<closing]
                    guard body.allSatisfy({ $0.isASCII && ($0.isUppercase || $0.isNumber || $0 == "-") }),
                          body.first != "-", body.last != "-" else { throw ValidationError.invalid("invalid class") }
                    expression += "[" + String(body) + "]"; scores.append(2); cursor = closing
                } else { throw ValidationError.invalid("unsupported pattern syntax") }
                cursor += 1
            }
            if record.exact { expression += "$" }
            self.expression = try NSRegularExpression(pattern: expression)
            positions = scores.count; specificity = scores
            leadingLiteral = String(chars.prefix { $0.isASCII && ($0.isUppercase || $0.isNumber || $0 == "/") })
        }
        func matches(_ key: String) -> Bool {
            if let literalPattern { return record.exact ? key == literalPattern : key.hasPrefix(literalPattern) }
            return expression?.firstMatch(in: key, range: NSRange(key.startIndex..., in: key)) != nil
        }
        static func precedes(_ lhs: Self, _ rhs: Self) -> Bool {
            if lhs.record.deleted != rhs.record.deleted { return lhs.record.deleted }
            if lhs.record.exact != rhs.record.exact { return lhs.record.exact }
            if lhs.positions != rhs.positions { return lhs.positions > rhs.positions }
            if lhs.specificity != rhs.specificity { return rhs.specificity.lexicographicallyPrecedes(lhs.specificity) }
            if lhs.authority != rhs.authority { return lhs.authority > rhs.authority }
            return (lhs.record.component, lhs.record.line) < (rhs.record.component, rhs.record.line)
        }
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
    private var invalidRecord = false

    func parse(url: URL) throws {
        guard let parser = XMLParser(contentsOf: url) else { throw CocoaError(.fileReadCorruptFile) }
        parser.delegate = self
        guard parser.parse(), !invalidRecord, !rules.isEmpty else { throw parser.parserError ?? CocoaError(.fileReadCorruptFile) }
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
              let cq = Int(values["cqz"] ?? "0"), (0...1000).contains(adif), (0...40).contains(cq),
              let itu = Int(values["ituz"] ?? "0"), (0...90).contains(itu) else { invalidRecord = true; parser.abortParsing(); return }
        let token = rawCall.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let start = Self.date(values["start"]), end = Self.date(values["end"], endOfDay: true)
        guard !token.isEmpty, token.utf8.count <= 128,
              (values["start"]?.isEmpty != false || start != nil), (values["end"]?.isEmpty != false || end != nil),
              start == nil || end == nil || start! <= end!,
              values["lat"].flatMap(Double.init).map({ $0.isFinite && (-90...90).contains($0) }) ?? (values["lat"] == nil),
              values["long"].flatMap(Double.init).map({ $0.isFinite && (-180...180).contains($0) }) ?? (values["long"] == nil) else {
            invalidRecord = true; parser.abortParsing(); return
        }
        let info = CountryInfo(
            name: (values["entity"] ?? values["name"] ?? "Unknown").uppercased(),
            adif: adif,
            continent: (values["cont"] ?? "").uppercased(),
            cqZone: cq,
            ituZone: itu,
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
            start: start,
            end: end
        ))
    }

    private static func date(_ value: String?, endOfDay: Bool = false) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let formats = ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd", "yyyyMMdd"]
        for format in formats {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = format
            if let result = formatter.date(from: value), formatter.string(from: result) == value {
                return endOfDay && format != "yyyy-MM-dd HH:mm:ss" ? result.addingTimeInterval(86_399) : result
            }
        }
        return nil
    }
}
