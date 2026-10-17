import Foundation
import XCTest
@testable import XContestCore

final class ContestDeclarativeRuleTests: XCTestCase {
    private let sessionID = UUID(uuidString: "EA000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "EA000000-0000-0000-0000-000000000002")!
    private let date = Date(timeIntervalSince1970: 1_900_300_000)

    func testAuthorityFixturePinsFourComparatorPluginsAndThreePureCases() throws {
        struct Fixture: Decodable {
            struct Comparator: Decodable {
                struct Case: Decodable { let memberNumber: String; let duplicate: Bool; let expectedPoints: Int64 }
                let repositoryRevision: String
                let plugins: [String: String]
                let sourceInspectedCases: [Case]
            }
            let officialSources: [[String: StringOrInt]]
            let pythonComparator: Comparator
        }
        enum StringOrInt: Decodable {
            case string(String), int(Int)
            init(from decoder: Decoder) throws {
                let value = try decoder.singleValueContainer()
                if let string = try? value.decode(String.self) { self = .string(string) }
                else { self = .int(try value.decode(Int.self)) }
            }
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/ten-ten-declarative-authority.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        XCTAssertEqual(fixture.pythonComparator.repositoryRevision,
                       "7c8b499225a73f7f8f792246881bd7aefc05452f")
        XCTAssertEqual(Set(fixture.pythonComparator.plugins.keys), Set(TenTenSeasonalVariant.allCases.map(\.rawValue)))
        XCTAssertEqual(fixture.pythonComparator.sourceInspectedCases.map(\.expectedPoints), [2, 1, 0])
        XCTAssertEqual(fixture.pythonComparator.sourceInspectedCases.map(\.memberNumber), ["12345", "0", "12345"])
        XCTAssertEqual(fixture.pythonComparator.sourceInspectedCases.map(\.duplicate), [false, false, true])
        XCTAssertEqual(fixture.officialSources.count, 4)
    }

    func testFourDefinitionsRunOneSharedPolicyWithFixedPythonCompatibleCases() throws {
        for (index, variant) in TenTenSeasonalVariant.allCases.enumerated() {
            let rule = try TenTenDeclarativeDefinitions.rule(for: variant)
            let mode = rule.metadata.supportedModes.contains("CW") ? "CW" : "SSB"
            let session = session(rule)
            let qsos = [
                qso(index * 10 + 1, call: "K1ABC", member: "12345", mode: mode),
                qso(index * 10 + 2, call: "W1XYZ", member: "0", mode: mode, seconds: 1),
                qso(index * 10 + 3, call: "K1ABC", member: "999", mode: mode, seconds: 2),
            ]
            let score = try ContestEngine.score(qsos, session: session, rule: rule)
            XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .duplicate], variant.rawValue)
            XCTAssertEqual(score.qsos.map(\.points), [2, 1, 0], variant.rawValue)
            XCTAssertEqual(score.totalPoints, 3, variant.rawValue)
            XCTAssertEqual(score.multiplierCount, 0, variant.rawValue)
            XCTAssertEqual(score.claimedScore, 3, variant.rawValue)
        }
    }

    func testPhoneDefinitionsRetainOfficialAMAndFMScope() throws {
        for variant in [TenTenSeasonalVariant.winterPhone, .summerPhone] {
            let rule = try TenTenDeclarativeDefinitions.rule(for: variant)
            for (offset, mode) in ["SSB", "AM", "FM"].enumerated() {
                let result = try ContestEngine.score([qso(100 + offset, call: "N1\(offset)AA", member: "0", mode: mode)],
                                                     session: session(rule), rule: rule)
                XCTAssertEqual(result.claimedScore, 1)
            }
        }
    }

    func testMultiwordDXQTHPreservesStructuredAggregate() throws {
        let rule = try TenTenDeclarativeDefinitions.rule(for: .springCW)
        let score = try ContestEngine.score([qso(140, call: "ZL1AAA", member: "0", mode: "CW", qth: "NEW ZEALAND")],
                                            session: session(rule), rule: rule)
        XCTAssertEqual(score.qsos.first?.disposition, .accepted)
        XCTAssertEqual(score.claimedScore, 1)
    }

    func testFiniteDupePoliciesAndCrossModeOncePerContest() throws {
        let base = TenTenDeclarativeDefinitions.draft(for: .winterPhone)
        let cases: [(ContestDeclarativeDupePolicy, ContestQSO, ContestQSODisposition)] = [
            (.oncePerContest, qso(201, call: "K1ABC", member: "1", mode: "AM"), .duplicate),
            (.perBandMode, qso(202, call: "K1ABC", member: "1", mode: "AM"), .accepted),
            (.none, qso(203, call: "K1ABC", member: "1", mode: "SSB"), .accepted),
        ]
        for (index, item) in cases.enumerated() {
            let rule = try DeclarativeContestRule(definition: copy(base, id: "authored-dupe-\(index)", dupe: item.0).materialized())
            let first = qso(190 + index, call: "K1ABC", member: "1", mode: "SSB")
            let score = try ContestEngine.score([first, item.1], session: session(rule), rule: rule)
            XCTAssertEqual(score.qsos.last?.disposition, item.2)
        }

        let perBandBase = copy(base, id: "authored-per-band", dupe: .perBand, bands: ["10m", "20m"])
        let perBand = try DeclarativeContestRule(definition: perBandBase.materialized())
        let score = try ContestEngine.score([
            qso(210, call: "K1ABC", member: "1", mode: "SSB"),
            qso(211, call: "K1ABC", member: "1", mode: "SSB", band: "20m", frequency: 14_250_000),
        ], session: session(perBand), rule: perBand)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted])
    }

    func testOrderedThresholdFallbackInvalidNumericAndPositiveAuthoredRun() throws {
        let base = TenTenDeclarativeDefinitions.draft(for: .summerPhone)
        let scoring = ContestDeclarativeScoringPolicy(defaultPoints: 1, clauses: [
            .init(fieldID: "member-number", comparison: .greaterThan, threshold: 100, points: 5),
            .init(fieldID: "member-number", comparison: .greaterThan, threshold: 0, points: 2),
        ])
        let authored = copy(base, id: "operator-authored-no-python", dupe: .none, scoring: scoring,
                            provenance: "operator-authored test definition; no Python source")
        let rule = try DeclarativeContestRule(definition: authored.materialized())
        let score = try ContestEngine.score([
            qso(220, call: "K1AAA", member: "150", mode: "SSB"),
            qso(221, call: "K1AAB", member: "1", mode: "SSB"),
            qso(222, call: "K1AAC", member: "0", mode: "SSB"),
            qso(223, call: "K1AAD", member: "ABC", mode: "SSB"),
            qso(224, call: "K1AAE", member: "00150", mode: "SSB"),
            qso(225, call: "K1AAF", member: "00000", mode: "SSB"),
        ], session: session(rule), rule: rule)
        XCTAssertEqual(score.qsos.map(\.points), [5, 2, 1, 0, 5, 1])
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .accepted, .invalid, .accepted, .accepted])
        XCTAssertEqual(score.claimedScore, 14)
    }

    func testNonmemberEntrantCanLogAndScorePendingSubmissionEligibilityGate() throws {
        let rule = try TenTenDeclarativeDefinitions.rule(for: .summerPhone)
        let result = try ContestEngine.score([qso(150, call: "K1ABC", member: "0", mode: "SSB", sentMember: "0")],
                                             session: session(rule, stationMember: "0"), rule: rule)
        XCTAssertEqual(result.qsos.first?.disposition, .accepted)
        XCTAssertEqual(result.claimedScore, 1)
    }

    func testCanonicalDigestRoundTripRejectsTampering() throws {
        let definition = try TenTenDeclarativeDefinitions.definition(for: .winterPhone)
        let bytes = try definition.canonicalStorageData()
        XCTAssertEqual(try JSONDecoder().decode(ContestDeclarativeDefinition.self, from: bytes), definition)
        let tampered = Data(String(decoding: bytes, as: UTF8.self)
            .replacingOccurrences(of: "10-10 Winter Phone", with: "Altered Winter Phone").utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDeclarativeDefinition.self, from: tampered)) {
            XCTAssertEqual($0 as? ContestDefinitionError, .digestMismatch)
        }
        XCTAssertEqual(try TenTenDeclarativeDefinitions.definition(for: .winterPhone).definitionDigest,
                       definition.definitionDigest)
    }

    func testAuthoredDraftRejectsUnknownPolicyAdapterAndIncoherentEntry() throws {
        let draft = TenTenDeclarativeDefinitions.draft(for: .springCW)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let unknown = Data(String(decoding: try encoder.encode(draft), as: UTF8.self)
            .replacingOccurrences(of: "oncePerContest", with: "futurePolicy").utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDefinitionDraft.self, from: unknown))
        let typo = Data(String(decoding: try encoder.encode(draft), as: UTF8.self)
            .replacingOccurrences(of: "\"multiplierPolicy\":",
                                  with: "\"multiplierPolciy\":\"none\",\"multiplierPolicy\":").utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDefinitionDraft.self, from: typo))

        let adapted = ContestDefinitionDraft(
            id: draft.id, version: draft.version, edition: draft.edition, displayName: draft.displayName,
            cabrilloName: draft.cabrilloName, supportedBands: draft.supportedBands,
            supportedModes: draft.supportedModes, entry: draft.entry,
            sourceProvenance: "operator-authored fixture independent of Python",
            dupePolicy: draft.dupePolicy, multiplierPolicy: draft.multiplierPolicy,
            scoring: draft.scoring, eligibilityPolicy: draft.eligibilityPolicy,
            exportPolicy: draft.exportPolicy, stationEntityRequired: draft.stationEntityRequired,
            adapterID: "unreviewed-code")
        XCTAssertThrowsError(try adapted.materialized())

        let wrongModes = ContestDefinitionDraft(
            id: draft.id, version: draft.version, edition: draft.edition, displayName: draft.displayName,
            cabrilloName: draft.cabrilloName, supportedBands: draft.supportedBands,
            supportedModes: ["SSB"], entry: draft.entry, sourceProvenance: draft.sourceProvenance,
            dupePolicy: draft.dupePolicy, multiplierPolicy: draft.multiplierPolicy,
            scoring: draft.scoring, eligibilityPolicy: draft.eligibilityPolicy,
            exportPolicy: draft.exportPolicy, stationEntityRequired: false)
        XCTAssertThrowsError(try wrongModes.materialized())
    }

    private func session(_ rule: DeclarativeContestRule, stationMember: String = "12345") -> ContestSessionSnapshot {
        .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
              referenceDataVersion: "ten-ten-fixture", startedAt: date,
              station: .init(callsign: "OM0RX", entity: nil, sentExchange: "OLIVER \(stationMember) AUSTRALIA",
                             operatorCallsigns: ["OM0RX"], location: "",
                             sentExchangeFields: fields(name: "OLIVER", member: stationMember, qth: "AUSTRALIA")))
    }

    private func qso(_ seed: Int, call: String, member: String, mode: String, seconds: TimeInterval = 0,
                     qth: String = "USA", band: String = "10m", frequency: Int64? = nil,
                     sentMember: String = "12345") -> ContestQSO {
        let report = mode == "CW" ? "599" : "59"
        return .init(id: UUID(uuidString: String(format: "EB000000-0000-0000-0000-%012d", seed + 1))!,
                     sessionID: sessionID, timestampUTC: date.addingTimeInterval(seconds), callsign: call,
                     band: band, mode: mode, frequencyHz: frequency ?? (mode == "CW" ? 28_050_000 : 28_500_000),
                     rstSent: report, rstReceived: report,
                     exchange: .init(rawSent: "OLIVER \(sentMember) AUSTRALIA",
                                     normalizedSent: "OLIVER \(sentMember) AUSTRALIA",
                                     rawReceived: "AL \(member) \(qth)", normalizedReceived: "AL \(member) \(qth)",
                                     sentFields: fields(name: "OLIVER", member: sentMember, qth: "AUSTRALIA"),
                                     receivedFields: fields(name: "AL", member: member, qth: qth)),
                     entity: nil, operatorCallsign: "OM0RX", stationLocation: "",
                     provenance: .init(source: .operatorEntry))
    }

    private func fields(name: String, member: String, qth: String) -> [String: ContestExchangeFieldValue] {
        ["name": .init(raw: name, normalized: name),
         "member-number": .init(raw: member, normalized: member),
         "qth": .init(raw: qth, normalized: qth)]
    }

    private func copy(_ base: ContestDefinitionDraft, id: String,
                      dupe: ContestDeclarativeDupePolicy,
                      bands: Set<String>? = nil,
                      scoring: ContestDeclarativeScoringPolicy? = nil,
                      provenance: String? = nil) -> ContestDefinitionDraft {
        .init(id: id, version: base.version, edition: base.edition, displayName: id,
              cabrilloName: base.cabrilloName, supportedBands: bands ?? base.supportedBands,
              supportedModes: base.supportedModes, entry: base.entry,
              sourceProvenance: provenance ?? base.sourceProvenance, dupePolicy: dupe,
              multiplierPolicy: base.multiplierPolicy, scoring: scoring ?? base.scoring,
              eligibilityPolicy: base.eligibilityPolicy, exportPolicy: base.exportPolicy,
              stationEntityRequired: base.stationEntityRequired)
    }
}
