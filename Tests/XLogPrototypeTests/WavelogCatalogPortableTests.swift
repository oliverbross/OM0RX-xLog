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
@testable import XLogPrototypeSupport

/// Intercepts every request; no Wavelog installation, account or public feed is contacted.
private final class CatalogueHTTPFixture: URLProtocol {
    struct Reply {
        var status = 200
        var body = Data(#"{"data":{"topics":["contest","dxcc","subdivisions"]}}"#.utf8)
        var headers: [String: String] = [:]
        var gate: Gate?
    }

    final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var callback: (() -> Void)?
        var started: Bool { lock.withLock { callback != nil } }
        func hold(_ callback: @escaping () -> Void) { lock.withLock { self.callback = callback } }
        func release() {
            let released = lock.withLock { let value = callback; callback = nil; return value }
            released?()
        }
    }

    private static let lock = NSLock()
    private static var handler: ((URLRequest) throws -> Reply)?
    private static var requests: [URLRequest] = []
    private let responseLock = NSLock()
    private var stopped = false

    static func install(_ handler: @escaping (URLRequest) throws -> Reply) {
        lock.withLock { Self.handler = handler; requests = [] }
    }
    static var recorded: [URLRequest] { lock.withLock { requests } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let handler = Self.lock.withLock { Self.requests.append(request); return Self.handler }
            let reply = try XCTUnwrap(handler)(request)
            if let gate = reply.gate { gate.hold { [weak self] in self?.respond(reply) } }
            else { respond(reply) }
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { responseLock.withLock { stopped = true } }
    private func respond(_ reply: Reply) {
        guard !responseLock.withLock({ stopped }), let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: nil,
                                             headerFields: reply.headers) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class WavelogCatalogPortableTests: XCTestCase {
    private final class CredentialInteractions: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [Bool] = []
        func record(_ value: Bool) { lock.withLock { values.append(value) } }
        var recorded: [Bool] { lock.withLock { values } }
    }
    private struct Fixture {
        let root: URL
        let logbook: LiveLogbookMethods
        let directory: URL
        let session: URLSession
        init() throws {
            root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
                .appendingPathComponent("xlog-catalogue-" + UUID().uuidString)
            logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
            let settings = try XCTUnwrap(logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
            var fields = settings
            fields["logbookMode"] = "wavelog"
            fields["wavelogURL"] = "https://catalogue.invalid/wavelog/index.php/api/v2"
            fields["wavelogStationID"] = 1
            _ = try logbook.saveSettingsForTest(fields)
            directory = try logbook.referenceDirectoryURL()
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [CatalogueHTTPFixture.self]
            session = URLSession(configuration: configuration)
        }
        func clean() {
            session.invalidateAndCancel()
            try? logbook.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
        var catalogue: URL { directory.appendingPathComponent("wavelog-catalog.json") }
    }

    func testAcceptedInstallationAndAPIV2URLsReachExactlyOneCatalogueRoute() {
        for path in ["", "/", "/index.php", "/api/v2", "/index.php/api/v2", "/api/v2/"] {
            let url = URL(string: "https://fixture.invalid" + path)!
            XCTAssertEqual(ReferenceDataUpdater.wavelogCatalogURL(url)?.absoluteString,
                           "https://fixture.invalid/index.php/api/v2/catalog")
        }
        for path in ["/log", "/log/index.php", "/log/api/v2", "/log/index.php/api/v2/"] {
            XCTAssertEqual(ReferenceDataUpdater.wavelogCatalogURL(URL(string: "https://fixture.invalid" + path)!)?.path,
                           "/log/index.php/api/v2/catalog")
        }
        for raw in ["http://fixture.invalid", "http://127.0.0.1", "https://user:secret@fixture.invalid",
                    "https://fixture.invalid/api/v2?token=secret", "https://fixture.invalid/api/v2#secret"] {
            XCTAssertNil(ReferenceDataUpdater.wavelogCatalogURL(URL(string: raw)!))
        }
    }

    func testReferenceConfigurationRequiresRealJSONBooleansOnEveryPlatform() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        CatalogueHTTPFixture.install { _ in XCTFail("Configuring automatic checks started a request"); return .init() }
        let resolver = LiveReferenceMethods(logbook: fixture.logbook, session: fixture.session)
        _ = try await resolver.handle(method: "reference_configure", params: ["enabled": false])
        let lookalikes: [Any] = [NSNumber(value: 0), NSNumber(value: 1), NSNumber(value: Int8(0)),
                                NSNumber(value: Int8(1)), NSNumber(value: 0.0), NSNumber(value: 1.0), "true", NSNull()]
        for key in ["enabled", "only_if_unset"] {
            for value in lookalikes {
                var params: [String: Any] = ["enabled": true]
                params[key] = value
                do { _ = try await resolver.handle(method: "reference_configure", params: params); XCTFail("Accepted a non-boolean \(key)") }
                catch { XCTAssertEqual((error as? WorkerFailure)?.code, "invalid_params") }
                XCTAssertEqual(try fixture.logbook.automaticReferenceChecks(), false)
            }
        }
        for (json, expected) in [
            (#"{"enabled":true,"only_if_unset":true}"#, false),
            (#"{"enabled":true,"only_if_unset":false}"#, true),
            (#"{"enabled":false,"only_if_unset":false}"#, false)
        ] {
            let params = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            let result = try await resolver.handle(method: "reference_configure", params: params)
            XCTAssertEqual(result["automatic_check"] as? Bool, expected)
        }
        XCTAssertTrue(CatalogueHTTPFixture.recorded.isEmpty)
        await resolver.terminate()
    }

    func testAuthenticatedCatalogueConditionalCacheIsScopedToSourceAndToken() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let updater = try ReferenceDataUpdater(directory: fixture.directory, session: fixture.session)
        CatalogueHTTPFixture.install { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/wavelog/index.php/api/v2/catalog")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
            return .init(status: request.value(forHTTPHeaderField: "If-None-Match") == "fixture-etag" ? 304 : 200,
                         headers: ["ETag": "fixture-etag", "X-Dataset-Version": "fixture-2026"])
        }
        let url = URL(string: "https://catalogue.invalid/wavelog/api/v2")!
        let first = try await updater.refreshWavelogCatalog(baseURL: url, token: "wl2_first")
        let bytes = try Data(contentsOf: fixture.catalogue)
        let second = try await updater.refreshWavelogCatalog(baseURL: url, token: "wl2_first")
        XCTAssertEqual(first.sourceMetadata["wavelog-catalog.json"]?.downloadedAt,
                       second.sourceMetadata["wavelog-catalog.json"]?.downloadedAt)
        XCTAssertEqual(second.sourceMetadata["wavelog-catalog.json"]?.status, "up_to_date")
        XCTAssertEqual(second.sourceMetadata["wavelog-catalog.json"]?.sourceVersion, "fixture-2026")
        _ = try await updater.refreshWavelogCatalog(baseURL: url, token: "wl2_second")
        _ = try await updater.refreshWavelogCatalog(baseURL: URL(string: "https://other.invalid/wavelog")!, token: "wl2_second")
        let requests = CatalogueHTTPFixture.recorded
        XCTAssertEqual(requests.map { $0.value(forHTTPHeaderField: "Authorization") },
                       ["Bearer wl2_first", "Bearer wl2_first", "Bearer wl2_second", "Bearer wl2_second"])
        XCTAssertEqual(requests.map { $0.value(forHTTPHeaderField: "If-None-Match") }, [nil, "fixture-etag", nil, nil])
        XCTAssertEqual(try Data(contentsOf: fixture.catalogue), bytes)
        let stateText = try String(contentsOf: fixture.directory.appendingPathComponent("state.json"), encoding: .utf8)
        for secret in ["wl2_first", "wl2_second", "catalogue.invalid", "other.invalid"] { XCTAssertFalse(stateText.contains(secret)) }
        try FileManager.default.removeItem(at: fixture.catalogue)
        _ = try await updater.refreshWavelogCatalog(baseURL: URL(string: "https://other.invalid/wavelog")!, token: "wl2_second")
        XCTAssertNil(CatalogueHTTPFixture.recorded.last?.value(forHTTPHeaderField: "If-None-Match"))
    }

    func testMalformedRejectedOfflineAndRedirectResponsesRetainValidatedCache() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let updater = try ReferenceDataUpdater(directory: fixture.directory, session: fixture.session)
        let url = URL(string: "https://catalogue.invalid")!
        CatalogueHTTPFixture.install { _ in .init(headers: ["ETag": "retained"]) }
        _ = try await updater.refreshWavelogCatalog(baseURL: url, token: "wl2_private_fixture")
        let original = try Data(contentsOf: fixture.catalogue)
        for status in [200, 401, 302] {
            CatalogueHTTPFixture.install { _ in .init(status: status, body: Data("invalid or private server text".utf8),
                headers: ["Location": "https://forbidden.invalid/collect"]) }
            do { _ = try await updater.refreshWavelogCatalog(baseURL: url, token: "wl2_private_fixture"); XCTFail("Invalid catalogue accepted") }
            catch { XCTAssertTrue(error is ReferenceDataUpdaterError) }
            XCTAssertEqual(CatalogueHTTPFixture.recorded.count, 1)
            XCTAssertEqual(try Data(contentsOf: fixture.catalogue), original)
        }
        CatalogueHTTPFixture.install { _ in throw URLError(.notConnectedToInternet) }
        do { _ = try await updater.refreshWavelogCatalog(baseURL: url, token: "wl2_private_fixture"); XCTFail("Offline refresh succeeded") }
        catch { XCTAssertTrue(error is ReferenceDataUpdaterError) }
        XCTAssertEqual(try Data(contentsOf: fixture.catalogue), original)
        let state = await updater.currentState()
        XCTAssertEqual(state.sourceMetadata["wavelog-catalog.json"]?.status, "failed")
        XCTAssertEqual(state.sourceMetadata["wavelog-catalog.json"]?.lastError, "download_or_validation_failed")

        // FoundationNetworking does not support URLProtocol's redirect callback.
        // Exercise the production delegate's refusal separately from final 302 rejection.
        let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: nil)!
        let task = fixture.session.dataTask(with: url)
        var called = false, followed = false
        CredentialRedirectBlocker().urlSession(fixture.session, task: task,
            willPerformHTTPRedirection: response, newRequest: URLRequest(url: URL(string: "https://forbidden.invalid")!)) {
                called = true; followed = $0 != nil
            }
        task.cancel()
        XCTAssertTrue(called); XCTAssertFalse(followed)
    }

    func testVaultFailureAndMissingTokenFailBeforeAnyCatalogueRequest() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        CatalogueHTTPFixture.install { _ in throw URLError(.unsupportedURL) }
        let unavailable = LiveReferenceMethods(logbook: fixture.logbook, session: fixture.session,
            credentialLoader: { _, account, _ in
                guard account == .wavelogToken else { return nil }
                throw WorkerFailure("credential_unavailable", "Fixture vault is locked")
            })
        do { _ = try await unavailable.handle(method: "reference_refresh", params: ["source": "wavelog_catalog"]); XCTFail("Locked vault accepted") }
        catch { XCTAssertEqual((error as? WorkerFailure)?.code, "credential_unavailable") }
        _ = try fixture.logbook.configureReferenceChecks(enabled: true, onlyIfUnset: false)
        await unavailable.automaticTick()
        XCTAssertTrue(CatalogueHTTPFixture.recorded.isEmpty)
        await unavailable.terminate()

        let missing = LiveReferenceMethods(logbook: fixture.logbook, session: fixture.session, credentialLoader: { _, _, _ in nil })
        do { _ = try await missing.handle(method: "reference_refresh", params: ["source": "wavelog_catalog"]); XCTFail("Missing token accepted") }
        catch { XCTAssertEqual((error as? WorkerFailure)?.code, "reference_configuration_required") }
        XCTAssertTrue(CatalogueHTTPFixture.recorded.isEmpty)
        await missing.terminate()
    }

    func testOnlyExplicitCatalogueRefreshMayRequestVaultAuthorization() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let interactions = CredentialInteractions()
        CatalogueHTTPFixture.install { _ in .init() }
        let resolver = LiveReferenceMethods(logbook: fixture.logbook, session: fixture.session,
            credentialLoader: { _, account, allowInteraction in
                guard account == .wavelogToken else { return nil }
                interactions.record(allowInteraction)
                guard allowInteraction else {
                    throw WorkerFailure("credential_unavailable", "Fixture vault requires authorization")
                }
                return "wl2_disposable_fixture"
            })
        _ = try await resolver.handle(method: "reference_refresh", params: ["source": "wavelog_catalog"])
        await resolver.refreshTask?.value
        _ = try fixture.logbook.configureReferenceChecks(enabled: true, onlyIfUnset: false)
        do { _ = try await resolver.handle(method: "reference_schedule", params: [:]); XCTFail("Scheduled check requested authorization") }
        catch { XCTAssertEqual((error as? WorkerFailure)?.code, "credential_unavailable") }
        XCTAssertEqual(interactions.recorded, [true, false])
        XCTAssertEqual(CatalogueHTTPFixture.recorded.count, 1)
        await resolver.terminate()
    }

    func testDelayedOldWorkspaceResponseIsRetiredBeforeNewCatalogueRefresh() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let gate = CatalogueHTTPFixture.Gate()
        CatalogueHTTPFixture.install { _ in .init(body: Data(#"{"old_workspace":true}"#.utf8), gate: gate) }
        let resolver = LiveReferenceMethods(logbook: fixture.logbook, session: fixture.session,
                                            credentialLoader: { _, _, _ in "wl2_disposable_fixture" })
        _ = try await resolver.handle(method: "reference_refresh", params: ["source": "wavelog_catalog"])
        for _ in 0..<200 where !gate.started { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(gate.started)
        await resolver.suspendForWorkspaceChange()
        let retiredTask = await resolver.refreshTask
        XCTAssertNil(retiredTask)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.catalogue.path))
        let oldGeneration = try fixture.logbook.syncOwnerContext()["generation"] as? String
        // Rotate only this disposable workspace's generation, using the same
        // fixture boundary as the automatic-sync generation regressions.
        try JSONEncoder().encode(UUID()).write(to: fixture.logbook.workspaceDirectoryURL
            .appendingPathComponent("edit-generation.json"), options: .atomic)
        XCTAssertNotEqual(oldGeneration, try fixture.logbook.syncOwnerContext()["generation"] as? String)
        var fields = try XCTUnwrap(fixture.logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        fields["logbookMode"] = "wavelog"; fields["wavelogURL"] = "https://new.invalid"
        fields["wavelogStationID"] = 1
        _ = try fixture.logbook.saveSettingsForTest(fields)
        await resolver.finishWorkspaceChange()
        gate.release()
        CatalogueHTTPFixture.install { _ in .init(body: Data(#"{"new_workspace":true}"#.utf8)) }
        _ = try await resolver.handle(method: "reference_refresh", params: ["source": "wavelog_catalog"])
        await resolver.refreshTask?.value
        XCTAssertEqual(try Data(contentsOf: fixture.catalogue), Data(#"{"new_workspace":true}"#.utf8))
        let status = try await resolver.handle(method: "reference_status", params: [:])
        XCTAssertEqual(status["status"] as? String, "Updated wavelog_catalog")
        XCTAssertEqual(CatalogueHTTPFixture.recorded.count, 1)
        await resolver.terminate()
    }

    func testReferenceLeaseContentionReleaseAndUnsafeFileFailClosed() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let path = fixture.directory.deletingLastPathComponent().appendingPathComponent(".reference-refresh.lock")
        let marker = Data("persistent lock identity".utf8)
        try marker.write(to: path)
        let first = try ReferenceRefreshLease(directory: fixture.directory)
        XCTAssertThrowsError(try ReferenceRefreshLease(directory: fixture.directory))
        first.release()
        let second = try ReferenceRefreshLease(directory: fixture.directory)
        first.release()
        XCTAssertThrowsError(try ReferenceRefreshLease(directory: fixture.directory))
        second.release()
        XCTAssertEqual(try Data(contentsOf: path), marker)
        try FileManager.default.removeItem(at: path)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
        XCTAssertThrowsError(try ReferenceRefreshLease(directory: fixture.directory))
    }

    func testWorkerAdvertisesAndRoutesWavelogWithoutBroadPlatformServices() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let worker = LiveWorker(logbook: fixture.logbook)
        func result(_ method: String) async throws -> [String: Any] {
            let request = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": [:]])
            let data = await worker.response(to: request)
            let response = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(response["ok"] as? Bool, true)
            return try XCTUnwrap(response["result"] as? [String: Any])
        }
        let health = try await result("health")
        XCTAssertEqual(health["wavelog_sync"] as? Bool, true)
        XCTAssertEqual(health["wavelog_catalog"] as? Bool, true)
        #if !os(macOS)
        XCTAssertEqual(health["platform_services"] as? Bool, false)
        #endif
        let status = try await result("reference_status")
        XCTAssertEqual(status["available_sources"] as? [String], LiveReferenceMethods.availableSources)
        let summary = try await result("sync_summary")
        XCTAssertEqual(summary["sync_available"] as? Bool, true)
        _ = await worker.shutdown()
    }

    #if !os(macOS)
    func testPortableSchedulerReadsOnlyWavelogCredentialAndNeverSchedulesOtherProviders() async throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        _ = try fixture.logbook.configureReferenceChecks(enabled: true, onlyIfUnset: false)
        CatalogueHTTPFixture.install { request in
            XCTAssertEqual(request.url?.path, "/wavelog/index.php/api/v2/catalog")
            return .init()
        }
        let resolver = LiveReferenceMethods(logbook: fixture.logbook, session: fixture.session,
            credentialLoader: { _, account, _ in
                XCTAssertEqual(account, .wavelogToken)
                return "wl2_disposable_fixture"
            })
        let first = try await resolver.handle(method: "reference_schedule", params: [:])
        XCTAssertEqual(first["scheduled"] as? [String], ["wavelog-catalog.json"])
        await resolver.refreshTask?.value
        let second = try await resolver.handle(method: "reference_schedule", params: [:])
        XCTAssertEqual(second["scheduled"] as? [String], [])
        XCTAssertEqual(CatalogueHTTPFixture.recorded.count, 1)
        for source in ["clublog_lotw", "activations"] {
            do { _ = try await resolver.handle(method: "reference_refresh", params: ["source": source]); XCTFail("Unsupported provider enabled") }
            catch { XCTAssertEqual((error as? WorkerFailure)?.code, "platform_pending") }
        }
        do { _ = try await resolver.handle(method: "reference_log_review", params: [:]); XCTFail("Unsupported log review enabled") }
        catch { XCTAssertEqual((error as? WorkerFailure)?.code, "platform_pending") }
        XCTAssertEqual(CatalogueHTTPFixture.recorded.count, 1)
        await resolver.terminate()
    }
    #endif
}
