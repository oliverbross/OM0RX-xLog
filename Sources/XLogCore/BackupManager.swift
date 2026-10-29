import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

public enum XLogBackupError: Error, LocalizedError {
    case destinationExists
    case invalidPackage(String)
    case checksumMismatch
    case integrityFailed(String)
    case restoreFailed(String)
    case rollbackFailed
    case settingsMissing
    case syncDestinationChange
    case packageChanged

    public var errorDescription: String? {
        switch self {
        case .destinationExists:
            return "A backup already exists at that location. Choose a new name."
        case let .invalidPackage(message):
            return "This is not a valid xLog backup: \(message)"
        case .checksumMismatch:
            return "The backup database checksum does not match its manifest."
        case let .integrityFailed(message):
            return "The backup database failed SQLite verification: \(message)"
        case let .restoreFailed(message):
            return "The xLog database could not be restored: \(message)"
        case .rollbackFailed:
            return "Restore failed and an original component could not be put back. Recover the pre-restore backup before continuing."
        case .settingsMissing:
            return "Restoring requires backup settings so its Wavelog destination can be verified."
        case .syncDestinationChange:
            return "The backup belongs to a different Wavelog destination. Restore its settings or use a reviewed migration."
        case .packageChanged:
            return "The selected backup changed after inspection. Inspect it again before restoring."
        }
    }
}

public struct XLogSavedLogbookFilter: Codable, Equatable, Sendable {
    public var name: String
    public var query: String

    public init(name: String, query: String) {
        self.name = name
        self.query = query
    }
}

public struct XLogBackupPreferences: Codable, Equatable, Sendable {
    public var deskBandMapBands: [String]
    public var detachedBandMapBands: [String]
    public var deskBandMapFollowsRadio: Bool
    public var detachedBandMapLayout: String
    public var bandMapFontScale: Double
    public var intelligenceBands: [String]
    public var clusterSpotOpensFullEditor: Bool
    public var detachedBandMapFollowsRadio: Bool
    public var detachedBandMapModes: [String]
    public var savedLogbookFilters: [XLogSavedLogbookFilter]

    public init(
        deskBandMapBands: [String],
        detachedBandMapBands: [String],
        deskBandMapFollowsRadio: Bool,
        detachedBandMapLayout: String,
        bandMapFontScale: Double,
        intelligenceBands: [String],
        clusterSpotOpensFullEditor: Bool,
        detachedBandMapFollowsRadio: Bool = false,
        detachedBandMapModes: [String] = ["cw", "data", "phone"],
        savedLogbookFilters: [XLogSavedLogbookFilter] = []
    ) {
        self.deskBandMapBands = deskBandMapBands
        self.detachedBandMapBands = detachedBandMapBands
        self.deskBandMapFollowsRadio = deskBandMapFollowsRadio
        self.detachedBandMapLayout = detachedBandMapLayout
        self.bandMapFontScale = bandMapFontScale
        self.intelligenceBands = intelligenceBands
        self.clusterSpotOpensFullEditor = clusterSpotOpensFullEditor
        self.detachedBandMapFollowsRadio = detachedBandMapFollowsRadio
        self.detachedBandMapModes = detachedBandMapModes
        self.savedLogbookFilters = savedLogbookFilters
    }

    private enum CodingKeys: String, CodingKey {
        case deskBandMapBands, detachedBandMapBands, deskBandMapFollowsRadio,
             detachedBandMapLayout, bandMapFontScale, intelligenceBands,
             clusterSpotOpensFullEditor, detachedBandMapFollowsRadio, detachedBandMapModes,
             savedLogbookFilters
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        deskBandMapBands = try values.decode([String].self, forKey: .deskBandMapBands)
        detachedBandMapBands = try values.decode([String].self, forKey: .detachedBandMapBands)
        deskBandMapFollowsRadio = try values.decode(Bool.self, forKey: .deskBandMapFollowsRadio)
        detachedBandMapLayout = try values.decode(String.self, forKey: .detachedBandMapLayout)
        bandMapFontScale = try values.decode(Double.self, forKey: .bandMapFontScale)
        intelligenceBands = try values.decode([String].self, forKey: .intelligenceBands)
        clusterSpotOpensFullEditor = try values.decode(Bool.self, forKey: .clusterSpotOpensFullEditor)
        detachedBandMapFollowsRadio = try values.decodeIfPresent(Bool.self, forKey: .detachedBandMapFollowsRadio) ?? false
        detachedBandMapModes = try values.decodeIfPresent([String].self, forKey: .detachedBandMapModes) ?? ["cw", "data", "phone"]
        savedLogbookFilters = try values.decodeIfPresent([XLogSavedLogbookFilter].self, forKey: .savedLogbookFilters) ?? []
    }
}

public struct XLogBackupManifest: Codable, Equatable, Sendable {
    public static let currentFormatVersion = 3

    public var formatVersion: Int
    public var createdAt: Date
    public var qsoCount: Int
    public var pendingSyncCount: Int
    public var lastQSOAt: Date?
    public var databaseBytes: Int64
    public var databaseSHA256: String
    public var includesSettings: Bool
    public var includesPreferences: Bool
    public var includesReferenceData: Bool
    public var includesContestingData: Bool?
    public var contestDatabaseCount: Int?
}

public struct XLogBackupPreview: Equatable, Sendable {
    public var packageURL: URL
    public var manifest: XLogBackupManifest
    public var settings: XLogSettings?
    public var preferences: XLogBackupPreferences?

    public init(
        packageURL: URL,
        manifest: XLogBackupManifest,
        settings: XLogSettings?,
        preferences: XLogBackupPreferences?
    ) {
        self.packageURL = packageURL
        self.manifest = manifest
        self.settings = settings
        self.preferences = preferences
    }

    /// Linked remote IDs belong to the backup's destination. Keeping another
    /// destination would let its history replace or delete those restored rows.
    /// A restore never carries automatic-sync consent into the replaced log.
    public func settingsForRestore(keeping current: XLogSettings,
                                   restoreSettings: Bool) throws -> XLogSettings {
        guard let settings else { throw XLogBackupError.settingsMissing }
        if !restoreSettings,
           settings.wavelogURL != current.wavelogURL || settings.wavelogStationID != current.wavelogStationID {
            throw XLogBackupError.syncDestinationChange
        }
        return IntegrationWorkspace.safeSettings(from: restoreSettings ? settings : current)
    }
}

public final class XLogBackupManager: @unchecked Sendable {
    public static let packageExtension = "xlogbackup"

    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    @discardableResult
    public func create(
        database: LogbookDatabase,
        at packageURL: URL,
        settings: XLogSettings,
        preferences: XLogBackupPreferences,
        referenceDataURL: URL? = nil,
        contestingDataURL: URL? = nil
    ) throws -> XLogBackupPreview {
        guard !fileManager.fileExists(atPath: packageURL.path) else {
            throw XLogBackupError.destinationExists
        }
        let parent = packageURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let temporary = parent.appendingPathComponent(".xlogbackup-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: temporary, withIntermediateDirectories: true,
                                        attributes: LocalFilePermissions.directoryAttributes)
        var committed = false
        defer { if !committed { try? fileManager.removeItem(at: temporary) } }

        let databaseURL = temporary.appendingPathComponent("OM0RX-xLog.sqlite")
        try database.backup(to: databaseURL)
        try removeSQLiteSidecars(for: databaseURL)
        let inspection = try inspectDatabase(at: databaseURL)
        let attributes = try fileManager.attributesOfItem(atPath: databaseURL.path)
        let bytes = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        let referenceDestination = temporary.appendingPathComponent("Reference Data", isDirectory: true)
        var includesReferenceData = false
        if let referenceDataURL, fileManager.fileExists(atPath: referenceDataURL.path) {
            try fileManager.copyItem(at: referenceDataURL, to: referenceDestination)
            includesReferenceData = true
        }
        var contestDatabaseCount = 0
        if let contestingDataURL, fileManager.fileExists(atPath: contestingDataURL.path) {
            let destinationRoot = temporary.appendingPathComponent("Contesting/Python", isDirectory: true)
            let resolvedRoot = contestingDataURL.resolvingSymlinksInPath().standardizedFileURL
            let rootComponents = resolvedRoot.pathComponents
            let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey]
            guard let enumerator = fileManager.enumerator(at: contestingDataURL, includingPropertiesForKeys: keys,
                                                          options: [.skipsHiddenFiles]) else {
                throw XLogBackupError.invalidPackage("contest data could not be inspected")
            }
            for case let source as URL in enumerator where source.pathExtension.lowercased() == "sqlite" {
                let values = try source.resourceValues(forKeys: Set(keys))
                guard values.isRegularFile == true, values.isSymbolicLink != true else {
                    throw XLogBackupError.invalidPackage("contest database path is unsafe")
                }
                let resolvedSource = source.resolvingSymlinksInPath().standardizedFileURL
                let sourceComponents = resolvedSource.pathComponents
                guard sourceComponents.starts(with: rootComponents) else {
                    throw XLogBackupError.invalidPackage("contest database path is unsafe")
                }
                let relativeComponents = sourceComponents.dropFirst(rootComponents.count)
                guard !relativeComponents.isEmpty,
                      relativeComponents.allSatisfy({ $0 != "." && $0 != ".." }) else {
                    throw XLogBackupError.invalidPackage("contest database path is unsafe")
                }
                let relative = relativeComponents.joined(separator: "/")
                let destination = destinationRoot.appendingPathComponent(relative)
                try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: LocalFilePermissions.directoryAttributes)
                try snapshotSQLite(from: source, to: destination)
                contestDatabaseCount += 1
            }
        }
        try encoder.encode(settings).write(
            to: temporary.appendingPathComponent("settings.json"),
            options: .atomic
        )
        try encoder.encode(preferences).write(
            to: temporary.appendingPathComponent("preferences.json"),
            options: .atomic
        )
        let manifest = XLogBackupManifest(
            formatVersion: XLogBackupManifest.currentFormatVersion,
            createdAt: Date(),
            qsoCount: inspection.qsoCount,
            pendingSyncCount: inspection.pendingSyncCount,
            lastQSOAt: inspection.lastQSOAt,
            databaseBytes: bytes,
            databaseSHA256: try sha256(of: databaseURL),
            includesSettings: true,
            includesPreferences: true,
            includesReferenceData: includesReferenceData,
            includesContestingData: contestingDataURL.map { fileManager.fileExists(atPath: $0.path) } ?? false,
            contestDatabaseCount: contestDatabaseCount
        )
        try encoder.encode(manifest).write(
            to: temporary.appendingPathComponent("manifest.json"),
            options: .atomic
        )
        let payload = try BackupPackageSeal.capture(temporary, fileManager: fileManager)
        try BackupPackageSeal.encode(BackupPackageSeal.make(payload)).write(
            to: temporary.appendingPathComponent(BackupPackageSeal.filename), options: .atomic)
        _ = try inspect(at: temporary)
        try fileManager.moveItem(at: temporary, to: packageURL)
        committed = true
        return try inspect(at: packageURL)
    }

    public func inspect(at packageURL: URL) throws -> XLogBackupPreview {
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: packageURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw XLogBackupError.invalidPackage("the selected item is not a backup package")
        }
        let manifestURL = packageURL.appendingPathComponent("manifest.json")
        let databaseURL = packageURL.appendingPathComponent("OM0RX-xLog.sqlite")
        guard let manifestData = fileManager.contents(atPath: manifestURL.path) else {
            throw XLogBackupError.invalidPackage("manifest.json is missing")
        }
        let manifest = try decoder.decode(XLogBackupManifest.self, from: manifestData)
        guard (1...XLogBackupManifest.currentFormatVersion).contains(manifest.formatVersion) else {
            throw XLogBackupError.invalidPackage("unsupported format version \(manifest.formatVersion)")
        }
        if manifest.formatVersion >= 2 || fileManager.fileExists(atPath: packageURL.appendingPathComponent(BackupPackageSeal.filename).path) {
            _ = try BackupPackageSeal.verifiedFiles(packageURL, fileManager: fileManager)
        }
        guard fileManager.fileExists(atPath: databaseURL.path) else {
            throw XLogBackupError.invalidPackage("OM0RX-xLog.sqlite is missing")
        }
        guard try sha256(of: databaseURL) == manifest.databaseSHA256 else {
            throw XLogBackupError.checksumMismatch
        }
        let inspection = try inspectDatabase(at: databaseURL)
        guard inspection.qsoCount == manifest.qsoCount,
              inspection.pendingSyncCount == manifest.pendingSyncCount else {
            throw XLogBackupError.invalidPackage("database counts do not match the manifest")
        }
        let contestFiles = try contestDatabaseURLs(
            in: packageURL.appendingPathComponent("Contesting/Python", isDirectory: true)
        )
        guard (manifest.includesContestingData == true || contestFiles.isEmpty),
              manifest.contestDatabaseCount ?? 0 == contestFiles.count else {
            throw XLogBackupError.invalidPackage("contest database count does not match the manifest")
        }
        for url in contestFiles { try inspectSQLite(at: url) }

        let settings = try decodeIfPresent(XLogSettings.self, at: packageURL.appendingPathComponent("settings.json"))
        let preferences = try decodeIfPresent(XLogBackupPreferences.self, at: packageURL.appendingPathComponent("preferences.json"))
        return XLogBackupPreview(
            packageURL: packageURL,
            manifest: manifest,
            settings: settings,
            preferences: preferences
        )
    }

    public func installDatabase(from packageURL: URL, to liveURL: URL,
                                expectedPreview: XLogBackupPreview? = nil) throws -> URL? {
        let preview = try inspect(at: packageURL)
        // Callers that select destination/settings from a preview must install
        // that same database. Staging below rechecks this manifest's byte hash.
        if let expectedPreview, preview != expectedPreview { throw XLogBackupError.packageChanged }
        let directory = liveURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let staging = directory.appendingPathComponent(".restore-\(UUID().uuidString).sqlite")
        let source = directory.appendingPathComponent(".restore-source-\(UUID().uuidString).sqlite")
        defer {
            for suffix in ["", "-wal", "-shm"] {
                try? fileManager.removeItem(at: URL(fileURLWithPath: source.path + suffix))
            }
        }
        do {
            if preview.manifest.formatVersion >= 2 {
                let (_, files) = try BackupPackageSeal.verifiedFiles(packageURL, fileManager: fileManager)
                try files["OM0RX-xLog.sqlite"]!.write(to: source, options: .atomic)
            } else {
                try fileManager.copyItem(at: packageURL.appendingPathComponent("OM0RX-xLog.sqlite"), to: source)
            }
            // Verify the bytes actually staged, not the source path checked earlier.
            guard try sha256(of: source) == preview.manifest.databaseSHA256 else {
                throw XLogBackupError.checksumMismatch
            }
            _ = try inspectDatabase(at: source)
            let restored = try LogbookDatabase(url: source)
            defer { restored.close() }
            // Retire restored consent before publication, including crashes or
            // errors in later preference/reference installation. A standalone
            // SQLite backup includes the transaction without relying on WAL moves.
            try restored.disableOnlineLogDeliveryAfterRestore()
            try restored.backup(to: staging)
            _ = try inspectDatabase(at: staging)
        } catch {
            try? fileManager.removeItem(at: staging)
            throw error
        }

        let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let rollback = directory.appendingPathComponent("OM0RX-xLog-before-restore-\(timestamp)-\(UUID().uuidString).sqlite")
        var preservedURL: URL?
        do {
            for suffix in ["-wal", "-shm"] {
                let sidecar = URL(fileURLWithPath: liveURL.path + suffix)
                if fileManager.fileExists(atPath: sidecar.path) { try fileManager.removeItem(at: sidecar) }
            }
            if fileManager.fileExists(atPath: liveURL.path) {
                try fileManager.moveItem(at: liveURL, to: rollback)
                preservedURL = rollback
            }
            try fileManager.moveItem(at: staging, to: liveURL)
            return preservedURL
        } catch {
            try? fileManager.removeItem(at: staging)
            if let preservedURL,
               !fileManager.fileExists(atPath: liveURL.path),
               fileManager.fileExists(atPath: preservedURL.path) {
                do { try fileManager.moveItem(at: preservedURL, to: liveURL) }
                catch { throw XLogBackupError.rollbackFailed }
            }
            throw XLogBackupError.restoreFailed(error.localizedDescription)
        }
    }

    public func referenceDataURL(in packageURL: URL) -> URL? {
        let url = packageURL.appendingPathComponent("Reference Data", isDirectory: true)
        return fileManager.fileExists(atPath: url.path) ? url : nil
    }

    @discardableResult
    public func installContestingData(from packageURL: URL, to liveURL: URL) throws -> URL? {
        let preview = try inspect(at: packageURL)
        guard preview.manifest.includesContestingData == true else { return nil }
        let (_, files) = try BackupPackageSeal.verifiedFiles(packageURL, fileManager: fileManager)
        let contestFiles = Dictionary(uniqueKeysWithValues: files.compactMap { path, data in
            path.hasPrefix("Contesting/Python/") ? (String(path.dropFirst("Contesting/Python/".count)), data) : nil
        })
        let parent = liveURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".contest-restore-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: staging) }
        try BackupPackageSeal.materialize(contestFiles, at: staging, fileManager: fileManager)
        for url in try contestDatabaseURLs(in: staging) { try inspectSQLite(at: url) }
        let rollback = parent.appendingPathComponent("Python-before-restore-\(UUID().uuidString)", isDirectory: true)
        var preserved: URL?
        do {
            if fileManager.fileExists(atPath: liveURL.path) { try fileManager.moveItem(at: liveURL, to: rollback); preserved = rollback }
            try fileManager.moveItem(at: staging, to: liveURL)
            return preserved
        } catch {
            if !fileManager.fileExists(atPath: liveURL.path), let preserved {
                do { try fileManager.moveItem(at: preserved, to: liveURL) }
                catch { throw XLogBackupError.rollbackFailed }
            }
            throw XLogBackupError.restoreFailed("Contesting/Python: \(error.localizedDescription)")
        }
    }

    /// Validate every reference-data byte before a restore replaces the live
    /// database, preventing a legacy or damaged package from being half-restored.
    public func preflightReferenceDataInstallation(from packageURL: URL) throws {
        let preview = try inspect(at: packageURL)
        guard preview.manifest.includesReferenceData else { return }
        _ = try prepareEnvelope(at: packageURL)
    }

    @discardableResult
    public func installReferenceData(from packageURL: URL, to liveURL: URL) throws -> URL? {
        try preflightReferenceDataInstallation(from: packageURL)
        let envelope = try prepareEnvelope(at: packageURL)
        let files = try decoder.decode(BackupPackageSeal.Payload.self, from: envelope.data).files
        let manifest = try decoder.decode(XLogBackupManifest.self, from: files["manifest.json"]!)
        guard manifest.includesReferenceData else { return nil }
        let parent = liveURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".reference-restore-\(UUID().uuidString)", isDirectory: true)
        let referenceFiles = Dictionary(uniqueKeysWithValues: files.compactMap { path, data in
            path.hasPrefix("Reference Data/") ? (String(path.dropFirst("Reference Data/".count)), data) : nil
        })
        do {
            try BackupPackageSeal.materialize(referenceFiles, at: staging, fileManager: fileManager)
        } catch {
            try? fileManager.removeItem(at: staging)
            throw error
        }
        let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let rollback = parent.appendingPathComponent("Reference Data-before-restore-\(timestamp)-\(UUID().uuidString)", isDirectory: true)
        do {
            var preservedURL: URL?
            if fileManager.fileExists(atPath: liveURL.path) {
                try fileManager.moveItem(at: liveURL, to: rollback)
                preservedURL = rollback
            }
            try fileManager.moveItem(at: staging, to: liveURL)
            return preservedURL
        } catch {
            try? fileManager.removeItem(at: staging)
            if !fileManager.fileExists(atPath: liveURL.path),
               fileManager.fileExists(atPath: rollback.path) {
                do { try fileManager.moveItem(at: rollback, to: liveURL) }
                catch { throw XLogBackupError.rollbackFailed }
            }
            throw XLogBackupError.restoreFailed("Reference Data: \(error.localizedDescription)")
        }
    }

    /// Captures and re-verifies every file, then validates SQLite and settings from
    /// the captured bytes. Executors must consume the returned Data, never reopen URLs.
    public func prepareEnvelope(at packageURL: URL) throws -> XLogBackupEnvelope {
        try prepareEnvelope(at: packageURL, validationStagingDirectory: nil)
    }

    internal func prepareEnvelope(at packageURL: URL, validationStagingDirectory: URL?) throws -> XLogBackupEnvelope {
        let (seal, files) = try BackupPackageSeal.verifiedFiles(packageURL, fileManager: fileManager)
        let data = try BackupPackageSeal.encode(BackupPackageSeal.Payload(seal: seal, files: files))
        return try validateRestoreEnvelope(data, stagingDirectory: validationStagingDirectory)
    }

    /// Validates an untrusted envelope without touching the live database or settings.
    /// The caller must compare its identity with an independently trusted receipt.
    public func validateRestoreEnvelope(_ data: Data) throws -> XLogBackupEnvelope {
        try validateRestoreEnvelope(data, stagingDirectory: nil)
    }

    /// Materializes a previously validated remote envelope as a normal local
    /// `.xlogbackup` package. The exact independently trusted identity must match;
    /// an existing package is accepted only when it contains those same bytes.
    /// This never installs the database or changes live settings.
    @discardableResult
    public func materializeRestoreEnvelope(_ data: Data, expectedIdentity: RemoteBackupPackageIdentity,
                                           at packageURL: URL) throws -> XLogBackupPreview {
        let envelope = try validateRestoreEnvelope(data)
        guard envelope.identity == expectedIdentity,
              packageURL.isFileURL,
              packageURL.pathExtension.lowercased() == Self.packageExtension else {
            throw XLogBackupError.invalidPackage("remote package identity or destination is invalid")
        }
        if fileManager.fileExists(atPath: packageURL.path) {
            let existing = try prepareEnvelope(at: packageURL)
            guard existing.identity == expectedIdentity else { throw XLogBackupError.destinationExists }
            return try inspect(at: packageURL)
        }
        let parent = packageURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true,
                                        attributes: LocalFilePermissions.directoryAttributes)
        let staging = parent.appendingPathComponent(".remote-restore-\(UUID().uuidString)", isDirectory: true)
        var committed = false
        defer { if !committed { try? fileManager.removeItem(at: staging) } }
        let payload = try decoder.decode(BackupPackageSeal.Payload.self, from: data)
        try BackupPackageSeal.materialize(payload.files, at: staging, fileManager: fileManager)
        try BackupPackageSeal.encode(payload.seal).write(
            to: staging.appendingPathComponent(BackupPackageSeal.filename), options: .atomic)
        let staged = try prepareEnvelope(at: staging)
        guard staged.identity == expectedIdentity else { throw XLogBackupError.checksumMismatch }
        do { try fileManager.moveItem(at: staging, to: packageURL) }
        catch {
            if fileManager.fileExists(atPath: packageURL.path),
               let existing = try? prepareEnvelope(at: packageURL), existing.identity == expectedIdentity {
                committed = true
                return try inspect(at: packageURL)
            }
            throw XLogBackupError.restoreFailed(error.localizedDescription)
        }
        committed = true
        return try inspect(at: packageURL)
    }

    private func validateRestoreEnvelope(_ data: Data, stagingDirectory: URL?) throws -> XLogBackupEnvelope {
        // Base64 JSON expands content; bound input as well as decoded payload.
        guard data.count <= BackupPackageSeal.maximumBytes * 2 else {
            throw XLogBackupError.invalidPackage("envelope exceeds staging limit")
        }
        let payload = try decoder.decode(BackupPackageSeal.Payload.self, from: data)
        guard payload.files.values.reduce(Int64(0), { $0 + Int64($1.count) }) <= Int64(BackupPackageSeal.maximumBytes) else {
            throw XLogBackupError.invalidPackage("envelope exceeds staging limit")
        }
        try payload.seal.validate(payload.files)
        let root = (stagingDirectory ?? fileManager.temporaryDirectory).appendingPathComponent("xlog-envelope-\(UUID().uuidString)")
        defer { try? fileManager.removeItem(at: root) }
        try BackupPackageSeal.materialize(payload.files, at: root, fileManager: fileManager)
        try BackupPackageSeal.encode(payload.seal).write(to: root.appendingPathComponent(BackupPackageSeal.filename))
        let preview = try inspect(at: root)
        guard preview.manifest.includesSettings == (payload.files["settings.json"] != nil),
              preview.manifest.includesPreferences == (payload.files["preferences.json"] != nil),
              payload.files["Reference Data"] == nil,
              preview.manifest.databaseBytes == Int64(payload.files["OM0RX-xLog.sqlite"]!.count),
              preview.manifest.includesReferenceData || !payload.files.keys.contains(where: { $0.hasPrefix("Reference Data/") }) else {
            throw XLogBackupError.invalidPackage("payload presence or database size differs from manifest")
        }
        return try XLogBackupEnvelope(data: data, preview: preview)
    }

    private func decodeIfPresent<T: Decodable>(_ type: T.Type, at url: URL) throws -> T? {
        guard let data = fileManager.contents(atPath: url.path) else { return nil }
        return try decoder.decode(type, from: data)
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func contestDatabaseURLs(in contestRoot: URL) throws -> [URL] {
        guard fileManager.fileExists(atPath: contestRoot.path) else { return [] }
        guard let enumerator = fileManager.enumerator(at: contestRoot, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
                                                      options: [.skipsHiddenFiles]) else { return [] }
        return try enumerator.compactMap { candidate -> URL? in
            guard let url = candidate as? URL, url.pathExtension.lowercased() == "sqlite" else { return nil }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else {
                throw XLogBackupError.invalidPackage("contest database path is unsafe")
            }
            return url
        }
    }

    private func snapshotSQLite(from source: URL, to destination: URL) throws {
        do {
            var input: OpaquePointer?, output: OpaquePointer?
            guard sqlite3_open_v2(source.path, &input, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
                  let input else {
                let message = input.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
                sqlite3_close(input)
                throw XLogBackupError.integrityFailed("could not open contest database: \(message)")
            }
            defer { sqlite3_close(input) }
            guard sqlite3_open_v2(destination.path, &output, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
                  let output else {
                let message = output.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
                sqlite3_close(output)
                throw XLogBackupError.integrityFailed("could not stage contest database: \(message)")
            }
            defer { sqlite3_close(output) }
            guard let backup = sqlite3_backup_init(output, "main", input, "main") else {
                throw XLogBackupError.integrityFailed("could not initialize contest snapshot: \(String(cString: sqlite3_errmsg(output)))")
            }
            let result = sqlite3_backup_step(backup, -1)
            let finish = sqlite3_backup_finish(backup)
            guard result == SQLITE_DONE, finish == SQLITE_OK else {
                throw XLogBackupError.integrityFailed("could not finish contest snapshot: \(String(cString: sqlite3_errmsg(output)))")
            }
            guard sqlite3_exec(output, "PRAGMA journal_mode=DELETE;", nil, nil, nil) == SQLITE_OK else {
                throw XLogBackupError.integrityFailed("could not seal contest snapshot: \(String(cString: sqlite3_errmsg(output)))")
            }
        }
        try removeSQLiteSidecars(for: destination)
        try inspectSQLite(at: destination)
    }

    private func removeSQLiteSidecars(for databaseURL: URL) throws {
        for suffix in ["-wal", "-shm"] {
            let sidecar = URL(fileURLWithPath: databaseURL.path + suffix)
            if fileManager.fileExists(atPath: sidecar.path) {
                try fileManager.removeItem(at: sidecar)
            }
        }
    }

    private func inspectSQLite(at url: URL) throws {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let handle else {
            sqlite3_close(handle); throw XLogBackupError.integrityFailed("could not open contest database")
        }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "PRAGMA integrity_check;", -1, &statement, nil) == SQLITE_OK else {
            throw XLogBackupError.integrityFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW,
              sqlite3_column_text(statement, 0).map({ String(cString: $0) }) == "ok" else {
            throw XLogBackupError.integrityFailed("contest integrity_check did not return ok")
        }
    }

    private func inspectDatabase(at url: URL) throws -> DatabaseInspection {
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK, let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "could not open database"
            sqlite3_close(handle)
            throw XLogBackupError.integrityFailed(message)
        }
        defer { sqlite3_close(handle) }

        var integrity: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "PRAGMA integrity_check;", -1, &integrity, nil) == SQLITE_OK else {
            throw XLogBackupError.integrityFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(integrity) }
        guard sqlite3_step(integrity) == SQLITE_ROW,
              sqlite3_column_text(integrity, 0).map({ String(cString: $0) }) == "ok" else {
            throw XLogBackupError.integrityFailed("integrity_check did not return ok")
        }

        var statement: OpaquePointer?
        let sql = "SELECT COUNT(*), SUM(CASE WHEN is_dirty = 1 THEN 1 ELSE 0 END), MAX(qso_start) FROM qsos WHERE deleted_at IS NULL;"
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else {
            throw XLogBackupError.integrityFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else {
            throw XLogBackupError.integrityFailed("QSO summary could not be read")
        }
        let qsoCount = Int(sqlite3_column_int64(statement, 0))
        let pending = Int(sqlite3_column_int64(statement, 1))
        let lastQSOAt = sqlite3_column_type(statement, 2) == SQLITE_NULL
            ? nil
            : Date(timeIntervalSince1970: sqlite3_column_double(statement, 2))
        return DatabaseInspection(qsoCount: qsoCount, pendingSyncCount: pending, lastQSOAt: lastQSOAt)
    }
}

private struct DatabaseInspection {
    var qsoCount: Int
    var pendingSyncCount: Int
    var lastQSOAt: Date?
}
