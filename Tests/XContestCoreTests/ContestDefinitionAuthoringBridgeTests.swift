import Foundation
import XCTest
@testable import XContestCore

final class ContestDefinitionAuthoringBridgeTests: XCTestCase {
    private struct AuthoredGoldens: Decodable {
        struct Scenario: Decodable {
            struct QSO: Decodable {
                struct Entity: Decodable {
                    let adif: Int
                    let name: String
                    let countryPrefix: String
                    let continent: String
                    let cqZone: Int
                }
                let callsign: String
                let band: String
                let mode: String
                let frequencyHz: Int64
                let sentFields: [String: String]
                let receivedFields: [String: String]
                let entity: Entity?
            }
            struct Expected: Decodable {
                let dispositions: [String]
                let points: [Int64]
                let totalPoints: Int64
                let multiplierCount: Int64
                let claimedScore: Int64
            }
            let id: String
            let referenceDataVersion: String?
            let qsos: [QSO]
            let expected: Expected
        }
        let goldenScenarios: [Scenario]
    }

    private let sessionID = UUID(uuidString: "EC000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "EC000000-0000-0000-0000-000000000002")!
    private let date = Date(timeIntervalSince1970: 1_900_400_000)

    func testExistingTenTenAuthoringDraftPreservesRuntimeIdentityDigestAndGoldenEvaluation() throws {
        let draft = try runtimeDraft("ten-ten-winter-phone.runtime-draft.json")
        let existing = TenTenDeclarativeDefinitions.draft(for: .winterPhone)
        XCTAssertEqual(draft, existing)
        XCTAssertEqual(try draft.materialized().definitionDigest, try existing.materialized().definitionDigest)
        try assertGoldens(authoring: "ten-ten-winter-phone.authoring-v2.json", draft: draft)
    }

    func testSyntheticAuthoringDraftDecodesMaterializesAndEvaluatesWithoutAContestClass() throws {
        let draft = try runtimeDraft("custom-two-band-sprint.runtime-draft.json")
        XCTAssertEqual(draft.id, "custom-two-band-sprint")
        XCTAssertEqual(draft.dupePolicy, .perBand)
        XCTAssertEqual(draft.multiplierPolicy, .uniqueCallsign)
        try assertGoldens(authoring: "custom-two-band-sprint.authoring-v2.json", draft: draft)
    }

    func testAuthoredGeographicDraftMaterializesAndScoresOfficialSampleTwelveByTen() throws {
        let draft = try runtimeDraft("sst-geographic-sample.runtime-draft.json")
        XCTAssertEqual(draft.multiplierPolicy, .geographic)
        XCTAssertEqual(draft.geographicMultiplier?.locationFieldID, "location")
        try assertGoldens(authoring: "sst-geographic-sample.authoring-v2.json", draft: draft)
    }

    private func assertGoldens(authoring: String, draft: ContestDefinitionDraft) throws {
        let definition = try draft.materialized()
        let rule = DeclarativeContestRule(definition: definition)
        let authored = try JSONDecoder().decode(AuthoredGoldens.self, from: fixtureData(authoring))
        XCTAssertFalse(authored.goldenScenarios.isEmpty)
        for scenario in authored.goldenScenarios {
            guard let first = scenario.qsos.first else { return XCTFail("empty golden scenario") }
            let stationFields = values(first.sentFields)
            let stationExchange = aggregate(first.sentFields, descriptors: draft.entry.exchange.sentFields)
            let session = ContestSessionSnapshot(
                id: sessionID, workspaceGeneration: generation, rule: definition.identity,
                referenceDataVersion: scenario.referenceDataVersion ?? "authoring-bridge-fixture", startedAt: date,
                station: .init(callsign: "OM0RX", entity: nil, sentExchange: stationExchange,
                               operatorCallsigns: ["OM0RX"], location: "",
                               sentExchangeFields: stationFields))
            let qsos = try scenario.qsos.enumerated().map { index, golden in
                let profile = try XCTUnwrap(draft.entry.modeProfile(for: golden.mode))
                let sent = values(golden.sentFields), received = values(golden.receivedFields)
                return ContestQSO(
                    id: UUID(uuidString: String(format: "ED000000-0000-0000-0000-%012d", index + 1))!,
                    sessionID: sessionID, timestampUTC: date.addingTimeInterval(TimeInterval(index)),
                    callsign: golden.callsign, band: golden.band, mode: golden.mode,
                    frequencyHz: golden.frequencyHz, rstSent: profile.report.defaultSent,
                    rstReceived: profile.report.defaultReceived,
                    exchange: .init(rawSent: aggregate(golden.sentFields, descriptors: draft.entry.exchange.sentFields),
                                    normalizedSent: aggregate(golden.sentFields, descriptors: draft.entry.exchange.sentFields),
                                    rawReceived: aggregate(golden.receivedFields, descriptors: draft.entry.exchange.receivedFields),
                                    normalizedReceived: aggregate(golden.receivedFields, descriptors: draft.entry.exchange.receivedFields),
                                    sentFields: sent, receivedFields: received),
                    entity: golden.entity.map {
                        .init(adif: $0.adif, name: $0.name, countryPrefix: $0.countryPrefix,
                              continent: $0.continent, cqZone: $0.cqZone)
                    }, operatorCallsign: "OM0RX", stationLocation: "",
                    provenance: .init(source: .operatorEntry))
            }
            let score = try ContestEngine.score(qsos, session: session, rule: rule)
            XCTAssertEqual(score.qsos.map { $0.disposition.rawValue }, scenario.expected.dispositions, scenario.id)
            XCTAssertEqual(score.qsos.map(\.points), scenario.expected.points, scenario.id)
            XCTAssertEqual(score.totalPoints, scenario.expected.totalPoints, scenario.id)
            XCTAssertEqual(score.multiplierCount, scenario.expected.multiplierCount, scenario.id)
            XCTAssertEqual(score.claimedScore, scenario.expected.claimedScore, scenario.id)
        }
    }

    private func runtimeDraft(_ name: String) throws -> ContestDefinitionDraft {
        try JSONDecoder().decode(ContestDefinitionDraft.self, from: fixtureData(name))
    }

    private func fixtureData(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures").appendingPathComponent(name)
        return try Data(contentsOf: url)
    }

    private func values(_ source: [String: String]) -> [String: ContestExchangeFieldValue] {
        source.mapValues { .init(raw: $0, normalized: $0) }
    }

    private func aggregate(_ values: [String: String],
                           descriptors: [ContestExchangeFieldDescriptor]) -> String {
        descriptors.compactMap { values[$0.id] }.joined(separator: " ")
    }
}
