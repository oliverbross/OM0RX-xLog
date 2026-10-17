import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#elseif canImport(XLogPortableCore)
import XLogPortableCore
#endif

final class ContestNAQPADIFExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "F1000000-0000-0000-8000-000000000001")!
    private let generation = UUID(uuidString: "F2000000-0000-0000-8000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let dominican = ContestEntitySnapshot(adif: 72, name: "DOMINICAN REPUBLIC", countryPrefix: "HI", continent: "NA", cqZone: 8)
    private let unitedNations = ContestEntitySnapshot(adif: 289, name: "UNITED NATIONS HQ", countryPrefix: "4U1U", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testAllModesProjectNamesExchangeStringsAndNoReports() throws {
        let cases: [(any ContestRule, String)] = [(NAQPCWRule(), "CW"), (NAQPSSBRule(), "SSB"), (NAQPRTTYRule(), "RTTY")]
        for (rule, expectedMode) in cases {
            let record = try XCTUnwrap(ContestADIFExport.records(input: input(rule: rule, entity: canada,
                                                                              receivedName: "BOB", receivedLocation: "ON"),
                                                                    rule: rule).first)
            XCTAssertEqual(record["MODE"], expectedMode)
            XCTAssertEqual(record["MY_NAME"], "AL")
            XCTAssertEqual(record["NAME"], "BOB")
            XCTAssertEqual(record["MY_STATE"], "CA")
            XCTAssertEqual(record["STATE"], "ON")
            XCTAssertEqual(record["STX_STRING"], "AL CA")
            XCTAssertEqual(record["SRX_STRING"], "BOB ON")
            XCTAssertNil(record["RST_SENT"])
            XCTAssertNil(record["RST_RCVD"])
            XCTAssertNil(record["STX"])
            XCTAssertNil(record["SRX"])
        }
    }

    func testCountryPrefixAndDXLocationsAreNotMisrepresentedAsADIFState() throws {
        let rule = NAQPCWRule()
        for (entity, call, name, location) in [
            (dominican, "HI8AAA", "LUIS", "HI"),
            (unitedNations, "4U1UN", "PAT", "4U1/U"),
            (germany, "DL1AAA", "HANS", "DX"),
        ] {
            let record = try XCTUnwrap(ContestADIFExport.records(input: input(rule: rule, entity: entity,
                                                                              call: call, receivedName: name,
                                                                              receivedLocation: location), rule: rule).first)
            XCTAssertNil(record["STATE"], call)
            XCTAssertEqual(record["NAME"], name)
            XCTAssertEqual(record["SRX_STRING"], "\(name) \(location)")
        }
    }

    func testAirAndMaritimeMobileDXNeverEmitAdministrativeState() throws {
        let rule = NAQPCWRule()
        for callsign in ["K1ABC/MM", "K1ABC/AM"] {
            let record = try XCTUnwrap(ContestADIFExport.records(
                input: input(rule: rule, entity: usa, call: callsign,
                             receivedName: "SAM", receivedLocation: "DX"), rule: rule).first)
            XCTAssertNil(record["STATE"], callsign)
            XCTAssertEqual(record["NAME"], "SAM")
            XCTAssertEqual(record["SRX_STRING"], "SAM DX")
            XCTAssertEqual(record["MY_STATE"], "CA")
        }
    }

    func testADIFDocumentRoundTripsTypedNamesAndIdentityExtensions() throws {
        let rule = NAQPRTTYRule()
        let export = input(rule: rule, entity: canada, receivedName: "BOB", receivedLocation: "ON")
        let document = try ContestADIFExport.document(input: export, rule: rule)
        XCTAssertTrue(document.hasPrefix("<ADIF_VER:5>3.1.7"))
        XCTAssertFalse(document.contains("<RST_SENT:"))
        XCTAssertFalse(document.contains("<RST_RCVD:"))
        let record = try XCTUnwrap(ADIFParser().records(in: document).first)
        XCTAssertEqual(record["MODE"], "RTTY")
        XCTAssertEqual(record["NAME"], "BOB")
        XCTAssertEqual(record["MY_NAME"], "AL")
        XCTAssertEqual(record["APP_OM0RXXLOG_RULE_ID"], "naqp-rtty")
        XCTAssertEqual(record["APP_OM0RXXLOG_FORMATTER_VERSION"], "naqp-preview-1")
    }

    func testADIFRejectsControlAndNonASCIIStructuredInput() {
        let rule = NAQPCWRule()
        var export = input(rule: rule, entity: canada, receivedName: "BOB", receivedLocation: "ON")
        let original = export.qsos[0]
        var received = original.exchange.receivedFields
        received["name"] = .init(raw: "B\nOB", normalized: "BOB")
        let bad = ContestQSO(id: original.id, sessionID: original.sessionID,
                             timestampUTC: original.timestampUTC, callsign: original.callsign,
                             band: original.band, mode: original.mode, frequencyHz: original.frequencyHz,
                             rstSent: "", rstReceived: "",
                             exchange: .init(rawSent: original.exchange.rawSent,
                                             normalizedSent: original.exchange.normalizedSent,
                                             rawReceived: "B\nOB ON", normalizedReceived: "BOB ON",
                                             sentFields: original.exchange.sentFields, receivedFields: received),
                             entity: original.entity, operatorCallsign: original.operatorCallsign,
                             stationLocation: original.stationLocation, provenance: original.provenance)
        export = replacingQSOs(export, [bad])
        XCTAssertThrowsError(try ContestADIFExport.records(input: export, rule: rule))

        let unicode = ContestQSO(id: original.id, sessionID: original.sessionID,
                                 timestampUTC: original.timestampUTC, callsign: original.callsign,
                                 band: original.band, mode: original.mode, frequencyHz: original.frequencyHz,
                                 rstSent: "", rstReceived: "",
                                 exchange: .init(rawSent: original.exchange.rawSent,
                                                 normalizedSent: original.exchange.normalizedSent,
                                                 rawReceived: "BOBÉ ON", normalizedReceived: "BOBÉ ON",
                                                 sentFields: original.exchange.sentFields,
                                                 receivedFields: ["name": .init(raw: "BOBÉ", normalized: "BOBÉ"),
                                                                  "location": .init(raw: "ON", normalized: "ON")]),
                                 entity: original.entity, operatorCallsign: original.operatorCallsign,
                                 stationLocation: original.stationLocation, provenance: original.provenance)
        XCTAssertThrowsError(try ContestADIFExport.records(input: replacingQSOs(export, [unicode]), rule: rule))
    }

    private func input(rule: any ContestRule, entity: ContestEntitySnapshot, call: String = "VE3AAA",
                       receivedName: String, receivedLocation: String) -> ContestExportInput {
        let sentFields = fields(name: "AL", location: "CA")
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
                                             rule: rule.metadata.identity, referenceDataVersion: "cty-fixture",
                                             startedAt: date,
                                             station: .init(callsign: "K1AAA", entity: usa,
                                                            sentExchange: "AL CA", operatorCallsigns: ["K1AAA"],
                                                            location: "DX", sentExchangeFields: sentFields))
        let receivedFields = fields(name: receivedName, location: receivedLocation)
        let qso = ContestQSO(id: UUID(uuidString: "F3000000-0000-0000-8000-000000000001")!,
                             sessionID: sessionID, timestampUTC: date, callsign: call,
                             band: "20m", mode: rule.metadata.entry.mode, frequencyHz: 14_050_000,
                             rstSent: "", rstReceived: "",
                             exchange: .init(rawSent: "AL CA", normalizedSent: "AL CA",
                                             rawReceived: "\(receivedName) \(receivedLocation)",
                                             normalizedReceived: "\(receivedName) \(receivedLocation)",
                                             sentFields: sentFields, receivedFields: receivedFields),
                             entity: entity, operatorCallsign: "K1AAA", stationLocation: "DX",
                             provenance: .init(source: .operatorEntry))
        let header = CabrilloHeader(callsign: "K1AAA", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                    categoryMode: rule.metadata.entry.mode, categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: ["K1AAA"], location: "CA", name: "Operator")
        return .init(formatterVersion: "naqp-preview-1", generatedAtUTC: date.addingTimeInterval(60),
                     sessionRevision: 2, session: session, ruleIdentity: rule.metadata.identity,
                     referenceDataVersion: "cty-fixture",
                     metadata: .init(sessionName: "NAQP preview", operatorCallsign: "K1AAA",
                                     operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: [qso])
    }

    private func replacingQSOs(_ input: ContestExportInput, _ qsos: [ContestQSO]) -> ContestExportInput {
        .init(schemaVersion: input.schemaVersion, formatterVersion: input.formatterVersion,
              generatedAtUTC: input.generatedAtUTC, sessionRevision: input.sessionRevision,
              session: input.session, ruleIdentity: input.ruleIdentity,
              referenceDataVersion: input.referenceDataVersion, metadata: input.metadata, qsos: qsos)
    }

    private func fields(name: String, location: String) -> [String: ContestExchangeFieldValue] {
        ["name": .init(raw: name, normalized: name), "location": .init(raw: location, normalized: location)]
    }
}
