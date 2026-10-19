import Foundation
import SQLite3
import Testing
@testable import XLogCore

@Suite("Isolated integration workspace")
struct IntegrationWorkspaceTests {
    @Test("Consistent copy retains QSO and outbox state without sharing writes")
    func snapshotAndIsolation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let sourceURL = root.appendingPathComponent("native.sqlite")
        let source = try LogbookDatabase(url: sourceURL)
        let qso = QSO(call: "VK4JAZ", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "CW")
        try source.save(qso)
        try source.recordSyncFailure(localID: qso.id, message: "offline")

        let workspaceURL = root.appendingPathComponent("Integrated Preview")
        let workspace = try IntegrationWorkspaceBootstrap.create(sourceDatabaseURL: sourceURL, at: workspaceURL)
        #expect(workspace.qsoCount == 1)
        #expect(workspace.pendingSyncCount == 1)
        #expect(workspace.outboxCount == 1)
        #expect(workspace.databaseURL != sourceURL)
        #expect(workspace.defaultsSuiteName != SecretStore.service)
        #expect(workspace.keychainService != SecretStore.service)
        #expect(IntegrationWorkspace.safeSettings().automaticSync == false)
        #expect(workspace.makeDefaults() != nil)

        let copy = try LogbookDatabase(url: workspace.databaseURL)
        #expect(try copy.fetch().first?.call == "VK4JAZ")
        #expect(try copy.outboxEntries().first?.attemptCount == 1)
        try copy.save(QSO(call: "K1ABC", start: Date(), band: "40m", mode: "SSB"))
        #expect(try copy.fetch().count == 2)
        #expect(try source.fetch().count == 1)
        #expect(try source.outboxEntries().first?.attemptCount == 1)
        let reopened = try IntegrationWorkspaceBootstrap.open(at: workspaceURL)
        #expect(reopened.defaultsSuiteName == workspace.defaultsSuiteName)
        #expect(reopened.qsoCount == 2)

        let permissions = try FileManager.default.attributesOfItem(atPath: workspace.databaseURL.path)
        #expect((permissions[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        #expect(throws: IntegrationWorkspaceError.self) {
            try IntegrationWorkspaceBootstrap.create(sourceDatabaseURL: sourceURL, at: workspaceURL)
        }
        #expect(try copy.fetch().count == 2)
    }

    @Test("Empty workspace has its own database and disabled sync settings")
    func emptyWorkspace() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = try IntegrationWorkspaceBootstrap.createEmpty(at: root.appendingPathComponent("empty"))
        #expect(workspace.qsoCount == 0)
        #expect(workspace.pendingSyncCount == 0)
        #expect(workspace.outboxCount == 0)
        #expect(IntegrationWorkspace.safeSettings(from: XLogSettings.defaults).automaticSync == false)
        #expect(try IntegrationWorkspaceBootstrap.open(at: workspace.directoryURL).qsoCount == 0)
    }

    @Test("Reopen materializes missing WAL sidecars without changing contacts")
    func reopenAfterWALSidecarsWereRemoved() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = try IntegrationWorkspaceBootstrap.createEmpty(at: root.appendingPathComponent("preview"))
        let database = try LogbookDatabase(url: workspace.databaseURL)
        try database.save(QSO(call: "VK4JAZ", start: Date(timeIntervalSince1970: 1_700_000_000),
                              band: "20m", mode: "CW"))
        database.close()
        for suffix in ["-wal", "-shm"] {
            let sidecar = URL(fileURLWithPath: workspace.databaseURL.path + suffix)
            if FileManager.default.fileExists(atPath: sidecar.path) {
                try FileManager.default.removeItem(at: sidecar)
            }
            #expect(!FileManager.default.fileExists(atPath: sidecar.path))
        }

        let reopened = try IntegrationWorkspaceBootstrap.open(at: workspace.directoryURL)
        #expect(reopened.qsoCount == 1)
        let retained = try LogbookDatabase(url: workspace.databaseURL)
        defer { retained.close() }
        #expect(try retained.fetch().map(\.call) == ["VK4JAZ"])
    }

    @Test("Import is atomic and preserves full fields while skipping semantic duplicates")
    func importTransaction() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("test.sqlite"))
        var handle: OpaquePointer?
        #expect(sqlite3_open(db.url.path, &handle) == SQLITE_OK)
        defer { sqlite3_close(handle) }
        #expect(sqlite3_exec(handle, "CREATE TRIGGER fail_bad BEFORE INSERT ON qsos WHEN NEW.call = 'BAD' BEGIN SELECT RAISE(ABORT, 'forced'); END;", nil, nil, nil) == SQLITE_OK)
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let good = QSO(call: "GOOD", start: start, band: "20m", mode: "CW", comment: "preserved",
                       extraFields: ["APP_TEST": "custom"])
        let bad = QSO(call: "BAD", start: start, band: "40m", mode: "CW")
        #expect(throws: Error.self) { try db.importBatch([good, bad]) }
        #expect(try db.count() == 0)
        #expect(sqlite3_exec(handle, "DROP TRIGGER fail_bad", nil, nil, nil) == SQLITE_OK)
        let duplicate = QSO(call: "GOOD", start: start, band: "20m", mode: "CW")
        #expect(try db.importBatch([good, duplicate]) == 1)
        #expect(try db.count() == 1)
        let restored = try #require(db.fetch().first)
        #expect(restored.comment == "preserved")
        #expect(restored.extraFields["APP_TEST"] == "custom")
    }

    @Test("SQL offset can reach records beyond ten thousand")
    func largePaging() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("test.sqlite"))
        let qso = QSO(call: "TEST", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "CW")
        let hex = try JSONEncoder().encode(qso).map { String(format: "%02x", $0) }.joined()
        var handle: OpaquePointer?
        #expect(sqlite3_open(db.url.path, &handle) == SQLITE_OK)
        defer { sqlite3_close(handle) }
        let insert = """
        WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
        INSERT INTO qsos(local_id,wavelog_id,call,qso_start,band,mode,frequency_hz,is_dirty,deleted_at,updated_at,record_json,baseline_json)
        SELECT printf('page-%d',n),NULL,'TEST',n,'20m','CW',NULL,0,NULL,n,x'\(hex)',NULL FROM seq;
        """
        #expect(sqlite3_exec(handle, insert, nil, nil, nil) == SQLITE_OK)
        #expect(try db.count() == 10_001)
        #expect(try db.fetch(limit: 1, offset: 10_000).count == 1)
        #expect(try db.fetch(limit: 1, offset: 10_001).isEmpty)
    }

    @Test("Missing and aliased sources cannot create a workspace")
    func rejectsUnsafeSource() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let sourceURL = root.appendingPathComponent("native.sqlite")
        let destination = root.appendingPathComponent("preview")
        #expect(throws: IntegrationWorkspaceError.sourceMissing) {
            try IntegrationWorkspaceBootstrap.create(sourceDatabaseURL: sourceURL, at: destination)
        }
        let database = try LogbookDatabase(url: sourceURL)
        database.close()
        let alias = root.appendingPathComponent("native-alias.sqlite")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: sourceURL)
        #expect(throws: IntegrationWorkspaceError.unsafePath) {
            try IntegrationWorkspaceBootstrap.create(sourceDatabaseURL: alias, at: destination)
        }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
    }

    @Test("Reopen rejects a database link and native preference identity")
    func rejectsTamperedWorkspace() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = try IntegrationWorkspaceBootstrap.createEmpty(at: root.appendingPathComponent("preview"))
        let original = workspace.databaseURL
        let parked = workspace.directoryURL.appendingPathComponent("parked.sqlite")
        try FileManager.default.moveItem(at: original, to: parked)
        try FileManager.default.createSymbolicLink(at: original, withDestinationURL: parked)
        #expect(throws: IntegrationWorkspaceError.unsafePath) {
            try IntegrationWorkspaceBootstrap.open(at: workspace.directoryURL)
        }
        try FileManager.default.removeItem(at: original)
        try FileManager.default.moveItem(at: parked, to: original)
        let metadataURL = workspace.directoryURL.appendingPathComponent("workspace.json")
        let unsafeMetadata = ["defaultsSuiteName": "com.oliverbross.OM0RXXLog",
                              "keychainService": "com.oliverbross.OM0RXXLog"]
        try JSONEncoder().encode(unsafeMetadata).write(to: metadataURL)
        #expect(throws: IntegrationWorkspaceError.unsafePath) {
            try IntegrationWorkspaceBootstrap.open(at: workspace.directoryURL)
        }
    }
}
