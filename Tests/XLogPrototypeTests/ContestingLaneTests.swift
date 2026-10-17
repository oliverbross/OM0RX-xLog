import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class ContestingLaneTests: XCTestCase {
    private let generation = "f1111111-2222-4333-8444-555555555555"

    private func fixture() throws -> (URL, ContestLane) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-lane-\(UUID().uuidString)")
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        return (root, lane)
    }

    private func mutation(sessionID: UUID, requestID: UUID, revision: Int, timestamp: String,
                          payload: [String: Any], draftID: UUID? = nil, digest: String? = nil,
                          workspaceGeneration: String? = nil) -> [String: Any] {
        var value: [String: Any] = [
            "sessionID": wireID(sessionID), "workspaceGeneration": workspaceGeneration ?? generation,
            "requestID": wireID(requestID), "expectedRevision": revision,
            "payloadDigest": digest ?? String(repeating: "a", count: 64),
            "operationTimestamp": timestamp, "payload": payload,
        ]
        if let draftID { value["draftID"] = wireID(draftID) }
        return value
    }

    private func wireID(_ value: UUID) -> String { value.uuidString.lowercased() }
    private func canonicalJSON(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    private func workerRequest(_ worker: LiveWorker, method: String, params: [String: Any] = [:],
                               id: UUID = UUID()) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": wireID(id), "method": method, "params": params])
        let response = await worker.response(to: data)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
    }

    private func makeSession(_ lane: ContestLane, ruleName: String = "CQ WPX CW") async throws -> (UUID, UUID, [String: Any]) {
        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first { $0["displayName"] as? String == ruleName })
        let identity = try XCTUnwrap(rule["identity"] as? [String: Any])
        let reference = try XCTUnwrap(rule["referenceDataVersion"] as? String)
        let sessionID = UUID(uuidString: "f1234567-89ab-4cde-8fab-0123456789ab")!
        let createID = UUID(uuidString: "a1234567-89ab-4cde-8fab-0123456789ab")!
        let payload: [String: Any] = [
            "sessionID": wireID(sessionID), "name": "WPX test",
            "ruleIdentity": identity, "referenceDataVersion": reference,
            "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC"],
            "operator": ["callsign": "OM0RX", "category": "single-op"],
        ]
        let result = try await lane.handle(method: "contest_create", params: mutation(
            sessionID: sessionID, requestID: createID, revision: 0,
            timestamp: "2026-10-17T01:00:00.000Z", payload: payload))
        return (sessionID, createID, result)
    }

    func testCreateReserveCommitReplayAndReopenUseDurableContestStore() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, created) = try await makeSession(lane)
        XCTAssertEqual(((created["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, 1)
        let listed = try await lane.handle(method: "contest_sessions", params: [:])
        XCTAssertEqual((listed["sessions"] as? [[String: Any]])?.count, 1)
        let initialDraft = try await lane.handle(method: "contest_draft_get", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual((initialDraft["draft"] as? [String: Any])?["draftID"] as? String, wireID(draftID))

        let reserveID = UUID()
        let reserved = try await lane.handle(method: "contest_serial_reserve", params: mutation(
            sessionID: sessionID, requestID: reserveID, revision: 1,
            timestamp: "2026-10-17T01:01:00.000Z", payload: [:], draftID: draftID))
        XCTAssertEqual(((reserved["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue, 1)

        let applyID = UUID()
        let fields: [String: Any] = [
            "callsign": "K1ABC", "sentReport": "599", "sentExchange": "001",
            "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW",
        ]
        let applied = try await lane.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: applyID, revision: 2,
            timestamp: "2026-10-17T01:02:00.000Z", payload: ["fields": fields], draftID: draftID))
        XCTAssertEqual(((applied["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, 3)
        XCTAssertEqual(((applied["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue, 1)

        let commitID = UUID()
        let commitParams = mutation(sessionID: sessionID, requestID: commitID, revision: 3,
            timestamp: "2026-10-17T01:03:00.000Z", payload: [:], draftID: draftID)
        let committed = try await lane.handle(method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(((committed["receipt"] as? [String: Any])?["committedRevision"] as? NSNumber)?.intValue, 4)
        XCTAssertEqual((committed["qso"] as? [String: Any])?["workedAt"] as? String, "2026-10-17T01:03:00.000Z")

        let partial = fields.merging(["callsign": "K1/"], uniquingKeysWith: { _, new in new })
        let partialResult = try await lane.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 4,
            timestamp: "2026-10-17T01:04:00.000Z", payload: ["fields": partial], draftID: draftID))
        XCTAssertEqual((((partialResult["draft"] as? [String: Any])?["fields"] as? [String: Any])?["callsign"] as? String), "K1/")
        XCTAssertFalse(((((partialResult["draft"] as? [String: Any])?["validation"] as? [String: Any])?["errors"] as? [String]) ?? []).isEmpty)

        let reopened = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let partialOpen = try await reopened.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual((((partialOpen["draft"] as? [String: Any])?["fields"] as? [String: Any])?["callsign"] as? String), "K1/")
        let duplicate = try await reopened.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 5,
            timestamp: "2026-10-17T01:05:00.000Z", payload: ["fields": fields], draftID: draftID))
        XCTAssertEqual((((duplicate["draft"] as? [String: Any])?["dupe"] as? [String: Any])?["state"] as? String), "duplicate")

        let replay = try await reopened.handle(method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(try canonicalJSON(replay), try canonicalJSON(committed))
        XCTAssertEqual((replay["receipt"] as? [String: Any])?["requestID"] as? String, wireID(commitID))
        let receipt = try await reopened.handle(method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(commitID), "payloadDigest": String(repeating: "a", count: 64),
        ])
        XCTAssertEqual(receipt["status"] as? String, "committed")
        let opened = try await reopened.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual((opened["session"] as? [String: Any])?["qsoCount"] as? Int, 1)
        let page = try await reopened.handle(method: "contest_log_page", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "expectedRevision": 6, "offset": 0, "limit": 50,
        ])
        XCTAssertEqual((page["qsos"] as? [[String: Any]])?.count, 1)
        let score = try await reopened.handle(method: "contest_score", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation, "expectedRevision": 6,
        ])
        XCTAssertEqual((score["qsos"] as? NSNumber)?.intValue, 1)
    }

    func testSameRequestChangedTimestampConflictsAndInvalidDateIsConfirmed() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(lane)
        let requestID = UUID()
        let fields: [String: Any] = ["callsign": "K1ABC", "sentReport": "599", "sentExchange": "001",
            "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000, "band": "20m", "mode": "CW"]
        let original = mutation(sessionID: sessionID, requestID: requestID, revision: 1,
            timestamp: "2026-10-17T01:01:00.000Z", payload: ["fields": fields], draftID: draftID)
        _ = try await lane.handle(method: "contest_draft_apply", params: original)
        var changedPayload = original
        var payload = try XCTUnwrap(changedPayload["payload"] as? [String: Any])
        var changedFields = try XCTUnwrap(payload["fields"] as? [String: Any]); changedFields["receivedExchange"] = "2"
        payload["fields"] = changedFields; changedPayload["payload"] = payload
        do { _ = try await lane.handle(method: "contest_draft_apply", params: changedPayload); XCTFail("Expected canonical payload conflict") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "request_conflict"); XCTAssertEqual(error.outcome, "confirmed") }
        var changed = original; changed["operationTimestamp"] = "2026-10-17T01:01:01.000Z"
        do { _ = try await lane.handle(method: "contest_draft_apply", params: changed); XCTFail("Expected conflict") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "request_conflict"); XCTAssertEqual(error.outcome, "confirmed") }
        var invalid = original; invalid["requestID"] = wireID(UUID()); invalid["operationTimestamp"] = "today"
        do { _ = try await lane.handle(method: "contest_draft_apply", params: invalid); XCTFail("Expected invalid timestamp") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "invalid_params"); XCTAssertEqual(error.outcome, "confirmed") }
        var uppercase = original; uppercase["sessionID"] = wireID(sessionID).uppercased()
        do { _ = try await lane.handle(method: "contest_draft_apply", params: uppercase); XCTFail("Expected canonical UUID rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "invalid_params"); XCTAssertEqual(error.outcome, "confirmed") }
    }

    func testCQWWRejectsSerialReservationBeforeAllocation() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(lane, ruleName: "CQ WW CW")
        do {
            _ = try await lane.handle(method: "contest_serial_reserve", params: mutation(
                sessionID: sessionID, requestID: UUID(), revision: 1,
                timestamp: "2026-10-17T01:01:00.000Z", payload: [:], draftID: draftID))
            XCTFail("Expected CQ WW reservation rejection")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "serial_not_supported")
            XCTAssertEqual(error.outcome, "confirmed")
        }
        let opened = try await lane.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual(((opened["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, 1)
        XCTAssertTrue((opened["draft"] as? [String: Any])?["reservedSerial"] is NSNull)
    }

    func testGenerationFenceChecksBeforeAndAfterOperation() async throws {
        actor Sequence {
            var values = ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
            func next() -> String { values.count > 1 ? values.removeFirst() : values[0] }
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-fence-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let sequence = Sequence()
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { await sequence.next() }
        do { _ = try await lane.handle(method: "contest_catalog", params: [:]); XCTFail("Expected post-operation fence") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_workspace"); XCTAssertEqual(error.outcome, "uncertain") }
    }

    func testFullHighBitWorkspaceUUIDDistinguishesSameFirstSixtyFourBits() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, _, _) = try await makeSession(lane)
        let otherGeneration = "f1111111-2222-4333-9444-555555555555"
        let reopened = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { otherGeneration }
        do {
            _ = try await reopened.handle(method: "contest_open", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": otherGeneration,
            ])
            XCTFail("Expected full UUID generation mismatch")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "stale_workspace")
            XCTAssertEqual(error.outcome, "confirmed")
        }
    }

    func testPostCommitWorkspaceFenceFailureIsUncertainAndReceiptRemainsRecoverable() async throws {
        enum FenceFailure: Error { case unavailable }
        actor Fence {
            let generation: String
            var calls = 0
            init(_ generation: String) { self.generation = generation }
            func next() throws -> String {
                calls += 1
                if calls == 1 { return generation }
                throw FenceFailure.unavailable
            }
        }
        let (root, stable) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(stable)
        let requestID = UUID(uuidString: "b1234567-89ab-4cde-8fab-0123456789ab")!
        let digest = String(repeating: "b", count: 64)
        let params = mutation(sessionID: sessionID, requestID: requestID, revision: 1,
            timestamp: "2026-10-17T01:01:00.000Z", payload: ["fields": [
                "callsign": "K1ABC", "sentReport": "599", "sentExchange": "",
                "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000,
                "band": "20m", "mode": "CW",
            ]], draftID: draftID, digest: digest)
        let fence = Fence(generation)
        let uncertain = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) {
            try await fence.next()
        }
        do { _ = try await uncertain.handle(method: "contest_draft_apply", params: params); XCTFail("Expected post-commit fence failure") }
        catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "workspace_fence_failed")
            XCTAssertEqual(error.outcome, "uncertain")
        }
        let recovered = try await stable.handle(method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(requestID), "payloadDigest": digest,
        ])
        XCTAssertEqual(recovered["status"] as? String, "committed")
    }

    func testContestDatabaseRejectsBothProductionHardlinksAndSymlinkAncestorsBeforeOpeningSQLite() throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory.appendingPathComponent("xlog-contest-boundary-\(UUID().uuidString)")
        defer { try? fileManager.removeItem(at: root) }
        let applicationSupport = root.appendingPathComponent("Application Support")
        let testSupport = applicationSupport.appendingPathComponent("OM0RX-xLog-Contesting-Test")
        let contestDatabase = testSupport.appendingPathComponent("Contesting/contests.sqlite")
        let protected = [
            applicationSupport.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite"),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"),
        ]
        for database in protected {
            try fileManager.createDirectory(at: database.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("synthetic-production".utf8).write(to: database)
        }
        try fileManager.createDirectory(at: contestDatabase.deletingLastPathComponent(), withIntermediateDirectories: true)
        for production in protected {
            try fileManager.linkItem(at: production, to: contestDatabase)
            XCTAssertThrowsError(try ContestLane(databaseURL: contestDatabase) { [generation] in generation }) { error in
                XCTAssertEqual((error as? ContestLaneError)?.code, "unsafe_workspace")
            }
            XCTAssertEqual(try Data(contentsOf: production), Data("synthetic-production".utf8))
            try fileManager.removeItem(at: contestDatabase)
        }

        try fileManager.removeItem(at: testSupport)
        let redirected = root.appendingPathComponent("redirected")
        try fileManager.createDirectory(at: redirected, withIntermediateDirectories: true)
        try fileManager.createSymbolicLink(at: testSupport, withDestinationURL: redirected)
        XCTAssertThrowsError(try ContestLane(databaseURL: contestDatabase) { [generation] in generation }) { error in
            XCTAssertEqual((error as? ContestLaneError)?.code, "unsafe_workspace")
        }
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: redirected.path), [])
    }

    func testLiveWorkerBrowserWireLifecycleAndCrossLanguageFixture() async throws {
        enum FenceFailure: Error { case unavailable }
        actor Fence {
            let generation: String
            var calls = 0
            init(_ generation: String) { self.generation = generation }
            func next() throws -> String { calls += 1; if calls == 1 { return generation }; throw FenceFailure.unavailable }
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-worker-wire-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let health = try await workerRequest(worker, method: "health")
        XCTAssertEqual((health["result"] as? [String: Any])?["mode"] as? String, "contesting_test")
        let status = try await workerRequest(worker, method: "workspace_status")
        XCTAssertEqual((status["result"] as? [String: Any])?["workspace_exists"] as? Bool, true)

        let catalogFrame = try await workerRequest(worker, method: "contest_catalog")
        let catalog = try XCTUnwrap(catalogFrame["result"] as? [String: Any])
        let workspaceGeneration = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        XCTAssertEqual(workspaceGeneration, workspaceGeneration.lowercased())
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first { $0["displayName"] as? String == "CQ WPX CW" })
        let sessionID = UUID(uuidString: "f7654321-89ab-4cde-8fab-0123456789ab")!
        let createID = UUID(uuidString: "a7654321-89ab-4cde-8fab-0123456789ab")!
        let reserveID = UUID(uuidString: "b7654321-89ab-4cde-8fab-0123456789ab")!
        let applyID = UUID(uuidString: "c7654321-89ab-4cde-8fab-0123456789ab")!
        let commitID = UUID(uuidString: "d7654321-89ab-4cde-8fab-0123456789ab")!
        let payload: [String: Any] = [
            "sessionID": wireID(sessionID), "name": "Browser wire test",
            "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
            "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
            "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC"],
            "operator": ["callsign": "OM0RX", "category": "single-op"],
        ]
        let createParams = mutation(sessionID: sessionID, requestID: createID, revision: 0,
            timestamp: "2026-10-17T02:00:00.000Z", payload: payload, workspaceGeneration: workspaceGeneration)
        let created = try await workerRequest(worker, method: "contest_create", params: createParams)
        XCTAssertEqual(created["ok"] as? Bool, true)
        let draftID = createID
        let reserveParams = mutation(sessionID: sessionID, requestID: reserveID, revision: 1,
            timestamp: "2026-10-17T02:01:00.000Z", payload: [:], draftID: draftID,
            workspaceGeneration: workspaceGeneration)
        let reserved = try await workerRequest(worker, method: "contest_serial_reserve", params: reserveParams)
        XCTAssertEqual(reserved["ok"] as? Bool, true)
        let fields: [String: Any] = ["callsign": "K1ABC", "sentReport": "599", "sentExchange": "001",
            "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW"]
        let applyParams = mutation(sessionID: sessionID, requestID: applyID, revision: 2,
            timestamp: "2026-10-17T02:02:00.000Z", payload: ["fields": fields], draftID: draftID,
            workspaceGeneration: workspaceGeneration)
        let applied = try await workerRequest(worker, method: "contest_draft_apply", params: applyParams)
        XCTAssertEqual((((applied["result"] as? [String: Any])?["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue, 1)
        let commitParams = mutation(sessionID: sessionID, requestID: commitID, revision: 3,
            timestamp: "2026-10-17T02:03:00.000Z", payload: [:], draftID: draftID,
            workspaceGeneration: workspaceGeneration)
        let committed = try await workerRequest(worker, method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(committed["ok"] as? Bool, true)
        let laterParams = mutation(sessionID: sessionID, requestID: UUID(), revision: 4,
            timestamp: "2026-10-17T02:04:00.000Z", payload: ["fields": fields.merging(["callsign": "K1/"], uniquingKeysWith: { _, new in new })],
            draftID: draftID, workspaceGeneration: workspaceGeneration)
        _ = try await workerRequest(worker, method: "contest_draft_apply", params: laterParams)
        let replayed = try await workerRequest(worker, method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(try canonicalJSON(try XCTUnwrap(replayed["result"] as? [String: Any])),
                       try canonicalJSON(try XCTUnwrap(committed["result"] as? [String: Any])))

        let confirmed = try await workerRequest(worker, method: "contest_open", params: [
            "sessionID": wireID(sessionID).uppercased(), "workspaceGeneration": workspaceGeneration,
        ])
        XCTAssertEqual(((confirmed["error"] as? [String: Any])?["outcome"] as? String), "confirmed")

        let uncertainRequestID = UUID(uuidString: "e7654321-89ab-4cde-8fab-0123456789ab")!
        let uncertainParams = mutation(sessionID: sessionID, requestID: uncertainRequestID, revision: 5,
            timestamp: "2026-10-17T02:05:00.000Z", payload: ["fields": fields], draftID: draftID,
            digest: String(repeating: "e", count: 64), workspaceGeneration: workspaceGeneration)
        let fence = Fence(workspaceGeneration)
        let direct = try ContestLane(databaseURL: supportRoot.appendingPathComponent("Contesting/contests.sqlite")) { try await fence.next() }
        let uncertainError: ContestLaneError
        do { _ = try await direct.handle(method: "contest_draft_apply", params: uncertainParams); return XCTFail("Expected uncertain post-commit fence") }
        catch let error as ContestLaneError { uncertainError = error }
        XCTAssertEqual(uncertainError.outcome, "uncertain")
        let uncertainFrame: [String: Any] = ["id": "postcommit-fence", "ok": false,
            "error": ["code": uncertainError.code, "message": uncertainError.message, "outcome": uncertainError.outcome]]
        let receipt = try await workerRequest(worker, method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": workspaceGeneration,
            "requestID": wireID(uncertainRequestID), "payloadDigest": String(repeating: "e", count: 64),
        ])
        XCTAssertEqual((receipt["result"] as? [String: Any])?["status"] as? String, "committed")

        if let output = ProcessInfo.processInfo.environment["XLOG_CONTEST_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = ["schemaVersion": 2,
                "requests": ["create": createParams, "reserve": reserveParams, "apply": applyParams,
                             "commit": commitParams, "postCommitApply": uncertainParams],
                "responses": ["catalog": catalogFrame, "create": created, "reserve": reserved, "apply": applied, "commit": committed,
                              "replay": replayed, "confirmedError": confirmed, "postCommitUncertain": uncertainFrame,
                              "receiptAfterUncertain": receipt],
                "provenance": ["liveWorkerResponses": ["catalog", "create", "reserve", "apply", "commit", "replay", "confirmedError", "receiptAfterUncertain"],
                               "postCommitUncertain": "actual direct ContestLane error serialized by the Swift fixture test; not a LiveWorker response"],
                "assertions": ["replayResultExactlyEqual": true, "allContestUUIDsCanonicalLowercase": true]]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
        }
    }

    func testWorkerAllowsContestOnlyInBoundTestProfileAndStillDeniesExternalIO() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-worker-lane-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        func request(_ method: String) async throws -> [String: Any] {
            let data = try JSONSerialization.data(withJSONObject: ["id": wireID(UUID()), "method": method, "params": [:]])
            let responseData = await worker.response(to: data)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: responseData) as? [String: Any])
        }
        let catalog = try await request("contest_catalog")
        XCTAssertEqual(catalog["ok"] as? Bool, true)
        let external = try await request("cluster_connect")
        XCTAssertEqual((external["error"] as? [String: Any])?["code"] as? String, "external_io_disabled")

        let production = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root.appendingPathComponent("production"), inheritNativePreferences: false))
        let data = try JSONSerialization.data(withJSONObject: ["id": "production", "method": "contest_catalog", "params": [:]])
        let responseData = await production.response(to: data)
        let response = try XCTUnwrap(JSONSerialization.jsonObject(with: responseData) as? [String: Any])
        XCTAssertEqual((response["error"] as? [String: Any])?["code"] as? String, "contest_profile_required")
    }
}
