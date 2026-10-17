import Foundation

public enum ContestReportFormat: String, Codable, Hashable, Sendable {
    case cwRST
    case phoneRS
}

public struct ContestReportDescriptor: Codable, Hashable, Sendable {
    public let format: ContestReportFormat
    public let defaultSent: String
    public let defaultReceived: String
    public let maximumUTF8Bytes: Int

    public init(format: ContestReportFormat, defaultSent: String, defaultReceived: String,
                maximumUTF8Bytes: Int) {
        self.format = format
        self.defaultSent = defaultSent
        self.defaultReceived = defaultReceived
        self.maximumUTF8Bytes = maximumUTF8Bytes
    }

    public func accepts(_ value: String) -> Bool {
        guard value.utf8.count <= maximumUTF8Bytes else { return false }
        switch format {
        case .cwRST:
            return value.range(of: #"^[1-5][1-9][1-9]$"#, options: .regularExpression) != nil
        case .phoneRS:
            return value.range(of: #"^[1-5][1-9]$"#, options: .regularExpression) != nil
        }
    }
}

public enum ContestExchangeFormat: String, Codable, Hashable, Sendable {
    case cqZone
    case serialNumber
}

public enum ContestSentExchangeDefault: String, Codable, Hashable, Sendable {
    case stationSnapshot
    case reservedSerial
}

public enum ContestADIFExchangeFields: String, Codable, Hashable, Sendable {
    case none
    case stxSrx
    case exchangeStrings
}

public struct ContestExchangeDescriptor: Codable, Hashable, Sendable {
    public let sent: ContestExchangeFormat
    public let received: ContestExchangeFormat
    public let sentDefault: ContestSentExchangeDefault
    public let adifFields: ContestADIFExchangeFields

    public init(sent: ContestExchangeFormat, received: ContestExchangeFormat,
                sentDefault: ContestSentExchangeDefault, adifFields: ContestADIFExchangeFields) {
        self.sent = sent
        self.received = received
        self.sentDefault = sentDefault
        self.adifFields = adifFields
    }
}

public enum ContestSerialRequirement: String, Codable, Hashable, Sendable {
    case none
    case requiredForCommit
}

public struct ContestSerialDescriptor: Codable, Hashable, Sendable {
    public let requirement: ContestSerialRequirement
    public let allowedScopes: [ContestSerialScope]

    public init(requirement: ContestSerialRequirement, allowedScopes: [ContestSerialScope]) {
        self.requirement = requirement
        self.allowedScopes = allowedScopes
    }
}

public struct ContestEntryDescriptor: Codable, Hashable, Sendable {
    public let mode: String
    public let adifMode: String
    public let cabrilloQSOType: String
    public let cabrilloFormatterVersion: String
    public let cabrilloProjectionFormatterVersion: String
    public let report: ContestReportDescriptor
    public let exchange: ContestExchangeDescriptor
    public let serial: ContestSerialDescriptor

    public init(mode: String, adifMode: String, cabrilloQSOType: String,
                cabrilloFormatterVersion: String, cabrilloProjectionFormatterVersion: String,
                report: ContestReportDescriptor,
                exchange: ContestExchangeDescriptor, serial: ContestSerialDescriptor) {
        self.mode = mode
        self.adifMode = adifMode
        self.cabrilloQSOType = cabrilloQSOType
        self.cabrilloFormatterVersion = cabrilloFormatterVersion
        self.cabrilloProjectionFormatterVersion = cabrilloProjectionFormatterVersion
        self.report = report
        self.exchange = exchange
        self.serial = serial
    }

    public func isCoherent(supportedModes: Set<String>) -> Bool {
        let modeAndReport: Bool
        switch (mode, adifMode, cabrilloQSOType, cabrilloFormatterVersion,
                cabrilloProjectionFormatterVersion, report.format, report.maximumUTF8Bytes) {
        case ("CW", "CW", "CW", "pilot-1", "pilot-2", .cwRST, 3),
             ("SSB", "SSB", "PH", "ssb-pilot-1", "ssb-pilot-2", .phoneRS, 2): modeAndReport = true
        default: modeAndReport = false
        }
        let exchangeAndSerial: Bool
        switch (exchange.sent, exchange.received, exchange.sentDefault, exchange.adifFields, serial.requirement) {
        case (.cqZone, .cqZone, .stationSnapshot, .none, .none):
            exchangeAndSerial = serial.allowedScopes.isEmpty
        case (.serialNumber, .serialNumber, .reservedSerial, .stxSrx, .requiredForCommit),
             (.serialNumber, .serialNumber, .reservedSerial, .exchangeStrings, .requiredForCommit):
            exchangeAndSerial = !serial.allowedScopes.isEmpty &&
                Set(serial.allowedScopes).count == serial.allowedScopes.count
        default:
            exchangeAndSerial = false
        }
        return supportedModes == [mode] && modeAndReport && exchangeAndSerial &&
            report.accepts(report.defaultSent) && report.accepts(report.defaultReceived)
    }
}

public struct ContestRuleMetadata: Codable, Hashable, Sendable {
    public let identity: ContestRuleIdentity
    public let displayName: String
    public let cabrilloName: String
    public let supportedBands: Set<String>
    public let supportedModes: Set<String>
    public let entry: ContestEntryDescriptor
    public let sourceProvenance: String

    public init(identity: ContestRuleIdentity, displayName: String, cabrilloName: String,
                supportedBands: Set<String>, supportedModes: Set<String>,
                entry: ContestEntryDescriptor, sourceProvenance: String) {
        self.identity = identity
        self.displayName = displayName
        self.cabrilloName = cabrilloName
        self.supportedBands = supportedBands
        self.supportedModes = supportedModes
        self.entry = entry
        self.sourceProvenance = sourceProvenance
    }
}

public struct ContestRuleEvaluation: Sendable {
    public let validation: [ContestValidationIssue]
    public let dupeKey: String?
    public let points: Int64
    public let multiplierCandidates: Set<ContestMultiplierKey>

    public init(validation: [ContestValidationIssue], dupeKey: String?, points: Int64,
                multiplierCandidates: Set<ContestMultiplierKey>) {
        self.validation = validation
        self.dupeKey = dupeKey
        self.points = points
        self.multiplierCandidates = multiplierCandidates
    }
}

public protocol ContestRule: Sendable {
    var metadata: ContestRuleMetadata { get }
    func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation
    func cabrilloReceivedExchange(for qso: ContestQSO) -> String
}

public enum ContestQSODisposition: String, Codable, Sendable { case accepted, duplicate, invalid }

public struct ContestScoredQSO: Codable, Hashable, Sendable {
    public let qsoID: UUID
    public let disposition: ContestQSODisposition
    public let issues: [ContestValidationIssue]
    public let dupeKey: String?
    public let points: Int64
    public let newMultipliers: [ContestMultiplierKey]
}

public struct ContestScore: Codable, Hashable, Sendable {
    public let qsos: [ContestScoredQSO]
    public let totalPoints: Int64
    public let multiplierCount: Int64
    public let claimedScore: Int64
}

public enum ContestEvaluationError: Error, Equatable {
    case ruleMismatch(expected: ContestRuleIdentity, actual: ContestRuleIdentity)
    case wrongSession(qsoID: UUID)
    case duplicateQSOID(UUID)
    case invalidTimestamp(qsoID: UUID)
    case arithmeticOverflow
}

public enum ContestEngine {
    public static func score(_ qsos: [ContestQSO], session: ContestSessionSnapshot,
                             rule: any ContestRule) throws -> ContestScore {
        guard session.rule == rule.metadata.identity else {
            throw ContestEvaluationError.ruleMismatch(expected: session.rule, actual: rule.metadata.identity)
        }
        var identities = Set<UUID>()
        for qso in qsos {
            guard identities.insert(qso.id).inserted else { throw ContestEvaluationError.duplicateQSOID(qso.id) }
            guard qso.timestampUTC.timeIntervalSinceReferenceDate.isFinite else {
                throw ContestEvaluationError.invalidTimestamp(qsoID: qso.id)
            }
        }
        let ordered = qsos.sorted {
            if $0.timestampUTC != $1.timestampUTC { return $0.timestampUTC < $1.timestampUTC }
            return $0.id.uuidString < $1.id.uuidString
        }
        var seenDupes = Set<String>()
        var seenMultipliers = Set<ContestMultiplierKey>()
        var scored: [ContestScoredQSO] = []
        var totalPoints: Int64 = 0

        for qso in ordered {
            guard qso.sessionID == session.id else { throw ContestEvaluationError.wrongSession(qsoID: qso.id) }
            let evaluation = rule.evaluate(qso, in: session)
            let invalid = evaluation.validation.contains { $0.severity == .error }
            let duplicate = !invalid && evaluation.dupeKey.map { seenDupes.contains($0) } == true
            let disposition: ContestQSODisposition = invalid ? .invalid : duplicate ? .duplicate : .accepted
            var newMultipliers: [ContestMultiplierKey] = []
            var awardedPoints: Int64 = 0
            if disposition == .accepted {
                if let key = evaluation.dupeKey { seenDupes.insert(key) }
                awardedPoints = evaluation.points
                let sum = totalPoints.addingReportingOverflow(awardedPoints)
                guard !sum.overflow else { throw ContestEvaluationError.arithmeticOverflow }
                totalPoints = sum.partialValue
                newMultipliers = evaluation.multiplierCandidates.filter { seenMultipliers.insert($0).inserted }.sorted()
            }
            scored.append(ContestScoredQSO(qsoID: qso.id, disposition: disposition,
                                           issues: evaluation.validation, dupeKey: evaluation.dupeKey,
                                           points: awardedPoints, newMultipliers: newMultipliers))
        }
        let multiplierCount = Int64(seenMultipliers.count)
        let product = totalPoints.multipliedReportingOverflow(by: multiplierCount)
        guard !product.overflow else { throw ContestEvaluationError.arithmeticOverflow }
        return ContestScore(qsos: scored, totalPoints: totalPoints,
                            multiplierCount: multiplierCount, claimedScore: product.partialValue)
    }
}

public struct ContestRuleRegistry: Sendable {
    private let rules: [ContestRuleIdentity: any ContestRule]

    public init(_ rules: [any ContestRule]) {
        self.rules = Dictionary(uniqueKeysWithValues: rules.map { ($0.metadata.identity, $0) })
    }

    public func rule(for identity: ContestRuleIdentity) -> (any ContestRule)? { rules[identity] }
    public var metadata: [ContestRuleMetadata] {
        rules.values.map(\.metadata).sorted {
            ($0.identity.id, $0.identity.version, $0.identity.edition, $0.identity.sourceRevision) <
            ($1.identity.id, $1.identity.version, $1.identity.edition, $1.identity.sourceRevision)
        }
    }

    public static let pilots = ContestRuleRegistry([
        CQWWCWRule(), CQWPXCWRule(), CQWWSSBRule(), CQWPXSSBRule(),
        OceaniaDXCWRule(), OceaniaDXSSBRule(), SACCWRule(), SACSSBRule(),
    ])
}
