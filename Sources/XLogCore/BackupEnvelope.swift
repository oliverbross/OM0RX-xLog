import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

/// Content integrity, not authentication or encryption. A future executor must upload
/// these exact bytes and independently verify their identity on the destination.
public struct XLogBackupEnvelope: Sendable {
    public let data: Data
    public let identity: RemoteBackupPackageIdentity
    public let manifest: XLogBackupManifest
    public let settings: XLogSettings?
    public let preferences: XLogBackupPreferences?

    internal init(data: Data, preview: XLogBackupPreview) throws {
        self.data = data
        manifest = preview.manifest
        settings = preview.settings
        preferences = preview.preferences
        identity = try RemoteBackupPackageIdentity(sha256: BackupPackageSeal.hash(data), byteCount: Int64(data.count))
    }

    public func validate(for plan: RemoteBackupUploadPlan, workspaceGeneration: UUID,
                         destination: RemoteBackupDestination) throws {
        try plan.validate(workspaceGeneration: workspaceGeneration, destination: destination)
        guard identity == plan.package else { throw RemoteBackupPlanningError.invalidPackage }
    }
}

internal struct BackupPackageSeal: Codable, Equatable {
    struct Entry: Codable, Equatable {
        let path: String
        let byteCount: Int
        let sha256: String
    }
    static let filename = "package-seal.json"
    static let maximumBytes = 512 * 1_024 * 1_024
    let version: Int
    let entries: [Entry]

    struct Payload: Codable {
        let seal: BackupPackageSeal
        let files: [String: Data]
    }

    static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }

    static func make(_ files: [String: Data]) -> Self {
        Self(version: 1, entries: files.keys.sorted().map {
            Entry(path: $0, byteCount: files[$0]!.count, sha256: hash(files[$0]!))
        })
    }

    static func validPath(_ path: String) -> Bool {
        guard !path.isEmpty, path.utf8.count <= 4_096,
              path.split(separator: "/").count <= 128,
              !path.hasPrefix("/"), !path.contains("\\"),
              !path.contains(":"), !path.contains("%"),
              path.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return false }
        return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
            let component = String($0)
            let stem = component.split(separator: ".", omittingEmptySubsequences: false).first?.uppercased() ?? ""
            let devices = ["CON", "PRN", "AUX", "NUL"] + (1...9).flatMap { ["COM\($0)", "LPT\($0)"] }
            return !component.isEmpty && component != "." && component != ".."
                && !component.hasSuffix(".") && !component.hasSuffix(" ") && !devices.contains(stem)
        }
    }

    func validate(_ files: [String: Data]) throws {
        guard version == 1, entries.count <= 100_000,
              entries.allSatisfy({ Self.validPath($0.path) && $0.path != Self.filename }),
              Set(entries.map(\.path)).count == entries.count,
              Set(entries.map { $0.path.precomposedStringWithCanonicalMapping.lowercased() }).count == entries.count,
              files["manifest.json"] != nil, files["OM0RX-xLog.sqlite"] != nil,
              self == Self.make(files) else {
            throw XLogBackupError.invalidPackage("package seal does not match every payload file")
        }
    }

    /// Reject links and special files. Never follows a package's link outside its root.
    static func capture(_ root: URL, fileManager: FileManager) throws -> [String: Data] {
        guard try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]).isDirectory == true,
              try root.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
            throw XLogBackupError.invalidPackage("package must be a real directory")
        }
        var files: [String: Data] = [:]
        var total = 0
        var directories = 0
        func walk(_ directory: URL, prefix: String) throws {
            for url in try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
                let path = prefix + url.lastPathComponent
                guard validPath(path) else { throw XLogBackupError.invalidPackage("unsafe payload path") }
                let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey, .fileSizeKey])
                guard values.isSymbolicLink != true else { throw XLogBackupError.invalidPackage("symbolic links are unsupported") }
                if values.isDirectory == true {
                    directories += 1
                    guard directories <= 100_000 else { throw XLogBackupError.invalidPackage("too many directories") }
                    try walk(url, prefix: path + "/")
                } else {
                    guard values.isRegularFile == true, let size = values.fileSize,
                          size <= maximumBytes - total, files.count < 100_000 else {
                        throw XLogBackupError.invalidPackage("unsupported file or package exceeds staging limit")
                    }
                    let handle = try FileHandle(forReadingFrom: url)
                    defer { try? handle.close() }
                    var data = Data()
                    while let chunk = try handle.read(upToCount: min(1_048_576, maximumBytes - total - data.count + 1)), !chunk.isEmpty {
                        guard chunk.count <= maximumBytes - total - data.count else {
                            throw XLogBackupError.invalidPackage("package exceeds staging limit")
                        }
                        data.append(chunk)
                    }
                    total += data.count
                    files[path] = data
                }
            }
        }
        try walk(root, prefix: "")
        return files
    }

    static func verifiedFiles(_ root: URL, fileManager: FileManager) throws -> (Self, [String: Data]) {
        var files = try capture(root, fileManager: fileManager)
        guard let data = files.removeValue(forKey: filename) else {
            throw XLogBackupError.invalidPackage("legacy backup has no package seal; create a new backup for full-package validation")
        }
        let seal = try JSONDecoder().decode(Self.self, from: data)
        try seal.validate(files)
        return (seal, files)
    }

    static func materialize(_ files: [String: Data], at root: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: root, withIntermediateDirectories: false,
                                        attributes: LocalFilePermissions.directoryAttributes)
        for path in files.keys.sorted() {
            guard validPath(path) else { throw XLogBackupError.invalidPackage("unsafe payload path") }
            let url = root.appendingPathComponent(path)
            try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                            attributes: LocalFilePermissions.directoryAttributes)
            try files[path]!.write(to: url, options: .atomic)
        }
    }
}
