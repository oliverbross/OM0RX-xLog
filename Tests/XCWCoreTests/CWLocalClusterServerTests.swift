import Foundation
import XCTest
@testable import XCWCore
#if os(macOS)
import Darwin

final class CWLocalClusterServerTests:XCTestCase {
    private func spot(at:Date=Date()) -> CWConfirmedSpot {
        CWConfirmedSpot(id:UUID(),sessionID:UUID(),sourceID:UUID(),radioID:"radio1",provider:.tciIQ,receiverID:"0",streamToken:UUID(),
            epoch:"1",trackID:UUID(),callsign:"K1ABC/P",frequencyHz:14025123,observedAt:at,occurrenceRanges:["0:100","200:300"],
            policyVersion:1,originInstanceID:UUID(),modelSHA256:CWSpotPolicy.modelSHA256)
    }
    private func wait(_ predicate:() async -> Bool) async throws {
        for _ in 0..<500 {if await predicate(){return};try await Task.sleep(nanoseconds:5_000_000)}
        XCTFail("Local cluster state did not arrive")
    }
    private func listening(_ server:CWLocalClusterServer) async throws -> UInt16 {
        try await server.start(port:0)
        try await wait{await server.snapshot().state=="listening"}
        let snapshot=await server.snapshot()
        return UInt16(try XCTUnwrap(snapshot.port))
    }
    func testPlainTCPBroadcastExplicitHistoryAndIndependentClients() async throws {
        let server=CWLocalClusterServer(),port=try await listening(server)
        let old=spot(),oldAccepted=try await server.publish(old,stationCallsign:"VK8RX")
        XCTAssertTrue(oldAccepted)
        let first=try CWPlainTestClient(port),second=try CWPlainTestClient(port)
        defer{first.close();second.close()}
        XCTAssertTrue(try first.until("login: ").contains("# OM0RX-xLog"));_ = try second.until("login: ")
        try first.send("K1A");try first.send("BC\r");try first.send("\n")
        let login=try first.until("Local CW spots only.\r\n");XCTAssertFalse(login.contains("DX de"))
        try second.send("logger-2\n");_ = try second.until("Local CW spots only.\r\n")
        XCTAssertTrue(first.available().isEmpty);XCTAssertTrue(second.available().isEmpty)
        let live=spot();let accepted=try await server.publish(live,stationCallsign:"VK8RX")
        XCTAssertTrue(accepted)
        let one=try first.until("Z\r\n"),two=try second.until("Z\r\n")
        XCTAssertEqual(one,two);XCTAssertTrue(one.contains("14025.123"));XCTAssertTrue(one.contains("K1ABC/P"))
        let duplicate=try await server.publish(live,stationCallsign:"VK8RX");XCTAssertFalse(duplicate)
        try first.send("sh/dx/100\r\n")
        let history=try first.until("# End of history\r\n")
        XCTAssertEqual(history.components(separatedBy:"DX de ").count-1,2)
        XCTAssertTrue(history.contains(try CWSpotWire.line(old,stationCallsign:"VK8RX")))
        XCTAssertTrue(second.available().isEmpty)
        try first.send("sh/dx\n");XCTAssertTrue(try first.until("again.\r\n").contains("Wait two seconds"))
        await server.stop()
        let stopped=await server.snapshot();XCTAssertEqual(stopped.clients,0);XCTAssertEqual(stopped.state,"off")
    }
    func testPortCollisionIsVisibleAndDoesNotDiscardAcceptedHistory() async throws {
        let first=CWLocalClusterServer(),port=try await listening(first),other=CWLocalClusterServer()
        let value=spot();_ = try await other.publish(value,stationCallsign:"VK8RX")
        do {try await other.start(port:Int(port))} catch {}
        try await wait{await other.snapshot().state=="occupied"}
        let blocked=await other.snapshot(),healthy=await first.snapshot()
        XCTAssertEqual(blocked.retainedSpots,1);XCTAssertEqual(blocked.clients,0)
        XCTAssertEqual(healthy.state,"listening");XCTAssertEqual(healthy.address,"127.0.0.1")
        await other.stop();await first.stop()
    }
    func testEightClientCapProtocolBudgetAndReconnect() async throws {
        let server=CWLocalClusterServer(),port=try await listening(server)
        var clients:[CWPlainTestClient]=[]
        defer{for client in clients{client.close()}}
        for _ in 0..<8 {let client=try CWPlainTestClient(port);clients.append(client);_ = try client.until("login: ")}
        let ninth=try CWPlainTestClient(port);defer{ninth.close()}
        try await wait{await server.snapshot().refusedConnections==1}
        let full=await server.snapshot();XCTAssertEqual(full.clients,8)
        try clients[0].send(String(repeating:"A",count:513))
        try await wait{await server.snapshot().protocolDisconnects==1}
        let replacement=try CWPlainTestClient(port);clients.append(replacement);_ = try replacement.until("login: ")
        try replacement.send("new-client\n");_ = try replacement.until("Local CW spots only.\r\n")
        let recovered=await server.snapshot();XCTAssertEqual(recovered.clients,8)
        await server.stop()
    }
    func testHistoryIsBoundedByCountAndObservationAgeEvenWhileOff() async throws {
        let clock=CWClusterTestWallClock(),server=CWLocalClusterServer(wallClock:{clock.now()})
        for _ in 0..<105 {_ = try await server.publish(spot(at:clock.now()),stationCallsign:"VK8RX")}
        let full=await server.snapshot();XCTAssertEqual(full.state,"off");XCTAssertEqual(full.retainedSpots,100)
        clock.advance(901)
        let expired=await server.snapshot();XCTAssertEqual(expired.retainedSpots,0)
        let old=try await server.publish(spot(at:clock.now().addingTimeInterval(-121)),stationCallsign:"VK8RX")
        XCTAssertFalse(old)
        await server.stop()
    }
    func testRealSlowSocketIsRemovedWhileHealthyClientKeepsEveryLiveLine() async throws {
        // Marked isolated test sink: ephemeral loopback only, synthetic accepted
        // records, no decoder, normal destination or external logger attached.
        let server=CWLocalClusterServer(),port=try await listening(server)
        let slow=try CWPlainTestClient(port,receiveBuffer:1024),healthy=try CWPlainTestClient(port)
        defer{slow.close();healthy.close()}
        _ = try slow.until("login: ");_ = try healthy.until("login: ")
        try slow.send("isolated-slow\n");try healthy.send("isolated-healthy\n")
        _ = try slow.until("Local CW spots only.\r\n");_ = try healthy.until("Local CW spots only.\r\n")
        // The slow socket never reads again. Pace bounded overload to exercise
        // real TCP backpressure; keep draining the independent healthy socket.
        let start=ProcessInfo.processInfo.systemUptime
        var published=0,received=0,tail="",publishedBytes=0
        func drainHealthy() throws {
            let deadline=ProcessInfo.processInfo.systemUptime+3
            while received<published,ProcessInfo.processInfo.systemUptime<deadline {
                tail+=healthy.available()
                while let end=tail.range(of:"\r\n") {
                    if tail[..<end.lowerBound].hasPrefix("DX de "){received+=1}
                    tail.removeSubrange(..<end.upperBound)
                }
            }
            XCTAssertEqual(received,published,"A slow peer must not lose a healthy client's lines")
            if received != published{throw CWComputeError.startupTimeout}
        }
        while ProcessInfo.processInfo.systemUptime-start<60 {
            for _ in 0..<512 {
                let value=spot(),accepted=try await server.publish(value,stationCallsign:"VK8RX")
                XCTAssertTrue(accepted);published+=1
                publishedBytes+=try CWSpotWire.line(value,stationCallsign:"VK8RX").utf8.count
            }
            try drainHealthy()
            if await server.snapshot().slowDisconnects>0{break}
            try await Task.sleep(nanoseconds:50_000_000)
        }
        let elapsed=ProcessInfo.processInfo.systemUptime-start,snapshot=await server.snapshot()
        XCTAssertGreaterThanOrEqual(elapsed,3);XCTAssertEqual(snapshot.slowDisconnects,1)
        XCTAssertEqual(snapshot.clients,1);XCTAssertEqual(snapshot.authenticatedClients,1)
        XCTAssertEqual(snapshot.state,"listening");XCTAssertLessThanOrEqual(snapshot.retainedSpots,100)
        let probe=spot();_ = try await server.publish(probe,stationCallsign:"VK8RX")
        publishedBytes+=try CWSpotWire.line(probe,stationCallsign:"VK8RX").utf8.count
        published+=1;try drainHealthy()
        print("CW isolated slow-socket receipt: elapsed=\(elapsed)s published=\(published) bytes=\(publishedBytes) healthyReceived=\(received) slowDisconnects=\(snapshot.slowDisconnects) peerReceiveBuffer=\(slow.receiveBufferBytes())")
        await server.stop();let stopped=await server.snapshot();XCTAssertEqual(stopped.clients,0);XCTAssertEqual(stopped.state,"off")
    }
}
private final class CWClusterTestWallClock:@unchecked Sendable {
    private let lock=NSLock();private var value=Date()
    func now()->Date{lock.lock();defer{lock.unlock()};return value}
    func advance(_ seconds:Double){lock.lock();value=value.addingTimeInterval(seconds);lock.unlock()}
}
private final class CWPlainTestClient {
    private var descriptor:Int32
    init(_ port:UInt16,receiveBuffer:Int32?=nil) throws {
        descriptor=Darwin.socket(AF_INET,SOCK_STREAM,0)
        guard descriptor>=0 else {throw CWComputeError.stopped}
        var timeout=timeval(tv_sec:0,tv_usec:200_000),yes:Int32=1
        _ = setsockopt(descriptor,SOL_SOCKET,SO_RCVTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size))
        _ = setsockopt(descriptor,SOL_SOCKET,SO_NOSIGPIPE,&yes,socklen_t(MemoryLayout<Int32>.size))
        if var bytes=receiveBuffer,setsockopt(descriptor,SOL_SOCKET,SO_RCVBUF,&bytes,socklen_t(MemoryLayout<Int32>.size)) != 0 {
            Darwin.close(descriptor);descriptor = -1;throw CWComputeError.stopped
        }
        var address=sockaddr_in();address.sin_len=UInt8(MemoryLayout<sockaddr_in>.size);address.sin_family=sa_family_t(AF_INET)
        address.sin_port=port.bigEndian;address.sin_addr=in_addr(s_addr:inet_addr("127.0.0.1"))
        let result=withUnsafePointer(to:&address){pointer in pointer.withMemoryRebound(to:sockaddr.self,capacity:1){
            Darwin.connect(descriptor,$0,socklen_t(MemoryLayout<sockaddr_in>.size))
        }}
        guard result==0 else{Darwin.close(descriptor);descriptor = -1;throw CWComputeError.stopped}
    }
    deinit{close()}
    func receiveBufferBytes()->Int32 {
        var value:Int32 = -1,length=socklen_t(MemoryLayout<Int32>.size)
        _ = getsockopt(descriptor,SOL_SOCKET,SO_RCVBUF,&value,&length);return value
    }
    func close(){if descriptor>=0{Darwin.close(descriptor);descriptor = -1}}
    func send(_ text:String) throws {
        let bytes=Array(text.utf8)
        let count=bytes.withUnsafeBytes{Darwin.send(descriptor,$0.baseAddress,bytes.count,0)}
        guard count==bytes.count else{throw CWComputeError.stopped}
    }
    func available()->String {
        var buffer=[UInt8](repeating:0,count:4096)
        let count=Darwin.recv(descriptor,&buffer,buffer.count,0)
        return count>0 ? String(decoding:buffer.prefix(count),as:UTF8.self):""
    }
    func until(_ marker:String) throws -> String {
        var text="";let deadline=Date().addingTimeInterval(3)
        while Date()<deadline,text.utf8.count<65536 {
            text+=available();if text.contains(marker){return text}
        }
        XCTFail("TCP client did not receive expected framing: \(marker)")
        throw CWComputeError.startupTimeout
    }
}
#endif
