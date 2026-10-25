import Foundation
import Testing
@testable import XLogCore

private final class TimingVerificationProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var cases: [String: String] = [:]
    private static var reads: [String: Int] = [:]
    static func configure(_ host: String, scenario: String) {
        lock.withLock { cases[host] = scenario; reads[host] = 0 }
    }
    static func readbacks(_ host: String) -> Int { lock.withLock { reads[host, default: 0] } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let host = request.url!.host!
        let scenario = Self.lock.withLock { Self.cases[host]! }
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
        let targeted = query.contains { $0.name == "since_id" && $0.value == "41" }
        var row: [String: Any] = ["id": 42, "station_id": 1, "call": "K1ABC", "band": "20m", "mode": "CW",
                                  "freq": 14025000, "qso_date": "2026-10-26 12:00:00"]
        let data: Data
        if query.contains(where: { $0.name == "format" && $0.value == "adif" }) {
            var record = ADIFRecord(fields: ["CALL": "K1ABC", "BAND": "20m", "MODE": "CW", "FREQ": "14.025000",
                "QSO_DATE": "20261026", "TIME_ON": "120000", "QSO_DATE_OFF": "20261026", "TIME_OFF": "120100"])
            if targeted {
                Self.lock.withLock { Self.reads[host, default: 0] += 1 }
                record.fields["TIME_OFF"] = scenario == "adif_wrong" ? "120100" : "120500"
                if scenario == "missing_adif" { record.fields.removeValue(forKey: "TIME_OFF") }
                if scenario == "wrong_identity" { record.fields["CALL"] = "DL1ABC" }
                if scenario == "wrong_date_off" { record.fields["QSO_DATE_OFF"] = "20261027" }
            }
            data = try! JSONEncoder().encode(WavelogADIFPage(
                data: WavelogADIFData(exported: 1, lastFetchedID: targeted && scenario == "wrong_id" ? 43 : 42, adif: record.adifDocument),
                meta: WavelogListMeta(page: 1, perPage: targeted ? 1 : 1000, count: 1, total: 1, totalPages: 1, hasMore: false)))
        } else if request.httpMethod == "PATCH" {
            if scenario == "json_ok" { row["time_off"] = "12:05:00" }
            if scenario == "json_wrong" { row["time_off"] = "12:01:00" }
            data = try! JSONSerialization.data(withJSONObject: ["data": row])
        } else if request.url!.path.hasSuffix("/42") {
            data = try! JSONSerialization.data(withJSONObject: ["data": row])
        } else {
            data = try! JSONSerialization.data(withJSONObject: ["data": [row], "meta": ["page": 1, "per_page": 1000,
                "count": 1, "total": 1, "total_pages": 1, "has_more": false]])
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

@Suite("Wavelog end-time verification")
struct WavelogTimingVerificationTests {
    @Test("A stale or missing TIME_OFF is not a verified PATCH")
    func staleResponse() throws {
        let record = ADIFRecord(fields: ["CALL": "K1ABC", "BAND": "20m", "MODE": "CW",
            "QSO_DATE": "20261026", "TIME_ON": "120000", "QSO_DATE_OFF": "20261026", "TIME_OFF": "120100"])
        let previous = try #require(QSO(adif: record))
        var proposed = previous; proposed.end = previous.start.addingTimeInterval(300)
        let fields = WavelogQSOUpdate(proposed, comparedTo: previous)
        for suffix in ["", ",\"time_off\":\"120100\"", ",\"time_off\":null"] {
            let response = try JSONDecoder().decode(WavelogQSO.self, from: Data("{\"id\":42,\"call\":\"K1ABC\",\"band\":\"20m\",\"mode\":\"CW\",\"qso_date\":\"2026-10-26 12:00:00\"\(suffix)}".utf8))
            #expect(!fields.isRepresented(by: response))
        }
    }

    @Test("Only an exact JSON or ADIF end readback acknowledges the edit", arguments:
        ["json_ok", "json_wrong", "adif_ok", "adif_wrong", "missing_adif", "wrong_identity", "wrong_id", "wrong_date_off"])
    func endTimeSync(scenario: String) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        defer { database.close() }
        let baseline = ADIFRecord(fields: ["CALL": "K1ABC", "BAND": "20m", "MODE": "CW", "FREQ": "14.025000",
            "QSO_DATE": "20261026", "TIME_ON": "120000", "QSO_DATE_OFF": "20261026", "TIME_OFF": "120100"])
        var qso = try #require(QSO(adif: baseline, wavelogID: 42)); qso.stationProfileID = 1
        try database.save(qso, markDirty: false)
        qso.end = qso.start.addingTimeInterval(300)
        try database.save(qso)
        let host = "timing-\(UUID().uuidString.lowercased()).invalid"
        TimingVerificationProtocol.configure(host, scenario: scenario)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TimingVerificationProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let destination = try WavelogConfiguration(baseURL: URL(string: "https://\(host)")!, token: "wl2_fixture", stationID: 1)
        let report = try await SyncEngine(database: database, configuration: destination, session: session).synchronize()
        let success = ["json_ok", "adif_ok"].contains(scenario)
        #expect(report.pushed == (success ? 1 : 0))
        #expect(report.failed == (success ? 0 : 1))
        #expect(try database.lookup(localID: qso.id)?.isDirty == !success)
        #expect(TimingVerificationProtocol.readbacks(host) == (scenario.hasPrefix("json_") ? 0 : 1))
    }
}
