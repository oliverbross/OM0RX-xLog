import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Native draft power service and setting migration")
struct LiveDraftPowerServiceTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try #require(JSONSerialization.jsonObject(with: encoder.encode(value)) as? [String: Any])
    }

    private func fixture(_ operation: (LiveLogbookMethods) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("native-power-service-\(UUID())")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer {
            try? service.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        defer { workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName) }
        try operation(service)
    }

    private func saveSettings(_ service: LiveLogbookMethods, enabled: Bool) throws {
        var settings = try service.currentSettings()
        settings.automaticTransmitPower = enabled
        _ = try service.handle(method: "settings_save", params: ["settings": try object(settings)])
    }

    private func replaceParams(_ owner: OperatorDraftPowerOwnerSnapshot, qso: QSO,
                               intent: [String: Any]? = nil) throws -> [String: Any] {
        var params: [String: Any] = ["operationID": UUID().uuidString,
            "draftID": owner.draft.qso.id.uuidString, "expectedRevision": owner.draft.revision,
            "generation": owner.workspaceID.uuidString, "action": "replace", "qso": try object(qso)]
        if let intent { params["powerIntent"] = intent }
        return params
    }

    private func ready(_ service: LiveLogbookMethods) throws -> (OperatorDraftPowerOwnerSnapshot, OperatorDraftPowerContext) {
        let initial = try service.powerOwnerSnapshot()
        try saveSettings(service, enabled: true)
        let configured = try service.configureDraftPower(expectedWorkspaceID: initial.workspaceID)
        var qso = configured.draft.qso; qso.call = "K1ABC"
        _ = try service.handle(method: "logbook_operator_draft_apply", params: replaceParams(configured, qso: qso))
        let typed = try service.powerOwnerSnapshot()
        let context = OperatorDraftPowerContext(providerID: "fixture-station", selectionID: "fixture-selection",
            sessionID: UUID(), sessionStartedAt: now.addingTimeInterval(-1))
        let armed = try service.armDraftPower(context: context, expectedWorkspaceID: typed.workspaceID,
            draftID: typed.draft.qso.id, expectedRevision: typed.draft.revision, now: now)
        return (armed, context)
    }

    private func sample(_ context: OperatorDraftPowerContext) throws -> OperatorDraftPowerSample {
        let time = now.addingTimeInterval(1)
        return try #require(OperatorDraftPowerSample(watts: 500, observedAt: time, radioObservedAt: time,
            amplifierObservedAt: time, receivedAt: time, sessionID: context.sessionID))
    }

    @Test("Missing opt-in decodes OFF and enabled settings round-trip without changing profile fields")
    func settingsMigration() throws {
        #expect(!XLogSettings.defaults.automaticTransmitPower)
        var legacy = try object(XLogSettings.defaults)
        legacy.removeValue(forKey: "automaticTransmitPower")
        legacy["defaultPower"] = "75"
        let decoded = try JSONDecoder().decode(XLogSettings.self, from: JSONSerialization.data(withJSONObject: legacy))
        #expect(!decoded.automaticTransmitPower)
        #expect(decoded.defaultPower == "75")
        var enabled = decoded; enabled.automaticTransmitPower = true
        #expect(try JSONDecoder().decode(XLogSettings.self, from: JSONEncoder().encode(enabled)) == enabled)
        legacy["automaticTransmitPower"] = "true"
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(XLogSettings.self, from: JSONSerialization.data(withJSONObject: legacy))
        }
    }

    @Test("Normal settings and draft reads do not materialize power state; native configuration is explicit")
    func explicitInitialization() throws {
        try fixture { service in
            _ = try service.handle(method: "logbook_operator_draft", params: [:])
            let initial = try service.powerOwnerSnapshot()
            #expect(initial.draft.power == nil)
            #expect(!initial.settings.automaticTransmitPower)
            try saveSettings(service, enabled: true)
            #expect(try service.powerOwnerSnapshot().draft.power == nil)
            let configured = try service.configureDraftPower(expectedWorkspaceID: initial.workspaceID)
            #expect(configured.settings.automaticTransmitPower)
            #expect(configured.draft.power?.enabled == true)
            #expect(configured.draft.power?.activeScope == nil)
            #expect(configured.draft.revision == initial.draft.revision)
            #expect(try service.currentSettings().automaticTransmitPower)
        }
    }

    @Test("Typed native helpers capture and invalidate without advancing contact edits")
    func typedCapture() throws {
        try fixture { service in
            let (armed, context) = try ready(service)
            let scope = try #require(armed.draft.power?.activeScope?.id)
            let captured = try service.captureDraftPower(sample: sample(context), expectedWorkspaceID: armed.workspaceID,
                scopeID: scope, now: now.addingTimeInterval(1))
            #expect(captured.draft.qso.txPower == "500")
            #expect(captured.draft.revision == armed.draft.revision)
            let invalidated = try service.invalidateDraftPower(expectedWorkspaceID: armed.workspaceID)
            #expect(invalidated.draft.power?.activeScope == nil)
            #expect(invalidated.draft.qso.txPower == "500")
            let rejected = try service.captureDraftPower(sample: sample(context), expectedWorkspaceID: armed.workspaceID,
                scopeID: scope, now: now.addingTimeInterval(1))
            #expect(rejected.draft == invalidated.draft)
        }
    }

    @Test("Manual input while automatic is OFF initializes intent atomically and survives later ON")
    func manualBeforeEnabled() throws {
        try fixture { service in
            let initial = try service.powerOwnerSnapshot()
            #expect(initial.draft.power == nil)
            let params = try replaceParams(initial, qso: initial.draft.qso,
                intent: ["action": "manual", "value": ""])
            let response = try service.handle(method: "logbook_operator_draft_apply", params: params)
            #expect(response["status"] as? String == "applied")
            let manual = try service.powerOwnerSnapshot()
            #expect(manual.draft.power?.manualOverride == true)
            #expect(manual.draft.power?.enabled == false)
            #expect(manual.draft.qso.txPower == "")
            try saveSettings(service, enabled: true)
            let enabled = try service.configureDraftPower(expectedWorkspaceID: manual.workspaceID)
            #expect(enabled.draft.power?.manualOverride == true)
            #expect(enabled.draft.qso.txPower == "")
            #expect(enabled.draft.power?.activeScope == nil)
            #expect(try service.handle(method: "logbook_operator_draft_apply", params: params)["status"] as? String == "applied")
        }
    }

    @Test("Every native mutation rechecks the durable generation under the service lock")
    func generationFence() throws {
        try fixture { service in
            let (armed, context) = try ready(service)
            let scope = try #require(armed.draft.power?.activeScope?.id)
            let changed = UUID()
            try JSONEncoder().encode(changed).write(to: service.workspaceDirectoryURL.appendingPathComponent("edit-generation.json"), options: .atomic)
            let operations: [() throws -> OperatorDraftPowerOwnerSnapshot] = [
                { try service.configureDraftPower(expectedWorkspaceID: armed.workspaceID) },
                { try service.armDraftPower(context: context, expectedWorkspaceID: armed.workspaceID,
                    draftID: armed.draft.qso.id, expectedRevision: armed.draft.revision, now: now) },
                { try service.captureDraftPower(sample: sample(context), expectedWorkspaceID: armed.workspaceID,
                    scopeID: scope, now: now.addingTimeInterval(1)) },
                { try service.invalidateDraftPower(expectedWorkspaceID: armed.workspaceID) },
            ]
            for operation in operations {
                do {
                    _ = try operation(); Issue.record("Retired workspace generation was accepted")
                } catch let failure as WorkerFailure { #expect(failure.code == "workspace_changed") }
                #expect(try service.powerOwnerSnapshot().draft == armed.draft)
            }
            #expect(try service.powerOwnerSnapshot().workspaceID == changed)
            // Even a caller carrying the new sidecar identity cannot reuse a
            // token whose canonical power state belongs to the old workspace.
            #expect(throws: WorkerFailure.self) {
                try service.captureDraftPower(sample: sample(context), expectedWorkspaceID: changed,
                    scopeID: scope, now: now.addingTimeInterval(1))
            }
            #expect(try service.powerOwnerSnapshot().draft == armed.draft)
        }
    }

    @Test("Saved OFF blocks native arming and capture before coordinator reconfiguration")
    func disabledSettingFence() throws {
        try fixture { service in
            let (armed, context) = try ready(service)
            let scope = try #require(armed.draft.power?.activeScope?.id)
            try saveSettings(service, enabled: false)
            #expect(throws: WorkerFailure.self) {
                try service.armDraftPower(context: context, expectedWorkspaceID: armed.workspaceID,
                    draftID: armed.draft.qso.id, expectedRevision: armed.draft.revision, now: now)
            }
            let ignored = try service.captureDraftPower(sample: sample(context), expectedWorkspaceID: armed.workspaceID,
                scopeID: scope, now: now.addingTimeInterval(1))
            #expect(ignored.draft == armed.draft)
            #expect(!ignored.settings.automaticTransmitPower)
            let configured = try service.configureDraftPower(expectedWorkspaceID: armed.workspaceID)
            #expect(configured.draft.power?.enabled == false)
            #expect(configured.draft.power?.activeScope == nil)
        }
    }

    @Test("Manual intent including same and empty values is durable and retryable; resume is explicit")
    func ipcIntent() throws {
        try fixture { service in
            var (owner, _) = try ready(service)
            for value in ["100", ""] {
                let params = try replaceParams(owner, qso: owner.draft.qso, intent: ["action": "manual", "value": value])
                let receipt = try service.handle(method: "logbook_operator_draft_apply", params: params)
                let repeated = try service.handle(method: "logbook_operator_draft_apply", params: params)
                #expect(try JSONSerialization.data(withJSONObject: receipt, options: .sortedKeys)
                    == JSONSerialization.data(withJSONObject: repeated, options: .sortedKeys))
                owner = try service.powerOwnerSnapshot()
                #expect(owner.draft.power?.manualOverride == true)
                #expect(owner.draft.qso.txPower == value)
                #expect(owner.draft.power?.activeScope == nil)
            }
            _ = try service.handle(method: "logbook_operator_draft_apply", params: replaceParams(owner,
                qso: owner.draft.qso, intent: ["action": "automatic"]))
            let automatic = try service.powerOwnerSnapshot()
            #expect(automatic.draft.power?.manualOverride == false)
            #expect(automatic.draft.qso.txPower == "100")
            #expect(automatic.draft.power?.activeScope == nil)
        }
    }

    @Test("IPC rejects null malformed fabricated metadata and intent on Save/Clear without a write")
    func strictIntent() throws {
        try fixture { service in
            let (owner, _) = try ready(service)
            let invalid: [Any] = [NSNull(), true, "manual", [:], ["action": "other"],
                ["action": "manual"], ["action": "manual", "value": NSNull()],
                ["action": "manual", "value": 100], ["action": "manual", "value": "x\0y"],
                ["action": "manual", "value": String(repeating: "x", count: 344)],
                ["action": "manual", "value": "100", "source": "kpa500_output"],
                ["action": "automatic", "value": NSNull()], ["action": "automatic", "value": "100"],
                ["action": "automatic", "scopeID": UUID().uuidString]]
            for intent in invalid {
                var params = try replaceParams(owner, qso: owner.draft.qso); params["powerIntent"] = intent
                #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_operator_draft_apply", params: params) }
                #expect(try service.powerOwnerSnapshot().draft == owner.draft)
            }
            for action in ["save", "clear"] {
                var params = try replaceParams(owner, qso: owner.draft.qso, intent: ["action": "automatic"])
                params["action"] = action; params.removeValue(forKey: "qso")
                #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_operator_draft_apply", params: params) }
                #expect(try service.powerOwnerSnapshot().draft == owner.draft)
            }
        }
    }
}
