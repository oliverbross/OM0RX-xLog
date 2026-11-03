import XCTest
@testable import XLogCore

final class BandMapGuidesTests: XCTestCase {
    func testFoundationFallbackPreservesJSONBooleanAndNumberDistinction() throws {
        for token in ["true", "false"] {
            let number = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(token.utf8), options: .fragmentsAllowed) as? NSNumber)
            XCTAssertTrue(BandMapGuides.isFoundationBoolean(number), token)
        }
        for token in ["0", "1", "-1", "1.25"] {
            let number = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(token.utf8), options: .fragmentsAllowed) as? NSNumber)
            XCTAssertFalse(BandMapGuides.isFoundationBoolean(number), token)
        }
        for number in [NSNumber(value: Int8(1)), NSNumber(value: UInt8(0)), NSNumber(value: UInt64.max),
                       NSNumber(value: Double(1)), NSNumber(value: Float(0)), NSNumber(value: Double.nan)] {
            XCTAssertFalse(BandMapGuides.isFoundationBoolean(number))
        }
    }
    func testOldWorkspaceDefaultsPreserveAppearanceAndNewFieldRoundTrips() throws {
        var preferences = XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["40m"], deskBandMapFollowsRadio: true, detachedBandMapLayout: "Single row", bandMapFontScale: 1.2, intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false)
        let encoded = try JSONEncoder().encode(preferences)
        var old = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
        old.removeValue(forKey: "bandMapGuidesJSON")
        let migrated = try JSONDecoder().decode(XLogBackupPreferences.self, from: JSONSerialization.data(withJSONObject: old))
        XCTAssertEqual(migrated.bandMapGuidesJSON, "")
        XCTAssertEqual(migrated.deskBandMapBands, ["20m"])
        XCTAssertEqual(migrated.bandMapFontScale, 1.2)
        preferences.bandMapGuidesJSON = #"{"version":1,"custom":[],"desk":{"id":"legacy","visible":true,"beacons":false},"detached":{"id":"builtin-r3-2024","visible":false,"beacons":true}}"#
        XCTAssertEqual(try JSONDecoder().decode(XLogBackupPreferences.self, from: JSONEncoder().encode(preferences)), preferences)
    }
    func testLegacyAndCustomDocumentValidation() throws {
        try BandMapGuides.validate("")
        let text = ##"{"version":1,"custom":[{"version":1,"units":"Hz","id":"custom-1","name":"Personal","region":"Custom","origin":"custom","sourceURL":"","reviewed":"2026-11-03","supportedBands":["20m"],"ranges":[{"startHz":14000000,"endHz":14070000,"color":"#12a88a","label":"CW"}],"markers":[{"frequencyHz":14025000,"label":"Personal","category":"personal"}]}],"desk":{"id":"custom-1","visible":true,"beacons":false},"detached":{"id":"legacy","visible":true,"beacons":false}}"##
        try BandMapGuides.validate(text)
        for bad in [text.replacingOccurrences(of: "\"Hz\"", with: "\"kHz\""), text.replacingOccurrences(of: "14000000", with: "14070001"), text.replacingOccurrences(of: "#12a88a", with: "red"), String(repeating: " ", count: 10_241)] {
            XCTAssertThrowsError(try BandMapGuides.validate(bad))
        }
        for bad in [text.replacingOccurrences(of: "\"version\":1", with: "\"version\":true"),
                    text.replacingOccurrences(of: "\"version\":1", with: "\"version\":\"1\""),
                    text.replacingOccurrences(of: "14000000", with: "true"),
                    text.replacingOccurrences(of: "14000000", with: "\"14000000\""),
                    text.replacingOccurrences(of: "\"visible\":true", with: "\"visible\":1"),
                    text.replacingOccurrences(of: "\"beacons\":false", with: "\"beacons\":0"),
                    text.replacingOccurrences(of: "\"visible\":true", with: "\"visible\":\"true\"")] {
            XCTAssertThrowsError(try BandMapGuides.validate(bad))
        }
    }
}
