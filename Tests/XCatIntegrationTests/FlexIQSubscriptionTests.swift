import Foundation
import XCTest
@testable import XCatIntegrationCore
#if os(macOS)
@preconcurrency import Network
import Darwin

final class FlexIQSubscriptionTests:XCTestCase {
    func testIQControlEvidenceIsBoundedAndSurvivesTransportStop() async {
        let radio=FlexRadioClient(host:"127.0.0.1",stationName:"Fixture")
        await radio.iqConsumeStatus("stream 0x80000001 license=private_fixture_value type=dax_iq daxiq_channel=1")
        let inventory=await radio.iqDiagnostics()
        XCTAssertEqual(inventory.count,1)
        XCTAssertFalse(inventory[0].detail.contains("license"))
        XCTAssertFalse(inventory[0].detail.contains("private_fixture_value"))
        for index in 0..<140 {await radio.iqTrace("fixture","\(index):"+String(repeating:"x",count:600)+"\n")}
        await radio.stopTransportOnly()
        let events=await radio.iqDiagnostics()
        XCTAssertEqual(events.count,128)
        XCTAssertTrue(events.first?.detail.hasPrefix("12:")==true)
        XCTAssertTrue(events.allSatisfy{$0.detail.utf8.count<=512 && !$0.detail.contains("\n")})
    }
    private func setup() async throws -> (FlexRadioClient,FlexIQFixtureRadio) {
        let wire=FlexIQFixtureRadio()
        addTeardownBlock { await wire.stop() }
        let port=try await wire.start()
        let radio=FlexRadioClient(host:"127.0.0.1",port:port,stationName:"Fixture")
        addTeardownBlock { await radio.stopTransportOnly() }
        await radio.start()
        if ProcessInfo.processInfo.environment["XLOG_IQ_FIXTURE_DIAGNOSTICS"] == "1" {
            let monitor=Task {
                for _ in 0..<5 {
                    try? await Task.sleep(for:.milliseconds(500))
                    guard !Task.isCancelled else{return}
                    print("IQ_FIXTURE \(await radio.fixtureIQDiagnostics()) sent=\(await wire.sentDatagrams)")
                }
            }
            addTeardownBlock { monitor.cancel() }
        }
        for _ in 0..<200 {
            let capability=await radio.iqCapabilities()
            if capability.ready,capability.panadapters.count==2 {
                await radio.fixtureIQIdentity(port:port)
                return (radio,wire)
            }
            try await Task.sleep(for:.milliseconds(10))
        }
        await radio.stopTransportOnly();await wire.stop();throw FlexIQSubscriptionError.noData
    }
    private func authorize(_ radio:FlexRadioClient,_ id:String="40000000") async throws {
        let capabilities=await radio.iqCapabilities()
        try await radio.authorizeIQHandoff(panadapterID:id,inventoryRevision:capabilities.inventoryRevision)
    }
    func testPassiveInventoryAndTransportCloseNeverAcquireOrReleaseRadioOutput() async throws {
        let (radio,wire)=try await setup()
        let capabilities=await radio.iqCapabilities();XCTAssertTrue(capabilities.ready);XCTAssertEqual(capabilities.panadapters.count,2)
        await radio.stopTransportOnly()
        let commands=await wire.commands
        let allowed:Set<String>=["sub client all","sub slice all","sub radio all","sub tx all","keepalive enable","slice list","ping",
                                 "sub pan all","sub audio_stream all","sub daxiq all","sub dax all"]
        XCTAssertTrue(commands.allSatisfy{allowed.contains($0) || $0.hasPrefix("client bind client_id=")},"Unexpected command: \(commands)")
        XCTAssertFalse(commands.contains{$0.hasPrefix("stream ") || $0.hasPrefix("client udpport")})
        await wire.stop()
    }
    func testCancelledAcquisitionCannotIssueAnyIQResourceCommand() async throws {
        let (radio,wire)=try await setup();try await authorize(radio)
        let before=await wire.commands
        let request=Task {
            withUnsafeCurrentTask{$0?.cancel()}
            return try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:UUID())
        }
        do{let result=try await request.value;await radio.stopIQ(leaseID:result.leaseID);XCTFail("Cancelled request acquired IQ")}
        catch{XCTAssertTrue(error is CancellationError)}
        let after=await wire.commands
        XCTAssertEqual(after,before,"Cancellation must precede UDP destination and stream-creation commands")
    }
    func testCancelledPendingAcquisitionStillRemovesItsCreatedStream() async throws {
        let (radio,wire)=try await setup();try await authorize(radio)
        let request=Task{try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:UUID())}
        var created=false
        for _ in 0..<200 {
            if await wire.commands.contains(where:{$0.hasPrefix("stream set ")}) {created=true;break}
            try await Task.sleep(for:.milliseconds(1))
        }
        XCTAssertTrue(created);request.cancel()
        do{_ = try await request.value;XCTFail("Cancelled pending IQ request attached")}
        catch{XCTAssertTrue(error is CancellationError)}
        let commands=await wire.commands
        XCTAssertEqual(commands.filter{$0.hasPrefix("stream remove ")}.count,1,"An already-cancelled caller must still release its owned stream")
    }
    func testInterlockRefusalDiagnosticsAreBoundedAndCannotAuthorizeMissingOrAmbiguousState() async throws {
        let (radio,wire)=try await setup()
        for (body,fields,raw,accepted) in [
            ("interlock state=READY","single","READY",true),
            ("interlock tx_allowed=1","none",nil,false),
            ("interlock state=TRANSMITTING state=READY","multiple",nil,false),
            ("interlock state=ready","single","ready",false),
            ("interlock state=PTT_REQUESTED","single","PTT_REQUESTED",false),
            ("interlock state="+String(repeating:"X",count:100),"single",nil,false)
        ] as [(String,String,String?,Bool)] {
            await radio.iqConsumeStatus(body)
            let value=await radio.iqCapabilities()
            XCTAssertEqual(value.interlockEvidence?.stateFields,fields)
            XCTAssertEqual(value.interlockEvidence?.rawState,raw)
            XCTAssertEqual(value.interlockEvidence?.acceptedReceive,accepted)
            XCTAssertEqual(value.transmitStateKnownOff,accepted)
        }
        await radio.iqConsumeStatus("interlock band 3 tx1_enabled=1 tx2_enabled=0")
        let band=await radio.iqCapabilities()
        XCTAssertEqual(band.interlockEvidence?.messageKind,"band_configuration")
        XCTAssertEqual(band.interlockEvidence?.fieldNames,["tx1_enabled","tx2_enabled"])
        XCTAssertFalse(band.transmitStateKnownOff) // diagnostics do not change admission
        await radio.iqConsumeStatus("interlock "+(0..<40).map{"field_\($0)=PRIVATE_VALUE"}.joined(separator:" "))
        let bounded=await radio.iqCapabilities()
        XCTAssertEqual(bounded.interlockEvidence?.fieldNames.count,16)
        XCTAssertFalse(String(decoding:try JSONEncoder().encode(bounded),as:UTF8.self).contains("PRIVATE_VALUE"))
        let commands=await wire.commands
        XCTAssertFalse(commands.contains{$0.hasPrefix("stream ")||$0.hasPrefix("client udpport")})
        await radio.stopTransportOnly()
        let closed=await radio.iqCapabilities();XCTAssertNil(closed.interlockEvidence)
        await wire.stop()
    }
    func testValidatedInterlockSettingsRetainButNeverCreateReceiveEvidence() async throws {
        let (radio,wire)=try await setup()
        let ready=await radio.iqCapabilities();XCTAssertTrue(ready.transmitStateKnownOff)
        XCTAssertEqual(ready.interlockEvidence?.messageKind,"interlock_settings")
        XCTAssertEqual(ready.interlockEvidence?.stateRetained,true)
        for state in ["PTT_REQUESTED","TRANSMITTING","NOT_READY","UNRECOGNIZED"] {
            await radio.iqConsumeStatus("interlock state="+state)
            await radio.iqConsumeStatus("interlock tx1_enabled=1 timeout=60000 tx_delay=0")
            let value=await radio.iqCapabilities();XCTAssertFalse(value.transmitStateKnownOff)
            XCTAssertEqual(value.interlockEvidence?.stateRetained,true)
        }
        for malformed in ["interlock tx1_enabled=2","interlock tx_delay=-1","interlock timeout=2147483648",
            "interlock tx_delay=0 tx_delay=0","interlock tx_delay=0 unknown=1","interlock tx_allowed=1",
            "interlock state=TRANSMITTING state=READY","interlock state=READY tx_delay=0 state=PTT_REQUESTED"] {
            await radio.iqConsumeStatus("interlock state=READY")
            await radio.iqConsumeStatus(malformed)
            let value=await radio.iqCapabilities();XCTAssertFalse(value.transmitStateKnownOff)
            XCTAssertEqual(value.interlockEvidence?.stateRetained,false)
        }
        await radio.stopTransportOnly()
        await radio.iqConsumeStatus("interlock tx1_enabled=1 timeout=60000")
        let closed=await radio.iqCapabilities();XCTAssertFalse(closed.transmitStateKnownOff)
        XCTAssertEqual(closed.interlockEvidence?.acceptedReceive,false)
        let commands=await wire.commands;XCTAssertFalse(commands.contains{$0.hasPrefix("stream ")||$0.hasPrefix("client udpport")})
        await wire.stop()
    }
    func testInterlockHistoryAttributesStateLossWithoutRetainingSettingsValuesOrGrantingRX() async throws {
        let (radio,wire)=try await setup()
        await radio.iqConsumeStatus("interlock state=READY")
        await radio.iqConsumeStatus("interlock band 3 tx1_enabled=1 unknown=PRIVATE_VALUE")
        await radio.iqConsumeStatus("interlock tx1_enabled=1 timeout=60000")
        let observed=await radio.iqCapabilities()
        XCTAssertEqual(observed.interlockEvidenceHistory.suffix(3).map(\.messageKind),["interlock","band_configuration","interlock_settings"])
        XCTAssertEqual(observed.interlockEvidenceHistory.suffix(3).map(\.acceptedReceive),[true,false,false])
        XCTAssertFalse(observed.transmitStateKnownOff)
        for index in 0..<80 { await radio.iqConsumeStatus("interlock private_field=PRIVATE_VALUE_\(index)") }
        let bounded=await radio.iqCapabilities()
        XCTAssertEqual(bounded.interlockEvidenceHistory.count,32)
        XCTAssertFalse(String(decoding:try JSONEncoder().encode(bounded),as:UTF8.self).contains("PRIVATE_VALUE"))
        await radio.stopTransportOnly()
        let closed=await radio.iqCapabilities();XCTAssertTrue(closed.interlockEvidenceHistory.isEmpty)
        let commands=await wire.commands;XCTAssertFalse(commands.contains{$0.hasPrefix("stream ")||$0.hasPrefix("client udpport")})
        await wire.stop()
    }
    func testValidatedBandInterlockSettingsPreserveOnlyPrecedingReceiveEvidence() async throws {
        let (radio,wire)=try await setup()
        let settings="interlock band 3 band_name=20m acc_tx_enabled=0 acc_txreq_enable=0 rca_txreq_enable=0 tune_tx_suppress=0 tx1_enabled=1 tx2_enabled=0 tx3_enabled=0"
        await radio.iqConsumeStatus(settings)
        let ready=await radio.iqCapabilities()
        XCTAssertTrue(ready.transmitStateKnownOff)
        XCTAssertEqual(ready.interlockEvidence?.messageKind,"band_configuration")
        XCTAssertEqual(ready.interlockEvidence?.stateRetained,true)
        for state in ["TRANSMITTING","PTT_REQUESTED","NOT_READY","UNKNOWN"] {
            await radio.iqConsumeStatus("interlock state="+state)
            await radio.iqConsumeStatus(settings)
            let refused=await radio.iqCapabilities();XCTAssertFalse(refused.transmitStateKnownOff)
        }
        for malformed in ["interlock band", "interlock band 3", "interlock band -1 tx1_enabled=1",
            "interlock band 03 tx1_enabled=1", "interlock band 256 tx1_enabled=1", "interlock band 3 tx1_enabled=2",
            "interlock band 3 tx1_enabled=1 tx1_enabled=1", "interlock band 3 band_name=",
            "interlock band 3 unknown=1", "interlock band 3 rfpower=-1", "interlock band 3 state=READY"] {
            await radio.iqConsumeStatus("interlock state=READY")
            await radio.iqConsumeStatus(malformed)
            let refused=await radio.iqCapabilities();XCTAssertFalse(refused.transmitStateKnownOff,malformed)
        }
        await radio.stopTransportOnly()
        await radio.iqConsumeStatus(settings)
        let closed=await radio.iqCapabilities();XCTAssertFalse(closed.transmitStateKnownOff)
        let commands=await wire.commands;XCTAssertFalse(commands.contains{$0.hasPrefix("stream ")||$0.hasPrefix("client udpport")})
        await wire.stop()
    }
    private func next(_ subscription:FlexIQSubscription) async throws -> FlexIQBlock {
        try await withThrowingTaskGroup(of:FlexIQBlock.self) {group in
            group.addTask {var iterator=subscription.blocks.makeAsyncIterator();guard let block=try await iterator.next() else{throw FlexIQSubscriptionError.stopped};return block}
            group.addTask {try await Task.sleep(for:.seconds(2));throw FlexIQSubscriptionError.noData}
            defer{group.cancelAll()};return try await group.next()!
        }
    }
    private func admittedCapture(_ radio:FlexRadioClient,leaseID:UUID) async throws -> FlexIQCapture? {
        let clock=ContinuousClock(),deadline=ContinuousClock.now.advanced(by:.seconds(2))
        repeat {
            if let capture=await radio.currentIQCapture(leaseID:leaseID){return capture}
            try await Task.sleep(for:.milliseconds(10))
        } while clock.now<deadline
        return nil
    }
    func testHandoffIsExplicitAndMetadataBoundBeforeAnyEnablingCommand() async throws {
        let (radio,wire)=try await setup()
        do {_ = try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:UUID());XCTFail("No implicit takeover")}
        catch {XCTAssertEqual(error as? FlexIQSubscriptionError,.handoffRequired)}
        try await authorize(radio)
        await wire.status("display pan 0x40000000 center=14.035000")
        try await Task.sleep(for:.milliseconds(40))
        do {_ = try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:UUID());XCTFail("Changed metadata requires fresh handoff")}
        catch {XCTAssertEqual(error as? FlexIQSubscriptionError,.handoffRequired)}
        let commands=await wire.commands
        XCTAssertFalse(commands.contains(where:{$0.hasPrefix("stream create")}))
        await radio.stopTransportOnly();await wire.stop()
    }
    func testRealLoopbackUDPRequiresRateStatusAndArrivalThenStopKeepsControlAlive() async throws {
        let (radio,wire)=try await setup();try await authorize(radio)
        let lease=UUID(),subscription=try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:lease)
        let block=try await next(subscription)
        XCTAssertEqual(block.capture.identity.serial,"FIXTURE-8400");XCTAssertEqual(block.capture.panadapter.centreHz,14025000)
        XCTAssertEqual(block.packet.sampleRate,96000);XCTAssertEqual(block.firstSample,0)
        await radio.stopIQ(leaseID:lease)
        let capture=await radio.currentIQCapture(leaseID:lease),capabilities=await radio.iqCapabilities(),commands=await wire.commands
        XCTAssertNil(capture);XCTAssertTrue(capabilities.ready)
        XCTAssertTrue(commands.contains("stream remove 0x80000001"))
        XCTAssertFalse(commands.contains(where:{$0.hasPrefix("xmit") || $0.hasPrefix("transmit") || $0.hasPrefix("slice t") || $0.hasPrefix("display pan create")}))
        await radio.stopTransportOnly();await wire.stop()
    }
    func testStopWhileCreateACKIsPendingRemovesOnlyReturnedOwnedStream() async throws {
        let (radio,wire)=try await setup();try await authorize(radio);await wire.holdCreate()
        let lease=UUID(),pending=Task{try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:lease)}
        for _ in 0..<200 {
            if await wire.createPending{break};try await Task.sleep(for:.milliseconds(5))
        }
        await radio.stopIQ(leaseID:lease);await wire.releaseCreate()
        do {_ = try await pending.value;XCTFail("Stop must revoke pending acquisition")}catch{}
        let commands=await wire.commands,capabilities=await radio.iqCapabilities()
        XCTAssertEqual(commands.filter{$0.hasPrefix("stream remove")},["stream remove 0x80000001"])
        XCTAssertTrue(capabilities.ready)
        await radio.stopTransportOnly();await wire.stop()
    }
    func testForeignActiveStreamBlocksDespiteOperatorHandoff() async throws {
        let (radio,wire)=try await setup();try await authorize(radio)
        await wire.status("stream 0x90000001 type=dax_iq client_handle=0x9999 daxiq_channel=1 pan=0x40000000 rate=96000 active=1")
        try await Task.sleep(for:.milliseconds(40))
        do {_ = try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:UUID());XCTFail("Known competitor must block")}
        catch {XCTAssertEqual(error as? FlexIQSubscriptionError,.busy)}
        let commands=await wire.commands;XCTAssertFalse(commands.contains(where:{$0.hasPrefix("stream create")}))
        await radio.stopTransportOnly();await wire.stop()
    }
    func testRetuneAndRadioWideTXInvalidateCaptureWithoutChangingPanOrTransmit() async throws {
        let (radio,wire)=try await setup();try await authorize(radio)
        let lease=UUID(),subscription=try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:lease)
        let first=try await next(subscription)
        let drain=Task{for try await _ in subscription.blocks{}}
        await wire.status("display pan 0x40000000 center=14.035000 rxant=ANT2")
        try await Task.sleep(for:.milliseconds(40));let quarantined=await radio.currentIQCapture(leaseID:lease);XCTAssertNil(quarantined)
        let retuned=try await admittedCapture(radio,leaseID:lease)
        XCTAssertEqual(retuned?.panadapter.centreHz,14035000);XCTAssertNotEqual(retuned?.streamToken,first.capture.streamToken)
        await wire.status("interlock state=TRANSMITTING")
        try await Task.sleep(for:.milliseconds(40));let muted=await radio.currentIQCapture(leaseID:lease);XCTAssertNil(muted)
        await wire.status("interlock state=READY")
        let resumed=try await admittedCapture(radio,leaseID:lease)
        XCTAssertNotNil(resumed);XCTAssertNotEqual(resumed?.streamToken,retuned?.streamToken)
        await radio.stopIQ(leaseID:lease);drain.cancel();await radio.stopTransportOnly();await wire.stop()
    }
    func testFinalSharedConsumerReleasesOneOwnedStream() async throws {
        let (radio,wire)=try await setup();try await authorize(radio)
        let a=UUID(),b=UUID(),first=try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:a)
        let drainA=Task{for try await _ in first.blocks{}}
        let second=try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:b)
        let drainB=Task{for try await _ in second.blocks{}}
        await radio.stopIQ(leaseID:a)
        let kept=await radio.currentIQCapture(leaseID:b),before=await wire.commands
        XCTAssertNotNil(kept);XCTAssertFalse(before.contains(where:{$0.hasPrefix("stream remove")}))
        await radio.stopIQ(leaseID:b)
        let after=await wire.commands
        XCTAssertEqual(after.filter{$0.hasPrefix("stream create")}.count,1)
        XCTAssertEqual(after.filter{$0.hasPrefix("stream remove")}.count,1)
        let evidence=await radio.iqDiagnostics()
        XCTAssertEqual(evidence.filter{$0.operation=="ack" && $0.detail.hasPrefix("stream create ")}.count,1)
        XCTAssertEqual(evidence.filter{$0.operation=="ack" && $0.detail.hasPrefix("stream remove ")}.count,1)
        XCTAssertEqual(evidence.filter{$0.operation=="flow_end"}.count,1)
        drainA.cancel();drainB.cancel();await radio.stopTransportOnly();await wire.stop()
    }
    func testTwoDistinctPanadaptersShareOneUDPDestinationAndReleaseIndependently() async throws {
        let (radio,wire)=try await setup();try await authorize(radio);try await authorize(radio,"40000001")
        let a=UUID(),b=UUID(),first=try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:a)
        let drainA=Task{for try await _ in first.blocks{}}
        let second=try await radio.startIQ(panadapterID:"40000001",sampleRate:96000,leaseID:b)
        let block=try await next(second),drainB=Task{for try await _ in second.blocks{}}
        XCTAssertEqual(block.capture.panadapter.centreHz,7025000);XCTAssertEqual(block.capture.streamID,0x80000002)
        await radio.stopIQ(leaseID:a)
        let kept=await radio.currentIQCapture(leaseID:b);XCTAssertNotNil(kept)
        await radio.stopIQ(leaseID:b)
        let commands=await wire.commands
        XCTAssertEqual(commands.filter{$0.hasPrefix("client udpport")}.count,1)
        XCTAssertEqual(commands.filter{$0.hasPrefix("stream create")}.count,2)
        XCTAssertEqual(commands.filter{$0.hasPrefix("stream remove")}.count,2)
        drainA.cancel();drainB.cancel();await radio.stopTransportOnly();await wire.stop()
    }
    func testStatusBeforeCreateACKIsCleanedExactlyOnceAfterStop() async throws {
        let (radio,wire)=try await setup();try await authorize(radio);await wire.holdCreate()
        let lease=UUID(),pending=Task{try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:lease)}
        for _ in 0..<200 {if await wire.createPending{break};try await Task.sleep(for:.milliseconds(5))}
        await wire.status("stream 0x80000001 type=dax_iq client_handle=0xab daxiq_channel=1 pan=0x40000000 rate=96000 active=1")
        try await Task.sleep(for:.milliseconds(40));await radio.stopIQ(leaseID:lease);await wire.releaseCreate()
        do {_ = try await pending.value;XCTFail("Stopped acquisition cannot return live")}catch{}
        let commands=await wire.commands
        XCTAssertEqual(commands.filter{$0.hasPrefix("stream remove")},["stream remove 0x80000001"])
        await radio.stopTransportOnly();await wire.stop()
    }
    func testMalformedReceiveStateAndChangedStreamOwnershipWithdrawEvidence() async throws {
        let (radio,wire)=try await setup();try await authorize(radio)
        let lease=UUID(),subscription=try await radio.startIQ(panadapterID:"40000000",sampleRate:96000,leaseID:lease)
        let drain=Task{for try await _ in subscription.blocks{}}
        await wire.status("interlock state=TRANSMITTING state=READY")
        try await Task.sleep(for:.milliseconds(40));let unknown=await radio.currentIQCapture(leaseID:lease);XCTAssertNil(unknown)
        await wire.status("interlock state=READY")
        let restored=try await admittedCapture(radio,leaseID:lease);XCTAssertNotNil(restored)
        await wire.status("stream 0x80000001 client_handle=0x9999")
        try await Task.sleep(for:.milliseconds(40));let changed=await radio.currentIQCapture(leaseID:lease),commands=await wire.commands
        XCTAssertNil(changed);XCTAssertFalse(commands.contains(where:{$0.hasPrefix("stream remove")}))
        drain.cancel();await radio.stopTransportOnly();await wire.stop()
    }
}
private extension FlexRadioClient {
    func fixtureIQDiagnostics() -> String {
        let context=iqControlContext()
        let flows=iqState.flows.mapValues { "last=\($0.lastReceipt) cleanAfter=\($0.cleanAfter) capture=\($0.capture != nil) admitted=\($0.admitted)" }
        return "context=\(String(describing:context)) streams=\(iqState.inventory.streams) flows=\(flows)"
    }
    func fixtureIQIdentity(port:UInt16) {
        // Only discovery is replaced. TCP binding, stream commands/status and
        // UDP delivery in these tests use the actual Network.framework path.
        iqState.identity=FlexIQIdentity(serial:"FIXTURE-8400",model:"FLEX-8400",address:"127.0.0.1",controlPort:port)
    }
}
private actor FlexIQFixtureRadio {
    private let queue=DispatchQueue(label:"xlog.fixture.flex-iq")
    private var listener:NWListener?,connection:NWConnection?
    private var udpSocket:Int32 = -1
    private var udpDestination:sockaddr_in?
    private(set) var sentDatagrams=0
    private var ready=false,buffer=Data(),pump:DispatchSourceTimer?
    private let sampleQueue=DispatchQueue(label:"xlog.fixture.flex-iq.samples",qos:.userInteractive)
    private var streams:[UInt32:(Int,UInt8)]=[:]
    private var held=false,pendingCreate:Int?
    private(set) var commands:[String]=[]
    var createPending:Bool{pendingCreate != nil}
    func start() async throws -> UInt16 {
        let listener=try NWListener(using:.tcp,on:.any);self.listener=listener
        listener.stateUpdateHandler={[weak self] state in if case .ready=state {Task{await self?.markReady()}}}
        listener.newConnectionHandler={[weak self] connection in Task{await self?.accept(connection)}}
        listener.start(queue:queue)
        for _ in 0..<100 {if ready,let port=listener.port{return port.rawValue};try await Task.sleep(for:.milliseconds(10))}
        throw FlexIQSubscriptionError.noData
    }
    private func markReady(){ready=true}
    private func accept(_ next:NWConnection) {
        connection=next;next.start(queue:queue)
        send("H000000ab\nS0|client 0x1234 station=Fixture client_id=fixture-id program=fixture\nS0|interlock state=READY\n")
        receive(next)
    }
    private func receive(_ current:NWConnection) {
        current.receive(minimumIncompleteLength:1,maximumLength:16384){[weak self] data,_,done,error in
            Task{await self?.consume(data,connection:current,done:done || error != nil)}
        }
    }
    private func consume(_ data:Data?,connection current:NWConnection,done:Bool) {
        guard connection===current else{return};if let data{buffer.append(data)}
        while let end=buffer.firstIndex(of:10) {
            let line=String(decoding:buffer[..<end],as:UTF8.self);buffer.removeSubrange(...end)
            let parts=line.dropFirst().split(separator:"|",maxSplits:1);guard parts.count==2,let sequence=Int(parts[0]) else{continue}
            command(String(parts[1]),sequence:sequence)
        }
        if !done{receive(current)}
    }
    private func command(_ body:String,sequence:Int) {
        commands.append(body)
        if body=="sub radio all" {
            // Synthetic values with the settings field names observed on the
            // real 8400. This packet follows the explicit READY observation.
            status("interlock acc_tx_delay=0 acc_tx_enabled=0 acc_txreq_enable=0 acc_txreq_polarity=0 rca_txreq_enable=0 rca_txreq_polarity=0 timeout=60000 tune_tx_suppress=0 tx1_delay=0 tx1_enabled=0 tx2_delay=0 tx2_enabled=0 tx3_delay=0 tx3_enabled=0 tx_delay=0")
        }
        if body=="sub pan all" {
            status("display pan 0x40000000 client_handle=0x1234 daxiq_channel=1 center=14.025000 rxant=ANT1")
            status("display pan 0x40000001 client_handle=0x1234 daxiq_channel=2 center=7.025000 rxant=ANT1")
        }
        if body.hasPrefix("client udpport "),let port=UInt16(body.split(separator:" ").last!) {
            // The receiver requires the radio's exact source port. Bind it
            // synchronously and check every datagram; the old NW sender ignored
            // readiness/send failures and left port 4991 held after a test threw.
            let fd=Darwin.socket(AF_INET,SOCK_DGRAM,0)
            guard fd >= 0 else { XCTFail("Fixture UDP socket: \(errno)"); return }
            var local=sockaddr_in();local.sin_len=UInt8(MemoryLayout<sockaddr_in>.size)
            local.sin_family=sa_family_t(AF_INET);local.sin_port=UInt16(4991).bigEndian
            local.sin_addr.s_addr=inet_addr("127.0.0.1")
            let bound=withUnsafePointer(to:&local) { pointer in
                pointer.withMemoryRebound(to:sockaddr.self,capacity:1) { Darwin.bind(fd,$0,socklen_t(MemoryLayout<sockaddr_in>.size)) }
            }
            guard bound == 0 else { let error=errno;Darwin.close(fd);XCTFail("Fixture UDP bind: \(error)");return }
            udpSocket=fd;local.sin_port=port.bigEndian;udpDestination=local
            // macOS-14 CI coalesces Task.sleep(10ms) to 30–50ms. That is
            // slower than three 1024-sample packets at 96k and correctly trips
            // the real continuity gate. Supply the advertised fixture cadence;
            // do not weaken production freshness/quarantine to fit the runner.
            let timer=DispatchSource.makeTimerSource(flags:.strict,queue:sampleQueue)
            timer.schedule(deadline:.now(),repeating:.nanoseconds(10_666_667),leeway:.nanoseconds(0))
            timer.setEventHandler {[weak self] in Task(priority:.high) { await self?.emit() }}
            pump=timer;timer.resume()
        }
        if body.hasPrefix("stream create ") {
            if held{pendingCreate=sequence;return}
            let channel=UInt32(body.split(separator:"=").last!) ?? 1
            send("R\(sequence)|0|0x\(FlexIQResourceInventory.identifier(0x80000000+channel))\n");return
        }
        if body.hasPrefix("stream set ") {
            let parts=body.split(separator:" "),id=FlexIQResourceInventory.handle(String(parts[2]))!,channel=id-0x80000000
            streams[id]=(96000,0)
            status("stream 0x\(FlexIQResourceInventory.identifier(id)) type=dax_iq client_handle=0xab daxiq_channel=\(channel) pan=0x\(FlexIQResourceInventory.identifier(0x40000000+channel-1)) rate=96000 active=1")
        }
        if body.hasPrefix("stream remove "),let id=body.split(separator:" ").last.flatMap({FlexIQResourceInventory.handle(String($0))}) {
            streams.removeValue(forKey:id);status("stream 0x\(FlexIQResourceInventory.identifier(id)) removed")
        }
        send("R\(sequence)|0|\n")
    }
    func status(_ text:String){send("S0|\(text)\n")}
    func holdCreate(){held=true}
    func releaseCreate(){if let sequence=pendingCreate{pendingCreate=nil;send("R\(sequence)|0|0x80000001\n")}}
    private func send(_ text:String){connection?.send(content:Data(text.utf8),completion:.contentProcessed{_ in})}
    private func emit() {
        for (id,(rate,counter)) in streams {
            var data=Data()
            for word in [UInt32(0x18000000)|(UInt32(counter)<<16)|UInt32(2052),id,0x1c2d,0x534c02e5] {
                var value=word.bigEndian;withUnsafeBytes(of:&value){data.append(contentsOf:$0)}
            }
            data.append(Data(repeating:0,count:8192));streams[id]=(rate,(counter+1)%16)
            guard udpSocket >= 0,var destination=udpDestination else { return }
            let written=data.withUnsafeBytes { bytes in
                withUnsafePointer(to:&destination) { pointer in
                    pointer.withMemoryRebound(to:sockaddr.self,capacity:1) {
                        Darwin.sendto(udpSocket,bytes.baseAddress,data.count,0,$0,socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                }
            }
            if written != data.count { XCTFail("Fixture UDP send: \(errno), bytes \(written)/\(data.count)");pump?.cancel();return }
            sentDatagrams+=1
        }
    }
    func stop(){pump?.cancel();pump=nil;if udpSocket >= 0 { Darwin.close(udpSocket);udpSocket = -1 };udpDestination=nil;connection?.cancel();connection=nil;listener?.cancel();listener=nil}
}
#endif
