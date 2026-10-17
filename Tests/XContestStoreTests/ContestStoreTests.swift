import Foundation
import XCTest
import XContestCore
import CSQLitePrototype
@testable import XContestStore

final class ContestStoreTests: XCTestCase {
    private let sessionID = UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
    private let draftID = UUID(uuidString: "20000000-0000-0000-0000-000000000001")!
    private let generationID = UUID(uuidString: "ffffffff-ffff-ffff-8000-000000000007")!
    private let baseDate = Date(timeIntervalSince1970: 1_800_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testCreateReopenAndDeterministicReads() async throws {
        let url = databaseURL()
        let store = try SQLiteContestStore(databaseURL: url)
        let created = try await create(store)
        XCTAssertEqual(created.receipt.committedRevision, 1)
        let opened = try await store.openSession(id: sessionID)
        XCTAssertEqual(opened.revision, 1)
        XCTAssertEqual(opened.session.rule, CQWPXCWRule.identity)
        XCTAssertEqual(opened.metadata.name, "WPX test")
        XCTAssertEqual(opened.metadata.operatorCategory, "single-op")
        let initialDraft = try await store.draft(sessionID: sessionID, id: draftID)
        XCTAssertEqual(initialDraft.revision, 1)

        let reopened = try SQLiteContestStore(databaseURL: url)
        let sessions = try await reopened.listStoredSessions()
        let reopenedSession = try await reopened.openSession(id: sessionID)
        let readSnapshot = try await reopened.sessionReadSnapshot(id: sessionID)
        let pageSnapshot = try await reopened.sessionPageSnapshot(id: sessionID, offset: 0, limit: 20)
        let managerSnapshots = try await reopened.listSessionReadSnapshots()
        let reopenedReceipt = try await reopened.operationReceipt(sessionID: sessionID, workspaceGeneration: generationID,
                                                                  requestID: request(1), payloadDigest: "create")
        XCTAssertEqual(sessions.map(\.session.id), [sessionID])
        XCTAssertEqual(reopenedSession.revision, 1)
        XCTAssertEqual(readSnapshot.session.revision, 1)
        XCTAssertEqual(readSnapshot.drafts.map(\.id), [draftID])
        XCTAssertEqual(readSnapshot.qsoCount, 0)
        XCTAssertEqual(pageSnapshot.session.revision, pageSnapshot.log.revision)
        XCTAssertEqual(pageSnapshot.log.revision, pageSnapshot.score.revision)
        XCTAssertEqual(pageSnapshot.log.total, 0)
        XCTAssertEqual(managerSnapshots.map(\.session.session.id), [sessionID])
        XCTAssertEqual(reopenedReceipt, created.receipt)
        let replayedCreate = try await reopened.createSession(makeSession(), metadata: makeMetadata(),
                                                              initialDraft: makeDraft(revision: 1),
                                                              scope: mutation(1, revision: 0, digest: "create", draftID: draftID),
                                                              committedAt: baseDate.addingTimeInterval(500))
        let replayedSession = try await reopened.openSession(id: sessionID)
        XCTAssertEqual(replayedCreate, created)
        XCTAssertEqual(replayedSession.createdAt, baseDate)
    }

    func testRequestReplayPrecedesRevisionAndConflictingPayloadFails() async throws {
        let url = databaseURL()
        let store = try SQLiteContestStore(databaseURL: url)
        _ = try await create(store)
        let reservationID = fixedUUID(300)
        let scope = mutation(2, revision: 1, digest: "reserve", draftID: draftID)
        let first = try await store.reserveSerial(reservationID: reservationID, serialScope: .session,
                                                  scopeValue: "", scope: scope, committedAt: baseDate.addingTimeInterval(1))
        // The request retains its original expected revision, which is stale against current state.
        let staleRetry = mutation(2, revision: 1, digest: "reserve", draftID: draftID)
        let reopened = try SQLiteContestStore(databaseURL: url)
        let replay = try await reopened.reserveSerial(reservationID: reservationID, serialScope: .session,
                                                      scopeValue: "", scope: staleRetry, committedAt: baseDate.addingTimeInterval(999))
        XCTAssertEqual(replay, first)

        do {
            _ = try await reopened.reserveSerial(reservationID: fixedUUID(301), serialScope: .session,
                                                 scopeValue: "", scope: staleRetry, committedAt: baseDate)
            XCTFail("Expected canonical payload conflict")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .requestPayloadConflict(requestID: request(2)))
        }
    }

    func testStaleRevisionRollsBackDraft() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let changed = makeDraft(revision: 2, callsign: "K1ABC", updatedAt: baseDate.addingTimeInterval(2))
        _ = try await store.updateDraft(changed, scope: mutation(2, revision: 1, digest: "draft", draftID: draftID),
                                        committedAt: baseDate.addingTimeInterval(2))
        let later = try await store.reserveSerial(reservationID: fixedUUID(305), serialScope: .session,
                                                  scopeValue: "", scope: mutation(20, revision: 2, digest: "later", draftID: draftID),
                                                  committedAt: baseDate.addingTimeInterval(3))
        let replayedDraft = try await store.updateDraft(changed,
                                                        scope: mutation(2, revision: 1, digest: "draft", draftID: draftID),
                                                        committedAt: baseDate.addingTimeInterval(99))
        XCTAssertEqual(replayedDraft.session.revision, 2)
        XCTAssertEqual(replayedDraft.draft.revision, 2)
        XCTAssertEqual(later.session.revision, 3)
        do {
            _ = try await store.updateDraft(makeDraft(revision: 2, callsign: "DL1AAA", updatedAt: baseDate),
                                            scope: mutation(3, revision: 1, digest: "stale", draftID: draftID),
                                            committedAt: baseDate)
            XCTFail("Expected stale revision")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .staleRevision(expected: 1, actual: 3))
        }
        let persistedDraft = try await store.draft(sessionID: sessionID, id: draftID)
        XCTAssertEqual(persistedDraft.callsign, "K1ABC")
    }

    func testSerialLedgerSurvivesRestartAndNeverRecyclesVoidOrUncertain() async throws {
        let url = databaseURL()
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
        _ = try await create(store!)
        let first = try await store!.reserveSerial(reservationID: fixedUUID(310), serialScope: .band,
                                                   scopeValue: "20M", scope: mutation(2, revision: 1, digest: "r1", draftID: draftID),
                                                   committedAt: baseDate.addingTimeInterval(1))
        XCTAssertEqual(first.reservation.number, 1)
        _ = try await store!.transitionSerial(reservationID: first.reservation.id, to: .uncertain,
                                              scope: mutation(3, revision: 2, digest: "uncertain", draftID: draftID),
                                              committedAt: baseDate.addingTimeInterval(2))
        let replayedReserve = try await store!.reserveSerial(reservationID: first.reservation.id, serialScope: .band,
                                                             scopeValue: "20M",
                                                             scope: mutation(2, revision: 1, digest: "r1", draftID: draftID),
                                                             committedAt: baseDate.addingTimeInterval(200))
        XCTAssertEqual(replayedReserve.reservation.state, .reserved)
        XCTAssertEqual(replayedReserve.reservation.revision, 2)
        store = nil

        let reopened = try SQLiteContestStore(databaseURL: url)
        _ = try await reopened.transitionSerial(reservationID: first.reservation.id, to: .void,
                                                scope: mutation(4, revision: 3, digest: "void-uncertain", draftID: draftID),
                                                committedAt: baseDate.addingTimeInterval(3))
        let second = try await reopened.reserveSerial(reservationID: fixedUUID(311), serialScope: .band,
                                                      scopeValue: "20m", scope: mutation(5, revision: 4, digest: "r2", draftID: draftID),
                                                      committedAt: baseDate.addingTimeInterval(4))
        XCTAssertEqual(second.reservation.number, 2)
        let active = try await reopened.activeReservations(sessionID: sessionID, draftID: draftID)
        XCTAssertEqual(active.map(\.id), [second.reservation.id])
        _ = try await reopened.transitionSerial(reservationID: second.reservation.id, to: .void,
                                                scope: mutation(6, revision: 5, digest: "void", draftID: draftID),
                                                committedAt: baseDate.addingTimeInterval(5))
        let third = try await reopened.reserveSerial(reservationID: fixedUUID(312), serialScope: .band,
                                                     scopeValue: "20m", scope: mutation(7, revision: 6, digest: "r3", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(6))
        XCTAssertEqual(third.reservation.number, 3)
    }

    func testInvalidQSORollsBackReservationAndAggregate() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let reservation = try await store.reserveSerial(reservationID: fixedUUID(320), serialScope: .band,
                                                        scopeValue: "20m", scope: mutation(2, revision: 1, digest: "reserve", draftID: draftID),
                                                        committedAt: baseDate.addingTimeInterval(1))
        let invalid = makeQSO(id: fixedUUID(400), callsign: "BAD", sent: reservation.reservation.transmittedText)
        do {
            _ = try await store.commitQSO(invalid, reservationID: reservation.reservation.id,
                                         scope: mutation(3, revision: 2, digest: "bad", draftID: draftID),
                                         committedAt: baseDate.addingTimeInterval(2))
            XCTFail("Expected invalid QSO")
        } catch let error as ContestStoreError {
            guard case .invalidQSO = error else { return XCTFail("Unexpected error: \(error)") }
        }
        let persistedSession = try await store.openSession(id: sessionID)
        let persistedReservation = try await store.reservation(id: reservation.reservation.id)
        let page = try await store.logPage(sessionID: sessionID, offset: 0, limit: 20)
        XCTAssertEqual(persistedSession.revision, 2)
        XCTAssertEqual(persistedReservation.state, .reserved)
        XCTAssertEqual(page.total, 0)
        _ = try await store.transitionSerial(reservationID: reservation.reservation.id, to: .void,
                                             scope: mutation(4, revision: 2, digest: "void", draftID: draftID),
                                             committedAt: baseDate.addingTimeInterval(3))
        let next = try await store.reserveSerial(reservationID: fixedUUID(321), serialScope: .band,
                                                 scopeValue: "20m", scope: mutation(5, revision: 3, digest: "next", draftID: draftID),
                                                 committedAt: baseDate.addingTimeInterval(4))
        XCTAssertEqual(next.reservation.number, 2)
    }

    func testCommitReservationLogAndScoreSurviveReopen() async throws {
        let url = databaseURL()
        let store = try SQLiteContestStore(databaseURL: url)
        _ = try await create(store)
        let reserved = try await store.reserveSerial(reservationID: fixedUUID(330), serialScope: .band,
                                                     scopeValue: "20m", scope: mutation(2, revision: 1, digest: "reserve", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(1))
        let contact = makeQSO(id: fixedUUID(410), callsign: "K1ABC", sent: reserved.reservation.transmittedText)
        let receipt = try await store.commitQSO(contact, reservationID: reserved.reservation.id,
                                                scope: mutation(3, revision: 2, digest: "commit", draftID: draftID),
                                                committedAt: baseDate.addingTimeInterval(2))
        XCTAssertEqual(receipt.receipt.committedRevision, 3)

        let reopened = try SQLiteContestStore(databaseURL: url)
        let persistedReservation = try await reopened.reservation(id: reserved.reservation.id)
        XCTAssertEqual(persistedReservation.state, .committed)
        let reopenedReceipt = try await reopened.operationReceipt(sessionID: sessionID, workspaceGeneration: generationID,
                                                                  requestID: request(3), payloadDigest: "commit")
        XCTAssertEqual(reopenedReceipt, receipt.receipt)
        let drafts = try await reopened.drafts(sessionID: sessionID)
        XCTAssertEqual(drafts.count, 1)
        XCTAssertEqual(drafts[0].revision, 3)
        XCTAssertEqual(drafts[0].callsign, "")
        XCTAssertEqual(drafts[0].exchange.normalizedSent, "")
        let page = try await reopened.logPage(sessionID: sessionID, offset: 0, limit: 20)
        XCTAssertEqual(page.revision, 3)
        XCTAssertEqual(page.qsos, [contact])
        let score = try await reopened.scoreSnapshot(sessionID: sessionID)
        XCTAssertEqual(score.revision, 3)
        XCTAssertEqual(score.score.totalPoints, 3)
        XCTAssertEqual(score.score.claimedScore, 3)
        let recoveredQSO = try await reopened.qso(sessionID: sessionID, id: contact.id)
        XCTAssertEqual(recoveredQSO, contact)
        let reservationHistory = try await reopened.reservations(sessionID: sessionID, draftID: draftID)
        XCTAssertEqual(reservationHistory.map(\.state), [.committed])
        do {
            _ = try await reopened.commitQSO(makeQSO(id: fixedUUID(411), callsign: "DL1AAA", sent: "001"),
                                             reservationID: reserved.reservation.id,
                                             scope: mutation(4, revision: 3, digest: "reuse", draftID: draftID),
                                             committedAt: baseDate.addingTimeInterval(3))
            XCTFail("Expected committed reservation reuse rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .reservationMismatch)
        }
        let unchanged = try await reopened.openSession(id: sessionID)
        XCTAssertEqual(unchanged.revision, 3)
        let later = try await reopened.reserveSerial(reservationID: fixedUUID(331), serialScope: .band,
                                                     scopeValue: "20m", scope: mutation(5, revision: 3, digest: "later", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(4))
        XCTAssertEqual(later.session.revision, 4)
        let replayedCommit = try await reopened.commitQSO(contact, reservationID: reserved.reservation.id,
                                                          scope: mutation(3, revision: 2, digest: "commit", draftID: draftID),
                                                          committedAt: baseDate.addingTimeInterval(500))
        XCTAssertEqual(replayedCommit.session.revision, 3)
        XCTAssertEqual(replayedCommit.draft.revision, 3)
        XCTAssertEqual(replayedCommit.qsoCount, 1)
        XCTAssertEqual(replayedCommit.receipt, receipt.receipt)
        XCTAssertEqual(replayedCommit, receipt)
    }

    func testConcurrentWritersSerializeAllocationWithoutDuplicate() async throws {
        let url = databaseURL()
        let creator = try SQLiteContestStore(databaseURL: url)
        _ = try await create(creator)
        let firstStore = try SQLiteContestStore(databaseURL: url)
        let secondStore = try SQLiteContestStore(databaseURL: url)

        let results = await withTaskGroup(of: Result<ContestSerialReservationResult, Error>.self) { group in
            group.addTask {
                do { return .success(try await firstStore.reserveSerial(reservationID: self.fixedUUID(340), serialScope: .session,
                                                                       scopeValue: "", scope: self.mutation(2, revision: 1, digest: "a", draftID: self.draftID),
                                                                       committedAt: self.baseDate.addingTimeInterval(1))) }
                catch { return .failure(error) }
            }
            group.addTask {
                do { return .success(try await secondStore.reserveSerial(reservationID: self.fixedUUID(341), serialScope: .session,
                                                                        scopeValue: "", scope: self.mutation(3, revision: 1, digest: "b", draftID: self.draftID),
                                                                        committedAt: self.baseDate.addingTimeInterval(1))) }
                catch { return .failure(error) }
            }
            return await group.reduce(into: []) { $0.append($1) }
        }
        XCTAssertEqual(results.filter { if case .success = $0 { true } else { false } }.count, 1)
        XCTAssertEqual(results.filter { if case .failure(let error as ContestRepositoryError) = $0,
                                           case .staleRevision = error { true } else { false } }.count, 1)
        let winner = try XCTUnwrap(results.compactMap { result -> ContestSerialReservationResult? in
            if case .success(let value) = result { return value }
            return nil
        }.first)
        _ = try await creator.transitionSerial(reservationID: winner.reservation.id, to: .void,
                                               scope: mutation(4, revision: 2, digest: "void", draftID: draftID),
                                               committedAt: baseDate.addingTimeInterval(2))
        let next = try await creator.reserveSerial(reservationID: fixedUUID(342), serialScope: .session,
                                                   scopeValue: "", scope: mutation(5, revision: 3, digest: "c", draftID: draftID),
                                                   committedAt: baseDate.addingTimeInterval(3))
        XCTAssertEqual(next.reservation.number, 2)
    }

    func testLogOrderingUsesTimestampThenID() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let laterID = fixedUUID(501)
        let earlierID = fixedUUID(500)
        let firstSerial = try await store.reserveSerial(reservationID: fixedUUID(502), serialScope: .session,
                                                        scopeValue: "", scope: mutation(2, revision: 1, digest: "r1", draftID: draftID),
                                                        committedAt: baseDate.addingTimeInterval(1))
        _ = try await store.commitQSO(makeQSO(id: laterID, callsign: "K1ABC", sent: firstSerial.reservation.transmittedText),
                                      reservationID: firstSerial.reservation.id,
                                      scope: mutation(3, revision: 2, digest: "q1", draftID: draftID),
                                      committedAt: baseDate.addingTimeInterval(2))
        let secondSerial = try await store.reserveSerial(reservationID: fixedUUID(503), serialScope: .session,
                                                         scopeValue: "", scope: mutation(4, revision: 3, digest: "r2", draftID: draftID),
                                                         committedAt: baseDate.addingTimeInterval(3))
        _ = try await store.commitQSO(makeQSO(id: earlierID, callsign: "DL1AAA", sent: secondSerial.reservation.transmittedText),
                                      reservationID: secondSerial.reservation.id,
                                      scope: mutation(5, revision: 4, digest: "q2", draftID: draftID),
                                      committedAt: baseDate.addingTimeInterval(4))
        let page = try await store.logPage(sessionID: sessionID, offset: 0, limit: 20)
        XCTAssertEqual(page.qsos.map(\.id), [earlierID, laterID])
    }

    func testCreateRejectsUnpinnedRuleAndReferenceIdentity() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        let unknown = ContestRuleIdentity(id: "unknown", version: "1", edition: "x", sourceRevision: "x")
        do {
            _ = try await store.createSession(makeSession(rule: unknown), metadata: makeMetadata(),
                                              initialDraft: makeDraft(revision: 1),
                                              scope: mutation(1, revision: 0, digest: "create", draftID: draftID),
                                              committedAt: baseDate)
            XCTFail("Expected unknown rule rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .unknownRule(unknown))
        }
    }

    func testWPXCommitWithoutReservationRollsBackCompletely() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let scope = mutation(2, revision: 1, digest: "no-serial", draftID: draftID)
        do {
            _ = try await store.commitQSO(makeQSO(id: fixedUUID(520), callsign: "K1ABC", sent: "001"),
                                          reservationID: nil, scope: scope,
                                          committedAt: baseDate.addingTimeInterval(1))
            XCTFail("Expected serial reservation requirement")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .reservationMismatch)
        }
        let unchanged = try await store.openSession(id: sessionID)
        let missingReceipt = try await store.operationReceipt(sessionID: sessionID, workspaceGeneration: generationID,
                                                              requestID: scope.requestID, payloadDigest: scope.payloadDigest)
        XCTAssertEqual(unchanged.revision, 1)
        XCTAssertNil(missingReceipt)
        let first = try await store.reserveSerial(reservationID: fixedUUID(521), serialScope: .session,
                                                  scopeValue: "", scope: mutation(3, revision: 1, digest: "first", draftID: draftID),
                                                  committedAt: baseDate.addingTimeInterval(2))
        XCTAssertEqual(first.reservation.number, 1)
    }

    func testWWCommitDoesNotRequireSerialReservation() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        let session = makeSession(rule: CQWWCWRule.identity, sentExchange: "15")
        _ = try await store.createSession(session, metadata: makeMetadata(), initialDraft: makeDraft(revision: 1),
                                          scope: mutation(1, revision: 0, digest: "ww-create", draftID: draftID),
                                          committedAt: baseDate)
        let result = try await store.commitQSO(makeQSO(id: fixedUUID(525), callsign: "K1ABC", sent: "15", received: "5"),
                                               reservationID: nil,
                                               scope: mutation(2, revision: 1, digest: "ww-qso", draftID: draftID),
                                               committedAt: baseDate.addingTimeInterval(1))
        XCTAssertEqual(result.session.revision, 2)
        XCTAssertEqual(result.qsoCount, 1)
    }

    func testSerialTransitionRequiresExactDraftAndCannotCommitDirectly() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let reserved = try await store.reserveSerial(reservationID: fixedUUID(530), serialScope: .session,
                                                     scopeValue: "", scope: mutation(2, revision: 1, digest: "reserve", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(1))
        let invalidScopes = [
            mutation(3, revision: 2, digest: "nil", draftID: nil),
            mutation(4, revision: 2, digest: "wrong", draftID: fixedUUID(999)),
        ]
        for invalidScope in invalidScopes {
            do {
                _ = try await store.transitionSerial(reservationID: reserved.reservation.id, to: .void,
                                                     scope: invalidScope, committedAt: baseDate.addingTimeInterval(2))
                XCTFail("Expected draft-bound transition rejection")
            } catch let error as ContestRepositoryError {
                XCTAssertEqual(error, .invalidSerialTransition)
            }
        }
        do {
            _ = try await store.transitionSerial(reservationID: reserved.reservation.id, to: .committed,
                                                 scope: mutation(5, revision: 2, digest: "direct", draftID: draftID),
                                                 committedAt: baseDate.addingTimeInterval(2))
            XCTFail("Expected direct committed transition rejection")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidSerialTransition)
        }
        let unchanged = try await store.openSession(id: sessionID)
        let persisted = try await store.reservation(id: reserved.reservation.id)
        let draft = try await store.draft(sessionID: sessionID, id: draftID)
        XCTAssertEqual(unchanged.revision, 2)
        XCTAssertEqual(draft.revision, 2)
        XCTAssertEqual(persisted.state, .reserved)
    }

    func testStructuralValidationRollsBackInvalidCreateAndUpdate() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        let invalidSession = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generationID, rule: CQWPXCWRule.identity,
            referenceDataVersion: "cty", startedAt: baseDate,
            station: ContestStationSnapshot(callsign: "", entity: om, sentExchange: "001",
                                            operatorCallsigns: ["OM0RX"], location: "JN98")
        )
        do {
            _ = try await store.createSession(invalidSession, metadata: makeMetadata(), initialDraft: makeDraft(revision: 1),
                                              scope: mutation(1, revision: 0, digest: "bad-session", draftID: draftID),
                                              committedAt: baseDate)
            XCTFail("Expected invalid session")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }
        let afterInvalidCreate = try await store.listStoredSessions()
        XCTAssertTrue(afterInvalidCreate.isEmpty)

        do {
            _ = try await store.createSession(makeSession(), metadata: makeMetadata(),
                                              initialDraft: makeDraft(revision: 1, mode: "SSB"),
                                              scope: mutation(2, revision: 0, digest: "bad-draft", draftID: draftID),
                                              committedAt: baseDate)
            XCTFail("Expected unsupported draft mode")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidDraft)
        }
        _ = try await store.createSession(makeSession(), metadata: makeMetadata(), initialDraft: makeDraft(revision: 1),
                                          scope: mutation(3, revision: 0, digest: "good", draftID: draftID), committedAt: baseDate)
        do {
            _ = try await store.updateDraft(makeDraft(revision: 2, callsign: String(repeating: "A", count: 40), frequencyHz: -1),
                                            scope: mutation(4, revision: 1, digest: "bad-update", draftID: draftID),
                                            committedAt: baseDate.addingTimeInterval(1))
            XCTFail("Expected invalid draft update")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidDraft)
        }
        let unchanged = try await store.openSession(id: sessionID)
        XCTAssertEqual(unchanged.revision, 1)
    }

    func testConcurrentFirstOpenAndFailedMigrationRollback() async throws {
        let url = databaseURL()
        let opened = await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<2 {
                group.addTask { (try? SQLiteContestStore(databaseURL: url)) != nil }
            }
            return await group.reduce(into: []) { $0.append($1) }
        }
        XCTAssertEqual(opened, [true, true])

        let brokenURL = databaseURL()
        try rawExecute("CREATE TABLE sessions(id TEXT PRIMARY KEY)", at: brokenURL)
        XCTAssertThrowsError(try SQLiteContestStore(databaseURL: brokenURL))
        XCTAssertEqual(try rawScalar("PRAGMA user_version", at: brokenURL), 0)
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='drafts'", at: brokenURL), 0)
    }

    func testCompositeReadsUseOneSQLiteSnapshotAcrossWriter() async throws {
        let url = databaseURL()
        let reader = try SQLiteContestStore(databaseURL: url)
        _ = try await create(reader)
        let firstSerial = try await reader.reserveSerial(reservationID: fixedUUID(540), serialScope: .session,
                                                         scopeValue: "", scope: mutation(2, revision: 1, digest: "r1", draftID: draftID),
                                                         committedAt: baseDate.addingTimeInterval(1))
        _ = try await reader.commitQSO(makeQSO(id: fixedUUID(541), callsign: "K1ABC", sent: firstSerial.reservation.transmittedText),
                                       reservationID: firstSerial.reservation.id,
                                       scope: mutation(3, revision: 2, digest: "q1", draftID: draftID),
                                       committedAt: baseDate.addingTimeInterval(2))
        let writer = try SQLiteContestStore(databaseURL: url)
        let start = AsyncGate()
        await reader.installReadSnapshotHookForTesting {
            Task { await start.open() }
            Thread.sleep(forTimeInterval: 0.15)
        }
        let writing = Task {
            await start.wait()
            let serial = try await writer.reserveSerial(reservationID: self.fixedUUID(542), serialScope: .session,
                                                        scopeValue: "", scope: self.mutation(4, revision: 3, digest: "r2", draftID: self.draftID),
                                                        committedAt: self.baseDate.addingTimeInterval(3))
            return try await writer.commitQSO(self.makeQSO(id: self.fixedUUID(543), callsign: "DL1AAA", sent: serial.reservation.transmittedText),
                                              reservationID: serial.reservation.id,
                                              scope: self.mutation(5, revision: 4, digest: "q2", draftID: self.draftID),
                                              committedAt: self.baseDate.addingTimeInterval(4))
        }
        let page = try await reader.logPage(sessionID: sessionID, offset: 0, limit: 20)
        _ = try await writing.value
        XCTAssertEqual(page.revision, 3)
        XCTAssertEqual(page.total, 1)
        XCTAssertEqual(page.qsos.count, 1)

        let scoreStart = AsyncGate()
        await reader.installReadSnapshotHookForTesting {
            Task { await scoreStart.open() }
            Thread.sleep(forTimeInterval: 0.15)
        }
        let scoreWriting = Task {
            await scoreStart.wait()
            let serial = try await writer.reserveSerial(reservationID: self.fixedUUID(544), serialScope: .session,
                                                        scopeValue: "", scope: self.mutation(6, revision: 5, digest: "r3", draftID: self.draftID),
                                                        committedAt: self.baseDate.addingTimeInterval(5))
            return try await writer.commitQSO(self.makeQSO(id: self.fixedUUID(545), callsign: "VE1AAA", sent: serial.reservation.transmittedText),
                                              reservationID: serial.reservation.id,
                                              scope: self.mutation(7, revision: 6, digest: "q3", draftID: self.draftID),
                                              committedAt: self.baseDate.addingTimeInterval(6))
        }
        let score = try await reader.scoreSnapshot(sessionID: sessionID)
        _ = try await scoreWriting.value
        XCTAssertEqual(score.revision, 5)
        XCTAssertEqual(score.score.qsos.count, 2)
        await reader.installReadSnapshotHookForTesting(nil)
    }

    func testWorkspaceGenerationPreservesAllUUIDBitsAndSchemaFailsClosed() async throws {
        let url = databaseURL()
        let store = try SQLiteContestStore(databaseURL: url)
        let created = try await create(store)
        XCTAssertEqual(created.session.session.workspaceGeneration, generationID)
        XCTAssertEqual(try rawScalar("SELECT typeof(generation) = 'text' FROM sessions", at: url), 1)
        let reopenedGeneration = try await store.openSession(id: sessionID).session.workspaceGeneration
        XCTAssertEqual(reopenedGeneration, generationID)

        let sameHighHalf = UUID(uuidString: "ffffffff-ffff-ffff-8000-000000000008")!
        XCTAssertNotEqual(generationID, sameHighHalf)
        do {
            _ = try await store.operationReceipt(sessionID: sessionID, workspaceGeneration: sameHighHalf,
                                                 requestID: request(1), payloadDigest: "create")
            XCTFail("Expected exact full-UUID generation mismatch")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .staleWorkspaceGeneration)
        }

        let unsupported = databaseURL()
        try rawExecute("PRAGMA user_version = 99", at: unsupported)
        XCTAssertThrowsError(try SQLiteContestStore(databaseURL: unsupported)) { error in
            XCTAssertEqual(error as? ContestStoreError, .unsupportedSchema(99))
        }
        XCTAssertEqual(try rawScalar("PRAGMA user_version", at: unsupported), 99)
        try FileManager.default.removeItem(at: unsupported)
        XCTAssertNoThrow(try SQLiteContestStore(databaseURL: unsupported))
    }

    func testReservedDraftAllowsContactEditsButRejectsSerialOrScopeChanges() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let reserved = try await store.reserveSerial(reservationID: fixedUUID(560), serialScope: .band,
                                                     scopeValue: "20m",
                                                     scope: mutation(2, revision: 1, digest: "reserve", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(1))
        XCTAssertEqual(reserved.draft.exchange.normalizedSent, "001")

        let safe = makeDraft(revision: 3, callsign: "K1", updatedAt: baseDate.addingTimeInterval(2),
                             sent: "001", received: "123")
        let updated = try await store.updateDraft(safe,
                                                  scope: mutation(3, revision: 2, digest: "safe-edit", draftID: draftID),
                                                  committedAt: baseDate.addingTimeInterval(2))
        XCTAssertEqual(updated.projection.activeReservations.first?.revision, 3)
        XCTAssertEqual(updated.projection.activeReservations.first?.transmittedText, "001")
        XCTAssertEqual(updated.projection.draft.callsign, "K1")

        let changedSerial = makeDraft(revision: 4, callsign: "K1ABC", updatedAt: baseDate.addingTimeInterval(3),
                                      sent: "002", received: "124")
        do {
            _ = try await store.updateDraft(changedSerial,
                                            scope: mutation(4, revision: 3, digest: "serial-change", draftID: draftID),
                                            committedAt: baseDate.addingTimeInterval(3))
            XCTFail("Expected reserved serial change rejection")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidSerialTransition)
        }
        let afterRejectedEdit = try await store.openSession(id: sessionID)
        let retainedReservation = try await store.reservation(id: reserved.reservation.id)
        XCTAssertEqual(afterRejectedEdit.revision, 3)
        XCTAssertEqual(retainedReservation.revision, 3)
    }

    func testWWSerialReservationRejectedBeforeCounterMutation() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await store.createSession(makeSession(rule: CQWWCWRule.identity, sentExchange: "15"),
                                          metadata: makeMetadata(), initialDraft: makeDraft(revision: 1),
                                          scope: mutation(1, revision: 0, digest: "create-ww", draftID: draftID),
                                          committedAt: baseDate)
        do {
            _ = try await store.reserveSerial(reservationID: fixedUUID(561), serialScope: .session,
                                              scopeValue: "", scope: mutation(2, revision: 1, digest: "no-serial", draftID: draftID),
                                              committedAt: baseDate.addingTimeInterval(1))
            XCTFail("Expected non-serial rule rejection")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidSerialTransition)
        }
        let afterRejectedReserve = try await store.openSession(id: sessionID)
        let reservations = try await store.reservations(sessionID: sessionID, draftID: draftID)
        XCTAssertEqual(afterRejectedReserve.revision, 1)
        XCTAssertTrue(reservations.isEmpty)
    }

    func testSessionSerialAllowsIncompleteBandChangeThenValidCommit() async throws {
        let url = databaseURL()
        let store = try SQLiteContestStore(databaseURL: url)
        _ = try await create(store)
        let reserved = try await store.reserveSerial(reservationID: fixedUUID(570), serialScope: .session,
                                                     scopeValue: "",
                                                     scope: mutation(2, revision: 1, digest: "reserve-session", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(1))
        let incomplete = makeDraft(revision: 3, callsign: "K1ABC", updatedAt: baseDate.addingTimeInterval(2),
                                   frequencyHz: 14_025_000, sent: "001", received: "101", band: "40m")
        let saved = try await store.updateDraft(incomplete,
                                                scope: mutation(3, revision: 2, digest: "band-first", draftID: draftID),
                                                committedAt: baseDate.addingTimeInterval(2))
        XCTAssertTrue(saved.projection.draftEvaluation.validation.contains { $0.code == "frequency_band_mismatch" })

        let reopened = try SQLiteContestStore(databaseURL: url)
        let reopenedDraft = try await reopened.draft(sessionID: sessionID, id: draftID)
        XCTAssertEqual(reopenedDraft.band, "40m")
        let corrected = makeDraft(revision: 4, callsign: "K1ABC", updatedAt: baseDate.addingTimeInterval(3),
                                  frequencyHz: 7_025_000, sent: "001", received: "101", band: "40m")
        let correctedResult = try await reopened.updateDraft(corrected,
                                                             scope: mutation(4, revision: 3, digest: "frequency-second", draftID: draftID),
                                                             committedAt: baseDate.addingTimeInterval(3))
        XCTAssertFalse(correctedResult.projection.draftEvaluation.validation.contains { $0.code == "frequency_band_mismatch" })
        let contact = makeQSO(id: fixedUUID(571), callsign: "K1ABC", sent: "001",
                              band: "40m", frequencyHz: 7_025_000)
        let committed = try await reopened.commitQSO(contact, reservationID: reserved.reservation.id,
                                                     scope: mutation(5, revision: 4, digest: "commit-40m", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(4))
        XCTAssertEqual(committed.qsoCount, 1)
    }

    func testWWDraftResetPreservesPinnedZoneAcrossSuccessiveContacts() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await store.createSession(makeSession(rule: CQWWCWRule.identity, sentExchange: "15"),
                                          metadata: makeMetadata(),
                                          initialDraft: makeDraft(revision: 1, sent: "15"),
                                          scope: mutation(1, revision: 0, digest: "ww-create-two", draftID: draftID),
                                          committedAt: baseDate)
        _ = try await store.commitQSO(makeQSO(id: fixedUUID(572), callsign: "K1ABC", sent: "15", received: "5"),
                                      reservationID: nil,
                                      scope: mutation(2, revision: 1, digest: "ww-first", draftID: draftID),
                                      committedAt: baseDate.addingTimeInterval(1))
        let reset = try await store.draft(sessionID: sessionID, id: draftID)
        XCTAssertEqual(reset.exchange.normalizedSent, "15")
        let secondDraft = makeDraft(revision: 3, callsign: "JA1AAA", updatedAt: baseDate.addingTimeInterval(2),
                                    frequencyHz: 7_025_000, sent: "15", received: "25", band: "40m")
        _ = try await store.updateDraft(secondDraft,
                                        scope: mutation(3, revision: 2, digest: "ww-second-draft", draftID: draftID),
                                        committedAt: baseDate.addingTimeInterval(2))
        let second = makeQSO(id: fixedUUID(573), callsign: "JA1AAA", sent: "15", received: "25",
                             band: "40m", frequencyHz: 7_025_000)
        let result = try await store.commitQSO(second, reservationID: nil,
                                               scope: mutation(4, revision: 3, digest: "ww-second", draftID: draftID),
                                               committedAt: baseDate.addingTimeInterval(3))
        XCTAssertEqual(result.qsoCount, 2)
        XCTAssertEqual(result.draft.exchange.normalizedSent, "15")
    }

    func testReplayComparesCanonicalPayloadBeforeDecodingTypedResult() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let reserved = try await store.reserveSerial(reservationID: fixedUUID(574), serialScope: .session,
                                                     scopeValue: "", scope: mutation(2, revision: 1, digest: "shared", draftID: draftID),
                                                     committedAt: baseDate.addingTimeInterval(1))
        do {
            _ = try await store.commitQSO(makeQSO(id: fixedUUID(575), callsign: "K1ABC", sent: "001"),
                                          reservationID: reserved.reservation.id,
                                          scope: mutation(2, revision: 1, digest: "shared", draftID: draftID),
                                          committedAt: baseDate.addingTimeInterval(2))
            XCTFail("Expected cross-operation request conflict")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .requestPayloadConflict(requestID: request(2)))
        }
        let otherGeneration = UUID(uuidString: "ffffffff-ffff-ffff-8000-000000000008")!
        let changedScope = ContestMutationScope(sessionID: sessionID, workspaceGeneration: otherGeneration,
                                                requestID: request(2), expectedRevision: 99,
                                                draftID: draftID, payloadDigest: "shared")
        do {
            _ = try await store.reserveSerial(reservationID: fixedUUID(574), serialScope: .session,
                                              scopeValue: "", scope: changedScope,
                                              committedAt: baseDate.addingTimeInterval(3))
            XCTFail("Expected changed generation/revision conflict")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .requestPayloadConflict(requestID: request(2)))
        }
    }

    func testDurableMutationResultStaysBoundedAcrossDistinctMultipliersAndReplaysExactly() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store)
        let calls = ["K1AAA", "DL1AAA", "JA1AAA", "VK1AAA", "ZS1AAA", "PY1AAA",
                     "VE1AAA", "G1AAA", "F1AAA", "I1AAA", "EA1AAA", "SM1AAA"]
        var revision: UInt64 = 1
        var finalResult: ContestQSOCommitResult?
        var finalQSO: ContestQSO?
        var finalReservation: ContestSerialReservation?
        var finalCommitScope: ContestMutationScope?
        for (index, call) in calls.enumerated() {
            let reserveRequest = 600 + index * 2
            let reserve = try await store.reserveSerial(reservationID: fixedUUID(700 + index), serialScope: .session,
                                                        scopeValue: "",
                                                        scope: mutation(reserveRequest, revision: revision,
                                                                        digest: "reserve-\(index)", draftID: draftID),
                                                        committedAt: baseDate.addingTimeInterval(Double(reserveRequest)))
            revision += 1
            let qso = makeQSO(id: fixedUUID(800 + index), callsign: call,
                              sent: reserve.reservation.transmittedText)
            let commitScope = mutation(reserveRequest + 1, revision: revision,
                                       digest: "commit-\(index)", draftID: draftID)
            let committed = try await store.commitQSO(qso, reservationID: reserve.reservation.id,
                                                      scope: commitScope,
                                                      committedAt: baseDate.addingTimeInterval(Double(reserveRequest + 1)))
            revision += 1
            finalResult = committed
            finalQSO = qso
            finalReservation = reserve.reservation
            finalCommitScope = commitScope
        }
        let result = try XCTUnwrap(finalResult)
        let encoded = try JSONEncoder().encode(result)
        XCTAssertLessThan(encoded.count, 20_000)
        XCTAssertNil(String(data: encoded, encoding: .utf8)?.range(of: "multiplierLabels"))

        _ = try await store.reserveSerial(reservationID: fixedUUID(900), serialScope: .session,
                                          scopeValue: "", scope: mutation(900, revision: revision,
                                                                          digest: "later", draftID: draftID),
                                          committedAt: baseDate.addingTimeInterval(900))
        let replay = try await store.commitQSO(try XCTUnwrap(finalQSO),
                                               reservationID: try XCTUnwrap(finalReservation).id,
                                               scope: try XCTUnwrap(finalCommitScope),
                                               committedAt: baseDate.addingTimeInterval(999))
        XCTAssertEqual(replay, result)
    }

    func testExplicitFileURLRequired() {
        XCTAssertThrowsError(try SQLiteContestStore(databaseURL: URL(string: "https://example.invalid/contest.sqlite")!))
        XCTAssertThrowsError(try SQLiteContestStore(databaseURL: databaseURL().deletingLastPathComponent().appendingPathComponent("missing/contest.sqlite")))
    }

    private func create(_ store: SQLiteContestStore) async throws -> ContestSessionCreationResult {
        try await store.createSession(makeSession(), metadata: makeMetadata(),
                                      initialDraft: makeDraft(revision: 1),
                                      scope: mutation(1, revision: 0, digest: "create", draftID: draftID), committedAt: baseDate)
    }

    private func makeSession(rule: ContestRuleIdentity = CQWPXCWRule.identity,
                             sentExchange: String = "001") -> ContestSessionSnapshot {
        ContestSessionSnapshot(id: sessionID, workspaceGeneration: generationID, rule: rule,
                               referenceDataVersion: "cty-2026-10-17", startedAt: baseDate,
                               station: ContestStationSnapshot(callsign: "OM0RX", entity: om, sentExchange: sentExchange,
                                                               operatorCallsigns: ["OM0RX"], location: "JN98"))
    }

    private func makeMetadata() -> ContestSessionMetadata {
        ContestSessionMetadata(name: "WPX test", operatorCallsign: "OM0RX", operatorCategory: "single-op")
    }

    private func makeDraft(revision: UInt64, callsign: String = "", updatedAt: Date? = nil,
                           mode: String = "CW", frequencyHz: Int64? = 14_025_000,
                           sent: String = "", received: String = "", band: String = "20m") -> ContestDraftSnapshot {
        ContestDraftSnapshot(id: draftID, sessionID: sessionID, revision: revision, updatedAt: updatedAt ?? baseDate,
                             callsign: callsign, band: band, mode: mode, frequencyHz: frequencyHz,
                             rstSent: "599", rstReceived: "599",
                             exchange: ContestExchangeSnapshot(rawSent: sent, normalizedSent: sent,
                                                               rawReceived: received, normalizedReceived: received),
                             entity: nil, operatorCallsign: "OM0RX", stationLocation: "JN98")
    }

    private func makeQSO(id: UUID, callsign: String, sent: String, received: String = "101",
                         band: String = "20m", frequencyHz: Int64 = 14_025_000) -> ContestQSO {
        ContestQSO(id: id, sessionID: sessionID, timestampUTC: baseDate.addingTimeInterval(10), callsign: callsign,
                   band: band, mode: "CW", frequencyHz: frequencyHz, rstSent: "599", rstReceived: "599",
                   exchange: ContestExchangeSnapshot(rawSent: sent, normalizedSent: sent,
                                                     rawReceived: received, normalizedReceived: received),
                   entity: usa, operatorCallsign: "OM0RX", stationLocation: "JN98",
                   provenance: ContestQSOProvenance(source: .operatorEntry))
    }

    private func mutation(_ number: Int, revision: UInt64, digest: String, draftID: UUID?) -> ContestMutationScope {
        ContestMutationScope(sessionID: sessionID, workspaceGeneration: generationID, requestID: request(number),
                             expectedRevision: revision, draftID: draftID, payloadDigest: digest)
    }

    private func request(_ number: Int) -> UUID { fixedUUID(1_000 + number) }
    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!
    }
    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xcontest-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }

    private func rawExecute(_ sql: String, at url: URL) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK, let handle else { throw ContestStoreError.database("raw open") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(handle)))
        }
    }

    private func rawScalar(_ sql: String, at url: URL) throws -> Int {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK, let handle else { throw ContestStoreError.database("raw open") }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw ContestStoreError.database("raw scalar") }
        return Int(sqlite3_column_int64(statement, 0))
    }
}

private actor AsyncGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuation in waiters.append(continuation) }
    }

    func open() {
        isOpen = true
        let continuations = waiters
        waiters.removeAll()
        continuations.forEach { $0.resume() }
    }
}
