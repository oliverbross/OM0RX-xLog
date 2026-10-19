import Foundation
import XContestCore

/// Reuses xLog's retained, local-only SCP index for the active Python contest.
/// Selection is advisory: the renderer still applies the chosen callsign through
/// the Python session's revision-fenced draft mutation owner.
actor PythonContestAssistanceLane {
    typealias ScopeValidator = @Sendable (ContestAssistanceScope) async throws -> Void

    private let service: ContestSCPService

    init(contestingRoot: URL, validateScope: @escaping ScopeValidator) throws {
        let cacheURL = contestingRoot.appendingPathComponent("SuperCheckPartial", isDirectory: true)
            .appendingPathComponent("current.json")
        let applicationRoot = contestingRoot.deletingLastPathComponent()
        let applicationSupport = applicationRoot.deletingLastPathComponent()
        let protected = [applicationRoot.appendingPathComponent("OM0RX-xLog.sqlite"),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite")]
        service = try ContestSCPService(cacheURL: cacheURL, validatePrivateRoot: {
            try Self.validateCache(cacheURL, root: contestingRoot,
                applicationRoot: applicationRoot, protected: protected)
        }, validateScope: validateScope)
    }

    func shutdown() async { await service.shutdown() }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        do {
            switch method {
            case "contest_scp_status":
                try Self.exact(params, [])
                let status = await service.status()
                return ["dataset": status.dataset.map(Self.datasetWire) ?? NSNull(),
                        "unavailableReason": status.unavailableReason ?? NSNull()]
            case "contest_scp_import_private":
                try Self.exact(params, ["path", "sourceName"])
                let dataset = try await service.importFile(path: try Self.text(params, "path", maximum: 4_096),
                    sourceName: try Self.text(params, "sourceName", maximum: 256), retrievedAt: Date())
                return ["dataset": Self.datasetWire(dataset)]
            case "contest_scp_query":
                try Self.exact(params, ["sessionID", "workspaceGeneration", "requestID", "query"])
                let context = try Self.context(params)
                return Self.queryWire(try await service.query(
                    try Self.text(params, "query", maximum: 32), context: context))
            case "contest_scp_cancel":
                try Self.exact(params, ["sessionID", "workspaceGeneration", "requestID"])
                return ["cancelled": try await service.cancel(context: Self.context(params))]
            case "contest_scp_select":
                try Self.exact(params, ["sessionID", "workspaceGeneration", "requestID", "matchID"])
                return ["callsign": try await service.selectedCallsign(
                    matchID: try Self.text(params, "matchID", maximum: 160), context: Self.context(params))]
            default:
                throw ContestLaneError.confirmed("unknown_method", "Unknown callsign-assistance method.")
            }
        } catch let error as ContestLaneError { throw error }
          catch let error as ContestAssistanceLaneError { throw Self.map(error) }
          catch is ContestSCPServiceError {
            throw ContestLaneError.confirmed("scp_import_failed", "The selected SCP file could not be imported.")
        } catch is ContestSCPError {
            throw ContestLaneError.confirmed("invalid_scp", "The SCP dataset or query is invalid.")
        }
    }

    private static func context(_ params: [String: Any]) throws -> ContestAssistanceContext {
        ContestAssistanceContext(sessionID: try uuid(params, "sessionID"),
            workspaceGeneration: try uuid(params, "workspaceGeneration"),
            requestID: try uuid(params, "requestID"))
    }

    private static func exact(_ params: [String: Any], _ keys: Set<String>) throws {
        guard Set(params.keys) == keys else {
            throw ContestLaneError.confirmed("invalid_params", "The callsign-assistance request is invalid.")
        }
    }

    private static func text(_ params: [String: Any], _ key: String, maximum: Int) throws -> String {
        guard let value = params[key] as? String, !value.isEmpty, value.utf8.count <= maximum,
              !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
            throw ContestLaneError.confirmed("invalid_params", "The callsign-assistance request is invalid.")
        }
        return value
    }

    private static func uuid(_ params: [String: Any], _ key: String) throws -> String {
        let value = try text(params, key, maximum: 36)
        guard let parsed = UUID(uuidString: value), parsed.uuidString.lowercased() == value else {
            throw ContestLaneError.confirmed("invalid_params", "The callsign-assistance context is invalid.")
        }
        return value
    }

    private static func datasetWire(_ dataset: ContestSCPDatasetInfo) -> [String: Any] {
        ["sourceID": dataset.provenance.sourceID, "version": dataset.provenance.version,
         "retrievedAtUTC": dataset.provenance.retrievedAtUTC.map {
             ISO8601DateFormatter().string(from: $0)
         } ?? NSNull(), "sha256": dataset.sha256, "byteCount": dataset.byteCount,
         "recordCount": dataset.recordCount, "duplicateCount": dataset.duplicateCount,
         "digestVerification": dataset.digestVerification.rawValue]
    }

    private static func queryWire(_ result: ContestSCPQueryResult) -> [String: Any] {
        ["sessionID": result.context.sessionID, "workspaceGeneration": result.context.workspaceGeneration,
         "requestID": result.context.requestID, "normalizedQuery": result.normalizedQuery,
         "matches": result.matches.map { ["matchID": $0.matchID, "callsign": $0.callsign,
             "score": $0.score, "isPrefixMatch": $0.isPrefixMatch] },
         "dataset": datasetWire(result.dataset), "evaluatedRecordCount": result.evaluatedRecordCount,
         "isPartial": result.isPartial]
    }

    private static func map(_ error: ContestAssistanceLaneError) -> ContestLaneError {
        switch error {
        case .dataUnavailable: return .confirmed("scp_unavailable", "Import a local MASTER.SCP file to enable callsign suggestions.")
        case .invalidContext, .staleResult: return .confirmed("stale_context", "The callsign suggestion belongs to another contest context.")
        case .requestReused: return .confirmed("request_reused", "The callsign request ID was already used.")
        case .capacityExceeded: return .confirmed("scp_busy", "Callsign assistance is busy; wait for an earlier query to settle.")
        case .cancelled: return .confirmed("cancelled", "The callsign query was cancelled.")
        case .stopped: return .confirmed("scp_unavailable", "Callsign assistance is shut down.")
        case .resultUnavailable, .unknownMatch: return .confirmed("selection_unavailable", "The callsign suggestion is no longer available.")
        case .unverifiedDataset, .invalidLimits: return .confirmed("scp_unavailable", "The local SCP dataset is unavailable.")
        }
    }

    private static func validateCache(_ cacheURL: URL, root: URL, applicationRoot: URL,
                                      protected: [URL], fileManager: FileManager = .default) throws {
        let file = cacheURL.standardizedFileURL
        let privateRoot = root.standardizedFileURL
        let boundary = applicationRoot.standardizedFileURL
        let fileWithinRoot = ContestDatabaseBoundary.isStrictDescendant(file, of: privateRoot)
        let rootWithinBoundary = ContestDatabaseBoundary.isStrictDescendant(privateRoot, of: boundary)
        guard fileWithinRoot, rootWithinBoundary else {
            throw ContestLaneError.confirmed("unsafe_workspace", "The contest assistance cache is not isolated from production data.")
        }
        var candidate = file
        while candidate.path != boundary.path {
            let values = try? candidate.resourceValues(forKeys: [.isSymbolicLinkKey])
            if fileManager.fileExists(atPath: candidate.path) || values?.isSymbolicLink == true {
                guard values?.isSymbolicLink != true else {
                    throw ContestLaneError.confirmed("unsafe_workspace", "The contest assistance cache traverses a symbolic link.")
                }
            }
            candidate = candidate.deletingLastPathComponent()
        }
        guard fileManager.fileExists(atPath: file.path) else { return }
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
            throw ContestLaneError.confirmed("unsafe_workspace", "The contest assistance cache is not a private regular file.")
        }
        let isolated = try fileManager.attributesOfItem(atPath: file.path)
        for item in protected where fileManager.fileExists(atPath: item.path) {
            let production = try fileManager.attributesOfItem(atPath: item.path)
            guard !sameFile(isolated, production) else {
                throw ContestLaneError.confirmed("unsafe_workspace", "The contest assistance cache aliases a protected database.")
            }
        }
    }

    private static func sameFile(_ lhs: [FileAttributeKey: Any], _ rhs: [FileAttributeKey: Any]) -> Bool {
        guard let lhsFile = lhs[.systemFileNumber] as? NSNumber,
              let rhsFile = rhs[.systemFileNumber] as? NSNumber,
              let lhsSystem = lhs[.systemNumber] as? NSNumber,
              let rhsSystem = rhs[.systemNumber] as? NSNumber else { return false }
        return lhsFile == rhsFile && lhsSystem == rhsSystem
    }
}
