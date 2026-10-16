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

    @Test("Update replaces only the selected query, persists it and treats identical queries as no-ops")
    func updateQueryAndNoOp() throws {
        let (root, service) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        var current = try service.handle(method: "workspace_preferences_load", params: [:])
        current = try apply(service, current, action: "save", extra: ["name": "Worked", "query": "OM0RX"])
        current = try apply(service, current, action: "save", extra: ["name": "Other", "query": "SOTA"])
        var customPreferences = current["preferences"] as! [String: Any]
        customPreferences["deskBandMapBands"] = ["40m", "20m"]
        current = try service.handle(method: "workspace_preferences_save", params: ["preferences": customPreferences,
            "generation": current["generation"]!, "expectedRevision": current["revision"]!])
        var draft = try #require(service.handle(method: "logbook_draft", params: [:])["qso"] as? [String: Any])
        draft["call"] = "OM0RX"
        _ = try service.handle(method: "logbook_save", params: ["qso": draft])
        let contacts = try service.handle(method: "logbook_list", params: [:])
        var expectedPreferences = current["preferences"] as! [String: Any]
        expectedPreferences["savedLogbookFilters"] = [["name": "Other", "query": "SOTA"], ["name": "Worked", "query": "Pacific"]]

        let updated = try apply(service, current, action: "update", extra: ["source": "worked", "query": "Pacific"])
        #expect(updated["status"] as? String == "applied")
        #expect(updated["revision"] as? Int == (current["revision"] as! Int) + 1)
        #expect(updated["generation"] as? String == current["generation"] as? String)
        #expect(NSDictionary(dictionary: updated["preferences"] as! [String: Any]).isEqual(to: expectedPreferences))
        #expect(NSDictionary(dictionary: try service.handle(method: "logbook_list", params: [:])).isEqual(to: contacts))
        let unchanged = try apply(service, updated, action: "update", extra: ["source": "Worked", "query": "Pacific"])
        #expect(NSDictionary(dictionary: unchanged).isEqual(to: updated))

        try service.openedDatabase().close()
        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? reopened.openedDatabase().close() }
        let persisted = try reopened.handle(method: "workspace_preferences_load", params: [:])
        #expect(NSDictionary(dictionary: persisted["preferences"] as! [String: Any]).isEqual(to: expectedPreferences))
        #expect(persisted["revision"] as? Int == updated["revision"] as? Int)
    }

    @Test("Update works at the saved-filter cap without adding entries")
    func updateAtCap() throws {
        let (root, service) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        var current = try service.handle(method: "workspace_preferences_load", params: [:])
        for index in 0..<32 {
            current = try apply(service, current, action: "save", extra: ["name": "Filter \(index)", "query": "OM0RX"])
        }
        let updated = try apply(service, current, action: "update", extra: ["source": "Filter 0", "query": "Pacific"])
        var expected = (current["preferences"] as! [String: Any])["savedLogbookFilters"] as! [[String: String]]
        expected[0]["query"] = "Pacific"
        #expect((updated["preferences"] as! [String: Any])["savedLogbookFilters"] as? [[String: String]] == expected)
    }

    @Test("Update rejects invalid payloads and returns fresh evidence for stale fences without writing")
    func updateValidationAndFences() throws {
        let (root, service) = try fixture()
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let initial = try service.handle(method: "workspace_preferences_load", params: [:])
        let current = try apply(service, initial, action: "save", extra: ["name": "Worked", "query": "OM0RX"])
        let stable = try service.handle(method: "workspace_preferences_load", params: [:])
        for extra: [String: Any] in [
            ["source": "Missing", "query": "Pacific"], ["source": "Worked"], ["query": "Pacific"],
            ["source": "Worked", "query": "Pacific", "name": "Renamed"],
            ["source": "Worked", "query": "Pacific", "unexpected": true],
            ["source": "Worked", "query": ""], ["source": "Worked", "query": " leading"],
            ["source": "Worked", "query": "line\nbreak"], ["source": "Worked", "query": String(repeating: "x", count: 129)],
            ["source": "Worked", "query": 42],
        ] {
            #expect(throws: Error.self) { try apply(service, current, action: "update", extra: extra) }
        }
        for missing in ["generation", "expected"] {
            var params: [String: Any] = ["generation": current["generation"]!,
                "expected": (current["preferences"] as! [String: Any])["savedLogbookFilters"]!,
                "action": "update", "source": "Worked", "query": "Pacific"]
            params.removeValue(forKey: missing)
            #expect(throws: Error.self) { try service.handle(method: "workspace_logbook_filters_apply", params: params) }
        }
        let conflict = try apply(service, initial, action: "update", extra: ["source": "Worked", "query": "Pacific"])
        #expect(conflict["status"] as? String == "conflict")
        #expect(NSDictionary(dictionary: conflict["preferences"] as! [String: Any]).isEqual(to: stable["preferences"] as! [String: Any]))
        let changed = try apply(service, current, action: "update", extra: ["source": "Worked", "query": "Pacific", "generation": UUID().uuidString])
        #expect(changed["status"] as? String == "workspace_changed")
        #expect(NSDictionary(dictionary: try service.handle(method: "workspace_preferences_load", params: [:])).isEqual(to: stable))
    }
}
