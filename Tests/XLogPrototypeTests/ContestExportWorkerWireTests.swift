import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class ContestExportWorkerWireTests: XCTestCase {
    func testLiveWorkerPrepareReadReplayReleaseAndGeneratedFixture() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-export-wire-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)

        let catalogFrame = try await frame(worker, method: "contest_catalog")
        let catalog = try result(catalogFrame)
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first { $0["displayName"] as? String == "CQ WW CW" })
        let sessionID = UUID(uuidString: "e1111111-2222-4333-8444-555555555555")!
        let createID = UUID(uuidString: "e2111111-2222-4333-8444-555555555555")!
        let applyID = UUID(uuidString: "e3111111-2222-4333-8444-555555555555")!
        let commitID = UUID(uuidString: "e4111111-2222-4333-8444-555555555555")!
        let exportID = UUID(uuidString: "e5111111-2222-4333-8444-555555555555")!
        let create = mutation(sessionID: sessionID, requestID: createID, revision: 0,
            timestamp: "2026-10-17T03:00:00.000Z", generation: generation, payload: [
                "sessionID": wire(sessionID), "name": "Export wire fixture",
                "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
                "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
                "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC"],
                "operator": ["callsign": "OM0RX", "category": "Single Operator"],
            ])
        let created = try await frame(worker, method: "contest_create", params: create)
        let draftID = createID
        let apply = mutation(sessionID: sessionID, requestID: applyID, revision: 1,
            timestamp: "2026-10-17T03:01:00.000Z", generation: generation, draftID: draftID, payload: ["fields": [
                "callsign": "K1ABC", "sentReport": "599", "sentExchange": "15",
                "receivedReport": "599", "receivedExchange": "05", "frequencyHz": 14_024_500,
                "band": "20m", "mode": "CW",
            ]])
        let applied = try await frame(worker, method: "contest_draft_apply", params: apply)
        let commit = mutation(sessionID: sessionID, requestID: commitID, revision: 2,
            timestamp: "2026-10-17T03:02:00.000Z", generation: generation, draftID: draftID, payload: [:])
        let committed = try await frame(worker, method: "contest_qso_commit", params: commit)
        let committedResult = try result(committed)
        let committedSession = try XCTUnwrap(committedResult["session"] as? [String: Any])
        let revision = try XCTUnwrap((committedSession["revision"] as? NSNumber)?.uint64Value)

        let prepare: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(sessionID),
            "workspaceGeneration": generation, "expectedRevision": revision,
            "generatedAtUTC": "2026-10-17T03:03:00.000Z", "format": "cabrillo",
            "header": ["callsign": "OM0RX", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
                "categoryBand": "ALL", "categoryMode": "CW", "categoryTransmitter": "ONE", "categoryPower": "LOW",
                "operators": ["OM0RX"], "location": "DX", "name": "Oliver Operator",
                "addressLines": ["Test Street 1"], "email": "operator@example.test"]]
        let preparedFrame = try await frame(worker, method: "contest_export_prepare", params: prepare)
        let replayFrame = try await frame(worker, method: "contest_export_prepare", params: prepare)
        XCTAssertEqual(try canonical(try result(preparedFrame)), try canonical(try result(replayFrame)))
        let prepared = try result(preparedFrame)
        let openAfterPrepare = try await frame(worker, method: "contest_open", params: [
            "sessionID": wire(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual((((try result(openAfterPrepare))["session"] as? [String: Any])?["revision"] as? NSNumber)?.uint64Value, revision)
        let laterID = UUID(uuidString: "e6111111-2222-4333-8444-555555555555")!
        let later = mutation(sessionID: sessionID, requestID: laterID, revision: revision,
            timestamp: "2026-10-17T03:04:00.000Z", generation: generation, draftID: draftID,
            payload: ["fields": ["callsign": "K1/", "sentReport": "599", "sentExchange": "15",
                "receivedReport": "599", "receivedExchange": "", "frequencyHz": NSNull(),
                "band": "20m", "mode": "CW"]])
        let laterMutation = try await frame(worker, method: "contest_draft_apply", params: later)
        XCTAssertEqual((((try result(laterMutation))["session"] as? [String: Any])?["revision"] as? NSNumber)?.uint64Value, revision + 1)
        let byteLength = try XCTUnwrap((prepared["byteLength"] as? NSNumber)?.intValue)
        let chunkLimit = try XCTUnwrap((prepared["chunkLimit"] as? NSNumber)?.intValue)
        var readRequests: [[String: Any]] = [], readFrames: [[String: Any]] = [], offset = 0
        while offset < byteLength {
            let length = min(chunkLimit, byteLength - offset)
            let request: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(sessionID),
                "workspaceGeneration": generation, "offset": offset, "length": length]
            let response = try await frame(worker, method: "contest_export_read", params: request)
            readRequests.append(request); readFrames.append(response); offset += length
        }
        XCTAssertEqual((try result(readFrames.last!))["eof"] as? Bool, true)

        let release: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(sessionID), "workspaceGeneration": generation]
        let released = try await frame(worker, method: "contest_export_release", params: release)
        let unavailable = try await frame(worker, method: "contest_export_read", params: readRequests[0])
        XCTAssertEqual((unavailable["error"] as? [String: Any])?["code"] as? String, "artifact_unavailable")
        let unknown = try await frame(worker, method: "contest_export_unknown")
        XCTAssertEqual((unknown["error"] as? [String: Any])?["code"] as? String, "unknown_method")

        let production = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root.appendingPathComponent("production"),
            inheritNativePreferences: false), runtimeProfile: .production)
        let wrongProfile = try await frame(production, method: "contest_export_prepare", params: prepare)
        XCTAssertEqual((wrongProfile["error"] as? [String: Any])?["code"] as? String, "contest_profile_required")
        await worker.beginTerminalShutdown()
        let stopped = try await frame(worker, method: "contest_export_prepare", params: prepare)
        XCTAssertEqual((stopped["error"] as? [String: Any])?["code"] as? String, "worker_stopping")

        if let output = ProcessInfo.processInfo.environment["XLOG_CONTEST_EXPORT_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = ["schemaVersion": 1,
                "requests": ["prepare": prepare, "reads": readRequests, "release": release, "laterMutation": later],
                "responses": ["prepare": preparedFrame, "replay": replayFrame, "reads": readFrames,
                    "release": released, "unavailable": unavailable, "unknownMethod": unknown,
                    "wrongProfile": wrongProfile, "stopped": stopped, "openAfterPrepare": openAfterPrepare,
                    "laterMutation": laterMutation],
                "provenance": ["liveWorkerResponses": true,
                    "wrongWindow": "Validated by native worker surface-admission tests; Swift LiveWorker has no window label."],
                "assertions": ["replayResultExactlyEqual": true, "releasedReadUnavailable": true,
                    "prepareDidNotAdvanceRevision": true, "historicalReadAfterLaterMutation": true]]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
        }
        _ = created; _ = applied
    }

    func testContestLaneShutdownFencesFirstAndFinalExportGenerationAwaits() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-export-shutdown-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let generation = UUID(uuidString: "d1111111-2222-4333-8444-555555555555")!
        let generationWire = wire(generation)
        let release: [String: Any] = ["exportID": "e5111111-2222-4333-8444-555555555555",
            "sessionID": "e1111111-2222-4333-8444-555555555555", "workspaceGeneration": generationWire]

        let firstGate = ExportWorkerGenerationGate()
        let firstDatabase = root.appendingPathComponent("first/contests.sqlite")
        let firstLane = try ContestLane(databaseURL: firstDatabase) { await firstGate.next() }
        let first = Task { try await firstLane.handle(method: "contest_export_release", params: release) }
        await firstGate.waitForCalls(1)
        await firstLane.shutdown()
        await firstGate.resolve(1, generation: generationWire)
        await assertLaneTaskError("artifact_unavailable", first)
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstDatabase.path))

        let finalGate = ExportWorkerGenerationGate()
        let exportLane = ContestExportLane(generationSource: { generation }, cache: ContestExportArtifactCache()) { _ in
            throw ExportWorkerTestFailure.unexpectedProducer
        }
        let finalLane = try ContestLane(databaseURL: root.appendingPathComponent("final/contests.sqlite"),
            generationSource: { await finalGate.next() }, exportLane: exportLane)
        let final = Task { try await finalLane.handle(method: "contest_export_release", params: release) }
        await finalGate.waitForCalls(1)
        await finalGate.resolve(1, generation: generationWire)
        await finalGate.waitForCalls(2)
        await finalLane.shutdown()
        await finalGate.resolve(2, generation: generationWire)
        await assertLaneTaskError("artifact_unavailable", final)
    }

    func testPendingPrepareDoesNotBlockReleaseOrOrdinaryContestRequest() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-export-routing-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let generation = UUID(uuidString: "d1111111-2222-4333-8444-555555555555")!
        let generationWire = wire(generation)
        let producer = ExportWorkerProducerGate()
        let exportLane = ContestExportLane(generationSource: { generation }, cache: ContestExportArtifactCache()) { request in
            try await producer.produce(request)
        }
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("contests.sqlite"),
            generationSource: { generationWire }, exportLane: exportLane)
        let exportID = "e5111111-2222-4333-8444-555555555555"
        let sessionID = "e1111111-2222-4333-8444-555555555555"
        let prepare: [String: Any] = ["exportID": exportID, "sessionID": sessionID,
            "workspaceGeneration": generationWire, "expectedRevision": 1,
            "generatedAtUTC": "2026-10-17T03:03:00.000Z", "format": "cabrillo",
            "header": exportHeader()]
        let pending = Task { try await lane.handle(method: "contest_export_prepare", params: prepare) }
        await producer.waitUntilStarted()

        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
        XCTAssertEqual(catalog["workspaceGeneration"] as? String, generationWire)
        let released = try await lane.handle(method: "contest_export_release", params: [
            "exportID": exportID, "sessionID": sessionID, "workspaceGeneration": generationWire,
        ])
        XCTAssertEqual(released["released"] as? Bool, false)

        await producer.resume()
        await assertLaneTaskError("artifact_unavailable", pending)
    }

    private func frame(_ worker: LiveWorker, method: String, params: [String: Any] = [:]) async throws -> [String: Any] {
        let request: [String: Any] = ["id": "export-\(method)", "method": method, "params": params]
        let response = await worker.response(to: try JSONSerialization.data(withJSONObject: request))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
    }

    private func result(_ frame: [String: Any]) throws -> [String: Any] {
        XCTAssertEqual(frame["ok"] as? Bool, true)
        return try XCTUnwrap(frame["result"] as? [String: Any])
    }

    private func mutation(sessionID: UUID, requestID: UUID, revision: UInt64, timestamp: String,
                          generation: String, draftID: UUID? = nil, payload: [String: Any]) -> [String: Any] {
        var value: [String: Any] = ["sessionID": wire(sessionID), "workspaceGeneration": generation,
            "requestID": wire(requestID), "expectedRevision": revision,
            "payloadDigest": String(repeating: String(format: "%x", Int(revision % 15) + 1), count: 64),
            "operationTimestamp": timestamp, "payload": payload]
        if let draftID { value["draftID"] = wire(draftID) }
        return value
    }

    private func canonical(_ value: Any) throws -> String {
        String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
    }

    private func exportHeader() -> [String: Any] {
        ["callsign": "OM0RX", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
         "categoryBand": "ALL", "categoryMode": "CW", "categoryTransmitter": "ONE", "categoryPower": "LOW",
         "operators": ["OM0RX"], "location": "DX", "name": "Oliver Operator",
         "addressLines": ["Test Street 1"], "email": "operator@example.test"]
    }

    private func assertLaneTaskError<T>(_ code: String, _ task: Task<T, Error>,
                                        file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await task.value; XCTFail("Expected \(code)", file: file, line: line) }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, code, file: file, line: line) }
        catch { XCTFail("Unexpected error: \(error)", file: file, line: line) }
    }

    private func wire(_ value: UUID) -> String { value.uuidString.lowercased() }
}

private enum ExportWorkerTestFailure: Error { case unexpectedProducer, released }

private actor ExportWorkerGenerationGate {
    private var callCount = 0
    private var continuations: [Int: CheckedContinuation<String, Never>] = [:]

    func next() async -> String {
        callCount += 1
        let index = callCount
        return await withCheckedContinuation { continuations[index] = $0 }
    }

    func waitForCalls(_ count: Int) async {
        while callCount < count { await Task.yield() }
    }

    func resolve(_ index: Int, generation: String) {
        continuations.removeValue(forKey: index)?.resume(returning: generation)
    }
}

private actor ExportWorkerProducerGate {
    private var started = false
    private var continuation: CheckedContinuation<Void, Never>?

    func produce(_ request: ContestExportPrepareRequest) async throws -> ContestExportArtifact {
        _ = request
        started = true
        await withCheckedContinuation { continuation = $0 }
        throw ExportWorkerTestFailure.released
    }

    func waitUntilStarted() async {
        while !started { await Task.yield() }
    }

    func resume() {
        continuation?.resume()
        continuation = nil
    }
}
