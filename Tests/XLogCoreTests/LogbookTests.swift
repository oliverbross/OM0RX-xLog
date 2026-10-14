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

private final class SyncURLProtocol: URLProtocol {
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

private final class PagedSyncURLProtocol: URLProtocol {
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

private final class UnstablePagedSyncURLProtocol: URLProtocol {
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
    @Test("Semantic identity normalizes mixed timestamp whitespace")
    func semanticTimestampWhitespace() {
        let mixedWhitespace = SemanticQSOIdentity(
            call: " om0rx ",
            timestamp: "2026-10-12\t 09:30:00",
            band: "20M",
            mode: "cw"
        )
        let canonical = SemanticQSOIdentity(
            call: "OM0RX",
            timestamp: "2026-10-12 09:30:00",
            band: "20m",
            mode: "CW"
        )

        #expect(mixedWhitespace == canonical)
        #expect(mixedWhitespace.timestamp == "2026-10-12 09:30:00")
    }

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

    @Test("Callsign matrix includes old confirmations beyond the history page and aggregates each cell")
    func completeCallsignMatrix() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        try database.save(QSO(call: "K1ABC", start: Date(timeIntervalSince1970: 1), band: "160m", mode: "CW", lotwReceived: "Y"))
        for index in 0..<2_001 {
            try database.save(QSO(call: "K1ABC", start: Date(timeIntervalSince1970: Double(index + 100)), band: "20m", mode: "SSB", qslReceived: index == 0 ? "Y" : "N"))
        }
        var deleted = QSO(call: "K1ABC", start: Date(timeIntervalSince1970: 50), band: "6m", mode: "CW", qslReceived: "Y")
        deleted.deletedAt = Date(); try database.save(deleted)
        try database.save(QSO(call: "OTHER", start: Date(timeIntervalSince1970: 60), band: "40m", mode: "CW"))
        let cells = try database.bandModeMatrix(call: "k1abc")
        #expect(cells.count == 2)
        #expect(cells.contains(BandModeCell(band: "160m", mode: "CW", worked: true, confirmed: true)))
        #expect(cells.contains(BandModeCell(band: "20m", mode: "SSB", worked: true, confirmed: true)))
    }

    @Test("DXCC summary is independent from exact callsign history")
    func dxccSummary() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        try database.save(QSO(
            call: "VK4JAZ", start: Date(timeIntervalSince1970: 100), band: "20m", mode: "SSB",
            country: "Australia", dxcc: 150, qslReceived: "Y"
        ))
        try database.save(QSO(
            call: "VK8NSB", start: Date(timeIntervalSince1970: 200), band: "40m", mode: "CW",
            country: "Australia", dxcc: 150
        ))

        let summary = try database.dxccSummary(dxcc: 150)
        #expect(try database.previous(call: "VK4JAZ").count == 1)
        #expect(summary.qsoCount == 2)
        #expect(summary.confirmedCount == 1)
        #expect(summary.latest?.call == "VK8NSB")
        #expect(summary.matrix.contains(BandModeCell(band: "20m", mode: "SSB", worked: true, confirmed: true)))
        #expect(summary.matrix.contains(BandModeCell(band: "40m", mode: "CW", worked: true, confirmed: false)))
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

    @Test("Bundled DXCC boundary data is valid and representative")
    func bundledDXCCBoundaries() throws {
        let boundaries = try DXCCBoundaryStore.bundled()
        #expect(boundaries.count >= 330)
        #expect(boundaries.contains(where: { $0.adif == 291 && !$0.polygons.isEmpty }))
        #expect(boundaries.contains(where: { $0.adif == 150 && !$0.polygons.isEmpty }))
        #expect(boundaries.allSatisfy { boundary in
            boundary.polygons.allSatisfy { $0.outerRing.count >= 4 }
        })
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
        let shortRoute = GreatCircle.route(from: darwin, to: bratislava, longPath: false)
        let longRoute = GreatCircle.route(from: darwin, to: bratislava, longPath: true)
        #expect(shortRoute.first == darwin)
        #expect(shortRoute.last == bratislava)
        #expect(longRoute.first == darwin)
        #expect(longRoute.last == bratislava)
        #expect(shortRoute[shortRoute.count / 2] != longRoute[longRoute.count / 2])
    }

    @Test("Solar ephemeris produces a plausible Sun and terminator")
    func solarEphemeris() {
        let equinox = Date(timeIntervalSince1970: 1_710_903_960) // 2024-03-20 03:06 UTC
        let equinoxState = SolarEphemeris.state(at: equinox, samples: 72)
        #expect(abs(equinoxState.subsolarPoint.latitude) < 1)
        #expect(equinoxState.subsolarPoint.longitude > 120)
        #expect(equinoxState.subsolarPoint.longitude < 150)
        #expect(equinoxState.terminator.count == 73)

        for (index, point) in equinoxState.terminator.dropLast().enumerated() where index.isMultiple(of: 12) {
            let separation = GreatCircle.solve(from: equinoxState.subsolarPoint, to: point)
            #expect(abs(separation.distanceKilometres - 10_007.5) < 2)
        }

        let juneSolstice = Date(timeIntervalSince1970: 1_718_917_860) // 2024-06-20 20:51 UTC
        let junePoint = SolarEphemeris.subsolarPoint(at: juneSolstice)
        #expect(junePoint.latitude > 23)
        #expect(junePoint.latitude < 24)
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

    @Test("Verified backup previews and restores the complete local database")
    func verifiedBackupAndRestore() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let sourceURL = directory.appendingPathComponent("source.sqlite")
        let source = try LogbookDatabase(url: sourceURL)
        let original = QSO(
            call: "VK8NSB",
            start: Date(timeIntervalSince1970: 1_760_000_000),
            band: "80m",
            mode: "SSB",
            frequencyHz: 3_532_000,
            country: "Australia",
            dxcc: 150
        )
        try source.save(original)

        var settings = XLogSettings.defaults
        settings.gridSquare = "JN88TQ"
        settings.wavelogStationID = 7
        let preferences = XLogBackupPreferences(
            deskBandMapBands: ["80m"],
            detachedBandMapBands: ["160m", "40m"],
            deskBandMapFollowsRadio: true,
            detachedBandMapLayout: "Adaptive grid",
            bandMapFontScale: 1.4,
            intelligenceBands: ["160m", "80m", "40m"],
            clusterSpotOpensFullEditor: false
        )
        let packageURL = directory.appendingPathComponent("station.xlogbackup")
        let manager = XLogBackupManager()
        let created = try manager.create(
            database: source,
            at: packageURL,
            settings: settings,
            preferences: preferences
        )

        #expect(created.manifest.qsoCount == 1)
        #expect(created.manifest.pendingSyncCount == 1)
        #expect(created.manifest.databaseBytes > 0)
        #expect(created.manifest.databaseSHA256.count == 64)
        #expect(created.settings?.gridSquare == "JN88TQ")
        #expect(created.preferences == preferences)

        let liveURL = directory.appendingPathComponent("live.sqlite")
        let live = try LogbookDatabase(url: liveURL)
        try live.save(QSO(call: "WRONG", band: "20m", mode: "CW"))
        live.close()
        let rollback = try manager.installDatabase(from: packageURL, to: liveURL)
        #expect(rollback != nil)
        #expect(rollback.map { FileManager.default.fileExists(atPath: $0.path) } == true)

        let restored = try LogbookDatabase(url: liveURL)
        let restoredQSO = try #require(restored.fetch().first)
        #expect(restoredQSO.call == "VK8NSB")
        #expect(restoredQSO.band == "80m")
        #expect(try restored.fetch().count == 1)
    }

    @Test("Backup inspection rejects a changed database")
    func backupChecksumRejectsMutation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let database = try LogbookDatabase(url: directory.appendingPathComponent("source.sqlite"))
        try database.save(QSO(call: "OM0RX", band: "40m", mode: "CW"))
        let packageURL = directory.appendingPathComponent("station.xlogbackup")
        let manager = XLogBackupManager()
        _ = try manager.create(
            database: database,
            at: packageURL,
            settings: .defaults,
            preferences: XLogBackupPreferences(
                deskBandMapBands: ["40m"],
                detachedBandMapBands: ["40m"],
                deskBandMapFollowsRadio: true,
                detachedBandMapLayout: "Adaptive grid",
                bandMapFontScale: 1,
                intelligenceBands: ["40m"],
                clusterSpotOpensFullEditor: false
            )
        )
        let backupDatabase = packageURL.appendingPathComponent("OM0RX-xLog.sqlite")
        let handle = try FileHandle(forWritingTo: backupDatabase)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data([0x00]))
        try handle.close()

        #expect(throws: XLogBackupError.self) {
            _ = try manager.inspect(at: packageURL)
        }
    }

    @Test("Activation directory parses exact matches and prefix suggestions")
    func activationDirectoryMatches() throws {
        let pota = Data("""
        "reference","name","active","entityId","locationDesc","latitude","longitude","grid"
        "US-0001","Acadia National Park","1","291","US-ME","44.31","-68.2034","FN54vh"
        "US-1234","Park, With Comma","1","291","US-VA","38.1","-77.2","FM18jb"
        """.utf8)
        let records = try ActivationReferenceDirectory.parse(data: pota, kind: .pota)
        let directory = ActivationReferenceDirectory(records: records)

        #expect(directory.count(for: .pota) == 2)
        #expect(directory.exactMatch("us-1234", kind: .pota)?.name == "Park, With Comma")
        #expect(directory.prefixMatches("US-12", kind: .pota).first?.reference == "US-1234")
    }

    @Test("SOTA, IOTA and WWFF official formats preserve names and locations")
    func activationDirectoryFormats() throws {
        let sota = Data("""
        SOTA Summits List (Date=11/10/2026)
        SummitCode,AssociationName,RegionName,SummitName,AltM,AltFt,GridRef1,GridRef2,Longitude,Latitude,Points
        3B8/MU-001,Mauritius,Mauritius,"Piton de la Petite Rivière Noire",828,2716,57.4,-20.4,57.4,-20.4,10
        """.utf8)
        let iota = Data("""
        [{"refno":"AF-001","name":"Agalega Islands","dxcc_num":"4","latitude_max":"-10.75","latitude_min":"-10.00","longitude_max":"57.00","longitude_min":"56.25"}]
        """.utf8)
        let wwff = Data("""
        reference,status,name,program,dxcc,state,county,continent,iota,iaruLocator,latitude,longitude,country
        OMFF-0001,active,"Protected Area, One",OMFF,OM,OM,OM,EU,-,JN88AA,48.0,17.0,Slovakia
        """.utf8)

        let records = try ActivationReferenceDirectory.parse(data: sota, kind: .sota)
            + ActivationReferenceDirectory.parse(data: iota, kind: .iota)
            + ActivationReferenceDirectory.parse(data: wwff, kind: .wwff)
        let directory = ActivationReferenceDirectory(records: records)

        #expect(directory.exactMatch("3b8/mu-001", kind: .sota)?.name == "Piton de la Petite Rivière Noire")
        #expect(directory.exactMatch("AF-001", kind: .iota)?.detail == "DXCC #4")
        #expect(directory.exactMatch("OMFF-0001", kind: .wwff)?.grid == "JN88AA")
        #expect(directory.exactMatch("OMFF-0001", kind: .wwff)?.name == "Protected Area, One")
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock(); defer { unlock() }
        return body()
    }
}
