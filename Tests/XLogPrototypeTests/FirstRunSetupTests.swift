import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("First-run setup preservation")
struct FirstRunSetupTests {
    private func root() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("first-run-\(UUID().uuidString)")
    }

    @Test("Fresh identity is blank; profiles predating setup remain complete and unchanged")
    func legacyMigration() throws {
        #expect(XLogSettings.defaults.operatorCall.isEmpty)
        #expect(XLogSettings.defaults.stationCall.isEmpty)
        #expect(XLogSettings.defaults.gridSquare.isEmpty)
        #expect(XLogSettings.defaults.wavelogURL.isEmpty)
        var legacy = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(XLogSettings.defaults)) as? [String: Any])
        legacy.removeValue(forKey: "onboardingCompleted")
        legacy["showCWDecode"] = true // Retired setting must not break existing profiles.
        legacy["operatorCall"] = "K1ABC"
        legacy["stationCall"] = "K1ABC/P"
        legacy["gridSquare"] = "FN31PR"
        legacy["wavelogURL"] = "https://example.invalid/logbook"
        let decoded = try JSONDecoder().decode(XLogSettings.self, from: JSONSerialization.data(withJSONObject: legacy))
        #expect(decoded.onboardingCompleted)
        #expect(decoded.operatorCall == "K1ABC")
        #expect(decoded.stationCall == "K1ABC/P")
        #expect(decoded.gridSquare == "FN31PR")
        #expect(decoded.wavelogURL == "https://example.invalid/logbook")
    }

    @Test("Only an explicit fresh setup creates an incomplete marker; it survives restart")
    func incompleteSetupResume() throws {
        let directory = root()
        let service = LiveLogbookMethods(supportDirectory: directory, inheritNativePreferences: false)
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: directory) }
        #expect(try service.handle(method: "workspace_status", params: [:])["first_run_eligible"] as? Bool == true)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty", "onboarding": true])
        var settings = try #require(service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        #expect(settings["onboardingCompleted"] as? Bool == false)
        #expect(settings["operatorCall"] as? String == "")
        settings["operatorCall"] = "K1ABC"
        settings["stationCall"] = "K1ABC/P"
        _ = try service.saveSettingsForTest(settings)
        let resumed = LiveLogbookMethods(supportDirectory: directory, inheritNativePreferences: false)
        defer { try? resumed.openedDatabase().close() }
        #expect(try resumed.handle(method: "workspace_status", params: [:])["first_run_eligible"] as? Bool == false)
        let retained = try #require(resumed.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        #expect(retained["onboardingCompleted"] as? Bool == false)
        #expect(retained["operatorCall"] as? String == "K1ABC")
        settings["onboardingCompleted"] = true
        _ = try service.saveSettingsForTest(settings)
        let complete = try #require(resumed.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        #expect(complete["onboardingCompleted"] as? Bool == true)
        #expect(complete["stationCall"] as? String == "K1ABC/P")
        #expect(try service.openedDatabase().count() == 0)
    }

    @Test("Existing workspaces never enroll and existing native logs block first-run creation")
    func existingOperatorProtection() throws {
        let directory = root()
        let service = LiveLogbookMethods(supportDirectory: directory, inheritNativePreferences: false)
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: directory) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let settings = try #require(service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        #expect(settings["onboardingCompleted"] as? Bool == true)
        #expect(throws: (any Error).self) {
            try service.handle(method: "workspace_create", params: ["mode": "empty", "onboarding": true])
        }
        let oldDirectory = root()
        defer { try? FileManager.default.removeItem(at: oldDirectory) }
        let native = oldDirectory.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite")
        try FileManager.default.createDirectory(at: native.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = Data("retained native fixture".utf8)
        try original.write(to: native)
        let existing = LiveLogbookMethods(supportDirectory: oldDirectory, inheritNativePreferences: false)
        #expect(try existing.handle(method: "workspace_status", params: [:])["first_run_eligible"] as? Bool == false)
        #expect(throws: (any Error).self) {
            try existing.handle(method: "workspace_create", params: ["mode": "empty", "onboarding": true])
        }
        #expect(try Data(contentsOf: native) == original)
        #expect(try existing.handle(method: "workspace_status", params: [:])["workspace_exists"] as? Bool == false)
    }
}
