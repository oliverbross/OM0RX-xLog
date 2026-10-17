import Foundation
import XCTest
@testable import XContestCore

final class ContestCoreTests: XCTestCase {
    private let sessionID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    private let baseDate = Date(timeIntervalSince1970: 1_700_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)

    func testCQWWBandScopedDupesCountriesZonesAndPoints() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let qsos = [
            qso(1, call: "K1ABC", band: "20m", received: "5", entity: usa),
            qso(2, call: "K1ABC", band: "20m", received: "5", entity: usa),
            qso(3, call: "K1ABC", band: "40m", received: "5", entity: usa),
            qso(4, call: "DL1AAA", band: "20m", received: "14", entity: germany),
        ]

        let score = try ContestEngine.score(qsos, session: session, rule: rule)

        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .duplicate, .accepted, .accepted])
        XCTAssertEqual(score.qsos.map(\.points), [3, 0, 3, 1])
        XCTAssertEqual(score.qsos.map(\.newMultipliers.count), [2, 0, 2, 2])
        XCTAssertEqual(score.totalPoints, 7)
        XCTAssertEqual(score.multiplierCount, 6)
        XCTAssertEqual(score.claimedScore, 42)
    }

    func testCQWWSameCountryIsZeroPointsButCanMultiply() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let contact = qso(1, call: "OM1AAA", band: "20m", received: "15", entity: om)
        let score = try ContestEngine.score([contact], session: session, rule: rule)
        XCTAssertEqual(score.totalPoints, 0)
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 0)
    }

    func testWPXSourceArithmeticAndUniquePrefixesAcrossBands() throws {
        let rule = CQWPXCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let qsos = [
            qso(1, call: "K1ABC", band: "20m", sent: "001", received: "101", entity: usa),
            qso(2, call: "K1XYZ", band: "20m", sent: "002", received: "102", entity: usa),
            qso(3, call: "K1ABC", band: "40m", sent: "003", received: "103", entity: usa),
            qso(4, call: "DL1AAA", band: "20m", sent: "004", received: "104", entity: germany),
        ]

        let score = try ContestEngine.score(qsos, session: session, rule: rule)

        // Independent fixture arithmetic: 3 + 3 + 6 + 1 points; K1 and DL1 are two prefixes.
        XCTAssertEqual(score.qsos.map(\.points), [3, 3, 6, 1])
        XCTAssertEqual(score.qsos.map(\.newMultipliers.count), [1, 0, 0, 1])
        XCTAssertEqual(score.totalPoints, 13)
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 26)
    }

    func testWPXPrefixSourceCompatibilityFixtures() {
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "K1ABC"), "K1")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "K1ABC/P"), "K1")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "OM/K1ABC"), "OM0")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "K1ABC/4"), "K4")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "ABCD"), "AB0")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "OPON"), "")
        // Generated from the pinned Python helper with SourceFixtures/probe_wpx_prefix.py.
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "K1ABC/P/QRP"), "P0")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "3ABC"), "3A0")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "EA8/K1ABC/P"), "EA8")
        XCTAssertEqual(CQWPXCWRule.wpxPrefix(for: "K1ABC/MM/QRP"), "MM0")
    }

    func testWPXNorthAmericaSameContinentPointBranches() throws {
        let rule = CQWPXCWRule()
        let session = makeSession(rule: rule.metadata.identity, stationEntity: usa)
        let score = try ContestEngine.score([
            qso(1, call: "VE1AAA", band: "20m", received: "101", entity: canada),
            qso(2, call: "VE2BBB", band: "40m", received: "102", entity: canada),
        ], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.points), [2, 4])
        XCTAssertEqual(score.totalPoints, 6)
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 12)
    }

    func testEditAndDeleteFullRescoreEqualsReplay() throws {
        let rule = CQWPXCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let original = [
            qso(1, call: "K1ABC", received: "101", entity: usa),
            qso(2, call: "K1XYZ", received: "102", entity: usa),
            qso(3, call: "DL1AAA", received: "103", entity: germany),
        ]
        let edited = [original[0], qso(2, call: "W2XYZ", received: "102", entity: usa), original[2]]
        let editedScore = try ContestEngine.score(edited, session: session, rule: rule)
        let replayScore = try ContestEngine.score([edited[2], edited[1], edited[0]], session: session, rule: rule)
        XCTAssertEqual(editedScore, replayScore)
        XCTAssertEqual(editedScore.multiplierCount, 3)

        let deletedScore = try ContestEngine.score([edited[0], edited[1]], session: session, rule: rule)
        let survivingReplay = try ContestEngine.score(Array(edited.dropLast()), session: session, rule: rule)
        XCTAssertEqual(deletedScore, survivingReplay)
    }

    func testMalformedExchangeAndUnknownEntityFailClosed() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let malformed = qso(1, call: "K1ABC", received: "41", entity: nil)
        let score = try ContestEngine.score([malformed], session: session, rule: rule)
        XCTAssertEqual(score.qsos[0].disposition, .invalid)
        XCTAssertEqual(score.qsos[0].points, 0)
        XCTAssertEqual(score.multiplierCount, 0)
        XCTAssertEqual(Set(score.qsos[0].issues.map(\.code)), ["invalidCQZone", "unknownEntity"])
    }

    func testInvalidResolvedGeographySentZoneAndRSTFailClosed() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let invalidEntity = ContestEntitySnapshot(adif: 0, name: "UNKNOWN", countryPrefix: "?", continent: "", cqZone: 0)
        let contact = qso(1, call: "K1ABC", sent: "99", received: "5", entity: invalidEntity,
                          rstSent: "59", rstReceived: "5X9")
        let score = try ContestEngine.score([contact], session: session, rule: rule)
        XCTAssertEqual(score.qsos[0].disposition, .invalid)
        XCTAssertEqual(Set(score.qsos[0].issues.map(\.code)),
                       ["invalidEntity", "invalidRSTReceived", "invalidRSTSent", "invalidSentCQZone", "sentCQZoneMismatch"])

        let invalidStation = ContestEntitySnapshot(adif: -1, name: "UNKNOWN", countryPrefix: "?", continent: "XX", cqZone: 0)
        let badSession = makeSession(rule: rule.metadata.identity, stationEntity: invalidStation)
        let badStationScore = try ContestEngine.score([qso(2, call: "K1ABC", received: "5", entity: usa)],
                                                      session: badSession, rule: rule)
        XCTAssertTrue(badStationScore.qsos[0].issues.contains { $0.code == "invalidStationEntity" })
    }

    func testRegistryRequiresExactRuleVersion() throws {
        XCTAssertNotNil(ContestRuleRegistry.pilots.rule(for: CQWWCWRule.identity))
        let wrong = ContestRuleIdentity(id: CQWWCWRule.identity.id, version: "2", edition: CQWWCWRule.identity.edition,
                                        sourceRevision: CQWWCWRule.identity.sourceRevision)
        XCTAssertNil(ContestRuleRegistry.pilots.rule(for: wrong))
        XCTAssertThrowsError(try ContestEngine.score([], session: makeSession(rule: wrong), rule: CQWWCWRule()))
    }

    func testDeterministicTieBreakUsesQSOIdentity() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let laterID = qso(2, call: "K1ABC", received: "5", entity: usa, timeOffset: 0)
        let earlierID = qso(1, call: "K1ABC", received: "5", entity: usa, timeOffset: 0)
        let score = try ContestEngine.score([laterID, earlierID], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.qsoID), [earlierID.id, laterID.id])
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .duplicate])
    }

    func testDuplicateIdentityAndNonfiniteTimestampAreRejectedBeforeOrdering() {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let first = qso(1, call: "K1ABC", received: "5", entity: usa)
        let conflicting = ContestQSO(id: first.id, sessionID: sessionID, timestampUTC: first.timestampUTC,
                                     callsign: "DL1AAA", band: "20m", mode: "CW", frequencyHz: 14_025_000,
                                     rstSent: "599", rstReceived: "599",
                                     exchange: .init(rawSent: "15", normalizedSent: "15", rawReceived: "14", normalizedReceived: "14"),
                                     entity: germany, provenance: .init(source: .operatorEntry))
        XCTAssertThrowsError(try ContestEngine.score([first, conflicting], session: session, rule: rule)) { error in
            XCTAssertEqual(error as? ContestEvaluationError, .duplicateQSOID(first.id))
        }
        let nonfinite = qso(2, call: "K1XYZ", received: "5", entity: usa,
                            timestamp: Date(timeIntervalSinceReferenceDate: .nan))
        XCTAssertThrowsError(try ContestEngine.score([nonfinite], session: session, rule: rule)) { error in
            XCTAssertEqual(error as? ContestEvaluationError, .invalidTimestamp(qsoID: nonfinite.id))
        }
    }

    func testCheckedScoreArithmeticRejectsAdditionAndMultiplicationOverflow() {
        let rule = OverflowRule()
        let session = makeSession(rule: rule.metadata.identity)
        XCTAssertThrowsError(try ContestEngine.score([qso(1, call: "K1ABC", received: "1", entity: usa)],
                                                     session: session, rule: rule)) { error in
            XCTAssertEqual(error as? ContestEvaluationError, .arithmeticOverflow)
        }
        XCTAssertThrowsError(try ContestEngine.score([
            qso(1, call: "K1ABC", received: "1", entity: usa),
            qso(2, call: "K2ABC", received: "2", entity: usa),
        ], session: session, rule: rule)) { error in
            XCTAssertEqual(error as? ContestEvaluationError, .arithmeticOverflow)
        }
    }

    func testExactCabrilloQSOAndDocumentLineEndings() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let contact = qso(1, call: "K1ABC", received: "5", entity: usa)
        let score = try ContestEngine.score([contact], session: session, rule: rule)
        let line = try CabrilloExporter.qsoLine(contact, session: session, rule: rule)
        XCTAssertEqual(line, "QSO: 14025 CW 2023-11-14 2213 OM0RX         599 15     K1ABC         599 5     ")

        let document = try CabrilloExporter.document(header: header(), score: score, qsos: [contact], session: session, rule: rule)
        XCTAssertTrue(document.hasPrefix("START-OF-LOG: 3.0\r\nCREATED-BY: OM0RX-xLog\r\nCONTEST: CQ-WW-CW\r\n"))
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 6\r\n"))
        XCTAssertTrue(document.hasSuffix("END-OF-LOG:\r\n"))
        XCTAssertFalse(document.replacingOccurrences(of: "\r\n", with: "").contains("\n"))
    }

    func testCabrilloRejectsMalformedHeaderAndQSO() throws {
        let rule = CQWPXCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let emptySerial = qso(1, call: "K1ABC", sent: "", received: "101", entity: usa)
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(emptySerial, session: session, rule: rule))
        let valid = qso(2, call: "K1ABC", received: "101", entity: usa)
        let score = try ContestEngine.score([valid], session: session, rule: rule)
        var bad = header(callsign: "OM0RX\nINJECT")
        XCTAssertThrowsError(try CabrilloExporter.document(header: bad, score: score, qsos: [valid], session: session, rule: rule))
        bad = header()
        let nonfinite = qso(3, call: "K1ABC", received: "101", entity: usa,
                            timestamp: Date(timeIntervalSinceReferenceDate: .infinity))
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(nonfinite, session: session, rule: rule))
    }

    func testCabrilloRejectsContradictoryIdentityModeAndBand() throws {
        let rule = CQWWCWRule()
        let session = makeSession(rule: rule.metadata.identity)
        let contact = qso(1, call: "K1ABC", received: "5", entity: usa)
        let score = try ContestEngine.score([contact], session: session, rule: rule)
        XCTAssertThrowsError(try CabrilloExporter.document(header: header(callsign: "OM1WRONG"), score: score,
                                                           qsos: [contact], session: session, rule: rule))
        XCTAssertThrowsError(try CabrilloExporter.document(header: header(mode: "SSB"), score: score,
                                                           qsos: [contact], session: session, rule: rule))
        XCTAssertThrowsError(try CabrilloExporter.document(header: header(band: "40M"), score: score,
                                                           qsos: [contact], session: session, rule: rule))
    }

    func testSerialStateTransitionsAreExplicitAndTerminal() {
        XCTAssertTrue(ContestSerialState.reserved.canTransition(to: .transmitted))
        XCTAssertTrue(ContestSerialState.reserved.canTransition(to: .void))
        XCTAssertTrue(ContestSerialState.uncertain.canTransition(to: .committed))
        XCTAssertFalse(ContestSerialState.committed.canTransition(to: .reserved))
        XCTAssertFalse(ContestSerialState.void.canTransition(to: .reserved))
        XCTAssertFalse(ContestSerialState.reserved.canTransition(to: .reserved))
    }

    private func makeSession(rule: ContestRuleIdentity, stationEntity: ContestEntitySnapshot? = nil) -> ContestSessionSnapshot {
        ContestSessionSnapshot(id: sessionID, workspaceGeneration: 7, rule: rule,
                               referenceDataVersion: "fixture-cty-1", startedAt: baseDate,
                               station: .init(callsign: "OM0RX", entity: stationEntity ?? om, sentExchange: "15", operatorCallsigns: ["OM0RX"]))
    }

    private func qso(_ number: Int, call: String, band: String = "20m", sent: String = "15",
                     received: String, entity: ContestEntitySnapshot?, timeOffset: TimeInterval? = nil,
                     rstSent: String = "599", rstReceived: String = "599", timestamp: Date? = nil) -> ContestQSO {
        ContestQSO(
            id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!,
            sessionID: sessionID,
            timestampUTC: timestamp ?? baseDate.addingTimeInterval(timeOffset ?? TimeInterval(number)),
            callsign: call, band: band, mode: "CW", frequencyHz: band == "40m" ? 7_025_000 : 14_025_000,
            rstSent: rstSent, rstReceived: rstReceived,
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received, normalizedReceived: received),
            entity: entity, provenance: .init(source: .operatorEntry)
        )
    }

    private func header(callsign: String = "OM0RX", mode: String = "CW", band: String = "ALL") -> CabrilloHeader {
        CabrilloHeader(callsign: callsign, categoryOperator: "SINGLE-OP", categoryAssisted: "NON-ASSISTED",
                       categoryBand: band, categoryMode: mode, categoryTransmitter: "ONE",
                       categoryPower: "LOW", operators: ["OM0RX"])
    }

    private struct OverflowRule: ContestRule {
        let metadata = ContestRuleMetadata(identity: .init(id: "overflow", version: "1", edition: "fixture", sourceRevision: "test"),
                                           displayName: "Overflow", cabrilloName: "OVERFLOW",
                                           supportedBands: ["20m"], supportedModes: ["CW"], sourceProvenance: "test")
        func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
            ContestRuleEvaluation(validation: [], dupeKey: qso.id.uuidString, points: .max,
                                  multiplierCandidates: [.init(kind: "a", value: "1", scope: "contest"),
                                                         .init(kind: "b", value: "1", scope: "contest")])
        }
        func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
    }
}
