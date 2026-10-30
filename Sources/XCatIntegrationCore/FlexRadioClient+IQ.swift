// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
@preconcurrency import Network
import Foundation

struct FlexIQControlContext:Sendable {
    let generation:Int
    let peer:NWEndpoint.Host
    let port:UInt16
    let ownHandle:UInt32
    let stationHandle:UInt32
    let knownReceive:Bool
}
/// A settings notification is a different message form from an RF-state
/// report. Recognize only bounded, known, well-formed configuration fields.
/// Such a message can retain prior evidence, never establish receive state.
private enum FlexIQInterlockSettings {
    static let flags:Set<String>=["acc_tx_enabled","acc_txreq_enable","acc_txreq_polarity","rca_txreq_enable","rca_txreq_polarity",
        "tune_tx_suppress","tx1_enabled","tx2_enabled","tx3_enabled"]
    static let delays:Set<String>=["acc_tx_delay","timeout","tx1_delay","tx2_delay","tx3_delay","tx_delay"]
    static func recognizes(_ words:ArraySlice<Substring>)->Bool {
        guard !words.isEmpty,words.count<=flags.count+delays.count else{return false}
        var seen=Set<String>()
        for word in words {
            let pair=word.split(separator:"=",maxSplits:1,omittingEmptySubsequences:false)
            guard pair.count==2 else{return false}
            let key=String(pair[0]),value=String(pair[1])
            guard seen.insert(key).inserted else{return false}
            if flags.contains(key) {
                guard ["0","1","T","F"].contains(value) else{return false}
            } else if delays.contains(key) {
                guard let number=UInt32(value),number<=UInt32(Int32.max),String(number)==value else{return false}
            } else{return false}
        }
        return true
    }
    // The pinned manufacturer dispatches this configuration form separately
    // from RF state. It may preserve previous state, never supply a new one.
    static func recognizesBand(_ words:ArraySlice<Substring>)->Bool {
        let tokens=Array(words)
        guard (3...14).contains(tokens.count),tokens[0]=="band",
              let band=UInt8(tokens[1]),String(band)==tokens[1] else{return false}
        let bandFlags:Set<String>=["hwalc_enabled","inhibit","acc_txreq_enable","rca_txreq_enable",
            "acc_tx_enabled","tx1_enabled","tx2_enabled","tx3_enabled","tune_tx_suppress"]
        var seen=Set<String>()
        for word in tokens.dropFirst(2) {
            let pair=word.split(separator:"=",maxSplits:1,omittingEmptySubsequences:false)
            guard pair.count==2 else{return false}
            let key=String(pair[0]),value=String(pair[1])
            guard seen.insert(key).inserted else{return false}
            if bandFlags.contains(key) {
                guard ["0","1","T","F"].contains(value) else{return false}
            } else if key=="rfpower" || key=="tunepower" {
                guard let number=UInt8(value),number<=100,String(number)==value else{return false}
            } else if key=="band_name" {
                guard (1...32).contains(value.utf8.count),value.utf8.allSatisfy({
                    (65...90).contains($0)||(97...122).contains($0)||(48...57).contains($0)||$0==45||$0==95
                }) else{return false}
            } else{return false}
        }
        return true
    }
}
struct FlexIQState {
    var inventory=FlexIQResourceInventory()
    var subscribedGeneration:Int?
    var preparing=false
    var identity:FlexIQIdentity?
    var receiveKnown=false
    var interlockEvidence:FlexIQReceiveEvidence?
    var interlockEvidenceHistory:[FlexIQReceiveEvidence]=[]
    var stationMatches:Set<UInt32>=[]
    var handoffs:[UInt32:FlexIQHandoff]=[:]
    var receiver:FlexIQDatagramReceiver?
    var reader:Task<Void,Never>?
    var watchdog:Task<Void,Never>?
    var destinationReady=false
    var flows:[UInt32:FlexIQFlow]=[:]
    var epoch:UInt64=0
    var retiredCreateIDs:[UUID:UInt32]=[:]
}
struct FlexIQFlow {
    let id:UUID
    let generation:Int
    var pan:FlexIQPanadapter
    let rate:Int
    var streamID:UInt32?
    var creating=false
    var preexistingStreams:Set<UInt32>=[]
    var admitted=false
    var invalidated=false
    var leases:[UUID:AsyncThrowingStream<FlexIQBlock,Error>.Continuation]=[:]
    var continuity=FlexIQContinuity()
    var capture:FlexIQCapture?
    var nextSample:UInt64=0
    var sequence:UInt64=0
    var lastReceipt:UInt64=0
    var cleanAfter:UInt64
    let startedNS:UInt64
}
extension FlexRadioClient {
    public func iqDiagnostics()->[FlexIQDiagnosticEvent]{iqEvents}
    public func revokeIQHandoffs(){iqState.handoffs.removeAll()}
    public func iqCapabilities() async -> FlexIQCapabilities {
        try? await iqPrepare()
        let context=iqControlContext(),now=DispatchTime.now().uptimeNanoseconds
        return FlexIQCapabilities(connectionGeneration:context?.generation ?? -1,
            inventoryRevision:String(iqState.inventory.revision),ready:context != nil,
            identity:iqState.identity,stationHandle:context?.stationHandle,
            panadapters:iqState.inventory.pans.values.sorted{$0.id<$1.id},requestableSampleRates:[48000,96000,192000],
            transmitStateKnownOff:context?.knownReceive ?? false,
            handoffPanadapters:iqState.handoffs.filter{$0.value.expiresNS>now}.keys.map(FlexIQResourceInventory.identifier).sorted(),
            interlockEvidence:iqState.interlockEvidence,interlockEvidenceHistory:iqState.interlockEvidenceHistory)
    }
    /// Called only by the product's explicit handoff action after the operator
    /// releases other DAX consumers. Merely opening a window never grants this.
    public func authorizeIQHandoff(panadapterID:String,inventoryRevision:String) async throws {
        try await iqPrepare()
        guard let context=iqControlContext(),let id=FlexIQResourceInventory.handle(panadapterID),
              inventoryRevision==String(iqState.inventory.revision),!iqState.preparing else{throw FlexIQSubscriptionError.stationChanged}
        let owned=iqOwnedStreams()
        let pan=try iqState.inventory.permittedPanadapter(id,stationHandle:context.stationHandle,ownedStreams:owned)
        iqState.preparing=true
        defer{if iqControlContext()?.generation==context.generation{iqState.preparing=false}}
        if iqState.identity==nil {
            let identity=try await iqDiscover(context)
            guard iqControlContext()?.generation==context.generation else{throw FlexIQSubscriptionError.stationChanged}
            iqState.identity=identity
        }
        guard let current=iqControlContext(),current.generation==context.generation,
              inventoryRevision==String(iqState.inventory.revision),
              try iqState.inventory.permittedPanadapter(id,stationHandle:current.stationHandle,ownedStreams:iqOwnedStreams())==pan else {
            throw FlexIQSubscriptionError.stationChanged
        }
        let now=DispatchTime.now().uptimeNanoseconds
        iqState.handoffs[id]=FlexIQHandoff(generation:context.generation,
            competitors:iqState.inventory.streams.values.filter{$0.channel==pan.channel && !owned.contains($0.id)}.sorted{$0.id<$1.id},
            pan:pan,station:context.stationHandle,expiresNS:now+30_000_000_000)
    }
    public func startIQ(panadapterID:String,sampleRate:Int,leaseID:UUID) async throws -> FlexIQSubscription {
        guard [48000,96000,192000].contains(sampleRate),let context=iqControlContext(),
              let id=FlexIQResourceInventory.handle(panadapterID),
              !iqState.flows.values.contains(where:{$0.leases[leaseID] != nil}) else{throw FlexIQSubscriptionError.unavailable}
        guard context.knownReceive else{throw FlexIQSubscriptionError.receiveUnverified}
        guard iqState.identity != nil else{throw FlexIQSubscriptionError.handoffRequired}
        let pan=try iqState.inventory.permittedPanadapter(id,stationHandle:context.stationHandle,ownedStreams:iqOwnedStreams())
        let pair=AsyncThrowingStream<FlexIQBlock,Error>.makeStream(bufferingPolicy:.bufferingOldest(2))
        pair.continuation.onTermination={[weak self] _ in Task{await self?.stopIQ(leaseID:leaseID)}}
        if var flow=iqState.flows[id] {
            guard flow.rate==sampleRate,flow.pan==pan,flow.admitted,!flow.invalidated,flow.capture != nil else{throw FlexIQSubscriptionError.rateConflict}
            flow.leases[leaseID]=pair.continuation;iqState.flows[id]=flow
            return FlexIQSubscription(leaseID:leaseID,blocks:pair.stream)
        }
        let now=DispatchTime.now().uptimeNanoseconds
        guard iqState.flows.count<2,let handoff=iqState.handoffs.removeValue(forKey:id),
              handoff.permits(generation:context.generation,inventory:iqState.inventory,owned:iqOwnedStreams(),pan:pan,station:context.stationHandle,now:now) else {
            throw FlexIQSubscriptionError.handoffRequired
        }
        let flowID=UUID()
        iqTrace("flow_start","pan=\(pan.id) lease=\(leaseID) flow=\(flowID)")
        iqState.flows[id]=FlexIQFlow(id:flowID,generation:context.generation,pan:pan,rate:sampleRate,
            preexistingStreams:Set(iqState.inventory.streams.keys),leases:[leaseID:pair.continuation],cleanAfter:now+500_000_000,startedNS:now)
        do {
            try await iqEnsureDestination(context)
            try iqRequireFlow(id,flowID,context)
            iqState.flows[id]?.creating=true
            let reply=try await iqCommand("stream create type=dax_iq daxiq_channel=\(pan.channel!)",generation:context.generation)
            guard let streamID=FlexIQResourceInventory.handle(reply.trimmingCharacters(in:.whitespacesAndNewlines)),streamID != 0,
                  !iqState.flows.contains(where:{$0.key != id && $0.value.streamID==streamID}),
                  iqState.flows[id]?.streamID.map({$0==streamID}) ?? true else{throw FlexIQSubscriptionError.invalidPacket}
            // Even if Stop won while create was awaiting its ACK, this exact
            // returned resource is ours and must be removed on this generation.
            guard iqState.flows[id]?.id==flowID else {
                if iqState.retiredCreateIDs.removeValue(forKey:flowID) != streamID,iqMayRemoveStream(streamID,generation:context.generation) {
                    _ = try? await iqCommand("stream remove 0x\(FlexIQResourceInventory.identifier(streamID))",generation:context.generation)
                }
                throw FlexIQSubscriptionError.stopped
            }
            iqState.flows[id]?.streamID=streamID;iqState.flows[id]?.creating=false
            _ = try await iqCommand("stream set 0x\(FlexIQResourceInventory.identifier(streamID)) daxiq_rate=\(sampleRate)",generation:context.generation)
            for _ in 0..<100 {
                try Task.checkCancellation();try iqRequireFlow(id,flowID,context)
                if iqState.flows[id]?.capture != nil {
                    iqState.flows[id]?.admitted=true
                    return FlexIQSubscription(leaseID:leaseID,blocks:pair.stream)
                }
                try await Task.sleep(for:.milliseconds(50))
            }
            throw FlexIQSubscriptionError.noData
        } catch {
            await iqEndFlow(id,expected:flowID,error:error);throw error
        }
    }
    public func stopIQ(leaseID:UUID) async {
        guard let id=iqState.flows.first(where:{$0.value.leases[leaseID] != nil})?.key,
              let continuation=iqState.flows[id]?.leases.removeValue(forKey:leaseID) else{return}
        continuation.finish()
        if iqState.flows[id]?.leases.isEmpty==true {await iqEndFlow(id,error:FlexIQSubscriptionError.stopped)}
    }
    public func currentIQCapture(leaseID:UUID) -> FlexIQCapture? {
        iqRevalidate()
        guard let flow=iqState.flows.values.first(where:{$0.leases[leaseID] != nil}),!flow.invalidated,
              flow.lastReceipt>0,DispatchTime.now().uptimeNanoseconds-flow.lastReceipt<=250_000_000 else{return nil}
        return flow.capture
    }
    func iqConsumeStatus(_ body:String) {
        let words=body.split(separator:" ")
        if words.first=="interlock" {
            let states=words.dropFirst().filter{$0.hasPrefix("state=")}
            let bandConfiguration=words.dropFirst().first=="band"
            let settingsOnly=states.isEmpty && (bandConfiguration
                ? FlexIQInterlockSettings.recognizesBand(words.dropFirst())
                : FlexIQInterlockSettings.recognizes(words.dropFirst()))
            if !settingsOnly {
                iqState.receiveKnown = !bandConfiguration && states.count==1 && ["state=READY","state=RECEIVE"].contains(String(states[0]))
            }
            let raw=states.count==1 ? String(states[0].dropFirst(6)):nil
            let safe=raw.flatMap{value in (1...32).contains(value.utf8.count) && value.utf8.allSatisfy({
                (65...90).contains($0)||(97...122).contains($0)||(48...57).contains($0)||$0==95
            }) ? value:nil}
            var names=Set<String>()
            for word in words.dropFirst() {
                if names.count>=16{break}
                let parts=word.split(separator:"=",maxSplits:1,omittingEmptySubsequences:false)
                guard parts.count==2,(1...32).contains(parts[0].utf8.count),parts[0].utf8.allSatisfy({
                    (65...90).contains($0)||(97...122).contains($0)||(48...57).contains($0)||$0==95
                }) else{continue}
                names.insert(String(parts[0]))
            }
            iqState.interlockEvidence=FlexIQReceiveEvidence(stateFields:states.isEmpty ? "none":states.count==1 ? "single":"multiple",
                rawState:safe,acceptedReceive:iqState.receiveKnown,messageKind:bandConfiguration ? "band_configuration":settingsOnly ? "interlock_settings":"interlock",
                fieldNames:names.sorted(),stateRetained:settingsOnly)
            if let evidence=iqState.interlockEvidence {
                iqState.interlockEvidenceHistory.append(evidence)
                if iqState.interlockEvidenceHistory.count>32 {iqState.interlockEvidenceHistory.removeFirst()}
            }
            iqRevalidate()
        }
        if iqState.inventory.consume(body){
            if !iqState.flows.isEmpty || words.first=="stream" {
                let allowed:Set<String>=["type","client_handle","daxiq_channel","pan","daxiq_rate","rate","active","removed","center","rxant"]
                let safe=words.enumerated().filter { index,word in
                    index<(words.first=="stream" ? 2:3) || word=="removed" || allowed.contains(String(word.split(separator:"=",maxSplits:1).first ?? ""))
                }.map{String($0.element)}.joined(separator:" ")
                iqTrace("inventory",safe)
            }
            iqResolveCreatedStreams();iqRevalidate()
        }
    }
    private func iqResolveCreatedStreams() {
        guard let context=iqControlContext() else{return}
        for (id,flow) in iqState.flows where flow.creating && flow.streamID==nil && flow.generation==context.generation {
            let candidates=iqState.inventory.streams.values.filter {
                !flow.preexistingStreams.contains($0.id) && $0.clientHandle==context.ownHandle &&
                $0.channel==flow.pan.channel && $0.panadapter==id && !iqOwnedStreams().contains($0.id)
            }
            if candidates.count==1 {iqState.flows[id]?.streamID=candidates[0].id}
        }
    }
    func iqObserveStation(handle:UInt32?,matches:Bool?,removed:Bool) {
        guard let handle else{return}
        if removed || matches==false {iqState.stationMatches.remove(handle)}
        else if matches==true,iqState.stationMatches.count<16{iqState.stationMatches.insert(handle)}
        iqRevalidate()
    }
    func iqRevalidate() {
        let context=iqControlContext()
        for id in Array(iqState.flows.keys) {
            guard var flow=iqState.flows[id] else{continue}
            let permitted=context.flatMap{try? iqState.inventory.permittedPanadapter(id,stationHandle:$0.stationHandle,ownedStreams:iqOwnedStreams())}
            if context?.generation != flow.generation || permitted==nil ||
               permitted?.channel != flow.pan.channel || permitted?.clientHandle != flow.pan.clientHandle {
                // Withdraw synchronously before scheduling command cleanup.
                flow.capture=nil;flow.invalidated=true;iqState.flows[id]=flow
                iqTrace("flow_invalidated","pan=\(flow.pan.id) reason=station_or_pan_ownership generation=\(String(describing:context?.generation)) \(iqContextDiagnostic()) permitted=\(String(describing:permitted))")
                let flowID=flow.id;Task{await iqEndFlow(id,expected:flowID,error:FlexIQSubscriptionError.stationChanged)}
            } else if permitted != flow.pan || context?.knownReceive != true ||
                      (flow.lastReceipt>0 && DispatchTime.now().uptimeNanoseconds-flow.lastReceipt>250_000_000) {
                if let permitted{flow.pan=permitted}
                flow.capture=nil;flow.continuity.reset();flow.nextSample=0;flow.sequence=0
                flow.cleanAfter=DispatchTime.now().uptimeNanoseconds+500_000_000;iqState.flows[id]=flow
            } else if let streamID=flow.streamID,let stream=iqState.inventory.streams[streamID],
                      ((stream.clientHandle != nil && stream.clientHandle != context?.ownHandle) ||
                       (stream.channel != nil && stream.channel != flow.pan.channel) ||
                       (stream.panadapter != nil && stream.panadapter != id) ||
                       (flow.capture != nil && (stream.clientHandle != context?.ownHandle || stream.channel != flow.pan.channel ||
                           stream.panadapter != id || stream.sampleRate != flow.rate || stream.active != true))) {
                flow.capture=nil;flow.invalidated=true;iqState.flows[id]=flow
                iqTrace("flow_invalidated","pan=\(flow.pan.id) reason=stream_ownership_or_contract stream=\(stream)")
                let flowID=flow.id;Task{await iqEndFlow(id,expected:flowID,error:FlexIQSubscriptionError.busy)}
            } else if flow.capture != nil,let streamID=flow.streamID,iqState.inventory.streams[streamID]==nil {
                flow.capture=nil;flow.invalidated=true;iqState.flows[id]=flow
                let flowID=flow.id;Task{await iqEndFlow(id,expected:flowID,error:FlexIQSubscriptionError.stopped)}
            }
        }
    }
    func iqReset() {
        if !iqState.flows.isEmpty{iqTrace("transport_reset","active_flows=\(iqState.flows.count)")}
        let old=iqState;iqState=FlexIQState()
        old.reader?.cancel();old.watchdog?.cancel()
        for flow in old.flows.values {for continuation in flow.leases.values{continuation.finish(throwing:FlexIQSubscriptionError.stationChanged)}}
        if let receiver=old.receiver {Task{await receiver.stop()}}
    }
    private func iqPrepare() async throws {
        guard let context=iqControlContext() else{throw FlexIQSubscriptionError.unavailable}
        if iqState.subscribedGeneration==context.generation{return}
        guard !iqState.preparing else{throw FlexIQSubscriptionError.busy}
        iqState.preparing=true;defer{if iqControlContext()?.generation==context.generation{iqState.preparing=false}}
        for command in ["sub pan all","sub audio_stream all","sub daxiq all","sub dax all"] {
            _ = try await iqCommand(command,generation:context.generation)
        }
        iqState.subscribedGeneration=context.generation
    }
    private func iqDiscover(_ context:FlexIQControlContext) async throws -> FlexIQIdentity {
        let receiver=FlexIQDatagramReceiver(peer:context.peer,sourcePort:4992)
        do {
            let (_,packets)=try await receiver.start(port:4992,reuse:true)
            let identity=try await withThrowingTaskGroup(of:FlexIQIdentity.self) {group in
                group.addTask {
                    for try await packet in packets {
                        if let identity=try? FlexIQIdentity.parse(packet.data),identity.address=="\(context.peer)",identity.controlPort==context.port{return identity}
                    }
                    throw FlexIQSubscriptionError.discoveryUnavailable
                }
                group.addTask {try await Task.sleep(for:.seconds(5));throw FlexIQSubscriptionError.discoveryUnavailable}
                defer{group.cancelAll()}
                guard let first=try await group.next() else{throw FlexIQSubscriptionError.discoveryUnavailable};return first
            }
            await receiver.stop();return identity
        } catch {await receiver.stop();throw error}
    }
    private func iqOwnedStreams()->Set<UInt32>{Set(iqState.flows.values.compactMap(\.streamID))}
    private func iqRequireFlow(_ id:UInt32,_ flowID:UUID,_ context:FlexIQControlContext) throws {
        guard let current=iqControlContext(),current.generation==context.generation,current.stationHandle==context.stationHandle,
              iqState.flows[id]?.id==flowID,iqState.flows[id]?.invalidated==false else{
            iqTrace("flow_check_failed","pan=\(FlexIQResourceInventory.identifier(id)) expected_flow=\(flowID) current_flow=\(String(describing:iqState.flows[id]?.id)) context_available=\(iqControlContext() != nil)")
            throw FlexIQSubscriptionError.stopped
        }
    }
    private func iqEnsureDestination(_ context:FlexIQControlContext) async throws {
        if iqState.destinationReady{return}
        if iqState.receiver != nil {
            for _ in 0..<100 {
                try Task.checkCancellation()
                guard iqControlContext()?.generation==context.generation,iqState.receiver != nil else{throw FlexIQSubscriptionError.stationChanged}
                if iqState.destinationReady{return}
                try await Task.sleep(for:.milliseconds(20))
            }
            throw FlexIQSubscriptionError.busy
        }
        let receiver=FlexIQDatagramReceiver(peer:context.peer,sourcePort:4991);iqState.receiver=receiver
        do {
            let (port,packets)=try await receiver.start()
            _ = try await iqCommand("client udpport \(port)",generation:context.generation)
            guard iqState.receiver===receiver,iqControlContext()?.generation==context.generation else{throw FlexIQSubscriptionError.stationChanged}
            iqState.destinationReady=true
            iqState.reader=Task{[weak self] in
                do {for try await packet in packets {await self?.iqReceive(packet,generation:context.generation)}}
                catch {await self?.iqFailInput(error,generation:context.generation)}
            }
            iqState.watchdog=Task{[weak self] in
                while !Task.isCancelled {try? await Task.sleep(for:.milliseconds(250));guard !Task.isCancelled else{return};await self?.iqWatchdog(generation:context.generation)}
            }
        } catch {
            await receiver.stop()
            if iqState.receiver===receiver{iqState.receiver=nil;iqState.destinationReady=false}
            throw error
        }
    }
    private func iqReceive(_ datagram:FlexIQDatagramReceiver.Datagram,generation:Int) async {
        guard let context=iqControlContext(),context.generation==generation,datagram.data.count>=8 else{return}
        let bytes=[UInt8](datagram.data.prefix(8))
        let streamID=UInt32(bytes[4])<<24|UInt32(bytes[5])<<16|UInt32(bytes[6])<<8|UInt32(bytes[7])
        guard let id=iqState.flows.first(where:{$0.value.streamID==streamID})?.key else{return}
        iqRevalidate()
        guard var flow=iqState.flows[id],!flow.invalidated,let identity=iqState.identity,
              let metadata=iqState.inventory.streams[streamID],metadata.clientHandle==context.ownHandle,
              metadata.panadapter==id,metadata.channel==flow.pan.channel,metadata.sampleRate==flow.rate,metadata.active==true else{return}
        do {
            let packet=try FlexIQPacket.parse(datagram.data,expectedStreamID:streamID)
            guard packet.sampleRate==flow.rate else{throw FlexIQSubscriptionError.rateConflict}
            let clean=flow.continuity.accept(packet,receivedNS:datagram.receivedNS)
            flow.lastReceipt=datagram.receivedNS
            guard context.knownReceive else{iqState.flows[id]=flow;return}
            if !clean {
                flow.capture=nil;flow.nextSample=0;flow.sequence=0;flow.cleanAfter=datagram.receivedNS+500_000_000
            }
            guard clean,datagram.receivedNS>=flow.cleanAfter else{iqState.flows[id]=flow;return}
            if flow.capture==nil {
                guard iqState.epoch<UInt64.max else{throw FlexIQSubscriptionError.stopped};iqState.epoch+=1
                flow.capture=FlexIQCapture(streamToken:UUID(),epoch:iqState.epoch,connectionGeneration:generation,identity:identity,
                    stationHandle:context.stationHandle,panadapter:flow.pan,streamID:streamID,sampleRate:flow.rate)
            }
            guard let capture=flow.capture,flow.sequence<UInt64.max,
                  UInt64(packet.samples.count/2)<=UInt64.max-flow.nextSample else{throw FlexIQSubscriptionError.stopped}
            guard flow.admitted else{iqState.flows[id]=flow;return}
            let block=FlexIQBlock(capture:capture,sequence:flow.sequence,firstSample:flow.nextSample,
                receivedMonotonicNS:datagram.receivedNS,packet:packet)
            flow.sequence+=1;flow.nextSample+=UInt64(packet.samples.count/2)
            for continuation in flow.leases.values {
                switch continuation.yield(block) {
                case .enqueued:break
                case .dropped:throw FlexIQSubscriptionError.overflow
                case .terminated:break
                @unknown default:throw FlexIQSubscriptionError.overflow
                }
            }
            iqState.flows[id]=flow
        } catch {await iqEndFlow(id,expected:flow.id,error:error)}
    }
    private func iqWatchdog(generation:Int) async {
        guard iqControlContext()?.generation==generation else{return}
        let now=DispatchTime.now().uptimeNanoseconds
        for (id,flow) in iqState.flows {
            if flow.lastReceipt>0,now-flow.lastReceipt>2_000_000_000 {await iqEndFlow(id,expected:flow.id,error:FlexIQSubscriptionError.stalled)}
            else if flow.lastReceipt==0,now-flow.startedNS>5_000_000_000 {await iqEndFlow(id,expected:flow.id,error:FlexIQSubscriptionError.noData)}
        }
    }
    private func iqFailInput(_ error:any Error,generation:Int) async {
        for (id,flow) in iqState.flows where flow.generation==generation {await iqEndFlow(id,expected:flow.id,error:error)}
    }
    private func iqEndFlow(_ id:UInt32,expected:UUID?=nil,error:any Error) async {
        guard let flow=iqState.flows[id],expected==nil || expected==flow.id else{return}
        iqTrace("flow_end","pan=\(flow.pan.id) flow=\(flow.id) stream=\(flow.streamID.map(FlexIQResourceInventory.identifier) ?? "none") error=\(error)")
        iqState.flows.removeValue(forKey:id)
        for continuation in flow.leases.values{continuation.finish(throwing:error)}
        if iqState.flows.isEmpty {
            let receiver=iqState.receiver;iqState.receiver=nil;iqState.destinationReady=false
            iqState.reader?.cancel();iqState.reader=nil;iqState.watchdog?.cancel();iqState.watchdog=nil
            await receiver?.stop()
        }
        if let streamID=flow.streamID {
            if iqMayRemoveStream(streamID,generation:flow.generation) {
                if flow.creating {
                    if iqState.retiredCreateIDs.count>=32,let key=iqState.retiredCreateIDs.keys.first{iqState.retiredCreateIDs.removeValue(forKey:key)}
                    iqState.retiredCreateIDs[flow.id]=streamID
                }
                _ = try? await iqCommand("stream remove 0x\(FlexIQResourceInventory.identifier(streamID))",generation:flow.generation)
            }
        }
    }
}
#endif
