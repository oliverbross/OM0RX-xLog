import Foundation
import XCTest
@testable import XContestCore

final class ContestARRLVHFDeclarativeTests: XCTestCase {
    private let timestamp = Date(timeIntervalSince1970: 1_900_500_000)
    private let bands = ["6m", "2m", "1.25m", "70cm", "33cm", "23cm", "13cm", "9cm", "6cm",
                         "3cm", "1.25cm", "6mm", "4mm", "2.5mm", "2mm", "1mm", "submm"]

    func testPinnedSourceManifestAndInactiveDefinitionCoordinates() throws {
        let fixture = try fixturePlugins()
        XCTAssertEqual(Set(fixture.keys), Set(ARRLVHFSeason.allCases.map(\.rawValue)))
        for season in ARRLVHFSeason.allCases {
            let row = try XCTUnwrap(fixture[season.rawValue])
            let draft = ARRLVHFDeclarativeDefinitions.draft(for: season)
            XCTAssertEqual(row.sha256, ARRLVHFDeclarativeDefinitions.sourceSHA256(for: season))
            XCTAssertEqual(row.officialPreviewBandPoints, ARRLVHFDeclarativeDefinitions.points(for: season))
            XCTAssertEqual(row.pinnedExecutableBandPoints["13cm"], 0)
            XCTAssertNotEqual(row.pinnedExecutableBandPoints, row.officialPreviewBandPoints)
            XCTAssertEqual(draft.id, "arrl-vhf-\(season.rawValue)")
            XCTAssertEqual(draft.version, "1.0.0-source-preview")
            XCTAssertEqual(draft.edition, "contest-sw-26.10.11")
            XCTAssertEqual(draft.cabrilloName, "ARRL-VHF")
            XCTAssertEqual(draft.supportedBands, Set(bands))
            XCTAssertEqual(draft.supportedModes, ["CW", "SSB"])
            XCTAssertNil(draft.operatorPolicy)
            XCTAssertNil(draft.stationGridPolicy)
            XCTAssertEqual(draft.dupePolicy, .perBand)
            XCTAssertFalse(String(decoding: try JSONEncoder().encode(draft), as: UTF8.self)
                .contains("stationGridPolicy"))
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
            XCTAssertEqual(score.qsos.map(\.points), bands.map { row.officialPreviewBandPoints[$0]! },
                           season.rawValue)
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

    func testFixedStationCanWorkRemoteRoverFromMultipleGridsButNotRepeatEitherPair() throws {
        let draft = ARRLVHFDeclarativeDefinitions.draft(for: .january, category: .fixed)
        XCTAssertEqual(draft.id, "arrl-vhf-january-fixed-official-grid-preview")
        XCTAssertEqual(draft.stationGridPolicy?.behavior, .fixed)
        let rule = DeclarativeContestRule(definition: try draft.materialized())
        let session = makeSession(rule)
        let contacts = [
            qso(1, session, call: "K1ABC/R", band: "6m", grid: "FN31"),
            qso(2, session, call: "K1ABC/R", band: "6m", grid: "FN32", mode: "SSB"),
            qso(3, session, call: "K1ABC/R", band: "6m", grid: "FN31", mode: "SSB"),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted, .duplicate])
        XCTAssertEqual(score.totalPoints, 2)
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 4)

        let wrongOwnGrid = qso(4, session, call: "K2ABC", band: "6m", grid: "FN33",
                               stationGrid: "JN99")
        XCTAssertEqual(try ContestEngine.score([wrongOwnGrid], session: session, rule: rule)
            .qsos.map(\.disposition), [.invalid])
    }

    func testRoverOwnMovesAndBothRoverGridsUseFourCoordinateDupeAndGlobalActivatedGrids() throws {
        let rule = try ARRLVHFDeclarativeDefinitions.rule(for: .june, category: .rover)
        let session = makeSession(rule)
        let contacts = [
            qso(1, session, call: "K1FIX", band: "6m", grid: "FN31", stationGrid: "JN98"),
            qso(2, session, call: "K1FIX", band: "6m", grid: "FN31", stationGrid: "JN99", mode: "SSB"),
            qso(3, session, call: "K1FIX", band: "6m", grid: "FN31", stationGrid: "JN99"),
            qso(4, session, call: "K2ROV/R", band: "6m", grid: "FN32", stationGrid: "JN98"),
            qso(5, session, call: "K2ROV/R", band: "6m", grid: "FN33", stationGrid: "JN99", mode: "SSB"),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition),
                       [.accepted, .accepted, .duplicate, .accepted, .accepted])
        XCTAssertEqual(score.totalPoints, 4)
        XCTAssertEqual(score.multiplierCount, 5)
        XCTAssertEqual(score.claimedScore, 20)
        XCTAssertEqual(Set(score.qsos.flatMap(\.newMultipliers).filter {
            $0.kind == "activatedMaidenheadGrid4"
        }), [
            .init(kind: "activatedMaidenheadGrid4", value: "JN98", scope: "session"),
            .init(kind: "activatedMaidenheadGrid4", value: "JN99", scope: "session"),
        ])
    }

    func testRoverCorrectionAndDeletionReclassifyFourCoordinateDuplicates() throws {
        let rule = try ARRLVHFDeclarativeDefinitions.rule(for: .september, category: .rover)
        let session = makeSession(rule)
        let first = qso(1, session, call: "K1FIX", band: "6m", grid: "FN31", stationGrid: "JN98")
        let duplicate = qso(2, session, call: "K1FIX", band: "6m", grid: "FN31", stationGrid: "JN98")
        let moved = qso(3, session, call: "K1FIX", band: "6m", grid: "FN31", stationGrid: "JN99")

        let remoteCorrection = replacingGrid(first, "FN32")
        let correctedRemote = try ContestEngine.score(
            [remoteCorrection, duplicate, moved], session: session, rule: rule)
        XCTAssertEqual(correctedRemote.qsos.map(\.disposition), [.accepted, .accepted, .accepted])
        XCTAssertEqual(correctedRemote.totalPoints, 3)
        XCTAssertEqual(correctedRemote.multiplierCount, 4)
        XCTAssertEqual(correctedRemote.claimedScore, 12)

        let ownCorrection = replacingStationGrid(moved, "JN98")
        let correctedOwn = try ContestEngine.score(
            [first, duplicate, ownCorrection], session: session, rule: rule)
        XCTAssertEqual(correctedOwn.qsos.map(\.disposition), [.accepted, .duplicate, .duplicate])
        XCTAssertEqual(correctedOwn.totalPoints, 1)
        XCTAssertEqual(correctedOwn.multiplierCount, 2)
        XCTAssertEqual(correctedOwn.claimedScore, 2)

        let afterDeletion = try ContestEngine.score([duplicate, moved], session: session, rule: rule)
        XCTAssertEqual(afterDeletion.qsos.map(\.disposition), [.accepted, .accepted])
        XCTAssertEqual(afterDeletion.totalPoints, 2)
        XCTAssertEqual(afterDeletion.multiplierCount, 3)
        XCTAssertEqual(afterDeletion.claimedScore, 6)
    }

    func testStationGridPolicyIsStrictAndRoverSentGridMustMatchQSOCoordinate() throws {
        let unknownKey = Data(#"{"behavior":"rover","sentFieldID":"grid","future":true}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ContestDeclarativeStationGridPolicy.self,
                                                      from: unknownKey))

        let rule = try ARRLVHFDeclarativeDefinitions.rule(for: .june, category: .rover)
        let session = makeSession(rule)
        let contact = qso(1, session, call: "K1FIX", band: "6m", grid: "FN31", stationGrid: "JN98")
        let mismatched = replacingSentGridOnly(contact, "JN99")
        let score = try ContestEngine.score([mismatched], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.invalid])
        XCTAssertEqual(score.totalPoints, 0)
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
            ("submm", "SSB", 300_100_000_000,
             "QSO: 300100000 PH 2030-03-23 1240 OM0RX         JN98   K1ABC         FN31  "),
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

        for invalidWidth in [0, -1] {
            let malformedFrequency = ContestDeclarativeExportColumn(
                source: .frequencyKHz, width: invalidWidth, minimumWidth: 1, alignment: .right)
            let malformedProjection = ContestDeclarativeExportProjection(
                formatterVersion: base.entry.cabrilloFormatterVersion,
                columns: [malformedFrequency] + (base.exportProjection?.columns.dropFirst() ?? []))
            XCTAssertThrowsError(try replacing(base, exportProjection: malformedProjection).materialized(),
                                 "width \(invalidWidth) must return diagnostics instead of trapping")
        }
    }

    private struct Fixture: Decodable { let plugins: [Plugin] }
    private struct Plugin: Decodable {
        let season: String
        let path: String
        let sha256: String
        let officialPreviewBandPoints: [String: Int64]
        let pinnedExecutableBandPoints: [String: Int64]
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
                     grid: String, stationGrid: String = "JN98", mode: String = "CW",
                     frequencyHz: Int64? = nil) -> ContestQSO {
        .init(id: UUID(uuidString: String(format: "EB100000-0000-0000-0000-%012d", seed + 1))!,
              sessionID: session.id, timestampUTC: timestamp,
              callsign: call, band: band, mode: mode, frequencyHz: frequencyHz ?? frequency(band),
              rstSent: "", rstReceived: "",
              exchange: .init(rawSent: stationGrid, normalizedSent: stationGrid,
                              rawReceived: grid, normalizedReceived: grid,
                              sentFields: ["grid": field(stationGrid)],
                              receivedFields: ["grid": field(grid)]),
              entity: nil, operatorCallsign: "OM0RX", stationLocation: stationGrid,
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

    private func replacingStationGrid(_ qso: ContestQSO, _ grid: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: grid, normalizedSent: grid,
                              rawReceived: qso.exchange.rawReceived,
                              normalizedReceived: qso.exchange.normalizedReceived,
                              sentFields: ["grid": field(grid)],
                              receivedFields: qso.exchange.receivedFields),
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: grid, provenance: qso.provenance)
    }

    private func replacingSentGridOnly(_ qso: ContestQSO, _ grid: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: grid, normalizedSent: grid,
                              rawReceived: qso.exchange.rawReceived,
                              normalizedReceived: qso.exchange.normalizedReceived,
                              sentFields: ["grid": field(grid)],
                              receivedFields: qso.exchange.receivedFields),
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
        case "13cm": 2_304_100_000
        case "9cm": 3_400_100_000
        case "6cm": 5_760_100_000
        case "3cm": 10_100_100_000
        case "1.25cm": 24_050_100_000
        case "6mm": 47_100_100_000
        case "4mm": 76_000_100_000
        case "2.5mm": 120_000_100_000
        case "2mm": 134_100_100_000
        case "1mm": 241_100_100_000
        default: 300_100_000_000
        }
    }

    private func field(_ value: String) -> ContestExchangeFieldValue { .init(raw: value, normalized: value) }
}
