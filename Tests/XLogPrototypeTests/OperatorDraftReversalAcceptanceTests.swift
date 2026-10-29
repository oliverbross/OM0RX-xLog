import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Reversed automatic UTC native Save acceptance")
struct OperatorDraftReversalAcceptanceTests {
    private func date(_ value: String) throws -> Date {
        try #require(ISO8601DateFormatter().date(from: value))
    }

    private func historical() throws -> QSO {
        QSO(call: "K1ABC", start: try date("2026-10-14T00:00:00Z"), band: "20m", mode: "CW",
            frequencyHz: 14_025_000, extraFields: ["OTHER": "keep"])
    }

    private func blank() -> QSO { QSO(call: "", band: "20m", mode: "CW") }

    private func canonicalJSON(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    @Test("An unsent date reversal leaves automatic SQLite Save native-owned at the exact clock")
    func exactAutomaticSaveAfterUnsentReversal() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("draft-reversal-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite")
        let database = try LogbookDatabase(url: url)
        defer { database.close() }
        let base = try database.operatorDraft(initial: historical())
        #expect(base.automaticStart)

        // These are the local values exercised by the maintained React tests.
        // Before the debounce/Replace there is deliberately no native mutation.
        var local = base.qso
        local.start = try date("2026-10-15T00:00:00Z")
        #expect(local.start != base.qso.start)
        local.start = try date("2026-10-14T00:00:00Z")
        #expect(local == base.qso)
        #expect(try database.operatorDraft(initial: blank()) == base)
        #expect(try database.count() == 0)

        let mutation = OperatorDraftMutation(operationID: UUID(), draftID: base.qso.id,
            expectedRevision: base.revision, action: .save)
        let now = try date("2026-10-28T12:34:56Z")
        let receipt = try database.applyOperatorDraft(mutation, nextDraft: blank(), now: now)
        let saved = try #require(receipt.savedQSO)
        #expect(saved.id == base.qso.id)
        #expect(saved.start == now)
        #expect(saved.end == nil)
        #expect(saved.extraFields["OTHER"] == "keep")
        #expect(saved.adifRecord.fields["QSO_DATE"] == "20261028")
        #expect(saved.adifRecord.fields["TIME_ON"] == "123456")
        #expect(receipt.draft.revision == base.revision + 1)
        #expect(receipt.draft.automaticStart && receipt.draft.qso.call.isEmpty)
        #expect(receipt.draft.qso.id != saved.id)
        #expect(try database.count() == 1)
        #expect(try database.applyOperatorDraft(mutation, nextDraft: blank(), now: now.addingTimeInterval(60)) == receipt)
        database.close()

        let reopened = try LogbookDatabase(url: url)
        defer { reopened.close() }
        #expect(try reopened.lookup(localID: saved.id) == saved)
        #expect(try reopened.operatorDraft(initial: blank()) == receipt.draft)
        #expect(try reopened.operatorDraftReceipt(operationID: mutation.operationID) == receipt)
        #expect(try reopened.applyOperatorDraft(mutation, nextDraft: blank(), now: now.addingTimeInterval(120)) == receipt)
        #expect(try reopened.count() == 1)
    }

    @Test("The actual native handler saves automatic reversal and genuine manual UTC with durable replay",
          arguments: [false, true])
    func handlerSaveAndReopen(manual: Bool) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("handler-reversal-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let database = try service.openedDatabase()
        defer { database.close() }
        let base = try database.operatorDraft(initial: historical())
        #expect(base.revision == 0 && base.automaticStart)
        let wire = try #require(service.handle(method: "logbook_operator_draft", params: [:])["draft"] as? [String: Any])
        let generation = try #require(wire["generation"] as? String)
        #expect(wire["automaticStart"] as? Bool == true)

        if manual {
            // This control really dispatches Replace; it must retain manual time.
            var qso = try #require(wire["qso"] as? [String: Any])
            qso["start"] = "2026-10-15T00:00:00Z"
            qso["end"] = "2026-10-15T00:10:00Z"
            let changed = try service.handle(method: "logbook_operator_draft_apply", params: [
                "generation": generation, "operationID": UUID().uuidString, "draftID": base.qso.id.uuidString,
                "expectedRevision": base.revision, "action": "replace", "qso": qso])
            #expect(changed["status"] as? String == "applied")
        }
        let beforeSave = try database.operatorDraft(initial: blank())
        #expect(beforeSave.revision == (manual ? 1 : 0))
        #expect(beforeSave.automaticStart == !manual)
        #expect(try database.count() == 0)
        let operationID = UUID()
        let params: [String: Any] = ["generation": generation, "operationID": operationID.uuidString,
            "draftID": beforeSave.qso.id.uuidString, "expectedRevision": beforeSave.revision, "action": "save"]
        let lowerBound = Date().timeIntervalSince1970.rounded(.down)
        let result = try service.handle(method: "logbook_operator_draft_apply", params: params)
        let upperBound = Date().timeIntervalSince1970.rounded(.up)
        #expect(result["status"] as? String == "applied")
        let receipt = try #require(try database.operatorDraftReceipt(operationID: operationID))
        let saved = try #require(receipt.savedQSO)
        if manual {
            #expect(saved.start == (try date("2026-10-15T00:00:00Z")))
            #expect(saved.end == (try date("2026-10-15T00:10:00Z")))
            #expect(saved.adifRecord.fields["QSO_DATE"] == "20261015")
            #expect(saved.adifRecord.fields["TIME_ON"] == "000000")
        } else {
            // Wire dates use second precision; bounds enclose the real handler call.
            #expect(saved.start.timeIntervalSince1970 >= lowerBound)
            #expect(saved.start.timeIntervalSince1970 <= upperBound)
            #expect(saved.start != base.qso.start)
            #expect(saved.end == nil)
        }
        #expect(saved.id == base.qso.id && saved.extraFields["OTHER"] == "keep")
        #expect(receipt.draft.automaticStart && receipt.draft.qso.call.isEmpty)
        #expect(receipt.draft.revision == beforeSave.revision + 1)
        #expect(try canonicalJSON(service.handle(method: "logbook_operator_draft_apply", params: params)) == canonicalJSON(result))
        let receiptParams: [String: Any] = ["generation": generation, "operationID": operationID.uuidString]
        let wireReceipt = try service.handle(method: "logbook_operator_draft_receipt", params: receiptParams)
        #expect(try canonicalJSON(wireReceipt) == canonicalJSON(["receipt": try #require(result["receipt"])]))
        let url = database.url
        database.close()

        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let reopenedDatabase = try reopened.openedDatabase()
        defer { reopenedDatabase.close() }
        #expect(reopenedDatabase.url == url)
        #expect(try reopenedDatabase.lookup(localID: saved.id) == saved)
        #expect(try reopenedDatabase.operatorDraftReceipt(operationID: operationID) == receipt)
        #expect(try reopenedDatabase.operatorDraft(initial: blank()) == receipt.draft)
        #expect(try canonicalJSON(reopened.handle(method: "logbook_operator_draft_apply", params: params)) == canonicalJSON(result))
        #expect(try canonicalJSON(reopened.handle(method: "logbook_operator_draft_receipt", params: receiptParams)) == canonicalJSON(wireReceipt))
        #expect(try reopenedDatabase.count() == 1)
    }
}
