import Foundation
import XCTest
@testable import XContestCore

final class ContestDeclarativeBandGridTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_900_000)

    func testBandPointsAndGridMultipliersAreScopedPerBand() throws {
        let rule = try makeRule()
        let session = makeSession(rule)
        let score = try ContestEngine.score([
            qso(1, session, "K1AAA", "6m", "FN31"),
            qso(2, session, "K1AAA", "6m", "FN31"),
            qso(3, session, "K1AAA", "2m", "FN31"),
            qso(4, session, "K2BBB", "33cm", "FN31"),
            qso(5, session, "K3CCC", "33cm", "FN32"),
        ], session: session, rule: rule)

        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .duplicate, .accepted, .accepted, .accepted])
        XCTAssertEqual(score.qsos.map(\.points), [1, 0, 1, 3, 3])
        XCTAssertEqual(score.totalPoints, 8)
        XCTAssertEqual(score.multiplierCount, 4)
        XCTAssertEqual(score.claimedScore, 32)
        XCTAssertEqual(Set(score.qsos.flatMap(\.newMultipliers)), [
            .init(kind: "maidenheadGrid4", value: "FN31", scope: "6m"),
            .init(kind: "maidenheadGrid4", value: "FN31", scope: "2m"),
            .init(kind: "maidenheadGrid4", value: "FN31", scope: "33cm"),
            .init(kind: "maidenheadGrid4", value: "FN32", scope: "33cm"),
        ])
    }

    func testInvalidGridDoesNotOccupyDupeOrMultiplierState() throws {
        let rule = try makeRule()
        let session = makeSession(rule)
        let invalid = qso(1, session, "K1AAA", "6m", "ZZ99")
        let valid = qso(2, session, "K1AAA", "6m", "FN31")
        let score = try ContestEngine.score([invalid, valid], session: session, rule: rule)

        XCTAssertEqual(score.qsos.map(\.disposition), [.invalid, .accepted])
        XCTAssertEqual(score.totalPoints, 1)
        XCTAssertEqual(score.multiplierCount, 1)
        XCTAssertEqual(score.claimedScore, 1)
    }

    func testDefinitionRejectsIncoherentGridAndBandPointPolicies() throws {
        assertInvalid(makeDraft(gridKind: .subdivision), contains: "grid multiplier field")
        assertInvalid(makeDraft(bandPoints: ["6m": 1, "2m": 1]), contains: "cover every supported band")
        assertInvalid(makeDraft(bandPoints: ["6m": 1, "2m": 1, "33cm": -1]), contains: "nonnegative")
        assertInvalid(makeDraft(bandPoints: ["6m": 1, "2m": 1, "33cm": 3],
                                clauses: [.init(fieldID: "grid", comparison: .greaterThan,
                                                threshold: 0, points: 2)]),
                      contains: "cannot be combined")
    }

    func testLegacyDefinitionsKeepNewFieldsAbsentAndStable() throws {
        let draft = TenTenDeclarativeDefinitions.draft(for: .winterPhone)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as? [String: Any])
        XCTAssertNil(object["gridMultiplier"])
        let scoring = try XCTUnwrap(object["scoring"] as? [String: Any])
        XCTAssertNil(scoring["bandPoints"])
        XCTAssertEqual(try draft.materialized().definitionDigest,
                       "0d05cff62ae87dca57224fbdc49222e346e5008235a37b493c80a04e6959ebd7")
    }

    func testGridPolicyRejectsUnknownKeys() throws {
        let data = Data(#"{"receivedFieldID":"grid","futureConstraint":true}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDeclarativeGridMultiplierPolicy.self, from: data))
    }

    private func makeRule() throws -> DeclarativeContestRule {
        DeclarativeContestRule(definition: try makeDraft().materialized())
    }

    private func makeDraft(
        gridKind: ContestExchangeFieldKind = .maidenheadGrid4,
        bandPoints: [String: Int64] = ["6m": 1, "2m": 1, "33cm": 3],
        clauses: [ContestIntegerPointClause] = []
    ) -> ContestDefinitionDraft {
        let sent = ContestExchangeFieldDescriptor(id: "grid", label: "Sent grid",
                                                  acceptedKinds: [.maidenheadGrid4], maximumUTF8Bytes: 4,
                                                  adifField: .myGridSquare)
        let received = ContestExchangeFieldDescriptor(id: "grid", label: "Grid",
                                                      acceptedKinds: [gridKind], maximumUTF8Bytes: 4,
                                                      adifField: .gridSquare)
        let entry = ContestEntryDescriptor(
            cabrilloFormatterVersion: "arrl-vhf-test-1",
            cabrilloProjectionFormatterVersion: "arrl-vhf-test-1",
            modeProfiles: [.init(mode: "CW", adifMode: "CW", cabrilloQSOType: "CW",
                                 report: .init(format: .cwRST, defaultSent: "599",
                                               defaultReceived: "599", maximumUTF8Bytes: 3))],
            exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                            adifFields: .exchangeStrings, sentFields: [sent], receivedFields: [received]),
            serial: .init(requirement: .none, allowedScopes: []),
            scorePolicy: .pointsTimesMultipliers)
        return .init(
            id: "arrl-vhf-test", version: "1", edition: "pinned-test",
            displayName: "ARRL VHF Test", cabrilloName: "ARRL-VHF",
            supportedBands: ["6m", "2m", "33cm"], supportedModes: ["CW"], entry: entry,
            sourceProvenance: "test-only shared ARRL VHF rule shape",
            dupePolicy: .perBand, multiplierPolicy: .maidenheadGrid,
            gridMultiplier: .init(receivedFieldID: "grid"),
            scoring: .init(defaultPoints: 0, clauses: clauses, bandPoints: bandPoints),
            stationEntityRequired: false)
    }

    private func makeSession(_ rule: DeclarativeContestRule) -> ContestSessionSnapshot {
        .init(id: UUID(uuidString: "EA000000-0000-0000-0000-000000000001")!,
              workspaceGeneration: UUID(uuidString: "EA000000-0000-0000-0000-000000000002")!,
              rule: rule.metadata.identity, referenceDataVersion: "arrl-vhf-test-v1", startedAt: date,
              station: .init(callsign: "OM0RX", entity: nil, sentExchange: "JN98",
                             operatorCallsigns: ["OM0RX"], sentExchangeFields: ["grid": field("JN98")]))
    }

    private func qso(_ seed: Int, _ session: ContestSessionSnapshot, _ callsign: String,
                     _ band: String, _ grid: String) -> ContestQSO {
        .init(id: UUID(uuidString: String(format: "EB000000-0000-0000-0000-%012d", seed))!,
              sessionID: session.id, timestampUTC: date.addingTimeInterval(TimeInterval(seed)),
              callsign: callsign, band: band, mode: "CW", frequencyHz: frequency(band),
              rstSent: "599", rstReceived: "599",
              exchange: .init(rawSent: "JN98", normalizedSent: "JN98",
                              rawReceived: grid, normalizedReceived: grid,
                              sentFields: ["grid": field("JN98")], receivedFields: ["grid": field(grid)]),
              entity: nil, operatorCallsign: "OM0RX", provenance: .init(source: .operatorEntry))
    }

    private func frequency(_ band: String) -> Int64 {
        switch band {
        case "6m": 50_125_000
        case "2m": 144_200_000
        default: 903_100_000
        }
    }

    private func field(_ value: String) -> ContestExchangeFieldValue {
        .init(raw: value, normalized: value)
    }

    private func assertInvalid(_ draft: ContestDefinitionDraft, contains text: String,
                               file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try draft.materialized(), file: file, line: line) { error in
            guard case let ContestDefinitionError.invalidDefinition(messages) = error else {
                return XCTFail("Unexpected error: \(error)", file: file, line: line)
            }
            XCTAssertTrue(messages.contains(where: { $0.contains(text) }), "\(messages)", file: file, line: line)
        }
    }
}
