import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Native explicit Read Radio draft transaction")
struct OperatorDraftRadioReadTests {
    private func fixture() throws -> (LiveLogbookMethods, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("radio-read-\(UUID().uuidString)")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        return (service, root)
    }
    private func draft(_ service: LiveLogbookMethods) throws -> [String: Any] {
        try #require(service.handle(method: "logbook_operator_draft", params: [:])["draft"] as? [String: Any])
    }
    private func params(_ snapshot: [String: Any], operation: UUID = UUID(), frequency: Int = 7_150_000,
                        mode: String = "LSB") throws -> [String: Any] {
        ["operationID": operation.uuidString, "draftID": try #require(snapshot["qso"] as? [String: Any])["id"]!,
         "expectedRevision": snapshot["revision"]!, "generation": snapshot["generation"]!,
         "frequencyHz": frequency, "observedMode": mode]
    }
    private func replace(_ service: LiveLogbookMethods, _ snapshot: [String: Any], _ qso: [String: Any], manualPower: String? = nil) throws {
        var request = try params(snapshot)
        request.removeValue(forKey: "frequencyHz"); request.removeValue(forKey: "observedMode")
        request["action"] = "replace"; request["qso"] = qso
        if let manualPower { request["powerIntent"] = ["action": "manual", "value": manualPower] }
        _ = try service.handle(method: "logbook_operator_draft_apply", params: request)
    }
    private func bytes(_ value: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: .sortedKeys)
    }

    @Test("Read and Follow change only projected fields and retain manual power policy",
          arguments: ["logbook_operator_draft_radio_read", "logbook_operator_draft_radio_follow"])
    func projectionAndPower(method: String) throws {
        let (service, root) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let initial = try draft(service)
        var qso = try #require(initial["qso"] as? [String: Any])
        qso["call"] = "K1ABC"; qso["comment"] = "Keep operator text"; qso["notes"] = "Keep notes"
        qso["mode"] = "FT4"; qso["txPower"] = "37.125"
        try replace(service, initial, qso, manualPower: "37.125")
        let before = try draft(service)
        let result = try service.handle(method: method, params: params(before, mode: "DIGU"))
        #expect(result["status"] as? String == "applied")
        let after = try draft(service)
        var expected = try #require(before["qso"] as? [String: Any])
        expected["frequencyHz"] = 7_150_000; expected["band"] = "40m"; expected["mode"] = "FT4"
        #expect(try bytes(after["qso"]!) == bytes(expected))
        let powerBefore = try #require(before["power"] as? [String: Any])
        let powerAfter = try #require(after["power"] as? [String: Any])
        #expect(powerAfter["manualOverride"] as? Bool == true)
        #expect(powerAfter["selectedValue"] as? String == "37.125")
        #expect(powerAfter["enabled"] as? Bool == powerBefore["enabled"] as? Bool)
        #expect(powerAfter["fallback"] as? String == powerBefore["fallback"] as? String)
        #expect(try service.openedDatabase().count() == 0)
    }

    @Test("Read and Follow receipts survive later edits, stale revisions conflict and changed reuse fails",
          arguments: ["logbook_operator_draft_radio_read", "logbook_operator_draft_radio_follow"])
    func receiptsAndConflict(method: String) throws {
        let (service, root) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let before = try draft(service), operation = UUID()
        let request = try params(before, operation: operation)
        let first = try service.handle(method: method, params: request)
        let current = try draft(service)
        var edited = try #require(current["qso"] as? [String: Any]); edited["comment"] = "Newer text"
        try replace(service, current, edited)
        let latest = try draft(service)
        #expect(try bytes(service.handle(method: method, params: request)) == bytes(first))
        #expect(try bytes(draft(service)) == bytes(latest))
        let receipt = try service.handle(method: "logbook_operator_draft_receipt", params: ["operationID": operation.uuidString, "generation": before["generation"]!])
        #expect(try bytes(receipt["receipt"]!) == bytes(first["receipt"]!))
        #expect(try service.handle(method: method, params: params(before))["status"] as? String == "conflict")
        for key in ["frequencyHz", "observedMode", "draftID", "expectedRevision"] {
            var changed = request
            switch key {
            case "frequencyHz": changed[key] = 14_200_000
            case "observedMode": changed[key] = "CW"
            case "draftID": changed[key] = UUID().uuidString
            default: changed[key] = 99
            }
            #expect(throws: WorkerFailure.self) { try service.handle(method: method, params: changed) }
        }
        try service.openedDatabase().close()
        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? reopened.openedDatabase().close() }
        #expect(try bytes(reopened.handle(method: method, params: request)) == bytes(first))
        #expect(try bytes(draft(reopened)) == bytes(latest))
    }

    @Test("Read and Follow workspace, schema and observation validation cannot alter the draft",
          arguments: ["logbook_operator_draft_radio_read", "logbook_operator_draft_radio_follow"])
    func rejectsInvalidEvidence(method: String) throws {
        let (service, root) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let before = try draft(service), request = try params(before)
        var old = request; old["generation"] = UUID().uuidString
        #expect(try service.handle(method: method, params: old)["status"] as? String == "workspace_changed")
        for (key, value): (String, Any) in [("frequencyHz", 0), ("frequencyHz", 1_000_000_000_001), ("observedMode", "CW;TX"), ("observedMode", ""), ("qso", [:])] {
            var invalid = request; invalid[key] = value
            #expect(throws: WorkerFailure.self) { try service.handle(method: method, params: invalid) }
        }
        #expect(try bytes(draft(service)) == bytes(before))
    }

    @Test("Identical Follow observations do not create draft revisions or receipts")
    func unchangedFollow() throws {
        let (service, root) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let initial = try draft(service)
        _ = try service.handle(method: "logbook_operator_draft_radio_follow", params: params(initial))
        let before = try draft(service), operation = UUID()
        let result = try service.handle(method: "logbook_operator_draft_radio_follow", params: params(before, operation: operation))
        #expect(result["status"] as? String == "unchanged")
        #expect(try bytes(draft(service)) == bytes(before))
        let receipt = try service.handle(method: "logbook_operator_draft_receipt", params: ["operationID": operation.uuidString, "generation": before["generation"]!])
        #expect(receipt["receipt"] is NSNull)
    }
}
