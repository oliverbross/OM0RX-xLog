import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
import XClusterIntegrationCore
@testable import XLogPrototypeSupport

private struct RefreshFixtureVault: ClusterCredentialStoring {
    let available = false
    func load(_ id: UUID) throws -> String? { nil }
    func save(_ password: String, serverID: UUID) throws { throw WorkerFailure("fixture", "No credential store.") }
}

/// Explicitly held publication, not a sleep or a latency-based assertion.
private actor ContactPublicationGate {
    private var blocked = false
    private var fail = false
    private(set) var calls = 0
    private var publications: [Int: CheckedContinuation<Void, Never>] = [:]
    private var observers: [(Int, CheckedContinuation<Void, Never>)] = []
    func arm(failing: Bool = false) { blocked = true; fail = failing; calls = 0 }
    func hold() async throws {
        guard blocked else { return }
        calls += 1
        let number = calls
        await withCheckedContinuation { continuation in
            publications[number] = continuation
            let ready = observers.filter { $0.0 <= calls }
            observers.removeAll { $0.0 <= calls }
            ready.forEach { $0.1.resume() }
        }
        if fail { throw WorkerFailure("fixture_refresh_failure", "Synthetic projection failure.") }
    }
    func started(_ count: Int) async {
        if calls >= count { return }
        await withCheckedContinuation { observers.append((count, $0)) }
    }
    func release(_ number: Int) { publications.removeValue(forKey: number)?.resume() }
    func releaseAll() {
        blocked = false
        let pending = publications.values
        publications.removeAll()
        pending.forEach { $0.resume() }
    }
}

@Suite("Durable save before background contact projection", .timeLimit(.minutes(1)))
struct PostCommitContactRefreshTests {
    private func request(_ worker: LiveWorker, _ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let bytes = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method, "params": params])
        return try #require(JSONSerialization.jsonObject(with: await worker.response(to: bytes)) as? [String: Any])
    }
    private func setup(_ root: URL, _ gate: ContactPublicationGate) async throws -> (LiveLogbookMethods, LiveClusterMethods, LiveWorker) {
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let cluster = LiveClusterMethods(logbook: logbook, vault: RefreshFixtureVault(), transportFactory: { _, _, _, _, _, _ in
            preconditionFailure("These synthetic tests must never connect a transport.")
        }, beforeContactPublication: { try await gate.hold() })
        _ = try await cluster.handle(method: "cluster_snapshot", params: [:])
        return (logbook, cluster, LiveWorker(logbook: logbook, cluster: cluster))
    }
    private func saveParams(_ worker: LiveWorker, call: String) async throws -> [String: Any] {
        let response = try await request(worker, "logbook_operator_draft")
        let draft = try #require((response["result"] as? [String: Any])?["draft"] as? [String: Any])
        var qso = try #require(draft["qso"] as? [String: Any])
        qso["call"] = call
        let generation = try #require(draft["generation"] as? String)
        let replace: [String: Any] = ["generation": generation, "operationID": UUID().uuidString,
            "draftID": qso["id"]!, "expectedRevision": draft["revision"]!, "action": "replace", "qso": qso]
        let changed = try await request(worker, "logbook_operator_draft_apply", replace)
        #expect(changed["ok"] as? Bool == true)
        let receipt = try #require((changed["result"] as? [String: Any])?["receipt"] as? [String: Any])
        let current = try #require(receipt["draft"] as? [String: Any])
        return ["generation": generation, "operationID": UUID().uuidString, "draftID": qso["id"]!,
                "expectedRevision": current["revision"]!, "action": "save"]
    }
    private func finish(_ worker: LiveWorker, _ cluster: LiveClusterMethods, _ gate: ContactPublicationGate) async {
        let job = await worker.contactRefreshTask
        await worker.beginTerminalShutdown()
        await gate.releaseAll()
        await job?.value
        await cluster.terminate()
    }

    @Test("Response and receipt are durable while classification publication is held")
    func durableBeforeRefresh() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContactPublicationGate()
        let (logbook, cluster, worker) = try await setup(root, gate)
        let params = try await saveParams(worker, call: "K1ABC")
        await gate.arm()
        // With the former awaited refresh this never returns until the test timeout.
        let response = try await request(worker, "logbook_operator_draft_apply", params)
        #expect(response["ok"] as? Bool == true)
        let result = try #require(response["result"] as? [String: Any])
        #expect(result["status"] as? String == "applied")
        let receipt = try #require(result["receipt"] as? [String: Any])
        #expect((receipt["savedQSO"] as? [String: Any])?["call"] as? String == "K1ABC")
        await gate.started(1)
        let disk = try LogbookDatabase(url: logbook.workspaceDirectoryURL.appendingPathComponent("OM0RX-xLog.sqlite"))
        #expect(try disk.count() == 1)
        #expect(try disk.operatorDraftReceipt(operationID: UUID(uuidString: params["operationID"] as! String)!)?.savedQSO?.call == "K1ABC")
        disk.close()
        let job = await worker.contactRefreshTask
        await gate.releaseAll(); await job?.value
        let current = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect((current["snapshot"] as? [String: Any])?["contactCount"] as? Int == 1)
        #expect(current["contact_refresh_state"] as? String == "current")
        let retry = try await request(worker, "logbook_operator_draft_apply", params)
        let repeated = try #require((retry["result"] as? [String: Any])?["receipt"] as? [String: Any])
        #expect(repeated["savedQSO"] as? NSDictionary == receipt["savedQSO"] as? NSDictionary)
        #expect(try logbook.openedDatabase().count() == 1)
        await finish(worker, cluster, gate)
    }

    @Test("Burst saves return while held and collapse into one follow-up projection")
    func coalescedBurst() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContactPublicationGate()
        let (logbook, cluster, worker) = try await setup(root, gate)
        await gate.arm()
        for call in ["K1AAA", "K1BBB", "K1CCC"] {
            let params = try await saveParams(worker, call: call)
            #expect(try await request(worker, "logbook_operator_draft_apply", params)["ok"] as? Bool == true)
            await gate.started(1)
        }
        #expect(await gate.calls == 1)
        #expect(try logbook.openedDatabase().count() == 3)
        let job = await worker.contactRefreshTask
        await gate.release(1)
        await gate.started(2)
        #expect(await gate.calls == 2)
        await gate.releaseAll(); await job?.value
        #expect(await gate.calls == 2)
        let current = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect((current["snapshot"] as? [String: Any])?["contactCount"] as? Int == 3)
        await finish(worker, cluster, gate)
    }

    @Test("Opt-in generated 68k log durable-save timing",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_SAVE_PERF"] == "1"),
          .timeLimit(.minutes(5)))
    func generatedLargeLogSaveTiming() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-save-perf-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContactPublicationGate()
        let (logbook, cluster, worker) = try await setup(root, gate)
        let db = try logbook.openedDatabase()
        let base = Date(timeIntervalSince1970: 1_577_836_800)
        for offset in stride(from: 0, to: 68_000, by: 256) {
            let rows = (offset..<min(offset + 256, 68_000)).map { index in
                QSO(call: "K1T" + String(index % 2000, radix: 36).uppercased(),
                    start: base.addingTimeInterval(Double(index) * 60),
                    band: ["20m", "40m", "15m"][index % 3],
                    mode: ["CW", "SSB", "FT8"][index % 3], dxcc: 291)
            }
            #expect(try db.importBatch(rows) == rows.count)
        }
        #expect(try db.count() == 68_000)
        let disk = try LogbookDatabase(url: db.url)
        defer { disk.close() }
        await gate.arm()
        var milliseconds: [Double] = []
        for index in 0..<50 {
            let params = try await saveParams(worker, call: "K2PERF\(index)")
            let started = ProcessInfo.processInfo.systemUptime
            let response = try await request(worker, "logbook_operator_draft_apply", params)
            milliseconds.append((ProcessInfo.processInfo.systemUptime - started) * 1000)
            #expect(response["ok"] as? Bool == true)
            // Validate committed rows/receipts independently, outside the timing.
            let operationID = try #require(UUID(uuidString: params["operationID"] as! String))
            #expect(try disk.operatorDraftReceipt(operationID: operationID)?.savedQSO?.call == "K2PERF\(index)")
            #expect(try disk.count() == 68_001 + index)
        }
        await gate.started(1)
        #expect(await gate.calls == 1)
        let sorted = milliseconds.sorted()
        let median = (sorted[24] + sorted[25]) / 2
        let p95 = sorted[Int(ceil(Double(sorted.count) * 0.95)) - 1]
        print(String(format: "GENERATED_SAVE_PERFORMANCE initial_qsos=68000 samples=50 median_ms=%.3f p95_ms=%.3f max_ms=%.3f background_projection=held", median, p95, sorted.last!))
        // This isolates durable worker response, not UI paint, transport, sync,
        // concurrent aggregate contention or installed-app end-to-end latency.
        await finish(worker, cluster, gate)
    }

    @Test("Restore retires an old projection before replacing its database")
    func workspaceFence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContactPublicationGate()
        let (logbook, cluster, worker) = try await setup(root, gate)
        let backup = try logbook.handle(method: "backup_create", params: ["name": "Empty"])
        let params = try await saveParams(worker, call: "K1OLD")
        await gate.arm()
        #expect(try await request(worker, "logbook_operator_draft_apply", params)["ok"] as? Bool == true)
        await gate.started(1)
        let oldJob = await worker.contactRefreshTask
        let restored = try await request(worker, "backup_restore", ["name": backup["name"]!, "confirm_restore": true,
            "restore_settings": false, "restore_preferences": false, "restore_reference_data": false])
        #expect(restored["ok"] as? Bool == true)
        await gate.started(2)
        await gate.release(1); await oldJob?.value
        let held = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect((held["snapshot"] as? [String: Any])?["contactCount"] as? Int == 0)
        #expect(try logbook.openedDatabase().count() == 0)
        let newJob = await worker.contactRefreshTask
        await gate.releaseAll(); await newJob?.value
        let current = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect(current["contact_refresh_state"] as? String == "current")
        #expect((current["snapshot"] as? [String: Any])?["contactCount"] as? Int == 0)
        await finish(worker, cluster, gate)
    }

    @Test("Shutdown cancels a held publication without revoking its durable save")
    func shutdownFence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContactPublicationGate()
        let (logbook, cluster, worker) = try await setup(root, gate)
        let params = try await saveParams(worker, call: "K1END")
        await gate.arm()
        #expect(try await request(worker, "logbook_operator_draft_apply", params)["ok"] as? Bool == true)
        await gate.started(1)
        let job = await worker.contactRefreshTask
        await worker.beginTerminalShutdown()
        await gate.releaseAll(); await job?.value
        let snapshot = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect((snapshot["snapshot"] as? [String: Any])?["contactCount"] as? Int == 0)
        #expect(try logbook.openedDatabase().count() == 1)
        let late = try await request(worker, "logbook_operator_draft_apply", params)
        #expect((late["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
        await cluster.terminate()
    }

    @Test("Projection failure stays stale and does not turn a committed save into failure")
    func refreshFailure() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContactPublicationGate()
        let (logbook, cluster, worker) = try await setup(root, gate)
        let params = try await saveParams(worker, call: "K1ERR")
        await gate.arm(failing: true)
        #expect(try await request(worker, "logbook_operator_draft_apply", params)["ok"] as? Bool == true)
        await gate.started(1)
        let job = await worker.contactRefreshTask
        await gate.releaseAll(); await job?.value
        let current = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect(current["contact_refresh_state"] as? String == "stale")
        #expect(current["contact_refresh_error"] as? String == "CONTACT_REFRESH_UNAVAILABLE")
        #expect((current["snapshot"] as? [String: Any])?["contactCount"] as? Int == 0)
        #expect(try logbook.openedDatabase().count() == 1)
        await finish(worker, cluster, gate)
    }

    @Test("Destination rejects late older publications, including across invalidation and termination")
    func destinationRevisionFence() async throws {
        let service = ClusterSessionService(configuration: .init(servers: []))
        let old = ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW", adif: 291, date: Date())
        let new = ClusterContact(callsign: "K1NEW", band: "20m", mode: "CW", adif: 291, date: Date())
        // Simulate reversed arrival order at the destination actor itself.
        #expect(await service.replaceContacts([new, new], publicationRevision: 2))
        let accepted = await service.snapshot()
        #expect(await service.replaceContacts([old], publicationRevision: 1) == false)
        #expect(await service.snapshot().contactCount == 2)
        #expect(await service.snapshot().contactRevision == accepted.contactRevision)
        await service.invalidateContacts(publicationRevision: 1)
        #expect(await service.snapshot().contactCount == 2)
        #expect(await service.snapshot().contactRevision == accepted.contactRevision)
        await service.invalidateContacts(publicationRevision: 3)
        let invalidated = await service.snapshot()
        #expect(await service.replaceContacts([old], publicationRevision: 2) == false)
        #expect(await service.snapshot().contactCount == 0)
        #expect(await service.snapshot().contactRevision == invalidated.contactRevision)
        #expect(await service.snapshot().logbookDataLoaded == false)
        #expect(await service.replaceContacts([new], publicationRevision: 4))
        await service.terminate()
        #expect(await service.replaceContacts([old, old], publicationRevision: 5) == false)
        #expect(await service.snapshot().contactCount == 1)
    }

    @Test("Rejected restore restores the original projection and retains its failure")
    func rejectedRestore() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContactPublicationGate()
        let (logbook, cluster, worker) = try await setup(root, gate)
        let params = try await saveParams(worker, call: "K1KEEP")
        await gate.arm()
        #expect(try await request(worker, "logbook_operator_draft_apply", params)["ok"] as? Bool == true)
        await gate.started(1)
        let oldJob = await worker.contactRefreshTask
        let rejected = try await request(worker, "backup_restore", ["name": "Missing.xlogbackup", "confirm_restore": true])
        #expect(rejected["ok"] as? Bool == false)
        await gate.started(2)
        await gate.release(1); await oldJob?.value
        let newJob = await worker.contactRefreshTask
        await gate.releaseAll(); await newJob?.value
        let current = try await cluster.handle(method: "cluster_snapshot", params: [:])
        #expect(current["contact_refresh_state"] as? String == "current")
        #expect((current["snapshot"] as? [String: Any])?["contactCount"] as? Int == 1)
        #expect(try logbook.openedDatabase().count() == 1)
        await finish(worker, cluster, gate)
    }
}
