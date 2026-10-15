import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Ephemeral bounded Microsoft Graph/OneDrive transport. Bearer credentials are
/// accepted only on graph.microsoft.com routes; upload/download capability URLs
/// are HTTPS-only and receive no Authorization header.
public final class OneDriveBackupURLSessionClient: OneDriveBackupHTTPClient, @unchecked Sendable {
    private let protocolClasses: [AnyClass]?
    public init() { protocolClasses = nil }
    internal init(protocolClasses: [AnyClass]) { self.protocolClasses = protocolClasses }

    public func send(_ request: URLRequest,
                     maximumResponseBytes: Int) async throws -> OneDriveBackupHTTPResponse {
        guard OneDriveBackupTransport.allows(request),
              (1...OneDriveBackupTransport.maximumPackageBytes).contains(maximumResponseBytes) else {
            throw OneDriveBackupError.invalidDestination
        }
        var bounded = request
        bounded.timeoutInterval = 30
        let operation = Operation(request: bounded, maximum: maximumResponseBytes,
            protocolClasses: protocolClasses)
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { operation.start($0) }
        } onCancel: { operation.cancel() }
    }

    private final class Operation: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private let request: URLRequest
        private let maximum: Int
        private let protocolClasses: [AnyClass]?
        private var session: URLSession?
        private var task: URLSessionDataTask?
        private var continuation: CheckedContinuation<OneDriveBackupHTTPResponse, Error>?
        private var response: HTTPURLResponse?
        private var body = Data()
        private var failure: OneDriveBackupError?
        private var cancelled = false

        init(request: URLRequest, maximum: Int, protocolClasses: [AnyClass]?) {
            self.request = request; self.maximum = maximum; self.protocolClasses = protocolClasses
        }

        func start(_ continuation: CheckedContinuation<OneDriveBackupHTTPResponse, Error>) {
            lock.lock()
            if cancelled {
                lock.unlock(); continuation.resume(throwing: CancellationError()); return
            }
            self.continuation = continuation
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            configuration.urlCredentialStorage = nil
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 180
            configuration.httpMaximumConnectionsPerHost = 1
            if let protocolClasses { configuration.protocolClasses = protocolClasses }
            #if canImport(Darwin)
            configuration.waitsForConnectivity = false
            configuration.tlsMinimumSupportedProtocolVersion = .TLSv12
            #endif
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            self.session = session
            let task = session.dataTask(with: request)
            self.task = task
            lock.unlock()
            task.resume()
        }

        func cancel() {
            let current = lock.withLock { cancelled = true; return task }
            current?.cancel()
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            lock.withLock { failure = .redirectRejected }
            completionHandler(nil)
            task.cancel()
        }

        func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            if challenge.protectionSpace.authenticationMethod == "NSURLAuthenticationMethodServerTrust",
               challenge.protectionSpace.host == request.url?.host {
                completionHandler(.performDefaultHandling, nil)
            } else {
                completionHandler(.cancelAuthenticationChallenge, nil)
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            urlSession(session, didReceive: challenge, completionHandler: completionHandler)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                        didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            let accepted = lock.withLock {
                guard let http = response as? HTTPURLResponse, http.url == request.url else {
                    failure = .invalidResponse; return false
                }
                let headerBytes = http.allHeaderFields.reduce(0) {
                    $0 + String(describing: $1.key).utf8.count + String(describing: $1.value).utf8.count
                }
                guard headerBytes <= OneDriveBackupTransport.maximumMetadataBytes,
                      http.expectedContentLength <= Int64(maximum) else {
                    failure = .responseTooLarge; return false
                }
                self.response = http
                return true
            }
            completionHandler(accepted ? .allow : .cancel)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            let exceeded = lock.withLock {
                guard failure == nil, !cancelled else { return true }
                guard data.count <= maximum - body.count else {
                    failure = .responseTooLarge; return true
                }
                body.append(data)
                return false
            }
            if exceeded { dataTask.cancel() }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        didCompleteWithError error: Error?) {
            lock.lock()
            guard let continuation else { lock.unlock(); return }
            self.continuation = nil
            let result: Result<OneDriveBackupHTTPResponse, Error>
            if cancelled { result = .failure(CancellationError()) }
            else if let failure { result = .failure(failure) }
            else if error != nil { result = .failure(OneDriveBackupError.requestFailed) }
            else if let response, let url = response.url {
                let headers = response.allHeaderFields.reduce(into: [String: String]()) {
                    $0[String(describing: $1.key)] = String(describing: $1.value)
                }
                result = .success(OneDriveBackupHTTPResponse(url: url,
                    statusCode: response.statusCode, headers: headers, body: body))
            } else { result = .failure(OneDriveBackupError.invalidResponse) }
            body = Data(); self.task = nil; self.session = nil
            lock.unlock()
            session.invalidateAndCancel()
            continuation.resume(with: result)
        }
    }
}
