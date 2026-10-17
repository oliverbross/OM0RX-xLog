import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Native power selection ordering")
struct NativePowerSelectionTests {
    private func send(_ worker: LiveWorker, provider: Any = NSNull(),
                      selection: Any = NSNull(), sequence: Any) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": "selection-test",
            "method": "station_power_selection", "params": ["radio_id": "radio1", "provider": provider,
                "selection_id": selection, "sequence": sequence]])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
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
