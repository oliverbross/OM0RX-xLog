import Foundation
import XCTest
@testable import XContestCore

final class ContestARRLRTTYRoundupExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "A1000000-0000-0000-8000-000000000001")!
    private let generation = UUID(uuidString: "A2000000-0000-0000-8000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let alaska = ContestEntitySnapshot(adif: 6, name: "ALASKA", countryPrefix: "KL7", continent: "NA", cqZone: 1)
    private let hawaii = ContestEntitySnapshot(adif: 110, name: "HAWAII", countryPrefix: "KH6", continent: "OC", cqZone: 31)
    private let puertoRico = ContestEntitySnapshot(adif: 202, name: "PUERTO RICO", countryPrefix: "KP4", continent: "NA", cqZone: 8)
    private let virginIslands = ContestEntitySnapshot(adif: 285, name: "VIRGIN ISLANDS", countryPrefix: "KP2", continent: "NA", cqZone: 8)
    private let guam = ContestEntitySnapshot(adif: 103, name: "GUAM", countryPrefix: "KH2", continent: "OC", cqZone: 27)

    func testOfficialFourDirectionQSOLayoutAndExactGoldenDocument() throws {
        struct Fixture: Decodable {
            let formatterVersion: String
            let wveToWve: String
            let wveToDX: String
            let dxToWve: String
            let dxToDX: String
            let wveDocumentLines: [String]
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports/arrl-rtty-preview-1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        XCTAssertEqual(fixture.formatterVersion, ContestExportInput.arrlRTTYPreviewFormatterVersion)

        let rule = ARRLRTTYRoundupRule()
        let wve = session(rule: rule, call: "K1AAA", entity: usa, exchange: "CA", location: "EMA")
        let wveContact = qso(session: wve, call: "VE3AAA", entity: canada, sent: "CA", received: "ON")
        let dxContact = qso(session: wve, call: "DL1AAA", entity: germany, sent: "CA", received: "001")
        XCTAssertEqual(try CabrilloExporter.qsoLine(wveContact, session: wve, rule: rule), fixture.wveToWve)
        XCTAssertEqual(try CabrilloExporter.qsoLine(dxContact, session: wve, rule: rule), fixture.wveToDX)

        let dx = session(rule: rule, call: "DL1DX", entity: germany, exchange: "001", location: "DX")
        let workedWVE = qso(session: dx, call: "K1BBB", entity: usa, sent: "001", received: "MA")
        let workedDX = qso(session: dx, call: "DL2BBB", entity: germany, sent: "001", received: "002")
        XCTAssertEqual(try CabrilloExporter.qsoLine(workedWVE, session: dx, rule: rule), fixture.dxToWve)
        XCTAssertEqual(try CabrilloExporter.qsoLine(workedDX, session: dx, rule: rule), fixture.dxToDX)

        let document = try CabrilloExporter.document(input: input(rule: rule, session: wve, qsos: [wveContact]),
                                                      rule: rule, createdBy: "OM0RX-xLog")
        XCTAssertEqual(Data(document.utf8), Data((fixture.wveDocumentLines.joined(separator: "\r\n") + "\r\n").utf8))
    }

    func testLBAndNFRemainDistinctWhileAlaskaAndHawaiiUseDXSerials() throws {
        let rule = ARRLRTTYRoundupRule()
        let own = session(rule: rule, call: "K1AAA", entity: usa, exchange: "CA", location: "EMA")
        let contacts = [
            qso(session: own, call: "VO2AAA", entity: canada, sent: "CA", received: "LB", offset: 1),
            qso(session: own, call: "VO1AAA", entity: canada, sent: "CA", received: "NF", offset: 2),
            qso(session: own, call: "KL7AAA", entity: alaska, sent: "CA", received: "003", offset: 3),
            qso(session: own, call: "KH6AAA", entity: hawaii, sent: "CA", received: "004", offset: 4),
        ]
        let score = try input(rule: rule, session: own, qsos: contacts).validatedScore(rule: rule)
        XCTAssertEqual(score.totalPoints, 4)
        XCTAssertEqual(score.multiplierCount, 4)
        XCTAssertEqual(score.claimedScore, 16)
        for contact in contacts {
            XCTAssertTrue(try CabrilloExporter.qsoLine(contact, session: own, rule: rule).contains(" RY "))
        }
    }

    func testFullLogAndSingleBandProjectionRetainRowsButScoreSelectedBand() throws {
        let rule = ARRLRTTYRoundupRule()
        let own = session(rule: rule, call: "K1AAA", entity: usa, exchange: "CA", location: "EMA")
        let twenty = qso(session: own, call: "VE3AAA", entity: canada, sent: "CA", received: "ON", band: "20m")
        let duplicate = qso(session: own, call: "VE3AAA", entity: canada, sent: "CA", received: "ON",
                            band: "20m", offset: 1)
        let forty = qso(session: own, call: "VE3AAA", entity: canada, sent: "CA", received: "ON",
                        band: "40m", offset: 2)
        let full = input(rule: rule, session: own, qsos: [forty, duplicate, twenty])
        XCTAssertEqual(try full.validatedScore(rule: rule).claimedScore, 2)

        let single = input(rule: rule, session: own, qsos: [forty, duplicate, twenty], categoryBand: "20M")
        let score = try single.validatedScore(rule: rule)
        XCTAssertEqual(score.totalPoints, 1)
        XCTAssertEqual(score.multiplierCount, 1)
        XCTAssertEqual(score.claimedScore, 1)
        let document = try CabrilloExporter.document(input: single, rule: rule)
        XCTAssertEqual(document.components(separatedBy: "\r\n").filter { $0.hasPrefix("QSO: ") }.count, 3)
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 1\r\n"))
    }

    func testHeaderLocationUsesFrozenEntitySectionMappingIndependentOfDXSerialExchange() throws {
        let rule = ARRLRTTYRoundupRule()
        let pacific: [(ContestEntitySnapshot, String)] = [
            (.init(adif: 9, name: "AMERICAN SAMOA", countryPrefix: "KH8", continent: "OC", cqZone: 32), "KH8AAA"),
            (.init(adif: 20, name: "BAKER AND HOWLAND", countryPrefix: "KH1", continent: "OC", cqZone: 31), "KH1AAA"),
            (guam, "KH2AAA"), (hawaii, "KH6AAA"),
            (.init(adif: 123, name: "JOHNSTON ISLAND", countryPrefix: "KH3", continent: "OC", cqZone: 31), "KH3AAA"),
            (.init(adif: 138, name: "KURE ISLAND", countryPrefix: "KH7K", continent: "OC", cqZone: 31), "KH7KAAA"),
            (.init(adif: 166, name: "MARIANA ISLANDS", countryPrefix: "KH0", continent: "OC", cqZone: 27), "KH0AAA"),
            (.init(adif: 174, name: "MIDWAY ISLAND", countryPrefix: "KH4", continent: "OC", cqZone: 31), "KH4AAA"),
            (.init(adif: 197, name: "PALMYRA AND JARVIS", countryPrefix: "KH5", continent: "OC", cqZone: 31), "KH5AAA"),
            (.init(adif: 297, name: "WAKE ISLAND", countryPrefix: "KH9", continent: "OC", cqZone: 31), "KH9AAA"),
            (.init(adif: 515, name: "SWAINS ISLAND", countryPrefix: "KH8S", continent: "OC", cqZone: 32), "KH8SAAA"),
        ]
        let cases = [(alaska, "KL7AAA", "AK"), (puertoRico, "KP4AAA", "PR"),
                     (virginIslands, "KP2AAA", "VI")] + pacific.map { ($0.0, $0.1, "PAC") }
        for (entity, call, section) in cases {
            let own = session(rule: rule, call: call, entity: entity, exchange: "001", location: section)
            let contact = qso(session: own, call: "DL1AAA", entity: germany, sent: "001", received: "002")
            let document = try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [contact]),
                                                          rule: rule)
            XCTAssertTrue(document.contains("LOCATION: \(section)\r\n"), call)
            XCTAssertTrue(try CabrilloExporter.qsoLine(contact, session: own, rule: rule).contains(" 599 001    "))
        }

        for section in ["AK", "PAC", "PR", "VI"] {
            let continental = session(rule: rule, call: "K1AAA", entity: usa,
                                      exchange: "CA", location: section)
            let contact = qso(session: continental, call: "VE3AAA", entity: canada,
                              sent: "CA", received: "ON")
            XCTAssertThrowsError(try CabrilloExporter.document(
                input: input(rule: rule, session: continental, qsos: [contact]), rule: rule), section)
        }

        let unsupported = session(rule: rule, call: "DL1DX", entity: germany, exchange: "001", location: "PAC")
        let contact = qso(session: unsupported, call: "K1AAA", entity: usa, sent: "001", received: "CA")
        XCTAssertThrowsError(try CabrilloExporter.document(input: input(rule: rule, session: unsupported,
                                                                        qsos: [contact]), rule: rule))
    }

    func testLocationCategoryIdentityAndTypedExchangeMismatchesFailClosed() {
        let rule = ARRLRTTYRoundupRule()
        let own = session(rule: rule, call: "K1AAA", entity: usa, exchange: "CA", location: "EMA")
        let valid = qso(session: own, call: "VE3AAA", entity: canada, sent: "CA", received: "ON")
        XCTAssertThrowsError(try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [valid],
                                                                        location: "CA"), rule: rule))
        let unknownSectionSession = session(rule: rule, call: "K1AAA", entity: usa,
                                            exchange: "CA", location: "ZZZ")
        let unknownSectionQSO = qso(session: unknownSectionSession, call: "VE3AAA", entity: canada,
                                    sent: "CA", received: "ON")
        XCTAssertThrowsError(try CabrilloExporter.document(
            input: input(rule: rule, session: unknownSectionSession, qsos: [unknownSectionQSO]), rule: rule))
        XCTAssertThrowsError(try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [valid],
                                                                        transmitter: "TWO"), rule: rule))

        let wrongRule = ContestExportInput(formatterVersion: ContestExportInput.arrlRTTYPreviewFormatterVersion,
            generatedAtUTC: date, sessionRevision: 1, session: own, ruleIdentity: NAQPRTTYRule.identity,
            referenceDataVersion: own.referenceDataVersion,
            metadata: input(rule: rule, session: own, qsos: [valid]).metadata, qsos: [valid])
        XCTAssertThrowsError(try CabrilloExporter.document(input: wrongRule, rule: rule))

        let badFields = replacingExchange(valid, .init(rawSent: "CA", normalizedSent: "CA",
            rawReceived: "001", normalizedReceived: "001",
            sentFields: valid.exchange.sentFields,
            receivedFields: ["exchange": .init(raw: "ON", normalized: "ON")]))
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(badFields, session: own, rule: rule))

        for malformed in ["O\nN", "ÖN", "123456789"] {
            let badText = replacingExchange(valid, .init(rawSent: "CA", normalizedSent: "CA",
                rawReceived: malformed, normalizedReceived: malformed,
                sentFields: valid.exchange.sentFields,
                receivedFields: ["exchange": .init(raw: malformed, normalized: malformed)]))
            XCTAssertThrowsError(try CabrilloExporter.qsoLine(badText, session: own, rule: rule), malformed)
        }
        let fabricated = ContestEntitySnapshot(adif: 999_999, name: "FABRICATED", countryPrefix: "ZZ",
                                               continent: "EU", cqZone: 14)
        let unknown = qso(session: own, call: "ZZ1AAA", entity: fabricated, sent: "CA", received: "001")
        XCTAssertThrowsError(try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [unknown]),
                                                            rule: rule))

        let shortReport = replacingReports(valid, sent: "59", received: "599")
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(shortReport, session: own, rule: rule))
        let malformedCall = qso(session: own, call: "ABC", entity: canada, sent: "CA", received: "ON")
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(malformedCall, session: own, rule: rule))

        let malformedStation = ContestStationSnapshot(callsign: "K1AAA", entity: usa, sentExchange: "ZZ",
            operatorCallsigns: ["K1AAA"], location: "EMA",
            sentExchangeFields: ["location": .init(raw: "CA", normalized: "CA")])
        let malformedSession = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
            rule: rule.metadata.identity, referenceDataVersion: "arrl-2026-fixture", startedAt: date,
            station: malformedStation)
        let malformedSessionQSO = replacingExchange(valid, .init(
            rawSent: "ZZ", normalizedSent: "ZZ", rawReceived: "ON", normalizedReceived: "ON",
            sentFields: malformedStation.sentExchangeFields,
            receivedFields: valid.exchange.receivedFields))
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(malformedSessionQSO, session: malformedSession,
                                                           rule: rule))
    }

    func testExportAuthorityFixturePinsRulesCabrilloAndADIFSources() throws {
        struct Authority: Decodable {
            let rulesSHA256: String
            let cabrilloHeaderSHA256: String
            let arrlRACSectionsSHA256: String
            let arrlSectionBoundariesSHA256: String
            let arrlPart97SHA256: String
            let kureJurisdictionSHA256: String
            let swainsJurisdictionSHA256: String
            let adifSpecificationSHA256: String
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/arrl-rtty-roundup-export-authority.json")
        let fixture = try JSONDecoder().decode(Authority.self, from: Data(contentsOf: url))
        XCTAssertEqual(fixture.rulesSHA256,
                       "87c9f0032e6ce502b4ae94d47b397a9a34c49a3eafdb5a50fc226694696fe1ce")
        XCTAssertEqual(fixture.cabrilloHeaderSHA256,
                       "e3a4cd4a4749394dd944f4316eec467904df44c7668b29e7c5fd5fa617a08fcc")
        XCTAssertEqual(fixture.arrlRACSectionsSHA256,
                       "130a22a166795a39873c77974db906f0128dc183f7c832b709a52965d583e11a")
        XCTAssertEqual(fixture.arrlSectionBoundariesSHA256,
                       "26bf30888dd149510a224c1031763ea0fc3339ec42b26a2e9b61c82cbf39d576")
        XCTAssertEqual(fixture.arrlPart97SHA256,
                       "7fc1f0889f981ea6cb177d3716b7349d8558a4646389a794084fc9112a63a890")
        XCTAssertEqual(fixture.kureJurisdictionSHA256,
                       "238f903abab08491b082b841b3b076522d3953cb5d06bcae80f86a27b48bddbc")
        XCTAssertEqual(fixture.swainsJurisdictionSHA256,
                       "11a5e7bbd51290abf103b81841d53de04ed404ace2428e3829d337f5b06fd18d")
        XCTAssertEqual(fixture.adifSpecificationSHA256,
                       "3ba54cb29b4dc5333c81f38f53e9d5ca503ff47a917acffa64e4cc469464d5ef")
    }

    private func session(rule: any ContestRule, call: String, entity: ContestEntitySnapshot,
                         exchange: String, location: String) -> ContestSessionSnapshot {
        let fieldID = entity.adif == 291 || entity.adif == 1 ? "location" : "serial"
        let stationExchange = entity.adif == 291 || entity.adif == 1 ? exchange : ""
        let stationFields: [String: ContestExchangeFieldValue] = stationExchange.isEmpty ? [:] :
            [fieldID: .init(raw: stationExchange, normalized: stationExchange)]
        return .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
                     referenceDataVersion: "arrl-2026-fixture", startedAt: date,
                     station: .init(callsign: call, entity: entity, sentExchange: stationExchange,
                                    operatorCallsigns: [call], location: location,
                                    sentExchangeFields: stationFields))
    }

    private func input(rule: any ContestRule, session: ContestSessionSnapshot, qsos: [ContestQSO],
                       categoryBand: String = "ALL", location: String? = nil,
                       transmitter: String = "ONE") -> ContestExportInput {
        let header = CabrilloHeader(callsign: session.station.callsign, categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: categoryBand,
                                    categoryMode: "RTTY", categoryTransmitter: transmitter,
                                    categoryPower: "LOW", operators: [session.station.callsign],
                                    location: location ?? session.station.location, name: "Operator")
        return .init(formatterVersion: ContestExportInput.arrlRTTYPreviewFormatterVersion,
                     generatedAtUTC: date.addingTimeInterval(60), sessionRevision: 3,
                     session: session, ruleIdentity: rule.metadata.identity,
                     referenceDataVersion: session.referenceDataVersion,
                     metadata: .init(sessionName: "ARRL RTTY preview", operatorCallsign: session.station.callsign,
                                     operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: qsos)
    }

    private func qso(session: ContestSessionSnapshot, call: String, entity: ContestEntitySnapshot,
                     sent: String, received: String, band: String = "20m", offset: TimeInterval = 0) -> ContestQSO {
        let sentID = session.station.entity.map { $0.adif == 291 || $0.adif == 1 } == true ? "location" : "serial"
        let frequency: Int64 = band == "40m" ? 7_080_000 : 14_080_000
        return .init(id: UUID(uuidString: String(format: "A3000000-0000-0000-8000-%012d", Int(offset) + 1))!,
                     sessionID: sessionID, timestampUTC: date.addingTimeInterval(offset), callsign: call,
                     band: band, mode: "RTTY", frequencyHz: frequency, rstSent: "599", rstReceived: "599",
                     exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received,
                                     normalizedReceived: received,
                                     sentFields: [sentID: .init(raw: sent, normalized: sent)],
                                     receivedFields: ["exchange": .init(raw: received, normalized: received)]),
                     entity: entity, operatorCallsign: session.station.callsign,
                     stationLocation: session.station.location, provenance: .init(source: .operatorEntry))
    }

    private func replacingExchange(_ qso: ContestQSO, _ exchange: ContestExchangeSnapshot) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived, exchange: exchange, entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }

    private func replacingReports(_ qso: ContestQSO, sent: String, received: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: sent,
              rstReceived: received, exchange: qso.exchange, entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }
}
