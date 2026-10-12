import Foundation
import Testing
@testable import XLogCore

@Suite("CW preference persistence")
struct CWProfileTests {
    private var macro: [String: Any] { ["id": 1, "label": "CQ", "text": "CQ DE {MYCALL} K", "color": "cyan", "shortcut": "F1", "enabled": true, "onDesk": true] }
    private func decode(_ profile: [String: Any]) throws -> CWProfile {
        try JSONDecoder().decode(CWProfile.self, from: JSONSerialization.data(withJSONObject: profile))
    }
    @Test func oldSettingsAndRoundTrip() throws {
        var settings = XLogSettings.defaults
        #expect(settings.cwProfile == nil)
        settings.cwProfile = try decode(["version": 1, "output": "winkeyer", "showOnDesk": true, "macros": [macro], "armed": true, "queue": ["CQ"]])
        let data = try JSONEncoder().encode(settings)
        let restored = try JSONDecoder().decode(XLogSettings.self, from: data)
        #expect(restored == settings)
        #expect(restored.cwProfile?.winkeyer.wpm == 20)
        let json = String(decoding: data, as: UTF8.self)
        #expect(!json.contains("armed")); #expect(!json.contains("queue"))
    }
    @Test func rejectsInvalidProfilesAndRawDeviceCommands() throws {
        for field in ["text", "shortcut", "color", "id"] {
            var value = macro
            value[field] = field == "text" ? "CQ\n\u{0A}" : field == "shortcut" ? "Cmd+Q" : field == "color" ? "red" : 21
            #expect(throws: (any Error).self) { try decode(["version": 1, "output": "radio", "showOnDesk": false, "macros": [value]]) }
        }
        #expect(throws: (any Error).self) { try decode(["version": 1, "output": "radio", "showOnDesk": false, "macros": [macro, macro]]) }
        var unknown = macro; unknown["text"] = "{PTT} CQ"
        #expect(throws: (any Error).self) { try decode(["version": 1, "output": "radio", "showOnDesk": false, "macros": [unknown]]) }
    }
}
