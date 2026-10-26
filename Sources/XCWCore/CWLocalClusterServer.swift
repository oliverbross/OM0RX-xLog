// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
@preconcurrency import Network

public struct CWLocalClusterSnapshot: Encodable,Sendable {
    public let state:String
    public let address:String = "127.0.0.1"
    public let port:Int?
    public let clients:Int
    public let authenticatedClients:Int
    public let acceptedConnections:UInt64
    public let refusedConnections:UInt64
    public let slowDisconnects:UInt64
    public let protocolDisconnects:UInt64
    public let retainedSpots:Int
}
private final class CWClientAdmission:@unchecked Sendable {
    private let lock=NSLock();private var count=0,refused:UInt64=0
    func reserve()->Bool {
        lock.lock();defer{lock.unlock()}
        guard count<8 else {refused &+= 1;return false};count+=1;return true
    }
    func release(){lock.lock();count=max(0,count-1);lock.unlock()}
    func rejected()->UInt64{lock.lock();defer{lock.unlock()};return refused}
}

/// Local accepted CW output only. This owner never opens an upstream connection
/// and has no radio, QSO, shell or classifier callback. History stays client-local.
public actor CWLocalClusterServer {
    private struct Client {
        let connection:NWConnection
        var protocolState=CWClusterClientProtocol()
        var output=CWClientOutputQueue()
        var writing=false
        var lastHistory:UInt64?
        let accepted:UInt64
    }
    private struct Report {let id:UUID;let line:Data;let observed:Date}
    private let queue=DispatchQueue(label:"com.oliverbross.xlog.cw.local-cluster",qos:.utility)
    private var admission=CWClientAdmission()
    private var listener:NWListener?,identity:UUID?
    private var clients:[UUID:Client]=[:]
    private var history:[Report]=[],seen:[(UUID,Date)]=[]
    private var state="off",port:Int?,accepted:UInt64=0,slow:UInt64=0,malformed:UInt64=0
    private var watchdog:Task<Void,Never>?
    private let clock:@Sendable ()->UInt64
    private let wallClock:@Sendable ()->Date
    public init(clock:@escaping @Sendable ()->UInt64={DispatchTime.now().uptimeNanoseconds},
                wallClock:@escaping @Sendable ()->Date={Date()}) {self.clock=clock;self.wallClock=wallClock}
    deinit {
        watchdog?.cancel();listener?.cancel()
        for client in clients.values {client.connection.cancel()}
    }
    public func snapshot()->CWLocalClusterSnapshot {
        prune()
        return CWLocalClusterSnapshot(state:state,port:port,clients:clients.count,
            authenticatedClients:clients.values.filter{$0.protocolState.clientName != nil}.count,
            acceptedConnections:accepted,refusedConnections:admission.rejected(),slowDisconnects:slow,
            protocolDisconnects:malformed,retainedSpots:history.count)
    }
    /// Port zero is useful for isolated native tests; saved product settings
    /// require an explicit non-privileged port. The actual IPv4 endpoint is shown.
    public func start(port:Int) throws {
        guard identity==nil,(0...65535).contains(port),let endpoint=NWEndpoint.Port(rawValue:UInt16(port)) else {throw CWContractError.invalidConfiguration}
        let parameters=NWParameters.tcp
        parameters.allowLocalEndpointReuse=false
        parameters.requiredLocalEndpoint = .hostPort(host:.ipv4(.loopback),port:endpoint)
        let created:NWListener
        do {created=try NWListener(using:parameters)} catch {
            if let network=error as? NWError,case .posix(.EADDRINUSE)=network {state="occupied"} else {state="failed"}
            self.port=port;throw error
        }
        let id=UUID(),gate=CWClientAdmission()
        listener=created;identity=id;admission=gate;state="starting";self.port=port
        created.stateUpdateHandler = {[weak self,weak created] value in
            let actual=created?.port?.rawValue
            Task{await self?.listenerState(value,actual:actual,id:id)}
        }
        created.newConnectionHandler = {[weak self] connection in
            guard gate.reserve() else {connection.cancel();return}
            Task {
                guard let self else {connection.cancel();gate.release();return}
                await self.admit(connection,id:id,gate:gate)
            }
        }
        created.start(queue:queue)
        watchdog=Task{[weak self] in
            while !Task.isCancelled {
                do {try await Task.sleep(nanoseconds:250_000_000)} catch{return}
                await self?.checkClients(id:id)
            }
        }
    }
    public func stop() {
        identity=nil;watchdog?.cancel();watchdog=nil;listener?.cancel();listener=nil
        for id in Array(clients.keys){close(id)}
        state="off";port=nil
    }
    private func listenerState(_ value:NWListener.State,actual:UInt16?,id:UUID) {
        guard identity==id else {return}
        switch value {
        case .ready:state="listening";if let actual{port=Int(actual)}
        case .failed(let error):
            if case .posix(.EADDRINUSE)=error {state="occupied"} else {state="failed"}
            listener?.cancel();listener=nil;identity=nil;watchdog?.cancel();watchdog=nil
            for id in Array(clients.keys){close(id)}
        default:break
        }
    }
    private func admit(_ connection:NWConnection,id:UUID,gate:CWClientAdmission) {
        guard identity==id,clients.count<8 else {connection.cancel();gate.release();return}
        let clientID=UUID();accepted &+= 1
        clients[clientID]=Client(connection:connection,accepted:clock())
        connection.stateUpdateHandler = {[weak self] value in
            switch value {
            case .failed,.cancelled:Task{await self?.disconnected(clientID,id:id)}
            default:break
            }
        }
        connection.start(queue:queue)
        enqueue(CWClusterClientProtocol.greeting,to:clientID)
        receive(clientID,id:id)
    }
    private func disconnected(_ client:UUID,id:UUID) {guard identity==id else{return};close(client)}
    private func close(_ id:UUID) {
        guard let client=clients.removeValue(forKey:id) else{return}
        client.connection.cancel();admission.release()
    }
    private func receive(_ clientID:UUID,id:UUID) {
        guard identity==id,let client=clients[clientID] else{return}
        client.connection.receive(minimumIncompleteLength:1,maximumLength:4096){[weak self] data,_,done,error in
            Task{await self?.received(data,done:done,failed:error != nil,client:clientID,id:id)}
        }
    }
    private func received(_ data:Data?,done:Bool,failed:Bool,client:UUID,id:UUID) {
        guard identity==id,clients[client] != nil else{return}
        if let data,!data.isEmpty {
            let actions=clients[client]!.protocolState.feed(data)
            for action in actions {
                guard clients[client] != nil else{break}
                switch action {
                case .send(let bytes):enqueue(bytes,to:client)
                case .authenticated:break
                case .close(let reason):
                    if reason != "client_quit" {malformed &+= 1}
                    close(client)
                case .history(let count):
                    let now=clock()
                    if let last=clients[client]?.lastHistory,now<last || now-last<2_000_000_000 {
                        enqueue(Data("# Wait two seconds before requesting history again.\r\n".utf8),to:client);continue
                    }
                    clients[client]?.lastHistory=now;prune()
                    enqueue(Data("# Requested Local CW history\r\n".utf8),to:client)
                    for report in history.suffix(count){enqueue(report.line,to:client)}
                    enqueue(Data("# End of history\r\n".utf8),to:client)
                }
            }
        }
        if done || failed {close(client)} else {receive(client,id:id)}
    }
    private func enqueue(_ data:Data,to client:UUID) {
        guard clients[client] != nil else{return}
        guard clients[client]!.output.enqueue(data,now:clock()) else {slow &+= 1;close(client);return}
        writeNext(client)
    }
    private func writeNext(_ clientID:UUID) {
        guard let id=identity,var client=clients[clientID],!client.writing,let bytes=client.output.first else{return}
        client.writing=true;clients[clientID]=client
        client.connection.send(content:bytes,completion:.contentProcessed{[weak self] error in
            Task{await self?.written(clientID,id:id,failed:error != nil)}
        })
    }
    private func written(_ client:UUID,id:UUID,failed:Bool) {
        guard identity==id,clients[client] != nil else{return}
        if failed{close(client);return}
        clients[client]?.output.complete();clients[client]?.writing=false;writeNext(client)
    }
    private func checkClients(id:UUID) {
        guard identity==id else{return}
        let now=clock()
        for (key,client) in clients {
            if client.output.expired(now:now) {slow &+= 1;close(key)}
            else if client.protocolState.clientName==nil,now>=client.accepted,now-client.accepted>30_000_000_000 {malformed &+= 1;close(key)}
        }
        prune()
    }
    private func prune() {
        let now=wallClock()
        history.removeAll{now.timeIntervalSince($0.observed)<0 || now.timeIntervalSince($0.observed)>900}
        seen.removeAll{now.timeIntervalSince($0.1)<0 || now.timeIntervalSince($0.1)>900}
    }
    @discardableResult public func publish(_ spot:CWConfirmedSpot,stationCallsign:String) throws -> Bool {
        let age=wallClock().timeIntervalSince(spot.observedAt)
        guard age>=0,age<=120 else{return false}
        let bytes=Data(try CWSpotWire.line(spot,stationCallsign:stationCallsign).utf8)
        prune();guard !seen.contains(where:{$0.0==spot.id}) else{return false}
        if seen.count>=4096{seen.removeFirst()};seen.append((spot.id,spot.observedAt))
        history.append(Report(id:spot.id,line:bytes,observed:spot.observedAt))
        if history.count>100{history.removeFirst(history.count-100)}
        for (id,client) in clients where client.protocolState.clientName != nil {enqueue(bytes,to:id)}
        return true
    }
}
#endif
