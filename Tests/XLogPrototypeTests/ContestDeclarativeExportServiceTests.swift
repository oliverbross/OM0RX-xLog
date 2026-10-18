import Foundation
import XCTest
import XContestCore
import XContestStore
@testable import XLogPrototypeSupport

final class ContestDeclarativeExportServiceTests: XCTestCase {
    private let generation = UUID(uuidString: "EB000000-0000-0000-0000-000000000001")!
    private let sessionID = UUID(uuidString: "EB000000-0000-0000-0000-000000000002")!
    private let draftID = UUID(uuidString: "EB000000-0000-0000-0000-000000000003")!
    private let date = Date(timeIntervalSince1970: 1_900_500_000)

    func testPersistedArchiveReopensWithoutRegistryExportsRetainedDuplicatesAndCorrection() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("declarative-archive-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("contests.sqlite")
        let definition = try CWUniqueCallDeclarativeDefinitions.archiveDefinition(for: .cwt)
        let rule = DeclarativeContestRule(definition: definition)
        var store: SQLiteContestStore? = try SQLiteContestStore(databaseURL: url)
        let session = makeSession(rule)
        _ = try await store!.createDeclarativeSession(
            session, metadata: .init(name: "CWT operator archive", operatorCallsign: "OM0RX",
                                     operatorCategory: "single-op"), initialDraft: makeDraft(rule),
            canonicalDefinitionData: definition.canonicalStorageData(),
            scope: scope(request: 1, revision: 0, includeDraft: true), committedAt: date)

        for number in 1...2 {
            let revision = try await store!.openSession(id: sessionID).revision
            _ = try await store!.commitQSO(
                makeQSO(number: number, call: "K1ABC"), reservationID: nil,
                scope: scope(request: 10 + number, revision: revision),
                committedAt: date.addingTimeInterval(TimeInterval(number)))
        }
        let captured = try await store!.sessionReadSnapshot(id: sessionID)
        XCTAssertEqual(captured.canonicalDefinitionData, try definition.canonicalStorageData())
        let historicalJSON = try JSONEncoder().encode(ContestSessionReadSnapshot(
            session: captured.session, drafts: captured.drafts,
            activeReservations: captured.activeReservations, qsos: captured.qsos))
        XCTAssertFalse(String(decoding: historicalJSON, as: UTF8.self).contains("canonicalDefinitionData"))
        XCTAssertNil(try JSONDecoder().decode(ContestSessionReadSnapshot.self, from: historicalJSON).canonicalDefinitionData)

        store = nil
        let reopened = try SQLiteContestStore(databaseURL: url)
        var revision = try await reopened.openSession(id: sessionID).revision
        let service = ContestExportService(repository: reopened, rules: ContestRuleRegistry([]))
        let first = try await service.export(
            sessionID: sessionID, expectedWorkspaceGeneration: generation, expectedRevision: revision,
            generatedAtUTC: date.addingTimeInterval(100), format: .cabrillo, header: header())
        XCTAssertEqual(first.declarativePurpose, .operatorArchive)
        XCTAssertEqual(first.qsoCount, 2)
        XCTAssertEqual(first.claimedScore, 1)
        XCTAssertEqual(String(decoding: first.data, as: UTF8.self)
            .components(separatedBy: "\r\n").filter { $0.hasPrefix("QSO: ") }.count, 2)

        let adif = try await service.export(
            sessionID: sessionID, expectedWorkspaceGeneration: generation, expectedRevision: revision,
            generatedAtUTC: date.addingTimeInterval(100), format: .adif, header: header())
        XCTAssertEqual(adif.declarativePurpose, .operatorArchive)
        XCTAssertTrue(String(decoding: adif.data, as: UTF8.self)
            .contains("<APP_OM0RXXLOG_EXPORT_PURPOSE:16>OPERATOR_ARCHIVE"))

        let old = try await reopened.qso(sessionID: sessionID, id: qsoID(2))
        let corrected = ContestQSO(
            id: old.id, sessionID: old.sessionID, timestampUTC: old.timestampUTC, callsign: "W1XYZ",
            band: old.band, mode: old.mode, frequencyHz: old.frequencyHz, rstSent: old.rstSent,
            rstReceived: old.rstReceived, exchange: old.exchange, entity: old.entity,
            operatorCallsign: old.operatorCallsign, stationLocation: old.stationLocation, provenance: old.provenance)
        _ = try await reopened.correctQSO(
            corrected, reason: "correct copied callsign", operationTimestamp: date.addingTimeInterval(200),
            scope: scope(request: 20, revision: revision, includeDraft: false),
            committedAt: date.addingTimeInterval(200))
        revision = try await reopened.openSession(id: sessionID).revision
        let after = try await service.export(
            sessionID: sessionID, expectedWorkspaceGeneration: generation, expectedRevision: revision,
            generatedAtUTC: date.addingTimeInterval(201), format: .cabrillo, header: header())
        XCTAssertEqual(after.claimedScore, 4)
        XCTAssertNotEqual(after.data, first.data)
    }

    private func makeSession(_ rule: DeclarativeContestRule) -> ContestSessionSnapshot {
        let sent = fields(name: "OLIVER", member: "1234")
        return .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
                     referenceDataVersion: "archive-fixture", startedAt: date,
                     station: .init(callsign: "OM0RX", entity: nil, sentExchange: "OLIVER 1234",
                                    operatorCallsigns: ["OM0RX"], location: "DX", sentExchangeFields: sent))
    }

    private func makeDraft(_ rule: DeclarativeContestRule) -> ContestDraftSnapshot {
        .init(id: draftID, sessionID: sessionID, revision: 1, updatedAt: date, callsign: "",
              band: "20m", mode: "CW", frequencyHz: 14_030_000, rstSent: "", rstReceived: "",
              exchange: .init(rawSent: "OLIVER 1234", normalizedSent: "OLIVER 1234",
                              rawReceived: "", normalizedReceived: "",
                              sentFields: fields(name: "OLIVER", member: "1234")), entity: nil,
              operatorCallsign: "OM0RX", stationLocation: "DX")
    }

    private func makeQSO(number: Int, call: String) -> ContestQSO {
        let sent = fields(name: "OLIVER", member: "1234")
        let received = fields(name: number == 1 ? "AL" : "BOB", member: "5678")
        let receivedText = number == 1 ? "AL 5678" : "BOB 5678"
        return .init(id: qsoID(number), sessionID: sessionID,
                     timestampUTC: date.addingTimeInterval(TimeInterval(number)), callsign: call,
                     band: "20m", mode: "CW", frequencyHz: 14_030_000, rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: "OLIVER 1234", normalizedSent: "OLIVER 1234",
                                     rawReceived: receivedText, normalizedReceived: receivedText,
                                     sentFields: sent, receivedFields: received), entity: nil,
                     operatorCallsign: "OM0RX", stationLocation: "DX",
                     provenance: .init(source: .operatorEntry))
    }

    private func fields(name: String, member: String) -> [String: ContestExchangeFieldValue] {
        ["name": .init(raw: name, normalized: name),
         "member-or-location": .init(raw: member, normalized: member)]
    }

    private func header() -> CabrilloHeader {
        .init(callsign: "OM0RX", categoryOperator: "SINGLE-OP", categoryAssisted: "NON-ASSISTED",
              categoryBand: "ALL", categoryMode: "CW", categoryTransmitter: "ONE",
              categoryPower: "LOW", operators: ["OM0RX"], location: "DX",
              name: "Oliver Operator", email: "operator@example.test")
    }

    private func scope(request: Int, revision: UInt64, includeDraft: Bool = true) -> ContestMutationScope {
        .init(sessionID: sessionID, workspaceGeneration: generation,
              requestID: UUID(uuidString: String(format: "EB000000-0000-0000-0001-%012d", request))!,
              expectedRevision: revision, draftID: includeDraft ? draftID : nil,
              payloadDigest: "archive-\(request)")
    }

    private func qsoID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "EB000000-0000-0000-0002-%012d", number))!
    }
}
