import Foundation
import XContestCore
import XContestStore

public enum ContestExportFormat: String, Codable, Hashable, Sendable {
    case cabrillo
    case adif
}

public struct ContestExportArtifact: Codable, Hashable, Sendable {
    public let data: Data
    public let format: ContestExportFormat
    public let inputSchemaVersion: String
    public let formatterVersion: String
    public let generatedAtUTC: Date
    public let sessionID: UUID
    public let workspaceGeneration: UUID
    public let revision: UInt64
    public let ruleIdentity: ContestRuleIdentity
    public let referenceDataVersion: String
    public let sessionName: String
    public let operatorCallsign: String
    public let station: ContestStationSnapshot
    public let qsoCount: Int
    public let totalPoints: Int64
    public let multiplierCount: Int64
    public let claimedScore: Int64
    public let requestedHeader: CabrilloHeader

    public init(data: Data, format: ContestExportFormat, inputSchemaVersion: String,
                formatterVersion: String, generatedAtUTC: Date, sessionID: UUID,
                workspaceGeneration: UUID, revision: UInt64, ruleIdentity: ContestRuleIdentity,
                referenceDataVersion: String, sessionName: String, operatorCallsign: String,
                station: ContestStationSnapshot, qsoCount: Int, totalPoints: Int64,
                multiplierCount: Int64, claimedScore: Int64, requestedHeader: CabrilloHeader) {
        self.data = data
        self.format = format
        self.inputSchemaVersion = inputSchemaVersion
        self.formatterVersion = formatterVersion
        self.generatedAtUTC = generatedAtUTC
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.revision = revision
        self.ruleIdentity = ruleIdentity
        self.referenceDataVersion = referenceDataVersion
        self.sessionName = sessionName
        self.operatorCallsign = operatorCallsign
        self.station = station
        self.qsoCount = qsoCount
        self.totalPoints = totalPoints
        self.multiplierCount = multiplierCount
        self.claimedScore = claimedScore
        self.requestedHeader = requestedHeader
    }
}

public enum ContestExportServiceError: Error, Equatable {
    case sessionIdentityMismatch
    case staleWorkspaceGeneration
    case staleRevision(expected: UInt64, actual: UInt64)
    case unknownRule(ContestRuleIdentity)
    case unsupportedOperatorCategory(String)
    case contradictoryHeader(String)
    case invalidSupplementalField(String)
    case invalidExportInput
    case invalidUTF8Output
}

public struct ContestExportService: Sendable {
    private let repository: any ContestDurableRepository
    private let rules: ContestRuleRegistry

    public init(repository: any ContestDurableRepository, rules: ContestRuleRegistry = .pilots) {
        self.repository = repository
        self.rules = rules
    }

    public func export(sessionID: UUID, expectedWorkspaceGeneration: UUID,
                       expectedRevision: UInt64, generatedAtUTC: Date,
                       format: ContestExportFormat, header: CabrilloHeader) async throws -> ContestExportArtifact {
        let snapshot = try await repository.sessionReadSnapshot(id: sessionID)
        let stored = snapshot.session
        guard stored.session.id == sessionID else { throw ContestExportServiceError.sessionIdentityMismatch }
        guard stored.session.workspaceGeneration == expectedWorkspaceGeneration else {
            throw ContestExportServiceError.staleWorkspaceGeneration
        }
        guard stored.revision == expectedRevision else {
            throw ContestExportServiceError.staleRevision(expected: expectedRevision, actual: stored.revision)
        }
        guard generatedAtUTC.timeIntervalSinceReferenceDate.isFinite else {
            throw ContestExportServiceError.invalidSupplementalField("generatedAtUTC")
        }
        guard let rule = rules.rule(for: stored.session.rule) else {
            throw ContestExportServiceError.unknownRule(stored.session.rule)
        }
        let category = try Self.canonicalOperatorCategory(stored.metadata.operatorCategory)
        try Self.validate(header: header, stored: stored, qsos: snapshot.qsos,
                          canonicalCategory: category)

        // Cabrillo uses the complete-log/single-band projection preview. ADIF remains on the
        // frozen pilot-1 policy so this slice does not reinterpret its preservation semantics.
        let formatterVersion = format == .cabrillo ? ContestExportInput.submissionProjectionFormatterVersion :
            ContestExportInput.legacyFormatterVersion
        let input = ContestExportInput(
            formatterVersion: formatterVersion,
            generatedAtUTC: generatedAtUTC,
            sessionRevision: stored.revision,
            session: stored.session,
            ruleIdentity: stored.session.rule,
            referenceDataVersion: stored.session.referenceDataVersion,
            metadata: ContestExportMetadata(sessionName: stored.metadata.name,
                                            operatorCallsign: stored.metadata.operatorCallsign,
                                            operatorCategory: category,
                                            cabrilloHeader: header),
            qsos: snapshot.qsos
        )
        let score: ContestScore
        do { score = try input.validatedScore(rule: rule) }
        catch { throw ContestExportServiceError.invalidExportInput }
        let document: String
        do {
            switch format {
            case .cabrillo: document = try CabrilloExporter.document(input: input, rule: rule)
            case .adif: document = try ContestADIFExport.document(input: input, rule: rule)
            }
        } catch { throw ContestExportServiceError.invalidExportInput }
        guard let data = document.data(using: .utf8), String(data: data, encoding: .utf8) == document else {
            throw ContestExportServiceError.invalidUTF8Output
        }
        return ContestExportArtifact(
            data: data, format: format, inputSchemaVersion: input.schemaVersion,
            formatterVersion: input.formatterVersion, generatedAtUTC: generatedAtUTC,
            sessionID: stored.session.id, workspaceGeneration: stored.session.workspaceGeneration,
            revision: stored.revision, ruleIdentity: stored.session.rule,
            referenceDataVersion: stored.session.referenceDataVersion,
            sessionName: stored.metadata.name, operatorCallsign: stored.metadata.operatorCallsign,
            station: stored.session.station, qsoCount: snapshot.qsoCount,
            totalPoints: score.totalPoints, multiplierCount: score.multiplierCount,
            claimedScore: score.claimedScore, requestedHeader: header
        )
    }

    private static func canonicalOperatorCategory(_ value: String) throws -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .replacingOccurrences(of: "_", with: "-")
            .replacingOccurrences(of: " ", with: "-")
        switch normalized {
        case "single-operator", "single-op": return "SINGLE-OP"
        case "multi-operator", "multi-op": return "MULTI-OP"
        case "checklog", "check-log": return "CHECKLOG"
        default: throw ContestExportServiceError.unsupportedOperatorCategory(value)
        }
    }

    private static func validate(header: CabrilloHeader, stored: StoredContestSession,
                                 qsos: [ContestQSO],
                                 canonicalCategory: String) throws {
        guard header.callsign == stored.session.station.callsign else {
            throw ContestExportServiceError.contradictoryHeader("callsign")
        }
        guard header.categoryOperator == canonicalCategory else {
            throw ContestExportServiceError.contradictoryHeader("categoryOperator")
        }
        let allowedOperators = Set(stored.session.station.operatorCallsigns)
            .union([stored.session.station.callsign, stored.metadata.operatorCallsign])
        let suppliedOperators = Set(header.operators)
        let requiredOperators = Set(qsos.compactMap { $0.operatorCallsign.isEmpty ? nil : $0.operatorCallsign })
            .union([stored.metadata.operatorCallsign])
        guard !header.operators.isEmpty,
              requiredOperators.isSubset(of: suppliedOperators),
              suppliedOperators.isSubset(of: allowedOperators) else {
            throw ContestExportServiceError.contradictoryHeader("operators")
        }
        try bounded(header.callsign, field: "callsign", bytes: 32, required: true)
        try bounded(header.categoryOperator, field: "categoryOperator", bytes: 32, required: true)
        try bounded(header.categoryAssisted, field: "categoryAssisted", bytes: 32, required: true)
        try bounded(header.categoryBand, field: "categoryBand", bytes: 16, required: true)
        try bounded(header.categoryMode, field: "categoryMode", bytes: 16, required: true)
        try bounded(header.categoryTransmitter, field: "categoryTransmitter", bytes: 32, required: true)
        try bounded(header.categoryPower, field: "categoryPower", bytes: 16, required: true)
        try header.categoryOverlay.map { try bounded($0, field: "categoryOverlay", bytes: 64) }
        try bounded(header.location, field: "location", bytes: 64, required: true)
        try header.club.map { try bounded($0, field: "club", bytes: 128) }
        try bounded(header.name, field: "name", bytes: 75, required: true)
        guard header.addressLines.count <= 8, header.operators.count <= 16 else {
            throw ContestExportServiceError.invalidSupplementalField("collectionCount")
        }
        for value in header.addressLines { try bounded(value, field: "address", bytes: 160) }
        for value in header.operators { try bounded(value, field: "operators", bytes: 32, required: true) }
        try bounded(header.email, field: "email", bytes: 254)
    }

    private static func bounded(_ value: String, field: String, bytes: Int,
                                required: Bool = false) throws {
        guard value.utf8.count <= bytes,
              (!required || !value.isEmpty),
              value.unicodeScalars.allSatisfy({ scalar in
                  (32...126).contains(scalar.value)
              }) else {
            throw ContestExportServiceError.invalidSupplementalField(field)
        }
    }
}
