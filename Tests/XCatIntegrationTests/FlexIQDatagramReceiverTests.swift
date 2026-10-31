import Foundation
import XCTest
@testable import XCatIntegrationCore
#if os(macOS)
@preconcurrency import Network
import Darwin

final class FlexIQDatagramReceiverTests:XCTestCase {
    func testBoundedBurstCanBeQueuedWithoutDroppingTheNinthPacket() async throws {
        let good=try sender();defer{Darwin.close(good.0)}
        let receiver=FlexIQDatagramReceiver(peer:.ipv4(.loopback),sourcePort:good.1)
        let (port,packets)=try await receiver.start();addTeardownBlock{await receiver.stop()}
        for _ in 0..<32{try send(good.0,to:port)}
        for _ in 0..<100 {
            let value=await receiver.diagnostics()
            if value.acceptedPeerDatagrams>=32 || value.overflow{break}
            try await Task.sleep(for:.milliseconds(10))
        }
        let evidence=await receiver.diagnostics()
        XCTAssertFalse(evidence.overflow,"Normal bounded bursts must not be mistaken for sustained overload")
        guard !evidence.overflow else{return}
        let count=try await withThrowingTaskGroup(of:Int.self){group in
            group.addTask{var count=0;for try await _ in packets{count+=1;if count==32{return count}};return count}
            group.addTask{try await Task.sleep(for:.seconds(2));throw FlexIQSubscriptionError.noData}
            defer{group.cancelAll()};return try await group.next()!
        }
        XCTAssertEqual(count,32)
    }
    private func sender() throws -> (Int32,UInt16) {
        let fd=Darwin.socket(AF_INET,SOCK_DGRAM,0)
        guard fd>=0 else{throw FlexIQSubscriptionError.unavailable}
        var address=sockaddr_in();address.sin_len=UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family=sa_family_t(AF_INET);address.sin_addr.s_addr=inet_addr("127.0.0.1")
        let bound=withUnsafePointer(to:&address){$0.withMemoryRebound(to:sockaddr.self,capacity:1){Darwin.bind(fd,$0,socklen_t(MemoryLayout<sockaddr_in>.size))}}
        guard bound==0 else{Darwin.close(fd);throw FlexIQSubscriptionError.unavailable}
        var size=socklen_t(MemoryLayout<sockaddr_in>.size)
        let inspected=withUnsafeMutablePointer(to:&address){$0.withMemoryRebound(to:sockaddr.self,capacity:1){getsockname(fd,$0,&size)}}
        guard inspected==0 else{Darwin.close(fd);throw FlexIQSubscriptionError.unavailable}
        return(fd,UInt16(bigEndian:address.sin_port))
    }
    private func send(_ fd:Int32,to port:UInt16) throws {
        var address=sockaddr_in();address.sin_len=UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family=sa_family_t(AF_INET);address.sin_addr.s_addr=inet_addr("127.0.0.1");address.sin_port=port.bigEndian
        let bytes: [UInt8]=[1,2,3,4]
        let sent=bytes.withUnsafeBytes{buffer in withUnsafePointer(to:&address){$0.withMemoryRebound(to:sockaddr.self,capacity:1){Darwin.sendto(fd,buffer.baseAddress,buffer.count,0,$0,socklen_t(MemoryLayout<sockaddr_in>.size))}}}
        guard sent==bytes.count else{throw FlexIQSubscriptionError.unavailable}
    }
    private func next(_ packets:AsyncThrowingStream<FlexIQDatagramReceiver.Datagram,Error>) async throws -> Data {
        try await withThrowingTaskGroup(of:Data.self){group in
            group.addTask{for try await packet in packets{return packet.data};throw FlexIQSubscriptionError.stopped}
            group.addTask{try await Task.sleep(for:.seconds(2));throw FlexIQSubscriptionError.noData}
            defer{group.cancelAll()}
            return try await group.next()!
        }
    }
    func testLearnedEndpointPinsOneSourcePortAndRejectsLaterPortChange() async throws {
        let good=try sender(),other=try sender();defer{Darwin.close(good.0);Darwin.close(other.0)}
        let receiver=FlexIQDatagramReceiver(peer:.ipv4(.loopback),sourcePort:nil)
        let (port,packets)=try await receiver.start();addTeardownBlock{await receiver.stop()}
        try send(good.0,to:port);_ = try await next(packets)
        try send(other.0,to:port)
        for _ in 0..<100 {
            if await receiver.diagnostics().extraMatchingConnections>0{break}
            try await Task.sleep(for:.milliseconds(10))
        }
        try send(good.0,to:port);_ = try await next(packets);await receiver.stop()
        let evidence=await receiver.diagnostics()
        XCTAssertEqual(evidence.acceptedSourcePort,good.1)
        XCTAssertNil(evidence.expectedSourcePort)
        XCTAssertEqual(evidence.extraMatchingConnections,1)
        XCTAssertEqual(evidence.acceptedPeerDatagrams,2)
    }
    func testLearningPortNeverClaimsAnUnverifiedPeer() async throws {
        let wrong=try sender();defer{Darwin.close(wrong.0)}
        let receiver=FlexIQDatagramReceiver(peer:.ipv4(IPv4Address("127.0.0.2")!),sourcePort:nil)
        let (port,_)=try await receiver.start();addTeardownBlock{await receiver.stop()}
        try send(wrong.0,to:port)
        for _ in 0..<100 {
            if await receiver.diagnostics().rejectedPeerConnections>0{break}
            try await Task.sleep(for:.milliseconds(10))
        }
        await receiver.stop();let evidence=await receiver.diagnostics()
        XCTAssertEqual(evidence.rejectedPeerConnections,1)
        XCTAssertNil(evidence.acceptedSourcePort);XCTAssertEqual(evidence.acceptedPeerDatagrams,0)
    }
    func testUnexpectedPortIsCountedWithoutClaimingTheExpectedPeerOrRetainingPayload() async throws {
        let good=try sender(),wrong=try sender();defer{Darwin.close(good.0);Darwin.close(wrong.0)}
        let receiver=FlexIQDatagramReceiver(peer:.ipv4(.loopback),sourcePort:good.1)
        let (port,packets)=try await receiver.start()
        addTeardownBlock{await receiver.stop()}
        try send(wrong.0,to:port)
        for _ in 0..<100 {
            if await receiver.diagnostics().rejectedPortConnections>0{break}
            try await Task.sleep(for:.milliseconds(10))
        }
        try send(good.0,to:port)
        let received=try await next(packets)
        XCTAssertEqual(received,Data([1,2,3,4]));await receiver.stop()
        let evidence=await receiver.diagnostics()
        XCTAssertGreaterThanOrEqual(evidence.candidateConnections,2)
        XCTAssertEqual(evidence.rejectedPortConnections,1)
        XCTAssertEqual(evidence.rejectedPeerConnections,0)
        XCTAssertEqual(evidence.acceptedPeerDatagrams,1);XCTAssertEqual(evidence.acceptedPeerBytes,4)
        XCTAssertEqual(evidence.firstPacketByteCount,4);XCTAssertEqual(evidence.destinationPort,port)
        XCTAssertEqual(evidence.firstRejectedEndpoint,"127.0.0.1:\(wrong.1)")
        XCTAssertFalse(evidence.overflow);XCTAssertFalse(evidence.readFailed)
    }
}
#endif
