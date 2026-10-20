import Foundation
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

public enum IntegrationWorkspaceError: Error, LocalizedError, Equatable {
    case sourceMissing
    case destinationExists
    case unsafePath
    case sqlite(String)
    case invalidSnapshot(String)

    public var errorDescription: String? {
        switch self {
        case .sourceMissing: return "The source logbook database is missing or is not a regular file."
        case .destinationExists: return "The integration workspace already exists."
        case .unsafePath: return "The source and integration workspace paths overlap or use a symbolic or hard link."
        case let .sqlite(message): return "Could not snapshot the logbook: \(message)"
        case let .invalidSnapshot(message): return "The integration snapshot failed verification: \(message)"
        }
    }
}

/// An independent, writable copy of the native logbook. The host must pass databaseURL
/// explicitly to LogbookDatabase and use the separate defaults and Keychain identities.
public struct IntegrationWorkspace: Sendable {
    public let directoryURL: URL
    public let databaseURL: URL
    public let defaultsSuiteName: String
    public let keychainService: String
    public let qsoCount: Int
    public let pendingSyncCount: Int
    public let outboxCount: Int

    /// Fresh preferences deliberately start with synchronization disabled. The caller
    /// may supply the native non-secret settings, but credentials are never copied.
    public static func safeSettings(from native: XLogSettings? = nil) -> XLogSettings {
        var settings = native ?? .defaults
        settings.automaticSync = false
        return settings
    }

    public func makeDefaults() -> UserDefaults? {
        UserDefaults(suiteName: defaultsSuiteName)
    }
}

public enum IntegrationWorkspaceBootstrap {
    public static func open(at directoryURL: URL,
                            expectedIdentityPrefix: String = "com.oliverbross.OM0RXXLog.Integration.") throws -> IntegrationWorkspace {
        guard ["com.oliverbross.OM0RXXLog.Integration.",
               "com.oliverbross.OM0RXXLog.ContestingTest.Integration."].contains(expectedIdentityPrefix) else {
            throw IntegrationWorkspaceError.unsafePath
        }
        let directory = directoryURL.standardizedFileURL
        let directoryValues = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard directoryValues.isDirectory == true, directoryValues.isSymbolicLink != true else {
            throw IntegrationWorkspaceError.unsafePath
        }
        let data = try Data(contentsOf: directory.appendingPathComponent("workspace.json"))
        let metadata = try JSONDecoder().decode(IntegrationWorkspaceMetadata.self, from: data)
        let databaseURL = directory.appendingPathComponent("OM0RX-xLog.sqlite")
        let databaseValues = try databaseURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        let databaseAttributes = try FileManager.default.attributesOfItem(atPath: databaseURL.path)
        guard databaseValues.isRegularFile == true, databaseValues.isSymbolicLink != true,
              (databaseAttributes[.referenceCount] as? NSNumber)?.intValue == 1,
              metadata.defaultsSuiteName.hasPrefix(expectedIdentityPrefix),
              metadata.keychainService.hasPrefix(expectedIdentityPrefix) else {
            throw IntegrationWorkspaceError.unsafePath
        }
        // A clean shutdown can remove the WAL/SHM sidecars while leaving the
        // database in WAL mode. Open the app-owned workspace read/write long
        // enough for SQLite to recreate those internal files, then fence every
        // statement below with query_only before validating its contents.
        let counts = try inspect(databaseURL, flags: SQLITE_OPEN_READWRITE)
        return IntegrationWorkspace(
            directoryURL: directory,
            databaseURL: databaseURL,
            defaultsSuiteName: metadata.defaultsSuiteName,
            keychainService: metadata.keychainService,
            qsoCount: counts.qsos,
            pendingSyncCount: counts.pending,
            outboxCount: counts.outbox
        )
    }

    public static func createEmpty(
        at destinationDirectoryURL: URL,
        identityPrefix: String = "com.oliverbross.OM0RXXLog.Integration.",
        fileManager: FileManager = .default
    ) throws -> IntegrationWorkspace {
        try createStaged(at: destinationDirectoryURL, identityPrefix: identityPrefix, fileManager: fileManager) { databaseURL in
            let database = try LogbookDatabase(url: databaseURL)
            database.close()
        }
    }

    public static func create(
        sourceDatabaseURL: URL,
        at destinationDirectoryURL: URL,
        fileManager: FileManager = .default
    ) throws -> IntegrationWorkspace {
        let source = sourceDatabaseURL.standardizedFileURL
        let destination = destinationDirectoryURL.standardizedFileURL
        let sourceValues = try? source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard sourceValues?.isSymbolicLink != true else { throw IntegrationWorkspaceError.unsafePath }
        guard sourceValues?.isRegularFile == true else { throw IntegrationWorkspaceError.sourceMissing }
        guard !LocalFilePath.contains(destination, in: source),
              !LocalFilePath.contains(source, in: destination) else {
            throw IntegrationWorkspaceError.unsafePath
        }
        return try createStaged(at: destination, identityPrefix: "com.oliverbross.OM0RXXLog.Integration.", fileManager: fileManager) { stagedDatabase in
            try copyConsistentSnapshot(from: source, to: stagedDatabase)
        }
    }

    private static func createStaged(
        at destination: URL,
        identityPrefix: String,
        fileManager: FileManager,
        populate: (URL) throws -> Void
    ) throws -> IntegrationWorkspace {
        guard identityPrefix == "com.oliverbross.OM0RXXLog.Integration."
                || identityPrefix == "com.oliverbross.OM0RXXLog.ContestingTest.Integration." else {
            throw IntegrationWorkspaceError.unsafePath
        }
        let parent = destination.deletingLastPathComponent()
        guard !fileManager.fileExists(atPath: destination.path),
              (try? destination.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink != true else {
            throw IntegrationWorkspaceError.destinationExists
        }
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".xlog-integration-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(
            at: staging,
            withIntermediateDirectories: false,
            attributes: LocalFilePermissions.directoryAttributes
        )
        var committed = false
        defer { if !committed { try? fileManager.removeItem(at: staging) } }

        let stagedDatabase = staging.appendingPathComponent("OM0RX-xLog.sqlite")
        try populate(stagedDatabase)
        let counts = try inspect(stagedDatabase)
        try LocalFilePermissions.protectFile(stagedDatabase, fileManager: fileManager)

        // The identity is generated before publication; no native preferences or secrets
        // are copied into the workspace, and a failed move cannot replace an old one.
        let identifier = UUID().uuidString.lowercased()
        let identity = IntegrationWorkspace(
            directoryURL: destination,
            databaseURL: destination.appendingPathComponent("OM0RX-xLog.sqlite"),
            defaultsSuiteName: "\(identityPrefix)\(identifier)",
            keychainService: "\(identityPrefix)\(identifier)",
            qsoCount: counts.qsos,
            pendingSyncCount: counts.pending,
            outboxCount: counts.outbox
        )
        let metadata = IntegrationWorkspaceMetadata(
            defaultsSuiteName: identity.defaultsSuiteName,
            keychainService: identity.keychainService
        )
        let metadataURL = staging.appendingPathComponent("workspace.json")
        try JSONEncoder().encode(metadata).write(to: metadataURL, options: .atomic)
        try LocalFilePermissions.protectFile(metadataURL, fileManager: fileManager)
        guard !fileManager.fileExists(atPath: destination.path) else {
            throw IntegrationWorkspaceError.destinationExists
        }
        try fileManager.moveItem(at: staging, to: destination)
        committed = true
        return identity
    }

    private struct Counts {
        let qsos: Int
        let pending: Int
        let outbox: Int
    }

    private static func open(_ url: URL, flags: Int32) throws -> OpaquePointer {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, flags | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            sqlite3_close(handle)
            throw IntegrationWorkspaceError.sqlite(message)
        }
        sqlite3_busy_timeout(handle, 5_000)
        return handle
    }

    private static func copyConsistentSnapshot(from source: URL, to destination: URL) throws {
        let input = try open(source, flags: SQLITE_OPEN_READONLY)
        defer { sqlite3_close(input) }
        guard sqlite3_exec(input, "PRAGMA query_only=ON", nil, nil, nil) == SQLITE_OK else {
            throw IntegrationWorkspaceError.sqlite(String(cString: sqlite3_errmsg(input)))
        }
        let output = try open(destination, flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_EXCLUSIVE)
        defer { sqlite3_close(output) }
        guard let backup = sqlite3_backup_init(output, "main", input, "main") else {
            throw IntegrationWorkspaceError.sqlite(String(cString: sqlite3_errmsg(output)))
        }
        let step = sqlite3_backup_step(backup, -1)
        let finish = sqlite3_backup_finish(backup)
        guard step == SQLITE_DONE, finish == SQLITE_OK else {
            throw IntegrationWorkspaceError.sqlite(String(cString: sqlite3_errmsg(output)))
        }
        guard sqlite3_exec(output, "PRAGMA journal_mode=DELETE", nil, nil, nil) == SQLITE_OK else {
            throw IntegrationWorkspaceError.sqlite(String(cString: sqlite3_errmsg(output)))
        }
    }

    private static func inspect(_ url: URL, flags: Int32 = SQLITE_OPEN_READONLY) throws -> Counts {
        let handle = try open(url, flags: flags)
        defer { sqlite3_close(handle) }
        guard sqlite3_exec(handle, "PRAGMA query_only=ON", nil, nil, nil) == SQLITE_OK else {
            throw IntegrationWorkspaceError.sqlite(String(cString: sqlite3_errmsg(handle)))
        }
        guard try scalarText("PRAGMA integrity_check", on: handle) == "ok" else {
            throw IntegrationWorkspaceError.invalidSnapshot("SQLite integrity_check did not return ok")
        }
        let qsos = try scalarInt("SELECT COUNT(*) FROM qsos", on: handle)
        let pending = try scalarInt("SELECT COUNT(*) FROM qsos WHERE is_dirty = 1", on: handle)
        let outbox = try scalarInt("SELECT COUNT(*) FROM sync_outbox", on: handle)
        return Counts(qsos: qsos, pending: pending, outbox: outbox)
    }

    private static func scalarInt(_ query: String, on handle: OpaquePointer) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, query, -1, &statement, nil) == SQLITE_OK else {
            throw IntegrationWorkspaceError.invalidSnapshot(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else {
            throw IntegrationWorkspaceError.invalidSnapshot(String(cString: sqlite3_errmsg(handle)))
        }
        return Int(sqlite3_column_int64(statement, 0))
    }

    private static func scalarText(_ query: String, on handle: OpaquePointer) throws -> String {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, query, -1, &statement, nil) == SQLITE_OK else {
            throw IntegrationWorkspaceError.invalidSnapshot(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW,
              let text = sqlite3_column_text(statement, 0) else {
            throw IntegrationWorkspaceError.invalidSnapshot(String(cString: sqlite3_errmsg(handle)))
        }
        return String(cString: text)
    }
}

private struct IntegrationWorkspaceMetadata: Codable {
    let defaultsSuiteName: String
    let keychainService: String
}
