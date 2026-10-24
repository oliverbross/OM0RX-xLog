import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import XLogPrototypeSupport

@Suite("Portable bounded public feed transport")
struct OpportunityDownloadTests {
    private func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OpportunityHTTPFixture.self]
        return config
    }

    private func request(_ path: String) -> URLRequest {
        URLRequest(url: URL(string: "https://fixture.invalid/\(path)")!)
    }

    @Test("JSON is collected in bounded chunks, including an unknown content length")
    func validBody() async throws {
        for path in ["valid", "unknown-length", "vendor-json"] {
            let body = try await OpportunityDownload.fetch(request(path), configuration: configuration())
            #expect(body == Data("[{\"value\":1}]".utf8))
        }
        let html = try await OpportunityDownload.fetch(request("html"), configuration: configuration(), format: .html, byteLimit: 32)
        #expect(html == Data("[{\"value\":1}]".utf8))
    }

    @Test("HTTP, content type, origin and declared/streamed body limits fail closed")
    func invalidResponses() async {
        for path in ["status", "html", "wrong-origin", "insecure", "large-header", "overflow"] {
            do {
                _ = try await OpportunityDownload.fetch(request(path), configuration: configuration())
                Issue.record("Expected rejection for \(path)")
            } catch { }
        }
        for url in ["http://fixture.invalid/feed", "https://user:secret@fixture.invalid/feed"] {
            do {
                _ = try await OpportunityDownload.fetch(URLRequest(url: URL(string: url)!), configuration: configuration())
                Issue.record("Expected rejection of an unsafe request")
            } catch { }
        }
    }

    @Test("Public conditions opt into XML and a smaller streaming limit without weakening JSON feeds")
    func conditionLimits() async throws {
        let xml = try await OpportunityDownload.fetch(request("xml"), configuration: configuration(), format: .xml, byteLimit: 32)
        #expect(xml == Data("<solar/>".utf8))
        for (path, format, limit) in [("xml", OpportunityDownload.Format.json, 32),
                                     ("valid", .xml, 32), ("valid", .json, 5),
                                     ("unknown-length", .json, 5), ("xml", .xml, 4)] {
            do {
                _ = try await OpportunityDownload.fetch(request(path), configuration: configuration(), format: format, byteLimit: limit)
                Issue.record("Invalid type or oversized conditions body was accepted")
            } catch { }
        }
    }

    @Test("Cancellation before and during transfer completes without waiting for a body")
    func cancellation() async {
        let before = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await OpportunityDownload.fetch(request("hang"), configuration: configuration())
        }
        do { _ = try await before.value; Issue.record("Cancelled transfer succeeded") }
        catch { #expect(error is CancellationError) }

        let during = Task { try await OpportunityDownload.fetch(request("hang"), configuration: configuration()) }
        try? await Task.sleep(nanoseconds: 20_000_000)
        during.cancel()
        do { _ = try await during.value; Issue.record("Cancelled transfer succeeded") }
        catch { #expect(error is CancellationError) }
    }

    @Test("The redirect delegate never follows either same-host or cross-host redirects")
    func redirects() throws {
        let original = request("valid")
        let config = configuration()
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        for target in ["https://fixture.invalid/elsewhere", "https://other.invalid/feed"] {
            let transfer = OpportunityDownload(request: original, configuration: config)
            let response = try #require(HTTPURLResponse(url: original.url!, statusCode: 302,
                httpVersion: nil, headerFields: ["Location": target]))
            let task = session.dataTask(with: original) // Never resumed; no network request.
            var called = false
            transfer.urlSession(session, task: task, willPerformHTTPRedirection: response,
                newRequest: URLRequest(url: URL(string: target)!)) { next in
                called = true
                #expect(next == nil)
            }
            #expect(called)
        }
    }
}

private final class OpportunityHTTPFixture: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let kind = url.lastPathComponent
        var headers = ["Content-Type": kind == "xml" ? "text/xml" : kind == "html" ? "text/html" :
                       kind == "vendor-json" ? "application/feed+json" : "application/json"]
        if kind == "large-header" { headers["Content-Length"] = String(OpportunityDownload.maximumBytes + 1) }
        if kind == "valid" { headers["Content-Length"] = "13" }
        let responseURL = kind == "wrong-origin" ? URL(string: "https://other.invalid/feed")! :
            kind == "insecure" ? URL(string: "http://fixture.invalid/feed")! : url
        let response = HTTPURLResponse(url: responseURL, statusCode: kind == "status" ? 503 : 200,
                                       httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if kind == "hang" { return }
        if kind == "xml" {
            client?.urlProtocol(self, didLoad: Data("<solar/>".utf8))
        } else if kind == "overflow" {
            client?.urlProtocol(self, didLoad: Data(repeating: 32, count: OpportunityDownload.maximumBytes))
            client?.urlProtocol(self, didLoad: Data([32]))
        } else {
            client?.urlProtocol(self, didLoad: Data("[{\"value\":".utf8))
            client?.urlProtocol(self, didLoad: Data("1}]".utf8))
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
