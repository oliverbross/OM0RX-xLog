import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class LiveConnectionDoctorMethodsTests: XCTestCase {
    func testProjectsOnlyTheClosedSupportPreviewAllowlist() throws {
        let secret = "PRIVATE-ENDPOINT-TOKEN"
        let snapshot: [String: Any] = [
            "source": "direct_tci", "available": true, "transport_state": "ready",
            "radio": ["connected": true, "observed": true, "received_at": 100.0, "frequency_hz": 14_074_000],
            "station": ["radio_known": true, "radio_stale": false, "error": secret],
            "capabilities": ["read_only": true, "supported_commands": ["station_tune"]],
            "endpoint": secret,
        ]
        let result = try LiveConnectionDoctorMethods.handle(["snapshot": snapshot, "now": 101.0])
        XCTAssertEqual(Set(result.keys), ["schemaVersion", "evidence", "provider", "configuration", "transport", "freshness", "readOnly", "advertisedCapabilities", "checks"])
        XCTAssertEqual(result["provider"] as? String, "direct_tci")
        XCTAssertEqual(result["advertisedCapabilities"] as? [String], ["observe"])
        let encoded = try JSONSerialization.data(withJSONObject: result)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains(secret))
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("14074000"))
    }

    func testRejectsExtraParametersAndNonNumericEvaluationTime() {
        let snapshot: [String: Any] = ["source": "unknown"]
        XCTAssertThrowsError(try LiveConnectionDoctorMethods.handle(["snapshot": snapshot, "now": 1.0, "endpoint": "hidden"]))
        XCTAssertThrowsError(try LiveConnectionDoctorMethods.handle(["snapshot": snapshot, "now": true]))
    }
}
