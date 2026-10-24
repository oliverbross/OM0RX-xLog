import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// FoundationNetworking has no AsyncBytes API. Use the same bounded delegate
/// transport on every OS rather than buffering an unbounded body on portable OSes.
final class OpportunityDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let maximumBytes = 2_097_152
    enum Format: Sendable { case json, xml, html }
    private let format: Format
    private let byteLimit: Int
    private let lock = NSLock()
    private let request: URLRequest
    private let configuration: URLSessionConfiguration
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var continuation: CheckedContinuation<Data, Error>?
    private var finished = false
    private var responseAccepted = false
    private var body = Data()

    init(request: URLRequest, configuration: URLSessionConfiguration, format: Format = .json, byteLimit: Int = maximumBytes) {
        self.request = request
        self.configuration = configuration
        self.format = format
        self.byteLimit = max(1, min(Self.maximumBytes, byteLimit))
    }

    static func fetch(_ request: URLRequest, configuration: URLSessionConfiguration, format: Format = .json,
                      byteLimit: Int = maximumBytes) async throws -> Data {
        guard request.url?.scheme == "https", request.url?.user == nil,
              request.url?.password == nil, request.httpMethod == "GET" else {
            throw WorkerFailure("invalid_feed", "Public feeds require an HTTPS GET request.")
        }
        let transfer = OpportunityDownload(request: request, configuration: configuration, format: format, byteLimit: byteLimit)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { transfer.start($0) }
        } onCancel: {
            transfer.finish(.failure(CancellationError()))
        }
    }

    private func start(_ continuation: CheckedContinuation<Data, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForResource = 20
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
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url?.scheme == "https", http.url?.host == request.url?.host,
              let mime = http.mimeType?.lowercased(),
              accepts(mime),
              http.expectedContentLength <= Int64(byteLimit) else {
            completionHandler(.cancel)
            finish(.failure(WorkerFailure("invalid_feed", "Public feed response was invalid.")))
            return
        }
        lock.withLock { responseAccepted = true }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let overflow = lock.withLock {
            guard !finished else { return false }
            guard data.count <= byteLimit - body.count else { return true }
            body.append(data)
            return false
        }
        if overflow { finish(.failure(WorkerFailure("feed_too_large", "Public feed exceeded the download limit."))) }
    }

    private func accepts(_ mime: String) -> Bool {
        switch format {
        case .json: return mime == "application/json" || mime == "text/json" ||
            (mime.hasPrefix("application/") && mime.hasSuffix("+json"))
        case .xml: return mime == "application/xml" || mime == "text/xml" ||
            (mime.hasPrefix("application/") && mime.hasSuffix("+xml"))
        case .html: return mime == "text/html" || mime == "application/xhtml+xml" || mime == "text/plain"
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(error)) }
        else {
            let result: Result<Data, Error> = lock.withLock {
                responseAccepted ? .success(body) :
                    .failure(WorkerFailure("invalid_feed", "Public feed response was missing."))
            }
            finish(result)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(WorkerFailure("feed_redirect", "Public feed redirects are not accepted.")))
    }

    private func finish(_ result: Result<Data, Error>) {
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
