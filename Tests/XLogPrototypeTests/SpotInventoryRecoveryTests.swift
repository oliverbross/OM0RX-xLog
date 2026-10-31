#if os(macOS)
import Foundation
import XCTest
import SQLite3
import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class SpotInventoryRecoveryTests: XCTestCase {
    private func root() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
    private func sql(_ url: URL, _ text: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw WorkerFailure("fixture", "open") }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK else { throw WorkerFailure("fixture", String(cString: sqlite3_errmsg(db))) }
    }
    private func rows(_ url: URL, _ table: String) throws -> [Data] {
        var db: OpaquePointer?, statement: OpaquePointer?
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw WorkerFailure("fixture", "read open") }
        defer { sqlite3_close(db) }
        guard sqlite3_prepare_v2(db, "SELECT payload FROM \(table) ORDER BY key;", -1, &statement, nil) == SQLITE_OK else { throw WorkerFailure("fixture", "read prepare") }
        defer { sqlite3_finalize(statement) }
        var values: [Data] = [], step = sqlite3_step(statement)
        while step == SQLITE_ROW {
            let bytes = try XCTUnwrap(sqlite3_column_blob(statement, 0))
            values.append(Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            step = sqlite3_step(statement)
        }
        XCTAssertEqual(step, SQLITE_DONE)
        return values
    }
    private func seedLegacy(_ url: URL, count: Int = 256) throws -> [Data] {
        try sql(url, "CREATE TABLE pending_deliveries(key TEXT PRIMARY KEY,payload BLOB NOT NULL); CREATE TABLE quarantined_deliveries(key TEXT PRIMARY KEY,payload BLOB NOT NULL,identity TEXT);")
        var values: [Data] = []
        for index in 0..<count {
            let id = UUID().uuidString
            // Whitespace/key order is deliberate: migration must preserve bytes.
            let text = "{ \"id\":\"\(id)\", \"owner\":\"\(index % 2 == 0 ? "normal_logging" : "contesting")\",\"provider\":\"direct_agent\",\"callsign\":\"K1LEGACY\",\"frequencyHz\":14074000 }"
            let data = Data(text.utf8); values.append(data)
            try sql(url, "INSERT INTO pending_deliveries VALUES('\(id)',CAST('\(text)' AS BLOB));")
        }
        return values.sorted { $0.lexicographicallyPrecedes($1) }
    }
    private func encoded(_ key: String, owner: String = "normal_logging") throws -> Data {
        try JSONSerialization.data(withJSONObject: ["id": key, "owner": owner, "provider": "direct_agent", "callsign": "K1NEW", "frequencyHz": 14_074_000, "attemptedAt": Date().timeIntervalSince1970, "lifetimeSeconds": 600, "attemptCount": 1])
    }
    private func spot(source: String = "xLog xCluster") throws -> FlexSpot {
        try FlexSpot(frequencyHz: 14_074_000, callsign: "K1NEW", mode: "CW", source: source,
                     spotter: "", comment: "", timestamp: Int64(Date().timeIntervalSince1970), lifetimeSeconds: 600, priority: 3, colorHex: "#AEB5B7")
    }

    func testAtomicLegacyMigrationPreservesAllBytesAndReopensWithCapacity() throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("spots.sqlite"), original = try seedLegacy(url)
        try sql(url, "CREATE TRIGGER reject_quarantine BEFORE INSERT ON quarantined_deliveries BEGIN SELECT RAISE(ABORT,'fixture'); END;")
        XCTAssertThrowsError(try SpotInventoryStore(url: url))
        XCTAssertEqual(try rows(url, "pending_deliveries").count, 256)
        XCTAssertTrue(try rows(url, "quarantined_deliveries").isEmpty)
        try sql(url, "DROP TRIGGER reject_quarantine;")
        var store: SpotInventoryStore? = try SpotInventoryStore(url: url)
        XCTAssertTrue(try rows(url, "pending_deliveries").isEmpty)
        XCTAssertEqual(try rows(url, "quarantined_deliveries").sorted { $0.lexicographicallyPrecedes($1) }, original)
        let reserved = try XCTUnwrap(store).reserveDelivery(identity: "normal|new", leaseIdentity: "physical|new") { key, _ in try self.encoded(key) }
        XCTAssertEqual(try rows(url, "pending_deliveries").count, 1)
        store = nil
        let reopened = try SpotInventoryStore(url: url)
        XCTAssertTrue(try rows(url, "pending_deliveries").isEmpty)
        XCTAssertEqual(try reopened.pendingDeliveries().count, 257)
        XCTAssertTrue(try rows(url, "quarantined_deliveries").contains(reserved.payload))
        _ = try reopened.reserveDelivery(identity: "normal|next", leaseIdentity: "physical|next") { key, _ in try self.encoded(key) }
    }

    func testActiveCapacityIsBoundedAndPeerCannotStealLiveLease() throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("spots.sqlite")
        var first: SpotInventoryStore? = try SpotInventoryStore(url: url)
        for index in 0..<256 {
            _ = try XCTUnwrap(first).reserveDelivery(identity: "owner|\(index)", leaseIdentity: "physical|\(index)") { key, _ in try self.encoded(key) }
        }
        let peer = try SpotInventoryStore(url: url)
        XCTAssertEqual(try rows(url, "pending_deliveries").count, 256)
        XCTAssertThrowsError(try peer.reserveDelivery(identity: "other-owner", leaseIdentity: "physical|0") { key, _ in try self.encoded(key) })
        XCTAssertThrowsError(try peer.reserveDelivery(identity: "overflow", leaseIdentity: "overflow") { key, _ in try self.encoded(key) })
        XCTAssertThrowsError(try peer.claimCleanup(leaseIdentity: "physical|0"))
        first = nil
        _ = try peer.reserveDelivery(identity: "new-after-crash", leaseIdentity: "new-after-crash") { key, _ in try self.encoded(key) }
        XCTAssertEqual(try rows(url, "pending_deliveries").count, 1)
        XCTAssertEqual(try rows(url, "quarantined_deliveries").count, 256)
    }

    func testCrossProcessLeaseSurvivesLivePublisherAndRecoversAfterExit() throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("spots.sqlite"), store = try SpotInventoryStore(url: url)
        let publisher = UUID().uuidString, key = UUID().uuidString
        let process = Process(), input = Pipe(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-c", """
        import sys,sqlite3,fcntl,json,time
        path,publisher,key=sys.argv[1:]
        lease=open(path+'.publisher-'+publisher+'.lock','a+')
        fcntl.flock(lease,fcntl.LOCK_EX)
        db=sqlite3.connect(path)
        payload=json.dumps(dict(id=key,owner='normal_logging',provider='direct_agent',callsign='K1NEW',frequencyHz=14074000,attemptedAt=time.time(),lifetimeSeconds=600,attemptCount=1))
        db.execute('INSERT INTO pending_deliveries VALUES(?,?)',(key,payload.encode()))
        db.execute('INSERT INTO active_delivery_leases(identity,key,publisher,archive_identity) VALUES(?,?,?,?)',('physical',key,publisher,'normal'))
        db.commit()
        print('ready',flush=True)
        sys.stdin.read()
        """, url.path, publisher, key]
        process.standardInput = input; process.standardOutput = output; process.standardError = Pipe()
        try process.run()
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() } }
        XCTAssertEqual(output.fileHandleForReading.readData(ofLength: 6), Data("ready\n".utf8))
        XCTAssertThrowsError(try store.reserveDelivery(identity: "normal", leaseIdentity: "physical") { key, _ in try self.encoded(key) })
        XCTAssertEqual(try rows(url, "pending_deliveries").count, 1)
        XCTAssertTrue(try rows(url, "quarantined_deliveries").isEmpty)
        try input.fileHandleForWriting.close(); process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
        let retry = try store.reserveDelivery(identity: "normal", leaseIdentity: "physical") { key, _ in try self.encoded(key) }
        XCTAssertNotEqual(retry.key, key)
        XCTAssertEqual(try rows(url, "quarantined_deliveries").count, 1)
        XCTAssertEqual(try rows(url, "pending_deliveries").count, 1)
    }

    func testUnknownRetryDoesNotInheritAcknowledgementFromOlderAttempt() async throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let inventory = root.appendingPathComponent("spots.json"), url = inventory.appendingPathExtension("sqlite")
        let setup = try SpotInventoryStore(url: url); try setup.migrate { [] }
        try sql(url, "CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'fixture'); END;")
        let transport = RecoverySpotTransport(); await transport.setMode(.accepted)
        let broker = SpotForwardBroker(inventoryURL: inventory, targetedDeliver: { _, _, preferred in try await transport.add(preferred: preferred) }, targetedRemove: { _, _, _ in await transport.remove() })
        do { _ = try await broker.forward(try spot()); XCTFail("Expected receipt failure") } catch {}
        let known = try XCTUnwrap(try rows(url, "quarantined_deliveries").first)
        XCTAssertEqual((try JSONSerialization.jsonObject(with: known) as? [String: Any])?["radioID"] as? String, "radio1")
        try sql(url, "DROP TRIGGER reject_receipt;")
        await transport.setMode(.unknown)
        do { _ = try await broker.forward(try spot()); XCTFail("Expected unknown retry") } catch {}
        let preference = await transport.lastPreference; XCTAssertEqual(preference, "radio1")
        let retained = try XCTUnwrap(try rows(url, "quarantined_deliveries").first)
        XCTAssertNil((try JSONSerialization.jsonObject(with: retained) as? [String: Any])?["radioID"])
        do { _ = try await broker.withdrawNormalForwardedSpots(); XCTFail("Unknown retry cannot be cleaned as an acknowledged attempt") } catch {}
        let removals = await transport.removals; XCTAssertEqual(removals, 0)
        XCTAssertEqual(try rows(url, "quarantined_deliveries").count, 1)
    }

    func testPriorKnownUncertaintyCannotRemovePeerActiveOrFreshReceipt() async throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let inventory = root.appendingPathComponent("spots.json"), url = inventory.appendingPathExtension("sqlite")
        let setup = try SpotInventoryStore(url: url); try setup.migrate { [] }
        try sql(url, "CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'fixture'); END;")
        let firstTransport = RecoverySpotTransport(); await firstTransport.setMode(.accepted)
        let first = SpotForwardBroker(inventoryURL: inventory, targetedDeliver: { _, _, _ in try await firstTransport.add() }, targetedRemove: { _, _, _ in await firstTransport.remove() })
        do { _ = try await first.forward(try spot()); XCTFail("Expected receipt failure") } catch {}
        XCTAssertEqual(try rows(url, "quarantined_deliveries").count, 1)
        try sql(url, "DROP TRIGGER reject_receipt;")
        let cutoff = Date(), gate = RecoverySpotGate()
        let peer = SpotForwardBroker(inventoryURL: inventory, targetedDeliver: { _, _, _ in await gate.wait(); return "radio1" }, targetedRemove: { _, _, _ in })
        let publication = Task { try await peer.forward(try self.spot(), now: cutoff.addingTimeInterval(1)) }
        while !(await gate.entered) { try await Task.sleep(for: .milliseconds(5)) }
        do { _ = try await first.withdrawNormalForwardedSpots(acceptedBefore: cutoff); XCTFail("Peer's active lease must prevent cleanup") } catch {}
        XCTAssertEqual(try rows(url, "pending_deliveries").count, 1)
        await gate.release(); _ = try await publication.value
        do { _ = try await first.withdrawNormalForwardedSpots(acceptedBefore: cutoff); XCTFail("Fresh receipt must prevent old-uncertainty removal") } catch {}
        let removals = await firstTransport.removals; XCTAssertEqual(removals, 0)
        XCTAssertEqual(try rows(url, "receipts").count, 1)
        XCTAssertEqual(try rows(url, "quarantined_deliveries").count, 1)
    }

    func testFailedRetriesCoalesceButLaterACKCannotErasePastUnknown() async throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let inventory = root.appendingPathComponent("spots.json"), url = inventory.appendingPathExtension("sqlite")
        let transport = RecoverySpotTransport()
        let broker = SpotForwardBroker(inventoryURL: inventory, targetedDeliver: { _, _, _ in try await transport.add() }, targetedRemove: { _, _, _ in await transport.remove() })
        let value = try spot()
        for _ in 0..<20 { do { _ = try await broker.forward(value) ; XCTFail("Expected unknown") } catch {} }
        XCTAssertTrue(try rows(url, "pending_deliveries").isEmpty)
        let unknown = try rows(url, "quarantined_deliveries")
        XCTAssertEqual(unknown.count, 1)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(unknown.first)) as? [String: Any])
        XCTAssertEqual(payload["attemptCount"] as? Int, 20)
        XCTAssertNotNil(payload["attemptedAt"] as? Double)
        XCTAssertEqual(payload["lifetimeSeconds"] as? Int, 600)
        await transport.setMode(.notAdmitted)
        for _ in 0..<5 { do { _ = try await broker.forward(value); XCTFail("Expected no admission") } catch {} }
        XCTAssertEqual(try rows(url, "quarantined_deliveries"), unknown)
        await transport.setMode(.accepted)
        let delivered = try await broker.forward(value); XCTAssertTrue(delivered)
        XCTAssertTrue(try rows(url, "pending_deliveries").isEmpty)
        XCTAssertEqual(try rows(url, "receipts").count, 1)
        XCTAssertEqual(try rows(url, "quarantined_deliveries"), unknown)
        do { _ = try await broker.withdrawNormalForwardedSpots(); XCTFail("Past unknown must remain unresolved") } catch {}
        XCTAssertEqual(try rows(url, "quarantined_deliveries"), unknown)
    }

    func testConclusiveNoAdmissionLeavesNoNewUncertaintyAndOwnersStayDistinct() async throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let inventory = root.appendingPathComponent("spots.json"), url = inventory.appendingPathExtension("sqlite")
        let transport = RecoverySpotTransport(); await transport.setMode(.notAdmitted)
        let broker = SpotForwardBroker(inventoryURL: inventory, targetedDeliver: { _, _, _ in try await transport.add() }, targetedRemove: { _, _, _ in await transport.remove() })
        for _ in 0..<20 { do { _ = try await broker.forward(try spot()); XCTFail("Expected no admission") } catch {} }
        XCTAssertTrue(try rows(url, "pending_deliveries").isEmpty); XCTAssertTrue(try rows(url, "quarantined_deliveries").isEmpty)
        await transport.setMode(.unknown)
        for source in ["xLog xCluster", "xLog Contest"] { do { _ = try await broker.forward(try spot(source: source)); XCTFail("Expected unknown") } catch {} }
        let owners = try rows(url, "quarantined_deliveries").map { try XCTUnwrap((JSONSerialization.jsonObject(with: $0) as? [String: Any])?["owner"] as? String) }
        XCTAssertEqual(Set(owners), ["normal_logging", "contesting"])
        do { _ = try await broker.withdrawNormalForwardedSpots(); XCTFail("Unknown must block removal") } catch {}
        XCTAssertEqual(try rows(url, "quarantined_deliveries").count, 2)
        let removed = await transport.removals; XCTAssertEqual(removed, 0)
    }

    func testCleanupLeaseBlocksPeerPublicationUntilExactRemovalSettles() async throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let inventory = root.appendingPathComponent("spots.json"), url = inventory.appendingPathExtension("sqlite")
        let gate = RecoverySpotGate(), firstTransport = RecoverySpotTransport(); await firstTransport.setMode(.accepted)
        let first = SpotForwardBroker(inventoryURL: inventory, targetedDeliver: { _, _, _ in try await firstTransport.add() }, targetedRemove: { _, _, _ in await gate.wait() })
        _ = try await first.forward(try spot())
        let cleanup = Task { try await first.withdrawNormalForwardedSpots() }
        while !(await gate.entered) { try await Task.sleep(for: .milliseconds(5)) }
        let peerTransport = RecoverySpotTransport(); await peerTransport.setMode(.accepted)
        let peer = SpotForwardBroker(inventoryURL: inventory, targetedDeliver: { _, _, _ in try await peerTransport.add() }, targetedRemove: { _, _, _ in })
        do { _ = try await peer.forward(try spot()); XCTFail("Cleanup lease must block peer add") } catch {}
        let attempts = await peerTransport.attempts; XCTAssertEqual(attempts, 0)
        await gate.release(); _ = try await cleanup.value
        let delivered = try await peer.forward(try spot()); XCTAssertTrue(delivered)
        XCTAssertEqual(try rows(url, "receipts").count, 1)
    }
}

private actor RecoverySpotTransport {
    enum Mode { case unknown, notAdmitted, accepted }
    private var mode: Mode = .unknown
    private(set) var attempts = 0, removals = 0
    private(set) var lastPreference: String?
    func setMode(_ value: Mode) { mode = value }
    func add(preferred: String? = nil) throws -> String {
        lastPreference = preferred
        attempts += 1
        switch mode {
        case .unknown: throw WorkerFailure("station_rejected", "Fixture unknown delivery")
        case .notAdmitted: throw ConfirmedSpotDeliveryNotAdmitted(code: "station_unavailable", message: "Fixture offline")
        case .accepted: return "radio1"
        }
    }
    func remove() { removals += 1 }
}
private actor RecoverySpotGate {
    private(set) var entered = false
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async { entered = true; await withCheckedContinuation { continuation = $0 } }
    func release() { continuation?.resume(); continuation = nil }
}
#endif
