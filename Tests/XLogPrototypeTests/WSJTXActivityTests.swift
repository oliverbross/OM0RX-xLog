#if os(macOS)
import XCTest
@testable import XLogPrototypeSupport

private final class ActivityReceiver: WSJTXDatagramReceiving, @unchecked Sendable {
    func start(address: String, port: UInt16) throws {}
    func stop() {}
}

final class WSJTXActivityTests: XCTestCase {
    private let now: UInt64 = 1_792_022_400_000
    private func number(_ value: UInt64, _ size: Int, _ data: inout Data) {
        for index in (0..<size).reversed() { data.append(UInt8(truncatingIfNeeded: value >> (index * 8))) }
    }
    private func text(_ value: String, _ data: inout Data) {
        number(UInt64(value.utf8.count), 4, &data); data.append(contentsOf: value.utf8)
    }
    private func packet(_ type: UInt64, id: String = "WSJT-X", schema: UInt64 = 2) -> Data {
        var data = Data(); number(0xadbccbda, 4, &data); number(schema, 4, &data); number(type, 4, &data); text(id, &data); return data
    }
    private func status(id: String = "WSJT-X", frequency: UInt64 = 14_074_000, mode: String = "FT8", schema: UInt64 = 2) -> Data {
        var data = packet(1, id: id, schema: schema); number(frequency, 8, &data); text(mode, &data)
        for value in ["", "", mode] { text(value, &data) }
        data.append(contentsOf: [0, 0, 0]); number(0, 4, &data); number(0, 4, &data)
        for value in ["OM0RX", "JN98", ""] { text(value, &data) }; return data
    }
    private func decode(id: String = "WSJT-X", message: String = "CQ W1AW FN31", at: UInt64? = nil,
                        new: Bool = true, low: Bool = false, offAir: Bool = false, schema: UInt64 = 2) -> Data {
        var data = packet(2, id: id, schema: schema); data.append(new ? 1 : 0); number((at ?? now) % 86_400_000, 4, &data)
        number(0, 4, &data); number(Double(0.1).bitPattern, 8, &data); number(500, 4, &data)
        text("~", &data); text(message, &data); data.append(low ? 1 : 0); data.append(offAir ? 1 : 0); return data
    }
    private func receive(_ data: Data, into activity: inout WSJTXActivity, sender: String = "127.0.0.1:5000", at: UInt64? = nil) throws {
        activity.receive(try XCTUnwrap(WSJTXActivityMessage.parse(data)), sender: sender, now: at ?? now)
    }
    private func spots(_ activity: inout WSJTXActivity, at: UInt64? = nil) -> [[String: Any]] {
        activity.snapshot(now: at ?? now, available: true)["spots"] as! [[String: Any]]
    }

    func testSchemasTwoAndThreeSupportReceiveOnlyActivityWithoutNegotiation() throws {
        for schema in [UInt64(2), 3] {
            var activity = WSJTXActivity()
            var heartbeat = packet(0, schema: schema)
            number(3, 4, &heartbeat); text("3.0", &heartbeat); text("r1", &heartbeat)
            try receive(heartbeat, into: &activity)
            try receive(status(schema: schema), into: &activity)
            try receive(decode(schema: schema), into: &activity)
            let cq = try XCTUnwrap(spots(&activity).first)
            XCTAssertEqual(cq["callsign"] as? String, "W1AW")
            XCTAssertEqual(cq["frequencyKHz"] as? Double, 14_074.5)
            XCTAssertEqual(cq["mode"] as? String, "FT8")
            try receive(packet(3, schema: schema), into: &activity)
            XCTAssertTrue(spots(&activity).isEmpty)
            try receive(packet(6, schema: schema), into: &activity)
            XCTAssertEqual(activity.snapshot(now: now, available: true)["session_count"] as? Int, 0)
            for type in [UInt64(4), 5, 7, 8, 9, 10, 11, 12, 13, 14, 15] {
                XCTAssertNil(try WSJTXActivityMessage.parse(packet(type, schema: schema)))
            }
        }
    }

    func testTwoInstancesAndEndpointsRemainIndependentAndCloseCannotRemoveAnotherSender() throws {
        var activity = WSJTXActivity()
        try receive(status(), into: &activity)
        try receive(status(id: "second", frequency: 7_074_000), into: &activity)
        try receive(decode(), into: &activity); try receive(decode(id: "second"), into: &activity)
        XCTAssertEqual(spots(&activity).count, 2)
        XCTAssertEqual(Set(spots(&activity).compactMap { $0["band"] as? String }), ["20m", "40m"])
        try receive(status(), into: &activity, sender: "127.0.0.1:5001")
        try receive(decode(), into: &activity, sender: "127.0.0.1:5001")
        XCTAssertEqual(spots(&activity).count, 3)
        try receive(packet(6), into: &activity)
        XCTAssertEqual(spots(&activity).count, 2)
        try receive(status(), into: &activity); try receive(decode(), into: &activity)
        XCTAssertEqual(spots(&activity).count, 2, "Close/reopen must not replay an already seen period")
    }

    func testOnlyFreshLiveConfidentCQEntersActivityAndNewPeriodsHaveStableSeparateIdentities() throws {
        var activity = WSJTXActivity(); try receive(status(), into: &activity)
        for packet in [decode(message: "W1AW OM0RX -10"), decode(message: "CQ RR73"), decode(new: false), decode(low: true), decode(offAir: true), decode(at: now - 61_000)] {
            try receive(packet, into: &activity)
        }
        XCTAssertTrue(spots(&activity).isEmpty)
        try receive(decode(), into: &activity); let first = spots(&activity).first!["id"] as! String
        try receive(decode(), into: &activity)
        XCTAssertEqual(spots(&activity).count, 1); XCTAssertEqual(spots(&activity).first!["id"] as? String, first)
        try receive(decode(message: "CQ DX VK8AA PH57", at: now + 15_000), into: &activity, at: now + 15_000)
        XCTAssertEqual(spots(&activity, at: now + 15_000).count, 2)
        XCTAssertEqual(spots(&activity, at: now + 61_000).count, 1)
        XCTAssertTrue(spots(&activity, at: now + 76_000).isEmpty)
    }

    func testMissingStaleOrUnsupportedStatusNeverReusesAnotherModesFrequency() throws {
        var activity = WSJTXActivity(); try receive(decode(), into: &activity)
        XCTAssertTrue(spots(&activity).isEmpty)
        try receive(status(), into: &activity)
        try receive(status(mode: "WSPR"), into: &activity)
        try receive(decode(), into: &activity); XCTAssertTrue(spots(&activity).isEmpty)
        try receive(status(), into: &activity)
        try receive(decode(at: now + 121_000), into: &activity, at: now + 121_000)
        XCTAssertTrue(spots(&activity, at: now + 121_000).isEmpty)
    }

    func testParserRejectsMalformedOversizedAndIncompatibleSchemas() throws {
        for bytes in [Data(), Data(status().dropLast()), Data(decode().dropLast()), packet(0), status(schema: 0), status(schema: 1), packet(6, schema: 4), Data(repeating: 0, count: 20_001), decode(message: "CQ W1AW\nFN31")] {
            XCTAssertThrowsError(try WSJTXActivityMessage.parse(bytes))
        }
        var heartbeat = packet(0); number(3, 4, &heartbeat); text("3.0", &heartbeat); text("r1", &heartbeat)
        XCTAssertNotNil(try WSJTXActivityMessage.parse(heartbeat))
        XCTAssertNil(try WSJTXActivityMessage.parse(packet(4)), "Inbound Reply is never interpreted")
        var invalidBool = decode(); invalidBool[22] = 2
        XCTAssertThrowsError(try WSJTXActivityMessage.parse(invalidBool))
        var oversized = status(); oversized.append(Data(repeating: 0, count: 16_384))
        XCTAssertThrowsError(try WSJTXActivityMessage.parse(oversized))
        for length in 0..<status().count {
            XCTAssertThrowsError(try WSJTXActivityMessage.parse(Data(status().prefix(length))))
        }
    }

    func testActivityIsBoundedAndResetChangesWorkspaceEpoch() throws {
        var activity = WSJTXActivity()
        for index in 0..<12 { try receive(status(id: "instance-\(index)"), into: &activity) }
        XCTAssertEqual(activity.snapshot(now: now, available: true)["session_count"] as? Int, 8)
        let old = activity.epoch; activity.reset()
        XCTAssertNotEqual(activity.epoch, old); XCTAssertTrue(spots(&activity).isEmpty)
        try receive(status(), into: &activity)
        for index in 0..<210 { try receive(decode(message: "CQ W\(index)AW FN31"), into: &activity) }
        XCTAssertEqual(spots(&activity).count, 200)
    }

    func testBridgeActivityMessagesHaveZeroImporterSideEffectsAndStoppingClearsRetainedActivity() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-activity-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in XCTFail("Activity cannot save a contact"); return (0, 0) },
            receiverFactory: { _, _ in ActivityReceiver() })
        _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": ["enabled": true, "address": "127.0.0.1", "port": 2237]])
        _ = try await bridge.handle(method: "wsjtx_start", params: [:])
        let current = UInt64(Date().timeIntervalSince1970 * 1000)
        var heartbeat = packet(0); number(3, 4, &heartbeat); text("3.0", &heartbeat); text("r1", &heartbeat)
        await bridge.ingest(heartbeat); await bridge.ingest(status()); await bridge.ingest(decode(at: current))
        await bridge.ingest(Data(status().dropLast()))
        await bridge.ingest(decode(at: current + 1))
        let snapshot = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual(snapshot["imported_count"] as? Int, 0); XCTAssertEqual(snapshot["duplicate_count"] as? Int, 0)
        XCTAssertEqual(snapshot["receive_only"] as? Bool, true)
        XCTAssertEqual(snapshot["rejected_count"] as? Int, 1)
        XCTAssertTrue(((snapshot["activity"] as? [String: Any])?["spots"] as? [Any])?.isEmpty == true)
        await bridge.ingest(packet(6))
        _ = try await bridge.handle(method: "wsjtx_stop", params: [:])
        let stopped = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        XCTAssertEqual((stopped["activity"] as? [String: Any])?["available"] as? Bool, false)
    }

    func testRetainedCQReclassifiesAfterLogbookRevisionWithoutChangingDecodeIdentity() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-activity-classification-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let logbook = LiveLogbookMethods(supportDirectory: directory, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let bridge = LiveWSJTXBridge(configurationURL: directory.appendingPathComponent("wsjtx.json"),
            workspaceAvailable: { true }, importer: { _ in (0, 0) }, classificationLogbook: logbook,
            receiverFactory: { _, _ in ActivityReceiver() })
        _ = try await bridge.handle(method: "wsjtx_configure", params: ["configuration": ["enabled": true, "address": "127.0.0.1", "port": 2237]])
        _ = try await bridge.handle(method: "wsjtx_start", params: [:])
        let current = UInt64(Date().timeIntervalSince1970 * 1000)
        await bridge.ingest(status())
        await bridge.ingest(decode(at: current))

        let first = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        let initialActivity = try XCTUnwrap(first["activity"] as? [String: Any])
        let initialSpot = try XCTUnwrap((initialActivity["spots"] as? [[String: Any]])?.first)
XCTAssertEqual(initialSpot["callStatus"] as? String, "New Callsign")
XCTAssertEqual(initialSpot["dxccStatus"] as? String, "New DXCC")
        let identity = try XCTUnwrap(initialSpot["id"] as? String)
        let initialClassificationRevision = try XCTUnwrap(initialActivity["classification_revision"] as? UInt64)

        _ = try logbook.handle(method: "logbook_import_adif", params: ["text":
            "<CALL:4>W1AW<QSO_DATE:8>20261016<TIME_ON:6>010000<BAND:3>20m<MODE:3>FT8<DXCC:3>291<LOTW_QSL_RCVD:1>Y<EOR>"])
        let refreshed = try await bridge.handle(method: "wsjtx_snapshot", params: [:])
        let refreshedActivity = try XCTUnwrap(refreshed["activity"] as? [String: Any])
        let refreshedSpot = try XCTUnwrap((refreshedActivity["spots"] as? [[String: Any]])?.first)
        XCTAssertEqual(refreshedSpot["id"] as? String, identity)
        XCTAssertEqual(refreshedSpot["callStatus"] as? String, "Confirmed")
        XCTAssertEqual(refreshedSpot["dxccStatus"] as? String, "Confirmed")
        XCTAssertGreaterThan(try XCTUnwrap(refreshedActivity["classification_revision"] as? UInt64), initialClassificationRevision)
    }
}
#endif
