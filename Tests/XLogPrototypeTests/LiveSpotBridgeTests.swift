#if os(macOS)
import Foundation
import Network
import XCTest
@testable import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class LiveSpotBridgeTests: XCTestCase {
    func testIngressBoundsTasksBeforeActorAndRejectsOversizedPayloads() {
        let gate = SpotIngressGate(limit: 2)
        XCTAssertFalse(gate.admit(bytes: 0))
        XCTAssertFalse(gate.admit(bytes: 16_385))
        XCTAssertTrue(gate.admit(bytes: 100))
        XCTAssertTrue(gate.admit(bytes: 16_384))
        for _ in 0..<1_000 { XCTAssertFalse(gate.admit(bytes: 100)) }
        XCTAssertEqual(gate.droppedCount, 1_002)
        gate.finish()
        XCTAssertTrue(gate.admit(bytes: 100))
        gate.finish(); gate.finish()
    }

    private func spot(priority: Int = 3, source: String = "RUMlogNG Logbook") throws -> FlexSpot {
        try FlexSpot(frequencyHz: 14_074_000, callsign: "K1ABC", mode: "FT8",
                     source: source, spotter: "OM0RX", comment: "test",
                     timestamp: Int64(Date().timeIntervalSince1970), lifetimeSeconds: 600,
                     priority: priority, colorHex: "#FF453A")
    }

    func testMatchingRemoteAgentAckIsRequired() throws {
        let expected = try spot()
        let accepted = Data(#"{"success":true,"result":{"accepted":true,"callsign":"K1ABC","frequency_hz":14074000}}"#.utf8)
        XCTAssertNoThrow(try RemoteAgentStateDecoder.spotCommandResponse(accepted, expected: expected))
        for response in [
            #"{"success":true}"#,
            #"{"success":true,"result":{"accepted":false,"callsign":"K1ABC","frequency_hz":14074000}}"#,
            #"{"success":true,"result":{"accepted":true,"callsign":"K2XYZ","frequency_hz":14074000}}"#,
            #"{"success":true,"result":{"accepted":true,"callsign":"K1ABC","frequency_hz":14075000}}"#,
            #"{"success":false,"result":{"accepted":true,"callsign":"K1ABC","frequency_hz":14074000}}"#
        ] {
            XCTAssertThrowsError(try RemoteAgentStateDecoder.spotCommandResponse(Data(response.utf8), expected: expected))
        }
    }

    func testSharedBrokerDeduplicatesAcrossFeedSourcesAndAllowsPriorityUpgrade() async throws {
        let counter = DeliveryCounter()
        let broker = SpotForwardBroker { _ in try await counter.record() }
        let first = try await broker.forward(spot(priority: 3))
        let duplicate = try await broker.forward(spot(priority: 3, source: "xLog xCluster"))
        let upgrade = try await broker.forward(spot(priority: 5, source: "xLog xCluster"))
        let count = await counter.value()
        XCTAssertTrue(first)
        XCTAssertFalse(duplicate)
        XCTAssertTrue(upgrade)
        XCTAssertEqual(count, 2)
    }

    func testRejectedDeliveryCanRetryWithoutFalseSuccess() async throws {
        let counter = DeliveryCounter(rejectFirst: true)
        let broker = SpotForwardBroker { _ in try await counter.record() }
        let value = try spot()
        do {
            _ = try await broker.forward(value)
            XCTFail("Rejected ACK must not count as accepted")
        } catch {}
        let retried = try await broker.forward(value)
        let count = await counter.value()
        XCTAssertTrue(retried)
        XCTAssertEqual(count, 2)
    }

    func testHigherPriorityDuringPendingIsNotMisreportedAndCanUpgradeLater() async throws {
        let gate = GatedDelivery()
        let broker = SpotForwardBroker { _ in await gate.deliver() }
        let low = try spot(priority: 1)
        let high = try spot(priority: 5)
        let first = Task { try await broker.forward(low) }
        await gate.waitStarted()
        let pendingUpgrade = try await broker.forward(high)
        XCTAssertFalse(pendingUpgrade, "Pending higher-priority spot was not ACKed")
        await gate.release()
        let firstAccepted = try await first.value
        XCTAssertTrue(firstAccepted)
        let acceptedUpgrade = try await broker.forward(high)
        let deliveredCount = await gate.value()
        XCTAssertTrue(acceptedUpgrade)
        XCTAssertEqual(deliveredCount, 2)
    }

    func testAcceptedDedupeCacheIsBoundedUnderManyDistinctSpots() async throws {
        let broker = SpotForwardBroker { _ in }
        let original = try spot()
        for index in 0..<4_200 {
            let unique = try FlexSpot(frequencyHz: original.frequencyHz,
                                      callsign: "K\(index)ABC", mode: original.mode,
                                      source: original.source, spotter: original.spotter,
                                      comment: original.comment, timestamp: original.timestamp,
                                      lifetimeSeconds: original.lifetimeSeconds,
                                      priority: original.priority, colorHex: original.colorHex)
            _ = try await broker.forward(unique)
        }
        let size = await broker.cacheSizeForTesting()
        XCTAssertLessThanOrEqual(size, 4_096)
    }

    func testNativeParserPreservesCategoryStyleAndSourceIdentity() throws {
        let xml = Data("<spot><dxcall>K1ABC</dxcall><frequency>14074</frequency><mode>FT8</mode><dxccnotcfd>1</dxccnotcfd><spottercall>OM0RX</spottercall></spot>".utf8)
        let parsed = try RUMlogSpotParser.parse(xml, feed: .logbook)
        XCTAssertEqual(parsed.category, .dxccNotConfirmed)
        let converted = try parsed.flexSpot(feed: .logbook,
                                            style: SpotBridgeConfiguration.defaultStyles[.dxccNotConfirmed]!)
        XCTAssertEqual(converted.source, "RUMlogNG Logbook")
        XCTAssertEqual(converted.priority, 5)
        XCTAssertEqual(converted.colorHex, "#FF453A")
        XCTAssertEqual(converted.frequencyHz, 14_074_000)
    }

    func testParserRejectsHugeFiniteFrequencyWithoutIntegerTrap() throws {
        func xml(_ frequency: String) -> Data {
            Data("<spot><dxcall>K1ABC</dxcall><frequency>\(frequency)</frequency></spot>".utf8)
        }
        for invalid in ["1e100", "60000001", "99.999", "NaN", "Infinity"] {
            XCTAssertThrowsError(try RUMlogSpotParser.parse(xml(invalid), feed: .logbook), invalid)
        }
        XCTAssertEqual(try RUMlogSpotParser.parse(xml("14074.25"), feed: .logbook).frequencyHz, 14_074_250)
        XCTAssertEqual(try RUMlogSpotParser.parse(xml("100"), feed: .logbook).frequencyHz, 100_000)
        XCTAssertEqual(try RUMlogSpotParser.parse(xml("60000000"), feed: .logbook).frequencyHz, 60_000_000)
    }

    func testOptInDualPortLifecycleWithoutOpeningSockets() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let delivered = DeliveryCounter()
        let broker = SpotForwardBroker { _ in try await delivered.record() }
        let logbook = FakeSpotReceiver()
        let contest = FakeSpotReceiver()
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    broker: broker, workspaceAvailable: { true },
                                    receiverFactory: { feed, data, event in
                                        let receiver = feed == .logbook ? logbook : contest
                                        receiver.onData = data
                                        receiver.onEvent = event
                                        return receiver
                                    })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(initial["running"] as? Bool, false)
        let initialConfig = initial["configuration"] as? [String: Any]
        XCTAssertEqual(initialConfig?["enabled"] as? Bool, false)
        var enabled = initialConfig!
        enabled["enabled"] = true
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        XCTAssertNil(logbook.port)
        let started = try await bridge.handle(method: "spot_bridge_start", params: [:])
        XCTAssertEqual(started["running"] as? Bool, true)
        XCTAssertEqual(logbook.port, 12_062)
        XCTAssertEqual(contest.port, 12_063)
        let xml = Data("<spot><dxcall>K1ABC</dxcall><frequency>14074</frequency><mode>FT8</mode><newmulti>1</newmulti></spot>".utf8)
        await bridge.ingest(xml, feed: .contest)
        let forwarded = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(forwarded["accepted_count"] as? Int, 1)
        let deliveredCount = await delivered.value()
        XCTAssertEqual(deliveredCount, 1)
        let stopped = try await bridge.handle(method: "spot_bridge_stop", params: [:])
        XCTAssertEqual(stopped["running"] as? Bool, false)
        XCTAssertEqual((stopped["configuration"] as? [String: Any])?["enabled"] as? Bool, false)
        XCTAssertEqual(logbook.stopCount, 1)
        XCTAssertEqual(contest.stopCount, 1)
    }

    func testStoppedReceiverCallbackCannotForwardIntoRestartedGeneration() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let delivered = DeliveryCounter()
        let broker = SpotForwardBroker { _ in try await delivered.record() }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    broker: broker, workspaceAvailable: { true },
                                    receiverFactory: { _, data, event in
                                        let receiver = FakeSpotReceiver()
                                        receiver.onData = data
                                        receiver.onEvent = event
                                        StaleReceiverStore.shared.append(receiver)
                                        return receiver
                                    })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var enabled = initial["configuration"] as! [String: Any]
        enabled["enabled"] = true
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
        let old = StaleReceiverStore.shared.first!
        _ = try await bridge.handle(method: "spot_bridge_stop", params: [:])
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
        let xml = Data("<spot><dxcall>K1ABC</dxcall><frequency>14074</frequency><mode>FT8</mode></spot>".utf8)
        old.onData?(xml)
        old.onEvent?("UDP listener failed: stale")
        try await Task.sleep(for: .milliseconds(50))
        let snapshot = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        let count = await delivered.value()
        XCTAssertEqual(count, 0)
        XCTAssertEqual(snapshot["running"] as? Bool, true)
        await bridge.stopForShutdown()
        StaleReceiverStore.shared.clear()
    }

    func testPartialBindFailureStopsBothInjectedReceivers() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let logbook = FakeSpotReceiver()
        let contest = FakeSpotReceiver(failStart: true)
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true },
                                    receiverFactory: { feed, _, _ in feed == .logbook ? logbook : contest })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var enabled = initial["configuration"] as! [String: Any]
        enabled["enabled"] = true
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        do {
            _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
            XCTFail("A failed contest bind must roll back the logbook listener")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "spot_bridge_bind_failed")
        }
        XCTAssertEqual(logbook.stopCount, 1)
        XCTAssertEqual(contest.stopCount, 1)
        let snapshot = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(snapshot["running"] as? Bool, false)
    }

    func testConfigurationRejectsUnknownStyleAndPortCollisionWithoutBinding() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true },
                                    receiverFactory: { _, _, _ in FakeSpotReceiver() })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var config = initial["configuration"] as! [String: Any]
        config["contestPort"] = 12_062
        do {
            _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": config])
            XCTFail("Equal ports must be rejected")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        config["contestPort"] = 12_063
        var styles = config["styles"] as! [String: Any]
        styles["unrecognizedStyle"] = ["priority": 5, "colorHex": "#FF453A", "lifetimeSeconds": 600]
        config["styles"] = styles
        do {
            _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": config])
            XCTFail("Unknown category must be rejected")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
    }

    func testActualLoopbackPortCollisionAndDualPortRollback() async throws {
        let temporary = try loopbackEphemeralListener()
        let freePort = temporary.port
        temporary.listener.cancel()
        let blocked = try loopbackEphemeralListener()
        defer { blocked.listener.cancel() }
        XCTAssertNotEqual(freePort, blocked.port)

        let collisionProbe = UDPSpotReceiver(label: "xlog.spot.collision", onDatagram: { _ in })
        XCTAssertThrowsError(try collisionProbe.start(port: blocked.port))
        collisionProbe.stop()

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var config = initial["configuration"] as! [String: Any]
        config["enabled"] = true
        config["logbookPort"] = Int(freePort)
        config["contestPort"] = Int(blocked.port)
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": config])
        do {
            _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
            XCTFail("Occupied contest port must reject the pair")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "spot_bridge_bind_failed")
        }
        let snapshot = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(snapshot["running"] as? Bool, false)
        let releasedProbe = UDPSpotReceiver(label: "xlog.spot.rollback", onDatagram: { _ in })
        try releasedProbe.start(port: freePort)
        releasedProbe.stop()
    }

    func testDTORejectsBooleanAndFractionalNumbers() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true },
                                    receiverFactory: { _, _, _ in FakeSpotReceiver() })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        let valid = initial["configuration"] as! [String: Any]
        var bad = valid
        bad["enabled"] = 1
        await assertBadConfiguration(bad, bridge: bridge)
        bad = valid
        bad["logbookPort"] = true
        await assertBadConfiguration(bad, bridge: bridge)
        bad = valid
        bad["contestPort"] = 12_063.5
        await assertBadConfiguration(bad, bridge: bridge)
        bad = valid
        var styles = bad["styles"] as! [String: Any]
        var first = styles["newMultiplier"] as! [String: Any]
        first["priority"] = true
        styles["newMultiplier"] = first
        bad["styles"] = styles
        await assertBadConfiguration(bad, bridge: bridge)
    }

    private func assertBadConfiguration(_ configuration: [String: Any], bridge: LiveSpotBridge) async {
        do {
            _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": configuration])
            XCTFail("Invalid numeric configuration was accepted")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "invalid_params")
        } catch {
            XCTFail("Unexpected configuration error: \(error)")
        }
    }

    private func loopbackEphemeralListener() throws -> (listener: NWListener, port: UInt16) {
        let parameters = NWParameters.udp
        parameters.allowLocalEndpointReuse = false
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready, .failed: ready.signal()
            default: break
            }
        }
        listener.newConnectionHandler = { $0.cancel() }
        listener.start(queue: DispatchQueue(label: "xlog.spot.ephemeral"))
        guard ready.wait(timeout: .now() + 3) == .success,
              let port = listener.port?.rawValue, port >= 1_024 else {
            listener.cancel()
            throw NSError(domain: "loopback-port", code: 1)
        }
        return (listener, port)
    }
}

private actor DeliveryCounter {
    private var count = 0
    private let rejectFirst: Bool
    init(rejectFirst: Bool = false) { self.rejectFirst = rejectFirst }
    func record() throws {
        count += 1
        if rejectFirst && count == 1 { throw NSError(domain: "test", code: 1) }
    }
    func value() -> Int { count }
}

private actor GatedDelivery {
    private var count = 0
    private var firstContinuation: CheckedContinuation<Void, Never>?
    private var startedContinuation: CheckedContinuation<Void, Never>?
    func deliver() async {
        count += 1
        if count == 1 {
            startedContinuation?.resume()
            startedContinuation = nil
            await withCheckedContinuation { firstContinuation = $0 }
        }
    }
    func waitStarted() async {
        if count > 0 { return }
        await withCheckedContinuation { startedContinuation = $0 }
    }
    func release() { firstContinuation?.resume(); firstContinuation = nil }
    func value() -> Int { count }
}

private final class FakeSpotReceiver: SpotDatagramReceiving, @unchecked Sendable {
    let failStart: Bool
    private(set) var port: UInt16?
    private(set) var stopCount = 0
    var onData: (@Sendable (Data) -> Void)?
    var onEvent: (@Sendable (String) -> Void)?
    init(failStart: Bool = false) { self.failStart = failStart }
    func start(port: UInt16) throws {
        if failStart { throw NSError(domain: "bind", code: 1) }
        self.port = port
    }
    func stop() { stopCount += 1; port = nil }
}

private final class StaleReceiverStore: @unchecked Sendable {
    static let shared = StaleReceiverStore()
    private let lock = NSLock()
    private var receivers: [FakeSpotReceiver] = []
    var first: FakeSpotReceiver? { lock.withLock { receivers.first } }
    func append(_ receiver: FakeSpotReceiver) { lock.withLock { receivers.append(receiver) } }
    func clear() { lock.withLock { receivers.removeAll() } }
}
#endif
