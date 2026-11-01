import Foundation
import Testing
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite("Restore reference-data lease")
struct RestoreReferenceLeaseTests {
    @Test("A held refresh lease rejects restore before generation rotation or database replacement on every platform")
    func contentionPreservesAuthority() throws {
        let temporary = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(FileManager.default.temporaryDirectory), isDirectory: true)
        let root = temporary.appendingPathComponent("xlog-restore-reference-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: LocalFilePermissions.directoryAttributes)
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = AppRuntimeProfile.contestingTest(supportRoot: root)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL,
            expectedIdentityPrefix: AppRuntimeProfile.contestingIdentityPrefix)
        defer {
            (try? service.openedDatabase())?.close()
            UserDefaults.standard.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        let database = try service.openedDatabase()
        try database.save(QSO(call: "N0LEASE", band: "20m", mode: "CW"))
        let backup = try service.handle(method: "backup_create", params: ["name": "reference-lease"])
        let name = try #require(backup["name"] as? String)
        let params: [String: Any] = ["name": name, "confirm_restore": true, "restore_settings": false,
            "restore_preferences": false, "restore_reference_data": false]
        let generation = try service.handle(method: "workspace_status", params: [:])["generation"] as? String
        let authority = try database.aggregateReadAuthority()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let contacts = try encoder.encode(database.fetchAll())
        let reference = try service.referenceDirectoryURL()
        let lease = try ReferenceRefreshLease(directory: reference)
        defer { lease.release() }
        do {
            _ = try service.handle(method: "backup_restore", params: params)
            Issue.record("Restore replaced data while reference refresh still owned its lease.")
        } catch { #expect((error as? WorkerFailure)?.code == "reference_busy") }
        #expect(try service.handle(method: "workspace_status", params: [:])["generation"] as? String == generation)
        #expect(try database.aggregateReadAuthority() == authority)
        #expect(try encoder.encode(database.fetchAll()) == contacts)
        #expect(!FileManager.default.fileExists(atPath: service.workspaceDirectoryURL.appendingPathComponent(".restore-incomplete").path))
        #expect(!FileManager.default.fileExists(atPath: service.workspaceDirectoryURL.appendingPathComponent("Recovery").path))
        lease.release()
        _ = try service.handle(method: "backup_restore", params: params)
        #expect(try service.handle(method: "workspace_status", params: [:])["generation"] as? String != generation)
    }
}
