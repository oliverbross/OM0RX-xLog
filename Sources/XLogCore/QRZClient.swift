import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

public struct CallsignProfile: Equatable, Sendable {
    public var call = ""
    public var name = ""
    public var gridSquare = ""
    public var country = ""
    public var dxcc: Int?
    public var cqZone = ""
    public var ituZone = ""
    public var state = ""
    public var county = ""
    public var qth = ""
    public var email = ""
    public var nickname = ""
    public var websiteURL = ""
    public var imageURL = ""
    public var qslManager = ""
    public var iota = ""
    public var licenseClass = ""
    public var latitude: Double?
    public var longitude: Double?
}

public enum QRZClientError: Error, LocalizedError {
    case invalidConfiguration
    case rejected(String)
    case missingSession
    case timedOut
    case networkUnavailable
    case cancelled
    case transportFailed
    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "QRZ username and password are required."
        case let .rejected(message): return "QRZ lookup failed: \(message)"
        case .missingSession: return "QRZ did not return a session key. A QRZ XML subscription may be required."
        case .timedOut: return "QRZ request timed out. Check the connection and try again."
        case .networkUnavailable: return "QRZ is unreachable. Check the network connection and try again."
        case .cancelled: return "QRZ request was cancelled."
        case .transportFailed: return "QRZ transport failed. Try again later."
        }
    }
}

public actor QRZClient {
    // Four requests are possible when QRZ asks for one session refresh. Keep
    // that worst case below the worker's 45-second lookup deadline.
    private static let requestTimeout: TimeInterval = 10
    private let username: String
    private let password: String
    private let session: URLSession
    private var sessionKey: String?
    private var authenticationTask: Task<String, Error>?

    public init(username: String, password: String, session: URLSession = .shared) {
        self.username = username
        self.password = password
        self.session = session
    }

    public func lookup(_ call: String) async throws -> CallsignProfile {
        let requestedCall = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let lookupCall = Self.providerCallsign(for: requestedCall)
        for attempt in 0..<2 {
            if sessionKey == nil { try await authenticate() }
            guard let sessionKey else { throw QRZClientError.missingSession }
            let request = Self.lookupRequest(sessionKey: sessionKey, call: lookupCall)
            let data: Data, response: URLResponse
            do { (data, response) = try await session.data(for: request) }
            catch { throw Self.safeTransportError(error) }
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw QRZClientError.rejected("HTTP request rejected")
            }
            let document = XMLFieldParser.parse(data)
            if document["Error"]?.localizedCaseInsensitiveContains("connection refused") == true {
                throw QRZClientError.rejected("QRZ refused the connection")
            }
            // QRZ explicitly says to reuse each returned key and re-login
            // when a lookup response omits it. Retry only once per lookup.
            guard let returnedKey = document["Key"], !returnedKey.isEmpty else {
                self.sessionKey = nil
                if attempt == 0 { continue }
                throw QRZClientError.missingSession
            }
            self.sessionKey = returnedKey
            var profile = try Self.profile(document: document, call: lookupCall)
            guard Self.providerCallsign(for: profile.call) == lookupCall else {
                throw QRZClientError.rejected("QRZ returned a different callsign")
            }
            // Keep the UI result scoped to the exact draft identity. QRZ returns
            // the home callsign for portable and prefix/suffix forms.
            profile.call = requestedCall
            return profile
        }
        throw QRZClientError.missingSession
    }

    /// QRZ XML supplies the image URL directly; biography HTML and the QRZ
    /// website are not fetched or scraped. Only transport-safe public URLs are
    /// projected into a UI that may choose to load the image separately.
    static func profile(from data: Data, call: String) throws -> CallsignProfile {
        try profile(document: XMLFieldParser.parse(data), call: call)
    }

    private static func profile(document: [String: String], call: String) throws -> CallsignProfile {
        if document["Error"] != nil { throw QRZClientError.rejected("QRZ rejected the callsign lookup") }
        return CallsignProfile(
            call: document["call"] ?? call.uppercased(),
            name: [document["fname"], document["name"]].compactMap { $0 }.joined(separator: " "),
            gridSquare: document["grid"] ?? "",
            country: document["land"].flatMap { $0.isEmpty ? nil : $0 } ?? document["country"] ?? "",
            dxcc: document["dxcc"].flatMap(Int.init),
            cqZone: document["cqzone"] ?? "",
            ituZone: document["ituzone"] ?? "",
            state: document["state"] ?? "",
            county: document["county"] ?? "",
            qth: document["addr2"] ?? "",
            email: document["email"] ?? "",
            nickname: document["nickname"] ?? "",
            websiteURL: publicHTTPSURL(document["url"]) ?? "",
            imageURL: publicHTTPSURL(document["image"]) ?? "",
            qslManager: document["qslmgr"] ?? "",
            iota: document["iota"] ?? "",
            licenseClass: document["class"] ?? "",
            latitude: document["lat"].flatMap(Double.init),
            longitude: document["lon"].flatMap(Double.init)
        )
    }

    private static func publicHTTPSURL(_ raw: String?) -> String? {
        guard let raw, (1...2_048).contains(raw.utf8.count),
              let components = URLComponents(string: raw),
              components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(), host.contains("."),
              !host.hasSuffix(".local"), !host.hasSuffix(".localhost"),
              components.user == nil, components.password == nil,
              components.port == nil, components.fragment == nil,
              !host.contains(":"), !host.utf8.allSatisfy({ $0 == 46 || (48...57).contains($0) }),
              let url = components.url else { return nil }
        return url.absoluteString
    }

    private static func safeTransportError(_ error: Error) -> QRZClientError {
        // URLSession errors may include the full request URL, including QRZ's
        // username/password or session-key query. Do not retain or rethrow
        // their descriptions or underlying NSError/userInfo values.
        let value = error as NSError
        guard value.domain == NSURLErrorDomain else { return .transportFailed }
        switch value.code {
        case URLError.timedOut.rawValue: return .timedOut
        case URLError.notConnectedToInternet.rawValue, URLError.networkConnectionLost.rawValue,
             URLError.cannotConnectToHost.rawValue, URLError.cannotFindHost.rawValue,
             URLError.dnsLookupFailed.rawValue: return .networkUnavailable
        case URLError.cancelled.rawValue: return .cancelled
        default: return .transportFailed
        }
    }

    private func authenticate() async throws {
        guard !username.isEmpty, !password.isEmpty else { throw QRZClientError.invalidConfiguration }
        if let authenticationTask {
            sessionKey = try await authenticationTask.value
            return
        }
        let username = username, password = password, session = session
        let task = Task<String, Error> {
            let request = Self.authenticationRequest(username: username, password: password)
            let data: Data, response: URLResponse
            do { (data, response) = try await session.data(for: request) }
            catch { throw Self.safeTransportError(error) }
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw QRZClientError.rejected("HTTP request rejected")
            }
            let document = XMLFieldParser.parse(data)
            if document["Error"] != nil { throw QRZClientError.rejected("QRZ rejected authentication") }
            guard let key = document["Key"], !key.isEmpty else { throw QRZClientError.missingSession }
            return key
        }
        authenticationTask = task
        do {
            sessionKey = try await task.value
            authenticationTask = nil
        } catch {
            authenticationTask = nil
            throw error
        }
    }

    static func lookupRequest(sessionKey: String, call: String) -> URLRequest {
        var components = URLComponents(string: "https://xmldata.qrz.com/xml/current/")!
        components.queryItems = [
            URLQueryItem(name: "s", value: sessionKey),
            URLQueryItem(name: "callsign", value: call.uppercased()),
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = requestTimeout
        return request
    }

    /// QRZ XML profiles are keyed by the licensed home call, while operators
    /// commonly enter forms such as OM0RX/P, VK8NSB/4, or EA8/OM0RX/P.
    public static func providerCallsign(for call: String) -> String {
        let parts = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            .split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        let candidates = parts.filter { part in
            part.utf8.count >= 3 && part.utf8.contains(where: { (65...90).contains($0) }) &&
                part.utf8.contains(where: { (48...57).contains($0) })
        }
        return candidates.max { lhs, rhs in
            lhs.utf8.count == rhs.utf8.count ? lhs > rhs : lhs.utf8.count < rhs.utf8.count
        } ?? parts.first ?? ""
    }

    static func authenticationRequest(username: String, password: String) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://xmldata.qrz.com/xml/current/")!)
        request.httpMethod = "POST"
        request.httpBody = onlineLogFormBody([
            ("username", username),
            ("password", password),
            ("agent", "OM0RX-xLog-0.4"),
        ])
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = requestTimeout
        return request
    }
}

private final class XMLFieldParser: NSObject, XMLParserDelegate {
    private var current = ""
    private var buffer = ""
    private(set) var fields: [String: String] = [:]

    static func parse(_ data: Data) -> [String: String] {
        let delegate = XMLFieldParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        return delegate.fields
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        current = elementName
        buffer = ""
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { buffer += string }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty { fields[elementName] = value }
        current = ""; buffer = ""
    }
}
