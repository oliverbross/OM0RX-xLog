import Foundation
import Testing
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite("Portable backup paths")
struct LocalFilePathTests {
    @Test("Windows accepts drive roots and UNC but rejects relative, traversal and device paths")
    func windowsPaths() {
        for path in ["C:\\Users\\Test\\My backup.xlogbackup", "d:/Backups/Log.xlogbackup", "/C:/Users/Test/Log.xlogbackup", "\\\\server\\share\\Log.xlogbackup"] {
            #expect(LocalFilePath.isAbsoluteWithoutTraversal(path, windows: true))
        }
        for path in ["C:relative.xlogbackup", "relative.xlogbackup", "\\root-relative.xlogbackup", "C:\\safe\\..\\outside.xlogbackup", "C:/safe/../outside.xlogbackup", "\\\\?\\C:\\backup", "\\\\.\\device", "//server", "C:/safe\0/backup"] {
            #expect(!LocalFilePath.isAbsoluteWithoutTraversal(path, windows: true))
        }
    }

    @Test("Unix absolute paths retain traversal rejection and do not interpret Windows drives")
    func unixPaths() {
        #expect(LocalFilePath.isAbsoluteWithoutTraversal("/tmp/My backup.xlogbackup", windows: false))
        for path in ["../backup", "/tmp/../backup", "backup", "C:\\backup", "/tmp/./backup", "/tmp/backup\0"] {
            #expect(!LocalFilePath.isAbsoluteWithoutTraversal(path, windows: false))
        }
    }

    @Test("Native C file paths preserve Unicode and distinguish drive and UNC roots")
    func nativeWindowsFilePaths() {
        for (path, expected) in [
            (#"C:\Users\Test\café-秘密 100%.sqlite"#, #"\\?\C:\Users\Test\café-秘密 100%.sqlite"#),
            ("/d:/Backups/café.sqlite", #"\\?\d:\Backups\café.sqlite"#),
            (#"\\server\share\秘密.sqlite"#, #"\\?\UNC\server\share\秘密.sqlite"#),
            ("//server/share/backup.sqlite", #"\\?\UNC\server\share\backup.sqlite"#)
        ] {
            #expect(LocalFilePath.nativeFileSystemPath(path, windows: true) == expected)
        }
        let unix = "/tmp/café-秘密 100%.sqlite"
        #expect(LocalFilePath.nativeFileSystemPath(unix, windows: false) == unix)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("café-秘密 100%.sqlite")
        #if os(Windows)
        #expect(LocalFilePath.nativeFileSystemPath(for: url)?.hasPrefix(#"\\?\"#) == true)
        #else
        #expect(LocalFilePath.nativeFileSystemPath(for: url) == url.path)
        #endif
    }

    @Test("Extended C file paths never reinterpret traversal, devices or ambiguous Windows names")
    func unsafeNativeWindowsFilePaths() {
        for path in ["C:relative.sqlite", "relative.sqlite", #"\root-relative.sqlite"#,
                     #"C:\safe\..\outside.sqlite"#, #"C:\safe\.\inside.sqlite"#,
                     #"\\?\C:\file.sqlite"#, #"\\.\PhysicalDrive0"#, "//server", "C:/bad\0/file",
                     "C:/trailing./file", "C:/trailing /file", "C:/file:stream", "C:/NUL.sqlite",
                     "C:/com1.sqlite", "C:/LPT³.sqlite", "C:/bad?/file", "C:/bad\u{1}/file"] {
            #expect(LocalFilePath.nativeFileSystemPath(path, windows: true) == nil)
        }
    }

    @Test("SQLite and spot history open deep Unicode filenames without changing caller URLs")
    func deepNativeDatabasePaths() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let rootUnits = root.withUnsafeFileSystemRepresentation { $0.map { String(cString: $0).utf16.count } ?? 0 }
        let prefix = "café-秘密-"
        let padding = 244 - rootUnits - 1 - prefix.utf16.count
        try #require(padding >= 0, "Disposable temporary root must leave room for the deep path fixture")
        let directory = root.appendingPathComponent(prefix + String(repeating: "x", count: padding))
        let url = directory.appendingPathComponent("café-秘密-log.sqlite")
        #expect(url.withUnsafeFileSystemRepresentation { $0.map { String(cString: $0).utf16.count } ?? 0 } > 260)
        let database = try LogbookDatabase(url: url)
        defer { database.close() }
        try database.save(QSO(call: "DEEP", band: "20m", mode: "CW"))
        #expect(database.url == url)
        #expect(try database.fetch().map(\.call) == ["DEEP"])
        database.close()
        let reopened = try LogbookDatabase(url: url)
        defer { reopened.close() }
        #expect(try reopened.fetch().map(\.call) == ["DEEP"])
        let history = try SpotHistoryDatabase(url: directory.appendingPathComponent("café-秘密-spots.sqlite"))
        history.close()
        reopened.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("Containment compares complete canonical path components")
    func containment() {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        #expect(LocalFilePath.contains(root, in: root))
        #expect(LocalFilePath.contains(root.appendingPathComponent("Backups/example"), in: root))
        #expect(!LocalFilePath.contains(root.appendingPathExtension("other"), in: root))
        #expect(!LocalFilePath.contains(root.deletingLastPathComponent(), in: root))
    }
}
