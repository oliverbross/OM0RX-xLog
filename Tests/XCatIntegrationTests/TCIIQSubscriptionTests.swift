// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation
import XCTest
@testable import XCatIntegrationCore

#if os(macOS)
final class TCIIQSubscriptionTests: XCTestCase {
    private static let discovery = "protocol:ExpertSDR3,2.1;device:SunSDR2DX;receive_only:false;trx_count:2;channels_count:2;" +
        "vfo_limits:0,160000000;if_limits:-39000,39000;modulations_list:CW,USB;start;" +
        "vfo:0,0,14025000;modulation:0,CW;rx_enable:0,true;trx:0,false;tune:0,false;dds:0,14025000;" +
        "rx_enable:1,true;trx:1,false;tune:1,false;dds:1,7025000;ready;"
    private func setup() async throws -> (TCIReadOnlyWebSocketSession,IQTestConnection,IQTestClock) {
        let wire=IQTestConnection(), clock=IQTestClock()
        let session=TCIReadOnlyWebSocketSession(endpoint:URL(string:"ws://127.0.0.1:50001")!,
            configuredAddress:TCIReceiverAddress(trx:0,channel:0),connector:IQTestConnector(wire:wire),
            monotonicClock:{clock.now()})
        try await session.connect(); await wire.enqueue(.text(Self.discovery))
        _ = try await observation(session,after:0)
        return (session,wire,clock)
    }
    private func observation(_ session:TCIReadOnlyWebSocketSession,after sequence:UInt64) async throws -> TCIReadOnlySessionObservation {
        for _ in 0..<1000 {
            let value=await session.currentObservation()
            if value.sequence>sequence && value.availability == .available { return value }
            try await Task.sleep(nanoseconds:1_000_000)
        }
        throw TCIIQSubscriptionError.noData
    }
    private func next(_ sub:TCIIQSubscription) async throws -> TCIIQBlock {
        try await withThrowingTaskGroup(of:TCIIQBlock.self) { group in
            group.addTask {
                var iterator=sub.blocks.makeAsyncIterator()
                guard let block=try await iterator.next() else { throw TCIIQSubscriptionError.stopped }
                return block
            }
            group.addTask { try await Task.sleep(nanoseconds:2_000_000_000); throw TCIIQSubscriptionError.noData }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }
    private func frame(receiver:Int=0) -> Data {
        var data=Data(repeating:0,count:80)
        for (offset,value):(Int,UInt32) in [(0,UInt32(receiver)),(4,96000),(8,3),(20,4),(28,2),(32,9),
                                           (64,Float(0.5).bitPattern),(68,Float(-0.25).bitPattern)] {
            for i in 0..<4 { data[offset+i]=UInt8(truncatingIfNeeded:value>>(i*8)) }
        }
        return data
    }
    func testTwoOwnedReceiversUseOneConnectionAndStopKeepsCATAlive() async throws {
        let (session,wire,clock)=try await setup()
        let generation=await session.currentObservation().generation
        let first=try await session.startIQ(receiver:0,sampleRate:96000,expectedGeneration:generation)
        let second=try await session.startIQ(receiver:1,sampleRate:96000,expectedGeneration:generation)
        clock.advance(600_000_000)
        await wire.enqueue(.binary(frame())); await wire.enqueue(.binary(frame(receiver:1)))
        let a=try await next(first),b=try await next(second)
        XCTAssertEqual(a.capture.centreHz,14025000); XCTAssertEqual(b.capture.centreHz,7025000)
        XCTAssertNotEqual(a.capture.streamToken,b.capture.streamToken); XCTAssertFalse(a.capture.frequencyQualified)
        XCTAssertEqual(a.frame.samples,[0.5,-0.25,0,0]); XCTAssertEqual(a.firstSample,0)
        await session.stopIQ(leaseID:first.leaseID)
        await session.stopIQ(leaseID:first.leaseID) // idempotent, no second stop
        let stopped=await wire.sentTexts()
        XCTAssertEqual(stopped,["iq_samplerate:96000;","iq_start:0;","iq_start:1;","iq_stop:0;"])
        let closeCount=await wire.closeCount(), state=await session.currentObservation()
        XCTAssertEqual(closeCount,0); XCTAssertEqual(state.availability,.available)
        await session.stopIQ(leaseID:second.leaseID); await session.disconnect()
    }
    func testVFODoesNotRelabelDDSAndRetuneChangesEpochAfterQuarantine() async throws {
        let (session,wire,clock)=try await setup()
        let initial=await session.currentObservation()
        let sub=try await session.startIQ(receiver:0,sampleRate:96000,expectedGeneration:initial.generation)
        clock.advance(600_000_000); await wire.enqueue(.binary(frame()))
        let first=try await next(sub)
        await wire.enqueue(.text("vfo:0,0,14030000;"))
        let changed=try await observation(session,after:initial.sequence)
        await wire.enqueue(.binary(frame())); let vfo=try await next(sub)
        XCTAssertEqual(vfo.capture.streamToken,first.capture.streamToken); XCTAssertEqual(vfo.capture.centreHz,14025000)
        await wire.enqueue(.text("dds:0,14035000;")); _ = try await observation(session,after:changed.sequence)
        clock.advance(600_000_000); await wire.enqueue(.binary(frame())); let retuned=try await next(sub)
        XCTAssertNotEqual(retuned.capture.streamToken,first.capture.streamToken)
        XCTAssertEqual(retuned.capture.centreHz,14035000); XCTAssertEqual(retuned.firstSample,0)
        await session.stopIQ(leaseID:sub.leaseID); await session.disconnect()
    }
    func testMalformedIQAndNoDataRetireOnlyIQAndNeverTransmit() async throws {
        let (session,wire,clock)=try await setup()
        let generation=await session.currentObservation().generation
        let sub=try await session.startIQ(receiver:0,sampleRate:96000,expectedGeneration:generation)
        var bad=frame(); bad[28]=1; await wire.enqueue(.binary(bad))
        do { _ = try await next(sub); XCTFail("Malformed IQ must fail") }
        catch { XCTAssertEqual(error as? TCIIQSubscriptionError,.invalidFrame) }
        let state=await session.currentObservation()
        XCTAssertEqual(state.availability,.available)
        let retry=try await session.startIQ(receiver:0,sampleRate:96000,expectedGeneration:generation)
        clock.advance(5_100_000_000)
        do { _ = try await next(retry); XCTFail("No-data startup must fail") }
        catch { XCTAssertEqual(error as? TCIIQSubscriptionError,.noData) }
        let commands=await wire.sentTexts()
        let closeCount=await wire.closeCount()
        XCTAssertTrue(commands.allSatisfy{$0.hasPrefix("iq_")}); XCTAssertEqual(closeCount,0)
        await session.disconnect()
    }
    func testRigWideTXAndCoverageChangesRetireCaptureEvidence() async throws {
        let (session,wire,clock)=try await setup()
        let initial=await session.currentObservation()
        let sub=try await session.startIQ(receiver:0,sampleRate:96000,expectedGeneration:initial.generation)
        clock.advance(600_000_000); await wire.enqueue(.binary(frame())); let first=try await next(sub)
        await wire.enqueue(.text("trx:1,true;")); let tx=try await observation(session,after:initial.sequence)
        let invalidated=await session.currentIQCapture(leaseID:sub.leaseID)
        XCTAssertNil(invalidated) // fences an in-flight decoder result immediately
        clock.advance(600_000_000)
        await wire.enqueue(.binary(frame())); await wire.enqueue(.binary(frame())) // must be discarded
        await wire.enqueue(.text("trx:1,false;")); let rx=try await observation(session,after:tx.sequence)
        clock.advance(600_000_000); await wire.enqueue(.binary(frame())); let resumed=try await next(sub)
        XCTAssertNotEqual(resumed.capture.streamToken,first.capture.streamToken)
        XCTAssertEqual(resumed.firstSample,0)
        await wire.enqueue(.text("if_limits:-10000,10000;")); _ = try await observation(session,after:rx.sequence)
        clock.advance(600_000_000); await wire.enqueue(.binary(frame())); let narrowed=try await next(sub)
        XCTAssertNotEqual(narrowed.capture.streamToken,resumed.capture.streamToken)
        XCTAssertEqual(narrowed.capture.lowerOffsetHz,-10000); XCTAssertEqual(narrowed.capture.upperOffsetHz,10000)
        await session.stopIQ(leaseID:sub.leaseID); await session.disconnect()
    }
    func testBackpressureFaultDoesNotStopHealthySecondReceiverOrCAT() async throws {
        let (session,wire,clock)=try await setup()
        let generation=await session.currentObservation().generation
        let slow=try await session.startIQ(receiver:0,sampleRate:96000,expectedGeneration:generation)
        let healthy=try await session.startIQ(receiver:1,sampleRate:96000,expectedGeneration:generation)
        clock.advance(600_000_000)
        for _ in 0..<3 { await wire.enqueue(.binary(frame())) }
        await wire.enqueue(.binary(frame(receiver:1)))
        let block=try await next(healthy)
        XCTAssertEqual(block.capture.receiver,1)
        _ = try await next(slow); _ = try await next(slow)
        do { _ = try await next(slow); XCTFail("Slow receiver must fault") }
        catch { XCTAssertEqual(error as? TCIIQSubscriptionError,.overflow) }
        let state=await session.currentObservation(), closes=await wire.closeCount()
        XCTAssertEqual(state.availability,.available); XCTAssertEqual(closes,0)
        await session.stopIQ(leaseID:healthy.leaseID); await session.disconnect()
    }
}

private final class IQTestClock: @unchecked Sendable {
    private let lock=NSLock(); private var value:UInt64=1_000_000_000
    func now() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ ns:UInt64) { lock.lock(); defer {lock.unlock()}; value+=ns }
}
private struct IQTestConnector: TCIWebSocketConnecting {
    let wire:IQTestConnection
    func connect(to endpoint:URL) async throws -> any TCIWebSocketConnection { wire }
}
private actor IQTestConnection: TCIWebSocketConnection {
    private var pending:[TCIWebSocketMessage]=[]
    private var waiter:CheckedContinuation<TCIWebSocketMessage,Error>?
    private var sent:[String]=[]; private var closes=0
    func receive() async throws -> TCIWebSocketMessage {
        if !pending.isEmpty { return pending.removeFirst() }
        return try await withCheckedThrowingContinuation{waiter=$0}
    }
    func enqueue(_ message:TCIWebSocketMessage) {
        if let waiter { self.waiter=nil; waiter.resume(returning:message) } else { pending.append(message) }
    }
    func send(text:String) async throws { sent.append(text) }
    func close() async { closes+=1; waiter?.resume(throwing:TCIIQSubscriptionError.stopped); waiter=nil }
    func sentTexts() -> [String] { sent }
    func closeCount() -> Int { closes }
}
#endif
