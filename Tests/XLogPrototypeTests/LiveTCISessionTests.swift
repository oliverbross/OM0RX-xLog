import Foundation
import XCTest
#if os(macOS)
import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class LiveTCISessionTests: XCTestCase {
    private let minimal: [String: Any] = ["provider": "direct_tci"]
    private let connect: [String: Any] = ["provider": "direct_tci", "endpoint": "ws://127.0.0.1:40001", "trx": 0, "channel": 0]

    func testSnapshotSaveAndDeniedMethodsNeverConnect() async throws {
        let connector = TCIFixtureConnector([]), session = fixture(connector)
        let initial = try await session.handle("station_snapshot", params: minimal)
        XCTAssertEqual(initial["available"] as? Bool, false)
        XCTAssertTrue(initial["generated_at"] is NSNull)
        for method in ["station_configuration_save", "station_reconnect", "station_action", "station_radio_control", "station_cat_servers", "station_add_spot"] {
            do { _ = try await session.handle(method, params: minimal); XCTFail("Read-only adapter admitted \(method)") }
            catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "method_not_allowed") }
        }
        do { _ = try await session.handle("station_tune", params: minimal); XCTFail("Incomplete TCI tune admitted") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        for change in [["trx": true], ["channel": 16], ["endpoint": "ws://user:secret@localhost:40001"], ["endpoint": "ws://localhost:40001/?token=secret"], ["endpoint": "http://localhost:40001"], ["allow_transmit": true]] as [[String: Any]] {
            do { _ = try await session.handle("station_connect", params: connect.merging(change) { _, new in new }); XCTFail("Invalid TCI config admitted") }
            catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        }
        let calls = await connector.count(); XCTAssertEqual(calls, 0)
        await session.terminate()
    }

    func testWorkerRouterRecognizesTCIWithoutFallingThroughToAgentOrLoopback() async throws {
        let snapshot = try await LiveStationMethods.handle("station_snapshot", params: minimal)
        XCTAssertEqual(snapshot["source"] as? String, "direct_tci")
        XCTAssertEqual(snapshot["allow_transmit"] as? Bool, false)
        for method in ["station_reconnect", "station_action", "station_radio_control", "station_configuration_save", "station_add_spot", "station_cat_servers"] {
            do { _ = try await LiveStationMethods.handle(method, params: minimal); XCTFail("Router admitted TCI mutation") }
            catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "method_not_allowed") }
        }
        do { _ = try await LiveStationMethods.handle("station_tune", params: minimal); XCTFail("Incomplete TCI tune admitted") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
    }

    func testExplicitTuneUsesSavedAddressAndReturnsOnlyAfterAuthoritativeReadback() async throws {
        let socket = TCIFixtureSocket(), time = TCIClock()
        let session = fixture(TCIFixtureConnector([socket]), clock: { time.now() })
        _ = try await session.handle("station_connect", params: connect)
        await socket.enqueue(.text(Self.discovery + "trx:0,false;ready;"))
        let ready = try await wait(session) { $0["available"] as? Bool == true }
        XCTAssertEqual((ready["capabilities"] as? [String: Any])?["supported_commands"] as? [String], ["station_tune"])
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
        XCTAssertEqual((ready["capabilities"] as? [String: Any])?["supported_commands"] as? [String], ["station_tune"])
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
        await old.enqueue(.text("vfo:0,0,9999999;"))
        for _ in 0..<30 { await Task.yield() }
        let after = try await session.handle("station_snapshot", params: minimal)
        XCTAssertEqual((after["radio"] as? [String: Any])?["frequency_hz"] as? Int64, 7_100_000)
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

    private func fixture(_ connector: TCIFixtureConnector, claim: StationProviderClaim = StationProviderClaim(), clock: @escaping @Sendable () -> Date = { Date() }) -> LiveTCISession {
        LiveTCISession(claim: claim, clock: clock, factory: { TCIReadOnlyWebSocketSession(endpoint: $0.endpoint, configuredAddress: $0.address, connector: connector, clock: clock) })
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
private actor TCIFixtureSocket: TCIWebSocketConnection {
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
private actor TCIFixtureConnector: TCIWebSocketConnecting {
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
