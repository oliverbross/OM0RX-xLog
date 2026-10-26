// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import Dispatch

public protocol CWComputeControlling: Sendable {
    func start(resources: CWComputeResources) async throws -> AsyncThrowingStream<CWComputeEvent,Error>
    func open(_ descriptor: CWStreamDescriptor) async throws
    func send(_ block: CWIQBlock) async throws
    func end(_ descriptor: CWStreamDescriptor, gap: Bool) async
    func stop() async
    func mute(_ descriptor:CWStreamDescriptor,trackID:UUID) async throws
}
extension CWComputeProcess: CWComputeControlling {}

/// One adapter delegates to existing radio owners. The lease UUID is known
/// before acquire suspends, allowing Stop to cancel an in-flight acquisition.
public protocol CWIQSourceProviding: Sendable {
    func acquire(_ source: CWSourceConfiguration, sessionID: UUID, leaseID: UUID) async throws -> AsyncThrowingStream<CWIQBlock,Error>
    func current(_ source: CWSourceConfiguration, sessionID: UUID, leaseID: UUID) async -> CWStreamDescriptor?
    func release(_ source: CWSourceConfiguration, leaseID: UUID) async
}

public struct CWDecodeSourceSnapshot: Encodable, Sendable {
    public let configuration: CWSourceConfiguration
    public var state: CWSourceState
    public var descriptor: CWStreamDescriptor?
    public var retryCount: Int
    public var failure: String?
}
public struct CWDecodeTrackSnapshot: Encodable, Sendable {
    public let sourceID: UUID
    public let trackID: String
    public let descriptor: CWStreamDescriptor
    public let revision: String
    public let offsetHz: Double
    public let frequencyHz: Int64?
    public let committed: String
    public let provisional: String
    public let ambiguous: Bool
    public let inferenceMilliseconds: Double?
    public let spotRejection:String?
    public var estimatedWPM:Double?=nil
    public var estimatedSNRDB:Double?=nil
    public var snrReferenceHz:Int?=nil
    public var selection:CWTrackSelection?=nil
    public var controlReference:CWTrackReference?=nil
    public var muted:Bool=false
}
public struct CWDecodeSessionSnapshot: Encodable, Sendable {
    public let sessionID: UUID?
    public let state: String
    public let failure: String?
    public let sources: [CWDecodeSourceSnapshot]
    public let tracks: [CWDecodeTrackSnapshot]
    public let automaticSpotsQualified: Bool
    public let spotDeliveryDrops:Int
}

/// Shared by main and detached views. Only this actor owns source leases and
/// the compute child. Snapshots are passive and contain no raw IQ or model data.
public actor CWDecodeSession {
    private struct Source {
        var view: CWDecodeSourceSnapshot
        var lease: UUID?
        var task: Task<Void,Never>?
        var lastReceipt: UInt64 = 0
        var lastSample: UInt64 = 0
    }
    private struct Track {
        var view: CWDecodeTrackSnapshot
        var transcript = CWTranscriptReconciler()
        var selectionUpdatedNS:UInt64=0
        var metricsUpdatedNS:UInt64=0
    }
    private let provider: any CWIQSourceProviding
    private let compute: any CWComputeControlling
    private let sleep: @Sendable (UInt64) async throws -> Void
    private let clock: @Sendable () -> UInt64
    private let wallClock:@Sendable ()->Date
    private var spotPolicy:CWSpotPolicy
    public nonisolated let acceptedSpots:AsyncStream<CWConfirmedSpot>
    private let spotOutput:AsyncStream<CWConfirmedSpot>.Continuation
    private var spotDeliveryDrops=0
    private var intent: UUID?
    private var configuration: CWDecodeConfiguration?
    private var resources: CWComputeResources?
    private var state="stopped",failure: String?
    private var sources: [UUID:Source]=[:],tracks: [String:Track]=[:]
    private var retiredTracks: [String]=[]
    private var mutedTracks:Set<UUID>=[]
    private var eventTask: Task<Void,Never>?,monitor: Task<Void,Never>?
    private var childAttempt=0
    public init(provider: any CWIQSourceProviding, compute: any CWComputeControlling = CWComputeProcess(),
                clock: @escaping @Sendable () -> UInt64 = {DispatchTime.now().uptimeNanoseconds},
                sleep: @escaping @Sendable (UInt64) async throws -> Void = {try await Task.sleep(nanoseconds:$0)},
                wallClock:@escaping @Sendable ()->Date={Date()},spotPolicy:CWSpotPolicy=CWSpotPolicy()) {
        self.provider=provider;self.compute=compute;self.clock=clock;self.sleep=sleep;self.wallClock=wallClock;self.spotPolicy=spotPolicy
        let pair=AsyncStream<CWConfirmedSpot>.makeStream(bufferingPolicy:.bufferingOldest(16))
        acceptedSpots=pair.stream;spotOutput=pair.continuation
    }
    deinit{spotOutput.finish()}
    public func snapshot() -> CWDecodeSessionSnapshot {
        let now=clock()
        return CWDecodeSessionSnapshot(sessionID:intent,state:state,failure:failure,
            sources:sources.values.map(\.view).sorted{$0.configuration.id.uuidString<$1.configuration.id.uuidString},
            tracks:tracks.values.map{track in
                var view=track.view
                if now<track.metricsUpdatedNS || now-track.metricsUpdatedNS>2_000_000_000 {
                    view.estimatedWPM=nil;view.estimatedSNRDB=nil;view.snrReferenceHz=nil
                }
                return view
            }.sorted{$0.trackID<$1.trackID},automaticSpotsQualified:spotPolicy.isQualityQualified,
            spotDeliveryDrops:spotDeliveryDrops)
    }
    /// Recheck both the provider and actor state after suspension. An RF target
    /// is returned only for qualified mapping; callsign selection never tunes.
    public func resolveSelection(_ reference:CWTrackReference,requireFrequency:Bool=false) async throws -> CWResolvedTrackSelection {
        guard let key=tracks.first(where:{$0.value.view.selection?.reference==reference})?.key,
              intent==reference.sessionID,state=="running",let track=tracks[key],
              track.view.selection?.reference==reference,let source=sources[reference.sourceID],
              source.view.state == .running,let lease=source.lease,let descriptor=source.view.descriptor,
              descriptor==track.view.descriptor,!descriptor.replay else {throw CWTrackSelectionError.staleEvidence}
        let current=await provider.current(source.view.configuration,sessionID:reference.sessionID,leaseID:lease)
        let now=clock()
        guard intent==reference.sessionID,state=="running",sources[reference.sourceID]?.lease==lease,
              sources[reference.sourceID]?.view.state == .running,
              sources[reference.sourceID]?.view.descriptor==descriptor,current==descriptor,
              let retained=tracks[key],let selection=retained.view.selection,selection.reference==reference,
              now>=source.lastReceipt,now-source.lastReceipt<=250_000_000,
              now>=retained.selectionUpdatedNS,now-retained.selectionUpdatedNS<=2_000_000_000 else {
            throw CWTrackSelectionError.staleEvidence
        }
        if requireFrequency && (!descriptor.mappingQualified || retained.view.frequencyHz==nil) {
            throw CWTrackSelectionError.frequencyUnqualified
        }
        return CWResolvedTrackSelection(reference:reference,callsign:selection.callsign,radioID:descriptor.radioID,
            provider:descriptor.provider,frequencyHz:descriptor.mappingQualified ? retained.view.frequencyHz:nil)
    }
    public func mute(_ reference:CWTrackReference) async throws {
        guard let key=tracks.first(where:{$0.value.view.controlReference==reference})?.key,
              intent==reference.sessionID,state=="running",let source=sources[reference.sourceID],
              source.view.state == .running,let lease=source.lease,let descriptor=source.view.descriptor,
              tracks[key]?.view.descriptor==descriptor else {throw CWTrackSelectionError.staleEvidence}
        let current=await provider.current(source.view.configuration,sessionID:reference.sessionID,leaseID:lease)
        let now=clock()
        guard intent==reference.sessionID,state=="running",current==descriptor,sources[reference.sourceID]?.lease==lease,
              sources[reference.sourceID]?.view.descriptor==descriptor,tracks[key]?.view.controlReference==reference,
              now>=source.lastReceipt,now-source.lastReceipt<=250_000_000 else {throw CWTrackSelectionError.staleEvidence}
        guard mutedTracks.count<4096 || mutedTracks.contains(reference.trackID) else {throw CWComputeError.occupied}
        // Local suppression precedes the pipe write and survives a lost child.
        mutedTracks.insert(reference.trackID);tracks[key]?.view.muted=true;tracks[key]?.view.selection=nil
        try await compute.mute(descriptor,trackID:reference.trackID)
    }
    /// Recheck queued output against the live provider before each external
    /// classification/listener admission. Archived accepted spots remain history.
    public func canPublish(_ spot:CWConfirmedSpot) async -> Bool {
        guard spotPolicy.isQualityQualified,configuration?.automaticSpots==true,intent==spot.sessionID,
              let source=sources[spot.sourceID],let lease=source.lease,let descriptor=source.view.descriptor,
              descriptor.streamToken==spot.streamToken,descriptor.epoch==spot.epoch,descriptor.mappingQualified,
              !mutedTracks.contains(spot.trackID) else{return false}
        let current=await provider.current(source.view.configuration,sessionID:spot.sessionID,leaseID:lease)
        let now=clock()
        return intent==spot.sessionID && sources[spot.sourceID]?.lease==lease &&
            sources[spot.sourceID]?.view.descriptor==descriptor && current==descriptor &&
            now>=source.lastReceipt && now-source.lastReceipt<=250_000_000 &&
            !mutedTracks.contains(spot.trackID)
    }
    public func start(configuration: CWDecodeConfiguration, resources: CWComputeResources) async throws {
        try configuration.validate()
        guard intent==nil,state != "stopping",!configuration.sources.isEmpty else {throw CWComputeError.occupied}
        let id=UUID();intent=id;self.configuration=configuration;self.resources=resources
        state="preparing";failure=nil;childAttempt=0;tracks.removeAll();retiredTracks.removeAll();mutedTracks.removeAll()
        sources=Dictionary(uniqueKeysWithValues:configuration.sources.map {
            ($0.id,Source(view:CWDecodeSourceSnapshot(configuration:$0,state:.preparing,descriptor:nil,retryCount:0,failure:nil)))
        })
        await launchChild(id:id)
        guard intent==id else {return}
        monitor=Task {[weak self] in
            while !Task.isCancelled {
                do {try await Task.sleep(nanoseconds:100_000_000)} catch {return}
                await self?.checkSources(id:id)
            }
        }
    }
    public func stop() async {
        guard state != "stopping" else {return}
        intent=nil;state="stopping";eventTask?.cancel();eventTask=nil;monitor?.cancel();monitor=nil
        await releaseAll()
        await compute.stop()
        tracks.removeAll();retiredTracks.removeAll();mutedTracks.removeAll();state="stopped";failure=nil
    }
    private func launchChild(id: UUID) async {
        guard intent==id,let resources else {return}
        do {
            let events=try await compute.start(resources:resources)
            guard intent==id else {await compute.stop();return}
            eventTask=Task {[weak self] in
                do {
                    for try await event in events {
                        if Task.isCancelled {return}
                        await self?.receive(event,id:id)
                    }
                    if !Task.isCancelled {await self?.childFailed(id:id)}
                } catch {if !Task.isCancelled {await self?.childFailed(id:id)}}
            }
        } catch {await childFailed(id:id)}
    }
    private func childFailed(id: UUID) async {
        guard intent==id else {return}
        state="recovering";failure="compute_unavailable"
        await releaseAll();await compute.stop()
        guard intent==id else {return}
        guard childAttempt<3 else {state="blocked";return}
        let delay=UInt64(1<<childAttempt)*1_000_000_000;childAttempt+=1
        do {try await sleep(delay)} catch {return}
        guard intent==id else {return}
        await launchChild(id:id)
    }
    private func releaseAll() async {
        let closing=sources.values.compactMap {value -> (CWSourceConfiguration,UUID)? in
            guard let lease=value.lease else {return nil};return (value.view.configuration,lease)
        }
        for key in sources.keys {
            sources[key]?.task?.cancel();sources[key]?.task=nil;sources[key]?.lease=nil
            sources[key]?.view.descriptor=nil;sources[key]?.view.state = .stopped
        }
        tracks.removeAll();retiredTracks.removeAll()
        for (source,lease) in closing {await provider.release(source,leaseID:lease)}
    }
    private func beginSource(_ source: CWSourceConfiguration,id: UUID) {
        guard intent==id,sources[source.id]?.lease==nil else {return}
        let lease=UUID();sources[source.id]?.lease=lease;sources[source.id]?.view.state = .acquiring
        sources[source.id]?.task=Task {[weak self,provider] in
            do {
                let blocks=try await provider.acquire(source,sessionID:id,leaseID:lease)
                for try await block in blocks {
                    if Task.isCancelled {return}
                    try await self?.accept(block,source:source,lease:lease,id:id)
                }
                if !Task.isCancelled {await self?.sourceFailed(source,lease:lease,id:id)}
            } catch {if !Task.isCancelled {await self?.sourceFailed(source,lease:lease,id:id)}}
        }
    }
    private func sourceFailed(_ source: CWSourceConfiguration,lease: UUID,id: UUID) async {
        guard intent==id,sources[source.id]?.lease==lease else {return}
        await invalidate(source.id)
        sources[source.id]?.lease=nil;sources[source.id]?.view.state = .recovering
        sources[source.id]?.view.failure="iq_unavailable"
        await provider.release(source,leaseID:lease)
        guard intent==id,sources[source.id]?.lease==nil else {return}
        let attempts=sources[source.id]?.view.retryCount ?? 3
        guard attempts<3 else {sources[source.id]?.view.state = .blocked;return}
        sources[source.id]?.view.retryCount=attempts+1
        do {try await sleep(UInt64(1<<attempts)*1_000_000_000)} catch {return}
        guard intent==id,state=="running",sources[source.id]?.lease==nil else {return}
        beginSource(source,id:id)
    }
    private func invalidate(_ sourceID: UUID) async {
        let descriptor=sources[sourceID]?.view.descriptor
        sources[sourceID]?.view.descriptor=nil
        tracks=tracks.filter{$0.value.view.sourceID != sourceID}
        if let descriptor {await compute.end(descriptor,gap:true)}
    }
    private func accept(_ block: CWIQBlock,source: CWSourceConfiguration,lease: UUID,id: UUID) async throws {
        guard intent==id,sources[source.id]?.lease==lease else {return}
        let current=await provider.current(source,sessionID:id,leaseID:lease)
        guard intent==id,sources[source.id]?.lease==lease else {return}
        guard current==block.descriptor,block.descriptor.sessionID==id,block.descriptor.sourceID==source.id,
              block.descriptor.radioID==source.radioID,block.descriptor.provider==source.provider,
              block.descriptor.receiverID==source.receiverID,!block.descriptor.replay else {
            await invalidate(source.id);return
        }
        if sources[source.id]?.view.descriptor != current {
            await invalidate(source.id)
            guard intent==id,sources[source.id]?.lease==lease else {return}
            try await compute.open(block.descriptor)
            guard intent==id,sources[source.id]?.lease==lease else {await compute.end(block.descriptor,gap:true);return}
            sources[source.id]?.view.descriptor=block.descriptor
        }
        try await compute.send(block)
        guard intent==id,sources[source.id]?.lease==lease else {return}
        sources[source.id]?.lastReceipt=block.receivedMonotonicNS
        sources[source.id]?.lastSample=block.firstSample+UInt64(block.sampleCount)
        sources[source.id]?.view.state = .running;sources[source.id]?.view.failure=nil
    }
    private func checkSources(id: UUID) async {
        guard intent==id else {return}
        for source in sources.values.map(\.view.configuration) {
            guard let lease=sources[source.id]?.lease,let descriptor=sources[source.id]?.view.descriptor else {continue}
            let current=await provider.current(source,sessionID:id,leaseID:lease)
            guard intent==id,sources[source.id]?.lease==lease else {continue}
            if current != descriptor {
                await invalidate(source.id);sources[source.id]?.view.state = .quarantined
            } else if clock()>=sources[source.id]!.lastReceipt,clock()-sources[source.id]!.lastReceipt>250_000_000 {
                // Keep the provider lease until its own timeout, but never show
                // stale copy while waiting for it to fail or resume with an epoch.
                tracks=tracks.filter{$0.value.view.sourceID != source.id}
                sources[source.id]?.view.state = .quarantined
            }
        }
    }
    private static func token(_ descriptor: CWStreamDescriptor) -> String {
        descriptor.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased()
    }
    private func receive(_ event: CWComputeEvent,id: UUID) async {
        guard intent==id else {return}
        switch event {
        case .ready:
            state="running";failure=nil
            for source in configuration?.sources ?? [] {beginSource(source,id:id)}
        case .metrics:break
        case .track(let track):await receiveTrack(track,decode:nil,id:id)
        case .decode(let decode):await receiveTrack(decode.track,decode:decode,id:id)
        }
    }
    private func receiveTrack(_ value: CWNativeTrack,decode: CWNativeDecode?,id: UUID) async {
        guard let source=sources.values.first(where:{$0.view.descriptor.map(Self.token)==value.streamToken}),
              let descriptor=source.view.descriptor,let lease=source.lease,
              UInt64(descriptor.epoch)==value.epoch,descriptor.replay==value.replay else {return}
        let current=await provider.current(source.view.configuration,sessionID:id,leaseID:lease)
        guard intent==id,sources[descriptor.sourceID]?.lease==lease,
              sources[descriptor.sourceID]?.view.descriptor==descriptor,current==descriptor,
              clock()>=source.lastReceipt,clock()-source.lastReceipt<=250_000_000 else {return}
        if value.kind=="fault",value.trackID.isEmpty {
            await sourceFailed(source.view.configuration,lease:lease,id:id);return
        }
        guard !value.trackID.isEmpty else {return}
        let key=value.trackID
        if ["retired","fault"].contains(value.kind) {
            tracks.removeValue(forKey:key);retiredTracks.append(key)
            if retiredTracks.count>128 {retiredTracks.removeFirst(retiredTracks.count-128)}
            return
        }
        if tracks[key]?.view.descriptor==descriptor,tracks[key]?.view.muted==true {return}
        guard !retiredTracks.contains(key),tracks[key].map({UInt64($0.view.revision).map{$0<=value.revision} ?? false}) ?? true else {return}
        var track=tracks[key]
        if track?.view.revision != String(value.revision) || track?.view.descriptor != descriptor {track=nil}
        var reconciler=track?.transcript ?? CWTranscriptReconciler()
        var committed=track?.view.committed ?? "",provisional=track?.view.provisional ?? "",ambiguous=value.ambiguous
        var occurrences:[CWIdentityOccurrence]=[]
        if let decode {
            // Convert track-local 3.2 kHz time to the capture sample clock.
            let position=Double(value.sourceFirstSample)+Double(value.endSample)*Double(descriptor.sampleRate)/3200
            guard position.isFinite,position<=Double(source.lastSample)+1,
                  Double(source.lastSample)-position<=Double(descriptor.sampleRate)*2 else {return}
            guard let update=try? reconciler.process(decode.tokens.compactMap(\.aligned),firstSample:value.firstSample,endSample:value.endSample) else {return}
            committed=update.committed.map(\.symbol).joined();provisional=update.provisional.map(\.symbol).joined()
            ambiguous = ambiguous || update.ambiguous
            occurrences=Array(CWTransmittingIdentity.occurrences(in:update.committed).suffix(128))
        }
        if ambiguous {committed="";provisional="";reconciler.reset()}
        let frequency=descriptor.mappingQualified ? try? descriptor.frequency(offsetHz:value.offsetHz):nil
        var selection=track?.view.selection,selectionUpdatedNS=track?.selectionUpdatedNS ?? 0
        if decode != nil {
            let recent=occurrences.filter{value.endSample >= $0.endSample && value.endSample-$0.endSample<=60*3200}
            let candidates=Set(recent.map(\.callsign))
            if !ambiguous,!descriptor.replay,candidates.count==1,let call=candidates.first,let trackID=UUID(uuidString:key) {
                if selection?.callsign != call || track?.view.frequencyHz != frequency {
                    selection=CWTrackSelection(reference:CWTrackReference(sessionID:id,sourceID:descriptor.sourceID,
                        streamToken:descriptor.streamToken,epoch:descriptor.epoch,trackID:trackID,
                        revision:String(value.revision),selectionID:UUID()),callsign:call)
                }
                selectionUpdatedNS=clock()
            } else {selection=nil;selectionUpdatedNS=0}
        }
        if ambiguous {selection=nil;selectionUpdatedNS=0}
        var rejection=ambiguous ? CWSpotRejection.ambiguous.rawValue:track?.view.spotRejection
        if decode != nil,let trackID=UUID(uuidString:key) {
            let now=clock(),latest=occurrences.map(\.endSample).max() ?? value.endSample
            let samplePosition=Double(value.sourceFirstSample)+Double(latest)*Double(descriptor.sampleRate)/3200
            let age=Double(now-source.lastReceipt)/1e9+max(0,Double(source.lastSample)-samplePosition)/Double(descriptor.sampleRate)+value.filterDelaySeconds
            var evaluatingPolicy=spotPolicy
            let decision=evaluatingPolicy.evaluate(descriptor:descriptor,trackID:trackID,frequencyHz:frequency ?? 0,
                occurrences:occurrences,channelSample:value.endSample,latestSampleNS:source.lastReceipt,nowNS:now,
                observedAt:wallClock().addingTimeInterval(-age),transmitting:false,clean:true,ambiguous:ambiguous)
            rejection=decision.rejection?.rawValue
            if configuration?.automaticSpots==true{spotPolicy=evaluatingPolicy}
            if configuration?.automaticSpots==true,let spot=decision.spot {
                switch spotOutput.yield(spot) {
                case .enqueued:break
                case .dropped:spotDeliveryDrops=min(Int.max-1,spotDeliveryDrops)+1
                case .terminated:break
                @unknown default:break
                }
            }
        }
        let preserveMetrics=decode==nil && !ambiguous
        let controlReference=track?.view.controlReference ?? UUID(uuidString:key).map{trackID in
            CWTrackReference(sessionID:id,sourceID:descriptor.sourceID,streamToken:descriptor.streamToken,epoch:descriptor.epoch,
                trackID:trackID,revision:String(value.revision),selectionID:UUID())
        }
        let view=CWDecodeTrackSnapshot(sourceID:descriptor.sourceID,trackID:key,descriptor:descriptor,
            revision:String(value.revision),offsetHz:value.offsetHz,
            frequencyHz:frequency,committed:committed,provisional:provisional,ambiguous:ambiguous,
            inferenceMilliseconds:decode?.inferenceMilliseconds,spotRejection:rejection,
            estimatedWPM:ambiguous ? nil:(preserveMetrics ? track?.view.estimatedWPM:decode?.estimatedWPM),
            estimatedSNRDB:ambiguous ? nil:(preserveMetrics ? track?.view.estimatedSNRDB:decode?.estimatedSNRDB),
            snrReferenceHz:ambiguous ? nil:(preserveMetrics ? track?.view.snrReferenceHz:decode?.snrReferenceHz),
            selection:selection,controlReference:controlReference)
        if tracks[key] != nil || tracks.count<32 {
            tracks[key]=Track(view:view,transcript:reconciler,selectionUpdatedNS:selectionUpdatedNS,
                metricsUpdatedNS:decode != nil ? clock():(track?.metricsUpdatedNS ?? 0))
        }
    }
}
#endif
