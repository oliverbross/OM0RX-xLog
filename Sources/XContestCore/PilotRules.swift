import Foundation

private let pilotBands: Set<String> = ["160m", "80m", "40m", "20m", "15m", "10m"]
private let validContinents: Set<String> = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]
private let serialScopes: [ContestSerialScope] = [.session, .band, .transmitter]

private let cwZoneEntry = ContestEntryDescriptor(
    mode: "CW", adifMode: "CW", cabrilloQSOType: "CW",
    cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2",
    report: .init(format: .cwRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3),
    exchange: .init(sent: .cqZone, received: .cqZone, sentDefault: .stationSnapshot, adifFields: .none),
    serial: .init(requirement: .none, allowedScopes: [])
)
private let cwSerialEntry = ContestEntryDescriptor(
    mode: "CW", adifMode: "CW", cabrilloQSOType: "CW",
    cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2",
    report: .init(format: .cwRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3),
    exchange: .init(sent: .serialNumber, received: .serialNumber, sentDefault: .reservedSerial, adifFields: .stxSrx),
    serial: .init(requirement: .requiredForCommit, allowedScopes: serialScopes)
)
private let ssbZoneEntry = ContestEntryDescriptor(
    mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH",
    cabrilloFormatterVersion: "ssb-pilot-1", cabrilloProjectionFormatterVersion: "ssb-pilot-2",
    report: .init(format: .phoneRS, defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2),
    exchange: .init(sent: .cqZone, received: .cqZone, sentDefault: .stationSnapshot, adifFields: .none),
    serial: .init(requirement: .none, allowedScopes: [])
)
private let ssbSerialEntry = ContestEntryDescriptor(
    mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH",
    cabrilloFormatterVersion: "ssb-pilot-1", cabrilloProjectionFormatterVersion: "ssb-pilot-2",
    report: .init(format: .phoneRS, defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2),
    exchange: .init(sent: .serialNumber, received: .serialNumber, sentDefault: .reservedSerial, adifFields: .stxSrx),
    serial: .init(requirement: .requiredForCommit, allowedScopes: serialScopes)
)

private func commonValidation(_ qso: ContestQSO, session: ContestSessionSnapshot,
                              metadata: ContestRuleMetadata) -> [ContestValidationIssue] {
    var issues: [ContestValidationIssue] = []
    if !metadata.entry.isCoherent(supportedModes: metadata.supportedModes) {
        issues.append(.init(code: "invalidRuleEntryDescriptor", field: "rule", message: "Contest entry metadata is inconsistent."))
    }
    if qso.callsign.isEmpty || qso.callsign.range(of: #"^[A-Z0-9]+(?:/[A-Z0-9]+)*$"#, options: .regularExpression) == nil ||
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
    } else if pilotBand(for: qso.frequencyHz) != qso.band {
        issues.append(.init(code: "frequencyBandMismatch", field: "frequencyHz", message: "Frequency does not match the recorded contest band."))
    }
    if !metadata.entry.report.accepts(qso.rstSent) {
        issues.append(.init(code: "invalidRSTSent", field: "rstSent", message: "Sent report does not match the contest mode."))
    }
    if !metadata.entry.report.accepts(qso.rstReceived) {
        issues.append(.init(code: "invalidRSTReceived", field: "rstReceived", message: "Received report does not match the contest mode."))
    }
    if let entity = qso.entity, validEntity(entity) == false {
        issues.append(.init(code: "invalidEntity", field: "entity", message: "Resolved contest geography is incomplete or invalid."))
    } else if qso.entity == nil {
        issues.append(.init(code: "unknownEntity", field: "entity", message: "Contest geography could not be resolved."))
    }
    if let entity = session.station.entity, validEntity(entity) == false {
        issues.append(.init(code: "invalidStationEntity", field: "station.entity", message: "Station contest geography is incomplete or invalid."))
    } else if session.station.entity == nil {
        issues.append(.init(code: "unknownStationEntity", field: "station.entity", message: "Station contest geography could not be resolved."))
    }
    return issues
}

public struct CQWWCWRule: ContestRule {
    public static let identity = ContestRuleIdentity(id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11",
                                                     sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f")
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "CQ WW CW", cabrilloName: "CQ-WW-CW",
        supportedBands: pilotBands, supportedModes: ["CW"],
        entry: cwZoneEntry,
        sourceProvenance: "oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/cq_ww_cw.py; source parity only, not current sponsor approval"
    )

    public init() {}

    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateCQWW(qso, in: session, metadata: metadata)
    }

    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
}

public struct CQWPXCWRule: ContestRule {
    public static let identity = ContestRuleIdentity(id: "cq-wpx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11",
                                                     sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f")
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "CQ WPX CW", cabrilloName: "CQ-WPX-CW",
        supportedBands: pilotBands, supportedModes: ["CW"],
        entry: cwSerialEntry,
        sourceProvenance: "oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/cq_wpx_cw.py + not1mm/lib/ham_utility.py; source parity only, not current sponsor approval"
    )

    public init() {}

    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateCQWPX(qso, in: session, metadata: metadata)
    }

    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }

    /// Source-compatible pilot behavior from `calculate_wpx_prefix`; sponsor review remains open.
    public static func wpxPrefix(for rawCallsign: String) -> String {
        sourceCompatibleWPXPrefix(rawCallsign)
    }
}

public struct CQWWSSBRule: ContestRule {
    public static let identity = ContestRuleIdentity(id: "cq-ww-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11",
                                                      sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f")
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "CQ WW SSB", cabrilloName: "CQ-WW-SSB",
        supportedBands: pilotBands, supportedModes: ["SSB"], entry: ssbZoneEntry,
        sourceProvenance: "oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/cq_ww_ssb.py; source parity only, not current sponsor approval"
    )

    public init() {}
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateCQWW(qso, in: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
}

public struct CQWPXSSBRule: ContestRule {
    public static let identity = ContestRuleIdentity(id: "cq-wpx-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11",
                                                      sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f")
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "CQ WPX SSB", cabrilloName: "CQ-WPX-SSB",
        supportedBands: pilotBands, supportedModes: ["SSB"], entry: ssbSerialEntry,
        sourceProvenance: "oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/cq_wpx_ssb.py + not1mm/lib/ham_utility.py; source parity only, not current sponsor approval"
    )

    public init() {}
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        evaluateCQWPX(qso, in: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
    public static func wpxPrefix(for rawCallsign: String) -> String { sourceCompatibleWPXPrefix(rawCallsign) }
}

private func evaluateCQWW(_ qso: ContestQSO, in session: ContestSessionSnapshot,
                          metadata: ContestRuleMetadata) -> ContestRuleEvaluation {
    var issues = commonValidation(qso, session: session, metadata: metadata)
    let sentZone = Int(qso.exchange.normalizedSent)
    let stationZone = Int(session.station.sentExchange)
    if sentZone == nil || !(1...40).contains(sentZone!) {
        issues.append(.init(code: "invalidSentCQZone", field: "exchange.sent", message: "Sent CQ zone must be an integer from 1 through 40."))
    }
    if stationZone == nil || !(1...40).contains(stationZone!) || sentZone != stationZone {
        issues.append(.init(code: "sentCQZoneMismatch", field: "exchange.sent", message: "Sent CQ zone must match the pinned station exchange."))
    }
    let zone = Int(qso.exchange.normalizedReceived)
    if zone == nil || !(1...40).contains(zone!) {
        issues.append(.init(code: "invalidCQZone", field: "exchange.received", message: "CQ zone must be an integer from 1 through 40."))
    }
    guard !issues.contains(where: { $0.severity == .error }), let own = session.station.entity,
          let worked = qso.entity, let zone else {
        return ContestRuleEvaluation(validation: issues, dupeKey: normalizedDupe(qso), points: 0, multiplierCandidates: [])
    }
    let points: Int64
    if own.adif == worked.adif { points = 0 }
    else if own.continent != worked.continent { points = 3 }
    else if own.continent == "NA" { points = 2 }
    else { points = 1 }
    return ContestRuleEvaluation(validation: issues, dupeKey: normalizedDupe(qso), points: points,
                                 multiplierCandidates: [
                                    .init(kind: "country", value: String(worked.adif), scope: qso.band),
                                    .init(kind: "cq-zone", value: String(zone), scope: qso.band),
                                 ])
}

private func evaluateCQWPX(_ qso: ContestQSO, in session: ContestSessionSnapshot,
                           metadata: ContestRuleMetadata) -> ContestRuleEvaluation {
    var issues = commonValidation(qso, session: session, metadata: metadata)
    if Int(qso.exchange.normalizedSent).map({ $0 > 0 }) != true {
        issues.append(.init(code: "invalidSentSerial", field: "exchange.sent", message: "Sent serial must be a positive integer."))
    }
    if Int(qso.exchange.normalizedReceived).map({ $0 > 0 }) != true {
        issues.append(.init(code: "invalidReceivedSerial", field: "exchange.received", message: "Received serial must be a positive integer."))
    }
    let prefix = sourceCompatibleWPXPrefix(qso.callsign)
    if prefix.isEmpty {
        issues.append(.init(code: "invalidWPXPrefix", field: "callsign", message: "A WPX prefix could not be derived."))
    }
    guard !issues.contains(where: { $0.severity == .error }), let own = session.station.entity,
          let worked = qso.entity else {
        return ContestRuleEvaluation(validation: issues, dupeKey: normalizedDupe(qso), points: 0, multiplierCandidates: [])
    }
    let highBand = ["20m", "15m", "10m"].contains(qso.band)
    let points: Int64
    if own.adif == worked.adif { points = 1 }
    else if own.continent != worked.continent { points = highBand ? 3 : 6 }
    else if own.continent == "NA" { points = highBand ? 2 : 4 }
    else { points = highBand ? 1 : 2 }
    return ContestRuleEvaluation(validation: issues, dupeKey: normalizedDupe(qso), points: points,
                                 multiplierCandidates: [.init(kind: "wpx-prefix", value: prefix, scope: "contest")])
}

private func sourceCompatibleWPXPrefix(_ rawCallsign: String) -> String {
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

private func validEntity(_ entity: ContestEntitySnapshot) -> Bool {
    entity.adif > 0 && !entity.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !entity.countryPrefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        validContinents.contains(entity.continent) && (1...40).contains(entity.cqZone)
}

private func normalizedDupe(_ qso: ContestQSO) -> String? {
    guard !qso.callsign.isEmpty, !qso.band.isEmpty else { return nil }
    return "\(qso.callsign.uppercased())|\(qso.band.lowercased())"
}

private func pilotBand(for frequencyHz: Int64) -> String? {
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
