import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
import XCTest
@testable import XLogPrototypeSupport

@Suite("DXpedition feed isolation")
struct DXpeditionConcurrencyTests {
    @Test("A held catalogue download does not block a real worker logbook read")
    func heldFeedAllowsLoggingRead() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HeldDXpeditionFeed.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); HeldDXpeditionFeed.gate.release() }
        let opportunities = LiveOpportunitiesMethods(logbook: logbook, session: session, clusterSpots: { [] })
        let worker = LiveWorker(logbook: logbook, opportunityMethods: opportunities)
        let refresh = Task {
            await worker.response(to: Data(#"{"id":"slow-dx","method":"opportunities_dxpedition_refresh","params":{"source":"adxo"}}"#.utf8))
        }
        // Startup competes with hundreds of independent fixtures in the full
        // suite. The concurrency contract is the two-second logbook read below,
        // measured only after the feed is demonstrably held.
        let started = await XCTWaiter.fulfillment(of: [HeldDXpeditionFeed.gate.started], timeout: 10)
        #expect(started == .completed)
        let readFinished = XCTestExpectation(description: "independent logging read completed")
        let read = Task {
            let response = await worker.response(to: Data(#"{"id":"logging-read","method":"logbook_stats","params":{}}"#.utf8))
            readFinished.fulfill()
            return response
        }
        let readResult = await XCTWaiter.fulfillment(of: [readFinished], timeout: 2)
        #expect(readResult == .completed)
        #expect(HeldDXpeditionFeed.gate.isHolding)
        HeldDXpeditionFeed.gate.release()
        let loggingResponse = try #require(JSONSerialization.jsonObject(with: await read.value) as? [String: Any])
        #expect(loggingResponse["ok"] as? Bool == true)
        let feedResponse = try #require(JSONSerialization.jsonObject(with: await refresh.value) as? [String: Any])
        #expect(feedResponse["ok"] as? Bool == true)
        #expect(try logbook.openedDatabase().count() == 0)
        await worker.beginTerminalShutdown()
    }
}

private final class HeldDXpeditionFeed: URLProtocol {
    final class Gate: @unchecked Sendable {
        let started = XCTestExpectation(description: "DX feed response is held")
        private let lock = NSLock()
        private var pending: HeldDXpeditionFeed?
        var isHolding: Bool { lock.lock(); defer { lock.unlock() }; return pending != nil }
        func hold(_ value: HeldDXpeditionFeed) { lock.lock(); pending = value; lock.unlock(); started.fulfill() }
        func release() {
            lock.lock(); let value = pending; pending = nil; lock.unlock()
            guard let value else { return }
            value.client?.urlProtocol(value, didLoad: Data("<p>Jan 1, 2020 - Dec 31, 2099</p><p>Callsign: TEST1</p>".utf8))
            value.client?.urlProtocolDidFinishLoading(value)
        }
        func stop(_ value: HeldDXpeditionFeed) { lock.lock(); defer { lock.unlock() }; if pending === value { pending = nil } }
    }
    static let gate = Gate()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/html"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        Self.gate.hold(self)
    }
    override func stopLoading() { Self.gate.stop(self) }
}
