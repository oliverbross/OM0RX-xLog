import Foundation
import Testing
@testable import XLogCore

private func isADIFRequest(_ request: URLRequest) -> Bool {
    URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
        .queryItems?.contains(where: { $0.name == "format" && $0.value == "adif" }) == true
}

private func adifResponse(
    id: Int,
    call: String,
    page: Int,
    perPage: Int,
    total: Int,
    totalPages: Int,
    hasMore: Bool,
    comment: String = ""
) -> Data {
    let record = ADIFRecord(fields: [
        "CALL": call,
        "QSO_DATE": "20231114",
        "TIME_ON": "221320",
        "BAND": "20m",
        "MODE": "CW",
        "COUNTRY": "United States",
        "DXCC": "291",
        "CONT": "NA",
        "LOTW_QSL_RCVD": "Y",
        "COMMENT": comment,
    ])
    let response = WavelogADIFPage(
        data: WavelogADIFData(exported: 1, lastFetchedID: id, adif: record.adifDocument),
        meta: WavelogListMeta(page: page, perPage: perPage, count: 1, total: total, totalPages: totalPages, hasMore: hasMore)
    )
    return try! JSONEncoder().encode(response)
}

private final class SyncURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var recordedMethods: [String] = []

    static func reset() { lock.withLock { recordedMethods = [] } }
    static func methods() -> [String] { lock.withLock { recordedMethods } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.recordedMethods.append(request.httpMethod ?? "") }
        let body = isADIFRequest(request) ? adifResponse(
            id: 42, call: "OM0RX", page: 1, perPage: 1000, total: 1, totalPages: 1, hasMore: false, comment: "remote"
        ) : """
        {"data":[{"id":42,"station_id":1,"call":"OM0RX","band":"20m","mode":"CW","qso_date":"2023-11-14 22:13:20","comment":"remote"}],"meta":{"page":1,"per_page":1000,"count":1,"total":1,"total_pages":1,"has_more":false}}
        """.data(using: .utf8)!
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class PagedSyncURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let page = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "page" })?.value.flatMap(Int.init) ?? 1
        let hasMore = page < 101
        let body = isADIFRequest(request) ? adifResponse(
            id: page, call: "T\(page)", page: page, perPage: 1000, total: 101, totalPages: 101, hasMore: hasMore
        ) : """
        {"data":[{"id":\(page),"station_id":1,"call":"T\(page)","band":"20m","mode":"CW","qso_date":"2023-11-14 22:13:20"}],"meta":{"page":\(page),"per_page":1000,"count":1,"total":101,"total_pages":101,"has_more":\(hasMore)}}
        """.data(using: .utf8)!
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class UnstablePagedSyncURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let page = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "page" })?.value.flatMap(Int.init) ?? 1
        // Page two repeats page one's ID, modelling an insertion that shifted
        // offset pagination during the scan.
        let body = isADIFRequest(request) ? adifResponse(
            id: 1, call: "SHIFT", page: page, perPage: 1, total: 2, totalPages: 2, hasMore: page == 1
        ) : """
        {"data":[{"id":1,"station_id":1,"call":"SHIFT","band":"20m","mode":"CW","qso_date":"2023-11-14 22:13:20"}],"meta":{"page":\(page),"per_page":1,"count":1,"total":2,"total_pages":2,"has_more":\(page == 1)}}
        """.data(using: .utf8)!
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite("OM0RX-xLog core")
struct LogbookTests {
    @Test("Local save, history, matrix and deletion")
    func localLifecycle() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        var qso = QSO(
            call: "vk4jaz",
            start: Date(timeIntervalSince1970: 1_700_000_000),
            band: "20m",
            mode: "SSB",
            frequencyHz: 14_302_500,
            country: "Australia",
            dxcc: 150,
            qslReceived: "Y"
        )
        try database.save(qso)

        #expect(try database.fetch().count == 1)
        #expect(try database.previous(call: "VK4JAZ").first?.country == "Australia")
        #expect(try database.stats().confirmedCount == 1)
        #expect(try database.bandModeMatrix(call: "VK4JAZ").contains(BandModeCell(band: "20m", mode: "SSB", worked: true, confirmed: true)))

        qso.deletedAt = Date()
        try database.save(qso)
        #expect(try database.fetch().isEmpty)
        #expect(try database.pending().count == 1)
    }

    @Test("ADIF preserves unknown fields")
    func adifRoundTrip() throws {
        let source = "<ADIF_VER:5>3.1.7<EOH><CALL:5>OM0RX<QSO_DATE:8>20261011<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<APP_TEST:6>custom<EOR>"
        let record = try #require(ADIFParser().records(in: source).first)
        let qso = try #require(QSO(adif: record))
        #expect(qso.call == "OM0RX")
        #expect(qso.adifRecord["APP_TEST"] == "custom")
        #expect(qso.adifRecord["MODE"] == "CW")
    }

    @Test("Frequency conversion and band classification")
    func bandPlan() {
        #expect(BandPlan.frequencyHz(from: "14.074000") == 14_074_000)
        #expect(BandPlan.band(for: 14_074_000) == "20m")
        #expect(BandPlan.frequencyHz(from: "7074") == 7_074_000)
        let darwin = MaidenheadLocator.coordinate("PH57")
        #expect(darwin != nil)
        #expect((darwin?.latitude ?? 0) < 0)
        #expect((darwin?.longitude ?? 0) > 100)
    }

    @Test("Wavelog configuration accepts a full API v2 URL")
    func wavelogURLNormalization() throws {
        let configuration = try WavelogConfiguration(
            baseURL: URL(string: "https://example.test/index.php/api/v2")!,
            token: "wl2_test",
            stationID: 1
        )
        #expect(configuration.baseURL.absoluteString == "https://example.test/index.php")
    }

    @Test("Bundled CTY data resolves representative callsigns")
    func ctyResolution() throws {
        let resolver = try CTYResolver.bundled()
        #expect(resolver.resolve("VK4JAZ")?.adif == 150)
        #expect(resolver.resolve("OM0RX")?.continent == "EU")
        #expect(resolver.resolve("W1AW")?.adif == 291)
        #expect(resolver.resolve("W1AW")?.name.uppercased().contains("UNITED STATES") == true)
        #expect(resolver.entities.count > 200)
    }

    @Test("Great-circle bearings and distance support rotor paths")
    func greatCircle() {
        let darwin = GeoCoordinate(latitude: -12.4634, longitude: 130.8456)
        let bratislava = GeoCoordinate(latitude: 48.1486, longitude: 17.1077)
        let solution = GreatCircle.solve(from: darwin, to: bratislava)
        #expect(solution.distanceKilometres > 12_500)
        #expect(solution.distanceKilometres < 14_500)
        #expect(solution.shortPathBearing >= 0 && solution.shortPathBearing < 360)
        #expect(abs(solution.longPathBearing - ((solution.shortPathBearing + 180).truncatingRemainder(dividingBy: 360))) < 0.001)
    }

    @Test("Spot award references are promoted to ADIF fields")
    func awardReferenceExtraction() {
        let values = AwardReferenceParser.extract(
            comment: "CQ POTA VK-1234 SOTA VK1/AC-001 IOTA OC-001 VKFF-0456 WCA VK-00999",
            specialTags: ["POTA", "SOTA", "IOTA", "WWFF", "CASTLE"]
        )
        #expect(values.pota == "VK-1234")
        #expect(values.sota == "VK1/AC-001")
        #expect(values.iota == "OC-001")
        #expect(values.wwff == "VKFF-0456")
        #expect(values.sig == "CASTLE")
        #expect(values.sigInfo.contains("VK-00999"))
    }

    @Test("Remote collision is recorded and explicitly resolved")
    func conflictLifecycle() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let local = QSO(wavelogID: 42, call: "OM0RX", band: "20m", mode: "CW", comment: "local")
        try database.save(local)
        let remote = QSO(wavelogID: 42, call: "OM0RX", band: "40m", mode: "SSB", comment: "remote", isDirty: false)

        #expect(try database.mergeRemote(remote))
        let conflict = try #require(database.conflicts().first)
        #expect(conflict.localQSO.comment == "local")
        #expect(conflict.remoteQSO.comment == "remote")

        try database.resolveConflict(conflict, useRemote: true)
        #expect(try database.conflicts().isEmpty)
        #expect(try database.fetch().first?.comment == "remote")
        #expect(try database.fetch().first?.isDirty == false)
    }

    @Test("Remote merges preserve local-only and unknown ADIF fields")
    func remoteMergePreservesLocalFields() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let local = QSO(
            wavelogID: 42,
            call: "OM0RX",
            start: start,
            band: "20m",
            mode: "CW",
            country: "Slovakia",
            dxcc: 504,
            sig: "CASTLE",
            sigInfo: "OM-0001",
            comment: "baseline",
            radio: "FlexRadio",
            extraFields: ["APP_TEST": "custom"],
            isDirty: false
        )
        try database.save(local, markDirty: false)
        let remote = QSO(
            wavelogID: 42,
            call: "OM0RX",
            start: start,
            band: "20m",
            mode: "CW",
            comment: "remote",
            qslReceived: "Y",
            lotwReceived: "Y",
            isDirty: false
        )

        #expect(try !database.mergeRemote(remote))
        var merged = try #require(database.fetch().first)
        #expect(merged.comment == "remote")
        #expect(merged.country == "Slovakia")
        #expect(merged.dxcc == 504)
        #expect(merged.sig == "CASTLE")
        #expect(merged.sigInfo == "OM-0001")
        #expect(merged.radio == "FlexRadio")
        #expect(merged.extraFields["APP_TEST"] == "custom")
        #expect(merged.qslReceived == "Y")
        #expect(merged.lotwReceived == "Y")

        merged.extraFields["APP_TEST"] = "locally edited"
        try database.save(merged)
        #expect(try !database.mergeRemote(remote))
        #expect(try database.conflicts().isEmpty)
        #expect(try database.fetch().first?.extraFields["APP_TEST"] == "locally edited")
    }

    @Test("Sync preflights Wavelog and does not push a two-sided edit")
    func syncEnginePreflightConflict() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var local = QSO(wavelogID: 42, call: "OM0RX", start: start, band: "20m", mode: "CW", comment: "baseline", isDirty: false)
        try database.save(local, markDirty: false)
        local.comment = "local"
        try database.save(local)

        SyncURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SyncURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let settings = try WavelogConfiguration(baseURL: URL(string: "http://127.0.0.1")!, token: "wl2_test", stationID: 1)
        let report = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()

        #expect(report.conflicts == 1)
        #expect(report.pushed == 0)
        #expect(SyncURLProtocol.methods().count == 3)
        #expect(SyncURLProtocol.methods().allSatisfy { $0 == "GET" })
        #expect(try database.fetch().first?.comment == "local")
        #expect(try database.fetch().first?.isDirty == true)
        let conflict = try #require(database.conflicts().first)
        #expect(conflict.remoteQSO.comment == "remote")
        #expect(conflict.remoteQSO.dxcc == 291)
        #expect(conflict.remoteQSO.country == "United States")
        #expect(conflict.remoteQSO.lotwReceived == "Y")
    }

    @Test("Sync completes every remote page before deletion reconciliation")
    func syncEngineReadsPastOneHundredPages() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PagedSyncURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let settings = try WavelogConfiguration(baseURL: URL(string: "http://127.0.0.1")!, token: "wl2_test", stationID: 1)

        let report = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()

        #expect(report.pulled == 101)
        #expect(report.deleted == 0)
        #expect(try database.fetch(limit: 200).count == 101)
    }

    @Test("Unstable pagination fails closed before remote deletion reconciliation")
    func unstablePaginationDoesNotDelete() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let existing = QSO(wavelogID: 99, call: "KEEP", band: "40m", mode: "CW", isDirty: false)
        try database.save(existing, markDirty: false)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UnstablePagedSyncURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let settings = try WavelogConfiguration(baseURL: URL(string: "http://127.0.0.1")!, token: "wl2_test", stationID: 1)

        var failedClosed = false
        do {
            _ = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()
        } catch WavelogClientError.invalidResponse {
            failedClosed = true
        }

        #expect(failedClosed)
        #expect(try database.fetch(limit: 10).contains(where: { $0.wavelogID == 99 && $0.deletedAt == nil }))
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock(); defer { unlock() }
        return body()
    }
}
