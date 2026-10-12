import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class LiveStationMethodsTests: XCTestCase {
    func testEndpointIsBoundedToLoopback() throws {
        let defaults = try LiveStationMethods.Endpoint([:], allowed: [])
        XCTAssertEqual(defaults.host, "127.0.0.1")
        XCTAssertEqual(defaults.port, 14_532)
        let alternate = try LiveStationMethods.Endpoint(["host": "localhost", "port": 15_432], allowed: [])
        XCTAssertEqual(alternate.host, "127.0.0.1")
        XCTAssertEqual(alternate.port, 15_432)
        for value in ["192.168.1.1", "::1", "example.com", true, ""] as [Any] {
            XCTAssertThrowsError(try LiveStationMethods.Endpoint(["host": value], allowed: []))
        }
        for value in [0, 65_536, true, 14_532.5, "14532"] as [Any] {
            XCTAssertThrowsError(try LiveStationMethods.Endpoint(["port": value], allowed: []))
        }
        XCTAssertThrowsError(try LiveStationMethods.Endpoint(["token": "redacted"], allowed: []))
    }

    func testMalformedStationCommandsFailBeforeTransport() async {
        let invalidRequests: [(String, [String: Any])] = [
            ("station_snapshot", ["url": "https://example.invalid"]),
            ("station_tune", ["frequency_hz": true, "mode": "CW"]),
            ("station_tune", ["frequency_hz": 14_074_000.5, "mode": "CW"]),
            ("station_tune", ["frequency_hz": 14_074_000, "mode": "CW;TX"]),
            ("station_action", ["action": "ptt"]),
            ("station_action", ["action": "rotor_goto", "bearing": true, "band": "20m"]),
            ("station_action", ["action": "rotor_goto", "bearing": 361, "band": "20m"]),
            ("station_action", ["action": "operate", "bearing": 20]),
        ]
        for (method, params) in invalidRequests {
            do {
                _ = try await LiveStationMethods.handle(method, params: params)
                XCTFail("Accepted malformed \(method) request")
            } catch let failure as WorkerFailure {
                XCTAssertEqual(failure.code, "invalid_params")
            } catch {
                XCTFail("Unexpected error for \(method): \(error)")
            }
        }
    }

    #if os(macOS)
    func testMonitoringDoesNotAcquireTransmitReleaseObligations() {
        var ownership = StationTransmitOwnership()
        XCTAssertTrue(ownership.releases.isEmpty)
        for control in ["set_frequency_a", "set_mode", "set_rf_power", "set_cw_speed"] {
            ownership.beginControl(control)
            ownership.completeControl(control)
        }
        XCTAssertTrue(ownership.releases.isEmpty)
    }

    func testUncertainTransmitAttemptStillRequiresRelease() {
        var ownership = StationTransmitOwnership()
        ownership.beginControl("ptt", enabled: true)
        // No completion callback models a lost command response.
        XCTAssertEqual(ownership.releases, [.releasePTT])
        ownership.beginControl("ptt", enabled: false)
        XCTAssertEqual(ownership.releases, [.releasePTT])
        ownership.completeControl("ptt", enabled: false)
        XCTAssertTrue(ownership.releases.isEmpty)
    }

    func testCWAndTuneHaveTheirOwnReleaseObligations() {
        var ownership = StationTransmitOwnership()
        ownership.beginControl("send_cw")
        ownership.beginAction(.tune)
        XCTAssertEqual(ownership.releases, [.clearCW, .cancelTune, .releasePTT])
        ownership.completeControl("clear_cw")
        XCTAssertEqual(ownership.releases, [.cancelTune, .releasePTT])
        ownership.completeAction(.cancel)
        XCTAssertTrue(ownership.releases.isEmpty)
        ownership.beginAction(.tune)
        ownership.completeAction(.standby)
        XCTAssertTrue(ownership.releases.isEmpty)
    }

    func testDirectEndpointRequiresCredentialFreeHTTPS() throws {
        XCTAssertEqual(try LiveStationSession.validatedURL("https://station.example/"),
                       "https://station.example/")
        for candidate in ["http://station.example", "https://user:secret@station.example",
                          "https://station.example/?token=secret", "https://station.example/#fragment",
                          "file:///tmp/agent", "https://"] {
            XCTAssertThrowsError(try LiveStationSession.validatedURL(candidate))
        }
    }

    func testDirectRotorAndSpotRejectMalformedRequestsBeforeTransport() async {
        for host in ["", "rotor.example/path", "user@rotor.example", "rotor host"] {
            XCTAssertThrowsError(try LiveStationSession.validatedRotorHost(host))
        }
        XCTAssertEqual(try? LiveStationSession.validatedRotorHost("rotor.local"), "rotor.local")
        let invalidRequests: [(String, [String: Any])] = [
            ("station_rotor_connect", ["provider": "direct_agent", "host": "rotor.local", "port": 0]),
            ("station_rotor_connect", ["provider": "direct_agent", "host": "rotor.local", "port": 4_001.5]),
            ("station_rotor_goto", ["provider": "direct_agent", "bearing": -1]),
            ("station_rotor_goto", ["provider": "direct_agent", "bearing": true]),
            ("station_add_spot", ["provider": "direct_agent", "spot": ["callsign": "OM0RX"]]),
            ("station_radio_control", ["provider": "direct_agent", "control": "ptt", "enabled": "true"]),
        ]
        for (method, params) in invalidRequests {
            do {
                _ = try await LiveStationMethods.handle(method, params: params)
                XCTFail("Accepted malformed \(method) request")
            } catch let failure as WorkerFailure {
                XCTAssertEqual(failure.code, "invalid_params")
            } catch {
                XCTFail("Unexpected error for \(method): \(error)")
            }
        }
    }
    #endif
}
