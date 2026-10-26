import Foundation
import XCTest
@testable import XCatIntegrationCore
final class FlexIQResourceTests:XCTestCase {
    private func inventory()->FlexIQResourceInventory {
        var value=FlexIQResourceInventory()
        value.consume("display pan 0x40000000 client_handle=0x1234 daxiq_channel=1 center=14.025000 rxant=ANT1 xvtr=")
        return value
    }
    func testCompanionResourcesRequireExplicitStationOwnershipAndAssignments() throws {
        let value=inventory(),pan=try value.permittedPanadapter(0x40000000,stationHandle:0x1234)
        XCTAssertEqual(pan.id,"40000000");XCTAssertEqual(pan.centreHz,14025000);XCTAssertEqual(pan.channel,1)
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000000,stationHandle:nil))
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000000,stationHandle:0x5678))
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000001,stationHandle:0x1234))
    }
    func testActiveCompetitorsBlockAndUnknownOwnershipDoesNotBecomeAnOwnedStream() throws {
        var value=inventory()
        value.consume("stream 0x80000000 type=dax_iq client_handle=0x5678 daxiq_channel=1 pan=0x40000000 daxiq_rate=96000 active=1")
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000000,stationHandle:0x1234)) {XCTAssertEqual($0 as? FlexIQSubscriptionError,.busy)}
        value.consume("stream 0x80000000 active=0")
        XCTAssertNoThrow(try value.permittedPanadapter(0x40000000,stationHandle:0x1234))
        XCTAssertEqual(value.streams[0x80000000]?.clientHandle,0x5678)
        value.consume("stream 0x80000000 active=invalid")
        XCTAssertNil(value.streams[0x80000000]?.active)
        value.consume("stream 0x80000000 removed")
        XCTAssertTrue(value.streams.isEmpty)
    }
    func testMalformedChangedFieldsRetireOldMappingAndDuplicateKeysAreNotGuessed() throws {
        var value=inventory();let revision=value.revision
        value.consume("display pan 0x40000000 fps=30")
        XCTAssertEqual(value.revision,revision)
        value.consume("display pan 0x40000000 center=NaN")
        XCTAssertNil(value.pans[0x40000000]?.centreHz)
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000000,stationHandle:0x1234))
        value.consume("display pan 0x40000000 center=14.025000 center=7.025000")
        XCTAssertTrue(value.pans.isEmpty)
    }
    func testTwoSpansRequireDistinctAssignedChannelsAndResourceChangesAdvanceRevision() throws {
        var value=inventory()
        value.consume("display pan 0x40000001 client_handle=0x1234 daxiq_channel=1 center=7.025000 rxant=ANT1")
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000000,stationHandle:0x1234)) {XCTAssertEqual($0 as? FlexIQSubscriptionError,.ambiguousChannel)}
        value.consume("display pan 0x40000001 daxiq_channel=2")
        XCTAssertNoThrow(try value.permittedPanadapter(0x40000000,stationHandle:0x1234))
        XCTAssertNoThrow(try value.permittedPanadapter(0x40000001,stationHandle:0x1234))
        let revision=value.revision;value.consume("display pan 0x40000000 rxant=ANT2")
        XCTAssertGreaterThan(value.revision,revision)
        value.consume("display pan 0x40000000 removed=1");XCTAssertNil(value.pans[0x40000000])
    }
    func testIdentifiersAndMetadataAreBounded() {
        XCTAssertEqual(FlexIQResourceInventory.handle("0x00000001"),1)
        XCTAssertNil(FlexIQResourceInventory.handle("0x100000000"));XCTAssertNil(FlexIQResourceInventory.handle("../1"))
        var value=FlexIQResourceInventory()
        for id in 0..<100 {value.consume("display pan \(String(id,radix:16)) center=14.025000")}
        XCTAssertEqual(value.pans.count,16)
        XCTAssertFalse(value.consume("display pan 1 "+String(repeating:"a",count:4096)))
    }
    func testEmptyAntennaAndInvalidRFPathWithdrawPermission() {
        var value=inventory()
        value.consume("display pan 0x40000000 rxant=")
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000000,stationHandle:0x1234))
        value.consume("display pan 0x40000000 rxant=ANT1 pre="+String(repeating:"x",count:65))
        XCTAssertThrowsError(try value.permittedPanadapter(0x40000000,stationHandle:0x1234))
    }
}
