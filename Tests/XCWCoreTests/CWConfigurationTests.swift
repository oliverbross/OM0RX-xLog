import Foundation
import XCTest
@testable import XCWCore

final class CWConfigurationTests: XCTestCase {
    func testDefaultsArePassiveAndRoundTrip() throws {
        let value=try CWDecodeConfiguration()
        XCTAssertTrue(value.sources.isEmpty);XCTAssertFalse(value.listenerEnabled);XCTAssertFalse(value.automaticSpots)
        XCTAssertEqual(value.listenerPort,7300)
        XCTAssertEqual(try CWDecodeConfiguration.decode(JSONEncoder().encode(value)),value)
    }
    func testTwoSpansAcrossRadiosAndMixedProviders() throws {
        let first=try CWSourceConfiguration(radioID:"radio1",provider:.tciIQ,receiverID:"0")
        let second=try CWSourceConfiguration(radioID:"radio2",provider:.flexDAXIQ,receiverID:"40000000")
        XCTAssertNoThrow(try CWDecodeConfiguration(sources:[first,second]))
        XCTAssertThrowsError(try CWDecodeConfiguration(sources:[first,second,
            CWSourceConfiguration(radioID:"radio1",provider:.tciIQ,receiverID:"1")]))
        XCTAssertThrowsError(try CWDecodeConfiguration(sources:[first,first]))
        XCTAssertThrowsError(try CWDecodeConfiguration(sources:[first,
            CWSourceConfiguration(radioID:"radio1",provider:.tciIQ,receiverID:"0")]))
    }
    func testSharedTCIRateAndSourceValidation() throws {
        let first=try CWSourceConfiguration(radioID:"radio1",provider:.tciIQ,receiverID:"0")
        let second=try CWSourceConfiguration(radioID:"radio1",provider:.tciIQ,receiverID:"1",sampleRate:48000)
        XCTAssertThrowsError(try CWDecodeConfiguration(sources:[first,second]))
        XCTAssertThrowsError(try CWSourceConfiguration(radioID:"radio1",provider:.replay,receiverID:"0"))
        XCTAssertThrowsError(try CWSourceConfiguration(radioID:"radio3",provider:.tciIQ,receiverID:"0"))
        XCTAssertThrowsError(try CWSourceConfiguration(radioID:"radio1",provider:.tciIQ,receiverID:"2"))
        XCTAssertThrowsError(try CWSourceConfiguration(radioID:"radio1",provider:.flexDAXIQ,receiverID:"../device"))
        XCTAssertThrowsError(try CWDecodeConfiguration(listenerPort:80))
    }
    func testDecodedConfigurationIsValidated() throws {
        let value=try CWDecodeConfiguration()
        var object=try XCTUnwrap(JSONSerialization.jsonObject(with:JSONEncoder().encode(value)) as? [String:Any])
        object["version"]=2
        XCTAssertThrowsError(try CWDecodeConfiguration.decode(JSONSerialization.data(withJSONObject:object)))
        object["version"]=1;object["listenerEnabled"]="true"
        XCTAssertThrowsError(try CWDecodeConfiguration.decode(JSONSerialization.data(withJSONObject:object)))
        XCTAssertThrowsError(try CWDecodeConfiguration.decode(Data(repeating:32,count:16385)))
    }
}
