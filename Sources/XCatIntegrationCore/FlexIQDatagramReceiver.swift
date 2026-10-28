// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
@preconcurrency import Network
import Foundation

private final class FlexIQConnectionAdmission:@unchecked Sendable {
    private let lock=NSLock()
    private var claimed=false
    func claim()->Bool{lock.lock();defer{lock.unlock()};guard !claimed else{return false};claimed=true;return true}
}

/// One owned UDP destination per control connection. One outstanding receive and
/// a bounded delivery queue prevent datagrams from creating an unbounded Task set.
actor FlexIQDatagramReceiver {
    struct Datagram:Sendable {let data:Data;let receivedNS:UInt64}
    private let peer:NWEndpoint.Host
    private let sourcePort:NWEndpoint.Port
    private let queue=DispatchQueue(label:"com.oliverbross.xlog.flex-iq-udp")
    private var listener:NWListener?
    private var connection:NWConnection?
    private var ready=false
    private var ended=false
    private var failure:(any Error)?
    private let output:AsyncThrowingStream<Datagram,Error>
    private let continuation:AsyncThrowingStream<Datagram,Error>.Continuation
    init(peer:NWEndpoint.Host,sourcePort:UInt16) {
        self.peer=peer;self.sourcePort=NWEndpoint.Port(rawValue:sourcePort)!
        let pair=AsyncThrowingStream<Datagram,Error>.makeStream(bufferingPolicy:.bufferingOldest(8))
        output=pair.stream;continuation=pair.continuation
    }
    func start(port:UInt16=0,reuse:Bool=false) async throws -> (UInt16,AsyncThrowingStream<Datagram,Error>) {
        guard listener==nil,!ended else{throw FlexIQSubscriptionError.busy}
        let parameters=NWParameters.udp;parameters.allowLocalEndpointReuse=reuse
        let next=try NWListener(using:parameters,on:NWEndpoint.Port(rawValue:port)!)
        listener=next
        next.stateUpdateHandler={[weak self] state in Task{await self?.state(state)}}
        let admission=FlexIQConnectionAdmission(),peer=self.peer,sourcePort=self.sourcePort
        next.newConnectionHandler={[weak self] connection in
            #if DEBUG
            if ProcessInfo.processInfo.environment["XLOG_IQ_FIXTURE_DIAGNOSTICS"] == "1" {
                print("IQ_UDP_ENDPOINT actual=\(connection.endpoint) expected=\(peer):\(sourcePort)")
            }
            #endif
            // Reject unrelated peers before allocating a Task. At most one
            // peer can be admitted for the lifetime of this destination.
            guard case let .hostPort(host,port)=connection.endpoint,host==peer,port==sourcePort,admission.claim() else{connection.cancel();return}
            Task{await self?.accept(connection)}
        }
        next.start(queue:queue)
        for _ in 0..<100 {
            try Task.checkCancellation()
            if let failure{throw failure}
            if ready,let port=next.port{return (port.rawValue,output)}
            try await Task.sleep(for:.milliseconds(20))
        }
        stop();throw FlexIQSubscriptionError.noData
    }
    func stop() {
        ended=true;ready=false;connection?.cancel();connection=nil;listener?.cancel();listener=nil
        continuation.finish()
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
              host==peer,port==sourcePort else{next.cancel();return}
        ready=true;connection=next;next.start(queue:queue);receive(next)
    }
    private func receive(_ current:NWConnection) {
        current.receiveMessage{[weak self] data,_,_,error in
            let now=DispatchTime.now().uptimeNanoseconds
            Task{await self?.deliver(data,receivedNS:now,error:error,connection:current)}
        }
    }
    private func deliver(_ data:Data?,receivedNS:UInt64,error:NWError?,connection current:NWConnection) {
        guard ready,connection===current else{return}
        if let error{failure=error;continuation.finish(throwing:error);stop();return}
        if let data {
            guard !data.isEmpty,data.count<=16384 else{continuation.finish(throwing:FlexIQSubscriptionError.invalidPacket);stop();return}
            switch continuation.yield(Datagram(data:data,receivedNS:receivedNS)) {
            case .enqueued:break
            case .dropped:continuation.finish(throwing:FlexIQSubscriptionError.overflow);stop();return
            case .terminated:stop();return
            @unknown default:stop();return
            }
        }
        receive(current)
    }
}
#endif
