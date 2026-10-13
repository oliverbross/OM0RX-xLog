import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@discardableResult
func saveWorkspacePreferences(_ service: LiveLogbookMethods, _ preferences: [String: Any]) throws -> [String: Any] {
    let current = try service.handle(method: "workspace_preferences_load", params: [:])
    return try service.handle(method: "workspace_preferences_save", params: ["preferences": preferences,
        "generation": current["generation"]!, "expectedRevision": current["revision"]!])
}

@Suite("Generation-bound band map preference patches")
struct BandMapPreferencesTests {
    private func fixture() throws -> (URL, LiveLogbookMethods) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        return (root, service)
    }
    private func patch(_ service: LiveLogbookMethods, _ base: [String: Any], scope: String = "detached",
                       expected: [String: Any], patch: [String: Any]) throws -> [String: Any] {
        try service.handle(method: "workspace_band_map_apply", params: ["generation": base["generation"]!, "scope": scope,
            "expected": expected, "patch": patch])
    }
    @Test("Two scopes merge unrelated fields but stale same-field writes conflict")
    func independentScopes() throws {
        let (root, service) = try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let base = try service.handle(method: "workspace_preferences_load", params: [:])
        let preferences = base["preferences"] as! [String: Any]
        let child = try patch(service, base, expected: ["bands": preferences["detachedBandMapBands"]!], patch: ["bands": ["17m"]])
        #expect(child["status"] as? String == "applied")
        let desk = try patch(service, base, scope: "desk", expected: ["bands": preferences["deskBandMapBands"]!], patch: ["bands": ["40m"]])
        #expect(desk["status"] as? String == "applied")
        let current = desk["preferences"] as! [String: Any]
        #expect(current["detachedBandMapBands"] as? [String] == ["17m"])
        #expect(current["deskBandMapBands"] as? [String] == ["40m"])
        #expect(current["intelligenceBands"] as? [String] == preferences["intelligenceBands"] as? [String])
        #expect(try patch(service, base, expected: ["bands": preferences["detachedBandMapBands"]!], patch: ["bands": ["10m"]])["status"] as? String == "conflict")
        #expect(try service.handle(method: "workspace_preferences_save", params: ["preferences": preferences,
            "generation": base["generation"]!, "expectedRevision": base["revision"]!])["status"] as? String == "conflict")
        #expect(throws: Error.self) { try service.handle(method: "workspace_preferences_save", params: ["preferences": preferences]) }
    }
    @Test("Concurrent desk and detached callers preserve both scopes and unrelated preferences")
    func concurrentScopes() async throws {
        let (root, service) = try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let base = try service.handle(method: "workspace_preferences_load", params: [:])
        let generation = base["generation"] as! String, preferences = base["preferences"] as! [String: Any]
        let deskBands = preferences["deskBandMapBands"] as! [String], detachedBands = preferences["detachedBandMapBands"] as! [String]
        let statuses = try await withThrowingTaskGroup(of: String.self) { group in
            group.addTask {
                try service.handle(method: "workspace_band_map_apply", params: ["generation": generation, "scope": "desk",
                    "expected": ["bands": deskBands], "patch": ["bands": ["40m"]]])["status"] as! String
            }
            group.addTask {
                try service.handle(method: "workspace_band_map_apply", params: ["generation": generation, "scope": "detached",
                    "expected": ["bands": detachedBands], "patch": ["bands": ["17m"]]])["status"] as! String
            }
            var statuses: [String] = []; for try await status in group { statuses.append(status) }; return statuses
        }
        #expect(statuses == ["applied", "applied"])
        let current = try service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as! [String: Any]
        #expect(current["deskBandMapBands"] as? [String] == ["40m"])
        #expect(current["detachedBandMapBands"] as? [String] == ["17m"])
        #expect(current["intelligenceBands"] as? [String] == preferences["intelligenceBands"] as? [String])
        _ = try patch(service, base, expected: ["fontScale": 1], patch: ["fontScale": 1.2])
        #expect(try patch(service, base, scope: "desk", expected: ["fontScale": 1], patch: ["fontScale": 1.5])["status"] as? String == "conflict")
    }
    @Test("No-op and malformed patches never advance revisions or write unrelated fields")
    func validationAndNoop() throws {
        let (root, service) = try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let base = try service.handle(method: "workspace_preferences_load", params: [:])
        let noOp = try patch(service, base, expected: ["fontScale": 1], patch: ["fontScale": 1])
        #expect(noOp["revision"] as? Int == base["revision"] as? Int)
        for bad: [String: Any] in [["fontScale": true], ["fontScale": 4], ["fontScale": "1"], ["layout": "Single row"],
            ["bands": ["20m", "20m"]], ["modes": ["bogus"]], ["intelligenceBands": ["40m"]]] {
            #expect(throws: Error.self) { try patch(service, base, expected: bad, patch: bad) }
        }
        #expect(NSDictionary(dictionary: try service.handle(method: "workspace_preferences_load", params: [:])).isEqual(to: base))
    }
    @Test("Restore fences a delayed preference operation even with unchanged values")
    func restoreGeneration() throws {
        let (root, service) = try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let base = try service.handle(method: "workspace_preferences_load", params: [:])
        let backup = try service.handle(method: "backup_create", params: ["name": "map-baseline"])
        _ = try service.handle(method: "backup_restore", params: ["name": backup["name"]!, "confirm_restore": true])
        #expect(try patch(service, base, expected: ["fontScale": 1], patch: ["fontScale": 1.2])["status"] as? String == "workspace_changed")
        let context = try service.handle(method: "workspace_map_context", params: [:])
        #expect(context["generation"] as? String != base["generation"] as? String)
        #expect(context["dxccStatuses"] is [String: String])
    }
    @Test("Revision exhaustion is rejected before legacy full-save persistence")
    func exhaustion() throws {
        let (root, service) = try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        let defaults = try #require(workspace.makeDefaults())
        defaults.set(9_007_199_254_740_990, forKey: "OM0RX-xLog.workspacePreferencesRevision")
        let base = try service.handle(method: "workspace_preferences_load", params: [:])
        var changed = base["preferences"] as! [String: Any]; changed["bandMapFontScale"] = 1.5
        #expect(throws: Error.self) { try saveWorkspacePreferences(service, changed) }
        #expect(NSDictionary(dictionary: try service.handle(method: "workspace_preferences_load", params: [:])).isEqual(to: base))
        #expect(try patch(service, base, expected: ["fontScale": 1], patch: ["fontScale": 1])["revision"] as? Int == 9_007_199_254_740_990)
    }
}
