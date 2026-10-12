import CryptoKit
import Foundation
import SQLite3

public enum XLogBackupError: Error, LocalizedError {
    case destinationExists
    case invalidPackage(String)
    case checksumMismatch
    case integrityFailed(String)
    case restoreFailed(String)

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
        }
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

    public init(
        deskBandMapBands: [String],
        detachedBandMapBands: [String],
        deskBandMapFollowsRadio: Bool,
        detachedBandMapLayout: String,
        bandMapFontScale: Double,
        intelligenceBands: [String],
        clusterSpotOpensFullEditor: Bool,
        detachedBandMapFollowsRadio: Bool = false
    ) {
        self.deskBandMapBands = deskBandMapBands
        self.detachedBandMapBands = detachedBandMapBands
        self.deskBandMapFollowsRadio = deskBandMapFollowsRadio
        self.detachedBandMapLayout = detachedBandMapLayout
        self.bandMapFontScale = bandMapFontScale
        self.intelligenceBands = intelligenceBands
        self.clusterSpotOpensFullEditor = clusterSpotOpensFullEditor
        self.detachedBandMapFollowsRadio = detachedBandMapFollowsRadio
    }

    private enum CodingKeys: String, CodingKey {
        case deskBandMapBands, detachedBandMapBands, deskBandMapFollowsRadio,
             detachedBandMapLayout, bandMapFontScale, intelligenceBands,
             clusterSpotOpensFullEditor, detachedBandMapFollowsRadio
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
    }
}

public struct XLogBackupManifest: Codable, Equatable, Sendable {
    public static let currentFormatVersion = 1

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
        referenceDataURL: URL? = nil
    ) throws -> XLogBackupPreview {
        guard !fileManager.fileExists(atPath: packageURL.path) else {
            throw XLogBackupError.destinationExists
        }
        let parent = packageURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let temporary = parent.appendingPathComponent(".xlogbackup-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: temporary, withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700])
        var committed = false
        defer { if !committed { try? fileManager.removeItem(at: temporary) } }

        let databaseURL = temporary.appendingPathComponent("OM0RX-xLog.sqlite")
        try database.backup(to: databaseURL)
        let inspection = try inspectDatabase(at: databaseURL)
        let attributes = try fileManager.attributesOfItem(atPath: databaseURL.path)
        let bytes = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        let referenceDestination = temporary.appendingPathComponent("Reference Data", isDirectory: true)
        var includesReferenceData = false
        if let referenceDataURL, fileManager.fileExists(atPath: referenceDataURL.path) {
            try fileManager.copyItem(at: referenceDataURL, to: referenceDestination)
            includesReferenceData = true
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
            includesReferenceData: includesReferenceData
        )
        try encoder.encode(manifest).write(
            to: temporary.appendingPathComponent("manifest.json"),
            options: .atomic
        )
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
        guard manifest.formatVersion == XLogBackupManifest.currentFormatVersion else {
            throw XLogBackupError.invalidPackage("unsupported format version \(manifest.formatVersion)")
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

        let settings = try decodeIfPresent(XLogSettings.self, at: packageURL.appendingPathComponent("settings.json"))
        let preferences = try decodeIfPresent(XLogBackupPreferences.self, at: packageURL.appendingPathComponent("preferences.json"))
        return XLogBackupPreview(
            packageURL: packageURL,
            manifest: manifest,
            settings: settings,
            preferences: preferences
        )
    }

    public func installDatabase(from packageURL: URL, to liveURL: URL) throws -> URL? {
        _ = try inspect(at: packageURL)
        let source = packageURL.appendingPathComponent("OM0RX-xLog.sqlite")
        let directory = liveURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let staging = directory.appendingPathComponent(".restore-\(UUID().uuidString).sqlite")
        try fileManager.copyItem(at: source, to: staging)
        do {
            _ = try inspectDatabase(at: staging)
        } catch {
            try? fileManager.removeItem(at: staging)
            throw error
        }

        let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let rollback = directory.appendingPathComponent("OM0RX-xLog-before-restore-\(timestamp).sqlite")
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
                try? fileManager.moveItem(at: preservedURL, to: liveURL)
            }
            throw XLogBackupError.restoreFailed(error.localizedDescription)
        }
    }

    public func referenceDataURL(in packageURL: URL) -> URL? {
        let url = packageURL.appendingPathComponent("Reference Data", isDirectory: true)
        return fileManager.fileExists(atPath: url.path) ? url : nil
    }

    @discardableResult
    public func installReferenceData(from packageURL: URL, to liveURL: URL) throws -> URL? {
        guard let source = referenceDataURL(in: packageURL) else { return nil }
        let parent = liveURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".reference-restore-\(UUID().uuidString)", isDirectory: true)
        try fileManager.copyItem(at: source, to: staging)
        let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let rollback = parent.appendingPathComponent("Reference Data-before-restore-\(timestamp)", isDirectory: true)
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
                try? fileManager.moveItem(at: rollback, to: liveURL)
            }
            throw XLogBackupError.restoreFailed("Reference Data: \(error.localizedDescription)")
        }
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
