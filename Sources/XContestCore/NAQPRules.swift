import Foundation

private let naqpRulesDigest = "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8"
private let naqpAllBands: Set<String> = ["160m", "80m", "40m", "20m", "15m", "10m"]
private let naqpRTTYBands: Set<String> = ["80m", "40m", "20m", "15m", "10m"]
private let naqpContinents: Set<String> = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]
private let naqpStates: Set<String> = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC",
]
private let naqpProvinces: Set<String> = [
    "AB", "BC", "MB", "NB", "NL", "NT", "NS", "NU", "ON", "PE", "QC", "SK", "YT",
]
private let naqpOtherPrefixes: Set<String> = [
    "4U1/U", "6Y", "8P", "C6", "CM", "CY9", "CY0", "FG", "FJ", "FM", "FO", "FP", "FS", "HH", "HI",
    "HK0", "HP", "HR", "J3", "J6", "J7", "J8", "KG4", "KP1", "KP2", "KP4", "KP5", "OX", "PJ5",
    "PJ7", "TG", "TI", "TI9", "V2", "V3", "V4", "VP2E", "VP2M", "VP2V", "VP5", "VP9", "XE",
    "XF4", "YN", "YS", "YV0", "ZF",
]

private let naqpSentFields: [ContestExchangeFieldDescriptor] = [
    .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32, adifField: .myName),
    .init(id: "location", label: "Location", acceptedKinds: [.subdivision, .dxccPrefix], required: false,
          maximumUTF8Bytes: 8, adifField: .myState),
]
private let naqpReceivedFields: [ContestExchangeFieldDescriptor] = [
    .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32, adifField: .name),
    .init(id: "location", label: "Location", acceptedKinds: [.subdivision, .dxccPrefix],
          maximumUTF8Bytes: 8, adifField: .state),
]

private func naqpEntry(mode: String, adifMode: String, adifSubmode: String? = nil,
                       cabrilloType: String) -> ContestEntryDescriptor {
    ContestEntryDescriptor(
        cabrilloFormatterVersion: "naqp-preview-1",
        cabrilloProjectionFormatterVersion: "naqp-preview-1",
        modeProfiles: [.init(mode: mode, adifMode: adifMode, adifSubmode: adifSubmode,
                             cabrilloQSOType: cabrilloType,
                             report: .init(format: .none, defaultSent: "", defaultReceived: "",
                                           maximumUTF8Bytes: 0))],
        exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                        adifFields: .exchangeStrings, sentFields: naqpSentFields,
                        receivedFields: naqpReceivedFields),
        serial: .init(requirement: .none, allowedScopes: []),
        scorePolicy: .pointsTimesMultipliers)
}

private let naqpProvenance = "NCJ North American QSO Party Rules 2026 https://ncjweb.com/NAQP-Rules.pdf SHA-256 \(naqpRulesDigest), multiplier form https://ncjweb.com/NAQP-Paper-Log-Form.pdf SHA-256 6ea80c5118f0520f95762cc679ff3ee05154d74dc1817a681664e690a01f5a8d, retrieved 2026-10-18; comparator oliverbross/contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f not1mm/plugins/naqp_cw.py, naqp_ssb.py, naqp_rtty.py"

public struct NAQPCWRule: ContestRule {
    public static let identity = ContestRuleIdentity(id: "naqp-cw", version: "1.0.0-2026-rules-preview",
                                                     edition: "2026-rules-preview", sourceRevision: naqpRulesDigest)
    public let metadata = ContestRuleMetadata(identity: identity, displayName: "North American QSO Party CW",
                                              cabrilloName: "NAQP-CW", supportedBands: naqpAllBands,
                                              supportedModes: ["CW"],
                                              entry: naqpEntry(mode: "CW", adifMode: "CW", cabrilloType: "CW"),
                                              sourceProvenance: naqpProvenance)
    public init() {}
    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        naqpSessionIssues(session)
    }
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        naqpEvaluate(qso, session: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
}

public struct NAQPSSBRule: ContestRule {
    public static let identity = ContestRuleIdentity(id: "naqp-ssb", version: "1.0.0-2026-rules-preview",
                                                     edition: "2026-rules-preview", sourceRevision: naqpRulesDigest)
    public let metadata = ContestRuleMetadata(identity: identity, displayName: "North American QSO Party SSB",
                                              cabrilloName: "NAQP-SSB", supportedBands: naqpAllBands,
                                              supportedModes: ["SSB"],
                                              entry: naqpEntry(mode: "SSB", adifMode: "SSB", cabrilloType: "PH"),
                                              sourceProvenance: naqpProvenance)
    public init() {}
    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        naqpSessionIssues(session)
    }
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        naqpEvaluate(qso, session: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
}

public struct NAQPRTTYRule: ContestRule {
    public static let identity = ContestRuleIdentity(id: "naqp-rtty", version: "1.0.0-2026-rules-preview",
                                                     edition: "2026-rules-preview", sourceRevision: naqpRulesDigest)
    public let metadata = ContestRuleMetadata(identity: identity, displayName: "North American QSO Party RTTY",
                                              cabrilloName: "NAQP-RTTY", supportedBands: naqpRTTYBands,
                                              supportedModes: ["RTTY"],
                                              entry: naqpEntry(mode: "RTTY", adifMode: "RTTY", cabrilloType: "RY"),
                                              sourceProvenance: naqpProvenance)
    public init() {}
    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        naqpSessionIssues(session)
    }
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        naqpEvaluate(qso, session: session, metadata: metadata)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
}

private func naqpEvaluate(_ qso: ContestQSO, session: ContestSessionSnapshot,
                          metadata: ContestRuleMetadata) -> ContestRuleEvaluation {
    var issues: [ContestValidationIssue] = []
    if !naqpValidCallsign(qso.callsign) {
        issues.append(.init(code: "invalidCallsign", field: "callsign", message: "A valid callsign is required."))
    }
    if !metadata.supportedBands.contains(qso.band) {
        issues.append(.init(code: "unsupportedBand", field: "band", message: "The band is not supported by this NAQP mode."))
    }
    if !metadata.supportedModes.contains(qso.mode) {
        issues.append(.init(code: "unsupportedMode", field: "mode", message: "The mode is not supported by this NAQP rule."))
    }
    if qso.frequencyHz <= 0 || ContestBandPlan.band(for: qso.frequencyHz) != qso.band {
        issues.append(.init(code: "frequencyBandMismatch", field: "frequencyHz",
                            message: "Frequency does not match the recorded contest band."))
    }
    guard let own = session.station.entity, naqpValidEntity(own),
          let worked = qso.entity, naqpValidEntity(worked) else {
        issues.append(.init(code: "invalidEntity", field: qso.entity == nil ? "entity" : "station.entity",
                            message: "Resolved contest geography is missing or invalid."))
        return .init(validation: issues, dupeKey: naqpDupeKey(qso), points: 0, multiplierCandidates: [])
    }

    if qso.callsign == session.station.callsign {
        issues.append(.init(code: "selfContact", field: "callsign",
                            message: "NAQP does not permit a station to contact itself."))
    }

    if qso.exchange.sentFields != session.station.sentExchangeFields ||
        qso.exchange.normalizedSent != session.station.sentExchange {
        issues.append(.init(code: "sentExchangeMismatch", field: "exchange.sent",
                            message: "Sent exchange must match the session station snapshot."))
    }
    issues += naqpExchangeIssues(fields: qso.exchange.sentFields, aggregate: qso.exchange.normalizedSent,
                                 entity: own, direction: "sent")
    let workedMobile = naqpIsAirOrMaritimeMobile(qso.callsign)
    issues += naqpExchangeIssues(fields: qso.exchange.receivedFields, aggregate: qso.exchange.normalizedReceived,
                                 entity: worked, direction: "received", forceDX: workedMobile)

    let ownNA = naqpIsNorthAmerican(own)
    let workedNA = !workedMobile && naqpIsNorthAmerican(worked)
    if workedMobile && !ownNA {
        issues.append(.init(code: "unsupportedMobileEndpoint", field: "entity",
                            message: "This preview cannot establish a North American endpoint for a mobile contact from a DX entrant."))
    } else if !ownNA && !workedNA {
        issues.append(.init(code: "noNorthAmericanEndpoint", field: "entity",
                            message: "A valid NAQP contact must include a North American station."))
    }
    let multiplier = workedNA ? naqpMultiplier(entity: worked,
                                                location: qso.exchange.receivedFields["location"]?.normalized,
                                                band: qso.band) : nil
    if workedNA && multiplier == nil {
        issues.append(.init(code: "invalidMultiplierLocation", field: "exchange.received.location",
                            message: "Received location does not match the resolved North American entity."))
    }
    let invalid = issues.contains { $0.severity == .error }
    return .init(validation: issues, dupeKey: naqpDupeKey(qso), points: invalid ? 0 : 1,
                 multiplierCandidates: invalid ? [] : Set(multiplier.map { [$0] } ?? []))
}

private func naqpSessionIssues(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
    guard let entity = session.station.entity, naqpValidEntity(entity) else {
        return [.init(code: "invalidStationEntity", field: "station.entity",
                      message: "Resolved station geography is missing or invalid.")]
    }
    var issues = naqpExchangeIssues(fields: session.station.sentExchangeFields,
                                    aggregate: session.station.sentExchange, entity: entity,
                                    direction: "station.sent")
    if naqpIsAirOrMaritimeMobile(session.station.callsign) {
        issues.append(.init(code: "unsupportedMobileStation", field: "station.callsign",
                            message: "This preview cannot establish the physical endpoint of an air or maritime mobile entrant."))
    }
    return issues
}

private func naqpExchangeIssues(fields: [String: ContestExchangeFieldValue], aggregate: String,
                                entity: ContestEntitySnapshot, direction: String,
                                forceDX: Bool = false) -> [ContestValidationIssue] {
    guard let name = fields["name"]?.normalized, !name.isEmpty else {
        return [.init(code: "missingNAQPName", field: "\(direction).name", message: "NAQP name is required.")]
    }
    let location = fields["location"]?.normalized
    var issues: [ContestValidationIssue] = []
    if naqpIsNorthAmerican(entity) && !forceDX {
        if location == nil || naqpMultiplier(entity: entity, location: location, band: "session") == nil {
            issues.append(.init(code: "invalidNAQPLocation", field: "\(direction).location",
                                message: "North American exchange location must match resolved geography."))
        }
    } else if direction == "received" {
        if location != "DX" {
            issues.append(.init(code: "invalidDXLocation", field: "\(direction).location",
                                message: "A non-North-American contact is logged with location DX."))
        }
    } else if location != nil {
        issues.append(.init(code: "unexpectedNAQPLocation", field: "\(direction).location",
                            message: "A non-North-American station sends name only."))
    }
    let expected = [name, location].compactMap { $0 }.joined(separator: " ")
    if aggregate != expected {
        issues.append(.init(code: "NAQPAggregateMismatch", field: direction,
                            message: "Normalized aggregate exchange must match its typed fields."))
    }
    return issues
}

private func naqpMultiplier(entity: ContestEntitySnapshot, location: String?, band: String) -> ContestMultiplierKey? {
    guard let location else { return nil }
    if entity.adif == 6 || entity.countryPrefix == "KL7" {
        return location == "AK" ? .init(kind: "naqp-state", value: "AK", scope: band) : nil
    }
    if entity.adif == 110 || entity.countryPrefix == "KH6" {
        return location == "HI" ? .init(kind: "naqp-state", value: "HI", scope: band) : nil
    }
    if entity.adif == 291 || entity.countryPrefix == "K" {
        return naqpStates.contains(location) && !["AK", "HI"].contains(location)
            ? .init(kind: "naqp-state", value: location, scope: band) : nil
    }
    if entity.adif == 1 || entity.countryPrefix == "VE" {
        return naqpProvinces.contains(location)
            ? .init(kind: "naqp-province", value: location, scope: band) : nil
    }
    guard let prefix = naqpOfficialOtherPrefix(entity) else { return nil }
    return location == prefix
        ? .init(kind: "naqp-dxcc", value: prefix, scope: band) : nil
}

private func naqpOfficialOtherPrefix(_ entity: ContestEntitySnapshot) -> String? {
    switch entity.adif {
    case 289: return "4U1/U" // cty.csv 4U1U (United Nations HQ)
    case 36: return "FO"     // cty.csv FO/c (Clipperton Island)
    case 216: return "HK0"   // cty.csv HK0/a (San Andres & Providencia)
    case 175, 161: return nil // FO French Polynesia and HK0/m Malpelo are outside North America
    default: return naqpOtherPrefixes.contains(entity.countryPrefix) ? entity.countryPrefix : nil
    }
}

private func naqpIsNorthAmerican(_ entity: ContestEntitySnapshot) -> Bool {
    if [175, 161].contains(entity.adif) { return false }
    return entity.continent == "NA" || entity.adif == 110 || entity.countryPrefix == "KH6" ||
        [289, 36, 216].contains(entity.adif)
}

private func naqpIsAirOrMaritimeMobile(_ callsign: String) -> Bool {
    callsign.split(separator: "/").contains { $0 == "MM" || $0 == "AM" }
}

private func naqpValidEntity(_ entity: ContestEntitySnapshot) -> Bool {
    entity.adif > 0 && !entity.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !entity.countryPrefix.isEmpty && naqpContinents.contains(entity.continent) && (1...40).contains(entity.cqZone)
}

private func naqpValidCallsign(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard (3...32).contains(bytes.count), bytes.contains(where: { (65...90).contains($0) }),
          bytes.contains(where: { (48...57).contains($0) }) else { return false }
    return bytes.allSatisfy { (65...90).contains($0) || (48...57).contains($0) || $0 == 47 }
}

private func naqpDupeKey(_ qso: ContestQSO) -> String? {
    guard naqpValidCallsign(qso.callsign), !qso.band.isEmpty else { return nil }
    return "\(qso.callsign)|\(qso.band)"
}
