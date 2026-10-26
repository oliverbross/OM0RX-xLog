import Foundation
import XCTest
@testable import XCWCore
@testable import XClusterIntegrationCore

final class LocalCWIngressTests:XCTestCase {
    func testOwnInstanceGreetingStopsInboundBeforeFollowingSpots() async throws {
        let owner=UUID(),instance=UUID(),guardOwner=CWLocalEndpointGuard.shared
        try guardOwner.reserveListener(owner:owner,port:49112,instance:instance)
        defer{guardOwner.releaseListener(owner:owner)}
        let transport=LocalCWLoopTransport(),server=ClusterServerConfiguration(name:"Fixture",host:"fixture.invalid",port:49112,callsign:"VK8RX")
        let service=ClusterSessionService(configuration:.init(servers:[server],requestRecentSpotsOnConnect:false),
            transportFactory:{_,_,_,_,state,line in transport.configure(state:state,line:line);return transport})
        try await service.connect()
        transport.emit("# OM0RX-xLog Local CW instance=\(instance)")
        transport.emit("DX de VK8RX-#: 14025.123 K1ABC CW Local 0100Z")
        for _ in 0..<100 {
            if await service.snapshot().connections.first?.phase == .failed{break}
            try await Task.sleep(nanoseconds:1_000_000)
        }
        let snapshot=await service.snapshot()
        XCTAssertEqual(snapshot.connections.first?.phase,.failed);XCTAssertEqual(snapshot.loadedSpots,0)
        XCTAssertTrue(transport.stopped)
        await service.terminate()
    }
    private func spot(id:UUID=UUID(),source:UUID=UUID(),origin:UUID=UUID(),session:UUID=UUID(),at:Date=Date(),call:String="K1ABC/P") -> CWConfirmedSpot {
        CWConfirmedSpot(id:id,sessionID:session,sourceID:source,radioID:"radio1",provider:.tciIQ,receiverID:"0",streamToken:UUID(),
            epoch:"7",trackID:UUID(),callsign:call,frequencyHz:14025123,observedAt:at,occurrenceRanges:["0:100","200:300"],
            policyVersion:1,originInstanceID:origin,modelSHA256:CWSpotPolicy.modelSHA256)
    }
    func testNativeIngressClassifiesArchivesAndDoesNotOpenNetwork() async throws {
        let events=LocalCWEvents(),service=ClusterSessionService(configuration:.init(servers:[],showWorkedBandModeSpots:true),
            onObservation:{events.append($0)},onHistoryConnection:{events.connection($0)},
            transportFactory:{_,_,_,_,_,_ in XCTFail("Local CW must not open a network transport");return LocalCWNoTransport()})
        await service.replaceContacts([])
        let value=spot()
        let accepted=try await service.ingestLocalCW(value,stationCallsign:"VK8RX")
        let duplicate=try await service.ingestLocalCW(value,stationCallsign:"VK8RX")
        XCTAssertTrue(accepted);XCTAssertFalse(duplicate)
        let snapshot=await service.snapshot(),row=try XCTUnwrap(snapshot.spots.first)
        XCTAssertEqual(snapshot.connectedClusters,0);XCTAssertEqual(snapshot.contactCount,0)
        XCTAssertEqual(row.source,"local_cw");XCTAssertEqual(row.mode,"CW");XCTAssertEqual(row.localCW,value)
        XCTAssertEqual(row.spotter,"VK8RX-#");XCTAssertFalse(row.specialTags.contains("RBN"))
        XCTAssertEqual(row.callStatus,"New Call");XCTAssertNil(row.workedBefore)
        let observation=try XCTUnwrap(events.observations.first)
        XCTAssertEqual(events.observations.count,1);XCTAssertEqual(observation.id,value.id)
        XCTAssertEqual(observation.classified.localCW,value);XCTAssertEqual(observation.recordKind,"local_cw")
        XCTAssertEqual(observation.timeBasis,"capture_host_receipt");XCTAssertEqual(observation.reportedAt,value.observedAt)
        XCTAssertEqual(observation.clusterHost,"");XCTAssertEqual(observation.clusterPort,0)
        // Contact replacement may remove live rows; immutable capture metadata
        // continues to describe the classification at observation time.
        await service.replaceContacts([.init(callsign:value.callsign,band:"20m",mode:"CW",date:Date())])
        XCTAssertEqual(events.observations.first?.classified.callStatus,"New Call")
        await service.disconnect()
        XCTAssertEqual(events.connections.count,1) // network disconnect leaves local source alive
        await service.terminate()
        XCTAssertEqual(events.connections.last?.phase,.disconnected)
    }
    func testDifferentSourcesRetainProvenanceAndFilterExplicitSetsSurvive() async throws {
        let service=ClusterSessionService(configuration:.init(servers:[])),origin=UUID(),source=UUID(),session=UUID()
        let a=spot(source:source,origin:origin,session:session),b=spot(origin:origin,session:session)
        _ = try await service.ingestLocalCW(a,stationCallsign:"VK8RX")
        _ = try await service.ingestLocalCW(b,stationCallsign:"VK8RX")
        let both=await service.snapshot();XCTAssertEqual(both.spots.count,2)
        let c=spot(source:source,origin:origin,session:session)
        _ = try await service.ingestLocalCW(c,stationCallsign:"VK8RX")
        let grouped=await service.snapshot()
        XCTAssertEqual(grouped.spots.count,2);XCTAssertEqual(grouped.spots.first?.aggregateCount,2)
        XCTAssertEqual(grouped.spots.first?.localCW?.id,c.id)
        var filter=ClusterSpotFilter();filter.sources=["cluster","rbl"]
        let stored=try JSONDecoder().decode(ClusterSpotFilter.self,from:JSONEncoder().encode(filter))
        XCTAssertEqual(stored.sources,["cluster","rbl"])
        await service.updateFilter(stored)
        let hidden=await service.snapshot();XCTAssertTrue(hidden.spots.isEmpty)
        filter.sources=["local_cw"];await service.updateFilter(filter)
        let visible=await service.snapshot();XCTAssertEqual(visible.spots.count,2)
        await service.terminate()
    }
    func testWireRoundTripPreservesHzPortableCallsAndUTC() throws {
        let date=try XCTUnwrap(ISO8601DateFormatter().date(from:"2026-10-26T23:59:59Z"))
        for (at,suffix) in [(date,"2359Z\r\n"),(date.addingTimeInterval(61),"0001Z\r\n")] {
            let value=spot(at:at,call:"SV5/K1ABC/P"),line=try CWSpotWire.line(value,stationCallsign:"VK8RX")
            XCTAssertTrue(line.hasSuffix(suffix));XCTAssertFalse(line.contains("WPM"));XCTAssertFalse(line.contains("dB"))
            let parsed=try XCTUnwrap(ClusterLineParser.parse(line,clusterID:UUID(),clusterName:"Wire fixture",at:at))
            XCTAssertEqual(parsed.callsign,value.callsign);XCTAssertEqual(parsed.frequencyKHz*1000,Double(value.frequencyHz),accuracy:0.001)
            XCTAssertEqual(parsed.spotter,"VK8RX-#")
        }
        XCTAssertThrowsError(try CWSpotWire.line(spot(),stationCallsign:"vk8rx"))
        XCTAssertThrowsError(try CWSpotWire.line(spot(),stationCallsign:"\r\nDX de BAD"))
    }
    func testOldAndFutureReportsAndTerminalOwnerAreRejected() async throws {
        let service=ClusterSessionService(configuration:.init(servers:[])),now=Date()
        let old=try await service.ingestLocalCW(spot(at:now.addingTimeInterval(-121)),stationCallsign:"VK8RX",arrivedAt:now)
        let future=try await service.ingestLocalCW(spot(at:now.addingTimeInterval(1)),stationCallsign:"VK8RX",arrivedAt:now)
        XCTAssertFalse(old);XCTAssertFalse(future)
        await service.terminate()
        do {_ = try await service.ingestLocalCW(spot(),stationCallsign:"VK8RX");XCTFail("Terminal admission must fail")}
        catch {XCTAssertTrue(error is ClusterSessionError)}
    }
}
private final class LocalCWEvents:@unchecked Sendable {
    private let lock=NSLock();private var reports:[ClusterSpotObservation]=[],states:[ClusterHistoryConnectionEvent]=[]
    func append(_ value:ClusterSpotObservation){lock.lock();reports.append(value);lock.unlock()}
    func connection(_ value:ClusterHistoryConnectionEvent){lock.lock();states.append(value);lock.unlock()}
    var observations:[ClusterSpotObservation]{lock.lock();defer{lock.unlock()};return reports}
    var connections:[ClusterHistoryConnectionEvent]{lock.lock();defer{lock.unlock()};return states}
}
private final class LocalCWNoTransport:ClusterConnectionTransport,@unchecked Sendable {
    func start(){XCTFail("Unexpected connection")}
    func send(_ command:String){XCTFail("Unexpected command")}
    func stop(){}
}
private final class LocalCWLoopTransport:ClusterConnectionTransport,@unchecked Sendable {
    private let lock=NSLock();private var state:(@Sendable(ClusterConnectionPhase,String?)->Void)?,line:(@Sendable(String)->Void)?,didStop=false
    func configure(state:@escaping @Sendable(ClusterConnectionPhase,String?)->Void,line:@escaping @Sendable(String)->Void){
        lock.lock();self.state=state;self.line=line;lock.unlock()
    }
    func start(){lock.lock();let callback=state;lock.unlock();callback?(.connected,nil)}
    func send(_ command:String){}
    func stop(){lock.lock();didStop=true;lock.unlock()}
    func emit(_ value:String){lock.lock();let callback=line;lock.unlock();callback?(value)}
    var stopped:Bool{lock.lock();defer{lock.unlock()};return didStop}
}
