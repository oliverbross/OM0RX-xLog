import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Canonical antenna and portable owner lifecycle")
struct AntennaPortableOwnerTests {
    private func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try #require(try JSONSerialization.jsonObject(with: encoder.encode(value)) as? [String: Any])
    }
    @Test func metadataOnlyTXSelectionAndOperatorIntent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var settings = try service.currentSettings()
        settings.stationEquipment.profiles = [AntennaProfile(id: "twenty", name: "20m beam", bands: ["20m"]), AntennaProfile(id: "ten", name: "10m beam", bands: ["10m"])]
        settings.stationEquipment.selectedProfileID = "twenty"; settings.stationEquipment.automaticSelection = true
        _ = try service.saveSettingsForTest(object(settings))
        let db = try service.openedDatabase()
        let first = try service.handle(method: "logbook_operator_draft", params: [:])
        let generation = try #require((first["draft"] as? [String: Any])?["generation"] as? String)
        let initial = try #require(try db.operatorDraft())
        let operation = UUID()
        let params: [String: Any] = ["operationID": operation.uuidString, "draftID": initial.qso.id.uuidString,
            "expectedRevision": initial.revision, "generation": generation, "frequencyHz": 28_015_000]
        let result = try service.handle(method: "logbook_operator_draft_antenna_follow", params: params)
        #expect(result["status"] as? String == "applied")
        let applied = try #require(try db.operatorDraft())
        #expect(applied.operatingDefaultsMutable)
        #expect(applied.qso.frequencyHz == initial.qso.frequencyHz)
        #expect(applied.qso.receiveFrequencyHz == initial.qso.receiveFrequencyHz)
        #expect(applied.qso.band == initial.qso.band && applied.qso.mode == initial.qso.mode)
        #expect(applied.qso.start == initial.qso.start)
        #expect(applied.qso.extraFields["APP_OM0RXXLOG_ANTENNA_ID"] == "ten")
        #expect(try db.count() == 0)
        _ = try service.handle(method: "logbook_operator_draft_antenna_follow", params: params)
        #expect(try db.operatorDraft() == applied)
        // A notes-only edit is operator activity even without a callsign.
        var noted = applied.qso; noted.notes = "retain unfinished operator text"
        let edit = OperatorDraftMutation(operationID: UUID(), draftID: noted.id, expectedRevision: applied.revision, action: .replace, qso: noted)
        _ = try db.applyOperatorDraft(edit, nextDraft: noted)
        let protected = try #require(try db.operatorDraft())
        #expect(!protected.operatingDefaultsMutable)
        let denied = try service.handle(method: "logbook_operator_draft_antenna_follow", params: ["operationID": UUID().uuidString,
            "draftID": noted.id.uuidString, "expectedRevision": protected.revision, "generation": generation, "frequencyHz": 14_025_000])
        #expect(denied["status"] as? String == "unchanged")
        #expect(try db.operatorDraft() == protected)
    }
    @Test func portableSettingsDoNotRewriteDraftAndPersistRestart() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        _ = try service.handle(method: "logbook_operator_draft", params: [:])
        let db = try service.openedDatabase(), initial = try #require(try db.operatorDraft())
        var qso = initial.qso; qso.call = "K1ABC"; qso.comment = "typed before portable start"
        _ = try db.applyOperatorDraft(OperatorDraftMutation(operationID: UUID(), draftID: qso.id, expectedRevision: initial.revision, action: .replace, qso: qso), nextDraft: qso)
        let retained = try #require(try db.operatorDraft())
        var settings = try service.currentSettings()
        let preset = PortablePreset(name: "Portable", stationCall: "VK8RX/P", operatorCall: "VK8RX", locator: "PH57", ownReferences: ["POTA": ["AU-0001", "AU-0002"]])
        settings.portableOperating.presets = [preset]; settings.portableOperating.activeContext = PortableActiveContext(preset: preset, startedAt: Date(timeIntervalSince1970: 1_793_606_400))
        _ = try service.saveSettingsForTest(object(settings))
        #expect(try db.operatorDraft() == retained)
        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        #expect(try reopened.currentSettings().portableOperating == settings.portableOperating)
        _ = try reopened.handle(method: "logbook_operator_draft", params: [:])
        #expect(try reopened.openedDatabase().operatorDraft() == retained)
        settings.portableOperating.activeContext = nil
        _ = try service.saveSettingsForTest(object(settings))
        #expect(try db.operatorDraft() == retained)
    }
    @Test func capturedPortablePowerSurvivesExistingPowerStateAndContextEnd() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var settings = try service.currentSettings(); settings.defaultPower = "100"; settings.automaticTransmitPower = true
        _ = try service.saveSettingsForTest(object(settings))
        let owner = try service.powerOwnerSnapshot()
        let home = try service.configureDraftPower(expectedWorkspaceID: owner.workspaceID)
        #expect(home.draft.qso.txPower == "100")
        settings.portableOperating.activeContext = PortableActiveContext(preset: PortablePreset(name: "QRP park", power: "10"), startedAt: Date(timeIntervalSince1970: 1_793_606_400))
        _ = try service.saveSettingsForTest(object(settings))
        let unchanged = try service.configureDraftPower(expectedWorkspaceID: owner.workspaceID)
        #expect(unchanged.draft.qso.txPower == "100")
        let db = try service.openedDatabase()
        let seed = settings.applyingOperatingDefaults(to: QSO(call: "", band: "20m", mode: "CW", txPower: settings.defaultPower))
        let clear = OperatorDraftMutation(operationID: UUID(), draftID: unchanged.draft.qso.id, expectedRevision: unchanged.draft.revision, action: .clear)
        let portable = try db.applyOperatorDraft(clear, nextDraft: seed)
        #expect(portable.draft.qso.txPower == "10"); #expect(portable.draft.power?.fallback == "10")
        #expect(try service.configureDraftPower(expectedWorkspaceID: owner.workspaceID).draft.qso.txPower == "10")
        settings.portableOperating.activeContext = nil
        _ = try service.saveSettingsForTest(object(settings))
        let retained = try service.configureDraftPower(expectedWorkspaceID: owner.workspaceID)
        #expect(retained.draft.qso.txPower == "10")
        let end = OperatorDraftMutation(operationID: UUID(), draftID: retained.draft.qso.id, expectedRevision: retained.draft.revision, action: .clear)
        let homeAgain = try db.applyOperatorDraft(end, nextDraft: QSO(call: "", band: "20m", mode: "CW", txPower: "100"))
        #expect(homeAgain.draft.qso.txPower == "100"); #expect(homeAgain.draft.power?.fallback == "100")
        #expect(try db.count() == 0)
    }
    @Test func settingsBackupRestoresStableProfilesAndPortableContextWithoutRetaggingContacts() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var original = try service.currentSettings()
        let profile = AntennaProfile(id: "portable-beam", name: "Captured beam", bands: ["20m"],
            rotorConfigurationID: AntennaProfile.workspaceRotorID, azimuthOffsetDegrees: 35, revision: 7)
        original.stationEquipment.profiles = [profile]
        original.stationEquipment.selectedProfileID = profile.id
        let preset = PortablePreset(id: "park-preset", name: "Captured park", stationCall: "VK8RX/P",
            operatorCall: "VK8RX", locator: "PH57", location: "Northern Territory", state: "AU-NT",
            ownReferences: ["POTA": ["AU-0001"]], power: "10", antennaProfileID: profile.id, ownDXCC: 150)
        original.portableOperating.presets = [preset]
        original.portableOperating.activeContext = PortableActiveContext(preset: preset, sessionID: "park-session",
            revision: 3, startedAt: Date(timeIntervalSince1970: 1_793_606_400))
        _ = try service.saveSettingsForTest(object(original))
        _ = try service.handle(method: "logbook_operator_draft", params: [:])
        let db = try service.openedDatabase(), initial = try #require(try db.operatorDraft())
        var contact = initial.qso; contact.call = "K1ABC"
        let replaced = try db.applyOperatorDraft(OperatorDraftMutation(operationID: UUID(), draftID: contact.id,
            expectedRevision: initial.revision, action: .replace, qso: contact), nextDraft: contact)
        let seed = original.applyingOperatingDefaults(to: QSO(call: "", band: "20m", mode: "CW"))
        let receipt = try db.applyOperatorDraft(OperatorDraftMutation(operationID: UUID(), draftID: contact.id,
            expectedRevision: replaced.draft.revision, action: .save), nextDraft: seed)
        let capturedContact = try #require(receipt.savedQSO), capturedDraft = receipt.draft
        #expect(capturedContact.extraFields["MY_DXCC"] == "150")
        #expect(capturedContact.extraFields["APP_OM0RXXLOG_ANTENNA_REVISION"] == "7")
        var preferences = try #require(service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        preferences["deskBandMapBands"] = ["20m", "17m"]
        _ = try saveWorkspacePreferences(service, preferences)
        let backup = try service.handle(method: "backup_create", params: ["name": "portable-context"])
        let backupName = try #require(backup["name"] as? String)

        var changed = original
        changed.stationEquipment.profiles[0].name = "Later archived beam"
        changed.stationEquipment.profiles[0].azimuthOffsetDegrees = -80
        changed.stationEquipment.profiles[0].revision = 8
        changed.stationEquipment.profiles[0].archived = true
        changed.stationEquipment.selectedProfileID = nil
        changed.portableOperating.presets[0].ownDXCC = 291
        changed.portableOperating.activeContext = nil
        _ = try service.saveSettingsForTest(object(changed))
        preferences["deskBandMapBands"] = ["10m"]
        _ = try saveWorkspacePreferences(service, preferences)
        #expect(try service.currentSettings().portableOperating.activeContext == nil)
        #expect(try db.operatorDraft() == capturedDraft)
        #expect(try db.fetchAll() == [capturedContact])
        let restored = try service.handle(method: "backup_restore", params: ["name": backupName,
            "confirm_restore": true, "restore_settings": true, "restore_preferences": true])
        #expect(restored["preferences_restored"] as? Bool == true)

        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let restoredSettings = try reopened.currentSettings()
        #expect(restoredSettings.stationEquipment == original.stationEquipment)
        #expect(restoredSettings.portableOperating == original.portableOperating)
        #expect(restoredSettings.portableOperating.activeContext?.preset.ownDXCC == 150)
        let restoredPreferences = try #require(reopened.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        #expect(restoredPreferences["deskBandMapBands"] as? [String] == ["20m", "17m"])
        _ = try reopened.handle(method: "logbook_operator_draft", params: [:])
        #expect(try reopened.openedDatabase().operatorDraft() == capturedDraft)
        #expect(try reopened.openedDatabase().fetchAll() == [capturedContact])
    }
}
