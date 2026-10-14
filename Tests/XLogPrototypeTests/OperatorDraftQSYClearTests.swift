import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Native Clear after QSY draft transaction")
struct OperatorDraftQSYClearTests {
    private func fixture() throws -> (LiveLogbookMethods, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("qsy-clear-\(UUID().uuidString)")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        return (service, root)
    }

    private func draft(_ service: LiveLogbookMethods) throws -> [String: Any] {
        try #require(service.handle(method: "logbook_operator_draft", params: [:])["draft"] as? [String: Any])
    }

    private func clear(_ service: LiveLogbookMethods, snapshot: [String: Any], operationID: UUID = UUID(),
                       frequency: Int = 14_200_000, mode: String = "USB") throws -> [String: Any] {
        try service.handle(method: "logbook_operator_draft_qsy_clear", params: [
            "operationID": operationID.uuidString,
            "draftID": try #require(snapshot["qso"] as? [String: Any])["id"]!,
            "expectedRevision": snapshot["revision"]!,
            "generation": snapshot["generation"]!,
            "receiveFrequencyHz": frequency,
            "observedMode": mode,
        ])
    }

    @Test("Legacy and fresh settings keep QSY clearing disabled")
    func disabledByDefault() throws {
        let encoded = try JSONEncoder().encode(XLogSettings.defaults)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object.removeValue(forKey: "clearAfterQSY")
        let legacy = try JSONDecoder().decode(XLogSettings.self,
            from: JSONSerialization.data(withJSONObject: object))
        #expect(legacy.clearAfterQSY == false)
        #expect(XLogSettings.defaults.clearAfterQSY == false)

        let (service, root) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let before = try draft(service)
        #expect(try clear(service, snapshot: before)["status"] as? String == "disabled")
        let after = try draft(service)
        #expect(after["revision"] as? Int == before["revision"] as? Int)
        #expect((after["qso"] as? [String: Any])?["id"] as? String == (before["qso"] as? [String: Any])?["id"] as? String)
    }

    @Test("Exact observed-RX clear is atomic, idempotent and revision fenced")
    func appliedReplayAndConflict() throws {
        let (service, root) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        var settings = try #require(service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        settings["clearAfterQSY"] = true
        _ = try service.saveSettingsForTest(settings)

        let before = try draft(service)
        let operationID = UUID()
        let first = try clear(service, snapshot: before, operationID: operationID,
                              frequency: 14_200_000, mode: "USB")
        let replay = try clear(service, snapshot: before, operationID: operationID,
                               frequency: 14_200_000, mode: "USB")
        #expect(first["status"] as? String == "applied")
        #expect(try JSONSerialization.data(withJSONObject: first["receipt"]!, options: .sortedKeys)
            == JSONSerialization.data(withJSONObject: replay["receipt"]!, options: .sortedKeys))
        let current = try draft(service), qso = try #require(current["qso"] as? [String: Any])
        #expect(qso["call"] as? String == "")
        #expect((qso["frequencyHz"] as? NSNumber)?.int64Value == 14_200_000)
        #expect(qso["band"] as? String == "20m")
        #expect(qso["mode"] as? String == "SSB")

        let conflict = try clear(service, snapshot: before, frequency: 14_230_000, mode: "USB")
        #expect(conflict["status"] as? String == "conflict")
        #expect((try draft(service)["qso"] as? [String: Any])?["frequencyHz"] as? Int == 14_200_000)

        var disabled = try #require(service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        disabled["clearAfterQSY"] = false
        _ = try service.saveSettingsForTest(disabled)
        let replayAfterDisable = try clear(service, snapshot: before, operationID: operationID,
                                           frequency: 14_200_000, mode: "USB")
        #expect(try JSONSerialization.data(withJSONObject: first["receipt"]!, options: .sortedKeys)
            == JSONSerialization.data(withJSONObject: replayAfterDisable["receipt"]!, options: .sortedKeys))
    }

    @Test("The native boundary accepts RX evidence only, never a split TX frequency")
    func rejectsTransmitFrequency() throws {
        let (service, root) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        var settings = try #require(service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        settings["clearAfterQSY"] = true
        _ = try service.saveSettingsForTest(settings)
        let snapshot = try draft(service)
        var params: [String: Any] = [
            "operationID": UUID().uuidString,
            "draftID": try #require(snapshot["qso"] as? [String: Any])["id"]!,
            "expectedRevision": snapshot["revision"]!, "generation": snapshot["generation"]!,
            "receiveFrequencyHz": 14_200_000, "observedMode": "USB",
            "transmitFrequencyHz": 14_230_000,
        ]
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "logbook_operator_draft_qsy_clear", params: params)
        }
        params.removeValue(forKey: "transmitFrequencyHz")
        #expect(try service.handle(method: "logbook_operator_draft_qsy_clear", params: params)["status"] as? String == "applied")
    }
}
