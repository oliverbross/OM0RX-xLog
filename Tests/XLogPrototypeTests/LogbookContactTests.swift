import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
@testable import XLogPrototypeSupport

@Suite("Revision-fenced existing logbook contacts")
struct LogbookContactTests {
    private func databaseURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("contact-test-\(UUID().uuidString)").appendingPathComponent("log.sqlite")
    }
    private func mutation(_ base: LogbookContactSnapshot, _ action: LogbookContactMutation.Action = .update,
                          qso: QSO? = nil, id: UUID = UUID()) -> LogbookContactMutation {
        LogbookContactMutation(operationID: id, contactID: base.qso.id, expectedRevision: base.revision, action: action, qso: qso)
    }
    private func fixtureSQL(_ url: URL, _ sql: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { throw LogbookDatabaseError.open("test fixture") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("test fixture") }
    }

    @Test("Generic writers advance only the changed contact's revision")
    func allWriters() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let first = try LogbookDatabase(url: url), second = try LogbookDatabase(url: url)
        defer { first.close(); second.close() }
        var qso = QSO(call: "K1ABC", band: "20m", mode: "CW")
        try first.save(qso)
        let original = try #require(try first.contactSnapshot(localID: qso.id))
        #expect(original.revision == 1)
        try second.save(QSO(call: "W1AW", band: "40m", mode: "SSB"))
        #expect(try first.contactSnapshot(localID: qso.id) == original)
        qso.comment = "Imported update"; try second.save(qso, markDirty: false)
        let latest = try #require(try first.contactSnapshot(localID: qso.id))
        #expect(latest.revision == original.revision + 1)
        var stale = original.qso; stale.name = "Stale edit"
        do {
            _ = try first.applyContactMutation(mutation(original, qso: stale))
            Issue.record("Stale update overwrote imported changes")
        } catch LogbookContactError.conflict(let current) { #expect(current == latest) }
        #expect(try second.lookup(localID: qso.id)?.comment == "Imported update")
    }

    @Test("Independent simultaneous editors cannot both update the same revision")
    func concurrentEdits() async throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let first = try LogbookDatabase(url: url), second = try LogbookDatabase(url: url)
        defer { first.close(); second.close() }
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try first.save(qso)
        let base = try #require(try first.contactSnapshot(localID: qso.id))
        let outcomes = try await withThrowingTaskGroup(of: Bool.self) { group in
            for index in 0..<8 {
                let db = index.isMultiple(of: 2) ? first : second
                var changed = base.qso; changed.comment = "Editor \(index)"
                let request = mutation(base, qso: changed)
                group.addTask {
                    do { _ = try db.applyContactMutation(request); return true }
                    catch LogbookContactError.conflict { return false }
                }
            }
            var results: [Bool] = []; for try await value in group { results.append(value) }; return results
        }
        #expect(outcomes.filter { $0 }.count == 1)
        #expect(try first.contactSnapshot(localID: qso.id)?.revision == base.revision + 1)
        #expect(try first.count() == 1)
    }

    @Test("Lost-ack retry survives restart and does not roll back a later edit")
    func durableReceipt() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        let qso = QSO(wavelogID: 42, call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso, markDirty: false)
        let base = try #require(try db.contactSnapshot(localID: qso.id))
        var changed = base.qso; changed.comment = "First edit"; changed.extraFields["APP_TEST"] = "retained"
        let request = mutation(base, qso: changed), receipt = try db.applyContactMutation(request)
        #expect(receipt.contact.qso.isDirty)
        #expect(receipt.contact.qso.wavelogID == 42)
        #expect(receipt.contact.qso.extraFields["APP_TEST"] == "retained")
        changed = receipt.contact.qso; changed.comment = "Later edit"
        let latest = try db.applyContactMutation(mutation(receipt.contact, qso: changed)).contact
        db.close()
        let reopened = try LogbookDatabase(url: url); defer { reopened.close() }
        #expect(try reopened.contactReceipt(operationID: request.operationID) == receipt)
        #expect(try reopened.applyContactMutation(request) == receipt)
        #expect(try reopened.contactSnapshot(localID: qso.id) == latest)
        #expect(throws: LogbookContactError.self) { try reopened.applyContactMutation(mutation(base, .delete, id: request.operationID)) }
    }

    @Test("Delete and Undo are revision checked, idempotent and cannot resurrect stale content")
    func deleteRestore() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url); defer { db.close() }
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso)
        let base = try #require(try db.contactSnapshot(localID: qso.id))
        let deletion = mutation(base, .delete), receipt = try db.applyContactMutation(deletion)
        #expect(receipt.contact.qso.deletedAt != nil)
        #expect(try db.count() == 0)
        #expect(try db.applyContactMutation(deletion) == receipt)
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, .restore)) }
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, qso: qso)) }
        let restored = try db.applyContactMutation(mutation(receipt.contact, .restore)).contact
        #expect(restored.qso.deletedAt == nil)
        #expect(restored.revision == base.revision + 2)
        #expect(try db.count() == 1)
    }

    @Test("Receipt failure rolls back both the edit and its trigger revision")
    func rollback() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url); defer { db.close() }
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso)
        let base = try #require(try db.contactSnapshot(localID: qso.id)); var updated = base.qso; updated.call = "W1AW"
        let request = mutation(base, qso: updated)
        try fixtureSQL(url, "CREATE TRIGGER fail_contact_receipt BEFORE INSERT ON xlog_contact_receipts BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;")
        #expect(throws: LogbookDatabaseError.self) { try db.applyContactMutation(request) }
        #expect(try db.contactSnapshot(localID: qso.id) == base)
        #expect(try db.contactReceipt(operationID: request.operationID) == nil)
        #expect(try db.count(search: "K1ABC") == 1)
        try fixtureSQL(url, "DROP TRIGGER fail_contact_receipt;")
        #expect(try db.applyContactMutation(request).contact.qso.call == "W1AW")
    }

    @Test("Migration reads legacy rows at revision zero without rewriting them")
    func legacyRows() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso)
        let stored = try #require(try db.lookup(localID: qso.id)); db.close()
        try fixtureSQL(url, "DROP TRIGGER xlog_contact_revision_insert; DROP TRIGGER xlog_contact_revision_update; DROP TRIGGER xlog_contact_revision_delete; DROP TABLE xlog_contact_revisions; DROP TABLE xlog_contact_receipts;")
        let migrated = try LogbookDatabase(url: url); defer { migrated.close() }
        let base = try #require(try migrated.contactSnapshot(localID: qso.id))
        #expect(base.revision == 0); #expect(base.qso == stored)
        var edited = stored; edited.name = "Test"
        #expect(try migrated.applyContactMutation(mutation(base, qso: edited)).contact.revision == 1)
    }

    @Test("Physical removal and reinsertion cannot reuse an old contact revision")
    func removedContact() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url); defer { db.close() }
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso)
        let base = try #require(try db.contactSnapshot(localID: qso.id))
        try fixtureSQL(url, "DELETE FROM qsos WHERE local_id='\(qso.id.uuidString)';")
        do { _ = try db.applyContactMutation(mutation(base, qso: qso)); Issue.record("Recreated absent contact") }
        catch LogbookContactError.conflict(let value) { #expect(value == nil) }
        try db.save(qso)
        #expect(try db.contactSnapshot(localID: qso.id)?.revision == base.revision + 2)
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, qso: qso)) }
    }

    @Test("Edits cannot change identity, remote mapping, deletion state or inject invalid data")
    func validation() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url); defer { db.close() }
        let qso = QSO(wavelogID: 42, call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso)
        let base = try #require(try db.contactSnapshot(localID: qso.id))
        var changed = base.qso; changed.id = UUID()
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, qso: changed)) }
        changed = base.qso; changed.wavelogID = nil
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, qso: changed)) }
        changed = base.qso; changed.deletedAt = Date()
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, qso: changed)) }
        changed = base.qso; changed.call = "!"
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, qso: changed)) }
        changed = base.qso; changed.notes = String(repeating: "x", count: 25_000)
        #expect(throws: LogbookContactError.self) { try db.applyContactMutation(mutation(base, qso: changed)) }
        #expect(try db.contactSnapshot(localID: qso.id) == base)
    }

    @Test("Database backup retains contact revisions and historical retry receipts")
    func backupReceipt() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url); defer { db.close() }
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso)
        let base = try #require(try db.contactSnapshot(localID: qso.id))
        var edited = base.qso; edited.comment = "Saved before backup"
        let request = mutation(base, qso: edited), receipt = try db.applyContactMutation(request)
        let backupURL = url.deletingLastPathComponent().appendingPathComponent("backup.sqlite")
        try db.backup(to: backupURL)
        let backup = try LogbookDatabase(url: backupURL); defer { backup.close() }
        #expect(try backup.contactSnapshot(localID: qso.id) == receipt.contact)
        #expect(try backup.applyContactMutation(request) == receipt)
        #expect(try backup.contactSnapshot(localID: qso.id)?.revision == receipt.contact.revision)
        #expect(try backup.count() == 1)
    }

    @Test("Worker exposes bounded contact reads, conflicts, receipts and terminal shutdown fencing")
    func workerContract() async throws {
        let root = databaseURL().deletingLastPathComponent(); defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let worker = LiveWorker(logbook: service, localAcceptance: true)
        func request(_ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
            let data = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method, "params": params])
            return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
        }
        #expect(try await request("workspace_create", ["mode": "empty"])["ok"] as? Bool == true)
        let db = try service.openedDatabase(); defer { db.close() }
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); try db.save(qso)
        let reply = try await request("logbook_contact", ["contactID": qso.id.uuidString])
        let contact = try #require((reply["result"] as? [String: Any])?["contact"] as? [String: Any])
        var edited = try #require(contact["qso"] as? [String: Any]); edited["comment"] = "Offline edit"
        var params: [String: Any] = ["operationID": UUID().uuidString, "contactID": qso.id.uuidString, "expectedRevision": contact["revision"]!, "action": "update", "qso": edited]
        let result = try await request("logbook_contact_apply", params)
        #expect((result["result"] as? [String: Any])?["status"] as? String == "applied")
        #expect(try await request("logbook_contact_apply", params)["ok"] as? Bool == true)
        let receipt = try await request("logbook_contact_receipt", ["operationID": params["operationID"]!])
        #expect((receipt["result"] as? [String: Any])?["receipt"] as? [String: Any] != nil)
        params["operationID"] = UUID().uuidString
        let conflict = try await request("logbook_contact_apply", params)
        #expect((conflict["result"] as? [String: Any])?["status"] as? String == "conflict")
        for bad: Any in [true, -1, 1.5, "1", 9_007_199_254_740_991] {
            params["expectedRevision"] = bad
            #expect(try await request("logbook_contact_apply", params)["ok"] as? Bool == false)
        }
        await worker.shutdown()
        for method in ["logbook_contact", "logbook_contact_apply", "logbook_contact_receipt"] {
            let stopped = try await request(method)
            #expect((stopped["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
        }
    }
}
