import Foundation
import XCTest
@testable import XContestCore

final class ContestCQWWCountryReferenceTests: XCTestCase {
    private struct Fixture: Decodable {
        struct PinnedCTY: Decodable { let sha256: String; let runtimeVersion: String }
        struct ResolverExpectation: Decodable {
            let callsign: String
            let endpoint: ContestCountryMultiplierEndpoint
        }
        struct ScoreOracle: Decodable { let points: Int64; let multipliers: Int64; let score: Int64 }
        let pinnedCTY: PinnedCTY
        let reference: ContestCountryMultiplierReference
        let resolverExpectations: [ResolverExpectation]
        let scoreOracle: ScoreOracle
    }

    private let sessionID = UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "10000000-0000-0000-0000-000000000002")!
    private let date = Date(timeIntervalSince1970: 1_800_000_000)

    func testFixturePinsCTYAndClassifiesEveryReviewedEndpoint() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.pinnedCTY.sha256,
                       "e5d907fb16842cfa3dd8502c20ebe6bfc2039c6f5b2cc73f9ea6d3f5915f6d6d")
        XCTAssertEqual(fixture.pinnedCTY.runtimeVersion, fixture.reference.requiredReferenceDataVersion)
        for expected in fixture.resolverExpectations {
            _ = try fixture.reference.multiplier(
                for: entity(expected.endpoint), referenceDataVersion: fixture.pinnedCTY.runtimeVersion
            )
        }
    }

    func testReferenceCanonicalizesOrderRoundTripsAndAllowsConsistentSharedKeys() throws {
        let fixture = try loadFixture()
        let reversed = try ContestCountryMultiplierReference(
            identity: fixture.reference.identity,
            requiredReferenceDataVersion: fixture.reference.requiredReferenceDataVersion,
            records: fixture.reference.records.reversed()
        )
        XCTAssertEqual(reversed, fixture.reference)
        XCTAssertEqual(reversed.revisionToken, fixture.reference.revisionToken)
        XCTAssertEqual(CQWWSponsorCountryRule(mode: .cw, countryReference: reversed).metadata.identity,
                       CQWWSponsorCountryRule(mode: .cw, countryReference: fixture.reference).metadata.identity)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let encoded = try encoder.encode(reversed)
        XCTAssertEqual(try JSONDecoder().decode(ContestCountryMultiplierReference.self, from: encoded),
                       fixture.reference)

        let germany = try XCTUnwrap(fixture.reference.records.first { $0.multiplierKey == "DXCC-230" })
        let secondZone = ContestCountryMultiplierRecord(
            endpoint: .init(adif: 230, entityName: "GERMANY TEST ZONE", continent: "EU", cqZone: 15),
            multiplierKey: germany.multiplierKey, displayLabel: germany.displayLabel, authority: germany.authority
        )
        XCTAssertNoThrow(try ContestCountryMultiplierReference(
            identity: fixture.reference.identity,
            requiredReferenceDataVersion: fixture.reference.requiredReferenceDataVersion,
            records: [germany, secondZone]
        ))
    }

    func testMalformedAndAmbiguousReferencesFailClosed() throws {
        let fixture = try loadFixture()
        let germany = try XCTUnwrap(fixture.reference.records.first { $0.multiplierKey == "DXCC-230" })
        XCTAssertThrowsError(try ContestCountryMultiplierReference(
            identity: fixture.reference.identity,
            requiredReferenceDataVersion: fixture.reference.requiredReferenceDataVersion,
            records: [germany, germany]
        )) { XCTAssertEqual($0 as? ContestCountryMultiplierReferenceError, .duplicateEndpoint(germany.endpoint)) }

        let conflicting = ContestCountryMultiplierRecord(
            endpoint: .init(adif: 230, entityName: "GERMANY TEST ZONE", continent: "EU", cqZone: 15),
            multiplierKey: germany.multiplierKey, displayLabel: "Conflicting label", authority: germany.authority
        )
        XCTAssertThrowsError(try ContestCountryMultiplierReference(
            identity: fixture.reference.identity,
            requiredReferenceDataVersion: fixture.reference.requiredReferenceDataVersion,
            records: [germany, conflicting]
        )) { XCTAssertEqual($0 as? ContestCountryMultiplierReferenceError,
                           .conflictingSharedKey(germany.multiplierKey)) }

        XCTAssertThrowsError(try fixture.reference.multiplier(
            for: entity(.init(adif: 999, entityName: "UNKNOWN", continent: "EU", cqZone: 14)),
            referenceDataVersion: fixture.pinnedCTY.runtimeVersion
        ))
        XCTAssertThrowsError(try fixture.reference.multiplier(
            for: entity(germany.endpoint), referenceDataVersion: "other-reference"
        ))

        let bytes = try JSONEncoder().encode(fixture.reference)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        object["unexpected"] = true
        XCTAssertThrowsError(try JSONDecoder().decode(
            ContestCountryMultiplierReference.self,
            from: JSONSerialization.data(withJSONObject: object)
        ))
        object.removeValue(forKey: "unexpected")
        var identity = try XCTUnwrap(object["identity"] as? [String: Any])
        identity["unexpected"] = true
        object["identity"] = identity
        XCTAssertThrowsError(try JSONDecoder().decode(
            ContestCountryMultiplierReference.self,
            from: JSONSerialization.data(withJSONObject: object)
        ))
    }

    func testCorrectedRuleScoresCountryKeysPerBandFromIndependentOracle() throws {
        let fixture = try loadFixture()
        let rule = CQWWSponsorCountryRule(mode: .cw, countryReference: fixture.reference)
        let session = makeSession(rule: rule.metadata.identity, reference: fixture.pinnedCTY.runtimeVersion)
        let qsos = [
            qso(1, call: "DL1AAA", band: "20m", zone: "14", endpoint: endpoint("FED. REP. OF GERMANY", in: fixture)),
            qso(2, call: "DL1AAA", band: "20m", zone: "14", endpoint: endpoint("FED. REP. OF GERMANY", in: fixture)),
            qso(3, call: "DL2BBB", band: "20m", zone: "14", endpoint: endpoint("FED. REP. OF GERMANY", in: fixture)),
            qso(4, call: "DL1AAA", band: "40m", zone: "14", endpoint: endpoint("FED. REP. OF GERMANY", in: fixture)),
            qso(5, call: "4U1VIC", band: "20m", zone: "15", endpoint: endpoint("VIENNA INTL CTR", in: fixture)),
            qso(6, call: "IG9AAA", band: "20m", zone: "33", endpoint: endpoint("AFRICAN ITALY", in: fixture)),
            qso(7, call: "IH9BBB", band: "20m", zone: "33", endpoint: endpoint("AFRICAN ITALY", in: fixture)),
            qso(8, call: "IT9AAA", band: "20m", zone: "15", endpoint: endpoint("SICILY", in: fixture)),
        ]

        let score = try ContestEngine.score(qsos, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition),
                       [.accepted, .duplicate, .accepted, .accepted, .accepted, .accepted, .accepted, .accepted])
        XCTAssertEqual(score.totalPoints, fixture.scoreOracle.points)
        XCTAssertEqual(score.multiplierCount, fixture.scoreOracle.multipliers)
        XCTAssertEqual(score.claimedScore, fixture.scoreOracle.score)
        XCTAssertEqual(score.qsos[6].newMultipliers, []) // IH9 shares the IG9 sponsor country and zone.

        let replayedSession = try roundTrip(session)
        let replayedQSOs = try roundTrip(qsos.shuffled())
        XCTAssertEqual(try ContestEngine.score(replayedQSOs, session: replayedSession, rule: rule), score)

        var corrected = qsos
        corrected[5] = qso(6, call: "IT9BBB", band: "20m", zone: "15",
                           endpoint: endpoint("SICILY", in: fixture))
        let correctedScore = try ContestEngine.score(corrected, session: session, rule: rule)
        XCTAssertEqual(correctedScore.totalPoints, 9)
        XCTAssertEqual(correctedScore.multiplierCount, 9)
        XCTAssertEqual(correctedScore.claimedScore, 81)
        corrected.remove(at: 6)
        let deletedScore = try ContestEngine.score(corrected, session: session, rule: rule)
        XCTAssertEqual(deletedScore.totalPoints, 6)
        XCTAssertEqual(deletedScore.multiplierCount, 7)
        XCTAssertEqual(deletedScore.claimedScore, 42)
    }

    func testMaritimeMobileIsZoneOnlyAtPolicyBoundaryButScoringNeedsPhysicalLocation() throws {
        let fixture = try loadFixture()
        let rule = CQWWSponsorCountryRule(mode: .cw, countryReference: fixture.reference)
        let session = makeSession(rule: rule.metadata.identity, reference: fixture.pinnedCTY.runtimeVersion)
        let maritime = qso(20, call: "DL1AAA/MM", band: "20m", zone: "14",
                           endpoint: endpoint("FED. REP. OF GERMANY", in: fixture))
        let evaluation = rule.evaluate(maritime, in: session)
        XCTAssertEqual(evaluation.points, 0)
        XCTAssertEqual(evaluation.multiplierCandidates,
                       [.init(kind: "cq-zone", value: "14", scope: "20m")])
        XCTAssertEqual(evaluation.validation.map(\.code), ["unsupportedMaritimeMobilePointLocation"])
        XCTAssertEqual(try ContestEngine.score([maritime], session: session, rule: rule).qsos[0].disposition,
                       .invalid)

        XCTAssertEqual(contestCallsignMobility("MM/F1ABC/MM"), .maritimeMobile)
        for invalid in ["K1AAA/MM/P", "K1AAA/MM/MM", "/MM", "K1AAA//MM"] {
            XCTAssertEqual(contestCallsignMobility(invalid), .invalidMobileMarker, invalid)
        }
        XCTAssertEqual(contestCallsignMobility("MM0AAA"), .land)
    }

    func testUnknownCountryAndWrongReferenceAreRejectedWithoutChangingLegacyIdentities() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(CQWWCWRule.identity,
                       .init(id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11",
                             sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f"))
        XCTAssertEqual(CQWWSSBRule.identity,
                       .init(id: "cq-ww-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11",
                             sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f"))

        let rule = CQWWSponsorCountryRule(mode: .cw, countryReference: fixture.reference)
        let unknown = qso(30, call: "F1AAA", band: "20m", zone: "14",
                          endpoint: .init(adif: 227, entityName: "FRANCE", continent: "EU", cqZone: 14))
        let session = makeSession(rule: rule.metadata.identity, reference: fixture.pinnedCTY.runtimeVersion)
        XCTAssertEqual(try ContestEngine.score([unknown], session: session, rule: rule).qsos[0].issues.map(\.code),
                       ["unknownCQWWCountry"])

        let wrong = makeSession(rule: rule.metadata.identity, reference: "other-reference")
        XCTAssertEqual(try ContestEngine.score([], session: wrong, rule: rule).totalPoints, 0)
        let evaluated = try ContestEngine.evaluate(unknown, session: wrong, rule: rule, allowIncomplete: false)
        XCTAssertTrue(evaluated.validation.contains { $0.code == "countryReferenceVersionMismatch" })

        XCTAssertNil(ContestRuleRegistry.pilots.rule(for: rule.metadata.identity))
    }

    private func loadFixture() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/cqww-2026-country-authority.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func endpoint(_ name: String, in fixture: Fixture) -> ContestCountryMultiplierEndpoint {
        fixture.reference.records.first { $0.endpoint.entityName == name }!.endpoint
    }

    private func entity(_ endpoint: ContestCountryMultiplierEndpoint) -> ContestEntitySnapshot {
        ContestEntitySnapshot(adif: endpoint.adif, name: endpoint.entityName, countryPrefix: "FIXTURE",
                              continent: endpoint.continent, cqZone: endpoint.cqZone)
    }

    private func makeSession(rule: ContestRuleIdentity, reference: String) -> ContestSessionSnapshot {
        let own = ContestCountryMultiplierEndpoint(adif: 504, entityName: "SLOVAK REPUBLIC",
                                                   continent: "EU", cqZone: 15)
        return ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule,
            referenceDataVersion: reference, startedAt: date,
            station: ContestStationSnapshot(callsign: "OM0RX", entity: entity(own), sentExchange: "15")
        )
    }

    private func qso(_ number: Int, call: String, band: String, zone: String,
                     endpoint: ContestCountryMultiplierEndpoint) -> ContestQSO {
        let frequency: Int64 = band == "40m" ? 7_025_000 : 14_025_000
        return ContestQSO(
            id: UUID(uuidString: String(format: "20000000-0000-0000-0000-%012d", number))!,
            sessionID: sessionID, timestampUTC: date.addingTimeInterval(TimeInterval(number)),
            callsign: call, band: band, mode: "CW", frequencyHz: frequency,
            rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "15", normalizedSent: "15", rawReceived: zone, normalizedReceived: zone),
            entity: entity(endpoint), provenance: .init(source: .operatorEntry)
        )
    }

    private func roundTrip<T: Codable>(_ value: T) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
    }
}
