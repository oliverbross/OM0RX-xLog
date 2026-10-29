import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

/// Every request, including accidental writes, is intercepted; no provider is contacted.
private final class DestinationHistoryProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [URLRequest] = []
    static func reset() { lock.withLock { recorded = [] } }
    static var requests: [URLRequest] { lock.withLock { recorded } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.recorded.append(request) }
        guard request.httpMethod == "GET", let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let station = items.first { $0.name == "station_id" }?.value
        let other = url.host == "destination-b.invalid" || station == "2"
        let id = other ? 84 : 42
        let call = other ? "K2OTHER" : "K1ORIGINAL"
        let body: Data
        if items.contains(where: { $0.name == "format" && $0.value == "adif" }) {
            let record = ADIFRecord(fields: ["CALL": call, "QSO_DATE": "20231114",
                "TIME_ON": "221320", "BAND": "20m", "MODE": "CW"])
            body = try! JSONEncoder().encode(WavelogADIFPage(
                data: WavelogADIFData(exported: 1, lastFetchedID: id, adif: record.adifDocument),
                meta: WavelogListMeta(page: 1, perPage: 1000, count: 1, total: 1, totalPages: 1, hasMore: false)))
        } else {
            body = """
            {"data":[{"id":\(id),"station_id":\(other ? 2 : 1),"call":"\(call)","band":"20m","mode":"CW","qso_date":"2023-11-14 22:13:20"}],"meta":{"page":1,"per_page":1000,"count":1,"total":1,"total_pages":1,"has_more":false}}
            """.data(using: .utf8)!
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class WavelogDestinationAuthorityTests: XCTestCase {
    func testLinkedLiveRowsAndTombstonesBlockEitherDestinationChangeWithoutPersisting() throws {
        try withFixture { store, database, saved, _ in
            var linked = original()
            for tombstone in [false, true] {
                linked.deletedAt = tombstone ? Date(timeIntervalSince1970: 1_700_000_100) : nil
                try database.save(linked, markDirty: false)
                XCTAssertEqual(try database.linkedRemoteCount(), 1)
                for changeURL in [false, true] {
                    let pending = changed(saved, url: changeURL)
                    XCTAssertThrowsError(try store.save(pending, protecting: database)) {
                        guard case WavelogDestinationError.linkedContacts = $0 else {
                            return XCTFail("Expected linked authority rejection, got \($0)")
                        }
                    }
                    XCTAssertEqual(store.load(), saved)
                    XCTAssertEqual(pending.operatorCall, "VK8PENDING")
                    XCTAssertEqual(pending.wavelogStationID, changeURL ? 1 : 2)
                    XCTAssertEqual(try database.lookup(localID: linked.id)?.deletedAt, linked.deletedAt)
                }
            }
        }
    }

    func testMissingOrClosedDatabaseFailsClosedForDestinationChanges() throws {
        try withFixture { store, database, saved, _ in
            let pending = changed(saved, url: true)
            XCTAssertThrowsError(try store.save(pending, protecting: nil))
            database.close()
            XCTAssertThrowsError(try store.save(pending, protecting: database))
            XCTAssertEqual(store.load(), saved)
        }
    }

    func testUnlinkedLogbookAllowsSavingNewDestinationAndFactoryUsesSavedAuthority() throws {
        try withFixture { store, database, saved, _ in
            try database.save(QSO(call: "VK8LOCAL", band: "40m", mode: "SSB"))
            let pending = changed(saved, url: true)
            try store.save(pending, protecting: database)
            XCTAssertEqual(store.load(), pending)
            let config = try store.wavelogConfiguration(for: pending, token: "wl2_fixture")
            XCTAssertEqual(config.baseURL.absoluteString, pending.wavelogURL)
            XCTAssertEqual(config.stationID, pending.wavelogStationID)
        }
    }

    func testUnchangedDestinationAllowsOtherEditsWithoutDatabaseAndCapturesToken() throws {
        try withFixture { store, database, saved, _ in
            try database.save(original(), markDirty: false)
            var pending = saved
            pending.operatorCall = "VK8KEEP"
            pending.automaticSync = false
            pending.syncIntervalMinutes = 17
            try store.save(pending, protecting: nil)
            XCTAssertEqual(store.load(), pending)
            let config = try store.wavelogConfiguration(for: pending, token: "wl2_captured")
            pending.wavelogURL = "https://destination-b.invalid"
            XCTAssertEqual(config.baseURL.absoluteString, saved.wavelogURL)
            XCTAssertEqual(config.stationID, saved.wavelogStationID)
            XCTAssertEqual(config.token, "wl2_captured")
        }
    }

    func testExactDestinationComparisonAlsoProtectsBackupSettingsCapture() throws {
        try withFixture { store, _, saved, _ in
            for pending in [changed(saved, url: true), changed(saved, url: false)] {
                XCTAssertThrowsError(try store.validateCurrentDestination(pending))
            }
            var slash = saved
            slash.wavelogURL += "/"
            XCTAssertFalse(saved.hasSameWavelogDestination(as: slash))
            XCTAssertThrowsError(try store.validateCurrentDestination(slash))
            var otherFields = saved
            otherFields.operatorCall = "VK8PENDING"
            XCTAssertNoThrow(try store.validateCurrentDestination(otherFields))
            XCTAssertEqual(store.load(), saved)
        }
    }

    func testUnsavedDestinationIsRejectedBeforeAnySyncRequestOrLocalMutation() async throws {
        try await withAsyncFixture { store, database, saved, session in
            let local = self.original()
            try database.save(local, markDirty: false)
            for changeURL in [false, true] {
                DestinationHistoryProtocol.reset()
                let pending = self.changed(saved, url: changeURL)
                do {
                    let config = try store.wavelogConfiguration(for: pending, token: "wl2_fixture")
                    _ = try await SyncEngine(database: database, configuration: config, session: session).synchronize()
                    XCTFail("Pending destination must be rejected before starting SyncEngine")
                } catch WavelogDestinationError.unsavedDestination { }
                XCTAssertTrue(DestinationHistoryProtocol.requests.isEmpty)
                XCTAssertNil(try database.lookup(localID: local.id)?.deletedAt)
                XCTAssertEqual(try database.count(), 1)
                XCTAssertEqual(store.load(), saved)
            }
        }
    }

    func testSavedDestinationControlActuallySynchronizesThroughInterceptedTransport() async throws {
        try await withAsyncFixture { store, database, saved, session in
            let local = self.original()
            try database.save(local, markDirty: false)
            DestinationHistoryProtocol.reset()
            let config = try store.wavelogConfiguration(for: saved, token: "wl2_fixture")
            let report = try await SyncEngine(database: database, configuration: config, session: session).synchronize()
            XCTAssertEqual(report.deleted, 0)
            XCTAssertNil(try database.lookup(localID: local.id)?.deletedAt)
            XCTAssertGreaterThanOrEqual(DestinationHistoryProtocol.requests.count, 3)
            XCTAssertTrue(DestinationHistoryProtocol.requests.allSatisfy {
                $0.httpMethod == "GET" && $0.url?.host == "destination-a.invalid"
            })
        }
    }

    /// A deliberate low-level bypass documents why the caller's factory is required.
    /// It exercises the real sync engine with a valid, distinct remote history.
    func testUnguardedConfigurationCounterexampleCanTombstoneAnotherDestinationsLinkedRow() async throws {
        try await withAsyncFixture { _, database, saved, session in
            let local = self.original()
            try database.save(local, markDirty: false)
            let pending = self.changed(saved, url: false)
            DestinationHistoryProtocol.reset()
            let config = try WavelogConfiguration(baseURL: URL(string: pending.wavelogURL)!,
                                                  token: "wl2_fixture", stationID: pending.wavelogStationID)
            let report = try await SyncEngine(database: database, configuration: config, session: session).synchronize()
            XCTAssertEqual(report.deleted, 1)
            XCTAssertNotNil(try database.lookup(localID: local.id)?.deletedAt)
            XCTAssertTrue(try database.fetchAll().contains { $0.wavelogID == 84 })
            XCTAssertGreaterThanOrEqual(DestinationHistoryProtocol.requests.count, 3)
            XCTAssertTrue(DestinationHistoryProtocol.requests.allSatisfy { $0.httpMethod == "GET" })
        }
    }

    private func original() -> QSO {
        QSO(wavelogID: 42, call: "K1ORIGINAL", start: Date(timeIntervalSince1970: 1_700_000_000),
            band: "20m", mode: "CW", isDirty: false)
    }
    private func changed(_ saved: XLogSettings, url: Bool) -> XLogSettings {
        var pending = saved
        if url { pending.wavelogURL = "https://destination-b.invalid" }
        else { pending.wavelogStationID = 2 }
        pending.operatorCall = "VK8PENDING"
        return pending
    }
    private func withFixture(_ body: (SettingsStore, LogbookDatabase, XLogSettings, URLSession) throws -> Void) throws {
        let id = "xlog-destination-authority-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: id))
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(id)
        defer { defaults.removePersistentDomain(forName: id); try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("live.sqlite"))
        defer { database.close() }
        var saved = XLogSettings.defaults
        saved.wavelogURL = "https://destination-a.invalid"
        saved.wavelogStationID = 1
        let store = SettingsStore(defaults: defaults)
        store.save(saved)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DestinationHistoryProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        try body(store, database, saved, session)
    }
    private func withAsyncFixture(_ body: (SettingsStore, LogbookDatabase, XLogSettings, URLSession) async throws -> Void) async throws {
        let id = "xlog-destination-authority-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: id))
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(id)
        defer { defaults.removePersistentDomain(forName: id); try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("live.sqlite"))
        defer { database.close() }
        var saved = XLogSettings.defaults
        saved.wavelogURL = "https://destination-a.invalid"
        saved.wavelogStationID = 1
        let store = SettingsStore(defaults: defaults)
        store.save(saved)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DestinationHistoryProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        try await body(store, database, saved, session)
    }
}
