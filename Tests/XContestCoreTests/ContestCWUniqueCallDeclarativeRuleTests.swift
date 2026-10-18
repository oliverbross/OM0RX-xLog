import Foundation
import XCTest
@testable import XContestCore

final class ContestCWUniqueCallDeclarativeRuleTests: XCTestCase {
    private let generation = UUID(uuidString: "EC000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_500_000)

    func testThreeDefinitionsUseOneBoundedMultiplierAndExistingSerialContract() throws {
        for variant in CWUniqueCallContestVariant.allCases {
            let definition = try CWUniqueCallDeclarativeDefinitions.definition(for: variant)
            let entry = definition.draft.entry
            XCTAssertEqual(definition.draft.dupePolicy, .perBand, variant.rawValue)
            XCTAssertEqual(definition.draft.multiplierPolicy, .uniqueCallsign, variant.rawValue)
            XCTAssertEqual(entry.scorePolicy, .pointsTimesMultipliers, variant.rawValue)
            XCTAssertEqual(definition.draft.exportPolicy, .unsupported, variant.rawValue)
            XCTAssertEqual(entry.modeProfiles.first?.report.format, ContestReportFormat.none, variant.rawValue)
            XCTAssertEqual(entry.modeProfiles.first?.report.defaultSent, "", variant.rawValue)
            XCTAssertEqual(entry.modeProfiles.first?.report.defaultReceived, "", variant.rawValue)
            XCTAssertEqual(entry.modeProfiles.first?.report.maximumUTF8Bytes, 0, variant.rawValue)
            if variant == .cwt {
                XCTAssertEqual(entry.serial.requirement, .none)
                XCTAssertNil(entry.allocatedSerialField)
            } else {
                XCTAssertEqual(entry.serial.requirement, .requiredForCommit)
                XCTAssertEqual(entry.serial.allowedScopes, [.session])
                XCTAssertEqual(entry.allocatedSerialField?.id, "serial")
            }
        }
    }

    func testOfficialScoringGoldensAcrossCohort() throws {
        for (offset, variant) in CWUniqueCallContestVariant.allCases.enumerated() {
            let rule = try CWUniqueCallDeclarativeDefinitions.rule(for: variant)
            let session = session(variant, rule: rule, offset: offset)
            let qsos = [
                qso(variant, session: session, seed: offset * 10 + 1, call: "K1ABC", band: "20m"),
                qso(variant, session: session, seed: offset * 10 + 2, call: "K1ABC", band: "40m", seconds: 1),
                qso(variant, session: session, seed: offset * 10 + 3, call: "K1ABC", band: "20m", seconds: 2),
                qso(variant, session: session, seed: offset * 10 + 4, call: "W1XYZ", band: "20m", seconds: 3),
            ]
            let score = try ContestEngine.score(qsos, session: session, rule: rule)
            XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .duplicate, .accepted],
                           "\(variant.rawValue): \(score.qsos.map(\.issues))")
            XCTAssertEqual(score.qsos.map(\.points), [1, 1, 0, 1], variant.rawValue)
            XCTAssertEqual(score.qsos.map { $0.newMultipliers.count }, [1, 0, 0, 1], variant.rawValue)
            XCTAssertEqual(score.totalPoints, 3, variant.rawValue)
            XCTAssertEqual(score.multiplierCount, 2, variant.rawValue)
            XCTAssertEqual(score.claimedScore, 6, variant.rawValue)
        }
    }

    func testCWOpenUsesTypedSerialAndNameInsteadOfPythonListIsAlphaBranch() throws {
        let variant = CWUniqueCallContestVariant.cwOpen
        let rule = try CWUniqueCallDeclarativeDefinitions.rule(for: variant)
        let session = session(variant, rule: rule, offset: 8)
        let valid = qso(variant, session: session, seed: 80, call: "K1ABC", band: "20m")
        XCTAssertEqual(valid.exchange.normalizedReceived, "101 AL")
        XCTAssertEqual(try ContestEngine.score([valid], session: session, rule: rule).claimedScore, 1)

        let invalidFields = [
            "serial": ContestExchangeFieldValue(raw: "AL", normalized: "AL"),
            "name": ContestExchangeFieldValue(raw: "101", normalized: "101"),
        ]
        let invalid = replacingReceived(valid, aggregate: "AL 101", fields: invalidFields)
        let invalidScore = try ContestEngine.score([invalid], session: session, rule: rule)
        XCTAssertEqual(invalidScore.qsos.first?.disposition, .invalid)
        XCTAssertEqual(invalidScore.multiplierCount, 0)
        XCTAssertEqual(invalidScore.claimedScore, 0)
    }

    func testCWTAllowsMultiwordDXLocationAsOneTypedField() throws {
        let rule = try CWUniqueCallDeclarativeDefinitions.rule(for: .cwt)
        let session = session(.cwt, rule: rule, offset: 9)
        let base = qso(.cwt, session: session, seed: 90, call: "ZL1ABC", band: "20m")
        let received = ["name": field("AL"), "member-or-location": field("NEW ZEALAND")]
        let contact = replacingReceived(base, aggregate: "AL NEW ZEALAND", fields: received)
        let score = try ContestEngine.score([contact], session: session, rule: rule)
        XCTAssertEqual(score.qsos.first?.disposition, .accepted)
        XCTAssertEqual(score.claimedScore, 1)
    }

    func testNamesOnlyExchangesRequireEmptyReports() throws {
        for (offset, variant) in CWUniqueCallContestVariant.allCases.enumerated() {
            let rule = try CWUniqueCallDeclarativeDefinitions.rule(for: variant)
            let session = session(variant, rule: rule, offset: 20 + offset)
            let valid = qso(variant, session: session, seed: 200 + offset, call: "K1ABC", band: "20m")
            XCTAssertEqual(try ContestEngine.score([valid], session: session, rule: rule).claimedScore, 1)

            let fabricated = replacingReports(valid, sent: "599", received: "599")
            let score = try ContestEngine.score([fabricated], session: session, rule: rule)
            XCTAssertEqual(score.qsos.first?.disposition, .invalid)
            XCTAssertEqual(score.claimedScore, 0)
            XCTAssertTrue(score.qsos.first?.issues.contains { $0.code == "invalidEntryReport" } == true)
        }
    }

    func testTenTenCanonicalDigestsRemainStableWhenMultiplierVocabularyExpands() throws {
        let digests = try Dictionary(uniqueKeysWithValues: TenTenSeasonalVariant.allCases.map {
            ($0.rawValue, try TenTenDeclarativeDefinitions.definition(for: $0).definitionDigest)
        })
        XCTAssertEqual(digests, [
            "winterPhone": "0d05cff62ae87dca57224fbdc49222e346e5008235a37b493c80a04e6959ebd7",
            "springCW": "817a1e0374d6d5f80721b7b10ab3d7f28d69cb2e5e4dd5d9c12de0c0f0add873",
            "summerPhone": "c83471f749359bad3d8ffffd1f54d5ec68f10358ee5d40c2a06b167da46b6778",
            "fallCW": "9bcdf0c2d6709a69689cca1cbb40aa76fb577da91c7437c00d52f04ebc75b838",
        ])
    }

    private func session(_ variant: CWUniqueCallContestVariant, rule: DeclarativeContestRule,
                         offset: Int) -> ContestSessionSnapshot {
        let id = UUID(uuidString: String(format: "EC000000-0000-0000-0001-%012d", offset + 1))!
        let fields: [String: ContestExchangeFieldValue]
        let aggregate: String
        if variant == .cwt {
            fields = ["name": field("OLIVER"), "member-or-location": field("1234")]
            aggregate = "OLIVER 1234"
        } else {
            fields = ["name": field("OLIVER")]
            aggregate = "OLIVER"
        }
        return .init(id: id, workspaceGeneration: generation, rule: rule.metadata.identity,
                     referenceDataVersion: "cw-unique-call-fixture", startedAt: date,
                     station: .init(callsign: "OM0RX", entity: nil, sentExchange: aggregate,
                                    operatorCallsigns: ["OM0RX"], location: "",
                                    sentExchangeFields: fields))
    }

    private func qso(_ variant: CWUniqueCallContestVariant, session: ContestSessionSnapshot,
                     seed: Int, call: String, band: String, seconds: TimeInterval = 0) -> ContestQSO {
        let sentFields: [String: ContestExchangeFieldValue]
        let receivedFields: [String: ContestExchangeFieldValue]
        let sent: String
        let received: String
        switch variant {
        case .cwt:
            sentFields = ["name": field("OLIVER"), "member-or-location": field("1234")]
            receivedFields = ["name": field("AL"), "member-or-location": field("5678")]
            sent = "OLIVER 1234"
            received = "AL 5678"
        case .cwOpen:
            sentFields = ["serial": field("001"), "name": field("OLIVER")]
            receivedFields = ["serial": field("101"), "name": field("AL")]
            sent = "001 OLIVER"
            received = "101 AL"
        case .icwcMST:
            sentFields = ["name": field("OLIVER"), "serial": field("001")]
            receivedFields = ["name": field("AL"), "serial": field("101")]
            sent = "OLIVER 001"
            received = "AL 101"
        }
        return ContestQSO(
            id: UUID(uuidString: String(format: "ED000000-0000-0000-0001-%012d", seed + 1))!,
            sessionID: session.id, timestampUTC: date.addingTimeInterval(seconds), callsign: call,
            band: band, mode: "CW", frequencyHz: frequency(for: band), rstSent: "", rstReceived: "",
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received,
                            normalizedReceived: received, sentFields: sentFields, receivedFields: receivedFields),
            entity: nil, operatorCallsign: "OM0RX", stationLocation: "",
            provenance: .init(source: .operatorEntry))
    }

    private func replacingReceived(_ qso: ContestQSO, aggregate: String,
                                   fields: [String: ContestExchangeFieldValue]) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                              rawReceived: aggregate, normalizedReceived: aggregate,
                              sentFields: qso.exchange.sentFields, receivedFields: fields),
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func replacingReports(_ qso: ContestQSO, sent: String, received: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: sent, rstReceived: received, exchange: qso.exchange,
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func field(_ value: String) -> ContestExchangeFieldValue { .init(raw: value, normalized: value) }

    private func frequency(for band: String) -> Int64 {
        switch band {
        case "160m": return 1_820_000
        case "80m": return 3_530_000
        case "40m": return 7_030_000
        case "20m": return 14_030_000
        case "15m": return 21_030_000
        default: return 28_030_000
        }
    }
}
