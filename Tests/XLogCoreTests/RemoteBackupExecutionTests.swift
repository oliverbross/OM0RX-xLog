import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct RemoteBackupExecutionTests {
    // Return frozen bytes after removing the entire fixture, proving no upload can reopen it.
    private func fixture() throws -> (XLogBackupEnvelope, RemoteBackupUploadPlan) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-upload-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("source.sqlite"))
        defer { database.close() }
        let manager = XLogBackupManager()
        let package = root.appendingPathComponent("test.xlogbackup")
        try manager.create(database: database, at: package, settings: .defaults,
            preferences: XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
                deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false))
        let envelope = try manager.prepareEnvelope(at: package)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "folder"))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: destination,
            backupID: UUID(), package: envelope.identity)
        return (envelope, plan)
    }

    @Test func frozenBytesAreVerifiedAndDuplicatesDoNotUpload() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity)
        let receipt = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
            destination: plan.destination, transport: transport)
        guard case .verified(let identity, _) = receipt.outcome else {
            Issue.record("independently matching content must be verified")
            return
        }
        #expect(identity == envelope.identity)
        #expect(await transport.bytes == envelope.data)
        #expect(try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
            destination: plan.destination, transport: transport) == receipt)
        #expect(await transport.creates == 1)
        #expect(await transport.verifications == 1)
    }

    @Test(arguments: [RecordingBackupTransport.Mode.conflict, .notCreated, .writeThrows, .verifyThrows, .mismatch])
    private func failuresNeverVerifyOrRetry(mode: RecordingBackupTransport.Mode) async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity, mode: mode)
        let receipt = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
            destination: plan.destination, transport: transport)
        #expect(receipt.outcome == (mode == .conflict || mode == .notCreated ? .failed : .uncertain))
        #expect(try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
            destination: plan.destination, transport: transport) == receipt)
        #expect(await transport.creates == 1)
        #expect(await transport.verifications == (mode == .verifyThrows || mode == .mismatch ? 1 : 0))
    }

    @Test func rejectsStaleOrMismatchedInputsBeforeTransport() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 2,
                destination: plan.destination, transport: transport)
        }
        let wrong = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: plan.destination,
            backupID: plan.backupID, package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
        await #expect(throws: RemoteBackupPlanningError.invalidPackage) {
            try await coordinator.upload(envelope: envelope, plan: wrong, workspaceGeneration: 1,
                destination: plan.destination, transport: transport)
        }
        #expect(await transport.creates == 0)
    }

    @Test func cancellationBeforeCreationDoesNotReserveTheOperation() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity)
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
                destination: plan.destination, transport: transport)
        }
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        #expect(await transport.creates == 0)
        _ = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
            destination: plan.destination, transport: transport)
        #expect(await transport.creates == 1)
    }

    @Test func inFlightAndReboundOperationsCannotCreateTwice() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity, paused: true)
        let first = Task {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
                destination: plan.destination, transport: transport)
        }
        await transport.waitUntilStarted()
        await #expect(throws: RemoteBackupExecutionError.operationInProgress) {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 1,
                destination: plan.destination, transport: transport)
        }
        let rebound = try RemoteBackupUploadPlan(workspaceGeneration: 2, destination: plan.destination,
            backupID: plan.backupID, package: envelope.identity)
        await #expect(throws: RemoteBackupExecutionError.conflictingOperation) {
            try await coordinator.upload(envelope: envelope, plan: rebound, workspaceGeneration: 2,
                destination: plan.destination, transport: transport)
        }
        await transport.resume()
        _ = try await first.value
        #expect(await transport.creates == 1)
        // Context validation still runs before returning a cached receipt.
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: 2,
                destination: plan.destination, transport: transport)
        }
    }
}

private actor RecordingBackupTransport: RemoteBackupUploadTransport {
    enum Mode: Sendable { case success, conflict, notCreated, writeThrows, verifyThrows, mismatch }
    struct AdapterError: Error {}
    let identity: RemoteBackupPackageIdentity
    let mode: Mode
    let paused: Bool
    var creates = 0
    var verifications = 0
    var bytes: Data?
    private var started: CheckedContinuation<Void, Never>?
    private var gate: CheckedContinuation<Void, Never>?

    init(identity: RemoteBackupPackageIdentity, mode: Mode = .success, paused: Bool = false) {
        self.identity = identity; self.mode = mode; self.paused = paused
    }

    func createExclusively(plan: RemoteBackupUploadPlan, bytes: Data) async throws -> RemoteBackupExclusiveCreateResult {
        creates += 1
        self.bytes = bytes
        if paused {
            await withCheckedContinuation { continuation in
                gate = continuation
                started?.resume()
                started = nil
            }
        }
        switch mode {
        case .conflict: return .conflict
        case .notCreated: return .notCreated
        case .writeThrows: throw AdapterError()
        default: return .created
        }
    }

    func verifiedRemoteIdentity(plan: RemoteBackupUploadPlan) async throws -> RemoteBackupPackageIdentity {
        verifications += 1
        if mode == .verifyThrows { throw AdapterError() }
        if mode == .mismatch {
            return try RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1)
        }
        return identity
    }

    func waitUntilStarted() async {
        if gate != nil { return }
        await withCheckedContinuation { started = $0 }
    }

    func resume() {
        gate?.resume()
        gate = nil
    }
}

