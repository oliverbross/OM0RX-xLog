import Foundation
import Testing
@testable import XLogCore

@Suite struct RemoteBackupPlanningTests {
    private func destination(retention: RemoteBackupRetention = .keepAll, revision: UInt64 = 1,
                             id: UUID = UUID(), account: UUID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!) throws -> RemoteBackupDestination {
        try .init(id: id, revision: revision, provider: .googleDrive, accountID: account,
                  location: .cloudFolder(id: "folder-123"), retention: retention)
    }

    private func receipt(_ destination: RemoteBackupDestination, at seconds: Double,
                         id: UUID = UUID(), outcome: RemoteBackupUploadOutcome? = nil) throws -> RemoteBackupUploadReceipt {
        let package = try RemoteBackupPackageIdentity(sha256: String(repeating: "a", count: 64), byteCount: 42)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: 1, destination: destination, backupID: id, package: package)
        return try .init(plan: plan, outcome: outcome ?? .verified(package: package, at: Date(timeIntervalSince1970: seconds)))
    }

    @Test func defaultsAndCloudValidation() throws {
        let value = try destination()
        #expect(value.schedule == .disabled)
        #expect(value.retention == .keepAll)
        #expect(value.security == .authenticatedEncryptionRequired)
        #expect(value.accountID == UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
        #expect(value.accountID != value.id)
        for provider in [RemoteBackupProvider.googleDrive, .oneDrive, .dropbox] {
            _ = try RemoteBackupDestination(id: UUID(), revision: 1, provider: provider, accountID: UUID(),
                                           location: .cloudFolder(id: "folder_1"))
        }
        _ = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .oneDrive, accountID: UUID(),
                                        location: .cloudFolder(id: "012ABC!123"))
        _ = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox, accountID: UUID(),
                                        location: .cloudFolder(id: "id:a4ayc_80_OEAAAAAAAAAXw"))
        #expect(throws: RemoteBackupPlanningError.invalidDestination) { try destination(revision: 0) }
        #expect(throws: RemoteBackupPlanningError.invalidDestination) {
            try RemoteBackupDestination(id: UUID(), revision: 1, provider: .googleDrive, accountID: UUID(),
                                        location: .cloudFolder(id: "https://sharing.example/token"))
        }
        #expect(throws: RemoteBackupPlanningError.invalidDestination) {
            try RemoteBackupDestination(id: UUID(), revision: 1, provider: .sftp, accountID: UUID(), location: .cloudFolder(id: "folder"))
        }
        #expect(throws: RemoteBackupPlanningError.invalidSchedule) { try RemoteBackupSchedule.every(hours: 0) }
        #expect(try RemoteBackupSchedule.every(hours: 24).intervalHours == 24)
        #expect(throws: RemoteBackupPlanningError.invalidRetention) { try RemoteBackupRetention.keepLatestVerified(0) }
    }

    @Test func serverSecurityAndPathValidation() throws {
        func server(_ provider: RemoteBackupProvider = .sftp, _ endpoint: String = "sftp://backup.example:22",
                    _ path: String = "/xLog backups", _ security: RemoteBackupTransportSecurity = .authenticatedEncryptionRequired) throws -> RemoteBackupDestination {
            try .init(id: UUID(), revision: 1, provider: provider, accountID: UUID(),
                      location: .server(endpoint: URL(string: endpoint)!, directory: path), security: security)
        }
        _ = try server()
        _ = try server(.ftps, "ftps://backup.example:990", "/")
        _ = try server(.ftp, "ftp://backup.example", "/backups", .explicitlyAcceptedPlainFTP)
        #expect(throws: RemoteBackupPlanningError.invalidDestination) { try server(.ftp, "ftp://backup.example") }
        #expect(throws: RemoteBackupPlanningError.invalidDestination) { try server(.sftp, "sftp://backup.example", "/", .explicitlyAcceptedPlainFTP) }
        for endpoint in ["https://backup.example", "sftp://user:password@backup.example", "sftp://backup.example/path", "sftp://backup.example?q=token", "sftp://backup.example#token", "sftp://backup.example:0", "sftp://backup.example:65536"] {
            #expect(throws: RemoteBackupPlanningError.invalidDestination) { try server(.sftp, endpoint) }
        }
        for path in ["relative", "/a/../b", "/./a", "/a//b", "/a/", "/%2e%2e", "/a\\b", "/a\nb"] {
            #expect(throws: RemoteBackupPlanningError.invalidPath) { try server(.sftp, "sftp://backup.example", path) }
        }
    }

    @Test func immutableUploadBindingAndPackageValidation() throws {
        let dest = try destination()
        let package = try RemoteBackupPackageIdentity(sha256: String(repeating: "A", count: 64), byteCount: 256)
        #expect(package.sha256 == String(repeating: "a", count: 64))
        for digest in ["", String(repeating: "g", count: 64), String(repeating: "a", count: 63)] {
            #expect(throws: RemoteBackupPlanningError.invalidPackage) { try RemoteBackupPackageIdentity(sha256: digest, byteCount: 1) }
        }
        #expect(throws: RemoteBackupPlanningError.invalidPackage) { try RemoteBackupPackageIdentity(sha256: package.sha256, byteCount: 0) }
        let id = UUID()
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: 7, destination: dest, backupID: id, package: package)
        #expect(plan.objectName == "om0rx-xlog-\(id.uuidString.lowercased()).xlogbackup")
        try plan.validate(workspaceGeneration: 7, destination: dest)
        #expect(throws: RemoteBackupPlanningError.staleContext) { try plan.validate(workspaceGeneration: 8, destination: dest) }
        let changed = try destination(revision: 2, id: dest.id)
        #expect(throws: RemoteBackupPlanningError.staleContext) { try plan.validate(workspaceGeneration: 7, destination: changed) }
        let switchedAccount = try destination(id: dest.id, account: UUID())
        #expect(throws: RemoteBackupPlanningError.staleContext) { try plan.validate(workspaceGeneration: 7, destination: switchedAccount) }
        let wrongPackage = try RemoteBackupPackageIdentity(sha256: package.sha256, byteCount: 255)
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            try RemoteBackupUploadReceipt(plan: plan, outcome: .verified(package: wrongPackage, at: Date()))
        }
        #expect(throws: RemoteBackupPlanningError.invalidReceipt) {
            try RemoteBackupUploadReceipt(plan: plan, outcome: .verified(package: package, at: Date(timeIntervalSince1970: .infinity)))
        }
    }

    @Test func retentionPreservesForeignFailedUncertainAndNewest() throws {
        let dest = try destination(retention: .keepLatestVerified(1))
        let oldest = try receipt(dest, at: 10)
        let newest = try receipt(dest, at: 30)
        let middle = try receipt(dest, at: 20)
        let failed = try receipt(dest, at: 40, outcome: .failed)
        let uncertain = try receipt(dest, at: 50, outcome: .uncertain)
        let foreign = try receipt(destination(), at: 5)
        let priorRevision = try receipt(destination(revision: 2, id: dest.id), at: 1)
        let plan = RemoteBackupRetentionPlan(destination: dest, receipts: [failed, newest, foreign, oldest, uncertain, middle, priorRevision])
        #expect(plan.deletions == [middle, oldest])
        #expect(RemoteBackupRetentionPlan(destination: dest, receipts: [newest]).deletions.isEmpty)
        let keepAll = try destination()
        #expect(RemoteBackupRetentionPlan(destination: keepAll, receipts: [try receipt(keepAll, at: 1), try receipt(keepAll, at: 2)]).deletions.isEmpty)
    }

    @Test func retentionPreservesAmbiguousObjectReceiptsAndHasStableTies() throws {
        let dest = try destination(retention: .keepLatestVerified(1))
        let id = UUID()
        let duplicate = try receipt(dest, at: 1, id: id)
        let uncertainDuplicate = try receipt(dest, at: 2, id: id, outcome: .uncertain)
        let newest = try receipt(dest, at: 3)
        #expect(RemoteBackupRetentionPlan(destination: dest, receipts: [duplicate, uncertainDuplicate, newest]).deletions.isEmpty)
        let priorRevision = try destination(revision: 2, id: dest.id)
        let ambiguousPriorRevision = try receipt(priorRevision, at: 2, id: id, outcome: .uncertain)
        #expect(RemoteBackupRetentionPlan(destination: dest, receipts: [duplicate, ambiguousPriorRevision, newest]).deletions.isEmpty)
        let low = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        let high = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
        let a = try receipt(dest, at: 5, id: low), b = try receipt(dest, at: 5, id: high)
        #expect(RemoteBackupRetentionPlan(destination: dest, receipts: [b, a]).deletions == [b])
        #expect(RemoteBackupRetentionPlan(destination: dest, receipts: [a, b]).deletions == [b])
    }
}
