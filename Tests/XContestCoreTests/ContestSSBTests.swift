import Foundation
import XCTest
@testable import XContestCore

final class ContestSSBTests: XCTestCase {
    private let sessionID = UUID(uuidString: "70000000-0000-0000-0000-000000000001")!
    private let baseDate = Date(timeIntervalSince1970: 1_700_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testRegistryPublishesBoundedModeReportExchangeAndSerialDescriptors() {
        let metadata = ContestRuleRegistry.pilots.metadata
        XCTAssertEqual(metadata.map(\.identity.id), [
            "cq-wpx-cw", "cq-wpx-ssb", "cq-ww-cw", "cq-ww-ssb", "oceania-dx-cw", "oceania-dx-ssb",
            "sac-cw", "sac-ssb",
        ])
        XCTAssertTrue(metadata.allSatisfy { $0.entry.isCoherent(supportedModes: $0.supportedModes) })

        let wwSSB = CQWWSSBRule().metadata.entry
        XCTAssertEqual(wwSSB.mode, "SSB")
        XCTAssertEqual(wwSSB.adifMode, "SSB")
        XCTAssertEqual(wwSSB.cabrilloQSOType, "PH")
        XCTAssertEqual(wwSSB.report.defaultSent, "59")
        XCTAssertEqual(wwSSB.exchange.sentDefault, .stationSnapshot)
        XCTAssertEqual(wwSSB.serial.requirement, .none)

        let wpxSSB = CQWPXSSBRule().metadata.entry
        XCTAssertEqual(wpxSSB.exchange.received, .serialNumber)
        XCTAssertEqual(wpxSSB.exchange.adifFields, .stxSrx)
        XCTAssertEqual(wpxSSB.serial.requirement, .requiredForCommit)
        XCTAssertEqual(wpxSSB.serial.allowedScopes, [.session, .band, .transmitter])
    }

    func testRuleMetadataRejectsLegacyJSONWithoutRequiredEntryDescriptor() throws {
        let encoded = try JSONEncoder().encode(CQWWCWRule().metadata)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object.removeValue(forKey: "entry")
        let legacy = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        XCTAssertThrowsError(try JSONDecoder().decode(ContestRuleMetadata.self, from: legacy))
    }

    func testCQWWSSBUsesSourceArithmeticAndPhoneReports() throws {
        let rule = CQWWSSBRule()
        let session = makeSession(rule: rule.metadata.identity, sent: "15")
        let score = try ContestEngine.score([
            qso(1, rule: rule.metadata.identity, call: "OM1AAA", band: "20m", sent: "15", received: "15", entity: om),
            qso(2, rule: rule.metadata.identity, call: "K1ABC", band: "20m", sent: "15", received: "5", entity: usa),
            qso(3, rule: rule.metadata.identity, call: "DL1AAA", band: "20m", sent: "15", received: "14", entity: germany),
        ], session: session, rule: rule)

        XCTAssertEqual(score.qsos.map(\.points), [0, 3, 1])
        XCTAssertEqual(score.totalPoints, 4)
        XCTAssertEqual(score.multiplierCount, 6)
        XCTAssertEqual(score.claimedScore, 24)

        let badReport = qso(4, rule: rule.metadata.identity, call: "K2ABC", band: "20m",
                            sent: "15", received: "5", entity: usa, rst: "599")
        let badMode = copy(badReport, mode: "CW", rst: "59")
        XCTAssertEqual(try ContestEngine.score([badReport], session: session, rule: rule).qsos[0].disposition, .invalid)
        XCTAssertEqual(try ContestEngine.score([badMode], session: session, rule: rule).qsos[0].disposition, .invalid)
    }

    func testCQWPXSSBSourcePointsPrefixesAndBandScopedDupes() throws {
        let rule = CQWPXSSBRule()
        let session = makeSession(rule: rule.metadata.identity, sent: "001")
        let score = try ContestEngine.score([
            qso(10, rule: rule.metadata.identity, call: "K1ABC", band: "20m", sent: "001", received: "101", entity: usa),
            qso(11, rule: rule.metadata.identity, call: "K1ABC", band: "20m", sent: "002", received: "102", entity: usa),
            qso(12, rule: rule.metadata.identity, call: "K1ABC", band: "40m", sent: "003", received: "103", entity: usa),
            qso(13, rule: rule.metadata.identity, call: "DL1AAA", band: "40m", sent: "004", received: "104", entity: germany),
        ], session: session, rule: rule)

        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .duplicate, .accepted, .accepted])
        XCTAssertEqual(score.qsos.map(\.points), [3, 0, 6, 2])
        XCTAssertEqual(score.qsos.map(\.newMultipliers.count), [1, 0, 0, 1])
        XCTAssertEqual(score.totalPoints, 11)
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 22)
        XCTAssertEqual(CQWPXSSBRule.wpxPrefix(for: "K1ABC/P/QRP"), "P0")
    }

    func testSSBCabrilloUsesCategorySSBAndQSOTypePH() throws {
        let rule = CQWWSSBRule()
        let session = makeSession(rule: rule.metadata.identity, sent: "15")
        let contacts = [qso(20, rule: rule.metadata.identity, call: "K1ABC", band: "20m",
                            sent: "15", received: "5", entity: usa, frequency: 14_250_000)]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        let header = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                    categoryMode: "SSB", categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: ["OM0RX"], location: "JN98")
        XCTAssertThrowsError(try CabrilloExporter.document(header: header, score: score, qsos: contacts,
                                                           session: session, rule: rule))
        let document = try CabrilloExporter.document(header: header, score: score, qsos: contacts,
                                                     session: session, rule: rule,
                                                     formatterVersion: rule.metadata.entry.cabrilloFormatterVersion)
        XCTAssertEqual(document, try fixture("cq-ww-ssb-pilot.json"))
        XCTAssertTrue(document.contains("CONTEST: CQ-WW-SSB\r\n"))
        XCTAssertTrue(document.contains("CATEGORY-MODE: SSB\r\n"))
        XCTAssertTrue(document.contains("QSO: 14250 PH"))
        XCTAssertFalse(document.contains("QSO: 14250 SSB"))
        XCTAssertThrowsError(try CabrilloExporter.document(header: copy(header, mode: "CW"), score: score,
                                                           qsos: contacts, session: session, rule: rule,
                                                           formatterVersion: rule.metadata.entry.cabrilloFormatterVersion))
    }

    func testWPXSSBCabrilloFixtureUsesSerialsAndPH() throws {
        let rule = CQWPXSSBRule()
        let session = makeSession(rule: rule.metadata.identity, sent: "001")
        let contacts = [qso(21, rule: rule.metadata.identity, call: "K1ABC", band: "20m",
                            sent: "001", received: "007", entity: usa, frequency: 14_250_000)]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        let header = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                    categoryMode: "SSB", categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: ["OM0RX"], location: "JN98")
        let document = try CabrilloExporter.document(header: header, score: score, qsos: contacts,
                                                     session: session, rule: rule,
                                                     formatterVersion: rule.metadata.entry.cabrilloFormatterVersion)
        XCTAssertEqual(document, try fixture("cq-wpx-ssb-pilot.json"))
        XCTAssertTrue(document.contains("QSO: 14250 PH"))
        XCTAssertTrue(document.contains("59  001"))
        XCTAssertTrue(document.contains("59  007"))
    }

    func testWPXSSBPilot2SingleBandReplaysMultiplierFoldAndRetainsEveryRow() throws {
        let rule = CQWPXSSBRule()
        let session = makeSession(rule: rule.metadata.identity, sent: "001")
        let contacts = [
            qso(30, rule: rule.metadata.identity, call: "K1ABC", band: "40m",
                sent: "001", received: "101", entity: usa),
            qso(31, rule: rule.metadata.identity, call: "K1XYZ", band: "20m",
                sent: "002", received: "102", entity: usa),
            qso(32, rule: rule.metadata.identity, call: "DL1AAA", band: "20m",
                sent: "003", received: "103", entity: germany),
        ]
        let header = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "20M",
                                    categoryMode: "SSB", categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: ["OM0RX"], location: "JN98")
        let input = exportInput(formatterVersion: ContestExportInput.ssbSubmissionProjectionFormatterVersion,
                                session: session, header: header, qsos: contacts)

        let projection = try input.validatedProjection(rule: rule)
        XCTAssertEqual(projection.renderedQSOs.map(\.id), contacts.map(\.id))
        XCTAssertEqual(projection.score.qsos.map(\.qsoID), [contacts[1].id, contacts[2].id])
        XCTAssertEqual(projection.score.qsos.map(\.newMultipliers.count), [1, 1])
        XCTAssertEqual(projection.score.totalPoints, 4)
        XCTAssertEqual(projection.score.multiplierCount, 2)
        XCTAssertEqual(projection.score.claimedScore, 8)
        XCTAssertEqual(try input.validatedScore(rule: rule), projection.score)

        let document = try CabrilloExporter.document(input: input, rule: rule)
        let qsoLines = document.components(separatedBy: "\r\n").filter { $0.hasPrefix("QSO: ") }
        XCTAssertEqual(qsoLines.count, 3)
        XCTAssertTrue(qsoLines.allSatisfy { $0.contains(" PH ") })
    }

    func testCWAndSSBFormatterPoliciesRemainIdentityScoped() throws {
        let ssbRule = CQWWSSBRule()
        let ssbSession = makeSession(rule: ssbRule.metadata.identity, sent: "15")
        let ssbHeader = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                       categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                       categoryMode: "SSB", categoryTransmitter: "ONE",
                                       categoryPower: "LOW", operators: ["OM0RX"], location: "JN98")
        for policy in [ContestExportInput.legacyFormatterVersion,
                       ContestExportInput.submissionProjectionFormatterVersion] {
            XCTAssertThrowsError(try exportInput(formatterVersion: policy, session: ssbSession,
                                                 header: ssbHeader, qsos: []).validatedScore(rule: ssbRule)) {
                XCTAssertEqual($0 as? ContestExportInputError, .unsupportedFormatter(policy))
            }
        }

        let cwRule = CQWWCWRule()
        let cwSession = makeSession(rule: cwRule.metadata.identity, sent: "15")
        let cwHeader = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                      categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                      categoryMode: "CW", categoryTransmitter: "ONE",
                                      categoryPower: "LOW", operators: ["OM0RX"], location: "JN98")
        for policy in [ContestExportInput.ssbFormatterVersion,
                       ContestExportInput.ssbSubmissionProjectionFormatterVersion] {
            XCTAssertThrowsError(try exportInput(formatterVersion: policy, session: cwSession,
                                                 header: cwHeader, qsos: []).validatedScore(rule: cwRule)) {
                XCTAssertEqual($0 as? ContestExportInputError, .unsupportedFormatter(policy))
            }
        }
    }

    private func makeSession(rule: ContestRuleIdentity, sent: String) -> ContestSessionSnapshot {
        ContestSessionSnapshot(id: sessionID, workspaceGeneration: UUID(uuidString: "70000000-0000-0000-0000-000000000002")!,
                               rule: rule, referenceDataVersion: "cty-fixture", startedAt: baseDate,
                               station: .init(callsign: "OM0RX", entity: om, sentExchange: sent,
                                              operatorCallsigns: ["OM0RX"], location: "JN98"))
    }

    private func qso(_ number: Int, rule: ContestRuleIdentity, call: String, band: String,
                     sent: String, received: String, entity: ContestEntitySnapshot,
                     rst: String = "59", frequency: Int64? = nil) -> ContestQSO {
        let defaultFrequency = band == "40m" ? 7_100_000 : 14_250_000
        return ContestQSO(id: fixedUUID(number), sessionID: sessionID,
                          timestampUTC: baseDate.addingTimeInterval(Double(number)), callsign: call,
                          band: band, mode: "SSB", frequencyHz: frequency ?? Int64(defaultFrequency),
                          rstSent: rst, rstReceived: rst,
                          exchange: .init(rawSent: sent, normalizedSent: sent,
                                          rawReceived: received, normalizedReceived: received),
                          entity: entity, operatorCallsign: "OM0RX", stationLocation: "JN98",
                          provenance: .init(source: .operatorEntry))
    }

    private func copy(_ qso: ContestQSO, mode: String, rst: String) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                   callsign: qso.callsign, band: qso.band, mode: mode, frequencyHz: qso.frequencyHz,
                   rstSent: rst, rstReceived: rst, exchange: qso.exchange, entity: qso.entity,
                   operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
                   provenance: qso.provenance)
    }

    private func copy(_ header: CabrilloHeader, mode: String) -> CabrilloHeader {
        CabrilloHeader(callsign: header.callsign, categoryOperator: header.categoryOperator,
                       categoryAssisted: header.categoryAssisted, categoryBand: header.categoryBand,
                       categoryMode: mode, categoryTransmitter: header.categoryTransmitter,
                       categoryPower: header.categoryPower, categoryOverlay: header.categoryOverlay,
                       operators: header.operators, location: header.location, club: header.club,
                       name: header.name, addressLines: header.addressLines, email: header.email)
    }

    private func exportInput(formatterVersion: String, session: ContestSessionSnapshot,
                             header: CabrilloHeader, qsos: [ContestQSO]) -> ContestExportInput {
        ContestExportInput(formatterVersion: formatterVersion,
                           generatedAtUTC: baseDate.addingTimeInterval(100), sessionRevision: 1,
                           session: session, ruleIdentity: session.rule,
                           referenceDataVersion: session.referenceDataVersion,
                           metadata: .init(sessionName: "SSB fixture", operatorCallsign: "OM0RX",
                                           operatorCategory: "SINGLE-OP", cabrilloHeader: header),
                           qsos: qsos)
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "70000000-0000-0000-0000-%012d", number))!
    }

    private func fixture(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports").appendingPathComponent(name)
        let lines = try JSONDecoder().decode([String].self, from: Data(contentsOf: url))
        return lines.joined(separator: "\r\n") + "\r\n"
    }
}
