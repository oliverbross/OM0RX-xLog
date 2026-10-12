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
    public var latitude: Double?
    public var longitude: Double?
}

public enum QRZClientError: Error, LocalizedError {
    case invalidConfiguration
    case rejected(String)
    case missingSession
    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "QRZ username and password are required."
        case let .rejected(message): return "QRZ lookup failed: \(message)"
        case .missingSession: return "QRZ did not return a session key. A QRZ XML subscription may be required."
        }
    }
}

public actor QRZClient {
    private let username: String
    private let password: String
    private let session: URLSession
    private var sessionKey: String?

    public init(username: String, password: String, session: URLSession = .shared) {
        self.username = username
        self.password = password
        self.session = session
    }

    public func lookup(_ call: String) async throws -> CallsignProfile {
        if sessionKey == nil { try await authenticate() }
        guard let sessionKey else { throw QRZClientError.missingSession }
        var components = URLComponents(string: "https://xmldata.qrz.com/xml/current/")!
        components.queryItems = [
            URLQueryItem(name: "s", value: sessionKey),
            URLQueryItem(name: "callsign", value: call.uppercased()),
        ]
        let (data, response) = try await session.data(from: components.url!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw QRZClientError.rejected("HTTP request rejected") }
        let document = XMLFieldParser.parse(data)
        if let error = document["Error"] { throw QRZClientError.rejected(error) }
        return CallsignProfile(
            call: document["call"] ?? call.uppercased(),
            name: [document["fname"], document["name"]].compactMap { $0 }.joined(separator: " "),
            gridSquare: document["grid"] ?? "",
            country: document["country"] ?? "",
            dxcc: document["dxcc"].flatMap(Int.init),
            cqZone: document["cqzone"] ?? "",
            ituZone: document["ituzone"] ?? "",
            state: document["state"] ?? "",
            county: document["county"] ?? "",
            qth: document["addr2"] ?? "",
            email: document["email"] ?? "",
            latitude: document["lat"].flatMap(Double.init),
            longitude: document["lon"].flatMap(Double.init)
        )
    }

    private func authenticate() async throws {
        guard !username.isEmpty, !password.isEmpty else { throw QRZClientError.invalidConfiguration }
        var components = URLComponents(string: "https://xmldata.qrz.com/xml/current/")!
        components.queryItems = [
            URLQueryItem(name: "username", value: username),
            URLQueryItem(name: "password", value: password),
            URLQueryItem(name: "agent", value: "OM0RX-xLog-0.2.1"),
        ]
        let (data, response) = try await session.data(from: components.url!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw QRZClientError.rejected("HTTP request rejected") }
        let document = XMLFieldParser.parse(data)
        if let error = document["Error"] { throw QRZClientError.rejected(error) }
        sessionKey = document["Key"]
        if sessionKey == nil { throw QRZClientError.missingSession }
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
