import Foundation
import Testing
@testable import XLogCore

private final class ConditionalReferenceURLProtocol: URLProtocol, @unchecked Sendable {
    struct RequestHeaders: Equatable {
        var ifNoneMatch: String?
        var ifModifiedSince: String?
    }

    private static let lock = NSLock()
    private static var requestHeaders: [RequestHeaders] = []

    static func reset() {
        lock.lock()
        requestHeaders = []
        lock.unlock()
    }

    static func headers() -> [RequestHeaders] {
        lock.lock()
        defer { lock.unlock() }
        return requestHeaders
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let headers = RequestHeaders(
            ifNoneMatch: request.value(forHTTPHeaderField: "If-None-Match"),
            ifModifiedSince: request.value(forHTTPHeaderField: "If-Modified-Since")
        )
        let requestIndex: Int = Self.lock.withLock {
            Self.requestHeaders.append(headers)
            return Self.requestHeaders.count - 1
        }

        let statusCode: Int
        let body: Data
        let responseHeaders: [String: String]
        switch requestIndex {
        case 0:
            statusCode = 200
            body = Self.validPOTAPayload
            responseHeaders = [
                "Content-Type": "text/csv",
                "ETag": "\"pota-v1\"",
                "Last-Modified": "Sat, 10 Oct 2026 10:00:00 GMT",
            ]
        case 1:
            statusCode = 304
            body = Data()
            responseHeaders = [:]
        default:
            statusCode = 200
            body = Data(repeating: 0x78, count: 20_000)
            responseHeaders = ["ETag": "\"pota-corrupt\""]
        }

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: responseHeaders
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !body.isEmpty { client?.urlProtocol(self, didLoad: body) }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static let validPOTAPayload: Data = {
        var text = "reference,name,locationDesc,latitude,longitude,grid,active\n"
        for index in 0..<10_000 {
            text += "US-\(String(format: "%04d", index)),Park \(index),United States,40.0,-75.0,FN20,1\n"
        }
        return Data(text.utf8)
    }()
}

@Suite("Reference data updater")
struct ReferenceDataUpdaterTests {
    @Test("Conditional activation refresh preserves validated cache and rejects corrupt replacements")
    func conditionalActivationRefresh() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }

        ConditionalReferenceURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ConditionalReferenceURLProtocol.self]
        let updater = try ReferenceDataUpdater(
            directory: directory,
            session: URLSession(configuration: configuration)
        )

        let first = try await updater.refreshActivationDirectory(.pota)
        #expect(first.activationCounts[ActivationReferenceKind.pota.rawValue] == 10_000)
        #expect(first.validators[ActivationReferenceKind.pota.fileName]?.eTag == "\"pota-v1\"")
        #expect(first.validators[ActivationReferenceKind.pota.fileName]?.lastModified == "Sat, 10 Oct 2026 10:00:00 GMT")

        let cacheURL = directory.appendingPathComponent(ActivationReferenceKind.pota.fileName)
        let originalCache = try Data(contentsOf: cacheURL)
        let second = try await updater.refreshActivationDirectory(.pota)
        let headers = ConditionalReferenceURLProtocol.headers()
        #expect(headers.count == 2)
        #expect(headers[1].ifNoneMatch == "\"pota-v1\"")
        #expect(headers[1].ifModifiedSince == "Sat, 10 Oct 2026 10:00:00 GMT")
        #expect(second.activationCounts[ActivationReferenceKind.pota.rawValue] == 10_000)
        #expect(try Data(contentsOf: cacheURL) == originalCache)

        var rejectedCorruptReplacement = false
        do {
            _ = try await updater.refreshActivationDirectory(.pota)
        } catch {
            rejectedCorruptReplacement = true
        }
        #expect(rejectedCorruptReplacement)
        #expect(try Data(contentsOf: cacheURL) == originalCache)
        #expect(await updater.currentState() == second)
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock(); defer { unlock() }
        return body()
    }
}
