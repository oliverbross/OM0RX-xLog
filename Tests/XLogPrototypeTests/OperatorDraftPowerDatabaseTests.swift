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

@Suite("Atomic canonical draft power")
struct OperatorDraftPowerDatabaseTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func blank() -> QSO {
        var qso = QSO(call: "", band: "20m", mode: "CW")
        qso.txPower = "100"; qso.frequencyHz = 14_025_000
        return qso
    }
    private func url() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("power-db-\(UUID())/log.sqlite")
    }
    private func mutation(_ draft: OperatorDraftSnapshot, _ action: OperatorDraftMutation.Action,
                          qso: QSO? = nil, intent: OperatorDraftPowerIntent? = nil) -> OperatorDraftMutation {
        OperatorDraftMutation(operationID: UUID(), draftID: draft.qso.id,
            expectedRevision: draft.revision, action: action, qso: qso, powerIntent: intent)
    }
    private func context() -> OperatorDraftPowerContext {
        OperatorDraftPowerContext(providerID: "station", selectionID: "selection",
            sessionID: UUID(), sessionStartedAt: now.addingTimeInterval(-1))
    }
    private func sample(_ context: OperatorDraftPowerContext, watts: Double = 500,
                        offset: Double = 1) throws -> OperatorDraftPowerSample {
        let date = now.addingTimeInterval(offset)
        return try #require(OperatorDraftPowerSample(watts: watts, observedAt: date,
            radioObservedAt: date, amplifierObservedAt: date, receivedAt: date, sessionID: context.sessionID))
    }
    private func ready(_ db: LogbookDatabase, workspace: UUID, context: OperatorDraftPowerContext) throws -> OperatorDraftSnapshot {
        _ = try db.operatorDraft(initial: blank())
        let configured = try db.configureOperatorDraftPower(enabled: true, fallback: "100", workspaceID: workspace)
        var qso = configured.qso; qso.call = "K1ABC"; qso.comment = "original comment"; qso.notes = "original notes"
        let draft = try db.applyOperatorDraft(mutation(configured, .replace, qso: qso), nextDraft: blank()).draft
        return try db.armOperatorDraftPower(context: context, workspaceID: workspace,
            draftID: draft.qso.id, expectedRevision: draft.revision, now: now)
    }
    private func sql(_ url: URL, _ statement: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { throw LogbookDatabaseError.open("fixture") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, statement, nil, nil, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("fixture") }
    }

    @Test("Legacy draft/receipt decoding and unfinished manual values survive migration")
    func migration() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        var qso = blank(); qso.call = "K1ABC"; qso.txPower = "75"
        let draft = try db.operatorDraft(initial: qso)
        let data = try JSONEncoder().encode(draft)
        #expect(try JSONDecoder().decode(OperatorDraftSnapshot.self, from: data).power == nil)
        let receipt = try db.applyOperatorDraft(mutation(draft, .replace, qso: qso), nextDraft: blank())
        #expect(try JSONDecoder().decode(OperatorDraftReceipt.self, from: JSONEncoder().encode(receipt)) == receipt)
        let configured = try db.configureOperatorDraftPower(enabled: true, fallback: "100", workspaceID: UUID())
        #expect(configured.qso.txPower == "75")
        #expect(configured.power?.manualOverride == true)
        #expect(configured.power?.activeScope == nil)
    }

    @Test("Power-only updates retain edit revision and stale text replacement cannot undo them")
    func staleText() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let workspace = UUID(), context = context()
        let armed = try ready(db, workspace: workspace, context: context)
        let scope = try #require(armed.power?.activeScope?.id)
        let captured = try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1))
        #expect(captured.revision == armed.revision)
        #expect(captured.power!.revision > armed.power!.revision)
        var typed = armed.qso; typed.name = "New name"
        let updated = try db.applyOperatorDraft(mutation(armed, .replace, qso: typed), nextDraft: blank()).draft
        #expect(updated.qso.txPower == "500")
        #expect(updated.qso.name == "New name")
        #expect(updated.power?.activeScope?.id == scope)
        #expect(updated.qso.extraFields.isEmpty)
    }

    @Test("Restored snapshots reject mismatched power identity, value, and invalid edit revisions")
    func malformedSnapshot() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let armed = try ready(db, workspace: UUID(), context: context())
        let encoded = try JSONEncoder().encode(armed)
        let decoded = try JSONSerialization.jsonObject(with: encoded)
        let original = try #require(decoded as? [String: Any])
        for (key, value) in [("call", "JA1ABC"), ("id", UUID().uuidString), ("txPower", "700"), ("band", "40m"), ("mode", "SSB")] {
            var object = original
            var qso = try #require(object["qso"] as? [String: Any]); qso[key] = value; object["qso"] = qso
            let data = try JSONSerialization.data(withJSONObject: object)
            #expect(throws: OperatorDraftError.self) { try JSONDecoder().decode(OperatorDraftSnapshot.self, from: data) }
        }
        for revision: Int64 in [-1, 9_007_199_254_740_992] {
            var object = original; object["revision"] = revision
            let data = try JSONSerialization.data(withJSONObject: object)
            #expect(throws: OperatorDraftError.self) { try JSONDecoder().decode(OperatorDraftSnapshot.self, from: data) }
        }
    }

    @Test("Same-value and empty manual intent fence samples until explicit automatic resume")
    func manualIntent() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let workspace = UUID(), context = context()
        var draft = try ready(db, workspace: workspace, context: context)
        let oldScope = try #require(draft.power?.activeScope?.id)
        for value in ["100", ""] {
            draft = try db.applyOperatorDraft(mutation(draft, .replace, qso: draft.qso,
                intent: .init(action: .manual, value: value)), nextDraft: blank()).draft
            let ignored = try db.captureOperatorDraftPower(sample: sample(context), scopeID: oldScope, now: now.addingTimeInterval(1))
            #expect(ignored == draft)
            #expect(draft.qso.txPower == value)
            #expect(draft.power?.manualOverride == true)
        }
        draft = try db.applyOperatorDraft(mutation(draft, .replace, qso: draft.qso,
            intent: .init(action: .automatic)), nextDraft: blank()).draft
        #expect(draft.qso.txPower == "100")
        let armed = try db.armOperatorDraftPower(context: context, workspaceID: workspace,
            draftID: draft.qso.id, expectedRevision: draft.revision, now: now)
        #expect(armed.power?.activeScope?.id != oldScope)
    }

    @Test("Reopened database cannot revive saved authority and fresh arm starts a fresh peak")
    func reopen() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path)
        let workspace = UUID(), context = context()
        let armed = try ready(db, workspace: workspace, context: context)
        let scope = try #require(armed.power?.activeScope?.id)
        let captured = try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1))
        db.close()
        let reopened = try LogbookDatabase(url: path); defer { reopened.close() }
        #expect(try reopened.captureOperatorDraftPower(sample: sample(context, watts: 700, offset: 2),
            scopeID: scope, now: now.addingTimeInterval(2)) == captured)
        let fresh = try reopened.armOperatorDraftPower(context: context, workspaceID: workspace,
            draftID: captured.qso.id, expectedRevision: captured.revision, now: now.addingTimeInterval(2))
        let freshScope = try #require(fresh.power?.activeScope?.id)
        #expect(freshScope != scope)
        #expect(fresh.qso.txPower == "500")
        let updated = try reopened.captureOperatorDraftPower(sample: sample(context, watts: 200, offset: 3),
            scopeID: freshScope, now: now.addingTimeInterval(3))
        #expect(updated.qso.txPower == "200")
    }

    @Test("Save freezes power/provenance and its retry receipt even after restart")
    func saveReceipt() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path)
        let workspace = UUID(), context = context()
        let armed = try ready(db, workspace: workspace, context: context)
        let scope = try #require(armed.power?.activeScope?.id)
        _ = try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1))
        let request = mutation(armed, .save)
        let receipt = try db.applyOperatorDraft(request, nextDraft: blank())
        #expect(receipt.savedQSO?.txPower == "500")
        #expect(receipt.savedQSO?.extraFields["APP_OM0RXXLOG_POWER_WATTS"] == "500")
        #expect(receipt.savedQSO?.extraFields["APP_OM0RXXLOG_POWER_SESSION_ID"] == context.sessionID.uuidString)
        #expect(receipt.savedQSO?.comment == "original comment")
        #expect(receipt.savedQSO?.notes == "original notes")
        #expect(receipt.draft.qso.txPower == "100")
        #expect(receipt.draft.power?.selectedSample == nil)
        #expect(try db.captureOperatorDraftPower(sample: sample(context, watts: 700, offset: 2),
            scopeID: scope, now: now.addingTimeInterval(2)) == receipt.draft)
        db.close()
        let reopened = try LogbookDatabase(url: path); defer { reopened.close() }
        #expect(try reopened.applyOperatorDraft(request, nextDraft: blank()) == receipt)
        #expect(try reopened.lookup(localID: armed.qso.id) == receipt.savedQSO)
        #expect(try reopened.count() == 1)
    }

    @Test("Workspace restore rebind preserves selected evidence but never capture authority")
    func rebindWorkspace() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let workspace = UUID(), context = context()
        let armed = try ready(db, workspace: workspace, context: context)
        let scope = try #require(armed.power?.activeScope?.id)
        let captured = try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1))
        let nextWorkspace = UUID()
        let rebound = try db.configureOperatorDraftPower(enabled: true, fallback: "100", workspaceID: nextWorkspace)
        #expect(rebound.qso.txPower == "500")
        #expect(rebound.power?.selectedSample == captured.power?.selectedSample)
        #expect(rebound.power?.workspaceID == nextWorkspace)
        #expect(rebound.power?.manualOverride == false)
        #expect(rebound.power?.activeScope == nil)
        #expect(try db.captureOperatorDraftPower(sample: sample(context, watts: 900, offset: 2),
            scopeID: scope, now: now.addingTimeInterval(2)) == rebound)
        let saved = try db.applyOperatorDraft(mutation(rebound, .save), nextDraft: blank()).savedQSO
        #expect(saved?.extraFields["APP_OM0RXXLOG_POWER_WATTS"] == "500")
    }

    @Test("Receipt failure rolls back QSO, power, draft, and receipt atomically")
    func rollback() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let workspace = UUID(), context = context()
        let armed = try ready(db, workspace: workspace, context: context)
        let scope = try #require(armed.power?.activeScope?.id)
        let before = try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1))
        let request = mutation(before, .save)
        try sql(path, "CREATE TRIGGER fail_power_receipt BEFORE INSERT ON xlog_operator_receipts BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;")
        #expect(throws: LogbookDatabaseError.self) { try db.applyOperatorDraft(request, nextDraft: blank()) }
        #expect(try db.operatorDraft(initial: blank()) == before)
        #expect(try db.count() == 0)
        #expect(try db.operatorDraftReceipt(operationID: request.operationID) == nil)
        try sql(path, "DROP TRIGGER fail_power_receipt;")
        let after = try db.captureOperatorDraftPower(sample: sample(context, watts: 600, offset: 2), scopeID: scope, now: now.addingTimeInterval(2))
        #expect(after.qso.txPower == "600")
        #expect(try db.applyOperatorDraft(request, nextDraft: blank()).savedQSO?.txPower == "600")
    }

    @Test("A to B to A and Clear cannot reuse a retired scope")
    func contactFences() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let workspace = UUID(), context = context()
        var draft = try ready(db, workspace: workspace, context: context)
        let scope = try #require(draft.power?.activeScope?.id)
        for call in ["JA1ABC", "K1ABC"] {
            var qso = draft.qso; qso.call = call
            draft = try db.applyOperatorDraft(mutation(draft, .replace, qso: qso), nextDraft: blank()).draft
            #expect(try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1)) == draft)
        }
        draft = try db.applyOperatorDraft(mutation(draft, .clear), nextDraft: blank()).draft
        #expect(try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1)) == draft)
    }

    @Test("Rejected arm/configuration and failed sample writes leave existing authority intact")
    func rejectedOperations() throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let workspace = UUID(), context = context()
        let armed = try ready(db, workspace: workspace, context: context)
        let scope = try #require(armed.power?.activeScope?.id)
        var qso = armed.qso; qso.name = "Typed name"
        let current = try db.applyOperatorDraft(mutation(armed, .replace, qso: qso), nextDraft: blank()).draft
        #expect(throws: OperatorDraftError.self) {
            try db.armOperatorDraftPower(context: context, workspaceID: workspace,
                draftID: armed.qso.id, expectedRevision: armed.revision, now: now)
        }
        #expect(throws: OperatorDraftPowerError.self) {
            try db.configureOperatorDraftPower(enabled: true, fallback: String(repeating: "x", count: 100), workspaceID: workspace)
        }
        #expect(try db.operatorDraft(initial: blank()) == current)
        try sql(path, "CREATE TRIGGER fail_power_write BEFORE UPDATE ON xlog_operator_draft BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;")
        #expect(throws: LogbookDatabaseError.self) {
            try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1))
        }
        #expect(try db.operatorDraft(initial: blank()) == current)
        try sql(path, "DROP TRIGGER fail_power_write;")
        let captured = try db.captureOperatorDraftPower(sample: sample(context), scopeID: scope, now: now.addingTimeInterval(1))
        #expect(captured.qso.txPower == "500")
    }

    @Test("Concurrent capture and Save resolve to one internally consistent durable receipt")
    func concurrentCaptureSave() async throws {
        let path = url(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let db = try LogbookDatabase(url: path); defer { db.close() }
        let workspace = UUID(), context = context()
        let armed = try ready(db, workspace: workspace, context: context)
        let scope = try #require(armed.power?.activeScope?.id)
        let reading = try sample(context), request = mutation(armed, .save), next = blank()
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { _ = try db.captureOperatorDraftPower(sample: reading, scopeID: scope, now: reading.receivedAt) }
            group.addTask { _ = try db.applyOperatorDraft(request, nextDraft: next) }
            try await group.waitForAll()
        }
        let storedReceipt = try db.operatorDraftReceipt(operationID: request.operationID)
        let receipt = try #require(storedReceipt)
        let saved = try #require(receipt.savedQSO)
        #expect(saved.txPower == "100" || saved.txPower == "500")
        #expect(saved.extraFields["APP_OM0RXXLOG_POWER_WATTS"] == (saved.txPower == "500" ? "500" : nil))
        #expect(try db.lookup(localID: saved.id) == saved)
        #expect(try db.count() == 1)
        #expect(try db.operatorDraft(initial: blank()) == receipt.draft)
        #expect(receipt.draft.qso.txPower == "100")
    }
}
