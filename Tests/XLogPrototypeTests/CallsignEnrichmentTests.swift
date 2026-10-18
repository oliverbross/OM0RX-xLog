#if os(macOS)
import XCTest
@testable import XLogPrototypeSupport

final class CallsignEnrichmentTests: XCTestCase {
    private var base: [String: Any] { ["call": "EA7EU", "country": "Spain", "dxcc": 281, "latitude": 40.0, "longitude": -4.0, "source": "CTY approximate"] }

    func testProviderFailureKeepsOfflineCountryAndLocationWithoutLeakingError() async {
        let result = await CallsignEnrichment.resolve(base: base) { throw NSError(domain: "secret-bearing-provider-url", code: 1) }
        XCTAssertEqual(result["country"] as? String, "Spain")
        XCTAssertEqual(result["latitude"] as? Double, 40)
        XCTAssertEqual(result["source"] as? String, "CTY approximate")
        XCTAssertEqual(result["lookup_warning"] as? String, "QRZ lookup is unavailable. Offline CTY result retained.")
        XCTAssertFalse(String(describing: result).contains("secret-bearing"))
    }

    func testBlankOnlineFieldsCannotEraseCTYAndPartialCoordinateDoesNotMixSources() async {
        let result = await CallsignEnrichment.resolve(base: base) {
            ["call": "EA7EU", "name": "Operator", "country": "", "latitude": 37.0]
        }
        XCTAssertEqual(result["country"] as? String, "Spain")
        XCTAssertEqual(result["name"] as? String, "Operator")
        XCTAssertEqual(result["latitude"] as? Double, 40)
        XCTAssertEqual(result["longitude"] as? Double, -4)
        XCTAssertEqual(result["location_source"] as? String, "CTY approximate")
    }

    func testCompleteCoordinatesAndGridFallbackAreQualified() async {
        let precise = await CallsignEnrichment.resolve(base: base) { ["call": "ea7eu", "latitude": 37.5, "longitude": -4.5] }
        XCTAssertEqual(precise["latitude"] as? Double, 37.5)
        XCTAssertEqual(precise["location_source"] as? String, "QRZ coordinates")
        let grid = await CallsignEnrichment.resolve(base: base) { ["call": "EA7EU", "gridSquare": "IM76"] }
        XCTAssertEqual(grid["location_source"] as? String, "QRZ grid centre")
        XCTAssertNotEqual(grid["latitude"] as? Double, 40)
    }

    func testMismatchedCallCannotSupplyAnotherStationLocation() async {
        let result = await CallsignEnrichment.resolve(base: base) { ["call": "OTHER", "latitude": 1.0, "longitude": 2.0] }
        XCTAssertEqual(result["call"] as? String, "EA7EU")
        XCTAssertEqual(result["latitude"] as? Double, 40)
        XCTAssertNotNil(result["lookup_warning"])
    }

    func testPrefixedPortableCallKeepsOperatingEntityLocation() async {
        let croatia: [String: Any] = [
            "call": "9A/SP9WLG/P", "country": "Croatia", "dxcc": 497,
            "latitude": 45.1, "longitude": 15.2, "source": "CTY approximate",
        ]
        let result = await CallsignEnrichment.resolve(base: croatia) {
            [
                "call": "9A/SP9WLG/P", "name": "Portable Operator", "country": "Poland", "dxcc": 269,
                "gridSquare": "JO90", "latitude": 49.8, "longitude": 19.0,
            ]
        }
        XCTAssertEqual(result["name"] as? String, "Portable Operator")
        XCTAssertEqual(result["country"] as? String, "Croatia")
        XCTAssertEqual(result["dxcc"] as? Int, 497)
        XCTAssertEqual(result["latitude"] as? Double, 45.1)
        XCTAssertEqual(result["longitude"] as? Double, 15.2)
        XCTAssertNil(result["gridSquare"])
        XCTAssertEqual(result["location_source"] as? String, "CTY approximate")
        XCTAssertEqual(result["lookup_warning"] as? String,
                       "QRZ profile is for home callsign SP9WLG; operating-entity location retained.")
    }

    func testPortableSuffixCanUseMatchingEntityCoordinates() async {
        let portable = base.merging(["call": "EA7EU/P"]) { _, new in new }
        let result = await CallsignEnrichment.resolve(base: portable) {
            ["call": "EA7EU/P", "country": "Spain", "dxcc": 281, "latitude": 37.5, "longitude": -4.5]
        }
        XCTAssertEqual(result["latitude"] as? Double, 37.5)
        XCTAssertEqual(result["longitude"] as? Double, -4.5)
        XCTAssertEqual(result["location_source"] as? String, "QRZ coordinates")
        XCTAssertNil(result["lookup_warning"])
    }
}
#endif
