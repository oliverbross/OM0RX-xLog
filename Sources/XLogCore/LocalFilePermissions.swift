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

    public static func protectFile(_ url: URL, fileManager: FileManager = .default) throws {
        #if !os(Windows)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        #endif
    }
}
