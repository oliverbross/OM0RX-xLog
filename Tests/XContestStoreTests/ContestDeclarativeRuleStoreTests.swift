import Foundation
import XCTest
import XContestCore
import CSQLitePrototype
@testable import XContestStore

final class ContestDeclarativeRuleStoreTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_900_400_000)

    func testFourDefinitionsScoreDupeCorrectionAndRestartThroughSharedStorePath() async throws {
        for (offset, variant) in TenTenSeasonalVariant.allCases.enumerated() {
            let ids = IDs(offset)
            let rule = try TenTenDeclarativeDefinitions.rule(for: variant)
            let registry = ContestRuleRegistry([rule])
            let url = databaseURL()
            var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url, rules: registry)
            _ = try await store!.createSession(
                session(ids, rule), metadata: .init(name: variant.rawValue, operatorCallsign: "OM0RX",
                                                    operatorCategory: "single-op"),
                initialDraft: draft(ids, rule), scope: scope(ids, 1, revision: 0, draft: true), committedAt: date)
            let mode = rule.metadata.supportedModes.contains("CW") ? "CW" : "SSB"
            let first = qso(ids, 1, call: "K1ABC", member: "0", mode: mode)
            let second = qso(ids, 2, call: "W1XYZ", member: "123", mode: mode)
            let duplicate = qso(ids, 3, call: "W1XYZ", member: "999", mode: mode)
            _ = try await store!.commitQSO(first, reservationID: nil,
                                           scope: scope(ids, 2, revision: 1, draft: true),
                                           committedAt: date.addingTimeInterval(1))
            _ = try await store!.commitQSO(second, reservationID: nil,
                                           scope: scope(ids, 3, revision: 2, draft: true),
                                           committedAt: date.addingTimeInterval(2))
            let third = try await store!.commitQSO(duplicate, reservationID: nil,
                                                   scope: scope(ids, 4, revision: 3, draft: true),
                                                   committedAt: date.addingTimeInterval(3))
            XCTAssertEqual(third.committedEvaluation.disposition, .duplicate, variant.rawValue)
            XCTAssertEqual(third.score.claimedScore, 3, variant.rawValue)

            let corrected = qso(ids, 1, call: "K1ABC", member: "555", mode: mode)
            let correction = try await store!.correctQSO(
                corrected, reason: "Correct 10-10 member number",
                operationTimestamp: date.addingTimeInterval(4),
                scope: scope(ids, 5, revision: 4, draft: false),
                committedAt: date.addingTimeInterval(4))
            XCTAssertEqual(correction.score.claimedScore, 4, variant.rawValue)
            let originalIdentity = (try await store!.openSession(id: ids.session)).session.rule
            store = nil

            let reopened = try SQLiteContestStore(databaseURL: url, rules: registry)
            let snapshot = try await reopened.scoreSnapshot(sessionID: ids.session)
            let reopenedSession = try await reopened.openSession(id: ids.session)
            XCTAssertEqual(snapshot.score.claimedScore, 4, variant.rawValue)
            XCTAssertEqual(reopenedSession.session.rule, originalIdentity)
            XCTAssertEqual(originalIdentity.sourceRevision, rule.definition.definitionDigest)
        }
    }

    func testAuthoredDefinitionPersistsReopensWithoutRegistryAndPinsOldSessionScore() async throws {
        let url = databaseURL()
        let firstIDs = IDs(50)
        let firstDefinition = try authoredDefinition(version: "1.0.0", defaultPoints: 1, memberPoints: 2)
        let firstRule = DeclarativeContestRule(definition: firstDefinition)
        let firstBytes = try firstDefinition.canonicalStorageData()
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
        let createScope = scope(firstIDs, 1, revision: 0, draft: true)
        let created = try await store!.createDeclarativeSession(
            session(firstIDs, firstRule), metadata: metadata("Authored v1"), initialDraft: draft(firstIDs, firstRule),
            canonicalDefinitionData: firstBytes, scope: createScope, committedAt: date)
        let nonmember = qso(firstIDs, 1, call: "K1ABC", member: "0", mode: "SSB")
        _ = try await store!.commitQSO(nonmember, reservationID: nil,
                                       scope: scope(firstIDs, 2, revision: 1, draft: true),
                                       committedAt: date.addingTimeInterval(1))
        let replay = try await store!.createDeclarativeSession(
            session(firstIDs, firstRule), metadata: metadata("Authored v1"), initialDraft: draft(firstIDs, firstRule),
            canonicalDefinitionData: firstBytes, scope: createScope, committedAt: date.addingTimeInterval(99))
        XCTAssertEqual(replay, created)
        store = nil

        store = try SQLiteContestStore(databaseURL: url)
        let reopenedFirstScore = try await store!.scoreSnapshot(sessionID: firstIDs.session)
        XCTAssertEqual(reopenedFirstScore.score.claimedScore, 1)
        let corrected = qso(firstIDs, 1, call: "K1ABC", member: "555", mode: "SSB")
        let correction = try await store!.correctQSO(
            corrected, reason: "Correct member number", operationTimestamp: date.addingTimeInterval(2),
            scope: scope(firstIDs, 3, revision: 2, draft: false), committedAt: date.addingTimeInterval(2))
        XCTAssertEqual(correction.score.claimedScore, 2)

        let secondIDs = IDs(51)
        let secondDefinition = try authoredDefinition(version: "2.0.0", defaultPoints: 4, memberPoints: 9)
        let secondRule = DeclarativeContestRule(definition: secondDefinition)
        _ = try await store!.createDeclarativeSession(
            session(secondIDs, secondRule), metadata: metadata("Authored v2"), initialDraft: draft(secondIDs, secondRule),
            canonicalDefinitionData: secondDefinition.canonicalStorageData(),
            scope: scope(secondIDs, 1, revision: 0, draft: true), committedAt: date.addingTimeInterval(3))
        _ = try await store!.commitQSO(
            qso(secondIDs, 1, call: "W1XYZ", member: "0", mode: "SSB"), reservationID: nil,
            scope: scope(secondIDs, 2, revision: 1, draft: true), committedAt: date.addingTimeInterval(4))
        let secondScore = try await store!.scoreSnapshot(sessionID: secondIDs.session)
        let pinnedFirstScore = try await store!.scoreSnapshot(sessionID: firstIDs.session)
        XCTAssertEqual(secondScore.score.claimedScore, 4)
        XCTAssertEqual(pinnedFirstScore.score.claimedScore, 2)
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM declarative_definitions", at: url), 2)

        let snapshotDirectory = snapshotDirectoryURL()
        let snapshot = try await ContestDatabaseSnapshotter().createSnapshot(
            sourceDatabaseURL: url, destinationDirectoryURL: snapshotDirectory)
        XCTAssertEqual(snapshot.schemaVersion, 3)
        XCTAssertEqual(snapshot.tableCounts["declarative_definitions"], 2)
        let copied = try SQLiteContestStore(
            databaseURL: snapshotDirectory.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName))
        let copiedFirstScore = try await copied.scoreSnapshot(sessionID: firstIDs.session)
        let copiedSecondScore = try await copied.scoreSnapshot(sessionID: secondIDs.session)
        XCTAssertEqual(copiedFirstScore.score.claimedScore, 2)
        XCTAssertEqual(copiedSecondScore.score.claimedScore, 4)
    }

    func testAdmissionRejectsUnknownPolicyNoncanonicalBytesAndRollsBackDefinition() async throws {
        let url = databaseURL()
        let ids = IDs(60)
        let definition = try authoredDefinition(version: "1.0.0", defaultPoints: 1, memberPoints: 2)
        let rule = DeclarativeContestRule(definition: definition)
        let canonical = try definition.canonicalStorageData()
        let unknown = Data(String(decoding: canonical, as: UTF8.self)
            .replacingOccurrences(of: "oncePerContest", with: "futurePolicy").utf8)
        let store = try SQLiteContestStore(databaseURL: url)
        do {
            _ = try await store.createDeclarativeSession(
                session(ids, rule), metadata: metadata("Unknown"), initialDraft: draft(ids, rule),
                canonicalDefinitionData: unknown, scope: scope(ids, 1, revision: 0, draft: true), committedAt: date)
            XCTFail("Expected unknown policy rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidDeclarativeDefinition)
        }
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM declarative_definitions", at: url), 0)

        do {
            _ = try await store.createDeclarativeSession(
                session(ids, rule), metadata: .init(name: "", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
                initialDraft: draft(ids, rule), canonicalDefinitionData: canonical,
                scope: scope(ids, 2, revision: 0, draft: true), committedAt: date)
            XCTFail("Expected invalid session rollback")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidSession)
        }
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM declarative_definitions", at: url), 0)
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM sessions", at: url), 0)

        _ = try await store.createDeclarativeSession(
            session(ids, rule), metadata: metadata("Valid"), initialDraft: draft(ids, rule),
            canonicalDefinitionData: canonical, scope: scope(ids, 3, revision: 0, draft: true), committedAt: date)
        do {
            _ = try await store.createDeclarativeSession(
                session(ids, rule), metadata: metadata("Changed payload"), initialDraft: draft(ids, rule),
                canonicalDefinitionData: canonical, scope: scope(ids, 3, revision: 0, draft: true), committedAt: date)
            XCTFail("Expected replay payload conflict")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .requestPayloadConflict(requestID: scope(ids, 3, revision: 0, draft: true).requestID))
        }
        let noncanonical = canonical + Data([0x0A])
        do {
            _ = try await store.createDeclarativeSession(
                session(IDs(61), rule), metadata: metadata("Noncanonical"), initialDraft: draft(IDs(61), rule),
                canonicalDefinitionData: noncanonical, scope: scope(IDs(61), 1, revision: 0, draft: true),
                committedAt: date)
            XCTFail("Expected noncanonical bytes rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .invalidDeclarativeDefinition)
        }
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM declarative_definitions", at: url), 1)
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM sessions", at: url), 1)
    }

    func testCorruptStoredDefinitionFailsClosedAndVersionTwoLegacyDatabaseMigrates() async throws {
        let corruptURL = databaseURL()
        let corruptIDs = IDs(70)
        let definition = try authoredDefinition(version: "1.0.0", defaultPoints: 1, memberPoints: 2)
        let rule = DeclarativeContestRule(definition: definition)
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: corruptURL)
        _ = try await store!.createDeclarativeSession(
            session(corruptIDs, rule), metadata: metadata("Corrupt"), initialDraft: draft(corruptIDs, rule),
            canonicalDefinitionData: definition.canonicalStorageData(),
            scope: scope(corruptIDs, 1, revision: 0, draft: true), committedAt: date)
        try rawExecute("UPDATE declarative_definitions SET canonical_definition=X'7B7D'", at: corruptURL)
        let conflictingIDs = IDs(72)
        do {
            _ = try await store!.createDeclarativeSession(
                session(conflictingIDs, rule), metadata: metadata("Conflict"),
                initialDraft: draft(conflictingIDs, rule),
                canonicalDefinitionData: definition.canonicalStorageData(),
                scope: scope(conflictingIDs, 1, revision: 0, draft: true), committedAt: date)
            XCTFail("Expected same-identity different-bytes rejection")
        } catch let error as ContestStoreError {
            XCTAssertEqual(error, .declarativeDefinitionConflict)
        }
        store = nil
        XCTAssertThrowsError(try SQLiteContestStore(databaseURL: corruptURL,
                                                     rules: ContestRuleRegistry([rule]))) { error in
            XCTAssertEqual(error as? ContestStoreError, .corruptRecord)
        }

        let legacyURL = databaseURL()
        let legacyIDs = IDs(71)
        var legacy: SQLiteContestStore? = try SQLiteContestStore(databaseURL: legacyURL,
                                                                  rules: ContestRuleRegistry([rule]))
        _ = try await legacy!.createSession(
            session(legacyIDs, rule), metadata: metadata("Legacy"), initialDraft: draft(legacyIDs, rule),
            scope: scope(legacyIDs, 1, revision: 0, draft: true), committedAt: date)
        legacy = nil
        try rawExecute("DROP TABLE declarative_definitions; PRAGMA user_version=2", at: legacyURL)
        let migrated = try SQLiteContestStore(databaseURL: legacyURL, rules: ContestRuleRegistry([rule]))
        let migratedSession = try await migrated.openSession(id: legacyIDs.session)
        XCTAssertEqual(try rawScalar("PRAGMA user_version", at: legacyURL), 3)
        XCTAssertEqual(migratedSession.session.rule, rule.metadata.identity)
        XCTAssertEqual(try rawScalar("SELECT COUNT(*) FROM declarative_definitions", at: legacyURL), 0)
    }

    private func session(_ ids: IDs, _ rule: DeclarativeContestRule) -> ContestSessionSnapshot {
        .init(id: ids.session, workspaceGeneration: ids.generation, rule: rule.metadata.identity,
              referenceDataVersion: "ten-ten-fixture", startedAt: date,
              station: .init(callsign: "OM0RX", entity: nil, sentExchange: "OLIVER 12345 AUSTRALIA",
                             operatorCallsigns: ["OM0RX"], sentExchangeFields: fields("OLIVER", "12345", "AUSTRALIA")))
    }

    private func draft(_ ids: IDs, _ rule: DeclarativeContestRule) -> ContestDraftSnapshot {
        let mode = rule.metadata.supportedModes.contains("CW") ? "CW" : "SSB"
        return .init(id: ids.draft, sessionID: ids.session, revision: 1, updatedAt: date,
                     callsign: "", band: "10m", mode: mode, frequencyHz: mode == "CW" ? 28_050_000 : 28_500_000,
                     rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: "OLIVER 12345 AUSTRALIA", normalizedSent: "OLIVER 12345 AUSTRALIA",
                                     rawReceived: "", normalizedReceived: "",
                                     sentFields: fields("OLIVER", "12345", "AUSTRALIA")),
                     entity: nil, operatorCallsign: "OM0RX", stationLocation: "")
    }

    private func qso(_ ids: IDs, _ seed: Int, call: String, member: String, mode: String) -> ContestQSO {
        let report = mode == "CW" ? "599" : "59"
        return .init(id: UUID(uuidString: String(format: "EC000000-0000-%04d-0000-%012d", ids.offset + 1, seed))!,
                     sessionID: ids.session, timestampUTC: date.addingTimeInterval(Double(seed)), callsign: call,
                     band: "10m", mode: mode, frequencyHz: mode == "CW" ? 28_050_000 : 28_500_000,
                     rstSent: report, rstReceived: report,
                     exchange: .init(rawSent: "OLIVER 12345 AUSTRALIA", normalizedSent: "OLIVER 12345 AUSTRALIA",
                                     rawReceived: "AL \(member) USA", normalizedReceived: "AL \(member) USA",
                                     sentFields: fields("OLIVER", "12345", "AUSTRALIA"),
                                     receivedFields: fields("AL", member, "USA")),
                     entity: nil, operatorCallsign: "OM0RX", stationLocation: "",
                     provenance: .init(source: .operatorEntry))
    }

    private func fields(_ name: String, _ member: String, _ qth: String) -> [String: ContestExchangeFieldValue] {
        ["name": .init(raw: name, normalized: name),
         "member-number": .init(raw: member, normalized: member),
         "qth": .init(raw: qth, normalized: qth)]
    }

    private func metadata(_ name: String) -> ContestSessionMetadata {
        .init(name: name, operatorCallsign: "OM0RX", operatorCategory: "single-op")
    }

    private func authoredDefinition(version: String, defaultPoints: Int64,
                                    memberPoints: Int64) throws -> ContestDeclarativeDefinition {
        let base = TenTenDeclarativeDefinitions.draft(for: .winterPhone)
        return try ContestDefinitionDraft(
            id: "operator-authored-ten-ten", version: version, edition: "operator-reviewed",
            displayName: "Operator Authored 10-10", cabrilloName: base.cabrilloName,
            supportedBands: base.supportedBands, supportedModes: base.supportedModes,
            entry: base.entry, sourceProvenance: "operator-authored persistence fixture",
            dupePolicy: .oncePerContest, multiplierPolicy: .none,
            scoring: .init(defaultPoints: defaultPoints, clauses: [
                .init(fieldID: "member-number", comparison: .greaterThan, threshold: 0, points: memberPoints),
            ]), eligibilityPolicy: .unrestricted, exportPolicy: .unsupported,
            stationEntityRequired: false).materialized()
    }

    private func scope(_ ids: IDs, _ request: Int, revision: UInt64, draft: Bool) -> ContestMutationScope {
        .init(sessionID: ids.session, workspaceGeneration: ids.generation,
              requestID: UUID(uuidString: String(format: "ED000000-0000-%04d-0000-%012d", ids.offset + 1, request))!,
              expectedRevision: revision, draftID: draft ? ids.draft : nil, payloadDigest: "request-\(request)")
    }

    private struct IDs {
        let offset: Int
        let session: UUID
        let draft: UUID
        let generation: UUID
        init(_ offset: Int) {
            self.offset = offset
            session = UUID(uuidString: String(format: "EE000000-0000-%04d-0000-000000000001", offset + 1))!
            draft = UUID(uuidString: String(format: "EE000000-0000-%04d-0000-000000000002", offset + 1))!
            generation = UUID(uuidString: String(format: "EE000000-0000-%04d-0000-000000000003", offset + 1))!
        }
    }

    private func databaseURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-declarative-store-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("contest.sqlite")
    }

    private func snapshotDirectoryURL() -> URL {
        let parent = FileManager.default.temporaryDirectory
            .appendingPathComponent("xcontest-declarative-snapshot-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: parent) }
        return parent.appendingPathComponent("snapshot", isDirectory: true)
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
            throw ContestStoreError.database("raw prepare")
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw ContestStoreError.database("raw scalar") }
        return Int(sqlite3_column_int64(statement, 0))
    }
}
