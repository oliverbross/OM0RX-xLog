import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Read-only upload follow-up route")
struct OnlineLogFollowUpRouteTests {
    @Test func projectsHistoricalReceiptWithoutChangingContactOrDelivery() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let db = try service.openedDatabase()
        _ = try db.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        var qso = QSO(call: "VK8NSB", band: "20m", mode: "CW", lotwReceived: "Y",
                      extraFields: ["LOTW_QSLRDATE": "20261015", "PRIVATE_FIELD": "must-not-project"])
        try db.saveNewContactForOnlineLogs(qso)
        let plan = try db.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        let attempt = UUID(), date = Date(timeIntervalSince1970: 1_700_000_000)
        _ = try db.claimOnlineLogDelivery(plan, attemptID: attempt, at: date)
        let receipt = try db.resolveOnlineLogDelivery(plan, attemptID: attempt, resolution: .delivered(remoteID: "987654321"), at: date)
        qso.comment = "Edited after upload"
        try db.save(qso)
        let generation = try #require(service.handle(method: "logbook_contact", params: ["contactID": qso.id.uuidString])["generation"] as? String)
        let before = try db.fetchAll(), revision = try db.currentRevision()
        let pending = try db.pendingSyncCount(), outbox = try db.outboxCount()
        for _ in 0..<2 {
            let response = try service.handle(method: "logbook_follow_up", params: ["contactID": qso.id.uuidString, "generation": generation])
            #expect(response["read_only"] as? Bool == true)
            #expect(response["generation"] as? String == generation)
            let projection = try #require(response["follow_up"] as? [String: Any])
            #expect(projection["contact_id"] as? String == qso.id.uuidString)
            #expect(projection["sponsor_credit"] is NSNull)
            let uploads = try #require(projection["uploads"] as? [[String: Any]])
            #expect(uploads.count == 2)
            #expect(uploads[0]["state"] as? String == "delivered")
            #expect(uploads[0]["current_revision"] as? Bool == false)
            #expect(uploads[0]["acceptance_age_seconds"] is NSNull)
            #expect(uploads[0]["attempt_age_seconds"] as? Double != nil)
            #expect(uploads[1]["state"] is NSNull)
            let confirmations = try #require(projection["confirmations"] as? [[String: Any]])
            #expect(confirmations[1]["received_status"] as? String == "Y")
            #expect(confirmations[1]["received_date"] as? String == "20261015")
            #expect(confirmations.allSatisfy { $0["match_age_seconds"] is NSNull })
            let text = String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
            #expect(!text.contains("must-not-project"))
            #expect(!text.contains("987654321"))
            #expect(!text.contains("payload_sha256"))
        }
        #expect(try db.fetchAll() == before)
        #expect(try db.currentRevision() == revision)
        #expect(try db.pendingSyncCount() == pending)
        #expect(try db.outboxCount() == outbox)
        #expect(try db.onlineLogDeliveryReceipt(service: .qrz, contactID: qso.id, contactRevision: receipt.contactRevision) == receipt)
        let stale = try service.handle(method: "logbook_follow_up", params: ["contactID": qso.id.uuidString, "generation": UUID().uuidString])
        #expect(stale["status"] as? String == "workspace_changed")
        #expect(stale["follow_up"] == nil)
        let missing = try service.handle(method: "logbook_follow_up", params: ["contactID": UUID().uuidString, "generation": generation])
        #expect(missing["follow_up"] is NSNull)
        let invalidParams: [[String: Any]] = [["contactID": "invalid", "generation": generation],
                                             ["contactID": qso.id.uuidString],
                                             ["contactID": qso.id.uuidString, "generation": generation, "refresh_provider": true]]
        for params in invalidParams {
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_follow_up", params: params) }
        }
    }
}
