import Foundation
import Testing
@testable import XLogCore

@Suite("Logbook mode migration")
struct SettingsModeTests {
    @Test("Fresh settings stay local despite the example Wavelog URL")
    func freshDefaults() {
        #expect(XLogSettings.defaults.logbookMode == .local)
        #expect(IntegrationWorkspace.safeSettings().logbookMode == .local)
        #expect(IntegrationWorkspace.safeSettings().automaticSync == false)
    }

    @Test("Existing settings without a mode retain Wavelog behavior and round-trip explicitly")
    func legacyMigration() throws {
        let suite = "xlog-mode-test-" + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(XLogSettings.defaults)) as? [String: Any])
        object.removeValue(forKey: "logbookMode")
        object["wavelogStationID"] = 42
        object["stationCall"] = "TEST1"
        defaults.set(try JSONSerialization.data(withJSONObject: object), forKey: "OM0RX-xLog.settings.v1")
        let store = SettingsStore(defaults: defaults)
        let migrated = store.load()
        #expect(migrated.logbookMode == .wavelog)
        #expect(migrated.wavelogStationID == 42)
        #expect(migrated.stationCall == "TEST1")
        store.save(migrated)
        let saved = try #require(defaults.data(forKey: "OM0RX-xLog.settings.v1"))
        #expect(try JSONDecoder().decode(XLogSettings.self, from: saved).logbookMode == .wavelog)
        #expect((try JSONSerialization.jsonObject(with: saved) as? [String: Any])?["logbookMode"] as? String == "wavelog")
    }

    @Test("Unknown mode is rejected instead of silently changing sync behavior")
    func invalidMode() throws {
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(XLogSettings.defaults)) as? [String: Any])
        object["logbookMode"] = "automatic"
        let data = try JSONSerialization.data(withJSONObject: object)
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(XLogSettings.self, from: data) }
    }
}
