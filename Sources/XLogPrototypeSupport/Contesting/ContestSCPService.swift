import Foundation
import XContestCore

actor ContestSCPService {
    typealias ScopeValidator = ContestAssistanceLane.ScopeValidator

    struct Status {
        let dataset: ContestSCPDatasetInfo?
        let unavailableReason: String?
    }

    private struct Envelope: Codable {
        let schemaVersion: Int
        let provenance: ContestSCPProvenance
        let rawBytes: Data
    }

    private static let maximumBytes = 16 * 1_024 * 1_024
    private let cacheURL: URL
    private let validatePrivateRoot: @Sendable () throws -> Void
    private let validateScope: ScopeValidator
    private let beforeReplacementPublish: @Sendable () async -> Void
    private var lane: ContestAssistanceLane?
    private var dataset: ContestSCPDatasetInfo?
    private var unavailableReason: String?
    private var importing = false
    private var terminal = false
    private var replacementEpoch: UInt64 = 0

    init(cacheURL: URL,
         validatePrivateRoot: @escaping @Sendable () throws -> Void,
         beforeReplacementPublish: @escaping @Sendable () async -> Void = {},
         validateScope: @escaping ScopeValidator) throws {
        self.cacheURL = cacheURL.standardizedFileURL
        self.validatePrivateRoot = validatePrivateRoot
        self.validateScope = validateScope
        self.beforeReplacementPublish = beforeReplacementPublish
        try validatePrivateRoot()
        if FileManager.default.fileExists(atPath: cacheURL.path) {
            do {
                let envelope = try Self.readEnvelope(cacheURL)
                let index = try ContestSCPIndex(importing: envelope.rawBytes, provenance: envelope.provenance)
                lane = try ContestAssistanceLane(index: index,
                    admission: .operatorOrProviderPolicyApprovedComputedDigest, validateScope: validateScope)
                dataset = index.dataset
            } catch {
                unavailableReason = "invalid_cache"
            }
        } else {
            unavailableReason = "not_imported"
        }
    }

    func importFile(path: String, sourceName: String, retrievedAt: Date) async throws -> ContestSCPDatasetInfo {
        guard !terminal else { throw ContestSCPServiceError.stopped }
        guard !importing else { throw ContestSCPServiceError.importInProgress }
        importing = true
        defer { importing = false }
        try validatePrivateRoot()
        guard sourceName == URL(fileURLWithPath: sourceName).lastPathComponent,
              !sourceName.isEmpty, sourceName.utf8.count <= 256,
              retrievedAt.timeIntervalSinceReferenceDate.isFinite else { throw ContestSCPServiceError.invalidImport }
        let sourceURL = URL(fileURLWithPath: path).standardizedFileURL
        let bytes = try Self.boundedRead(sourceURL, maximum: Self.maximumBytes,
                                         invalid: ContestSCPServiceError.invalidImport)
        guard !bytes.isEmpty else { throw ContestSCPServiceError.invalidImport }
        let provenance = ContestSCPProvenance(sourceID: "operator-managed-local", version: sourceName,
                                               retrievedAtUTC: retrievedAt)
        let index = try ContestSCPIndex(importing: bytes, provenance: provenance)
        let replacement = try ContestAssistanceLane(index: index,
            admission: .operatorOrProviderPolicyApprovedComputedDigest, validateScope: validateScope)
        let encoded = try JSONEncoder().encode(Envelope(schemaVersion: 1, provenance: provenance, rawBytes: bytes))
        let parent = cacheURL.deletingLastPathComponent()
        try validatePrivateRoot()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        try validatePrivateRoot()
        try encoded.write(to: cacheURL, options: [.atomic])
        try validatePrivateRoot()
        guard !terminal else { await replacement.shutdown(); throw ContestSCPServiceError.stopped }
        replacementEpoch &+= 1
        let epoch = replacementEpoch, previous = lane
        lane = nil
        dataset = nil
        unavailableReason = "replacing"
        await previous?.shutdown()
        await beforeReplacementPublish()
        guard !terminal, replacementEpoch == epoch else {
            await replacement.shutdown()
            throw ContestSCPServiceError.stopped
        }
        lane = replacement
        dataset = index.dataset
        unavailableReason = nil
        return index.dataset
    }

    func status() -> Status { Status(dataset: dataset, unavailableReason: unavailableReason) }

    func query(_ query: String, context: ContestAssistanceContext) async throws -> ContestSCPQueryResult {
        guard !terminal, let lane else { throw ContestAssistanceLaneError.dataUnavailable }
        let epoch = replacementEpoch
        let result = try await lane.query(query, context: context)
        guard !terminal, replacementEpoch == epoch else { throw ContestAssistanceLaneError.staleResult }
        return result
    }

    func cancel(context: ContestAssistanceContext) async throws -> Bool {
        guard !terminal, let lane else { throw ContestAssistanceLaneError.dataUnavailable }
        let epoch = replacementEpoch
        let result = try await lane.cancel(context: context)
        guard !terminal, replacementEpoch == epoch else { throw ContestAssistanceLaneError.staleResult }
        return result
    }

    func selectedCallsign(matchID: String, context: ContestAssistanceContext) async throws -> String {
        guard !terminal, let lane else { throw ContestAssistanceLaneError.dataUnavailable }
        let epoch = replacementEpoch
        let result = try await lane.selectedCallsign(matchID: matchID, context: context)
        guard !terminal, replacementEpoch == epoch else { throw ContestAssistanceLaneError.staleResult }
        return result
    }

    func shutdown() async {
        guard !terminal else { return }
        terminal = true
        replacementEpoch &+= 1
        let previous = lane
        lane = nil
        dataset = nil
        unavailableReason = "stopped"
        await previous?.shutdown()
    }

    private static func readEnvelope(_ url: URL) throws -> Envelope {
        let encoded = try boundedRead(url, maximum: maximumBytes * 2, invalid: ContestSCPServiceError.invalidCache)
        let envelope = try JSONDecoder().decode(Envelope.self, from: encoded)
        guard envelope.schemaVersion == 1, envelope.rawBytes.count <= maximumBytes else {
            throw ContestSCPServiceError.invalidCache
        }
        return envelope
    }

    private static func boundedRead(_ url: URL, maximum: Int, invalid: Error) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw invalid }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        guard let data = try handle.read(upToCount: maximum + 1), data.count <= maximum else { throw invalid }
        return data
    }
}

enum ContestSCPServiceError: Error {
    case invalidImport
    case invalidCache
    case importInProgress
    case stopped
}
