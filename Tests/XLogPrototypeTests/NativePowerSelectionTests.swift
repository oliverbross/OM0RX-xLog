import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Native power selection ordering")
struct NativePowerSelectionTests {
    private func send(_ worker: LiveWorker, provider: Any = NSNull(),
                      selection: Any = NSNull(), sequence: Any, radioID: String = "radio1",
                      activeRadio: Any = "radio1", activeGeneration: Any = 1) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": "selection-test",
            "method": "station_power_selection", "params": ["radio_id": radioID, "provider": provider,
                "selection_id": selection, "sequence": sequence,
                "active_radio_id": activeRadio, "active_generation": activeGeneration]])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
    }

    private func activate(_ worker: LiveWorker, radio: Any, generation: Any) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": "active-test", "method": "station_power_selection",
            "params": ["active_radio_id": radio, "active_generation": generation]])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
    }

    @Test("Inactive slot metadata and null fences never replace explicit active power authority")
    func independentActiveAuthority() async throws {
        let gate = NativeDraftPowerGate(), first = UUID(), second = UUID(), firstSession = UUID(), secondSession = UUID()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("selection-active-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false), powerCapture: gate)
        for (radio, source, session) in [("radio1", first, firstSession), ("radio2", second, secondSession)] {
            gate.attach(sourceID: source, endpointID: radio, radioID: radio)
            gate.connection(sourceID: source, sequence: 1, sessionID: session, startedAt: Date(), ready: true)
        }
        _ = try await send(worker, provider: "direct_agent", selection: UUID().uuidString, sequence: 1)
        let before = gate.state()
        _ = try await send(worker, provider: "direct_agent", selection: UUID().uuidString, sequence: 1, radioID: "radio2")
        _ = try await send(worker, sequence: 2, radioID: "radio2")
        #expect(gate.state().context?.sessionID == firstSession)
        #expect(gate.state().epoch == before.epoch)
        _ = try await send(worker, provider: "direct_agent", selection: UUID().uuidString, sequence: 3, radioID: "radio2")
        _ = try await activate(worker, radio: NSNull(), generation: 2)
        #expect(gate.state().context == nil)
        _ = try await activate(worker, radio: "radio2", generation: 3)
        #expect(gate.state().context?.sessionID == secondSession)
        // A delayed notice can update its own slot but cannot restore routing.
        _ = try await send(worker, provider: "direct_agent", selection: UUID().uuidString, sequence: 2)
        #expect(gate.state().context?.sessionID == secondSession)
        let stale = try await activate(worker, radio: "radio1", generation: 2)
        #expect((stale["result"] as? [String: Any])?["accepted"] as? Bool == false)
        let conflicting = try await activate(worker, radio: "radio1", generation: 3)
        #expect((conflicting["result"] as? [String: Any])?["accepted"] as? Bool == false)
        let epoch = gate.state().epoch
        _ = try await activate(worker, radio: "radio2", generation: 3)
        #expect(gate.state().epoch == epoch, "Idempotent authority retry cannot retire a live scope")
        _ = try await activate(worker, radio: "radio1", generation: 4)
        #expect(gate.state().context?.sessionID == firstSession)
        await worker.beginTerminalShutdown()
    }

    @Test("Malformed authority cannot mutate a valid active scope")
    func invalidActiveAuthority() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("selection-authority-invalid-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = NativeDraftPowerGate(), source = UUID(), session = UUID()
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false), powerCapture: gate)
        gate.attach(sourceID: source, endpointID: "fixture")
        gate.connection(sourceID: source, sequence: 1, sessionID: session, startedAt: Date(), ready: true)
        _ = try await send(worker, provider: "direct_agent", selection: UUID().uuidString, sequence: 1)
        let before = gate.state()
        for generation: Any in [true, 0, -1, 1.5, "2", 9_007_199_254_740_992] {
            let reply = try await activate(worker, radio: "radio2", generation: generation)
            #expect(reply["ok"] as? Bool == false)
        }
        let malformed = try await send(worker, provider: "invalid", selection: UUID().uuidString, sequence: 2,
                                       activeRadio: "radio2", activeGeneration: 2)
        #expect(malformed["ok"] as? Bool == false)
        #expect(gate.state().epoch == before.epoch)
        #expect(gate.state().context?.sessionID == session)
        await worker.beginTerminalShutdown()
    }

    @Test("Delayed startup contexts cannot overwrite newer selection or revocation")
    func stalePublication() async throws {
        let gate = NativeDraftPowerGate()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("selection-test-\(UUID())")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let worker = LiveWorker(logbook: service, powerCapture: gate)
        let source = UUID(), session = UUID(), selected = UUID().uuidString
        gate.attach(sourceID: source, endpointID: "synthetic")
        gate.connection(sourceID: source, sequence: 1, sessionID: session, startedAt: Date(), ready: true)
        let current = try await send(worker, provider: "direct_agent", selection: selected, sequence: 2)
        #expect((current["result"] as? [String: Any])?["accepted"] as? Bool == true)
        #expect(gate.state().context?.selectionID == selected)
        let stale = try await send(worker, provider: "hamlib", selection: UUID().uuidString, sequence: 1)
        #expect((stale["result"] as? [String: Any])?["superseded"] as? Bool == true)
        #expect(gate.state().context?.selectionID == selected)
        _ = try await send(worker, sequence: 3)
        #expect(gate.state().context == nil)
        _ = try await send(worker, provider: "direct_agent", selection: selected, sequence: 2)
        #expect(gate.state().context == nil)
        await worker.beginTerminalShutdown()
    }

    @Test("Sequence rejects booleans, fractions, strings, zero and unsafe integers")
    func invalidSequences() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("selection-invalid-\(UUID())")
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false))
        for value: Any in [true, -1, 0, 1.5, "2", 9_007_199_254_740_992] {
            let response = try await send(worker, sequence: value)
            #expect(response["ok"] as? Bool == false)
        }
        let valid = try await send(worker, sequence: 1)
        #expect((valid["result"] as? [String: Any])?["accepted"] as? Bool == true)
        let missingID = try JSONSerialization.data(withJSONObject: ["id": "missing-radio",
            "method": "station_power_selection", "params": ["provider": NSNull(), "selection_id": NSNull(), "sequence": 2]])
        let rejected = try #require(JSONSerialization.jsonObject(with: await worker.response(to: missingID)) as? [String: Any])
        #expect(rejected["ok"] as? Bool == false)
        await worker.beginTerminalShutdown()
    }

    @Test("TCI selection metadata is acknowledged without granting draft power capture")
    func tciMetadataIsNotPowerAuthority() async throws {
        let gate = NativeDraftPowerGate()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("selection-tci-\(UUID())")
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false), powerCapture: gate)
        let source = UUID(), session = UUID()
        gate.attach(sourceID: source, endpointID: "synthetic")
        gate.connection(sourceID: source, sequence: 1, sessionID: session, startedAt: Date(), ready: true)
        let response = try await send(worker, provider: "direct_tci", selection: UUID().uuidString, sequence: 1)
        #expect((response["result"] as? [String: Any])?["accepted"] as? Bool == true)
        #expect(gate.state().context == nil)
        await worker.beginTerminalShutdown()
    }
}
