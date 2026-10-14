import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

public enum OnlineLogService: String, Codable, CaseIterable, Sendable {
    case qrz
}

public enum OnlineLogDeliveryState: String, Codable, Sendable {
    case dispatching
    case deferred
    case delivered
    case rejected
    case uncertain
}

public struct OnlineLogDeliveryPlan: Equatable, Sendable {
    public let service: OnlineLogService
    public let contact: LogbookContactSnapshot
    public let adif: String
    public let payloadSHA256: String

    public init(service: OnlineLogService, contact: LogbookContactSnapshot, adif: String) throws {
        guard contact.qso.deletedAt == nil, !adif.isEmpty, adif.utf8.count <= 65_536 else {
            throw OnlineLogDeliveryError.invalidPlan
        }
        self.service = service
        self.contact = contact
        self.adif = adif
        payloadSHA256 = Self.hash(Data(adif.utf8))
    }

    private static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

public struct OnlineLogDeliveryReceipt: Equatable, Sendable {
    public let service: OnlineLogService
    public let contactID: UUID
    public let contactRevision: Int64
    public let payloadSHA256: String
    public let state: OnlineLogDeliveryState
    public let attemptID: UUID
    public let attemptCount: Int
    public let lastAttemptAt: Date
    public let nextAttemptAt: Date?
    public let remoteID: String?
    public let safeErrorCode: String?
}

public struct OnlineLogDeliveryClaim: Equatable, Sendable {
    public let receipt: OnlineLogDeliveryReceipt
    /// False for a replayed or terminal claim. The caller must not issue I/O.
    public let shouldDispatch: Bool
}

public enum OnlineLogDeliveryResolution: Equatable, Sendable {
    case delivered(remoteID: String?)
    case rateLimited(retryAfter: Date?)
    case rejected(code: String)
    case uncertain(code: String)
}

public enum OnlineLogDeliveryError: Error, Equatable {
    case invalidPlan
    case staleContact
    case notDue
    case operationMismatch
    case deliveryUncertain
}

public struct OnlineLogEnrollmentStatus: Equatable, Sendable {
    public let service: OnlineLogService
    public let enabled: Bool
    public let enabledAt: Date?
    public let pendingNewContacts: Int
}

struct QRZLogbookHTTPResponse: Sendable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data
}

protocol QRZLogbookHTTPClient: Sendable {
    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> QRZLogbookHTTPResponse
}

/// One-record, upload-only QRZ transport. It never requests replacement,
/// deletion, status or fetch operations and never logs the access key/body.
public struct QRZLogbookTransport: Sendable {
    public static let endpoint = URL(string: "https://logbook.qrz.com/api")!
    private static let maximumResponseBytes = 8_192
    private let http: QRZLogbookHTTPClient
    private let userAgent: String

    public init(userAgent: String = "OM0RX-xLog/0.4") throws {
        try self.init(userAgent: userAgent, http: QRZLogbookURLSessionClient())
    }

    init(userAgent: String, http: QRZLogbookHTTPClient) throws {
        let agent = userAgent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !agent.isEmpty, agent.utf8.count <= 128,
              !agent.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw OnlineLogDeliveryError.invalidPlan
        }
        self.userAgent = agent
        self.http = http
    }

    public func insert(adif: String, accessKey: String, now: Date = Date()) async -> OnlineLogDeliveryResolution {
        let key = accessKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, key.utf8.count <= 256, key == accessKey,
              !key.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0) }),
              !adif.isEmpty, adif.utf8.count <= 65_536 else {
            return .rejected(code: "invalid_configuration")
        }
        let body = Self.formBody([
            ("KEY", key),
            ("ACTION", "INSERT"),
            ("ADIF", adif),
        ])
        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.httpBody = body
        request.setValue("application/x-www-form-urlencoded; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        do {
            let response = try await http.send(request, maximumResponseBytes: Self.maximumResponseBytes)
            if response.statusCode == 429 {
                return .rateLimited(retryAfter: Self.retryDate(headers: response.headers, now: now))
            }
            guard response.statusCode == 200,
                  let text = String(data: response.body, encoding: .utf8),
                  text.utf8.count <= Self.maximumResponseBytes,
                  let fields = Self.responseFields(text),
                  let result = fields["RESULT"]?.uppercased() else {
                return response.statusCode >= 400 && response.statusCode < 500
                    ? .rejected(code: "http_rejected") : .uncertain(code: "response_unknown")
            }
            switch result {
            case "OK":
                let remoteID = fields["LOGID"].flatMap { value in
                    value.utf8.count <= 64 && value.allSatisfy(\.isNumber) ? value : nil
                }
                return .delivered(remoteID: remoteID)
            case "AUTH": return .rejected(code: "authentication_rejected")
            case "FAIL": return .rejected(code: "provider_rejected")
            default: return .uncertain(code: "response_unknown")
            }
        } catch is CancellationError {
            return .uncertain(code: "cancelled_after_dispatch")
        } catch {
            return .uncertain(code: "transport_unknown")
        }
    }

    private static func responseFields(_ text: String) -> [String: String]? {
        guard !text.isEmpty, !text.contains("\n"), !text.contains("\r") else { return nil }
        var fields: [String: String] = [:]
        for part in text.split(separator: "&", omittingEmptySubsequences: false) {
            let pieces = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard pieces.count == 2,
                  let name = String(pieces[0]).removingPercentEncoding?.uppercased(),
                  let value = String(pieces[1]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding,
                  !name.isEmpty, name.utf8.count <= 32, value.utf8.count <= 4_096,
                  fields[name] == nil else { return nil }
            fields[name] = value
        }
        return fields
    }

    /// `URLComponents` follows generic URL query rules and leaves `+` literal.
    /// HTML form decoding treats that byte as a space, so encode from UTF-8
    /// bytes here to preserve every ADIF value exactly.
    private static func formBody(_ fields: [(String, String)]) -> Data {
        Data(fields.map { "\(formComponent($0.0))=\(formComponent($0.1))" }
            .joined(separator: "&").utf8)
    }

    private static func formComponent(_ value: String) -> String {
        let hex = Array("0123456789ABCDEF".utf8)
        var encoded: [UInt8] = []
        encoded.reserveCapacity(value.utf8.count)
        for byte in value.utf8 {
            switch byte {
            case 65...90, 97...122, 48...57, 45, 46, 95, 126:
                encoded.append(byte)
            case 32:
                encoded.append(43)
            default:
                encoded.append(37)
                encoded.append(hex[Int(byte >> 4)])
                encoded.append(hex[Int(byte & 0x0F)])
            }
        }
        return String(decoding: encoded, as: UTF8.self)
    }

    private static func retryDate(headers: [String: String], now: Date) -> Date? {
        let value = headers.first { $0.key.caseInsensitiveCompare("Retry-After") == .orderedSame }?.value
        guard let value, let seconds = TimeInterval(value), seconds.isFinite, seconds >= 0 else { return nil }
        return now.addingTimeInterval(min(seconds, 3_600))
    }
}

/// Coordinates the durable pre-dispatch claim with the non-idempotent provider.
/// An ambiguous request is never replayed automatically.
public struct QRZLogbookDeliveryCoordinator: Sendable {
    private let database: LogbookDatabase
    private let transport: QRZLogbookTransport

    public init(database: LogbookDatabase, transport: QRZLogbookTransport) {
        self.database = database
        self.transport = transport
    }

    public func deliver(contactID: UUID, accessKey: String, attemptID: UUID = UUID(), now: Date = Date()) async throws -> OnlineLogDeliveryReceipt {
        let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: contactID)
        let claim = try database.claimOnlineLogDelivery(plan, attemptID: attemptID, at: now)
        guard claim.shouldDispatch else {
            if claim.receipt.state == .dispatching || claim.receipt.state == .uncertain {
                throw OnlineLogDeliveryError.deliveryUncertain
            }
            return claim.receipt
        }
        let resolution = await transport.insert(adif: plan.adif, accessKey: accessKey, now: now)
        let receipt = try database.resolveOnlineLogDelivery(plan, attemptID: attemptID, resolution: resolution, at: now)
        if receipt.state == .uncertain { throw OnlineLogDeliveryError.deliveryUncertain }
        return receipt
    }
}

private final class QRZLogbookURLSessionClient: QRZLogbookHTTPClient, @unchecked Sendable {
    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> QRZLogbookHTTPResponse {
        guard request.url == QRZLogbookTransport.endpoint, request.httpMethod == "POST",
              (1...8_192).contains(maximumResponseBytes) else { throw OnlineLogDeliveryError.invalidPlan }
        let operation = Operation(request: request, maximum: maximumResponseBytes)
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { operation.start($0) }
        } onCancel: { operation.cancel() }
    }

    private final class Operation: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private let request: URLRequest
        private let maximum: Int
        private var session: URLSession?
        private var task: URLSessionDataTask?
        private var continuation: CheckedContinuation<QRZLogbookHTTPResponse, Error>?
        private var response: HTTPURLResponse?
        private var body = Data()
        private var failed = false
        private var cancelled = false

        init(request: URLRequest, maximum: Int) { self.request = request; self.maximum = maximum }

        func start(_ continuation: CheckedContinuation<QRZLogbookHTTPResponse, Error>) {
            lock.lock()
            if cancelled {
                lock.unlock(); continuation.resume(throwing: CancellationError()); return
            }
            self.continuation = continuation
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil; configuration.urlCredentialStorage = nil
            configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 30
            configuration.httpMaximumConnectionsPerHost = 1
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
            let task = lock.withLock { cancelled = true; return task }
            task?.cancel()
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            lock.withLock { failed = true }
            completionHandler(nil); task.cancel()
        }

        func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            if challenge.protectionSpace.authenticationMethod == "NSURLAuthenticationMethodServerTrust",
               challenge.protectionSpace.host == request.url?.host {
                completionHandler(.performDefaultHandling, nil)
            } else { completionHandler(.cancelAuthenticationChallenge, nil) }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            urlSession(session, didReceive: challenge, completionHandler: completionHandler)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            let accepted = lock.withLock {
                guard let http = response as? HTTPURLResponse, http.url == QRZLogbookTransport.endpoint,
                      http.expectedContentLength <= Int64(maximum) else { failed = true; return false }
                self.response = http; return true
            }
            completionHandler(accepted ? .allow : .cancel)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            let exceeded = lock.withLock {
                guard !failed, !cancelled, data.count <= maximum - body.count else { failed = true; return true }
                body.append(data); return false
            }
            if exceeded { dataTask.cancel() }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            lock.lock()
            guard let continuation else { lock.unlock(); return }
            self.continuation = nil
            let result: Result<QRZLogbookHTTPResponse, Error>
            if cancelled { result = .failure(CancellationError()) }
            else if failed || error != nil { result = .failure(OnlineLogDeliveryError.deliveryUncertain) }
            else if let response {
                let headers = response.allHeaderFields.reduce(into: [String: String]()) {
                    $0[String(describing: $1.key)] = String(describing: $1.value)
                }
                result = .success(QRZLogbookHTTPResponse(statusCode: response.statusCode, headers: headers, body: body))
            } else { result = .failure(OnlineLogDeliveryError.deliveryUncertain) }
            body = Data(); self.task = nil; self.session = nil
            lock.unlock()
            session.invalidateAndCancel()
            continuation.resume(with: result)
        }
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T { lock(); defer { unlock() }; return body() }
}
