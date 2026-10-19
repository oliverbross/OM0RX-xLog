import Foundation
import XContestCore

struct ContestCallHistoryPendingPreview: Equatable, Sendable {
    let previewID: String
    let preview: ContestCallHistoryPreview
    let expiresAtUTC: Date
    let expiresAtMonotonic: ContinuousClock.Instant
    let activeDatasetGeneration: String?
    let workspaceGeneration: String?
}

struct ContestCallHistoryDiagnosticPage: Equatable, Sendable {
    let pending: ContestCallHistoryPendingPreview
    let diagnostics: [ContestCallHistoryDiagnostic]
    let total: Int
    let offset: Int
    let limit: Int
}

struct ContestCallHistoryQueryView: Equatable, Sendable {
    let result: ContestCallHistoryQueryResult
    let headers: [ContestCallHistoryHeader]
}

struct ContestCallHistorySelectedView: Equatable, Sendable {
    let row: ContestCallHistoryRow
    let headers: [ContestCallHistoryHeader]
    let dataset: ContestCallHistoryDatasetInfo
}

enum ContestCallHistoryServiceError: Error, Equatable {
    case invalidCache
    case invalidImport
    case unknownPreview
    case expiredPreview
    case digestMismatch
    case staleGeneration
    case previewNotCommittable
    case advisoryConfirmationRequired
    case envelopeTooLarge
    case dataUnavailable
    case invalidPage
    case resultUnavailable
}

actor ContestCallHistoryService {
    struct Status: Equatable, Sendable {
        let dataset: ContestCallHistoryDatasetInfo?
        let unavailableReason: String?
        let pending: ContestCallHistoryPendingPreview?
    }

    typealias AtomicWriter = @Sendable (Data, URL) throws -> Void
    typealias Now = @Sendable () -> Date
    typealias MonotonicNow = @Sendable () -> ContinuousClock.Instant

    private struct Envelope: Codable {
        let schemaVersion: Int
        let generation: String
        let provenance: ContestCallHistoryProvenance
        let sourceBytes: Data
        let sha256: String
    }

    private static let maximumSourceBytes = 16 * 1_024 * 1_024
    private static let defaultMaximumEnvelopeBytes = 24 * 1_024 * 1_024
    private static let defaultPreviewTTL: TimeInterval = 10 * 60
    private static let maximumCachedQueries = 8
    private let cacheURL: URL
    private let maximumEnvelopeBytes: Int
    private let previewTTL: TimeInterval
    private let now: Now
    private let monotonicNow: MonotonicNow
    private let validatePrivateRoot: @Sendable () throws -> Void
    private let writeAtomically: AtomicWriter
    private let parser = ContestCallHistoryParser()
    private var active: ContestCallHistoryDataset?
    private var unavailableReason: String?
    private var pending: ContestCallHistoryPendingPreview?
    private var queryResults: [ContestCallHistorySelectionContext: ContestCallHistoryQueryResult] = [:]
    private var queryOrder: [ContestCallHistorySelectionContext] = []

    init(cacheURL: URL,
         validatePrivateRoot: @escaping @Sendable () throws -> Void,
         maximumEnvelopeBytes: Int = ContestCallHistoryService.defaultMaximumEnvelopeBytes,
         previewTTL: TimeInterval = ContestCallHistoryService.defaultPreviewTTL,
         now: @escaping Now = { Date() },
         monotonicNow: @escaping MonotonicNow = { ContinuousClock().now },
         writeAtomically: @escaping AtomicWriter = { data, url in try data.write(to: url, options: [.atomic]) }) throws {
        self.cacheURL = cacheURL.standardizedFileURL
        self.maximumEnvelopeBytes = maximumEnvelopeBytes
        self.previewTTL = previewTTL
        self.now = now
        self.monotonicNow = monotonicNow
        self.validatePrivateRoot = validatePrivateRoot
        self.writeAtomically = writeAtomically
        guard previewTTL > 0, previewTTL.isFinite else { throw ContestCallHistoryServiceError.invalidImport }
        try validatePrivateRoot()
        if FileManager.default.fileExists(atPath: self.cacheURL.path) {
            do {
                let envelope = try Self.readEnvelope(self.cacheURL, maximumBytes: maximumEnvelopeBytes)
                let preview = parser.preview(importing: envelope.sourceBytes, provenance: envelope.provenance)
                guard envelope.schemaVersion == 1, preview.sha256 == envelope.sha256, preview.isCommittable else {
                    throw ContestCallHistoryServiceError.invalidCache
                }
                active = try parser.dataset(from: preview, generation: envelope.generation)
                unavailableReason = nil
            } catch {
                active = nil
                unavailableReason = "invalid_cache"
            }
        } else {
            unavailableReason = "not_imported"
        }
    }

    func previewImport(data: Data, sourceName: String, importedAtUTC: Date,
                       workspaceGeneration: String? = nil) -> ContestCallHistoryPendingPreview {
        let provenance = ContestCallHistoryProvenance(sourceName: sourceName, importedAtUTC: importedAtUTC)
        let preview = parser.preview(importing: data, provenance: provenance)
        let receipt = ContestCallHistoryPendingPreview(
            previewID: UUID().uuidString.lowercased(), preview: preview,
            expiresAtUTC: now().addingTimeInterval(previewTTL),
            expiresAtMonotonic: monotonicNow().advanced(by: .seconds(previewTTL)),
            activeDatasetGeneration: active?.info.generation,
            workspaceGeneration: workspaceGeneration)
        pending = receipt
        return receipt
    }

    func previewFile(path: String, sourceName: String, importedAtUTC: Date,
                     workspaceGeneration: String) throws -> ContestCallHistoryPendingPreview {
        guard Self.validWorkspaceGeneration(workspaceGeneration),
              sourceName == URL(fileURLWithPath: sourceName).lastPathComponent,
              !sourceName.isEmpty, sourceName.utf8.count <= 256 else {
            throw ContestCallHistoryServiceError.invalidImport
        }
        let bytes = try Self.boundedRead(URL(fileURLWithPath: path).standardizedFileURL,
                                         maximum: Self.maximumSourceBytes,
                                         invalid: ContestCallHistoryServiceError.invalidImport)
        return previewImport(data: bytes, sourceName: sourceName, importedAtUTC: importedAtUTC,
                             workspaceGeneration: workspaceGeneration)
    }

    func diagnosticPage(previewID: String, expectedSHA256: String, workspaceGeneration: String,
                        offset: Int, limit: Int) throws -> ContestCallHistoryDiagnosticPage {
        let receipt = try requirePending(previewID: previewID, expectedSHA256: expectedSHA256,
                                         workspaceGeneration: workspaceGeneration)
        guard offset >= 0, offset <= receipt.preview.diagnostics.count,
              limit > 0, limit <= 100 else { throw ContestCallHistoryServiceError.invalidPage }
        let upper = min(receipt.preview.diagnostics.count, offset + limit)
        let values = offset < upper ? Array(receipt.preview.diagnostics[offset..<upper]) : []
        return .init(pending: receipt, diagnostics: values, total: receipt.preview.diagnostics.count,
                     offset: offset, limit: limit)
    }

    @discardableResult
    func cancelImport(previewID: String, expectedSHA256: String,
                      workspaceGeneration: String) throws -> Bool {
        _ = try requirePending(previewID: previewID, expectedSHA256: expectedSHA256,
                               workspaceGeneration: workspaceGeneration)
        pending = nil
        return true
    }

    func commitImport(previewID: String, expectedSHA256: String,
                      confirmAdvisories: Bool, expectedWorkspaceGeneration: String? = nil) throws -> ContestCallHistoryDatasetInfo {
        let receipt: ContestCallHistoryPendingPreview
        if let expectedWorkspaceGeneration {
            receipt = try requirePending(previewID: previewID, expectedSHA256: expectedSHA256,
                                         workspaceGeneration: expectedWorkspaceGeneration)
        } else {
            guard let value = pending, value.previewID == previewID else { throw ContestCallHistoryServiceError.unknownPreview }
            guard monotonicNow() < value.expiresAtMonotonic else {
                pending = nil
                throw ContestCallHistoryServiceError.expiredPreview
            }
            guard value.preview.sha256 == expectedSHA256.lowercased() else { throw ContestCallHistoryServiceError.digestMismatch }
            receipt = value
        }
        guard receipt.activeDatasetGeneration == active?.info.generation else {
            throw ContestCallHistoryServiceError.staleGeneration
        }
        let candidate = receipt.preview
        guard candidate.isCommittable else { throw ContestCallHistoryServiceError.previewNotCommittable }
        guard confirmAdvisories || !candidate.requiresAdvisoryConfirmation else {
            throw ContestCallHistoryServiceError.advisoryConfirmationRequired
        }
        let verified = parser.preview(importing: candidate.sourceBytes, provenance: candidate.provenance)
        guard verified == candidate else { throw ContestCallHistoryServiceError.digestMismatch }
        let generation = UUID().uuidString.lowercased()
        let replacement = try parser.dataset(from: verified, generation: generation)
        let envelope = Envelope(schemaVersion: 1, generation: generation, provenance: verified.provenance,
                                sourceBytes: verified.sourceBytes, sha256: verified.sha256)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        let encoded = try encoder.encode(envelope)
        guard encoded.count <= maximumEnvelopeBytes else { throw ContestCallHistoryServiceError.envelopeTooLarge }
        let parent = cacheURL.deletingLastPathComponent()
        try validatePrivateRoot()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        try validatePrivateRoot()
        try writeAtomically(encoded, cacheURL)
        active = replacement
        unavailableReason = nil
        pending = nil
        queryResults.removeAll(keepingCapacity: false)
        queryOrder.removeAll(keepingCapacity: false)
        return replacement.info
    }

    func status() -> Status {
        discardExpiredPreview()
        return .init(dataset: active?.info, unavailableReason: unavailableReason, pending: pending)
    }

    func activeDataset() -> ContestCallHistoryDataset? { active }

    func query(callsign: String, context: ContestCallHistorySelectionContext) throws -> ContestCallHistoryQueryResult {
        guard let active else { throw ContestCallHistoryServiceError.dataUnavailable }
        let result = try active.exactMatches(callsign: callsign, context: context)
        queryResults[context] = result
        queryOrder.removeAll { $0 == context }
        queryOrder.append(context)
        while queryOrder.count > Self.maximumCachedQueries {
            queryResults.removeValue(forKey: queryOrder.removeFirst())
        }
        return result
    }

    func queryView(callsign: String, context: ContestCallHistorySelectionContext) throws -> ContestCallHistoryQueryView {
        let result = try query(callsign: callsign, context: context)
        guard let active else { throw ContestCallHistoryServiceError.dataUnavailable }
        return .init(result: result, headers: active.headers)
    }

    @discardableResult
    func cancelQuery(context: ContestCallHistorySelectionContext) -> Bool {
        let removed = queryResults.removeValue(forKey: context) != nil
        queryOrder.removeAll { $0 == context }
        return removed
    }

    func selectedRecord(recordID: String, expectedContext: ContestCallHistorySelectionContext) throws -> ContestCallHistoryRow {
        guard let active else { throw ContestCallHistoryServiceError.dataUnavailable }
        guard let result = queryResults[expectedContext] else { throw ContestCallHistoryServiceError.resultUnavailable }
        return try active.selectedRecord(recordID: recordID, from: result, expectedContext: expectedContext)
    }

    func selectedView(recordID: String, expectedContext: ContestCallHistorySelectionContext) throws -> ContestCallHistorySelectedView {
        guard let active else { throw ContestCallHistoryServiceError.dataUnavailable }
        let row = try selectedRecord(recordID: recordID, expectedContext: expectedContext)
        return .init(row: row, headers: active.headers, dataset: active.info)
    }

    func selectedRecord(recordID: String, from result: ContestCallHistoryQueryResult,
                        expectedContext: ContestCallHistorySelectionContext) throws -> ContestCallHistoryRow {
        guard let active else { throw ContestCallHistoryServiceError.dataUnavailable }
        return try active.selectedRecord(recordID: recordID, from: result, expectedContext: expectedContext)
    }

    private func requirePending(previewID: String, expectedSHA256: String,
                                workspaceGeneration: String) throws -> ContestCallHistoryPendingPreview {
        guard let receipt = pending, receipt.previewID == previewID else { throw ContestCallHistoryServiceError.unknownPreview }
        guard monotonicNow() < receipt.expiresAtMonotonic else {
            pending = nil
            throw ContestCallHistoryServiceError.expiredPreview
        }
        guard receipt.preview.sha256 == expectedSHA256.lowercased() else { throw ContestCallHistoryServiceError.digestMismatch }
        guard receipt.workspaceGeneration == workspaceGeneration,
              Self.validWorkspaceGeneration(workspaceGeneration) else { throw ContestCallHistoryServiceError.staleGeneration }
        return receipt
    }

    private func discardExpiredPreview() {
        if let pending, monotonicNow() >= pending.expiresAtMonotonic { self.pending = nil }
    }

    private static func validWorkspaceGeneration(_ value: String) -> Bool {
        guard let id = UUID(uuidString: value) else { return false }
        return value == id.uuidString.lowercased()
    }

    private static func boundedRead(_ url: URL, maximum: Int, invalid: Error) throws -> Data {
        guard maximum > 0, maximum <= defaultMaximumEnvelopeBytes else { throw invalid }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw invalid }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        guard let data = try handle.read(upToCount: maximum + 1), data.count <= maximum else { throw invalid }
        return data
    }

    private static func readEnvelope(_ url: URL, maximumBytes: Int) throws -> Envelope {
        let data = try boundedRead(url, maximum: maximumBytes, invalid: ContestCallHistoryServiceError.invalidCache)
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.sourceBytes.count <= maximumSourceBytes else { throw ContestCallHistoryServiceError.invalidCache }
        return envelope
    }
}
