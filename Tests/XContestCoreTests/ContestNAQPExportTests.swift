import Foundation
import XCTest
@testable import XContestCore

final class ContestNAQPExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "E1000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "E2000000-0000-0000-8000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let dominican = ContestEntitySnapshot(adif: 72, name: "DOMINICAN REPUBLIC", countryPrefix: "HI", continent: "NA", cqZone: 8)
    private let unitedNations = ContestEntitySnapshot(adif: 289, name: "UNITED NATIONS HQ", countryPrefix: "4U1U", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)

    func testExactOfficialTemplateLayoutTokensForAllThreeModes() throws {
        struct Fixture: Decodable {
            struct Entry: Decodable { let ruleID: String; let mode: String; let qsoLine: String; let documentLines: [String] }
            let formatterVersion: String
            let cases: [Entry]
        }
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports/naqp-preview-1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL))
        XCTAssertEqual(fixture.formatterVersion, "naqp-preview-1")
        for item in fixture.cases {
            let rule: any ContestRule = switch item.ruleID {
            case "naqp-cw": NAQPCWRule()
            case "naqp-ssb": NAQPSSBRule()
            case "naqp-rtty": NAQPRTTYRule()
            default: throw CocoaError(.fileReadCorruptFile)
            }
            let session = makeSession(rule: rule, call: "K1AAA", entity: usa, name: "AL", location: "CA")
            let contact = qso(rule: rule, mode: item.mode, call: "VE3AAA", entity: canada,
                              name: "BOB", location: "ON", band: "20m", frequency: 14_050_000)
            XCTAssertEqual(try CabrilloExporter.qsoLine(contact, session: session, rule: rule), item.qsoLine)
            let document = try CabrilloExporter.document(input: makeInput(rule: rule, session: session, qsos: [contact]),
                                                          rule: rule, createdBy: "OM0RX-xLog")
            XCTAssertEqual(Data(document.utf8), Data((item.documentLines.joined(separator: "\r\n") + "\r\n").utf8))
        }
    }

    func testDXSentAndReceivedLocationsAreProjectedWithoutChangingTypedExchange() throws {
        let rule = NAQPCWRule()
        let dxSession = makeSession(rule: rule, call: "OM0RX", entity: slovakia, name: "OLIVER", location: nil)
        let workedNA = qso(rule: rule, mode: "CW", call: "K1ABC", entity: usa,
                           name: "PAT", location: "CA", band: "20m", frequency: 14_050_000,
                           sentName: "OLIVER", sentLocation: nil, stationCall: "OM0RX")
        XCTAssertTrue(try CabrilloExporter.qsoLine(workedNA, session: dxSession, rule: rule)
            .contains("OM0RX         OLIVER     DX  K1ABC         PAT        CA "))

        let naSession = makeSession(rule: rule, call: "K1AAA", entity: usa, name: "AL", location: "CA")
        let workedDX = qso(rule: rule, mode: "CW", call: "DL1AAA", entity: germany,
                           name: "HANS", location: "DX", band: "20m", frequency: 14_050_000)
        XCTAssertTrue(try CabrilloExporter.qsoLine(workedDX, session: naSession, rule: rule)
            .hasSuffix("DL1AAA        HANS       DX "))

        let prefix = qso(rule: rule, mode: "CW", call: "4U1UN", entity: unitedNations,
                          name: "PAT", location: "4U1/U", band: "20m", frequency: 14_050_000)
        XCTAssertTrue(try CabrilloExporter.qsoLine(prefix, session: naSession, rule: rule)
            .hasSuffix("4U1UN         PAT        4U1/U"))
        let hi = qso(rule: rule, mode: "CW", call: "HI8A", entity: dominican,
                     name: "AKI", location: "HI", band: "20m", frequency: 14_050_000)
        XCTAssertTrue(try CabrilloExporter.qsoLine(hi, session: naSession, rule: rule)
            .hasSuffix("HI8A          AKI        HI "))
        let mobile = qso(rule: rule, mode: "CW", call: "K1ABC/MM", entity: usa,
                         name: "SAM", location: "DX", band: "20m", frequency: 14_050_000)
        XCTAssertTrue(try CabrilloExporter.qsoLine(mobile, session: naSession, rule: rule)
            .hasSuffix("K1ABC/MM      SAM        DX "))
    }

    func testFullLogIsRenderedWhileSingleBandClaimScoresOnlySelectedBand() throws {
        let rule = NAQPCWRule()
        let session = makeSession(rule: rule, call: "K1AAA", entity: usa, name: "AL", location: "CA")
        let twenty = qso(rule: rule, mode: "CW", call: "VE3AAA", entity: canada,
                         name: "BOB", location: "ON", band: "20m", frequency: 14_050_000)
        let forty = qso(rule: rule, mode: "CW", call: "K2BBB", entity: usa,
                        name: "PAT", location: "NY", band: "40m", frequency: 7_050_000, offset: 1)
        let all = makeInput(rule: rule, session: session, qsos: [forty, twenty])
        XCTAssertEqual(try all.validatedScore(rule: rule).claimedScore, 4)
        let single = makeInput(rule: rule, session: session, qsos: [forty, twenty], categoryBand: "20M")
        XCTAssertEqual(try single.validatedScore(rule: rule).claimedScore, 1)
        let document = try CabrilloExporter.document(input: single, rule: rule)
        XCTAssertEqual(document.components(separatedBy: "\r\n").filter { $0.hasPrefix("QSO: ") }.count, 2)
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 1\r\n"))
    }

    func testMalformedStructuredTextAndUnsupportedCategoryFailClosed() {
        let rule = NAQPCWRule()
        let session = makeSession(rule: rule, call: "K1AAA", entity: usa, name: "AL", location: "CA")
        let valid = qso(rule: rule, mode: "CW", call: "VE3AAA", entity: canada,
                        name: "BOB", location: "ON", band: "20m", frequency: 14_050_000)
        var fields = valid.exchange.receivedFields
        fields["name"] = .init(raw: "B\nOB", normalized: "BOB")
        let malformed = replacingExchange(valid, .init(rawSent: valid.exchange.rawSent,
                                                       normalizedSent: valid.exchange.normalizedSent,
                                                       rawReceived: "B\nOB ON", normalizedReceived: "BOB ON",
                                                       sentFields: valid.exchange.sentFields,
                                                       receivedFields: fields))
        XCTAssertThrowsError(try CabrilloExporter.document(input: makeInput(rule: rule, session: session, qsos: [malformed]), rule: rule))
        let overlongCall = qso(rule: rule, mode: "CW", call: "K1234567890123", entity: canada,
                               name: "BOB", location: "ON", band: "20m", frequency: 14_050_000)
        XCTAssertThrowsError(try CabrilloExporter.document(input: makeInput(rule: rule, session: session,
                                                                            qsos: [overlongCall]), rule: rule))
        let nonASCII = qso(rule: rule, mode: "CW", call: "VE3AAA", entity: canada,
                           name: "BOBÉ", location: "ON", band: "20m", frequency: 14_050_000)
        XCTAssertThrowsError(try CabrilloExporter.document(input: makeInput(rule: rule, session: session,
                                                                            qsos: [nonASCII]), rule: rule))
        XCTAssertThrowsError(try CabrilloExporter.document(input: makeInput(rule: rule, session: session, qsos: [valid],
                                                                            categoryMode: "SSB"), rule: rule))
    }

    func testExportAuthorityFixturePinsPrimaryTemplateAndCurrentADIFSpec() throws {
        struct Authority: Decodable {
            let cabrilloTemplateSHA256: String
            let historicalTemplateQSO: String
            let historicalTemplateDXExample: String
            let adifSpecificationSHA256: String
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/naqp-export-authority.json")
        let fixture = try JSONDecoder().decode(Authority.self, from: Data(contentsOf: url))
        XCTAssertEqual(fixture.cabrilloTemplateSHA256,
                       "b4e9c221d498cd126054fada0854379d36e45d9a4b09b1b920285a8157575fa4")
        XCTAssertEqual(fixture.adifSpecificationSHA256,
                       "3ba54cb29b4dc5333c81f38f53e9d5ca503ff47a917acffa64e4cc469464d5ef")
        XCTAssertTrue(fixture.historicalTemplateQSO.contains("TREY       CA"))
        XCTAssertTrue(fixture.historicalTemplateDXExample.contains("HI8A            AKI        DX"))
    }

    private func makeSession(rule: any ContestRule, call: String, entity: ContestEntitySnapshot,
                             name: String, location: String?) -> ContestSessionSnapshot {
        let fields = exchangeFields(name: name, location: location)
        return .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
                     referenceDataVersion: "cty-fixture", startedAt: date,
                     station: .init(callsign: call, entity: entity, sentExchange: aggregate(name, location),
                                    operatorCallsigns: [call], location: "DX", sentExchangeFields: fields))
    }

    private func makeInput(rule: any ContestRule, session: ContestSessionSnapshot, qsos: [ContestQSO],
                           categoryBand: String = "ALL", categoryMode: String? = nil) -> ContestExportInput {
        let mode = categoryMode ?? rule.metadata.entry.mode
        let header = CabrilloHeader(callsign: session.station.callsign, categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: categoryBand,
                                    categoryMode: mode, categoryTransmitter: "ONE", categoryPower: "LOW",
                                    operators: [session.station.callsign], location: "DX", name: "Operator")
        return .init(formatterVersion: "naqp-preview-1", generatedAtUTC: date.addingTimeInterval(60),
                     sessionRevision: 2, session: session, ruleIdentity: rule.metadata.identity,
                     referenceDataVersion: session.referenceDataVersion,
                     metadata: .init(sessionName: "NAQP preview", operatorCallsign: session.station.callsign,
                                     operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: qsos)
    }

    private func qso(rule: any ContestRule, mode: String, call: String, entity: ContestEntitySnapshot,
                     name: String, location: String, band: String, frequency: Int64, offset: TimeInterval = 0,
                     sentName: String = "AL", sentLocation: String? = "CA", stationCall: String = "K1AAA") -> ContestQSO {
        .init(id: UUID(uuidString: offset == 0 ? "E3000000-0000-0000-8000-000000000001" : "E3000000-0000-0000-8000-000000000002")!,
              sessionID: sessionID, timestampUTC: date.addingTimeInterval(offset), callsign: call,
              band: band, mode: mode, frequencyHz: frequency, rstSent: "", rstReceived: "",
              exchange: .init(rawSent: aggregate(sentName, sentLocation), normalizedSent: aggregate(sentName, sentLocation),
                              rawReceived: aggregate(name, location), normalizedReceived: aggregate(name, location),
                              sentFields: exchangeFields(name: sentName, location: sentLocation),
                              receivedFields: exchangeFields(name: name, location: location)),
              entity: entity, operatorCallsign: stationCall, stationLocation: "DX",
              provenance: .init(source: .operatorEntry))
    }

    private func replacingExchange(_ qso: ContestQSO, _ exchange: ContestExchangeSnapshot) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived, exchange: exchange, entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }

    private func exchangeFields(name: String, location: String?) -> [String: ContestExchangeFieldValue] {
        var result = ["name": ContestExchangeFieldValue(raw: name, normalized: name)]
        if let location { result["location"] = .init(raw: location, normalized: location) }
        return result
    }
    private func aggregate(_ name: String, _ location: String?) -> String {
        [name, location].compactMap { $0 }.joined(separator: " ")
    }
}
