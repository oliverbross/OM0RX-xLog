import Foundation
import XCTest
#if os(macOS)
import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class LiveTCISessionTests: XCTestCase {
    func testFlexAndTCIReceiveSlotsStayIndependentAndTCIDisconnectDoesNotReleaseFlex() async throws {
        let box = FlexFixtureBox()
        let flex = LiveFlexSession(readbackTimeout: .milliseconds(250)) { _, onState, onSnapshot in
            let radio = FakeFlexRadio(snapshot: RadioSnapshot(frequencyHz: 14_074_000), onState: onState, onSnapshot: onSnapshot)
            box.store(radio); return radio
        }
        let socket = TCIFixtureSocket(), tci = fixture(TCIFixtureConnector([socket]))
        _ = try await flex.handle("station_connect", params: ["provider":"direct_flex_lan", "host":"192.168.1.20", "station_name":"xLog", "allow_transmit":false])
        _ = try await tci.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "trx:0,false;ready;"))
        let tciReady = try await wait(tci) { $0["available"] as? Bool == true }
        XCTAssertEqual(tciReady["allow_transmit"] as? Bool, false)
        var flexReady: [String:Any] = [:]
        for _ in 0..<100 {
            flexReady = try await flex.handle("station_snapshot", params:["provider":"direct_flex_lan"])
            if flexReady["available"] as? Bool == true { break }
            await Task.yield()
        }
        XCTAssertEqual(flexReady["available"] as? Bool, true)
        XCTAssertEqual((flexReady["radio"] as? [String:Any])?["frequency_hz"] as? Int64, 14_074_000)
        _ = try await tci.handle("station_disconnect", params:minimal)
        let after = try await flex.handle("station_snapshot", params:["provider":"direct_flex_lan"])
        XCTAssertEqual(after["available"] as? Bool, true)
        let radio = try XCTUnwrap(box.get()), commands = await radio.commandLog()
        XCTAssertTrue(commands.isEmpty, "The other slot's disconnect wrote to FLEX: \(commands)")
        let sent = await socket.sentTexts(); XCTAssertTrue(sent.isEmpty)
        _ = try await flex.handle("station_disconnect", params:["provider":"direct_flex_lan"])
        let released = await radio.commandLog(); XCTAssertEqual(released, ["stop_transport"])
        await tci.terminate()
    }
    private let minimal: [String: Any] = ["provider": "direct_tci"]
    private let connect: [String: Any] = ["provider": "direct_tci", "endpoint": "ws://127.0.0.1:40001", "trx": 0, "channel": 0]

    func testSplitReceiptIsIndependentTRXScopedAndClearedAcrossConnections() async throws {
        let socket = TCIFixtureSocket(), nextSocket = TCIFixtureSocket(), time = TCIClock()
        let session = fixture(TCIFixtureConnector([socket, nextSocket]), clock: { time.now() })
        let selected = connect.merging(["channel": 1]) { _, value in value }
        _ = try await session.handle("station_connect", params: selected)
        await socket.enqueue(.text(Self.discovery + "vfo:0,1,7100000;split_enable:0,true;ready;"))
        var state = try await wait(session) { $0["available"] as? Bool == true }
        let stamp = try XCTUnwrap((state["tci"] as? [String: Any])?["split_observed_at"] as? Double)
        XCTAssertEqual((state["tci"] as? [String: Any])?["channel"] as? Int, 1)
        XCTAssertEqual((state["radio"] as? [String: Any])?["split"] as? Bool, true)
        time.advance(10)
        await socket.enqueue(.text("split_enable:1,false;split_enable:0,invalid;vfo:0,1,7200000;"))
        state = try await wait(session) { ($0["radio"] as? [String: Any])?["frequency_hz"] as? Int64 == 7_200_000 }
        XCTAssertEqual((state["tci"] as? [String: Any])?["split_observed_at"] as? Double, stamp)
        XCTAssertEqual((state["radio"] as? [String: Any])?["split"] as? Bool, true)
        XCTAssertEqual((state["station"] as? [String: Any])?["radio_stale"] as? Bool, false)
        XCTAssertTrue((state["radio"] as? [String: Any])?["transmit_vfo"] is NSNull)
        XCTAssertTrue((state["radio"] as? [String: Any])?["transmit_frequency_hz"] is NSNull)
        await socket.enqueue(.text("split_enable:0,true;"))
        state = try await wait(session) { ($0["tci"] as? [String: Any])?["split_observed_at"] as? Double == time.now().timeIntervalSince1970 }
        let sent = await socket.sentTexts(); XCTAssertTrue(sent.isEmpty)
        _ = try await session.handle("station_disconnect", params: minimal)
        _ = try await session.handle("station_connect", params: selected)
        await nextSocket.enqueue(.text(Self.discovery + "vfo:0,1,7300000;ready;"))
        state = try await wait(session) { $0["available"] as? Bool == true }
        XCTAssertTrue((state["radio"] as? [String: Any])?["split"] is NSNull)
        XCTAssertTrue((state["tci"] as? [String: Any])?["split_observed_at"] is NSNull)
        await session.terminate()
    }

    func testSnapshotSaveAndDeniedMethodsNeverConnect() async throws {
        let connector = TCIFixtureConnector([]), session = fixture(connector)
        let initial = try await session.handle("station_snapshot", params: minimal)
        XCTAssertEqual(initial["available"] as? Bool, false)
        XCTAssertTrue(initial["generated_at"] is NSNull)
        for method in ["station_configuration_save", "station_reconnect", "station_action", "station_cat_servers"] {
            do { _ = try await session.handle(method, params: minimal); XCTFail("Read-only adapter admitted \(method)") }
            catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "method_not_allowed") }
        }
        do { _ = try await session.handle("station_tune", params: minimal); XCTFail("Incomplete TCI tune admitted") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        for change in [["trx": true], ["channel": 16], ["endpoint": "ws://user:secret@localhost:40001"], ["endpoint": "ws://localhost:40001/?token=secret"], ["endpoint": "http://localhost:40001"], ["allow_transmit": "yes"]] as [[String: Any]] {
            do { _ = try await session.handle("station_connect", params: connect.merging(change) { _, new in new }); XCTFail("Invalid TCI config admitted") }
            catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        }
        let calls = await connector.count(); XCTAssertEqual(calls, 0)
        await session.terminate()
    }

    func testWorkerRouterRecognizesTCIWithoutFallingThroughToAgentOrLoopback() async throws {
        let routed = minimal.merging(["radio_id": "radio1"]) { _, value in value }
        let snapshot = try await LiveStationMethods.handle("station_snapshot", params: routed)
        XCTAssertEqual(snapshot["source"] as? String, "direct_tci")
        XCTAssertEqual(snapshot["allow_transmit"] as? Bool, false)
        XCTAssertEqual(snapshot["radio_id"] as? String, "radio1")
        for method in ["station_reconnect", "station_action", "station_configuration_save", "station_cat_servers"] {
            do { _ = try await LiveStationMethods.handle(method, params: routed); XCTFail("Router admitted TCI mutation") }
            catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "method_not_allowed") }
        }
        do { _ = try await LiveStationMethods.handle("station_tune", params: routed); XCTFail("Incomplete TCI tune admitted") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        do { _ = try await LiveStationMethods.handle("station_transmit_permission", params:routed); XCTFail("Incomplete TCI permission route admitted") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code,"invalid_params") }
    }

    func testExplicitTuneUsesSavedAddressAndReturnsOnlyAfterAuthoritativeReadback() async throws {
        let socket = TCIFixtureSocket(), time = TCIClock()
        let session = fixture(TCIFixtureConnector([socket]), clock: { time.now() })
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "trx:0,false;ready;"))
        let ready = try await wait(session) { $0["available"] as? Bool == true }
        XCTAssertEqual((ready["capabilities"] as? [String: Any])?["supported_commands"] as? [String],
                       ["station_tune", "station_add_spot", "station_remove_spot"])
        XCTAssertEqual((ready["tci"] as? [String: Any])?["read_only"] as? Bool, false)
        XCTAssertEqual((ready["tci"] as? [String: Any])?["receive_control_only"] as? Bool, true)
        let tune: [String: Any] = ["provider": "direct_tci", "frequency_hz": 7_100_000,
                                   "mode": "SSB", "expected_generation": 1]
        let pending = Task { try await session.handle("station_tune", params: tune) }
        for _ in 0..<2_000 {
            if await socket.sentTexts().count == 1 { break }
            await Task.yield()
        }
        let sent = await socket.sentTexts()
        XCTAssertEqual(sent, ["VFO:0,0,7100000;MODULATION:0,LSB;"])
        time.advance(1)
        await socket.enqueue(.text("vfo:0,0,7100000;modulation:0,LSB;"))
        let result = try await pending.value
        XCTAssertEqual(result["accepted"] as? Bool, true)
        XCTAssertEqual(result["confirmed"] as? Bool, true)
        let state = try XCTUnwrap(result["state"] as? [String: Any])
        XCTAssertEqual((state["radio"] as? [String: Any])?["frequency_hz"] as? Int64, 7_100_000)
        XCTAssertEqual((state["radio"] as? [String: Any])?["mode"] as? String, "LSB")
        await session.terminate()
    }

    func testTuneRejectsStaleGenerationAndUnknownTransmitStateWithoutWriting() async throws {
        let socket = TCIFixtureSocket(), session = fixture(TCIFixtureConnector([socket]))
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "ready;"))
        _ = try await wait(session) { $0["available"] as? Bool == true }
        for expected in [0, 1] {
            let tune: [String: Any] = ["provider": "direct_tci", "frequency_hz": 7_100_000,
                                       "mode": "USB", "expected_generation": expected]
            do { _ = try await session.handle("station_tune", params: tune); XCTFail("Unsafe TCI tune admitted") }
            catch let failure as WorkerFailure {
                XCTAssertEqual(failure.code, expected == 0 ? "invalid_params" : "station_action_blocked")
            }
        }
        let sent = await socket.sentTexts()
        XCTAssertTrue(sent.isEmpty)
        await session.terminate()
    }

    func testExplicitSpotOutputUsesOfficialTCIFrameWithoutClaimingDisplayReadback() async throws {
        let socket = TCIFixtureSocket(), session = fixture(TCIFixtureConnector([socket]))
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "trx:0,false;ready;"))
        let ready = try await wait(session) { $0["available"] as? Bool == true }
        XCTAssertTrue(((ready["capabilities"] as? [String: Any])?["supported_commands"] as? [String] ?? []).contains("station_add_spot"))
        let spot: [String: Any] = ["frequency_hz": 144_300_000, "callsign": "OM0RX", "mode": "CW",
                                   "source": "xLog xCluster", "spotter": "DL1ABC", "comment": "CQ, DX",
                                   "timestamp": Int(Date().timeIntervalSince1970), "lifetime_seconds": 900,
                                   "priority": 3, "color_hex": "#00FF00"]
        let result = try await session.handle("station_add_spot", params: ["provider": "direct_tci", "spot": spot])
        XCTAssertEqual(result["accepted"] as? Bool, true)
        XCTAssertEqual(result["confirmed"] as? Bool, false)
        let sent = await socket.sentTexts()
        XCTAssertEqual(sent, ["SPOT:OM0RX,CW,144300000,4278255360,xLog xCluster DL1ABC CQ  DX;"])
        let removed = try await session.handle("station_remove_spot", params: [
            "provider": "direct_tci", "callsign": "OM0RX", "frequency_hz": 144_300_000])
        XCTAssertEqual(removed["accepted"] as? Bool, true)
        XCTAssertEqual(removed["confirmed"] as? Bool, false)
        let sentAfterRemoval = await socket.sentTexts()
        XCTAssertEqual(sentAfterRemoval, [
            "SPOT:OM0RX,CW,144300000,4278255360,xLog xCluster DL1ABC CQ  DX;",
            "SPOT_DELETE:OM0RX;",
        ])
        var outside = spot; outside["frequency_hz"] = 1_000_000_001
        do {
            _ = try await session.handle("station_add_spot", params: ["provider": "direct_tci", "spot": outside])
            XCTFail("Out-of-capability TCI spot admitted")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        let sentAfterRejectedSpot = await socket.sentTexts()
        XCTAssertEqual(sentAfterRejectedSpot.count, 2)
        await session.terminate()
    }

    func testExplicitConnectRequiresDiscoveryAndReadyAndPollDoesNotRefreshReceiptTime() async throws {
        let socket = TCIFixtureSocket(), connector = TCIFixtureConnector([socket]), time = TCIClock()
        let session = fixture(connector, clock: { time.now() })
        let pending = try await session.handle("station_connect", params: connect)
        XCTAssertEqual(pending["available"] as? Bool, false)
        await socket.enqueue(.text(Self.discovery))
        for _ in 0..<30 { await Task.yield() }
        let beforeReady = try await session.handle("station_snapshot", params: minimal)
        XCTAssertTrue(beforeReady["radio"] is NSNull)
        await socket.enqueue(.text("ready;"))
        let ready = try await wait(session) { $0["available"] as? Bool == true }
        let radio = try XCTUnwrap(ready["radio"] as? [String: Any])
        XCTAssertEqual(radio["frequency_hz"] as? Int64, 14_025_000)
        XCTAssertTrue(radio["transmitting"] is NSNull)
        XCTAssertTrue(radio["split"] is NSNull)
        XCTAssertTrue(radio["transmit_frequency_hz"] is NSNull)
        XCTAssertEqual(ready["allow_transmit"] as? Bool, false)
        XCTAssertEqual((ready["capabilities"] as? [String: Any])?["supported_commands"] as? [String],
                       ["station_tune", "station_add_spot", "station_remove_spot"])
        XCTAssertEqual((ready["station"] as? [String: Any])?["allowed_actions"] as? [String], [])
        let stamp = ready["generated_at"] as? Double
        time.advance(10)
        let unchanged = try await session.handle("station_snapshot", params: minimal)
        XCTAssertEqual(unchanged["generated_at"] as? Double, stamp)
        XCTAssertEqual((unchanged["radio"] as? [String: Any])?["observed_at"] as? Double, stamp)
        XCTAssertEqual((unchanged["station"] as? [String: Any])?["radio_stale"] as? Bool, true)
        await socket.enqueue(.text("vfo:0,0,14026000;trx:0,false;"))
        let next = try await wait(session) { ($0["radio"] as? [String: Any])?["frequency_hz"] as? Int64 == 14_026_000 }
        XCTAssertEqual(next["generated_at"] as? Double, time.now().timeIntervalSince1970)
        let calls = await connector.count(); XCTAssertEqual(calls, 1)
        do { _ = try await session.handle("station_connect", params: connect); XCTFail("Duplicate connect accepted") } catch {}
        let afterDuplicate = await connector.count(); XCTAssertEqual(afterDuplicate, 1)
        await session.terminate()
    }

    func testNewWrapperGenerationRejectsLateOldConnectionUpdates() async throws {
        let old = TCIFixtureSocket(resumeOnClose: false), current = TCIFixtureSocket()
        let session = fixture(TCIFixtureConnector([old, current]))
        _ = try await session.handle("station_connect", params: connect)
        await old.enqueue(.text(Self.discovery + "ready;"))
        let first = try await wait(session) { $0["available"] as? Bool == true }
        _ = try await session.handle("station_disconnect", params: minimal)
        _ = try await session.handle("station_connect", params: connect)
        await current.enqueue(.text(Self.discovery + "vfo:0,0,7100000;ready;"))
        let second = try await wait(session) { $0["available"] as? Bool == true }
        XCTAssertGreaterThan(try XCTUnwrap(second["generation"] as? UInt64), try XCTUnwrap(first["generation"] as? UInt64))
        await old.enqueue(.text("vfo:0,0,9999999;split_enable:0,true;"))
        for _ in 0..<30 { await Task.yield() }
        let after = try await session.handle("station_snapshot", params: minimal)
        XCTAssertEqual((after["radio"] as? [String: Any])?["frequency_hz"] as? Int64, 7_100_000)
        XCTAssertTrue((after["radio"] as? [String: Any])?["split"] is NSNull)
        XCTAssertTrue((after["tci"] as? [String: Any])?["split_observed_at"] is NSNull)
        await session.terminate()
    }

    func testOnlyValidConfiguredOrGlobalEvidenceRefreshesRadioTimestamp() async throws {
        let socket = TCIFixtureSocket(), time = TCIClock()
        let session = fixture(TCIFixtureConnector([socket]), clock: { time.now() })
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "ready;"))
        var latest = try await wait(session) { $0["available"] as? Bool == true }
        let originalStamp = try XCTUnwrap(latest["generated_at"] as? Double)
        time.advance(10)
        for text in ["extension:x;", "vfo:1,0,7100000;modulation:1,USB;", "vfo:0,1,7100000;",
                     "vfo:0,0,not_a_number;", "vfo:0,0,999999999;", "modulation:0,UNKNOWN;",
                     "trx:0,not_a_boolean;", "receive_only:invalid;", "vfo:0,0,12:34;"] {
            let previousSequence = try XCTUnwrap((latest["tci"] as? [String: Any])?["observation_sequence"] as? UInt64)
            await socket.enqueue(.text(text))
            latest = try await wait(session) {
                (($0["tci"] as? [String: Any])?["observation_sequence"] as? UInt64 ?? 0) > previousSequence
            }
            XCTAssertEqual(latest["generated_at"] as? Double, originalStamp, text)
            XCTAssertEqual((latest["radio"] as? [String: Any])?["observed_at"] as? Double, originalStamp, text)
            XCTAssertEqual((latest["station"] as? [String: Any])?["radio_stale"] as? Bool, true, text)
        }
        // Repeating a valid value is fresh evidence, not merely a state change.
        for text in ["vfo:0,0,14025000;", "device:SunSDR2PRO;"] {
            time.advance(10)
            let stamp = time.now().timeIntervalSince1970
            await socket.enqueue(.text(text))
            latest = try await wait(session) { $0["generated_at"] as? Double == stamp }
            XCTAssertEqual((latest["station"] as? [String: Any])?["radio_stale"] as? Bool, false)
        }
        await session.terminate()
    }

    func testAdapterPreservesProducerTimeInsteadOfRestampingDelivery() async throws {
        let socket = TCIFixtureSocket(), connector = TCIFixtureConnector([socket])
        let producerTime = TCIClock(), consumerTime = TCIClock()
        consumerTime.advance(20)
        let session = LiveTCISession(claim: StationProviderClaim(), clock: { consumerTime.now() }, factory: {
            TCIReadOnlyWebSocketSession(endpoint: $0.endpoint, configuredAddress: $0.address,
                                        connector: connector, clock: { producerTime.now() })
        })
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "ready;"))
        let ready = try await wait(session) { $0["available"] as? Bool == true }
        XCTAssertEqual(ready["generated_at"] as? Double, producerTime.now().timeIntervalSince1970)
        XCTAssertEqual((ready["radio"] as? [String: Any])?["received_at"] as? Double, producerTime.now().timeIntervalSince1970)
        XCTAssertEqual((ready["station"] as? [String: Any])?["radio_stale"] as? Bool, true)
        await session.terminate()
    }

    func testProviderClaimExcludesBothDirectionsAndReleaseIsLeaseScoped() async throws {
        let claim = StationProviderClaim(), socket = TCIFixtureSocket(), connector = TCIFixtureConnector([socket])
        let session = fixture(connector, claim: claim)
        try await claim.reserve("direct_agent")
        do { _ = try await session.handle("station_connect", params: connect); XCTFail("TCI displaced Agent") } catch {}
        let none = await connector.count(); XCTAssertEqual(none, 0)
        await claim.release("direct_agent")
        _ = try await session.handle("station_connect", params: connect)
        for provider in ["direct_agent", "direct_flex_lan"] {
            do { try await claim.reserve(provider); XCTFail("Another provider displaced TCI") } catch {}
        }
        await claim.release("direct_tci", lease: UUID())
        do { try await claim.reserve("direct_agent"); XCTFail("Stale release retired TCI claim") } catch {}
        _ = try await session.handle("station_disconnect", params: minimal)
        try await claim.reserve("direct_flex_lan"); await claim.release("direct_flex_lan")
        await session.terminate()
    }

    func testShutdownRetiresPendingConnectAndClosesLateConnection() async throws {
        let connector = TCIHeldConnector(), claim = StationProviderClaim()
        let session = LiveTCISession(claim: claim, factory: { TCIReadOnlyWebSocketSession(endpoint: $0.endpoint, configuredAddress: $0.address, connector: connector) })
        let params = connect
        let pending = Task { do { _ = try await session.handle("station_connect", params: params); return false } catch { return true } }
        for _ in 0..<2000 { if await connector.started { break }; await Task.yield() }
        let started = await connector.started; XCTAssertTrue(started)
        await session.terminate()
        let late = TCIFixtureSocket(); await connector.complete(late)
        let rejected = await pending.value; XCTAssertTrue(rejected)
        let closed = await late.closeCount(); XCTAssertEqual(closed, 1)
        let after = try await session.handle("station_snapshot", params: minimal)
        XCTAssertEqual(after["available"] as? Bool, false)
        do { _ = try await session.handle("station_connect", params: connect); XCTFail("Terminal session reconnected") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "worker_stopping") }
        try await claim.reserve("direct_agent"); await claim.release("direct_agent")
    }

    func testTransportFailureNeverReconnectsOrReplays() async throws {
        let socket = TCIFixtureSocket(), connector = TCIFixtureConnector([socket]), session = fixture(connector)
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "ready;"))
        _ = try await wait(session) { $0["available"] as? Bool == true }
        await socket.fail()
        let failed = try await wait(session) { ($0["tci"] as? [String: Any])?["failure"] as? String == "transport_closed" }
        XCTAssertEqual(failed["available"] as? Bool, false)
        for _ in 0..<10 { _ = try await session.handle("station_snapshot", params: minimal) }
        let calls = await connector.count(); XCTAssertEqual(calls, 1)
        await session.terminate()
    }

    func testFilterBridgeRejectsMalformedTargetsAndConfirmsOnlyExactSavedTRXReadback() async throws {
        let socket = TCIFixtureSocket(), time = TCIClock()
        let session = fixture(TCIFixtureConnector([socket]), clock: { time.now() })
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "rx_filter_band:0,-500,500;trx:0,false;ready;"))
        _ = try await wait(session) { $0["available"] as? Bool == true }
        let params: [String: Any] = ["provider": "direct_tci", "expected_generation": 1, "lower_hz": 30, "upper_hz": 2700]
        for change in [["lower_hz": true], ["lower_hz": 30.5], ["lower_hz": "30"], ["upper_hz": 24001], ["upper_hz": 30],
                       ["expected_generation": 0], ["trx": 1], ["channel": 1], ["allow_transmit": false]] as [[String: Any]] {
            do { _ = try await session.handle("station_receive_filter", params: params.merging(change) { _, new in new }); XCTFail("Malformed filter target admitted") }
            catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        }
        let none = await socket.sentTexts(); XCTAssertTrue(none.isEmpty)
        let pending = Task { try await session.handle("station_receive_filter", params: params) }
        for _ in 0..<2000 { if await socket.sentTexts().count == 1 { break }; await Task.yield() }
        let sent = await socket.sentTexts(); XCTAssertEqual(sent, ["RX_FILTER_BAND:0,30,2700;RX_FILTER_BAND:0;"])
        time.advance(1); await socket.enqueue(.text("rx_filter_band:0,30,2700;"))
        let result = try await pending.value, state = try XCTUnwrap(result["state"] as? [String: Any])
        XCTAssertEqual(result["confirmed"] as? Bool, true)
        XCTAssertEqual((state["tci"] as? [String: Any])?["filter_lower_hz"] as? Int64, 30)
        XCTAssertEqual((state["tci"] as? [String: Any])?["filter_scope"] as? String, "trx")
        await session.terminate()
    }

    private func fixture(_ connector: TCIFixtureConnector, claim: StationProviderClaim = StationProviderClaim(), clock: @escaping @Sendable () -> Date = { Date() }) -> LiveTCISession {
        LiveTCISession(claim: claim, clock: clock, factory: { TCIReadOnlyWebSocketSession(endpoint: $0.endpoint, configuredAddress: $0.address, connector: connector, clock: clock) })
    }
    func testTCI21CWPermissionSingleSessionSendStopAndReportedSpeed() async throws {
        let socket=TCIFixtureSocket(),session=fixture(TCIFixtureConnector([socket]))
        _=try await session.handle("station_connect",params:connect.merging(["allow_transmit":true]){_,new in new})
        let discovery=Self.discovery.replacingOccurrences(of:"1.8",with:"2.1").replacingOccurrences(of:"trx_count:2",with:"trx_count:1")
        await socket.enqueue(.text(discovery+"tx_enable:0,true;trx:0,false;ready;"))
        let ready=try await wait(session){$0["available"] as? Bool==true}
        XCTAssertEqual(ready["allow_transmit"] as? Bool,true)
        XCTAssertTrue(((ready["capabilities"] as? [String:Any])?["supported_commands"] as? [String] ?? []).contains("send_cw"))
        let initialWrites=await socket.sentTexts();XCTAssertTrue(initialWrites.isEmpty,"Connect must never key or set speed")
        _=try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"set_cw_speed","words_per_minute":24,"expected_generation":1])
        await socket.enqueue(.text("cw_macros_speed:24;"))
        _=try await wait(session){($0["tci"] as? [String:Any])?["cw_macros_speed"] as? Int==24}
        let result=try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"send_cw","text":"TU OM0RX, 599","expected_generation":1])
        XCTAssertEqual(result["accepted"] as? Bool,true);XCTAssertEqual(result["confirmed"] as? Bool,false)
        do{_=try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"send_cw","text":"TU","expected_generation":1]);XCTFail("Second output overtook owned CW")}catch{}
        let stopping=Task{try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"clear_cw","expected_generation":1])}
        for _ in 0..<2000 {if await socket.sentTexts().count==3{break};await Task.yield()}
        let frames=await socket.sentTexts();XCTAssertEqual(frames,["CW_MACROS_SPEED:24;CW_MACROS_SPEED;","CW_MACROS:0,TU OM0RX~ 599;","CW_MACROS_STOP;TRX:0;"])
        await socket.enqueue(.text("tx_frequency:7100000;cw_macros_empty:0;"))
        let retained=try await session.handle("station_snapshot",params:minimal)
        XCTAssertEqual((retained["tci"] as? [String:Any])?["cw_owned"] as? Bool,true)
        await socket.enqueue(.text("trx:0,false;"));_=try await stopping.value
        let idle=try await session.handle("station_snapshot",params:minimal)
        XCTAssertEqual((idle["tci"] as? [String:Any])?["cw_owned"] as? Bool,false)
        await session.terminate()
    }
    func testTCI21AddressedPTTDoesNotInventGlobalTXFrequencyOrUseOtherTRXReadback() async throws {
        let socket=TCIFixtureSocket(),session=fixture(TCIFixtureConnector([socket]))
        _=try await session.handle("station_connect",params:connect.merging(["trx":1,"channel":1,"allow_transmit":true]){_,new in new})
        await socket.enqueue(.text(Self.discovery.replacingOccurrences(of:"1.8",with:"2.1")+"vfo:1,1,7100000;modulation:1,USB;tx_enable:1,true;trx:1,false;tx_frequency:14250000;ready;"))
        let ready=try await wait(session){$0["available"] as? Bool==true}
        XCTAssertTrue((ready["radio"] as? [String:Any])?["transmit_frequency_hz"] is NSNull)
        XCTAssertTrue((ready["radio"] as? [String:Any])?["transmit_vfo"] is NSNull)
        XCTAssertFalse(((ready["capabilities"] as? [String:Any])?["supported_commands"] as? [String] ?? []).contains("send_cw"),"Global CW Stop is not qualified for multi-TRX")
        let owner=UUID().uuidString
        let params:[String:Any]=["provider":"direct_tci","control":"ptt","enabled":true,"source":"gui","ptt_owner_id":owner,"expected_generation":1,"expected_native_intent":3]
        let on=Task{try await session.handle("station_radio_control",params:params)}
        for _ in 0..<2000{if await socket.sentTexts().count==1{break};await Task.yield()}
        await socket.enqueue(.text("trx:0,true;tx_frequency:7100000;"))
        await socket.enqueue(.text("trx:1,true;"))
        let confirmed=try await on.value;XCTAssertEqual(confirmed["confirmed"] as? Bool,true);XCTAssertEqual(confirmed["owner_id"] as? String,owner)
        XCTAssertEqual(confirmed["accepted"] as? Bool,true);XCTAssertEqual(confirmed["control"] as? String,"ptt","Native durable receipt requires the actual PTT response contract")
        let disabled=try await session.handle("station_transmit_permission",params:["provider":"direct_tci","allow_transmit":false,"expected_generation":1])
        XCTAssertEqual((disabled["state"] as? [String:Any])?["allow_transmit"] as? Bool,false)
        do{_=try await session.handle("station_transmit_permission",params:["provider":"direct_tci","allow_transmit":true,"expected_generation":1]);XCTFail("Runtime command re-enabled output")}catch{}
        let off=Task{try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"ptt","enabled":false,"source":"gui","ptt_owner_id":owner,"expected_generation":1,"expected_native_intent":4])}
        for _ in 0..<2000{if await socket.sentTexts().count==2{break};await Task.yield()}
        await socket.enqueue(.text("trx:1,false;"));let released=try await off.value
        XCTAssertEqual(released["confirmed"] as? Bool,true)
        let frames=await socket.sentTexts();XCTAssertEqual(frames,["TRX:1,true;TRX:1;","TRX:1,false;TRX:1;"])
        await session.terminate()
    }
    func testTCI21MigratesReceiveOnlyAndUnsupportedVersionCannotEmitOutput() async throws {
        for version in ["2.1","2.9"] {
            let socket=TCIFixtureSocket(),session=fixture(TCIFixtureConnector([socket]))
            _=try await session.handle("station_connect",params:connect)
            await socket.enqueue(.text(Self.discovery.replacingOccurrences(of:"1.8",with:version).replacingOccurrences(of:"trx_count:2",with:"trx_count:1")+"tx_enable:0,true;trx:0,false;ready;"))
            let state=try await wait(session){$0["available"] as? Bool==true}
            XCTAssertEqual(state["allow_transmit"] as? Bool,false)
            if version=="2.9"{XCTAssertEqual((state["tci"] as? [String:Any])?["output_supported"] as? Bool,false)}
            for text in ["CQ","CQ;TRX:0,true","CQ>TEST"]{
                do{_=try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"send_cw","text":text,"expected_generation":1]);XCTFail("Unadmitted output accepted")}catch{}
            }
            let frames=await socket.sentTexts();XCTAssertTrue(frames.isEmpty)
            await session.terminate()
        }
    }
    func testTCI21OffRetiresPendingOnAndRequiresFreshRXWithoutReplay() async throws {
        let socket=TCIFixtureSocket(),session=fixture(TCIFixtureConnector([socket]))
        _=try await session.handle("station_connect",params:connect.merging(["allow_transmit":true]){_,new in new})
        await socket.enqueue(.text(Self.discovery.replacingOccurrences(of:"1.8",with:"2.1")+"tx_enable:0,true;trx:0,false;ready;"))
        _=try await wait(session){$0["available"] as? Bool==true}
        let owner=UUID().uuidString
        let on=Task{try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"ptt","enabled":true,"source":"gui","ptt_owner_id":owner,"expected_generation":1,"expected_native_intent":1])}
        for _ in 0..<2000{if await socket.sentTexts().count==1{break};await Task.yield()}
        let off=Task{try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"ptt","enabled":false,"source":"gui","ptt_owner_id":owner,"expected_generation":1,"expected_native_intent":2])}
        for _ in 0..<2000{if await socket.sentTexts().count==2{break};await Task.yield()}
        await socket.enqueue(.text("trx:0,false;"));_=try await off.value
        do{_=try await on.value;XCTFail("Retired on completion accepted")}catch{}
        let state=try await session.handle("station_snapshot",params:minimal)
        XCTAssertEqual((state["ptt"] as? [String:Any])?["release_required"] as? Bool,false)
        let frames=await socket.sentTexts();XCTAssertEqual(frames,["TRX:0,true;TRX:0;","TRX:0,false;TRX:0;"])
        await session.terminate()
    }
    func testTCI21OffDeliveredBeforeOnRetiresIntentWithoutReleasingUnownedTransmitter() async throws {
        let socket=TCIFixtureSocket(),session=fixture(TCIFixtureConnector([socket]))
        _=try await session.handle("station_connect",params:connect.merging(["allow_transmit":true]){_,new in new})
        await socket.enqueue(.text(Self.discovery.replacingOccurrences(of:"1.8",with:"2.1")+"tx_enable:0,true;trx:0,false;ready;"))
        _=try await wait(session){$0["available"] as? Bool==true}
        let owner=UUID().uuidString
        let retired=try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"ptt","enabled":false,"source":"gui","ptt_owner_id":owner,"expected_generation":1,"expected_native_intent":2])
        XCTAssertEqual(retired["accepted"] as? Bool,true);XCTAssertEqual(retired["confirmed"] as? Bool,false)
        do{_=try await session.handle("station_radio_control",params:["provider":"direct_tci","control":"ptt","enabled":true,"source":"gui","ptt_owner_id":owner,"expected_generation":1,"expected_native_intent":1]);XCTFail("Older acquisition survived newer Off")}catch{}
        let frames=await socket.sentTexts();XCTAssertEqual(frames,["TRX:0;TX_ENABLE:0;MODULATION:0;"])
        await session.terminate()
    }
    private func wait(_ session: LiveTCISession, predicate: ([String: Any]) -> Bool) async throws -> [String: Any] {
        for _ in 0..<2000 { let value = try await session.handle("station_snapshot", params: minimal); if predicate(value) { return value }; await Task.yield() }
        throw TCIFixtureError.closed
    }
    private static let discovery = "protocol:ExpertSDR3,1.8;device:SunSDR2PRO;receive_only:false;trx_count:2;channels_count:2;vfo_limits:0,160000000;if_limits:-156250,156250;modulations_list:AM,LSB,USB,CW;vfo:0,0,14025000;modulation:0,CW;"
}

private enum TCIFixtureError: Error { case closed }
private final class TCIClock: @unchecked Sendable {
    private let lock = NSLock(); private var value = Date(timeIntervalSince1970: 1000)
    func now() -> Date { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ seconds: TimeInterval) { lock.lock(); defer { lock.unlock() }; value.addTimeInterval(seconds) }
}
actor TCIFixtureSocket: TCIWebSocketConnection {
    private var messages: [TCIWebSocketMessage] = []
    private var waiter: CheckedContinuation<TCIWebSocketMessage, Error>?
    private var closes = 0, closed = false
    private var sent: [String] = []
    private let resumeOnClose: Bool
    init(resumeOnClose: Bool = true) { self.resumeOnClose = resumeOnClose }
    func receive() async throws -> TCIWebSocketMessage {
        if !messages.isEmpty { return messages.removeFirst() }
        if closed { throw TCIFixtureError.closed }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }
    func send(text: String) throws {
        guard !closed else { throw TCIFixtureError.closed }
        sent.append(text)
    }
    func enqueue(_ value: TCIWebSocketMessage) { if let waiter { self.waiter = nil; waiter.resume(returning: value) } else { messages.append(value) } }
    func fail() { closed = true; waiter?.resume(throwing: TCIFixtureError.closed); waiter = nil }
    func close() { closes += 1; closed = true; if resumeOnClose { waiter?.resume(throwing: TCIFixtureError.closed); waiter = nil } }
    func closeCount() -> Int { closes }
    func sentTexts() -> [String] { sent }
}
actor TCIFixtureConnector: TCIWebSocketConnecting {
    private var sockets: [TCIFixtureSocket], calls = 0
    init(_ sockets: [TCIFixtureSocket]) { self.sockets = sockets }
    func connect(to endpoint: URL) async throws -> any TCIWebSocketConnection { calls += 1; guard !sockets.isEmpty else { throw TCIFixtureError.closed }; return sockets.removeFirst() }
    func count() -> Int { calls }
}
private actor TCIHeldConnector: TCIWebSocketConnecting {
    private var waiter: CheckedContinuation<any TCIWebSocketConnection, Never>?
    private(set) var started = false
    func connect(to endpoint: URL) async throws -> any TCIWebSocketConnection { started = true; return await withCheckedContinuation { waiter = $0 } }
    func complete(_ socket: TCIFixtureSocket) { waiter?.resume(returning: socket); waiter = nil }
}
#endif
