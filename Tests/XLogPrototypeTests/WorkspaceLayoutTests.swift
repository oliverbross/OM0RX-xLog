import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
@testable import XLogPrototypeSupport

@Suite("Shared portable workspace layouts")
struct WorkspaceLayoutTests {
    private func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("layout-test-\(UUID().uuidString)") }
    private func sql(_ url: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw LogbookDatabaseError.open("fixture") }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("fixture") }
    }
    private func activate(_ revision: Int64, _ id: String = "windowed") -> WorkspaceLayoutMutation {
        .init(expectedRevision: revision, action: .activatePreset, presetID: id)
    }
    private func load(_ service: LiveLogbookMethods) throws -> [String: Any] {
        try #require(service.handle(method: "workspace_layout_load", params: [:])["layout"] as? [String: Any])
    }
    private func apply(_ service: LiveLogbookMethods, _ snapshot: [String: Any], _ id: String) throws -> [String: Any] {
        try service.handle(method: "workspace_layout_apply", params: ["generation": snapshot["generation"]!,
            "expectedRevision": snapshot["revision"]!, "action": "activatePreset", "presetID": id])
    }

    private func legacyDocument(activeID: String = "operator-custom") -> WorkspaceLayoutDocument {
        var document = WorkspaceLayoutDocument.defaults
        document.version = 1
        for index in document.presets.indices {
            document.presets[index].panels.removeAll { $0.id == .spotHistory || $0.id == .monitor }
        }
        var custom = document.presets[0]
        custom.id = "operator-custom"; custom.name = "My DX desk"
        custom.width = 3072; custom.height = 1728; custom.locked = false; custom.snap = false
        custom.panels.reverse()
        for index in custom.panels.indices {
            custom.panels[index].placement = [.canvas, .window, .hidden][index % 3]
            custom.panels[index].rect = WorkspaceRect(x: Double(index * 16), y: Double(index * 8),
                                                      width: 700, height: 500)
            custom.panels[index].z = 10_000 - index
        }
        document.presets.append(custom)
        document.activePresetID = activeID
        return document
    }

    private func store(_ snapshot: WorkspaceLayoutSnapshot, at url: URL) throws -> Data {
        let data = try JSONEncoder().encode(snapshot)
        let hex = data.map { String(format: "%02x", $0) }.joined()
        try sql(url, "INSERT INTO xlog_workspace_layout(singleton,payload) VALUES(1,X'\(hex)') ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload;")
        return data
    }

    private func storedPayload(at url: URL) throws -> Data {
        var db: OpaquePointer?, statement: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw LogbookDatabaseError.open("fixture") }
        defer { sqlite3_close(db) }
        guard sqlite3_prepare_v2(db, "SELECT payload FROM xlog_workspace_layout WHERE singleton=1", -1, &statement, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("fixture") }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.sqlite("fixture") }
        return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
    }

    @Test("Defaults enumerate every panel once, leave unconfigured equipment hidden and preserve docked/windowed choices")
    func defaultsAndValidation() throws {
        let defaults = WorkspaceLayoutDocument.defaults
        try defaults.validate()
        #expect(defaults.activePresetID == "traditional")
        #expect(defaults.version == 2)
        #expect(defaults.presets.map(\.id) == ["traditional", "windowed"])
        #expect(defaults.presets.allSatisfy { $0.panels.count == WorkspacePanelID.allCases.count })
        #expect(defaults.presets.allSatisfy { $0.panels.first { $0.id == .rotor }?.placement == .hidden })
        #expect(defaults.presets[1].panels.allSatisfy { $0.placement != .canvas })
        #expect(WorkspacePanelID.allCases.contains(.logbook))
        #expect(WorkspacePanelID.allCases.contains(.settings))
        #expect(WorkspacePanelID.allCases.contains(.sync))
        #expect(WorkspacePanelID.allCases.count == 21)
        for preset in defaults.presets {
            for id in [WorkspacePanelID.spotHistory, .monitor] {
                #expect(preset.panels.first { $0.id == id }?.placement == .hidden)
                #expect(id.minimumSize.width == 640 && id.minimumSize.height == 480)
            }
        }
        // Every surface may be placed on the canvas; defaults are choices,
        // not a restriction to the old desk's fixed set of widgets.
        var canvas = defaults.presets[1]
        for index in canvas.panels.indices {
            canvas.panels[index].placement = .canvas
            canvas.panels[index].rect = WorkspaceRect(x: 0, y: 0, width: 640, height: 480)
        }
        try canvas.validate()
    }

    @Test("Version 1 migrates every old role and preset unchanged, regardless of active mode", arguments: ["traditional", "windowed", "operator-custom"])
    func legacyMigration(activeID: String) throws {
        let legacy = legacyDocument(activeID: activeID)
        let data = try JSONEncoder().encode(WorkspaceLayoutSnapshot(revision: 47, document: legacy))
        let upgraded = try JSONDecoder().decode(WorkspaceLayoutSnapshot.self, from: data)
        #expect(upgraded.revision == 47)
        #expect(upgraded.document.version == 2)
        #expect(upgraded.document.activePresetID == activeID)
        #expect(upgraded.document.presets.map(\.id) == legacy.presets.map(\.id))
        for (prior, current) in zip(legacy.presets, upgraded.document.presets) {
            var preserved = current
            preserved.panels.removeLast(2)
            #expect(preserved == prior)
            #expect(Array(current.panels.suffix(2)) == [
                WorkspacePanelLayout(id: .spotHistory, placement: .hidden, rect: .init(x: 0, y: 0, width: 640, height: 480), z: 19),
                WorkspacePanelLayout(id: .monitor, placement: .hidden, rect: .init(x: 0, y: 0, width: 640, height: 480), z: 20)
            ])
        }
        #expect(try upgraded.document.migratedToCurrentVersion() == upgraded.document)
        #expect(try JSONDecoder().decode(WorkspaceLayoutSnapshot.self, from: JSONEncoder().encode(upgraded)) == upgraded)
    }

    @Test("Malformed and future documents cannot use legacy migration to evade validation")
    func invalidLegacyMigration() throws {
        let legacy = legacyDocument()
        var invalid: [WorkspaceLayoutDocument] = []
        var next = legacy; next.version = 3; invalid.append(next)
        next = legacy; next.version = 0; invalid.append(next)
        next = legacy; next.presets[0].panels.removeLast(); invalid.append(next)
        next = legacy; next.presets[0].panels[1] = next.presets[0].panels[0]; invalid.append(next)
        next = legacy; next.presets[0].panels[0].id = .monitor; invalid.append(next)
        next = WorkspaceLayoutDocument.defaults; next.version = 1; invalid.append(next)
        next = legacy; next.presets[0].panels[0].rect.width = 1; invalid.append(next)
        next = legacy; next.activePresetID = "missing"; invalid.append(next)
        next = legacy; next.presets[0].name = "\n"; invalid.append(next)
        next = legacy; next.presets[0].panels[0].rect.x = 16_384; invalid.append(next)
        for value in invalid {
            let data = try JSONEncoder().encode(value)
            #expect(throws: Error.self) { try JSONDecoder().decode(WorkspaceLayoutDocument.self, from: data) }
        }
    }

    @Test("Reading old database layouts leaves bytes and revision intact; CAS edits persist the upgrade")
    func legacyDatabaseMigration() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        defer { db.close() }
        let legacy = WorkspaceLayoutSnapshot(revision: 47, document: legacyDocument())
        let bytes = try store(legacy, at: url)
        let read = try db.workspaceLayout()
        #expect(read.revision == 47 && read.document.version == 2)
        #expect(try storedPayload(at: url) == bytes)
        #expect(throws: WorkspaceLayoutError.self) { try db.applyWorkspaceLayout(activate(46)) }
        #expect(try storedPayload(at: url) == bytes)
        let edited = try db.applyWorkspaceLayout(activate(47))
        #expect(edited.revision == 48 && edited.document.activePresetID == "windowed")
        #expect(edited.document.presets == read.document.presets)
        #expect(try JSONDecoder().decode(WorkspaceLayoutSnapshot.self, from: storedPayload(at: url)) == edited)
        #expect(try storedPayload(at: url) != bytes)
        var current = edited
        for id in [WorkspacePanelID.spotHistory, .monitor] {
            var panel = try #require(current.document.presets[1].panels.first { $0.id == id })
            panel.placement = id == .monitor ? .window : .canvas
            panel.rect = .init(x: 40, y: 32, width: 700, height: 500)
            current = try db.applyWorkspaceLayout(.init(expectedRevision: current.revision, action: .placePanel,
                                                       presetID: "windowed", panel: panel))
        }
        db.close()
        let reopened = try LogbookDatabase(url: url); defer { reopened.close() }
        #expect(try reopened.workspaceLayout() == current)
        #expect(current.revision == 50)
    }

    @Test("Old layout backups upgrade during opted-in restore and contact-only restore retains current roles")
    func legacyBackupMigration() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        defer { try? service.openedDatabase().close() }
        let legacy = WorkspaceLayoutSnapshot(revision: 47, document: legacyDocument())
        let originalDB = try service.openedDatabase()
        let bytes = try store(legacy, at: originalDB.url)
        _ = try originalDB.applyWorkspaceLayout(activate(0), scope: .contesting)
        let before = try load(service)
        let name = try #require(service.handle(method: "backup_create", params: ["name": "legacy-layout"])["name"] as? String)
        #expect(try storedPayload(at: originalDB.url) == bytes)
        _ = try apply(service, before, "traditional")
        _ = try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
                    "restore_settings": false, "restore_preferences": true, "restore_reference_data": false])
        let restored = try load(service)
        #expect(restored["revision"] as? Int == 47)
        #expect((restored["document"] as? [String: Any])?["version"] as? Int == 2)
        #expect((restored["document"] as? [String: Any])?["activePresetID"] as? String == "operator-custom")
        #expect(try service.openedDatabase().workspaceLayout().document == legacy.document.migratedToCurrentVersion())
        #expect(try service.openedDatabase().workspaceLayout(scope: .contesting).document.activePresetID == "windowed")
        #expect(try apply(service, before, "windowed")["status"] as? String == "workspace_changed")
        _ = try apply(service, restored, "windowed")
        let retained = try service.openedDatabase().workspaceLayout()
        let restoredContest = try service.openedDatabase().workspaceLayout(scope: .contesting)
        let retainedContest = try service.openedDatabase().applyWorkspaceLayout(
            activate(restoredContest.revision, "traditional"), scope: .contesting)
        _ = try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
                    "restore_settings": false, "restore_preferences": false, "restore_reference_data": false])
        #expect(try service.openedDatabase().workspaceLayout() == retained)
        #expect(try service.openedDatabase().workspaceLayout(scope: .contesting) == retainedContest)
    }

    @Test("Acknowledged scoped edits survive reopening without replacing unrelated presets or contacts")
    func persistence() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        let before = try db.workspaceLayout()
        var panel = try #require(before.document.presets[0].panels.first { $0.id == .worldMap })
        panel.placement = .window
        let after = try db.applyWorkspaceLayout(.init(expectedRevision: 0, action: .placePanel, presetID: "traditional", panel: panel))
        #expect(after.revision == 1)
        #expect(after.document.presets[1] == before.document.presets[1])
        #expect(try db.count() == 0)
        db.close()
        let reopened = try LogbookDatabase(url: url); defer { reopened.close() }
        #expect(try reopened.workspaceLayout() == after)
        do { _ = try reopened.applyWorkspaceLayout(activate(0)); Issue.record("Stale layout accepted") }
        catch WorkspaceLayoutError.conflict(let current) { #expect(current == after) }
        #expect(try reopened.workspaceLayout() == after)
    }

    @Test("Contesting layouts have a separate persisted scope while Normal defaults remain byte compatible")
    func moduleScopedPersistence() throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let digest = SHA256.hash(data: try encoder.encode(WorkspaceLayoutDocument.defaults))
            .map { String(format: "%02x", $0) }.joined()
        // Fixed from the canonical Normal-layout JSON before module scoping (e64e5e1).
        #expect(digest == "f5f00ad3f7c6a502de068420965519584ae7a6ff55c8bd1fc2c5418d6389a878")
        #expect(try encoder.encode(WorkspaceLayoutDocument.defaults) ==
                encoder.encode(WorkspaceLayoutDocument.defaults(for: .normalLogging)))
        let contestDefaults = WorkspaceLayoutDocument.defaults(for: .contesting)
        #expect(contestDefaults.presets[0].panels.first { $0.id == .logbook }?.placement == .canvas)
        #expect(contestDefaults.presets[0].panels.first { $0.id == .bandMaps }?.placement == .canvas)

        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        let normal = try db.workspaceLayout(), contest = try db.workspaceLayout(scope: .contesting)
        #expect(normal.document == .defaults)
        #expect(contest.document == contestDefaults)
        let changed = try db.applyWorkspaceLayout(activate(0), scope: .contesting)
        #expect(changed.revision == 1)
        #expect(try db.workspaceLayout() == normal)
        db.close()

        let reopened = try LogbookDatabase(url: url); defer { reopened.close() }
        #expect(try reopened.workspaceLayout() == normal)
        #expect(try reopened.workspaceLayout(scope: .contesting) == changed)
    }

    @Test("Application mode and the exact Canvas layout survive reopening without rewriting panels")
    func modePersistence() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        let original = try db.workspaceLayout()
        var custom = original.document.presets[0]; custom.id = "my-desk"; custom.name = "My desk"
        _ = try db.applyWorkspaceLayout(.init(expectedRevision: 0, action: .savePreset, presetID: custom.id, preset: custom))
        _ = try db.applyWorkspaceLayout(activate(1, custom.id))
        let windows = try db.applyWorkspaceLayout(activate(2))
        #expect(windows.document.lastCanvasPresetID == custom.id)
        db.close()
        let reopened = try LogbookDatabase(url: url); defer { reopened.close() }
        let saved = try reopened.workspaceLayout()
        #expect(saved == windows)
        let canvas = try reopened.applyWorkspaceLayout(activate(3, try #require(saved.document.lastCanvasPresetID)))
        #expect(canvas.document.activePresetID == custom.id)
        #expect(canvas.document.presets == windows.document.presets)
        let legacy = try JSONDecoder().decode(WorkspaceLayoutDocument.self, from: JSONEncoder().encode(original.document))
        #expect(legacy.lastCanvasPresetID == nil)
    }

    @Test("Concurrent windows cannot both commit the same layout revision")
    func concurrentWrites() async throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite")
        let first = try LogbookDatabase(url: url), second = try LogbookDatabase(url: url)
        defer { first.close(); second.close() }
        let mutation = activate(0)
        let outcomes = try await withThrowingTaskGroup(of: Bool.self) { group in
            for index in 0..<8 {
                let db = index.isMultiple(of: 2) ? first : second
                group.addTask {
                    do { _ = try db.applyWorkspaceLayout(mutation); return true }
                    catch WorkspaceLayoutError.conflict { return false }
                }
            }
            var outcomes: [Bool] = []
            for try await value in group { outcomes.append(value) }
            return outcomes
        }
        #expect(outcomes.filter { $0 }.count == 1)
        #expect(try first.workspaceLayout().revision == 1)
    }

    @Test("Databases from before layout support gain defaults without changing their contacts")
    func olderDatabase() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), original = try LogbookDatabase(url: url)
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW")
        try original.save(qso); original.close()
        try sql(url, "DROP TABLE xlog_workspace_layout;")
        let upgraded = try LogbookDatabase(url: url); defer { upgraded.close() }
        #expect(try upgraded.workspaceLayout().document == .defaults)
        #expect(try upgraded.count() == 1)
        #expect(try upgraded.lookup(localID: qso.id)?.call == "K1ABC")
        #expect(try upgraded.applyWorkspaceLayout(activate(0)).revision == 1)
    }

    @Test("Invalid bounds, identities and duplicate panels fail closed")
    func invalidLayouts() throws {
        let base = WorkspaceLayoutDocument.defaults.presets[0]
        var variants = [WorkspaceLayoutPreset]()
        var next = base; next.panels[0].rect.width = .nan; variants.append(next)
        next = base; next.panels[0].rect.x = -1; variants.append(next)
        next = base; next.panels[0].rect.width = 100; variants.append(next)
        next = base; next.panels[0].rect.x = 1900; variants.append(next)
        next = base; next.panels[1] = next.panels[0]; variants.append(next)
        next = base; next.panels.removeLast(); variants.append(next)
        next = base; next.width = 100_000; variants.append(next)
        next = base; next.name = "\n"; variants.append(next)
        next = base; next.id = "../escape"; variants.append(next)
        next = base; next.panels[0].z = -1; variants.append(next)
        for value in variants { #expect(throws: WorkspaceLayoutError.self) { try value.validate() } }
        let unknown = #"{"id":"unknown","placement":"canvas","rect":{"x":0,"y":0,"width":640,"height":480},"z":0}"#
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(WorkspacePanelLayout.self, from: Data(unknown.utf8)) }
    }

    @Test("Named presets are bounded; active and last presets cannot be removed")
    func namedPresets() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite")); defer { db.close() }
        var snapshot = try db.workspaceLayout()
        for index in 0..<10 {
            var preset = snapshot.document.presets[0]; preset.id = "layout-\(index)"; preset.name = "Layout \(index)"
            snapshot = try db.applyWorkspaceLayout(.init(expectedRevision: snapshot.revision, action: .savePreset, presetID: preset.id, preset: preset))
        }
        var excess = snapshot.document.presets[0]; excess.id = "excess"
        #expect(throws: WorkspaceLayoutError.self) { try db.applyWorkspaceLayout(.init(expectedRevision: snapshot.revision, action: .savePreset, presetID: excess.id, preset: excess)) }
        #expect(throws: WorkspaceLayoutError.self) { try db.applyWorkspaceLayout(.init(expectedRevision: snapshot.revision, action: .deletePreset, presetID: "traditional")) }
        snapshot = try db.applyWorkspaceLayout(.init(expectedRevision: snapshot.revision, action: .deletePreset, presetID: "layout-0"))
        #expect(snapshot.document.presets.count == 11)
        #expect(throws: WorkspaceLayoutError.self) { try db.applyWorkspaceLayout(activate(snapshot.revision, "missing")) }
    }

    @Test("Disk-write failure rolls back layout; corrupt stored data is never silently reset")
    func rollbackAndCorruption() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url); defer { db.close() }
        try sql(url, "CREATE TRIGGER fail_layout BEFORE INSERT ON xlog_workspace_layout BEGIN SELECT RAISE(ABORT,'fixture'); END;")
        #expect(throws: LogbookDatabaseError.self) { try db.applyWorkspaceLayout(activate(0)) }
        #expect(try db.workspaceLayout().revision == 0)
        try sql(url, "DROP TRIGGER fail_layout;")
        _ = try db.applyWorkspaceLayout(activate(0))
        try sql(url, "UPDATE xlog_workspace_layout SET payload = X'7B7D';")
        #expect(throws: Error.self) { try db.workspaceLayout() }
        #expect(throws: Error.self) { try db.applyWorkspaceLayout(activate(1)) }
    }

    @Test("Backups restore layout content and generation fences reject pre-restore edits")
    func backupAndRestore() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        defer { try? service.openedDatabase().close() }
        let original = try load(service)
        // A backup from before first layout persistence retains compatible defaults.
        let baselineName = try #require(service.handle(method: "backup_create", params: ["name": "before-layout"])["name"] as? String)
        #expect(try apply(service, original, "windowed")["status"] as? String == "applied")
        let saved = try load(service)
        let name = try #require(service.handle(method: "backup_create", params: ["name": "layout"])["name"] as? String)
        #expect(try apply(service, saved, "traditional")["status"] as? String == "applied")
        _ = try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
                    "restore_settings": false, "restore_preferences": true, "restore_reference_data": false])
        let restored = try load(service)
        #expect(restored["revision"] as? Int == 1)
        #expect((restored["document"] as? [String: Any])?["activePresetID"] as? String == "windowed")
        #expect(restored["generation"] as? String != saved["generation"] as? String)
        #expect(try apply(service, saved, "traditional")["status"] as? String == "workspace_changed")
        _ = try service.handle(method: "backup_restore", params: ["name": baselineName, "confirm_restore": true,
                    "restore_settings": false, "restore_preferences": true, "restore_reference_data": false])
        #expect(try load(service)["revision"] as? Int == 0)
        let baseline = try load(service)
        _ = try apply(service, baseline, "windowed")
        _ = try service.handle(method: "backup_restore", params: ["name": baselineName, "confirm_restore": true,
                    "restore_settings": false, "restore_preferences": false, "restore_reference_data": false])
        #expect((try load(service)["document"] as? [String: Any])?["activePresetID"] as? String == "windowed")
    }

    @Test("Repeated rapid restores preserve distinct database and reference recovery copies")
    func recoveryNamesDoNotCollide() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        defer { try? service.openedDatabase().close() }
        let reference = try service.referenceDirectoryURL()
        try Data("fixture reference".utf8).write(to: reference.appendingPathComponent("fixture.txt"))
        let name = try #require(service.handle(method: "backup_create", params: ["name": "repeated"])["name"] as? String)
        for _ in 0..<4 {
            _ = try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true,
                        "restore_settings": false, "restore_reference_data": true])
        }
        let entries = try FileManager.default.contentsOfDirectory(at: service.workspaceDirectoryURL, includingPropertiesForKeys: nil)
        #expect(entries.filter { $0.lastPathComponent.hasPrefix("OM0RX-xLog-before-restore-") }.count == 4)
        let references = entries.filter { $0.lastPathComponent.hasPrefix("Reference Data-before-restore-") }
        #expect(references.count == 4)
        for entry in references { #expect(try String(contentsOf: entry.appendingPathComponent("fixture.txt"), encoding: .utf8) == "fixture reference") }
    }

    @Test("Worker endpoints preserve other preferences and require a valid workspace generation")
    func serviceBoundary() throws {
        let root = root(); defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        #expect(throws: Error.self) { try service.handle(method: "workspace_layout_load", params: [:]) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        defer { try? service.openedDatabase().close() }
        let preferences = try service.handle(method: "workspace_preferences_load", params: [:])
        let before = try load(service)
        let contest = try #require(service.handle(method: "workspace_layout_load", params: ["scope": "contesting"])["layout"] as? [String: Any])
        #expect(before["scope"] == nil)
        #expect(contest["scope"] as? String == "contesting")
        let staleContest = try service.handle(method: "workspace_layout_apply", params: ["scope": "contesting",
            "generation": UUID().uuidString, "expectedRevision": contest["revision"]!,
            "action": "activatePreset", "presetID": "windowed"])
        #expect(staleContest["status"] as? String == "workspace_changed")
        #expect(staleContest["scope"] as? String == "contesting")
        #expect(try apply(service, before, "windowed")["status"] as? String == "applied")
        #expect(try apply(service, before, "traditional")["status"] as? String == "conflict")
        #expect(NSDictionary(dictionary: try service.handle(method: "workspace_preferences_load", params: [:])).isEqual(to: preferences))
        for generation: Any in [true, "invalid", NSNull()] {
            #expect(throws: Error.self) { try service.handle(method: "workspace_layout_apply", params: ["generation": generation,
                "expectedRevision": 1, "action": "activatePreset", "presetID": "traditional"]) }
        }
        #expect(throws: Error.self) { try service.handle(method: "workspace_layout_apply", params: ["generation": before["generation"]!,
            "expectedRevision": true, "action": "activatePreset", "presetID": "traditional"]) }
        #expect(try service.openedDatabase().count() == 0)
    }

    @Test("The isolated worker routes only local layout reads and revision-checked edits")
    func workerRoute() async throws {
        let session = try LocalAcceptanceSession()
        func request(_ method: String, _ params: [String: Any]) async throws -> [String: Any] {
            let input = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method, "params": params])
            let output = await session.worker.response(to: input)
            return try #require(JSONSerialization.jsonObject(with: output) as? [String: Any])
        }
        do {
            #expect(try await request("workspace_create", ["mode": "empty"])["ok"] as? Bool == true)
            let response = try await request("workspace_layout_load", [:])
            let snapshot = try #require((response["result"] as? [String: Any])?["layout"] as? [String: Any])
            let result = try await request("workspace_layout_apply", ["generation": snapshot["generation"]!,
                "expectedRevision": snapshot["revision"]!, "action": "activatePreset", "presetID": "windowed"])
            #expect(result["ok"] as? Bool == true)
            #expect((result["result"] as? [String: Any])?["status"] as? String == "applied")
            let contest = try await request("workspace_layout_load", ["scope": "contesting"])
            let contestSnapshot = try #require((contest["result"] as? [String: Any])?["layout"] as? [String: Any])
            #expect(contestSnapshot["revision"] as? Int == 0)
            #expect(snapshot["scope"] == nil)
            #expect(contestSnapshot["scope"] as? String == "contesting")
            #expect(try await request("workspace_layout_load", ["scope": "unknown"])["ok"] as? Bool == false)
        } catch { try? await session.close(); throw error }
        try await session.close()
    }
}
