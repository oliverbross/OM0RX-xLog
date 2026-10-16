import Foundation
import Testing
@testable import XLogCore

private final class LoTWProtocolFixture: URLProtocol {
    enum Mode { case report, overflow, declaredOverflow, redirect(String), stall, failure, status, html }
    final class State: @unchecked Sendable {
        let lock = NSLock()
        var mode: Mode = .report
        var starts = 0
        var stops = 0
        var requestTimeout: TimeInterval?
        func reset(_ mode: Mode) { lock.lock(); self.mode = mode; starts = 0; stops = 0; requestTimeout = nil; lock.unlock() }
        func counts() -> (Int, Int) { lock.lock(); defer { lock.unlock() }; return (starts, stops) }
    }
    static let state = State()
    static let report = Data("<PROGRAMID:4>LoTW<APP_LoTW_NUMREC:1>0<EOH>".utf8)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.state.lock.lock()
        Self.state.starts += 1
        Self.state.requestTimeout = request.timeoutInterval
        let mode = Self.state.mode
        Self.state.lock.unlock()
        guard let url = request.url else { return }
        switch mode {
        case .stall: return
        case .redirect(let destination):
            let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: ["Location": destination])!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: destination)!), redirectResponse: response)
            return
        case .failure:
            client?.urlProtocol(self, didFailWithError: NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut,
                userInfo: [NSURLErrorFailingURLStringErrorKey: url.absoluteString]))
            return
        default: break
        }
        let headers = mode.isDeclaredOverflow ? ["Content-Length": String(LoTWConfirmationReportParser.maximumInputBytes + 1)]
            : ["Content-Type": mode.isHTML ? "text/html" : "text/plain"]
        let response = HTTPURLResponse(url: url, statusCode: mode.isStatus ? 401 : 200, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if mode.isOverflow {
            // A missing Content-Length cannot bypass the streaming byte cap.
            let chunk = Data(repeating: 32, count: 1_024 * 1_024)
            for _ in 0..<9 { client?.urlProtocol(self, didLoad: chunk) }
        } else {
            client?.urlProtocol(self, didLoad: Self.report)
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { Self.state.lock.lock(); Self.state.stops += 1; Self.state.lock.unlock() }
}

private extension LoTWProtocolFixture.Mode {
    var isOverflow: Bool { if case .overflow = self { return true }; return false }
    var isDeclaredOverflow: Bool { if case .declaredOverflow = self { return true }; return false }
    var isStatus: Bool { if case .status = self { return true }; return false }
    var isHTML: Bool { if case .html = self { return true }; return false }
}

@Suite("LoTW manually invoked bounded transport", .serialized)
struct LoTWConfirmationTransportTests {
    private var transport: LoTWConfirmationTransport { .init(protocolClasses: [LoTWProtocolFixture.self]) }
    private func plan() throws -> LoTWConfirmationDownload { try .init(username: "OM0RX") }

    @Test func configurationIsEphemeralPrivateAndExactlyTimed() {
        let configuration = LoTWConfirmationTransport.configuration()
        #expect(configuration.urlCache == nil)
        #expect(configuration.httpCookieStorage == nil)
        #expect(configuration.urlCredentialStorage == nil)
        #expect(!configuration.httpShouldSetCookies)
        #expect(configuration.requestCachePolicy == .reloadIgnoringLocalCacheData)
        #expect(configuration.timeoutIntervalForRequest == 60)
        #expect(configuration.timeoutIntervalForResource == 60)
        LoTWProtocolFixture.state.reset(.report)
        _ = transport
        #expect(LoTWProtocolFixture.state.counts().0 == 0)
    }

    @Test func manualExecutionReturnsSanitizedEvidenceAndParsesReport() async throws {
        LoTWProtocolFixture.state.reset(.report)
        let plan = try plan()
        let response = try await transport.execute(plan, password: "local-fixture-secret")
        #expect(response.url == LoTWConfirmationDownload.endpoint)
        #expect(response.url.query == nil)
        #expect(response.body == LoTWProtocolFixture.report)
        #expect(response.statusCode == 200)
        #expect(response.contentType == "text/plain")
        #expect(response.redirectCount == 0)
        #expect(try plan.parseResponse(response).records.isEmpty)
        #expect(try await transport.download(plan, password: "local-fixture-secret").records.isEmpty)
        #expect(LoTWProtocolFixture.state.requestTimeout == 60)
    }

    @Test func refusesEveryRedirectBeforeSecondRequest() async throws {
        for destination in ["https://lotw.arrl.org/lotwuser/lotwreport.adi?password=fixture",
                            "https://foreign.invalid/steal?password=fixture"] {
            LoTWProtocolFixture.state.reset(.redirect(destination))
            await #expect(throws: LoTWConfirmationDownloadError.redirectRejected) {
                try await transport.execute(plan(), password: "local-fixture-secret")
            }
            #expect(LoTWProtocolFixture.state.counts().0 == 1)
        }
    }

    @Test func rejectsDeclaredAndStreamedOversizeBodies() async throws {
        for mode in [LoTWProtocolFixture.Mode.declaredOverflow, .overflow] {
            LoTWProtocolFixture.state.reset(mode)
            await #expect(throws: LoTWConfirmationDownloadError.oversizedResponse) {
                try await transport.execute(plan(), password: "local-fixture-secret")
            }
        }
    }

    @Test func validatesHTTPAndHTMLAndSanitizesNetworkFailure() async throws {
        LoTWProtocolFixture.state.reset(.status)
        await #expect(throws: LoTWConfirmationDownloadError.unsuccessfulStatus) {
            try await transport.download(plan(), password: "local-fixture-secret")
        }
        LoTWProtocolFixture.state.reset(.html)
        await #expect(throws: LoTWConfirmationDownloadError.htmlResponse) {
            try await transport.download(plan(), password: "local-fixture-secret")
        }
        LoTWProtocolFixture.state.reset(.failure)
        await #expect(throws: LoTWConfirmationTransportError.timedOut) {
            try await transport.execute(plan(), password: "local-fixture-secret")
        }
    }

    @Test func cancellationStopsAnActiveTransfer() async throws {
        LoTWProtocolFixture.state.reset(.stall)
        let plan = try plan()
        let transfer = transport
        let task = Task { try await transfer.execute(plan, password: "local-fixture-secret") }
        for _ in 0..<200 where LoTWProtocolFixture.state.counts().0 == 0 {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        #expect(LoTWProtocolFixture.state.counts().0 == 1)
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
        for _ in 0..<200 where LoTWProtocolFixture.state.counts().1 == 0 {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        #expect(LoTWProtocolFixture.state.counts().1 >= 1)
    }
}
