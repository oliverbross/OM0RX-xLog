import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import XLogPrototypeSupport

private let weatherFixture = Data(#"{"current":{"time":"2026-10-13T01:00","temperature_2m":21.5,"apparent_temperature":22,"weather_code":1,"wind_speed_10m":4,"wind_direction_10m":180,"precipitation":0,"pressure_msl":1013,"cloud_cover":10}}"#.utf8)
private let solarFixture = Data("""
<solar><updated>13 Oct 2026 0100 GMT</updated><solarflux>122</solarflux><aindex>13</aindex><kindex>1</kindex><xray>A1</xray>
<calculatedconditions><band name="80m-40m" time="day">Fair</band><band name="80m-40m" time="night">Good</band></calculatedconditions></solar>
""".utf8)

private final class PublicClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: 1_791_849_600)
    func now() -> Date { lock.withLock { value } }
    func advance() { lock.withLock { value += 601 } }
}

private actor PublicFeedFixture {
    var count = 0
    var fail = false
    var delay: UInt64 = 0
    private var held = false
    private var releases: [CheckedContinuation<Void, Never>] = []
    func configure(fail: Bool = false, delay: UInt64 = 0) { self.fail = fail; self.delay = delay }
    func hold() { held = true }
    func release() {
        held = false
        let pending = releases
        releases.removeAll()
        for continuation in pending { continuation.resume() }
    }
    func fetch(_ request: URLRequest, _ format: OpportunityDownload.Format, _ limit: Int) async throws -> Data {
        count += 1
        #expect(request.url?.scheme == "https")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(limit == 256_000)
        if held { await withCheckedContinuation { releases.append($0) } }
        if delay > 0 { try await Task.sleep(nanoseconds: delay) }
        if fail { throw URLError(.notConnectedToInternet) }
        return request.url?.host == "www.hamqsl.com" ? solarFixture : weatherFixture
    }
}

@Suite("Shared public conditions and local callsign lookup")
struct LivePublicServiceMethodsTests {
    private func workspace(_ root: URL, grid: String = "JN88TQ") throws -> LiveLogbookMethods {
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        try setGrid(grid, logbook: logbook)
        return logbook
    }
    private func setGrid(_ grid: String, logbook: LiveLogbookMethods) throws {
        var settings = try #require(logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        settings["gridSquare"] = grid
        _ = try logbook.saveSettingsForTest(settings)
    }
    private func waitFor(_ predicate: () async -> Bool) async throws {
        for _ in 0..<200 {
            if await predicate() { return }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        Issue.record("Fixture condition did not complete")
    }
    private func request(_ worker: LiveWorker, _ method: String) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": [:]])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
    }

    @Test("Offline lookup uses workspace CTY and origin with no network or credential access")
    func offlineLookup() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LivePublicServiceMethods(logbook: try workspace(root), download: { _, _, _ in
            Issue.record("Offline lookup attempted HTTP"); throw URLError(.unsupportedURL)
        })
        let profile = try await service.handle(method: "lookup_call", params: ["call": "k1abc"])
        #expect(profile["call"] as? String == "K1ABC")
        #expect(profile["source"] as? String == "CTY approximate")
        #expect(profile["qrz_available"] as? Bool == false)
        #expect((profile["distance_km"] as? Double ?? 0) > 1000)
        #expect(profile["bearing"] as? Double != nil)
        for invalid in ["", "A\nB", "é", String(repeating: "A", count: 33)] {
            await #expect(throws: WorkerFailure.self) { try await service.handle(method: "lookup_call", params: ["call": invalid]) }
        }
        await service.terminate()
    }

    @Test("Propagation returns immediately, coalesces polls and retains observation after refresh failure")
    func propagationCache() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let clock = PublicClock(), feed = PublicFeedFixture()
        await feed.configure(delay: 30_000_000)
        let service = LivePublicServiceMethods(logbook: try workspace(root), now: { clock.now() }, download: { try await feed.fetch($0, $1, $2) })
        #expect(try await service.handle(method: "propagation_snapshot", params: [:])["status"] as? String == "Not loaded")
        for _ in 0..<10 { _ = try await service.handle(method: "propagation_snapshot", params: [:]) }
        try await waitFor { (try? await service.handle(method: "propagation_snapshot", params: [:])["stale"] as? Bool) == false }
        let current = try await service.handle(method: "propagation_snapshot", params: [:])
        #expect(current["solar_flux"] as? Int == 122)
        #expect((current["bands"] as? [[String: String]])?.count == 5)
        #expect(await feed.count == 1)
        clock.advance()
        await feed.configure(fail: true)
        _ = try await service.handle(method: "propagation_snapshot", params: [:])
        try await waitFor { (try? await service.handle(method: "propagation_snapshot", params: [:])["stale"] as? Bool) == true }
        let stale = try await service.handle(method: "propagation_snapshot", params: [:])
        #expect(stale["solar_flux"] as? Int == 122)
        #expect(stale["received_at"] as? Double == current["received_at"] as? Double)
        #expect(await feed.count == 2)
        await service.terminate()
    }

    @Test("Weather uses native decoding, shares concurrent requests and rejects changed grid")
    func weatherOwnership() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = try workspace(root), feed = PublicFeedFixture()
        await feed.configure(delay: 100_000_000)
        let service = LivePublicServiceMethods(logbook: logbook, download: { try await feed.fetch($0, $1, $2) })
        let first = Task { try await service.handle(method: "weather", params: [:]) }
        let second = Task { try await service.handle(method: "weather", params: [:]) }
        #expect(try await first.value["temperature_c"] as? Double == 21.5)
        #expect(try await second.value["condition"] as? String == "Mostly clear")
        #expect(await feed.count == 1)
        // Settings persistence may take longer than a fixed download delay on CI.
        // Hold this response until the location change has actually committed.
        await feed.hold()
        let changed = Task { try await service.handle(method: "weather", params: [:]) }
        try await waitFor { await feed.count == 2 }
        do { try setGrid("FN31PR", logbook: logbook) }
        catch { await feed.release(); throw error }
        await feed.release()
        do { _ = try await changed.value; Issue.record("Old-location weather was published") }
        catch let error as WorkerFailure { #expect(error.code == "weather_location_changed") }
        await service.terminate()
    }

    @Test("Worker routes conditions, terminates in-flight requests and denies isolated acceptance access")
    func workerLifecycle() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = try workspace(root), feed = PublicFeedFixture()
        let service = LivePublicServiceMethods(logbook: logbook, download: { try await feed.fetch($0, $1, $2) })
        let worker = LiveWorker(logbook: logbook, publicServices: service)
        let value = try await request(worker, "weather")
        #expect((value["result"] as? [String: Any])?["temperature_c"] as? Double == 21.5)
        #if !os(macOS)
        let lookupRequest = try JSONSerialization.data(withJSONObject: ["id": "lookup", "method": "lookup_call", "params": ["call": "K1ABC"]])
        let lookupReply = try #require(JSONSerialization.jsonObject(with: await worker.response(to: lookupRequest)) as? [String: Any])
        #expect((lookupReply["result"] as? [String: Any])?["source"] as? String == "CTY approximate")
        #endif
        await feed.configure(delay: 5_000_000_000)
        let pending = Task { try await request(worker, "weather") }
        try await waitFor { await feed.count == 2 }
        await worker.shutdown()
        #expect(try await pending.value["ok"] as? Bool == false)
        for method in ["weather", "propagation_snapshot", "lookup_call"] {
            #expect((try await request(worker, method)["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
        }
        let isolated = LiveWorker(logbook: logbook, localAcceptance: true)
        for method in ["weather", "propagation_snapshot", "lookup_call"] {
            #expect((try await request(isolated, method)["error"] as? [String: Any])?["code"] as? String == "acceptance_restricted")
        }
        let health = try await request(isolated, "health")["result"] as? [String: Any]
        #expect(health?["public_conditions"] as? Bool == false)
        #expect(health?["local_callsign_lookup"] as? Bool == false)
        await isolated.shutdown()
    }

    @Test("Missing grid and malformed parameters never start public HTTP requests")
    func validation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LivePublicServiceMethods(logbook: try workspace(root, grid: ""), download: { _, _, _ in
            Issue.record("Rejected parameters reached HTTP"); throw URLError(.unsupportedURL)
        })
        do { _ = try await service.handle(method: "weather", params: [:]); Issue.record("Missing grid accepted") }
        catch let error as WorkerFailure { #expect(error.code == "grid_required") }
        for method in ["weather", "propagation_snapshot", "lookup_call"] {
            await #expect(throws: WorkerFailure.self) { try await service.handle(method: method, params: ["unexpected": true]) }
        }
        await service.terminate()
    }
}
