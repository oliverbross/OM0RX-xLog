import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestJIDXStoreTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_300_000)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let japan = ContestEntitySnapshot(adif: 339, name: "JAPAN", countryPrefix: "JA", continent: "AS", cqZone: 25)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testBothModesPersistRawAndNormalizedEvidenceReopenAndReplayWithoutSerial() async throws {
        for (offset, rule) in [JIDXCWRule() as any ContestRule, JIDXSSBRule() as any ContestRule].enumerated() {
            let ids = IDs(offset)
            let url = databaseURL()
            var store: SQLiteContestStore? = try makeStore(url)
            let created = try await create(store!, ids: ids, rule: rule, stationRaw: "15", stationNormalized: "15")
            XCTAssertNil(created.projection.draftEvaluation.isDuplicate)
            let populated = draft(ids: ids, revision: 2, rule: rule, call: "JA1AAA",
                                  receivedRaw: "3", receivedNormalized: "03")
            let updated = try await store!.updateDraft(
                populated, scope: mutation(ids, request: 2, revision: 1, digest: "draft"),
                committedAt: date.addingTimeInterval(1))
            XCTAssertTrue(updated.projection.draftEvaluation.validation.isEmpty)
            let contact = qso(ids: ids, id: fixedUUID(100 + offset), rule: rule, call: "JA1AAA",
                              receivedRaw: "3", receivedNormalized: "03")
            let scope = mutation(ids, request: 3, revision: 2, digest: "commit")
            let committed = try await store!.commitQSO(contact, reservationID: nil, scope: scope,
                                                       committedAt: date.addingTimeInterval(2))
            XCTAssertEqual(committed.committedEvaluation.disposition, .accepted)
            XCTAssertEqual(committed.score.claimedScore, 1)
            XCTAssertEqual(committed.qso.exchange.rawReceived, "3")
            XCTAssertEqual(committed.qso.exchange.normalizedReceived, "03")
            XCTAssertEqual(committed.qso.exchange.receivedFields["number"]?.raw, "3")
            XCTAssertEqual(committed.qso.exchange.receivedFields["number"]?.normalized, "03")
            XCTAssertEqual(committed.draft.exchange.sentFields["number"]?.raw, "15")
            XCTAssertTrue(committed.draft.exchange.receivedFields.isEmpty)
            store = nil

            let reopened = try makeStore(url)
            let replay = try await reopened.commitQSO(contact, reservationID: nil, scope: scope,
                                                       committedAt: date.addingTimeInterval(99))
            XCTAssertEqual(replay, committed)
            let page = try await reopened.logPage(sessionID: ids.session, offset: 0, limit: 10)
            let score = try await reopened.scoreSnapshot(sessionID: ids.session)
            let reservations = try await reopened.reservations(sessionID: ids.session, draftID: ids.draft)
            XCTAssertEqual(page.qsos.singleValue?.exchange.rawReceived, "3")
            XCTAssertEqual(page.qsos.singleValue?.exchange.normalizedReceived, "03")
            XCTAssertEqual(score.score.claimedScore, 1)
            XCTAssertTrue(reservations.isEmpty)
        }
    }

    func testCorrectionDeletionDupePromotionAndRescoreSurviveRestart() async throws {
        let ids = IDs(10)
        let url = databaseURL()
        var store: SQLiteContestStore? = try makeStore(url)
        let rule = JIDXCWRule()
        _ = try await create(store!, ids: ids, rule: rule, stationRaw: "15", stationNormalized: "15")
        let first = qso(ids: ids, id: fixedUUID(201), rule: rule, call: "JA1AAA",
                        receivedRaw: "3", receivedNormalized: "03", timestampOffset: 10)
        let second = qso(ids: ids, id: fixedUUID(202), rule: rule, call: "JA1AAA",
                         receivedRaw: "3", receivedNormalized: "03", timestampOffset: 20)
        let firstResult = try await store!.commitQSO(
            first, reservationID: nil, scope: mutation(ids, request: 11, revision: 1, digest: "first"),
            committedAt: date.addingTimeInterval(1))
        XCTAssertEqual(firstResult.score.claimedScore, 1)
        let secondResult = try await store!.commitQSO(
            second, reservationID: nil, scope: mutation(ids, request: 12, revision: 2, digest: "second"),
            committedAt: date.addingTimeInterval(2))
        XCTAssertEqual(secondResult.committedEvaluation.disposition, .duplicate)
        XCTAssertEqual(secondResult.score.claimedScore, 1)

        let correctedQSO = changingReceived(first, call: "JA2BBB", raw: "20", normalized: "20")
        let corrected = try await store!.correctQSO(
            correctedQSO, reason: "Correct copied call", operationTimestamp: date.addingTimeInterval(3),
            scope: mutationWithoutDraft(ids, request: 13, revision: 3, digest: "correct"),
            committedAt: date.addingTimeInterval(3))
        XCTAssertEqual(corrected.score.totalPoints, 2)
        XCTAssertEqual(corrected.score.multiplierCount, 2)
        XCTAssertEqual(corrected.score.claimedScore, 4)
        store = nil

        let reopened = try makeStore(url)
        let reopenedScore = try await reopened.scoreSnapshot(sessionID: ids.session)
        XCTAssertEqual(reopenedScore.score.claimedScore, 4)
        let deleted = try await reopened.deleteQSO(
            id: first.id, reason: "Remove corrected contact", operationTimestamp: date.addingTimeInterval(4),
            scope: mutationWithoutDraft(ids, request: 14, revision: 4, digest: "delete"),
            committedAt: date.addingTimeInterval(4))
        XCTAssertEqual(deleted.score.qsoCount, 1)
        XCTAssertEqual(deleted.score.claimedScore, 1)
        let survivor = try await reopened.logPage(sessionID: ids.session, offset: 0, limit: 10)
        XCTAssertEqual(survivor.qsos.singleValue?.id, second.id)
        let audit = try await reopened.qsoAuditTrail(sessionID: ids.session, qsoID: first.id)
        XCTAssertEqual(audit.map(\.operation), [.correction, .deletion])
    }

    func testJapaneseAndMaritimeEntrantsPersistAndScoreInBothModes() async throws {
        let roles: [(String, ContestEntitySnapshot?, String, String,
                     String, ContestEntitySnapshot, String, String, Int64)] = [
            ("JA1ZZZ", japan, "3", "03", "K1AAA", usa, "5", "05", 2),
            ("K1AAA/MM", nil, "5", "05", "JA1AAA", japan, "3", "03", 1),
        ]
        var offset = 30
        for rule in [JIDXCWRule() as any ContestRule, JIDXSSBRule() as any ContestRule] {
            for role in roles {
                let ids = IDs(offset)
                offset += 1
                let url = databaseURL()
                var store: SQLiteContestStore? = try makeStore(url)
                let session = roleSession(ids: ids, rule: rule, call: role.0, entity: role.1,
                                          sentRaw: role.2, sentNormalized: role.3)
                _ = try await store!.createSession(
                    session, metadata: .init(name: "JIDX role preview", operatorCallsign: role.0,
                                             operatorCategory: "SINGLE-OP"),
                    initialDraft: roleDraft(ids: ids, rule: rule, stationCall: role.0,
                                            sentRaw: role.2, sentNormalized: role.3),
                    scope: mutation(ids, request: 1, revision: 0, digest: "create-role"),
                    committedAt: date)
                let contact = roleQSO(ids: ids, rule: rule, station: session,
                                      call: role.4, entity: role.5,
                                      receivedRaw: role.6, receivedNormalized: role.7)
                let commitScope = mutation(ids, request: 2, revision: 1, digest: "commit-role")
                let committed = try await store!.commitQSO(
                    contact, reservationID: nil,
                    scope: commitScope,
                    committedAt: date.addingTimeInterval(1))
                XCTAssertEqual(committed.score.claimedScore, role.8)
                store = nil

                let reopened = try makeStore(url)
                let replay = try await reopened.commitQSO(
                    contact, reservationID: nil, scope: commitScope,
                    committedAt: date.addingTimeInterval(99))
                let opened = try await reopened.openSession(id: ids.session)
                let page = try await reopened.logPage(sessionID: ids.session, offset: 0, limit: 10)
                XCTAssertEqual(opened.session.station.sentExchangeFields["number"]?.raw, role.2)
                XCTAssertEqual(opened.session.station.sentExchange, role.3)
                XCTAssertEqual(page.qsos.singleValue?.exchange.rawReceived, role.6)
                XCTAssertEqual(page.qsos.singleValue?.exchange.normalizedReceived, role.7)
                XCTAssertEqual(replay, committed)
            }
        }
    }

    func testMissingLandAndInvalidProvidedMaritimeEntitiesRejectAtomically() async throws {
        let rule = JIDXCWRule()
        let invalidEntity = ContestEntitySnapshot(adif: 0, name: "INVALID", countryPrefix: "K",
                                                  continent: "NA", cqZone: 5)
        let cases: [(Int, String, ContestEntitySnapshot?, String, String)] = [
            (50, "OM0RX", nil, "15", "15"),
            (51, "K1AAA/MM", invalidEntity, "5", "05"),
        ]
        for item in cases {
            let ids = IDs(item.0)
            let store = try makeStore(databaseURL())
            let session = roleSession(ids: ids, rule: rule, call: item.1, entity: item.2,
                                      sentRaw: item.3, sentNormalized: item.4)
            let scope = mutation(ids, request: 1, revision: 0, digest: "invalid-create")
            do {
                _ = try await store.createSession(
                    session, metadata: .init(name: "Invalid JIDX", operatorCallsign: item.1,
                                             operatorCategory: "SINGLE-OP"),
                    initialDraft: roleDraft(ids: ids, rule: rule, stationCall: item.1,
                                            sentRaw: item.3, sentNormalized: item.4),
                    scope: scope, committedAt: date)
                XCTFail("Expected invalid station entity rejection for \(item.1)")
            } catch let error as ContestStoreError {
                XCTAssertEqual(error, .invalidSession)
            }
            let sessions = try await store.listStoredSessions()
            XCTAssertTrue(sessions.isEmpty)
            do {
                _ = try await store.operationReceipt(sessionID: ids.session,
                                                     workspaceGeneration: ids.generation,
                                                     requestID: scope.requestID,
                                                     payloadDigest: scope.payloadDigest)
                XCTFail("Expected no durable session or operation receipt")
            } catch let error as ContestRepositoryError {
                XCTAssertEqual(error, .notFound)
            }
        }
    }

    func testCommittedSentNumberIsImmutableAndRejectedEditIsAtomic() async throws {
        let ids = IDs(20)
        let store = try makeStore(databaseURL())
        let rule = JIDXCWRule()
        _ = try await create(store, ids: ids, rule: rule, stationRaw: "15", stationNormalized: "15")
        let contact = qso(ids: ids, id: fixedUUID(301), rule: rule, call: "JA1AAA",
                          receivedRaw: "3", receivedNormalized: "03")
        _ = try await store.commitQSO(
            contact, reservationID: nil, scope: mutation(ids, request: 21, revision: 1, digest: "commit"),
            committedAt: date.addingTimeInterval(1))
        let forged = changingSent(contact, raw: "14", normalized: "14")
        do {
            _ = try await store.correctQSO(
                forged, reason: "Forbidden sent exchange edit", operationTimestamp: date.addingTimeInterval(2),
                scope: mutationWithoutDraft(ids, request: 22, revision: 2, digest: "forged"),
                committedAt: date.addingTimeInterval(2))
            XCTFail("Expected immutable sent exchange rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .immutableQSOField("allocatedSentSerial"))
        }
        let opened = try await store.openSession(id: ids.session)
        let page = try await store.logPage(sessionID: ids.session, offset: 0, limit: 10)
        let score = try await store.scoreSnapshot(sessionID: ids.session)
        XCTAssertEqual(opened.revision, 2)
        XCTAssertEqual(page.qsos.singleValue?.exchange.normalizedSent, "15")
        XCTAssertEqual(score.score.claimedScore, 1)
    }

    private func makeStore(_ url: URL) throws -> SQLiteContestStore {
        try SQLiteContestStore(databaseURL: url,
                               rules: ContestRuleRegistry([JIDXCWRule(), JIDXSSBRule()]))
    }

    private func create(_ store: SQLiteContestStore, ids: IDs, rule: any ContestRule,
                        stationRaw: String, stationNormalized: String) async throws -> ContestSessionCreationResult {
        try await store.createSession(
            session(ids: ids, rule: rule, stationRaw: stationRaw, stationNormalized: stationNormalized),
            metadata: .init(name: "JIDX preview", operatorCallsign: "OM0RX", operatorCategory: "SINGLE-OP"),
            initialDraft: emptyDraft(ids: ids, rule: rule, stationRaw: stationRaw,
                                     stationNormalized: stationNormalized),
            scope: mutation(ids, request: 1, revision: 0, digest: "create"), committedAt: date)
    }

    private func session(ids: IDs, rule: any ContestRule, stationRaw: String,
                         stationNormalized: String) -> ContestSessionSnapshot {
        .init(id: ids.session, workspaceGeneration: ids.generation, rule: rule.metadata.identity,
              referenceDataVersion: "jidx-fixture", startedAt: date,
              station: .init(callsign: "OM0RX", entity: slovakia, sentExchange: stationNormalized,
                             operatorCallsigns: ["OM0RX"], location: "fixture",
                             sentExchangeFields: number(raw: stationRaw, normalized: stationNormalized)))
    }

    private func emptyDraft(ids: IDs, rule: any ContestRule, stationRaw: String,
                            stationNormalized: String) -> ContestDraftSnapshot {
        .init(id: ids.draft, sessionID: ids.session, revision: 1, updatedAt: date,
              callsign: "", band: "20m", mode: rule.metadata.entry.mode,
              frequencyHz: rule.metadata.entry.mode == "SSB" ? 14_250_000 : 14_025_000,
              rstSent: rule.metadata.entry.mode == "SSB" ? "59" : "599", rstReceived: "",
              exchange: .init(rawSent: stationRaw, normalizedSent: stationNormalized,
                              rawReceived: "", normalizedReceived: "",
                              sentFields: number(raw: stationRaw, normalized: stationNormalized)),
              entity: nil, operatorCallsign: "OM0RX", stationLocation: "fixture")
    }

    private func draft(ids: IDs, revision: UInt64, rule: any ContestRule, call: String,
                       receivedRaw: String, receivedNormalized: String) -> ContestDraftSnapshot {
        let phone = rule.metadata.entry.mode == "SSB"
        return .init(id: ids.draft, sessionID: ids.session, revision: revision,
                     updatedAt: date.addingTimeInterval(1), callsign: call, band: "20m",
                     mode: rule.metadata.entry.mode, frequencyHz: phone ? 14_250_000 : 14_025_000,
                     rstSent: phone ? "59" : "599", rstReceived: phone ? "59" : "599",
                     exchange: .init(rawSent: "15", normalizedSent: "15",
                                     rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                                     sentFields: number(raw: "15", normalized: "15"),
                                     receivedFields: number(raw: receivedRaw, normalized: receivedNormalized)),
                     entity: japan, operatorCallsign: "OM0RX", stationLocation: "fixture")
    }

    private func qso(ids: IDs, id: UUID, rule: any ContestRule, call: String,
                     receivedRaw: String, receivedNormalized: String,
                     timestampOffset: TimeInterval = 10) -> ContestQSO {
        let phone = rule.metadata.entry.mode == "SSB"
        return .init(id: id, sessionID: ids.session, timestampUTC: date.addingTimeInterval(timestampOffset),
                     callsign: call, band: "20m", mode: rule.metadata.entry.mode,
                     frequencyHz: phone ? 14_250_000 : 14_025_000,
                     rstSent: phone ? "59" : "599", rstReceived: phone ? "59" : "599",
                     exchange: .init(rawSent: "15", normalizedSent: "15",
                                     rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                                     sentFields: number(raw: "15", normalized: "15"),
                                     receivedFields: number(raw: receivedRaw, normalized: receivedNormalized)),
                     entity: japan, operatorCallsign: "OM0RX", stationLocation: "fixture",
                     provenance: .init(source: .operatorEntry))
    }

    private func roleSession(ids: IDs, rule: any ContestRule, call: String,
                             entity: ContestEntitySnapshot?, sentRaw: String,
                             sentNormalized: String) -> ContestSessionSnapshot {
        .init(id: ids.session, workspaceGeneration: ids.generation, rule: rule.metadata.identity,
              referenceDataVersion: "jidx-fixture", startedAt: date,
              station: .init(callsign: call, entity: entity, sentExchange: sentNormalized,
                             operatorCallsigns: [call], location: "fixture",
                             sentExchangeFields: number(raw: sentRaw, normalized: sentNormalized)))
    }

    private func roleDraft(ids: IDs, rule: any ContestRule, stationCall: String,
                           sentRaw: String, sentNormalized: String) -> ContestDraftSnapshot {
        let phone = rule.metadata.entry.mode == "SSB"
        return .init(id: ids.draft, sessionID: ids.session, revision: 1, updatedAt: date,
                     callsign: "", band: "20m", mode: rule.metadata.entry.mode,
                     frequencyHz: phone ? 14_250_000 : 14_025_000,
                     rstSent: phone ? "59" : "599", rstReceived: "",
                     exchange: .init(rawSent: sentRaw, normalizedSent: sentNormalized,
                                     rawReceived: "", normalizedReceived: "",
                                     sentFields: number(raw: sentRaw, normalized: sentNormalized)),
                     entity: nil, operatorCallsign: stationCall, stationLocation: "fixture")
    }

    private func roleQSO(ids: IDs, rule: any ContestRule, station: ContestSessionSnapshot,
                         call: String, entity: ContestEntitySnapshot,
                         receivedRaw: String, receivedNormalized: String) -> ContestQSO {
        let phone = rule.metadata.entry.mode == "SSB"
        let sent = station.station.sentExchangeFields["number"]!
        return .init(id: fixedUUID(ids.offset * 100 + 50), sessionID: ids.session,
                     timestampUTC: date.addingTimeInterval(10), callsign: call,
                     band: "20m", mode: rule.metadata.entry.mode,
                     frequencyHz: phone ? 14_250_000 : 14_025_000,
                     rstSent: phone ? "59" : "599", rstReceived: phone ? "59" : "599",
                     exchange: .init(rawSent: sent.raw, normalizedSent: sent.normalized,
                                     rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                                     sentFields: ["number": sent],
                                     receivedFields: number(raw: receivedRaw, normalized: receivedNormalized)),
                     entity: entity, operatorCallsign: station.station.callsign,
                     stationLocation: "fixture", provenance: .init(source: .operatorEntry))
    }

    private func changingReceived(_ qso: ContestQSO, call: String,
                                  raw: String, normalized: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: call, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                              rawReceived: raw, normalizedReceived: normalized,
                              sentFields: qso.exchange.sentFields,
                              receivedFields: number(raw: raw, normalized: normalized)),
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func changingSent(_ qso: ContestQSO, raw: String, normalized: String) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: raw, normalizedSent: normalized,
                              rawReceived: qso.exchange.rawReceived,
                              normalizedReceived: qso.exchange.normalizedReceived,
                              sentFields: number(raw: raw, normalized: normalized),
                              receivedFields: qso.exchange.receivedFields),
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func number(raw: String, normalized: String) -> [String: ContestExchangeFieldValue] {
        ["number": .init(raw: raw, normalized: normalized)]
    }
    private func mutation(_ ids: IDs, request: Int, revision: UInt64, digest: String) -> ContestMutationScope {
        .init(sessionID: ids.session, workspaceGeneration: ids.generation,
              requestID: fixedUUID(ids.offset * 100 + request), expectedRevision: revision,
              draftID: ids.draft, payloadDigest: digest)
    }
    private func mutationWithoutDraft(_ ids: IDs, request: Int,
                                      revision: UInt64, digest: String) -> ContestMutationScope {
        .init(sessionID: ids.session, workspaceGeneration: ids.generation,
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
            session = UUID(uuidString: String(format: "EB000000-0000-0000-0000-%012d", offset + 1))!
            draft = UUID(uuidString: String(format: "EC000000-0000-0000-0000-%012d", offset + 1))!
            generation = UUID(uuidString: String(format: "ED000000-0000-0000-0000-%012d", offset + 1))!
        }
    }
    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "EE000000-0000-0000-0000-%012d", number))!
    }
    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-jidx-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }
}

private extension Array {
    var singleValue: Element? { count == 1 ? first : nil }
}
