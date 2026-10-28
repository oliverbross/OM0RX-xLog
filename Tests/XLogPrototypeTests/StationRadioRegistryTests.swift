#if os(macOS)
import Foundation
import XCTest
import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class StationRadioRegistryTests: XCTestCase {
    func testWorkerRegistersBothRoutedAgentsAndRetiresEverySlotWithoutGlobalServices() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("registry-worker-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let registry = StationRadioRegistry(), gate = NativeDraftPowerGate()
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false),
            powerCapture: gate, runtimeProfile: .contestingTest(supportRoot: root), stationRegistry: registry)
        await worker.startPowerCapture()
        for agent in registry.agents.values {
            let installed = await agent.powerCapture
            XCTAssertTrue(installed === gate)
        }
        let outcome = await worker.shutdownOutcome()
        XCTAssertEqual(outcome, .clean)
        for radio in ["radio1", "radio2"] {
            for provider in ["direct_agent", "direct_flex_lan", "direct_tci"] {
                let method = provider == "direct_tci" ? "station_connect" : "station_disconnect"
                var params: [String: Any] = ["provider": provider, "radio_id": radio]
                if provider == "direct_tci" { params.merge(["endpoint": "ws://127.0.0.1:40001", "trx": 0, "channel": 0]) { _, v in v } }
                do { _ = try await LiveStationMethods.handle(method, params: params, registry: registry); XCTFail("Routed owner survived EOF") }
                catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "worker_stopping") }
            }
        }
        let repeated = await worker.shutdownOutcome()
        XCTAssertEqual(repeated, .clean, "Retirement is idempotent")
    }

    func testWorkerRetiresConnectedTCIWithoutSendingReceiveOrTransmitControls() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("registry-tci-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let socket = TCIFixtureSocket(), connector = TCIFixtureConnector([socket, socket])
        let registry = StationRadioRegistry(tciFactory: { claim in LiveTCISession(claim: claim, factory: {
            TCIReadOnlyWebSocketSession(endpoint: $0.endpoint, configuredAddress: $0.address, connector: connector)
        }) })
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false),
            runtimeProfile: .contestingTest(supportRoot: root), stationRegistry: registry)
        _ = try await LiveStationMethods.handle("station_connect", params: ["provider": "direct_tci", "radio_id": "radio1",
            "endpoint": "ws://127.0.0.1:40001", "trx": 0, "channel": 0], registry: registry)
        let outcome = await worker.shutdownOutcome()
        XCTAssertEqual(outcome, .clean)
        let closes = await socket.closeCount(), sent = await socket.sentTexts()
        XCTAssertGreaterThan(closes, 0)
        XCTAssertTrue(sent.isEmpty)
    }

    func testWorkerReleasesOwnedFlexTuneButOnlyStopsPassiveSlotTransport() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("registry-flex-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let boxes = ["radio1": FlexFixtureBox(), "radio2": FlexFixtureBox()]
        let flex = boxes.mapValues { box in LiveFlexSession(readbackTimeout: .milliseconds(250)) { _, state, snapshot in
            let radio = FakeFlexRadio(snapshot: RadioSnapshot(frequencyHz: 14_074_000), onState: state, onSnapshot: snapshot)
            box.store(radio); return radio
        } }
        let registry = StationRadioRegistry(flex: flex)
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false),
            runtimeProfile: .contestingTest(supportRoot: root), stationRegistry: registry)
        for radio in ["radio1", "radio2"] {
            _ = try await LiveStationMethods.handle("station_connect", params: ["provider": "direct_flex_lan", "radio_id": radio,
                "host": "192.168.1.20", "station_name": "fixture", "allow_transmit": radio == "radio2"], registry: registry)
        }
        let owner = try XCTUnwrap(flex["radio2"])
        var state: [String: Any] = [:]
        for _ in 0..<2000 {
            state = try await owner.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
            if state["available"] as? Bool == true { break }; await Task.yield()
        }
        let generation = try XCTUnwrap(state["generation"] as? UInt64)
        _ = try await owner.handle("station_action", params: ["provider": "direct_flex_lan", "action": "tune", "expected_generation": generation])
        let outcome = await worker.shutdownOutcome()
        XCTAssertEqual(outcome, .clean)
        let passive = try XCTUnwrap(boxes["radio1"]?.get()), active = try XCTUnwrap(boxes["radio2"]?.get())
        let passiveCommands = await passive.commandLog(), activeCommands = await active.commandLog()
        XCTAssertEqual(passiveCommands, ["stop_transport"])
        XCTAssertEqual(activeCommands, ["tune_on", "ptt_off", "stop_transport"])
    }

    func testPowerSourcesRemainBoundToTheirSelectedRadioAcrossOtherSlotReconnectAndDetach() {
        let gate = NativeDraftPowerGate(), first = UUID(), second = UUID(), firstSession = UUID(), secondSession = UUID()
        let start = Date(), selection = UUID().uuidString
        gate.select(provider: "direct_agent", selectionID: selection, radioID: "radio1")
        gate.attach(sourceID: first, endpointID: "radio1", radioID: "radio1")
        gate.connection(sourceID: first, sequence: 1, sessionID: firstSession, startedAt: start, ready: true)
        let before = gate.state()
        gate.attach(sourceID: second, endpointID: "radio2", radioID: "radio2")
        gate.connection(sourceID: second, sequence: 1, sessionID: secondSession, startedAt: start, ready: true)
        XCTAssertEqual(gate.state().context?.sessionID, firstSession)
        XCTAssertEqual(gate.state().epoch, before.epoch)
        gate.select(provider: "direct_agent", selectionID: selection, radioID: "radio2")
        XCTAssertEqual(gate.state().context?.sessionID, secondSession)
        gate.detach(radioID: "radio1")
        XCTAssertEqual(gate.state().context?.sessionID, secondSession)
        gate.detach(radioID: "radio2")
        XCTAssertNil(gate.state().context)
        gate.connection(sourceID: second, sequence: 2, sessionID: secondSession, startedAt: start, ready: true)
        XCTAssertNil(gate.state().context, "Late callback cannot restore a detached source")
    }
}
#endif
