import Foundation
import XContestCore

struct ContestCallHistoryPendingPreview: Equatable, Sendable {
    let previewID: String
    let preview: ContestCallHistoryPreview
}

enum ContestCallHistoryServiceError: Error, Equatable {
    case invalidCache
    case unknownPreview
    case digestMismatch
    case previewNotCommittable
    case advisoryConfirmationRequired
    case envelopeTooLarge
    case dataUnavailable
}

actor ContestCallHistoryService {
    struct Status: Equatable, Sendable {
        let dataset: ContestCallHistoryDatasetInfo?
        let unavailableReason: String?
    }

    typealias AtomicWriter = @Sendable (Data, URL) throws -> Void

    private struct Envelope: Codable {
        let schemaVersion: Int
        let generation: String
        let provenance: ContestCallHistoryProvenance
        let sourceBytes: Data
        let sha256: String
    }

    private static let maximumSourceBytes = 16 * 1_024 * 1_024
    private static let defaultMaximumEnvelopeBytes = 24 * 1_024 * 1_024
    private let cacheURL: URL
    private let maximumEnvelopeBytes: Int
    private let validatePrivateRoot: @Sendable () throws -> Void
    private let writeAtomically: AtomicWriter
    private let parser = ContestCallHistoryParser()
    private var active: ContestCallHistoryDataset?
    private var unavailableReason: String?
    private var pending: [String: ContestCallHistoryPreview] = [:]

    init(cacheURL: URL,
         validatePrivateRoot: @escaping @Sendable () throws -> Void,
         maximumEnvelopeBytes: Int = ContestCallHistoryService.defaultMaximumEnvelopeBytes,
         writeAtomically: @escaping AtomicWriter = { data, url in try data.write(to: url, options: [.atomic]) }) throws {
        self.cacheURL = cacheURL.standardizedFileURL
        self.maximumEnvelopeBytes = maximumEnvelopeBytes
        self.validatePrivateRoot = validatePrivateRoot
        self.writeAtomically = writeAtomically
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

    func previewImport(data: Data, sourceName: String, importedAtUTC: Date) -> ContestCallHistoryPendingPreview {
        let provenance = ContestCallHistoryProvenance(sourceName: sourceName, importedAtUTC: importedAtUTC)
        let preview = parser.preview(importing: data, provenance: provenance)
        let previewID = UUID().uuidString.lowercased()
        pending = [previewID: preview]
        return .init(previewID: previewID, preview: preview)
    }

    func commitImport(previewID: String, expectedSHA256: String,
                      confirmAdvisories: Bool) throws -> ContestCallHistoryDatasetInfo {
        guard let candidate = pending[previewID] else { throw ContestCallHistoryServiceError.unknownPreview }
        guard candidate.sha256 == expectedSHA256.lowercased() else { throw ContestCallHistoryServiceError.digestMismatch }
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
        guard encoded.count <= maximumEnvelopeBytes else {
            throw ContestCallHistoryServiceError.envelopeTooLarge
        }
        let parent = cacheURL.deletingLastPathComponent()
        try validatePrivateRoot()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        try validatePrivateRoot()
        try writeAtomically(encoded, cacheURL)
        active = replacement
        unavailableReason = nil
        pending.removeAll()
        return replacement.info
    }

    func status() -> Status { .init(dataset: active?.info, unavailableReason: unavailableReason) }

    func query(callsign: String, context: ContestCallHistorySelectionContext) throws -> ContestCallHistoryQueryResult {
        guard let active else { throw ContestCallHistoryServiceError.dataUnavailable }
        return try active.exactMatches(callsign: callsign, context: context)
    }

    func selectedRecord(recordID: String, from result: ContestCallHistoryQueryResult,
                        expectedContext: ContestCallHistorySelectionContext) throws -> ContestCallHistoryRow {
        guard let active else { throw ContestCallHistoryServiceError.dataUnavailable }
        return try active.selectedRecord(recordID: recordID, from: result, expectedContext: expectedContext)
    }

    private static func readEnvelope(_ url: URL, maximumBytes: Int) throws -> Envelope {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
            throw ContestCallHistoryServiceError.invalidCache
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        guard maximumBytes > 0,
              let data = try handle.read(upToCount: maximumBytes + 1),
              data.count <= maximumBytes else { throw ContestCallHistoryServiceError.invalidCache }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.sourceBytes.count <= maximumSourceBytes else { throw ContestCallHistoryServiceError.invalidCache }
        return envelope
    }
}
