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
    }
}

@Suite("Restore failure atomicity")
struct RestoreAtomicityTests {
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
