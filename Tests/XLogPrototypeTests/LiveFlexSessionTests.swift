#if os(macOS)
import Foundation
import XCTest
@testable import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class FlexFixtureBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: FakeFlexRadio?
    func store(_ value: FakeFlexRadio) { lock.withLock { stored = value } }
    func get() -> FakeFlexRadio? { lock.withLock { stored } }
}

actor FakeFlexRadio: FlexSessionRadio {
    private var value: RadioSnapshot
    private let onSnapshot: FlexRadioClient.SnapshotHandler
    private let onState: FlexRadioClient.StateHandler
    private var commands: [String] = []
    private var observeRelease = true
    private var observeTune = true
    private var observeTransmitStart = true
    private var transmitRevision: UInt64? = 1
    private var powerRevision: UInt64 = 0
    private var powerReadback: Int?
    private var rejectPower = false

    init(snapshot: RadioSnapshot, onState: @escaping FlexRadioClient.StateHandler,
         onSnapshot: @escaping FlexRadioClient.SnapshotHandler) {
        value = snapshot
        powerReadback = snapshot.rfPowerLevel
        if powerReadback != nil { powerRevision = 1 }
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
    func setObserveTransmitStart(_ value: Bool) { observeTransmitStart = value }
    func simulateState(_ state: RadioConnectionState) { onState(state, "fixture") }
    func simulateUnrelatedSnapshot() { onSnapshot(value) }
    func setPowerReadback(_ watts: Int?) { powerReadback = watts }
    func setRejectPower(_ reject: Bool) { rejectPower = reject }
    func simulatePowerStatus(_ watts: Int) {
        value.rfPowerLevel = watts
        powerRevision &+= 1
        onSnapshot(value)
    }
    func rfPowerObservation() -> FlexRadioClient.RFPowerObservation? {
        guard let level = value.rfPowerLevel, powerRevision > 0 else { return nil }
        return .init(revision: powerRevision, level: level, isConnected: value.isConnected)
    }
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
    func setPrimaryMode(_ mode: String) {
        commands.append("mode_a")
        value.vfos = value.vfos.map { vfo in
            var copy = vfo
            if copy.letter == "A" { copy.mode = mode }
            return copy
        }
        if value.slice == "A" { value.mode = mode }
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
        if enabled && !observeTransmitStart {return}
        if enabled || observeRelease {
            value.isTransmitting = enabled
            transmitRevision = (transmitRevision ?? 0) &+ 1
            onSnapshot(value)
        }
    }
    func setTransmit(_ mode: CATTransmitMode) {
        commands.append("tune_on")
        if !observeTransmitStart { return }
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
    func setRFPower(_ watts: Int) throws {
        commands.append("rf_power_\(watts)")
        if rejectPower { throw XCatError.server("Rejected") }
        if let powerReadback { simulatePowerStatus(powerReadback) }
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
    func testHeldNativeTuneCannotKeyAfterANewerCancelArrivesFirst() async throws {
        let(session,radio)=try await fixture(allowTransmit:true)
        let snapshot=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"])
        let generation=try XCTUnwrap(snapshot["generation"] as? UInt64)
        // Native admitted Tune #1, but its dispatch is held. Cancel #2 reaches
        // the backend first while this session has no transmit ownership.
        do{_=try await session.handle("station_action",params:["provider":"direct_flex_lan","action":"cancel","expected_generation":generation,"expected_native_intent":2]);XCTFail("Unowned Cancel accepted")}
        catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_action_blocked")}
        do{_=try await session.handle("station_action",params:["provider":"direct_flex_lan","action":"tune","expected_generation":generation,"expected_native_intent":1]);XCTFail("Held Tune keyed after newer Cancel")}
        catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_changed")}
        let commands=await radio.commandLog();XCTAssertTrue(commands.isEmpty,"No Tune/PTT key command may reach the fake radio")
        _=try await session.handle("station_disconnect",params:["provider":"direct_flex_lan"])
    }
    func testCarrierTuneUsesExactBackendGenerationAndFreshInterlockConfirmation() async throws {
        let(session,radio)=try await fixture(allowTransmit:true)
        let before=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"])
        let generation=try XCTUnwrap(before["generation"] as? UInt64)
        let result=try await session.handle("station_action",params:["provider":"direct_flex_lan","action":"tune","expected_generation":generation])
        XCTAssertEqual(result["confirmed"] as? Bool,true)
        XCTAssertEqual(result["action"] as? String,"tune")
        let active=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"])
        XCTAssertEqual((active["carrier_tune"] as? [String:Bool])?["release_required"],true)
        _=try await session.handle("station_action",params:["provider":"direct_flex_lan","action":"cancel","expected_generation":generation])
        let released=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"])
        XCTAssertEqual((released["carrier_tune"] as? [String:Bool])?["release_required"],false)
        let commands=await radio.commandLog();XCTAssertEqual(commands,["tune_on","ptt_off"])
        _=try await session.handle("station_disconnect",params:["provider":"direct_flex_lan"])
    }
    func testGUIPTTConfirmsFreshInterlockAndOffDoesNotReleaseCWOrUnrelatedTune() async throws {
        let(session,radio)=try await fixture(allowTransmit:true);let state=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"]);let generation=try XCTUnwrap(state["generation"] as? UInt64);let id=UUID().uuidString
        var params:[String:Any]=["provider":"direct_flex_lan","control":"ptt","source":"gui","ptt_owner_id":id,"enabled":true,"expected_generation":generation,"expected_native_intent":10]
        let on=try await session.handle("station_radio_control",params:params);XCTAssertEqual(on["confirmed"] as? Bool,true)
        params["enabled"]=false;params["expected_native_intent"]=11
        let off=try await session.handle("station_radio_control",params:params);XCTAssertEqual(off["confirmed"] as? Bool,true)
        let ptt=(off["state"] as? [String:Any])?["ptt"] as? [String:Any];XCTAssertEqual(ptt?["release_required"] as? Bool,false)
        var old=params;old["enabled"]=true;old["expected_native_intent"]=10
        do{_=try await session.handle("station_radio_control",params:old);XCTFail("Native ordering ignored")}catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_changed")}
        _=try await session.handle("station_radio_control",params:["provider":"direct_flex_lan","control":"send_cw","text":"TEST"])
        params["ptt_owner_id"]=UUID().uuidString;params["expected_native_intent"]=12
        let noop=try await session.handle("station_radio_control",params:params);XCTAssertEqual(noop["confirmed"] as? Bool,false)
        let commands=await radio.commandLog();XCTAssertEqual(commands,["ptt_on","ptt_off","cw_send"],"No GUI PTT off command may clear or release CW")
        _=try await session.handle("station_disconnect",params:["provider":"direct_flex_lan"])
    }
    func testGUIOffInterruptsPendingOnAndOlderOnCannotPublishLateSuccess() async throws {
        let(session,radio)=try await fixture(allowTransmit:true,timeout:.seconds(2));let state=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"]);let generation=try XCTUnwrap(state["generation"] as? UInt64);let id=UUID().uuidString
        await radio.setObserveTransmitStart(false)
        let params:[String:Any]=["provider":"direct_flex_lan","control":"ptt","source":"gui","ptt_owner_id":id,"enabled":true,"expected_generation":generation,"expected_native_intent":50]
        let pending=Task {do{_=try await session.handle("station_radio_control",params:params);return false}catch{return true}}
        for _ in 0..<100{if await radio.commandLog().contains("ptt_on"){break};try await Task.sleep(for:.milliseconds(5))}
        var off=params;off["enabled"]=false;off["expected_native_intent"]=51
        _=try await session.handle("station_radio_control",params:off)
        let retired=await pending.value;XCTAssertTrue(retired)
        let commands=await radio.commandLog();XCTAssertEqual(commands,["ptt_on","ptt_off"])
        await radio.simulateUnrelatedSnapshot()
        try await Task.sleep(for:.milliseconds(20))
        let cached=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"])
        XCTAssertEqual((cached["ptt"] as? [String:Any])?["release_required"] as? Bool,true,"RX observed while old On was pending must not retire its duty")
        XCTAssertEqual((cached["ptt"] as? [String:Any])?["confirmed"] as? Bool,false)
        await radio.simulateInterlock(false,publish:true)
        try await Task.sleep(for:.milliseconds(20))
        let fresh=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"])
        XCTAssertEqual((fresh["ptt"] as? [String:Any])?["release_required"] as? Bool,false)
        _=try await session.handle("station_disconnect",params:["provider":"direct_flex_lan"])
    }
    func testUnownedGUIOffNeverCancelsAnOwnedCarrierTune() async throws {
        let(session,radio)=try await fixture(allowTransmit:true)
        _=try await session.handle("station_action",params:["provider":"direct_flex_lan","action":"tune"])
        let state=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"]);let generation=try XCTUnwrap(state["generation"] as? UInt64)
        let reply=try await session.handle("station_radio_control",params:["provider":"direct_flex_lan","control":"ptt","source":"gui","ptt_owner_id":UUID().uuidString,"enabled":false,"expected_generation":generation,"expected_native_intent":70])
        XCTAssertEqual(reply["confirmed"] as? Bool,false)
        let after=try await session.handle("station_snapshot",params:["provider":"direct_flex_lan"])
        XCTAssertEqual((after["carrier_tune"] as? [String:Bool])?["release_required"],true)
        let commands=await radio.commandLog();XCTAssertEqual(commands,["tune_on"])
        _=try await session.handle("station_disconnect",params:["provider":"direct_flex_lan"])
    }
    func testCancelInterruptsOwnedTuneReadbackAndConfirmsOnlyFreshRelease() async throws {
        let (session, radio) = try await fixture(allowTransmit: true, timeout: .seconds(2))
        let snapshot = try await session.handle("station_snapshot", params: ["provider":"direct_flex_lan"])
        let generation = try XCTUnwrap(snapshot["generation"] as? UInt64)
        await radio.setObserveTransmitStart(false)
        let tuning = Task {
            do { _ = try await session.handle("station_action", params: ["provider":"direct_flex_lan", "action":"tune"]); return false }
            catch { return true }
        }
        for _ in 0..<100 {
            if await radio.commandLog().contains("tune_on") { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let result = try await session.handle("station_action", params: ["provider":"direct_flex_lan", "action":"cancel", "expected_generation":generation])
        XCTAssertEqual(result["confirmed"] as? Bool, true)
        let retired = await tuning.value
        XCTAssertTrue(retired, "Interrupted tune must not publish late success")
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["tune_on", "ptt_off"])
        _ = try await session.handle("station_disconnect", params: ["provider":"direct_flex_lan"])
    }
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

    func testCWGenerationFenceRejectsStaleSendAndStopBeforeDeviceWrite() async throws {
        let (session, radio) = try await fixture(allowTransmit: true)
        let snapshot = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
        let generation = try XCTUnwrap(snapshot["generation"] as? UInt64)
        for expected in [generation + 1, -1, "1", true, 1.5, NSNull()] as [Any] {
            for control in ["send_cw", "clear_cw"] {
                do {
                    _ = try await session.handle("station_radio_control", params: [
                        "provider": "direct_flex_lan", "control": control, "text": "CQ",
                        "expected_generation": expected,
                    ])
                    XCTFail("Stale or malformed CW generation was accepted")
                } catch let failure as WorkerFailure {
                    XCTAssertEqual(failure.code, "station_changed")
                }
            }
        }
        let before = await radio.commandLog()
        XCTAssertTrue(before.isEmpty)
        _ = try await session.handle("station_radio_control", params: [
            "provider": "direct_flex_lan", "control": "send_cw", "text": "CQ",
            "expected_generation": generation,
        ])
        _ = try await session.handle("station_radio_control", params: [
            "provider": "direct_flex_lan", "control": "clear_cw", "expected_generation": generation,
        ])
        let after = await radio.commandLog()
        XCTAssertEqual(after, ["cw_send", "cw_clear"])
        _ = try await session.handle("station_disconnect", params: ["provider": "direct_flex_lan"])
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

    func testReceiveModeTargetsObservedVFOAAndRequiresFreshReadback() async throws {
        let initial = RadioSnapshot(frequencyHz: 14_074_000, mode: "USB", slice: "A",
            transmitSlice: "B", transmitFrequencyHz: 14_080_000,
            vfos: [RadioVFO(letter: "A", frequencyHz: 14_074_000, mode: "USB", isReceive: true),
                   RadioVFO(letter: "B", frequencyHz: 14_080_000, mode: "LSB", isTransmit: true)])
        let (session, radio) = try await fixture(initial)
        let snapshot = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
        let generation = try XCTUnwrap(snapshot["generation"] as? UInt64)
        let result = try await session.handle("station_radio_control", params: [
            "provider": "direct_flex_lan", "control": "set_mode_a", "mode": "DIGU",
            "expected_generation": generation,
        ])
        XCTAssertEqual(result["confirmed"] as? Bool, true)
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["mode_a"])
        let state = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
        let observed = try XCTUnwrap(state["radio"] as? [String: Any])
        let vfos = try XCTUnwrap(observed["vfos"] as? [[String: Any]])
        XCTAssertEqual(vfos.first(where: { $0["letter"] as? String == "A" })?["mode"] as? String, "DIGU")
        XCTAssertEqual(vfos.first(where: { $0["letter"] as? String == "B" })?["mode"] as? String, "LSB")
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

    func testRFPowerRequiresFreshMatchingStatusNotJustACKOrUnrelatedSnapshot() async throws {
        let (session, radio) = try await fixture()
        await radio.simulateUnrelatedSnapshot()
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_rf_power", "watts": 50,
            ])
            XCTFail("ACK-only RF-power command was confirmed")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_timeout")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["rf_power_50"])
        let state = try await session.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
        let capabilities = try XCTUnwrap(state["capabilities"] as? [String: Any])
        XCTAssertFalse((capabilities["supported_commands"] as? [String] ?? []).contains("set_rf_power"))
    }

    func testRFPowerFreshStatusConfirmsBoundaryValuesAndCapability() async throws {
        let (session, radio) = try await fixture()
        for watts in [0, 100] {
            await radio.setPowerReadback(watts)
            let result = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_rf_power", "watts": watts,
            ])
            XCTAssertEqual(result["confirmed"] as? Bool, true)
            let state = try XCTUnwrap(result["state"] as? [String: Any])
            XCTAssertEqual((state["radio"] as? [String: Any])?["rf_power_level"] as? Int, watts)
            let capabilities = try XCTUnwrap(state["capabilities"] as? [String: Any])
            XCTAssertTrue((capabilities["supported_commands"] as? [String] ?? []).contains("set_rf_power"))
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, ["rf_power_0", "rf_power_100"])
    }

    func testRFPowerRejectsInvalidValuesBeforeWrite() async throws {
        let (session, radio) = try await fixture()
        for watts in [-1 as Any, 101, 3.5, true] {
            do {
                _ = try await session.handle("station_radio_control", params: [
                    "provider": "direct_flex_lan", "control": "set_rf_power", "watts": watts,
                ])
                XCTFail("Invalid RF power was accepted")
            } catch let failure as WorkerFailure {
                XCTAssertEqual(failure.code, "invalid_params")
            }
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, [])
    }

    func testRFPowerMatchingStaleReadbackOrFreshMismatchDoesNotConfirm() async throws {
        var initial = RadioSnapshot(frequencyHz: 14_074_000)
        initial.rfPowerLevel = 50
        let (session, radio) = try await fixture(initial)
        await radio.setPowerReadback(nil)
        let unrelated = Task {
            try await Task.sleep(for: .milliseconds(30))
            await radio.simulateUnrelatedSnapshot()
        }
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_rf_power", "watts": 50,
            ])
            XCTFail("Stale matching power and unrelated telemetry confirmed the command")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_timeout")
        }
        _ = try? await unrelated.value
        await radio.setPowerReadback(49)
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_rf_power", "watts": 50,
            ])
            XCTFail("Mismatched fresh power status confirmed the command")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_timeout")
        }
    }

    func testRFPowerCommandRejectionCannotConfirmCachedValue() async throws {
        let (session, radio) = try await fixture()
        await radio.setRejectPower(true)
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_rf_power", "watts": 50,
            ])
            XCTFail("Rejected RF power control was confirmed")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_rejected")
        }
    }

    func testRFPowerStatusParserAcceptsOnlyBoundedTransmitField() {
        XCTAssertEqual(FlexRFPowerStatusParser.parse("S0|transmit rfpower=0"), 0)
        XCTAssertEqual(FlexRFPowerStatusParser.parse("SABCD|transmit mic=30 rfpower=100 vox=0"), 100)
        for line in ["R1|0|", "S0|slice rfpower=50", "S0|transmit mic=50",
                     "S0|transmit rfpower=101", "S0|transmit rfpower=-1",
                     "S0|transmit rfpower=50.5", "S0|transmit rfpower=999999999999999999999",
                     "S0|transmit rfpower=50 rfpower=51"] {
            XCTAssertNil(FlexRFPowerStatusParser.parse(line), line)
        }
    }

    func testRFPowerCommandResponseIsOnlyACKEvidence() {
        XCTAssertEqual(FlexCommandResponseParser.parse("R41|0|")?.code, 0)
        XCTAssertEqual(FlexCommandResponseParser.parse("R41|50000033|Parameter out of range")?.code,
                       0x50000033)
        XCTAssertNil(FlexRFPowerStatusParser.parse("R41|0|"))
    }

    func testRFPowerWriteRequiresObservedIdleInterlock() async throws {
        let (session, radio) = try await fixture()
        await radio.setTransmitObservationKnown(false)
        do {
            _ = try await session.handle("station_radio_control", params: [
                "provider": "direct_flex_lan", "control": "set_rf_power", "watts": 50,
            ])
            XCTFail("RF power changed without authoritative idle interlock")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_unavailable")
        }
        let commands = await radio.commandLog()
        XCTAssertEqual(commands, [])
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
