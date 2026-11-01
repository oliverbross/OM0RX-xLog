import Foundation

/// POSIX permissions on Unix; inherited user-profile ACLs on Windows. Windows
/// does not implement chmod-style protection. These helpers never change an ACL
/// or make a directory public, and do not replace the workspace's link checks.
public enum LocalFilePermissions {
    public static var directoryAttributes: [FileAttributeKey: Any]? {
        #if os(Windows)
        return nil
        #else
        return [.posixPermissions: 0o700]
        #endif
    }

    /// Foundation's recursive Windows mkdir uses the MAX_PATH-limited shell
    /// API. Its nonrecursive mkdir uses CreateDirectoryW with an NT path.
    /// Keep the caller's path/link checks and inherited ACLs unchanged.
    static func createDirectoryWithParents(at url: URL, attributes: [FileAttributeKey: Any]? = nil,
                                           fileManager: FileManager) throws {
        #if os(Windows)
        try createDirectoriesIndividually(at: url, attributes: attributes, fileManager: fileManager)
        #else
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true, attributes: attributes)
        #endif
    }

    // Kept host-independent so failure propagation and nonrecursive delegation
    // can be checked without substituting a fake filesystem for native Windows.
    static func createDirectoriesIndividually(at url: URL, attributes: [FileAttributeKey: Any]? = nil,
                                              fileManager: FileManager) throws {
        guard url.isFileURL else { throw CocoaError(.fileWriteInvalidFileName) }
        var pending: [URL] = []
        var current = url
        var isDirectory: ObjCBool = false
        while !fileManager.fileExists(atPath: current.path, isDirectory: &isDirectory) {
            pending.append(current)
            let parent = current.deletingLastPathComponent()
            guard parent.path != current.path else { throw CocoaError(.fileWriteUnknown) }
            current = parent
        }
        guard isDirectory.boolValue else { throw CocoaError(.fileWriteFileExists) }
        for directory in pending.reversed() {
            do {
                try fileManager.createDirectory(at: directory, withIntermediateDirectories: false, attributes: attributes)
            } catch {
                // A concurrent creator is allowed only when the directory now
                // exists, matching Foundation's recursive mkdir contract.
                var existsAsDirectory: ObjCBool = false
                guard fileManager.fileExists(atPath: directory.path, isDirectory: &existsAsDirectory),
                      existsAsDirectory.boolValue else { throw error }
            }
        }
    }

    public static func protectFile(_ url: URL, fileManager: FileManager = .default) throws {
        #if !os(Windows)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        #endif
    }
}
