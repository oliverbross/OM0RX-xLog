import Foundation
import Testing
import XClusterIntegrationCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Offline radio inventory and retirement isolation")
struct OfflineRadioRetirementTests {
    private actor Calls {
        private var events: [String] = []
        func record(_ event: String) { events.append(event) }
        func values() -> [String] { events }
    }
    private func clean(_ logbook: LiveLogbookMethods, root: URL, profile: AppRuntimeProfile) {
        if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL,
            expectedIdentityPrefix: profile.identityPrefix) {
            workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        (try? logbook.openedDatabase())?.close()
        try? FileManager.default.removeItem(at: root)
    }

    @Test("An offline cluster cannot invoke forwarding or persisted retirement callbacks", arguments: [false, true])
    func disabledClusterCallbacks(deferred: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let profile = AppRuntimeProfile.contestingTest(supportRoot: root)
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false, runtimeProfile: profile)
        defer { clean(logbook, root: root, profile: profile) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("cluster.json")
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [], forwardSpotsToFlex: true)).write(to: configurationURL)
        let calls = Calls()
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configurationURL,
            radioSideEffectsAllowed: false,
            spotForward: { _, _, _ in await calls.record("forward"); return true },
            spotRemove: { _, _ in await calls.record("remove"); return true },
            priorRadioSpotCleanup: { _ in await calls.record("prior") },
            retirePersistedContestSpots: { await calls.record("retire") },
            deferPersistedContestSpots: { await calls.record("defer"); return 1 })
        let result = try await cluster.handle(method: "cluster_contest_radio_spots_publish", params: [
            "publisher_id": UUID().uuidString, "publisher_started_at": 2, "publication_sequence": 1,
            "action": "replace", "session_id": UUID().uuidString, "workspace_generation": UUID().uuidString,
            "revision": 1, "configured_bands": ["40m"], "allowed_mode_groups": ["phone"],
            "chunk_index": 0, "chunk_count": 1, "spots": [[
                "spot_id": "offline", "callsign": "DL1AAA", "frequency_hz": 7_125_000, "band": "40m", "mode": "SSB",
                "spotter": "W1AW", "comment": "Private fixture", "timestamp": Date().timeIntervalSinceReferenceDate,
                "points": 3, "dupe": false, "multiplier_count": 0, "country_multiplier": false, "zone_multiplier": false]]])
        #expect(result["accepted"] as? Int == 0)
        #expect(await cluster.terminate(deferRadioSpotCleanup: deferred))
        #expect(await calls.values().isEmpty)
    }

    @Test("Offline process EOF cannot invoke an injected persisted inventory callback", arguments: [WorkerOperatingModule.normalLogging, .contesting])
    func offlineProcessEOF(module: WorkerOperatingModule) async throws {
        try await checkWorkerEOF(profileIsOffline: true, localAcceptance: false, module: module)
    }

    @Test("Local acceptance also fences injected cleanup under a production runtime profile")
    func localAcceptanceEOF() async throws {
        try await checkWorkerEOF(profileIsOffline: false, localAcceptance: true, module: .normalLogging)
    }

    private func checkWorkerEOF(profileIsOffline: Bool, localAcceptance: Bool, module: WorkerOperatingModule) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let profile: AppRuntimeProfile = profileIsOffline ? .contestingTest(supportRoot: root) : .production
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false, runtimeProfile: profile)
        defer { clean(logbook, root: root, profile: profile) }
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let calls = Calls()
        // Deliberately leave this injected cluster's own policy enabled. The
        // worker's EOF fence must independently suppress its cleanup hook.
        let cluster = LiveClusterMethods(logbook: logbook,
            deferPersistedContestSpots: { await calls.record("defer"); return 1 })
        let worker = LiveWorker(logbook: logbook, localAcceptance: localAcceptance, cluster: cluster,
            ownsProcessSessions: true, runtimeProfile: profile, operatingModule: module)
        await worker.startBackgroundServices()
        #expect(await worker.shutdownOutcome() == .clean)
        #expect(await calls.values().isEmpty)
    }

    @Test("Production fixture retirement retains persisted cleanup and uncertainty")
    func productionRetirementUnchanged() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { clean(logbook, root: root, profile: .production) }
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let calls = Calls()
        let cluster = LiveClusterMethods(logbook: logbook,
            deferPersistedContestSpots: { await calls.record("defer"); return 1 })
        let worker = LiveWorker(logbook: logbook, cluster: cluster, runtimeProfile: .production)
        #expect(await worker.shutdownOutcome() == .contestSpotCleanupDeferred)
        #expect(await calls.values() == ["defer"])
    }
}
