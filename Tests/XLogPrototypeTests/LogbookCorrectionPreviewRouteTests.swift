import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Revision and evidence fenced correction preview")
struct LogbookCorrectionPreviewRouteTests {
    @Test func exactCurrentCTYEvidencePreviewsOnlyDXCCWithoutWriting() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let db = try service.openedDatabase()
        let qso = QSO(call: "PJ2T", band: "20m", mode: "CW", frequencyHz: 14_025_000, dxcc: 1)
        try db.save(qso)
        let contact = try #require(try db.contactSnapshot(localID: qso.id))
        let context = try service.handle(method: "logbook_contact", params: ["contactID": qso.id.uuidString])
        let generation = try #require(context["generation"] as? String)
        let quality = try service.handle(method: "logbook_data_quality", params: [
            "contactID": qso.id.uuidString, "generation": generation, "expectedRevision": contact.revision,
        ])
        let report = try #require(quality["data_quality"] as? [String: Any])
        let evidence = try #require(report["referenceComparison"] as? [String: Any])
        let before = try db.fetchAll(), revision = try db.currentRevision()
        let pending = try db.pendingSyncCount(), outbox = try db.outboxCount()
        let generationURL = service.workspaceDirectoryURL.appendingPathComponent("edit-generation.json")
        let generationBytes = try Data(contentsOf: generationURL)

        for _ in 0..<2 {
            let result = try service.handle(method: "logbook_correction_preview", params: [
                "contactID": qso.id.uuidString, "generation": generation, "expectedRevision": contact.revision,
                "evidence": evidence,
            ])
            #expect(result["status"] as? String == "reviewed")
            #expect(result["read_only"] as? Bool == true)
            #expect(result["scope"] as? String == "ctyReferenceDXCCOnly")
            let review = try #require(result["review"] as? [String: Any])
            #expect(review["diffStatus"] as? String == "complete")
            let changes = try #require(review["changes"] as? [[String: Any]])
            #expect(changes.count == 1)
            #expect(changes.first?["path"] as? [String] == ["dxcc"])
        }
        #expect(try db.fetchAll() == before)
        #expect(try db.currentRevision() == revision)
        #expect(try db.pendingSyncCount() == pending)
        #expect(try db.outboxCount() == outbox)
        #expect(try Data(contentsOf: generationURL) == generationBytes)
    }

    @Test func staleEvidenceAndUnrequestedProposalFieldsNeverBecomePreviews() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let db = try service.openedDatabase()
        let qso = QSO(call: "PJ2T", band: "20m", mode: "CW", dxcc: 1)
        try db.save(qso)
        let contact = try #require(try db.contactSnapshot(localID: qso.id))
        let context = try service.handle(method: "logbook_contact", params: ["contactID": qso.id.uuidString])
        let generation = try #require(context["generation"] as? String)
        let quality = try service.handle(method: "logbook_data_quality", params: [
            "contactID": qso.id.uuidString, "generation": generation, "expectedRevision": contact.revision,
        ])
        let report = try #require(quality["data_quality"] as? [String: Any])
        let evidence = try #require(report["referenceComparison"] as? [String: Any])
        var params: [String: Any] = ["contactID": qso.id.uuidString, "generation": generation,
            "expectedRevision": contact.revision, "evidence": evidence]

        var tampered = evidence; tampered["value"] = "999"
        params["evidence"] = tampered
        #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_correction_preview", params: params) }
        params["evidence"] = evidence
        params["qso"] = ["comment": "unrelated"]
        #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_correction_preview", params: params) }
        params.removeValue(forKey: "qso")
        var foreign = params; foreign["generation"] = UUID().uuidString
        #expect(try service.handle(method: "logbook_correction_preview", params: foreign)["status"] as? String == "workspace_changed")
        var changed = try #require(try db.lookup(localID: qso.id)); changed.comment = "new revision"; try db.save(changed)
        #expect(try service.handle(method: "logbook_correction_preview", params: params)["status"] as? String == "contact_changed")
    }
}
