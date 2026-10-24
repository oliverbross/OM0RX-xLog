import Foundation
import Testing
import XClusterIntegrationCore
@testable import XLogPrototypeSupport

private struct UnavailableClusterTestVault: ClusterCredentialStoring {
    let available = false
    func load(_ id: UUID) throws -> String? { nil }
    func save(_ password: String, serverID: UUID) throws {
        throw WorkerFailure("credential_unavailable", "Fixture secure store is unavailable.")
    }
}

private struct FailingClusterTestVault: ClusterCredentialStoring {
    let available = true
    func load(_ id: UUID) throws -> String? {
        throw WorkerFailure("credential_interaction_required", "Fixture credential needs authorization.")
    }
    func save(_ password: String, serverID: UUID) throws {}
}

private final class WorkerClusterFixture: ClusterConnectionTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var starts = 0, stops = 0
    private var commands: [String] = []
    private var options: [(Bool, Bool)] = []
    private var state: (@Sendable (ClusterConnectionPhase, String?) -> Void)?
    private var line: (@Sendable (String) -> Void)?
    func callbacks(state: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
                   line: @escaping @Sendable (String) -> Void) {
        lock.withLock { self.state = state; self.line = line }
    }
    func start() { let callback = lock.withLock { starts += 1; return state }; callback?(.connected, nil) }
    func stop() { lock.withLock { stops += 1 } }
    func send(_ command: String) { lock.withLock { commands.append(command) } }
    func updateOptions(reconnect: Bool, requestSkimmer: Bool) { lock.withLock { options.append((reconnect, requestSkimmer)) } }
    func emit(_ text: String) { let callback = lock.withLock { line }; callback?(text) }
    var counts: (Int, Int) { lock.withLock { (starts, stops) } }
    var sent: [String] { lock.withLock { commands } }
    var optionUpdates: [(Bool, Bool)] { lock.withLock { options } }
}

private actor ClusterRadioSpotRecorder {
    private var values: [(ClusterRadioSpotPayload, String, Bool)] = []
    private var removals: [(ClusterRadioSpotPayload, String)] = []
    private var active: [String: (ClusterRadioSpotPayload, String)] = [:]
    private var lifecycle: [String] = []
    private var removalAccepted = true
    private func key(_ payload: ClusterRadioSpotPayload, provider: String) -> String {
        "\(provider)|\(payload.callsign)|\(payload.frequencyHz)"
    }
    func forward(_ payload: ClusterRadioSpotPayload, provider: String, replacing: Bool) -> Bool {
        lifecycle.append("forward")
        values.append((payload, provider, replacing))
        active[key(payload, provider: provider)] = (payload, provider)
        return true
    }
    func remove(_ payload: ClusterRadioSpotPayload, provider: String) -> Bool {
        lifecycle.append("remove")
        removals.append((payload, provider))
        guard removalAccepted else { return false }
        if provider == "direct_tci" {
            active = active.filter { $0.value.1 != provider || $0.value.0.callsign != payload.callsign }
        } else {
            active.removeValue(forKey: key(payload, provider: provider))
        }
        return true
    }
    func snapshot() -> [(ClusterRadioSpotPayload, String, Bool)] { values }
    func removed() -> [(ClusterRadioSpotPayload, String)] { removals }
    func activeSnapshot() -> [(ClusterRadioSpotPayload, String)] { Array(active.values) }
    func recordCleanup() { lifecycle.append("cleanup") }
    func lifecycleSnapshot() -> [String] { lifecycle }
    func setRemovalAccepted(_ accepted: Bool) { removalAccepted = accepted }
}

@Suite("Portable live cluster worker bridge")
struct LiveClusterMethodsTests {
    private func request(_ worker: LiveWorker, _ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": params])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
    }

    @Test("Contest radio spots are scoped and carry the authoritative four-colour classification")
    func contestRadioSpotPublication() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        // Contest publication owns its complete N1MM-style colour set. The
        // Normal Logging preference must not suppress grey contest spots.
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [], showWorkedBandModeSpots: false,
                                                              forwardSpotsToFlex: true)).write(to: configurationURL)
        let recorder = ClusterRadioSpotRecorder()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL,
                                         vault: UnavailableClusterTestVault(),
                                         forwardClassifiedIngressSpots: false,
                                         spotForward: { payload, provider, replacing in
            await recorder.forward(payload, provider: provider, replacing: replacing)
        }, spotRemove: { payload, provider in
            await recorder.remove(payload, provider: provider)
        }, beforeContestSpotPublication: {
            await recorder.recordCleanup()
        })
        let timestamp = Date().timeIntervalSinceReferenceDate
        func row(_ id: String, _ call: String, frequency: Int64, band: String = "40m", mode: String = "SSB",
                 points: Int = 3, dupe: Bool = false, multipliers: Int = 0,
                 country: Bool = false, zone: Bool = false) -> [String: Any] {
            ["spot_id": id, "callsign": call, "frequency_hz": frequency, "band": band, "mode": mode,
             "spotter": "W1AW", "comment": "CQ TEST", "timestamp": timestamp, "points": points,
             "dupe": dupe, "multiplier_count": multipliers,
             "country_multiplier": country, "zone_multiplier": zone]
        }
        let sessionID = UUID().uuidString, generation = UUID().uuidString, publisherID = UUID().uuidString
        var spots = [
            row("double", "DL1AAA", frequency: 7_125_000, multipliers: 2, country: true, zone: true),
            row("single", "K1BBB", frequency: 7_126_000, multipliers: 1, country: true),
            row("qso", "VK1CCC", frequency: 7_127_000),
            row("dupe", "JA1DDD", frequency: 7_128_000, points: 0, dupe: true),
            row("off-band", "F1EEE", frequency: 14_215_000, band: "20m"),
            row("wrong-mode", "G1FFF", frequency: 7_025_000, mode: "CW"),
        ]
        func publish(revision: Int, sequence: Int, action: String = "replace",
                     session: String? = nil, workspace: String? = nil) async throws -> [String: Any] {
            try await cluster.handle(method: "cluster_contest_radio_spots_publish", params: [
                "publisher_id": publisherID, "publication_sequence": sequence, "action": action,
                "publisher_started_at": 1_800_000_000_000,
                "session_id": session ?? sessionID, "workspace_generation": workspace ?? generation, "revision": revision,
                "configured_bands": ["40m"], "allowed_mode_groups": ["phone"],
                "chunk_index": 0, "chunk_count": 1, "spots": action == "clear" ? [] : spots])
        }
        let first = try await publish(revision: 7, sequence: 1)
        #expect(first["accepted"] as? Int == 4)
        #expect(first["filtered"] as? Int == 2)
        var delivered = await recorder.snapshot()
        #expect(delivered.count == 4)
        #expect(Dictionary(uniqueKeysWithValues: delivered.map { ($0.0.callsign, $0.0.colorHex) }) == [
            "DL1AAA": "#00E51B", "K1BBB": "#FF5267", "VK1CCC": "#3DA5F4", "JA1DDD": "#AEB5B7"])
        #expect(delivered.allSatisfy { $0.1 == "direct_agent" && $0.2 })
        #expect(delivered.allSatisfy { $0.0.source == "xLog Contest" && $0.0.timestamp > 1_700_000_000 })
        #expect(Array((await recorder.lifecycleSnapshot()).prefix(2)) == ["cleanup", "forward"])

        let delayedOldPublisher = try await cluster.handle(method: "cluster_contest_radio_spots_publish", params: [
            "publisher_id": UUID().uuidString, "publisher_started_at": 1_700_000_000_000,
            "publication_sequence": 1, "action": "replace", "session_id": sessionID,
            "workspace_generation": generation, "revision": 7, "configured_bands": ["40m"],
            "allowed_mode_groups": ["phone"], "chunk_index": 0, "chunk_count": 1, "spots": spots])
        #expect(delayedOldPublisher["stale"] as? Bool == true)

        let unchanged = try await publish(revision: 7, sequence: 2)
        #expect(unchanged["accepted"] as? Int == 0)
        #expect(unchanged["unchanged"] as? Int == 4)
        let afterUnchanged = await recorder.snapshot()
        #expect(afterUnchanged.count == 4)

        spots[0] = row("double", "DL1AAA", frequency: 7_125_000, points: 0, dupe: true)
        let repainted = try await publish(revision: 8, sequence: 3)
        #expect(repainted["accepted"] as? Int == 1)
        #expect(repainted["removed"] as? Int == 1)
        #expect(repainted["unchanged"] as? Int == 3)
        delivered = await recorder.snapshot()
        #expect(delivered.count == 5)
        #expect(delivered.last?.0.colorHex == "#AEB5B7")
        #expect((await recorder.removed()).map(\.0.callsign) == ["DL1AAA"])
        let activeAfterQSO = await recorder.activeSnapshot()
        #expect(activeAfterQSO.count == 4)
        #expect(activeAfterQSO.filter { $0.0.callsign == "DL1AAA" }.map(\.0.colorHex) == ["#AEB5B7"])

        let delayed = try await publish(revision: 7, sequence: 2)
        #expect(delayed["stale"] as? Bool == true)
        let nextSession = UUID().uuidString, nextGeneration = UUID().uuidString
        let switched = try await publish(revision: 1, sequence: 4, session: nextSession, workspace: nextGeneration)
        #expect(switched["removed"] as? Int == 4)
        #expect(switched["accepted"] as? Int == 4)
        let delayedOldSession = try await publish(revision: 8, sequence: 3)
        #expect(delayedOldSession["stale"] as? Bool == true)
        let wrongClear = try await publish(revision: 1, sequence: 5, action: "clear")
        #expect(wrongClear["stale"] as? Bool == true)
        let cleared = try await publish(revision: 1, sequence: 6, action: "clear",
                                        session: nextSession, workspace: nextGeneration)
        #expect(cleared["removed"] as? Int == 4)
        #expect((await recorder.removed()).count == 9)
        await cluster.terminate()
    }

    @Test("TCI callsign removal replays sibling frequencies before the new classification is admitted")
    func contestTCICallsignReconciliation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [], showWorkedBandModeSpots: true,
                                                              forwardSpotsToTCI: true)).write(to: configurationURL)
        let recorder = ClusterRadioSpotRecorder()
        let cluster = LiveClusterMethods(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false),
                                         configurationURL: configurationURL, vault: UnavailableClusterTestVault(),
                                         forwardClassifiedIngressSpots: false,
                                         spotForward: { payload, provider, replacing in
            await recorder.forward(payload, provider: provider, replacing: replacing)
        }, spotRemove: { payload, provider in
            await recorder.remove(payload, provider: provider)
        })
        let publisherID = UUID().uuidString, sessionID = UUID().uuidString, generation = UUID().uuidString
        let timestamp = Date().timeIntervalSinceReferenceDate
        func row(_ id: String, frequency: Int64, dupe: Bool, multipliers: Int) -> [String: Any] {
            ["spot_id": id, "callsign": "DL1AAA", "frequency_hz": frequency, "band": "40m", "mode": "SSB",
             "spotter": "W1AW", "comment": "CQ TEST", "timestamp": timestamp, "points": dupe ? 0 : 3,
             "dupe": dupe, "multiplier_count": multipliers,
             "country_multiplier": multipliers > 0, "zone_multiplier": multipliers > 1]
        }
        var spots = [row("primary", frequency: 7_125_000, dupe: false, multipliers: 2),
                     row("sibling", frequency: 7_126_000, dupe: false, multipliers: 0)]
        func publish(revision: Int, sequence: Int) async throws -> [String: Any] {
            try await cluster.handle(method: "cluster_contest_radio_spots_publish", params: [
                "publisher_id": publisherID, "publisher_started_at": 1_800_000_000_000,
                "publication_sequence": sequence, "action": "replace", "session_id": sessionID,
                "workspace_generation": generation, "revision": revision, "configured_bands": ["40m"],
                "allowed_mode_groups": ["phone"], "chunk_index": 0, "chunk_count": 1, "spots": spots])
        }
        let first = try await publish(revision: 1, sequence: 1)
        #expect(first["accepted"] as? Int == 2)
        spots[0] = row("primary", frequency: 7_125_000, dupe: true, multipliers: 0)
        let repainted = try await publish(revision: 2, sequence: 2)
        #expect(repainted["removed"] as? Int == 2)
        #expect(repainted["accepted"] as? Int == 2)
        #expect((await recorder.removed()).count == 1)
        let active = await recorder.activeSnapshot()
        #expect(active.count == 2)
        #expect(Dictionary(uniqueKeysWithValues: active.map { ($0.0.frequencyHz, $0.0.colorHex) }) == [
            7_125_000: "#AEB5B7", 7_126_000: "#3DA5F4"])
        await cluster.terminate()
        #expect((await recorder.removed()).count == 2)
        #expect((await recorder.activeSnapshot()).isEmpty)
    }

    @Test("Contest shutdown fails closed and retains retry state when radio spot withdrawal is rejected")
    func contestShutdownRetainsRejectedWithdrawal() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [], showWorkedBandModeSpots: true,
                                                              forwardSpotsToFlex: true)).write(to: configurationURL)
        let recorder = ClusterRadioSpotRecorder()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook,
                                         configurationURL: configurationURL, vault: UnavailableClusterTestVault(),
                                         forwardClassifiedIngressSpots: false,
                                         spotForward: { payload, provider, replacing in
            await recorder.forward(payload, provider: provider, replacing: replacing)
        }, spotRemove: { payload, provider in
            await recorder.remove(payload, provider: provider)
        })
        let published = try await cluster.handle(method: "cluster_contest_radio_spots_publish", params: [
            "publisher_id": UUID().uuidString, "publisher_started_at": 1_800_000_000_000,
            "publication_sequence": 1, "action": "replace", "session_id": UUID().uuidString,
            "workspace_generation": UUID().uuidString, "revision": 1, "configured_bands": ["40m"],
            "allowed_mode_groups": ["phone"], "chunk_index": 0, "chunk_count": 1, "spots": [[
                "spot_id": "double", "callsign": "DL1AAA", "frequency_hz": 7_125_000,
                "band": "40m", "mode": "SSB", "spotter": "W1AW", "comment": "CQ TEST",
                "timestamp": Date().timeIntervalSinceReferenceDate, "points": 3, "dupe": false,
                "multiplier_count": 2, "country_multiplier": true, "zone_multiplier": true]]])
        #expect(published["accepted"] as? Int == 1)
        await recorder.setRemovalAccepted(false)
        let worker = LiveWorker(logbook: logbook, localAcceptance: true, cluster: cluster)
        #expect(await worker.shutdown() == false)
        #expect((await recorder.activeSnapshot()).count == 1)

        await recorder.setRemovalAccepted(true)
        #expect(await cluster.terminate() == true)
        #expect((await recorder.activeSnapshot()).isEmpty)
    }

    @Test("Contest module suppresses the unfiltered ingress radio publisher")
    func contestSuppressesRawIngressForwarding() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [
            .init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")
        ], requestRecentSpotsOnConnect: false, forwardSpotsToFlex: true)).write(to: configurationURL)
        let fixture = WorkerClusterFixture(), recorder = ClusterRadioSpotRecorder()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL,
                                         vault: UnavailableClusterTestVault(),
                                         transportFactory: { _, _, _, _, state, line in
            fixture.callbacks(state: state, line: line); return fixture
        }, forwardClassifiedIngressSpots: false, spotForward: { payload, provider, replacing in
            await recorder.forward(payload, provider: provider, replacing: replacing)
        })
        _ = try await cluster.handle(method: "cluster_connect", params: [:])
        fixture.emit("DX de W1AW: 7125.0 DL1AAA SSB CQ TEST")
        try await Task.sleep(for: .milliseconds(50))
        let delivered = await recorder.snapshot()
        #expect(delivered.isEmpty)
        await cluster.terminate()
    }

    @Test("RBN source filtering does not change the live skimmer subscription")
    func rbnSourceVisibilityIsIndependent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        var configuration = ClusterSessionConfiguration(servers: [
            .init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")
        ], requestRecentSpotsOnConnect: false, requestSkimmer: true)
        configuration.filter.sources = ["cluster", "rbl"]
        try JSONEncoder().encode(configuration).write(to: configurationURL)
        let fixture = WorkerClusterFixture()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL,
                                         vault: UnavailableClusterTestVault(),
                                         transportFactory: { _, _, _, _, state, line in
            fixture.callbacks(state: state, line: line); return fixture
        })
        _ = try await cluster.handle(method: "cluster_connect", params: [:])
        var snapshot = try await cluster.handle(method: "cluster_snapshot", params: [:])
        var filter = try #require((snapshot["configuration"] as? [String: Any])?["filter"] as? [String: Any])
        let optionUpdateCount = fixture.optionUpdates.count
        filter["sources"] = ["cluster"]
        snapshot = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
        #expect((snapshot["configuration"] as? [String: Any])?["requestSkimmer"] as? Bool == true)
        #expect(fixture.optionUpdates.count == optionUpdateCount)
        filter = try #require((snapshot["configuration"] as? [String: Any])?["filter"] as? [String: Any])
        filter["sources"] = ["cluster", "rbl"]
        snapshot = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
        #expect((snapshot["configuration"] as? [String: Any])?["requestSkimmer"] as? Bool == true)
        #expect(fixture.optionUpdates.count == optionUpdateCount)
        await cluster.terminate()
    }

    @Test("Special include and exclude filters remain independent and reject contradictions")
    func specialIncludeExcludeValidation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: root.appendingPathComponent("cluster.json"),
                                         vault: UnavailableClusterTestVault())
        let initial = try await cluster.handle(method: "cluster_snapshot", params: [:])
        let configuration = try #require(initial["configuration"] as? [String: Any])
        var filter = try #require(configuration["filter"] as? [String: Any])
        filter["specials"] = ["POTA"]
        filter["excludedSpecials"] = ["POTA"]
        do {
            _ = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
            Issue.record("Contradictory Special filters were accepted")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "invalid_params")
        }
        filter["specials"] = []
        filter["excludedSpecials"] = ["CONTEST"]
        let accepted = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
        let saved = try #require((accepted["configuration"] as? [String: Any])?["filter"] as? [String: Any])
        #expect(saved["excludedSpecials"] as? [String] == ["CONTEST"])
        await cluster.terminate()
    }

    @Test("Spotter continent is independent from the DX station continent")
    func spotterContinentFiltering() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        let configuration = ClusterSessionConfiguration(servers: [
            .init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")
        ], requestRecentSpotsOnConnect: false)
        try JSONEncoder().encode(configuration).write(to: configurationURL)
        let fixture = WorkerClusterFixture()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL,
                                         vault: UnavailableClusterTestVault(),
                                         transportFactory: { _, _, _, _, state, line in
            fixture.callbacks(state: state, line: line); return fixture
        })
        _ = try await cluster.handle(method: "cluster_connect", params: [:])
        fixture.emit("DX de W1AW: 14025.0 K1ABC CW")
        fixture.emit("DX de DL1ABC: 14026.0 K2ABC CW")

        var snapshot: [String: Any] = [:]
        for _ in 0..<100 {
            snapshot = try await cluster.handle(method: "cluster_snapshot", params: [:])
            if ((snapshot["snapshot"] as? [String: Any])?["spots"] as? [[String: Any]])?.count == 2 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        var filter = try #require((snapshot["configuration"] as? [String: Any])?["filter"] as? [String: Any])
        filter["spotterContinents"] = ["EU"]
        let filtered = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
        let spots = try #require((filtered["snapshot"] as? [String: Any])?["spots"] as? [[String: Any]])
        #expect(spots.map { $0["callsign"] as? String } == ["K2ABC"])
        #expect(spots.first?["spotter"] as? String == "DL1ABC")
        #expect(spots.first?["spotterContinent"] as? String == "EU")

        filter = try #require((filtered["configuration"] as? [String: Any])?["filter"] as? [String: Any])
        filter["continents"] = ["EU"]
        let independentlyFiltered = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
        #expect(((independentlyFiltered["snapshot"] as? [String: Any])?["spots"] as? [[String: Any]])?.isEmpty == true)

        let legacy = try JSONDecoder().decode(ClusterSpotFilter.self, from: Data(#"{"continents":["EU"]}"#.utf8))
        #expect(legacy.continents == ["EU"])
        #expect(legacy.spotterContinents.isEmpty)
        await cluster.terminate()
    }

    @Test("Contest spot projection bypasses normal cluster display filters")
    func contestSpotProjectionBypassesNormalFilters() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        var filter = ClusterSpotFilter()
        filter.bands = ["20m"]
        filter.modes = ["CW"]
        filter.excludedSpecials = ["CONTEST"]
        let configuration = ClusterSessionConfiguration(servers: [
            .init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")
        ], requestRecentSpotsOnConnect: false, filter: filter)
        try JSONEncoder().encode(configuration).write(to: configurationURL)
        let fixture = WorkerClusterFixture()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL,
                                         vault: UnavailableClusterTestVault(),
                                         transportFactory: { _, _, _, _, state, line in
            fixture.callbacks(state: state, line: line); return fixture
        })
        _ = try await cluster.handle(method: "cluster_connect", params: [:])
        fixture.emit("DX de W1AW: 7125.0 K1SSB SSB CQ CONTEST 1200Z")

        var response: [String: Any] = [:]
        for _ in 0..<100 {
            response = try await cluster.handle(method: "cluster_snapshot", params: [:])
            if (response["contest_spots"] as? [[String: Any]])?.count == 1 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(((response["snapshot"] as? [String: Any])?["spots"] as? [[String: Any]])?.isEmpty == true)
        let contestSpots = try #require(response["contest_spots"] as? [[String: Any]])
        #expect(contestSpots.count == 1)
        #expect(contestSpots.first?["callsign"] as? String == "K1SSB")
        #expect(contestSpots.first?["band"] as? String == "40m")
        #expect(contestSpots.first?["mode"] as? String == "SSB")
        await cluster.terminate()
    }

    @Test("Connect resolves cluster credentials before persisting connected intent")
    func credentialFailurePrecedesResumeIntent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [
            .init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")
        ])).write(to: configurationURL)
        let fixture = WorkerClusterFixture()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL,
                                         vault: FailingClusterTestVault(),
                                         transportFactory: { _, _, _, _, _, _ in fixture })

        do {
            _ = try await cluster.handle(method: "cluster_connect", params: [:])
            Issue.record("Credential failure was hidden")
        } catch let error as WorkerFailure {
            #expect(error.code == "credential_interaction_required")
        }
        #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("cluster-session.json").path))
        #expect(fixture.counts.0 == 0)
        await cluster.terminate()
    }

    @Test("Workspace-owned cluster persists configuration, joins Chaser and rejects late requests after shutdown")
    func workspaceOwnership() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        _ = try logbook.handle(method: "logbook_import_adif", params: ["text": "<CALL:5>K1ABC<QSO_DATE:8>20261001<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<EOR>"])
        let fixture = WorkerClusterFixture()
        let cluster = LiveClusterMethods(logbook: logbook, vault: UnavailableClusterTestVault(), transportFactory: { _, password, _, _, state, line in
            #expect(password.isEmpty)
            fixture.callbacks(state: state, line: line)
            return fixture
        })
        let worker = LiveWorker(logbook: logbook, cluster: cluster)
        let initial = try await request(worker, "cluster_snapshot")
        let initialResult = try #require(initial["result"] as? [String: Any])
        #expect(initialResult["password_storage_available"] as? Bool == false)
        #expect((initialResult["snapshot"] as? [String: Any])?["contactCount"] as? Int == 1)
        #expect(fixture.counts.0 == 0)
        var configuration = try #require(initialResult["configuration"] as? [String: Any])
        let id = UUID().uuidString
        configuration["servers"] = [["id": id, "name": "Fixture", "host": "cluster.example.invalid", "port": 7300, "callsign": "OM0RX", "enabled": true]]
        configuration["showWorkedBandModeSpots"] = true
        #expect(try await request(worker, "cluster_configure", ["configuration": configuration,
                                                                "base_configuration": initialResult["configuration"]!])["ok"] as? Bool == true)
        let path = logbook.workspaceDirectoryURL.appendingPathComponent("Cluster/cluster.json")
        #expect(FileManager.default.fileExists(atPath: path.path))
        #expect(fixture.counts.0 == 0)
        let password = try await request(worker, "cluster_password_set", ["server_id": id, "password": "fixture-not-saved"])
        #expect((password["error"] as? [String: Any])?["code"] as? String == "credential_unavailable")
        #expect(!String(decoding: try Data(contentsOf: path), as: UTF8.self).contains("fixture-not-saved"))
        #expect(try await request(worker, "cluster_connect")["ok"] as? Bool == true)
        fixture.emit("DX de W1AW: 14025.0 K1ABC POTA US-3051 1200Z")
        var snapshot: [String: Any] = [:]
        for _ in 0..<100 {
            let result = try await request(worker, "cluster_snapshot")["result"] as? [String: Any]
            snapshot = result?["snapshot"] as? [String: Any] ?? [:]
            if (snapshot["spots"] as? [[String: Any]])?.count == 1 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(snapshot["connectedClusters"] as? Int == 1)
        #expect((snapshot["spots"] as? [[String: Any]])?.first?["callsign"] as? String == "K1ABC")
        let spotID = (snapshot["spots"] as? [[String: Any]])?.first?["id"] as? String
        var palette = try #require(configuration["palette"] as? [String: Any])
        var bands = try #require(palette["band"] as? [String: String])
        bands["20m"] = "#123456"
        palette["band"] = bands
        configuration["palette"] = palette
        let beforePalette = try await request(worker, "cluster_snapshot")
        let saved = try await request(worker, "cluster_configure", ["configuration": configuration,
                                                                    "base_configuration": (beforePalette["result"] as? [String: Any])?["configuration"] as Any])
        #expect(saved["ok"] as? Bool == true)
        let savedSnapshot = (saved["result"] as? [String: Any])?["snapshot"] as? [String: Any]
        #expect(savedSnapshot?["connectedClusters"] as? Int == 1)
        #expect((savedSnapshot?["spots"] as? [[String: Any]])?.first?["id"] as? String == spotID)
        #expect((savedSnapshot?["spots"] as? [[String: Any]])?.first?["bandHex"] as? String == "#123456")
        #expect(fixture.counts.0 == 1)
        #expect(fixture.counts.1 == 0)
        let opportunities = try await request(worker, "opportunities_snapshot")["result"] as? [String: Any]
        #expect((opportunities?["items"] as? [[String: Any]])?.contains { $0["reference"] as? String == "US-3051" } == true)
        #expect(try await request(worker, "cluster_command", ["command": "SH/DX"])["ok"] as? Bool == true)
        #expect(fixture.sent == ["sh/dx/100", "SH/DX"])
        await worker.shutdown()
        #expect(fixture.counts.1 == 1)
        fixture.emit("DX de W1AW: 14250.0 K2ABC POTA US-3052 1201Z")
        for method in ["cluster_snapshot", "cluster_connect", "cluster_command", "opportunities_snapshot"] {
            let late = try await request(worker, method)
            #expect((late["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
        }
        do { _ = try await cluster.handle(method: "cluster_connect", params: [:]); Issue.record("Terminated bridge restarted") }
        catch { #expect(fixture.counts.0 == 1) }
        let reopened = LiveClusterMethods(logbook: logbook, vault: UnavailableClusterTestVault(), transportFactory: { _, _, _, _, _, _ in
            Issue.record("Snapshot must not start a connection"); return fixture
        })
        let restored = try await reopened.handle(method: "cluster_snapshot", params: [:])
        #expect(((restored["configuration"] as? [String: Any])?["servers"] as? [[String: Any]])?.first?["id"] as? String == id)
        #expect(fixture.counts.0 == 1)
        await reopened.terminate()
    }

    @Test("A terminated session cannot be revived by a queued connect")
    func terminalSession() async throws {
        let fixture = WorkerClusterFixture()
        let session = ClusterSessionService(configuration: .init(servers: [.init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")]), transportFactory: { _, _, _, _, _, _ in fixture })
        await session.terminate()
        do { try await session.connect(); Issue.record("Terminated session connected") }
        catch ClusterSessionError.terminated { }
        catch { Issue.record("Unexpected shutdown error: \(error)") }
        #expect(fixture.counts.0 == 0)
    }

    @Test("Native startup connects once without a renderer and reconnects on the next launch")
    func nativeResumeOwnership() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let url = root.appendingPathComponent("cluster.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [.init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")])).write(to: url)
        let fixture = WorkerClusterFixture()
        func make() -> LiveClusterMethods {
            LiveClusterMethods(logbook: logbook, configurationURL: url, vault: UnavailableClusterTestVault(), transportFactory: { _, _, _, _, state, line in
                fixture.callbacks(state: state, line: line); return fixture
            })
        }
        let first = make()
        _ = try await first.handle(method: "cluster_resume", params: [:])
        #expect(fixture.counts.0 == 1)
        _ = try await first.handle(method: "cluster_resume_initialize", params: ["intent": "automatic"])
        _ = try await first.handle(method: "cluster_snapshot", params: [:])
        #expect(fixture.counts.0 == 1) // Renderer snapshots remain passive.
        for _ in 0..<3 { _ = try await first.handle(method: "cluster_resume", params: [:]) }
        #expect(fixture.counts.0 == 1)
        await first.terminate()
        let second = make()
        _ = try await second.handle(method: "cluster_resume", params: [:])
        #expect(fixture.counts.0 == 2) // No renderer/migration request on restart.
        _ = try await second.handle(method: "cluster_disconnect", params: [:])
        _ = try await second.handle(method: "cluster_resume_initialize", params: ["intent": "connected"])
        await second.terminate()
        let third = make()
        _ = try await third.handle(method: "cluster_resume", params: [:])
        #expect(fixture.counts.0 == 3)
        await third.terminate()
    }

    @Test("Native startup respects its setting regardless of legacy session intent")
    func nativeResumeOptOut() async throws {
        for intent in ["automatic", "disconnected"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            let url = root.appendingPathComponent("cluster.json")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            var config = ClusterSessionConfiguration(servers: [.init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")])
            config.connectOnStartup = false
            config.reconnect = intent == "disconnected"
            try JSONEncoder().encode(config).write(to: url)
            let fixture = WorkerClusterFixture()
            let bridge = LiveClusterMethods(logbook: logbook, configurationURL: url, vault: UnavailableClusterTestVault(), transportFactory: { _, _, _, _, _, _ in fixture })
            _ = try await bridge.handle(method: "cluster_resume_initialize", params: ["intent": intent])
            for _ in 0..<3 { _ = try await bridge.handle(method: "cluster_resume", params: [:]) }
            #expect(fixture.counts.0 == 0)
            await bridge.terminate()
        }
    }

    @Test("Failed intent persistence cannot revive the cluster in the same launch")
    func disconnectDiskFailure() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let url = root.appendingPathComponent("cluster.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [.init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")])).write(to: url)
        let fixture = WorkerClusterFixture()
        let bridge = LiveClusterMethods(logbook: logbook, configurationURL: url, vault: UnavailableClusterTestVault(), transportFactory: { _, _, _, _, _, _ in fixture })
        _ = try await bridge.handle(method: "cluster_connect", params: [:])
        let intentURL = root.appendingPathComponent("cluster-session.json")
        try FileManager.default.removeItem(at: intentURL)
        try FileManager.default.createDirectory(at: intentURL, withIntermediateDirectories: false)
        do { _ = try await bridge.handle(method: "cluster_disconnect", params: [:]); Issue.record("Persistence failure was hidden") }
        catch let error as WorkerFailure { #expect(error.code == "cluster_intent_persistence") }
        #expect(fixture.counts.1 >= 1)
        _ = try await bridge.handle(method: "cluster_resume", params: [:])
        #expect(fixture.counts.0 == 1)
        await bridge.terminate()
    }

    @Test("Corrupt legacy intent does not block configured startup connection and Disconnect repairs it")
    func corruptNativeIntent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let url = root.appendingPathComponent("cluster.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [.init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")])).write(to: url)
        try Data("invalid".utf8).write(to: root.appendingPathComponent("cluster-session.json"))
        let fixture = WorkerClusterFixture()
        let bridge = LiveClusterMethods(logbook: logbook, configurationURL: url, vault: UnavailableClusterTestVault(), transportFactory: { _, _, _, _, _, _ in fixture })
        _ = try await bridge.handle(method: "cluster_resume", params: [:])
        #expect(fixture.counts.0 == 1)
        _ = try await bridge.handle(method: "cluster_disconnect", params: [:])
        let state = try await bridge.handle(method: "cluster_resume_initialize", params: [:])
        #expect(state["resume_initialized"] as? Bool == true)
        _ = try await bridge.handle(method: "cluster_resume", params: [:])
        #expect(fixture.counts.0 == 1)
        await bridge.terminate()
    }

    @Test("Transferred forwarding settings remain readable and can be disabled on every platform")
    func transferredSettings() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let url = root.appendingPathComponent("cluster.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configuration = ClusterSessionConfiguration(servers: [], forwardSpotsToFlex: true)
        try JSONEncoder().encode(configuration).write(to: url)
        let bridge = LiveClusterMethods(logbook: logbook, configurationURL: url, vault: UnavailableClusterTestVault())
        let initial = try await bridge.handle(method: "cluster_snapshot", params: [:])
        var value = try #require(initial["configuration"] as? [String: Any])
        #expect(value["forwardSpotsToFlex"] as? Bool == true)
        #if !os(macOS)
        #expect(initial["flex_forwarding_available"] as? Bool == false)
        #expect((initial["forwarding"] as? [String: Any])?["status"] as? String == "Unavailable on this platform")
        do { _ = try await bridge.handle(method: "cluster_configure", params: ["configuration": value,
                                                                             "base_configuration": value]); Issue.record("Unsupported forwarding was saved") }
        catch let error as WorkerFailure { #expect(error.code == "platform_pending") }
        catch { Issue.record("Unexpected forwarding error: \(error)") }
        #endif
        value["forwardSpotsToFlex"] = false
        let saved = try await bridge.handle(method: "cluster_radio_spots_configure", params: [
            "flex_enabled": false, "flex_expected": true])
        #expect((saved["configuration"] as? [String: Any])?["forwardSpotsToFlex"] as? Bool == false)
        await bridge.terminate()
    }

    @Test("Cluster save preserves newer Radio spots fields and status colours")
    func clusterSavePreservesRadioSpotSettings() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let bridge = LiveClusterMethods(logbook: logbook, configurationURL: root.appendingPathComponent("cluster.json"),
                                        vault: UnavailableClusterTestVault())
        let initial = try await bridge.handle(method: "cluster_snapshot", params: [:])
        var stale = try #require(initial["configuration"] as? [String: Any])
        let initialPalette = try #require(stale["palette"] as? [String: Any])
        let initialStatus = try #require(initialPalette["status"] as? [String: String])
        let initialATNO = try #require(initialStatus["ATNO"])
        let radio = try await bridge.handle(method: "cluster_radio_spots_configure", params: [
            "color_policy": "dxcc", "color_policy_expected": "callsign",
            "status_colors": ["ATNO": "#123456"],
            "status_color_expected": ["ATNO": initialATNO]])
        #expect((radio["configuration"] as? [String: Any])?["radioSpotColorPolicy"] as? String == "dxcc")
        var otherWindowDraft = stale
        otherWindowDraft["requestSkimmer"] = false
        _ = try await bridge.handle(method: "cluster_configure", params: [
            "configuration": otherWindowDraft, "base_configuration": initial["configuration"]!])
        stale["hideWSPRSpots"] = true
        var palette = try #require(stale["palette"] as? [String: Any])
        var statusDraft = try #require(palette["status"] as? [String: String])
        statusDraft["Worked"] = "#ABCDEF"
        palette["status"] = statusDraft
        var bands = try #require(palette["band"] as? [String: String])
        bands["20m"] = "#AABBCC"
        palette["band"] = bands
        stale["palette"] = palette
        let result = try await bridge.handle(method: "cluster_configure", params: [
            "configuration": stale, "base_configuration": initial["configuration"]!])
        let saved = try #require(result["configuration"] as? [String: Any])
        let savedPalette = try #require(saved["palette"] as? [String: Any])
        let status = try #require(savedPalette["status"] as? [String: String])
        #expect(saved["forwardSpotsToFlex"] as? Bool == false)
        #expect(saved["radioSpotColorPolicy"] as? String == "dxcc")
        #expect(saved["hideWSPRSpots"] as? Bool == true)
        #expect(saved["requestSkimmer"] as? Bool == false)
        #expect(status["ATNO"] == "#123456")
        #expect(status["Worked"] == "#ABCDEF")
        #expect((savedPalette["band"] as? [String: String])?["20m"] == "#AABBCC")
        var otherClusterDraft = saved
        otherClusterDraft["maximumSpots"] = 500
        _ = try await bridge.handle(method: "cluster_configure", params: [
            "configuration": otherClusterDraft, "base_configuration": saved])
        var conflictingDraft = stale
        conflictingDraft["maximumSpots"] = 100
        do {
            _ = try await bridge.handle(method: "cluster_configure", params: [
                "configuration": conflictingDraft, "base_configuration": initial["configuration"]!])
            Issue.record("Concurrent Cluster field edit was overwritten")
        } catch let failure as WorkerFailure { #expect(failure.code == "configuration_conflict") }
        _ = try await bridge.handle(method: "cluster_radio_spots_configure", params: [
            "status_colors": ["Worked": "#010203"], "status_color_expected": ["Worked": "#ABCDEF"]])
        do {
            _ = try await bridge.handle(method: "cluster_configure", params: [
                "configuration": stale, "base_configuration": initial["configuration"]!])
            Issue.record("Concurrent status colour edit was overwritten")
        } catch let failure as WorkerFailure { #expect(failure.code == "configuration_conflict") }
        let afterConflict = try await bridge.handle(method: "cluster_snapshot", params: [:])
        let currentPalette = try #require((afterConflict["configuration"] as? [String: Any])?["palette"] as? [String: Any])
        #expect((currentPalette["status"] as? [String: String])?["Worked"] == "#010203")
        #expect((afterConflict["configuration"] as? [String: Any])?["maximumSpots"] as? Int == 500)
        await bridge.terminate()
    }

    @Test("Radio spot settings persist separately from cluster ingestion")
    func radioSpotSettings() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let url = root.appendingPathComponent("cluster.json")
        var original = ClusterSessionConfiguration(servers: [])
        original.palette.status["New Call"] = "#010203"
        original.palette.band["20m"] = "#AABBCC"
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(original).write(to: url)
        let bridge = LiveClusterMethods(logbook: logbook, configurationURL: url, vault: UnavailableClusterTestVault())
        let result = try await bridge.handle(method: "cluster_radio_spots_configure",
            params: ["tci_enabled": true, "tci_expected": false,
                     "color_policy": "dxcc", "color_policy_expected": "callsign",
                     "status_colors": ["ATNO": "#123456"],
                     "status_color_expected": ["ATNO": original.palette.status["ATNO"]!]])
        let saved = try #require(result["configuration"] as? [String: Any])
        #expect(saved["forwardSpotsToFlex"] as? Bool == false)
        #expect(saved["forwardSpotsToTCI"] as? Bool == true)
        #expect(saved["radioSpotColorPolicy"] as? String == "dxcc")
        let disk = try JSONDecoder().decode(ClusterSessionConfiguration.self, from: Data(contentsOf: url))
        #expect(disk.radioSpotColorPolicy == .dxcc)
        #expect(disk.forwardSpotsToTCI)
        #expect(disk.palette.status["ATNO"] == "#123456")
        #expect(disk.palette.status["New Call"] == "#010203")
        #expect(disk.palette.band["20m"] == "#AABBCC")
        let colorOnly = try await bridge.handle(method: "cluster_radio_spots_configure", params: [
            "status_colors": ["New Call": "#040506"], "status_color_expected": ["New Call": "#010203"]])
        #expect((colorOnly["configuration"] as? [String: Any])?["radioSpotColorPolicy"] as? String == "dxcc")
        do {
            _ = try await bridge.handle(method: "cluster_radio_spots_configure", params: [
                "status_colors": ["ATNO": "#654321"],
                "status_color_expected": ["ATNO": original.palette.status["ATNO"]!]])
            Issue.record("Stale Radio spots colour overwrote another window")
        } catch let failure as WorkerFailure { #expect(failure.code == "configuration_conflict") }
        do { _ = try await bridge.handle(method: "cluster_radio_spots_configure",
            params: ["color_policy": "other", "color_policy_expected": "dxcc"]); Issue.record("Invalid policy accepted") }
        catch let failure as WorkerFailure { #expect(failure.code == "invalid_params") }
        for invalid in [["ATNO": "#12345"], ["Unsupported": "#112233"]] {
            do { _ = try await bridge.handle(method: "cluster_radio_spots_configure",
                params: ["status_colors": invalid, "status_color_expected": ["ATNO": "#123456"]]); Issue.record("Invalid colour accepted") }
            catch let failure as WorkerFailure { #expect(failure.code == "invalid_params") }
        }
        let unchanged = try JSONDecoder().decode(ClusterSessionConfiguration.self, from: Data(contentsOf: url))
        #expect(unchanged.radioSpotColorPolicy == .dxcc)
        #expect(unchanged.palette.status["ATNO"] == "#123456")
        #expect(unchanged.palette.status["New Call"] == "#040506")
        await bridge.terminate()
    }
}
