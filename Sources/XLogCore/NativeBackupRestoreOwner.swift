import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

internal struct RestoredWavelogAuthority: Codable {
    let version: Int
    let url: String
    let stationID: Int

    init(settings: XLogSettings) {
        version = 1
        url = settings.wavelogURL
        stationID = settings.wavelogStationID
    }

    func matches(_ settings: XLogSettings) -> Bool {
        version == 1 && url == settings.wavelogURL && stationID == settings.wavelogStationID
    }

    func matches(_ configuration: WavelogConfiguration) -> Bool {
        guard version == 1, let baseURL = URL(string: url),
              let expected = try? WavelogConfiguration(baseURL: baseURL, token: configuration.token, stationID: stationID) else { return false }
        return expected.baseURL == configuration.baseURL && expected.stationID == configuration.stationID
    }
}

/// Shared with the modern workspace: any marker, including a retained legacy
/// marker, requires recovery. It is never interpreted as permission to sync.
public enum XLogRestoreRecoveryFence {
    private struct Journal: Encodable {
        let version = 1
        let authority: RestoredWavelogAuthority
        let packageSHA256: String
        let packageBytes: Int64
        let recoveryPackage: String
    }

    private static func marker(for databaseURL: URL) -> URL {
        databaseURL.deletingLastPathComponent().appendingPathComponent(".restore-incomplete")
    }

    public static func validate(databaseURL: URL, fileManager: FileManager = .default) throws {
        guard !fileManager.fileExists(atPath: marker(for: databaseURL).path) else {
            throw XLogBackupError.restoreRecoveryRequired
        }
    }

    internal static func begin(databaseURL: URL, envelope: XLogBackupRestoreEnvelope,
                               settings: XLogSettings, recoveryPackageURL: URL, fileManager: FileManager) throws {
        try validate(databaseURL: databaseURL, fileManager: fileManager)
        guard fileManager.fileExists(atPath: recoveryPackageURL.path) else {
            throw XLogBackupError.restoreFailed("The pre-restore recovery package is unavailable.")
        }
        let journal = Journal(authority: RestoredWavelogAuthority(settings: settings),
            packageSHA256: envelope.identity.sha256, packageBytes: envelope.identity.byteCount,
            recoveryPackage: recoveryPackageURL.path)
        let url = marker(for: databaseURL)
        try JSONEncoder().encode(journal).write(to: url, options: .atomic)
        try LocalFilePermissions.protectFile(url, fileManager: fileManager)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.synchronize()
        try synchronizeDirectory(url.deletingLastPathComponent())
    }

    internal static func complete(databaseURL: URL, fileManager: FileManager) throws {
        try fileManager.removeItem(at: marker(for: databaseURL))
        try synchronizeDirectory(databaseURL.deletingLastPathComponent())
    }

    private static func synchronizeDirectory(_ url: URL) throws {
        #if canImport(Darwin) || canImport(Glibc)
        let descriptor = open(url.path, O_RDONLY)
        guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { _ = close(descriptor) }
        guard fsync(descriptor) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        #endif
    }
}

/// The retained native application's restore sequence. The caller preserves the
/// recovery package and closes its live connection before handing over ownership.
public final class NativeBackupRestoreOwner {
    private let manager: XLogBackupManager
    private let settingsStore: SettingsStore
    private let fileManager: FileManager
    internal var afterDatabasePublication: @Sendable () throws -> Void = {}

    public init(settingsStore: SettingsStore, manager: XLogBackupManager = XLogBackupManager(),
                fileManager: FileManager = .default) {
        self.settingsStore = settingsStore
        self.manager = manager
        self.fileManager = fileManager
    }

    public static func openDatabase(at url: URL, settings: XLogSettings) throws -> LogbookDatabase {
        try XLogRestoreRecoveryFence.validate(databaseURL: url)
        let database = try LogbookDatabase(url: url)
        do {
            try database.validateRestoredWavelogAuthority(settings: settings)
            return database
        } catch { database.close(); throw error }
    }

    public static func validateSyncAdmission(database: LogbookDatabase, settings: XLogSettings) throws {
        try XLogRestoreRecoveryFence.validate(databaseURL: database.url)
        try database.validateRestoredWavelogAuthority(settings: settings)
    }

    public func restore(preview: XLogBackupPreview, to liveURL: URL,
                        keeping currentSettings: XLogSettings, settingsAfterRestore: XLogSettings,
                        recoveryPackageURL: URL, referenceDataURL: URL?) throws -> LogbookDatabase {
        let envelope = try manager.prepareRestoreEnvelope(at: preview.packageURL, expectedPreview: preview)
        return try restore(envelope: envelope, to: liveURL, keeping: currentSettings,
                           settingsAfterRestore: settingsAfterRestore,
                           recoveryPackageURL: recoveryPackageURL, referenceDataURL: referenceDataURL)
    }

    public func restore(envelope: XLogBackupRestoreEnvelope, to liveURL: URL,
                        keeping currentSettings: XLogSettings, settingsAfterRestore: XLogSettings,
                        recoveryPackageURL: URL, referenceDataURL: URL?) throws -> LogbookDatabase {
        let selected = try envelope.preview.settingsForRestore(keeping: settingsAfterRestore, restoreSettings: false)
        if referenceDataURL != nil { try manager.preflightReferenceDataInstallation(from: envelope) }
        var paused = currentSettings
        paused.automaticSync = false
        settingsStore.save(paused)
        // Publish the recovery fence durably before replacing any linked data.
        try XLogRestoreRecoveryFence.begin(databaseURL: liveURL, envelope: envelope, settings: selected,
                                           recoveryPackageURL: recoveryPackageURL, fileManager: fileManager)
        _ = try manager.installDatabase(from: envelope, to: liveURL, restoredSettings: selected)
        try afterDatabasePublication()
        settingsStore.save(selected)
        guard settingsStore.load() == selected else { throw XLogBackupError.restoreFailed("Restored settings could not be saved.") }
        if envelope.preview.manifest.includesReferenceData, let referenceDataURL {
            _ = try manager.installReferenceData(from: envelope, to: referenceDataURL)
        }
        let database = try LogbookDatabase(url: liveURL)
        do {
            try database.validateRestoredWavelogAuthority(settings: selected)
            try XLogRestoreRecoveryFence.complete(databaseURL: liveURL, fileManager: fileManager)
            return database
        } catch { database.close(); throw error }
    }
}
