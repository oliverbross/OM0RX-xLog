import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#elseif canImport(XLogPortableCore)
import XLogPortableCore
#endif

final class ContestJIDXADIFExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "E8000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "E9000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_300_000)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let japan = ContestEntitySnapshot(adif: 339, name: "JAPAN", countryPrefix: "JA", continent: "AS", cqZone: 25)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testJAlandDXAndMaritimeRolesProjectRawAndNumericFieldsInBothModes() throws {
        for rule in [JIDXCWRule() as any ContestRule, JIDXSSBRule() as any ContestRule] {
            let cases: [(String, ContestEntitySnapshot?, String, String, String, ContestEntitySnapshot, String, String)] = [
                ("JA1ZZZ", japan, "3", "03", "K1AAA", usa, "5", "05"),
                ("OM0RX", slovakia, "15", "15", "JA1AAA", japan, "3", "03"),
                ("VE3AAA/MM", nil, "25", "25", "JA1AAA", japan, "3", "03"),
            ]
            for item in cases {
                let export = input(rule: rule, stationCall: item.0, stationEntity: item.1,
                                   sentRaw: item.2, sentNormalized: item.3,
                                   workedCall: item.4, workedEntity: item.5,
                                   receivedRaw: item.6, receivedNormalized: item.7)
                let record = try XCTUnwrap(ContestADIFExport.records(input: export, rule: rule).first)
                XCTAssertEqual(record["CONTEST_ID"], rule.metadata.identity.id == "jidx-ssb" ? "JIDX-SSB" : "JIDX-CW")
                XCTAssertEqual(record["MODE"], rule.metadata.entry.mode)
                XCTAssertEqual(record["STX_STRING"], item.2)
                XCTAssertEqual(record["SRX_STRING"], item.6)
                XCTAssertEqual(record["STX"], String(Int(item.3)!))
                XCTAssertEqual(record["SRX"], String(Int(item.7)!))
                XCTAssertEqual(record["RST_SENT"], rule.metadata.entry.mode == "SSB" ? "59" : "599")
                XCTAssertEqual(record["RST_RCVD"], rule.metadata.entry.mode == "SSB" ? "59" : "599")
            }
        }
    }

    func testDocumentRoundTripsJIDXIdentityAndPreservesRawLeadingZeroEvidence() throws {
        let rule = JIDXSSBRule()
        let export = input(rule: rule, stationCall: "JA1ZZZ", stationEntity: japan,
                           sentRaw: "3", sentNormalized: "03", workedCall: "K1AAA",
                           workedEntity: usa, receivedRaw: "5", receivedNormalized: "05")
        let document = try ContestADIFExport.document(input: export, rule: rule)
        let record = try XCTUnwrap(ADIFParser().records(in: document).first)
        XCTAssertEqual(record["CONTEST_ID"], "JIDX-SSB")
        XCTAssertEqual(record["MODE"], "SSB")
        XCTAssertEqual(record["STX_STRING"], "3")
        XCTAssertEqual(record["SRX_STRING"], "5")
        XCTAssertEqual(record["STX"], "3")
        XCTAssertEqual(record["SRX"], "5")
        XCTAssertEqual(record["APP_OM0RXXLOG_RULE_ID"], "jidx-ssb")
        XCTAssertEqual(record["APP_OM0RXXLOG_FORMATTER_VERSION"], "jidx-preview-1")
    }

    func testForgedStructuredNumberCannotReachADIFProjection() throws {
        let rule = JIDXCWRule()
        let export = input(rule: rule, stationCall: "OM0RX", stationEntity: slovakia,
                           sentRaw: "15", sentNormalized: "15", workedCall: "JA1AAA",
                           workedEntity: japan, receivedRaw: "3", receivedNormalized: "03")
        let original = export.qsos[0]
        let forged = ContestQSO(id: original.id, sessionID: original.sessionID,
                                timestampUTC: original.timestampUTC, callsign: original.callsign,
                                band: original.band, mode: original.mode, frequencyHz: original.frequencyHz,
                                rstSent: original.rstSent, rstReceived: original.rstReceived,
                                exchange: .init(rawSent: "15", normalizedSent: "15",
                                                rawReceived: "3", normalizedReceived: "03",
                                                sentFields: original.exchange.sentFields,
                                                receivedFields: ["number": .init(raw: "3", normalized: "3")]),
                                entity: original.entity, operatorCallsign: original.operatorCallsign,
                                stationLocation: original.stationLocation, provenance: original.provenance)
        XCTAssertThrowsError(try ContestADIFExport.records(input: replacingQSOs(export, [forged]), rule: rule))
    }

    private func input(rule: any ContestRule, stationCall: String,
                       stationEntity: ContestEntitySnapshot?, sentRaw: String, sentNormalized: String,
                       workedCall: String, workedEntity: ContestEntitySnapshot,
                       receivedRaw: String, receivedNormalized: String) -> ContestExportInput {
        let sent = ["number": ContestExchangeFieldValue(raw: sentRaw, normalized: sentNormalized)]
        let session = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "jidx-fixture", startedAt: date,
            station: .init(callsign: stationCall, entity: stationEntity, sentExchange: sentNormalized,
                           operatorCallsigns: [stationCall], location: "fixture", sentExchangeFields: sent))
        let phone = rule.metadata.entry.mode == "SSB"
        let qso = ContestQSO(
            id: UUID(uuidString: "EA000000-0000-0000-0000-000000000001")!, sessionID: sessionID,
            timestampUTC: date, callsign: workedCall, band: "20m", mode: rule.metadata.entry.mode,
            frequencyHz: phone ? 14_250_000 : 14_025_000,
            rstSent: phone ? "59" : "599", rstReceived: phone ? "59" : "599",
            exchange: .init(rawSent: sentRaw, normalizedSent: sentNormalized,
                            rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                            sentFields: sent,
                            receivedFields: ["number": .init(raw: receivedRaw,
                                                             normalized: receivedNormalized)]),
            entity: workedEntity, operatorCallsign: stationCall, stationLocation: "fixture",
            provenance: .init(source: .operatorEntry))
        let header = CabrilloHeader(callsign: stationCall, categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                    categoryMode: rule.metadata.entry.mode, categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: [stationCall], location: "DX")
        return .init(formatterVersion: ContestExportInput.jidxPreviewFormatterVersion,
                     generatedAtUTC: date.addingTimeInterval(60), sessionRevision: 2,
                     session: session, ruleIdentity: rule.metadata.identity,
                     referenceDataVersion: session.referenceDataVersion,
                     metadata: .init(sessionName: "JIDX preview", operatorCallsign: stationCall,
                                     operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: [qso])
    }

    private func replacingQSOs(_ input: ContestExportInput, _ qsos: [ContestQSO]) -> ContestExportInput {
        .init(schemaVersion: input.schemaVersion, formatterVersion: input.formatterVersion,
              generatedAtUTC: input.generatedAtUTC, sessionRevision: input.sessionRevision,
              session: input.session, ruleIdentity: input.ruleIdentity,
              referenceDataVersion: input.referenceDataVersion, metadata: input.metadata, qsos: qsos)
    }
}
