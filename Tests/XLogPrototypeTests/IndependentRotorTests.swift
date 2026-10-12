import Foundation
import XCTest
@testable import XLogPrototypeSupport

#if os(macOS)
import XCatIntegrationCore
private actor RetirementGate {
    private var started = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var releaseWaiter: CheckedContinuation<Void, Never>?

    func waitForRelease() async {
        started = true
        startWaiter?.resume()
        startWaiter = nil
        await withCheckedContinuation { releaseWaiter = $0 }
    }

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startWaiter = $0 }
    }

    func release() {
        releaseWaiter?.resume()
        releaseWaiter = nil
    }
}

private final class FakeRotorTransport: RotorTransport, @unchecked Sendable {
    let gate: RetirementGate
    let onState: @Sendable (XCatIntegrationCore.DCU1RotatorClient.State, String) -> Void
    init(gate: RetirementGate, onState: @escaping @Sendable (XCatIntegrationCore.DCU1RotatorClient.State, String) -> Void) {
        self.gate = gate
        self.onState = onState
    }
    func start() { onState(.connected, "Connected") }
    func stopAndDrain() async { await gate.waitForRelease() }
    func turn(to bearing: Double) async throws {}
    func stopRotation() async throws {}
}

final class IndependentRotorTests: XCTestCase {
    func testUnusedDCU1TransportRetiresWithoutStartingNetwork() async {
        let stopped = expectation(description: "queued transport retirement completed")
        let client = DCU1RotatorClient(host: "fixture.invalid", port: 4001, pollMilliseconds: 500,
            onState: { state, _ in if state == .stopped { stopped.fulfill() } },
            onAzimuth: { _ in })
        await client.stopAndDrain()
        await fulfillment(of: [stopped], timeout: 1)
    }

    func testRadioDisconnectPreservesNativeRotorAndRetirementBlocksReconnect() async throws {
        let gate = RetirementGate()
        let rotor = LiveRotorSession(factory: { _, _, onState, _ in
            FakeRotorTransport(gate: gate, onState: onState)
        })
        let station = LiveStationSession(rotor: rotor)
        _ = try await station.handle("station_rotor_connect", params: [
            "provider": "direct_agent", "host": "fixture.invalid", "port": 4001,
        ])
        for _ in 0..<50 {
            if (await rotor.projection())["connected"] as? Bool == true { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let beforeRadioShutdown = await rotor.projection()
        XCTAssertEqual(beforeRadioShutdown["connected"] as? Bool, true)

        await station.shutdown()
        let afterRadioShutdown = await rotor.projection()
        XCTAssertEqual(afterRadioShutdown["connected"] as? Bool, true,
                       "Radio-only shutdown must not retire the independent rotor")

        let retiring = Task {
            try await station.handle("station_rotor_disconnect", params: ["provider": "direct_agent"])
        }
        await gate.waitUntilStarted()
        do {
            _ = try await rotor.handle("station_rotor_connect", params: [
                "provider": "direct_agent", "host": "fixture.invalid", "port": 4001,
            ])
            XCTFail("New owner entered before the old socket retired")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "station_busy")
        }
        await gate.release()
        _ = try await retiring.value
        let afterRotorRetirement = await rotor.projection()
        XCTAssertEqual(afterRotorRetirement["connected"] as? Bool, false)
        await rotor.terminate()
        do {
            _ = try await rotor.handle("station_rotor_connect", params: [
                "provider": "direct_agent", "host": "fixture.invalid", "port": 4001,
            ])
            XCTFail("Rotor reconnected after worker EOF")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "worker_stopping")
        }
    }
}
#endif
