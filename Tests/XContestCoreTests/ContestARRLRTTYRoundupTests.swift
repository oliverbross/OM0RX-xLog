import Foundation
import XCTest
@testable import XContestCore

final class ContestARRLRTTYRoundupTests: XCTestCase {
    private let rule = ARRLRTTYRoundupRule()
    private let sessionID = UUID(uuidString: "A1000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "A2000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_200_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let alaska = ContestEntitySnapshot(adif: 6, name: "ALASKA", countryPrefix: "KL7", continent: "NA", cqZone: 1)
    private let hawaii = ContestEntitySnapshot(adif: 110, name: "HAWAII", countryPrefix: "KH6", continent: "OC", cqZone: 31)
    private let england = ContestEntitySnapshot(adif: 223, name: "ENGLAND", countryPrefix: "G", continent: "EU", cqZone: 14)

    func testStationResolvedSerialRequirementUsesFrozenEntityAndExchange() throws {
        let wve = session(entity: usa, call: "K1AAA", location: "CA")
        XCTAssertEqual(try rule.resolvedSerialRequirement(in: wve),
                       .init(requirement: .none, allowedScopes: [], allocatedFieldID: nil))
        let dx = session(entity: england, call: "G3AAA", location: nil)
        XCTAssertEqual(try rule.resolvedSerialRequirement(in: dx),
                       .init(requirement: .requiredForCommit, allowedScopes: [.session],
                             allocatedFieldID: "serial"))
        XCTAssertTrue(rule.validateSession(session(entity: alaska, call: "KL7AAA", location: nil)).isEmpty)
        XCTAssertTrue(rule.validateSession(session(entity: hawaii, call: "KH6AAA", location: nil)).isEmpty)
        let contradictory = session(entity: usa, call: "K1AAA", location: "HI")
        XCTAssertFalse(rule.validateSession(contradictory).isEmpty)
        XCTAssertThrowsError(try rule.resolvedSerialRequirement(in: contradictory))
        XCTAssertTrue(rule.validateSession(session(entity: canada, call: "VO2AAA", location: "LB")).isEmpty)
        XCTAssertTrue(rule.validateSession(session(entity: canada, call: "VO1AAA", location: "NF")).isEmpty)
    }

    func testOfficialArithmeticAndOnceContestMultipliers() throws {
        let session = session(entity: england, call: "G3AAA", location: nil)
        let contacts = [
            qso(1, call: "K1ABC", entity: usa, exchange: "CA", band: "20m"),
            qso(2, call: "VE2ABC", entity: canada, exchange: "QC", band: "20m"),
            qso(3, call: "VO2ABC", entity: canada, exchange: "LB", band: "20m"),
            qso(4, call: "KL7ABC", entity: alaska, exchange: "1", band: "20m"),
            qso(5, call: "KH6ABC", entity: hawaii, exchange: "2", band: "20m"),
            qso(6, call: "F1ABC", entity: ContestEntitySnapshot(adif: 227, name: "FRANCE", countryPrefix: "F", continent: "EU", cqZone: 14), exchange: "3", band: "20m"),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.totalPoints, 6)
        XCTAssertEqual(score.multiplierCount, 6)
        XCTAssertEqual(score.claimedScore, 36)

        let repeated = contacts + [qso(7, call: "K2ABC", entity: usa, exchange: "CA", band: "40m")]
        let repeatedScore = try ContestEngine.score(repeated, session: session, rule: rule)
        XCTAssertEqual(repeatedScore.totalPoints, 7)
        XCTAssertEqual(repeatedScore.multiplierCount, 6)
        XCTAssertEqual(repeatedScore.claimedScore, 42)
    }

    func testModifierDupeNormalizationIsBounded() throws {
        let session = session(entity: england, call: "G3AAA", location: nil)
        let contacts = [
            qso(10, call: "W1AW", entity: usa, exchange: "CT", band: "20m"),
            qso(11, call: "W1AW/7", entity: usa, exchange: "AZ", band: "20m"),
            qso(12, call: "K7/W1AW", entity: usa, exchange: "AZ", band: "20m"),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .duplicate, .accepted])
    }

    func testDXCCAndFailureBoundaries() throws {
        let session = session(entity: england, call: "G3AAA", location: nil)
        let cy0 = ContestEntitySnapshot(adif: 211, name: "SABLE ISLAND", countryPrefix: "CY0", continent: "NA", cqZone: 5)
        let cy9 = ContestEntitySnapshot(adif: 252, name: "ST PAUL ISLAND", countryPrefix: "CY9", continent: "NA", cqZone: 5)
        let deleted = ContestEntitySnapshot(adif: 2, name: "DELETED ENTITY", countryPrefix: "XX", continent: "EU", cqZone: 14)
        let fabricated = ContestEntitySnapshot(adif: 999_999, name: "FRANCE-LIKE", countryPrefix: "F", continent: "EU", cqZone: 14)
        let score = try ContestEngine.score([
            qso(20, call: "CY0AAA", entity: cy0, exchange: "1", band: "20m"),
            qso(21, call: "CY9AAA", entity: cy9, exchange: "2", band: "20m"),
        ], session: session, rule: rule)
        XCTAssertEqual(score.multiplierCount, 2)

        let invalid = [
            qso(22, call: "G3AAA", entity: england, exchange: "3", band: "20m"),
            qso(23, call: "K1ABC/MM", entity: usa, exchange: "CA", band: "20m"),
            qso(24, call: "K1ABC", entity: usa, exchange: "CA", band: "160m"),
            qso(25, call: "K1ABC", entity: usa, exchange: "CA", band: "20m", mode: "FT8"),
            qso(26, call: "XX1ABC", entity: deleted, exchange: "4", band: "20m"),
            qso(27, call: "F9ABC", entity: fabricated, exchange: "5", band: "20m"),
        ]
        let invalidScore = try ContestEngine.score(invalid, session: session, rule: rule)
        XCTAssertTrue(invalidScore.qsos.allSatisfy { $0.disposition == .invalid })

        for invalidOwnEntity in [deleted, fabricated] {
            let invalidSession = self.session(entity: invalidOwnEntity, call: "XX1AAA", location: nil)
            XCTAssertFalse(rule.validateSession(invalidSession).isEmpty)
            XCTAssertThrowsError(try rule.resolvedSerialRequirement(in: invalidSession))
        }
    }

    func testPolicyEncodingIsAdditiveAndMalformedMetadataFailsClosed() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let entry = rule.metadata.entry
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(entry)) as? [String: Any])
        XCTAssertNotNil(object["stationResolvedSerial"])

        let legacy = CQWWCWRule().metadata.entry
        let legacyBytes = try encoder.encode(legacy)
        let legacyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: legacyBytes) as? [String: Any])
        XCTAssertNil(legacyObject["stationResolvedSerial"])
        XCTAssertEqual(try encoder.encode(JSONDecoder().decode(ContestEntryDescriptor.self, from: legacyBytes)),
                       legacyBytes)
        var legacyWithNull = legacyObject
        legacyWithNull["stationResolvedSerial"] = NSNull()
        let badV1 = try JSONSerialization.data(withJSONObject: legacyWithNull, options: [.sortedKeys])
        XCTAssertThrowsError(try JSONDecoder().decode(ContestEntryDescriptor.self, from: badV1))

        var unknown = object
        var policy = try XCTUnwrap(unknown["stationResolvedSerial"] as? [String: Any])
        policy["policy"] = "unknown"
        unknown["stationResolvedSerial"] = policy
        XCTAssertThrowsError(try JSONDecoder().decode(ContestEntryDescriptor.self,
                                                       from: JSONSerialization.data(withJSONObject: unknown)))

        var wrongScope = object
        var wrongScopePolicy = try XCTUnwrap(wrongScope["stationResolvedSerial"] as? [String: Any])
        wrongScopePolicy["allowedScopes"] = ["band"]
        wrongScope["stationResolvedSerial"] = wrongScopePolicy
        XCTAssertThrowsError(try decodeEntry(wrongScope))

        var staticContradiction = object
        var serial = try XCTUnwrap(staticContradiction["serial"] as? [String: Any])
        serial["requirement"] = "requiredForCommit"
        serial["allowedScopes"] = ["session"]
        staticContradiction["serial"] = serial
        XCTAssertThrowsError(try decodeEntry(staticContradiction))

        var duplicateField = object
        var exchange = try XCTUnwrap(duplicateField["exchange"] as? [String: Any])
        var sentFields = try XCTUnwrap(exchange["sentFields"] as? [[String: Any]])
        sentFields.append(try XCTUnwrap(sentFields.first { $0["id"] as? String == "serial" }))
        exchange["sentFields"] = sentFields
        duplicateField["exchange"] = exchange
        XCTAssertThrowsError(try decodeEntry(duplicateField))

        var ambiguousField = object
        var ambiguousExchange = try XCTUnwrap(ambiguousField["exchange"] as? [String: Any])
        var ambiguousSentFields = try XCTUnwrap(ambiguousExchange["sentFields"] as? [[String: Any]])
        let serialIndex = try XCTUnwrap(ambiguousSentFields.firstIndex { $0["id"] as? String == "serial" })
        ambiguousSentFields[serialIndex]["acceptedKinds"] = ["serialNumber", "subdivision"]
        ambiguousExchange["sentFields"] = ambiguousSentFields
        ambiguousField["exchange"] = ambiguousExchange
        XCTAssertThrowsError(try decodeEntry(ambiguousField))
    }

    func testAuthorityFixturePinsPrimaryAndComparatorInputs() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/arrl-rtty-roundup-authority.json")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let primary = try XCTUnwrap(object["primaryAuthorities"] as? [[String: Any]])
        XCTAssertEqual(primary.count, 4)
        XCTAssertEqual(primary.first?["sha256"] as? String,
                       "87c9f0032e6ce502b4ae94d47b397a9a34c49a3eafdb5a50fc226694696fe1ce")
        let comparator = try XCTUnwrap(object["sourceComparator"] as? [String: Any])
        XCTAssertEqual(comparator["revision"] as? String,
                       "7c8b499225a73f7f8f792246881bd7aefc05452f")
        XCTAssertEqual(comparator["fileSha256"] as? String,
                       "51ec034028d5afa0d2788acb4e718d9699a198b2392dde2dbe78a0abfad31df6")
        let entityAuthority = try XCTUnwrap(object["currentDXCCEntityAuthority"] as? [String: Any])
        let codes = try XCTUnwrap(entityAuthority["adifCodes"] as? [Int])
        XCTAssertEqual(entityAuthority["declaredCount"] as? Int, 340)
        XCTAssertEqual(codes.count, 340)
        XCTAssertEqual(Set(codes).count, 340)
        XCTAssertEqual(Set(codes), arrlRTTYCurrentDXCCEntityCodes)
        XCTAssertFalse(codes.contains(2))
        XCTAssertFalse(codes.contains(999_999))
    }

    private func decodeEntry(_ object: [String: Any]) throws -> ContestEntryDescriptor {
        try JSONDecoder().decode(ContestEntryDescriptor.self,
                                 from: JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
    }

    private func session(entity: ContestEntitySnapshot, call: String,
                         location: String?) -> ContestSessionSnapshot {
        let fields = location.map { ["location": ContestExchangeFieldValue(raw: $0, normalized: $0)] } ?? [:]
        return ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: ARRLRTTYRoundupRule.identity,
            referenceDataVersion: "cty-arrl-fixture", startedAt: date,
            station: .init(callsign: call, entity: entity, sentExchange: location ?? "",
                           operatorCallsigns: [call], location: "fixture", sentExchangeFields: fields))
    }

    private func qso(_ number: Int, call: String, entity: ContestEntitySnapshot, exchange: String,
                     band: String, mode: String = "RTTY") -> ContestQSO {
        let sent = "001"
        return ContestQSO(
            id: UUID(uuidString: String(format: "A4000000-0000-0000-0000-%012d", number))!, sessionID: sessionID,
            timestampUTC: date.addingTimeInterval(Double(number)), callsign: call, band: band, mode: mode,
            frequencyHz: frequency(for: band), rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: exchange,
                            normalizedReceived: exchange,
                            sentFields: ["serial": .init(raw: sent, normalized: sent)],
                            receivedFields: ["exchange": .init(raw: exchange, normalized: exchange)]),
            entity: entity, operatorCallsign: "G3AAA", stationLocation: "fixture",
            provenance: .init(source: .operatorEntry))
    }

    private func frequency(for band: String) -> Int64 {
        ["160m": 1_850_000, "80m": 3_580_000, "40m": 7_080_000, "20m": 14_080_000,
         "15m": 21_080_000, "10m": 28_080_000][band] ?? 14_080_000
    }
}
