import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestNAQPStoreTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_200_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testThreeModesDraftCommitReplayAndRestartWithoutSerialReservation() async throws {
        let cases: [(any ContestRule, String, Int64)] = [
            (NAQPCWRule(), "CW", 14_050_000),
            (NAQPSSBRule(), "SSB", 14_250_000),
            (NAQPRTTYRule(), "RTTY", 14_080_000),
        ]
        for (offset, item) in cases.enumerated() {
            let ids = IDs(offset)
            let url = databaseURL()
            var store: SQLiteContestStore? = try makeStore(url)
            let created = try await create(store!, ids: ids, rule: item.0)
            XCTAssertEqual(created.projection.draftEvaluation.isDuplicate, nil)
            let populated = draft(ids: ids, revision: 2, mode: item.1, frequency: item.2,
                                  call: "VE3AAA", entity: canada, receivedName: "SAM", receivedLocation: "ON")
            let updated = try await store!.updateDraft(
                populated, scope: mutation(ids, request: 2, revision: 1, digest: "draft"),
                committedAt: date.addingTimeInterval(1))
            XCTAssertTrue(updated.projection.draftEvaluation.validation.isEmpty)
            let contact = qso(ids: ids, id: fixedUUID(100 + offset), mode: item.1,
                              frequency: item.2, receivedName: "SAM", receivedLocation: "ON")
            let scope = mutation(ids, request: 3, revision: 2, digest: "commit")
            let committed = try await store!.commitQSO(
                contact, reservationID: nil, scope: scope, committedAt: date.addingTimeInterval(2))
            XCTAssertEqual(committed.committedEvaluation.disposition, .accepted)
            XCTAssertEqual(committed.score.claimedScore, 1)
            XCTAssertEqual(committed.draft.exchange.sentFields, stationFields())
            XCTAssertTrue(committed.draft.exchange.receivedFields.isEmpty)
            store = nil

            let reopened = try makeStore(url)
            let replay = try await reopened.commitQSO(
                contact, reservationID: nil, scope: scope, committedAt: date.addingTimeInterval(99))
            XCTAssertEqual(replay, committed)
            let reopenedScore = try await reopened.scoreSnapshot(sessionID: ids.session)
            let reservations = try await reopened.reservations(sessionID: ids.session, draftID: ids.draft)
            XCTAssertEqual(reopenedScore.score.claimedScore, 1)
            XCTAssertTrue(reservations.isEmpty)
        }
    }

    func testCorrectionDeletionRestartAndIdempotentReceipt() async throws {
        let ids = IDs(9)
        let url = databaseURL()
        var store: SQLiteContestStore? = try makeStore(url)
        _ = try await create(store!, ids: ids, rule: NAQPSSBRule())
        let contact = qso(ids: ids, id: fixedUUID(201), mode: "SSB", frequency: 14_250_000,
                          receivedName: "SAM", receivedLocation: "ON")
        let committed = try await store!.commitQSO(
            contact, reservationID: nil,
            scope: mutation(ids, request: 11, revision: 1, digest: "commit"),
            committedAt: date.addingTimeInterval(1))
        let correctedQSO = copy(contact, name: "BOB")
        let correctionScope = mutationWithoutDraft(ids, request: 12, revision: 2, digest: "correct")
        let corrected = try await store!.correctQSO(
            correctedQSO, reason: "Correct received name", operationTimestamp: date.addingTimeInterval(2),
            scope: correctionScope, committedAt: date.addingTimeInterval(2))
        XCTAssertEqual(corrected.score.claimedScore, 1)
        store = nil

        let reopened = try makeStore(url)
        let replay = try await reopened.correctQSO(
            correctedQSO, reason: "Correct received name", operationTimestamp: date.addingTimeInterval(2),
            scope: correctionScope, committedAt: date.addingTimeInterval(99))
        XCTAssertEqual(replay, corrected)
        let deleted = try await reopened.deleteQSO(
            id: contact.id, reason: "Operator deletion", operationTimestamp: date.addingTimeInterval(3),
            scope: mutationWithoutDraft(ids, request: 13, revision: 3, digest: "delete"),
            committedAt: date.addingTimeInterval(3))
        XCTAssertEqual(deleted.score.qsoCount, 0)
        XCTAssertEqual(deleted.score.claimedScore, 0)
        let audit = try await reopened.qsoAuditTrail(sessionID: ids.session, qsoID: committed.qso.id)
        XCTAssertEqual(audit.map(\.operation), [.correction, .deletion])
    }

    func testContradictoryStationExchangeRollsBackCreation() async throws {
        let ids = IDs(20)
        let url = databaseURL()
        let store = try makeStore(url)
        let badSession = session(ids: ids, rule: NAQPCWRule(), stationLocation: "HI")
        do {
            _ = try await store.createSession(
                badSession, metadata: metadata(), initialDraft: emptyDraft(ids: ids, mode: "CW"),
                scope: mutation(ids, request: 1, revision: 0, digest: "bad-create"), committedAt: date)
            XCTFail("Expected contradictory station location rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }
        let sessions = try await store.listStoredSessions()
        XCTAssertTrue(sessions.isEmpty)
        do {
            _ = try await store.operationReceipt(sessionID: ids.session,
                                                 workspaceGeneration: ids.generation,
                                                 requestID: fixedUUID(ids.offset * 100 + 1),
                                                 payloadDigest: "bad-create")
            XCTFail("Expected no durable session or operation receipt")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .notFound)
        }
    }

    func testStructuredStationAggregateUsesDescriptorBoundsWithoutChangingLegacyLimit() async throws {
        let validIDs = IDs(21)
        let validStore = try makeStore(databaseURL())
        let maximumName = String(repeating: "A", count: 32)
        let validSession = session(ids: validIDs, rule: NAQPCWRule(), stationLocation: "CA", stationName: maximumName)
        let created = try await validStore.createSession(
            validSession, metadata: metadata(), initialDraft: emptyDraft(ids: validIDs, mode: "CW", stationName: maximumName),
            scope: mutation(validIDs, request: 1, revision: 0, digest: "max-create"), committedAt: date)
        XCTAssertEqual(created.session.session.station.sentExchange, "\(maximumName) CA")
        XCTAssertEqual(created.session.session.station.sentExchange.utf8.count, 35)

        let invalidIDs = IDs(22)
        let invalidStore = try makeStore(databaseURL())
        let oversizedName = String(repeating: "A", count: 33)
        do {
            _ = try await invalidStore.createSession(
                session(ids: invalidIDs, rule: NAQPCWRule(), stationLocation: "CA", stationName: oversizedName),
                metadata: metadata(), initialDraft: emptyDraft(ids: invalidIDs, mode: "CW", stationName: oversizedName),
                scope: mutation(invalidIDs, request: 1, revision: 0, digest: "overflow-create"), committedAt: date)
            XCTFail("Expected descriptor field limit rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }
    }

    func testSelfContactCommitRollsBackAtomicallyInAllModes() async throws {
        let cases: [(any ContestRule, String, Int64)] = [
            (NAQPCWRule(), "CW", 14_050_000),
            (NAQPSSBRule(), "SSB", 14_250_000),
            (NAQPRTTYRule(), "RTTY", 14_080_000),
        ]
        for (offset, item) in cases.enumerated() {
            let ids = IDs(30 + offset)
            let store = try makeStore(databaseURL())
            _ = try await create(store, ids: ids, rule: item.0)
            let scope = mutation(ids, request: 7, revision: 1, digest: "self-contact")
            let contact = qso(ids: ids, id: fixedUUID(400 + offset), mode: item.1,
                              frequency: item.2, call: "K1AAA",
                              receivedName: "AL", receivedLocation: "CA", entity: usa)
            do {
                _ = try await store.commitQSO(contact, reservationID: nil, scope: scope,
                                              committedAt: date.addingTimeInterval(1))
                XCTFail("Expected self-contact rejection")
            } catch let error as ContestStoreError {
                guard case .invalidQSO(let issues) = error else {
                    return XCTFail("Unexpected error: \(error)")
                }
                XCTAssertTrue(issues.map(\.code).contains("selfContact"))
            }
            let reopened = try await store.openSession(id: ids.session)
            let page = try await store.logPage(sessionID: ids.session, offset: 0, limit: 10)
            let receipt = try await store.operationReceipt(sessionID: ids.session,
                                                           workspaceGeneration: ids.generation,
                                                           requestID: scope.requestID,
                                                           payloadDigest: scope.payloadDigest)
            XCTAssertEqual(reopened.revision, 1)
            XCTAssertEqual(page.total, 0)
            XCTAssertNil(receipt)
        }
    }

    func testPartialDraftDuplicateProjectionIgnoresOnlyBlankReceivedFields() async throws {
        struct Candidate {
            let call: String
            let band: String
            let frequency: Int64
            let name: String
            let location: String
            let sentName: String
            let entity: ContestEntitySnapshot
            let expectedDuplicate: Bool?
        }
        let candidates = [
            Candidate(call: "VE3AAA", band: "20m", frequency: 14_050_000, name: "", location: "", sentName: "AL", entity: canada, expectedDuplicate: true),
            Candidate(call: "VE3BBB", band: "20m", frequency: 14_050_000, name: "", location: "", sentName: "AL", entity: canada, expectedDuplicate: false),
            Candidate(call: "VE3AAA", band: "20m", frequency: 14_050_000, name: "SAM", location: "", sentName: "AL", entity: canada, expectedDuplicate: true),
            Candidate(call: "VE3AAA", band: "20m", frequency: 14_050_000, name: "", location: "ON", sentName: "AL", entity: canada, expectedDuplicate: true),
            Candidate(call: "VE3AAA", band: "20m", frequency: 14_050_000, name: "SAM", location: "CA", sentName: "AL", entity: canada, expectedDuplicate: nil),
            Candidate(call: "DL1ABC", band: "20m", frequency: 14_050_000, name: "", location: "CA", sentName: "AL", entity: germany, expectedDuplicate: nil),
            Candidate(call: "DL1ABC", band: "20m", frequency: 14_050_000, name: "", location: "DX", sentName: "AL", entity: germany, expectedDuplicate: false),
            Candidate(call: "K1ABC/MM", band: "20m", frequency: 14_050_000, name: "", location: "CA", sentName: "AL", entity: usa, expectedDuplicate: nil),
            Candidate(call: "K1ABC/MM", band: "20m", frequency: 14_050_000, name: "", location: "DX", sentName: "AL", entity: usa, expectedDuplicate: false),
            Candidate(call: "VE3AAA", band: "40m", frequency: 7_050_000, name: "", location: "", sentName: "AL", entity: canada, expectedDuplicate: false),
            Candidate(call: "ABC", band: "20m", frequency: 14_050_000, name: "", location: "", sentName: "AL", entity: canada, expectedDuplicate: nil),
            Candidate(call: "VE3AAA", band: "40m", frequency: 14_050_000, name: "", location: "", sentName: "AL", entity: canada, expectedDuplicate: nil),
            Candidate(call: "VE3AAA", band: "20m", frequency: 14_050_000, name: "", location: "", sentName: "BOB", entity: canada, expectedDuplicate: nil),
        ]

        for (index, candidate) in candidates.enumerated() {
            let ids = IDs(50 + index)
            let store = try makeStore(databaseURL())
            _ = try await create(store, ids: ids, rule: NAQPCWRule())
            _ = try await store.commitQSO(
                qso(ids: ids, id: fixedUUID(800 + index), mode: "CW", frequency: 14_050_000,
                    receivedName: "SAM", receivedLocation: "ON"), reservationID: nil,
                scope: mutation(ids, request: 2, revision: 1, digest: "known-contact"),
                committedAt: date.addingTimeInterval(1))
            let updated = try await store.updateDraft(
                draft(ids: ids, revision: 3, mode: "CW", frequency: candidate.frequency,
                      call: candidate.call, entity: candidate.entity, receivedName: candidate.name,
                      receivedLocation: candidate.location, band: candidate.band,
                      sentName: candidate.sentName),
                scope: mutation(ids, request: 3, revision: 2, digest: "partial-dupe"),
                committedAt: date.addingTimeInterval(2))
            XCTAssertEqual(updated.projection.draftEvaluation.isDuplicate, candidate.expectedDuplicate,
                           "Unexpected partial duplicate state for candidate \(index)")
        }

        let deletedIDs = IDs(70)
        let deletedStore = try makeStore(databaseURL())
        _ = try await create(deletedStore, ids: deletedIDs, rule: NAQPCWRule())
        let deletedContact = qso(ids: deletedIDs, id: fixedUUID(900), mode: "CW", frequency: 14_050_000,
                                 receivedName: "SAM", receivedLocation: "ON")
        _ = try await deletedStore.commitQSO(
            deletedContact, reservationID: nil,
            scope: mutation(deletedIDs, request: 2, revision: 1, digest: "deleted-contact"),
            committedAt: date.addingTimeInterval(1))
        _ = try await deletedStore.deleteQSO(
            id: deletedContact.id, reason: "Remove duplicate source", operationTimestamp: date.addingTimeInterval(2),
            scope: mutationWithoutDraft(deletedIDs, request: 3, revision: 2, digest: "delete-contact"),
            committedAt: date.addingTimeInterval(2))
        let afterDeletion = try await deletedStore.updateDraft(
            draft(ids: deletedIDs, revision: 4, mode: "CW", frequency: 14_050_000,
                  call: "VE3AAA", entity: canada, receivedName: "", receivedLocation: ""),
            scope: mutation(deletedIDs, request: 4, revision: 3, digest: "after-delete"),
            committedAt: date.addingTimeInterval(3))
        XCTAssertEqual(afterDeletion.projection.draftEvaluation.isDuplicate, false)
    }

    private func makeStore(_ url: URL) throws -> SQLiteContestStore {
        try SQLiteContestStore(databaseURL: url,
                               rules: ContestRuleRegistry([NAQPCWRule(), NAQPSSBRule(), NAQPRTTYRule()]))
    }

    private func create(_ store: SQLiteContestStore, ids: IDs,
                        rule: any ContestRule) async throws -> ContestSessionCreationResult {
        try await store.createSession(
            session(ids: ids, rule: rule, stationLocation: "CA"), metadata: metadata(),
            initialDraft: emptyDraft(ids: ids, mode: rule.metadata.entry.mode),
            scope: mutation(ids, request: 1, revision: 0, digest: "create"), committedAt: date)
    }

    private func session(ids: IDs, rule: any ContestRule, stationLocation: String,
                         stationName: String = "AL") -> ContestSessionSnapshot {
        ContestSessionSnapshot(
            id: ids.session, workspaceGeneration: ids.generation, rule: rule.metadata.identity,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: "K1AAA", entity: usa, sentExchange: "\(stationName) \(stationLocation)",
                           operatorCallsigns: ["K1AAA"], location: "MA",
                           sentExchangeFields: stationFields(name: stationName, location: stationLocation)))
    }

    private func emptyDraft(ids: IDs, mode: String, stationName: String = "AL") -> ContestDraftSnapshot {
        ContestDraftSnapshot(id: ids.draft, sessionID: ids.session, revision: 1, updatedAt: date,
                             callsign: "", band: "20m", mode: mode, frequencyHz: frequency(mode),
                             rstSent: "", rstReceived: "",
                             exchange: .init(rawSent: "\(stationName) CA", normalizedSent: "\(stationName) CA",
                                             rawReceived: "", normalizedReceived: "",
                                              sentFields: stationFields(name: stationName)),
                             entity: nil, operatorCallsign: "K1AAA", stationLocation: "MA")
    }

    private func draft(ids: IDs, revision: UInt64, mode: String, frequency: Int64,
                       call: String, entity: ContestEntitySnapshot,
                       receivedName: String, receivedLocation: String,
                       band: String = "20m", sentName: String = "AL") -> ContestDraftSnapshot {
        ContestDraftSnapshot(id: ids.draft, sessionID: ids.session, revision: revision,
                             updatedAt: date.addingTimeInterval(1), callsign: call, band: band,
                             mode: mode, frequencyHz: frequency, rstSent: "", rstReceived: "",
                             exchange: exchange(receivedName: receivedName, receivedLocation: receivedLocation,
                                                sentName: sentName),
                             entity: entity, operatorCallsign: "K1AAA", stationLocation: "MA")
    }

    private func qso(ids: IDs, id: UUID, mode: String, frequency: Int64,
                     call: String = "VE3AAA", receivedName: String, receivedLocation: String,
                     entity: ContestEntitySnapshot? = nil) -> ContestQSO {
        ContestQSO(id: id, sessionID: ids.session, timestampUTC: date.addingTimeInterval(10),
                   callsign: call, band: "20m", mode: mode, frequencyHz: frequency,
                   rstSent: "", rstReceived: "",
                   exchange: exchange(receivedName: receivedName, receivedLocation: receivedLocation),
                   entity: entity ?? canada, operatorCallsign: "K1AAA", stationLocation: "MA",
                   provenance: .init(source: .operatorEntry))
    }

    private func copy(_ qso: ContestQSO, name: String) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                   callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
                   rstSent: qso.rstSent, rstReceived: qso.rstReceived,
                   exchange: exchange(receivedName: name, receivedLocation: "ON"),
                   entity: qso.entity, operatorCallsign: qso.operatorCallsign,
                   stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func exchange(receivedName: String, receivedLocation: String,
                          sentName: String = "AL") -> ContestExchangeSnapshot {
        .init(rawSent: "\(sentName) CA", normalizedSent: "\(sentName) CA",
              rawReceived: "\(receivedName) \(receivedLocation)",
              normalizedReceived: "\(receivedName) \(receivedLocation)",
              sentFields: stationFields(name: sentName),
              receivedFields: ["name": .init(raw: receivedName, normalized: receivedName),
                               "location": .init(raw: receivedLocation, normalized: receivedLocation)])
    }

    private func stationFields(name: String = "AL", location: String = "CA") -> [String: ContestExchangeFieldValue] {
        ["name": .init(raw: name, normalized: name),
         "location": .init(raw: location, normalized: location)]
    }
    private func metadata() -> ContestSessionMetadata {
        .init(name: "NAQP test", operatorCallsign: "K1AAA", operatorCategory: "single-op")
    }
    private func frequency(_ mode: String) -> Int64 { mode == "SSB" ? 14_250_000 : mode == "RTTY" ? 14_080_000 : 14_050_000 }

    private func mutation(_ ids: IDs, request: Int, revision: UInt64, digest: String) -> ContestMutationScope {
        ContestMutationScope(sessionID: ids.session, workspaceGeneration: ids.generation,
                             requestID: fixedUUID(ids.offset * 100 + request), expectedRevision: revision,
                             draftID: ids.draft, payloadDigest: digest)
    }
    private func mutationWithoutDraft(_ ids: IDs, request: Int, revision: UInt64,
                                      digest: String) -> ContestMutationScope {
        ContestMutationScope(sessionID: ids.session, workspaceGeneration: ids.generation,
                             requestID: fixedUUID(ids.offset * 100 + request), expectedRevision: revision,
                             draftID: nil, payloadDigest: digest)
    }
    private struct IDs {
        let offset: Int
        let session: UUID
        let draft: UUID
        let generation: UUID
        init(_ offset: Int) {
            self.offset = offset
            session = UUID(uuidString: String(format: "D1000000-0000-0000-0000-%012d", offset + 1))!
            draft = UUID(uuidString: String(format: "D2000000-0000-0000-0000-%012d", offset + 1))!
            generation = UUID(uuidString: String(format: "D3000000-0000-0000-0000-%012d", offset + 1))!
        }
    }
    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "D0000000-0000-0000-0000-%012d", number))!
    }
    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-naqp-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}
