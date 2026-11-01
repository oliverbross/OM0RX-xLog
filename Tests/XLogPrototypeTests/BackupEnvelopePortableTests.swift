import Foundation
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct BackupEnvelopePortableTests {
    #if os(Windows)
    @Test(arguments: [249, 259, 260])
    func nativeWindowsDirectoryBoundariesPreserveUnicodeBytesAndRejectFileCollisions(units: Int) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        func nativeUnits(_ url: URL) -> Int {
            url.withUnsafeFileSystemRepresentation { $0.map { String(cString: $0).utf16.count } ?? 0 }
        }
        func directory(_ prefix: String) throws -> URL {
            let base = root.appendingPathComponent(prefix)
            let padding = units - nativeUnits(base)
            try #require(padding >= 0)
            let url = root.appendingPathComponent(prefix + String(repeating: "x", count: padding))
            #expect(nativeUnits(url) == units)
            return url
        }
        let materialized = try directory("sealed-é秘-")
        let bytes = Data("{\"fixture\":\"é秘\"}".utf8)
        let files = ["nested/é秘.json": bytes]
        try BackupPackageSeal.materialize(files, at: materialized, fileManager: .default)
        #expect(try BackupPackageSeal.capture(materialized, fileManager: .default) == files)
        do {
            try LocalFilePermissions.createDirectoryWithoutParents(at: materialized, fileManager: .default)
            Issue.record("Exclusive directory creation accepted an existing directory")
        } catch {
            #expect((error as NSError).code == CocoaError.fileWriteFileExists.rawValue)
            #expect((error as NSError).userInfo[NSUnderlyingErrorKey] as? NSError != nil)
        }
        let parent = try directory("parents-é秘-")
        let leaf = parent.appendingPathComponent("leaf")
        try LocalFilePermissions.createDirectoryWithParents(at: leaf, fileManager: .default)
        try LocalFilePermissions.createDirectoryWithParents(at: leaf, fileManager: .default)
        var isDirectory: ObjCBool = false
        #expect(FileManager.default.fileExists(atPath: leaf.path, isDirectory: &isDirectory) && isDirectory.boolValue)
        let collision = try directory("file-é秘-")
        try bytes.write(to: collision)
        #expect(throws: CocoaError.self) {
            try LocalFilePermissions.createDirectoryWithParents(at: collision.appendingPathComponent("blocked"), fileManager: .default)
        }
        #expect(try Data(contentsOf: collision) == bytes)
    }
    #endif

    @Test func captureRejectsCanonicallyEquivalentNamesBeforeDictionaryInsertion() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let firstName = "\u{e9}.json", secondName = "e\u{301}.json"
        #expect(firstName == secondName)
        #expect(Array(firstName.utf8) != Array(secondName.utf8))
        let first = root.appendingPathComponent(firstName), second = root.appendingPathComponent(secondName)
        try Data("first".utf8).write(to: first)
        try Data("second".utf8).write(to: second)
        let originalFirst = try Data(contentsOf: first), originalSecond = try Data(contentsOf: second)
        #if os(macOS)
        // A normalizing filesystem may expose only one spelling. Supply both
        // directory entries while retaining real metadata and FileHandle reads.
        let manager = CanonicalDuplicateDirectoryFileManager()
        manager.entries = [first, second]
        #else
        // The URL-listing API is not open in corelibs Foundation. Exercise the
        // native fixture filesystem and prove it exposes both UTF-8 spellings.
        let manager = FileManager.default
        let names = try manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .map { Array($0.lastPathComponent.utf8) }
        #expect(names.count == 2)
        #expect(names.contains(Array(firstName.utf8)))
        #expect(names.contains(Array(secondName.utf8)))
        #endif
        #expect(throws: XLogBackupError.self) { try BackupPackageSeal.capture(root, fileManager: manager) }
        #expect(try Data(contentsOf: first) == originalFirst)
        #expect(try Data(contentsOf: second) == originalSecond)
    }

    @Test func materializationRejectsCanonicalFilenameCollisionsBeforeCreatingItsRoot() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let collisions: [[String: Data]] = [
            ["A.json": Data([1]), "a.json": Data([2])],
            ["É.json": Data([1]), "e\u{301}.json": Data([2])],
        ]
        for (index, files) in collisions.enumerated() {
            let destination = root.appendingPathComponent("rejected-\(index)")
            #expect(throws: XLogBackupError.self) {
                try BackupPackageSeal.materialize(files, at: destination, fileManager: .default)
            }
            #expect(!FileManager.default.fileExists(atPath: destination.path))
        }
    }

    @Test func directoryParentsUseNonrecursiveCreationAndRejectFileCollisions() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let manager = DirectoryCreationFileManager()
        let destination = root.appendingPathComponent("existing/new/leaf")
        try LocalFilePermissions.createDirectoriesIndividually(at: destination, fileManager: manager)
        #expect(manager.recursiveRequests == [false, false, false])
        try LocalFilePermissions.createDirectoriesIndividually(at: destination, fileManager: manager)
        #expect(manager.recursiveRequests.count == 3)
        let file = root.appendingPathComponent("regular-file")
        try Data("keep".utf8).write(to: file)
        #expect(throws: CocoaError.self) {
            try LocalFilePermissions.createDirectoriesIndividually(at: file.appendingPathComponent("child"), fileManager: manager)
        }
        #expect(try Data(contentsOf: file) == Data("keep".utf8))
    }

    @Test func directoryParentFailureAndMissingReaderErrorsArePropagated() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let manager = DirectoryCreationFileManager()
        manager.failureAtName = "blocked"
        let destination = root.appendingPathComponent("allowed/blocked/never-created")
        do {
            try LocalFilePermissions.createDirectoriesIndividually(at: destination, fileManager: manager)
            Issue.record("Directory creation swallowed the injected write error")
        } catch { #expect((error as NSError).code == CocoaError.fileWriteNoPermission.rawValue) }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
        let missing = root.appendingPathComponent("missing-file")
        var expected: NSError?
        do { let handle = try FileHandle(forReadingFrom: missing); try handle.close() }
        catch { expected = error as NSError }
        do {
            let handle = try BackupPackageSeal.openForReading(missing); try handle.close()
            Issue.record("Backup reader opened a nonexistent file")
        } catch {
            #expect((error as NSError).domain == expected?.domain)
            #expect((error as NSError).code == expected?.code)
        }
    }

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
            #expect(envelope.manifest.formatVersion == 3)
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

    @Test func verifiedRemoteEnvelopeMaterializesIdempotentlyWithoutInstalling() throws {
        try fixture { root, package, manager in
            let envelope = try manager.prepareEnvelope(at: package)
            let staged = root.appendingPathComponent("Remote-fixture.xlogbackup")
            let first = try manager.materializeRestoreEnvelope(envelope.data,
                expectedIdentity: envelope.identity, at: staged)
            #expect(first.manifest == envelope.manifest)
            #expect(try manager.prepareEnvelope(at: staged).identity == envelope.identity)
            #expect(try manager.materializeRestoreEnvelope(envelope.data,
                expectedIdentity: envelope.identity, at: staged).manifest == envelope.manifest)
            let wrong = try RemoteBackupPackageIdentity(sha256: String(repeating: "0", count: 64),
                byteCount: envelope.identity.byteCount)
            #expect(throws: XLogBackupError.self) {
                try manager.materializeRestoreEnvelope(envelope.data, expectedIdentity: wrong,
                    at: root.appendingPathComponent("wrong.xlogbackup"))
            }
            #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("wrong.xlogbackup").path))
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
            #expect(throws: Error.self) { try manager.preflightReferenceDataInstallation(from: package) }
            #expect(throws: Error.self) { try manager.installReferenceData(from: package, to: root.appendingPathComponent("live-refs")) }
        }
    }
}

#if os(macOS)
private final class CanonicalDuplicateDirectoryFileManager: FileManager, @unchecked Sendable {
    var entries: [URL] = []
    override func contentsOfDirectory(at url: URL, includingPropertiesForKeys keys: [URLResourceKey]?,
                                      options mask: FileManager.DirectoryEnumerationOptions = []) throws -> [URL] {
        entries
    }
}
#endif

private final class DirectoryCreationFileManager: FileManager, @unchecked Sendable {
    var recursiveRequests: [Bool] = []
    var failureAtName: String?
    override func createDirectory(at url: URL, withIntermediateDirectories createIntermediates: Bool,
                                  attributes: [FileAttributeKey: Any]? = nil) throws {
        recursiveRequests.append(createIntermediates)
        if url.lastPathComponent == failureAtName { throw CocoaError(.fileWriteNoPermission) }
        try super.createDirectory(at: url, withIntermediateDirectories: createIntermediates, attributes: attributes)
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
