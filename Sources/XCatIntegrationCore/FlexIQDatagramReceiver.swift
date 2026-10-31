// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
@preconcurrency import Network
import Foundation

private final class FlexIQConnectionAdmission:@unchecked Sendable {
    private let lock=NSLock()
    private var claimed=false
    private var candidates=0,wrongPeer=0,wrongPort=0,extra=0
    private var firstRejected:String?
    func claim(host:NWEndpoint.Host,port:NWEndpoint.Port,peer:NWEndpoint.Host,sourcePort:NWEndpoint.Port?)->Bool {
        lock.lock();defer{lock.unlock()}
        if candidates<Int.max{candidates+=1}
        if host != peer {
            if wrongPeer<Int.max{wrongPeer+=1}
        } else if let sourcePort,port != sourcePort {
            if wrongPort<Int.max{wrongPort+=1}
        } else if !claimed {claimed=true;return true}
        else {if extra<Int.max{extra+=1}}
        if firstRejected==nil {firstRejected=String("\(host):\(port.rawValue)".prefix(80))}
        return false
    }
    func counts()->(Int,Int,Int,Int,String?) {
        lock.lock();defer{lock.unlock()};return(candidates,wrongPeer,wrongPort,extra,firstRejected)
    }
}

/// One owned UDP destination per control connection. One outstanding receive and
/// a bounded delivery queue prevent datagrams from creating an unbounded Task set.
actor FlexIQDatagramReceiver {
    struct Datagram:Sendable {let data:Data;let receivedNS:UInt64;let sourcePort:UInt16}
    private let peer:NWEndpoint.Host
    private let sourcePort:NWEndpoint.Port?
    private let queue=DispatchQueue(label:"com.oliverbross.xlog.flex-iq-udp")
    private var listener:NWListener?
    private var connection:NWConnection?
    private var ready=false
    private var ended=false
    private var failure:(any Error)?
    private let admission=FlexIQConnectionAdmission()
    private var destinationPort:UInt16?
    private var acceptedSourcePort:UInt16?
    private var datagrams=0,byteCount:UInt64=0,firstPacketBytes:Int?
    private var overflow=false,readFailed=false
    private let output:AsyncThrowingStream<Datagram,Error>
    private let continuation:AsyncThrowingStream<Datagram,Error>.Continuation
    init(peer:NWEndpoint.Host,sourcePort:UInt16?) {
        self.peer=peer;self.sourcePort=sourcePort.map{NWEndpoint.Port(rawValue:$0)!}
        // At most 2 MiB at the 16-KiB packet ceiling. The owner separately
        // rejects reader age over 250 ms; a larger burst is not stale admission.
        let pair=AsyncThrowingStream<Datagram,Error>.makeStream(bufferingPolicy:.bufferingOldest(128))
        output=pair.stream;continuation=pair.continuation
    }
    func start(port:UInt16=0,reuse:Bool=false) async throws -> (UInt16,AsyncThrowingStream<Datagram,Error>) {
        guard listener==nil,!ended else{throw FlexIQSubscriptionError.busy}
        let parameters=NWParameters.udp;parameters.allowLocalEndpointReuse=reuse
        let next=try NWListener(using:parameters,on:NWEndpoint.Port(rawValue:port)!)
        listener=next
        next.stateUpdateHandler={[weak self] state in Task{await self?.state(state)}}
        let admission=self.admission,peer=self.peer,sourcePort=self.sourcePort
        next.newConnectionHandler={[weak self] connection in
            // Reject unrelated peers before allocating a Task. At most one
            // peer can be admitted for the lifetime of this destination.
            guard case let .hostPort(host,port)=connection.endpoint,
                  admission.claim(host:host,port:port,peer:peer,sourcePort:sourcePort) else{connection.cancel();return}
            Task{await self?.accept(connection)}
        }
        next.start(queue:queue)
        for _ in 0..<100 {
            try Task.checkCancellation()
            if let failure{throw failure}
            if ready,let port=next.port{destinationPort=port.rawValue;return (port.rawValue,output)}
            try await Task.sleep(for:.milliseconds(20))
        }
        stop();throw FlexIQSubscriptionError.noData
    }
    func stop() {
        ended=true;ready=false;connection?.cancel();connection=nil;listener?.cancel();listener=nil
        continuation.finish()
    }
    func diagnostics()->FlexIQInputDiagnostics {
        let counts=admission.counts()
        return FlexIQInputDiagnostics(expectedPeer:String(describing:peer),expectedSourcePort:sourcePort?.rawValue,acceptedSourcePort:acceptedSourcePort,
            destinationPort:destinationPort,candidateConnections:counts.0,rejectedPeerConnections:counts.1,
            rejectedPortConnections:counts.2,extraMatchingConnections:counts.3,firstRejectedEndpoint:counts.4,
            acceptedPeerDatagrams:datagrams,acceptedPeerBytes:byteCount,firstPacketByteCount:firstPacketBytes,
            overflow:overflow,readFailed:readFailed)
    }
    private func state(_ state:NWListener.State) {
        guard listener != nil else{return}
        switch state {
        case .ready:ready=true
        case .failed(let error):failure=error;stop()
        case .cancelled:ready=false
        default:break
        }
    }
    private func accept(_ next:NWConnection) {
        guard !ended,listener != nil,connection==nil,case let .hostPort(host,port)=next.endpoint,
              host==peer,sourcePort.map({$0==port}) ?? true else{next.cancel();return}
        ready=true;connection=next;acceptedSourcePort=port.rawValue;next.start(queue:queue);receive(next)
    }
    private func receive(_ current:NWConnection) {
        current.receiveMessage{[weak self] data,_,_,error in
            let now=DispatchTime.now().uptimeNanoseconds
            Task{await self?.deliver(data,receivedNS:now,error:error,connection:current)}
        }
    }
    private func deliver(_ data:Data?,receivedNS:UInt64,error:NWError?,connection current:NWConnection) {
        guard ready,connection===current,let acceptedSourcePort else{return}
        if let error{readFailed=true;failure=error;continuation.finish(throwing:error);stop();return}
        if let data {
            if datagrams<Int.max{datagrams+=1}
            if UInt64.max-byteCount>=UInt64(data.count){byteCount+=UInt64(data.count)}else{byteCount=UInt64.max}
            if firstPacketBytes==nil{firstPacketBytes=data.count}
            guard !data.isEmpty,data.count<=16384 else{continuation.finish(throwing:FlexIQSubscriptionError.invalidPacket);stop();return}
            switch continuation.yield(Datagram(data:data,receivedNS:receivedNS,sourcePort:acceptedSourcePort)) {
            case .enqueued:break
            case .dropped:overflow=true;continuation.finish(throwing:FlexIQSubscriptionError.overflow);stop();return
            case .terminated:stop();return
            @unknown default:stop();return
            }
        }
        receive(current)
    }
}
#endif
