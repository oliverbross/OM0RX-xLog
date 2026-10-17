import Foundation

private let oceaniaBands: Set<String> = ["160m", "80m", "40m", "20m", "15m", "10m"]
private let oceaniaContinents: Set<String> = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]
private let oceaniaSerialScopes: [ContestSerialScope] = [.session, .band, .transmitter]
private let oceaniaBandPoints: [String: Int64] = [
    "160m": 20, "80m": 10, "40m": 5, "20m": 1, "15m": 2, "10m": 3,
]

private let oceaniaCWEntry = ContestEntryDescriptor(
    mode: "CW", adifMode: "CW", cabrilloQSOType: "CW",
    cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2",
    report: .init(format: .cwRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3),
    exchange: .init(sent: .serialNumber, received: .serialNumber,
                    sentDefault: .reservedSerial, adifFields: .exchangeStrings),
    serial: .init(requirement: .requiredForCommit, allowedScopes: oceaniaSerialScopes)
)

private let oceaniaSSBEntry = ContestEntryDescriptor(
    mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH",
    cabrilloFormatterVersion: "ssb-pilot-1", cabrilloProjectionFormatterVersion: "ssb-pilot-2",
    report: .init(format: .phoneRS, defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2),
    exchange: .init(sent: .serialNumber, received: .serialNumber,
                    sentDefault: .reservedSerial, adifFields: .exchangeStrings),
    serial: .init(requirement: .requiredForCommit, allowedScopes: oceaniaSerialScopes)
)

public struct OceaniaDXCWRule: ContestRule {
    public static let identity = ContestRuleIdentity(
        id: "oceania-dx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11",
        sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f"
    )
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "Oceania DX CW", cabrilloName: "OCEANIA-DX-CW",
        supportedBands: oceaniaBands, supportedModes: ["CW"], entry: oceaniaCWEntry,
        sourceProvenance: "oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/oceania_dx_cw.py + not1mm/lib/ham_utility.py; source parity only, not current sponsor approval"
    )

    public init() {}
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateOceaniaDX(qso, in: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        sourceReceivedSerial(qso.exchange.normalizedReceived)
    }
    public static func wpxPrefix(for rawCallsign: String) -> String { oceaniaWPXPrefix(rawCallsign) }
}

public struct OceaniaDXSSBRule: ContestRule {
    public static let identity = ContestRuleIdentity(
        id: "oceania-dx-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11",
        sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f"
    )
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "Oceania DX SSB", cabrilloName: "OCEANIA-DX-SSB",
        supportedBands: oceaniaBands, supportedModes: ["SSB"], entry: oceaniaSSBEntry,
        sourceProvenance: "oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/oceania_dx_ssb.py + not1mm/lib/ham_utility.py; source parity only, not current sponsor approval"
    )

    public init() {}
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateOceaniaDX(qso, in: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        sourceReceivedSerial(qso.exchange.normalizedReceived)
    }
    public static func wpxPrefix(for rawCallsign: String) -> String { oceaniaWPXPrefix(rawCallsign) }
}

private func evaluateOceaniaDX(_ qso: ContestQSO, in session: ContestSessionSnapshot,
                               metadata: ContestRuleMetadata) -> ContestRuleEvaluation {
    var issues = oceaniaValidation(qso, session: session, metadata: metadata)
    if Int(qso.exchange.normalizedSent).map({ $0 > 0 }) != true {
        issues.append(.init(code: "invalidSentSerial", field: "exchange.sent",
                            message: "Sent serial must be a positive integer."))
    }
    if Int(qso.exchange.normalizedReceived).map({ $0 > 0 }) != true {
        issues.append(.init(code: "invalidReceivedSerial", field: "exchange.received",
                            message: "Received serial must be a positive integer."))
    }
    let prefix = oceaniaWPXPrefix(qso.callsign)
    if prefix.isEmpty {
        issues.append(.init(code: "invalidWPXPrefix", field: "callsign",
                            message: "A WPX prefix could not be derived."))
    }
    let dupeKey = oceaniaDupeKey(qso)
    guard !issues.contains(where: { $0.severity == .error }),
          let own = session.station.entity, let worked = qso.entity,
          let points = oceaniaBandPoints[qso.band] else {
        return .init(validation: issues, dupeKey: dupeKey, points: 0, multiplierCandidates: [])
    }
    guard own.continent == "OC" || worked.continent == "OC" else {
        return .init(validation: issues, dupeKey: dupeKey, points: 0, multiplierCandidates: [])
    }
    return .init(validation: issues, dupeKey: dupeKey, points: points,
                 multiplierCandidates: [.init(kind: "wpx-prefix", value: prefix, scope: qso.band)])
}

private func oceaniaValidation(_ qso: ContestQSO, session: ContestSessionSnapshot,
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
    } else if oceaniaBand(for: qso.frequencyHz) != qso.band {
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
    if let entity = qso.entity, !validOceaniaEntity(entity) {
        issues.append(.init(code: "invalidEntity", field: "entity",
                            message: "Resolved contest geography is incomplete or invalid."))
    } else if qso.entity == nil {
        issues.append(.init(code: "unknownEntity", field: "entity",
                            message: "Contest geography could not be resolved."))
    }
    if let entity = session.station.entity, !validOceaniaEntity(entity) {
        issues.append(.init(code: "invalidStationEntity", field: "station.entity",
                            message: "Station contest geography is incomplete or invalid."))
    } else if session.station.entity == nil {
        issues.append(.init(code: "unknownStationEntity", field: "station.entity",
                            message: "Station contest geography could not be resolved."))
    }
    return issues
}

private func validOceaniaEntity(_ entity: ContestEntitySnapshot) -> Bool {
    entity.adif > 0 && !entity.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !entity.countryPrefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        oceaniaContinents.contains(entity.continent) && (1...40).contains(entity.cqZone)
}

private func oceaniaDupeKey(_ qso: ContestQSO) -> String? {
    guard !qso.callsign.isEmpty, !qso.band.isEmpty else { return nil }
    return "\(qso.callsign.uppercased())|\(qso.band.lowercased())"
}

private func oceaniaWPXPrefix(_ rawCallsign: String) -> String {
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

private func sourceReceivedSerial(_ value: String) -> String {
    String(repeating: "0", count: max(0, 2 - value.count)) + value
}

private func oceaniaBand(for frequencyHz: Int64) -> String? {
    switch frequencyHz {
    case 1_800_000..<2_000_000: return "160m"
    case 3_500_000..<4_000_000: return "80m"
    case 7_000_000..<7_300_000: return "40m"
    case 14_000_000..<14_350_000: return "20m"
    case 21_000_000..<21_450_000: return "15m"
    case 28_000_000..<29_700_000: return "10m"
    default: return nil
    }
}
