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

    func testDeclarativeOperatorArchiveMapsSerialAndNameFields() throws {
        let rule = try CWUniqueCallDeclarativeDefinitions.archiveRule(for: .cwOpen)
        let sent = ["serial": field("001"), "name": field("OLIVER")]
        let received = ["serial": field("007"), "name": field("AL")]
        let input = declarativeInput(rule: rule, sent: sent, received: received,
                                     rawSent: "001 OLIVER", rawReceived: "007 AL")
        _ = try input.validatedScore(rule: rule)
        let record = try XCTUnwrap(ContestADIFExport.records(input: input, rule: rule).first)

        XCTAssertEqual(record["STX"], "1")
        XCTAssertEqual(record["SRX"], "7")
        XCTAssertEqual(record["MY_NAME"], "OLIVER")
        XCTAssertEqual(record["NAME"], "AL")
    }

    func testTenTenOperatorArchiveMapsNamesWithoutInventingSerialFields() throws {
        let rule = try TenTenDeclarativeDefinitions.archiveRule(for: .winterPhone)
        let sent = tenTenFields(name: "OLIVER", member: "1234", qth: "AUSTRALIA")
        let received = tenTenFields(name: "MARY-JANE", member: "0", qth: "NEW YORK")
        let record = try XCTUnwrap(ContestADIFExport.records(
            input: declarativeInput(rule: rule, sent: sent, received: received,
                                    rawSent: "OLIVER 1234 AUSTRALIA", rawReceived: "MARY-JANE 0 NEW YORK",
                                    mode: "SSB", frequency: 28_500_000, sentReport: "59", receivedReport: "59"),
            rule: rule).first)

        XCTAssertEqual(record["MY_NAME"], "OLIVER")
        XCTAssertEqual(record["NAME"], "MARY-JANE")
        XCTAssertNil(record["STX"])
        XCTAssertNil(record["SRX"])
    }

    func testDescriptorMappedFieldsRejectsWrongSideDuplicateAndMalformedValues() throws {
        let name = ContestExchangeFieldDescriptor(id: "name", label: "Name", acceptedKinds: [.operatorName],
                                                  maximumUTF8Bytes: 32, adifField: .myName)
        let duplicate = ContestExchangeFieldDescriptor(id: "other-name", label: "Other name",
                                                       acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                                                       adifField: .myName)
        let wrongSide = ContestExchangeFieldDescriptor(id: "name", label: "Name",
                                                       acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                                                       adifField: .name)
        let serial = ContestExchangeFieldDescriptor(id: "serial", label: "Serial",
                                                    acceptedKinds: [.serialNumber], maximumUTF8Bytes: 8,
                                                    adifField: .stx)
        let grid = ContestExchangeFieldDescriptor(id: "grid", label: "Grid",
                                                  acceptedKinds: [.maidenheadGrid4], maximumUTF8Bytes: 4,
                                                  adifField: .myGridSquare)

        XCTAssertThrowsError(try ContestADIFExport.descriptorMappedFields(
            sentDescriptors: [wrongSide], receivedDescriptors: [], sentValues: ["name": field("OLIVER")],
            receivedValues: [:], stationCallsign: "OM0RX", stationEntity: om,
            workedCallsign: "K1ABC", workedEntity: usa))
        XCTAssertThrowsError(try ContestADIFExport.descriptorMappedFields(
            sentDescriptors: [name, duplicate], receivedDescriptors: [],
            sentValues: ["name": field("OLIVER"), "other-name": field("AL")], receivedValues: [:],
            stationCallsign: "OM0RX", stationEntity: om, workedCallsign: "K1ABC", workedEntity: usa))
        XCTAssertThrowsError(try ContestADIFExport.descriptorMappedFields(
            sentDescriptors: [serial], receivedDescriptors: [], sentValues: ["serial": field("ABC")],
            receivedValues: [:], stationCallsign: "OM0RX", stationEntity: om,
            workedCallsign: "K1ABC", workedEntity: usa))
        XCTAssertThrowsError(try ContestADIFExport.descriptorMappedFields(
            sentDescriptors: [grid], receivedDescriptors: [], sentValues: ["grid": field("ZZ99")],
            receivedValues: [:], stationCallsign: "OM0RX", stationEntity: om,
            workedCallsign: "K1ABC", workedEntity: usa))
    }

    func testDescriptorMappedStateRequiresApplicableNonmobileEntity() throws {
        let state = ContestExchangeFieldDescriptor(id: "state", label: "State", acceptedKinds: [.locationText],
                                                   maximumUTF8Bytes: 32, adifField: .state)
        let applicable = try ContestADIFExport.descriptorMappedFields(
            sentDescriptors: [], receivedDescriptors: [state], sentValues: [:],
            receivedValues: ["state": field("CA")], stationCallsign: "OM0RX", stationEntity: om,
            workedCallsign: "K1ABC", workedEntity: usa)
        let foreign = try ContestADIFExport.descriptorMappedFields(
            sentDescriptors: [], receivedDescriptors: [state], sentValues: [:],
            receivedValues: ["state": field("CA")], stationCallsign: "OM0RX", stationEntity: om,
            workedCallsign: "DL1ABC", workedEntity: om)
        let mobile = try ContestADIFExport.descriptorMappedFields(
            sentDescriptors: [], receivedDescriptors: [state], sentValues: [:],
            receivedValues: ["state": field("CA")], stationCallsign: "OM0RX", stationEntity: om,
            workedCallsign: "K1ABC/MM", workedEntity: usa)

        XCTAssertEqual(applicable["STATE"], "CA")
        XCTAssertNil(foreign["STATE"])
        XCTAssertNil(mobile["STATE"])
    }

    private func declarativeInput(rule: DeclarativeContestRule,
                                  sent: [String: ContestExchangeFieldValue],
                                  received: [String: ContestExchangeFieldValue],
                                  rawSent: String, rawReceived: String,
                                  mode: String = "CW", frequency: Int64 = 14_030_000,
                                  sentReport: String = "", receivedReport: String = "") -> ContestExportInput {
        let stationFields = sent.filter { $0.key != "serial" }
        let stationExchange = rule.metadata.entry.exchange.sentFields.compactMap {
            stationFields[$0.id]?.raw
        }.joined(separator: " ")
        let session = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "fixture-cty-1", startedAt: date,
            station: .init(callsign: "OM0RX", entity: nil, sentExchange: stationExchange,
                           operatorCallsigns: ["OM0RX"], location: "DX", sentExchangeFields: stationFields))
        let qso = ContestQSO(
            id: UUID(uuidString: "40000000-0000-0000-0000-000000000006")!, sessionID: sessionID,
            timestampUTC: date, callsign: "K1ABC", band: mode == "CW" ? "20m" : "10m", mode: mode,
            frequencyHz: frequency, rstSent: sentReport, rstReceived: receivedReport,
            exchange: .init(rawSent: rawSent, normalizedSent: rawSent,
                            rawReceived: rawReceived, normalizedReceived: rawReceived,
                            sentFields: sent, receivedFields: received), entity: nil,
            operatorCallsign: "OM0RX", stationLocation: "DX", provenance: .init(source: .operatorEntry))
        let header = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                    categoryMode: mode == "CW" ? "CW" : "SSB", categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: ["OM0RX"], location: "DX")
        return ContestExportInput(
            formatterVersion: rule.metadata.entry.cabrilloFormatterVersion,
            generatedAtUTC: date.addingTimeInterval(60), sessionRevision: 9,
            session: session, ruleIdentity: rule.metadata.identity, referenceDataVersion: "fixture-cty-1",
            metadata: .init(sessionName: "Operator archive", operatorCallsign: "OM0RX",
                            operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: [qso])
    }

    private func field(_ value: String) -> ContestExchangeFieldValue {
        .init(raw: value, normalized: value)
    }

    private func tenTenFields(name: String, member: String, qth: String) -> [String: ContestExchangeFieldValue] {
        ["name": field(name), "member-number": field(member), "qth": field(qth)]
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
