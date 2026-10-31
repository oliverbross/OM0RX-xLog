#if os(Windows)
import Foundation
import WinSDK

enum WindowsContestHostEnvironment {
    /// Windows side-by-side assemblies require SystemRoot even for an otherwise
    /// isolated child. Derive it from the OS rather than inheriting user values.
    static func systemRoot() -> String? {
        var buffer = [WCHAR](repeating: 0, count: Int(MAX_PATH) + 1)
        var length = Int(buffer.withUnsafeMutableBufferPointer {
            GetWindowsDirectoryW($0.baseAddress, UINT($0.count))
        })
        if length >= buffer.count, length <= 32_768 {
            buffer = [WCHAR](repeating: 0, count: Int(length) + 1)
            length = Int(buffer.withUnsafeMutableBufferPointer {
                GetWindowsDirectoryW($0.baseAddress, UINT($0.count))
            })
        }
        guard length > 0, length < buffer.count else { return nil }
        let path = String(decoding: buffer.prefix(Int(length)), as: UTF16.self)
        var directory: ObjCBool = false
        guard !path.isEmpty, !path.utf16.contains(0),
              FileManager.default.fileExists(atPath: path, isDirectory: &directory), directory.boolValue else { return nil }
        return path
    }
}
#endif
