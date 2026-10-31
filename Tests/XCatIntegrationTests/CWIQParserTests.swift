// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation
import XCTest
@testable import XCatIntegrationCore

final class CWIQParserTests: XCTestCase {
    private func putLE(_ value: UInt32, in data: inout Data, at offset: Int) {
        for i in 0..<4 { data[offset+i] = UInt8(truncatingIfNeeded: value >> (i*8)) }
    }
    private func putBE(_ value: UInt32, in data: inout Data, at offset: Int) {
        for i in 0..<4 { data[offset+i] = UInt8(truncatingIfNeeded: value >> ((3-i)*8)) }
    }
    private func tci() -> Data {
        var data = Data(repeating: 0, count: 80)
        for (offset, value): (Int, UInt32) in [(4,96_000),(8,3),(20,4),(28,2),(64,Float(0.5).bitPattern),
                                               (68,Float(-0.25).bitPattern),(72,Float(-1).bitPattern),(76,Float(1).bitPattern)] {
            putLE(value, in: &data, at: offset)
        }
        return data
    }
    func testTCIComplexCountEndianAndSignedIQ() throws {
        let frame = try XCTUnwrap(TCIIQFrame.parse(tci()))
        XCTAssertEqual(frame.receiver, 0); XCTAssertEqual(frame.sampleRate, 96000)
        XCTAssertEqual(frame.complexSampleCount, 2); XCTAssertEqual(frame.samples, [0.5,-0.25,-1,1])
    }
    func testTCIRejectsFormatCodecPairingLengthReservedAndNonfinite() {
        for (offset,value): (Int,UInt32) in [(0,2),(4,156000),(8,0),(12,1),(16,1),(20,3),(20,UInt32.max),(28,1),(32,1),(64,Float.nan.bitPattern)] {
            var data = tci(); putLE(value,in: &data,at: offset)
            XCTAssertThrowsError(try TCIIQFrame.parse(data), "offset \(offset)")
        }
        XCTAssertThrowsError(try TCIIQFrame.parse(tci().dropLast()))
        var extra = tci(); extra.append(0)
        XCTAssertThrowsError(try TCIIQFrame.parse(extra))
        XCTAssertThrowsError(try TCIIQFrame.parse(Data(repeating: 0,count: TCIIQFrame.maximumBytes+1)))
    }
    func testOtherBinaryTypesNeverBecomeIQ() throws {
        for type: UInt32 in [1,2,3,4,UInt32.max] {
            var data = tci(); putLE(type,in: &data,at: 24)
            XCTAssertNil(try TCIIQFrame.parse(data))
        }
    }
    func testTCI21CountUsesFirstReservedWordWithoutInventingIQContinuity() throws {
        var data=tci(); putLE(12345,in:&data,at:32)
        XCTAssertThrowsError(try TCIIQFrame.parse(data))
        let frame=try XCTUnwrap(TCIIQFrame.parse(data,protocolVersion:TCIVersion("2.1")))
        XCTAssertEqual(frame.reportedCounter,12345); XCTAssertEqual(frame.complexSampleCount,2)
        putLE(1,in:&data,at:36)
        XCTAssertThrowsError(try TCIIQFrame.parse(data,protocolVersion:TCIVersion("2.1")))
    }
    func testVersionIsComponentOrdered() throws {
        XCTAssertGreaterThan(try XCTUnwrap(TCIVersion("1.10")),try XCTUnwrap(TCIVersion("1.9")))
        for invalid in ["1", "1.1.0", "1.-1", "1. 2", "1.9999", "NaN"] { XCTAssertNil(TCIVersion(invalid)) }
    }
    private func flex(counter: UInt8 = 15, trailer: Bool = true, timestamps: Bool = true) -> Data {
        let size = 16 + (timestamps ? 12 : 0) + 16 + (trailer ? 4 : 0)
        var data = Data(repeating: 0,count: size)
        let flags: UInt32 = 0x1800_0000 | (trailer ? 0x0400_0000 : 0) | (timestamps ? 0x0070_0000 : 0)
        putBE(flags | UInt32(counter)<<16 | UInt32(size/4),in: &data,at: 0)
        putBE(0x8400_0001,in: &data,at: 4); putBE(0x1c2d,in: &data,at: 8); putBE(0x534c_02e5,in: &data,at: 12)
        let start = timestamps ? 28 : 16
        for (i,value): (Int,Float) in [32768,-16384,8192,-32768].enumerated().map({($0.offset,Float($0.element))}) {
            putLE(value.bitPattern,in: &data,at: start+i*4)
        }
        return data
    }
    func testFlexWideLittleEndianAndNormalizationWithOptionalFields() throws {
        for trailer in [true,false] { for timestamp in [true,false] {
            let frame = try FlexIQPacket.parse(flex(trailer: trailer,timestamps: timestamp),expectedStreamID: 0x8400_0001)
            XCTAssertEqual(frame.samples,[1,-0.5,0.25,-1]); XCTAssertEqual(frame.packetCounter,15)
            XCTAssertEqual(frame.sampleRate,96000); XCTAssertEqual(frame.integerTimestamp, timestamp ? 0 : nil)
        } }
    }
    func testFlexRejectsWrongStreamClassMalformedAndNonfinite() {
        XCTAssertThrowsError(try FlexIQPacket.parse(flex(),expectedStreamID: 9))
        for (offset,value): (Int,UInt32) in [(0,0x1800_0001),(8,0),(12,0x534c_03e5),(28,Float.nan.bitPattern.bigEndian),(44,0x0100_1000)] {
            var data=flex(); putBE(value,in: &data,at: offset)
            XCTAssertThrowsError(try FlexIQPacket.parse(data,expectedStreamID: 0x8400_0001))
        }
    }
    func testFlexModuloWrapDuplicateReorderAndLongLoss() throws {
        var gate=FlexIQContinuity()
        func packet(_ n:UInt8) throws -> FlexIQPacket { try FlexIQPacket.parse(flex(counter:n),expectedStreamID:0x8400_0001) }
        XCTAssertFalse(gate.accept(try packet(15),receivedNS:0))
        XCTAssertTrue(gate.accept(try packet(0),receivedNS:20000))
        XCTAssertFalse(gate.accept(try packet(0),receivedNS:40000))
        XCTAssertFalse(gate.accept(try packet(15),receivedNS:60000))
        XCTAssertFalse(gate.accept(try packet(0),receivedNS:1_000_000_000))
        XCTAssertEqual(gate.counterBreaks,2);XCTAssertEqual(gate.arrivalGaps,1)
        XCTAssertEqual(gate.maximumReceiptGapNS,999_940_000)
        XCTAssertFalse(gate.accept(try packet(1),receivedNS:500_000_000))
        XCTAssertEqual(gate.receiptRegressions,1)
    }
}
