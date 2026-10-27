#if os(macOS)
import XCTest
import XLogCore
@testable import XLogPrototypeSupport

private final class FakeWSJTXReceiver: WSJTXDatagramReceiving, @unchecked Sendable {
    var onDatagram: (@Sendable (Data, String) -> Void)?
    private(set) var started: (String, UInt16)?
    private(set) var stopCount = 0
    var failure: Error?

    func start(address: String, port: UInt16) throws {
        if let failure { throw failure }
        started = (address, port)
    }
    func stop() { stopCount += 1 }
}

private final class ImportCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func nextResult() -> (Int, Int) {
        lock.withLock {
            value += 1
            return value == 1 ? (1, 0) : (0, 1)
        }
    }
}

private final class ContestDestinationState: @unchecked Sendable {
    private let lock = NSLock()
    private var destination: WSJTXContestDestination?
    private var identities = Set<String>()
    private(set) var imports = 0

    init(_ destination: WSJTXContestDestination?) { self.destination = destination }
    func current() throws -> WSJTXContestDestination {
        try lock.withLock {
            guard let destination else { throw ContestLaneError.confirmed("stale_context", "retired") }
            return destination
        }
    }
    func replace(_ value: WSJTXContestDestination?) { lock.withLock { destination = value } }
    func ingest(_ record: ADIFRecord, destination expected: WSJTXContestDestination) throws -> Bool {
        try lock.withLock {
            guard destination == expected else { throw ContestLaneError.confirmed("stale_context", "retired") }
            guard let identity = record.semanticIdentityHash else { throw ContestLaneError.confirmed("invalid_qso", "invalid") }
            let inserted = identities.insert(identity).inserted
            if inserted { imports += 1 }
            return !inserted
        }
    }
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
    private func reviewDecode(_ bridge:LiveWSJTXBridge,lease:WSJTXContestDestination,provider:@escaping @Sendable () async throws -> WSJTXContestDestination,importer:@escaping @Sendable (ADIFRecord,WSJTXContestDestination) async throws -> Bool) async throws {
        var status=datagram(type:1)
        for value in [UInt32(0),14_074_000]{append(value,to:&status)}
        for value in ["FT8","","","FT8"]{append(value,to:&status)}
        status.append(contentsOf:[0,0,0]);append(0,to:&status);append(0,to:&status)
        for value in ["OM0RX","JN88",""]{append(value,to:&status)}
        await bridge.ingest(status)
        var decode=datagram(type:2);decode.append(1);append(UInt32(UInt64(Date().timeIntervalSince1970*1000)%86_400_000),to:&decode)
        append(UInt32(bitPattern:-12),to:&decode);append(0x3fc00000,to:&decode);append(0,to:&decode);append(500,to:&decode)
        append("~",to:&decode);append("CQ VK8AA PH57",to:&decode);decode.append(contentsOf:[0,0]);await bridge.ingest(decode)
        let snapshot=try await bridge.handle(method:"wsjtx_snapshot",params:[:],route:.contestSurfaceOrdinaryLogbook,contestDestinationProvider:provider,contestImporter:importer)
        let row=try XCTUnwrap((snapshot["decodes"] as? [[String:Any]])?.first)
        let selection=try await bridge.handle(method:"wsjtx_select",params:["decodeID":row["id"]!,"sessionID":lease.sessionID,"workspaceGeneration":lease.workspaceGeneration,"laneID":lease.laneID,"bindingVersion":lease.bindingVersion],route:.contestSurfaceOrdinaryLogbook,contestDestinationProvider:provider,contestImporter:importer)
        XCTAssertEqual(selection["transmitted"] as? Bool,false);XCTAssertEqual(selection["snr"] as? Int32,-12)
    }

    func testDocumentedLoggedADIFEnvelopeIsParsedAndOtherTypesAreIgnored() throws {
        let value = try XCTUnwrap(try WSJTXMessageParser.loggedADIF(from: datagram()))
        XCTAssertEqual(value.schema, 3); XCTAssertEqual(value.instanceID, "WSJT-X")
        XCTAssertTrue(value.text.contains("<CALL:5>VK8AA"))
        XCTAssertNil(try WSJTXMessageParser.loggedADIF(from: datagram(type: 0)))
        var legacy = datagram(); legacy[7] = 1
        XCTAssertEqual(try WSJTXMessageParser.loggedADIF(from: legacy)?.schema, 1)
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
        let importedCalls = ImportCounter()
        let receiver = FakeWSJTXReceiver()
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in importedCalls.nextResult() },
            receiverFactory: { handler, _ in receiver.onDatagram = handler; return receiver })
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

    func testContestSurfaceUsesOrdinaryLogRouteForAllVisibleCommands() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-contest-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let receiver = FakeWSJTXReceiver()
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in (1, 0) },
            receiverFactory: { _, _ in receiver })

        let snapshot = try await bridge.handle(method: "wsjtx_snapshot", params: [:], route: .contestSurfaceOrdinaryLogbook)
        XCTAssertEqual(snapshot["logging_destination"] as? String, "ordinary_logbook")
        XCTAssertEqual(snapshot["request_origin"] as? String, "active_contest_surface")
        XCTAssertEqual(snapshot["contest_target_supported"] as? Bool, false)
        XCTAssertEqual(snapshot["mutation_available"] as? Bool, true)

        do {
            _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": [
                "enabled": true, "address": "239.255.0.1", "port": 2_237, "destination": "active_contest",
            ]], route: .contestSurfaceOrdinaryLogbook)
            XCTFail("An unsupported contest must reject the active destination.")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "digital_unsupported") }
        let configuration = ["enabled": true, "address": "239.255.0.1", "port": 2_237] as [String: Any]
        let configured = try await bridge.handle(method: "wsjtx_configure",
            params: ["configuration": configuration], route: .contestSurfaceOrdinaryLogbook)
        XCTAssertEqual(configured["logging_destination"] as? String, "ordinary_logbook")
        _ = try await bridge.handle(method: "wsjtx_start", params: [:], route: .contestSurfaceOrdinaryLogbook)
        XCTAssertEqual(receiver.started?.0, "239.255.0.1")
        let stopped = try await bridge.handle(method: "wsjtx_stop", params: [:], route: .contestSurfaceOrdinaryLogbook)
        XCTAssertEqual(stopped["running"] as? Bool, false)
        XCTAssertEqual(receiver.stopCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("wsjtx.json").path))
    }

    func testActiveContestRouteIsExplicitIsolatedDeduplicatedAndRetiredOnSwitch() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-contest-route-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let receiver = FakeWSJTXReceiver(), ordinary = ImportCounter()
        let lease = WSJTXContestDestination(sessionID: UUID().uuidString.lowercased(),
            workspaceGeneration: UUID().uuidString.lowercased(), pluginID: "cq_ww_rtty", sourceRevision: "source")
        let state = ContestDestinationState(lease)
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in ordinary.nextResult() },
            receiverFactory: { handler, _ in receiver.onDatagram = handler; return receiver })
        let provider: @Sendable () async throws -> WSJTXContestDestination = { try state.current() }
        let contestImporter: @Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool = {
            try state.ingest($0, destination: $1)
        }
        let configuration: [String: Any] = ["enabled": true, "address": "239.255.0.1", "port": 2_237,
                                            "destination": "active_contest"]
        let configured = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": configuration],
            route: .contestSurfaceOrdinaryLogbook, contestDestinationProvider: provider, contestImporter: contestImporter)
        XCTAssertEqual(configured["logging_destination"] as? String, "active_contest")
        XCTAssertEqual(configured["contest_target_supported"] as? Bool, true)
        let persisted = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("wsjtx.json"))) as? [String: Any]
        XCTAssertEqual(persisted?["destination"] as? String, "active_contest")
        XCTAssertEqual(persisted?["enabled"] as? Bool, true)
        let restoredReceiver = FakeWSJTXReceiver()
        let restored = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in ordinary.nextResult() },
            receiverFactory: { _, _ in restoredReceiver })
        await restored.startIfEnabled()
        var restoredSnapshot = try await restored.handle(method: "wsjtx_snapshot", params: [:],
            route: .contestSurfaceOrdinaryLogbook, contestDestinationProvider: provider, contestImporter: contestImporter)
        XCTAssertEqual(restoredSnapshot["logging_destination"] as? String, "active_contest")
        XCTAssertEqual((restoredSnapshot["configuration"] as? [String: Any])?["enabled"] as? Bool, true)
        XCTAssertEqual(restoredSnapshot["running"] as? Bool, false,
            "A persisted contest destination must not restart through the ordinary-log startup route.")
        restoredSnapshot = try await restored.handle(method: "wsjtx_start", params: [:],
            route: .contestSurfaceOrdinaryLogbook, contestDestinationProvider: provider, contestImporter: contestImporter)
        XCTAssertEqual(restoredSnapshot["running"] as? Bool, true)
        XCTAssertEqual(restoredReceiver.started?.0, "239.255.0.1")
        _ = try await bridge.handle(method: "wsjtx_start", params: [:], route: .contestSurfaceOrdinaryLogbook,
            contestDestinationProvider: provider, contestImporter: contestImporter)
        let unrelatedWindowSnapshot = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual(unrelatedWindowSnapshot["logging_destination"] as? String, "active_contest",
            "An unscoped poll from another detached window must not retire the trusted contest destination.")
        XCTAssertEqual(unrelatedWindowSnapshot["running"] as? Bool, true)
        await bridge.ingest(datagram())
        XCTAssertEqual(state.imports,0,"Unselected engine completion cannot enter the contest")
        try await reviewDecode(bridge,lease:lease,provider:provider,importer:contestImporter)
        await bridge.ingest(datagram(id:"other-engine"))
        XCTAssertEqual(state.imports,0,"Competing instance cannot borrow the selected engine destination")
        await bridge.ingest(datagram()); await bridge.ingest(datagram())
        let active = try await bridge.handle(method: "wsjtx_snapshot", params: [:], route: .contestSurfaceOrdinaryLogbook,
            contestDestinationProvider: provider, contestImporter: contestImporter)
        XCTAssertEqual(state.imports, 1)
        XCTAssertEqual(active["imported_count"] as? Int, 1)
        XCTAssertEqual(active["duplicate_count"] as? Int, 1)

        state.replace(WSJTXContestDestination(sessionID: UUID().uuidString.lowercased(),
            workspaceGeneration: lease.workspaceGeneration, pluginID: lease.pluginID, sourceRevision: lease.sourceRevision))
        let retired = try await bridge.handle(method: "wsjtx_snapshot", params: [:], route: .contestSurfaceOrdinaryLogbook,
            contestDestinationProvider: provider, contestImporter: contestImporter)
        XCTAssertEqual(retired["logging_destination"] as? String, "ordinary_logbook")
        XCTAssertEqual(retired["running"] as? Bool, false)
        await bridge.ingest(datagram(adif: "<CALL:5>VK8ZZ<QSO_DATE:8>20261014<TIME_ON:6>120000<BAND:3>20M<MODE:3>FT8<EOR>"))
        XCTAssertEqual(state.imports, 1)
        XCTAssertEqual(ordinary.nextResult().0, 1, "ordinary importer must remain untouched by contest traffic")
    }

    func testNestedWorkspaceSuspensionPreventsLateStartsAndRestartsOnlyAfterFinalResume() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let receiver = FakeWSJTXReceiver()
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in (0, 1) }, receiverFactory: { _, _ in receiver })
        let initial = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        var configuration = initial["configuration"] as! [String: Any]
        configuration["enabled"] = true
        _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": configuration])
        _ = try await bridge.handle(method: "wsjtx_start", params: [:])
        await bridge.suspendForWorkspaceChange(); await bridge.suspendForWorkspaceChange()
        do {
            _ = try await bridge.handle(method: "wsjtx_start", params: [:])
            XCTFail("A suspended workspace must not restart the listener")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "workspace_transition") }
        await bridge.finishWorkspaceChange()
        let stillSuspended = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual(stillSuspended["running"] as? Bool, false)
        await bridge.finishWorkspaceChange()
        let resumed = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual(resumed["running"] as? Bool, true)
    }

    func testTerminalShutdownCannotBeReopenedByLateWorkspaceCompletion() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let receiver = FakeWSJTXReceiver()
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in (0, 1) }, receiverFactory: { _, _ in receiver })
        let initial = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        var configuration = initial["configuration"] as! [String: Any]
        configuration["enabled"] = true
        _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": configuration])
        await bridge.suspendForWorkspaceChange(); await bridge.stopForShutdown(); await bridge.finishWorkspaceChange()
        await bridge.startIfEnabled()
        let stopped = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual(stopped["running"] as? Bool, false)
        do {
            _ = try await bridge.handle(method: "wsjtx_start", params: [:])
            XCTFail("A terminal bridge must not restart")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "worker_stopping") }
    }

    func testDatagramAfterTerminalRetirementCannotImportOrPublish() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-retire-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let importedCalls = ImportCounter()
        let receiver = FakeWSJTXReceiver()
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in importedCalls.nextResult() },
            receiverFactory: { handler, _ in receiver.onDatagram = handler; return receiver })
        let initial = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        var configuration = initial["configuration"] as! [String: Any]
        configuration["enabled"] = true
        _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": configuration])
        _ = try await bridge.handle(method: "wsjtx_start", params: [:])
        await bridge.ingest(datagram())
        await bridge.stopForShutdown()
        await bridge.ingest(datagram(adif: "<ADIF_VER:5>3.1.4<EOH><CALL:5>VK8ZZ<QSO_DATE:8>20261014<TIME_ON:6>120000<BAND:3>20M<MODE:3>FT8<EOR>"))
        let snapshot = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual(snapshot["imported_count"] as? Int, 1)
        XCTAssertEqual(snapshot["running"] as? Bool, false)
        XCTAssertEqual(receiver.stopCount, 1)
    }

    func testRealLogbookImportLeavesOneLocalContact() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-wsjtx-log-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let database = try logbook.openedDatabase()
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let text = try XCTUnwrap(try WSJTXMessageParser.loggedADIF(from: datagram())?.text)
        XCTAssertEqual(try logbook.importLoggedADIF(text).imported, 1)
        XCTAssertEqual(try logbook.importLoggedADIF(text).skipped, 1)
        XCTAssertEqual(try database.onlineLogEnrollmentStatus(service: .qrz).pendingNewContacts, 1)
        XCTAssertEqual(try database.onlineLogCandidateIDs(service: .qrz).count, 1)
        let status = try logbook.handle(method: "workspace_status", params: [:])
        XCTAssertEqual(status["qso_count"] as? Int, 1)
    }
}
#endif
