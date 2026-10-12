#if os(macOS)
import Foundation
import XCTest
import XCatIntegrationCore
@testable import XLogPrototypeSupport

private final class FlexFixtureBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: FakeFlexRadio?
    func store(_ value: FakeFlexRadio) { lock.withLock { stored = value } }
    func get() -> FakeFlexRadio? { lock.withLock { stored } }
}

private actor FakeFlexRadio: FlexSessionRadio {
    private var value: RadioSnapshot
    private let onSnapshot: FlexRadioClient.SnapshotHandler
    private let onState: FlexRadioClient.StateHandler
    private var commands: [String] = []
    private var observeRelease = true
    private var observeTune = true
    private var transmitRevision: UInt64? = 1

    init(snapshot: RadioSnapshot, onState: @escaping FlexRadioClient.StateHandler,
         onSnapshot: @escaping FlexRadioClient.SnapshotHandler) {
        value = snapshot
        self.onState = onState
        self.onSnapshot = onSnapshot
    }

    func start() {
        onState(.ready, "fixture")
        onSnapshot(value)
    }
    func reconnectNow() { start() }
    func stopTransportOnly() { commands.append("stop_transport") }
    func snapshot() -> RadioSnapshot { value }
    func commandLog() -> [String] { commands }
    func setObserveRelease(_ value: Bool) { observeRelease = value }
    func setObserveTune(_ value: Bool) { observeTune = value }
    func simulateState(_ state: RadioConnectionState) { onState(state, "fixture") }
    func simulateUnrelatedSnapshot() { onSnapshot(value) }
    func transmitObservation() -> FlexRadioClient.TransmitObservation? {
        guard let transmitRevision else { return nil }
        return .init(revision: transmitRevision, isTransmitting: value.isTransmitting,
                     isConnected: value.isConnected)
    }
    func setTransmitObservationKnown(_ known: Bool) { transmitRevision = known ? 1 : nil }
    func simulateInterlock(_ transmitting: Bool, publish: Bool) {
        value.isTransmitting = transmitting
        transmitRevision = (transmitRevision ?? 0) &+ 1
        if publish { onSnapshot(value) }
    }

    func primaryFrequency() -> Int64? { value.vfo("A")?.frequencyHz }
    func setPrimaryFrequency(_ frequencyHz: Int64) {
        commands.append("frequency_a")
        value.vfos = value.vfos.map { vfo in
            var copy = vfo
            if copy.letter == "A" { copy.frequencyHz = frequencyHz }
            return copy
        }
        if value.slice == "A" { value.frequencyHz = frequencyHz }
        if value.transmitSlice == "A" { value.transmitFrequencyHz = frequencyHz }
        onSnapshot(value)
    }
    func setFrequency(_ frequencyHz: Int64) {
        commands.append("frequency")
        value.frequencyHz = frequencyHz
        value.vfos = value.vfos.map { vfo in
            var copy = vfo
            if copy.isReceive { copy.frequencyHz = frequencyHz }
            return copy
        }
        onSnapshot(value)
    }
    func setMode(_ mode: String) {
        commands.append("mode")
        value.mode = mode
        value.vfos = value.vfos.map { vfo in
            var copy = vfo
            if copy.isReceive { copy.mode = mode }
            return copy
        }
        onSnapshot(value)
    }
    func setFrequencyAndMode(_ frequencyHz: Int64, mode: String) {
        commands.append("frequency_mode")
        if observeTune {
            value.frequencyHz = frequencyHz
            value.transmitFrequencyHz = frequencyHz
            value.mode = mode
            value.vfos = value.vfos.map { vfo in
                var copy = vfo
                if copy.letter == "A" { copy.frequencyHz = frequencyHz; copy.mode = mode }
                return copy
            }
            onSnapshot(value)
        }
    }
    func setTransmit(_ enabled: Bool) {
        commands.append(enabled ? "ptt_on" : "ptt_off")
        if enabled || observeRelease {
            value.isTransmitting = enabled
            transmitRevision = (transmitRevision ?? 0) &+ 1
            onSnapshot(value)
        }
    }
    func setTransmit(_ mode: CATTransmitMode) {
        commands.append("tune_on")
        value.isTransmitting = true
        transmitRevision = (transmitRevision ?? 0) &+ 1
        onSnapshot(value)
    }
    func secondaryFrequency() -> Int64? { value.vfo("B")?.frequencyHz }
    func setSecondaryFrequency(_ frequencyHz: Int64) {
        commands.append("frequency_b")
        value.vfos = value.vfos.map { vfo in
            var copy = vfo
            if copy.letter == "B" { copy.frequencyHz = frequencyHz }
            return copy
        }
        if value.slice == "B" { value.frequencyHz = frequencyHz }
        if value.transmitSlice == "B" { value.transmitFrequencyHz = frequencyHz }
        onSnapshot(value)
    }
    func setSplitTransmit(_ enabled: Bool) {
        commands.append(enabled ? "split_on" : "split_off")
        value.transmitSlice = enabled ? "B" : "A"
        if !enabled { value.transmitFrequencyHz = value.vfo("A")?.frequencyHz ?? value.frequencyHz }
        value.vfos = value.vfos.map { vfo in
            var copy = vfo
            copy.isTransmit = copy.letter == value.transmitSlice
            return copy
        }
        onSnapshot(value)
    }
    func setReceiveVFO(_ vfo: Int) {
        commands.append(vfo == 0 ? "receive_a" : "receive_b")
        value.slice = vfo == 0 ? "A" : "B"
        value.frequencyHz = value.vfo(value.slice)?.frequencyHz ?? value.frequencyHz
        value.mode = value.vfo(value.slice)?.mode ?? value.mode
        value.vfos = value.vfos.map { vfo in
            var copy = vfo
            copy.isReceive = copy.letter == value.slice
            return copy
        }
        onSnapshot(value)
    }
    func cwSpeed() -> Int { 25 }
    func setCWSpeed(_ wordsPerMinute: Int) { commands.append("cw_speed") }
    func sendCW(_ text: String) { commands.append("cw_send") }
    func clearCW() {
        commands.append("cw_clear")
        if observeRelease {
            value.isTransmitting = false
            transmitRevision = (transmitRevision ?? 0) &+ 1
            onSnapshot(value)
        }
    }
}

final class LiveFlexSessionTests: XCTestCase {
    func testProviderClaimPreventsCrossProviderConnectUntilRelease() async throws {
        let claim = StationProviderClaim()
        try await claim.reserve("direct_flex_lan")
        do {
            try await claim.reserve("direct_agent")
            XCTFail("The Remote Agent displaced a reserved direct FLEX provider")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_busy")
        }
        await claim.release("direct_flex_lan")
        try await claim.reserve("direct_agent")
    }

    private func fixture(_ initial: RadioSnapshot = RadioSnapshot(frequencyHz: 14_074_000),
                         allowTransmit: Bool = false,
                         timeout: Duration = .milliseconds(250)) async throws -> (LiveFlexSession, FakeFlexRadio) {
        let box = FlexFixtureBox()
        let session = LiveFlexSession(readbackTimeout: timeout) { _, onState, onSnapshot in
            let radio = FakeFlexRadio(snapshot: initial, onState: onState, onSnapshot: onSnapshot)
            box.store(radio)
            return radio
        }
        _ = try await session.handle("station_connect", params: [
            "provider": "direct_flex_lan", "host": "192.168.1.20", "station_name": "Maestro",
            "allow_transmit": allowTransmit,
        ])
        let radio = try XCTUnwrap(box.get())
        for _ in 0..<50 {
            let snapshot = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
            if snapshot["available"] as? Bool == true { return (session, radio) }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Fixture radio was not observed")
        return (session, radio)
    }

    func testReadOnlyDisconnectDoesNotSendAnyRFRelease() async throws {
        let (session, radio) = try await fixture()
        _ = try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["stop_transport"])
    }

    func testTuneLeavesBReceiveAndTransmitOnlyAfterFreshAProof() async throws {
        let initial = RadioSnapshot(frequencyHz: 7_050_000, mode: "LSB", slice: "B",
            transmitSlice: "B", transmitFrequencyHz: 7_050_000,
            vfos: [RadioVFO(letter: "A", frequencyHz: 14_074_000, mode: "DIGU"),
                   RadioVFO(letter: "B", frequencyHz: 7_050_000, mode: "LSB", isReceive: true, isTransmit: true)])
        let (session, radio) = try await fixture(initial)
        let result = try await session.handle("station_tune", params: [
            "provider": "direct_flex_lan", "frequency_hz": 14_250_000, "mode": "SSB",
        ])
        XCTAssertEqual(result["confirmed"] as? Bool, true)
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["receive_a", "split_off", "frequency_mode"])
        let state = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
        let observed = state["radio"] as? [String: Any]
        XCTAssertEqual(observed?["receive_vfo"] as? String, "A")
        XCTAssertEqual(observed?["transmit_vfo"] as? String, "A")
        XCTAssertEqual(observed?["mode"] as? String, "USB")
    }

    func testAckWithoutFreshReadbackNeverConfirmsTune() async throws {
        let (session, radio) = try await fixture()
        await radio.setObserveTune(false)
        do {
            _ = try await session.handle("station_tune", params: [
                "provider": "direct_flex_lan", "frequency_hz": 14_250_000, "mode": "USB",
            ])
            XCTFail("ACK-only tune was confirmed")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_timeout")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["frequency_mode"])
    }

    func testMissingAProofBlocksTuneBeforeAnyWrite() async throws {
        let initial = RadioSnapshot(frequencyHz: 7_050_000, mode: "LSB", slice: "B",
            transmitSlice: "B", vfos: [RadioVFO(letter: "B", frequencyHz: 7_050_000,
                                                 mode: "LSB", isReceive: true, isTransmit: true)])
        let (session, radio) = try await fixture(initial)
        do {
            _ = try await session.handle("station_tune", params: [
                "provider": "direct_flex_lan", "frequency_hz": 14_250_000, "mode": "USB",
            ])
            XCTFail("Missing VFO A was allowed")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_unavailable")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, [])
    }

    func testOwnedReleaseFailureRetainsConnectionAndObligationUntilObservedOff() async throws {
        let (session, radio) = try await fixture(allowTransmit: true)
        _ = try await session.handle("station_radio_control", params: [
            "provider": "direct_flex_lan", "control": "ptt", "enabled": true,
        ])
        await radio.setObserveRelease(false)
        do {
            _ = try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
            XCTFail("Unobserved release disconnected")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "release_unconfirmed")
        }
        let afterFailure = await radio.commandLog()
        XCTAssertEqual(afterFailure, ["ptt_on", "ptt_off"])
        await radio.setObserveRelease(true)
        _ = try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
        let afterRetry = await radio.commandLog()
        XCTAssertEqual(afterRetry, ["ptt_on", "ptt_off", "ptt_off", "stop_transport"])
    }

    func testTransmitRequiresOptInAndInvalidHostIsRejectedBeforeFactory() async throws {
        let (session, radio) = try await fixture()
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "ptt", "enabled": true,
            ])
            XCTFail("Transmit lacked opt-in")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_action_blocked")
        }
        let afterDeniedPTT = await radio.commandLog()
        XCTAssertEqual(afterDeniedPTT, [])
        do {
            _ = try await session.handle("station_connect", params: [
                "provider": "direct_flex_lan", "host": "https://example.org/", "station_name": "Maestro",
            ])
            XCTFail("Unsafe endpoint was accepted")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "invalid_params")
        }
        let afterInvalidHost = await radio.commandLog()
        XCTAssertEqual(afterInvalidHost, [])
    }

    func testExternalTransmitIsNeverClaimedOrReleasedByReadOnlySession() async throws {
        let initial = RadioSnapshot(frequencyHz: 14_074_000, isTransmitting: true)
        let (session, radio) = try await fixture(initial, allowTransmit: true)
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "ptt", "enabled": true,
            ])
            XCTFail("Already-keyed radio was claimed")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_action_blocked")
        }
        _ = try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["stop_transport"])
    }

    func testOwnedCWIsClearedBeforePTTReleaseOnDisconnect() async throws {
        let (session, radio) = try await fixture(allowTransmit: true)
        _ = try await session.handle("station_radio_control", params: [
            "provider": "direct_flex_lan", "control": "send_cw", "text": "CQ TEST",
        ])
        _ = try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["cw_send", "cw_clear", "ptt_off", "stop_transport"])
    }

    func testManualVFOFrequencyAndSplitControlsRequireObservedReadback() async throws {
        let initial = RadioSnapshot(frequencyHz: 14_074_000, mode: "DIGU", slice: "A",
            transmitSlice: "A", transmitFrequencyHz: 14_074_000,
            vfos: [RadioVFO(letter: "A", frequencyHz: 14_074_000, mode: "DIGU", isReceive: true, isTransmit: true),
                   RadioVFO(letter: "B", frequencyHz: 7_050_000, mode: "LSB")])
        let (session, radio) = try await fixture(initial)
        for (control, arguments) in [
            ("set_frequency_b", ["frequency_hz": 7_055_000] as [String: Any]),
            ("set_receive_vfo", ["vfo": "B"]),
            ("set_split", ["enabled": true]),
            ("set_mode", ["mode": "USB"]),
        ] {
            let result = try await session.handle("station_radio_control", params:
                ["provider": "direct_flex_lan", "control": control].merging(arguments) { _, latest in latest })
            XCTAssertEqual(result["confirmed"] as? Bool, true, control)
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["frequency_b", "receive_b", "split_on", "mode"])
    }

    func testUnsupportedRFPowerDoesNotClaimSuccessOrSendControl() async throws {
        let (session, radio) = try await fixture()
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_rf_power", "watts": 50,
            ])
            XCTFail("Unimplemented copied FLEX transport claimed RF power support")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_rejected")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, [])
        let state = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
        let capabilities = try XCTUnwrap(state["capabilities"] as? [String: Any])
        XCTAssertFalse((capabilities["supported_commands"] as? [String] ?? []).contains("set_rf_power"))
    }

    func testTransportLossInvalidatesObservedStateBeforeFurtherControls() async throws {
        let (session, radio) = try await fixture()
        await radio.simulateState(.connecting)
        for _ in 0..<50 {
            let state = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
            if state["available"] as? Bool == false { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_mode", "mode": "USB",
            ])
            XCTFail("Control used a stale pre-loss radio snapshot")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_unavailable")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, [])
    }

    func testReconnectCannotSupersedeAnInFlightControl() async throws {
        let (session, radio) = try await fixture()
        await radio.setObserveTune(false)
        let tuning = Task {
            try await session.handle("station_tune", params: [
                "provider": "direct_flex_lan", "frequency_hz": 14_250_000, "mode": "USB",
            ])
        }
        for _ in 0..<50 {
            if await radio.commandLog().contains("frequency_mode") { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        do {
            _ = try await session.handle("station_reconnect", params: ["provider": "direct_flex_lan"])
            XCTFail("Reconnect displaced an in-flight tune")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_busy")
        }
        do {
            _ = try await tuning.value
            XCTFail("ACK-only tune was confirmed")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_timeout")
        }
    }

    func testTransmitRequiresExplicitSliceRolesAndInterlockEvidence() async throws {
        let missingRoles = RadioSnapshot(frequencyHz: 14_074_000,
            vfos: [RadioVFO(letter: "A", frequencyHz: 14_074_000, mode: "DIGU")])
        let (session, radio) = try await fixture(missingRoles, allowTransmit: true)
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "ptt", "enabled": true,
            ])
            XCTFail("Transmit was allowed without explicit slice roles")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_unavailable")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, [])

        let knownRoles = RadioSnapshot(frequencyHz: 14_074_000,
            vfos: [RadioVFO(letter: "A", frequencyHz: 14_074_000, mode: "DIGU",
                            isReceive: true, isTransmit: true)])
        let (otherSession, otherRadio) = try await fixture(knownRoles, allowTransmit: true)
        await otherRadio.setTransmitObservationKnown(false)
        do {
            _ = try await otherSession.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "ptt", "enabled": true,
            ])
            XCTFail("Transmit was allowed without interlock evidence")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_unavailable")
        }
        let otherCommands = await otherRadio.commandLog()
        XCTAssertEqual(otherCommands, [])
    }

    func testCWReleaseRejectsUnrelatedSnapshotWithoutFreshInterlock() async throws {
        let (session, radio) = try await fixture(allowTransmit: true)
        _ = try await session.handle("station_radio_control", params: [
            "provider": "direct_flex_lan", "control": "send_cw", "text": "CQ TEST",
        ])
        await radio.setObserveRelease(false)
        let releasing = Task {
            try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
        }
        for _ in 0..<50 {
            if await radio.commandLog().contains("ptt_off") { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        // A newer *opposite* interlock arrives before its snapshot callback.
        // Separate revision and cached bool reads would falsely prove RF OFF.
        await radio.simulateInterlock(true, publish: false)
        await radio.simulateUnrelatedSnapshot()
        do {
            _ = try await releasing.value
            XCTFail("Unrelated slice telemetry falsely confirmed CW release")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "release_unconfirmed")
        }
        await radio.setObserveRelease(true)
        _ = try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
    }

    func testReceiveSideWriteRequiresKnownIdleInterlock() async throws {
        let (session, radio) = try await fixture()
        await radio.setTransmitObservationKnown(false)
        do {
            _ = try await session.handle("station_tune", params: [
                "provider": "direct_flex_lan", "frequency_hz": 14_250_000, "mode": "USB",
            ])
            XCTFail("Tune wrote with no known interlock state")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_unavailable")
        }
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_mode", "mode": "USB",
            ])
            XCTFail("Mode wrote with no known interlock state")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_unavailable")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, [])
    }
}
#endif
