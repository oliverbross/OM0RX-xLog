import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class PythonContestLaneTests: XCTestCase {
    func testCWOPSOpenOriginalPluginSerialDupeAndScoreThroughNativeBridge() async throws {
        let root = repositoryRoot()
        let temporary = URL(fileURLWithPath: FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/"))
            .appendingPathComponent("xlog-cwo-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: try python312(), launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("Contesting/Python")))
        let session = UUID().uuidString.lowercased()
        let workspace = UUID().uuidString.lowercased()
        let created = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": session, "workspaceGeneration": workspace,
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0, "pluginID": "cwo",
            "frequencyHz": 14_025_000, "station": ["Call": "OM0RX", "Name": "OLIVER BROSS"],
            "settings": ["SentExchange": "OLIVER"],
        ])
        let projection = try XCTUnwrap(created["projection"] as? [String: Any])
        XCTAssertEqual(projection["pluginName"] as? String, "CWOPS - Open")
        XCTAssertEqual(projection["reservedSerial"] as? Int, 1)
        XCTAssertEqual(projection["allowDuplicateCommit"] as? Bool, true)
        let committed = try await lane.handle(method: "contest_qso_commit", params: [
            "sessionID": session, "operationID": UUID().uuidString.lowercased(), "expectedRevision": 1,
            "fields": ["callsign": "K1ABC", "other_2": "12 ALICE"],
        ])
        let next = try XCTUnwrap(committed["projection"] as? [String: Any])
        let score = try XCTUnwrap(next["score"] as? [String: Any])
        XCTAssertEqual(next["reservedSerial"] as? Int, 2)
        XCTAssertEqual(score["uniqueCalls"] as? Int, 1)
        XCTAssertEqual(score["total"] as? Int, 1)
        await lane.shutdown()
    }

    func testICWCMSTOriginalPluginSerialAndScoreThroughNativeBridge() async throws {
        let root = repositoryRoot()
        let temporary = URL(fileURLWithPath: FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/"))
            .appendingPathComponent("xlog-mst-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: try python312(), launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("Contesting/Python")))
        let session = UUID().uuidString.lowercased()
        let created = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": session, "workspaceGeneration": UUID().uuidString.lowercased(),
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0, "pluginID": "icwc_mst",
            "frequencyHz": 14_025_000, "station": ["Call": "OM0RX"], "settings": ["SentExchange": "OLIVER"],
        ])
        let projection = try XCTUnwrap(created["projection"] as? [String: Any])
        XCTAssertEqual(projection["pluginName"] as? String, "ICWC Medium Speed Test")
        XCTAssertEqual(projection["reservedSerial"] as? Int, 1)
        let committed = try await lane.handle(method: "contest_qso_commit", params: [
            "sessionID": session, "operationID": UUID().uuidString.lowercased(), "expectedRevision": 1,
            "fields": ["callsign": "K1ABC", "other_2": "BOB 12"],
        ])
        let next = try XCTUnwrap(committed["projection"] as? [String: Any])
        let score = try XCTUnwrap(next["score"] as? [String: Any])
        XCTAssertEqual(next["reservedSerial"] as? Int, 2)
        XCTAssertEqual(score["uniqueCalls"] as? Int, 1)
        XCTAssertEqual(score["total"] as? Int, 1)
        await lane.shutdown()
    }

    private func python312() throws -> URL {
        let fileManager = FileManager.default
        let candidates = [
            ProcessInfo.processInfo.environment["XLOG_TEST_PYTHON312"],
            "/opt/homebrew/bin/python3.12",
            "/usr/local/bin/python3.12",
        ].compactMap { $0 }
        guard let path = candidates.first(where: fileManager.isExecutableFile(atPath:)) else {
            throw XCTSkip("Python 3.12 was not provided for the actual-plugin bridge test.")
        }
        return URL(fileURLWithPath: path)
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    func testActualPinnedHostRunsThroughBoundedSerializedBridge() async throws {
        let root = repositoryRoot()
        let basePath = FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/")
        let temporary = URL(fileURLWithPath: basePath, isDirectory: true)
            .appendingPathComponent("xlog-python-contest-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: try python312(),
            launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("Contesting/Python", isDirectory: true)))

        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
        let plugins = try XCTUnwrap(catalog["plugins"] as? [[String: Any]])
        XCTAssertEqual(Set(plugins.compactMap { $0["id"] as? String }),
                       Set(["cq_ww_cw", "cq_wpx_cw", "arrl_ss_cw", "icwc_mst", "cwt", "cwo", "k1usn_sst", "trans_tasman"]))
        let cqww = try XCTUnwrap(plugins.first { $0["id"] as? String == "cq_ww_cw" })
        XCTAssertEqual(cqww["engine"] as? String, "not1mm-python")

        let sessionID = UUID().uuidString.lowercased()
        let workspaceGeneration = UUID().uuidString.lowercased()
        let result = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": sessionID,
            "workspaceGeneration": workspaceGeneration,
            "operationID": UUID().uuidString.lowercased(),
            "expectedRevision": 0,
            "pluginID": "cq_ww_cw",
            "frequencyHz": 14_025_000,
            "station": ["Call": "OM0RX", "CQZone": "15"],
            "settings": ["SentExchange": "15"],
        ])
        XCTAssertEqual(result["sessionID"] as? String, sessionID)
        XCTAssertEqual(result["revision"] as? Int, 1)
        let projection = try XCTUnwrap(result["projection"] as? [String: Any])
        XCTAssertEqual(projection["engine"] as? String, "not1mm-python")
        XCTAssertEqual(projection["pluginID"] as? String, "cq_ww_cw")
        XCTAssertEqual(projection["workspaceGeneration"] as? String, workspaceGeneration)
        XCTAssertEqual(projection["referenceID"] as? String, try ContestReferenceData.bundled().version)
        let cw = try await lane.handle(method: "contest_cw_context", params: [:])
        XCTAssertEqual(cw["sessionID"] as? String, sessionID)
        XCTAssertEqual(cw["stationCall"] as? String, "OM0RX")

        let scpSource = temporary.appendingPathComponent("MASTER.SCP")
        try Data("K1ABC\nK1ABD\nDL1ABC\n".utf8).write(to: scpSource)
        _ = try await lane.handleAssistance(method: "contest_scp_import_private", params: [
            "path": scpSource.path, "sourceName": "MASTER.SCP",
        ])
        let assistanceRequest = UUID().uuidString.lowercased()
        let assistance = try await lane.handleAssistance(method: "contest_scp_query", params: [
            "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
            "requestID": assistanceRequest, "query": "K1AB",
        ])
        let matches = try XCTUnwrap(assistance["matches"] as? [[String: Any]])
        let firstMatch = try XCTUnwrap(matches.first)
        let selected = try await lane.handleAssistance(method: "contest_scp_select", params: [
            "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
            "requestID": assistanceRequest, "matchID": try XCTUnwrap(firstMatch["matchID"] as? String),
        ])
        XCTAssertEqual(selected["callsign"] as? String, firstMatch["callsign"] as? String)
        do {
            _ = try await lane.handleAssistance(method: "contest_scp_query", params: [
                "sessionID": sessionID, "workspaceGeneration": UUID().uuidString.lowercased(),
                "requestID": UUID().uuidString.lowercased(), "query": "K1AB",
            ])
            XCTFail("SCP queries must remain fenced to the active Python session.")
        } catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_context") }

        let outputOperation = UUID().uuidString.lowercased()
        let function = try await lane.handle(method: "contest_function_key", params: [
            "sessionID": sessionID, "operationID": outputOperation, "expectedRevision": 1,
            "draftID": try XCTUnwrap(projection["draftID"] as? String),
            "key": "F1", "fields": ["callsign": "K1ABC"], "frequencyHz": 14_025_000,
        ])
        let claim = try await lane.handle(method: "contest_output_claim", params: [
            "sessionID": sessionID, "operationID": outputOperation, "revision": try XCTUnwrap(function["revision"] as? Int),
        ])
        XCTAssertEqual(claim["claimed"] as? Bool, true)
        do {
            _ = try await lane.handle(method: "contest_output_claim", params: [
                "sessionID": UUID().uuidString.lowercased(), "operationID": outputOperation, "revision": 2,
            ])
            XCTFail("Output claims must belong to the active session.")
        } catch let error as ContestLaneError { XCTAssertEqual(error.code, "contest_session_inactive") }

        await lane.shutdown()
        do {
            _ = try await lane.handle(method: "contest_catalog", params: [:])
            XCTFail("A retired contest host must reject new work.")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "worker_stopping")
            XCTAssertEqual(error.outcome, "confirmed")
        }
    }

    func testCallHistoryActivationSerializesHostTrafficAndNormalizesSQLiteLookupCall() async throws {
        let root = repositoryRoot()
        let basePath = FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/")
        let temporary = URL(fileURLWithPath: basePath, isDirectory: true)
            .appendingPathComponent("xlog-python-history-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: try python312(),
            launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("Contesting/Python", isDirectory: true)))
        let sessionID = UUID().uuidString.lowercased()
        let workspaceGeneration = UUID().uuidString.lowercased()
        _ = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_cw", "frequencyHz": 14_025_000,
            "station": ["Call": "OM0RX", "CQZone": "15"],
            "settings": ["SentExchange": "15"],
        ])

        let source = temporary.appendingPathComponent("operator-history.txt")
        var data = Data("!!Order!!,Call,CqZone,UserText\n k1abc ,04,normalized lookup\n".utf8)
        for index in 0..<3_000 {
            data.append(Data("K\(index)XYZ,05,row \(index)\n".utf8))
        }
        try data.write(to: source)
        let preview = try await lane.handleCallHistory(method: "contest_history_preview_private", params: [
            "path": source.path, "sourceName": source.lastPathComponent,
            "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
        ])
        let commit = Task {
            try await lane.handleCallHistory(method: "contest_history_preview_commit", params: [
                "previewID": try XCTUnwrap(preview["previewID"] as? String),
                "sha256": try XCTUnwrap(preview["sha256"] as? String),
                "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
                "confirmAdvisories": false,
            ])
        }
        await Task.yield()
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<12 {
                group.addTask {
                    _ = try await lane.handle(method: "contest_projection", params: ["sessionID": sessionID])
                }
            }
            try await group.waitForAll()
        }
        let committed = try await commit.value
        let activation = try XCTUnwrap(committed["activation"] as? [String: Any])
        XCTAssertEqual(activation["state"] as? String, "active", String(describing: activation["message"]))

        let applied = try await lane.handle(method: "contest_draft_apply", params: [
            "sessionID": sessionID, "operationID": UUID().uuidString.lowercased(),
            "expectedRevision": 1, "fields": ["callsign": "K1ABC", "other_2": ""],
        ])
        let projection = try XCTUnwrap(applied["projection"] as? [String: Any])
        XCTAssertEqual(projection["history"] as? String, "K1ABC, 4, normalized lookup")

        // Native admission can occur while A is active even when an already
        // queued open of B executes first. The serialized lane must retain A's
        // expected identity instead of silently retargeting the request to B.
        let nextSessionID = UUID().uuidString.lowercased()
        _ = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": nextSessionID, "workspaceGeneration": workspaceGeneration,
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_cw", "frequencyHz": 14_025_000,
            "station": ["Call": "OM0RX", "CQZone": "15"],
            "settings": ["SentExchange": "15"],
        ])
        do {
            _ = try await lane.handleCallHistory(method: "contest_history_status", params: [
                "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
            ])
            XCTFail("A history request admitted for the prior session must not run in the new session.")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "stale_history_context")
            XCTAssertEqual(error.outcome, "confirmed")
        }
        await lane.shutdown()
    }

    func testNormalLoggingWorkerInterleavesLogbookAndPythonContestWorkInOneGeneration() async throws {
        let root = repositoryRoot()
        let basePath = FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/")
        let temporary = URL(fileURLWithPath: basePath, isDirectory: true)
            .appendingPathComponent("xlog-python-health-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let configuration = PythonContestHostConfiguration(
            executableURL: try python312(),
            launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("contest", isDirectory: true))
        let logbook = LiveLogbookMethods(
            supportDirectory: temporary.appendingPathComponent("workspace", isDirectory: true),
            inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: .production,
            operatingModule: .normalLogging, pythonContestConfiguration: configuration)
        await worker.startBackgroundServices()
        let request = try JSONSerialization.data(withJSONObject: [
            "id": "health", "method": "health", "params": [:],
        ])
        let responseData = await worker.response(to: request)
        let response = try XCTUnwrap(try JSONSerialization.jsonObject(with: responseData) as? [String: Any])
        let health = try XCTUnwrap(response["result"] as? [String: Any])
        XCTAssertEqual(health["mode"] as? String, "integrated")
        XCTAssertEqual(health["contesting_engine"] as? String, "not1mm-python")
        XCTAssertEqual(health["contesting_available"] as? Bool, true)
        XCTAssertEqual(health["isolated_workspace"] as? Bool, false)

        let settingsRequest = try JSONSerialization.data(withJSONObject: [
            "id": "settings", "method": "settings_load", "params": [:],
        ])
        let settingsData = await worker.response(to: settingsRequest)
        let settingsReply = try XCTUnwrap(try JSONSerialization.jsonObject(with: settingsData) as? [String: Any])
        let settings = try XCTUnwrap(settingsReply["result"] as? [String: Any])
        let generation = try XCTUnwrap(settings["generation"] as? String)

        let logbookRequest = try JSONSerialization.data(withJSONObject: [
            "id": "normal-logbook", "method": "logbook_stats", "params": [:],
        ])
        let sessionID = UUID().uuidString.lowercased()
        let contestRequest = try JSONSerialization.data(withJSONObject: [
            "id": "python-contest", "method": "contest_session_create", "params": [
                "sessionID": sessionID,
                "workspaceGeneration": generation,
                "operationID": UUID().uuidString.lowercased(),
                "expectedRevision": 0,
                "pluginID": "cq_ww_cw",
                "frequencyHz": 14_025_000,
                "station": ["Call": "OM0RX", "CQZone": "15"],
                "settings": ["SentExchange": "15"],
            ],
        ] as [String: Any])
        async let logbookData = worker.response(to: logbookRequest)
        async let contestData = worker.response(to: contestRequest)
        let (normalReplyData, contestReplyData) = await (logbookData, contestData)
        let normalReply = try XCTUnwrap(try JSONSerialization.jsonObject(with: normalReplyData) as? [String: Any])
        let contestReply = try XCTUnwrap(try JSONSerialization.jsonObject(with: contestReplyData) as? [String: Any])
        XCTAssertEqual(normalReply["id"] as? String, "normal-logbook")
        XCTAssertEqual(normalReply["ok"] as? Bool, true)
        XCTAssertEqual(((normalReply["result"] as? [String: Any])?["stats"] as? [String: Any])?["qso_count"] as? Int, 0)
        XCTAssertEqual(contestReply["id"] as? String, "python-contest")
        XCTAssertEqual(contestReply["ok"] as? Bool, true)
        let projection = ((contestReply["result"] as? [String: Any])?["projection"] as? [String: Any])
        XCTAssertEqual(projection?["sessionID"] as? String, sessionID)
        XCTAssertEqual(projection?["workspaceGeneration"] as? String, generation)
        XCTAssertEqual(projection?["engine"] as? String, "not1mm-python")
        let background = await worker.backgroundServiceStateForTesting()
        XCTAssertTrue(background.sync); XCTAssertTrue(background.delivery)
        await worker.shutdown()
    }
}
