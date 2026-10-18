import Foundation
import XCTest
@testable import XContestCore

final class ContestSSTDeclarativeDefinitionTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_700_000)
    private let referenceVersion = "cty-sst-authority-2026-10-18"

    func testAuthorityFixturePinsExactSubdivisionPolicies() throws {
        struct Fixture: Decodable {
            struct Source: Decodable { let name: String; let url: String; let sha256: String }
            struct Policy: Decodable {
                let entityADIF: Int
                let tokens: [String]
                let count: Int
                let aliases: [String: String]?
            }
            let activationStatus: String
            let sources: [Source]
            let subdivisionPolicies: [Policy]
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: fixtureData("sst-definition-authority.json"))
        XCTAssertEqual(fixture.activationStatus, "definition-only; not in the catalog")
        XCTAssertEqual(fixture.subdivisionPolicies.map(\.count), [49, 14])
        XCTAssertEqual(Set(fixture.subdivisionPolicies[0].tokens), SSTDeclarativeDefinition.usSubdivisionTokens)
        XCTAssertEqual(Set(fixture.subdivisionPolicies[1].tokens), SSTDeclarativeDefinition.canadianSubdivisionTokens)
        XCTAssertEqual(fixture.subdivisionPolicies[1].aliases, ["NL": "NF"])
        XCTAssertEqual(fixture.sources.first { $0.name == "Canadian multiplier table embedded in sponsor FAQ" }?.sha256,
                       "36ee41e13cae55ca81e7fbba3f48836b682167a3d859753d1c91553ae8a35920")
        XCTAssertEqual(fixture.sources.first { $0.name == "Sponsor-linked K1USNSST UDC page" }?.url,
                       "https://n1mmwp.hamdocs.com/mmfiles/k1usnsst-udc/")
        XCTAssertTrue(SSTDeclarativeDefinition.canadianSubdivisionTokens.contains("LB"))
        XCTAssertTrue(SSTDeclarativeDefinition.usSubdivisionTokens.contains("DC"))
        XCTAssertFalse(SSTDeclarativeDefinition.usSubdivisionTokens.contains("AK"))
        XCTAssertFalse(SSTDeclarativeDefinition.usSubdivisionTokens.contains("HI"))
    }

    func testOfficialSampleScoresTwelvePointsTenMultipliersOneHundredTwenty() throws {
        struct Fixture: Decodable {
            struct Sample: Decodable {
                struct Contact: Decodable {
                    let qso: Int; let band: String; let callsign: String; let name: String; let location: String
                }
                let contacts: [Contact]
            }
            let officialSample: Sample
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: fixtureData("sst-geography-authority.json"))
        let rule = try SSTDeclarativeDefinition.rule()
        let session = makeSession(rule)
        let qsos = fixture.officialSample.contacts.map {
            qso($0.qso, session: session, call: $0.callsign, band: $0.band, name: $0.name,
                location: $0.location, entityADIF: entityADIF(for: $0.callsign))
        }
        let score = try ContestEngine.score(qsos, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), Array(repeating: .accepted, count: 12))
        XCTAssertEqual(score.totalPoints, 12)
        XCTAssertEqual(score.multiplierCount, 10)
        XCTAssertEqual(score.claimedScore, 120)
    }

    func testAlaskaHawaiiAndRepeatedEntityUseDXCCPerBand() throws {
        let rule = try SSTDeclarativeDefinition.rule()
        let session = makeSession(rule)
        let score = try ContestEngine.score([
            qso(1, session: session, call: "KL7AAA", band: "40m", name: "ANNA", location: "DX", entityADIF: 6),
            qso(2, session: session, call: "KH6AAA", band: "40m", name: "HANA", location: "DX", entityADIF: 110),
            qso(3, session: session, call: "KL7BBB", band: "40m", name: "BOB", location: "DX", entityADIF: 6),
            qso(4, session: session, call: "KL7AAA", band: "20m", name: "ANNA", location: "DX", entityADIF: 6),
        ], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map { $0.newMultipliers.count }, [1, 1, 0, 1])
        XCTAssertEqual(score.totalPoints, 4)
        XCTAssertEqual(score.multiplierCount, 3)
        XCTAssertEqual(score.claimedScore, 12)
    }

    func testNewfoundlandAliasPreservesRawExchangeAndCanonicalizesOnlyScoringKey() throws {
        let rule = try SSTDeclarativeDefinition.rule()
        let session = makeSession(rule)
        let nl = qso(10, session: session, call: "VO1AAA", band: "40m", name: "AL", location: "NL", entityADIF: 1)
        let nf = qso(11, session: session, call: "VO1BBB", band: "40m", name: "BOB", location: "NF", entityADIF: 1)
        let otherBand = qso(12, session: session, call: "VO1CCC", band: "20m", name: "CAL", location: "NL", entityADIF: 1)
        let score = try ContestEngine.score([nl, nf, otherBand], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map { $0.newMultipliers.count }, [1, 0, 1])
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(nl.exchange.rawReceived, "AL NL")
        XCTAssertEqual(nl.exchange.receivedFields["location"]?.raw, "NL")
        let reversed = try ContestEngine.score([nf, nl], session: session, rule: rule)
        XCTAssertEqual(reversed.qsos.map { $0.newMultipliers.count }, [1, 0])
        XCTAssertEqual(score.qsos[0].newMultipliers.first?.value,
                       reversed.qsos[0].newMultipliers.first?.value)

        let corrected = replacingLocation(nl, with: "ON")
        let correctedScore = try ContestEngine.score([corrected, nf], session: session, rule: rule)
        XCTAssertEqual(correctedScore.multiplierCount, 2)
        XCTAssertEqual(try ContestEngine.score([nf], session: session, rule: rule).multiplierCount, 1)
    }

    func testInvalidGeographyCannotOccupyDupeStateAndDefinitionRemainsInactive() throws {
        let rule = try SSTDeclarativeDefinition.rule()
        let session = makeSession(rule)
        let unresolved = qso(20, session: session, call: "ZZ0ZZ", band: "40m", name: "ZED",
                             location: "DX", entityADIF: nil)
        let recovered = qso(21, session: session, call: "ZZ0ZZ", band: "40m", name: "ZED",
                            location: "DX", entityADIF: 230)
        let contradictory = qso(22, session: session, call: "KL7AAA", band: "20m", name: "ANN",
                                location: "AK", entityADIF: 6)
        let aggregateMismatch = replacingReceivedAggregate(
            qso(23, session: session, call: "W1AAA", band: "20m", name: "ALICE",
                location: "MA", entityADIF: 291), with: "BOB MA")
        let score = try ContestEngine.score([unresolved, recovered, contradictory, aggregateMismatch],
                                            session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.invalid, .accepted, .invalid, .invalid])
        XCTAssertEqual(score.totalPoints, 1)
        XCTAssertEqual(score.multiplierCount, 1)
        XCTAssertFalse(try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries().contains {
            $0.identity.id == SSTDeclarativeDefinition.draft().id
        })

        let definition = try SSTDeclarativeDefinition.definition()
        XCTAssertEqual(try JSONDecoder().decode(ContestDeclarativeDefinition.self,
                                                from: definition.canonicalStorageData()), definition)
    }

    func testStationGeographyUsesTheSharedPolicyAndAcceptsOnlyCanonicalOrAliasedLocations() throws {
        let rule = try SSTDeclarativeDefinition.rule()
        XCTAssertTrue(rule.validateSession(makeSession(rule, entityADIF: 291, location: "MA")).isEmpty)
        XCTAssertEqual(rule.validateSession(makeSession(rule, entityADIF: 291, location: "DX")).map(\.code),
                       ["stationLocationClassificationMismatch"])
        XCTAssertEqual(rule.validateSession(makeSession(rule, entityADIF: 230, location: "MA")).map(\.code),
                       ["stationLocationClassificationMismatch"])
        XCTAssertTrue(rule.validateSession(makeSession(rule, entityADIF: 230, location: "DX")).isEmpty)
        XCTAssertTrue(rule.validateSession(makeSession(rule, entityADIF: 6, location: "DX")).isEmpty)
        XCTAssertTrue(rule.validateSession(makeSession(rule, entityADIF: 110, location: "DX")).isEmpty)
        XCTAssertEqual(rule.validateSession(makeSession(rule, entityADIF: 6, location: "AK")).map(\.code),
                       ["stationLocationClassificationMismatch"])
        XCTAssertEqual(rule.validateSession(makeSession(rule, entityADIF: 110, location: "HI")).map(\.code),
                       ["stationLocationClassificationMismatch"])
        XCTAssertEqual(rule.validateSession(makeSession(rule, entityADIF: nil, location: "MA")).map(\.code),
                       ["unresolvedStationGeography"])

        let aliased = makeSession(rule, entityADIF: 1, location: "NL")
        XCTAssertTrue(rule.validateSession(aliased).isEmpty)
        XCTAssertEqual(aliased.station.sentExchangeFields["location"]?.raw, "NL")
        XCTAssertEqual(aliased.station.sentExchangeFields["location"]?.normalized, "NL")

        let scored = try ContestEngine.score([
            qso(30, session: aliased, call: "VO1AAA", band: "40m", name: "AL",
                location: "NL", entityADIF: 1),
        ], session: aliased, rule: rule)
        let key = try XCTUnwrap(scored.qsos.first?.newMultipliers.first)
        let identity = try XCTUnwrap(ContestGeographicMultiplierKeyDecoder.decode(key))
        XCTAssertEqual(identity.subdivision, "NF")
        XCTAssertFalse(key.value.contains(":NL"))
    }

    func testOperatorArchivePreservesRawNewfoundlandTokenAndExactScore() throws {
        let rule = try SSTDeclarativeDefinition.rule()
        let session = makeSession(rule)
        let archived = qso(40, session: session, call: "VO1AAA", band: "40m", name: "AL",
                           location: "NL", entityADIF: 1)
        let score = try ContestEngine.score([archived], session: session, rule: rule)
        XCTAssertEqual(score.totalPoints, 1)
        XCTAssertEqual(score.multiplierCount, 1)
        XCTAssertEqual(score.claimedScore, 1)
        XCTAssertEqual(archived.exchange.receivedFields["location"]?.raw, "NL")
        XCTAssertEqual(archived.exchange.receivedFields["location"]?.normalized, "NL")

        let line = try CabrilloExporter.qsoLine(archived, session: session, rule: rule)
        XCTAssertTrue(line.hasSuffix(" AL         NL      "), line)
        XCTAssertFalse(line.contains(" NF"), line)
        XCTAssertEqual(try ContestExportInput(
            formatterVersion: rule.metadata.entry.cabrilloFormatterVersion,
            generatedAtUTC: date.addingTimeInterval(100), sessionRevision: 2,
            session: session, ruleIdentity: rule.metadata.identity,
            referenceDataVersion: session.referenceDataVersion,
            metadata: .init(sessionName: "SST archive", operatorCallsign: "OM0RX",
                            operatorCategory: "SINGLE-OP",
                            cabrilloHeader: .init(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                                  categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                                  categoryMode: "CW", categoryTransmitter: "ONE",
                                                  categoryPower: "LOW", operators: ["OM0RX"], location: "MA")),
            qsos: [archived]).validatedScore(rule: rule).claimedScore, 1)
        XCTAssertNotNil(try ContestOperatorProjection.capability(for: rule))
    }

    func testOperatorPolicySupportsCQCallAndCommitPhasesWithoutWeakeningGeography() throws {
        let rule = try SSTDeclarativeDefinition.rule()
        let session = makeSession(rule)
        let complete = qso(50, session: session, call: "VO1AAA", band: "40m", name: "AL",
                           location: "NL", entityADIF: 1)
        let blank = draftPhase(complete, callsign: "", entity: nil, receivedFields: [:])
        let blankValidation = try ContestEngine.evaluate(
            blank, session: session, rule: rule, allowIncomplete: false).validation
        let blankReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: blank, validation: blankValidation,
            duplicate: nil, hasReservation: false))
        XCTAssertTrue(blankReadiness.canSendCQ)

        let call = draftPhase(complete, callsign: complete.callsign,
                              entity: complete.entity, receivedFields: [:])
        let callValidation = try ContestEngine.evaluate(
            call, session: session, rule: rule, allowIncomplete: false).validation
        let callReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: call, validation: callValidation,
            duplicate: false, hasReservation: false))
        XCTAssertTrue(callReadiness.canSendCall, "\(callValidation)")
        XCTAssertFalse(callReadiness.canCommit)

        let completeValidation = try ContestEngine.evaluate(
            complete, session: session, rule: rule, allowIncomplete: false).validation
        XCTAssertFalse(completeValidation.contains { $0.severity == .error })
        let completeReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: complete, validation: completeValidation,
            duplicate: false, hasReservation: false))
        XCTAssertTrue(completeReadiness.canCommit)

        let contradictory = replacingLocation(complete, with: "DX")
        let contradictoryValidation = try ContestEngine.evaluate(
            contradictory, session: session, rule: rule, allowIncomplete: false).validation
        let contradictoryReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: contradictory, validation: contradictoryValidation,
            duplicate: false, hasReservation: false))
        XCTAssertFalse(contradictoryReadiness.canSendCall)
        XCTAssertFalse(contradictoryReadiness.canCommit)
    }

    private func makeSession(_ rule: DeclarativeContestRule, entityADIF: Int? = 291,
                             location: String = "MA") -> ContestSessionSnapshot {
        .init(id: UUID(uuidString: "EC000000-0000-0000-0000-000000000001")!,
              workspaceGeneration: UUID(uuidString: "EC000000-0000-0000-0000-000000000002")!,
              rule: rule.metadata.identity, referenceDataVersion: referenceVersion, startedAt: date,
              station: .init(callsign: "OM0RX", entity: entityADIF.map(entity),
                             sentExchange: "OLIVER \(location)",
                             operatorCallsigns: ["OM0RX"],
                             sentExchangeFields: ["name": field("OLIVER"), "location": field(location)]))
    }

    private func qso(_ seed: Int, session: ContestSessionSnapshot, call: String, band: String,
                     name: String, location: String, entityADIF: Int?) -> ContestQSO {
        let received = ["name": field(name), "location": field(location)]
        return .init(id: UUID(uuidString: String(format: "ED000000-0000-0000-0000-%012d", seed))!,
                     sessionID: session.id, timestampUTC: date.addingTimeInterval(TimeInterval(seed)),
                     callsign: call, band: band, mode: "CW", frequencyHz: frequency(band),
                     rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: session.station.sentExchange,
                                     normalizedSent: session.station.sentExchange,
                                     rawReceived: "\(name) \(location)", normalizedReceived: "\(name) \(location)",
                                     sentFields: session.station.sentExchangeFields, receivedFields: received),
                     entity: entityADIF.map(entity), operatorCallsign: "OM0RX",
                     provenance: .init(source: .operatorEntry))
    }

    private func replacingLocation(_ contact: ContestQSO, with location: String) -> ContestQSO {
        let name = contact.exchange.receivedFields["name"]!.normalized
        var fields = contact.exchange.receivedFields
        fields["location"] = field(location)
        return .init(id: contact.id, sessionID: contact.sessionID, timestampUTC: contact.timestampUTC,
                     callsign: contact.callsign, band: contact.band, mode: contact.mode,
                     frequencyHz: contact.frequencyHz, rstSent: contact.rstSent, rstReceived: contact.rstReceived,
                     exchange: .init(rawSent: contact.exchange.rawSent,
                                     normalizedSent: contact.exchange.normalizedSent,
                                     rawReceived: "\(name) \(location)", normalizedReceived: "\(name) \(location)",
                                     sentFields: contact.exchange.sentFields, receivedFields: fields),
                     entity: contact.entity, operatorCallsign: contact.operatorCallsign,
                     stationLocation: contact.stationLocation, provenance: contact.provenance)
    }

    private func replacingReceivedAggregate(_ contact: ContestQSO, with aggregate: String) -> ContestQSO {
        .init(id: contact.id, sessionID: contact.sessionID, timestampUTC: contact.timestampUTC,
              callsign: contact.callsign, band: contact.band, mode: contact.mode,
              frequencyHz: contact.frequencyHz, rstSent: contact.rstSent, rstReceived: contact.rstReceived,
              exchange: .init(rawSent: contact.exchange.rawSent,
                              normalizedSent: contact.exchange.normalizedSent,
                              rawReceived: aggregate, normalizedReceived: aggregate,
                              sentFields: contact.exchange.sentFields,
                              receivedFields: contact.exchange.receivedFields),
              entity: contact.entity, operatorCallsign: contact.operatorCallsign,
              stationLocation: contact.stationLocation, provenance: contact.provenance)
    }

    private func draftPhase(_ contact: ContestQSO, callsign: String,
                            entity: ContestEntitySnapshot?,
                            receivedFields: [String: ContestExchangeFieldValue]) -> ContestQSO {
        let received = ["name", "location"].compactMap { receivedFields[$0]?.normalized }.joined(separator: " ")
        return .init(id: contact.id, sessionID: contact.sessionID, timestampUTC: contact.timestampUTC,
                     callsign: callsign, band: contact.band, mode: contact.mode,
                     frequencyHz: contact.frequencyHz, rstSent: contact.rstSent, rstReceived: contact.rstReceived,
                     exchange: .init(rawSent: contact.exchange.rawSent,
                                     normalizedSent: contact.exchange.normalizedSent,
                                     rawReceived: received, normalizedReceived: received,
                                     sentFields: contact.exchange.sentFields, receivedFields: receivedFields),
                     entity: entity, operatorCallsign: contact.operatorCallsign,
                     stationLocation: contact.stationLocation, provenance: contact.provenance)
    }

    private func entity(_ adif: Int) -> ContestEntitySnapshot {
        .init(adif: adif, name: "Entity \(adif)", countryPrefix: "T\(adif)", continent: "NA", cqZone: 5)
    }

    private func entityADIF(for call: String) -> Int {
        if call.hasPrefix("VE") || call.hasPrefix("VO") { return 1 }
        if call.hasPrefix("DK") || call.hasPrefix("DL") { return 230 }
        if call.hasPrefix("F") { return 227 }
        return 291
    }

    private func field(_ value: String) -> ContestExchangeFieldValue { .init(raw: value, normalized: value) }

    private func frequency(_ band: String) -> Int64 {
        switch band {
        case "160m": return 1_815_000
        case "80m": return 3_530_000
        case "40m": return 7_030_000
        case "20m": return 14_030_000
        case "15m": return 21_030_000
        default: return 28_030_000
        }
    }

    private func fixtureData(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/\(name)")
        return try Data(contentsOf: url)
    }
}
