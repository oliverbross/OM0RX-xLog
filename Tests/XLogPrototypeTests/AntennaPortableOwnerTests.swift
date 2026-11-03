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
}
