// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum TCIIQError: Error, Equatable, Sendable {
    case size, receiver, format, codec, scalarCount, channels, reserved, sampleRate, nonfinite
}

/// Modern 64-byte little-endian TCI IQ frame. This parser grants no radio or
/// transmit authority. Non-IQ binary types are left to their own owner.
public struct TCIIQFrame: Equatable, Sendable {
    public static let maximumBytes = 64 + 32_768 * 4
    public let receiver: Int
    public let sampleRate: Int
    public let samples: [Float]
    /// TCI 2.1 documents a counter for audio/TX_CHRONO. Retained as telemetry
    /// for IQ, without assuming an IQ continuity guarantee absent a real capture.
    public let reportedCounter: UInt32?
    public var complexSampleCount: Int { samples.count / 2 }

    public static func parse(_ data: Data, protocolVersion: TCIVersion? = nil) throws -> Self? {
        guard data.count >= 28, data.count <= maximumBytes else { throw TCIIQError.size }
        let bytes = [UInt8](data)
        func word(_ offset: Int) -> UInt32 {
            UInt32(bytes[offset]) | UInt32(bytes[offset+1]) << 8 |
            UInt32(bytes[offset+2]) << 16 | UInt32(bytes[offset+3]) << 24
        }
        guard word(24) == 0 else { return nil }
        guard bytes.count >= 64 else { throw TCIIQError.size }
        guard word(0) <= 1 else { throw TCIIQError.receiver }
        guard word(8) == 3 else { throw TCIIQError.format }
        guard word(12) == 0 else { throw TCIIQError.codec }
        guard word(28) == 2 else { throw TCIIQError.channels }
        guard [48_000, 96_000, 192_000, 384_000].contains(Int(word(4))) else { throw TCIIQError.sampleRate }
        let count = Int(word(20))
        guard count > 0, count <= 32_768, count % 2 == 0 else { throw TCIIQError.scalarCount }
        // Strict trailing policy: no hidden unused fixed-struct tail. A future
        // padded format needs its own captured fixture/version qualification.
        guard bytes.count == 64 + count * 4 else { throw TCIIQError.size }
        let hasCounter = protocolVersion == TCIVersion("2.1")
        guard word(16) == 0, bytes[(hasCounter ? 36 : 32)..<64].allSatisfy({ $0 == 0 }) else { throw TCIIQError.reserved }
        var samples = [Float](); samples.reserveCapacity(count)
        for offset in stride(from: 64, to: bytes.count, by: 4) {
            let sample = Float(bitPattern: word(offset))
            guard sample.isFinite else { throw TCIIQError.nonfinite }
            samples.append(sample)
        }
        return Self(receiver: Int(word(0)), sampleRate: Int(word(4)), samples: samples,
                    reportedCounter: hasCounter ? word(32) : nil)
    }
}

/// Semantic components: protocol 1.10 compares after 1.9, not before it.
public struct TCIVersion: Equatable, Comparable, Sendable {
    public let major: Int
    public let minor: Int
    public init?(_ string: String) {
        let pieces = string.split(separator: ".", omittingEmptySubsequences: false)
        guard pieces.count == 2, pieces.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 3 && $0.utf8.allSatisfy({ (48...57).contains($0) }) }),
              let major = Int(pieces[0]), let minor = Int(pieces[1]) else { return nil }
        self.major = major; self.minor = minor
    }
    public static func < (lhs: Self, rhs: Self) -> Bool { (lhs.major, lhs.minor) < (rhs.major, rhs.minor) }
}
