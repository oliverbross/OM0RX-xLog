import Foundation
import XCTest
@testable import XLogPrototypeSupport

/// Current native bridge -> isolated Python JSONL host, never the retired Swift engine.
final class PythonCatalogueReadinessTests: XCTestCase {
    func testEveryRegisteredFixtureCommitsThroughTheNativePythonLane() async throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixtureURL = repository.appendingPathComponent("python/tests/fixtures/all_contests_lifecycle.json")
        let fixtures = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: [String: Any]])
        let candidates = [ProcessInfo.processInfo.environment["XLOG_CONTEST_PYTHON"],
                          "/opt/local/bin/python3.12", "/opt/homebrew/bin/python3.12"]
        let interpreter = try XCTUnwrap(candidates.compactMap { $0 }.first {
            FileManager.default.isExecutableFile(atPath: $0)
        }, "Python 3.12 is required for current-host qualification")
        let root = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("xlog-native-catalogue-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: URL(fileURLWithPath: interpreter),
            launcherURL: repository.appendingPathComponent("python/contest_host/launcher.py"), dataRootURL: root))
        do {
            let catalog = try await lane.handle(method: "contest_catalog", params: [:])
            let plugins = try XCTUnwrap(catalog["plugins"] as? [[String: Any]])
            XCTAssertEqual(Set(plugins.compactMap { $0["id"] as? String }), Set(fixtures.keys))
            for plugin in fixtures.keys.sorted() {
                do {
                let fixture = try XCTUnwrap(fixtures[plugin])
                let state = try XCTUnwrap(fixture["state"] as? [String: Any])
                let draft = try XCTUnwrap(state["draft"] as? [String: Any])
                let session = UUID().uuidString.lowercased(), generation = UUID().uuidString.lowercased()
                let created = try await lane.handle(method: "contest_session_create", params: [
                    "sessionID": session, "workspaceGeneration": generation,
                    "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
                    "pluginID": plugin, "station": state["station"]!, "settings": state["settings"]!,
                    "frequencyHz": draft["frequencyHz"]!, "mode": fixture["mode"]!,
                ])
                let projection = try XCTUnwrap(created["projection"] as? [String: Any])
                XCTAssertEqual(projection["engine"] as? String, "not1mm-python", plugin)
                XCTAssertEqual(projection["pluginID"] as? String, plugin)
                let qso = UUID().uuidString.lowercased()
                var fields = try XCTUnwrap(fixture["fields"] as? [String: String])
                if let allocated = projection["allocatedSerialFieldID"] as? String,
                   projection["reservedSerial"] is NSNumber,
                   let entry = projection["fields"] as? [[String: Any]],
                   let value = entry.first(where: { $0["id"] as? String == allocated })?["value"] as? String {
                    fields[allocated] = value
                }
                let committed = try await lane.handle(method: "contest_qso_commit", params: [
                    "sessionID": session, "operationID": UUID().uuidString.lowercased(),
                    "expectedRevision": projection["revision"]!, "draftID": projection["draftID"]!,
                    "qsoID": qso, "timestamp": "2026-10-21 10:00:00", "fields": fields,
                ])
                let log = try await lane.handle(method: "contest_log_page", params: ["sessionID": session])
                let row = try XCTUnwrap((log["rows"] as? [[String: Any]])?.first, plugin)
                XCTAssertEqual(row["ID"] as? String, qso, plugin)
                XCTAssertEqual(row["TS"] as? String, "2026-10-21 10:00:00", plugin)
                XCTAssertEqual(log["total"] as? Int, 1, plugin)
                let updated = try XCTUnwrap(committed["projection"] as? [String: Any])
                XCTAssertEqual(updated["workspaceGeneration"] as? String, generation, plugin)
                let opened = try await lane.handle(method: "contest_session_open", params: ["sessionID": session])
                XCTAssertEqual((opened["projection"] as? [String: Any])?["pluginID"] as? String, plugin)
                } catch {
                    XCTFail("\(plugin): \(error)")
                }
            }
            await lane.shutdown()
        } catch {
            await lane.shutdown()
            throw error
        }
    }
}
