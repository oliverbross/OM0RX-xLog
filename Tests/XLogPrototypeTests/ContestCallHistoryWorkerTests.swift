import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class ContestCallHistoryWorkerTests: XCTestCase {
    func testExplicitCQWWProjectionAppliesThroughMutationWithoutLoggingQSO() async throws {
        let fixture = try HistoryWorkerFixture("apply")
        defer { fixture.remove() }
        let coordinates = try await fixture.createCQWWDraft(callsign: "K1ABC", receivedExchange: "")
        let source = fixture.root.appendingPathComponent("operator-history.txt")
        try Data("!!Order!!,Call,CqZone,UserText\nK1ABC,04,shown-only\n".utf8).write(to: source)
        let preview = try fixture.result(await fixture.frame("contest_history_preview_private",
            ["path": source.path, "sourceName": source.lastPathComponent]))
        _ = try fixture.result(await fixture.frame("contest_history_preview_commit", [
            "previewID": try XCTUnwrap(preview["previewID"] as? String),
            "sha256": try XCTUnwrap(preview["sha256"] as? String),
            "workspaceGeneration": coordinates.generation, "confirmAdvisories": false,
        ]))
        let historyRequestID = fixture.wire(UUID())
        let query = try fixture.result(await fixture.frame("contest_history_query",
            coordinates.queryParams(requestID: historyRequestID, valueOffset: 0, valueLimit: 128)))
        let recordID = try XCTUnwrap((query["records"] as? [[String: Any]])?.first?["recordID"] as? String)
        let selected = try fixture.result(await fixture.frame("contest_history_select",
            coordinates.selectParams(requestID: historyRequestID, recordID: recordID,
                                     valueOffset: 0, valueLimit: 128)))
        let projections = try XCTUnwrap(selected["projections"] as? [[String: Any]])
        XCTAssertEqual(projections.map { $0["id"] as? String }, ["legacy-received-zone"])
        XCTAssertEqual(projections.first?["rawValue"] as? String, "04")
        let opened = try fixture.result(await fixture.frame("contest_draft_get", [
            "sessionID": coordinates.sessionID, "workspaceGeneration": coordinates.generation,
        ]))
        var fields = try XCTUnwrap((opened["draft"] as? [String: Any])?["fields"] as? [String: Any])
        fields["receivedExchange"] = "04"
        var selection = try XCTUnwrap(selected["context"] as? [String: Any])
        selection["recordID"] = recordID
        let request = fixture.mutation(sessionID: UUID(uuidString: coordinates.sessionID)!, requestID: UUID(),
            revision: coordinates.revision,
            payload: ["selection": selection, "projectionIDs": ["legacy-received-zone"], "fields": fields],
            draftID: UUID(uuidString: coordinates.draftID)!, generation: coordinates.generation)
        let applied = try fixture.result(await fixture.frame("contest_history_apply", request))
        XCTAssertEqual(((applied["draft"] as? [String: Any])?["fields"] as? [String: Any])?["receivedExchange"] as? String, "04")
        XCTAssertEqual((applied["session"] as? [String: Any])?["qsoCount"] as? Int, 0)
        let appliedSessionRevision = try XCTUnwrap((applied["session"] as? [String: Any])?["revision"] as? Int)
        var laterFields = try XCTUnwrap((applied["draft"] as? [String: Any])?["fields"] as? [String: Any])
        laterFields["frequencyHz"] = 7_025_000
        _ = try fixture.result(await fixture.frame("contest_draft_apply", fixture.mutation(
            sessionID: UUID(uuidString: coordinates.sessionID)!, requestID: UUID(),
            revision: appliedSessionRevision, payload: ["fields": laterFields],
            draftID: UUID(uuidString: coordinates.draftID)!, generation: coordinates.generation)))
        let replayed = try fixture.result(await fixture.frame("contest_history_apply", request))
        XCTAssertEqual((replayed["receipt"] as? [String: Any])?["requestID"] as? String,
                       (applied["receipt"] as? [String: Any])?["requestID"] as? String)
        XCTAssertEqual((replayed["receipt"] as? [String: Any])?["committedRevision"] as? Int,
                       (applied["receipt"] as? [String: Any])?["committedRevision"] as? Int)
        XCTAssertEqual(replayed["draft"] as? NSDictionary, applied["draft"] as? NSDictionary)
        let staleSelection = await fixture.frame("contest_history_select",
            coordinates.selectParams(requestID: historyRequestID, recordID: recordID,
                                     valueOffset: 0, valueLimit: 128))
        XCTAssertEqual((staleSelection["error"] as? [String: Any])?["code"] as? String,
                       "stale_revision")
    }

    func testHistoryApplyRejectsForgedUnselectedOccupiedAndStaleAuthorityWithoutMutation() async throws {
        let fixture = try HistoryWorkerFixture("apply-negative")
        defer { fixture.remove() }
        let coordinates = try await fixture.createCQWWDraft(callsign: "K1ABC", receivedExchange: "")
        try await fixture.installHistory("!!Order!!,Call,CqZone\nK1ABC,04\n", coordinates: coordinates)
        let selected = try await fixture.selection(coordinates)
        let opened = try fixture.result(await fixture.frame("contest_draft_get", [
            "sessionID": coordinates.sessionID, "workspaceGeneration": coordinates.generation,
        ]))
        let original = try XCTUnwrap((opened["draft"] as? [String: Any])?["fields"] as? [String: Any])
        let cases: [(String, (inout [String: Any]) -> Void)] = [
            ("forged projected value", { $0["receivedExchange"] = "05" }),
            ("unselected sent field", { $0["receivedExchange"] = "04"; $0["sentExchange"] = "16" }),
            ("unselected callsign", { $0["receivedExchange"] = "04"; $0["callsign"] = "K2XYZ" }),
        ]
        for (label, mutate) in cases {
            var fields = original; mutate(&fields)
            let request = fixture.mutation(sessionID: UUID(uuidString: coordinates.sessionID)!, requestID: UUID(),
                revision: coordinates.revision,
                payload: ["selection": selected.context, "projectionIDs": ["legacy-received-zone"], "fields": fields],
                draftID: UUID(uuidString: coordinates.draftID)!, generation: coordinates.generation)
            let rejected = await fixture.frame("contest_history_apply", request)
            XCTAssertEqual((rejected["error"] as? [String: Any])?["code"] as? String,
                           "invalid_history_projection", label)
            let unchanged = try fixture.result(await fixture.frame("contest_draft_get", [
                "sessionID": coordinates.sessionID, "workspaceGeneration": coordinates.generation,
            ]))
            XCTAssertEqual((unchanged["draft"] as? [String: Any])?["fields"] as? NSDictionary,
                           original as NSDictionary, label)
            XCTAssertEqual((unchanged["session"] as? [String: Any])?["qsoCount"] as? Int, 0, label)
        }

        var projected = original; projected["receivedExchange"] = "04"
        let staleDatasetRequest = fixture.mutation(sessionID: UUID(uuidString: coordinates.sessionID)!, requestID: UUID(),
            revision: coordinates.revision,
            payload: ["selection": selected.context, "projectionIDs": ["legacy-received-zone"], "fields": projected],
            draftID: UUID(uuidString: coordinates.draftID)!, generation: coordinates.generation)
        try await fixture.installHistory("!!Order!!,Call,CqZone\nK1ABC,05\n", coordinates: coordinates)
        let replaced = await fixture.frame("contest_history_apply", staleDatasetRequest)
        XCTAssertEqual((replaced["error"] as? [String: Any])?["code"] as? String,
                       "history_selection_unavailable")
        let afterReplacement = try fixture.result(await fixture.frame("contest_draft_get", [
            "sessionID": coordinates.sessionID, "workspaceGeneration": coordinates.generation,
        ]))
        XCTAssertEqual((afterReplacement["draft"] as? [String: Any])?["fields"] as? NSDictionary,
                       original as NSDictionary)
        XCTAssertEqual((afterReplacement["session"] as? [String: Any])?["qsoCount"] as? Int, 0)

        let occupied = try await fixture.createCQWWDraft(callsign: "K1ABC", receivedExchange: "05")
        let occupiedSelection = try await fixture.selection(occupied)
        let occupiedDraft = try fixture.result(await fixture.frame("contest_draft_get", [
            "sessionID": occupied.sessionID, "workspaceGeneration": occupied.generation,
        ]))
        let occupiedFields = try XCTUnwrap((occupiedDraft["draft"] as? [String: Any])?["fields"] as? [String: Any])
        let occupiedRequest = fixture.mutation(sessionID: UUID(uuidString: occupied.sessionID)!, requestID: UUID(),
            revision: occupied.revision,
            payload: ["selection": occupiedSelection.context, "projectionIDs": ["legacy-received-zone"], "fields": occupiedFields],
            draftID: UUID(uuidString: occupied.draftID)!, generation: occupied.generation)
        let occupiedRejected = await fixture.frame("contest_history_apply", occupiedRequest)
        XCTAssertEqual((occupiedRejected["error"] as? [String: Any])?["code"] as? String,
                       "invalid_history_projection")

        var changedFields = occupiedFields; changedFields["frequencyHz"] = 7_025_000
        _ = try fixture.result(await fixture.frame("contest_draft_apply", fixture.mutation(
            sessionID: UUID(uuidString: occupied.sessionID)!, requestID: UUID(), revision: occupied.revision,
            payload: ["fields": changedFields], draftID: UUID(uuidString: occupied.draftID)!,
            generation: occupied.generation)))
        let staleRevision = await fixture.frame("contest_history_apply", occupiedRequest)
        XCTAssertEqual((staleRevision["error"] as? [String: Any])?["code"] as? String, "stale_revision")
        let afterStale = try fixture.result(await fixture.frame("contest_draft_get", [
            "sessionID": occupied.sessionID, "workspaceGeneration": occupied.generation,
        ]))
        XCTAssertEqual(((afterStale["draft"] as? [String: Any])?["fields"] as? [String: Any])?["frequencyHz"] as? Int,
                       7_025_000)
        XCTAssertEqual((afterStale["session"] as? [String: Any])?["qsoCount"] as? Int, 0)
    }

    func testStructuredNAQPNameOnlyProjectionPreservesRawAndNormalizedValuesThroughWire() async throws {
        let fixture = try HistoryWorkerFixture("apply-naqp")
        defer { fixture.remove() }
        let coordinates = try await fixture.createNAQPDraft(callsign: "K1ABC")
        try await fixture.installHistory("!!Order!!,Call,Name,State\nK1ABC,Sam,\n", coordinates: coordinates)
        let selected = try await fixture.selection(coordinates)
        XCTAssertEqual(selected.projections.map { $0["id"] as? String }, ["received-name"])
        XCTAssertEqual(selected.projections.first?["rawValue"] as? String, "Sam")
        XCTAssertEqual(selected.projections.first?["normalizedValue"] as? String, "SAM")
        let opened = try fixture.result(await fixture.frame("contest_draft_get", [
            "sessionID": coordinates.sessionID, "workspaceGeneration": coordinates.generation,
        ]))
        var fields = try XCTUnwrap((opened["draft"] as? [String: Any])?["fields"] as? [String: Any])
        fields["receivedExchange"] = "Sam"
        fields["receivedExchangeFields"] = ["name": "Sam", "location": ""]
        let request = fixture.mutation(sessionID: UUID(uuidString: coordinates.sessionID)!, requestID: UUID(),
            revision: coordinates.revision,
            payload: ["selection": selected.context, "projectionIDs": ["received-name"], "fields": fields],
            draftID: UUID(uuidString: coordinates.draftID)!, generation: coordinates.generation)
        let applied = try fixture.result(await fixture.frame("contest_history_apply", request))
        let appliedFields = try XCTUnwrap((applied["draft"] as? [String: Any])?["fields"] as? [String: Any])
        XCTAssertEqual(appliedFields["receivedExchange"] as? String, "Sam")
        XCTAssertEqual(appliedFields["receivedExchangeFields"] as? [String: String],
                       ["name": "Sam", "location": ""])
        XCTAssertEqual((applied["session"] as? [String: Any])?["qsoCount"] as? Int, 0)
    }

    func testEscapedLargeValuesTraverseBudgetedQueryAndSelectionPagesLosslessly() async throws {
        let fixture = try HistoryWorkerFixture("budget")
        defer { fixture.remove() }
        let coordinates = try await fixture.createCQWWDraft(callsign: "K1ABC")
        let source = fixture.root.appendingPathComponent("operator-history.unfiltered")
        let escaped = String(repeating: "\u{0001}", count: 3_900)
        var expected: [Int: [String]] = [:]
        let headers = ["Call", "X-Name", "X-Zone", "X-Unknown"]
        var text = "!!Order!!," + headers.joined(separator: ",") + "\n"
        for ordinal in 0..<24 {
            let values = (0..<3).map { "r\(ordinal)c\($0)-\(escaped)" }
            expected[ordinal] = ["K1ABC"] + values
            text += (["K1ABC"] + values).joined(separator: ",") + "\n"
        }
        try Data(text.utf8).write(to: source)

        let preview = try fixture.result(await fixture.frame("contest_history_preview_private",
            ["path": source.path, "sourceName": source.lastPathComponent]))
        _ = try fixture.result(await fixture.frame("contest_history_preview_commit", [
            "previewID": try XCTUnwrap(preview["previewID"] as? String),
            "sha256": try XCTUnwrap(preview["sha256"] as? String),
            "workspaceGeneration": coordinates.generation, "confirmAdvisories": false,
        ]))

        let requestID = fixture.wire(UUID())
        var cursor = (record: 0, value: 0)
        var visited: Set<String> = []
        var selectedRecordID: String?
        var selectedOrdinal: Int?
        var sawBudgetSplit = false
        for _ in 0..<128 {
            var params = coordinates.queryParams(requestID: requestID,
                                                 valueOffset: cursor.value, valueLimit: 4)
            params["recordOffset"] = cursor.record
            params["recordLimit"] = 20
            let page = try fixture.result(await fixture.frame("contest_history_query", params))
            let encoded = try JSONSerialization.data(withJSONObject: page)
            XCTAssertLessThan(encoded.count, 768 * 1_024)
            let records = page["records"] as? [[String: Any]] ?? []
            for row in records {
                let recordID = try XCTUnwrap(row["recordID"] as? String)
                let ordinal = try XCTUnwrap(row["sourceOrdinal"] as? Int)
                if selectedRecordID == nil { selectedRecordID = recordID; selectedOrdinal = ordinal }
                let expectedValues = try XCTUnwrap(expected[ordinal])
                for cell in row["values"] as? [[String: Any]] ?? [] {
                    let header = try XCTUnwrap(cell["header"] as? [String: Any])
                    let headerName = try XCTUnwrap(header["originalName"] as? String)
                    let headerIndex = try XCTUnwrap(headers.firstIndex(of: headerName))
                    XCTAssertEqual(cell["value"] as? String, expectedValues[headerIndex])
                    XCTAssertTrue(visited.insert("\(recordID)|\(headerName)").inserted)
                }
            }
            guard let next = page["next"] as? [String: Any] else { break }
            let nextRecord = try XCTUnwrap(next["recordOffset"] as? Int)
            let nextValue = try XCTUnwrap(next["valueOffset"] as? Int)
            if cursor.record == 0, nextRecord < 20 { sawBudgetSplit = true }
            cursor = (nextRecord, nextValue)
        }
        XCTAssertTrue(sawBudgetSplit)
        XCTAssertEqual(visited.count, 24 * 4)

        let recordID = try XCTUnwrap(selectedRecordID)
        var selectionOffset = 0
        var selectedHeaders: [String] = []
        var selectedValues: [String] = []
        for _ in 0..<8 {
            let page = try fixture.result(await fixture.frame("contest_history_select",
                coordinates.selectParams(requestID: requestID, recordID: recordID,
                                         valueOffset: selectionOffset, valueLimit: 1)))
            XCTAssertLessThan(try JSONSerialization.data(withJSONObject: page).count, 768 * 1_024)
            let record = try XCTUnwrap(page["record"] as? [String: Any])
            let cells = try XCTUnwrap(record["values"] as? [[String: Any]])
            selectedHeaders.append(contentsOf: try cells.map {
                try XCTUnwrap(($0["header"] as? [String: Any])?["originalName"] as? String)
            })
            selectedValues.append(contentsOf: try cells.map { try XCTUnwrap($0["value"] as? String) })
            guard let next = page["nextValueOffset"] as? Int else { break }
            selectionOffset = next
        }
        XCTAssertEqual(selectedHeaders, headers)
        XCTAssertEqual(selectedValues, try XCTUnwrap(expected[try XCTUnwrap(selectedOrdinal)]))
    }

    func testPrivatePreviewCommitPagedQuerySelectionAndReplacementFences() async throws {
        let fixture = try HistoryWorkerFixture("lifecycle")
        defer { fixture.remove() }
        let coordinates = try await fixture.createCQWWDraft(callsign: "K1ABC")
        let source = fixture.root.appendingPathComponent("operator-history.txt")
        try Data("!!Order!!,Call,Name,CqZone,X-Unknown\nK1ABC\nk1abc,Pat,04,two\nBAD CALL,Retained,03,three\n".utf8)
            .write(to: source)

        let preview = try fixture.result(await fixture.frame("contest_history_preview_private",
            ["path": source.path, "sourceName": source.lastPathComponent]))
        let previewID = try XCTUnwrap(preview["previewID"] as? String)
        let digest = try XCTUnwrap(preview["sha256"] as? String)
        XCTAssertEqual(preview["recordCount"] as? Int, 3)
        XCTAssertEqual(preview["diagnosticCount"] as? Int, 1)
        XCTAssertEqual(preview["requiresAdvisoryConfirmation"] as? Bool, true)
        let encodedPreview = try JSONSerialization.data(withJSONObject: preview)
        XCTAssertFalse(String(decoding: encodedPreview, as: UTF8.self).contains(source.path))
        XCTAssertNil(preview["sourceBytes"])

        let page = try fixture.result(await fixture.frame("contest_history_preview_page", [
            "previewID": previewID, "sha256": digest, "workspaceGeneration": coordinates.generation,
            "offset": 0, "limit": 1,
        ]))
        XCTAssertEqual(page["total"] as? Int, 1)
        XCTAssertEqual((page["diagnostics"] as? [[String: Any]])?.first?["code"] as? String, "invalidCall")
        let committed = try fixture.result(await fixture.frame("contest_history_preview_commit", [
            "previewID": previewID, "sha256": digest, "workspaceGeneration": coordinates.generation,
            "confirmAdvisories": true,
        ]))
        XCTAssertEqual((committed["dataset"] as? [String: Any])?["recordCount"] as? Int, 3)

        let requestID = fixture.wire(UUID())
        let queryParams = coordinates.queryParams(requestID: requestID, valueOffset: 0, valueLimit: 2)
        let firstPage = try fixture.result(await fixture.frame("contest_history_query", queryParams))
        XCTAssertEqual(firstPage["totalRecords"] as? Int, 2)
        let first = try XCTUnwrap((firstPage["records"] as? [[String: Any]])?.first)
        XCTAssertEqual((first["values"] as? [[String: Any]])?.count, 2)
        XCTAssertLessThan(try JSONSerialization.data(withJSONObject: firstPage).count, 768 * 1_024)
        let next = try XCTUnwrap(firstPage["next"] as? [String: Any])
        XCTAssertEqual(next["recordOffset"] as? Int, 0)
        XCTAssertEqual(next["valueOffset"] as? Int, 2)

        var nextParams = queryParams
        nextParams["valueOffset"] = 2
        let nextPage = try fixture.result(await fixture.frame("contest_history_query", nextParams))
        let nextValues = try XCTUnwrap(((nextPage["records"] as? [[String: Any]])?.first?["values"] as? [[String: Any]]))
        XCTAssertEqual(nextValues.map { ($0["header"] as? [String: Any])?["originalName"] as? String }, ["CqZone", "X-Unknown"])
        XCTAssertEqual(nextValues.map { $0["value"] as? String }, ["", ""])

        let traversalRequestID = fixture.wire(UUID())
        var cursor = (record: 0, value: 0)
        var visited: [String] = []
        for _ in 0..<16 {
            var params = coordinates.queryParams(requestID: traversalRequestID,
                                                 valueOffset: cursor.value, valueLimit: 1)
            params["recordOffset"] = cursor.record
            params["recordLimit"] = 2
            let page = try fixture.result(await fixture.frame("contest_history_query", params))
            for row in page["records"] as? [[String: Any]] ?? [] {
                let rowID = try XCTUnwrap(row["recordID"] as? String)
                for cell in row["values"] as? [[String: Any]] ?? [] {
                    let header = try XCTUnwrap((cell["header"] as? [String: Any])?["originalName"] as? String)
                    visited.append("\(rowID)|\(header)")
                }
            }
            guard let nextCursor = page["next"] as? [String: Any] else { break }
            cursor = (try XCTUnwrap(nextCursor["recordOffset"] as? Int),
                      try XCTUnwrap(nextCursor["valueOffset"] as? Int))
        }
        XCTAssertEqual(visited.count, 8)
        XCTAssertEqual(Set(visited).count, 8)

        let recordID = try XCTUnwrap(first["recordID"] as? String)
        let select = coordinates.selectParams(requestID: requestID, recordID: recordID,
                                              valueOffset: 0, valueLimit: 128)
        let selected = try fixture.result(await fixture.frame("contest_history_select", select))
        XCTAssertEqual(((selected["record"] as? [String: Any])?["values"] as? [[String: Any]])?.count, 4)

        let cancelledRequestID = fixture.wire(UUID())
        let cancelledQuery = try fixture.result(await fixture.frame("contest_history_query",
            coordinates.queryParams(requestID: cancelledRequestID, valueOffset: 0, valueLimit: 4)))
        let cancelledRecordID = try XCTUnwrap((cancelledQuery["records"] as? [[String: Any]])?.first?["recordID"] as? String)
        let cancelled = try fixture.result(await fixture.frame("contest_history_query_cancel",
            coordinates.cancelParams(requestID: cancelledRequestID)))
        XCTAssertEqual(cancelled["cancelled"] as? Bool, true)
        let cancelledSelection = await fixture.frame("contest_history_select",
            coordinates.selectParams(requestID: cancelledRequestID, recordID: cancelledRecordID,
                                     valueOffset: 0, valueLimit: 4))
        XCTAssertEqual((cancelledSelection["error"] as? [String: Any])?["code"] as? String,
                       "history_selection_unavailable")
        _ = try fixture.result(await fixture.frame("contest_history_select", select))

        let replacement = fixture.root.appendingPathComponent("replacement.txt")
        try Data("!!Order!!,Call,Name\nN1XYZ,New\n".utf8).write(to: replacement)
        let replacementPreview = try fixture.result(await fixture.frame("contest_history_preview_private",
            ["path": replacement.path, "sourceName": replacement.lastPathComponent]))
        _ = try fixture.result(await fixture.frame("contest_history_preview_commit", [
            "previewID": try XCTUnwrap(replacementPreview["previewID"] as? String),
            "sha256": try XCTUnwrap(replacementPreview["sha256"] as? String),
            "workspaceGeneration": coordinates.generation, "confirmAdvisories": false,
        ]))
        let stale = await fixture.frame("contest_history_select", select)
        XCTAssertEqual((stale["error"] as? [String: Any])?["code"] as? String, "history_selection_unavailable")
    }

    func testCancelStaleContextAndUnsafePrivateFilesRetainActiveDataset() async throws {
        let fixture = try HistoryWorkerFixture("negative")
        defer { fixture.remove() }
        let coordinates = try await fixture.createCQWWDraft(callsign: "K1ABC")
        let valid = fixture.root.appendingPathComponent("valid.txt")
        try Data("!!Order!!,Call\nK1ABC\n".utf8).write(to: valid)
        let preview = try fixture.result(await fixture.frame("contest_history_preview_private",
            ["path": valid.path, "sourceName": valid.lastPathComponent]))
        let previewID = try XCTUnwrap(preview["previewID"] as? String)
        let digest = try XCTUnwrap(preview["sha256"] as? String)
        let cancelled = try fixture.result(await fixture.frame("contest_history_preview_cancel", [
            "previewID": previewID, "sha256": digest, "workspaceGeneration": coordinates.generation,
        ]))
        XCTAssertEqual(cancelled["cancelled"] as? Bool, true)
        let cancelledCommit = await fixture.frame("contest_history_preview_commit", [
            "previewID": previewID, "sha256": digest, "workspaceGeneration": coordinates.generation,
            "confirmAdvisories": false,
        ])
        XCTAssertEqual((cancelledCommit["error"] as? [String: Any])?["code"] as? String,
                       "history_preview_unavailable")

        let commitPreview = try fixture.result(await fixture.frame("contest_history_preview_private",
            ["path": valid.path, "sourceName": valid.lastPathComponent]))
        let numericConfirmation = await fixture.frame("contest_history_preview_commit", [
            "previewID": try XCTUnwrap(commitPreview["previewID"] as? String),
            "sha256": try XCTUnwrap(commitPreview["sha256"] as? String),
            "workspaceGeneration": coordinates.generation, "confirmAdvisories": 1,
        ])
        XCTAssertEqual((numericConfirmation["error"] as? [String: Any])?["code"] as? String,
                       "invalid_params")
        _ = try fixture.result(await fixture.frame("contest_history_preview_commit", [
            "previewID": try XCTUnwrap(commitPreview["previewID"] as? String),
            "sha256": try XCTUnwrap(commitPreview["sha256"] as? String),
            "workspaceGeneration": coordinates.generation, "confirmAdvisories": false,
        ]))
        var stale = coordinates.queryParams(requestID: fixture.wire(UUID()), valueOffset: 0, valueLimit: 10)
        stale["expectedDraftRevision"] = coordinates.draftRevision + 1
        let staleFrame = await fixture.frame("contest_history_query", stale)
        XCTAssertEqual((staleFrame["error"] as? [String: Any])?["code"] as? String, "stale_history_context")
        var invalidOffset = coordinates.queryParams(requestID: fixture.wire(UUID()), valueOffset: 0, valueLimit: 10)
        invalidOffset["recordOffset"] = Int.max
        let invalidOffsetFrame = await fixture.frame("contest_history_query", invalidOffset)
        XCTAssertEqual((invalidOffsetFrame["error"] as? [String: Any])?["code"] as? String, "invalid_params")

        let symlink = fixture.root.appendingPathComponent("linked.txt")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: valid)
        let rejectedLink = await fixture.frame("contest_history_preview_private",
            ["path": symlink.path, "sourceName": symlink.lastPathComponent])
        XCTAssertEqual((rejectedLink["error"] as? [String: Any])?["code"] as? String, "history_import_failed")
        let oversized = fixture.root.appendingPathComponent("oversized.txt")
        FileManager.default.createFile(atPath: oversized.path, contents: nil)
        let handle = try FileHandle(forWritingTo: oversized)
        try handle.truncate(atOffset: 16 * 1_024 * 1_024 + 1)
        try handle.close()
        let rejectedLarge = await fixture.frame("contest_history_preview_private",
            ["path": oversized.path, "sourceName": oversized.lastPathComponent])
        XCTAssertEqual((rejectedLarge["error"] as? [String: Any])?["code"] as? String, "history_import_failed")
        let status = try fixture.result(await fixture.frame("contest_history_status"))
        XCTAssertEqual((status["dataset"] as? [String: Any])?["recordCount"] as? Int, 1)
    }
}

private final class HistoryWorkerFixture {
    struct Coordinates {
        let generation: String
        let sessionID: String
        let revision: Int
        let draftID: String
        let draftRevision: Int
        let ruleIdentity: [String: Any]
        let referenceDataVersion: String
        let callsign: String

        func queryParams(requestID: String, valueOffset: Int, valueLimit: Int) -> [String: Any] {
            base(requestID: requestID, valueOffset: valueOffset, valueLimit: valueLimit).merging([
                "recordOffset": 0, "recordLimit": 1,
            ]) { _, new in new }
        }
        func selectParams(requestID: String, recordID: String, valueOffset: Int, valueLimit: Int) -> [String: Any] {
            base(requestID: requestID, valueOffset: valueOffset, valueLimit: valueLimit).merging([
                "recordID": recordID,
            ]) { _, new in new }
        }
        func cancelParams(requestID: String) -> [String: Any] {
            var value = base(requestID: requestID, valueOffset: 0, valueLimit: 1)
            value.removeValue(forKey: "valueOffset")
            value.removeValue(forKey: "valueLimit")
            return value
        }
        private func base(requestID: String, valueOffset: Int, valueLimit: Int) -> [String: Any] {
            ["sessionID": sessionID, "workspaceGeneration": generation, "expectedRevision": revision,
             "draftID": draftID, "expectedDraftRevision": draftRevision, "requestID": requestID,
             "callsign": callsign, "ruleIdentity": ruleIdentity,
             "referenceDataVersion": referenceDataVersion,
             "valueOffset": valueOffset, "valueLimit": valueLimit]
        }
    }

    let root: URL
    let worker: LiveWorker
    private let logbook: LiveLogbookMethods
    init(_ suffix: String) throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-history-worker-\(suffix)-\(UUID().uuidString)")
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { throw NSError(domain: "fixture", code: 1) }
        logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false,
                                     runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
    }
    func remove() { try? FileManager.default.removeItem(at: root) }
    func wire(_ value: UUID) -> String { value.uuidString.lowercased() }

    func createCQWWDraft(callsign: String, receivedExchange: String = "05") async throws -> Coordinates {
        let catalog = try result(await frame("contest_catalog"))
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rule = try XCTUnwrap((catalog["rules"] as? [[String: Any]])?.first {
            (($0["identity"] as? [String: Any])?["id"] as? String) == "cq-ww-cw"
        })
        let identity = try XCTUnwrap(rule["identity"] as? [String: Any])
        let reference = try XCTUnwrap(rule["referenceDataVersion"] as? String)
        let session = UUID(), draft = UUID()
        let created = try result(await frame("contest_create", mutation(
            sessionID: session, requestID: draft, revision: 0,
            payload: ["sessionID": wire(session), "name": "History",
                      "ruleIdentity": identity, "referenceDataVersion": reference,
                      "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC"],
                      "operator": ["callsign": "OM0RX", "category": "single-op"]],
            draftID: nil, generation: generation)))
        var fields = try XCTUnwrap((created["draft"] as? [String: Any])?["fields"] as? [String: Any])
        fields["callsign"] = callsign; fields["receivedExchange"] = receivedExchange; fields["frequencyHz"] = 14_025_000
        let applied = try result(await frame("contest_draft_apply", mutation(
            sessionID: session, requestID: UUID(), revision: 1,
            payload: ["fields": fields], draftID: draft, generation: generation)))
        let draftWire = try XCTUnwrap(applied["draft"] as? [String: Any])
        let liveRevision = try XCTUnwrap(draftWire["revision"] as? Int)
        return .init(generation: generation, sessionID: wire(session),
                     revision: liveRevision,
                     draftID: try XCTUnwrap(draftWire["draftID"] as? String),
                     draftRevision: liveRevision,
                     ruleIdentity: identity, referenceDataVersion: reference, callsign: callsign)
    }

    func createNAQPDraft(callsign: String) async throws -> Coordinates {
        let catalog = try result(await frame("contest_catalog"))
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rule = try XCTUnwrap((catalog["rules"] as? [[String: Any]])?.first {
            (($0["identity"] as? [String: Any])?["id"] as? String) == "naqp-cw"
        })
        let identity = try XCTUnwrap(rule["identity"] as? [String: Any])
        let reference = try XCTUnwrap(rule["referenceDataVersion"] as? String)
        let session = UUID(), draft = UUID()
        let created = try result(await frame("contest_create", mutation(
            sessionID: session, requestID: draft, revision: 0,
            payload: ["sessionID": wire(session), "name": "History NAQP",
                      "ruleIdentity": identity, "referenceDataVersion": reference,
                      "station": ["callsign": "K1AAA", "cqZone": "5", "dxccEntity": "United States",
                                  "exchangeFields": ["name": "OLIVER", "location": "CA"]],
                      "operator": ["callsign": "K1AAA", "category": "single-op"]],
            draftID: nil, generation: generation)))
        var fields = try XCTUnwrap((created["draft"] as? [String: Any])?["fields"] as? [String: Any])
        fields["callsign"] = callsign; fields["frequencyHz"] = 14_050_000
        fields["receivedExchange"] = ""
        fields["receivedExchangeFields"] = ["name": "", "location": ""]
        let applied = try result(await frame("contest_draft_apply", mutation(
            sessionID: session, requestID: UUID(), revision: 1,
            payload: ["fields": fields], draftID: draft, generation: generation)))
        let draftWire = try XCTUnwrap(applied["draft"] as? [String: Any])
        let liveRevision = try XCTUnwrap(draftWire["revision"] as? Int)
        return .init(generation: generation, sessionID: wire(session), revision: liveRevision,
                     draftID: try XCTUnwrap(draftWire["draftID"] as? String), draftRevision: liveRevision,
                     ruleIdentity: identity, referenceDataVersion: reference, callsign: callsign)
    }

    func installHistory(_ contents: String, coordinates: Coordinates) async throws {
        let source = root.appendingPathComponent("history-\(UUID().uuidString).txt")
        try Data(contents.utf8).write(to: source)
        let preview = try result(await frame("contest_history_preview_private",
            ["path": source.path, "sourceName": source.lastPathComponent]))
        _ = try result(await frame("contest_history_preview_commit", [
            "previewID": try XCTUnwrap(preview["previewID"] as? String),
            "sha256": try XCTUnwrap(preview["sha256"] as? String),
            "workspaceGeneration": coordinates.generation, "confirmAdvisories": false,
        ]))
    }

    func selection(_ coordinates: Coordinates) async throws -> (context: [String: Any], recordID: String, projections: [[String: Any]]) {
        let requestID = wire(UUID())
        let query = try result(await frame("contest_history_query",
            coordinates.queryParams(requestID: requestID, valueOffset: 0, valueLimit: 128)))
        let recordID = try XCTUnwrap((query["records"] as? [[String: Any]])?.first?["recordID"] as? String)
        let selected = try result(await frame("contest_history_select",
            coordinates.selectParams(requestID: requestID, recordID: recordID,
                                     valueOffset: 0, valueLimit: 128)))
        var context = try XCTUnwrap(selected["context"] as? [String: Any]); context["recordID"] = recordID
        return (context, recordID, try XCTUnwrap(selected["projections"] as? [[String: Any]]))
    }

    func mutation(sessionID: UUID, requestID: UUID, revision: Int,
                          payload: [String: Any], draftID: UUID?, generation: String) -> [String: Any] {
        var value: [String: Any] = [
            "sessionID": wire(sessionID), "workspaceGeneration": generation,
            "requestID": wire(requestID), "expectedRevision": revision,
            "payloadDigest": String(repeating: String(format: "%x", revision + 1), count: 64),
            "operationTimestamp": "2026-10-18T09:00:0\(revision).000Z", "payload": payload,
        ]
        if let draftID { value["draftID"] = wire(draftID) }
        return value
    }

    func frame(_ method: String, _ params: [String: Any] = [:]) async -> [String: Any] {
        let data = try! JSONSerialization.data(withJSONObject: ["id": wire(UUID()), "method": method, "params": params])
        return (try? JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any]) ?? [:]
    }
    func result(_ frame: [String: Any]) throws -> [String: Any] {
        if frame["ok"] as? Bool == true { return try XCTUnwrap(frame["result"] as? [String: Any]) }
        throw NSError(domain: "HistoryWorker", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: String(describing: frame)])
    }
}
