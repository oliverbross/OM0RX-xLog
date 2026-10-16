import Foundation

public enum LoTWConfirmationTransportError: Error, Equatable, Sendable {
    case invalidResponse, timedOut, transportFailure
}

/// Caller-owned, manual execution only. Construction never starts a request.
public struct LoTWConfirmationTransport: Sendable {
    public static let timeout: TimeInterval = 60
    private let protocolClasses: [AnyClass]?

    public init() { protocolClasses = nil }
    // Internal injection is restricted to protocol fixtures; production callers
    // cannot supply a shared session with cookies, caches or redirect behavior.
    init(protocolClasses: [AnyClass]) { self.protocolClasses = protocolClasses }

    static func configuration(protocolClasses: [AnyClass]? = nil) -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        if let protocolClasses { configuration.protocolClasses = protocolClasses }
        return configuration
    }

    /// Returns only sanitized endpoint evidence. Neither raw URLSession errors nor
    /// credential-bearing request URLs escape this owner as diagnostics.
    public func execute(_ plan: LoTWConfirmationDownload, password: String) async throws -> LoTWConfirmationDownloadResponse {
        try Task.checkCancellation()
        var request = try plan.makeURLRequest(password: password)
        request.timeoutInterval = Self.timeout
        request.httpShouldHandleCookies = false
        let owner = LoTWConfirmationTransfer()
        let configuration = Self.configuration(protocolClasses: protocolClasses)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                owner.start(request: request, configuration: configuration, continuation: continuation)
            }
        } onCancel: {
            owner.cancel()
        }
    }

    public func download(_ plan: LoTWConfirmationDownload, password: String) async throws -> LoTWConfirmationReport {
        let response = try await execute(plan, password: password)
        try Task.checkCancellation()
        return try plan.parseResponse(response)
    }
}

/// All mutable state is protected by `lock`, including cancellation racing with
/// task creation. URLSession owns the delegate until invalidation completes.
final class LoTWConfirmationTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private var continuation: CheckedContinuation<LoTWConfirmationDownloadResponse, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var statusCode: Int?
    private var contentType: String?
    private var body = Data()

    func start(request: URLRequest, configuration: URLSessionConfiguration,
               continuation: CheckedContinuation<LoTWConfirmationDownloadResponse, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        self.session = session
        let task = session.dataTask(with: request)
        self.task = task
        lock.unlock()
        task.resume()
    }

    func cancel() { finish(.failure(CancellationError())) }

    private func finish(_ result: Result<LoTWConfirmationDownloadResponse, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = self.continuation
        self.continuation = nil
        let session = self.session
        self.session = nil
        self.task = nil
        body.removeAll(keepingCapacity: false)
        lock.unlock()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Refuse before URLSession can send anything to the redirect destination,
        // including a second request to the same trusted origin.
        completionHandler(nil)
        finish(.failure(LoTWConfirmationDownloadError.redirectRejected))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, let url = http.url,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            completionHandler(.cancel)
            finish(.failure(LoTWConfirmationTransportError.invalidResponse))
            return
        }
        components.query = nil
        guard components.url == LoTWConfirmationDownload.endpoint else {
            completionHandler(.cancel)
            finish(.failure(LoTWConfirmationDownloadError.unexpectedEndpoint))
            return
        }
        guard (200..<300).contains(http.statusCode) else {
            completionHandler(.cancel)
            finish(.failure(LoTWConfirmationDownloadError.unsuccessfulStatus))
            return
        }
        guard response.expectedContentLength <= Int64(LoTWConfirmationReportParser.maximumInputBytes) else {
            completionHandler(.cancel)
            finish(.failure(LoTWConfirmationDownloadError.oversizedResponse))
            return
        }
        lock.lock()
        statusCode = http.statusCode
        contentType = http.value(forHTTPHeaderField: "Content-Type")
        let isFinished = finished
        lock.unlock()
        completionHandler(isFinished ? .cancel : .allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= LoTWConfirmationReportParser.maximumInputBytes - body.count else {
            lock.unlock()
            finish(.failure(LoTWConfirmationDownloadError.oversizedResponse))
            return
        }
        body.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error as NSError? {
            if error.domain == NSURLErrorDomain && error.code == NSURLErrorTimedOut {
                finish(.failure(LoTWConfirmationTransportError.timedOut))
            } else {
                finish(.failure(LoTWConfirmationTransportError.transportFailure))
            }
            return
        }
        lock.lock()
        let response = statusCode.map {
            LoTWConfirmationDownloadResponse(url: LoTWConfirmationDownload.endpoint, statusCode: $0,
                contentType: contentType, redirectCount: 0, body: body)
        }
        lock.unlock()
        if let response { finish(.success(response)) }
        else { finish(.failure(LoTWConfirmationTransportError.invalidResponse)) }
    }
}
