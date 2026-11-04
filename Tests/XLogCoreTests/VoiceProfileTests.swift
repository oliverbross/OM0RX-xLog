import Foundation
import XCTest
@testable import XLogCore

final class VoiceProfileTests: XCTestCase {
    private func profile() -> [String: Any] {
        ["version": 1, "profilePath": "/operator/shared-voice", "labels": (1...10).map { "Voice \($0)" },
         "routes": ["input": ["deviceId": "CoreAudio:mic", "channels": [0], "sampleRate": 48_000],
                    "monitor": ["deviceId": "CoreAudio:interface", "channels": [0, 1], "sampleRate": 48_000],
                    "transmit": ["deviceId": "CoreAudio:interface", "channels": [2], "sampleRate": 48_000]],
         "edits": (1...10).map { _ in ["trimStartMs": 0, "trimEndMs": NSNull(), "gainDb": 0] }]
    }
    private func decode(_ value: [String: Any]) throws -> VoiceProfile {
        try JSONDecoder().decode(VoiceProfile.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func testLegacySettingsAndCombinedRoundTripRetainVoiceConfigurationWithoutRuntimeState() throws {
        let old = try JSONEncoder().encode(XLogSettings.defaults)
        XCTAssertNil(try JSONDecoder().decode(XLogSettings.self, from: old).voiceProfile)
        var settings = XLogSettings.defaults
        settings.nearbySpottedCallsigns = true
        settings.voiceProfile = try decode(profile())
        let bytes = try JSONEncoder().encode(settings)
        let restored = try JSONDecoder().decode(XLogSettings.self, from: bytes)
        XCTAssertEqual(restored, settings)
        XCTAssertTrue(restored.nearbySpottedCallsigns)
        let json = String(decoding: bytes, as: UTF8.self)
        for runtimeField in ["armed", "actionID", "lease", "preparedAudio"] {
            XCTAssertFalse(json.contains("\"\(runtimeField)\""))
        }
    }
    func testInvalidOrOverlappingRoutesAndOutOfBoundsEditsCannotReplaceSettings() throws {
        var value = profile()
        var routes = value["routes"] as! [String: Any]
        routes["monitor"] = routes["transmit"]
        value["routes"] = routes
        XCTAssertThrowsError(try decode(value))
        value = profile(); routes = value["routes"] as! [String: Any]
        routes["transmit"] = ["deviceId": "", "channels": [0], "sampleRate": 48_000]
        value["routes"] = routes
        XCTAssertThrowsError(try decode(value))
        value = profile(); value["edits"] = (1...10).map { _ in ["trimStartMs": 200, "trimEndMs": 100, "gainDb": 0] }
        XCTAssertThrowsError(try decode(value))
        value = profile(); value["edits"] = (1...10).map { _ in ["trimStartMs": 0, "trimEndMs": NSNull(), "gainDb": 13] }
        XCTAssertThrowsError(try decode(value))
    }
}
