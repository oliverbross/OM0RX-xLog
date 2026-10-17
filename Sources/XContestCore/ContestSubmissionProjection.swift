import Foundation

public enum ContestSubmissionAssistance: String, Codable, Hashable, Sendable {
    case assisted = "ASSISTED"
    case nonAssisted = "NON-ASSISTED"
}

public enum ContestSubmissionPower: String, Codable, Hashable, Sendable {
    case high = "HIGH"
    case low = "LOW"
    case qrp = "QRP"
}

public enum ContestSubmissionBand: Codable, Hashable, Sendable {
    case all
    case single(String)
}

public struct ContestSubmissionCategory: Codable, Hashable, Sendable {
    public let assistance: ContestSubmissionAssistance
    public let power: ContestSubmissionPower
    public let band: ContestSubmissionBand
}

public struct ContestSubmissionProjection: Codable, Hashable, Sendable {
    public let category: ContestSubmissionCategory
    public let renderedQSOs: [ContestQSO]
    public let score: ContestScore

    /// This preview intentionally supports only SINGLE-OP CW, no overlay, one transmitter,
    /// the declared assistance/power enums, and ALL or one rule-supported band.
    public static func make(qsos: [ContestQSO], session: ContestSessionSnapshot,
                            header: CabrilloHeader, rule: any ContestRule) throws -> Self {
        let fullScore: ContestScore
        do { fullScore = try ContestEngine.score(qsos, session: session, rule: rule) }
        catch let error as ContestEvaluationError {
            throw ContestSubmissionProjectionError.invalidContacts(error)
        }
        if let invalid = fullScore.qsos.first(where: { $0.disposition == .invalid }) {
            throw ContestSubmissionProjectionError.semanticInvalidQSO(invalid.qsoID)
        }

        let category = try previewCategory(header: header, rule: rule)
        let eligible: [ContestQSO]
        switch category.band {
        case .all: eligible = qsos
        case let .single(band): eligible = qsos.filter { $0.band == band }
        }
        let score: ContestScore
        if case .all = category.band {
            score = fullScore
        } else {
            do { score = try ContestEngine.score(eligible, session: session, rule: rule) }
            catch let error as ContestEvaluationError {
                throw ContestSubmissionProjectionError.invalidContacts(error)
            }
        }
        return Self(category: category, renderedQSOs: qsos.sorted(by: deterministicOrder), score: score)
    }

    private static func previewCategory(header: CabrilloHeader,
                                        rule: any ContestRule) throws -> ContestSubmissionCategory {
        guard header.categoryOperator == "SINGLE-OP" else {
            throw ContestSubmissionProjectionError.unsupportedCategory(field: "categoryOperator",
                                                                         value: header.categoryOperator)
        }
        guard header.categoryMode == "CW" else {
            throw ContestSubmissionProjectionError.unsupportedCategory(field: "categoryMode",
                                                                         value: header.categoryMode)
        }
        guard header.categoryTransmitter == "ONE" else {
            throw ContestSubmissionProjectionError.unsupportedCategory(field: "categoryTransmitter",
                                                                         value: header.categoryTransmitter)
        }
        guard header.categoryOverlay?.isEmpty != false else {
            throw ContestSubmissionProjectionError.unsupportedCategory(field: "categoryOverlay",
                                                                         value: header.categoryOverlay ?? "")
        }
        guard let assistance = ContestSubmissionAssistance(rawValue: header.categoryAssisted) else {
            throw ContestSubmissionProjectionError.unsupportedCategory(field: "categoryAssisted",
                                                                         value: header.categoryAssisted)
        }
        guard let power = ContestSubmissionPower(rawValue: header.categoryPower) else {
            throw ContestSubmissionProjectionError.unsupportedCategory(field: "categoryPower",
                                                                         value: header.categoryPower)
        }
        let token = header.categoryBand.uppercased()
        let band: ContestSubmissionBand
        if token == "ALL" {
            band = .all
        } else {
            let normalized = token.lowercased()
            guard rule.metadata.supportedBands.contains(normalized) else {
                throw ContestSubmissionProjectionError.unsupportedCategory(field: "categoryBand", value: token)
            }
            band = .single(normalized)
        }
        return ContestSubmissionCategory(assistance: assistance, power: power, band: band)
    }

    private static func deterministicOrder(_ lhs: ContestQSO, _ rhs: ContestQSO) -> Bool {
        if lhs.timestampUTC != rhs.timestampUTC { return lhs.timestampUTC < rhs.timestampUTC }
        return lhs.id.uuidString < rhs.id.uuidString
    }
}

public enum ContestSubmissionProjectionError: Error, Equatable {
    case unsupportedCategory(field: String, value: String)
    case semanticInvalidQSO(UUID)
    case invalidContacts(ContestEvaluationError)
}
