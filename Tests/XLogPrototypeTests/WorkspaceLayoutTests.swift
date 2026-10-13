import Foundation
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

    @Test("Defaults enumerate every panel once, leave unconfigured equipment hidden and preserve docked/windowed choices")
    func defaultsAndValidation() throws {
        let defaults = WorkspaceLayoutDocument.defaults
        try defaults.validate()
        #expect(defaults.activePresetID == "traditional")
        #expect(defaults.presets.map(\.id) == ["traditional", "windowed"])
        #expect(defaults.presets.allSatisfy { $0.panels.count == WorkspacePanelID.allCases.count })
        #expect(defaults.presets.allSatisfy { $0.panels.first { $0.id == .rotor }?.placement == .hidden })
        #expect(defaults.presets[1].panels.allSatisfy { $0.placement != .canvas })
        #expect(WorkspacePanelID.allCases.contains(.logbook))
        #expect(WorkspacePanelID.allCases.contains(.settings))
        #expect(WorkspacePanelID.allCases.contains(.sync))
        // Every surface may be placed on the canvas; defaults are choices,
        // not a restriction to the old desk's fixed set of widgets.
        var canvas = defaults.presets[1]
        for index in canvas.panels.indices {
            canvas.panels[index].placement = .canvas
            canvas.panels[index].rect = WorkspaceRect(x: 0, y: 0, width: 640, height: 480)
        }
        try canvas.validate()
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
        } catch { try? await session.close(); throw error }
        try await session.close()
    }
}
