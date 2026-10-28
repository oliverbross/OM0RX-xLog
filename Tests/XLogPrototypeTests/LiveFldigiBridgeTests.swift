#if os(macOS)
import CryptoKit
import XCTest
import XLogCore
@testable import XLogPrototypeSupport

private final class FakeFldigiReceiver: WSJTXDatagramReceiving, @unchecked Sendable {
    var onDatagram: (@Sendable (Data, String) -> Void)?
    private(set) var started: (String, UInt16)?
    private(set) var stops = 0
    func start(address: String, port: UInt16) throws { started = (address, port) }
    func stop() { stops += 1 }
}

private actor FakeFldigiRPC: FldigiXMLRPCCalling {
    var calls: [(String, String?)] = []
    var failureMethod: String?
    var gateMainTX = false
    var gateText = false
    private var continuation: CheckedContinuation<Void, Never>?

    func call(method: String, string: String?) async throws {
        calls.append((method, string))
        if gateMainTX && method == "main.tx" || gateText && method == "text.add_tx" { await withCheckedContinuation { continuation = $0 } }
        if failureMethod == method { throw WorkerFailure("test_failure", "failed") }
    }
    func release() { continuation?.resume(); continuation = nil }
    func recorded() -> [(String, String?)] { calls }
    func receivedText() async throws -> (text:String,instance:String,version:String){("CQ K1ABC 599 CT","fake-fldigi-A","4.2-fixture")}
}

private final class FldigiIdentityState: @unchecked Sendable {
    private let lock = NSLock()
    private var values = Set<String>()
    func duplicate(_ value: String) -> Bool { lock.withLock { !values.insert(value).inserted } }
}

final class LiveFldigiBridgeTests: XCTestCase {
    func testAutomaticLifecycleNeverControlsUnownedFldigi() async throws {
        for lifecycle in ["shutdown", "workspace"] {
            for state in ["never", "disabled", "receive", "enabled-unused"] {
                let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-unowned-\(UUID())")
                defer { try? FileManager.default.removeItem(at: root) }
                let rpc = FakeFldigiRPC(), lease = destination()
                let bridge = LiveFldigiBridge(configurationURL: root.appendingPathComponent("fldigi.json"),
                    externalIOAllowed: { true }, receiverFactory: { _, _ in FakeFldigiReceiver() }, rpc: rpc)
                if state != "never" {
                    _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration": [
                        "receive_enabled": state == "receive", "transmit_enabled": state == "enabled-unused"]],
                        receiveDestination: lease, transmitDestination: lease, contestImporter: { _, _ in false })
                }
                if state == "receive" {
                    _ = try await bridge.handle(method: "fldigi_start", params: [:], receiveDestination: lease,
                        transmitDestination: lease, contestImporter: { _, _ in false })
                }
                if lifecycle == "shutdown" { await bridge.stopForShutdown() } else { await bridge.suspendForWorkspaceChange() }
                let calls = await rpc.recorded()
                XCTAssertTrue(calls.isEmpty, "Automatic \(lifecycle) controlled \(state) external engine")
            }
        }
    }

    func testOwnedLifecycleReleasesOnceAndUncertainReleaseBlocksNewOutputUntilExplicitStop() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-owned-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let rpc = FakeFldigiRPC(), lease = destination()
        let bridge = LiveFldigiBridge(configurationURL: root.appendingPathComponent("fldigi.json"), externalIOAllowed: { true }, rpc: rpc)
        let configure: [String: Any] = ["configuration": ["receive_enabled": false, "transmit_enabled": true]]
        _ = try await bridge.handle(method: "fldigi_configure", params: configure, receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        _ = try await bridge.handle(method: "fldigi_send", params: ["actions": [action(lease)]], receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await rpc.setFailureMethodForTesting("main.rx")
        await bridge.suspendForWorkspaceChange()
        _ = try await bridge.handle(method: "fldigi_configure", params: configure, receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        let snapshot = try await bridge.handle(method: "fldigi_snapshot", params: [:], receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        XCTAssertEqual(snapshot["transmit_release_required"] as? Bool, true)
        XCTAssertEqual(snapshot["transmit_release_uncertain"] as? Bool, true)
        do {
            _ = try await bridge.handle(method: "fldigi_send", params: ["actions": [action(lease)]], receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
            XCTFail("Uncertain release allowed new output")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "fldigi_release_required") }
        await rpc.setFailureMethodForTesting(nil)
        let stopped = try await bridge.handle(method: "fldigi_stop", params: [:], receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        XCTAssertEqual(stopped["transmit_release_required"] as? Bool, false)
        XCTAssertEqual(stopped["transmit_release_uncertain"] as? Bool, false)
        await bridge.stopForShutdown()
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.tx", "text.add_tx", "main.rx", "main.rx"])
    }

    func testAutomaticShutdownRetainsPendingTXDutyUntilLateAttemptRetires() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-pending-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let rpc = FakeFldigiRPC(), lease = destination()
        let bridge = LiveFldigiBridge(configurationURL: root.appendingPathComponent("fldigi.json"), externalIOAllowed: { true }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration": ["receive_enabled": false, "transmit_enabled": true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await rpc.setGateForTesting(true)
        let pending = Task { try await bridge.handle(method: "fldigi_send", params: ["actions": [self.action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil) }
        while await rpc.recorded().isEmpty { await Task.yield() }
        await bridge.stopForShutdown()
        await rpc.release()
        do { _ = try await pending.value; XCTFail("Retired output continued") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "stale_context") }
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.tx", "main.rx", "main.rx"])
        await bridge.stopForShutdown()
        let repeated = await rpc.recorded()
        XCTAssertEqual(repeated.count, calls.count)
    }

    func testExplicitEmergencyStopStillSendsRXWithoutPriorTransmitDuty() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-emergency-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let rpc = FakeFldigiRPC(), bridge = LiveFldigiBridge(configurationURL: root.appendingPathComponent("fldigi.json"), externalIOAllowed: { true }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_stop", params: [:], receiveDestination: nil, transmitDestination: nil, contestImporter: nil)
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.rx"])
    }

    func testWorkspaceRetirementDuringPendingTextCannotStartTheNextAction() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-text-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let rpc = FakeFldigiRPC(), lease = destination()
        let bridge = LiveFldigiBridge(configurationURL: root.appendingPathComponent("fldigi.json"), externalIOAllowed: { true }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration": ["receive_enabled": false, "transmit_enabled": true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await rpc.setTextGateForTesting()
        let pending = Task { try await bridge.handle(method: "fldigi_send", params: ["actions": [self.action(lease), self.action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil) }
        while await rpc.recorded().count < 2 { await Task.yield() }
        await bridge.suspendForWorkspaceChange()
        await rpc.release()
        do { _ = try await pending.value; XCTFail("Retired bundle continued") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "stale_context") }
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.tx", "text.add_tx", "main.rx", "main.rx"])
    }

    func testInvalidLaterActionNeverPartiallyTransmitsTheBundle() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-invalid-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let rpc = FakeFldigiRPC(), lease = destination()
        let bridge = LiveFldigiBridge(configurationURL: root.appendingPathComponent("fldigi.json"), externalIOAllowed: { true }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration": ["receive_enabled": false, "transmit_enabled": true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        var malformed = action(lease); malformed["payloadSHA256"] = "wrong"
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method: "fldigi_send", params: ["actions": [action(lease), malformed]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil))
        await bridge.stopForShutdown()
        let calls = await rpc.recorded()
        XCTAssertTrue(calls.isEmpty)
    }

    private func destination(_ id: String = UUID().uuidString.lowercased()) -> WSJTXContestDestination {
        .init(sessionID: id, workspaceGeneration: UUID().uuidString.lowercased(),
              pluginID: "cq_ww_rtty", sourceRevision: "source")
    }

    private func action(_ destination: WSJTXContestDestination, payload: String = "CQ^MTEST") -> [String: Any] {
        let data = Data(payload.utf8), digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return ["kind":"fldigi", "signal":"digital", "mode":"RTTY", "payload":payload,
                "payloadUTF8Bytes":data.count, "payloadSHA256":digest, "nlBefore":true, "rxAfter":true,
                "sessionID":destination.sessionID, "workspaceGeneration":destination.workspaceGeneration,
                "sourceRevision":destination.sourceRevision, "draftID":UUID().uuidString.lowercased(), "actionID":"op:0"]
    }

    func testLoopbackReceiveRoutesOneBoundedADIFThroughContestLease() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-fldigi-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let receiver = FakeFldigiReceiver(), rpc = FakeFldigiRPC(), lease = destination()
        let bridge = LiveFldigiBridge(configurationURL: directory.appendingPathComponent("fldigi.json"),
            externalIOAllowed: { true }, receiverFactory: { handler, _ in receiver.onDatagram = handler; return receiver }, rpc: rpc)
        let identities = FldigiIdentityState()
        let importer: @Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool = { record, supplied in
            XCTAssertEqual(supplied, lease); return identities.duplicate(try XCTUnwrap(record.semanticIdentityHash))
        }
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration":["receive_enabled":true,"transmit_enabled":false]],
            receiveDestination: lease, transmitDestination: lease, contestImporter: importer)
        _ = try await bridge.handle(method: "fldigi_start", params: [:], receiveDestination: lease, transmitDestination: lease, contestImporter: importer)
        XCTAssertEqual(receiver.started?.0, "127.0.0.1"); XCTAssertEqual(receiver.started?.1, 9_876)
        let adif = "<CALL:5>VK8AA<QSO_DATE:8>20261021<TIME_ON:6>120000<BAND:3>20M<MODE:4>RTTY<EOR>"
        await bridge.ingest(Data(adif.utf8)); await bridge.ingest(Data(adif.utf8))
        var snapshot = try await bridge.handle(method: "fldigi_snapshot", params: [:], receiveDestination: lease,
            transmitDestination: lease, contestImporter: importer)
        XCTAssertEqual(snapshot["imported_count"] as? Int,0)
        var row=try XCTUnwrap((snapshot["completed"] as? [[String:Any]])?.first)
        let scope:[String:Any]=["sessionID":lease.sessionID,"workspaceGeneration":lease.workspaceGeneration,"laneID":lease.laneID,"bindingVersion":lease.bindingVersion]
        snapshot=try await bridge.handle(method:"fldigi_accept_completed",params:scope.merging(["id":row["id"]!]){_,new in new},receiveDestination:lease,transmitDestination:lease,contestImporter:importer)
        await bridge.ingest(Data(adif.utf8))
        snapshot=try await bridge.handle(method:"fldigi_snapshot",params:[:],receiveDestination:lease,transmitDestination:lease,contestImporter:importer)
        row=try XCTUnwrap((snapshot["completed"] as? [[String:Any]])?.first)
        snapshot=try await bridge.handle(method:"fldigi_accept_completed",params:scope.merging(["id":row["id"]!]){_,new in new},receiveDestination:lease,transmitDestination:lease,contestImporter:importer)
        XCTAssertEqual(snapshot["imported_count"] as? Int, 1); XCTAssertEqual(snapshot["duplicate_count"] as? Int, 1)
    }

    func testReceivedTextSelectionIsExactNontransmittingAndRetiredWithContext() async throws {
        let rpc=FakeFldigiRPC(),lease=destination(),bridge=LiveFldigiBridge(configurationURL:FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-\(UUID().uuidString).json"),externalIOAllowed:{true},rpc:rpc)
        let text=try await bridge.handle(method:"fldigi_rx_text",params:[:],receiveDestination:lease,transmitDestination:nil,contestImporter:nil)
        let selection=try await bridge.handle(method:"fldigi_select",params:["id":text["id"]!,"token":"CT"],receiveDestination:lease,transmitDestination:nil,contestImporter:nil)
        XCTAssertEqual(selection["value"] as? String,"CT");XCTAssertEqual(selection["transmitted"] as? Bool,false)
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method:"fldigi_select",params:["id":text["id"]!,"token":"NOT-IN-TEXT"],receiveDestination:lease,transmitDestination:nil,contestImporter:nil))
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method:"fldigi_select",params:["id":text["id"]!,"token":"CT"],receiveDestination:destination(),transmitDestination:nil,contestImporter:nil))
        let calls=await rpc.recorded();XCTAssertTrue(calls.isEmpty)
    }

    func testPendingCompletionSurvivesRestartWithoutAutoCommitOrReceiveRearm() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("xlog-fldigi-recovery-\(UUID().uuidString)")
        defer{try? FileManager.default.removeItem(at:root)}
        let path=root.appendingPathComponent("fldigi.json"),lease=destination()
        let first=LiveFldigiBridge(configurationURL:path,externalIOAllowed:{true},receiverFactory:{_,_ in FakeFldigiReceiver()},rpc:FakeFldigiRPC())
        let importer:@Sendable (ADIFRecord,WSJTXContestDestination) async throws -> Bool={_,_ in false}
        _ = try await first.handle(method:"fldigi_configure",params:["configuration":["receive_enabled":true,"transmit_enabled":false]],receiveDestination:lease,transmitDestination:nil,contestImporter:importer)
        _ = try await first.handle(method:"fldigi_start",params:[:],receiveDestination:lease,transmitDestination:nil,contestImporter:importer)
        await first.ingest(Data("<CALL:5>K1ABC<MODE:4>RTTY<QSO_DATE:8>20261027<TIME_ON:6>120000<FREQ:6>14.080<EOR>".utf8))
        await first.stopForShutdown()
        let second=LiveFldigiBridge(configurationURL:path,externalIOAllowed:{true},receiverFactory:{_,_ in FakeFldigiReceiver()},rpc:FakeFldigiRPC())
        let snapshot=try await second.handle(method:"fldigi_snapshot",params:[:],receiveDestination:lease,transmitDestination:nil,contestImporter:importer)
        XCTAssertEqual(snapshot["receive_running"] as? Bool,false);XCTAssertEqual(snapshot["imported_count"] as? Int,0)
        XCTAssertEqual((snapshot["completed"] as? [[String:Any]])?.count,1)
        let row=(snapshot["completed"] as! [[String:Any]])[0]
        await XCTAssertThrowsErrorAsync(try await second.handle(method:"fldigi_accept_completed",params:["id":row["id"]!,"sessionID":lease.sessionID,"workspaceGeneration":lease.workspaceGeneration,"laneID":lease.laneID,"bindingVersion":lease.bindingVersion],receiveDestination:lease,transmitDestination:nil,contestImporter:importer))
    }

    func testMalformedCompletedRecoveryStaysRawAndBlocksOverwrite() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("xlog-fldigi-bad-recovery-\(UUID().uuidString)")
        defer{try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:false)
        let path=root.appendingPathComponent("fldigi.json"),recovery=path.appendingPathExtension("completed.json"),raw=Data("{unreadable retained evidence".utf8),lease=destination()
        try raw.write(to:recovery)
        let bridge=LiveFldigiBridge(configurationURL:path,externalIOAllowed:{true},receiverFactory:{_,_ in FakeFldigiReceiver()},rpc:FakeFldigiRPC())
        _ = try await bridge.handle(method:"fldigi_configure",params:["configuration":["receive_enabled":true,"transmit_enabled":false]],receiveDestination:lease,transmitDestination:nil,contestImporter:{_,_ in false})
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method:"fldigi_start",params:[:],receiveDestination:lease,transmitDestination:nil,contestImporter:{_,_ in false}))
        let snapshot=try await bridge.handle(method:"fldigi_snapshot",params:[:],receiveDestination:lease,transmitDestination:nil,contestImporter:nil)
        XCTAssertTrue(snapshot["recovery_error"] is String);XCTAssertEqual(try Data(contentsOf:recovery),raw)
    }

    func testTransmitCallsMainTXThenAddsOriginalFormattedText() async throws {
        let rpc = FakeFldigiRPC(), lease = destination()
        let bridge = LiveFldigiBridge(configurationURL: FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-\(UUID().uuidString).json"),
            externalIOAllowed: { true }, receiverFactory: { _, _ in FakeFldigiReceiver() }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration":["receive_enabled":false,"transmit_enabled":true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        _ = try await bridge.handle(method: "fldigi_send", params: ["actions":[action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.tx", "text.add_tx"])
        XCTAssertEqual(calls[1].1, "\nCQ\nTEST^r")
    }

    func testFailureAndStopPreventTextSendAndStaleContextIsRejected() async throws {
        let lease = destination(), rpc = FakeFldigiRPC(); await rpc.setFailureMethodForTesting("main.tx")
        let bridge = LiveFldigiBridge(configurationURL: FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-\(UUID().uuidString).json"),
            externalIOAllowed: { true }, receiverFactory: { _, _ in FakeFldigiReceiver() }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration":["receive_enabled":false,"transmit_enabled":true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method: "fldigi_send", params: ["actions":[action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil))
        let failedCalls = await rpc.recorded()
        XCTAssertEqual(failedCalls.map(\.0), ["main.tx", "main.rx"])
        await rpc.setFailureMethodForTesting(nil); await rpc.setGateForTesting(true)
        let task = Task { try await bridge.handle(method: "fldigi_send", params: ["actions":[self.action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil) }
        while (await rpc.recorded()).count < 3 { await Task.yield() }
        _ = try await bridge.handle(method: "fldigi_stop", params: [:], receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await rpc.release()
        do { _ = try await task.value; XCTFail("Stop must retire pending output") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "stale_context") }
        let stoppedCalls = await rpc.recorded()
        XCTAssertEqual(stoppedCalls.filter { $0.0 == "text.add_tx" }.count, 0)
        XCTAssertGreaterThanOrEqual(stoppedCalls.filter { $0.0 == "main.rx" }.count, 2)
    }

    func testContestSwitchAfterTXReturnsToReceiveWithoutSendingText() async throws {
        let lease = destination(), replacement = destination(), rpc = FakeFldigiRPC()
        let bridge = LiveFldigiBridge(configurationURL: FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-\(UUID().uuidString).json"),
            externalIOAllowed: { true }, receiverFactory: { _, _ in FakeFldigiReceiver() }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration":["receive_enabled":false,"transmit_enabled":true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method: "fldigi_send", params: ["actions":[action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil,
            transmitDestinationProvider: { replacement }))
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.tx", "main.rx"])
    }

    func testDisablingTransmitRetiresPendingOutputAndReturnsToReceive() async throws {
        let lease = destination(), rpc = FakeFldigiRPC()
        let bridge = LiveFldigiBridge(configurationURL: FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-\(UUID().uuidString).json"),
            externalIOAllowed: { true }, receiverFactory: { _, _ in FakeFldigiReceiver() }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration":["receive_enabled":false,"transmit_enabled":true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await rpc.setGateForTesting(true)
        let task = Task { try await bridge.handle(method: "fldigi_send", params: ["actions":[self.action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil) }
        while (await rpc.recorded()).isEmpty { await Task.yield() }
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration":["receive_enabled":false,"transmit_enabled":false]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await rpc.release()
        do { _ = try await task.value; XCTFail("Disabling transmit must retire pending output") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "stale_context") }
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.filter { $0.0 == "text.add_tx" }.count, 0)
        XCTAssertGreaterThanOrEqual(calls.filter { $0.0 == "main.rx" }.count, 2)
    }

    func testContestingTestNeverStartsReceiveOrSendsXMLRPC() async throws {
        let lease = destination(), rpc = FakeFldigiRPC(), receiver = FakeFldigiReceiver()
        let bridge = LiveFldigiBridge(configurationURL: FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-\(UUID().uuidString).json"),
            externalIOAllowed: { false }, receiverFactory: { _, _ in receiver }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration":["receive_enabled":true,"transmit_enabled":true]],
            receiveDestination: lease, transmitDestination: lease, contestImporter: { _, _ in false })
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method: "fldigi_start", params: [:],
            receiveDestination: lease, transmitDestination: lease, contestImporter: { _, _ in false }))
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method: "fldigi_send", params: ["actions":[action(lease)]],
            receiveDestination: lease, transmitDestination: lease, contestImporter: { _, _ in false }))
        XCTAssertNil(receiver.started)
        let calls = await rpc.recorded()
        XCTAssertTrue(calls.isEmpty)
    }
}

private extension FakeFldigiRPC {
    func setFailureMethodForTesting(_ value: String?) { failureMethod = value }
    func setGateForTesting(_ value: Bool) { gateMainTX = value }
    func setTextGateForTesting() { gateText = true }
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T,
                                          file: StaticString = #filePath, line: UInt = #line) async {
    do { _ = try await expression(); XCTFail("Expected error", file: file, line: line) } catch {}
}
#endif
