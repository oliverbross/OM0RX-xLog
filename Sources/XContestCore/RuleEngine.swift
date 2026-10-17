import Foundation

public struct ContestRuleMetadata: Codable, Hashable, Sendable {
    public let identity: ContestRuleIdentity
    public let displayName: String
    public let cabrilloName: String
    public let supportedBands: Set<String>
    public let supportedModes: Set<String>
    public let sourceProvenance: String

    public init(identity: ContestRuleIdentity, displayName: String, cabrilloName: String,
                supportedBands: Set<String>, supportedModes: Set<String>, sourceProvenance: String) {
        self.identity = identity
        self.displayName = displayName
        self.cabrilloName = cabrilloName
        self.supportedBands = supportedBands
        self.supportedModes = supportedModes
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

    public static let pilots = ContestRuleRegistry([CQWWCWRule(), CQWPXCWRule()])
}
