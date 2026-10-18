import Foundation

public enum ContestOperatorStyle: String, Codable, Hashable, Sendable {
    case run
    case searchAndPounce = "search-and-pounce"
}

public enum ContestOperatorMacroRole: String, Codable, Hashable, Sendable {
    case cq = "CQ"
    case exchange = "EXCH"
    case qrz = "QRZ"
    case again = "AGN"
    case hisCall = "HISCALL"
    case myCall = "MYCALL"
    case qsoBefore = "QSOB4"
}

public enum ContestOperatorSignalKind: String, Codable, Hashable, Sendable {
    case cw
    case phone
}

private struct ContestOperatorDynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private func rejectUnknownOperatorPolicyKeys<Key: CodingKey & CaseIterable>(
    from decoder: Decoder, allowedBy _: Key.Type
) throws where Key.AllCases: Collection {
    let values = try decoder.container(keyedBy: ContestOperatorDynamicCodingKey.self)
    let allowed = Set(Key.allCases.map(\.stringValue))
    let unknown = values.allKeys.map(\.stringValue).filter { !allowed.contains($0) }.sorted()
    guard unknown.isEmpty else {
        throw DecodingError.dataCorrupted(.init(
            codingPath: decoder.codingPath,
            debugDescription: "Unknown declarative operator policy keys: \(unknown.joined(separator: ", "))."))
    }
}

public struct ContestOperatorSignalProfile: Codable, Hashable, Sendable {
    public let mode: String
    public let signal: ContestOperatorSignalKind

    public init(mode: String, signal: ContestOperatorSignalKind) {
        self.mode = mode
        self.signal = signal
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case mode, signal
    }

    public init(from decoder: Decoder) throws {
        try rejectUnknownOperatorPolicyKeys(from: decoder, allowedBy: CodingKeys.self)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        mode = try values.decode(String.self, forKey: .mode)
        signal = try values.decode(ContestOperatorSignalKind.self, forKey: .signal)
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(mode, forKey: .mode)
        try values.encode(signal, forKey: .signal)
    }
}

/// A finite policy embedded in a canonical declarative contest definition. Unknown
/// identifiers and versions fail decoding instead of becoming an inert nil policy.
public struct ContestDeclarativeOperatorPolicy: Codable, Hashable, Sendable {
    public static let version = 1
    public static let policy = "simulated-run-sp-v1"
    public static let output = "simulation-only"

    public let version: Int
    public let policy: String
    public let output: String
    public let signalProfiles: [ContestOperatorSignalProfile]

    public init(signalProfiles: [ContestOperatorSignalProfile]) {
        version = Self.version
        policy = Self.policy
        output = Self.output
        self.signalProfiles = signalProfiles
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case version, policy, output, signalProfiles
    }

    public init(from decoder: Decoder) throws {
        try rejectUnknownOperatorPolicyKeys(from: decoder, allowedBy: CodingKeys.self)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let version = try values.decode(Int.self, forKey: .version)
        let policy = try values.decode(String.self, forKey: .policy)
        let output = try values.decode(String.self, forKey: .output)
        guard version == Self.version, policy == Self.policy, output == Self.output else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Unknown declarative operator policy or version."))
        }
        self.version = version
        self.policy = policy
        self.output = output
        signalProfiles = try values.decode([ContestOperatorSignalProfile].self, forKey: .signalProfiles)
    }
}

public struct ContestOperatorCapability: Codable, Hashable, Sendable {
    public static let version = 1
    public static let policy = "simulated-run-sp-v1"

    public let version: Int
    public let auditDigest: String
    public let policy: String
    public let output: String
    public let styles: [ContestOperatorStyle]
    public let macros: [ContestOperatorMacroRole]
    public let signalProfiles: [ContestOperatorSignalProfile]?

    public init(version: Int, auditDigest: String, policy: String, output: String,
                styles: [ContestOperatorStyle], macros: [ContestOperatorMacroRole],
                signalProfiles: [ContestOperatorSignalProfile]? = nil) {
        self.version = version
        self.auditDigest = auditDigest
        self.policy = policy
        self.output = output
        self.styles = styles
        self.macros = macros
        self.signalProfiles = signalProfiles
    }
}

public enum ContestOperatorFieldState: String, Codable, Hashable, Sendable {
    case empty
    case ready
    case blocked
}

public struct ContestOperatorReadiness: Codable, Hashable, Sendable {
    public let capabilityDigest: String
    public let callsign: ContestOperatorFieldState
    public let exchange: ContestOperatorFieldState
    public let canSendCQ: Bool
    public let canSendCall: Bool
    public let canSendDuplicate: Bool
    public let canReserveCall: Bool
    public let canReserveCommit: Bool
    public let canCommit: Bool
}

/// Explicit opt-in for the bounded, visible-output-only Run/S&P operator flow.
/// Rules outside this protocol remain unavailable even when their entry descriptor
/// happens to have a compatible shape.
public protocol ContestOperatorCapableRule: ContestRule {}

private struct ContestOperatorCapabilityDigestMaterial: Codable {
    let version: Int
    let policy: String
    let identity: ContestRuleIdentity
    let entry: ContestEntryDescriptor
}

public extension ContestOperatorCapableRule {
    func operatorCapability() throws -> ContestOperatorCapability {
        let material = ContestOperatorCapabilityDigestMaterial(
            version: ContestOperatorCapability.version,
            policy: ContestOperatorCapability.policy,
            identity: metadata.identity,
            entry: metadata.entry)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let digest = ContestSCPIndex.sha256(try encoder.encode(material))
        return .init(version: ContestOperatorCapability.version, auditDigest: digest,
                     policy: ContestOperatorCapability.policy, output: "simulation-only",
                     styles: [.run, .searchAndPounce],
                     macros: [.cq, .exchange, .qrz, .again, .hisCall, .myCall, .qsoBefore])
    }

    func operatorReadiness(for qso: ContestQSO, validation: [ContestValidationIssue],
                           duplicate: Bool?, hasReservation: Bool) throws -> ContestOperatorReadiness {
        let capability = try operatorCapability()
        return makeOperatorReadiness(capability: capability, qso: qso, entry: metadata.entry,
                                     validation: validation, duplicate: duplicate,
                                     hasReservation: hasReservation,
                                     requireDeclaredStructuredFields: false)
    }

    func partialDraftDupeKey(for qso: ContestQSO, in session: ContestSessionSnapshot,
                             validation: [ContestValidationIssue]) -> String? {
        guard !qso.callsign.isEmpty, validation.filter({ $0.severity == .error }).allSatisfy({
            operatorIssueIsMissingInput($0, qso: qso, entry: metadata.entry,
                                        allowBlankCall: false, allowMissingReceived: true,
                                        allowMissingSerial: true,
                                        requireDeclaredStructuredFields: false)
        }) else { return nil }
        return evaluate(qso, in: session).dupeKey
    }
}

/// Resolves the unchanged legacy opt-in and the policy stored in a declarative
/// definition through one runtime seam. A compatible entry shape alone is inert.
public enum ContestOperatorProjection {
    public static func capability(for rule: any ContestRule) throws -> ContestOperatorCapability? {
        if let legacy = rule as? any ContestOperatorCapableRule {
            return try legacy.operatorCapability()
        }
        guard let declarative = rule as? DeclarativeContestRule,
              let operatorPolicy = declarative.definition.draft.operatorPolicy else { return nil }
        return .init(version: ContestOperatorCapability.version,
                     auditDigest: declarative.definition.definitionDigest,
                     policy: ContestOperatorCapability.policy, output: "simulation-only",
                     styles: [.run, .searchAndPounce],
                     macros: [.cq, .exchange, .qrz, .again, .hisCall, .myCall, .qsoBefore],
                     signalProfiles: operatorPolicy.signalProfiles)
    }

    public static func readiness(for rule: any ContestRule, qso: ContestQSO,
                                 validation: [ContestValidationIssue], duplicate: Bool?,
                                 hasReservation: Bool) throws -> ContestOperatorReadiness? {
        guard let capability = try capability(for: rule) else { return nil }
        return makeOperatorReadiness(capability: capability, qso: qso, entry: rule.metadata.entry,
                                     validation: validation, duplicate: duplicate,
                                     hasReservation: hasReservation,
                                     requireDeclaredStructuredFields: rule is DeclarativeContestRule)
    }

    public static func partialDraftDupeKey(for rule: any ContestRule, qso: ContestQSO,
                                           session: ContestSessionSnapshot,
                                           validation: [ContestValidationIssue]) -> String? {
        guard (try? capability(for: rule)) != nil, !qso.callsign.isEmpty,
              validation.filter({ $0.severity == .error }).allSatisfy({
            operatorIssueIsMissingInput($0, qso: qso, entry: rule.metadata.entry,
                                        allowBlankCall: false, allowMissingReceived: true,
                                        allowMissingSerial: true,
                                        requireDeclaredStructuredFields: rule is DeclarativeContestRule)
        }) else { return nil }
        return rule.evaluate(qso, in: session).dupeKey
    }
}

private func makeOperatorReadiness(capability: ContestOperatorCapability, qso: ContestQSO,
                                   entry: ContestEntryDescriptor, validation: [ContestValidationIssue],
                                   duplicate: Bool?, hasReservation: Bool,
                                   requireDeclaredStructuredFields: Bool) -> ContestOperatorReadiness {
    let errors = validation.filter { $0.severity == .error }
    let callEmpty = qso.callsign.isEmpty
    let missingReceived = operatorReceivedExchangeIsIncomplete(qso, entry: entry)
    let blankReady = callEmpty && errors.allSatisfy {
        operatorIssueIsMissingInput($0, qso: qso, entry: entry,
                                    allowBlankCall: true, allowMissingReceived: true,
                                    allowMissingSerial: true,
                                    requireDeclaredStructuredFields: requireDeclaredStructuredFields)
    }
    let callReady = !callEmpty && duplicate != nil && errors.allSatisfy {
        operatorIssueIsMissingInput($0, qso: qso, entry: entry,
                                    allowBlankCall: false, allowMissingReceived: true,
                                    allowMissingSerial: true,
                                    requireDeclaredStructuredFields: requireDeclaredStructuredFields)
    }
    let exchangeBlocked = errors.contains {
        operatorIssueTargetsReceivedExchange($0) &&
            !operatorIssueIsMissingInput($0, qso: qso, entry: entry,
                                         allowBlankCall: false, allowMissingReceived: true,
                                         allowMissingSerial: false,
                                         requireDeclaredStructuredFields: requireDeclaredStructuredFields)
    }
    let serialRequired = entry.serial.requirement == .requiredForCommit
    let duplicateClear = duplicate == false
    let reserveCall = serialRequired && !hasReservation && callReady && duplicateClear && errors.allSatisfy {
        operatorIssueIsMissingInput($0, qso: qso, entry: entry,
                                    allowBlankCall: false, allowMissingReceived: true,
                                    allowMissingSerial: true,
                                    requireDeclaredStructuredFields: requireDeclaredStructuredFields)
    }
    let reserveCommit = serialRequired && !hasReservation && duplicateClear && errors.allSatisfy {
        operatorIssueIsMissingInput($0, qso: qso, entry: entry,
                                    allowBlankCall: false, allowMissingReceived: false,
                                    allowMissingSerial: true,
                                    requireDeclaredStructuredFields: requireDeclaredStructuredFields)
    }
    return .init(capabilityDigest: capability.auditDigest,
                 callsign: callEmpty ? .empty : (callReady ? .ready : .blocked),
                 exchange: missingReceived ? .empty : (exchangeBlocked ? .blocked : .ready),
                 canSendCQ: blankReady, canSendCall: callReady && duplicateClear,
                 canSendDuplicate: callReady && duplicate == true,
                 canReserveCall: reserveCall, canReserveCommit: reserveCommit,
                 canCommit: errors.isEmpty && duplicateClear)
}

private func operatorReceivedExchangeIsIncomplete(_ qso: ContestQSO,
                                                   entry: ContestEntryDescriptor) -> Bool {
    if entry.version == .v1 { return qso.exchange.rawReceived.isEmpty }
    return entry.exchange.receivedFields.contains {
        $0.required && (qso.exchange.receivedFields[$0.id]?.raw.isEmpty != false)
    }
}

private func operatorIssueTargetsReceivedExchange(_ issue: ContestValidationIssue) -> Bool {
    issue.field == "exchange.received" || issue.field.hasPrefix("exchange.received.") ||
        issue.field.hasPrefix("received.")
}

private func operatorIssueIsMissingInput(_ issue: ContestValidationIssue, qso: ContestQSO,
                                         entry: ContestEntryDescriptor, allowBlankCall: Bool,
                                         allowMissingReceived: Bool, allowMissingSerial: Bool,
                                         requireDeclaredStructuredFields: Bool) -> Bool {
    if allowBlankCall && qso.callsign.isEmpty {
        let callIssues: Set<String> = ["invalidCallsign", "invalidWPXPrefix", "invalidScandinavianCallArea"]
        let geographyIssues: Set<String> = ["invalidEntity", "unknownEntity", "invalidEndpointRole"]
        if issue.field == "callsign", callIssues.contains(issue.code) { return true }
        if issue.field == "entity", geographyIssues.contains(issue.code) { return true }
    }
    if allowMissingSerial && entry.serial.requirement == .requiredForCommit {
        if entry.version == .v1, qso.exchange.rawSent.isEmpty,
           issue.field == "exchange.sent", issue.code == "invalidSentSerial" { return true }
        if let serial = entry.allocatedSerialField,
           issue.field == "exchange.sent.\(serial.id)",
           ["missingStructuredExchangeField", "invalidStructuredExchangeField"].contains(issue.code) {
            let value = qso.exchange.sentFields[serial.id]
            if value == nil || (value?.raw.isEmpty == true && value?.normalized.isEmpty == true) { return true }
        }
    }
    guard allowMissingReceived, operatorIssueTargetsReceivedExchange(issue) else { return false }
    let allowedCodes: Set<String> = [
        "invalidCQZone", "invalidReceivedSerial", "invalidExchangeShape",
        "missingStructuredExchangeField", "invalidStructuredExchangeField",
        "missingNAQPName", "invalidNAQPLocation", "invalidDXLocation", "invalidMultiplierLocation",
        "invalidReceivedPower", "invalidReceivedLocation",
    ]
    guard allowedCodes.contains(issue.code) else { return false }
    if issue.field == "exchange.received" {
        if !requireDeclaredStructuredFields {
            return qso.exchange.rawReceived.isEmpty &&
                qso.exchange.receivedFields.values.allSatisfy { $0.raw.isEmpty }
        }
        return qso.exchange.rawReceived.isEmpty && qso.exchange.normalizedReceived.isEmpty &&
            qso.exchange.receivedFields.values.allSatisfy { $0.raw.isEmpty && $0.normalized.isEmpty }
    }
    if !requireDeclaredStructuredFields {
        let fieldID = issue.field.split(separator: ".").last.map(String.init) ?? ""
        return qso.exchange.receivedFields[fieldID]?.raw.isEmpty != false
    }
    guard let descriptor = entry.exchange.receivedFields.first(where: {
        $0.required && issue.field == "exchange.received.\($0.id)"
    }) else {
        return false
    }
    guard let value = qso.exchange.receivedFields[descriptor.id] else { return true }
    return value.raw.isEmpty && value.normalized.isEmpty
}

