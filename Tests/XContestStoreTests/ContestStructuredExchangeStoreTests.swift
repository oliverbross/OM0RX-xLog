import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestStructuredExchangeStoreTests: XCTestCase {
    private let sessionID = UUID(uuidString: "C1000000-0000-0000-0000-000000000001")!
    private let draftID = UUID(uuidString: "C2000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "C3000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_100_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testStructuredExchangeCorrectionDeletionReplayAndRestart() async throws {
        let url = databaseURL()
        let registry = ContestRuleRegistry([StructuredStoreFixtureRule()])
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
        let created = try await store!.createSession(
            session(), metadata: .init(name: "Structured fixture", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: draft(revision: 1, callsign: "", receivedName: nil, receivedState: nil),
            scope: mutation(1, revision: 0, digest: "create", draft: draftID), committedAt: date)
        XCTAssertEqual(created.draft.exchange.sentFields["name"]?.normalized, "ALICE")
        XCTAssertEqual(Set(created.projection.draftEvaluation.validation.map(\.code)),
                       ["missingStructuredExchangeField"])
        XCTAssertNil(created.projection.draftEvaluation.dupeKey)
        XCTAssertNil(created.projection.draftEvaluation.isDuplicate)

        let completedDraft = draft(revision: 2, callsign: "K1ABC", receivedName: "BOB", receivedState: "CA")
        let updated = try await store!.updateDraft(completedDraft,
                                                   scope: mutation(2, revision: 1, digest: "draft", draft: draftID),
                                                   committedAt: date.addingTimeInterval(1))
        XCTAssertTrue(updated.projection.draftEvaluation.validation.isEmpty)
        XCTAssertEqual(updated.projection.draftEvaluation.isDuplicate, false)
        let original = qso(receivedName: "BOB", receivedState: "CA")
        let committed = try await store!.commitQSO(
            original, reservationID: nil,
            scope: mutation(3, revision: 2, digest: "commit", draft: draftID),
            committedAt: date.addingTimeInterval(2))
        XCTAssertEqual(committed.score.claimedScore, 4)
        XCTAssertEqual(committed.draft.exchange.sentFields["state"]?.normalized, "NT")
        XCTAssertTrue(committed.draft.exchange.receivedFields.isEmpty)
        XCTAssertFalse(committed.projection.draftEvaluation.validation.isEmpty)
        XCTAssertNil(committed.projection.draftEvaluation.dupeKey)
        store = nil

        store = try SQLiteContestStore(databaseURL: url, rules: registry)
        let replayedCommit = try await store!.commitQSO(
            original, reservationID: nil,
            scope: mutation(3, revision: 2, digest: "commit", draft: draftID),
            committedAt: date.addingTimeInterval(99))
        XCTAssertEqual(replayedCommit, committed)
        let correctedQSO = copy(original, receivedName: "BOB", receivedState: "TX")
        let correctionScope = mutation(4, revision: 3, digest: "correct", draft: nil)
        let corrected = try await store!.correctQSO(
            correctedQSO, reason: "Correct copied state", operationTimestamp: date.addingTimeInterval(3),
            scope: correctionScope, committedAt: date.addingTimeInterval(3))
        XCTAssertEqual(corrected.after?.exchange.receivedFields["state"]?.normalized, "TX")
        XCTAssertEqual(corrected.score.claimedScore, 4)
        let deletionScope = mutation(5, revision: 4, digest: "delete", draft: nil)
        let deleted = try await store!.deleteQSO(
            id: original.id, reason: "Remove test contact", operationTimestamp: date.addingTimeInterval(4),
            scope: deletionScope, committedAt: date.addingTimeInterval(4))
        XCTAssertEqual(deleted.qsoCount, 0)
        store = nil

        let reopened = try SQLiteContestStore(databaseURL: url, rules: registry)
        let score = try await reopened.scoreSnapshot(sessionID: sessionID)
        let audit = try await reopened.qsoAuditTrail(sessionID: sessionID, qsoID: original.id)
        XCTAssertEqual(score.score.claimedScore, 0)
        XCTAssertEqual(audit.map(\.operation), [.correction, .deletion])
        let replayedCorrection = try await reopened.correctQSO(
            correctedQSO, reason: "Correct copied state", operationTimestamp: date.addingTimeInterval(3),
            scope: correctionScope, committedAt: date.addingTimeInterval(99))
        XCTAssertEqual(replayedCorrection, corrected)
        let replayedDeletion = try await reopened.deleteQSO(
            id: original.id, reason: "Remove test contact", operationTimestamp: date.addingTimeInterval(4),
            scope: deletionScope, committedAt: date.addingTimeInterval(99))
        XCTAssertEqual(replayedDeletion, deleted)
    }

    func testStructuredSentFieldsAreImmutableAndRollbackCorrection() async throws {
        let url = databaseURL()
        let registry = ContestRuleRegistry([StructuredStoreFixtureRule()])
        let store = try SQLiteContestStore(databaseURL: url, rules: registry)
        let invalidStationFields = ["name": ContestExchangeFieldValue(raw: "Alice!", normalized: "ALICE!"),
                                    "state": ContestExchangeFieldValue(raw: "nt", normalized: "NT")]
        do {
            _ = try await store.createSession(
                session(fields: invalidStationFields),
                metadata: .init(name: "Structured fixture", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
                initialDraft: draft(revision: 1, callsign: "", receivedName: nil, receivedState: nil),
                scope: mutation(9, revision: 0, digest: "invalid-station", draft: draftID), committedAt: date)
            XCTFail("Expected invalid pinned station exchange to be rejected")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }
        _ = try await store.createSession(
            session(), metadata: .init(name: "Structured fixture", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: draft(revision: 1, callsign: "K1ABC", receivedName: "BOB", receivedState: "CA"),
            scope: mutation(10, revision: 0, digest: "create", draft: draftID), committedAt: date)
        let original = qso(receivedName: "BOB", receivedState: "CA")
        _ = try await store.commitQSO(original, reservationID: nil,
                                      scope: mutation(11, revision: 1, digest: "commit", draft: draftID),
                                      committedAt: date.addingTimeInterval(1))
        let changedSent = ContestQSO(
            id: original.id, sessionID: original.sessionID, timestampUTC: original.timestampUTC,
            callsign: original.callsign, band: original.band, mode: original.mode, frequencyHz: original.frequencyHz,
            rstSent: original.rstSent, rstReceived: original.rstReceived,
            exchange: .init(rawSent: original.exchange.rawSent, normalizedSent: original.exchange.normalizedSent,
                            rawReceived: original.exchange.rawReceived, normalizedReceived: original.exchange.normalizedReceived,
                            sentFields: ["name": .init(raw: "MALLORY", normalized: "MALLORY"),
                                         "state": .init(raw: "NT", normalized: "NT")],
                            receivedFields: original.exchange.receivedFields),
            entity: original.entity, operatorCallsign: original.operatorCallsign,
            stationLocation: original.stationLocation, provenance: original.provenance)
        do {
            _ = try await store.correctQSO(changedSent, reason: "Invalid sent edit",
                                           operationTimestamp: date.addingTimeInterval(2),
                                           scope: mutation(12, revision: 2, digest: "bad-correction", draft: nil),
                                           committedAt: date.addingTimeInterval(2))
            XCTFail("Expected immutable sent fields to reject correction")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .immutableQSOField("allocatedSentSerial"))
        }
        let stored = try await store.openSession(id: sessionID)
        let audit = try await store.qsoAuditTrail(sessionID: sessionID, qsoID: original.id)
        let persisted = try await store.qso(sessionID: sessionID, id: original.id)
        XCTAssertEqual(stored.revision, 2)
        XCTAssertEqual(audit, [])
        XCTAssertEqual(persisted, original)
    }

    func testVersionTwoSerialAuthorityRollbackReplayRestartAndNonreuse() async throws {
        let url = databaseURL()
        let registry = ContestRuleRegistry([StructuredSerialStoreFixtureRule()])
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
        let serialSession = session(rule: StructuredSerialStoreFixtureRule.identity)
        let initial = serialDraft(revision: 1, sentSerial: nil)
        let created = try await store!.createSession(
            serialSession, metadata: .init(name: "Structured serial", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: initial, scope: mutation(20, revision: 0, digest: "serial-create", draft: draftID),
            committedAt: date)
        XCTAssertTrue(created.session.session.station.sentExchangeFields["serial"] == nil)
        XCTAssertTrue(created.projection.draftEvaluation.validation.contains { $0.field == "exchange.sent.serial" })

        let reserveScope = mutation(21, revision: 1, digest: "serial-reserve", draft: draftID)
        let reserved = try await store!.reserveSerial(
            reservationID: fixedUUID(21), serialScope: .session, scopeValue: "",
            scope: reserveScope, committedAt: date.addingTimeInterval(1))
        XCTAssertEqual(reserved.draft.exchange.sentFields["serial"]?.raw, "001")
        XCTAssertEqual(reserved.draft.exchange.sentFields["serial"]?.normalized, "001")
        XCTAssertTrue(reserved.projection.draftEvaluation.validation.isEmpty)

        let forged = serialQSO(serial: "999")
        do {
            _ = try await store!.commitQSO(
                forged, reservationID: reserved.reservation.id,
                scope: mutation(22, revision: 2, digest: "forged-serial", draft: draftID),
                committedAt: date.addingTimeInterval(2))
            XCTFail("Expected forged typed serial to reject atomically")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .reservationMismatch)
        }
        let afterForgery = try await store!.openSession(id: sessionID)
        let reservationAfterForgery = try await store!.reservation(id: reserved.reservation.id)
        XCTAssertEqual(afterForgery.revision, 2)
        XCTAssertEqual(reservationAfterForgery.state, .reserved)

        let committedQSO = serialQSO(serial: "001")
        let commitScope = mutation(23, revision: 2, digest: "serial-commit", draft: draftID)
        let committed = try await store!.commitQSO(
            committedQSO, reservationID: reserved.reservation.id, scope: commitScope,
            committedAt: date.addingTimeInterval(3))
        XCTAssertNil(committed.draft.exchange.sentFields["serial"])
        XCTAssertEqual(committed.draft.exchange.sentFields["name"]?.normalized, "ALICE")
        XCTAssertTrue(committed.projection.draftEvaluation.validation.contains { $0.field == "exchange.sent.serial" })
        store = nil

        store = try SQLiteContestStore(databaseURL: url, rules: registry)
        let replayedReserve = try await store!.reserveSerial(
            reservationID: fixedUUID(21), serialScope: .session, scopeValue: "",
            scope: reserveScope, committedAt: date.addingTimeInterval(90))
        XCTAssertEqual(replayedReserve, reserved)
        let replayedCommit = try await store!.commitQSO(
            committedQSO, reservationID: reserved.reservation.id, scope: commitScope,
            committedAt: date.addingTimeInterval(91))
        XCTAssertEqual(replayedCommit, committed)
        let reopenedReservation = try await store!.reservation(id: reserved.reservation.id)
        XCTAssertEqual(reopenedReservation.state, .committed)
        let next = try await store!.reserveSerial(
            reservationID: fixedUUID(24), serialScope: .session, scopeValue: "",
            scope: mutation(24, revision: 3, digest: "serial-next", draft: draftID),
            committedAt: date.addingTimeInterval(4))
        XCTAssertEqual(next.reservation.number, 2)
        XCTAssertEqual(next.draft.exchange.sentFields["serial"]?.normalized, "002")
    }

    func testStructuredSerialReservedAndUncertainEditsPreserveStationFieldsAndAggregate() async throws {
        let store = try SQLiteContestStore(
            databaseURL: databaseURL(), rules: ContestRuleRegistry([StructuredSerialStoreFixtureRule()]))
        let session = session(rule: StructuredSerialStoreFixtureRule.identity)
        _ = try await store.createSession(
            session, metadata: .init(name: "Structured serial edits", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: serialDraft(revision: 1, sentSerial: nil),
            scope: mutation(60, revision: 0, digest: "serial-edit-create", draft: draftID), committedAt: date)
        let reserved = try await store.reserveSerial(
            reservationID: fixedUUID(60), serialScope: .session, scopeValue: "",
            scope: mutation(61, revision: 1, digest: "serial-edit-reserve", draft: draftID),
            committedAt: date.addingTimeInterval(1))
        XCTAssertEqual(reserved.draft.exchange.rawSent, "Alice nt 001")
        XCTAssertEqual(reserved.draft.exchange.normalizedSent, "ALICE NT 001")
        XCTAssertEqual(reserved.draft.exchange.sentFields["name"]?.normalized, "ALICE")
        XCTAssertEqual(reserved.draft.exchange.sentFields["serial"]?.normalized, "001")

        let edited = serialEdit(reserved.draft, callsign: "DL1AAA")
        let applied = try await store.updateDraft(
            edited, scope: mutation(62, revision: 2, digest: "serial-edit-valid", draft: draftID),
            committedAt: date.addingTimeInterval(2))
        XCTAssertEqual(applied.draft.exchange.rawSent, "Alice nt 001")
        XCTAssertEqual(applied.draft.exchange.sentFields["name"]?.normalized, "ALICE")

        for invalid in [
            serialEdit(applied.draft, rawSent: "001", normalizedSent: "001"),
            serialEdit(applied.draft, sentName: "MALLORY", rawSent: "MALLORY nt 001", normalizedSent: "MALLORY NT 001"),
        ] {
            do {
                _ = try await store.updateDraft(
                    invalid, scope: mutation(63, revision: 3, digest: "serial-edit-forged-\(invalid.exchange.rawSent)", draft: draftID),
                    committedAt: date.addingTimeInterval(3))
                XCTFail("Expected reservation-preserving edit rejection")
            } catch let error as ContestRepositoryError {
                XCTAssertEqual(error, .invalidSerialTransition)
            }
        }

        _ = try await store.transitionSerial(
            reservationID: reserved.reservation.id, to: .transmitted,
            scope: mutation(64, revision: 3, digest: "serial-edit-transmitted", draft: draftID),
            committedAt: date.addingTimeInterval(4))
        let transmittedDraft = try await store.draft(sessionID: sessionID, id: draftID)
        let transmittedEdit = serialEdit(transmittedDraft, callsign: "VE3AAA")
        let transmittedApplied = try await store.updateDraft(
            transmittedEdit, scope: mutation(65, revision: 4, digest: "serial-edit-transmitted-valid", draft: draftID),
            committedAt: date.addingTimeInterval(5))
        XCTAssertEqual(transmittedApplied.draft.exchange.rawSent, "Alice nt 001")
        XCTAssertEqual(transmittedApplied.draft.exchange.sentFields["serial"]?.normalized, "001")

        _ = try await store.transitionSerial(
            reservationID: reserved.reservation.id, to: .uncertain,
            scope: mutation(66, revision: 5, digest: "serial-edit-uncertain", draft: draftID),
            committedAt: date.addingTimeInterval(6))
        let uncertainDraft = try await store.draft(sessionID: sessionID, id: draftID)
        let uncertainEdit = serialEdit(uncertainDraft, callsign: "VE3AAA")
        let uncertainApplied = try await store.updateDraft(
            uncertainEdit, scope: mutation(67, revision: 6, digest: "serial-edit-uncertain-valid", draft: draftID),
            committedAt: date.addingTimeInterval(7))
        XCTAssertEqual(uncertainApplied.draft.exchange.rawSent, "Alice nt 001")
        XCTAssertEqual(uncertainApplied.draft.exchange.sentFields["serial"]?.normalized, "001")
    }

    func testExactModeValidationRejectsLowercaseV1AndV2Drafts() async throws {
        let wwURL = databaseURL()
        let wwStore = try SQLiteContestStore(databaseURL: wwURL)
        let wwSession = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: CQWWCWRule.identity,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: "15",
                           operatorCallsigns: ["OM0RX"], location: "JN98"))
        let lowercaseCW = ContestDraftSnapshot(
            id: draftID, sessionID: sessionID, revision: 1, updatedAt: date, callsign: "",
            band: "20m", mode: "cw", frequencyHz: 14_050_000, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "15", normalizedSent: "15", rawReceived: "", normalizedReceived: ""),
            entity: nil, operatorCallsign: "OM0RX", stationLocation: "JN98")
        do {
            _ = try await wwStore.createSession(
                wwSession, metadata: .init(name: "WW", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
                initialDraft: lowercaseCW, scope: mutation(30, revision: 0, digest: "lowercase-cw", draft: draftID),
                committedAt: date)
            XCTFail("Expected lowercase v1 mode to reject")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidDraft)
        }

        let v2URL = databaseURL()
        let v2Store = try SQLiteContestStore(databaseURL: v2URL,
                                             rules: ContestRuleRegistry([StructuredStoreFixtureRule()]))
        let lowercaseV2 = ContestDraftSnapshot(
            id: draftID, sessionID: sessionID, revision: 1, updatedAt: date, callsign: "",
            band: "20m", mode: "rtty", frequencyHz: 14_080_000, rstSent: "599", rstReceived: "599",
            exchange: draft(revision: 1, callsign: "", receivedName: nil, receivedState: nil).exchange,
            entity: nil, operatorCallsign: "OM0RX", stationLocation: "JN98")
        do {
            _ = try await v2Store.createSession(
                session(), metadata: .init(name: "V2", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
                initialDraft: lowercaseV2, scope: mutation(31, revision: 0, digest: "lowercase-v2", draft: draftID),
                committedAt: date)
            XCTFail("Expected lowercase v2 mode to reject")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidDraft)
        }
    }

    private func session(rule: ContestRuleIdentity = StructuredStoreFixtureRule.identity,
                         fields: [String: ContestExchangeFieldValue]? = nil) -> ContestSessionSnapshot {
        ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: "ALICE NT",
                           operatorCallsigns: ["OM0RX"], location: "JN98",
                           sentExchangeFields: fields ?? sentFields))
    }

    private var sentFields: [String: ContestExchangeFieldValue] {
        ["name": .init(raw: "Alice", normalized: "ALICE"),
         "state": .init(raw: "nt", normalized: "NT")]
    }

    private func draft(revision: UInt64, callsign: String, receivedName: String?,
                       receivedState: String?) -> ContestDraftSnapshot {
        var received: [String: ContestExchangeFieldValue] = [:]
        if let receivedName { received["name"] = .init(raw: receivedName, normalized: receivedName) }
        if let receivedState { received["state"] = .init(raw: receivedState, normalized: receivedState) }
        return ContestDraftSnapshot(
            id: draftID, sessionID: sessionID, revision: revision, updatedAt: date.addingTimeInterval(Double(revision)),
            callsign: callsign, band: "20m", mode: "RTTY", frequencyHz: 14_080_000,
            rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "ALICE NT", normalizedSent: "ALICE NT",
                            rawReceived: receivedName.map { "\($0) \(receivedState ?? "")" } ?? "",
                            normalizedReceived: receivedName.map { "\($0) \(receivedState ?? "")" } ?? "",
                            sentFields: sentFields, receivedFields: received),
            entity: callsign.isEmpty ? nil : usa, operatorCallsign: "OM0RX", stationLocation: "JN98")
    }

    private func qso(receivedName: String, receivedState: String) -> ContestQSO {
        ContestQSO(
            id: UUID(uuidString: "C4000000-0000-0000-0000-000000000001")!, sessionID: sessionID,
            timestampUTC: date.addingTimeInterval(10), callsign: "K1ABC", band: "20m", mode: "RTTY",
            frequencyHz: 14_080_000, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "ALICE NT", normalizedSent: "ALICE NT",
                            rawReceived: "\(receivedName) \(receivedState)",
                            normalizedReceived: "\(receivedName) \(receivedState)", sentFields: sentFields,
                            receivedFields: ["name": .init(raw: receivedName, normalized: receivedName),
                                             "state": .init(raw: receivedState, normalized: receivedState)]),
            entity: usa, operatorCallsign: "OM0RX", stationLocation: "JN98",
            provenance: .init(source: .operatorEntry))
    }

    private func serialDraft(revision: UInt64, sentSerial: String?) -> ContestDraftSnapshot {
        var fields = sentFields
        if let sentSerial { fields["serial"] = .init(raw: sentSerial, normalized: sentSerial) }
        return ContestDraftSnapshot(
            id: draftID, sessionID: sessionID, revision: revision,
            updatedAt: date.addingTimeInterval(Double(revision)), callsign: "K1ABC",
            band: "20m", mode: "RTTY", frequencyHz: 14_080_000, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: sentSerial ?? "ALICE NT", normalizedSent: sentSerial ?? "ALICE NT",
                            rawReceived: "7", normalizedReceived: "7", sentFields: fields,
                            receivedFields: ["serial": .init(raw: "7", normalized: "7")]),
            entity: usa, operatorCallsign: "OM0RX", stationLocation: "JN98")
    }

    private func serialQSO(serial: String) -> ContestQSO {
        var fields = sentFields
        fields["serial"] = .init(raw: serial, normalized: serial)
        return ContestQSO(
            id: fixedUUID(400), sessionID: sessionID, timestampUTC: date.addingTimeInterval(10),
            callsign: "K1ABC", band: "20m", mode: "RTTY", frequencyHz: 14_080_000,
            rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "001", normalizedSent: "001", rawReceived: "7", normalizedReceived: "7",
                            sentFields: fields,
                            receivedFields: ["serial": .init(raw: "7", normalized: "7")]),
            entity: usa, operatorCallsign: "OM0RX", stationLocation: "JN98",
            provenance: .init(source: .operatorEntry))
    }

    private func serialEdit(_ draft: ContestDraftSnapshot, callsign: String? = nil,
                            sentName: String? = nil, rawSent: String? = nil,
                            normalizedSent: String? = nil) -> ContestDraftSnapshot {
        var sentFields = draft.exchange.sentFields
        if let sentName { sentFields["name"] = .init(raw: sentName, normalized: sentName) }
        return ContestDraftSnapshot(
            id: draft.id, sessionID: draft.sessionID, revision: draft.revision + 1,
            updatedAt: draft.updatedAt.addingTimeInterval(1), callsign: callsign ?? draft.callsign,
            band: draft.band, mode: draft.mode, frequencyHz: draft.frequencyHz,
            rstSent: draft.rstSent, rstReceived: draft.rstReceived,
            exchange: .init(rawSent: rawSent ?? draft.exchange.rawSent,
                            normalizedSent: normalizedSent ?? draft.exchange.normalizedSent,
                            rawReceived: draft.exchange.rawReceived,
                            normalizedReceived: draft.exchange.normalizedReceived,
                            sentFields: sentFields, receivedFields: draft.exchange.receivedFields),
            entity: draft.entity, operatorCallsign: draft.operatorCallsign,
            stationLocation: draft.stationLocation)
    }

    private func copy(_ qso: ContestQSO, receivedName: String, receivedState: String) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                   callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
                   rstSent: qso.rstSent, rstReceived: qso.rstReceived,
                   exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                                   rawReceived: "\(receivedName) \(receivedState)",
                                   normalizedReceived: "\(receivedName) \(receivedState)",
                                   sentFields: qso.exchange.sentFields,
                                   receivedFields: ["name": .init(raw: receivedName, normalized: receivedName),
                                                    "state": .init(raw: receivedState, normalized: receivedState)]),
                   entity: qso.entity, operatorCallsign: qso.operatorCallsign,
                   stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func mutation(_ number: Int, revision: UInt64, digest: String,
                          draft: UUID?) -> ContestMutationScope {
        ContestMutationScope(sessionID: sessionID, workspaceGeneration: generation,
                             requestID: UUID(uuidString: String(format: "C0000000-0000-0000-0000-%012d", number))!,
                             expectedRevision: revision, draftID: draft, payloadDigest: digest)
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "C9000000-0000-0000-0000-%012d", number))!
    }

    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-structured-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}

private struct StructuredStoreFixtureRule: ContestRule {
    static let identity = ContestRuleIdentity(id: "test-structured-store", version: "2.0.0",
                                              edition: "fixture", sourceRevision: "fixture")
    let metadata = ContestRuleMetadata(
        identity: identity, displayName: "Structured store fixture", cabrilloName: "TEST-RTTY",
        supportedBands: ["20m"], supportedModes: ["RTTY"],
        entry: ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: [.init(mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY",
                                 report: .init(format: .digitalRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3))],
            exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                            adifFields: .exchangeStrings,
                            sentFields: Self.fields(my: true), receivedFields: Self.fields(my: false)),
            serial: .init(requirement: .none, allowedScopes: []), scorePolicy: .pointsOnly),
        sourceProvenance: "test fixture")

    func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        .init(validation: [], dupeKey: "\(qso.callsign)|\(qso.band)", points: 4,
              multiplierCandidates: [.init(kind: "state",
                                           value: qso.exchange.receivedFields["state"]?.normalized ?? "",
                                           scope: "contest")])
    }

    func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }

    private static func fields(my: Bool) -> [ContestExchangeFieldDescriptor] {
        [.init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
               adifField: my ? .myName : .name),
         .init(id: "state", label: "State", acceptedKinds: [.subdivision], maximumUTF8Bytes: 8,
               adifField: my ? .myState : .state)]
    }
}

private struct StructuredSerialStoreFixtureRule: ContestRule {
    static let identity = ContestRuleIdentity(id: "test-structured-serial-store", version: "2.0.0",
                                              edition: "fixture", sourceRevision: "fixture")
    let metadata = ContestRuleMetadata(
        identity: identity, displayName: "Structured serial fixture", cabrilloName: "TEST-RTTY-SERIAL",
        supportedBands: ["20m"], supportedModes: ["RTTY"],
        entry: ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: [.init(mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY",
                                 report: .init(format: .digitalRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3))],
            exchange: .init(
                sent: .structured, received: .structured, sentDefault: .stationFields,
                adifFields: .exchangeStrings,
                sentFields: [
                    .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                          adifField: .myName),
                    .init(id: "state", label: "State", acceptedKinds: [.subdivision], maximumUTF8Bytes: 8,
                          adifField: .myState),
                    .init(id: "serial", label: "Serial", acceptedKinds: [.serialNumber], maximumUTF8Bytes: 8,
                          adifField: .stx),
                ],
                receivedFields: [
                    .init(id: "serial", label: "Serial", acceptedKinds: [.serialNumber], maximumUTF8Bytes: 8,
                          adifField: .srx),
                ]),
            serial: .init(requirement: .requiredForCommit, allowedScopes: [.session]), scorePolicy: .pointsOnly),
        sourceProvenance: "test fixture")

    func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        .init(validation: [], dupeKey: "\(qso.callsign)|\(qso.band)", points: 1, multiplierCandidates: [])
    }

    func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
}
