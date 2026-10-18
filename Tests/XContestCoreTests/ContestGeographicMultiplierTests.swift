import Foundation
import XCTest
@testable import XContestCore

final class ContestGeographicMultiplierTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_600_000)
    private let referenceVersion = "cty-geographic-fixture-v1"

    func testOfficialSampleFixtureScoresTwelveByTenForOneHundredTwenty() throws {
        let fixture = try loadFixture()
        let rule = try makeRule()
        let session = makeSession(rule)
        let qsos = fixture.officialSample.contacts.map { contact in
            makeQSO(contact.qso, session: session, callsign: contact.callsign, band: contact.band,
                    name: contact.name, location: contact.location, entityADIF: entityADIF(for: contact.callsign))
        }

        let score = try ContestEngine.score(qsos, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), Array(repeating: .accepted, count: 12))
        XCTAssertEqual(score.qsos.map { $0.newMultipliers.count }, [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0])
        XCTAssertEqual(score.totalPoints, 12)
        XCTAssertEqual(score.multiplierCount, 10)
        XCTAssertEqual(score.claimedScore, 120)
    }

    func testAlaskaHawaiiAndRepeatedDXCCEntitiesAreScopedPerBand() throws {
        let rule = try makeRule()
        let session = makeSession(rule)
        let qsos = [
            makeQSO(1, session: session, callsign: "KL7AAA", band: "40m", name: "ANNA", location: "DX", entityADIF: 6),
            makeQSO(2, session: session, callsign: "KH6AAA", band: "40m", name: "HANA", location: "DX", entityADIF: 110),
            makeQSO(3, session: session, callsign: "KL7BBB", band: "40m", name: "BOB", location: "DX", entityADIF: 6),
            makeQSO(4, session: session, callsign: "KL7AAA", band: "20m", name: "ANNA", location: "DX", entityADIF: 6),
        ]
        let score = try ContestEngine.score(qsos, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map { $0.newMultipliers.count }, [1, 1, 0, 1])
        XCTAssertEqual(score.totalPoints, 4)
        XCTAssertEqual(score.multiplierCount, 3)
        XCTAssertEqual(score.claimedScore, 12)

        let keys = Set(score.qsos.flatMap(\.newMultipliers))
        XCTAssertEqual(keys, [
            key(kind: "dxccEntity", authority: "dxcc-entity", value: "6", band: "40m"),
            key(kind: "dxccEntity", authority: "dxcc-entity", value: "110", band: "40m"),
            key(kind: "dxccEntity", authority: "dxcc-entity", value: "6", band: "20m"),
        ])
    }

    func testCorrectionAndDeletionReplayRecomputesMultiplierSet() throws {
        let rule = try makeRule()
        let session = makeSession(rule)
        let us = makeQSO(1, session: session, callsign: "W1AAA", band: "40m", name: "AL", location: "MA", entityADIF: 291)
        let dx = makeQSO(2, session: session, callsign: "DL1AAA", band: "40m", name: "ANNE", location: "DX", entityADIF: 230)

        let initial = try ContestEngine.score([us, dx], session: session, rule: rule)
        XCTAssertEqual(initial.totalPoints, 2)
        XCTAssertEqual(initial.multiplierCount, 2)
        XCTAssertEqual(initial.claimedScore, 4)

        let corrected = replacingLocation(us, with: "CT")
        let correctedScore = try ContestEngine.score([corrected, dx], session: session, rule: rule)
        XCTAssertEqual(Set(correctedScore.qsos.flatMap(\.newMultipliers)), [
            key(kind: "administrativeSubdivision", authority: "sst-us-lower48-state",
                entityADIF: 291, value: "CT", band: "40m"),
            key(kind: "dxccEntity", authority: "dxcc-entity", value: "230", band: "40m"),
        ])
        XCTAssertEqual(correctedScore.claimedScore, 4)

        let afterDeletion = try ContestEngine.score([corrected], session: session, rule: rule)
        XCTAssertEqual(afterDeletion.totalPoints, 1)
        XCTAssertEqual(afterDeletion.multiplierCount, 1)
        XCTAssertEqual(afterDeletion.claimedScore, 1)
    }

    func testSameAuthorityAndTokenForDifferentEntitiesRemainDistinct() throws {
        let policy = geographicPolicy(subdivisions: [
            subdivision(291, "shared-subdivision-authority", ["AA"]),
            subdivision(1, "shared-subdivision-authority", ["AA"]),
        ])
        let rule = DeclarativeContestRule(definition: try makeDraft(geographic: policy).materialized())
        let session = makeSession(rule)
        let score = try ContestEngine.score([
            makeQSO(1, session: session, callsign: "K1AAA", band: "40m", name: "AL",
                    location: "AA", entityADIF: 291),
            makeQSO(2, session: session, callsign: "VE1AAA", band: "40m", name: "BOB",
                    location: "AA", entityADIF: 1),
        ], session: session, rule: rule)

        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(Set(score.qsos.flatMap(\.newMultipliers)), [
            key(kind: "administrativeSubdivision", authority: "shared-subdivision-authority",
                entityADIF: 291, value: "AA", band: "40m"),
            key(kind: "administrativeSubdivision", authority: "shared-subdivision-authority",
                entityADIF: 1, value: "AA", band: "40m"),
        ])
    }

    func testInvalidDraftGeographyDoesNotOccupyDupeOrMultiplierState() throws {
        let rule = try makeRule()
        let session = makeSession(rule)
        let unresolved = makeQSO(1, session: session, callsign: "ZZ0ZZ", band: "40m", name: "ZED",
                                 location: "DX", entityADIF: nil)
        let recovered = makeQSO(2, session: session, callsign: "ZZ0ZZ", band: "40m", name: "ZED",
                                location: "DX", entityADIF: 230)
        let contradictory = makeQSO(3, session: session, callsign: "KL7AAA", band: "20m", name: "ANNA",
                                    location: "AK", entityADIF: 6)
        let aggregateMismatch = replacingReceivedAggregate(
            makeQSO(4, session: session, callsign: "W1CCC", band: "20m", name: "ALICE",
                    location: "MA", entityADIF: 291), with: "BOB MA")
        let score = try ContestEngine.score([unresolved, recovered, contradictory, aggregateMismatch],
                                            session: session, rule: rule)

        XCTAssertEqual(score.qsos.map(\.disposition), [.invalid, .accepted, .invalid, .invalid])
        XCTAssertTrue(score.qsos[0].issues.contains { $0.code == "unresolvedGeography" })
        XCTAssertTrue(score.qsos[2].issues.contains { $0.code == "locationClassificationMismatch" })
        XCTAssertTrue(score.qsos[3].issues.contains { $0.code == "structuredAggregateMismatch" })
        XCTAssertEqual(score.totalPoints, 1)
        XCTAssertEqual(score.multiplierCount, 1)
        XCTAssertEqual(score.claimedScore, 1)

        let badSession = ContestSessionSnapshot(
            id: session.id, workspaceGeneration: session.workspaceGeneration, rule: session.rule,
            referenceDataVersion: "", startedAt: session.startedAt, station: session.station)
        let badReference = try ContestEngine.score([recovered], session: badSession, rule: rule)
        XCTAssertEqual(badReference.qsos.first?.disposition, .invalid)
        XCTAssertTrue(badReference.qsos.first?.issues.contains { $0.code == "invalidReferenceDataVersion" } == true)

        let punctuationSession = ContestSessionSnapshot(
            id: session.id, workspaceGeneration: session.workspaceGeneration, rule: session.rule,
            referenceDataVersion: "cty|révision:1", startedAt: session.startedAt, station: session.station)
        XCTAssertEqual(try ContestEngine.score([recovered], session: punctuationSession, rule: rule).claimedScore, 1)
    }

    func testMalformedAndDuplicateGeographicConfigsAreRejected() throws {
        let duplicateEntities = geographicPolicy(subdivisions: [
            subdivision(291, "sst-us-lower48-state", ["MA"]),
            subdivision(291, "other-state-authority", ["CT"]),
        ])
        XCTAssertThrowsError(try makeDraft(geographic: duplicateEntities).materialized())

        let emptyValues = geographicPolicy(subdivisions: [subdivision(291, "state", [])])
        XCTAssertThrowsError(try makeDraft(geographic: emptyValues).materialized())
        XCTAssertThrowsError(try makeDraft(locationMaximumUTF8Bytes: 1).materialized())
        let aliasCanonicalCollision = geographicPolicy(subdivisions: [
            subdivision(1, "province", ["NF"], aliases: ["NF": "NF"]),
        ])
        XCTAssertThrowsError(try makeDraft(geographic: aliasCanonicalCollision).materialized())
        let unknownAliasTarget = geographicPolicy(subdivisions: [
            subdivision(1, "province", ["NF"], aliases: ["NL": "XX"]),
        ])
        XCTAssertThrowsError(try makeDraft(geographic: unknownAliasTarget).materialized())
        let aliasChain = geographicPolicy(subdivisions: [
            subdivision(1, "province", ["NF"], aliases: ["NL": "LB", "LB": "NF"]),
        ])
        XCTAssertThrowsError(try makeDraft(geographic: aliasChain).materialized())
        let aliasCycle = geographicPolicy(subdivisions: [
            subdivision(1, "province", ["NF"], aliases: ["NL": "LB", "LB": "NL"]),
        ])
        XCTAssertThrowsError(try makeDraft(geographic: aliasCycle).materialized())
        let aliasesTooLarge = Dictionary(uniqueKeysWithValues: (0...128).map { ("A\($0)", "NF") })
        XCTAssertThrowsError(try makeDraft(geographic: geographicPolicy(subdivisions: [
            subdivision(1, "province", ["NF"], aliases: aliasesTooLarge),
        ])).materialized())
        XCTAssertThrowsError(try makeDraft(
            geographic: geographicPolicy(subdivisions: [
                subdivision(1, "province", ["A"], aliases: ["AB": "A"]),
            ]), locationMaximumUTF8Bytes: 1).materialized())

        let encoded = try JSONEncoder().encode(makeDraft())
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        var geographic = try XCTUnwrap(object["geographicMultiplier"] as? [String: Any])
        geographic["unexpected"] = true
        object["geographicMultiplier"] = geographic
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDefinitionDraft.self,
                                                       from: JSONSerialization.data(withJSONObject: object)))

        var duplicateValues = geographic
        var subdivisions = try XCTUnwrap(duplicateValues["subdivisions"] as? [[String: Any]])
        subdivisions[0]["values"] = ["MA", "MA"]
        duplicateValues.removeValue(forKey: "unexpected")
        duplicateValues["subdivisions"] = subdivisions
        object["geographicMultiplier"] = duplicateValues
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDefinitionDraft.self,
                                                       from: JSONSerialization.data(withJSONObject: object)))

        subdivisions[0]["values"] = ["MA"]
        subdivisions[0]["unexpected"] = true
        duplicateValues["subdivisions"] = subdivisions
        object["geographicMultiplier"] = duplicateValues
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDefinitionDraft.self,
                                                       from: JSONSerialization.data(withJSONObject: object)))
    }

    func testDXCCOnlyPolicyAndCanonicalRoundTripAreDeterministic() throws {
        let dxOnly = geographicPolicy(subdivisions: [])
        let first = try makeDraft(geographic: dxOnly).materialized()
        let decoded = try JSONDecoder().decode(ContestDeclarativeDefinition.self,
                                               from: first.canonicalStorageData())
        XCTAssertEqual(decoded, first)

        let reversed = geographicPolicy(subdivisions: [
            subdivision(291, "state", ["MA", "CT"]),
            subdivision(1, "province", ["ON", "QC"]),
        ])
        let canonical = geographicPolicy(subdivisions: [
            subdivision(1, "province", ["QC", "ON"]),
            subdivision(291, "state", ["CT", "MA"]),
        ])
        let reversedDefinition = try makeDraft(geographic: reversed).materialized()
        let canonicalDefinition = try makeDraft(geographic: canonical).materialized()
        XCTAssertEqual(reversedDefinition.definitionDigest, canonicalDefinition.definitionDigest)
        XCTAssertEqual(try JSONDecoder().decode(ContestDeclarativeDefinition.self,
                                                from: reversedDefinition.canonicalStorageData()),
                       reversedDefinition)

        let aliasA = geographicPolicy(subdivisions: [
            subdivision(1, "province", ["NF", "ON"], aliases: ["NL": "NF", "ONT": "ON"]),
        ])
        let aliasB = geographicPolicy(subdivisions: [
            subdivision(1, "province", ["ON", "NF"], aliases: ["ONT": "ON", "NL": "NF"]),
        ])
        let aliasDefinitionA = try makeDraft(geographic: aliasA).materialized()
        let aliasDefinitionB = try makeDraft(geographic: aliasB).materialized()
        XCTAssertEqual(aliasDefinitionA.definitionDigest, aliasDefinitionB.definitionDigest)
        XCTAssertEqual(try JSONDecoder().decode(ContestDeclarativeDefinition.self,
                                                from: aliasDefinitionA.canonicalStorageData()),
                       aliasDefinitionA)
    }

    func testLegacyNilConfigDigestsRemainUnchanged() throws {
        let digests = try Dictionary(uniqueKeysWithValues: TenTenSeasonalVariant.allCases.map {
            ($0.rawValue, try TenTenDeclarativeDefinitions.definition(for: $0).definitionDigest)
        })
        XCTAssertEqual(digests, [
            "winterPhone": "0d05cff62ae87dca57224fbdc49222e346e5008235a37b493c80a04e6959ebd7",
            "springCW": "817a1e0374d6d5f80721b7b10ab3d7f28d69cb2e5e4dd5d9c12de0c0f0add873",
            "summerPhone": "c83471f749359bad3d8ffffd1f54d5ec68f10358ee5d40c2a06b167da46b6778",
            "fallCW": "9bcdf0c2d6709a69689cca1cbb40aa76fb577da91c7437c00d52f04ebc75b838",
        ])
        let legacyData = try JSONEncoder().encode(TenTenDeclarativeDefinitions.draft(for: .winterPhone))
        XCTAssertNil((try JSONSerialization.jsonObject(with: legacyData) as? [String: Any])?["geographicMultiplier"])
        let noAliases = try JSONEncoder().encode(subdivision(1, "province", ["ON"]))
        XCTAssertNil((try JSONSerialization.jsonObject(with: noAliases) as? [String: Any])?["aliases"])
    }

    private func makeRule() throws -> DeclarativeContestRule {
        DeclarativeContestRule(definition: try makeDraft().materialized())
    }

    private func makeDraft(geographic: ContestDeclarativeGeographicMultiplierPolicy? = nil,
                           locationMaximumUTF8Bytes: Int = 8) -> ContestDefinitionDraft {
        let fields: [ContestExchangeFieldDescriptor] = [
            .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32),
            .init(id: "location", label: "Location", acceptedKinds: [.subdivision],
                  maximumUTF8Bytes: locationMaximumUTF8Bytes),
        ]
        let entry = ContestEntryDescriptor(
            cabrilloFormatterVersion: "geographic-fixture-1",
            cabrilloProjectionFormatterVersion: "geographic-fixture-1",
            modeProfiles: [.init(mode: "CW", adifMode: "CW", cabrilloQSOType: "CW",
                                 report: .init(format: .none, defaultSent: "", defaultReceived: "",
                                               maximumUTF8Bytes: 0))],
            exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                            adifFields: .exchangeStrings, sentFields: fields, receivedFields: fields),
            serial: .init(requirement: .none, allowedScopes: []), scorePolicy: .pointsTimesMultipliers)
        return ContestDefinitionDraft(
            id: "geographic-fixture", version: "1", edition: "test-only-observed-subset",
            displayName: "Geographic Fixture", cabrilloName: "GEO-FIXTURE",
            supportedBands: ["80m", "40m", "20m"], supportedModes: ["CW"], entry: entry,
            sourceProvenance: "test-only observed SST sample subset; not a complete sponsor geography list",
            dupePolicy: .perBand, multiplierPolicy: .geographic,
            geographicMultiplier: geographic ?? geographicPolicy(),
            scoring: .init(defaultPoints: 1, clauses: []), stationEntityRequired: false)
    }

    private func geographicPolicy(
        subdivisions: [ContestDeclarativeGeographicSubdivisionPolicy]? = nil
    ) -> ContestDeclarativeGeographicMultiplierPolicy {
        .init(locationFieldID: "location", subdivisions: subdivisions ?? [
            subdivision(291, "sst-us-lower48-state", ["MA", "MD", "GA", "IL", "CT"]),
            subdivision(1, "sst-canadian-province", ["ON"]),
        ], entityFallback: .init(authority: "dxcc-entity", locationToken: "DX"))
    }

    private func subdivision(_ adif: Int, _ authority: String, _ values: Set<String>,
                             aliases: [String: String] = [:])
        -> ContestDeclarativeGeographicSubdivisionPolicy {
        .init(entityADIF: adif, authority: authority, values: values, aliases: aliases)
    }

    private func makeSession(_ rule: DeclarativeContestRule) -> ContestSessionSnapshot {
        .init(id: UUID(uuidString: "EA000000-0000-0000-0000-000000000001")!,
              workspaceGeneration: UUID(uuidString: "EA000000-0000-0000-0000-000000000002")!,
              rule: rule.metadata.identity, referenceDataVersion: referenceVersion, startedAt: date,
              station: .init(callsign: "OM0RX", entity: nil, sentExchange: "OLIVER DX",
                             operatorCallsigns: ["OM0RX"],
                             sentExchangeFields: ["name": field("OLIVER"), "location": field("DX")]))
    }

    private func makeQSO(_ seed: Int, session: ContestSessionSnapshot, callsign: String, band: String,
                         name: String, location: String, entityADIF: Int?) -> ContestQSO {
        let received = ["name": field(name), "location": field(location)]
        return .init(id: UUID(uuidString: String(format: "EB000000-0000-0000-0000-%012d", seed))!,
                     sessionID: session.id, timestampUTC: date.addingTimeInterval(TimeInterval(seed)),
                     callsign: callsign, band: band, mode: "CW", frequencyHz: frequency(band),
                     rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: "OLIVER DX", normalizedSent: "OLIVER DX",
                                     rawReceived: "\(name) \(location)", normalizedReceived: "\(name) \(location)",
                                     sentFields: session.station.sentExchangeFields, receivedFields: received),
                     entity: entityADIF.map(entity), operatorCallsign: "OM0RX",
                     provenance: .init(source: .operatorEntry))
    }

    private func replacingLocation(_ qso: ContestQSO, with location: String) -> ContestQSO {
        let name = qso.exchange.receivedFields["name"]!.normalized
        var fields = qso.exchange.receivedFields
        fields["location"] = field(location)
        return .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                     callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
                     rstSent: qso.rstSent, rstReceived: qso.rstReceived,
                     exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                                     rawReceived: "\(name) \(location)", normalizedReceived: "\(name) \(location)",
                                     sentFields: qso.exchange.sentFields, receivedFields: fields),
                     entity: qso.entity, operatorCallsign: qso.operatorCallsign,
                     stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func replacingReceivedAggregate(_ qso: ContestQSO, with aggregate: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                              rawReceived: aggregate, normalizedReceived: aggregate,
                              sentFields: qso.exchange.sentFields,
                              receivedFields: qso.exchange.receivedFields),
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func entity(_ adif: Int) -> ContestEntitySnapshot {
        .init(adif: adif, name: "Entity \(adif)", countryPrefix: "T\(adif)", continent: "NA", cqZone: 5)
    }

    private func entityADIF(for callsign: String) -> Int {
        if callsign.hasPrefix("VE") { return 1 }
        if callsign.hasPrefix("DK") || callsign.hasPrefix("DL") { return 230 }
        if callsign.hasPrefix("F") { return 227 }
        return 291
    }

    private func key(kind: String, authority: String, entityADIF: Int? = nil,
                     value: String, band: String) -> ContestMultiplierKey {
        let components = [authority, referenceVersion] + (entityADIF.map { [String($0)] } ?? []) + [value]
        return .init(kind: kind, value: components.map { "\($0.utf8.count):\($0)" }.joined(), scope: band)
    }

    private func field(_ value: String) -> ContestExchangeFieldValue { .init(raw: value, normalized: value) }

    private func frequency(_ band: String) -> Int64 {
        switch band {
        case "80m": return 3_530_000
        case "40m": return 7_030_000
        default: return 14_030_000
        }
    }

    private func loadFixture() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/sst-geography-authority.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private struct Fixture: Decodable {
        let officialSample: OfficialSample
    }

    private struct OfficialSample: Decodable {
        let contacts: [Contact]
    }

    private struct Contact: Decodable {
        let qso: Int
        let band: String
        let callsign: String
        let name: String
        let location: String
    }
}
