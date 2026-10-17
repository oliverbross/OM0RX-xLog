import Foundation
import XCTest
@testable import XContestCore

final class ContestSubmissionProjectionTests: XCTestCase {
    private let sessionID = UUID(uuidString: "50000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "50000000-0000-0000-8000-000000000002")!
    private let date = Date(timeIntervalSince1970: 1_800_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testWWSelectedBandScoresSubsetButRendersAllContactsAndDuplicates() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule)
        let contacts = [
            qso(1, call: "K1ABC", band: "40m", entity: usa, received: "5"),
            qso(2, call: "K1ABC", band: "20m", entity: usa, received: "5"),
            qso(3, call: "K1ABC", band: "20m", entity: usa, received: "5"),
            qso(4, call: "DL1AAA", band: "20m", entity: germany, received: "14"),
        ]
        let projection = try ContestSubmissionProjection.make(qsos: contacts.reversed(), session: session,
            header: header(band: "20M"), rule: rule)

        XCTAssertEqual(projection.renderedQSOs.map(\.id), contacts.map(\.id))
        XCTAssertEqual(projection.score.qsos.map(\.qsoID), Array(contacts[1...]).map(\.id))
        XCTAssertEqual(projection.score.qsos.map(\.disposition), [.accepted, .duplicate, .accepted])
        XCTAssertEqual(projection.score.totalPoints, 4)
        XCTAssertEqual(projection.score.multiplierCount, 4)
        XCTAssertEqual(projection.score.claimedScore, 16)
    }

    func testWPXEarlierOffBandPrefixDoesNotConsumeSelectedBandMultiplier() throws {
        let rule = CQWPXCWRule()
        let session = makeSession(rule: rule)
        let offBand = qso(1, call: "K1ABC", band: "40m", entity: usa, sent: "001", received: "101")
        let selected = qso(2, call: "K1XYZ", band: "20m", entity: usa, sent: "002", received: "102")
        let projection = try ContestSubmissionProjection.make(qsos: [offBand, selected], session: session,
            header: header(band: "20M"), rule: rule)

        XCTAssertEqual(projection.score.qsos.map(\.qsoID), [selected.id])
        XCTAssertEqual(projection.score.totalPoints, 3)
        XCTAssertEqual(projection.score.multiplierCount, 1)
        XCTAssertEqual(projection.score.claimedScore, 3)
    }

    func testZeroEligibleAndAllBandProjection() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule)
        let contacts = [qso(1, call: "K1ABC", band: "40m", entity: usa, received: "5")]
        let empty = try ContestSubmissionProjection.make(qsos: contacts, session: session,
            header: header(band: "20M"), rule: rule)
        XCTAssertEqual(empty.renderedQSOs, contacts)
        XCTAssertEqual(empty.score.totalPoints, 0)
        XCTAssertEqual(empty.score.multiplierCount, 0)
        XCTAssertEqual(empty.score.claimedScore, 0)

        let all = try ContestSubmissionProjection.make(qsos: contacts, session: session,
            header: header(band: "ALL"), rule: rule)
        XCTAssertEqual(all.score, try ContestEngine.score(contacts, session: session, rule: rule))
    }

    func testInvalidOffBandContactRejectsBeforeProjection() {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule)
        let invalid = qso(1, call: "INVALID", band: "40m", entity: usa, received: "5")
        XCTAssertThrowsError(try ContestSubmissionProjection.make(qsos: [invalid], session: session,
            header: header(band: "20M"), rule: rule)) {
            XCTAssertEqual($0 as? ContestSubmissionProjectionError, .semanticInvalidQSO(invalid.id))
        }
    }

    func testPreviewCategoryRejectsUnsupportedCombinationsAndUnknownVersions() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule)
        let variants = [
            header(operatorCategory: "MULTI-OP"), header(mode: "SSB"), header(transmitter: "TWO"),
            header(overlay: "CLASSIC"), header(assisted: "MAYBE"), header(power: "MAX"), header(band: "6M"),
        ]
        for value in variants {
            XCTAssertThrowsError(try ContestSubmissionProjection.make(qsos: [], session: session,
                                                                        header: value, rule: rule))
        }
        let unknown = input(rule: rule, session: session, header: header(), qsos: [], formatterVersion: "pilot-999")
        XCTAssertThrowsError(try unknown.validatedScore(rule: rule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .unsupportedFormatter("pilot-999"))
        }
    }

    func testPilot2RejectsMismatchedSuppliedScoreAndMatchesCRLFGolden() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule)
        let contacts = [
            qso(1, call: "K1ABC", band: "40m", entity: usa, received: "5"),
            qso(2, call: "DL1AAA", band: "20m", entity: germany, received: "14"),
        ]
        let submissionHeader = header(band: "20M")
        let projection = try ContestSubmissionProjection.make(qsos: contacts, session: session,
                                                               header: submissionHeader, rule: rule)
        let fullScore = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertNotEqual(projection.score, fullScore)
        XCTAssertThrowsError(try CabrilloExporter.document(header: submissionHeader, score: fullScore,
            qsos: contacts, session: session, rule: rule,
            formatterVersion: ContestExportInput.submissionProjectionFormatterVersion))

        let value = input(rule: rule, session: session, header: submissionHeader, qsos: contacts,
                          formatterVersion: ContestExportInput.submissionProjectionFormatterVersion)
        let document = try CabrilloExporter.document(input: value, rule: rule)
        XCTAssertEqual(document, try fixture("cq-ww-cw-pilot-2-single-band.cbr"))
        XCTAssertFalse(document.replacingOccurrences(of: "\r\n", with: "").contains("\n"))
        XCTAssertEqual(document.components(separatedBy: "QSO: ").count, 3)
    }

    func testPilot1RemainsTheExplicitDefault() {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule)
        let value = input(rule: rule, session: session, header: header(band: "40M"),
                          qsos: [qso(1, call: "K1ABC", band: "20m", entity: usa, received: "5")])
        XCTAssertEqual(value.formatterVersion, ContestExportInput.legacyFormatterVersion)
        XCTAssertThrowsError(try value.validatedScore(rule: rule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .metadataMismatch)
        }
    }

    private func makeSession(rule: any ContestRule) -> ContestSessionSnapshot {
        ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "fixture-cty-1", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om,
                           sentExchange: rule.metadata.identity == CQWWCWRule.identity ? "15" : "001",
                           operatorCallsigns: ["OM0RX"], location: "DX"))
    }

    private func header(operatorCategory: String = "SINGLE-OP", assisted: String = "NON-ASSISTED",
                        band: String = "ALL", mode: String = "CW", transmitter: String = "ONE",
                        power: String = "LOW", overlay: String? = nil) -> CabrilloHeader {
        CabrilloHeader(callsign: "OM0RX", categoryOperator: operatorCategory, categoryAssisted: assisted,
            categoryBand: band, categoryMode: mode, categoryTransmitter: transmitter, categoryPower: power,
            categoryOverlay: overlay, operators: ["OM0RX"], location: "DX", name: "Operator")
    }

    private func input(rule: any ContestRule, session: ContestSessionSnapshot, header: CabrilloHeader,
                       qsos: [ContestQSO], formatterVersion: String = ContestExportInput.legacyFormatterVersion) -> ContestExportInput {
        ContestExportInput(formatterVersion: formatterVersion, generatedAtUTC: date.addingTimeInterval(60),
            sessionRevision: 1, session: session, ruleIdentity: rule.metadata.identity,
            referenceDataVersion: session.referenceDataVersion,
            metadata: .init(sessionName: "Projection", operatorCallsign: "OM0RX",
                            operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: qsos)
    }

    private func qso(_ number: Int, call: String, band: String, entity: ContestEntitySnapshot,
                     sent: String = "15", received: String) -> ContestQSO {
        let frequency: Int64 = band == "40m" ? 7_025_000 : 14_025_000
        return ContestQSO(id: UUID(uuidString: String(format: "50000000-0000-0000-0000-%012d", number))!,
            sessionID: sessionID, timestampUTC: date.addingTimeInterval(Double(number)), callsign: call,
            band: band, mode: "CW", frequencyHz: frequency, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received, normalizedReceived: received),
            entity: entity, operatorCallsign: "OM0RX", stationLocation: "DX",
            provenance: .init(source: .operatorEntry))
    }

    private func fixture(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports").appendingPathComponent(name)
        let source = try String(contentsOf: url, encoding: .utf8).replacingOccurrences(of: "\r\n", with: "\n")
        return source.replacingOccurrences(of: "\n", with: "\r\n")
    }
}
