// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCWCore
import XCatIntegrationCore

/// Receiver access goes through StationRadioRegistry via LiveStationMethods.
/// This adapter has no TCP connection, radio command or transmit owner.
struct LiveCWIQProvider: CWIQSourceProviding {
    func acquire(_ source: CWSourceConfiguration, sessionID: UUID, leaseID: UUID) async throws -> AsyncThrowingStream<CWIQBlock,Error> {
        guard source.provider == .tciIQ,let receiver=Int(source.receiverID) else {
            throw WorkerFailure("cw_source_unavailable","The selected IQ source is not available.")
        }
        let subscription=try await LiveStationMethods.cwStartTCI(radioID:source.radioID,
            receiver:receiver,sampleRate:source.sampleRate,leaseID:leaseID)
        return Self.adapt(subscription,source:source,sessionID:sessionID) {
            await LiveStationMethods.cwStopTCI(radioID:source.radioID,leaseID:leaseID)
        }
    }
    func current(_ source: CWSourceConfiguration,sessionID: UUID,leaseID: UUID) async -> CWStreamDescriptor? {
        guard source.provider == .tciIQ,
              let capture=await LiveStationMethods.cwTCICapture(radioID:source.radioID,leaseID:leaseID) else {return nil}
        return try? Self.descriptor(capture,source:source,sessionID:sessionID)
    }
    func release(_ source: CWSourceConfiguration,leaseID: UUID) async {
        if source.provider == .tciIQ {await LiveStationMethods.cwStopTCI(radioID:source.radioID,leaseID:leaseID)}
    }
    static func descriptor(_ capture: TCIIQCapture,source: CWSourceConfiguration,sessionID: UUID) throws -> CWStreamDescriptor {
        guard capture.receiver==Int(source.receiverID),capture.sampleRate==source.sampleRate else {throw CWContractError.staleEpoch}
        let lower=max(capture.lowerOffsetHz,-Double(capture.sampleRate)/2)
        let upper=min(capture.upperOffsetHz,Double(capture.sampleRate)/2)
        guard lower.isFinite,upper.isFinite,lower<upper else {throw CWContractError.invalidDescriptor}
        return try CWStreamDescriptor(sessionID:sessionID,sourceID:source.id,radioID:source.radioID,provider:.tciIQ,
            receiverID:source.receiverID,streamToken:capture.streamToken,epoch:String(capture.epoch),centreHz:capture.centreHz,
            sampleRate:capture.sampleRate,spectralSign:nil,
            usableLowerHz:capture.centreHz+Int64(lower.rounded(.up)),usableUpperHz:capture.centreHz+Int64(upper.rounded(.down)),
            mappingQualified:false)
    }
    /// Split a provider packet only at complex-sample boundaries. The resulting
    /// compute sequence is local; firstSample retains the provider continuity.
    static func adapt(_ subscription: TCIIQSubscription,source: CWSourceConfiguration,sessionID: UUID,
                      stop: @escaping @Sendable () async -> Void) -> AsyncThrowingStream<CWIQBlock,Error> {
        let pair=AsyncThrowingStream<CWIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(4))
        let reader=Task {
            var token:UUID?,sequence:UInt64=0
            do {
                for try await block in subscription.blocks {
                    try Task.checkCancellation()
                    let descriptor=try Self.descriptor(block.capture,source:source,sessionID:sessionID)
                    if token != descriptor.streamToken {token=descriptor.streamToken;sequence=0}
                    let limit=min(8192,descriptor.sampleRate/8)
                    for start in stride(from:0,to:block.frame.complexSampleCount,by:limit) {
                        let end=min(start+limit,block.frame.complexSampleCount)
                        guard sequence<UInt64.max,UInt64(start)<=UInt64.max-block.firstSample else {throw CWContractError.discontinuity}
                        let converted=try CWIQBlock(descriptor:descriptor,sequence:sequence,firstSample:block.firstSample+UInt64(start),
                            receivedMonotonicNS:block.receivedMonotonicNS,samples:Array(block.frame.samples[start*2..<end*2]))
                        sequence+=1
                        switch pair.continuation.yield(converted) {
                        case .enqueued:break
                        case .dropped:throw CWComputeError.inputOverflow
                        case .terminated:throw CancellationError()
                        @unknown default:throw CWComputeError.inputOverflow
                        }
                    }
                }
                pair.continuation.finish()
            } catch {pair.continuation.finish(throwing:error)}
        }
        pair.continuation.onTermination = {_ in reader.cancel();Task{await stop()}}
        return pair.stream
    }
}
#endif
