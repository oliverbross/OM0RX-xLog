import Foundation

public enum ContestCallHistoryKnownKey: String, Codable, CaseIterable, Sendable {
    case call, name, loc1, loc2, sect, state, ck, birthDate = "birthdate"
    case exch1, misc, power, cqZone = "cqzone", ituZone = "ituzone"
    case userText = "usertext", lastUpdateNote = "lastupdatenote"
    case exchange1, county
}

public struct ContestCallHistoryProvenance: Codable, Equatable, Sendable {
    public let sourceName: String
    public let importedAtUTC: Date

    public init(sourceName: String, importedAtUTC: Date) {
        self.sourceName = sourceName
        self.importedAtUTC = importedAtUTC
    }
}

public struct ContestCallHistoryLimits: Equatable, Sendable {
    public var maximumBytes: Int
    public var maximumRecords: Int
    public var maximumLineBytes: Int
    public var maximumHeaders: Int
    public var maximumHeaderBytes: Int
    public var maximumValueBytes: Int

    public init(maximumBytes: Int = 16 * 1_024 * 1_024, maximumRecords: Int = 100_000,
                maximumLineBytes: Int = 16 * 1_024, maximumHeaders: Int = 128,
                maximumHeaderBytes: Int = 64, maximumValueBytes: Int = 4_096) {
        self.maximumBytes = maximumBytes
        self.maximumRecords = maximumRecords
        self.maximumLineBytes = maximumLineBytes
        self.maximumHeaders = maximumHeaders
        self.maximumHeaderBytes = maximumHeaderBytes
        self.maximumValueBytes = maximumValueBytes
    }
}

public enum ContestCallHistoryDiagnosticSeverity: String, Codable, Sendable { case advisory, blocking }

public enum ContestCallHistoryDiagnosticCode: String, Codable, Sendable {
    case invalidLimits, invalidProvenance, datasetTooLarge, invalidUTF8, lineTooLong
    case missingHeaderMarker, tooManyHeaders, invalidHeader, duplicateHeader, missingCallHeader
    case tooManyRecords, extraValues, valueTooLong, blankCall, invalidCall, noIndexableCalls
}

public struct ContestCallHistoryDiagnostic: Codable, Equatable, Sendable {
    public let severity: ContestCallHistoryDiagnosticSeverity
    public let code: ContestCallHistoryDiagnosticCode
    public let line: Int?
    public let detail: String

    public init(severity: ContestCallHistoryDiagnosticSeverity, code: ContestCallHistoryDiagnosticCode,
                line: Int? = nil, detail: String) {
        self.severity = severity
        self.code = code
        self.line = line
        self.detail = detail
    }
}

public struct ContestCallHistoryHeader: Codable, Equatable, Sendable {
    public let originalName: String
    public let canonicalName: String
    public let knownKey: ContestCallHistoryKnownKey?
}

public enum ContestCallHistoryIndexingIssue: String, Codable, Sendable { case blankCall, invalidCall }

public struct ContestCallHistoryRow: Codable, Equatable, Sendable {
    public let recordID: String
    public let sourceOrdinal: Int
    public let sourceLine: Int
    public let values: [String]
    public let normalizedCallsign: String?
    public let indexingIssue: ContestCallHistoryIndexingIssue?
}

public struct ContestCallHistoryDatasetInfo: Codable, Equatable, Sendable {
    public let generation: String
    public let sha256: String
    public let provenance: ContestCallHistoryProvenance
    public let byteCount: Int
    public let recordCount: Int
    public let indexableRecordCount: Int
    public let unindexableRecordCount: Int
    public let duplicateCallCount: Int
}

public struct ContestCallHistoryPreview: Equatable, Sendable {
    public let provenance: ContestCallHistoryProvenance
    public let sourceBytes: Data
    public let sha256: String
    public let headers: [ContestCallHistoryHeader]
    public let rows: [ContestCallHistoryRow]
    public let duplicateCallCount: Int
    public let diagnostics: [ContestCallHistoryDiagnostic]

    public var isCommittable: Bool {
        !diagnostics.contains { $0.severity == .blocking }
    }
    public var requiresAdvisoryConfirmation: Bool {
        diagnostics.contains { $0.severity == .advisory }
    }
}

public struct ContestCallHistorySelectionContext: Codable, Equatable, Hashable, Sendable {
    public let sessionID: String
    public let workspaceGeneration: String
    public let sessionRevision: Int64
    public let draftID: String
    public let draftRevision: Int64
    public let inputCallsign: String
    public let requestID: String
    public let ruleIdentity: ContestRuleIdentity
    public let referenceDataVersion: String

    public init(sessionID: String, workspaceGeneration: String, sessionRevision: Int64,
                draftID: String, draftRevision: Int64, inputCallsign: String,
                requestID: String, ruleIdentity: ContestRuleIdentity, referenceDataVersion: String) {
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.sessionRevision = sessionRevision
        self.draftID = draftID
        self.draftRevision = draftRevision
        self.inputCallsign = inputCallsign
        self.requestID = requestID
        self.ruleIdentity = ruleIdentity
        self.referenceDataVersion = referenceDataVersion
    }
}

public struct ContestCallHistoryQueryResult: Codable, Equatable, Sendable {
    public let context: ContestCallHistorySelectionContext
    public let normalizedCallsign: String
    public let records: [ContestCallHistoryRow]
    public let dataset: ContestCallHistoryDatasetInfo

    public init(context: ContestCallHistorySelectionContext, normalizedCallsign: String,
                records: [ContestCallHistoryRow], dataset: ContestCallHistoryDatasetInfo) {
        self.context = context
        self.normalizedCallsign = normalizedCallsign
        self.records = records
        self.dataset = dataset
    }
}

public enum ContestCallHistoryError: Error, Equatable, LocalizedError {
    case previewNotCommittable
    case invalidGeneration
    case invalidQuery
    case invalidContext
    case staleContext
    case unknownRecord

    public var errorDescription: String? {
        switch self {
        case .previewNotCommittable: return "The call-history preview contains blocking issues."
        case .invalidGeneration: return "The call-history dataset generation is invalid."
        case .invalidQuery: return "The call-history query is invalid."
        case .invalidContext: return "The call-history query does not match its selection context."
        case .staleContext: return "The call-history result belongs to another dataset or request context."
        case .unknownRecord: return "The selected call-history record is not present in this result."
        }
    }
}

public struct ContestCallHistoryDataset: Equatable, Sendable {
    public let info: ContestCallHistoryDatasetInfo
    public let sourceBytes: Data
    public let headers: [ContestCallHistoryHeader]
    public let rows: [ContestCallHistoryRow]

    fileprivate init(preview: ContestCallHistoryPreview, generation: String) throws {
        guard preview.isCommittable else { throw ContestCallHistoryError.previewNotCommittable }
        guard Self.validGeneration(generation) else { throw ContestCallHistoryError.invalidGeneration }
        let indexable = preview.rows.filter { $0.normalizedCallsign != nil }.count
        info = .init(generation: generation, sha256: preview.sha256, provenance: preview.provenance,
                     byteCount: preview.sourceBytes.count, recordCount: preview.rows.count,
                     indexableRecordCount: indexable,
                     unindexableRecordCount: preview.rows.count - indexable,
                     duplicateCallCount: preview.duplicateCallCount)
        sourceBytes = preview.sourceBytes
        headers = preview.headers
        rows = preview.rows
    }

    public func value(in row: ContestCallHistoryRow, for key: ContestCallHistoryKnownKey) -> String? {
        guard let index = headers.firstIndex(where: { $0.knownKey == key }) else { return nil }
        return row.values.indices.contains(index) ? row.values[index] : ""
    }

    public func exactMatches(callsign: String, context: ContestCallHistorySelectionContext) throws -> ContestCallHistoryQueryResult {
        guard let normalized = Self.normalizedCallsign(callsign) else { throw ContestCallHistoryError.invalidQuery }
        guard Self.normalizedCallsign(context.inputCallsign) == normalized else { throw ContestCallHistoryError.invalidContext }
        return .init(context: context, normalizedCallsign: normalized,
                     records: rows.filter { $0.normalizedCallsign == normalized }, dataset: info)
    }

    public func selectedRecord(recordID: String, from result: ContestCallHistoryQueryResult,
                               expectedContext: ContestCallHistorySelectionContext) throws -> ContestCallHistoryRow {
        guard result.context == expectedContext, result.dataset == info,
              Self.normalizedCallsign(result.context.inputCallsign) == result.normalizedCallsign else {
            throw ContestCallHistoryError.staleContext
        }
        guard let candidate = result.records.first(where: { $0.recordID == recordID }),
              let authoritative = rows.first(where: { $0.recordID == recordID }),
              candidate == authoritative, authoritative.normalizedCallsign == result.normalizedCallsign else {
            throw ContestCallHistoryError.unknownRecord
        }
        return authoritative
    }

    private static func normalizedCallsign(_ value: String) -> String? {
        guard let normalized = ContestSCPIndex.normalizedCallsign(value), normalized.utf8.count >= 2 else { return nil }
        return normalized
    }

    private static func validGeneration(_ value: String) -> Bool {
        value == value.trimmingCharacters(in: .whitespacesAndNewlines) && !value.isEmpty &&
            value.utf8.count <= 128 && value.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value != 127 }
    }
}

public struct ContestCallHistoryParser: Sendable {
    private static let absoluteMaximumBytes = 16 * 1_024 * 1_024

    public init() {}

    public func preview(importing data: Data, provenance: ContestCallHistoryProvenance,
                        limits: ContestCallHistoryLimits = .init()) -> ContestCallHistoryPreview {
        guard data.count <= Self.absoluteMaximumBytes else {
            return result(provenance, Data(), "", [], [], 0, [.init(
                severity: .blocking, code: .datasetTooLarge,
                detail: "Source exceeds the absolute byte limit; oversized bytes were not retained or hashed.")])
        }
        let digest = ContestSCPIndex.sha256(data)
        guard Self.valid(limits) else {
            return result(provenance, data, digest, [], [], 0, [.init(severity: .blocking, code: .invalidLimits, detail: "Import limits are incoherent.")])
        }
        guard Self.valid(provenance) else {
            return result(provenance, data, digest, [], [], 0, [.init(severity: .blocking, code: .invalidProvenance, detail: "Import provenance is invalid.")])
        }
        guard data.count <= limits.maximumBytes else {
            return result(provenance, Data(), digest, [], [], 0, [.init(severity: .blocking, code: .datasetTooLarge, detail: "Source exceeds the byte limit; oversized bytes were not retained.")])
        }

        var diagnostics: [ContestCallHistoryDiagnostic] = []
        var headers: [ContestCallHistoryHeader] = []
        var rows: [ContestCallHistoryRow] = []
        var seenCalls = Set<String>()
        var duplicates = 0
        var callIndex: Int?
        var foundHeader = false
        var recordLimitReported = false
        var start = data.startIndex
        var lineNumber = 1
        var finished = false
        while !finished {
            let newline = data[start...].firstIndex(of: 0x0a) ?? data.endIndex
            finished = newline == data.endIndex
            var bytes = data[start..<newline]
            if !finished { start = data.index(after: newline) }
            if bytes.count > limits.maximumLineBytes {
                diagnostics.append(.init(severity: .blocking, code: .lineTooLong, line: lineNumber,
                                         detail: "Physical line exceeds the byte limit."))
                return result(provenance, data, digest, headers, rows, duplicates, diagnostics)
            }
            if bytes.last == 0x0d { bytes = bytes.dropLast() }
            if lineNumber == 1, bytes.starts(with: [0xef, 0xbb, 0xbf]) { bytes = bytes.dropFirst(3) }
            guard let line = String(data: bytes, encoding: .utf8) else {
                diagnostics.append(.init(severity: .blocking, code: .invalidUTF8, line: lineNumber,
                                         detail: "Source is not valid UTF-8."))
                break
            }

            if !foundHeader {
                if !line.contains("#") {
                    let isHeaderCandidate = line == "!!Order!!" || line.hasPrefix("!!Order!!,")
                    if isHeaderCandidate {
                        let commaCount = line.utf8.reduce(into: 0) { if $1 == 0x2c { $0 += 1 } }
                        let headerCount = commaCount - (line.hasSuffix(",") ? 1 : 0)
                        if headerCount > limits.maximumHeaders {
                            diagnostics.append(.init(severity: .blocking, code: .tooManyHeaders, line: lineNumber,
                                                     detail: "Header count exceeds the limit."))
                            return result(provenance, data, digest, [], [], 0, diagnostics)
                        }
                    }
                    var tokens = Self.fields(line)
                    if tokens.first == "!!Order!!" {
                        foundHeader = true
                        tokens.removeFirst()
                        if tokens.last == "" { tokens.removeLast() }
                        var seenHeaders = Set<String>()
                        for token in tokens {
                            let canonical = Self.canonicalHeader(token)
                            let invalid = token.isEmpty || token.utf8.count > limits.maximumHeaderBytes ||
                                token != token.trimmingCharacters(in: .whitespacesAndNewlines) || token.contains(",") ||
                                token.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
                            if invalid {
                                diagnostics.append(.init(severity: .blocking, code: .invalidHeader, line: lineNumber,
                                                         detail: "Header \(headers.count + 1) is invalid."))
                            }
                            if !seenHeaders.insert(canonical).inserted {
                                diagnostics.append(.init(severity: .blocking, code: .duplicateHeader, line: lineNumber,
                                                         detail: "Header \(token) is duplicated after ASCII case canonicalization."))
                            }
                            headers.append(.init(originalName: token, canonicalName: canonical,
                                                 knownKey: ContestCallHistoryKnownKey(rawValue: canonical)))
                        }
                        if headers.filter({ $0.canonicalName == ContestCallHistoryKnownKey.call.rawValue }).count != 1 {
                            diagnostics.append(.init(severity: .blocking, code: .missingCallHeader, line: lineNumber,
                                                     detail: "Exactly one Call header is required."))
                        }
                        callIndex = headers.firstIndex { $0.canonicalName == ContestCallHistoryKnownKey.call.rawValue }
                    }
                }
                lineNumber += 1
                continue
            }
            if line.isEmpty || line.hasPrefix("#") {
                lineNumber += 1
                continue
            }
            guard rows.count < limits.maximumRecords else {
                if !recordLimitReported {
                    diagnostics.append(.init(severity: .blocking, code: .tooManyRecords, line: lineNumber,
                                             detail: "Record count exceeds the limit."))
                    recordLimitReported = true
                }
                lineNumber += 1
                continue
            }
            let valueCount = line.utf8.reduce(into: 1) { if $1 == 0x2c { $0 += 1 } }
            if valueCount > headers.count {
                diagnostics.append(.init(severity: .blocking, code: .extraValues, line: lineNumber,
                                         detail: "Row has more values than the header."))
                return result(provenance, data, digest, headers, rows, duplicates, diagnostics)
            }
            let values = Self.fields(line)
            for value in values where value.utf8.count > limits.maximumValueBytes {
                diagnostics.append(.init(severity: .blocking, code: .valueTooLong, line: lineNumber,
                                         detail: "Row contains a value exceeding the byte limit."))
            }
            let rawCall = callIndex.flatMap { values.indices.contains($0) ? values[$0] : nil } ?? ""
            let normalized = Self.normalizedCallsign(rawCall)
            let issue: ContestCallHistoryIndexingIssue?
            if normalized != nil { issue = nil }
            else if rawCall.utf8.allSatisfy({ $0 < 128 }) && rawCall.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { issue = .blankCall }
            else { issue = .invalidCall }
            if let issue {
                diagnostics.append(.init(severity: .advisory,
                                         code: issue == .blankCall ? .blankCall : .invalidCall,
                                         line: lineNumber, detail: "Row is retained but excluded from callsign lookup."))
            } else if let normalized, !seenCalls.insert(normalized).inserted { duplicates += 1 }
            let ordinal = rows.count
            rows.append(.init(recordID: "\(digest):\(ordinal)", sourceOrdinal: ordinal, sourceLine: lineNumber,
                              values: values, normalizedCallsign: normalized, indexingIssue: issue))
            lineNumber += 1
        }
        if diagnostics.contains(where: { $0.code == .invalidUTF8 }) {
            return result(provenance, data, digest, [], [], 0, diagnostics)
        }
        guard foundHeader else {
            diagnostics.append(.init(severity: .blocking, code: .missingHeaderMarker,
                                     detail: "No exact !!Order!! header marker was found."))
            return result(provenance, data, digest, [], [], 0, diagnostics)
        }
        if !rows.contains(where: { $0.normalizedCallsign != nil }) {
            diagnostics.append(.init(severity: .blocking, code: .noIndexableCalls, detail: "Dataset has no indexable callsigns."))
        }
        return result(provenance, data, digest, headers, rows, duplicates, diagnostics)
    }

    public func dataset(from preview: ContestCallHistoryPreview, generation: String) throws -> ContestCallHistoryDataset {
        try ContestCallHistoryDataset(preview: preview, generation: generation)
    }

    private static func fields(_ line: String) -> [String] {
        line.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
    }

    private static func canonicalHeader(_ value: String) -> String {
        String(decoding: value.utf8.map { (65...90).contains($0) ? $0 + 32 : $0 }, as: UTF8.self)
    }

    private static func normalizedCallsign(_ value: String) -> String? {
        guard let normalized = ContestSCPIndex.normalizedCallsign(value), normalized.utf8.count >= 2 else { return nil }
        return normalized
    }

    private static func valid(_ limits: ContestCallHistoryLimits) -> Bool {
        limits.maximumBytes > 0 && limits.maximumBytes <= 16 * 1_024 * 1_024 &&
            limits.maximumRecords > 0 && limits.maximumRecords <= 100_000 &&
            limits.maximumLineBytes > 0 && limits.maximumLineBytes <= 16 * 1_024 &&
            limits.maximumHeaders > 0 && limits.maximumHeaders <= 128 &&
            limits.maximumHeaderBytes > 0 && limits.maximumHeaderBytes <= 64 &&
            limits.maximumValueBytes > 0 && limits.maximumValueBytes <= 4_096
    }

    private static func valid(_ provenance: ContestCallHistoryProvenance) -> Bool {
        let name = provenance.sourceName
        return !name.isEmpty && name.utf8.count <= 256 && name == name.trimmingCharacters(in: .whitespacesAndNewlines) &&
            !name.contains("/") && !name.contains("\\") &&
            name.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value != 127 } &&
            provenance.importedAtUTC.timeIntervalSinceReferenceDate.isFinite
    }

    private func result(_ provenance: ContestCallHistoryProvenance, _ data: Data, _ digest: String,
                        _ headers: [ContestCallHistoryHeader], _ rows: [ContestCallHistoryRow], _ duplicates: Int,
                        _ diagnostics: [ContestCallHistoryDiagnostic]) -> ContestCallHistoryPreview {
        .init(provenance: provenance, sourceBytes: data, sha256: digest, headers: headers,
              rows: rows, duplicateCallCount: duplicates, diagnostics: diagnostics)
    }
}
