import Foundation
import XCTest
@testable import XStationIntegrationCore

final class ConnectionDoctorTests: XCTestCase {
    private func snapshot(_ provider: String = "direct_tci") -> [String: Any] {
        ["source": provider, "available": true, "transport_state": "ready",
         "radio": ["connected": true, "observed": true, "received_at": 100.0],
         "station": ["radio_known": true, "radio_stale": false],
         "capabilities": ["supported_commands": ["station_tune", "ptt", "send_cw", "set_rf_power"]]]
    }

    private func jsonNumber(_ literal: String) throws -> NSNumber {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(literal.utf8), options: [.fragmentsAllowed]) as? NSNumber)
    }

    func testFoundationBooleanFallbackUsesIdentityRatherThanNumericEncodingOrEquality() throws {
        XCTAssertTrue(ConnectionDoctor.isFoundationBoolean(try jsonNumber("true")))
        XCTAssertTrue(ConnectionDoctor.isFoundationBoolean(try jsonNumber("false")))
        XCTAssertFalse(ConnectionDoctor.isFoundationBoolean(try jsonNumber("0")))
        XCTAssertFalse(ConnectionDoctor.isFoundationBoolean(try jsonNumber("1")))
        XCTAssertFalse(ConnectionDoctor.isFoundationBoolean(NSNumber(value: Int8(0))))
        XCTAssertFalse(ConnectionDoctor.isFoundationBoolean(NSNumber(value: Int8(1))))
        XCTAssertFalse(ConnectionDoctor.isFoundationBoolean(NSNumber(value: UInt8(0))))
        XCTAssertFalse(ConnectionDoctor.isFoundationBoolean(NSNumber(value: UInt8(1))))

        var value = snapshot()
        value["radio"] = ["connected": true, "observed": true, "received_at": 100.0]
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).freshness, .fresh)
        value["radio"] = ["connected": true, "observed": true, "received_at": true]
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).freshness, .unknown)
    }

    func testDeterministicStagedTCIReadOnlyProjection() {
        let value = snapshot()
        let report = ConnectionDoctor.project(retainedSnapshot: value, now: 102)
        XCTAssertEqual(report, ConnectionDoctor.project(retainedSnapshot: value, now: 102))
        XCTAssertEqual(report.checks.map(\.stage), [.provider, .configuration, .connection, .freshness, .capabilities])
        XCTAssertEqual(report.configuration, .unknown)
        XCTAssertEqual(report.freshness, .fresh)
        XCTAssertEqual(report.readOnly, true)
        XCTAssertEqual(report.advertisedCapabilities, [.observe], "TCI cannot acquire controls from malformed advertisements")
    }

    func testFreshnessUsesProducerReceiptAndHonorsStaleEvidence() {
        var value = snapshot()
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 105).freshness, .fresh)
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 105.1).freshness, .stale)
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 98).freshness, .stale)
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: .nan).freshness, .unknown)
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100, maximumAge: .infinity).freshness, .unknown)
        value["station"] = ["radio_stale": true]
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).freshness, .stale)
        value["station"] = [:]
        value["generated_at"] = 100
        value["radio"] = ["connected": true, "observed": true, "observed_at": 100]
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).freshness, .unknown)
        value["radio"] = ["connected": true, "observed": true, "received_at": true]
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).freshness, .unknown)
    }

    func testUnknownDisconnectedAndNonAuthoritativeRemainUnproven() {
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: snapshot("secret-provider"), now: 100).provider, .unknown)
        var value = snapshot("direct_agent")
        value["station"] = ["radio_known": false]
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).freshness, .unavailable)
        value["transport_state"] = "connecting"
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).checks[2].reason, .connectionPending)
        value["transport_state"] = "stopped"
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).checks[2].reason, .disconnected)
        value["transport_state"] = "ready"
        value["available"] = 1
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: value, now: 100).freshness, .unavailable)
    }

    func testConfiguredStateAndAdvertisedCapabilitiesDoNotAuthorizeActions() {
        let report = ConnectionDoctor.project(retainedSnapshot: snapshot("direct_flex_lan"), configuration: .configured, now: 100)
        XCTAssertEqual(report.checks[1].status, .passed)
        XCTAssertEqual(report.advertisedCapabilities, [.observe, .tune, .ptt, .cw, .rfPower])
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: snapshot(), configuration: .missing, now: 100).checks[1].reason, .configurationMissing)
        XCTAssertEqual(ConnectionDoctor.project(retainedSnapshot: snapshot(), configuration: .invalid, now: 100).checks[1].reason, .configurationInvalid)
    }

    func testSupportPreviewIsAnAllowlistNotRecursiveRedaction() throws {
        var value = snapshot("direct_agent")
        let secret = "SENTINEL-private-user-token-call-log-path"
        value["base_url"] = "https://\(secret)@host.invalid/?token=\(secret)"
        value["token"] = secret
        value["configuration"] = ["credential_reference": secret]
        value["qso"] = ["callsign": secret, "notes": secret]
        value["error"] = secret
        value["tci"] = ["device": secret, "program": secret]
        value["station"] = ["radio_known": true, "radio_stale": false, "inhibitors": [secret], "alarm_summary": secret]
        let report = ConnectionDoctor.project(retainedSnapshot: value, now: 100)
        let encoded = try JSONEncoder().encode(report)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains(secret))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["schemaVersion", "evidence", "provider", "configuration", "transport", "freshness", "advertisedCapabilities", "checks"])
        XCTAssertEqual(report.evidence, "retained-worker-state-only")
    }
}
