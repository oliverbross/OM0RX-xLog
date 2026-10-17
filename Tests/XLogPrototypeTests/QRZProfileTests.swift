#if os(macOS)
import Foundation
import Testing
@testable import XLogCore
@testable import XLogPrototypeSupport

@Suite("QRZ XML profile projection", .serialized)
struct QRZProfileTests {
    @Test("Workspace creation is busy while its owner holds the absent path, then ready")
    func workspaceCreationAvailabilityTransition() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let acquired = AsyncStream<Void>.makeStream(), create = DispatchSemaphore(value: 0)
        let owner = Task.detached { () throws -> Void in
            defer { acquired.continuation.finish() }
            try logbook.withSyncOwnerLock {
                acquired.continuation.yield()
                create.wait()
                _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
            }
        }
        for await _ in acquired.stream { break }
        guard case .busy = logbook.currentSettingsAvailability() else {
            Issue.record("An owned workspace transition with an absent path must remain transiently busy.")
            create.signal(); try await owner.value; return
        }
        create.signal()
        try await owner.value
        guard case .ready = logbook.currentSettingsAvailability() else {
            Issue.record("Completed workspace creation must publish readable settings.")
            return
        }
    }

    private func xml(image: String, website: String) -> Data {
        Data("""
        <QRZDatabase><Callsign>
          <call>K1ABC</call><fname>Ada</fname><name>Operator</name>
          <grid>FN31</grid><country>United States</country><dxcc>291</dxcc>
          <nickname>Ace</nickname><qslmgr>K1MGR</qslmgr><iota>NA-001</iota><class>EXTRA</class>
          <image>\(image)</image><url>\(website)</url>
        </Callsign><Session><Key>fixture-session-key-never-projected</Key></Session></QRZDatabase>
        """.utf8)
    }

    @Test("Official XML image and details survive a matching-call enrichment without session secrets")
    func projectsImageAndDetails() async throws {
        let profile = try QRZClient.profile(
            from: xml(image: "https://cdn-bio.qrz.com/k1abc/profile.jpg",
                      website: "https://example.org/k1abc"), call: "K1ABC")
        #expect(profile.imageURL == "https://cdn-bio.qrz.com/k1abc/profile.jpg")
        #expect(profile.websiteURL == "https://example.org/k1abc")
        #expect(profile.nickname == "Ace")
        #expect(profile.qslManager == "K1MGR")
        #expect(profile.iota == "NA-001")
        #expect(profile.licenseClass == "EXTRA")
        let result = await CallsignEnrichment.resolve(base: ["call": "K1ABC", "source": "CTY approximate"]) {
            ["call": profile.call, "imageURL": profile.imageURL,
             "websiteURL": profile.websiteURL, "nickname": profile.nickname,
             "qslManager": profile.qslManager, "iota": profile.iota,
             "licenseClass": profile.licenseClass]
        }
        #expect(result["imageURL"] as? String == profile.imageURL)
        #expect(result["websiteURL"] as? String == profile.websiteURL)
        #expect(result["nickname"] as? String == "Ace")
        #expect(result["qrz_status"] as? String == "matched")
        #expect(!String(describing: result).contains("fixture-session-key"))
    }

    @Test("QRZ failures retain the offline OM0AAO entity with an actionable safe state")
    func retainsOfflineEntityOnProviderFailure() async {
        let result = await CallsignEnrichment.resolve(base: [
            "call": "OM0AAO", "country": "SLOVAK REPUBLIC", "dxcc": 504,
            "source": "CTY approximate",
        ]) {
            throw QRZClientError.timedOut
        }
        #expect(result["country"] as? String == "SLOVAK REPUBLIC")
        #expect(result["dxcc"] as? Int == 504)
        #expect(result["source"] as? String == "CTY approximate")
        #expect(result["qrz_status"] as? String == "unavailable")
        #expect((result["lookup_warning"] as? String)?.contains("timed out") == true)
        #expect(!(result["lookup_warning"] as? String ?? "").contains("Operation failed"))
    }

    @Test("Launch-time lookup retains bundled OM0AAO identity before the workspace is ready")
    func launchLookupBeforeWorkspaceReady() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false))
        let request = try JSONSerialization.data(withJSONObject: [
            "id": "launch-lookup", "method": "lookup_call", "params": ["call": "OM0AAO"],
        ])
        let response = try #require(JSONSerialization.jsonObject(with: await worker.response(to: request)) as? [String: Any])
        #expect(response["ok"] as? Bool == true)
        let profile = try #require(response["result"] as? [String: Any])
        #expect(profile["call"] as? String == "OM0AAO")
        #expect(profile["country"] as? String == "SLOVAK REPUBLIC")
        #expect(profile["dxcc"] as? Int == 504)
        #expect(profile["source"] as? String == "CTY approximate")
        #expect(profile["qrz_status"] as? String == "workspace_unavailable")
        #expect((profile["lookup_warning"] as? String)?.contains("Offline CTY result retained") == true)
        #expect(!String(describing: response).contains("Operation failed"))

        let interactiveRequest = try JSONSerialization.data(withJSONObject: [
            "id": "interactive-lookup", "method": "lookup_call",
            "params": ["call": "OM0AAO", "allow_credential_interaction": true],
        ])
        let rejected = try #require(JSONSerialization.jsonObject(with: await worker.response(to: interactiveRequest)) as? [String: Any])
        #expect(rejected["ok"] as? Bool == false)
        #expect((rejected["error"] as? [String: Any])?["code"] as? String == "invalid_params")
        await worker.shutdown()
    }

    @Test("Passive VK8NSB lookup waits through more than 750 ms of logbook contention")
    func lookupSettlesDuringLogbookContention() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook)
        let acquired = AsyncStream<Void>.makeStream(), release = DispatchSemaphore(value: 0)
        let owner = Task.detached {
            defer { acquired.continuation.finish() }
            logbook.withSyncOwnerLock {
                acquired.continuation.yield()
                release.wait()
            }
        }
        for await _ in acquired.stream { break }
        let request = try JSONSerialization.data(withJSONObject: [
            "id": "busy-lookup", "method": "lookup_call", "params": ["call": "VK8NSB"],
        ])
        let delayedRelease = Task.detached {
            try? await Task.sleep(for: .milliseconds(900))
            release.signal()
        }
        let response = await worker.response(to: request)
        await delayedRelease.value
        await owner.value
        let object = try #require(JSONSerialization.jsonObject(with: response) as? [String: Any])
        #expect(object["ok"] as? Bool == true)
        let profile = try #require(object["result"] as? [String: Any])
        #expect(profile["call"] as? String == "VK8NSB")
        #expect(profile["country"] as? String == "AUSTRALIA")
        #expect(profile["dxcc"] as? Int == 150)
        #expect(profile["source"] as? String == "CTY approximate")
        #expect(profile["qrz_status"] == nil)
        #expect(profile["lookup_warning"] == nil)
        #expect(!String(describing: object).contains("Operation failed"))
        await worker.shutdown()
    }

    @Test("Insecure or local XML image URLs are never exposed")
    func rejectsUnsafeImages() throws {
        for raw in ["http://cdn-bio.qrz.com/p.jpg", "https://localhost/p.jpg",
                    "https://127.0.0.1/p.jpg", "https://[::1]/p.jpg",
                    "https://user:secret@cdn-bio.qrz.com/p.jpg",
                    "https://radio.local/p.jpg", "file:///tmp/p.jpg"] {
            let profile = try QRZClient.profile(from: xml(image: raw, website: raw), call: "K1ABC")
            #expect(profile.imageURL.isEmpty)
            #expect(profile.websiteURL.isEmpty)
        }
    }

    @Test("A mismatched callsign cannot lend its photo or details to another contact")
    func mismatchedCallRetainsOffline() async {
        let result = await CallsignEnrichment.resolve(base: ["call": "K1ABC", "source": "CTY approximate"]) {
            ["call": "OTHER", "imageURL": "https://cdn-bio.qrz.com/other.jpg", "nickname": "Other"]
        }
        #expect(result["imageURL"] == nil)
        #expect(result["nickname"] == nil)
        #expect(result["source"] as? String == "CTY approximate")
    }

    @Test("DXCC entity land wins over the operator mailing country")
    func landIsDXCCCountry() throws {
        let data = Data("""
        <QRZDatabase><Callsign><call>OM0AAO</call><dxcc>504</dxcc>
        <land>SLOVAK REPUBLIC</land><country>ENGLAND</country></Callsign>
        <Session><Key>fixture</Key></Session></QRZDatabase>
        """.utf8)
        let profile = try QRZClient.profile(from: data, call: "OM0AAO")
        #expect(profile.dxcc == 504)
        #expect(profile.country == "SLOVAK REPUBLIC")
    }

    @Test("QRZ session is reused and a missing key causes exactly one re-login")
    func reusesAndRefreshesSession() async throws {
        QRZFixtureURLProtocol.reset(missingFirstLookup: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [QRZFixtureURLProtocol.self]
        let client = QRZClient(username: "fixture", password: "fixture",
                               session: URLSession(configuration: configuration))
        #expect(try await client.lookup("OM0AAO").country == "SLOVAK REPUBLIC")
        #expect(try await client.lookup("OM0AAO").dxcc == 504)
        #expect(QRZFixtureURLProtocol.counts() == [2, 3])
    }

    @Test("Repeated missing QRZ keys stop after one retry")
    func boundsSessionRefresh() async throws {
        QRZFixtureURLProtocol.reset(alwaysMissing: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [QRZFixtureURLProtocol.self]
        let client = QRZClient(username: "fixture", password: "fixture",
                               session: URLSession(configuration: configuration))
        await #expect(throws: QRZClientError.self) { try await client.lookup("OM0AAO") }
        #expect(QRZFixtureURLProtocol.counts() == [2, 2])
    }

    @Test("Concurrent lookups share one QRZ authentication")
    func concurrentSessionReuse() async throws {
        QRZFixtureURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [QRZFixtureURLProtocol.self]
        let client = QRZClient(username: "fixture", password: "fixture",
                               session: URLSession(configuration: configuration))
        let countries = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<4 { group.addTask { try await client.lookup("OM0AAO").country } }
            var countries: [String] = []
            for try await country in group { countries.append(country) }
            return countries
        }
        #expect(countries == Array(repeating: "SLOVAK REPUBLIC", count: 4))
        #expect(QRZFixtureURLProtocol.counts() == [1, 4])
    }

    @Test("Transport errors never expose credential or session query URLs")
    func transportErrorsAreSafe() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [QRZFixtureURLProtocol.self]
        let username = "fixture-user-private"
        let password = "fixture-password-private"
        for failLogin in [true, false] {
            QRZFixtureURLProtocol.reset(failLogin: failLogin, failLookup: !failLogin)
            let client = QRZClient(username: username, password: password,
                                   session: URLSession(configuration: configuration))
            do {
                _ = try await client.lookup("OM0AAO")
                Issue.record("Fixture transport failure was not surfaced")
            } catch {
                guard case QRZClientError.timedOut = error else {
                    Issue.record("Expected a sanitized QRZ timeout category")
                    continue
                }
                let descriptions = [String(describing: error), String(reflecting: error),
                                    error.localizedDescription, (error as NSError).description].joined(separator: " ")
                for secret in [username, password, "session-1", "xmldata.qrz.com/xml/current", "?username=", "?s="] {
                    #expect(!descriptions.contains(secret))
                }
                #expect(error.localizedDescription.contains("timed out"))
            }
            #expect(QRZFixtureURLProtocol.counts() == (failLogin ? [1, 0] : [1, 1]))
        }
    }

    @Test("QRZ requests are bounded and authentication never puts credentials in the URL")
    func requestsAreBoundedAndAuthenticationUsesPOST() throws {
        let username = "fixture-user-private"
        let password = "fixture-password-private"
        let login = QRZClient.authenticationRequest(username: username, password: password)
        #expect(login.httpMethod == "POST")
        #expect(login.url?.query == nil)
        #expect(login.timeoutInterval == 10)
        #expect(login.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
        let body = String(data: try #require(login.httpBody), encoding: .utf8) ?? ""
        #expect(body.contains("username=fixture-user-private"))
        #expect(body.contains("password=fixture-password-private"))

        let lookup = QRZClient.lookupRequest(sessionKey: "fixture-session", call: "om0aao")
        #expect(lookup.httpMethod == "GET")
        #expect(lookup.timeoutInterval == 10)
        #expect(lookup.url?.query?.contains("callsign=OM0AAO") == true)
        #expect(lookup.url?.absoluteString.contains(username) == false)
        #expect(lookup.url?.absoluteString.contains(password) == false)
    }

    @Test("Portable and prefixed calls resolve through the licensed QRZ callsign")
    func normalizesPortableCallsigns() async throws {
        #expect(QRZClient.providerCallsign(for: "om0rx/p") == "OM0RX")
        #expect(QRZClient.providerCallsign(for: "VK8NSB/4") == "VK8NSB")
        #expect(QRZClient.providerCallsign(for: "EA8/OM0RX/P") == "OM0RX")

        QRZFixtureURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [QRZFixtureURLProtocol.self]
        let client = QRZClient(username: "fixture", password: "fixture",
                               session: URLSession(configuration: configuration))
        let profile = try await client.lookup("OM0AAO/P")
        #expect(profile.call == "OM0AAO/P")
        #expect(profile.country == "SLOVAK REPUBLIC")
        #expect(QRZFixtureURLProtocol.lastLookupCallsign() == "OM0AAO")
    }
}

private final class QRZFixtureURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var loginCount = 0
    private static var lookupCount = 0
    private static var missingFirstLookup = false
    private static var alwaysMissing = false
    private static var failLogin = false
    private static var failLookup = false

    static func reset(missingFirstLookup: Bool = false, alwaysMissing: Bool = false,
                      failLogin: Bool = false, failLookup: Bool = false) {
        lock.withLock {
            loginCount = 0
            lookupCount = 0
            lastCallsign = nil
            self.missingFirstLookup = missingFirstLookup
            self.alwaysMissing = alwaysMissing
            self.failLogin = failLogin
            self.failLookup = failLookup
        }
    }

    static func counts() -> [Int] { lock.withLock { [loginCount, lookupCount] } }
    static func lastLookupCallsign() -> String? { lock.withLock { lastCallsign } }
    private static var lastCallsign: String?

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "xmldata.qrz.com"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let login = request.httpMethod == "POST" || query.contains(where: { $0.name == "username" })
        let (body, failure): (String, Bool) = Self.lock.withLock {
            if login {
                Self.loginCount += 1
                return ("<QRZDatabase><Session><Key>session-\(Self.loginCount)</Key></Session></QRZDatabase>", Self.failLogin)
            }
            Self.lookupCount += 1
            Self.lastCallsign = query.first(where: { $0.name == "callsign" })?.value
            if Self.failLookup { return ("", true) }
            if Self.alwaysMissing || (Self.missingFirstLookup && Self.lookupCount == 1) {
                return ("<QRZDatabase><Session><Error>Session Timeout</Error></Session></QRZDatabase>", false)
            }
            return ("<QRZDatabase><Callsign><call>OM0AAO</call><land>SLOVAK REPUBLIC</land><dxcc>504</dxcc></Callsign><Session><Key>session-\(Self.loginCount)</Key></Session></QRZDatabase>", false)
        }
        if failure {
            let url = request.url!
            client?.urlProtocol(self, didFailWithError: NSError(domain: NSURLErrorDomain,
                code: URLError.timedOut.rawValue,
                userInfo: [NSURLErrorFailingURLErrorKey: url,
                           NSLocalizedDescriptionKey: "Timed out at \(url.absoluteString)"]))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200,
                                       httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
#endif
