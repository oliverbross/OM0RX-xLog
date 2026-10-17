import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestARRLDXStoreTests: XCTestCase {
    private let generation = UUID(uuidString: "E3000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_500_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let registry = ContestRuleRegistry([ARRLDXCWRule(), ARRLDXSSBRule()])

    func testCreateDraftCommitReplayReopenAndMaliciousSentEditsAreAtomic() async throws {
        for (index, rule) in rules().enumerated() {
            let ids = IDs(10 + index)
            let url = databaseURL()
            var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
            let initial = draft(ids, rule: rule, revision: 1, call: "W1AAA", location: "CT")
            let created = try await store!.createSession(
                session(ids, rule: rule), metadata: metadata(), initialDraft: initial,
                scope: mutation(ids, 1, revision: 0, digest: "create", draft: ids.draft), committedAt: date)
            XCTAssertEqual(created.draft.exchange.rawSent, "K")
            XCTAssertEqual(created.draft.exchange.normalizedSent, "1000")
            XCTAssertEqual(created.projection.draft, created.draft)

            do {
                _ = try await store!.reserveSerial(
                    reservationID: requestID(ids, 500), serialScope: .session, scopeValue: "",
                    scope: mutation(ids, 5, revision: 1, digest: "no-serial", draft: ids.draft),
                    committedAt: date.addingTimeInterval(5))
                XCTFail("ARRL DX must not allocate a serial")
            } catch let error as ContestRepositoryError {
                XCTAssertEqual(error, .invalidSerialTransition)
            }
            let afterReserveAttempt = try await store!.openSession(id: ids.session)
            let reserveReceipt = try await store!.operationReceipt(
                sessionID: ids.session, workspaceGeneration: generation,
                requestID: requestID(ids, 5), payloadDigest: "no-serial")
            XCTAssertEqual(afterReserveAttempt.revision, 1)
            XCTAssertNil(reserveReceipt)

            let badDrafts = [
                draft(ids, rule: rule, revision: 2, call: "W1AAA", location: "CT", sentRaw: "1000"),
                draft(ids, rule: rule, revision: 2, call: "W1AAA", location: "CT", sentNormalized: "999"),
                draft(ids, rule: rule, revision: 2, call: "W1AAA", location: "CT",
                      sentFields: ["power": .init(raw: "K", normalized: "999")]),
                draft(ids, rule: rule, revision: 2, call: "W1AAA", location: "CT",
                      sentFields: [:]),
                draft(ids, rule: rule, revision: 2, call: "W1AAA", location: "CT",
                      sentFields: ["power": .init(raw: "K", normalized: "1000"),
                                   "extra": .init(raw: "X", normalized: "X")]),
            ]
            for (offset, bad) in badDrafts.enumerated() {
                let request = 10 + offset
                do {
                    _ = try await store!.updateDraft(
                        bad, scope: mutation(ids, request, revision: 1, digest: "bad-draft-\(offset)", draft: ids.draft),
                        committedAt: date.addingTimeInterval(Double(request)))
                    XCTFail("Expected malicious sent draft edit to reject")
                } catch let error as ContestRepositoryError {
                    XCTAssertEqual(error, .invalidDraft)
                }
                let afterBadDraft = try await store!.openSession(id: ids.session)
                let preservedDraft = try await store!.draft(sessionID: ids.session, id: ids.draft)
                let badDraftReceipt = try await store!.operationReceipt(
                    sessionID: ids.session, workspaceGeneration: generation,
                    requestID: requestID(ids, request), payloadDigest: "bad-draft-\(offset)")
                XCTAssertEqual(afterBadDraft.revision, 1)
                XCTAssertEqual(preservedDraft, initial)
                XCTAssertNil(badDraftReceipt)
            }

            let edited = draft(ids, rule: rule, revision: 2, call: "W2AAA", location: "NY")
            _ = try await store!.updateDraft(
                edited, scope: mutation(ids, 20, revision: 1, digest: "edit", draft: ids.draft),
                committedAt: date.addingTimeInterval(20))
            let goodQSO = qso(ids, 1, rule: rule, call: "W2AAA", location: "NY")
            let badQSOs = [
                replacingSent(goodQSO, raw: "1000", normalized: "1000",
                              fields: ["power": .init(raw: "K", normalized: "1000")]),
                replacingSent(goodQSO, raw: "K", normalized: "999",
                              fields: ["power": .init(raw: "K", normalized: "999")]),
                replacingSent(goodQSO, raw: "K", normalized: "1000",
                              fields: ["power": .init(raw: "1000", normalized: "1000")]),
                replacingSent(goodQSO, raw: "K", normalized: "1000", fields: [:]),
                replacingSent(goodQSO, raw: "K", normalized: "1000",
                              fields: ["power": .init(raw: "K", normalized: "1000"),
                                       "extra": .init(raw: "X", normalized: "X")]),
            ]
            for (offset, bad) in badQSOs.enumerated() {
                let request = 30 + offset
                do {
                    _ = try await store!.commitQSO(
                        bad, reservationID: nil,
                        scope: mutation(ids, request, revision: 2, digest: "bad-commit-\(offset)", draft: ids.draft),
                        committedAt: date.addingTimeInterval(Double(request)))
                    XCTFail("Expected malicious sent direct commit to reject")
                } catch let error as ContestStoreError {
                    guard case .invalidQSO = error else { return XCTFail("Expected invalidQSO, got \(error)") }
                }
                let afterBadCommit = try await store!.openSession(id: ids.session)
                let preservedLog = try await store!.logPage(sessionID: ids.session, offset: 0, limit: 10)
                let badCommitReceipt = try await store!.operationReceipt(
                    sessionID: ids.session, workspaceGeneration: generation,
                    requestID: requestID(ids, request), payloadDigest: "bad-commit-\(offset)")
                XCTAssertEqual(afterBadCommit.revision, 2)
                XCTAssertEqual(preservedLog.total, 0)
                XCTAssertNil(badCommitReceipt)
            }

            let commitScope = mutation(ids, 40, revision: 2, digest: "commit", draft: ids.draft)
            let committed = try await store!.commitQSO(
                goodQSO, reservationID: nil, scope: commitScope,
                committedAt: date.addingTimeInterval(40))
            XCTAssertEqual(committed.score.totalPoints, 3)
            XCTAssertEqual(committed.score.multiplierCount, 1)
            XCTAssertEqual(committed.score.claimedScore, 3)
            XCTAssertEqual(committed.draft.exchange.rawSent, "K")
            XCTAssertEqual(committed.draft.exchange.normalizedSent, "1000")
            XCTAssertEqual(committed.draft.exchange.sentFields,
                           ["power": .init(raw: "K", normalized: "1000")])
            XCTAssertEqual(committed.projection.draft, committed.draft)

            let nextDraft = editing(committed.draft, revision: 4, call: "W3AAA", location: "CT")
            _ = try await store!.updateDraft(
                nextDraft, scope: mutation(ids, 41, revision: 3, digest: "next-edit", draft: ids.draft),
                committedAt: date.addingTimeInterval(41))
            let nextQSO = qso(ids, 2, rule: rule, call: "W3AAA", location: "CT", draft: nextDraft)
            let nextCommitScope = mutation(ids, 42, revision: 4, digest: "next-commit", draft: ids.draft)
            let nextCommitted = try await store!.commitQSO(
                nextQSO, reservationID: nil, scope: nextCommitScope,
                committedAt: date.addingTimeInterval(42))
            XCTAssertEqual(nextCommitted.score.totalPoints, 6)
            XCTAssertEqual(nextCommitted.score.multiplierCount, 2)
            XCTAssertEqual(nextCommitted.score.claimedScore, 12)
            XCTAssertEqual(nextCommitted.draft.exchange.rawSent, "K")
            XCTAssertEqual(nextCommitted.draft.exchange.normalizedSent, "1000")
            XCTAssertEqual(nextCommitted.projection.draft, nextCommitted.draft)
            store = nil

            store = try SQLiteContestStore(databaseURL: url, rules: registry)
            let replayed = try await store!.commitQSO(
                goodQSO, reservationID: nil, scope: commitScope,
                committedAt: date.addingTimeInterval(400))
            XCTAssertEqual(replayed, committed)
            let replayedNext = try await store!.commitQSO(
                nextQSO, reservationID: nil, scope: nextCommitScope,
                committedAt: date.addingTimeInterval(420))
            XCTAssertEqual(replayedNext, nextCommitted)
            let reopened = try await store!.openSession(id: ids.session)
            let reopenedQSOs = try await store!.qsos(sessionID: ids.session, offset: 0, limit: 10)
            let reopenedDraft = try await store!.draft(sessionID: ids.session, id: ids.draft)
            XCTAssertEqual(reopened.revision, 5)
            XCTAssertEqual(reopenedQSOs, [goodQSO, nextQSO])
            XCTAssertEqual(reopenedDraft.exchange.rawSent, "K")
            XCTAssertEqual(reopenedDraft.exchange.normalizedSent, "1000")
        }
    }

    func testCorrectionDeletionAndDuplicatePromotionReplayDeterministically() async throws {
        for (index, rule) in rules().enumerated() {
            let ids = IDs(30 + index)
            let url = databaseURL()
            var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
            _ = try await store!.createSession(
                session(ids, rule: rule), metadata: metadata(),
                initialDraft: draft(ids, rule: rule, revision: 1, call: "W1AAA", location: "CT"),
                scope: mutation(ids, 1, revision: 0, digest: "create", draft: ids.draft), committedAt: date)
            let first = qso(ids, 1, rule: rule, call: "W1AAA", location: "CT")
            let second = qso(ids, 2, rule: rule, call: "W1AAA", location: "CT")
            _ = try await store!.commitQSO(
                first, reservationID: nil,
                scope: mutation(ids, 2, revision: 1, digest: "first", draft: ids.draft),
                committedAt: date.addingTimeInterval(1))
            let duplicate = try await store!.commitQSO(
                second, reservationID: nil,
                scope: mutation(ids, 3, revision: 2, digest: "second", draft: ids.draft),
                committedAt: date.addingTimeInterval(2))
            XCTAssertEqual(duplicate.committedEvaluation.disposition, .duplicate)
            XCTAssertEqual(duplicate.score.claimedScore, 3)

            let corrected = replacingWorked(first, call: "W2AAA", location: "NY")
            let correctionScope = mutation(ids, 4, revision: 3, digest: "correct", draft: nil)
            let correction = try await store!.correctQSO(
                corrected, reason: "copied call and exchange correction",
                operationTimestamp: date.addingTimeInterval(3), scope: correctionScope,
                committedAt: date.addingTimeInterval(3))
            XCTAssertEqual(correction.score.totalPoints, 6)
            XCTAssertEqual(correction.score.multiplierCount, 2)
            XCTAssertEqual(correction.score.claimedScore, 12)
            let correctedScore = try await store!.scoreSnapshot(sessionID: ids.session)
            XCTAssertEqual(correctedScore.score.qsos.map(\.disposition), [.accepted, .accepted])

            let deleteScope = mutation(ids, 5, revision: 4, digest: "delete", draft: nil)
            let deletion = try await store!.deleteQSO(
                id: corrected.id, reason: "remove corrected contact",
                operationTimestamp: date.addingTimeInterval(4), scope: deleteScope,
                committedAt: date.addingTimeInterval(4))
            XCTAssertEqual(deletion.score.totalPoints, 3)
            XCTAssertEqual(deletion.score.multiplierCount, 1)
            XCTAssertEqual(deletion.score.claimedScore, 3)
            let deletedScore = try await store!.scoreSnapshot(sessionID: ids.session)
            XCTAssertEqual(deletedScore.score.qsos.map(\.disposition), [.accepted])
            store = nil

            store = try SQLiteContestStore(databaseURL: url, rules: registry)
            let replayedCorrection = try await store!.correctQSO(
                corrected, reason: "copied call and exchange correction",
                operationTimestamp: date.addingTimeInterval(3), scope: correctionScope,
                committedAt: date.addingTimeInterval(30))
            let replayedDeletion = try await store!.deleteQSO(
                id: corrected.id, reason: "remove corrected contact",
                operationTimestamp: date.addingTimeInterval(4), scope: deleteScope,
                committedAt: date.addingTimeInterval(40))
            let remaining = try await store!.qsos(sessionID: ids.session, offset: 0, limit: 10)
            let reopened = try await store!.openSession(id: ids.session)
            XCTAssertEqual(replayedCorrection, correction)
            XCTAssertEqual(replayedDeletion, deletion)
            XCTAssertEqual(remaining, [second])
            XCTAssertEqual(reopened.revision, 5)
        }
    }

    private struct IDs {
        let session: UUID
        let draft: UUID
        let seed: Int
        init(_ seed: Int) {
            self.seed = seed
            session = UUID(uuidString: String(format: "E1000000-0000-0000-0000-%012d", seed))!
            draft = UUID(uuidString: String(format: "E2000000-0000-0000-0000-%012d", seed))!
        }
    }

    private func rules() -> [any ContestRule] { [ARRLDXCWRule(), ARRLDXSSBRule()] }

    private func session(_ ids: IDs, rule: any ContestRule) -> ContestSessionSnapshot {
        .init(id: ids.session, workspaceGeneration: generation, rule: rule.metadata.identity,
              referenceDataVersion: "cty-arrl-fixture", startedAt: date,
              station: .init(callsign: "OM0RX", entity: slovakia, sentExchange: "K",
                             operatorCallsigns: ["OM0RX"], location: "DX",
                             sentExchangeFields: ["power": .init(raw: "K", normalized: "1000")]))
    }

    private func metadata() -> ContestSessionMetadata {
        .init(name: "ARRL DX fixture", operatorCallsign: "OM0RX", operatorCategory: "single-op")
    }

    private func draft(_ ids: IDs, rule: any ContestRule, revision: UInt64, call: String, location: String,
                       sentRaw: String = "K", sentNormalized: String = "1000",
                       sentFields: [String: ContestExchangeFieldValue] = ["power": .init(raw: "K", normalized: "1000")])
        -> ContestDraftSnapshot {
        let report = rule.metadata.entry.report.defaultSent
        return .init(id: ids.draft, sessionID: ids.session, revision: revision,
                     updatedAt: date.addingTimeInterval(Double(revision)), callsign: call,
                     band: "20m", mode: rule.metadata.entry.mode, frequencyHz: 14_050_000,
                     rstSent: report, rstReceived: report,
                     exchange: .init(rawSent: sentRaw, normalizedSent: sentNormalized,
                                     rawReceived: location, normalizedReceived: location,
                                     sentFields: sentFields,
                                     receivedFields: ["location": .init(raw: location, normalized: location)]),
                     entity: usa, operatorCallsign: "OM0RX", stationLocation: "DX")
    }

    private func qso(_ ids: IDs, _ number: Int, rule: any ContestRule, call: String,
                     location: String, draft: ContestDraftSnapshot? = nil) -> ContestQSO {
        let report = rule.metadata.entry.report.defaultSent
        let sentExchange = draft?.exchange ?? .init(
            rawSent: "K", normalizedSent: "1000", rawReceived: location,
            normalizedReceived: location,
            sentFields: ["power": .init(raw: "K", normalized: "1000")],
            receivedFields: ["location": .init(raw: location, normalized: location)])
        return .init(id: requestID(ids, 400 + number), sessionID: ids.session,
                     timestampUTC: date.addingTimeInterval(Double(100 + number)), callsign: call,
                     band: "20m", mode: rule.metadata.entry.mode, frequencyHz: 14_050_000,
                     rstSent: report, rstReceived: report,
                     exchange: sentExchange,
                     entity: usa, operatorCallsign: "OM0RX", stationLocation: "DX",
                     provenance: .init(source: .operatorEntry))
    }

    private func editing(_ returned: ContestDraftSnapshot, revision: UInt64,
                         call: String, location: String) -> ContestDraftSnapshot {
        .init(id: returned.id, sessionID: returned.sessionID, revision: revision,
              updatedAt: date.addingTimeInterval(Double(revision)), callsign: call,
              band: returned.band, mode: returned.mode, frequencyHz: returned.frequencyHz,
              rstSent: returned.rstSent, rstReceived: returned.rstReceived,
              exchange: .init(rawSent: returned.exchange.rawSent,
                              normalizedSent: returned.exchange.normalizedSent,
                              rawReceived: location, normalizedReceived: location,
                              sentFields: returned.exchange.sentFields,
                              receivedFields: ["location": .init(raw: location, normalized: location)]),
              entity: usa, operatorCallsign: returned.operatorCallsign,
              stationLocation: returned.stationLocation)
    }

    private func replacingSent(_ qso: ContestQSO, raw: String, normalized: String,
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

    private func replacingWorked(_ qso: ContestQSO, call: String, location: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: call,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived,
              exchange: .init(rawSent: qso.exchange.rawSent,
                              normalizedSent: qso.exchange.normalizedSent,
                              rawReceived: location, normalizedReceived: location,
                              sentFields: qso.exchange.sentFields,
                              receivedFields: ["location": .init(raw: location, normalized: location)]),
              entity: usa, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func mutation(_ ids: IDs, _ request: Int, revision: UInt64, digest: String,
                          draft: UUID?) -> ContestMutationScope {
        .init(sessionID: ids.session, workspaceGeneration: generation,
              requestID: requestID(ids, request), expectedRevision: revision,
              draftID: draft, payloadDigest: digest)
    }

    private func requestID(_ ids: IDs, _ value: Int) -> UUID {
        UUID(uuidString: String(format: "E9000000-0000-%04X-0000-%012d", ids.seed, value))!
    }

    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-arrl-dx-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}
