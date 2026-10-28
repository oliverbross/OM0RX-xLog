import Foundation
import XLogCore

struct ReviewCore {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-review-core-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let database = try LogbookDatabase(url: root.appendingPathComponent("test.sqlite"))
        defer { database.close() }
        let good = ADIFRecord(fields: ["CALL":"K1ABC", "QSO_DATE":"20261028", "TIME_ON":"120000", "BAND":"20m", "MODE":"CW"])
        var bad = good
        bad.fields["CALL"] = "K2BAD"
        bad.fields["TIME_ON"] = "12345"
        let text = good.adifDocument + bad.recordDocument
        let records = ADIFParser().records(in: text)
        // Exact data-handling loop in AppModel.importADIF, excluding native chooser/banner.
        for record in records {
            if var qso = QSO(adif: record) {
                qso.isDirty = true
                try database.save(qso)
            }
        }
        let firstCount = try database.count()
        for record in records {
            if var qso = QSO(adif: record) {
                qso.isDirty = true
                try database.save(qso)
            }
        }
        let secondCount = try database.count()
        let strict = ADIFImportPreview(text: text)
        let result: [String: Any] = ["fixtureRoot":root.path, "parserRecords":records.count,
            "legacyBannerClaim":"Imported \(records.count) ADIF records", "actualFirstImport":firstCount,
            "afterRepeat":secondCount, "strictPreviewIssueCount":strict.issues.count]
        print(String(data:try JSONSerialization.data(withJSONObject:result, options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
        precondition(records.count == 2 && firstCount == 1 && secondCount == 2 && !strict.issues.isEmpty)
    }
}

try ReviewCore.main()
