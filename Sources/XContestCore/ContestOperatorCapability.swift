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

public struct ContestOperatorCapability: Codable, Hashable, Sendable {
    public static let version = 1
    public static let policy = "simulated-run-sp-v1"

    public let version: Int
    public let auditDigest: String
    public let policy: String
    public let output: String
    public let styles: [ContestOperatorStyle]
    public let macros: [ContestOperatorMacroRole]
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
        let errors = validation.filter { $0.severity == .error }
        let callEmpty = qso.callsign.isEmpty
        let missingReceived = operatorReceivedExchangeIsIncomplete(qso, entry: metadata.entry)
        let blankReady = callEmpty && errors.allSatisfy {
            operatorIssueIsMissingInput($0, qso: qso, entry: metadata.entry,
                                        allowBlankCall: true, allowMissingReceived: true,
                                        allowMissingSerial: true)
        }
        let callReady = !callEmpty && duplicate != nil && errors.allSatisfy {
            operatorIssueIsMissingInput($0, qso: qso, entry: metadata.entry,
                                        allowBlankCall: false, allowMissingReceived: true,
                                        allowMissingSerial: true)
        }
        let exchangeBlocked = errors.contains {
            operatorIssueTargetsReceivedExchange($0) &&
                !operatorIssueIsMissingInput($0, qso: qso, entry: metadata.entry,
                                             allowBlankCall: false, allowMissingReceived: true,
                                             allowMissingSerial: false)
        }
        let serialRequired = metadata.entry.serial.requirement == .requiredForCommit
        let duplicateClear = duplicate == false
        let reserveCall = serialRequired && !hasReservation && callReady && duplicateClear && errors.allSatisfy {
            operatorIssueIsMissingInput($0, qso: qso, entry: metadata.entry,
                                        allowBlankCall: false, allowMissingReceived: true,
                                        allowMissingSerial: true)
        }
        let reserveCommit = serialRequired && !hasReservation && duplicateClear && errors.allSatisfy {
            operatorIssueIsMissingInput($0, qso: qso, entry: metadata.entry,
                                        allowBlankCall: false, allowMissingReceived: false,
                                        allowMissingSerial: true)
        }
        return .init(capabilityDigest: capability.auditDigest,
                     callsign: callEmpty ? .empty : (callReady ? .ready : .blocked),
                     exchange: missingReceived ? .empty : (exchangeBlocked ? .blocked : .ready),
                     canSendCQ: blankReady,
                     canSendCall: callReady && duplicateClear,
                     canSendDuplicate: callReady && duplicate == true,
                     canReserveCall: reserveCall, canReserveCommit: reserveCommit,
                     canCommit: errors.isEmpty && duplicateClear)
    }

    func partialDraftDupeKey(for qso: ContestQSO, in session: ContestSessionSnapshot,
                             validation: [ContestValidationIssue]) -> String? {
        guard !qso.callsign.isEmpty, validation.filter({ $0.severity == .error }).allSatisfy({
            operatorIssueIsMissingInput($0, qso: qso, entry: metadata.entry,
                                        allowBlankCall: false, allowMissingReceived: true,
                                        allowMissingSerial: true)
        }) else { return nil }
        return evaluate(qso, in: session).dupeKey
    }
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
                                         allowMissingReceived: Bool, allowMissingSerial: Bool) -> Bool {
    if allowBlankCall && qso.callsign.isEmpty {
        let callIssues: Set<String> = ["invalidCallsign", "invalidWPXPrefix", "invalidScandinavianCallArea"]
        let geographyIssues: Set<String> = ["invalidEntity", "unknownEntity", "invalidEndpointRole"]
        if issue.field == "callsign", callIssues.contains(issue.code) { return true }
        if issue.field == "entity", geographyIssues.contains(issue.code) { return true }
    }
    if allowMissingSerial && entry.serial.requirement == .requiredForCommit &&
        qso.exchange.rawSent.isEmpty && issue.field == "exchange.sent" && issue.code == "invalidSentSerial" {
        return true
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
        return qso.exchange.rawReceived.isEmpty && qso.exchange.receivedFields.values.allSatisfy { $0.raw.isEmpty }
    }
    let fieldID = issue.field.split(separator: ".").last.map(String.init) ?? ""
    return qso.exchange.receivedFields[fieldID]?.raw.isEmpty != false
}

