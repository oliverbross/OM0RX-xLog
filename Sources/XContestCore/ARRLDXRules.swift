import Foundation

private let arrlDXRulesDigest = "bd87f1b3f635c4cd25c8d80f4b0ca06dca0a4a0f10c819289634492ae1fefee9"
private let arrlDXBands: Set<String> = ["160m", "80m", "40m", "20m", "15m", "10m"]

private enum ARRLDXMode: String, Sendable {
    case cw = "CW"
    case ssb = "SSB"

    var cabrillo: String { self == .cw ? "CW" : "PH" }
    var report: ContestReportDescriptor {
        self == .cw
            ? .init(format: .cwRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3)
            : .init(format: .phoneRS, defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2)
    }
}

private func arrlDXEntry(_ mode: ARRLDXMode) -> ContestEntryDescriptor {
    ContestEntryDescriptor(
        cabrilloFormatterVersion: "arrl-dx-\(mode.rawValue.lowercased())-preview-1",
        cabrilloProjectionFormatterVersion: "arrl-dx-\(mode.rawValue.lowercased())-preview-1",
        modeProfiles: [
            .init(mode: mode.rawValue, adifMode: mode.rawValue, cabrilloQSOType: mode.cabrillo,
                  report: mode.report),
        ],
        exchange: .init(
            sent: .structured, received: .structured, sentDefault: .stationFields,
            adifFields: .exchangeStrings,
            sentFields: [
                .init(id: "location", label: "State or province", acceptedKinds: [.subdivision],
                      required: false, maximumUTF8Bytes: 2, adifField: .myState),
                .init(id: "power", label: "Power", acceptedKinds: [.power],
                      required: false, maximumUTF8Bytes: 8),
            ],
            receivedFields: [
                .init(id: "location", label: "State or province", acceptedKinds: [.subdivision],
                      required: false, maximumUTF8Bytes: 2, adifField: .state),
                .init(id: "power", label: "Power", acceptedKinds: [.power],
                      required: false, maximumUTF8Bytes: 8),
            ]),
        serial: .init(requirement: .none, allowedScopes: []),
        stationFields: arrlCabrilloSectionStationFields,
        scorePolicy: .pointsTimesMultipliers)
}

/// Preview scoring core for the current ARRL International DX CW rules.
/// Full categories, physical endpoint proof, and sponsor acceptance remain out of scope.
public struct ARRLDXCWRule: ContestRule, ContestRuleExchangeFieldProjection {
    public static let identity = ContestRuleIdentity(
        id: "arrl-dx-cw", version: "1.0.0-2.0-preview", edition: "rules-2.0-preview",
        sourceRevision: arrlDXRulesDigest)
    private let implementation = ARRLDXRule(mode: .cw, identity: identity)
    public init() {}
    public var metadata: ContestRuleMetadata { implementation.metadata }
    public var draftResetSentProjection: ContestDraftResetSentProjection { .soleStationField }
    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        implementation.validateSession(session)
    }
    public func validateDraft(_ draft: ContestDraftSnapshot,
                              in session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        implementation.validateDraft(draft, in: session)
    }
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        implementation.evaluate(qso, in: session)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        implementation.cabrilloReceivedExchange(for: qso)
    }
    public func projectExchangeFields(
        _ fields: [String: ContestExchangeFieldValue]
    ) -> [String: ContestExchangeFieldValue] {
        implementation.projectExchangeFields(fields)
    }
}

/// Preview scoring core for the current ARRL International DX Phone rules.
/// Full categories, physical endpoint proof, and sponsor acceptance remain out of scope.
public struct ARRLDXSSBRule: ContestRule, ContestRuleExchangeFieldProjection {
    public static let identity = ContestRuleIdentity(
        id: "arrl-dx-ssb", version: "1.0.0-2.0-preview", edition: "rules-2.0-preview",
        sourceRevision: arrlDXRulesDigest)
    private let implementation = ARRLDXRule(mode: .ssb, identity: identity)
    public init() {}
    public var metadata: ContestRuleMetadata { implementation.metadata }
    public var draftResetSentProjection: ContestDraftResetSentProjection { .soleStationField }
    public func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        implementation.validateSession(session)
    }
    public func validateDraft(_ draft: ContestDraftSnapshot,
                              in session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        implementation.validateDraft(draft, in: session)
    }
    public func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        implementation.evaluate(qso, in: session)
    }
    public func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        implementation.cabrilloReceivedExchange(for: qso)
    }
    public func projectExchangeFields(
        _ fields: [String: ContestExchangeFieldValue]
    ) -> [String: ContestExchangeFieldValue] {
        implementation.projectExchangeFields(fields)
    }
}

private struct ARRLDXRule: ContestRule {
    let mode: ARRLDXMode
    let metadata: ContestRuleMetadata

    init(mode: ARRLDXMode, identity: ContestRuleIdentity) {
        self.mode = mode
        metadata = ContestRuleMetadata(
            identity: identity, displayName: "ARRL International DX \(mode.rawValue) Preview",
            cabrilloName: mode == .cw ? "ARRL-DX-CW" : "ARRL-DX-SSB",
            supportedBands: arrlDXBands, supportedModes: [mode.rawValue], entry: arrlDXEntry(mode),
            sourceProvenance: "ARRL International DX Contest Rules v2.0 and January 2026 DXCC list, " +
                "retrieved 2026-10-18; ARRL multiplier and section guidance; compared with contest-sw " +
                "7c8b499225a73f7f8f792246881bd7aefc05452f; preview only, not sponsor approval")
    }

    func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        guard session.rule == metadata.identity else {
            return [arrlDXIssue("ruleMismatch", "rule", "Session rule identity does not match ARRL DX.")]
        }
        guard let entity = session.station.entity, arrlRTTYValidEntity(entity) else {
            return [arrlDXIssue("invalidStationEntity", "station.entity", "A current resolved DXCC entity is required.")]
        }
        var issues: [ContestValidationIssue] = []
        if arrlRTTYIsMobile(session.station.callsign) {
            issues.append(arrlDXIssue("unsupportedMobileStation", "station.callsign",
                                      "This preview cannot prove an air or maritime mobile endpoint."))
        }
        if !arrlRTTYCabrilloLocationIsValid(session.station.location, entityADIF: entity.adif) {
            issues.append(arrlDXIssue("invalidStationSection", "station.location",
                                      "The frozen Cabrillo section does not match the resolved station entity."))
        }
        issues += arrlDXStationExchangeIssues(session.station, entity: entity)
        return issues
    }

    func validateDraft(_ draft: ContestDraftSnapshot,
                       in session: ContestSessionSnapshot) -> [ContestValidationIssue] {
        guard draft.exchange.sentFields == session.station.sentExchangeFields,
              draft.exchange.rawSent == session.station.sentExchange,
              draft.exchange.normalizedSent == arrlDXStationNormalizedExchange(session.station) else {
            return [arrlDXIssue("sentExchangeNotFrozen", "exchange.sent",
                                "Sent exchange values must match the immutable station snapshot.")]
        }
        return []
    }

    func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        var issues: [ContestValidationIssue] = []
        if !arrlRTTYValidCallsign(qso.callsign) {
            issues.append(arrlDXIssue("invalidCallsign", "callsign", "A bounded ASCII callsign is required."))
        }
        if !arrlDXBands.contains(qso.band) {
            issues.append(arrlDXIssue("unsupportedBand", "band", "ARRL DX uses 160, 80, 40, 20, 15, and 10 metres."))
        }
        if qso.mode != mode.rawValue {
            issues.append(arrlDXIssue("unsupportedMode", "mode", "The contact mode does not match this ARRL DX rule."))
        }
        if qso.frequencyHz <= 0 || ContestBandPlan.band(for: qso.frequencyHz) != qso.band {
            issues.append(arrlDXIssue("frequencyBandMismatch", "frequencyHz",
                                      "Frequency does not match the contest band."))
        }
        guard let own = session.station.entity, arrlRTTYValidEntity(own),
              let worked = qso.entity, arrlRTTYValidEntity(worked) else {
            issues.append(arrlDXIssue("invalidEntity", qso.entity == nil ? "entity" : "station.entity",
                                      "Resolved current DXCC geography is missing or invalid."))
            return .init(validation: issues, dupeKey: arrlDXDupeKey(qso), points: 0,
                         multiplierCandidates: [])
        }
        if arrlRTTYCanonicalCall(qso.callsign) == arrlRTTYCanonicalCall(session.station.callsign) {
            issues.append(arrlDXIssue("selfContact", "callsign", "A station cannot score a contact with itself."))
        }
        if arrlRTTYIsMobile(qso.callsign) {
            issues.append(arrlDXIssue("unsupportedMobileEndpoint", "callsign",
                                      "This preview cannot prove an air or maritime mobile endpoint."))
        }
        if qso.stationLocation != session.station.location {
            issues.append(arrlDXIssue("stationLocationMismatch", "stationLocation",
                                      "The contact station location must match the frozen session."))
        }
        if qso.exchange.sentFields != session.station.sentExchangeFields ||
            qso.exchange.rawSent != session.station.sentExchange ||
            qso.exchange.normalizedSent != arrlDXStationNormalizedExchange(session.station) {
            issues.append(arrlDXIssue("sentExchangeNotFrozen", "exchange.sent",
                                      "Sent exchange values must match the immutable station snapshot."))
        }

        let ownIsWVE = arrlRTTYIsWVE(own)
        let workedIsWVE = arrlRTTYIsWVE(worked)
        var multiplier: ContestMultiplierKey?
        if ownIsWVE == workedIsWVE {
            issues.append(arrlDXIssue("invalidContactDirection", "entity",
                                      "ARRL DX contacts must cross between W/VE and DX sides."))
        } else if ownIsWVE {
            if !arrlDXReceivedPowerIsValid(qso.exchange) {
                issues.append(arrlDXIssue("invalidReceivedPower", "exchange.received.power",
                                          "A DX station must send a valid power exchange."))
            }
            multiplier = .init(kind: "arrl-dxcc", value: String(worked.adif), scope: qso.band)
        } else {
            let location = qso.exchange.receivedFields["location"]
            if qso.exchange.receivedFields.count != 1 || location?.raw != location?.normalized ||
                qso.exchange.rawReceived != location?.raw || qso.exchange.normalizedReceived != location?.normalized ||
                !arrlRTTYLocationIsValid(location?.normalized, entity: worked) {
                issues.append(arrlDXIssue("invalidReceivedLocation", "exchange.received.location",
                                          "A W/VE station must send its valid state or province."))
            }
            if let value = location?.normalized {
                multiplier = .init(kind: worked.adif == 291 ? "arrl-us-state" : "arrl-ca-province",
                                   value: value, scope: qso.band)
            }
        }
        let invalid = issues.contains { $0.severity == .error }
        return .init(validation: issues, dupeKey: arrlDXDupeKey(qso), points: invalid ? 0 : 3,
                     multiplierCandidates: invalid ? [] : Set(multiplier.map { [$0] } ?? []))
    }

    func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
        qso.exchange.normalizedReceived
    }

    func projectExchangeFields(
        _ fields: [String: ContestExchangeFieldValue]
    ) -> [String: ContestExchangeFieldValue] {
        guard let power = fields["power"], let normalized = arrlDXNormalizePower(power.raw) else {
            return fields
        }
        var projected = fields
        projected["power"] = .init(raw: power.raw, normalized: normalized)
        return projected
    }
}

private func arrlDXStationExchangeIssues(_ station: ContestStationSnapshot,
                                         entity: ContestEntitySnapshot) -> [ContestValidationIssue] {
    if arrlRTTYIsWVE(entity) {
        guard station.sentExchangeFields.count == 1,
              let location = station.sentExchangeFields["location"],
              location.raw == location.normalized,
              station.sentExchange == location.raw,
              arrlRTTYLocationIsValid(location.normalized, entity: entity) else {
            return [arrlDXIssue("invalidStationLocation", "station.sentExchangeFields.location",
                                "A W/VE station requires exactly its valid state or province.")]
        }
        return []
    }
    guard station.sentExchangeFields.count == 1,
          let power = station.sentExchangeFields["power"],
          station.sentExchange == power.raw,
          arrlDXNormalizePower(power.raw) == power.normalized else {
        return [arrlDXIssue("invalidStationPower", "station.sentExchangeFields.power",
                            "A DX station requires exactly one valid raw and normalized power value.")]
    }
    return []
}

private func arrlDXStationNormalizedExchange(_ station: ContestStationSnapshot) -> String {
    station.sentExchangeFields["location"]?.normalized ??
        station.sentExchangeFields["power"]?.normalized ?? ""
}

private func arrlDXReceivedPowerIsValid(_ exchange: ContestExchangeSnapshot) -> Bool {
    guard exchange.receivedFields.count == 1,
          let power = exchange.receivedFields["power"] else { return false }
    return exchange.rawReceived == power.raw && exchange.normalizedReceived == power.normalized &&
        arrlDXNormalizePower(power.raw) == power.normalized
}

internal func arrlDXNormalizePower(_ raw: String) -> String? {
    guard !raw.isEmpty, raw.utf8.count <= 8,
          raw.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) }) else { return nil }
    let token = raw.replacingOccurrences(of: "WATTS", with: "")
        .replacingOccurrences(of: "W", with: "")
    if token == "K" || token == "1K" || token == "KILO" { return "1000" }
    let substitutions: [Character: Character] = ["A": "1", "E": "5", "N": "9", "T": "0", "O": "0"]
    var digits = ""
    for character in token {
        if character.isNumber { digits.append(character) }
        else if let replacement = substitutions[character] { digits.append(replacement) }
        else { return nil }
    }
    if digits == "000" { return "1000" }
    guard let value = Int(digits), (1...1_500).contains(value) else { return nil }
    return String(value)
}

private func arrlDXDupeKey(_ qso: ContestQSO) -> String {
    "\(arrlRTTYCanonicalCall(qso.callsign))|\(qso.band)"
}

private func arrlDXIssue(_ code: String, _ field: String, _ message: String) -> ContestValidationIssue {
    .init(code: code, field: field, message: message)
}
