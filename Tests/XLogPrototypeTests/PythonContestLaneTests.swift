import Foundation
import XCTest
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

final class PythonContestLaneTests: XCTestCase {
    func testObservedSpotCallResolvesCountryBeforeCQWWZonePrefill() async throws {
        let temporary = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("xlog-observed-spot-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: try python312(),
            launcherURL: repositoryRoot().appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("Contesting/Python", isDirectory: true)))
        let session = UUID().uuidString.lowercased()
        let created = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": session, "workspaceGeneration": UUID().uuidString.lowercased(),
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_ssb", "frequencyHz": 7_125_000,
            "station": ["Call": "OM0RX", "CQZone": "15"], "settings": ["SentExchange": "15"],
        ])
        var projection = try XCTUnwrap(created["projection"] as? [String: Any])
        func mutate(_ method: String, _ extra: [String: Any]) async throws -> [String: Any] {
            var params: [String: Any] = ["sessionID": session,
                "operationID": UUID().uuidString.lowercased(), "expectedRevision": projection["revision"]!,
                "draftID": projection["draftID"]!]
            params.merge(extra) { _, new in new }
            let result = try await lane.handle(method: method, params: params)
            return try XCTUnwrap(result["projection"] as? [String: Any])
        }
        projection = try await mutate("contest_run_state", ["run": false])
        // This is the actual radio-follow envelope: the old call is cleared,
        // and Python adopts the observed spot only after native CTY hydration.
        projection = try await mutate("contest_draft_apply", [
            "fields": ["callsign": "", "other_2": ""], "frequencyHz": 7_145_000,
            "observedVFOChange": true, "observedSpotCallsign": "MX0KBS",
        ])
        func value(_ name: String) -> String? {
            (projection["fields"] as? [[String: Any]])?.first { $0["id"] as? String == name }?["value"] as? String
        }
        XCTAssertEqual(value("callsign"), "MX0KBS")
        XCTAssertEqual(projection["countryResolved"] as? Bool, true)
        XCTAssertEqual(value("other_2"), "14")
        projection = try await mutate("contest_draft_apply", ["fields": ["callsign": "MX0KBS", "other_2": "9"]])
        XCTAssertEqual(value("other_2"), "9")
        projection = try await mutate("contest_draft_apply", ["fields": ["callsign": "MX0KBS"],
            "observedVFOChange": false, "observedSpotCallsign": "K1ABC"])
        XCTAssertEqual(value("callsign"), "MX0KBS")
        XCTAssertEqual(value("other_2"), "9")
        await lane.shutdown()
    }

    func testContestingTestWorkerUsesPythonLaneInsideIsolatedSupportRoot() async throws {
        let repository = repositoryRoot()
        let applicationSupport = URL(fileURLWithPath: FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/"), isDirectory: true)
            .appendingPathComponent("xlog-python-contest-profile-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: applicationSupport) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: applicationSupport)
        guard case .contestingTest(let supportRoot) = profile else {
            return XCTFail("Expected Contesting Test profile")
        }
        let dataRoot = supportRoot.appendingPathComponent("Contesting/Python", isDirectory: true)
        let configuration = PythonContestHostConfiguration(
            executableURL: try python312(),
            launcherURL: repository.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: dataRoot)
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile,
            operatingModule: .contesting, pythonContestConfiguration: configuration)

        let catalogReply = await worker.response(to: try JSONSerialization.data(withJSONObject: [
            "id": "catalog", "method": "contest_catalog", "params": [:],
        ]))
        let catalogEnvelope = try XCTUnwrap(JSONSerialization.jsonObject(with: catalogReply) as? [String: Any])
        let catalog = try XCTUnwrap(catalogEnvelope["result"] as? [String: Any],
            String(data: catalogReply, encoding: .utf8) ?? "Invalid catalog response")
        let plugins = try XCTUnwrap(catalog["plugins"] as? [[String: Any]])
        XCTAssertTrue(plugins.contains { $0["engine"] as? String == "not1mm-python" })
        XCTAssertTrue(dataRoot.standardizedFileURL.path.hasPrefix(supportRoot.standardizedFileURL.path + "/"))
        XCTAssertFalse(dataRoot.standardizedFileURL.path.contains("/OM0RX-xLog/Contesting/Python"))

        let healthReply = await worker.response(to: try JSONSerialization.data(withJSONObject: [
            "id": "health", "method": "health", "params": [:],
        ]))
        let healthEnvelope = try XCTUnwrap(JSONSerialization.jsonObject(with: healthReply) as? [String: Any])
        let health = try XCTUnwrap(healthEnvelope["result"] as? [String: Any])
        XCTAssertEqual(health["mode"] as? String, "contesting_test")
        XCTAssertEqual(health["contesting_engine"] as? String, "not1mm-python")
        XCTAssertEqual(health["isolated_workspace"] as? Bool, true)

        let blockedReply = await worker.response(to: try JSONSerialization.data(withJSONObject: [
            "id": "station", "method": "station_snapshot", "params": [:],
        ]))
        let blockedEnvelope = try XCTUnwrap(JSONSerialization.jsonObject(with: blockedReply) as? [String: Any])
        XCTAssertEqual((blockedEnvelope["error"] as? [String: Any])?["code"] as? String,
                       "external_io_disabled")
        await worker.shutdown()
    }

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

    func testLegacyImportInjectsReferenceAndOwnsImportedSession() async throws {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-legacy-lane-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        let python = try python312()
        let launcher = temporary.appendingPathComponent("fixture_host.py")
        try Data("""
import json, sys
for line in sys.stdin:
    request = json.loads(line)
    params = request["params"]
    method = request["method"]
    if method == "contest_legacy_import":
        reference = params.get("reference", {})
        country = reference.get("countries", {}).get("OM0RX")
        if not reference.get("id") or not country:
            response = {"id": request["id"], "ok": False, "error": {"code": "missing_reference", "message": "reference required", "outcome": "confirmed"}}
        else:
            projection = {"sessionID": params["sessionID"], "workspaceGeneration": params["workspaceGeneration"], "revision": 1, "draftID": "11111111-1111-4111-8111-111111111111", "referenceID": reference["id"], "ruleIdentity": {"id": "cq_ww_cw", "version": "1", "edition": "fixture", "sourceRevision": "fixture"}, "fields": []}
            response = {"id": request["id"], "ok": True, "result": {"sessionID": params["sessionID"], "projection": projection}}
    elif method == "contest_history_status":
        response = {"id": request["id"], "ok": True, "result": {"activation": {"state": "inactive"}}}
    else:
        response = {"id": request["id"], "ok": False, "error": {"code": "unexpected", "message": method, "outcome": "confirmed"}}
    print(json.dumps(response, separators=(",", ":")), flush=True)
""".utf8).write(to: launcher)

        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: python, launcherURL: launcher,
            dataRootURL: temporary.appendingPathComponent("Contesting/Python", isDirectory: true)))
        let sessionID = UUID().uuidString.lowercased()
        let workspaceGeneration = UUID().uuidString.lowercased()
        let imported = try await lane.handle(method: "contest_legacy_import", params: [
            "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_cw", "frequencyHz": 14_025_000,
            "station": ["Call": "OM0RX", "GridSquare": "JN88"],
            "settings": ["SentExchange": "15", "ModeCategory": "CW"],
        ])
        let projection = try XCTUnwrap(imported["projection"] as? [String: Any])
        XCTAssertEqual(projection["referenceID"] as? String, try ContestReferenceData.bundled().version)
        _ = try await lane.handleCallHistory(method: "contest_history_status", params: [
            "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
        ])
        await lane.shutdown()
    }

    private func python312() throws -> URL {
        let fileManager = FileManager.default
        let candidates = [
            ProcessInfo.processInfo.environment["XLOG_TEST_PYTHON312"],
            "/opt/local/bin/python3.12",
            "/opt/homebrew/bin/python3.12",
            "/usr/local/bin/python3.12",
        ].compactMap { $0 }
        guard let path = candidates.first(where: fileManager.isExecutableFile(atPath:)) else {
            throw XCTSkip("Python 3.12 was not provided for the actual-plugin bridge test.")
        }
        return URL(fileURLWithPath: path)
    }

    private func python3ForBridgeTest() throws -> URL {
        let fileManager = FileManager.default
        let configured = ProcessInfo.processInfo.environment["XLOG_TEST_PYTHON312"]
        #if os(Windows)
        let executableNames = ["python.exe", "python3.exe"]
        let pathListSeparator: Character = ";"
        let pathSeparator = "\\"
        #else
        let executableNames = ["python3"]
        let pathListSeparator: Character = ":"
        let pathSeparator = "/"
        #endif
        let pathCandidates = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: pathListSeparator).flatMap { directory in
                executableNames.map { String(directory) + pathSeparator + $0 }
            }
        let candidates = [configured, "/usr/bin/python3"] + pathCandidates.map(Optional.some)
        guard let path = candidates.compactMap({ $0 }).first(where: fileManager.isExecutableFile(atPath:)) else {
            throw XCTSkip("Python 3 was not available for the isolated pipe-drain bridge test.")
        }
        return URL(fileURLWithPath: path)
    }

    func testOriginalDigitalHandlerIsLeasedDeduplicatedAndRetiredOnContestSwitch() async throws {
        let root = repositoryRoot()
        let basePath = FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/")
        let temporary = URL(fileURLWithPath: basePath, isDirectory: true)
            .appendingPathComponent("xlog-digital-lane-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: try python312(), launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("Contesting/Python", isDirectory: true)))
        let session = UUID().uuidString.lowercased(), workspace = UUID().uuidString.lowercased()
        _ = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": session, "workspaceGeneration": workspace,
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_rtty", "frequencyHz": 14_080_000,
            "station": ["Call": "OM0RX", "GridSquare": "JN88", "ARRLSection": "DX"],
            "settings": ["SentExchange": "15", "ModeCategory": "RTTY", "OperatorCategory": "SINGLE-OP",
                         "BandCategory": "ALL", "PowerCategory": "LOW"],
        ])
        let destination = try await lane.digitalDestination()
        let record = ADIFRecord(fields: [
            "CALL": "K1ABC", "MODE": "RTTY", "FREQ": "14.080000", "BAND": "20M",
            "QSO_DATE": "20261020", "TIME_ON": "081500", "RST_SENT": "599", "RST_RCVD": "599",
            "CQZ": "5", "STATE": "CT",
        ])
        let firstDuplicate = try await lane.ingestDigital(record, destination: destination)
        let replayDuplicate = try await lane.ingestDigital(record, destination: destination)
        XCTAssertFalse(firstDuplicate)
        XCTAssertTrue(replayDuplicate)
        let log = try await lane.handle(method: "contest_log", params: ["sessionID": session, "offset": 0, "limit": 10])
        XCTAssertEqual(log["total"] as? Int, 1)
        let row = try XCTUnwrap((log["rows"] as? [[String: Any]])?.first)
        XCTAssertEqual((row["ContestNR"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual(row["ContestName"] as? String, "CQ-WW-RTTY")
        XCTAssertEqual(row["StationPrefix"] as? String, "OM0RX")
        let score = try await lane.handle(method: "contest_score", params: ["sessionID": session])
        let statistics = try XCTUnwrap(score["statistics"] as? [String: Any])
        let total = try XCTUnwrap(statistics["total"] as? [String: Any])
        XCTAssertEqual((total["qsos"] as? NSNumber)?.intValue, 1)

        _ = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": UUID().uuidString.lowercased(), "workspaceGeneration": UUID().uuidString.lowercased(),
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_cw", "frequencyHz": 14_025_000,
            "station": ["Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"], "settings": ["SentExchange": "15"],
        ])
        do {
            _ = try await lane.digitalDestination()
            XCTFail("A contest without an original digital handler must not expose a destination.")
        } catch let error as ContestLaneError { XCTAssertEqual(error.code, "digital_unsupported") }
        do {
            _ = try await lane.ingestDigital(record, destination: destination)
            XCTFail("A retired contest destination must reject late packets.")
        } catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_context") }
        await lane.shutdown()
    }

    func testNormalProcessWorkerUsesTrustedContestScopeForDigitalSetupSnapshot() async throws {
        let root = repositoryRoot()
        let basePath = FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/")
        let temporary = URL(fileURLWithPath: basePath, isDirectory: true)
            .appendingPathComponent("xlog-digital-worker-route-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let configuration = PythonContestHostConfiguration(
            executableURL: try python312(), launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: temporary.appendingPathComponent("contest", isDirectory: true))
        let logbook = LiveLogbookMethods(
            supportDirectory: temporary.appendingPathComponent("workspace", isDirectory: true),
            inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: .production,
            operatingModule: .normalLogging, pythonContestConfiguration: configuration)
        func request(_ id: String, _ method: String, _ params: [String: Any] = [:],
                     operatingModule: String? = nil) async throws -> [String: Any] {
            var envelope: [String: Any] = ["id": id, "method": method, "params": params]
            if let operatingModule { envelope["operatingModule"] = operatingModule }
            let reply = await worker.response(to: try JSONSerialization.data(withJSONObject: envelope))
            return try XCTUnwrap(JSONSerialization.jsonObject(with: reply) as? [String: Any])
        }
        let settingsReply = try await request("settings", "settings_load")
        let settings = try XCTUnwrap(settingsReply["result"] as? [String: Any])
        let workspace = try XCTUnwrap(settings["generation"] as? String)
        let initialReply = try await request("initial", "wsjtx_snapshot")
        let initial = try XCTUnwrap(initialReply["result"] as? [String: Any])
        let initialDestination = try XCTUnwrap(initial["logging_destination"] as? String)
        let session = UUID().uuidString.lowercased()
        let created = try await request("create", "contest_session_create", [
            "sessionID": session, "workspaceGeneration": workspace,
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_rtty", "frequencyHz": 14_080_000,
            "station": ["Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"],
            "settings": ["SentExchange": "15", "ModeCategory": "RTTY"],
        ])
        XCTAssertEqual(created["ok"] as? Bool, true)

        let ordinaryReply = try await request("ordinary", "wsjtx_snapshot")
        let ordinary = try XCTUnwrap(ordinaryReply["result"] as? [String: Any])
        XCTAssertEqual(ordinary["contest_target_supported"] as? Bool, false)
        XCTAssertEqual(ordinary["logging_destination"] as? String, initialDestination)
        let contestReply = try await request("contest", "wsjtx_snapshot", operatingModule: "contesting")
        let contest = try XCTUnwrap(contestReply["result"] as? [String: Any])
        XCTAssertEqual(contest["contest_target_supported"] as? Bool, true)
        XCTAssertEqual((contest["active_contest"] as? [String: Any])?["session_id"] as? String, session)
        XCTAssertEqual((contest["active_contest"] as? [String: Any])?["plugin_id"] as? String, "cq_ww_rtty")
        XCTAssertEqual(contest["logging_destination"] as? String, initialDestination,
            "A scoped snapshot must not change the operator's persisted destination.")

        let invalid = try await request("invalid", "wsjtx_snapshot", operatingModule: "unknown")
        XCTAssertEqual((invalid["error"] as? [String: Any])?["code"] as? String, "operating_module_invalid")
        await worker.shutdown()
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    func testContestHostBridgeDrainsResponseLargerThanPipeCapacity() async throws {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-python-large-response-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        let launcher = temporary.appendingPathComponent("large_response.py")
        try """
        import json
        import sys
        request = json.loads(sys.stdin.readline())
        response = {"id": request["id"], "ok": True, "result": {"payload": "x" * 120000}}
        sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\\n")
        sys.stdout.flush()
        """.write(to: launcher, atomically: true, encoding: .utf8)
        let lane = try PythonContestLane(configuration: PythonContestHostConfiguration(
            executableURL: try python3ForBridgeTest(), launcherURL: launcher,
            dataRootURL: temporary.appendingPathComponent("data", isDirectory: true)))
        let result = try await lane.handle(method: "contest_large_response", params: [:])
        XCTAssertEqual((result["payload"] as? String)?.count, 120_000)
        await lane.shutdown()
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
        let pluginIDs = Set(plugins.compactMap { $0["id"] as? String })
        XCTAssertTrue(pluginIDs.isSuperset(of:
                Set(["cq_ww_cw", "cq_wpx_cw", "arrl_ss_cw", "icwc_mst", "cwt", "cwo", "k1usn_sst", "trans_tasman", "oceania_dx_cw"])),
            "The actual-host bridge must retain the established pinned plugins while allowing the catalog to grow.")
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
        let preview = try await lane.handle(method: "contest_spot_points_preview", params: [
            "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
            "expectedRevision": 1, "spots": [[
                "spotID": "native-preview", "callsign": "K1ABC",
                "frequencyHz": 14_025_000, "mode": "CW",
            ]],
        ])
        let previewRows = try XCTUnwrap(preview["spots"] as? [[String: Any]])
        XCTAssertEqual((try XCTUnwrap(previewRows.first)["points"] as? NSNumber)?.intValue, 3)
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

    func testCountryBridgeKeepsOESeparateFromNamed4U1VAuthority() async throws {
        let root = repositoryRoot()
        let basePath = FileManager.default.temporaryDirectory.path
            .replacingOccurrences(of: "/var/", with: "/private/var/")
            .replacingOccurrences(of: "/tmp/", with: "/private/tmp/")
        let temporary = URL(fileURLWithPath: basePath, isDirectory: true)
            .appendingPathComponent("xlog-python-country-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let dataRoot = temporary.appendingPathComponent("Contesting/Python", isDirectory: true)
        let configuration = PythonContestHostConfiguration(
            executableURL: try python312(), launcherURL: root.appendingPathComponent("python/contest_host/launcher.py"),
            dataRootURL: dataRoot)
        let bundled = try ContestReferenceData.bundled()
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        let badCSV = temporary.appendingPathComponent("legacy-shared-adif.csv")
        try """
        OM,Slovak Republic,504,EU,15,28,48.67,-19.50,-1.0,OM;
        *4U1V,Austria,206,EU,15,28,47.33,-13.33,-1.0,OE;
        """.write(to: badCSV, atomically: true, encoding: .utf8)
        let legacyReference = ContestReferenceData(
            resolver: try CTYResolver(csvURL: badCSV), version: bundled.version,
            primaryPrefixes: bundled.primaryPrefixes, entityNames: bundled.entityNames,
            entityNamesByPrefix: bundled.entityNamesByPrefix, countryReference: bundled.countryReference)
        let lane = try PythonContestLane(configuration: configuration, reference: legacyReference)
        let session = UUID().uuidString.lowercased()
        let workspace = UUID().uuidString.lowercased()
        let created = try await lane.handle(method: "contest_session_create", params: [
            "sessionID": session, "workspaceGeneration": workspace,
            "operationID": UUID().uuidString.lowercased(), "expectedRevision": 0,
            "pluginID": "cq_ww_ssb", "frequencyHz": 7_110_000,
            "station": ["Call": "OM0RX", "CQZone": "15"], "settings": ["SentExchange": "15"],
        ])
        let projection = try XCTUnwrap(created["projection"] as? [String: Any])
        _ = try await lane.handle(method: "contest_qso_commit", params: [
            "sessionID": session, "operationID": UUID().uuidString.lowercased(),
            "expectedRevision": try XCTUnwrap(projection["revision"] as? Int),
            "fields": ["callsign": "OE8DDX", "other_2": "15"],
        ])
        let log = try await lane.handle(method: "contest_log", params: [
            "sessionID": session, "offset": 0, "limit": 10,
        ])
        XCTAssertEqual(try XCTUnwrap((log["rows"] as? [[String: Any]])?.first)["CountryPrefix"] as? String, "*4U1V")
        await lane.shutdown()

        let repairedLane = try PythonContestLane(configuration: configuration, reference: bundled)
        let opened = try await repairedLane.handle(method: "contest_session_open", params: ["sessionID": session])
        let repairedProjection = try XCTUnwrap(opened["projection"] as? [String: Any])
        XCTAssertEqual(repairedProjection["revision"] as? Int, 3)
        let repairedLog = try await repairedLane.handle(method: "contest_log", params: [
            "sessionID": session, "offset": 0, "limit": 10,
        ])
        XCTAssertEqual(try XCTUnwrap((repairedLog["rows"] as? [[String: Any]])?.first)["CountryPrefix"] as? String, "OE")
        let score = try await repairedLane.handle(method: "contest_score", params: ["sessionID": session])
        let matrices = try XCTUnwrap(score["matrices"] as? [String: Any])
        let countries = try XCTUnwrap(matrices["countries"] as? [[String: Any]])
        XCTAssertEqual(countries.map { $0["value"] as? String }, ["OE"])
        await repairedLane.shutdown()
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
