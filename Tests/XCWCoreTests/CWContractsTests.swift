// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import XCTest
@testable import XCWCore

final class CWContractsTests: XCTestCase {
    private func descriptor(epoch: String = "1", sign: Int? = 1) throws -> CWStreamDescriptor {
        try CWStreamDescriptor(sessionID: UUID(), sourceID: UUID(), radioID: "radio2", provider: .tciIQ,
                               receiverID: "1", epoch: epoch, centreHz: 14_025_000, sampleRate: 96_000,
                               spectralSign: sign, usableLowerHz: 13_985_000, usableUpperHz: 14_065_000)
    }
    func testSignedRFMappingRequiresKnownOrientationAndCoverage() throws {
        XCTAssertEqual(try descriptor().frequency(offsetHz: -4100),14_020_900)
        XCTAssertEqual(try descriptor(sign:-1).frequency(offsetHz: -4100),14_029_100)
        XCTAssertThrowsError(try descriptor(sign:nil).frequency(offsetHz:100))
        XCTAssertThrowsError(try descriptor().frequency(offsetHz:47000))
        XCTAssertThrowsError(try descriptor().frequency(offsetHz:.nan))
        XCTAssertThrowsError(try descriptor(epoch:"01"))
    }
    func testContinuityRejectsStaleEpochGapAndQueueAge() throws {
        var gate=CWContinuityGate(); let source=try descriptor()
        func block(_ seq:UInt64,_ first:UInt64,_ d:CWStreamDescriptor = source) throws -> CWIQBlock {
            try CWIQBlock(descriptor:d,sequence:seq,firstSample:first,receivedMonotonicNS:100,samples:[0,0,1,-1])
        }
        try gate.accept(block(0,0),now:100); try gate.accept(block(1,2),now:101)
        XCTAssertThrowsError(try gate.accept(block(3,4),now:102))
        try gate.accept(block(0,0),now:100)
        XCTAssertThrowsError(try gate.accept(block(1,2,descriptor(epoch:"2")),now:101))
        XCTAssertThrowsError(try gate.accept(block(0,0),now:250_000_101))
    }
    func testIQRejectsBadSamplesBeforeAllocationAndCounterOverflow() throws {
        let source=try descriptor()
        for samples: [Float] in [[],[1],[.nan,0],[.infinity,0],Array(repeating:0,count:32770)] {
            XCTAssertThrowsError(try CWIQBlock(descriptor:source,sequence:0,firstSample:0,receivedMonotonicNS:0,samples:samples))
        }
        XCTAssertThrowsError(try CWIQBlock(descriptor:source,sequence:0,firstSample:UInt64.max,receivedMonotonicNS:0,samples:[0,0]))
    }
}
