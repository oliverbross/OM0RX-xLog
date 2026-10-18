import Foundation
import XCTest
import XContestCore
@testable import XContestStore

final class ContestARRLVHFStoreTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_900_900_000)

    func testRoverGridMovePersistsNewStationAndDraftWithoutRewritingExistingQSO() async throws {
        let fixture = try await makeStore(category: .rover)
        let committed = try await fixture.store.commitQSO(
            qso(fixture, id: uuid(20), receivedGrid: "FN32"), reservationID: nil,
            scope: scope(fixture, request: 2, revision: 1), committedAt: base.addingTimeInterval(1))
        let before = try await fixture.store.qso(sessionID: fixture.sessionID, id: uuid(20))
        let definitionBefore = try await fixture.store.sessionReadSnapshot(id: fixture.sessionID).canonicalDefinitionData

        let moved = try await fixture.store.moveStationGrid(
            to: "FN42", operationTimestamp: base.addingTimeInterval(2),
            scope: scope(fixture, request: 3, revision: committed.session.revision),
            committedAt: base.addingTimeInterval(2))

        XCTAssertEqual(moved.previousGrid, "FN31")
        XCTAssertEqual(moved.currentGrid, "FN42")
        XCTAssertEqual(moved.session.session.station.location, "FN42")
        XCTAssertEqual(moved.session.session.station.sentExchangeFields["grid"]?.normalized, "FN42")
        XCTAssertEqual(moved.draft.stationLocation, "FN42")
        XCTAssertEqual(moved.draft.exchange.sentFields["grid"]?.normalized, "FN42")
        XCTAssertEqual(moved.operationTimestamp, base.addingTimeInterval(2))
        let qsoAfter = try await fixture.store.qso(sessionID: fixture.sessionID, id: uuid(20))
        let definitionAfter = try await fixture.store.sessionReadSnapshot(id: fixture.sessionID).canonicalDefinitionData
        XCTAssertEqual(qsoAfter, before)
        XCTAssertEqual(definitionAfter, definitionBefore)
        XCTAssertEqual(moved.projection.session, moved.session)
        XCTAssertEqual(moved.projection.draft, moved.draft)
    }

    func testExactReplaySurvivesLaterMoveAndRejectsConflictingPayload() async throws {
        let fixture = try await makeStore(category: .rover)
        let firstScope = scope(fixture, request: 2, revision: 1)
        let first = try await fixture.store.moveStationGrid(
            to: "FN42", operationTimestamp: base.addingTimeInterval(1), scope: firstScope,
            committedAt: base.addingTimeInterval(1))
        _ = try await fixture.store.moveStationGrid(
            to: "FN52", operationTimestamp: base.addingTimeInterval(2),
            scope: scope(fixture, request: 3, revision: 2), committedAt: base.addingTimeInterval(2))

        let replay = try await fixture.store.moveStationGrid(
            to: "FN42", operationTimestamp: base.addingTimeInterval(1), scope: firstScope,
            committedAt: base.addingTimeInterval(99))
        XCTAssertEqual(replay, first)
        do {
            _ = try await fixture.store.moveStationGrid(
                to: "FN62", operationTimestamp: base.addingTimeInterval(1), scope: firstScope,
                committedAt: base.addingTimeInterval(99))
            XCTFail("Expected canonical payload conflict")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .requestPayloadConflict(requestID: firstScope.requestID))
        }
    }

    func testFixedInvalidUnchangedStaleAndInjectedFailureAreAtomic() async throws {
        let fixed = try await makeStore(category: .fixed)
        for grid in ["FN42", "fn42", "FN4", "ZZ99"] {
            do {
                _ = try await fixed.store.moveStationGrid(
                    to: grid, operationTimestamp: base.addingTimeInterval(1),
                    scope: scope(fixed, request: 10 + grid.count, revision: 1),
                    committedAt: base.addingTimeInterval(1))
                XCTFail("Expected grid move rejection for \(grid)")
            } catch { }
            let stored = try await fixed.store.openSession(id: fixed.sessionID)
            XCTAssertEqual(stored.revision, 1)
        }

        let rover = try await makeStore(category: .rover, offset: 100)
        do {
            _ = try await rover.store.moveStationGrid(
                to: "FN31", operationTimestamp: base, scope: scope(rover, request: 2, revision: 1),
                committedAt: base)
            XCTFail("Expected unchanged grid rejection")
        } catch { }
        do {
            _ = try await rover.store.moveStationGrid(
                to: "FN42", operationTimestamp: base, scope: scope(rover, request: 3, revision: 0),
                committedAt: base)
            XCTFail("Expected stale revision")
        } catch let error as ContestRepositoryError {
            XCTAssertEqual(error, .staleRevision(expected: 0, actual: 1))
        }
        await rover.store.installMutationWriteHookForTesting { stage in
            if stage == "afterGridMove" { throw ContestStoreError.database("injected") }
        }
        do {
            _ = try await rover.store.moveStationGrid(
                to: "FN42", operationTimestamp: base.addingTimeInterval(1),
                scope: scope(rover, request: 4, revision: 1), committedAt: base.addingTimeInterval(1))
            XCTFail("Expected injected rollback")
        } catch { }
        await rover.store.installMutationWriteHookForTesting(nil)
        let reopened = try await rover.store.openSession(id: rover.sessionID)
        XCTAssertEqual(reopened.revision, 1)
        XCTAssertEqual(reopened.session.station.location, "FN31")
        let draftAfter = try await rover.store.draft(sessionID: rover.sessionID, id: rover.draftID)
        XCTAssertEqual(draftAfter.stationLocation, "FN31")
    }

    private struct Fixture {
        let store: SQLiteContestStore
        let sessionID: UUID
        let generation: UUID
        let draftID: UUID
        let definition: ContestDeclarativeDefinition
    }

    private func makeStore(category: ARRLVHFStationCategory, offset: Int = 0) async throws -> Fixture {
        let definition = try ARRLVHFDeclarativeDefinitions.definition(for: .june, category: category)
        let sessionID = uuid(1 + offset), generation = uuid(2 + offset), draftID = uuid(3 + offset)
        let stationEntity = ContestEntitySnapshot(adif: 291, name: "United States", countryPrefix: "K",
                                                 continent: "NA", cqZone: 5)
        let grid = ContestExchangeFieldValue(raw: "FN31", normalized: "FN31")
        let station = ContestStationSnapshot(callsign: "W1AW", entity: stationEntity,
                                             sentExchange: "FN31", operatorCallsigns: ["W1AW"],
                                             location: "FN31", sentExchangeFields: ["grid": grid])
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
                                             rule: definition.identity, referenceDataVersion: "arrl-vhf-preview-1",
                                             startedAt: base, station: station)
        let exchange = ContestExchangeSnapshot(rawSent: "FN31", normalizedSent: "FN31",
                                               rawReceived: "", normalizedReceived: "",
                                               sentFields: ["grid": grid])
        let draft = ContestDraftSnapshot(id: draftID, sessionID: sessionID, revision: 1,
                                         updatedAt: base, callsign: "", band: "2m", mode: "CW",
                                         frequencyHz: 144_100_000, rstSent: "", rstReceived: "",
                                         exchange: exchange, entity: nil,
                                         operatorCallsign: "W1AW", stationLocation: "FN31")
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-vhf-grid-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let store = try SQLiteContestStore(databaseURL: directory.appendingPathComponent("contest.sqlite"))
        _ = try await store.createDeclarativeSession(
            session, metadata: .init(name: "VHF Rover", operatorCallsign: "W1AW",
                                     operatorCategory: category.rawValue),
            initialDraft: draft, canonicalDefinitionData: definition.canonicalStorageData(),
            scope: ContestMutationScope(sessionID: sessionID, workspaceGeneration: generation,
                                        requestID: uuid(10 + offset), expectedRevision: 0,
                                        draftID: draftID, payloadDigest: "create-\(offset)"),
            committedAt: base)
        return Fixture(store: store, sessionID: sessionID, generation: generation,
                       draftID: draftID, definition: definition)
    }

    private func scope(_ fixture: Fixture, request: Int, revision: UInt64) -> ContestMutationScope {
        ContestMutationScope(sessionID: fixture.sessionID, workspaceGeneration: fixture.generation,
                             requestID: uuid(request), expectedRevision: revision,
                             draftID: fixture.draftID, payloadDigest: "payload-\(request)")
    }

    private func qso(_ fixture: Fixture, id: UUID, receivedGrid: String) -> ContestQSO {
        let sent = ContestExchangeFieldValue(raw: "FN31", normalized: "FN31")
        let received = ContestExchangeFieldValue(raw: receivedGrid, normalized: receivedGrid)
        return ContestQSO(id: id, sessionID: fixture.sessionID,
                          timestampUTC: base.addingTimeInterval(1), callsign: "K1ABC",
                          band: "2m", mode: "CW", frequencyHz: 144_100_000,
                          rstSent: "", rstReceived: "",
                          exchange: .init(rawSent: "FN31", normalizedSent: "FN31",
                                          rawReceived: receivedGrid, normalizedReceived: receivedGrid,
                                          sentFields: ["grid": sent], receivedFields: ["grid": received]),
                          entity: .init(adif: 291, name: "United States", countryPrefix: "K",
                                        continent: "NA", cqZone: 5),
                          operatorCallsign: "W1AW", stationLocation: "FN31",
                          provenance: .init(source: .operatorEntry))
    }

    private func uuid(_ value: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", value))!
    }
}
