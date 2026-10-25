import Foundation

/// Explicit command-line fixture for the signed bundle. No LiveWorker or station
/// service is constructed; only a fresh temporary Python contest store is used.
public enum ContestRecorderAcceptance {
    public static func run() async throws -> [String: Any] {
        try await run(configuration: { try .bundled(applicationSupport: $0) })
    }
    static func run(configuration: (URL) throws -> PythonContestHostConfiguration) async throws -> [String: Any] {
        // Foundation removes the /private prefix when resolving macOS /var.
        // Use the real temp directory, preserving the host symlink prohibition.
        #if os(macOS)
        let parent = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        #else
        let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
        #endif
        let root = parent.appendingPathComponent("xlog-recorder-fixture-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let lane = try PythonContestLane(configuration: configuration(root), n1mmUDPAllowed: false)
        func call(method: String, params: [String: Any]) async throws -> [String: Any] {
            do { return try await lane.handle(method: method, params: params) }
            catch { throw NSError(domain: "RecorderFixture.\(method)", code: 1, userInfo: [NSLocalizedDescriptionKey: String(describing: error)]) }
        }
        do {
            let session = UUID().uuidString.lowercased(), workspace = UUID().uuidString.lowercased()
            let created = try await call(method: "contest_session_create", params: [
                "sessionID": session, "workspaceGeneration": workspace,
                "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
                "pluginID": "cq_ww_ssb", "frequencyHz": 14_200_000,
                "station": ["Call": "OM0RX", "CQZone": "15"], "settings": ["SentExchange": "15"],
            ])
            guard let initial = created["projection"] as? [String: Any],
                  initial["engine"] as? String == "not1mm-python" else {
                throw NSError(domain: "RecorderFixture", code: 1)
            }
            let operation = UUID().uuidString.lowercased(), qso = UUID().uuidString.lowercased()
            let params: [String: Any] = ["sessionID": session, "operationID": operation,
                "qsoID": qso, "expectedRevision": initial["revision"]!,
                "fields": ["callsign": "K1ABC", "other_2": "5"]]
            let committed = try await call(method: "contest_qso_commit", params: params)
            _ = try await call(method: "contest_qso_commit", params: params)
            let commit = try await call(method: "contest_recorder_changes", params: [
                "sessionID": session, "afterSequence": 0, "limit": 200])
            let analytics = try await call(method: "contest_analytics", params: [
                "sessionID": session, "workspaceGeneration": workspace, "action": "prepare"])
            guard let snapshot = analytics["snapshotID"] as? String,
                  let projection = committed["projection"] as? [String: Any] else {
                throw NSError(domain: "RecorderFixture", code: 2)
            }
            let page = try await call(method: "contest_analytics", params: [
                "sessionID": session, "workspaceGeneration": workspace, "action": "page",
                "snapshotID": snapshot, "offset": 0, "limit": 500])
            let changed = try await call(method: "contest_qso_correct", params: [
                "sessionID": session, "operationID": UUID().uuidString.lowercased(),
                "expectedRevision": projection["revision"]!, "qsoID": qso,
                "fields": ["callsign": "DL1ABC"], "reason": "Disposable recorder fixture"])
            let correction = try await call(method: "contest_recorder_changes", params: [
                "sessionID": session, "afterSequence": 0, "limit": 200])
            guard let corrected = changed["projection"] as? [String: Any] else {
                throw NSError(domain: "RecorderFixture", code: 3)
            }
            _ = try await call(method: "contest_qso_delete", params: [
                "sessionID": session, "operationID": UUID().uuidString.lowercased(),
                "expectedRevision": corrected["revision"]!, "qsoID": qso,
                "reason": "Disposable recorder fixture"])
            let deletion = try await call(method: "contest_recorder_changes", params: [
                "sessionID": session, "afterSequence": 0, "limit": 200])
            await lane.shutdown()
            return ["engine": "not1mm-python", "commit": commit, "correction": correction,
                    "deletion": deletion, "analytics": page, "stationWrites": 0,
                    "captureOpened": false, "outputOpened": false, "temporaryStore": true]
        } catch {
            await lane.shutdown()
            throw error
        }
    }
}
