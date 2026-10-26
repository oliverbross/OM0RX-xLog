import Foundation
import XCTest
@testable import XCatIntegrationCore
final class FlexIQIdentityTests:XCTestCase {
    private func packet(_ text:String)->Data {
        var payload=Array(text.utf8);while payload.count%4 != 0{payload.append(32)}
        var result=Data()
        for word in [UInt32(0x38000000)|UInt32((16+payload.count)/4),0,0x1c2d,0x534cffff] {
            var be=word.bigEndian;withUnsafeBytes(of:&be){result.append(contentsOf:$0)}
        }
        result.append(contentsOf:payload);return result
    }
    func testPhysicalIdentityIsParsedFromBoundedDiscoveryNotSliceLabels() throws {
        let identity=try FlexIQIdentity.parse(packet("serial=1234-5678-8400-0001 model=FLEX-8400 ip=192.0.2.10 port=4992 nickname=Fixture"))
        XCTAssertEqual(identity.model,"FLEX-8400");XCTAssertEqual(identity.serial,"1234-5678-8400-0001")
        XCTAssertThrowsError(try FlexIQIdentity.parse(packet("model=FLEX-8400 ip=192.0.2.10 port=4992")))
        XCTAssertThrowsError(try FlexIQIdentity.parse(packet("serial=1234 serial=5678 model=FLEX-8400 ip=192.0.2.10 port=4992")))
        var invalid=packet("serial=1234 model=FLEX-8400 ip=192.0.2.10 port=4992");invalid[12]=0
        // Wrong packet class; ordinary IQ must not become a discovery record.
        invalid[15]=0xe5;XCTAssertThrowsError(try FlexIQIdentity.parse(invalid))
        XCTAssertThrowsError(try FlexIQIdentity.parse(Data(repeating:0,count:8196)))
    }
}
