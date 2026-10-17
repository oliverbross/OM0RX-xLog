import Foundation
import XCTest
@testable import XContestCore

final class ContestExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "f0000000-0000-0000-8000-000000000007")!
    private let baseDate = Date(timeIntervalSince1970: 1_700_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testCQWWGoldenDocumentIncludesDupesRoundedFrequencyAndStableTieOrder() throws {
        let rule = CQWWCWRule()
        let input = makeInput(rule: rule, qsos: [
            qso(2, call: "K1ABC", band: "20m", frequency: 14_025_600, sent: "15", received: "5", entity: usa),
            qso(1, call: "DL1AAA", band: "40m", frequency: 7_025_000, sent: "15", received: "14", entity: germany),
            qso(3, call: "K1ABC", band: "20m", frequency: 14_025_000, sent: "15", received: "5", entity: usa, offset: 1),
        ])

        let document = try CabrilloExporter.document(input: input, rule: rule)
        XCTAssertEqual(document, try fixture("cq-ww-cw-pilot.cbr"))
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 16\r\n"))
        XCTAssertTrue(document.contains("QSO: 14026 CW"))
        XCTAssertEqual(document.components(separatedBy: "QSO: ").count - 1, 3)
        XCTAssertFalse(document.replacingOccurrences(of: "\r\n", with: "").contains("\n"))
    }

    func testCabrilloFrequencyHalfKilohertzUsesPinnedPythonTiesToEven() throws {
        let rule = CQWWCWRule()
        let lower = qso(1, call: "K1ABC", band: "20m", frequency: 14_024_500, sent: "15", received: "5", entity: usa)
        let upper = qso(2, call: "DL1AAA", band: "20m", frequency: 14_025_500, sent: "15", received: "14", entity: germany)
        XCTAssertTrue(try CabrilloExporter.qsoLine(lower, session: makeInput(rule: rule, qsos: [lower]).session, rule: rule).hasPrefix("QSO: 14024 CW"))
        XCTAssertTrue(try CabrilloExporter.qsoLine(upper, session: makeInput(rule: rule, qsos: [upper]).session, rule: rule).hasPrefix("QSO: 14026 CW"))
    }

    func testCQWPXGoldenDocumentPreservesLeadingZeroExchangesAndScoresDupes() throws {
        let rule = CQWPXCWRule()
        let input = makeInput(rule: rule, qsos: [
            qso(1, call: "DL1AAA", band: "20m", frequency: 14_025_000, sent: "001", received: "007", entity: germany),
            qso(2, call: "K1ABC", band: "40m", frequency: 7_025_000, sent: "002", received: "042", entity: usa, offset: 1),
            qso(3, call: "K1ABC", band: "40m", frequency: 7_026_000, sent: "003", received: "043", entity: usa, offset: 2),
        ])

        let document = try CabrilloExporter.document(input: input, rule: rule)
        XCTAssertEqual(document, try fixture("cq-wpx-cw-pilot.cbr"))
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 14\r\n"))
        XCTAssertTrue(document.contains("599 001"))
        XCTAssertTrue(document.contains("599 007"))
    }

    func testExportInputRejectsIdentityReferenceMetadataAndContactContradictions() throws {
        let rule = CQWWCWRule()
        let valid = qso(1, call: "K1ABC", band: "20m", frequency: 14_025_000, sent: "15", received: "5", entity: usa)
        XCTAssertThrowsError(try makeInput(rule: rule, qsos: [valid], referenceDataVersion: "other").validatedScore(rule: rule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .referenceDataMismatch)
        }
        XCTAssertThrowsError(try makeInput(rule: rule, qsos: [valid], operatorCategory: "MULTI-OP").validatedScore(rule: rule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .metadataMismatch)
        }
        XCTAssertThrowsError(try makeInput(rule: rule, qsos: [valid, valid]).validatedScore(rule: rule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .invalidContacts(.duplicateQSOID(valid.id)))
        }
        let wrongRule = CQWPXCWRule()
        XCTAssertThrowsError(try makeInput(rule: rule, qsos: [valid]).validatedScore(rule: wrongRule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .ruleMismatch)
        }
    }

    func testCabrilloRejectsInjectionWidthAndContradictoryHeader() throws {
        let rule = CQWWCWRule()
        let valid = qso(1, call: "K1ABC", band: "20m", frequency: 14_025_000, sent: "15", received: "5", entity: usa)
        XCTAssertThrowsError(try CabrilloExporter.document(input: makeInput(rule: rule, qsos: [valid], club: "BAD\r\nCLAIMED-SCORE: 9"), rule: rule))
        let tooWide = qso(2, call: "K12345678901234", band: "20m", frequency: 14_025_000, sent: "15", received: "5", entity: usa)
        XCTAssertThrowsError(try CabrilloExporter.document(input: makeInput(rule: rule, qsos: [tooWide]), rule: rule))
        XCTAssertThrowsError(try CabrilloExporter.document(input: makeInput(rule: rule, qsos: [valid], categoryBand: "40M"), rule: rule))
    }

    func testExportInputRejectsNonfiniteLifecycleTimestamp() {
        let rule = CQWWCWRule()
        let input = makeInput(rule: rule, qsos: [], generatedAt: Date(timeIntervalSinceReferenceDate: .infinity))
        XCTAssertThrowsError(try input.validatedScore(rule: rule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .invalidTimestamp)
        }
    }

    func testSubmissionNameLocationAndOperatorsRemainDistinctFromOperationalMetadata() throws {
        let rule = CQWWCWRule()
        let valid = makeInput(rule: rule, qsos: [], operationalLocation: "",
                              submissionLocation: "DX", selectedOperator: "OM1ABC",
                              stationOperators: ["OM1ABC"], headerOperators: ["OM0RX", "OM1ABC"],
                              entrantName: "Oliver Operator")
        XCTAssertNoThrow(try valid.validatedScore(rule: rule))
        XCTAssertEqual(valid.session.station.location, "")
        XCTAssertEqual(valid.metadata.sessionName, "Pilot session")
        XCTAssertEqual(valid.metadata.cabrilloHeader.location, "DX")
        XCTAssertEqual(valid.metadata.cabrilloHeader.name, "Oliver Operator")

        let omitted = makeInput(rule: rule, qsos: [], operationalLocation: "",
                                submissionLocation: "DX", selectedOperator: "OM1ABC",
                                stationOperators: ["OM1ABC"], headerOperators: ["OM0RX"])
        XCTAssertThrowsError(try omitted.validatedScore(rule: rule)) {
            XCTAssertEqual($0 as? ContestExportInputError, .metadataMismatch)
        }
    }

    private func makeInput(rule: any ContestRule, qsos: [ContestQSO], referenceDataVersion: String = "fixture-cty-1",
                           operatorCategory: String = "SINGLE-OP", club: String? = "OM CONTEST CLUB",
                           categoryBand: String = "ALL", generatedAt: Date? = nil,
                           operationalLocation: String = "DX", submissionLocation: String = "DX",
                           selectedOperator: String = "OM0RX", stationOperators: [String] = ["OM0RX"],
                           headerOperators: [String] = ["OM0RX"], entrantName: String = "Oliver Operator") -> ContestExportInput {
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
                                             rule: rule.metadata.identity, referenceDataVersion: "fixture-cty-1",
                                             startedAt: baseDate, station: .init(callsign: "OM0RX", entity: om,
                                             sentExchange: rule.metadata.identity == CQWPXCWRule.identity ? "001" : "15",
                                             operatorCallsigns: stationOperators, location: operationalLocation))
        let header = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: categoryBand,
                                    categoryMode: "CW", categoryTransmitter: "ONE", categoryPower: "LOW",
                                    categoryOverlay: "CLASSIC", operators: headerOperators,
                                    location: submissionLocation, club: club,
                                    name: entrantName, addressLines: ["Test Street 1", "Bratislava"],
                                    email: "operator@example.test")
        return ContestExportInput(generatedAtUTC: generatedAt ?? baseDate.addingTimeInterval(60), sessionRevision: 7,
                                  session: session, ruleIdentity: rule.metadata.identity,
                                  referenceDataVersion: referenceDataVersion,
                                  metadata: .init(sessionName: "Pilot session", operatorCallsign: selectedOperator,
                                                  operatorCategory: operatorCategory, cabrilloHeader: header), qsos: qsos)
    }

    private func qso(_ number: Int, call: String, band: String, frequency: Int64, sent: String,
                     received: String, entity: ContestEntitySnapshot, offset: TimeInterval = 0) -> ContestQSO {
        ContestQSO(id: UUID(uuidString: String(format: "20000000-0000-0000-0000-%012d", number))!,
                   sessionID: sessionID, timestampUTC: baseDate.addingTimeInterval(offset), callsign: call,
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
