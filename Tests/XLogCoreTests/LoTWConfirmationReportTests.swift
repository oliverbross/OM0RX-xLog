import Foundation
import Testing
@testable import XLogCore

@Suite("LoTW confirmation report envelope")
struct LoTWConfirmationReportTests {
    private let parser = LoTWConfirmationReportParser()
    private func field(_ name: String, _ value: String) -> String { "<\(name):\(value.utf8.count)>\(value)" }
    private func header(_ count: String = "1", watermark: String? = "2026-10-16 01:02:03") -> String {
        field("PROGRAMID", "LoTW") + field("APP_LoTW_NUMREC", count)
            + (watermark.map { field("APP_LoTW_LASTQSL", $0) } ?? "") + "<EOH>\n"
    }
    private func record(mode: String? = "CW", status: String = "Y") -> String {
        field("STATION_CALLSIGN", "OM0RX") + field("CALL", "VK8NSB") + field("BAND", "20m")
            + field("QSO_DATE", "20261015") + field("TIME_ON", "123456")
            + (mode.map { field("MODE", $0) } ?? "") + field("QSL_RCVD", status)
            + (status == "Y" ? field("QSLRDATE", "20261016") + field("APP_LoTW_RXQSL", "2026-10-16 01:02:03") : "")
    }

    @Test func validReportRetainsOnlyLoTWEvidenceAndIsDeterministic() throws {
        let input = "LoTW report\n" + header() + record() + "<EOR>"
        let result = try parser.parse(input)
        let repeated = try parser.parse(input)
        #expect(result == repeated)
        #expect(result.declaredRecordCount == 1)
        #expect(result.lastQSL == "2026-10-16 01:02:03")
        #expect(!result.hasDeprecatedEOFMarker)
        let row = try #require(result.records.first)
        #expect(row.stationCallsign == "OM0RX")
        #expect(row.workedCallsign == "VK8NSB")
        #expect(row.band == "20m")
        #expect(row.qsoDate == "20261015")
        #expect(row.timeOn == "123456")
        #expect(row.mode == "CW")
        #expect(row.confirmation.status == .confirmed)
        #expect(row.confirmation.qslReceivedDate == "20261016")
        #expect(row.confirmation.receivedQSLTimestamp == result.lastQSL)
    }

    @Test func legitimateZeroRecordReports() throws {
        for watermark in [nil, "2026-10-16 01:02:03"] as [String?] {
            let result = try parser.parse(header("0", watermark: watermark))
            #expect(result.records.isEmpty)
            #expect(result.lastQSL == watermark)
        }
    }

    @Test func deprecatedEOFTailNeedsNoEOR() throws {
        let result = try parser.parse(header() + record() + "<EOR>\n<APP_LoTW_EOF>\n")
        #expect(result.hasDeprecatedEOFMarker)
        #expect(result.records.count == 1)
        #expect(try parser.parse(header("0", watermark: nil) + "<APP_LoTW_EOF:0>").records.isEmpty)
        #expect(throws: LoTWReportError.self) { try parser.parse(header() + record() + "<APP_LoTW_EOF>") }
        #expect(throws: LoTWReportError.self) { try parser.parse(header() + record() + "<EOR><APP_LoTW_EOF><EOR>") }
    }

    @Test func modeIsOptionalAndAmbiguousLoTWModeIsPreserved() throws {
        let absent = try parser.parse(header() + record(mode: nil) + "<EOR>").records[0]
        #expect(absent.mode == nil)
        #expect(absent.loTWMode == nil)
        let ambiguous = try parser.parse(header() + record(mode: nil) + field("APP_LoTW_MODE", "PHONE") + "<EOR>").records[0]
        #expect(ambiguous.mode == nil)
        #expect(ambiguous.loTWMode == "PHONE")
    }

    @Test func fieldLengthsKeepEmbeddedTerminatorsAsData() throws {
        let comment = field("COMMENT", "<EOR><EOH><APP_LoTW_EOF> café")
        let result = try parser.parse(header() + record() + comment + "<eor>")
        #expect(result.records.count == 1)
        #expect(!result.hasDeprecatedEOFMarker)
    }

    @Test func emptyOrRepeatedRecordAndHeaderTerminatorsAreRejected() {
        for input in [header("0") + "<EOR>", header("0") + "<EOH>",
                      header() + record() + "<EOR><EOR>", header() + record() + "<EOH>"] {
            #expect(throws: LoTWReportError.self) { try parser.parse(input) }
        }
    }

    @Test func unconfirmedStatusDoesNotBecomePaperConfirmation() throws {
        let row = try parser.parse(header() + record(status: "N") + "<EOR>").records[0]
        #expect(row.confirmation.status == .unconfirmed)
        #expect(row.confirmation.qslReceivedDate == nil)
        #expect(throws: LoTWReportError.invalidRecord) {
            try parser.parse(header() + record(status: "N") + field("QSLRDATE", "20261016") + "<EOR>")
        }
    }

    @Test func headerCountAndWatermarkMustBeValid() {
        for input in [header("0") + record() + "<EOR>", header("2") + record() + "<EOR>",
                      header("-1"), header("10001"), header(watermark: nil) + record() + "<EOR>",
                      header(watermark: "2026-02-30 01:02:03") + record() + "<EOR>",
                      header(watermark: "2026-10-15 01:02:03") + record() + "<EOR>",
                      header() + field("APP_LoTW_LASTQSORX", "2026-10-16 01:02:03") + "<EOH>"] {
            #expect(throws: LoTWReportError.self) { try parser.parse(input) }
        }
    }

    @Test func rejectsHTMLAuthenticationErrorsAndMissingEOH() {
        for input in ["<html><body>Login failed</body></html>", "Invalid password", record() + "<EOR>",
                      "<html>" + header("0") + "</html>", "<EOH>", header("0") + "authentication error"] {
            #expect(throws: LoTWReportError.self) { try parser.parse(input) }
        }
    }

    @Test func rejectsTruncationAndMalformedFields() {
        for input in [header() + record(), header() + record() + "<EOR", header() + "<CALL:999>ABC",
                      header() + "<CALL:-1>A", header() + "<CALL:x>A", header() + "<CALL:1:?>A",
                      header() + "<CALL:1:S:extra>A", header() + record() + "<EOR>junk",
                      header() + record().replacingOccurrences(of: "20261015", with: "20260230") + "<EOR>",
                      header() + record().replacingOccurrences(of: "123456", with: "246060") + "<EOR>"] {
            #expect(throws: LoTWReportError.self) { try parser.parse(input) }
        }
    }

    @Test func conflictingDuplicatesAreRejectedButIdenticalFieldsAreStable() throws {
        #expect(throws: LoTWReportError.conflictingField) {
            try parser.parse(header() + record() + field("call", "W1AW") + "<EOR>")
        }
        #expect(throws: LoTWReportError.conflictingField) {
            try parser.parse(field("PROGRAMID", "other") + header() + record() + "<EOR>")
        }
        #expect(throws: LoTWReportError.conflictingField) {
            try parser.parse(header() + record() + field("APP_LoTW_OWNCALL", "W1AW") + "<EOR>")
        }
        #expect(try parser.parse(header() + record() + field("CALL", "VK8NSB") + "<EOR>").records.count == 1)
        let legacy = record().replacingOccurrences(of: "STATION_CALLSIGN", with: "APP_LoTW_OWNCALL")
        #expect(try parser.parse(header() + legacy + "<EOR>").records[0].stationCallsign == "OM0RX")
    }

    @Test func boundsInputFieldsAndRecords() {
        #expect(throws: LoTWReportError.limitExceeded) {
            try parser.parse(String(repeating: "x", count: LoTWConfirmationReportParser.maximumInputBytes + 1))
        }
        #expect(throws: LoTWReportError.limitExceeded) {
            try parser.parse(header() + "<COMMENT:16385>" + String(repeating: "x", count: 16_385))
        }
        #expect(throws: LoTWReportError.limitExceeded) {
            try parser.parse(header() + String(repeating: field("X", ""), count: 257))
        }
        #expect(throws: LoTWReportError.limitExceeded) {
            try parser.parse(header("10001") + String(repeating: record() + "<EOR>", count: 10_001))
        }
    }
}
