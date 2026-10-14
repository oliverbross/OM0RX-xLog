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
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: destination,
            backupID: UUID(), package: envelope.identity)
        return (envelope, plan)
    }

    @Test func frozenBytesAreVerifiedAndDuplicatesDoNotUpload() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity)
        let receipt = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: transport)
        guard case .verified(let identity, _) = receipt.outcome else {
            Issue.record("independently matching content must be verified")
            return
        }
        #expect(identity == envelope.identity)
        #expect(await transport.bytes == envelope.data)
        #expect(try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: transport) == receipt)
        #expect(await transport.creates == 1)
        #expect(await transport.verifications == 1)
    }

    @Test(arguments: [RecordingBackupTransport.Mode.conflict, .notCreated, .writeThrows, .verifyThrows, .mismatch])
    private func failuresNeverVerifyOrRetry(mode: RecordingBackupTransport.Mode) async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity, mode: mode)
        let receipt = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: transport)
        #expect(receipt.outcome == (mode == .conflict || mode == .notCreated ? .failed : .uncertain))
        #expect(try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: transport) == receipt)
        #expect(await transport.creates == 1)
        #expect(await transport.verifications == (mode == .verifyThrows || mode == .mismatch ? 1 : 0))
    }

    @Test func rejectsStaleOrMismatchedInputsBeforeTransport() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                destination: plan.destination, transport: transport)
        }
        let wrong = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: plan.destination,
            backupID: plan.backupID, package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
        await #expect(throws: RemoteBackupPlanningError.invalidPackage) {
            try await coordinator.upload(envelope: envelope, plan: wrong, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                destination: plan.destination, transport: transport)
        }
        #expect(await transport.creates == 0)
    }

    @Test(arguments: [RecordingBackupTransport.Mode.success, .notCreated, .writeThrows, .verifyThrows, .mismatch])
    private func terminalReceiptsSurviveRestartWithoutReplay(mode: RecordingBackupTransport.Mode) async throws {
        let (envelope, plan) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-receipts-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try RemoteBackupUploadCoordinator(stateDirectory: root)
        let writer = RecordingBackupTransport(identity: envelope.identity, mode: mode)
        let receipt = try await first.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: writer)
        let restarted = try RemoteBackupUploadCoordinator(stateDirectory: root)
        let reader = RecordingBackupTransport(identity: envelope.identity)
        #expect(try await restarted.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: reader) == receipt)
        #expect(await reader.creates == 0)
        // An owner created before another owner writes must also honor its reservation.
        let stale = try RemoteBackupUploadCoordinator(stateDirectory: root)
        let rebound = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, destination: plan.destination,
            backupID: plan.backupID, package: plan.package)
        await #expect(throws: RemoteBackupExecutionError.conflictingOperation) {
            try await stale.upload(envelope: envelope, plan: rebound, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                destination: plan.destination, transport: reader)
        }
        #expect(await reader.creates == 0)
    }

    @Test func completionStorageFailureNeverReportsVerifiedOrReplays() async throws {
        let (envelope, plan) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-save-failure-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let coordinator = try RemoteBackupUploadCoordinator(stateDirectory: root)
        let transport = RecordingBackupTransport(identity: envelope.identity, paused: true)
        let first = Task {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                destination: plan.destination, transport: transport)
        }
        await transport.waitUntilStarted()
        try FileManager.default.removeItem(at: root.appendingPathComponent(plan.backupID.uuidString.lowercased() + ".json"))
        await transport.resume()
        await #expect(throws: RemoteBackupPersistenceError.unavailable) { try await first.value }
        let repeatReceipt = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: transport)
        #expect(repeatReceipt.outcome == .uncertain)
        #expect(await transport.creates == 1)
        #expect(throws: RemoteBackupPersistenceError.self) {
            _ = try RemoteBackupUploadCoordinator(stateDirectory: root)
        }
    }

    @Test func allDestinationContractsRoundTripExactly() throws {
        let (envelope, _) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-destinations-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try RemoteBackupOperationStore(directory: root)
        for provider in [RemoteBackupProvider.googleDrive, .oneDrive, .dropbox, .ftp, .ftps, .sftp] {
            let server = [RemoteBackupProvider.ftp, .ftps, .sftp].contains(provider)
            let location: RemoteBackupLocation = server
                ? .server(endpoint: try #require(URL(string: provider.rawValue + "://backup.example:2222")), directory: "/backups/logs")
                : .cloudFolder(id: "folder_1")
            let destination = try RemoteBackupDestination(id: UUID(), revision: 7, provider: provider,
                accountID: UUID(), location: location,
                security: provider == .ftp ? .explicitlyAcceptedPlainFTP : .authenticatedEncryptionRequired,
                schedule: .every(hours: 24), retention: .keepLatestVerified(2))
            let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000009")!, destination: destination,
                backupID: UUID(), package: envelope.identity)
            #expect(try store.reserve(plan: plan) == nil)
            let receipt = try RemoteBackupUploadReceipt(plan: plan,
                outcome: .verified(package: envelope.identity, at: Date(timeIntervalSince1970: 123_456)))
            try store.complete(receipt)
            #expect(try store.load().contains(receipt))
        }
    }

    @Test func pendingReservationRecoversAsUncertainIncludingStaleOwners() async throws {
        let (envelope, plan) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-pending-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let stale = try RemoteBackupUploadCoordinator(stateDirectory: root)
        let store = try RemoteBackupOperationStore(directory: root)
        #expect(try store.reserve(plan: plan) == nil)
        let restarted = try RemoteBackupUploadCoordinator(stateDirectory: root)
        let transport = RecordingBackupTransport(identity: envelope.identity)
        for coordinator in [stale, restarted] {
            let receipt = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                destination: plan.destination, transport: transport)
            #expect(receipt.outcome == .uncertain)
            #expect(receipt.plan == plan)
        }
        #expect(await transport.creates == 0)
        #expect(await transport.verifications == 0)
    }

    @Test(arguments: ["version", "digest", "truncated", "missing", "oversized", "symlink", "orphan"])
    func corruptStateFailsClosed(mutation: String) throws {
        let (_, plan) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-corrupt-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try RemoteBackupOperationStore(directory: root)
        _ = try store.reserve(plan: plan)
        let record = root.appendingPathComponent(plan.backupID.uuidString.lowercased() + ".json")
        switch mutation {
        case "version", "digest":
            var json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: record)) as? [String: Any])
            if mutation == "version" { json["version"] = 99 }
            else { json["sha256"] = String(repeating: "0", count: 64) }
            try JSONSerialization.data(withJSONObject: json).write(to: record, options: .atomic)
        case "truncated": try Data("{".utf8).write(to: record, options: .atomic)
        case "missing": try FileManager.default.removeItem(at: record)
        case "oversized": try Data(repeating: 0, count: RemoteBackupOperationStore.maximumRecordBytes + 1).write(to: record)
        case "symlink":
            try FileManager.default.removeItem(at: record)
            try FileManager.default.createSymbolicLink(at: record, withDestinationURL: root.appendingPathComponent("absent"))
        default:
            try FileManager.default.removeItem(at: root.appendingPathComponent(plan.backupID.uuidString.lowercased() + ".reserved"))
        }
        #expect(throws: RemoteBackupPersistenceError.self) {
            _ = try RemoteBackupUploadCoordinator(stateDirectory: root)
        }
    }

    #if !os(Windows)
    @Test func nonPrivateStateFilesFailClosed() throws {
        let (_, plan) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-permissions-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try RemoteBackupOperationStore(directory: root)
        _ = try store.reserve(plan: plan)
        let receipt = try RemoteBackupUploadReceipt(plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 123_456)))
        try store.complete(receipt)
        for suffix in [".reserved", ".json"] {
            let target = root.appendingPathComponent(plan.backupID.uuidString.lowercased() + suffix)
            for permissions in [0o640, 0o604] {
                try FileManager.default.setAttributes([.posixPermissions: permissions], ofItemAtPath: target.path)
                #expect(throws: RemoteBackupPersistenceError.invalidState) {
                    _ = try RemoteBackupUploadCoordinator(stateDirectory: root)
                }
                try LocalFilePermissions.protectFile(target)
                #expect(try store.load() == [receipt])
            }
        }
    }
    #endif

    @Test func persistedDestinationAndPackageAreRevalidatedEvenWithRecomputedDigest() throws {
        let (_, plan) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-schema-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try RemoteBackupOperationStore(directory: root)
        _ = try store.reserve(plan: plan)
        let record = root.appendingPathComponent(plan.backupID.uuidString.lowercased() + ".json")
        let original = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: record)) as? [String: Any])
        let originalOperation = try #require(original["operation"] as? [String: Any])
        #expect(original["sha256"] as? String == BackupPackageSeal.hash(try JSONSerialization.data(withJSONObject: originalOperation, options: [.sortedKeys])))
        for (key, value) in [("destinationRevision", 0), ("packageByteCount", 0), ("workspaceGeneration", 0), ("scheduleHours", -1)] {
            var json = original
            var operation = try #require(json["operation"] as? [String: Any])
            operation[key] = value
            json["operation"] = operation
            json["sha256"] = BackupPackageSeal.hash(try JSONSerialization.data(withJSONObject: operation, options: [.sortedKeys]))
            try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]).write(to: record, options: .atomic)
            #expect(throws: RemoteBackupPersistenceError.self) { _ = try store.load() }
        }
    }

    @Test func cancellationBeforeCreationDoesNotReserveTheOperation() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity)
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                destination: plan.destination, transport: transport)
        }
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        #expect(await transport.creates == 0)
        _ = try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            destination: plan.destination, transport: transport)
        #expect(await transport.creates == 1)
    }

    @Test func inFlightAndReboundOperationsCannotCreateTwice() async throws {
        let (envelope, plan) = try fixture()
        let coordinator = RemoteBackupUploadCoordinator()
        let transport = RecordingBackupTransport(identity: envelope.identity, paused: true)
        let first = Task {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                destination: plan.destination, transport: transport)
        }
        await transport.waitUntilStarted()
        await #expect(throws: RemoteBackupExecutionError.operationInProgress) {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                destination: plan.destination, transport: transport)
        }
        let rebound = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, destination: plan.destination,
            backupID: plan.backupID, package: envelope.identity)
        await #expect(throws: RemoteBackupExecutionError.conflictingOperation) {
            try await coordinator.upload(envelope: envelope, plan: rebound, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                destination: plan.destination, transport: transport)
        }
        await transport.resume()
        _ = try await first.value
        #expect(await transport.creates == 1)
        // Context validation still runs before returning a cached receipt.
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await coordinator.upload(envelope: envelope, plan: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
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

