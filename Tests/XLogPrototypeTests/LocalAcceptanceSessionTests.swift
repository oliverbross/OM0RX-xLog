import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Isolated packaged UI acceptance")
struct LocalAcceptanceSessionTests {
    private func request(_ session: LocalAcceptanceSession, _ method: String,
                         _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let bytes = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": params])
        return try #require(try JSONSerialization.jsonObject(with: await session.worker.response(to: bytes)) as? [String: Any])
    }

    @Test("Every external service and source-copy path is denied before dispatch")
    func restrictions() async throws {
        let session = try LocalAcceptanceSession()
        do {
            for method in ["station_connect", "station_radio_control", "station_action", "rotor_goto",
                           "cluster_connect", "cluster_snapshot", "reference_refresh", "qrz_lookup",
                           "sync_run", "secret_set", "backup_import", "future_service"] {
                let result = try await request(session, method)
                #expect(result["ok"] as? Bool == false)
                #expect((result["error"] as? [String: Any])?["code"] as? String == "acceptance_restricted")
            }
            let copy = try await request(session, "workspace_create", ["mode": "copy_native"])
            #expect((copy["error"] as? [String: Any])?["code"] as? String == "acceptance_restricted")
            let health = try await request(session, "health")["result"] as? [String: Any]
            #expect(health?["mode"] as? String == "isolated_local_acceptance")
            #expect(health?["isolated_workspace"] as? Bool == true)
            #expect(health?["platform_services"] as? Bool == false)
            let status = try await request(session, "workspace_status")["result"] as? [String: Any]
            #expect(status?["workspace_exists"] as? Bool == false)
            #expect(status?["native_log_exists"] as? Bool == false)
        } catch {
            try? await session.close()
            throw error
        }
        try await session.close()
        #expect(!FileManager.default.fileExists(atPath: session.directory.path))
    }

    @Test("Real writes stay in separate disposable workspaces and cannot resume after close")
    func localWritesAndCleanup() async throws {
        let first = try LocalAcceptanceSession()
        let second = try LocalAcceptanceSession()
        do {
            #expect(first.directory != second.directory)
            for session in [first, second] {
                let created = try await request(session, "workspace_create", ["mode": "empty"])
                #expect(created["ok"] as? Bool == true)
            }
            let imported = try await request(first, "logbook_import_adif", ["text": "<CALL:5>K1ABC<QSO_DATE:8>20261001<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<EOR>"])
            #expect(imported["ok"] as? Bool == true)
            let firstRows = try await request(first, "logbook_list")["result"] as? [String: Any]
            let secondRows = try await request(second, "logbook_list")["result"] as? [String: Any]
            #expect(firstRows?["total"] as? Int == 1)
            #expect(secondRows?["total"] as? Int == 0)
        } catch {
            try? await first.close()
            try? await second.close()
            throw error
        }
        try await first.close()
        try await second.close()
        let late = try await request(first, "workspace_create", ["mode": "empty"])
        #expect((late["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
        #expect(!FileManager.default.fileExists(atPath: first.directory.path))
        #expect(!FileManager.default.fileExists(atPath: second.directory.path))
    }
}
