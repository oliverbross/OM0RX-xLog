import Foundation

public enum LocalFilePath {
    #if os(Windows)
    public static let isWindows = true
    #else
    public static let isWindows = false
    #endif

    /// Accept native absolute paths, never drive-relative paths, traversal or
    /// Windows device namespaces. The explicit dialect also makes both sets of
    /// safety rules testable on every development host.
    public static func isAbsoluteWithoutTraversal(_ path: String, windows: Bool = isWindows) -> Bool {
        guard !path.isEmpty, !path.contains("\0") else { return false }
        let normalized = windows ? path.replacingOccurrences(of: "\\", with: "/") : path
        let components = normalized.split(separator: "/")
        guard !components.contains(".."), !components.contains(".") else { return false }
        if !windows { return normalized.hasPrefix("/") }
        if normalized.hasPrefix("//") {
            // UNC server/share, excluding //?/ and //./ device paths.
            return components.count >= 2 && components.first != "?" && components.first != "."
        }
        // URL.path on Windows can include the leading slash of /C:/... .
        let drivePath = normalized.hasPrefix("/") ? String(normalized.dropFirst()) : normalized
        let bytes = Array(drivePath.utf8.prefix(3))
        return bytes.count == 3 && ((65...90).contains(bytes[0]) || (97...122).contains(bytes[0]))
            && bytes[1] == 58 && bytes[2] == 47
    }

    /// UTF-8 filename for native C file APIs. Windows needs its native drive or
    /// UNC spelling and an extended prefix so SQLite journal/backup filenames
    /// do not depend on process manifests or machine-wide long-path settings.
    /// This does not replace callers' containment, symlink or ownership checks.
    public static func nativeFileSystemPath(for url: URL) -> String? {
        #if os(Windows)
        guard url.isFileURL, !url.absoluteString.lowercased().contains("%00") else { return nil }
        return url.withUnsafeFileSystemRepresentation { representation in
            guard let representation else { return nil }
            return nativeFileSystemPath(String(cString: representation), windows: true)
        }
        #else
        return url.path
        #endif
    }

    // Explicit dialect keeps Windows filename safety testable on other hosts.
    static func nativeFileSystemPath(_ path: String, windows: Bool) -> String? {
        guard windows else { return path }
        guard isAbsoluteWithoutTraversal(path, windows: true) else { return nil }
        let normalized = path.replacingOccurrences(of: "\\", with: "/")
        let unc = normalized.hasPrefix("//")
        let body = unc ? String(normalized.dropFirst(2))
            : (normalized.hasPrefix("/") ? String(normalized.dropFirst()) : normalized)
        guard !body.hasPrefix("/"), !body.hasSuffix("/"), !body.contains("//") else { return nil }
        let components = body.split(separator: "/")
        let names = unc ? components[...] : components.dropFirst()
        let forbidden = CharacterSet(charactersIn: "<>:\"|?*")
        guard names.allSatisfy({ name in
            !name.hasSuffix(".") && !name.hasSuffix(" ")
                && name.unicodeScalars.allSatisfy { $0.value >= 32 && !forbidden.contains($0) }
        }) else { return nil }
        // The extended namespace disables ordinary Win32 normalization. Reject
        // ambiguous DOS device names rather than silently changing their target.
        let fileNames = unc ? names.dropFirst(2) : names
        let reserved = ["CON", "PRN", "AUX", "NUL"]
        let portDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"]
        guard fileNames.allSatisfy({ name in
            let base = String(name.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)[0]).uppercased()
            return !reserved.contains(base)
                && !((base.hasPrefix("COM") || base.hasPrefix("LPT")) && portDigits.contains(String(base.dropFirst(3))))
        }) else { return nil }
        return (unc ? "\\\\?\\UNC\\" : "\\\\?\\") + body.replacingOccurrences(of: "/", with: "\\")
    }

    public static func contains(_ candidate: URL, in directory: URL) -> Bool {
        func components(_ url: URL) -> [String] {
            let values = url.standardizedFileURL.resolvingSymlinksInPath().pathComponents
            return isWindows ? values.map { $0.lowercased() } : values
        }
        let child = components(candidate), parent = components(directory)
        return child.count >= parent.count && Array(child.prefix(parent.count)) == parent
    }
}
