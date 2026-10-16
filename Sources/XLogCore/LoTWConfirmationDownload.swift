import Foundation

/// Credential-free diagnostics for the fixed-origin report contract.
public enum LoTWConfirmationDownloadError: Error, Equatable, Sendable {
    case invalidUsername, emptyPassword, invalidWatermark
    case unexpectedEndpoint, redirectRejected, unsuccessfulStatus, oversizedResponse, htmlResponse, invalidEncoding
}

/// A pure request plan. This performs no network access and retains no password.
/// Contract: https://lotw.arrl.org/lotw-help/developer-query-qsos-qsls/
public struct LoTWConfirmationDownload: Equatable, Sendable {
    public static let endpoint = URL(string: "https://lotw.arrl.org/lotwuser/lotwreport.adi")!
    public let username: String
    /// Inclusive, report-scoped continuation; never add a second to LASTQSL.
    public let qslSince: String?

    public init(username: String, qslSince: String? = nil) throws {
        // LoTW usernames need not be callsigns. Permit conventional account names
        // and portable callsigns, but reject whitespace, controls and URL syntax.
        guard username.range(of: #"^[A-Za-z0-9][A-Za-z0-9/_.@-]{0,127}$"#,
                             options: .regularExpression) == username.startIndex..<username.endIndex else {
            throw LoTWConfirmationDownloadError.invalidUsername
        }
        if let qslSince, !Self.validWatermark(qslSince) {
            throw LoTWConfirmationDownloadError.invalidWatermark
        }
        self.username = username
        self.qslSince = qslSince
    }

    /// The returned URL contains the password as required by LoTW's GET contract.
    /// Treat it as a secret: do not log, persist, or include it in diagnostics.
    /// A future transport MUST disable redirects before sending credentials and
    /// enforce the byte limit while streaming, before buffering a complete body.
    public func makeURLRequest(password: String) throws -> URLRequest {
        guard !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw LoTWConfirmationDownloadError.emptyPassword
        }
        var components = URLComponents(url: Self.endpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "login", value: username),
            URLQueryItem(name: "password", value: password),
            URLQueryItem(name: "qso_query", value: "1"),
            URLQueryItem(name: "qso_qsl", value: "yes"),
            URLQueryItem(name: "qso_withown", value: "yes")
        ] + (qslSince.map { [URLQueryItem(name: "qso_qslsince", value: $0)] } ?? [])
        // '+' must be escaped for servers decoding query parameters as form data.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "GET"
        request.setValue("application/x-adif, text/plain", forHTTPHeaderField: "Accept")
        return request
    }

    /// Validates transport metadata and body before invoking the strict ADIF parser.
    /// `redirectCount` must include every attempted redirect, even to this origin.
    public func parseResponse(_ response: LoTWConfirmationDownloadResponse) throws -> LoTWConfirmationReport {
        guard response.redirectCount == 0 else { throw LoTWConfirmationDownloadError.redirectRejected }
        let url = response.url
        guard url.scheme == "https", url.host == Self.endpoint.host,
              url.port == nil || url.port == 443,
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath == "/lotwuser/lotwreport.adi",
              url.user == nil, url.password == nil, url.fragment == nil else {
            throw LoTWConfirmationDownloadError.unexpectedEndpoint
        }
        guard (200..<300).contains(response.statusCode) else { throw LoTWConfirmationDownloadError.unsuccessfulStatus }
        guard response.body.count <= LoTWConfirmationReportParser.maximumInputBytes else {
            throw LoTWConfirmationDownloadError.oversizedResponse
        }
        let mime = response.contentType?.split(separator: ";", maxSplits: 1).first?
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard mime != "text/html", mime != "application/xhtml+xml" else {
            throw LoTWConfirmationDownloadError.htmlResponse
        }
        guard let text = String(data: response.body, encoding: .utf8) else {
            throw LoTWConfirmationDownloadError.invalidEncoding
        }
        let lower = text.lowercased()
        guard !["<html", "<!doctype", "<body", "<form", "<script"].contains(where: lower.contains) else {
            throw LoTWConfirmationDownloadError.htmlResponse
        }
        return try LoTWConfirmationReportParser().parse(text)
    }

    /// Call only after the report has been reconciled successfully. Replaying the
    /// boundary timestamp is intentional; consumers must reconcile idempotently.
    public func continuing(after report: LoTWConfirmationReport) throws -> Self {
        try Self(username: username, qslSince: report.lastQSL ?? qslSince)
    }

    private static func validWatermark(_ text: String) -> Bool {
        guard text.utf8.count == 10 || text.utf8.count == 19 else { return false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = text.utf8.count == 10 ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss"
        formatter.isLenient = false
        return formatter.date(from: text).map { formatter.string(from: $0) == text } == true
    }
}

/// Transport evidence only; constructing this does not certify a response.
public struct LoTWConfirmationDownloadResponse: Equatable, Sendable {
    public let url: URL
    public let statusCode: Int
    public let contentType: String?
    public let redirectCount: Int
    public let body: Data

    public init(url: URL, statusCode: Int, contentType: String?, redirectCount: Int, body: Data) {
        self.url = url
        self.statusCode = statusCode
        self.contentType = contentType
        self.redirectCount = redirectCount
        self.body = body
    }
}
