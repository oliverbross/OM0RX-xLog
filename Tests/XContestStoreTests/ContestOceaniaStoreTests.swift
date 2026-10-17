import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestOceaniaStoreTests: XCTestCase {
    private let sessionID = UUID(uuidString: "A1000000-0000-0000-0000-000000000001")!
    private let draftID = UUID(uuidString: "A2000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "A3000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_800_100_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let vk = ContestEntitySnapshot(adif: 150, name: "AUSTRALIA", countryPrefix: "VK", continent: "OC", cqZone: 30)

    func testCWAndSSBDescriptorsReserveCommitAndReopen() async throws {
        let cases: [(ContestRuleIdentity, String, String)] = [
            (OceaniaDXCWRule.identity, "CW", "599"),
            (OceaniaDXSSBRule.identity, "SSB", "59"),
        ]
        for (offset, item) in cases.enumerated() {
            let url = databaseURL()
            var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
            _ = try await create(store!, rule: item.0, mode: item.1, report: item.2)
            do {
                _ = try await store!.commitQSO(
                    qso(id: fixedUUID(5 + offset), mode: item.1, report: item.2,
                        sent: "001", received: "7"), reservationID: nil,
                    scope: mutation(5 + offset, revision: 1,
                                    digest: "commit-without-reservation-\(offset)", draftID: draftID),
                    committedAt: date.addingTimeInterval(0.5)
                )
                XCTFail("Expected Oceania serial contest to require a reservation")
            } catch let error as ContestStoreError {
                XCTAssertEqual(error, .reservationMismatch)
            }
            let unchanged = try await store!.openSession(id: sessionID)
            XCTAssertEqual(unchanged.revision, 1)
            let reserved = try await store!.reserveSerial(
                reservationID: fixedUUID(10 + offset), serialScope: .session, scopeValue: "",
                scope: mutation(10 + offset, revision: 1, digest: "reserve-\(offset)", draftID: draftID),
                committedAt: date.addingTimeInterval(1)
            )
            let committed = try await store!.commitQSO(
                qso(id: fixedUUID(20 + offset), mode: item.1, report: item.2,
                    sent: reserved.reservation.transmittedText, received: "7"),
                reservationID: reserved.reservation.id,
                scope: mutation(20 + offset, revision: 2, digest: "commit-\(offset)", draftID: draftID),
                committedAt: date.addingTimeInterval(2)
            )
            XCTAssertEqual(committed.committedEvaluation.points, 1)
            XCTAssertEqual(committed.committedEvaluation.newMultipliers.count, 1)
            XCTAssertEqual(committed.draft.mode, item.1)
            XCTAssertEqual(committed.draft.rstSent, item.2)
            store = nil

            let reopened = try SQLiteContestStore(databaseURL: url)
            let persisted = try await reopened.qso(sessionID: sessionID, id: committed.qso.id)
            let reservation = try await reopened.reservation(id: reserved.reservation.id)
            XCTAssertEqual(persisted.mode, item.1)
            XCTAssertEqual(reservation.state, .committed)
        }
    }

    func testCorrectionDeletionRestartAndSerialCounterRemainDeterministic() async throws {
        let url = databaseURL()
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
        _ = try await create(store!, rule: OceaniaDXSSBRule.identity, mode: "SSB", report: "59")
        let reserved = try await store!.reserveSerial(
            reservationID: fixedUUID(30), serialScope: .session, scopeValue: "",
            scope: mutation(30, revision: 1, digest: "reserve", draftID: draftID), committedAt: date.addingTimeInterval(1)
        )
        let committed = try await store!.commitQSO(
            qso(id: fixedUUID(31), mode: "SSB", report: "59",
                sent: reserved.reservation.transmittedText, received: "7"),
            reservationID: reserved.reservation.id,
            scope: mutation(31, revision: 2, digest: "commit", draftID: draftID), committedAt: date.addingTimeInterval(2)
        )
        store = nil

        let reopened = try SQLiteContestStore(databaseURL: url)
        let correctedQSO = copy(committed.qso, received: "8")
        let corrected = try await reopened.correctQSO(
            correctedQSO, reason: "Correct received serial", operationTimestamp: date.addingTimeInterval(3),
            scope: mutation(32, revision: 3, digest: "correct", draftID: nil), committedAt: date.addingTimeInterval(3)
        )
        XCTAssertEqual(corrected.score.claimedScore, 1)
        let deleted = try await reopened.deleteQSO(
            id: correctedQSO.id, reason: "Operator deletion", operationTimestamp: date.addingTimeInterval(4),
            scope: mutation(33, revision: 4, digest: "delete", draftID: nil), committedAt: date.addingTimeInterval(4)
        )
        XCTAssertEqual(deleted.score.qsoCount, 0)

        let restarted = try SQLiteContestStore(databaseURL: url)
        let next = try await restarted.reserveSerial(
            reservationID: fixedUUID(34), serialScope: .session, scopeValue: "",
            scope: mutation(34, revision: 5, digest: "reserve-next", draftID: draftID),
            committedAt: date.addingTimeInterval(5)
        )
        XCTAssertEqual(next.reservation.number, 2)
        let audit = try await restarted.qsoAuditTrail(sessionID: sessionID, qsoID: correctedQSO.id)
        XCTAssertEqual(audit.map(\.operation), [.correction, .deletion])
    }

    private func create(_ store: SQLiteContestStore, rule: ContestRuleIdentity,
                        mode: String, report: String) async throws -> ContestSessionCreationResult {
        let session = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: "001",
                           operatorCallsigns: ["OM0RX"], location: "DX")
        )
        let initial = ContestDraftSnapshot(
            id: draftID, sessionID: sessionID, revision: 1, updatedAt: date,
            callsign: "", band: "20m", mode: mode, frequencyHz: 14_250_000,
            rstSent: report, rstReceived: report,
            exchange: .init(rawSent: "", normalizedSent: "", rawReceived: "", normalizedReceived: ""),
            entity: nil, operatorCallsign: "OM0RX", stationLocation: "DX"
        )
        return try await store.createSession(
            session, metadata: .init(name: "Oceania test", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: initial, scope: mutation(1, revision: 0, digest: "create", draftID: draftID),
            committedAt: date
        )
    }

    private func qso(id: UUID, mode: String, report: String,
                     sent: String, received: String) -> ContestQSO {
        ContestQSO(id: id, sessionID: sessionID, timestampUTC: date.addingTimeInterval(10),
                   callsign: "VK1AAA", band: "20m", mode: mode, frequencyHz: 14_250_000,
                   rstSent: report, rstReceived: report,
                   exchange: .init(rawSent: sent, normalizedSent: sent,
                                   rawReceived: received, normalizedReceived: received),
                   entity: vk, operatorCallsign: "OM0RX", stationLocation: "DX",
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

    private func mutation(_ number: Int, revision: UInt64, digest: String,
                          draftID: UUID?) -> ContestMutationScope {
        ContestMutationScope(sessionID: sessionID, workspaceGeneration: generation,
                             requestID: fixedUUID(1_000 + number), expectedRevision: revision,
                             draftID: draftID, payloadDigest: digest)
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "A0000000-0000-0000-0000-%012d", number))!
    }

    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-oceania-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}
