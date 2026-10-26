import Foundation
import XCTest
@testable import XCWCore
#if os(macOS)
final class CWDecodeSessionTests: XCTestCase {
    private let resources=CWComputeResources(executable:URL(fileURLWithPath:"/unused/worker"),model:URL(fileURLWithPath:"/unused/model"),
        runtime:URL(fileURLWithPath:"/unused/runtime"),executableSHA256:"",runtimeSHA256:"",runtimeVersion:"test")
    private func source(_ receiver:String="0",radio:String="radio1") throws -> CWSourceConfiguration {
        try CWSourceConfiguration(radioID:radio,provider:.tciIQ,receiverID:receiver)
    }
    private func wait(_ predicate:() async -> Bool) async throws {
        for _ in 0..<1000 {if await predicate(){return};try await Task.sleep(nanoseconds:1_000_000)}
        XCTFail("Timed out waiting for decoder state")
    }
    func testSnapshotsArePassiveAndStopCancelsPendingAcquire() async throws {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute()
        await provider.setHold(true)
        let session=CWDecodeSession(provider:provider,compute:compute)
        let initial=await session.snapshot(),initialCounts=await compute.counts(),initialLeases=await provider.leaseCount()
        XCTAssertEqual(initial.state,"stopped");XCTAssertEqual(initialCounts.starts,0);XCTAssertEqual(initialLeases,0)
        try await session.start(configuration:CWDecodeConfiguration(sources:[source()]),resources:resources)
        try await wait{await provider.leaseCount()==1}
        await session.stop();await provider.resumeAcquire()
        try await Task.sleep(nanoseconds:10_000_000)
        let stopped=await session.snapshot(),counts=await compute.counts(),releases=await provider.releaseCount()
        XCTAssertEqual(stopped.state,"stopped");XCTAssertTrue(stopped.tracks.isEmpty)
        XCTAssertEqual(counts.opens,0);XCTAssertEqual(releases,1)
    }
    func testTXAndRetuneRejectLateCopyAndPreserveOtherSource() async throws {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute(),a=try source(),b=try source("1")
        let session=CWDecodeSession(provider:provider,compute:compute)
        try await session.start(configuration:CWDecodeConfiguration(sources:[a,b]),resources:resources)
        try await wait{await provider.leaseCount()==2}
        let first=try await provider.emit(a.id),second=try await provider.emit(b.id)
        try await wait{await compute.counts().sends==2}
        let firstTrack=track(first),secondTrack=track(second)
        await compute.emit(.track(firstTrack));await compute.emit(.track(secondTrack))
        try await wait{await session.snapshot().tracks.count==2}
        await provider.invalidate(a.id)
        await compute.emit(.track(firstTrack))
        try await wait{await session.snapshot().tracks.count==1}
        let muted=await session.snapshot();XCTAssertEqual(muted.tracks.first?.sourceID,b.id)
        let changed=try await provider.emit(a.id,newEpoch:true)
        try await wait{await compute.counts().sends==3}
        await compute.emit(.track(firstTrack));await compute.emit(.track(track(changed)))
        try await wait{await session.snapshot().tracks.count==2}
        let resumed=await session.snapshot()
        XCTAssertFalse(resumed.tracks.contains{$0.descriptor.streamToken==first.streamToken})
        XCTAssertTrue(resumed.tracks.allSatisfy{$0.frequencyHz==nil})
        XCTAssertFalse(resumed.automaticSpotsQualified)
        await session.stop()
    }
    func testStaleCopyDisappearsWithoutReopeningSameEpoch() async throws {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute(),clock=CWSessionTestClock(),a=try source()
        let session=CWDecodeSession(provider:provider,compute:compute,clock:{clock.now()})
        try await session.start(configuration:CWDecodeConfiguration(sources:[a]),resources:resources)
        try await wait{await provider.leaseCount()==1}
        let descriptor=try await provider.emit(a.id,receipt:clock.now())
        try await wait{await compute.counts().sends==1}
        await compute.emit(.track(track(descriptor)))
        try await wait{await session.snapshot().tracks.count==1}
        clock.advance(300_000_000)
        try await wait{await session.snapshot().tracks.isEmpty}
        _ = try await provider.emit(a.id,receipt:clock.now())
        try await wait{await compute.counts().sends==2}
        let counts=await compute.counts();XCTAssertEqual(counts.opens,1)
        await session.stop()
    }
    func testSourceRetriesAreBoundedAndDoNotRestartHealthySource() async throws {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute(),a=try source(),b=try source("1"),sleeps=CWSessionTestSleeps()
        await provider.failSource(a.id)
        let session=CWDecodeSession(provider:provider,compute:compute,sleep:{await sleeps.record($0)})
        try await session.start(configuration:CWDecodeConfiguration(sources:[a,b]),resources:resources)
        try await wait{await session.snapshot().sources.first{$0.configuration.id==a.id}?.state == .blocked}
        let delays=await sleeps.values(),attempts=await provider.attempts(a.id),healthyAttempts=await provider.attempts(b.id)
        XCTAssertEqual(delays,[1_000_000_000,2_000_000_000,4_000_000_000]);XCTAssertEqual(attempts,4);XCTAssertEqual(healthyAttempts,1)
        _ = try await provider.emit(b.id)
        try await wait{await compute.counts().sends==1}
        await session.stop()
    }
    func testChildRetriesStopAfterThreeBackoffs() async throws {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute(),sleeps=CWSessionTestSleeps()
        await compute.failStarts()
        let session=CWDecodeSession(provider:provider,compute:compute,sleep:{await sleeps.record($0)})
        try await session.start(configuration:CWDecodeConfiguration(sources:[source()]),resources:resources)
        let snapshot=await session.snapshot(),counts=await compute.counts(),delays=await sleeps.values(),leases=await provider.leaseCount()
        XCTAssertEqual(snapshot.state,"blocked");XCTAssertEqual(counts.starts,4);XCTAssertEqual(leases,0)
        XCTAssertEqual(delays,[1_000_000_000,2_000_000_000,4_000_000_000])
        await session.stop()
    }
    private func track(_ descriptor:CWStreamDescriptor) -> CWNativeTrack {
        CWNativeTrack(kind:"track",streamToken:descriptor.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased(),
            epoch:UInt64(descriptor.epoch)!,trackID:UUID().uuidString,revision:0,state:"acquiring",firstSample:0,endSample:0,
            sourceFirstSample:0,filterDelaySeconds:0.02,offsetHz:600,ambiguous:false,replay:false)
    }
}
private actor CWSessionTestSleeps {
    private var delays:[UInt64]=[]
    func record(_ delay:UInt64){delays.append(delay)}
    func values()->[UInt64]{delays}
}
private final class CWSessionTestClock:@unchecked Sendable {
    private let lock=NSLock();private var value:UInt64=1_000_000_000
    func now()->UInt64{lock.lock();defer{lock.unlock()};return value}
    func advance(_ amount:UInt64){lock.lock();value+=amount;lock.unlock()}
}
private actor CWSessionTestCompute:CWComputeControlling {
    struct Counts {var starts=0,opens=0,sends=0,ends=0,stops=0}
    private var count=Counts(),fail=false
    private var events:AsyncThrowingStream<CWComputeEvent,Error>.Continuation?
    func counts()->Counts{count}
    func failStarts(){fail=true}
    func start(resources:CWComputeResources) throws -> AsyncThrowingStream<CWComputeEvent,Error> {
        count.starts+=1;if fail{throw CWComputeError.resourceValidation}
        let pair=AsyncThrowingStream<CWComputeEvent,Error>.makeStream(bufferingPolicy:.bufferingOldest(64))
        events=pair.continuation;events?.yield(.ready(runtime:"test"));return pair.stream
    }
    func emit(_ event:CWComputeEvent){events?.yield(event)}
    func open(_ descriptor:CWStreamDescriptor){count.opens+=1}
    func send(_ block:CWIQBlock){count.sends+=1}
    func end(_ descriptor:CWStreamDescriptor,gap:Bool){count.ends+=1}
    func stop(){count.stops+=1;events?.finish();events=nil}
}
private actor CWSessionTestProvider:CWIQSourceProviding {
    private struct Lease {
        let id:UUID,source:CWSourceConfiguration,session:UUID
        let continuation:AsyncThrowingStream<CWIQBlock,Error>.Continuation
        var descriptor:CWStreamDescriptor?,sequence:UInt64=0,sample:UInt64=0
    }
    private var leases:[UUID:Lease]=[:],failed:Set<UUID>=[],counts:[UUID:Int]=[:]
    private var releases=0,hold=false,waiter:CheckedContinuation<Void,Never>?
    func setHold(_ value:Bool){hold=value}
    func resumeAcquire(){hold=false;waiter?.resume();waiter=nil}
    func failSource(_ id:UUID){failed.insert(id)}
    func attempts(_ id:UUID)->Int{counts[id,default:0]}
    func leaseCount()->Int{leases.count}
    func releaseCount()->Int{releases}
    func acquire(_ source:CWSourceConfiguration,sessionID:UUID,leaseID:UUID) async throws -> AsyncThrowingStream<CWIQBlock,Error> {
        counts[source.id,default:0]+=1
        if failed.contains(source.id){throw CWComputeError.stopped}
        let pair=AsyncThrowingStream<CWIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(4))
        leases[source.id]=Lease(id:leaseID,source:source,session:sessionID,continuation:pair.continuation)
        if hold{await withCheckedContinuation{waiter=$0}}
        return pair.stream
    }
    func current(_ source:CWSourceConfiguration,sessionID:UUID,leaseID:UUID)->CWStreamDescriptor? {
        guard let lease=leases[source.id],lease.session==sessionID,lease.id==leaseID else{return nil}
        return lease.descriptor
    }
    func release(_ source:CWSourceConfiguration,leaseID:UUID){
        releases+=1;guard leases[source.id]?.id==leaseID else{return}
        leases.removeValue(forKey:source.id)?.continuation.finish()
    }
    func invalidate(_ id:UUID){leases[id]?.descriptor=nil}
    func emit(_ id:UUID,newEpoch:Bool=false,receipt:UInt64=DispatchTime.now().uptimeNanoseconds) throws -> CWStreamDescriptor {
        var lease=try XCTUnwrap(leases[id])
        if lease.descriptor==nil || newEpoch {
            lease.descriptor=try CWStreamDescriptor(sessionID:lease.session,sourceID:id,radioID:lease.source.radioID,
                provider:lease.source.provider,receiverID:lease.source.receiverID,epoch:newEpoch ? "2":"1",centreHz:14025000,
                sampleRate:96000,spectralSign:nil,usableLowerHz:13986000,usableUpperHz:14064000)
            lease.sequence=0;lease.sample=0
        }
        let descriptor=lease.descriptor!
        let block=try CWIQBlock(descriptor:descriptor,sequence:lease.sequence,firstSample:lease.sample,
            receivedMonotonicNS:receipt,samples:[Float](repeating:0,count:512))
        lease.sequence+=1;lease.sample+=256;lease.continuation.yield(block);leases[id]=lease
        return descriptor
    }
}
#endif
