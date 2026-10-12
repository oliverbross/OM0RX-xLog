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

private final class WorkerClusterFixture: ClusterConnectionTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var starts = 0, stops = 0
    private var commands: [String] = []
    private var state: (@Sendable (ClusterConnectionPhase, String?) -> Void)?
    private var line: (@Sendable (String) -> Void)?
    func callbacks(state: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
                   line: @escaping @Sendable (String) -> Void) {
        lock.withLock { self.state = state; self.line = line }
    }
    func start() { let callback = lock.withLock { starts += 1; return state }; callback?(.connected, nil) }
    func stop() { lock.withLock { stops += 1 } }
    func send(_ command: String) { lock.withLock { commands.append(command) } }
    func emit(_ text: String) { let callback = lock.withLock { line }; callback?(text) }
    var counts: (Int, Int) { lock.withLock { (starts, stops) } }
    var sent: [String] { lock.withLock { commands } }
}

@Suite("Portable live cluster worker bridge")
struct LiveClusterMethodsTests {
    private func request(_ worker: LiveWorker, _ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": params])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: data)) as? [String: Any])
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
        #expect(try await request(worker, "cluster_configure", ["configuration": configuration])["ok"] as? Bool == true)
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
        let saved = try await request(worker, "cluster_configure", ["configuration": configuration])
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
        #expect(fixture.sent == ["SH/DX"])
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
        do { _ = try await bridge.handle(method: "cluster_configure", params: ["configuration": value]); Issue.record("Unsupported forwarding was saved") }
        catch let error as WorkerFailure { #expect(error.code == "platform_pending") }
        catch { Issue.record("Unexpected forwarding error: \(error)") }
        #endif
        value["forwardSpotsToFlex"] = false
        let saved = try await bridge.handle(method: "cluster_configure", params: ["configuration": value])
        #expect((saved["configuration"] as? [String: Any])?["forwardSpotsToFlex"] as? Bool == false)
        await bridge.terminate()
    }
}
