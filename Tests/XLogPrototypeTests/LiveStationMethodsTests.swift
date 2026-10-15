import Foundation
import XCTest
import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class LiveStationMethodsTests: XCTestCase {
    func testNativeOrderedStandbyRejectsOlderOperateAndTuneBeforeTransport() async throws {
        let agent=LiveStationSession()
        do{_=try await agent.action("standby",expectedGeneration:0,expectedNativeIntent:30);XCTFail("Unconnected Standby accepted")}
        catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"invalid_params")}
        for action in ["operate","tune"] {
            do{_=try await agent.action(action,expectedGeneration:0,expectedNativeIntent:29);XCTFail("Retired acquisition dispatched")}
            catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_changed")}
        }
        for action in ["operate","standby"] {
            do{_=try await agent.action(action,expectedGeneration:99,expectedNativeIntent:31);XCTFail("Replaced connection admitted")}
            catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_changed")}
        }
        // A stale generation must not consume a newer native intent.
        do{_=try await agent.action("standby",expectedGeneration:0,expectedNativeIntent:31);XCTFail()}
        catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"invalid_params")}
    }
    func testStandbyRetainedCapabilityDoesNotRequireObservationOrCommissioning() {
        XCTAssertTrue(LiveStationSession.allowsAction(.standby,connected:false,supported:["station_standby"],allowed:[]))
        XCTAssertFalse(LiveStationSession.allowsAction(.standby,connected:false,supported:[],allowed:["standby"]))
        var ownership=StationTransmitOwnership();ownership.beginControl("ptt",enabled:true);ownership.beginControl("send_cw");ownership.beginAction(.tune)
        ownership.completeAction(.standby)
        XCTAssertEqual(ownership.releases,[.clearCW,.cancelTune,.releasePTT],"Standby ACK alone proves no RF release")
    }
    func testNativeOrderedCancelRejectsAnOlderTuneDeliveredAfterIt() async throws {
        let agent=LiveStationSession()
        do{_=try await agent.action("cancel",expectedGeneration:0,expectedNativeIntent:2);XCTFail("Unconnected Cancel accepted")}
        catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"invalid_params")}
        do{_=try await agent.action("tune",expectedGeneration:0,expectedNativeIntent:1);XCTFail("Older native Tune acquired a fresh epoch")}
        catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_changed")}
        var intent=StationCarrierIntent();try intent.admitNative(20);intent.cancel()
        XCTAssertThrowsError(try intent.admitNative(19))
        XCTAssertThrowsError(try intent.admitNative(20),"Duplicate native intent may not dispatch")
        XCTAssertNoThrow(try intent.admitNative(21),"A new explicit later request retains authority")
    }
    func testCarrierReleaseRequiresAnAuthoritativeRXObservationAfterTheCommandBarrier() {
        let started=Date()
        var sample=RadioSnapshot(frequencyHz:14_074_000,mode:"CW",isConnected:true,isTransmitting:false,
            remoteStationStatus:RemoteStationStatus(radioKnown:true,radioStale:false),transportReceivedAt:started)
        XCTAssertFalse(LiveStationSession.carrierReleaseObserved(sample,after:started),"Pre-command cached RX cannot clear the release obligation")
        sample.transportReceivedAt=started.addingTimeInterval(0.01)
        XCTAssertTrue(LiveStationSession.carrierReleaseObserved(sample,after:started))
        sample.isTransmitting=true;XCTAssertFalse(LiveStationSession.carrierReleaseObserved(sample,after:started))
        sample.isTransmitting=false;sample.remoteStationStatus?.radioStale=true;XCTAssertFalse(LiveStationSession.carrierReleaseObserved(sample,after:started))
    }
    func testCarrierCancelRetiresEveryOlderPreparationWithoutAcquiringReleaseAuthority() throws {
        var intent=StationCarrierIntent(), ownership=StationTransmitOwnership()
        let beforeExclusiveWriter=intent.begin()
        XCTAssertNoThrow(try intent.require(beforeExclusiveWriter))
        intent.cancel()
        XCTAssertThrowsError(try intent.require(beforeExclusiveWriter))
        XCTAssertTrue(ownership.releases.isEmpty, "An unowned Cancel must not create authority over another operator TX")
        let beforeSnapshot=intent.begin();intent.cancel()
        XCTAssertThrowsError(try intent.require(beforeSnapshot))
        let inFlight=intent.begin();ownership.beginAction(.tune);intent.cancel()
        XCTAssertThrowsError(try intent.require(inFlight))
        XCTAssertTrue(ownership.releases.contains(.cancelTune), "Uncertain in-flight acquisition retains its release obligation")
        ownership.completeAction(.cancel,acquisitionsInFlight:true)
        XCTAssertTrue(ownership.releases.contains(.cancelTune), "An outstanding HTTP acquisition remains explicitly releasable after Cancel acknowledgement")
        ownership.completeAction(.cancel,acquisitionsInFlight:false)
        XCTAssertTrue(ownership.releases.isEmpty)
        let newExplicit=intent.begin();XCTAssertNoThrow(try intent.require(newExplicit))
        XCTAssertThrowsError(try intent.require(inFlight), "A newer intent must never restore the older acquisition")
    }
    func testCarrierTuneRejectsReplacedBackendBeforeAnyTransport() async throws {
        let agent=LiveStationSession()
        do{_=try await agent.action("tune",expectedGeneration:99);XCTFail("Stale Agent carrier Tune accepted")}
        catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_changed")}
        let flex=LiveFlexSession(factory:{_,_,_ in fatalError("Stale carrier Tune must not start radio transport")})
        for expected in [99,-1,true,"1",1.5,NSNull()] as [Any]{
            do{_=try await flex.handle("station_action",params:["provider":"direct_flex_lan","action":"tune","expected_generation":expected]);XCTFail("Stale/malformed carrier Tune accepted")}
            catch let failure as WorkerFailure{XCTAssertEqual(failure.code,"station_changed")}
        }
    }
    func testCancelRejectsReplacedBackendBeforeAnyTransportAndRetainedCapabilityAllowsOnlyRelease() async throws {
        let agent = LiveStationSession()
        do { _ = try await agent.action("cancel", expectedGeneration: 99); XCTFail("Stale Agent Cancel accepted") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "station_changed") }
        let flex = LiveFlexSession(factory: { _, _, _ in fatalError("Stale release must not start a radio") })
        do { _ = try await flex.handle("station_action", params: ["provider":"direct_flex_lan", "action":"cancel", "expected_generation":99]); XCTFail("Stale FLEX Cancel accepted") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "station_changed") }
        XCTAssertTrue(LiveStationSession.allowsAction(.cancel, connected: false, supported: ["station_cancel"], allowed: [], ownsTune: true))
        XCTAssertFalse(LiveStationSession.allowsAction(.cancel, connected: true, supported: ["station_cancel"], allowed: ["cancel"]))
        XCTAssertFalse(LiveStationSession.allowsAction(.cancel, connected: false, supported: [], allowed: ["cancel"]))
        for action: RemoteStationAction in [.tune, .operate] {
            XCTAssertFalse(LiveStationSession.allowsAction(action, connected: false, supported: ["station_\(action.rawValue)"], allowed: [action.rawValue]))
        }
    }
    func testSimplexConfirmationRequiresPTTOff() {
        let keyed = RadioSnapshot(frequencyHz: 14_074_000, mode: "USB", isTransmitting: true)
        XCTAssertFalse(LiveStationSession.confirmsSimplex(keyed, frequencyHz: 14_074_000, mode: "USB"))
        XCTAssertFalse(LiveFlexSession.confirmsSimplex(keyed, frequencyHz: 14_074_000, mode: "USB"))
    }
    func testManualSimplexRejectsReplacedConnectionBeforeAnyTransport() async throws {
        let agent = LiveStationSession()
        do { _ = try await agent.tune(frequencyHz: 14_074_000, mode: "USB", expectedGeneration: 99); XCTFail("Accepted stale Agent generation") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "station_changed") }
        let flex = LiveFlexSession(factory: { _, _, _ in fatalError("No radio factory may run during stale tune validation") })
        do { _ = try await flex.handle("station_tune", params: ["provider":"direct_flex_lan", "frequency_hz":14_074_000, "mode":"USB", "expected_generation":99]); XCTFail("Accepted stale FLEX generation") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "station_changed") }
    }
    func testJSONBooleanCannotBecomeANumericPort() throws {
        for literal in ["true", "false"] {
            let params = try XCTUnwrap(JSONSerialization.jsonObject(
                with: Data("{\"port\":\(literal)}".utf8)) as? [String: Any])
            XCTAssertThrowsError(try LiveStationMethods.Endpoint(params, allowed: []))
        }
        let params = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data("{\"port\":14532}".utf8)) as? [String: Any])
        XCTAssertEqual(try LiveStationMethods.Endpoint(params, allowed: []).port, 14_532)
        for number: NSNumber in [NSNumber(value: Int8(1)), NSNumber(value: UInt8(1)), NSNumber(value: 1.0)] {
            XCTAssertEqual(try LiveStationMethods.Endpoint(["port": number], allowed: []).port, 1)
        }
        for number: NSNumber in [NSNumber(value: Double.nan), NSNumber(value: Double.infinity), NSNumber(value: -Double.infinity)] {
            XCTAssertThrowsError(try LiveStationMethods.Endpoint(["port": number], allowed: []))
        }
    }

    func testEndpointIsBoundedToLoopback() throws {
        let defaults = try LiveStationMethods.Endpoint([:], allowed: [])
        XCTAssertEqual(defaults.host, "127.0.0.1")
        XCTAssertEqual(defaults.port, 14_532)
        let alternate = try LiveStationMethods.Endpoint(["host": "localhost", "port": 15_432], allowed: [])
        XCTAssertEqual(alternate.host, "127.0.0.1")
        XCTAssertEqual(alternate.port, 15_432)
        for value in ["192.168.1.1", "::1", "example.com", true, ""] as [Any] {
            XCTAssertThrowsError(try LiveStationMethods.Endpoint(["host": value], allowed: []))
        }
        for value in [0, 65_536, true, 14_532.5, "14532"] as [Any] {
            XCTAssertThrowsError(try LiveStationMethods.Endpoint(["port": value], allowed: []))
        }
        XCTAssertThrowsError(try LiveStationMethods.Endpoint(["token": "redacted"], allowed: []))
    }

    func testMalformedStationCommandsFailBeforeTransport() async {
        let invalidRequests: [(String, [String: Any])] = [
            ("station_snapshot", ["url": "https://example.invalid"]),
            ("station_tune", ["frequency_hz": true, "mode": "CW"]),
            ("station_tune", ["frequency_hz": 14_074_000.5, "mode": "CW"]),
            ("station_tune", ["frequency_hz": 14_074_000, "mode": "CW;TX"]),
            ("station_action", ["action": "ptt"]),
            ("station_action", ["action": "rotor_goto", "bearing": true, "band": "20m"]),
            ("station_action", ["action": "rotor_goto", "bearing": 361, "band": "20m"]),
            ("station_action", ["action": "operate", "bearing": 20]),
        ]
        for (method, params) in invalidRequests {
            do {
                _ = try await LiveStationMethods.handle(method, params: params)
                XCTFail("Accepted malformed \(method) request")
            } catch let failure as WorkerFailure {
                XCTAssertEqual(failure.code, "invalid_params")
            } catch {
                XCTFail("Unexpected error for \(method): \(error)")
            }
        }
    }

    #if os(macOS)
    func testRemoteCWGenerationFenceRejectsRequestsBeforeConnecting() async throws {
        let session = LiveStationSession()
        let snapshot = await session.snapshot()
        let generation = try XCTUnwrap(snapshot["generation"] as? UInt64)
        for control in ["send_cw", "clear_cw"] {
            do {
                _ = try await session.handle("station_radio_control", params: [
                    "provider": "direct_agent", "control": control, "text": "CQ",
                    "expected_generation": generation + 1,
                ])
                XCTFail("Stale CW generation was accepted")
            } catch let failure as WorkerFailure {
                XCTAssertEqual(failure.code, "station_changed")
            }
        }
    }

    func testMonitoringDoesNotAcquireTransmitReleaseObligations() {
        var ownership = StationTransmitOwnership()
        XCTAssertTrue(ownership.releases.isEmpty)
        for control in ["set_frequency_a", "set_mode", "set_rf_power", "set_cw_speed"] {
            ownership.beginControl(control)
            ownership.completeControl(control)
        }
        XCTAssertTrue(ownership.releases.isEmpty)
    }

    func testUncertainTransmitAttemptStillRequiresRelease() {
        var ownership = StationTransmitOwnership()
        ownership.beginControl("ptt", enabled: true)
        // No completion callback models a lost command response.
        XCTAssertEqual(ownership.releases, [.releasePTT])
        ownership.beginControl("ptt", enabled: false)
        XCTAssertEqual(ownership.releases, [.releasePTT])
        ownership.completeControl("ptt", enabled: false)
        XCTAssertTrue(ownership.releases.isEmpty)
    }

    func testCWAndTuneHaveTheirOwnReleaseObligations() {
        var ownership = StationTransmitOwnership()
        ownership.beginControl("send_cw")
        ownership.beginAction(.tune)
        XCTAssertEqual(ownership.releases, [.clearCW, .cancelTune, .releasePTT])
        ownership.completeControl("clear_cw")
        XCTAssertEqual(ownership.releases, [.cancelTune, .releasePTT])
        ownership.completeAction(.cancel)
        XCTAssertTrue(ownership.releases.isEmpty)
        ownership.beginAction(.tune)
        ownership.completeAction(.standby)
        XCTAssertEqual(ownership.releases,[.cancelTune,.releasePTT],"Standby requires fresh RX proof before retiring carrier ownership")
    }

    func testOperateIsNotClassifiedAsAnRFProducingTransmitControl() {
        XCTAssertFalse(LiveStationSession.requiresTransmitOptIn(.operate))
        XCTAssertFalse(LiveStationSession.requiresTransmitOptIn(.standby))
        XCTAssertFalse(LiveStationSession.requiresTransmitOptIn(.cancel))
        XCTAssertTrue(LiveStationSession.requiresTransmitOptIn(.tune))
    }

    func testExactAgentReceiveConfirmationRequiresANewerAuthoritativeIdleVFOAObservation() {
        let started = Date()
        let status = RemoteStationStatus(radioKnown: true, radioStale: false)
        let confirmed = RadioSnapshot(frequencyHz: 14_075_100, mode: "DIGU", isConnected: true,
            isTransmitting: false, slice: "A",
            vfos: [RadioVFO(letter: "A", frequencyHz: 14_075_100, mode: "DIGU", isReceive: true)],
            remoteStationStatus: status, transportReceivedAt: started.addingTimeInterval(0.01))
        let matches: (XCatIntegrationCore.RadioSnapshot) -> Bool = {
            $0.vfo("A")?.frequencyHz == 14_075_100 && $0.vfo("A")?.mode == "DIGU"
        }
        XCTAssertTrue(LiveStationSession.exactReceiveConfirmed(confirmed, after: started, matches: matches))

        var stale = confirmed
        stale.remoteStationStatus?.radioStale = true
        XCTAssertFalse(LiveStationSession.exactReceiveConfirmed(stale, after: started, matches: matches))
        var transmitting = confirmed
        transmitting.isTransmitting = true
        XCTAssertFalse(LiveStationSession.exactReceiveConfirmed(transmitting, after: started, matches: matches))
        var old = confirmed
        old.transportReceivedAt = started
        XCTAssertFalse(LiveStationSession.exactReceiveConfirmed(old, after: started, matches: matches))
        var wrongVFO = confirmed
        wrongVFO.vfos[0].isReceive = false
        XCTAssertFalse(LiveStationSession.exactReceiveConfirmed(wrongVFO, after: started, matches: matches))
        var wrongTarget = confirmed
        wrongTarget.vfos[0].frequencyHz = 14_074_000
        XCTAssertFalse(LiveStationSession.exactReceiveConfirmed(wrongTarget, after: started, matches: matches))
    }

    func testDirectEndpointRequiresCredentialFreeHTTPS() throws {
        XCTAssertEqual(try LiveStationSession.validatedURL("https://station.example/"),
                       "https://station.example/")
        for candidate in ["http://station.example", "https://user:secret@station.example",
                          "https://station.example/?token=secret", "https://station.example/#fragment",
                          "file:///tmp/agent", "https://"] {
            XCTAssertThrowsError(try LiveStationSession.validatedURL(candidate))
        }
    }

    func testDirectRotorAndSpotRejectMalformedRequestsBeforeTransport() async {
        for host in ["", "rotor.example/path", "user@rotor.example", "rotor host"] {
            XCTAssertThrowsError(try LiveStationSession.validatedRotorHost(host))
        }
        XCTAssertEqual(try? LiveStationSession.validatedRotorHost("rotor.local"), "rotor.local")
        let invalidRequests: [(String, [String: Any])] = [
            ("station_rotor_connect", ["provider": "direct_agent", "host": "rotor.local", "port": 0]),
            ("station_rotor_connect", ["provider": "direct_agent", "host": "rotor.local", "port": 4_001.5]),
            ("station_rotor_goto", ["provider": "direct_agent", "bearing": -1]),
            ("station_rotor_goto", ["provider": "direct_agent", "bearing": true]),
            ("station_add_spot", ["provider": "direct_agent", "spot": ["callsign": "OM0RX"]]),
            ("station_radio_control", ["provider": "direct_agent", "control": "ptt", "enabled": "true"]),
        ]
        for (method, params) in invalidRequests {
            do {
                _ = try await LiveStationMethods.handle(method, params: params)
                XCTFail("Accepted malformed \(method) request")
            } catch let failure as WorkerFailure {
                XCTAssertEqual(failure.code, "invalid_params")
            } catch {
                XCTFail("Unexpected error for \(method): \(error)")
            }
        }
    }
    #endif
}
