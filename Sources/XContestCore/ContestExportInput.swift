import Foundation

public struct ContestExportMetadata: Codable, Hashable, Sendable {
    public let sessionName: String
    public let operatorCallsign: String
    public let operatorCategory: String
    public let cabrilloHeader: CabrilloHeader

    public init(sessionName: String, operatorCallsign: String, operatorCategory: String,
                cabrilloHeader: CabrilloHeader) {
        self.sessionName = sessionName
        self.operatorCallsign = operatorCallsign.uppercased()
        self.operatorCategory = operatorCategory
        self.cabrilloHeader = cabrilloHeader
    }
}

/// Immutable input for deterministic contest formatters. The store integration is responsible
/// for obtaining all fields from one atomic read snapshot before constructing this value.
public struct ContestExportInput: Codable, Hashable, Sendable {
    public static let currentSchemaVersion = "1"
    /// Frozen source-preview behavior used by existing callers and ADIF export.
    public static let legacyFormatterVersion = "pilot-1"
    /// Cabrillo preview policy that projects a single-band claim while retaining the complete valid log.
    public static let submissionProjectionFormatterVersion = "pilot-2"

    public let schemaVersion: String
    public let formatterVersion: String
    public let generatedAtUTC: Date
    public let sessionRevision: UInt64
    public let session: ContestSessionSnapshot
    public let ruleIdentity: ContestRuleIdentity
    public let referenceDataVersion: String
    public let metadata: ContestExportMetadata
    public let qsos: [ContestQSO]

    public init(schemaVersion: String = Self.currentSchemaVersion,
                formatterVersion: String = Self.legacyFormatterVersion,
                generatedAtUTC: Date, sessionRevision: UInt64,
                session: ContestSessionSnapshot, ruleIdentity: ContestRuleIdentity,
                referenceDataVersion: String, metadata: ContestExportMetadata,
                qsos: [ContestQSO]) {
        self.schemaVersion = schemaVersion
        self.formatterVersion = formatterVersion
        self.generatedAtUTC = generatedAtUTC
        self.sessionRevision = sessionRevision
        self.session = session
        self.ruleIdentity = ruleIdentity
        self.referenceDataVersion = referenceDataVersion
        self.metadata = metadata
        self.qsos = qsos
    }

    public func validatedScore(rule: any ContestRule) throws -> ContestScore {
        let validated = try validatedCommon(rule: rule)
        switch formatterVersion {
        case Self.legacyFormatterVersion:
            let categoryBand = metadata.cabrilloHeader.categoryBand.uppercased()
            if categoryBand != "ALL" {
                let expectedBand = categoryBand.lowercased()
                guard rule.metadata.supportedBands.contains(expectedBand),
                      qsos.allSatisfy({ $0.band == expectedBand }) else {
                    throw ContestExportInputError.metadataMismatch
                }
            }
            return validated
        case Self.submissionProjectionFormatterVersion:
            return try validatedProjectionAfterCommonValidation(rule: rule).score
        default:
            throw ContestExportInputError.unsupportedFormatter(formatterVersion)
        }
    }

    public func validatedProjection(rule: any ContestRule) throws -> ContestSubmissionProjection {
        guard formatterVersion == Self.submissionProjectionFormatterVersion else {
            throw ContestExportInputError.unsupportedFormatter(formatterVersion)
        }
        _ = try validatedCommon(rule: rule)
        return try validatedProjectionAfterCommonValidation(rule: rule)
    }

    private func validatedCommon(rule: any ContestRule) throws -> ContestScore {
        guard schemaVersion == Self.currentSchemaVersion else { throw ContestExportInputError.unsupportedSchema(schemaVersion) }
        guard formatterVersion == Self.legacyFormatterVersion ||
                formatterVersion == Self.submissionProjectionFormatterVersion else {
            throw ContestExportInputError.unsupportedFormatter(formatterVersion)
        }
        guard ruleIdentity == session.rule, ruleIdentity == rule.metadata.identity else {
            throw ContestExportInputError.ruleMismatch
        }
        guard referenceDataVersion == session.referenceDataVersion,
              !referenceDataVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ContestExportInputError.referenceDataMismatch
        }
        guard generatedAtUTC.timeIntervalSinceReferenceDate.isFinite,
              session.startedAt.timeIntervalSinceReferenceDate.isFinite,
              session.endedAt?.timeIntervalSinceReferenceDate.isFinite != false,
              session.endedAt.map({ $0 >= session.startedAt }) != false else {
            throw ContestExportInputError.invalidTimestamp
        }
        guard validText(metadata.sessionName), validText(metadata.operatorCategory),
              validText(metadata.operatorCallsign), !metadata.sessionName.isEmpty,
              metadata.cabrilloHeader.callsign == session.station.callsign,
              metadata.operatorCategory == metadata.cabrilloHeader.categoryOperator,
              metadata.cabrilloHeader.categoryMode == "CW" else {
            throw ContestExportInputError.metadataMismatch
        }
        let stationOperators = Set(session.station.operatorCallsigns)
        let allowedOperators = stationOperators.union([session.station.callsign, metadata.operatorCallsign])
        let suppliedOperators = Set(metadata.cabrilloHeader.operators)
        let usedOperators = Set(qsos.compactMap { $0.operatorCallsign.isEmpty ? nil : $0.operatorCallsign })
            .union([metadata.operatorCallsign])
        guard metadata.operatorCallsign == session.station.callsign || stationOperators.contains(metadata.operatorCallsign),
              usedOperators.isSubset(of: suppliedOperators),
              suppliedOperators.isSubset(of: allowedOperators),
              qsos.allSatisfy({ ($0.operatorCallsign.isEmpty || $0.operatorCallsign == session.station.callsign || stationOperators.contains($0.operatorCallsign)) &&
                  $0.stationLocation == session.station.location }) else {
            throw ContestExportInputError.metadataMismatch
        }
        do {
            let score = try ContestEngine.score(qsos, session: session, rule: rule)
            if let invalid = score.qsos.first(where: { $0.disposition == .invalid }) {
                throw ContestExportInputError.semanticInvalidQSO(invalid.qsoID)
            }
            return score
        }
        catch let error as ContestEvaluationError { throw ContestExportInputError.invalidContacts(error) }
    }

    private func validatedProjectionAfterCommonValidation(rule: any ContestRule) throws -> ContestSubmissionProjection {
        do {
            return try ContestSubmissionProjection.make(qsos: qsos, session: session,
                                                        header: metadata.cabrilloHeader, rule: rule)
        } catch let error as ContestSubmissionProjectionError {
            switch error {
            case let .semanticInvalidQSO(id): throw ContestExportInputError.semanticInvalidQSO(id)
            case let .invalidContacts(error): throw ContestExportInputError.invalidContacts(error)
            case .unsupportedCategory: throw ContestExportInputError.metadataMismatch
            }
        }
    }

    public var deterministicallyOrderedQSOs: [ContestQSO] {
        qsos.sorted {
            if $0.timestampUTC != $1.timestampUTC { return $0.timestampUTC < $1.timestampUTC }
            return $0.id.uuidString.lowercased() < $1.id.uuidString.lowercased()
        }
    }

    private func validText(_ value: String) -> Bool {
        !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
}

public enum ContestExportInputError: Error, Equatable {
    case unsupportedSchema(String)
    case unsupportedFormatter(String)
    case ruleMismatch
    case referenceDataMismatch
    case invalidTimestamp
    case metadataMismatch
    case semanticInvalidQSO(UUID)
    case invalidContacts(ContestEvaluationError)
}
