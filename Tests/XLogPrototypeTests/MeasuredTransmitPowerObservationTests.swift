#if os(macOS)
import Foundation
import XCTest
@testable import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class MeasuredTransmitPowerObservationTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let sessionID = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!

    private func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private var radio: [String: Any] {
        ["connected": true, "known": true, "stale": false, "station_bound": true,
         "mox": true, "frequency_hz": 14_074_000, "mode": "DIGU", "drive": 35,
         "updated_at": now.timeIntervalSince1970,
         "observed_at": iso(now.addingTimeInterval(-0.2))]
    }

    private var kpa: [String: Any] {
        ["enabled": true, "connected": true, "operate": true, "quality": "good", "fault": "00",
         "output_power_w": 450.0, "observed_at": now.timeIntervalSince1970 - 1,
         "meter_observed_at": now.timeIntervalSince1970 - 0.1,
         "meter_sample_observed_at": now.timeIntervalSince1970 - 0.1,
         "meter_complete": true, "meter_error": NSNull()]
    }

    private func decoded(radio: [String: Any]? = nil, kpa: [String: Any]? = nil,
                         receivedAt: Date? = nil) throws -> RadioSnapshot {
        let data = try JSONSerialization.data(withJSONObject: ["success": true, "state": [
            "protocol_version": 1, "revision": 42, "radio": radio ?? self.radio,
            "elecraft": ["kpa500": kpa ?? self.kpa],
        ]])
        return try RemoteAgentStateDecoder.stateResponse(data, receivedAt: receivedAt ?? now).snapshot
    }

    private func projection(_ observed: RadioSnapshot, transport: RadioConnectionState = .ready,
                            startedAt: Date? = nil, at date: Date? = nil) -> [String: Any] {
        LiveStationSession.project(observed, transport: transport, allowTransmit: false,
                                   generation: 7, powerSessionID: sessionID,
                                   powerSessionStartedAt: startedAt ?? now.addingTimeInterval(-1),
                                   now: date ?? now)
    }

    func testExplicitAmplifierMeasurementSurvivesDecoderAndProjection() throws {
        let snapshot = try decoded()
        let measurement = try XCTUnwrap(snapshot.measuredTransmitPower)
        XCTAssertEqual(measurement.source, .kpa500Output)
        XCTAssertEqual(measurement.watts, 450)
        XCTAssertEqual(measurement.observedAt.timeIntervalSince1970, now.timeIntervalSince1970 - 0.1, accuracy: 0.000001)
        XCTAssertEqual(measurement.radioObservedAt.timeIntervalSince1970, now.timeIntervalSince1970 - 0.2, accuracy: 0.000001)
        XCTAssertEqual(measurement.amplifierObservedAt, now.addingTimeInterval(-1))
        XCTAssertEqual(measurement.receivedAt, now)
        let projected = projection(snapshot)
        let power = try XCTUnwrap(projected["measured_tx_power"] as? [String: Any])
        XCTAssertEqual(power["watts"] as? Double, 450)
        XCTAssertEqual(power["source"] as? String, "kpa500_output")
        XCTAssertEqual(power["measurement_point"] as? String, "amplifier_output")
        XCTAssertEqual(power["unit"] as? String, "W")
        XCTAssertEqual(power["observed_at"] as? Double, measurement.observedAt.timeIntervalSince1970)
        XCTAssertEqual(power["received_at"] as? Double, now.timeIntervalSince1970)
        XCTAssertEqual(power["session_id"] as? String, sessionID.uuidString)
        XCTAssertEqual(power["session_started_at"] as? Double, now.timeIntervalSince1970 - 1)
        XCTAssertEqual(power["generation"] as? UInt64, 7)
        XCTAssertEqual(projected["power_session_id"] as? String, sessionID.uuidString)
        XCTAssertEqual((projected["station"] as? [String: Any])?["tx_power_watts"] as? Double, 450)
    }

    func testUnsafeRadioStateHasNoMeasuredObservation() throws {
        for (key, value) in [("connected", false), ("known", false), ("stale", true),
                             ("station_bound", false), ("mox", false)] {
            var changed = radio
            changed[key] = value
            XCTAssertNil(try decoded(radio: changed).measuredTransmitPower, key)
            changed.removeValue(forKey: key)
            XCTAssertNil(try decoded(radio: changed).measuredTransmitPower, "Missing \(key)")
        }
    }

    func testUnsafeOrMissingAmplifierMetadataRejectsRetainedWatts() throws {
        let invalid: [(String, Any)] = [
            ("enabled", false), ("connected", false), ("operate", false), ("quality", "degraded"),
            ("quality", "unknown"), ("fault", "01"), ("meter_complete", false),
            ("meter_error", "Serial timeout"), ("output_power_w", 0),
            ("output_power_w", -1), ("output_power_w", 1_000.1),
        ]
        for (key, value) in invalid {
            var changed = kpa
            changed[key] = value
            XCTAssertNil(try decoded(kpa: changed).measuredTransmitPower, "Invalid \(key): \(value)")
        }
        for key in ["enabled", "connected", "operate", "quality", "fault", "meter_complete",
                    "output_power_w", "observed_at", "meter_sample_observed_at"] {
            var changed = kpa
            changed.removeValue(forKey: key)
            XCTAssertNil(try decoded(kpa: changed).measuredTransmitPower, "Missing \(key)")
        }
        // Preserve display compatibility, without admitting it as measured power.
        var failed = kpa
        failed["meter_complete"] = false
        failed["meter_error"] = "Serial timeout"
        let snapshot = try decoded(kpa: failed)
        XCTAssertEqual(snapshot.remoteStationStatus?.txPowerWatts, 450)
        XCTAssertTrue(projection(snapshot)["measured_tx_power"] is NSNull)
    }

    func testFlexDriveAloneNeverBecomesMeasuredWatts() throws {
        let snapshot = try decoded(kpa: [:])
        XCTAssertEqual(snapshot.rfPowerWatts, 35)
        XCTAssertEqual(snapshot.remoteStationStatus?.txPowerWatts, 35)
        XCTAssertNil(snapshot.measuredTransmitPower)
        XCTAssertTrue(projection(snapshot)["measured_tx_power"] is NSNull)
    }

    func testTimestampUnitsAgeAndFutureEvidenceAreRejected() throws {
        for timestamp in [0.0, -1.0, now.timeIntervalSince1970 - 2.001,
                          now.timeIntervalSince1970 + 0.001, now.timeIntervalSince1970 * 1_000] {
            var changed = kpa
            changed["meter_sample_observed_at"] = timestamp
            XCTAssertNil(try decoded(kpa: changed).measuredTransmitPower, "Meter \(timestamp)")
            var changedRadio = radio
            changedRadio["observed_at"] = iso(Date(timeIntervalSince1970: timestamp))
            XCTAssertNil(try decoded(radio: changedRadio).measuredTransmitPower, "Radio \(timestamp)")
        }
        var changed = kpa
        changed["observed_at"] = now.timeIntervalSince1970 - 15.001
        XCTAssertNil(try decoded(kpa: changed).measuredTransmitPower)
        changed["observed_at"] = now.timeIntervalSince1970 + 0.001
        XCTAssertNil(try decoded(kpa: changed).measuredTransmitPower)
        var changedRadio = radio
        changedRadio.removeValue(forKey: "observed_at")
        XCTAssertNil(try decoded(radio: changedRadio).measuredTransmitPower)
    }

    func testLegacyMeterTimeAndEmptyRadioPollCannotRenewEvidence() throws {
        var legacy = kpa
        legacy.removeValue(forKey: "meter_sample_observed_at")
        XCTAssertNil(try decoded(kpa: legacy).measuredTransmitPower,
                     "Legacy meter_observed_at is not actual sample receipt provenance")
        var delayed = kpa
        delayed["meter_sample_observed_at"] = now.timeIntervalSince1970 - 3
        delayed["meter_observed_at"] = now.timeIntervalSince1970
        XCTAssertNil(try decoded(kpa: delayed).measuredTransmitPower,
                     "Later firmware reply must not renew the earlier meter sample")
        var emptyPoll = radio
        emptyPoll["updated_at"] = now.timeIntervalSince1970
        emptyPoll["observed_at"] = iso(now.addingTimeInterval(-3))
        XCTAssertNil(try decoded(radio: emptyPoll).measuredTransmitPower,
                     "Fresh poll time must not renew retained radio observation")
        for invalid in ["", "invalid", "1800000000"] {
            emptyPoll["observed_at"] = invalid
            XCTAssertNil(try decoded(radio: emptyPoll).measuredTransmitPower)
        }
        var noFraction = radio
        noFraction["observed_at"] = "2027-01-15T08:00:00+00:00"
        XCTAssertNotNil(try decoded(radio: noFraction).measuredTransmitPower)
    }

    func testReadyDeliveredBeforeConnectingStillInstallsNewAttemptIdentity() throws {
        let events = StationPowerSessionEventSource()
        var session = StationPowerSessionState()
        let firstConnecting = events.stamp(.connecting, at: now.addingTimeInterval(-1))
        let firstReady = events.stamp(.ready, at: now.addingTimeInterval(-0.5))
        XCTAssertTrue(session.apply(firstReady))
        XCTAssertEqual(session.sessionID, firstConnecting.sessionID)
        XCTAssertFalse(session.apply(firstConnecting))
        let retrying = events.stamp(.retrying, at: now)
        let newConnecting = events.stamp(.connecting, at: now)
        let newReady = events.stamp(.ready, at: now.addingTimeInterval(0.1))
        XCTAssertTrue(session.apply(newReady))
        XCTAssertEqual(session.sessionID, newConnecting.sessionID)
        XCTAssertEqual(session.startedAt, now)
        XCTAssertNotEqual(session.sessionID, firstReady.sessionID)
        XCTAssertFalse(session.apply(newConnecting))
        XCTAssertFalse(session.apply(retrying))
        XCTAssertFalse(session.apply(firstReady))
        let projected = LiveStationSession.project(try decoded(), transport: .ready, allowTransmit: false,
            generation: 7, powerSessionID: session.sessionID, powerSessionStartedAt: session.startedAt, now: now)
        XCTAssertTrue(projected["measured_tx_power"] is NSNull,
                      "A reordered reconnect must reject the prior attempt's still-fresh sample")
    }

    func testManualReconnectFenceAndClockRollbackUseEventSequence() {
        let events = StationPowerSessionEventSource()
        var session = StationPowerSessionState()
        let initial = events.stamp(.connecting, at: now)
        let queuedReady = events.stamp(.ready, at: now.addingTimeInterval(1))
        // The synchronous manual reconnect fence precedes awaiting the client.
        let manual = events.stamp(.connecting, at: now.addingTimeInterval(-1))
        XCTAssertTrue(session.apply(manual))
        XCTAssertFalse(session.apply(queuedReady))
        XCTAssertFalse(session.apply(initial))
        XCTAssertEqual(session.startedAt, now.addingTimeInterval(-1))
        let ready = events.stamp(.ready, at: now.addingTimeInterval(-2))
        XCTAssertTrue(session.apply(ready), "Sequence, not wall-clock order, chooses the latest state")
        XCTAssertEqual(session.sessionID, manual.sessionID)
        XCTAssertEqual(session.startedAt, manual.startedAt)
        XCTAssertEqual(session.lastSequence, ready.sequence)
    }

    func testSourceReconciliationFindsReconnectWithEveryCallbackStillQueued() throws {
        let events = StationPowerSessionEventSource()
        var session = StationPowerSessionState()
        XCTAssertNil(events.latest())
        XCTAssertNil(session.reconcile(events))
        _ = events.stamp(.connecting, at: now.addingTimeInterval(-1))
        _ = events.stamp(.ready, at: now.addingTimeInterval(-0.5))
        XCTAssertEqual(session.reconcile(events), .ready)
        let capturedSessionID = session.sessionID
        let observation = try decoded()
        let before = LiveStationSession.project(observation, transport: .ready, allowTransmit: false,
            generation: 7, powerSessionID: session.sessionID, powerSessionStartedAt: session.startedAt, now: now)
        XCTAssertNotNil(before["measured_tx_power"] as? [String: Any])

        // Simulate suspension in rotor/radio snapshot loading: both callback
        // events are stamped, but neither Task has reached the station actor.
        let connecting = events.stamp(.connecting, at: now)
        let ready = events.stamp(.ready, at: now)
        XCTAssertEqual(session.sessionID, capturedSessionID, "Actor has received no event yet")
        XCTAssertEqual(events.latest()?.sequence, ready.sequence)
        XCTAssertEqual(events.latest()?.sequence, ready.sequence, "Peeking must not create events")
        XCTAssertEqual(session.reconcile(events), .ready,
                       "Snapshot uses this same reconciliation after every await")
        XCTAssertEqual(session.sessionID, connecting.sessionID)
        XCTAssertNotEqual(session.sessionID, capturedSessionID, "Snapshot identity guard now rejects old context")
        XCTAssertEqual(session.startedAt, now)
        let after = LiveStationSession.project(observation, transport: .ready, allowTransmit: false,
            generation: 7, powerSessionID: session.sessionID, powerSessionStartedAt: session.startedAt, now: now)
        XCTAssertTrue(after["measured_tx_power"] is NSNull)
        XCTAssertFalse(session.apply(connecting), "Delayed callback cannot undo source reconciliation")
        XCTAssertFalse(session.apply(ready))
        XCTAssertNil(session.reconcile(events), "Unchanged source does not advance the reducer")
    }

    func testProjectionExpiresEvidenceAndFencesReconnectEvenWithSameGeneration() throws {
        let snapshot = try decoded()
        XCTAssertTrue(projection(snapshot, at: now.addingTimeInterval(2))["measured_tx_power"] is NSNull)
        XCTAssertTrue(projection(snapshot, startedAt: now)["measured_tx_power"] is NSNull,
                      "Cached meter predates reconnection despite identical generation")
        XCTAssertTrue(projection(snapshot, startedAt: now.addingTimeInterval(-0.15))["measured_tx_power"] is NSNull,
                      "Retained radio observation predates reconnection despite a newer meter")
        for transport in [RadioConnectionState.stopped, .connecting, .retrying, .failed] {
            XCTAssertTrue(projection(snapshot, transport: transport)["measured_tx_power"] is NSNull)
        }
        var disconnected = snapshot
        disconnected.isConnected = false
        XCTAssertTrue(projection(disconnected)["measured_tx_power"] is NSNull)
        var receiving = snapshot
        receiving.isTransmitting = false
        XCTAssertTrue(projection(receiving)["measured_tx_power"] is NSNull)
        let withoutSession = LiveStationSession.project(snapshot, transport: .ready, allowTransmit: false,
            generation: 7, powerSessionID: sessionID, powerSessionStartedAt: nil, now: now)
        XCTAssertTrue(withoutSession["measured_tx_power"] is NSNull)
    }

    func testStrictFinitePowerBoundsAndInclusiveFreshnessLimits() throws {
        for watts in [Double.nan, .infinity, -.infinity, 0, -1, 1_000.1] {
            XCTAssertNil(MeasuredTransmitPowerObservation(watts: watts, observedAt: now,
                radioObservedAt: now, amplifierObservedAt: now, receivedAt: now))
        }
        let boundary = try XCTUnwrap(MeasuredTransmitPowerObservation(watts: 1_000,
            observedAt: now.addingTimeInterval(-2), radioObservedAt: now.addingTimeInterval(-2),
            amplifierObservedAt: now.addingTimeInterval(-15), receivedAt: now))
        XCTAssertTrue(boundary.isFresh(at: now))
        XCTAssertFalse(boundary.isFresh(at: now.addingTimeInterval(0.001)))
        XCTAssertFalse(boundary.isFresh(at: now.addingTimeInterval(-0.001)), "Future receipt")
        XCTAssertFalse(boundary.isFresh(at: Date(timeIntervalSince1970: .nan)))
        XCTAssertNil(MeasuredTransmitPowerObservation(watts: 100, observedAt: Date(timeIntervalSince1970: .nan),
            radioObservedAt: now, amplifierObservedAt: now, receivedAt: now))
    }
}
#endif
