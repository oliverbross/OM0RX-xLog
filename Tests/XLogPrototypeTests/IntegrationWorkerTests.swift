import Foundation
import XCTest
import XLogPrototypeSupport

final class IntegrationWorkerTests: XCTestCase {
    func request(_ method: String, _ params: [String: Any] = [:]) throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": "integration", "method": method, "params": params])
        return try XCTUnwrap(JSONSerialization.jsonObject(with: PrototypeWorker().response(to: data)) as? [String: Any])
    }
    var spot: [String: Any] { ["id": "s1", "line": "DX de DEMO1: 14240.0 W1AW SSB 1200Z", "adif": 291] }
    func batch(_ contacts: [[String: Any]] = [], spots: [[String: Any]]? = nil) -> [String: Any] {
        ["history_scope": "synthetic_session", "spots": spots ?? [spot], "contacts": contacts]
    }
    func first(_ response: [String: Any]) throws -> [String: Any] {
        XCTAssertEqual(response["ok"] as? Bool, true)
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        XCTAssertEqual(result["station_io"] as? Bool, false)
        return try XCTUnwrap((result["spots"] as? [[String: Any]])?.first)
    }
    func testIntegrationDiagnosticsUseRealStateMachines() throws {
        let response = try request("integration_self_test")
        XCTAssertEqual(response["ok"] as? Bool, true)
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        XCTAssertEqual(result["passed"] as? Bool, true)
        XCTAssertEqual(result["station_io"] as? Bool, false)
        XCTAssertNotNil(result["station"])
    }
    func testEmptySessionThenLoggedCallChangesClassification() throws {
        let before = try first(request("cluster_classify", batch()))
        XCTAssertEqual(before["call_status"] as? String, "New Callsign")
        XCTAssertEqual(before["dxcc_status"] as? String, "New DXCC")
        let after = try first(request("cluster_classify", batch([
            ["callsign": " w1aw ", "frequency_hz": 14_240_000, "mode": "USB", "adif": 291, "timestamp": 1_700_000_000]
        ])))
        XCTAssertEqual(after["call_status"] as? String, "Worked")
        XCTAssertEqual(after["dxcc_status"] as? String, "Worked")
        XCTAssertEqual(after["frequency_hz"] as? Int, 14_240_000)
    }
    func testUnknownEntityRemainsUnknownAndNoContactCanConfirmEQSLAlone() throws {
        var unknown = spot
        unknown.removeValue(forKey: "adif")
        XCTAssertEqual(try first(request("cluster_classify", batch(spots: [unknown])))["dxcc_status"] as? String, "Unknown")
        let value = try first(request("cluster_classify", batch([
            ["callsign": "W1AW", "frequency_hz": 14_240_000, "mode": "SSB", "adif": 291, "eqsl": "Y"]
        ])))
        XCTAssertEqual(value["call_status"] as? String, "Worked")
    }
    func testBoundedBatchRejectsAmbiguousAndUnexpectedInput() throws {
        var invalid = [batch(spots: [spot, spot]), batch(spots: [["id": "s1", "line": "not a spot"]]),
                       batch(spots: Array(repeating: spot, count: 65)), batch(Array(repeating: [:], count: 257)),
                       batch([["callsign": "W1AW", "frequency_hz": true, "mode": "SSB"]]),
                       batch([["callsign": "W1AW", "frequency_hz": 14_240_000, "mode": "SSB", "adif": true]])]
        var wrongScope = batch(); wrongScope["history_scope"] = "live_logbook"; invalid.append(wrongScope)
        var extra = batch(); extra["token"] = "NOT-A-REAL-SECRET"; invalid.append(extra)
        for params in invalid {
            let response = try request("cluster_classify", params)
            XCTAssertEqual(response["ok"] as? Bool, false)
            XCTAssertFalse(String(describing: response).contains("NOT-A-REAL-SECRET"))
        }
    }
    func testNoStationWritesAddedToIPC() throws {
        for method in ["connect", "tune_simplex", "ptt", "operate", "rotor_goto", "cluster_connect"] {
            XCTAssertEqual(try request(method)["ok"] as? Bool, false)
        }
        XCTAssertEqual(try request("integration_self_test", ["path": "/tmp"])["ok"] as? Bool, false)
    }
}
