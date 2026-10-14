import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct BackupEnvelopeTests {
    private func fixture(_ body: (URL, URL, XLogBackupManager) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("source.sqlite"))
        defer { database.close() }
        try database.save(QSO(call: "OM0RX", band: "20m", mode: "CW"))
        let refs = root.appendingPathComponent("refs")
        try FileManager.default.createDirectory(at: refs, withIntermediateDirectories: true)
        try Data("reference".utf8).write(to: refs.appendingPathComponent("nested.json"))
        let manager = XLogBackupManager()
        let package = root.appendingPathComponent("test.xlogbackup")
        try manager.create(database: database, at: package, settings: .defaults,
            preferences: XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
                deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false), referenceDataURL: refs)
        try body(root, package, manager)
    }

    @Test func frozenBytesRoundTripAndPlanBinding() throws {
        try fixture { _, package, manager in
            let envelope = try manager.prepareEnvelope(at: package)
            #expect(try manager.prepareEnvelope(at: package).data == envelope.data)
            #expect(try manager.validateRestoreEnvelope(envelope.data).identity == envelope.identity)
            #expect(envelope.manifest.formatVersion == 2)
            #expect(envelope.settings == XLogSettings.defaults)
            let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
                accountID: UUID(), location: .cloudFolder(id: "folder"))
            let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: destination,
                backupID: UUID(), package: envelope.identity)
            try envelope.validate(for: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: destination)
            #expect(throws: RemoteBackupPlanningError.staleContext) {
                try envelope.validate(for: plan, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, destination: destination)
            }
            let wrong = try RemoteBackupUploadPlan(workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: destination,
                backupID: UUID(), package: RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64), byteCount: 1))
            #expect(throws: RemoteBackupPlanningError.invalidPackage) {
                try envelope.validate(for: wrong, workspaceGeneration: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, destination: destination)
            }
            try Data("changed".utf8).write(to: package.appendingPathComponent("Reference Data/nested.json"))
            #expect(throws: Error.self) { try manager.prepareEnvelope(at: package) }
            // Frozen data remains valid even after the source was changed or removed.
            try FileManager.default.removeItem(at: package)
            #expect(try manager.validateRestoreEnvelope(envelope.data).identity == envelope.identity)
        }
    }

    @Test(arguments: ["settings.json", "preferences.json", "manifest.json", "Reference Data/nested.json", "OM0RX-xLog.sqlite"])
    func everyPayloadIsBound(path: String) throws {
        try fixture { _, package, manager in
            let url = package.appendingPathComponent(path)
            var bytes = try Data(contentsOf: url)
            bytes.append(32)
            try bytes.write(to: url)
            #expect(throws: Error.self) { try manager.inspect(at: package) }
            #expect(throws: Error.self) { try manager.prepareEnvelope(at: package) }
        }
    }

    @Test func missingExtraLinksAndStrippedSealRejected() throws {
        for mutation in 0..<4 {
            try fixture { root, package, manager in
                switch mutation {
                case 0: try FileManager.default.removeItem(at: package.appendingPathComponent("preferences.json"))
                case 1: try Data([1]).write(to: package.appendingPathComponent("extra"))
                case 2: try FileManager.default.createSymbolicLink(at: package.appendingPathComponent("link"),
                                                                  withDestinationURL: root.appendingPathComponent("source.sqlite"))
                default: try FileManager.default.removeItem(at: package.appendingPathComponent(BackupPackageSeal.filename))
                }
                #expect(throws: Error.self) { try manager.prepareEnvelope(at: package) }
                #expect(throws: Error.self) { try manager.inspect(at: package) }
            }
        }
    }

    @Test func untrustedEnvelopePathsVersionsAndHashesRejected() throws {
        try fixture { root, package, manager in
            let envelope = try manager.prepareEnvelope(at: package)
            let original = try JSONDecoder().decode(BackupPackageSeal.Payload.self, from: envelope.data)
            for path in ["../escaped", "/absolute", "Reference Data/../../escaped", "A/../B", "a\\b", "a//b", "NUL", "COM1.txt", "trailing.", "trailing "] {
                var files = original.files
                files[path] = Data([1])
                let payload = BackupPackageSeal.Payload(seal: BackupPackageSeal.make(files), files: files)
                #expect(throws: Error.self) { try manager.validateRestoreEnvelope(BackupPackageSeal.encode(payload)) }
            }
            let unsupported = BackupPackageSeal(version: 99, entries: original.seal.entries)
            #expect(throws: Error.self) {
                try manager.validateRestoreEnvelope(BackupPackageSeal.encode(BackupPackageSeal.Payload(seal: unsupported, files: original.files)))
            }
            var changed = original.files
            changed["Reference Data/nested.json"] = Data("changed".utf8)
            #expect(throws: Error.self) {
                try manager.validateRestoreEnvelope(BackupPackageSeal.encode(BackupPackageSeal.Payload(seal: original.seal, files: changed)))
            }
            // A recomputed outer seal cannot conceal a database that violates its inner manifest.
            changed = original.files
            changed["OM0RX-xLog.sqlite"]!.append(0)
            #expect(throws: Error.self) {
                try manager.validateRestoreEnvelope(BackupPackageSeal.encode(BackupPackageSeal.Payload(seal: BackupPackageSeal.make(changed), files: changed)))
            }
            #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("escaped").path))
        }
    }

    @Test func restoresOnlyValidatedReferenceBytes() throws {
        try fixture { root, package, manager in
            let live = root.appendingPathComponent("live-reference")
            try FileManager.default.createDirectory(at: live, withIntermediateDirectories: true)
            try Data("old".utf8).write(to: live.appendingPathComponent("old"))
            let rollback = try #require(try manager.installReferenceData(from: package, to: live))
            #expect(try Data(contentsOf: live.appendingPathComponent("nested.json")) == Data("reference".utf8))
            #expect(FileManager.default.fileExists(atPath: rollback.appendingPathComponent("old").path))
            try Data("corrupt".utf8).write(to: package.appendingPathComponent("Reference Data/nested.json"))
            #expect(throws: Error.self) { try manager.installReferenceData(from: package, to: live) }
            #expect(try Data(contentsOf: live.appendingPathComponent("nested.json")) == Data("reference".utf8))
        }
    }

    @Test func legacyLocalDatabaseCompatibleButFullPackageOperationsFailExplicitly() throws {
        try fixture { root, package, manager in
            let manifestURL = package.appendingPathComponent("manifest.json")
            var json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
            json["formatVersion"] = 1
            try JSONSerialization.data(withJSONObject: json).write(to: manifestURL)
            try FileManager.default.removeItem(at: package.appendingPathComponent(BackupPackageSeal.filename))
            #expect(try manager.inspect(at: package).manifest.formatVersion == 1)
            let live = root.appendingPathComponent("restored.sqlite")
            let interrupted = XLogBackupManager(fileManager: ChangedStagingFileManager())
            #expect(throws: Error.self) { try interrupted.installDatabase(from: package, to: live) }
            #expect(!FileManager.default.fileExists(atPath: live.path))
            _ = try manager.installDatabase(from: package, to: live)
            let restored = try LogbookDatabase(url: live)
            defer { restored.close() }
            #expect(try restored.fetch().first?.call == "OM0RX")
            #expect(throws: Error.self) { try manager.prepareEnvelope(at: package) }
            #expect(throws: Error.self) { try manager.installReferenceData(from: package, to: root.appendingPathComponent("live-refs")) }
        }
    }
}

private final class ChangedStagingFileManager: FileManager, @unchecked Sendable {
    override func copyItem(at srcURL: URL, to dstURL: URL) throws {
        try super.copyItem(at: srcURL, to: dstURL)
        if dstURL.lastPathComponent.hasPrefix(".restore-") {
            let handle = try FileHandle(forWritingTo: dstURL)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data([0]))
        }
    }
}
