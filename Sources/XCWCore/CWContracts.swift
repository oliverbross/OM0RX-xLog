// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum CWProvider: String, Codable, Sendable { case flexDAXIQ = "flex_dax_iq", tciIQ = "tci_iq", replay }
public enum CWSourceState: String, Codable, Sendable { case stopped, preparing, acquiring, running, quarantined, muted, recovering, blocked, stopping }
public enum CWContractError: Error, Equatable { case invalidDescriptor, invalidSamples, staleEpoch, discontinuity, sizeLimit, invalidConfiguration }

/// Immutable capture identity. A change to any frequency/path/transport field
/// requires a fresh token/epoch before accepting more samples.
public struct CWStreamDescriptor: Encodable, Equatable, Sendable {
    public let sessionID: UUID
    public let sourceID: UUID
    public let radioID: String
    public let provider: CWProvider
    public let receiverID: String
    public let streamToken: UUID
    public let epoch: String
    public let centreHz: Int64
    public let sampleRate: Int
    public let spectralSign: Int?
    public let usableLowerHz: Int64
    public let usableUpperHz: Int64
    public let mappingQualified: Bool
    public let replay: Bool
    public let timestampBasis: String

    public init(sessionID: UUID, sourceID: UUID, radioID: String, provider: CWProvider,
                receiverID: String, streamToken: UUID = UUID(), epoch: String, centreHz: Int64,
                sampleRate: Int, spectralSign: Int?, usableLowerHz: Int64, usableUpperHz: Int64,
                mappingQualified: Bool = false, replay: Bool = false,
                timestampBasis: String = "host_monotonic_receipt") throws {
        guard ["radio1", "radio2"].contains(radioID), !receiverID.isEmpty, receiverID.utf8.count <= 128,
              let epochNumber = UInt64(epoch), String(epochNumber) == epoch,
              [24_000, 48_000, 96_000, 192_000, 384_000].contains(sampleRate),
              (100_000...1_000_000_000).contains(centreHz),
              usableLowerHz > 0, usableLowerHz < usableUpperHz,
              usableLowerHz >= centreHz - Int64(sampleRate / 2),
              usableUpperHz <= centreHz + Int64(sampleRate / 2),
              spectralSign == nil || spectralSign == -1 || spectralSign == 1,
              !mappingQualified || spectralSign != nil,
              provider != .replay || replay,
              ["host_monotonic_receipt", "verified_source_timestamp"].contains(timestampBasis)
        else { throw CWContractError.invalidDescriptor }
        self.sessionID = sessionID; self.sourceID = sourceID; self.radioID = radioID; self.provider = provider
        self.receiverID = receiverID; self.streamToken = streamToken; self.epoch = epoch; self.centreHz = centreHz
        self.sampleRate = sampleRate; self.spectralSign = spectralSign; self.usableLowerHz = usableLowerHz
        self.usableUpperHz = usableUpperHz; self.mappingQualified = mappingQualified
        self.replay = replay; self.timestampBasis = timestampBasis
    }

    public func frequency(offsetHz: Double) throws -> Int64 {
        guard let sign = spectralSign, offsetHz.isFinite, abs(offsetHz) <= Double(sampleRate) / 2 else {
            throw CWContractError.invalidDescriptor
        }
        let value = centreHz + Int64((offsetHz * Double(sign)).rounded())
        guard (usableLowerHz...usableUpperHz).contains(value) else { throw CWContractError.invalidDescriptor }
        return value
    }
}

public struct CWIQBlock: Sendable {
    public let descriptor: CWStreamDescriptor
    public let sequence: UInt64
    public let firstSample: UInt64
    public let receivedMonotonicNS: UInt64
    /// Interleaved I,Q; no JSON serialization or renderer transport.
    public let samples: [Float]
    public var sampleCount: Int { samples.count / 2 }
    public init(descriptor: CWStreamDescriptor, sequence: UInt64, firstSample: UInt64,
                receivedMonotonicNS: UInt64, samples: [Float]) throws {
        guard !samples.isEmpty, samples.count % 2 == 0, samples.count <= 32_768,
              UInt64(samples.count / 2) <= UInt64.max - firstSample,
              samples.allSatisfy(\.isFinite) else { throw CWContractError.invalidSamples }
        self.descriptor = descriptor; self.sequence = sequence; self.firstSample = firstSample
        self.receivedMonotonicNS = receivedMonotonicNS; self.samples = samples
    }
}

/// Rejects gaps/duplicate/out-of-order delivery, including identical samples
/// presented under a new sequence. Overflow is a discontinuity, never a wrap.
public struct CWContinuityGate: Sendable {
    private var descriptor: CWStreamDescriptor?
    private var nextSequence: UInt64 = 0
    private var nextSample: UInt64 = 0
    public init() {}
    public mutating func reset() { descriptor = nil; nextSequence = 0; nextSample = 0 }
    public mutating func accept(_ block: CWIQBlock, now: UInt64) throws {
        guard now >= block.receivedMonotonicNS, now - block.receivedMonotonicNS <= 250_000_000 else {
            reset(); throw CWContractError.discontinuity
        }
        if let descriptor {
            guard descriptor == block.descriptor else { reset(); throw CWContractError.staleEpoch }
            guard nextSequence == block.sequence, nextSample == block.firstSample else {
                reset(); throw CWContractError.discontinuity
            }
        }
        guard block.sequence < UInt64.max else { reset(); throw CWContractError.discontinuity }
        descriptor = block.descriptor; nextSequence = block.sequence + 1
        nextSample = block.firstSample + UInt64(block.sampleCount)
    }
}
