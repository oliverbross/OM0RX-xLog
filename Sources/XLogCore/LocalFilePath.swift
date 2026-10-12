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

    public static func contains(_ candidate: URL, in directory: URL) -> Bool {
        func components(_ url: URL) -> [String] {
            let values = url.standardizedFileURL.resolvingSymlinksInPath().pathComponents
            return isWindows ? values.map { $0.lowercased() } : values
        }
        let child = components(candidate), parent = components(directory)
        return child.count >= parent.count && Array(child.prefix(parent.count)) == parent
    }
}
