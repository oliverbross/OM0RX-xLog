// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum TCIIQSubscriptionError: Error, Equatable, Sendable {
    case unavailable, unsupportedVersion, occupied, rateConflict, connectionChanged, invalidFrame
    case overflow, noData, stalled, stopped
}

public struct TCIIQCapture: Equatable, Sendable {
    public let streamToken: UUID
    public let epoch: UInt64
    public let connectionGeneration: UInt64
    public let receiver: Int
    public let device: String
    public let protocolVersion: String
    public let centreHz: Int64
    public let sampleRate: Int
    public let lowerOffsetHz: Double
    public let upperOffsetHz: Double
    /// RF orientation and usable bandwidth still require hardware qualification.
    public let frequencyQualified: Bool = false
}

public struct TCIIQBlock: Sendable {
    public let capture: TCIIQCapture
    public let sequence: UInt64
    public let firstSample: UInt64
    public let receivedMonotonicNS: UInt64
    public let frame: TCIIQFrame
}

public struct TCIIQSubscription: Sendable {
    public let leaseID: UUID
    public let receiver: Int
    public let blocks: AsyncThrowingStream<TCIIQBlock, Error>
}

public struct TCIIQReceiverCapability: Sendable {
    public let receiver:Int
    public let enabled:Bool?
    public let centreHz:Int64?
}
public struct TCIIQCapabilities: Sendable {
    public let connectionGeneration:UInt64
    public let ready:Bool
    public let device:String?
    public let protocolVersion:String?
    public let receivers:[TCIIQReceiverCapability]
    public let lowerOffsetHz:Double?
    public let upperOffsetHz:Double?
    /// Documented requests, not a claim that these rates have streamed.
    public let requestableSampleRates:[Int]
    public let transmitStateKnownOff:Bool
}
