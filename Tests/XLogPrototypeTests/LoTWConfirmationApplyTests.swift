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

#if canImport(XLogCore)
@Suite("Native LoTW confirmation transaction owner")
struct LoTWConfirmationApplyTests {
    private func service(_ root: URL) throws -> LiveLogbookMethods {
        let value = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try value.handle(method: "workspace_create", params: ["mode": "empty"])
        return value
    }
    private func contact(_ call: String = "VK8NSB", status: String = "") -> QSO {
        QSO(wavelogID: nil, call: call, start: ISO8601DateFormatter().date(from: "2026-10-15T12:34:56Z")!,
            band: "20m", mode: "CW", comment: "operator text", myCall: "OM0RX", qslReceived: "N",
            lotwSent: "Y", lotwReceived: status, extraFields: ["APP_KEEP": "retained", "QSLRDATE": "20200101"])
    }
    private func preview(_ owner: LiveLogbookMethods, _ contacts: [QSO], calls: [String]? = nil,
                         confirmed: Bool = true) throws -> LoTWConfirmationPreview {
        func field(_ key: String, _ value: String) -> String { "<\(key):\(value.utf8.count)>\(value)" }
        let names = calls ?? contacts.map(\.call)
        let header = field("PROGRAMID", "LoTW") + field("APP_LOTW_NUMREC", String(names.count))
            + field("APP_LOTW_LASTQSL", "2026-10-16 01:02:03") + "<EOH>"
        let records = names.map { call in
            field("STATION_CALLSIGN", "OM0RX") + field("CALL", call) + field("BAND", "20m")
                + field("QSO_DATE", "20261015") + field("TIME_ON", "123456")
                + field("QSL_RCVD", confirmed ? "Y" : "N")
                + (confirmed ? field("QSLRDATE", "20261016") + field("APP_LOTW_RXQSL", "2026-10-16 01:02:03") : "") + "<EOR>"
        }.joined()
        let report = try LoTWConfirmationReportParser().parse(header + records)
        let generation = try owner.withCurrentWorkspaceGeneration { $0 }
        let db = try owner.openedDatabase()
        let snapshots = try contacts.map { try #require(try db.contactSnapshot(localID: $0.id)) }
        return try LoTWConfirmationPreview.make(report: report, contacts: snapshots, stationCallsign: "OM0RX",
            expectedGeneration: generation, observedGeneration: generation)
    }
    private func sql(_ url: URL, _ sql: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { throw LogbookDatabaseError.open("test") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("test") }
    }
    private func rows(_ url: URL, _ sql: String) throws -> [[String]] {
        var handle: OpaquePointer?, statement: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw LogbookDatabaseError.open("test") }
        defer { sqlite3_finalize(statement); sqlite3_close(handle) }
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("test") }
        var result: [[String]] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return result }
            guard step == SQLITE_ROW else { throw LogbookDatabaseError.sqlite("test") }
            result.append((0..<sqlite3_column_count(statement)).map { index in
                guard let data = sqlite3_column_blob(statement, index) else { return "null" }
                return "\(sqlite3_column_type(statement, index)):" + Data(bytes: data, count: Int(sqlite3_column_bytes(statement, index))).base64EncodedString()
            })
        }
    }
    private func storedJSON(_ url: URL, _ id: UUID) throws -> [String: Any] {
        let encoded = try #require(rows(url, "SELECT record_json FROM qsos WHERE local_id='\(id.uuidString)';").first?.first)
        let data = try #require(Data(base64Encoded: String(encoded.dropFirst(2))))
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func sideEffects(_ url: URL) throws -> [String: [[String]]] {
        let tables = ["sync_outbox", "sync_conflicts", "xlog_online_log_candidates", "xlog_online_log_deliveries",
                      "xlog_contact_receipts", "xlog_settings_receipts", "xlog_operator_receipts", "xlog_sync_mutation_owner"]
        var result: [String: [[String]]] = [:]
        for table in tables { result[table] = try rows(url, "SELECT * FROM \(table) ORDER BY 1;") }
        result["indexesAndBaseline"] = try rows(url, "SELECT local_id,wavelog_id,call,qso_start,band,mode,frequency_hz,is_dirty,deleted_at,updated_at,baseline_json FROM qsos ORDER BY local_id;")
        return result
    }

    @Test func onlyPositivePreviewChangesReachStoredJSONAndEveryOtherFieldSurvives() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lotw-apply-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = try service(root), db = try owner.openedDatabase()
        defer { db.close() }
        var qso = contact(); qso.wavelogID = 42
        let verified = contact("W1AW", status: "V")
        try db.save(qso, markDirty: false); try db.save(verified)
        let url = owner.workspaceDirectoryURL.appendingPathComponent("OM0RX-xLog.sqlite")
        try sql(url, "UPDATE qsos SET record_json=json_set(record_json,'$.futureProperty','preserve me','$.end',NULL,'$.extraFields.TIME_OFF','130000') WHERE local_id='\(qso.id.uuidString)';")
        try sql(url, "INSERT INTO sync_outbox(local_id,attempt_count) VALUES('\(qso.id.uuidString)',2);")
        try sql(url, "INSERT INTO sync_conflicts(conflict_id,local_id,detected_at,conflict_json) SELECT '\(UUID().uuidString)',local_id,0,json_object('id','\(UUID().uuidString)','localQSO',json(record_json),'remoteQSO',json(record_json),'detectedAt',0) FROM qsos WHERE local_id='\(qso.id.uuidString)';")
        try sql(url, "INSERT INTO xlog_online_log_candidates(service,local_id,enrolled_at) VALUES('qrz','\(qso.id.uuidString)',0);")
        try sql(url, "INSERT INTO xlog_online_log_deliveries(service,local_id,contact_revision,payload_sha256,state,attempt_id,attempt_count,last_attempt_at) SELECT 'qrz',local_id,revision,'retained-hash','delivered','\(UUID().uuidString)',1,0 FROM xlog_contact_revisions WHERE local_id='\(qso.id.uuidString)';")
        try db.saveSyncMutationJournal(Data("existing owner journal".utf8))
        let plan = try preview(owner, [qso, verified], calls: [qso.call, verified.call, "K1ZZ"])
        let beforeJSON = try storedJSON(url, qso.id), beforeSideEffects = try sideEffects(url)
        let beforeQSO = try #require(try db.contactSnapshot(localID: qso.id))
        let pending = try db.pendingSyncCount(), outbox = try db.outboxCount()
        #expect(plan.changedCount == 2 && plan.unmatchedCount == 1)
        #expect(try owner.applyLoTWConfirmationChanges(plan) == 2)
        #expect(try db.count() == 2)
        #expect(try sideEffects(url) == beforeSideEffects)
        #expect(try db.pendingSyncCount() == pending && db.outboxCount() == outbox)
        let after = try #require(try db.contactSnapshot(localID: qso.id))
        #expect(after.revision == beforeQSO.revision + 1)
        #expect(after.qso.lotwReceived == "Y")
        #expect(try db.lookup(localID: verified.id)?.lotwReceived == "V")
        var expected = beforeJSON
        expected["lotwReceived"] = "Y"
        var extra = try #require(expected["extraFields"] as? [String: String])
        extra["LOTW_QSLRDATE"] = "20261016"; extra["APP_LOTW_RXQSL"] = "2026-10-16 01:02:03"
        expected["extraFields"] = extra
        #expect(NSDictionary(dictionary: try storedJSON(url, qso.id)).isEqual(to: expected))
        #expect(throws: LoTWConfirmationPreview.Failure.staleContact) { try owner.applyLoTWConfirmationChanges(plan) }
    }

    @Test func unconfirmedAndUnmatchedPreviewIsAWriteFreeNoOp() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lotw-noop-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = try service(root), db = try owner.openedDatabase(); defer { db.close() }
        let qso = contact(status: "Y"); try db.save(qso, markDirty: false)
        let plan = try preview(owner, [qso], calls: [qso.call, "K1ZZ"], confirmed: false)
        let revision = try db.currentRevision(), before = try db.contactSnapshot(localID: qso.id)
        #expect(try owner.applyLoTWConfirmationChanges(plan) == 0)
        #expect(try owner.applyLoTWConfirmationChanges(plan) == 0)
        #expect(try db.currentRevision() == revision)
        #expect(try db.contactSnapshot(localID: qso.id) == before)
    }

    @Test func staleContactAndNewDuplicateFailBeforeAnyWrite() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lotw-stale-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = try service(root), db = try owner.openedDatabase(); defer { db.close() }
        let qso = contact(); try db.save(qso, markDirty: false)
        let plan = try preview(owner, [qso])
        try db.save(contact(), markDirty: false)
        let before = try db.fetchAll(), revision = try db.currentRevision()
        #expect(throws: LoTWConfirmationPreview.Failure.staleContact) { try owner.applyLoTWConfirmationChanges(plan) }
        #expect(try db.fetchAll() == before && db.currentRevision() == revision)
    }

    @Test func lateSQLFailureRollsBackEveryContactAndRevision() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lotw-rollback-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = try service(root), db = try owner.openedDatabase(); defer { db.close() }
        let first = contact(), second = contact("W1AW")
        try db.save(first, markDirty: false); try db.save(second, markDirty: false)
        let plan = try preview(owner, [first, second])
        let url = owner.workspaceDirectoryURL.appendingPathComponent("OM0RX-xLog.sqlite")
        try sql(url, "CREATE TRIGGER reject_second_lotw BEFORE UPDATE ON qsos WHEN NEW.local_id='\(second.id.uuidString)' BEGIN SELECT RAISE(ABORT,'injected'); END;")
        let before = try [first, second].map { try db.contactSnapshot(localID: $0.id) }
        let revision = try db.currentRevision(), side = try sideEffects(url)
        let journal = owner.workspaceDirectoryURL.appendingPathComponent("lotw-recovery-test.json")
        try Data("untouched".utf8).write(to: journal)
        let files = [url, URL(fileURLWithPath: url.path + "-wal"), URL(fileURLWithPath: url.path + "-shm"), URL(fileURLWithPath: url.path + "-journal"), journal]
        let bytes = files.map { try? Data(contentsOf: $0) }
        #expect(throws: Error.self) { try owner.applyLoTWConfirmationChanges(plan) }
        #expect(files.map { try? Data(contentsOf: $0) } == bytes)
        #expect(try [first, second].map { try db.contactSnapshot(localID: $0.id) } == before)
        #expect(try db.currentRevision() == revision && sideEffects(url) == side)
    }

    @Test func otherConnectionRevisionChangeRetiresThePreview() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lotw-revision-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = try service(root), db = try owner.openedDatabase(); defer { db.close() }
        let qso = contact(); try db.save(qso, markDirty: false)
        let plan = try preview(owner, [qso])
        let url = owner.workspaceDirectoryURL.appendingPathComponent("OM0RX-xLog.sqlite")
        let writer = try LogbookDatabase(url: url); defer { writer.close() }
        var edited = try #require(try writer.lookup(localID: qso.id)); edited.comment = "concurrent edit"
        try writer.save(edited)
        let before = try db.contactSnapshot(localID: qso.id)
        #expect(throws: LoTWConfirmationPreview.Failure.staleContact) { try owner.applyLoTWConfirmationChanges(plan) }
        #expect(try db.contactSnapshot(localID: qso.id) == before)
    }

    @Test func authoritativeMissingCorruptAndRotatedGenerationsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lotw-generation-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = try service(root), db = try owner.openedDatabase(); defer { db.close() }
        let qso = contact(); try db.save(qso, markDirty: false)
        let plan = try preview(owner, [qso]), before = try db.contactSnapshot(localID: qso.id)
        let sidecar = owner.workspaceDirectoryURL.appendingPathComponent("edit-generation.json")
        try JSONEncoder().encode(UUID()).write(to: sidecar)
        #expect(throws: LoTWConfirmationPreview.Failure.staleGeneration) { try owner.applyLoTWConfirmationChanges(plan) }
        try Data("corrupt".utf8).write(to: sidecar)
        #expect(throws: Error.self) { try owner.applyLoTWConfirmationChanges(plan) }
        try FileManager.default.removeItem(at: sidecar)
        #expect(throws: Error.self) { try owner.applyLoTWConfirmationChanges(plan) }
        #expect(!FileManager.default.fileExists(atPath: sidecar.path))
        #expect(try db.contactSnapshot(localID: qso.id) == before)
    }
}
#endif
