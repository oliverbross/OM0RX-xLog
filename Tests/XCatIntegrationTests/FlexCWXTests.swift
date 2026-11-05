import Foundation
import XCTest
@testable import XCatIntegrationCore

final class FlexCWXTests: XCTestCase {
    private func ready() -> FlexCWX {
        var value = FlexCWX(); value.reset(generation: 7); value.identify(0xab); value.subscriptionAccepted(); return value
    }
    func testLiteralOM0ThenRXEachAllocatedExactlyOnceAndProgressIsRadioReported() throws {
        var value=ready(); let job=UUID().uuidString
        let a=try XCTUnwrap(value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
        XCTAssertEqual(a.command,"cwx send \"OM0\" 1")
        try value.acknowledge(a,reply:"170,1")
        XCTAssertNil(try value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
        XCTAssertThrowsError(try value.acknowledge(a,reply:"170,1"))
        let b=try XCTUnwrap(value.prepare(generation:7,job:job,ordinal:2,text:"RX",finish:false))
        XCTAssertEqual(b.command,"cwx send \"RX\" 2")
        try value.acknowledge(b,reply:"173,2")
        XCTAssertEqual(value.snapshot.accepted,5); XCTAssertEqual(value.snapshot.reported,0)
        value.status(handle:0xcd,body:"cwx sent=174",generation:7)
        value.status(handle:0xab,body:"cwx sent=174",generation:6)
        value.status(handle:0xab,body:"cwx sent=999",generation:7)
        XCTAssertEqual(value.snapshot.reported,0)
        value.status(handle:0xab,body:"cwx sent=172",generation:7)
        XCTAssertEqual(value.snapshot.reported,3)
        value.status(handle:0xab,body:"cwx sent=172",generation:7)
        value.status(handle:0xab,body:"cwx sent=171",generation:7)
        XCTAssertEqual(value.snapshot.reported,3)
        value.status(handle:0xab,body:"cwx sent=174",generation:7)
        XCTAssertEqual(value.snapshot.reported,5)
        XCTAssertNil(try value.prepare(generation:7,job:job,ordinal:3,text:"",finish:true))
        XCTAssertTrue(value.snapshot.closed)
    }
    func testProgressBeforeIndexedReplyWaitsForAllocationAndForeignIndicesStayUnattributed() throws {
        var value=ready(); let job=UUID().uuidString
        let a=try XCTUnwrap(value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
        value.status(handle:0xcd,body:"cwx sent=172",generation:7)
        value.status(handle:0xab,body:"cwx sent=172",generation:7)
        XCTAssertEqual(value.snapshot.reported,0)
        try value.acknowledge(a,reply:"170,1")
        XCTAssertEqual(value.snapshot.reported,3)
    }
    func testStopBeforeReplyRetiresJobAndDelayedReplyCannotReviveIt() throws {
        var value=ready(); let job=UUID().uuidString
        let a=try XCTUnwrap(value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
        value.retire()
        XCTAssertFalse(value.snapshot.available,"An unresolved allocation cannot safely lend indices to another job")
        XCTAssertThrowsError(try value.acknowledge(a,reply:"170,1"))
        XCTAssertThrowsError(try value.prepare(generation:7,job:job,ordinal:2,text:"RX",finish:false))
        XCTAssertThrowsError(try value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
        value.status(handle:0xab,body:"cwx sent=172",generation:7)
        XCTAssertNil(value.snapshot.job); XCTAssertEqual(value.snapshot.reported,0)
    }
    func testStopBeforeFirstAppendReachesAdapterRejectsItWithoutACommand() throws {
        var value=ready();let job=UUID().uuidString
        value.retire(job:job)
        XCTAssertThrowsError(try value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
        XCTAssertNil(value.snapshot.job)
    }
    func testReconnectCannotReplayOldAppendOrAcceptOldEventsEvenWithReusedHandleAndIndex() throws {
        var value=ready(); let old=UUID().uuidString
        let a=try XCTUnwrap(value.prepare(generation:7,job:old,ordinal:1,text:"OM0",finish:false))
        value.reset(generation:9); value.identify(0xab); value.subscriptionAccepted()
        XCTAssertThrowsError(try value.acknowledge(a,reply:"170,1"))
        XCTAssertThrowsError(try value.prepare(generation:7,job:old,ordinal:2,text:"RX",finish:false))
        XCTAssertNil(value.snapshot.job)
        let current=try XCTUnwrap(value.prepare(generation:9,job:UUID().uuidString,ordinal:1,text:"NEW",finish:false))
        try value.acknowledge(current,reply:"170,1")
        value.status(handle:0xab,body:"cwx sent=172",generation:7)
        XCTAssertEqual(value.snapshot.reported,0)
    }
    func testMissingOrWrongBlockAndReusedRangeDisableLiveWithoutGuessing() throws {
        for reply in ["170","170,999","garbled","-1,1","2147483647,1"] {
            var value=ready()
            let a=try XCTUnwrap(value.prepare(generation:7,job:UUID().uuidString,ordinal:1,text:"OM0",finish:false))
            XCTAssertThrowsError(try value.acknowledge(a,reply:reply))
            XCTAssertFalse(value.snapshot.available); XCTAssertEqual(value.snapshot.reported,0)
        }
        var value=ready();let job=UUID().uuidString
        let a=try XCTUnwrap(value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
        try value.acknowledge(a,reply:"170,1"); value.retire()
        let b=try XCTUnwrap(value.prepare(generation:7,job:UUID().uuidString,ordinal:1,text:"RX",finish:false))
        XCTAssertThrowsError(try value.acknowledge(b,reply:"170,2"))
        XCTAssertFalse(value.snapshot.available)
    }
    func testUnknownStatusHandleOrErasureWithdrawsLiveAndNeverAdvances() throws {
        for (handle,body):(UInt32?,String) in [(0,"cwx sent=172"),(nil,"cwx sent=172"),(0xab,"cwx sent=172 sent=173"),(0xcd,"cwx erase_start=170 erase_stop=172")] {
            var value=ready();let job=UUID().uuidString
            let a=try XCTUnwrap(value.prepare(generation:7,job:job,ordinal:1,text:"OM0",finish:false))
            try value.acknowledge(a,reply:"170,1")
            value.status(handle:handle,body:body,generation:7)
            XCTAssertFalse(value.snapshot.available);XCTAssertEqual(value.snapshot.reported,0)
            XCTAssertThrowsError(try value.prepare(generation:7,job:job,ordinal:2,text:"RX",finish:false))
        }
    }
    func testLiteralSpacesUseProtocolDELAndInjectionIsRejected() throws {
        var value=ready()
        let a=try XCTUnwrap(value.prepare(generation:7,job:UUID().uuidString,ordinal:1,text:"CQ TEST",finish:false))
        XCTAssertEqual(a.command,"cwx send \"CQ\u{7f}TEST\" 1")
        for text in ["CQ\" TEST","CQ|TEST","CQ\nTEST","{CALL}",String(repeating:"A",count:129)] {
            var fresh=ready();XCTAssertThrowsError(try fresh.prepare(generation:7,job:UUID().uuidString,ordinal:1,text:text,finish:false))
        }
    }
}
