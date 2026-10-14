#if os(macOS)
import Foundation
import XCTest
@testable import XCatIntegrationCore

final class RemoteAgentSplitSafetyProjectionTests: XCTestCase {
    private func decoded(alarmMessage: String, alarmCode: String = "flex-route-readback-mismatch",
                         pathAlignment: String = "confirmed", interlock: String = "READY",
                         allowedActions: [String] = ["standby", "prepare-route"],
                         receiveHz: Int = 24_940_000, transmitHz: Int = 24_945_000,
                         band: String = "12m") throws -> RadioSnapshot {
        let state: [String: Any] = [
            "protocol_version": 1,
            "revision": 8_413,
            "capabilities": ["commands": ["station_operate", "station_standby"]],
            "radio": [
                "connected": true, "known": true, "stale": false, "station_bound": true,
                "mox": false, "interlock_state": interlock, "frequency_hz": transmitHz,
                "mode": "USB",
                "active_receive": ["index_letter": "A", "frequency_hz": receiveHz,
                                   "mode": "USB", "active": true, "transmit": false, "in_use": true],
                "transmit": ["index_letter": "B", "frequency_hz": transmitHz,
                             "mode": "USB", "active": false, "transmit": true, "in_use": true],
                "vfos": [
                    "A": ["index_letter": "A", "frequency_hz": receiveHz,
                          "mode": "USB", "active": true, "transmit": false, "in_use": true],
                    "B": ["index_letter": "B", "frequency_hz": transmitHz,
                          "mode": "USB", "active": false, "transmit": true, "in_use": true],
                ],
            ],
            "station": [
                "commissioned": true, "coordinator_state": "safe_rx",
                "allowed_actions": allowedActions,
                "route": ["band": band, "amplifier_allowed": true],
                "path": ["band": band, "alignment": pathAlignment],
                "issues": [],
                "alarms": ["active_count": 1, "items": [[
                    "code": alarmCode, "severity": "critical", "message": alarmMessage, "active": true,
                ]]],
            ],
        ]
        let data = try JSONSerialization.data(withJSONObject: ["success": true, "state": state])
        return try RemoteAgentStateDecoder.stateResponse(data).snapshot
    }

    func testNormalSplitDoesNotBecomeAnAlarmOrInhibitor() throws {
        let snapshot = try decoded(alarmMessage: "FLEX frequency is 24940 kHz, expected 24945 kHz")
        let status = try XCTUnwrap(snapshot.remoteStationStatus)
        XCTAssertEqual(snapshot.frequencyHz, 24_940_000)
        XCTAssertEqual(snapshot.transmitFrequencyHz, 24_945_000)
        XCTAssertEqual(status.alarmSummary, "ALARM clear")
        XCTAssertTrue(status.alarmMessages.isEmpty)
        XCTAssertTrue(status.inhibitors.isEmpty)
        XCTAssertTrue(status.allowedActions.contains("operate"))
    }

    func testArbitraryTwentyMetreSplitUsesObservedVFOsNotAFixedOffset() throws {
        let snapshot = try decoded(alarmMessage: "FLEX frequency is 14200 kHz, expected 14230 kHz",
                                   receiveHz: 14_200_000, transmitHz: 14_230_000, band: "20m")
        let status = try XCTUnwrap(snapshot.remoteStationStatus)
        XCTAssertEqual(snapshot.frequencyHz, 14_200_000)
        XCTAssertEqual(snapshot.transmitFrequencyHz, 14_230_000)
        XCTAssertEqual(status.band, "20m")
        XCTAssertEqual(status.alarmSummary, "ALARM clear")
        XCTAssertTrue(status.inhibitors.isEmpty)
        XCTAssertTrue(status.allowedActions.contains("operate"))
    }

    func testDifferentExpectedFrequencyRemainsBlocking() throws {
        let snapshot = try decoded(alarmMessage: "FLEX frequency is 24940 kHz, expected 24946 kHz")
        let status = try XCTUnwrap(snapshot.remoteStationStatus)
        XCTAssertEqual(status.alarmSummary, "ALARM 1")
        XCTAssertEqual(status.alarmMessages, ["FLEX frequency is 24940 kHz, expected 24946 kHz"])
        XCTAssertFalse(status.inhibitors.isEmpty)
        XCTAssertFalse(status.allowedActions.contains("operate"))
    }

    func testExactPairStillBlocksWhenLivePathIsNotConfirmed() throws {
        let snapshot = try decoded(alarmMessage: "FLEX frequency is 24940 kHz, expected 24945 kHz",
                                   pathAlignment: "mismatch")
        let status = try XCTUnwrap(snapshot.remoteStationStatus)
        XCTAssertEqual(status.alarmSummary, "ALARM 1")
        XCTAssertFalse(status.inhibitors.isEmpty)
        XCTAssertFalse(status.allowedActions.contains("operate"))
    }

    func testExactPairStillBlocksWhileTransmitting() throws {
        let snapshot = try decoded(alarmMessage: "FLEX frequency is 24940 kHz, expected 24945 kHz",
                                   interlock: "TRANSMITTING")
        let status = try XCTUnwrap(snapshot.remoteStationStatus)
        XCTAssertEqual(status.alarmSummary, "ALARM 1")
        XCTAssertFalse(status.inhibitors.isEmpty)
        XCTAssertFalse(status.allowedActions.contains("operate"))
    }
}
#endif
