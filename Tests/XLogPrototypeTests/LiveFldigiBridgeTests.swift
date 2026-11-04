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

    func testExplicitStopAttemptsRXAndKeepsStorageAndReleaseFailuresSeparate() async throws {
        for rxFails in [false, true] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-stop-storage-\(UUID())")
            defer { try? FileManager.default.removeItem(at: root) }
            let directory = root.appendingPathComponent("settings"), retained = root.appendingPathComponent("retained-settings")
            let rpc = FakeFldigiRPC(), lease = destination()
            let bridge = LiveFldigiBridge(configurationURL: directory.appendingPathComponent("fldigi.json"),
                externalIOAllowed: { true }, rpc: rpc)
            _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration": ["receive_enabled": false, "transmit_enabled": true]],
                receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
            var outgoing = action(lease); outgoing["rxAfter"] = false
            _ = try await bridge.handle(method: "fldigi_send", params: ["actions": [outgoing]],
                receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
            try FileManager.default.moveItem(at: directory, to: retained)
            try Data("A regular file blocks the settings directory".utf8).write(to: directory)
            await rpc.setFailureMethodForTesting(rxFails ? "main.rx" : nil)

            var stopped: [String: Any]?
            do {
                stopped = try await bridge.handle(method: "fldigi_stop", params: [:],
                    receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
            } catch { XCTFail("Storage failure must return separate Stop evidence after attempting RX: \(error)") }
            let calls = await rpc.recorded()
            XCTAssertEqual(calls.map(\.0), ["main.tx", "text.add_tx", "main.rx"])
            let snapshot = try await bridge.handle(method: "fldigi_snapshot", params: [:],
                receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
            XCTAssertEqual((snapshot["configuration"] as? [String: Bool])?["transmit_enabled"], false)
            XCTAssertFalse((snapshot["configuration_error"] as? String ?? "").isEmpty)
            XCTAssertEqual(snapshot["transmit_release_required"] as? Bool, rxFails)
            XCTAssertEqual(snapshot["transmit_release_uncertain"] as? Bool, rxFails)
            XCTAssertNotNil(stopped)
            if rxFails { XCTAssertTrue((snapshot["status"] as? String ?? "").contains("unconfirmed")) }
            do {
                _ = try await bridge.handle(method: "fldigi_send", params: ["actions": [outgoing]],
                    receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
                XCTFail("Stop must revoke sending in memory even when persistence fails")
            } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "fldigi_transmit_disabled") }

            try FileManager.default.removeItem(at: directory)
            try FileManager.default.moveItem(at: retained, to: directory)
            await rpc.setFailureMethodForTesting(nil)
            let retried = try await bridge.handle(method: "fldigi_stop", params: [:],
                receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
            XCTAssertEqual(retried["transmit_release_required"] as? Bool, false)
            XCTAssertEqual(retried["transmit_release_uncertain"] as? Bool, false)
            XCTAssertTrue(retried["configuration_error"] is NSNull)
            let finalCalls = await rpc.recorded()
            XCTAssertEqual(finalCalls.map(\.0), ["main.tx", "text.add_tx", "main.rx", "main.rx"])
        }
    }

    func testExplicitStopDoesNotReadDamagedConfigurationBeforeEmergencyRX() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-stop-read-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let path = root.appendingPathComponent("fldigi.json")
        try Data("not JSON".utf8).write(to: path)
        let rpc = FakeFldigiRPC(), bridge = LiveFldigiBridge(configurationURL: path, externalIOAllowed: { true }, rpc: rpc)
        var reply: [String: Any]?
        do { reply = try await bridge.handle(method: "fldigi_stop", params: [:], receiveDestination: nil, transmitDestination: nil, contestImporter: nil) }
        catch { XCTFail("Stop must not require a readable configuration: \(error)") }
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.rx"])
        XCTAssertEqual((reply?["configuration"] as? [String: Bool])?["transmit_enabled"], false)
        XCTAssertEqual(reply?["transmit_release_uncertain"] as? Bool, false)
    }

    func testStorageFailureCannotBypassStopProfileDenial() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-stop-denied-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let obstruction = root.appendingPathComponent("settings")
        try Data("not a directory".utf8).write(to: obstruction)
        let rpc = FakeFldigiRPC(), bridge = LiveFldigiBridge(configurationURL: obstruction.appendingPathComponent("fldigi.json"),
            externalIOAllowed: { false }, rpc: rpc)
        var reply: [String: Any]?
        do { reply = try await bridge.handle(method: "fldigi_stop", params: [:], receiveDestination: nil, transmitDestination: nil, contestImporter: nil) }
        catch { XCTFail("Local Stop evidence must survive a persistence error: \(error)") }
        let calls = await rpc.recorded()
        XCTAssertTrue(calls.isEmpty)
        XCTAssertFalse((reply?["configuration_error"] as? String ?? "").isEmpty)
        XCTAssertEqual((reply?["configuration"] as? [String: Bool])?["transmit_enabled"], false)
    }

    func testStopStorageFailurePreservesPendingSendFinalRelease() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-stop-pending-storage-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("settings"), retained = root.appendingPathComponent("retained-settings")
        let rpc = FakeFldigiRPC(), lease = destination()
        let bridge = LiveFldigiBridge(configurationURL: directory.appendingPathComponent("fldigi.json"), externalIOAllowed: { true }, rpc: rpc)
        _ = try await bridge.handle(method: "fldigi_configure", params: ["configuration": ["receive_enabled": false, "transmit_enabled": true]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        await rpc.setGateForTesting(true)
        let pending = Task { try await bridge.handle(method: "fldigi_send", params: ["actions": [self.action(lease)]],
            receiveDestination: nil, transmitDestination: lease, contestImporter: nil) }
        for _ in 0..<200 {
            if !(await rpc.recorded()).isEmpty { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        try FileManager.default.moveItem(at: directory, to: retained)
        try Data("not a directory".utf8).write(to: directory)
        var stopped: [String: Any]?
        do { stopped = try await bridge.handle(method: "fldigi_stop", params: [:], receiveDestination: nil, transmitDestination: lease, contestImporter: nil) }
        catch { XCTFail("Stop must attempt RX before returning storage failure evidence: \(error)") }
        let beforeRelease = await rpc.recorded()
        XCTAssertEqual(beforeRelease.map(\.0), ["main.tx", "main.rx"])
        XCTAssertEqual(stopped?["transmit_release_required"] as? Bool, true)
        await rpc.release()
        do { _ = try await pending.value; XCTFail("Retired pending send continued") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "stale_context") }
        let snapshot = try await bridge.handle(method: "fldigi_snapshot", params: [:], receiveDestination: nil, transmitDestination: lease, contestImporter: nil)
        XCTAssertEqual(snapshot["transmit_release_required"] as? Bool, false)
        XCTAssertEqual(snapshot["transmit_release_uncertain"] as? Bool, false)
        XCTAssertFalse((snapshot["configuration_error"] as? String ?? "").isEmpty)
        let calls = await rpc.recorded()
        XCTAssertEqual(calls.map(\.0), ["main.tx", "main.rx", "main.rx"])
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
    func testQTCCapturedBeforeHostWaitCannotUseAReenabledFldigiLease() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-qtc-generation-\(UUID())")
        defer {try? FileManager.default.removeItem(at:root)}
        let rpc=FakeFldigiRPC(),lease=destination(),bridge=LiveFldigiBridge(configurationURL:root.appendingPathComponent("fldigi.json"),externalIOAllowed:{true},rpc:rpc)
        let configure:[String:Any]=["configuration":["receive_enabled":false,"transmit_enabled":true]]
        let original=try await bridge.handle(method:"fldigi_configure",params:configure,receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let generation=try XCTUnwrap(original["transmit_generation"] as? String)
        var prepared=action(lease,payload:"1459 DL1ABC 019")
        prepared["qtc"]=["schema":1,"batchID":UUID().uuidString.lowercased(),"index":0,"field":"all","bridgeGeneration":generation]
        // Represents a prepared QTC held while its durable host operation waits.
        _ = try await bridge.handle(method:"fldigi_stop",params:[:],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let enabled=try await bridge.handle(method:"fldigi_configure",params:configure,receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let replacement=try XCTUnwrap(enabled["transmit_generation"] as? String)
        XCTAssertNotEqual(generation,replacement)
        let requests:[[String:Any]]=[["actions":[prepared],"expectedGeneration":generation],
                                   ["actions":[prepared],"expectedGeneration":replacement], ["actions":[prepared]]]
        for params in requests {
            do {_ = try await bridge.handle(method:"fldigi_send",params:params,receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
                XCTFail("Old QTC preparation acquired a replacement output lease")}
            catch let error as WorkerFailure {XCTAssertEqual(error.code,"stale_context")}
        }
        let before=await rpc.recorded();XCTAssertEqual(before.map(\.0),["main.rx"])
        var fresh=action(lease,payload:"1459 DL1ABC 019")
        fresh["qtc"]=["schema":1,"batchID":UUID().uuidString.lowercased(),"index":0,"field":"all","bridgeGeneration":replacement]
        _ = try await bridge.handle(method:"fldigi_send",params:["actions":[fresh],"expectedGeneration":replacement],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let after=await rpc.recorded();XCTAssertEqual(after.map(\.0),["main.rx","main.tx","text.add_tx"])
    }
    func testAnyStaleGenerationInTheBundleRejectsAllActionsBeforeRPC() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-qtc-bundle-\(UUID())")
        defer {try? FileManager.default.removeItem(at:root)}
        let rpc=FakeFldigiRPC(),lease=destination(),bridge=LiveFldigiBridge(configurationURL:root.appendingPathComponent("fldigi.json"),externalIOAllowed:{true},rpc:rpc)
        let snapshot=try await bridge.handle(method:"fldigi_configure",params:["configuration":["receive_enabled":false,"transmit_enabled":true]],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let generation=try XCTUnwrap(snapshot["transmit_generation"] as? String)
        var stale=action(lease);stale["qtc"]=["schema":1,"bridgeGeneration":UUID().uuidString.lowercased()]
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method:"fldigi_send",params:["actions":[action(lease),stale],"expectedGeneration":generation],receiveDestination:nil,transmitDestination:lease,contestImporter:nil))
        await XCTAssertThrowsErrorAsync(try await bridge.handle(method:"fldigi_send",params:["actions":[action(lease)],"expectedGeneration":UUID().uuidString.lowercased()],receiveDestination:nil,transmitDestination:lease,contestImporter:nil))
        let calls=await rpc.recorded();XCTAssertTrue(calls.isEmpty)
    }
    func testScopedQTCStopRetriesOriginalFailedRXButCannotControlAReplacementLease() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("fldigi-qtc-scoped-stop-\(UUID())")
        defer {try? FileManager.default.removeItem(at:root)}
        let rpc=FakeFldigiRPC(),lease=destination(),bridge=LiveFldigiBridge(configurationURL:root.appendingPathComponent("fldigi.json"),externalIOAllowed:{true},rpc:rpc)
        let configure:[String:Any]=["configuration":["receive_enabled":false,"transmit_enabled":true]]
        let first=try await bridge.handle(method:"fldigi_configure",params:configure,receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let original=try XCTUnwrap(first["transmit_generation"] as? String)
        var outgoing=action(lease);outgoing["qtc"]=["schema":1,"bridgeGeneration":original]
        _ = try await bridge.handle(method:"fldigi_send",params:["actions":[outgoing],"expectedGeneration":original],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        await rpc.setFailureMethodForTesting("main.rx")
        let failed=try await bridge.handle(method:"fldigi_stop",params:["expectedGeneration":original],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        XCTAssertNotEqual(failed["transmit_generation"] as? String,original)
        XCTAssertEqual(failed["transmit_owner_generation"] as? String,original)
        XCTAssertEqual(failed["transmit_release_required"] as? Bool,true);XCTAssertEqual(failed["transmit_release_uncertain"] as? Bool,true)
        await rpc.setFailureMethodForTesting(nil)
        let released=try await bridge.handle(method:"fldigi_stop",params:["expectedGeneration":original],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        XCTAssertEqual(released["transmit_release_required"] as? Bool,false);XCTAssertEqual(released["transmit_release_uncertain"] as? Bool,false)
        XCTAssertTrue(released["transmit_owner_generation"] is NSNull)
        let enabled=try await bridge.handle(method:"fldigi_configure",params:configure,receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let replacement=try XCTUnwrap(enabled["transmit_generation"] as? String)
        var fresh=action(lease);fresh["qtc"]=["schema":1,"bridgeGeneration":replacement]
        _ = try await bridge.handle(method:"fldigi_send",params:["actions":[fresh],"expectedGeneration":replacement],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let before=await rpc.recorded()
        do {_ = try await bridge.handle(method:"fldigi_stop",params:["expectedGeneration":original],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
            XCTFail("Old scoped Stop reached the replacement engine lease")}
        catch let error as WorkerFailure {XCTAssertEqual(error.code,"stale_context")}
        let unchanged=await rpc.recorded();XCTAssertEqual(unchanged.map(\.0),before.map(\.0))
        _ = try await bridge.handle(method:"fldigi_stop",params:[:],receiveDestination:nil,transmitDestination:lease,contestImporter:nil)
        let final=await rpc.recorded();XCTAssertEqual(final.map(\.0),["main.tx","text.add_tx","main.rx","main.rx","main.tx","text.add_tx","main.rx"])
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
