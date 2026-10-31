import Foundation

/// Packaged acceptance of the shipping Swift-to-Python contest bridge. Only a
/// uniquely owned temporary store is opened; no station or service owner exists.
public enum ContestRuntimeSelfTest {
    public struct Failure: Error {
        public let stage: String
    }

    public static func run() async throws -> [String: Any] {
        try await run(configuration: { try .bundled(applicationSupport: $0) })
    }

    static func run(configuration: (URL) throws -> PythonContestHostConfiguration) async throws -> [String: Any] {
        #if os(macOS)
        let parent = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        #else
        let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
        #endif
        let root = parent.appendingPathComponent("xlog-contest-runtime-\(UUID().uuidString)", isDirectory: true)
        var stage = "temporary_storage"
        var ownsRoot = false
        var lane: PythonContestLane?
        func check(_ condition: Bool) throws {
            guard condition else { throw Failure(stage: stage) }
        }
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                     attributes: [.posixPermissions: 0o700])
            ownsRoot = true
            stage = "bundled_runtime"
            let host = try configuration(root)
            try check(host.dataRootURL.standardizedFileURL.path
                      == root.appendingPathComponent("Contesting/Python", isDirectory: true).standardizedFileURL.path)
            stage = "sanitized_environment"
            let environment = PythonContestLane.childEnvironment(n1mmUDPAllowed: false,
                sslCertificateFileURL: host.sslCertificateFileURL)
            var allowedKeys: Set<String> = ["LANG", "LC_ALL", "PYTHONNOUSERSITE", "PYTHONDONTWRITEBYTECODE", "SSL_CERT_FILE"]
            #if os(Windows)
            allowedKeys.insert("SystemRoot")
            try check(environment["SystemRoot"]?.isEmpty == false)
            #endif
            try check(Set(environment.keys).isSubset(of: allowedKeys))
            try check(environment["PYTHONNOUSERSITE"] == "1" && environment["PYTHONDONTWRITEBYTECODE"] == "1")
            let initial = try PythonContestLane(configuration: host, n1mmUDPAllowed: false)
            lane = initial
            stage = "catalogue"
            let catalogue = try await initial.handle(method: "contest_catalog", params: [:])
            let plugins = catalogue["plugins"] as? [[String: Any]] ?? []
            try check(plugins.contains { $0["id"] as? String == "cq_ww_cw" && $0["engine"] as? String == "not1mm-python" })
            let session = UUID().uuidString.lowercased(), workspace = UUID().uuidString.lowercased()
            stage = "create"
            let created = try await initial.handle(method: "contest_session_create", params: [
                "sessionID": session, "workspaceGeneration": workspace,
                "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
                "pluginID": "cq_ww_cw", "frequencyHz": 14_025_000,
                "station": ["Call": "N0CALL", "CQZone": "5"], "settings": ["SentExchange": "5"],
            ])
            let projection = created["projection"] as? [String: Any] ?? [:]
            try check(projection["pluginID"] as? String == "cq_ww_cw"
                      && projection["engine"] as? String == "not1mm-python"
                      && projection["workspaceGeneration"] as? String == workspace)
            guard let revision = projection["revision"] as? Int else { throw Failure(stage: stage) }
            stage = "commit"
            let qso = UUID().uuidString.lowercased()
            _ = try await initial.handle(method: "contest_qso_commit", params: [
                "sessionID": session, "operationID": UUID().uuidString.lowercased(),
                "qsoID": qso, "expectedRevision": revision,
                "fields": ["callsign": "DL1ABC", "other_2": "14"],
            ])
            func read(_ owner: PythonContestLane) async throws {
                let log = try await owner.handle(method: "contest_log", params: ["sessionID": session, "offset": 0, "limit": 2])
                let rows = log["rows"] as? [[String: Any]] ?? []
                try check(rows.count == 1 && rows.first?["ID"] as? String == qso
                          && rows.first?["Call"] as? String == "DL1ABC" && rows.first?["Mode"] as? String == "CW")
            }
            stage = "read"
            try await read(initial)
            stage = "shutdown"
            await initial.shutdown()
            lane = nil
            stage = "reopen"
            let reopened = try PythonContestLane(configuration: host, n1mmUDPAllowed: false)
            lane = reopened
            let opened = try await reopened.handle(method: "contest_session_open", params: ["sessionID": session])
            let reopenedProjection = opened["projection"] as? [String: Any] ?? [:]
            try check(reopenedProjection["sessionID"] as? String == session
                      && reopenedProjection["workspaceGeneration"] as? String == workspace
                      && reopenedProjection["engine"] as? String == "not1mm-python")
            try await read(reopened)
            await reopened.shutdown()
            lane = nil
            stage = "cleanup"
            try await removeTemporaryStore(root)
            ownsRoot = false
            return ["passed": true, "engine": "not1mm-python", "synthetic_records": true,
                "catalogue": true, "catalogue_count": plugins.count, "save_read": true, "reopened": true,
                "qso_count": 1, "station_io": false, "network_contact": false, "credentials_accessed": false,
                "temporary_store_removed": true, "shipping_shutdown": true,
                "checks": ["bundled_locator", "sanitized_environment", "catalogue", "create_cq_ww_cw",
                           "commit_read", "restart_reopen", "shipping_shutdown", "temporary_cleanup"]]
        } catch {
            await lane?.shutdown()
            if ownsRoot { try? await removeTemporaryStore(root) }
            // Child diagnostics and paths must never reach the acceptance JSON.
            throw Failure(stage: stage)
        }
    }

    private static func removeTemporaryStore(_ root: URL) async throws {
        // Shipping shutdown terminates the host. Windows may release its SQL
        // handles shortly afterward, so allow a bounded cleanup interval.
        for attempt in 0..<100 {
            do { try FileManager.default.removeItem(at: root); return }
            catch {
                if !FileManager.default.fileExists(atPath: root.path) { return }
                guard attempt < 99 else { throw error }
                try await Task.sleep(nanoseconds: 25_000_000)
            }
        }
    }
}
