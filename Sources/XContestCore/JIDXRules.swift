import Foundation

private let jidxRulesDigest = "01f529ab02a70c70e33ece347ee4387feb59b7786085795ed7609d0a7bebd4aa"
private let jidxBands: Set<String> = ["160m", "80m", "40m", "20m", "15m", "10m"]
private let jidxJapaneseEntities: Set<Int> = [177, 192, 339]
private let jidxLocations = Set((1...50).map { String(format: "%02d", $0) })
private let jidxBandPoints: [String: Int64] = [
    "160m": 4, "80m": 2, "40m": 1, "20m": 1, "15m": 1, "10m": 2,
]

private let jidxSentFields: [ContestExchangeFieldDescriptor] = [
    .init(id: "number", label: "Prefecture or CQ Zone",
          acceptedKinds: [.cqZone, .jarlPrefectureNumber], maximumUTF8Bytes: 2,
          adifField: .stx),
]
private let jidxReceivedFields: [ContestExchangeFieldDescriptor] = [
    .init(id: "number", label: "Prefecture or CQ Zone",
          acceptedKinds: [.cqZone, .jarlPrefectureNumber], maximumUTF8Bytes: 2,
          adifField: .srx),
]

private func jidxEntry(mode: String, adifMode: String,
                       cabrilloType: String, report: ContestReportDescriptor) -> ContestEntryDescriptor {
    ContestEntryDescriptor(
        cabrilloFormatterVersion: "jidx-preview-1",
        cabrilloProjectionFormatterVersion: "jidx-preview-1",
        modeProfiles: [.init(mode: mode, adifMode: adifMode,
                             cabrilloQSOType: cabrilloType, report: report)],
        exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                        adifFields: .exchangeStrings, sentFields: jidxSentFields,
                        receivedFields: jidxReceivedFields),
        serial: .init(requirement: .none, allowedScopes: []),
        scorePolicy: .pointsTimesMultipliers)
}

private let jidxCWEntry = jidxEntry(
    mode: "CW", adifMode: "CW", cabrilloType: "CW",
    report: .init(format: .cwRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3))
private let jidxSSBEntry = jidxEntry(
    mode: "SSB", adifMode: "SSB", cabrilloType: "PH",
    report: .init(format: .phoneRS, defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2))

private let jidxProvenance = "JIDX Contest Rules 2026-10 https://www.jidx.org/jidxrule-e.html " +
    "SHA-256 \(jidxRulesDigest), multiplier list https://www.jidx.org/jidxmult.lst " +
    "SHA-256 8bc36d111fa659368de86d85ae6a6b386cbe46f67a1c04ea59088250b2840de5, " +
    "retrieved 2026-10-18; current entity validation reuses the January 2026 DXCC authority " +
    "currently named arrlRTTYCurrentDXCCEntityCodes; comparator contest-sw " +
    "7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/jidx_cw.py and jidx_ph.py; " +
    "visitor prefix authority https://rsgb.org/main/operating/licensing-novs-visitors/" +
    "operating-for-visitors/ SHA-256 " +
    "c115478a145a6d8cd9746917f5f3c7b70e58af3c3fa45cac787767b038282d56; " +
    "inactive preview only"

/// Inactive JIDX CW scoring core. Registry, worker, UI, export, and category activation remain separate.
public struct JIDXCWRule: ContestRule {
    public static let identity = ContestRuleIdentity(
        id: "jidx-cw", version: "1.0.0-2026-rules-preview",
        edition: "2026-10-rules-preview", sourceRevision: jidxRulesDigest)
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "JIDX CW Preview", cabrilloName: "JIDX-CW",
        supportedBands: jidxBands, supportedModes: ["CW"], entry: jidxCWEntry,
        sourceProvenance: jidxProvenance)

    public init() {}
    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        jidxSessionIssues(session, identity: Self.identity)
    }
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        jidxEvaluate(qso, session: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        qso.exchange.normalizedReceived
    }
}

/// Inactive JIDX Phone scoring core. SSB is rendered as PH only by a future dedicated exporter.
public struct JIDXSSBRule: ContestRule {
    public static let identity = ContestRuleIdentity(
        id: "jidx-ssb", version: "1.0.0-2026-rules-preview",
        edition: "2026-10-rules-preview", sourceRevision: jidxRulesDigest)
    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "JIDX Phone Preview", cabrilloName: "JIDX-PH",
        supportedBands: jidxBands, supportedModes: ["SSB"], entry: jidxSSBEntry,
        sourceProvenance: jidxProvenance)

    public init() {}
    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        jidxSessionIssues(session, identity: Self.identity)
    }
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        jidxEvaluate(qso, session: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        qso.exchange.normalizedReceived
    }
}

private enum JIDXEndpointRole: Equatable {
    case japanese
    case dx
    case maritimeMobile
}

private func jidxEvaluate(_ qso: ContestQSO, session: ContestSessionSnapshot,
                          metadata: ContestRuleMetadata) -> ContestRuleEvaluation {
    var issues: [ContestValidationIssue] = []
    if !jidxValidCallsign(qso.callsign) {
        issues.append(jidxIssue("invalidCallsign", "callsign", "A bounded ASCII callsign is required."))
    }
    if !metadata.supportedBands.contains(qso.band) {
        issues.append(jidxIssue("unsupportedBand", "band", "JIDX uses 160, 80, 40, 20, 15, and 10 metres."))
    }
    if !metadata.supportedModes.contains(qso.mode) {
        issues.append(jidxIssue("unsupportedMode", "mode", "QSO mode does not match this JIDX rule."))
    }
    if qso.frequencyHz <= 0 || ContestBandPlan.band(for: qso.frequencyHz) != qso.band {
        issues.append(jidxIssue("frequencyBandMismatch", "frequencyHz",
                                "Frequency does not match the recorded contest band."))
    }
    if qso.callsign == session.station.callsign {
        issues.append(jidxIssue("selfContact", "callsign", "A station cannot contact itself."))
    }

    guard let ownRole = jidxRole(callsign: session.station.callsign,
                                 entity: session.station.entity) else {
        issues.append(jidxIssue("invalidStationRole", "station",
                                "JIDX station role could not be resolved from current entity and callsign evidence."))
        return .init(validation: issues, dupeKey: jidxDupeKey(qso), points: 0,
                     multiplierCandidates: [])
    }
    guard let workedRole = jidxRole(callsign: qso.callsign, entity: qso.entity) else {
        issues.append(jidxIssue("invalidEndpointRole", "entity",
                                "JIDX worked role could not be resolved from current entity and callsign evidence."))
        return .init(validation: issues, dupeKey: jidxDupeKey(qso), points: 0,
                     multiplierCandidates: [])
    }

    issues += jidxSentExchangeIssues(qso, station: session.station, role: ownRole)
    issues += jidxExchangeIssues(fields: qso.exchange.receivedFields,
                                 rawAggregate: qso.exchange.rawReceived,
                                 normalizedAggregate: qso.exchange.normalizedReceived,
                                 role: workedRole, entity: qso.entity,
                                 direction: "exchange.received")

    let invalid = issues.contains { $0.severity == .error }
    let eligible = !invalid && jidxEligible(own: ownRole, worked: workedRole)
    let points = eligible ? (jidxBandPoints[qso.band] ?? 0) : 0
    let multipliers = eligible ? jidxMultipliers(own: ownRole, worked: workedRole,
                                                  workedEntity: qso.entity,
                                                  received: qso.exchange.receivedFields["number"]?.normalized,
                                                  band: qso.band) : []
    return .init(validation: issues, dupeKey: jidxDupeKey(qso), points: points,
                 multiplierCandidates: multipliers)
}

private func jidxSessionIssues(_ session: ContestSessionSnapshot,
                               identity: ContestRuleIdentity) -> [ContestValidationIssue] {
    guard session.rule == identity else {
        return [jidxIssue("ruleMismatch", "rule", "Session rule identity does not match this JIDX rule.")]
    }
    guard jidxValidCallsign(session.station.callsign),
          let role = jidxRole(callsign: session.station.callsign, entity: session.station.entity) else {
        return [jidxIssue("invalidStationRole", "station",
                          "A valid land or maritime-mobile JIDX station role is required.")]
    }
    return jidxExchangeIssues(fields: session.station.sentExchangeFields,
                              rawAggregate: nil, normalizedAggregate: session.station.sentExchange,
                              role: role, entity: session.station.entity,
                              direction: "station.sentExchange")
}

private func jidxSentExchangeIssues(_ qso: ContestQSO, station: ContestStationSnapshot,
                                    role: JIDXEndpointRole) -> [ContestValidationIssue] {
    var issues = jidxExchangeIssues(fields: qso.exchange.sentFields,
                                    rawAggregate: qso.exchange.rawSent,
                                    normalizedAggregate: qso.exchange.normalizedSent,
                                    role: role, entity: station.entity,
                                    direction: "exchange.sent")
    if qso.exchange.sentFields != station.sentExchangeFields ||
        qso.exchange.normalizedSent != station.sentExchange {
        issues.append(jidxIssue("sentExchangeMismatch", "exchange.sent",
                                "Sent exchange must match the immutable station snapshot."))
    }
    return issues
}

private func jidxExchangeIssues(fields: [String: ContestExchangeFieldValue],
                                rawAggregate: String?, normalizedAggregate: String,
                                role: JIDXEndpointRole, entity: ContestEntitySnapshot?,
                                direction: String) -> [ContestValidationIssue] {
    guard fields.count == 1, let value = fields["number"] else {
        return [jidxIssue("invalidExchangeShape", direction,
                          "Exactly one typed JIDX exchange number is required.")]
    }
    var issues: [ContestValidationIssue] = []
    let rawBytes = Array(value.raw.utf8)
    let normalizedBytes = Array(value.normalized.utf8)
    let rawIsDigits = (1...2).contains(rawBytes.count) && rawBytes.allSatisfy { (48...57).contains($0) }
    let normalizedIsDigits = normalizedBytes.count == 2 && normalizedBytes.allSatisfy { (48...57).contains($0) }
    let expectedNormalized = Int(value.raw).map { String(format: "%02d", $0) }
    if !rawIsDigits || !normalizedIsDigits || expectedNormalized != value.normalized {
        issues.append(jidxIssue("invalidExchangeNormalization", "\(direction).number",
                                "Raw exchange input must normalize losslessly to exactly two digits."))
    }
    if rawAggregate.map({ $0 != value.raw }) == true || normalizedAggregate != value.normalized {
        issues.append(jidxIssue("exchangeAggregateMismatch", direction,
                                "Raw and normalized aggregates must match their typed exchange projections."))
    }
    switch role {
    case .japanese:
        if !jidxLocations.contains(value.normalized) ||
            !jidxJapaneseLocationMatchesEntity(value.normalized, entity: entity) {
            issues.append(jidxIssue("invalidJapaneseLocation", "\(direction).number",
                                    "Japanese exchange must match an official JIDX location and current entity."))
        }
    case .dx, .maritimeMobile:
        if Int(value.normalized).map({ (1...40).contains($0) }) != true {
            issues.append(jidxIssue("invalidCQZone", "\(direction).number",
                                    "DX and maritime-mobile exchange must be CQ zone 01 through 40."))
        }
    }
    return issues
}

private func jidxRole(callsign: String, entity: ContestEntitySnapshot?) -> JIDXEndpointRole? {
    guard jidxValidCallsign(callsign) else { return nil }
    let components = callsign.split(separator: "/")
    let misplacedMobileMarker = components.dropFirst().dropLast().contains {
        $0 == "MM" || $0 == "AM"
    }
    guard !misplacedMobileMarker, components.last != "AM" else { return nil }
    if components.last == "MM" {
        guard entity.map(jidxValidEntity) ?? true else { return nil }
        return .maritimeMobile
    }
    guard let entity, jidxValidEntity(entity) else { return nil }
    return jidxJapaneseEntities.contains(entity.adif) ? .japanese : .dx
}

private func jidxEligible(own: JIDXEndpointRole, worked: JIDXEndpointRole) -> Bool {
    switch (own, worked) {
    case (.japanese, .dx), (.japanese, .maritimeMobile),
         (.dx, .japanese), (.maritimeMobile, .japanese): return true
    default: return false
    }
}

private func jidxMultipliers(own: JIDXEndpointRole, worked: JIDXEndpointRole,
                             workedEntity: ContestEntitySnapshot?, received: String?,
                             band: String) -> Set<ContestMultiplierKey> {
    guard let received else { return [] }
    switch (own, worked) {
    case (.japanese, .dx):
        guard let workedEntity else { return [] }
        return [
            .init(kind: "dxccEntity", value: String(workedEntity.adif), scope: band),
            .init(kind: "cqZone", value: received, scope: band),
        ]
    case (.japanese, .maritimeMobile):
        return [.init(kind: "cqZone", value: received, scope: band)]
    case (.dx, .japanese), (.maritimeMobile, .japanese):
        return [.init(kind: "jidxLocation", value: received, scope: band)]
    default:
        return []
    }
}

private func jidxJapaneseLocationMatchesEntity(_ location: String,
                                               entity: ContestEntitySnapshot?) -> Bool {
    guard let entity else { return false }
    switch location {
    case "48", "50": return entity.adif == 192
    case "49": return entity.adif == 177
    default: return (1...47).contains(Int(location) ?? 0) && entity.adif == 339
    }
}

private func jidxValidEntity(_ entity: ContestEntitySnapshot) -> Bool {
    // Shared January 2026 current-DXCC authority; its legacy ARRL-prefixed name is retained
    // for this isolated slice so the concurrently owned ARRL validation file stays untouched.
    arrlRTTYCurrentDXCCEntityCodes.contains(entity.adif) &&
        !entity.name.isEmpty && !entity.countryPrefix.isEmpty &&
        ["AF", "AN", "AS", "EU", "NA", "OC", "SA"].contains(entity.continent) &&
        (1...40).contains(entity.cqZone)
}

private func jidxValidCallsign(_ callsign: String) -> Bool {
    let parts = callsign.split(separator: "/", omittingEmptySubsequences: false)
    let hasCallComponent = parts.contains { part in
        let bytes = part.utf8
        return part != "MM" && part != "AM" &&
            bytes.contains(where: { (65...90).contains($0) }) &&
            bytes.contains(where: { (48...57).contains($0) })
    }
    return (3...32).contains(callsign.utf8.count) && parts.allSatisfy { part in
        !part.isEmpty && part.utf8.allSatisfy { (65...90).contains($0) || (48...57).contains($0) }
    } && hasCallComponent
}

private func jidxDupeKey(_ qso: ContestQSO) -> String? {
    guard jidxValidCallsign(qso.callsign), !qso.band.isEmpty else { return nil }
    return "\(qso.callsign)|\(qso.band)"
}

private func jidxIssue(_ code: String, _ field: String,
                       _ message: String) -> ContestValidationIssue {
    .init(code: code, field: field, message: message)
}
