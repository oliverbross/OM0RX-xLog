import Foundation
import Testing
@testable import XLogCore

private final class ConditionalReferenceURLProtocol: URLProtocol, @unchecked Sendable {
    struct RequestHeaders: Equatable {
        var ifNoneMatch: String?
        var ifModifiedSince: String?
    }

    private static let lock = NSLock()
    private static var requestHeaders: [RequestHeaders] = []

    static func reset() {
        lock.lock()
        requestHeaders = []
        lock.unlock()
    }

    static func headers() -> [RequestHeaders] {
        lock.lock()
        defer { lock.unlock() }
        return requestHeaders
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let headers = RequestHeaders(
            ifNoneMatch: request.value(forHTTPHeaderField: "If-None-Match"),
            ifModifiedSince: request.value(forHTTPHeaderField: "If-Modified-Since")
        )
        let requestIndex: Int = Self.lock.withLock {
            Self.requestHeaders.append(headers)
            return Self.requestHeaders.count - 1
        }

        let statusCode: Int
        let body: Data
        let responseHeaders: [String: String]
        switch requestIndex {
        case 0:
            statusCode = 200
            body = Self.validPOTAPayload
            responseHeaders = [
                "Content-Type": "text/csv",
                "ETag": "\"pota-v1\"",
                "Last-Modified": "Sat, 10 Oct 2026 10:00:00 GMT",
            ]
        case 1:
            statusCode = 304
            body = Data()
            responseHeaders = [:]
        default:
            statusCode = 200
            body = Data(repeating: 0x78, count: 20_000)
            responseHeaders = ["ETag": "\"pota-corrupt\""]
        }

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: responseHeaders
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !body.isEmpty { client?.urlProtocol(self, didLoad: body) }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static let validPOTAPayload: Data = {
        var text = "reference,name,locationDesc,latitude,longitude,grid,active\n"
        for index in 0..<10_000 {
            text += "US-\(String(format: "%04d", index)),Park \(index),United States,40.0,-75.0,FN20,1\n"
        }
        return Data(text.utf8)
    }()
}

private final class ReferenceMetadataURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var statuses: [String: Int] = [:]
    private static var bodies: [String: Data] = [:]
    private static var paths: [String] = []
    private static var conditionalTags: [String?] = []

    static func configure(_ statuses: [String: Int], bodies: [String: Data] = [:]) {
        lock.withLock {
            self.statuses = statuses
            self.bodies = bodies
            self.paths = []
            self.conditionalTags = []
        }
    }
    static func requestedPaths() -> [String] { lock.withLock { paths } }
    static func requestedETags() -> [String?] { lock.withLock { conditionalTags } }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url!.path
        let (status, override) = Self.lock.withLock { () -> (Int, Data?) in
            Self.paths.append(path)
            Self.conditionalTags.append(request.value(forHTTPHeaderField: "If-None-Match"))
            return (Self.statuses[path] ?? 500, Self.bodies[path])
        }
        let body: Data
        if let override { body = override }
        else { switch path {
        case "/cty.xml":
            body = Self.validCTY
        case "/lotw.csv":
            body = Self.validLoTW
        case "/index.php/api/v2/catalog": body = Data("{\"items\":[]}".utf8)
        default: body = Data()
        }
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: "HTTP/1.1", headerFields: ["ETag": "\"fixture\""])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if status != 304 { client?.urlProtocol(self, didLoad: body) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    static let validCTY: Data = {
        let entries = [("K", 291, "United States"), ("DL", 230, "Germany"), ("JA", 339, "Japan")]
        let rules = entries.map { call, adif, entity in
            "<prefix><call>\(call)</call><adif>\(adif)</adif><cqz>14</cqz><entity>\(entity)</entity></prefix>"
        }.joined()
        return Data(("<?xml version=\"1.0\"?><clublog>" + rules + String(repeating: " ", count: 10_000) + "</clublog>").utf8)
    }()
    static let validLoTW: Data = {
        let rows = (0..<150).map { "K\($0)ABC,2026-10-10\n" }.joined()
        return Data(("CALL,LASTUPLOAD\n" + rows).utf8)
    }()
}

@Suite("Reference data updater", .serialized)
struct ReferenceDataUpdaterTests {
    private func fixtureUpdater(directory: URL) throws -> ReferenceDataUpdater {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReferenceMetadataURLProtocol.self]
        return try ReferenceDataUpdater(directory: directory, session: URLSession(configuration: configuration))
    }

    @Test("Legacy state has no invented download history")
    func legacyStateDecode() throws {
        let legacy = Data("{\"clubLogUpdatedAt\":1000,\"clubLogBytes\":12000}".utf8)
        let state = try JSONDecoder().decode(ReferenceDataState.self, from: legacy)
        #expect(state.clubLogUpdatedAt != nil)
        #expect(state.sourceMetadata.isEmpty)
    }

    @Test("200 downloads and 304 checks retain distinct dates; partial failure persists")
    func sourceMetadataAndPartialSuccess() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let updater = try fixtureUpdater(directory: directory)
        let club = URL(string: "https://fixture.invalid/cty.xml")!
        let lotw = URL(string: "https://fixture.invalid/lotw.csv")!

        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/lotw.csv": 200])
        let first = try await updater.refresh(clubLogURL: club, clubLogAPIKey: "fixture-secret", lotwURL: lotw)
        let clubDownloaded = try #require(first.sourceMetadata["cty.xml"]?.downloadedAt)
        let lotwDownloaded = try #require(first.sourceMetadata["lotw-user-activity.csv"]?.downloadedAt)
        #expect(first.sourceMetadata["cty.xml"]?.status == "downloaded")
        #expect(first.sourceMetadata["lotw-user-activity.csv"]?.status == "downloaded")
        let originalClub = try Data(contentsOf: directory.appendingPathComponent("cty.xml"))

        ReferenceMetadataURLProtocol.configure(["/cty.xml": 304, "/lotw.csv": 304])
        let checked = try await updater.refresh(clubLogURL: club, clubLogAPIKey: "fixture-secret", lotwURL: lotw)
        #expect(checked.sourceMetadata["cty.xml"]?.downloadedAt == clubDownloaded)
        #expect(checked.sourceMetadata["lotw-user-activity.csv"]?.downloadedAt == lotwDownloaded)
        #expect(checked.sourceMetadata["cty.xml"]?.status == "up_to_date")
        #expect(checked.sourceMetadata["cty.xml"]?.checkedAt != nil)

        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/lotw.csv": 500])
        await #expect(throws: ReferenceDataUpdaterError.self) {
            try await updater.refresh(clubLogURL: club, clubLogAPIKey: "fixture-secret", lotwURL: lotw)
        }
        let partial = await updater.currentState()
        #expect(partial.sourceMetadata["cty.xml"]?.status == "downloaded")
        #expect(partial.sourceMetadata["lotw-user-activity.csv"]?.status == "failed")
        #expect(partial.sourceMetadata["lotw-user-activity.csv"]?.downloadedAt == lotwDownloaded)
        #expect(partial.sourceMetadata["lotw-user-activity.csv"]?.checkedAt == checked.sourceMetadata["lotw-user-activity.csv"]?.checkedAt)
        #expect(partial.sourceMetadata["lotw-user-activity.csv"]?.lastError == "download_or_validation_failed")
        #expect(try Data(contentsOf: directory.appendingPathComponent("cty.xml")) == originalClub)
        let persisted = try String(contentsOf: directory.appendingPathComponent("state.json"), encoding: .utf8)
        #expect(!persisted.contains("fixture-secret"))
        #expect(!persisted.contains("fixture.invalid"))
    }

    @Test("Selective scheduled CTY and LoTW checks request only their due source")
    func selectiveSourceRequests() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let updater = try fixtureUpdater(directory: directory)
        let club = URL(string: "https://fixture.invalid/cty.xml")!
        let lotw = URL(string: "https://fixture.invalid/lotw.csv")!
        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/lotw.csv": 200])
        let cty = try await updater.refreshClubLog(club, apiKey: "fixture-secret")
        #expect(ReferenceMetadataURLProtocol.requestedPaths() == ["/cty.xml"])
        #expect(cty.sourceMetadata["cty.xml"]?.status == "downloaded")
        #expect(cty.sourceMetadata["lotw-user-activity.csv"] == nil)
        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/lotw.csv": 200])
        let lotwState = try await updater.refreshLoTW(lotw)
        #expect(ReferenceMetadataURLProtocol.requestedPaths() == ["/lotw.csv"])
        #expect(lotwState.sourceMetadata["cty.xml"]?.checkedAt == cty.sourceMetadata["cty.xml"]?.checkedAt)
        #expect(lotwState.sourceMetadata["lotw-user-activity.csv"]?.status == "downloaded")
    }

    @Test("Credential-bearing endpoints reject HTTP before requests and refuse redirects")
    func credentialTransportBoundary() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let updater = try fixtureUpdater(directory: directory)
        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/index.php/api/v2/catalog": 200])
        await #expect(throws: ReferenceDataUpdaterError.self) {
            try await updater.refreshClubLog(URL(string: "http://fixture.invalid/cty.xml")!, apiKey: "fixture-secret")
        }
        await #expect(throws: ReferenceDataUpdaterError.self) {
            try await updater.refreshWavelogCatalog(baseURL: URL(string: "http://fixture.invalid")!, token: "fixture-token")
        }
        #expect(ReferenceMetadataURLProtocol.requestedPaths().isEmpty)

        let blocker = CredentialRedirectBlocker()
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: URL(string: "https://fixture.invalid/cty.xml")!)
        let response = HTTPURLResponse(url: URL(string: "https://fixture.invalid/cty.xml")!,
                                       statusCode: 302, httpVersion: nil,
                                       headerFields: ["Location": "http://fixture.invalid/exfil"])!
        var allowed: URLRequest?
        var callbackInvoked = false
        blocker.urlSession(session, task: task, willPerformHTTPRedirection: response,
            newRequest: URLRequest(url: URL(string: "http://fixture.invalid/exfil")!)) {
            callbackInvoked = true
            allowed = $0
        }
        #expect(callbackInvoked)
        #expect(allowed == nil)
        task.cancel()
        session.invalidateAndCancel()
    }

    @Test("Wavelog catalogue check does not become a new download")
    func wavelogCatalogMetadata() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let updater = try fixtureUpdater(directory: directory)
        let url = URL(string: "https://fixture.invalid")!
        ReferenceMetadataURLProtocol.configure(["/index.php/api/v2/catalog": 200])
        let first = try await updater.refreshWavelogCatalog(baseURL: url, token: "fixture-token")
        let downloaded = try #require(first.sourceMetadata["wavelog-catalog.json"]?.downloadedAt)
        ReferenceMetadataURLProtocol.configure(["/index.php/api/v2/catalog": 304])
        let checked = try await updater.refreshWavelogCatalog(baseURL: url, token: "fixture-token")
        #expect(checked.sourceMetadata["wavelog-catalog.json"]?.downloadedAt == downloaded)
        #expect(checked.sourceMetadata["wavelog-catalog.json"]?.status == "up_to_date")
        #expect(checked.sourceMetadata["wavelog-catalog.json"]?.checkedAt != nil)
        #expect(ReferenceMetadataURLProtocol.requestedPaths() == ["/index.php/api/v2/catalog"])

        ReferenceMetadataURLProtocol.configure(["/index.php/api/v2/catalog": 304])
        let frontController = URL(string: "https://fixture.invalid/index.php")!
        let fromFrontController = try await updater.refreshWavelogCatalog(baseURL: frontController, token: "fixture-token")
        #expect(fromFrontController.sourceMetadata["wavelog-catalog.json"]?.status == "up_to_date")
        #expect(ReferenceMetadataURLProtocol.requestedPaths() == ["/index.php/api/v2/catalog"])
    }

    @Test("Changed source URL or credential never reuses a prior validator or cache on 304")
    func validatorsAreSourceScoped() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let updater = try fixtureUpdater(directory: directory)
        let oldURL = URL(string: "https://fixture.invalid/cty.xml")!
        let newURL = URL(string: "https://fixture.invalid/cty-new.xml?private=fixture-secret")!
        let lotw = URL(string: "https://fixture.invalid/lotw.csv")!
        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/lotw.csv": 200])
        let first = try await updater.refresh(clubLogURL: oldURL, clubLogAPIKey: "old-key", lotwURL: lotw)
        let original = try Data(contentsOf: directory.appendingPathComponent("cty.xml"))
        let firstIdentity = try #require(first.validators["cty.xml"]?.sourceIdentity)

        ReferenceMetadataURLProtocol.configure(["/cty-new.xml": 304, "/lotw.csv": 304])
        await #expect(throws: ReferenceDataUpdaterError.self) {
            try await updater.refresh(clubLogURL: newURL, clubLogAPIKey: "new-key", lotwURL: lotw)
        }
        let requested = ReferenceMetadataURLProtocol.requestedPaths()
        let tags = ReferenceMetadataURLProtocol.requestedETags()
        let changedIndex = try #require(requested.firstIndex(of: "/cty-new.xml"))
        #expect(tags[changedIndex] == nil)
        #expect(try Data(contentsOf: directory.appendingPathComponent("cty.xml")) == original)
        let failed = await updater.currentState()
        #expect(failed.validators["cty.xml"]?.sourceIdentity == firstIdentity)
        #expect(failed.sourceMetadata["cty.xml"]?.status == "failed")
        let persisted = try String(contentsOf: directory.appendingPathComponent("state.json"), encoding: .utf8)
        #expect(!persisted.contains("fixture-secret"))
        #expect(!persisted.contains("new-key"))
        #expect(!persisted.contains("fixture.invalid"))

        ReferenceMetadataURLProtocol.configure(["/cty-new.xml": 200, "/lotw.csv": 304],
            bodies: ["/cty-new.xml": ReferenceMetadataURLProtocol.validCTY])
        let replaced = try await updater.refresh(clubLogURL: newURL, clubLogAPIKey: "new-key", lotwURL: lotw)
        #expect(replaced.validators["cty.xml"]?.sourceIdentity != firstIdentity)
        #expect(replaced.sourceMetadata["cty.xml"]?.status == "downloaded")
    }

    @Test("Changing a Wavelog bearer scope cannot accept an earlier catalogue 304")
    func wavelogValidatorTokenScope() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let updater = try fixtureUpdater(directory: directory)
        let base = URL(string: "https://fixture.invalid/index.php")!
        let path = "/index.php/api/v2/catalog"
        ReferenceMetadataURLProtocol.configure([path: 200])
        let first = try await updater.refreshWavelogCatalog(baseURL: base, token: "first-secret")
        let oldIdentity = try #require(first.validators["wavelog-catalog.json"]?.sourceIdentity)
        let original = try Data(contentsOf: directory.appendingPathComponent("wavelog-catalog.json"))
        ReferenceMetadataURLProtocol.configure([path: 304])
        await #expect(throws: ReferenceDataUpdaterError.self) {
            try await updater.refreshWavelogCatalog(baseURL: base, token: "second-secret")
        }
        #expect(ReferenceMetadataURLProtocol.requestedETags() == [nil])
        #expect(try Data(contentsOf: directory.appendingPathComponent("wavelog-catalog.json")) == original)
        let failed = await updater.currentState()
        #expect(failed.validators["wavelog-catalog.json"]?.sourceIdentity == oldIdentity)
        let persisted = try String(contentsOf: directory.appendingPathComponent("state.json"), encoding: .utf8)
        #expect(!persisted.contains("first-secret"))
        #expect(!persisted.contains("second-secret"))
    }

    @Test("Invalid CTY and LoTW responses never replace a usable cache or pass 304")
    func semanticValidationPreservesCache() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let updater = try fixtureUpdater(directory: directory)
        let club = URL(string: "https://fixture.invalid/cty.xml")!
        let lotw = URL(string: "https://fixture.invalid/lotw.csv")!
        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/lotw.csv": 200])
        let initial = try await updater.refresh(clubLogURL: club, clubLogAPIKey: "", lotwURL: lotw)
        let ctyCache = directory.appendingPathComponent("cty.xml")
        let lotwCache = directory.appendingPathComponent("lotw-user-activity.csv")
        let goodCTY = try Data(contentsOf: ctyCache)
        let goodLoTW = try Data(contentsOf: lotwCache)

        let emptyXML = Data(("<?xml version=\"1.0\"?><clublog>" + String(repeating: " ", count: 10_000) + "</clublog>").utf8)
        let fakeCSV = Data(String(repeating: "call,date\n", count: 150).utf8)
        ReferenceMetadataURLProtocol.configure(["/cty.xml": 200, "/lotw.csv": 200],
                                               bodies: ["/cty.xml": emptyXML, "/lotw.csv": fakeCSV])
        await #expect(throws: ReferenceDataUpdaterError.self) {
            try await updater.refresh(clubLogURL: club, clubLogAPIKey: "", lotwURL: lotw)
        }
        #expect(try Data(contentsOf: ctyCache) == goodCTY)
        #expect(try Data(contentsOf: lotwCache) == goodLoTW)
        let failed = await updater.currentState()
        #expect(failed.sourceMetadata["cty.xml"]?.status == "failed")
        #expect(failed.sourceMetadata["lotw-user-activity.csv"]?.status == "failed")
        #expect(failed.validators == initial.validators)

        try emptyXML.write(to: ctyCache)
        try fakeCSV.write(to: lotwCache)
        ReferenceMetadataURLProtocol.configure(["/cty.xml": 304, "/lotw.csv": 304])
        await #expect(throws: ReferenceDataUpdaterError.self) {
            try await updater.refresh(clubLogURL: club, clubLogAPIKey: "", lotwURL: lotw)
        }
        let invalid304 = await updater.currentState()
        #expect(invalid304.sourceMetadata["cty.xml"]?.status == "failed")
        #expect(invalid304.sourceMetadata["lotw-user-activity.csv"]?.status == "failed")
        #expect(invalid304.validators == initial.validators)
    }

    @Test("Conditional activation refresh preserves validated cache and rejects corrupt replacements")
    func conditionalActivationRefresh() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }

        ConditionalReferenceURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ConditionalReferenceURLProtocol.self]
        let updater = try ReferenceDataUpdater(
            directory: directory,
            session: URLSession(configuration: configuration)
        )

        let first = try await updater.refreshActivationDirectory(.pota)
        #expect(first.activationCounts[ActivationReferenceKind.pota.rawValue] == 10_000)
        let downloadedAt = try #require(first.sourceMetadata[ActivationReferenceKind.pota.fileName]?.downloadedAt)
        #expect(first.sourceMetadata[ActivationReferenceKind.pota.fileName]?.status == "downloaded")
        #expect(first.validators[ActivationReferenceKind.pota.fileName]?.eTag == "\"pota-v1\"")
        #expect(first.validators[ActivationReferenceKind.pota.fileName]?.lastModified == "Sat, 10 Oct 2026 10:00:00 GMT")

        let cacheURL = directory.appendingPathComponent(ActivationReferenceKind.pota.fileName)
        let originalCache = try Data(contentsOf: cacheURL)
        let second = try await updater.refreshActivationDirectory(.pota)
        let headers = ConditionalReferenceURLProtocol.headers()
        #expect(headers.count == 2)
        #expect(headers[1].ifNoneMatch == "\"pota-v1\"")
        #expect(headers[1].ifModifiedSince == "Sat, 10 Oct 2026 10:00:00 GMT")
        #expect(second.activationCounts[ActivationReferenceKind.pota.rawValue] == 10_000)
        #expect(second.sourceMetadata[ActivationReferenceKind.pota.fileName]?.status == "up_to_date")
        #expect(second.sourceMetadata[ActivationReferenceKind.pota.fileName]?.downloadedAt == downloadedAt)
        #expect(try Data(contentsOf: cacheURL) == originalCache)

        var rejectedCorruptReplacement = false
        do {
            _ = try await updater.refreshActivationDirectory(.pota)
        } catch {
            rejectedCorruptReplacement = true
        }
        #expect(rejectedCorruptReplacement)
        #expect(try Data(contentsOf: cacheURL) == originalCache)
        let failed = await updater.currentState()
        #expect(failed.activationCounts == second.activationCounts)
        #expect(failed.validators == second.validators)
        #expect(failed.sourceMetadata[ActivationReferenceKind.pota.fileName]?.downloadedAt == downloadedAt)
        #expect(failed.sourceMetadata[ActivationReferenceKind.pota.fileName]?.checkedAt == second.sourceMetadata[ActivationReferenceKind.pota.fileName]?.checkedAt)
        #expect(failed.sourceMetadata[ActivationReferenceKind.pota.fileName]?.status == "failed")
        #expect(failed.sourceMetadata[ActivationReferenceKind.pota.fileName]?.lastError == "download_or_validation_failed")
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock(); defer { unlock() }
        return body()
    }
}
