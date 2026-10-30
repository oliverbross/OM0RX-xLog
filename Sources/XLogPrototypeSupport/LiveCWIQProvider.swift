// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCWCore
import XCatIntegrationCore

/// Receiver access goes through StationRadioRegistry via LiveStationMethods.
/// This adapter has no TCP connection, radio command or transmit owner.
struct LiveCWIQProvider: CWIQSourceProviding {
    func acquire(_ source: CWSourceConfiguration, sessionID: UUID, leaseID: UUID) async throws -> AsyncThrowingStream<CWIQBlock,Error> {
        do {
            if source.provider == .flexDAXIQ {
                let subscription=try await LiveStationMethods.cwStartFlex(radioID:source.radioID,panadapterID:source.receiverID,sampleRate:source.sampleRate,leaseID:leaseID)
                return Self.adapt(subscription,source:source,sessionID:sessionID){await LiveStationMethods.cwStopFlex(radioID:source.radioID,leaseID:leaseID)}
            }
            guard source.provider == .tciIQ,let receiver=Int(source.receiverID) else {throw CWIQSourceFailure.unavailable}
            let subscription=try await LiveStationMethods.cwStartTCI(radioID:source.radioID,
                receiver:receiver,sampleRate:source.sampleRate,leaseID:leaseID)
            return Self.adapt(subscription,source:source,sessionID:sessionID) {
                await LiveStationMethods.cwStopTCI(radioID:source.radioID,leaseID:leaseID)
            }
        } catch {throw Self.failure(error)}
    }
    static func failure(_ error:Error)->CWIQSourceFailure {
        if let flex=error as? FlexIQSubscriptionError {
            switch flex {
            case .unavailable:return .unavailable
            case .stationChanged:return .captureChanged
            case .unknownOwnership:return .ownershipUnknown
            case .missingPanadapter,.missingChannel,.ambiguousChannel:return .resourceMissing
            case .busy:return .occupied
            case .handoffRequired:return .handoffRequired
            case .rateConflict:return .rateConflict
            case .invalidPacket:return .invalidSamples
            case .overflow:return .overflow
            case .noData:return .noData
            case .stalled:return .stalled
            case .stopped:return .stopped
            case .discoveryUnavailable:return .discoveryUnavailable
            case .receiveUnverified:return .receiveUnverified
            }
        }
        if let tci=error as? TCIIQSubscriptionError {
            switch tci {
            case .unavailable:return .unavailable
            case .unsupportedVersion:return .unsupportedProtocol
            case .occupied:return .occupied
            case .rateConflict:return .rateConflict
            case .connectionChanged:return .captureChanged
            case .invalidFrame:return .invalidSamples
            case .overflow:return .overflow
            case .noData:return .noData
            case .stalled:return .stalled
            case .stopped:return .stopped
            }
        }
        if error is FlexIQError || error is TCIIQError{return .invalidSamples}
        return CWIQSourceFailure.classify(error)
    }
    func current(_ source: CWSourceConfiguration,sessionID: UUID,leaseID: UUID) async -> CWStreamDescriptor? {
        if source.provider == .flexDAXIQ,let capture=await LiveStationMethods.cwFlexCapture(radioID:source.radioID,leaseID:leaseID) {
            return try? Self.descriptor(capture,source:source,sessionID:sessionID)
        }
        guard source.provider == .tciIQ,
              let capture=await LiveStationMethods.cwTCICapture(radioID:source.radioID,leaseID:leaseID) else {return nil}
        return try? Self.descriptor(capture,source:source,sessionID:sessionID)
    }
    func release(_ source: CWSourceConfiguration,leaseID: UUID) async {
        if source.provider == .tciIQ {await LiveStationMethods.cwStopTCI(radioID:source.radioID,leaseID:leaseID)}
        if source.provider == .flexDAXIQ {await LiveStationMethods.cwStopFlex(radioID:source.radioID,leaseID:leaseID)}
    }
    static func descriptor(_ capture:FlexIQCapture,source:CWSourceConfiguration,sessionID:UUID) throws -> CWStreamDescriptor {
        guard FlexIQResourceInventory.handle(source.receiverID).map(FlexIQResourceInventory.identifier)==capture.panadapter.id,
              let centre=capture.panadapter.centreHz,capture.sampleRate==source.sampleRate else{throw CWContractError.staleEpoch}
        // Digital Nyquist interval only. Spectral orientation and usable RF
        // coverage stay unqualified until measured on the specific hardware.
        return try CWStreamDescriptor(sessionID:sessionID,sourceID:source.id,radioID:source.radioID,provider:.flexDAXIQ,
            receiverID:source.receiverID,streamToken:capture.streamToken,epoch:String(capture.epoch),centreHz:centre,
            sampleRate:capture.sampleRate,spectralSign:nil,usableLowerHz:centre-Int64(capture.sampleRate/2),
            usableUpperHz:centre+Int64(capture.sampleRate/2),mappingQualified:false)
    }
    static func adapt(_ subscription:FlexIQSubscription,source:CWSourceConfiguration,sessionID:UUID,
                      stop:@escaping @Sendable () async -> Void)->AsyncThrowingStream<CWIQBlock,Error> {
        let pair=AsyncThrowingStream<CWIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(4))
        let reader=Task {
            var token:UUID?,sequence:UInt64=0,base:UInt64=0
            do {
                for try await block in subscription.blocks {
                    try Task.checkCancellation()
                    let descriptor=try Self.descriptor(block.capture,source:source,sessionID:sessionID)
                    if token != descriptor.streamToken{token=descriptor.streamToken;sequence=0;base=block.firstSample}
                    guard block.firstSample>=base else{throw CWContractError.discontinuity}
                    let count=block.packet.samples.count/2,limit=min(8192,descriptor.sampleRate/8)
                    for start in stride(from:0,to:count,by:limit) {
                        let end=min(start+limit,count)
                        guard sequence<UInt64.max,UInt64(start)<=UInt64.max-(block.firstSample-base) else{throw CWContractError.discontinuity}
                        let converted=try CWIQBlock(descriptor:descriptor,sequence:sequence,firstSample:block.firstSample-base+UInt64(start),
                            receivedMonotonicNS:block.receivedMonotonicNS,samples:Array(block.packet.samples[start*2..<end*2]))
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
            } catch {pair.continuation.finish(throwing:Self.failure(error))}
        }
        pair.continuation.onTermination={_ in reader.cancel();Task{await stop()}}
        return pair.stream
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
            } catch {pair.continuation.finish(throwing:Self.failure(error))}
        }
        pair.continuation.onTermination = {_ in reader.cancel();Task{await stop()}}
        return pair.stream
    }
}
#endif
