import Foundation

private let arrlRTTYRulesDigest = "87c9f0032e6ce502b4ae94d47b397a9a34c49a3eafdb5a50fc226694696fe1ce"
private let arrlRTTYBands: Set<String> = ["80m", "40m", "20m", "15m", "10m"]
private let arrlRTTYUSLocations: Set<String> = [
    "AL", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "ID", "IL", "IN", "IA", "KS",
    "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
    "VT", "VA", "WA", "WV", "WI", "WY",
]
private let arrlRTTYCanadaLocations: Set<String> = [
    "AB", "BC", "LB", "MB", "NB", "NF", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]
internal let arrlRTTYCurrentDXCCEntityCodes: Set<Int> = [
    1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 24, 27, 29,
    31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53,
    54, 56, 60, 61, 62, 63, 64, 65, 66, 69, 70, 71, 72, 74, 75, 76, 77, 78, 79, 80,
    82, 84, 86, 88, 89, 90, 91, 94, 95, 96, 97, 98, 99, 100, 103, 104, 105, 106, 107,
    108, 109, 110, 111, 112, 114, 116, 117, 118, 120, 122, 123, 124, 125, 126, 129, 130,
    131, 132, 133, 135, 136, 137, 138, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149,
    150, 152, 153, 157, 158, 159, 160, 161, 162, 163, 165, 166, 167, 168, 169, 170, 171,
    172, 173, 174, 175, 176, 177, 179, 180, 181, 182, 185, 187, 188, 189, 190, 191, 192,
    195, 197, 199, 201, 202, 203, 204, 205, 206, 207, 209, 211, 212, 213, 214, 215, 216,
    217, 219, 221, 222, 223, 224, 225, 227, 230, 232, 233, 234, 235, 236, 237, 238, 239,
    240, 241, 242, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 256, 257, 259, 260,
    262, 263, 265, 266, 269, 270, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282,
    283, 284, 285, 286, 287, 288, 289, 291, 292, 293, 294, 295, 296, 297, 298, 299, 301,
    302, 303, 304, 305, 306, 308, 309, 312, 315, 318, 321, 324, 327, 330, 333, 336, 339,
    342, 344, 345, 348, 354, 363, 369, 370, 372, 375, 376, 378, 379, 381, 382, 384, 386,
    387, 390, 391, 400, 401, 402, 404, 406, 408, 409, 410, 411, 412, 414, 416, 420, 422,
    424, 428, 430, 432, 434, 436, 438, 440, 442, 444, 446, 450, 452, 453, 454, 456, 458,
    460, 462, 464, 466, 468, 470, 474, 478, 480, 482, 483, 489, 490, 492, 497, 499, 501,
    502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518,
    519, 520, 521, 522,
]

private let arrlRTTYEntry = ContestEntryDescriptor(
    cabrilloFormatterVersion: "arrl-rtty-preview-1",
    cabrilloProjectionFormatterVersion: "arrl-rtty-preview-1",
    modeProfiles: [
        .init(mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY",
              report: .init(format: .digitalRST, defaultSent: "599", defaultReceived: "599",
                            maximumUTF8Bytes: 3)),
    ],
    exchange: .init(
        sent: .structured, received: .structured, sentDefault: .stationFields,
        adifFields: .exchangeStrings,
        sentFields: [
            .init(id: "location", label: "State or province", acceptedKinds: [.subdivision],
                  required: false, maximumUTF8Bytes: 2, adifField: .myState),
            .init(id: "serial", label: "Serial", acceptedKinds: [.serialNumber],
                  required: false, maximumUTF8Bytes: 8, adifField: .stx),
        ],
        receivedFields: [
            .init(id: "exchange", label: "State, province, or serial",
                  acceptedKinds: [.subdivision, .serialNumber], maximumUTF8Bytes: 8),
        ]),
    serial: .init(requirement: .none, allowedScopes: []),
    stationResolvedSerial: .init(policy: .arrlRTTYRoundupWVEOrDX,
                                 locationFieldID: "location", allocatedSerialFieldID: "serial",
                                 allowedScopes: [.session]),
    stationFields: [
        .init(id: "section", label: "Cabrillo section", role: .cabrilloLocation,
              required: true, maximumUTF8Bytes: 3),
    ],
    scorePolicy: .pointsTimesMultipliers)

/// Inactive preview of the current ARRL RTTY Roundup scoring core.
/// Category, operating-time, mobile endpoint, worker, UI, and export acceptance remain outside this rule.
public struct ARRLRTTYRoundupRule: ContestRule {
    public static let identity = ContestRuleIdentity(
        id: "arrl-rtty-roundup", version: "1.0.0-3.0b-preview", edition: "rules-3.0b-preview",
        sourceRevision: arrlRTTYRulesDigest)

    public let metadata = ContestRuleMetadata(
        identity: identity, displayName: "ARRL RTTY Roundup Preview", cabrilloName: "ARRL-RTTY",
        supportedBands: arrlRTTYBands, supportedModes: ["RTTY"], entry: arrlRTTYEntry,
        sourceProvenance: "ARRL RTTY Roundup Rules v3.0b and January 2026 DXCC list, retrieved 2026-10-18; " +
            "multiplier lists v1.2.0; compared with contest-sw 7c8b499225a73f7f8f792246881bd7aefc05452f " +
            "not1mm/plugins/arrl_rtty_ru.py; preview only, not sponsor approval")

    public init() {}

    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        guard session.rule == Self.identity else {
            return [issue("ruleMismatch", "rule", "Session rule identity does not match ARRL RTTY Roundup.")]
        }
        guard let entity = session.station.entity, arrlRTTYValidEntity(entity) else {
            return [issue("invalidStationEntity", "station.entity", "A resolved station entity is required.")]
        }
        if arrlRTTYIsMobile(session.station.callsign) {
            return [issue("unsupportedMobileStation", "station.callsign",
                          "This preview cannot prove the physical endpoint of an air or maritime mobile entrant.")]
        }
        var issues = arrlRTTYStationExchangeIssues(session.station, entity: entity)
        if !arrlRTTYCabrilloLocationIsValid(session.station.location, entityADIF: entity.adif) {
            issues.append(issue("invalidStationSection", "station.location",
                                "The frozen Cabrillo section does not match the resolved station entity."))
        }
        return issues
    }

    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        var issues: [ContestValidationIssue] = []
        if !arrlRTTYValidCallsign(qso.callsign) {
            issues.append(issue("invalidCallsign", "callsign", "A bounded ASCII callsign is required."))
        }
        if !arrlRTTYBands.contains(qso.band) {
            issues.append(issue("unsupportedBand", "band", "ARRL RTTY Roundup uses 80, 40, 20, 15, and 10 metres."))
        }
        if qso.mode != "RTTY" {
            issues.append(issue("unsupportedMode", "mode", "Only RTTY is supported by this rule."))
        }
        if qso.frequencyHz <= 0 || ContestBandPlan.band(for: qso.frequencyHz) != qso.band {
            issues.append(issue("frequencyBandMismatch", "frequencyHz", "Frequency does not match the contest band."))
        }
        guard let own = session.station.entity, arrlRTTYValidEntity(own),
              let worked = qso.entity, arrlRTTYValidEntity(worked) else {
            issues.append(issue("invalidEntity", qso.entity == nil ? "entity" : "station.entity",
                                "Resolved contest geography is missing or invalid."))
            return .init(validation: issues, dupeKey: arrlRTTYDupeKey(qso), points: 0,
                         multiplierCandidates: [])
        }
        if arrlRTTYCanonicalCall(qso.callsign) == arrlRTTYCanonicalCall(session.station.callsign) {
            issues.append(issue("selfContact", "callsign", "A station cannot score a contact with itself."))
        }
        if arrlRTTYIsMobile(qso.callsign) {
            issues.append(issue("unsupportedMobileEndpoint", "callsign",
                                "This preview cannot prove an air or maritime mobile station is outside US or Canada."))
        }
        issues += arrlRTTYSentExchangeIssues(qso, station: session.station, entity: own)
        let received = qso.exchange.receivedFields["exchange"]?.normalized
        let multiplier = arrlRTTYMultiplier(entity: worked, exchange: received)
        if arrlRTTYIsWVE(worked) {
            if !arrlRTTYLocationIsValid(received, entity: worked) {
                issues.append(issue("invalidReceivedLocation", "exchange.received.exchange",
                                    "Received state or province does not match the resolved W/VE entity."))
            }
        } else if received.flatMap(Int.init).map({ $0 > 0 }) != true {
            issues.append(issue("invalidReceivedSerial", "exchange.received.exchange",
                                "A DX station must send a positive serial number."))
        }
        if qso.exchange.normalizedReceived != received || qso.exchange.rawReceived.isEmpty {
            issues.append(issue("receivedAggregateMismatch", "exchange.received",
                                "Received aggregate exchange must match the typed field."))
        }
        let invalid = issues.contains { $0.severity == .error }
        return .init(validation: issues, dupeKey: arrlRTTYDupeKey(qso), points: invalid ? 0 : 1,
                     multiplierCandidates: invalid ? [] : Set(multiplier.map { [$0] } ?? []))
    }

    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        qso.exchange.normalizedReceived
    }
}

private func arrlRTTYStationExchangeIssues(_ station: ContestStationSnapshot,
                                           entity: ContestEntitySnapshot) -> [ContestValidationIssue] {
    let location = station.sentExchangeFields["location"]?.normalized
    let serial = station.sentExchangeFields["serial"]
    if arrlRTTYIsWVE(entity) {
        guard serial == nil, arrlRTTYLocationIsValid(location, entity: entity),
              station.sentExchange == location else {
            return [issue("invalidStationLocation", "station.sentExchangeFields.location",
                          "A W/VE station snapshot requires exactly its valid state or province.")]
        }
    } else {
        guard location == nil, serial == nil, station.sentExchange.isEmpty,
              station.sentExchangeFields.isEmpty else {
            return [issue("preseededStationSerial", "station.sentExchangeFields.serial",
                          "A DX serial is allocated durably and cannot be seeded in the station snapshot.")]
        }
    }
    return []
}

private func arrlRTTYSentExchangeIssues(_ qso: ContestQSO, station: ContestStationSnapshot,
                                        entity: ContestEntitySnapshot) -> [ContestValidationIssue] {
    if arrlRTTYIsWVE(entity) {
        guard qso.exchange.sentFields == station.sentExchangeFields,
              qso.exchange.rawSent == station.sentExchange,
              qso.exchange.normalizedSent == station.sentExchange else {
            return [issue("sentLocationMismatch", "exchange.sent",
                          "Sent state or province must match the immutable station snapshot.")]
        }
        return []
    }
    guard qso.exchange.sentFields.count == 1,
          let serial = qso.exchange.sentFields["serial"],
          serial.raw == serial.normalized, Int(serial.normalized).map({ $0 > 0 }) == true,
          qso.exchange.rawSent == serial.normalized,
          qso.exchange.normalizedSent == serial.normalized else {
        return [issue("invalidSentSerial", "exchange.sent.serial",
                      "Sent DX serial field and both aggregate values must agree.")]
    }
    return []
}

private func arrlRTTYMultiplier(entity: ContestEntitySnapshot,
                                exchange: String?) -> ContestMultiplierKey? {
    if entity.adif == 291, let exchange, arrlRTTYUSLocations.contains(exchange) {
        return .init(kind: "arrl-us-state", value: exchange, scope: "contest")
    }
    if entity.adif == 1, let exchange, arrlRTTYCanadaLocations.contains(exchange) {
        return .init(kind: "arrl-ca-province", value: exchange, scope: "contest")
    }
    guard !arrlRTTYIsWVE(entity) else { return nil }
    return .init(kind: "arrl-dxcc", value: String(entity.adif), scope: "contest")
}

private func arrlRTTYLocationIsValid(_ location: String?, entity: ContestEntitySnapshot) -> Bool {
    guard let location else { return false }
    if entity.adif == 291 { return arrlRTTYUSLocations.contains(location) }
    if entity.adif == 1 { return arrlRTTYCanadaLocations.contains(location) }
    return false
}

private func arrlRTTYIsWVE(_ entity: ContestEntitySnapshot) -> Bool {
    entity.adif == 291 || entity.adif == 1
}

private func arrlRTTYValidEntity(_ entity: ContestEntitySnapshot) -> Bool {
    arrlRTTYCurrentDXCCEntityCodes.contains(entity.adif) &&
        !entity.name.isEmpty && !entity.countryPrefix.isEmpty &&
        ["AF", "AN", "AS", "EU", "NA", "OC", "SA"].contains(entity.continent) &&
        (1...40).contains(entity.cqZone)
}

private func arrlRTTYValidCallsign(_ callsign: String) -> Bool {
    let parts = callsign.split(separator: "/", omittingEmptySubsequences: false)
    return !callsign.isEmpty && callsign.utf8.count <= 32 && parts.allSatisfy { part in
        !part.isEmpty && part.utf8.allSatisfy { (65...90).contains($0) || (48...57).contains($0) }
    } && callsign.contains(where: { $0.isLetter }) && callsign.contains(where: { $0.isNumber })
}

private func arrlRTTYCanonicalCall(_ callsign: String) -> String {
    var parts = callsign.split(separator: "/").map(String.init)
    let namedModifiers: Set<String> = ["P", "M", "QRP", "QRPP"]
    while parts.count > 1, let suffix = parts.last,
          namedModifiers.contains(suffix) || (suffix.utf8.count == 1 && suffix.utf8.allSatisfy({ (48...57).contains($0) })) {
        parts.removeLast()
    }
    return parts.joined(separator: "/")
}

private func arrlRTTYDupeKey(_ qso: ContestQSO) -> String {
    "\(arrlRTTYCanonicalCall(qso.callsign))|\(qso.band)"
}

private func arrlRTTYIsMobile(_ callsign: String) -> Bool {
    callsign.split(separator: "/").contains { $0 == "MM" || $0 == "AM" }
}

private func issue(_ code: String, _ field: String, _ message: String) -> ContestValidationIssue {
    .init(code: code, field: field, message: message)
}
