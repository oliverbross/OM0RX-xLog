import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Band-map guide workspace and backup ownership")
struct BandMapGuidePreferencesTests {
    @Test("Guide documents compare and swap atomically, reject malformed imports and restore with backups")
    func guideLifecycle() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let base = try service.handle(method: "workspace_preferences_load", params: [:])
        let original = base["preferences"] as! [String: Any]
        #expect(original["bandMapGuidesJSON"] as? String == "")
        let guide = ##"{"version":1,"custom":[{"version":1,"units":"Hz","id":"my-guide","name":"Portable","region":"Personal","origin":"custom","sourceURL":"https://example.invalid/source","reviewed":"2026-11-03","supportedBands":["20m"],"ranges":[{"startHz":14000000,"endHz":14070000,"color":"#12a88a","label":"CW"}],"markers":[{"frequencyHz":14025000,"label":"Personal","category":"personal"}]}],"desk":{"id":"my-guide","visible":true,"beacons":false},"detached":{"id":"builtin-r3-2024","visible":false,"beacons":true}}"##
        func patch(_ expected: String, _ next: String) throws -> [String: Any] {
            try service.handle(method: "workspace_band_map_apply", params: ["generation":base["generation"]!,"scope":"desk","expected":["guidesJSON":expected],"patch":["guidesJSON":next]])
        }
        #expect(try patch("", guide)["status"] as? String == "applied")
        #expect(try patch("", "")["status"] as? String == "conflict")
        let current = try service.handle(method: "workspace_preferences_load", params: [:])
        #expect((current["preferences"] as! [String: Any])["deskBandMapBands"] as? [String] == original["deskBandMapBands"] as? [String])
        #expect(throws: Error.self) { try patch(guide, guide.replacingOccurrences(of: "14070000", with: "13900000")) }
        #expect(try service.handle(method: "workspace_preferences_load", params: [:])["revision"] as? Int == current["revision"] as? Int)
        let backup = try service.handle(method: "backup_create", params: ["name":"guide-roundtrip"])
        _ = try patch(guide, "")
        let restore = try service.handle(method: "backup_restore", params: ["name":backup["name"]!,"confirm_restore":true,"restore_preferences":true])
        #expect(restore["preferences_restored"] as? Bool == true)
        let restored = try service.handle(method: "workspace_preferences_load", params: [:])
        #expect((restored["preferences"] as! [String: Any])["bandMapGuidesJSON"] as? String == guide)
        #expect(restored["generation"] as? String != base["generation"] as? String)
    }
}
