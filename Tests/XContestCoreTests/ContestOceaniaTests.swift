import Foundation
import XCTest
@testable import XContestCore

final class ContestOceaniaTests: XCTestCase {
    private let sessionID = UUID(uuidString: "91000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "92000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_100_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let vk = ContestEntitySnapshot(adif: 150, name: "AUSTRALIA", countryPrefix: "VK", continent: "OC", cqZone: 30)
    private let zl = ContestEntitySnapshot(adif: 170, name: "NEW ZEALAND", countryPrefix: "ZL", continent: "OC", cqZone: 32)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testCatalogPublishesSourcePinnedOceaniaDescriptors() {
        let catalog = ContestRuleRegistry.pilots.metadata
        XCTAssertEqual(catalog.count, 8)
        for rule in [OceaniaDXCWRule().metadata, OceaniaDXSSBRule().metadata] {
            XCTAssertEqual(rule.identity.version, "1.0.0-source-spike")
            XCTAssertEqual(rule.identity.edition, "source-26.10.11")
            XCTAssertEqual(rule.identity.sourceRevision, "7c8b499225a73f7f8f792246881bd7aefc05452f")
            XCTAssertEqual(rule.entry.exchange.sent, .serialNumber)
            XCTAssertEqual(rule.entry.exchange.received, .serialNumber)
            XCTAssertEqual(rule.entry.exchange.adifFields, .exchangeStrings)
            XCTAssertEqual(rule.entry.serial.requirement, .requiredForCommit)
            XCTAssertEqual(rule.entry.serial.allowedScopes, [.session, .band, .transmitter])
            XCTAssertTrue(rule.entry.isCoherent(supportedModes: rule.supportedModes))
        }
    }

    func testCWIndependentNonOceaniaStationArithmeticIs51() throws {
        let rule = OceaniaDXCWRule()
        let session = makeSession(rule: rule.metadata.identity, station: om, report: "599")
        let contacts = [
            qso(1, rule: rule, call: "VK1AAA", band: "20m", received: "101", entity: vk),
            qso(2, rule: rule, call: "VK1BBB", band: "20m", received: "102", entity: vk),
            qso(3, rule: rule, call: "VK1AAA", band: "40m", received: "103", entity: vk),
            qso(4, rule: rule, call: "ZL2ABC", band: "80m", received: "104", entity: zl),
            qso(5, rule: rule, call: "K1ABC", band: "10m", received: "105", entity: usa),
            qso(6, rule: rule, call: "ZL2ABC", band: "80m", received: "106", entity: zl),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .accepted, .accepted, .accepted, .duplicate])
        XCTAssertEqual(score.qsos.map(\.points), [1, 1, 5, 10, 0, 0])
        XCTAssertEqual(score.qsos.map(\.newMultipliers.count), [1, 0, 1, 1, 0, 0])
        XCTAssertEqual(score.qsos[0].newMultipliers, [.init(kind: "wpx-prefix", value: "VK1", scope: "20m")])
        XCTAssertEqual(score.qsos[2].newMultipliers, [.init(kind: "wpx-prefix", value: "VK1", scope: "40m")])
        XCTAssertEqual(score.totalPoints, 17)
        XCTAssertEqual(score.multiplierCount, 3)
        XCTAssertEqual(score.claimedScore, 51)
    }

    func testSSBIndependentOceaniaStationArithmeticIs100() throws {
        let rule = OceaniaDXSSBRule()
        let session = makeSession(rule: rule.metadata.identity, station: vk, report: "59")
        let contacts = [
            qso(11, rule: rule, call: "K1ABC", band: "160m", received: "201", entity: usa),
            qso(12, rule: rule, call: "K1XYZ", band: "160m", received: "202", entity: usa),
            qso(13, rule: rule, call: "DL1AAA", band: "80m", received: "203", entity: germany),
            qso(14, rule: rule, call: "DL1AAA", band: "80m", received: "204", entity: germany),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .accepted, .duplicate])
        XCTAssertEqual(score.qsos.map(\.points), [20, 20, 10, 0])
        XCTAssertEqual(score.qsos.map(\.newMultipliers.count), [1, 0, 1, 0])
        XCTAssertEqual(score.totalPoints, 50)
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 100)
    }

    func testModeReportSerialAndUnknownGeographyFailClosed() throws {
        let rule = OceaniaDXSSBRule()
        let session = makeSession(rule: rule.metadata.identity, station: vk, report: "59")
        let valid = qso(20, rule: rule, call: "K1ABC", band: "20m", received: "7", entity: usa)
        let invalids = [
            copy(valid, mode: "CW"),
            copy(valid, report: "599"),
            copy(valid, received: "0"),
            copy(valid, removeEntity: true),
        ]
        for qso in invalids {
            XCTAssertEqual(try ContestEngine.score([qso], session: session, rule: rule).qsos[0].disposition, .invalid)
        }
        XCTAssertEqual(rule.cabrilloReceivedExchange(for: valid), "07")
        XCTAssertEqual(OceaniaDXSSBRule.wpxPrefix(for: "K1ABC/P/QRP"), "P0")
    }

    func testSingleBandProjectionReplaysMultipliersAndRetainsAllRows() throws {
        let rule = OceaniaDXCWRule()
        let session = makeSession(rule: rule.metadata.identity, station: om, report: "599")
        let contacts = [
            qso(30, rule: rule, call: "VK1AAA", band: "40m", received: "301", entity: vk),
            qso(31, rule: rule, call: "VK1AAA", band: "20m", received: "302", entity: vk),
            qso(32, rule: rule, call: "VK1BBB", band: "20m", received: "303", entity: vk),
        ]
        let input = exportInput(rule: rule, session: session, qsos: contacts,
                                band: "20M", formatterVersion: ContestExportInput.submissionProjectionFormatterVersion)
        let projection = try input.validatedProjection(rule: rule)
        XCTAssertEqual(projection.renderedQSOs.map(\.id), contacts.map(\.id))
        XCTAssertEqual(projection.score.qsos.map(\.qsoID), [contacts[1].id, contacts[2].id])
        XCTAssertEqual(projection.score.totalPoints, 2)
        XCTAssertEqual(projection.score.multiplierCount, 1)
        XCTAssertEqual(projection.score.claimedScore, 2)
    }

    func testCWAndSSBCabrilloGoldensUseSourceLayout() throws {
        let cwRule = OceaniaDXCWRule()
        let cwSession = makeSession(rule: cwRule.metadata.identity, station: om, report: "599")
        let cwQSO = qso(40, rule: cwRule, call: "VK1AAA", band: "20m", received: "7", entity: vk)
        let cwDocument = try CabrilloExporter.document(
            input: exportInput(rule: cwRule, session: cwSession, qsos: [cwQSO], band: "ALL",
                               formatterVersion: ContestExportInput.legacyFormatterVersion), rule: cwRule)
        XCTAssertEqual(cwDocument, try fixture("oceania-dx-cw-pilot.json"))
        XCTAssertTrue(cwDocument.contains("QSO: 14250 CW"))

        let ssbRule = OceaniaDXSSBRule()
        let ssbSession = makeSession(rule: ssbRule.metadata.identity, station: vk, report: "59")
        let ssbQSO = qso(41, rule: ssbRule, call: "K1ABC", band: "20m", received: "8", entity: usa)
        let ssbDocument = try CabrilloExporter.document(
            input: exportInput(rule: ssbRule, session: ssbSession, qsos: [ssbQSO], band: "ALL",
                               formatterVersion: ContestExportInput.ssbFormatterVersion), rule: ssbRule)
        XCTAssertEqual(ssbDocument, try fixture("oceania-dx-ssb-pilot.json"))
        XCTAssertTrue(ssbDocument.contains("QSO: 14250 PH"))
    }

    private func makeSession(rule: ContestRuleIdentity, station: ContestEntitySnapshot,
                             report: String) -> ContestSessionSnapshot {
        ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation, rule: rule,
                               referenceDataVersion: "cty-fixture", startedAt: date,
                               station: .init(callsign: station.continent == "OC" ? "VK1ZZZ" : "OM0RX",
                                              entity: station, sentExchange: "001",
                                              operatorCallsigns: [station.continent == "OC" ? "VK1ZZZ" : "OM0RX"],
                                              location: "DX"))
    }

    private func qso(_ number: Int, rule: any ContestRule, call: String, band: String,
                     received: String, entity: ContestEntitySnapshot) -> ContestQSO {
        let report = rule.metadata.entry.report.defaultSent
        return ContestQSO(id: fixedUUID(number), sessionID: sessionID,
                          timestampUTC: date.addingTimeInterval(Double(number)), callsign: call,
                          band: band, mode: rule.metadata.entry.mode, frequencyHz: frequency(band),
                          rstSent: report, rstReceived: report,
                          exchange: .init(rawSent: String(format: "%03d", number),
                                          normalizedSent: String(format: "%03d", number),
                                          rawReceived: received, normalizedReceived: received),
                          entity: entity, operatorCallsign: "", stationLocation: "DX",
                          provenance: .init(source: .operatorEntry))
    }

    private func copy(_ qso: ContestQSO, mode: String? = nil, report: String? = nil,
                      received: String? = nil, removeEntity: Bool = false) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                   callsign: qso.callsign, band: qso.band, mode: mode ?? qso.mode,
                   frequencyHz: qso.frequencyHz, rstSent: report ?? qso.rstSent,
                   rstReceived: report ?? qso.rstReceived,
                   exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                                   rawReceived: received ?? qso.exchange.rawReceived,
                                   normalizedReceived: received ?? qso.exchange.normalizedReceived),
                   entity: removeEntity ? nil : qso.entity, operatorCallsign: qso.operatorCallsign,
                   stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func exportInput(rule: any ContestRule, session: ContestSessionSnapshot,
                             qsos: [ContestQSO], band: String, formatterVersion: String) -> ContestExportInput {
        let call = session.station.callsign
        let header = CabrilloHeader(callsign: call, categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: band,
                                    categoryMode: rule.metadata.entry.mode, categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: [call], location: "DX",
                                    name: "Operator", email: "operator@example.test")
        return ContestExportInput(formatterVersion: formatterVersion,
                                  generatedAtUTC: date.addingTimeInterval(500), sessionRevision: 1,
                                  session: session, ruleIdentity: rule.metadata.identity,
                                  referenceDataVersion: session.referenceDataVersion,
                                  metadata: .init(sessionName: "Oceania fixture", operatorCallsign: call,
                                                  operatorCategory: "SINGLE-OP", cabrilloHeader: header),
                                  qsos: qsos)
    }

    private func frequency(_ band: String) -> Int64 {
        ["160m": 1_850_000, "80m": 3_700_000, "40m": 7_100_000,
         "20m": 14_250_000, "15m": 21_250_000, "10m": 28_500_000][band]!
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "90000000-0000-0000-0000-%012d", number))!
    }

    private func fixture(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports").appendingPathComponent(name)
        let lines = try JSONDecoder().decode([String].self, from: Data(contentsOf: url))
        return lines.joined(separator: "\r\n") + "\r\n"
    }
}
