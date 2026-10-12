import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class WorkerStartupTests: XCTestCase {
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

    private func response(_ worker: LiveWorker, id: String, method: String) async throws -> [String: Any] {
        let request = try JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": [:]] as [String: Any])
        let data = await worker.response(to: request)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
