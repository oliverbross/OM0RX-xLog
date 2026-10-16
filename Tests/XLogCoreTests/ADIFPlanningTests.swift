import Foundation
import Testing
@testable import XLogCore

@Suite("Read-only ADIF review and export")
struct ADIFPlanningTests {
    @Test("Audited import-only modes export under their ADIF parent", arguments: ["C4FM", "DSTAR", "c4fm", "dstar", "PSK31", "psk31", "PSK63", "psk63", "PSK63F", "psk63f", "PSK125", "psk125", "PSKAM10", "pskam10", "PSKAM31", "pskam31", "PSKAM50", "pskam50", "PSKFEC31", "pskfec31", "PSKHELL", "pskhell", "QPSK31", "qpsk31", "QPSK63", "qpsk63"])
    func deprecatedModeExport(_ mode: String) throws {
        let source = record(["MODE": mode, "SUBMODE": "", "APP_OTHER_DATA": "opaque é",
                             "BAND_RX": "70cm", "FREQ_RX": "433.500000"])
        let qso = try #require(QSO(adif: source))
        let exported = qso.adifRecord
        #expect(qso.mode == mode.uppercased() && qso.submode.isEmpty)
        #expect(exported["MODE"] == (["PSK31", "PSK63", "PSK63F", "PSK125", "PSKAM10", "PSKAM31", "PSKAM50", "PSKFEC31", "QPSK31", "QPSK63"].contains(qso.mode) ? "PSK" : (qso.mode == "PSKHELL" ? "HELL" : "DIGITALVOICE")) && exported["SUBMODE"] == qso.mode)
        #expect(exported["APP_OTHER_DATA"] == source["APP_OTHER_DATA"])
        #expect(exported["BAND_RX"] == "70cm" && exported["FREQ_RX"] == "433.500000")
        let plan = try ADIFImportPlan(preview: ADIFImportPreview(text: exported.adifDocument), existing: [qso], duplicatePolicy: .skip)
        #expect(plan.inserts.isEmpty && plan.updates.isEmpty && plan.skippedRecordNumbers == [1])
        #expect(exported.adifDocument.contains("<ADIF_VER:5>3.1.7"))
        let reparsed = try #require(ADIFParser().records(in: exported.adifDocument).first)
        #expect(try #require(QSO(adif: reparsed)).adifRecord == exported)
        #expect(ADIFExportSnapshot(contacts: [qso], scope: .all).records == [exported])
    }

    @Test("Audited deprecated mode export retains explicit submodes and unknown modes")
    func digitalVoiceExplicitAndUnknownExport() throws {
        let explicit = try #require(QSO(adif: record(["MODE": "DSTAR", "SUBMODE": "vendor-submode"])))
        #expect(explicit.adifRecord["MODE"] == "DIGITALVOICE")
        #expect(explicit.adifRecord["SUBMODE"] == explicit.submode)
        let psk = try #require(QSO(adif: record(["MODE": "PSK31", "SUBMODE": "vendor-submode"])))
        #expect(psk.adifRecord["MODE"] == "PSK" && psk.adifRecord["SUBMODE"] == psk.submode)
        let psk63 = try #require(QSO(adif: record(["MODE": "PSK63", "SUBMODE": "vendor-submode"])))
        #expect(psk63.adifRecord["MODE"] == "PSK" && psk63.adifRecord["SUBMODE"] == psk63.submode)
        let psk63f = try #require(QSO(adif: record(["MODE": "PSK63F", "SUBMODE": "vendor-submode"])))
        #expect(psk63f.adifRecord["MODE"] == "PSK" && psk63f.adifRecord["SUBMODE"] == psk63f.submode)
        let psk125 = try #require(QSO(adif: record(["MODE": "PSK125", "SUBMODE": "vendor-submode"])))
        #expect(psk125.adifRecord["MODE"] == "PSK" && psk125.adifRecord["SUBMODE"] == psk125.submode)
        let pskam10 = try #require(QSO(adif: record(["MODE": "PSKAM10", "SUBMODE": "vendor-submode"])))
        #expect(pskam10.adifRecord["MODE"] == "PSK" && pskam10.adifRecord["SUBMODE"] == pskam10.submode)
        let pskam31 = try #require(QSO(adif: record(["MODE": "PSKAM31", "SUBMODE": "vendor-submode"])))
        #expect(pskam31.adifRecord["MODE"] == "PSK" && pskam31.adifRecord["SUBMODE"] == pskam31.submode)
        let pskam50 = try #require(QSO(adif: record(["MODE": "PSKAM50", "SUBMODE": "vendor-submode"])))
        #expect(pskam50.adifRecord["MODE"] == "PSK" && pskam50.adifRecord["SUBMODE"] == pskam50.submode)
        let pskfec31 = try #require(QSO(adif: record(["MODE": "PSKFEC31", "SUBMODE": "vendor-submode"])))
        #expect(pskfec31.adifRecord["MODE"] == "PSK" && pskfec31.adifRecord["SUBMODE"] == pskfec31.submode)
        let pskhell = try #require(QSO(adif: record(["MODE": "PSKHELL", "SUBMODE": "vendor-submode"])))
        #expect(pskhell.adifRecord["MODE"] == "HELL" && pskhell.adifRecord["SUBMODE"] == pskhell.submode)
        let qpsk31 = try #require(QSO(adif: record(["MODE": "QPSK31", "SUBMODE": "vendor-submode"])))
        #expect(qpsk31.adifRecord["MODE"] == "PSK" && qpsk31.adifRecord["SUBMODE"] == qpsk31.submode)
        let qpsk63 = try #require(QSO(adif: record(["MODE": "QPSK63", "SUBMODE": "vendor-submode"])))
        #expect(qpsk63.adifRecord["MODE"] == "PSK" && qpsk63.adifRecord["SUBMODE"] == qpsk63.submode)
        let unknown = try #require(QSO(adif: record(["MODE": "FUTURE_MODE", "SUBMODE": "FUTURE_SUBMODE"])))
        #expect(unknown.adifRecord["MODE"] == "FUTURE_MODE")
        #expect(unknown.adifRecord["SUBMODE"] == "FUTURE_SUBMODE")
    }

    @Test("Editor MFSK submodes export with their ADIF parent without rewriting local contacts", arguments: ["FT4", "FT2", "JTTY"])
    func editorMFSKSubmodeExport(_ mode: String) throws {
        let source = record(["MODE": mode, "SUBMODE": "", "APP_OTHER_DATA": "opaque é", "BAND_RX": "40m",
                             "FREQ_RX": "7.025000", "STATION_CALLSIGN": "OM0RX", "OPERATOR": "K1ABC"])
        let qso = try #require(QSO(adif: source))
        let exported = qso.adifRecord
        #expect(qso.mode == mode && qso.submode.isEmpty)
        #expect(exported["MODE"] == "MFSK" && exported["SUBMODE"] == mode)
        #expect(exported["APP_OTHER_DATA"] == "opaque é")
        #expect(exported["BAND_RX"] == "40m" && exported["FREQ_RX"] == "7.025000")
        #expect(exported["STATION_CALLSIGN"] == "OM0RX" && exported["OPERATOR"] == "K1ABC")
        let parsed = try #require(ADIFParser().records(in: exported.adifDocument).first)
        #expect(try #require(QSO(adif: parsed)).adifRecord == exported)
        #expect(ADIFExportSnapshot(contacts: [qso], scope: .all).records == [exported])
    }

    @Test("Export preserves explicit submode and FT8's independent ADIF mode")
    func explicitSubmodeExport() throws {
        let explicit = try #require(QSO(adif: record(["MODE": "FT4", "SUBMODE": "Q65"])))
        #expect(explicit.adifRecord["MODE"] == "MFSK" && explicit.adifRecord["SUBMODE"] == "Q65")
        let ft8 = try #require(QSO(adif: record(["MODE": "FT8", "SUBMODE": ""])))
        #expect(ft8.adifRecord["MODE"] == "FT8" && ft8.adifRecord["SUBMODE"] == nil)
    }

    @Test("Compatibility reader respects UTF-8 lengths and embedded terminators")
    func compatibilityReaderByteLengths() throws {
        let first = record(["COMMENT": "Žilina <EOR> <EOH> 😀", "APP_OTHER_DATA": "éß",
                            "STATION_CALLSIGN": "OM0RX", "OPERATOR": "K1ABC", "FREQ": "14.025000",
                            "BAND_RX": "40m", "FREQ_RX": "7.025000", "RX_PWR": "50", "TX_PWR": "100"])
        let second = record(["CALL": "W1AW", "SUBMODE": "JTTY", "CONTEST_ID": "SKCC-SKS", "REGION": "ET"])
        let source = "ß legacy preamble\r\n<adif_ver:5>3.1.8<eoh>\r\n" + first.recordDocument + "\r\n" + second.recordDocument
        #expect(ADIFParser().records(in: source) == [first, second])
        #expect(ADIFImportPreview(text: source).records == [first, second])
        let qso = try #require(QSO(adif: first))
        #expect(qso.adifRecord["APP_OTHER_DATA"] == "éß")
        #expect(qso.adifRecord["BAND_RX"] == "40m")
        #expect(qso.adifRecord["FREQ_RX"] == "7.025000")
        #expect(qso.adifRecord["RX_PWR"] == "50")
        #expect(qso.adifRecord["STATION_CALLSIGN"] == "OM0RX")
        #expect(qso.adifRecord["OPERATOR"] == "K1ABC")
    }

    @Test("Known-record filtering removes complete parsed records in headed and headless documents", arguments: [true, false])
    func compatibilityFiltering(_ headed: Bool) throws {
        let first = record(["COMMENT": "before <EOR> after 😀"])
        let second = record(["CALL": "W1AW", "APP_OTHER_DATA": "Keep <EOH> é"])
        let header = headed ? "<ADIF_VER:5>3.1.8<EOH>\r\n" : ""
        let source = header + first.recordDocument + "\r\n" + second.recordDocument + "\r\n"
        let parser = ADIFParser()
        #expect(parser.removingKnownRecords(from: source, knownFingerprints: []).adif == source)
        let filtered = parser.removingKnownRecords(from: source, knownFingerprints: [try #require(first.semanticIdentityHash)])
        #expect(filtered.records == [second])
        #expect(parser.records(in: filtered.adif) == [second])
        #expect(filtered.adif == (headed ? "<ADIF_VER:5>3.1.8<EOH>" : "") + "\r\n" + second.recordDocument + "\r\n")
    }

    @Test("USERDEF numeric ranges compare exactly while retaining original lexical text", arguments: [
        ["N", "{001.:0003.00}", "0002.500"], ["N", "{-.5:.5}", "-0.000"], ["N", "{-10:-2}", "-2"],
        ["N", "{9007199254740992:9007199254740993}", "9007199254740993"],
        ["N", "{.00000000000000000001:.00000000000000000002}", ".00000000000000000002"],
        ["I", "{-.5:1.5}", "0001"], ["I", "{-999999999999999999999:999999999999999999999}", "-999999999999999999999"]
    ])
    func exactUserdefRange(_ values: [String]) throws {
        let metadata = ADIFFieldMetadata(extensions: ["CUSTOM": .init(kind: "USERDEF", attributes: ["FIELDNAME": "CUSTOM"], declaration: ["FIELDID": "1", "TYPE": values[0], "RANGE": values[1]])])
        try metadata.validate(fields: ["CUSTOM": values[2]])
        let decoded = try JSONDecoder().decode(ADIFFieldMetadata.self, from: JSONEncoder().encode(metadata))
        #expect(decoded.extensions["CUSTOM"]?.declaration?["RANGE"] == values[1])
    }

    @Test("USERDEF rejects malformed, conflicting and out-of-range declarations", arguments: [
        ["N", "{1:3}", "0.999999999999999999999"], ["N", "{1:3}", "3.000000000000000000001"],
        ["N", "{9007199254740992:9007199254740993}", "9007199254740993.0000000001"],
        ["N", "{-10:-2}", "-10.00000000000000001"], ["N", "{-0.:0.000}", "0"],
        ["N", "{3:1}", "2"], ["N", "{1:1}", "1"], ["N", "{+1:3}", "2"], ["N", "{1e0:3}", "2"],
        ["N", "{1,0:3}", "2"], ["N", "{1:3} ", "2"], ["N", "{1:3}\n", "2"], ["N", "{.:3}", "2"],
        ["N", "{1::3}", "2"], ["N", "{1:}", "2"], ["S", "{1:3}", "2"], ["E", "{1:3}", "2"], ["I", "{1:3}", "2.0"]
    ])
    func invalidUserdefRange(_ values: [String]) throws {
        let metadata = ADIFFieldMetadata(extensions: ["CUSTOM": .init(kind: "USERDEF", attributes: ["FIELDNAME": "CUSTOM"], declaration: ["FIELDID": "1", "TYPE": values[0], "RANGE": values[1]])])
        #expect(throws: (any Error).self) { try metadata.validate(fields: ["CUSTOM": values[2]]) }
    }

    @Test("Version-one extension metadata rejects collisions, malformed identities and conflicting declarations")
    func extensionMetadataValidation() throws {
        let fields = ["APP_TEST_FIELD": "0012.50", "CUSTOM": "A", "OTHER": "B", "ADDRESS": "Keep ordinary value",
                      "GUEST_OP": "K1ABC", "VE_PROV": "NS"]
        let app = ADIFFieldMetadata.ExtensionField(kind: "APP", attributes: ["PROGRAMID": "Test", "FIELDNAME": "Field", "TYPE": "n"])
        let custom = ADIFFieldMetadata.ExtensionField(kind: "USERDEF", attributes: ["FIELDNAME": "CUSTOM"], declaration: ["FIELDID": "1", "TYPE": "E", "ENUM": "{A,B}"])
        let valid = ADIFFieldMetadata(extensions: ["APP_TEST_FIELD": app, "CUSTOM": custom])
        try valid.validate(fields: fields)
        var target = try #require(QSO(adif: record(fields))); target.adifFieldMetadata = valid
        let plan = try ADIFImportPlan(preview: ADIFImportPreview(text: record(["NAME": "New"]).adifDocument), existing: [target], duplicatePolicy: .updateFields(["NAME"]))
        #expect(plan.updates.first?.record.fieldMetadata == valid)
        let mismatched = ADIFFieldMetadata(extensions: ["APP_WRONG_FIELD": app])
        #expect(throws: (any Error).self) { try mismatched.validate(fields: fields) }
        let reserved = ADIFFieldMetadata(extensions: ["ADDRESS": .init(kind: "USERDEF", attributes: ["FIELDNAME": "ADDRESS"], declaration: ["FIELDID": "1", "TYPE": "G"])])
        #expect(throws: (any Error).self) { try reserved.validate(fields: fields) }
        for field in ["GUEST_OP", "VE_PROV"] {
            let current = ADIFFieldMetadata(extensions: [field: .init(kind: "USERDEF", attributes: ["FIELDNAME": field], declaration: ["FIELDID": "1", "TYPE": "G"])])
            #expect(throws: (any Error).self) { try current.validate(fields: fields) }
        }
        let repeated = ADIFFieldMetadata(extensions: ["CUSTOM": custom, "OTHER": .init(kind: "USERDEF", attributes: ["FIELDNAME": "OTHER"], declaration: ["FIELDID": "1", "TYPE": "G"])])
        #expect(throws: (any Error).self) { try repeated.validate(fields: fields) }
        var badValues = fields; badValues["APP_TEST_FIELD"] = "NaN"
        #expect(throws: (any Error).self) { try valid.validate(fields: badValues) }
        badValues = fields; badValues["CUSTOM"] = "C"
        #expect(throws: (any Error).self) { try valid.validate(fields: badValues) }
        let unknown = Data(#"{"version":1,"extensions":{},"unknown":"discard me"}"#.utf8)
        #expect(throws: (any Error).self) { try JSONDecoder().decode(ADIFFieldMetadata.self, from: unknown) }
    }

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
