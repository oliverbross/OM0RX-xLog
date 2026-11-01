import Foundation
#if os(Windows)
import WinSDK
#endif

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

    /// Keep the caller's path/link checks and inherited ACLs unchanged.
    static func createDirectoryWithParents(at url: URL, attributes: [FileAttributeKey: Any]? = nil,
                                           fileManager: FileManager) throws {
        #if os(Windows)
        try createDirectoriesIndividually(at: url, attributes: attributes, fileManager: fileManager) { directory in
            try createDirectoryWithoutParents(at: directory, attributes: attributes, fileManager: fileManager)
        }
        #else
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true, attributes: attributes)
        #endif
    }

    // Kept host-independent so failure propagation and nonrecursive delegation
    // can be checked without substituting a fake filesystem for native Windows.
    static func createDirectoriesIndividually(at url: URL, attributes: [FileAttributeKey: Any]? = nil,
                                              fileManager: FileManager,
                                              create: ((URL) throws -> Void)? = nil) throws {
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
                if let create { try create(directory) }
                else { try fileManager.createDirectory(at: directory, withIntermediateDirectories: false, attributes: attributes) }
            } catch {
                // A concurrent creator is allowed only when the directory now
                // exists, matching Foundation's recursive mkdir contract.
                var existsAsDirectory: ObjCBool = false
                guard fileManager.fileExists(atPath: directory.path, isDirectory: &existsAsDirectory),
                      existsAsDirectory.boolValue else { throw error }
            }
        }
    }

    /// Foundation only adds an extended prefix above MAX_PATH, leaving the
    /// 249–260 character directory gap. Pass the validated prefix directly.
    static func createDirectoryWithoutParents(at url: URL, attributes: [FileAttributeKey: Any]? = nil,
                                               fileManager: FileManager) throws {
        #if os(Windows)
        guard let path = LocalFilePath.nativeFileSystemPath(for: url) else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        let error = path.withCString(encodedAs: UTF16.self) { pointer -> DWORD? in
            if CreateDirectoryW(pointer, nil) { return nil }
            return GetLastError()
        }
        if let error {
            let code: CocoaError.Code
            switch error {
            case DWORD(ERROR_ALREADY_EXISTS), DWORD(ERROR_FILE_EXISTS): code = .fileWriteFileExists
            case DWORD(ERROR_ACCESS_DENIED): code = .fileWriteNoPermission
            case DWORD(ERROR_INVALID_NAME), DWORD(ERROR_FILENAME_EXCED_RANGE): code = .fileWriteInvalidFileName
            default: code = .fileWriteUnknown
            }
            throw CocoaError(code, userInfo: [NSFilePathErrorKey: url.path,
                NSUnderlyingErrorKey: NSError(domain: "Win32Error", code: Int(error))])
        }
        if let attributes { try? fileManager.setAttributes(attributes, ofItemAtPath: url.path) }
        #else
        try fileManager.createDirectory(at: url, withIntermediateDirectories: false, attributes: attributes)
        #endif
    }

    public static func protectFile(_ url: URL, fileManager: FileManager = .default) throws {
        #if !os(Windows)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        #endif
    }
}
