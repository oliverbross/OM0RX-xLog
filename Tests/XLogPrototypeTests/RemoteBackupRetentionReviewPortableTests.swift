import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct RemoteBackupRetentionReviewTests {
    private let generation = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    private func destination(keep: Int? = 1, id: UUID = UUID(), revision: UInt64 = 1) throws -> RemoteBackupDestination {
        try RemoteBackupDestination(id: id, revision: revision, provider: .dropbox, accountID: UUID(),
            location: .cloudFolder(id: "id:fixture-folder"), retention: keep.map { try .keepLatestVerified($0) } ?? .keepAll)
    }
    private func receipt(_ destination: RemoteBackupDestination, at date: Double, generation: UUID? = nil,
                         id: UUID = UUID(), objectID: String? = nil, account: String = "dbid:fixture",
                         proof: Bool = true, verified: Bool = true) throws -> RemoteBackupUploadReceipt {
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: generation ?? self.generation, destination: destination,
            backupID: id, package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
        return try RemoteBackupUploadReceipt(plan: plan,
            outcome: verified ? .verified(package: plan.package, at: Date(timeIntervalSince1970: date)) : .uncertain,
            remoteObject: proof && verified ? RemoteBackupVerifiedObject(provider: .dropbox, providerAccountID: account,
                objectID: objectID ?? "id:" + id.uuidString.lowercased(), revision: "abcdef123456") : nil)
    }
    private func review(_ destination: RemoteBackupDestination, _ receipts: [RemoteBackupUploadReceipt]) throws -> RemoteBackupRetentionReview {
        try RemoteBackupRetentionReview(workspaceGeneration: generation, destination: destination,
            providerAccountID: "dbid:fixture", receipts: receipts, at: Date(timeIntervalSince1970: 100))
    }

    @Test func onlyExactPinnedVerifiedObjectsBecomeStableCandidates() throws {
        let destination = try destination(), old = try receipt(destination, at: 1), newest = try receipt(destination, at: 3)
        let middle = try receipt(destination, at: 2), foreign = try receipt(self.destination(), at: 4)
        let priorWorkspace = try receipt(destination, at: 5, generation: UUID())
        let account = try receipt(destination, at: 6, account: "dbid:foreign")
        let uncertain = try receipt(destination, at: 7, verified: false)
        let inputs = [middle, foreign, newest, priorWorkspace, old, account, uncertain]
        let value = try review(destination, inputs)
        #expect(value.candidates == [middle, old])
        #expect(try review(destination, Array(inputs.reversed())).candidates == value.candidates)
        #expect(value.protected.contains { $0.receipt == newest && $0.reason == .newestVerified })
        #expect(value.protected.contains { $0.receipt == account && $0.reason == .foreignAccount })
        #expect(value.protected.filter { $0.reason == .foreignContext }.count == 2)
        #expect(value.protected.contains { $0.receipt == uncertain && $0.reason == .unverified })
    }

    @Test func legacyProoflessReceiptsDoNotConsumeTheVerifiedKeepMinimum() throws {
        let destination = try destination(), old = try receipt(destination, at: 1), pinned = try receipt(destination, at: 2)
        let legacy = try receipt(destination, at: 99, proof: false)
        let value = try review(destination, [legacy, pinned, old])
        #expect(value.candidates == [old])
        #expect(value.protected.contains { $0.receipt == legacy && $0.reason == .missingRemoteIdentity })
        #expect(value.protected.contains { $0.receipt == pinned && $0.reason == .newestVerified })
        let keepAll = try self.destination(keep: nil)
        #expect(try review(keepAll, [receipt(keepAll, at: 1), receipt(keepAll, at: 2)]).candidates.isEmpty)
    }

    @Test func ambiguousBackupAndRemoteObjectIdentitiesAlwaysRemainProtected() throws {
        let destination = try destination(), newest = try receipt(destination, at: 90)
        let duplicate = try receipt(destination, at: 1), otherGeneration = try receipt(destination, at: 2,
            generation: UUID(), id: duplicate.plan.backupID)
        let object = try receipt(destination, at: 3, objectID: "id:shared")
        let objectDuplicate = try receipt(destination, at: 4, objectID: "id:shared")
        let value = try review(destination, [duplicate, otherGeneration, object, objectDuplicate, newest])
        #expect(value.candidates.isEmpty)
        #expect(value.protected.filter { $0.reason == .ambiguousIdentity }.count == 3)
    }

    @Test func clockAnomaliesPreventEveryCandidateAndTiesAreStable() throws {
        let destination = try destination(), future = try receipt(destination, at: 101), old = try receipt(destination, at: 1)
        let value = try review(destination, [future, old])
        #expect(value.candidates.isEmpty)
        #expect(value.protected.allSatisfy { $0.reason == .clockReview })
        let a = try receipt(destination, at: 5, id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
        let b = try receipt(destination, at: 5, id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
        #expect(try review(destination, [b, a]).candidates == [b])
        #expect(throws: RemoteBackupPlanningError.staleContext) {
            try RemoteBackupRetentionReview(workspaceGeneration: generation, destination: destination,
                providerAccountID: "dbid:fixture", receipts: [], at: Date(timeIntervalSince1970: .infinity))
        }
    }

    @Test func pinnedObjectsRequireValidatedSyntaxAndVerifiedOutcomes() throws {
        let destination = try destination(), value = try receipt(destination, at: 1)
        let object = try #require(value.remoteObject)
        #expect(try JSONDecoder().decode(RemoteBackupVerifiedObject.self, from: JSONEncoder().encode(object)) == object)
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            try RemoteBackupUploadReceipt(plan: value.plan, outcome: .uncertain, remoteObject: object)
        }
        for revision in ["", "123", "https://untrusted", String(repeating: "a", count: 129)] {
            #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
                try RemoteBackupVerifiedObject(provider: .dropbox, providerAccountID: "dbid:fixture", objectID: "id:object", revision: revision)
            }
        }
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            try RemoteBackupVerifiedObject(provider: .dropbox, providerAccountID: "https://untrusted", objectID: "id:object", revision: "abcdef123456")
        }
    }

    @Test func readOnlyHistoryPreservesPinnedEvidenceAndLegacyReceiptsAcrossRestart() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-retention-history-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: root).isEmpty)
        #expect(!FileManager.default.fileExists(atPath: root.path))
        let destination = try destination(), value = try receipt(destination, at: 1), legacy = try receipt(destination, at: 2, proof: false)
        let store = try RemoteBackupOperationStore(directory: root)
        #expect(try store.reserve(plan: value.plan) == nil); try store.complete(value)
        #expect(try store.reserve(plan: legacy.plan) == nil); try store.complete(legacy)
        let loaded = try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: root)
        #expect(loaded.count == 2 && loaded.contains(value) && loaded.contains(legacy))
        let bytes = try Data(contentsOf: root.appendingPathComponent(legacy.plan.backupID.uuidString.lowercased() + ".json"))
        #expect(!String(decoding: bytes, as: UTF8.self).contains("remoteObject"))
    }

    @Test func interruptedAndCorruptHistoryCannotProduceVerifiedEvidence() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-retention-interrupt-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = try destination(), value = try receipt(destination, at: 1)
        let store = try RemoteBackupOperationStore(directory: root)
        #expect(try store.reserve(plan: value.plan) == nil)
        let loaded = try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: root)
        #expect(loaded.first?.outcome == .uncertain && loaded.first?.remoteObject == nil)
        #expect(try review(destination, loaded).candidates.isEmpty)
        let url = root.appendingPathComponent(value.plan.backupID.uuidString.lowercased() + ".json")
        try Data("{}".utf8).write(to: url); try LocalFilePermissions.protectFile(url)
        #expect(throws: RemoteBackupPersistenceError.invalidState) { try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: root) }
    }
}

