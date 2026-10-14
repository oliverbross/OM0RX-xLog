#if os(macOS)
import XCTest
@testable import XLogPrototypeSupport

private final class FakeWSJTXReceiver: WSJTXDatagramReceiving, @unchecked Sendable {
    var onDatagram: (@Sendable (Data) -> Void)?
    private(set) var started: (String, UInt16)?
    private(set) var stopCount = 0
    var failure: Error?

    func start(address: String, port: UInt16) throws {
        if let failure { throw failure }
        started = (address, port)
    }
    func stop() { stopCount += 1 }
}

final class LiveWSJTXBridgeTests: XCTestCase {
    private func append(_ value: UInt32, to data: inout Data) {
        data.append(UInt8((value >> 24) & 0xff)); data.append(UInt8((value >> 16) & 0xff))
        data.append(UInt8((value >> 8) & 0xff)); data.append(UInt8(value & 0xff))
    }

    private func append(_ value: String, to data: inout Data) {
        let bytes = Data(value.utf8); append(UInt32(bytes.count), to: &data); data.append(bytes)
    }

    private func datagram(type: UInt32 = 12, id: String = "WSJT-X", adif: String = "<ADIF_VER:5>3.1.4<EOH><CALL:5>VK8AA<QSO_DATE:8>20261014<TIME_ON:6>120000<BAND:3>20M<MODE:3>FT8<EOR>") -> Data {
        var data = Data(); append(0xadbccbda, to: &data); append(3, to: &data); append(type, to: &data)
        append(id, to: &data); if type == 12 { append(adif, to: &data) }; return data
    }

    func testDocumentedLoggedADIFEnvelopeIsParsedAndOtherTypesAreIgnored() throws {
        let value = try XCTUnwrap(try WSJTXMessageParser.loggedADIF(from: datagram()))
        XCTAssertEqual(value.schema, 3); XCTAssertEqual(value.instanceID, "WSJT-X")
        XCTAssertTrue(value.text.contains("<CALL:5>VK8AA"))
        XCTAssertNil(try WSJTXMessageParser.loggedADIF(from: datagram(type: 0)))
    }

    func testMalformedOrOversizedEnvelopeFailsClosed() {
        XCTAssertThrowsError(try WSJTXMessageParser.loggedADIF(from: Data([0, 1, 2])))
        var wrong = datagram(); wrong[0] = 0
        XCTAssertThrowsError(try WSJTXMessageParser.loggedADIF(from: wrong))
        XCTAssertThrowsError(try WSJTXMessageParser.loggedADIF(from: datagram(adif: String(repeating: "A", count: 16_385))))
    }

    func testOptInListenerImportsOnceAndCountsSemanticDuplicate() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let lock = NSLock(); var importedCalls = 0
        let receiver = FakeWSJTXReceiver()
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in
                lock.withLock { importedCalls += 1; return importedCalls == 1 ? (1, 0) : (0, 1) }
            }, receiverFactory: { handler, _ in receiver.onDatagram = handler; return receiver })
        let initial = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        var configuration = initial["configuration"] as! [String: Any]
        configuration["enabled"] = true; configuration["address"] = "239.255.0.1"; configuration["port"] = 2_237
        _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": configuration])
        let started = try await bridge.handle(method: "wsjtx_start", params: [:])
        XCTAssertEqual(receiver.started?.0, "239.255.0.1"); XCTAssertEqual(receiver.started?.1, 2_237)
        XCTAssertEqual(started["running"] as? Bool, true)

        await bridge.ingest(datagram()); await bridge.ingest(datagram())
        let snapshot = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual(snapshot["imported_count"] as? Int, 1)
        XCTAssertEqual(snapshot["duplicate_count"] as? Int, 1)
        XCTAssertEqual(snapshot["rejected_count"] as? Int, 0)
        _ = try await bridge.handle(method: "wsjtx_stop", params: [:])
        XCTAssertEqual(receiver.stopCount, 1)
    }

    func testConfigurationRejectsNonLoopbackUnicastWithoutBinding() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let receiver = FakeWSJTXReceiver()
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in (0, 1) }, receiverFactory: { _, _ in receiver })
        let initial = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        var configuration = initial["configuration"] as! [String: Any]
        configuration["enabled"] = true; configuration["address"] = "192.168.1.5"
        do {
            _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": configuration])
            XCTFail("LAN unicast must not widen the listener")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        XCTAssertNil(receiver.started)
    }

    func testRealLogbookImportLeavesOneLocalContact() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-log-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let text = try XCTUnwrap(try WSJTXMessageParser.loggedADIF(from: datagram())?.text)
        XCTAssertEqual(try logbook.importLoggedADIF(text).imported, 1)
        XCTAssertEqual(try logbook.importLoggedADIF(text).skipped, 1)
        let status = try logbook.handle(method: "workspace_status", params: [:])
        XCTAssertEqual(status["qso_count"] as? Int, 1)
    }
}
#endif
