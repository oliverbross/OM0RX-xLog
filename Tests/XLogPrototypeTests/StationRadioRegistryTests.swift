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
        gate.activate(radioID: "radio1", generation: 1)
        gate.attach(sourceID: first, endpointID: "radio1", radioID: "radio1")
        gate.connection(sourceID: first, sequence: 1, sessionID: firstSession, startedAt: start, ready: true)
        let before = gate.state()
        gate.attach(sourceID: second, endpointID: "radio2", radioID: "radio2")
        gate.connection(sourceID: second, sequence: 1, sessionID: secondSession, startedAt: start, ready: true)
        XCTAssertEqual(gate.state().context?.sessionID, firstSession)
        XCTAssertEqual(gate.state().epoch, before.epoch)
        gate.select(provider: "direct_agent", selectionID: selection, radioID: "radio2")
        gate.activate(radioID: "radio2", generation: 2)
        XCTAssertEqual(gate.state().context?.sessionID, secondSession)
        gate.detach(radioID: "radio1")
        XCTAssertEqual(gate.state().context?.sessionID, secondSession)
        gate.detach(radioID: "radio2")
        XCTAssertNil(gate.state().context)
        gate.connection(sourceID: second, sequence: 2, sessionID: secondSession, startedAt: start, ready: true)
        XCTAssertNil(gate.state().context, "Late callback cannot restore a detached source")
    }

    func testUnconfirmedFlexRetirementBlocksRestartAndAllowsOnlyReleaseRecovery() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("registry-release-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let box = FlexFixtureBox()
        let owner = LiveFlexSession(readbackTimeout: .milliseconds(60)) { _, state, snapshot in
            let radio = FakeFlexRadio(snapshot: RadioSnapshot(frequencyHz: 14_074_000), onState: state, onSnapshot: snapshot)
            box.store(radio); return radio
        }
        let registry = StationRadioRegistry(flex: ["radio1": owner, "radio2": LiveFlexSession()])
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false),
                                stationRegistry: registry)
        _ = try await LiveStationMethods.handle("station_connect", params: ["provider": "direct_flex_lan", "radio_id": "radio1",
            "host": "192.168.1.20", "station_name": "fixture", "allow_transmit": true], registry: registry)
        for _ in 0..<2000 {
            let value = try await owner.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
            if value["available"] as? Bool == true { break }; await Task.yield()
        }
        _ = try await owner.handle("station_radio_control", params: ["provider": "direct_flex_lan", "control": "ptt", "enabled": true])
        let radio = try XCTUnwrap(box.get())
        await radio.setObserveRelease(false)
        let failed = await worker.shutdownOutcome()
        XCTAssertEqual(failed, .stationRetirementUnconfirmed)
        XCTAssertFalse(failed.permitsRestart)
        let retained = await owner.isAttached()
        XCTAssertTrue(retained)
        let retirement = await registry.terminate()
        XCTAssertEqual(retirement.unconfirmedRadioIDs, ["radio1"])
        func request(_ method: String, _ params: [String: Any]) async throws -> [String: Any] {
            let data = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method, "params": params])
            let reply = await worker.response(to: data)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: reply) as? [String: Any])
        }
        let acquire = try await request("station_action", ["provider": "direct_flex_lan", "radio_id": "radio1", "action": "tune"])
        XCTAssertEqual((acquire["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
        let release = ["provider": "direct_flex_lan", "radio_id": "radio1"]
        let uncertain = try await request("station_disconnect", release)
        XCTAssertEqual((uncertain["error"] as? [String: Any])?["code"] as? String, "release_unconfirmed")
        await radio.setObserveRelease(true)
        let recovered = try await request("station_disconnect", release)
        XCTAssertEqual(recovered["ok"] as? Bool, true)
        let attached = await owner.isAttached(), commands = await radio.commandLog()
        XCTAssertFalse(attached)
        XCTAssertEqual(commands.filter { $0 == "ptt_on" }.count, 1)
        XCTAssertEqual(commands.filter { $0 == "stop_transport" }.count, 1)
        let repeated = await worker.shutdownOutcome()
        XCTAssertEqual(repeated, .clean)
        let sealed = try await request("station_connect", ["provider": "direct_flex_lan", "radio_id": "radio1"])
        XCTAssertEqual((sealed["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
    }

    func testTerminalReleaseRecoveryDoesNotBypassTestProfileIODenial() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("registry-offline-release-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false),
            runtimeProfile: .contestingTest(supportRoot: root), stationRegistry: StationRadioRegistry())
        await worker.beginTerminalShutdown()
        let data = try JSONSerialization.data(withJSONObject: ["id": "release-denied", "method": "station_disconnect",
            "params": ["provider": "direct_flex_lan", "radio_id": "radio1"]])
        let response = await worker.response(to: data)
        let reply = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
        XCTAssertEqual((reply["error"] as? [String: Any])?["code"] as? String, "external_io_disabled")
        _ = await worker.shutdownOutcome()
    }
}
#endif
