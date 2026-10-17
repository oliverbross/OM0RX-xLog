import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestSSBStoreTests: XCTestCase {
    private let sessionID = UUID(uuidString: "81000000-0000-0000-0000-000000000001")!
    private let draftID = UUID(uuidString: "82000000-0000-0000-0000-000000000001")!
    private let generationID = UUID(uuidString: "83000000-0000-0000-0000-000000000001")!
    private let baseDate = Date(timeIntervalSince1970: 1_800_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testWPXSSBReservationCorrectionDeletionAndCounterSurviveRestart() async throws {
        let url = databaseURL()
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
        _ = try await create(store!, rule: CQWPXSSBRule.identity, stationExchange: "001",
                             initialSent: "", initialReport: "59")
        let reserved = try await store!.reserveSerial(
            reservationID: fixedUUID(1), serialScope: .session, scopeValue: "",
            scope: mutation(2, revision: 1, digest: "reserve", draftID: draftID),
            committedAt: baseDate.addingTimeInterval(1)
        )
        XCTAssertEqual(reserved.reservation.transmittedText, "001")

        let entered = draft(revision: 3, ruleMode: "SSB", sent: "001", report: "59",
                            callsign: "K1ABC", received: "101", entity: usa,
                            updatedAt: baseDate.addingTimeInterval(2))
        _ = try await store!.updateDraft(entered,
                                         scope: mutation(3, revision: 2, digest: "draft", draftID: draftID),
                                         committedAt: baseDate.addingTimeInterval(2))
        let committed = try await store!.commitQSO(
            qso(id: fixedUUID(2), sent: "001", received: "101"), reservationID: reserved.reservation.id,
            scope: mutation(4, revision: 3, digest: "commit", draftID: draftID),
            committedAt: baseDate.addingTimeInterval(3)
        )
        XCTAssertEqual(committed.committedEvaluation.points, 3)
        store = nil

        let reopened = try SQLiteContestStore(databaseURL: url)
        let reopenedReservation = try await reopened.reservation(id: reserved.reservation.id)
        XCTAssertEqual(reopenedReservation.state, .committed)
        let persisted = try await reopened.qso(sessionID: sessionID, id: committed.qso.id)
        XCTAssertEqual(persisted.mode, "SSB")
        XCTAssertEqual(persisted.rstSent, "59")

        let corrected = copy(persisted, received: "102")
        let correction = try await reopened.correctQSO(
            corrected, reason: "Correct received serial", operationTimestamp: baseDate.addingTimeInterval(4),
            scope: mutation(5, revision: 4, digest: "correct", draftID: nil),
            committedAt: baseDate.addingTimeInterval(4)
        )
        XCTAssertEqual(correction.after?.exchange.normalizedReceived, "102")
        _ = try await reopened.deleteQSO(
            id: corrected.id, reason: "Operator deletion", operationTimestamp: baseDate.addingTimeInterval(5),
            scope: mutation(6, revision: 5, digest: "delete", draftID: nil),
            committedAt: baseDate.addingTimeInterval(5)
        )

        let restarted = try SQLiteContestStore(databaseURL: url)
        let page = try await restarted.logPage(sessionID: sessionID, offset: 0, limit: 10)
        let audit = try await restarted.qsoAuditTrail(sessionID: sessionID, qsoID: corrected.id)
        XCTAssertEqual(page.total, 0)
        XCTAssertEqual(audit.map(\.operation), [.correction, .deletion])
        let next = try await restarted.reserveSerial(
            reservationID: fixedUUID(3), serialScope: .session, scopeValue: "",
            scope: mutation(7, revision: 6, digest: "reserve-next", draftID: draftID),
            committedAt: baseDate.addingTimeInterval(6)
        )
        XCTAssertEqual(next.reservation.number, 2)
    }

    func testWWSSBCommitNeedsNoSerialAndResetPreservesZoneAndPhoneDefaults() async throws {
        let store = try SQLiteContestStore(databaseURL: databaseURL())
        _ = try await create(store, rule: CQWWSSBRule.identity, stationExchange: "15",
                             initialSent: "15", initialReport: "59")
        let contact = qso(id: fixedUUID(10), sent: "15", received: "5")
        let committed = try await store.commitQSO(
            contact, reservationID: nil,
            scope: mutation(10, revision: 1, digest: "ww-commit", draftID: draftID),
            committedAt: baseDate.addingTimeInterval(1)
        )
        XCTAssertEqual(committed.committedEvaluation.points, 3)
        XCTAssertEqual(committed.draft.exchange.normalizedSent, "15")
        XCTAssertEqual(committed.draft.rstSent, "59")
        XCTAssertEqual(committed.draft.rstReceived, "59")
        XCTAssertEqual(committed.draft.mode, "SSB")
        do {
            _ = try await store.reserveSerial(reservationID: self.fixedUUID(11), serialScope: .session,
                                              scopeValue: "",
                                              scope: self.mutation(11, revision: 2, digest: "bad-reserve", draftID: self.draftID),
                                              committedAt: self.baseDate.addingTimeInterval(2))
            XCTFail("Expected non-serial rule to reject reservation")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .invalidSerialTransition)
        }
        let after = try await store.openSession(id: sessionID)
        let reservations = try await store.reservations(sessionID: sessionID, draftID: draftID)
        XCTAssertEqual(after.revision, 2)
        XCTAssertTrue(reservations.isEmpty)
    }

    func testWPXCWAndSSBImportedCommitsCannotBypassReservationLedger() async throws {
        let cases: [(ContestRuleIdentity, String)] = [
            (CQWPXCWRule.identity, "599"),
            (CQWPXSSBRule.identity, "59"),
        ]
        for (offset, item) in cases.enumerated() {
            let store = try SQLiteContestStore(databaseURL: databaseURL())
            _ = try await create(store, rule: item.0, stationExchange: "001",
                                 initialSent: "", initialReport: item.1)
            let beforeDraft = try await store.draft(sessionID: sessionID, id: draftID)
            let imported = qso(id: fixedUUID(20 + offset), sent: "001", received: "101",
                               mode: item.0 == CQWPXCWRule.identity ? "CW" : "SSB",
                               report: item.1, provenance: .init(source: .importFile,
                                                                 sourceIdentity: "fixture.adi"))

            do {
                _ = try await store.commitQSO(
                    imported, reservationID: nil,
                    scope: mutation(20 + offset, revision: 1,
                                    digest: "import-without-reservation-\(offset)", draftID: draftID),
                    committedAt: baseDate.addingTimeInterval(Double(20 + offset))
                )
                XCTFail("Expected imported WPX QSO to require a durable reservation")
            } catch let error as ContestStoreError {
                XCTAssertEqual(error, .reservationMismatch)
            }

            let afterSession = try await store.openSession(id: sessionID)
            let afterDraft = try await store.draft(sessionID: sessionID, id: draftID)
            let afterPage = try await store.logPage(sessionID: sessionID, offset: 0, limit: 10)
            let afterReservations = try await store.reservations(sessionID: sessionID, draftID: draftID)
            XCTAssertEqual(afterSession.revision, 1)
            XCTAssertEqual(afterDraft, beforeDraft)
            XCTAssertEqual(afterPage.total, 0)
            XCTAssertTrue(afterReservations.isEmpty)

            let first = try await store.reserveSerial(
                reservationID: fixedUUID(30 + offset), serialScope: .session, scopeValue: "",
                scope: mutation(30 + offset, revision: 1,
                                digest: "first-reservation-\(offset)", draftID: draftID),
                committedAt: baseDate.addingTimeInterval(Double(30 + offset))
            )
            XCTAssertEqual(first.reservation.number, 1)
        }
    }

    private func create(_ store: SQLiteContestStore, rule: ContestRuleIdentity,
                        stationExchange: String, initialSent: String, initialReport: String) async throws -> ContestSessionCreationResult {
        let session = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generationID, rule: rule,
            referenceDataVersion: "cty-fixture", startedAt: baseDate,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: stationExchange,
                           operatorCallsigns: ["OM0RX"], location: "JN98")
        )
        let mode = ContestRuleRegistry.pilots.rule(for: rule)!.metadata.entry.mode
        let initial = draft(revision: 1, ruleMode: mode, sent: initialSent, report: initialReport,
                            updatedAt: baseDate)
        return try await store.createSession(
            session, metadata: .init(name: "SSB test", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: initial, scope: mutation(1, revision: 0, digest: "create", draftID: draftID),
            committedAt: baseDate
        )
    }

    private func draft(revision: UInt64, ruleMode: String, sent: String, report: String,
                       callsign: String = "", received: String = "",
                       entity: ContestEntitySnapshot? = nil, updatedAt: Date) -> ContestDraftSnapshot {
        ContestDraftSnapshot(id: draftID, sessionID: sessionID, revision: revision, updatedAt: updatedAt,
                             callsign: callsign, band: "20m", mode: ruleMode, frequencyHz: 14_250_000,
                             rstSent: report, rstReceived: report,
                             exchange: .init(rawSent: sent, normalizedSent: sent,
                                             rawReceived: received, normalizedReceived: received),
                             entity: entity, operatorCallsign: "OM0RX", stationLocation: "JN98")
    }

    private func qso(id: UUID, sent: String, received: String,
                     mode: String = "SSB", report: String = "59",
                     provenance: ContestQSOProvenance = .init(source: .operatorEntry)) -> ContestQSO {
        ContestQSO(id: id, sessionID: sessionID, timestampUTC: baseDate.addingTimeInterval(10),
                   callsign: "K1ABC", band: "20m", mode: mode, frequencyHz: 14_250_000,
                   rstSent: report, rstReceived: report,
                   exchange: .init(rawSent: sent, normalizedSent: sent,
                                   rawReceived: received, normalizedReceived: received),
                   entity: usa, operatorCallsign: "OM0RX", stationLocation: "JN98",
                   provenance: provenance)
    }

    private func copy(_ qso: ContestQSO, received: String) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                   callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
                   rstSent: qso.rstSent, rstReceived: qso.rstReceived,
                   exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                                   rawReceived: received, normalizedReceived: received),
                   entity: qso.entity, operatorCallsign: qso.operatorCallsign,
                   stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func mutation(_ number: Int, revision: UInt64, digest: String, draftID: UUID?) -> ContestMutationScope {
        ContestMutationScope(sessionID: sessionID, workspaceGeneration: generationID,
                             requestID: fixedUUID(1_000 + number), expectedRevision: revision,
                             draftID: draftID, payloadDigest: digest)
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "80000000-0000-0000-0000-%012d", number))!
    }

    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-ssb-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}
