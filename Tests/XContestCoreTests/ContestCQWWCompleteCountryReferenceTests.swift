import Foundation
import XCTest
@testable import XContestCore

final class ContestCQWWCompleteCountryReferenceTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_800_000_000)
    private let sessionID = UUID(uuidString: "91000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "91000000-0000-0000-0000-000000000002")!

    func testPackagedReferenceHasPinnedIdentityBytesAndCompleteRecordCount() throws {
        let reference = try ContestPackagedCountryReferenceLoader.cqww2026()
        XCTAssertEqual(reference.identity, .init(id: "cqww-country", version: "2026.1-complete"))
        XCTAssertEqual(reference.requiredReferenceDataVersion, "bundled-cty-fnv64-cf9c48a44d4b5e66")
        XCTAssertEqual(reference.records.count, 362)
        XCTAssertEqual(reference.revisionToken, "country-reference-fnv64-bc711180563fcc50")
        XCTAssertEqual(Set(reference.records.map(\.endpoint)).count, reference.records.count)
        XCTAssertEqual(reference.records.filter { $0.authority == .wae }.count, 5)
        XCTAssertEqual(reference.records.filter { $0.authority == .cqwwSupplement }.count, 1)
        let rule = CQWWSponsorCountryRule(
            mode: .cw, countryReference: reference,
            packagedResourceSHA256: ContestPackagedCountryReferenceLoader.resourceSHA256)
        XCTAssertEqual(rule.countryReferenceBinding, .init(
            identity: .init(id: "cqww-country", version: "2026.1-complete"),
            resourceSHA256: "3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b",
            recordCount: 362))
        XCTAssertEqual(rule.metadata.identity.sourceRevision,
                       "cqww-country@2026.1-complete+sha256:3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b")
    }

    func testIndependentCQWWPointAndMultiplierBranchesUseCompleteReference() throws {
        let reference = try ContestPackagedCountryReferenceLoader.cqww2026()
        let rule = CQWWSponsorCountryRule(mode: .cw, countryReference: reference)
        let slovakia = endpoint(adif: 504, name: "SLOVAK REPUBLIC", zone: 15, in: reference)
        let germany = endpoint(adif: 230, name: "FED. REP. OF GERMANY", zone: 14, in: reference)
        let usa = endpoint(adif: 291, name: "UNITED STATES", zone: 5, in: reference)
        let austria = endpoint(adif: 206, name: "AUSTRIA", zone: 15, in: reference)
        let vienna = endpoint(adif: 206, name: "VIENNA INTL CTR", zone: 15, in: reference)
        let session = makeSession(rule: rule.metadata.identity, station: slovakia, callsign: "OM0RX")
        let qsos = [
            qso(1, call: "OM1AAA", endpoint: slovakia, zone: "15"), // same country: 0
            qso(2, call: "DL1AAA", endpoint: germany, zone: "14"),  // same continent: 1
            qso(3, call: "K1AAA", endpoint: usa, zone: "05"),       // intercontinent: 3
            qso(4, call: "OE1AAA", endpoint: austria, zone: "15"), // ordinary DXCC: 1
            qso(5, call: "4U1VIC", endpoint: vienna, zone: "15"),  // distinct WAE country: 1
        ]
        let score = try ContestEngine.score(qsos, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.points), [0, 1, 3, 1, 1])
        XCTAssertEqual(score.totalPoints, 6)
        XCTAssertEqual(score.multiplierCount, 8) // five countries plus zones 15, 14, and 5.
        XCTAssertEqual(score.claimedScore, 48)

        let canada = endpoint(adif: 1, name: "CANADA", zone: 5, in: reference)
        let naSession = makeSession(rule: rule.metadata.identity, station: usa, callsign: "K1ZZZ")
        let naScore = try ContestEngine.score(
            [qso(6, call: "VE3AAA", endpoint: canada, zone: "05")], session: naSession, rule: rule)
        XCTAssertEqual(naScore.totalPoints, 2) // distinct countries within North America.
        XCTAssertEqual(naScore.multiplierCount, 2)
        XCTAssertEqual(naScore.claimedScore, 4)
    }

    func testLegacyCQWWIdentitiesRemainByteStableAndNewIdentityBindsReference() throws {
        XCTAssertEqual(CQWWCWRule.identity.sourceRevision,
                       "7c8b499225a73f7f8f792246881bd7aefc05452f")
        XCTAssertEqual(CQWWSSBRule.identity.sourceRevision,
                       "7c8b499225a73f7f8f792246881bd7aefc05452f")
        let reference = try ContestPackagedCountryReferenceLoader.cqww2026()
        XCTAssertTrue(CQWWSponsorCountryRule(mode: .cw, countryReference: reference)
            .metadata.identity.sourceRevision.hasSuffix(reference.revisionToken))
        XCTAssertNil(ContestRuleRegistry.pilots.rule(for:
            CQWWSponsorCountryRule(mode: .cw, countryReference: reference).metadata.identity))
    }

    func testBlankCountryReferenceDraftRemainsCQReady() throws {
        let reference = try ContestPackagedCountryReferenceLoader.cqww2026()
        let rule = CQWWSponsorCountryRule(mode: .cw, countryReference: reference)
        let slovakia = endpoint(adif: 504, name: "SLOVAK REPUBLIC", zone: 15, in: reference)
        let session = makeSession(rule: rule.metadata.identity, station: slovakia, callsign: "OM0RX")
        let blank = ContestQSO(
            id: UUID(uuidString: "92000000-0000-0000-0000-000000000099")!,
            sessionID: sessionID, timestampUTC: date,
            callsign: "", band: "20m", mode: "CW", frequencyHz: 14_025_000,
            rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "15", normalizedSent: "15", rawReceived: "", normalizedReceived: ""),
            entity: nil, provenance: .init(source: .operatorEntry)
        )
        let evaluation = rule.evaluate(blank, in: session)
        XCTAssertFalse(evaluation.validation.contains { $0.code == "invalidMaritimeMobileCallsign" })
        let readiness = try rule.operatorReadiness(
            for: blank, validation: evaluation.validation, duplicate: nil, hasReservation: false)
        XCTAssertTrue(readiness.canSendCQ)
        XCTAssertFalse(readiness.canSendCall)
    }

    private func endpoint(adif: Int, name: String, zone: Int,
                          in reference: ContestCountryMultiplierReference) -> ContestCountryMultiplierEndpoint {
        reference.records.first {
            $0.endpoint.adif == adif && $0.endpoint.entityName == name && $0.endpoint.cqZone == zone
        }!.endpoint
    }

    private func entity(_ endpoint: ContestCountryMultiplierEndpoint) -> ContestEntitySnapshot {
        .init(adif: endpoint.adif, name: endpoint.entityName, countryPrefix: "FIXTURE",
              continent: endpoint.continent, cqZone: endpoint.cqZone)
    }

    private func makeSession(rule: ContestRuleIdentity, station: ContestCountryMultiplierEndpoint,
                             callsign: String) -> ContestSessionSnapshot {
        .init(id: sessionID, workspaceGeneration: generation, rule: rule,
              referenceDataVersion: "bundled-cty-fnv64-cf9c48a44d4b5e66", startedAt: date,
              station: .init(callsign: callsign, entity: entity(station), sentExchange: "15"))
    }

    private func qso(_ number: Int, call: String, endpoint: ContestCountryMultiplierEndpoint,
                     zone: String) -> ContestQSO {
        .init(id: UUID(uuidString: String(format: "92000000-0000-0000-0000-%012d", number))!,
              sessionID: sessionID, timestampUTC: date.addingTimeInterval(TimeInterval(number)),
              callsign: call, band: "20m", mode: "CW", frequencyHz: 14_025_000,
              rstSent: "599", rstReceived: "599",
              exchange: .init(rawSent: "15", normalizedSent: "15",
                              rawReceived: zone, normalizedReceived: zone),
              entity: entity(endpoint), provenance: .init(source: .operatorEntry))
    }
}
