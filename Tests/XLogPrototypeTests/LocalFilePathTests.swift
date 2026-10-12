import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
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

    @Test("Containment compares complete canonical path components")
    func containment() {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        #expect(LocalFilePath.contains(root, in: root))
        #expect(LocalFilePath.contains(root.appendingPathComponent("Backups/example"), in: root))
        #expect(!LocalFilePath.contains(root.appendingPathExtension("other"), in: root))
        #expect(!LocalFilePath.contains(root.deletingLastPathComponent(), in: root))
    }
}
