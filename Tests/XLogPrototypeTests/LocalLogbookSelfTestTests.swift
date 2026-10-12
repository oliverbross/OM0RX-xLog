import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Portable real local logbook")
struct LocalLogbookSelfTestTests {
    @Test("Shipping handlers preserve imported fields, settings, awards and backups across reopen")
    func localRoundTrip() throws {
        let report = try LocalLogbookSelfTest.run()
        #expect(report["passed"] as? Bool == true)
        #expect(report["network_contact"] as? Bool == false)
        #expect(report["station_io"] as? Bool == false)
        #expect(report["credentials_accessed"] as? Bool == false)
        #expect((report["checks"] as? [String])?.count == 9)
    }

    @Test("Persistent router exposes local workspace without opening hardware")
    func localRouting() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root))
        for method in ["health", "workspace_status"] {
            let request = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": [:]] as [String: Any])
            let response = try #require(try JSONSerialization.jsonObject(with: await worker.response(to: request)) as? [String: Any])
            #expect(response["ok"] as? Bool == true)
            let result = try #require(response["result"] as? [String: Any])
            if method == "health" {
                #expect(result["local_logbook"] as? Bool == true)
                #expect(result["synthetic_only"] as? Bool == false)
            } else {
                #expect(result["workspace_exists"] as? Bool == false)
                #expect(result["native_log_exists"] as? Bool == false)
            }
        }
        #expect(!FileManager.default.fileExists(atPath: root.path))
    }
}
