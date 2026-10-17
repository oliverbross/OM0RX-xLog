import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#elseif canImport(XLogPortableCore)
import XLogPortableCore
#endif

final class ContestADIFExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "30000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "f0000000-0000-0000-8000-000000000009")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testWPXRecordsRoundTripExactUTCSerialFrequencyAndProvenanceExtensions() throws {
        let rule = CQWPXCWRule()
        let input = makeInput(rule: rule)
        let records = try ContestADIFExport.records(input: input, rule: rule)
        let record = try XCTUnwrap(records.first)

        XCTAssertEqual(record["QSO_DATE"], "20231114")
        XCTAssertEqual(record["TIME_ON"], "221320")
        XCTAssertEqual(record["FREQ"], "14.025123")
        XCTAssertEqual(record["STX_STRING"], "001")
        XCTAssertEqual(record["SRX_STRING"], "007")
        XCTAssertEqual(record["STX"], "1")
        XCTAssertEqual(record["SRX"], "7")
        XCTAssertEqual(record["CONTEST_ID"], "CQ-WPX-CW")
        XCTAssertEqual(record["APP_OM0RXXLOG_SESSION_ID"], sessionID.uuidString.lowercased())
        XCTAssertEqual(record["APP_OM0RXXLOG_WORKSPACE_GENERATION"], generation.uuidString.lowercased())
        XCTAssertEqual(record["APP_OM0RXXLOG_REFERENCE_DATA_VERSION"], "fixture-cty-1")
        XCTAssertEqual(record["APP_OM0RXXLOG_PROVENANCE_IDENTITY"], "import-file-01")
        XCTAssertNoThrow(try record.fieldMetadata?.validate(fields: record.fields))

        let document = try ContestADIFExport.document(input: input, rule: rule)
        XCTAssertTrue(document.hasPrefix("<ADIF_VER:5>3.1.7<PROGRAMID:10>OM0RX-xLog<PROGRAMVERSION:7>pilot-1<CREATED_TIMESTAMP:15>20231114 221420<EOH>\r\n"))
        XCTAssertTrue(document.contains("<STX_STRING:3>001"))
        XCTAssertTrue(document.contains("<APP_OM0RXXLOG_PROVENANCE_IDENTITY:14>import-file-01"))
        let reparsed = try XCTUnwrap(ADIFParser().records(in: document).first)
        XCTAssertEqual(reparsed.fields, record.fields)
    }

    func testWWUsesStringExchangeWithoutNumericSerialFields() throws {
        let rule = CQWWCWRule()
        let contact = qso(id: "40000000-0000-0000-0000-000000000001", call: "K1ABC", offset: 0,
                          sent: "15", received: "05")
        let record = try XCTUnwrap(ContestADIFExport.records(input: makeInput(rule: rule, qsos: [contact], sentExchange: "15"), rule: rule).first)
        XCTAssertEqual(record["STX_STRING"], "15")
        XCTAssertEqual(record["SRX_STRING"], "05")
        XCTAssertNil(record["STX"])
        XCTAssertNil(record["SRX"])
    }

    func testADIFOrderingUsesUTCThenFullUUID() throws {
        let rule = CQWPXCWRule()
        let first = qso(id: "40000000-0000-0000-0000-000000000001", call: "K1AAA", offset: 0)
        let second = qso(id: "40000000-0000-0000-0000-000000000002", call: "K2BBB", offset: 0)
        let input = makeInput(rule: rule, qsos: [second, first])
        XCTAssertEqual(try ContestADIFExport.records(input: input, rule: rule).map { $0["CALL"] }, ["K1AAA", "K2BBB"])
    }

    func testADIFRejectsContradictoryReferenceAndDoesNotClaimUnknownImportFields() {
        let rule = CQWPXCWRule()
        let invalid = makeInput(rule: rule, referenceDataVersion: "other")
        XCTAssertThrowsError(try ContestADIFExport.records(input: invalid, rule: rule)) {
            XCTAssertEqual($0 as? ContestADIFExportError, .invalidInput)
        }
        XCTAssertNil(try? ContestADIFExport.records(input: invalid, rule: rule).first?["APP_VENDOR_UNKNOWN"])
    }

    func testADIFRejectsSemanticInvalidsRawUnicodeAndFrozenMetadataContradictions() {
        let rule = CQWPXCWRule()
        let badFrequency = qso(id: "40000000-0000-0000-0000-000000000001", call: "K1ABC", offset: 0,
                               frequency: 7_025_000)
        XCTAssertThrowsError(try ContestADIFExport.records(input: makeInput(rule: rule, qsos: [badFrequency]), rule: rule))
        let badMode = qso(id: "40000000-0000-0000-0000-000000000004", call: "K1ABC", offset: 0, mode: "SSB")
        XCTAssertThrowsError(try ContestADIFExport.records(input: makeInput(rule: rule, qsos: [badMode]), rule: rule))
        let badExchange = qso(id: "40000000-0000-0000-0000-000000000005", call: "K1ABC", offset: 0, received: "000")
        XCTAssertThrowsError(try ContestADIFExport.records(input: makeInput(rule: rule, qsos: [badExchange]), rule: rule))
        let badRaw = qso(id: "40000000-0000-0000-0000-000000000002", call: "K1ABC", offset: 0,
                         received: "007é")
        XCTAssertThrowsError(try ContestADIFExport.records(input: makeInput(rule: rule, qsos: [badRaw]), rule: rule))
        let badOperator = qso(id: "40000000-0000-0000-0000-000000000003", call: "K1ABC", offset: 0,
                              operatorCallsign: "OTHER")
        XCTAssertThrowsError(try ContestADIFExport.records(input: makeInput(rule: rule, qsos: [badOperator]), rule: rule))
        XCTAssertThrowsError(try ContestADIFExport.records(input: makeInput(rule: rule, categoryMode: "SSB"), rule: rule))
        XCTAssertThrowsError(try ContestADIFExport.records(input: makeInput(rule: rule, categoryBand: "40M"), rule: rule))
    }

    private func makeInput(rule: any ContestRule, qsos: [ContestQSO]? = nil,
                           referenceDataVersion: String = "fixture-cty-1", sentExchange: String = "001",
                           categoryMode: String = "CW", categoryBand: String = "ALL") -> ContestExportInput {
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
                                             rule: rule.metadata.identity, referenceDataVersion: "fixture-cty-1",
                                             startedAt: date, station: .init(callsign: "OM0RX", entity: om,
                                             sentExchange: sentExchange, operatorCallsigns: ["OM0RX"], location: "DX"))
        let header = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: categoryBand, categoryMode: categoryMode,
                                    categoryTransmitter: "ONE", categoryPower: "LOW", operators: ["OM0RX"], location: "DX")
        return ContestExportInput(generatedAtUTC: date.addingTimeInterval(60), sessionRevision: 9,
                                  session: session, ruleIdentity: rule.metadata.identity,
                                  referenceDataVersion: referenceDataVersion,
                                  metadata: .init(sessionName: "ADIF pilot", operatorCallsign: "OM0RX",
                                                  operatorCategory: "SINGLE-OP", cabrilloHeader: header),
                                  qsos: qsos ?? [qso(id: "40000000-0000-0000-0000-000000000001", call: "K1ABC", offset: 0)])
    }

    private func qso(id: String, call: String, offset: TimeInterval, frequency: Int64 = 14_025_123, mode: String = "CW",
                     sent: String = "001", received: String = "007", operatorCallsign: String = "OM0RX") -> ContestQSO {
        ContestQSO(id: UUID(uuidString: id)!, sessionID: sessionID,
                   timestampUTC: date.addingTimeInterval(offset), callsign: call, band: "20m", mode: mode,
                   frequencyHz: frequency, rstSent: "599", rstReceived: "599",
                   exchange: .init(rawSent: sent, normalizedSent: sent.filter(\.isNumber),
                                   rawReceived: received, normalizedReceived: received.filter(\.isNumber)),
                   entity: usa, operatorCallsign: operatorCallsign, stationLocation: "DX",
                   provenance: .init(source: .importFile, sourceIdentity: "import-file-01", importedClaimedScore: 3))
    }
}
