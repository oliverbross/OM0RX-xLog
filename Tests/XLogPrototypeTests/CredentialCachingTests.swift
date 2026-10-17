import Foundation
import Testing
import XClusterIntegrationCore
@testable import XLogPrototypeSupport

private final class CountingClusterVault: ClusterCredentialStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [UUID: String] = [:]
    private(set) var reads = 0
    var available: Bool { true }

    func load(_ id: UUID) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        reads += 1
        return values[id]
    }

    func save(_ password: String, serverID: UUID) throws {
        lock.lock(); defer { lock.unlock() }
        if password.isEmpty { values.removeValue(forKey: serverID) }
        else { values[serverID] = password }
    }
}

@Suite("Worker credential caching")
struct CredentialCachingTests {
    @Test("Cluster vault reads and misses are bounded until an explicit save")
    func clusterVault() throws {
        let base = CountingClusterVault()
        let cache = CachedClusterCredentialStore(base: base)
        let id = UUID()

        #expect(try cache.load(id) == nil)
        #expect(try cache.load(id) == nil)
        #expect(base.reads == 1)

        try cache.save("password", serverID: id)
        #expect(try cache.load(id) == "password")
        #expect(base.reads == 1)

        try cache.save("", serverID: id)
        #expect(try cache.load(id) == nil)
        #expect(base.reads == 1)
    }

    @Test("Renderer cluster snapshots do not repeat secure-store reads")
    func clusterSnapshots() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        let configuration = ClusterSessionConfiguration(servers: [
            .init(name: "Fixture", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX")
        ])
        try JSONEncoder().encode(configuration).write(to: configurationURL)
        let base = CountingClusterVault()
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL, vault: base)

        _ = try await cluster.handle(method: "cluster_snapshot", params: [:])
        let readsAfterFirstSnapshot = base.reads
        _ = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect(readsAfterFirstSnapshot > 0)
        #expect(base.reads == readsAfterFirstSnapshot)
        await cluster.terminate()
    }
}
