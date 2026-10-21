import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class WorkerStartupTests: XCTestCase {
    func testOperatingModuleEnvironmentIsStrictAndDefaultsToNormalForDirectTools() throws {
        XCTAssertEqual(try WorkerOperatingModule.resolve(environment: [:]), .normalLogging)
        XCTAssertEqual(try WorkerOperatingModule.resolve(
            environment: ["XLOG_OPERATING_MODULE": "contesting"]), .contesting)
        XCTAssertThrowsError(try WorkerOperatingModule.resolve(
            environment: ["XLOG_OPERATING_MODULE": "normal"] ))
    }

    func testNormalBackgroundServicesRemainActiveAlongsideProductionContestCapability() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-worker-module-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let normal = LiveWorker(logbook: LiveLogbookMethods(
            supportDirectory: root.appendingPathComponent("normal"), inheritNativePreferences: false),
            runtimeProfile: .production, operatingModule: .normalLogging)
        await normal.startBackgroundServices()
        let normalState = await normal.backgroundServiceStateForTesting()
        XCTAssertTrue(normalState.sync); XCTAssertTrue(normalState.delivery)
        let health = try await response(normal, id: "normal-health", method: "health")
        #if os(macOS)
        let expectedMode = "integrated"
        #else
        let expectedMode = "integrated_local"
        #endif
        XCTAssertEqual((health["result"] as? [String: Any])?["mode"] as? String, expectedMode)
        XCTAssertEqual((health["result"] as? [String: Any])?["contesting_engine"] as? String,
                       "not1mm-python")
        await normal.shutdown()

        let contest = LiveWorker(logbook: LiveLogbookMethods(
            supportDirectory: root.appendingPathComponent("contest"), inheritNativePreferences: false),
            runtimeProfile: .production, operatingModule: .contesting)
        await contest.startBackgroundServices()
        let contestState = await contest.backgroundServiceStateForTesting()
        XCTAssertFalse(contestState.sync); XCTAssertFalse(contestState.delivery)
        await contest.shutdown()
    }

    #if os(macOS)
    func testContestingWorkerRoutesWSJTXToOrdinaryLogContract() {
        XCTAssertEqual(LiveWorker.wsjtxRoute(for: .normalLogging), .normalLogging)
        XCTAssertEqual(LiveWorker.wsjtxRoute(for: .contesting), .contestSurfaceOrdinaryLogbook)
    }

    func testContestingSharedOnlineSettingsTransitionCannotResumeBackgroundDelivery() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-worker-online-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: .production,
            operatingModule: .contesting)
        let request = try JSONSerialization.data(withJSONObject: [
            "id": "contest-online-settings", "method": "online_log_configure", "params": [
                "enabled": NSNumber(value: false),
                "confirm_new_contacts_only": NSNumber(value: false),
            ],
        ] as [String: Any])
        let response = await worker.response(to: request)
        let reply = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
        XCTAssertEqual(reply["ok"] as? Bool, true)
        let state = await worker.backgroundServiceStateForTesting()
        XCTAssertFalse(state.delivery)
        await worker.shutdown()
    }

    func testContestingWorkspaceSuccessAndFailureDoNotResumeNormalBackgroundServices() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-worker-workspace-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root,
            inheritNativePreferences: false), runtimeProfile: .production,
            operatingModule: .contesting)

        let created = try await response(worker, id: "contest-workspace-create",
            method: "workspace_create", params: ["mode": "empty"])
        XCTAssertEqual(created["ok"] as? Bool, true)
        var state = await worker.backgroundServiceStateForTesting()
        XCTAssertFalse(state.sync); XCTAssertFalse(state.delivery)

        let rejected = try await response(worker, id: "contest-workspace-reject",
            method: "workspace_create", params: ["mode": "invalid"])
        XCTAssertEqual(rejected["ok"] as? Bool, false)
        state = await worker.backgroundServiceStateForTesting()
        XCTAssertFalse(state.sync); XCTAssertFalse(state.delivery)
        await worker.shutdown()
    }
    #endif
    func testConcurrentRealLogbookStartupUsesDisposableWorkspaceAndCorrelatesResponses() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-worker-startup-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root)
        let worker = LiveWorker(logbook: logbook)

        let missing = try await response(worker, id: "before", method: "workspace_status")
        XCTAssertEqual(missing["ok"] as? Bool, true)
        XCTAssertEqual((missing["result"] as? [String: Any])?["workspace_exists"] as? Bool, false)

        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let methods = ["workspace_status", "settings_load", "logbook_stats", "logbook_draft", "health"]
        let replies = await withTaskGroup(of: (String, Data).self) { group in
            for (index, method) in methods.enumerated() {
                let id = "startup-\(index)"
                group.addTask {
                    let request = try! JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": [:]] as [String: Any])
                    return (id, await worker.response(to: request))
                }
            }
            var collected: [(String, Data)] = []
            for await item in group { collected.append(item) }
            return collected
        }
        XCTAssertEqual(replies.count, methods.count)
        for (id, data) in replies {
            let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(value["id"] as? String, id)
            XCTAssertEqual(value["ok"] as? Bool, true, "\(id) must complete without a station or network connection")
            if id == "startup-0" {
                XCTAssertEqual((value["result"] as? [String: Any])?["workspace_exists"] as? Bool, true)
            }
            if id == "startup-2" {
                let stats = (value["result"] as? [String: Any])?["stats"] as? [String: Any]
                XCTAssertEqual(stats?["qso_count"] as? Int, 0)
            }
        }
    }

    private func response(_ worker: LiveWorker, id: String, method: String,
                          params: [String: Any] = [:]) async throws -> [String: Any] {
        let request = try JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": params] as [String: Any])
        let data = await worker.response(to: request)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
