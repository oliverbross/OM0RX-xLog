import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestCWUniqueCallDeclarativeStoreTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_500_000)

    func testSharedDefinitionsScoreDupeCorrectionSerialAndRestart() async throws {
        for (offset, variant) in CWUniqueCallContestVariant.allCases.enumerated() {
            let ids = IDs(offset)
            let definition = try CWUniqueCallDeclarativeDefinitions.definition(for: variant)
            let rule = DeclarativeContestRule(definition: definition)
            let url = databaseURL(offset)
            var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
            var revision: UInt64 = 1
            var request = 2
            _ = try await store!.createDeclarativeSession(
                session(ids, rule, variant),
                metadata: .init(name: variant.rawValue, operatorCallsign: "OM0RX", operatorCategory: "single-op"),
                initialDraft: draft(ids, variant), canonicalDefinitionData: definition.canonicalStorageData(),
                scope: scope(ids, 1, revision: 0, draft: true), committedAt: date)

            let contacts = [
                ("K1ABC", "20m", 14_025_000, "AL", "101"),
                ("K1ABC", "40m", 7_025_000, "BOB", "102"),
                ("W1XYZ", "20m", 14_030_000, "CAROL", "103"),
                ("K1ABC", "20m", 14_035_000, "DAN", "104"),
            ]
            var committed: [ContestQSO] = []
            for (index, item) in contacts.enumerated() {
                var reservation: ContestSerialReservation?
                if variant != .cwt {
                    let result = try await store!.reserveSerial(
                        reservationID: uuid(90 + offset, index + 1), serialScope: .session, scopeValue: "",
                        scope: scope(ids, request, revision: revision, draft: true),
                        committedAt: date.addingTimeInterval(Double(request)))
                    reservation = result.reservation
                    XCTAssertEqual(result.reservation.transmittedText, String(format: "%03d", index + 1))
                    revision += 1
                    request += 1
                }
                let contact = qso(ids, index + 1, variant: variant, serial: reservation?.transmittedText,
                                  call: item.0, band: item.1, frequency: Int64(item.2),
                                  receivedName: item.3, receivedSerial: item.4)
                let result = try await store!.commitQSO(
                    contact, reservationID: reservation?.id,
                    scope: scope(ids, request, revision: revision, draft: true),
                    committedAt: date.addingTimeInterval(Double(request)))
                committed.append(result.qso)
                XCTAssertEqual(result.committedEvaluation.disposition, index == 3 ? .duplicate : .accepted)
                revision += 1
                request += 1
            }
            let before = try await store!.scoreSnapshot(sessionID: ids.session)
            XCTAssertEqual(before.score.totalPoints, 3)
            XCTAssertEqual(before.score.multiplierCount, 2)
            XCTAssertEqual(before.score.claimedScore, 6)
            let page = try await store!.qsos(sessionID: ids.session, offset: 0, limit: 20)
            XCTAssertEqual(page.count, 4)

            let corrected = replacingCall(committed[1], with: "N1NEW")
            let correction = try await store!.correctQSO(
                corrected, reason: "Correct copied call", operationTimestamp: date.addingTimeInterval(100),
                scope: scope(ids, request, revision: revision, draft: false),
                committedAt: date.addingTimeInterval(101))
            XCTAssertEqual(correction.score.totalPoints, 3)
            XCTAssertEqual(correction.score.multiplierCount, 3)
            XCTAssertEqual(correction.score.claimedScore, 9)
            store = nil

            let reopened = try SQLiteContestStore(databaseURL: url)
            let after = try await reopened.scoreSnapshot(sessionID: ids.session)
            XCTAssertEqual(after.score.totalPoints, 3)
            XCTAssertEqual(after.score.multiplierCount, 3)
            XCTAssertEqual(after.score.claimedScore, 9)
        }
    }

    func testStructuredSerialReservationRejectsForgedAggregateAndStationFields() async throws {
        let ids = IDs(20)
        let definition = try CWUniqueCallDeclarativeDefinitions.definition(for: .cwOpen)
        let rule = DeclarativeContestRule(definition: definition)
        let store = try SQLiteContestStore(databaseURL: databaseURL(20))
        _ = try await store.createDeclarativeSession(
            session(ids, rule, .cwOpen), metadata: .init(name: "CWO", operatorCallsign: "OM0RX",
                                                         operatorCategory: "single-op"),
            initialDraft: draft(ids, .cwOpen), canonicalDefinitionData: definition.canonicalStorageData(),
            scope: scope(ids, 1, revision: 0, draft: true), committedAt: date)
        let reservation = try await store.reserveSerial(
            reservationID: uuid(110, 1), serialScope: .session, scopeValue: "",
            scope: scope(ids, 2, revision: 1, draft: true), committedAt: date.addingTimeInterval(1))
        let valid = qso(ids, 1, variant: .cwOpen, serial: reservation.reservation.transmittedText,
                        call: "K1ABC", band: "20m", frequency: 14_025_000,
                        receivedName: "AL", receivedSerial: "101")

        let forged = replacingExchange(valid, sent: "999 OLIVER",
                                       fields: fields([("serial", "999"), ("name", "OLIVER")]))
        do {
            _ = try await store.commitQSO(forged, reservationID: reservation.reservation.id,
                                          scope: scope(ids, 3, revision: 2, draft: true),
                                          committedAt: date.addingTimeInterval(2))
            XCTFail("Expected forged serial field rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .reservationMismatch)
        }

        let inconsistent = replacingExchange(valid, sent: "001 BOB",
                                              fields: fields([("serial", "001"), ("name", "OLIVER")]))
        do {
            _ = try await store.commitQSO(inconsistent, reservationID: reservation.reservation.id,
                                          scope: scope(ids, 4, revision: 2, draft: true),
                                          committedAt: date.addingTimeInterval(3))
            XCTFail("Expected structured aggregate rejection")
        } catch let error as ContestStoreError {
            guard case let .invalidQSO(issues) = error else { return XCTFail("Unexpected error: \(error)") }
            XCTAssertTrue(issues.contains { $0.code == "structuredAggregateMismatch" })
        }

        let alteredStation = replacingExchange(valid, sent: "001 MALLORY",
                                                fields: fields([("serial", "001"), ("name", "MALLORY")]))
        do {
            _ = try await store.commitQSO(alteredStation, reservationID: reservation.reservation.id,
                                          scope: scope(ids, 5, revision: 2, draft: true),
                                          committedAt: date.addingTimeInterval(4))
            XCTFail("Expected station snapshot rejection")
        } catch let error as ContestStoreError {
            guard case let .invalidQSO(issues) = error else { return XCTFail("Unexpected error: \(error)") }
            XCTAssertTrue(issues.contains { $0.code == "sentExchangeMismatch" })
        }

        let committed = try await store.commitQSO(
            valid, reservationID: reservation.reservation.id,
            scope: scope(ids, 6, revision: 2, draft: true), committedAt: date.addingTimeInterval(5))
        XCTAssertEqual(committed.score.claimedScore, 1)
    }

    private func session(_ ids: IDs, _ rule: DeclarativeContestRule,
                         _ variant: CWUniqueCallContestVariant) -> ContestSessionSnapshot {
        let sent = stationFields(variant)
        return .init(id: ids.session, workspaceGeneration: ids.generation, rule: rule.metadata.identity,
                     referenceDataVersion: "cw-unique-call-fixture", startedAt: date,
                     station: .init(callsign: "OM0RX", entity: nil,
                                    sentExchange: variant == .cwt ? "OLIVER 1234" : "OLIVER",
                                    operatorCallsigns: ["OM0RX"], sentExchangeFields: sent))
    }

    private func draft(_ ids: IDs, _ variant: CWUniqueCallContestVariant) -> ContestDraftSnapshot {
        let sentText = variant == .cwt ? "OLIVER 1234" : "OLIVER"
        return .init(id: ids.draft, sessionID: ids.session, revision: 1, updatedAt: date,
                     callsign: "", band: "20m", mode: "CW", frequencyHz: 14_025_000,
                     rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: sentText, normalizedSent: sentText,
                                     rawReceived: "", normalizedReceived: "",
                                     sentFields: stationFields(variant)), entity: nil,
                     operatorCallsign: "OM0RX", stationLocation: "")
    }

    private func qso(_ ids: IDs, _ seed: Int, variant: CWUniqueCallContestVariant, serial: String?,
                     call: String, band: String, frequency: Int64,
                     receivedName: String, receivedSerial: String) -> ContestQSO {
        let sentFields: [String: ContestExchangeFieldValue]
        let receivedFields: [String: ContestExchangeFieldValue]
        let sentText: String
        let receivedText: String
        switch variant {
        case .cwt:
            sentFields = stationFields(variant)
            receivedFields = fields([("name", receivedName), ("member-or-location", receivedSerial)])
            sentText = "OLIVER 1234"
            receivedText = "\(receivedName) \(receivedSerial)"
        case .cwOpen:
            sentFields = fields([("serial", serial!), ("name", "OLIVER")])
            receivedFields = fields([("serial", receivedSerial), ("name", receivedName)])
            sentText = "\(serial!) OLIVER"
            receivedText = "\(receivedSerial) \(receivedName)"
        case .icwcMST:
            sentFields = fields([("name", "OLIVER"), ("serial", serial!)])
            receivedFields = fields([("name", receivedName), ("serial", receivedSerial)])
            sentText = "OLIVER \(serial!)"
            receivedText = "\(receivedName) \(receivedSerial)"
        }
        return .init(id: uuid(ids.offset, seed), sessionID: ids.session,
                     timestampUTC: date.addingTimeInterval(Double(seed)), callsign: call,
                     band: band, mode: "CW", frequencyHz: frequency, rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: sentText, normalizedSent: sentText,
                                     rawReceived: receivedText, normalizedReceived: receivedText,
                                     sentFields: sentFields, receivedFields: receivedFields), entity: nil,
                     operatorCallsign: "OM0RX", stationLocation: "",
                     provenance: .init(source: .operatorEntry))
    }

    private func stationFields(_ variant: CWUniqueCallContestVariant) -> [String: ContestExchangeFieldValue] {
        variant == .cwt ? fields([("name", "OLIVER"), ("member-or-location", "1234")])
                        : fields([("name", "OLIVER")])
    }

    private func fields(_ pairs: [(String, String)]) -> [String: ContestExchangeFieldValue] {
        Dictionary(uniqueKeysWithValues: pairs.map { ($0.0, .init(raw: $0.1, normalized: $0.1)) })
    }

    private func replacingCall(_ qso: ContestQSO, with callsign: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived, exchange: qso.exchange,
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func replacingExchange(
        _ qso: ContestQSO, sent: String,
        fields sentFields: [String: ContestExchangeFieldValue]
    ) -> ContestQSO {
        let exchange = ContestExchangeSnapshot(rawSent: sent, normalizedSent: sent,
                                               rawReceived: qso.exchange.rawReceived,
                                               normalizedReceived: qso.exchange.normalizedReceived,
                                               sentFields: sentFields,
                                               receivedFields: qso.exchange.receivedFields)
        return .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                     callsign: qso.callsign, band: qso.band, mode: qso.mode,
                     frequencyHz: qso.frequencyHz, rstSent: qso.rstSent, rstReceived: qso.rstReceived,
                     exchange: exchange, entity: qso.entity, operatorCallsign: qso.operatorCallsign,
                     stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func scope(_ ids: IDs, _ request: Int, revision: UInt64, draft: Bool) -> ContestMutationScope {
        .init(sessionID: ids.session, workspaceGeneration: ids.generation,
              requestID: uuid(80 + ids.offset, request), expectedRevision: revision,
              draftID: draft ? ids.draft : nil, payloadDigest: "cw-unique-\(request)")
    }

    private func databaseURL(_ offset: Int) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-cw-unique-\(UUID().uuidString)-\(offset).sqlite3")
    }

    private func uuid(_ group: Int, _ seed: Int) -> UUID {
        UUID(uuidString: String(format: "C7000000-0000-%04d-0000-%012d", group, seed))!
    }

    private struct IDs {
        let offset: Int
        let session: UUID
        let draft: UUID
        let generation: UUID

        init(_ offset: Int) {
            self.offset = offset
            session = UUID(uuidString: String(format: "C1000000-0000-%04d-0000-000000000001", offset))!
            draft = UUID(uuidString: String(format: "C2000000-0000-%04d-0000-000000000001", offset))!
            generation = UUID(uuidString: String(format: "C3000000-0000-%04d-0000-000000000001", offset))!
        }
    }
}
