import Foundation
import XContestCore
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

struct ContestExportLaneError: Error, Equatable, Sendable {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}

struct ContestExportPrepareRequest: Hashable, Sendable {
    let exportID: UUID
    let sessionID: UUID
    let workspaceGeneration: UUID
    let expectedRevision: UInt64
    let generatedAtUTC: Date
    let format: ContestExportFormat
    let header: CabrilloHeader
}

struct ContestExportReadRequest: Hashable, Sendable {
    let exportID: UUID
    let sessionID: UUID
    let workspaceGeneration: UUID
    let offset: Int
    let length: Int
}

struct ContestExportReleaseRequest: Hashable, Sendable {
    let exportID: UUID
    let sessionID: UUID
    let workspaceGeneration: UUID
}

struct ContestExportPreparedArtifact: Hashable, Sendable {
    let artifactID: UUID
    let sessionID: UUID
    let workspaceGeneration: UUID
    let revision: UInt64
    let format: ContestExportFormat
    let inputSchemaVersion: String
    let formatterVersion: String
    let generatedAtUTC: Date
    let qsoCount: Int
    let totalPoints: Int64
    let multiplierCount: Int64
    let claimedScore: Int64
    let byteLength: Int
    let sha256: String
    let chunkLimit: Int
    let expiresAfterSeconds: Int
}

struct ContestExportChunk: Hashable, Sendable {
    let artifactID: UUID
    let sessionID: UUID
    let workspaceGeneration: UUID
    let revision: UInt64
    let offset: Int
    let dataBase64: String
    let eof: Bool
    let byteLength: Int
    let sha256: String
}

struct ContestExportReleaseResult: Hashable, Sendable {
    let artifactID: UUID
    let released: Bool
}

actor ContestExportLane {
    typealias GenerationSource = @Sendable () async throws -> UUID
    typealias Exporter = @Sendable (ContestExportPrepareRequest) async throws -> ContestExportArtifact

    private let generationSource: GenerationSource
    private let exporter: Exporter
    private let cache: ContestExportArtifactCache
    private var nextObservationTicket: UInt64 = 0
    private var latestAppliedObservationTicket: UInt64 = 0
    private var isShutdown = false

    init(service: ContestExportService, generationSource: @escaping GenerationSource,
         cache: ContestExportArtifactCache = ContestExportArtifactCache()) {
        self.generationSource = generationSource
        self.exporter = { request in
            try await service.export(sessionID: request.sessionID,
                                     expectedWorkspaceGeneration: request.workspaceGeneration,
                                     expectedRevision: request.expectedRevision,
                                     generatedAtUTC: request.generatedAtUTC,
                                     format: request.format, header: request.header)
        }
        self.cache = cache
    }

    init(generationSource: @escaping GenerationSource, cache: ContestExportArtifactCache,
         exporter: @escaping Exporter) {
        self.generationSource = generationSource
        self.cache = cache
        self.exporter = exporter
    }

    func prepare(_ request: ContestExportPrepareRequest) async throws -> ContestExportPreparedArtifact {
        try await fenced(request.workspaceGeneration) {
            try await cache.prepare(request) { [exporter] in try await exporter(request) }
        }
    }

    func read(_ request: ContestExportReadRequest) async throws -> ContestExportChunk {
        try await fenced(request.workspaceGeneration) { try await cache.read(request) }
    }

    func release(_ request: ContestExportReleaseRequest) async throws -> ContestExportReleaseResult {
        try await fenced(request.workspaceGeneration) { try await cache.release(request) }
    }

    func shutdown() async {
        isShutdown = true
        await cache.shutdown()
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        switch method {
        case "contest_export_prepare": return Self.wire(try await prepare(try ExportWire.prepare(params)))
        case "contest_export_read": return Self.wire(try await read(try ExportWire.read(params)))
        case "contest_export_release": return Self.wire(try await release(try ExportWire.release(params)))
        default: throw ContestExportLaneError("unknown_method", "Unknown contest export method.")
        }
    }

    private func fenced<T: Sendable>(_ requested: UUID,
                                     operation: () async throws -> T) async throws -> T {
        guard !isShutdown else { throw ContestExportLaneError("artifact_unavailable", "The contest export lane is shut down.") }
        let before = try await observeGeneration()
        guard before == requested else { throw ContestExportLaneError("stale_workspace", "The isolated workspace changed.") }
        let result = try await operation()
        let after = try await observeGeneration()
        guard after == requested else { throw ContestExportLaneError("stale_workspace", "The isolated workspace changed.") }
        return result
    }

    private func observeGeneration() async throws -> UUID {
        guard !isShutdown else { throw ContestExportLaneError("artifact_unavailable", "The contest export lane is shut down.") }
        nextObservationTicket += 1
        let ticket = nextObservationTicket
        let generation: UUID
        do { generation = try await generationSource() }
        catch { throw ContestExportLaneError("workspace_fence_failed", "The workspace generation could not be verified.") }
        guard !isShutdown else { throw ContestExportLaneError("artifact_unavailable", "The contest export lane is shut down.") }
        guard ticket > latestAppliedObservationTicket else {
            throw ContestExportLaneError("workspace_fence_failed", "A stale workspace observation was superseded.")
        }
        latestAppliedObservationTicket = ticket
        let applied = await cache.applyGeneration(generation, ticket: ticket)
        guard !isShutdown else { throw ContestExportLaneError("artifact_unavailable", "The contest export lane is shut down.") }
        guard applied, ticket == latestAppliedObservationTicket else {
            throw ContestExportLaneError("workspace_fence_failed", "A stale workspace observation was superseded.")
        }
        return generation
    }

    private static func wire(_ value: ContestExportPreparedArtifact) -> [String: Any] {
        ["artifactID": ExportWire.uuid(value.artifactID), "sessionID": ExportWire.uuid(value.sessionID),
         "workspaceGeneration": ExportWire.uuid(value.workspaceGeneration), "revision": value.revision,
         "format": value.format.rawValue, "inputSchemaVersion": value.inputSchemaVersion,
         "formatterVersion": value.formatterVersion, "generatedAtUTC": ExportWire.iso(value.generatedAtUTC),
         "qsoCount": value.qsoCount, "totalPoints": value.totalPoints,
         "multiplierCount": value.multiplierCount, "claimedScore": value.claimedScore,
         "byteLength": value.byteLength, "sha256": value.sha256, "chunkLimit": value.chunkLimit,
         "expiresAfterSeconds": value.expiresAfterSeconds]
    }

    private static func wire(_ value: ContestExportChunk) -> [String: Any] {
        ["artifactID": ExportWire.uuid(value.artifactID), "sessionID": ExportWire.uuid(value.sessionID),
         "workspaceGeneration": ExportWire.uuid(value.workspaceGeneration), "revision": value.revision,
         "offset": value.offset, "dataBase64": value.dataBase64, "eof": value.eof,
         "byteLength": value.byteLength, "sha256": value.sha256]
    }

    private static func wire(_ value: ContestExportReleaseResult) -> [String: Any] {
        ["artifactID": ExportWire.uuid(value.artifactID), "released": value.released]
    }
}

private enum ExportWire {
    private static let headerRequired: Set<String> = ["callsign", "categoryOperator", "categoryAssisted", "categoryBand",
        "categoryMode", "categoryTransmitter", "categoryPower", "operators", "location", "name", "addressLines", "email"]
    private static let headerOptional: Set<String> = ["categoryOverlay", "club"]

    static func prepare(_ value: [String: Any]) throws -> ContestExportPrepareRequest {
        try exact(value, ["exportID", "sessionID", "workspaceGeneration", "expectedRevision", "generatedAtUTC", "format", "header"])
        let formatRaw = try text(value, "format", max: 16)
        guard let format = ContestExportFormat(rawValue: formatRaw) else { throw invalid("format") }
        return ContestExportPrepareRequest(exportID: try uuid(value, "exportID"), sessionID: try uuid(value, "sessionID"),
            workspaceGeneration: try uuid(value, "workspaceGeneration"), expectedRevision: try uint(value, "expectedRevision"),
            generatedAtUTC: try date(value, "generatedAtUTC"), format: format,
            header: try header(object(value, "header")))
    }

    static func read(_ value: [String: Any]) throws -> ContestExportReadRequest {
        try exact(value, ["exportID", "sessionID", "workspaceGeneration", "offset", "length"])
        return ContestExportReadRequest(exportID: try uuid(value, "exportID"), sessionID: try uuid(value, "sessionID"),
            workspaceGeneration: try uuid(value, "workspaceGeneration"), offset: try int(value, "offset"),
            length: try int(value, "length"))
    }

    static func release(_ value: [String: Any]) throws -> ContestExportReleaseRequest {
        try exact(value, ["exportID", "sessionID", "workspaceGeneration"])
        return ContestExportReleaseRequest(exportID: try uuid(value, "exportID"), sessionID: try uuid(value, "sessionID"),
            workspaceGeneration: try uuid(value, "workspaceGeneration"))
    }

    static func uuid(_ value: UUID) -> String { value.uuidString.lowercased() }
    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func header(_ value: [String: Any]) throws -> CabrilloHeader {
        let keys = Set(value.keys)
        guard headerRequired.isSubset(of: keys), keys.isSubset(of: headerRequired.union(headerOptional)) else { throw invalid("header") }
        return CabrilloHeader(callsign: try text(value, "callsign", max: 32),
            categoryOperator: try text(value, "categoryOperator", max: 32),
            categoryAssisted: try text(value, "categoryAssisted", max: 32),
            categoryBand: try text(value, "categoryBand", max: 16),
            categoryMode: try text(value, "categoryMode", max: 16),
            categoryTransmitter: try text(value, "categoryTransmitter", max: 32),
            categoryPower: try text(value, "categoryPower", max: 16),
            categoryOverlay: try optionalText(value, "categoryOverlay", max: 64),
            operators: try strings(value, "operators", count: 16, bytes: 32),
            location: try text(value, "location", max: 64), club: try optionalText(value, "club", max: 128),
            name: try text(value, "name", max: 75), addressLines: try strings(value, "addressLines", count: 8, bytes: 160),
            email: try text(value, "email", max: 254, empty: true))
    }

    private static func exact(_ value: [String: Any], _ keys: Set<String>) throws {
        guard Set(value.keys) == keys else { throw invalid("fields") }
    }
    private static func object(_ value: [String: Any], _ key: String) throws -> [String: Any] {
        guard let result = value[key] as? [String: Any] else { throw invalid(key) }; return result
    }
    private static func text(_ value: [String: Any], _ key: String, max: Int, empty: Bool = false) throws -> String {
        guard let result = value[key] as? String, result.utf8.count <= max, empty || !result.isEmpty else { throw invalid(key) }
        return result
    }
    private static func optionalText(_ value: [String: Any], _ key: String, max: Int) throws -> String? {
        guard let raw = value[key] else { return nil }
        guard !(raw is NSNull), let result = raw as? String, result.utf8.count <= max else { throw invalid(key) }
        return result
    }
    private static func strings(_ value: [String: Any], _ key: String, count: Int, bytes: Int) throws -> [String] {
        guard let result = value[key] as? [String], result.count <= count,
              result.allSatisfy({ !$0.isEmpty && $0.utf8.count <= bytes }) else { throw invalid(key) }
        return result
    }
    private static func uuid(_ value: [String: Any], _ key: String) throws -> UUID {
        let raw = try text(value, key, max: 36)
        guard let result = UUID(uuidString: raw), raw == uuid(result) else { throw invalid(key) }
        return result
    }
    private static func uint(_ value: [String: Any], _ key: String) throws -> UInt64 {
        guard let number = value[key] as? NSNumber, String(cString: number.objCType) != "c",
              number.doubleValue.isFinite, number.doubleValue >= 0,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue <= 9_007_199_254_740_991 else { throw invalid(key) }
        return number.uint64Value
    }
    private static func int(_ value: [String: Any], _ key: String) throws -> Int {
        let number = try uint(value, key)
        guard number <= UInt64(Int.max) else { throw invalid(key) }
        return Int(number)
    }
    private static func date(_ value: [String: Any], _ key: String) throws -> Date {
        let raw = try text(value, key, max: 32)
        guard raw.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#, options: .regularExpression) != nil else { throw invalid(key) }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let result = formatter.date(from: raw), result.timeIntervalSinceReferenceDate.isFinite,
              formatter.string(from: result) == raw else { throw invalid(key) }
        return result
    }
    private static func invalid(_ field: String) -> ContestExportLaneError {
        ContestExportLaneError("invalid_params", "Contest export \(field) is invalid.")
    }
}

enum ContestExportDigest {
    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
