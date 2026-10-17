import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestSACStoreTests: XCTestCase {
    private let sessionID = UUID(uuidString: "C1000000-0000-0000-0000-000000000001")!
    private let draftID = UUID(uuidString: "C2000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "C3000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_800_200_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let sm = ContestEntitySnapshot(adif: 284, name: "SWEDEN", countryPrefix: "SM", continent: "EU", cqZone: 14)

    func testCWAndSSBRequireReservationThenCommitAndReopen() async throws {
        let cases: [(ContestRuleIdentity, String, String)] = [
            (SACCWRule.identity, "CW", "599"), (SACSSBRule.identity, "SSB", "59"),
        ]
        for (offset, item) in cases.enumerated() {
            let ids = IDs(offset: offset)
            let url = databaseURL()
            var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
            _ = try await create(store!, ids: ids, rule: item.0, mode: item.1, report: item.2)
            do {
                _ = try await store!.commitQSO(
                    qso(ids: ids, id: fixedUUID(10 + offset), mode: item.1, report: item.2,
                        sent: "001", received: "7"), reservationID: nil,
                    scope: mutation(ids: ids, number: 10 + offset, revision: 1,
                                    digest: "no-reservation-\(offset)", draftID: ids.draft),
                    committedAt: date.addingTimeInterval(0.5))
                XCTFail("Expected SAC serial contest to require a reservation")
            } catch let error as ContestStoreError {
                XCTAssertEqual(error, .reservationMismatch)
            }
            let unchanged = try await store!.openSession(id: ids.session)
            XCTAssertEqual(unchanged.revision, 1)
            let reserved = try await store!.reserveSerial(
                reservationID: fixedUUID(20 + offset), serialScope: .session, scopeValue: "",
                scope: mutation(ids: ids, number: 20 + offset, revision: 1,
                                digest: "reserve-\(offset)", draftID: ids.draft),
                committedAt: date.addingTimeInterval(1))
            let committed = try await store!.commitQSO(
                qso(ids: ids, id: fixedUUID(30 + offset), mode: item.1, report: item.2,
                    sent: reserved.reservation.transmittedText, received: "7"),
                reservationID: reserved.reservation.id,
                scope: mutation(ids: ids, number: 30 + offset, revision: 2,
                                digest: "commit-\(offset)", draftID: ids.draft),
                committedAt: date.addingTimeInterval(2))
            XCTAssertEqual(committed.committedEvaluation.points, 1)
            XCTAssertEqual(committed.committedEvaluation.newMultipliers.count, 1)
            store = nil

            let reopened = try SQLiteContestStore(databaseURL: url)
            let persistedQSO = try await reopened.qso(sessionID: ids.session, id: committed.qso.id)
            let persistedReservation = try await reopened.reservation(id: reserved.reservation.id)
            XCTAssertEqual(persistedQSO, committed.qso)
            XCTAssertEqual(persistedReservation.state, .committed)
        }
    }

    func testCorrectionDeletionRestartAndSerialNeverReuse() async throws {
        let ids = IDs(offset: 9)
        let url = databaseURL()
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
        _ = try await create(store!, ids: ids, rule: SACSSBRule.identity, mode: "SSB", report: "59")
        let reserved = try await store!.reserveSerial(
            reservationID: fixedUUID(50), serialScope: .session, scopeValue: "",
            scope: mutation(ids: ids, number: 50, revision: 1, digest: "reserve", draftID: ids.draft),
            committedAt: date.addingTimeInterval(1))
        let committed = try await store!.commitQSO(
            qso(ids: ids, id: fixedUUID(51), mode: "SSB", report: "59",
                sent: reserved.reservation.transmittedText, received: "7"),
            reservationID: reserved.reservation.id,
            scope: mutation(ids: ids, number: 51, revision: 2, digest: "commit", draftID: ids.draft),
            committedAt: date.addingTimeInterval(2))
        store = nil

        let reopened = try SQLiteContestStore(databaseURL: url)
        let correctedQSO = copy(committed.qso, received: "8")
        let corrected = try await reopened.correctQSO(
            correctedQSO, reason: "Correct received serial", operationTimestamp: date.addingTimeInterval(3),
            scope: mutation(ids: ids, number: 52, revision: 3, digest: "correct", draftID: nil),
            committedAt: date.addingTimeInterval(3))
        XCTAssertEqual(corrected.score.claimedScore, 1)
        let deleted = try await reopened.deleteQSO(
            id: correctedQSO.id, reason: "Operator deletion", operationTimestamp: date.addingTimeInterval(4),
            scope: mutation(ids: ids, number: 53, revision: 4, digest: "delete", draftID: nil),
            committedAt: date.addingTimeInterval(4))
        XCTAssertEqual(deleted.score.qsoCount, 0)

        let restarted = try SQLiteContestStore(databaseURL: url)
        let next = try await restarted.reserveSerial(
            reservationID: fixedUUID(54), serialScope: .session, scopeValue: "",
            scope: mutation(ids: ids, number: 54, revision: 5, digest: "reserve-next", draftID: ids.draft),
            committedAt: date.addingTimeInterval(5))
        XCTAssertEqual(next.reservation.number, 2)
        let audit = try await restarted.qsoAuditTrail(sessionID: ids.session, qsoID: correctedQSO.id)
        XCTAssertEqual(audit.map(\.operation), [.correction, .deletion])
    }

    private struct IDs {
        let session: UUID
        let draft: UUID
        let generation: UUID
        init(offset: Int) {
            session = UUID(uuidString: String(format: "C1000000-0000-0000-0000-%012d", offset + 1))!
            draft = UUID(uuidString: String(format: "C2000000-0000-0000-0000-%012d", offset + 1))!
            generation = UUID(uuidString: String(format: "C3000000-0000-0000-0000-%012d", offset + 1))!
        }
    }

    private func create(_ store: SQLiteContestStore, ids: IDs, rule: ContestRuleIdentity,
                        mode: String, report: String) async throws -> ContestSessionCreationResult {
        let session = ContestSessionSnapshot(
            id: ids.session, workspaceGeneration: ids.generation, rule: rule,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: "001",
                           operatorCallsigns: ["OM0RX"], location: "DX"))
        let initial = ContestDraftSnapshot(
            id: ids.draft, sessionID: ids.session, revision: 1, updatedAt: date,
            callsign: "", band: "20m", mode: mode,
            frequencyHz: mode == "CW" ? 14_030_000 : 14_250_000,
            rstSent: report, rstReceived: report,
            exchange: .init(rawSent: "", normalizedSent: "", rawReceived: "", normalizedReceived: ""),
            entity: nil, operatorCallsign: "OM0RX", stationLocation: "DX")
        return try await store.createSession(
            session, metadata: .init(name: "SAC test", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: initial,
            scope: mutation(ids: ids, number: 1, revision: 0, digest: "create", draftID: ids.draft),
            committedAt: date)
    }

    private func qso(ids: IDs, id: UUID, mode: String, report: String,
                     sent: String, received: String) -> ContestQSO {
        ContestQSO(id: id, sessionID: ids.session, timestampUTC: date.addingTimeInterval(10),
                   callsign: "SM1AAA", band: "20m", mode: mode,
                   frequencyHz: mode == "CW" ? 14_030_000 : 14_250_000,
                   rstSent: report, rstReceived: report,
                   exchange: .init(rawSent: sent, normalizedSent: sent,
                                   rawReceived: received, normalizedReceived: received),
                   entity: sm, operatorCallsign: "OM0RX", stationLocation: "DX",
                   provenance: .init(source: .operatorEntry))
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

    private func mutation(ids: IDs, number: Int, revision: UInt64, digest: String,
                          draftID: UUID?) -> ContestMutationScope {
        ContestMutationScope(sessionID: ids.session, workspaceGeneration: ids.generation,
                             requestID: fixedUUID(1_000 + number), expectedRevision: revision,
                             draftID: draftID, payloadDigest: digest)
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "C0000000-0000-0000-0000-%012d", number))!
    }

    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-sac-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}
