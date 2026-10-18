import Foundation

private let sacBands: Set<String> = ["80m", "40m", "20m", "15m", "10m"]
private let sacContinents: Set<String> = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]
private let sacSerialScopes: [ContestSerialScope] = [.session, .band, .transmitter]
private let sacScandinavianPrefixes: Set<String> = [
    "JW", "JX", "LA", "LB", "LC", "LG", "LI", "LJ", "LN", "OF", "OG", "OH", "OI",
    "OFØ", "OGØ", "OHØ", "OJØ", "OH0", "OJ0", "OX", "XP", "OW", "OY", "5P", "5Q", "OU", "OV", "OZ",
    "7S", "8S", "SA", "SB", "SC", "SD", "SE", "SF", "SG", "SH", "SI", "SJ", "SK", "SL",
    "SM", "TF",
]
private let sac2026IneligibleStationEntities: Set<Int> = [15, 27, 54, 126]
private let sacCanonicalPrefixAliases: [String: Set<String>] = [
    "JW": ["JW"], "JX": ["JX"],
    "LA": ["LA", "LB", "LC", "LG", "LI", "LJ", "LN"],
    "OH": ["OF", "OG", "OH", "OI"], "OH0": ["OF0", "OG0", "OH0"], "OJ0": ["OJ0"],
    "OX": ["OX", "XP"], "OY": ["OW", "OY"],
    "OZ": ["5P", "5Q", "OU", "OV", "OZ"],
    "SM": ["7S", "8S", "SA", "SB", "SC", "SD", "SE", "SF", "SG", "SH", "SI", "SJ", "SK", "SL", "SM"],
    "TF": ["TF"],
]

private let sacCWEntry = ContestEntryDescriptor(
    mode: "CW", adifMode: "CW", cabrilloQSOType: "CW",
    cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2",
    report: .init(format: .cwRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3),
    exchange: .init(sent: .serialNumber, received: .serialNumber,
                    sentDefault: .reservedSerial, adifFields: .exchangeStrings),
    serial: .init(requirement: .requiredForCommit, allowedScopes: sacSerialScopes)
)

private let sacSSBEntry = ContestEntryDescriptor(
    mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH",
    cabrilloFormatterVersion: "ssb-pilot-1", cabrilloProjectionFormatterVersion: "ssb-pilot-2",
    report: .init(format: .phoneRS, defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2),
    exchange: .init(sent: .serialNumber, received: .serialNumber,
                    sentDefault: .reservedSerial, adifFields: .exchangeStrings),
    serial: .init(requirement: .requiredForCommit, allowedScopes: sacSerialScopes)
)

public struct SACCWRule: ContestOperatorCapableRule {
    public static let identity = ContestRuleIdentity(
        id: "sac-cw", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview",
        sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f"
    )
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "Scandinavian Activity Contest CW", cabrilloName: "SAC-CW",
        supportedBands: sacBands, supportedModes: ["CW"], entry: sacCWEntry,
        sourceProvenance: "SAC 2026 rules https://www.sactest.net/blog/scandinavian-activity-contest-2026-rules/ verified 2026-10-18; oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/sac_cw.py + not1mm/lib/database.py + not1mm/lib/ham_utility.py"
    )

    public init() {}
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateSAC(qso, in: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        qso.exchange.normalizedReceived
    }
}

public struct SACSSBRule: ContestOperatorCapableRule {
    public static let identity = ContestRuleIdentity(
        id: "sac-ssb", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview",
        sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f"
    )
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "Scandinavian Activity Contest SSB", cabrilloName: "SAC-SSB",
        supportedBands: sacBands, supportedModes: ["SSB"], entry: sacSSBEntry,
        sourceProvenance: "SAC 2026 rules https://www.sactest.net/blog/scandinavian-activity-contest-2026-rules/ verified 2026-10-18; oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/sac_ssb.py + not1mm/lib/database.py + not1mm/lib/ham_utility.py"
    )

    public init() {}
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateSAC(qso, in: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        qso.exchange.normalizedReceived
    }
}

private func evaluateSAC(_ qso: ContestQSO, in session: ContestSessionSnapshot,
                         metadata: ContestRuleMetadata) -> ContestRuleEvaluation {
    var issues = sacValidation(qso, session: session, metadata: metadata)
    if Int(qso.exchange.normalizedSent).map({ $0 > 0 }) != true {
        issues.append(.init(code: "invalidSentSerial", field: "exchange.sent",
                            message: "Sent serial must be a positive integer."))
    }
    if Int(qso.exchange.normalizedReceived).map({ $0 > 0 }) != true {
        issues.append(.init(code: "invalidReceivedSerial", field: "exchange.received",
                            message: "Received serial must be a positive integer."))
    }
    let dupeKey = sacDupeKey(qso)
    guard let own = session.station.entity, let worked = qso.entity else {
        return .init(validation: issues, dupeKey: dupeKey, points: 0, multiplierCandidates: [])
    }

    let ownIsScandinavian = sacScandinavianPrefixes.contains(own.countryPrefix)
    let workedIsScandinavian = sacScandinavianPrefixes.contains(worked.countryPrefix)
    let callArea = !ownIsScandinavian && workedIsScandinavian ?
        sacCallArea(qso.callsign, workedEntity: worked) : nil
    if !ownIsScandinavian && workedIsScandinavian && callArea == nil {
        issues.append(.init(code: "invalidScandinavianCallArea", field: "callsign",
                            message: "A Scandinavian prefix-number could not be derived from the worked callsign."))
    }
    guard !issues.contains(where: { $0.severity == .error }) else {
        return .init(validation: issues, dupeKey: dupeKey, points: 0, multiplierCandidates: [])
    }
    let points: Int64
    if ownIsScandinavian && !workedIsScandinavian {
        points = worked.continent == "EU" ? 2 : 3
    } else if !ownIsScandinavian && workedIsScandinavian {
        if own.continent == "EU" {
            points = 1
        } else {
            points = ["80m", "40m"].contains(qso.band) ? 3 : 1
        }
    } else {
        points = 0
    }

    let multipliers: Set<ContestMultiplierKey>
    if ownIsScandinavian {
        multipliers = [.init(kind: "country-prefix", value: worked.countryPrefix, scope: qso.band)]
    } else if workedIsScandinavian, let callArea {
        multipliers = [.init(kind: "scandinavian-call-area",
                             value: "\(worked.countryPrefix):\(callArea)", scope: qso.band)]
    } else {
        multipliers = []
    }
    return .init(validation: issues, dupeKey: dupeKey, points: points, multiplierCandidates: multipliers)
}

private func sacValidation(_ qso: ContestQSO, session: ContestSessionSnapshot,
                           metadata: ContestRuleMetadata) -> [ContestValidationIssue] {
    var issues: [ContestValidationIssue] = []
    if !metadata.entry.isCoherent(supportedModes: metadata.supportedModes) {
        issues.append(.init(code: "invalidRuleEntryDescriptor", field: "rule",
                            message: "Contest entry metadata is inconsistent."))
    }
    if qso.callsign.isEmpty ||
        qso.callsign.range(of: #"^[A-Z0-9]+(?:/[A-Z0-9]+)*$"#, options: .regularExpression) == nil ||
        !qso.callsign.contains(where: \.isLetter) || !qso.callsign.contains(where: \.isNumber) {
        issues.append(.init(code: "invalidCallsign", field: "callsign", message: "A valid callsign is required."))
    }
    if !metadata.supportedBands.contains(qso.band) {
        issues.append(.init(code: "unsupportedBand", field: "band", message: "The band is not supported by this rule."))
    }
    if !metadata.supportedModes.contains(qso.mode) {
        issues.append(.init(code: "unsupportedMode", field: "mode", message: "The mode is not supported by this rule."))
    }
    if qso.frequencyHz <= 0 {
        issues.append(.init(code: "invalidFrequency", field: "frequencyHz", message: "A positive frequency is required."))
    } else if sacBand(for: qso.frequencyHz, mode: metadata.entry.mode) != qso.band {
        issues.append(.init(code: "frequencyBandMismatch", field: "frequencyHz",
                            message: "Frequency does not match the recorded contest band."))
    }
    if !metadata.entry.report.accepts(qso.rstSent) {
        issues.append(.init(code: "invalidRSTSent", field: "rstSent", message: "Sent report does not match the contest mode."))
    }
    if !metadata.entry.report.accepts(qso.rstReceived) {
        issues.append(.init(code: "invalidRSTReceived", field: "rstReceived",
                            message: "Received report does not match the contest mode."))
    }
    if let entity = qso.entity, !validSACEntity(entity) {
        issues.append(.init(code: "invalidEntity", field: "entity",
                            message: "Resolved contest geography is incomplete or invalid."))
    } else if qso.entity == nil {
        issues.append(.init(code: "unknownEntity", field: "entity", message: "Contest geography could not be resolved."))
    }
    if let entity = session.station.entity, !validSACEntity(entity) {
        issues.append(.init(code: "invalidStationEntity", field: "station.entity",
                            message: "Station contest geography is incomplete or invalid."))
    } else if session.station.entity == nil {
        issues.append(.init(code: "unknownStationEntity", field: "station.entity",
                            message: "Station contest geography could not be resolved."))
    }
    if let entity = session.station.entity, sac2026IneligibleStationEntities.contains(entity.adif) {
        issues.append(.init(code: "ineligible2026StationEntity", field: "station.entity",
                            message: "The station entity is not eligible to enter SAC 2026."))
    }
    return issues
}

private func validSACEntity(_ entity: ContestEntitySnapshot) -> Bool {
    entity.adif > 0 && !entity.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !entity.countryPrefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        sacContinents.contains(entity.continent) && (1...40).contains(entity.cqZone)
}

private func sacDupeKey(_ qso: ContestQSO) -> String? {
    guard !qso.callsign.isEmpty, !qso.band.isEmpty else { return nil }
    return "\(qso.callsign.uppercased())|\(qso.band.lowercased())"
}

private func sacCallArea(_ callsign: String, workedEntity: ContestEntitySnapshot) -> Character? {
    guard sacCanonicalPrefixAliases[workedEntity.countryPrefix] != nil else { return nil }
    let components = callsign.uppercased().split(separator: "/").map(String.init)
    let consistent = components.filter { sacCanonicalEntity(for: $0) == workedEntity.countryPrefix }
    guard consistent.count == 1, let scandinavianComponent = consistent.first else { return nil }
    let prefix = sacWPXPrefix(scandinavianComponent)
    guard prefix.count >= 3 else { return nil }
    let area = prefix[prefix.index(prefix.startIndex, offsetBy: 2)]
    guard area.unicodeScalars.count == 1, let value = area.unicodeScalars.first?.value,
          (48...57).contains(value) else { return nil }
    return area
}

private func sacCanonicalEntity(for component: String) -> String? {
    var matches: [(canonical: String, length: Int)] = []
    for (canonical, aliases) in sacCanonicalPrefixAliases {
        for alias in aliases where component.hasPrefix(alias) {
            matches.append((canonical, alias.count))
        }
    }
    guard let longest = matches.map(\.length).max() else { return nil }
    let canonicals = Set(matches.filter { $0.length == longest }.map(\.canonical))
    guard canonicals.count == 1 else { return nil }
    return canonicals.first
}

private func sacWPXPrefix(_ rawCallsign: String) -> String {
    var call = rawCallsign.uppercased()
    guard !call.isEmpty, !["OPON", "CW", "SSB", "RTTY"].contains(call) else { return "" }
    let ignored = ["M", "MM", "P", "QRP", "A", "J", "LH", "LGT", "LS", "NLD", "T", "R", "TR"]
    for suffix in ignored where call.hasSuffix("/\(suffix)") { call.removeLast(suffix.count + 1) }
    let parts = call.split(separator: "/").map(String.init)
    var portable: String?
    if parts.count > 1, let shortest = parts.min(by: { $0.count < $1.count }) {
        portable = shortest
        if !shortest.allSatisfy(\.isNumber) {
            return shortest.contains(where: \.isNumber) ? shortest : shortest + "0"
        }
    }
    guard let main = parts.max(by: { $0.count < $1.count }) else { return "" }
    let digits = main.indices.filter { main[$0].isNumber && $0 != main.startIndex }
    guard let digitIndex = digits.last else { return String(main.prefix(2)) + "0" }
    let prefix = String(main[...digitIndex])
    guard let portable else { return prefix }
    return String(prefix.dropLast()) + portable
}

private func sacBand(for frequencyHz: Int64, mode: String) -> String? {
    switch (mode, frequencyHz) {
    case ("CW", 3_510_000...3_560_000), ("SSB", 3_600_000...3_650_000),
         ("SSB", 3_700_000...3_800_000): return "80m"
    case ("CW", 7_000_000...7_040_000), ("SSB", 7_060_000...7_100_000),
         ("SSB", 7_130_000...7_200_000): return "40m"
    case ("CW", 14_000_000...14_060_000), ("SSB", 14_125_000...14_300_000): return "20m"
    case ("CW", 21_000_000...21_070_000), ("SSB", 21_151_000...21_450_000): return "15m"
    case ("CW", 28_000_000...28_070_000), ("SSB", 28_320_000...29_000_000): return "10m"
    default: return nil
    }
}
