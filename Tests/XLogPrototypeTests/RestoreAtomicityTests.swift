import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

private final class RestoreFaultFileManager: FileManager, @unchecked Sendable {
    var failComponent: String?
    var failRollback = false
    var databasePublicationURL: URL?
    var afterDatabasePublication: (() throws -> Void)?
    override func removeItem(at url: URL) throws {
        if failComponent == "completion" && url.lastPathComponent == ".restore-incomplete" {
            failComponent = nil
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.removeItem(at: url)
    }
    override func moveItem(at source: URL, to destination: URL) throws {
        let prefix = failComponent == "Python" ? ".contest-restore-" : ".reference-restore-"
        if destination.lastPathComponent == failComponent && source.lastPathComponent.hasPrefix(prefix) {
            failComponent = nil
            throw CocoaError(.fileWriteNoPermission)
        }
        if failRollback && source.lastPathComponent.hasPrefix("OM0RX-xLog-before-restore-") {
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.moveItem(at: source, to: destination)
        if destination == databasePublicationURL, let publication = afterDatabasePublication {
            afterDatabasePublication = nil
            try publication()
        }
    }
}

@Suite("Restore failure atomicity")
struct RestoreAtomicityTests {
    @Test("The actual modern restore installs all components from one selected package snapshot")
    func replacedSourceAfterDatabasePublication() throws {
        let fm = RestoreFaultFileManager()
        let root = fm.temporaryDirectory.appendingPathComponent("modern-restore-snapshot-\(UUID())")
        defer { try? fm.removeItem(at: root) }
        let service = LiveLogbookMethods(fileManager: fm, supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        try service.openedDatabase().save(QSO(call: "K1SELECTED", band: "20m", mode: "CW"))
        let reference = try service.referenceDirectoryURL().appendingPathComponent("fixture.txt")
        try Data("selected-reference-A".utf8).write(to: reference)
        let contestURL = root.appendingPathComponent("Contesting/Python/fixture/contest.sqlite")
        var contest = try LogbookDatabase(url: contestURL)
        try contest.save(QSO(call: "K1SELECTED", band: "20m", mode: "CW"))
        contest.close()
        let selected = try service.handle(method: "backup_create", params: ["name": "selected"])
        let selectedName = try #require(selected["name"] as? String)
        let backups = service.workspaceDirectoryURL.appendingPathComponent("Backups")
        let selectedURL = backups.appendingPathComponent(selectedName)

        try service.openedDatabase().save(QSO(call: "K2REPLACEMENT", band: "40m", mode: "CW"))
        contest = try LogbookDatabase(url: contestURL)
        try contest.save(QSO(call: "K2REPLACEMENT", band: "40m", mode: "CW"))
        contest.close()
        try Data("replacement-reference-B".utf8).write(to: reference)
        let replacement = try service.handle(method: "backup_create", params: ["name": "replacement"])
        let replacementURL = backups.appendingPathComponent(try #require(replacement["name"] as? String))
        let retainedOriginal = root.appendingPathComponent("retained-selected.xlogbackup")
        fm.databasePublicationURL = service.workspaceDirectoryURL.appendingPathComponent("OM0RX-xLog.sqlite")
        fm.afterDatabasePublication = {
            try FileManager.default.moveItem(at: selectedURL, to: retainedOriginal)
            try FileManager.default.copyItem(at: replacementURL, to: selectedURL)
        }
        let result = try service.handle(method: "backup_restore", params: [
            "name": selectedName, "confirm_restore": true, "restore_preferences": true])
        #expect(result["restored"] as? Bool == true)
        #expect(fm.afterDatabasePublication == nil)
        #expect(try service.openedDatabase().fetchAll().map(\.call) == ["K1SELECTED"])
        #expect(try String(contentsOf: reference, encoding: .utf8) == "selected-reference-A")
        contest = try LogbookDatabase(url: contestURL)
        defer { contest.close() }
        #expect(try contest.fetchAll().map(\.call) == ["K1SELECTED"])
        let manager = XLogBackupManager()
        #expect(try manager.inspect(at: retainedOriginal).manifest.qsoCount == 1)
        #expect(try manager.inspect(at: replacementURL).manifest.qsoCount == 2)
        let recoveryName = try #require(result["recovery_backup"] as? String)
        #expect(try manager.inspect(at: service.workspaceDirectoryURL.appendingPathComponent("Recovery")
            .appendingPathComponent(recoveryName)).manifest.qsoCount == 2)
    }

    @Test("Later publication failures retain the complete original workspace", arguments: ["Python", "Reference Data", "completion"])
    func failedComponent(component: String) throws {
        let fm = RestoreFaultFileManager()
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let service = LiveLogbookMethods(fileManager: fm, supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        try service.openedDatabase().save(QSO(call: "K1OLD", band: "20m", mode: "CW"))
        let reference = try service.referenceDirectoryURL().appendingPathComponent("fixture.txt")
        try Data("backed up reference".utf8).write(to: reference)
        let contestURL = root.appendingPathComponent("Contesting/Python/fixture/contest.sqlite")
        var contest = try LogbookDatabase(url: contestURL)
        try contest.save(QSO(call: "K1OLD", band: "20m", mode: "CW"))
        contest.close()
        let backup = try service.handle(method: "backup_create", params: ["name": "baseline"])
        try service.openedDatabase().save(QSO(call: "K2NEW", band: "40m", mode: "CW"))
        contest = try LogbookDatabase(url: contestURL)
        try contest.save(QSO(call: "K2NEW", band: "40m", mode: "CW"))
        contest.close()
        try Data("current reference".utf8).write(to: reference)
        let beforePreferences = try service.handle(method: "workspace_preferences_load", params: [:])
        let oldGeneration = try #require(service.handle(method: "workspace_status", params: [:])["generation"] as? String)
        fm.failComponent = component
        #expect(throws: Error.self) {
            try service.handle(method: "backup_restore", params: ["name": backup["name"]!, "confirm_restore": true, "restore_preferences": true])
        }
        #expect(try service.openedDatabase().count() == 2)
        contest = try LogbookDatabase(url: contestURL)
        #expect(try contest.count() == 2)
        contest.close()
        #expect(try String(contentsOf: reference, encoding: .utf8) == "current reference")
        let afterPreferences = try service.handle(method: "workspace_preferences_load", params: [:])
        #expect(NSDictionary(dictionary: beforePreferences["preferences"] as! [String: Any])
            .isEqual(to: afterPreferences["preferences"] as! [String: Any]))
        #expect(try service.handle(method: "workspace_status", params: [:])["generation"] as? String != oldGeneration)
        #expect(try LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false).openedDatabase().count() == 2)
    }

    @Test("An unsuccessful rollback blocks this owner and subsequent launches")
    func failedRollback() throws {
        let fm = RestoreFaultFileManager()
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let service = LiveLogbookMethods(fileManager: fm, supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        try service.openedDatabase().save(QSO(call: "K1OLD", band: "20m", mode: "CW"))
        try fm.createDirectory(at: root.appendingPathComponent("Contesting/Python"), withIntermediateDirectories: true)
        let backup = try service.handle(method: "backup_create", params: ["name": "baseline"])
        fm.failComponent = "Python"
        fm.failRollback = true
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_restore", params: ["name": backup["name"]!, "confirm_restore": true])
        }
        #expect(throws: WorkerFailure.self) { try service.openedDatabase() }
        #expect(throws: WorkerFailure.self) {
            try LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false).openedDatabase()
        }
        #expect(fm.fileExists(atPath: root.appendingPathComponent("OM0RX-xLog-Integrated Preview/.restore-incomplete").path))
    }
}
