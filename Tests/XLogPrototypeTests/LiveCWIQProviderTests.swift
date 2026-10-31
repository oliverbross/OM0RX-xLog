import Foundation
import XCTest
import XCWCore
@testable import XCatIntegrationCore
@testable import XLogPrototypeSupport
#if os(macOS)
final class LiveCWIQProviderTests:XCTestCase {
    private func source(rate:Int=192000) throws -> CWSourceConfiguration {
        try CWSourceConfiguration(radioID:"radio2",provider:.tciIQ,receiverID:"1",sampleRate:rate)
    }
    private func capture(token:UUID=UUID(),epoch:UInt64=1,rate:Int=192000) -> TCIIQCapture {
        TCIIQCapture(streamToken:token,epoch:epoch,connectionGeneration:7,receiver:1,device:"SunSDR2DX",protocolVersion:"2.1",
            centreHz:14025000,sampleRate:rate,lowerOffsetHz:-39000,upperOffsetHz:39000)
    }
    private func frame(samples:Int=16000,rate:Int=192000) throws -> TCIIQFrame {
        var data=Data(repeating:0,count:64+samples*8)
        for (offset,value):(Int,UInt32) in [(0,1),(4,UInt32(rate)),(8,3),(20,UInt32(samples*2)),(28,2)] {
            for i in 0..<4{data[offset+i]=UInt8(truncatingIfNeeded:value>>(i*8))}
        }
        return try XCTUnwrap(TCIIQFrame.parse(data,protocolVersion:TCIVersion("2.1")))
    }
    func testPacketSplittingPreservesCaptureSampleClockAndResetsSequenceOnEpoch() async throws {
        let pair=AsyncThrowingStream<TCIIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(2))
        let sub=TCIIQSubscription(leaseID:UUID(),receiver:1,blocks:pair.stream),source=try source(),session=UUID(),first=capture()
        let stream=LiveCWIQProvider.adapt(sub,source:source,sessionID:session,stop:{})
        var iterator=stream.makeAsyncIterator()
        pair.continuation.yield(TCIIQBlock(capture:first,sequence:0,firstSample:0,receivedMonotonicNS:1234,frame:try frame()))
        let firstValue=try await iterator.next(),secondValue=try await iterator.next()
        let a=try XCTUnwrap(firstValue),b=try XCTUnwrap(secondValue)
        XCTAssertEqual(a.sampleCount,8192);XCTAssertEqual(b.sampleCount,7808)
        XCTAssertEqual(a.firstSample,0);XCTAssertEqual(b.firstSample,8192)
        XCTAssertEqual(a.sequence,0);XCTAssertEqual(b.sequence,1)
        XCTAssertEqual(a.receivedMonotonicNS,1234);XCTAssertEqual(b.receivedMonotonicNS,1234)
        XCTAssertEqual(a.descriptor.sessionID,session);XCTAssertEqual(a.descriptor.sourceID,source.id)
        let changed=capture(epoch:2)
        pair.continuation.yield(TCIIQBlock(capture:changed,sequence:0,firstSample:0,receivedMonotonicNS:2345,frame:try frame(samples:4)))
        let changedValue=try await iterator.next(),c=try XCTUnwrap(changedValue)
        XCTAssertEqual(c.sequence,0);XCTAssertEqual(c.firstSample,0);XCTAssertEqual(c.descriptor.streamToken,changed.streamToken)
        XCTAssertFalse(c.descriptor.mappingQualified);XCTAssertNil(c.descriptor.spectralSign)
        pair.continuation.finish();let end=try await iterator.next();XCTAssertNil(end)
    }
    func testDescriptorClipsCoverageAndRejectsUnrequestedRate() throws {
        let session=UUID(),source=try source(rate:48000)
        let value=try LiveCWIQProvider.descriptor(capture(rate:48000),source:source,sessionID:session)
        XCTAssertEqual(value.usableLowerHz,14001000);XCTAssertEqual(value.usableUpperHz,14049000)
        XCTAssertThrowsError(try LiveCWIQProvider.descriptor(capture(rate:96000),source:source,sessionID:session))
        XCTAssertThrowsError(try value.frequency(offsetHz:1000))
    }
    func testMalformedCaptureFailsStreamAndReleasesOnlyItsLease() async throws {
        let pair=AsyncThrowingStream<TCIIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(2)),stops=CWProviderStopCounter()
        let stream=LiveCWIQProvider.adapt(TCIIQSubscription(leaseID:UUID(),receiver:1,blocks:pair.stream),
            source:try source(rate:48000),sessionID:UUID(),stop:{await stops.increment()})
        var iterator=stream.makeAsyncIterator()
        pair.continuation.yield(TCIIQBlock(capture:capture(),sequence:0,firstSample:0,receivedMonotonicNS:0,frame:try frame(samples:4)))
        do {_ = try await iterator.next();XCTFail("Mismatched capture must fail")}
        catch {XCTAssertEqual(error as? CWIQSourceFailure,.captureChanged)}
        for _ in 0..<100 {if await stops.value()>0{break};try await Task.sleep(nanoseconds:1_000_000)}
        let count=await stops.value();XCTAssertEqual(count,1)
        pair.continuation.finish()
    }
    func testFlexCaptureRemainsUnqualifiedAndSharedLeaseClockStartsAtZero() async throws {
        let source=try CWSourceConfiguration(radioID:"radio1",provider:.flexDAXIQ,receiverID:"40000000",sampleRate:96000)
        let identity=FlexIQIdentity(serial:"FIXTURE-8400",model:"FLEX-8400",address:"127.0.0.1",controlPort:4992)
        let capture=FlexIQCapture(streamToken:UUID(),epoch:8,connectionGeneration:3,identity:identity,stationHandle:0x1234,
            panadapter:FlexIQPanadapter(id:"40000000",clientHandle:0x1234,channel:1,centreHz:14025000,receiveAntenna:"ANT1"),streamID:0x80000001,sampleRate:96000,udpSourcePort:4991)
        let packet=FlexIQPacket(streamID:0x80000001,packetCounter:0,sampleRate:96000,integerTimestamp:nil,fractionalTimestamp:nil,samples:[Float](repeating:0,count:128))
        let pair=AsyncThrowingStream<FlexIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(2))
        let adapted=LiveCWIQProvider.adapt(FlexIQSubscription(leaseID:UUID(),blocks:pair.stream),source:source,sessionID:UUID(),stop:{})
        var iterator=adapted.makeAsyncIterator()
        pair.continuation.yield(FlexIQBlock(capture:capture,sequence:10,firstSample:640,receivedMonotonicNS:1234,packet:packet))
        let first=try await iterator.next(),value=try XCTUnwrap(first)
        XCTAssertEqual(value.firstSample,0);XCTAssertEqual(value.sequence,0);XCTAssertEqual(value.sampleCount,64)
        XCTAssertEqual(value.descriptor.centreHz,14025000);XCTAssertEqual(value.descriptor.provider,.flexDAXIQ)
        XCTAssertFalse(value.descriptor.mappingQualified);XCTAssertNil(value.descriptor.spectralSign)
        pair.continuation.yield(FlexIQBlock(capture:capture,sequence:11,firstSample:704,receivedMonotonicNS:2345,packet:packet))
        let second=try await iterator.next();XCTAssertEqual(second?.firstSample,64);XCTAssertEqual(second?.sequence,1)
        pair.continuation.finish()
    }
    func testUnsupportedTCIContractRetainsTypedFailureAndScopedRelease() async throws {
        let pair=AsyncThrowingStream<TCIIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(2)),stops=CWProviderStopCounter()
        let stream=LiveCWIQProvider.adapt(TCIIQSubscription(leaseID:UUID(),receiver:1,blocks:pair.stream),
            source:try source(),sessionID:UUID(),stop:{await stops.increment()})
        var iterator=stream.makeAsyncIterator()
        pair.continuation.finish(throwing:TCIIQSubscriptionError.unsupportedVersion)
        do{_ = try await iterator.next();XCTFail("Unsupported contract must fail visibly")}
        catch{XCTAssertEqual(error as? CWIQSourceFailure,.unsupportedProtocol)}
        for _ in 0..<100 {if await stops.value()>0{break};try await Task.sleep(nanoseconds:1_000_000)}
        let count=await stops.value();XCTAssertEqual(count,1)
    }
    func testKnownProviderReasonsRemainSpecificAndUnknownErrorsDoNotLeakText() {
        for (error,expected):(Error,CWIQSourceFailure) in [
            (FlexIQSubscriptionError.discoveryUnavailable,.discoveryUnavailable),
            (FlexIQSubscriptionError.receiveUnverified,.receiveUnverified),
            (FlexIQSubscriptionError.handoffRequired,.handoffRequired),
            (FlexIQSubscriptionError.unknownOwnership,.ownershipUnknown),
            (FlexIQSubscriptionError.missingChannel,.resourceMissing),
            (TCIIQSubscriptionError.occupied,.occupied),(TCIIQSubscriptionError.rateConflict,.rateConflict)] {
            XCTAssertEqual(LiveCWIQProvider.failure(error),expected)
        }
        let unknown=WorkerFailure("private_code","private endpoint/credential must stay out of snapshots")
        XCTAssertEqual(LiveCWIQProvider.failure(unknown),.unavailable)
        XCTAssertFalse(LiveCWIQProvider.failure(unknown).operatorMessage.contains("credential"))
    }
}
private actor CWProviderStopCounter {
    private var count=0
    func increment(){count+=1}
    func value()->Int{count}
}
#endif
