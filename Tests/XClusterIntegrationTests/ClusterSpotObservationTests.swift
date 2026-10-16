import Foundation
import XCTest
@testable import XClusterIntegrationCore

private final class ObservationTransport: ClusterConnectionTransport, @unchecked Sendable {
    var onState: (@Sendable (ClusterConnectionPhase, String?) -> Void)?
    var onLine: (@Sendable (String) -> Void)?
    var stopped = false
    var optionUpdates = 0
    func start() { onState?(.connected, nil) }
    func send(_ command: String) {}
    func stop() { stopped = true }
    func updateOptions(reconnect: Bool, requestSkimmer: Bool) { optionUpdates += 1 }
    func emit(_ line: String) { onLine?(line) }
    func phase(_ phase: ClusterConnectionPhase, error: String? = nil) { onState?(phase, error) }
}

private final class ObservationRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var observations: [ClusterSpotObservation] = []
    private var connections: [ClusterHistoryConnectionEvent] = []
    private var order: [String] = []
    func observe(_ value: ClusterSpotObservation) {
        lock.withLock { observations.append(value); order.append("spot:\(value.sequence)") }
    }
    func connection(_ value: ClusterHistoryConnectionEvent) {
        lock.withLock { connections.append(value); order.append(value.phase.rawValue) }
    }
    var spots: [ClusterSpotObservation] { lock.withLock { observations } }
    var events: [ClusterHistoryConnectionEvent] { lock.withLock { connections } }
    var chronology: [String] { lock.withLock { order } }
}

private final class ObservationSupplier: @unchecked Sendable {
    private let lock = NSLock()
    private var offset = 0
    let transports: [ObservationTransport]
    init(_ transports: [ObservationTransport]) { self.transports = transports }
    func make(state: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
              line: @escaping @Sendable (String) -> Void) -> ObservationTransport {
        let transport = lock.withLock { let result = transports[offset]; offset += 1; return result }
        transport.onState = state
        transport.onLine = line
        return transport
    }
}

final class ClusterSpotObservationTests: XCTestCase {
    private func fixture(_ config: ClusterSessionConfiguration, _ recorder: ObservationRecorder,
                         _ transports: [ObservationTransport]) -> ClusterSessionService {
        let supplier = ObservationSupplier(transports)
        return ClusterSessionService(configuration: config,
            onObservation: { recorder.observe($0) }, onHistoryConnection: { recorder.connection($0) },
            transportFactory: { _, _, _, _, state, line in supplier.make(state: state, line: line) })
    }

    private func waitFor(_ predicate: @escaping () async -> Bool) async throws {
        for _ in 0..<200 {
            if await predicate() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Ordered observation did not arrive")
    }

    private var server: ClusterServerConfiguration {
        .init(name: "Fixture", host: "fixture.invalid", port: 7300, callsign: "OM0RX")
    }

    func testIdenticalReportsRetainSeparateOrderedIdentitiesBeforeLiveGrouping() async throws {
        let source = server, recorder = ObservationRecorder(), transport = ObservationTransport()
        let service = fixture(.init(servers: [source]), recorder, [transport])
        try await service.connect()
        let line = "DX de W1AW: 14025.0010 K1ABC CW"
        let before = Date()
        transport.emit(line)
        transport.emit(line)
        let after = Date()
        try await waitFor { recorder.spots.count == 2 }
        let captured = recorder.spots
        XCTAssertEqual(captured.map(\.sequence), [1, 2])
        XCTAssertNotEqual(captured[0].id, captured[1].id)
        XCTAssertEqual(captured[0].sessionID, captured[1].sessionID)
        XCTAssertEqual(captured.map(\.rawLine), [line, line])
        XCTAssertEqual(captured.map { $0.raw.frequencyText }, ["14025.0010", "14025.0010"])
        XCTAssertEqual(captured.map { $0.classified.aggregateCount }, [1, 1])
        XCTAssertTrue(captured.allSatisfy { $0.arrivedAt >= before && $0.arrivedAt <= after })
        XCTAssertTrue(captured.allSatisfy { $0.raw.receivedAt == $0.arrivedAt })
        XCTAssertEqual(captured.map(\.timeBasis), ["arrival", "arrival"])
        XCTAssertNil(captured[0].reportedAt)
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.loadedSpots, 1)
        XCTAssertEqual(snapshot.spots.first?.aggregateCount, 2)
        XCTAssertEqual(recorder.chronology, ["connected", "spot:1", "spot:2"])
        let restored = try JSONDecoder().decode(ClusterSpotObservation.self, from: JSONEncoder().encode(captured[0]))
        XCTAssertEqual(restored, captured[0])
        await service.terminate()
    }

    func testFullCommentAndCaptureClassificationSurviveFiltersEvictionAndReclassification() async throws {
        let source = server, recorder = ObservationRecorder(), transport = ObservationTransport()
        var config = ClusterSessionConfiguration(servers: [source], maximumSpots: 1)
        config.filter.query = "NEVERMATCH"
        let service = fixture(config, recorder, [transport])
        await service.replaceContacts([])
        try await service.connect()
        let comment = "CW " + String(repeating: "long comment ", count: 60) + "POTA K-1234"
        transport.emit("DX de W1AW: 14025.0 K1ABC \(comment)")
        try await waitFor { recorder.spots.count == 1 }
        await service.updateFilter(.init())
        let live = await service.snapshot()
        XCTAssertEqual(live.spots.first?.comment.utf8.count, 512)
        XCTAssertEqual(live.spots.first?.specialTags, ["POTA"])
        await service.updateFilter(config.filter)
        for index in 0..<405 { transport.emit("DX de W1AW: 14026.0 K\(index)XYZ CW") }
        try await waitFor { recorder.spots.count == 406 }
        let captured = recorder.spots[0]
        XCTAssertEqual(captured.raw.comment, comment)
        XCTAssertEqual(captured.classified.comment, comment)
        XCTAssertEqual(captured.classified.specialTags, ["POTA"])
        XCTAssertEqual(captured.classified.callStatus, "New Callsign")
        XCTAssertEqual(captured.contactRevision, 1)
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.loadedSpots, 400)
        XCTAssertEqual(snapshot.spots.count, 0)
        await service.replaceContacts([.init(callsign: "K1ABC", band: "20m", mode: "CW")])
        XCTAssertEqual(recorder.spots[0], captured)
        XCTAssertEqual(recorder.spots.last?.sequence, 406)
        await service.terminate()
    }

    func testHistoricalReplyKeepsArrivalSeparateFromExplicitReportTimeAndIgnoresTranscripts() async throws {
        let source = server, recorder = ObservationRecorder(), transport = ObservationTransport()
        let service = fixture(.init(servers: [source]), recorder, [transport])
        try await service.connect(passwords: [source.id: "secret-fixture"])
        transport.emit("Password: secret-fixture")
        transport.emit("Login failed")
        transport.emit("14025.0010 K1ABC 12-Oct-2026 2359Z CW POTA K-1234 <W1AW>")
        try await waitFor { recorder.spots.count == 1 }
        let observation = recorder.spots[0]
        XCTAssertEqual(observation.recordKind, "historical_reply")
        XCTAssertEqual(observation.timeBasis, "explicit_report_date")
        let expected = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-12T23:59:00Z"))
        XCTAssertEqual(observation.reportedAt, expected)
        XCTAssertEqual(observation.raw.receivedAt, expected)
        XCTAssertGreaterThan(observation.arrivedAt, expected)
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(recorder.events), as: UTF8.self).contains("secret-fixture"))
        await service.terminate()
    }

    func testLiveUTCClockUsesExplicitNearestDayInference() throws {
        let source = server
        let arrival = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-13T00:02:00Z"))
        let line = "DX de W1AW: 14025.0 K1ABC CW 2359Z"
        let raw = try XCTUnwrap(ClusterLineParser.parse(line, clusterID: source.id, clusterName: source.name, at: arrival))
        let result = ClusterSpotObservation.reportTime(line: line, raw: raw, arrivedAt: arrival)
        XCTAssertEqual(result.0, ISO8601DateFormatter().date(from: "2026-10-12T23:59:00Z"))
        XCTAssertEqual(result.1, "inferred_utc_date")
        XCTAssertEqual(result.2, "live")
        XCTAssertEqual(raw.comment, "CW")
        let evening = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-12T23:58:00Z"))
        let nextLine = "DX de W1AW: 14025.0 K1ABC CW 0001Z"
        let nextRaw = try XCTUnwrap(ClusterLineParser.parse(nextLine, clusterID: source.id, clusterName: source.name, at: evening))
        XCTAssertEqual(ClusterSpotObservation.reportTime(line: nextLine, raw: nextRaw, arrivedAt: evening).0,
                       ISO8601DateFormatter().date(from: "2026-10-13T00:01:00Z"))
    }

    func testAutomaticReconnectChangesSegmentWhileDuplicateConnectedAndDisplaySavePreserveIt() async throws {
        let source = server, recorder = ObservationRecorder(), transport = ObservationTransport()
        var config = ClusterSessionConfiguration(servers: [source])
        let service = fixture(config, recorder, [transport])
        try await service.connect()
        transport.emit("DX de W1AW: 14025.0 K1ABC CW")
        try await waitFor { recorder.spots.count == 1 }
        config.servers[0].name = "Renamed"
        config.reconnect = false
        config.filter.sources = []
        try await service.configure(config, password: { _ in XCTFail("Display save requested credentials"); return "" })
        transport.phase(.connected)
        transport.emit("DX de W1AW: 14025.0 K1ABC CW")
        transport.phase(.failed, error: "secret-error-transcript")
        transport.phase(.connecting)
        transport.phase(.connected)
        transport.emit("DX de W1AW: 14025.0 K1ABC CW")
        try await waitFor { recorder.spots.count == 3 }
        let observations = recorder.spots
        XCTAssertEqual(observations.map(\.sequence), [1, 2, 1])
        XCTAssertEqual(observations[0].sessionID, observations[1].sessionID)
        XCTAssertNotEqual(observations[1].sessionID, observations[2].sessionID)
        XCTAssertEqual(observations[0].transportGeneration, observations[2].transportGeneration)
        XCTAssertEqual(observations[1].clusterName, "Renamed")
        XCTAssertFalse(transport.stopped)
        XCTAssertEqual(transport.optionUpdates, 1)
        XCTAssertEqual(recorder.chronology, ["connected", "spot:1", "spot:2", "failed", "connected", "spot:1"])
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(recorder.events), as: UTF8.self).contains("secret-error-transcript"))
        await service.disconnect()
        XCTAssertEqual(recorder.events.last?.phase, .disconnected)
        XCTAssertEqual(recorder.events.last?.sessionID, observations[2].sessionID)
    }

    func testReplacedGenerationAndCallbacksAfterDisconnectOrShutdownAreFenced() async throws {
        let source = server, recorder = ObservationRecorder()
        let old = ObservationTransport(), current = ObservationTransport()
        var config = ClusterSessionConfiguration(servers: [source])
        let service = fixture(config, recorder, [old, current])
        try await service.connect()
        old.emit("DX de W1AW: 14025.0 K1ABC CW")
        try await waitFor { recorder.spots.count == 1 }
        config.servers[0].host = "replacement.invalid"
        try await service.configure(config)
        old.emit("DX de W1AW: 14026.0 K1STALE CW")
        old.phase(.connected)
        current.emit("DX de W1AW: 14027.0 K1FRESH CW")
        try await waitFor { recorder.spots.count == 2 }
        XCTAssertNotEqual(recorder.spots[0].transportGeneration, recorder.spots[1].transportGeneration)
        XCTAssertEqual(recorder.spots[1].clusterHost, "replacement.invalid")
        XCTAssertEqual(recorder.spots.map { $0.raw.callsign }, ["K1ABC", "K1FRESH"])
        await service.terminate()
        let terminalEvents = recorder.events.count
        current.emit("DX de W1AW: 14028.0 K1AFTER CW")
        current.phase(.connected)
        old.emit("DX de W1AW: 14029.0 K1OLD CW")
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(recorder.spots.count, 2)
        XCTAssertEqual(recorder.events.count, terminalEvents)
        XCTAssertTrue(old.stopped)
        XCTAssertTrue(current.stopped)
        XCTAssertEqual(recorder.events.last?.phase, .disconnected)
        do { try await service.connect(); XCTFail("Shutdown session reconnected") }
        catch ClusterSessionError.terminated {}
    }
}
