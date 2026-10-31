// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum FlexIQError: Error, Equatable, Sendable { case size, packetType, classID, streamID, samples, nonfinite, trailer }

/// Independent wire parser based on the manufacturer's VITA protocol fields.
/// FlexLib is a reference only; no FlexLib code is linked or redistributed.
public struct FlexIQPacket: Equatable, Sendable {
    public let streamID: UInt32
    public let packetCounter: UInt8
    public let sampleRate: Int
    public let integerTimestamp: UInt32?
    public let fractionalTimestamp: UInt64?
    public let samples: [Float]

    public static func parse(_ data: Data, expectedStreamID: UInt32) throws -> Self {
        guard data.count >= 16, data.count <= 16_384, data.count % 4 == 0 else { throw FlexIQError.size }
        let bytes = [UInt8](data)
        func be(_ offset: Int) -> UInt32 {
            UInt32(bytes[offset]) << 24 | UInt32(bytes[offset+1]) << 16 |
            UInt32(bytes[offset+2]) << 8 | UInt32(bytes[offset+3])
        }
        let header = be(0)
        guard [1,3].contains(Int(header >> 28)), header & 0x0800_0000 != 0 else { throw FlexIQError.packetType }
        guard Int(header & 0xffff) * 4 == bytes.count else { throw FlexIQError.size }
        guard be(4) == expectedStreamID else { throw FlexIQError.streamID }
        guard be(8) == 0x0000_1c2d, be(12) >> 16 == 0x534c else { throw FlexIQError.classID }
        let rate: Int
        switch be(12) & 0xffff {
        case 0x02e3: rate = 24_000
        case 0x02e4: rate = 48_000
        case 0x02e5: rate = 96_000
        case 0x02e6: rate = 192_000
        default: throw FlexIQError.classID
        }
        var offset = 16
        let trailerCount = header & 0x0400_0000 == 0 ? 0 : 4
        let hasInteger = header >> 22 & 3 != 0, hasFraction = header >> 20 & 3 != 0
        guard bytes.count >= offset + (hasInteger ? 4 : 0) + (hasFraction ? 8 : 0) + trailerCount else { throw FlexIQError.size }
        let integer = hasInteger ? be(offset) : nil
        if hasInteger { offset += 4 }
        let fraction = hasFraction ? UInt64(be(offset)) << 32 | UInt64(be(offset+4)) : nil
        if hasFraction { offset += 8 }
        let end = bytes.count - trailerCount
        guard end > offset, (end - offset) % 8 == 0 else { throw FlexIQError.samples }
        if trailerCount != 0 {
            let trailer = be(end)
            // Reject explicitly invalid data, overload, inversion or sample loss.
            guard !(trailer & 0x4000_0000 != 0 && trailer & 0x0004_0000 == 0),
                  trailer & 0x0200_2000 != 0x0200_2000,
                  trailer & 0x0100_1000 != 0x0100_1000,
                  trailer & 0x0400_4000 != 0x0400_4000 else { throw FlexIQError.trailer }
        }
        var samples = [Float](); samples.reserveCapacity((end - offset) / 4)
        for at in stride(from: offset, to: end, by: 4) {
            let bits = UInt32(bytes[at]) | UInt32(bytes[at+1]) << 8 | UInt32(bytes[at+2]) << 16 | UInt32(bytes[at+3]) << 24
            let sample = Float(bitPattern: bits) / 32768
            guard sample.isFinite else { throw FlexIQError.nonfinite }
            samples.append(sample)
        }
        return Self(streamID: expectedStreamID, packetCounter: UInt8(header >> 16 & 15), sampleRate: rate,
                    integerTimestamp: integer, fractionalTimestamp: fraction, samples: samples)
    }
}

/// Strict no-reorder policy. A four-bit counter cannot prove continuity after
/// a long stall or 16-packet loss: the monotonic elapsed-time gate also fences it.
public struct FlexIQContinuity: Sendable {
    public private(set) var counterBreaks:UInt64=0
    public private(set) var arrivalGaps:UInt64=0
    public private(set) var receiptRegressions:UInt64=0
    public private(set) var maximumReceiptGapNS:UInt64?
    private var previous: UInt8?
    private var previousReceipt: UInt64?
    private var previousDurationNS: UInt64 = 0
    public init() {}
    public mutating func reset() { previous = nil; previousReceipt = nil }
    public mutating func accept(_ packet: FlexIQPacket, receivedNS: UInt64) -> Bool {
        let clean: Bool
        if let previous, let last = previousReceipt {
            if packet.packetCounter != (previous+1)%16,counterBreaks<UInt64.max{counterBreaks+=1}
            if receivedNS<last {
                if receiptRegressions<UInt64.max{receiptRegressions+=1}
            } else {
                maximumReceiptGapNS=max(maximumReceiptGapNS ?? 0,receivedNS-last)
                if receivedNS-last>previousDurationNS*3,arrivalGaps<UInt64.max{arrivalGaps+=1}
            }
            clean = packet.packetCounter == (previous + 1) % 16 && receivedNS >= last &&
                receivedNS - last <= previousDurationNS * 3
        } else { clean = false }
        previous = packet.packetCounter; previousReceipt = receivedNS
        previousDurationNS = UInt64(packet.samples.count / 2) * 1_000_000_000 / UInt64(packet.sampleRate)
        return clean
    }
}
