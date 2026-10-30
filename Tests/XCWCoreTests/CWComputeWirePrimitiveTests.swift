import Foundation
import XCTest
@testable import XCWCore

final class CWComputeWirePrimitiveTests:XCTestCase {
    private func encoded(_ value:[String:Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject:value)
    }

    func testFoundationFallbackSeparatesJSONBooleansAndBoxedNumbers() throws {
        for token in ["true","false"] {
            let number=try XCTUnwrap(JSONSerialization.jsonObject(with:Data(token.utf8),options:.fragmentsAllowed) as? NSNumber)
            XCTAssertTrue(CWComputeWire.isFoundationBoolean(number))
        }
        for token in ["0","1","-1","1.25"] {
            let number=try XCTUnwrap(JSONSerialization.jsonObject(with:Data(token.utf8),options:.fragmentsAllowed) as? NSNumber)
            XCTAssertFalse(CWComputeWire.isFoundationBoolean(number))
        }
        for number in [NSNumber(value:Int8(1)),NSNumber(value:UInt8(0)),NSNumber(value:UInt64.max),
                       NSNumber(value:Double(1)),NSNumber(value:Float(0)),NSNumber(value:Double.nan)] {
            XCTAssertFalse(CWComputeWire.isFoundationBoolean(number))
        }
    }

    func testReadyNumericFieldsNeverAcceptBooleanOrStringCoercion() throws {
        let ready:[String:Any]=["type":"ready","protocol_version":1,"sample_rate":3200,"max_spans":2,
                                "max_tracks_per_span":16,"inference_workers":2,"runtime_version":"1.24.3"]
        XCTAssertNoThrow(try CWComputeWire.event(encoded(ready)))
        for key in ["protocol_version","sample_rate","max_spans","max_tracks_per_span","inference_workers"] {
            for invalid:Any in [true,false,"1"] {
                var value=ready;value[key]=invalid
                XCTAssertThrowsError(try CWComputeWire.event(encoded(value)),key)
            }
        }
    }

    func testTrackBooleanFieldsNeverAcceptNumericTruthiness() throws {
        let track:[String:Any]=["type":"stream","stream_token":String(repeating:"a",count:32),"epoch":"1",
            "track_id":"","state":"acquiring","first_sample":"0","end_sample":"0","source_first_sample":"0",
            "filter_delay_seconds":0.1,"track_revision":"0","offset_hz":0,"ambiguous":false,"replay":true]
        XCTAssertNoThrow(try CWComputeWire.event(encoded(track)))
        for key in ["ambiguous","replay"] {
            for invalid:Any in [0,1,"true","false",NSNull()] {
                var value=track;value[key]=invalid
                XCTAssertThrowsError(try CWComputeWire.event(encoded(value)),key)
            }
        }
        for key in ["filter_delay_seconds","offset_hz"] {
            var value=track;value[key]=true
            XCTAssertThrowsError(try CWComputeWire.event(encoded(value)),key)
        }
    }
    func testOverloadMarkerRequiresARevisedTrackAndOneNonzeroSampleFence() throws {
        let marker:[String:Any]=["type":"track","stream_token":String(repeating:"a",count:32),"epoch":"1",
            "track_id":UUID().uuidString,"state":"overloaded","first_sample":"22400","end_sample":"22400","source_first_sample":"0",
            "filter_delay_seconds":0.1,"track_revision":"1","offset_hz":600,"ambiguous":false,"replay":true]
        XCTAssertNoThrow(try CWComputeWire.event(encoded(marker)))
        for (key,value) in [("track_revision","0"),("first_sample","22399"),("end_sample","0"),("track_id","")] {
            var invalid=marker;invalid[key]=value
            XCTAssertThrowsError(try CWComputeWire.event(encoded(invalid)),key)
        }
    }
}
