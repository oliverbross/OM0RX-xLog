import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class ContestSCPWorkerIntegrationTests: XCTestCase {
    func testShutdownDuringReplacementAwaitNeverPublishesNewLane() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-replace-shutdown-\(UUID().uuidString)")
        defer{try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        let gate=ReplacementPublishGate(blockedOrdinal:2)
        let cacheURL=root.appendingPathComponent("SuperCheckPartial/current.json")
        let service=try ContestSCPService(cacheURL:cacheURL,
            validatePrivateRoot:{try ContestDatabaseBoundary.validatePrivateFile(cacheURL,privateRoot:root,
                ancestorBoundary:root.deletingLastPathComponent(),protectedFiles:[])},
            beforeReplacementPublish:{await gate.reach()}){_ in}
        let first=root.appendingPathComponent("first.scp"),second=root.appendingPathComponent("second.scp")
        try Data("K1ABC\n".utf8).write(to:first);try Data("N1XYZ\n".utf8).write(to:second)
        _=try await service.importFile(path:first.path,sourceName:"first.scp",retrievedAt:Date(timeIntervalSince1970:1))
        let replacement=Task{try await service.importFile(path:second.path,sourceName:"second.scp",retrievedAt:Date(timeIntervalSince1970:2))}
        await gate.awaitBlocked();await service.shutdown();await gate.release()
        do{_=try await replacement.value;XCTFail("Expected stopped replacement")}
        catch let error as ContestSCPServiceError{if case .stopped=error{}else{XCTFail("Unexpected error \(error)")}}
        let status=await service.status();XCTAssertNil(status.dataset);XCTAssertEqual(status.unavailableReason,"stopped")
    }

    func testUnsafeCacheAncestorNeverTouchesProtectedSentinel() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-unsafe-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode":"empty"])
        let contestRoot = supportRoot.appendingPathComponent("Contesting", isDirectory: true)
        try FileManager.default.createDirectory(at: contestRoot, withIntermediateDirectories: true)
        let protected = root.appendingPathComponent("protected", isDirectory: true)
        try FileManager.default.createDirectory(at: protected, withIntermediateDirectories: true)
        let sentinel = protected.appendingPathComponent("current.json"), sentinelBytes = Data("protected-sentinel".utf8)
        try sentinelBytes.write(to: sentinel)
        try FileManager.default.createSymbolicLink(at: contestRoot.appendingPathComponent("SuperCheckPartial"),
                                                   withDestinationURL: protected)
        let source = root.appendingPathComponent("tiny.scp")
        try Data("K1ABC\n".utf8).write(to: source)
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let rejected = await frame(worker, "contest_scp_import_private",
                                   ["path":source.path,"sourceName":"tiny.scp"])
        XCTAssertEqual(rejected["ok"] as? Bool, false)
        XCTAssertEqual(try Data(contentsOf: sentinel), sentinelBytes)
        try FileManager.default.removeItem(at: contestRoot.appendingPathComponent("SuperCheckPartial"))
        let safeCache=contestRoot.appendingPathComponent("SuperCheckPartial",isDirectory:true)
        try FileManager.default.createDirectory(at:safeCache,withIntermediateDirectories:true)
        try FileManager.default.createSymbolicLink(at:safeCache.appendingPathComponent("current.json"),withDestinationURL:sentinel)
        let leafRejected=await frame(worker,"contest_scp_import_private",["path":source.path,"sourceName":"tiny.scp"])
        XCTAssertEqual(leafRejected["ok"] as? Bool,false)
        XCTAssertEqual(try Data(contentsOf:sentinel),sentinelBytes)
    }

    func testCorruptCacheIsUnavailableAndValidImportRecoversAcrossRestart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-corrupt-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode":"empty"])
        let cache = supportRoot.appendingPathComponent("Contesting/SuperCheckPartial/current.json")
        try FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("corrupt".utf8).write(to: cache)
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let unavailable = try result(await frame(worker, "contest_scp_status"))
        XCTAssertTrue(unavailable["dataset"] is NSNull)
        XCTAssertEqual(unavailable["unavailableReason"] as? String, "invalid_cache")
        let source = root.appendingPathComponent("recovered.scp")
        try Data("K1ABC\n".utf8).write(to: source)
        _ = try result(await frame(worker, "contest_scp_import_private", ["path":source.path,"sourceName":"recovered.scp"]))
        let restored = try result(await frame(LiveWorker(logbook: logbook, runtimeProfile: profile), "contest_scp_status"))
        XCTAssertEqual((restored["dataset"] as? [String:Any])?["version"] as? String, "recovered.scp")
        XCTAssertTrue(restored["unavailableReason"] is NSNull)
    }

    func testWorkerImportQueryAuthoritativeSelectionReplacementFailureAndRestart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-wire-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let catalog = try result(await frame(worker, "contest_catalog"))
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first {
            (($0["identity"] as? [String: Any])?["id"] as? String) == "cq-ww-cw"
        })
        XCTAssertEqual((rule["identity"] as? [String: Any])?["id"] as? String, "cq-ww-cw")
        let sessionID = wire(UUID()), createID = wire(UUID())
        let payload: [String: Any] = ["sessionID": sessionID, "name": "SCP test",
            "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
            "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
            "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC"],
            "operator": ["callsign": "OM0RX", "category": "single-op"]]
        _ = try result(await frame(worker, "contest_create", ["sessionID":sessionID,"workspaceGeneration":generation,
            "requestID":createID,"expectedRevision":0,"payloadDigest":String(repeating:"a",count:64),
            "operationTimestamp":"2026-10-18T00:00:00.000Z","payload":payload]))

        let source = root.appendingPathComponent("tiny.scp")
        try Data("!!Order,1,1\nK1ABC\nK1ABD\n".utf8).write(to: source)
        let imported = try result(await frame(worker, "contest_scp_import_private",
                                              ["path":source.path,"sourceName":"tiny.scp"]))
        XCTAssertEqual((imported["dataset"] as? [String: Any])?["recordCount"] as? Int, 2)
        let requestID = wire(UUID())
        let query = try result(await frame(worker, "contest_scp_query", ["sessionID":sessionID,
            "workspaceGeneration":generation,"requestID":requestID,"query":"K1AB"]))
        let match = try XCTUnwrap((query["matches"] as? [[String: Any]])?.first)
        let selected = try result(await frame(worker, "contest_scp_select", ["sessionID":sessionID,
            "workspaceGeneration":generation,"requestID":requestID,"matchID":try XCTUnwrap(match["matchID"] as? String)]))
        XCTAssertEqual(selected["callsign"] as? String, "K1ABC")

        let cancelledRequestID = wire(UUID())
        let cancellable = try result(await frame(worker, "contest_scp_query", ["sessionID":sessionID,
            "workspaceGeneration":generation,"requestID":cancelledRequestID,"query":"K1AB"]))
        let cancelledMatch = try XCTUnwrap((cancellable["matches"] as? [[String: Any]])?.first)
        let cancelled = try result(await frame(worker, "contest_scp_cancel", ["sessionID":sessionID,
            "workspaceGeneration":generation,"requestID":cancelledRequestID]))
        XCTAssertEqual(cancelled["cancelled"] as? Bool, true)
        let cancelledSelection = await frame(worker, "contest_scp_select", ["sessionID":sessionID,
            "workspaceGeneration":generation,"requestID":cancelledRequestID,
            "matchID":try XCTUnwrap(cancelledMatch["matchID"] as? String)])
        XCTAssertEqual((cancelledSelection["error"] as? [String: Any])?["code"] as? String, "selection_unavailable")

        let replacement = root.appendingPathComponent("replacement.scp")
        try Data("!!Order,1,1\nN1XYZ\n".utf8).write(to: replacement)
        _ = try result(await frame(worker, "contest_scp_import_private",
                                   ["path":replacement.path,"sourceName":"replacement.scp"]))
        let oldSelection = await frame(worker, "contest_scp_select", ["sessionID":sessionID,
            "workspaceGeneration":generation,"requestID":requestID,"matchID":try XCTUnwrap(match["matchID"] as? String)])
        XCTAssertEqual((oldSelection["error"] as? [String: Any])?["code"] as? String, "selection_unavailable")

        let invalid = root.appendingPathComponent("invalid.scp"); try Data("ß1\n".utf8).write(to: invalid)
        let rejected = await frame(worker, "contest_scp_import_private", ["path":invalid.path,"sourceName":"invalid.scp"])
        XCTAssertEqual(rejected["ok"] as? Bool, false)
        let oversized = root.appendingPathComponent("oversized.scp")
        FileManager.default.createFile(atPath: oversized.path, contents: nil)
        let oversizedHandle = try FileHandle(forWritingTo: oversized)
        try oversizedHandle.truncate(atOffset: 16 * 1_024 * 1_024 + 1)
        try oversizedHandle.close()
        let oversizedRejected = await frame(worker, "contest_scp_import_private",
                                             ["path":oversized.path,"sourceName":"oversized.scp"])
        XCTAssertEqual(oversizedRejected["ok"] as? Bool, false)
        let retained = try result(await frame(worker, "contest_scp_status"))
        XCTAssertEqual((retained["dataset"] as? [String: Any])?["version"] as? String, "replacement.scp")

        let restarted = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let restored = try result(await frame(restarted, "contest_scp_status"))
        XCTAssertEqual((restored["dataset"] as? [String: Any])?["recordCount"] as? Int, 1)
        let stale = await frame(restarted, "contest_scp_select", ["sessionID":sessionID,
            "workspaceGeneration":generation,"requestID":requestID,"matchID":try XCTUnwrap(match["matchID"] as? String)])
        XCTAssertEqual((stale["error"] as? [String: Any])?["code"] as? String, "selection_unavailable")
    }

    private func frame(_ worker: LiveWorker, _ method: String, _ params: [String: Any] = [:]) async -> [String: Any] {
        let data = try! JSONSerialization.data(withJSONObject: ["id":wire(UUID()),"method":method,"params":params])
        return (try? JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any]) ?? [:]
    }
    private func result(_ frame: [String: Any]) throws -> [String: Any] {
        if frame["ok"] as? Bool == true { return try XCTUnwrap(frame["result"] as? [String: Any]) }
        throw NSError(domain:"SCPWorker",code:1,userInfo:[NSLocalizedDescriptionKey:String(describing:frame)])
    }
    private func wire(_ value: UUID) -> String { value.uuidString.lowercased() }
}

private actor ReplacementPublishGate {
    let blockedOrdinal:Int;private var ordinal=0,blocked=false;private var continuation:CheckedContinuation<Void,Never>?
    init(blockedOrdinal:Int){self.blockedOrdinal=blockedOrdinal}
    func reach()async{ordinal+=1;if ordinal==blockedOrdinal{await withCheckedContinuation{continuation=$0;blocked=true}}}
    func awaitBlocked()async{while !blocked{await Task.yield()}}
    func release(){continuation?.resume();continuation=nil}
}
