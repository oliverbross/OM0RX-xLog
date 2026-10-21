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
    private var continuation: CheckedContinuation<Void, Never>?

    func call(method: String, string: String?) async throws {
        calls.append((method, string))
        if gateMainTX && method == "main.tx" { await withCheckedContinuation { continuation = $0 } }
        if failureMethod == method { throw WorkerFailure("test_failure", "failed") }
    }
    func release() { continuation?.resume(); continuation = nil }
    func recorded() -> [(String, String?)] { calls }
}

private final class FldigiIdentityState: @unchecked Sendable {
    private let lock = NSLock()
    private var values = Set<String>()
    func duplicate(_ value: String) -> Bool { lock.withLock { !values.insert(value).inserted } }
}

final class LiveFldigiBridgeTests: XCTestCase {
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
        let snapshot = try await bridge.handle(method: "fldigi_snapshot", params: [:], receiveDestination: lease,
            transmitDestination: lease, contestImporter: importer)
        XCTAssertEqual(snapshot["imported_count"] as? Int, 1); XCTAssertEqual(snapshot["duplicate_count"] as? Int, 1)
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
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T,
                                          file: StaticString = #filePath, line: UInt = #line) async {
    do { _ = try await expression(); XCTFail("Expected error", file: file, line: line) } catch {}
}
#endif
