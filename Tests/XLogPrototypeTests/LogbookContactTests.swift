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

    @Test("Contact update round-trips modeled and arbitrary ADIF fields without stale duplicate values")
    func arbitraryADIFUpdate() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url); defer { db.close() }
        let app = ADIFFieldMetadata.ExtensionField(kind: "APP", attributes: ["PROGRAMID": "TEST", "FIELDNAME": "KEEP", "TYPE": "S"])
        let removed = ADIFFieldMetadata.ExtensionField(kind: "APP", attributes: ["PROGRAMID": "TEST", "FIELDNAME": "REMOVE", "TYPE": "S"])
        let fields = ["CALL": "K1ABC", "QSO_DATE": "20261014", "TIME_ON": "123000", "BAND": "20m", "MODE": "CW",
                      "QSO_DATE_OFF": "20261014", "TIME_OFF": "123500", "FREQ_RX": "14.030000", "BAND_RX": "20m",
                      "ANT_PATH": "S", "QSLMSG": "Original", "APP_TEST_KEEP": "kept", "APP_TEST_REMOVE": "remove me"]
        let sourceRecord = ADIFRecord(fields: fields, fieldMetadata: .init(extensions: [
            "APP_TEST_KEEP": app, "APP_TEST_REMOVE": removed,
        ]))
        let imported = try #require(QSO(adif: sourceRecord))
        #expect(imported.end == Date(timeIntervalSince1970: 1_791_981_300))
        #expect(imported.receiveFrequencyHz == 14_030_000 && imported.receiveBand == "20m")
        #expect(imported.antennaPath == "S" && imported.qslMessage == "Original")
        var dateOnlyFields = fields
        dateOnlyFields.removeValue(forKey: "TIME_OFF")
        let dateOnly = try #require(QSO(adif: ADIFRecord(fields: dateOnlyFields)))
        #expect(dateOnly.adifRecord["TIME_OFF"] == "123000")
        var timeOnlyFields = fields
        timeOnlyFields.removeValue(forKey: "QSO_DATE_OFF")
        let timeOnly = try #require(QSO(adif: ADIFRecord(fields: timeOnlyFields)))
        #expect(timeOnly.adifRecord["QSO_DATE_OFF"] == "20261014")
        // Simulate a row saved by an older build, before these standard fields
        // were projected from the retained ADIF bag into modeled QSO properties.
        var qso = QSO(id: imported.id, call: "K1ABC", start: Date(timeIntervalSince1970: 1_791_981_000),
                      band: "20m", mode: "CW", extraFields: fields, isDirty: false)
        qso.adifFieldMetadata = sourceRecord.fieldMetadata
        try db.save(qso, markDirty: false)
        let base = try #require(try db.contactSnapshot(localID: qso.id))
        #expect(base.qso.end == Date(timeIntervalSince1970: 1_791_981_300))
        #expect(base.qso.receiveFrequencyHz == 14_030_000 && base.qso.receiveBand == "20m")
        #expect(base.qso.antennaPath == "S" && base.qso.qslMessage == "Original")

        qso = base.qso
        qso.end = Date(timeIntervalSince1970: 1_791_981_600)
        qso.receiveFrequencyHz = 14_035_000; qso.receiveBand = "30m"
        qso.antennaPath = "L"; qso.qslMessage = "Updated"
        qso.extraFields["APP_TEST_KEEP"] = "edited"
        qso.extraFields["APP_NEW_FIELD"] = "new\nvalue"
        qso.extraFields.removeValue(forKey: "APP_TEST_REMOVE")
        qso.adifFieldMetadata?.extensions.removeValue(forKey: "APP_TEST_REMOVE")
        let updated = try db.applyContactMutation(mutation(base, qso: qso)).contact
        #expect(updated.revision == base.revision + 1)
        #expect(updated.qso.extraFields["APP_TEST_KEEP"] == "edited")
        #expect(updated.qso.extraFields["APP_NEW_FIELD"] == "new\nvalue")
        #expect(updated.qso.extraFields["APP_TEST_REMOVE"] == nil)
        #expect(updated.qso.adifFieldMetadata?.extensions["APP_TEST_KEEP"] == app)
        #expect(updated.qso.adifFieldMetadata?.extensions["APP_TEST_REMOVE"] == nil)

        var clearedBand = updated.qso
        clearedBand.receiveBand = ""
        clearedBand.extraFields.removeValue(forKey: "BAND_RX")
        let cleared = try db.applyContactMutation(mutation(updated, qso: clearedBand)).contact
        let reread = try #require(try db.contactSnapshot(localID: qso.id))
        #expect(reread == cleared)
        #expect(reread.qso.receiveFrequencyHz == 14_035_000)
        #expect(reread.qso.receiveBand.isEmpty)

        let record = try #require(try db.adifExportSnapshot(scope: .selected([qso.id])).records.first)
        #expect(record["QSO_DATE_OFF"] == "20261014" && record["TIME_OFF"] == "124000")
        #expect(record["FREQ_RX"] == "14.035000" && record["BAND_RX"] == nil)
        #expect(record["ANT_PATH"] == "L" && record["QSLMSG"] == "Updated")
        #expect(record["APP_TEST_KEEP"] == "edited" && record["APP_NEW_FIELD"] == "new\nvalue")
        #expect(record["APP_TEST_REMOVE"] == nil)
    }

    @Test("Unparseable retained standard ADIF values survive unrelated edits until explicitly cleared")
    func retainedUnparseableADIF() throws {
        let url = databaseURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url); defer { db.close() }
        let raw = ["FREQ_RX": "N/A", "QSO_DATE_OFF": "unknown", "TIME_OFF": "unknown"]
        let qso = QSO(call: "K1ABC", start: Date(timeIntervalSince1970: 1_791_981_000),
                      band: "20m", mode: "CW", extraFields: raw, isDirty: false)
        try db.save(qso, markDirty: false)
        let base = try #require(try db.contactSnapshot(localID: qso.id))
        #expect(base.qso.receiveFrequencyHz == nil && base.qso.end == nil)

        var edited = base.qso
        edited.name = "Unrelated edit"
        let updated = try db.applyContactMutation(mutation(base, qso: edited)).contact
        var record = try #require(try db.adifExportSnapshot(scope: .selected([qso.id])).records.first)
        for (field, value) in raw { #expect(record[field] == value) }

        var cleared = updated.qso
        for field in raw.keys { cleared.extraFields.removeValue(forKey: field) }
        _ = try db.applyContactMutation(mutation(updated, qso: cleared))
        record = try #require(try db.adifExportSnapshot(scope: .selected([qso.id])).records.first)
        for field in raw.keys { #expect(record[field] == nil) }
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
        let generation = try #require(contact["generation"] as? String)
        var params: [String: Any] = ["generation": generation, "operationID": UUID().uuidString, "contactID": qso.id.uuidString, "expectedRevision": contact["revision"]!, "action": "update", "qso": edited]
        let result = try await request("logbook_contact_apply", params)
        #expect((result["result"] as? [String: Any])?["status"] as? String == "applied")
        #expect(try await request("logbook_contact_apply", params)["ok"] as? Bool == true)
        let receipt = try await request("logbook_contact_receipt", ["generation": generation, "operationID": params["operationID"]!])
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
