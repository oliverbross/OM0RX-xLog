import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

struct RTCScoreConfiguration: Sendable, Equatable {
    let sessionID: String
    let workspaceGeneration: String
    let service: String
    let endpoint: URL
    let username: String
    let intervalMinutes: Int
    let enabled: Bool
}

private final class RTCScoreHTTPTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let maximumResponseBytes = 16_384
    private let configuration: URLSessionConfiguration
    private let request: URLRequest
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Int, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var responseStatus: Int?
    private var responseBytes = 0
    private var finished = false

    init(configuration: URLSessionConfiguration, request: URLRequest) {
        self.configuration = configuration
        self.request = request
    }

    static func post(configuration: URLSessionConfiguration, request: URLRequest) async throws -> Int {
        let transfer = RTCScoreHTTPTransport(configuration: configuration, request: request)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { transfer.start($0) }
        } onCancel: { transfer.finish(.failure(CancellationError())) }
    }

    private func start(_ continuation: CheckedContinuation<Int, Error>) {
        lock.lock()
        self.continuation = continuation
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 15
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
        guard let http = response as? HTTPURLResponse, http.url?.scheme == "https",
              http.url?.host == request.url?.host,
              (200...299).contains(http.statusCode),
              http.expectedContentLength <= Int64(Self.maximumResponseBytes) else {
            completionHandler(.cancel)
            finish(.failure(WorkerFailure("rtc_http_rejected", "The score server did not accept this report.")))
            return
        }
        lock.withLock { responseStatus = http.statusCode }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let overflow = lock.withLock {
            responseBytes += data.count
            return responseBytes > Self.maximumResponseBytes
        }
        if overflow { finish(.failure(WorkerFailure("rtc_response_too_large", "The score server response exceeded the safety limit."))) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(error)); return }
        let status = lock.withLock { responseStatus }
        if let status { finish(.success(status)) }
        else { finish(.failure(WorkerFailure("rtc_response_invalid", "The score server response was invalid."))) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(WorkerFailure("rtc_redirect_rejected", "Score server redirects are not accepted.")))
    }

    private func finish(_ result: Result<Int, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = continuation, session = session
        self.continuation = nil; self.session = nil; task = nil
        lock.unlock()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }
}

actor RTCScoreReportingService {
    typealias CredentialLoader = @Sendable () throws -> String?
    typealias PayloadLoader = @Sendable (_ sessionID: String, _ workspaceGeneration: String) async throws -> String
    private let sessionConfiguration: URLSessionConfiguration
    private let credential: CredentialLoader
    private let payload: PayloadLoader
    private var configuration: RTCScoreConfiguration?
    private var timer: Task<Void, Never>?
    private var posting = false
    private var consecutiveFailures = 0
    private var lastOutcome = "Not sent yet."
    private var lastAttempt: Date?
    private var nextAttempt: Date?
    private var stopped = false

    init(sessionConfiguration: URLSessionConfiguration = .ephemeral,
         credential: @escaping CredentialLoader, payload: @escaping PayloadLoader) {
        self.sessionConfiguration = sessionConfiguration
        self.credential = credential
        self.payload = payload
    }

    func configure(_ value: RTCScoreConfiguration) throws -> [String: Any] {
        guard !stopped, Self.valid(value) else { throw WorkerFailure("rtc_configuration_invalid", "The score reporting configuration is invalid.") }
        guard !posting else { throw WorkerFailure("rtc_busy", "A score report is already in progress.") }
        if value.enabled, try credential()?.isEmpty != false {
            throw WorkerFailure("credential_required", "Save the scoreboard password before enabling reports.")
        }
        configuration = value
        timer?.cancel(); timer = nil; nextAttempt = nil; lastAttempt = nil; consecutiveFailures = 0
        lastOutcome = value.enabled ? "Scheduled; no score has been sent yet." : "Score reporting is disabled."
        if value.enabled { schedule(after: TimeInterval(value.intervalMinutes * 60)) }
        return status()
    }

    func sendNow() async throws -> [String: Any] {
        guard !stopped, let configuration else { throw WorkerFailure("rtc_not_configured", "Configure score reporting before sending.") }
        guard !posting else { throw WorkerFailure("rtc_busy", "A score report is already in progress.") }
        return try await post(configuration)
    }

    func status() -> [String: Any] {
        ["configured": configuration != nil, "enabled": configuration?.enabled == true,
         "service": configuration?.service as Any? ?? NSNull(), "username": configuration?.username as Any? ?? "",
         "interval_minutes": configuration?.intervalMinutes as Any? ?? 2, "posting": posting,
         "consecutive_failures": consecutiveFailures, "last_outcome": lastOutcome,
         "last_attempt": lastAttempt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull(),
         "next_attempt": nextAttempt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull()]
    }

    func terminate() { stopped = true; timer?.cancel(); timer = nil; nextAttempt = nil }

    private func schedule(after delay: TimeInterval) {
        guard !stopped, configuration?.enabled == true else { return }
        nextAttempt = Date().addingTimeInterval(delay)
        timer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.automaticPost()
        }
    }

    private func automaticPost() async {
        guard let configuration, configuration.enabled, !posting else { return }
        nextAttempt = nil
        do { _ = try await post(configuration) } catch { }
        guard !stopped, let current = self.configuration, current.enabled else { return }
        if consecutiveFailures >= 3 {
            self.configuration = RTCScoreConfiguration(sessionID: current.sessionID,
                workspaceGeneration: current.workspaceGeneration, service: current.service,
                endpoint: current.endpoint, username: current.username,
                intervalMinutes: current.intervalMinutes, enabled: false)
            nextAttempt = nil
            lastOutcome = "Paused after 3 consecutive failures. Review credentials and connection before enabling again."
        } else { schedule(after: TimeInterval(current.intervalMinutes * 60)) }
    }

    private func post(_ configuration: RTCScoreConfiguration) async throws -> [String: Any] {
        posting = true; lastAttempt = Date()
        defer { posting = false }
        do {
            guard let password = try credential(), !password.isEmpty else {
                throw WorkerFailure("credential_required", "The scoreboard password is not saved.")
            }
            let xml = try await payload(configuration.sessionID, configuration.workspaceGeneration)
            guard (1...65_536).contains(xml.utf8.count) else {
                throw WorkerFailure("rtc_payload_invalid", "The contest engine produced invalid score XML.")
            }
            var request = URLRequest(url: configuration.endpoint)
            request.httpMethod = "POST"
            request.httpBody = Data(xml.utf8)
            request.setValue("text/xml", forHTTPHeaderField: "Content-Type")
            let auth = Data("\(configuration.username):\(password)".utf8).base64EncodedString()
            request.setValue("Basic \(auth)", forHTTPHeaderField: "Authorization")
            let status = try await RTCScoreHTTPTransport.post(configuration: sessionConfiguration, request: request)
            guard self.configuration == configuration else {
                throw WorkerFailure("rtc_context_changed", "Score reporting changed before the post completed; its result was not applied.")
            }
            consecutiveFailures = 0
            lastOutcome = "Accepted by the score server (HTTP \(status))."
            return self.status()
        } catch {
            consecutiveFailures = min(3, consecutiveFailures + 1)
            lastOutcome = "Score report failed; no success was confirmed."
            throw error
        }
    }

    private static func valid(_ value: RTCScoreConfiguration) -> Bool {
        let endpoints = ["hamscore": "https://hamscore.com/postxml/",
                         "contestonlinescore": "https://contestonlinescore.com/post/"]
        return UUID(uuidString: value.sessionID) != nil && UUID(uuidString: value.workspaceGeneration) != nil &&
            endpoints[value.service] == value.endpoint.absoluteString && value.endpoint.scheme == "https" &&
            value.endpoint.user == nil && value.endpoint.password == nil && (1...60).contains(value.intervalMinutes) &&
            value.username.utf8.count <= 128 && (!value.enabled || !value.username.isEmpty) &&
            !value.username.contains(":") &&
            !value.username.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
}
