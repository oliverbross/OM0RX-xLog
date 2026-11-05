import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

final class ADIFTransferLifetimeTests: XCTestCase {
    private final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var value = Date()
        func now() -> Date { lock.withLock { value } }
        func advance(_ seconds: TimeInterval) { lock.withLock { value.addTimeInterval(seconds) } }
    }
    private final class Gate: @unchecked Sendable {
        private let condition = NSCondition()
        private var entered = false, released = false
        let onEntry: @Sendable () -> Void
        init(_ onEntry: @escaping @Sendable () -> Void) { self.onEntry = onEntry }
        func holdOnce() {
            condition.lock()
            if entered { condition.unlock(); return }
            entered = true; onEntry()
            while !released { condition.wait() }
            condition.unlock()
        }
        func release() { condition.lock(); released = true; condition.broadcast(); condition.unlock() }
    }
    private final class Finished: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        func mark() { lock.withLock { value = true } }
        var done: Bool { lock.withLock { value } }
    }
    private struct Fixture {
        let service: LiveLogbookMethods
        let database: LogbookDatabase
        let qso: QSO
    }
    private func fixture(lifetime: TimeInterval = 300, clock: Clock? = nil) throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-transfer-lifetime-\(UUID())")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false,
            runtimeProfile: .production, transferSessionLifetime: lifetime,
            transferSessionNow: { clock?.now() ?? Date() })
        _ = try service.handle(method: "workspace_create", params: ["mode":"empty"])
        let database = try service.openedDatabase()
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        addTeardownBlock {
            database.close()
            workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            try? FileManager.default.removeItem(at: root)
        }
        let qso = QSO(call:"K1LIFE", start:Date(timeIntervalSince1970:1_735_732_800), band:"20m", mode:"CW",
            comment:"frozen selected Ω", myCall:"OM0RX/P", myGrid:"JN98",
            extraFields:["MY_POTA_REF":"SK-0001", "MY_STATE":"SK-BL", "APP_FIXTURE":"retained"])
        try database.save(qso)
        return Fixture(service:service,database:database,qso:try XCTUnwrap(database.fetchAll().first))
    }
    private func begin(_ service: LiveLogbookMethods) throws -> [String:Any] {
        try service.handle(method:"logbook_export_adif",params:["action":"begin","scope":"all"])
    }
    private func preview(_ f: Fixture) throws -> [String:Any] {
        try f.service.handle(method:"logbook_import_adif",params:["action":"preview","text":f.qso.adifRecord.adifDocument])
    }
    private func retire(_ service: LiveLogbookMethods, _ method: String, _ value: [String:Any], importing: Bool = false) throws -> Bool {
        let result = try service.handle(method:method,params:["action":"retire","token":value["token"]!,
            "generation":value[importing ? "generation" : "workspace_generation"]!])
        return try XCTUnwrap(result["retired"] as? Bool)
    }

    func testMatchingRetireFencesReplacementAndAtomicallyReleasesDerivedPOTA() throws {
        let f = try fixture()
        let incoming = try preview(f), old = try begin(f.service)
        _ = try f.service.handle(method:"logbook_export_adif",params:["action":"pota_preview","token":old["token"]!])
        let current = try begin(f.service)
        _ = try f.service.handle(method:"logbook_export_adif",params:["action":"pota_preview","token":current["token"]!])
        XCTAssertFalse(try retire(f.service,"logbook_export_adif",old))
        var wrongGeneration = current; wrongGeneration["workspace_generation"] = UUID().uuidString
        XCTAssertFalse(try retire(f.service,"logbook_export_adif",wrongGeneration))
        XCTAssertEqual(f.service.retainedTransferSessionTokensForTesting["pota"],current["token"] as? String)
        XCTAssertTrue(try retire(f.service,"logbook_import_adif",incoming,importing:true))
        XCTAssertNotNil(f.service.retainedTransferSessionTokensForTesting["export"])
        let nextImport = try preview(f)
        XCTAssertTrue(try retire(f.service,"logbook_export_adif",current))
        XCTAssertEqual(Set(f.service.retainedTransferSessionTokensForTesting.keys),["import"])
        XCTAssertFalse(try retire(f.service,"logbook_export_adif",current))
        XCTAssertTrue(try retire(f.service,"logbook_import_adif",nextImport,importing:true))
        XCTAssertTrue(f.service.retainedTransferSessionTokensForTesting.isEmpty)
        XCTAssertEqual(try f.database.fetchAll(),[f.qso])
    }

    func testAutomaticExportExpiryReleasesOwnerWithoutAnotherRequest() async throws {
        let f = try fixture(lifetime:0.2)
        let expired = expectation(description:"automatic export expiry")
        f.service.transferSessionsDidExpireForTesting = { expired.fulfill() }
        let owner = try begin(f.service)
        _ = try f.service.handle(method:"logbook_export_adif",params:["action":"pota_preview","token":owner["token"]!])
        XCTAssertEqual(Set(f.service.retainedTransferSessionTokensForTesting.keys),["export","pota"])
        await fulfillment(of:[expired],timeout:2)
        XCTAssertTrue(f.service.retainedTransferSessionTokensForTesting.isEmpty)
        XCTAssertEqual(try f.database.fetchAll(),[f.qso])
    }

    func testAutomaticImportExpiryReleasesDuplicateIndexesWithoutAnotherRequest() async throws {
        let f = try fixture(lifetime:0.05)
        let expired = expectation(description:"automatic import expiry")
        f.service.transferSessionsDidExpireForTesting = { expired.fulfill() }
        XCTAssertEqual(try preview(f)["duplicates"] as? Int,1)
        await fulfillment(of:[expired],timeout:2)
        XCTAssertTrue(f.service.retainedTransferSessionTokensForTesting.isEmpty)
        XCTAssertEqual(try f.database.fetchAll(),[f.qso])
    }

    func testOldExpiryEventCannotReleaseReplacementAndExpiryClearsPOTA() throws {
        let clock = Clock(), f = try fixture(clock:clock)
        let old = try begin(f.service)
        let oldImport = try preview(f)
        clock.advance(299)
        let current = try begin(f.service)
        _ = try f.service.handle(method:"logbook_export_adif",params:["action":"pota_preview","token":current["token"]!])
        clock.advance(1)
        // Delivery of the old deadline after a replacement checks current owners.
        f.service.expireTransferSessions()
        XCTAssertNil(f.service.retainedTransferSessionTokensForTesting["import"])
        XCTAssertEqual(f.service.retainedTransferSessionTokensForTesting["export"],current["token"] as? String)
        XCTAssertFalse(try retire(f.service,"logbook_export_adif",old))
        XCTAssertFalse(try retire(f.service,"logbook_import_adif",oldImport,importing:true))
        let files = try f.service.handle(method:"logbook_export_adif",params:["action":"pota_files","token":current["token"]!])
        XCTAssertEqual(files["total"] as? Int,1)
        clock.advance(300)
        f.service.expireTransferSessions()
        XCTAssertTrue(f.service.retainedTransferSessionTokensForTesting.isEmpty)
        XCTAssertThrowsError(try f.service.handle(method:"logbook_export_adif",params:["action":"read","token":current["token"]!]))
        XCTAssertEqual(try f.database.fetchAll(),[f.qso])
    }

    func testInFlightFrozenReadSurvivesRetireAndReplacementRace() async throws {
        let f = try fixture(), old = try begin(f.service)
        var changed = f.qso; changed.comment = "new selected Ω"; try f.database.save(changed)
        let persistedChanged = try f.database.fetchAll()
        let entered = expectation(description:"old read using payload")
        let gate = Gate { entered.fulfill() }
        defer { gate.release() }
        f.service.beforeTransferSessionUseForTesting = { gate.holdOnce() }
        let read = Task.detached {
            try JSONSerialization.data(withJSONObject:f.service.handle(method:"logbook_export_adif",params:["action":"read","token":old["token"]!]))
        }
        await fulfillment(of:[entered],timeout:2)
        let attempted = expectation(description:"retire and begin attempted"); attempted.expectedFulfillmentCount = 2
        let retired = Finished(), replaced = Finished()
        let retirement = Task.detached {
            attempted.fulfill()
            let result = try f.service.handle(method:"logbook_export_adif",params:["action":"retire","token":old["token"]!,"generation":old["workspace_generation"]!])
            retired.mark(); return try JSONSerialization.data(withJSONObject:result)
        }
        let replacement = Task.detached {
            attempted.fulfill()
            let result = try f.service.handle(method:"logbook_export_adif",params:["action":"begin","scope":"all"])
            replaced.mark(); return try JSONSerialization.data(withJSONObject:result)
        }
        await fulfillment(of:[attempted],timeout:2)
        XCTAssertFalse(retired.done); XCTAssertFalse(replaced.done)
        gate.release()
        let oldData = try await read.value
        let oldReply = try XCTUnwrap(try JSONSerialization.jsonObject(with:oldData) as? [String:Any])
        XCTAssertTrue((oldReply["text"] as? String)?.contains("frozen selected Ω") == true)
        _ = try await retirement.value
        let currentData = try await replacement.value
        let current = try XCTUnwrap(try JSONSerialization.jsonObject(with:currentData) as? [String:Any])
        XCTAssertFalse(try retire(f.service,"logbook_export_adif",old))
        let next = try f.service.handle(method:"logbook_export_adif",params:["action":"read","token":current["token"]!])
        XCTAssertTrue((next["text"] as? String)?.contains("new selected Ω") == true)
        XCTAssertEqual(try f.database.fetchAll(),persistedChanged)
    }

    func testRetireAPIThroughLiveWorkerRejectsMalformedCoordinatesAndRetainsNewOwner() async throws {
        let f = try fixture(), worker = LiveWorker(logbook:f.service,localAcceptance:true)
        let current = try begin(f.service)
        func call(_ params:[String:Any]) async throws -> [String:Any] {
            let data = try JSONSerialization.data(withJSONObject:["id":UUID().uuidString,"method":"logbook_export_adif","params":params])
            let response = await worker.response(to:data)
            return try XCTUnwrap(try JSONSerialization.jsonObject(with:response) as? [String:Any])
        }
        let invalid = try await call(["action":"retire","token":current["token"]!])
        XCTAssertEqual(invalid["ok"] as? Bool,false)
        XCTAssertNotNil(f.service.retainedTransferSessionTokensForTesting["export"])
        let valid = try await call(["action":"retire","token":current["token"]!,"generation":current["workspace_generation"]!])
        XCTAssertEqual((valid["result"] as? [String:Any])?["retired"] as? Bool,true)
        XCTAssertTrue(f.service.retainedTransferSessionTokensForTesting.isEmpty)
        await worker.shutdown()
    }

    func testExpiryTimerDoesNotKeepServiceAlive() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-transfer-deinit-\(UUID())")
        var service: LiveLogbookMethods? = LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
        _ = try service!.handle(method:"workspace_create",params:["mode":"empty"])
        let database = try service!.openedDatabase()
        let workspace = try IntegrationWorkspaceBootstrap.open(at:service!.workspaceDirectoryURL)
        defer { database.close(); workspace.makeDefaults()?.removePersistentDomain(forName:workspace.defaultsSuiteName); try? FileManager.default.removeItem(at:root) }
        _ = try begin(service!)
        weak var retained = service
        service = nil
        XCTAssertNil(retained)
    }
}
