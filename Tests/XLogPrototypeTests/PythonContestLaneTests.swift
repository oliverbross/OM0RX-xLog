import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class PythonContestLaneTests: XCTestCase {
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
            dataRootURL: temporary))

        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
        let plugins = try XCTUnwrap(catalog["plugins"] as? [[String: Any]])
        XCTAssertEqual(plugins.count, 1)
        XCTAssertEqual(plugins[0]["id"] as? String, "cq_ww_cw")
        XCTAssertEqual(plugins[0]["engine"] as? String, "not1mm-python")

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

    func testNormalLoggingHealthAdvertisesBundledPythonContestingWithoutLaunchingIt() async throws {
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
        let worker = LiveWorker(logbook: LiveLogbookMethods(
            supportDirectory: temporary.appendingPathComponent("workspace", isDirectory: true),
            inheritNativePreferences: false), runtimeProfile: .production,
            operatingModule: .normalLogging, pythonContestConfiguration: configuration)
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
        await worker.beginTerminalShutdown()
    }
}
