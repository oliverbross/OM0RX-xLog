import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

struct ContestSCPProviderMetadata: Codable, Equatable, Sendable {
    let name: String
    let size: Int
    let etag: String
    let modified: String
}

struct ContestSCPProviderResult: Sendable {
    let metadata: ContestSCPProviderMetadata
    let modifiedAt: Date
    let bytes: Data?
}

enum ContestSCPProviderError: Error, Equatable {
    case invalidCatalog
    case invalidResponse
    case downloadTooLarge
}

enum ContestSCPProvider {
    static let catalogURL = URL(string: "https://www.supercheckpartial.com/api/v1/files")!
    static let masterURL = URL(string: "https://www.supercheckpartial.com/downloads/MASTER.SCP")!
    static let maximumCatalogBytes = 64 * 1_024
    static let maximumDatasetBytes = 16 * 1_024 * 1_024
    static var userAgent: String {
        let raw = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let version = raw.flatMap { value in
            value.utf8.count <= 32 && value.utf8.allSatisfy({ (45...57).contains($0) }) ? value : nil
        } ?? "development"
        return "OM0RX-xLog/\(version) SCP updater"
    }

    static func catalogEntry(from data: Data) throws -> (ContestSCPProviderMetadata, Date) {
        let entries = try JSONDecoder().decode([ContestSCPProviderMetadata].self, from: data)
        guard let entry = entries.first(where: { $0.name == "MASTER.SCP" }),
              entries.filter({ $0.name == "MASTER.SCP" }).count == 1,
              entry.size > 0, entry.size <= maximumDatasetBytes,
              entry.etag.utf8.count == 64,
              entry.etag.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let modified = modifiedDate(entry.modified) else {
            throw ContestSCPProviderError.invalidCatalog
        }
        return (entry, modified)
    }

    private static func modifiedDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    static func fetchLatest(ifNoneMatch: String?) async throws -> ContestSCPProviderResult {
        var catalogRequest = URLRequest(url: catalogURL)
        catalogRequest.httpMethod = "GET"
        catalogRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        catalogRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        let catalog = try await ContestSCPHTTPTransfer.fetch(catalogRequest, maximumBytes: maximumCatalogBytes,
                                                              acceptedStatusCodes: [200])
        guard catalog.response.mimeType?.lowercased() == "application/json" else {
            throw ContestSCPProviderError.invalidResponse
        }
        let (metadata, modifiedAt) = try catalogEntry(from: catalog.body)

        var downloadRequest = URLRequest(url: masterURL)
        downloadRequest.httpMethod = "GET"
        downloadRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        downloadRequest.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        if ifNoneMatch == metadata.etag {
            downloadRequest.setValue("\"\(metadata.etag)\"", forHTTPHeaderField: "If-None-Match")
        }
        let download = try await ContestSCPHTTPTransfer.fetch(downloadRequest, maximumBytes: maximumDatasetBytes,
                                                               acceptedStatusCodes: [200, 304])
        if download.response.statusCode == 304 {
            guard ifNoneMatch == metadata.etag, download.body.isEmpty else {
                throw ContestSCPProviderError.invalidResponse
            }
            return .init(metadata: metadata, modifiedAt: modifiedAt, bytes: nil)
        }
        let responseETag = download.response.value(forHTTPHeaderField: "ETag")?
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        guard download.body.count == metadata.size, responseETag == metadata.etag else {
            throw ContestSCPProviderError.invalidResponse
        }
        return .init(metadata: metadata, modifiedAt: modifiedAt, bytes: download.body)
    }
}

private final class ContestSCPHTTPTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    struct Response: @unchecked Sendable {
        let response: HTTPURLResponse
        let body: Data
    }

    private let request: URLRequest
    private let maximumBytes: Int
    private let acceptedStatusCodes: Set<Int>
    private let lock = NSLock()
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var continuation: CheckedContinuation<Response, Error>?
    private var response: HTTPURLResponse?
    private var body = Data()
    private var finished = false

    init(request: URLRequest, maximumBytes: Int, acceptedStatusCodes: Set<Int>) {
        self.request = request
        self.maximumBytes = maximumBytes
        self.acceptedStatusCodes = acceptedStatusCodes
    }

    static func fetch(_ request: URLRequest, maximumBytes: Int,
                      acceptedStatusCodes: Set<Int>) async throws -> Response {
        guard request.httpMethod == "GET", request.url?.scheme == "https",
              request.url?.host == "www.supercheckpartial.com",
              request.url?.user == nil, request.url?.password == nil,
              maximumBytes > 0, maximumBytes <= ContestSCPProvider.maximumDatasetBytes else {
            throw ContestSCPProviderError.invalidResponse
        }
        let transfer = ContestSCPHTTPTransfer(request: request, maximumBytes: maximumBytes,
                                              acceptedStatusCodes: acceptedStatusCodes)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { transfer.start($0) }
        } onCancel: {
            transfer.finish(.failure(CancellationError()))
        }
    }

    private func start(_ continuation: CheckedContinuation<Response, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.dataTask(with: request)
        self.session = session
        self.task = task
        lock.unlock()
        task.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse,
              acceptedStatusCodes.contains(http.statusCode),
              http.url == request.url,
              http.expectedContentLength <= Int64(maximumBytes) else {
            completionHandler(.cancel)
            finish(.failure(ContestSCPProviderError.invalidResponse))
            return
        }
        lock.withLock { self.response = http }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let overflow = lock.withLock {
            guard !finished else { return false }
            guard data.count <= maximumBytes - body.count else { return true }
            body.append(data)
            return false
        }
        if overflow { finish(.failure(ContestSCPProviderError.downloadTooLarge)) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(ContestSCPProviderError.invalidResponse))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(error)); return }
        let result: Result<Response, Error> = lock.withLock {
            guard let response else { return .failure(ContestSCPProviderError.invalidResponse) }
            return .success(.init(response: response, body: body))
        }
        finish(result)
    }

    private func finish(_ result: Result<Response, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let completion = continuation, activeSession = session
        continuation = nil
        session = nil
        task = nil
        body = Data()
        lock.unlock()
        activeSession?.invalidateAndCancel()
        completion?.resume(with: result)
    }
}
