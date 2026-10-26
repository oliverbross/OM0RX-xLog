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
    func testCommittedIdentityEntersBoundedAcceptedOutputAndRetuneFencesQueuedSpot() async throws {
        try await spotFixture(qualifiedForTests:true)
    }
    func testProductionPolicyCannotEmitEvenWithPreferenceAndQualifiedFixtureRF() async throws {
        try await spotFixture(qualifiedForTests:false)
    }
    func testManualSelectionHasNativeCallWithoutInventingUnqualifiedFrequency() async throws {
        let (session,_,_,_,_,_)=try await selectionFixture()
        let snapshot=await session.snapshot(),selection=try XCTUnwrap(snapshot.tracks.first?.selection)
        let result=try await session.resolveSelection(selection.reference)
        XCTAssertEqual(result.callsign,"K1ABC");XCTAssertEqual(result.radioID,"radio1");XCTAssertNil(result.frequencyHz)
        do {_ = try await session.resolveSelection(selection.reference,requireFrequency:true);XCTFail("Unqualified tune target accepted")}
        catch {XCTAssertEqual(error as? CWTrackSelectionError,.frequencyUnqualified)}
        await session.stop()
        do {_ = try await session.resolveSelection(selection.reference);XCTFail("Stopped selection accepted")}
        catch {XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
    }
    func testSelectionPinsEvidenceAndRejectsStaleInputOrChangedProvider() async throws {
        let (session,provider,_,clock,source,_)=try await selectionFixture(qualified:true)
        let snapshot=await session.snapshot(),selection=try XCTUnwrap(snapshot.tracks.first?.selection),reference=selection.reference
        let result=try await session.resolveSelection(reference,requireFrequency:true)
        XCTAssertEqual(result.frequencyHz,14025600)
        let invented=CWTrackReference(sessionID:reference.sessionID,sourceID:reference.sourceID,streamToken:reference.streamToken,
            epoch:reference.epoch,trackID:reference.trackID,revision:reference.revision,selectionID:UUID())
        do {_ = try await session.resolveSelection(invented);XCTFail("Invented selection accepted")}
        catch {XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
        clock.advance(300_000_000)
        do {_ = try await session.resolveSelection(reference);XCTFail("Stale input accepted")}
        catch {XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
        _ = try await provider.emit(source.id,receipt:clock.now(),qualified:true)
        await provider.invalidate(source.id)
        do {_ = try await session.resolveSelection(reference);XCTFail("Changed provider accepted")}
        catch {XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
        await session.stop()
    }
    func testStopDuringProviderReadCannotResolveOldSelection() async throws {
        let (session,provider,_,_,_,_)=try await selectionFixture()
        let snapshot=await session.snapshot(),selection=try XCTUnwrap(snapshot.tracks.first?.selection)
        await provider.setCurrentHold()
        let resolving=Task{try await session.resolveSelection(selection.reference)}
        try await wait{await provider.currentWaiterCount()>0}
        await session.stop();await provider.resumeCurrent()
        do {_ = try await resolving.value;XCTFail("Selection survived Stop during readback")}
        catch {XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
    }
    func testAmbiguousTrackClearsRetainedManualSelection() async throws {
        let (session,_,compute,_,_,capture)=try await selectionFixture()
        let snapshot=await session.snapshot(),view=try XCTUnwrap(snapshot.tracks.first),selection=try XCTUnwrap(view.selection)
        let ambiguous=CWNativeTrack(kind:"track",streamToken:capture.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased(),
            epoch:1,trackID:view.trackID,revision:0,state:"ambiguous",firstSample:3200,endSample:22400,sourceFirstSample:0,
            filterDelaySeconds:0.02,offsetHz:600,ambiguous:true,replay:false)
        await compute.emit(.track(ambiguous))
        try await wait{await session.snapshot().tracks.first?.selection==nil}
        do {_ = try await session.resolveSelection(selection.reference);XCTFail("Ambiguous identity remained selectable")}
        catch {XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
        await session.stop()
    }
    func testSignalEstimatesSurviveMetadataOnlyUpdatesAndExpireWithoutAnotherDecode() async throws {
        let (session,_,compute,clock,_,capture)=try await selectionFixture(measured:true)
        let initial=await session.snapshot(),view=try XCTUnwrap(initial.tracks.first)
        XCTAssertEqual(view.estimatedWPM,24);XCTAssertEqual(view.estimatedSNRDB,12)
        let metadata=CWNativeTrack(kind:"track",streamToken:capture.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased(),
            epoch:1,trackID:view.trackID,revision:0,state:"acquiring",firstSample:3200,endSample:22400,sourceFirstSample:0,
            filterDelaySeconds:0.02,offsetHz:601,ambiguous:false,replay:false)
        await compute.emit(.track(metadata))
        try await wait{await session.snapshot().tracks.first?.offsetHz==601}
        let retained=await session.snapshot();XCTAssertEqual(retained.tracks.first?.estimatedWPM,24)
        XCTAssertEqual(retained.tracks.first?.estimatedSNRDB,12);XCTAssertEqual(retained.tracks.first?.snrReferenceHz,2500)
        clock.advance(2_000_000_001)
        let expired=await session.snapshot();XCTAssertNil(expired.tracks.first?.estimatedWPM)
        XCTAssertNil(expired.tracks.first?.estimatedSNRDB);XCTAssertNil(expired.tracks.first?.snrReferenceHz)
        await session.stop()
    }
    func testAmbiguityClearsMeasuredEstimates() async throws {
        let (session,_,compute,_,_,capture)=try await selectionFixture(measured:true)
        let initial=await session.snapshot(),view=try XCTUnwrap(initial.tracks.first)
        let metadata=CWNativeTrack(kind:"track",streamToken:capture.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased(),
            epoch:1,trackID:view.trackID,revision:0,state:"ambiguous",firstSample:3200,endSample:22400,sourceFirstSample:0,
            filterDelaySeconds:0.02,offsetHz:600,ambiguous:true,replay:false)
        await compute.emit(.track(metadata))
        try await wait{await session.snapshot().tracks.first?.ambiguous==true}
        let ambiguous=await session.snapshot();XCTAssertNil(ambiguous.tracks.first?.estimatedWPM)
        XCTAssertNil(ambiguous.tracks.first?.estimatedSNRDB);XCTAssertNil(ambiguous.tracks.first?.selection)
        await session.stop()
    }
    func testMuteNeedsRetainedControlEvidenceAndStopsSelectionAndLateDecode() async throws {
        let (session,_,compute,_,_,capture)=try await selectionFixture()
        let snapshot=await session.snapshot(),view=try XCTUnwrap(snapshot.tracks.first),reference=try XCTUnwrap(view.controlReference)
        let forged=CWTrackReference(sessionID:reference.sessionID,sourceID:reference.sourceID,streamToken:reference.streamToken,
            epoch:reference.epoch,trackID:reference.trackID,revision:reference.revision,selectionID:UUID())
        do{try await session.mute(forged);XCTFail("Invented track mute accepted")}catch{XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
        try await session.mute(reference)
        let muted=await session.snapshot(),childMuted=await compute.isMuted(reference.trackID)
        XCTAssertTrue(childMuted);XCTAssertEqual(muted.tracks.first?.muted,true);XCTAssertNil(muted.tracks.first?.selection)
        let metadata=CWNativeTrack(kind:"decode",streamToken:capture.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased(),
            epoch:1,trackID:view.trackID,revision:0,state:"provisional",firstSample:3200,endSample:22400,sourceFirstSample:0,
            filterDelaySeconds:0.02,offsetHz:600,ambiguous:false,replay:false)
        await compute.emit(.decode(CWNativeDecode(track:metadata,text:"",tokens:[],inferenceMilliseconds:10)))
        try await Task.sleep(nanoseconds:5_000_000)
        let late=await session.snapshot();XCTAssertEqual(late.tracks.first?.committed,view.committed);XCTAssertNil(late.tracks.first?.selection)
        await session.stop()
        do{try await session.mute(reference);XCTFail("Stopped mute accepted")}catch{XCTAssertEqual(error as? CWTrackSelectionError,.staleEvidence)}
    }
    func testLoadRequiresCurrentMetricsRequestAndExpiresOnPassiveRead() async throws {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute(),clock=CWSessionTestClock()
        let session=CWDecodeSession(provider:provider,compute:compute,clock:{clock.now()})
        try await session.start(configuration:CWDecodeConfiguration(sources:[source()]),resources:resources)
        try await wait{await compute.lastMetricsRequest() != nil}
        let requested=await compute.lastMetricsRequest(),sequence=try XCTUnwrap(requested)
        await compute.emit(.metrics(CWNativeMetrics(requestSequence:sequence+1,sources:1,tracks:8,pending:2,inFlight:4,coalesced:3,droppedEvents:0)))
        try await Task.sleep(nanoseconds:5_000_000)
        let wrong=await session.snapshot();XCTAssertNil(wrong.load)
        await compute.emit(.metrics(CWNativeMetrics(requestSequence:sequence,sources:1,tracks:8,pending:2,inFlight:4,coalesced:UInt64.max,droppedEvents:0)))
        try await wait{await session.snapshot().load != nil}
        let current=await session.snapshot();XCTAssertEqual(current.load?.tracks,8);XCTAssertEqual(current.load?.inFlight,4)
        XCTAssertEqual(current.load?.coalesced,"18446744073709551615")
        clock.advance(2_000_000_001)
        let expired=await session.snapshot();XCTAssertNil(expired.load)
        await session.stop()
        let stopped=await session.snapshot();XCTAssertNil(stopped.load)
    }
    private func selectionFixture(qualified:Bool=false,measured:Bool=false) async throws -> (CWDecodeSession,CWSessionTestProvider,CWSessionTestCompute,CWSessionTestClock,CWSourceConfiguration,CWStreamDescriptor) {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute(),clock=CWSessionTestClock(),source=try source()
        let session=CWDecodeSession(provider:provider,compute:compute,clock:{clock.now()})
        try await session.start(configuration:CWDecodeConfiguration(sources:[source]),resources:resources)
        try await wait{await provider.leaseCount()==1}
        var descriptor:CWStreamDescriptor?
        for count in 1...84 {
            descriptor=try await provider.emit(source.id,receipt:clock.now(),qualified:qualified,samples:8192)
            try await wait{await compute.counts().sends==count}
        }
        let capture=try XCTUnwrap(descriptor),id=UUID().uuidString.lowercased()
        let tokens="CQ K1ABC K1ABC ".enumerated().map{index,symbol in CWNativeToken(symbol:String(symbol),firstSample:4000+UInt64(index*80),endSample:4060+UInt64(index*80),logScore:-0.1)}
        for (first,end):(UInt64,UInt64) in [(0,19200),(3200,22400)] {
            let metadata=CWNativeTrack(kind:"decode",streamToken:capture.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased(),
                epoch:1,trackID:id,revision:0,state:"provisional",firstSample:first,endSample:end,sourceFirstSample:0,
                filterDelaySeconds:0.02,offsetHz:600,ambiguous:false,replay:false)
            await compute.emit(.decode(CWNativeDecode(track:metadata,text:"CQ K1ABC K1ABC ",tokens:tokens,inferenceMilliseconds:10,
                estimatedWPM:measured ? 24:nil,estimatedSNRDB:measured ? 12:nil,snrReferenceHz:measured ? 2500:nil)))
        }
        try await wait{await session.snapshot().tracks.first?.selection != nil}
        return(session,provider,compute,clock,source,capture)
    }
    private func spotFixture(qualifiedForTests:Bool) async throws {
        let provider=CWSessionTestProvider(),compute=CWSessionTestCompute(),a=try source(),clock=CWSessionTestClock(),origin=UUID()
        let policy=qualifiedForTests ? CWSpotPolicy(qualifiedForTests:true,origin:origin):CWSpotPolicy(origin:origin)
        let session=CWDecodeSession(provider:provider,compute:compute,clock:{clock.now()},spotPolicy:policy)
        let collector=CWSessionSpotCollector(),events=session.acceptedSpots
        let reader=Task{for await spot in events{await collector.append(spot)}}
        try await session.start(configuration:CWDecodeConfiguration(sources:[a],automaticSpots:true),resources:resources)
        try await wait{await provider.leaseCount()==1}
        var descriptor:CWStreamDescriptor?
        for count in 1...84 {
            descriptor=try await provider.emit(a.id,receipt:clock.now(),qualified:true,samples:8192)
            try await wait{await compute.counts().sends==count}
        }
        let capture=try XCTUnwrap(descriptor),id=UUID().uuidString
        let tokens="CQ K1ABC K1ABC ".enumerated().map{index,symbol in CWNativeToken(symbol:String(symbol),firstSample:4000+UInt64(index*80),endSample:4060+UInt64(index*80),logScore:-0.1)}
        for (first,end):(UInt64,UInt64) in [(0,19200),(3200,22400)] {
            let metadata=CWNativeTrack(kind:"decode",streamToken:capture.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased(),
                epoch:1,trackID:id,revision:0,state:"provisional",firstSample:first,endSample:end,sourceFirstSample:0,
                filterDelaySeconds:0.02,offsetHz:600,ambiguous:false,replay:false)
            await compute.emit(.decode(CWNativeDecode(track:metadata,text:"CQ K1ABC K1ABC ",tokens:tokens,inferenceMilliseconds:10)))
        }
        if qualifiedForTests {
            try await wait{await collector.values().count==1}
            let values=await collector.values(),spot=try XCTUnwrap(values.first)
            XCTAssertEqual(spot.callsign,"K1ABC");XCTAssertEqual(spot.originInstanceID,origin);XCTAssertEqual(spot.frequencyHz,14025600)
            let current=await session.canPublish(spot);XCTAssertTrue(current)
            let snapshot=await session.snapshot(),view=try XCTUnwrap(snapshot.tracks.first),reference=try XCTUnwrap(view.controlReference)
            try await session.mute(reference)
            let muted=await session.canPublish(spot);XCTAssertFalse(muted)
            await provider.invalidate(a.id)
            let stale=await session.canPublish(spot);XCTAssertFalse(stale)
        } else {
            try await wait{await session.snapshot().tracks.first?.spotRejection=="quality_not_qualified"}
            let values=await collector.values(),snapshot=await session.snapshot()
            XCTAssertTrue(values.isEmpty);XCTAssertFalse(snapshot.automaticSpotsQualified)
        }
        await session.stop();reader.cancel()
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
    private var requestedMetrics:UInt64?
    func metrics(sequence:UInt64){requestedMetrics=sequence}
    func lastMetricsRequest()->UInt64?{requestedMetrics}
    private var muted:Set<UUID>=[]
    func mute(_ descriptor:CWStreamDescriptor,trackID:UUID) {muted.insert(trackID)}
    func isMuted(_ id:UUID)->Bool {muted.contains(id)}
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
    private var holdCurrent=false,currentWaiters:[CheckedContinuation<Void,Never>]=[]
    func setCurrentHold(){holdCurrent=true}
    func currentWaiterCount()->Int{currentWaiters.count}
    func resumeCurrent(){holdCurrent=false;let pending=currentWaiters;currentWaiters=[];for waiter in pending{waiter.resume()}}
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
    func current(_ source:CWSourceConfiguration,sessionID:UUID,leaseID:UUID) async -> CWStreamDescriptor? {
        if holdCurrent{await withCheckedContinuation{currentWaiters.append($0)}}
        guard let lease=leases[source.id],lease.session==sessionID,lease.id==leaseID else{return nil}
        return lease.descriptor
    }
    func release(_ source:CWSourceConfiguration,leaseID:UUID){
        releases+=1;guard leases[source.id]?.id==leaseID else{return}
        leases.removeValue(forKey:source.id)?.continuation.finish()
    }
    func invalidate(_ id:UUID){leases[id]?.descriptor=nil}
    func emit(_ id:UUID,newEpoch:Bool=false,receipt:UInt64=DispatchTime.now().uptimeNanoseconds,qualified:Bool=false,samples:Int=256) throws -> CWStreamDescriptor {
        var lease=try XCTUnwrap(leases[id])
        if lease.descriptor==nil || newEpoch {
            lease.descriptor=try CWStreamDescriptor(sessionID:lease.session,sourceID:id,radioID:lease.source.radioID,
                provider:lease.source.provider,receiverID:lease.source.receiverID,epoch:newEpoch ? "2":"1",centreHz:14025000,
                sampleRate:96000,spectralSign:qualified ? 1:nil,usableLowerHz:13986000,usableUpperHz:14064000,mappingQualified:qualified)
            lease.sequence=0;lease.sample=0
        }
        let descriptor=lease.descriptor!
        let block=try CWIQBlock(descriptor:descriptor,sequence:lease.sequence,firstSample:lease.sample,
            receivedMonotonicNS:receipt,samples:[Float](repeating:0,count:samples*2))
        lease.sequence+=1;lease.sample+=UInt64(samples);lease.continuation.yield(block);leases[id]=lease
        return descriptor
    }
}
private actor CWSessionSpotCollector {
    private var spots:[CWConfirmedSpot]=[]
    func append(_ spot:CWConfirmedSpot){spots.append(spot)}
    func values()->[CWConfirmedSpot]{spots}
}
#endif
