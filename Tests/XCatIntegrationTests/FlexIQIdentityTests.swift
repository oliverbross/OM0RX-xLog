import Foundation
import XCTest
@testable import XCatIntegrationCore
final class FlexIQIdentityTests:XCTestCase {
    private func packet(_ text:String,padding:UInt8=32,timestamps:Bool=false)->Data {
        var payload=Array(text.utf8);while payload.count%4 != 0{payload.append(padding)}
        var result=Data()
        let prefix:UInt32=timestamps ? 0x38560000:0x38000000
        var words:[UInt32]=[prefix|UInt32(((timestamps ? 28:16)+payload.count)/4),0x800,0x1c2d,0x534cffff]
        if timestamps {words += [0,0,0]}
        for word in words {
            var be=word.bigEndian;withUnsafeBytes(of:&be){result.append(contentsOf:$0)}
        }
        result.append(contentsOf:payload);return result
    }
    func testRealRadioWordAlignmentAllowsOnlyTerminalZeroPadding() throws {
        let base="serial=1234-5678-8400-0001 model=FLEX-8400 ip=192.0.2.10 port=4992 nickname="
        for length in 1...4 {
            let identity=try FlexIQIdentity.parse(packet(base+String(repeating:"X",count:length),padding:0,timestamps:true))
            XCTAssertEqual(identity.controlPort,4992);XCTAssertEqual(identity.serial,"1234-5678-8400-0001")
        }
        XCTAssertThrowsError(try FlexIQIdentity.parse(packet(base+"X\0Y",padding:0,timestamps:true)))
        XCTAssertThrowsError(try FlexIQIdentity.parse(packet(base+"X\nY",padding:0,timestamps:true)))
        XCTAssertThrowsError(try FlexIQIdentity.parse(packet(base+"X"+String(repeating:"\0",count:4),padding:0,timestamps:true)))
    }
    func testPrivateReceivedManufacturerPacketWhenSupplied() throws {
        guard let path=ProcessInfo.processInfo.environment["XCW_FLEX_DISCOVERY_PACKET"] else{throw XCTSkip("Private real manufacturer packet not supplied")}
        let identity=try FlexIQIdentity.parse(Data(contentsOf:URL(fileURLWithPath:path)))
        XCTAssertEqual(identity.model,"FLEX-8400");XCTAssertEqual(identity.controlPort,4992)
        if let serial=ProcessInfo.processInfo.environment["XCW_FLEX_DISCOVERY_SERIAL"]{XCTAssertEqual(identity.serial,serial)}
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
