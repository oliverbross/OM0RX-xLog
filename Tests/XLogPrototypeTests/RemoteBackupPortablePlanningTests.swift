import Foundation
import Testing
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

@Suite struct RemoteBackupPortablePlanningTests {
    @Test func defaultOffAndRevisionFence() throws {
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
                                                     accountID: UUID(), location: .cloudFolder(id: "folder-1"))
        #expect(destination.schedule == .disabled)
        #expect(destination.retention == .keepAll)
        let package = try RemoteBackupPackageIdentity(sha256: String(repeating: "a", count: 64), byteCount: 100)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: destination, backupID: UUID(), package: package)
        #expect(throws: RemoteBackupPlanningError.staleContext) {
            try plan.validate(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, destination: destination)
        }
        let receipt = try RemoteBackupUploadReceipt(plan: plan, outcome: .verified(package: package, at: Date()))
        #expect(RemoteBackupRetentionPlan(destination: destination, receipts: [receipt]).deletions.isEmpty)
    }

    @Test func plainFTPRequiresExplicitSecurityPolicy() throws {
        #expect(throws: RemoteBackupPlanningError.invalidDestination) {
            try RemoteBackupDestination(id: UUID(), revision: 1, provider: .ftp, accountID: UUID(),
                                        location: .server(endpoint: URL(string: "ftp://example.invalid")!, directory: "/backups"))
        }
    }
}
