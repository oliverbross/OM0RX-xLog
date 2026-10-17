import Foundation
import XCTest
@testable import XContestCore

final class ContestSACTests: XCTestCase {
    private let sessionID = UUID(uuidString: "B1000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "B2000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_200_000)
    private let sm = ContestEntitySnapshot(adif: 284, name: "SWEDEN", countryPrefix: "SM", continent: "EU", cqZone: 14)
    private let oh = ContestEntitySnapshot(adif: 224, name: "FINLAND", countryPrefix: "OH", continent: "EU", cqZone: 15)
    private let oh0 = ContestEntitySnapshot(adif: 5, name: "ALAND ISLANDS", countryPrefix: "OH0", continent: "EU", cqZone: 15)
    private let oj0 = ContestEntitySnapshot(adif: 167, name: "MARKET REEF", countryPrefix: "OJ0", continent: "EU", cqZone: 15)
    private let la = ContestEntitySnapshot(adif: 266, name: "NORWAY", countryPrefix: "LA", continent: "EU", cqZone: 14)
    private let oz = ContestEntitySnapshot(adif: 221, name: "DENMARK", countryPrefix: "OZ", continent: "EU", cqZone: 14)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testCatalogPublishesSourcePinnedDescriptors() {
        XCTAssertEqual(ContestRuleRegistry.pilots.metadata.count, 8)
        for rule in [SACCWRule().metadata, SACSSBRule().metadata] {
            XCTAssertEqual(rule.identity.version, "1.0.0-2026-rules-preview")
            XCTAssertEqual(rule.identity.edition, "2026-rules-preview")
            XCTAssertEqual(rule.identity.sourceRevision, "7c8b499225a73f7f8f792246881bd7aefc05452f")
            XCTAssertEqual(rule.supportedBands, ["80m", "40m", "20m", "15m", "10m"])
            XCTAssertEqual(rule.entry.exchange.adifFields, .exchangeStrings)
            XCTAssertEqual(rule.entry.serial.requirement, .requiredForCommit)
            XCTAssertEqual(rule.entry.serial.allowedScopes, [.session, .band, .transmitter])
            XCTAssertTrue(rule.entry.isCoherent(supportedModes: rule.supportedModes))
        }
    }

    func testCWScandinavianStationIndependentArithmeticIs44() throws {
        let rule = SACCWRule()
        let session = makeSession(rule: rule.metadata.identity, stationCall: "SM0AAA", entity: sm)
        let contacts = [
            qso(1, rule: rule, call: "DL1AAA", band: "20m", entity: germany),
            qso(2, rule: rule, call: "K1ABC", band: "20m", entity: usa),
            qso(3, rule: rule, call: "K1XYZ", band: "20m", entity: usa),
            qso(4, rule: rule, call: "K1ABC", band: "40m", entity: usa),
            qso(5, rule: rule, call: "OH1AAA", band: "20m", entity: oh),
            qso(6, rule: rule, call: "K1ABC", band: "20m", entity: usa),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .accepted, .accepted, .accepted, .duplicate])
        XCTAssertEqual(score.qsos.map(\.points), [2, 3, 3, 3, 0, 0])
        XCTAssertEqual(score.qsos.map(\.newMultipliers.count), [1, 1, 0, 1, 1, 0])
        XCTAssertEqual(score.totalPoints, 11)
        XCTAssertEqual(score.multiplierCount, 4)
        XCTAssertEqual(score.claimedScore, 44)
    }

    func testSSBNonScandinavianStationIndependentArithmeticIs12() throws {
        let rule = SACSSBRule()
        let session = makeSession(rule: rule.metadata.identity, stationCall: "OM0RX", entity: om)
        let contacts = [
            qso(11, rule: rule, call: "SM1AAA", band: "20m", entity: sm),
            qso(12, rule: rule, call: "SM2AAA", band: "20m", entity: sm),
            qso(13, rule: rule, call: "SM1BBB", band: "20m", entity: sm),
            qso(14, rule: rule, call: "OH1AAA", band: "40m", entity: oh),
            qso(15, rule: rule, call: "K1ABC", band: "20m", entity: usa),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.points), [1, 1, 1, 1, 0])
        XCTAssertEqual(score.qsos.map(\.newMultipliers.count), [1, 1, 0, 1, 0])
        XCTAssertEqual(score.qsos[0].newMultipliers,
                       [.init(kind: "scandinavian-call-area", value: "SM:1", scope: "20m")])
        XCTAssertEqual(score.totalPoints, 4)
        XCTAssertEqual(score.multiplierCount, 3)
        XCTAssertEqual(score.claimedScore, 12)
    }

    func testNonEuropeanBandPointsAndSponsorEntityMapping() throws {
        let rule = SACCWRule()
        let outsideEurope = makeSession(rule: rule.metadata.identity, stationCall: "K1ZZZ", entity: usa)
        let score = try ContestEngine.score([
            qso(16, rule: rule, call: "SM1AAA", band: "80m", entity: sm),
            qso(17, rule: rule, call: "SM2AAA", band: "20m", entity: sm),
        ], session: outsideEurope, rule: rule)
        XCTAssertEqual(score.qsos.map(\.points), [3, 1])
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 8)

        let european = makeSession(rule: rule.metadata.identity, stationCall: "OM0RX", entity: om)
        let workedEntities = try ContestEngine.score([
            qso(18, rule: rule, call: "OH0AAA", band: "20m", entity: oh0),
            qso(19, rule: rule, call: "OJ0AAA", band: "20m", entity: oj0),
        ], session: european, rule: rule)
        XCTAssertEqual(workedEntities.totalPoints, 2)
        XCTAssertEqual(workedEntities.multiplierCount, 2)

        let alandStation = makeSession(rule: rule.metadata.identity, stationCall: "OH0ZZZ", entity: oh0)
        let fromAland = try ContestEngine.score([
            qso(21, rule: rule, call: "DL1AAA", band: "20m", entity: germany),
        ], session: alandStation, rule: rule)
        XCTAssertEqual(fromAland.totalPoints, 2)
        XCTAssertEqual(fromAland.multiplierCount, 1)

        let marketReefStation = makeSession(rule: rule.metadata.identity, stationCall: "OJ0ZZZ", entity: oj0)
        let fromMarketReef = try ContestEngine.score([
            qso(26, rule: rule, call: "DL2AAA", band: "20m", entity: germany),
        ], session: marketReefStation, rule: rule)
        XCTAssertEqual(fromMarketReef.totalPoints, 2)
        XCTAssertEqual(fromMarketReef.multiplierCount, 1)
    }

    func testPortableCallAreaUsesActualScandinavianComponentAndIneligibleEntrantFails() throws {
        let rule = SACCWRule()
        let european = makeSession(rule: rule.metadata.identity, stationCall: "OM0RX", entity: om)
        let validCases: [(String, ContestEntitySnapshot, String)] = [
            ("OH0/SM1ABC", oh0, "OH0:0"),
            ("SM1ABC/OH0", oh0, "OH0:0"),
            ("SM1ABC/LA", la, "LA:0"),
            ("LA/SM1ABC", la, "LA:0"),
            ("LA/G3XYZ", la, "LA:0"),
            ("SM1ABC/P/QRP", sm, "SM:1"),
            ("OZ150A", oz, "OZ:1"),
        ]
        for (offset, item) in validCases.enumerated() {
            let evaluation = rule.evaluate(qso(22 + offset, rule: rule, call: item.0,
                                               band: "20m", entity: item.1), in: european)
            XCTAssertTrue(evaluation.validation.isEmpty, item.0)
            XCTAssertEqual(evaluation.multiplierCandidates,
                           [.init(kind: "scandinavian-call-area", value: item.2, scope: "20m")], item.0)
        }

        let invalidCases: [(String, ContestEntitySnapshot)] = [
            ("SMABC1", sm),
            ("SM1ABC/SM2XYZ", sm),
            ("SM1ABC/LA", oj0),
        ]
        for (offset, item) in invalidCases.enumerated() {
            let evaluation = rule.evaluate(qso(40 + offset, rule: rule, call: item.0,
                                               band: "20m", entity: item.1), in: european)
            XCTAssertEqual(evaluation.validation.map(\.code), ["invalidScandinavianCallArea"], item.0)
            XCTAssertTrue(evaluation.multiplierCandidates.isEmpty, item.0)
        }

        let belarus = ContestEntitySnapshot(adif: 27, name: "BELARUS", countryPrefix: "EU", continent: "EU", cqZone: 16)
        let ineligible = makeSession(rule: rule.metadata.identity, stationCall: "EU1AAA", entity: belarus)
        let disposition = try ContestEngine.score([
            qso(25, rule: rule, call: "SM1AAA", band: "20m", entity: sm),
        ], session: ineligible, rule: rule).qsos[0].disposition
        XCTAssertEqual(disposition, .invalid)
    }

    func testPinnedSourceComparisonFixtureIsSeparateFromOperationalCorrections() throws {
        struct Comparison: Decodable {
            let sourceRevision: String
            let cwSHA256: String
            let ssbSHA256: String
            let canonicalAlandPrefix: String
            let sourceRecognizesCanonicalAlandPrefix: Bool
            let sourcePortablePrefix: String
            let sourcePortableAreaComponent: String
            let sourceValidatesPublishedFrequencySegments: Bool
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/sac-source-comparison.json")
        let comparison = try JSONDecoder().decode(Comparison.self, from: Data(contentsOf: url))
        XCTAssertEqual(comparison.sourceRevision, "7c8b499225a73f7f8f792246881bd7aefc05452f")
        XCTAssertEqual(comparison.cwSHA256, "2c2879d79f59df964e821f5c9ee6a5a460dad93e1c0e04a72b4c3a9ff9aa36ce")
        XCTAssertEqual(comparison.ssbSHA256, "c8a8fe6189e79a6fe001de2f73cccd574acc0d26ea8f2f8691765619f1b06fd9")
        XCTAssertEqual(comparison.canonicalAlandPrefix, "OH0")
        XCTAssertFalse(comparison.sourceRecognizesCanonicalAlandPrefix)
        XCTAssertEqual(comparison.sourcePortablePrefix, "P0")
        XCTAssertEqual(comparison.sourcePortableAreaComponent, "")
        XCTAssertFalse(comparison.sourceValidatesPublishedFrequencySegments)
    }

    func testReportsSerialBandsAndGeographyFailClosed() throws {
        let rule = SACSSBRule()
        let session = makeSession(rule: rule.metadata.identity, stationCall: "OM0RX", entity: om)
        let valid = qso(20, rule: rule, call: "SM1AAA", band: "20m", entity: sm)
        let invalids = [
            copy(valid, mode: "CW"), copy(valid, report: "599"), copy(valid, received: "0"),
            copy(valid, band: "160m", frequencyHz: 1_850_000), copy(valid, frequencyHz: 14_100_000),
            copy(valid, removeEntity: true),
        ]
        for contact in invalids {
            XCTAssertEqual(try ContestEngine.score([contact], session: session, rule: rule).qsos[0].disposition, .invalid)
        }
        XCTAssertEqual(rule.cabrilloReceivedExchange(for: valid), "20")
    }

    func testCWAndSSBCabrilloGoldensUseSourceLayout() throws {
        let cw = SACCWRule()
        let cwSession = makeSession(rule: cw.metadata.identity, stationCall: "SM0AAA", entity: sm)
        let cwDocument = try CabrilloExporter.document(
            input: exportInput(rule: cw, session: cwSession,
                               qsos: [qso(1, rule: cw, call: "K1ABC", band: "20m", entity: usa)]), rule: cw)
        XCTAssertEqual(cwDocument, try fixture("sac-cw-pilot.json"))
        XCTAssertTrue(cwDocument.contains("QSO: 14030 CW"))

        let ssb = SACSSBRule()
        let ssbSession = makeSession(rule: ssb.metadata.identity, stationCall: "OM0RX", entity: om)
        let ssbDocument = try CabrilloExporter.document(
            input: exportInput(rule: ssb, session: ssbSession,
                               qsos: [qso(2, rule: ssb, call: "SM1AAA", band: "20m", entity: sm)]), rule: ssb)
        XCTAssertEqual(ssbDocument, try fixture("sac-ssb-pilot.json"))
        XCTAssertTrue(ssbDocument.contains("QSO: 14250 PH"))
    }

    private func makeSession(rule: ContestRuleIdentity, stationCall: String,
                             entity: ContestEntitySnapshot) -> ContestSessionSnapshot {
        ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation, rule: rule,
                               referenceDataVersion: "cty-fixture", startedAt: date,
                               station: .init(callsign: stationCall, entity: entity, sentExchange: "001",
                                              operatorCallsigns: [stationCall], location: "DX"))
    }

    private func qso(_ number: Int, rule: any ContestRule, call: String, band: String,
                     entity: ContestEntitySnapshot) -> ContestQSO {
        let report = rule.metadata.entry.report.defaultSent
        let serial = String(format: "%03d", number)
        return ContestQSO(id: fixedUUID(number), sessionID: sessionID,
                          timestampUTC: date.addingTimeInterval(Double(number)), callsign: call,
                          band: band, mode: rule.metadata.entry.mode,
                          frequencyHz: frequency(band, mode: rule.metadata.entry.mode),
                          rstSent: report, rstReceived: report,
                          exchange: .init(rawSent: serial, normalizedSent: serial,
                                          rawReceived: String(number), normalizedReceived: String(number)),
                          entity: entity, operatorCallsign: "", stationLocation: "DX",
                          provenance: .init(source: .operatorEntry))
    }

    private func copy(_ qso: ContestQSO, mode: String? = nil, report: String? = nil,
                      received: String? = nil, band: String? = nil, frequencyHz: Int64? = nil,
                      removeEntity: Bool = false) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                   callsign: qso.callsign, band: band ?? qso.band, mode: mode ?? qso.mode,
                   frequencyHz: frequencyHz ?? qso.frequencyHz, rstSent: report ?? qso.rstSent,
                   rstReceived: report ?? qso.rstReceived,
                   exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                                   rawReceived: received ?? qso.exchange.rawReceived,
                                   normalizedReceived: received ?? qso.exchange.normalizedReceived),
                   entity: removeEntity ? nil : qso.entity, operatorCallsign: qso.operatorCallsign,
                   stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func exportInput(rule: any ContestRule, session: ContestSessionSnapshot,
                             qsos: [ContestQSO]) -> ContestExportInput {
        let call = session.station.callsign
        let header = CabrilloHeader(callsign: call, categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                    categoryMode: rule.metadata.entry.mode, categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: [call], location: "DX",
                                    name: "Operator", email: "operator@example.test")
        return ContestExportInput(formatterVersion: rule.metadata.entry.cabrilloFormatterVersion,
                                  generatedAtUTC: date.addingTimeInterval(500), sessionRevision: 1,
                                  session: session, ruleIdentity: rule.metadata.identity,
                                  referenceDataVersion: session.referenceDataVersion,
                                  metadata: .init(sessionName: "SAC fixture", operatorCallsign: call,
                                                  operatorCategory: "SINGLE-OP", cabrilloHeader: header),
                                  qsos: qsos)
    }

    private func frequency(_ band: String, mode: String) -> Int64 {
        let cw: [String: Int64] = ["80m": 3_530_000, "40m": 7_030_000, "20m": 14_030_000,
                                   "15m": 21_030_000, "10m": 28_030_000]
        let ssb: [String: Int64] = ["80m": 3_750_000, "40m": 7_150_000, "20m": 14_250_000,
                                    "15m": 21_250_000, "10m": 28_500_000]
        return (mode == "CW" ? cw : ssb)[band]!
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "B0000000-0000-0000-0000-%012d", number))!
    }

    private func fixture(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports").appendingPathComponent(name)
        let lines = try JSONDecoder().decode([String].self, from: Data(contentsOf: url))
        return lines.joined(separator: "\r\n") + "\r\n"
    }
}
