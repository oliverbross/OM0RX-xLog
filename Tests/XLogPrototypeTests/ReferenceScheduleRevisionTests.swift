#if os(macOS)
import Foundation
import XCTest
@testable import XLogPrototypeSupport

/// Intercepts every request, including any unwanted request after the first.
/// Only the first response is held; later requests fail immediately so joining
/// the exact refresh task also proves the batch has finished issuing requests.
private final class RevisionHeldURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var urls: [URL] = []
    private static var held: RevisionHeldURLProtocol?
    private static var started: (@Sendable () -> Void)?

    static func configure(started: @escaping @Sendable () -> Void) {
        lock.withLock {
            urls = []
            held = nil
            self.started = started
        }
    }

    static func requestedURLs() -> [URL] { lock.withLock { urls } }

    static func releaseFirstResponse() {
        let pending = lock.withLock { () -> RevisionHeldURLProtocol? in
            defer { held = nil }
            return held
        }
        pending?.failResponse()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let (first, callback) = Self.lock.withLock { () -> (Bool, (@Sendable () -> Void)?) in
            let first = Self.urls.isEmpty
            if let url = request.url { Self.urls.append(url) }
            if first {
                Self.held = self
                return (true, Self.started)
            }
            return (false, nil)
        }
        if first { callback?() }
        else { failResponse() }
    }

    override func stopLoading() {
        Self.lock.withLock {
            if Self.held === self { Self.held = nil }
        }
    }

    private func failResponse() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 503,
                                       httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class ReferenceScheduleRevisionTests: XCTestCase {
    private enum Change: CaseIterable {
        case settingsRevision
        case disableThenEnable
    }

    func testChangedRevisionStopsHeldBatchBeforeActivationRequests() async throws {
        for change in Change.allCases {
            try await assertBatchStops(after: change)
        }
    }

    private func assertBatchStops(after change: Change) async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("reference-revision-" + UUID().uuidString)
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer {
            try? logbook.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var settings = try logbook.currentSettings()
        let lotwURL = URL(string: "https://fixture.invalid/lotw.csv")!
        settings.lotwActivityURL = lotwURL.absoluteString
        guard let settingsJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as? [String: Any] else {
            XCTFail("Could not encode settings fixture")
            return
        }
        _ = try logbook.saveSettingsForTest(settingsJSON)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RevisionHeldURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer {
            RevisionHeldURLProtocol.releaseFirstResponse()
            session.invalidateAndCancel()
        }
        let refs = LiveReferenceMethods(logbook: logbook, session: session)
        let started = expectation(description: "LoTW request held for \(change)")
        started.assertForOverFulfill = true
        RevisionHeldURLProtocol.configure { started.fulfill() }

        do {
            // The new workspace's unique Keychain service contains no keys;
            // this test creates neither a ClubLog key nor a Wavelog token.
            _ = try await refs.handle(method: "reference_configure", params: ["enabled": true])
            let scheduled = try await refs.handle(method: "reference_schedule", params: [:])
            XCTAssertEqual(scheduled["scheduled"] as? [String], [
                "lotw-user-activity.csv", "pota-parks.csv", "sota-summits.csv",
                "iota-groups.json", "wwff-directory.csv",
            ])
            await fulfillment(of: [started], timeout: 2)
            XCTAssertEqual(RevisionHeldURLProtocol.requestedURLs(), [lotwURL])
            let capturedTask = await refs.refreshTask
            let task = try XCTUnwrap(capturedTask)

            switch change {
            case .settingsRevision:
                await refs.resetAutomaticDeadline()
            case .disableThenEnable:
                _ = try await refs.handle(method: "reference_configure", params: ["enabled": false])
                _ = try await refs.handle(method: "reference_configure", params: ["enabled": true])
            }
            RevisionHeldURLProtocol.releaseFirstResponse()
            await task.value

            XCTAssertEqual(RevisionHeldURLProtocol.requestedURLs(), [lotwURL],
                           "An obsolete batch must not start activation requests after \(change)")
            let remaining = await refs.refreshTask
            XCTAssertNil(remaining)
            let status = try await refs.handle(method: "reference_status", params: [:])
            XCTAssertEqual(status["status"] as? String, "Scheduled checks stopped; remaining sources were not checked.")
            XCTAssertEqual(try logbook.automaticReferenceChecks(), true,
                           "The batch must stop because its revision changed, not because checks remain disabled")
            await refs.terminate()
        } catch {
            RevisionHeldURLProtocol.releaseFirstResponse()
            await refs.terminate()
            throw error
        }
    }
}
#endif
