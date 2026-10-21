import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import XLogPrototypeSupport

@Suite("RTC score reporting", .serialized)
struct RTCScoreReportingServiceTests {
    @Test("HTTPS post uses Basic auth and original XML through intercepted transport")
    func interceptedPost() async throws {
        RTCScoreFixture.reset(status: 204)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RTCScoreFixture.self]
        let sessionID = UUID().uuidString.lowercased(), workspace = UUID().uuidString.lowercased()
        let service = RTCScoreReportingService(sessionConfiguration: configuration,
            credential: { "fixture-password" }, payload: { session, generation in
                #expect(session == sessionID); #expect(generation == workspace)
                return "<?xml version=\"1.0\"?><dynamicresults><score>42</score></dynamicresults>"
            })
        _ = try await service.configure(.init(sessionID: sessionID, workspaceGeneration: workspace,
            service: "hamscore", endpoint: URL(string: "https://hamscore.com/postxml/")!,
            username: "OM0RX", intervalMinutes: 2, enabled: false))
        let status = try await service.sendNow()
        #expect(status["last_outcome"] as? String == "Accepted by the score server (HTTP 204).")
        let request = try #require(RTCScoreFixture.request())
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "text/xml")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Basic " + Data("OM0RX:fixture-password".utf8).base64EncodedString())
        #expect(String(data: RTCScoreFixture.body(), encoding: .utf8)?.contains("<score>42</score>") == true)
        await service.terminate()
    }

    @Test("Manual submission keeps the configured automatic schedule visible")
    func manualPostPreservesSchedule() async throws {
        RTCScoreFixture.reset(status: 204)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RTCScoreFixture.self]
        let service = RTCScoreReportingService(sessionConfiguration: configuration,
            credential: { "fixture-password" }, payload: { _,_ in "<dynamicresults/>" })
        _ = try await service.configure(.init(sessionID: UUID().uuidString,
            workspaceGeneration: UUID().uuidString, service: "hamscore",
            endpoint: URL(string: "https://hamscore.com/postxml/")!, username: "OM0RX",
            intervalMinutes: 1, enabled: true))
        let before = await service.status()["next_attempt"] as? String
        _ = try await service.sendNow()
        let after = await service.status()["next_attempt"] as? String
        #expect(before != nil)
        #expect(after == before)
        await service.terminate()
    }

    @Test("Only pinned HTTPS services are admitted and credentials are required before scheduling")
    func admission() async throws {
        let sessionID = UUID().uuidString.lowercased(), workspace = UUID().uuidString.lowercased()
        let missing = RTCScoreReportingService(credential: { nil }, payload: { _,_ in "<dynamicresults/>" })
        await #expect(throws: WorkerFailure.self) {
            try await missing.configure(.init(sessionID: sessionID, workspaceGeneration: workspace,
                service: "hamscore", endpoint: URL(string: "https://hamscore.com/postxml/")!,
                username: "OM0RX", intervalMinutes: 2, enabled: true))
        }
        let service = RTCScoreReportingService(credential: { "secret" }, payload: { _,_ in "<dynamicresults/>" })
        await #expect(throws: WorkerFailure.self) {
            try await service.configure(.init(sessionID: sessionID, workspaceGeneration: workspace,
                service: "contest-run", endpoint: URL(string: "http://contest.run")!,
                username: "OM0RX", intervalMinutes: 2, enabled: false))
        }
        await #expect(throws: WorkerFailure.self) {
            try await service.configure(.init(sessionID: sessionID, workspaceGeneration: workspace,
                service: "hamscore", endpoint: URL(string: "https://hamscore.com/postxml/")!,
                username: "OM0RX:other", intervalMinutes: 2, enabled: false))
        }
    }

    @Test("A failed post is not retried immediately and the visible failure count is bounded")
    func boundedFailures() async throws {
        RTCScoreFixture.reset(status: 503)
        let urlConfiguration = URLSessionConfiguration.ephemeral
        urlConfiguration.protocolClasses = [RTCScoreFixture.self]
        let service = RTCScoreReportingService(sessionConfiguration: urlConfiguration,
            credential: { "secret" }, payload: { _,_ in "<dynamicresults/>" })
        _ = try await service.configure(.init(sessionID: UUID().uuidString, workspaceGeneration: UUID().uuidString,
            service: "hamscore", endpoint: URL(string: "https://hamscore.com/postxml/")!,
            username: "OM0RX", intervalMinutes: 2, enabled: false))
        for _ in 0..<4 {
            await #expect(throws: Error.self) { try await service.sendNow() }
        }
        let status = await service.status()
        #expect(status["consecutive_failures"] as? Int == 3)
        #expect(RTCScoreFixture.requestCount() == 4)
        await service.terminate()
    }
}

private final class RTCScoreFixture: URLProtocol {
    private static let lock = NSLock()
    private static var captured: URLRequest?
    private static var capturedBody = Data()
    private static var requests = 0
    private static var responseStatus = 204
    static func reset(status: Int) { lock.withLock { captured = nil; capturedBody = Data(); requests = 0; responseStatus = status } }
    static func request() -> URLRequest? { lock.withLock { captured } }
    static func body() -> Data { lock.withLock { capturedBody } }
    static func requestCount() -> Int { lock.withLock { requests } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                body.append(buffer, count: count)
            }
        }
        let status = Self.lock.withLock {
            Self.captured = request
            Self.capturedBody = body
            Self.requests += 1
            return Self.responseStatus
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type":"text/plain", "Content-Length":"0"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
