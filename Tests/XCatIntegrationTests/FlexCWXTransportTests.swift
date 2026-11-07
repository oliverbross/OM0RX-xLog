#if os(macOS)
import Foundation
import XCTest
@preconcurrency import Network
@testable import XCatIntegrationCore

/// Real FlexRadioClient TCP framing/continuations against a disposable protocol
/// fixture. These are transport tests, not physical FLEX-8400 qualification.
final class FlexCWXTransportTests: XCTestCase {
    func testCWXClientHandlesKeepHexadecimalProtocolSemanticsWithoutIQInventory() {
        XCTAssertEqual(FlexRadioClient.protocolHandle("00000010"), 16)
        XCTAssertEqual(FlexRadioClient.protocolHandle("000000ab"), 171)
        XCTAssertEqual(FlexRadioClient.protocolHandle("0xAB"), 171)
        for value in ["", "0x", " 10", "+10", "100000000", "not-a-handle"] {
            XCTAssertNil(FlexRadioClient.protocolHandle(value))
        }
    }
    private func setup(malformedReply:Bool=false) async throws -> (FlexRadioClient,CWXWire) {
        let wire=CWXWire(malformedReply:malformedReply),port=try await wire.start()
        let radio=FlexRadioClient(host:"127.0.0.1",port:port,stationName:"Fixture")
        addTeardownBlock {await radio.stopTransportOnly();await wire.stop()}
        await radio.start()
        for _ in 0..<500 {if await radio.compositionSnapshot().available {return (radio,wire)};try await Task.sleep(for:.milliseconds(10))}
        throw XCatError.notConnected
    }
    func testOM0ThenRXExactlyOnceWithDuplicateRepliesAndForeignProgress() async throws {
        let (radio,wire)=try await setup(),job=UUID().uuidString
        let generation=await radio.compositionSnapshot().generation
        _ = try await radio.appendCW(generation:generation,job:job,ordinal:1,text:"OM0",finish:false)
        _ = try await radio.appendCW(generation:generation,job:job,ordinal:1,text:"OM0",finish:false)
        _ = try await radio.appendCW(generation:generation,job:job,ordinal:2,text:"RX",finish:false)
        await wire.repeatReply()
        await wire.status("S000000cd|cwx sent=174")
        try await radio.setCWSpeed(25) // in-order fixture barrier, not RF timing
        var progress=await radio.compositionSnapshot();XCTAssertEqual(progress.reported,0)
        await wire.status("S000000ab|cwx sent=172")
        await wire.status("S000000ab|cwx sent=172")
        try await radio.setCWSpeed(25)
        progress=await radio.compositionSnapshot();XCTAssertEqual(progress.reported,3)
        await wire.status("S000000ab|cwx sent=174")
        try await radio.setCWSpeed(25)
        progress=await radio.compositionSnapshot();XCTAssertEqual(progress.reported,5)
        let commands=await wire.commands.filter{$0.hasPrefix("cwx send")}
        XCTAssertEqual(commands,["cwx send \"OM0\" 1","cwx send \"RX\" 2"])
        await radio.reconnectNow()
        for _ in 0..<500 {let s=await radio.compositionSnapshot();if s.available && s.generation != generation {break};try await Task.sleep(for:.milliseconds(10))}
        do {_ = try await radio.appendCW(generation:generation,job:job,ordinal:3,text:"OLD",finish:false);XCTFail("Old connection accepted")} catch {}
        let after=await wire.commands.filter{$0.hasPrefix("cwx send")}
        XCTAssertEqual(after,commands,"Reconnect must not replay any buffered text")
    }
    func testStopRetiresPendingReplyBeforeClearAndNeverSendsTail() async throws {
        let (radio,wire)=try await setup(),job=UUID().uuidString
        let generation=await radio.compositionSnapshot().generation
        await wire.holdNext()
        let append=Task {try await radio.appendCW(generation:generation,job:job,ordinal:1,text:"OM0",finish:false)}
        for _ in 0..<500 {if await wire.held {break};try await Task.sleep(for:.milliseconds(5))}
        let held=await wire.held;XCTAssertTrue(held)
        try await radio.clearCW()
        await wire.release()
        do {_ = try await append.value;XCTFail("Stopped append revived")}catch{}
        do {_ = try await radio.appendCW(generation:generation,job:job,ordinal:2,text:"RX",finish:false);XCTFail("Stopped tail sent")}catch{}
        await wire.status("S000000ab|cwx sent=172");try await radio.setCWSpeed(25)
        let state=await radio.compositionSnapshot(),commands=await wire.commands
        XCTAssertNil(state.job);XCTAssertEqual(state.reported,0)
        XCTAssertEqual(commands.filter{$0.hasPrefix("cwx send")},["cwx send \"OM0\" 1"])
        XCTAssertTrue(commands.contains("cwx clear"))
    }
    func testStopArrivingBeforeFirstAppendRetiresItsIdentityAndStaleStopLeavesCurrentJob() async throws {
        let(radio,wire)=try await setup(),job=UUID().uuidString
        let generation=await radio.compositionSnapshot().generation
        let retired=await radio.retireCWComposition(generation:generation,job:job);XCTAssertTrue(retired)
        do{_ = try await radio.appendCW(generation:generation,job:job,ordinal:1,text:"OM0",finish:false);XCTFail("Delayed first append sent")}catch{}
        let current=UUID().uuidString
        _ = try await radio.appendCW(generation:generation,job:current,ordinal:1,text:"NEW",finish:false)
        let stale=await radio.retireCWComposition(generation:generation-1,job:current);XCTAssertFalse(stale)
        do{try await radio.clearCWComposition(generation:generation-1);XCTFail("Stale Stop cleared new transport")}catch{}
        let snapshot=await radio.compositionSnapshot(),commands=await wire.commands
        XCTAssertEqual(snapshot.job,current)
        XCTAssertEqual(commands.filter{$0.hasPrefix("cwx ")},["cwx send \"NEW\" 1"])
    }
    func testUnattributableProgressDisablesLiveButWholeMessageSendRemains() async throws {
        let (radio,wire)=try await setup(),job=UUID().uuidString
        let generation=await radio.compositionSnapshot().generation
        _ = try await radio.appendCW(generation:generation,job:job,ordinal:1,text:"OM0",finish:false)
        await wire.status("S0|cwx sent=172");try await radio.setCWSpeed(25)
        let state=await radio.compositionSnapshot();XCTAssertFalse(state.available);XCTAssertEqual(state.reported,0)
        do {_ = try await radio.appendCW(generation:generation,job:job,ordinal:2,text:"RX",finish:false);XCTFail("Unattributed append sent")}catch{}
        try await radio.clearCW();try await radio.sendCW("CQ TEST")
        let commands=await wire.commands;XCTAssertTrue(commands.contains("cwx send CQ TEST"))
        let after=await radio.compositionSnapshot();XCTAssertFalse(after.available)
    }
    func testMissingIndexedBlockReplyNeverRetriesAndPreservesWholeMessageFallback() async throws {
        let(radio,wire)=try await setup(malformedReply:true),job=UUID().uuidString
        let generation=await radio.compositionSnapshot().generation
        do{_ = try await radio.appendCW(generation:generation,job:job,ordinal:1,text:"OM0",finish:false);XCTFail("Missing block was accepted")}catch{}
        let unavailable=await radio.compositionSnapshot();XCTAssertFalse(unavailable.available)
        do{_ = try await radio.appendCW(generation:generation,job:job,ordinal:1,text:"OM0",finish:false);XCTFail("Uncertain command was retried")}catch{}
        try await radio.clearCWComposition(generation:generation);try await radio.sendCW("CQ TEST")
        let commands=await wire.commands.filter{$0.hasPrefix("cwx send")}
        XCTAssertEqual(commands,["cwx send \"OM0\" 1","cwx send CQ TEST"])
    }
    func testUnindexedWholeMessageCannotLendLateProgressToALiveJob() async throws {
        let(radio,wire)=try await setup()
        let generation=await radio.compositionSnapshot().generation
        try await radio.sendCW("CQ TEST");try await radio.clearCW()
        do{_ = try await radio.appendCW(generation:generation,job:UUID().uuidString,ordinal:1,text:"OM0",finish:false);XCTFail("Unindexed history allowed live attribution")}catch{}
        await wire.status("S000000ab|cwx sent=172");try await radio.setCWSpeed(25)
        let state=await radio.compositionSnapshot(),commands=await wire.commands
        XCTAssertFalse(state.available);XCTAssertEqual(state.reported,0)
        XCTAssertEqual(commands.filter{$0.hasPrefix("cwx send")},["cwx send CQ TEST"])
    }
}

private actor CWXWire {
    private let malformedReply:Bool
    init(malformedReply:Bool=false){self.malformedReply=malformedReply}
    private var listener:NWListener?,connection:NWConnection?,buffer=Data(),ready=false
    private let queue=DispatchQueue(label:"xlog.fixture.cwx")
    private(set) var commands:[String]=[]
    private var nextIndex=170,lastReply="",holding=false,heldReply:String?
    var held:Bool {heldReply != nil}
    func start() async throws -> UInt16 {
        let listener=try NWListener(using:.tcp,on:.any);self.listener=listener
        listener.stateUpdateHandler={[weak self] state in if case .ready=state {Task{await self?.markReady()}}}
        listener.newConnectionHandler={[weak self] connection in Task{await self?.accept(connection)}}
        listener.start(queue:queue)
        for _ in 0..<500 {if ready,let port=listener.port{return port.rawValue};try await Task.sleep(for:.milliseconds(10))}
        throw XCatError.notConnected
    }
    private func markReady(){ready=true}
    private func accept(_ current:NWConnection){connection=current;buffer=Data();current.start(queue:queue);send("H000000ab\n");receive(current)}
    private func receive(_ current:NWConnection){current.receive(minimumIncompleteLength:1,maximumLength:16384){[weak self] data,_,done,error in Task{await self?.consume(data,current:current,done:done || error != nil)}}}
    private func consume(_ data:Data?,current:NWConnection,done:Bool){
        guard connection===current else{return};if let data{buffer.append(data)}
        while let end=buffer.firstIndex(of:10){
            let line=String(decoding:buffer[..<end],as:UTF8.self);buffer.removeSubrange(...end)
            let parts=line.dropFirst().split(separator:"|",maxSplits:1);guard parts.count==2,let sequence=Int(parts[0]) else{continue}
            let body=String(parts[1]);commands.append(body)
            var message=""
            if body.hasPrefix("cwx send \""),let block=body.split(separator:" ").last {
                let text=body.split(separator:"\"",omittingEmptySubsequences:false)[1]
                message=malformedReply ? "\(nextIndex)" : "\(nextIndex),\(block)";nextIndex += text.utf8.count
            }
            let reply="R\(sequence)|0|\(message)\n"
            if body.hasPrefix("cwx send \""){lastReply=reply;if holding{holding=false;heldReply=reply;continue}}
            send(reply)
        }
        if !done{receive(current)}
    }
    func status(_ line:String){send(line+"\n")}
    func repeatReply(){send(lastReply)}
    func holdNext(){holding=true}
    func release(){if let heldReply{send(heldReply)};heldReply=nil}
    private func send(_ value:String){connection?.send(content:Data(value.utf8),completion:.contentProcessed{_ in})}
    func stop(){connection?.cancel();listener?.cancel();connection=nil;listener=nil}
}
#endif
