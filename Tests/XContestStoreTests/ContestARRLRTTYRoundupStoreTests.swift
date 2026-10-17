import CSQLitePrototype
import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestARRLRTTYRoundupStoreTests: XCTestCase {
    private let generation = UUID(uuidString: "B3000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_300_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let england = ContestEntitySnapshot(adif: 223, name: "ENGLAND", countryPrefix: "G", continent: "EU", cqZone: 14)
    private let registry = ContestRuleRegistry([ARRLRTTYRoundupRule()])

    func testWVEReservationAndContradictoryStationAreRejectedAtomically() async throws {
        let url = databaseURL()
        let ids = IDs(1)
        let store = try SQLiteContestStore(databaseURL: url, rules: registry)
        _ = try await store.createSession(
            session(ids, entity: usa, call: "K1AAA", location: "CA"),
            metadata: metadata(call: "K1AAA"), initialDraft: draft(ids, revision: 1, call: "VE2AAA",
                                                                    sent: "CA", sentFields: locationFields("CA")),
            scope: mutation(ids, 1, revision: 0, digest: "create", draft: ids.draft), committedAt: date)
        let reserveRequest = requestID(ids, 2)
        do {
            _ = try await store.reserveSerial(
                reservationID: requestID(ids, 20), serialScope: .session, scopeValue: "",
                scope: .init(sessionID: ids.session, workspaceGeneration: generation,
                             requestID: reserveRequest, expectedRevision: 1,
                             draftID: ids.draft, payloadDigest: "reserve"),
                committedAt: date.addingTimeInterval(1))
            XCTFail("Expected W/VE serial reservation to reject")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidSerialTransition)
        }
        let afterRejectedReserve = try await store.openSession(id: ids.session)
        let afterRejectedReservations = try await store.reservations(sessionID: ids.session, draftID: ids.draft)
        let rejectedReserveReceipt = try await store.operationReceipt(
            sessionID: ids.session, workspaceGeneration: generation,
            requestID: reserveRequest, payloadDigest: "reserve")
        XCTAssertEqual(afterRejectedReserve.revision, 1)
        XCTAssertEqual(afterRejectedReservations, [])
        XCTAssertNil(rejectedReserveReceipt)

        let contradictoryDraft = draft(ids, revision: 2, call: "VE2AAA", sent: "NY",
                                       sentFields: locationFields("NY"))
        do {
            _ = try await store.updateDraft(
                contradictoryDraft,
                scope: mutation(ids, 3, revision: 1, digest: "contradictory-edit", draft: ids.draft),
                committedAt: date.addingTimeInterval(2))
            XCTFail("Expected immutable W/VE station location edit to reject")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidDraft)
        }
        let afterContradictoryEdit = try await store.openSession(id: ids.session)
        XCTAssertEqual(afterContradictoryEdit.revision, 1)

        let committed = try await store.commitQSO(
            wveQSO(ids), reservationID: nil,
            scope: mutation(ids, 4, revision: 1, digest: "wve-commit", draft: ids.draft),
            committedAt: date.addingTimeInterval(3))
        XCTAssertEqual(committed.draft.exchange.rawSent, "CA")
        XCTAssertEqual(committed.draft.exchange.normalizedSent, "CA")
        XCTAssertEqual(committed.draft.exchange.sentFields, locationFields("CA"))
        XCTAssertEqual(committed.score.qsoCount, 1)

        let badIDs = IDs(2)
        do {
            _ = try await store.createSession(
                session(badIDs, entity: usa, call: "K1BAD", location: "CA", serial: "001"),
                metadata: metadata(call: "K1BAD"), initialDraft: draft(badIDs, revision: 1, call: "VE2AAA",
                                                                       sent: "CA", sentFields: locationFields("CA"),
                                                                       operatorCallsign: "K1BAD"),
                scope: mutation(badIDs, 1, revision: 0, digest: "bad-create", draft: badIDs.draft), committedAt: date)
            XCTFail("Expected mutually contradictory station fields to reject")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }

        let unknownIDs = IDs(3)
        let fabricated = ContestEntitySnapshot(adif: 999_999, name: "FRANCE-LIKE", countryPrefix: "F",
                                               continent: "EU", cqZone: 14)
        do {
            _ = try await store.createSession(
                session(unknownIDs, entity: fabricated, call: "F9AAA", location: nil),
                metadata: metadata(call: "F9AAA"),
                initialDraft: draft(unknownIDs, revision: 1, call: "K1ABC", sent: "", sentFields: [:],
                                    operatorCallsign: "F9AAA"),
                scope: mutation(unknownIDs, 1, revision: 0, digest: "unknown-create", draft: unknownIDs.draft),
                committedAt: date)
            XCTFail("Expected an entity outside the pinned current DXCC list to reject")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }
        let invalidSectionIDs = IDs(4)
        do {
            _ = try await store.createSession(
                session(invalidSectionIDs, entity: usa, call: "K1SEC", location: "CA", section: "CA"),
                metadata: metadata(call: "K1SEC"),
                initialDraft: draft(invalidSectionIDs, revision: 1, call: "VE2AAA", sent: "CA",
                                    sentFields: locationFields("CA"), operatorCallsign: "K1SEC"),
                scope: mutation(invalidSectionIDs, 1, revision: 0, digest: "invalid-section",
                                draft: invalidSectionIDs.draft), committedAt: date)
            XCTFail("Expected invalid Cabrillo section to reject atomically")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }
        let storedSessions = try await store.listStoredSessions()
        XCTAssertEqual(storedSessions.map(\.session.id), [ids.session])
        XCTAssertEqual(try rawScalarInt(url, "SELECT COUNT(*) FROM operations"), 2)
    }

    func testWVEAggregateResetPreservesAdmittedRawFieldAcrossSequentialContacts() async throws {
        let ids = IDs(5)
        let url = databaseURL()
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
        let fields = ["location": ContestExchangeFieldValue(raw: "ct", normalized: "CT")]
        let admittedSession = session(ids, entity: usa, call: "K1AAA", location: "CT",
                                      locationFieldRaw: "ct")
        let initial = draft(ids, revision: 1, call: "VE2AAA", sent: "CT", sentFields: fields,
                            received: "QC", operatorCallsign: "K1AAA")
        _ = try await store!.createSession(
            admittedSession, metadata: metadata(call: "K1AAA"), initialDraft: initial,
            scope: mutation(ids, 1, revision: 0, digest: "create-raw-field", draft: ids.draft),
            committedAt: date)

        let firstQSO = wveQSO(ids, value: 501, call: "VE2AAA", received: "QC",
                              sent: "CT", sentFields: fields)
        let firstScope = mutation(ids, 2, revision: 1, digest: "first", draft: ids.draft)
        let first = try await store!.commitQSO(
            firstQSO, reservationID: nil, scope: firstScope, committedAt: date.addingTimeInterval(1))
        XCTAssertEqual(first.draft.exchange.rawSent, "CT")
        XCTAssertEqual(first.draft.exchange.normalizedSent, "CT")
        XCTAssertEqual(first.draft.exchange.sentFields, fields)

        let returned = first.draft
        let nextDraft = ContestDraftSnapshot(
            id: returned.id, sessionID: returned.sessionID, revision: 3,
            updatedAt: date.addingTimeInterval(2), callsign: "VE3AAA", band: returned.band,
            mode: returned.mode, frequencyHz: returned.frequencyHz, rstSent: returned.rstSent,
            rstReceived: returned.rstReceived,
            exchange: .init(rawSent: returned.exchange.rawSent,
                            normalizedSent: returned.exchange.normalizedSent,
                            rawReceived: "ON", normalizedReceived: "ON",
                            sentFields: returned.exchange.sentFields,
                            receivedFields: ["exchange": .init(raw: "ON", normalized: "ON")]),
            entity: ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE",
                                          continent: "NA", cqZone: 4),
            operatorCallsign: returned.operatorCallsign, stationLocation: returned.stationLocation)
        _ = try await store!.updateDraft(
            nextDraft, scope: mutation(ids, 3, revision: 2, digest: "next-draft", draft: ids.draft),
            committedAt: date.addingTimeInterval(2))
        let secondQSO = wveQSO(ids, value: 502, call: "VE3AAA", received: "ON",
                               sent: nextDraft.exchange.rawSent, sentFields: nextDraft.exchange.sentFields)
        let secondScope = mutation(ids, 4, revision: 3, digest: "second", draft: ids.draft)
        let second = try await store!.commitQSO(
            secondQSO, reservationID: nil, scope: secondScope, committedAt: date.addingTimeInterval(3))
        XCTAssertEqual(second.draft.exchange.rawSent, "CT")
        XCTAssertEqual(second.draft.exchange.normalizedSent, "CT")
        XCTAssertEqual(second.draft.exchange.sentFields, fields)
        store = nil

        store = try SQLiteContestStore(databaseURL: url, rules: registry)
        let replayedFirst = try await store!.commitQSO(
            firstQSO, reservationID: nil, scope: firstScope, committedAt: date.addingTimeInterval(10))
        let replayedSecond = try await store!.commitQSO(
            secondQSO, reservationID: nil, scope: secondScope, committedAt: date.addingTimeInterval(11))
        let reopenedDraft = try await store!.draft(sessionID: ids.session, id: ids.draft)
        XCTAssertEqual(replayedFirst, first)
        XCTAssertEqual(replayedSecond, second)
        XCTAssertEqual(reopenedDraft.exchange.rawSent, "CT")
        XCTAssertEqual(reopenedDraft.exchange.normalizedSent, "CT")
        XCTAssertEqual(reopenedDraft.exchange.sentFields, fields)
    }

    func testDXReservationForgeryEditCommitRestartReplayAndNonreuse() async throws {
        let url = databaseURL()
        let ids = IDs(10)
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
        _ = try await store!.createSession(
            session(ids, entity: england, call: "G3AAA", location: nil), metadata: metadata(call: "G3AAA"),
            initialDraft: draft(ids, revision: 1, call: "K1ABC", sent: "", sentFields: [:]),
            scope: mutation(ids, 1, revision: 0, digest: "create", draft: ids.draft), committedAt: date)
        let reserveScope = mutation(ids, 2, revision: 1, digest: "reserve", draft: ids.draft)
        let reservationID = requestID(ids, 20)
        let reserved = try await store!.reserveSerial(
            reservationID: reservationID, serialScope: .session, scopeValue: "", scope: reserveScope,
            committedAt: date.addingTimeInterval(1))
        XCTAssertEqual(reserved.reservation.transmittedText, "001")
        XCTAssertEqual(reserved.draft.exchange.rawSent, "001")
        XCTAssertEqual(reserved.draft.exchange.normalizedSent, "001")
        XCTAssertEqual(reserved.draft.exchange.sentFields["serial"], .init(raw: "001", normalized: "001"))

        let forgeries: [ContestQSO] = [
            qso(ids, sentRaw: "999", sentNormalized: "001", fieldRaw: "001", fieldNormalized: "001"),
            qso(ids, sentRaw: "001", sentNormalized: "999", fieldRaw: "001", fieldNormalized: "001"),
            qso(ids, sentRaw: "001", sentNormalized: "001", fieldRaw: "999", fieldNormalized: "001"),
            qso(ids, sentRaw: "001", sentNormalized: "001", fieldRaw: "001", fieldNormalized: "999"),
        ]
        for (index, forged) in forgeries.enumerated() {
            let request = requestID(ids, 30 + index)
            do {
                _ = try await store!.commitQSO(
                    forged, reservationID: reservationID,
                    scope: .init(sessionID: ids.session, workspaceGeneration: generation, requestID: request,
                                 expectedRevision: 2, draftID: ids.draft, payloadDigest: "forged-\(index)"),
                    committedAt: date.addingTimeInterval(Double(2 + index)))
                XCTFail("Expected forged serial to reject")
            } catch {
                XCTAssertTrue(error is ContestStoreError)
            }
            let afterForgery = try await store!.openSession(id: ids.session)
            let forgeryReceipt = try await store!.operationReceipt(
                sessionID: ids.session, workspaceGeneration: generation,
                requestID: request, payloadDigest: "forged-\(index)")
            XCTAssertEqual(afterForgery.revision, 2)
            XCTAssertNil(forgeryReceipt)
        }

        let fabricated = ContestEntitySnapshot(adif: 999_999, name: "FRANCE-LIKE", countryPrefix: "F",
                                               continent: "EU", cqZone: 14)
        let unknownEntityRequest = requestID(ids, 38)
        do {
            _ = try await store!.commitQSO(
                qso(ids, call: "F9ABC", received: "4", entity: fabricated), reservationID: reservationID,
                scope: mutation(ids, 38, revision: 2, digest: "unknown-entity", draft: ids.draft),
                committedAt: date.addingTimeInterval(8))
            XCTFail("Expected a worked entity outside the pinned current DXCC list to reject")
        } catch let error as ContestStoreError {
            guard case .invalidQSO = error else { return XCTFail("Expected invalidQSO, got \(error)") }
        }
        let afterUnknownEntity = try await store!.openSession(id: ids.session)
        let reservedAfterUnknownEntity = try await store!.reservation(id: reservationID)
        let draftAfterUnknownEntity = try await store!.draft(sessionID: ids.session, id: ids.draft)
        let logAfterUnknownEntity = try await store!.logPage(sessionID: ids.session, offset: 0, limit: 10)
        let unknownEntityReceipt = try await store!.operationReceipt(
            sessionID: ids.session, workspaceGeneration: generation,
            requestID: unknownEntityRequest, payloadDigest: "unknown-entity")
        XCTAssertEqual(afterUnknownEntity.revision, 2)
        XCTAssertEqual(reservedAfterUnknownEntity.state, .reserved)
        XCTAssertEqual(draftAfterUnknownEntity.exchange.rawSent, "001")
        XCTAssertEqual(logAfterUnknownEntity.total, 0)
        XCTAssertNil(unknownEntityReceipt)

        let foreignIDs = IDs(11)
        _ = try await store!.createSession(
            session(foreignIDs, entity: england, call: "G3AAA", location: nil), metadata: metadata(call: "G3AAA"),
            initialDraft: draft(foreignIDs, revision: 1, call: "K1ABC", sent: "", sentFields: [:]),
            scope: mutation(foreignIDs, 1, revision: 0, digest: "foreign-create", draft: foreignIDs.draft),
            committedAt: date)
        let foreignReservation = try await store!.reserveSerial(
            reservationID: requestID(foreignIDs, 20), serialScope: .session, scopeValue: "",
            scope: mutation(foreignIDs, 2, revision: 1, digest: "foreign-reserve", draft: foreignIDs.draft),
            committedAt: date.addingTimeInterval(1))
        let foreignRequest = requestID(ids, 39)
        do {
            _ = try await store!.commitQSO(
                qso(ids), reservationID: foreignReservation.reservation.id,
                scope: mutation(ids, 39, revision: 2, digest: "foreign-reservation", draft: ids.draft),
                committedAt: date.addingTimeInterval(9))
            XCTFail("Expected a reservation from another session to reject")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .reservationMismatch)
        }
        let afterForeignReservation = try await store!.openSession(id: ids.session)
        let foreignReceipt = try await store!.operationReceipt(
            sessionID: ids.session, workspaceGeneration: generation,
            requestID: foreignRequest, payloadDigest: "foreign-reservation")
        XCTAssertEqual(afterForeignReservation.revision, 2)
        XCTAssertNil(foreignReceipt)

        let editedDraft = draft(ids, revision: 3, call: "K2ABC", sent: "001",
                                sentFields: ["serial": .init(raw: "001", normalized: "001")],
                                received: "NY")
        let edited = try await store!.updateDraft(
            editedDraft, scope: mutation(ids, 40, revision: 2, digest: "edit", draft: ids.draft),
            committedAt: date.addingTimeInterval(10))
        XCTAssertEqual(edited.draft.exchange.receivedFields["exchange"]?.normalized, "NY")

        let committedQSO = qso(ids, call: "K2ABC", received: "NY")
        let commitScope = mutation(ids, 41, revision: 3, digest: "commit", draft: ids.draft)
        let committed = try await store!.commitQSO(
            committedQSO, reservationID: reservationID, scope: commitScope,
            committedAt: date.addingTimeInterval(11))
        XCTAssertNil(committed.draft.exchange.sentFields["serial"])
        XCTAssertEqual(committed.draft.exchange.rawSent, "")
        let committedReservation = try await store!.reservation(id: reservationID)
        XCTAssertEqual(committedReservation.state, .committed)
        store = nil

        store = try SQLiteContestStore(databaseURL: url, rules: registry)
        let replayedReserve = try await store!.reserveSerial(
            reservationID: reservationID, serialScope: .session, scopeValue: "", scope: reserveScope,
            committedAt: date.addingTimeInterval(100))
        XCTAssertEqual(replayedReserve, reserved)
        let replayedCommit = try await store!.commitQSO(
            committedQSO, reservationID: reservationID, scope: commitScope,
            committedAt: date.addingTimeInterval(101))
        XCTAssertEqual(replayedCommit, committed)
        let next = try await store!.reserveSerial(
            reservationID: requestID(ids, 50), serialScope: .session, scopeValue: "",
            scope: mutation(ids, 50, revision: 4, digest: "next", draft: ids.draft),
            committedAt: date.addingTimeInterval(12))
        XCTAssertEqual(next.reservation.transmittedText, "002")
    }

    func testDXSerialCapacityFailurePrecedesCounterAndReceiptMutation() async throws {
        let url = databaseURL()
        let ids = IDs(20)
        let store = try SQLiteContestStore(databaseURL: url, rules: registry)
        _ = try await store.createSession(
            session(ids, entity: england, call: "G3AAA", location: nil), metadata: metadata(call: "G3AAA"),
            initialDraft: draft(ids, revision: 1, call: "K1ABC", sent: "", sentFields: [:]),
            scope: mutation(ids, 1, revision: 0, digest: "create", draft: ids.draft), committedAt: date)
        try rawExecute(url, "INSERT INTO serial_counters(session_id,scope,scope_value,next_number) VALUES('\(ids.session.uuidString)','session','',100000000)")
        let request = requestID(ids, 2)
        do {
            _ = try await store.reserveSerial(
                reservationID: requestID(ids, 20), serialScope: .session, scopeValue: "",
                scope: .init(sessionID: ids.session, workspaceGeneration: generation, requestID: request,
                             expectedRevision: 1, draftID: ids.draft, payloadDigest: "overflow"),
                committedAt: date.addingTimeInterval(1))
            XCTFail("Expected serial field capacity exhaustion")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .serialExhausted)
        }
        let afterExhaustion = try await store.openSession(id: ids.session)
        let afterExhaustionReservations = try await store.reservations(sessionID: ids.session, draftID: ids.draft)
        let exhaustionReceipt = try await store.operationReceipt(
            sessionID: ids.session, workspaceGeneration: generation,
            requestID: request, payloadDigest: "overflow")
        XCTAssertEqual(afterExhaustion.revision, 1)
        XCTAssertEqual(afterExhaustionReservations, [])
        XCTAssertNil(exhaustionReceipt)
    }

    private struct IDs {
        let session: UUID
        let draft: UUID
        let seed: Int
        init(_ seed: Int) {
            self.seed = seed
            session = UUID(uuidString: String(format: "B1000000-0000-0000-0000-%012d", seed))!
            draft = UUID(uuidString: String(format: "B2000000-0000-0000-0000-%012d", seed))!
        }
    }

    private func session(_ ids: IDs, entity: ContestEntitySnapshot, call: String, location: String?,
                         serial: String? = nil, section suppliedSection: String? = nil,
                         locationFieldRaw: String? = nil) -> ContestSessionSnapshot {
        var fields = locationFields(location)
        if let location, let locationFieldRaw {
            fields["location"] = .init(raw: locationFieldRaw, normalized: location)
        }
        if let serial { fields["serial"] = .init(raw: serial, normalized: serial) }
        return .init(id: ids.session, workspaceGeneration: generation, rule: ARRLRTTYRoundupRule.identity,
                     referenceDataVersion: "cty-arrl-fixture", startedAt: date,
                      station: .init(callsign: call, entity: entity, sentExchange: location ?? "",
                                     operatorCallsigns: [call], location: suppliedSection ?? section(for: entity),
                                     sentExchangeFields: fields))
    }

    private func metadata(call: String) -> ContestSessionMetadata {
        .init(name: "ARRL RTTY fixture", operatorCallsign: call, operatorCategory: "single-op")
    }

    private func draft(_ ids: IDs, revision: UInt64, call: String, sent: String,
                       sentFields: [String: ContestExchangeFieldValue], received: String = "CA",
                       operatorCallsign: String? = nil) -> ContestDraftSnapshot {
        .init(id: ids.draft, sessionID: ids.session, revision: revision,
              updatedAt: date.addingTimeInterval(Double(revision)), callsign: call,
              band: "20m", mode: "RTTY", frequencyHz: 14_080_000,
              rstSent: "599", rstReceived: "599",
              exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received,
                              normalizedReceived: received, sentFields: sentFields,
                              receivedFields: ["exchange": .init(raw: received, normalized: received)]),
              entity: usa, operatorCallsign: operatorCallsign ?? metadataCall(ids), stationLocation: "DX")
    }

    private func section(for entity: ContestEntitySnapshot) -> String {
        switch entity.adif {
        case 291: return "EB"
        case 1: return "QC"
        case 6: return "AK"
        case 110: return "PAC"
        default: return "DX"
        }
    }

    private func qso(_ ids: IDs, call: String = "K1ABC", received: String = "CA",
                     sentRaw: String = "001", sentNormalized: String = "001",
                     fieldRaw: String = "001", fieldNormalized: String = "001",
                     entity: ContestEntitySnapshot? = nil) -> ContestQSO {
        .init(id: requestID(ids, 400), sessionID: ids.session, timestampUTC: date.addingTimeInterval(20),
              callsign: call, band: "20m", mode: "RTTY", frequencyHz: 14_080_000,
              rstSent: "599", rstReceived: "599",
              exchange: .init(rawSent: sentRaw, normalizedSent: sentNormalized,
                              rawReceived: received, normalizedReceived: received,
                              sentFields: ["serial": .init(raw: fieldRaw, normalized: fieldNormalized)],
                              receivedFields: ["exchange": .init(raw: received, normalized: received)]),
              entity: entity ?? usa, operatorCallsign: metadataCall(ids), stationLocation: "DX",
              provenance: .init(source: .operatorEntry))
    }

    private func wveQSO(_ ids: IDs, value: Int = 401, call: String = "VE2AAA", received: String = "QC",
                        sent: String = "CA",
                        sentFields: [String: ContestExchangeFieldValue]? = nil) -> ContestQSO {
        .init(id: requestID(ids, value), sessionID: ids.session,
              timestampUTC: date.addingTimeInterval(20), callsign: call,
              band: "20m", mode: "RTTY", frequencyHz: 14_080_000,
              rstSent: "599", rstReceived: "599",
              exchange: .init(rawSent: sent, normalizedSent: sent,
                              rawReceived: received, normalizedReceived: received,
                              sentFields: sentFields ?? locationFields(sent),
                              receivedFields: ["exchange": .init(raw: received, normalized: received)]),
              entity: ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE",
                                            continent: "NA", cqZone: 4),
              operatorCallsign: "K1AAA", stationLocation: "EB",
              provenance: .init(source: .operatorEntry))
    }

    private func metadataCall(_ ids: IDs) -> String { ids.seed == 1 || ids.seed == 2 ? "K1AAA" : "G3AAA" }
    private func locationFields(_ location: String?) -> [String: ContestExchangeFieldValue] {
        location.map { ["location": .init(raw: $0, normalized: $0)] } ?? [:]
    }
    private func mutation(_ ids: IDs, _ request: Int, revision: UInt64, digest: String,
                          draft: UUID?) -> ContestMutationScope {
        .init(sessionID: ids.session, workspaceGeneration: generation, requestID: requestID(ids, request),
              expectedRevision: revision, draftID: draft, payloadDigest: digest)
    }
    private func requestID(_ ids: IDs, _ value: Int) -> UUID {
        UUID(uuidString: String(format: "B9000000-0000-%04X-0000-%012d", ids.seed, value))!
    }
    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-arrl-rtty-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
    private func rawExecute(_ url: URL, _ sql: String) throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK, let handle else { throw ContestStoreError.database("raw open") }
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(handle)))
        }
    }

    private func rawScalarInt(_ url: URL, _ sql: String) throws -> Int {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK, let handle else {
            throw ContestStoreError.database("raw open")
        }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(handle)))
        }
        return Int(sqlite3_column_int64(statement, 0))
    }
}
