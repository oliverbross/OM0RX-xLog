import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
import CSQLitePrototype
import XLogPortableCore

public enum PrototypeSelfTest {
    /// In-memory fixtures only. URLRequest construction does not open a connection.
    public static func run() throws -> [String: Any] {
        var database: OpaquePointer?
        guard sqlite3_open(":memory:", &database) == SQLITE_OK, let database else {
            if let database { sqlite3_close(database) }
            throw WorkerFailure("self_test_failed", "SQLite memory database did not open.")
        }
        defer { sqlite3_close(database) }
        guard sqlite3_exec(database, "CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES('synthetic');", nil, nil, nil) == SQLITE_OK else {
            throw WorkerFailure("self_test_failed", "SQLite memory write failed.")
        }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT value FROM fixture", -1, &statement, nil) == SQLITE_OK,
              let statement else { throw WorkerFailure("self_test_failed", "SQLite query failed.") }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW,
              let value = sqlite3_column_text(statement, 0), String(cString: value) == "synthetic" else {
            throw WorkerFailure("self_test_failed", "SQLite memory readback failed.")
        }
        let xml = XMLParser(data: Data("<fixture><value>synthetic</value></fixture>".utf8))
        xml.shouldResolveExternalEntities = false
        let delegate = FixtureXMLDelegate()
        xml.delegate = delegate
        guard xml.parse(), delegate.value == "synthetic" else {
            throw WorkerFailure("self_test_failed", "FoundationXML fixture failed.")
        }
        let hash = SHA256.hash(data: Data("abc".utf8)).map { String(format: "%02x", $0) }.joined()
        guard hash == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" else {
            throw WorkerFailure("self_test_failed", "SHA-256 known vector failed.")
        }
        let fixture = "<CALL:5>TEST1<QSO_DATE:8>20260101<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<APP_SYNTHETIC:3>yes<EOR>"
        guard let record = ADIFParser().records(in: fixture).first,
              let qso = QSO(adif: record), qso.call == "TEST1",
              qso.adifRecord["APP_SYNTHETIC"] == "yes", record.semanticIdentityHash?.count == 64 else {
            throw WorkerFailure("self_test_failed", "Existing ADIF/domain fixture failed.")
        }
        let request = URLRequest(url: URL(string: "https://example.invalid/synthetic")!)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureHTTPProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let received = FixtureHTTPResult()
        let completed = DispatchSemaphore(value: 0)
        session.dataTask(with: request) { data, response, error in
            received.store(data: data, status: (response as? HTTPURLResponse)?.statusCode, failed: error != nil)
            completed.signal()
        }.resume()
        guard completed.wait(timeout: .now() + 2) == .success, received.matches else {
            throw WorkerFailure("self_test_failed", "Foundation URLSession fixture failed.")
        }
        return ["passed": true, "sqlite": "memory_readback_passed", "xml": "fixture_parse_passed",
                "sha256": hash, "adif": "existing_core_roundtrip_passed",
                "foundation_http": "urlsession_protocol_fixture_passed", "network_contact": false,
                "file_io": false, "station_io": false]
    }
}

/// An in-process URLSession transport fixture. All URLs are intercepted; no socket
/// or DNS operation is performed. Live HTTP/provider acceptance remains separate.
private final class FixtureHTTPProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "application/json"]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"synthetic\":true}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class FixtureHTTPResult: @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var status: Int?
    private var failed = true
    func store(data: Data?, status: Int?, failed: Bool) {
        lock.lock()
        defer { lock.unlock() }
        self.data = data; self.status = status; self.failed = failed
    }
    var matches: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !failed && status == 200 && data == Data("{\"synthetic\":true}".utf8)
    }
}

private final class FixtureXMLDelegate: NSObject, XMLParserDelegate {
    var value = ""
    private var inValue = false
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String]) {
        inValue = elementName == "value"
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inValue { value += string }
    }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if elementName == "value" { inValue = false }
    }
}
