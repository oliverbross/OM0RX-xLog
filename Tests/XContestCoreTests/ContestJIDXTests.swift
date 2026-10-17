import Foundation
import XCTest
@testable import XContestCore

final class ContestJIDXTests: XCTestCase {
    private let sessionID = UUID(uuidString: "E1000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "E2000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_300_000)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let japan = ContestEntitySnapshot(adif: 339, name: "JAPAN", countryPrefix: "JA", continent: "AS", cqZone: 25)
    private let ogasawara = ContestEntitySnapshot(adif: 192, name: "OGASAWARA", countryPrefix: "JD1", continent: "AS", cqZone: 27)
    private let minamitorishima = ContestEntitySnapshot(adif: 177, name: "MINAMITORISHIMA", countryPrefix: "JD1", continent: "OC", cqZone: 27)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let scotland = ContestEntitySnapshot(adif: 279, name: "SCOTLAND", countryPrefix: "GM", continent: "EU", cqZone: 14)

    func testDescriptorsAreDedicatedV2PracticePreviewsAndHaveNoSerial() throws {
        XCTAssertNil(ContestRuleRegistry.pilots.rule(for: JIDXCWRule.identity))
        XCTAssertNil(ContestRuleRegistry.pilots.rule(for: JIDXSSBRule.identity))
        XCTAssertEqual(ContestRuleRegistry.pilots.metadata.count, 8)

        for rule in [JIDXCWRule().metadata, JIDXSSBRule().metadata] {
            XCTAssertEqual(rule.identity.version, "1.0.0-2026-rules-preview")
            XCTAssertEqual(rule.identity.edition, "2026-10-rules-preview")
            XCTAssertEqual(rule.identity.sourceRevision,
                           "01f529ab02a70c70e33ece347ee4387feb59b7786085795ed7609d0a7bebd4aa")
            XCTAssertEqual(rule.supportedBands, ["160m", "80m", "40m", "20m", "15m", "10m"])
            XCTAssertEqual(rule.entry.exchange.sentFields.map(\.id), ["number"])
            XCTAssertEqual(rule.entry.exchange.receivedFields.map(\.id), ["number"])
            XCTAssertEqual(rule.entry.exchange.sentFields[0].acceptedKinds,
                           [.cqZone, .jarlPrefectureNumber])
            XCTAssertEqual(rule.entry.serial.requirement, .none)
            XCTAssertEqual(rule.entry.serial.allowedScopes, [])
            XCTAssertTrue(rule.entry.isCoherent(supportedModes: rule.supportedModes))
        }
        XCTAssertEqual(try JIDXCWRule().resolvedSerialRequirement(
            in: session(rule: JIDXCWRule(), call: "OM0RX", entity: slovakia,
                        raw: "15", normalized: "15")).requirement, .none)
    }

    func testIndependentFixtureOraclesDecodeAndScoreBothEntrantSides() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.japaneseLocationMultipliers.count, 50)
        XCTAssertEqual(fixture.independentOracles.count, 2)
        XCTAssertEqual(fixture.callsignAuthorities.count, 1)
        XCTAssertEqual(fixture.callsignAuthorities.first?.cachedPath,
                       "/tmp/rsgb-operating-for-visitors.html")
        XCTAssertEqual(fixture.callsignAuthorities.first?.sha256,
                       "c115478a145a6d8cd9746917f5f3c7b70e58af3c3fa45cac787767b038282d56")
        let adif = try XCTUnwrap(fixture.primaryAuthorities.first { $0.name == "ADIF 3.1.7 Specification" })
        XCTAssertEqual(adif.cachedPath, "/tmp/adif-3.1.7.html")
        XCTAssertEqual(adif.sha256,
                       "b766703277e952e6b548ccdc73e32ff16e10f84c060be616cf110449eddc5c97")

        for (oracleIndex, oracle) in fixture.independentOracles.enumerated() {
            let rule = JIDXCWRule()
            let stationEntity = try XCTUnwrap(entity(adif: oracle.station.adif))
            let station = session(rule: rule, call: oracle.station.callsign, entity: stationEntity,
                                  raw: oracle.station.sentExchange,
                                  normalized: oracle.station.sentExchange)
            let contacts = try oracle.contacts.enumerated().map { offset, contact in
                qso(100 + oracleIndex * 20 + offset, rule: rule, station: station,
                    call: contact.callsign, band: contact.band,
                    entity: try XCTUnwrap(entity(adif: contact.adif)),
                    receivedRaw: contact.receivedExchange,
                    receivedNormalized: contact.receivedExchange)
            }
            let score = try ContestEngine.score(contacts, session: station, rule: rule)

            XCTAssertEqual(score.qsos.map { $0.disposition.rawValue },
                           oracle.contacts.map(\.disposition), oracle.name)
            XCTAssertEqual(score.qsos.map(\.points), oracle.contacts.map(\.points), oracle.name)
            for (actual, expected) in zip(score.qsos, oracle.contacts) {
                XCTAssertEqual(Set(actual.newMultipliers.map(multiplierToken)),
                               Set(expected.newMultipliers), oracle.name)
            }
            XCTAssertEqual(score.totalPoints, oracle.totalPoints, oracle.name)
            XCTAssertEqual(score.multiplierCount, oracle.totalMultipliers, oracle.name)
            XCTAssertEqual(score.claimedScore, oracle.claimedScore, oracle.name)
        }
    }

    func testSixBandWeightsAndPerBandDupeAndMultiplierScope() throws {
        let rule = JIDXCWRule()
        let station = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let bands = ["160m", "80m", "40m", "20m", "15m", "10m"]
        var contacts = bands.enumerated().map { index, band in
            qso(200 + index, rule: rule, station: station, call: "JA1AAA", band: band,
                entity: japan, receivedRaw: "10", receivedNormalized: "10")
        }
        contacts.insert(qso(219, rule: rule, station: station, call: "JA1AAA", band: "20m",
                            entity: japan, receivedRaw: "10", receivedNormalized: "10"), at: 4)
        let score = try ContestEngine.score(contacts, session: station, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition),
                       [.accepted, .accepted, .accepted, .accepted, .accepted, .accepted, .duplicate])
        XCTAssertEqual(score.qsos.map(\.points), [4, 2, 1, 1, 1, 2, 0])
        XCTAssertEqual(score.totalPoints, 11)
        XCTAssertEqual(score.multiplierCount, 6)
        XCTAssertEqual(score.claimedScore, 66)
        XCTAssertEqual(Set(score.qsos.flatMap(\.newMultipliers).map(\.scope)), Set(bands))
    }

    func testPhoneProfileUsesPHMetadataAndPhoneReports() throws {
        let rule = JIDXSSBRule()
        XCTAssertEqual(rule.metadata.cabrilloName, "JIDX-PH")
        XCTAssertEqual(rule.metadata.entry.modeProfiles.singleValue?.cabrilloQSOType, "PH")
        let station = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let valid = qso(300, rule: rule, station: station, call: "JA1AAA", band: "20m",
                        entity: japan, receivedRaw: "10", receivedNormalized: "10")
        XCTAssertEqual(try ContestEngine.score([valid], session: station, rule: rule).qsos[0].disposition,
                       .accepted)
        let invalidReport = qso(301, rule: rule, station: station, call: "JA1BBB", band: "20m",
                                entity: japan, receivedRaw: "10", receivedNormalized: "10",
                                rstSent: "599", rstReceived: "599")
        XCTAssertEqual(try ContestEngine.score([invalidReport], session: station, rule: rule)
            .qsos[0].disposition, .invalid)
    }

    func testMaritimeMobileRoleHomeEntityExclusionAndFixedStationZone() throws {
        let rule = JIDXCWRule()
        let jaStation = session(rule: rule, call: "JA1ZZZ", entity: japan, raw: "10", normalized: "10")
        let workedMM = qso(400, rule: rule, station: jaStation, call: "VE3AAA/MM", band: "10m",
                           entity: canada, receivedRaw: "25", receivedNormalized: "25")
        let scottishLand = qso(403, rule: rule, station: jaStation, call: "MM/F1ABC", band: "20m",
                               entity: scotland, receivedRaw: "14", receivedNormalized: "14")
        let prefixedMM = qso(404, rule: rule, station: jaStation, call: "MM/F1ABC/MM", band: "15m",
                             entity: scotland, receivedRaw: "26", receivedNormalized: "26")
        let jaScore = try ContestEngine.score([workedMM, scottishLand, prefixedMM],
                                              session: jaStation, rule: rule)
        XCTAssertEqual(jaScore.totalPoints, 4)
        XCTAssertEqual(jaScore.multiplierCount, 4)
        XCTAssertEqual(jaScore.claimedScore, 16)
        XCTAssertEqual(jaScore.qsos[0].newMultipliers,
                       [.init(kind: "cqZone", value: "25", scope: "10m")])
        XCTAssertEqual(Set(jaScore.qsos[1].newMultipliers), [
            .init(kind: "dxccEntity", value: "279", scope: "20m"),
            .init(kind: "cqZone", value: "14", scope: "20m"),
        ])
        XCTAssertEqual(jaScore.qsos[2].newMultipliers,
                       [.init(kind: "cqZone", value: "26", scope: "15m")])

        let mmStation = session(rule: rule, call: "VE3AAA/MM", entity: nil, raw: "25", normalized: "25")
        XCTAssertTrue(rule.validateSession(mmStation).isEmpty)
        let workedJA = qso(401, rule: rule, station: mmStation, call: "JA1AAA", band: "20m",
                           entity: japan, receivedRaw: "10", receivedNormalized: "10")
        let mmScore = try ContestEngine.score([workedJA], session: mmStation, rule: rule)
        XCTAssertEqual(mmScore.totalPoints, 1)
        XCTAssertEqual(mmScore.qsos[0].newMultipliers,
                       [.init(kind: "jidxLocation", value: "10", scope: "20m")])

        let changedZone = qso(402, rule: rule, station: mmStation, call: "JA1BBB", band: "20m",
                              entity: japan, receivedRaw: "10", receivedNormalized: "10",
                              sentRaw: "24", sentNormalized: "24")
        XCTAssertEqual(try ContestEngine.score([changedZone], session: mmStation, rule: rule)
            .qsos[0].disposition, .invalid)

        let deletedHome = ContestEntitySnapshot(adif: 194, name: "DELETED", countryPrefix: "XX",
                                                continent: "AS", cqZone: 25)
        XCTAssertFalse(rule.validateSession(session(rule: rule, call: "XX1AAA/MM", entity: deletedHome,
                                                    raw: "25", normalized: "25")).isEmpty)

        let scottishEntrant = session(rule: rule, call: "MM/F1ABC", entity: scotland,
                                      raw: "14", normalized: "14")
        XCTAssertTrue(rule.validateSession(scottishEntrant).isEmpty)
        XCTAssertFalse(rule.validateSession(session(rule: rule, call: "MM/F1ABC", entity: nil,
                                                    raw: "14", normalized: "14")).isEmpty)
        XCTAssertTrue(rule.validateSession(session(rule: rule, call: "MM/F1ABC/MM", entity: nil,
                                                   raw: "26", normalized: "26")).isEmpty)

        for invalidCall in ["K1AAA/MM/P", "K1AAA/MM/MM", "K1AAA/AM", "MM/F1ABC/AM"] {
            let invalidEntrant = session(rule: rule, call: invalidCall, entity: canada,
                                         raw: "25", normalized: "25")
            XCTAssertFalse(rule.validateSession(invalidEntrant).isEmpty, invalidCall)
            let invalidWorked = qso(410 + invalidCall.count, rule: rule, station: jaStation,
                                    call: invalidCall, band: "40m", entity: canada,
                                    receivedRaw: "25", receivedNormalized: "25")
            XCTAssertEqual(try ContestEngine.score([invalidWorked], session: jaStation, rule: rule)
                .qsos[0].disposition, .invalid, invalidCall)
        }
    }

    func testSameSideContactsHaveNoPointsOrMultipliers() throws {
        let rule = JIDXCWRule()
        let jaStation = session(rule: rule, call: "JA1ZZZ", entity: japan, raw: "10", normalized: "10")
        let jaJA = try ContestEngine.score([
            qso(500, rule: rule, station: jaStation, call: "JA1AAA", band: "20m", entity: japan,
                receivedRaw: "03", receivedNormalized: "03")
        ], session: jaStation, rule: rule)
        XCTAssertEqual(jaJA.qsos[0].disposition, .accepted)
        XCTAssertEqual(jaJA.claimedScore, 0)
        XCTAssertTrue(jaJA.qsos[0].newMultipliers.isEmpty)

        let dxStation = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let dxDX = try ContestEngine.score([
            qso(501, rule: rule, station: dxStation, call: "DL1AAA", band: "20m", entity: germany,
                receivedRaw: "14", receivedNormalized: "14")
        ], session: dxStation, rule: rule)
        XCTAssertEqual(dxDX.qsos[0].disposition, .accepted)
        XCTAssertEqual(dxDX.claimedScore, 0)
        XCTAssertTrue(dxDX.qsos[0].newMultipliers.isEmpty)
    }

    func testCallComponentMustContainItsOwnLettersAndDigits() throws {
        let rule = JIDXCWRule()
        let jaStation = session(rule: rule, call: "JA1ZZZ", entity: japan,
                                raw: "10", normalized: "10")
        let valid: [(String, ContestEntitySnapshot, String)] = [
            ("MM/F1ABC", scotland, "14"),
            ("MM/F1ABC/MM", scotland, "14"),
            ("DL/K1ABC", germany, "14"),
            ("K1ABC/7", usa, "05"),
            ("K1A", usa, "05"),
        ]
        for (offset, candidate) in valid.enumerated() {
            let entrant = session(rule: rule, call: candidate.0, entity: candidate.1,
                                  raw: candidate.2, normalized: candidate.2)
            XCTAssertTrue(rule.validateSession(entrant).isEmpty, candidate.0)
            let worked = qso(1_000 + offset, rule: rule, station: jaStation,
                             call: candidate.0, band: "20m", entity: candidate.1,
                             receivedRaw: candidate.2, receivedNormalized: candidate.2)
            XCTAssertEqual(try ContestEngine.score([worked], session: jaStation, rule: rule)
                .qsos[0].disposition, .accepted, candidate.0)
        }

        for (offset, candidate) in ["1/MM", "MM/1", "MM/1/MM"].enumerated() {
            let entrant = session(rule: rule, call: candidate, entity: usa,
                                  raw: "05", normalized: "05")
            XCTAssertFalse(rule.validateSession(entrant).isEmpty, candidate)
            let worked = qso(1_020 + offset, rule: rule, station: jaStation,
                             call: candidate, band: "20m", entity: usa,
                             receivedRaw: "05", receivedNormalized: "05")
            XCTAssertEqual(try ContestEngine.score([worked], session: jaStation, rule: rule)
                .qsos[0].disposition, .invalid, candidate)
        }
    }

    func testSpecialJapaneseLocationsRequireCurrentMatchingEntities() throws {
        let rule = JIDXCWRule()
        let station = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let valid = [
            qso(600, rule: rule, station: station, call: "JD1AAA", band: "20m", entity: ogasawara,
                receivedRaw: "48", receivedNormalized: "48"),
            qso(601, rule: rule, station: station, call: "JG8NQJ/JD1", band: "15m", entity: minamitorishima,
                receivedRaw: "49", receivedNormalized: "49"),
            qso(602, rule: rule, station: station, call: "JD1BBB", band: "10m", entity: ogasawara,
                receivedRaw: "50", receivedNormalized: "50"),
        ]
        let validScore = try ContestEngine.score(valid, session: station, rule: rule)
        XCTAssertEqual(validScore.qsos.map(\.disposition), [.accepted, .accepted, .accepted])
        XCTAssertEqual(validScore.totalPoints, 4)
        XCTAssertEqual(validScore.multiplierCount, 3)
        XCTAssertEqual(validScore.claimedScore, 12)

        let deleted = ContestEntitySnapshot(adif: 194, name: "DELETED", countryPrefix: "JD1",
                                            continent: "AS", cqZone: 27)
        let invalid = [
            qso(603, rule: rule, station: station, call: "JA1BAD", band: "20m", entity: japan,
                receivedRaw: "48", receivedNormalized: "48"),
            qso(604, rule: rule, station: station, call: "JD1BAD", band: "20m", entity: ogasawara,
                receivedRaw: "49", receivedNormalized: "49"),
            qso(605, rule: rule, station: station, call: "JD1OLD", band: "20m", entity: deleted,
                receivedRaw: "50", receivedNormalized: "50"),
            qso(606, rule: rule, station: station, call: "JA1ZERO", band: "20m", entity: japan,
                receivedRaw: "00", receivedNormalized: "00"),
            qso(607, rule: rule, station: station, call: "JA1HIGH", band: "20m", entity: japan,
                receivedRaw: "51", receivedNormalized: "51"),
        ]
        XCTAssertTrue(try ContestEngine.score(invalid, session: station, rule: rule)
            .qsos.allSatisfy { $0.disposition == .invalid })
    }

    func testRawAndNormalizedEvidenceRemainDistinctAndAggregatesMustMatch() throws {
        let rule = JIDXCWRule()
        let station = session(rule: rule, call: "JA1ZZZ", entity: japan, raw: "3", normalized: "03")
        XCTAssertEqual(station.station.sentExchangeFields["number"]?.raw, "3")
        XCTAssertEqual(station.station.sentExchange, "03")
        let valid = qso(700, rule: rule, station: station, call: "K1AAA", band: "20m", entity: usa,
                        receivedRaw: "5", receivedNormalized: "05")
        let validScore = try ContestEngine.score([valid], session: station, rule: rule)
        XCTAssertEqual(validScore.qsos[0].disposition, .accepted)
        XCTAssertEqual(valid.exchange.rawSent, "3")
        XCTAssertEqual(valid.exchange.normalizedSent, "03")
        XCTAssertEqual(valid.exchange.rawReceived, "5")
        XCTAssertEqual(valid.exchange.normalizedReceived, "05")

        let rawAggregateMismatch = qso(701, rule: rule, station: station, call: "K1BBB", band: "20m",
                                       entity: usa, receivedRaw: "5", receivedNormalized: "05",
                                       receivedRawAggregate: "05")
        let normalizedAggregateMismatch = qso(702, rule: rule, station: station, call: "K1CCC", band: "20m",
                                              entity: usa, receivedRaw: "5", receivedNormalized: "05",
                                              receivedNormalizedAggregate: "5")
        let lossy = qso(703, rule: rule, station: station, call: "K1DDD", band: "20m", entity: usa,
                        receivedRaw: "5", receivedNormalized: "06")
        XCTAssertTrue(try ContestEngine.score([rawAggregateMismatch, normalizedAggregateMismatch, lossy],
                                              session: station, rule: rule)
            .qsos.allSatisfy { $0.disposition == .invalid })
    }

    func testSelfInvalidCallAndAirMobileFailClosed() throws {
        let rule = JIDXCWRule()
        let station = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let invalid = [
            qso(800, rule: rule, station: station, call: "OM0RX", band: "20m", entity: slovakia,
                receivedRaw: "15", receivedNormalized: "15"),
            qso(801, rule: rule, station: station, call: "BAD", band: "20m", entity: japan,
                receivedRaw: "10", receivedNormalized: "10"),
            qso(802, rule: rule, station: station, call: "JA1AAA/AM", band: "20m", entity: japan,
                receivedRaw: "10", receivedNormalized: "10"),
        ]
        XCTAssertTrue(try ContestEngine.score(invalid, session: station, rule: rule)
            .qsos.allSatisfy { $0.disposition == .invalid })
    }

    func testScoreMultiplicationOverflowFailsClosed() throws {
        let rule = OverflowJIDXRule()
        let station = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let contact = qso(900, rule: rule, station: station, call: "JA1AAA", band: "20m", entity: japan,
                          receivedRaw: "10", receivedNormalized: "10")
        XCTAssertThrowsError(try ContestEngine.score([contact], session: station, rule: rule)) {
            XCTAssertEqual($0 as? ContestEvaluationError, .arithmeticOverflow)
        }
    }

    private func session(rule: any ContestRule, call: String, entity: ContestEntitySnapshot?,
                         raw: String, normalized: String) -> ContestSessionSnapshot {
        ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "jidx-fixture", startedAt: date,
            station: .init(callsign: call, entity: entity, sentExchange: normalized,
                           operatorCallsigns: [call], location: "fixture",
                           sentExchangeFields: ["number": .init(raw: raw, normalized: normalized)]))
    }

    private func qso(_ number: Int, rule: any ContestRule, station: ContestSessionSnapshot,
                     call: String, band: String, entity: ContestEntitySnapshot?,
                     receivedRaw: String, receivedNormalized: String,
                     sentRaw: String? = nil, sentNormalized: String? = nil,
                     receivedRawAggregate: String? = nil,
                     receivedNormalizedAggregate: String? = nil,
                     rstSent: String? = nil, rstReceived: String? = nil) -> ContestQSO {
        let sentField = station.station.sentExchangeFields["number"]!
        let actualSentRaw = sentRaw ?? sentField.raw
        let actualSentNormalized = sentNormalized ?? sentField.normalized
        let mode = rule.metadata.supportedModes.singleValue!
        let report = mode == "SSB" ? "59" : "599"
        return ContestQSO(
            id: UUID(uuidString: String(format: "E4000000-0000-0000-0000-%012d", number))!,
            sessionID: sessionID, timestampUTC: date.addingTimeInterval(Double(number)),
            callsign: call, band: band, mode: mode, frequencyHz: frequency(for: band),
            rstSent: rstSent ?? report, rstReceived: rstReceived ?? report,
            exchange: .init(
                rawSent: actualSentRaw, normalizedSent: actualSentNormalized,
                rawReceived: receivedRawAggregate ?? receivedRaw,
                normalizedReceived: receivedNormalizedAggregate ?? receivedNormalized,
                sentFields: ["number": .init(raw: actualSentRaw, normalized: actualSentNormalized)],
                receivedFields: ["number": .init(raw: receivedRaw,
                                                           normalized: receivedNormalized)]),
            entity: entity, operatorCallsign: station.station.callsign, stationLocation: "fixture",
            provenance: .init(source: .operatorEntry))
    }

    private func frequency(for band: String) -> Int64 {
        ["160m": 1_850_000, "80m": 3_550_000, "40m": 7_025_000, "20m": 14_025_000,
         "15m": 21_025_000, "10m": 28_025_000][band] ?? 14_025_000
    }

    private func entity(adif: Int) -> ContestEntitySnapshot? {
        switch adif {
        case 1: canada
        case 177: minamitorishima
        case 192: ogasawara
        case 230: germany
        case 291: usa
        case 339: japan
        case 504: slovakia
        default: nil
        }
    }

    private func multiplierToken(_ key: ContestMultiplierKey) -> String {
        "\(key.kind):\(key.value):\(key.scope)"
    }

    private func loadFixture() throws -> AuthorityFixture {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/jidx-2026-authority.json")
        return try JSONDecoder().decode(AuthorityFixture.self, from: Data(contentsOf: url))
    }

    private struct AuthorityFixture: Decodable {
        let primaryAuthorities: [PrimaryAuthority]
        let callsignAuthorities: [CallsignAuthority]
        let japaneseLocationMultipliers: [Location]
        let independentOracles: [Oracle]
    }
    private struct PrimaryAuthority: Decodable {
        let name: String
        let cachedPath: String
        let sha256: String
    }
    private struct CallsignAuthority: Decodable {
        let cachedPath: String
        let sha256: String
    }
    private struct Location: Decodable { let number: String; let name: String }
    private struct Oracle: Decodable {
        let name: String
        let station: FixtureStation
        let contacts: [FixtureContact]
        let totalPoints: Int64
        let totalMultipliers: Int64
        let claimedScore: Int64
    }
    private struct FixtureStation: Decodable {
        let callsign: String
        let adif: Int
        let sentExchange: String
    }
    private struct FixtureContact: Decodable {
        let callsign: String
        let band: String
        let adif: Int
        let receivedExchange: String
        let disposition: String
        let points: Int64
        let newMultipliers: [String]
    }

    private struct OverflowJIDXRule: ContestRule {
        let metadata = JIDXCWRule().metadata
        func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
            .init(validation: [], dupeKey: qso.id.uuidString, points: .max,
                  multiplierCandidates: [.init(kind: "a", value: "1", scope: "contest"),
                                         .init(kind: "b", value: "1", scope: "contest")])
        }
        func cabrilloReceivedExchange(for qso: ContestQSO) -> String {
            qso.exchange.normalizedReceived
        }
    }
}

private extension Set where Element == String {
    var singleValue: String? { count == 1 ? first : nil }
}

private extension Array where Element == ContestModeProfile {
    var singleValue: ContestModeProfile? { count == 1 ? first : nil }
}
