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
                let settingsResponse = try await request(session, "settings_load")
                let settings = (settingsResponse["result"] as? [String: Any])?["settings"] as? [String: Any]
                #expect(settings?["gridSquare"] as? String == "")
                #expect(settings?["logbookMode"] as? String == "local")
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

    @Test("Local callsign and DXCC intelligence needs neither cluster nor credentials")
    func localHistory() async throws {
        let session = try LocalAcceptanceSession()
        do {
            _ = try await request(session, "workspace_create", ["mode": "empty"])
            let records = "<CALL:5>K1ABC<QSO_DATE:8>20261001<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<DXCC:3>291<QSL_RCVD:1>Y<EOR>" +
                "<CALL:5>K1ABC<QSO_DATE:8>20261002<TIME_ON:6>120000<BAND:3>40m<MODE:3>FT8<DXCC:3>291<LOTW_QSL_RCVD:1>Y<EOR>" +
                "<CALL:5>K2ABC<QSO_DATE:8>20261003<TIME_ON:6>120000<BAND:3>20m<MODE:3>SSB<DXCC:3>291<EOR>"
            let imported = try await request(session, "logbook_import_adif", ["text": records])
            #expect((imported["result"] as? [String: Any])?["imported"] as? Int == 3)
            let response = try await request(session, "cluster_history", ["call": "k1abc", "adif": 291])
            #expect(response["ok"] as? Bool == true)
            let history = try #require((response["result"] as? [String: Any])?["history"] as? [String: Any])
            #expect(history["call"] as? String == "K1ABC")
            #expect(history["previous_count"] as? Int == 2)
            #expect(history["previous_confirmed_count"] as? Int == 2)
            #expect(history["dxcc_contact_count"] as? Int == 3)
            #expect(history["dxcc_confirmed_count"] as? Int == 2)
            #expect((history["last_dxcc_qso"] as? [String: Any])?["call"] as? String == "K2ABC")
            for invalidADIF: Any in [true, 291.5, -1, 1001, "291"] {
                let rejected = try await request(session, "cluster_history", ["call": "K1ABC", "adif": invalidADIF])
                #expect((rejected["error"] as? [String: Any])?["code"] as? String == "invalid_params")
            }
            let offline = try await request(session, "cluster_snapshot")
            #expect((offline["error"] as? [String: Any])?["code"] as? String == "acceptance_restricted")
        } catch {
            try? await session.close()
            throw error
        }
        try await session.close()
    }
}
