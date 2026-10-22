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

@Suite("Durable operator draft and retry receipts")
struct OperatorDraftTests {
    private func blank() -> QSO { QSO(call: "", band: "20m", mode: "CW") }
    private func mutation(_ snapshot: OperatorDraftSnapshot, _ action: OperatorDraftMutation.Action,
                          qso: QSO? = nil, id: UUID = UUID()) -> OperatorDraftMutation {
        OperatorDraftMutation(operationID: id, draftID: snapshot.qso.id,
                              expectedRevision: snapshot.revision, action: action, qso: qso)
    }
    private func databaseURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("draft-test-\(UUID().uuidString)").appendingPathComponent("log.sqlite")
    }
    private func fixtureSQL(_ url: URL, _ sql: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { throw LogbookDatabaseError.open("test fixture") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("test fixture") }
    }

    @Test("New drafts and mode changes use conventional voice and CW reports")
    func signalReportDefaults() throws {
        #expect(QSO(call: "", band: "20m", mode: "SSB").rstSent == "59")
        #expect(QSO(call: "", band: "20m", mode: "CW").rstReceived == "599")

        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        defer { db.close() }
        let before = try db.operatorDraft(initial: QSO(call: "", band: "20m", mode: "SSB"))
        var cw = before.qso; cw.mode = "CW"
        let receipt = try db.applyOperatorDraft(mutation(before, .replace, qso: cw), nextDraft: blank())
        #expect(receipt.draft.qso.rstSent == "599")
        #expect(receipt.draft.qso.rstReceived == "599")
    }

    @Test("A second connection and a reopened service see the same acknowledged draft")
    func persistentDraft() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        let first = try db.operatorDraft(initial: blank())
        var qso = first.qso; qso.call = "VK"; qso.comment = "unfinished typing"
        let receipt = try db.applyOperatorDraft(mutation(first, .replace, qso: qso), nextDraft: blank())
        #expect(receipt.draft.revision == 1)
        #expect(receipt.savedQSO == nil)
        let second = try LogbookDatabase(url: url)
        #expect(try second.operatorDraft(initial: blank()) == receipt.draft)
        db.close(); second.close()
        let reopened = try LogbookDatabase(url: url)
        defer { reopened.close() }
        #expect(try reopened.operatorDraft(initial: blank()) == receipt.draft)
        #expect(try reopened.operatorDraftReceipt(operationID: receipt.mutation.operationID) == receipt)
        #expect(try reopened.count() == 0)
    }

    @Test("First callsign refreshes an automatic idle start while a manual historical start is preserved")
    func automaticAndManualStartProvenance() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        defer { db.close() }
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        let selectedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let initial = QSO(call: "", start: old, band: "20m", mode: "CW", updatedAt: old)
        let automatic = try db.operatorDraft(initial: initial)
        #expect(automatic.automaticStart)
        var live = automatic.qso; live.call = "FK8IK"
        let liveReceipt = try db.applyOperatorDraft(mutation(automatic, .replace, qso: live),
                                                    nextDraft: blank(), now: selectedAt)
        #expect(liveReceipt.draft.qso.start == selectedAt)
        #expect(liveReceipt.draft.automaticStart)

        let loggedAt = selectedAt.addingTimeInterval(13 * 60 * 60)
        let saved = try db.applyOperatorDraft(mutation(liveReceipt.draft, .save), nextDraft: blank(), now: loggedAt)
        #expect(saved.savedQSO?.start == loggedAt)

        let cleared = saved.draft
        var historical = cleared.qso; historical.start = old
        let dated = try db.applyOperatorDraft(mutation(cleared, .replace, qso: historical), nextDraft: blank()).draft
        #expect(!dated.automaticStart)
        var historicalCall = dated.qso; historicalCall.call = "K1ABC"
        let preserved = try db.applyOperatorDraft(mutation(dated, .replace, qso: historicalCall),
                                                  nextDraft: blank(), now: selectedAt.addingTimeInterval(60)).draft
        #expect(preserved.qso.start == old)
        #expect(!preserved.automaticStart)
    }

    @Test("A stale window cannot replace newer text or clear the next draft")
    func conflicts() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let first = try LogbookDatabase(url: url), second = try LogbookDatabase(url: url)
        defer { first.close(); second.close() }
        let before = try first.operatorDraft(initial: blank())
        var edited = before.qso; edited.call = "K1ABC"
        let after = try first.applyOperatorDraft(mutation(before, .replace, qso: edited), nextDraft: blank()).draft
        do {
            _ = try second.applyOperatorDraft(mutation(before, .replace, qso: before.qso), nextDraft: blank())
            Issue.record("Stale replacement was accepted")
        } catch OperatorDraftError.conflict(let current) { #expect(current == after) }
        let cleared = try second.applyOperatorDraft(mutation(after, .clear), nextDraft: blank()).draft
        #expect(cleared.qso.id != after.qso.id)
        #expect(cleared.revision == 2)
        #expect(throws: OperatorDraftError.self) {
            try first.applyOperatorDraft(mutation(after, .clear), nextDraft: blank())
        }
        #expect(try first.operatorDraft(initial: blank()) == cleared)
    }

    @Test("Lost Save acknowledgement is recoverable after restart without another insert or reset")
    func saveRetry() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        var initial = blank(); initial.call = " k1abc "; initial.frequencyHz = 14_025_000
        let before = try db.operatorDraft(initial: initial)
        let save = mutation(before, .save)
        let receipt = try db.applyOperatorDraft(save, nextDraft: blank())
        #expect(receipt.savedQSO?.call == "K1ABC")
        #expect(receipt.savedQSO?.id == before.qso.id)
        #expect(receipt.draft.qso.id != before.qso.id)
        #expect(receipt.draft.qso.call.isEmpty)
        var nextQSO = receipt.draft.qso; nextQSO.call = "JA1ABC"
        let latest = try db.applyOperatorDraft(mutation(receipt.draft, .replace, qso: nextQSO), nextDraft: blank()).draft
        db.close()
        let reopened = try LogbookDatabase(url: url)
        defer { reopened.close() }
        #expect(try reopened.applyOperatorDraft(save, nextDraft: blank()) == receipt)
        #expect(try reopened.operatorDraft(initial: blank()) == latest)
        #expect(try reopened.count() == 1)
        #expect(try reopened.lookup(localID: before.qso.id) == receipt.savedQSO)
        let reused = mutation(before, .clear, id: save.operationID)
        do {
            _ = try reopened.applyOperatorDraft(reused, nextDraft: blank())
            Issue.record("Operation ID accepted different content")
        } catch OperatorDraftError.operationReused { }
    }

    @Test("Independent simultaneous Save attempts commit exactly one contact")
    func concurrentSave() async throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let first = try LogbookDatabase(url: url), second = try LogbookDatabase(url: url)
        defer { first.close(); second.close() }
        var initial = blank(); initial.call = "K1ABC"
        let snapshot = try first.operatorDraft(initial: initial)
        let outcomes = try await withThrowingTaskGroup(of: Bool.self) { group in
            for index in 0..<8 {
                let db = index.isMultiple(of: 2) ? first : second
                let request = mutation(snapshot, .save), next = blank()
                group.addTask {
                    do { _ = try db.applyOperatorDraft(request, nextDraft: next); return true }
                    catch OperatorDraftError.conflict { return false }
                }
            }
            var results: [Bool] = []
            for try await value in group { results.append(value) }
            return results
        }
        #expect(outcomes.filter { $0 }.count == 1)
        #expect(try first.count() == 1)
        #expect(try first.operatorDraft(initial: blank()).revision == 1)
    }

    @Test("Receipt-write failure rolls back the contact and draft advance together")
    func rollback() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        defer { db.close() }
        var initial = blank(); initial.call = "K1ABC"
        let before = try db.operatorDraft(initial: initial), save = mutation(before, .save)
        try fixtureSQL(url, "CREATE TRIGGER fail_receipt BEFORE INSERT ON xlog_operator_receipts BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;")
        #expect(throws: LogbookDatabaseError.self) { try db.applyOperatorDraft(save, nextDraft: blank()) }
        #expect(try db.count() == 0)
        #expect(try db.stats().qsoCount == 0)
        #expect(try db.operatorDraft(initial: blank()) == before)
        #expect(try db.operatorDraftReceipt(operationID: save.operationID) == nil)
        try fixtureSQL(url, "DROP TRIGGER fail_receipt;")
        #expect(try db.applyOperatorDraft(save, nextDraft: blank()).savedQSO?.id == before.qso.id)
        #expect(try db.count() == 1)
    }

    @Test("Draft API cannot overwrite a logged contact or import sync identity")
    func identityFences() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        defer { db.close() }
        let before = try db.operatorDraft(initial: blank())
        var changed = before.qso; changed.id = UUID()
        #expect(throws: OperatorDraftError.self) { try db.applyOperatorDraft(mutation(before, .replace, qso: changed), nextDraft: blank()) }
        changed = before.qso; changed.wavelogID = 42
        #expect(throws: OperatorDraftError.self) { try db.applyOperatorDraft(mutation(before, .replace, qso: changed), nextDraft: blank()) }
        changed = before.qso; changed.call = "K1ABC"
        let current = try db.applyOperatorDraft(mutation(before, .replace, qso: changed), nextDraft: blank()).draft
        var logged = current.qso; logged.comment = "existing contact must survive"
        try db.save(logged)
        do {
            _ = try db.applyOperatorDraft(mutation(current, .save), nextDraft: blank())
            Issue.record("Draft overwrote a logged contact")
        } catch OperatorDraftError.existingContact { }
        #expect(try db.lookup(localID: logged.id)?.comment == logged.comment)
        #expect(try db.operatorDraft(initial: blank()) == current)
    }

    @Test("Partial calls can be drafted but invalid or oversized records cannot be logged")
    func validation() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        defer { db.close() }
        let before = try db.operatorDraft(initial: blank())
        #expect(throws: OperatorDraftError.self) { try db.applyOperatorDraft(mutation(before, .save), nextDraft: blank()) }
        var tooBig = before.qso; tooBig.comment = String(repeating: "x", count: 131_073)
        #expect(throws: OperatorDraftError.self) { try db.applyOperatorDraft(mutation(before, .replace, qso: tooBig), nextDraft: blank()) }
        var badFrequency = before.qso; badFrequency.frequencyHz = -1
        #expect(throws: OperatorDraftError.self) { try db.applyOperatorDraft(mutation(before, .replace, qso: badFrequency), nextDraft: blank()) }
        #expect(try db.operatorDraft(initial: blank()) == before)
        #expect(try db.count() == 0)
    }

    @Test("Transient receipts are bounded while Save receipts survive backup and later edits")
    func retentionAndBackup() throws {
        let url = databaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: url)
        defer { db.close() }
        var initial = blank(); initial.call = "K1ABC"
        let before = try db.operatorDraft(initial: initial)
        let save = mutation(before, .save)
        let saved = try db.applyOperatorDraft(save, nextDraft: blank())
        var current = saved.draft
        let oldest = mutation(current, .replace, qso: current.qso)
        current = try db.applyOperatorDraft(oldest, nextDraft: blank()).draft
        for index in 0..<260 {
            var qso = current.qso; qso.comment = String(index)
            current = try db.applyOperatorDraft(mutation(current, .replace, qso: qso), nextDraft: blank()).draft
        }
        #expect(try db.operatorDraftReceipt(operationID: oldest.operationID) == nil)
        #expect(throws: OperatorDraftError.self) { try db.applyOperatorDraft(oldest, nextDraft: blank()) }
        #expect(try db.operatorDraftReceipt(operationID: save.operationID) == saved)
        let backupURL = url.deletingLastPathComponent().appendingPathComponent("backup.sqlite")
        try db.backup(to: backupURL)
        let backup = try LogbookDatabase(url: backupURL)
        defer { backup.close() }
        #expect(try backup.operatorDraft(initial: blank()) == current)
        #expect(try backup.applyOperatorDraft(save, nextDraft: blank()) == saved)
        #expect(try backup.count() == 1)
    }

    @Test("Worker exposes conflict snapshots, validates revisions and serves durable receipts offline")
    func workerContract() async throws {
        let root = databaseURL().deletingLastPathComponent()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let worker = LiveWorker(logbook: service, localAcceptance: true)
        func request(_ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
            let data = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method, "params": params])
            return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
        }
        #expect(try await request("workspace_create", ["mode": "empty"])["ok"] as? Bool == true)
        defer { try? service.openedDatabase().close() }
        let response = try await request("logbook_operator_draft")
        let snapshot = try #require((response["result"] as? [String: Any])?["draft"] as? [String: Any])
        var qso = try #require(snapshot["qso"] as? [String: Any]); qso["call"] = "K1ABC"
        let generation = try #require(snapshot["generation"] as? String)
        let params: [String: Any] = ["generation": generation, "operationID": UUID().uuidString, "draftID": qso["id"]!, "expectedRevision": 0, "action": "replace", "qso": qso]
        let changed = try await request("logbook_operator_draft_apply", params)
        #expect((changed["result"] as? [String: Any])?["status"] as? String == "applied")
        var stale = params; stale["operationID"] = UUID().uuidString
        let conflict = try await request("logbook_operator_draft_apply", stale)
        #expect((conflict["result"] as? [String: Any])?["status"] as? String == "conflict")
        let current = try #require((conflict["result"] as? [String: Any])?["draft"] as? [String: Any])
        #expect(current["revision"] as? Int == 1)
        for bad: Any in [true, 0.5, -1, "1", 9_007_199_254_740_991] {
            var invalid = params; invalid["expectedRevision"] = bad
            let result = try await request("logbook_operator_draft_apply", invalid)
            #expect(result["ok"] as? Bool == false)
        }
        let savedID = UUID().uuidString
        let save: [String: Any] = ["generation": generation, "operationID": savedID, "draftID": qso["id"]!, "expectedRevision": 1, "action": "save"]
        #expect(try await request("logbook_operator_draft_apply", save)["ok"] as? Bool == true)
        #expect(try await request("logbook_operator_draft_apply", save)["ok"] as? Bool == true)
        let receipt = try await request("logbook_operator_draft_receipt", ["generation": generation, "operationID": savedID])
        #expect((receipt["result"] as? [String: Any])?["receipt"] as? [String: Any] != nil)
        #expect(try service.openedDatabase().count() == 1)
        await worker.shutdown()
    }

    @Test("A terminated live worker cannot create or mutate an operator draft")
    func shutdownFence() async throws {
        let root = databaseURL().deletingLastPathComponent()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let worker = LiveWorker(logbook: service)
        await worker.beginTerminalShutdown()
        for method in ["logbook_operator_draft", "logbook_operator_draft_apply", "logbook_operator_draft_receipt"] {
            let request = try JSONSerialization.data(withJSONObject: ["id": "shutdown", "method": method, "params": [:]])
            let response = try #require(JSONSerialization.jsonObject(with: await worker.response(to: request)) as? [String: Any])
            #expect(response["ok"] as? Bool == false)
            #expect((response["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
        }
        #expect(!FileManager.default.fileExists(atPath: root.path))
    }
}
