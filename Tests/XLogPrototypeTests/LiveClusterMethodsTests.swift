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

@Suite("Portable live cluster worker bridge")
struct LiveClusterMethodsTests {
    private func request(_ worker: LiveWorker, _ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": params])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
    }

    @Test("RBN source filtering controls the live skimmer subscription")
    func rbnSourceSubscription() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        var configuration = ClusterSessionConfiguration(servers: [
            .init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")
        ], requestRecentSpotsOnConnect: false, requestSkimmer: false)
        configuration.filter.sources = ["cluster"]
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
        filter["sources"] = ["cluster", "rbl"]
        snapshot = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
        #expect((snapshot["configuration"] as? [String: Any])?["requestSkimmer"] as? Bool == true)
        #expect(fixture.optionUpdates.last?.1 == true)
        filter = try #require((snapshot["configuration"] as? [String: Any])?["filter"] as? [String: Any])
        filter["sources"] = ["cluster"]
        snapshot = try await cluster.handle(method: "cluster_filter", params: ["filter": filter])
        #expect((snapshot["configuration"] as? [String: Any])?["requestSkimmer"] as? Bool == false)
        #expect(fixture.optionUpdates.last?.1 == false)
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
