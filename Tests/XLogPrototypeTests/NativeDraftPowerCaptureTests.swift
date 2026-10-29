import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Worker-owned power capture without a renderer")
struct NativeDraftPowerCaptureTests {
    private actor Latch {
        var waiting: CheckedContinuation<Void, Never>?
        var entered = false
        func wait() async { entered = true; await withCheckedContinuation { waiting = $0 } }
        func release() { waiting?.resume(); waiting = nil }
    }
    private func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let json = try JSONSerialization.jsonObject(with: encoder.encode(value))
        return try #require(json as? [String: Any])
    }
    private func request(_ worker: LiveWorker, _ method: String, _ params: [String: Any]) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method, "params": params])
        let reply = try JSONSerialization.jsonObject(with: await worker.response(to: data))
        let response = try #require(reply as? [String: Any])
        #expect(response["ok"] as? Bool == true)
        return response
    }
    private func replace(_ worker: LiveWorker, service: LiveLogbookMethods, call: String? = nil,
                         intent: [String: Any]? = nil) async throws {
        let owner = try service.powerOwnerSnapshot()
        var qso = owner.draft.qso
        if let call { qso.call = call }
        qso.frequencyHz = 14_025_000; qso.band = "20m"; qso.mode = "CW"
        var params: [String: Any] = ["generation": owner.workspaceID.uuidString,
            "operationID": UUID().uuidString, "draftID": qso.id.uuidString,
            "expectedRevision": owner.draft.revision, "action": "replace", "qso": try object(qso)]
        if let intent { params["powerIntent"] = intent }
        _ = try await request(worker, "logbook_operator_draft_apply", params)
    }
    private func fixture(_ operation: (LiveWorker, LiveLogbookMethods, NativeDraftPowerGate, UUID, UUID, NativeDraftPowerDelivery) async throws -> Void) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("power-worker-\(UUID())")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        defer { workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName) }
        var settings = try service.currentSettings(); settings.automaticTransmitPower = true; settings.defaultPower = "100"
        _ = try service.saveSettingsForTest(try object(settings))
        let gate = NativeDraftPowerGate(), source = UUID(), session = UUID()
        let delivery = NativeDraftPowerDelivery()
        let worker = LiveWorker(logbook: service, powerCapture: gate, powerDelivery: delivery)
        await worker.startPowerCapture(registerStation: false)
        _ = try await request(worker, "station_power_selection", ["radio_id": "radio1", "provider": "direct_agent", "selection_id": UUID().uuidString, "sequence": 1,
            "active_radio_id": "radio1", "active_generation": 1])
        gate.attach(sourceID: source, endpointID: "fixture")
        gate.connection(sourceID: source, sequence: 1, sessionID: session, startedAt: Date().addingTimeInterval(-1), ready: true)
        await worker.drainPowerCapture()
        try await replace(worker, service: service, call: "K1ABC")
        try await operation(worker, service, gate, source, session, delivery)
        await worker.beginTerminalShutdown()
        await worker.drainPowerCapture()
    }
    private func emit(_ gate: NativeDraftPowerGate, source: UUID, session: UUID, watts: Double,
                      frequency: Int64 = 14_025_000, mode: String = "CW") throws {
        let now = Date()
        let sample = try #require(OperatorDraftPowerSample(watts: watts, observedAt: now,
            radioObservedAt: now, amplifierObservedAt: now, receivedAt: now, sessionID: session))
        gate.observe(sourceID: source, sample: sample, frequencyHz: frequency, mode: mode)
    }

    @Test("Contesting background ownership cannot arm or mutate the Normal Logging power draft")
    func contestingOwnership() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("power-contest-owner-\(UUID())")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        defer { workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName) }
        var settings = try service.currentSettings(); settings.automaticTransmitPower = true
        settings.defaultPower = "100"
        _ = try service.saveSettingsForTest(try object(settings))
        let gate = NativeDraftPowerGate(), delivery = NativeDraftPowerDelivery()
        let worker = LiveWorker(logbook: service, powerCapture: gate, powerDelivery: delivery,
            runtimeProfile: .production, operatingModule: .contesting)
        let before = try service.powerOwnerSnapshot().draft
        await worker.startBackgroundServices()
        let source = UUID(), session = UUID()
        gate.select(provider: "direct_agent", selectionID: UUID().uuidString)
        gate.activate(radioID: "radio1", generation: 1)
        gate.attach(sourceID: source, endpointID: "fixture")
        gate.connection(sourceID: source, sequence: 1, sessionID: session,
            startedAt: Date().addingTimeInterval(-1), ready: true)
        try emit(gate, source: source, session: session, watts: 700)
        await worker.drainPowerCapture()
        #expect(try service.powerOwnerSnapshot().draft == before)
        await worker.shutdown()
        gate.connection(sourceID: source, sequence: 2, sessionID: UUID(),
            startedAt: Date(), ready: true)
        try emit(gate, source: source, session: session, watts: 900)
        await worker.drainPowerCapture()
        #expect(try service.powerOwnerSnapshot().draft == before)
    }

    @Test("Native callback burst retains the short peak and Save commits its provenance")
    func peakAndSave() async throws {
        try await fixture { worker, service, gate, source, session, _ in
            let before = try service.powerOwnerSnapshot()
            #expect(before.draft.power?.activeScope != nil)
            try emit(gate, source: source, session: session, watts: 500)
            try emit(gate, source: source, session: session, watts: 125)
            await worker.drainPowerCapture()
            let captured = try service.powerOwnerSnapshot()
            #expect(captured.draft.qso.txPower == "500")
            #expect(captured.draft.revision == before.draft.revision)
            _ = try await request(worker, "logbook_operator_draft_apply", ["generation": captured.workspaceID.uuidString,
                "operationID": UUID().uuidString, "draftID": captured.draft.qso.id.uuidString,
                "expectedRevision": captured.draft.revision, "action": "save"])
            let logged = try service.openedDatabase().lookup(localID: captured.draft.qso.id)
            #expect(logged?.txPower == "500")
            #expect(logged?.extraFields["APP_OM0RXXLOG_POWER_WATTS"] == "500")
            try emit(gate, source: source, session: session, watts: 900)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft.qso.txPower == "100")
        }
    }

    @Test("Wrong observed TX frequency/mode and retired source never capture")
    func radioAssociation() async throws {
        try await fixture { worker, service, gate, source, session, _ in
            try emit(gate, source: source, session: session, watts: 600, frequency: 7_025_000)
            try emit(gate, source: source, session: session, watts: 600, mode: "USB")
            try emit(gate, source: UUID(), session: session, watts: 600)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft.power?.selectedSample == nil)
            try emit(gate, source: source, session: session, watts: 400)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft.qso.txPower == "400")
        }
    }

    @Test("Inactive metadata preserves active capture and explicit routing changes the committed meter")
    func activeRadioCapture() async throws {
        try await fixture { worker, service, gate, source, session, _ in
            let otherSource = UUID(), otherSession = UUID(), selection = UUID().uuidString
            gate.attach(sourceID: otherSource, endpointID: "other-radio", radioID: "radio2")
            gate.connection(sourceID: otherSource, sequence: 1, sessionID: otherSession,
                startedAt: Date().addingTimeInterval(-1), ready: true)
            func metadata(_ sequence: Int, provider: Any, id: Any) async throws {
                _ = try await request(worker, "station_power_selection", ["radio_id": "radio2", "provider": provider,
                    "selection_id": id, "sequence": sequence, "active_radio_id": "radio1", "active_generation": 1])
            }
            try await metadata(1, provider: "direct_agent", id: selection)
            try await metadata(2, provider: NSNull(), id: NSNull())
            try await metadata(3, provider: "direct_agent", id: selection)
            await worker.drainPowerCapture()
            try emit(gate, source: otherSource, session: otherSession, watts: 800)
            try emit(gate, source: source, session: session, watts: 300)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft.qso.txPower == "300")
            _ = try await request(worker, "station_power_selection", ["active_radio_id": NSNull(), "active_generation": 2])
            _ = try await request(worker, "station_power_selection", ["active_radio_id": "radio2", "active_generation": 3])
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft.power?.activeScope?.context.sessionID == otherSession)
            try emit(gate, source: source, session: session, watts: 900)
            try emit(gate, source: otherSource, session: otherSession, watts: 450)
            await worker.drainPowerCapture()
            let captured = try service.powerOwnerSnapshot()
            #expect(captured.draft.qso.txPower == "450")
            _ = try await request(worker, "logbook_operator_draft_apply", ["generation": captured.workspaceID.uuidString,
                "operationID": UUID().uuidString, "draftID": captured.draft.qso.id.uuidString,
                "expectedRevision": captured.draft.revision, "action": "save"])
            #expect(try service.openedDatabase().lookup(localID: captured.draft.qso.id)?.txPower == "450")
        }
    }

    @Test("Manual intent including blank survives callbacks; explicit resume rearms")
    func manual() async throws {
        try await fixture { worker, service, gate, source, session, _ in
            try await replace(worker, service: service, intent: ["action": "manual", "value": ""])
            try emit(gate, source: source, session: session, watts: 500)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft.qso.txPower == "")
            try await replace(worker, service: service, intent: ["action": "automatic"])
            try emit(gate, source: source, session: session, watts: 250)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft.qso.txPower == "250")
        }
    }

    @Test("Provider fence and terminal shutdown retire emission/commit eligibility")
    func lifecycle() async throws {
        try await fixture { worker, service, gate, source, session, _ in
            _ = try await request(worker, "station_power_selection", ["radio_id": "radio1", "provider": NSNull(), "selection_id": NSNull(), "sequence": 2,
                "active_radio_id": "radio1", "active_generation": 1])
            await worker.drainPowerCapture()
            let before = try service.powerOwnerSnapshot()
            try emit(gate, source: source, session: session, watts: 500)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft == before.draft)
            await worker.beginTerminalShutdown()
            gate.connection(sourceID: source, sequence: 99, sessionID: UUID(), startedAt: Date(), ready: true)
            try emit(gate, source: source, session: session, watts: 600)
            await worker.drainPowerCapture()
            #expect(try service.powerOwnerSnapshot().draft == before.draft)
        }
    }

    @Test("Save waits for the already emitted callback prefix")
    func saveAdmission() async throws {
        try await fixture { worker, service, gate, source, session, delivery in
            let blocker = Latch()
            delivery.enqueue { await blocker.wait() }
            while !(await blocker.entered) { await Task.yield() }
            try emit(gate, source: source, session: session, watts: 650)
            let owner = try service.powerOwnerSnapshot()
            let payload = try JSONSerialization.data(withJSONObject: ["id": "save", "method": "logbook_operator_draft_apply",
                "params": ["generation": owner.workspaceID.uuidString, "operationID": UUID().uuidString,
                    "draftID": owner.draft.qso.id.uuidString, "expectedRevision": owner.draft.revision, "action": "save"]])
            let save = Task { await worker.response(to: payload) }
            try await Task.sleep(for: .milliseconds(30))
            #expect(try service.openedDatabase().count() == 0)
            await blocker.release()
            let reply = try JSONSerialization.jsonObject(with: await save.value) as? [String: Any]
            #expect(reply?["ok"] as? Bool == true)
            #expect(try service.openedDatabase().lookup(localID: owner.draft.qso.id)?.txPower == "650")
        }
    }
}
