import Foundation
import XCTest
import CSQLitePrototype
@testable import XLogPrototypeSupport
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

/// Current native bridge -> isolated Python JSONL host, never the retired Swift engine.
final class PythonCatalogueReadinessTests: XCTestCase {
    private func isolatedHost(repository: URL, prefix: String) throws
        -> (root: URL, configuration: PythonContestHostConfiguration) {
        let candidates = [ProcessInfo.processInfo.environment["XLOG_CONTEST_PYTHON"],
                          "/usr/bin/python3.12", "/opt/local/bin/python3.12", "/opt/homebrew/bin/python3.12"]
        let interpreter = try XCTUnwrap(candidates.compactMap { $0 }.first {
            FileManager.default.isExecutableFile(atPath: $0)
        }, "Python 3.12 is required for current-host qualification")
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        do {
            // Python rejects symlink traversal. Foundation retains /var aliases
            // on macOS, so reuse the acceptance boundary's physical resolver.
            let root = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(temporary), isDirectory: true)
            let home = root.appendingPathComponent("home", isDirectory: true)
            let roaming = home.appendingPathComponent("AppData/Roaming", isDirectory: true)
            let local = home.appendingPathComponent("AppData/Local", isDirectory: true)
            for directory in [home, roaming, local] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            }
            // Only this disposable child receives private home/profile roots.
            // A Python entry script preserves the actual interpreter on Windows
            // as well as Unix, without a shell or process-wide env mutation.
            let wrapper = root.appendingPathComponent("isolated-host.py")
            let environment = ["HOME": home.path, "CFFIXED_USER_HOME": home.path,
                               "USERPROFILE": home.path, "APPDATA": roaming.path, "LOCALAPPDATA": local.path]
            try JSONSerialization.data(withJSONObject: ["environment": environment,
                "launcher": repository.appendingPathComponent("python/contest_host/launcher.py").path])
                .write(to: wrapper.deletingPathExtension().appendingPathExtension("json"))
            try """
            import json, os, runpy
            from pathlib import Path
            configuration = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
            os.environ.update(configuration["environment"])
            runpy.run_path(configuration["launcher"], run_name="__main__")
            """.write(to: wrapper, atomically: true, encoding: .utf8)
            return (root, PythonContestHostConfiguration(executableURL: URL(fileURLWithPath: interpreter),
                launcherURL: wrapper, dataRootURL: root.appendingPathComponent("support", isDirectory: true)))
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }

    func testMultiplierUniverseProducerBindsTheCompletePrimaryMapping() throws {
        let reference = try ContestReferenceData.bundled()
        let csv = try CTYResolver.bundledCSV()
        let coordinate = try XCTUnwrap(PythonContestLane.multiplierUniverse(reference: reference, csv: csv))
        let entries = try XCTUnwrap(coordinate["entries"] as? [[String: String]])
        XCTAssertEqual(entries.count, 346)
        XCTAssertGreaterThan(entries.count, reference.primaryPrefixes.count)
        XCTAssertTrue(entries.contains { $0["value"] == "*IT9" })
        XCTAssertEqual(coordinate["referenceID"] as? String, reference.version)
        XCTAssertEqual(coordinate["sourceSHA256"] as? String,
                       "e5d907fb16842cfa3dd8502c20ebe6bfc2039c6f5b2cc73f9ea6d3f5915f6d6d")
        XCTAssertEqual(coordinate["entriesSHA256"] as? String,
                       "7c2fddb7f9d508b114f040d4d4a8f187f49c3d59394bb50cf225ac1c1cc5eeee")
        XCTAssertNil(PythonContestLane.multiplierUniverse(reference: reference, csv: csv + "\n"))
        for changedVersion in [false, true] {
            var names = reference.entityNamesByPrefix
            if !changedVersion { names.removeValue(forKey: "*IT9") }
            let changed = ContestReferenceData(resolver: reference.resolver,
                version: changedVersion ? "unreviewed-reference" : reference.version,
                primaryPrefixes: reference.primaryPrefixes, entityNames: reference.entityNames,
                entityNamesByPrefix: names, countryReference: reference.countryReference,
                countryContinentsByPrefix: reference.countryContinentsByPrefix)
            XCTAssertNil(PythonContestLane.multiplierUniverse(reference: changed, csv: csv))
        }
    }

    func testNativeMultiplierUniversePersistsOnlyAtCreationAndSuppliesReadOnlyMatchingContext() async throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixtures = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:
            repository.appendingPathComponent("python/tests/fixtures/all_contests_lifecycle.json"))) as? [String: [String: Any]])
        let fixture = try XCTUnwrap(fixtures["cq_ww_cw"])
        let state = try XCTUnwrap(fixture["state"] as? [String: Any])
        let draft = try XCTUnwrap(state["draft"] as? [String: Any])
        let isolated = try isolatedHost(repository: repository, prefix: "xlog-native-universe")
        let root = isolated.root
        defer { try? FileManager.default.removeItem(at: root) }
        let lane = try PythonContestLane(configuration: isolated.configuration)
        func storedReference(_ session: String) throws -> [String: Any] {
            let url = root.appendingPathComponent("support/\(session)/contest.sqlite")
            var database: OpaquePointer?, statement: OpaquePointer?
            guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                throw NSError(domain: "test-read-only-state", code: 1)
            }
            defer { sqlite3_finalize(statement); sqlite3_close(database) }
            guard sqlite3_prepare_v2(database, "SELECT state FROM xlog_session", -1, &statement, nil) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_ROW, let bytes = sqlite3_column_text(statement, 0) else {
                throw NSError(domain: "test-read-only-state", code: 2)
            }
            let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(String(cString: bytes).utf8)) as? [String: Any])
            return try XCTUnwrap(state["reference"] as? [String: Any])
        }
        do {
            for referenceKind in ["default", "foreign", "matching"] {
                let useDefaultReference = referenceKind == "default", matching = referenceKind != "foreign"
                let session = UUID().uuidString.lowercased(), generation = UUID().uuidString.lowercased()
                var params: [String: Any] = ["sessionID": session, "workspaceGeneration": generation,
                    "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
                    "pluginID": "cq_ww_cw", "station": state["station"]!, "settings": state["settings"]!,
                    "frequencyHz": draft["frequencyHz"]!, "mode": fixture["mode"]!]
                if !useDefaultReference {
                    var explicit = try XCTUnwrap(state["reference"] as? [String: Any])
                    if referenceKind == "matching" { explicit["id"] = "bundled-cty-fnv64-cf9c48a44d4b5e66" }
                    params["reference"] = explicit
                }
                _ = try await lane.handle(method: "contest_session_create", params: params)
                let before = try storedReference(session)
                XCTAssertEqual(before["multiplierUniverse"] != nil, useDefaultReference)
                for reopened in [false, true] {
                    if reopened { _ = try await lane.handle(method: "contest_session_open", params: ["sessionID": session]) }
                    let meta = try await lane.handle(method: "contest_analytics", params: ["sessionID": session,
                        "workspaceGeneration": generation, "action": "prepare"])
                    let country = try XCTUnwrap((meta["neededViews"] as? [[String: Any]])?.first { $0["id"] as? String == "country" })
                    XCTAssertEqual(country["status"] as? String, matching ? "PASS" : "UNVERIFIED")
                    XCTAssertEqual(country["universeSize"] as? Int, matching ? 346 : nil)
                    XCTAssertEqual(meta["multiplierUniverseReference"] != nil, matching)
                    let coordinate = meta["multiplierUniverseReference"] as? [String: Any]
                    XCTAssertEqual(coordinate?["coordinateSource"] as? String,
                                   useDefaultReference ? "session" : matching ? "verified-request" : nil)
                    _ = try await lane.handle(method: "contest_analytics", params: ["sessionID": session,
                        "workspaceGeneration": generation, "action": "release", "snapshotID": meta["snapshotID"]!])
                }
                XCTAssertEqual(try JSONSerialization.data(withJSONObject: storedReference(session), options: [.sortedKeys]),
                               try JSONSerialization.data(withJSONObject: before, options: [.sortedKeys]))
                do {
                    _ = try await lane.handle(method: "contest_analytics", params: ["sessionID": session,
                        "workspaceGeneration": generation, "action": "prepare", "multiplierUniverse": ["injected": true]])
                    XCTFail("Caller-supplied analytics reference context must be rejected")
                } catch {
                    XCTAssertTrue(String(describing: error).contains("invalid_params"))
                }
            }
            await lane.shutdown()
        } catch {
            await lane.shutdown()
            throw error
        }
    }

    func testEveryRegisteredFixtureCommitsThroughTheNativePythonLane() async throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixtureURL = repository.appendingPathComponent("python/tests/fixtures/all_contests_lifecycle.json")
        let fixtures = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: [String: Any]])
        let isolated = try isolatedHost(repository: repository, prefix: "xlog-native-catalogue")
        let root = isolated.root
        defer { try? FileManager.default.removeItem(at: root) }
        let lane = try PythonContestLane(configuration: isolated.configuration)
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
