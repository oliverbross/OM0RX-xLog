import Foundation
import XCTest
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

final class ContestLogTransferTests: XCTestCase {
    func testDatabaseTransferIsReceiptBackedRepeatSafeAndDoesNotUseSemanticDedupe() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite")
        let database = try LogbookDatabase(url: url)
        let sessionID = UUID(), generation = UUID(), sourceA = UUID(), sourceB = UUID()
        let moment = Date(timeIntervalSince1970: 1_790_000_000)
        let first = QSO(id: UUID(), call: "K1ABC", start: moment, band: "20m", mode: "CW")
        let semanticTwin = QSO(id: UUID(), call: "K1ABC", start: moment, band: "20m", mode: "CW")
        let manifest = ContestLogTransferManifest(contestSessionID: sessionID,
            workspaceGeneration: generation, sourceRevision: 4, sourceDigest: "manifest-a",
            provenance: "not1mm-python:test", items: [
                .init(qsoID: sourceA, sourceDigest: "source-a", sourcePayload: Data("a".utf8), qso: first),
                .init(qsoID: sourceB, sourceDigest: "source-b", sourcePayload: Data("b".utf8), qso: semanticTwin),
            ])

        let prepared = try database.prepareContestLogTransfer(manifest)
        XCTAssertEqual(try database.prepareContestLogTransfer(manifest).id, prepared.id)
        let applied = try database.applyContestLogTransfer(manifestID: prepared.id)
        XCTAssertEqual(applied.inserted.count, 2)
        XCTAssertEqual(applied.alreadyTransferred.count, 0)
        XCTAssertEqual(try database.fetchAll().count, 2, "Source identity, not semantic equality, owns transfer idempotency")

        let replay = try database.applyContestLogTransfer(manifestID: prepared.id)
        XCTAssertEqual(replay.inserted.count, 0)
        XCTAssertEqual(replay.alreadyTransferred.map(\.qsoID).sorted { $0.uuidString < $1.uuidString },
                       [sourceA, sourceB].sorted { $0.uuidString < $1.uuidString })
        database.close()

        let reopened = try LogbookDatabase(url: url)
        let status = try reopened.contestLogTransferStatus(manifestID: prepared.id)
        XCTAssertEqual(status.alreadyTransferred.count, 2)
        XCTAssertEqual(try reopened.fetchAll().count, 2)
    }

    func testChangedSourceConflictsWhileUnseenQSOStillCompletes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        let sessionID = UUID(), generation = UUID(), changedID = UUID(), newID = UUID(), collisionID = UUID()
        let occupiedTargetID = UUID()
        try database.save(QSO(id: occupiedTargetID, call: "K1EXISTING", band: "15m", mode: "CW"))
        let old = ContestLogTransferManifest(contestSessionID: sessionID, workspaceGeneration: generation,
            sourceRevision: 1, sourceDigest: "manifest-old", provenance: "test", items: [
                .init(qsoID: changedID, sourceDigest: "old", sourcePayload: Data("old".utf8),
                      qso: QSO(call: "K1OLD", band: "20m", mode: "CW")),
            ])
        let oldStored = try database.prepareContestLogTransfer(old)
        XCTAssertEqual(try database.applyContestLogTransfer(manifestID: oldStored.id).inserted.count, 1)

        let updated = ContestLogTransferManifest(contestSessionID: sessionID, workspaceGeneration: generation,
            sourceRevision: 2, sourceDigest: "manifest-new", provenance: "test", items: [
                .init(qsoID: changedID, sourceDigest: "changed", sourcePayload: Data("changed".utf8),
                      qso: QSO(call: "K1CHANGED", band: "20m", mode: "CW")),
                .init(qsoID: newID, sourceDigest: "new", sourcePayload: Data("new".utf8),
                      qso: QSO(call: "K1NEW", band: "40m", mode: "CW")),
                .init(qsoID: collisionID, sourceDigest: "collision", sourcePayload: Data("collision".utf8),
                      qso: QSO(id: occupiedTargetID, call: "K1COLLISION", band: "10m", mode: "CW")),
            ])
        let updatedStored = try database.prepareContestLogTransfer(updated)
        let result = try database.applyContestLogTransfer(manifestID: updatedStored.id)
        XCTAssertEqual(result.inserted.map(\.qsoID), [newID])
        XCTAssertEqual(Set(result.conflicts.map(\.qsoID)), Set([changedID, collisionID]))
        XCTAssertEqual(Set(result.conflicts.map(\.code)), Set(["source_changed", "target_identity_collision"]))
        XCTAssertTrue(result.errors.isEmpty)
        XCTAssertEqual(try database.fetchAll().map(\.call).sorted(), ["K1EXISTING", "K1NEW", "K1OLD"])
        let status = try database.contestLogTransferStatus(manifestID: updatedStored.id)
        XCTAssertEqual(Set(status.conflicts.map(\.code)), Set(["source_changed", "target_identity_collision"]))
    }

    func testNativeServicePreparesCommitsAndReportsDurableManifest() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try logbook.handle(method: "workspace_status", params: [:])
        let generation = try XCTUnwrap(workspace["generation"] as? String)
        let sessionID = UUID().uuidString.lowercased(), qsoID = UUID().uuidString.lowercased()
        let row: [String: Any] = [
            "ID": qsoID, "TS": "2026-10-21 01:02:03", "Call": "VK4ABC", "Freq": 14_025.0,
            "Band": 14, "Mode": "USB", "SNT": "59", "RCV": "57", "SentNr": 12,
            "NR": 34, "ContestName": "CQ-WW-SSB", "StationPrefix": "OM0RX",
            "Operator": "OM0RX", "Comment": "source note", "Name": "Alice", "QTH": "Darwin",
            "GridSquare": "PH57", "Continent": "OC", "ZN": 30, "Power": "100",
            "raw_fields": ["other_1": "12", "other_2": "34"],
        ]
        let transfer = ContestLogTransferService(logbook: logbook)
        let source: ContestLogTransferService.ContestRequest = { method, params in
            if method == "contest_draft_get" {
                return ["projection": ["sessionID": sessionID, "workspaceGeneration": generation,
                    "revision": 7, "sourceRevision": "pinned-test"]]
            }
            XCTAssertEqual(method, "contest_log_page")
            XCTAssertEqual(params["expectedRevision"] as? Int64, 7)
            return ["sessionID": sessionID, "revision": 7, "offset": 0, "limit": 100,
                    "total": 1, "rows": [row]]
        }
        let prepared = try await transfer.handle(method: "contest_log_transfer_prepare", params: [
            "sessionID": sessionID, "workspaceGeneration": generation, "expectedRevision": 7,
        ], request: source)
        let manifest = try XCTUnwrap(prepared["manifest"] as? [String: Any])
        let manifestID = try XCTUnwrap(manifest["manifestID"] as? String)
        XCTAssertEqual(manifest["qsoCount"] as? Int, 1)

        let committed = try await transfer.handle(method: "contest_log_transfer_commit", params: [
            "sessionID": sessionID, "workspaceGeneration": generation,
            "expectedRevision": 7, "manifestID": manifestID,
        ], request: source)
        XCTAssertEqual((committed["counts"] as? [String: Any])?["inserted"] as? Int, 1)
        let saved = try XCTUnwrap(try logbook.openedDatabase().fetchAll().first)
        XCTAssertEqual(saved.mode, "SSB"); XCTAssertEqual(saved.submode, "USB")
        XCTAssertEqual(saved.extraFields["APP_XLOG_CONTEST_QSO_ID"], qsoID)
        XCTAssertEqual(saved.comment, "source note")

        let replay = try await transfer.handle(method: "contest_log_transfer_commit", params: [
            "sessionID": sessionID, "workspaceGeneration": generation,
            "expectedRevision": 7, "manifestID": manifestID,
        ], request: source)
        XCTAssertEqual((replay["counts"] as? [String: Any])?["alreadyTransferred"] as? Int, 1)
        XCTAssertEqual(try logbook.openedDatabase().fetchAll().count, 1)

        let reopened = try await transfer.handle(method: "contest_log_transfer_prepare", params: [
            "sessionID": sessionID, "workspaceGeneration": generation, "expectedRevision": 7,
        ], request: source)
        XCTAssertEqual(reopened["phase"] as? String, "prepared")
        XCTAssertEqual((reopened["manifest"] as? [String: Any])?["manifestID"] as? String, manifestID)
        XCTAssertEqual((reopened["counts"] as? [String: Any])?["alreadyTransferred"] as? Int, 1)
        XCTAssertEqual((reopened["counts"] as? [String: Any])?["pending"] as? Int, 0)
    }

    func testNativeServicePreservesMicrowaveFrequenciesAndBands() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let generation = try XCTUnwrap(
            try logbook.handle(method: "workspace_status", params: [:])["generation"] as? String)
        let sessionID = UUID().uuidString.lowercased()
        let rows: [[String: Any]] = [
            ["ID": UUID().uuidString.lowercased(), "TS": "2026-10-21 01:02:03",
             "Call": "VK4ABC", "Freq": 1_296_000.0, "Mode": "CW"],
            ["ID": UUID().uuidString.lowercased(), "TS": "2026-10-21 01:03:04",
             "Call": "VK4DEF", "Freq": 2_300_000.0, "Mode": "CW"],
        ]
        let source: ContestLogTransferService.ContestRequest = { method, _ in
            if method == "contest_draft_get" {
                return ["projection": ["sessionID": sessionID, "workspaceGeneration": generation,
                    "revision": 1, "sourceRevision": "microwave-test"]]
            }
            return ["revision": 1, "total": rows.count, "rows": rows]
        }
        let transfer = ContestLogTransferService(logbook: logbook)
        let prepared = try await transfer.handle(method: "contest_log_transfer_prepare", params: [
            "sessionID": sessionID, "workspaceGeneration": generation, "expectedRevision": 1,
        ], request: source)
        let manifest = try XCTUnwrap(prepared["manifest"] as? [String: Any])
        let manifestID = try XCTUnwrap(manifest["manifestID"] as? String)
        let committed = try await transfer.handle(method: "contest_log_transfer_commit", params: [
            "sessionID": sessionID, "workspaceGeneration": generation,
            "expectedRevision": 1, "manifestID": manifestID,
        ], request: source)

        XCTAssertEqual((committed["counts"] as? [String: Any])?["inserted"] as? Int, 2)
        let saved = try logbook.openedDatabase().fetchAll().sorted { $0.frequencyHz! < $1.frequencyHz! }
        XCTAssertEqual(saved.map(\.frequencyHz), [1_296_000_000, 2_300_000_000])
        XCTAssertEqual(saved.map(\.band), ["23cm", "13cm"])
    }

    func testNativeServiceRejectsFrequencyBeyondNormalLogBound() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let generation = try XCTUnwrap(
            try logbook.handle(method: "workspace_status", params: [:])["generation"] as? String)
        let sessionID = UUID().uuidString.lowercased()
        let row: [String: Any] = [
            "ID": UUID().uuidString.lowercased(), "TS": "2026-10-21 01:02:03",
            "Call": "VK4ABC", "Freq": 1_000_000_000.001, "Mode": "CW",
        ]
        let source: ContestLogTransferService.ContestRequest = { method, _ in
            if method == "contest_draft_get" {
                return ["projection": ["sessionID": sessionID, "workspaceGeneration": generation,
                    "revision": 1, "sourceRevision": "upper-bound-test"]]
            }
            return ["revision": 1, "total": 1, "rows": [row]]
        }

        do {
            _ = try await ContestLogTransferService(logbook: logbook).handle(
                method: "contest_log_transfer_prepare",
                params: ["sessionID": sessionID, "workspaceGeneration": generation, "expectedRevision": 1],
                request: source)
            XCTFail("A frequency beyond the normal-log limit must not be prepared")
        } catch {
            // Expected: the transfer must enforce the destination owner's frequency bound.
        }
        XCTAssertTrue(try logbook.openedDatabase().fetchAll().isEmpty)
    }
}
