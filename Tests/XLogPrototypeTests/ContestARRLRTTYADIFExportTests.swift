import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#elseif canImport(XLogPortableCore)
import XLogPortableCore
#endif

final class ContestARRLRTTYADIFExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "B1000000-0000-0000-8000-000000000001")!
    private let generation = UUID(uuidString: "B2000000-0000-0000-8000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let alaska = ContestEntitySnapshot(adif: 6, name: "ALASKA", countryPrefix: "KL7", continent: "NA", cqZone: 1)
    private let hawaii = ContestEntitySnapshot(adif: 110, name: "HAWAII", countryPrefix: "KH6", continent: "OC", cqZone: 31)

    func testWVEToWVEProjectsReportsStatesStringsAndDXCCSnapshots() throws {
        let record = try XCTUnwrap(ContestADIFExport.records(
            input: input(ownCall: "K1AAA", ownEntity: usa, sent: "CA", ownLocation: "EMA",
                         workedCall: "VE3AAA", workedEntity: canada, received: "ON"),
            rule: ARRLRTTYRoundupRule()).first)
        XCTAssertEqual(record["MODE"], "RTTY")
        XCTAssertEqual(record["RST_SENT"], "599")
        XCTAssertEqual(record["RST_RCVD"], "599")
        XCTAssertEqual(record["STX_STRING"], "CA")
        XCTAssertEqual(record["SRX_STRING"], "ON")
        XCTAssertEqual(record["MY_STATE"], "CA")
        XCTAssertEqual(record["STATE"], "ON")
        XCTAssertEqual(record["MY_DXCC"], "291")
        XCTAssertEqual(record["DXCC"], "1")
        XCTAssertNil(record["STX"])
        XCTAssertNil(record["SRX"])
    }

    func testWVEAndDXDirectionsEmitNumericSerialFieldsOnlyOnDXSide() throws {
        let wveToDX = try XCTUnwrap(ContestADIFExport.records(
            input: input(ownCall: "K1AAA", ownEntity: usa, sent: "CA", ownLocation: "EMA",
                         workedCall: "DL1AAA", workedEntity: germany, received: "007"),
            rule: ARRLRTTYRoundupRule()).first)
        XCTAssertEqual(wveToDX["MY_STATE"], "CA")
        XCTAssertEqual(wveToDX["SRX"], "007")
        XCTAssertNil(wveToDX["STX"])
        XCTAssertNil(wveToDX["STATE"])

        let dxToWVE = try XCTUnwrap(ContestADIFExport.records(
            input: input(ownCall: "DL1DX", ownEntity: germany, sent: "001", ownLocation: "DX",
                         workedCall: "K1BBB", workedEntity: usa, received: "MA"),
            rule: ARRLRTTYRoundupRule()).first)
        XCTAssertEqual(dxToWVE["STX"], "001")
        XCTAssertEqual(dxToWVE["STATE"], "MA")
        XCTAssertNil(dxToWVE["MY_STATE"])
        XCTAssertNil(dxToWVE["SRX"])

        let dxToDX = try XCTUnwrap(ContestADIFExport.records(
            input: input(ownCall: "DL1DX", ownEntity: germany, sent: "001", ownLocation: "DX",
                         workedCall: "DL2DX", workedEntity: germany, received: "008"),
            rule: ARRLRTTYRoundupRule()).first)
        XCTAssertEqual(dxToDX["STX"], "001")
        XCTAssertEqual(dxToDX["SRX"], "008")
        XCTAssertNil(dxToDX["MY_STATE"])
        XCTAssertNil(dxToDX["STATE"])
    }

    func testLBAndNFMapToADIFNLWhileTypedStringsRemainExactAndAlaskaHawaiiRemainDXCC() throws {
        for value in ["LB", "NF"] {
            let record = try XCTUnwrap(ContestADIFExport.records(
                input: input(ownCall: "K1AAA", ownEntity: usa, sent: "CA", ownLocation: "EMA",
                             workedCall: value == "LB" ? "VO2AAA" : "VO1AAA", workedEntity: canada,
                             received: value), rule: ARRLRTTYRoundupRule()).first)
            XCTAssertEqual(record["STATE"], "NL")
            XCTAssertEqual(record["SRX_STRING"], value)
            XCTAssertNil(record["SRX"])

            let sent = try XCTUnwrap(ContestADIFExport.records(
                input: input(ownCall: value == "LB" ? "VO2AAA" : "VO1AAA", ownEntity: canada,
                             sent: value, ownLocation: "NL", workedCall: "K1AAA", workedEntity: usa,
                             received: "CA"), rule: ARRLRTTYRoundupRule()).first)
            XCTAssertEqual(sent["MY_STATE"], "NL")
            XCTAssertEqual(sent["STX_STRING"], value)
            XCTAssertNil(sent["STX"])
        }
        for (entity, call, serial) in [(alaska, "KL7AAA", "011"), (hawaii, "KH6AAA", "012")] {
            let record = try XCTUnwrap(ContestADIFExport.records(
                input: input(ownCall: "K1AAA", ownEntity: usa, sent: "CA", ownLocation: "EMA",
                             workedCall: call, workedEntity: entity, received: serial),
                rule: ARRLRTTYRoundupRule()).first)
            XCTAssertEqual(record["DXCC"], String(entity.adif))
            XCTAssertEqual(record["SRX"], serial)
            XCTAssertNil(record["STATE"])
        }
    }

    func testDocumentRoundTripsIdentityAndRejectsFieldOrTextMismatch() throws {
        let export = input(ownCall: "DL1DX", ownEntity: germany, sent: "001", ownLocation: "DX",
                           workedCall: "K1BBB", workedEntity: usa, received: "MA")
        let document = try ContestADIFExport.document(input: export, rule: ARRLRTTYRoundupRule())
        let record = try XCTUnwrap(ADIFParser().records(in: document).first)
        XCTAssertEqual(record["CONTEST_ID"], "ARRL-RTTY")
        XCTAssertEqual(record["APP_OM0RXXLOG_RULE_ID"], "arrl-rtty-roundup")
        XCTAssertEqual(record["APP_OM0RXXLOG_FORMATTER_VERSION"], "arrl-rtty-preview-1")
        XCTAssertEqual(record["STX"], "001")
        XCTAssertEqual(record["STATE"], "MA")

        let original = export.qsos[0]
        let forged = replacingExchange(original, .init(rawSent: "999", normalizedSent: "001",
            rawReceived: "MA", normalizedReceived: "MA", sentFields: original.exchange.sentFields,
            receivedFields: original.exchange.receivedFields))
        XCTAssertThrowsError(try ContestADIFExport.records(input: replacingQSOs(export, [forged]),
                                                           rule: ARRLRTTYRoundupRule()))
        let control = replacingExchange(original, .init(rawSent: "001", normalizedSent: "001",
            rawReceived: "M\nA", normalizedReceived: "MA", sentFields: original.exchange.sentFields,
            receivedFields: original.exchange.receivedFields))
        XCTAssertThrowsError(try ContestADIFExport.records(input: replacingQSOs(export, [control]),
                                                           rule: ARRLRTTYRoundupRule()))
        let fabricated = ContestEntitySnapshot(adif: 999_999, name: "FABRICATED", countryPrefix: "ZZ",
                                               continent: "EU", cqZone: 14)
        XCTAssertThrowsError(try ContestADIFExport.records(
            input: input(ownCall: "K1AAA", ownEntity: usa, sent: "CA", ownLocation: "EMA",
                         workedCall: "ZZ1AAA", workedEntity: fabricated, received: "001"),
            rule: ARRLRTTYRoundupRule()))
    }

    private func input(ownCall: String, ownEntity: ContestEntitySnapshot, sent: String, ownLocation: String,
                       workedCall: String, workedEntity: ContestEntitySnapshot,
                       received: String) -> ContestExportInput {
        let rule = ARRLRTTYRoundupRule()
        let ownWVE = ownEntity.adif == 291 || ownEntity.adif == 1
        let sentID = ownWVE ? "location" : "serial"
        let stationExchange = ownWVE ? sent : ""
        let stationFields: [String: ContestExchangeFieldValue] = ownWVE ?
            [sentID: .init(raw: sent, normalized: sent)] : [:]
        let station = ContestStationSnapshot(callsign: ownCall, entity: ownEntity, sentExchange: stationExchange,
            operatorCallsigns: [ownCall], location: ownLocation,
            sentExchangeFields: stationFields)
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
            rule: rule.metadata.identity, referenceDataVersion: "arrl-2026-fixture", startedAt: date,
            station: station)
        let qso = ContestQSO(id: UUID(uuidString: "B3000000-0000-0000-8000-000000000001")!,
            sessionID: sessionID, timestampUTC: date, callsign: workedCall, band: "20m", mode: "RTTY",
            frequencyHz: 14_080_000, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received,
                            normalizedReceived: received,
                            sentFields: [sentID: .init(raw: sent, normalized: sent)],
                            receivedFields: ["exchange": .init(raw: received, normalized: received)]),
            entity: workedEntity, operatorCallsign: ownCall, stationLocation: ownLocation,
            provenance: .init(source: .operatorEntry))
        let header = CabrilloHeader(callsign: ownCall, categoryOperator: "SINGLE-OP",
            categoryAssisted: "NON-ASSISTED", categoryBand: "ALL", categoryMode: "RTTY",
            categoryTransmitter: "ONE", categoryPower: "LOW", operators: [ownCall],
            location: ownLocation, name: "Operator")
        return .init(formatterVersion: ContestExportInput.arrlRTTYPreviewFormatterVersion,
            generatedAtUTC: date.addingTimeInterval(60), sessionRevision: 3, session: session,
            ruleIdentity: rule.metadata.identity, referenceDataVersion: session.referenceDataVersion,
            metadata: .init(sessionName: "ARRL RTTY preview", operatorCallsign: ownCall,
                            operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: [qso])
    }

    private func replacingQSOs(_ input: ContestExportInput, _ qsos: [ContestQSO]) -> ContestExportInput {
        .init(schemaVersion: input.schemaVersion, formatterVersion: input.formatterVersion,
              generatedAtUTC: input.generatedAtUTC, sessionRevision: input.sessionRevision,
              session: input.session, ruleIdentity: input.ruleIdentity,
              referenceDataVersion: input.referenceDataVersion, metadata: input.metadata, qsos: qsos)
    }

    private func replacingExchange(_ qso: ContestQSO, _ exchange: ContestExchangeSnapshot) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived, exchange: exchange, entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }
}
