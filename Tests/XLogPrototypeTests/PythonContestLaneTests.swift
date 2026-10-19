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
        let result = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": sessionID,
            "operationID": UUID().uuidString.lowercased(),
            "expectedRevision": 0,
            "pluginID": "cq_ww_cw",
            "station": ["Call": "OM0RX", "CQZone": "15"],
            "settings": ["SentExchange": "15"],
        ])
        XCTAssertEqual(result["sessionID"] as? String, sessionID)
        XCTAssertEqual(result["revision"] as? Int, 1)
        let projection = try XCTUnwrap(result["projection"] as? [String: Any])
        XCTAssertEqual(projection["engine"] as? String, "not1mm-python")
        XCTAssertEqual(projection["pluginID"] as? String, "cq_ww_cw")
        XCTAssertEqual(projection["referenceID"] as? String, try ContestReferenceData.bundled().version)

        await lane.shutdown()
        do {
            _ = try await lane.handle(method: "contest_catalog", params: [:])
            XCTFail("A retired contest host must reject new work.")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "worker_stopping")
            XCTAssertEqual(error.outcome, "confirmed")
        }
    }
}
