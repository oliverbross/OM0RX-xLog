import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Workspace edit generations survive restore")
struct WorkspaceEditGenerationTests {
    private func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("edit-generation-\(UUID().uuidString)") }
    private func service(_ root: URL) throws -> LiveLogbookMethods {
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        return service
    }
    private func draft(_ service: LiveLogbookMethods) throws -> [String: Any] {
        try #require(service.handle(method: "logbook_operator_draft", params: [:])["draft"] as? [String: Any])
    }
    private func mutation(_ draft: [String: Any], action: String) throws -> [String: Any] {
        let qso = try #require(draft["qso"] as? [String: Any])
        return ["generation": draft["generation"]!, "operationID": UUID().uuidString,
                "draftID": qso["id"]!, "expectedRevision": draft["revision"]!, "action": action]
    }
    private func backup(_ service: LiveLogbookMethods) throws -> String {
        try #require(service.handle(method: "backup_create", params: ["name": "baseline"])["name"] as? String)
    }
    private func restore(_ service: LiveLogbookMethods, name: String) throws {
        _ = try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
                                                               "restore_settings": false, "restore_reference_data": false])
    }

    @Test("Normal service restart retains its generation; missing or invalid client identity is rejected")
    func restartAndValidation() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let first = try service(root), original = try draft(first)
        try first.openedDatabase().close()
        let second = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? second.openedDatabase().close() }
        #expect(try draft(second)["generation"] as? String == original["generation"] as? String)
        var request = try mutation(original, action: "clear")
        for value: Any in [NSNull(), "invalid", true] {
            request["generation"] = value
            #expect(throws: Error.self) { try second.handle(method: "logbook_operator_draft_apply", params: request) }
        }
        request.removeValue(forKey: "generation")
        #expect(throws: Error.self) { try second.handle(method: "logbook_operator_draft_apply", params: request) }
        request["generation"] = (original["generation"] as? String)?.uppercased()
        #expect(try second.handle(method: "logbook_operator_draft_apply", params: request)["status"] as? String == "applied")
    }

    @Test("Restore fences old draft operations even when the database ID and revision are identical")
    func identicalDraftAfterRestore() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = try service(root); defer { try? service.openedDatabase().close() }
        let original = try draft(service), request = try mutation(original, action: "clear"), name = try backup(service)
        #expect(!FileManager.default.fileExists(atPath: service.workspaceDirectoryURL.appendingPathComponent("Backups/\(name)/edit-generation.json").path))
        try restore(service, name: name)
        let current = try draft(service)
        #expect(current["revision"] as? Int == original["revision"] as? Int)
        #expect(current["generation"] as? String != original["generation"] as? String)
        #expect(try service.handle(method: "logbook_operator_draft_apply", params: request)["status"] as? String == "workspace_changed")
        #expect(try service.handle(method: "logbook_operator_draft_receipt", params: ["operationID": request["operationID"]!, "generation": request["generation"]!])["status"] as? String == "workspace_changed")
        #expect(try service.handle(method: "logbook_operator_draft_apply", params: mutation(current, action: "clear"))["status"] as? String == "applied")
        try service.openedDatabase().close()
        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? reopened.openedDatabase().close() }
        #expect(try draft(reopened)["generation"] as? String == current["generation"] as? String)
        #expect(try reopened.handle(method: "logbook_operator_draft_apply", params: request)["status"] as? String == "workspace_changed")
    }

    @Test("Lost Save acknowledgement cannot resurrect a contact removed by restoring an older backup")
    func lostSaveAcrossRestore() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = try service(root); defer { try? service.openedDatabase().close() }
        let blank = try draft(service)
        var qso = try #require(blank["qso"] as? [String: Any]); qso["call"] = "K1ABC"
        var replace = try mutation(blank, action: "replace"); replace["qso"] = qso
        _ = try service.handle(method: "logbook_operator_draft_apply", params: replace)
        let ready = try draft(service), name = try backup(service), save = try mutation(ready, action: "save")
        _ = try service.handle(method: "logbook_operator_draft_apply", params: save)
        #expect(try service.openedDatabase().count() == 1)
        try restore(service, name: name)
        #expect(try service.openedDatabase().count() == 0)
        #expect(try service.handle(method: "logbook_operator_draft_apply", params: save)["status"] as? String == "workspace_changed")
        #expect(try service.openedDatabase().count() == 0)
    }

    @Test("Existing-contact updates and receipts are scoped even when their receipt exists in the restored backup")
    func contactReceiptInBackup() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = try service(root); defer { try? service.openedDatabase().close() }
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try service.openedDatabase().save(qso)
        let initial = try #require(service.handle(method: "logbook_contact", params: ["contactID": qso.id.uuidString])["contact"] as? [String: Any])
        var edited = try #require(initial["qso"] as? [String: Any]); edited["comment"] = "Before backup"
        let update: [String: Any] = ["generation": initial["generation"]!, "operationID": UUID().uuidString,
            "contactID": qso.id.uuidString, "expectedRevision": initial["revision"]!, "action": "update", "qso": edited]
        _ = try service.handle(method: "logbook_contact_apply", params: update)
        let name = try backup(service); try restore(service, name: name)
        #expect(try service.handle(method: "logbook_contact_apply", params: update)["status"] as? String == "workspace_changed")
        #expect(try service.handle(method: "logbook_contact_receipt", params: ["generation": update["generation"]!, "operationID": update["operationID"]!])["status"] as? String == "workspace_changed")
        #expect(try service.openedDatabase().lookup(localID: qso.id)?.comment == "Before backup")
    }

    @Test("Invalid restore leaves the generation unchanged; invalid sidecar fails before database replacement")
    func invalidRestoreAndSidecar() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = try service(root); defer { try? service.openedDatabase().close() }
        let original = try draft(service), name = try backup(service)
        #expect(throws: Error.self) { try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": false]) }
        #expect(try draft(service)["generation"] as? String == original["generation"] as? String)
        try service.openedDatabase().save(QSO(call: "K1ABC", band: "20m", mode: "CW"))
        let sidecar = service.workspaceDirectoryURL.appendingPathComponent("edit-generation.json")
        try Data("corrupt".utf8).write(to: sidecar)
        #expect(throws: Error.self) { try restore(service, name: name) }
        #expect(try service.openedDatabase().count() == 1)
        #expect(throws: Error.self) { try draft(service) }
    }
}
