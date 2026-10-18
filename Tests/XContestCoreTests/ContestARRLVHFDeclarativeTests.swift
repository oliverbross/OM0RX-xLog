import Foundation
import XCTest
@testable import XContestCore

final class ContestARRLVHFDeclarativeTests: XCTestCase {
    private let timestamp = Date(timeIntervalSince1970: 1_900_500_000)
    private let bands = ["6m", "2m", "1.25m", "70cm", "33cm", "23cm", "13cm"]

    func testPinnedSourceManifestAndInactiveDefinitionCoordinates() throws {
        let fixture = try fixturePlugins()
        XCTAssertEqual(Set(fixture.keys), Set(ARRLVHFSeason.allCases.map(\.rawValue)))
        for season in ARRLVHFSeason.allCases {
            let row = try XCTUnwrap(fixture[season.rawValue])
            let draft = ARRLVHFDeclarativeDefinitions.draft(for: season)
            XCTAssertEqual(row.sha256, ARRLVHFDeclarativeDefinitions.sourceSHA256(for: season))
            XCTAssertEqual(row.bandPoints, ARRLVHFDeclarativeDefinitions.points(for: season))
            XCTAssertEqual(draft.id, "arrl-vhf-\(season.rawValue)")
            XCTAssertEqual(draft.version, "1.0.0-source-preview")
            XCTAssertEqual(draft.edition, "contest-sw-26.10.11")
            XCTAssertEqual(draft.cabrilloName, "ARRL-VHF")
            XCTAssertEqual(draft.supportedBands, Set(bands))
            XCTAssertEqual(draft.supportedModes, ["CW", "SSB"])
            XCTAssertNil(draft.operatorPolicy)
            XCTAssertTrue(draft.sourceProvenance.contains(row.path))
            XCTAssertTrue(draft.sourceProvenance.contains(row.sha256))
        }
    }

    func testIndependentAllBandPointAndGridOraclesForEverySeason() throws {
        let fixture = try fixturePlugins()
        for season in ARRLVHFSeason.allCases {
            let rule = try ARRLVHFDeclarativeDefinitions.rule(for: season)
            let session = makeSession(rule)
            let contacts = bands.enumerated().map { index, band in
                qso(index + 1, session, call: "K1AAA", band: band,
                    grid: String(format: "FN%02d", 20 + index))
            }
            let score = try ContestEngine.score(contacts, session: session, rule: rule)
            let row = try XCTUnwrap(fixture[season.rawValue])
            XCTAssertEqual(score.qsos.map(\.points), bands.map { row.bandPoints[$0]! }, season.rawValue)
            XCTAssertEqual(score.totalPoints, row.allBandPoints, season.rawValue)
            XCTAssertEqual(score.multiplierCount, row.allBandMultiplierCount, season.rawValue)
            XCTAssertEqual(score.claimedScore, row.allBandScore, season.rawValue)
        }
    }

    func testPerBandDuplicateCorrectionDeletionAndCanonicalReopen() throws {
        let original = try ARRLVHFDeclarativeDefinitions.rule(for: .january)
        let encoded = try JSONEncoder().encode(original.definition)
        let reopened = DeclarativeContestRule(definition: try JSONDecoder().decode(
            ContestDeclarativeDefinition.self, from: encoded))
        XCTAssertEqual(original.metadata.identity, reopened.metadata.identity)
        let session = makeSession(reopened)
        let first = qso(1, session, call: "K1AAA", band: "6m", grid: "FN31")
        let duplicate = qso(2, session, call: "K1AAA", band: "6m", grid: "FN31")
        let crossBand = qso(3, session, call: "K1AAA", band: "2m", grid: "FN31")
        let other = qso(4, session, call: "K2BBB", band: "6m", grid: "FN32")

        let initial = try ContestEngine.score([first, duplicate, crossBand, other], session: session, rule: reopened)
        XCTAssertEqual(initial.qsos.map(\.disposition), [.accepted, .duplicate, .accepted, .accepted])
        XCTAssertEqual(initial.totalPoints, 3)
        XCTAssertEqual(initial.multiplierCount, 3)
        XCTAssertEqual(initial.claimedScore, 9)

        let corrected = replacingGrid(other, "FN31")
        let afterCorrection = try ContestEngine.score(
            [first, duplicate, crossBand, corrected], session: session, rule: reopened)
        XCTAssertEqual(afterCorrection.totalPoints, 3)
        XCTAssertEqual(afterCorrection.multiplierCount, 2)
        XCTAssertEqual(afterCorrection.claimedScore, 6)

        let afterDeletion = try ContestEngine.score([first, duplicate, corrected], session: session, rule: reopened)
        XCTAssertEqual(afterDeletion.totalPoints, 2)
        XCTAssertEqual(afterDeletion.multiplierCount, 1)
        XCTAssertEqual(afterDeletion.claimedScore, 2)
    }

    func testInvalidGridNeverOccupiesDuplicateOrMultiplierState() throws {
        let rule = try ARRLVHFDeclarativeDefinitions.rule(for: .june)
        let session = makeSession(rule)
        for invalidGrid in ["ZZ99", "FN311", "fn31"] {
            let invalid = qso(1, session, call: "K1AAA", band: "6m", grid: invalidGrid)
            let valid = qso(2, session, call: "K1AAA", band: "6m", grid: "FN31")
            let score = try ContestEngine.score([invalid, valid], session: session, rule: rule)
            XCTAssertEqual(score.qsos.map(\.disposition), [.invalid, .accepted], invalidGrid)
            XCTAssertEqual(score.totalPoints, 1)
            XCTAssertEqual(score.multiplierCount, 1)
            XCTAssertEqual(score.claimedScore, 1)
        }
    }

    func testSourceShapedArchiveUsesMinimumWidthFrequencyAndExactFieldOrder() throws {
        let rule = try ARRLVHFDeclarativeDefinitions.rule(for: .september)
        let session = makeSession(rule)
        let expected: [(String, String, Int64, String)] = [
            ("6m", "CW", 50_125_000,
             "QSO: 50125 CW 2030-03-23 1240 OM0RX         JN98   K1ABC         FN31  "),
            ("2m", "SSB", 144_200_000,
             "QSO: 144200 PH 2030-03-23 1240 OM0RX         JN98   K1ABC         FN31  "),
            ("13cm", "CW", 2_304_100_000,
             "QSO: 2304100 CW 2030-03-23 1240 OM0RX         JN98   K1ABC         FN31  "),
        ]
        for (band, mode, frequency, line) in expected {
            let contact = qso(0, session, call: "K1ABC", band: band, grid: "FN31",
                              mode: mode, frequencyHz: frequency)
            XCTAssertEqual(try CabrilloExporter.qsoLine(contact, session: session, rule: rule), line)
        }
    }

    func testMinimumWidthIsFrequencyOnlyAndLegacyArchiveBytesRemainStable() throws {
        let legacy = TenTenDeclarativeDefinitions.draft(for: .winterPhone)
        let encoded = try JSONEncoder().encode(legacy)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("minimumWidth"))
        XCTAssertEqual(try legacy.materialized().definitionDigest,
                       "0d05cff62ae87dca57224fbdc49222e346e5008235a37b493c80a04e6959ebd7")

        let base = ARRLVHFDeclarativeDefinitions.draft(for: .january)
        let badColumn = ContestDeclarativeExportColumn(source: .mode, width: 2, minimumWidth: 1)
        let badProjection = ContestDeclarativeExportProjection(
            formatterVersion: base.entry.cabrilloFormatterVersion,
            columns: [badColumn] + (base.exportProjection?.columns.dropFirst() ?? []))
        let bad = replacing(base, exportProjection: badProjection)
        XCTAssertThrowsError(try bad.materialized())
    }

    private struct Fixture: Decodable { let plugins: [Plugin] }
    private struct Plugin: Decodable {
        let season: String
        let path: String
        let sha256: String
        let bandPoints: [String: Int64]
        let allBandPoints: Int64
        let allBandMultiplierCount: Int64
        let allBandScore: Int64
    }

    private func fixturePlugins() throws -> [String: Plugin] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/arrl-vhf-source-oracles.json")
        let rows = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).plugins
        return Dictionary(uniqueKeysWithValues: rows.map { ($0.season, $0) })
    }

    private func makeSession(_ rule: DeclarativeContestRule) -> ContestSessionSnapshot {
        .init(id: UUID(uuidString: "EA100000-0000-0000-0000-000000000001")!,
              workspaceGeneration: UUID(uuidString: "EA100000-0000-0000-0000-000000000002")!,
              rule: rule.metadata.identity, referenceDataVersion: "arrl-vhf-source-preview",
              startedAt: timestamp,
              station: .init(callsign: "OM0RX", entity: nil, sentExchange: "JN98",
                             operatorCallsigns: ["OM0RX"], location: "JN98",
                             sentExchangeFields: ["grid": field("JN98")]))
    }

    private func qso(_ seed: Int, _ session: ContestSessionSnapshot, call: String, band: String,
                     grid: String, mode: String = "CW", frequencyHz: Int64? = nil) -> ContestQSO {
        .init(id: UUID(uuidString: String(format: "EB100000-0000-0000-0000-%012d", seed + 1))!,
              sessionID: session.id, timestampUTC: timestamp,
              callsign: call, band: band, mode: mode, frequencyHz: frequencyHz ?? frequency(band),
              rstSent: "", rstReceived: "",
              exchange: .init(rawSent: "JN98", normalizedSent: "JN98",
                              rawReceived: grid, normalizedReceived: grid,
                              sentFields: ["grid": field("JN98")],
                              receivedFields: ["grid": field(grid)]),
              entity: nil, operatorCallsign: "OM0RX", stationLocation: "JN98",
              provenance: .init(source: .operatorEntry))
    }

    private func replacingGrid(_ qso: ContestQSO, _ grid: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                              rawReceived: grid, normalizedReceived: grid,
                              sentFields: qso.exchange.sentFields, receivedFields: ["grid": field(grid)]),
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func replacing(_ base: ContestDefinitionDraft,
                           exportProjection: ContestDeclarativeExportProjection) -> ContestDefinitionDraft {
        .init(id: base.id, version: base.version, edition: base.edition, displayName: base.displayName,
              cabrilloName: base.cabrilloName, supportedBands: base.supportedBands,
              supportedModes: base.supportedModes, entry: base.entry,
              sourceProvenance: base.sourceProvenance, dupePolicy: base.dupePolicy,
              multiplierPolicy: base.multiplierPolicy, gridMultiplier: base.gridMultiplier,
              scoring: base.scoring, eligibilityPolicy: base.eligibilityPolicy,
              exportPolicy: base.exportPolicy, exportProjection: exportProjection,
              stationEntityRequired: base.stationEntityRequired, adapterID: base.adapterID)
    }

    private func frequency(_ band: String) -> Int64 {
        switch band {
        case "6m": 50_125_000
        case "2m": 144_200_000
        case "1.25m": 222_100_000
        case "70cm": 432_100_000
        case "33cm": 903_100_000
        case "23cm": 1_296_100_000
        default: 2_304_100_000
        }
    }

    private func field(_ value: String) -> ContestExchangeFieldValue { .init(raw: value, normalized: value) }
}
