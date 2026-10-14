import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Reviewed ADIF transfer")
struct ADIFTransferTests {
    @Test("Preview rejects malformed input and reports duplicates without writes")
    func preview() throws {
        try fixture { service, db in
            let qso = QSO(call: "W1AW", band: "20m", mode: "CW")
            try db.save(qso)
            let original = try db.fetchAll(), outbox = try db.outboxEntries()
            let preview = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": qso.adifRecord.adifDocument])
            #expect(preview["duplicates"] as? Int == 1)
            #expect(preview["inserts"] as? Int == 0)
            let invalid = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": "<CALL:4>W1AW<EOR>"])
            #expect(!(invalid["issues"] as? [[String: Any]] ?? []).isEmpty)
            #expect(try db.fetchAll() == original)
            #expect(try db.outboxEntries() == outbox)
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: ["text": "<CALL:4>W1AW<EOR>"]) }
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: ["text": qso.adifRecord.adifDocument, "generation": "stale-workspace"]) }
        }
    }

    @Test("All, filtered and selected exports freeze content and reject stale tokens")
    func exportScopes() throws {
        try fixture { service, db in
            let first = QSO(call: "W1AW", band: "20m", mode: "CW")
            let second = QSO(call: "K1ABC", band: "40m", mode: "SSB")
            try db.save(first); try db.save(second)
            let all = try service.handle(method: "logbook_export_adif", params: ["action": "begin", "scope": "all"])
            #expect(all["total"] as? Int == 2)
            try db.softDelete(first)
            let frozen = try service.handle(method: "logbook_export_adif", params: ["action": "read", "token": all["token"]!])
            #expect(frozen["count"] as? Int == 2)
            #expect((frozen["text"] as? String)?.contains("W1AW") == true)
            let roundTrip = ADIFImportPreview(text: frozen["text"] as? String ?? "")
            #expect(roundTrip.issues.isEmpty)
            #expect(roundTrip.records.count == 2)
            let pageOne = try service.handle(method: "logbook_export_adif", params: ["action": "read", "token": all["token"]!, "limit": 1])
            let pageTwo = try service.handle(method: "logbook_export_adif", params: ["action": "read", "token": all["token"]!, "offset": 1, "limit": 1])
            let paged = ADIFImportPreview(text: (pageOne["text"] as? String ?? "") + (pageTwo["text"] as? String ?? ""))
            #expect(paged.issues.isEmpty)
            #expect(paged.records.count == 2)
            let filtered = try service.handle(method: "logbook_export_adif", params: ["action": "begin", "scope": "filtered", "search": "K1ABC"])
            #expect(filtered["total"] as? Int == 1)
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_export_adif", params: ["action": "read", "token": all["token"]!]) }
            let selected = try service.handle(method: "logbook_export_adif", params: ["action": "begin", "scope": "selected", "ids": [second.id.uuidString]])
            #expect(selected["total"] as? Int == 1)
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_export_adif", params: ["action": "begin", "scope": "selected", "ids": [first.id.uuidString]]) }
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_export_adif", params: ["action": "begin", "scope": "all", "search": "W1AW"]) }
        }
    }

    @Test("Preview indexes one frozen contact view across chunks and fences token context and order")
    func previewSession() throws {
        try fixture { service, db in
            let first = QSO(call: "W1AW", band: "20m", mode: "CW")
            let later = QSO(call: "K1ABC", band: "40m", mode: "CW")
            try db.save(first)
            let start = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": first.adifRecord.adifDocument, "chunk": 0])
            #expect(start["duplicates"] as? Int == 1)
            try db.save(later)
            let context: [String: Any] = ["action": "preview", "token": start["token"]!, "generation": start["generation"]!, "chunk": 1]
            let next = try service.handle(method: "logbook_import_adif", params: context.merging(["text": later.adifRecord.adifDocument]) { _, v in v })
            // The new database row is intentionally absent from the preview snapshot.
            #expect(next["inserts"] as? Int == 1)
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: context.merging(["text": later.adifRecord.adifDocument]) { _, v in v }) }
            let repeated = try service.handle(method: "logbook_import_adif", params: context.merging(["text": later.adifRecord.adifDocument, "chunk": 2]) { _, v in v })
            #expect(repeated["duplicates"] as? Int == 1)
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: context.merging(["text": later.adifRecord.adifDocument, "generation": "stale", "chunk": 3]) { _, v in v }) }
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: context.merging(["text": later.adifRecord.adifDocument, "token": UUID().uuidString, "chunk": 3]) { _, v in v }) }
            let applied = try service.handle(method: "logbook_import_adif", params: ["text": later.adifRecord.adifDocument, "generation": start["generation"]!])
            #expect(applied["imported"] as? Int == 0)
            #expect(applied["skipped_duplicates"] as? Int == 1)
        }
    }

    private func fixture(_ body: (LiveLogbookMethods, LogbookDatabase) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-adif-transfer-" + UUID().uuidString)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let db = try service.openedDatabase()
        defer {
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL) {
                workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            db.close(); try? FileManager.default.removeItem(at: root)
        }
        try body(service, db)
    }

    @Test("Selected updates preserve unrelated fields and mapping, create ordinary pending edits and replay safely")
    func selectedUpdates() throws {
        try fixture { service, db in
            var original = QSO(wavelogID: 42, call: "W1AW", band: "20m", mode: "CW", name: "Old", comment: "Keep", extraFields: ["APP_OTHER": "opaque"])
            original.notes = "Clear me"
            try db.save(original, markDirty: false)
            var incoming = original.adifRecord.fields
            incoming["NAME"] = "New"; incoming["NOTES"] = ""; incoming["COMMENT"] = "Not selected"
            incoming["QSL_RCVD"] = "Y"; incoming["POTA_REF"] = "US-0001"; incoming["APP_OTHER"] = "discard"
            let preview = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": ADIFRecord(fields: incoming).adifDocument])
            let command: [String: Any] = ["action": "update", "token": preview["token"]!, "generation": preview["generation"]!, "chunk": 0,
                "fields": ["NAME", "NOTES", "QSL_RCVD", "POTA_REF"], "confirmed": true]
            #expect(try db.pending().isEmpty)
            #expect(try service.handle(method: "logbook_import_adif", params: command)["updated"] as? Int == 1)
            let saved = try #require(try db.lookup(localID: original.id))
            #expect(saved.name == "New" && saved.notes.isEmpty && saved.comment == "Keep")
            #expect(saved.qslReceived == "Y" && saved.potaReference == "US-0001")
            #expect(saved.wavelogID == 42 && saved.extraFields == original.extraFields && saved.isDirty)
            #expect(try db.pending().count == 1)
            let revision = try db.contactSnapshot(localID: original.id)?.revision
            #expect(try service.handle(method: "logbook_import_adif", params: command)["updated"] as? Int == 1)
            #expect(try db.contactSnapshot(localID: original.id)?.revision == revision)
            for invalid in [["CALL"], ["APP_OTHER"], ["NAME", "NAME"], []] {
                #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: command.merging(["fields": invalid]) { _, value in value }) }
            }
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: command.merging(["confirmed": false]) { _, value in value }) }
        }
    }

    @Test("A stale target aborts its complete batch and repeated records apply only once across chunks")
    func staleAndRepeated() throws {
        try fixture { service, db in
            let first = QSO(call: "W1AW", band: "20m", mode: "CW", name: "First")
            var second = QSO(call: "K1ABC", band: "40m", mode: "CW", name: "Second")
            try db.save(first); try db.save(second)
            func incoming(_ qso: QSO, _ name: String) -> String {
                var fields = qso.adifRecord.fields; fields["NAME"] = name
                return ADIFRecord(fields: fields).adifDocument.replacingOccurrences(of: "<ADIF_VER:5>3.1.7<EOH>\r\n", with: "", options: .anchored)
            }
            let preview = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": incoming(first, "Changed") + incoming(second, "Changed")])
            let command: [String: Any] = ["action": "update", "token": preview["token"]!, "generation": preview["generation"]!, "chunk": 0, "fields": ["NAME"], "confirmed": true]
            second.comment = "Concurrent edit"; try db.save(second)
            #expect(throws: (any Error).self) { try service.handle(method: "logbook_import_adif", params: command) }
            #expect(try db.lookup(localID: first.id)?.name == "First")
            let next = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": incoming(first, "Once")])
            _ = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": incoming(first, "Twice"), "token": next["token"]!, "generation": next["generation"]!, "chunk": 1])
            let apply = command.merging(["token": next["token"]!, "generation": next["generation"]!]) { _, value in value }
            #expect(try service.handle(method: "logbook_import_adif", params: apply)["updated"] as? Int == 1)
            #expect(try service.handle(method: "logbook_import_adif", params: apply.merging(["chunk": 1]) { _, value in value })["updated"] as? Int == 0)
            #expect(try db.lookup(localID: first.id)?.name == "Once")
        }
    }

    @Test("Apply rechecks current duplicate ambiguity and rejects changed workspace, token and order")
    func applyFences() throws {
        try fixture { service, db in
            let original = QSO(call: "W1AW", band: "20m", mode: "CW", name: "Old")
            try db.save(original)
            var fields = original.adifRecord.fields; fields["NAME"] = "New"
            let preview = try service.handle(method: "logbook_import_adif", params: ["action": "preview", "text": ADIFRecord(fields: fields).adifDocument])
            let command: [String: Any] = ["action": "update", "token": preview["token"]!, "generation": preview["generation"]!, "chunk": 0, "fields": ["NAME"], "confirmed": true]
            let replacements: [[String: Any]] = [["generation": "stale"], ["token": "stale"], ["chunk": 1]]
            for replacement in replacements {
                #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_import_adif", params: command.merging(replacement) { _, value in value }) }
            }
            var duplicate = original; duplicate.id = UUID(); try db.save(duplicate)
            #expect(throws: (any Error).self) { try service.handle(method: "logbook_import_adif", params: command) }
            #expect(try db.lookup(localID: original.id)?.name == "Old")
        }
    }
}
