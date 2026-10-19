import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport

final class PythonContestCallHistoryLaneTests: XCTestCase {
    func testPrivateImportQueryAndSelectionRemainFencedToActivePythonDraft() async throws {
        let root = try temporaryContestingRoot("lifecycle")
        defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent().deletingLastPathComponent()) }
        let scope = PythonContestCallHistoryScope(
            sessionID: id(1), workspaceGeneration: id(2), revision: 7, draftID: id(3),
            callsign: "K1ABC", ruleIdentity: CQWWCWRule.identity,
            referenceDataVersion: "not1mm-reference-1")
        let authority = PythonHistoryScopeAuthority(scope)
        let lane = try PythonContestCallHistoryLane(contestingRoot: root) { await authority.current() }
        let source = root.deletingLastPathComponent().appendingPathComponent("operator-history.txt")
        try Data("!!Order!!,Call,Name,CqZone\nK1ABC,Sam,04\nK1ABC,Pat,05\n".utf8).write(to: source)

        let emptyStatus = try await lane.handle(method: "contest_history_status", params: [:])
        XCTAssertEqual(emptyStatus["unavailableReason"] as? String, "not_imported")

        let preview = try await lane.handle(method: "contest_history_preview_private", params: [
            "path": source.path, "sourceName": source.lastPathComponent,
        ])
        XCTAssertEqual(preview["workspaceGeneration"] as? String, scope.workspaceGeneration)
        XCTAssertNil(preview["sourceBytes"])
        XCTAssertFalse(try String(decoding: JSONSerialization.data(withJSONObject: preview), as: UTF8.self)
            .contains(source.path))
        let committed = try await lane.handle(method: "contest_history_preview_commit", params: [
            "previewID": try XCTUnwrap(preview["previewID"] as? String),
            "sha256": try XCTUnwrap(preview["sha256"] as? String),
            "workspaceGeneration": scope.workspaceGeneration, "confirmAdvisories": false,
        ])
        XCTAssertEqual((committed["dataset"] as? [String: Any])?["recordCount"] as? Int, 2)

        let requestID = id(4)
        let query = try await lane.handle(method: "contest_history_query",
                                          params: queryParams(scope, requestID: requestID))
        XCTAssertEqual(query["totalRecords"] as? Int, 2)
        let record = try XCTUnwrap((query["records"] as? [[String: Any]])?.first)
        let selection = try await lane.handle(method: "contest_history_select", params:
            selectParams(scope, requestID: requestID,
                         recordID: try XCTUnwrap(record["recordID"] as? String)))
        XCTAssertEqual((selection["projections"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual(((selection["record"] as? [String: Any])?["values"] as? [[String: Any]])?.count, 3)

        do {
            _ = try await lane.handle(method: "contest_history_apply", params: [:])
            XCTFail("Python call history must not fake a Swift-owned draft apply.")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "history_apply_unsupported")
            XCTAssertEqual(error.outcome, "confirmed")
        }

        await authority.replace(.init(
            sessionID: scope.sessionID, workspaceGeneration: id(5), revision: scope.revision,
            draftID: scope.draftID, callsign: scope.callsign,
            ruleIdentity: scope.ruleIdentity, referenceDataVersion: scope.referenceDataVersion))
        do {
            _ = try await lane.handle(method: "contest_history_select", params:
                selectParams(scope, requestID: requestID,
                             recordID: try XCTUnwrap(record["recordID"] as? String)))
            XCTFail("Selection must be rejected after the active Python workspace changes.")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "stale_history_context")
        }
    }

    func testCacheBoundaryRejectsSymlinkedContestingRoot() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("python-history-symlink-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: base) }
        let applicationRoot = base.appendingPathComponent("OM0RX-xLog", isDirectory: true)
        let target = base.appendingPathComponent("outside", isDirectory: true)
        try FileManager.default.createDirectory(at: applicationRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let contesting = applicationRoot.appendingPathComponent("Contesting", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: contesting, withDestinationURL: target)
        let scope = PythonContestCallHistoryScope(
            sessionID: id(11), workspaceGeneration: id(12), revision: 0, draftID: id(13),
            callsign: "K1ABC", ruleIdentity: CQWWCWRule.identity, referenceDataVersion: "reference")

        XCTAssertThrowsError(try PythonContestCallHistoryLane(contestingRoot: contesting) { scope }) { error in
            XCTAssertEqual((error as? ContestLaneError)?.code, "unsafe_workspace")
        }
    }

    func testMaximumRecordActivationStreamsBoundedChunksWithoutMaterializingWireRows() async throws {
        let root = try temporaryContestingRoot("bounded-activation")
        defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent().deletingLastPathComponent()) }
        let scope = PythonContestCallHistoryScope(
            sessionID: id(21), workspaceGeneration: id(22), revision: 1, draftID: id(23),
            callsign: "K1ABC", ruleIdentity: CQWWCWRule.identity,
            referenceDataVersion: "not1mm-reference-1")
        let authority = PythonHistoryScopeAuthority(scope)
        let recorder = PythonHistoryHostRecorder()
        let lane = try PythonContestCallHistoryLane(
            contestingRoot: root,
            hostRequest: { method, params in try await recorder.request(method, params) },
            activeScope: { await authority.current() })
        let source = root.deletingLastPathComponent().appendingPathComponent("maximum-history.txt")
        var data = Data("!!Order!!,Call,Name,UserText\n".utf8)
        for index in 0..<100_000 {
            data.append(Data("K\(index)ABC,Name\(index),Row \(index)\n".utf8))
        }
        try data.write(to: source)
        let preview = try await lane.handle(method: "contest_history_preview_private", params: [
            "path": source.path, "sourceName": source.lastPathComponent,
        ])
        let committed = try await lane.handle(method: "contest_history_preview_commit", params: [
            "previewID": try XCTUnwrap(preview["previewID"] as? String),
            "sha256": try XCTUnwrap(preview["sha256"] as? String),
            "workspaceGeneration": scope.workspaceGeneration, "confirmAdvisories": false,
        ])
        XCTAssertEqual((committed["dataset"] as? [String: Any])?["recordCount"] as? Int, 100_000)
        XCTAssertEqual((committed["activation"] as? [String: Any])?["state"] as? String, "active")
        let stats = await recorder.stats()
        XCTAssertEqual(stats.rows, 100_000)
        XCTAssertGreaterThan(stats.chunks, 1)
        XCTAssertLessThanOrEqual(stats.maximumRows, 256)
        XCTAssertLessThanOrEqual(stats.maximumBytes, PrototypeWorker.maxRequestBytes)
    }

    private func queryParams(_ scope: PythonContestCallHistoryScope,
                             requestID: String) -> [String: Any] {
        baseParams(scope, requestID: requestID).merging([
            "recordOffset": 0, "recordLimit": 20, "valueOffset": 0, "valueLimit": 128,
        ]) { _, new in new }
    }

    private func selectParams(_ scope: PythonContestCallHistoryScope, requestID: String,
                              recordID: String) -> [String: Any] {
        baseParams(scope, requestID: requestID).merging([
            "recordID": recordID, "valueOffset": 0, "valueLimit": 128,
        ]) { _, new in new }
    }

    private func baseParams(_ scope: PythonContestCallHistoryScope,
                            requestID: String) -> [String: Any] {
        ["sessionID": scope.sessionID, "workspaceGeneration": scope.workspaceGeneration,
         "expectedRevision": scope.revision, "draftID": scope.draftID,
         "expectedDraftRevision": scope.revision, "requestID": requestID,
         "callsign": scope.callsign,
         "ruleIdentity": ["id": scope.ruleIdentity.id, "version": scope.ruleIdentity.version,
                          "edition": scope.ruleIdentity.edition,
                          "sourceRevision": scope.ruleIdentity.sourceRevision],
         "referenceDataVersion": scope.referenceDataVersion]
    }

    private func temporaryContestingRoot(_ name: String) throws -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("python-history-\(name)-\(UUID().uuidString)", isDirectory: true)
        let root = base.appendingPathComponent("OM0RX-xLog/Contesting", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func id(_ suffix: Int) -> String {
        String(format: "00000000-0000-0000-0000-%012d", suffix)
    }
}

private actor PythonHistoryScopeAuthority {
    private var value: PythonContestCallHistoryScope
    init(_ value: PythonContestCallHistoryScope) { self.value = value }
    func current() -> PythonContestCallHistoryScope { value }
    func replace(_ value: PythonContestCallHistoryScope) { self.value = value }
}

private actor PythonHistoryHostRecorder {
    private var generation = "", digest = ""
    private var expected = 0, rows = 0, chunks = 0, maximumRows = 0, maximumBytes = 0

    func request(_ method: String, _ params: [String: Any]) throws -> [String: Any] {
        switch method {
        case "contest_history_status":
            return ["activation": NSNull()]
        case "contest_history_stage_begin":
            generation = params["generation"] as? String ?? ""
            digest = params["digest"] as? String ?? ""
            expected = params["rowCount"] as? Int ?? -1
            rows = 0; chunks = 0; maximumRows = 0; maximumBytes = 0
            return ["activation": NSNull()]
        case "contest_history_stage_chunk":
            guard params["generation"] as? String == generation,
                  params["digest"] as? String == digest,
                  params["offset"] as? Int == rows,
                  let values = params["rows"] as? [[String: Any]] else {
                throw NSError(domain: "PythonHistoryHostRecorder", code: 1)
            }
            let envelope: [String: Any] = [
                "id": "00000000-0000-0000-0000-000000000000",
                "method": method, "params": params,
            ]
            let bytes = try JSONSerialization.data(withJSONObject: envelope).count + 1
            rows += values.count; chunks += 1
            maximumRows = max(maximumRows, values.count)
            maximumBytes = max(maximumBytes, bytes)
            return ["activation": NSNull()]
        case "contest_history_stage_commit":
            guard rows == expected else { throw NSError(domain: "PythonHistoryHostRecorder", code: 2) }
            return ["activation": ["generation": generation, "digest": digest, "rowCount": rows]]
        case "contest_history_stage_cancel":
            return ["activation": NSNull()]
        default:
            throw NSError(domain: "PythonHistoryHostRecorder", code: 3)
        }
    }

    func stats() -> (rows: Int, chunks: Int, maximumRows: Int, maximumBytes: Int) {
        (rows, chunks, maximumRows, maximumBytes)
    }
}
