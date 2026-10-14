import Foundation
import Testing
@testable import XLogCore

@Suite("Read-only ADIF review and export")
struct ADIFPlanningTests {
    private func record(_ extra: [String: String] = [:]) -> ADIFRecord {
        ADIFRecord(fields: ["CALL": "K1ABC", "QSO_DATE": "20261014", "TIME_ON": "1234",
                            "BAND": "20m", "MODE": "MFSK", "SUBMODE": "FT8"]
            .merging(extra, uniquingKeysWith: { _, new in new }))
    }

    @Test("Preview preserves extensions, confirmations and embedded delimiters")
    func unicodeAndExtensions() throws {
        let source = record(["COMMENT": "Žilina <EOR> 😀", "APP_TEST": "value", "LOTW_QSL_RCVD": "Y",
                             "POTA_REF": "SK-0001", "QSO_DATE_OFF": "20261014", "TIME_OFF": "123500"])
        let preview = ADIFImportPreview(text: source.adifDocument)
        #expect(preview.issues.isEmpty)
        #expect(preview.records == [source])
        let plan = try ADIFImportPlan(preview: preview, existing: [], duplicatePolicy: .skip)
        #expect(plan.inserts.first?.record == source)
        #expect(plan.updates.isEmpty)
    }

    @Test("Malformed suffix retains the completed preview but prevents planning")
    func malformedSuffix() {
        let preview = ADIFImportPreview(text: record().adifDocument + "<CALL:20>short")
        #expect(preview.records.count == 1)
        #expect(!preview.issues.isEmpty)
        #expect(throws: ADIFPlanningError.invalidPreview) {
            try ADIFImportPlan(preview: preview, existing: [], duplicatePolicy: .skip)
        }
    }

    @Test("Malformed descriptors never trap or silently discard fields", arguments: [
        "<>", "<CALL:-1>x<EOR>", "<CALL:9999999999999999999999>x<EOR>",
        "<CALL:1>A<CALL:1>B<EOR>", "<CALL:1:NN>A<EOR>", "<CALL:2>😀<EOR>",
        "<CALL:1>A", "<EOR>", "<CALL:1>A<EOR>junk", "<EOH><EOH>", "<ADX>"
    ])
    func malformedDescriptors(_ suffix: String) {
        #expect(!ADIFImportPreview(text: suffix).issues.isEmpty)
    }

    @Test("UTC and frequency validation is strict", arguments: [
        ["QSO_DATE": "20260230"], ["QSO_DATE": "20261301"], ["TIME_ON": "246000"],
        ["TIME_ON": "1234567"], ["TIME_ON": "1"], ["TIME_ON": "12:34"],
        ["QSO_DATE_OFF": "20260230"], ["TIME_OFF": "2500"], ["FREQ": "nan"],
        ["FREQ": "-1"], ["FREQ": "0"], ["FREQ": "1000001"], ["BAND": " "], ["MODE": " "]
    ])
    func invalidValues(_ values: [String: String]) {
        #expect(!ADIFImportPreview(text: record(values).adifDocument).issues.isEmpty)
    }

    @Test("Bounds and missing contacts reject without a write")
    func limits() {
        #expect(!ADIFImportPreview(text: record().adifDocument, maximumBytes: 10).issues.isEmpty)
        #expect(!ADIFImportPreview(text: record().adifDocument, maximumRecords: 0).issues.isEmpty)
        let two = record().adifDocument + record().adifDocument.replacingOccurrences(of: "<ADIF_VER:5>3.1.7<EOH>\r\n", with: "")
        #expect(!ADIFImportPreview(text: two, maximumRecords: 1).issues.isEmpty)
        #expect(!ADIFImportPreview(text: "<ADIF_VER:5>3.1.7<EOH>").issues.isEmpty)
        #expect(!ADIFImportPreview(text: "").issues.isEmpty)
    }

    @Test("Duplicate matching uses start UTC and submode, and skips repeated input")
    func duplicates() throws {
        let existing = try #require(QSO(adif: record(["QSO_DATE_OFF": "20261015", "TIME_OFF": "000000"])))
        let document = ADIFExportSnapshot(contacts: [existing, existing], scope: .all).document
        let preview = ADIFImportPreview(text: document)
        let plan = try ADIFImportPlan(preview: preview, existing: [existing], duplicatePolicy: .skip)
        #expect(plan.inserts.isEmpty && plan.updates.isEmpty)
        #expect(plan.skippedRecordNumbers == [1, 2])
        let ft4 = ADIFImportPreview(text: record(["SUBMODE": "FT4"]).adifDocument)
        #expect(try ADIFImportPlan(preview: ft4, existing: [existing], duplicatePolicy: .skip).inserts.count == 1)
    }

    @Test("Selected updates preserve absent and unselected fields, including extensions")
    func selectedUpdate() throws {
        let target = try #require(QSO(adif: record(["NAME": "Old", "COMMENT": "Keep", "APP_PRIVATE": "preserved", "LOTW_QSL_RCVD": "Y"])))
        let incoming = record(["NAME": "New", "APP_OTHER": "new", "LOTW_QSL_RCVD": "N", "COMMENT": ""])
        let plan = try ADIFImportPlan(preview: ADIFImportPreview(text: incoming.adifDocument), existing: [target],
                                      duplicatePolicy: .updateFields(["name", "comment", "APP_OTHER", "NOTES"]))
        let update = try #require(plan.updates.first)
        #expect(update.targetID == target.id)
        #expect(update.record["NAME"] == "New")
        #expect(update.record["COMMENT"] == "")
        #expect(update.record["APP_PRIVATE"] == "preserved")
        #expect(update.record["APP_OTHER"] == "new")
        #expect(update.record["LOTW_QSL_RCVD"] == "Y")
        #expect(target.name == "Old")
        #expect(throws: ADIFPlanningError.identityFieldUpdate) {
            try ADIFImportPlan(preview: ADIFImportPreview(text: incoming.adifDocument), existing: [target], duplicatePolicy: .updateFields(["TIME_ON"]))
        }
    }

    @Test("Ambiguous local targets reject; tombstones never become update targets")
    func ambiguousTargets() throws {
        let target = try #require(QSO(adif: record()))
        var other = target; other.id = UUID()
        let preview = ADIFImportPreview(text: record().adifDocument)
        #expect(throws: ADIFPlanningError.ambiguousDuplicate(recordNumber: 1)) {
            try ADIFImportPlan(preview: preview, existing: [target, other], duplicatePolicy: .skip)
        }
        other.deletedAt = Date()
        #expect(try ADIFImportPlan(preview: preview, existing: [other], duplicatePolicy: .skip).inserts.count == 1)
    }

    @Test("Snapshot scope remains frozen across database writes without sync side effects")
    func snapshotScope() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("fixture.sqlite"))
        var first = try #require(QSO(adif: record(["APP_TEST": "Žilina 😀", "QSL_RCVD": "Y"])))
        var second = first; second.id = UUID(); second.call = "K2ABC"
        try database.save(first, markDirty: false); try database.save(second, markDirty: false)
        let snapshot = try database.adifExportSnapshot(scope: .selected([first.id]))
        first.comment = "later edit"; try database.save(first, markDirty: false)
        second.deletedAt = Date(); try database.save(second, markDirty: false)
        #expect(snapshot.contactIDs == [first.id])
        #expect(snapshot.records.count == 1)
        #expect(snapshot.records[0]["COMMENT"] == nil)
        #expect(snapshot.records[0]["APP_TEST"] == "Žilina 😀")
        let preview = ADIFImportPreview(text: snapshot.document)
        #expect(preview.issues.isEmpty && preview.records == snapshot.records)
        #expect(snapshot.document.components(separatedBy: "<EOH>").count == 2)
        #expect(try database.adifExportSnapshot(scope: .all).records.count == 1)
        #expect(try database.adifExportSnapshot(scope: .selected([])).records.isEmpty)
        #expect(try database.pendingSyncCount() == 0)
        #expect(try database.outboxCount() == 0)
    }
}
