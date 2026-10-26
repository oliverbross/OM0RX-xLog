import Foundation
import XCTest
@testable import XCWCore
final class CWClientOutputQueueTests:XCTestCase {
    func testActiveWriteRemainsWithinByteAndAgeBudgets() {
        var queue=CWClientOutputQueue()
        XCTAssertTrue(queue.enqueue(Data(repeating:1,count:131072),now:100))
        XCTAssertTrue(queue.enqueue(Data(repeating:2,count:131072),now:200))
        XCTAssertEqual(queue.byteCount,262144)
        XCTAssertFalse(queue.enqueue(Data([3]),now:300))
        XCTAssertFalse(queue.expired(now:5_000_000_099));XCTAssertTrue(queue.expired(now:5_000_000_100))
        queue.complete();XCTAssertEqual(queue.byteCount,131072);XCTAssertEqual(queue.first?.first,2)
        queue.complete();XCTAssertEqual(queue.byteCount,0);XCTAssertNil(queue.first)
        XCTAssertTrue(queue.enqueue(Data([3]),now:6_000_000_000))
        XCTAssertFalse(queue.enqueue(Data([4]),now:11_000_000_000))
    }
    func testIndependentClientsAndClockDiscontinuity() {
        var first=CWClientOutputQueue(),second=CWClientOutputQueue()
        XCTAssertTrue(first.enqueue(Data([1]),now:10))
        XCTAssertTrue(first.expired(now:9))
        XCTAssertTrue(second.enqueue(Data([2]),now:10_000_000_000))
        XCTAssertFalse(second.expired(now:10_000_000_001))
        XCTAssertEqual(first.byteCount,1);XCTAssertEqual(second.byteCount,1)
    }
}
