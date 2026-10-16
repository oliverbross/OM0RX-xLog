import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Read-only PJ correction preview")
struct CTYCorrectionPreviewTests {
    @Test("Preview pages inferred changes and preserves all explicit DXCC values and sync state")
    func isolatedPreview() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let db = try service.openedDatabase()
        let start = Date(timeIntervalSince1970: 1_750_000_000)
        for (index, call) in ["PJ2T", "PJ4A/P", "PJ5A", "PJ6Y", "PJ7A", "PJ9UNKNOWN", "S21ABC", "OM0RX/PJ4"].enumerated() {
            try db.save(QSO(call: call, start: start.addingTimeInterval(Double(index)), band: "20m", mode: "CW"))
        }
        for dxcc in [305, 517, 0] {
            try db.save(QSO(call: "PJ2OVERRIDE", start: start, band: "20m", mode: "CW", dxcc: dxcc))
        }
        let deleted = QSO(call: "PJ2DELETED", start: start, band: "20m", mode: "CW")
        try db.save(deleted); try db.softDelete(deleted)
        let before = try db.fetchAll(), revision = try db.currentRevision()
        let pending = try db.pendingSyncCount(), outbox = try db.outboxCount()
        let response = try service.handle(method: "logbook_cty_preview", params: ["limit": 2])
        #expect(response["source"] as? String == "bundled")
        #expect(response["read_only"] as? Bool == true)
        let page = try #require(response["preview"] as? [String: Any])
        #expect(page["affectedCount"] as? Int == 6)
        #expect(page["protectedOverrideCount"] as? Int == 3)
        let first = try #require(page["rows"] as? [[String: Any]])
        #expect(first.count == 2)
        #expect(first[0]["call"] as? String == "PJ9UNKNOWN")
        #expect(first[0]["previousADIF"] as? Int == 305)
        #expect(first[0]["currentADIF"] == nil)
        #expect(first[1]["currentADIF"] as? Int == 518)
        let second = try #require(service.handle(method: "logbook_cty_preview", params: ["limit": 2, "offset": 2])["preview"] as? [String: Any])
        let rows = try #require(second["rows"] as? [[String: Any]])
        #expect(rows.map { $0["call"] as? String } == ["PJ6Y", "PJ5A"])
        #expect(rows.allSatisfy { Set($0.keys).isSubset(of: ["id", "call", "start", "previousADIF", "previousCountry", "currentADIF", "currentCountry"]) })
        #expect(try db.fetchAll() == before)
        #expect(try db.currentRevision() == revision)
        #expect(try db.pendingSyncCount() == pending)
        #expect(try db.outboxCount() == outbox)
        let invalidParams: [[String: Any]] = [["limit": 26], ["offset": -1], ["apply": true], ["limit": true]]
        for params in invalidParams {
            #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_cty_preview", params: params) }
        }
    }

    @Test("Downloaded source uses historical QSO dates and exact exceptions; missing Bangladesh remains unresolved before")
    func datedSource() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let reference = try service.referenceDirectoryURL().appendingPathComponent("cty.xml")
        let xml = """
        <cty>
          <prefix><call>S2</call><adif>305</adif><cqz>22</cqz><entity>Bangladesh</entity></prefix>
          <prefix><call>PJ2</call><adif>85</adif><cqz>9</cqz><entity>Historical fixture</entity><end>2010-10-09 23:59:59</end></prefix>
          <prefix><call>PJ2</call><adif>517</adif><cqz>9</cqz><entity>Curacao</entity><start>2010-10-10</start></prefix>
          <prefix><call>PJ6</call><adif>519</adif><cqz>8</cqz><entity>Saba</entity></prefix>
          <exception><call>PJ6Y</call><adif>520</adif><cqz>9</cqz><entity>Exact fixture</entity></exception>
        </cty>
        """
        try Data(xml.utf8).write(to: reference)
        let db = try service.openedDatabase()
        for (call, timestamp) in [("PJ2T", "2010-10-09T23:59:59Z"), ("PJ2T", "2010-10-10T00:00:00Z"), ("PJ6Y", "2025-01-01T00:00:00Z")] {
            try db.save(QSO(call: call, start: ISO8601DateFormatter().date(from: timestamp)!, band: "20m", mode: "CW"))
        }
        let response = try service.handle(method: "logbook_cty_preview", params: [:])
        #expect(response["source"] as? String == "downloaded")
        let preview = try #require(response["preview"] as? [String: Any])
        let rows = try #require(preview["rows"] as? [[String: Any]])
        #expect(rows.map { $0["currentADIF"] as? Int } == [520, 517, 85])
        // The removed shortcut returned nil if the source had no ADIF 305 entry.
        try Data("<cty><prefix><call>PJ2</call><adif>517</adif><cqz>9</cqz><entity>Curacao only</entity></prefix></cty>".utf8).write(to: reference, options: .atomic)
        let noBangladesh = try db.pjCorrectionPreview(resolver: service.currentCTYResolver())
        #expect(noBangladesh.rows.count == 2)
        #expect(noBangladesh.rows.allSatisfy { $0.previousADIF == nil && $0.currentADIF == 517 })
    }
}
