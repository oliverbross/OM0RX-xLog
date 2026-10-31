import Foundation
import XCTest
@testable import XLogPrototypeSupport

/// Real host processes with private stores; no station, network or credential owner.
final class PythonContestLaneConcurrencyTests: XCTestCase {
    func testConcurrentActualHostsKeepIndependentRoundTripsResponsive() async throws {
        let environment = ProcessInfo.processInfo.environment
        let interpreter = try XCTUnwrap(environment["XLOG_CONTEST_PYTHON"])
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: interpreter))
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixtures = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:
            repository.appendingPathComponent("python/tests/fixtures/all_contests_lifecycle.json"))) as? [String: Any])
        let expectedIDs = Set(fixtures.keys)
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-concurrent-python-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false)
        let root = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(temporary), isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let home = root.appendingPathComponent("home", isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: false)
        let launcher = root.appendingPathComponent("isolated-host.py")
        try JSONSerialization.data(withJSONObject: ["home": home.path,
            "launcher": repository.appendingPathComponent("python/contest_host/launcher.py").path])
            .write(to: launcher.deletingPathExtension().appendingPathExtension("json"))
        try """
        import json, os, runpy
        from pathlib import Path
        fixture = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
        for key in ("HOME", "CFFIXED_USER_HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"):
            os.environ[key] = fixture["home"]
        runpy.run_path(fixture["launcher"], run_name="__main__")
        """.write(to: launcher, atomically: true, encoding: .utf8)
        let activeCPUs = ProcessInfo.processInfo.activeProcessorCount
        let count = min(activeCPUs + 1, 24)
        let diagnostic = environment["XLOG_PYTHON_LANE_DIAGNOSTICS"] == "1"
        if diagnostic { print("Private Python concurrency: activeCPUs=\(activeCPUs) lanes=\(count)") }
        let lanes = try (0..<count).map { index in
            try PythonContestLane(configuration: PythonContestHostConfiguration(
                executableURL: URL(fileURLWithPath: interpreter), launcherURL: launcher,
                dataRootURL: root.appendingPathComponent("lane-\(index)", isDirectory: true)))
        }
        do {
            // Keep earlier hosts alive while admitting later ones. Each idle
            // host retains both stdout and stderr readers until shutdown.
            for (index, lane) in lanes.enumerated() {
                let catalog = try await lane.handle(method: "contest_catalog", params: [:])
                let plugins = try XCTUnwrap(catalog["plugins"] as? [[String: Any]])
                XCTAssertEqual(Set(plugins.compactMap { $0["id"] as? String }), expectedIDs)
                if diagnostic { print("Private Python concurrency: admitted=\(index + 1)") }
            }
            let heartbeat = Task { await Task.yield(); return true }
            let responsive = await heartbeat.value
            XCTAssertTrue(responsive)
            let completed = try await withThrowingTaskGroup(of: Int.self, returning: Set<Int>.self) { group in
                for (index, lane) in lanes.enumerated() {
                    group.addTask {
                        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
                        let plugins = try XCTUnwrap(catalog["plugins"] as? [[String: Any]])
                        XCTAssertEqual(Set(plugins.compactMap { $0["id"] as? String }), expectedIDs)
                        return index
                    }
                }
                var indices = Set<Int>()
                for try await index in group { indices.insert(index) }
                return indices
            }
            XCTAssertEqual(completed, Set(0..<count))
        } catch {
            for lane in lanes { await lane.shutdown() }
            throw error
        }
        for lane in lanes { await lane.shutdown() }
    }
}
