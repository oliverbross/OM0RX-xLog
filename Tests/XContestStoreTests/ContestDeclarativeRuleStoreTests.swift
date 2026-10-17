import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestDeclarativeRuleStoreTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_400_000)

    func testFourDefinitionsScoreDupeCorrectionAndRestartThroughSharedStorePath() async throws {
        for (offset, variant) in TenTenSeasonalVariant.allCases.enumerated() {
            let ids = IDs(offset)
            let rule = try TenTenDeclarativeDefinitions.rule(for: variant)
            let registry = ContestRuleRegistry([rule])
            let url = databaseURL()
            var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
            _ = try await store!.createSession(
                session(ids, rule), metadata: .init(name: variant.rawValue, operatorCallsign: "OM0RX",
                                                    operatorCategory: "single-op"),
                initialDraft: draft(ids, rule), scope: scope(ids, 1, revision: 0, draft: true), committedAt: date)
            let mode = rule.metadata.supportedModes.contains("CW") ? "CW" : "SSB"
            let first = qso(ids, 1, call: "K1ABC", member: "0", mode: mode)
            let second = qso(ids, 2, call: "W1XYZ", member: "123", mode: mode)
            let duplicate = qso(ids, 3, call: "W1XYZ", member: "999", mode: mode)
            _ = try await store!.commitQSO(first, reservationID: nil,
                                           scope: scope(ids, 2, revision: 1, draft: true),
                                           committedAt: date.addingTimeInterval(1))
            _ = try await store!.commitQSO(second, reservationID: nil,
                                           scope: scope(ids, 3, revision: 2, draft: true),
                                           committedAt: date.addingTimeInterval(2))
            let third = try await store!.commitQSO(duplicate, reservationID: nil,
                                                   scope: scope(ids, 4, revision: 3, draft: true),
                                                   committedAt: date.addingTimeInterval(3))
            XCTAssertEqual(third.committedEvaluation.disposition, .duplicate, variant.rawValue)
            XCTAssertEqual(third.score.claimedScore, 3, variant.rawValue)

            let corrected = qso(ids, 1, call: "K1ABC", member: "555", mode: mode)
            let correction = try await store!.correctQSO(
                corrected, reason: "Correct 10-10 member number",
                operationTimestamp: date.addingTimeInterval(4),
                scope: scope(ids, 5, revision: 4, draft: false),
                committedAt: date.addingTimeInterval(4))
            XCTAssertEqual(correction.score.claimedScore, 4, variant.rawValue)
            let originalIdentity = (try await store!.openSession(id: ids.session)).session.rule
            store = nil

            let reopened = try SQLiteContestStore(databaseURL: url, rules: registry)
            let snapshot = try await reopened.scoreSnapshot(sessionID: ids.session)
            let reopenedSession = try await reopened.openSession(id: ids.session)
            XCTAssertEqual(snapshot.score.claimedScore, 4, variant.rawValue)
            XCTAssertEqual(reopenedSession.session.rule, originalIdentity)
            XCTAssertEqual(originalIdentity.sourceRevision, rule.definition.definitionDigest)
        }
    }

    private func session(_ ids: IDs, _ rule: DeclarativeContestRule) -> ContestSessionSnapshot {
        .init(id: ids.session, workspaceGeneration: ids.generation, rule: rule.metadata.identity,
              referenceDataVersion: "ten-ten-fixture", startedAt: date,
              station: .init(callsign: "OM0RX", entity: nil, sentExchange: "OLIVER 12345 AUSTRALIA",
                             operatorCallsigns: ["OM0RX"], sentExchangeFields: fields("OLIVER", "12345", "AUSTRALIA")))
    }

    private func draft(_ ids: IDs, _ rule: DeclarativeContestRule) -> ContestDraftSnapshot {
        let mode = rule.metadata.supportedModes.contains("CW") ? "CW" : "SSB"
        return .init(id: ids.draft, sessionID: ids.session, revision: 1, updatedAt: date,
                     callsign: "", band: "10m", mode: mode, frequencyHz: mode == "CW" ? 28_050_000 : 28_500_000,
                     rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: "OLIVER 12345 AUSTRALIA", normalizedSent: "OLIVER 12345 AUSTRALIA",
                                     rawReceived: "", normalizedReceived: "",
                                     sentFields: fields("OLIVER", "12345", "AUSTRALIA")),
                     entity: nil, operatorCallsign: "OM0RX", stationLocation: "")
    }

    private func qso(_ ids: IDs, _ seed: Int, call: String, member: String, mode: String) -> ContestQSO {
        let report = mode == "CW" ? "599" : "59"
        return .init(id: UUID(uuidString: String(format: "EC000000-0000-%04d-0000-%012d", ids.offset + 1, seed))!,
                     sessionID: ids.session, timestampUTC: date.addingTimeInterval(Double(seed)), callsign: call,
                     band: "10m", mode: mode, frequencyHz: mode == "CW" ? 28_050_000 : 28_500_000,
                     rstSent: report, rstReceived: report,
                     exchange: .init(rawSent: "OLIVER 12345 AUSTRALIA", normalizedSent: "OLIVER 12345 AUSTRALIA",
                                     rawReceived: "AL \(member) USA", normalizedReceived: "AL \(member) USA",
                                     sentFields: fields("OLIVER", "12345", "AUSTRALIA"),
                                     receivedFields: fields("AL", member, "USA")),
                     entity: nil, operatorCallsign: "OM0RX", stationLocation: "",
                     provenance: .init(source: .operatorEntry))
    }

    private func fields(_ name: String, _ member: String, _ qth: String) -> [String: ContestExchangeFieldValue] {
        ["name": .init(raw: name, normalized: name),
         "member-number": .init(raw: member, normalized: member),
         "qth": .init(raw: qth, normalized: qth)]
    }

    private func scope(_ ids: IDs, _ request: Int, revision: UInt64, draft: Bool) -> ContestMutationScope {
        .init(sessionID: ids.session, workspaceGeneration: ids.generation,
              requestID: UUID(uuidString: String(format: "ED000000-0000-%04d-0000-%012d", ids.offset + 1, request))!,
              expectedRevision: revision, draftID: draft ? ids.draft : nil, payloadDigest: "request-\(request)")
    }

    private struct IDs {
        let offset: Int
        let session: UUID
        let draft: UUID
        let generation: UUID
        init(_ offset: Int) {
            self.offset = offset
            session = UUID(uuidString: String(format: "EE000000-0000-%04d-0000-000000000001", offset + 1))!
            draft = UUID(uuidString: String(format: "EE000000-0000-%04d-0000-000000000002", offset + 1))!
            generation = UUID(uuidString: String(format: "EE000000-0000-%04d-0000-000000000003", offset + 1))!
        }
    }

    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-declarative-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}
