import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Read-only exact-contact data quality route")
struct QSODataQualityRouteTests {
    @Test func readsCanonicalEvidenceWithExplicitUnknownsAndNoWrites() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let db = try service.openedDatabase()
        let qso = QSO(call: "PJ2T", band: "20m", mode: "CW", frequencyHz: 14_025_000, dxcc: 305,
                      txPower: "5", extraFields: ["PRIVATE_FIELD": "must-not-project"])
        try db.save(qso)
        let contact = try service.handle(method: "logbook_contact", params: ["contactID": qso.id.uuidString])
        let generation = try #require(contact["generation"] as? String)
        let maybeSnapshot = try db.contactSnapshot(localID: qso.id)
        let snapshot = try #require(maybeSnapshot)
        let params: [String: Any] = ["contactID": qso.id.uuidString, "generation": generation, "expectedRevision": snapshot.revision]
        let before = try db.fetchAll(), revision = try db.currentRevision(), pending = try db.pendingSyncCount(), outbox = try db.outboxCount()
        let generationURL = service.workspaceDirectoryURL.appendingPathComponent("edit-generation.json")
        let identity = try Data(contentsOf: generationURL)
        for _ in 0..<2 {
            let result = try service.handle(method: "logbook_data_quality", params: params)
            #expect(result["read_only"] as? Bool == true)
            #expect(result["duplicate_review"] as? String == "notPerformed")
            #expect(result["conflict_review"] as? String == "notRequested")
            let report = try #require(result["data_quality"] as? [String: Any])
            #expect(report["contactID"] as? String == qso.id.uuidString)
            #expect(report["contactRevision"] as? Int64 == snapshot.revision)
            let reference = try #require(report["referenceComparison"] as? [String: Any])
            #expect(reference["referenceSource"] as? String == "bundled_cty")
            #expect(reference["referenceVersion"] is NSNull)
            #expect(reference["date"] is NSNull)
            let fields = try #require(report["retainedFields"] as? [[String: Any]])
            #expect(fields.allSatisfy { $0["date"] is NSNull && $0["referenceSource"] is NSNull && $0["dateRole"] as? String == "fieldOriginUnknown" })
            #expect(report["retainedPowerObservation"] is NSNull)
            let text = String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
            #expect(!text.contains("must-not-project"))
            #expect(!text.contains(root.path))
        }
        #expect(try db.fetchAll() == before)
        #expect(try db.currentRevision() == revision)
        #expect(try db.pendingSyncCount() == pending)
        #expect(try db.outboxCount() == outbox)
        #expect(try Data(contentsOf: generationURL) == identity)
        var changed = qso; changed.comment = "newer edit"; try db.save(changed)
        let stale = try service.handle(method: "logbook_data_quality", params: params)
        #expect(stale["status"] as? String == "contact_changed")
        #expect(stale["data_quality"] == nil)
        var foreign = params; foreign["generation"] = UUID().uuidString
        let retired = try service.handle(method: "logbook_data_quality", params: foreign)
        #expect(retired["status"] as? String == "workspace_changed")
        #expect(retired["data_quality"] == nil)
        var missing = params; missing["contactID"] = UUID().uuidString
        #expect(try service.handle(method: "logbook_data_quality", params: missing)["data_quality"] is NSNull)
        for change: [String: Any] in [["refresh_provider": true], ["contactID": "bad"], ["expectedRevision": -1], ["expectedRevision": 1.5], ["expectedRevision": true], ["conflictID": "bad"]] {
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_data_quality", params: params.merging(change) { _, new in new }) }
        }
        var absentRevision = params; absentRevision.removeValue(forKey: "expectedRevision")
        #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_data_quality", params: absentRevision) }
        try FileManager.default.removeItem(at: generationURL)
        #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_data_quality", params: params) }
        #expect(!FileManager.default.fileExists(atPath: generationURL.path))
    }

    @Test func selectedConflictUsesRetainedOwnerAndRejectsForeignOrMissingContext() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let db = try service.openedDatabase()
        var local = QSO(wavelogID: 42, call: "OM0RX", band: "20m", mode: "CW", frequencyHz: 14_025_000, name: "Local name")
        try db.save(local)
        var remote = local; remote.id = UUID(); remote.isDirty = false; remote.name = "Remote name"
        _ = try db.mergeRemote(remote)
        let retainedConflicts = try db.conflicts()
        let conflict = try #require(retainedConflicts.first)
        let context = try service.handle(method: "logbook_contact", params: ["contactID": local.id.uuidString])
        let generation = try #require(context["generation"] as? String)
        let maybeLocal = try db.contactSnapshot(localID: local.id)
        let revision = try #require(maybeLocal).revision
        var params: [String: Any] = ["contactID": local.id.uuidString, "generation": generation, "expectedRevision": revision, "conflictID": conflict.id.uuidString]
        let before = try db.fetchAll(), outbox = try db.outboxCount()
        let response = try service.handle(method: "logbook_data_quality", params: params)
        let report = try #require(response["data_quality"] as? [String: Any])
        let findings = try #require(report["findings"] as? [[String: Any]])
        #expect(findings.contains { $0["kind"] as? String == "retainedConflict" })
        #expect(try db.fetchAll() == before)
        #expect(try db.outboxCount() == outbox)
        #expect(try db.conflicts() == [conflict])
        params["conflictID"] = UUID().uuidString
        #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_data_quality", params: params) }
        let other = QSO(call: "W1AW", band: "20m", mode: "CW"); try db.save(other)
        params["contactID"] = other.id.uuidString; params["expectedRevision"] = try db.contactSnapshot(localID: other.id)?.revision
        params["conflictID"] = conflict.id.uuidString
        #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_data_quality", params: params) }
        local.name = "Intentional newer local"; try db.save(local)
        params["contactID"] = local.id.uuidString; params["expectedRevision"] = try db.contactSnapshot(localID: local.id)?.revision
        let newer = try service.handle(method: "logbook_data_quality", params: params)
        let newerReport = try #require(newer["data_quality"] as? [String: Any])
        let newerFindings = try #require(newerReport["findings"] as? [[String: Any]])
        #expect(newerFindings.contains { $0["kind"] as? String == "conflictContextDoesNotMatch" })
        #expect(!newerFindings.contains { $0["kind"] as? String == "retainedConflict" })
    }
}
