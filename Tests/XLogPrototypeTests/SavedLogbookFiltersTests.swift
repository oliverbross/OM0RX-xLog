import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Saved Logbook filters")
struct SavedLogbookFiltersTests {
    private func fixture() throws -> (URL, LiveLogbookMethods) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        return (root, service)
    }

    private func apply(_ service: LiveLogbookMethods, _ base: [String: Any], action: String,
                       extra: [String: Any]) throws -> [String: Any] {
        let preferences = base["preferences"] as! [String: Any]
        var params: [String: Any] = ["generation": base["generation"]!, "expected": preferences["savedLogbookFilters"]!, "action": action]
        for (key, value) in extra { params[key] = value }
        return try service.handle(method: "workspace_logbook_filters_apply", params: params)
    }

    @Test("Filters persist with their exact query and clone deterministically")
    func persistenceAndClone() throws {
        let (root, service) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var current = try service.handle(method: "workspace_preferences_load", params: [:])
        current = try apply(service, current, action: "save", extra: ["name": "Portable", "query": "SOTA/P"])
        current = try apply(service, current, action: "clone", extra: ["source": "Portable", "name": "Activation copy"])
        #expect(current["status"] as? String == "applied")
        let filters = (current["preferences"] as! [String: Any])["savedLogbookFilters"] as! [[String: String]]
        #expect(filters == [["name": "Activation copy", "query": "SOTA/P"], ["name": "Portable", "query": "SOTA/P"]])
        let backup = try service.handle(method: "backup_create", params: ["name": "saved-filters"])
        let package = service.workspaceDirectoryURL.appendingPathComponent("Backups")
            .appendingPathComponent(backup["name"] as! String)
        #expect(try #require(XLogBackupManager().inspect(at: package).preferences).savedLogbookFilters == [
            .init(name: "Activation copy", query: "SOTA/P"), .init(name: "Portable", query: "SOTA/P"),
        ])
        try service.openedDatabase().close()

        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? reopened.openedDatabase().close() }
        let persisted = try reopened.handle(method: "workspace_preferences_load", params: [:])
        #expect(((persisted["preferences"] as! [String: Any])["savedLogbookFilters"] as? [[String: String]]) == filters)
    }

    @Test("Invalid and duplicate names never change persistence")
    func invalidAndDuplicateNames() throws {
        let (root, service) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        var current = try service.handle(method: "workspace_preferences_load", params: [:])
        current = try apply(service, current, action: "save", extra: ["name": "Worked", "query": "OM0RX"])
        let stable = try service.handle(method: "workspace_preferences_load", params: [:])
        for name in ["", " leading", "trailing ", "line\nbreak", String(repeating: "x", count: 49), "worked"] {
            #expect(throws: Error.self) {
                try apply(service, current, action: "save", extra: ["name": name, "query": "OM0RX"])
            }
        }
        #expect(throws: Error.self) {
            try apply(service, current, action: "save", extra: ["name": "Empty search", "query": ""])
        }
        let after = try service.handle(method: "workspace_preferences_load", params: [:])
        #expect(NSDictionary(dictionary: after).isEqual(to: stable))
    }

    @Test("Rename and delete preserve unrelated workspace preferences and stale lists conflict")
    func renameDeleteAndConflict() throws {
        let (root, service) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let initial = try service.handle(method: "workspace_preferences_load", params: [:])
        var current = try apply(service, initial, action: "save", extra: ["name": "DX", "query": "Pacific"])
        current = try apply(service, current, action: "rename", extra: ["source": "DX", "name": "Pacific DX"])
        let preferences = current["preferences"] as! [String: Any]
        #expect(preferences["deskBandMapBands"] as? [String] == ["20m"])
        #expect((preferences["savedLogbookFilters"] as? [[String: String]]) == [["name": "Pacific DX", "query": "Pacific"]])
        #expect(try apply(service, initial, action: "save", extra: ["name": "Stale", "query": "W1AW"])["status"] as? String == "conflict")
        current = try apply(service, current, action: "delete", extra: ["source": "Pacific DX"])
        #expect(((current["preferences"] as! [String: Any])["savedLogbookFilters"] as? [[String: String]]) == [])
    }
}
