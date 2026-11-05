import Foundation
import XCTest
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

private func renameNativeUnits(_ url: URL) -> Int {
    url.withUnsafeFileSystemRepresentation { $0.map { String(cString: $0).utf16.count } ?? 0 }
}

private final class RenameFailureFileManager: FileManager, @unchecked Sendable {
    var moves = 0
    override func moveItem(at source: URL, to destination: URL) throws {
        moves += 1
        throw CocoaError(.fileWriteNoPermission)
    }
}

private final class CompletionFailureFileManager: FileManager, @unchecked Sendable {
    var failCompletion = false
    var occupyReferenceOnRollback = false
    var collisionCreated = false

    override func removeItem(at url: URL) throws {
        if failCompletion && url.lastPathComponent == ".restore-incomplete" {
            failCompletion = false
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.removeItem(at: url)
    }

    override func moveItem(at source: URL, to destination: URL) throws {
        try super.moveItem(at: source, to: destination)
        if occupyReferenceOnRollback && source.lastPathComponent == "Reference Data"
            && destination.lastPathComponent.hasPrefix(".failed-restore-") {
            // This ordinary short move remains caller-dispatched. A real
            // occupied destination then makes the native long-source rollback
            // fail without an injected native API or test-specific routing.
            XCTAssertLessThan(max(renameNativeUnits(source), renameNativeUnits(destination)), 248)
            try super.createDirectory(at: source, withIntermediateDirectories: false)
            try Data("occupied destination".utf8).write(to: source.appendingPathComponent("collision.txt"))
            collisionCreated = true
        }
    }
}

final class LongRestoreRenameTests: XCTestCase {
    private func withRoot(_ body: (URL) throws -> Void) throws {
        #if os(Windows)
        let parent = ProcessInfo.processInfo.environment["RUNNER_TEMP"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.temporaryDirectory
        #else
        let parent = URL(fileURLWithPath: "/tmp", isDirectory: true)
        #endif
        let root = parent.appendingPathComponent("xrr-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
            attributes: LocalFilePermissions.directoryAttributes)
        defer { try? FileManager.default.removeItem(at: root) }
        try body(root)
    }

    private func directory(_ root: URL, units: Int) throws -> URL {
        let padding = units - renameNativeUnits(root) - 1
        XCTAssertGreaterThan(padding, 0)
        let url = root.appendingPathComponent(String(repeating: "d", count: max(0, padding)), isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false,
            attributes: LocalFilePermissions.directoryAttributes)
        XCTAssertEqual(renameNativeUnits(url), units)
        return url
    }

    func testLongUnicodeFileRenameAndLongSourceReturnPreserveBytes() throws {
        try withRoot { root in
            let parent = try directory(root, units: 240)
            let source = root.appendingPathComponent("from-Ω.txt")
            let destination = parent.appendingPathComponent("selected-Ω.txt")
            let bytes = Data("selected bytes Ω".utf8)
            try bytes.write(to: source)
            XCTAssertGreaterThanOrEqual(renameNativeUnits(destination), 248)
            try LocalFilePermissions.moveRestoreItem(at: source, to: destination)
            XCTAssertFalse(FileManager.default.fileExists(atPath: source.path))
            XCTAssertEqual(try Data(contentsOf: destination), bytes)
            try LocalFilePermissions.moveRestoreItem(at: destination, to: source)
            XCTAssertEqual(try Data(contentsOf: source), bytes)
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        }
    }

    func testLongDirectoryRenameAndLongSourceReturnPreserveChildren() throws {
        try withRoot { root in
            let parent = try directory(root, units: 240)
            let source = root.appendingPathComponent("reference", isDirectory: true)
            let destination = parent.appendingPathComponent("reference-Ω", isDirectory: true)
            try FileManager.default.createDirectory(at: source, withIntermediateDirectories: false)
            let bytes = Data("reference bytes Ω".utf8)
            try bytes.write(to: source.appendingPathComponent("fixture.json"))
            try LocalFilePermissions.moveRestoreItem(at: source, to: destination)
            XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("fixture.json")), bytes)
            try LocalFilePermissions.moveRestoreItem(at: destination, to: source)
            XCTAssertEqual(try Data(contentsOf: source.appendingPathComponent("fixture.json")), bytes)
        }
    }

    func testOccupiedLongFileDestinationNeverOverwritesEitherCopy() throws {
        try withRoot { root in
            let parent = try directory(root, units: 240)
            let source = root.appendingPathComponent("source.txt")
            let destination = parent.appendingPathComponent("occupied.txt")
            let selected = Data("source copy".utf8), occupied = Data("destination copy".utf8)
            try selected.write(to: source); try occupied.write(to: destination)
            XCTAssertThrowsError(try LocalFilePermissions.moveRestoreItem(at: source, to: destination)) { error in
                XCTAssertEqual((error as NSError).code, CocoaError.fileWriteFileExists.rawValue)
                #if os(Windows)
                XCTAssertEqual(((error as NSError).userInfo[NSUnderlyingErrorKey] as? NSError)?.domain, "Win32Error")
                #endif
            }
            XCTAssertEqual(try Data(contentsOf: source), selected)
            XCTAssertEqual(try Data(contentsOf: destination), occupied)
        }
    }

    func testOccupiedLongDirectoryDestinationNeverMergesChildren() throws {
        try withRoot { root in
            let parent = try directory(root, units: 240)
            let source = root.appendingPathComponent("source", isDirectory: true)
            let destination = parent.appendingPathComponent("occupied-Ω", isDirectory: true)
            for url in [source, destination] {
                try LocalFilePermissions.createDirectoryWithoutParents(at: url, fileManager: .default)
            }
            try Data("source".utf8).write(to: source.appendingPathComponent("source.txt"))
            try Data("occupied".utf8).write(to: destination.appendingPathComponent("occupied.txt"))
            XCTAssertThrowsError(try LocalFilePermissions.moveRestoreItem(at: source, to: destination))
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: source.path), ["source.txt"])
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: destination.path), ["occupied.txt"])
        }
    }

    func testMissingLongSourceDoesNotPublishDestination() throws {
        try withRoot { root in
            let parent = try directory(root, units: 240)
            let source = parent.appendingPathComponent("missing-Ω.txt")
            let destination = root.appendingPathComponent("destination.txt")
            XCTAssertThrowsError(try LocalFilePermissions.moveRestoreItem(at: source, to: destination))
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        }
    }

    #if os(Windows)
    func testInvalidLongWindowsNativeNameIsRejectedBeforeMove() throws {
        try withRoot { root in
            let parent = try directory(root, units: 240)
            let source = root.appendingPathComponent("source.txt")
            let destination = parent.appendingPathComponent("CON.txt")
            let bytes = Data("source remains".utf8); try bytes.write(to: source)
            XCTAssertGreaterThanOrEqual(renameNativeUnits(destination), 248)
            XCTAssertThrowsError(try LocalFilePermissions.moveRestoreItem(at: source, to: destination)) { error in
                XCTAssertEqual((error as NSError).code, CocoaError.fileWriteInvalidFileName.rawValue)
            }
            XCTAssertEqual(try Data(contentsOf: source), bytes)
        }
    }
    #endif

    func testShortRenameStillDispatchesInjectedFileManagerFailure() throws {
        try withRoot { root in
            let source = root.appendingPathComponent("source.txt"), destination = root.appendingPathComponent("destination.txt")
            let bytes = Data("unchanged".utf8); try bytes.write(to: source)
            let fm = RenameFailureFileManager()
            XCTAssertLessThan(max(renameNativeUnits(source), renameNativeUnits(destination)), 248)
            XCTAssertThrowsError(try LocalFilePermissions.moveRestoreItem(at: source, to: destination, fileManager: fm))
            XCTAssertEqual(fm.moves, 1)
            XCTAssertEqual(try Data(contentsOf: source), bytes)
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        }
    }

    private func lateFailure(collision: Bool) throws {
        try withRoot { root in
            let padding = 148 - renameNativeUnits(root) - 1
            XCTAssertGreaterThan(padding, 0)
            let support = root.appendingPathComponent(String(repeating: "s", count: max(0, padding)), isDirectory: true)
            let fm = CompletionFailureFileManager()
            let service = LiveLogbookMethods(fileManager: fm, supportDirectory: support, inheritNativePreferences: false)
            _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
            defer { try? service.openedDatabase().close() }
            XCTAssertEqual(renameNativeUnits(service.workspaceDirectoryURL), 178)
            try service.openedDatabase().save(QSO(call: "K1SELECTED", band: "20m", mode: "CW"))
            let referenceDirectory = try service.referenceDirectoryURL()
            let reference = referenceDirectory.appendingPathComponent("fixture.txt")
            try Data("selected reference".utf8).write(to: reference)
            let backup = try service.handle(method: "backup_create", params: ["name": "selected"])
            try service.openedDatabase().save(QSO(call: "K2CURRENT", band: "40m", mode: "CW"))
            try Data("current reference".utf8).write(to: reference)
            fm.failCompletion = true
            fm.occupyReferenceOnRollback = collision
            XCTAssertThrowsError(try service.handle(method: "backup_restore", params: ["name": backup["name"]!, "confirm_restore": true])) { error in
                if collision { XCTAssertEqual((error as? WorkerFailure)?.code, "restore_recovery_required") }
            }
            XCTAssertFalse(fm.failCompletion, "Restore must reach the injected late completion failure")
            let marker = service.workspaceDirectoryURL.appendingPathComponent(".restore-incomplete")
            if collision {
                XCTAssertTrue(fm.collisionCreated)
                XCTAssertTrue(fm.fileExists(atPath: marker.path))
                XCTAssertThrowsError(try service.openedDatabase())
                XCTAssertThrowsError(try LiveLogbookMethods(supportDirectory: support, inheritNativePreferences: false).openedDatabase())
                XCTAssertEqual(try Data(contentsOf: referenceDirectory.appendingPathComponent("collision.txt")), Data("occupied destination".utf8))
                let preserved = try XCTUnwrap(fm.contentsOfDirectory(at: service.workspaceDirectoryURL, includingPropertiesForKeys: nil)
                    .first { $0.lastPathComponent.hasPrefix("Reference Data-before-restore-") })
                XCTAssertEqual(try Data(contentsOf: preserved.appendingPathComponent("fixture.txt")), Data("current reference".utf8))
                let failed = try XCTUnwrap(fm.contentsOfDirectory(at: service.workspaceDirectoryURL, includingPropertiesForKeys: nil)
                    .first { $0.lastPathComponent.hasPrefix(".failed-restore-") && $0.lastPathComponent.hasSuffix("Reference Data") })
                XCTAssertEqual(try Data(contentsOf: failed.appendingPathComponent("fixture.txt")), Data("selected reference".utf8))
            } else {
                XCTAssertFalse(fm.fileExists(atPath: marker.path))
                XCTAssertEqual(try service.openedDatabase().count(), 2)
                XCTAssertEqual(try Data(contentsOf: reference), Data("current reference".utf8))
                XCTAssertEqual(try LiveLogbookMethods(supportDirectory: support, inheritNativePreferences: false).openedDatabase().count(), 2)
            }
        }
    }

    func testLongReferenceAndDatabaseRollbackAfterLateCompletionFailure() throws { try lateFailure(collision: false) }
    func testOccupiedNativeRollbackDestinationPreservesCopiesAndRecoveryBlock() throws { try lateFailure(collision: true) }
}
