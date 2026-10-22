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
        RTCScoreFixture.reset(status: 200, responseBody: Data(#"{"status":200,"status_message":"OK-Full"}"#.utf8))
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
        #expect(status["last_outcome"] as? String == "Accepted by the score server (HTTP 200): OK-Full.")
        let request = try #require(RTCScoreFixture.request())
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/xml")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Basic " + Data("OM0RX:fixture-password".utf8).base64EncodedString())
        #expect(String(data: RTCScoreFixture.body(), encoding: .utf8)?.contains("<score>42</score>") == true)
        await service.terminate()
    }

    @Test("Manual submission keeps the configured automatic schedule visible")
    func manualPostPreservesSchedule() async throws {
        RTCScoreFixture.reset(status: 200, responseBody: Data(#"{"status":200,"status_message":"OK-Full"}"#.utf8))
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

    @Test("HTTP success with provider rejection is not reported as accepted")
    func providerRejection() async throws {
        RTCScoreFixture.reset(status: 200,
            responseBody: Data(#"{"status":405,"status_message":"Error! Empty call\nretry"}"#.utf8))
        let service = makeService()
        try await configure(service)
        do {
            _ = try await service.sendNow()
            Issue.record("Provider rejection should fail")
        } catch let error as WorkerFailure {
            #expect(error.code == "rtc_application_rejected")
            #expect(error.message == "Error! Empty call retry")
        }
        #expect(await service.status()["last_outcome"] as? String == "Score server rejected the report: Error! Empty call retry")
        await service.terminate()
    }

    @Test("Malformed and oversized responses fail closed")
    func invalidResponses() async throws {
        for body in [Data("not-json".utf8), Data(repeating: 65, count: 16_385)] {
            RTCScoreFixture.reset(status: 200, responseBody: body)
            let service = makeService()
            try await configure(service)
            await #expect(throws: Error.self) { try await service.sendNow() }
            await service.terminate()
        }
    }

    @Test("Redirects are rejected without following the new location")
    func redirectRejected() async throws {
        RTCScoreFixture.reset(status: 302, responseBody: Data(), redirect: true)
        let service = makeService()
        try await configure(service)
        await #expect(throws: Error.self) { try await service.sendNow() }
        #expect(RTCScoreFixture.requestCount() == 1)
        await service.terminate()
    }

    @Test("Termination cancels a manual post without applying a result")
    func terminationCancelsManualPost() async throws {
        let probe = RTCScoreFixture.reset(status: 200, responseBody: Data(), suspended: true)
        let urlConfiguration = URLSessionConfiguration.ephemeral
        urlConfiguration.protocolClasses = [RTCScoreFixture.self]
        let service = RTCScoreReportingService(sessionConfiguration: urlConfiguration,
            credential: { "secret" }, payload: { _,_ in "<dynamicresults/>" })
        _ = try await service.configure(.init(sessionID: UUID().uuidString, workspaceGeneration: UUID().uuidString,
            service: "hamscore", endpoint: URL(string: "https://hamscore.com/postxml/")!,
            username: "OM0RX", intervalMinutes: 2, enabled: false))
        let before = await service.status()
        let submission = Task { try await service.sendNow() }
        #expect(await signaled(probe.started))
        #expect(RTCScoreFixture.requestCount() == 1)

        await service.terminate()
        await #expect(throws: Error.self) { try await submission.value }
        let after = await service.status()
        #expect(after["posting"] as? Bool == false)
        #expect(after["consecutive_failures"] as? Int == before["consecutive_failures"] as? Int)
        #expect(after["last_outcome"] as? String == before["last_outcome"] as? String)
        #expect(await signaled(probe.cancelled))
        #expect(RTCScoreFixture.cancellationCount() == 1)
    }

    private func signaled(_ semaphore: DispatchSemaphore) async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: semaphore.wait(timeout: .now() + 2) == .success)
            }
        }
    }


    private func makeService() -> RTCScoreReportingService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RTCScoreFixture.self]
        return RTCScoreReportingService(sessionConfiguration: configuration,
            credential: { "secret" }, payload: { _,_ in "<dynamicresults/>" })
    }

    private func configure(_ service: RTCScoreReportingService) async throws {
        _ = try await service.configure(.init(sessionID: UUID().uuidString, workspaceGeneration: UUID().uuidString,
            service: "hamscore", endpoint: URL(string: "https://hamscore.com/postxml/")!,
            username: "OM0RX", intervalMinutes: 2, enabled: false))
    }
}

private final class RTCScoreFixtureProbe: @unchecked Sendable {
    let started = DispatchSemaphore(value: 0)
    let cancelled = DispatchSemaphore(value: 0)
}

private final class RTCScoreFixture: URLProtocol {
    private var didRecordCancellation = false
    private var eventProbe: RTCScoreFixtureProbe?
    private static let lock = NSLock()
    private static var captured: URLRequest?
    private static var capturedBody = Data()
    private static var requests = 0
    private static var responseStatus = 204
    private static var responseBody = Data()
    private static var redirect = false
    private static var suspended = false
    private static var cancellations = 0
    private static var probe = RTCScoreFixtureProbe()
    @discardableResult
    static func reset(status: Int, responseBody: Data = Data(), suspended: Bool = false,
                      redirect: Bool = false) -> RTCScoreFixtureProbe {
        let newProbe = RTCScoreFixtureProbe()
        lock.withLock {
            captured = nil; capturedBody = Data(); requests = 0; responseStatus = status
            self.responseBody = responseBody; self.suspended = suspended
            self.redirect = redirect; cancellations = 0; probe = newProbe
        }
        return newProbe
    }
    static func request() -> URLRequest? { lock.withLock { captured } }
    static func body() -> Data { lock.withLock { capturedBody } }
    static func requestCount() -> Int { lock.withLock { requests } }
    static func cancellationCount() -> Int { lock.withLock { cancellations } }
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
        let (status, responseBody, suspended, redirect, probe) = Self.lock.withLock {
            Self.captured = request
            Self.capturedBody = body
            Self.requests += 1
            eventProbe = Self.probe
            return (Self.responseStatus, Self.responseBody, Self.suspended, Self.redirect, Self.probe)
        }
        probe.started.signal()
        if suspended { return }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type":"application/json"])!
        if redirect {
            let redirected = URLRequest(url: URL(string: "https://example.invalid/rejected")!)
            client?.urlProtocol(self, wasRedirectedTo: redirected, redirectResponse: response)
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !responseBody.isEmpty { client?.urlProtocol(self, didLoad: responseBody) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {
        let probe = Self.lock.withLock { () -> RTCScoreFixtureProbe? in
            guard !didRecordCancellation else { return nil }
            didRecordCancellation = true
            guard let eventProbe, eventProbe === Self.probe else { return nil }
            Self.cancellations += 1
            return eventProbe
        }
        probe?.cancelled.signal()
    }
}
