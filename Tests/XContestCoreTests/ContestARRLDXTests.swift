import Foundation
import XCTest
@testable import XContestCore

final class ContestARRLDXTests: XCTestCase {
    private let sessionID = UUID(uuidString: "D1000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "D2000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_400_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let germany = ContestEntitySnapshot(adif: 230, name: "FEDERAL REPUBLIC OF GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let hawaii = ContestEntitySnapshot(adif: 110, name: "HAWAII", countryPrefix: "KH6", continent: "OC", cqZone: 31)
    private let alaska = ContestEntitySnapshot(adif: 6, name: "ALASKA", countryPrefix: "KL7", continent: "NA", cqZone: 1)
    private let puertoRico = ContestEntitySnapshot(adif: 202, name: "PUERTO RICO", countryPrefix: "KP4", continent: "NA", cqZone: 8)
    private let virginIslands = ContestEntitySnapshot(adif: 285, name: "US VIRGIN ISLANDS", countryPrefix: "KP2", continent: "NA", cqZone: 8)
    private let sableIsland = ContestEntitySnapshot(adif: 211, name: "SABLE ISLAND", countryPrefix: "CY0", continent: "NA", cqZone: 5)
    private let stPaulIsland = ContestEntitySnapshot(adif: 252, name: "ST PAUL ISLAND", countryPrefix: "CY9", continent: "NA", cqZone: 5)

    func testMetadataIsDirectionalStructuredAndHasNoSerial() {
        for rule in rules() {
            XCTAssertEqual(rule.draftResetSentProjection, .soleStationField)
            let entry = rule.metadata.entry
            XCTAssertEqual(entry.version, .v2)
            XCTAssertEqual(entry.serial.requirement, .none)
            XCTAssertTrue(entry.serial.allowedScopes.isEmpty)
            XCTAssertNil(entry.stationResolvedSerial)
            XCTAssertTrue(entry.stationFields.isEmpty)
            XCTAssertEqual(entry.exchange.sentFields.map(\.id), ["location", "power"])
            XCTAssertEqual(entry.exchange.receivedFields.map(\.id), ["location", "power"])
            XCTAssertEqual(rule.metadata.supportedBands, ["160m", "80m", "40m", "20m", "15m", "10m"])
            XCTAssertTrue(entry.isCoherent(supportedModes: rule.metadata.supportedModes))
        }
        XCTAssertEqual(ARRLDXCWRule().metadata.entry.report.format, .cwRST)
        XCTAssertEqual(ARRLDXSSBRule().metadata.entry.report.format, .phoneRS)
        XCTAssertEqual(ARRLRTTYRoundupRule().draftResetSentProjection, .stationAggregate)
        XCTAssertEqual(NAQPCWRule().draftResetSentProjection, .stationAggregate)
        XCTAssertEqual(NAQPSSBRule().draftResetSentProjection, .stationAggregate)
        XCTAssertEqual(NAQPRTTYRule().draftResetSentProjection, .stationAggregate)
        for metadata in ContestRuleRegistry.pilots.metadata {
            XCTAssertEqual(ContestRuleRegistry.pilots.rule(for: metadata.identity)?.draftResetSentProjection,
                           .stationAggregate)
        }
    }

    func testPowerNormalizationPreservesRawStationValue() {
        let forms = ["K": "1000", "1K": "1000", "KILO": "1000", "KW": "1000",
                     "1KW": "1000", "KWATTS": "1000", "KILOW": "1000",
                     "1000": "1000", "100W": "100", "ATT": "100", "000": "1000",
                     "5NN": "599"]
        for (raw, normalized) in forms { XCTAssertEqual(arrlDXNormalizePower(raw), normalized) }
        for raw in ["", "0", "1501", "1.5K", "watts", "2KW", "QQQ"] {
            XCTAssertNil(arrlDXNormalizePower(raw), raw)
        }
        let session = dxSession(rule: ARRLDXCWRule(), rawPower: "ATT", normalizedPower: "100")
        XCTAssertTrue(ARRLDXCWRule().validateSession(session).isEmpty)
        XCTAssertEqual(session.station.sentExchange, "ATT")
        XCTAssertEqual(session.station.sentExchangeFields["power"]?.normalized, "100")
        for raw in ["1KW", "KWATTS", "KILOW"] {
            let rawSession = dxSession(rule: ARRLDXCWRule(), rawPower: raw, normalizedPower: "1000")
            XCTAssertTrue(ARRLDXCWRule().validateSession(rawSession).isEmpty, raw)
            let contact = locationQSO(90 + raw.count, rule: ARRLDXCWRule(), call: "W1AAA",
                                      entity: usa, location: "CT", band: "20m", session: rawSession)
            XCTAssertEqual(contact.exchange.rawSent, raw)
            XCTAssertEqual(contact.exchange.normalizedSent, "1000")
            XCTAssertEqual(ARRLDXCWRule().evaluate(contact, in: rawSession).points, 3)
        }
    }

    func testDirectionalSessionAndIndependentCabrilloLocationValidation() {
        for rule in rules() {
            XCTAssertTrue(rule.validateSession(wveSession(rule: rule)).isEmpty)
            XCTAssertTrue(rule.validateSession(dxSession(rule: rule)).isEmpty)
            XCTAssertTrue(rule.validateSession(dxSession(rule: rule, entity: alaska, call: "KL7AAA", section: "AK")).isEmpty)
            XCTAssertTrue(rule.validateSession(dxSession(rule: rule, entity: hawaii, call: "KH6AAA", section: "PAC")).isEmpty)
            XCTAssertTrue(rule.validateSession(dxSession(rule: rule, entity: puertoRico, call: "KP4AAA", section: "PR")).isEmpty)
            XCTAssertTrue(rule.validateSession(dxSession(rule: rule, entity: virginIslands, call: "KP2AAA", section: "VI")).isEmpty)
            XCTAssertTrue(rule.validateSession(dxSession(rule: rule, entity: sableIsland, call: "CY0AAA", section: "DX")).isEmpty)
            XCTAssertTrue(rule.validateSession(dxSession(rule: rule, entity: stPaulIsland, call: "CY9AAA", section: "DX")).isEmpty)
            XCTAssertEqual(rule.validateSession(dxSession(rule: rule, entity: alaska, call: "KL7AAA", section: "DX"))
                .map(\.code), ["invalidStationSection"])
            XCTAssertFalse(rule.validateSession(wveSession(rule: rule, location: "AK")).isEmpty)
        }
    }

    func testCurrentDXCCEndpointsAndPortableTieOrderStayOnDXSide() throws {
        for rule in rules() {
            let session = wveSession(rule: rule)
            let endpoints = [("KL7AAA", alaska), ("KH6AAA", hawaii), ("KP4AAA", puertoRico),
                             ("KP2AAA", virginIslands), ("CY0AAA", sableIsland), ("CY9AAA", stPaulIsland)]
            let score = try ContestEngine.score(endpoints.enumerated().map { index, endpoint in
                powerQSO(60 + index, rule: rule, call: endpoint.0, entity: endpoint.1,
                         raw: "100", normalized: "100", band: "20m")
            }, session: session, rule: rule)
            XCTAssertEqual(score.totalPoints, 18)
            XCTAssertEqual(score.multiplierCount, 6)

            let tiedAt = date.addingTimeInterval(500)
            let first = replacingTime(
                powerQSO(70, rule: rule, call: "OM0RX", entity: slovakia,
                         raw: "100", normalized: "100", band: "20m"), tiedAt)
            let portable = replacingTime(
                powerQSO(71, rule: rule, call: "OM0RX/P", entity: slovakia,
                         raw: "100", normalized: "100", band: "20m"), tiedAt)
            let tied = try ContestEngine.score([portable, first], session: session, rule: rule)
            XCTAssertEqual(Dictionary(uniqueKeysWithValues: tied.qsos.map { ($0.qsoID, $0.disposition) }),
                           [first.id: .accepted, portable.id: .duplicate])
        }
    }

    func testOfficialWVEArithmeticIs75ForCWAndPhone() throws {
        for rule in rules() {
            let session = wveSession(rule: rule)
            let contacts = [
                powerQSO(1, rule: rule, call: "OM0RX", entity: slovakia, raw: "K", normalized: "1000", band: "20m"),
                powerQSO(2, rule: rule, call: "DL1ABC", entity: germany, raw: "100", normalized: "100", band: "20m"),
                powerQSO(3, rule: rule, call: "KH6AAA", entity: hawaii, raw: "ATT", normalized: "100", band: "20m"),
                powerQSO(4, rule: rule, call: "KL7AAA", entity: alaska, raw: "5NN", normalized: "599", band: "20m"),
                powerQSO(5, rule: rule, call: "OM0RX", entity: slovakia, raw: "1000", normalized: "1000", band: "20m"),
                powerQSO(6, rule: rule, call: "OM0RX", entity: slovakia, raw: "KW", normalized: "1000", band: "40m"),
            ]
            let score = try ContestEngine.score(contacts, session: session, rule: rule)
            XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .accepted, .accepted, .duplicate, .accepted])
            XCTAssertEqual(score.totalPoints, 15)
            XCTAssertEqual(score.multiplierCount, 5)
            XCTAssertEqual(score.claimedScore, 75)
        }
    }

    func testOfficialDXArithmeticIs108Then126ForCWAndPhone() throws {
        for rule in rules() {
            let session = dxSession(rule: rule)
            let contacts = [
                locationQSO(10, rule: rule, call: "W1AAA", entity: usa, location: "CT", band: "20m"),
                locationQSO(11, rule: rule, call: "W2AAA", entity: usa, location: "NY", band: "20m"),
                locationQSO(12, rule: rule, call: "VE3AAA", entity: canada, location: "ON", band: "20m"),
                locationQSO(13, rule: rule, call: "VO1AAA", entity: canada, location: "NF", band: "20m"),
                locationQSO(14, rule: rule, call: "VO2AAA", entity: canada, location: "LB", band: "20m"),
                locationQSO(15, rule: rule, call: "W1AAA", entity: usa, location: "CT", band: "20m"),
                locationQSO(16, rule: rule, call: "W1AAA", entity: usa, location: "CT", band: "40m"),
            ]
            let score108 = try ContestEngine.score(contacts, session: session, rule: rule)
            XCTAssertEqual(score108.totalPoints, 18)
            XCTAssertEqual(score108.multiplierCount, 6)
            XCTAssertEqual(score108.claimedScore, 108)
            let score126 = try ContestEngine.score(contacts + [
                locationQSO(17, rule: rule, call: "W1BBB", entity: usa, location: "CT", band: "20m"),
            ], session: session, rule: rule)
            XCTAssertEqual(score126.totalPoints, 21)
            XCTAssertEqual(score126.multiplierCount, 6)
            XCTAssertEqual(score126.claimedScore, 126)
        }
    }

    func testInvalidDirectionsEntitiesModesBandsAndFrozenSentFieldsFailClosed() throws {
        for rule in rules() {
            let wve = wveSession(rule: rule)
            let badEntity = ContestEntitySnapshot(adif: 2, name: "DELETED", countryPrefix: "XX", continent: "EU", cqZone: 14)
            let candidates = [
                locationQSO(30, rule: rule, call: "VE3AAA", entity: canada, location: "ON", band: "20m", session: wve),
                powerQSO(31, rule: rule, call: "OM0RX/MM", entity: slovakia, raw: "100", normalized: "100", band: "20m", session: wve),
                powerQSO(32, rule: rule, call: "XX1AA", entity: badEntity, raw: "100", normalized: "100", band: "20m", session: wve),
                powerQSO(33, rule: rule, call: "OM0RX", entity: slovakia, raw: "100", normalized: "100", band: "6m", session: wve),
                powerQSO(34, rule: rule, call: "OM0RX", entity: slovakia, raw: "100", normalized: "100", band: "20m", session: wve,
                         modeOverride: rule.metadata.supportedModes == ["CW"] ? "SSB" : "CW"),
                powerQSO(35, rule: rule, call: "K1AAA", entity: slovakia, raw: "100", normalized: "100", band: "20m", session: wve),
            ]
            let scored = try ContestEngine.score(candidates, session: wve, rule: rule)
            XCTAssertTrue(scored.qsos.allSatisfy { $0.disposition == .invalid })

            let good = powerQSO(36, rule: rule, call: "OM0RX", entity: slovakia, raw: "100", normalized: "100", band: "20m", session: wve)
            let tampered = replacingSent(in: good, raw: "TX", normalized: "100",
                                         fields: ["power": .init(raw: "TX", normalized: "100")])
            XCTAssertEqual(rule.evaluate(tampered, in: wve).validation.map(\.code), ["sentExchangeNotFrozen"])

            let dx = dxSession(rule: rule)
            for token in ["NL", "AK", "HI", "ZZ"] {
                XCTAssertEqual(rule.evaluate(locationQSO(40 + token.count, rule: rule, call: "W1\(token.count)AA",
                                                        entity: usa, location: token, band: "20m", session: dx), in: dx)
                    .points, 0)
            }
            XCTAssertEqual(rule.evaluate(powerQSO(50, rule: rule, call: "KL7AAA", entity: alaska,
                                                  raw: "100", normalized: "100", band: "20m", session: dx), in: dx).points, 0)
        }
    }

    func testAuthorityFixturePinsBytesComparatorSemanticsAndSharedDXCCSet() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/arrl-dx-authority.json")
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any])
        let primary = try XCTUnwrap(fixture["primaryAuthorities"] as? [[String: Any]])
        XCTAssertEqual(primary.count, 6)
        XCTAssertEqual(primary.map { $0["bytes"] as? Int }, [250769, 5793, 4428, 156080, 35066, 9535])
        XCTAssertEqual(primary.first?["sha256"] as? String, ARRLDXCWRule.identity.sourceRevision)
        XCTAssertEqual(primary[4]["url"] as? String, "https://www.arrl.org/contest-sections-list")
        let supplemental = try XCTUnwrap(fixture["supplementalAuthority"] as? [String: Any])
        XCTAssertEqual(supplemental["bytes"] as? Int, 76855)
        XCTAssertEqual(supplemental["sha256"] as? String,
                       "8bbe551e561cd919c6d53e9bb58866303eb9106edf1b46b1a9ebbaad99863a80")
        let comparators = try XCTUnwrap(fixture["sourceComparators"] as? [[String: Any]])
        XCTAssertEqual(comparators.map { $0["mode"] as? String }, ["CW", "SSB"])
        XCTAssertTrue(comparators.allSatisfy {
            $0["revision"] as? String == "7c8b499225a73f7f8f792246881bd7aefc05452f" &&
                $0["dupeType"] as? Int == 2 && $0["points"] as? Int == 3 &&
                $0["sentExchangeSource"] as? String == "configuration" &&
                $0["receivedExchangeField"] as? String == "NR" &&
                $0["wveMultiplier"] as? String == "CountryPrefix:Band" &&
                $0["dxMultiplier"] as? String == "NR:Band"
        })
        let sharedURL = fixtureURL.deletingLastPathComponent().appendingPathComponent("arrl-rtty-roundup-authority.json")
        let shared = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: sharedURL)) as? [String: Any])
        let authority = try XCTUnwrap(shared["currentDXCCEntityAuthority"] as? [String: Any])
        let codes = try XCTUnwrap(authority["adifCodes"] as? [Int])
        XCTAssertEqual(codes.count, 340)
        XCTAssertEqual(Set(codes), arrlRTTYCurrentDXCCEntityCodes)
    }

    private func rules() -> [any ContestRule] { [ARRLDXCWRule(), ARRLDXSSBRule()] }

    private func wveSession(rule: any ContestRule, location: String = "CA") -> ContestSessionSnapshot {
        .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
              referenceDataVersion: "cty-arrl-fixture", startedAt: date,
              station: .init(callsign: "K1AAA", entity: usa, sentExchange: location,
                             operatorCallsigns: ["K1AAA"], location: "EB",
                             sentExchangeFields: ["location": .init(raw: location, normalized: location)]))
    }

    private func dxSession(rule: any ContestRule, rawPower: String = "K", normalizedPower: String = "1000",
                           entity: ContestEntitySnapshot? = nil, call: String = "OM0RX",
                           section: String = "DX") -> ContestSessionSnapshot {
        .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
              referenceDataVersion: "cty-arrl-fixture", startedAt: date,
              station: .init(callsign: call, entity: entity ?? slovakia, sentExchange: rawPower,
                             operatorCallsigns: [call], location: section,
                             sentExchangeFields: ["power": .init(raw: rawPower, normalized: normalizedPower)]))
    }

    private func powerQSO(_ number: Int, rule: any ContestRule, call: String,
                          entity: ContestEntitySnapshot, raw: String, normalized: String, band: String,
                          session suppliedSession: ContestSessionSnapshot? = nil,
                          modeOverride: String? = nil) -> ContestQSO {
        let session = suppliedSession ?? wveSession(rule: rule)
        return qso(number, rule: rule, call: call, entity: entity, band: band, session: session,
                   modeOverride: modeOverride, receivedRaw: raw, receivedNormalized: normalized,
                   receivedFields: ["power": .init(raw: raw, normalized: normalized)])
    }

    private func locationQSO(_ number: Int, rule: any ContestRule, call: String,
                             entity: ContestEntitySnapshot, location: String, band: String,
                             session suppliedSession: ContestSessionSnapshot? = nil) -> ContestQSO {
        let session = suppliedSession ?? dxSession(rule: rule)
        return qso(number, rule: rule, call: call, entity: entity, band: band, session: session,
                   receivedRaw: location, receivedNormalized: location,
                   receivedFields: ["location": .init(raw: location, normalized: location)])
    }

    private func qso(_ number: Int, rule: any ContestRule, call: String, entity: ContestEntitySnapshot,
                     band: String, session: ContestSessionSnapshot, modeOverride: String? = nil,
                     receivedRaw: String, receivedNormalized: String,
                     receivedFields: [String: ContestExchangeFieldValue]) -> ContestQSO {
        let mode = modeOverride ?? rule.metadata.entry.mode
        let report = mode == "CW" ? "599" : "59"
        let sentNormalized = session.station.sentExchangeFields.values.first?.normalized ?? ""
        return .init(id: UUID(uuidString: String(format: "D4000000-0000-0000-0000-%012d", number))!,
                     sessionID: session.id, timestampUTC: date.addingTimeInterval(Double(number)), callsign: call,
                     band: band, mode: mode, frequencyHz: frequency(for: band), rstSent: report, rstReceived: report,
                     exchange: .init(rawSent: session.station.sentExchange, normalizedSent: sentNormalized,
                                     rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                                     sentFields: session.station.sentExchangeFields, receivedFields: receivedFields),
                     entity: entity, operatorCallsign: session.station.callsign,
                     stationLocation: session.station.location, provenance: .init(source: .operatorEntry))
    }

    private func replacingSent(in qso: ContestQSO, raw: String, normalized: String,
                               fields: [String: ContestExchangeFieldValue]) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived,
              exchange: .init(rawSent: raw, normalizedSent: normalized,
                              rawReceived: qso.exchange.rawReceived,
                              normalizedReceived: qso.exchange.normalizedReceived, sentFields: fields,
                              receivedFields: qso.exchange.receivedFields), entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }

    private func replacingTime(_ qso: ContestQSO, _ timestamp: Date) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: timestamp, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived, exchange: qso.exchange, entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }

    private func frequency(for band: String) -> Int64 {
        ["160m": 1_850_000, "80m": 3_550_000, "40m": 7_050_000, "20m": 14_050_000,
         "15m": 21_050_000, "10m": 28_050_000][band] ?? 50_100_000
    }
}
